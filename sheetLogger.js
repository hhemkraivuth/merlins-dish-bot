// ============================================================
// OPTIONAL: logs each completed order as a new row in your
// Google Sheet's "Master Log" tab. If you haven't set up the
// GOOGLE_* variables in .env, this quietly does nothing --
// the bot still works, you just log orders manually as before.
// ============================================================

const { google } = require("googleapis");

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

// order = { name, address, phone, items: [{name, qty, price}], total, slipRef }
async function logOrder(order) {
  const client = getClient();
  if (!client) return; // Sheet logging not configured -- skip silently.

  const itemsText = order.items
    .map((i) => `${i.qty}x ${i.name}`)
    .join(", ");

  const row = [
    new Date().toLocaleDateString("en-GB"), // Date, DD/MM/YYYY
    itemsText, // Description
    "", // Branch (left blank -- fill in if you use this column)
    "LINE Bot", // Order from
    "Order", // Type
    order.items.reduce((sum, i) => sum + i.qty, 0), // QTY (Portion)
    order.total, // Money In
    "", // Cost (filled in manually per your existing process)
    "", // Net Profit
    order.name,
    order.address,
    order.phone,
    order.slipRef || "",
  ];

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Master Log!A:M",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  } catch (err) {
    // Never let a logging failure break the order flow for the customer.
    console.error("Sheet logging failed (order still went through):", err.message);
  }
}

module.exports = { logOrder };
