// ============================================================
// MERLIN'S DISH -- LINE ORDERING BOT
// ============================================================
// Flow:
//   1. Customer is already your LINE friend (nothing to code).
//   2. Rich menu tap -> sends the menu           (showMenu)
//   3. Customer taps items and quantities         (handleAddItem)
//   4. Bot calculates the total                   (handleCheckout)
//   5. Customer transfers and sends a slip photo   (handleSlipImage)
//   6. Bot checks the slip is real and correct     (verifySlip)
//   7. Bot asks name, then delivery location,      (askName/Location/Phone)
//      then phone -- and works out the delivery
//      fee (free under 2km, flagged to you if not)
//   8. Bot sends the full summary to you           (finishOrder)
//
// Admin (you) can text the bot directly from your own LINE account:
//   "stock"              -> lists which items are marked sold out
//   "soldout <item_id>"  -> hides that item from customers
//   "instock <item_id>"  -> brings it back
// Item ids are the short codes in menu.js (e.g. rws_r, bolognese).
//
// You should not need to touch this file for day-to-day changes.
// Prices and dish names live in menu.js instead.
// ============================================================

require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const FormData = require("form-data");
const MENU = require("./menu");
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

// ---------- small helpers ----------

function shortLabel(name) {
  return name.length > 20 ? name.slice(0, 19) + "…" : name;
}

function availableMenu() {
  return MENU.filter((d) => !soldOut.has(d.id));
}

function buildMenuQuickReply() {
  const items = availableMenu().map((dish) => ({
    type: "action",
    action: { type: "postback", label: shortLabel(dish.name), data: `add:${dish.id}` },
  }));
  items.push({
    type: "action",
    action: { type: "postback", label: "✅ Checkout", data: "checkout" },
  });
  items.push({
    type: "action",
    action: { type: "postback", label: "🗑 Clear cart", data: "clear" },
  });
  return { items };
}

function cartLines(cart) {
  return Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const dish = MENU.find((d) => d.id === id);
      return { id, name: dish.name, price: dish.price, qty };
    });
}

function cartTotal(cart) {
  return cartLines(cart).reduce((sum, l) => sum + l.price * l.qty, 0);
}

function cartSummaryText(cart) {
  const lines = cartLines(cart);
  if (lines.length === 0) return "Your cart is empty. Tap a dish below to add it.";
  const body = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");
  return `Your order so far:\n${body}\n\nTotal: ฿${cartTotal(cart)}\n\nTap more dishes, or Checkout when ready.`;
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

// ---------- reply senders ----------

async function showMenu(userId, replyToken) {
  const session = getSession(userId);
  session.step = "ordering";
  await client.replyMessage(replyToken, {
    type: "text",
    text: cartSummaryText(session.cart),
    quickReply: buildMenuQuickReply(),
  });
}

async function handleAddItem(userId, replyToken, itemId) {
  const session = getSession(userId);
  if (soldOut.has(itemId)) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "Sorry, that one's sold out today!",
      quickReply: buildMenuQuickReply(),
    });
    return;
  }
  if (session.step !== "ordering") session.step = "ordering";
  session.cart[itemId] = (session.cart[itemId] || 0) + 1;
  await client.replyMessage(replyToken, {
    type: "text",
    text: cartSummaryText(session.cart),
    quickReply: buildMenuQuickReply(),
  });
}

async function handleClearCart(userId, replyToken) {
  const session = getSession(userId);
  session.cart = {};
  await client.replyMessage(replyToken, {
    type: "text",
    text: "Cart cleared. " + cartSummaryText(session.cart),
    quickReply: buildMenuQuickReply(),
  });
}

async function handleCheckout(userId, replyToken) {
  const session = getSession(userId);
  const lines = cartLines(session.cart);
  if (lines.length === 0) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "Your cart is empty -- add a dish first.",
      quickReply: buildMenuQuickReply(),
    });
    return;
  }
  session.step = "confirming";
  const body = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");
  const total = cartTotal(session.cart);
  await client.replyMessage(replyToken, {
    type: "text",
    text: `Please confirm your order:\n${body}\n\nTotal: ฿${total}`,
    quickReply: {
      items: [
        { type: "action", action: { type: "postback", label: "✅ Confirm", data: "confirm_order" } },
        { type: "action", action: { type: "postback", label: "✏️ Edit order", data: "back_to_menu" } },
      ],
    },
  });
}

async function handleConfirmOrder(userId, replyToken) {
  const session = getSession(userId);
  const total = cartTotal(session.cart);
  session.step = "awaiting_slip";
  const paymentInfo = process.env.BUSINESS_PAYMENT_INFO || "our PromptPay QR";
  await client.replyMessage(replyToken, {
    type: "text",
    text:
      `Total to pay: ฿${total}\n\n` +
      `Please transfer to ${paymentInfo}, then send a photo of your payment slip here.`,
  });
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

async function handleSlipImage(userId, replyToken, messageId) {
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

  // From here on, every response uses pushMessage instead of replyMessage.
  // This step calls an external API and can take a few seconds -- long
  // enough for LINE's reply token to expire. Push messages have no such
  // expiry, so the customer reliably gets a response either way.

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
  resetSession(userId);
}

// ---------- delivery location & fee ----------

async function askLocation(userId, replyToken, name) {
  getSession(userId).step = "awaiting_location";
  await client.replyMessage(replyToken, {
    type: "text",
    text:
      `Thanks, ${name}! Please share your delivery location so we can work out the fee:\n` +
      `Tap the "+" icon > Location > choose your drop-off point.\n\n` +
      `(If that's not easy, you can just type your address instead.)`,
  });
}

async function handleLocationShared(userId, replyToken, message) {
  const session = getSession(userId);
  const shopLat = parseFloat(process.env.SHOP_LAT);
  const shopLng = parseFloat(process.env.SHOP_LNG);

  const label = message.address || message.title || "";
  session.addressBase = label;
  session.locationText = `${label} (lat ${message.latitude}, lng ${message.longitude})`;

  if (isNaN(shopLat) || isNaN(shopLng)) {
    // Shop coordinates not configured yet -- can't calculate, flag manual.
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
      const target = process.env.LINE_INTERNAL_TARGET_ID;
      if (target) {
        await client.pushMessage(target, {
          type: "text",
          text:
            `📍 DELIVERY FEE NEEDED\n` +
            `Customer is ${d.toFixed(1)}km away (outside the free 2km zone).\n` +
            `Their order is still coming in -- please work out the fee and message ` +
            `them directly once it lands in this group.`,
        });
      }
    }
  }

  session.step = "awaiting_address_note";
  const feeMsg =
    session.needsManualFee === false
      ? "You're within our free delivery zone! 🎉"
      : "Noted -- Merlin's Dish will confirm your delivery fee shortly.";
  await client.replyMessage(replyToken, {
    type: "text",
    text: `${feeMsg}\n\nAny extra details for the rider? (unit/floor number, landmark, etc. -- or just send "-" if none)`,
  });
}

async function askPhone(replyToken) {
  await client.replyMessage(replyToken, {
    type: "text",
    text: "And a contact number for the delivery?",
  });
}

async function finishOrder(userId, replyToken, session) {
  const lines = cartLines(session.cart);
  const total = cartTotal(session.cart);
  const orderText = lines.map((l) => `${l.qty}x ${l.name} — ฿${l.price * l.qty}`).join("\n");

  const fullAddress = session.addressBase
    ? `${session.addressBase}${session.addressNote && session.addressNote !== "-" ? " -- " + session.addressNote : ""}`
    : session.address || "(not provided)";

  const deliveryLine =
    session.needsManualFee === false
      ? `Delivery: FREE (${session.distanceKm.toFixed(1)}km, within 2km zone)`
      : session.distanceKm != null
      ? `Delivery fee: TO BE CONFIRMED (${session.distanceKm.toFixed(1)}km, outside free zone)`
      : `Delivery fee: TO BE CONFIRMED (typed address, distance not calculated)`;

  const target = process.env.LINE_INTERNAL_TARGET_ID;
  if (target) {
    await client.pushMessage(target, {
      type: "text",
      text:
        `🧾 NEW ORDER\n\n${orderText}\n\nFood total: ฿${total}\n${deliveryLine}\n\n` +
        `Name: ${session.name}\nAddress: ${fullAddress}\nPhone: ${session.phone}\n\n` +
        `Slip amount: ฿${session.slipAmount}\nSlip ref: ${session.slipRef}`,
    });
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

  await client.replyMessage(replyToken, {
    type: "text",
    text: `All set! Your order is confirmed and on its way to the kitchen. ${customerDeliveryLine} Thank you for ordering from Merlin's Dish! 🍲`,
  });

  resetSession(userId);
}

// ---------- admin commands (you only) ----------

async function handleAdminCommand(replyToken, text) {
  const lower = text.toLowerCase().trim();

  if (lower === "stock") {
    const body = MENU.map((d) => `${soldOut.has(d.id) ? "❌" : "✅"} ${d.id} -- ${d.name}`).join("\n");
    await client.replyMessage(replyToken, { type: "text", text: `Stock status:\n${body}` });
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
    await client.replyMessage(replyToken, { type: "text", text: `"${id}" is back in stock.` });
    return true;
  }
  return false;
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

  if (event.type === "postback") {
    const data = event.postback.data;
    if (data.startsWith("add:")) return handleAddItem(userId, event.replyToken, data.split(":")[1]);
    if (data === "clear") return handleClearCart(userId, event.replyToken);
    if (data === "checkout") return handleCheckout(userId, event.replyToken);
    if (data === "confirm_order") return handleConfirmOrder(userId, event.replyToken);
    if (data === "back_to_menu") return showMenu(userId, event.replyToken);
    return;
  }

  if (event.type === "message" && event.message.type === "image") {
    const session = getSession(userId);
    if (session.step === "awaiting_slip") {
      return handleSlipImage(userId, event.replyToken, event.message.id);
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

    // Admin-only commands, only from your own LINE account.
    if (process.env.ADMIN_USER_ID && userId === process.env.ADMIN_USER_ID) {
      const handled = await handleAdminCommand(event.replyToken, text);
      if (handled) return;
    }

    const session = getSession(userId);

    const menuTriggers = ["menu", "order", "เมนู", "สั่งอาหาร"];
    if (menuTriggers.includes(text.toLowerCase())) {
      return showMenu(userId, event.replyToken);
    }

    switch (session.step) {
      case "awaiting_name":
        if (text.length < 2) {
          await client.replyMessage(event.replyToken, { type: "text", text: "Please send your name." });
          return;
        }
        session.name = text;
        return askLocation(userId, event.replyToken, text);

      case "awaiting_location":
        // Customer typed an address instead of sharing a location pin.
        // We can't calculate distance from text, so flag the fee as manual.
        if (text.length < 5) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "Please share your location (+  > Location), or type your full address.",
          });
          return;
        }
        session.addressBase = text;
        session.needsManualFee = true;
        session.distanceKm = null;
        session.step = "awaiting_phone";
        {
          const target = process.env.LINE_INTERNAL_TARGET_ID;
          if (target) {
            await client.pushMessage(target, {
              type: "text",
              text:
                `📍 DELIVERY FEE NEEDED\nCustomer typed their address instead of sharing a pin, ` +
                `so distance couldn't be calculated. Please confirm the delivery fee once their order lands.`,
            });
          }
        }
        return askPhone(event.replyToken);

      case "awaiting_address_note":
        session.addressNote = text;
        session.step = "awaiting_phone";
        return askPhone(event.replyToken);

      case "awaiting_phone":
        if (text.length < 8) {
          await client.replyMessage(event.replyToken, { type: "text", text: "Please send a valid contact number." });
          return;
        }
        session.phone = text;
        return finishOrder(userId, event.replyToken, session);

      case "awaiting_slip":
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "Please send a photo of your payment slip to continue.",
        });
        return;

      default:
        return showMenu(userId, event.replyToken);
    }
  }
}

const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Merlin's Dish bot is running."));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
