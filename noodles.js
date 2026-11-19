// ============================================================
// MERLIN'S DISH -- NOODLE SETTINGS YOU EDIT FROM THE BACK OFFICE
// ============================================================
// menu.js holds the starting noodle list (PASTA_OPTIONS). The back office Noodles panel can change each
// noodle (name, photo, the pasta dish upcharge, the extra price, hide it, the order) and add new ones.
// Those edits are saved by server.js in the "Shop Settings" tab under the key "noodles" and put back on
// top of menu.js at start-up, so they survive a restart with no code edit.
//
// A noodle is sold two ways, both settings live here:
//   - with a pasta dish (Ragu, Bolognese): mandatorySurcharge, hidden by hideInPasta
//   - as an optional pairing on a mains or soup: its Extras item (extra_<id>), hidden by hideInPairing
// Per dish (set on the menu item): noodleSkip = noodle ids that dish does NOT offer, noodleRecommend = the
// noodles tagged "Recommended", noodleOrder = the order that dish lists them in. Without noodleRecommend the old "Recommend pairing with X" line in the
// description is used, so nothing changes until Lily ticks something.

const RECOMMEND_RE = /recommend pairing with ([a-z]+)/i;

const isId = (v) => typeof v === "string" && /^[a-z0-9_]{1,30}$/.test(v);
const money = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== "" && v !== null ? Math.round(Number(v)) : fallback);

// Noodle ids this dish tags as recommended (only ids that still exist).
function recommendedIds(dish, noodles) {
  const known = new Set(noodles.map((n) => n.id));
  if (Array.isArray(dish.noodleRecommend)) return dish.noodleRecommend.filter((id) => known.has(id));
  // Pasta dishes only tag a noodle once Lily ticks one, so their popup stays as it was until then.
  if (dish.requiresPasta) return [];
  const m = RECOMMEND_RE.exec((dish && dish.description) || "");
  const hit = m && noodles.find((n) => n.name.toLowerCase() === m[1].toLowerCase());
  return hit ? [hit.id] : [];
}

// The order this dish shows its noodles in (ids Lily arranged), anything not arranged follows in the main list order.
const orderIds = (dish) => (Array.isArray(dish.noodleOrder) ? dish.noodleOrder.filter(isId) : []);

const skippedIds = (dish) => (Array.isArray(dish.noodleSkip) ? dish.noodleSkip.filter(isId) : []);

// What gets saved: the noodles in their current order.
function snapshot(noodles) {
  return noodles.map((n) => ({
    id: n.id,
    name: n.name,
    image: n.image || null,
    mandatorySurcharge: n.mandatorySurcharge || 0,
    extraPrice: n.extraPrice || 0,
    hideInPasta: !!n.hideInPasta,
    hideInPairing: !!n.hideInPairing,
  }));
}

// Puts saved settings on top of the live list, in place (the list is shared with the rest of the bot).
// Saved noodles come first in their saved order, anything new in menu.js follows.
function applySaved(noodles, saved) {
  if (!Array.isArray(saved)) return;
  const byId = new Map(noodles.map((n) => [n.id, n]));
  const order = [];
  for (const s of saved) {
    if (!s || !isId(s.id) || !String(s.name || "").trim()) continue;
    let n = byId.get(s.id);
    if (!n) { n = { id: s.id }; byId.set(s.id, n); }
    n.name = String(s.name).trim();
    n.image = s.image || null;
    n.mandatorySurcharge = money(s.mandatorySurcharge, n.mandatorySurcharge || 0);
    n.extraPrice = money(s.extraPrice, n.extraPrice || 0);
    n.hideInPasta = !!s.hideInPasta;
    n.hideInPairing = !!s.hideInPairing;
    if (!order.includes(n.id)) order.push(n.id);
  }
  const rest = noodles.filter((n) => !order.includes(n.id));
  noodles.splice(0, noodles.length, ...order.map((id) => byId.get(id)), ...rest);
}

// The Extras menu item that sells this noodle on its own (and as the pairing).
function extraItemFor(noodle, menu) {
  const extras = menu.filter((d) => d.category === "extras");
  return (
    extras.find((d) => d.id === `extra_${noodle.id}`) ||
    extras.find((d) => String(d.name).toLowerCase().replace(/\(extra\)/, "").trim().startsWith(noodle.name.toLowerCase())) ||
    null
  );
}

function makeNoodleId(name, noodles) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "noodle";
  let id = base;
  let n = 2;
  while (noodles.some((x) => x.id === id)) id = `${base}_${n++}`;
  return id;
}

// Moves a noodle one place. Returns true when it moved.
function move(noodles, id, direction) {
  const at = noodles.findIndex((n) => n.id === id);
  const to = direction === "up" ? at - 1 : direction === "down" ? at + 1 : at;
  if (at < 0 || to < 0 || to >= noodles.length || to === at) return false;
  [noodles[at], noodles[to]] = [noodles[to], noodles[at]];
  return true;
}

// Checks the per dish lists sent from the back office. Returns { patch } or { error }.
function dishPatch(body, noodles) {
  const patch = {};
  const known = new Set(noodles.map((n) => n.id));
  for (const [field, key] of [["noodleSkip", "noodleSkip"], ["noodleRecommend", "noodleRecommend"], ["noodleOrder", "noodleOrder"]]) {
    if (body[field] === undefined) continue;
    if (!Array.isArray(body[field])) return { error: `${field} must be a list of noodles` };
    const ids = [...new Set(body[field].map(String))];
    if (ids.some((id) => !known.has(id))) return { error: "One of those noodles is not on the list" };
    patch[key] = ids;
  }
  return { patch };
}

module.exports = { recommendedIds, skippedIds, orderIds, snapshot, applySaved, extraItemFor, makeNoodleId, move, dishPatch, money, isId };
