/*
 * NYC LUX RIDE — homepage World Cup band + service sections (plain DOM, no React
 * coupling). Two inserts, each placed next to a real page node:
 *   - #nlr-wc-top  : the slim World Cup band, inserted as the FIRST child of .home-content
 *                    (directly above the "Arrive in Style" headline).
 *   - #nlr-injected: the "Our Services" heading + 4 cards, inserted immediately BEFORE the
 *                    fleet section.
 * Both are gated on React's FINAL commit — a __reactFiber$ own-property on .fleet-section,
 * the last homepage section, which React only attaches in the committed client render (an
 * earlier node like .home-content gets a transient fiber during the aborted hydration and
 * is then discarded). So our nodes are never present during React's hydration pass, and the
 * band lands on a settled .home-content (no wipe->reinject). A MutationObserver stays on
 * only as a backstop. Included on index.html only, so it runs on the homepage only.
 *
 * Conversion tracking: tracking.js listens on document (capture phase) and matches by href
 * prefix, catching runtime-injected links — so the band's Book Now (customer.moovs.app/...)
 * and WhatsApp (wa.me/...) buttons are auto-tracked. No explicit gtag call is needed.
 */
(function () {
  var BOOK_URL = "https://customer.moovs.app/nyc-lux-ride/request/new";
  var WA_URL = "https://wa.me/16467750556?text=Hi%20NYC%20Lux%20Ride%2C%20I%27d%20like%20to%20book%20a%20ride";

  var SERVICES = [
    { title: "Airport Transfers", blurb: "Dependable luxury chauffeuring to and from JFK, LGA, EWR & Teterboro. We monitor your flight for perfect timing, every time." },
    { title: "Business Transfers", blurb: "Executive black car service built on comfort, privacy, and professionalism — for meetings, roadshows, and corporate travel." },
    { title: "Events & Occasions", blurb: "Weddings, galas, and nights out in premium vehicles with a professional chauffeur. Arrive in style." },
    { title: "Hourly / As-Directed", blurb: "Your chauffeur by the hour, 3-hour minimum, with the flexibility to wait and continue wherever the day takes you." }
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function link(cls, href, label, aria) {
    var a = el("a", cls, label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-label", aria);
    return a;
  }

  // (A) World Cup band -> #nlr-wc-top, first child of .home-content (above the headline).
  // Markup + both CTAs verbatim from before; same hrefs so tracking.js delegation auto-fires.
  function buildWcBand() {
    var wrap = el("div");
    wrap.id = "nlr-wc-top";
    wrap.setAttribute("aria-label", "World Cup 2026 luxury transfers");
    var band = el("div", "nlr-wc-band");
    band.appendChild(el("p", "nlr-wc-msg",
      "⚽ World Cup 2026 — now booking luxury transfers to MetLife Stadium. Airport, hotel & stadium transport across NYC & NJ."));
    var actions = el("div", "nlr-wc-actions");
    actions.appendChild(link("nlr-btn-book", BOOK_URL, "Book Now", "Book Now"));
    actions.appendChild(link("nlr-btn-wa", WA_URL, "WhatsApp", "Message NYC LUX RIDE on WhatsApp"));
    band.appendChild(actions);
    wrap.appendChild(band);
    return wrap;
  }

  // (B) Services -> #nlr-injected, before .fleet-section. "Our Services" heading + 4 cards.
  function buildServices() {
    var wrap = el("section");
    wrap.id = "nlr-injected";
    wrap.setAttribute("aria-label", "Our services");
    var services = el("div", "nlr-services");
    services.appendChild(el("h2", "nlr-services-title", "Our Services"));
    var grid = el("div", "nlr-services-grid");
    SERVICES.forEach(function (s) {
      var card = el("article", "nlr-service-card");
      card.appendChild(el("h3", "nlr-service-name", s.title));
      card.appendChild(el("p", "nlr-service-blurb", s.blurb));
      grid.appendChild(card);
    });
    services.appendChild(grid);
    wrap.appendChild(services);
    return wrap;
  }

  // Two independently-gated units: each has its own id (idempotency), anchor + fiber gate,
  // placement, and insert log.
  var UNITS = [
    {
      id: "nlr-wc-top",
      anchorSel: ".home-content",
      build: buildWcBand,
      place: function (anchor, node) { anchor.insertBefore(node, anchor.firstChild); return true; }
    },
    {
      id: "nlr-injected",
      anchorSel: ".fleet-section",
      build: buildServices,
      place: function (anchor, node) {
        if (!anchor.parentNode) return false;
        anchor.parentNode.insertBefore(node, anchor);
        return true;
      }
    }
  ];

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : +new Date();
  }

  // React attaches a "__reactFiber$<rand>" own-property to every DOM node it renders; it is
  // absent on raw server HTML. Its presence on the anchor means React has committed that
  // node, so inserting relative to it now can't be seen as a hydration mismatch.
  function reactCommitted(node) {
    if (!node) return false;
    var keys = Object.getOwnPropertyNames(node);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("__reactFiber$") === 0) return true;
    }
    return false;
  }

  // Insert one unit once. Re-queries its anchor FRESH every call (the server node is
  // discarded when React client-renders #root after its pre-existing #418, so a cached ref
  // would be stale). Idempotency bail keeps it single.
  function injectUnit(u) {
    if (typeof document === "undefined" || !document.body) return false;
    if (document.getElementById(u.id)) return false;                // idempotent — already present
    var anchor = document.querySelector(u.anchorSel);               // FRESH re-query at insert time
    if (!anchor) {
      if (!u.warned && window.console && console.warn) {
        console.warn("[nlr] " + u.anchorSel + " not found; " + u.id + " not injected.");
        u.warned = true;
      }
      return false;
    }
    if (!u.place(anchor, u.build())) return false;                  // anchor lost its parent -> retry later
    if (!u.injectedAt) {
      u.injectedAt = nowMs();
      if (window.console && console.info) console.info("[nlr] " + u.id + " injected @ " + Math.round(u.injectedAt) + "ms");
    } else if (window.console && console.info) {
      console.info("[nlr] " + u.id + " RE-injected by backstop @ " + Math.round(nowMs()) + "ms");
    }
    return true;
  }

  // Backstop ONLY (starts once, after gating): re-inject a container if it goes missing
  // while its anchor is present (e.g. a later React re-render discarded it). No-ops when the
  // container already exists, so it never loops or double-inserts either node.
  var backstopStarted = false;
  function startBackstop() {
    if (backstopStarted || typeof MutationObserver === "undefined") return;
    backstopStarted = true;
    new MutationObserver(function () {
      for (var i = 0; i < UNITS.length; i++) {
        var u = UNITS[i];
        if (document.getElementById(u.id)) continue;                // present -> no-op
        if (document.querySelector(u.anchorSel)) injectUnit(u);     // missing + anchor -> re-inject
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Deterministic gate. We wait for React's *final* commit of the homepage content, then
  // inject both units at their own anchors (re-queried fresh). The settle signal is a fiber
  // on .fleet-section: it is the last homepage section, past the point where the site's
  // pre-existing #418 aborts hydration, so React only attaches its fiber in the committed
  // client render — never transiently. (An earlier node like .home-content DOES get a
  // transient fiber during the aborted hydration and is then discarded, so gating on it alone
  // would inject onto a doomed node and force a wipe->reinject.) Once .fleet-section is
  // committed, .home-content is settled too, so inserting the band into it is stable.
  // If the signal hasn't fired within 4000ms, inject anyway (bounded worst case).
  var SETTLE_SEL = ".fleet-section";
  function gate() {
    var t0 = nowMs();
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
    (function tick() {
      var timedOut = (nowMs() - t0) >= 4000;
      if (reactCommitted(document.querySelector(SETTLE_SEL)) || timedOut) {
        for (var i = 0; i < UNITS.length; i++) injectUnit(UNITS[i]);  // each inserts at its own anchor
        startBackstop();
        return;
      }
      raf(tick);
    })();
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", gate);
    } else {
      gate();                                                       // DOM already parsed
    }
  }
})();
