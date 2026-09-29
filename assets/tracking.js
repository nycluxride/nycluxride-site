(function () {
  var BOOK_NOW_LABEL = "0YD2COGt8L8cEIX4gOJD";
  var CALL_LABEL = "Sz9RCOSt8L8cEIX4gOJD";
  var WHATSAPP_LABEL = "yIstCOet8L8cEIX4gOJD";
  var PURCHASE_LABEL = "";

  function fire(debugEvent, label) {
    try {
      if (typeof window.nlrGtag !== "function") return;
      window.nlrGtag("event", debugEvent);
      window.nlrGtag("event", "conversion", { send_to: window.NLR_ADS_ID + "/" + label, transport_type: "beacon" });
    } catch (e) {}
  }

  function isBookHref(href) {
    return href === "/book" || href.indexOf("/book?") === 0 || href.indexOf("/book#") === 0;
  }

  function onClick(e) {
    try {
      var t = e.target;
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var path = location.pathname;
      if (isBookHref(href)) {
        if (path.indexOf("/book") !== 0) fire("book_now_click", BOOK_NOW_LABEL);
      } else if (path === "/booking-confirmed") {
        return;
      } else if (href.indexOf("tel:") === 0) {
        fire("call_click", CALL_LABEL);
      } else if (href.indexOf("https://wa.me/") === 0 || href.indexOf("wa.me/") === 0) {
        fire("whatsapp_click", WHATSAPP_LABEL);
      }
    } catch (e2) {}
  }

  function onSubmit(e) {
    try {
      var f = e.target;
      if (f && f.matches && f.matches("form.trip")) fire("book_now_click", BOOK_NOW_LABEL);
    } catch (e2) {}
  }

  window.nlrPurchase = function (sessionId, ref, valueCents) {
    try {
      if (!PURCHASE_LABEL || typeof window.nlrGtag !== "function") return false;
      if (String(sessionId).indexOf("cs_live_") !== 0 || location.hostname !== "www.nycluxride.com") return false;
      window.nlrGtag("event", "conversion", {
        send_to: window.NLR_ADS_ID + "/" + PURCHASE_LABEL,
        value: valueCents / 100,
        currency: "USD",
        transaction_id: ref
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
  }
})();

(function () {
  var ORIGINAL_DIGITS = "16467750556";

  var FORMS = [
    "+1 (646) 775-0556",
    "(646) 775-0556",
    "646-775-0556",
    "646.775.0556",
    "+16467750556",
    "6467750556"
  ];

  var WA_RE = /wa\.me|whatsapp/i;

  function digits(str) {
    var d = String(str || "").replace(/\D/g, "");
    if (d.length === 10) d = "1" + d;
    return d;
  }

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
      if (WA_RE.test(href) || anchorMentionsWa(a)) continue;
      var hd = digits(href);
      if (hd === fwdDigits) continue;
      if (hd !== ORIGINAL_DIGITS) continue;
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

  function apply() {
    var fwd = window.__nlrForwardNumber;
    if (!fwd) return;
    if (typeof document === "undefined" || !document.body) return;
    var fwdDigits = digits(fwd.mobile);
    if (fwdDigits === ORIGINAL_DIGITS) return;
    swapTelLinks(fwd, fwdDigits);
    swapTextNodes(fwd, fwdDigits);
  }

  window.__nlrApplyForwardNumber = apply;

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
    var ticks = 0;
    var iv = setInterval(function () {
      apply();
      if (++ticks >= 8) clearInterval(iv);
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
      start();
    }
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("load", apply);
    }
  }
})();
