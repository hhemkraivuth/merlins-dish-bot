// ============================================================
// MERLIN'S DISH -- ENTRANCE ANNOUNCEMENT CONFIG
// ============================================================
// Controls the pop-up screen customers see right when they open the
// mini app, before the menu. Edited at runtime by texting the private
// LINE group (see handleAnnounceCommand in server.js) -- takes effect
// immediately, no redeploy needed. IN-MEMORY ONLY, resets on restart.
//
// While an announcement is ACTIVE and within its date range, it fully
// REPLACES the usual "why order direct" benefits pop-up. Outside an
// active announcement, customers see the normal benefits pop-up as
// before.
let announcement = {
  active: false,
  headline: "",
  body: "",
  startDate: null, // YYYY-MM-DD, Bangkok time, inclusive
  endDate: null, // YYYY-MM-DD, Bangkok time, inclusive
};

function bangkokTodayStr() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// True if there's an announcement live right now that should replace
// the normal entrance pop-up.
function isAnnouncementLiveToday() {
  if (!announcement.active) return false;
  const today = bangkokTodayStr();
  if (announcement.startDate && today < announcement.startDate) return false;
  if (announcement.endDate && today > announcement.endDate) return false;
  return true;
}

function getAnnouncement() {
  return announcement;
}

function setAnnouncement(a) {
  announcement = a;
}

function clearAnnouncement() {
  announcement = { active: false, headline: "", body: "", startDate: null, endDate: null };
}

module.exports = { isAnnouncementLiveToday, getAnnouncement, setAnnouncement, clearAnnouncement };
