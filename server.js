// ============================================================
// MERLIN'S DISH -- LINE ORDERING BOT
// ============================================================
// Flow, in order:
//   1. Customer is already your LINE friend (nothing to code).
//   2. Rich menu tap / "menu" -> Flex carousel of dishes  (showMenu)
//   3. Tap a dish -> bot asks quantity                      (handleAddPrompt / handleSetQty)
//   4. Checkout -> asks Right away or Scheduled             (handleCheckout / handleTiming*)
//   5. Bot asks for delivery location                       (askLocationPrompt / handleLocationShared)
//      -- free under 2km, else flags your group immediately
//   6. Bot shows the full total (food + delivery note)       (showFinalSummary)
//   7. Customer picks Bank Transfer or QR code               (handlePayBank / handlePayQr)
//   8. Customer sends a slip photo                           (handleSlipImage)
//   9. Bot checks the slip is real and correct                (verifySlip)
//  10. Bot asks name, then phone                              (askName -> askPhone)
//  11. Bot sends the full summary to you                      (finishOrder)
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
// Bolognese and Ragu require a pasta choice before they're added to the
// cart (no extra charge). Any "mains" dish (a stew) gets offered pasta as
// a paid side add-on right after it's added. Both use the PASTA_OPTIONS
// list in menu.js.
//
// A customer can type "change address" (or the Thai equivalent) at any
// point after giving their delivery location to redo just that step,
// without losing their cart or anything else already collected.
//
// You should not need to touch this file for day-to-day changes.
// Prices, dish names, categories, and dish images live in menu.js instead.
// ============================================================

require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const FormData = require("form-data");
const { MENU, CATEGORIES, PASTA_OPTIONS, SIDE_PASTA_PRICE } = require("./menu");
const { logOrder } = require("./sheetLogger");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();

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
        return { id: lineId, name: `Side Pasta -- ${pasta ? pasta.name : entry.pastaChoice}`, price: SIDE_PASTA_PRICE, qty: entry.qty };
      }
      const dish = MENU.find((d) => d.id === entry.itemId);
      const pasta = entry.pastaChoice ? PASTA_OPTIONS.find((p) => p.id === entry.pastaChoice) : null;
      const name = pasta ? `${dish.name} (${pasta.name})` : dish.name;
      return { id: lineId, name, price: dish.price, qty: entry.qty };
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

// ---------- menu display (categories + Flex carousel) ----------

function availableInCategory(catId) {
  return MENU.filter((d) => d.category === catId && !isUnavailable(d.id));
}

function buildPastaFlex(mode, itemId) {
  // mode is "pastafor" (mandatory choice tied to a specific dish) or
  // "sidepasta" (optional add-on, includes a "No thanks" card at the end).
  const bubbles = PASTA_OPTIONS.map((p) => {
    const data = mode === "pastafor" ? `pastafor:${itemId}:${p.id}` : `sidepasta:${p.id}`;
    const bubble = {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: p.name, weight: "bold", size: "md", wrap: true }],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", color: "#E8302A", action: { type: "postback", label: "Choose", data } },
        ],
      },
    };
    if (p.image) {
      bubble.hero = { type: "image", url: p.image, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
    }
    return bubble;
  });

  if (mode === "sidepasta") {
    bubbles.push({
      type: "bubble",
      size: "kilo",
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
        aspectRatio: "20:13",
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
  items.push({ type: "action", action: { type: "postback", label: "4+", data: `qty:${itemId}:more` } });
  return cancelOnlyQuickReply(items);
}

function cartActionsQuickReply() {
  return {
    items: [
      { type: "action", action: { type: "postback", label: "➕ Add more", data: "reopen_category" } },
      { type: "action", action: { type: "postback", label: "✅ Checkout", data: "checkout" } },
      { type: "action", action: { type: "postback", label: "🗑 Clear cart", data: "clear" } },
      { type: "action", action: { type: "postback", label: "❌ Cancel order", data: "cancel_order_full" } },
    ],
  };
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
    quickReply: categoryQuickReply(),
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
  await client.replyMessage(replyToken, {
    type: "text",
    text: `How many "${dish.name}" would you like?`,
    quickReply: qtyQuickReply(itemId),
  });
}

// Called once a quantity has been picked, whichever way (quick-reply
// number, "6+" custom text, or a pasta choice for a bundled dish).
// Handles the stock check, then branches: Bolognese/Ragu need a pasta
// choice before they can be added; everything else adds straight away,
// and a "mains" dish (a stew) gets offered pasta as a side add-on after.
async function proceedAfterQty(userId, replyToken, itemId, qty) {
  const dish = MENU.find((d) => d.id === itemId);
  if (dish.requiresPasta) {
    const session = getSession(userId);
    session.pendingItemId = itemId;
    session.pendingQty = qty;
    await client.replyMessage(replyToken, [
      { type: "text", text: `Which pasta would you like with your "${dish.name}"?` },
      { ...buildPastaFlex("pastafor", itemId), quickReply: cancelOnlyQuickReply() },
    ]);
    return;
  }
  await addToCart(userId, replyToken, itemId, qty, null, dish.category === "mains");
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
      { type: "text", text: `${cartSummaryText(session.cart)}\n\nWould you like to add pasta on the side? (+฿${SIDE_PASTA_PRICE})` },
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

async function handleAskCustomQty(userId, replyToken, itemId) {
  const session = getSession(userId);
  session.pendingItemId = itemId;
  session.step = "awaiting_custom_qty";
  await client.replyMessage(replyToken, {
    type: "text",
    text: "Please type how many you'd like (just the number).",
    quickReply: cancelOnlyQuickReply(),
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
    quickReply: cancelOnlyQuickReply([
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
    quickReply: cancelOnlyQuickReply(),
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
    quickReply: cancelOnlyQuickReply(),
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

async function handleGoogleMapsLink(userId, replyToken, url) {
  const session = getSession(userId);
  let coords = null;
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
    console.log(
      `Maps link fetch: status=${response.status} finalUrl=${finalUrl} contentType=${response.headers["content-type"]}`
    );
    if (typeof response.data === "string") {
      console.log(`Maps link body snippet (first 800 chars): ${response.data.slice(0, 800)}`);
    } else {
      console.log(`Maps link body was not a string (type: ${typeof response.data})`);
    }
    coords = extractLatLngFromGoogleMapsUrl(finalUrl);

    if (!coords && typeof response.data === "string") {
      const body = response.data;
      const embeddedUrlMatch = body.match(/https:\/\/www\.google\.com\/maps[^\s"'<>\\]+/);
      if (embeddedUrlMatch) {
        coords = extractLatLngFromGoogleMapsUrl(decodeURIComponent(embeddedUrlMatch[0]));
      }
      if (!coords) {
        coords = extractLatLngFromGoogleMapsUrl(body);
      }
    }
  } catch (err) {
    console.error("Failed to resolve Google Maps link:", err.message);
  }

  if (!coords) {
    console.warn(`Could not extract coordinates from Google Maps link: ${url}`);
    session.addressBase = url;
    session.needsManualFee = true;
    session.distanceKm = null;
    session.step = "awaiting_address_note";
    await pingManualFeeNeeded(null);
    await client.replyMessage(replyToken, {
      type: "text",
      text: `We couldn't read the location from that link, so Merlin's Dish will confirm your delivery fee shortly.\n\n${ADDRESS_NOTE_PROMPT}`,
      quickReply: cancelOnlyQuickReply(),
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
    quickReply: cancelOnlyQuickReply(),
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
      { type: "action", action: { type: "postback", label: "🔁 Change payment method", data: "change_payment" } },
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
  session.step = "awaiting_name";
  await client.pushMessage(userId, {
    type: "text",
    text: "Payment verified! ✅ What name should we put on the order?",
    quickReply: cancelOnlyQuickReply(),
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

async function askName(replyToken) {
  await client.replyMessage(replyToken, {
    type: "text",
    text: "What name should we put on the order?",
    quickReply: cancelOnlyQuickReply(),
  });
}

async function askPhone(replyToken) {
  await client.replyMessage(replyToken, {
    type: "text",
    text: "And a contact number for the delivery?",
    quickReply: cancelOnlyQuickReply(),
  });
}

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
      await client.pushMessage(target, {
        type: "text",
        text:
          `🧾 NEW ORDER\n\n${orderText}\n\nFood total: ฿${total}\nTiming: ${timingLine}\n${deliveryLine}\n\n` +
          `Name: ${session.name}\nAddress: ${fullAddress}\nPhone: ${session.phone}\n\n` +
          `Paid via: ${session.paymentMethod || "unknown"}\n` +
          `Slip amount: ฿${session.slipAmount}\nSlip ref: ${session.slipRef}`,
      });
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

async function handleFollow(userId, replyToken) {
  await client.replyMessage(replyToken, {
    type: "text",
    text:
      `Hi, welcome to Merlin's Dish! 🍲\n\n` +
      `Ready to order? Just type "menu" anytime.\n` +
      `Got a question instead? Feel free to just ask, we're happy to help, ` +
      `this isn't only for ordering!`,
  });
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
      if (qtyPart === "more") return handleAskCustomQty(userId, event.replyToken, itemId);
      return proceedAfterQty(userId, event.replyToken, itemId, parseInt(qtyPart, 10));
    }
    if (data.startsWith("pastafor:")) {
      const parts = data.split(":");
      const itemId = parts[1];
      const pastaId = parts[2];
      const session = getSession(userId);
      const qty = session.pendingQty || 1;
      const dish = MENU.find((d) => d.id === itemId);
      return addToCart(userId, event.replyToken, itemId, qty, pastaId, dish.category === "mains");
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
    if (data === "edit_order") return showMenu(userId, event.replyToken);
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
      return showMenu(userId, event.replyToken);
    }

    switch (session.step) {
      case "with_staff":
        // Bot stays quiet here so you can reply personally in the LINE
        // Official Account app without the bot talking over you. Typing
        // "menu" (caught above) is still the way back into ordering.
        return;

      case "awaiting_custom_qty": {
        const n = parseInt(text, 10);
        if (isNaN(n) || n < 1) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "Please send just a number, like 3.",
            quickReply: cancelOnlyQuickReply(),
          });
          return;
        }
        return proceedAfterQty(userId, event.replyToken, session.pendingItemId, n);
      }

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
            quickReply: cancelOnlyQuickReply(),
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
          quickReply: cancelOnlyQuickReply(),
        });
        return;
      }

      case "awaiting_address_note":
        session.addressNote = text;
        return showFinalSummary(userId, event.replyToken);

      case "awaiting_name":
        if (text.length < 2) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "Please send your name.",
            quickReply: cancelOnlyQuickReply(),
          });
          return;
        }
        session.name = text;
        session.step = "awaiting_phone";
        return askPhone(event.replyToken);

      case "awaiting_phone":
        if (text.length < 8) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "Please send a valid contact number.",
            quickReply: cancelOnlyQuickReply(),
          });
          return;
        }
        session.phone = text;
        return finishOrder(userId, event.replyToken, session);

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
app.get("/", (req, res) => res.send("Merlin's Dish bot is running."));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
