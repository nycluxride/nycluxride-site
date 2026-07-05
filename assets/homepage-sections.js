/*
 * NYC LUX RIDE — homepage service sections + World Cup band (plain DOM, no React
 * coupling). Injected immediately BEFORE the fleet section, gated on a "React has
 * committed .fleet-section" signal (a __reactFiber$ own-property) so our node is never
 * present during React's hydration pass; a MutationObserver stays on only as a backstop.
 * Included on index.html only, so it runs on the homepage only.
 *
 * Conversion tracking: tracking.js listens on document (capture phase) and matches by
 * href prefix, catching runtime-injected links — so the band's Book Now
 * (https://customer.moovs.app/...) and WhatsApp (https://wa.me/...) buttons are
 * auto-tracked as book_now_click / whatsapp_click. No explicit gtag call is needed.
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

  var warned = false;

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

  function build() {
    var wrap = el("section");
    wrap.id = "nlr-injected";
    wrap.setAttribute("aria-label", "Services and World Cup transfers");

    // (1) Slim World Cup band
    var band = el("div", "nlr-wc-band");
    band.appendChild(el("p", "nlr-wc-msg",
      "⚽ World Cup 2026 — now booking luxury transfers to MetLife Stadium. Airport, hotel & stadium transport across NYC & NJ."));
    var actions = el("div", "nlr-wc-actions");
    actions.appendChild(link("nlr-btn-book", BOOK_URL, "Book Now", "Book Now"));
    actions.appendChild(link("nlr-btn-wa", WA_URL, "WhatsApp", "Message NYC LUX RIDE on WhatsApp"));
    band.appendChild(actions);
    wrap.appendChild(band);

    // (2) Services grid
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

  var injectedAt = 0;

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : +new Date();
  }

  // Insert once. Re-queries .fleet-section FRESH every call (the server node is discarded
  // when React client-renders #root after its pre-existing #418, so a cached ref would be
  // stale). Idempotency bail keeps it single.
  function injectOnce() {
    if (typeof document === "undefined" || !document.body) return false;
    if (document.getElementById("nlr-injected")) return false;      // idempotent — already present
    var fleet = document.querySelector(".fleet-section");           // FRESH re-query at insert time
    if (!fleet || !fleet.parentNode) {                              // fail safe — nothing to anchor to
      if (!warned && window.console && console.warn) {
        console.warn("[nlr] .fleet-section not found; homepage sections not injected.");
        warned = true;
      }
      return false;
    }
    fleet.parentNode.insertBefore(build(), fleet);                  // insert immediately BEFORE the fleet section
    if (!injectedAt) {
      injectedAt = nowMs();
      if (window.console && console.info) console.info("[nlr] sections injected @ " + Math.round(injectedAt) + "ms");
    } else if (window.console && console.info) {
      console.info("[nlr] sections RE-injected by backstop @ " + Math.round(nowMs()) + "ms");
    }
    return true;
  }

  // React attaches a "__reactFiber$<rand>" own-property to every DOM node it renders; it is
  // absent on raw server HTML. Its presence on the CURRENT .fleet-section means React has
  // committed that node, so inserting a sibling now can't be seen as a hydration mismatch.
  function reactCommitted(node) {
    if (!node) return false;
    var keys = Object.getOwnPropertyNames(node);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("__reactFiber$") === 0) return true;
    }
    return false;
  }

  // Backstop ONLY: after the initial gated inject, re-inject if our node goes missing while
  // the fleet section is present (e.g. a later React re-render discarded it). No-ops when our
  // node already exists, so it never loops or double-inserts.
  function startBackstop() {
    if (typeof MutationObserver === "undefined") return;
    new MutationObserver(function () {
      if (document.getElementById("nlr-injected")) return;          // present -> no-op
      if (document.querySelector(".fleet-section")) injectOnce();   // missing + anchor -> re-inject
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Deterministic gate: rAF-poll (not a tight interval) until React has committed the
  // .fleet-section node, then inject against a FRESH query. If the committed signal hasn't
  // fired within 4000ms, inject anyway (bounded worst case = the previous behavior).
  function gate() {
    var t0 = nowMs();
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
    (function tick() {
      if (document.getElementById("nlr-injected")) { startBackstop(); return; }
      if (reactCommitted(document.querySelector(".fleet-section")) || (nowMs() - t0) >= 4000) {
        injectOnce();
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
