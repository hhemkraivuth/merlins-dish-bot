const test = require("node:test");
const assert = require("node:assert");
const menu = require("../menu");
const { SIZE_OPTIONS, PASTA_OPTIONS } = menu;
// Spicy Rosso is added from the menu editor on the live app, so it is not in menu.js. Mirror that here.
const MENU = [...menu.MENU, { id: "spicy_rosso", name: "Spicy Rosso", price: 215, category: "spotlight", requiresPasta: true }];
const { resolveItemId, resolveVariantId } = require("../aliases");
const { createStockCommand, stockBody } = require("../stockCommand");

function mk() {
  const st = { stockCount: new Map(), soldOut: new Set(), variantStockCount: new Map(), soldOutVariants: new Set() };
  const variantKey = (i, v) => `${i}::${v}`;
  const cmd = createStockCommand({ MENU, SIZE_OPTIONS, PASTA_OPTIONS, resolveItemId, resolveVariantId, variantKey, ...st });
  return { st, cmd, variantKey };
}
const run = (text) => { const m = mk(); const body = stockBody(text); return { ...m, out: body === null ? null : m.cmd.run(body) }; };

test("single dish behaves as before", () => {
  const { st, out } = run("left chix 5");
  assert.strictEqual(st.stockCount.get("chicken_soup"), 5);
  assert.match(out, /stock set to 5/);
});

test("single dish at 0 is sold out, and a number puts it back", () => {
  const { st, cmd } = mk();
  cmd.run("chix 0");
  assert.ok(st.soldOut.has("chicken_soup"));
  cmd.run("chix 2");
  assert.ok(!st.soldOut.has("chicken_soup"));
});

test("sizes in one dish still work, with spaces or glued", () => {
  const a = run("left rws l4 r7"); const b = run("setstock rws 4l 7r");
  for (const x of [a, b]) {
    assert.strictEqual(x.st.variantStockCount.get(x.variantKey("rws", "large")), 4);
    assert.strictEqual(x.st.variantStockCount.get(x.variantKey("rws", "regular")), 7);
  }
});

test("several dishes on one comma line (her Grab screenshot)", () => {
  const { st, out } = run("left tpb 3, noir 0, bolo 8, brocs 1, rws 1, dbs 1, bacon 13");
  assert.strictEqual(st.stockCount.get("tuscan"), 3);
  assert.strictEqual(st.stockCount.get("ragu"), 0);
  assert.ok(st.soldOut.has("ragu"));
  assert.strictEqual(st.stockCount.get("bolognese"), 8);
  assert.strictEqual(st.stockCount.get("pecorino_soup"), 1);
  assert.strictEqual(st.stockCount.get("rws"), 1);
  assert.strictEqual(st.stockCount.get("dbs"), 1);
  assert.strictEqual(st.stockCount.get("bacon_steak"), 13);
  assert.match(out, /updated \(7\)/);
  assert.ok(!/Not changed/.test(out));
});

test("one dish per line with left on its own first line", () => {
  const { st } = run("left\ntpb 3\nbolo 8\nnoir 0");
  assert.strictEqual(st.stockCount.get("tuscan"), 3);
  assert.strictEqual(st.stockCount.get("bolognese"), 8);
  assert.ok(st.soldOut.has("ragu"));
});

test("sizes and other dishes mixed: rws 2l 2r, tpb 4", () => {
  const { st, variantKey } = run("left rws 2l 2r, tpb 4");
  assert.strictEqual(st.variantStockCount.get(variantKey("rws", "large")), 2);
  assert.strictEqual(st.variantStockCount.get(variantKey("rws", "regular")), 2);
  assert.strictEqual(st.stockCount.get("tuscan"), 4);
});

test("a comma inside one dish's sizes stays with that dish", () => {
  const { st, variantKey } = run("left rws l4, r7, tpb 2");
  assert.strictEqual(st.variantStockCount.get(variantKey("rws", "large")), 4);
  assert.strictEqual(st.variantStockCount.get(variantKey("rws", "regular")), 7);
  assert.strictEqual(st.stockCount.get("tuscan"), 2);
});

test("pastas of one dish with commas stay with that dish", () => {
  const { st, variantKey } = run("left bolo luma 3, riga 5");
  assert.strictEqual(st.variantStockCount.get(variantKey("bolognese", "lumache")), 3);
  assert.strictEqual(st.variantStockCount.get(variantKey("bolognese", "rigatoni")), 5);
  assert.ok(!st.stockCount.has("extra_rigatoni"));
});

test("Spicy Rosso is on the order app and takes rosso / sr", () => {
  const { st } = run("left rosso 6, tpb 3");
  assert.strictEqual(st.stockCount.get("spicy_rosso"), 6);
  assert.strictEqual(run("left sr 0").st.soldOut.has("spicy_rosso"), true);
});

test("a word that is not a dish is reported, the rest still apply", () => {
  const { st, out } = run("left tpb 3, zzzdish 6, bolo 8");
  assert.strictEqual(st.stockCount.get("tuscan"), 3);
  assert.strictEqual(st.stockCount.get("bolognese"), 8);
  assert.match(out, /Not changed:\nzzzdish: not a dish on the order app/);
});

test("a typo in sizes skips only that dish", () => {
  const { st, out } = run("left rws x4, tpb 3");
  assert.ok(!st.variantStockCount.size);
  assert.strictEqual(st.stockCount.get("tuscan"), 3);
  assert.match(out, /Not changed/);
});

test("unknown single dish keeps the old message", () => {
  assert.match(run("left zzz 3").out, /Unknown item id "zzz"/);
});

test("not a stock command", () => {
  assert.strictEqual(stockBody("leftover soup"), null);
  assert.strictEqual(stockBody("left"), null);
  assert.strictEqual(stockBody("menu"), null);
});
