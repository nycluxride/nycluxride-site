import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CHECKOUT as CHECKOUT_COPY, ERRORS } from "../api/_copy.mjs";

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
  "start and end outside New York City",
  "priced by distance and time, to or from any address in the five boroughs",
  "Other one-way trips to or from a New York City address",
  "A one-way trip to or from a New York City address is priced",
  "For long trips and other places",
  "free on request",
  "seats are free",
  "Child seats are free",
  "seat adds nothing",
  "free car seat",
  "free child seat",
  "in the booking notes",
  "Tell us which one you need",
  "charged per seat at booking",
  "price per seat is listed",
  "the price is listed with our add-ons",
  "Priced per seat",
  "the Black Car Fund and any sales tax",
  "card saved at booking",
  "dispatch team prices",
  "beyond the free window",
  "bag figure",
  "whichever is higher",
  "also on a round trip",
];

const A = {
  A1: "Airport rides to or from JFK, LaGuardia, Newark and Teterboro are one flat price by vehicle class from anywhere in New York City, with tolls, airport fees and taxes included.",
  A2: "A gratuity for your chauffeur is optional and chosen when you book.",
  A3: "After an airport transfer, only true extras are charged to the card saved at booking: waiting beyond the free window, extra stops and parking, each with an itemized receipt.",
  A4: "Hourly bookings are charged the hourly fare with NYC sales tax and the Black Car Fund at booking. Tolls and parking are charged after the ride to the card saved at booking, each with an itemized receipt.",
  A5: "Airport rides to or from New York City include tolls, airport fees and taxes, and the tip is up to you. On distance trips, tolls are added at booking, and parking, plus tolls on hourly trips, is charged after the ride.",
  A6: "Airport transfer prices for New York City addresses include tolls, airport fees and taxes, and the gratuity is optional.",
  A7: "Airport transfer prices for New York City addresses include tolls, airport fees and taxes. Hourly rates and rates by distance and time are before sales tax, the Black Car Fund, tolls and parking, and the gratuity is optional.",
  A8: "Flat airport rates from NYC LUX RIDE include tolls and airport fees, so the route does not change the price.",
  A9: "Chauffeured luxury black cars across New York City, with flat rates to JFK, LaGuardia, Newark and Teterboro.",
};

const PREFIX = {
  A1: "Airport rides to or from JFK, LaGuardia, Newark and Teterboro are one flat price",
  A2: "A gratuity for your chauffeur is optional and",
  A3: "After an airport transfer, only",
  A4: "Hourly bookings are charged the hourly fare",
  A5: "Airport rides to or from New York City include tolls, airport fees and taxes, and",
  A6: "Airport transfer prices for New York City addresses include tolls, airport fees and taxes, and",
  A7: "Airport transfer prices for New York City addresses include tolls, airport fees and taxes. ",
  A8: "Flat airport rates from NYC LUX RIDE include",
  A9: "Chauffeured luxury black cars across New York City",
};

const USED = {
  A1: ["black-car-service-brooklyn.html", "faq.html"],
  A2: ["blog/nyc-limo-service-comparison-guide-april-29.html"],
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
  A8: ["blog/best-black-car-service-brooklyn-queens-march-20.html"],
};

const FAQ_TOLLS = "Airport rides to or from New York City include tolls, airport fees and taxes. On distance trips, tolls are added at booking. Parking, and tolls on hourly trips, are charged to your card after the ride, with an itemized receipt. A gratuity is optional and chosen when you book.";
const TERMS_PAYMENTS = "Booking, pricing, invoicing and payments may be handled by third-party providers. Online bookings are paid on a Stripe payment page. The total shown at checkout is charged when you book. It includes the fare, taxes and fees, tolls and airport fees on airport rides to or from New York City, tolls on distance trips, and any stop fees, meet and greet, child seats, pets and gratuity you chose. Service animals ride free and are never charged as pets. Prices for each kind of trip are on our rates page. The card you pay with is saved for charges we only know after the ride, like extra waiting, stops added during the ride, parking and any tolls not in the price. Each charge comes with an itemized receipt.";
const FAQ_OUTSIDE = "Yes. Outside New York City, one-way trips anywhere in the United States are priced by distance and time when you book. Each stop adds a fee, or more if it takes the car out of the way. For very long trips or trips outside the United States, we'll send you a price.";

const RATES_TITLE = "NYC Car Service Rates: Airport Transfers from $145 | NYC LUX RIDE";
const RATES_DESCRIPTION = "Airport transfers to JFK, Newark and Teterboro from $170, LaGuardia from $145, with tolls, fees and taxes included. Hourly from $85, 3-hour minimum.";
const RATES_LEDE = "Airport transfers to or from anywhere in New York City are one flat price, with tolls, airport fees and taxes included. Hourly minimums start at 3 hours. There's no meter and no surge pricing.";
const RATES_HOURLY_CAPTION = "Taxes and fees are added at booking. Tolls and parking are charged after the ride.";
const RATES_FACTS = {
  "Meet and greet": "Inside the terminal with a name sign, $25 charged at booking, plus any airport parking charged after the ride",
  Gratuity: "Optional. Choose 10%, 15%, 20% or 25% of the fare, or your own amount, before you pay",
  "Tolls and airport fees": "Included on airport rides to or from New York City. On distance trips, tolls are added at booking. On hourly trips, they are charged to your card after the ride",
  Taxes: "Added at booking on hourly and distance trips. Airport prices already include them",
  "Extra stops": "$20 per stop, charged at booking, or more if the stop takes the car out of the way. A stop added during an airport ride is charged after the ride",
  "Child seats": "Child, infant and booster seats, $15 per seat, charged once at booking, even on a round trip",
  Pets: "$20 per small dog and $45 per large dog, charged once at booking, even on a round trip. Service animals ride free",
};
const RATES_FOOTNOTE = "All prices in USD. Hourly and distance prices are before tax, tolls and parking.";
const RATES_CANCELLATION = "You pay the total at checkout when you book. After the ride, we only charge the same card for extra waiting, stops added during the ride, parking, and tolls not in your price. Each charge comes with an itemized receipt.";
const RATES_FAQ = [
  ["How much is a car from Manhattan to JFK?", "$185 in a Business SUV from anywhere in New York City, with tolls, airport fees and taxes included. Executive Sedan is $170, Electric Class $180, Business Premium SUV $220, First Class $310 and Luxury Sprinter from $450. A gratuity is optional."],
  ["How much is a car to LaGuardia?", "$165 in a Business SUV from anywhere in New York City, with tolls, airport fees and taxes included. Executive Sedan is $145, Electric Class $155, Business Premium SUV $190, First Class $250 and Luxury Sprinter from $450."],
  ["What is the shortest hourly booking?", "Three hours, or four in a Sprinter. For an Executive Sedan that's $255 plus taxes and fees, with tolls and parking after the ride."],
  ["When is my fare confirmed?", "We confirm your car, class and fare in writing before the day of your ride."],
];
const RATES_CLASSES = [
  ["airport-suv", "Business SUV", "Chevrolet Suburban or similar, GMC Denali, Lincoln Navigator", "185", "165"],
  ["airport-premium", "Business Premium SUV", "Cadillac Escalade ESV", "220", "190"],
  ["airport-first", "First Class", "Mercedes-Benz S-Class, BMW 7 Series", "310", "250"],
  ["airport-sedan", "Executive Sedan", "Mercedes-Benz E-Class or similar", "170", "145"],
  ["airport-electric", "Electric Class", "Cadillac Lyriq or similar", "180", "155"],
  ["airport-sprinter", "Luxury Sprinter", "Five kinds of Sprinter, lowest prices shown", "450 to $475", "450"],
];
const RATES_AIRPORT_OFFERS = RATES_CLASSES.filter(([id]) => id !== "airport-sprinter").flatMap(([id, name, , far, lga]) => [
  [`Airport transfer, JFK, Newark or Teterboro, ${name}`, id, far, ["JFK", "EWR", "TEB"]],
  [`Airport transfer, LaGuardia, ${name}`, id, lga, ["LGA"]],
]);
const RATES_SPRINTER_OFFERS = [
  ["Executive Sprinter", "450", "475", ["JFK", "EWR", "TEB", "LGA"]],
  ["Luxury Jet Sprinter", "550", "595", ["JFK", "EWR", "TEB", "LGA"]],
  ["Presidential Sprinter", "625", "675", ["JFK", "EWR", "TEB", "LGA"]],
  ["Limo Sprinter", "675", "725", ["JFK", "EWR", "TEB", "LGA"]],
  ["White Luxury Limo Sprinter", "750", "775", ["JFK", "EWR", "TEB"]],
];

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

  check(`${file}: no NYC sales tax or Black Car Fund percentage in text, attributes or json-ld`, () => {
    const tax = /\b(?:8\.875|2\.25)\s*(?:%|percent)|(?:sales tax|Black Car Fund)\s*\(\s*\d/i;
    const hits = [p.title, p.text, ...p.attrs.map(([, v]) => v), ...p.strings].filter((v) => tax.test(v)).map((v) => v.slice(Math.max(0, v.search(tax) - 40), v.search(tax) + 40));
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

check("faq.html: the tolls and gratuity answer is exact, visible and in json-ld, with tolls included only on airport transfers to or from a New York City address", () => {
  const p = pages.get("faq.html");
  const question = "Are tolls and gratuity included in the rate?";
  assert.equal(visibleAnswer(p, question), FAQ_TOLLS);
  assert.equal(faqAnswer(p, question), FAQ_TOLLS);
});

check("faq.html: the outside New York City answer prices one-way trips anywhere in the United States by distance and time, airport trips to an address outside the city at no less than the airport fare, each stop at the stop fee or more, and sends a price for very long trips and trips outside the United States, exact, visible and in json-ld", () => {
  const p = pages.get("faq.html");
  const question = "Do you drive outside New York City?";
  assert.equal(visibleAnswer(p, question), FAQ_OUTSIDE);
  assert.equal(faqAnswer(p, question), FAQ_OUTSIDE);
  assert.doesNotMatch(FAQ_OUTSIDE, /\$/);
  assert.deepEqual([...p.document.querySelectorAll("#q-outside-city a")].map((a) => [a.getAttribute("href"), squash(a.textContent)]), [["/rates#distance", "priced by distance and time"]]);
});

check("faq.html: the pets answer is exact, visible and in json-ld, right after the family answer, says the dog is chosen under Pets, charged once even on a round trip at the price on the rates page, and that service animals ride free, links the pet page, with no price of its own on the page", () => {
  const p = pages.get("faq.html");
  const question = "Can I bring my dog?";
  const want = "Yes. Choose a small or large dog under Pets when you book and tell us about your dog in the notes. Each dog is charged once, even on a round trip, at the price on our rates page. Our page on pet friendly car service covers airports and long trips with a dog. Service animals ride free.";
  assert.equal(visibleAnswer(p, question), want);
  assert.equal(faqAnswer(p, question), want);
  const q = p.document.getElementById("q-pets");
  assert.ok(q && q.matches("details.acc") && q.previousElementSibling.id === "q-family-car" && q.nextElementSibling.id === "q-wifi");
  assert.equal(q.querySelector('a[href="/rates#add-ons"]').textContent, "rates page");
  assert.equal(q.querySelector('a[href="/pet-friendly-car-service-nyc"]').textContent, "pet friendly car service");
  const faq = p.graph.find((n) => n["@type"] === "FAQPage").mainEntity.map((x) => x.name);
  assert.equal(faq[faq.indexOf("Which car fits a family of 6 or more?") + 1], question);
  assert.doesNotMatch(want, /[\u2013\u2014;$]/);
});

check("the pets copy is plain: no em dash, en dash or semicolon in the booking form group, its error, the rates fact, the FAQ answer, the terms list, the reserve hint or the Checkout texts", () => {
  const book = pages.get("book.html").document;
  const texts = [book.getElementById("bk-pets").textContent, ERRORS.dogs.text, RATES_FACTS.Pets, TERMS_PAYMENTS, RATES_CANCELLATION, ...Object.values(CHECKOUT_COPY)];
  for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014;]/, text);
  assert.ok(TERMS_PAYMENTS.includes("meet and greet, child seats, pets and gratuity you chose"));
  assert.ok(TERMS_PAYMENTS.includes("you chose. Service animals ride free and are never charged as pets. Prices"));
  assert.ok(RATES_FACTS.Pets.includes("Service animals ride free"), RATES_FACTS.Pets);
});

check("services.html: the Rates list names the three bookable extras, with pets and no pet price, schedule.html asks for pets in the notes, and the FAQ pets keywords do not promise emotional support animals ride free", () => {
  const items = [...pages.get("services.html").document.querySelectorAll("#rates ul.assure li")].map((li) => [li.querySelector("use").getAttribute("href"), squash(li.querySelector("b").textContent), squash(li.querySelector("span").textContent)]);
  assert.deepEqual(items, [
    ["#i-plane-arrive", "Meet and greet", "Your chauffeur waits inside the terminal with a name sign, for an extra charge, plus any airport parking"],
    ["#i-shield", "Child seats", "Child, infant and booster seats, $15 per seat, charged at booking."],
    ["#i-check", "Pets", "Small and large dogs, for an extra charge per booking. Service animals ride free"],
  ]);
  assert.equal(squash(pages.get("schedule.html").document.getElementById("s-notes-hint").textContent), "The seat you'd like and each child's age, weight and height for child seats, pets, extra stops, a car waiting between meetings, or anything your chauffeur should know.");
  assert.equal(pages.get("faq.html").document.getElementById("q-pets").getAttribute("data-k"), "pet pets puppy animal service guide");
});

check("faq.html: the family answer gives the Luxury Sprinter its 14 seats and flat airport rate, and the 4-hour minimum by the hour, exact, visible and in json-ld", () => {
  const p = pages.get("faq.html");
  const question = "Which car fits a family of 6 or more?";
  const want = "Book a Luxury Sprinter. It seats up to 14 and has a flat airport rate. By the hour, a Sprinter has a 4-hour minimum.";
  assert.equal(visibleAnswer(p, question), want);
  assert.equal(faqAnswer(p, question), want);
});

check("about.html: What we do says other one-way trips anywhere in the United States are priced by distance and time, linked to the distance rates", () => {
  const p = pages.get("about.html");
  const para = [...p.document.querySelectorAll("main p")].find((x) => squash(x.textContent).startsWith("Airport rides have a flat price from anywhere in New York City"));
  assert.ok(para, "no What we do paragraph");
  assert.ok(squash(para.textContent).endsWith("with a 3-hour minimum, or 4 hours in a Sprinter. Other one-way trips anywhere in the United States are priced by distance and time."), squash(para.textContent));
  assert.deepEqual([...para.querySelectorAll('a[href="/rates#distance"]')].map((a) => squash(a.textContent)), ["priced by distance and time"]);
});

check("faq.html: the airport rates answer names every airport and every class, visible and in json-ld", () => {
  const p = pages.get("faq.html");
  const question = "What are the airport rates?";
  const want = `${A.A1} All our rates are on the rates page.`;
  assert.equal(visibleAnswer(p, question), want);
  assert.equal(faqAnswer(p, question), want);
});

check("terms-of-service.html: the #payments section is exact and dated, with tolls at booking only on airport transfers to or from a New York City address and airport transfers to or from an address outside New York City priced by distance and time at no less than the airport fare", () => {
  const p = pages.get("terms-of-service.html");
  const h = p.document.getElementById("payments");
  assert.ok(h, "no #payments");
  const parts = [];
  for (let n = h.nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) parts.push(squash(n.textContent));
  const text = parts.join(" ");
  assert.ok(text.includes(TERMS_PAYMENTS), text);
  const page = p.graph.find((n) => n["@type"] === "WebPage");
  assert.equal(page.dateModified, "2026-11-21");
  assert.ok(p.text.includes("Last Updated: November 21, 2026"));
  assert.ok(!p.text.includes("November 17, 2026"));
  assert.ok(!p.text.includes("October 30, 2026"));
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
  assert.ok(RATES_LEDE.split(/\s+/).length <= 35, "the rates lede stays short");
});

check("rates.html: the airport table rows, columns and footer are exact", () => {
  const table = rates.document.getElementById("jfk").closest("table");
  assert.equal(table.id, "airport-rates");
  assert.equal(squash(table.querySelector("caption").textContent), "One way airport transfers to or from any New York City address, by vehicle class.");
  assert.deepEqual([...table.querySelectorAll("thead th")].map((th) => squash(th.textContent)), ["Class and vehicles", "JFK, Newark and Teterboro", "LaGuardia"]);
  const firstText = (el) => [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim())?.nodeValue;
  const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [tr.id, squash(tr.querySelector("th").firstChild.textContent), squash(tr.querySelector("th small").textContent), ...[...tr.querySelectorAll("td")].map((td) => squash(firstText(td)))]);
  assert.deepEqual(rows, RATES_CLASSES.map(([id, name, vehicles, far, lga]) => [id, name, vehicles, `$${far}`, `$${lga}`]));
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map((td) => squash(td.textContent)), ["One-way totals in either direction, with tolls, airport fees and taxes included."]);
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
  assert.deepEqual([...table.querySelectorAll("thead th")].map((th) => squash(th.textContent)), ["Item", "JFK", "Newark and Teterboro"]);
  const rows = [...table.querySelectorAll("tr")].filter((tr) => tr.querySelector("th[scope=row]")).map((tr) => [squash(tr.querySelector("th").textContent), ...[...tr.querySelectorAll("td")].map((td) => squash(td.textContent))]);
  assert.deepEqual(rows, [["Fare", "$155.00", "$168.46"], ["NYC sales tax", "$13.76", "$0.00"], ["Black Car Fund", "$3.49", "$3.79"], ["Tolls and airport fees", "$12.75", "$12.75"], ["Total", "$185.00", "$185.00"]]);
  assert.equal(squash(table.querySelector("tfoot td[colspan]").textContent), "Every class includes $12.75 for tolls and airport fees. Cars and SUVs cost the same to JFK, Newark and Teterboro. Any meet and greet, child seats, pets and gratuity are added when you book.");
});

check("rates.html: the hourly caption adds the taxes and fees and after the ride sentences, rates unchanged", () => {
  const caption = squash(rates.document.getElementById("hourly-caption").textContent);
  assert.ok(caption.endsWith(RATES_HOURLY_CAPTION), caption);
  assert.ok(caption.startsWith("Hourly rates by vehicle class, with the cost of the 3-hour minimum."), caption);
});

check("rates.html: the add-ons facts and the footnote are exact", () => {
  const facts = Object.fromEntries([...rates.document.querySelectorAll("#add-ons dl.facts dt")].map((dt) => [squash(dt.textContent), squash(dt.nextElementSibling.textContent)]));
  for (const [dt, dd] of Object.entries(RATES_FACTS)) assert.equal(facts[dt], dd, dt);
  assert.deepEqual(Object.keys(facts), ["Meet and greet", "Gratuity", "Tolls and airport fees", "Taxes", "Free waiting at airports", "Other pickups", "Extra waiting", "Extra stops", "Child seats", "Pets", "Cancellation"]);
  const note = squash(rates.document.querySelector("#add-ons dl.facts").nextElementSibling.textContent);
  assert.equal(note, RATES_FOOTNOTE);
});

check("rates.html: the paragraph on charges after the ride is exact and closes the waiting part of the policies", () => {
  const ps = [...rates.document.querySelectorAll("#waiting > p")].map((x) => squash(x.textContent));
  assert.equal(ps.at(-1), RATES_CANCELLATION);
  assert.ok(ps.includes(RATES_CANCELLATION), ps.join(" | "));
});

check("rates.html: the Extra waiting and Cancellation facts link to their policies, with no written-terms wording left", () => {
  const facts = Object.fromEntries([...rates.document.querySelectorAll("#add-ons dl.facts dt")].map((dt) => [squash(dt.textContent), dt.nextElementSibling]));
  assert.equal(squash(facts["Extra waiting"].textContent), "$1.20 to $4.00 a minute after the free waiting, by vehicle class");
  assert.equal(facts["Extra waiting"].querySelector("a").getAttribute("href"), "#waiting");
  assert.equal(squash(facts.Cancellation.textContent), "Free cancellation up to 24 hours before pickup");
  assert.equal(facts.Cancellation.querySelector("a").getAttribute("href"), "#cancellation");
  assert.doesNotMatch(squash(rates.document.querySelector("main").textContent), /in writing with the reservation|written confirmation includes/);
});

check("rates.html: the rate questions are exact and equal in the page and in json-ld", () => {
  const node = rates.graph.find((n) => n["@type"] === "FAQPage");
  assert.deepEqual(node.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), RATES_FAQ);
  assert.deepEqual(RATES_FAQ.map(([q]) => [q, visibleAnswer(rates, q)]), RATES_FAQ);
});

check("rates.html: the OfferCatalog has an airport offer per car class for JFK, Newark or Teterboro and for LaGuardia and one per Sprinter with its lowest and highest total, tax included, then the hourly offers in class order, meet and greet and the child seat at its price per seat", () => {
  const catalog = rates.graph.find((n) => n["@type"] === "OfferCatalog");
  const airport = catalog.itemListElement.filter((o) => o.name.startsWith("Airport transfer"));
  assert.deepEqual(airport.map((o) => [o.name, o.url]), [...RATES_AIRPORT_OFFERS.map(([name, id]) => [name, `https://www.nycluxride.com/rates#${id}`]), ...RATES_SPRINTER_OFFERS.map(([name]) => [`Airport transfer, ${name}`, "https://www.nycluxride.com/rates#sprinter-airport"])]);
  airport.slice(RATES_AIRPORT_OFFERS.length).forEach((o, i) => {
    const [, min, max, iata] = RATES_SPRINTER_OFFERS[i];
    assert.deepEqual([o.price, o.priceCurrency], [undefined, "USD"], o.name);
    assert.deepEqual(o.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: min, maxPrice: max, valueAddedTaxIncluded: true }, o.name);
    assert.deepEqual([].concat(o.areaServed).map((a) => [a["@type"], a.iataCode]), iata.map((c) => ["Airport", c]), o.name);
  });
  airport.slice(0, RATES_AIRPORT_OFFERS.length).forEach((o, i) => {
    const [, , price, iata] = RATES_AIRPORT_OFFERS[i];
    assert.equal(o.price, price, o.name);
    assert.equal(o.priceCurrency, "USD", o.name);
    assert.deepEqual(o.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", price, valueAddedTaxIncluded: true }, o.name);
    assert.deepEqual([].concat(o.areaServed).map((a) => [a["@type"], a.iataCode]), iata.map((c) => ["Airport", c]), o.name);
  });
  assert.deepEqual(catalog.itemListElement.slice(0, 15), airport);
  const hourly = catalog.itemListElement.slice(15);
  assert.deepEqual(hourly.map((o) => o.name), ["Hourly and as directed, Business SUV", "Hourly and as directed, Business Premium SUV", "Hourly and as directed, First Class", "Hourly and as directed, Executive Sedan", "Hourly and as directed, Electric Class", "Hourly and as directed, Luxury Sprinter", "Meet and greet", "Child seat", "Small dog", "Large dog"]);
  assert.deepEqual(hourly.at(-3), { "@type": "Offer", name: "Child seat", description: "Child, infant or booster seat, charged once per booking", url: "https://www.nycluxride.com/rates#add-ons", priceCurrency: "USD", price: "15", priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", price: "15", valueAddedTaxIncluded: false } });
  assert.deepEqual(Object.keys(hourly.at(-2)), Object.keys(hourly.at(-1)));
  const dog = (name, price) => ({ "@type": "Offer", name, description: "Charged once per booking. Service animals ride free", url: "https://www.nycluxride.com/rates#add-ons", priceCurrency: "USD", price, priceSpecification: { "@type": "PriceSpecification", priceCurrency: "USD", price, valueAddedTaxIncluded: false } });
  assert.deepEqual(hourly.slice(-2), [dog("Small dog", "20"), dog("Large dog", "45")]);
  assert.deepEqual(hourly.slice(0, 6).map((o) => { const s = o.priceSpecification; return [s.price, s.minPrice, s.maxPrice]; }), [[undefined, "95", "100"], ["105", undefined, undefined], ["175", undefined, undefined], ["85", undefined, undefined], ["90", undefined, undefined], [undefined, "175", "275"]]);
  assert.deepEqual(hourly[3].priceSpecification.eligibleQuantity, hourly[4].priceSpecification.eligibleQuantity);
  assert.deepEqual(hourly[4].url, "https://www.nycluxride.com/rates#electric-class");
  assert.deepEqual(hourly[5].priceSpecification.eligibleQuantity, { "@type": "QuantitativeValue", minValue: 4, unitCode: "HUR" });
});

const { MIN_NOTICE_MINUTES } = await import(join(ROOT, "api/_rates.mjs"));
const COPY = await import(join(ROOT, "api/_copy.mjs"));
const NOTICE = {
  N1: `Book online at least ${MIN_NOTICE_MINUTES} minutes before pickup.`,
  N2: `For a pickup within the next ${MIN_NOTICE_MINUTES} minutes, email or WhatsApp us.`,
  N3: `Online at least ${MIN_NOTICE_MINUTES} minutes before pickup. Sooner by email or WhatsApp when a car is free.`,
  N4: `For a pickup within the next ${MIN_NOTICE_MINUTES} minutes, email info@nycluxride.com or message us on WhatsApp.`,
  N5: `For a pickup within the next ${MIN_NOTICE_MINUTES} minutes, message us on WhatsApp.`,
  N6: `Send the trip at least ${MIN_NOTICE_MINUTES} minutes before pickup. For a pickup within the next ${MIN_NOTICE_MINUTES} minutes, message us on WhatsApp.`,
  N7: `For a pickup before the markets open, book online at least ${MIN_NOTICE_MINUTES} minutes ahead.`,
  N8: `Send us the trip at least ${MIN_NOTICE_MINUTES} minutes before pickup.`,
};
const NOTICE_USED = {
  N1: ["about.html", "chauffeur-service-nyc.html", "corporate-car-service-nyc.html", "faq.html", "index.html", "locations/manhattan.html", "locations/brooklyn.html", "locations/bronx.html", "locations/staten-island.html", "blog/corporate-black-car-nyc-april-3.html"],
  N2: ["about.html", "chauffeur-service-nyc.html", "index.html", "locations/manhattan.html", "locations/staten-island.html"],
  N3: ["contact.html", "schedule.html", "limousine-service-nyc.html", "chauffeur-service-nyc.html", "black-car-service-brooklyn.html", "locations/jfk-airport.html", "locations/queens.html"],
  N4: ["book.html", "index.html", "faq.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html"],
  N5: ["corporate-car-service-nyc.html"],
  N6: ["schedule.html"],
  N7: ["locations/financial-district.html"],
  N8: ["limousine-service-nyc.html"],
};
const OLD_NOTICE = [/\b(at least|within|less than|under)( the next)? (an?|one|1)[ -]hours?\b/i, /\bnext hour\b/i, /\b(an?|one|1)[ -]hours? (before|ahead of) (the |your )?pickup\b/i, /\b(an?|one|1)[ -]hours? away\b/i];
const HOUR_ELSEWHERE = [
  "A message an hour ahead gives us time to keep the car for you.",
  "If your day might run long, message us an hour ahead so we can keep the car for you.",
  "If your day might run late, tell us an hour ahead and we'll try to keep the car longer.",
  "If you'll spend an hour or more at one address, keeping the car by the hour usually costs less than two one-way bookings.",
  "An hour in the park with the photographer, and the Sprinter comes back to the same gate at the end.",
];
const HOUR = /\b(an?|one|1)[ -]hours?\b(?!-)/gi;
const hourHits = (value) => {
  let rest = String(value);
  for (const s of HOUR_ELSEWHERE) rest = rest.split(s).join(" ");
  return [...rest.matchAll(HOUR)].map((m) => rest.slice(Math.max(0, m.index - 50), m.index + 40));
};
const copyStrings = [];
const walkCopy = (v) => (Array.isArray(v) ? v.forEach(walkCopy) : v && typeof v === "object" ? Object.values(v).forEach(walkCopy) : typeof v === "string" && copyStrings.push(v));
walkCopy({ ...COPY });

check(`the online cutoff is MIN_NOTICE_MINUTES, ${MIN_NOTICE_MINUTES} minutes (owner change 1), and api/_copy.mjs has no hour notice wording`, () => {
  assert.equal(MIN_NOTICE_MINUTES, 90);
  assert.equal(COPY.REASONS["short-notice"].text, NOTICE.N4);
  assert.deepEqual(copyStrings.filter((v) => OLD_NOTICE.some((re) => re.test(v))), []);
  assert.deepEqual(copyStrings.flatMap(hourHits), []);
});

for (const [file, p] of pages) {
  check(`${file}: no "1 hour" or "within the next hour" notice wording in text, attributes or json-ld, and an hour appears only about extending an hourly booking, waiting at one address or a wedding photo stop`, () => {
    const all = [p.title, p.text, ...p.attrs.map(([, v]) => v), ...p.strings];
    assert.deepEqual(all.filter((v) => OLD_NOTICE.some((re) => re.test(v))).map((v) => v.slice(0, 160)), []);
    assert.deepEqual(all.flatMap(hourHits), []);
  });
  check(`${file}: every online notice sentence says ${MIN_NOTICE_MINUTES} minutes and is an approved form`, () => {
    const notice = /\b(at least|within the next) (\d+) (minutes|hours?)\b(?= before pickup| ahead|,)/g;
    for (const v of [p.text, ...p.strings]) for (const m of v.matchAll(notice)) assert.equal(Number(m[2]), MIN_NOTICE_MINUTES, v.slice(Math.max(0, m.index - 60), m.index + 60));
    const forms = Object.values(NOTICE);
    for (const b of p.blocks.filter((x) => /at least \d+ minutes (before pickup|ahead)|within the next \d+ minutes/.test(x))) assert.ok(forms.some((f) => b.includes(f)) || b.includes(NOTICE.N1.replace(" before pickup.", "")), b.slice(0, 200));
  });
}

for (const [id, files] of Object.entries(NOTICE_USED)) {
  for (const file of files) {
    check(`${file}: carries the ${MIN_NOTICE_MINUTES} minute notice sentence ${id}`, () => {
      const p = pages.get(file);
      assert.ok(p, `${file} is missing`);
      assert.ok(p.blocks.some((b) => b.includes(NOTICE[id])), `${id} not found`);
    });
  }
}

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
    const once = post.datePublished === post.dateModified ? p.document.querySelector("main time.note__date[datetime]") : null;
    const shown = p.document.querySelector(".note__date time:not(.note__date)") || once || [...p.document.querySelectorAll("main time")][1];
    assert.ok(shown, "no visible updated date");
    assert.equal(shown.getAttribute("datetime"), post.dateModified.slice(0, 10));
    if (post.dateModified.startsWith("2026-10-12")) assert.equal(squash(shown.textContent), "October 12, 2026");
  });
}

check("rates.html: the policies section has the waiting, cancellation, no-show and changes parts in order, each POLICY text word for word", () => {
  const parts = [...rates.document.querySelectorAll("#policies section")].map((x) => [x.id, squash(x.querySelector("h3").textContent)]);
  assert.deepEqual(parts, [["waiting", "Waiting"], ["cancellation", "Cancellation"], ["no-show", "No-shows"], ["changes", "Changes and special bookings"]]);
  assert.equal(squash(rates.document.querySelector("#cancellation > p").textContent), COPY.POLICY.howTo);
  assert.equal(squash(rates.document.querySelector("#no-show > p").textContent), COPY.POLICY.noShow);
  assert.equal(squash(rates.document.querySelector("#changes > p").textContent), COPY.POLICY.changes);
  assert.equal(squash(rates.document.querySelector("h1").textContent), "Car service rates and policies in New York City");
  assert.deepEqual([...rates.document.querySelectorAll(".jumps a")].map((a) => [a.getAttribute("href"), squash(a.textContent)]).at(-1), ["#policies", "Policies"]);
});

const SAME_AS_JFK = /same as JFK|JFK, Newark and Teterboro cost the same|cost the same to JFK|is the same for both/i;
const CAR_OR_SUV = /\bcars? (?:and|or) SUVs?\b/i;
check("every page that says Newark or Teterboro costs the same as JFK limits it to cars and SUVs, since every Sprinter costs more to Newark and Teterboro", () => {
  const wrong = [];
  let seen = 0;
  for (const [file, p] of pages) {
    for (const block of p.blocks) {
      for (const t of block.split(/(?<=[.!])\s+/)) {
        if (t.endsWith("?") || !SAME_AS_JFK.test(t)) continue;
        seen++;
        if (!CAR_OR_SUV.test(block)) wrong.push(`${file}: ${t}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(seen >= 12, String(seen));
});

check("the Newark, Teterboro, Staten Island, Midtown, private jet, services, locations and Brooklyn pages give the car and SUV price rule in plain sentences, in the page and in json-ld", () => {
  const SAID = [
    ["locations/newark-airport.html", "Yes, for our cars and SUVs. JFK, Newark and Teterboro cost the same from anywhere in New York City, and LaGuardia costs less. A Sprinter costs a little more to Newark. Tolls, airport fees and any taxes are included. See all rates.", true],
    ["locations/teterboro-airport.html", "Yes. A trip between Teterboro and any address in the five boroughs is one flat price by class, with tolls, airport fees and taxes included. It's the same price as Newark. In a car or SUV, it's also the same as JFK. See all rates.", true],
    ["locations/staten-island.html", "Yes, from almost the whole island. Newark Liberty is over the Goethals Bridge and down the Turnpike. JFK means crossing the Verrazzano-Narrows Bridge and most of Brooklyn. In a car or SUV, the flat rate is the same for both, and LaGuardia costs less. Choose the airport that suits your flight. LaGuardia uses the same Verrazzano crossing as JFK.", true],
    ["locations/midtown-manhattan.html", "Yes. Teterboro has one total by class from any Midtown address, the same as Newark. In a car or SUV, it's also the same as JFK. It is about 12 miles away through the Lincoln Tunnel.", true],
    ["locations/staten-island.html", "Airport prices stay the same in any traffic. In a car or SUV, JFK, Newark and Teterboro cost the same, and LaGuardia costs less. Tolls are included. On distance trips, bridge tolls are added at booking. On hourly trips, they are charged after the ride.", false],
    ["private-jet-car-service-nyc.html", "Teterboro has a flat rate. A ride between any of its FBOs and an address in the five boroughs costs the same as Newark for the class you choose. In a car or SUV, it's also the same as JFK. See the Teterboro rates. For Westchester, Morristown, Republic, MacArthur and Stewart, we'll send you a price.", false],
    ["services.html", "In a car or SUV, Teterboro has the same flat rate as JFK from any city address. For the other airfields, we'll send you a price. Our private jet car service page lists the FBOs at each one.", false],
    ["locations.html", "JFK is in Jamaica, Queens. LaGuardia is in East Elmhurst, the closest commercial airport to Manhattan. Newark Liberty and Teterboro are in New Jersey. In a car or SUV, they have the same flat rate as JFK from any city address.", false],
    ["black-car-service-brooklyn.html", "Newark and Teterboro mean crossing Manhattan or Staten Island first. In a car or SUV, they cost the same as JFK, even though they're farther.", false],
    ["blog/teterboro-airport-fbos-manhattan-november-19.html", "The price doesn't change with traffic. One total by class from any New York City address, with tolls, airport fees and taxes included. The Teterboro rates are the same as Newark for each class, and the same as JFK in a car or SUV.", false],
  ];
  for (const [file, text, ld] of SAID) {
    const p = pages.get(file);
    assert.ok([...p.document.querySelectorAll("main p")].some((n) => squash(n.textContent) === text), `${file}: ${text}`);
    if (ld) assert.ok(p.strings.includes(text), `${file} json-ld: ${text}`);
  }
});

const wordCount = (s) => squash(s).split(" ").filter(Boolean).length;
const after = (doc, id, n) => {
  let el = doc.getElementById(id);
  for (let i = 0; i < n; i++) el = el.nextElementSibling;
  return el.textContent;
};
const startsWith = (file, start) => [...pages.get(file).document.querySelectorAll("main p")].map((p) => p.textContent).find((t) => squash(t).startsWith(start)) || "";
const CAPS = [
  ["faq.html: Do you drive outside New York City?", visibleAnswer(pages.get("faq.html"), "Do you drive outside New York City?"), 70],
  ["faq.html: Are tolls and gratuity included in the rate?", visibleAnswer(pages.get("faq.html"), "Are tolls and gratuity included in the rate?"), 50],
  ["faq.html: Where will I meet my chauffeur at JFK?", visibleAnswer(pages.get("faq.html"), "Where will I meet my chauffeur at JFK?"), 75],
  ["terms-of-service.html: #payments first paragraph", after(pages.get("terms-of-service.html").document, "payments", 1), 90],
  ["terms-of-service.html: #payments second paragraph", after(pages.get("terms-of-service.html").document, "payments", 2), 50],
  ["privacy-policy.html: section 2 first paragraph", after(pages.get("privacy-policy.html").document, "information-we-collect", 1), 140],
  ["privacy-policy.html: section 3 second paragraph", after(pages.get("privacy-policy.html").document, "how-we-collect", 2), 140],
  ["rates.html: #airport-total footer", rates.document.querySelector("#airport-total tfoot td[colspan]").textContent, 40],
  ["rates.html: add-ons footnote", rates.document.querySelector("#add-ons dl.facts").nextElementSibling.textContent, 15],
  ...[...rates.document.querySelectorAll("#add-ons dl.facts dd")].map((dd) => [`rates.html: add-on ${squash(dd.previousElementSibling.textContent)}`, dd.textContent, 30]),
  ...[...rates.document.querySelectorAll("#policies p")].map((p, i) => [`rates.html: #policies paragraph ${i + 1}`, p.textContent, 45]),
  ["about.html: What the price covers, seats and billing", startsWith("about.html", "Child, infant and booster seats are"), 60],
  ["blog/chauffeur-service-nyc-booking-guide-april-30.html: our answers paragraph", startsWith("blog/chauffeur-service-nyc-booking-guide-april-30.html", "Airport rides to or from New York City have one flat price by class"), 85],
  ["blog/corporate-black-car-nyc-april-3.html: published rates paragraph", startsWith("blog/corporate-black-car-nyc-april-3.html", "Check our written confirmation"), 70],
  ...Object.entries(COPY.REASONS).map(([k, r]) => [`REASONS.${k}`, r.text, 30]),
  ...["submit", "submitHourly", "submitDistance", "submitOutside", "submitReturnFlat", "submitOutFlat"].map((k) => [`CHECKOUT.${k}`, COPY.CHECKOUT[k], 35]),
  ["CHECKOUT.terms", COPY.CHECKOUT.terms, 40],
  ["POLICY.cancel", COPY.POLICY.cancel, 30],
  ["POLICY.waiting", COPY.POLICY.waiting, 40],
  ["POLICY.noShow", COPY.POLICY.noShow, 45],
  ["POLICY.changes", COPY.POLICY.changes, 35],
  ["POLICY.howTo", COPY.POLICY.howTo, 20],
  ["SEATS.line", COPY.SEATS.line, 20],
  ["SEATS.mail", COPY.SEATS.mail, 30],
  ...Object.entries(COPY.POLICY.later).map(([k, v]) => [`POLICY.later.${k}`, v, 20]),
];
check("the owner's seat names: no page, meta, json-ld or site copy offers a toddler seat, the seats read child, infant and booster in that order, and the car seat page says which seat is which", () => {
  const toddler = /\btoddler\b/i;
  const hits = [...pages].flatMap(([file, p]) => [p.text, p.title, ...p.copy.map(([, v]) => v), ...p.strings].filter((v) => toddler.test(v)).map((v) => `${file}: ${v.slice(Math.max(0, v.search(toddler) - 40), v.search(toddler) + 40)}`));
  assert.deepEqual(hits, []);
  const values = (v) => (v && typeof v === "object" ? Object.values(v).flatMap(values) : [String(v)]);
  assert.deepEqual(values([COPY.LABELS, COPY.MAIL, COPY.SEATS, COPY.ERRORS, COPY.CHECKOUT, COPY.MESSAGE]).filter((v) => toddler.test(v)), [], "api/_copy.mjs names a toddler seat");
  assert.deepEqual(Object.values(COPY.LABELS.seatTypes), ["Child seats", "Infant seats", "Booster seats"]);
  const order = [...pages].flatMap(([file, p]) => p.blocks.filter((b) => /\b(infant|child), (infant|child)(,| and| or) booster seats?\b/i.test(b) && !/\bchild, infant (and|or) booster seats?\b/i.test(b)).map((b) => `${file}: ${b.slice(0, 120)}`));
  assert.deepEqual(order, []);
  const seatPage = pages.get("car-service-with-car-seat-nyc.html").blocks;
  assert.ok(seatPage.includes("When you book, choose an infant seat for a baby, a child seat for a young child or a booster seat for an older child. The infant seat faces the rear and the child seat faces forward or rear. Both are the Nuna RAVA or the Safety 1st Grow and Go. The booster seat is the backless booster. Tell us which seat you'd like. We check it suits each child's age, weight and height."));
});

check("the owner's bag sizes: the booking forms ask Large suitcase, Medium suitcase and Small suitcase or hand carry in that order, and the bags error and the privacy policy name the medium size", () => {
  for (const [file, p] of pages) {
    const labels = [...p.document.querySelectorAll("#bk-bags label")].map((l) => squash(l.textContent));
    if (labels.length) assert.deepEqual(labels, ["Large suitcase", "Medium suitcase", "Small suitcase or hand carry"], file);
  }
  assert.equal([...pages.values()].filter((p) => p.document.getElementById("bk-bags")).length, 6);
  assert.equal(ERRORS.bags.text, "Choose up to 14 suitcases of each size. For more bags, tell us in the notes.");
  assert.ok(pages.get("privacy-policy.html").text.includes("the number of passengers and large, medium and small suitcases"));
});

check("the longest rewritten customer blocks stay under their word caps, like the 90 word cap on the rates distance prose", () => {
  for (const [name, text] of CAPS) assert.ok(wordCount(text) > 0, `${name} is empty`);
  assert.deepEqual(CAPS.filter(([, text, cap]) => wordCount(text) > cap).map(([name, text, cap]) => `${name}: ${wordCount(text)} words, cap ${cap}`), []);
});

if (failures) {
  console.error(`\n${failures} content copy assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll content copy tests passed");
process.exit(0);
