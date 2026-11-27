import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSettings, priceTrip, priceRide, priceLeg, legLines, hourlyLines, distanceFare, receipt, shownLines, rateKey } from "../api/_trip.mjs";
import { sessionParams, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters, bookingEvents, bookingText, reminderLetter } from "../api/_mail.mjs";
import { LABELS, NOTES } from "../api/_copy.mjs";
import * as RATES from "../api/_rates.mjs";

const { DISTANCE_RATES, LONG_RATES, SHORT_MILES, LONG_MILES, FEE_PERCENT, AIRPORT_TOTALS, AIRPORT_FARES, VEHICLES, CLASSES, TIME_CAP_PER_MILE, TIME_CAP_BASE } = RATES;
const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const SITE = "https://www.nycluxride.com";
const KEYS = Object.keys(CLASSES).map((cls) => rateKey(cls));
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100", rider: "me", reach: "phone" };
const round = (x) => Math.floor(x + 0.5);
const billed = (tenths, minutes) => Math.min(minutes, Math.floor((tenths * 25) / 100 + 10));
const card = (rate, tenths, minutes) => rate.base + round((tenths * rate.mile) / 10) + billed(tenths, minutes) * rate.minute;
const fee = (fare) => round((fare * 12) / 100);
const pairs = (lines) => lines.map(({ label, cents }) => [label, cents]);

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.stack || err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

const leg = (ride, extra = {}) => ({ from: "manhattan", to: "outside", airport: "", direction: "", back: false, reason: "", salesTax: { area: "", percent: "0" }, ride, ...extra });
const distanceTrip = (cls, legs, extra = {}) => ({ trip_type: "one", class: cls, vehicle: cls === "sprinter" ? "sprinter-executive" : "", tip: 0, passengers: "2", date: "2026-12-02", time: "14:00", from_text: "1 City Point, Brooklyn, NY 11201", to_text: "338 Windsor Ave, Westfield, NJ 07090", details: ME, legs, ...extra });
const airportTrip = (cls, airport, extra = {}) => ({ trip_type: "one", class: cls, vehicle: cls === "sprinter" ? "sprinter-executive" : "", tip: 0, passengers: "2", date: "2026-12-02", time: "14:00", from_text: "350 5th Ave, New York, NY 10118", to_text: airport.toUpperCase(), details: ME, legs: [{ from: "manhattan", to: airport, airport, direction: "to-airport", back: false, reason: "", salesTax: { area: "8081", percent: "8.875" } }], ...extra });
const hourlyTrip = (vehicle, hours, extra = {}) => ({ trip_type: "hour", class: VEHICLES[vehicle].cls, vehicle, hours: String(hours), tip: 0, passengers: "2", date: "2026-12-02", time: "14:00", from_text: "350 5th Ave, New York, NY 10118", details: ME, ends: { from: { text: "350 5th Ave, New York, NY 10118", zone: "manhattan", place: "", id: "", region: "8081" } }, ...extra });
function stripe(trip, price) {
  const params = sessionParams(trip, price, "25208695", ON, NOW, SITE);
  const metadata = Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  const items = [];
  for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) items.push([params.get(`line_items[${i}][price_data][product_data][name]`), Number(params.get(`line_items[${i}][price_data][unit_amount]`))]);
  return { params, metadata, items };
}
const session = (metadata) => ({ id: "cs_test_feebands0000000000000001", livemode: false, status: "complete", payment_status: "paid", amount_total: Number(metadata.total_cents), currency: "usd", client_reference_id: metadata.ref, customer_details: { email: ME.email, name: ME.name, phone: ME.phone }, payment_intent: "pi_test_feebands0001", metadata });

await test("the constants of api/_rates.mjs: a 12% fee, the short card under 50 miles with the owner's bases, the long card from 75 miles, every short minimum at its base but the Executive Sprinter's $350 and the First Class $170, and billed minutes capped at 2.5 a mile plus 10", () => {
  assert.deepEqual([FEE_PERCENT, SHORT_MILES, LONG_MILES, TIME_CAP_PER_MILE, TIME_CAP_BASE], ["12", 50, 75, 2.5, 10]);
  assert.deepEqual(Object.fromEntries(Object.entries(DISTANCE_RATES).map(([key, rate]) => [key, rate.base])), { suv: 8500, premium: 9500, first: 10500, sedan: 7500, electric: 10621, "sprinter-executive": 8000 });
  assert.deepEqual(Object.fromEntries(Object.entries(DISTANCE_RATES).map(([key, rate]) => [key, [rate.mile, rate.minute]])), { suv: [400, 65], premium: [475, 80], first: [525, 90], sedan: [300, 50], electric: [442, 74], "sprinter-executive": [900, 145] });
  for (const [key, rate] of Object.entries(DISTANCE_RATES)) assert.equal(rate.minimum, key === "sprinter-executive" ? 35000 : key === "first" ? 17000 : rate.base, key);
  assert.deepEqual(Object.keys(LONG_RATES), Object.keys(DISTANCE_RATES));
  assert.deepEqual(LONG_RATES.suv, { base: 0, mile: 410, minute: 25 });
  assert.deepEqual(LONG_RATES["sprinter-executive"], { base: 7300, mile: 820, minute: 132 });
  for (const name of ["NYC_TAX_PERCENT", "BCF_PERCENT"]) assert.equal(name in RATES, false, name);
});

await test("under SHORT_MILES every class pays base + miles x per mile + billed minutes x per minute, never below its minimum, with half cents rounded up, and billed minutes never pass 2.5 a mile plus 10", () => {
  for (const key of KEYS) {
    const rate = DISTANCE_RATES[key];
    for (const [tenths, minutes] of [[0, 0], [9, 8], [22, 17], [161, 20], [231, 42], [231, 55], [334, 57], [499, 90], [500, 95]]) {
      assert.equal(distanceFare(key, tenths, minutes), Math.max(rate.minimum, card(rate, tenths, minutes)), `${key} ${tenths} ${minutes}`);
    }
  }
  assert.deepEqual([distanceFare("suv", 0, 0), distanceFare("sprinter-executive", 0, 0), distanceFare("premium", 161, 20)], [8500, 35000, 18748]);
  assert.deepEqual([distanceFare("suv", 22, 17), distanceFare("suv", 22, 15), distanceFare("suv", 22, 14)], [10355, 10355, 10290], "2.2 miles bills at most 15 minutes");
  assert.deepEqual([distanceFare("first", 9, 8), distanceFare("first", 0, 0)], [17000, 17000], "the lowest First Class ride stays $170");
});

const flat = (rate, tenths, minutes) => rate.base + round((tenths * rate.mile) / 10) + minutes * rate.minute;
const raw = (key, tenths, minutes) => {
  const [from, to] = [SHORT_MILES * 10, LONG_MILES * 10];
  const short = flat(DISTANCE_RATES[key], tenths, minutes);
  const long = flat(LONG_RATES[key], tenths, minutes);
  return tenths <= from ? short : tenths >= to ? long : round(short + ((long - short) * (tenths - from)) / (to - from));
};
const highest = (key, tenths, minutes) => {
  let top = DISTANCE_RATES[key].minimum;
  for (let at = 0; at <= tenths; at++) top = Math.max(top, raw(key, at, billed(tenths, minutes)));
  return top;
};

await test("from LONG_MILES every class pays the long card of LONG_RATES with no short base and no minimum on top, unless a shorter trip in the same minutes costs more", () => {
  for (const key of KEYS) {
    for (const [tenths, minutes] of [[960, 114], [1296, 131], [2114, 262], [4000, 420], [5000, 720]]) {
      assert.equal(distanceFare(key, tenths, minutes), card(LONG_RATES[key], tenths, minutes), `${key} ${tenths} ${minutes}`);
    }
    for (const [tenths, minutes] of [[750, 90], [751, 90], [760, 100], [800, 150], [960, 114]]) {
      assert.equal(distanceFare(key, tenths, minutes), highest(key, tenths, minutes), `${key} ${tenths} ${minutes}`);
    }
  }
  assert.deepEqual([distanceFare("suv", 960, 114), distanceFare("sedan", 2114, 262), distanceFare("sprinter-executive", 1296, 131)], [42210, 83458, 130864]);
  assert.deepEqual([card(LONG_RATES.suv, 750, 90), distanceFare("suv", 750, 90), card(DISTANCE_RATES.suv, 500, 90)], [33000, 34350, 34350], "75 miles in 90 minutes costs what 50 miles in 90 minutes costs");
});

await test("between 50 and 75 miles the fare moves on a straight line from the short card to the long card, never below a shorter trip in the same minutes, so neither end jumps", () => {
  for (const key of KEYS) {
    for (const minutes of [60, 90, 120]) {
      const short = (tenths) => card(DISTANCE_RATES[key], tenths, minutes);
      const long = (tenths) => card(LONG_RATES[key], tenths, minutes);
      assert.equal(distanceFare(key, 500, minutes), Math.max(DISTANCE_RATES[key].minimum, short(500)), `${key} at 50 miles`);
      assert.equal(distanceFare(key, 750, minutes), Math.max(long(750), highest(key, 749, minutes)), `${key} at 75 miles`);
      if (long(750) >= Math.max(DISTANCE_RATES[key].minimum, short(500))) assert.equal(distanceFare(key, 750, minutes), long(750), `${key} reaches the long card at 75 miles`);
      for (const tenths of [501, 525, 600, 625, 700, 749]) {
        const want = round(short(tenths) + ((long(tenths) - short(tenths)) * (tenths - 500)) / 250);
        assert.equal(distanceFare(key, tenths, minutes), Math.max(want, highest(key, tenths, minutes)), `${key} ${tenths} ${minutes}`);
        assert.ok(distanceFare(key, tenths, minutes) >= Math.max(DISTANCE_RATES[key].minimum, want), `${key} ${tenths} ${minutes}`);
      }
      const step = Math.max(DISTANCE_RATES[key].mile, LONG_RATES[key].mile) / 10 + Math.abs(short(500) - long(500)) / 250 + 2;
      for (let tenths = 490; tenths < 760; tenths++) assert.ok(Math.abs(distanceFare(key, tenths + 1, minutes) - distanceFare(key, tenths, minutes)) <= step, `${key} ${tenths} to ${tenths + 1} at ${minutes} min`);
    }
  }
  assert.deepEqual([distanceFare("suv", 625, 60), card(DISTANCE_RATES.suv, 500, 60), distanceFare("sedan", 525, 64)], [32400, 32400, 25876], "62.5 miles in 60 minutes costs what 50 miles in 60 minutes costs");
  assert.deepEqual([distanceFare("suv", 500, 80), distanceFare("suv", 750, 100)], [33700, 35000], "a Business SUV ride of 75 miles and 100 minutes never costs less than 50 miles and 80 minutes");
  assert.deepEqual([distanceFare("premium", 550, 110), distanceFare("premium", 750, 110)], [42050, 42050]);
});

await test("a longer trip never costs less: in every class the fare never falls as the miles or the minutes grow, from 0 to 100 miles and in 0 to 720 minutes", () => {
  for (const key of Object.keys(DISTANCE_RATES)) {
    for (const minutes of [0, 30, 38, 40, 42, 60, 80, 100, 110, 150, 200, 400, 720]) {
      for (let tenths = 0; tenths < 1000; tenths++) {
        assert.ok(distanceFare(key, tenths + 1, minutes) >= distanceFare(key, tenths, minutes), `${key} ${tenths} to ${tenths + 1} at ${minutes} min`);
        if (minutes) assert.ok(distanceFare(key, tenths, minutes) >= distanceFare(key, tenths, minutes - 1), `${key} ${tenths} at ${minutes - 1} to ${minutes} min`);
      }
    }
  }
  assert.ok(distanceFare("premium", 750, 40) >= distanceFare("premium", 625, 40), "the blend of the Business Premium SUV never turns down near 75 miles");
});

await test("the expected table at the probed routes, Wednesday 2 PM: the Business SUV short rides and every class to Philadelphia, Atlantic City and Boston equal the targets to the cent, fare + 12% fee + tolls", () => {
  const SUV = [
    ["Brooklyn City Point to Westfield", 231, 55, 2379, 26252],
    ["Brooklyn City Point to Westfield, as booked", 231, 42, 2379, 25305],
    ["Midtown to Short Hills", 255, 41, 1817, 25746],
    ["Midtown to Morristown", 347, 56, 1817, 30959],
    ["Midtown to Greenwich", 334, 57, 342, 28975],
    ["Midtown to White Plains", 267, 52, 342, 25609],
    ["Midtown to Jersey City", 57, 36, 1479, 15300],
    ["Midtown to Hoboken", 47, 26, 1479, 14633],
    ["Upper East Side to Brooklyn Heights", 89, 32, 0, 15837],
    ["Midtown to Upper West Side", 22, 17, 0, 11598],
  ];
  for (const [name, tenths, minutes, tolls, total] of SUV) {
    const price = priceRide("suv", { tenths, minutes, tolls });
    assert.deepEqual([price.fee, price.total], [fee(price.fare), total], name);
  }
  const LONG = {
    Philadelphia: [[960, 114, 3897], { suv: 51172, premium: 58262, first: 71265, sedan: 46233, electric: 62737, sprinter: 117093 }],
    "Atlantic City": [[1296, 131, 3241], { suv: 66421, premium: 75864, first: 93290, sedan: 59882, electric: 81957, sprinter: 149809 }],
    Boston: [[2114, 262, 807], { suv: 105218, premium: 120891, first: 149587, sedan: 94280, electric: 130723, sprinter: 241867 }],
  };
  for (const [name, [[tenths, minutes, tolls], want]] of Object.entries(LONG)) {
    for (const cls of Object.keys(CLASSES)) assert.equal(priceRide(rateKey(cls), { tenths, minutes, tolls }).total, want[cls], `${name} ${cls}`);
  }
});

await test("booking 25208695, 1 City Point to 338 Windsor Ave in a Business SUV with a small dog and a 25% gratuity: base + time and distance + tolls + the service fee", () => {
  const trip = distanceTrip("suv", [leg({ tenths: 231, minutes: 42, tolls: 2379 })], { tip: 25, dogs: { small: "1", large: "" } });
  const price = priceTrip(trip, ON);
  assert.deepEqual(pairs(price.lines), [["Fare", 20470], [LABELS.fee, 2456], [LABELS.tolls, 2379], ["Small dog (1 x $20.00)", 2000], ["Gratuity for your chauffeur (25%)", 5118]]);
  assert.equal(price.fare, 8500 + (231 * 400) / 10 + 42 * 65);
  assert.equal(price.total, 32423);
});

await test("every priced ride shows one Service fee line of 12% of each ride's fare and no sales tax or Black Car Fund line: distance, round trip, airport, hourly, in every class", () => {
  const trips = [];
  for (const cls of Object.keys(CLASSES)) {
    trips.push([`${cls} short`, distanceTrip(cls, [leg({ tenths: 231, minutes: 55, tolls: 2379 })])]);
    trips.push([`${cls} blend`, distanceTrip(cls, [leg({ tenths: 610, minutes: 85 })])]);
    trips.push([`${cls} long round trip`, distanceTrip(cls, [leg({ tenths: 960, minutes: 114, tolls: 3897 }), leg({ tenths: 962, minutes: 120, tolls: 1479 }, { from: "outside", to: "manhattan", back: true })])]);
    for (const airport of ["jfk", "lga", "ewr", "teb"]) trips.push([`${cls} ${airport}`, airportTrip(cls, airport)]);
  }
  for (const vehicle of Object.keys(VEHICLES)) trips.push([`${vehicle} by the hour`, hourlyTrip(vehicle, VEHICLES[vehicle].minHours || 3)]);
  for (const [name, trip] of trips) {
    const price = priceTrip(trip, ON);
    const fees = price.lines.filter((item) => item.label === LABELS.fee);
    const want = trip.trip_type === "hour" ? fee(price.fare) : price.legs.reduce((sum, item) => sum + fee(item.fare), 0);
    assert.deepEqual(fees.map((item) => item.cents), [want], name);
    assert.equal(price.fee, want, name);
    assert.ok(!price.lines.some((item) => [LABELS.tax, LABELS.bcf, LABELS.taxes, LABELS.legacyTax].includes(item.label)), name);
    assert.ok(!shownLines(price.lines).some((item) => /tax|Black Car Fund/i.test(item.label)), name);
    assert.equal(price.lines[1].label, LABELS.fee, name);
  }
});

await test("flat airport totals are the AIRPORT_TOTALS values, split into the AIRPORT_FARES fare, its 12% fee and $12.76 of tolls and airport fees in every class at JFK, LaGuardia and Teterboro and $22.80 at Newark", () => {
  assert.deepEqual(AIRPORT_TOTALS, {
    suv: { jfk: 18500, lga: 16500, ewr: 19500, teb: 18500 },
    premium: { jfk: 22000, lga: 19000, ewr: 23000, teb: 22000 },
    first: { jfk: 31000, lga: 25000, ewr: 32000, teb: 31000 },
    sedan: { jfk: 17000, lga: 14500, ewr: 18000, teb: 17000 },
    electric: { jfk: 25000, lga: 21500, ewr: 25000, teb: 25000 },
    "sprinter-executive": { jfk: 45000, lga: 45000, ewr: 48500, teb: 47500 },
    "sprinter-luxury-jet": { jfk: 57500, lga: 55000, ewr: 60500, teb: 59500 },
    "sprinter-presidential": { jfk: 65000, lga: 62500, ewr: 68500, teb: 67500 },
    "sprinter-limo": { jfk: 70000, lga: 67500, ewr: 73500, teb: 72500 },
    "sprinter-white-limo": { jfk: 75000, ewr: 78500, teb: 77500 },
  });
  assert.deepEqual(AIRPORT_TOTALS.suv.lga, 16500, "LaGuardia in the Business SUV stays $165");
  for (const [key, row] of Object.entries(AIRPORT_TOTALS)) {
    for (const [airport, total] of Object.entries(row)) {
      const split = priceLeg(key, airport);
      assert.deepEqual(split, { fare: AIRPORT_FARES[key][airport], fee: fee(AIRPORT_FARES[key][airport]), tolls: airport === "ewr" ? 2280 : 1276, total }, `${key} ${airport}`);
      assert.deepEqual(legLines(key, airport).lines.map((item) => item.label), [LABELS.fare, LABELS.fee, LABELS.tolls], `${key} ${airport}`);
    }
  }
  for (const vehicle of Object.keys(VEHICLES)) {
    const hours = VEHICLES[vehicle].minHours || 3;
    const fare = VEHICLES[vehicle].hourly * hours;
    assert.deepEqual(pairs(hourlyLines(vehicle, hours).lines), [[`Fare, ${hours} hours`, fare], [LABELS.fee, fee(fare)]], vehicle);
  }
});

await test("a percent gratuity on a flat airport trip is that percent of the Fare line, so at 10, 15, 20 and 25% every class pays its AIRPORT_TOTALS value plus the gratuity, and the Business SUV at 25% pays $223.45 to JFK, $198.98 to LaGuardia and $233.44 to Newark", () => {
  for (const cls of Object.keys(CLASSES)) {
    const key = rateKey(cls);
    for (const airport of Object.keys(AIRPORT_TOTALS[key])) {
      for (const tip of [10, 15, 20, 25]) {
        const price = priceTrip(airportTrip(cls, airport, { tip }), ON);
        const gratuity = round((AIRPORT_FARES[key][airport] * tip) / 100);
        assert.deepEqual([price.fare, price.tip, price.total], [AIRPORT_FARES[key][airport], gratuity, AIRPORT_TOTALS[key][airport] + gratuity], `${cls} ${airport} ${tip}%`);
        assert.deepEqual(price.lines.at(-1), { label: `Gratuity for your chauffeur (${tip}%)`, cents: gratuity }, `${cls} ${airport} ${tip}%`);
      }
    }
  }
  assert.deepEqual(["jfk", "lga", "ewr"].map((airport) => priceTrip(airportTrip("suv", airport, { tip: 25 }), ON).total), [22345, 19898, 23344]);
});

await test("Stripe gets the lines of the price box, Fare, Service fee, Tolls and the extras, summing to the total, with the fee in tax_cents, no bcf_cents and no new metadata key, and the receipt, both emails, the text, the calendar and the reminder rebuild it with no tax wording", () => {
  const trips = [
    distanceTrip("suv", [leg({ tenths: 231, minutes: 42, tolls: 2379 })], { tip: 25, dogs: { small: "1", large: "" } }),
    distanceTrip("sedan", [leg({ tenths: 640, minutes: 80, tolls: 1817 }), leg({ tenths: 650, minutes: 85, tolls: 1479 }, { from: "outside", to: "manhattan", back: true })], { tip: 15, return: true, return_date: "2026-12-04", return_time: "18:00" }),
    airportTrip("premium", "lga", { meet: false, tip: 20 }),
    hourlyTrip("sprinter-limo", 5, { tip: "custom", tip_amount: "40" }),
  ];
  for (const trip of trips) {
    const price = priceTrip(trip, ON);
    const { metadata, items } = stripe(trip, price);
    assert.deepEqual(items, pairs(shownLines(price.lines)), trip.class);
    assert.equal(items.reduce((sum, [, cents]) => sum + cents, 0), price.total, trip.class);
    assert.equal(items.filter(([label]) => label === LABELS.fee).length, 1, trip.class);
    assert.deepEqual([metadata.tax_cents, "bcf_cents" in metadata, metadata.total_cents], [String(price.fee), false, String(price.total)], trip.class);
    const rebuilt = receipt(metadata, ON);
    assert.deepEqual(pairs(shownLines(rebuilt.lines)), items, trip.class);
    const paid = session(metadata);
    for (const letter of bookingLetters(paid, { owners: ["owner@example.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }, NOW.getTime())) {
      assert.ok(letter.text.includes(`\n${LABELS.fee}: $${(price.fee / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}\n`), `${trip.class} ${letter.kind}`);
      assert.doesNotMatch(`${letter.text}\n${letter.html}`, /sales tax|Black Car Fund|Taxes and fees/i, `${trip.class} ${letter.kind}`);
    }
    for (const event of bookingEvents(paid)) assert.doesNotMatch(event.description, /\btax|Black Car Fund/i, trip.class);
    assert.doesNotMatch(bookingText(paid), /\btax|Black Car Fund/i, trip.class);
    assert.doesNotMatch(reminderLetter(paid, ["a"]).text, /\btax|Black Car Fund/i, trip.class);
  }
  assert.equal(NOTES.included, "Tolls, airport fees and the service fee are included.");
});

await test("the booking and confirmation scripts start the price box with the Service fee line and never name sales tax, the Black Car Fund or Taxes and fees", () => {
  const assets = new URL("../assets/", import.meta.url);
  const pay = readFileSync(new URL(`./${readFileSync(new URL("../book.html", import.meta.url), "utf8").match(/assets\/(pay\.[A-Za-z0-9_-]+\.js)/)[1]}`, assets), "utf8");
  const done = readFileSync(new URL(`./${readFileSync(new URL("../booking-confirmed.html", import.meta.url), "utf8").match(/assets\/(done\.[A-Za-z0-9_-]+\.js)/)[1]}`, assets), "utf8");
  assert.ok(pay.includes('["Fare","Service fee"]'));
  assert.ok(done.includes('"Service fee",'));
  for (const text of [pay, done]) assert.doesNotMatch(text, /Taxes and fees|sales tax|Black Car Fund/i);
});

if (failures) {
  console.error(`\n${failures} fee band test(s) failed`);
  process.exit(1);
}
console.log("\nAll fee band tests passed");
