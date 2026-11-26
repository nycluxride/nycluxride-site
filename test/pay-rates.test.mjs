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
  FEE_PERCENT,
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
  LONG_RATES,
  SHORT_MILES,
  LONG_MILES,
  STOP_FEE_CENTS,
  WAIT_CENTS_PER_MINUTE,
  CANCEL_TIERS,
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
const sprinters = Object.entries(VEHICLES).filter(([, v]) => v.cls === "sprinter");
const CAR_KEYS = CLASS_KEYS.filter((cls) => cls in AIRPORT_TOTALS);
const SPRINTER_KEYS = sprinters.map(([k]) => k);
const rateKey = (cls) => trip.rateKey(cls);

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
const feeOf = (fare) => percentCents(fare, FEE_PERCENT);
const leg = (cls, airport) => {
  const fare = AIRPORT_FARES[cls][airport];
  const fee = feeOf(fare);
  const total = AIRPORT_TOTALS[cls][airport];
  return { fare, fee, tolls: total - fare - fee, total };
};
const fitsTolls = (key, airport) => {
  const { fare, fee, tolls, total } = leg(key, airport);
  assert.deepEqual([tolls, fare + fee + tolls], [1276, total], `${key} ${airport}: the same $12.76 of tolls and airport fees in every class`);
};
const airportTotal = AIRPORT_TOTALS.suv.jfk;
const FAR = ["jfk", "ewr", "teb"];
const example = (() => {
  const fare = VEHICLES.sedan.hourly * HOURS.min;
  const fee = feeOf(fare);
  return { fare, fee, total: fare + fee };
})();

test("AIRPORT_FARES and AIRPORT_TOTALS cover every car class at every priced airport, JFK, Newark and Teterboro share one total per class and LaGuardia costs less, and each Sprinter has its own totals, the same at Newark and Teterboro and more than at JFK", () => {
  assert.deepEqual(Object.keys(AIRPORT_FARES), [...CAR_KEYS, ...SPRINTER_KEYS]);
  assert.deepEqual(Object.keys(AIRPORT_TOTALS), [...CAR_KEYS, ...SPRINTER_KEYS]);
  assert.deepEqual(CAR_KEYS, ["suv", "premium", "first", "sedan", "electric"]);
  for (const key of SPRINTER_KEYS) {
    const places = key === "sprinter-white-limo" ? ["jfk", "ewr", "teb"] : AIRPORT_PLACES;
    assert.deepEqual(Object.keys(AIRPORT_FARES[key]), places, key);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[key]), places, key);
    assert.equal(AIRPORT_TOTALS[key].ewr, AIRPORT_TOTALS[key].teb, key);
    assert.ok(AIRPORT_TOTALS[key].ewr > AIRPORT_TOTALS[key].jfk, key);
    if (AIRPORT_TOTALS[key].lga) assert.ok(AIRPORT_TOTALS[key].lga <= AIRPORT_TOTALS[key].jfk, `${key} lga`);
    for (const airport of places) fitsTolls(key, airport);
  }
  for (const cls of CAR_KEYS) {
    assert.deepEqual(Object.keys(AIRPORT_FARES[cls]), AIRPORT_PLACES, cls);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[cls]), AIRPORT_PLACES, cls);
    for (const airport of FAR) assert.equal(AIRPORT_TOTALS[cls][airport], AIRPORT_TOTALS[cls].jfk, `${cls} ${airport}`);
    assert.ok(AIRPORT_TOTALS[cls].lga < AIRPORT_TOTALS[cls].jfk, `${cls} lga`);
    for (const airport of AIRPORT_PLACES) fitsTolls(cls, airport);
  }
});

test("the airport table has one row per class in CLASSES order with the JFK, Newark and Teterboro total and the LaGuardia total, and the Luxury Sprinter row gives the lowest Sprinter totals and says so", () => {
  const rows = [...page.querySelectorAll("#airport-rates tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), CLASS_KEYS.map((k) => `airport-${k}`));
  for (const [i, cls] of CLASS_KEYS.entries()) {
    assert.equal(own(rows[i].querySelector("th")), CLASSES[cls].name, cls);
    if (cls === "sprinter") {
      const jfk = Math.min(...SPRINTER_KEYS.map((k) => AIRPORT_TOTALS[k].jfk));
      const ewr = Math.min(...SPRINTER_KEYS.flatMap((k) => ["ewr", "teb"].map((a) => AIRPORT_TOTALS[k][a])));
      const lga = Math.min(...SPRINTER_KEYS.filter((k) => AIRPORT_TOTALS[k].lga).map((k) => AIRPORT_TOTALS[k].lga));
      assert.deepEqual([...rows[i].querySelectorAll("td")].map((td) => cents(squash(td))), [[jfk, ewr], [lga]], cls);
      assert.deepEqual([jfk, ewr, lga], [45000, 47500, 45000]);
      assert.equal(ewr, AIRPORT_TOTALS["sprinter-executive"].ewr);
      assert.ok(squash(rows[i].querySelector("td")).includes(`$${AIRPORT_TOTALS["sprinter-executive"].ewr / 100}`), cls);
      continue;
    }
    assert.deepEqual([...rows[i].querySelectorAll("td")].map((td) => cents(squash(td))), [[AIRPORT_TOTALS[cls].jfk], [AIRPORT_TOTALS[cls].lga]], cls);
  }
});

test("the Sprinter airport table has one row per Sprinter in VEHICLES order with its JFK, Newark, Teterboro and LaGuardia totals from api/_rates.mjs, the White Luxury Limo Sprinter asks for a price at LaGuardia, and each row books its Sprinter", () => {
  const table = row("sprinter-airport");
  assert.equal(table.closest("section").id, "airport");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(squash), ["Sprinter", "One-way totals"]);
  assert.equal(squash(table.querySelector("caption")), `Luxury Sprinter airport transfers to or from any New York City address. ${copy.SPRINTER_AHEAD} ${copy.SPRINTER_SWAP}`);
  assert.equal(copy.SPRINTER_AHEAD, "Book a Sprinter at least 3 hours ahead.");
  assert.equal(copy.SPRINTER_SWAP, "If no Sprinter is free, we send two SUVs.");
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map(squash), ["One-way totals in either direction, with tolls, airport fees and the service fee included."]);
  const NAMES = { jfk: "JFK", ewr: "Newark", teb: "Teterboro", lga: "LaGuardia" };
  const rows = [...table.querySelectorAll("tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), SPRINTER_KEYS.map((k) => k.replace("sprinter-", "sprinter-airport-")));
  for (const [i, [key, v]] of sprinters.entries()) {
    assert.equal(own(rows[i].querySelector("th")), v.name, key);
    assert.equal(rows[i].dataset.seats, String(v.seats), key);
    const cells = [...rows[i].querySelectorAll("td")];
    assert.equal(cells.length, 1, key);
    const text = ["jfk", "ewr", "teb", "lga"].map((a) => (AIRPORT_TOTALS[key][a] ? `${NAMES[a]} $${AIRPORT_TOTALS[key][a] / 100}` : `${NAMES[a]}, ask for a price`)).join(", ");
    assert.equal(squash(cells[0]), `${text}Book ${/^[AEIOU]/.test(v.name) ? "an" : "a"} ${v.name}`, key);
    assert.deepEqual(cents(squash(cells[0])), ["jfk", "ewr", "teb", "lga"].filter((a) => AIRPORT_TOTALS[key][a]).map((a) => AIRPORT_TOTALS[key][a]), key);
    assert.equal(cells[0].querySelector("a").getAttribute("href"), `/book?class=sprinter&sprinter=${key}`, key);
  }
  assert.ok(squash(rows.at(-1)).includes("LaGuardia, ask for a price"));
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
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map(squash), ["One-way totals in either direction, with tolls, airport fees and the service fee included."]);
});

test("#airport-total has one column for the Business SUV to JFK, Newark and Teterboro, equal to the lines of api/_trip.mjs legLines for each of them, with one 12% service fee line", () => {
  assert.equal(typeof trip.legLines, "function", "api/_trip.mjs does not export legLines yet");
  const table = row("airport-total");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(squash), ["Item", "JFK, Newark and Teterboro"]);
  const labels = [...table.querySelectorAll("tbody th")].map(squash);
  for (const [column, airports] of [[0, ["jfk", ...NEW_JERSEY]]]) {
    const shown = [...table.querySelectorAll("tbody tr")].map((tr) => [squash(tr.querySelector("th")), cents(squash(tr.querySelectorAll("td")[column]))[0]]);
    for (const airport of airports) {
      const { lines, total } = trip.legLines("suv", airport);
      assert.deepEqual(shown, labels.map((label) => [label, (lines.find((l) => l.label === label) || { cents: 0 }).cents]), airport);
      assert.ok(lines.every((l) => labels.includes(l.label)), airport);
      assert.equal(total, airportTotal, airport);
    }
  }
  for (const airport of ["jfk", ...NEW_JERSEY]) assert.deepEqual(trip.legLines("suv", airport).lines.map((l) => [l.label, l.cents]), [["Fare", 15379], ["Service fee", 1845], ["Tolls and airport fees", 1276]], airport);
  const foot = [...table.querySelectorAll("tfoot tr")];
  assert.equal(squash(foot[0].querySelector("th")), "Total");
  assert.deepEqual([...foot[0].querySelectorAll("td")].map((td) => cents(squash(td))), [[airportTotal]]);
  assert.equal(squash(foot[1]), `Every class includes $12.76 for tolls and airport fees. Cars and SUVs cost the same to JFK, Newark and Teterboro. Any meet and greet, child seats, pets and gratuity are added when you book.`);
  assert.deepEqual(cents(squash(foot[1])), [leg("suv", "jfk").tolls]);
});

test("#airport-total rows add up to the total with the rates and rounding of api/_rates.mjs", () => {
  const table = row("airport-total");
  for (const [column, airport] of [[0, "jfk"], [0, "ewr"], [0, "teb"]]) {
    const figures = [...table.querySelectorAll("tbody tr")].map((tr) => cents(squash(tr.querySelectorAll("td")[column]))[0]);
    const { fare, fee, tolls, total } = leg("suv", airport);
    assert.deepEqual(figures, [fare, fee, tolls], airport);
    assert.equal(fee, Math.round((fare * Number(FEE_PERCENT)) / 100), airport);
    assert.equal(figures.reduce((a, b) => a + b, 0), total, airport);
  }
  const { total } = leg("suv", "jfk");
  const labels = [...table.querySelectorAll("tbody th")].map(squash);
  assert.deepEqual(labels, ["Fare", "Service fee", "Tolls and airport fees"]);
  assert.deepEqual(labels.filter((label) => /\d\s*%/.test(label)), []);
  assert.equal(squash(table.querySelector("caption")), `What a $${total / 100} ${CLASSES.suv.name} total includes`);
});

const hourlyRows = [
  ["business-premium-suv", "premium", "premium"],
  ["first-class", "first", "first"],
  ["executive-sedan", "sedan", "sedan"],
  ["electric-class", "electric", "electric"],
];

test("the hourly rows follow CLASSES order and the hourly rates are the owner's: First Class $175, every other rate unchanged", () => {
  assert.deepEqual([...page.querySelectorAll("#hourly tbody tr")].map((tr) => tr.id), ["business-suv", "business-premium-suv", "first-class", "executive-sedan", "electric-class", "hourly-executive", "hourly-luxury-jet", "hourly-presidential", "hourly-limo", "hourly-white-limo"]);
  assert.deepEqual(Object.fromEntries(Object.entries(VEHICLES).map(([k, v]) => [k, v.hourly])), { "suv-suburban": 9500, "suv-denali": 10000, "suv-navigator": 10000, premium: 10500, sedan: 8500, electric: 9000, first: 17500, "sprinter-executive": 17500, "sprinter-luxury-jet": 21500, "sprinter-presidential": 24500, "sprinter-limo": 26500, "sprinter-white-limo": 27500 });
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

test("the rates page lists the Executive Sedan and then the Electric Class in every table: $170 and $145, $85 an hour, and $180 and $155, $90 an hour, each row booking its own class", () => {
  assert.deepEqual([squash(row("airport-sedan").querySelector("th small")), squash(row("airport-electric").querySelector("th small"))], ["Mercedes-Benz E-Class or similar", "Cadillac Lyriq or similar"]);
  assert.deepEqual([...row("airport-sedan").querySelectorAll("td")].map((td) => cents(squash(td))), [[17000], [14500]]);
  assert.deepEqual([...row("airport-electric").querySelectorAll("td")].map((td) => cents(squash(td))), [[18000], [15500]]);
  assert.equal(row("airport-sedan").nextElementSibling, row("airport-electric"));
  assert.equal(row("executive-sedan").nextElementSibling, row("electric-class"));
  assert.deepEqual([...row("electric-class").querySelectorAll("td")].map(squash).map((t, i) => (i ? cents(t) : t)), ["3", [9000], [27000]]);
  assert.deepEqual([row("airport-electric").querySelector("a").getAttribute("href"), row("electric-class").querySelector("a").getAttribute("href")], ["/book?class=electric", "/book?trip-type=hour&hours=3&class=electric"]);
  assert.deepEqual([row("airport-sedan").querySelector("a").getAttribute("href"), row("executive-sedan").querySelector("a").getAttribute("href")], ["/book?class=sedan", "/book?trip-type=hour&hours=3&class=sedan"]);
  assert.deepEqual([row("airport-sedan"), row("airport-electric")].map((r) => squash(r.querySelector("a"))), ["Book an Executive Sedan", "Book an Electric Class car"]);
  assert.equal(squash(row("distance-electric").querySelector("td")), "Under 50 miles: $76.47 base, $3.18 per mile, $0.53 per minute 75 miles or more: $3.70 per mile, $0.20 per minute");
  assert.equal(squash(row("distance-sedan").querySelector("td")), "Under 50 miles: $75 base, $3.00 per mile, $0.50 per minute 75 miles or more: $3.70 per mile, $0.20 per minute");
  assert.equal(row("distance-sedan").nextElementSibling, row("distance-electric"));
  assert.deepEqual([row("airport-electric"), row("electric-class"), row("distance-electric")].map((r) => r.dataset.seats), ["3", "3", "3"]);
  assert.doesNotMatch(squash(page.body), /Sedan & Electric|CT5|CT6|XT6|Continental/);
});

test("the five Sprinters are priced by the hour with a 4-hour minimum and the owner's rates, with no event rate and no From on the rates page", () => {
  assert.deepEqual(sprinters.map(([k, v]) => [k, v.name, v.seats, v.hourly, v.event ?? null, v.minHours, Boolean(v.hourlyOnly)]), [
    ["sprinter-executive", "Executive Sprinter", 14, 17500, null, 4, false],
    ["sprinter-luxury-jet", "Luxury Jet Sprinter", 8, 21500, null, 4, false],
    ["sprinter-presidential", "Presidential Sprinter", 12, 24500, null, 4, false],
    ["sprinter-limo", "Limo Sprinter", 14, 26500, null, 4, false],
    ["sprinter-white-limo", "White Luxury Limo Sprinter", 10, 27500, null, 4, false],
  ]);
  assert.equal(CLASSES.sprinter.seats, Math.max(...sprinters.map(([, v]) => v.seats)));
  assert.doesNotMatch(squash(row("hourly")), /\bFrom\b/);
});

test("the Sprinter table lists each Sprinter with its seats, hourly rate and the cost of the 4-hour minimum, with no weddings, proms and events column", () => {
  const table = row("luxury-sprinter");
  assert.equal(table.tagName, "TABLE");
  assert.equal(table.closest("section").id, "hourly");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(squash), ["Sprinter", "Seats", "Per hour", "Four hours"]);
  assert.equal(squash(table.querySelector("caption")), `Luxury Sprinter hourly rates. Every Sprinter has a 4-hour minimum. ${copy.SPRINTER_AHEAD} ${copy.SPRINTER_SWAP} A ${FEE_PERCENT}% service fee is added at booking.`);
  const rows = [...table.querySelectorAll("tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), sprinters.map(([k]) => k.replace("sprinter-", "hourly-")));
  for (const [i, [key, v]] of sprinters.entries()) {
    const [seats, perHour, four] = [...rows[i].querySelectorAll("td")].map(squash);
    assert.equal(own(rows[i].querySelector("th")), v.name, key);
    assert.equal(rows[i].dataset.seats, String(v.seats), key);
    assert.equal(Number(seats), v.seats, key);
    assert.deepEqual(cents(perHour), [v.hourly], key);
    assert.deepEqual(cents(four), [v.hourly * v.minHours], key);
    assert.equal(rows[i].querySelector("a").getAttribute("href"), `/book?trip-type=hour&hours=${v.minHours}&class=sprinter&sprinter=${key}`, key);
  }
  assert.ok(squash(row("hourly").querySelector(".prose")).includes("Sprinters have a 4-hour minimum."));
  assert.equal(own(row("airport-sprinter").querySelector("th")), CLASSES.sprinter.name);
  assert.equal(squash(row("airport-sprinter").querySelector("th small")), "Five kinds of Sprinter, lowest prices shown");
  assert.doesNotMatch(squash(page.body), /Weddings, proms and events|booked by the hour only|Shuttle|Jet Sprinter(?<!Luxury Jet Sprinter)/);
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
  assert.equal(CHILD_SEAT_CENTS, 2000);
  assert.deepEqual(cents(facts["Child seats"] || ""), [CHILD_SEAT_CENTS]);
  assert.equal(facts["Child seats"], `Child, infant and booster seats, $${CHILD_SEAT_CENTS / 100} per seat, charged once at booking, even on a round trip`);
  assert.doesNotMatch(facts["Child seats"], /\bfree\b|included/i);
  const dd = [...page.querySelectorAll("#add-ons dl.facts dt")].find((dt) => squash(dt) === "Child seats").nextElementSibling;
  assert.deepEqual([...dd.querySelectorAll("a")].map((a) => [a.getAttribute("href"), squash(a)]), [["/car-service-with-car-seat-nyc", "Child, infant and booster seats"]]);
});

test("the gratuity line says it is optional and lists TIP_PERCENTS after none", () => {
  const text = facts.Gratuity || "";
  assert.ok(text.startsWith("Optional. Choose "), text);
  const listed = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  assert.deepEqual([0, ...listed], TIP_PERCENTS);
  assert.ok(text.endsWith("of the fare, or your own amount, before you pay"), text);
});

test("the service fee line says the fee is FEE_PERCENT of the fare, added at booking and included in airport prices, the hourly caption says so too, nothing on the page claims taxes, and the only percents on the page are the fee, the gratuity choices and the cancellation charges of CANCEL_TIERS", () => {
  assert.equal(facts["Service fee"], `${FEE_PERCENT}% of the fare, added at booking on hourly and distance trips. Airport prices already include it`);
  assert.equal(facts.Taxes, undefined);
  assert.ok(squash(page.getElementById("hourly-caption")).includes(`A ${FEE_PERCENT}% service fee is added at booking.`));
  const all = [squash(page.body), page.title, ...[...page.querySelectorAll('script[type="application/ld+json"], meta[content]')].map((n) => n.textContent || n.getAttribute("content"))].join(" ");
  for (const percent of ["8.875", "2.25", "11.125"]) assert.doesNotMatch(all, new RegExp(`(?<![\\d.$])${percent.replace(".", "\\.")}(?!\\d)`), percent);
  assert.doesNotMatch(all, /\btax(es)?\b|Black Car Fund|valueAddedTax/i);
  const percents = [...squash(page.body).matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => m[1]);
  const allowed = new Set([FEE_PERCENT, ...TIP_PERCENTS.filter((t) => t > 0), ...CANCEL_TIERS.map((t) => t.percent).filter((p) => p > 0 && p < 100)].map(String));
  assert.deepEqual(percents.filter((p) => !allowed.has(p)), []);
  assert.ok(percents.includes(FEE_PERCENT));
});

test("tolls and airport fees are included on airport transfers to or from a New York City address and billed after hourly rides and trips priced by distance and time", () => {
  assert.equal(facts["Tolls and airport fees"], "Included on airport rides to or from New York City. On distance trips, tolls are added at booking. On hourly trips, they are charged to your card after the ride");
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

test("the worked hourly example is three hours of Executive Sedan, its fare and its total with the service fee of api/_rates.mjs", () => {
  const cell = [...row("hourly").querySelectorAll("tfoot td")].map(squash);
  assert.equal(cell.length, 1);
  const word = Object.keys(WORDS).find((w) => WORDS[w] === HOURS.min);
  assert.ok(cell[0].includes(`${word} hours of ${CLASSES.sedan.name}`), cell[0]);
  assert.deepEqual(cents(cell[0]), [example.fare, example.total]);
  assert.equal(example.fare + example.fee, example.total);
  assert.deepEqual([example.fare, example.fee, example.total], [25500, 3060, 28560]);
  assert.equal(trip.hourlyLines("sedan", HOURS.min).total, example.total);
});

const DISTANCE_KEYS = CLASS_KEYS.filter((cls) => DISTANCE_RATES[rateKey(cls)]);
const dollars = (cents) => (cents % 100 ? `$${(cents / 100).toFixed(2)}` : `$${cents / 100}`);
const distanceExample = (() => {
  const m = /^For example, (\d+) miles and (\d+) minutes in a (.+?) is /.exec(squash(row("distance-rates").querySelector("tfoot td")));
  assert.ok(m, "no worked example in #distance-rates");
  const cls = CLASS_KEYS.find((k) => CLASSES[k].name === m[3]);
  const tenths = Number(m[1]) * 10;
  const minutes = Number(m[2]);
  const rate = DISTANCE_RATES[rateKey(cls)];
  const fare = trip.distanceFare(rateKey(cls), tenths, minutes);
  return { cls, tenths, minutes, base: rate.base, miles: Math.round((tenths * rate.mile) / 10), time: minutes * rate.minute, fare, fee: feeOf(fare) };
})();

test("the distance and time table has one row per class, the Luxury Sprinter too, in CLASSES order, with the short-ride base, per mile, per minute and any minimum above the base of DISTANCE_RATES, and the long-ride card of LONG_RATES", () => {
  assert.deepEqual(DISTANCE_KEYS, ["suv", "premium", "first", "sedan", "electric", "sprinter"]);
  assert.deepEqual(DISTANCE_KEYS, CLASS_KEYS);
  const rows = [...page.querySelectorAll("#distance-rates tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), DISTANCE_KEYS.map((k) => `distance-${k}`));
  assert.deepEqual([...page.querySelectorAll("#distance-rates thead th")].map(squash), ["Class", "Rates"]);
  const card = (base, mile, minute) => [...(base ? [`${dollars(base)} base`] : []), `$${(mile / 100).toFixed(2)} per mile`, `$${(minute / 100).toFixed(2)} per minute`];
  for (const [i, cls] of DISTANCE_KEYS.entries()) {
    const { base, mile, minute, minimum } = DISTANCE_RATES[rateKey(cls)];
    const long = LONG_RATES[rateKey(cls)];
    assert.equal(own(rows[i].querySelector("th")), cls === "sprinter" ? VEHICLES[rateKey(cls)].name : CLASSES[cls].name, cls);
    const cell = rows[i].querySelector("td");
    const shortParts = [...card(base, mile, minute), ...(minimum > base ? [`${dollars(minimum)} minimum`] : [])];
    const longParts = card(long.base, long.mile, long.minute);
    assert.equal(squash(cell), `Under ${SHORT_MILES} miles: ${shortParts.join(", ")} ${LONG_MILES} miles or more: ${longParts.join(", ")}`, cls);
    assert.deepEqual(cell.innerHTML.split("<br>").map((part) => part.replace(/<[^>]+>/g, "").trim()), [`Under ${SHORT_MILES} miles: ${shortParts.join(", ")}`, `${LONG_MILES} miles or more: ${longParts.join(", ")}`], cls);
    assert.equal(cell.querySelectorAll("span.nowrap").length, shortParts.length + longParts.length, cls);
    assert.equal(rows[i].querySelectorAll("td").length, 1, cls);
  }
  assert.equal(squash(row("distance-sprinter").querySelector("td")), "Under 50 miles: $80 base, $9.00 per mile, $1.45 per minute, $350 minimum 75 miles or more: $73 base, $8.20 per mile, $1.32 per minute");
  assert.equal(squash(row("distance-suv").querySelector("td")), "Under 50 miles: $85 base, $4.00 per mile, $0.65 per minute 75 miles or more: $4.10 per mile, $0.25 per minute");
  assert.equal(row("distance-sprinter").dataset.seats, String(CLASSES.sprinter.seats));
  assert.equal(squash(row("distance-sprinter").querySelector("th small")), "Other Sprinters, we'll send you a price");
  assert.deepEqual(Object.keys(DISTANCE_RATES), [...CAR_KEYS, "sprinter-executive"]);
  assert.deepEqual([...page.querySelectorAll("#distance-rates tfoot tr")].slice(1).map(squash), []);
  assert.doesNotMatch(squash(page.body), /dispatch team prices (?:Luxury )?Sprinter trips|prices Luxury Sprinter trips/);
});

test("the distance worked example is base plus miles plus minutes from api/_trip.mjs distanceFare, with the service fee of api/_rates.mjs", () => {
  const e = distanceExample;
  assert.deepEqual([e.cls, e.tenths, e.minutes], ["suv", 150, 45]);
  assert.equal(e.fare, e.base + e.miles + e.time);
  assert.ok(e.fare > DISTANCE_RATES[e.cls].minimum);
  const text = squash(row("distance-rates").querySelector("tfoot td"));
  assert.equal(text, `For example, 15 miles and 45 minutes in a ${CLASSES[e.cls].name} is ${cash(e.fare)}, or ${cash(e.fare + e.fee)} with the service fee.`);
  assert.deepEqual([e.base, e.miles, e.time, e.fare, e.fee, e.fare + e.fee], [8500, 6000, 2925, 17425, 2091, 19516]);
  assert.equal(trip.priceRide("suv", { tenths: e.tenths, minutes: e.minutes }).total, e.fare + e.fee);
});

test("the distance section says in a few plain sentences how the price is built, that each stop adds $20, that tolls and parking are charged after the ride, and that trips into New Jersey include the chauffeur's return crossing", () => {
  const ps = [...page.querySelectorAll("#distance .prose p")].map(squash);
  assert.deepEqual(ps, [
    `Other one-way trips are priced by distance and time. Under ${SHORT_MILES} miles, you pay a base rate plus a rate per mile and per minute. From ${LONG_MILES} miles, the long-distance rates apply, and in between the price blends the two.`,
    `Each stop adds ${dollars(STOP_FEE_CENTS)}, or more if it takes the car out of the way. Tolls are added to your price when you book, and trips into New Jersey include the chauffeur's return crossing. Parking is charged after the ride. For very long trips, we'll send you a price.`,
  ]);
  assert.ok(ps.join(" ").split(/\s+/).length <= 90, "the distance section stays short");
  assert.equal(squash(page.querySelector("#hourly-caption .rate-table__note")), `A ${FEE_PERCENT}% service fee is added at booking. Tolls and parking are charged after the ride.`);
  assert.equal(squash(page.querySelector("#distance-caption .rate-table__note")), `A ${FEE_PERCENT}% service fee is added at booking.`);
});

test("the airport section says that a trip between JFK, LaGuardia, Newark or Teterboro and an address outside New York City is priced by distance and time with its total shown before payment, and api/_trip.mjs never prices its Fare line below the airport fare", () => {
  assert.deepEqual([...page.querySelectorAll("#airport .prose p")].map(squash), [
    "Each transfer is a one-way, flat-rate ride to or from any address in the five boroughs. We track your flight and move the pickup if it lands early or late. The price stays the same.",
    "Pickup details for JFK, LaGuardia and Newark are on their airport pages.",
    "Airport rides to or from a place outside New York City are priced by distance and time, and you see the total before you pay. Tolls are added when you book, and parking is charged after the ride.",
  ]);
  assert.equal(squash(page.querySelector('#airport .prose a[href="#distance"]')), "priced by distance and time");
  assert.equal(own(page.getElementById("distance-caption")), "One way trips priced by distance and time, by vehicle class.");
  for (const cls of DISTANCE_KEYS) {
    for (const airport of AIRPORT_PLACES) {
      assert.equal(trip.priceDistance(rateKey(cls), { tenths: 0, minutes: 0 }, airport).fare, AIRPORT_FARES[rateKey(cls)][airport], `${cls} ${airport}`);
      assert.equal(trip.priceDistance(rateKey(cls), { tenths: 600, minutes: 180 }, airport).fare, trip.distanceFare(rateKey(cls), 600, 180), `${cls} ${airport}`);
      assert.equal(trip.priceDistance(rateKey(cls), { tenths: 600, minutes: 180 }, airport).tolls, 0, `${cls} ${airport}`);
    }
  }
});

test("every $ figure in the rate tables, the waiting table included, is reproducible from the config", () => {
  const tables = [...page.querySelectorAll("table.rate-table")];
  assert.equal(tables.length, 7);
  const legs = [...CAR_KEYS, ...SPRINTER_KEYS].flatMap((key) => Object.keys(AIRPORT_TOTALS[key]).map((airport) => leg(key, airport)));
  const known = new Set([
    ...legs.flatMap((l) => [l.fare, l.fee, l.tolls, l.total]),
    ...hourlyFigures,
    ...hourlyFigures.map((v) => v * HOURS.min),
    ...sprinters.map(([, v]) => v.hourly * v.minHours),
    example.fare,
    example.fee,
    example.total,
    ...DISTANCE_KEYS.flatMap((cls) => Object.values(DISTANCE_RATES[rateKey(cls)])),
    ...DISTANCE_KEYS.flatMap((cls) => Object.values(LONG_RATES[rateKey(cls)])),
    ...["base", "miles", "time", "fare", "fee"].map((k) => distanceExample[k]),
    distanceExample.fare + distanceExample.fee,
    ...Object.values(WAIT_CENTS_PER_MINUTE),
  ]);
  const unknown = [];
  for (const cell of tables.flatMap((t) => [...t.querySelectorAll("td, th")])) {
    const text = squash(cell);
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
  assert.deepEqual(catalog.itemListElement.filter((o) => / dog$/.test(o.name)).map((o) => [o.name, Number(o.price) * 100, Number(o.priceSpecification.price) * 100, "valueAddedTaxIncluded" in o.priceSpecification, o.url]), [["Small dog", SMALL_DOG_CENTS, SMALL_DOG_CENTS, false, "https://www.nycluxride.com/rates#add-ons"], ["Large dog", LARGE_DOG_CENTS, LARGE_DOG_CENTS, false, "https://www.nycluxride.com/rates#add-ons"]]);
  assert.deepEqual([SMALL_DOG_CENTS, LARGE_DOG_CENTS], [2000, 4500]);
  const airport = catalog.itemListElement.filter((o) => o.name.startsWith("Airport transfer, "));
  assert.deepEqual(airport.map((o) => [o.name, new URL(o.url).hash.slice(1)]), [...CAR_KEYS.flatMap((k) => [[`Airport transfer, JFK, Newark or Teterboro, ${CLASSES[k].name}`, `airport-${k}`], [`Airport transfer, LaGuardia, ${CLASSES[k].name}`, `airport-${k}`]]), ...sprinters.map(([, v]) => [`Airport transfer, ${v.name}`, "sprinter-airport"])]);
  for (const [i, offer] of airport.slice(2 * CAR_KEYS.length).entries()) {
    const [key] = sprinters[i];
    const totals = Object.values(AIRPORT_TOTALS[key]);
    assert.deepEqual(offer.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: String(Math.min(...totals) / 100), maxPrice: String(Math.max(...totals) / 100) }, offer.name);
    assert.deepEqual([].concat(offer.areaServed).map((a) => a.iataCode), ["JFK", "EWR", "TEB", "LGA"].filter((code) => code.toLowerCase() in AIRPORT_TOTALS[key]), offer.name);
  }
  for (const [i, offer] of airport.slice(0, 2 * CAR_KEYS.length).entries()) {
    const cls = CAR_KEYS[i >> 1];
    assert.equal(Number(offer.price) * 100, AIRPORT_TOTALS[cls][i % 2 ? "lga" : "jfk"], offer.name);
    assert.deepEqual(offer.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", price: offer.price }, offer.name);
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
  assert.equal(REASONS["sprinter-hourly"], undefined);
  assert.ok(sprinters.length === 5 && sprinters.every(([, v]) => Number.isInteger(v.hourly)));
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
  assert.deepEqual(links, [["terms-of-service", "payments"], ["rates", "policies"]]);
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
