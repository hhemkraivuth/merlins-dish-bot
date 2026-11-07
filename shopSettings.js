// ============================================================
// MERLIN'S DISH -- SHOP SETTINGS THAT SURVIVE A RESTART
// ============================================================
// Announcement, promos, opening hours and closures, and delivery fees used to live in memory only and
// reset on every restart. This file saves a copy of them in a "Shop Settings" tab of the Bot Activity
// sheet (created the first time it is needed) and gives it back on start-up.
//
// Safe by design: if the Google variables are missing, or the sheet cannot be reached, every call quietly
// does nothing and the bot behaves exactly as it did before.
const { google } = require("googleapis");

const TAB = "Shop Settings";
const HEADER = ["Key", "Value (JSON)", "Updated (Bangkok)"];
const hasSheetCreds = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY && !!process.env.GOOGLE_SHEET_ID;

let client = null;
function getClient() {
  if (!hasSheetCreds) return null;
  if (client) return client;
  const auth = new google.auth.JWT(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null, process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), ["https://www.googleapis.com/auth/spreadsheets"]);
  client = google.sheets({ version: "v4", auth });
  return client;
}

let ready = false;
async function ensureTab(sheets) {
  if (ready) return;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  if (!(meta.data.sheets || []).some((s) => s.properties.title === TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${TAB}!A1:C1`, valueInputOption: "RAW", requestBody: { values: [HEADER] } });
  }
  ready = true;
}

// Returns { key: parsedValue }. Never throws.
async function loadAll() {
  try {
    const sheets = getClient();
    if (!sheets) return {};
    await ensureTab(sheets);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${TAB}!A2:C` });
    const out = {};
    for (const r of res.data.values || []) {
      try { out[String(r[0] || "").trim()] = JSON.parse(r[1] || "null"); } catch (e) { /* skip a damaged row */ }
    }
    return out;
  } catch (err) {
    console.error("Shop settings could not be loaded:", err.message);
    return {};
  }
}

// Saves one key. Never throws. Returns true when it reached the sheet.
async function save(key, value) {
  try {
    const sheets = getClient();
    if (!sheets) return false;
    await ensureTab(sheets);
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB}!A2:A` });
    const keys = (res.data.values || []).map((r) => String(r[0] || "").trim());
    const at = keys.indexOf(key);
    const stamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
    const row = [key, JSON.stringify(value), stamp];
    if (at >= 0) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `${TAB}!A${at + 2}:C${at + 2}`, valueInputOption: "RAW", requestBody: { values: [row] } });
    } else {
      await sheets.spreadsheets.values.append({ spreadsheetId, range: `${TAB}!A:C`, valueInputOption: "RAW", requestBody: { values: [row] } });
    }
    return true;
  } catch (err) {
    console.error("Shop settings could not be saved:", err.message);
    return false;
  }
}

module.exports = { loadAll, save, hasSheetCreds };
