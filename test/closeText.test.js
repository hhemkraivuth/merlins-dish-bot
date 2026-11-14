const test = require("node:test");
const assert = require("node:assert");
const { splitCloseReason, isPastDayRolled } = require("../closeText");

test("a reason after the date is split off", () => {
  assert.deepStrictEqual(splitCloseReason("12/11 rain, no riders"), { datePart: "12/11", reason: "rain, no riders" });
  assert.deepStrictEqual(splitCloseReason("12/11-14/11 holiday"), { datePart: "12/11-14/11", reason: "holiday" });
  assert.deepStrictEqual(splitCloseReason("12/11 - 14/11: holiday"), { datePart: "12/11 - 14/11", reason: "holiday" });
  assert.deepStrictEqual(splitCloseReason("today sick day"), { datePart: "today", reason: "sick day" });
});
test("no reason, and text that is not a date, pass through", () => {
  assert.deepStrictEqual(splitCloseReason("12/11"), { datePart: "12/11", reason: "" });
  assert.deepStrictEqual(splitCloseReason("tomorrow"), { datePart: "tomorrow", reason: "" });
});
test("a day rolled to next year counts as already passed", () => {
  assert.strictEqual(isPastDayRolled("2027-11-12", "2026-11-14"), true);
  assert.strictEqual(isPastDayRolled("2026-11-20", "2026-11-14"), false);
  assert.strictEqual(isPastDayRolled("2027-01-20", "2026-12-30"), false);
});
