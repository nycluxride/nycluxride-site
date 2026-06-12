/*
 * NYC LUX RIDE — homepage sections (plain DOM, no React coupling).
 * Injects three sections on the homepage only, after hydration, before the
 * footer; a MutationObserver re-applies after client-side nav. Idempotent.
 * Uses EXISTING data only (no invented testimonials/reviews):
 *   a) Fleet & Rates teaser — reuses NLR_PRICING.buildTrioCards, links to /services
 *   b) Service Areas — grid of links to all 12 location pages
 *   c) How booking works — 3 steps + Book / Call / WhatsApp CTA band
 */
window.NLR_HOME = window.NLR_HOME || {};
window.NLR_HOME.booking = "https://customer.moovs.app/nyc-lux-ride/request/new";
window.NLR_HOME.tel = "tel:+16467750556";
window.NLR_HOME.wa = "https://wa.me/16467750556?text=Hi%20NYC%20Lux%20Ride%2C%20I%27d%20like%20to%20book%20a%20ride";
window.NLR_HOME.locations = [
  ["bronx", "Bronx"], ["brooklyn", "Brooklyn"], ["financial-district", "Financial District"],
  ["jfk-airport", "JFK Airport"], ["laguardia-airport", "LaGuardia Airport"], ["long-island-city", "Long Island City"],
  ["manhattan", "Manhattan"], ["queens", "Queens"], ["soho", "SoHo"],
  ["staten-island", "Staten Island"], ["upper-east-side", "Upper East Side"], ["upper-west-side", "Upper West Side"]
];

window.NLR_HOME.buildHTML = function () {
  var P = window.NLR_PRICING;
  var trio = (P && P.buildTrioCards) ? P.buildTrioCards(P.data) : "";
  var book = window.NLR_HOME.booking, tel = window.NLR_HOME.tel, wa = window.NLR_HOME.wa;

  var areas = window.NLR_HOME.locations.map(function (l) {
    return '<a href="/locations/' + l[0] + '" class="lux-panel rounded-xl px-4 py-3 text-center text-sm text-gray-200 hover:text-gold transition border border-gold/15">' + l[1] + '</a>';
  }).join("");

  var steps = [
    ["1", "Choose your ride", "Pick your vehicle and trip type — airport, hourly, or point-to-point."],
    ["2", "Reserve in seconds", "Book online instantly, or reach us by phone or WhatsApp."],
    ["3", "Ride in luxury", "Your professional chauffeur arrives on time, every time."]
  ].map(function (s) {
    return '<div class="lux-panel rounded-2xl p-6 text-center">'
      + '<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gold text-lux-black font-bold text-lux-black" style="color:#060606;background:#d4af37;">' + s[0] + '</div>'
      + '<h3 class="lux-3d-text-soft text-lg font-bold mb-1">' + s[1] + '</h3>'
      + '<p class="text-gray-300 text-sm">' + s[2] + '</p></div>';
  }).join("");

  return '<div id="nlr-home-sections">'
    // a) Fleet & Rates teaser
    + '<section class="services-section" aria-label="Fleet and rates"><div class="mx-auto w-full max-w-6xl px-6 py-12">'
    + '<h2 class="fleet-section-title-services">Our Fleet &amp; Rates</h2>'
    + '<div class="grid gap-6 md:grid-cols-3 mt-6">' + trio + '</div>'
    + '<div class="mt-8 flex justify-center"><a class="inline-block border border-gold text-gold font-inter text-sm font-semibold px-7 py-3 rounded-2xl hover:bg-gold hover:text-black transition-all duration-300" href="/services">View all rates &amp; fleet</a></div>'
    + '</div></section>'
    // b) Service Areas
    + '<section class="services-section" aria-label="Service areas"><div class="mx-auto w-full max-w-6xl px-6 py-12">'
    + '<h2 class="fleet-section-title-services">Service Areas</h2>'
    + '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">' + areas + '</div>'
    + '</div></section>'
    // c) How booking works
    + '<section class="services-section" aria-label="How booking works"><div class="mx-auto w-full max-w-6xl px-6 py-12">'
    + '<h2 class="fleet-section-title-services">How Booking Works</h2>'
    + '<div class="grid gap-6 md:grid-cols-3 mt-6">' + steps + '</div>'
    + '<div class="mt-8 flex flex-wrap items-center justify-center gap-4">'
    + '<a class="lux-home-button font-semibold px-7 py-3 text-sm" href="' + book + '" aria-label="Book a ride with NYC LUX RIDE">Book Now</a>'
    + '<a class="inline-block border border-gold text-gold font-semibold px-7 py-3 rounded-2xl hover:bg-gold hover:text-black transition" href="' + tel + '">Call +1 (646) 775-0556</a>'
    + '<a class="inline-block border border-[#25D366] text-[#25D366] font-semibold px-7 py-3 rounded-2xl hover:brightness-125 transition" href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>'
    + '</div></div></section>'
    + '</div>';
};

function nlrEnsureHome() {
  if (typeof document === "undefined" || !document.body) return;
  if (!/^\/(index(\.html)?)?$/.test(location.pathname)) return; // homepage only
  if (document.getElementById("nlr-home-sections")) return;     // idempotent
  var footer = document.querySelector("footer");
  if (!footer || !footer.parentNode) return;                    // wait for render
  var wrap = document.createElement("div");
  wrap.innerHTML = window.NLR_HOME.buildHTML();
  if (wrap.firstChild) footer.parentNode.insertBefore(wrap.firstChild, footer);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlrEnsureHome);
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(nlrEnsureHome).observe(document.documentElement, { childList: true, subtree: true });
  }
}
