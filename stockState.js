// Stock counts and sold out flags used to live in memory only, so every restart (including each deploy) wiped them and the
// order app went back to "everything in stock". These two helpers turn that state into plain JSON for the Shop Settings tab
// and back again. The caller passes the live Set and Map objects, which are changed in place.

function snapshot(state) {
  return {
    soldOut: [...state.soldOut],
    stockCount: [...state.stockCount],
    soldOutVariants: [...state.soldOutVariants],
    variantStockCount: [...state.variantStockCount],
  };
}

const isPair = (p) => Array.isArray(p) && typeof p[0] === "string" && Number.isFinite(p[1]);

function apply(state, saved) {
  if (!saved || typeof saved !== "object") return false;
  const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
  const pairs = (a) => (Array.isArray(a) ? a.filter(isPair) : []);
  strings(saved.soldOut).forEach((id) => state.soldOut.add(id));
  strings(saved.soldOutVariants).forEach((k) => state.soldOutVariants.add(k));
  pairs(saved.stockCount).forEach(([id, n]) => state.stockCount.set(id, n));
  pairs(saved.variantStockCount).forEach(([k, n]) => state.variantStockCount.set(k, n));
  return true;
}

module.exports = { snapshot, apply };
