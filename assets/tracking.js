/*
 * NYC LUX RIDE — Google Ads conversion click tracking (isolated namespace).
 *
 * Fires via window.nlrGtag (NOT window.gtag — the compiled bundle deletes that
 * on hydration). Bookings complete on customer.moovs.app (a domain we don't
 * control), so the tracked conversions are the INTENT clicks on this site:
 * Book Now, Call, WhatsApp. A single delegated, capture-phase listener on
 * document catches clicks on any matching <a>, including links injected at
 * runtime by whatsapp.js / mobilenav.js (top bar, floating button, bottom-nav).
 *
 * Fully defensive: if window.nlrGtag isn't ready it silently no-ops, never
 * throws, and never blocks the link's navigation.
 */
(function () {
  // <-- Paste the real Google Ads conversion labels once.
  var BOOK_NOW_LABEL = "0YD2COGt8L8cEIX4gOJD";
  var CALL_LABEL = "Sz9RCOSt8L8cEIX4gOJD";
  var WHATSAPP_LABEL = "yIstCOet8L8cEIX4gOJD";

  function fire(debugEvent, label) {
    try {
      if (typeof window.nlrGtag !== "function") return; // our tag absent -> no-op
      // Plain debug event (visible immediately for click testing).
      window.nlrGtag("event", debugEvent);
      // Direct Google Ads conversion.
      window.nlrGtag("event", "conversion", { send_to: window.NLR_ADS_ID + "/" + label });
    } catch (e) { /* degrade silently — never block navigation */ }
  }

  function onClick(e) {
    try {
      var t = e.target;
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("https://customer.moovs.app/") === 0) {
        fire("book_now_click", BOOK_NOW_LABEL);
      } else if (href.indexOf("tel:") === 0) {
        fire("call_click", CALL_LABEL);
      } else if (href.indexOf("https://wa.me/") === 0 || href.indexOf("wa.me/") === 0) {
        fire("whatsapp_click", WHATSAPP_LABEL);
      }
    } catch (e2) { /* degrade silently */ }
  }

  // Capture phase + delegation on document => also catches runtime-injected links.
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", onClick, true);
  }
})();
