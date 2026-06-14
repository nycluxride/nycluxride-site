/*
 * NYC LUX RIDE — Google tag (gtag.js) loader.
 *
 * SINGLE SOURCE for the Google Ads tag ID: swap GOOGLE_TAG_ID below once and it
 * applies site-wide (every page just includes this file in <head>). The heavy
 * remote gtag.js is injected asynchronously so it never blocks rendering.
 *
 * No other analytics, cookies, or third-party scripts are added here.
 */
(function () {
  // <-- Swap this once with the real Google Ads tag ID, e.g. "AW-XXXXXXXXXX".
  var GOOGLE_TAG_ID = "GOOGLE_TAG_ID";

  // Expose the id so tracking.js can build conversion send_to values from it.
  window.NLR_GTAG_ID = GOOGLE_TAG_ID;

  // Standard gtag bootstrap (defines window.gtag + dataLayer immediately).
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  if (typeof window.gtag !== "function") window.gtag = gtag;

  try {
    window.gtag("js", new Date());
    window.gtag("config", GOOGLE_TAG_ID);

    // Async-load the remote tag so it never blocks render. (With the placeholder
    // id the request is harmless; events still queue until the real id is set.)
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GOOGLE_TAG_ID);
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { /* degrade silently — never break the page */ }
})();
