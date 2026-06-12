/*
 * NYC LUX RIDE — WhatsApp contact UI (plain DOM, no React coupling).
 *
 * The business line +1 (646) 775-0556 is also the WhatsApp number. This adds:
 *  1) a WhatsApp link in the top bar, alongside (never replacing) tap-to-call;
 *  2) a fixed floating WhatsApp button, bottom-right, site-wide.
 *
 * Both are injected after hydration and kept alive by a MutationObserver
 * (idempotent, self-healing if React re-renders the header). Inline SVG icon —
 * no external icon CDN. Loaded as a classic script before the app bundle.
 */
window.NLR_WA = window.NLR_WA || {};
window.NLR_WA.url = "https://wa.me/16467750556?text=Hi%20NYC%20Lux%20Ride%2C%20I%27d%20like%20to%20book%20a%20ride";

// Inline WhatsApp glyph. fillColor lets the FAB use white on green; top bar uses brand green.
window.NLR_WA.svg = function (size, fillColor) {
  return '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" fill="' + fillColor + '" aria-hidden="true" focusable="false">'
    + '<path d="M16.04 4C9.96 4 5 8.95 5 15.02c0 2.65.86 5.1 2.32 7.12L5.5 28l6.06-1.78a11.1 11.1 0 0 0 4.47.94h.01c6.08 0 11.03-4.95 11.03-11.02C27.08 8.95 22.12 4 16.04 4zm0 20.1h-.01a9.2 9.2 0 0 1-4.68-1.28l-.34-.2-3.6 1.06 1.08-3.5-.22-.36a9.06 9.06 0 0 1-1.4-4.86c0-5.02 4.1-9.1 9.16-9.1 2.45 0 4.75.95 6.48 2.68a9.06 9.06 0 0 1 2.68 6.43c0 5.02-4.1 9.1-9.15 9.1zm5.02-6.82c-.27-.14-1.63-.8-1.88-.9-.25-.09-.43-.13-.62.14-.18.27-.71.9-.87 1.08-.16.18-.32.2-.59.07-.27-.14-1.16-.43-2.2-1.36-.81-.72-1.36-1.62-1.52-1.89-.16-.27-.02-.42.12-.55.12-.12.27-.32.4-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.05-.22-.53-.45-.46-.62-.47l-.53-.01c-.18 0-.48.07-.73.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.12 2.85.14.18 1.94 2.96 4.7 4.15.66.28 1.17.45 1.57.58.66.21 1.26.18 1.74.11.53-.08 1.63-.67 1.86-1.31.23-.64.23-1.19.16-1.31-.07-.12-.25-.18-.52-.32z"/></svg>';
};

function nlrWaTopBar() {
  var wrap = document.querySelector(".phone-sparkle-wrap");
  if (!wrap || wrap.querySelector("[data-nlr-wa-top]")) return;
  var a = document.createElement("a");
  a.setAttribute("data-nlr-wa-top", "1");
  a.href = window.NLR_WA.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("aria-label", "Message NYC LUX RIDE on WhatsApp");
  a.className = "inline-flex items-center gap-1 ml-3 text-[#25D366] hover:brightness-125 transition-all duration-300 text-sm font-medium whitespace-nowrap";
  a.innerHTML = window.NLR_WA.svg(18, "currentColor") + "<span>WhatsApp</span>";
  wrap.appendChild(a);
}

function nlrWaPositionFab(fab) {
  // Sit above the cookie banner (found via its close button) so nothing is covered.
  var bottom = 20;
  var closeBtn = document.querySelector('button[aria-label="Close cookie notice"]');
  var bar = closeBtn ? closeBtn.closest("div.fixed") : null;
  if (bar && bar.offsetParent !== null && bar.offsetHeight) bottom = bar.offsetHeight + 16;
  fab.style.bottom = "calc(" + bottom + "px + env(safe-area-inset-bottom, 0px))";
}

function nlrWaFloat() {
  var fab = document.getElementById("nlr-wa-float");
  if (!fab) {
    fab = document.createElement("a");
    fab.id = "nlr-wa-float";
    fab.href = window.NLR_WA.url;
    fab.target = "_blank";
    fab.rel = "noopener";
    fab.setAttribute("aria-label", "Message NYC LUX RIDE on WhatsApp");
    fab.style.cssText = "position:fixed;right:16px;z-index:80;width:56px;height:56px;"
      + "display:flex;align-items:center;justify-content:center;border-radius:9999px;"
      + "background:#25D366;box-shadow:0 6px 18px rgba(0,0,0,.4);text-decoration:none;";
    fab.innerHTML = window.NLR_WA.svg(32, "#ffffff");
    document.body.appendChild(fab);                            // appended to body -> React never reconciles it
  }
  nlrWaPositionFab(fab);
}

function nlrWaApply() {
  if (typeof document === "undefined" || !document.body) return;
  try { nlrWaTopBar(); } catch (e) { /* degrade silently */ }
  try { nlrWaFloat(); } catch (e) { /* degrade silently */ }
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlrWaApply);
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", nlrWaApply);
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(nlrWaApply).observe(document.documentElement, { childList: true, subtree: true });
  }
}
