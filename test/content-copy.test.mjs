import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");

const BANNED = [
  "standard gratuity",
  "Standard 20%",
  "20% gratuity",
  "gratuity is charged at booking",
  "exclude taxes, tolls",
  "exclude tolls",
  "before taxes, tolls and gratuity",
  "quoted at booking",
  "$130",
  "the class the airport flat rates are quoted against",
  "government trip charges",
  "Address, airport, hotel, ...",
  "Wireless internet and charging at every seat",
  "Wireless internet and a charger on board",
  "Wireless internet and power at each of the seats",
  "which is why every booking in this area asks for one",
  "Evening bookings acknowledged the day before",
  "Pre-market departures accepted from four in the morning",
  "household account",
  "Repeat pickups kept on a single household account",
  "Route knowledge is the last piece",
  "A chauffeur who has driven the same district for years",
];

const A = {
  A1: "Airport transfers to or from JFK, LaGuardia, Newark and Teterboro are one total price by vehicle class from any New York City address, with tolls, airport fees, NYC sales tax and the Black Car Fund included.",
  A2: "A gratuity for your chauffeur is optional and chosen when you book.",
  A3: "After an airport transfer, only true extras are charged to the card saved at booking: waiting beyond the free window, extra stops and parking, each with an itemized receipt.",
  A4: "Hourly bookings are charged the hourly fare with NYC sales tax and the Black Car Fund at booking. Tolls and parking are charged after the ride to the card saved at booking, each with an itemized receipt.",
  A5: "Airport transfers are one total price with tolls, airport fees and taxes included, and the gratuity for your chauffeur is optional. On hourly bookings and trips priced by distance and time, tolls and parking are charged after the ride to the card saved at booking, each with an itemized receipt.",
  A6: "Airport transfer prices include tolls, airport fees and taxes, and the gratuity is optional.",
  A7: "Airport transfer prices include tolls, airport fees and taxes. Hourly rates and rates by distance and time are before NYC sales tax, the Black Car Fund, tolls and parking, and the gratuity is optional.",
  A8: "Airport prices from NYC LUX RIDE include tolls and airport fees, so the route does not change the price.",
  A9: "Chauffeured luxury black cars across New York City, with flat rates to JFK, LaGuardia, Newark and Teterboro.",
};

const PREFIX = {
  A1: "Airport transfers to or from JFK, LaGuardia, Newark and Teterboro are one total price",
  A2: "A gratuity for your chauffeur is optional and",
  A3: "After an airport transfer, only",
  A4: "Hourly bookings are charged the hourly fare",
  A5: "Airport transfers are one total price with tolls",
  A6: "Airport transfer prices include tolls, airport fees and taxes, and",
  A7: "Airport transfer prices include tolls, airport fees and taxes. ",
  A8: "Airport prices from NYC LUX RIDE include",
  A9: "Chauffeured luxury black cars across New York City",
};

const USED = {
  A1: ["black-car-service-brooklyn.html", "faq.html", "locations/jfk-airport.html", "locations/laguardia-airport.html"],
  A2: ["blog/nyc-limo-service-comparison-guide-april-29.html", "blog/nyc-prom-limo-booking-guide-march-13.html"],
  A4: ["blog/nyc-prom-limo-booking-guide-march-13.html"],
  A5: [
    "about.html",
    "blog/best-black-car-service-brooklyn-queens-march-20.html",
    "blog/corporate-black-car-nyc-april-3.html",
    "blog/jfk-lga-ewr-airport-transfer-guide-april-17.html",
    "blog/manhattan-hourly-chauffeur-service-april-10.html",
    "blog/nyc-cruise-terminal-black-car-service-guide-march-6.html",
    "blog/nyc-limo-service-comparison-guide-april-29.html",
    "blog/whatsapp-airport-pickup-coordination-nyc-april-24.html",
    "contact.html",
    "schedule.html",
  ],
  A7: ["about.html", "blog/corporate-black-car-nyc-april-3.html", "locations/long-island-city.html"],
  A8: ["blog/best-black-car-service-brooklyn-queens-march-20.html", "locations/staten-island.html"],
};

const FAQ_TOLLS = "Tolls are included on airport transfers: the price covers tolls and airport fees, NYC sales tax and the Black Car Fund. The gratuity for your chauffeur is optional and chosen when you book. On hourly bookings and trips priced by distance and time, tolls and parking are charged after the ride to the card saved at booking, each with an itemized receipt.";
const TERMS_PAYMENTS = "Online bookings are paid on a Stripe payment page. The total shown at checkout is charged at booking: the fare with NYC sales tax and the Black Car Fund, on airport transfers also tolls and airport fees, and meet and greet and a gratuity for the chauffeur if chosen. The card used at booking is saved for the charges known only after the ride: on airport transfers waiting beyond the free window, extra stops and parking, and on hourly bookings and trips priced by distance and time tolls and parking. These are charged to that card after the ride, each with an itemized receipt.";
const FAQ_OUTSIDE = "Yes. A one-way trip to or from a New York City address is priced on the booking page by distance and time, unless it starts or ends at an airport. The flat airport rate is for New York City addresses. For long trips and other places, our dispatch team prices the trip.";

const RATES_TITLE = "NYC Car Service Rates: Airport Transfers from $145 | NYC LUX RIDE";
const RATES_DESCRIPTION = "Airport transfers to or from JFK, Newark and Teterboro from $170 and LaGuardia from $145, with tolls, airport fees and taxes included. Hourly from $85 by vehicle class, 3-hour minimum.";
const RATES_LEDE = "Airport transfers are one total price by vehicle class from any New York City address, with tolls, airport fees and taxes included. Hourly work is billed by vehicle class with a three hour minimum. There is no meter and no surge multiplier, so the price does not move with demand.";
const RATES_HOURLY_CAPTION = "Prices are before NYC sales tax (8.875%) and the Black Car Fund (2.25%), which are added at booking. Tolls and parking are charged after the ride.";
const RATES_FACTS = {
  "Meet and greet": "Inside the terminal with a name sign, $25 charged at booking, plus any airport parking charged after the ride",
  Gratuity: "Optional, none, a dollar amount you choose, or 10%, 15% or 20% of the fare, chosen before you pay",
  "Tolls and airport fees": "Included on airport transfers. On hourly bookings and trips priced by distance and time, billed at cost after the ride to the card saved at booking",
  Taxes: "NYC sales tax (8.875%) and the Black Car Fund (2.25%) are charged at booking on every fare",
  "Extra stops": "On airport transfers, charged after the ride to the card saved at booking",
};
const RATES_FOOTNOTE = "All prices in USD. Airport totals include tolls, airport fees and taxes. Hourly rates and rates by distance and time are before tax, tolls and parking. A gratuity is optional.";
const RATES_CANCELLATION = "At booking you pay the total shown at checkout: on airport transfers the fare, NYC sales tax, the Black Car Fund and tolls and airport fees, on hourly bookings and trips priced by distance and time the fare with NYC sales tax and the Black Car Fund, plus meet and greet and a gratuity if you choose them. The card used at booking is saved for the charges known only after the ride: on airport transfers waiting beyond the free window, extra stops and parking, and on hourly bookings and trips priced by distance and time tolls and parking. Each is charged with an itemized receipt.";
const RATES_FAQ = [
  ["How much is a car from Manhattan to JFK?", "$185 in a Business SUV, from any New York City address. That total includes the $155 fare, NYC sales tax, the Black Car Fund, and tolls and airport fees. Sedan & Electric is $170, Business Premium SUV $220, First Class $310 and Luxury Sprinter $400. A gratuity for your chauffeur is optional."],
  ["How much is a car to LaGuardia?", "$165 in a Business SUV, from any New York City address. Sedan & Electric is $145, Business Premium SUV $190, First Class $250 and Luxury Sprinter $350. Each class costs less to LaGuardia than to JFK, Newark or Teterboro."],
  ["What is the shortest hourly booking?", "Three hours. In the Sedan & Electric class that is $255 before NYC sales tax and the Black Car Fund, with tolls and parking charged after the ride."],
  ["When is my fare confirmed?", "The vehicle, the class and the fare come back in writing before the day."],
];
const RATES_CLASSES = [
  ["airport-suv", "Business SUV", "Chevrolet Suburban or similar, GMC Denali, Lincoln Navigator", "185", "165"],
  ["airport-premium", "Business Premium SUV", "Cadillac Escalade ESV", "220", "190"],
  ["airport-first", "First Class", "Mercedes-Benz S-Class, BMW 7 Series", "310", "250"],
  ["airport-sedan", "Sedan & Electric", "Cadillac Lyriq or similar, Cadillac CT5 or CT6, Cadillac XT6, Lincoln Continental", "170", "145"],
  ["airport-sprinter", "Luxury Sprinter", "Limo Sprinter, Jet Sprinter", "400", "350"],
];
const RATES_AIRPORT_OFFERS = RATES_CLASSES.flatMap(([id, name, , far, lga]) => [
  [`Airport transfer, JFK, Newark or Teterboro, ${name}`, id, far, ["JFK", "EWR", "TEB"]],
  [`Airport transfer, LaGuardia, ${name}`, id, lga, ["LGA"]],
]);

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "cdn-cgi"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

const squash = (s) => String(s).replace(/\s+/g, " ").trim();
const COPY_ATTRS = new Set(["alt", "aria-label", "title", "placeholder", "value"]);
const COPY_METAS = 'meta[name="description"][content], meta[property^="og:"][content], meta[name^="twitter:"][content]';
const BLOCKS = "p, li, dd, dt, td, th, caption, summary, h1, h2, h3, h4, figcaption, legend, label, option";

function read(file) {
  const { document } = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window;
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => JSON.parse(n.textContent));
  const strings = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else if (typeof v === "string") strings.push(v);
  };
  ld.forEach(walk);
  const body = document.body.cloneNode(true);
  for (const n of body.querySelectorAll("script, style")) n.remove();
  const parts = [];
  const w = document.createTreeWalker(body, 4);
  while (w.nextNode()) parts.push(w.currentNode.nodeValue);
  const attrs = [...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => [a.name, a.value]));
  const metas = [...document.querySelectorAll(COPY_METAS)].map((m) => m.getAttribute("content"));
  const copy = [
    ...[...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].filter((a) => COPY_ATTRS.has(a.name)).map((a) => [a.name, a.value])),
    ...metas.map((v) => ["content", v]),
  ];
  const blocks = [...body.querySelectorAll(BLOCKS)].map((el) => squash(el.textContent));
  return {
    document,
    graph: ld.flatMap((b) => b["@graph"] || [b]),
    strings,
    attrs,
    copy,
    title: document.title,
    text: squash(parts.join(" ")),
    blocks: [...blocks, ...metas.map(squash), ...strings.map(squash), squash(document.title)],
  };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

const FILES = htmlFiles(ROOT);
const pages = new Map(FILES.map((f) => [f, read(f)]));

check("page discovery found the site, the rates page, the faq and the terms", () => {
  assert.ok(FILES.length >= 30, `only ${FILES.length} html files`);
  for (const f of ["rates.html", "faq.html", "terms-of-service.html", "blog.html", "index.html"]) assert.ok(FILES.includes(f), `${f} is missing`);
});

const banned = (haystack) => {
  const low = haystack.toLowerCase();
  return BANNED.filter((s) => (s.startsWith("$") ? new RegExp(`\\$\\s*${s.slice(1)}(?!\\d)`).test(haystack) : low.includes(s.toLowerCase())));
};

for (const [file, p] of pages) {
  check(`${file}: none of the retired pricing phrases in text, attributes or json-ld`, () => {
    const hits = [];
    for (const s of banned(p.title)) hits.push(`title: ${s}`);
    for (const s of banned(p.text)) hits.push(`text: ${s}`);
    for (const [name, value] of p.attrs) for (const s of banned(value)) hits.push(`${name}=: ${s}`);
    for (const v of p.strings) for (const s of banned(v)) hits.push(`json-ld: ${s}`);
    assert.deepEqual([...new Set(hits)], []);
  });

  check(`${file}: no em dash, en dash or semicolon in visible copy, copy attributes or json-ld`, () => {
    const bad = /[—–;]/;
    const hits = [];
    if (bad.test(p.title)) hits.push(`title: ${p.title}`);
    const m = bad.exec(p.text);
    if (m) hits.push(`text: ...${p.text.slice(Math.max(0, m.index - 50), m.index + 20)}...`);
    for (const [name, value] of p.copy) if (bad.test(value)) hits.push(`${name}=${value.slice(0, 80)}`);
    for (const v of p.strings) if (bad.test(v)) hits.push(`json-ld: ${v.slice(0, 80)}`);
    assert.deepEqual(hits, []);
  });

  check(`${file}: the fleet size is never written as a word in text, attributes or json-ld (seat counts stay)`, () => {
    const fleet = /\btwelve (vehicles|cars)\b|\ball twelve\b(?! service areas)|\b(four )?of the twelve\b/i;
    const hits = [p.title, p.text, ...p.attrs.map(([, v]) => v), ...p.strings].filter((v) => fleet.test(v)).map((v) => v.slice(Math.max(0, v.search(fleet) - 40), v.search(fleet) + 40));
    assert.deepEqual(hits, []);
  });

  check(`${file}: a text link that opens a new tab carries the external icon and says so, apart from WhatsApp links and icon-only links`, () => {
    const bad = [...p.document.querySelectorAll('a[target="_blank"]')].filter((a) => {
      if (/^https:\/\/wa\.me\//.test(a.getAttribute("href")) || a.querySelector("svg") && !a.querySelector('use[href="#i-external"]') && !squash([...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(""))) return false;
      return !(a.querySelector('svg[aria-hidden="true"] use[href="#i-external"]') && /\(opens in a new tab\)$/.test(squash(a.textContent)));
    }).map((a) => `${squash(a.textContent).slice(0, 60)} -> ${a.getAttribute("href")}`);
    assert.deepEqual(bad, []);
  });

  check(`${file}: every approved sentence that is used is byte exact`, () => {
    const bad = [];
    for (const [id, prefix] of Object.entries(PREFIX)) {
      for (const block of p.blocks) if (block.includes(prefix) && !block.includes(A[id])) bad.push(`${id}: "${block.slice(Math.max(0, block.indexOf(prefix)), block.indexOf(prefix) + 160)}"`);
    }
    assert.deepEqual([...new Set(bad)], []);
  });
}

for (const [id, files] of Object.entries(USED)) {
  for (const file of files) {
    check(`${file}: carries approved sentence ${id}`, () => {
      const p = pages.get(file);
      assert.ok(p, `${file} is missing`);
      assert.ok(p.blocks.some((b) => b.includes(A[id])), `${id} not found`);
    });
  }
}

const faqAnswer = (p, question) => {
  const node = p.graph.find((n) => [].concat(n["@type"]).includes("FAQPage"));
  const q = node && node.mainEntity.find((e) => e.name === question);
  return q ? q.acceptedAnswer.text : undefined;
};
const visibleAnswer = (p, question) => {
  const d = [...p.document.querySelectorAll("main details")].find((x) => squash(x.querySelector("summary").textContent) === question);
  if (!d) return undefined;
  const body = d.cloneNode(true);
  body.querySelector("summary").remove();
  return squash(body.textContent);
};

check("faq.html: the tolls and gratuity answer is exact, visible and in json-ld", () => {
  const p = pages.get("faq.html");
  const question = "Are tolls and gratuity included in the rate?";
  assert.equal(visibleAnswer(p, question), FAQ_TOLLS);
  assert.equal(faqAnswer(p, question), FAQ_TOLLS);
});

check("faq.html: the outside New York City answer prices one-way trips by distance and time, exact, visible and in json-ld", () => {
  const p = pages.get("faq.html");
  const question = "Do you drive outside New York City?";
  assert.equal(visibleAnswer(p, question), FAQ_OUTSIDE);
  assert.equal(faqAnswer(p, question), FAQ_OUTSIDE);
});

check("faq.html: the airport rates answer names every airport and every class, visible and in json-ld", () => {
  const p = pages.get("faq.html");
  const question = "What are the airport rates?";
  const want = `${A.A1} Hourly bookings have a 3-hour minimum. All our rates are on the rates page.`;
  assert.equal(visibleAnswer(p, question), want);
  assert.equal(faqAnswer(p, question), want);
});

check("terms-of-service.html: the #payments section is exact and dated", () => {
  const p = pages.get("terms-of-service.html");
  const h = p.document.getElementById("payments");
  assert.ok(h, "no #payments");
  const parts = [];
  for (let n = h.nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) parts.push(squash(n.textContent));
  const text = parts.join(" ");
  assert.ok(text.includes(TERMS_PAYMENTS), text);
  const page = p.graph.find((n) => n["@type"] === "WebPage");
  assert.equal(page.dateModified, "2026-10-24");
  assert.ok(p.text.includes("Last Updated: October 24, 2026"));
});

const rates = pages.get("rates.html");
const meta = (selector) => rates.document.querySelector(selector)?.getAttribute("content");

check("rates.html: title, description, og copies and the WebPage description are exact", () => {
  assert.equal(rates.title, RATES_TITLE);
  assert.equal(meta('meta[property="og:title"]'), RATES_TITLE);
  assert.equal(meta('meta[name="description"]'), RATES_DESCRIPTION);
  assert.equal(meta('meta[property="og:description"]'), RATES_DESCRIPTION);
  assert.equal(rates.graph.find((n) => n["@type"] === "WebPage").description, RATES_DESCRIPTION);
});

check("rates.html: the lede is exact", () => {
  assert.equal(squash(rates.document.querySelector("main .lede").textContent), RATES_LEDE);
});

check("rates.html: the airport table rows, columns and footer are exact", () => {
  const table = rates.document.getElementById("jfk").closest("table");
  assert.equal(table.id, "airport-rates");
  assert.equal(squash(table.querySelector("caption").textContent), "One way airport transfers to or from any New York City address, by vehicle class.");
  assert.deepEqual([...table.querySelectorAll("thead th")].map((th) => squash(th.textContent)), ["Class and vehicles", "JFK, Newark and Teterboro", "LaGuardia"]);
  const firstText = (el) => [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim())?.nodeValue;
  const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [tr.id, squash(tr.querySelector("th").firstChild.textContent), squash(tr.querySelector("th small").textContent), ...[...tr.querySelectorAll("td")].map((td) => squash(firstText(td)))]);
  assert.deepEqual(rows, RATES_CLASSES.map(([id, name, vehicles, far, lga]) => [id, name, vehicles, `$${far}`, `$${lga}`]));
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map((td) => squash(td.textContent)), ["Totals for one way, in either direction, with tolls, airport fees, NYC sales tax and the Black Car Fund included."]);
});

check("rates.html: both First Class model lines keep S-Class in one nowrap span and join BMW 7 Series with no-break spaces", () => {
  for (const id of ["airport-first", "first-class"]) {
    const m = rates.document.getElementById(id).querySelector("th small");
    assert.deepEqual([[...m.querySelectorAll("span.nowrap")].map((n) => n.textContent), m.textContent.includes("BMW\u00a07\u00a0Series")], [["S-Class"], true], id);
  }
});

check("rates.html: #airport-total follows the airport table with the exact lines and footer", () => {
  const table = rates.document.getElementById("airport-total");
  assert.ok(table && table.matches("table.rate-table"), "no table#airport-total.rate-table");
  const first = rates.document.getElementById("jfk").closest(".table-scroll");
  assert.equal(first.nextElementSibling, table.closest(".table-scroll"), "#airport-total does not follow the airport table");
  assert.equal(squash(table.querySelector("caption").textContent), "What a $185 Business SUV total includes");
  const rows = [...table.querySelectorAll("tr")].filter((tr) => tr.querySelector("th[scope=row]")).map((tr) => [squash(tr.querySelector("th").textContent), squash(tr.querySelector("td").textContent)]);
  assert.deepEqual(rows, [["Fare", "$155.00"], ["NYC sales tax (8.875%)", "$13.76"], ["Black Car Fund (2.25%)", "$3.49"], ["Tolls and airport fees", "$12.75"], ["Total", "$185.00"]]);
  assert.equal(squash(table.querySelector("tfoot td[colspan]").textContent), "Every class adds NYC sales tax and the Black Car Fund to its fare, and $12.75 for tolls and airport fees. Meet and greet and a gratuity, if chosen, are added at booking.");
});

check("rates.html: the hourly caption adds the tax and after the ride sentence, rates unchanged", () => {
  const caption = squash(rates.document.getElementById("hourly-caption").textContent);
  assert.ok(caption.endsWith(RATES_HOURLY_CAPTION), caption);
  assert.ok(caption.startsWith("Hourly and as directed rates by vehicle class, with the cost of the three hour minimum."), caption);
});

check("rates.html: the add-ons facts and the footnote are exact", () => {
  const facts = Object.fromEntries([...rates.document.querySelectorAll("#add-ons dl.facts dt")].map((dt) => [squash(dt.textContent), squash(dt.nextElementSibling.textContent)]));
  for (const [dt, dd] of Object.entries(RATES_FACTS)) assert.equal(facts[dt], dd, dt);
  assert.deepEqual(Object.keys(facts), ["Meet and greet", "Gratuity", "Tolls and airport fees", "Taxes", "Free waiting at airports", "Other pickups", "Waiting beyond the free window", "Extra stops", "Child seats", "Cancellation"]);
  const note = squash(rates.document.querySelector("#add-ons dl.facts").nextElementSibling.textContent);
  assert.ok(note.startsWith(RATES_FOOTNOTE), note);
  assert.ok(note.endsWith("The fare for your trip comes back in writing before the day."), note);
});

check("rates.html: the cancellation paragraph is exact", () => {
  const ps = [...rates.document.querySelectorAll("#cancellation p")].map((x) => squash(x.textContent));
  assert.ok(ps.includes(RATES_CANCELLATION), ps.join(" | "));
});

check("rates.html: the rate questions are exact and equal in the page and in json-ld", () => {
  const node = rates.graph.find((n) => n["@type"] === "FAQPage");
  assert.deepEqual(node.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), RATES_FAQ);
  assert.deepEqual(RATES_FAQ.map(([q]) => [q, visibleAnswer(rates, q)]), RATES_FAQ);
});

check("rates.html: the OfferCatalog has an airport offer per class for JFK, Newark or Teterboro and for LaGuardia, tax included, then the hourly offers in class order and meet and greet", () => {
  const catalog = rates.graph.find((n) => n["@type"] === "OfferCatalog");
  const airport = catalog.itemListElement.filter((o) => o.name.startsWith("Airport transfer"));
  assert.deepEqual(airport.map((o) => [o.name, o.url]), RATES_AIRPORT_OFFERS.map(([name, id]) => [name, `https://www.nycluxride.com/rates#${id}`]));
  airport.forEach((o, i) => {
    const [, , price, iata] = RATES_AIRPORT_OFFERS[i];
    assert.equal(o.price, price, o.name);
    assert.equal(o.priceCurrency, "USD", o.name);
    assert.deepEqual(o.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", price, valueAddedTaxIncluded: true }, o.name);
    assert.deepEqual([].concat(o.areaServed).map((a) => [a["@type"], a.iataCode]), iata.map((c) => ["Airport", c]), o.name);
  });
  assert.deepEqual(catalog.itemListElement.slice(0, 10), airport);
  const hourly = catalog.itemListElement.slice(10);
  assert.deepEqual(hourly.map((o) => o.name), ["Hourly and as directed, Business SUV", "Hourly and as directed, Business Premium SUV", "Hourly and as directed, First Class", "Hourly and as directed, Sedan & Electric", "Hourly and as directed, Luxury Sprinter", "Meet and greet"]);
  assert.deepEqual(hourly.slice(0, 5).map((o) => { const s = o.priceSpecification; return [s.price, s.minPrice, s.maxPrice]; }), [[undefined, "95", "100"], ["105", undefined, undefined], ["175", undefined, undefined], ["85", undefined, undefined], [undefined, "175", undefined]]);
});

const listing = pages.get("blog.html");
const listed = new Map();
for (const s of listing.document.querySelectorAll('script[type="application/ld+json"]')) {
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (typeof v.url === "string" && v.url.includes("/blog/") && v.dateModified) listed.set(v.url, v.dateModified);
      Object.values(v).forEach(walk);
    }
  };
  walk(JSON.parse(s.textContent));
}

for (const file of FILES.filter((f) => f.startsWith("blog/"))) {
  check(`${file}: dateModified equals the blog.html entry and the visible updated date`, () => {
    const p = pages.get(file);
    const post = p.graph.find((n) => n.dateModified && [].concat(n["@type"]).some((t) => /Posting|Article/.test(t)));
    assert.ok(post, "no BlogPosting with dateModified");
    const url = `https://www.nycluxride.com/${file.replace(/\.html$/, "")}`;
    assert.equal(listed.get(url), post.dateModified, `blog.html lists ${listed.get(url)}`);
    const shown = p.document.querySelector(".note__date time:not(.note__date)") || [...p.document.querySelectorAll("main time")][1];
    assert.ok(shown, "no visible updated date");
    assert.equal(shown.getAttribute("datetime"), post.dateModified.slice(0, 10));
    if (post.dateModified.startsWith("2026-10-12")) assert.equal(squash(shown.textContent), "October 12, 2026");
  });
}

if (failures) {
  console.error(`\n${failures} content copy assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll content copy tests passed");
process.exit(0);
