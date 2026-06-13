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
 * The fleet is organized into labeled tiers. Every vehicle renders its working
 * /fleet/ image (the card builder still supports an image-less text-only card
 * if a future vehicle lacks a photo). No external or hotlinked images.
 * Vehicles without a published price show "Request a quote" linking to the
 * booking URL — never a made-up number.
 *
 * PENDING CLIENT (confirm, then edit here): price for Lincoln Navigator
 * (currently "Request a quote").
 */
window.NLR_PRICING = window.NLR_PRICING || {};
window.NLR_PRICING.data = {
  bookingUrl: "https://customer.moovs.app/nyc-lux-ride/request/new",
  footnote: "All prices exclude taxes, tolls & gratuity. Final total confirmed at booking.",
  priceRange: "$85-$175",
  airportFlat: {
    label: "Airport Transfers — Luxury SUV",
    rates: [
      { airport: "JFK", price: 165 },
      { airport: "Newark (EWR)", price: 165 },
      { airport: "Teterboro (TEB)", price: 165 },
      { airport: "LaGuardia (LGA)", price: 130 }
    ]
  },
  tiers: [
    {
      heading: "Business SUV",
      vehicles: [
        { name: "Cadillac Escalade ESV", image: "/fleet/cadillac-escalade.webp", hourly: 105, minHours: 3, pax: 5, luggage: "3 large + 3 small bags" },
        { name: "GMC Denali", image: "/fleet/gmc-denali.webp", hourly: 100, minHours: 3, pax: 5, luggage: "3 large + 3 small bags" },
        { name: "Chevrolet Suburban / similar", image: "/fleet/chevrolet-suburban.webp", hourly: 95, minHours: 3, pax: 5, luggage: "3 large + 3 small bags" },
        { name: "Lincoln Navigator", image: "/fleet/lincoln-navigator.webp", quote: true, pax: 5, luggage: "3 large + 3 small bags" }
      ]
    },
    {
      heading: "First Class",
      vehicles: [
        { name: "Mercedes-Benz S-Class", image: "/fleet/mercedes-s-class.webp", fromTransfer: 165, hourly: 125, minHours: 3, pax: 3, luggage: "2 large + 1 small bag" },
        { name: "BMW 7 Series", image: "/fleet/bmw-7-series.webp", fromTransfer: 165, hourly: 125, minHours: 3, pax: 3, luggage: "2 large + 1 small bag" }
      ]
    },
    {
      heading: "Sedan & Electric",
      vehicles: [
        { name: "Cadillac Lyriq / similar", image: "/fleet/cadillac-lyriq.webp", hourly: 85, minHours: 3, pax: 3 },
        { name: "Cadillac CT5 / CT6", image: "/fleet/cadillac-ct5-ct6.webp", hourly: 85, minHours: 3, pax: 3 },
        { name: "Cadillac XT6", image: "/fleet/cadillac-xt6.webp", hourly: 85, minHours: 3, pax: 3 },
        { name: "Lincoln Continental", image: "/fleet/lincoln-continental.webp", hourly: 85, minHours: 3, pax: 3 }
      ]
    },
    {
      heading: "Luxury Sprinter",
      vehicles: [
        { name: "Limo Sprinter", image: "/fleet/sprinter-limo.webp", hourly: 175, hourlyFrom: true, minHours: 3, pax: 12, luggage: "10 large + 2 small" },
        { name: "Jet Sprinter", image: "/fleet/sprinter-jet.webp", hourly: 175, hourlyFrom: true, minHours: 3, pax: 12, luggage: "10 large + 2 small" }
      ]
    }
  ]
};

// Single card builder — handles image vs text-only, quote vs priced, transfer
// and/or hourly, the "From" prefix, passengers/luggage, and an optional note.
window.NLR_PRICING.card = function (v, book) {
  var price;
  if (v.quote) {
    price = '<p class="mt-2"><a href="' + (book || "") + '" class="text-gold font-semibold underline hover:text-white">Request a quote</a></p>';
  } else {
    price = "";
    if (v.fromTransfer) price += '<p class="mt-2 text-gold font-semibold">From $' + v.fromTransfer + ' <span class="text-gray-400 font-normal text-sm">per transfer</span></p>';
    if (v.hourly) {
      var cls = v.fromTransfer ? "text-gray-300 text-sm" : "mt-2 text-gold font-semibold";
      price += '<p class="' + cls + '">' + (v.hourlyFrom ? "From " : "") + '$' + v.hourly + '/hr <span class="text-gray-300 font-normal text-sm">&middot; ' + v.minHours + '-hour minimum</span></p>';
    }
  }
  var specs = v.pax ? '<p class="text-gray-400 text-xs mt-1">' + v.pax + ' passengers' + (v.luggage ? ' &middot; ' + v.luggage : "") + '</p>' : "";
  var note = v.note ? '<p class="text-gray-500 text-xs italic mt-1">' + v.note + '</p>' : "";
  if (v.image) {
    return '<div class="lux-panel rounded-2xl overflow-hidden border border-gold/25">'
      + '<img src="' + v.image + '" alt="' + v.name + '" loading="lazy" class="h-44 w-full object-cover">'
      + '<div class="p-5"><h3 class="lux-3d-text-soft text-lg font-bold">' + v.name + '</h3>' + specs + note + price + '</div></div>';
  }
  return '<div class="lux-panel rounded-2xl p-5 border border-gold/25 flex flex-col">'
    + '<h3 class="lux-3d-text-soft text-lg font-bold">' + v.name + '</h3>' + specs + note + price + '</div>';
};

// Homepage teaser — one representative card per tier (links out to /services).
window.NLR_PRICING.buildVehicleCards = function (d) {
  return ((d && d.tiers) || []).map(function (t) {
    return window.NLR_PRICING.card((t.vehicles && t.vehicles[0]) || {}, d.bookingUrl);
  }).join("");
};
// Backward-compatible alias (homepage teaser calls this name).
window.NLR_PRICING.buildTrioCards = window.NLR_PRICING.buildVehicleCards;

// Pure builder (unit-testable headlessly). Returns the full tiered Rates section.
window.NLR_PRICING.buildRatesHTML = function (d) {
  if (!d) return "";
  var tiers = ((d.tiers) || []).map(function (t) {
    var cards = (t.vehicles || []).map(function (v) { return window.NLR_PRICING.card(v, d.bookingUrl); }).join("");
    return '<h3 class="lux-3d-text-soft text-2xl font-bold mt-10 mb-4">' + t.heading + '</h3>'
      + '<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">' + cards + '</div>';
  }).join("");
  var airport = (d.airportFlat.rates || []).map(function (r) {
    return '<div class="flex items-center justify-between border-b border-gold/10 py-2">'
      + '<span class="text-gray-200">' + r.airport + '</span>'
      + '<span class="text-gold font-semibold">$' + r.price + '</span></div>';
  }).join("");
  return '<section id="nlr-rates" class="services-section" aria-label="Rates">'
    + '<div class="mx-auto w-full max-w-6xl px-6 py-12">'
    + '<h2 class="fleet-section-title-services">Our Rates</h2>'
    + tiers
    + '<div class="lux-panel rounded-2xl p-6 mt-10 max-w-md mx-auto"><h3 class="lux-3d-text-soft text-lg font-bold mb-3">' + d.airportFlat.label + '</h3>' + airport + '</div>'
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
