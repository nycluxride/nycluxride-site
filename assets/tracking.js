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
      window.nlrGtag("event", "conversion", { send_to: window.NLR_ADS_ID + "/" + label, transport_type: "beacon" });
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

/*
 * NYC LUX RIDE — Google Ads call-conversion number swap (phone-swap).
 *
 * gtag.js registers the phone_conversion_callback under the isolated nlrGtag namespace and
 * stashes the result on window.__nlrForwardNumber = { formatted, mobile }. Google hands us a
 * Google forwarding number for real Ads traffic; for non-Ads traffic (or an exhausted pool)
 * it returns the ORIGINAL number instead — so we no-op whenever the returned digits equal the
 * original. This runs on all 36 pages (tracking.js is in every <head>) and re-applies forever
 * via a permanent MutationObserver, because the header/footer numbers live inside #root and
 * React re-renders revert them.
 *
 * WhatsApp is never touched: any anchor whose href contains wa.me/whatsapp is skipped, and
 * text inside such an anchor is skipped. Scripts (incl. the JSON-LD telephone field), styles,
 * noscript, textarea and title text are never walked.
 */
(function () {
  var ORIGINAL_DIGITS = "16467750556";

  // Literal visible forms, longest/most-specific FIRST so a broader form never partially
  // rewrites a more specific one within the same text node.
  var FORMS = [
    "+1 (646) 775-0556",
    "(646) 775-0556",
    "646-775-0556",
    "646.775.0556",
    "+16467750556",
    "6467750556"
  ];

  var WA_RE = /wa\.me|whatsapp/i;

  // Strip to digits; left-pad the US country code so 10-digit forms normalize to 11 digits.
  function digits(str) {
    var d = String(str || "").replace(/\D/g, "");
    if (d.length === 10) d = "1" + d;
    return d;
  }

  // True if this node sits under a script/style/etc. container we must never rewrite,
  // or inside a wa.me / whatsapp anchor.
  function inForbiddenContext(node) {
    var BAD = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, TITLE: 1 };
    var p = node.parentNode;
    while (p && p.nodeType === 1) {
      var tag = p.tagName;
      if (BAD[tag]) return true;
      if (tag === "A") {
        var href = p.getAttribute("href") || "";
        if (WA_RE.test(href)) return true;
      }
      p = p.parentNode;
    }
    return false;
  }

  function containsForm(val) {
    for (var i = 0; i < FORMS.length; i++) {
      if (val.indexOf(FORMS[i]) !== -1) return true;
    }
    return false;
  }

  function replaceForms(val, formatted) {
    for (var i = 0; i < FORMS.length; i++) {
      if (val.indexOf(FORMS[i]) !== -1) val = val.split(FORMS[i]).join(formatted);
    }
    return val;
  }

  // Does any attribute value on this anchor mention wa.me / whatsapp?
  function anchorMentionsWa(a) {
    var attrs = a.attributes;
    for (var i = 0; i < attrs.length; i++) {
      if (WA_RE.test(attrs[i].value || "")) return true;
    }
    return false;
  }

  function swapTelLinks(fwd, fwdDigits) {
    var links = document.querySelectorAll('a[href^="tel:"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href") || "";
      if (WA_RE.test(href) || anchorMentionsWa(a)) continue;   // never touch WhatsApp
      var hd = digits(href);
      if (hd === fwdDigits) continue;                          // already at the forwarding number
      if (hd !== ORIGINAL_DIGITS) continue;                    // some other number — leave it
      if (!a.dataset.nlrOrigHref) a.dataset.nlrOrigHref = href;
      a.setAttribute("href", "tel:" + fwd.mobile);
      a.dataset.nlrSwapped = fwdDigits;
    }
  }

  function swapTextNodes(fwd, fwdDigits) {
    if (!document.body || typeof document.createTreeWalker !== "function") return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (inForbiddenContext(node)) return NodeFilter.FILTER_REJECT;
        if (!containsForm(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    // Collect first, then mutate (mutating nodeValue mid-walk is safe, but this is tidier).
    var pending = [];
    var n;
    while ((n = walker.nextNode())) pending.push(n);
    for (var i = 0; i < pending.length; i++) {
      var node = pending[i];
      var parent = node.parentNode;
      if (parent && parent.nodeType === 1 && !parent.hasAttribute("data-nlr-orig-text")) {
        parent.setAttribute("data-nlr-orig-text", node.nodeValue);
      }
      node.nodeValue = replaceForms(node.nodeValue, fwd.formatted);
      if (parent && parent.nodeType === 1) parent.setAttribute("data-nlr-swapped", fwdDigits);
    }
  }

  // Idempotent, re-render-resilient. The swap decision is content-based (an element already
  // showing the forwarding number contains no original form, and a tel: href already at the
  // forwarding digits is skipped), so calling this repeatedly — and re-firing on our own
  // MutationObserver writes — converges without looping. A React restore of the original
  // text/href is naturally re-swapped on the next pass.
  function apply() {
    var fwd = window.__nlrForwardNumber;
    if (!fwd) return;                                          // callback hasn't fired yet
    if (typeof document === "undefined" || !document.body) return;
    var fwdDigits = digits(fwd.mobile);
    if (fwdDigits === ORIGINAL_DIGITS) return;                 // no forwarding number allocated
    swapTelLinks(fwd, fwdDigits);
    swapTextNodes(fwd, fwdDigits);
  }

  // Expose globally so gtag.js's phone_conversion_callback can poke us the moment it fires.
  window.__nlrApplyForwardNumber = apply;

  // Debounced scheduler so React render storms don't thrash the DOM walk.
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; apply(); }, 150);
  }

  var observerStarted = false;
  function startObserver() {
    if (observerStarted || typeof MutationObserver === "undefined" || !document.body) return;
    observerStarted = true;
    // Permanent — never disconnected. Its own writes are guarded by the content checks above.
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  var intervalStarted = false;
  function startInterval() {
    if (intervalStarted) return;
    intervalStarted = true;
    // Belt-and-braces for late injection from homepage.js / homepage-sections.js / mobilenav.js.
    var ticks = 0;
    var iv = setInterval(function () {
      apply();
      if (++ticks >= 8) clearInterval(iv);                    // ~8s then stop
    }, 1000);
  }

  function start() {
    apply();
    startObserver();
    startInterval();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();                                                // body already parsed
    }
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("load", apply);                 // one more pass after full load
    }
  }
})();
