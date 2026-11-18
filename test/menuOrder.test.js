const test = require("node:test");
const assert = require("node:assert");
const store = require("../menuStore");

const mk = () => [
  { id: "a", category: "extras", name: "A" }, { id: "s", category: "soup", name: "S" },
  { id: "b", category: "extras", name: "B" }, { id: "c", category: "extras", name: "C" },
];
const names = (M, cat) => M.filter((d) => d.category === cat).map((d) => d.id).join("");

test("an item moves up and down inside its own category only", async () => {
  const M = mk();
  await store.moveItem(M, "c", "up");
  assert.strictEqual(names(M, "extras"), "acb");
  assert.strictEqual(M[1].id, "s", "other categories keep their place");
  await store.moveItem(M, "a", "down");
  assert.strictEqual(names(M, "extras"), "cab");
});

test("the first item cannot go up and the last cannot go down", async () => {
  const M = mk();
  assert.strictEqual((await store.moveItem(M, "a", "up")).moved, false);
  assert.strictEqual((await store.moveItem(M, "c", "down")).moved, false);
  assert.strictEqual(names(M, "extras"), "abc");
});

test("saved ranks put the order back after a restart", () => {
  const M = mk(); M[3].rank = 0; M[0].rank = 1; M[2].rank = 2;
  store.applyRanks(M);
  assert.strictEqual(names(M, "extras"), "cab");
});
