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
  DISTANCE_LIMITS,
  STOP_FEE_CENTS,
  WAIT_CENTS_PER_MINUTE,
  CANCEL_TIERS,
  ROUTE_CAPS,
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
  assert.deepEqual([tolls, fare + fee + tolls], [airport === "ewr" ? 2280 : 1276, total], `${key} ${airport}: $12.76 of tolls and airport fees in every class, $22.80 at Newark`);
};
const airportTotal = AIRPORT_TOTALS.suv.jfk;
const FAR = ["jfk", "teb"];
const example = (() => {
  const fare = VEHICLES.sedan.hourly * HOURS.min;
  const fee = feeOf(fare);
  return { fare, fee, total: fare + fee };
})();

test("AIRPORT_FARES and AIRPORT_TOTALS cover every car class at every priced airport, JFK and Teterboro share one total per class, Newark costs $10 more but the Electric Class is $250 at all three, LaGuardia costs less, and each Sprinter has its own totals, $10 more at Newark than at Teterboro and more than at JFK", () => {
  assert.deepEqual(Object.keys(AIRPORT_FARES), [...CAR_KEYS, ...SPRINTER_KEYS]);
  assert.deepEqual(Object.keys(AIRPORT_TOTALS), [...CAR_KEYS, ...SPRINTER_KEYS]);
  assert.deepEqual(CAR_KEYS, ["suv", "premium", "first", "sedan", "electric"]);
  for (const key of SPRINTER_KEYS) {
    const places = key === "sprinter-white-limo" ? ["jfk", "ewr", "teb"] : AIRPORT_PLACES;
    assert.deepEqual(Object.keys(AIRPORT_FARES[key]), places, key);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[key]), places, key);
    assert.equal(AIRPORT_TOTALS[key].ewr, AIRPORT_TOTALS[key].teb + 1000, key);
    assert.ok(AIRPORT_TOTALS[key].teb > AIRPORT_TOTALS[key].jfk, key);
    if (AIRPORT_TOTALS[key].lga) assert.ok(AIRPORT_TOTALS[key].lga <= AIRPORT_TOTALS[key].jfk, `${key} lga`);
    for (const airport of places) fitsTolls(key, airport);
  }
  for (const cls of CAR_KEYS) {
    assert.deepEqual(Object.keys(AIRPORT_FARES[cls]), AIRPORT_PLACES, cls);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[cls]), AIRPORT_PLACES, cls);
    for (const airport of FAR) assert.equal(AIRPORT_TOTALS[cls][airport], AIRPORT_TOTALS[cls].jfk, `${cls} ${airport}`);
    assert.equal(AIRPORT_TOTALS[cls].ewr, cls === "electric" ? AIRPORT_TOTALS[cls].jfk : AIRPORT_TOTALS[cls].jfk + 1000, `${cls} ewr`);
    assert.ok(AIRPORT_TOTALS[cls].lga < AIRPORT_TOTALS[cls].jfk, `${cls} lga`);
    for (const airport of AIRPORT_PLACES) fitsTolls(cls, airport);
  }
});

test("the airport table has one row per class in CLASSES order with the JFK and Teterboro total, the Newark total and the LaGuardia total, and the Luxury Sprinter row gives the lowest Sprinter totals, says so and is booked online", () => {
  const rows = [...page.querySelectorAll("#airport-rates tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), CLASS_KEYS.map((k) => `airport-${k}`));
  for (const [i, cls] of CLASS_KEYS.entries()) {
    assert.equal(own(rows[i].querySelector("th")), CLASSES[cls].name, cls);
    if (cls === "sprinter") {
      const jfk = Math.min(...SPRINTER_KEYS.map((k) => AIRPORT_TOTALS[k].jfk));
      const teb = Math.min(...SPRINTER_KEYS.map((k) => AIRPORT_TOTALS[k].teb));
      const ewr = Math.min(...SPRINTER_KEYS.map((k) => AIRPORT_TOTALS[k].ewr));
      const lga = Math.min(...SPRINTER_KEYS.filter((k) => AIRPORT_TOTALS[k].lga).map((k) => AIRPORT_TOTALS[k].lga));
      assert.deepEqual([...rows[i].querySelectorAll("td")].map((td) => cents(squash(td))), [[jfk, teb], [ewr], [lga]], cls);
      assert.deepEqual([jfk, teb, ewr, lga], [45000, 47500, 48500, 45000]);
      assert.equal(squash(rows[i].querySelector("a")), "Book a Luxury Sprinter");
      continue;
    }
    assert.deepEqual([...rows[i].querySelectorAll("td")].map((td) => cents(squash(td))), [[AIRPORT_TOTALS[cls].jfk], [AIRPORT_TOTALS[cls].ewr], [AIRPORT_TOTALS[cls].lga]], cls);
  }
});

test("the Sprinter airport table has one row per Sprinter in VEHICLES order with its JFK, Newark, Teterboro and LaGuardia totals from api/_rates.mjs, the White Luxury Limo Sprinter asks for a price at LaGuardia, the caption says to book 3 hours ahead with no availability check, and each row books its Sprinter", () => {
  const table = row("sprinter-airport");
  assert.equal(table.closest("section").id, "airport");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(squash), ["Sprinter", "One-way totals"]);
  assert.equal(squash(table.querySelector("caption")), "Luxury Sprinter airport transfers to or from any New York City address. Book a Sprinter at least 3 hours ahead.");
  assert.doesNotMatch(squash(row("airport")), /two SUVs/);
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

test("the airport columns are JFK and Teterboro, Newark, and LaGuardia, and the #jfk, #ewr, #teb and #lga anchors sit in their headers", () => {
  const heads = [...page.querySelectorAll("#airport-rates thead th")];
  assert.deepEqual(heads.map(squash), ["Class and vehicles", "JFK and Teterboro", "Newark", "LaGuardia"]);
  assert.deepEqual(["jfk", "teb"].map((id) => row(id).closest("th")), [heads[1], heads[1]]);
  assert.equal(row("ewr"), heads[2]);
  assert.equal(row("lga"), heads[3]);
});

test("the airport table caption says by vehicle class and the footer names both directions and what is included", () => {
  const table = row("airport-rates");
  assert.equal(squash(table.querySelector("caption")), "One way airport transfers to or from any New York City address, by vehicle class.");
  assert.deepEqual([...table.querySelectorAll("tfoot td")].map(squash), ["One-way totals in either direction, with tolls, airport fees and the service fee included."]);
});

test("the airport section shows no fare split: #airport-total is one line after the airport table saying every airport price includes tolls, airport fees and the FEE_PERCENT service fee, and no fare, fee or toll figure of api/_trip.mjs legLines appears in the section", () => {
  const line = row("airport-total");
  assert.ok(line.matches("p") && line.previousElementSibling === row("airport-rates").closest(".table-scroll"));
  assert.equal(squash(line), `Every airport price includes tolls, airport fees and the ${FEE_PERCENT}% service fee. Any meet and greet, child seats, pets and gratuity are added when you book.`);
  const shown = new Set(cents(squash(row("airport"))));
  const parts = [...CAR_KEYS, ...SPRINTER_KEYS].flatMap((key) => Object.keys(AIRPORT_TOTALS[key]).flatMap((airport) => [leg(key, airport).fare, leg(key, airport).fee, leg(key, airport).tolls]));
  const totals = new Set(Object.values(AIRPORT_TOTALS).flatMap((t) => Object.values(t)));
  assert.deepEqual(parts.filter((c) => shown.has(c) && !totals.has(c)), []);
  assert.equal(page.querySelector("#airport table#airport-total, #airport-total-caption"), null);
});

const hourlyRows = [
  ["business-premium-suv", "premium", "premium"],
  ["first-class", "first", "first"],
  ["executive-sedan", "sedan", "sedan"],
  ["electric-class", "electric", "electric"],
];

test("the hourly rows follow CLASSES order and the hourly rates are the owner's: First Class $175, Electric Class $125, then the five Sprinters", () => {
  assert.deepEqual([...page.querySelectorAll("#hourly tbody tr")].map((tr) => tr.id), ["business-suv", "business-premium-suv", "first-class", "executive-sedan", "electric-class", "hourly-executive", "hourly-luxury-jet", "hourly-presidential", "hourly-limo", "hourly-white-limo"]);
  assert.deepEqual(Object.fromEntries(Object.entries(VEHICLES).map(([k, v]) => [k, v.hourly])), { "suv-suburban": 9500, "suv-denali": 10000, "suv-navigator": 10000, premium: 10500, sedan: 8500, electric: 12500, first: 17500, "sprinter-executive": 17500, "sprinter-luxury-jet": 21500, "sprinter-presidential": 24500, "sprinter-limo": 26500, "sprinter-white-limo": 27500 });
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

test("the rates page lists the Executive Sedan and then the Electric Class in every table: $170, $180 and $145, $85 an hour, and $250, $250 and $215, $125 an hour, each row booking its own class", () => {
  assert.deepEqual([squash(row("airport-sedan").querySelector("th small")), squash(row("airport-electric").querySelector("th small"))], ["Mercedes-Benz E-Class or similar", "Cadillac Lyriq or similar"]);
  assert.deepEqual([...row("airport-sedan").querySelectorAll("td")].map((td) => cents(squash(td))), [[17000], [18000], [14500]]);
  assert.deepEqual([...row("airport-electric").querySelectorAll("td")].map((td) => cents(squash(td))), [[25000], [25000], [21500]]);
  assert.equal(row("airport-sedan").nextElementSibling, row("airport-electric"));
  assert.equal(row("executive-sedan").nextElementSibling, row("electric-class"));
  assert.equal(row("route-sedan").nextElementSibling, row("route-electric"));
  assert.deepEqual([...row("electric-class").querySelectorAll("td")].map(squash).map((t, i) => (i ? cents(t) : t)), ["3", [12500], [37500]]);
  assert.deepEqual([row("airport-electric").querySelector("a").getAttribute("href"), row("electric-class").querySelector("a").getAttribute("href")], ["/book?class=electric", "/book?trip-type=hour&hours=3&class=electric"]);
  assert.deepEqual([row("airport-sedan").querySelector("a").getAttribute("href"), row("executive-sedan").querySelector("a").getAttribute("href")], ["/book?class=sedan", "/book?trip-type=hour&hours=3&class=sedan"]);
  assert.deepEqual([row("airport-sedan"), row("airport-electric")].map((r) => squash(r.querySelector("a"))), ["Book an Executive Sedan", "Book an Electric Class car"]);
  assert.deepEqual([row("airport-electric"), row("electric-class"), row("route-electric")].map((r) => r.dataset.seats), ["3", "3", "3"]);
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

test("Sprinters by the hour are booked online: the Sprinter table lists each Sprinter with its seats, hourly rate and the cost of the 4-hour minimum, each row books it by the hour, and the hourly section says so with no quote wording", () => {
  const table = row("luxury-sprinter");
  assert.equal(table.tagName, "TABLE");
  assert.equal(table.closest("section").id, "hourly");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(squash), ["Sprinter", "Seats", "Per hour", "Four hours"]);
  assert.equal(squash(table.querySelector("caption")), `Luxury Sprinter hourly rates. Every Sprinter has a 4-hour minimum. Book a Sprinter at least 3 hours ahead. A ${FEE_PERCENT}% service fee is added at booking.`);
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
    assert.equal(squash(rows[i].querySelector("a")), `Book by the hour, ${v.name}`, key);
  }
  assert.deepEqual(rows.map((tr) => cents(squash(tr.querySelectorAll("td")[2]))[0]), [70000, 86000, 98000, 106000, 110000]);
  assert.ok(squash(row("hourly").querySelector(".prose")).endsWith("Sprinters have a 4-hour minimum."));
  assert.doesNotMatch(squash(row("hourly")), /quote|request|reply with/i);
  assert.equal(own(row("airport-sprinter").querySelector("th")), CLASSES.sprinter.name);
  assert.equal(squash(row("airport-sprinter").querySelector("th small")), "Five kinds of Sprinter, lowest prices shown");
  assert.doesNotMatch(squash(page.body), /Weddings, proms and events|booked by the hour only|Shuttle|Jet Sprinter(?<!Luxury Jet Sprinter)|two SUVs/);
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
  assert.equal(facts["Service fee"], `${FEE_PERCENT}% of the fare, added at booking on hourly trips. Airport and route prices already include it`);
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

test("tolls and airport fees are included on airport transfers to or from a New York City address and on other one-way trips, and billed after hourly rides", () => {
  assert.equal(facts["Tolls and airport fees"], "Included on airport rides to or from New York City and on other one-way trips. On hourly trips, they are charged to your card after the ride");
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
const NUMBERS = /\bper[ -]mile|\bper[ -]minute|\ba (mile|minute)\b|\bbase (rate|fare)|\$\s*\d[\d.,]*\s*(base|minimum)\b|distance and time|by distance|blends? the two|long-distance rates/i;

test("the rates page shows no per-mile, per-minute or base fare figure and no table of them, in the text, the attributes, the structured data or the meta tags, and names no distance or time rate of api/_rates.mjs", () => {
  assert.equal(page.getElementById("distance-rates"), null);
  const body = page.body.cloneNode(true);
  body.querySelector("#waiting").remove();
  const text = [squash(body), page.title, ...[...page.querySelectorAll("meta[content]")].map((m) => m.getAttribute("content")), ...[...page.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent), ...[...page.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value))].join(" ");
  assert.equal(facts["Extra waiting"], "$1.20 to $4.00 a minute after the free waiting, by vehicle class");
  assert.doesNotMatch(text.replace(facts["Extra waiting"], ""), NUMBERS);
  const rates = new Set(DISTANCE_KEYS.flatMap((cls) => [DISTANCE_RATES[rateKey(cls)].mile, DISTANCE_RATES[rateKey(cls)].minute, LONG_RATES[rateKey(cls)].mile, LONG_RATES[rateKey(cls)].minute].filter((c) => c % 100)));
  assert.deepEqual(cents(squash(body)).filter((c) => rates.has(c)), []);
  assert.doesNotMatch(squash(page.getElementById("waiting")), /per mile|\bbase\b/i);
});

test("the fixed-price routes table gives the highest total for each car class between JFK, LaGuardia, Queens or Brooklyn and Jersey City, Hoboken, North Bergen or Union City, from ROUTE_CAPS in api/_rates.mjs, and the Sprinter is not on it", () => {
  const section = row("routes");
  assert.equal(squash(section.querySelector("h2")), "Fixed-price routes");
  assert.equal(squash(section.querySelector(".prose p")), "Between JFK, LaGuardia, Queens or Brooklyn and Jersey City, Hoboken, North Bergen or Union City, a trip with no stops never costs more than the price below, in any traffic. If the trip costs less, you pay less.");
  const rows = [...section.querySelectorAll("#route-rates tbody tr")];
  assert.deepEqual(rows.map((tr) => tr.id), CAR_KEYS.map((k) => `route-${k}`));
  for (const [i, cls] of CAR_KEYS.entries()) {
    assert.equal(own(rows[i].querySelector("th")), CLASSES[cls].name, cls);
    assert.deepEqual(cents(squash(rows[i].querySelector("td"))), [ROUTE_CAPS.hudson.totals[cls]], cls);
  }
  assert.deepEqual(CAR_KEYS.map((cls) => squash(row(`route-${cls}`).querySelector("td"))), ["$211.43", "$251.43", "$354.29", "$194.28", "$285.72"]);
  assert.equal(squash(section.querySelector("tfoot td")), "In either direction with no stops, with tolls and the service fee included. Any meet and greet, child seats, pets and gratuity are added when you book.");
  assert.deepEqual([...page.querySelectorAll(".jumps a")].map((a) => [a.getAttribute("href"), squash(a)]), [["#airport", "Airport transfers"], ["#hourly", "Hourly"], ["#routes", "Fixed-price routes"], ["#distance", "Other trips"], ["#add-ons", "Add-ons and terms"], ["#policies", "Policies"]]);
});

test("the quotes section says other one-way trips up to DISTANCE_LIMITS.miles show their total before you pay, each stop adds the stop fee, long distance from LONG_MILES shows its price when you book and pays online, and Canada runs 24/7 in the Executive Sedan, Business SUV and Business Premium SUV with a car within an hour for a last-minute call, booked by phone or WhatsApp, with no quote line left", () => {
  assert.equal(LONG_MILES, 75);
  assert.equal(squash(row("distance").querySelector("h2")), "Other trips");
  assert.deepEqual([...row("distance").querySelectorAll(".prose.c1-4 p")].map(squash), [`For other one-way trips up to ${DISTANCE_LIMITS.miles} miles, you see the total before you pay, with tolls in the price. Each stop adds ${dollars(STOP_FEE_CENTS)}, or more if it takes the car out of the way. Parking is charged after the ride.`]);
  const quotes = [...row("quotes").querySelectorAll("dt")].map((dt) => [squash(dt), squash(dt.nextElementSibling), [...dt.nextElementSibling.querySelectorAll("a")].map((a) => [a.getAttribute("href"), squash(a)])]);
  assert.deepEqual(quotes, [
    ["Long distance", `For ${LONG_MILES} miles or more, the price shows when you book and you can pay online`, [["/long-distance-car-service", `For ${LONG_MILES} miles or more`]]],
    ["Canada", `Canada trips run 24/7 in the ${CLASSES.sedan.name}, ${CLASSES.suv.name} and ${CLASSES.premium.name}, with a car within an hour for a last-minute call. Call or WhatsApp us to book`, [["/long-distance-car-service#canada", "Canada trips run 24/7"], ["tel:+16467750556", "Call"], ["https://wa.me/16467750556", "WhatsApp"]]],
  ]);
  assert.doesNotMatch(squash(row("distance")), /quote|Sprinter/i);
});

test("the airport section says that a trip between JFK, LaGuardia, Newark or Teterboro and an address outside New York City shows its total before payment, links the fixed-price routes, and api/_trip.mjs never prices its Fare line below the airport fare", () => {
  assert.deepEqual([...page.querySelectorAll("#airport .prose p")].map(squash), [
    "Each transfer is a one-way, flat-rate ride to or from any address in the five boroughs. We track your flight and move the pickup if it lands early or late. The price stays the same.",
    "Pickup details for JFK, LaGuardia and Newark are on their airport pages.",
    "Airport rides to or from a place outside New York City show the total before you pay, with tolls in the price. Some have a fixed price.",
  ]);
  assert.deepEqual([...page.querySelectorAll("#airport .prose p")[2].querySelectorAll("a")].map((a) => [a.getAttribute("href"), squash(a)]), [["#routes", "fixed price"]]);
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
  assert.equal(tables.length, 6);
  const legs = [...CAR_KEYS, ...SPRINTER_KEYS].flatMap((key) => Object.keys(AIRPORT_TOTALS[key]).map((airport) => leg(key, airport)));
  const known = new Set([
    ...legs.flatMap((l) => [l.fare, l.fee, l.tolls, l.total]),
    ...hourlyFigures,
    ...hourlyFigures.map((v) => v * HOURS.min),
    ...sprinters.map(([, v]) => v.hourly * v.minHours),
    example.fare,
    example.fee,
    example.total,
    ...Object.values(ROUTE_CAPS.hudson.totals),
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
  const known = new Set([...Object.values(AIRPORT_TOTALS).flatMap((byAirport) => Object.values(byAirport)), ...hourlyFigures, ...Object.values(ROUTE_CAPS.hudson.totals), MEET_AND_GREET, CHILD_SEAT_CENTS, SMALL_DOG_CENTS, LARGE_DOG_CENTS]);
  const unknown = [];
  assert.deepEqual(catalog.itemListElement.filter((o) => o.name === "Child seat").map((o) => [Number(o.price) * 100, Number(o.priceSpecification.price) * 100]), [[CHILD_SEAT_CENTS, CHILD_SEAT_CENTS]]);
  assert.deepEqual(catalog.itemListElement.filter((o) => / dog$/.test(o.name)).map((o) => [o.name, Number(o.price) * 100, Number(o.priceSpecification.price) * 100, "valueAddedTaxIncluded" in o.priceSpecification, o.url]), [["Small dog", SMALL_DOG_CENTS, SMALL_DOG_CENTS, false, "https://www.nycluxride.com/rates#add-ons"], ["Large dog", LARGE_DOG_CENTS, LARGE_DOG_CENTS, false, "https://www.nycluxride.com/rates#add-ons"]]);
  assert.deepEqual([SMALL_DOG_CENTS, LARGE_DOG_CENTS], [2000, 4500]);
  const airport = catalog.itemListElement.filter((o) => o.name.startsWith("Airport transfer, "));
  assert.deepEqual(airport.map((o) => [o.name, new URL(o.url).hash.slice(1)]), [...CAR_KEYS.flatMap((k) => [[`Airport transfer, JFK or Teterboro, ${CLASSES[k].name}`, `airport-${k}`], [`Airport transfer, Newark, ${CLASSES[k].name}`, `airport-${k}`], [`Airport transfer, LaGuardia, ${CLASSES[k].name}`, `airport-${k}`]]), ...sprinters.map(([, v]) => [`Airport transfer, ${v.name}`, "sprinter-airport"])]);
  for (const [i, offer] of airport.slice(3 * CAR_KEYS.length).entries()) {
    const [key] = sprinters[i];
    const totals = Object.values(AIRPORT_TOTALS[key]);
    assert.deepEqual(offer.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", minPrice: String(Math.min(...totals) / 100), maxPrice: String(Math.max(...totals) / 100) }, offer.name);
    assert.deepEqual([].concat(offer.areaServed).map((a) => a.iataCode), ["JFK", "EWR", "TEB", "LGA"].filter((code) => code.toLowerCase() in AIRPORT_TOTALS[key]), offer.name);
  }
  for (const [i, offer] of airport.slice(0, 3 * CAR_KEYS.length).entries()) {
    const cls = CAR_KEYS[Math.floor(i / 3)];
    const zone = ["jfk", "ewr", "lga"][i % 3];
    assert.equal(Number(offer.price) * 100, AIRPORT_TOTALS[cls][zone], offer.name);
    assert.deepEqual(offer.priceSpecification, { "@type": "PriceSpecification", priceCurrency: "USD", price: offer.price }, offer.name);
    assert.deepEqual([].concat(offer.areaServed).map((a) => a.iataCode), [["JFK", "TEB"], ["EWR"], ["LGA"]][i % 3], offer.name);
  }
  const routes = catalog.itemListElement.filter((o) => o.name.startsWith("Fixed-price route, "));
  assert.deepEqual(routes.map((o) => [o.name.split(", ").at(-1), o.url, o.priceSpecification]), CAR_KEYS.map((cls) => [CLASSES[cls].name, "https://www.nycluxride.com/rates#routes", { "@type": "PriceSpecification", priceCurrency: "USD", maxPrice: String(ROUTE_CAPS.hudson.totals[cls] / 100) }]));
  assert.deepEqual(catalog.itemListElement.filter((o) => /Sprinter/.test(o.name) && /Hourly/.test(o.name)).map((o) => [o.name, o.url, o.priceSpecification.minPrice, o.priceSpecification.maxPrice, o.priceSpecification.eligibleQuantity.minValue]), [["Hourly and as directed, Luxury Sprinter", "https://www.nycluxride.com/rates#luxury-sprinter", String(Math.min(...sprinters.map(([, v]) => v.hourly)) / 100), String(Math.max(...sprinters.map(([, v]) => v.hourly)) / 100), VEHICLES["sprinter-executive"].minHours]]);
  for (const offer of catalog.itemListElement) {
    const spec = offer.priceSpecification || {};
    const open = spec.minPrice !== undefined && spec.maxPrice === undefined && spec.price === undefined;
    if (open) {
      assert.equal(offer.url, "https://www.nycluxride.com/rates#luxury-sprinter", `${offer.name} has an open-ended price`);
      continue;
    }
    for (const value of [offer.price, spec.price, spec.minPrice, spec.maxPrice]) {
      if (value !== undefined && !known.has(Math.round(Number(value) * 100))) unknown.push(`${value} in ${offer.name}`);
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
