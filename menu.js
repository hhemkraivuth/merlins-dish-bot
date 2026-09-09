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
];

const MENU = [
  // -- Spotlight --
  { id: "bacon_steak", name: "Bacon Steak", price: 95, category: "spotlight", image: "https://raw.githubusercontent.com/hhemkraivuth/merlins-dish-bot/main/images/BaconSteak.png" },

  // -- Main Dishes --
  { id: "rws_r", name: "Red Wine Beef Stew (Regular)", price: 285, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766600/rws.png" },
  { id: "rws_l", name: "Red Wine Beef Stew (Large)", price: 385, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766600/rws.png" },
  { id: "dbs_r", name: "Dark Beer Stew (Regular)", price: 265, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766601/dbs.png" },
  { id: "dbs_l", name: "Dark Beer Stew (Large)", price: 365, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766601/dbs.png" },
  { id: "tuscan", name: "Tuscan Pork Braise", price: 245, category: "mains", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766599/tpb.png" },

  // -- Pasta (bundled dishes, pasta choice is mandatory and mostly free,
  //    Tubetti/Radiatori add a small surcharge -- see PASTA_OPTIONS below) --
  { id: "ragu", name: "Noir Ragu + Pasta", price: 225, category: "pasta", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766603/ragu.png", requiresPasta: true },
  { id: "bolognese", name: "Polished Pork Bolognese + Pasta", price: 195, category: "pasta", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766599/bolognese.png", requiresPasta: true },

  // -- Soup --
  { id: "chicken_soup", name: "Creamy Chicken Soup", price: 165, category: "soup", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766600/cs.png" },
  { id: "pecorino_soup", name: "Pecorino & Broccoli Cream Soup", price: 165, category: "soup", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766599/bs.png" },

  // -- Extras: pasta sold on its own, browsable any time (not tied to
  //    ordering a stew first). Prices come from PASTA_OPTIONS.extraPrice
  //    below, images are the same photos as the pasta picker uses.
  { id: "extra_tubetti", name: "Tubetti (Extra)", price: 45, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766571/tubetti.jpg" },
  { id: "extra_radiatori", name: "Radiatori (Extra)", price: 45, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/radiatori.jpg" },
  { id: "extra_rigatoni", name: "Rigatoni (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766571/rigatoni.jpg" },
  { id: "extra_linguine", name: "Linguine (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/linguine.png" },
  { id: "extra_spaghetti", name: "Spaghetti (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766575/spaghetti.jpg" },
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
  { id: "linguine", name: "Linguine", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/linguine.png", mandatorySurcharge: 0, extraPrice: 40 },
  { id: "spaghetti", name: "Spaghetti", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766575/spaghetti.jpg", mandatorySurcharge: 0, extraPrice: 40 },
];

module.exports = { MENU, CATEGORIES, PASTA_OPTIONS };
