/*
 * NYC LUX RIDE — social icon brand colors (plain DOM, no React coupling).
 * Adds an injected <style> + hidden SVG gradient defs so the Instagram, TikTok
 * and Facebook icons render in brand colors instead of gray, with a tasteful
 * hover lift. Applies to BOTH icon sets — header (top-right) and footer — by
 * targeting their shared aria-labels. CSS is global (survives React re-renders);
 * the gradient defs live outside #root so React never touches them.
 *
 * One shared gradient def per brand (#nlr-ig, #nlr-tt) is referenced by every
 * icon via CSS url() — not inlined per-icon — so there is no duplicate-ID
 * collision regardless of how many icon sets are on the page.
 */
function nlrSocial() {
  if (typeof document === "undefined" || !document.body) return;
  if (!document.getElementById("nlr-social-defs")) {
    var defs = document.createElement("div");
    defs.id = "nlr-social-defs";
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    defs.setAttribute("aria-hidden", "true");
    defs.innerHTML = '<svg width="0" height="0"><defs>'
      + '<linearGradient id="nlr-ig" x1="0%" y1="100%" x2="100%" y2="0%">'
      + '<stop offset="0%" stop-color="#FEDA75"/><stop offset="25%" stop-color="#FA7E1E"/>'
      + '<stop offset="50%" stop-color="#D62976"/><stop offset="75%" stop-color="#962FBF"/>'
      + '<stop offset="100%" stop-color="#4F5BD5"/></linearGradient>'
      + '<linearGradient id="nlr-tt" x1="0%" y1="0%" x2="100%" y2="100%">'
      + '<stop offset="0%" stop-color="#25F4EE"/><stop offset="100%" stop-color="#FE2C55"/>'
      + '</linearGradient></defs></svg>';
    document.body.appendChild(defs);
  }
  if (document.getElementById("nlr-social-style")) return;
  var st = document.createElement("style");
  st.id = "nlr-social-style";
  st.textContent =
    'a[aria-label="Facebook"] svg{color:#1877F2;}'
    + 'a[aria-label="Instagram"] svg path{fill:url(#nlr-ig);}'
    + 'a[aria-label="TikTok"] svg path{fill:url(#nlr-tt);}'
    + 'a[aria-label="Facebook"] svg,a[aria-label="Instagram"] svg,a[aria-label="TikTok"] svg{transition:transform .2s ease,filter .2s ease;}'
    + 'a[aria-label="Facebook"]:hover svg,a[aria-label="Instagram"]:hover svg,a[aria-label="TikTok"]:hover svg{transform:translateY(-2px) scale(1.08);filter:brightness(1.12) drop-shadow(0 2px 6px rgba(0,0,0,.5));}';
  document.head.appendChild(st);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlrSocial);
  if (document.readyState !== "loading") nlrSocial();
}
