// scheduling.js
// Pre-order / scheduled-delivery logic for Merlin's Dish LIFF app.
// All times are Bangkok (Asia/Bangkok, UTC+7, no DST).
//
// IMPORTANT: pre-order slots run 11:00-21:00 continuously (NOT the
// 11:00-13:30 / 15:00-21:00 split that applies to "right away" ordering).
// Lily's call: a scheduled order can be prepped ahead of the lunch/dinner
// gap, so the gap only blocks immediate orders, not future ones.

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Bangkok";
const SCHEDULE_OPEN_HOUR = 11; // 11:00 -- first pre-order slot
const SCHEDULE_CLOSE_HOUR = 21; // 21:00 -- last pre-order slot
const SLOT_MINUTES = 30;
const MIN_LEAD_MINUTES = 120; // "at least 2 hours from now"

function bangkokNow() {
  return dayjs().tz(TZ);
}

function isWeekday(m) {
  const day = m.day(); // 0 = Sun ... 6 = Sat
  return day >= 1 && day <= 5;
}

// All possible daily slots as "HH:mm": 11:00, 11:30, ..., 21:00
function allDailySlots() {
  const slots = [];
  for (let h = SCHEDULE_OPEN_HOUR; h <= SCHEDULE_CLOSE_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h !== SCHEDULE_CLOSE_HOUR) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

// First bookable weekday. If today is a weekday AND at least one slot
// today still satisfies the +2hr lead time, today qualifies -- otherwise
// roll forward to the next weekday (which always has the full day open).
function firstAvailableDate(now = bangkokNow()) {
  if (isWeekday(now) && slotsForDate(now, now).length > 0) {
    return now.startOf("day");
  }
  let candidate = now.add(1, "day").startOf("day");
  while (!isWeekday(candidate)) {
    candidate = candidate.add(1, "day");
  }
  return candidate;
}

// "HH:mm" slots still bookable for a given date, given current time `now`.
// Future dates: every slot. Today: only slots >= now + MIN_LEAD_MINUTES.
function slotsForDate(dateM, now = bangkokNow()) {
  const date = dateM.tz(TZ).startOf("day");
  const today = now.tz(TZ).startOf("day");
  const isToday = date.isSame(today, "day");

  const slots = allDailySlots();
  if (!isToday) return slots;

  const cutoff = now.add(MIN_LEAD_MINUTES, "minute");
  return slots.filter((hhmm) => {
    const [h, min] = hhmm.split(":").map(Number);
    const slotMoment = date.hour(h).minute(min);
    return slotMoment.isAfter(cutoff) || slotMoment.isSame(cutoff);
  });
}

// Validates a {date: 'YYYY-MM-DD', time: 'HH:mm'} scheduling choice.
// Returns { valid: true, scheduledFor: dayjs } or { valid: false, reason }.
function validateSchedule(dateStr, timeStr, now = bangkokNow()) {
  const date = dayjs.tz(dateStr, TZ);
  if (!date.isValid()) return { valid: false, reason: "Invalid date." };
  if (!isWeekday(date)) return { valid: false, reason: "Delivery is only available Monday to Friday." };

  const validSlots = slotsForDate(date, now);
  if (!validSlots.includes(timeStr)) {
    return { valid: false, reason: "That time slot is no longer available. Please pick another." };
  }

  const [h, m] = timeStr.split(":").map(Number);
  const scheduledFor = date.hour(h).minute(m).second(0).millisecond(0);
  return { valid: true, scheduledFor };
}

module.exports = {
  TZ,
  SCHEDULE_OPEN_HOUR,
  SCHEDULE_CLOSE_HOUR,
  SLOT_MINUTES,
  MIN_LEAD_MINUTES,
  bangkokNow,
  isWeekday,
  allDailySlots,
  firstAvailableDate,
  slotsForDate,
  validateSchedule,
};
