/*
 * NYC LUX RIDE — Google Ads tag, ISOLATED namespace.
 *
 * Why not the standard window.gtag / window.dataLayer? The compiled React
 * bundle ships its own consent-gated GA4 and, while analytics consent is off,
 * runs `delete window.gtag; delete window.dataLayer` on hydration — which would
 * wipe our tag. So we run OUR Google Ads tag under custom globals the bundle
 * never touches: window.nlrGtag + window.nlrDataLayer. The remote library is
 * told to read our data layer via the &l=nlrDataLayer query param.
 *
 * Async / non-blocking. Stays in <head> on every page. Swap ADS_TAG_ID once.
 * Does NOT touch window.gtag or window.dataLayer.
 */
(function () {
  // <-- Paste the real Google Ads tag id once (e.g. "AW-123456789").
  var ADS_TAG_ID = "AW-18190711813";

  // Expose the id so tracking.js can build conversion send_to values from it.
  window.NLR_ADS_ID = ADS_TAG_ID;

  // Isolated data layer + push function (NOT the default gtag/dataLayer names).
  window.nlrDataLayer = window.nlrDataLayer || [];
  if (typeof window.nlrGtag !== "function") {
    window.nlrGtag = function () { window.nlrDataLayer.push(arguments); };
  }

  try {
    window.nlrGtag("js", new Date());
    window.nlrGtag("config", ADS_TAG_ID);

    // Async-load the remote tag pointed at OUR data layer (&l=nlrDataLayer).
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ADS_TAG_ID) + "&l=nlrDataLayer";
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { /* degrade silently — never break the page */ }
})();
