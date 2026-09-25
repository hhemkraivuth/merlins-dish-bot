// ============================================================
// MERLIN'S DISH -- MENU CONFIG
// ============================================================
// This is the ONLY file you should need to edit when a price or
// dish changes. Each line is one item the customer can tap to order.
//
// id       -- short code, no spaces. Never reuse an id for a different dish.
// name     -- what the customer sees on the button and in the order summary.
// price    -- selling price in Baht, matching your Menu Summary tab.
// category -- must match one of the ids in CATEGORIES below.
// image    -- optional. A direct https:// link to a photo of the dish.
//              Leave as null if you don't have one yet -- the menu card
//              just shows without a photo, nothing breaks.
//
// To add a dish: copy a line, change id/name/price/category/image.
// To remove a dish: delete its line.
// To change a price: just change the number.
// To rename or reorder categories: edit CATEGORIES below, and make sure
// every dish's "category" value still matches one of the ids there.
//
// GETTING AN IMAGE URL: upload your photo into an "images" folder in this
// same GitHub repo, then use a link in this exact format (swap in your
// GitHub username, repo name, and filename):
//   https://raw.githubusercontent.com/<your-username>/merlins-dish-bot/main/images/rws_r.jpg
//
// Prices below were pulled from your Menu Summary tab on the day this
// bot was built. Double check them against the sheet before going live,
// and re-check any time you run a price change.
// ============================================================

const CATEGORIES = [
  { id: "spotlight", label: "⭐ Spotlight" },
  { id: "mains", label: "🍲 Main Dishes" },
  { id: "pasta", label: "🍝 Pasta" },
  { id: "soup", label: "🥣 Soup" },
  { id: "extras", label: "➕ Extras" },
  { id: "drinks", label: "🥤 Drinks" },
];

const MENU = [
  // -- Spotlight --
  { id: "bacon_steak", name: "Bacon Steak", price: 95, category: "spotlight", image: "https://raw.githubusercontent.com/hhemkraivuth/merlins-dish-bot/main/images/BaconSteak.png", description: "Tavern-Style Bacon Steak. A hearty 100g cut of pork belly, cured for a deeply savoury, juicy bite. A classic European tavern tradition." },

  // -- Main Dishes --
  { id: "rws", name: "Red Wine Beef Stew", price: 285, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766600/rws.png", requiresSize: true, description: "Signature 8-hour slow-braised Beef Bourguignon, using AU beef with red wine for a deep, meltingly tender finish. // Recommend pairing with Tubetti." },
  { id: "dbs", name: "Dark Beer Stew", price: 265, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766601/dbs.png", requiresSize: true, description: "Traditional Irish-style stew with AU beef slow-cooked for 8 hours in a deep, aromatic stout reduction. // Recommend pairing with Tubetti." },
  { id: "tuscan", name: "Tuscan Pork Braise", price: 245, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766599/tpb.png", description: "Slow-braised Tuscan pork. Meltingly tender, juicy pork chunks simmered in a rich tomato base with premium balsamic vinegar, hearty carrot batonnets, and mushrooms. // Recommend pairing with Lumache." },

  // -- Pasta (bundled dishes, pasta choice is mandatory and mostly free,
  //    Tubetti/Radiatori add a small surcharge -- see PASTA_OPTIONS below) --
  { id: "ragu", name: "Noir Ragu + Pasta", price: 225, category: "pasta", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766603/ragu.png", requiresPasta: true, description: "Rich 6-hour slow-cooked AU beef pulled into a seamless, velvety ragu, topped with sharp Pecorino cheese. // Recommend pairing with Radiatori." },
  { id: "bolognese", name: "Polished Pork Bolognese + Pasta", price: 195, category: "pasta", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766599/bolognese.png", requiresPasta: true, description: "A deeply layered, slow-simmered homemade pork Bolognese infused with aromatic herbs for a smooth Italian finish. // Recommend pairing with Rigatoni." },

  // -- Soup --
  { id: "chicken_soup", name: "Creamy Chicken Soup", price: 165, category: "soup", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766600/cs.png", description: "A rich, velvety homemade cream soup crafted with tender chicken thighs and vegetables for the ultimate warm hug. // Recommend pairing with Lumache." },
  { id: "pecorino_soup", name: "Pecorino & Broccoli Cream Soup", price: 165, category: "soup", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766599/bs.png", description: "A sophisticated, warming cream soup driven by sharp Pecorino cheese, tender broccoli florets, and shredded chicken. // Recommend pairing with Lumache." },

  // -- Extras: pasta sold on its own, browsable any time (not tied to
  //    ordering a stew first). Prices come from PASTA_OPTIONS.extraPrice
  //    below, images are the same photos as the pasta picker uses.
  { id: "extra_tubetti", name: "Tubetti (Extra)", price: 45, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766571/tubetti.jpg", description: "Mini tubes, perfect for stews and soups" },
  { id: "extra_radiatori", name: "Radiatori (Extra)", price: 45, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/radiatori.jpg", description: "Distinctive ruffles, ultimate sauce hold" },
  { id: "extra_rigatoni", name: "Rigatoni (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766571/rigatoni.jpg", description: "Large ridged tubes, built for every rich sauce" },
  { id: "extra_lumache", name: "Lumache (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766580/lumache_v.jpg", description: "Snail shells, maximum sauce inside" },
  { id: "extra_linguine", name: "Linguine (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/linguine.png", description: "Flat, silky strands. Perfect coat" },
  { id: "extra_spaghetti", name: "Spaghetti (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766575/spaghetti.jpg", description: "The timeless, classic long strand" },

  // -- Drinks: prices pulled from the Menu Summary tab's Drinks table
  //    (direct-order selling price, not the Grab-marked-up price). Two
  //    drinks in that sheet (MaisonPerrier Pineapple&Mango, Old Jamaica
  //    Ginger beer) have no selling price set and are left out for now --
  //    add them here the same way once they're priced and back in stock.
  { id: "drink_maisonperrier_forever_lemon", name: "MaisonPerrier - Forever Lemon", price: 68, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789041104/MaisonPerrier_ForeverLemon.heic" },
  { id: "drink_enziero_golden_apple_yuzu", name: "EN Ziero - Golden Apple & Yuzu", price: 38, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789041110/ENZiero_GoldenAppleandYuzu.heic" },
  { id: "drink_juza_sparkling", name: "Juza - Sparkling Orange, Lemon", price: 48, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789041103/Juza_SparklingOrangeLemon.heic" },
  { id: "drink_coke_original", name: "Coke Original", price: 38, category: "drinks", image: null },
  { id: "drink_coke_zero", name: "Coke Zero Zero", price: 38, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789043475/Coke_ZeroZero.heic" },
  { id: "drink_eden_green_apple", name: "Eden - Green Apple Sparkling", price: 38, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789043475/EdenGreen_AppleSparkling.heic" },
  { id: "drink_prebo_classic_muscat", name: "Prebo Pop - Classic Muscat", price: 48, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789043474/PreboPop_ClassicMuscat.heic" },
  { id: "drink_prebo_cream_cloud", name: "Prebo Pop - Cream Cloud", price: 48, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789041102/prebo_creamcloud.jpg" },
  { id: "drink_aw_rootbeer", name: "A&W Root Beer", price: 38, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789043474/AW_RootBeer.heic" },
  { id: "drink_sourhours_ginger_lemon", name: "Sour Hours - Ginger Lemon", price: 58, category: "drinks", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1789043474/SourHours_GingerLemon.heic" },
];

// Pasta/noodle types. Used two ways:
//  1. Mandatory choice for dishes marked "requiresPasta: true" above
//     (Bolognese, Ragu). Free for most types -- mandatorySurcharge adds
//     a small charge on top for Tubetti/Radiatori.
//  2. The quick "add pasta on the side?" upsell offered right after
//     adding a stew -- uses extraPrice, the same price as the Extras
//     category items above (keep both in sync if you change a price).
// image -- same as dishes: a direct https:// link, or null to skip the photo.
// IMPORTANT: if you add a photo here, use the SAME image link on the
// matching "extra_<name>" item in MENU above, so they stay consistent.
const PASTA_OPTIONS = [
  { id: "tubetti", name: "Tubetti", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766575/spaghetti.jpg", mandatorySurcharge: 5, extraPrice: 45 },
  { id: "radiatori", name: "Radiatori", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/radiatori.jpg", mandatorySurcharge: 5, extraPrice: 45 },
  { id: "rigatoni", name: "Rigatoni", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766571/rigatoni.jpg", mandatorySurcharge: 0, extraPrice: 40 },
  { id: "lumache", name: "Lumache", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/lumache.jpeg", mandatorySurcharge: 0, extraPrice: 40 },
  { id: "linguine", name: "Linguine", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/linguine.png", mandatorySurcharge: 0, extraPrice: 40 },
  { id: "spaghetti", name: "Spaghetti", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766575/spaghetti.jpg", mandatorySurcharge: 0, extraPrice: 40 },
];

// Serving size choices, used for dishes marked "requiresSize: true" above
// (Red Wine Beef Stew, Dark Beer Stew). Mirrors the PASTA_OPTIONS pattern --
// "Regular" is the base price already on the dish, "Large" adds
// mandatorySurcharge on top. Change the surcharge here if the price gap
// between sizes ever changes.
const SIZE_OPTIONS = [
  { id: "regular", name: "Regular", mandatorySurcharge: 0 },
  { id: "large", name: "Large", mandatorySurcharge: 100 },
];

// ============================================================
// ADMIN SHORT ALIASES (for "soldout"/"instock" texts from Lily's LINE)
// ============================================================
// Purpose: let Lily type a short word from the kitchen instead of the
// full item id (and, for rws/dbs, instead of the id+size combo).
//
// - Left side: the short word she types, e.g. "soldout juza"
// - Right side: the REAL id (or "id_size" for size-based dishes) it maps to
//
// Rules for adding a new alias:
//   1. Pick a short word not already used as a key below.
//   2. Point it at an id from MENU above (or PASTA_OPTIONS/SIZE_OPTIONS
//      combos -- see rws/dbs pattern).
//   3. For rws/dbs (requiresSize: true), soldout/instock must target one
//      size specifically -- there's no single "whole dish" stock flag for
//      these two. Marking a whole dish sold out regardless of size means
//      aliasing BOTH sizes, e.g. "rws" -> "rws_regular" and a separate
//      "rwsl" -> "rws_large" if she ever needs to close only Large.
//      Below, "rws" and "dbs" are wired to close BOTH sizes at once via
//      ADMIN_ALIAS_GROUPS, since that's what she actually asked for
//      ("Soldout rws" should just close the whole stew).
// ============================================================

// Simple 1:1 aliases -- short word maps to exactly one real id.
const ADMIN_ID_ALIASES = {
  bacon: "bacon_steak",
  tuscan: "tuscan",              // already short; kept for consistency
  ragu: "ragu",                  // already short; kept for consistency
  bolo: "bolognese",
  chix: "chicken_soup",
  brocs: "pecorino_soup",

  // Extras (loose pasta)
  tubet: "extra_tubetti",
  radi: "extra_radiatori",
  riga: "extra_rigatoni",
  luma: "extra_lumache",
  ling: "extra_linguine",
  spa: "extra_spaghetti",

  // Drinks
  perrier: "drink_maisonperrier_forever_lemon",
  enziero: "drink_enziero_golden_apple_yuzu",
  juza: "drink_juza_sparkling",
  coke: "drink_coke_original",
  cokez: "drink_coke_zero",
  eden: "drink_eden_green_apple",
  prebom: "drink_prebo_classic_muscat",
  preboc: "drink_prebo_cream_cloud",
  aw: "drink_aw_rootbeer",
  sour: "drink_sourhours_ginger_lemon",
};

// Group aliases -- one short word closes/opens MULTIPLE real ids at once.
// This is for rws/dbs: typing "soldout rws" closes both Regular and Large
// in one go, instead of needing "soldout rws_regular" AND "soldout rws_large".
const ADMIN_ALIAS_GROUPS = {
  rws: ["rws_regular", "rws_large"],
  dbs: ["dbs_regular", "dbs_large"],
};

// Size sub-selector -- used when a group alias is followed by a second
// token, e.g. "soldout rws l" or "instock dbs r". Only applies to ids
// listed in ADMIN_ALIAS_GROUPS above. Maps the short size letter to the
// suffix used in that group's id list ("rws_regular" / "rws_large").
//   "soldout rws"    -> closes rws_regular AND rws_large (the whole group)
//   "soldout rws l"  -> closes rws_large only
//   "soldout rws r"  -> closes rws_regular only
const ADMIN_GROUP_SIZE_SUFFIXES = {
  r: "regular",
  l: "large",
};

module.exports = {
  MENU,
  CATEGORIES,
  PASTA_OPTIONS,
  SIZE_OPTIONS,
  ADMIN_ID_ALIASES,
  ADMIN_ALIAS_GROUPS,
  ADMIN_GROUP_SIZE_SUFFIXES,
};
