const test = require("node:test");
const assert = require("node:assert");
const dayjs = require("dayjs");
require("dayjs/plugin/utc");
const s = require("../scheduling");

const now = dayjs.tz("2026-11-12 22:00", "Asia/Bangkok"); // Thursday night, shop closed
const fri = dayjs.tz("2026-11-13", "Asia/Bangkok");

test("a part-day block removes only those slots, both ends included", () => {
  s.setSlotBlocker((d, t) => d === "2026-11-13" && t >= "11:00" && t <= "14:00");
  const slots = s.slotsForDate(fri, now);
  assert.ok(!slots.includes("11:00") && !slots.includes("14:00") && !slots.includes("12:30"));
  assert.ok(slots.includes("14:30") && slots.includes("21:00"));
  assert.strictEqual(s.validateSchedule("2026-11-13", "12:00", now).valid, false);
  assert.strictEqual(s.validateSchedule("2026-11-13", "15:00", now).valid, true);
  s.setSlotBlocker(null);
});

test("other days are not affected by a block", () => {
  s.setSlotBlocker((d, t) => d === "2026-11-13" && t >= "11:00" && t <= "14:00");
  assert.ok(s.slotsForDate(dayjs.tz("2026-11-16", "Asia/Bangkok"), now).includes("11:00"));
  s.setSlotBlocker(null);
});

test("a closed date blocks every slot and is skipped as the first available date", () => {
  s.setDateBlocker((d) => d === "2026-11-13");
  assert.deepStrictEqual(s.slotsForDate(fri, now), []);
  assert.strictEqual(s.firstAvailableDate(now).format("YYYY-MM-DD"), "2026-11-16");
  s.setDateBlocker(null);
});
