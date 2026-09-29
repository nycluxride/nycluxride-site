import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  CLASSES,
  VEHICLES,
  AIRPORT_FARES,
  MEET_AND_GREET,
  GRATUITY_RATE,
  HOURS,
  PASSENGERS,
  MIN_NOTICE_HOURS,
  MAX_ADVANCE_DAYS,
  PLACES,
  ADDRESS_PLACES,
  CONSENT_TERMS_LIVE,
} from "../api/_rates.mjs";
import { REASONS, CHECKOUT } from "../api/_copy.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const HERO_PAGES = ["index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html"];
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const load = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
const squash = (node) => node.textContent.replace(/\s+/g, " ").trim();
const cents = (text) => [...text.matchAll(/\$\s*(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, "")) * 100);
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

test("#jfk, #ewr, #teb and #lga equal AIRPORT_FARES.suv", () => {
  for (const id of ["jfk", "ewr", "teb", "lga"]) assert.deepEqual(cents(squash(row(id).querySelector("td"))), [AIRPORT_FARES.suv[id]], `#${id}`);
  assert.deepEqual(Object.keys(AIRPORT_FARES.suv).sort(), ["ewr", "jfk", "lga", "teb"]);
});

test("the airport row names equal the PLACES labels", () => {
  for (const id of ["jfk", "ewr", "teb", "lga"]) assert.equal(squash(row(id).querySelector("th")), PLACES[id], `#${id}`);
});

test("the airport table caption names the Business SUV class", () => {
  assert.ok(squash(page.getElementById("airport-caption")).includes(`${CLASSES.suv.name} class`));
});

const footer = [...page.querySelectorAll("table.rate-table tfoot td")].map(squash);

test("the First Class footer sentence matches AIRPORT_FARES.first", () => {
  const sentence = footer.find((s) => s.startsWith(CLASSES.first.name));
  assert.ok(sentence, "no footer sentence starts with First Class");
  const figures = cents(sentence);
  assert.equal(figures.length, 1, sentence);
  assert.ok(/\bJFK\b/.test(sentence) && /\bNewark\b/.test(sentence) && /\bTeterboro\b/.test(sentence), sentence);
  assert.ok(!/LaGuardia|LGA/.test(sentence), sentence);
  assert.deepEqual(Object.keys(AIRPORT_FARES.first).sort(), ["ewr", "jfk", "teb"]);
  for (const [airport, fare] of Object.entries(AIRPORT_FARES.first)) assert.equal(fare, figures[0], airport);
});

test("Sedan & Electric and Luxury Sprinter airport runs are quoted, and AIRPORT_FARES has no key for them", () => {
  const sentence = footer.find((s) => s.includes("quoted at booking"));
  assert.ok(sentence, "no quoted-at-booking footer sentence");
  assert.ok(sentence.includes(CLASSES.sedan.name) && sentence.includes(CLASSES.sprinter.name), sentence);
  assert.equal(cents(sentence).length, 0, sentence);
  assert.deepEqual(Object.keys(AIRPORT_FARES).sort(), ["first", "suv"]);
});

const hourlyRows = [
  ["sedan-electric", "sedan", "sedan"],
  ["first-class", "first", "first"],
  ["luxury-sprinter", "sprinter", "sprinter"],
];

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

test("the gratuity percent equals GRATUITY_RATE * 100", () => {
  const m = /(\d+(?:\.\d+)?)%/.exec(facts.Gratuity || "");
  assert.ok(m, `no percent in "${facts.Gratuity}"`);
  assert.equal(Number(m[1]), Number((GRATUITY_RATE * 100).toFixed(4)));
});

test("the three hour minimum equals HOURS.min", () => {
  const text = squash(page.getElementById("hourly"));
  const m = /Every class has a (\w+) hour minimum/.exec(text);
  assert.ok(m, "no minimum sentence in #hourly");
  assert.equal(WORDS[m[1]], HOURS.min);
});

test("the flat fare is for the five boroughs, which ADDRESS_PLACES lists with Outside New York City", () => {
  assert.ok(squash(page.body).includes("any address in the five boroughs"));
  assert.deepEqual(ADDRESS_PLACES.filter((p) => p !== "outside").length, 5);
  assert.ok(ADDRESS_PLACES.includes("outside"));
});

test("every $ figure in the two rate tables is reproducible from the config", () => {
  const tables = [...page.querySelectorAll("table.rate-table")];
  assert.equal(tables.length, 2);
  const known = new Set([
    ...Object.values(AIRPORT_FARES).flatMap((byAirport) => Object.values(byAirport)),
    ...hourlyFigures,
    ...hourlyFigures.map((v) => v * HOURS.min),
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
  const known = new Set([...Object.values(AIRPORT_FARES).flatMap((byAirport) => Object.values(byAirport)), ...hourlyFigures, MEET_AND_GREET]);
  const unknown = [];
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

for (const file of HERO_PAGES) {
  test(`${file} hero Hours run HOURS.min to HOURS.max and Passengers run PASSENGERS.min to PASSENGERS.max`, () => {
    const doc = load(file);
    const values = (selector) => [...doc.querySelectorAll(`${selector} option`)].map((o) => Number(o.value || o.textContent));
    const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
    assert.deepEqual(values("#trip-hours"), range(HOURS.min, HOURS.max));
    assert.deepEqual(values("#trip-pax"), range(PASSENGERS.min, PASSENGERS.max));
  });
}

test("the reason sentences agree with MIN_NOTICE_HOURS, HOURS and MAX_ADVANCE_DAYS", () => {
  assert.ok(REASONS["short-notice"].text.includes(`${MIN_NOTICE_HOURS} hours`), REASONS["short-notice"].text);
  assert.ok(REASONS["hours-range"].text.includes(`${HOURS.min} to ${HOURS.max} hours`), REASONS["hours-range"].text);
  assert.equal(MAX_ADVANCE_DAYS, 365);
  assert.ok(REASONS["far-ahead"].text.includes("1 year"), REASONS["far-ahead"].text);
});

test("the class-airport and seats sentences name the classes in CLASSES", () => {
  assert.ok(REASONS["class-airport"].text.includes(CLASSES.sedan.name) && REASONS["class-airport"].text.includes(CLASSES.sprinter.name));
  assert.ok(REASONS["class-airport"].text.includes(CLASSES.suv.name));
  assert.ok(REASONS["first-lga"].text.includes(CLASSES.first.name));
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
