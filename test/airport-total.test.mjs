import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceLeg, legLines, hourlyLines, bookingRef, classTotal, shownLines, rateKey, RATE_KEYS } from "../api/_trip.mjs";
import { sessionParams } from "../api/_stripe.mjs";
import { AIRPORT_FARES, AIRPORT_TOTALS, AIRPORT_PLACES, CLASSES, VEHICLES, MEET_AND_GREET, percentCents, FEE_PERCENT, TIP_PERCENTS, TIP_CUSTOM, STRIPE_MAX_CENTS, DISTANCE_RATES, LONG_RATES, WAIT_CENTS_PER_MINUTE, TOLL_CLASS, CLASS_DEFAULT_VEHICLE } from "../api/_rates.mjs";
import { PLACE_LIST } from "../api/_places.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const BROOKLYN = "277 Bedford Ave, Brooklyn, NY 11211";
const TOLLS = 1276;
const EWR_TOLLS = 2280;
const tollsAt = (zone) => (zone === "ewr" ? EWR_TOLLS : TOLLS);
const TABLE = {
  suv: { name: "Business SUV", jfk: [15379, 1845, 1276, 18500], lga: [13593, 1631, 1276, 16500], ewr: [15375, 1845, 2280, 19500], teb: [15379, 1845, 1276, 18500] },
  premium: { name: "Business Premium SUV", jfk: [18504, 2220, 1276, 22000], lga: [15825, 1899, 1276, 19000], ewr: [18500, 2220, 2280, 23000], teb: [18504, 2220, 1276, 22000] },
  first: { name: "First Class", jfk: [26539, 3185, 1276, 31000], lga: [21182, 2542, 1276, 25000], ewr: [26536, 3184, 2280, 32000], teb: [26539, 3185, 1276, 31000] },
  sedan: { name: "Executive Sedan", jfk: [14039, 1685, 1276, 17000], lga: [11807, 1417, 1276, 14500], ewr: [14036, 1684, 2280, 18000], teb: [14039, 1685, 1276, 17000] },
  electric: { name: "Electric Class", jfk: [21182, 2542, 1276, 25000], lga: [18057, 2167, 1276, 21500], ewr: [20286, 2434, 2280, 25000], teb: [21182, 2542, 1276, 25000] },
  sprinter: { name: "Luxury Sprinter", jfk: [39039, 4685, 1276, 45000], lga: [39039, 4685, 1276, 45000], ewr: [41268, 4952, 2280, 48500], teb: [41271, 4953, 1276, 47500] },
};
const SPRINTERS = {
  "sprinter-executive": { jfk: [39039, 4685, 1276, 45000], lga: [39039, 4685, 1276, 45000], ewr: [41268, 4952, 2280, 48500], teb: [41271, 4953, 1276, 47500] },
  "sprinter-luxury-jet": { jfk: [50200, 6024, 1276, 57500], lga: [47968, 5756, 1276, 55000], ewr: [51982, 6238, 2280, 60500], teb: [51986, 6238, 1276, 59500] },
  "sprinter-presidential": { jfk: [56896, 6828, 1276, 65000], lga: [54664, 6560, 1276, 62500], ewr: [59125, 7095, 2280, 68500], teb: [59129, 7095, 1276, 67500] },
  "sprinter-limo": { jfk: [61361, 7363, 1276, 70000], lga: [59129, 7095, 1276, 67500], ewr: [63589, 7631, 2280, 73500], teb: [63593, 7631, 1276, 72500] },
  "sprinter-white-limo": { jfk: [65825, 7899, 1276, 75000], ewr: [68054, 8166, 2280, 78500], teb: [68057, 8167, 1276, 77500] },
};
const figures = (cls, zone) => TABLE[cls][zone];
const legOf = (cls, zone) => {
  const [fare, fee, tolls] = figures(cls, zone);
  return [["Fare", fare], ["Service fee", fee], ["Tolls and airport fees", tolls]];
};
const totalOf = (cls, zone) => figures(cls, zone)[3];
const LEG = legOf("suv", "jfk");
const AIRPORT_ROW = Object.fromEntries(AIRPORT_PLACES.map((zone) => [zone, PLACE_LIST.find((row) => row.id === zone)]));
const BASE = { trip_type: "one", date: "2026-10-14", time: "07:30", passengers: "1", class: "suv", nonce: "airport-total-0001" };

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
  }
}

const pairs = (lines) => lines.map(({ label, cents }) => [label, cents]);
const sum = (lines) => lines.reduce((total, { cents }) => total + cents, 0);

async function build(fields) {
  const trip = await resolveTrip(readInput(fields), { now: NOW });
  return { trip, check: checkTrip(trip, NOW, ON) };
}

async function priced(fields) {
  const { trip, check } = await build(fields);
  assert.equal(check.kind, "price", JSON.stringify(check));
  assert.equal(check.reason, fields.class === "sprinter" ? (fields.trip_type === "hour" ? "sprinter-quote" : "sprinter-check") : "", JSON.stringify(check));
  return { trip, price: priceTrip(trip, ON) };
}

const toAirport = (zone, extra = {}) => ({ ...BASE, from_text: MANHATTAN, to_text: AIRPORT_ROW[zone].label, to_id: zone, ...extra });
const fromAirport = (zone, extra = {}) => ({ ...BASE, from_text: AIRPORT_ROW[zone].label, from_id: zone, to_text: MANHATTAN, ...extra });

await test("percentCents rounds the half cent up and is exact: 15379 at FEE_PERCENT 12 is 1845, 15500 at 8.875 is 1376, at 2.25 is 349", () => {
  assert.equal(FEE_PERCENT, "12");
  assert.equal(percentCents(15379, FEE_PERCENT), 1845);
  assert.equal(percentCents(15380, FEE_PERCENT), 1846);
  assert.equal(percentCents(25, FEE_PERCENT), 3);
  assert.equal(percentCents(15500, "8.875"), 1376);
  assert.equal(percentCents(15500, "2.25"), 349);
  assert.equal(percentCents(15500, "10"), 1550);
  assert.equal(percentCents(15500, "15"), 2325);
  assert.equal(percentCents(15500, "20"), 3100);
  assert.equal(percentCents(30000, "8.875"), 2663);
  assert.equal(percentCents(0, FEE_PERCENT), 0);
});

await test("the owner's table: six classes in order, the fare plus its 12% service fee is the total less $12.76 of tolls and airport fees at JFK, LaGuardia and Teterboro and $22.80 at Newark in every class, Teterboro splits like JFK, Newark costs $10 more in every class but the Electric Class, and the Electric Class is $250 at JFK, Newark and Teterboro and $215 at LaGuardia", () => {
  assert.deepEqual(Object.keys(CLASSES), ["suv", "premium", "first", "sedan", "electric", "sprinter"]);
  assert.deepEqual(Object.values(CLASSES).map((c) => c.name), Object.values(TABLE).map((c) => c.name));
  assert.deepEqual(AIRPORT_PLACES, ["jfk", "lga", "ewr", "teb"]);
  for (const cls of Object.keys(TABLE)) {
    for (const zone of AIRPORT_PLACES) {
      const [fare, fee, tolls, total] = figures(cls, zone);
      assert.equal(AIRPORT_FARES[rateKey(cls)][zone], fare, `${cls} ${zone} fare`);
      assert.equal(AIRPORT_TOTALS[rateKey(cls)][zone], total, `${cls} ${zone} total`);
      assert.equal(percentCents(fare, FEE_PERCENT), fee, `${cls} ${zone} service fee`);
      assert.equal(fare + fee + tolls, total, `${cls} ${zone} sum`);
      assert.equal(tolls, tollsAt(zone), `${cls} ${zone} tolls`);
      assert.deepEqual(priceLeg(rateKey(cls), zone), { fare, fee, tolls, total }, `${cls} ${zone}`);
    }
  }
  assert.deepEqual(Object.keys(CLASSES).map((cls) => [AIRPORT_TOTALS[rateKey(cls)].jfk, AIRPORT_TOTALS[rateKey(cls)].lga]), [[18500, 16500], [22000, 19000], [31000, 25000], [17000, 14500], [25000, 21500], [45000, 45000]]);
  for (const cls of Object.keys(TABLE)) {
    const [jfkFare, jfkFee] = figures(cls, "jfk");
    const [tebFare, tebFee] = figures(cls, "teb");
    if (cls === "sprinter") {
      assert.equal(tebFare + tebFee, jfkFare + jfkFee + 2500, `${cls}: the Executive Sprinter costs $25 more at Teterboro`);
      assert.equal(AIRPORT_TOTALS[rateKey(cls)].teb, AIRPORT_TOTALS[rateKey(cls)].jfk + 2500, cls);
      assert.equal(AIRPORT_TOTALS[rateKey(cls)].ewr, AIRPORT_TOTALS[rateKey(cls)].teb + 1000, cls);
      continue;
    }
    assert.deepEqual([tebFare, tebFee], [jfkFare, jfkFee], `${cls}: Teterboro splits like JFK`);
    assert.equal(AIRPORT_TOTALS[rateKey(cls)].teb, AIRPORT_TOTALS[rateKey(cls)].jfk, cls);
    assert.equal(AIRPORT_TOTALS[rateKey(cls)].ewr, cls === "electric" ? 25000 : AIRPORT_TOTALS[rateKey(cls)].jfk + 1000, cls);
  }
  assert.deepEqual(AIRPORT_TOTALS.electric, { jfk: 25000, lga: 21500, ewr: 25000, teb: 25000 });
});

await test("Newark to New York City in a Business SUV is $195.00 fixed: Fare $153.75, Service fee $18.45 (12% of the fare to the cent) and Tolls and airport fees $22.80, the owner's $16.79 crossing and $5.71 Turnpike estimate, in both directions", async () => {
  assert.deepEqual(priceLeg("suv", "ewr"), { fare: 15375, fee: 1845, tolls: 2280, total: 19500 });
  assert.equal(percentCents(15375, FEE_PERCENT), 1845);
  assert.equal(1679 + 571, 2250);
  assert.equal(EWR_TOLLS, 2280);
  for (const fields of [toAirport("ewr"), fromAirport("ewr")]) {
    const { price } = await priced(fields);
    assert.deepEqual(pairs(price.lines), [["Fare", 15375], ["Service fee", 1845], ["Tolls and airport fees", 2280]]);
    assert.equal(price.total, 19500);
  }
});

await test("the owner's Sprinter airport table: each of the five Sprinters has its own one-way total to JFK, Newark, Teterboro and LaGuardia, split into fare, service fee and tolls, with no White Luxury Limo Sprinter price at LaGuardia", () => {
  assert.deepEqual(Object.keys(SPRINTERS), Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === "sprinter"));
  assert.deepEqual(Object.fromEntries(Object.entries(SPRINTERS).map(([key, row]) => [key, Object.fromEntries(Object.entries(row).map(([zone, figures]) => [zone, figures[3]]))])), {
    "sprinter-executive": { jfk: 45000, lga: 45000, ewr: 48500, teb: 47500 },
    "sprinter-luxury-jet": { jfk: 57500, lga: 55000, ewr: 60500, teb: 59500 },
    "sprinter-presidential": { jfk: 65000, lga: 62500, ewr: 68500, teb: 67500 },
    "sprinter-limo": { jfk: 70000, lga: 67500, ewr: 73500, teb: 72500 },
    "sprinter-white-limo": { jfk: 75000, ewr: 78500, teb: 77500 },
  });
  for (const [key, row] of Object.entries(SPRINTERS)) {
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[key]), Object.keys(row), key);
    assert.deepEqual(Object.keys(AIRPORT_FARES[key]), Object.keys(row), key);
    for (const [zone, [fare, fee, tolls, total]] of Object.entries(row)) {
      assert.deepEqual([AIRPORT_FARES[key][zone], AIRPORT_TOTALS[key][zone]], [fare, total], `${key} ${zone}`);
      assert.deepEqual(priceLeg(key, zone), { fare, fee, tolls, total }, `${key} ${zone}`);
      assert.equal(percentCents(fare, FEE_PERCENT), fee, `${key} ${zone} service fee`);
      assert.equal(tolls, tollsAt(zone), `${key} ${zone}: the same tolls and airport fees as every class at that airport`);
    }
  }
  assert.equal("lga" in AIRPORT_TOTALS["sprinter-white-limo"], false);
  assert.equal("lga" in AIRPORT_FARES["sprinter-white-limo"], false);
});

for (const [key, row] of Object.entries(SPRINTERS)) {
  for (const zone of AIRPORT_PLACES) {
    for (const [direction, fields] of [["to", toAirport(zone, { class: "sprinter", sprinter: key, passengers: String(VEHICLES[key].seats) })], ["from", fromAirport(zone, { class: "sprinter", sprinter: key, passengers: String(VEHICLES[key].seats) })]]) {
      await test(`${VEHICLES[key].name} ${direction} ${zone}: ${row[zone] ? `the three lines of one leg and a total of ${row[zone][3]}` : "no price online, we send a price"}`, async () => {
        if (!row[zone]) {
          const { check } = await build(fields);
          assert.deepEqual(check, { kind: "price", reason: "sprinter-price", hold: "" });
          return;
        }
        const [fare, fee, tolls, total] = row[zone];
        const { trip, price } = await priced(fields);
        assert.equal(trip.vehicle, key);
        assert.deepEqual(pairs(price.lines), [["Fare", fare], ["Service fee", fee], ["Tolls and airport fees", tolls]]);
        assert.deepEqual([price.total, sum(price.lines), price.service], [total, total, "airport"]);
      });
    }
  }
}

for (const cls of Object.keys(CLASSES)) {
  for (const zone of AIRPORT_PLACES) {
    for (const [direction, fields] of [["to", toAirport(zone, { class: cls })], ["from", fromAirport(zone, { class: cls })]]) {
      await test(`${CLASSES[cls].name} ${direction} ${zone}: the four lines of one leg and a total of ${totalOf(cls, zone)}`, async () => {
        const { price } = await priced(fields);
        assert.deepEqual(pairs(price.lines), legOf(cls, zone));
        assert.equal(price.total, totalOf(cls, zone));
        assert.equal(sum(price.lines), price.total);
        assert.equal(price.service, "airport");
      });
    }
  }
}

await test("a Brooklyn address prices the same as Manhattan", async () => {
  const { price } = await priced({ ...toAirport("lga"), from_text: BROOKLYN });
  assert.deepEqual(pairs(price.lines), legOf("suv", "lga"));
  assert.equal(price.total, 16500);
  const manhattan = await priced(toAirport("lga"));
  assert.deepEqual(pairs(manhattan.price.lines), pairs(price.lines));
});

await test("every class and airport has a fare and a total, and the tolls remainder is at least 0", () => {
  assert.deepEqual(Object.keys(AIRPORT_FARES), RATE_KEYS);
  assert.deepEqual(Object.keys(AIRPORT_TOTALS), RATE_KEYS);
  assert.deepEqual(RATE_KEYS, [...Object.keys(CLASSES).filter((cls) => cls !== "sprinter"), ...Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === "sprinter")]);
  for (const cls of Object.keys(CLASSES)) {
    assert.deepEqual(Object.keys(AIRPORT_FARES[rateKey(cls)]), AIRPORT_PLACES);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[rateKey(cls)]), AIRPORT_PLACES);
    for (const zone of AIRPORT_PLACES) {
      const leg = priceLeg(rateKey(cls), zone);
      assert.ok(leg.tolls >= 0, `${cls} ${zone}`);
      assert.equal(leg.fare + leg.fee + leg.tolls, leg.total);
      assert.equal(leg.total, AIRPORT_TOTALS[rateKey(cls)][zone]);
      assert.deepEqual(pairs(legLines(rateKey(cls), zone).lines), legOf(cls, zone));
      assert.equal(legLines(rateKey(cls), zone).total, totalOf(cls, zone));
    }
  }
});

for (const [tip, cents] of [["10", 1538], ["15", 2307], ["20", 3076]]) {
  await test(`a ${tip}% tip adds ${cents} with the label "Gratuity for your chauffeur (${tip}%)"`, async () => {
    const { price } = await priced(toAirport("jfk", { tip }));
    assert.deepEqual(pairs(price.lines), [...LEG, [`Gratuity for your chauffeur (${tip}%)`, cents]]);
    assert.equal(price.tip, cents);
    assert.equal(price.tipPercent, Number(tip));
    assert.equal(price.total, 18500 + cents);
  });
}

await test("tip 0, an empty tip and no tip add no line", async () => {
  for (const extra of [{ tip: "0" }, { tip: "" }, {}]) {
    const { price } = await priced(toAirport("jfk", extra));
    assert.deepEqual(pairs(price.lines), LEG);
    assert.equal(price.total, 18500);
  }
});

await test("TIP_PERCENTS is 0, 10, 15, 20 and 25, and any other tip is the invalid code tip", async () => {
  assert.deepEqual(TIP_PERCENTS, [0, 10, 15, 20, 25]);
  for (const tip of ["5", "30", "abc", "15.5", "-10"]) assert.deepEqual((await build(toAirport("jfk", { tip }))).check, { kind: "invalid", code: "tip" });
});

await test("TIP_CUSTOM is $1 to $999,999.99 in cents, Stripe's maximum for one payment, and a custom 40 on a JFK Business SUV adds Gratuity for your chauffeur 4000 for a total of 22500", async () => {
  assert.deepEqual([TIP_CUSTOM, STRIPE_MAX_CENTS], [{ min: 100, max: 99999999 }, 99999999]);
  const { price } = await priced(toAirport("jfk", { tip: "custom", tip_amount: "40" }));
  assert.deepEqual(pairs(price.lines), [...LEG, ["Gratuity for your chauffeur", 4000]]);
  assert.deepEqual([price.tip, price.tipPercent, price.total, price.value], [4000, 0, 22500, 15379]);
  assert.equal(sum(price.lines), price.total);
  const pickup = await priced(fromAirport("jfk", { tip: "custom", tip_amount: "40", meet: "1" }));
  assert.deepEqual(pairs(pickup.price.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur", 4000]]);
  assert.deepEqual([pickup.price.total, pickup.price.value], [25000, 17879]);
});

await test("a custom gratuity of 1, 500, 501 and 999999 passes, and 0, 1000000, 40.5, -1, empty and abc are the invalid code tip_amount", async () => {
  for (const [tip_amount, total] of [["1", 18600], ["500", 68500], ["501", 68600], ["999999", 100018400], ["040", 22500]]) assert.equal((await priced(toAirport("jfk", { tip: "custom", tip_amount }))).price.total, total, tip_amount);
  for (const tip_amount of ["0", "1000000", "40.5", "-1", "", "abc"]) assert.deepEqual((await build(toAirport("jfk", { tip: "custom", tip_amount }))).check, { kind: "invalid", code: "tip_amount" }, tip_amount);
  assert.deepEqual((await build(toAirport("jfk", { tip: "custom" }))).check, { kind: "invalid", code: "tip_amount" });
  const { price } = await priced(toAirport("jfk", { tip: "20", tip_amount: "40" }));
  assert.deepEqual(pairs(price.lines).at(-1), ["Gratuity for your chauffeur (20%)", 3076]);
});

await test("a custom gratuity by the hour adds the same fixed amount and the same checks", async () => {
  const hourly = { ...BASE, trip_type: "hour", from_text: MANHATTAN, hours: "3", class: "sedan", tip: "custom" };
  const { price } = await priced({ ...hourly, tip_amount: "40" });
  assert.deepEqual(pairs(price.lines), [["Fare, 3 hours", 25500], ["Service fee", 3060], ["Gratuity for your chauffeur", 4000]]);
  assert.deepEqual([price.total, price.tipPercent, price.value], [28560 + 4000, 0, 25500]);
  for (const tip_amount of ["0", "1000000", "40.5", "-1", "", "abc"]) assert.deepEqual((await build({ ...hourly, tip_amount })).check, { kind: "invalid", code: "tip_amount" }, tip_amount);
});

await test("a custom gratuity is the same in every class total and every hourly vehicle, a percent follows each fare", async () => {
  const { trip } = await priced(toAirport("jfk", { tip: "custom", tip_amount: "40" }));
  for (const cls of Object.keys(CLASSES)) assert.equal(classTotal(trip, cls), AIRPORT_TOTALS[rateKey(cls)].jfk + 4000, cls);
  const percent = await priced(toAirport("jfk", { tip: "20" }));
  for (const cls of Object.keys(CLASSES)) assert.equal(classTotal(percent.trip, cls), AIRPORT_TOTALS[rateKey(cls)].jfk + percentCents(AIRPORT_FARES[rateKey(cls)].jfk, "20"), cls);
  const hourly = await priced({ ...BASE, trip_type: "hour", from_text: MANHATTAN, hours: "3", class: "suv", vehicle: "suv-denali", tip: "custom", tip_amount: "40" });
  for (const [cls, total] of [["suv", 33600], ["premium", 35280], ["first", 58800], ["sedan", 28560], ["electric", 42000], ["sprinter", null]]) assert.equal(classTotal(hourly.trip, cls), total && total + 4000, cls);
  for (const [vehicle, total] of [["suv-suburban", 31920], ["suv-denali", 33600], ["suv-navigator", 33600]]) assert.equal(priceTrip({ ...hourly.trip, vehicle }, ON).total, total + 4000, vehicle);
});

await test("airport plus 15% tip totals 20807, plus meet and greet 23307", async () => {
  assert.equal((await priced(fromAirport("jfk", { tip: "15" }))).price.total, 20807);
  const { price } = await priced(fromAirport("jfk", { tip: "15", meet: "1" }));
  assert.deepEqual(pairs(price.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(price.total, 23307);
  assert.equal(sum(price.lines), price.total);
});

await test("meet and greet adds 2500 only on priced airport pickups", async () => {
  assert.equal(MEET_AND_GREET, 2500);
  for (const zone of AIRPORT_PLACES) {
    const pickup = await priced(fromAirport(zone, { meet: "1" }));
    assert.equal(pickup.price.meet, 2500, zone);
    assert.equal(pickup.price.total, totalOf("suv", zone) + 2500, zone);
    const dropoff = await priced(toAirport(zone, { meet: "1" }));
    assert.equal(dropoff.price.meet, 0, zone);
    assert.equal(dropoff.price.total, totalOf("suv", zone), zone);
  }
});

await test("the gratuity is a percent of the class fare with its cents: First Class at LaGuardia 15% is 3177, Executive Sedan at LaGuardia 10% is 1181, Electric Class at LaGuardia 10% is 1806", async () => {
  const first = await priced(fromAirport("lga", { class: "first", tip: "15" }));
  assert.deepEqual(pairs(first.price.lines), [...legOf("first", "lga"), ["Gratuity for your chauffeur (15%)", 3177]]);
  assert.equal(first.price.total, 25000 + 3177);
  const sedan = await priced(toAirport("lga", { class: "sedan", tip: "10" }));
  assert.equal(sedan.price.tip, 1181);
  assert.equal(sedan.price.total, 14500 + 1181);
  const electric = await priced(toAirport("lga", { class: "electric", tip: "10" }));
  assert.deepEqual(pairs(electric.price.lines), [...legOf("electric", "lga"), ["Gratuity for your chauffeur (10%)", 1806]]);
  assert.equal(electric.price.total, 21500 + 1806);
});

const HOURLY = [
  ["sedan", "sedan", "3", [25500, 3060], 28560],
  ["electric", "electric", "3", [37500, 4500], 42000],
  ["electric", "electric", "4", [50000, 6000], 56000],
  ["electric", "electric", "12", [150000, 18000], 168000],
  ["suv", "suv-suburban", "3", [28500, 3420], 31920],
  ["suv", "suv-denali", "3", [30000, 3600], 33600],
  ["suv", "suv-navigator", "3", [30000, 3600], 33600],
  ["premium", "premium", "3", [31500, 3780], 35280],
  ["first", "first", "3", [52500, 6300], 58800],
  ["first", "first", "12", [210000, 25200], 235200],
  ["premium", "premium", "4", [42000, 5040], 47040],
];

for (const [cls, vehicle, hours, [fare, fee], total] of HOURLY) {
  await test(`hourly ${vehicle} for ${hours} hours: ${fare} + ${fee} = ${total}`, async () => {
    const { trip, price } = await priced({ ...BASE, trip_type: "hour", from_text: MANHATTAN, hours, class: cls, vehicle });
    assert.equal(trip.vehicle, vehicle);
    assert.equal(fee, percentCents(fare, FEE_PERCENT));
    assert.deepEqual(pairs(price.lines), [["Fare, " + hours + " hours", fare], ["Service fee", fee]]);
    assert.equal(price.total, total);
    assert.equal(price.tolls, 0);
    assert.equal(price.service, "hourly");
    assert.deepEqual(pairs(hourlyLines(vehicle, hours).lines), pairs(price.lines));
    assert.equal(hourlyLines(vehicle, hours).total, total);
  });
}

await test("hourly tip is a percent of the hourly fare only", async () => {
  const { price } = await priced({ ...BASE, trip_type: "hour", from_text: MANHATTAN, hours: "3", class: "sedan", tip: "20" });
  assert.deepEqual(pairs(price.lines).at(-1), ["Gratuity for your chauffeur (20%)", 5100]);
  assert.equal(price.total, 28560 + 5100);
});

await test("the Electric Class costs more because it is harder to find a driver: $250 at JFK, Newark and Teterboro, $215 at LaGuardia, $125 an hour, and its distance cards are the old ones times 250/180 rounded to the cent, with the same waiting charge as the Executive Sedan", () => {
  assert.deepEqual(CLASSES.electric, { name: "Electric Class", seats: 3, bags: "" });
  assert.deepEqual(VEHICLES.electric, { cls: "electric", model: "Cadillac Lyriq or similar", hourly: 12500 });
  assert.deepEqual(CLASSES.sedan, { name: "Executive Sedan", seats: 3, bags: "" });
  assert.deepEqual(VEHICLES.sedan, { cls: "sedan", model: "Mercedes-Benz E-Class or similar", hourly: 8500 });
  assert.deepEqual(AIRPORT_TOTALS.electric, { jfk: 25000, lga: 21500, ewr: 25000, teb: 25000 });
  assert.deepEqual(AIRPORT_TOTALS.sedan, { jfk: 17000, lga: 14500, ewr: 18000, teb: 17000 });
  const old = { base: 7647, mile: 318, minute: 53, minimum: 7647 };
  const oldLong = { base: 0, mile: 370, minute: 20 };
  assert.deepEqual(DISTANCE_RATES.electric, Object.fromEntries(Object.entries(old).map(([k, v]) => [k, Math.round((v * 250) / 180)])));
  assert.deepEqual(DISTANCE_RATES.electric, { base: 10621, mile: 442, minute: 74, minimum: 10621 });
  assert.deepEqual(LONG_RATES.electric, Object.fromEntries(Object.entries(oldLong).map(([k, v]) => [k, Math.round((v * 250) / 180)])));
  assert.deepEqual(LONG_RATES.electric, { base: 0, mile: 514, minute: 28 });
  assert.equal(WAIT_CENTS_PER_MINUTE.electric, WAIT_CENTS_PER_MINUTE.sedan);
  assert.equal(TOLL_CLASS.electric, TOLL_CLASS.sedan);
  assert.equal(CLASS_DEFAULT_VEHICLE.electric, "electric");
  assert.deepEqual(Object.keys(CLASSES).slice(3, 5), ["sedan", "electric"]);
});

await test("the return example: Fare 30758, service fee 3690, tolls 2552, total 37000, 15% tip 4614", async () => {
  const fields = fromAirport("jfk", { return: "1", return_date: "2026-10-18", return_time: "18:00" });
  const { trip, price } = await priced(fields);
  assert.equal(trip.legs.length, 2);
  assert.deepEqual(pairs(price.lines), [["Fare", 30758], ["Service fee", 3690], ["Tolls and airport fees", 2552]]);
  assert.equal(price.total, 37000);
  assert.deepEqual(price.legs.map((leg) => leg.total), [18500, 18500]);
  const tipped = await priced({ ...fields, tip: "15" });
  assert.equal(tipped.price.tip, 4614);
  assert.equal(tipped.price.total, 41614);
});

await test("a stop trip whose legs are all airport transfers, JFK by a Manhattan stop to LaGuardia, is no longer the sum of its legs: it takes the stop rule, so with no price for the trip between the two airports it is priced over its whole route at no less than the JFK fare, and without the route it stays with dispatch", async () => {
  const fields = { ...BASE, from_text: AIRPORT_ROW.jfk.label, from_id: "jfk", stop1_text: MANHATTAN, to_text: AIRPORT_ROW.lga.label, to_id: "lga" };
  assert.deepEqual((await build(fields)).check, { kind: "quote", reason: "stop-leg", field: "" });
  process.env.GOOGLE_MOCK = "true";
  try {
    const { trip, price } = await priced(fields);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.stops, leg.ride, leg.plain]), [["jfk", "lga", 1, { tenths: 168, minutes: 43 }, undefined]]);
    assert.deepEqual(pairs(price.lines), [["Fare", 18015], ["Service fee", 2162]]);
    assert.deepEqual([price.total, price.stops, price.tolls, price.service], [20177, 0, 0, "distance"]);
    assert.ok(price.fare >= AIRPORT_FARES.suv.jfk);
    assert.ok(price.total < 18500 + 16500);
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("a stop trip with a non-airport leg is stop-leg", async () => {
  const { check } = await build({ ...BASE, from_text: AIRPORT_ROW.jfk.label, from_id: "jfk", stop1_text: MANHATTAN, to_text: BROOKLYN });
  assert.deepEqual(check, { kind: "quote", reason: "stop-leg", field: "" });
});

await test("the Stripe params of an airport trip: one line item per shown line, Fare, Service fee and Tolls, amounts summing to 18500, names equal to the labels the site shows, no tax_rates, and the fee in tax_cents with no bcf_cents", async () => {
  const { trip, price } = await priced(toAirport("jfk"));
  const params = sessionParams(trip, price, bookingRef("airport-total-0001"), ON, NOW, "https://www.nycluxride.com");
  const keys = [...params.keys()];
  assert.ok(!keys.some((key) => key.includes("tax_rates")), keys.filter((key) => key.includes("tax")).join(","));
  const count = new Set(keys.filter((key) => key.startsWith("line_items[")).map((key) => key.split("]")[0])).size;
  const shown = shownLines(price.lines);
  assert.deepEqual(pairs(shown), [["Fare", 15379], ["Service fee", 1845], ["Tolls", 1276]]);
  assert.equal(count, shown.length);
  let total = 0;
  shown.forEach((entry, i) => {
    assert.equal(params.get(`line_items[${i}][quantity]`), "1");
    assert.equal(params.get(`line_items[${i}][price_data][product_data][name]`), entry.label);
    assert.equal(Number(params.get(`line_items[${i}][price_data][unit_amount]`)), entry.cents);
    total += Number(params.get(`line_items[${i}][price_data][unit_amount]`));
  });
  assert.equal(total, 18500);
  assert.equal(params.get("metadata[total_cents]"), "18500");
  assert.deepEqual([params.get("metadata[fare_cents]"), params.get("metadata[tax_cents]"), params.get("metadata[bcf_cents]"), params.get("metadata[tolls_cents]")], ["15379", "1845", null, "1276"]);
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall airport total tests pass");
