/*
 * NYC LUX RIDE — mobile bottom navigation (plain DOM, no React coupling).
 * A fixed bottom tab bar shown ONLY under 768px, site-wide, injected after
 * hydration and kept alive by a MutationObserver (idempotent, self-healing).
 * Five items with inline SVG icons + labels. Black/gold, iOS safe-area aware.
 * On mobile it: (1) pads the body bottom so nothing is hidden behind the bar,
 * (2) lifts the cookie banner above the bar so neither covers the other, and
 * (3) hides the floating WhatsApp button (kept on desktop) to avoid dupes.
 */
window.NLR_MOBNAV = window.NLR_MOBNAV || {};
window.NLR_MOBNAV.booking = "https://customer.moovs.app/nyc-lux-ride/request/new";

window.NLR_MOBNAV.icon = function (n) {
  var p = {
    home: '<path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/>',
    fleet: '<path d="M5 11l1.6-4.6C6.9 5.6 7.6 5 8.5 5h7c.9 0 1.6.6 1.9 1.4L19 11v7a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM7 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>',
    book: '<path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 7v10H5V9z"/>',
    call: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11 11 0 0 0 3.5.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.2 2.4.56 3.5a1 1 0 0 1-.24 1z"/>',
    wa: '<path d="M16 4C9.9 4 5 8.9 5 15c0 2.1.6 4.1 1.7 5.8L5.5 26l5.4-1.4A11 11 0 1 0 16 4zm0 2a9 9 0 1 1-4.7 16.7l-.3-.2-3.2.9.9-3.1-.2-.3A9 9 0 0 1 16 6zm5 11.3c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.1l-.8 1c-.2.2-.3.2-.6.1-1.5-.7-2.5-1.6-3.1-2.7-.1-.3 0-.4.1-.5l.4-.5c.1-.2.1-.3 0-.5l-.8-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.7.7-1 1.7-.7 2.7.4 1.3 1.2 2.5 2.4 3.5 1.9 1.6 3.4 1.9 4 1.8.6-.1 1.6-.7 1.8-1.3.2-.6.2-1.1.1-1.2z"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true">' + (p[n] || "") + '</svg>';
};

window.NLR_MOBNAV.items = function () {
  var I = window.NLR_MOBNAV.icon;
  return [
    '<a href="/" aria-label="Home">' + I("home") + "<span>Home</span></a>",
    '<a href="/services" aria-label="Fleet">' + I("fleet") + "<span>Fleet</span></a>",
    '<a href="' + window.NLR_MOBNAV.booking + '" target="_blank" rel="noopener" aria-label="Book a ride">' + I("book") + "<span>Book</span></a>",
    '<a href="tel:+16467750556" aria-label="Call">' + I("call") + "<span>Call</span></a>",
    '<a href="https://wa.me/16467750556?text=Hi%20NYC%20Lux%20Ride%2C%20I%27d%20like%20to%20book%20a%20ride" target="_blank" rel="noopener" aria-label="WhatsApp">' + I("wa") + "<span>WhatsApp</span></a>"
  ].join("");
};

function nlrMobnavStyle() {
  if (document.getElementById("nlr-mobnav-style")) return;
  var st = document.createElement("style");
  st.id = "nlr-mobnav-style";
  st.textContent =
    "#nlr-mobnav{position:fixed;left:0;right:0;bottom:0;z-index:90;display:flex;justify-content:space-around;align-items:center;"
    + "background:#060606;border-top:1px solid rgba(212,175,55,.3);padding:6px 2px;"
    + "padding-bottom:calc(6px + env(safe-area-inset-bottom,0px));box-shadow:0 -8px 24px rgba(0,0,0,.45);}"
    + "#nlr-mobnav a{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f0dc9f;"
    + "text-decoration:none;font-size:10px;font-weight:600;letter-spacing:.03em;line-height:1;padding:2px 0;}"
    + "#nlr-mobnav a:active{color:#fff;}#nlr-mobnav svg{width:22px;height:22px;display:block;}"
    + "@media(min-width:768px){#nlr-mobnav{display:none!important;}}"
    + "@media(max-width:767px){#nlr-wa-float{display:none!important;}}";
  document.head.appendChild(st);
}

function nlrMobnavAdjust(bar) {
  var isMobile = (window.innerWidth || 0) < 768;
  var h = isMobile && bar ? (bar.offsetHeight || 60) : 0;
  document.body.style.paddingBottom = h ? (h + "px") : "";
  // Lift the cookie banner above the bar so neither covers the other.
  var closeBtn = document.querySelector('button[aria-label="Close cookie notice"]');
  var cookie = closeBtn ? closeBtn.closest("div.fixed") : null;
  if (cookie) cookie.style.bottom = h ? (h + "px") : "";
}

function nlrEnsureMobnav() {
  if (typeof document === "undefined" || !document.body) return;
  nlrMobnavStyle();
  var bar = document.getElementById("nlr-mobnav");
  if (!bar) {
    bar = document.createElement("nav");
    bar.id = "nlr-mobnav";
    bar.setAttribute("aria-label", "Mobile navigation");
    bar.innerHTML = window.NLR_MOBNAV.items();
    document.body.appendChild(bar);
  }
  nlrMobnavAdjust(bar);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlrEnsureMobnav);
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", nlrEnsureMobnav);
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(nlrEnsureMobnav).observe(document.documentElement, { childList: true, subtree: true });
  }
}
