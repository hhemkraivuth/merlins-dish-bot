// ============================================================
// MERLIN'S DISH -- MENU CONFIG
// ============================================================
// This is the ONLY file you should need to edit when a price or
// dish changes. Each line is one item the customer can tap to order.
//
// id       -- short code, no spaces. Never reuse an id for a different dish.
// name     -- what the customer sees on the button and in the order summary.
// price    -- selling price in Baht, matching your Menu Summary tab.
//
// To add a dish: copy a line, change id/name/price.
// To remove a dish: delete its line (or put "active: false" -- see bottom item).
// To change a price: just change the number.
//
// Prices below were pulled from your Menu Summary tab on the day this
// bot was built. Double check them against the sheet before going live,
// and re-check any time you run a price change.
// ============================================================

const MENU = [
  { id: "rws_r", name: "Red Wine Beef Stew (Regular)", price: 285 },
  { id: "rws_l", name: "Red Wine Beef Stew (Large)", price: 385 },
  { id: "dbs_r", name: "Dark Beer Stew (Regular)", price: 265 },
  { id: "dbs_l", name: "Dark Beer Stew (Large)", price: 365 },
  { id: "rustic", name: "Rustic Beef Stew", price: 225 },
  { id: "tuscan", name: "Tuscan Pork Braise", price: 245 },
  { id: "bolognese", name: "Polished Pork Bolognese + Pasta", price: 195 },
  { id: "ragu", name: "Noir Ragu + Pasta", price: 225 },
  { id: "chicken_soup", name: "Creamy Chicken Soup", price: 165 },
  { id: "pecorino_soup", name: "Pecorino & Broccoli Cream Soup", price: 165 },
  { id: "mushroom_soup", name: "Mushroom Soup", price: 1 },
];

module.exports = MENU;
