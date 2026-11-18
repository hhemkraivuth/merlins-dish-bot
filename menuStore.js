// ============================================================
// MERLIN'S DISH -- MENU CHANGES YOU MAKE FROM THE LINE GROUP
// ============================================================
// Lets you remove a dish, bring it back, add a brand new dish, or
// change a dish's photo by texting the bot, with no code edit and no
// GitHub upload. Everything is remembered in a "Custom Menu" tab of
// the Bot Activity sheet (created automatically the first time it is
// needed), so changes survive Railway restarts and redeploys.
//
// menu.js stays the starting menu. On every start-up the bot reads the
// Custom Menu tab and applies it on top:
//   status "removed" -> the dish is taken out of the live menu
//   status "active"  -> the dish is added (or, if the id already
//                        exists in menu.js, its fields are updated,
//                        e.g. a new photo)
//
// If the GOOGLE_* variables aren't set, everything still works for the
// current run but is forgotten on the next restart.
// ============================================================

const { google } = require("googleapis");

const TAB = "Custom Menu";
const HEADER = ["Item ID", "Status", "Item JSON", "Updated (Bangkok)"];

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

// Items taken off the menu this run (id -> full item), so "restore" can
// put them back exactly as they were.
const removedItems = new Map();

let tabReady = false;
async function ensureTab(sheets) {
  if (tabReady) return;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A1:D1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
  }
  tabReady = true;
}

async function readRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${TAB}!A2:D`,
  });
  return (res.data.values || []).map((r, i) => ({
    rowNumber: i + 2,
    id: String(r[0] || "").trim(),
    status: String(r[1] || "").trim().toLowerCase(),
    json: r[2] || "",
  }));
}

function bangkokNow() {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
}

// Writes (or overwrites) the single row for this item id. Returns true if
// it reached the sheet, false if it didn't (the change still applies for
// this run, it just won't survive a restart).
async function saveRecord(id, status, item) {
  const sheets = getClient();
  if (!sheets) return false;
  try {
    await ensureTab(sheets);
    const rows = await readRows(sheets);
    const existing = rows.find((r) => r.id === id);
    const values = [[id, status, JSON.stringify(item), bangkokNow()]];
    if (existing) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${TAB}!A${existing.rowNumber}:D${existing.rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${TAB}!A:D`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      });
    }
    return true;
  } catch (err) {
    console.error("Custom Menu save failed:", err.message);
    return false;
  }
}

// Called once at start-up, before the server starts taking customers.
async function loadMenuOverrides(MENU) {
  const sheets = getClient();
  if (!sheets) {
    console.warn("Custom Menu: Google Sheets not configured, menu changes will not survive a restart.");
    return { loaded: false, removed: 0, added: 0 };
  }
  try {
    await ensureTab(sheets);
    const rows = await readRows(sheets);
    let removed = 0;
    let added = 0;
    for (const r of rows) {
      if (!r.id || !r.json) continue;
      let item;
      try {
        item = JSON.parse(r.json);
      } catch (e) {
        console.error(`Custom Menu: could not read row for "${r.id}", skipping.`);
        continue;
      }
      const idx = MENU.findIndex((d) => d.id === r.id);
      if (r.status === "removed") {
        removedItems.set(r.id, item);
        if (idx >= 0) {
          MENU.splice(idx, 1);
          removed++;
        }
      } else if (r.status === "active") {
        if (idx >= 0) Object.assign(MENU[idx], item);
        else {
          MENU.push(item);
          added++;
        }
      }
    }
    applyRanks(MENU);
    console.log(`Custom Menu loaded: ${removed} removed, ${added} added.`);
    return { loaded: true, removed, added };
  } catch (err) {
    console.error("Custom Menu load failed, using menu.js as is:", err.message);
    return { loaded: false, removed: 0, added: 0 };
  }
}

// Order inside each category. Every item in a category that has been moved carries a numeric "rank"; the live MENU array is
// re-laid so each category keeps the slots it already had but its items follow their rank (unranked items stay after ranked ones,
// in their old order). The order app and the back office both read the MENU array, so they always agree.
function applyRanks(MENU) {
  const byCat = new Map();
  MENU.forEach((d, i) => { if (!byCat.has(d.category)) byCat.set(d.category, []); byCat.get(d.category).push(i); });
  for (const idxs of byCat.values()) {
    const items = idxs.map((i) => MENU[i]);
    if (!items.some((d) => Number.isFinite(d.rank))) continue;
    const sorted = items.map((d, n) => ({ d, n })).sort((a, b) => (Number.isFinite(a.d.rank) ? a.d.rank : 1e6 + a.n) - (Number.isFinite(b.d.rank) ? b.d.rank : 1e6 + b.n)).map((x) => x.d);
    idxs.forEach((i, k) => { MENU[i] = sorted[k]; });
  }
}

// Moves an item one place up or down inside its category.
async function moveItem(MENU, id, direction) {
  const dish = MENU.find((d) => d.id === id);
  if (!dish) return { ok: false, saved: false, reason: "missing" };
  const list = MENU.filter((d) => d.category === dish.category);
  const at = list.indexOf(dish);
  const to = direction === "up" ? at - 1 : direction === "down" ? at + 1 : at;
  if (to < 0 || to >= list.length || to === at) return { ok: true, saved: true, moved: false };
  [list[at], list[to]] = [list[to], list[at]];
  let saved = true;
  for (let k = 0; k < list.length; k++) {
    if (list[k].rank === k) continue;
    list[k].rank = k;
    saved = (await saveRecord(list[k].id, "active", list[k])) && saved;
  }
  applyRanks(MENU);
  return { ok: true, saved, moved: true };
}

// Takes an item off the live menu for good (until "restore").
async function removeItem(MENU, id) {
  const idx = MENU.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, saved: false };
  const [item] = MENU.splice(idx, 1);
  removedItems.set(id, item);
  const saved = await saveRecord(id, "removed", item);
  return { ok: true, saved, item };
}

async function restoreItem(MENU, id) {
  const item = removedItems.get(id);
  if (!item) return { ok: false, saved: false };
  if (!MENU.find((d) => d.id === id)) MENU.push(item);
  removedItems.delete(id);
  const saved = await saveRecord(id, "active", item);
  return { ok: true, saved, item };
}

// Adds a brand new item to the live menu.
async function addItem(MENU, item) {
  MENU.push(item);
  const saved = await saveRecord(item.id, "active", item);
  return { ok: true, saved, item };
}

// Changes fields on an item that is already on the menu (e.g. its image).
async function updateItem(MENU, id, patch) {
  const dish = MENU.find((d) => d.id === id);
  if (!dish) return { ok: false, saved: false };
  Object.assign(dish, patch);
  const saved = await saveRecord(id, "active", dish);
  return { ok: true, saved, item: dish };
}

function listRemoved() {
  return [...removedItems.values()];
}

// "Pepsi Max (330ml)" -> "pepsi_max_330ml", made unique against the live
// menu AND against anything removed, so an id is never reused for a
// different dish.
function makeItemId(name, MENU) {
  const base =
    String(name)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "item";
  const taken = (id) => MENU.some((d) => d.id === id) || removedItems.has(id);
  let id = base;
  let n = 2;
  while (taken(id)) id = `${base}_${n++}`;
  return id;
}

module.exports = {
  loadMenuOverrides,
  removeItem,
  restoreItem,
  addItem,
  updateItem,
  moveItem,
  applyRanks,
  listRemoved,
  makeItemId,
};
