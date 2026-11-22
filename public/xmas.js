// Seasonal decoration (Christmas, then New Year). Decoration only. Dates are Bangkok time.
//   01/12/2026 to 25/12/2026  Christmas
//   26/12/2026 to 03/01/2027  New Year
// Preview any time with ?xmas=1 (Christmas), ?xmas=ny (New Year), ?xmas=0 (off). To remove the whole layer, delete the two xmas tags in index.html.
(function () {
  const COLS = ["#E63D23", "#294BD4", "#F8CC1A", "#63CBC6"];
  const q = new URLSearchParams(location.search).get("xmas");
  try { if (q !== null) sessionStorage.setItem("xmasMode", q); } catch (e) {}
  let override = q;
  try { if (override === null) override = sessionStorage.getItem("xmasMode"); } catch (e) {}
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  let mode = null;
  if (today >= "2026-12-01" && today <= "2026-12-25") mode = "xmas";
  else if (today >= "2026-12-26" && today <= "2027-01-03") mode = "ny";
  if (override === "1") mode = "xmas";
  else if (override === "ny") mode = "ny";
  else if (override === "0") mode = null;
  if (!mode) return;
  document.documentElement.dataset.xmas = mode;

  const hat = '<svg class="xm-hat" viewBox="0 0 44 38" aria-hidden="true"><path d="M6 30C8 12 20 3 36 6c-8 3-9 10-6 24z" fill="#B3200C"/><rect x="2" y="27" width="40" height="9" rx="4.5" fill="#fff"/><circle cx="37" cy="6" r="5" fill="#fff"/></svg>';

  function build() {
    // snowfall
    let sn = '<div class="xm-snow" aria-hidden="true">';
    for (let i = 0; i < 12; i++) {
      sn += `<i style="left:${(i * 83 + 9) % 100}%;font-size:${12 + (i % 4) * 4}px;animation-duration:${9 + (i % 5) * 2}s;animation-delay:-${(i * 1.3).toFixed(1)}s">${["❄", "❅", "❆"][i % 3]}</i>`;
    }
    document.body.insertAdjacentHTML("beforeend", sn + "</div>");

    if (mode === "xmas") {
      const bm = document.querySelector(".brand-mark");
      if (bm) bm.insertAdjacentHTML("beforeend", hat);
      const ic = document.getElementById("intro-card");
      if (ic) ic.insertAdjacentHTML("beforeend", hat);
      const tag = document.querySelector(".topbar .brand p");
      if (tag) tag.textContent = tag.textContent.replace("✨", "🎄");

      // confirmation: characters row and confetti
      const badge = document.querySelector("#confirm-screen .confirm-badge");
      if (badge) badge.insertAdjacentHTML("afterend", '<div class="xm-row" aria-hidden="true"><span></span><span></span><span></span></div>');
      const cs = document.getElementById("confirm-screen");
      if (cs) {
        let cf = '<div class="xm-confetti" aria-hidden="true">';
        for (let i = 0; i < 40; i++) {
          const x = (i * 37 + 11) % 100, y = (i * 29 + 7) % 92, w = 6 + (i % 3) * 3;
          cf += `<span style="left:${x}%;top:${y}%;width:${w}px;height:${w * 1.6}px;background:${COLS[i % 4]};transform:rotate(${(i * 47) % 360}deg);opacity:${(1 - y / 130).toFixed(2)}"></span>`;
        }
        cs.insertAdjacentHTML("beforeend", cf + "</div>");
      }
      // "Order placed!" and "Merry Christmas." each on their own line (app.js sets the title in several places)
      const t = document.getElementById("confirm-title");
      if (t) {
        const fix = () => {
          if (t.textContent === "Order placed!") t.innerHTML = "Order placed!<br>Merry Christmas.";
        };
        new MutationObserver(fix).observe(t, { childList: true, characterData: true, subtree: true });
        fix();
      }
      const cm = document.getElementById("confirm-message");
      if (cm) {
        const fixm = () => {
          if (cm.textContent === "Your order is confirmed and on its way to the kitchen.")
            cm.textContent = "Your order is confirmed and on its way to the kitchen. Thank you for letting us be part of your table this season.";
        };
        fixm();
      }
    } else {
      // New Year closed screen
      const closed = document.getElementById("closed-screen");
      if (closed) {
        const badge = closed.querySelector(".confirm-badge");
        if (badge) badge.insertAdjacentHTML("afterend", '<div class="xm-nut" aria-hidden="true"></div>');
        const h = closed.querySelector("h2");
        if (h) h.innerHTML = "We're closed.<br>Happy New Year!";
        let sp = '<div class="xm-sparks" aria-hidden="true">';
        for (let i = 0; i < 14; i++) {
          const x = ((i * 61 + 8) % 92) + 2, y = (i * 37 + 5) % 70, s = 14 + (i % 4) * 7;
          sp += `<span style="left:${x}%;top:${y}%;font-size:${s}px;color:${COLS[i % 4]}">${i % 2 ? "✦" : "✺"}</span>`;
        }
        closed.insertAdjacentHTML("beforeend", sp + "</div>");
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
