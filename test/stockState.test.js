const test = require("node:test");
const assert = require("node:assert");
const { snapshot, apply } = require("../stockState");

const fresh = () => ({ soldOut: new Set(), stockCount: new Map(), soldOutVariants: new Set(), variantStockCount: new Map() });

test("stock survives a restart: what was saved comes back exactly", () => {
  const a = fresh();
  a.soldOut.add("rws"); a.stockCount.set("tuscan", 2); a.soldOutVariants.add("dbs|large"); a.variantStockCount.set("dbs|regular", 4);
  const saved = JSON.parse(JSON.stringify(snapshot(a)));
  const b = fresh();
  assert.strictEqual(apply(b, saved), true);
  assert.deepStrictEqual([...b.soldOut], ["rws"]);
  assert.deepStrictEqual([...b.stockCount], [["tuscan", 2]]);
  assert.deepStrictEqual([...b.soldOutVariants], ["dbs|large"]);
  assert.deepStrictEqual([...b.variantStockCount], [["dbs|regular", 4]]);
});

test("nothing saved, or a damaged value, changes nothing", () => {
  const b = fresh();
  assert.strictEqual(apply(b, null), false);
  apply(b, { soldOut: "x", stockCount: [["a", "NaN"], ["b"], 5], variantStockCount: [["k", 3]] });
  assert.strictEqual(b.soldOut.size, 0);
  assert.strictEqual(b.stockCount.size, 0);
  assert.deepStrictEqual([...b.variantStockCount], [["k", 3]]);
});
