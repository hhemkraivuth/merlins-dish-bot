// ============================================================
// Customer loyalty tracking -- reads/writes two tabs in the same
// "Bot Activity" Google Sheet used by sheetLogger.js.
//
// THE LADDER (not two independent trackers -- one running count
// that can reset):
//   Order Count climbs from 0 with every completed checkout.
//   From order 5 up to order 9, the customer may redeem the
//     5-point reward. Redeeming it resets Order Count to 0.
//   At order 10, if they never redeemed the 5-point reward along
//     the way, they get the 10-point reward instead, and Order
//     Count resets to 0.
//   Max 1 redemption per checkout, either tier.
//
// "Customers" tab columns (plain values only, NO formulas -- a
// formula can't reset itself, so this whole tab is bot-written):
//   A Phone | B Customer Name | C Order Count | D Last Order Date
//   | E LINE User ID
//
// "Reward Config" tab -- lets Lily change what the 5pt/10pt reward
// actually is without touching code, either by editing the sheet
// directly or via a natural-language command in the private LINE
// group (see parseRewardChangeCommand below). Two rows:
//   Row 2 (tier 5):  Tier | Item Name | Menu Item Id | Max Value (THB)
//   Row 3 (tier 10): ...same columns
// Menu Item Id is used when the reward is one fixed dish (e.g.
// Bacon Steak). Max Value is used when the reward is "any dish up
// to X baht" (the original ">฿200 free meal" idea) -- leave
// whichever doesn't apply blank.
// ============================================================

const { google } = require("googleapis");

const TIER_LOW = 5;
const TIER_HIGH = 10;

const hasSheetCreds =
  !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  !!process.env.GOOGLE_PRIVATE_KEY &&
  !!process.env.GOOGLE_SHEET_ID;

let sheetsClient = null;

function getClient() {
  if (!hasSheetCreds) return null;
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// Normalises any phone input to a consistent text format: digits only,
// forced to start with a single leading 0, no spaces/dashes/country code.
// "081 565 6584", "+66815656584", "815656584" all become "0815656584".
// Returns null if there aren't enough digits to be a real phone number.
function normalisePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length === 11) {
    digits = "0" + digits.slice(2); // strip Thai country code
  }
  if (!digits.startsWith("0")) {
    digits = "0" + digits;
  }
  if (digits.length < 9 || digits.length > 10) return null;
  return digits;
}

// ---------- Customers tab ----------

let customerCache = null;
let customerCacheAt = 0;
const CACHE_TTL_MS = 30 * 1000;

async function loadAllCustomers() {
  const client = getClient();
  if (!client) return [];
  const now = Date.now();
  if (customerCache && now - customerCacheAt < CACHE_TTL_MS) return customerCache;

  const res = await client.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Customers!A2:E",
  });
  customerCache = res.data.values || [];
  customerCacheAt = now;
  return customerCache;
}

function invalidateCustomerCache() {
  customerCache = null;
}

// Looks up a customer by phone. Returns null if sheets isn't configured.
// If not found yet, returns a zeroed record with found:false so the
// caller can tell "brand new customer" from "lookup failed".
async function getCustomer(rawPhone) {
  const phone = normalisePhone(rawPhone);
  if (!phone) return null;
  const client = getClient();
  if (!client) return null;

  try {
    const rows = await loadAllCustomers();
    const rowIndex = rows.findIndex((r) => normalisePhone(r[0]) === phone);
    if (rowIndex === -1) {
      return { phone, name: "", orderCount: 0, found: false, rowIndex: -1, ...tierEligibility(0) };
    }
    const row = rows[rowIndex];
    const orderCount = Number(row[2]) || 0;
    return {
      phone,
      name: row[1] || "",
      orderCount,
      found: true,
      rowIndex, // 0-based within the A2:E range -- sheet row is rowIndex + 2
      ...tierEligibility(orderCount),
    };
  } catch (err) {
    console.error("Customer lookup failed:", err.message);
    return null;
  }
}

// What can this order count redeem? Tier 5 stays available all the way
// through order 9 if they haven't cashed it in yet; tier 10 is exact.
function tierEligibility(orderCount) {
  return {
    canRedeemLow: orderCount >= TIER_LOW && orderCount < TIER_HIGH,
    canRedeemHigh: orderCount >= TIER_HIGH,
    ordersToLow: Math.max(0, TIER_LOW - orderCount),
    ordersToHigh: Math.max(0, TIER_HIGH - orderCount),
  };
}

// Call once per completed checkout, after payment is verified.
// redeemedTier: null | 5 | 10 -- which reward (if any) this order used.
// Returns { orderCount, resetHappened } where orderCount is the NEW
// count after this order (post-reset if a redemption happened), or
// null if sheets isn't configured / the write failed.
async function recordOrder({ phone: rawPhone, name, lineUserId, redeemedTier }) {
  const phone = normalisePhone(rawPhone);
  const client = getClient();
  if (!client || !phone) return null;

  try {
    const existing = await getCustomer(phone);
    const now = new Date().toLocaleDateString("en-GB");

    const priorCount = existing && existing.found ? existing.orderCount : 0;
    let newOrderCount = priorCount + 1;
    if (redeemedTier === TIER_LOW || redeemedTier === TIER_HIGH) {
      newOrderCount = 0; // reset the ladder on any redemption
    }

    if (!existing || !existing.found) {
      const row = [phone, name || "", newOrderCount, now, lineUserId || ""];
      await client.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "Customers!A:E",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
      invalidateCustomerCache();
      return { orderCount: newOrderCount, resetHappened: newOrderCount === 0 };
    }

    const sheetRow = existing.rowIndex + 2; // +2: 1-based, plus header row
    await client.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Customers!A${sheetRow}:E${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[phone, name || existing.name, newOrderCount, now, lineUserId || ""]] },
    });
    invalidateCustomerCache();
    return { orderCount: newOrderCount, resetHappened: newOrderCount === 0 && priorCount !== 0 };
  } catch (err) {
    console.error("Customer record update failed (order still went through):", err.message);
    return null;
  }
}

// ---------- Reward Config tab ----------

let rewardCache = null;
let rewardCacheAt = 0;

// Returns { low: {itemName, menuItemId}, high: {dishChoices: [{id, name}]} }.
// Tier 5 is always a single fixed dish. Tier 10 is a short list the
// customer picks from at checkout -- falls back to Bacon Steak / a
// Bolognese+Chicken Soup pick-list if the tab is missing or a row is
// blank, so the bot never crashes just because the sheet isn't set up.
async function getRewardConfig(menu) {
  const fallbackLow = { itemName: "Bacon Steak", menuItemId: "bacon_steak" };
  const fallbackHighIds = ["bolognese", "chicken_soup"];
  const buildFallback = () => ({
    low: fallbackLow,
    high: { dishChoices: fallbackHighIds.map((id) => resolveMenuName(id, menu)) },
  });

  const client = getClient();
  if (!client) return buildFallback();

  const now = Date.now();
  if (rewardCache && now - rewardCacheAt < CACHE_TTL_MS) return rewardCache;

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Reward Config!A2:D3",
    });
    const rows = res.data.values || [];
    const lowRow = rows.find((r) => String(r[0]).trim() === String(TIER_LOW));
    const highRow = rows.find((r) => String(r[0]).trim() === String(TIER_HIGH));

    const low = lowRow
      ? { itemName: lowRow[1] || fallbackLow.itemName, menuItemId: lowRow[2] || fallbackLow.menuItemId }
      : fallbackLow;

    const highIds = highRow && highRow[3]
      ? highRow[3].split(",").map((s) => s.trim()).filter(Boolean)
      : fallbackHighIds;
    const high = { dishChoices: highIds.map((id) => resolveMenuName(id, menu)) };

    rewardCache = { low, high };
    rewardCacheAt = now;
    return rewardCache;
  } catch (err) {
    console.error("Reward config lookup failed, using fallback:", err.message);
    return buildFallback();
  }
}

// Turns a menu id into {id, name} for the frontend dropdown, falling
// back to the raw id as the name if the dish isn't found (shouldn't
// happen, but keeps this from ever throwing).
function resolveMenuName(id, menu) {
  const dish = menu && menu.find((d) => d.id === id);
  return { id, name: dish ? dish.name : id };
}

function invalidateRewardCache() {
  rewardCache = null;
}

// Writes a new reward for tier 5 (a single menu.js dish object, {id, name})
// or tier 10 (an array of menu.js dish objects, the pick-list).
async function setRewardConfig(tier, itemOrList) {
  const client = getClient();
  if (!client) return false;
  const rowNum = tier === TIER_LOW ? 2 : 3;

  const values =
    tier === TIER_LOW
      ? [tier, itemOrList.name, itemOrList.id, ""]
      : [tier, "", "", itemOrList.map((d) => d.id).join(",")];

  try {
    await client.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Reward Config!A${rowNum}:D${rowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    invalidateRewardCache();
    return true;
  } catch (err) {
    console.error("Reward config write failed:", err.message);
    return false;
  }
}

// ---------- Natural-language reward-change command ----------
// Matches things like:
//   "change the 5 point reward to bacon steak"          -> tier 5, single dish
//   "set 10pt reward to bolognese and chicken soup"      -> tier 10, dish list
//   "make the 5-point prize the mushroom soup"           -> tier 5, single dish
//   "10 point reward should be tuscan pork braise, ragu" -> tier 10, dish list
// Returns { tier, item } for tier 5 (item is a single dish), or
// { tier, items } for tier 10 (items is an array of dishes), or null if
// this message wasn't a reward-change command at all (so the caller can
// ignore it and fall through to normal handling). If a name couldn't be
// matched to any menu item, returns { tier, unmatchedName } instead so
// the caller can report it rather than silently doing nothing.
function parseRewardChangeCommand(text, menu) {
  const lower = text.toLowerCase();

  const tierMatch = lower.match(/\b(5|10)[\s-]?(?:pt|point|points)\b/);
  if (!tierMatch) return null;
  const tier = tierMatch[1] === "5" ? TIER_LOW : TIER_HIGH;

  const hasChangeVerb = /\b(change|set|make|update)\b/.test(lower);
  const hasRewardNoun = /\b(reward|prize|gift)\b/.test(lower);
  if (!hasChangeVerb && !hasRewardNoun) return null;

  // Take whatever comes after "to" / "is" / "should be" as the dish
  // name(s), splitting on "and" / "," for tier 10's multi-dish list.
  const nameMatch = lower.match(/(?:\bto\b|\bis\b|\bshould be\b)\s+(?:the\s+)?([a-z0-9\s,]+)$/);
  if (!nameMatch) return null;
  const spoken = nameMatch[1].trim();
  if (!spoken) return null;

  if (tier === TIER_LOW) {
    const dish = fuzzyMatchMenuItem(spoken, menu);
    if (!dish) return { tier, unmatchedName: spoken };
    return { tier, item: dish };
  }

  // Tier 10: split on "and"/"," into separate dish names, match each one.
  const spokenNames = spoken.split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
  const dishes = [];
  for (const name of spokenNames) {
    const dish = fuzzyMatchMenuItem(name, menu);
    if (!dish) return { tier, unmatchedName: name };
    dishes.push(dish);
  }
  if (dishes.length === 0) return null;
  return { tier, items: dishes };
}

// Simple, dependency-free fuzzy match: exact name match first, then
// "every word the customer typed appears somewhere in the dish name",
// then falls back to the dish whose name shares the most words.
function fuzzyMatchMenuItem(spoken, menu) {
  const spokenWords = spoken.split(/\s+/).filter(Boolean);
  const exact = menu.find((d) => d.name.toLowerCase() === spoken);
  if (exact) return exact;

  const allWordsPresent = menu.find((d) => {
    const dishLower = d.name.toLowerCase();
    return spokenWords.every((w) => dishLower.includes(w));
  });
  if (allWordsPresent) return allWordsPresent;

  let best = null;
  let bestScore = 0;
  for (const dish of menu) {
    const dishWords = dish.name.toLowerCase().split(/\s+/);
    const score = spokenWords.filter((w) => dishWords.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = dish;
    }
  }
  return bestScore > 0 ? best : null;
}

module.exports = {
  getCustomer,
  recordOrder,
  normalisePhone,
  getRewardConfig,
  setRewardConfig,
  parseRewardChangeCommand,
  TIER_LOW,
  TIER_HIGH,
};
