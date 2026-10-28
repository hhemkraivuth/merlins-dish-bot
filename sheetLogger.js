// ============================================================
// Logs bot activity (completed orders, menu opens) to the
// "Bot Activity" Google Sheet -- a separate file from Lily's
// recipe-costs Living Document, so this never touches her cost
// calculations. If GOOGLE_* variables aren't set, this quietly
// does nothing and the bot still works as normal.
// ============================================================

const { google } = require("googleapis");

const hasSheetCreds =
  !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  !!process.env.GOOGLE_PRIVATE_KEY &&
  !!process.env.GOOGLE_SHEET_ID;

let sheetsClient = null;

// Every timestamp written to the sheet must read in Bangkok time, not
// whatever timezone the server itself runs in (Railway defaults to UTC,
// which is 7 hours behind -- e.g. 07:28 UTC shows as 14:28 in Bangkok).
// toLocaleDateString/toLocaleTimeString alone use the SERVER's timezone,
// so the timeZone option below is required, not optional.
function bangkokDateAndTime() {
  const now = new Date();
  return {
    date: now.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok" }),
    time: now.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok" }),
  };
}

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

// Digits only, forced to a single leading 0, with an apostrophe in front so
// Google Sheets stores it as text instead of dropping the 0 (USER_ENTERED
// would turn 0815656587 into the number 815656587).
function textPhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length === 11) digits = "0" + digits.slice(2);
  if (digits && !digits.startsWith("0")) digits = "0" + digits;
  return digits ? "'" + digits : "";
}

// order = { name, address, phone, items: [{name, qty, price}], total, slipRef, slipUrl, discountAmount, promoLabel }
//
// Logs to the "Orders" tab of the Bot Activity sheet (the same file as
// Menu Taps) -- NOT the recipe-costs Living Document. Kept separate per
// Lily's request so this never touches her cost calculations/formulas.
// If the "Orders" tab doesn't exist yet, create it once with headers:
// Date | Time | Items | Order From | Type | Qty (Portions) | Total (THB) |
// Customer Name | Address | Phone | Slip Ref | Slip URL | Order No
// (Order No, column M, is the 3-digit daily number such as 001 shown in the
// private LINE group. Add the header "Order No" to M1 once.)
//
// GROSS vs NET, matching the Grab screenshot-logging convention (see
// claude/daily-screenshot-logging-workflow.md): "Total (THB)" on the
// order row is always the GROSS/full pre-discount amount, same as how
// Grab's "Order value" is gross. If order.discountAmount is > 0 (a promo
// applied), a second row is logged directly underneath with Type =
// "Discount" and a NEGATIVE Total (THB), the same way the 30% Grab
// campaign discount gets its own deduction row. The actual net amount
// the customer paid is: gross Total (THB) + the discount row's total
// (since the discount row is negative), same arithmetic as the Grab rows.
async function logOrder(order) {
  const client = getClient();
  if (!client) return; // Sheet logging not configured -- skip silently.

  // item.price is already net (post-discount) per unit -- add back the
  // per-unit discount to show the gross/full price here, so item names
  // and prices always read clean and match the Menu Summary tab, exactly
  // like Grab's "Money In" rows show gross, not the discounted net.
  const itemsText = order.items
    .map((i) => {
      const grossPricePerUnit = i.price + (i.discountAmount || 0);
      return `${i.qty}x ${i.name} (฿${grossPricePerUnit})`;
    })
    .join(", ");

  const grossTotal = order.items.reduce((sum, i) => sum + (i.price + (i.discountAmount || 0)) * i.qty, 0);
  const totalDiscount = order.items.reduce((sum, i) => sum + (i.discountAmount || 0) * i.qty, 0);

  const { date, time } = bangkokDateAndTime();
  const orderRow = [
    date, // Date, DD/MM/YYYY, Bangkok time
    time, // Time, Bangkok time
    itemsText,
    "LINE Bot",
    "Order",
    order.items.reduce((sum, i) => sum + i.qty, 0), // Qty (Portions)
    grossTotal, // Total (THB) -- GROSS, matching Grab's Order value convention
    order.name,
    order.address,
    textPhone(order.phone), // kept as text so the leading 0 survives
    order.slipRef || "",
    order.slipUrl || "", // Link to the saved slip photo, for reference
    order.orderNo ? "'" + order.orderNo : "", // Order No, leading apostrophe keeps 001 as text
  ];

  const rows = [orderRow];
  if (totalDiscount > 0) {
    const label = order.promoLabel ? `Promo discount (${order.promoLabel})` : "Promo discount";
    rows.push([
      date,
      time,
      label,
      "LINE Bot",
      "Discount",
      "",
      -totalDiscount, // negative, same convention as the Grab merchant-funded-discount rows
      order.name,
      "",
      "",
      order.slipRef || "",
      "",
      order.orderNo ? "'" + order.orderNo : "",
    ]);
  }

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Orders!A:M",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  } catch (err) {
    // Never let a logging failure break the order flow for the customer.
    console.error("Sheet logging failed (order still went through):", err.message);
  }
}

// Highest Order No already logged today (Bangkok date), so the daily
// counter carries on correctly after a restart or redeploy. Returns 0 if
// the sheet isn't configured, the Order No column is empty, or the read fails.
async function getTodaysMaxOrderNo(todayDDMMYYYY) {
  const client = getClient();
  if (!client) return 0;
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Orders!A:M",
    });
    const rows = res.data.values || [];
    let max = 0;
    for (const row of rows) {
      if ((row[0] || "").trim() !== todayDDMMYYYY) continue;
      const n = parseInt(String(row[12] || "").replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max;
  } catch (err) {
    console.error("Could not read today's order numbers (counter starts from 0):", err.message);
    return 0;
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

  const { date, time } = bangkokDateAndTime();
  const row = [
    date, // Date, DD/MM/YYYY, Bangkok time
    time, // Time, Bangkok time
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


// Counts how many portions of each dish were ordered directly (LINE Bot rows
// of type "Order") in the last `days` days, read from the Orders tab. Item text
// looks like "2x Noir Ragu + Pasta (Radiatori) (฿225), 1x Bacon Steak (฿0)".
// Returns { counts: { <menuItemId>: portions }, ok } -- ok is false if the sheet
// isn't configured or can't be read, so callers can simply show no tag.
async function getDishOrderCounts(menu, days = 60) {
  const client = getClient();
  if (!client) return { counts: {}, ok: false };
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Orders!A:G",
    });
    const rows = res.data.values || [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const byNameLength = [...menu].sort((a, b) => b.name.length - a.name.length);
    const counts = {};
    for (const row of rows) {
      if ((row[3] || "").trim() !== "LINE Bot" || (row[4] || "").trim() !== "Order") continue;
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((row[0] || "").trim());
      if (!m || new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+07:00`).getTime() < cutoff) continue;
      for (const part of String(row[2] || "").split(/,\s*(?=\d+x )/)) {
        const p = /^(\d+)x\s+(.+?)\s*\(฿(\d+(?:\.\d+)?)\)\s*$/.exec(part.trim());
        if (!p || Number(p[3]) === 0) continue; // skip free reward items
        const dish = byNameLength.find((d) => p[2].toLowerCase().startsWith(d.name.toLowerCase()));
        if (dish) counts[dish.id] = (counts[dish.id] || 0) + Number(p[1]);
      }
    }
    return { counts, ok: true };
  } catch (err) {
    console.error("Could not count dish orders:", err.message);
    return { counts: {}, ok: false };
  }
}

module.exports = { logOrder, logMenuTap, getTodaysMaxOrderNo, getDishOrderCounts };
