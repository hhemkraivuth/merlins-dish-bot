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
let SHOP_INFO = {};
let LINE_USER_ID = null;

// cart: lineId -> { itemId, name, price, qty, pastaChoice }
let cart = {};

let timing = "ASAP";
let scheduleText = "";
let deliveryLocation = null; // { lat, lng } or null
let manualAddress = "";
let needsManualFee = null; // true/false/null (unknown yet)
let confirmedDeliveryFee = 0; // set once Merlin's Dish replies with a fee, for a >2km order
let feeRequestId = null; // sent back with the final order so the server can verify the fee itself
let distanceKm = null;
let addressNote = "";
let paymentMethod = "bank";
let slipFile = null;

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
    SHOP_INFO = shopRes;
  } catch (err) {
    console.error(err);
    showToast("Couldn't load the menu. Please reopen the app.");
    return;
  }

  renderCategoryTabs();
  renderItemList();
  wireStaticEvents();
  showScreen("menu-screen");
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

  if (dish.requiresPasta) {
    card.innerHTML = `
      ${img}
      <div class="item-body">
        <h3>${dish.name}</h3>
        <p class="item-price">฿${dish.price}</p>
        ${stockNote}
        <select class="pasta-select" ${!dish.available ? "disabled" : ""}>
          <option value="">Choose pasta...</option>
          ${PASTA_OPTIONS.map(
            (p) =>
              `<option value="${p.id}">${p.name}${p.mandatorySurcharge ? ` (+฿${p.mandatorySurcharge})` : ""}</option>`
          ).join("")}
        </select>
        <div class="variant-row">
          <div class="stepper local-stepper" data-qty="1">
            <button type="button" class="minus">−</button>
            <span class="qty">1</span>
            <button type="button" class="plus">+</button>
          </div>
          <button type="button" class="add-line-btn" disabled>Add</button>
        </div>
      </div>
    `;
    const select = card.querySelector(".pasta-select");
    const stepper = card.querySelector(".local-stepper");
    const addBtn = card.querySelector(".add-line-btn");
    const qtyEl = stepper.querySelector(".qty");

    const updateAddEnabled = () => {
      addBtn.disabled = !dish.available || !select.value;
    };
    select.addEventListener("change", updateAddEnabled);

    stepper.querySelector(".minus").addEventListener("click", () => {
      let n = parseInt(stepper.dataset.qty, 10);
      if (n > 1) {
        n -= 1;
        stepper.dataset.qty = n;
        qtyEl.textContent = n;
      }
    });
    stepper.querySelector(".plus").addEventListener("click", () => {
      let n = parseInt(stepper.dataset.qty, 10);
      const max = dish.remaining != null ? dish.remaining : Infinity;
      if (n < max) {
        n += 1;
        stepper.dataset.qty = n;
        qtyEl.textContent = n;
      }
    });

    addBtn.addEventListener("click", () => {
      const pastaId = select.value;
      const qty = parseInt(stepper.dataset.qty, 10);
      const pasta = PASTA_OPTIONS.find((p) => p.id === pastaId);
      const surcharge = pasta ? pasta.mandatorySurcharge || 0 : 0;
      const lineId = `${dish.id}:${pastaId}`;
      const name = `${dish.name} (${pasta ? pasta.name : pastaId})`;
      addToCart(lineId, dish.id, name, dish.price + surcharge, qty, pastaId);
      showToast(`Added ${qty}x ${name}`);
      select.value = "";
      stepper.dataset.qty = 1;
      qtyEl.textContent = 1;
      updateAddEnabled();
    });

    updateAddEnabled();
  } else {
    const currentQty = cart[dish.id] ? cart[dish.id].qty : 0;
    card.innerHTML = `
      ${img}
      <div class="item-body">
        <h3>${dish.name}</h3>
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

function addToCart(lineId, itemId, name, price, qty, pastaChoice) {
  if (cart[lineId]) {
    cart[lineId].qty += qty;
  } else {
    cart[lineId] = { itemId, name, price, qty, pastaChoice };
  }
  updateCartBar();
}

function cartLines() {
  return Object.entries(cart).map(([lineId, entry]) => ({ lineId, ...entry }));
}

function cartTotal() {
  return cartLines().reduce((sum, l) => sum + l.price * l.qty, 0);
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
  document.getElementById("checkout-btn").disabled = lines.length === 0;
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
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
    needsManualFee = distanceKm > 2;
    if (needsManualFee) {
      resultEl.textContent = `${distanceKm.toFixed(1)}km away, outside our free 2km zone. Merlin's Dish will confirm the delivery fee shortly.`;
      resultEl.classList.add("manual");
    } else {
      resultEl.textContent = `${distanceKm.toFixed(1)}km away, free delivery! 🎉`;
      resultEl.classList.add("free");
    }
  } else {
    needsManualFee = true;
    resultEl.textContent = "Location set. Delivery fee will be confirmed by Merlin's Dish.";
    resultEl.classList.add("manual");
  }
}

// ---------- delivery fee confirmation (>2km orders) ----------

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
        items: cartLines().map((l) => ({ itemId: l.itemId, qty: l.qty, pastaChoice: l.pastaChoice })),
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
    .map((l) => `<div class="summary-line"><span>${l.qty}x ${l.name}</span><span>฿${l.price * l.qty}</span></div>`)
    .join("");
  const foodTotal = cartTotal();
  const grandTotal = foodTotal + (needsManualFee ? confirmedDeliveryFee : 0);
  document.getElementById("review-food-total").textContent = `฿${foodTotal}`;
  document.getElementById("review-delivery").textContent =
    needsManualFee === false ? "FREE (within 2km)" : `฿${confirmedDeliveryFee}`;
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

function applyPaymentMethodUI() {
  document.getElementById("pay-bank-info").classList.toggle("hidden", paymentMethod !== "bank");
  document.getElementById("pay-qr-image").classList.toggle("hidden", paymentMethod !== "qr");
}

function updatePlaceOrderEnabled() {
  const name = document.getElementById("name-input").value.trim();
  const phone = document.getElementById("phone-input").value.trim();
  const ok = !!slipFile && name.length >= 2 && phone.replace(/\D/g, "").length >= 8;
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
    items: cartLines().map((l) => ({ itemId: l.itemId, qty: l.qty, pastaChoice: l.pastaChoice })),
    timing,
    scheduleText,
    location: deliveryLocation,
    addressText: manualAddress || null,
    addressNote: document.getElementById("address-note").value.trim(),
    needsManualFee,
    feeRequestId: needsManualFee ? feeRequestId : null,
    distanceKm,
    name: document.getElementById("name-input").value.trim(),
    phone: document.getElementById("phone-input").value.trim(),
    paymentMethod,
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
  document.getElementById("name-input").value = "";
  document.getElementById("phone-input").value = "";
  document.getElementById("slip-input").value = "";
  document.getElementById("slip-preview").classList.add("hidden");
  document.getElementById("location-result").classList.add("hidden");
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
    showScreen("delivery-screen");
    ensureMapInitialized();
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

    if (needsManualFee) {
      await requestDeliveryFeeAndWait();
    } else {
      confirmedDeliveryFee = 0;
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

  document.getElementById("name-input").addEventListener("input", updatePlaceOrderEnabled);
  document.getElementById("phone-input").addEventListener("input", updatePlaceOrderEnabled);

  document.getElementById("place-order-btn").addEventListener("click", submitOrder);
  document.getElementById("new-order-btn").addEventListener("click", resetOrder);
}

init();
