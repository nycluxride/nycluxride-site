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
  CHILD_SEAT_CENTS,
  SMALL_DOG_CENTS,
  LARGE_DOG_CENTS,
  HOURS,
  MIN_NOTICE_MINUTES,
  MAX_ADVANCE_DAYS,
  ADDRESS_PLACES,
  CONSENT_TERMS_LIVE,
  DISTANCE_RATES,
  STOP_FEE_CENTS,
} from "../api/_rates.mjs";
import * as copy from "../api/_copy.mjs";
import * as trip from "../api/_trip.mjs";

const { REASONS, CHECKOUT } = copy;
const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const CLASS_KEYS = Object.keys(CLASSES);

const load = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
const squash = (node) => node.textContent.replace(/\s+/g, " ").trim();
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
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

const NEW_JERSEY = ["ewr", "teb"];
const leg = (cls, airport) => {
  const fare = AIRPORT_FARES[cls][airport];
  const tax = NEW_JERSEY.includes(airport) ? 0 : percentCents(fare, NYC_TAX_PERCENT);
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
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map(squash), ["One-way totals in either direction, with tolls, airport fees and taxes included."]);
});

test("#airport-total columns equal the Business SUV lines to JFK and to Newark and Teterboro from api/_trip.mjs legLines, with $0.00 New York sales tax in New Jersey", () => {
  assert.equal(typeof trip.legLines, "function", "api/_trip.mjs does not export legLines yet");
  const table = row("airport-total");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(squash), ["Item", "JFK", "Newark and Teterboro"]);
  const labels = [...table.querySelectorAll("tbody th")].map(squash);
  for (const [column, airports] of [[0, ["jfk"]], [1, NEW_JERSEY]]) {
    const shown = [...table.querySelectorAll("tbody tr")].map((tr) => [squash(tr.querySelector("th")), cents(squash(tr.querySelectorAll("td")[column]))[0]]);
    for (const airport of airports) {
      const { lines, total } = trip.legLines("suv", airport);
      assert.deepEqual(shown, labels.map((label) => [label, (lines.find((l) => l.label === label) || { cents: 0 }).cents]), airport);
      assert.ok(lines.every((l) => labels.includes(l.label)), airport);
      assert.equal(total, airportTotal, airport);
    }
  }
  assert.deepEqual(trip.legLines("suv", "ewr").lines.map((l) => [l.label, l.cents]), [["Fare", 16846], ["Black Car Fund", 379], ["Tolls and airport fees", 1275]]);
  const foot = [...table.querySelectorAll("tfoot tr")];
  assert.equal(squash(foot[0].querySelector("th")), "Total");
  assert.deepEqual([...foot[0].querySelectorAll("td")].map((td) => cents(squash(td))), [[airportTotal], [airportTotal]]);
  assert.equal(squash(foot[1]), "Every class includes $12.75 for tolls and airport fees, and the total is the same to JFK, Newark and Teterboro. Any meet and greet, child seats, pets and gratuity are added when you book.");
  assert.deepEqual(cents(squash(foot[1])), [leg("suv", "jfk").tolls]);
});

test("#airport-total rows add up to the total with the rates and rounding of api/_rates.mjs", () => {
  const table = row("airport-total");
  for (const [column, airport] of [[0, "jfk"], [1, "ewr"], [1, "teb"]]) {
    const figures = [...table.querySelectorAll("tbody tr")].map((tr) => cents(squash(tr.querySelectorAll("td")[column]))[0]);
    const { fare, tax, bcf, tolls, total } = leg("suv", airport);
    assert.deepEqual(figures, [fare, tax, bcf, tolls], airport);
    assert.equal(figures.reduce((a, b) => a + b, 0), total, airport);
  }
  const { total } = leg("suv", "jfk");
  const labels = [...table.querySelectorAll("tbody th")].map(squash);
  assert.deepEqual(labels, ["Fare", "NYC sales tax", "Black Car Fund", "Tolls and airport fees"]);
  assert.deepEqual(labels.filter((label) => /\d\s*%/.test(label)), []);
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

test("child seats equal CHILD_SEAT_CENTS per seat, charged once per booking and also once on a round trip, and the add-on links the car seat page", () => {
  assert.equal(CHILD_SEAT_CENTS, 1500);
  assert.deepEqual(cents(facts["Child seats"] || ""), [CHILD_SEAT_CENTS]);
  assert.equal(facts["Child seats"], `Infant, toddler and booster seats, $${CHILD_SEAT_CENTS / 100} per seat, charged once at booking, even on a round trip`);
  assert.doesNotMatch(facts["Child seats"], /\bfree\b|included/i);
  const dd = [...page.querySelectorAll("#add-ons dl.facts dt")].find((dt) => squash(dt) === "Child seats").nextElementSibling;
  assert.deepEqual([...dd.querySelectorAll("a")].map((a) => [a.getAttribute("href"), squash(a)]), [["/car-service-with-car-seat-nyc", "Infant, toddler and booster seats"]]);
});

test("the gratuity line says it is optional and lists TIP_PERCENTS after none", () => {
  const text = facts.Gratuity || "";
  assert.ok(text.startsWith("Optional. Choose "), text);
  const listed = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  assert.deepEqual([0, ...listed], TIP_PERCENTS);
  assert.ok(text.endsWith("of the fare, or your own amount, before you pay"), text);
});

test("the taxes line says taxes are added at booking and included in airport prices, the hourly caption says taxes and fees are added at booking, none with a percent, and the only percents on the page are the gratuity choices", () => {
  assert.equal(facts.Taxes, "Added at booking on hourly and distance trips. Airport prices already include them");
  assert.ok(/^Added at booking\b/.test(facts.Taxes) && facts.Taxes.endsWith("Airport prices already include them"), facts.Taxes);
  assert.ok(squash(page.getElementById("hourly-caption")).includes("Taxes and fees are added at booking."));
  for (const text of [facts.Taxes || "", squash(page.getElementById("hourly-caption"))]) assert.doesNotMatch(text, /%|percent/i);
  const all = [squash(page.body), page.title, ...[...page.querySelectorAll('script[type="application/ld+json"], meta[content]')].map((n) => n.textContent || n.getAttribute("content"))].join(" ");
  for (const percent of [NYC_TAX_PERCENT, BCF_PERCENT]) assert.doesNotMatch(all, new RegExp(`(?<![\\d.$])${percent.replace(".", "\\.")}(?!\\d)`), percent);
  const percents = [...squash(page.body).matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => m[1]);
  const allowed = new Set(TIP_PERCENTS.filter((t) => t > 0).map(String));
  assert.deepEqual(percents.filter((p) => !allowed.has(p)), []);
});

test("tolls and airport fees are included on airport transfers to or from a New York City address and billed after hourly rides and trips priced by distance and time", () => {
  assert.equal(facts["Tolls and airport fees"], "Included on airport rides to or from New York City. On hourly and distance trips, charged after the ride to the card you booked with");
  assert.equal(facts["Extra stops"], `$${STOP_FEE_CENTS / 100} per stop, charged at booking, or more if the stop takes the car out of the way. A stop added during an airport ride is charged after the ride`);
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

test("the worked hourly example is three hours of Sedan & Electric, its fare and its total with the tax and Black Car Fund of api/_rates.mjs", () => {
  const cell = [...row("hourly").querySelectorAll("tfoot td")].map(squash);
  assert.equal(cell.length, 1);
  const word = Object.keys(WORDS).find((w) => WORDS[w] === HOURS.min);
  assert.ok(cell[0].includes(`${word} hours of ${CLASSES.sedan.name}`), cell[0]);
  assert.deepEqual(cents(cell[0]), [example.fare, example.total]);
  assert.equal(example.fare + example.tax + example.bcf, example.total);
  assert.deepEqual([example.fare, example.tax, example.bcf, example.total], [25500, 2263, 574, 28337]);
});

const DISTANCE_KEYS = CLASS_KEYS.filter((cls) => DISTANCE_RATES[cls]);
const dollars = (cents) => (cents % 100 ? `$${(cents / 100).toFixed(2)}` : `$${cents / 100}`);
const distanceExample = (() => {
  const m = /^For example, (\d+) miles and (\d+) minutes in a (.+?) is /.exec(squash(row("distance-rates").querySelector("tfoot td")));
  assert.ok(m, "no worked example in #distance-rates");
  const cls = CLASS_KEYS.find((k) => CLASSES[k].name === m[3]);
  const tenths = Number(m[1]) * 10;
  const minutes = Number(m[2]);
  const rate = DISTANCE_RATES[cls];
  const fare = trip.distanceFare(cls, tenths, minutes);
  return { cls, tenths, minutes, base: rate.base, miles: Math.round((tenths * rate.mile) / 10), time: minutes * rate.minute, fare, tax: percentCents(fare, NYC_TAX_PERCENT), bcf: percentCents(fare, BCF_PERCENT) };
})();

test("the distance and time table has one row per class, the Luxury Sprinter too, in CLASSES order, with the base, per mile, per minute and minimum of DISTANCE_RATES", () => {
  assert.deepEqual(DISTANCE_KEYS, ["suv", "premium", "first", "sedan", "sprinter"]);
  assert.deepEqual(DISTANCE_KEYS, CLASS_KEYS);
  const rows = [...page.querySelectorAll("#distance-rates tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), DISTANCE_KEYS.map((k) => `distance-${k}`));
  assert.deepEqual([...page.querySelectorAll("#distance-rates thead th")].map(squash), ["Class", "Rates"]);
  for (const [i, cls] of DISTANCE_KEYS.entries()) {
    const { base, mile, minute, minimum } = DISTANCE_RATES[cls];
    assert.equal(own(rows[i].querySelector("th")), CLASSES[cls].name, cls);
    const cell = rows[i].querySelector("td");
    assert.equal(squash(cell), `${dollars(base)} base, $${(mile / 100).toFixed(2)} per mile, $${(minute / 100).toFixed(2)} per minute, ${dollars(minimum)} minimum`, cls);
    assert.equal(cell.querySelectorAll("span.nowrap").length, 4, cls);
  }
  assert.equal(squash(row("distance-sprinter").querySelector("td")), "$80 base, $9.00 per mile, $1.45 per minute, $250 minimum");
  assert.equal(row("distance-sprinter").dataset.seats, String(CLASSES.sprinter.seats));
  assert.deepEqual([...page.querySelectorAll("#distance-rates tfoot tr")].slice(1).map(squash), []);
  assert.doesNotMatch(squash(page.body), /dispatch team prices (?:Luxury )?Sprinter trips|prices Luxury Sprinter trips/);
});

test("the distance worked example is base plus miles plus minutes from api/_trip.mjs distanceFare, with the tax and Black Car Fund of api/_rates.mjs", () => {
  const e = distanceExample;
  assert.deepEqual([e.cls, e.tenths, e.minutes], ["suv", 150, 45]);
  assert.equal(e.fare, e.base + e.miles + e.time);
  assert.ok(e.fare > DISTANCE_RATES[e.cls].minimum);
  const text = squash(row("distance-rates").querySelector("tfoot td"));
  assert.equal(text, `For example, 15 miles and 45 minutes in a ${CLASSES[e.cls].name} is ${cash(e.fare)}, plus taxes and fees.`);
  assert.deepEqual([e.base, e.miles, e.time, e.fare, e.tax, e.bcf, e.fare + e.tax + e.bcf, e.fare + e.bcf], [3500, 6000, 2925, 12425, 1103, 280, 13808, 12705]);
});

test("the distance section says in a few plain sentences how the price is built, that each stop adds $20, and that tolls and parking are charged after the ride", () => {
  const ps = [...page.querySelectorAll("#distance .prose p")].map(squash);
  assert.deepEqual(ps, [
    "Other one-way trips are priced by distance and time. You pay a base rate plus a rate per mile and per minute, with a minimum for each class.",
    `Each stop adds ${dollars(STOP_FEE_CENTS)}, or more if it takes the car out of the way. Tolls and parking are charged after the ride. For very long trips, we'll send you a price.`,
  ]);
  assert.ok(ps.join(" ").split(/\s+/).length <= 90, "the distance section stays short");
  assert.equal(squash(page.querySelector("#hourly-caption .rate-table__note")), "Taxes and fees are added at booking. Tolls and parking are charged after the ride.");
  assert.equal(squash(page.querySelector("#distance-caption .rate-table__note")), "Taxes and fees are added at booking.");
});

test("the airport section says that a trip between JFK, LaGuardia, Newark or Teterboro and an address outside New York City is priced by distance and time and never costs less than the airport fare, as api/_trip.mjs prices it", () => {
  assert.deepEqual([...page.querySelectorAll("#airport .prose p")].map(squash), [
    "Each transfer is a one-way, flat-rate ride to or from any address in the five boroughs. We track your flight and move the pickup if it lands early or late. The price stays the same.",
    "Pickup details for JFK, LaGuardia and Newark are on their airport pages.",
    "Airport rides to or from a place outside New York City are priced by distance and time, and never cost less than the airport fare. Tolls and parking on these trips are charged after the ride.",
  ]);
  assert.equal(squash(page.querySelector('#airport .prose a[href="#distance"]')), "priced by distance and time");
  assert.equal(own(page.getElementById("distance-caption")), "One way trips priced by distance and time, by vehicle class.");
  for (const cls of DISTANCE_KEYS) {
    for (const airport of AIRPORT_PLACES) {
      assert.equal(trip.priceDistance(cls, { tenths: 0, minutes: 0 }, airport).fare, AIRPORT_FARES[cls][airport], `${cls} ${airport}`);
      assert.equal(trip.priceDistance(cls, { tenths: 600, minutes: 180 }, airport).fare, trip.distanceFare(cls, 600, 180), `${cls} ${airport}`);
      assert.equal(trip.priceDistance(cls, { tenths: 600, minutes: 180 }, airport).tolls, 0, `${cls} ${airport}`);
    }
  }
});

test("every $ figure in the four rate tables is reproducible from the config", () => {
  const tables = [...page.querySelectorAll("table.rate-table")];
  assert.equal(tables.length, 4);
  const legs = CLASS_KEYS.flatMap((cls) => AIRPORT_PLACES.map((airport) => leg(cls, airport)));
  const known = new Set([
    ...legs.flatMap((l) => [l.fare, l.tax, l.bcf, l.tolls, l.total]),
    ...hourlyFigures,
    ...hourlyFigures.map((v) => v * HOURS.min),
    example.fare,
    example.tax,
    example.bcf,
    example.total,
    ...DISTANCE_KEYS.flatMap((cls) => Object.values(DISTANCE_RATES[cls])),
    ...["base", "miles", "time", "fare", "tax", "bcf"].map((k) => distanceExample[k]),
    distanceExample.fare + distanceExample.tax + distanceExample.bcf,
    distanceExample.fare + distanceExample.bcf,
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
  const known = new Set([...Object.values(AIRPORT_TOTALS).flatMap((byAirport) => Object.values(byAirport)), ...hourlyFigures, MEET_AND_GREET, CHILD_SEAT_CENTS, SMALL_DOG_CENTS, LARGE_DOG_CENTS]);
  const unknown = [];
  assert.deepEqual(catalog.itemListElement.filter((o) => o.name === "Child seat").map((o) => [Number(o.price) * 100, Number(o.priceSpecification.price) * 100]), [[CHILD_SEAT_CENTS, CHILD_SEAT_CENTS]]);
  assert.deepEqual(catalog.itemListElement.filter((o) => / dog$/.test(o.name)).map((o) => [o.name, Number(o.price) * 100, Number(o.priceSpecification.price) * 100, o.priceSpecification.valueAddedTaxIncluded, o.url]), [["Small dog", SMALL_DOG_CENTS, SMALL_DOG_CENTS, false, "https://www.nycluxride.com/rates#add-ons"], ["Large dog", LARGE_DOG_CENTS, LARGE_DOG_CENTS, false, "https://www.nycluxride.com/rates#add-ons"]]);
  assert.deepEqual([SMALL_DOG_CENTS, LARGE_DOG_CENTS], [2000, 4500]);
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

test("the reason sentences agree with MIN_NOTICE_MINUTES, HOURS and MAX_ADVANCE_DAYS", () => {
  assert.equal(MIN_NOTICE_MINUTES, 90);
  assert.ok(REASONS["short-notice"].text.startsWith(`For a pickup within the next ${MIN_NOTICE_MINUTES} minutes,`), REASONS["short-notice"].text);
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
  assert.equal(names.length, 4);
  assert.equal(REASONS["stop-leg"].text, "We can't price this trip with stops online. Send it to us and we'll reply with a price.");
  assert.ok(REASONS["outside-city"].text.startsWith("Flat airport rates are for New York City addresses."), REASONS["outside-city"].text);
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
