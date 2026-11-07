// ============================================================
// MERLIN'S DISH -- BACK OFFICE CONTROL API
// ============================================================
// Lets the back office web app (BOH) read and change what the order app shows: announcement, opening
// hours and closures, promotions, menu and prices, delivery fees. It calls the same setters the LINE group
// commands use, so a change here and a change by text behave identically, and every change is saved to the
// "Shop Settings" tab so it survives a restart.
//
// SWITCHED OFF BY DEFAULT. The routes only exist when the Railway variable ADMIN_API_TOKEN is set, and every
// call must carry that token in the x-admin-token header. Without the variable the bot is exactly as before.
const crypto = require("crypto");
const express = require("express");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function sameToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const bad = (res, msg) => res.status(400).json({ error: msg });
const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

// ctx comes from server.js: live state accessors plus persist(). Nothing here reaches for server.js globals.
function mount(app, ctx) {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return false;
  const router = express.Router();
  router.use(express.json({ limit: "6mb" }));
  router.use((req, res, next) => (sameToken(req.get("x-admin-token"), token) ? next() : res.status(401).json({ error: "Not allowed" })));
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) { console.error("Admin API:", err); res.status(500).json({ error: "Something went wrong" }); }
  };
  const done = async (res) => { const saved = await ctx.persist(); res.json({ ok: true, saved, state: ctx.state() }); };

  router.get("/state", wrap(async (req, res) => res.json(ctx.state())));

  router.post("/announcement", wrap(async (req, res) => {
    const b = req.body || {};
    const headline = String(b.headline || "").trim();
    const body = String(b.body || "").trim();
    if (!headline) return bad(res, "The announcement needs a headline");
    const startDate = b.startDate ? String(b.startDate) : null;
    const endDate = b.endDate ? String(b.endDate) : null;
    if ((startDate && !DATE.test(startDate)) || (endDate && !DATE.test(endDate))) return bad(res, "Dates must look like 2026-11-09");
    if (startDate && endDate && endDate < startDate) return bad(res, "The end date is before the start date");
    ctx.setAnnouncement({ active: b.active !== false, headline, body, startDate, endDate, startWasToday: false });
    await done(res);
  }));
  router.post("/announcement/clear", wrap(async (req, res) => { ctx.clearAnnouncement(); await done(res); }));

  // Hours. override: "open" | "closed" | null. closures: [{start,end}] YYYY-MM-DD inclusive.
  // special: [{date, open:"HH:MM", close:"HH:MM"}] one custom window for that date (early close, late open).
  router.post("/hours", wrap(async (req, res) => {
    const b = req.body || {};
    let override = null;
    if (b.override === "open") override = true;
    else if (b.override === "closed") override = false;
    else if (b.override !== null && b.override !== undefined && b.override !== "") return bad(res, 'override must be "open", "closed" or empty');
    const closures = [];
    for (const c of b.closures || []) {
      if (!DATE.test(String(c.start)) || !DATE.test(String(c.end))) return bad(res, "Closure dates must look like 2026-11-09");
      if (c.end < c.start) return bad(res, "A closure ends before it starts");
      closures.push({ start: c.start, end: c.end });
    }
    const special = [];
    for (const s of b.special || []) {
      if (!DATE.test(String(s.date)) || !TIME.test(String(s.open)) || !TIME.test(String(s.close))) return bad(res, "Special hours need a date and times like 13:00");
      if (s.close <= s.open) return bad(res, "Closing time must be after opening time");
      special.push({ date: s.date, open: s.open, close: s.close });
    }
    ctx.setHours({ override, closures, special });
    await done(res);
  }));

  const validPromo = (b) => {
    const percentOff = num(b.percentOff);
    if (!(percentOff > 0 && percentOff <= 100)) return "The percentage must be between 1 and 100";
    const label = String(b.label || "").trim();
    if (!label) return "The promo needs a name";
    if (b.startDate && !DATE.test(String(b.startDate))) return "Dates must look like 2026-11-09";
    if (b.endDate && !DATE.test(String(b.endDate))) return "Dates must look like 2026-11-09";
    if (b.startDate && b.endDate && b.endDate < b.startDate) return "The end date is before the start date";
    return null;
  };
  const promoOf = (b) => ({ active: b.active !== false, label: String(b.label).trim(), percentOff: Number(b.percentOff), startDate: b.startDate || null, endDate: b.endDate || null });

  router.post("/promo/storewide", wrap(async (req, res) => {
    const err = validPromo(req.body || {});
    if (err) return bad(res, err);
    ctx.setStorewidePromo(promoOf(req.body));
    await done(res);
  }));
  router.post("/promo/storewide/off", wrap(async (req, res) => { ctx.setStorewidePromo({ ...ctx.getStorewidePromo(), active: false }); await done(res); }));
  router.post("/promo/item", wrap(async (req, res) => {
    const b = req.body || {};
    if (!ctx.menu.some((d) => d.id === b.id)) return bad(res, "That item is not on the menu");
    const err = validPromo(b);
    if (err) return bad(res, err);
    ctx.setItemPromo(b.id, promoOf(b));
    await done(res);
  }));
  router.post("/promo/item/clear", wrap(async (req, res) => { ctx.clearItemPromo((req.body || {}).id); await done(res); }));

  // Dish photo: the browser sends a resized photo as a data URL, stored the same way as LINE group photos.
  const photoOf = async (dataUrl) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m) return { error: "That does not look like a photo (use JPG, PNG or WebP)" };
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 4.5 * 1024 * 1024) return { error: "That photo is too big, please pick a smaller one" };
    const url = ctx.uploadMenuPhoto ? await ctx.uploadMenuPhoto(buf, m[1]) : null;
    if (!url) return { error: "The photo could not be saved (photo storage is not set up or failed)" };
    return { url };
  };
  router.post("/menu/image", wrap(async (req, res) => {
    const b = req.body || {};
    const p = await photoOf(b.data);
    if (p.error) return bad(res, p.error);
    const r = await ctx.menuStore.updateItem(ctx.menu, b.id, { image: p.url });
    if (!r.ok) return bad(res, "That item is not on the menu");
    await done(res);
  }));

  // Menu
  router.post("/menu/price", wrap(async (req, res) => {
    const b = req.body || {};
    const price = num(b.price);
    if (!(price >= 0) || price > 100000) return bad(res, "That price does not look right");
    const r = await ctx.menuStore.updateItem(ctx.menu, b.id, { price: Math.round(price) });
    if (!r.ok) return bad(res, "That item is not on the menu");
    await done(res);
  }));
  router.post("/menu/item", wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return bad(res, "The name cannot be empty"); patch.name = n; }
    if (b.description !== undefined) patch.description = String(b.description).trim();
    if (b.category !== undefined) { if (!ctx.categories.some((c) => c.id === b.category)) return bad(res, "Unknown category"); patch.category = b.category; }
    if (b.price !== undefined) { const p = num(b.price); if (!(p >= 0)) return bad(res, "That price does not look right"); patch.price = Math.round(p); }
    const r = await ctx.menuStore.updateItem(ctx.menu, b.id, patch);
    if (!r.ok) return bad(res, "That item is not on the menu");
    await done(res);
  }));
  router.post("/menu/add", wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const price = num(b.price);
    if (!name) return bad(res, "The new item needs a name");
    if (!(price >= 0)) return bad(res, "That price does not look right");
    if (!ctx.categories.some((c) => c.id === b.category)) return bad(res, "Pick a category");
    let image = null;
    if (b.imageData) { const p = await photoOf(b.imageData); if (p.error) return bad(res, p.error); image = p.url; }
    const item = { id: ctx.menuStore.makeItemId(name, ctx.menu), name, price: Math.round(price), category: b.category, image, description: String(b.description || "").trim() };
    await ctx.menuStore.addItem(ctx.menu, item);
    await done(res);
  }));
  router.post("/menu/remove", wrap(async (req, res) => {
    const r = await ctx.menuStore.removeItem(ctx.menu, (req.body || {}).id);
    if (!r.ok) return bad(res, "That item is not on the menu");
    await done(res);
  }));
  router.post("/menu/restore", wrap(async (req, res) => {
    const r = await ctx.menuStore.restoreItem(ctx.menu, (req.body || {}).id);
    if (!r.ok) return bad(res, "That item is not in the removed list");
    await done(res);
  }));

  // Delivery fees: free minimum, fee under that inside 2km, and the three flat zones.
  router.post("/delivery", wrap(async (req, res) => {
    const b = req.body || {};
    const t = { freeMin: num(b.freeMin), smallFee: num(b.smallFee), zone2to5: num(b.zone2to5), zone5to75: num(b.zone5to75), zone75to10: num(b.zone75to10) };
    for (const [k, v] of Object.entries(t)) if (!(v >= 0 && v <= 5000)) return bad(res, `${k} does not look right`);
    ctx.setTiers(t);
    await done(res);
  }));

  app.use("/api/admin", router);
  return true;
}

module.exports = { mount };
