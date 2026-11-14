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

const { removeDaysFromClosures } = require("../closeText");
test("unclose takes one day out of a run and splits it", () => {
  const out = removeDaysFromClosures([{ start: "2026-11-12", end: "2026-11-14", startWasToday: false }], "2026-11-13", "2026-11-13");
  assert.deepStrictEqual(out.map((r) => [r.start, r.end]), [["2026-11-12", "2026-11-12"], ["2026-11-14", "2026-11-14"]]);
});
test("unclose of a whole closure removes it, and untouched closures stay", () => {
  const list = [{ start: "2026-11-12", end: "2026-11-12" }, { start: "2026-12-01", end: "2026-12-03" }];
  const out = removeDaysFromClosures(list, "2026-11-10", "2026-11-20");
  assert.deepStrictEqual(out, [{ start: "2026-12-01", end: "2026-12-03" }]);
});
test("unclose with nothing to match changes nothing", () => {
  const list = [{ start: "2026-12-01", end: "2026-12-03" }];
  assert.deepStrictEqual(removeDaysFromClosures(list, "2026-11-10", "2026-11-11"), list);
});
