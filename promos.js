// ============================================================
// MERLIN'S DISH -- PROMOTIONS CONFIG
// ============================================================
// This file holds the CURRENT promo state. It's edited two ways:
//   1. By hand here, for a promo you want live from the next deploy.
//   2. At runtime, by texting admin commands into the private LINE
//      group (see handlePromoCommand in server.js) -- those changes
//      take effect immediately with no redeploy, but are IN-MEMORY
//      ONLY and reset if the server restarts. If a promo absolutely
//      must survive a restart, also hand-edit the defaults below.
//
// ---- THE ONE RULE ----
// Every menu item gets AT MOST ONE discount. If an item has its own
// item-specific promo, that one applies and the storewide promo is
// ignored for that item. If an item has no item-specific promo, the
// storewide promo (if active) applies instead. Discounts never stack.
//
// ---- STOREWIDE PROMO ----
// One at a time. percentOff applies to every item's price that does
// NOT have its own itemPromos entry, food and drinks alike -- never
// the delivery fee. Set active:false (or clear it) to turn it off
// without deleting the record of it.
let storewidePromo = {
  active: true,
  label: "Launch Campaign",
  percentOff: 10,
  startDate: "2026-09-14", // YYYY-MM-DD, Bangkok time, inclusive
  endDate: "2026-09-30", // YYYY-MM-DD, Bangkok time, inclusive
};

// ---- ITEM-SPECIFIC PROMOS ----
// Keyed by the item's MENU id (see menu.js). Each entry looks like
// { percentOff, startDate, endDate, label }. An item with an entry
// here ALWAYS uses this instead of the storewide promo, even if this
// item's promo has a lower percentOff or has expired (an expired
// item promo simply means no discount for that item, the storewide
// promo does not "fall through" to it). Empty for now -- add entries
// the same way storewidePromo is shaped, e.g.:
//   bolognese: { active: true, label: "Bolognese 20% off", percentOff: 20, startDate: "2026-09-14", endDate: "2026-09-30" },
let itemPromos = {};

function bangkokDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function bangkokTodayStr() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return bangkokDateStr(now);
}

function isPromoLiveToday(promo) {
  if (!promo || !promo.active) return false;
  const today = bangkokTodayStr();
  if (promo.startDate && today < promo.startDate) return false;
  if (promo.endDate && today > promo.endDate) return false;
  return true;
}

// The single function both the LIFF app's price display and the
// server's /api/place-order charge calculation should call for any
// given item id. Returns { percentOff, label, isItemSpecific } if a
// promo applies today, or null if the item is at full price right now.
// isItemSpecific distinguishes a per-item promo (e.g. "Bolognese 20%
// off") from the storewide one -- the LIFF app uses this to decide
// whether to show a per-item discount badge: item-specific promos get
// one, the storewide promo never does (it's only surfaced as a single
// line at checkout, not advertised item by item on the menu).
function activePromoForItem(itemId) {
  const itemPromo = itemPromos[itemId];
  if (itemPromo) {
    return isPromoLiveToday(itemPromo) ? { percentOff: itemPromo.percentOff, label: itemPromo.label, isItemSpecific: true } : null;
  }
  return isPromoLiveToday(storewidePromo) ? { percentOff: storewidePromo.percentOff, label: storewidePromo.label, isItemSpecific: false } : null;
}

// Applies activePromoForItem() to a price, rounding to the nearest
// Baht (banker's rounding isn't worth the complexity here -- normal
// round-half-up matches how prices are shown elsewhere in the app).
function discountedPrice(itemId, price) {
  const promo = activePromoForItem(itemId);
  if (!promo) return price;
  return Math.round(price * (1 - promo.percentOff / 100));
}

function getStorewidePromo() {
  return storewidePromo;
}

function setStorewidePromo(promo) {
  storewidePromo = promo;
}

function getItemPromos() {
  return itemPromos;
}

function setItemPromo(itemId, promo) {
  itemPromos[itemId] = promo;
}

function clearItemPromo(itemId) {
  delete itemPromos[itemId];
}

module.exports = {
  activePromoForItem,
  discountedPrice,
  isPromoLiveToday,
  getStorewidePromo,
  setStorewidePromo,
  getItemPromos,
  setItemPromo,
  clearItemPromo,
  bangkokTodayStr,
};
