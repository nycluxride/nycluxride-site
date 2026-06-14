/*
 * NYC LUX RIDE — Google Ads conversion click tracking.
 *
 * Bookings complete on customer.moovs.app (a domain we don't control), so the
 * tracked conversions are the INTENT clicks on this site: Book Now, Call, and
 * WhatsApp. A single delegated listener on document (capture phase) catches
 * clicks on any matching <a> — including links injected at runtime by
 * whatsapp.js and mobilenav.js (top bar, floating button, mobile bottom-nav).
 *
 * Defensive: if gtag is blocked / not yet loaded, every path degrades silently
 * and NEVER throws (same principle as policy.js / pricing.js).
 *
 * Conversion labels are created in the Google Ads UI — paste the real labels
 * into the three constants below (one place each). Until then, a generic event
 * still fires so click testing shows the conversion registering.
 */
(function () {
  // <-- Swap each with the real Google Ads conversion label once available.
  var BOOK_NOW_LABEL = "BOOK_NOW_LABEL";
  var CALL_LABEL = "CALL_LABEL";
  var WHATSAPP_LABEL = "WHATSAPP_LABEL";

  function isPlaceholder(v) {
    return !v || v.indexOf("_LABEL") > -1 || v === "GOOGLE_TAG_ID";
  }

  function fire(name, label) {
    try {
      if (typeof window.gtag !== "function") return; // tag absent/blocked -> no-op
      // Generic event — always fires (when gtag exists) so testing sees the click.
      window.gtag("event", name + "_click");
      // Real Ads conversion — only once both the tag id and label are real.
      var id = window.NLR_GTAG_ID;
      if (id && !isPlaceholder(id) && label && !isPlaceholder(label)) {
        window.gtag("event", "conversion", { send_to: id + "/" + label });
      }
    } catch (e) { /* degrade silently */ }
  }

  function onClick(e) {
    try {
      var t = e.target;
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("https://customer.moovs.app/") === 0) {
        fire("book_now", BOOK_NOW_LABEL);
      } else if (href.indexOf("tel:") === 0) {
        fire("call", CALL_LABEL);
      } else if (href.indexOf("https://wa.me/") === 0 || href.indexOf("wa.me/") === 0) {
        fire("whatsapp", WHATSAPP_LABEL);
      }
    } catch (e2) { /* degrade silently */ }
  }

  // Capture phase + delegation on document => also catches runtime-injected links.
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", onClick, true);
  }
})();
