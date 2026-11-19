const test = require("node:test");
const assert = require("node:assert");
const n = require("../noodles");

const list = () => [
  { id: "tubetti", name: "Tubetti", mandatorySurcharge: 5, extraPrice: 45 },
  { id: "lumache", name: "Lumache", mandatorySurcharge: 0, extraPrice: 40 },
  { id: "risoni", name: "Risoni", mandatorySurcharge: 5, extraPrice: 45 },
];

test("recommended noodles fall back to the description line until Lily ticks some", () => {
  const dish = { description: "Soft. // Recommend pairing with Lumache." };
  assert.deepStrictEqual(n.recommendedIds(dish, list()), ["lumache"]);
  assert.deepStrictEqual(n.recommendedIds({ ...dish, noodleRecommend: ["risoni", "tubetti"] }, list()), ["risoni", "tubetti"]);
  assert.deepStrictEqual(n.recommendedIds({ ...dish, noodleRecommend: [] }, list()), []);
  assert.deepStrictEqual(n.recommendedIds({ noodleRecommend: ["gone"] }, list()), []);
});

test("saved noodle settings go on top of the list, in the saved order, and keep new code noodles", () => {
  const live = list();
  n.applySaved(live, [
    { id: "risoni", name: "Risoni", image: "r.jpg", mandatorySurcharge: 5, extraPrice: 45, hideInPasta: false, hideInPairing: true },
    { id: "tubetti", name: "Tubetti", mandatorySurcharge: 0, extraPrice: 50 },
    { id: "orzo", name: "Orzo", mandatorySurcharge: 0, extraPrice: 40 },
  ]);
  assert.deepStrictEqual(live.map((x) => x.id), ["risoni", "tubetti", "orzo", "lumache"]);
  assert.strictEqual(live[0].hideInPairing, true);
  assert.strictEqual(live[1].mandatorySurcharge, 0);
  assert.strictEqual(live[1].extraPrice, 50);
});

test("applySaved ignores damaged rows and a missing list", () => {
  const live = list();
  n.applySaved(live, null);
  n.applySaved(live, [{ id: "bad id!", name: "x" }, { id: "ok", name: "" }, null]);
  assert.strictEqual(live.length, 3);
});

test("ids and moves", () => {
  const live = list();
  assert.strictEqual(n.makeNoodleId("Risoni", live), "risoni_2");
  assert.strictEqual(n.makeNoodleId("Penne Rigate!", live), "penne_rigate");
  assert.strictEqual(n.move(live, "risoni", "up"), true);
  assert.deepStrictEqual(live.map((x) => x.id), ["tubetti", "risoni", "lumache"]);
  assert.strictEqual(n.move(live, "tubetti", "up"), false);
});

test("the Extras item is found by id or by name", () => {
  const menu = [{ id: "risoni_extra", category: "extras", name: "Risoni (Extra)" }, { id: "extra_lumache", category: "extras", name: "Lumache (Extra)" }, { id: "x", category: "mains", name: "Risoni stew" }];
  assert.strictEqual(n.extraItemFor({ id: "risoni", name: "Risoni" }, menu).id, "risoni_extra");
  assert.strictEqual(n.extraItemFor({ id: "lumache", name: "Lumache" }, menu).id, "extra_lumache");
  assert.strictEqual(n.extraItemFor({ id: "orzo", name: "Orzo" }, menu), null);
});

test("per dish lists must name real noodles", () => {
  assert.deepStrictEqual(n.dishPatch({ noodleSkip: ["lumache", "lumache"], noodleRecommend: ["risoni"] }, list()).patch, { noodleSkip: ["lumache"], noodleRecommend: ["risoni"] });
  assert.ok(n.dishPatch({ noodleSkip: ["nope"] }, list()).error);
  assert.ok(n.dishPatch({ noodleRecommend: "risoni" }, list()).error);
  assert.deepStrictEqual(n.dishPatch({}, list()).patch, {});
});

test("pasta dishes only tag a noodle once one is ticked, and a dish can keep its own order", () => {
  const dish = { requiresPasta: true, description: "Rich. // Recommend pairing with Lumache." };
  assert.deepStrictEqual(n.recommendedIds(dish, list()), []);
  assert.deepStrictEqual(n.recommendedIds({ ...dish, noodleRecommend: ["lumache"] }, list()), ["lumache"]);
  assert.deepStrictEqual(n.orderIds({ noodleOrder: ["risoni", "tubetti", "bad id"] }), ["risoni", "tubetti"]);
  assert.deepStrictEqual(n.orderIds({}), []);
  assert.deepStrictEqual(n.dishPatch({ noodleOrder: ["risoni", "tubetti"] }, list()).patch, { noodleOrder: ["risoni", "tubetti"] });
  assert.ok(n.dishPatch({ noodleOrder: ["nope"] }, list()).error);
});
