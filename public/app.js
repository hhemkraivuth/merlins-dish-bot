// ============================================================
// MERLIN'S DISH -- LIFF ORDERING APP
// ============================================================
// This is a plain JavaScript single-page app (no build step, no
// framework) so it can be edited directly on GitHub like the rest
// of the bot. It talks to the same Express server as the LINE bot
// (see server.js for the /api/* routes this file calls).
//
// ONE THING TO EDIT: paste your real LIFF ID below once you've
// created it in the LINE Developers Console (see README).
// ============================================================

const LIFF_ID = "2011487934-vA458ABe";

let MENU = [];
let CATEGORIES = [];
let PASTA_OPTIONS = [];
let SIZE_OPTIONS = [];
let SHOP_INFO = {};
let LINE_USER_ID = null;

// cart: lineId -> { itemId, name, price, qty, pastaChoice, sizeChoice }
let cart = {};

let timing = "ASAP";
let scheduleText = "";
let deliveryLocation = null; // { lat, lng } or null
let manualAddress = "";
let needsManualFee = null; // true/false/null (unknown yet) -- only true beyond the flat-rate tiers (>5km)
let confirmedDeliveryFee = 0; // auto-set for 0-5km tiers, or set once Merlin's Dish replies for a >5km order
let feeRequestId = null; // sent back with the final order so the server can verify the fee itself
let distanceKm = null;

// ---------- delivery fee tiers ----------
// 0-2km: free. 2-5km: flat ฿50. >5km: manual confirmation by Merlin's Dish.
function computeDeliveryFee(km) {
  if (km <= 2) return { fee: 0, manual: false, label: "FREE (within 2km)" };
  if (km <= 5) return { fee: 50, manual: false, label: "฿50 (2-5km)" };
  return { fee: null, manual: true, label: null };
}
let addressNote = "";
let paymentMethod = "bank";
let slipFile = null;

// ---------- loyalty / free pasta reward ----------
// ---------- loyalty / reward ladder ----------
const TIER_LOW = 5;
const TIER_HIGH = 10;
const REWARD_LINE_ID = "__reward__"; // reserved cart key, never a real menu id
let loyaltyState = null; // last /api/customer-lookup response, or null before first lookup
let redeemChosen = false; // customer ticked the reward checkbox
let redeemTier = null; // 5 | 10 -- which tier is being redeemed, when eligible for both
let selectedRewardDishId = null; // tier 10 only -- which dish from the dropdown
let selectedRewardPastaId = "rigatoni"; // only relevant if that dish requiresPasta
let lastLookedUpPhone = "";

// ---------- screen navigation ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

function showToast(message, isError) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("toast-error", !!isError);
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), isError ? 5000 : 3500);
}

function flashInvalid(elementId) {
  const el = document.getElementById(elementId);
  el.classList.add("flash-invalid");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => el.classList.remove("flash-invalid"), 1600);
}

// ---------- startup ----------

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      LINE_USER_ID = profile.userId;
    }
  } catch (err) {
    console.error("LIFF init failed (continuing anyway for browser testing):", err);
  }

  try {
    const [menuRes, shopRes] = await Promise.all([
      fetch("/api/menu").then((r) => r.json()),
      fetch("/api/shop-info").then((r) => r.json()),
    ]);
    MENU = menuRes.items;
    CATEGORIES = menuRes.categories;
    PASTA_OPTIONS = menuRes.pastaOptions;
    SIZE_OPTIONS = menuRes.sizeOptions;
    SHOP_INFO = shopRes;
  } catch (err) {
    console.error(err);
    showToast("Couldn't load the menu. Please reopen the app.");
    return;
  }

  if (SHOP_INFO.isOpen === false) {
    document.getElementById("closed-message").textContent =
      SHOP_INFO.closedMessage || "Merlin's Dish is open Monday-Friday, 11:00-21:00.";
  }

  renderCategoryTabs();
  renderItemList();
  wireStaticEvents();
  showDirectOrderScreen();
}

// Shown once per app open, as its own screen between the loading screen and
// the menu -- closing it (X or the continue button) moves on to the menu
// screen where ordering actually happens.
function showDirectOrderScreen() {
  showScreen("direct-order-screen");
  const goToMenu = () => showScreen("menu-screen");
  document.getElementById("direct-order-modal-close").addEventListener("click", goToMenu, { once: true });
  document.getElementById("direct-order-modal-continue").addEventListener("click", goToMenu, { once: true });
}

// ---------- menu rendering ----------

function renderCategoryTabs() {
  const nav = document.getElementById("category-tabs");
  nav.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "cat-tab";
    btn.textContent = cat.label;
    btn.dataset.cat = cat.id;
    btn.addEventListener("click", () => {
      const section = document.getElementById(`section-${cat.id}`);
      if (!section) return;
      const navHeight = document.getElementById("category-tabs").offsetHeight;
      const top = section.getBoundingClientRect().top + window.scrollY - navHeight - 8;
      window.scrollTo({ top, behavior: "smooth" });
    });
    nav.appendChild(btn);
  });
  setActiveTab(CATEGORIES[0] && CATEGORIES[0].id);
}

function setActiveTab(catId) {
  document.querySelectorAll(".cat-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === catId);
  });
}

// One continuous scrolling list, sectioned by category, instead of
// swiping between separate category screens.
function renderItemList() {
  const list = document.getElementById("item-list");
  list.innerHTML = "";

  CATEGORIES.forEach((cat) => {
    const items = MENU.filter((d) => d.category === cat.id);
    if (items.length === 0) return;

    const heading = document.createElement("h2");
    heading.className = "category-heading";
    heading.id = `section-${cat.id}`;
    heading.textContent = cat.label;
    list.appendChild(heading);

    items.forEach((dish) => list.appendChild(buildItemCard(dish)));
  });

  setupSectionScrollSpy();
}

// Highlights the matching tab as its section scrolls into view.
function setupSectionScrollSpy() {
  const sections = CATEGORIES.map((c) => document.getElementById(`section-${c.id}`)).filter(Boolean);
  if (!sections.length || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const catId = entry.target.id.replace("section-", "");
          setActiveTab(catId);
        }
      });
    },
    { rootMargin: "-30% 0px -60% 0px" }
  );
  sections.forEach((el) => observer.observe(el));
}

function buildItemCard(dish) {
  const card = document.createElement("div");
  card.className = "item-card" + (!dish.available ? " unavailable" : "");

  const img = dish.image
    ? `<img class="item-img" src="${dish.image}" alt="${dish.name}" />`
    : `<div class="item-img placeholder">🍽️</div>`;

  let stockNote = "";
  if (!dish.available) {
    stockNote = `<p class="sold-out-note">Sold out today</p>`;
  } else if (dish.remaining != null && dish.remaining <= 5) {
    stockNote = `<p class="stock-note">Only ${dish.remaining} left</p>`;
  }

  if (dish.requiresSize) {
    card.innerHTML = `
      ${img}
      <div class="item-body">
        <h3>${dish.name}</h3>
        ${dish.description ? `<p class="item-description">${dish.description}</p>` : ""}
        <p class="item-price">฿${dish.price}</p>
        ${stockNote}
        <select class="size-select" ${!dish.available ? "disabled" : ""}>
          <option value="">Choose serving size...</option>
          ${SIZE_OPTIONS.map(
            (s) =>
              `<option value="${s.id}">${s.name}${s.mandatorySurcharge ? ` (+฿${s.mandatorySurcharge})` : ""}</option>`
          ).join("")}
        </select>
        <div class="variant-row">
          <div class="stepper local-stepper" data-qty="0">
            <button type="button" class="minus">−</button>
            <span class="qty">0</span>
            <button type="button" class="plus">+</button>
          </div>
          <button type="button" class="add-line-btn" disabled>Add</button>
        </div>
      </div>
    `;
    const select = card.querySelector(".size-select");
    const stepper = card.querySelector(".local-stepper");
    const addBtn = card.querySelector(".add-line-btn");
    const qtyEl = stepper.querySelector(".qty");

    const updateAddEnabled = () => {
      const qty = parseInt(stepper.dataset.qty, 10);
      addBtn.disabled = !dish.available || !select.value || qty < 1;
    };
    select.addEventListener("change", updateAddEnabled);

    stepper.querySelector(".minus").addEventListener("click", () => {
      let n = parseInt(stepper.dataset.qty, 10);
      if (n > 0) {
        n -= 1;
        stepper.dataset.qty = n;
        qtyEl.textContent = n;
        updateAddEnabled();
      }
    });
    stepper.querySelector(".plus").addEventListener("click", () => {
      let n = parseInt(stepper.dataset.qty, 10);
      const max = dish.remaining != null ? dish.remaining : Infinity;
      if (n < max) {
        n += 1;
        stepper.dataset.qty = n;
        qtyEl.textContent = n;
        updateAddEnabled();
      }
    });

    addBtn.addEventListener("click", () => {
      const sizeId = select.value;
      const qty = parseInt(stepper.dataset.qty, 10);
      if (qty < 1) return;
      const size = SIZE_OPTIONS.find((s) => s.id === sizeId);
      const surcharge = size ? size.mandatorySurcharge || 0 : 0;
      const lineId = `${dish.id}:${sizeId}`;
      const name = `${dish.name} (${size ? size.name : sizeId})`;
      addToCart(lineId, dish.id, name, dish.price + surcharge, qty, null, sizeId);
      showToast(`Added ${qty}x ${name}`);
      select.value = "";
      stepper.dataset.qty = 0;
      qtyEl.textContent = 0;
      updateAddEnabled();
    });

    updateAddEnabled();
  } else if (dish.requiresPasta) {
    const stepper = card.querySelector(".local-stepper");
    const addBtn = card.querySelector(".add-line-btn");
    const qtyEl = stepper.querySelector(".qty");

    const updateAddEnabled = () => {
      const qty = parseInt(stepper.dataset.qty, 10);
      addBtn.disabled = !dish.available || !select.value || qty < 1;
    };
    select.addEventListener("change", updateAddEnabled);

    stepper.querySelector(".minus").addEventListener("click", () => {
      let n = parseInt(stepper.dataset.qty, 10);
      if (n > 0) {
        n -= 1;
        stepper.dataset.qty = n;
        qtyEl.textContent = n;
        updateAddEnabled();
      }
    });
    stepper.querySelector(".plus").addEventListener("click", () => {
      let n = parseInt(stepper.dataset.qty, 10);
      const max = dish.remaining != null ? dish.remaining : Infinity;
      if (n < max) {
        n += 1;
        stepper.dataset.qty = n;
        qtyEl.textContent = n;
        updateAddEnabled();
      }
    });

    addBtn.addEventListener("click", () => {
      const pastaId = select.value;
      const qty = parseInt(stepper.dataset.qty, 10);
      if (qty < 1) return;
      const pasta = PASTA_OPTIONS.find((p) => p.id === pastaId);
      const surcharge = pasta ? pasta.mandatorySurcharge || 0 : 0;
      const lineId = `${dish.id}:${pastaId}`;
      const name = `${dish.name} (${pasta ? pasta.name : pastaId})`;
      addToCart(lineId, dish.id, name, dish.price + surcharge, qty, pastaId);
      showToast(`Added ${qty}x ${name}`);
      select.value = "";
      stepper.dataset.qty = 0;
      qtyEl.textContent = 0;
      updateAddEnabled();
    });

    updateAddEnabled();
  } else {
    const currentQty = cart[dish.id] ? cart[dish.id].qty : 0;
    card.innerHTML = `
      ${img}
      <div class="item-body">
        <h3>${dish.name}</h3>
        ${dish.description ? `<p class="item-description">${dish.description}</p>` : ""}
        <p class="item-price">฿${dish.price}</p>
        ${stockNote}
        <div class="stepper" data-item="${dish.id}">
          <button type="button" class="minus">−</button>
          <span class="qty">${currentQty}</span>
          <button type="button" class="plus">+</button>
        </div>
      </div>
    `;
    const stepper = card.querySelector(".stepper");
    const qtyEl = stepper.querySelector(".qty");

    stepper.querySelector(".minus").addEventListener("click", () => {
      if (!cart[dish.id]) return;
      cart[dish.id].qty -= 1;
      if (cart[dish.id].qty <= 0) delete cart[dish.id];
      qtyEl.textContent = cart[dish.id] ? cart[dish.id].qty : 0;
      updateCartBar();
    });
    stepper.querySelector(".plus").addEventListener("click", () => {
      if (!dish.available) return;
      const existingQty = cart[dish.id] ? cart[dish.id].qty : 0;
      const max = dish.remaining != null ? dish.remaining : Infinity;
      if (existingQty >= max) {
        showToast(`Only ${max} of "${dish.name}" left`);
        return;
      }
      addToCart(dish.id, dish.id, dish.name, dish.price, 1, null);
      qtyEl.textContent = cart[dish.id].qty;
      showToast(`Added 1x ${dish.name}`);
    });
  }

  return card;
}

function addToCart(lineId, itemId, name, price, qty, pastaChoice, sizeChoice) {
  if (cart[lineId]) {
    cart[lineId].qty += qty;
  } else {
    cart[lineId] = { itemId, name, price, qty, pastaChoice, sizeChoice: sizeChoice || null };
  }
  updateCartBar();
}

function cartLines() {
  return Object.entries(cart).map(([lineId, entry]) => ({ lineId, ...entry }));
}

function cartTotal() {
  return cartLines().reduce((sum, l) => sum + l.price * l.qty, 0);
}

// ---------- loyalty lookup ----------

function digitsOnly(str) {
  return (str || "").replace(/\D/g, "");
}

function updateCheckRewardEnabled() {
  const name = document.getElementById("cart-name-input").value.trim();
  const phone = document.getElementById("cart-phone-input").value.trim();
  const ok = name.length >= 2 && digitsOnly(phone).length >= 8;
  document.getElementById("check-reward-btn").disabled = !ok;
}

async function runCustomerLookup() {
  const phone = document.getElementById("cart-phone-input").value.trim();
  const digits = digitsOnly(phone);
  if (digits.length < 8) {
    loyaltyState = null;
    renderRewardBanner();
    return;
  }
  lastLookedUpPhone = phone;

  const btn = document.getElementById("check-reward-btn");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Checking...";

  try {
    const res = await fetch(`/api/customer-lookup?phone=${encodeURIComponent(phone)}`);
    loyaltyState = await res.json();
  } catch (err) {
    console.error("Customer lookup failed:", err);
    loyaltyState = null;
  }
  btn.textContent = originalLabel;
  updateCheckRewardEnabled();
  // Default which tier to offer: prefer the lower one if both are somehow
  // open (shouldn't happen once redeemed, but keeps this defensive).
  if (loyaltyState) {
    if (loyaltyState.canRedeemLow) redeemTier = TIER_LOW;
    else if (loyaltyState.canRedeemHigh) redeemTier = TIER_HIGH;
    else redeemTier = null;
  }
  renderRewardBanner();
}

// Merlin doesn't do fluff or sweet talk, just a straight, warm nudge.
function progressCopy(state) {
  if (!state || !state.found) {
    return "You're new here. Don't worry, your rewards start counting now.";
  }
  if (state.canRedeemHigh) {
    return "Order ten. This one's on Merlin's.";
  }
  if (state.canRedeemLow) {
    const toGo = state.ordersToHigh;
    return `You've earned it. Take it now, or hold out, ${toGo} more order${toGo === 1 ? "" : "s"} gets you the bigger reward.`;
  }
  const toGo = state.ordersToLow;
  return `${toGo} order${toGo === 1 ? "" : "s"} to your first reward.`;
}

function renderRewardBanner() {
  const banner = document.getElementById("reward-banner");
  const progressText = document.getElementById("reward-progress-text");
  const toggleRow = document.getElementById("reward-toggle-row");
  const toggleLabel = document.getElementById("reward-toggle-label");
  const checkbox = document.getElementById("redeem-reward-checkbox");

  if (!loyaltyState) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  progressText.textContent = progressCopy(loyaltyState);

  const canRedeemSomething = loyaltyState.canRedeemLow || loyaltyState.canRedeemHigh;
  toggleRow.classList.toggle("hidden", !canRedeemSomething);

  if (!canRedeemSomething) {
    checkbox.checked = false;
    redeemChosen = false;
    removeRewardLine();
    renderRedeemOptions();
    return;
  }

  const cfg = loyaltyState.rewardConfig || {};
  const itemLabel =
    redeemTier === TIER_LOW ? cfg.low.itemName : "pick your dish below";

  // Both tiers open at once only happens if canRedeemLow and canRedeemHigh
  // were both true, which the backend never actually returns together --
  // canRedeemLow is false once orderCount reaches 10. So there's always
  // exactly one tier on offer here.
  toggleLabel.textContent = `🎉 Use your reward now? (${itemLabel})`;
  renderRedeemOptions();
}

function renderRedeemOptions() {
  const select = document.getElementById("redeem-dish-select");
  const pastaSelect = document.getElementById("redeem-pasta-select");
  const surchargeNote = document.getElementById("redeem-surcharge-note");
  const cfg = loyaltyState && loyaltyState.rewardConfig;

  if (!redeemChosen || !cfg || redeemTier !== TIER_HIGH) {
    select.classList.add("hidden");
    pastaSelect.classList.add("hidden");
    surchargeNote.classList.add("hidden");
    syncRewardLine();
    return;
  }

  // Tier 10: show the dropdown of eligible dishes.
  select.classList.remove("hidden");
  select.innerHTML = cfg.high.dishChoices
    .map((d) => `<option value="${d.id}">${d.name}</option>`)
    .join("");
  if (!selectedRewardDishId || !cfg.high.dishChoices.some((d) => d.id === selectedRewardDishId)) {
    selectedRewardDishId = cfg.high.dishChoices[0] ? cfg.high.dishChoices[0].id : null;
  }
  select.value = selectedRewardDishId || "";

  // If the chosen dish requires a noodle pick (e.g. Bolognese), show the
  // pasta selector too, so premium noodle surcharges still apply even on
  // a free reward -- only the base dish is free, not an upgraded noodle.
  const chosenDish = MENU.find((d) => d.id === selectedRewardDishId);
  if (chosenDish && chosenDish.requiresPasta) {
    pastaSelect.classList.remove("hidden");
    pastaSelect.innerHTML = PASTA_OPTIONS.map(
      (p) => `<option value="${p.id}">${p.name}${p.mandatorySurcharge ? ` (+฿${p.mandatorySurcharge})` : ""}</option>`
    ).join("");
    if (!PASTA_OPTIONS.some((p) => p.id === selectedRewardPastaId)) {
      selectedRewardPastaId = PASTA_OPTIONS[0].id;
    }
    pastaSelect.value = selectedRewardPastaId;
    const chosenPasta = PASTA_OPTIONS.find((p) => p.id === selectedRewardPastaId);
    if (chosenPasta && chosenPasta.mandatorySurcharge) {
      surchargeNote.classList.remove("hidden");
      surchargeNote.textContent = `+฿${chosenPasta.mandatorySurcharge} noodle upgrade still applies on the free dish.`;
    } else {
      surchargeNote.classList.add("hidden");
    }
  } else {
    pastaSelect.classList.add("hidden");
    surchargeNote.classList.add("hidden");
  }

  syncRewardLine();
}

// Adds or removes the synthetic ฿0 reward line in the cart to match the
// current checkbox/dropdown state. This is the ONLY place that writes to
// cart[REWARD_LINE_ID], so the cart always reflects exactly what's chosen.
function syncRewardLine() {
  if (!redeemChosen || !redeemTier || !loyaltyState || !loyaltyState.rewardConfig) {
    removeRewardLine();
    updateCartBar();
    renderCartScreen();
    renderReviewLinesIfVisible();
    return;
  }

  const cfg = loyaltyState.rewardConfig;
  let dishId = null;
  if (redeemTier === TIER_LOW) {
    dishId = cfg.low.menuItemId;
  } else {
    dishId = selectedRewardDishId;
  }
  const dish = MENU.find((d) => d.id === dishId);
  if (!dish) {
    removeRewardLine();
    updateCartBar();
    renderCartScreen();
    return;
  }

  // Base dish is free; a premium noodle upgrade (Tubetti/Radiatori) still
  // carries its usual small surcharge even on a redeemed reward.
  let surcharge = 0;
  let pastaChoice = null;
  let displayName = dish.name;
  if (dish.requiresPasta) {
    pastaChoice = selectedRewardPastaId;
    const pasta = PASTA_OPTIONS.find((p) => p.id === pastaChoice);
    if (pasta) {
      surcharge = pasta.mandatorySurcharge || 0;
      displayName = `${dish.name} (${pasta.name})`;
    }
  }

  cart[REWARD_LINE_ID] = {
    itemId: dish.id,
    name: `${displayName} (reward, free)`,
    price: surcharge,
    qty: 1,
    pastaChoice: pastaChoice,
    isRewardLine: true,
  };
  updateCartBar();
  renderCartScreen();
  renderReviewLinesIfVisible();
}

function removeRewardLine() {
  delete cart[REWARD_LINE_ID];
}

// If the review screen happens to already be rendered (shouldn't usually
// change while on the cart screen, but the dropdown can be touched after
// coming back via the back button), keep it in sync too.
function renderReviewLinesIfVisible() {
  const reviewScreen = document.getElementById("review-screen");
  if (reviewScreen && reviewScreen.classList.contains("active")) {
    renderReviewScreen();
  }
}


function updateCartBar() {
  const bar = document.getElementById("cart-bar");
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  if (count === 0) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  document.getElementById("cart-count").textContent = `${count} item${count > 1 ? "s" : ""}`;
  document.getElementById("cart-total").textContent = `฿${cartTotal()}`;
}

// ---------- drinks/bacon upsell screen ----------

// Shown once, right before the cart, only if the customer hasn't already
// picked up a drink or the Bacon Steak -- a nudge to round out the order,
// not a nag on every visit to the cart.
function shouldShowUpsell() {
  const lines = cartLines();
  if (lines.length === 0) return false; // nothing to upsell against yet
  const hasDrinkOrBacon = lines.some((l) => {
    const dish = MENU.find((d) => d.id === l.itemId);
    return dish && (dish.category === "drinks" || dish.id === "bacon_steak");
  });
  return !hasDrinkOrBacon;
}

function renderUpsellScreen() {
  const wrap = document.getElementById("upsell-items");
  wrap.innerHTML = "";
  const upsellItems = MENU.filter((d) => (d.category === "drinks" || d.id === "bacon_steak") && !isUnavailableClient(d));

  upsellItems.forEach((dish) => {
    const row = document.createElement("div");
    row.className = "upsell-item-row";
    row.innerHTML = `
      <div class="upsell-item-info">
        <span class="upsell-item-name">${dish.name}</span>
        <span class="upsell-item-price">฿${dish.price}</span>
      </div>
      <button type="button" class="upsell-add-btn">Add</button>
    `;
    const btn = row.querySelector(".upsell-add-btn");
    btn.addEventListener("click", () => {
      addToCart(dish.id, dish.id, dish.name, dish.price, 1, null);
      btn.textContent = "Added ✓";
      btn.classList.add("added");
      btn.disabled = true;
      showToast(`Added 1x ${dish.name}`);
    });
    wrap.appendChild(row);
  });
}

// Client-side availability check mirroring isUnavailable() on the server --
// the /api/menu response already marks each item's "available" flag.
function isUnavailableClient(dish) {
  return !dish.available;
}

// ---------- cart review screen ----------

function renderCartScreen() {
  const wrap = document.getElementById("cart-lines");
  const lines = cartLines();
  wrap.innerHTML = "";
  if (lines.length === 0) {
    wrap.innerHTML = `<p class="empty-note">Your cart is empty.</p>`;
  } else {
    lines.forEach((l) => {
      const row = document.createElement("div");
      row.className = "cart-line";
      if (l.isRewardLine) {
        row.innerHTML = `
          <div class="cart-line-info">
            <div class="name">🎉 ${l.name}</div>
            <div class="price">฿0</div>
          </div>
        `;
        wrap.appendChild(row);
        return;
      }
      row.innerHTML = `
        <div class="cart-line-info">
          <div class="name">${l.name}</div>
          <div class="price">฿${l.price * l.qty}</div>
        </div>
        <div class="stepper cart-line-stepper">
          <button type="button" class="minus">−</button>
          <span class="qty">${l.qty}</span>
          <button type="button" class="plus">+</button>
        </div>
      `;
      const qtyEl = row.querySelector(".qty");
      row.querySelector(".minus").addEventListener("click", () => {
        cart[l.lineId].qty -= 1;
        if (cart[l.lineId].qty <= 0) delete cart[l.lineId];
        renderCartScreen();
        renderItemList();
        updateCartBar();
      });
      row.querySelector(".plus").addEventListener("click", () => {
        const dish = MENU.find((d) => d.id === l.itemId);
        const max = dish && dish.remaining != null ? dish.remaining : Infinity;
        if (l.qty >= max) {
          showToast(`Only ${max} of "${l.name}" left`, true);
          return;
        }
        cart[l.lineId].qty += 1;
        renderCartScreen();
        renderItemList();
        updateCartBar();
      });
      wrap.appendChild(row);
    });
  }
  document.getElementById("cart-screen-total").textContent = `฿${cartTotal()}`;
  updateCheckoutEnabled();
}

function updateCheckoutEnabled() {
  const name = document.getElementById("cart-name-input").value.trim();
  const phone = document.getElementById("cart-phone-input").value.trim();
  const hasItems = cartLines().length > 0;
  const hasContactInfo = name.length >= 2 && digitsOnly(phone).length >= 8;
  document.getElementById("checkout-btn").disabled = !(hasItems && hasContactInfo);
}

// ---------- delivery details screen ----------

function distanceKmBetween(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let map = null;
let mapMarker = null;

function ensureMapInitialized() {
  if (map) {
    // The map screen was hidden (display:none) when first created, so
    // its size wasn't known then -- fix that now that it's visible.
    setTimeout(() => map.invalidateSize(), 50);
    return;
  }
  if (typeof L === "undefined") {
    console.error("Leaflet failed to load -- falling back to manual address entry.");
    fallBackToManualAddress();
    return;
  }
  try {
    const defaultCenter = [SHOP_INFO.shopLat || 13.7563, SHOP_INFO.shopLng || 100.5018];
    map = L.map("map").setView(defaultCenter, 15);
    // Positron tiles (English/Latin place labels) instead of default OSM
    // tiles, which render Thai-script labels for locations in Thailand --
    // needed so foreign customers can read and pin their location correctly.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
    }).addTo(map);
    const redPinIcon = L.divIcon({
      className: "custom-pin-icon",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    mapMarker = L.marker(defaultCenter, { draggable: true, icon: redPinIcon }).addTo(map);
    mapMarker.on("dragend", () => {
      const pos = mapMarker.getLatLng();
      setDeliveryLocation(pos.lat, pos.lng);
    });
    // Try to center on the customer's real location first, but this is
    // just a starting point -- they can drag the pin anywhere from here,
    // e.g. when ordering for delivery somewhere they aren't right now.
    useMyLocation(true);
  } catch (err) {
    console.error("Map failed to initialize:", err);
    fallBackToManualAddress();
  }
}

function fallBackToManualAddress() {
  document.getElementById("map").outerHTML =
    '<p class="hint">Map couldn\'t load, please type your address below instead.</p>';
  document.getElementById("use-my-location-btn").classList.add("hidden");
  const details = document.querySelector(".manual-address-toggle");
  if (details) details.setAttribute("open", "");
}

function useMyLocation(silent) {
  if (!map || !mapMarker) return; // map failed to load; manual address is already shown instead
  if (!navigator.geolocation) {
    if (!silent) showToast("Location isn't available on this device. Drag the pin manually.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
      mapMarker.setLatLng([latitude, longitude]);
      setDeliveryLocation(latitude, longitude);
    },
    (err) => {
      console.error(err);
      if (!silent) showToast("Couldn't get your location. Please drag the pin manually.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function setDeliveryLocation(lat, lng) {
  deliveryLocation = { lat, lng };
  manualAddress = "";
  const resultEl = document.getElementById("location-result");
  resultEl.classList.remove("hidden", "free", "manual");
  if (SHOP_INFO.shopLat != null && SHOP_INFO.shopLng != null) {
    distanceKm = distanceKmBetween(SHOP_INFO.shopLat, SHOP_INFO.shopLng, lat, lng);
    const tier = computeDeliveryFee(distanceKm);
    needsManualFee = tier.manual;
    if (tier.manual) {
      resultEl.textContent = `${distanceKm.toFixed(1)}km away, outside our 5km delivery zone. Merlin's Dish will confirm the delivery fee shortly.`;
      resultEl.classList.add("manual");
    } else {
      confirmedDeliveryFee = tier.fee;
      resultEl.textContent =
        tier.fee === 0
          ? `${distanceKm.toFixed(1)}km away, free delivery! 🎉`
          : `${distanceKm.toFixed(1)}km away, delivery fee ฿${tier.fee}.`;
      resultEl.classList.add(tier.fee === 0 ? "free" : "flat-fee");
    }
  } else {
    needsManualFee = true;
    resultEl.textContent = "Location set. Delivery fee will be confirmed by Merlin's Dish.";
    resultEl.classList.add("manual");
  }
}

// ---------- delivery fee confirmation (>5km orders) ----------

let feePollActive = false;

async function requestDeliveryFeeAndWait() {
  feePollActive = true;
  showScreen("waiting-fee-screen");
  document.getElementById("waiting-fee-status").textContent =
    "Letting Merlin's Dish know about your delivery location...";

  let requestId;
  try {
    const res = await fetch("/api/request-delivery-fee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineUserId: LINE_USER_ID,
        items: cartLines().map((l) => ({ itemId: l.itemId, qty: l.qty, pastaChoice: l.pastaChoice, sizeChoice: l.sizeChoice })),
        distanceKm,
        addressNote,
      }),
    });
    const data = await res.json();
    requestId = data.requestId;
    feeRequestId = requestId;
  } catch (err) {
    console.error(err);
    document.getElementById("waiting-fee-status").textContent =
      "Couldn't reach Merlin's Dish. Please go back and try again.";
    return;
  }

  document.getElementById("waiting-fee-status").textContent =
    "Waiting for Merlin's Dish to confirm your delivery fee, this is usually quick...";
  pollDeliveryFee(requestId, 0);
}

function pollDeliveryFee(requestId, attempt) {
  if (!feePollActive) return; // customer navigated away -- stop polling

  if (attempt === 40) {
    // ~2 minutes in at 3s each -- reassure, but keep polling.
    document.getElementById("waiting-fee-status").textContent =
      "Still waiting, this is taking longer than usual. Feel free to keep waiting, or message us directly on LINE.";
  }

  fetch(`/api/delivery-fee/${requestId}`)
    .then((r) => r.json())
    .then((data) => {
      if (!feePollActive) return;
      if (data.status === "confirmed") {
        feePollActive = false;
        confirmedDeliveryFee = data.fee;
        renderReviewScreen();
        showScreen("review-screen");
      } else {
        setTimeout(() => pollDeliveryFee(requestId, attempt + 1), 3000);
      }
    })
    .catch((err) => {
      console.error(err);
      setTimeout(() => pollDeliveryFee(requestId, attempt + 1), 5000);
    });
}

// ---------- review & pay screen ----------

function renderReviewScreen() {
  const linesWrap = document.getElementById("review-lines");
  linesWrap.innerHTML = cartLines()
    .map((l) => `<div class="summary-line"><span>${l.isRewardLine ? "🎉 " : ""}${l.qty}x ${l.name}</span><span>฿${l.price * l.qty}</span></div>`)
    .join("");
  const foodTotal = cartTotal();
  const grandTotal = foodTotal + confirmedDeliveryFee;
  document.getElementById("review-food-total").textContent = `฿${foodTotal}`;
  document.getElementById("review-delivery").textContent =
    confirmedDeliveryFee === 0 ? "FREE (within 2km)" : `฿${confirmedDeliveryFee}`;
  document.getElementById("review-timing").textContent =
    timing === "ASAP" ? "Right away" : `Scheduled: ${scheduleText || "(not set)"}`;
  document.getElementById("review-grand-total").textContent = `฿${grandTotal}`;

  document.getElementById("pay-bank-info").textContent =
    `Transfer to ${SHOP_INFO.paymentInfo || "our bank account"}`;
  const qrImg = document.getElementById("pay-qr-image");
  if (SHOP_INFO.qrImageUrl) {
    qrImg.src = SHOP_INFO.qrImageUrl;
  }
  applyPaymentMethodUI();
  updatePlaceOrderEnabled();
}

// True if the reward line is actually sitting in the cart right now.
// It only ever gets added by syncRewardLine() when eligible, so its
// mere presence is sufficient here -- the server re-validates
// eligibility independently regardless.
function isRedeemingReward() {
  return !!cart[REWARD_LINE_ID];
}

function applyPaymentMethodUI() {
  document.getElementById("pay-bank-info").classList.toggle("hidden", paymentMethod !== "bank");
  document.getElementById("pay-qr-image").classList.toggle("hidden", paymentMethod !== "qr");
}

function updatePlaceOrderEnabled() {
  const name = document.getElementById("cart-name-input").value.trim();
  const phone = document.getElementById("cart-phone-input").value.trim();
  const ok = !!slipFile && name.length >= 2 && digitsOnly(phone).length >= 8;
  document.getElementById("place-order-btn").disabled = !ok;
}

// ---------- submit order ----------

async function submitOrder() {
  const btn = document.getElementById("place-order-btn");
  const status = document.getElementById("submit-status");
  btn.disabled = true;
  status.textContent = "Verifying your payment…";

  const order = {
    lineUserId: LINE_USER_ID,
    items: cartLines().map((l) => ({ itemId: l.itemId, qty: l.qty, pastaChoice: l.pastaChoice, sizeChoice: l.sizeChoice, isRewardLine: !!l.isRewardLine })),
    timing,
    scheduleText,
    location: deliveryLocation,
    addressText: manualAddress || null,
    addressNote: document.getElementById("address-note").value.trim(),
    needsManualFee,
    feeRequestId: needsManualFee ? feeRequestId : null,
    distanceKm,
    name: document.getElementById("cart-name-input").value.trim(),
    phone: document.getElementById("cart-phone-input").value.trim(),
    paymentMethod,
    redeemTier: isRedeemingReward() ? redeemTier : null,
  };

  const form = new FormData();
  form.append("order", JSON.stringify(order));
  form.append("slip", slipFile);

  try {
    const res = await fetch("/api/place-order", { method: "POST", body: form });
    const data = await res.json();

    if (!data.success) {
      status.textContent = data.message || "Something went wrong, please try again.";
      btn.disabled = false;
      return;
    }

    document.getElementById("confirm-message").textContent =
      "All set! The food will be with you shortly. You can close this window.";
    showScreen("confirm-screen");
  } catch (err) {
    console.error(err);
    status.textContent = "Couldn't reach the kitchen. Check your connection and try again.";
    btn.disabled = false;
  }
}

function resetOrder() {
  cart = {};
  timing = "ASAP";
  scheduleText = "";
  deliveryLocation = null;
  manualAddress = "";
  needsManualFee = null;
  confirmedDeliveryFee = 0;
  feeRequestId = null;
  feePollActive = false;
  distanceKm = null;
  slipFile = null;
  document.getElementById("schedule-text").value = "";
  document.getElementById("manual-address").value = "";
  document.getElementById("address-note").value = "";
  document.getElementById("cart-name-input").value = "";
  document.getElementById("cart-phone-input").value = "";
  document.getElementById("slip-input").value = "";
  document.getElementById("slip-preview").classList.add("hidden");
  document.getElementById("location-result").classList.add("hidden");
  loyaltyState = null;
  redeemChosen = false;
  redeemTier = null;
  selectedRewardDishId = null;
  selectedRewardPastaId = "rigatoni";
  lastLookedUpPhone = "";
  document.getElementById("redeem-reward-checkbox").checked = false;
  document.getElementById("reward-banner").classList.add("hidden");
  document.getElementById("check-reward-btn").disabled = true;
  document.getElementById("check-reward-btn").textContent = "Check your reward";
  updateCartBar();
  renderItemList();
  showScreen("menu-screen");
}

// ---------- wiring ----------

function wireStaticEvents() {
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back));
  });

  document.getElementById("view-cart-btn").addEventListener("click", () => {
    renderCartScreen();
    showScreen("cart-screen");
  });

  document.getElementById("checkout-btn").addEventListener("click", () => {
    if (shouldShowUpsell()) {
      renderUpsellScreen();
      showScreen("upsell-screen");
    } else {
      showScreen("delivery-screen");
      ensureMapInitialized();
    }
  });

  document.getElementById("upsell-skip-btn").addEventListener("click", () => {
    renderCartScreen();
    showScreen("delivery-screen");
    ensureMapInitialized();
  });
  document.getElementById("upsell-continue-btn").addEventListener("click", () => {
    renderCartScreen();
    showScreen("delivery-screen");
    ensureMapInitialized();
  });

  document.getElementById("cart-name-input").addEventListener("input", () => {
    updateCheckoutEnabled();
    updateCheckRewardEnabled();
  });
  document.getElementById("cart-phone-input").addEventListener("input", () => {
    updateCheckoutEnabled();
    updateCheckRewardEnabled();
  });
  document.getElementById("check-reward-btn").addEventListener("click", runCustomerLookup);

  document.getElementById("redeem-reward-checkbox").addEventListener("change", (e) => {
    redeemChosen = e.target.checked;
    renderRedeemOptions();
  });
  document.getElementById("redeem-dish-select").addEventListener("change", (e) => {
    selectedRewardDishId = e.target.value;
    renderRedeemOptions();
  });
  document.getElementById("redeem-pasta-select").addEventListener("change", (e) => {
    selectedRewardPastaId = e.target.value;
    renderRedeemOptions();
  });

  document.querySelectorAll("[data-timing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      timing = btn.dataset.timing;
      document.querySelectorAll("[data-timing]").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("schedule-text").classList.toggle("hidden", timing !== "SCHEDULED");
    });
  });
  document.getElementById("schedule-text").addEventListener("input", (e) => {
    scheduleText = e.target.value;
  });

  document.getElementById("use-my-location-btn").addEventListener("click", () => useMyLocation(false));
  document.getElementById("manual-address").addEventListener("input", (e) => {
    manualAddress = e.target.value;
    if (manualAddress.trim().length >= 5) {
      deliveryLocation = null;
      needsManualFee = true;
      distanceKm = null;
    }
  });

  document.getElementById("to-review-btn").addEventListener("click", async () => {
    if (!deliveryLocation && manualAddress.trim().length < 5) {
      showToast("Please set your delivery location below first.", true);
      flashInvalid("map");
      return;
    }
    addressNote = document.getElementById("address-note").value.trim();
    if (!addressNote) {
      showToast("Please add a note for the rider (unit number or where to deliver).", true);
      flashInvalid("address-note");
      return;
    }
    if (SHOP_INFO.isOpen === false) {
      document.getElementById("closed-message").textContent =
        SHOP_INFO.closedMessage || "Merlin's Dish is open Monday-Friday, 11:00-21:00.";
      showScreen("closed-screen");
      return;
    }

    if (needsManualFee) {
      await requestDeliveryFeeAndWait();
    } else {
      // confirmedDeliveryFee was already set by computeDeliveryFee() in setDeliveryLocation()
      // (0 for <=2km, 50 for 2-5km); typed manual addresses without a pin fall through to manual.
      renderReviewScreen();
      showScreen("review-screen");
    }
  });

  document.getElementById("waiting-fee-back-btn").addEventListener("click", () => {
    feePollActive = false;
    showScreen("delivery-screen");
  });

  document.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      paymentMethod = btn.dataset.pay;
      document.querySelectorAll("[data-pay]").forEach((b) => b.classList.toggle("active", b === btn));
      applyPaymentMethodUI();
    });
  });

  document.getElementById("slip-input").addEventListener("change", (e) => {
    slipFile = e.target.files[0] || null;
    const preview = document.getElementById("slip-preview");
    if (slipFile) {
      preview.innerHTML = `<img src="${URL.createObjectURL(slipFile)}" alt="Slip preview" />`;
      preview.classList.remove("hidden");
    } else {
      preview.classList.add("hidden");
    }
    updatePlaceOrderEnabled();
  });

  // Name/phone are now collected on the cart screen (see cart-name-input /
  // cart-phone-input wiring above), not here on the review screen.

  document.getElementById("place-order-btn").addEventListener("click", submitOrder);
  document.getElementById("new-order-btn").addEventListener("click", resetOrder);
  document.getElementById("closed-back-btn").addEventListener("click", () => showScreen("menu-screen"));
}

init();
