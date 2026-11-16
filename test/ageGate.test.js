const test = require("node:test");
const assert = require("node:assert");
const { ageOn, checkAge, todayBangkokISO } = require("../ageGate");

test("age counts whole years and the birthday itself", () => {
  assert.strictEqual(ageOn("2006-11-16", "2026-11-16"), 20);
  assert.strictEqual(ageOn("2006-11-17", "2026-11-16"), 19);
  assert.strictEqual(ageOn("2000-02-29", "2026-02-28"), 25);
});
test("impossible or future dates are rejected", () => {
  assert.strictEqual(ageOn("2026-02-30", "2026-11-16"), null);
  assert.strictEqual(ageOn("2030-01-01", "2026-11-16"), null);
  assert.strictEqual(ageOn("16/11/2000", "2026-11-16"), null);
  assert.strictEqual(ageOn("", "2026-11-16"), null);
});
test("20 or over with the tick passes", () => {
  assert.deepStrictEqual(checkAge({ dob: "1990-05-14", consent: true }, "2026-11-16"), { ok: true, age: 36 });
});
test("missing date, bad date, underage and missing tick each fail with their own code", () => {
  assert.strictEqual(checkAge({}, "2026-11-16").code, "AGE_REQUIRED");
  assert.strictEqual(checkAge({ dob: "1800-01-01", consent: true }, "2026-11-16").code, "BAD_DOB");
  assert.strictEqual(checkAge({ dob: "2008-01-01", consent: true }, "2026-11-16").code, "UNDERAGE");
  assert.strictEqual(checkAge({ dob: "2008-01-01", consent: false }, "2026-11-16").code, "UNDERAGE");
  assert.strictEqual(checkAge({ dob: "1990-05-14", consent: false }, "2026-11-16").code, "NO_CONSENT");
});
test("a Buddhist year is caught with its own code", () => {
  assert.strictEqual(checkAge({ dob: "2538-05-14", consent: true }, "2026-11-16").code, "BUDDHIST_YEAR");
});
test("a phone that passed before skips the step", () => {
  assert.deepStrictEqual(checkAge({}, "2026-11-16", { verifiedBefore: true }), { ok: true, viaPrevious: true });
});
test("Bangkok date rolls over at 17:00 UTC", () => {
  assert.strictEqual(todayBangkokISO(new Date("2026-11-15T17:30:00Z")), "2026-11-16");
  assert.strictEqual(todayBangkokISO(new Date("2026-11-15T16:30:00Z")), "2026-11-15");
});
