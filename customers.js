// ============================================================
// Customer loyalty tracking -- reads/writes the "Customers" tab
// of the same "Bot Activity" Google Sheet used by sheetLogger.js.
// Keyed on phone number (normalised, see normalisePhone below).
//
// Reward: every 10 completed checkouts earns 1 free Ragu or
// Bolognese (base plate only -- pasta surcharge still applies).
// Max 1 redemption per checkout.
//
// If the "Customers" tab doesn't exist yet, create it once with
// headers exactly in this order:
// Phone | Customer Name | Order Count | Free Pasta Earned |
// Free Pasta Redeemed | Free Pasta Available | Last Order Date | LINE User ID
//
// Free Pasta Earned    -- formula column, e.g. =FLOOR(C2/10)
// Free Pasta Available -- formula column, e.g. =D2-E2
// Both formulas should already be filled down the sheet; this
// module only ever writes to columns A, B, C, E, G, H -- it never
// touches D or F since those are computed by the sheet itself.
// ============================================================

const { google } = require("googleapis");

const REWARD_EVERY_N_ORDERS = 10;

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

// In-memory cache of the Customers tab so a busy few minutes doesn't
// mean a sheets.values.get round trip on every single keystroke lookup.
// Cleared on every successful write so it can never go stale for long.
let cache = null;
let cacheAt = 0;
const CACHE_TTL_MS = 30 * 1000;

async function loadAllCustomers() {
  const client = getClient();
  if (!client) return [];
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  const res = await client.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Customers!A2:H",
  });
  cache = res.data.values || [];
  cacheAt = now;
  return cache;
}

function invalidateCache() {
  cache = null;
}

// Looks up a customer by phone. Returns null if sheet logging isn't
// configured, or a record if not found yet (orderCount 0, so the
// caller can tell "new customer" from "lookup failed").
async function getCustomer(rawPhone) {
  const phone = normalisePhone(rawPhone);
  if (!phone) return null;
  const client = getClient();
  if (!client) return null;

  try {
    const rows = await loadAllCustomers();
    const rowIndex = rows.findIndex((r) => normalisePhone(r[0]) === phone);
    if (rowIndex === -1) {
      return { phone, name: "", orderCount: 0, freePastaAvailable: 0, found: false, rowIndex: -1 };
    }
    const row = rows[rowIndex];
    return {
      phone,
      name: row[1] || "",
      orderCount: Number(row[2]) || 0,
      freePastaAvailable: Number(row[5]) || 0, // column F, computed by sheet formula
      found: true,
      rowIndex, // 0-based within the A2:H range -- sheet row is rowIndex + 2
    };
  } catch (err) {
    console.error("Customer lookup failed:", err.message);
    return null;
  }
}

// Call once per completed checkout, after payment is verified.
// redeemed = true if this order used up a free pasta reward.
// Returns { orderCount, justHitMilestone } so the caller can decide
// whether to mention it in the internal group notification, or null
// if sheet logging isn't configured / the write failed.
async function recordOrder({ phone: rawPhone, name, lineUserId, redeemed }) {
  const phone = normalisePhone(rawPhone);
  const client = getClient();
  if (!client || !phone) return null;

  try {
    const existing = await getCustomer(phone);
    const now = new Date().toLocaleDateString("en-GB");

    if (!existing || !existing.found) {
      // New customer -- append a fresh row. Columns D and F are left
      // blank here on purpose: they're formula columns, fill them down
      // from row 2 once in the sheet and they'll apply to new rows too.
      const newOrderCount = 1;
      const row = [
        phone,
        name || "",
        newOrderCount,
        "", // D: Free Pasta Earned (formula)
        redeemed ? 1 : 0, // E: Free Pasta Redeemed
        "", // F: Free Pasta Available (formula)
        now,
        lineUserId || "",
      ];
      await client.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "Customers!A:H",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
      invalidateCache();
      return { orderCount: newOrderCount, justHitMilestone: false };
    }

    const newOrderCount = existing.orderCount + 1;
    const sheetRow = existing.rowIndex + 2; // +2: 1-based, plus header row
    const newRedeemedCount =
      (redeemed ? 1 : 0) + (await currentRedeemedCount(client, sheetRow));

    await client.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Customers!A${sheetRow}:C${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[phone, name || existing.name, newOrderCount]] },
    });
    if (redeemed) {
      await client.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `Customers!E${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[newRedeemedCount]] },
      });
    }
    await client.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Customers!G${sheetRow}:H${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[now, lineUserId || ""]] },
    });

    invalidateCache();

    const justHitMilestone =
      Math.floor(newOrderCount / REWARD_EVERY_N_ORDERS) >
      Math.floor(existing.orderCount / REWARD_EVERY_N_ORDERS);

    return { orderCount: newOrderCount, justHitMilestone };
  } catch (err) {
    console.error("Customer record update failed (order still went through):", err.message);
    return null;
  }
}

async function currentRedeemedCount(client, sheetRow) {
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Customers!E${sheetRow}`,
    });
    const val = res.data.values && res.data.values[0] && res.data.values[0][0];
    return Number(val) || 0;
  } catch (err) {
    return 0;
  }
}

module.exports = { getCustomer, recordOrder, normalisePhone, REWARD_EVERY_N_ORDERS };
