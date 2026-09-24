// scheduled-reminder.js
// Requires `node-cron` (or whatever scheduler you already use for other jobs).
// Runs once daily at 11:00 Asia/Bangkok — the moment the kitchen opens — and
// pushes a reminder to the private LINE group for every scheduled order due
// TODAY, so nothing gets missed among same-day "right away" orders.

const cron = require('node-cron');
const dayjs = require('dayjs');
require('dayjs/plugin/timezone');
require('dayjs/plugin/utc');
const { TZ } = require('./scheduling');

// cron runs in server-local time by default; pass timezone explicitly so this
// is correct regardless of what timezone the Railway container itself is in.
cron.schedule(
  '0 11 * * *',
  async () => {
    try {
      const today = dayjs().tz(TZ).format('YYYY-MM-DD');
      const dueToday = await getScheduledOrdersForDate(today); // implement: query Orders sheet/DB

      if (dueToday.length === 0) return;

      const lines = dueToday
        .map((o) => `#${o.orderId} — ${o.customerName} — ${o.time} — ${o.itemsSummary}`)
        .join('\n');

      await pushMessage(process.env.PRIVATE_GROUP_ID, {
        type: 'text',
        text: `Kitchen open — ${dueToday.length} pre-order(s) due for delivery today:\n${lines}`,
      });
    } catch (err) {
      console.error('scheduled-reminder cron failed:', err);
    }
  },
  { timezone: TZ }
);

module.exports = {}; // side-effect module; just require it once at server startup
