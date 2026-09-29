import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  CLASSES,
  VEHICLES,
  AIRPORT_FARES,
  AIRPORT_TOTALS,
  AIRPORT_PLACES,
  NYC_TAX_PERCENT,
  BCF_PERCENT,
  TIP_PERCENTS,
  percentCents,
  MEET_AND_GREET,
  HOURS,
  MIN_NOTICE_HOURS,
  MAX_ADVANCE_DAYS,
  ADDRESS_PLACES,
  CONSENT_TERMS_LIVE,
} from "../api/_rates.mjs";
import * as copy from "../api/_copy.mjs";
import * as trip from "../api/_trip.mjs";

const { REASONS, CHECKOUT } = copy;
const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const CLASS_KEYS = Object.keys(CLASSES);

const load = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
const squash = (node) => node.textContent.replace(/\s+/g, " ").trim();
const cents = (text) => [...text.matchAll(/\$\s*(\d[\d,]*(?:\.\d\d)?)/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100));
const own = (node) => [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim();

const page = load("rates.html");
const row = (id) => {
  const el = page.getElementById(id);
  assert.ok(el, `rates.html has no #${id}`);
  return el;
};
const suvVehicles = Object.entries(VEHICLES).filter(([key]) => key.startsWith("suv-"));
const hourlyFigures = Object.values(VEHICLES).map((v) => v.hourly).filter((v) => v !== null);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
  }
}

const leg = (cls, airport) => {
  const fare = AIRPORT_FARES[cls][airport];
  const tax = percentCents(fare, NYC_TAX_PERCENT);
  const bcf = percentCents(fare, BCF_PERCENT);
  const total = AIRPORT_TOTALS[cls][airport];
  return { fare, tax, bcf, tolls: total - fare - tax - bcf, total };
};
const airportTotal = AIRPORT_TOTALS.suv.jfk;
const FAR = ["jfk", "ewr", "teb"];
const example = (() => {
  const fare = VEHICLES.sedan.hourly * HOURS.min;
  const tax = percentCents(fare, NYC_TAX_PERCENT);
  const bcf = percentCents(fare, BCF_PERCENT);
  return { fare, tax, bcf, total: fare + tax + bcf };
})();

test("AIRPORT_FARES and AIRPORT_TOTALS cover every class at every priced airport, JFK, Newark and Teterboro share one total per class and LaGuardia costs less", () => {
  assert.deepEqual(Object.keys(AIRPORT_FARES), CLASS_KEYS);
  assert.deepEqual(Object.keys(AIRPORT_TOTALS), CLASS_KEYS);
  for (const cls of CLASS_KEYS) {
    assert.deepEqual(Object.keys(AIRPORT_FARES[cls]), AIRPORT_PLACES, cls);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[cls]), AIRPORT_PLACES, cls);
    for (const airport of FAR) assert.equal(AIRPORT_TOTALS[cls][airport], AIRPORT_TOTALS[cls].jfk, `${cls} ${airport}`);
    assert.ok(AIRPORT_TOTALS[cls].lga < AIRPORT_TOTALS[cls].jfk, `${cls} lga`);
    for (const airport of AIRPORT_PLACES) assert.equal(leg(cls, airport).tolls, 1275, `${cls} ${airport} tolls`);
  }
});

test("the airport table has one row per class in CLASSES order with the JFK, Newark and Teterboro total and the LaGuardia total", () => {
  const rows = [...page.querySelectorAll("#airport-rates tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), CLASS_KEYS.map((k) => `airport-${k}`));
  for (const [i, cls] of CLASS_KEYS.entries()) {
    assert.equal(own(rows[i].querySelector("th")), CLASSES[cls].name, cls);
    assert.deepEqual([...rows[i].querySelectorAll("td")].map((td) => cents(squash(td))), [[AIRPORT_TOTALS[cls].jfk], [AIRPORT_TOTALS[cls].lga]], cls);
  }
});

test("the airport columns are JFK, Newark and Teterboro, and LaGuardia, and the #jfk, #ewr, #teb and #lga anchors sit in their headers", () => {
  const heads = [...page.querySelectorAll("#airport-rates thead th")];
  assert.deepEqual(heads.map(squash), ["Class and vehicles", "JFK, Newark and Teterboro", "LaGuardia"]);
  assert.deepEqual(["jfk", "ewr", "teb"].map((id) => row(id).closest("th")), [heads[1], heads[1], heads[1]]);
  assert.equal(row("lga"), heads[2]);
});

test("the airport table caption says by vehicle class and the footer names both directions and what is included", () => {
  const table = row("airport-rates");
  assert.equal(squash(table.querySelector("caption")), "One way airport transfers to or from any New York City address, by vehicle class.");
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map(squash), ["Totals for one way, in either direction, with tolls, airport fees, NYC sales tax and the Black Car Fund included."]);
});

test("#airport-total rows equal the Business SUV lines to JFK, Newark and Teterboro from api/_trip.mjs legLines", () => {
  assert.equal(typeof trip.legLines, "function", "api/_trip.mjs does not export legLines yet");
  const table = row("airport-total");
  const shown = [...table.querySelectorAll("tbody tr")].map((tr) => [squash(tr.querySelector("th")), cents(squash(tr.querySelector("td")))[0]]);
  for (const airport of FAR) {
    const { lines, total } = trip.legLines("suv", airport);
    assert.deepEqual(shown, lines.map((l) => [l.label, l.cents]), airport);
    assert.equal(total, airportTotal, airport);
  }
  const foot = [...table.querySelectorAll("tfoot tr")];
  assert.equal(squash(foot[0].querySelector("th")), "Total");
  assert.deepEqual(cents(squash(foot[0].querySelector("td"))), [airportTotal]);
  assert.equal(squash(foot[1]), "Every class adds NYC sales tax and the Black Car Fund to its fare, and $12.75 for tolls and airport fees. Meet and greet and a gratuity, if chosen, are added at booking.");
  assert.deepEqual(cents(squash(foot[1])), [leg("suv", "jfk").tolls]);
});

test("#airport-total rows add up to the total with the rates and rounding of api/_rates.mjs", () => {
  const table = row("airport-total");
  const figures = [...table.querySelectorAll("tbody td")].map((td) => cents(squash(td))[0]);
  const { fare, tax, bcf, tolls, total } = leg("suv", "jfk");
  assert.deepEqual(figures, [fare, tax, bcf, tolls]);
  assert.equal(figures.reduce((a, b) => a + b, 0), total);
  const labels = [...table.querySelectorAll("tbody th")].map(squash);
  assert.deepEqual(labels, ["Fare", `NYC sales tax (${NYC_TAX_PERCENT}%)`, `Black Car Fund (${BCF_PERCENT}%)`, "Tolls and airport fees"]);
  assert.equal(squash(table.querySelector("caption")), `What a $${total / 100} ${CLASSES.suv.name} total includes`);
});

const hourlyRows = [
  ["business-premium-suv", "premium", "premium"],
  ["first-class", "first", "first"],
  ["sedan-electric", "sedan", "sedan"],
  ["luxury-sprinter", "sprinter", "sprinter"],
];

test("the hourly rows follow CLASSES order and the hourly rates are the owner's: First Class $175, every other rate unchanged", () => {
  assert.deepEqual([...page.querySelectorAll("#hourly tbody tr")].map((tr) => tr.id), ["business-suv", "business-premium-suv", "first-class", "sedan-electric", "luxury-sprinter"]);
  assert.deepEqual(Object.fromEntries(Object.entries(VEHICLES).map(([k, v]) => [k, v.hourly])), { "suv-suburban": 9500, "suv-denali": 10000, "suv-navigator": 10000, premium: 10500, sedan: 8500, first: 17500, sprinter: null });
  assert.deepEqual(cents(squash(row("first-class"))), [17500, 52500]);
  assert.equal(squash(row("business-premium-suv").querySelector("th small")), VEHICLES.premium.model);
});

for (const [id, cls, vehicle] of hourlyRows) {
  test(`#${id} name, seats, per hour and three hours match CLASSES and VEHICLES`, () => {
    const el = row(id);
    const [seats, perHour, three] = [...el.querySelectorAll("td")].map(squash);
    assert.equal(own(el.querySelector("th")), CLASSES[cls].name);
    assert.equal(Number(seats), CLASSES[cls].seats);
    assert.equal(VEHICLES[vehicle].cls, cls);
    if (VEHICLES[vehicle].hourly === null) {
      assert.ok(perHour.startsWith("From") && three.startsWith("From"), `${perHour} | ${three}`);
      return;
    }
    assert.ok(!perHour.includes("From") && !three.includes("From"), `${perHour} | ${three}`);
    assert.deepEqual(cents(perHour), [VEHICLES[vehicle].hourly]);
    assert.deepEqual(cents(three), [VEHICLES[vehicle].hourly * HOURS.min]);
  });
}

test("VEHICLES.sprinter.hourly is null against the word From", () => {
  assert.equal(VEHICLES.sprinter.hourly, null);
  assert.ok(squash(row("luxury-sprinter")).includes("From"));
});

test("each model and figure in #business-suv matches one suv- entry, in both directions", () => {
  const el = row("business-suv");
  assert.equal(own(el.querySelector("th")), CLASSES.suv.name);
  const listed = squash(el.querySelector("th small"))
    .split(", ")
    .map((part) => /^(.+) \$(\d+)$/.exec(part))
    .map((m) => {
      assert.ok(m, "a model in #business-suv has no figure");
      return [m[1], Number(m[2]) * 100];
    });
  const config = suvVehicles.map(([, v]) => [v.model, v.hourly]);
  assert.deepEqual([...listed].sort(), [...config].sort());
  for (const [, v] of suvVehicles) assert.equal(v.cls, "suv");
});

test("the #business-suv seats, range and three hour range match the suv- entries", () => {
  const [seats, perHour, three] = [...row("business-suv").querySelectorAll("td")].map(squash);
  const rates = suvVehicles.map(([, v]) => v.hourly);
  const [min, max] = [Math.min(...rates), Math.max(...rates)];
  assert.equal(Number(seats), CLASSES.suv.seats);
  assert.deepEqual(cents(perHour), [min, max]);
  assert.deepEqual(cents(three), [min * HOURS.min, max * HOURS.min]);
});

const facts = Object.fromEntries([...page.querySelectorAll("#add-ons dl.facts dt")].map((dt) => [squash(dt), squash(dt.nextElementSibling)]));

test("meet and greet equals MEET_AND_GREET", () => {
  assert.deepEqual(cents(facts["Meet and greet"] || ""), [MEET_AND_GREET]);
});

test("the gratuity line lists TIP_PERCENTS, none first, and says it is optional", () => {
  const text = facts.Gratuity || "";
  assert.ok(text.startsWith("Optional, none, "), text);
  const listed = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  assert.deepEqual([0, ...listed], TIP_PERCENTS);
  assert.ok(text.endsWith("of the fare, chosen before you pay"), text);
});

test("the taxes line and the hourly caption show both percents of api/_rates.mjs", () => {
  for (const text of [facts.Taxes || "", squash(page.getElementById("hourly-caption"))]) {
    assert.ok(text.includes(`NYC sales tax (${NYC_TAX_PERCENT}%)`), text);
    assert.ok(text.includes(`Black Car Fund (${BCF_PERCENT}%)`), text);
  }
  const percents = [...squash(page.body).matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => m[1]);
  const allowed = new Set([NYC_TAX_PERCENT, BCF_PERCENT, ...TIP_PERCENTS.filter((t) => t > 0).map(String)]);
  assert.deepEqual(percents.filter((p) => !allowed.has(p)), []);
});

test("tolls and airport fees are included on airport transfers and billed after hourly rides", () => {
  assert.equal(facts["Tolls and airport fees"], "Included on airport transfers. On hourly bookings, billed at cost after the ride to the card saved at booking");
  assert.equal(facts["Extra stops"], "On airport transfers, charged after the ride to the card saved at booking");
  assert.equal(facts.Tolls, undefined);
});

test("the three hour minimum equals HOURS.min", () => {
  const text = squash(page.getElementById("hourly"));
  const m = /\b(\w+)[ -]hour minimum\b/.exec(text);
  assert.ok(m, "no minimum sentence in #hourly");
  assert.equal({ ...WORDS, 3: 3 }[m[1]], HOURS.min);
});

test("the flat fare is for the five boroughs, which ADDRESS_PLACES lists with Outside New York City", () => {
  assert.ok(squash(page.body).includes("any address in the five boroughs"));
  assert.deepEqual(ADDRESS_PLACES.filter((p) => p !== "outside").length, 5);
  assert.ok(ADDRESS_PLACES.includes("outside"));
});

test("the worked hourly example is three hours of Sedan & Electric with the tax and Black Car Fund of api/_rates.mjs", () => {
  const cell = [...row("hourly").querySelectorAll("tfoot td")].map(squash);
  assert.equal(cell.length, 1);
  const word = Object.keys(WORDS).find((w) => WORDS[w] === HOURS.min);
  assert.ok(cell[0].includes(`${word} hours of ${CLASSES.sedan.name}`), cell[0]);
  assert.deepEqual(cents(cell[0]), [example.fare, example.tax, example.bcf, example.total]);
  assert.deepEqual([example.fare, example.tax, example.bcf, example.total], [25500, 2263, 574, 28337]);
});

test("every $ figure in the three rate tables is reproducible from the config", () => {
  const tables = [...page.querySelectorAll("table.rate-table")];
  assert.equal(tables.length, 3);
  const legs = CLASS_KEYS.flatMap((cls) => AIRPORT_PLACES.map((airport) => leg(cls, airport)));
  const known = new Set([
    ...legs.flatMap((l) => [l.fare, l.tax, l.bcf, l.tolls, l.total]),
    ...hourlyFigures,
    ...hourlyFigures.map((v) => v * HOURS.min),
    example.fare,
    example.tax,
    example.bcf,
    example.total,
  ]);
  const unknown = [];
  for (const cell of tables.flatMap((t) => [...t.querySelectorAll("td, th")])) {
    const text = squash(cell);
    if (text.startsWith("From") && cell.closest("tr").id === "luxury-sprinter") continue;
    for (const figure of cents(text)) if (!known.has(figure)) unknown.push(`${figure / 100} in "${text}"`);
  }
  assert.deepEqual(unknown, [], `not reproducible from the config:\n${unknown.join("\n")}`);
});

test("every Offer price in the rates JSON-LD is reproducible from the config", () => {
  const nodes = [...page.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => JSON.parse(s.textContent)["@graph"] || []);
  const catalog = nodes.find((n) => n["@type"] === "OfferCatalog");
  assert.ok(catalog, "rates.html has no OfferCatalog");
  const known = new Set([...Object.values(AIRPORT_TOTALS).flatMap((byAirport) => Object.values(byAirport)), ...hourlyFigures, MEET_AND_GREET]);
  const unknown = [];
  const airport = catalog.itemListElement.filter((o) => o.name.startsWith("Airport transfer, "));
  assert.deepEqual(airport.map((o) => [o.name, new URL(o.url).hash.slice(1)]), CLASS_KEYS.flatMap((k) => [[`Airport transfer, JFK, Newark or Teterboro, ${CLASSES[k].name}`, `airport-${k}`], [`Airport transfer, LaGuardia, ${CLASSES[k].name}`, `airport-${k}`]]));
  for (const [i, offer] of airport.entries()) {
    const cls = CLASS_KEYS[i >> 1];
    assert.equal(Number(offer.price) * 100, AIRPORT_TOTALS[cls][i % 2 ? "lga" : "jfk"], offer.name);
    assert.deepEqual(offer.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", price: offer.price, valueAddedTaxIncluded: true }, offer.name);
    assert.deepEqual([].concat(offer.areaServed).map((a) => a.iataCode), i % 2 ? ["LGA"] : ["JFK", "EWR", "TEB"], offer.name);
  }
  for (const offer of catalog.itemListElement) {
    const spec = offer.priceSpecification || {};
    const open = spec.minPrice !== undefined && spec.maxPrice === undefined && spec.price === undefined;
    if (open) {
      assert.equal(offer.url, "https://www.nycluxride.com/rates#luxury-sprinter", `${offer.name} has an open-ended price`);
      continue;
    }
    for (const value of [offer.price, spec.price, spec.minPrice, spec.maxPrice]) {
      if (value !== undefined && !known.has(Number(value) * 100)) unknown.push(`${value} in ${offer.name}`);
    }
  }
  assert.deepEqual(unknown, [], unknown.join("\n"));
});

test("the reason sentences agree with MIN_NOTICE_HOURS, HOURS and MAX_ADVANCE_DAYS", () => {
  assert.ok(REASONS["short-notice"].text.includes(`${MIN_NOTICE_HOURS} hours`), REASONS["short-notice"].text);
  assert.ok(REASONS["hours-range"].text.includes(`${HOURS.min} to ${HOURS.max} hours`), REASONS["hours-range"].text);
  assert.equal(MAX_ADVANCE_DAYS, 365);
  assert.match(REASONS["far-ahead"].text, /\b(1|a|one) year\b/);
});

test("the reasons drop class-airport and first-lga, and the class and stop sentences agree with CLASSES and AIRPORT_PLACES", () => {
  assert.equal(REASONS["class-airport"], undefined);
  assert.equal(REASONS["first-lga"], undefined);
  assert.ok(REASONS["sprinter-hourly"].text.includes(CLASSES.sprinter.name), REASONS["sprinter-hourly"].text);
  assert.equal(VEHICLES.sprinter.hourly, null);
  const names = AIRPORT_PLACES.map((p) => ({ jfk: "JFK", lga: "LaGuardia", ewr: "Newark", teb: "Teterboro" })[p]);
  assert.ok(REASONS["stop-leg"].text.includes(`${names.slice(0, -1).join(", ")} or ${names.at(-1)}`), REASONS["stop-leg"].text);
});

function sectionText(doc, id) {
  const start = doc.getElementById(id);
  assert.ok(start, `#${id} is missing`);
  const parts = [squash(start)];
  for (let node = start.nextElementSibling; node && node.tagName !== start.tagName; node = node.nextElementSibling) parts.push(squash(node));
  return parts.join(" ");
}

test("payments open in production only once the pages the consent box links to carry published, non-draft terms", () => {
  const links = [...CHECKOUT.terms.matchAll(/\]\(https:\/\/www\.nycluxride\.com\/([a-z-]+)#([a-z-]+)\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [["terms-of-service", "payments"], ["rates", "cancellation"]]);
  assert.equal(typeof CONSENT_TERMS_LIVE, "boolean");
  if (!CONSENT_TERMS_LIVE) return;
  for (const [file, id] of links) assert.doesNotMatch(sectionText(file === "rates" ? page : load(`${file}.html`), id), /DRAFT|\[|\]/, `${file}.html #${id}`);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll pay-rates tests passed");
process.exit(0);
