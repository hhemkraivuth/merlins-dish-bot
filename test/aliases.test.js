const test = require("node:test");
const assert = require("node:assert");
const { addItemAlias, applyCustomAliases, customAliases, resolveItemId } = require("../aliases");

const menu = [{ id: "spicy_rosso" }, { id: "bacon_steak" }, { id: "bolognese" }];

test("a new shorthand resolves to the dish and is remembered", () => {
  const r = addItemAlias("spicy_rosso", " BP ", menu);
  assert.deepStrictEqual(r, { ok: true, word: "bp" });
  assert.strictEqual(resolveItemId("bp", menu), "spicy_rosso");
  assert.deepStrictEqual(customAliases().spicy_rosso, ["bp"]);
});

test("a word that already means another dish is refused", () => {
  const r = addItemAlias("spicy_rosso", "bacon", menu);
  assert.match(r.error, /already means another dish/);
  assert.strictEqual(resolveItemId("bacon", menu), "bacon_steak");
});

test("a dish that is not on the menu, or a bad word, is refused", () => {
  assert.ok(addItemAlias("nope", "xy", menu).error);
  assert.ok(addItemAlias("spicy_rosso", "7", menu).error);
  assert.ok(addItemAlias("spicy_rosso", "a", menu).error);
});

test("saved shorthand comes back after a restart", () => {
  applyCustomAliases({ bolognese: ["bolly"] }, menu);
  assert.strictEqual(resolveItemId("bolly", menu), "bolognese");
});

test("the renamed Spicy Rosso also answers to its new name", () => {
  assert.strictEqual(resolveItemId("pomodoro", menu), "spicy_rosso");
  assert.strictEqual(resolveItemId("baconpomodoro", menu), "spicy_rosso");
});
