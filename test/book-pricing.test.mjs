import assert from "node:assert/strict";
import {
  readInput,
  readSettings,
  resolveTrip,
  checkTrip,
  priceTrip,
  legsOf,
  bookingRef,
  nycToUtc,
  formatDate,
  formatTime,
  composeMessage,
  contactLinks,
  fill,
  receipt,
  checkDetails,
  firstSlot,
  REF,
  distanceFare,
  priceDistance,
  withinLimits,
  serviceLabel,
  classTotal,
} from "../api/_trip.mjs";
import { ERRORS, REASONS, NOTES, POLICY } from "../api/_copy.mjs";
import { MIN_NOTICE_HOURS, AUTO_LEAD_MINUTES, DISTANCE_RATES, DISTANCE_AREAS, DISTANCE_LIMITS, DISTANCE_SKIP_ZIPS, AIRPORT_TOTALS, AIRPORT_FARES, AIRPORT_PLACES } from "../api/_rates.mjs";
import { ROUTE, routeKey, signRoute, readRoute, signTicket } from "../api/_ticket.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const BROOKLYN = "277 Bedford Ave, Brooklyn, NY 11211";
const BASE = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", action: "pay" };
const FROM_JFK = { ...BASE, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, to_id: "" };
const HOURLY = { trip_type: "hour", from_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "2", hours: "3", class: "sedan", action: "pay" };
const LEG = [["Fare", 15500], ["NYC sales tax (8.875%)", 1376], ["Black Car Fund (2.25%)", 349], ["Tolls and airport fees", 1275]];

const seenErrors = new Set();
const seenReasons = new Set();

async function run(fields, settings = ON, now = NOW) {
  const trip = await resolveTrip(readInput(fields), { now });
  const result = checkTrip(trip, now, settings);
  if (result.kind === "invalid") seenErrors.add(result.code);
  if (result.kind === "quote") seenReasons.add(result.reason);
  if (result.kind === "price" && result.reason) seenReasons.add(result.reason);
  if (result.kind === "price" && result.hold) seenReasons.add(result.hold);
  return { trip, result, price: result.kind === "price" && !result.reason ? priceTrip(trip, settings) : null };
}

async function priced(fields, settings = ON) {
  const out = await run(fields, settings);
  assert.deepEqual(out.result, { kind: "price", reason: "", hold: "" }, JSON.stringify(fields));
  return out.price;
}

const pairs = (lines) => lines.map(({ label, cents }) => [label, cents]);
const isError = async (fields, code, settings = ON, now = NOW) => assert.deepEqual((await run(fields, settings, now)).result, { kind: "invalid", code }, JSON.stringify(fields));
const isQuote = async (fields, reason, field = "", settings = ON, now = NOW) => assert.deepEqual((await run(fields, settings, now)).result, { kind: "quote", reason, field }, JSON.stringify(fields));
const isClass = async (fields, reason, settings = ON) => assert.deepEqual((await run(fields, settings)).result, { kind: "price", reason, hold: "" }, JSON.stringify(fields));
const isHold = async (fields, hold, settings = ON, now = NOW) => assert.deepEqual((await run(fields, settings, now)).result, { kind: "price", reason: "", hold }, JSON.stringify(fields));

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

const PRICED = [
  ["Manhattan to JFK, Business SUV", BASE, 18500],
  ["JFK Terminal 4 to Manhattan with meet and greet", { ...FROM_JFK, meet: "1" }, 21000],
  ["Brooklyn to LaGuardia, First Class", { ...BASE, from_text: BROOKLYN, to_text: "LaGuardia (LGA)", to_id: "lga", class: "first" }, 25000],
  ["LaGuardia to Manhattan, Business Premium SUV", { ...FROM_JFK, from_text: "LaGuardia (LGA)", from_id: "lga", class: "premium" }, 19000],
  ["Manhattan to Newark Terminal B, Sedan & Electric", { ...BASE, to_text: "Newark Liberty (EWR), Terminal B", to_id: "ewr-tb", class: "sedan" }, 17000],
  ["Teterboro Jet Aviation to Manhattan, Luxury Sprinter", { ...FROM_JFK, from_text: "Teterboro (TEB), Jet Aviation", from_id: "teb-jet", class: "sprinter" }, 40000],
  ["typed JFK alias to a typed Queens ZIP", { ...BASE, from_text: "jfk airport", to_text: "Astoria, NY 11102", to_id: "" }, 18500],
  ["Sedan & Electric, 3 hours", HOURLY, 28337],
  ["Chevrolet Suburban or similar, 3 hours", { ...HOURLY, class: "suv", vehicle: "suv-suburban" }, 31670],
  ["Business Premium SUV, Cadillac Escalade ESV, 4 hours", { ...HOURLY, class: "premium", hours: "4" }, 46673],
  ["First Class, 3 hours", { ...HOURLY, class: "first" }, 58340],
  ["First Class, 12 hours", { ...HOURLY, class: "first", hours: "12" }, 233363],
  ["the retired suv-escalade key prices the default Business SUV vehicle, 3 hours", { ...HOURLY, class: "suv", vehicle: "suv-escalade" }, 31670],
  ["hourly from JFK, Sedan & Electric, 3 hours", { ...HOURLY, from_text: "John F. Kennedy (JFK)", from_id: "jfk" }, 28337],
  ["hourly from LaGuardia, Sedan & Electric, 3 hours", { ...HOURLY, from_text: "LaGuardia (LGA)", from_id: "lga" }, 28337],
];

for (const [name, fields, total] of PRICED) {
  await test(`priced: ${name} is ${total} cents`, async () => assert.equal((await priced(fields)).total, total));
}

await test("the JFK drop-off lines, notes, value and service", async () => {
  const price = await priced(BASE);
  assert.deepEqual(pairs(price.lines), LEG);
  assert.deepEqual(price.notes, [NOTES.included, POLICY.later.airport]);
  assert.equal(NOTES.airport, NOTES.included + " " + POLICY.later.airport);
  assert.equal(price.value, 15500);
  assert.equal(price.service, "airport");
  assert.deepEqual([price.fare, price.tax, price.bcf, price.tolls, price.meet, price.tip, price.tipPercent], [15500, 1376, 349, 1275, 0, 0, 0]);
});

await test("the JFK pickup with meet and greet and a 15% tip: lines in the contract order, the tip on the fare only", async () => {
  const price = await priced({ ...FROM_JFK, meet: "1", tip: "15" });
  assert.deepEqual(pairs(price.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2325]]);
  assert.equal(price.total, 23325);
  assert.equal(price.value, 18000);
});

await test("hourly lines have no tolls line and the hourly note", async () => {
  const price = await priced({ ...HOURLY, class: "suv", vehicle: "suv-denali" });
  assert.deepEqual(pairs(price.lines), [["Fare, 3 hours", 30000], ["NYC sales tax (8.875%)", 2663], ["Black Car Fund (2.25%)", 675]]);
  assert.deepEqual(price.notes, [POLICY.later.hourly]);
  assert.equal(NOTES.hourly, POLICY.later.hourly);
  assert.equal(price.service, "hourly");
});

await test("hourly meet and greet is offered from JFK and LaGuardia only, one way from every priced airport, never on a drop-off", async () => {
  assert.equal((await priced({ ...HOURLY, from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "1" })).meet, 2500);
  assert.equal((await run({ ...HOURLY, meet: "1" })).trip.meet, false);
  for (const code of ["JFK", "LGA", "EWR", "TEB"]) {
    const { trip } = await run({ ...FROM_JFK, from_text: code, from_id: "", meet: "1" });
    assert.deepEqual([trip.meetOffered, trip.meet], [true, true], code);
  }
  assert.equal((await priced({ ...BASE, meet: "1" })).meet, 0);
  assert.equal((await run({ ...FROM_JFK, from_text: "Westchester County (HPN)", from_id: "hpn", meet: "1" })).trip.meet, false);
});

await test("the input codes of 7.3 in order: form, trip_type, from, to, date, date-past, return-date", async () => {
  await isError({ ...BASE, nlr_hp: "x" }, "form");
  await isError({ ...BASE, trip_type: "" }, "trip_type");
  await isError({ ...BASE, trip_type: "round" }, "trip_type");
  await isError({ ...BASE, from_text: "" }, "from");
  await isError({ ...BASE, from_text: "   " }, "from");
  await isError({ ...BASE, to_text: "" }, "to");
  await isError({ ...BASE, date: "" }, "date");
  await isError({ ...BASE, date: "2026-02-30" }, "date");
  await isError({ ...BASE, time: "7:30" }, "date");
  await isError({ ...BASE, time: "24:00" }, "date");
  await isError({ ...BASE, date: "2026-10-01", time: "11:59" }, "date-past");
  await isError({ ...BASE, date: "2026-10-01", time: "12:00" }, "date-past");
  await isError({ ...BASE, return: "1", return_date: "", return_time: "" }, "return-date");
  await isError({ ...BASE, return: "1", return_date: "2026-10-14", return_time: "07:30" }, "return-date");
  await isError({ ...BASE, return: "1", return_date: "2026-10-13", return_time: "20:00" }, "return-date");
  await isError({ ...BASE, return: "1", return_date: "2026-10-14", return_time: "7:31" }, "return-date");
});

await test("the input codes of 7.3 in order: passengers, hours, class, vehicle, flight, return_flight, tip", async () => {
  for (const passengers of ["", "0", "13", "two", "1.5"]) await isError({ ...BASE, passengers }, "passengers");
  await isError({ ...HOURLY, hours: "" }, "hours");
  await isError({ ...HOURLY, hours: "3.5" }, "hours");
  await isError({ ...BASE, class: "" }, "class");
  await isError({ ...BASE, class: "limo" }, "class");
  await isError({ ...BASE, class: "", action: "quote" }, "class");
  const trip = { ...(await run(HOURLY)).trip, vehicle: "suv-bus" };
  const result = checkTrip(trip, NOW, ON);
  assert.deepEqual(result, { kind: "invalid", code: "vehicle" });
  seenErrors.add(result.code);
  await isError({ ...FROM_JFK, flight: "DL#401" }, "flight");
  await isError({ ...FROM_JFK, flight: "X".repeat(21) }, "flight");
  await isError({ ...BASE, return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "DL_401" }, "return_flight");
  for (const tip of ["5", "100", "x", "15%", "Custom", "other"]) await isError({ ...BASE, tip }, "tip");
  for (const tip_amount of ["", "0", "00", "501", "40.5", "40.00", "$40", "-1", "abc", "1e3", "9".repeat(30)]) await isError({ ...BASE, tip: "custom", tip_amount }, "tip_amount");
  await isError({ ...BASE, tip: "custom", tip_amount: "40", return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "DL_401" }, "return_flight");
  await isError({ ...BASE, tip: "custom", tip_amount: "0", passengers: "0" }, "passengers");
  for (const tip_amount of ["1", "40", "040", "500"]) assert.equal((await run({ ...BASE, tip: "custom", tip_amount })).result.kind, "price", tip_amount);
});

await test("the options action falls back to Business SUV when class is missing or unknown, quote and pay do not", async () => {
  for (const cls of ["", "limo"]) {
    const { trip, result } = await run({ ...BASE, class: cls, action: "options" });
    assert.equal(trip.class, "suv");
    assert.equal(result.kind, "price");
  }
  assert.equal((await run({ ...HOURLY, class: "", action: "options" })).trip.vehicle, "suv-suburban");
  assert.deepEqual(readInput({ action: "options" }).action, "options");
  assert.deepEqual(readInput({ action: "quote" }).action, "quote");
  assert.deepEqual(readInput({ action: "price" }).action, "pay");
  assert.deepEqual(readInput({}).action, "pay");
});

await test("an empty or unknown end is unplaced with the field of that end", async () => {
  await isQuote({ ...BASE, from_text: "350 5th Ave" }, "unplaced", "from_text");
  await isQuote({ ...FROM_JFK, to_text: "The Plaza Hotel" }, "unplaced", "to_text");
  await isQuote({ ...BASE, stop1_text: "Kennedy" }, "unplaced", "stop1_text");
  await isQuote({ ...BASE, stop2_text: "Somewhere nice" }, "unplaced", "stop2_text");
  await isQuote({ ...HOURLY, from_text: "The Plaza Hotel" }, "unplaced", "from_text");
});

await test("legs without stops: airport-to-airport, no-airport, other-airport and outside-city", async () => {
  await isQuote({ ...BASE, from_text: "LaGuardia (LGA)", from_id: "lga" }, "airport-to-airport");
  await isQuote({ ...BASE, to_text: BROOKLYN, to_id: "" }, "no-airport");
  await isQuote({ ...BASE, to_text: "Westchester County (HPN)", to_id: "hpn" }, "other-airport");
  await isQuote({ ...FROM_JFK, to_text: "Hoboken, NJ 07030" }, "outside-city");
  await isQuote({ ...BASE, from_text: "Westchester County (HPN), Million Air", from_id: "hpn-million", to_text: MANHATTAN, to_id: "" }, "other-airport");
  await isQuote({ ...BASE, from_text: "Hoboken, NJ" }, "outside-city");
  await isQuote({ ...BASE, from_text: "Hoboken, NJ", return: "1", return_date: "2026-10-18", return_time: "18:00" }, "outside-city");
});

await test("stops: every leg priced gives the sum of the legs, any unpriced leg is stop-leg, an empty stop is ignored", async () => {
  const price = await priced({ ...BASE, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: BROOKLYN, stop2_text: "", to_text: "John F. Kennedy (JFK)", to_id: "jfk" });
  assert.equal(price.legs.length, 2);
  assert.deepEqual(price.legs.map((leg) => leg.total), [16500, 18500]);
  assert.equal(price.total, 35000);
  await isQuote({ ...BASE, stop1_text: BROOKLYN }, "stop-leg");
  await isQuote({ ...BASE, stop1_text: "Westchester County (HPN)", stop1_id: "hpn" }, "stop-leg");
  await isQuote({ ...FROM_JFK, stop1_text: "LaGuardia (LGA)", stop1_id: "lga" }, "stop-leg");
  await isQuote({ ...FROM_JFK, stop2_text: "Hoboken, NJ" }, "stop-leg");
  assert.equal((await priced({ ...BASE, stop1_text: "", stop2_text: "" })).total, 18500);
});

await test("legsOf: pickup to stop 1 to stop 2 to drop-off, plus the return leg reversed", async () => {
  const { trip } = await run({ ...FROM_JFK, stop1_text: "LaGuardia (LGA)", stop1_id: "lga", stop2_text: BROOKLYN, return: "1", return_date: "2026-10-18", return_time: "18:00" });
  assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back]), [["jfk", "lga", false], ["lga", "brooklyn", false], ["brooklyn", "manhattan", false], ["manhattan", "jfk", true]]);
  assert.deepEqual(legsOf({ ...trip, return: false }).length, 3);
  const { trip: one } = await run({ ...FROM_JFK, return: "1", return_date: "2026-10-18", return_time: "18:00" });
  assert.deepEqual(one.legs.map((leg) => [leg.airport, leg.direction, leg.reason]), [["jfk", "from-airport", ""], ["jfk", "to-airport", ""]]);
});

await test("hourly reasons: outside-hourly, hours-range, then the class reasons sprinter-hourly and seats", async () => {
  for (const from_text of ["Newark Liberty (EWR)", "Teterboro (TEB)", "Hoboken, NJ", "Westchester County (HPN)"]) await isQuote({ ...HOURLY, from_text }, "outside-hourly");
  await isQuote({ ...HOURLY, hours: "2" }, "hours-range");
  await isQuote({ ...HOURLY, hours: "13" }, "hours-range");
  assert.equal((await priced({ ...HOURLY, hours: "12" })).fare, 102000);
  await isClass({ ...HOURLY, class: "sprinter" }, "sprinter-hourly");
  await isClass({ ...HOURLY, class: "premium", passengers: "6" }, "seats");
  await isClass({ ...HOURLY, class: "suv", vehicle: "suv-navigator", passengers: "6" }, "seats");
  await isClass({ ...BASE, class: "premium", passengers: "6" }, "seats");
  assert.equal((await priced({ ...BASE, class: "premium", passengers: "5" })).total, 22000);
  await isClass({ ...BASE, class: "sedan", passengers: "4" }, "seats");
  await isClass({ ...BASE, class: "first", passengers: "4" }, "seats");
  await isClass({ ...BASE, class: "suv", passengers: "6" }, "seats");
  assert.equal((await priced({ ...BASE, class: "sprinter", passengers: "12" })).total, 40000);
});

await test("holds never hide prices: payments off, blackout dates and a bad entry are paused, the clock change hour has its own clock-change hold", async () => {
  const off = readSettings({});
  await isHold(BASE, "paused", off);
  assert.equal((await run(BASE, off)).result.kind, "price");
  assert.equal(priceTrip((await run(BASE, off)).trip, off).total, 18500);
  await isError({ ...BASE, from_text: "" }, "from", off);
  await isHold(BASE, "paused", readSettings({ PAYMENTS_ENABLED: "true", PAY_BLACKOUT_DATES: "2026-12-24, 2026-10-14" }));
  for (const list of ["2026-10-14", "2026-12-31,2026-10-14", "2026-12-31 2026-10-14", "2026-12-31;2026-10-14", "2026-12-31\n2026-10-14"]) {
    await isHold(BASE, "paused", readSettings({ PAYMENTS_ENABLED: "true", PAY_BLACKOUT_DATES: list }));
  }
  const bad = readSettings({ PAYMENTS_ENABLED: "true", PAY_BLACKOUT_DATES: "2026-12-24, Dec 25" });
  assert.equal(bad.blackoutBad, true);
  assert.deepEqual(bad.blackout, ["2026-12-24"]);
  await isHold(BASE, "paused", bad);
  await isHold({ ...BASE, date: "2026-11-01", time: "01:30" }, "clock-change");
  await isHold({ ...BASE, date: "2026-11-01", time: "01:00" }, "clock-change");
  await isHold({ ...BASE, date: "2026-11-01", time: "01:50" }, "clock-change");
  await isHold({ ...BASE, date: "2026-11-01", time: "00:50" }, "");
  await isHold({ ...BASE, date: "2026-11-01", time: "02:00" }, "");
  await isHold({ ...BASE, date: "2027-03-14", time: "02:30" }, "clock-change");
  await isHold({ ...BASE, date: "2027-03-14", time: "02:00" }, "clock-change");
  await isHold({ ...BASE, date: "2027-03-14", time: "01:50" }, "");
  await isHold({ ...BASE, date: "2026-11-01", time: "03:00" }, "");
  await isHold({ ...BASE, date: "2026-11-01", time: "01:30" }, "paused", readSettings({ PAYMENTS_ENABLED: "true", PAY_BLACKOUT_DATES: "2026-11-01" }));
});

await test("a return pickup on a blackout date is paused, in the clock change hour clock-change, beyond 365 days is far-ahead", async () => {
  const back = { ...BASE, return: "1", return_date: "2026-10-18", return_time: "18:00" };
  await isHold(back, "");
  await isHold(back, "paused", readSettings({ PAYMENTS_ENABLED: "true", PAY_BLACKOUT_DATES: "2026-10-18" }));
  await isHold({ ...back, return_date: "2026-11-01", return_time: "01:15" }, "clock-change");
  await isHold({ ...back, date: "2027-09-25", return_date: "2027-10-02", return_time: "18:00" }, "far-ahead");
});

await test("in the second pass of the repeated hour when the clocks go back, a pickup later in that hour gets the clock-change hold and not date-past, and a time already passed is date-past", async () => {
  for (const [now, time] of [["2026-11-01T05:10:00.000Z", "01:45"], ["2026-11-01T06:10:00.000Z", "01:45"], ["2026-11-01T06:10:00.000Z", "01:15"], ["2026-11-01T06:50:00.000Z", "01:55"]]) await isHold({ ...BASE, date: "2026-11-01", time }, "clock-change", ON, new Date(now));
  for (const [now, date, time] of [["2026-11-01T06:10:00.000Z", "2026-11-01", "01:05"], ["2026-11-01T06:10:00.000Z", "2026-11-01", "00:50"], ["2027-03-14T07:40:00.000Z", "2027-03-14", "02:30"], ["2026-11-02T06:10:00.000Z", "2026-11-02", "01:05"]]) await isError({ ...BASE, date, time }, "date-past", ON, new Date(now));
});

await test("short-notice within 1 hour of the earliest pickup, far-ahead beyond 365 days", async () => {
  await isHold({ ...BASE, date: "2026-10-01", time: "12:10" }, "short-notice");
  await isHold({ ...BASE, date: "2026-10-01", time: "12:59" }, "short-notice");
  await isHold({ ...BASE, date: "2026-10-01", time: "13:00" }, "");
  await isHold({ ...BASE, date: "2026-10-01", time: "18:00" }, "");
  await isHold({ ...BASE, date: "2026-10-02", time: "11:00" }, "");
  await isHold({ ...BASE, date: "2027-10-01", time: "12:00" }, "");
  await isHold({ ...BASE, date: "2027-10-01", time: "12:01" }, "far-ahead");
  await isHold({ ...HOURLY, date: "2026-10-01", time: "12:50" }, "short-notice");
  await isHold({ ...HOURLY, date: "2026-10-01", time: "13:00" }, "");
});

await test("readSettings reads payments and blackout dates only, the old tax settings are gone", () => {
  const settings = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_RATE_ID: "txr_test0000000000", SALES_TAX_PERCENT: "8.875" });
  assert.deepEqual(settings, { paymentsEnabled: true, blackout: [], blackoutBad: false });
  assert.equal(readSettings({ PAYMENTS_ENABLED: "1" }).paymentsEnabled, false);
});

await test("the New York time helper gives the recorded instants", () => {
  assert.equal(nycToUtc("2026-10-14", "07:30").toISOString(), "2026-10-14T11:30:00.000Z");
  assert.equal(nycToUtc("2026-12-01", "14:00").toISOString(), "2026-12-01T19:00:00.000Z");
  assert.equal(nycToUtc("2027-03-14", "03:30").toISOString(), "2027-03-14T07:30:00.000Z");
  assert.equal(nycToUtc("2026-11-01", "01:30").toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(nycToUtc("2026-11-01", "02:30").toISOString(), "2026-11-01T07:30:00.000Z");
  assert.equal(nycToUtc("2027-03-14", "02:30").toISOString(), "2027-03-14T07:30:00.000Z");
});

await test("firstSlot gives the R1 examples: the first New York 10-minute slot at least 1 hour and 5 minutes ahead, skipping the clock-change hour", () => {
  const slot = (at) => firstSlot(new Date(at));
  assert.deepEqual([MIN_NOTICE_HOURS, AUTO_LEAD_MINUTES], [1, 5]);
  assert.deepEqual(slot("2026-10-19T10:46:20-04:00"), { date: "2026-10-19", time: "12:00" });
  assert.deepEqual(slot("2026-10-19T10:55:00-04:00"), { date: "2026-10-19", time: "12:00" });
  assert.deepEqual(slot("2026-10-19T10:55:01-04:00"), { date: "2026-10-19", time: "12:10" });
  assert.deepEqual(slot("2026-10-19T22:46:00-04:00"), { date: "2026-10-20", time: "00:00" });
  assert.deepEqual(slot("2026-12-31T23:30:00-05:00"), { date: "2027-01-01", time: "00:40" });
  assert.equal(`${formatDate("2027-01-01")}, ${formatTime("00:40")}`, "Fri, Jan 1, 2027, 12:40 AM");
  assert.deepEqual(slot("2026-11-01T00:30:00-04:00"), { date: "2026-11-01", time: "02:00" });
  assert.deepEqual(slot("2026-10-31T23:58:00-04:00"), { date: "2026-11-01", time: "02:00" });
  assert.deepEqual(slot("2026-11-01T01:20:00-05:00"), { date: "2026-11-01", time: "02:30" });
  assert.deepEqual(slot("2027-03-14T00:30:00-05:00"), { date: "2027-03-14", time: "01:40" });
  assert.deepEqual(slot("2027-03-14T00:58:00-05:00"), { date: "2027-03-14", time: "03:10" });
  assert.deepEqual(firstSlot(Date.parse("2026-10-19T14:46:20Z")), { date: "2026-10-19", time: "12:00" });
});

await test("firstSlot is always bookable online: a 10-minute slot 65 to 75 minutes ahead, or 2:00 AM after the fall-back hour, never short notice and never in a clock-change hour", async () => {
  const { trip } = await run(BASE);
  let count = 0;
  for (const start of ["2026-10-19T00:00:00Z", "2026-10-31T16:00:00Z", "2027-03-13T16:00:00Z", "2026-12-31T16:00:00Z"]) {
    for (let now = Date.parse(start); now < Date.parse(start) + 86400000; now += 67000, count++) {
      const { date, time } = firstSlot(now);
      const at = `${new Date(now).toISOString()} gives ${date} ${time}`;
      const ahead = nycToUtc(date, time).getTime() - now;
      assert.match(time, /^([01]\d|2[0-3]):[0-5]0$/, at);
      assert.ok(ahead >= (MIN_NOTICE_HOURS * 60 + AUTO_LEAD_MINUTES) * 60000, at);
      assert.ok(ahead < 75 * 60000 || (date === "2026-11-01" && time === "02:00"), at);
      assert.deepEqual(checkTrip({ ...trip, date, time }, now, ON), { kind: "price", reason: "", hold: "" }, at);
    }
  }
  assert.ok(count > 5000, String(count));
});

await test("bookingRef is stable for one nonce, differs for another, depends on the server key, and is 8 digits with no leading zero", () => {
  const nonce = "4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b";
  assert.equal(bookingRef(nonce), bookingRef(nonce));
  assert.notEqual(bookingRef(nonce), bookingRef(`${nonce}x`));
  const plain = bookingRef(nonce);
  process.env.BOOKING_REF_SECRET = "k".repeat(32);
  assert.notEqual(bookingRef(nonce), plain);
  assert.equal(bookingRef(nonce), bookingRef(nonce));
  delete process.env.BOOKING_REF_SECRET;
  assert.equal(bookingRef(nonce), plain);
  assert.equal(String(REF), String(/^[1-9]\d{7}$/));
  const refs = new Set();
  for (let i = 0; i < 2000; i++) {
    const ref = bookingRef(`nonce-${i}-0123456789abcdef`);
    assert.match(ref, /^[1-9]\d{7}$/, "8 digits with no leading zero");
    assert.ok(REF.test(ref), ref);
    refs.add(ref);
  }
  assert.ok(refs.size > 1995, `${refs.size} distinct references from 2000 nonces`);
  assert.deepEqual([...new Set([...refs].map((ref) => ref[0]))].sort().join(""), "123456789");
});

await test("formatDate and formatTime write by hand with ordinary spaces", () => {
  assert.equal(formatDate("2026-10-14"), "Wed, Oct 14, 2026");
  assert.equal(formatDate("2026-10-15"), "Thu, Oct 15, 2026");
  assert.equal(formatTime("12:40"), "12:40 PM");
  assert.equal(formatTime("00:05"), "12:05 AM");
  assert.equal(formatTime("23:45"), "11:45 PM");
  for (const text of [formatDate("2026-10-14"), formatTime("07:30")]) assert.ok(!/[\u202f\u00a0]/.test(text), JSON.stringify(text));
});

const MESSAGE = [
  "Hi NYC LUX RIDE, I would like to book this trip.",
  "Reference: 48213590",
  "Trip: One way",
  "Pickup: John F. Kennedy (JFK), Terminal 4",
  "Stop 1: 277 Bedford Ave, Brooklyn, NY 11211 (Brooklyn)",
  "Drop-off: The New York EDITION, Madison Avenue",
  "Date: Wed, Oct 14, 2026",
  "Time: 7:30 AM",
  "Flight: DL 401",
  "Return: Sun, Oct 18, 2026, 6:00 PM",
  "Passengers: 2",
  "Vehicle: Luxury Sprinter",
  "Meet and greet: Yes",
  "Total shown: $1,234.50",
].join("\n");

await test("composeMessage writes the 7.5 lines in order, the area of typed text with a known area, and the total shown", async () => {
  const { trip } = await run({ ...FROM_JFK, stop1_text: BROOKLYN, to_text: "The New York EDITION, Madison Avenue", class: "sprinter", meet: "1", flight: "DL 401", return: "1", return_date: "2026-10-18", return_time: "18:00" });
  assert.equal(composeMessage(trip, "48213590", 123450), MESSAGE);
  assert.equal(composeMessage(trip, "", undefined), MESSAGE.split("\n").filter((line) => !line.startsWith("Reference") && !line.startsWith("Total")).join("\n"));
  assert.equal(composeMessage({ ...trip, tip: "custom", tip_amount: "500" }, "48213590", 123450), MESSAGE.replace("Meet and greet: Yes\n", "Meet and greet: Yes\nGratuity: $500.00\n"));
});

await test("an hourly message names the hours and the vehicle and has no drop-off, stop or return line", async () => {
  const { trip } = await run({ ...HOURLY, class: "premium", hours: "4", to_text: "JFK", stop1_text: "x", return: "1", return_date: "2026-10-18", return_time: "18:00" });
  assert.equal(
    composeMessage(trip, "48213590", 46673),
    ["Hi NYC LUX RIDE, I would like to book this trip.", "Reference: 48213590", "Trip: By the hour, 4 hours", "Pickup: 350 5th Ave, New York, NY 10118 (Manhattan)", "Date: Wed, Oct 14, 2026", "Time: 7:30 AM", "Passengers: 2", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Total shown: $466.73"].join("\n"),
  );
});

await test("the WhatsApp, email and phone links: encoded message, %20 in the email, no links without a trip", async () => {
  const { trip } = await run(BASE);
  const text = composeMessage(trip, "48213590", 18500);
  const links = contactLinks(trip, "48213590", 18500);
  assert.equal(links.whatsapp, `https://wa.me/16467750556?text=${encodeURIComponent(text)}`);
  assert.equal(links.mailto, `mailto:info@nycluxride.com?subject=Booking%20request%2048213590&body=${encodeURIComponent(text)}`);
  assert.equal(links.tel, "tel:+16467750556");
  assert.ok(!links.mailto.includes("+"));
  assert.ok(text.endsWith("Total shown: $185.00"));
  assert.deepEqual(contactLinks(), {});
  const tipped = composeMessage({ ...trip, tip: 20 }, "48213590", 22600).split("\n");
  assert.deepEqual(tipped.slice(-2), ["Gratuity: 20%", "Total shown: $226.00"]);
  assert.ok(!composeMessage({ ...trip, tip: 0 }, "48213590", 18500).includes("Gratuity"));
  const custom = composeMessage({ ...trip, tip: "custom", tip_amount: "40" }, "48213590", 22500).split("\n");
  assert.deepEqual(custom.slice(-2), ["Gratuity: $40.00", "Total shown: $225.00"]);
  assert.equal(custom.filter((line) => line.startsWith("Gratuity")).length, 1);
  for (const tip_amount of ["0", "", "abc"]) assert.ok(!composeMessage({ ...trip, tip: "custom", tip_amount }, "48213590", 18500).includes("Gratuity"), tip_amount);
});

await test("readInput keeps the new fields, drops the old ones, and hourly drops the drop-off, the stops and the return", async () => {
  const trip = readInput({ ...BASE, from: "jfk", to: "manhattan", from_zone: "jfk", stop1_text: "s1", stop2_text: "s2", return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "DL 402" });
  assert.deepEqual([trip.from, trip.to, trip.from_zone], ["", "", undefined]);
  const KEYS = "trip_type from_text from_id from_ticket stop1_text stop1_id stop1_ticket stop2_text stop2_id stop2_ticket to_text to_id to_ticket date time flight return return_date return_time return_flight passengers hours class vehicle suvVehicle meet tip tip_amount action nonce nlr_hp route from to ends legs meetOffered details";
  assert.deepEqual(Object.keys(trip).sort(), KEYS.split(" ").sort());
  assert.deepEqual([trip.stop1_text, trip.stop2_text, trip.return, trip.return_date, trip.return_time, trip.return_flight], ["s1", "s2", true, "2026-10-18", "18:00", "DL 402"]);
  const hourly = readInput({ ...HOURLY, to_text: "JFK", to_id: "jfk", stop1_text: "s1", return: "1", return_date: "2026-10-18", return_time: "18:00" });
  assert.deepEqual([hourly.to_text, hourly.to_id, hourly.stop1_text, hourly.return, hourly.return_date], ["", "", "", false, ""]);
  const one = readInput({ ...BASE, hours: "99", vehicle: "premium" });
  assert.deepEqual([one.hours, one.vehicle], ["", ""]);
  assert.equal(readInput({ ...BASE, return: "on" }).return, false);
});

await test("hourly vehicle: suv with an suv-* key keeps it, otherwise the class default", () => {
  assert.equal(readInput({ ...HOURLY, class: "suv", vehicle: "suv-denali" }).vehicle, "suv-denali");
  assert.equal(readInput({ ...HOURLY, class: "suv", vehicle: "sedan" }).vehicle, "suv-suburban");
  assert.equal(readInput({ ...HOURLY, class: "suv", vehicle: "nope" }).vehicle, "suv-suburban");
  assert.equal(readInput({ ...HOURLY, class: "first", vehicle: "suv-denali" }).vehicle, "first");
  assert.equal(readInput({ ...HOURLY, class: "first", vehicle: "suv-denali" }).suvVehicle, "suv-denali");
  assert.equal(readInput({ ...HOURLY, class: "sprinter" }).vehicle, "sprinter");
});

await test("the flight is kept only at an airport pickup, the return flight only when the drop-off is an airport", async () => {
  assert.equal((await run({ ...BASE, flight: "DL 401" })).trip.flight, "");
  assert.equal((await run({ ...FROM_JFK, flight: "DL 401" })).trip.flight, "DL 401");
  assert.equal((await run({ ...FROM_JFK, from_text: "Westchester County (HPN)", from_id: "hpn", flight: "DL 401" })).trip.flight, "DL 401");
  assert.equal((await run({ ...FROM_JFK, flight: "DL#401", from_text: MANHATTAN, from_id: "", to_text: "JFK" })).result.kind, "price");
  const back = { return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "DL 402" };
  assert.equal((await run({ ...BASE, ...back })).trip.return_flight, "DL 402");
  assert.equal((await run({ ...FROM_JFK, ...back })).trip.return_flight, "");
});

await test("strings are cleaned and cut to 200 code points, ids must match the id pattern, tickets the ticket pattern", () => {
  const trip = readInput({ ...BASE, from_text: `  ${"A".repeat(250)}  `, passengers: " 02 ", from_id: "JFK", to_id: "a".repeat(25), from_ticket: "v1.short.mac", to_ticket: `v1.${"a".repeat(507)}.${"b".repeat(43)}` });
  assert.equal(trip.from_text, "A".repeat(200));
  assert.equal(trip.passengers, "2");
  assert.deepEqual([trip.from_id, trip.to_id, trip.from_ticket, trip.to_ticket], ["", "", "", ""]);
  const good = `v1.${"a".repeat(40)}.${"b".repeat(43)}`;
  assert.equal(readInput({ ...BASE, from_ticket: good }).from_ticket, good);
  const longest = `v1.${"a".repeat(506)}.${"b".repeat(43)}`;
  assert.deepEqual([longest.length, readInput({ ...BASE, to_ticket: longest }).to_ticket], [553, longest]);
  assert.equal(readInput({ ...BASE, from_id: "jfk-t4" }).from_id, "jfk-t4");
  assert.equal(readInput({ ...BASE, from_text: "350 Fifth Avenue\ud800" }).from_text, "350 Fifth Avenue");
  assert.equal(readInput({ ...BASE, from_text: "a\nb\u202ec\u2066d\u0000e" }).from_text, "a b c d e");
  const emoji = `${"A".repeat(199)}\u{1F600}`;
  assert.equal(readInput({ ...BASE, from_text: emoji }).from_text, emoji);
  assert.equal(readInput({ ...BASE, from_text: `${"A".repeat(200)}\u{1F600}` }).from_text, "A".repeat(200));
  for (const from_text of ["350 Fifth Avenue\ud800", emoji, "x\u0000y\u2028z", "\udbff\udbff"]) assert.doesNotThrow(() => contactLinks(readInput({ ...BASE, from_text }), "48213590"));
});

await test("a local id counts only when the box text equals its label, the browser can never claim a zone", async () => {
  assert.equal((await run({ ...BASE, to_text: "John F Kennedy Blvd", to_id: "jfk" })).result.reason, "unplaced");
  assert.equal((await run({ ...BASE, to_text: "Somewhere in Ohio", to_id: "jfk" })).result.reason, "unplaced");
  assert.equal((await run({ ...BASE, from_zone: "manhattan", to_zone: "jfk", from_text: "350 5th Ave" })).result.reason, "unplaced");
  assert.equal((await run({ ...BASE, to_text: "john f. kennedy (jfk)", to_id: "jfk" })).trip.ends.to.id, "jfk");
});

await test("a one way trip that was never resolved is never priced", () => {
  assert.deepEqual(checkTrip(readInput(BASE), NOW, ON), { kind: "quote", reason: "unplaced", field: "from_text" });
  const hourly = checkTrip(readInput(HOURLY), NOW, ON);
  assert.equal(hourly.kind, "quote");
});

await test("tip, nonce, meet and non-string fields", () => {
  assert.deepEqual(["", "0", "10", "15", "20", "7", "custom", "Custom"].map((tip) => readInput({ tip }).tip), [0, 0, 10, 15, 20, null, "custom", null]);
  assert.equal(readInput({}).tip, 0);
  assert.deepEqual(["40", "040", " 40 ", "0", "", "40.5", "$40"].map((tip_amount) => readInput({ tip: "custom", tip_amount }).tip_amount), ["40", "40", "40", "0", "", "40.5", "$40"]);
  assert.deepEqual(["", "0", "20", "x"].map((tip) => readInput({ tip, tip_amount: "40" }).tip_amount), ["", "", "", ""]);
  assert.equal(readInput({}).tip_amount, "");
  assert.equal(readInput({ nonce: "short" }).nonce, "");
  assert.equal(readInput({ nonce: "4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b" }).nonce, "4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b");
  assert.equal(readInput({ meet: "yes" }).meet, false);
  const fields = Object.create({ trip_type: "one" });
  fields.from_text = 7;
  const trip = readInput(fields);
  assert.deepEqual([trip.trip_type, trip.from_text], ["", ""]);
});

await test("receipt: new sessions rebuild the checkout lines, legacy sessions keep their gratuity and sales tax lines", () => {
  const meta = { ref: "48213590", service: "airport", direction: "to-airport", airport: "jfk", class: "suv", legs: "1", date: "2026-10-15", time: "12:40", fare_cents: "15500", tax_cents: "1376", bcf_cents: "349", tolls_cents: "1275", meet_cents: "0", tip_percent: "15", tip_cents: "2325", total_cents: "20825" };
  const out = receipt(meta, ON);
  assert.equal(out.summary, "Thu, Oct 15, 2026, 12:40 PM. To JFK, Business SUV.");
  assert.deepEqual(pairs(out.lines), [...LEG, ["Gratuity for your chauffeur (15%)", 2325]]);
  assert.deepEqual(out.notes, [NOTES.included, POLICY.later.airport]);
  assert.equal(out.value, 15500);
  assert.equal(receipt({ ...meta, legs: "2", direction: "from-airport" }, ON).summary, "Thu, Oct 15, 2026, 12:40 PM. Business SUV, 2 airport transfers.");
  const custom = receipt({ ...meta, tip_percent: "0", tip_cents: "4000", total_cents: "22500" }, ON);
  assert.deepEqual(pairs(custom.lines), [...LEG, ["Gratuity for your chauffeur", 4000]]);
  assert.equal(custom.value, 15500);
  const unlabeled = { ...meta, tip_cents: "4000" };
  delete unlabeled.tip_percent;
  assert.deepEqual(pairs(receipt(unlabeled, ON).lines).at(-1), ["Gratuity for your chauffeur", 4000]);
  const hourly = receipt({ ref: "48213590", service: "hourly", class: "premium", vehicle: "premium", hours: "4", date: "2026-12-01", time: "14:00", fare_cents: "42000", tax_cents: "3728", bcf_cents: "945", tolls_cents: "0", meet_cents: "0", tip_cents: "0", tip_percent: "0" }, ON);
  assert.equal(hourly.summary, "Tue, Dec 1, 2026, 2:00 PM. By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours.");
  assert.deepEqual(pairs(hourly.lines), [["Fare, 4 hours", 42000], ["NYC sales tax (8.875%)", 3728], ["Black Car Fund (2.25%)", 945]]);
  assert.deepEqual(hourly.notes, [POLICY.later.hourly]);
  const legacy = { ref: "10000001", service: "transfer", direction: "from-airport", airport: "jfk", class: "suv", date: "2026-10-14", time: "07:30", fare_cents: "16500", meet_cents: "2500", gratuity_cents: "3300", tax_cents: "1686", total_cents: "23986" };
  assert.deepEqual(pairs(receipt(legacy, ON).lines), [["Fare", 16500], ["Meet and greet", 2500], ["Gratuity for your chauffeur (20%)", 3300], ["Sales tax", 1686]]);
  assert.deepEqual(pairs(receipt({ ...legacy, tax_cents: "0" }, ON, 1700).lines).at(-1), ["Sales tax", 1700]);
  assert.deepEqual(pairs(receipt({ ...legacy, tax_cents: "0" }, ON).lines).length, 3);
  assert.deepEqual(receipt({}, ON), { summary: "", lines: [], value: 0, notes: [NOTES.included, POLICY.later.airport] });
});

await test("fill replaces every named placeholder and leaves unknown ones", () => {
  assert.equal(fill("Booking request {ref}", { ref: "48213590" }), "Booking request 48213590");
  assert.equal(fill("{a} and {b}", { a: 1 }), "1 and {b}");
});

await test("readInput fills trip.details with the limits and defaults of 4.9.1", () => {
  assert.deepEqual(readInput(BASE).details, { rider: "me", name: "", email: "", phone: "", phone_cc: "US", reach: "phone", pname: "", pphone: "", pphone_cc: "", sign: "", notes: "" });
  assert.deepEqual(["phone_cc", "pphone_cc"].map((key) => readInput({ ...BASE, rider: "other", phone_cc: "gb", pphone_cc: "" }).details[key]), ["GB", "US"]);
  assert.deepEqual(["phone_cc", "pphone_cc"].map((key) => readInput({ ...BASE, phone_cc: "", pphone_cc: "GB" }).details[key]), ["US", ""]);
  assert.equal(readInput({ ...BASE, phone_cc: "ZZ" }).details.phone_cc, "ZZ");
  const long = (n) => "x".repeat(n);
  const d = readInput({ ...BASE, rider: long(20), name: long(90), email: long(300), phone: long(40), reach: long(20), pname: long(90), pphone: long(40), sign: long(60), notes: long(600) }).details;
  assert.deepEqual([d.rider, d.name, d.email, d.phone, d.reach, d.pname, d.pphone, d.sign, d.notes].map((v) => v.length), [8, 80, 254, 32, 16, 0, 0, 45, 500]);
  const o = readInput({ ...BASE, rider: "other", pname: ` ${long(90)} `, pphone: long(40), notes: "Two cases\nand a stroller\tplease", name: 42 }).details;
  assert.deepEqual([o.rider, o.pname.length, o.pphone.length, o.notes, o.name], ["other", 80, 32, "Two cases\nand a stroller please", ""]);
  assert.equal(readInput({ ...BASE, notes: "Child seat\r\n\r\nTwo large bags\rCall on arrival" }).details.notes, "Child seat\nTwo large bags\nCall on arrival");
  const ch = (n) => String.fromCharCode(n);
  assert.deepEqual([readInput({ ...BASE, name: `${ch(0x200b)}${ch(0x200b)}` }).details.name, readInput({ ...BASE, name: `Kenn${ch(0xad)}edy` }).details.name, readInput({ ...BASE, sign: ch(0xfeff) }).details.sign], ["", "Kennedy", ""]);
  assert.equal(readInput({ ...BASE, phone: `${ch(0x200e)}+1 212${ch(0x2011)}555${ch(0x2011)}0100${ch(0x200e)}` }).details.phone, "+1 212 555 0100");
  assert.deepEqual(["phone", "pphone"].map((key) => readInput({ ...BASE, rider: "other", phone: "(212) 555-0100", pphone: "07700 900123", pphone_cc: "GB" }).details[key]), ["+1 212 555 0100", "+44 7700 900123"]);
  assert.equal(readInput({ ...BASE, phone: "555-0100" }).details.phone, "555-0100");
  assert.deepEqual([readInput({ ...BASE, rider: "", reach: "" }).details.rider, readInput({ ...BASE, rider: "", reach: "" }).details.reach], ["me", "phone"]);
});

await test("checkDetails follows the order of 4.9.2 with JavaScript and without it", () => {
  const ok = { rider: "me", name: "Ana Lopez", email: "ana@example.com", phone: "+1 212 555 0100", reach: "whatsapp" };
  const code = (fields, required) => {
    const r = checkDetails(readInput({ ...BASE, ...fields }), required);
    if (r) seenErrors.add(r.code);
    return r ? r.code : "";
  };
  assert.deepEqual(checkDetails(readInput({ ...BASE, ...ok }), true), null);
  assert.equal(code({ rider: "guest", reach: "sms", name: "" }, true), "rider");
  assert.equal(code({ reach: "sms", name: "" }, true), "reach");
  assert.equal(code({ ...ok, name: "A", email: "x" }, true), "name");
  assert.equal(code({ ...ok, email: "x", phone: "1" }, true), "email");
  assert.equal(code({ ...ok, phone: "1" }, true), "phone");
  assert.equal(code({ ...ok, rider: "other", pphone: "x" }, true), "pname");
  assert.equal(code({ ...ok, rider: "other", pname: "Ben Ortiz", pphone: "x" }, true), "pphone");
  assert.equal(code({ ...ok, rider: "other", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" }, true), "");
  assert.equal(code({}, true), "name");
  assert.equal(code({}, false), "");
  assert.equal(code({ rider: "other" }, false), "pname");
  assert.equal(code({ rider: "other", pname: "Ben Ortiz" }, false), "pphone");
  assert.equal(code({ rider: "other", pname: "Ben Ortiz", pphone: "+1 917 555 0142" }, false), "");
  assert.equal(code({ meet: "1" }, false), "name");
  assert.equal(code({ meet: "1", sign: "Ana Lopez" }, false), "");
  assert.equal(code({ meet: "1", name: "Ana Lopez" }, false), "");
  assert.equal(code({ meet: "1", rider: "other", pname: "Ben Ortiz", pphone: "+1 917 555 0142" }, false), "");
  assert.equal(code({ name: "A" }, false), "name");
  assert.equal(code({ email: "a@b" }, false), "email");
  assert.equal(code({ phone: "12345" }, false), "phone");
  assert.equal(code({ rider: "other", pname: "Ben Ortiz", pphone: "x" }, false), "pphone");
  const ch = (n) => String.fromCharCode(n);
  const digits = (base, text) => [...text].map((d) => ch(base + Number(d))).join("");
  for (const phone of [`+44${ch(0xa0)}7700${ch(0xa0)}900123`, `+1 212${ch(0x2011)}555${ch(0x2011)}0100`, `${ch(0x202a)}+44 7700 900123${ch(0x202c)}`, `${ch(0x200e)}+44 7700 900123${ch(0x200e)}`, "+49 171/1234567", `${ch(0xff0b)}${digits(0xff10, "81")} ${digits(0xff10, "9012345678")}`, `+${digits(0x660, "971501234567")}`, `+${digits(0x6f0, "971501234567")}`, `646 ${ch(0x2013)} 775 ${ch(0x2013)} 0556`, `+1 212${ch(0x2212)}555${ch(0x2212)}0100`]) assert.equal(code({ ...ok, phone }, true), "", JSON.stringify(phone));
  assert.equal(code({ rider: "x" }, false), "rider");
  assert.equal(code({ reach: "x" }, false), "reach");
  for (const [phone, valid] of [["2125550100", true], ["(212) 555-0100", true], ["+44 20.7946.0958", true], ["555-0100", false], ["12345", false], ["+1 212 555 0100 x2", false], ["1234567890123456", false]]) assert.equal(code({ ...ok, phone }, true), valid ? "" : "phone", phone);
  const COUNTRY_CASES = [
    ["US", "1 212 555 0100", true], ["US", "+1 1 212 555 0100", true], ["US", "+1242 555 0100", true], ["US", "123 456 7890", false], ["US", "212 155 0100", false], ["US", "0207 946 0958", false],
    ["US", "+44 7700 900123", true], ["US", "0044 7700 900123", true], ["US", "011 44 7700 900123", true], ["GB", "7700 900123", true], ["GB", "07700 900123", true], ["GB", "+44 07700 900123", true],
    ["GB", "+44 (0)20 7946 0958", true], ["DE", "0171 1234567", true], ["FR", "06 12 34 56 78", true], ["AU", "0412 345 678", true], ["IT", "06 1234 5678", true], ["IT", "347 123 4567", true],
    ["BJ", "01 97 12 34 56", true], ["RU", "8 912 345 67 89", true], ["RU", "812 123 45 67", true], ["BY", "8 029 123 45 67", true], ["BY", "029 123 45 67", true], ["HU", "06 30 123 4567", true],
    ["JP", "090-1234-5678", true], ["NU", "+683 1234", true], ["CA", "+7 495 123 45 67", true], ["", "2125550100", true], ["ZZ", "7700 900123", false], ["ZZ", "+44 7700 900123", true],
    ["US", "+888 1234 5678", false], ["US", "call me", false], ["ZZ", "212 555 0100", false], ["GB", "+1 212 555 0100", true],
  ];
  for (const [phone_cc, phone, valid] of COUNTRY_CASES) {
    assert.equal(code({ ...ok, phone, phone_cc }, true), valid ? "" : "phone", `${phone_cc} ${phone}`);
    assert.equal(code({ ...ok, rider: "other", pname: "Ben Ortiz", pphone: phone, pphone_cc: phone_cc }, true), valid ? "" : "pphone", `passenger ${phone_cc} ${phone}`);
  }
  for (const [email, valid] of [["a.b+c@mail.example.co", true], ["o'neil@example.ie", true], ["ana@example", false], ["ana@@example.com", false], ["ana@example.c", false], [`${"a".repeat(250)}@example.com`, false]]) assert.equal(code({ ...ok, email }, true), valid ? "" : "email", email);
});

const GREENWICH = "Greenwich, CT 06830";
const PARK = "200 Park Ave, New York, NY 10166";
const MONTAUK = "1 Ocean Rd, Montauk, NY 11954";
const RIDE = { ...BASE, to_text: BROOKLYN, to_id: "" };
const withMock = async (fn) => {
  process.env.GOOGLE_MOCK = "true";
  try {
    return await fn();
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
};

await test("the owner's distance and time rates, areas and limits are in api/_rates.mjs, in cents, with no Luxury Sprinter rate", () => {
  assert.deepEqual(DISTANCE_RATES, {
    suv: { base: 3500, mile: 400, minute: 65, minimum: 11000 },
    premium: { base: 4500, mile: 475, minute: 80, minimum: 12500 },
    first: { base: 5500, mile: 525, minute: 90, minimum: 17000 },
    sedan: { base: 2500, mile: 300, minute: 50, minimum: 8700 },
  });
  assert.deepEqual(DISTANCE_AREAS, ["manhattan", "brooklyn", "queens", "bronx", "staten-island"]);
  assert.deepEqual(DISTANCE_LIMITS, { miles: 60, minutes: 180 });
  assert.deepEqual(DISTANCE_SKIP_ZIPS, ["11430", "11371", "07114", "07608"]);
});

await test("distanceFare is max(minimum, base + miles x per mile + minutes x per minute) in exact cents, with tenths of a mile and half cents rounded up", () => {
  const CASES = [
    ["sedan", 0, 0, 8700],
    ["sedan", 46, 27, 8700],
    ["sedan", 150, 33, 8700],
    ["sedan", 150, 34, 8700],
    ["sedan", 150, 35, 8750],
    ["sedan", 314, 52, 14520],
    ["sedan", 316, 58, 14880],
    ["suv", 0, 0, 11000],
    ["suv", 46, 27, 11000],
    ["suv", 150, 45, 12425],
    ["suv", 314, 52, 19440],
    ["premium", 9, 8, 12500],
    ["premium", 161, 20, 13748],
    ["premium", 163, 20, 13843],
    ["premium", 314, 52, 23575],
    ["first", 0, 0, 17000],
    ["first", 117, 15, 17000],
    ["first", 163, 40, 17658],
    ["first", 314, 52, 26665],
  ];
  for (const [cls, tenths, minutes, cents] of CASES) {
    assert.equal(distanceFare(cls, tenths, minutes), cents, `${cls} ${tenths / 10} mi ${minutes} min`);
    assert.ok(Number.isInteger(distanceFare(cls, tenths, minutes)));
  }
  assert.deepEqual(priceDistance("suv", { tenths: 150, minutes: 45 }), { fare: 12425, tax: 1103, bcf: 280, tolls: 0, total: 13808 });
  assert.deepEqual(priceDistance("sedan", { tenths: 46, minutes: 27 }), { fare: 8700, tax: 772, bcf: 196, tolls: 0, total: 9668 });
  assert.deepEqual(priceDistance("first", { tenths: 314, minutes: 52 }), { fare: 26665, tax: 2367, bcf: 600, tolls: 0, total: 29632 });
});

await test("the limits: up to 60.0 miles and 180 minutes a ride are priced, 60.1 miles or 181 minutes are not", () => {
  assert.deepEqual([{ tenths: 600, minutes: 180 }, { tenths: 601, minutes: 10 }, { tenths: 10, minutes: 181 }, { tenths: 0, minutes: 0 }].map(withinLimits), [true, false, false, true]);
});

await test("a one-way trip with no airport end is priced by distance and time from the Google route, in every class but the Luxury Sprinter", async () => {
  await withMock(async () => {
    const price = await priced({ ...RIDE, class: "suv" });
    assert.deepEqual(pairs(price.lines), [["Fare", 11000], ["NYC sales tax (8.875%)", 976], ["Black Car Fund (2.25%)", 248]]);
    assert.deepEqual([price.fare, price.tax, price.bcf, price.tolls, price.meet, price.tip, price.total, price.value, price.service], [11000, 976, 248, 0, 0, 0, 12224, 11000, "distance"]);
    assert.deepEqual(price.notes, [POLICY.later.hourly]);
    for (const [cls, total] of [["suv", 12224], ["premium", 13890], ["first", 18892], ["sedan", 9668]]) assert.equal((await priced({ ...RIDE, class: cls })).total, total, cls);
    for (const [cls, total] of [["suv", 21602], ["premium", 26197], ["first", 29632], ["sedan", 16136]]) assert.equal((await priced({ ...RIDE, to_text: GREENWICH, class: cls })).total, total, cls);
    for (const [cls, total] of [["suv", 12224], ["premium", 13890], ["first", 18892], ["sedan", 9668]]) assert.equal((await priced({ ...RIDE, to_text: PARK, class: cls })).fare, DISTANCE_RATES[cls].minimum, cls);
    await isClass({ ...RIDE, class: "sprinter" }, "sprinter-distance");
    const { trip } = await run({ ...RIDE, class: "sprinter" });
    assert.deepEqual(["suv", "premium", "first", "sedan", "sprinter"].map((cls) => classTotal(trip, cls)), [12224, 13890, 18892, 9668, null]);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.reason, leg.ride]), [["manhattan", "brooklyn", "", { tenths: 46, minutes: 27 }]]);
    assert.equal(serviceLabel({ ...trip, class: "suv" }), "Business SUV, 4.6 miles and 27 min");
    assert.equal(composeMessage({ ...trip, class: "suv" }, "48213590", 12224).split("\n").at(-1), "Total shown: $122.24");
  });
});

await test("each ride of a return trip of that kind is priced from its own route and pickup time, then tax, the Black Car Fund and the gratuity", async () => {
  await withMock(async () => {
    const back = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
    const both = await priced({ ...RIDE, ...back, class: "sedan" });
    assert.deepEqual(both.legs.map((leg) => leg.fare), [8700, 8700]);
    assert.deepEqual(pairs(both.lines), [["Fare", 17400], ["NYC sales tax (8.875%)", 1544], ["Black Car Fund (2.25%)", 392]]);
    assert.equal(both.total, 19336);
    const far = await priced({ ...RIDE, ...back, to_text: GREENWICH, class: "sedan", tip: "15" });
    assert.deepEqual(far.legs.map((leg) => [leg.fare, leg.tax, leg.bcf, leg.tolls]), [[14520, 1289, 327, 0], [14880, 1321, 335, 0]]);
    assert.deepEqual(pairs(far.lines), [["Fare", 29400], ["NYC sales tax (8.875%)", 2610], ["Black Car Fund (2.25%)", 662], ["Gratuity for your chauffeur (15%)", 4410]]);
    assert.equal(far.total, 37082);
    const { trip } = await run({ ...RIDE, ...back, to_text: GREENWICH, class: "sedan" });
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back, leg.ride]), [["manhattan", "outside", false, { tenths: 314, minutes: 52 }], ["outside", "manhattan", true, { tenths: 316, minutes: 58 }]]);
    assert.equal(serviceLabel(trip), "Sedan & Electric, 2 rides, 63.0 miles and 110 min");
    assert.equal((await priced({ ...RIDE, class: "suv", tip: "custom", tip_amount: "40" })).total, 16224);
    assert.equal((await priced({ ...RIDE, class: "suv", tip: "20" })).total, 14424);
  });
});

await test("guardrails: both ends outside the five boroughs is outside-trip, over the limits is long-trip, no route keeps the no-airport request, airports and stops keep their rules, and an airport to an address outside New York City pays at least the airport fare", async () => {
  await withMock(async () => {
    await isQuote({ ...RIDE, from_text: "Hoboken, NJ 07030", to_text: GREENWICH }, "outside-trip");
    await isQuote({ ...RIDE, to_text: MONTAUK }, "long-trip");
    await isQuote({ ...RIDE, to_text: MONTAUK, return: "1", return_date: "2026-10-18", return_time: "18:00" }, "long-trip");
    await isQuote({ ...RIDE, stop1_text: PARK }, "stop-leg");
    assert.equal((await priced(BASE)).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...FROM_JFK, to_text: BROOKLYN })).total, AIRPORT_TOTALS.suv.jfk);
    const hoboken = await priced({ ...FROM_JFK, to_text: "Hoboken, NJ 07030" });
    assert.deepEqual([pairs(hoboken.lines), hoboken.tolls, hoboken.total, hoboken.service], [[["Fare", AIRPORT_FARES.suv.jfk], ["NYC sales tax (8.875%)", 1376], ["Black Car Fund (2.25%)", 349]], 0, 17225, "distance"]);
    assert.equal((await priced({ ...HOURLY, from_text: BROOKLYN })).total, 28337);
  });
  await isQuote(RIDE, "no-airport");
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    await isQuote({ ...RIDE, date: "2026-10-21" }, "no-airport");
    assert.deepEqual(calls, ["https://routes.googleapis.com/directions/v2:computeRoutes"]);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("an airport typed as a street address with its ZIP code gets the airport ZIP code request and never gets a distance price", async () => {
  await withMock(async () => {
    for (const text of ["3 Brewster Rd, Newark, NJ 07114", "Terminal B, Newark, NJ 07114", "3 Brewster Rd, Newark, NJ 07114-3709", "111 Industrial Ave, Teterboro, NJ 07608"]) {
      await isQuote({ ...RIDE, to_text: text }, "airport-zip");
      await isQuote({ ...RIDE, from_text: text, to_text: MANHATTAN }, "airport-zip");
      await isQuote({ ...RIDE, to_text: text, return: "1", return_date: "2026-10-18", return_time: "18:00" }, "airport-zip");
      const { trip } = await run({ ...RIDE, to_text: text });
      assert.deepEqual([trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", [["airport-zip", undefined]]], text);
    }
    assert.equal((await priced({ ...RIDE, to_text: "12 Washington St, Hoboken, NJ 07030", class: "suv" })).service, "distance");
    assert.equal((await priced({ ...BASE, to_text: "Newark Liberty International Airport, 3 Brewster Rd, Newark, NJ 07114", to_id: "" })).total, AIRPORT_TOTALS.suv.ewr);
  });
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    await isQuote({ ...RIDE, to_text: "3 Brewster Rd, Newark, NJ 07114", date: "2026-10-21" }, "airport-zip");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
  await isQuote({ ...RIDE, to_text: "3 Brewster Rd, Newark, NJ 07114" }, "airport-zip");
});

await test("an address typed in the JFK or LaGuardia ZIP code without the airport's name gets the airport ZIP code request on that end, one way and by the hour, while the airport typed with its ZIP code keeps its flat rate and other unknown text keeps the ZIP code request", async () => {
  for (const [fields, field] of [[{ ...BASE, to_text: "TWA Hotel, One Idlewild Dr, Jamaica, NY 11430", to_id: "" }, "to_text"], [{ ...BASE, to_text: "Terminal B, East Elmhurst, NY 11371", to_id: "" }, "to_text"], [{ ...FROM_JFK, from_text: "Queens, NY 11430", from_id: "" }, "from_text"], [{ ...BASE, stop1_text: "1 Idlewild Dr, 11430-1234" }, "stop1_text"], [{ ...HOURLY, from_text: "TWA Hotel, One Idlewild Dr, Jamaica, NY 11430" }, "from_text"]]) {
    await isQuote(fields, "airport-zip", field);
  }
  assert.equal((await priced({ ...BASE, to_text: "TWA Hotel at JFK, Jamaica, NY 11430", to_id: "" })).total, AIRPORT_TOTALS.suv.jfk);
  assert.equal((await priced({ ...BASE, to_text: "LaGuardia Airport, East Elmhurst, NY 11371", to_id: "" })).total, AIRPORT_TOTALS.suv.lga);
  await isQuote({ ...BASE, to_text: "The Plaza Hotel", to_id: "" }, "unplaced", "to_text");
  await isQuote({ ...HOURLY, from_text: "The Plaza Hotel" }, "unplaced", "from_text");
});

await test("an address with its ZIP code typed before New York, NY or NYC is placed by that ZIP code and gets its flat airport rate or its distance price, while a house number there still asks for the ZIP code", async () => {
  for (const to_text of ["1535 Broadway, 10036 New York", "Empire State Building, 10118, NYC", "Times Square, 10036 New York, USA"]) assert.equal((await priced({ ...FROM_JFK, to_text })).total, AIRPORT_TOTALS.suv.jfk, to_text);
  assert.equal((await priced({ ...BASE, from_text: "Flushing, 11354 New York" })).total, AIRPORT_TOTALS.suv.jfk);
  await withMock(async () => assert.equal((await priced({ ...RIDE, to_text: "277 Bedford Ave, 11211 NY" })).service, "distance"));
  await isQuote({ ...FROM_JFK, to_text: "10036 Broadway, New York" }, "unplaced", "to_text");
  await isQuote({ ...FROM_JFK, to_text: "TWA Hotel, 11430 New York" }, "airport-zip", "to_text");
});

await test("the route numbers come from the server: a signed route token it issued is reused, a changed, expired or other-trip token is ignored", async () => {
  await withMock(async () => {
    const fields = { ...RIDE, date: "2026-10-22", time: "09:10", class: "suv" };
    const first = await run(fields);
    assert.match(first.trip.route, ROUTE);
    assert.deepEqual([...readRoute(first.trip.route, NOW).values()].map(({ tenths, minutes }) => [tenths, minutes]), [[46, 27]]);
    const key = routeKey({ address: MANHATTAN }, { address: BROOKLYN }, nycToUtc("2026-10-23", "09:10").toISOString());
    const token = signRoute([[key, 150, 45]], NOW);
    const own = await run({ ...fields, date: "2026-10-23", route: token });
    assert.deepEqual([own.trip.legs[0].ride, own.price.fare, own.price.total], [{ tenths: 150, minutes: 45 }, 12425, 13808]);
    const [head, payload, mac] = token.split(".");
    const forged = `${head}.${Buffer.from(JSON.stringify({ t: Math.floor(NOW / 1000), l: [[key, 1, 1]] })).toString("base64url")}.${mac}`;
    for (const bad of [forged, `${head}.${payload}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`, signRoute([[key, 150, 45]], NOW - 21601000), signRoute([[routeKey({ address: MANHATTAN }, { address: BROOKLYN }, nycToUtc("2026-10-24", "09:10").toISOString()), 150, 45]], NOW)]) {
      const out = await run({ ...fields, date: "2026-10-23", route: bad });
      assert.deepEqual(out.trip.legs[0].ride, { tenths: 46, minutes: 27 }, bad);
    }
    assert.equal(readInput({ ...fields, route: token }).route, token);
    for (const route of ["r1.short.mac", `v1.${payload}.${mac}`, `r1.${"a".repeat(520)}.${mac}`, 7]) assert.equal(readInput({ ...fields, route }).route, "", String(route));
  });
});

await test("receipt: a distance trip rebuilds the lines with no tolls line, the hourly after the ride note and the miles and minutes", () => {
  const meta = { ref: "48213590", service: "distance", class: "suv", legs: "1", miles: "4.6", minutes: "27", date: "2026-10-14", time: "07:30", fare_cents: "11000", tax_cents: "976", bcf_cents: "248", tolls_cents: "0", meet_cents: "0", tip_percent: "20", tip_cents: "2200", total_cents: "14424" };
  const out = receipt(meta, ON);
  assert.equal(out.summary, "Wed, Oct 14, 2026, 7:30 AM. Business SUV, 4.6 miles and 27 min.");
  assert.deepEqual(pairs(out.lines), [["Fare", 11000], ["NYC sales tax (8.875%)", 976], ["Black Car Fund (2.25%)", 248], ["Gratuity for your chauffeur (20%)", 2200]]);
  assert.deepEqual(out.notes, [POLICY.later.hourly]);
  assert.equal(out.value, 11000);
  assert.equal(receipt({ ...meta, legs: "2", miles: "9.4", minutes: "58", return_date: "2026-10-18", return_time: "18:00" }, ON).summary, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. Business SUV, 2 rides, 9.4 miles and 58 min.");
});

const SECAUCUS = "Secaucus, NJ 07094";
const JFK_ADDRESS = "John F. Kennedy International Airport, Queens, NY 11430";
const NJ_JFK = { ...BASE, from_text: SECAUCUS };
const JFK_NJ = { ...FROM_JFK, to_text: SECAUCUS };
const ROUND_TRIP = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
const TAX = "NYC sales tax (8.875%)";
const BCF = "Black Car Fund (2.25%)";

await test("an airport fare is the floor of a ride between an airport and an address outside New York City: max(AIRPORT_FARES, distanceFare), then tax and the Black Car Fund, no tolls", () => {
  assert.deepEqual([distanceFare("suv", 250, 45), distanceFare("sedan", 250, 45)], [16425, 12250]);
  assert.deepEqual(priceDistance("suv", { tenths: 250, minutes: 45 }, "jfk"), { fare: 16425, tax: 1458, bcf: 370, tolls: 0, total: 18253 });
  assert.deepEqual(priceDistance("sedan", { tenths: 250, minutes: 45 }, "jfk"), { fare: AIRPORT_FARES.sedan.jfk, tax: 1256, bcf: 318, tolls: 0, total: 15725 });
  for (const cls of Object.keys(DISTANCE_RATES)) {
    for (const airport of AIRPORT_PLACES) {
      for (const [tenths, minutes] of [[0, 0], [90, 18], [250, 45], [600, 180]]) {
        const fare = Math.max(AIRPORT_FARES[cls][airport], distanceFare(cls, tenths, minutes));
        assert.equal(priceDistance(cls, { tenths, minutes }, airport).fare, fare, `${cls} ${airport} ${tenths} ${minutes}`);
      }
      assert.equal(priceDistance(cls, { tenths: 0, minutes: 0 }, airport).fare, AIRPORT_FARES[cls][airport], `${cls} ${airport} floor`);
      assert.equal(priceDistance(cls, { tenths: 600, minutes: 180 }, airport).fare, distanceFare(cls, 600, 180), `${cls} ${airport} distance`);
    }
  }
  assert.deepEqual(priceDistance("suv", { tenths: 150, minutes: 45 }, ""), priceDistance("suv", { tenths: 150, minutes: 45 }));
});

await test("an airport trip to or from an address outside New York City is priced from the Google route at the airport fare or by distance and time, whichever is higher, with no tolls line and the after the ride note, in every class but the Luxury Sprinter", async () => {
  await withMock(async () => {
    const floor = await priced({ ...NJ_JFK, to_text: "Newark Liberty (EWR)", to_id: "ewr" });
    assert.deepEqual(pairs(floor.lines), [["Fare", 15500], [TAX, 1376], [BCF, 349]]);
    assert.deepEqual([floor.fare, floor.tax, floor.bcf, floor.tolls, floor.meet, floor.tip, floor.total, floor.value, floor.service], [AIRPORT_FARES.suv.ewr, 1376, 349, 0, 0, 0, 17225, 15500, "distance"]);
    assert.deepEqual(floor.notes, [POLICY.later.outside]);
    for (const cls of Object.keys(DISTANCE_RATES)) assert.equal((await priced({ ...NJ_JFK, to_text: "Newark Liberty (EWR)", to_id: "ewr", class: cls })).fare, AIRPORT_FARES[cls].ewr, cls);
    const suv = await priced(NJ_JFK);
    assert.deepEqual(pairs(suv.lines), [["Fare", 16425], [TAX, 1458], [BCF, 370]]);
    assert.deepEqual([suv.fare, suv.tolls, suv.total, suv.value, suv.service], [16425, 0, 18253, 16425, "distance"]);
    assert.deepEqual(suv.notes, [POLICY.later.outside]);
    const sedan = await priced({ ...NJ_JFK, class: "sedan" });
    assert.deepEqual(pairs(sedan.lines), [["Fare", 14151], [TAX, 1256], [BCF, 318]]);
    assert.equal(sedan.total, 15725);
    await isClass({ ...NJ_JFK, class: "sprinter" }, "sprinter-outside");
    const { trip } = await run({ ...NJ_JFK, class: "sprinter" });
    assert.deepEqual(["suv", "premium", "first", "sedan", "sprinter"].map((cls) => classTotal(trip, cls)), [18253, 22197, 29725, 15725, null]);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.airport, leg.direction, leg.reason, leg.ride]), [["outside", "jfk", "jfk", "to-airport", "", { tenths: 250, minutes: 45 }]]);
    assert.match(trip.route, ROUTE);
    assert.deepEqual([...readRoute(trip.route, NOW).values()].map(({ tenths, minutes }) => [tenths, minutes]), [[250, 45]]);
    assert.equal(serviceLabel({ ...trip, class: "suv" }), "Business SUV, 25.0 miles and 45 min");
    assert.equal(composeMessage({ ...trip, class: "suv" }, "48213590", 18253).split("\n").at(-1), "Total shown: $182.53");
    assert.equal((await priced({ ...NJ_JFK, to_text: "JFK Airport, Queens, NY 11430", to_id: "" })).total, 18253);
    assert.equal((await priced({ ...NJ_JFK, to_text: "Newark Liberty International Airport, 3 Brewster Rd, Newark, NJ 07114", to_id: "" })).total, 17225);
    assert.equal((await priced({ ...FROM_JFK, from_text: "JFK Airport, Queens, NY 11430", from_id: "", to_text: SECAUCUS })).total, 18935);
  });
});

await test("a JFK pickup to New Jersey keeps the flight number, meet and greet and the gratuity of an airport trip, and a drop-off at JFK from New Jersey offers no meet and greet", async () => {
  await withMock(async () => {
    const { trip, price } = await run({ ...JFK_NJ, flight: "EK 201", meet: "1", tip: "15" });
    assert.deepEqual([trip.flight, trip.meetOffered, trip.meet, trip.legs[0].direction, trip.legs[0].airport, trip.legs[0].ride], ["EK 201", true, true, "from-airport", "jfk", { tenths: 252, minutes: 50 }]);
    assert.deepEqual(pairs(price.lines), [["Fare", 16830], [TAX, 1494], [BCF, 379], ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2525]]);
    assert.deepEqual([price.tolls, price.total, price.value, price.service, price.notes], [0, 23728, 19330, "distance", [POLICY.later.outside]]);
    assert.equal(price.tip, Math.round((16830 * 15) / 100));
    const drop = await run({ ...NJ_JFK, flight: "EK 201", meet: "1" });
    assert.deepEqual([drop.trip.flight, drop.trip.meetOffered, drop.trip.meet, drop.price.meet, drop.price.total, drop.price.notes], ["", false, false, 0, 18253, [POLICY.later.outside]]);
    const sedan = await priced({ ...JFK_NJ, class: "sedan", tip: "15" });
    assert.deepEqual(pairs(sedan.lines), [["Fare", AIRPORT_FARES.sedan.jfk], [TAX, 1256], [BCF, 318], ["Gratuity for your chauffeur (15%)", 2123]]);
    assert.equal(sedan.total, 17848);
  });
});

await test("each ride of a return trip between an airport and an address outside New York City is priced from its own route and pickup time, each with its own airport floor", async () => {
  await withMock(async () => {
    const suv = await priced({ ...NJ_JFK, ...ROUND_TRIP, return_flight: "B6 1234" });
    assert.deepEqual(suv.legs.map((leg) => [leg.fare, leg.tax, leg.bcf, leg.tolls]), [[16425, 1458, 370, 0], [17040, 1512, 383, 0]]);
    assert.deepEqual(pairs(suv.lines), [["Fare", 33465], [TAX, 2970], [BCF, 753]]);
    assert.equal(suv.total, 37188);
    assert.deepEqual(suv.notes, [POLICY.later.outside]);
    const sedan = await priced({ ...NJ_JFK, ...ROUND_TRIP, class: "sedan" });
    assert.deepEqual(sedan.legs.map((leg) => leg.fare), [AIRPORT_FARES.sedan.jfk, AIRPORT_FARES.sedan.jfk]);
    assert.equal(sedan.total, 31450);
    const { trip } = await run({ ...NJ_JFK, ...ROUND_TRIP, return_flight: "B6 1234" });
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back, leg.ride]), [["outside", "jfk", false, { tenths: 250, minutes: 45 }], ["jfk", "outside", true, { tenths: 254, minutes: 52 }]]);
    assert.deepEqual([trip.return_flight, serviceLabel(trip)], ["B6 1234", "Business SUV, 2 rides, 50.4 miles and 97 min"]);
  });
});

await test("guardrails of an airport trip to an address outside New York City: long-trip over the limits, an airport ZIP code address, other airports, airport to airport and stops keep their requests, and no Google or no route keeps outside-city", async () => {
  await withMock(async () => {
    const LONG = { ...BASE, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: MONTAUK, to_id: "" };
    await isQuote(LONG, "long-trip");
    await isQuote({ ...LONG, ...ROUND_TRIP }, "long-trip");
    assert.deepEqual((await run(LONG)).trip.legs.map((leg) => [leg.reason, leg.ride]), [["long-trip", { tenths: 1046, minutes: 125 }]]);
    const out = routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString());
    const back = routeKey({ address: JFK_ADDRESS }, { address: SECAUCUS }, nycToUtc("2026-10-18", "18:00").toISOString());
    await isQuote({ ...NJ_JFK, route: signRoute([[out, 400, 181]], NOW) }, "long-trip");
    assert.equal((await priced({ ...NJ_JFK, route: signRoute([[out, 600, 180]], NOW) })).fare, distanceFare("suv", 600, 180));
    await isQuote({ ...NJ_JFK, ...ROUND_TRIP, route: signRoute([[out, 250, 45], [back, 400, 181]], NOW) }, "long-trip");
    await isQuote({ ...NJ_JFK, ...ROUND_TRIP, route: signRoute([[out, 250, 45], [back, 601, 60]], NOW) }, "long-trip");
    assert.equal((await priced({ ...NJ_JFK, ...ROUND_TRIP, route: signRoute([[out, 250, 45], [back, 600, 180]], NOW) })).fare, 16425 + distanceFare("suv", 600, 180));
    for (const text of ["3 Brewster Rd, Newark, NJ 07114", "Terminal B, Newark, NJ 07114", "1 Hotel Rd, Newark, NJ 07114", "111 Industrial Ave, Teterboro, NJ 07608"]) {
      await isQuote({ ...FROM_JFK, to_text: text }, "outside-city");
      await isQuote({ ...BASE, from_text: text }, "outside-city");
      await isQuote({ ...BASE, from_text: text, ...ROUND_TRIP }, "outside-city");
      const { trip } = await run({ ...FROM_JFK, to_text: text });
      assert.deepEqual([trip.to, trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["outside", "", [["outside-city", undefined]]], text);
    }
    await isQuote({ ...NJ_JFK, from_text: "Westchester County (HPN)", from_id: "hpn", to_text: SECAUCUS, to_id: "" }, "other-airport");
    await isQuote({ ...NJ_JFK, from_text: "Newark Liberty (EWR)", from_id: "ewr" }, "airport-to-airport");
    await isQuote({ ...NJ_JFK, stop1_text: MANHATTAN }, "stop-leg");
    await isQuote({ ...JFK_NJ, stop1_text: "Hoboken, NJ 07030" }, "stop-leg");
    assert.equal((await priced(BASE)).total, AIRPORT_TOTALS.suv.jfk);
  });
  await isQuote(NJ_JFK, "outside-city");
  await isQuote(JFK_NJ, "outside-city");
  await isQuote({ ...NJ_JFK, ...ROUND_TRIP }, "outside-city");
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    await isQuote({ ...NJ_JFK, date: "2026-10-21" }, "outside-city");
    assert.deepEqual(calls, ["https://routes.googleapis.com/directions/v2:computeRoutes"]);
    calls.length = 0;
    await isQuote({ ...FROM_JFK, to_text: "3 Brewster Rd, Newark, NJ 07114", date: "2026-10-21" }, "outside-city");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("the route of an airport trip to New Jersey comes from the server: its signed route token is reused, a token of another trip is ignored", async () => {
  await withMock(async () => {
    const fields = { ...NJ_JFK, date: "2026-10-23", time: "09:10" };
    const key = routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-23", "09:10").toISOString());
    const own = await run({ ...fields, route: signRoute([[key, 300, 60]], NOW) });
    assert.deepEqual([own.trip.legs[0].ride, own.price.fare, own.price.total], [{ tenths: 300, minutes: 60 }, 19400, 21559]);
    const other = await run({ ...fields, route: signRoute([[routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-24", "09:10").toISOString()), 300, 60]], NOW) });
    assert.deepEqual([other.trip.legs[0].ride, other.price.total], [{ tenths: 250, minutes: 45 }, 18253]);
  });
});

await test("receipt: an airport trip to New Jersey rebuilds its lines with meet and greet and the gratuity, no tolls line, the after the ride note of a trip priced by distance and time, and the miles and minutes", () => {
  const meta = { ref: "48213590", service: "distance", direction: "from-airport", airport: "jfk", class: "suv", legs: "1", miles: "25.2", minutes: "50", date: "2026-10-14", time: "07:30", flight: "EK 201", meet: "1", fare_cents: "16830", tax_cents: "1494", bcf_cents: "379", tolls_cents: "0", meet_cents: "2500", tip_percent: "15", tip_cents: "2525", total_cents: "23728" };
  const out = receipt(meta, ON);
  assert.equal(out.summary, "Wed, Oct 14, 2026, 7:30 AM. Business SUV, 25.2 miles and 50 min.");
  assert.deepEqual(pairs(out.lines), [["Fare", 16830], [TAX, 1494], [BCF, 379], ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2525]]);
  assert.equal(out.lines.reduce((sum, item) => sum + item.cents, 0), 23728);
  assert.deepEqual([out.notes, out.value], [[POLICY.later.outside], 19330]);
});

await test("an airport trip to or from text that names a New York City ZIP code or New York, NY and also another state or a ZIP code outside the city asks for the ZIP code or a pick, and never gets the price of an address outside New York City without its tolls line", async () => {
  await withMock(async () => {
    for (const text of ["350 5th Ave, New York, NY 10118, NJ", "350 5th Ave, 07030, New York, NY"]) {
      await isQuote({ ...BASE, from_text: text }, "unplaced", "from_text");
      await isQuote({ ...BASE, from_text: text, ...ROUND_TRIP }, "unplaced", "from_text");
      await isQuote({ ...FROM_JFK, to_text: text }, "unplaced", "to_text");
      await isQuote({ ...BASE, to_text: "LaGuardia (LGA)", to_id: "lga", from_text: text, class: "sedan" }, "unplaced", "from_text");
    }
    assert.deepEqual(pairs((await priced(BASE)).lines), LEG);
    assert.deepEqual([(await priced({ ...BASE, from_text: "New York Ave, Union City, NJ 07087" })).service, (await priced({ ...FROM_JFK, to_text: "100 Manhattan Ave, Union City, NJ" })).service], ["distance", "distance"]);
  });
});

await test("an end that names only an area gets no distance price: a borough, New York, a ZIP code or a state, typed or picked, asks for the street address on a trip with no airport end and on an airport trip to or from an address outside New York City, with no route lookup", async () => {
  await withMock(async () => {
    for (const [from_text, to_text] of [["Manhattan", "Brooklyn"], ["10001", "11201"], ["New York, NY", BROOKLYN], [MANHATTAN, "Queens"], ["Staten Island", "Manhattan"], ["Brooklyn 11201", "The Bronx"]]) {
      await isQuote({ ...RIDE, from_text, to_text }, "street-address");
      await isQuote({ ...RIDE, from_text, to_text, ...ROUND_TRIP }, "street-address");
    }
    const { trip } = await run({ ...RIDE, from_text: "Manhattan", to_text: "Brooklyn" });
    assert.deepEqual([trip.route, trip.ends.from.area, trip.ends.to.area, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", true, true, [["street-address", undefined]]]);
    for (const text of ["07030", "07030, NJ", "NJ 07094", "New Jersey 07030"]) {
      await isQuote({ ...JFK_NJ, to_text: text }, "street-address");
      await isQuote({ ...NJ_JFK, from_text: text }, "street-address");
      await isQuote({ ...NJ_JFK, from_text: text, ...ROUND_TRIP }, "street-address");
    }
    const picked = (id, zone, label, area) => signTicket(id, zone, label, NOW, area);
    await isQuote({ ...JFK_NJ, to_text: "Hoboken, NJ, USA", to_ticket: picked("mock-hoboken", "outside", "Hoboken, NJ, USA", true) }, "street-address");
    await isQuote({ ...RIDE, from_text: "Manhattan, New York, NY", from_ticket: picked("ChIJmanhattan", "manhattan", "Manhattan, New York, NY", true) }, "street-address");
    assert.equal((await priced({ ...JFK_NJ, to_text: "Hoboken, NJ, USA", to_ticket: picked("mock-hoboken", "outside", "Hoboken, NJ, USA", false) })).service, "distance");
    assert.equal((await priced({ ...RIDE, from_text: "Manhattan, New York, NY", from_ticket: picked("ChIJmanhattan", "manhattan", "Manhattan, New York, NY", false) })).service, "distance");
    for (const [from_text, to_text] of [["Upper East Side, New York, NY", "Williamsburg, Brooklyn, NY"], ["Times Square, New York, NY", BROOKLYN], [MANHATTAN, "Hoboken, NJ 07030"], [MANHATTAN, GREENWICH]]) assert.equal((await priced({ ...RIDE, from_text, to_text })).service, "distance", `${from_text} to ${to_text}`);
    assert.equal((await priced(NJ_JFK)).total, 18253);
    assert.equal((await priced({ ...BASE, from_text: "Manhattan" })).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...FROM_JFK, to_text: "Brooklyn" })).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...HOURLY, from_text: "Manhattan" })).total, 28337);
    for (const fields of [{ ...JFK_NJ, to_text: "Bergen County, NJ" }, { ...NJ_JFK, from_text: "Bergen County, NJ" }, { ...NJ_JFK, from_text: "Bergen County, NJ", ...ROUND_TRIP }, { ...JFK_NJ, to_text: "Fairfield County, CT" }, { ...RIDE, from_text: "Queens County" }, { ...RIDE, from_text: "Borough of Manhattan" }, { ...RIDE, from_text: "Manhattan Borough" }]) await isQuote(fields, "street-address");
    await isQuote({ ...RIDE, from_text: "07030", to_text: GREENWICH }, "outside-trip");
    await isQuote({ ...RIDE, from_text: "07114" }, "airport-zip");
  });
  await isQuote({ ...RIDE, from_text: "Manhattan", to_text: "Brooklyn" }, "no-airport");
  await isQuote({ ...JFK_NJ, to_text: "07030" }, "outside-city");
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    await isQuote({ ...RIDE, from_text: "Manhattan", to_text: "Brooklyn", date: "2026-10-21" }, "street-address");
    await isQuote({ ...JFK_NJ, to_text: "07030", date: "2026-10-21" }, "street-address");
    await isQuote({ ...JFK_NJ, to_text: "Bergen County, NJ", date: "2026-10-21" }, "street-address");
    await isQuote({ ...NJ_JFK, from_text: "Bergen County, NJ", ...ROUND_TRIP, date: "2026-10-16" }, "street-address");
    await isQuote({ ...RIDE, from_text: "Queens County", date: "2026-10-21" }, "street-address");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("a typed New York City name is routed inside its borough: the price asks Google for the name with its borough and NY, and a name with a borough gets NY, while an address with a ZIP code, NY or New York and a town outside the city go as typed", async () => {
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ routes: [{ duration: "1500s", distanceMeters: 8047 }] }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    for (const [to_text, address] of [["Civic Center", "Civic Center, Manhattan, NY"], ["Manhattan Beach", "Manhattan Beach, Brooklyn, NY"], ["South Beach", "South Beach, Staten Island, NY"], ["Castle Hill", "Castle Hill, The Bronx, NY"], ["Union Square", "Union Square, Manhattan, NY"], ["Vermont St, Brooklyn", "Vermont St, Brooklyn, NY"], [BROOKLYN, BROOKLYN], ["Times Square, New York", "Times Square, New York"], ["Hoboken, NJ 07030", "Hoboken, NJ 07030"]]) {
      sent.length = 0;
      const { price } = await run({ ...RIDE, to_text, date: "2026-10-27" });
      assert.deepEqual([sent.length, sent[0] && sent[0].origin, sent[0] && sent[0].destination], [1, { address: MANHATTAN }, { address }], to_text);
      assert.deepEqual([price && price.service, price && price.fare], ["distance", distanceFare("suv", 50, 25)], to_text);
    }
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("an airport typed with its code or named after a terminal gets its flat airport rate, and a typed JFK terminal pickup keeps meet and greet and the flight number, also on a trip to New Jersey", async () => {
  await withMock(async () => {
    for (const [to_text, airport] of [["LaGuardia Airport (LGA)", "lga"], ["JFK Airport (JFK)", "jfk"], ["Newark Liberty International Airport (EWR)", "ewr"], ["Teterboro Airport (TEB)", "teb"], ["Terminal 4, JFK Airport, Queens, NY", "jfk"], ["Terminal B, LaGuardia Airport, Queens, NY", "lga"], ["LaGuardia Airport (LGA), Queens, NY", "lga"], ["Terminal C, Newark Liberty International Airport, Newark, NJ", "ewr"]]) {
      const price = await priced({ ...BASE, to_text, to_id: "" });
      assert.deepEqual([price.service, price.total], ["airport", AIRPORT_TOTALS.suv[airport]], to_text);
    }
    const T4 = { ...FROM_JFK, from_text: "Terminal 4, JFK Airport, Queens, NY", from_id: "" };
    const { trip, price } = await run({ ...T4, flight: "B6 123", meet: "1" });
    assert.deepEqual([trip.from, trip.flight, trip.meetOffered, trip.meet, trip.legs[0].direction], ["jfk", "B6 123", true, true, "from-airport"]);
    assert.deepEqual(pairs(price.lines), [...LEG, ["Meet and greet", 2500]]);
    assert.equal(price.total, 21000);
    const nj = await run({ ...T4, to_text: SECAUCUS, flight: "EK 201", meet: "1" });
    assert.deepEqual([nj.trip.flight, nj.trip.meet, nj.trip.legs[0].airport, nj.trip.legs[0].ride, nj.price.service], ["EK 201", true, "jfk", { tenths: 254, minutes: 52 }, "distance"]);
    assert.deepEqual(pairs(nj.price.lines), [["Fare", 17040], [TAX, 1512], [BCF, 383], ["Meet and greet", 2500]]);
    await isQuote({ ...BASE, to_text: "LaGuardia Airport (JFK)", to_id: "" }, "unplaced", "to_text");
    await isQuote({ ...BASE, to_text: "New York (LGA)", to_id: "" }, "unplaced", "to_text");
    assert.equal((await priced({ ...RIDE, to_text: "Hilton, JFK, Queens" })).service, "distance");
  });
  assert.equal((await priced({ ...BASE, to_text: "Terminal 4, JFK Airport, Queens, NY", to_id: "" })).total, AIRPORT_TOTALS.suv.jfk);
});

await test("a place picked with a long Google place ID keeps its ticket: the ticket of a 239 character ID reaches the trip, so an intersection in Yonkers to JFK is priced as an address outside New York City instead of asking for a ZIP code", async () => {
  await withMock(async () => {
    const label = "Central Park Ave & Tuckahoe Rd, Yonkers, NY";
    const id = `Ei${"x".repeat(237)}`;
    const ticket = signTicket(id, "outside", label, NOW);
    assert.equal(ticket.length, 455);
    const { trip, price } = await run({ ...NJ_JFK, from_text: label, from_ticket: ticket });
    assert.deepEqual([trip.from, trip.ends.from.place, price && price.service, price && price.total], ["outside", id, "distance", 17225]);
    await isQuote({ ...NJ_JFK, from_text: label }, "unplaced", "from_text");
  });
});

await test("every ERRORS code and every REASONS key has a case", () => {
  assert.deepEqual([...seenErrors].sort(), Object.keys(ERRORS).sort());
  assert.deepEqual([...seenReasons].sort(), Object.keys(REASONS).sort());
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll book-pricing tests passed");
process.exit(0);
