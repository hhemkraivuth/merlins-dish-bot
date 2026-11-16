// Age gate for age restricted items (wine). Thai law: sale to anyone under 20 is an offence for the seller.
// The customer gives a date of birth and ticks the consent box at checkout. A phone number that has passed once is
// remembered (the Age Checks tab), so repeat buyers skip the step. A typed date of birth is a declaration, not proof.
const MIN_AGE = 20;
const CONSENT_TEXT =
  "I confirm I am 20 years or older and the date of birth I entered is true. I understand wine is sold only to people aged 20 or over, and I accept responsibility if this information is untrue.";

// Today in Bangkok as YYYY-MM-DD.
function todayBangkokISO(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
}

function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d };
}

// Whole years old on todayISO. null for a missing, impossible or future date.
function ageOn(dobISO, todayISO) {
  const b = parseISO(dobISO);
  const t = parseISO(todayISO);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.mo < b.mo || (t.mo === b.mo && t.d < b.d)) age -= 1;
  return age < 0 ? null : age;
}

// { ok: true } or { ok: false, code }. Underage is reported before a missing tick.
function checkAge({ dob, consent } = {}, todayISO, { verifiedBefore = false } = {}) {
  if (verifiedBefore) return { ok: true, viaPrevious: true };
  if (!dob) return { ok: false, code: "AGE_REQUIRED" };
  if (/^(2[4-9]\d\d)-/.test(String(dob))) return { ok: false, code: "BUDDHIST_YEAR" };
  const age = ageOn(dob, todayISO);
  if (age === null || age > 120) return { ok: false, code: "BAD_DOB" };
  if (age < MIN_AGE) return { ok: false, code: "UNDERAGE" };
  if (consent !== true) return { ok: false, code: "NO_CONSENT" };
  return { ok: true, age };
}

const MESSAGES = {
  AGE_REQUIRED: "Wine is for ages 20 and over. Please enter your date of birth.",
  BUDDHIST_YEAR: "That looks like a B.E. year. Please type the C.E. year, for example 1995.",
  BAD_DOB: "That date of birth does not look right. Please check it.",
  UNDERAGE: "Sorry, wine is for ages 20 and over. Please remove it from your cart. Your food order can still go ahead.",
  NO_CONSENT: "Please tick the box to confirm you are 20 or over.",
};

module.exports = { MIN_AGE, CONSENT_TEXT, todayBangkokISO, ageOn, checkAge, MESSAGES };
