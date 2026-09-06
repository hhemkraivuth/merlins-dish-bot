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
  { id: "mains", label: "🍲 Main Dishes" },
  { id: "pasta", label: "🍝 Pasta" },
  { id: "soup", label: "🥣 Soup" },
];

const MENU = [
  { id: "rws_r", name: "Red Wine Beef Stew (Regular)", price: 285, category: "mains", image: null },
  { id: "rws_l", name: "Red Wine Beef Stew (Large)", price: 385, category: "mains", image: null },
  { id: "dbs_r", name: "Dark Beer Stew (Regular)", price: 265, category: "mains", image: null },
  { id: "dbs_l", name: "Dark Beer Stew (Large)", price: 365, category: "mains", image: null },
  { id: "tuscan", name: "Tuscan Pork Braise", price: 245, category: "mains", image: null },
  { id: "bolognese", name: "Polished Pork Bolognese + Pasta", price: 195, category: "pasta", image: null },
  { id: "ragu", name: "Noir Ragu + Pasta", price: 225, category: "pasta", image: null },
  { id: "chicken_soup", name: "Creamy Chicken Soup", price: 165, category: "soup", image: null },
  { id: "pecorino_soup", name: "Pecorino & Broccoli Cream Soup", price: 165, category: "soup", image: null },
  { id: "mushroom_soup", name: "Mushroom Soup", price: 165, category: "soup", image: null },
];

module.exports = { MENU, CATEGORIES };
