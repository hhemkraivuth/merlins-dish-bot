// ============================================================
// Logs bot activity (completed orders, menu opens) to the
// "Bot Activity" Google Sheet -- a separate file from Lily's
// recipe-costs Living Document, so this never touches her cost
// calculations. If GOOGLE_* variables aren't set, this quietly
// does nothing and the bot still works as normal.
// ============================================================

const { google } = require("googleapis");

// All timestamps written to the sheet use Bangkok time explicitly --
// without this, Date/Time default to whatever timezone the server
// itself runs in (e.g. Railway's US East), which silently drifts the
// logged times away from what actually happened locally.
const BANGKOK_TZ = "Asia/Bangkok";
function bangkokDateParts() {
  const now = new Date();
  return {
    date: now.toLocaleDateString("en-GB", { timeZone: BANGKOK_TZ }), // DD/MM/YYYY
    time: now.toLocaleTimeString("en-GB", { timeZone: BANGKOK_TZ }),
  };
}

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
    // Railway/most hosts store multi-line keys with literal "\n" -- convert back.
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// order = { name, address, phone, items: [{name, qty, price}], total, slipRef, slipUrl }
//
// Logs to the "Orders" tab of the Bot Activity sheet (the same file as
// Menu Taps) -- NOT the recipe-costs Living Document. Kept separate per
// Lily's request so this never touches her cost calculations/formulas.
// If the "Orders" tab doesn't exist yet, create it once with headers:
// Date | Time | Items | Order From | Type | Qty (Portions) | Total (THB) |
// Customer Name | Address | Phone | Slip Ref | Slip URL
async function logOrder(order) {
  const client = getClient();
  if (!client) return; // Sheet logging not configured -- skip silently.

  const itemsText = order.items
    .map((i) => `${i.qty}x ${i.name}`)
    .join(", ");

  const { date, time } = bangkokDateParts();
  const row = [
    date,
    time,
    itemsText,
    "LINE Bot",
    "Order",
    order.items.reduce((sum, i) => sum + i.qty, 0), // Qty (Portions)
    order.total, // Total (THB)
    order.name,
    order.address,
    order.phone,
    order.slipRef || "",
    order.slipUrl || "", // Link to the saved slip photo, for reference
  ];

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Orders!A:L",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  } catch (err) {
    // Never let a logging failure break the order flow for the customer.
    console.error("Sheet logging failed (order still went through):", err.message);
  }
}

// Logs one row every time a customer opens the ordering menu (rich menu tap
// or typing "menu"/"order"), separate from the order log so it doesn't mix
// with completed-order rows. Written to its own "Menu Taps" tab -- if that
// tab doesn't exist yet in your Google Sheet, create it once with headers:
// Date | Time | LINE User ID | Display Name | Trigger
async function logMenuTap({ userId, displayName, trigger }) {
  const client = getClient();
  if (!client) return; // Sheet logging not configured -- skip silently.

  const { date, time } = bangkokDateParts();
  const row = [
    date,
    time,
    userId,
    displayName || "",
    trigger, // e.g. "menu", "order", or the rich menu label
  ];

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Menu Taps!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  } catch (err) {
    // Never let a logging failure break the order flow for the customer.
    console.error("Sheet logging failed (menu tap still went through):", err.message);
  }
}

module.exports = { logOrder, logMenuTap };
