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
 * TODO (owner): per-vehicle price labels on the live React fleet cards were
 * deferred (avoiding hydration clobber); revisit if the fleet UI is rebuilt.
 */
window.NLR_PRICING = window.NLR_PRICING || {};
window.NLR_PRICING.data = {
  bookingUrl: "https://customer.moovs.app/nyc-lux-ride/request/new",
  disclaimer: "Prices exclude taxes, tolls & gratuity. Final total confirmed at booking.",
  priceRange: "$95-$165",
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
  // Flagship trio — featured first, with existing /fleet/ images + published prices + specs.
  vehicles: [
    { name: "Cadillac Escalade ESV", image: "/fleet/cadillac-escalade.webp", fromTransfer: 95, hourly: 105, minHours: 3, year: "2026", pax: 5, luggage: "3 large + 3 small bags" },
    { name: "Mercedes-Benz S-Class", image: "/fleet/mercedes-s-class.webp", fromTransfer: 165, hourly: 125, minHours: 3, year: "2024–2026", pax: 3, luggage: "2 large + 1 small bag" },
    { name: "BMW 7 Series", image: "/fleet/bmw-7-series.webp", fromTransfer: 110, hourly: 125, minHours: 3, year: "2024–2026", pax: 3, luggage: "2 large + 1 small bag" }
  ],
  // No published price yet -> "Request a quote", never a guessed number.
  quoteVehicles: ["Chevrolet Suburban", "Mercedes-Benz Sprinter", "Cadillac Lyriq", "luxury sedans"]
};

// Pure builder (unit-testable headlessly). Returns the Rates section HTML.
window.NLR_PRICING.buildRatesHTML = function (d) {
  if (!d) return "";
  var suf = ' <span class="text-gray-400 font-normal text-xs">+ tax &amp; tolls</span>';
  var cards = (d.vehicles || []).map(function (v) {
    return '<div class="lux-panel rounded-2xl overflow-hidden border border-gold/25">'
      + '<img src="' + v.image + '" alt="' + v.name + '" loading="lazy" class="h-44 w-full object-cover">'
      + '<div class="p-5">'
      + '<h3 class="lux-3d-text-soft text-lg font-bold">' + v.name + '</h3>'
      + '<p class="text-gray-400 text-xs mt-1">' + v.year + ' &middot; ' + v.pax + ' passengers &middot; ' + v.luggage + '</p>'
      + '<p class="mt-2 text-gold font-semibold">From $' + v.fromTransfer + suf
      + ' <span class="text-gray-400 font-normal text-sm">per transfer</span></p>'
      + '<p class="text-gray-300 text-sm">$' + v.hourly + '/hr' + suf + ' &middot; ' + v.minHours + '-hour minimum</p>'
      + '</div></div>';
  }).join("");
  var airport = (d.airportFlat.rates || []).map(function (r) {
    return '<div class="flex items-center justify-between border-b border-gold/10 py-2">'
      + '<span class="text-gray-200">' + r.airport + '</span>'
      + '<span class="text-gold font-semibold">$' + r.price + suf + '</span></div>';
  }).join("");
  return '<section id="nlr-rates" class="services-section" aria-label="Rates">'
    + '<div class="mx-auto w-full max-w-6xl px-6 py-12">'
    + '<h2 class="fleet-section-title-services">Our Rates</h2>'
    + '<div class="grid gap-6 md:grid-cols-3 mt-6">' + cards + '</div>'
    + '<div class="grid gap-6 md:grid-cols-2 mt-8">'
    + '<div class="lux-panel rounded-2xl p-6"><h3 class="lux-3d-text-soft text-lg font-bold mb-3">' + d.airportFlat.label + '</h3>' + airport + '</div>'
    + '<div class="lux-panel rounded-2xl p-6"><h3 class="lux-3d-text-soft text-lg font-bold mb-3">Hourly Chauffeur</h3>'
    + '<p class="text-gold font-semibold text-xl">From $' + d.hourly.from + '/hr' + suf + '</p>'
    + '<p class="text-gray-300 text-sm">' + d.hourly.minHours + '-hour minimum</p>'
    + '<p class="mt-4 text-gray-300 text-sm">Other vehicles (' + (d.quoteVehicles || []).join(", ") + '): '
    + '<a href="' + d.bookingUrl + '" class="text-gold underline hover:text-white">Request a quote</a>.</p>'
    + '</div></div>'
    + '<p class="text-gray-400 text-xs text-center mt-6">' + d.disclaimer + '</p>'
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
