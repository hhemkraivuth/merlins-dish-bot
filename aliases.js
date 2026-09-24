// ============================================================
// MERLIN'S DISH -- ADMIN COMMAND ALIASES
// ============================================================
// Lets you type stock/soldout/instock/setstock commands using
// whatever short keyword you like for a dish or a size/pasta
// variant, instead of memorising the exact internal id.
//
// This ONLY affects how your own admin text commands (via your
// private LINE account) are read. It has no effect on what
// customers see or type in the ordering flow.
//
// HOW TO ADD OR CHANGE A KEYWORD:
// Find the item below and add your word to its "aliases" array.
// Matching is case-insensitive and ignores surrounding spaces,
// so "Bolo", "bolo", " bolo " all work the same.
// The FIRST alias in each list is just a suggestion shown back to
// you in "unknown id" error messages -- it has no special behaviour.
// Never reuse the same keyword for two different items -- if you
// do, whichever one is defined first below wins, silently.
// ============================================================

// Dish-level aliases (whole menu items -- matches MENU ids in menu.js)
const ITEM_ALIASES = {
  rws: ["rws", "redwinestew"],
  dbs: ["dbs", "darkbeerstew"],
  tuscan: ["tuscan", "tpb"],
  ragu: ["ragu"],
  bolognese: ["bolognese", "bolog", "bolo"],
  bacon_steak: ["baconsteak", "bacon"],
  chicken_soup: ["cs", "chicsoup", "chics"],
  pecorino_soup: ["bs", "brocs"],
};

// Size-variant aliases (SIZE_OPTIONS ids in menu.js: "regular", "large")
const SIZE_ALIASES = {
  regular: ["r", "regular"],
  large: ["l", "large"],
};

// Pasta-variant aliases (PASTA_OPTIONS ids in menu.js)
const PASTA_ALIASES = {
  tubetti: ["tubetti", "tubet"],
  radiatori: ["radiatori", "radia"],
  rigatoni: ["rigatoni"],
  lumache: ["lumache", "luma"],
  linguine: ["linguine", "lingui"],
  spaghetti: ["spaghetti", "spa"],
};

// Builds a lookup map from every lowercased alias -> canonical id,
// for a given {canonicalId: [aliases...]} table. Any item/id not
// listed above still resolves via its own real id as a fallback
// (built by the caller below), so this never breaks an id you
// haven't gotten around to aliasing yet.
function buildLookup(aliasTable) {
  const lookup = new Map();
  for (const [canonicalId, aliasList] of Object.entries(aliasTable)) {
    for (const alias of aliasList) {
      lookup.set(alias.toLowerCase(), canonicalId);
    }
    // The canonical id itself always works too, even if not repeated
    // in its own alias list.
    lookup.set(canonicalId.toLowerCase(), canonicalId);
  }
  return lookup;
}

const itemLookup = buildLookup(ITEM_ALIASES);
const sizeLookup = buildLookup(SIZE_ALIASES);
const pastaLookup = buildLookup(PASTA_ALIASES);

// Resolves a typed word to a real MENU item id, or null if it's not
// recognised as any alias or as an existing MENU id. `menu` is the
// MENU array from menu.js, passed in so a dish with no aliases
// defined above (e.g. a new dish you add later) still resolves via
// its own literal id.
function resolveItemId(typed, menu) {
  if (!typed) return null;
  const lower = typed.trim().toLowerCase();
  if (itemLookup.has(lower)) return itemLookup.get(lower);
  const direct = menu.find((d) => d.id.toLowerCase() === lower);
  return direct ? direct.id : null;
}

// Resolves a typed word to a real SIZE_OPTIONS id ("regular"/"large"),
// or null.
function resolveSizeId(typed) {
  if (!typed) return null;
  const lower = typed.trim().toLowerCase();
  return sizeLookup.has(lower) ? sizeLookup.get(lower) : null;
}

// Resolves a typed word to a real PASTA_OPTIONS id, or null.
function resolvePastaId(typed) {
  if (!typed) return null;
  const lower = typed.trim().toLowerCase();
  return pastaLookup.has(lower) ? pastaLookup.get(lower) : null;
}

// Resolves a typed word against whichever variant type a dish
// actually uses (size or pasta), or null if the dish has neither
// or the word doesn't match. `dish` is a MENU entry.
function resolveVariantId(dish, typed) {
  if (!dish) return null;
  if (dish.requiresSize) return resolveSizeId(typed);
  if (dish.requiresPasta) return resolvePastaId(typed);
  return null;
}

module.exports = {
  ITEM_ALIASES,
  SIZE_ALIASES,
  PASTA_ALIASES,
  resolveItemId,
  resolveSizeId,
  resolvePastaId,
  resolveVariantId,
};
