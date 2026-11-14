// The text after "close": a date or range, then an optional reason that BOH keeps for the reports.
//   "12/11 rain, no riders"  ->  { datePart: "12/11", reason: "rain, no riders" }
// Anything that does not start with a date comes back untouched so the usual "couldn't read that date" reply still fires.
function splitCloseReason(rest) {
  const m = String(rest || "").trim().match(/^(today|\d{1,2}\/\d{1,2}(?:\s*-\s*\d{1,2}\/\d{1,2})?)(?:[\s:,]+(.+))?$/i);
  if (!m) return { datePart: String(rest || "").trim(), reason: "" };
  return { datePart: m[1], reason: (m[2] || "").trim() };
}

// parseCloseDateRange rolls a D/M that is already past into next year. A closure that far ahead is a day that has gone by,
// so the order app has nothing to close (BOH still records it).
function isPastDayRolled(rangeEndIso, todayIso) {
  const days = (Date.parse(`${rangeEndIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000;
  return days > 300;
}

module.exports = { splitCloseReason, isPastDayRolled };
