import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceLeg, legLines, hourlyLines, bookingRef, classTotal } from "../api/_trip.mjs";
import { sessionParams } from "../api/_stripe.mjs";
import { AIRPORT_FARES, AIRPORT_TOTALS, AIRPORT_PLACES, CLASSES, MEET_AND_GREET, percentCents, NYC_TAX_PERCENT, BCF_PERCENT, TIP_PERCENTS, TIP_CUSTOM } from "../api/_rates.mjs";
import { PLACE_LIST } from "../api/_places.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const BROOKLYN = "277 Bedford Ave, Brooklyn, NY 11211";
const TOLLS = 1275;
const TABLE = {
  suv: { name: "Business SUV", far: [15500, 1376, 349, 18500], lga: [13701, 1216, 308, 16500] },
  premium: { name: "Business Premium SUV", far: [18650, 1655, 420, 22000], lga: [15950, 1416, 359, 19000] },
  first: { name: "First Class", far: [26749, 2374, 602, 31000], lga: [21350, 1895, 480, 25000] },
  sedan: { name: "Sedan & Electric", far: [14151, 1256, 318, 17000], lga: [11901, 1056, 268, 14500] },
  sprinter: { name: "Luxury Sprinter", far: [34848, 3093, 784, 40000], lga: [30349, 2693, 683, 35000] },
};
const figures = (cls, zone) => TABLE[cls][zone === "lga" ? "lga" : "far"];
const legOf = (cls, zone) => {
  const [fare, tax, bcf] = figures(cls, zone);
  return [["Fare", fare], ["NYC sales tax (8.875%)", tax], ["Black Car Fund (2.25%)", bcf], ["Tolls and airport fees", TOLLS]];
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
  assert.equal(check.reason, "", JSON.stringify(check));
  return { trip, price: priceTrip(trip, ON) };
}

const toAirport = (zone, extra = {}) => ({ ...BASE, from_text: MANHATTAN, to_text: AIRPORT_ROW[zone].label, to_id: zone, ...extra });
const fromAirport = (zone, extra = {}) => ({ ...BASE, from_text: AIRPORT_ROW[zone].label, from_id: zone, to_text: MANHATTAN, ...extra });

await test("percentCents rounds the half cent up and is exact: 15500 at 8.875 is 1376, at 2.25 is 349", () => {
  assert.equal(percentCents(15500, NYC_TAX_PERCENT), 1376);
  assert.equal(percentCents(15500, BCF_PERCENT), 349);
  assert.equal(percentCents(15500, "10"), 1550);
  assert.equal(percentCents(15500, "15"), 2325);
  assert.equal(percentCents(15500, "20"), 3100);
  assert.equal(percentCents(30000, NYC_TAX_PERCENT), 2663);
  assert.equal(percentCents(0, NYC_TAX_PERCENT), 0);
});

await test("the owner's table: five classes in order, every fare and total exact, tax and Black Car Fund from the fare, $12.75 tolls on every leg", () => {
  assert.deepEqual(Object.keys(CLASSES), ["suv", "premium", "first", "sedan", "sprinter"]);
  assert.deepEqual(Object.values(CLASSES).map((c) => c.name), Object.values(TABLE).map((c) => c.name));
  assert.deepEqual(AIRPORT_PLACES, ["jfk", "lga", "ewr", "teb"]);
  for (const cls of Object.keys(TABLE)) {
    for (const zone of AIRPORT_PLACES) {
      const [fare, tax, bcf, total] = figures(cls, zone);
      assert.equal(AIRPORT_FARES[cls][zone], fare, `${cls} ${zone} fare`);
      assert.equal(AIRPORT_TOTALS[cls][zone], total, `${cls} ${zone} total`);
      assert.equal(percentCents(fare, NYC_TAX_PERCENT), tax, `${cls} ${zone} tax`);
      assert.equal(percentCents(fare, BCF_PERCENT), bcf, `${cls} ${zone} Black Car Fund`);
      assert.equal(fare + tax + bcf + TOLLS, total, `${cls} ${zone} sum`);
      assert.equal(priceLeg(cls, zone).tolls, TOLLS, `${cls} ${zone} tolls`);
    }
  }
  assert.deepEqual(Object.values(AIRPORT_TOTALS).map((t) => [t.jfk, t.lga]), [[18500, 16500], [22000, 19000], [31000, 25000], [17000, 14500], [40000, 35000]]);
});

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
  assert.deepEqual(Object.keys(AIRPORT_FARES), Object.keys(CLASSES));
  assert.deepEqual(Object.keys(AIRPORT_TOTALS), Object.keys(CLASSES));
  for (const cls of Object.keys(CLASSES)) {
    assert.deepEqual(Object.keys(AIRPORT_FARES[cls]), AIRPORT_PLACES);
    assert.deepEqual(Object.keys(AIRPORT_TOTALS[cls]), AIRPORT_PLACES);
    for (const zone of AIRPORT_PLACES) {
      const leg = priceLeg(cls, zone);
      assert.ok(leg.tolls >= 0, `${cls} ${zone}`);
      assert.equal(leg.fare + leg.tax + leg.bcf + leg.tolls, leg.total);
      assert.equal(leg.total, AIRPORT_TOTALS[cls][zone]);
      assert.deepEqual(pairs(legLines(cls, zone).lines), legOf(cls, zone));
      assert.equal(legLines(cls, zone).total, totalOf(cls, zone));
    }
  }
});

for (const [tip, cents] of [["10", 1550], ["15", 2325], ["20", 3100]]) {
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

await test("TIP_PERCENTS is 0, 10, 15 and 20, and any other tip is the invalid code tip", async () => {
  assert.deepEqual(TIP_PERCENTS, [0, 10, 15, 20]);
  for (const tip of ["5", "25", "abc", "15.5", "-10"]) assert.deepEqual((await build(toAirport("jfk", { tip }))).check, { kind: "invalid", code: "tip" });
});

await test("TIP_CUSTOM is $1 to $500 in cents, and a custom 40 on a JFK Business SUV adds Gratuity for your chauffeur 4000 for a total of 22500", async () => {
  assert.deepEqual(TIP_CUSTOM, { min: 100, max: 50000 });
  const { price } = await priced(toAirport("jfk", { tip: "custom", tip_amount: "40" }));
  assert.deepEqual(pairs(price.lines), [...LEG, ["Gratuity for your chauffeur", 4000]]);
  assert.deepEqual([price.tip, price.tipPercent, price.total, price.value], [4000, 0, 22500, 15500]);
  assert.equal(sum(price.lines), price.total);
  const pickup = await priced(fromAirport("jfk", { tip: "custom", tip_amount: "40", meet: "1" }));
  assert.deepEqual(pairs(pickup.price.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur", 4000]]);
  assert.deepEqual([pickup.price.total, pickup.price.value], [25000, 18000]);
});

await test("a custom gratuity of 1 and of 500 passes, and 0, 501, 40.5, -1, empty and abc are the invalid code tip_amount", async () => {
  for (const [tip_amount, total] of [["1", 18600], ["500", 68500], ["040", 22500]]) assert.equal((await priced(toAirport("jfk", { tip: "custom", tip_amount }))).price.total, total, tip_amount);
  for (const tip_amount of ["0", "501", "40.5", "-1", "", "abc"]) assert.deepEqual((await build(toAirport("jfk", { tip: "custom", tip_amount }))).check, { kind: "invalid", code: "tip_amount" }, tip_amount);
  assert.deepEqual((await build(toAirport("jfk", { tip: "custom" }))).check, { kind: "invalid", code: "tip_amount" });
  const { price } = await priced(toAirport("jfk", { tip: "20", tip_amount: "40" }));
  assert.deepEqual(pairs(price.lines).at(-1), ["Gratuity for your chauffeur (20%)", 3100]);
});

await test("a custom gratuity by the hour adds the same fixed amount and the same checks", async () => {
  const hourly = { ...BASE, trip_type: "hour", from_text: MANHATTAN, hours: "3", class: "sedan", tip: "custom" };
  const { price } = await priced({ ...hourly, tip_amount: "40" });
  assert.deepEqual(pairs(price.lines), [["Fare, 3 hours", 25500], ["NYC sales tax (8.875%)", 2263], ["Black Car Fund (2.25%)", 574], ["Gratuity for your chauffeur", 4000]]);
  assert.deepEqual([price.total, price.tipPercent, price.value], [28337 + 4000, 0, 25500]);
  for (const tip_amount of ["0", "501", "40.5", "-1", "", "abc"]) assert.deepEqual((await build({ ...hourly, tip_amount })).check, { kind: "invalid", code: "tip_amount" }, tip_amount);
});

await test("a custom gratuity is the same in every class total and every hourly vehicle, a percent follows each fare", async () => {
  const { trip } = await priced(toAirport("jfk", { tip: "custom", tip_amount: "40" }));
  for (const cls of Object.keys(CLASSES)) assert.equal(classTotal(trip, cls), AIRPORT_TOTALS[cls].jfk + 4000, cls);
  const percent = await priced(toAirport("jfk", { tip: "20" }));
  for (const cls of Object.keys(CLASSES)) assert.equal(classTotal(percent.trip, cls), AIRPORT_TOTALS[cls].jfk + percentCents(AIRPORT_FARES[cls].jfk, "20"), cls);
  const hourly = await priced({ ...BASE, trip_type: "hour", from_text: MANHATTAN, hours: "3", class: "suv", vehicle: "suv-denali", tip: "custom", tip_amount: "40" });
  for (const [cls, total] of [["suv", 33338], ["premium", 35005], ["first", 58340], ["sedan", 28337], ["sprinter", null]]) assert.equal(classTotal(hourly.trip, cls), total && total + 4000, cls);
  for (const [vehicle, total] of [["suv-suburban", 31670], ["suv-denali", 33338], ["suv-navigator", 33338]]) assert.equal(priceTrip({ ...hourly.trip, vehicle }, ON).total, total + 4000, vehicle);
});

await test("airport plus 15% tip totals 20825, plus meet and greet 23325", async () => {
  assert.equal((await priced(fromAirport("jfk", { tip: "15" }))).price.total, 20825);
  const { price } = await priced(fromAirport("jfk", { tip: "15", meet: "1" }));
  assert.deepEqual(pairs(price.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2325]]);
  assert.equal(price.total, 23325);
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

await test("the gratuity is a percent of the class fare with its cents: First Class at LaGuardia 15% is 3203, Sedan & Electric at LaGuardia 10% is 1190", async () => {
  const first = await priced(fromAirport("lga", { class: "first", tip: "15" }));
  assert.deepEqual(pairs(first.price.lines), [...legOf("first", "lga"), ["Gratuity for your chauffeur (15%)", 3203]]);
  assert.equal(first.price.total, 25000 + 3203);
  const sedan = await priced(toAirport("lga", { class: "sedan", tip: "10" }));
  assert.equal(sedan.price.tip, 1190);
  assert.equal(sedan.price.total, 14500 + 1190);
});

const HOURLY = [
  ["sedan", "sedan", "3", [25500, 2263, 574], 28337],
  ["suv", "suv-suburban", "3", [28500, 2529, 641], 31670],
  ["suv", "suv-denali", "3", [30000, 2663, 675], 33338],
  ["suv", "suv-navigator", "3", [30000, 2663, 675], 33338],
  ["premium", "premium", "3", [31500, 2796, 709], 35005],
  ["first", "first", "3", [52500, 4659, 1181], 58340],
  ["first", "first", "12", [210000, 18638, 4725], 233363],
  ["premium", "premium", "4", [42000, 3728, 945], 46673],
];

for (const [cls, vehicle, hours, [fare, tax, bcf], total] of HOURLY) {
  await test(`hourly ${vehicle} for ${hours} hours: ${fare} + ${tax} + ${bcf} = ${total}`, async () => {
    const { trip, price } = await priced({ ...BASE, trip_type: "hour", from_text: MANHATTAN, hours, class: cls, vehicle });
    assert.equal(trip.vehicle, vehicle);
    assert.deepEqual(pairs(price.lines), [["Fare, " + hours + " hours", fare], ["NYC sales tax (8.875%)", tax], ["Black Car Fund (2.25%)", bcf]]);
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
  assert.equal(price.total, 28337 + 5100);
});

await test("the return example: Fare 31000, tax 2752, Black Car Fund 698, tolls 2550, total 37000, 15% tip 4650", async () => {
  const fields = fromAirport("jfk", { return: "1", return_date: "2026-10-18", return_time: "18:00" });
  const { trip, price } = await priced(fields);
  assert.equal(trip.legs.length, 2);
  assert.deepEqual(pairs(price.lines), [["Fare", 31000], ["NYC sales tax (8.875%)", 2752], ["Black Car Fund (2.25%)", 698], ["Tolls and airport fees", 2550]]);
  assert.equal(price.total, 37000);
  assert.deepEqual(price.legs.map((leg) => leg.total), [18500, 18500]);
  const tipped = await priced({ ...fields, tip: "15" });
  assert.equal(tipped.price.tip, 4650);
  assert.equal(tipped.price.total, 41650);
});

await test("a stop trip whose legs are all airport transfers prices as the sum of its legs", async () => {
  const { trip, price } = await priced({ ...BASE, from_text: AIRPORT_ROW.jfk.label, from_id: "jfk", stop1_text: MANHATTAN, to_text: AIRPORT_ROW.lga.label, to_id: "lga" });
  assert.equal(trip.legs.length, 2);
  assert.deepEqual(price.legs.map((leg) => leg.total), [18500, 16500]);
  assert.deepEqual(pairs(price.lines), [["Fare", 15500 + 13701], ["NYC sales tax (8.875%)", 1376 + 1216], ["Black Car Fund (2.25%)", 349 + 308], ["Tolls and airport fees", 2 * TOLLS]]);
  assert.equal(price.total, 35000);
});

await test("a stop trip with a non-airport leg is stop-leg", async () => {
  const { check } = await build({ ...BASE, from_text: AIRPORT_ROW.jfk.label, from_id: "jfk", stop1_text: MANHATTAN, to_text: BROOKLYN });
  assert.deepEqual(check, { kind: "quote", reason: "stop-leg", field: "" });
});

await test("the Stripe params of an airport trip: one line item per line, amounts summing to 18500, names equal to the labels, no tax_rates", async () => {
  const { trip, price } = await priced(toAirport("jfk"));
  const params = sessionParams(trip, price, bookingRef("airport-total-0001"), ON, NOW, "https://www.nycluxride.com");
  const keys = [...params.keys()];
  assert.ok(!keys.some((key) => key.includes("tax_rates")), keys.filter((key) => key.includes("tax")).join(","));
  const count = new Set(keys.filter((key) => key.startsWith("line_items[")).map((key) => key.split("]")[0])).size;
  assert.equal(count, price.lines.length);
  let total = 0;
  price.lines.forEach((entry, i) => {
    assert.equal(params.get(`line_items[${i}][quantity]`), "1");
    assert.equal(params.get(`line_items[${i}][price_data][product_data][name]`), entry.label);
    assert.equal(Number(params.get(`line_items[${i}][price_data][unit_amount]`)), entry.cents);
    total += Number(params.get(`line_items[${i}][price_data][unit_amount]`));
  });
  assert.equal(total, 18500);
  assert.equal(params.get("metadata[total_cents]"), "18500");
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall airport total tests pass");
