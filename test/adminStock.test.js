const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const { MENU, SIZE_OPTIONS, PASTA_OPTIONS } = require("../menu");
const { resolveItemId, resolveVariantId } = require("../aliases");
const { createStockCommand } = require("../stockCommand");

async function boot() {
  process.env.ADMIN_API_TOKEN = "t0k";
  delete require.cache[require.resolve("../adminApi")];
  const adminApi = require("../adminApi");
  const stockCount = new Map(); const soldOut = new Set();
  const cmd = createStockCommand({ MENU, SIZE_OPTIONS, PASTA_OPTIONS, resolveItemId, resolveVariantId, variantKey: (a, b) => `${a}::${b}`, stockCount, soldOut, variantStockCount: new Map(), soldOutVariants: new Set() });
  let persisted = 0;
  const app = express();
  adminApi.mount(app, { runStock: (b) => cmd.run(b), persist: async () => { persisted++; return true; }, state: () => ({}) });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server, stockCount, soldOut, persisted: () => persisted };
}
const post = (base, body, token = "t0k") => fetch(`${base}/api/admin/stock`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": token }, body: JSON.stringify(body) });

test("BOH can set several dishes through the admin API, with or without the word left", async () => {
  const b = await boot();
  try {
    let r = await post(b.base, { text: "left tpb 3, ragu 0, bolo 8" });
    const j = await r.json();
    assert.strictEqual(r.status, 200);
    assert.match(j.message, /updated \(3\)/);
    assert.strictEqual(b.stockCount.get("tuscan"), 3);
    assert.ok(b.soldOut.has("ragu"));
    r = await post(b.base, { text: "chix 4" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(b.stockCount.get("chicken_soup"), 4);
    assert.strictEqual(b.persisted(), 2);
  } finally { b.server.close(); }
});

test("empty text and a wrong token change nothing", async () => {
  const b = await boot();
  try {
    assert.strictEqual((await post(b.base, { text: "left" })).status, 400);
    assert.strictEqual((await post(b.base, { text: "tpb 3" }, "nope")).status, 401);
    assert.strictEqual(b.stockCount.size, 0);
  } finally { b.server.close(); }
});
