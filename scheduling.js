// scheduling.js
// Pre-order / scheduled-delivery logic for Merlin's Dish LIFF app.
// Timezone: Asia/Bangkok throughout. Requires `dayjs` + `dayjs/plugin/utc` + `dayjs/plugin/timezone`
// (or swap for your existing date lib — the logic below is framework-agnostic).

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Bangkok';
const KITCHEN_OPEN_HOUR = 11;   // 11:00
const KITCHEN_CLOSE_HOUR = 21;  // 21:00 (last slot)
const SLOT_MINUTES = 30;
const MIN_LEAD_MINUTES = 120;   // "at least 2 hours from now" rule

/**
 * Returns all possible daily slots as "HH:mm" strings: 11:00, 11:30, ... 21:00
 */
function allDailySlots() {
  const slots = [];
  for (let h = KITCHEN_OPEN_HOUR; h <= KITCHEN_CLOSE_HOUR; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h !== KITCHEN_CLOSE_HOUR) slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots; // ['11:00','11:30',...,'20:30','21:00']
}

/**
 * Is this a weekday (Mon-Fri) in Bangkok time?
 */
function isWeekday(m) {
  const day = m.day(); // 0=Sun ... 6=Sat
  return day >= 1 && day <= 5;
}

/**
 * Given "now", returns the first valid scheduling date (weekday, Bangkok tz).
 * If today is a weekday AND at least one slot today still satisfies the
 * +2hr lead time, today qualifies. Otherwise roll forward to the next weekday.
 */
function firstAvailableDate(now = dayjs().tz(TZ)) {
  let candidate = now.clone();
  // If today is a weekday, check whether any slot today is still bookable.
  if (isWeekday(candidate) && slotsForDate(candidate, now).length > 0) {
    return candidate.startOf('day');
  }
  // Roll forward day by day until we hit a weekday with available slots
  // (the next day always will, since it opens at 11:00 fresh).
  candidate = candidate.add(1, 'day').startOf('day');
  while (!isWeekday(candidate)) {
    candidate = candidate.add(1, 'day');
  }
  return candidate;
}

/**
 * Returns the list of "HH:mm" slots that are still valid for a given calendar
 * date, given the current time `now`. For a future date, all slots are valid.
 * For today, only slots >= now + MIN_LEAD_MINUTES are valid.
 */
function slotsForDate(dateM, now = dayjs().tz(TZ)) {
  const date = dateM.tz(TZ).startOf('day');
  const today = now.tz(TZ).startOf('day');
  const isToday = date.isSame(today, 'day');

  const slots = allDailySlots();
  if (!isToday) return slots;

  const cutoff = now.add(MIN_LEAD_MINUTES, 'minute');
  return slots.filter((hhmm) => {
    const [h, min] = hhmm.split(':').map(Number);
    const slotMoment = date.hour(h).minute(min);
    return slotMoment.isAfter(cutoff) || slotMoment.isSame(cutoff);
  });
}

/**
 * Validates a user-submitted {date: 'YYYY-MM-DD', time: 'HH:mm'} scheduling
 * choice. Returns { valid: true, scheduledFor: dayjs } or { valid: false, reason }.
 */
function validateSchedule(dateStr, timeStr, now = dayjs().tz(TZ)) {
  const date = dayjs.tz(dateStr, TZ);
  if (!date.isValid()) return { valid: false, reason: 'Invalid date.' };
  if (!isWeekday(date)) return { valid: false, reason: 'Delivery is only available Monday to Friday.' };

  const validSlots = slotsForDate(date, now);
  if (!validSlots.includes(timeStr)) {
    return { valid: false, reason: 'That time slot is no longer available. Please pick another.' };
  }

  const [h, m] = timeStr.split(':').map(Number);
  const scheduledFor = date.hour(h).minute(m).second(0);
  return { valid: true, scheduledFor };
}

/**
 * Is the kitchen currently open (for immediate/"right away" orders and for
 * deciding which post-payment confirmation message to send)?
 */
function isKitchenOpenNow(now = dayjs().tz(TZ)) {
  const n = now.tz(TZ);
  if (!isWeekday(n)) return false;
  const h = n.hour() + n.minute() / 60;
  return h >= KITCHEN_OPEN_HOUR && h < KITCHEN_CLOSE_HOUR + (SLOT_MINUTES === 30 ? 0.5 : 0);
  // NOTE: adjust upper bound if your "closing" behaviour should cut off exactly at 21:00
  // rather than accepting orders through the 21:00-21:30 window.
}

module.exports = {
  TZ,
  KITCHEN_OPEN_HOUR,
  KITCHEN_CLOSE_HOUR,
  SLOT_MINUTES,
  MIN_LEAD_MINUTES,
  allDailySlots,
  isWeekday,
  firstAvailableDate,
  slotsForDate,
  validateSchedule,
  isKitchenOpenNow,
};
