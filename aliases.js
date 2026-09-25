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
// THIS IS THE ONLY ALIAS TABLE -- there is no separate alias data
// inside menu.js. Everything server.js needs for resolving a typed
// word to a real item id, a group of item ids, or a size/pasta
// variant lives here.
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
// Every real MENU id from menu.js needs an entry here (even a bare one,
// e.g. `tuscan: ["tuscan"]`) so "unknown item id" replies always have a
// short word to suggest back, and so nothing silently falls through to
// only-the-literal-id matching. Drinks and extras were previously
// missing entirely, which is why "soldout juza" failed even after menu.js
// was updated with a "juza" alias -- this file never read anything from
// menu.js, it has always been the single independent source of truth for
// admin keyword matching, so an alias added only in menu.js never took
// effect here.
//
// rws and dbs are ordinary entries here like any other dish -- "soldout
// rws" (no second word) resolves to the single real id "rws" and marks
// the WHOLE dish (both Regular and Large) sold out via the soldOut Set
// in server.js, exactly like any other dish with no variants at all
// from that command's point of view. Closing just ONE size uses the
// separate single-variant form instead: "soldout rws l" / "soldout rws
// r", which goes through resolveVariantId -> SIZE_OPTIONS and
// server.js's soldOutVariants, not through anything in this section.
const ITEM_ALIASES = {
  bacon_steak: ["bacon", "baconsteak"],
  rws: ["rws", "redwinestew"],
  dbs: ["dbs", "darkbeerstew"],
  tuscan: ["tuscan", "tpb"],
  ragu: ["ragu"],
  bolognese: ["bolo", "bolognese", "bolog"],
  chicken_soup: ["chix", "cs", "chicsoup", "chics"],
  pecorino_soup: ["brocs", "bs"],

  // Extras (loose pasta sold on its own, separate from the mandatory
  // pasta choice bundled with Bolognese/Ragu)
  extra_tubetti: ["tubet", "tubetti"],
  extra_radiatori: ["radi", "radiatori"],
  extra_rigatoni: ["riga", "rigatoni"],
  extra_lumache: ["luma", "lumache"],
  extra_linguine: ["ling", "linguine"],
  extra_spaghetti: ["spa", "spaghetti"],

  // Drinks
  drink_maisonperrier_forever_lemon: ["perrier"],
  drink_enziero_golden_apple_yuzu: ["enziero"],
  drink_juza_sparkling: ["juza"],
  drink_coke_original: ["coke"],
  drink_coke_zero: ["cokez"],
  drink_eden_green_apple: ["eden"],
  drink_prebo_classic_muscat: ["prebom"],
  drink_prebo_cream_cloud: ["preboc"],
  drink_aw_rootbeer: ["aw"],
  drink_sourhours_ginger_lemon: ["sour"],
};

// Size-variant aliases (SIZE_OPTIONS ids in menu.js: "regular", "large")
const SIZE_ALIASES = {
  regular: ["r", "regular"],
  large: ["l", "large"],
};

// Pasta-variant aliases (PASTA_OPTIONS ids in menu.js)
const PASTA_ALIASES = {
  tubetti: ["tubetti", "tubet"],
  radiatori: ["radiatori", "radi"],
  rigatoni: ["rigatoni", "riga"],
  lumache: ["lumache", "luma"],
  linguine: ["linguine", "ling"],
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
