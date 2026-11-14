const test = require("node:test");
const assert = require("node:assert");
const { variantRemainingList } = require("../variantStock");
const SIZES = [{ id: "regular", name: "Regular" }, { id: "large", name: "Large" }];
test("Regular and Large counts are listed apart, only for sizes with a count", () => {
  const m = new Map([["dbs:regular", 5], ["dbs:large", 3], ["rws:large", 2]]);
  assert.deepStrictEqual(variantRemainingList(SIZES, "dbs", m), [{ id: "regular", name: "Regular", left: 5 }, { id: "large", name: "Large", left: 3 }]);
  assert.deepStrictEqual(variantRemainingList(SIZES, "rws", m), [{ id: "large", name: "Large", left: 2 }]);
  assert.deepStrictEqual(variantRemainingList(SIZES, "tpb", m), []);
  assert.deepStrictEqual(variantRemainingList([], "dbs", m), []);
});
test("a count below zero shows as zero", () => {
  assert.deepStrictEqual(variantRemainingList(SIZES, "dbs", new Map([["dbs:regular", -1]])), [{ id: "regular", name: "Regular", left: 0 }]);
});
