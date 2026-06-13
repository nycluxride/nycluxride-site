/*
 * NYC LUX RIDE — single source of truth for advertised pricing.
 *
 * Mirrors the assets/policy.js pattern: one data object, read at runtime so
 * the displayed rate card can never drift from its source. Loaded as a classic
 * script BEFORE the app bundle on every page. It only renders on /services
 * (the Rates section); everywhere else it is an inert no-op.
 *
 * Rendering is plain DOM (no React coupling): it inserts a self-contained
 * Rates section before the "Our Fleet" section after hydration, and a
 * MutationObserver re-applies it after client-side navigation. Idempotent.
 *
 * Prices are the owner's PUBLISHED rates. Vehicles without a published number
 * show "Request a quote" linking to the booking URL — never a made-up price.
 * Images are existing /fleet/ assets only; no external/stock image URLs.
 *
 * PENDING CLIENT (do not invent values — confirm, then edit here):
 *  - Chevrolet Suburban: per-transfer/hourly price (currently "Request a quote").
 *  - Mercedes-Benz S-Class: keep the $125/hr hourly line, or drop hourly?
 *  - BMW 7 Series: per-transfer is $110 today — owner deciding $165 vs none;
 *    plus the same hourly question as S-Class.
 *  - Sedans tier (Lyriq, CT5, CT6, Continental): photos PENDING from owner —
 *    rendered as text-only cards until images exist (never a broken image box).
 */
window.NLR_PRICING = window.NLR_PRICING || {};
window.NLR_PRICING.data = {
  bookingUrl: "https://customer.moovs.app/nyc-lux-ride/request/new",
  footnote: "All prices exclude taxes, tolls & gratuity. Final total confirmed at booking.",
  priceRange: "$85-$165",
  airportFlat: {
    label: "Airport Transfers — Luxury SUV",
    rates: [
      { airport: "JFK", price: 165 },
      { airport: "Newark (EWR)", price: 165 },
      { airport: "Teterboro (TEB)", price: 165 },
      { airport: "LaGuardia (LGA)", price: 130 }
    ]
  },
  hourly: { from: 100, minHours: 3 },
  // Order: Escalade -> Suburban -> S-Class -> BMW 7 -> (remaining). Images exist.
  vehicles: [
    { name: "Cadillac Escalade", image: "/fleet/cadillac-escalade.webp", hourly: 105, minHours: 3, pax: 5, luggage: "3 large + 3 small bags" },
    { name: "Chevrolet Suburban", image: "/fleet/chevrolet-suburban.webp", quote: true, pax: 5, luggage: "3 large + 3 small bags" },
    { name: "Mercedes-Benz S-Class", image: "/fleet/mercedes-s-class.webp", fromTransfer: 165, hourly: 125, minHours: 3, pax: 3, luggage: "2 large + 1 small bag" },
    { name: "BMW 7 Series", image: "/fleet/bmw-7-series.webp", fromTransfer: 110, hourly: 125, minHours: 3, pax: 3, luggage: "2 large + 1 small bag" }
  ],
  // Sedans tier — NO images yet; text-only cards. Photos PENDING from owner.
  sedans: [
    { name: "Cadillac Lyriq", hourly: 85, minHours: 3, pax: 3 },
    { name: "Cadillac CT5", hourly: 85, minHours: 3, pax: 3 },
    { name: "Cadillac CT6", hourly: 85, minHours: 3, pax: 3 },
    { name: "Lincoln Continental", hourly: 85, minHours: 3, pax: 3 }
  ],
  quoteVehicles: ["Mercedes-Benz Sprinter"]
};

// Vehicle image cards — reused by the Rates section AND the homepage teaser.
window.NLR_PRICING.buildVehicleCards = function (d) {
  var book = (d && d.bookingUrl) || "";
  return ((d && d.vehicles) || []).map(function (v) {
    var price;
    if (v.quote) {
      price = '<p class="mt-2"><a href="' + book + '" class="text-gold font-semibold underline hover:text-white">Request a quote</a></p>';
    } else {
      price = "";
      if (v.fromTransfer) price += '<p class="mt-2 text-gold font-semibold">From $' + v.fromTransfer + ' <span class="text-gray-400 font-normal text-sm">per transfer</span></p>';
      if (v.hourly) price += '<p class="' + (v.fromTransfer ? "text-gray-300 text-sm" : "mt-2 text-gold font-semibold") + '">$' + v.hourly + '/hr &middot; ' + v.minHours + '-hour minimum</p>';
    }
    return '<div class="lux-panel rounded-2xl overflow-hidden border border-gold/25">'
      + '<img src="' + v.image + '" alt="' + v.name + '" loading="lazy" class="h-44 w-full object-cover">'
      + '<div class="p-5">'
      + '<h3 class="lux-3d-text-soft text-lg font-bold">' + v.name + '</h3>'
      + '<p class="text-gray-400 text-xs mt-1">' + v.pax + ' passengers &middot; ' + v.luggage + '</p>'
      + price
      + '</div></div>';
  }).join("");
};
// Backward-compatible alias (homepage teaser calls this name).
window.NLR_PRICING.buildTrioCards = window.NLR_PRICING.buildVehicleCards;

// Text-only sedan cards — no image element, so never a broken image box.
window.NLR_PRICING.buildSedanCards = function (d) {
  return ((d && d.sedans) || []).map(function (v) {
    return '<div class="lux-panel rounded-2xl p-5 border border-gold/25">'
      + '<h3 class="lux-3d-text-soft text-lg font-bold">' + v.name + '</h3>'
      + '<p class="text-gray-400 text-xs mt-1">' + v.pax + ' passengers</p>'
      + '<p class="mt-2 text-gold font-semibold">$' + v.hourly + '/hr <span class="text-gray-300 font-normal text-sm">&middot; ' + v.minHours + '-hour minimum</span></p>'
      + '</div>';
  }).join("");
};

// Pure builder (unit-testable headlessly). Returns the Rates section HTML.
window.NLR_PRICING.buildRatesHTML = function (d) {
  if (!d) return "";
  var cards = window.NLR_PRICING.buildVehicleCards(d);
  var sedans = window.NLR_PRICING.buildSedanCards(d);
  var airport = (d.airportFlat.rates || []).map(function (r) {
    return '<div class="flex items-center justify-between border-b border-gold/10 py-2">'
      + '<span class="text-gray-200">' + r.airport + '</span>'
      + '<span class="text-gold font-semibold">$' + r.price + '</span></div>';
  }).join("");
  return '<section id="nlr-rates" class="services-section" aria-label="Rates">'
    + '<div class="mx-auto w-full max-w-6xl px-6 py-12">'
    + '<h2 class="fleet-section-title-services">Our Rates</h2>'
    + '<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mt-6">' + cards + '</div>'
    + '<h3 class="lux-3d-text-soft text-xl font-bold mt-10 mb-1">Sedans</h3>'
    + '<p class="text-gray-400 text-xs mb-4">Photos coming soon.</p>'
    + '<div class="grid gap-4 grid-cols-2 lg:grid-cols-4">' + sedans + '</div>'
    + '<div class="grid gap-6 md:grid-cols-2 mt-10">'
    + '<div class="lux-panel rounded-2xl p-6"><h3 class="lux-3d-text-soft text-lg font-bold mb-3">' + d.airportFlat.label + '</h3>' + airport + '</div>'
    + '<div class="lux-panel rounded-2xl p-6"><h3 class="lux-3d-text-soft text-lg font-bold mb-3">Hourly Chauffeur</h3>'
    + '<p class="text-gold font-semibold text-xl">From $' + d.hourly.from + '/hr</p>'
    + '<p class="text-gray-300 text-sm">' + d.hourly.minHours + '-hour minimum</p>'
    + '<p class="mt-4 text-gray-300 text-sm">Other vehicles (' + (d.quoteVehicles || []).join(", ") + '): '
    + '<a href="' + d.bookingUrl + '" class="text-gold underline hover:text-white">Request a quote</a>.</p>'
    + '</div></div>'
    + '<p class="text-gray-400 text-xs text-center mt-6">' + d.footnote + '</p>'
    + '<div class="mt-6 flex justify-center"><a class="lux-home-button font-semibold px-7 py-3 text-sm" href="'
    + d.bookingUrl + '" aria-label="Book a ride with NYC LUX RIDE">Book Your Ride</a></div>'
    + '</div></section>';
};

function nlrEnsureRates() {
  var P = window.NLR_PRICING;
  if (!P || !P.data) return;                                   // defensive: absent -> no-op
  if (!/\/services(\.html)?$/.test(location.pathname)) return; // only the services page
  if (document.getElementById("nlr-rates")) return;            // idempotent
  var anchor = document.querySelector(".fleet-section-services");
  if (!anchor || !anchor.parentNode) return;                   // wait until fleet section is rendered
  var wrap = document.createElement("div");
  wrap.innerHTML = (P.buildRatesHTML(P.data) || "");
  if (wrap.firstChild) anchor.parentNode.insertBefore(wrap.firstChild, anchor);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlrEnsureRates);
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(nlrEnsureRates).observe(document.documentElement, { childList: true, subtree: true });
  }
}
