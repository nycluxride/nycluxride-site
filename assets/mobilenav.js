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
  // WhatsApp uses the same proven 0 0 32 32 glyph as the FAB/top-bar so it
  // never clips (the previous 24-grid path overflowed its viewBox).
  if (n === "wa") {
    return '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">'
      + '<path d="M16.04 4C9.96 4 5 8.95 5 15.02c0 2.65.86 5.1 2.32 7.12L5.5 28l6.06-1.78a11.1 11.1 0 0 0 4.47.94h.01c6.08 0 11.03-4.95 11.03-11.02C27.08 8.95 22.12 4 16.04 4zm0 20.1h-.01a9.2 9.2 0 0 1-4.68-1.28l-.34-.2-3.6 1.06 1.08-3.5-.22-.36a9.06 9.06 0 0 1-1.4-4.86c0-5.02 4.1-9.1 9.16-9.1 2.45 0 4.75.95 6.48 2.68a9.06 9.06 0 0 1 2.68 6.43c0 5.02-4.1 9.1-9.15 9.1zm5.02-6.82c-.27-.14-1.63-.8-1.88-.9-.25-.09-.43-.13-.62.14-.18.27-.71.9-.87 1.08-.16.18-.32.2-.59.07-.27-.14-1.16-.43-2.2-1.36-.81-.72-1.36-1.62-1.52-1.89-.16-.27-.02-.42.12-.55.12-.12.27-.32.4-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.05-.22-.53-.45-.46-.62-.47l-.53-.01c-.18 0-.48.07-.73.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.12 2.85.14.18 1.94 2.96 4.7 4.15.66.28 1.17.45 1.57.58.66.21 1.26.18 1.74.11.53-.08 1.63-.67 1.86-1.31.23-.64.23-1.19.16-1.31-.07-.12-.25-.18-.52-.32z"/></svg>';
  }
  var p = {
    home: '<path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/>',
    fleet: '<path d="M5 11l1.6-4.6C6.9 5.6 7.6 5 8.5 5h7c.9 0 1.6.6 1.9 1.4L19 11v7a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM7 15.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>',
    book: '<path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 7v10H5V9z"/>',
    call: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11 11 0 0 0 3.5.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.2 2.4.56 3.5a1 1 0 0 1-.24 1z"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (p[n] || "") + '</svg>';
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
    + "background:#060606;border-top:1px solid rgba(212,175,55,.3);padding:8px 2px;"
    + "padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));box-shadow:0 -8px 24px rgba(0,0,0,.45);}"
    + "#nlr-mobnav a{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;color:#f0dc9f;"
    + "text-decoration:none;font-size:12px;font-weight:600;letter-spacing:.02em;line-height:1;white-space:nowrap;padding:2px 0;}"
    + "#nlr-mobnav a:active{color:#fff;}#nlr-mobnav svg{width:28px;height:28px;display:block;}"
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
