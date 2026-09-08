// ============================================================
// MERLIN'S DISH -- LINE BOT + LIFF ORDERING APP
// ============================================================
// This server now does two jobs:
//   1. The LINE Messaging API webhook (/webhook) -- unchanged, handles
//      the "menu" text trigger for people who don't use the app,
//      admin commands, greetings, and pushing order confirmations.
//   2. The LIFF ordering app's backend (/api/*) -- serves menu data
//      to the web app in /public, and receives finished orders from
//      it (see handlePlaceOrder below). The web app itself lives in
//      /public/index.html, style.css, and app.js.
//
// Admin (you) can text the bot directly from your own LINE account:
//   "stock"                 -> lists sold-out items and any tracked stock counts
//   "soldout <item_id>"     -> hides that item from customers
//   "instock <item_id>"     -> brings it back with no stock limit
//   "setstock <item_id> <n>" -> sets a remaining-count limit for that item;
//                                the bot won't let customers order more than
//                                this, and it auto-decreases as orders come in
// Item ids are the short codes in menu.js (e.g. rws_r, bolognese).
//
// You should not need to touch this file for day-to-day changes.
// Prices, dish names, categories, and dish images live in menu.js instead.
// ============================================================

require("dotenv").config();
const path = require("path");
const express = require("express");
const multer = require("multer");
const line = require("@line/bot-sdk");
const axios = require("axios");
const FormData = require("form-data");
const cloudinary = require("cloudinary").v2;
const { MENU, CATEGORIES, PASTA_OPTIONS } = require("./menu");
const { logOrder } = require("./sheetLogger");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const hasCloudinaryCreds =
  !!process.env.CLOUDINARY_CLOUD_NAME && !!process.env.CLOUDINARY_API_KEY && !!process.env.CLOUDINARY_API_SECRET;
if (hasCloudinaryCreds) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Saves a slip photo permanently (for your own accounting records) and
// returns a stable URL, or null if Cloudinary isn't configured yet or
// the upload fails -- callers should treat that as "couldn't archive
// it, but don't block the order over it."
async function uploadSlipPhoto(buffer, mimetype) {
  if (!hasCloudinaryCreds) return null;
  try {
    const base64 = `data:${mimetype || "image/jpeg"};base64,${buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(base64, {
      folder: "merlins-dish-slips",
      resource_type: "image",
    });
    return result.secure_url;
  } catch (err) {
    console.error("Cloudinary slip upload failed (order still proceeds):", err.message);
    return null;
  }
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();
app.use(express.static(path.join(__dirname, "public")));

// In-memory cart/session per customer. Resets if the server restarts --
// fine for a solo, evening-only operation.
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: "idle", cart: {} });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: "idle", cart: {} });
}

// Sold-out items, controlled by you via LINE text commands. Also resets
// on restart -- if that ever matters to you, say so and we'll persist it.
const soldOut = new Set();

// Pending ">2km" delivery-fee requests from the LIFF app, waiting on you
// to reply with a number in your private group. Keyed by a short request
// id; oldest unresolved request is matched to your next numeric reply.
// This assumes you're not juggling many >2km orders at the exact same
// moment -- reasonable for a solo, low-volume kitchen, but worth knowing
// if that ever changes.
const pendingFeeRequests = new Map();
function makeRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Remaining stock per item, controlled by "setstock <id> <n>". If an item
// has no entry here, it's treated as unlimited. Also resets on restart.
const stockCount = new Map();
function remainingStock(itemId) {
  return stockCount.has(itemId) ? stockCount.get(itemId) : Infinity;
}
function isUnavailable(itemId) {
  return soldOut.has(itemId) || remainingStock(itemId) <= 0;
}

// ---------- small helpers ----------

function availableMenu() {
  return MENU.filter((d) => !isUnavailable(d.id));
}

// Cart entries are keyed by a "line id", not just the item id, because the
// same dish can appear as separate lines with different pasta choices
// (e.g. two Bolognese lines, one with Spaghetti, one with Rigatoni).
// Each entry looks like: { itemId, qty, pastaChoice }
// A "side_pasta" itemId is a standalone add-on line, not a real MENU item.

function cartLines(cart) {
  return Object.entries(cart)
    .filter(([, entry]) => entry.qty > 0)
    .map(([lineId, entry]) => {
      if (entry.itemId === "side_pasta") {
        const pasta = PASTA_OPTIONS.find((p) => p.id === entry.pastaChoice);
        return {
          id: lineId,
          name: `Side Pasta -- ${pasta ? pasta.name : entry.pastaChoice}`,
          price: pasta ? pasta.extraPrice : 0,
          qty: entry.qty,
        };
      }
      const dish = MENU.find((d) => d.id === entry.itemId);
      const pasta = entry.pastaChoice ? PASTA_OPTIONS.find((p) => p.id === entry.pastaChoice) : null;
      const surcharge = pasta && dish.requiresPasta ? pasta.mandatorySurcharge || 0 : 0;
      const name = pasta ? `${dish.name} (${pasta.name})` : dish.name;
      return { id: lineId, name, price: dish.price + surcharge, qty: entry.qty };
    });
}

// Total quantity of a given real menu item already sitting in the cart,
// across all its pasta-choice variations -- used for stock checks.
function qtyInCartForItem(cart, itemId) {
  return Object.values(cart)
    .filter((entry) => entry.itemId === itemId)
    .reduce((sum, entry) => sum + entry.qty, 0);
}

function cartTotal(cart) {
  return cartLines(cart).reduce((sum, l) => sum + l.price * l.qty, 0);
}

function cartSummaryText(cart) {
  const lines = cartLines(cart);
  if (lines.length === 0) return "Your cart is empty.";
  const body = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");
  return `Your order so far:\n${body}\n\nTotal: ฿${cartTotal(cart)}`;
}

// Straight-line distance in km between two coordinates (Haversine formula).
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Best-effort: turn coordinates from the LIFF app's map into something
// you can actually act on -- a readable address (via OpenStreetMap's
// free Nominatim service, no API key needed) plus a Google Maps link
// you can tap to open directly and share with a Grab rider. If the
// reverse-geocode lookup fails for any reason, the Maps link alone is
// still enough to work with.
async function describeLocation(lat, lng) {
  const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
  try {
    const res = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: { lat, lon: lng, format: "json" },
      headers: { "User-Agent": "MerlinsDishBot/1.0" },
      timeout: 5000,
    });
    if (res.data && res.data.display_name) {
      return `${res.data.display_name}\n${mapsLink}`;
    }
  } catch (err) {
    console.error("Reverse geocode failed (Maps link still included):", err.message);
  }
  return mapsLink;
}

// ---------- menu display (categories + Flex carousel) ----------

function availableInCategory(catId) {
  return MENU.filter((d) => d.category === catId && !isUnavailable(d.id));
}

function buildPastaFlex(mode, itemId) {
  // mode is "pastafor" (mandatory choice tied to a specific dish) or
  // "sidepasta" (optional add-on, includes a "No thanks" card at the end).
  const bubbles = PASTA_OPTIONS.map((p) => {
    const data = mode === "pastafor" ? `pastafor:${itemId}:${p.id}` : `sidepasta:${p.id}`;
    const bodyContents = [{ type: "text", text: p.name, weight: "bold", size: "md", wrap: true }];
    if (mode === "sidepasta") {
      bodyContents.push({ type: "text", text: `+฿${p.extraPrice}`, size: "sm", color: "#999999" });
    } else if (p.mandatorySurcharge > 0) {
      bodyContents.push({ type: "text", text: `+฿${p.mandatorySurcharge}`, size: "sm", color: "#999999" });
    }
    const bubble = {
      type: "bubble",
      size: "micro",
      body: { type: "box", layout: "vertical", contents: bodyContents },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", color: "#E8302A", action: { type: "postback", label: "Choose", data } },
        ],
      },
    };
    if (p.image) {
      bubble.hero = { type: "image", url: p.image, size: "full", aspectRatio: "1:1", aspectMode: "cover" };
    }
    return bubble;
  });

  if (mode === "sidepasta") {
    bubbles.push({
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: "No thanks", weight: "bold", size: "md" }],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "secondary", action: { type: "postback", label: "No thanks", data: "sidepasta:no" } },
        ],
      },
    });
  }

  return {
    type: "flex",
    altText: "Choose your pasta",
    contents: { type: "carousel", contents: bubbles },
  };
}

function buildMenuFlex(catId) {
  const bubbles = availableInCategory(catId).map((dish) => {
    const bubble = {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: dish.name, weight: "bold", size: "md", wrap: true },
          { type: "text", text: `฿${dish.price}`, size: "sm", color: "#999999" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#E8302A",
            action: { type: "postback", label: "Add to order", data: `add:${dish.id}` },
          },
        ],
      },
    };
    // Only add an image block if this dish has one configured in menu.js.
    // Without this check, a missing/broken image URL would show a blank
    // broken-image icon instead of just skipping gracefully.
    if (dish.image) {
      bubble.hero = {
        type: "image",
        url: dish.image,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover",
      };
    }
    return bubble;
  });

  return {
    type: "flex",
    altText: "Merlin's Dish menu",
    contents: { type: "carousel", contents: bubbles },
  };
}

function categoryQuickReply() {
  return {
    items: CATEGORIES.map((c) => ({
      type: "action",
      action: { type: "postback", label: c.label, data: `category:${c.id}` },
    })),
  };
}

function categoryActionsQuickReply() {
  return {
    items: [
      { type: "action", action: { type: "postback", label: "🔙 All categories", data: "show_menu" } },
      { type: "action", action: { type: "postback", label: "✏️ Edit cart", data: "edit_order" } },
      { type: "action", action: { type: "postback", label: "✅ Checkout", data: "checkout" } },
      { type: "action", action: { type: "postback", label: "🗑 Clear cart", data: "clear" } },
      { type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } },
    ],
  };
}

function qtyQuickReply(itemId) {
  const items = [1, 2, 3].map((n) => ({
    type: "action",
    action: { type: "postback", label: `${n}`, data: `qty:${itemId}:${n}` },
  }));
  return cancelOnlyQuickReply(items);
}

function cartActionsQuickReply() {
  return {
    items: [
      { type: "action", action: { type: "postback", label: "➕ Add more", data: "reopen_category" } },
      { type: "action", action: { type: "postback", label: "✏️ Edit cart", data: "edit_order" } },
      { type: "action", action: { type: "postback", label: "✅ Checkout", data: "checkout" } },
      { type: "action", action: { type: "postback", label: "🗑 Clear cart", data: "clear" } },
      { type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } },
    ],
  };
}

// A real cart review: each item shown with its own remove button, not
// just "add more" or "clear everything". This is what "Edit cart" opens.
function buildCartReviewFlex(cart) {
  const lines = cartLines(cart);
  const rows = [];
  lines.forEach((l, i) => {
    if (i > 0) rows.push({ type: "separator", margin: "md" });
    rows.push({
      type: "box",
      layout: "horizontal",
      margin: "md",
      alignItems: "center",
      contents: [
        { type: "text", text: `${l.qty}x ${l.name}`, size: "sm", wrap: true, flex: 5 },
        { type: "text", text: `฿${l.price * l.qty}`, size: "sm", align: "end", flex: 2 },
        {
          type: "button",
          style: "link",
          height: "sm",
          flex: 1,
          action: { type: "postback", label: "🗑", data: `remove_line:${l.id}` },
        },
      ],
    });
  });

  return {
    type: "flex",
    altText: "Your cart",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "Your Cart", weight: "bold", size: "lg" },
          { type: "separator", margin: "md" },
          ...rows,
          { type: "separator", margin: "md" },
          { type: "text", text: `Total: ฿${cartTotal(cart)}`, weight: "bold", margin: "md" },
        ],
      },
    },
  };
}

async function showCartReview(userId, replyToken) {
  const session = getSession(userId);
  if (cartLines(session.cart).length === 0) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "Your cart is empty. What are you in the mood for?",
      quickReply: cancelOnlyQuickReply(categoryQuickReply().items),
    });
    return;
  }
  await client.replyMessage(replyToken, [
    buildCartReviewFlex(session.cart),
    {
      type: "text",
      text: "Tap 🗑 to remove an item, or use the buttons below.",
      quickReply: cartActionsQuickReply(),
    },
  ]);
}

async function handleRemoveLine(userId, replyToken, lineId) {
  const session = getSession(userId);
  delete session.cart[lineId];
  return showCartReview(userId, replyToken);
}

async function sendCategoryCarousel(replyToken, catId, leadText) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  const flex = buildMenuFlex(catId);
  flex.quickReply = categoryActionsQuickReply();
  await client.replyMessage(replyToken, [
    { type: "text", text: leadText || `${cat.label} — tap a dish to add it 👇` },
    flex,
  ]);
}

// ---------- menu & cart handlers ----------

async function showMenu(userId, replyToken) {
  getSession(userId).step = "ordering";
  await client.replyMessage(replyToken, {
    type: "text",
    text: "What are you in the mood for?",
    quickReply: cancelOnlyQuickReply(categoryQuickReply().items),
  });
}

async function showCategoryMenu(userId, replyToken, catId) {
  const session = getSession(userId);
  session.step = "ordering";
  session.lastCategory = catId;
  await sendCategoryCarousel(replyToken, catId);
}

async function handleAddPrompt(userId, replyToken, itemId) {
  const session = getSession(userId);
  if (isUnavailable(itemId)) {
    const cat = session.lastCategory || (CATEGORIES[0] && CATEGORIES[0].id);
    await sendCategoryCarousel(replyToken, cat, "Sorry, that one's sold out today! Pick another below.");
    return;
  }
  session.pendingItemId = itemId;
  const dish = MENU.find((d) => d.id === itemId);

  // Bolognese/Ragu: ask which pasta FIRST, then how many -- one sauce
  // plus one noodle choice makes one plate, so the noodle has to be
  // picked before we can ask "how many of that plate would you like?"
  if (dish.requiresPasta) {
    await client.replyMessage(replyToken, [
      { type: "text", text: `Which pasta would you like with your "${dish.name}"?` },
      { ...buildPastaFlex("pastafor", itemId), quickReply: cancelOnlyQuickReply() },
    ]);
    return;
  }

  await client.replyMessage(replyToken, {
    type: "text",
    text: `How many "${dish.name}" would you like?`,
    quickReply: qtyQuickReply(itemId),
  });
}

// Called once a quantity has been picked. Any pending pasta choice
// (set earlier by handlePastaChosen, for Bolognese/Ragu) rides along
// automatically; everything else adds straight away, and a "mains"
// dish (a stew) gets offered pasta as a side add-on afterward.
async function proceedAfterQty(userId, replyToken, itemId, qty) {
  const dish = MENU.find((d) => d.id === itemId);
  const session = getSession(userId);
  const pastaChoice = session.pendingPastaChoice || null;
  session.pendingPastaChoice = null;
  await addToCart(userId, replyToken, itemId, qty, pastaChoice, dish.category === "mains");
}

async function handlePastaChosen(userId, replyToken, itemId, pastaId) {
  const session = getSession(userId);
  session.pendingItemId = itemId;
  session.pendingPastaChoice = pastaId;
  const dish = MENU.find((d) => d.id === itemId);
  const pasta = PASTA_OPTIONS.find((p) => p.id === pastaId);
  await client.replyMessage(replyToken, {
    type: "text",
    text: `How many "${dish.name}" (${pasta ? pasta.name : pastaId}) would you like?`,
    quickReply: qtyQuickReply(itemId),
  });
}

async function addToCart(userId, replyToken, itemId, qty, pastaChoice, offerSidePasta) {
  const session = getSession(userId);

  const remaining = remainingStock(itemId);
  if (remaining !== Infinity) {
    const already = qtyInCartForItem(session.cart, itemId);
    const available = remaining - already;
    const dish = MENU.find((d) => d.id === itemId);
    if (available <= 0) {
      session.pendingItemId = null;
      session.pendingQty = null;
      await client.replyMessage(replyToken, {
        type: "text",
        text: `Sorry, "${dish.name}" just sold out! You already have all we have left in your cart.`,
        quickReply: cartActionsQuickReply(),
      });
      return;
    }
    if (qty > available) {
      qty = available;
      await client.pushMessage(userId, {
        type: "text",
        text: `Heads up, only ${available} of "${dish.name}" left, so we've added ${available} instead.`,
      });
    }
  }

  const lineId = pastaChoice ? `${itemId}:${pastaChoice}` : itemId;
  const existing = session.cart[lineId];
  session.cart[lineId] = existing
    ? { ...existing, qty: existing.qty + qty }
    : { itemId, qty, pastaChoice: pastaChoice || null };
  session.pendingItemId = null;
  session.pendingQty = null;
  session.step = "ordering";

  if (offerSidePasta) {
    await client.replyMessage(replyToken, [
      { type: "text", text: `${cartSummaryText(session.cart)}\n\nWould you like to add pasta on the side?` },
      { ...buildPastaFlex("sidepasta", null), quickReply: cancelOnlyQuickReply() },
    ]);
    return;
  }

  await client.replyMessage(replyToken, {
    type: "text",
    text: cartSummaryText(session.cart),
    quickReply: cartActionsQuickReply(),
  });
}

async function handleSidePasta(userId, replyToken, pastaId) {
  const session = getSession(userId);
  if (pastaId !== "no") {
    const lineId = `side_pasta:${pastaId}`;
    const existing = session.cart[lineId];
    session.cart[lineId] = existing
      ? { ...existing, qty: existing.qty + 1 }
      : { itemId: "side_pasta", qty: 1, pastaChoice: pastaId };
  }
  await client.replyMessage(replyToken, {
    type: "text",
    text: cartSummaryText(session.cart),
    quickReply: cartActionsQuickReply(),
  });
}


async function handleClearCart(userId, replyToken) {
  const session = getSession(userId);
  session.cart = {};
  session.step = "ordering";
  if (session.lastCategory) {
    const cat = CATEGORIES.find((c) => c.id === session.lastCategory);
    await sendCategoryCarousel(replyToken, session.lastCategory, `Cart cleared. ${cat.label} — tap a dish to add it 👇`);
  } else {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "Cart cleared. What are you in the mood for?",
      quickReply: categoryQuickReply(),
    });
  }
}

function cancelOnlyQuickReply(extraItems) {
  const items = extraItems ? [...extraItems] : [];
  items.push({ type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } });
  return { items };
}

// Same as above, but also offers to go back and edit the cart -- for
// prompts before payment method is chosen, where reconsidering what's
// in the cart still makes sense (timing, location, address note).
function cancelAndEditQuickReply(extraItems) {
  const items = extraItems ? [...extraItems] : [];
  items.push({ type: "action", action: { type: "postback", label: "✏️ Edit cart", data: "edit_order" } });
  items.push({ type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } });
  return { items };
}

async function handleCheckout(userId, replyToken) {
  const session = getSession(userId);
  if (cartLines(session.cart).length === 0) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "Your cart is empty -- add a dish first. What are you in the mood for?",
      quickReply: categoryQuickReply(),
    });
    return;
  }
  session.step = "awaiting_timing";
  await client.replyMessage(replyToken, {
    type: "text",
    text: "Would you like this delivered right away, or scheduled for later?",
    quickReply: cancelAndEditQuickReply([
      { type: "action", action: { type: "postback", label: "🕐 Right away", data: "timing:asap" } },
      { type: "action", action: { type: "postback", label: "📅 Schedule", data: "timing:schedule" } },
    ]),
  });
}

const ADDRESS_NOTE_PROMPT = "Please include unit number or a place to deliver for our rider eg. lobby";

async function askLocationPrompt(replyToken) {
  await client.replyMessage(replyToken, {
    type: "text",
    text:
      `Please share your delivery location so we can work out the fee, any of these work:\n` +
      `1. Tap the "+" icon > Location > choose your drop-off point\n` +
      `2. Paste a Google Maps link to your location\n` +
      `3. Type your full address`,
    quickReply: cancelAndEditQuickReply(),
  });
}

async function handleTimingAsap(userId, replyToken) {
  const session = getSession(userId);
  session.timing = "ASAP";
  session.step = "awaiting_location";
  await askLocationPrompt(replyToken);
}

async function handleTimingSchedule(userId, replyToken) {
  const session = getSession(userId);
  session.step = "awaiting_schedule_text";
  await client.replyMessage(replyToken, {
    type: "text",
    text: "What date and time would you like it delivered? (e.g. \"7 Sep, 6:30 PM\")",
    quickReply: cancelAndEditQuickReply(),
  });
}

// ---------- delivery location & fee ----------

// Pulls latitude/longitude out of a Google Maps URL, checking the most
// specific pattern first (the exact pin, "!3d..!4d..") before falling
// back to the map's center point ("@lat,long") or a "q=lat,long" param.
function extractLatLngFromGoogleMapsUrl(url) {
  let m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

// "Place share" links (as opposed to "pin drop" links) resolve to a
// q=<place name and address> parameter instead of coordinates. Getting
// real lat/lng out of those needs a paid Google Places API call, which
// this bot doesn't use -- so instead, pull out that readable address
// text and use it directly, at least saving a re-type and giving a
// clean, correctly formatted address rather than a customer's own typing.
function extractAddressFromGoogleMapsUrl(url) {
  const m = url.match(/[?&]q=([^&]+)/);
  if (!m) return null;
  const raw = m[1].replace(/\+/g, " ");
  try {
    const decoded = decodeURIComponent(raw);
    // A bare "lat,lng" q= param isn't a readable address, skip it --
    // extractLatLngFromGoogleMapsUrl already handles that case.
    if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(decoded.trim())) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

async function handleGoogleMapsLink(userId, replyToken, url) {
  const session = getSession(userId);
  let coords = null;
  let readableAddress = null;
  try {
    // Short links (maps.app.goo.gl) usually redirect to the real
    // maps.google.com URL that contains the coordinates. But Google
    // often does this redirect via a JavaScript landing page rather
    // than a clean HTTP redirect, which a server-side fetch never runs.
    // So: try the final URL after any real HTTP redirects first, then
    // fall back to scanning the raw page content for an embedded maps
    // URL or coordinate pair, which is usually present as plain text
    // even when the JS redirect itself doesn't fire for us.
    const response = await axios.get(url, {
      maxRedirects: 10,
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      validateStatus: () => true,
    });
    const finalUrl = (response.request && response.request.res && response.request.res.responseUrl) || url;
    coords = extractLatLngFromGoogleMapsUrl(finalUrl);
    readableAddress = extractAddressFromGoogleMapsUrl(finalUrl);

    if (!coords && typeof response.data === "string") {
      const body = response.data;
      const embeddedUrlMatch = body.match(/https:\/\/www\.google\.com\/maps[^\s"'<>\\]+/);
      if (embeddedUrlMatch) {
        const decodedEmbedded = decodeURIComponent(embeddedUrlMatch[0]);
        coords = extractLatLngFromGoogleMapsUrl(decodedEmbedded);
        if (!readableAddress) readableAddress = extractAddressFromGoogleMapsUrl(decodedEmbedded);
      }
      if (!coords) {
        coords = extractLatLngFromGoogleMapsUrl(body);
      }
    }
  } catch (err) {
    console.error("Failed to resolve Google Maps link:", err.message);
  }

  if (!coords) {
    session.addressBase = readableAddress || url;
    session.needsManualFee = true;
    session.distanceKm = null;
    session.step = "awaiting_address_note";
    await pingManualFeeNeeded(null);
    const note = readableAddress
      ? `Got it: ${readableAddress}\n\nMerlin's Dish will confirm your delivery fee shortly.`
      : `We couldn't read the location from that link, so Merlin's Dish will confirm your delivery fee shortly.`;
    await client.replyMessage(replyToken, {
      type: "text",
      text: `${note}\n\n${ADDRESS_NOTE_PROMPT}`,
      quickReply: cancelAndEditQuickReply(),
    });
    return;
  }

  // From here it's identical to a shared location pin.
  return handleLocationShared(userId, replyToken, {
    latitude: coords.lat,
    longitude: coords.lng,
    address: null,
    title: null,
  });
}

async function handleLocationShared(userId, replyToken, message) {
  const session = getSession(userId);
  const shopLat = parseFloat(process.env.SHOP_LAT);
  const shopLng = parseFloat(process.env.SHOP_LNG);

  const label = message.address || message.title || "";
  session.addressBase = label;

  if (isNaN(shopLat) || isNaN(shopLng)) {
    session.needsManualFee = true;
    session.distanceKm = null;
    console.warn("SHOP_LAT/SHOP_LNG not set -- cannot calculate delivery distance.");
  } else {
    const d = distanceKm(shopLat, shopLng, message.latitude, message.longitude);
    session.distanceKm = d;
    if (d <= 2) {
      session.deliveryFee = 0;
      session.needsManualFee = false;
    } else {
      session.needsManualFee = true;
      await pingManualFeeNeeded(d);
    }
  }

  session.step = "awaiting_address_note";
  const feeMsg =
    session.needsManualFee === false
      ? "You're within our free delivery zone! 🎉"
      : "Noted -- Merlin's Dish will confirm your delivery fee shortly.";
  await client.replyMessage(replyToken, {
    type: "text",
    text: `${feeMsg}\n\n${ADDRESS_NOTE_PROMPT}`,
    quickReply: cancelAndEditQuickReply(),
  });
}

async function handleCancelOrder(userId, replyToken) {
  const session = getSession(userId);
  const alreadyPaid = !!session.slipRef;

  if (alreadyPaid) {
    const target = process.env.LINE_INTERNAL_TARGET_ID;
    if (target) {
      let displayName = userId;
      try {
        const profile = await client.getProfile(userId);
        displayName = profile.displayName;
      } catch (e) {
        /* ignore -- lookup can fail */
      }
      try {
        await client.pushMessage(target, {
          type: "text",
          text:
            `⚠️ CUSTOMER CANCELLED AFTER PAYING\n` +
            `Customer: ${displayName}\n` +
            `Slip amount: ฿${session.slipAmount}\n` +
            `Slip ref: ${session.slipRef}\n` +
            `Please sort out a refund or resolution directly with them.`,
        });
      } catch (err) {
        console.error("Failed to push paid-cancellation alert:", err.message);
      }
    }
    resetSession(userId);
    await client.replyMessage(replyToken, {
      type: "text",
      text: "Since you've already paid, we've let Merlin's Dish know directly to sort out your cancellation. They'll be in touch shortly.",
    });
    return;
  }

  resetSession(userId);
  await client.replyMessage(replyToken, {
    type: "text",
    text: "Your order has been cancelled, no worries! Type \"menu\" anytime you're ready to order again 🍲",
  });
}

async function handleChangePaymentMethod(userId, replyToken) {
  const session = getSession(userId);
  if (cartLines(session.cart).length === 0) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "You don't have an order in progress yet. Type \"menu\" to start one!",
    });
    return;
  }
  return askPaymentMethod(userId, replyToken);
}

async function handleChangeAddress(userId, replyToken) {
  const session = getSession(userId);
  session.addressBase = null;
  session.address = null;
  session.addressNote = null;
  session.distanceKm = null;
  session.needsManualFee = null;
  session.step = "awaiting_location";
  await client.replyMessage(replyToken, [
    { type: "text", text: "No problem, let's update your delivery location." },
    {
      type: "text",
      text:
        `Please share your delivery location so we can work out the fee, any of these work:\n` +
        `1. Tap the "+" icon > Location > choose your drop-off point\n` +
        `2. Paste a Google Maps link to your location\n` +
        `3. Type your full address`,
    },
  ]);
}

async function pingManualFeeNeeded(d) {
  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (!target) return;
  const distanceText = d == null ? "an unknown distance (customer typed their address instead of sharing a pin)" : `${d.toFixed(1)}km away (outside the free 2km zone)`;
  try {
    await client.pushMessage(target, {
      type: "text",
      text:
        `📍 DELIVERY FEE NEEDED\n` +
        `Customer is ${distanceText}.\n` +
        `Their order is still coming in -- please work out the fee and message ` +
        `them directly once it lands in this group.`,
    });
  } catch (err) {
    console.error("Failed to push distance-flag message:", err.message);
  }
}

async function showFinalSummary(userId, replyToken) {
  const session = getSession(userId);
  session.step = "awaiting_final_confirm";
  const lines = cartLines(session.cart);
  const total = cartTotal(session.cart);
  const body = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");
  const timingLine =
    session.timing === "ASAP" ? "Timing: Right away" : `Timing: Scheduled for ${session.scheduleText}`;
  const deliveryLine =
    session.needsManualFee === false
      ? "Delivery: FREE (within 2km)"
      : "Delivery fee: to be confirmed by Merlin's Dish";

  await client.replyMessage(replyToken, {
    type: "text",
    text: `Please confirm your order:\n${body}\n\n${timingLine}\n${deliveryLine}\n\nFood total: ฿${total}`,
    quickReply: {
      items: [
        { type: "action", action: { type: "postback", label: "✅ Confirm", data: "confirm_order" } },
        { type: "action", action: { type: "postback", label: "📍 Change address", data: "change_address" } },
        { type: "action", action: { type: "postback", label: "✏️ Edit order", data: "edit_order" } },
        { type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } },
      ],
    },
  });
}

// ---------- payment ----------

function paymentAndCancelQuickReply() {
  return {
    items: [
      { type: "action", action: { type: "postback", label: "🔁 Change payment", data: "change_payment" } },
      { type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } },
    ],
  };
}

async function askPaymentMethod(userId, replyToken) {
  getSession(userId).step = "awaiting_payment_choice";
  await client.replyMessage(replyToken, {
    type: "text",
    text: "How would you like to pay?",
    quickReply: {
      items: [
        { type: "action", action: { type: "postback", label: "💳 Bank Transfer", data: "pay:bank" } },
        { type: "action", action: { type: "postback", label: "🔲 QR Code", data: "pay:qr" } },
      ],
    },
  });
}

async function handlePayBank(userId, replyToken) {
  const session = getSession(userId);
  session.step = "awaiting_slip";
  const total = cartTotal(session.cart);
  const paymentInfo = process.env.BUSINESS_PAYMENT_INFO || "our bank account";
  await client.replyMessage(replyToken, {
    type: "text",
    text: `Total to pay: ฿${total}\n\nPlease transfer to ${paymentInfo}, then send a photo of your payment slip here.`,
    quickReply: paymentAndCancelQuickReply(),
  });
}

async function handlePayQr(userId, replyToken) {
  const session = getSession(userId);
  session.step = "awaiting_slip";
  const total = cartTotal(session.cart);
  const qrUrl = process.env.QR_IMAGE_URL;
  if (!qrUrl) {
    console.warn("QR_IMAGE_URL not set -- falling back to bank details text.");
    return handlePayBank(userId, replyToken);
  }
  try {
    await client.replyMessage(replyToken, [
      { type: "image", originalContentUrl: qrUrl, previewImageUrl: qrUrl },
      {
        type: "text",
        text: `Total to pay: ฿${total}\n\nScan the QR above, then send a photo of your payment slip here.`,
        quickReply: paymentAndCancelQuickReply(),
      },
    ]);
  } catch (err) {
    // LINE rejects the whole message if the image URL is bad (wrong
    // format, private repo, spaces in the filename, too large, etc).
    // Fall back to bank details rather than leaving the customer with
    // nothing at all.
    console.error("Sending QR payment message failed, falling back to bank details:", err.message);
    const paymentInfo = process.env.BUSINESS_PAYMENT_INFO || "our bank account";
    await client.pushMessage(userId, {
      type: "text",
      text:
        `Total to pay: ฿${total}\n\n` +
        `Our QR image isn't loading right now, please use bank transfer instead:\n` +
        `Transfer to ${paymentInfo}, then send a photo of your payment slip here.`,
      quickReply: paymentAndCancelQuickReply(),
    });
  }
}

// ---------- slip verification ----------

async function verifySlip(imageBuffer, expectedAmount) {
  const form = new FormData();
  form.append("image", imageBuffer, { filename: "slip.jpg" });
  form.append("matchAmount", String(expectedAmount));
  form.append("checkDuplicate", "true");

  const response = await axios.post("https://api.thunder.in.th/v2/verify/bank", form, {
    headers: {
      Authorization: `Bearer ${process.env.THUNDER_API_KEY}`,
      ...form.getHeaders(),
    },
    validateStatus: () => true,
  });

  return response.data;
}

async function handleSlipImage(userId, messageId) {
  const session = getSession(userId);
  const total = cartTotal(session.cart);

  let imageBuffer;
  try {
    const stream = await client.getMessageContent(messageId);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    imageBuffer = Buffer.concat(chunks);
  } catch (err) {
    console.error("Downloading slip image failed:", err.message);
    await forwardForManualReview(userId, session, "Could not download the slip image.");
    await client.pushMessage(userId, {
      type: "text",
      text: "We couldn't process that photo, so I've sent it to Merlin's Dish directly. We'll confirm with you shortly!",
    });
    return;
  }

  // Every response below uses pushMessage, not replyMessage. This step calls
  // an external API and can take a few seconds -- long enough for LINE's
  // reply token to expire. Push messages have no such expiry.

  let result;
  try {
    result = await verifySlip(imageBuffer, total);
  } catch (err) {
    console.error("Thunder API request failed:", err.message);
    await forwardForManualReview(userId, session, "Slip check API did not respond.");
    await client.pushMessage(userId, {
      type: "text",
      text: "We couldn't verify that automatically, so I've sent it to Merlin's Dish directly. We'll confirm with you shortly!",
    });
    return;
  }

  if (!result.success) {
    const code = result.error && result.error.code;
    if (code === "SLIP_PENDING") {
      await client.pushMessage(userId, {
        type: "text",
        text: "This slip is still processing on the bank's side. Please wait a couple of minutes and send it again.",
      });
      return;
    }
    if (code === "SLIP_NOT_FOUND" || code === "INVALID_IMAGE_FORMAT") {
      await client.pushMessage(userId, {
        type: "text",
        text: "We couldn't read a slip in that photo. Please make sure the QR code area is clear and try again.",
      });
      return;
    }
    await forwardForManualReview(userId, session, `Slip check error: ${code || "unknown"}`);
    await client.pushMessage(userId, {
      type: "text",
      text: "We couldn't verify that automatically, so I've sent it to Merlin's Dish directly. We'll confirm with you shortly!",
    });
    return;
  }

  const slip = result.data;

  if (slip.isDuplicate) {
    await client.pushMessage(userId, {
      type: "text",
      text: "This slip has already been used for a previous order. Please send the slip for this new payment.",
    });
    return;
  }

  if (slip.isAmountMatched === false) {
    await client.pushMessage(userId, {
      type: "text",
      text:
        `The slip shows ฿${slip.amountInSlip}, but your order total is ฿${total}. ` +
        `Please send the correct slip, or contact us directly if this looks wrong.`,
    });
    return;
  }

  session.slipAmount = slip.amountInSlip;
  session.slipRef = slip.transRef;
  session.slipUrl = await uploadSlipPhoto(imageBuffer, "image/jpeg");
  session.step = "awaiting_name_phone";
  await client.pushMessage(userId, {
    type: "text",
    text:
      "Payment verified! ✅ Please send your name and contact number together, " +
      "separated by a comma (e.g. \"John Doe, 0812345678\").",
  });
}

async function forwardForManualReview(userId, session, reason) {
  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (!target) return;
  let displayName = userId;
  try {
    const profile = await client.getProfile(userId);
    displayName = profile.displayName;
  } catch (e) {
    /* profile lookup can fail if not friends yet -- ignore */
  }
  const lines = cartLines(session.cart);
  const body = lines.map((l) => `${l.qty}x ${l.name}`).join(", ");
  try {
    await client.pushMessage(target, {
      type: "text",
      text:
        `⚠️ NEEDS MANUAL SLIP CHECK\n` +
        `Customer: ${displayName}\n` +
        `Order: ${body}\n` +
        `Total: ฿${cartTotal(session.cart)}\n` +
        `Reason: ${reason}\n` +
        `Please check their chat directly in the LINE Official Account app.`,
    });
  } catch (err) {
    console.error("Failed to push manual-review message to internal target:", err.message);
  }
  resetSession(userId);
}

// ---------- name & phone, then finish ----------


async function finishOrder(userId, replyToken, session) {
  const lines = cartLines(session.cart);
  const total = cartTotal(session.cart);
  const orderText = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");

  // Deduct from any tracked stock counts now that the order is confirmed.
  for (const entry of Object.values(session.cart)) {
    if (entry.itemId === "side_pasta") continue;
    if (!stockCount.has(entry.itemId)) continue;
    const remaining = stockCount.get(entry.itemId) - entry.qty;
    stockCount.set(entry.itemId, remaining);
    if (remaining <= 0) soldOut.add(entry.itemId);
  }

  const fullAddress = session.addressBase
    ? `${session.addressBase}${session.addressNote && session.addressNote !== "-" ? " -- " + session.addressNote : ""}`
    : session.address || "(not provided)";

  const timingLine =
    session.timing === "ASAP" ? "Right away" : `Scheduled for ${session.scheduleText}`;

  const deliveryLine =
    session.needsManualFee === false
      ? `Delivery: FREE (${session.distanceKm.toFixed(1)}km, within 2km zone)`
      : session.distanceKm != null
      ? `Delivery fee: TO BE CONFIRMED (${session.distanceKm.toFixed(1)}km, outside free zone)`
      : `Delivery fee: TO BE CONFIRMED (typed address, distance not calculated)`;

  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (target) {
    try {
      const messages = [
        {
          type: "text",
          text:
            `🧾 NEW ORDER\n\n${orderText}\n\nFood total: ฿${total}\nTiming: ${timingLine}\n${deliveryLine}\n\n` +
            `Name: ${session.name}\nAddress: ${fullAddress}\nPhone: ${session.phone}\n\n` +
            `Paid via: ${session.paymentMethod || "unknown"}\n` +
            `Slip amount: ฿${session.slipAmount}\nSlip ref: ${session.slipRef}`,
        },
      ];
      if (session.slipUrl) {
        messages.push({ type: "image", originalContentUrl: session.slipUrl, previewImageUrl: session.slipUrl });
      }
      await client.pushMessage(target, messages);
    } catch (err) {
      console.error("Failed to push new-order message to internal target:", err.message);
    }
  } else {
    console.warn("LINE_INTERNAL_TARGET_ID is not set -- order was not forwarded anywhere.");
  }

  await logOrder({
    name: session.name,
    address: fullAddress,
    phone: session.phone,
    items: lines,
    total,
    slipRef: session.slipRef,
    slipUrl: session.slipUrl,
  });

  const customerDeliveryLine =
    session.needsManualFee === false
      ? "Delivery is free for you!"
      : "We'll confirm your delivery fee with you shortly.";

  await client.pushMessage(userId, {
    type: "text",
    text: `All set! Your order is confirmed and on its way to the kitchen. ${customerDeliveryLine} Thank you for ordering from Merlin's Dish! 🍲`,
  });

  resetSession(userId);
}

// ---------- admin commands (you only) ----------

async function handleAdminCommand(replyToken, text) {
  const lower = text.toLowerCase().trim();

  if (lower === "stock") {
    const body = MENU.map((d) => {
      const countText = stockCount.has(d.id) ? ` [${stockCount.get(d.id)} left]` : "";
      return `${isUnavailable(d.id) ? "❌" : "✅"} ${d.id} -- ${d.name}${countText}`;
    }).join("\n");
    await client.replyMessage(replyToken, { type: "text", text: `Stock status:\n${body}` });
    return true;
  }
  if (lower.startsWith("setstock ")) {
    const parts = text.trim().split(/\s+/);
    const id = parts[1];
    const n = parseInt(parts[2], 10);
    if (!MENU.find((d) => d.id === id)) {
      await client.replyMessage(replyToken, { type: "text", text: `Unknown item id "${id}". Text "stock" to see valid ids.` });
      return true;
    }
    if (isNaN(n)) {
      await client.replyMessage(replyToken, { type: "text", text: `Please send a number, e.g. "setstock rws_r 10".` });
      return true;
    }
    stockCount.set(id, n);
    if (n <= 0) soldOut.add(id);
    else soldOut.delete(id);
    await client.replyMessage(replyToken, { type: "text", text: `"${id}" stock set to ${n}.` });
    return true;
  }
  if (lower.startsWith("soldout ")) {
    const id = text.trim().split(/\s+/)[1];
    if (!MENU.find((d) => d.id === id)) {
      await client.replyMessage(replyToken, { type: "text", text: `Unknown item id "${id}". Text "stock" to see valid ids.` });
      return true;
    }
    soldOut.add(id);
    await client.replyMessage(replyToken, { type: "text", text: `Marked "${id}" as sold out. It's now hidden from customers.` });
    return true;
  }
  if (lower.startsWith("instock ")) {
    const id = text.trim().split(/\s+/)[1];
    soldOut.delete(id);
    stockCount.delete(id);
    await client.replyMessage(replyToken, { type: "text", text: `"${id}" is back in stock (no limit set).` });
    return true;
  }
  return false;
}

async function handleFeeReply(replyToken, fee) {
  // Match to the oldest request still waiting -- see the note by
  // pendingFeeRequests above about why this is a FIFO match, not
  // tied to a specific customer by name.
  let oldestId = null;
  let oldestTime = Infinity;
  for (const [id, entry] of pendingFeeRequests.entries()) {
    if (entry.status === "waiting" && entry.createdAt < oldestTime) {
      oldestId = id;
      oldestTime = entry.createdAt;
    }
  }

  if (!oldestId) {
    // No pending request -- this was probably just an unrelated number
    // typed in the group chat, say nothing so as not to be confusing.
    return;
  }

  const entry = pendingFeeRequests.get(oldestId);
  entry.status = "confirmed";
  entry.fee = fee;

  await client.replyMessage(replyToken, {
    type: "text",
    text: `✅ Delivery fee of ฿${fee} confirmed. The customer's app will pick this up automatically.`,
  });

  // Clean up old entries so this map doesn't grow forever over many days.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, e] of pendingFeeRequests.entries()) {
    if (e.createdAt < cutoff) pendingFeeRequests.delete(id);
  }
}

async function handleHumanHandoff(userId, replyToken, triggerText) {
  const session = getSession(userId);
  session.step = "with_staff";

  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (target) {
    let displayName = userId;
    try {
      const profile = await client.getProfile(userId);
      displayName = profile.displayName;
    } catch (e) {
      /* ignore -- not friends yet or lookup failed */
    }
    try {
      await client.pushMessage(target, {
        type: "text",
        text:
          `💬 CUSTOMER WANTS TO TALK\n` +
          `Customer: ${displayName}\n` +
          `Their message: "${triggerText}"\n` +
          `Please reply to them directly in the LINE Official Account app. ` +
          `The bot will stay quiet for them until they type "menu" again.`,
      });
    } catch (err) {
      console.error("Failed to push human-handoff message to internal target:", err.message);
    }
  }

  await client.replyMessage(replyToken, {
    type: "text",
    text: "Sure! I've let Merlin's Dish know, they'll get back to you here shortly 💬",
  });
}

async function sendOrderAppLink(userId, replyToken) {
  const liffId = process.env.LIFF_ID;
  if (!liffId) {
    // LIFF isn't set up yet -- fall back to the old chat ordering flow
    // rather than leaving a real customer with a dead end.
    return showMenu(userId, replyToken);
  }
  await client.replyMessage(replyToken, {
    type: "template",
    altText: "Order from Merlin's Dish",
    template: {
      type: "buttons",
      text: "Ready to order? Tap below to browse the full menu and order directly 🍲",
      actions: [{ type: "uri", label: "🥘 Order Now", uri: `https://liff.line.me/${liffId}` }],
    },
  });
}

async function handleFollow(userId, replyToken) {
  await client.replyMessage(replyToken, {
    type: "text",
    text:
      `Hello, welcome to the kitchen 🥘✨\n\n` +
      `We're a small neighbourhood kitchen crafting slow cooked stews, soups, and pasta, made for homey comfort. 🤌🏼\n\n` +
      `Ready to order? Just type "menu" anytime.\n\n` +
      `⚡ Craving something now? Grab gets it to you fast, perfect for when hunger cannot wait.\n` +
      `🪄 Got a little time? Order direct with us here for lower menu prices and free delivery within 2km.\n\n` +
      `Got a question instead? Just ask, we're happy to help, this isn't only for ordering.\n\n` +
      `Both ways, same magic.\n\n` +
      `Comfort Food Made With Magic ✨\n` +
      `—Merlin's Dish`,
  });
}

// ---------- LIFF app API ----------
// Backend for the web app in /public. It reuses the same helper
// functions, menu data, stock tracking, and LINE push logic as the
// chat-based bot above -- this is genuinely the same server, just a
// second way in for customers.

app.get("/api/menu", (req, res) => {
  const items = MENU.map((d) => ({
    id: d.id,
    name: d.name,
    price: d.price,
    category: d.category,
    image: d.image,
    requiresPasta: !!d.requiresPasta,
    available: !isUnavailable(d.id),
    remaining: stockCount.has(d.id) ? stockCount.get(d.id) : null,
  }));
  res.json({ categories: CATEGORIES, items, pastaOptions: PASTA_OPTIONS });
});

app.get("/api/shop-info", (req, res) => {
  res.json({
    shopLat: process.env.SHOP_LAT ? parseFloat(process.env.SHOP_LAT) : null,
    shopLng: process.env.SHOP_LNG ? parseFloat(process.env.SHOP_LNG) : null,
    paymentInfo: process.env.BUSINESS_PAYMENT_INFO || "our bank account",
    qrImageUrl: process.env.QR_IMAGE_URL || null,
    liffId: process.env.LIFF_ID || null,
  });
});

// Called when a LIFF customer is outside the free 2km zone. Pings your
// private group and hands back a request id the app polls for the fee.
app.post("/api/request-delivery-fee", express.json(), async (req, res) => {
  const { lineUserId, items, distanceKm, addressNote } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "EMPTY_CART" });
  }

  const lines = [];
  for (const reqItem of items) {
    const dish = MENU.find((d) => d.id === reqItem.itemId);
    if (dish) lines.push(`${reqItem.qty}x ${dish.name}`);
  }

  let displayName = "Customer";
  if (lineUserId) {
    try {
      const profile = await client.getProfile(lineUserId);
      displayName = profile.displayName;
    } catch (e) {
      /* not friends yet or lookup failed -- keep the generic label */
    }
  }

  const requestId = makeRequestId();
  pendingFeeRequests.set(requestId, {
    status: "waiting",
    fee: null,
    createdAt: Date.now(),
  });

  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (target) {
    try {
      await client.pushMessage(target, {
        type: "text",
        text:
          `📍 DELIVERY FEE NEEDED\n` +
          `Customer: ${displayName}\n` +
          `Order: ${lines.join(", ")}\n` +
          `Distance: ${distanceKm ? distanceKm.toFixed(1) + "km" : "unknown"}\n` +
          `${addressNote ? `Notes: ${addressNote}\n` : ""}` +
          `Reply here with just the fee amount (e.g. 50) to confirm it. ` +
          `They're waiting in the app for your reply.`,
      });
    } catch (err) {
      console.error("Failed to push delivery-fee request:", err.message);
    }
  }

  res.json({ requestId });
});

// The LIFF app polls this every few seconds while waiting.
app.get("/api/delivery-fee/:requestId", (req, res) => {
  const entry = pendingFeeRequests.get(req.params.requestId);
  if (!entry) return res.status(404).json({ status: "not_found" });
  res.json({ status: entry.status, fee: entry.fee });
});

app.post("/api/place-order", upload.single("slip"), async (req, res) => {
  let order;
  try {
    order = JSON.parse(req.body.order || "{}");
  } catch (err) {
    return res.status(400).json({ success: false, error: "BAD_REQUEST", message: "Invalid order data." });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: "NO_SLIP", message: "No payment slip was attached." });
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    return res.status(400).json({ success: false, error: "EMPTY_CART", message: "Your cart is empty." });
  }
  if (!order.name || !order.phone) {
    return res.status(400).json({ success: false, error: "MISSING_INFO", message: "Name and phone are required." });
  }

  // Recompute everything server-side from menu.js -- never trust prices
  // or availability sent by the browser.
  const lines = [];
  for (const reqItem of order.items) {
    const dish = MENU.find((d) => d.id === reqItem.itemId);
    if (!dish) {
      return res.status(400).json({ success: false, error: "UNKNOWN_ITEM", message: `Unknown item: ${reqItem.itemId}` });
    }
    if (isUnavailable(dish.id)) {
      return res.status(409).json({ success: false, error: "OUT_OF_STOCK", message: `"${dish.name}" just sold out. Please remove it and try again.` });
    }
    const remaining = remainingStock(dish.id);
    if (remaining !== Infinity && reqItem.qty > remaining) {
      return res.status(409).json({
        success: false,
        error: "OUT_OF_STOCK",
        message: `Only ${remaining} of "${dish.name}" left. Please adjust the quantity and try again.`,
      });
    }
    let price = dish.price;
    let name = dish.name;
    if (reqItem.pastaChoice) {
      const pasta = PASTA_OPTIONS.find((p) => p.id === reqItem.pastaChoice);
      if (pasta) {
        name = `${dish.name} (${pasta.name})`;
        if (dish.requiresPasta) price += pasta.mandatorySurcharge || 0;
      }
    }
    lines.push({ itemId: dish.id, name, price, qty: reqItem.qty, pastaChoice: reqItem.pastaChoice || null });
  }

  const foodTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

  // Never trust a fee number from the browser -- look up what was
  // actually confirmed server-side via the pending request id.
  let deliveryFeeAmount = 0;
  if (order.needsManualFee) {
    const feeEntry = order.feeRequestId ? pendingFeeRequests.get(order.feeRequestId) : null;
    if (!feeEntry || feeEntry.status !== "confirmed") {
      return res.status(409).json({
        success: false,
        error: "FEE_NOT_CONFIRMED",
        message: "Your delivery fee hasn't been confirmed yet. Please go back and wait for confirmation.",
      });
    }
    deliveryFeeAmount = feeEntry.fee;
  }

  const total = foodTotal + deliveryFeeAmount;

  let slipResult;
  try {
    slipResult = await verifySlip(req.file.buffer, total);
  } catch (err) {
    console.error("Thunder API request failed (LIFF order):", err.message);
    await forwardLiffOrderForManualReview(order, lines, total, "Slip check API did not respond.");
    return res.json({
      success: true,
      manualReview: true,
      needsManualFee: order.needsManualFee,
      message: "We couldn't verify your slip automatically, so Merlin's Dish will confirm it directly.",
    });
  }

  if (!slipResult.success) {
    const code = slipResult.error && slipResult.error.code;
    if (code === "SLIP_PENDING") {
      return res.status(409).json({ success: false, error: "SLIP_PENDING", message: "This slip is still processing on the bank's side. Please wait a couple of minutes and try again." });
    }
    if (code === "SLIP_NOT_FOUND" || code === "INVALID_IMAGE_FORMAT") {
      return res.status(409).json({ success: false, error: "SLIP_NOT_FOUND", message: "We couldn't read a slip in that photo. Please make sure the QR code area is clear." });
    }
    await forwardLiffOrderForManualReview(order, lines, total, `Slip check error: ${code || "unknown"}`);
    return res.json({
      success: true,
      manualReview: true,
      needsManualFee: order.needsManualFee,
      message: "We couldn't verify that automatically, so Merlin's Dish will confirm it directly.",
    });
  }

  const slip = slipResult.data;
  if (slip.isDuplicate) {
    return res.status(409).json({ success: false, error: "DUPLICATE_SLIP", message: "This slip has already been used for a previous order." });
  }
  if (slip.isAmountMatched === false) {
    return res.status(409).json({
      success: false,
      error: "AMOUNT_MISMATCH",
      message: `The slip shows ฿${slip.amountInSlip}, but your total is ฿${total}. Please check and try again.`,
    });
  }

  // Verified -- decrement stock, forward to internal group, log, confirm.
  for (const line of lines) {
    if (!stockCount.has(line.itemId)) continue;
    const remaining = stockCount.get(line.itemId) - line.qty;
    stockCount.set(line.itemId, remaining);
    if (remaining <= 0) soldOut.add(line.itemId);
  }

  const slipUrl = await uploadSlipPhoto(req.file.buffer, req.file.mimetype);

  const fullAddress = order.location
    ? await describeLocation(order.location.lat, order.location.lng)
    : order.addressText || "(not provided)";
  const addressWithNote = order.addressNote ? `${fullAddress} -- ${order.addressNote}` : fullAddress;
  const timingLine = order.timing === "SCHEDULED" ? `Scheduled: ${order.scheduleText}` : "Right away";
  const deliveryLine =
    order.needsManualFee === false
      ? `Delivery: FREE (${(order.distanceKm || 0).toFixed(1)}km, within 2km zone)`
      : `Delivery fee: ฿${deliveryFeeAmount}${order.distanceKm ? ` (${order.distanceKm.toFixed(1)}km)` : ""}`;
  const orderText = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");

  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (target) {
    try {
      const messages = [
        {
          type: "text",
          text:
            `🧾 NEW ORDER (via app)\n\n${orderText}\n\nFood total: ฿${foodTotal}\nTiming: ${timingLine}\n${deliveryLine}\nTotal paid: ฿${total}\n\n` +
            `Name: ${order.name}\nAddress: ${addressWithNote}\nPhone: ${order.phone}\n\n` +
            `Paid via: ${order.paymentMethod}\nSlip amount: ฿${slip.amountInSlip}\nSlip ref: ${slip.transRef}`,
        },
      ];
      if (slipUrl) {
        messages.push({ type: "image", originalContentUrl: slipUrl, previewImageUrl: slipUrl });
      }
      await client.pushMessage(target, messages);
    } catch (err) {
      console.error("Failed to push LIFF order to internal target:", err.message);
    }
  }

  await logOrder({
    name: order.name,
    address: addressWithNote,
    phone: order.phone,
    items: lines,
    total,
    slipRef: slip.transRef,
    slipUrl,
  });

  if (order.lineUserId) {
    try {
      await client.pushMessage(order.lineUserId, {
        type: "text",
        text: `All set! Your order is confirmed and on its way to the kitchen. Thank you for ordering from Merlin's Dish! 🍲`,
      });
    } catch (err) {
      console.error("Failed to push confirmation to customer (order still succeeded):", err.message);
    }
  }

  if (order.feeRequestId) {
    pendingFeeRequests.delete(order.feeRequestId);
  }

  res.json({
    success: true,
    total,
    needsManualFee: order.needsManualFee,
    distanceKm: order.distanceKm,
    slipRef: slip.transRef,
  });
});

async function forwardLiffOrderForManualReview(order, lines, total, reason) {
  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (!target) return;
  const body = lines.map((l) => `${l.qty}x ${l.name}`).join(", ");
  try {
    await client.pushMessage(target, {
      type: "text",
      text:
        `⚠️ NEEDS MANUAL SLIP CHECK (via app)\n` +
        `Customer: ${order.name || "unknown"} (${order.phone || "no phone"})\n` +
        `Order: ${body}\n` +
        `Total: ฿${total}\n` +
        `Reason: ${reason}\n` +
        `Please contact them directly to confirm payment.`,
    });
  } catch (err) {
    console.error("Failed to push LIFF manual-review alert:", err.message);
  }
}

// ---------- webhook ----------

app.post("/webhook", line.middleware(config), async (req, res) => {
  res.status(200).end();
  const events = req.body.events || [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("Error handling event:", err);
    }
  }
});

async function handleEvent(event) {
  const userId = event.source && event.source.userId;
  if (!userId) return;

  console.log("Event from source:", JSON.stringify(event.source));

  if (event.type === "follow") {
    return handleFollow(userId, event.replyToken);
  }

  if (event.type === "postback") {
    const data = event.postback.data;
    if (data.startsWith("add:")) return handleAddPrompt(userId, event.replyToken, data.split(":")[1]);
    if (data.startsWith("qty:")) {
      const parts = data.split(":");
      const itemId = parts[1];
      const qtyPart = parts[2];
      return proceedAfterQty(userId, event.replyToken, itemId, parseInt(qtyPart, 10));
    }
    if (data.startsWith("pastafor:")) {
      const parts = data.split(":");
      const itemId = parts[1];
      const pastaId = parts[2];
      return handlePastaChosen(userId, event.replyToken, itemId, pastaId);
    }
    if (data.startsWith("sidepasta:")) return handleSidePasta(userId, event.replyToken, data.split(":")[1]);
    if (data.startsWith("category:")) return showCategoryMenu(userId, event.replyToken, data.split(":")[1]);
    if (data === "reopen_category") {
      const session = getSession(userId);
      if (session.lastCategory) return showCategoryMenu(userId, event.replyToken, session.lastCategory);
      return showMenu(userId, event.replyToken);
    }
    if (data === "show_menu") return showMenu(userId, event.replyToken);
    if (data === "checkout") return handleCheckout(userId, event.replyToken);
    if (data === "clear") return handleClearCart(userId, event.replyToken);
    if (data === "timing:asap") return handleTimingAsap(userId, event.replyToken);
    if (data === "timing:schedule") return handleTimingSchedule(userId, event.replyToken);
    if (data === "confirm_order") return askPaymentMethod(userId, event.replyToken);
    if (data === "edit_order") return showCartReview(userId, event.replyToken);
    if (data.startsWith("remove_line:")) return handleRemoveLine(userId, event.replyToken, data.slice("remove_line:".length));
    if (data === "pay:bank") return handlePayBank(userId, event.replyToken);
    if (data === "pay:qr") return handlePayQr(userId, event.replyToken);
    if (data === "change_address") return handleChangeAddress(userId, event.replyToken);
    if (data === "change_payment") return handleChangePaymentMethod(userId, event.replyToken);
    if (data === "cancel_order_full") return handleCancelOrder(userId, event.replyToken);
    return;
  }

  if (event.type === "message" && event.message.type === "image") {
    const session = getSession(userId);
    if (session.step === "awaiting_slip") {
      return handleSlipImage(userId, event.message.id);
    }
    return;
  }

  if (event.type === "message" && event.message.type === "location") {
    const session = getSession(userId);
    if (session.step === "awaiting_location") {
      return handleLocationShared(userId, event.replyToken, event.message);
    }
    return;
  }

  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    // A bare number typed in your private group is treated as the fee
    // reply for the oldest still-waiting delivery-fee request -- this
    // has to be checked before any customer-facing logic below, and
    // only ever matches messages actually sent in that specific group.
    if (
      event.source.type === "group" &&
      event.source.groupId === process.env.LINE_INTERNAL_TARGET_ID &&
      /^\d+(\.\d+)?$/.test(text)
    ) {
      return handleFeeReply(event.replyToken, parseFloat(text));
    }

    if (process.env.ADMIN_USER_ID && userId === process.env.ADMIN_USER_ID) {
      const handled = await handleAdminCommand(event.replyToken, text);
      if (handled) return;
    }

    const session = getSession(userId);

    const helpTriggers = ["help", "human", "talk to someone", "staff", "คุยกับคน", "สอบถาม", "ติดต่อ"];
    if (helpTriggers.includes(text.toLowerCase())) {
      return handleHumanHandoff(userId, event.replyToken, text);
    }

    const addressChangeTriggers = ["change address", "edit address", "เปลี่ยนที่อยู่", "แก้ที่อยู่"];
    if (addressChangeTriggers.includes(text.toLowerCase())) {
      return handleChangeAddress(userId, event.replyToken);
    }

    const paymentChangeTriggers = ["change payment", "different payment", "เปลี่ยนการชำระเงิน", "เปลี่ยนวิธีชำระเงิน"];
    if (paymentChangeTriggers.includes(text.toLowerCase())) {
      return handleChangePaymentMethod(userId, event.replyToken);
    }

    const cancelTriggers = ["cancel", "cancel order", "ยกเลิก", "ยกเลิกออเดอร์"];
    if (cancelTriggers.includes(text.toLowerCase())) {
      return handleCancelOrder(userId, event.replyToken);
    }

    const menuTriggers = ["menu", "order", "เมนู", "สั่งอาหาร"];
    if (menuTriggers.includes(text.toLowerCase())) {
      return sendOrderAppLink(userId, event.replyToken);
    }

    switch (session.step) {
      case "with_staff":
        // Bot stays quiet here so you can reply personally in the LINE
        // Official Account app without the bot talking over you. Typing
        // "menu" (caught above) is still the way back into ordering.
        return;

      case "awaiting_schedule_text":
        session.scheduleText = text;
        session.step = "awaiting_location";
        return askLocationPrompt(event.replyToken);

      case "awaiting_location": {
        const isMapsLink = /(google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(text);
        if (isMapsLink) {
          return handleGoogleMapsLink(userId, event.replyToken, text);
        }
        // Customer typed an address instead of sharing a location pin or
        // a Maps link. We can't calculate distance from plain text, so
        // flag the fee as manual.
        if (text.length < 5) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "Please share your location (+  > Location), paste a Google Maps link, or type your full address.",
            quickReply: cancelAndEditQuickReply(),
          });
          return;
        }
        session.addressBase = text;
        session.needsManualFee = true;
        session.distanceKm = null;
        session.step = "awaiting_address_note";
        await pingManualFeeNeeded(null);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `Noted -- Merlin's Dish will confirm your delivery fee shortly.\n\n${ADDRESS_NOTE_PROMPT}`,
          quickReply: cancelAndEditQuickReply(),
        });
        return;
      }

      case "awaiting_address_note":
        session.addressNote = text;
        return showFinalSummary(userId, event.replyToken);

      case "awaiting_name_phone": {
        const commaIndex = text.indexOf(",");
        const name = commaIndex === -1 ? "" : text.slice(0, commaIndex).trim();
        const phone = commaIndex === -1 ? "" : text.slice(commaIndex + 1).trim();
        const phoneDigits = phone.replace(/\D/g, "");
        if (name.length < 2 || phoneDigits.length < 8) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text:
              "That didn't quite work. Please send your name and number together, " +
              "separated by a comma (e.g. \"John Doe, 0812345678\").",
          });
          return;
        }
        session.name = name;
        session.phone = phone;
        return finishOrder(userId, event.replyToken, session);
      }

      case "awaiting_slip":
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "Please send a photo of your payment slip to continue.",
          quickReply: paymentAndCancelQuickReply(),
        });
        return;

      default:
        // Not mid-order and not a recognised keyword. Stay quiet rather
        // than hijacking with the menu -- this is likely a genuine
        // question, and Response Method is set to Manual chat so you
        // can reply to it yourself in the LINE Official Account app.
        return;
    }
  }
}

const PORT = process.env.PORT || 3000;
app.get("/health", (req, res) => res.send("Merlin's Dish bot is running."));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
