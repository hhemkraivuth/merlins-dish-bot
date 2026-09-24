// scheduled-reminder.js
// Reminder pushes to the private LINE group for pre-orders (scheduled
// deliveries). Two kinds of reminder, per order:
//
//   1. "1 hour before" -- ALWAYS fires, exactly 60 minutes before the
//      order's scheduled delivery time, regardless of which day it's for.
//   2. "Kitchen's open" (11:00 on the delivery day) -- fires ONLY when
//      the order was scheduled for a day OTHER than today (i.e. placed
//      in advance for a future weekday). If the order is for delivery
//      TODAY, this one is skipped -- it would either already be in the
//      past (order placed after 11:00) or redundant with reminder #1.
//
// Because each order has its own "1 hour before" moment, this can't run
// once a day at a fixed time like a simple daily cron -- it runs every
// 5 minutes and checks which orders are due for a reminder right now.
// Each order is marked in-memory once each reminder has fired, so it's
// never sent twice even though the checker runs frequently.

const cron = require("node-cron");
const { bangkokNow, TZ } = require("./scheduling");

// In-memory registry of scheduled (pre-)orders awaiting reminders.
// Keyed by orderId. Populated by markOrderForReminderJob() at order time.
// Resets on server restart -- acceptable for a solo, low-volume kitchen,
// same tradeoff as sessions/soldOut/etc elsewhere in server.js. If an
// order's reminder(s) are lost to a restart, worst case is a missed
// heads-up in the group chat, not a missed delivery -- the order itself
// is already logged to the sheet and pushed to the group at order time.
const scheduledOrders = new Map();
// entry shape: {
//   orderId, customerName, itemsSummary, scheduledFor: dayjs,
//   placedOnDate: 'YYYY-MM-DD' (Bangkok date the order was PLACED, not delivered),
//   kitchenOpenReminderSent: bool, oneHourReminderSent: bool,
// }

function markOrderForReminderJob({ orderId, customerName, itemsSummary, scheduledFor }) {
  scheduledOrders.set(orderId, {
    orderId,
    customerName,
    itemsSummary,
    scheduledFor, // dayjs instance, Bangkok time
    placedOnDate: bangkokNow().format("YYYY-MM-DD"),
    kitchenOpenReminderSent: false,
    oneHourReminderSent: false,
  });
}

// Runs every 5 minutes. `pushFn` is passed in from server.js at startup
// (it's just client.pushMessage bound to your private group) so this
// file doesn't need to require the LINE client or your group id itself.
function startReminderCron(pushFn) {
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        const now = bangkokNow();
        for (const entry of scheduledOrders.values()) {
          await maybeSendKitchenOpenReminder(entry, now, pushFn);
          await maybeSendOneHourReminder(entry, now, pushFn);
        }
        pruneOldEntries(now);
      } catch (err) {
        console.error("scheduled-reminder cron failed:", err);
      }
    },
    { timezone: TZ }
  );
}

async function maybeSendKitchenOpenReminder(entry, now, pushFn) {
  if (entry.kitchenOpenReminderSent) return;

  const deliveryDateStr = entry.scheduledFor.format("YYYY-MM-DD");
  const isSameDayOrder = deliveryDateStr === entry.placedOnDate;
  if (isSameDayOrder) {
    // Rule: skip the 11:00 alarm entirely for same-day pre-orders.
    entry.kitchenOpenReminderSent = true; // mark done so we never re-check it
    return;
  }

  // Fire once we've reached 11:00 Bangkok time on the delivery date itself.
  const elevenAmOnDeliveryDay = entry.scheduledFor.tz(TZ).hour(11).minute(0).second(0);
  if (now.isSame(deliveryDateStr, "day") && (now.isAfter(elevenAmOnDeliveryDay) || now.isSame(elevenAmOnDeliveryDay))) {
    entry.kitchenOpenReminderSent = true;
    await pushFn(
      `Kitchen open -- pre-order due today:\n#${entry.orderId} -- ${entry.customerName} -- ${entry.scheduledFor.format("HH:mm")} -- ${entry.itemsSummary}`
    );
  }
}

async function maybeSendOneHourReminder(entry, now, pushFn) {
  if (entry.oneHourReminderSent) return;

  const oneHourBefore = entry.scheduledFor.subtract(1, "hour");
  if (now.isAfter(oneHourBefore) || now.isSame(oneHourBefore)) {
    entry.oneHourReminderSent = true;
    await pushFn(
      `1 hour to delivery -- pre-order due at ${entry.scheduledFor.format("HH:mm")} today:\n#${entry.orderId} -- ${entry.customerName} -- ${entry.itemsSummary}`
    );
  }
}

// Clears entries whose scheduled delivery has passed and both reminders
// have fired (or the delivery time itself is now more than a day old --
// a safety net in case a reminder somehow never fires, so this map
// doesn't grow forever).
function pruneOldEntries(now) {
  for (const [orderId, entry] of scheduledOrders.entries()) {
    const bothSent = entry.kitchenOpenReminderSent && entry.oneHourReminderSent;
    const wellPast = now.isAfter(entry.scheduledFor.add(1, "day"));
    if (bothSent || wellPast) {
      scheduledOrders.delete(orderId);
    }
  }
}

module.exports = { markOrderForReminderJob, startReminderCron };
