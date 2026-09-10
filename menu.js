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
  { id: "extra_lumache", name: "Lumache (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/lumache.jpeg", description: "Snail shells, maximum sauce inside" },
  { id: "extra_linguine", name: "Linguine (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766572/linguine.png", description: "Flat, silky strands. Perfect coat" },
  { id: "extra_spaghetti", name: "Spaghetti (Extra)", price: 40, category: "extras", image: "https://res.cloudinary.com/x2znhtgb/image/upload/v1788766575/spaghetti.jpg", description: "The timeless, classic long strand" },

  // -- Drinks: prices pulled from the Menu Summary tab's Drinks table
  //    (direct-order selling price, not the Grab-marked-up price). Two
  //    drinks in that sheet (MaisonPerrier Pineapple&Mango, Old Jamaica
  //    Ginger beer) have no selling price set and are left out for now --
  //    add them here the same way once they're priced and back in stock.
  { id: "drink_maisonperrier_forever_lemon", name: "MaisonPerrier - Forever Lemon", price: 68, category: "drinks", image: null },
  { id: "drink_enziero_golden_apple_yuzu", name: "EN Ziero - Golden Apple & Yuzu", price: 38, category: "drinks", image: null },
  { id: "drink_juza_sparkling", name: "Juza - Sparkling Orange, Lemon", price: 48, category: "drinks", image: null },
  { id: "drink_coke_original", name: "Coke Original", price: 38, category: "drinks", image: null },
  { id: "drink_coke_zero", name: "Coke Zero Zero", price: 38, category: "drinks", image: null },
  { id: "drink_eden_green_apple", name: "Eden - Green Apple Sparkling", price: 38, category: "drinks", image: null },
  { id: "drink_prebo_classic_muscat", name: "Prebo Pop - Classic Muscat", price: 48, category: "drinks", image: null },
  { id: "drink_prebo_cream_cloud", name: "Prebo Pop - Cream Cloud", price: 48, category: "drinks", image: null },
  { id: "drink_aw_rootbeer", name: "A&W Root Beer", price: 38, category: "drinks", image: null },
  { id: "drink_sourhours_ginger_lemon", name: "Sour Hours - Ginger Lemon", price: 58, category: "drinks", image: null },
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

module.exports = { MENU, CATEGORIES, PASTA_OPTIONS, SIZE_OPTIONS };
