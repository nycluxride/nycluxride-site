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
  sprinterFrom,
  noticeReason,
  REF,
  distanceFare,
  priceDistance,
  priceRide,
  legTax,
  priceLeg,
  withinLimits,
  serviceLabel,
  classTotal,
  shownLines,
  bagCounts,
  bagText,
  paxMeta,
  bookingData,
  rateKey,
  requestReason,
} from "../api/_trip.mjs";
import { ERRORS, REASONS, NOTES, POLICY, LABELS } from "../api/_copy.mjs";
import { MIN_NOTICE_MINUTES, SPRINTER_NOTICE_HOURS, AUTO_LEAD_MINUTES, DISTANCE_RATES, DISTANCE_LIMITS, DISTANCE_SKIP_ZIPS, AIRPORT_TOTALS, AIRPORT_FARES, AIRPORT_PLACES, CLASSES, VEHICLES, STOP_FEE_CENTS, percentCents } from "../api/_rates.mjs";
import * as RATES from "../api/_rates.mjs";
import { ROUTE, routeKey, signRoute, readRoute, signTicket, TICKET_TTL } from "../api/_ticket.mjs";
import { localById } from "../api/_places.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const BROOKLYN = "277 Bedford Ave, Brooklyn, NY 11211";
const BASE = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", action: "pay" };
const FROM_JFK = { ...BASE, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, to_id: "" };
const HOURLY = { trip_type: "hour", from_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "2", hours: "3", class: "sedan", action: "pay" };
const LEG = [["Fare", 15379], ["Service fee", 1845], ["Tolls and airport fees", 1276]];
const OLD_LEG = [["Fare", 15500], ["NYC sales tax", 1376], ["Black Car Fund", 349], ["Tolls and airport fees", 1275]];
const FEE = (fare) => percentCents(fare, RATES.FEE_PERCENT);

const seenErrors = new Set();
const seenReasons = new Set();

async function run(fields, settings = ON, now = NOW) {
  const trip = await resolveTrip(readInput(fields), { now });
  const result = checkTrip(trip, now, settings);
  if (result.kind === "invalid") seenErrors.add(result.code);
  if (result.kind === "quote") seenReasons.add(result.reason);
  if (result.kind === "price" && result.reason) seenReasons.add(result.reason);
  if (result.kind === "price" && result.hold) seenReasons.add(result.hold);
  return { trip, result, price: result.kind === "price" && (!result.reason || REQUEST.test(result.reason)) ? priceTrip(trip, settings) : null };
}

const REQUEST = /^sprinter-(check|quote)$/;
async function priced(fields, settings = ON) {
  const out = await run(fields, settings);
  assert.deepEqual(out.result, { kind: "price", reason: requestReason(out.trip, out.trip.class), hold: "" }, JSON.stringify(fields));
  return out.price;
}

const pairs = (lines) => lines.map(({ label, cents }) => [label, cents]);
const isError = async (fields, code, settings = ON, now = NOW) => assert.deepEqual((await run(fields, settings, now)).result, { kind: "invalid", code }, JSON.stringify(fields));
const isQuote = async (fields, reason, field = "", settings = ON, now = NOW) => assert.deepEqual((await run(fields, settings, now)).result, { kind: "quote", reason, field }, JSON.stringify(fields));
const isClass = async (fields, reason, settings = ON) => assert.deepEqual((await run(fields, settings)).result, { kind: "price", reason, hold: "" }, JSON.stringify(fields));
const isHold = async (fields, hold, settings = ON, now = NOW) => assert.deepEqual((await run(fields, settings, now)).result, { kind: "price", reason: "", hold }, JSON.stringify(fields));

const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

let failures = 0;
async function test(name, fn) {
  skew += 61000;
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
  ["Manhattan to Newark Terminal B, Executive Sedan", { ...BASE, to_text: "Newark Liberty (EWR), Terminal B", to_id: "ewr-tb", class: "sedan" }, 18000],
  ["Manhattan to Newark Terminal B, Business SUV", { ...BASE, to_text: "Newark Liberty (EWR), Terminal B", to_id: "ewr-tb" }, 19500],
  ["Manhattan to Newark Terminal B, Electric Class", { ...BASE, to_text: "Newark Liberty (EWR), Terminal B", to_id: "ewr-tb", class: "electric" }, 25000],
  ["Manhattan to JFK, Electric Class", { ...BASE, class: "electric" }, 25000],
  ["LaGuardia to Manhattan, Electric Class", { ...FROM_JFK, from_text: "LaGuardia (LGA)", from_id: "lga", class: "electric" }, 21500],
  ["Teterboro Jet Aviation to Manhattan, Electric Class", { ...FROM_JFK, from_text: "Teterboro (TEB), Jet Aviation", from_id: "teb-jet", class: "electric" }, 25000],
  ["Teterboro Jet Aviation to Manhattan, Luxury Sprinter", { ...FROM_JFK, from_text: "Teterboro (TEB), Jet Aviation", from_id: "teb-jet", class: "sprinter" }, AIRPORT_TOTALS["sprinter-executive"].teb],
  ["typed JFK alias to a typed Queens ZIP", { ...BASE, from_text: "jfk airport", to_text: "Astoria, NY 11102", to_id: "" }, 18500],
  ["Executive Sedan, 3 hours", HOURLY, 28560],
  ["Electric Class, 3 hours", { ...HOURLY, class: "electric" }, 42000],
  ["Electric Class, 12 hours", { ...HOURLY, class: "electric", hours: "12" }, 168000],
  ["Chevrolet Suburban or similar, 3 hours", { ...HOURLY, class: "suv", vehicle: "suv-suburban" }, 31920],
  ["Business Premium SUV, Cadillac Escalade ESV, 4 hours", { ...HOURLY, class: "premium", hours: "4" }, 47040],
  ["First Class, 3 hours", { ...HOURLY, class: "first" }, 58800],
  ["First Class, 12 hours", { ...HOURLY, class: "first", hours: "12" }, 235200],
  ["the retired suv-escalade key prices the default Business SUV vehicle, 3 hours", { ...HOURLY, class: "suv", vehicle: "suv-escalade" }, 31920],
  ["hourly from JFK, Executive Sedan, 3 hours", { ...HOURLY, from_text: "John F. Kennedy (JFK)", from_id: "jfk" }, 28560],
  ["hourly from LaGuardia, Executive Sedan, 3 hours", { ...HOURLY, from_text: "LaGuardia (LGA)", from_id: "lga" }, 28560],
  ["hourly from LaGuardia, Electric Class, 3 hours", { ...HOURLY, from_text: "LaGuardia (LGA)", from_id: "lga", class: "electric" }, 42000],
];

for (const [name, fields, total] of PRICED) {
  await test(`priced: ${name} is ${total} cents`, async () => assert.equal((await priced(fields)).total, total));
}

await test("the JFK drop-off lines, notes, value and service", async () => {
  const price = await priced(BASE);
  assert.deepEqual(pairs(price.lines), LEG);
  assert.deepEqual(price.notes, [NOTES.included, POLICY.later.airport]);
  assert.equal(NOTES.airport, NOTES.included + " " + POLICY.later.airport);
  assert.equal(price.value, 15379);
  assert.equal(price.service, "airport");
  assert.deepEqual([price.fare, price.fee, price.tolls, price.meet, price.tip, price.tipPercent, price.total], [15379, 1845, 1276, 0, 0, 0, AIRPORT_TOTALS.suv.jfk]);
  assert.equal(price.fee, Math.round(price.fare * 0.12));
  assert.equal("tax" in price || "bcf" in price, false);
});

await test("the JFK pickup with meet and greet and a 15% tip: lines in the contract order, the tip on the fare only", async () => {
  const price = await priced({ ...FROM_JFK, meet: "1", tip: "15" });
  assert.deepEqual(pairs(price.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(price.total, 23307);
  assert.equal(price.value, 17879);
});

await test("hourly lines have no tolls line and the hourly note", async () => {
  const price = await priced({ ...HOURLY, class: "suv", vehicle: "suv-denali" });
  assert.deepEqual(pairs(price.lines), [["Fare, 3 hours", 30000], ["Service fee", 3600]]);
  assert.deepEqual(price.notes, [POLICY.later.hourly]);
  assert.equal(NOTES.hourly, POLICY.later.hourly);
  assert.equal(price.service, "hourly");
});

await test("hourly meet and greet is offered from JFK, LaGuardia, Newark Liberty and Teterboro, one way from every priced airport, never on a drop-off or at another airport", async () => {
  assert.equal((await priced({ ...HOURLY, from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "1" })).meet, 2500);
  for (const [from_text, from_id] of [["LaGuardia (LGA)", "lga"], ["Newark Liberty (EWR)", "ewr"], ["Newark Liberty (EWR), Terminal C", "ewr-tc"], ["Teterboro (TEB)", "teb"], ["Teterboro (TEB), Signature Aviation East", "teb-sig-east"]]) {
    const { trip, price } = await run({ ...HOURLY, from_text: localById(from_id).label, from_id, meet: "1" });
    assert.deepEqual([trip.meetOffered, trip.meet, price.meet, pairs(price.lines).at(-1)], [true, true, 2500, ["Meet and greet", 2500]], from_text);
  }
  for (const from_id of ["hpn", "isp", "swf-atlantic"]) assert.deepEqual(await run({ ...HOURLY, from_text: localById(from_id).label, from_id, meet: "1" }).then(({ trip }) => [trip.meetOffered, trip.meet]), [false, false], from_id);
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
  for (const passengers of ["", "0", "15", "two", "1.5"]) await isError({ ...BASE, passengers }, "passengers");
  assert.equal((await priced({ ...BASE, class: "sprinter", passengers: "14" })).total, AIRPORT_TOTALS["sprinter-executive"].jfk);
  await isError({ ...HOURLY, hours: "" }, "hours");
  await isError({ ...HOURLY, hours: "3.5" }, "hours");
  await isError({ ...BASE, class: "" }, "class");
  await isError({ ...BASE, class: "limo" }, "class");
  await isError({ ...BASE, class: "", action: "quote" }, "class");
  const trip = { ...(await run(HOURLY)).trip, vehicle: "suv-bus" };
  const result = checkTrip(trip, NOW, ON);
  assert.deepEqual(result, { kind: "invalid", code: "vehicle" });
  seenErrors.add(result.code);
  await isClass({ ...BASE, to_text: "LaGuardia (LGA)", to_id: "lga", class: "sprinter", sprinter: "sprinter-white-limo" }, "sprinter-price");
  assert.equal((await priced({ ...BASE, class: "sprinter", sprinter: "sprinter-limo" })).total, AIRPORT_TOTALS["sprinter-limo"].jfk);
  await isError({ ...HOURLY, class: "sprinter", sprinter: "sprinter-luxury-jet", hours: "3" }, "sprinter-hours");
  for (const sprinter of ["sprinter-executive", "sprinter-limo"]) for (const event of ["", "yes", "1"]) assert.equal((await priced({ ...HOURLY, class: "sprinter", sprinter, hours: "4", passengers: "2", event })).fare, 4 * VEHICLES[sprinter].hourly, `${sprinter} ${event}`);
  await isError({ ...FROM_JFK, flight: "DL#401" }, "flight");
  await isError({ ...FROM_JFK, flight: "X".repeat(21) }, "flight");
  await isError({ ...BASE, return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "DL_401" }, "return_flight");
  for (const tip of ["5", "100", "x", "15%", "Custom", "other"]) await isError({ ...BASE, tip }, "tip");
  for (const tip_amount of ["", "0", "00", "1000000", "40.5", "40.00", "$40", "-1", "abc", "1e3", "9".repeat(30)]) await isError({ ...BASE, tip: "custom", tip_amount }, "tip_amount");
  await isError({ ...BASE, tip: "custom", tip_amount: "40", return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "DL_401" }, "return_flight");
  await isError({ ...BASE, tip: "custom", tip_amount: "0", passengers: "0" }, "passengers");
  for (const tip_amount of ["1", "40", "040", "500", "501", "999999"]) assert.equal((await run({ ...BASE, tip: "custom", tip_amount })).result.kind, "price", tip_amount);
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

await test("stops: without Google routes every trip with a stop is stop-leg, also one whose parts are all airport transfers, and an empty stop is ignored", async () => {
  await isQuote({ ...BASE, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: BROOKLYN, stop2_text: "", to_text: "John F. Kennedy (JFK)", to_id: "jfk" }, "stop-leg");
  await isQuote({ ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: BROOKLYN, to_id: "" }, "stop-leg");
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

await test("hourly reasons: outside-hourly for typed text outside the city with no pick, hours-range, the Sprinter 4-hour minimum, then the class reason seats with the Limo Sprinter's 10 seats", async () => {
  for (const from_text of ["Hoboken, NJ", "1332 Clinton Street, Hoboken, NJ 07030"]) await isQuote({ ...HOURLY, from_text }, "outside-hourly");
  for (const from_text of ["Newark Liberty (EWR)", "Teterboro (TEB)", "Westchester County (HPN)"]) assert.equal((await priced({ ...HOURLY, from_text })).fare, 25500, from_text);
  await isQuote({ ...HOURLY, hours: "2" }, "hours-range");
  await isQuote({ ...HOURLY, hours: "13" }, "hours-range");
  assert.equal((await priced({ ...HOURLY, hours: "12" })).fare, 102000);
  await isError({ ...HOURLY, class: "sprinter" }, "sprinter-hours");
  assert.equal((await priced({ ...HOURLY, class: "sprinter", hours: "4" })).fare, 70000);
  await isClass({ ...HOURLY, class: "sprinter", sprinter: "sprinter-white-limo", hours: "4", passengers: "11" }, "seats");
  assert.equal((await priced({ ...HOURLY, class: "sprinter", sprinter: "sprinter-white-limo", hours: "4", passengers: "10" })).fare, 110000);
  await isClass({ ...HOURLY, class: "sprinter", sprinter: "sprinter-luxury-jet", hours: "4", passengers: "9" }, "seats");
  assert.equal((await priced({ ...HOURLY, class: "sprinter", sprinter: "sprinter-luxury-jet", hours: "4", passengers: "8" })).fare, 86000);
  await isClass({ ...HOURLY, class: "sprinter", sprinter: "sprinter-presidential", hours: "4", passengers: "13" }, "seats");
  assert.equal((await priced({ ...HOURLY, class: "sprinter", sprinter: "sprinter-presidential", hours: "4", passengers: "12" })).fare, 98000);
  assert.equal((await priced({ ...HOURLY, class: "sprinter", sprinter: "sprinter-limo", hours: "4", passengers: "14" })).fare, 106000);
  assert.equal((await priced({ ...HOURLY, class: "sprinter", sprinter: "sprinter-executive", hours: "4", passengers: "14" })).fare, 70000);
  await isClass({ ...HOURLY, class: "premium", passengers: "7" }, "seats");
  await isClass({ ...HOURLY, class: "suv", vehicle: "suv-navigator", passengers: "7" }, "seats");
  await isClass({ ...BASE, class: "premium", passengers: "7" }, "seats");
  await isClass({ ...BASE, class: "suv", passengers: "7" }, "seats");
  for (const fields of [{ ...HOURLY, class: "premium", passengers: "6" }, { ...HOURLY, class: "suv", vehicle: "suv-navigator", passengers: "6" }, { ...BASE, class: "premium", passengers: "6" }, { ...BASE, class: "suv", passengers: "6" }]) await isClass(fields, "");
  assert.equal((await priced({ ...BASE, class: "premium", passengers: "5" })).total, 22000);
  await isClass({ ...BASE, class: "sedan", passengers: "4" }, "seats");
  await isClass({ ...BASE, class: "electric", passengers: "4" }, "seats");
  await isClass({ ...HOURLY, class: "electric", passengers: "4" }, "seats");
  assert.equal((await priced({ ...BASE, class: "electric", passengers: "3" })).total, 25000);
  assert.equal((await priced({ ...HOURLY, class: "electric", passengers: "3" })).total, 42000);
  await isClass({ ...BASE, class: "first", passengers: "4" }, "seats");
  await isClass({ ...BASE, class: "suv", passengers: "7" }, "seats");
  assert.equal((await priced({ ...BASE, class: "suv", passengers: "6" })).total, AIRPORT_TOTALS.suv.jfk);
  assert.equal((await priced({ ...BASE, class: "sprinter", passengers: "12" })).total, AIRPORT_TOTALS["sprinter-executive"].jfk);
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

await test("short-notice within 90 minutes of the earliest pickup, 89 minutes away is short notice and 90 or 91 is priced, far-ahead beyond 365 days", async () => {
  await isHold({ ...BASE, date: "2026-10-01", time: "12:10" }, "short-notice");
  await isHold({ ...BASE, date: "2026-10-01", time: "13:00" }, "short-notice");
  await isHold({ ...BASE, date: "2026-10-01", time: "13:29" }, "short-notice");
  await isHold({ ...BASE, date: "2026-10-01", time: "13:30" }, "");
  await isHold({ ...BASE, date: "2026-10-01", time: "13:31" }, "");
  await isHold({ ...BASE, date: "2026-10-01", time: "18:00" }, "");
  await isHold({ ...BASE, date: "2026-10-02", time: "11:00" }, "");
  await isHold({ ...BASE, date: "2027-10-01", time: "12:00" }, "");
  await isHold({ ...BASE, date: "2027-10-01", time: "12:01" }, "far-ahead");
  await isHold({ ...HOURLY, date: "2026-10-01", time: "13:29" }, "short-notice");
  await isHold({ ...HOURLY, date: "2026-10-01", time: "13:31" }, "");
  await isHold({ ...BASE, date: "2026-10-01", time: "13:31", return: "1", return_date: "2026-10-01", return_time: "18:00" }, "");
});

await test("the online notice is MIN_NOTICE_MINUTES, 90 minutes, checked against the instant: 89 minutes 59 seconds away is short notice, 90 and 91 minutes are priced", async () => {
  assert.equal(MIN_NOTICE_MINUTES, 90);
  assert.equal("MIN_NOTICE_HOURS" in RATES, false);
  const pickup = Date.parse("2026-10-14T11:30:00.000Z");
  for (const [ahead, hold] of [[89 * 60000, "short-notice"], [90 * 60000 - 1000, "short-notice"], [90 * 60000, ""], [91 * 60000, ""]]) await isHold(BASE, hold, ON, new Date(pickup - ahead));
});

await test("a Sprinter needs SPRINTER_NOTICE_HOURS, 3 hours, checked against the instant of the first pickup: 2 hours 59 minutes and 2 hours 59 minutes 59 seconds away are sprinter-notice, 3 hours and 3 hours 1 minute are priced, for each Sprinter", async () => {
  assert.equal(SPRINTER_NOTICE_HOURS, 3);
  const pickup = Date.parse("2026-10-14T11:30:00.000Z");
  const H = 3600000;
  for (const sprinter of Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === "sprinter")) {
    for (const [ahead, reason] of [[3 * H - 60000, "sprinter-notice"], [3 * H - 1000, "sprinter-notice"], [3 * H, "sprinter-check"], [3 * H + 60000, "sprinter-check"], [5 * 24 * H, "sprinter-check"]]) {
      assert.deepEqual((await run({ ...BASE, class: "sprinter", sprinter, passengers: "8" }, ON, new Date(pickup - ahead))).result, { kind: "price", reason, hold: "" }, `${sprinter} ${ahead}`);
    }
  }
  assert.deepEqual([noticeReason(BASE, "sprinter", pickup - 3 * H + 1), noticeReason(BASE, "sprinter", pickup - 3 * H), noticeReason(BASE, "suv", pickup - H), noticeReason({ ...BASE, date: "", time: "" }, "sprinter", pickup)], ["sprinter-notice", "", "", ""]);
});

await test("the Sprinter notice is the first pickup of a round trip, by the hour and from the airport, counts real hours across both clock changes, and never touches the other classes, which keep the 90 minute rule", async () => {
  const H = 3600000;
  const at = (iso) => new Date(iso);
  const sprinter = { ...BASE, class: "sprinter", passengers: "8" };
  const back = { return: "1", return_date: "2026-10-20", return_time: "18:00" };
  assert.deepEqual((await run({ ...sprinter, ...back }, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 2.5 * H))).result, { kind: "price", reason: "sprinter-notice", hold: "" }, "the first pickup is 2 hours 30 minutes away, the return is days away");
  assert.deepEqual((await run({ ...sprinter, ...back }, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 3 * H - 60000))).result, { kind: "price", reason: "sprinter-check", hold: "" });
  const hourly = { ...HOURLY, class: "sprinter", sprinter: "sprinter-limo", hours: "4", passengers: "10" };
  assert.deepEqual((await run(hourly, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 2.5 * H))).result, { kind: "price", reason: "sprinter-notice", hold: "" });
  assert.deepEqual((await run(hourly, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 3 * H))).result, { kind: "price", reason: "sprinter-quote", hold: "" });
  assert.deepEqual((await run({ ...FROM_JFK, class: "sprinter" }, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 2.5 * H))).result, { kind: "price", reason: "sprinter-notice", hold: "" });
  for (const cls of ["suv", "premium", "first", "sedan", "electric"]) {
    assert.deepEqual((await run({ ...BASE, class: cls }, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 2 * H))).result, { kind: "price", reason: "", hold: "" }, cls);
    assert.deepEqual((await run({ ...HOURLY, class: cls }, ON, new Date(Date.parse("2026-10-14T11:30:00.000Z") - 2 * H))).result, { kind: "price", reason: "", hold: "" }, cls);
  }
  const spring = at("2027-03-14T05:30:00.000Z");
  assert.deepEqual(sprinterFrom(spring), { date: "2027-03-14", time: "04:30" }, "12:30 AM on the day the clocks go forward plus 3 hours is 4:30 AM, 4 hours on the wall clock");
  for (const [time, reason] of [["04:20", "sprinter-notice"], ["04:29", "sprinter-notice"], ["04:30", "sprinter-check"]]) assert.deepEqual((await run({ ...sprinter, date: "2027-03-14", time }, ON, spring)).result, { kind: "price", reason, hold: "" }, time);
  const fall = at("2026-11-01T04:30:00.000Z");
  assert.deepEqual(sprinterFrom(fall), { date: "2026-11-01", time: "02:30" }, "12:30 AM on the day the clocks go back plus 3 hours is 2:30 AM, 2 hours on the wall clock");
  for (const [time, reason] of [["02:20", "sprinter-notice"], ["02:29", "sprinter-notice"], ["02:30", "sprinter-check"]]) assert.deepEqual((await run({ ...sprinter, date: "2026-11-01", time }, ON, fall)).result, { kind: "price", reason, hold: "" }, time);
  assert.deepEqual(sprinterFrom(at("2026-10-01T16:00:00.000Z")), { date: "2026-10-01", time: "15:00" });
  assert.deepEqual(sprinterFrom(at("2026-10-01T16:00:00.001Z")), { date: "2026-10-01", time: "15:01" }, "the first whole minute at least 3 hours away");
});

await test("SPRINTER_BUSY_HOURS, 24 hours: a Sprinter pickup under 24 hours away is busy, exactly 24 hours or more is not, and the other classes never are", async () => {
  const { sprinterBusy } = await import("../api/_trip.mjs");
  assert.equal(RATES.SPRINTER_BUSY_HOURS, 24);
  const H = 3600000;
  const pickup = Date.parse("2026-10-14T11:30:00.000Z");
  assert.deepEqual([24 * H - 1, 24 * H - 60000, 3 * H, 0].map((ahead) => sprinterBusy("sprinter", pickup, pickup - ahead)), [true, true, true, true]);
  assert.deepEqual([24 * H, 24 * H + 60000, 5 * 24 * H].map((ahead) => sprinterBusy("sprinter", pickup, pickup - ahead)), [false, false, false]);
  assert.deepEqual(Object.keys(CLASSES).filter((cls) => cls !== "sprinter").map((cls) => sprinterBusy(cls, pickup, pickup - H)), [false, false, false, false, false]);
  assert.deepEqual([sprinterBusy("sprinter", NaN, pickup), sprinterBusy("sprinter", pickup, NaN)], [false, false]);
});

await test("a paid session has the two SUVs line when its Stripe page showed it, and a session from before this release whose page did not has none, also under SPRINTER_BUSY_HOURS, with the session's creation time deciding only when Stripe sends no page text", async () => {
  const { sessionBusy } = await import("../api/_trip.mjs");
  const { SPRINTER_BUSY } = await import("../api/_copy.mjs");
  const pickup = "2026-10-14T11:30:00.000Z";
  const created = Math.floor((Date.parse(pickup) - 5 * 3600000) / 1000);
  const page = (message) => ({ created, custom_text: { submit: { message } } });
  assert.deepEqual([sessionBusy(page(`You pay the total shown today. ${SPRINTER_BUSY}`), "sprinter", pickup), sessionBusy(page("You pay the total shown today."), "sprinter", pickup), sessionBusy(page(`You pay the total shown today. ${SPRINTER_BUSY}`), "suv", pickup)], [true, false, false]);
  assert.deepEqual([sessionBusy({ created }, "sprinter", pickup), sessionBusy({ created, custom_text: { submit: null } }, "sprinter", pickup), sessionBusy({ created: created - 86400 }, "sprinter", pickup), sessionBusy({}, "sprinter", pickup)], [true, true, false, false]);
});

await test("the first Sprinter slot skips the repeated hour when the clocks go back, so the slot the server sends can be booked", async () => {
  const now = Date.parse("2026-11-01T03:30:00Z");
  const slot = sprinterFrom(now);
  assert.deepEqual(slot, { date: "2026-11-01", time: "02:00" }, "11:30 PM the day before plus 3 hours is 1:30 AM in the repeated hour, so the first slot is 2:00 AM");
  assert.equal(noticeReason({ ...BASE, ...slot }, "sprinter", now), "");
  assert.deepEqual((await run({ ...BASE, class: "sprinter", passengers: "8", ...slot }, ON, new Date(now))).result, { kind: "price", reason: "sprinter-check", hold: "" });
});

await test("the handler refuses a Sprinter pay post under 3 hours away with the sprinter-notice code before Stripe", async () => {
  const { POST } = await import("../api/book.mjs");
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(ny.formatToParts(new Date(realNow() + 2.5 * 3600000)).map(({ type, value }) => [type, value]));
  const fields = { ...BASE, class: "sprinter", date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, name: "Ana Lopez", email: "ana@example.com", phone: "+1 212 555 0100" };
  const res = await POST(new Request("https://www.nycluxride.com/api/book", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: "https://www.nycluxride.com" }, body: JSON.stringify(fields) }));
  const body = await res.json();
  assert.deepEqual([res.status, body], [422, { kind: "invalid", code: "sprinter-notice", field: "class", text: ERRORS["sprinter-notice"].text }]);
  seenErrors.add(body.code);
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

await test("firstSlot gives the R1 examples: the first New York 10-minute slot at least 90 minutes and 5 minutes ahead, skipping the clock-change hour", () => {
  const slot = (at) => firstSlot(new Date(at));
  assert.deepEqual([MIN_NOTICE_MINUTES, AUTO_LEAD_MINUTES], [90, 5]);
  assert.deepEqual(slot("2026-10-19T10:46:20-04:00"), { date: "2026-10-19", time: "12:30" });
  assert.deepEqual(slot("2026-10-19T10:25:00-04:00"), { date: "2026-10-19", time: "12:00" });
  assert.deepEqual(slot("2026-10-19T10:25:01-04:00"), { date: "2026-10-19", time: "12:10" });
  assert.deepEqual(slot("2026-10-19T22:16:00-04:00"), { date: "2026-10-20", time: "00:00" });
  assert.deepEqual(slot("2026-12-31T23:00:00-05:00"), { date: "2027-01-01", time: "00:40" });
  assert.equal(`${formatDate("2027-01-01")}, ${formatTime("00:40")}`, "Fri, Jan 1, 2027, 12:40 AM");
  assert.deepEqual(slot("2026-11-01T00:00:00-04:00"), { date: "2026-11-01", time: "02:00" });
  assert.deepEqual(slot("2026-10-31T23:58:00-04:00"), { date: "2026-11-01", time: "02:00" });
  assert.deepEqual(slot("2026-11-01T00:50:00-05:00"), { date: "2026-11-01", time: "02:30" });
  assert.deepEqual(slot("2027-03-14T00:00:00-05:00"), { date: "2027-03-14", time: "01:40" });
  assert.deepEqual(slot("2027-03-14T00:28:00-05:00"), { date: "2027-03-14", time: "03:10" });
  assert.deepEqual(firstSlot(Date.parse("2026-10-19T14:46:20Z")), { date: "2026-10-19", time: "12:30" });
});

await test("firstSlot is always bookable online: a 10-minute slot 95 to 105 minutes ahead, or 2:00 AM after the fall-back hour, never short notice and never in a clock-change hour", async () => {
  const { trip } = await run(BASE);
  let count = 0;
  for (const start of ["2026-10-19T00:00:00Z", "2026-10-31T16:00:00Z", "2027-03-13T16:00:00Z", "2026-12-31T16:00:00Z"]) {
    for (let now = Date.parse(start); now < Date.parse(start) + 86400000; now += 67000, count++) {
      const { date, time } = firstSlot(now);
      const at = `${new Date(now).toISOString()} gives ${date} ${time}`;
      const ahead = nycToUtc(date, time).getTime() - now;
      assert.match(time, /^([01]\d|2[0-3]):[0-5]0$/, at);
      assert.ok(ahead >= (MIN_NOTICE_MINUTES + AUTO_LEAD_MINUTES) * 60000, at);
      assert.ok(ahead < 105 * 60000 || (date === "2026-11-01" && time === "02:00"), at);
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
  "Vehicle: Executive Sprinter",
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
    composeMessage(trip, "48213590", 47040),
    ["Hi NYC LUX RIDE, I would like to book this trip.", "Reference: 48213590", "Trip: By the hour, 4 hours", "Pickup: 350 5th Ave, New York, NY 10118 (Manhattan)", "Date: Wed, Oct 14, 2026", "Time: 7:30 AM", "Passengers: 2", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Total shown: $470.40"].join("\n"),
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
  const KEYS = "trip_type from_text from_id from_ticket stop1_text stop1_id stop1_ticket stop2_text stop2_id stop2_ticket to_text to_id to_ticket date time flight return return_date return_time return_flight passengers seats dogs bags hours class vehicle suvVehicle sprinterVehicle meet tip tip_amount action nonce nlr_hp route from to ends legs meetOffered details";
  assert.deepEqual(Object.keys(trip).sort(), KEYS.split(" ").sort());
  assert.deepEqual([trip.stop1_text, trip.stop2_text, trip.return, trip.return_date, trip.return_time, trip.return_flight], ["s1", "s2", true, "2026-10-18", "18:00", "DL 402"]);
  const hourly = readInput({ ...HOURLY, to_text: "JFK", to_id: "jfk", stop1_text: "s1", return: "1", return_date: "2026-10-18", return_time: "18:00" });
  assert.deepEqual([hourly.to_text, hourly.to_id, hourly.stop1_text, hourly.return, hourly.return_date], ["", "", "", false, ""]);
  const one = readInput({ ...BASE, hours: "99", vehicle: "premium" });
  assert.deepEqual([one.hours, one.vehicle], ["", ""]);
  assert.equal(readInput({ ...BASE, return: "on" }).return, false);
  assert.equal("event" in readInput({ ...HOURLY, class: "sprinter", event: "1" }), false);
});

await test("hourly vehicle: suv with an suv-* key keeps it, otherwise the class default", () => {
  assert.equal(readInput({ ...HOURLY, class: "suv", vehicle: "suv-denali" }).vehicle, "suv-denali");
  assert.equal(readInput({ ...HOURLY, class: "suv", vehicle: "sedan" }).vehicle, "suv-suburban");
  assert.equal(readInput({ ...HOURLY, class: "suv", vehicle: "nope" }).vehicle, "suv-suburban");
  assert.equal(readInput({ ...HOURLY, class: "first", vehicle: "suv-denali" }).vehicle, "first");
  assert.equal(readInput({ ...HOURLY, class: "first", vehicle: "suv-denali" }).suvVehicle, "suv-denali");
  assert.equal(readInput({ ...HOURLY, class: "sprinter" }).vehicle, "sprinter-executive");
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
  const trip = readInput({ ...BASE, from_text: `  ${"A".repeat(250)}  `, passengers: " 02 ", from_id: "JFK", to_id: "a".repeat(25), from_ticket: "v1.short.mac", to_ticket: `v1.${"a".repeat(513)}.${"b".repeat(43)}` });
  assert.equal(trip.from_text, "A".repeat(200));
  assert.equal(trip.passengers, "2");
  assert.deepEqual([trip.from_id, trip.to_id, trip.from_ticket, trip.to_ticket], ["", "", "", ""]);
  const good = `v1.${"a".repeat(40)}.${"b".repeat(43)}`;
  assert.equal(readInput({ ...BASE, from_ticket: good }).from_ticket, good);
  const longest = `v1.${"a".repeat(512)}.${"b".repeat(43)}`;
  assert.deepEqual([longest.length, readInput({ ...BASE, to_ticket: longest }).to_ticket], [559, longest]);
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

await test("receipt: new sessions rebuild the checkout lines with one Service fee line from tax_cents, sessions paid with a Black Car Fund line keep their sales tax and Black Car Fund lines, legacy sessions keep their gratuity and sales tax lines", () => {
  const meta = { ref: "48213590", service: "airport", direction: "to-airport", airport: "jfk", class: "suv", legs: "1", date: "2026-10-15", time: "12:40", fare_cents: "15379", tax_cents: "1845", tolls_cents: "1276", meet_cents: "0", tip_percent: "15", tip_cents: "2307", total_cents: "20807" };
  const out = receipt(meta, ON);
  assert.equal(out.summary, "Thu, Oct 15, 2026, 12:40 PM. To JFK, Business SUV.");
  assert.deepEqual(pairs(out.lines), [...LEG, ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.deepEqual(out.notes, [NOTES.included, POLICY.later.airport]);
  assert.equal(out.value, 15379);
  assert.equal(out.lines.reduce((sum, item) => sum + item.cents, 0), Number(meta.total_cents));
  const before = { ...meta, fare_cents: "15500", tax_cents: "1376", bcf_cents: "349", tolls_cents: "1275", tip_cents: "2325", total_cents: "20825" };
  assert.deepEqual(pairs(receipt(before, ON).lines), [...OLD_LEG, ["Gratuity for your chauffeur (15%)", 2325]]);
  assert.deepEqual(pairs(shownLines(receipt(before, ON).lines)), [["Fare", 15500], ["Taxes and fees", 1725], ["Tolls", 1275], ["Gratuity for your chauffeur (15%)", 2325]]);
  assert.deepEqual(pairs(receipt({ ...before, tax_cents: "0", bcf_cents: "379" }, ON).lines).slice(1, 2), [["Black Car Fund", 379]]);
  assert.equal(receipt({ ...meta, legs: "2", direction: "from-airport" }, ON).summary, "Thu, Oct 15, 2026, 12:40 PM. Business SUV, 2 airport transfers.");
  const custom = receipt({ ...meta, tip_percent: "0", tip_cents: "4000", total_cents: "22500" }, ON);
  assert.deepEqual(pairs(custom.lines), [...LEG, ["Gratuity for your chauffeur", 4000]]);
  assert.equal(custom.value, 15379);
  const unlabeled = { ...meta, tip_cents: "4000" };
  delete unlabeled.tip_percent;
  assert.deepEqual(pairs(receipt(unlabeled, ON).lines).at(-1), ["Gratuity for your chauffeur", 4000]);
  const hourly = receipt({ ref: "48213590", service: "hourly", class: "premium", vehicle: "premium", hours: "4", date: "2026-12-01", time: "14:00", fare_cents: "42000", tax_cents: "5040", tolls_cents: "0", meet_cents: "0", tip_cents: "0", tip_percent: "0" }, ON);
  assert.equal(hourly.summary, "Tue, Dec 1, 2026, 2:00 PM. By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours.");
  assert.deepEqual(pairs(hourly.lines), [["Fare, 4 hours", 42000], ["Service fee", 5040]]);
  assert.deepEqual(pairs(receipt({ ref: "48213590", service: "hourly", class: "premium", vehicle: "premium", hours: "4", date: "2026-12-01", time: "14:00", fare_cents: "42000", tax_cents: "3728", bcf_cents: "945", tolls_cents: "0", meet_cents: "0", tip_cents: "0", tip_percent: "0" }, ON).lines), [["Fare, 4 hours", 42000], ["NYC sales tax", 3728], ["Black Car Fund", 945]]);
  assert.deepEqual(hourly.notes, [POLICY.later.hourly]);
  const legacy = { ref: "10000001", service: "transfer", direction: "from-airport", airport: "jfk", class: "suv", date: "2026-10-14", time: "07:30", fare_cents: "16500", meet_cents: "2500", gratuity_cents: "3300", tax_cents: "1686", total_cents: "23986" };
  assert.deepEqual(pairs(receipt(legacy, ON).lines), [["Fare", 16500], ["Meet and greet", 2500], ["Gratuity for your chauffeur (20%)", 3300], ["Sales tax", 1686]]);
  assert.deepEqual(pairs(receipt({ ...legacy, tax_cents: "0" }, ON, 1700).lines).at(-1), ["Sales tax", 1700]);
  assert.deepEqual(pairs(receipt({ ...legacy, tax_cents: "0" }, ON).lines).length, 3);
  assert.deepEqual(receipt({}, ON), { summary: "", lines: [], value: 0, notes: [NOTES.included, POLICY.later.airport] });
});

await test("shownLines, the display of the price box, the confirmation page and the emails: one Service fee line in the place of the fees, Tolls for the tolls, every other line and the total as charged, the charged lines untouched, and a session paid with sales tax and the Black Car Fund shows them as one Taxes and fees line", async () => {
  assert.deepEqual([LABELS.fee, LABELS.taxes, LABELS.tollsShort, LABELS.tax, LABELS.bcf, LABELS.tolls], ["Service fee", "Taxes and fees", "Tolls", "NYC sales tax", "Black Car Fund", "Tolls and airport fees"]);
  const price = await priced({ ...FROM_JFK, meet: "1", tip: "15", passengers: "3", infant_seats: "1", booster_seats: "1" });
  const charged = JSON.parse(JSON.stringify(price.lines));
  const shown = shownLines(price.lines);
  assert.deepEqual(pairs(shown), [["Fare", 15379], ["Service fee", 1845], ["Tolls", 1276], ["Meet and greet", 2500], ["Child seats (2 x $20.00)", 4000], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(1845, price.fee);
  assert.deepEqual(price.lines, charged);
  const paidBefore = receipt({ ref: "48213590", service: "hourly", class: "premium", vehicle: "premium", hours: "4", date: "2026-12-01", time: "14:00", fare_cents: "42000", tax_cents: "3728", bcf_cents: "945", tolls_cents: "0", meet_cents: "0", tip_cents: "0", tip_percent: "0" }, ON).lines;
  const paidNow = receipt({ ref: "48213590", service: "hourly", class: "premium", vehicle: "premium", hours: "4", date: "2026-12-01", time: "14:00", fare_cents: "42000", tax_cents: "5040", tolls_cents: "0", meet_cents: "0", tip_cents: "0", tip_percent: "0" }, ON).lines;
  for (const lines of [price.lines, (await priced(HOURLY)).lines, paidNow, paidBefore]) {
    const sum = (list) => list.reduce((total, item) => total + item.cents, 0);
    assert.equal(sum(shownLines(lines)), sum(lines));
    assert.equal(shownLines(lines).filter((item) => item.label === (lines === paidBefore ? "Taxes and fees" : "Service fee")).length, 1);
    assert.ok(!shownLines(lines).some((item) => /sales tax|Black Car Fund|airport fees|%\)$/.test(item.label) && !item.label.startsWith("Gratuity")), JSON.stringify(shownLines(lines)));
  }
  assert.deepEqual(pairs(shownLines(paidBefore)), [["Fare, 4 hours", 42000], ["Taxes and fees", 4673]]);
  assert.deepEqual(pairs(shownLines(paidNow)), [["Fare, 4 hours", 42000], ["Service fee", 5040]]);
  assert.deepEqual(pairs(shownLines((await priced(HOURLY)).lines)), [["Fare, 3 hours", 25500], ["Service fee", 3060]]);
  const legacy = receipt({ ref: "10000001", service: "transfer", direction: "from-airport", airport: "jfk", class: "suv", date: "2026-10-14", time: "07:30", fare_cents: "16500", meet_cents: "2500", gratuity_cents: "3300", tax_cents: "1686", total_cents: "23986" }, ON);
  assert.deepEqual(shownLines(legacy.lines), legacy.lines);
  assert.deepEqual(shownLines([]), []);
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
const RALEIGH = "Raleigh, NC";
const BAR_HARBOR = "Bar Harbor, ME 04609";
const RIDE = { ...BASE, to_text: BROOKLYN, to_id: "" };
const withMock = async (fn) => {
  process.env.GOOGLE_MOCK = "true";
  try {
    return await fn();
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
};

await test("the owner's distance and time rates and limits are in api/_rates.mjs, in cents, with a rate for every class, the Luxury Sprinter too, and no list of areas a ride must start or end in", () => {
  assert.deepEqual(DISTANCE_RATES, {
    suv: { base: 8500, mile: 400, minute: 65, minimum: 8500 },
    premium: { base: 9500, mile: 475, minute: 80, minimum: 9500 },
    first: { base: 10500, mile: 525, minute: 90, minimum: 17000 },
    sedan: { base: 7500, mile: 300, minute: 50, minimum: 7500 },
    electric: { base: 10621, mile: 442, minute: 74, minimum: 10621 },
    "sprinter-executive": { base: 8000, mile: 900, minute: 145, minimum: 35000 },
  });
  assert.deepEqual(RATES.LONG_RATES, {
    suv: { base: 0, mile: 410, minute: 25 },
    premium: { base: 0, mile: 470, minute: 30 },
    first: { base: 0, mile: 585, minute: 35 },
    sedan: { base: 0, mile: 370, minute: 20 },
    electric: { base: 0, mile: 514, minute: 28 },
    "sprinter-executive": { base: 7300, mile: 820, minute: 132 },
  });
  assert.deepEqual([RATES.SHORT_MILES, RATES.LONG_MILES, RATES.FEE_PERCENT, RATES.TIME_CAP_PER_MILE, RATES.TIME_CAP_BASE], [50, 75, "12", 2.5, 10]);
  for (const [key, rate] of Object.entries(DISTANCE_RATES)) assert.equal(rate.minimum, key === "sprinter-executive" ? 35000 : key === "first" ? 17000 : rate.base, key);
  assert.deepEqual(Object.keys(DISTANCE_RATES), Object.keys(CLASSES).map((cls) => rateKey(cls)));
  assert.equal(rateKey("sprinter"), "sprinter-executive");
  for (const key of ["sprinter-luxury-jet", "sprinter-presidential", "sprinter-limo", "sprinter-white-limo"]) assert.equal(key in DISTANCE_RATES, false, key);
  assert.ok(!("DISTANCE_AREAS" in RATES), "a ride needs no end in New York City");
  assert.deepEqual(DISTANCE_LIMITS, { miles: 500, minutes: 720 });
  assert.deepEqual(DISTANCE_SKIP_ZIPS, ["11430", "11371", "07114", "07608"]);
});

await test("distanceFare under SHORT_MILES is max(minimum, base + miles x per mile + billed minutes x per minute) in exact cents, with tenths of a mile and half cents rounded up, and billed minutes at most 2.5 a mile plus 10", () => {
  const CASES = [
    ["sedan", 0, 0, 7500],
    ["sedan", 46, 27, 9930],
    ["sedan", 150, 33, 13650],
    ["sedan", 150, 34, 13700],
    ["sedan", 150, 35, 13750],
    ["sedan", 314, 52, 19520],
    ["sedan", 316, 58, 19880],
    ["electric", 0, 0, 10621],
    ["electric", 46, 27, 14208],
    ["electric", 150, 35, 19841],
    ["electric", 314, 52, 28348],
    ["electric", 316, 58, 28880],
    ["suv", 0, 0, 8500],
    ["suv", 46, 27, 11705],
    ["suv", 150, 45, 17425],
    ["suv", 314, 52, 24440],
    ["premium", 9, 8, 10568],
    ["premium", 161, 20, 18748],
    ["premium", 163, 20, 18843],
    ["premium", 314, 52, 28575],
    ["first", 0, 0, 17000],
    ["first", 117, 15, 17993],
    ["first", 163, 40, 22658],
    ["first", 314, 52, 31665],
    ["sprinter", 0, 0, 35000],
    ["sprinter", 46, 27, 35000],
    ["sprinter", 125, 46, 35000],
    ["sprinter", 250, 30, 35000],
    ["sprinter", 266, 30, 36290],
    ["sprinter", 250, 45, 37025],
    ["sprinter", 314, 52, 43800],
  ];
  for (const [cls, tenths, minutes, cents] of CASES) {
    assert.equal(distanceFare(rateKey(cls), tenths, minutes), cents, `${cls} ${tenths / 10} mi ${minutes} min`);
    assert.ok(Number.isInteger(distanceFare(rateKey(cls), tenths, minutes)));
  }
  assert.deepEqual(priceDistance("suv", { tenths: 150, minutes: 45 }), { fare: 17425, fee: 2091, tolls: 0, total: 19516 });
  assert.deepEqual(priceDistance("sedan", { tenths: 46, minutes: 27 }), { fare: 9930, fee: 1192, tolls: 0, total: 11122 });
  assert.equal(distanceFare("sedan", 46, 27), 7500 + (46 * 300) / 10 + 21 * 50, "4.6 miles bills 21 of the 27 minutes");
  assert.deepEqual(priceDistance("electric", { tenths: 46, minutes: 27 }), { fare: 14208, fee: 1705, tolls: 0, total: 15913 });
  assert.equal(distanceFare("electric", 150, 35), 10621 + (150 * 442) / 10 + 35 * 74);
  assert.deepEqual(priceDistance("first", { tenths: 314, minutes: 52 }), { fare: 31665, fee: 3800, tolls: 0, total: 35465 });
  assert.equal(distanceFare("sprinter-executive", 314, 52), 8000 + (314 * 900) / 10 + 52 * 145);
  assert.deepEqual(priceDistance("sprinter-executive", { tenths: 314, minutes: 52 }), { fare: 43800, fee: 5256, tolls: 0, total: 49056 });
  assert.deepEqual(priceDistance("sprinter-executive", { tenths: 46, minutes: 27 }), { fare: 35000, fee: 4200, tolls: 0, total: 39200 });
});

await test("the limits: up to 500.0 miles and 720 minutes a ride are priced, 500.1 miles or 721 minutes are not, and rides over the old 60 miles and 180 minutes are priced", () => {
  assert.deepEqual([{ tenths: 5000, minutes: 720 }, { tenths: 5001, minutes: 10 }, { tenths: 10, minutes: 721 }, { tenths: 0, minutes: 0 }, { tenths: 601, minutes: 181 }, { tenths: 4000, minutes: 420 }].map(withinLimits), [true, false, false, true, true, true]);
});

await test("a one-way trip with no airport end is priced by distance and time from the Google route, in every class, the Luxury Sprinter too", async () => {
  await withMock(async () => {
    const price = await priced({ ...RIDE, class: "suv" });
    assert.deepEqual(pairs(price.lines), [["Fare", 11705], ["Service fee", 1405]]);
    assert.deepEqual([price.fare, price.fee, price.tolls, price.meet, price.tip, price.total, price.value, price.service], [11705, 1405, 0, 0, 0, 13110, 11705, "distance"]);
    assert.deepEqual(price.notes, [POLICY.later.hourly]);
    for (const [cls, total] of [["suv", 13110], ["premium", 14969], ["first", 19040], ["sedan", 11122], ["electric", 15913], ["sprinter", 39200]]) assert.equal((await priced({ ...RIDE, class: cls })).total, total, cls);
    for (const [cls, total] of [["suv", 27373], ["premium", 32004], ["first", 35465], ["sedan", 21862], ["electric", 31750], ["sprinter", 49056]]) assert.equal((await priced({ ...RIDE, to_text: GREENWICH, class: cls })).total, total, `${cls}: Manhattan to Connecticut carries the same 12% service fee`);
    for (const [cls, fare] of [["suv", 9380], ["premium", 10568], ["first", 17000], ["sedan", 8170], ["electric", 11611], ["sprinter", 35000]]) {
      const park = await priced({ ...RIDE, to_text: PARK, class: cls });
      const rate = DISTANCE_RATES[rateKey(cls)];
      assert.deepEqual([park.fare, park.fee], [fare, FEE(fare)], cls);
      assert.equal(park.fare, Math.max(rate.minimum, rate.base + Math.round((9 * rate.mile) / 10) + 8 * rate.minute), cls);
      assert.equal(park.fare === rate.minimum, cls === "sprinter" || cls === "first", `${cls}: only the Sprinter and First Class have a minimum above their base`);
    }
    const sprinter = await priced({ ...RIDE, class: "sprinter" });
    assert.deepEqual(pairs(sprinter.lines), [["Fare", 35000], ["Service fee", 4200]]);
    assert.deepEqual([sprinter.fare, sprinter.tolls, sprinter.total, sprinter.service, sprinter.notes], [Math.max(DISTANCE_RATES["sprinter-executive"].minimum, 8000 + (46 * 900) / 10 + 27 * 145), 0, 39200, "distance", [POLICY.later.hourly]]);
    const far = await priced({ ...RIDE, to_text: GREENWICH, class: "sprinter" });
    assert.deepEqual(pairs(far.lines), [["Fare", 8000 + (314 * 900) / 10 + 52 * 145], ["Service fee", 5256]]);
    assert.equal(far.total, 43800 + 5256);
    const { trip } = await run({ ...RIDE, class: "sprinter" });
    assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(trip, cls)), [13110, 14969, 19040, 11122, 15913, 39200]);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.reason, leg.ride]), [["manhattan", "brooklyn", "", { tenths: 46, minutes: 27 }]]);
    assert.equal(serviceLabel({ ...trip, class: "suv" }), "Business SUV, 4.6 miles and 27 min");
    assert.equal(composeMessage({ ...trip, class: "suv" }, "48213590", 13110).split("\n").at(-1), "Total shown: $131.10");
  });
});

await test("each ride of a return trip of that kind is priced from its own route and pickup time, then the service fee of each ride and the gratuity", async () => {
  await withMock(async () => {
    const back = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
    const both = await priced({ ...RIDE, ...back, class: "sedan" });
    assert.deepEqual(both.legs.map((leg) => [leg.fare, leg.fee]), [[9930, 1192], [10040, 1205]]);
    assert.deepEqual(pairs(both.lines), [["Fare", 19970], ["Service fee", 2397]]);
    assert.equal(both.total, 22367);
    const far = await priced({ ...RIDE, ...back, to_text: GREENWICH, class: "sedan", tip: "15" });
    assert.deepEqual(far.legs.map((leg) => [leg.fare, leg.fee, leg.tolls]), [[19520, 2342, 0], [19880, 2386, 0]]);
    assert.deepEqual(pairs(far.lines), [["Fare", 39400], ["Service fee", 4728], ["Gratuity for your chauffeur (15%)", 5910]]);
    assert.equal(far.total, 39400 + 4728 + 5910);
    const { trip } = await run({ ...RIDE, ...back, to_text: GREENWICH, class: "sedan" });
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back, leg.ride]), [["manhattan", "outside", false, { tenths: 314, minutes: 52 }], ["outside", "manhattan", true, { tenths: 316, minutes: 58 }]]);
    assert.equal(serviceLabel(trip), "Executive Sedan, 2 rides, 63.0 miles and 110 min");
    assert.equal(serviceLabel({ ...trip, class: "electric" }), "Electric Class, 2 rides, 63.0 miles and 110 min");
    assert.equal((await priced({ ...RIDE, class: "suv", tip: "custom", tip_amount: "40" })).total, 17110);
    assert.equal((await priced({ ...RIDE, class: "suv", tip: "20" })).total, 15451);
  });
});

await test("guardrails: both ends outside the five boroughs is priced, over 500 miles or 720 minutes is long-trip, no route keeps the no-airport request, airports keep their rules, a stop is priced over the whole route, and an airport to an address outside New York City pays at least the airport fare", async () => {
  await withMock(async () => {
    const both = await priced({ ...RIDE, from_text: "Hoboken, NJ 07030", to_text: GREENWICH });
    assert.deepEqual([both.service, both.fare, both.total], ["distance", distanceFare("suv", 168, 43), 20177]);
    await isQuote({ ...RIDE, to_text: RALEIGH }, "long-trip");
    await isQuote({ ...RIDE, to_text: BAR_HARBOR }, "long-trip");
    await isQuote({ ...RIDE, to_text: RALEIGH, return: "1", return_date: "2026-10-18", return_time: "18:00" }, "long-trip");
    assert.deepEqual([(await priced({ ...RIDE, to_text: MONTAUK })).fare, (await priced({ ...RIDE, to_text: MONTAUK })).total], [distanceFare("suv", 1183, 165), 58943]);
    const stop = await priced({ ...RIDE, stop1_text: PARK });
    assert.deepEqual([stop.service, stop.legs.length, stop.fare, stop.tolls], ["distance", 1, distanceFare("suv", 168, 43), 0]);
    assert.equal((await priced(BASE)).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...FROM_JFK, to_text: BROOKLYN })).total, AIRPORT_TOTALS.suv.jfk);
    const hoboken = await priced({ ...FROM_JFK, to_text: "Hoboken, NJ 07030" });
    assert.deepEqual([pairs(hoboken.lines), hoboken.tolls, hoboken.total, hoboken.service], [[["Fare", distanceFare("suv", 168, 43)], ["Service fee", 2162]], 0, 20177, "distance"]);
    assert.ok(hoboken.fare > AIRPORT_FARES.suv.jfk, "the distance fare is above the JFK floor");
    assert.equal((await priced({ ...HOURLY, from_text: BROOKLYN })).total, 28560);
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
    assert.deepEqual([own.trip.legs[0].ride, own.price.fare, own.price.total], [{ tenths: 150, minutes: 45 }, 17425, 19516]);
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
  assert.deepEqual(pairs(out.lines), [["Fare", 11000], ["NYC sales tax", 976], ["Black Car Fund", 248], ["Gratuity for your chauffeur (20%)", 2200]]);
  assert.deepEqual(out.notes, [POLICY.later.hourly]);
  assert.equal(out.value, 11000);
  assert.equal(receipt({ ...meta, legs: "2", miles: "9.4", minutes: "58", return_date: "2026-10-18", return_time: "18:00" }, ON).summary, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. Business SUV, 2 rides, 9.4 miles and 58 min.");
});

const SECAUCUS = "Secaucus, NJ 07094";
const JFK_ADDRESS = "John F. Kennedy International Airport, Queens, NY 11430";
const NJ_JFK = { ...BASE, from_text: SECAUCUS };
const JFK_NJ = { ...FROM_JFK, to_text: SECAUCUS };
const ROUND_TRIP = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
const TAX = "NYC sales tax";
const FEE_LINE = "Service fee";

await test("an airport fare is the floor of a ride between an airport and an address outside New York City: max(AIRPORT_FARES, distanceFare), then the service fee, no tolls", () => {
  assert.deepEqual([distanceFare("suv", 250, 45), distanceFare("sedan", 250, 45), distanceFare("sedan", 90, 18)], [21425, 17250, 11100]);
  assert.deepEqual(priceDistance("suv", { tenths: 250, minutes: 45 }, "jfk"), { fare: 21425, fee: 2571, tolls: 0, total: 23996 });
  assert.deepEqual(priceDistance("sedan", { tenths: 90, minutes: 18 }, "jfk"), { fare: AIRPORT_FARES.sedan.jfk, fee: 1685, tolls: 0, total: 15724 });
  assert.equal(priceDistance("sedan", { tenths: 90, minutes: 18 }, "jfk").total, AIRPORT_TOTALS.sedan.jfk - priceLeg("sedan", "jfk").tolls, "the floor is the flat total without its tolls");
  for (const cls of Object.keys(CLASSES)) {
    for (const airport of AIRPORT_PLACES) {
      for (const [tenths, minutes] of [[0, 0], [90, 18], [250, 45], [600, 180]]) {
        const fare = Math.max(AIRPORT_FARES[rateKey(cls)][airport], distanceFare(rateKey(cls), tenths, minutes));
        assert.equal(priceDistance(rateKey(cls), { tenths, minutes }, airport).fare, fare, `${cls} ${airport} ${tenths} ${minutes}`);
      }
      assert.equal(priceDistance(rateKey(cls), { tenths: 0, minutes: 0 }, airport).fare, AIRPORT_FARES[rateKey(cls)][airport], `${cls} ${airport} floor`);
      assert.equal(priceDistance(rateKey(cls), { tenths: 600, minutes: 180 }, airport).fare, distanceFare(rateKey(cls), 600, 180), `${cls} ${airport} distance`);
    }
  }
  assert.deepEqual(priceDistance("suv", { tenths: 150, minutes: 45 }, ""), priceDistance("suv", { tenths: 150, minutes: 45 }));
});

await test("an airport trip to or from an address outside New York City is priced from the Google route at the airport fare or by distance and time, whichever is higher, with no tolls line and the after the ride note, in every class, the Luxury Sprinter too", async () => {
  await withMock(async () => {
    const floor = await priced({ ...NJ_JFK, to_text: "Newark Liberty (EWR)", to_id: "ewr" });
    assert.deepEqual(pairs(floor.lines), [["Fare", 15375], [FEE_LINE, 1845]]);
    assert.deepEqual([floor.fare, floor.fee, floor.tolls, floor.meet, floor.tip, floor.total, floor.value, floor.service], [AIRPORT_FARES.suv.ewr, 1845, 0, 0, 0, 17220, 15375, "distance"]);
    assert.deepEqual(floor.notes, [POLICY.later.outside]);
    for (const cls of Object.keys(CLASSES)) assert.equal((await priced({ ...NJ_JFK, to_text: "Newark Liberty (EWR)", to_id: "ewr", class: cls })).fare, AIRPORT_FARES[rateKey(cls)].ewr, cls);
    const suv = await priced(NJ_JFK);
    assert.deepEqual(pairs(suv.lines), [["Fare", 21425], [FEE_LINE, 2571]], "Secaucus, New Jersey, to JFK carries the same 12% service fee");
    assert.deepEqual([suv.fare, suv.tolls, suv.total, suv.value, suv.service], [21425, 0, 23996, 21425, "distance"]);
    assert.deepEqual(suv.notes, [POLICY.later.outside]);
    const sedan = await priced({ ...NJ_JFK, class: "sedan" });
    assert.deepEqual(pairs(sedan.lines), [["Fare", 17250], [FEE_LINE, 2070]]);
    assert.equal(sedan.total, 19320);
    const sprinter = await priced({ ...NJ_JFK, class: "sprinter" });
    assert.deepEqual([distanceFare("sprinter-executive", 250, 45), 8000 + (250 * 900) / 10 + 45 * 145, AIRPORT_FARES["sprinter-executive"].jfk], [37025, 37025, 39039]);
    assert.equal(sprinter.fare, Math.max(AIRPORT_FARES["sprinter-executive"].jfk, distanceFare("sprinter-executive", 250, 45)));
    assert.deepEqual(pairs(sprinter.lines), [["Fare", AIRPORT_FARES["sprinter-executive"].jfk], [FEE_LINE, 4685]]);
    assert.deepEqual([sprinter.fare, sprinter.tolls, sprinter.total, sprinter.service, sprinter.notes], [AIRPORT_FARES["sprinter-executive"].jfk, 0, AIRPORT_FARES["sprinter-executive"].jfk + 4685, "distance", [POLICY.later.outside]]);
    assert.equal(sprinter.total, 43724, "Secaucus to JFK in the Executive Sprinter is $437.24");
    const direct = routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString());
    const beyond = await priced({ ...NJ_JFK, class: "sprinter", route: signRoute([[direct, 350, 60]], NOW) });
    assert.deepEqual([distanceFare("sprinter-executive", 350, 60) > AIRPORT_FARES["sprinter-executive"].jfk, beyond.fare, beyond.total, beyond.service], [true, distanceFare("sprinter-executive", 350, 60), priceRide("sprinter-executive", { tenths: 350, minutes: 60 }).total, "distance"]);
    assert.deepEqual(pairs(beyond.lines), [["Fare", 48200], [FEE_LINE, 5784]]);
    assert.equal(beyond.total, 53984);
    const floored = await priced({ ...NJ_JFK, to_text: "Newark Liberty (EWR)", to_id: "ewr", class: "sprinter" });
    assert.equal(distanceFare("sprinter-executive", 90, 18), DISTANCE_RATES["sprinter-executive"].minimum);
    assert.deepEqual(pairs(floored.lines), [["Fare", AIRPORT_FARES["sprinter-executive"].ewr], [FEE_LINE, 4952]]);
    assert.deepEqual([floored.tolls, floored.total, floored.service, floored.notes], [0, AIRPORT_TOTALS["sprinter-executive"].ewr - priceLeg("sprinter-executive", "ewr").tolls, "distance", [POLICY.later.outside]]);
    const { trip } = await run({ ...NJ_JFK, class: "sprinter" });
    assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(trip, cls)), [23996, 27972, 30996, 19320, 28001, 43724]);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.airport, leg.direction, leg.reason, leg.ride]), [["outside", "jfk", "jfk", "to-airport", "", { tenths: 250, minutes: 45 }]]);
    assert.match(trip.route, ROUTE);
    assert.deepEqual([...readRoute(trip.route, NOW).values()].map(({ tenths, minutes }) => [tenths, minutes]), [[250, 45]]);
    assert.equal(serviceLabel({ ...trip, class: "suv" }), "Business SUV, 25.0 miles and 45 min");
    assert.equal(composeMessage({ ...trip, class: "suv" }, "48213590", 23996).split("\n").at(-1), "Total shown: $239.96");
    assert.equal((await priced({ ...NJ_JFK, to_text: "JFK Airport, Queens, NY 11430", to_id: "" })).total, 23996);
    assert.equal((await priced({ ...NJ_JFK, to_text: "Newark Liberty International Airport, 3 Brewster Rd, Newark, NJ 07114", to_id: "" })).total, 17220);
    assert.equal((await priced({ ...FROM_JFK, from_text: "JFK Airport, Queens, NY 11430", from_id: "", to_text: SECAUCUS })).total, 24685);
  });
});

await test("a JFK pickup to New Jersey keeps the flight number, meet and greet and the gratuity of an airport trip, and a drop-off at JFK from New Jersey offers no meet and greet", async () => {
  await withMock(async () => {
    const { trip, price } = await run({ ...JFK_NJ, flight: "EK 201", meet: "1", tip: "15" });
    assert.deepEqual([trip.flight, trip.meetOffered, trip.meet, trip.legs[0].direction, trip.legs[0].airport, trip.legs[0].ride], ["EK 201", true, true, "from-airport", "jfk", { tenths: 252, minutes: 50 }]);
    assert.deepEqual(pairs(price.lines), [["Fare", 21830], [FEE_LINE, 2620], ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 3275]]);
    assert.deepEqual([price.tolls, price.total, price.value, price.service, price.notes], [0, 30225, 24330, "distance", [POLICY.later.outside]]);
    assert.equal(price.tip, Math.round((21830 * 15) / 100));
    const drop = await run({ ...NJ_JFK, flight: "EK 201", meet: "1" });
    assert.deepEqual([drop.trip.flight, drop.trip.meetOffered, drop.trip.meet, drop.price.meet, drop.price.total, drop.price.notes], ["", false, false, 0, 23996, [POLICY.later.outside]]);
    const sedan = await priced({ ...JFK_NJ, class: "sedan", tip: "15" });
    assert.deepEqual(pairs(sedan.lines), [["Fare", 17560], [FEE_LINE, 2107], ["Gratuity for your chauffeur (15%)", 2634]]);
    assert.equal(sedan.total, 22301);
    const sprinter = await priced({ ...JFK_NJ, class: "sprinter", tip: "15" });
    assert.deepEqual(pairs(sprinter.lines), [["Fare", AIRPORT_FARES["sprinter-executive"].jfk], [FEE_LINE, 4685], ["Gratuity for your chauffeur (15%)", 5856]], "the JFK floor holds on a pickup too");
  });
});

await test("each ride of a return trip between an airport and an address outside New York City is priced from its own route and pickup time, each with its own airport floor", async () => {
  await withMock(async () => {
    const suv = await priced({ ...NJ_JFK, ...ROUND_TRIP, return_flight: "B6 1234" });
    assert.deepEqual(suv.legs.map((leg) => [leg.fare, leg.fee, leg.tolls]), [[21425, 2571, 0], [22040, 2645, 0]]);
    assert.deepEqual(pairs(suv.lines), [["Fare", 43465], [FEE_LINE, 5216]]);
    assert.equal(suv.total, 48681);
    assert.deepEqual(suv.notes, [POLICY.later.outside]);
    const sedan = await priced({ ...NJ_JFK, ...ROUND_TRIP, class: "sedan" });
    assert.deepEqual(sedan.legs.map((leg) => leg.fare), [17250, 17720]);
    assert.equal(sedan.total, 39166);
    const sprinter = await priced({ ...NJ_JFK, ...ROUND_TRIP, class: "sprinter" });
    assert.deepEqual(sprinter.legs.map((leg) => leg.fare), [AIRPORT_FARES["sprinter-executive"].jfk, AIRPORT_FARES["sprinter-executive"].jfk], "each ride keeps its own JFK floor");
    assert.equal(sprinter.total, 2 * (39039 + 4685));
    const { trip } = await run({ ...NJ_JFK, ...ROUND_TRIP, return_flight: "B6 1234" });
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back, leg.ride]), [["outside", "jfk", false, { tenths: 250, minutes: 45 }], ["jfk", "outside", true, { tenths: 254, minutes: 52 }]]);
    assert.deepEqual([trip.return_flight, serviceLabel(trip)], ["B6 1234", "Business SUV, 2 rides, 50.4 miles and 97 min"]);
  });
});

await test("guardrails of an airport trip to an address outside New York City: long-trip over 500 miles or 720 minutes, an airport ZIP code address, other airports and airport to airport keep their requests, a stop is priced over the whole route at least at the airport fare, and no Google or no route keeps outside-city", async () => {
  await withMock(async () => {
    const LONG = { ...BASE, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: MONTAUK, to_id: "" };
    assert.equal((await priced(LONG)).fare, Math.max(AIRPORT_FARES.suv.jfk, distanceFare("suv", 1046, 125)));
    assert.equal((await priced({ ...LONG, ...ROUND_TRIP })).legs[0].fare, distanceFare("suv", 1046, 125));
    assert.deepEqual((await run(LONG)).trip.legs.map((leg) => [leg.reason, leg.ride]), [["", { tenths: 1046, minutes: 125 }]]);
    const out = routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString());
    const back = routeKey({ address: JFK_ADDRESS }, { address: SECAUCUS }, nycToUtc("2026-10-18", "18:00").toISOString());
    await isQuote({ ...NJ_JFK, route: signRoute([[out, 4000, 721]], NOW) }, "long-trip");
    await isQuote({ ...NJ_JFK, route: signRoute([[out, 5001, 180]], NOW) }, "long-trip");
    assert.equal((await priced({ ...NJ_JFK, route: signRoute([[out, 5000, 720]], NOW) })).fare, distanceFare("suv", 5000, 720));
    assert.equal((await priced({ ...NJ_JFK, route: signRoute([[out, 601, 181]], NOW) })).fare, distanceFare("suv", 601, 181));
    await isQuote({ ...NJ_JFK, ...ROUND_TRIP, route: signRoute([[out, 250, 45], [back, 4000, 721]], NOW) }, "long-trip");
    await isQuote({ ...NJ_JFK, ...ROUND_TRIP, route: signRoute([[out, 250, 45], [back, 5001, 60]], NOW) }, "long-trip");
    assert.equal((await priced({ ...NJ_JFK, ...ROUND_TRIP, route: signRoute([[out, 250, 45], [back, 5000, 720]], NOW) })).fare, 21425 + distanceFare("suv", 5000, 720));
    for (const text of ["3 Brewster Rd, Newark, NJ 07114", "Terminal B, Newark, NJ 07114", "1 Hotel Rd, Newark, NJ 07114", "111 Industrial Ave, Teterboro, NJ 07608"]) {
      await isQuote({ ...FROM_JFK, to_text: text }, "outside-city");
      await isQuote({ ...BASE, from_text: text }, "outside-city");
      await isQuote({ ...BASE, from_text: text, ...ROUND_TRIP }, "outside-city");
      const { trip } = await run({ ...FROM_JFK, to_text: text });
      assert.deepEqual([trip.to, trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["outside", "", [["outside-city", undefined]]], text);
    }
    await isQuote({ ...NJ_JFK, from_text: "Westchester County (HPN)", from_id: "hpn", to_text: SECAUCUS, to_id: "" }, "other-airport");
    await isQuote({ ...NJ_JFK, from_text: "Newark Liberty (EWR)", from_id: "ewr" }, "airport-to-airport");
    for (const [fields, direct] of [[{ ...NJ_JFK, stop1_text: MANHATTAN }, { tenths: 250, minutes: 45 }], [{ ...JFK_NJ, stop1_text: "Hoboken, NJ 07030" }, { tenths: 252, minutes: 50 }]]) {
      const stop = await priced(fields);
      const plain = priceRide("suv", direct, ["jfk"]);
      assert.ok(plain.total + STOP_FEE_CENTS > priceRide("suv", { tenths: 168, minutes: 43 }, ["jfk"]).total, fields.stop1_text);
      assert.deepEqual([stop.service, stop.legs, stop.fare, stop.tolls, stop.stops, stop.total, stop.notes, pairs(stop.lines).at(-1)], ["distance", [plain], plain.fare, 0, STOP_FEE_CENTS, plain.total + STOP_FEE_CENTS, [POLICY.later.outside], ["Extra stop", STOP_FEE_CENTS]], fields.stop1_text);
    }
    const whole = routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString(), [{ address: MANHATTAN }]);
    const far = await priced({ ...NJ_JFK, stop1_text: MANHATTAN, route: signRoute([[whole, 400, 90]], NOW) });
    assert.deepEqual([far.service, far.legs.length, far.fare, far.tolls, far.stops, far.total, far.notes, pairs(far.lines).map(([label]) => label)], ["distance", 1, distanceFare("suv", 400, 90), 0, 0, priceRide("suv", { tenths: 400, minutes: 90 }).total, [POLICY.later.outside], ["Fare", FEE_LINE]]);
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
    assert.deepEqual([own.trip.legs[0].ride, own.price.fare, own.price.total], [{ tenths: 300, minutes: 60 }, 24400, 27328]);
    const other = await run({ ...fields, route: signRoute([[routeKey({ address: SECAUCUS }, { address: JFK_ADDRESS }, nycToUtc("2026-10-24", "09:10").toISOString()), 300, 60]], NOW) });
    assert.deepEqual([other.trip.legs[0].ride, other.price.total], [{ tenths: 250, minutes: 45 }, 23996]);
  });
});

await test("receipt: an airport trip to New Jersey rebuilds its lines with meet and greet and the gratuity, no tolls line, the after the ride note of a trip priced by distance and time, and the miles and minutes", () => {
  const meta = { ref: "48213590", service: "distance", direction: "from-airport", airport: "jfk", class: "suv", legs: "1", miles: "25.2", minutes: "50", date: "2026-10-14", time: "07:30", flight: "EK 201", meet: "1", fare_cents: "21830", tax_cents: "2620", tolls_cents: "0", meet_cents: "2500", tip_percent: "15", tip_cents: "3275", total_cents: "30225" };
  const out = receipt(meta, ON);
  assert.equal(out.summary, "Wed, Oct 14, 2026, 7:30 AM. Business SUV, 25.2 miles and 50 min.");
  assert.deepEqual(pairs(out.lines), [["Fare", 21830], [FEE_LINE, 2620], ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 3275]]);
  assert.equal(out.lines.reduce((sum, item) => sum + item.cents, 0), 30225);
  assert.deepEqual([out.notes, out.value], [[POLICY.later.outside], 24330]);
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

await test("an end that names only an area gets no distance price: a pickup that names a borough, New York, a ZIP code, a county or a state, typed or picked, asks for the pickup street address on every trip type, a round trip asks for the return pickup, and a drop-off area asks for the street address on a trip priced by distance, with no route lookup", async () => {
  await withMock(async () => {
    for (const [from_text, to_text] of [["Manhattan", "Brooklyn"], ["10001", "11201"], ["New York, NY", BROOKLYN], ["Staten Island", "Manhattan"], ["Brooklyn 11201", "The Bronx"]]) {
      await isQuote({ ...RIDE, from_text, to_text }, "pickup-address");
      await isQuote({ ...RIDE, from_text, to_text, ...ROUND_TRIP }, "pickup-address");
    }
    for (const to_text of ["Queens", "Brooklyn", "11201", "New York, NY"]) {
      await isQuote({ ...RIDE, to_text }, "street-address");
      await isQuote({ ...RIDE, to_text, ...ROUND_TRIP }, "return-address");
    }
    const { trip } = await run({ ...RIDE, from_text: "Manhattan", to_text: "Brooklyn" });
    assert.deepEqual([trip.route, trip.ends.from.area, trip.ends.to.area, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", true, true, [["street-address", undefined]]]);
    for (const text of ["07030", "07030, NJ", "NJ 07094", "New Jersey 07030"]) {
      await isQuote({ ...JFK_NJ, to_text: text }, "street-address");
      await isQuote({ ...JFK_NJ, to_text: text, ...ROUND_TRIP }, "return-address");
      await isQuote({ ...NJ_JFK, from_text: text }, "pickup-address");
      await isQuote({ ...NJ_JFK, from_text: text, ...ROUND_TRIP }, "pickup-address");
    }
    const picked = (id, zone, label, area) => signTicket(id, zone, label, NOW, area);
    await isQuote({ ...JFK_NJ, to_text: "Hoboken, NJ, USA", to_ticket: picked("mock-hoboken", "outside", "Hoboken, NJ, USA", true) }, "street-address");
    await isQuote({ ...RIDE, from_text: "Manhattan, New York, NY", from_ticket: picked("ChIJmanhattan", "manhattan", "Manhattan, New York, NY", true) }, "pickup-address");
    assert.equal((await priced({ ...JFK_NJ, to_text: "Hoboken, NJ, USA", to_ticket: picked("mock-hoboken", "outside", "Hoboken, NJ, USA", false) })).service, "distance");
    assert.equal((await priced({ ...JFK_NJ, to_text: "Hoboken, NJ, USA", to_ticket: picked("mock-hoboken", "outside", "Hoboken, NJ, USA", 2) })).service, "distance");
    assert.equal((await priced({ ...RIDE, from_text: "Manhattan, New York, NY", from_ticket: picked("ChIJmanhattan", "manhattan", "Manhattan, New York, NY", false) })).service, "distance");
    for (const [from_text, to_text] of [["Upper East Side, New York, NY", "Williamsburg, Brooklyn, NY"], ["Times Square, New York, NY", BROOKLYN], [MANHATTAN, "Hoboken, NJ 07030"], [MANHATTAN, GREENWICH]]) assert.equal((await priced({ ...RIDE, from_text, to_text })).service, "distance", `${from_text} to ${to_text}`);
    assert.equal((await priced(NJ_JFK)).total, 23996);
    await isQuote({ ...BASE, from_text: "Manhattan" }, "pickup-address");
    await isQuote({ ...BASE, from_text: "Manhattan", ...ROUND_TRIP }, "pickup-address");
    assert.equal((await priced(BASE)).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...FROM_JFK, to_text: "Brooklyn" })).total, AIRPORT_TOTALS.suv.jfk);
    await isQuote({ ...FROM_JFK, to_text: "Brooklyn", ...ROUND_TRIP }, "return-address");
    await isQuote({ ...HOURLY, from_text: "Manhattan" }, "pickup-address");
    assert.equal((await priced(HOURLY)).total, 28560);
    for (const fields of [{ ...JFK_NJ, to_text: "Bergen County, NJ" }, { ...JFK_NJ, to_text: "Fairfield County, CT" }]) await isQuote(fields, "street-address");
    for (const fields of [{ ...NJ_JFK, from_text: "Bergen County, NJ" }, { ...NJ_JFK, from_text: "Bergen County, NJ", ...ROUND_TRIP }, { ...RIDE, from_text: "Queens County" }, { ...RIDE, from_text: "Borough of Manhattan" }, { ...RIDE, from_text: "Manhattan Borough" }, { ...HOURLY, from_text: "Queens County" }]) await isQuote(fields, "pickup-address");
    await isQuote({ ...RIDE, from_text: "07030", to_text: GREENWICH }, "pickup-address");
    await isQuote({ ...RIDE, from_text: "07114" }, "airport-zip");
  });
  await isQuote({ ...RIDE, from_text: "Manhattan", to_text: "Brooklyn" }, "no-airport");
  await isQuote({ ...JFK_NJ, to_text: "07030" }, "outside-city");
  await isQuote({ ...BASE, from_text: "Manhattan" }, "pickup-address");
  await isQuote({ ...HOURLY, from_text: "Manhattan" }, "pickup-address");
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    await isQuote({ ...RIDE, from_text: "Manhattan", to_text: "Brooklyn", date: "2026-10-21" }, "pickup-address");
    await isQuote({ ...RIDE, to_text: "Brooklyn", date: "2026-10-21" }, "street-address");
    await isQuote({ ...JFK_NJ, to_text: "07030", date: "2026-10-21" }, "street-address");
    await isQuote({ ...JFK_NJ, to_text: "Bergen County, NJ", date: "2026-10-21" }, "street-address");
    await isQuote({ ...NJ_JFK, from_text: "Bergen County, NJ", ...ROUND_TRIP, date: "2026-10-16" }, "pickup-address");
    await isQuote({ ...RIDE, from_text: "Queens County", date: "2026-10-21" }, "pickup-address");
    await isQuote({ ...RIDE, to_text: "Queens", ...ROUND_TRIP, date: "2026-10-16" }, "return-address");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("a Google pick whose ticket has expired and whose Place Details refresh fails is never priced from its label: a pickup or drop-off labeled 350 5th Ave, New York, NY 10118 but signed outside New York City in New Jersey goes to the dispatch request as unplaced, with no zone, region or place, also with Google off, while the same label typed with no ticket gets the Manhattan rate and a fresh ticket is priced where the signed place is", async () => {
  const OLD = NOW - (TICKET_TTL + 60) * 1000;
  const offline = async (fn) => {
    process.env.PLACE_TICKET_SECRET = "p".repeat(40);
    try {
      return await fn();
    } finally {
      delete process.env.PLACE_TICKET_SECRET;
    }
  };
  for (const google of [true, false]) {
    await (google ? withMock : offline)(async () => {
      const old = signTicket("mock-west350", "outside", MANHATTAN, OLD, 0, "NJ");
      assert.ok(old, "a signed ticket");
      const DROP = { ...FROM_JFK, to_ticket: old };
      await isQuote({ ...BASE, from_ticket: old }, "unplaced", "from_text");
      await isQuote(DROP, "unplaced", "to_text");
      await isQuote({ ...DROP, ...ROUND_TRIP }, "unplaced", "to_text");
      const { trip } = await run({ ...BASE, from_ticket: old });
      assert.deepEqual(trip.ends.from, { text: MANHATTAN, zone: "unknown", place: "", id: "" }, `google ${google}`);
    });
  }
  assert.equal((await priced(BASE)).total, AIRPORT_TOTALS.suv.jfk);
  await withMock(async () => {
    const price = await priced({ ...BASE, from_ticket: signTicket("mock-west350", "outside", MANHATTAN, NOW, 0, "NJ") });
    assert.deepEqual([price.service, price.fee], ["distance", FEE(price.fare)]);
    assert.notEqual(price.total, AIRPORT_TOTALS.suv.jfk);
  });
});

await test("the pickup must be an exact spot: a picked city, borough, neighborhood or ZIP code as the pickup of a one way trip priced by distance, an airport trip at the flat rate, an airport trip priced by distance, a trip with a stop priced online and an hourly booking asks for the pickup street address with no route lookup, also when its ticket has expired, while a map spot, a street address, a hotel, an airport and an intersection are exact and priced", async () => {
  await withMock(async () => {
    const t = (id, zone, label, level) => signTicket(id, zone, label, NOW, level);
    const PICKS = [
      ["Hoboken, NJ, USA", t("mock-hoboken", "outside", "Hoboken, NJ, USA", 2)],
      ["New York, NY, USA", t("ChIJnyc", "manhattan", "New York, NY, USA", 1)],
      ["Brooklyn, NY, USA", t("ChIJbrooklyn", "brooklyn", "Brooklyn, NY, USA", 1)],
      ["Upper East Side, New York, NY, USA", t("ChIJues", "manhattan", "Upper East Side, New York, NY, USA", 2)],
      ["New York, NY 10001, USA", t("ChIJ10001", "manhattan", "New York, NY 10001, USA", 1)],
    ];
    for (const [from_text, from_ticket] of PICKS) {
      const end = { from_text, from_ticket };
      await isQuote({ ...RIDE, ...end }, "pickup-address");
      await isQuote({ ...RIDE, ...end, ...ROUND_TRIP }, "pickup-address");
      await isQuote({ ...NJ_JFK, ...end }, "pickup-address");
      if (!from_text.startsWith("Hoboken")) {
        await isQuote({ ...BASE, ...end }, "pickup-address");
        await isQuote({ ...HOURLY, ...end }, "pickup-address");
      }
      const { trip } = await run({ ...RIDE, ...end });
      assert.deepEqual([trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", [["street-address", undefined]]], from_text);
    }
    const STOP = { stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk" };
    await isQuote({ ...RIDE, from_text: "Manhattan", ...STOP }, "pickup-address");
    for (const [from_text, from_ticket] of PICKS) await isQuote({ ...RIDE, from_text, from_ticket, ...STOP }, "pickup-address");
    assert.equal((await priced({ ...RIDE, ...STOP })).total, priceDistance("suv", { tenths: 168, minutes: 43 }, "jfk").total);
    const town = "Hoboken, NJ, USA";
    const old = signTicket("mock-hoboken", "outside", town, NOW - (TICKET_TTL + 60) * 1000, 2);
    for (let i = 0; i < 2; i++) await isQuote({ ...RIDE, from_text: town, from_ticket: old }, "pickup-address");
    await isQuote({ ...RIDE, to_text: town, to_ticket: old, ...ROUND_TRIP }, "return-address");
    assert.equal((await priced({ ...RIDE, to_text: town, to_ticket: old })).service, "distance");
    await isQuote({ ...HOURLY, from_text: "Hoboken, NJ, USA", from_ticket: PICKS[0][1] }, "pickup-address");
    await isQuote({ ...BASE, from_text: PICKS[3][0], from_ticket: PICKS[3][1], to_text: "Westchester County (HPN)", to_id: "hpn" }, "other-airport");
    await isQuote({ ...BASE, from_text: PICKS[3][0], from_ticket: PICKS[3][1], to_text: "CN Tower, 290 Bremner Blvd, Toronto, ON M5V 3L9", to_id: "" }, "outside-us");
    const EXACT = [
      ["277 Bedford Ave, Brooklyn, NY 11211", t("mock-bedford", "brooklyn", "277 Bedford Ave, Brooklyn, NY 11211", 0)],
      ["The New York EDITION, Madison Avenue, New York, NY", t("mock-edition", "manhattan", "The New York EDITION, Madison Avenue, New York, NY", 0)],
      ["Central Park Ave & Tuckahoe Rd, Yonkers, NY", signTicket("ChIJcorner", "outside", "Central Park Ave & Tuckahoe Rd, Yonkers, NY", NOW, 0, "6511")],
    ];
    for (const [from_text, from_ticket] of EXACT) {
      assert.equal((await priced({ ...RIDE, from_text, from_ticket })).service, "distance", from_text);
      assert.equal((await priced({ ...NJ_JFK, from_text, from_ticket })).service, from_text.includes("Yonkers") ? "distance" : "airport", from_text);
    }
    assert.equal((await priced({ ...HOURLY, from_text: EXACT[0][0], from_ticket: EXACT[0][1] })).service, "hourly");
    assert.equal((await priced({ ...BASE, from_text: EXACT[1][0], from_ticket: EXACT[1][1] })).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced(FROM_JFK)).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...FROM_JFK, ...ROUND_TRIP })).total, 2 * AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...HOURLY, from_text: "John F. Kennedy (JFK)", from_id: "jfk" })).service, "hourly");
    await isQuote({ ...RIDE, stop1_text: "Hoboken, NJ, USA", stop1_ticket: PICKS[0][1] }, "stop-address");
  });
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    process.env.PLACE_TICKET_SECRET = "p".repeat(40);
    const label = "Hoboken, NJ, USA";
    await isQuote({ ...RIDE, from_text: label, from_ticket: signTicket("mock-hoboken", "outside", label, NOW, 2), date: "2026-10-21" }, "pickup-address");
    await isQuote({ ...NJ_JFK, from_text: label, from_ticket: signTicket("mock-hoboken", "outside", label, NOW, 2), date: "2026-10-21" }, "pickup-address");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    delete process.env.PLACE_TICKET_SECRET;
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
    assert.deepEqual(pairs(nj.price.lines), [["Fare", 22040], [FEE_LINE, 2645], ["Meet and greet", 2500]]);
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
    const ticket = signTicket(id, "outside", label, NOW, 0, "6511");
    assert.equal(ticket.length, 470);
    const { trip, price } = await run({ ...NJ_JFK, from_text: label, from_ticket: ticket });
    assert.deepEqual([trip.from, trip.ends.from.place, trip.ends.from.region, price && price.service, price && price.total], ["outside", id, "6511", "distance", 20177]);
    const plain = await run({ ...NJ_JFK, from_text: label, from_ticket: signTicket(id, "outside", label, NOW) });
    assert.deepEqual([plain.trip.ends.from.region, plain.price && plain.price.total], ["NY", 20177], "the pick with no county is priced too");
    await isQuote({ ...NJ_JFK, from_text: label }, "unplaced", "from_text");
  });
});

const SECAUCUS_STREET = "806 6th Street, Secaucus, NJ";
const NIAGARA = "Niagara Falls, NY 14303";
const PHILADELPHIA = "1500 Market St, Philadelphia, PA 19102";
const BOSTON = "1 Beacon St, Boston, MA 02108";
const OWNER = { ...BASE, from_text: SECAUCUS_STREET, to_text: NIAGARA, to_id: "" };

await test("the owner's trip from 806 6th Street, Secaucus, NJ to Niagara Falls, NY, 400.0 miles and 420 minutes with no end in New York City, is priced on the long-distance card of LONG_RATES in every class: the Executive Sedan fare is 400 x 370 + 420 x 20 = 156,400 cents, the Business SUV fare 400 x 410 + 420 x 25 = 174,500 cents and the Luxury Sprinter fare 7300 + 400 x 820 + 420 x 132 = 390,740 cents, then the 12% service fee, with no charge for the drive back", async () => {
  await withMock(async () => {
    assert.deepEqual([400 * 370 + 420 * 20, 400 * 410 + 420 * 25, 7300 + 400 * 820 + 420 * 132], [156400, 174500, 390740]);
    const sedan = await priced({ ...OWNER, class: "sedan" });
    assert.deepEqual(pairs(sedan.lines), [["Fare", 156400], [FEE_LINE, 18768]], "Secaucus, New Jersey, to Niagara Falls carries the same 12% service fee");
    assert.deepEqual([sedan.fare, sedan.fee, sedan.tolls, sedan.meet, sedan.tip, sedan.total, sedan.value, sedan.service, sedan.notes], [156400, 18768, 0, 0, 0, 175168, 156400, "distance", [POLICY.later.hourly]]);
    const suv = await priced({ ...OWNER, class: "suv" });
    assert.deepEqual(pairs(suv.lines), [["Fare", 174500], [FEE_LINE, 20940]]);
    assert.equal(suv.total, 195440);
    const WANT = { suv: [174500, 195440], premium: [200600, 224672], first: [248700, 278544], sedan: [156400, 175168], electric: [217360, 243443], sprinter: [390740, 437629] };
    assert.deepEqual(Object.keys(WANT), Object.keys(CLASSES));
    for (const [cls, [fare, total]] of Object.entries(WANT)) {
      const rate = RATES.LONG_RATES[rateKey(cls)];
      assert.equal(fare, rate.base + 400 * rate.mile + 420 * rate.minute, cls);
      const price = await priced({ ...OWNER, class: cls });
      assert.deepEqual([price.fare, price.total, price.fare + price.fee, price.tolls, price.legs.length], [fare, total, total, 0, 1], cls);
      assert.equal(price.fare, distanceFare(rateKey(cls), 4000, 420), cls);
      assert.deepEqual(priceRide(rateKey(cls), { tenths: 4000, minutes: 420 }), { fare, fee: FEE(fare), tolls: 0, total }, cls);
    }
    const sprinter = await priced({ ...OWNER, class: "sprinter" });
    assert.deepEqual(pairs(sprinter.lines), [["Fare", 390740], [FEE_LINE, 46889]]);
    assert.deepEqual([sprinter.tolls, sprinter.total, sprinter.service, sprinter.notes], [0, 437629, "distance", [POLICY.later.hourly]]);
    const { trip } = await run({ ...OWNER, class: "sprinter" });
    assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(trip, cls)), [195440, 224672, 278544, 175168, 243443, 437629]);
    assert.deepEqual([trip.from, trip.to, trip.legs.map((leg) => [leg.from, leg.to, leg.airport, leg.reason, leg.ride])], ["outside", "outside", [["outside", "outside", "", "", { tenths: 4000, minutes: 420 }]]]);
    assert.match(trip.route, ROUTE);
    assert.deepEqual([...readRoute(trip.route, NOW).values()].map(({ tenths, minutes }) => [tenths, minutes]), [[4000, 420]]);
    assert.equal(serviceLabel({ ...trip, class: "suv" }), "Business SUV, 400.0 miles and 420 min");
    assert.equal(composeMessage({ ...trip, class: "suv" }, "48213590", 195440).split("\n").at(-1), "Total shown: $1,954.40");
    const round = await priced({ ...OWNER, ...ROUND_TRIP, class: "sedan" });
    assert.deepEqual(round.legs.map((leg) => [leg.fare, leg.fee]), [[156400, 18768], [distanceFare("sedan", 4004, 425), 18798]]);
    assert.deepEqual([round.fare, round.total], [156400 + 156648, 350614]);
    await isQuote({ ...OWNER, to_text: "Niagara Falls, NY" }, "unplaced", "to_text");
    await isQuote({ ...OWNER, to_text: "Niagara Falls, NY, USA", to_ticket: signTicket("ChIJniagara", "outside", "Niagara Falls, NY, USA", NOW, true) }, "street-address");
    assert.equal((await priced({ ...OWNER, to_text: "Niagara Falls State Park, Niagara Falls, NY, USA", to_ticket: signTicket("ChIJniagarapark", "outside", "Niagara Falls State Park, Niagara Falls, NY, USA", NOW) })).service, "distance");
  });
});

await test("a round trip to a picked city asks for the exact return pickup, a one way trip to the same city is priced, and the street address pickup to a picked Niagara Falls, NY city still gets its price", async () => {
  await withMock(async () => {
    const city = "Niagara Falls, NY, USA";
    const town = signTicket("ChIJniagara", "outside", city, NOW, 2);
    const one = await priced({ ...OWNER, to_text: city, to_ticket: town, class: "sedan" });
    assert.equal(one.service, "distance");
    assert.ok(one.total > 0);
    await isQuote({ ...OWNER, to_text: city, to_ticket: town, ...ROUND_TRIP }, "return-address");
    const hoboken = signTicket("mock-hoboken", "outside", "Hoboken, NJ, USA", NOW, 2);
    assert.equal((await priced({ ...RIDE, to_text: "Hoboken, NJ, USA", to_ticket: hoboken })).service, "distance");
    await isQuote({ ...RIDE, to_text: "Hoboken, NJ, USA", to_ticket: hoboken, ...ROUND_TRIP }, "return-address");
    await isQuote({ ...FROM_JFK, to_text: "Upper East Side, New York, NY, USA", to_ticket: signTicket("ChIJues", "manhattan", "Upper East Side, New York, NY, USA", NOW, 2), ...ROUND_TRIP }, "return-address");
    assert.equal((await priced({ ...FROM_JFK, to_text: "Upper East Side, New York, NY, USA", to_ticket: signTicket("ChIJues", "manhattan", "Upper East Side, New York, NY, USA", NOW, 2) })).total, AIRPORT_TOTALS.suv.jfk);
    assert.equal((await priced({ ...OWNER, ...ROUND_TRIP, class: "sedan" })).service, "distance");
  });
});

await test("Philadelphia to Boston, 308.6 miles and 322 minutes with neither end in or near New York City, is priced by distance and time in every class, the Luxury Sprinter too", async () => {
  await withMock(async () => {
    const fields = { ...BASE, from_text: PHILADELPHIA, to_text: BOSTON, to_id: "" };
    for (const cls of Object.keys(CLASSES)) {
      const price = await priced({ ...fields, class: cls });
      const want = priceRide(rateKey(cls), { tenths: 3086, minutes: 322 });
      assert.deepEqual([price.fare, price.fee, price.tolls, price.total, price.service, price.notes], [want.fare, want.fee, 0, want.total, "distance", [POLICY.later.hourly]], cls);
      const long = RATES.LONG_RATES[rateKey(cls)];
      assert.equal(price.fare, long.base + Math.round((3086 * long.mile) / 10) + 322 * long.minute, cls);
    }
    const suv = await priced(fields);
    assert.deepEqual([pairs(suv.lines), suv.total], [[["Fare", 134576], [FEE_LINE, 16149]], 150725]);
    const sprinter = await priced({ ...fields, class: "sprinter" });
    assert.deepEqual([pairs(sprinter.lines), sprinter.total], [[["Fare", 7300 + 253052 + 322 * 132], [FEE_LINE, 36343]], 339199]);
    const { trip } = await run(fields);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.reason, leg.ride]), [["outside", "outside", "", { tenths: 3086, minutes: 322 }]]);
    assert.equal(serviceLabel(trip), "Business SUV, 308.6 miles and 322 min");
  });
});

await test("over the limits the trip stays with dispatch as long-trip with today's text: 501.0 miles to Raleigh, NC and 721 minutes to Bar Harbor, ME, one way and round trip, while a ride of exactly 500.0 miles and 720 minutes is priced", async () => {
  assert.equal(REASONS["long-trip"].text, "For very long trips, we'll send you a price.");
  await withMock(async () => {
    for (const to_text of [RALEIGH, BAR_HARBOR]) {
      await isQuote({ ...RIDE, to_text }, "long-trip");
      await isQuote({ ...RIDE, to_text, ...ROUND_TRIP }, "long-trip");
      await isQuote({ ...RIDE, to_text, class: "sprinter" }, "long-trip");
    }
    assert.deepEqual((await run({ ...RIDE, to_text: RALEIGH })).trip.legs.map((leg) => [leg.reason, leg.ride]), [["long-trip", { tenths: 5010, minutes: 480 }]]);
    assert.deepEqual((await run({ ...RIDE, to_text: BAR_HARBOR })).trip.legs.map((leg) => [leg.reason, leg.ride]), [["long-trip", { tenths: 4800, minutes: 721 }]]);
    const key = routeKey({ address: MANHATTAN }, { address: RALEIGH }, nycToUtc("2026-10-14", "07:30").toISOString());
    const edge = await priced({ ...RIDE, to_text: RALEIGH, route: signRoute([[key, 5000, 720]], NOW) });
    assert.deepEqual([edge.fare, edge.service, edge.legs[0].fare], [distanceFare("suv", 5000, 720), "distance", 205000 + 18000]);
    for (const ride of [[5001, 720], [5000, 721]]) await isQuote({ ...RIDE, to_text: RALEIGH, route: signRoute([[key, ...ride]], NOW) }, "long-trip");
  });
});

await test("a trip with an end in Canada or Mexico stays with dispatch with the outside-us text: a Canadian postal code, a province or Canada or Mexico at the end of typed text, or a place Google puts outside the United States, one way, round trip, to or from an airport and in the Luxury Sprinter, with no route lookup, while hourly bookings, stops and text that can't be placed keep their requests", async () => {
  assert.deepEqual(REASONS["outside-us"], { group: "price", text: "For trips that start or end outside the United States, we'll send you a price." });
  assert.ok(!("outside-trip" in REASONS));
  await withMock(async () => {
    for (const text of ["CN Tower, 290 Bremner Blvd, Toronto, ON M5V 3L9", "Niagara Falls, Ontario", "Montreal, QC", "Toronto ON M5V 3L9", "Ottawa, Canada", "Cancún, Quintana Roo, México"]) {
      await isQuote({ ...RIDE, to_text: text }, "outside-us");
      await isQuote({ ...RIDE, from_text: text, to_text: MANHATTAN }, "outside-us");
      await isQuote({ ...OWNER, to_text: text, ...ROUND_TRIP }, "outside-us");
      await isQuote({ ...FROM_JFK, to_text: text }, "outside-us");
      await isQuote({ ...BASE, from_text: text }, "outside-us");
      await isQuote({ ...RIDE, to_text: text, class: "sprinter" }, "outside-us");
      const { trip } = await run({ ...RIDE, to_text: text });
      assert.deepEqual([trip.to, trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["abroad", "", [["outside-us", undefined]]], text);
    }
    const label = "CN Tower, Bremner Boulevard, Toronto, ON, Canada";
    await isQuote({ ...OWNER, to_text: label, to_ticket: signTicket("mock-cn-tower", "abroad", label, NOW) }, "outside-us");
    await isQuote({ ...OWNER, to_text: "Toronto Pearson Airport", to_ticket: signTicket("ChIJpearson", "abroad", "Toronto Pearson Airport", NOW) }, "outside-us");
    await isQuote({ ...RIDE, stop1_text: "Toronto, ON" }, "stop-leg");
    await isQuote({ ...HOURLY, from_text: "Toronto, ON" }, "outside-hourly");
    await isQuote({ ...RIDE, to_text: "Toronto" }, "unplaced", "to_text");
    await isQuote({ ...RIDE, from_text: "Toronto", to_text: "Toronto, ON" }, "unplaced", "from_text");
  });
  await isQuote({ ...RIDE, to_text: "Toronto, ON" }, "outside-us");
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    await isQuote({ ...RIDE, to_text: "Toronto, ON M5V 3L9", date: "2026-10-21" }, "outside-us");
    await isQuote({ ...FROM_JFK, to_text: "Montreal, QC", date: "2026-10-21" }, "outside-us");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("typed text that ends with the country code CA after a Canadian province or postal code, or with a Mexican state code and its postal code, stays with dispatch with the outside-us text and no route lookup, one way, round trip, to and from an airport and in the Luxury Sprinter, while US places that end in CA keep their price", async () => {
  const typed = ["1 Place Ville Marie, Montreal, QC H3B 2B6, CA", "Montreal, QC, CA", "Toronto, ON M5V 3L9, CA", "Vancouver, BC, CA", "Niagara Falls, ON, CA", "Montreal, Quebec, CA", "Tijuana, B.C. 22000", "Monterrey, N.L. 64000"];
  await withMock(async () => {
    for (const text of typed) {
      await isQuote({ ...RIDE, to_text: text }, "outside-us");
      await isQuote({ ...RIDE, from_text: text, to_text: MANHATTAN }, "outside-us");
      await isQuote({ ...OWNER, to_text: text, ...ROUND_TRIP }, "outside-us");
      await isQuote({ ...FROM_JFK, to_text: text }, "outside-us");
      await isQuote({ ...BASE, from_text: text }, "outside-us");
      await isQuote({ ...RIDE, to_text: text, class: "sprinter" }, "outside-us");
      const { trip } = await run({ ...RIDE, to_text: text });
      assert.deepEqual([trip.to, trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["abroad", "", [["outside-us", undefined]]], text);
    }
    for (const text of ["1 Civic Center Dr, Ontario, CA 91764", "123 Main St, Ontario, CA", "La Canada, CA 91011", "Vancouver, WA 98660"]) {
      const price = await priced({ ...RIDE, to_text: text });
      assert.ok(price.total > 0, text);
      const { trip } = await run({ ...RIDE, to_text: text });
      assert.equal(trip.to, "outside", text);
    }
  });
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    for (const text of typed) await isQuote({ ...RIDE, to_text: text, date: "2026-10-21" }, "outside-us");
    await isQuote({ ...FROM_JFK, to_text: "Montreal, QC, CA", date: "2026-10-21" }, "outside-us");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("trips between two airports and trips to or from Westchester (HPN), Long Island MacArthur (ISP), Stewart (SWF) or Republic (FRG) stay with dispatch under the US rule, as before, one way and round trip and with Google on, and ask for no route", async () => {
  const airport = (id) => ({ text: localById(id).label, id });
  const ends = (from, to) => ({ ...BASE, from_text: from.text ?? from, from_id: from.id ?? "", to_text: to.text ?? to, to_id: to.id ?? "" });
  const cases = [
    [airport("jfk"), airport("ewr"), "airport-to-airport"], [airport("lga"), airport("jfk"), "airport-to-airport"], [airport("ewr"), airport("teb"), "airport-to-airport"], [airport("jfk-t4"), airport("hpn"), "airport-to-airport"],
    [airport("hpn"), MANHATTAN, "other-airport"], [airport("isp"), PHILADELPHIA, "other-airport"], [SECAUCUS_STREET, airport("hpn"), "other-airport"], [airport("swf"), NIAGARA, "other-airport"], [BOSTON, airport("frg"), "other-airport"],
  ];
  await withMock(async () => {
    for (const [from, to, reason] of cases) {
      await isQuote(ends(from, to), reason);
      await isQuote({ ...ends(from, to), ...ROUND_TRIP }, reason);
      const { trip } = await run(ends(from, to));
      assert.deepEqual([trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", [[reason, undefined]]], JSON.stringify([from, to]));
    }
  });
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const calls = [];
  globalThis.fetch = async (url) => (calls.push(String(url)), new Response("{}", { status: 503 }));
  try {
    for (const [from, to, reason] of cases) await isQuote({ ...ends(from, to), date: "2026-10-21" }, reason);
    assert.deepEqual(calls.filter((url) => url.includes("routes.googleapis.com")), []);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("Philadelphia to JFK, 97.5 miles and 118 minutes, is priced at the airport fare or by distance and time, whichever is higher, in every class, the Luxury Sprinter too, with no tolls line and the after the ride note of an airport trip outside New York City", async () => {
  await withMock(async () => {
    const fields = { ...BASE, from_text: PHILADELPHIA };
    for (const cls of Object.keys(CLASSES)) {
      const price = await priced({ ...fields, class: cls });
      const fare = Math.max(AIRPORT_FARES[rateKey(cls)].jfk, distanceFare(rateKey(cls), 975, 118));
      assert.deepEqual([price.fare, price.fee, price.total, price.tolls, price.service, price.notes], [fare, FEE(fare), priceRide(rateKey(cls), { tenths: 975, minutes: 118 }, ["jfk"]).total, 0, "distance", [POLICY.later.outside]], cls);
      assert.equal(fare, distanceFare(rateKey(cls), 975, 118), cls);
    }
    const suv = await priced(fields);
    assert.deepEqual([pairs(suv.lines), suv.total], [[["Fare", 42925], [FEE_LINE, 5151]], 48076]);
    const sprinter = await priced({ ...fields, class: "sprinter" });
    assert.deepEqual([pairs(sprinter.lines), sprinter.total, sprinter.notes], [[["Fare", 7300 + 79950 + 118 * 132], [FEE_LINE, 12339]], 7300 + 79950 + 118 * 132 + 12339, [POLICY.later.outside]]);
    assert.ok(sprinter.fare > AIRPORT_FARES["sprinter-executive"].jfk);
    const { trip } = await run(fields);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.airport, leg.direction, leg.reason, leg.ride]), [["outside", "jfk", "jfk", "to-airport", "", { tenths: 975, minutes: 118 }]]);
    const key = routeKey({ address: PHILADELPHIA }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString());
    const floor = await priced({ ...fields, class: "sedan", route: signRoute([[key, 100, 20]], NOW) });
    assert.deepEqual([distanceFare("sedan", 100, 20) < AIRPORT_FARES.sedan.jfk, floor.fare, floor.total], [true, AIRPORT_FARES.sedan.jfk, 15724]);
  });
});

await test("airport transfers to or from a New York City address keep their flat totals in every class at JFK, LaGuardia, Newark and Teterboro, with the tolls line, one way and round trip, with or without Google and with any route token", async () => {
  const CODES = { jfk: "JFK", lga: "LGA", ewr: "EWR", teb: "TEB" };
  const check = async () => {
    for (const cls of Object.keys(CLASSES)) {
      for (const airport of AIRPORT_PLACES) {
        const to = await priced({ ...BASE, class: cls, to_text: CODES[airport], to_id: "" });
        const from = await priced({ ...FROM_JFK, class: cls, from_text: CODES[airport], from_id: "", to_text: BROOKLYN });
        const both = await priced({ ...BASE, class: cls, to_text: CODES[airport], to_id: "", ...ROUND_TRIP });
        const flat = AIRPORT_TOTALS[rateKey(cls)][airport];
        assert.deepEqual([to.total, from.total, both.total, to.service, to.fare, to.lines.at(-1).label], [flat, flat, 2 * flat, "airport", AIRPORT_FARES[rateKey(cls)][airport], "Tolls and airport fees"], `${cls} ${airport}`);
      }
    }
    const key = routeKey({ address: MANHATTAN }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString());
    assert.equal((await priced({ ...BASE, route: signRoute([[key, 5000, 720]], NOW) })).total, AIRPORT_TOTALS.suv.jfk);
  };
  await check();
  await withMock(check);
});

const SEATS_MAX = { infant_seats: "4", toddler_seats: "4", booster_seats: "4" };
const seatLine = (n) => [`Child seats (${n} x $20.00)`, n * 2000];

await test("child seats: CHILD_SEAT_CENTS is 2000 in api/_rates.mjs and the seat types are the child, infant and booster seats the car seat page names, each with its own form field", () => {
  assert.equal(RATES.CHILD_SEAT_CENTS, 2000);
  assert.deepEqual(RATES.CHILD_SEATS, ["toddler", "infant", "booster"]);
  assert.deepEqual(LABELS.seatTypes, { toddler: "Child seats", infant: "Infant seats", booster: "Booster seats" });
  assert.deepEqual(readInput({ ...BASE, infant_seats: " 02 ", toddler_seats: "", booster_seats: "1" }).seats, { toddler: "", infant: "2", booster: "1" });
  assert.deepEqual(readInput({ ...BASE, child_seats: "3", seats: "3" }).seats, { toddler: "", infant: "", booster: "" });
  assert.deepEqual(readInput({ ...HOURLY, booster_seats: "1" }).seats, { toddler: "", infant: "", booster: "1" });
});

await test("child seats on a one way airport trip: 0, 1 and the maximum of one seat per passenger (12 in a Luxury Sprinter) add count x $20.00 once as their own line after meet and greet and before the gratuity, with no service fee on them, like meet and greet, and the fare, fee, tolls and gratuity unchanged", async () => {
  const base = await priced({ ...FROM_JFK, meet: "1", tip: "15" });
  assert.deepEqual(pairs(base.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.deepEqual([base.seats, base.seatCount, base.total, base.value], [0, 0, 23307, 17879]);
  const one = await priced({ ...FROM_JFK, meet: "1", tip: "15", infant_seats: "1" });
  assert.deepEqual(pairs(one.lines), [...LEG, ["Meet and greet", 2500], seatLine(1), ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.deepEqual([one.fare, one.fee, one.tolls, one.meet, one.seats, one.seatCount, one.tip, one.total, one.value], [15379, 1845, 1276, 2500, 2000, 1, 2307, 25307, 19879]);
  const fare = AIRPORT_FARES["sprinter-executive"].jfk;
  const max = await priced({ ...FROM_JFK, meet: "1", tip: "15", class: "sprinter", passengers: "12", ...SEATS_MAX });
  const tip = RATES.percentCents(fare, "15");
  assert.deepEqual(pairs(max.lines).slice(3), [["Meet and greet", 2500], seatLine(12), ["Gratuity for your chauffeur (15%)", tip]]);
  assert.deepEqual([max.fare, max.seats, max.seatCount, max.total], [fare, 24000, 12, AIRPORT_TOTALS["sprinter-executive"].jfk + 2500 + 24000 + tip]);
  assert.equal(max.total, 77356);
  assert.equal(max.fee, FEE(fare), "the seats add no service fee");
  assert.equal(max.lines.reduce((sum, l) => sum + l.cents, 0), max.total);
  assert.equal((await priced({ ...BASE, passengers: "3", toddler_seats: "2" })).total, AIRPORT_TOTALS.suv.jfk + 4000);
});

await test("child seats on a round trip are charged once for the booking, not once per ride: 0, 1 and the maximum (12 in a Luxury Sprinter both ways)", async () => {
  const none = await priced({ ...BASE, ...ROUND_TRIP, class: "first", passengers: "3", tip: "10" });
  assert.deepEqual([none.legs.length, none.total], [2, 2 * AIRPORT_TOTALS.first.jfk + RATES.percentCents(2 * AIRPORT_FARES.first.jfk, "10")]);
  const one = await priced({ ...BASE, ...ROUND_TRIP, class: "first", passengers: "3", tip: "10", booster_seats: "1" });
  assert.deepEqual([one.legs.length, one.seats, one.total - none.total, one.tip], [2, 2000, 2000, none.tip]);
  assert.equal(one.lines.filter((l) => l.label.startsWith("Child seats")).length, 1);
  assert.deepEqual(one.lines.at(-2), { label: "Child seats (1 x $20.00)", cents: 2000 });
  const full = await priced({ ...BASE, ...ROUND_TRIP, class: "first", passengers: "3", infant_seats: "1", toddler_seats: "1", booster_seats: "1" });
  assert.equal(full.total, 2 * AIRPORT_TOTALS.first.jfk + 6000);
  const max = await priced({ ...BASE, ...ROUND_TRIP, class: "sprinter", passengers: "12", ...SEATS_MAX });
  assert.deepEqual([max.legs.length, max.seats, max.total], [2, 24000, 2 * AIRPORT_TOTALS["sprinter-executive"].jfk + 24000]);
  assert.deepEqual(pairs(max.lines).at(-1), seatLine(12));
});

await test("child seats on an hourly booking: 0, 1 and the maximum (3 in a Business SUV with 6 passengers) add count x $20.00 once, after the fare and the service fee, and the gratuity stays a percent of the fare", async () => {
  const fare = 8500 * 3;
  const none = await priced({ ...HOURLY, tip: "20" });
  assert.deepEqual(pairs(none.lines), [["Fare, 3 hours", fare], [FEE_LINE, 3060], ["Gratuity for your chauffeur (20%)", 5100]]);
  const one = await priced({ ...HOURLY, tip: "20", infant_seats: "1" });
  assert.deepEqual(pairs(one.lines), [["Fare, 3 hours", fare], [FEE_LINE, 3060], seatLine(1), ["Gratuity for your chauffeur (20%)", 5100]]);
  assert.deepEqual([one.total - none.total, one.value], [2000, fare + 2000]);
  const max = await priced({ ...HOURLY, class: "suv", vehicle: "suv-denali", passengers: "6", toddler_seats: "2", booster_seats: "1" });
  assert.deepEqual(pairs(max.lines), [["Fare, 3 hours", 30000], [FEE_LINE, 3600], seatLine(3)]);
  assert.equal(max.total, 30000 + 3600 + 6000);
});

await test("child seats on trips priced by distance and time: one way and return trip add count x $20.00 once on top of the route fare and the service fee", async () => {
  await withMock(async () => {
    const one = await priced({ ...RIDE, class: "suv", passengers: "3", booster_seats: "2" });
    assert.deepEqual(pairs(one.lines), [["Fare", 11705], [FEE_LINE, 1405], seatLine(2)]);
    assert.deepEqual([one.total, one.service], [13110 + 4000, "distance"]);
    const back = await priced({ ...RIDE, ...ROUND_TRIP, to_text: GREENWICH, class: "sedan", tip: "15", infant_seats: "1" });
    assert.deepEqual(pairs(back.lines), [["Fare", 39400], [FEE_LINE, 4728], seatLine(1), ["Gratuity for your chauffeur (15%)", 5910]]);
    assert.equal(back.total, 39400 + 4728 + 5910 + 2000);
  });
});

await test("the seat limit: at most one child seat per passenger, counted over the three types, on one way, round trip and hourly bookings, with bad counts refused", async () => {
  await isError({ ...BASE, passengers: "2", infant_seats: "3" }, "child_seats");
  await isError({ ...BASE, passengers: "2", infant_seats: "1", toddler_seats: "1", booster_seats: "1" }, "child_seats");
  await isError({ ...BASE, ...ROUND_TRIP, passengers: "1", booster_seats: "2" }, "child_seats");
  await isError({ ...HOURLY, passengers: "2", toddler_seats: "3" }, "child_seats");
  await isError({ ...BASE, class: "sprinter", passengers: "12", ...SEATS_MAX, booster_seats: "5" }, "child_seats");
  for (const bad of ["-1", "1.5", "x", "1e1", "0x1", "99999999999999999999999", "+1"]) await isError({ ...BASE, infant_seats: bad }, "child_seats");
  for (const ok of ["", "0", "00", " 2 ", "02"]) assert.deepEqual((await run({ ...BASE, class: "first", infant_seats: ok })).result, { kind: "price", reason: "", hold: "" }, ok);
  assert.equal((await priced({ ...BASE, class: "first", passengers: "2", infant_seats: "2" })).seatCount, 2);
  assert.equal((await priced({ ...HOURLY, class: "first", vehicle: "first", passengers: "2", infant_seats: "1", booster_seats: "1" })).seatCount, 2);
  await isError({ ...BASE, passengers: "15", infant_seats: "1" }, "passengers");
  assert.deepEqual(ERRORS.child_seats, { field: "child_seats", text: "Choose at most one child seat per passenger. Children count as passengers." });
});

await test("class totals and the too small car reason include the seats: every priced class card adds the seats once, the Sprinter keeps its own reasons, and a car with fewer seats than passengers keeps the seats reason", async () => {
  const { trip } = await run({ ...BASE, passengers: "3", toddler_seats: "1" });
  assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(trip, cls)), ["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => AIRPORT_TOTALS[rateKey(cls)].jfk + 2000));
  const two = await run({ ...BASE, passengers: "3", toddler_seats: "2" });
  assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(two.trip, cls)), [AIRPORT_TOTALS.suv.jfk + 4000, AIRPORT_TOTALS.premium.jfk + 4000, AIRPORT_TOTALS.first.jfk + 4000, null, null, AIRPORT_TOTALS["sprinter-executive"].jfk + 4000]);
  const crowd = await run({ ...BASE, passengers: "5", infant_seats: "5", class: "first" });
  assert.deepEqual(crowd.result, { kind: "price", reason: "seats", hold: "" });
  assert.equal(classTotal(crowd.trip, "first"), null);
  assert.equal(classTotal(crowd.trip, "suv"), null);
  assert.equal(classTotal(crowd.trip, "sprinter"), AIRPORT_TOTALS["sprinter-executive"].jfk + 10000);
});

await test("the reserve by email and WhatsApp messages and the dispatch quote path list each seat type with its count after meet and greet, only for the types chosen, and nothing when no seat is chosen", async () => {
  const { trip, price } = await run({ ...FROM_JFK, meet: "1", tip: "15", passengers: "5", infant_seats: "1", booster_seats: "2" });
  const text = composeMessage(trip, "48213590", price.total);
  assert.ok(text.includes("\nVehicle: Business SUV\nMeet and greet: Yes\nInfant seats: 1\nBooster seats: 2\nGratuity: 15%\nTotal shown: $293.07"), text);
  assert.ok(!text.includes("Child seats:") && !/toddler/i.test(text), text);
  const links = contactLinks(trip, "48213590", price.total);
  for (const href of [links.whatsapp, links.mailto]) assert.ok(decodeURIComponent(href).includes("\nInfant seats: 1\nBooster seats: 2\n"), href);
  assert.ok(!/seats: /.test(composeMessage((await run(FROM_JFK)).trip, "48213590", 18500)));
  for (const fields of [{ ...RIDE, to_text: "Niagara Falls, ON L2E 6T2", toddler_seats: "1" }, { ...HOURLY, hours: "13", toddler_seats: "1" }, { ...BASE, stop1_text: BROOKLYN, toddler_seats: "1" }]) {
    const out = await run(fields);
    assert.ok(["quote", "price"].includes(out.result.kind) && (out.result.reason || out.result.kind === "quote"), JSON.stringify(out.result));
    assert.ok(composeMessage(out.trip, "48213590").includes("\nChild seats: 1"), JSON.stringify(fields));
  }
});

await test("the receipt rebuilds the seat line from the payment metadata, with the price per seat it was paid at, adds it to the value, and leaves it out when the booking has no seats", () => {
  const meta = { ref: "48213590", service: "airport", direction: "from-airport", airport: "jfk", class: "suv", date: "2026-10-14", time: "07:30", legs: "1", fare_cents: "15379", tax_cents: "1845", tolls_cents: "1276", meet_cents: "2500", tip_percent: "15", tip_cents: "2307", seats_cents: "6000", child_seats: "3", infant_seats: "1", booster_seats: "2" };
  const r = receipt(meta, ON);
  assert.deepEqual(pairs(r.lines), [...LEG, ["Meet and greet", 2500], ["Child seats (3 x $20.00)", 6000], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(r.value, 15379 + 2500 + 6000);
  assert.equal(r.lines.reduce((sum, l) => sum + l.cents, 0), 29307);
  assert.deepEqual(pairs(receipt({ ...meta, seats_cents: "3000", child_seats: "2" }, ON).lines)[4], ["Child seats (2 x $15.00)", 3000], "an old booking keeps the price per seat it was paid at");
  assert.deepEqual(pairs(receipt({ ...meta, child_seats: "" }, ON).lines)[4], ["Child seats", 6000]);
  assert.deepEqual(pairs(receipt({ ...meta, child_seats: "7" }, ON).lines)[4], ["Child seats", 6000]);
  const none = { ...meta };
  for (const k of ["seats_cents", "child_seats", "infant_seats", "booster_seats"]) delete none[k];
  assert.deepEqual(pairs(receipt(none, ON).lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(receipt(none, ON).value, 17879);
  const paidBefore = receipt({ ...meta, fare_cents: "15500", tax_cents: "1376", bcf_cents: "349", tolls_cents: "1275", tip_cents: "2325" }, ON);
  assert.deepEqual(pairs(paidBefore.lines), [...OLD_LEG, ["Meet and greet", 2500], ["Child seats (3 x $20.00)", 6000], ["Gratuity for your chauffeur (15%)", 2325]], "a booking paid with sales tax and the Black Car Fund keeps its lines");
});

const LGA_ADDRESS = "LaGuardia Airport, East Elmhurst, NY 11371";
const ANN = "26 Ann St, New York, NY 10038";
const WALL = "40 Wall St, New York, NY 10005";
const CHURCH = "55 Church St, New York, NY 10007";
const STOPS = { ...BASE, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: ANN, to_text: CHURCH, to_id: "", time: "09:00" };
const stopKey = (stops, date = "2026-10-14", time = "09:00") => routeKey({ address: LGA_ADDRESS }, { address: CHURCH }, nycToUtc(date, time).toISOString(), stops.map((address) => ({ address })));
const rideOf = (trip) => trip.legs[0].ride;
const routesDown = async (fn) => {
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push(JSON.parse(init.body)), new Response("{}", { status: 503 }));
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
};

await test("the owner's trip with a stop, LaGuardia to 26 Ann St then 55 Church St a few blocks apart, costs the LaGuardia flat total plus STOP_FEE_CENTS from api/_rates.mjs, with its tolls line, an Extra stop line and the notes of an airport transfer, in every class, the Luxury Sprinter too, when that is more than the whole route by distance and time, and the whole route prices it when that costs more, as the 16.8 miles and 43 min of the mock route do in every car class", async () => {
  await withMock(async () => {
    assert.equal(STOP_FEE_CENTS, 2000);
    const { trip } = await run(STOPS);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.airport, leg.direction, leg.stops, leg.reason, leg.ride]), [["lga", "manhattan", "lga", "from-airport", 1, "", { tenths: 168, minutes: 43 }]]);
    assert.deepEqual(trip.legs[0].plain, { from: "lga", to: "manhattan", airport: "lga", direction: "from-airport", back: false, reason: "", salesTax: { area: "8081", percent: "8.875" } });
    const NEAR = signRoute([[stopKey([ANN]), 100, 30]], NOW);
    const OWNER = { suv: 18500, premium: 21000, first: 27000, sedan: 16500, electric: 23500, sprinter: 47000 };
    assert.deepEqual(Object.keys(OWNER), Object.keys(CLASSES));
    for (const [cls, total] of Object.entries(OWNER)) {
      const whole = priceDistance(rateKey(cls), { tenths: 100, minutes: 30 }, "lga");
      assert.ok(whole.fare === Math.max(AIRPORT_FARES[rateKey(cls)].lga, distanceFare(rateKey(cls), 100, 30)) && whole.total < total, cls);
      const price = await priced({ ...STOPS, class: cls, route: NEAR });
      assert.deepEqual([price.fare, price.tolls, price.stops, price.stopCount, price.total, price.service, price.notes, price.legs], [AIRPORT_FARES[rateKey(cls)].lga, priceLeg(rateKey(cls), "lga").tolls, 2000, 1, total, "airport", [NOTES.included, POLICY.later.airport], [priceLeg(rateKey(cls), "lga")]], cls);
      assert.deepEqual(price.lines.map((item) => item.label), ["Fare", FEE_LINE, "Tolls and airport fees", "Extra stop"], cls);
      assert.deepEqual([price.total, price.value], [AIRPORT_TOTALS[rateKey(cls)].lga + STOP_FEE_CENTS, AIRPORT_FARES[rateKey(cls)].lga + STOP_FEE_CENTS], cls);
    }
    const MOCK = { suv: 20177, premium: 23430, first: 25973, sedan: 16453, electric: 23776, sprinter: 47000 };
    for (const [cls, total] of Object.entries(MOCK)) {
      const whole = priceDistance(rateKey(cls), { tenths: 168, minutes: 43 }, "lga");
      const flat = AIRPORT_TOTALS[rateKey(cls)].lga - priceLeg(rateKey(cls), "lga").tolls + STOP_FEE_CENTS;
      const price = await priced({ ...STOPS, class: cls });
      assert.equal(price.total, total, cls);
      assert.equal(price.total, cls === "sprinter" ? flat + priceLeg(rateKey(cls), "lga").tolls : whole.total, cls);
      assert.equal(whole.total > flat, cls !== "sprinter", `${cls}: the whole route is dearer than the flat total plus the fee`);
      if (cls !== "sprinter") assert.deepEqual([price.fare, price.fee, price.stops, price.tolls, price.service, price.notes, price.lines.map((item) => item.label)], [distanceFare(rateKey(cls), 168, 43), FEE(price.fare), 0, 0, "distance", [POLICY.later.outside], ["Fare", FEE_LINE]], cls);
    }
    assert.deepEqual(["suv", "sprinter"].map((cls) => priceDistance(rateKey(cls), { tenths: 168, minutes: 43 }, "lga").total), [20177, AIRPORT_TOTALS["sprinter-executive"].lga - priceLeg("sprinter-executive", "lga").tolls], "the whole route alone");
    const sprinter = await priced({ ...STOPS, class: "sprinter" });
    assert.deepEqual([distanceFare("sprinter-executive", 168, 43), AIRPORT_FARES["sprinter-executive"].lga], [Math.max(35000, 8000 + 15120 + 43 * 145), 39039]);
    assert.deepEqual(pairs(sprinter.lines), [["Fare", 39039], [FEE_LINE, 4685], ["Tolls and airport fees", 1276], ["Extra stop", 2000]]);
    assert.deepEqual(pairs(shownLines(sprinter.lines)), [["Fare", 39039], [FEE_LINE, 4685], ["Tolls", 1276], ["Extra stop", 2000]]);
    assert.deepEqual([sprinter.total, sprinter.service, sprinter.notes], [AIRPORT_TOTALS["sprinter-executive"].lga + STOP_FEE_CENTS, "airport", [NOTES.included, POLICY.later.airport]]);
    assert.equal(sprinter.total, 47000, "the client's LaGuardia trip by 26 Ann St to 55 Church St in the Luxury Sprinter is $470.00");
    const extras = await priced({ ...STOPS, class: "sprinter", tip: "20", meet: "1", toddler_seats: "1" });
    assert.deepEqual([extras.fare, extras.fee, extras.stops, extras.meet, extras.seats, extras.tip, extras.total], [39039, 4685, 2000, 2500, 2000, percentCents(39039, "20"), 47000 + 2500 + 2000 + percentCents(39039, "20")], "the stop fee carries no service fee and is outside the gratuity, like meet and greet and child seats");
    assert.deepEqual(pairs(extras.lines).map(([label]) => label), ["Fare", FEE_LINE, "Tolls and airport fees", "Meet and greet", "Extra stop", "Child seats (1 x $20.00)", "Gratuity for your chauffeur (20%)"]);
    const owner = await priced({ ...STOPS, class: "sprinter", route: signRoute([[stopKey([ANN]), 125, 46]], NOW) });
    assert.deepEqual([distanceFare("sprinter-executive", 125, 46), 8000 + 11250 + 46 * 145], [35000, 25920]);
    assert.deepEqual([pairs(owner.lines), owner.total, (await priced({ ...STOPS, route: NEAR })).total], [pairs(sprinter.lines), AIRPORT_TOTALS["sprinter-executive"].lga + STOP_FEE_CENTS, 18500]);
    assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(trip, cls)), [20177, 23430, 25973, 16453, 23776, 47000]);
    const { trip: nearTrip } = await run({ ...STOPS, route: NEAR });
    assert.deepEqual(["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => classTotal(nearTrip, cls)), [18500, 21000, 27000, 16500, 23500, 47000]);
    assert.equal(serviceLabel(nearTrip), "From LaGuardia (LGA), Business SUV");
    assert.equal(serviceLabel(trip), "Business SUV, 16.8 miles and 43 min");
    assert.equal(composeMessage(nearTrip, "48213590", 18500), ["Hi NYC LUX RIDE, I would like to book this trip.", "Reference: 48213590", "Trip: One way", "Pickup: LaGuardia (LGA)", `Stop 1: ${ANN} (Manhattan)`, `Drop-off: ${CHURCH} (Manhattan)`, "Date: Wed, Oct 14, 2026", "Time: 9:00 AM", "Passengers: 2", "Vehicle: Business SUV", "Total shown: $185.00"].join("\n"));
    assert.deepEqual([...readRoute(trip.route, NOW).entries()].map(([key, { tenths, minutes }]) => [key, tenths, minutes]), [[stopKey([ANN]), 168, 43]], "a flat ride without the stop needs no route of its own");
    const far = { tenths: 250, minutes: 70 };
    for (const [cls, fare, stops] of [["suv", 23050, 0], ["premium", 26975, 0], ["first", 29925, 0], ["sedan", 18500, 0], ["electric", 26851, 0], ["sprinter", AIRPORT_FARES["sprinter-executive"].lga, 2000]]) {
      const price = await priced({ ...STOPS, class: cls, route: signRoute([[stopKey([ANN]), 250, 70]], NOW) });
      assert.deepEqual([price.fare, price.stops, price.total, price.service], [fare, stops, stops ? OWNER[cls] : priceDistance(rateKey(cls), far).total, stops ? "airport" : "distance"], cls);
      assert.equal(price.total, Math.max(priceDistance(rateKey(cls), far, "lga").total, OWNER[cls]), cls);
      assert.ok(price.total >= OWNER[cls], `${cls}: a far stop never costs less than a near one`);
    }
    const long = await priced({ ...STOPS, route: signRoute([[stopKey([ANN]), 250, 70]], NOW) });
    assert.deepEqual([long.fare, long.total, long.tolls, long.notes, long.lines.map((item) => item.label)], [distanceFare("suv", 250, 70), priceDistance("suv", far).total, 0, [POLICY.later.outside], ["Fare", FEE_LINE]]);
    const back = await priced({ ...STOPS, from_text: CHURCH, from_id: "", stop1_text: ANN, to_text: "LaGuardia (LGA)", to_id: "lga", meet: "1" });
    assert.deepEqual([back.fare, back.meet, back.stops, back.total, back.service], [distanceFare("suv", 168, 43), 0, 0, 20177, "distance"]);
    const backNear = await priced({ ...STOPS, from_text: CHURCH, from_id: "", stop1_text: ANN, to_text: "LaGuardia (LGA)", to_id: "lga", meet: "1", route: signRoute([[routeKey({ address: CHURCH }, { address: LGA_ADDRESS }, nycToUtc("2026-10-14", "09:00").toISOString(), [{ address: ANN }]), 100, 30]], NOW) });
    assert.deepEqual([backNear.fare, backNear.meet, backNear.stops, backNear.total, backNear.service], [AIRPORT_FARES.suv.lga, 0, 2000, 18500, "airport"]);
    for (const cls of Object.keys(CLASSES)) {
      const toJfk = await priced({ ...STOPS, class: cls, stop1_text: "Hoboken, NJ 07030", to_text: "John F. Kennedy (JFK)", to_id: "jfk" });
      const { trip: viaHoboken } = await run({ ...STOPS, class: cls, stop1_text: "Hoboken, NJ 07030", to_text: "John F. Kennedy (JFK)", to_id: "jfk" });
      const ride = viaHoboken.legs[0].ride;
      assert.deepEqual([toJfk.fare, toJfk.stops], [Math.max(AIRPORT_FARES[rateKey(cls)].lga, AIRPORT_FARES[rateKey(cls)].jfk, distanceFare(rateKey(cls), ride.tenths, ride.minutes)), 0], `${cls} from LaGuardia to JFK has no price without the stop, so the whole route prices it`);
      const { trip: back, price: backPrice } = await run({ ...FROM_JFK, class: cls, stop1_text: "Hoboken, NJ 07030", to_text: "LaGuardia (LGA)", to_id: "lga" });
      assert.equal(backPrice.fare, Math.max(AIRPORT_FARES[rateKey(cls)].lga, AIRPORT_FARES[rateKey(cls)].jfk, distanceFare(rateKey(cls), back.legs[0].ride.tenths, back.legs[0].ride.minutes)), `${cls} from JFK to LaGuardia`);
      if (cls === "suv") assert.deepEqual([ride, toJfk.fare], [{ tenths: 168, minutes: 43 }, 18015]);
      if (cls === "sprinter") assert.equal(toJfk.fare, AIRPORT_FARES["sprinter-executive"].jfk, "the JFK floor prices the Sprinter");
    }
  });
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ routes: [{ duration: "4200s", distanceMeters: 40234 }] }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    const price = (await run({ ...STOPS, date: "2026-10-28" })).price;
    assert.deepEqual([sent.length, sent[0].origin, sent[0].intermediates, sent[0].destination], [1, { address: LGA_ADDRESS }, [{ address: ANN }], { address: CHURCH }]);
    assert.deepEqual([price.fare, price.service], [distanceFare("suv", 250, 70), "distance"]);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("the stop fee and the whole route are compared like for like: the flat airport total without its tolls line plus the fee against the whole route by distance and time, whose tolls are charged after the ride, so a whole route of 11.1 miles and 50 min, which bills 37 minutes, pays the fee and 11.2, 24.5 and 25.0 miles pay the whole route", async () => {
  await withMock(async () => {
    const lga = priceLeg("suv", "lga");
    const fee = lga.total - lga.tolls + STOP_FEE_CENTS;
    assert.deepEqual([fee, priceDistance("suv", { tenths: 111, minutes: 50 }, "lga").total, priceDistance("suv", { tenths: 112, minutes: 50 }, "lga").total], [17224, 17186, 17304]);
    assert.deepEqual([priceDistance("suv", { tenths: 90, minutes: 50 }, "lga").total, distanceFare("suv", 111, 50), 8500 + 4440 + 37 * 65], [15882, 15345, 15345]);
    const at = async (tenths) => priced({ ...STOPS, route: signRoute([[stopKey([ANN]), tenths, 50]], NOW) });
    const near = await at(111);
    assert.deepEqual([near.total, near.tolls, near.stops, near.service, near.notes], [AIRPORT_TOTALS.suv.lga + STOP_FEE_CENTS, lga.tolls, STOP_FEE_CENTS, "airport", [NOTES.included, POLICY.later.airport]]);
    for (const tenths of [112, 245, 250]) {
      const far = await at(tenths);
      const whole = priceDistance("suv", { tenths, minutes: 50 }, "lga");
      assert.deepEqual([far.total, far.tolls, far.stops, far.service, far.notes], [whole.total, 0, 0, "distance", [POLICY.later.outside]], String(tenths));
    }
    assert.deepEqual([(await at(245)).total, (await at(250)).total], [24136, 24360]);
  });
});

await test("trips with stops whose parts are all airport transfers take the stop rule like every other trip with stops: the higher of the trip without the stops plus STOP_FEE_CENTS per stop and the whole route by distance and time, never below the highest airport fare on the route, in every class, one way, with two stops and round trip, and with Google routes off they stay with dispatch as stop-leg", async () => {
  const JFK_STOP = { stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk" };
  const WHOLE = { tenths: 168, minutes: 43 };
  const FLOOR = { suv: 20177, premium: 23430, first: 29724, sedan: 16453, electric: 23776, sprinter: 43724 };
  const FLOOR_NJ = { ...FLOOR, sprinter: 46224 };
  const BY_ROUTE = [
    [{ ...BASE, ...JFK_STOP, to_text: BROOKLYN, to_id: "" }, ["jfk"]],
    [{ ...BASE, from_text: BROOKLYN, ...JFK_STOP, to_text: MANHATTAN, to_id: "" }, ["jfk"]],
    [{ ...BASE, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: BROOKLYN }, ["lga", "jfk"]],
    [{ ...BASE, from_text: "Newark Liberty (EWR)", from_id: "ewr", stop1_text: MANHATTAN, to_text: "Teterboro (TEB)", to_id: "teb" }, ["ewr", "teb"]],
    [{ ...FROM_JFK, stop1_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga" }, ["jfk", "lga"]],
  ];
  const TWO = { ...FROM_JFK, stop1_text: MANHATTAN, stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: BROOKLYN };
  const BY_FEE = { suv: 22500, premium: 26000, first: 35000, sedan: 21000, electric: 29000, sprinter: 49000 };
  const BY_FEE_ROUND = { suv: 41000, premium: 48000, first: 66000, sedan: 38000, electric: 54000, sprinter: 94000 };
  await withMock(async () => {
    for (const cls of Object.keys(CLASSES)) {
      for (const [fields, airports] of BY_ROUTE) {
        const price = await priced({ ...fields, class: cls });
        const interstate = airports.includes("ewr");
        const whole = priceDistance(rateKey(cls), WHOLE, ...airports);
        assert.deepEqual([price.total, price.fare, price.fee, price.tolls, price.stops, price.service, price.notes], [(interstate ? FLOOR_NJ : FLOOR)[cls], whole.fare, whole.fee, 0, 0, "distance", [POLICY.later.outside]], `${cls} ${JSON.stringify(fields)}`);
        assert.equal(whole.fare, Math.max(distanceFare(rateKey(cls), 168, 43), ...airports.map((airport) => AIRPORT_FARES[rateKey(cls)][airport])), `${cls} never below the highest airport fare on the route`);
        assert.deepEqual(price.lines.map((item) => item.label), ["Fare", FEE_LINE], "Newark by a Manhattan stop to Teterboro carries the same service fee line");
      }
      const two = await priced({ ...TWO, class: cls });
      assert.deepEqual([two.total, two.legs, two.stops, two.stopCount, two.service, two.notes], [BY_FEE[cls], [priceLeg(rateKey(cls), "jfk")], 2 * STOP_FEE_CENTS, 2, "airport", [NOTES.included, POLICY.later.airport]], cls);
      assert.deepEqual(pairs(two.lines).map(([label]) => label), ["Fare", FEE_LINE, "Tolls and airport fees", "Extra stops (2 x $20.00)"], cls);
      const round = await priced({ ...TWO, ...ROUND_TRIP, class: cls });
      assert.deepEqual([round.total, round.legs, round.stops, round.service], [BY_FEE_ROUND[cls], [priceLeg(rateKey(cls), "jfk"), priceLeg(rateKey(cls), "jfk")], 2 * STOP_FEE_CENTS, "airport"], cls);
      assert.equal(BY_FEE[cls], AIRPORT_TOTALS[rateKey(cls)].jfk + 2 * STOP_FEE_CENTS, cls);
      assert.equal(BY_FEE_ROUND[cls], 2 * AIRPORT_TOTALS[rateKey(cls)].jfk + 2 * STOP_FEE_CENTS, cls);
      assert.ok(priceLeg(rateKey(cls), "jfk").total - priceLeg(rateKey(cls), "jfk").tolls + 2 * STOP_FEE_CENTS > priceDistance(rateKey(cls), WHOLE, "jfk", "lga").total, cls);
    }
    const { trip } = await run(BY_ROUTE[0][0]);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.stops, leg.flat, leg.reason, leg.ride, leg.plain && leg.plain.ride]), [["manhattan", "brooklyn", 1, undefined, "", WHOLE, { tenths: 46, minutes: 27 }]]);
    assert.equal(serviceLabel(trip), "Business SUV, 16.8 miles and 43 min");
    const { trip: between } = await run(BY_ROUTE[4][0]);
    assert.deepEqual([between.legs.length, between.legs[0].plain], [1, undefined], "a trip between two airports by a stop has no price without the stop, so the whole route sets it");
    await isQuote({ ...FROM_JFK, stop1_text: "Brooklyn", stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: "Queens" }, "street-address");
  });
  for (const [fields] of BY_ROUTE) await isQuote(fields, "stop-leg");
  await isQuote(TWO, "stop-leg");
  await isQuote({ ...TWO, ...ROUND_TRIP }, "stop-leg");
});

await test("a part of the ride out between two airports, an airport stop next to an airport pickup or drop-off or two airport stops in a row, takes the stop rule like every other trip with stops, in every class, one way, with two stops and round trip, and a return between two airports or a stop at another airport stays with dispatch", async () => {
  const J = { text: "John F. Kennedy (JFK)", id: "jfk" };
  const L = { text: "LaGuardia (LGA)", id: "lga" };
  const E = { text: "Newark Liberty (EWR)", id: "ewr" };
  const T = { text: "Teterboro (TEB)", id: "teb" };
  const H = { text: "Westchester County (HPN)", id: "hpn" };
  const at = (name, end) => (typeof end === "string" ? { [`${name}_text`]: end, [`${name}_id`]: "" } : { [`${name}_text`]: end.text, [`${name}_id`]: end.id });
  const trip = (from, stops, to, extra = {}) => ({ ...BASE, ...at("from", from), ...(stops[0] && at("stop1", stops[0])), ...(stops[1] && at("stop2", stops[1])), ...at("to", to), ...extra });
  const WHOLE = { tenths: 168, minutes: 43 };
  const FLOOR = { suv: 20177, premium: 23430, first: 29724, sedan: 16453, electric: 23776 };
  const ONE_FEE = { suv: 20177, premium: 23430, first: 33000, sedan: 19000, electric: 27000 };
  const TWO_FEES = { suv: 22500, premium: 26000, first: 35000, sedan: 21000, electric: 29000 };
  const OUT_ROUND = { suv: 36677, premium: 42430, first: 54724, sedan: 30953, electric: 45276 };
  const BACK_ROUND = { suv: 38677, premium: 45430, first: 64000, sedan: 36000, electric: 52000 };
  const BY_DISTANCE = ["suv", "premium"];
  const EXECUTIVE = [
    [47000, "airport", STOP_FEE_CENTS, AIRPORT_TOTALS["sprinter-executive"].lga + STOP_FEE_CENTS],
    [47000, "airport", STOP_FEE_CENTS, AIRPORT_TOTALS["sprinter-executive"].jfk + STOP_FEE_CENTS],
    [49500, "airport", STOP_FEE_CENTS, AIRPORT_TOTALS["sprinter-executive"].teb + STOP_FEE_CENTS],
    [43724, "distance", 0, priceDistance("sprinter-executive", WHOLE, "jfk", "lga").total],
    [49000, "airport", 2 * STOP_FEE_CENTS, AIRPORT_TOTALS["sprinter-executive"].jfk + 2 * STOP_FEE_CENTS],
    [92000, "airport", STOP_FEE_CENTS, 2 * AIRPORT_TOTALS["sprinter-executive"].lga + STOP_FEE_CENTS],
    [92000, "airport", STOP_FEE_CENTS, 2 * AIRPORT_TOTALS["sprinter-executive"].jfk + STOP_FEE_CENTS],
  ];
  const CASES = [
    ["350 5th Ave by JFK to LaGuardia", trip(MANHATTAN, [J], L), FLOOR, "distance", 0, (cls) => priceDistance(rateKey(cls), WHOLE, "jfk", "lga").total],
    ["JFK by LaGuardia to 350 5th Ave", trip(J, [L], MANHATTAN), ONE_FEE, (cls) => (BY_DISTANCE.includes(cls) ? "distance" : "airport"), (cls) => (BY_DISTANCE.includes(cls) ? 0 : STOP_FEE_CENTS), (cls) => (BY_DISTANCE.includes(cls) ? priceDistance(rateKey(cls), WHOLE, "jfk", "lga").total : AIRPORT_TOTALS[rateKey(cls)].jfk + STOP_FEE_CENTS)],
    ["350 5th Ave by Newark to Teterboro", trip(MANHATTAN, [E], T), ONE_FEE, (cls) => (BY_DISTANCE.includes(cls) ? "distance" : "airport"), (cls) => (BY_DISTANCE.includes(cls) ? 0 : STOP_FEE_CENTS), (cls) => (BY_DISTANCE.includes(cls) ? priceDistance(rateKey(cls), WHOLE, "ewr", "teb").total : AIRPORT_TOTALS[rateKey(cls)].teb + STOP_FEE_CENTS)],
    ["350 5th Ave by JFK and LaGuardia to 200 Park Ave", trip(MANHATTAN, [J, L], PARK), FLOOR, "distance", 0, (cls) => priceDistance(rateKey(cls), WHOLE, "jfk", "lga").total],
    ["JFK by LaGuardia and Newark to 350 5th Ave", trip(J, [L, E], MANHATTAN), TWO_FEES, "airport", 2 * STOP_FEE_CENTS, (cls) => AIRPORT_TOTALS[rateKey(cls)].jfk + 2 * STOP_FEE_CENTS],
    ["350 5th Ave by JFK to LaGuardia, round trip", trip(MANHATTAN, [J], L, ROUND_TRIP), OUT_ROUND, "distance", 0, (cls) => priceDistance(rateKey(cls), WHOLE, "jfk", "lga").total + AIRPORT_TOTALS[rateKey(cls)].lga],
    ["277 Bedford Ave by LaGuardia to JFK, round trip", trip(BROOKLYN, [L], J, ROUND_TRIP), BACK_ROUND, (cls) => (BY_DISTANCE.includes(cls) ? "distance" : "airport"), (cls) => (BY_DISTANCE.includes(cls) ? 0 : STOP_FEE_CENTS), (cls) => (BY_DISTANCE.includes(cls) ? priceDistance(rateKey(cls), WHOLE, "lga", "jfk").total + AIRPORT_TOTALS[rateKey(cls)].jfk : 2 * AIRPORT_TOTALS[rateKey(cls)].jfk + STOP_FEE_CENTS)],
  ];
  await withMock(async () => {
    for (const cls of Object.keys(CLASSES)) {
      for (const [i, [name, fields, totals, service, stops, rule]] of CASES.entries()) {
        const price = await priced({ ...fields, class: cls });
        const want = cls === "sprinter" ? EXECUTIVE[i] : [totals[cls], typeof service === "function" ? service(cls) : service, typeof stops === "function" ? stops(cls) : stops, rule(cls)];
        assert.deepEqual([price.total, price.service, price.stops], want.slice(0, 3), `${cls} ${name}`);
        assert.equal(price.total, want[3], `${cls} ${name}`);
        assert.equal(price.lines.reduce((sum, item) => sum + item.cents, 0), price.total, `${cls} ${name}`);
      }
      const charged = cls === "sprinter" ? (a, b) => a > b : (a, b) => a <= b;
      assert.ok(charged(AIRPORT_TOTALS[rateKey(cls)].lga - priceLeg(rateKey(cls), "lga").tolls + STOP_FEE_CENTS, priceDistance(rateKey(cls), WHOLE, "jfk", "lga").total), `${cls}: the whole route is charged when it costs at least the trip without the stop plus the fee, and the Executive Sprinter, whose JFK and LaGuardia fares are the same, pays the trip without the stop plus the fee`);
    }
    const tie = await priced(CASES[0][1]);
    assert.deepEqual([pairs(tie.lines), tie.notes], [[["Fare", 18015], [FEE_LINE, 2162]], [POLICY.later.outside]]);
    assert.equal(AIRPORT_TOTALS.suv.lga - priceLeg("suv", "lga").tolls + STOP_FEE_CENTS, 17224, "the whole route of the SUV costs more than A and B is charged");
    const fee = await priced({ ...CASES[1][1], class: "sedan" });
    assert.deepEqual([pairs(fee.lines), fee.legs, fee.notes], [[["Fare", 14039], [FEE_LINE, 1685], ["Tolls and airport fees", 1276], ["Extra stop", 2000]], [priceLeg("sedan", "jfk")], [NOTES.included, POLICY.later.airport]]);
    const dear = await priced(CASES[1][1]);
    assert.deepEqual([pairs(dear.lines), dear.notes], [[["Fare", 18015], [FEE_LINE, 2162]], [POLICY.later.outside]], "the SUV pays its whole route, dearer than the JFK flat total without its tolls plus the fee");
    const fees = await priced(CASES[4][1]);
    assert.deepEqual(pairs(fees.lines).at(-1), ["Extra stops (2 x $20.00)", 4000]);
    const out = await priced(CASES[5][1]);
    assert.deepEqual([out.legs, pairs(out.lines).map(([label]) => label), out.notes], [[priceDistance("suv", WHOLE, "jfk", "lga"), priceLeg("suv", "lga")], ["Fare", FEE_LINE, "Tolls and airport fees"], [NOTES.returnFlat, POLICY.later.returnFlat]]);
    const back = await priced({ ...CASES[6][1], class: "sedan" });
    assert.deepEqual([back.legs, pairs(back.lines).at(-1)], [[priceLeg("sedan", "jfk"), priceLeg("sedan", "jfk")], ["Extra stop", 2000]]);
    for (const [name, fields] of CASES) {
      const { trip: resolved } = await run(fields);
      assert.deepEqual(resolved.legs.filter((item) => !item.back).map((item) => [item.stops, item.reason, item.ride]), [[(fields.stop2_text ? 2 : 1), "", WHOLE]], name);
    }
    for (const fields of [trip(J, [MANHATTAN], L, ROUND_TRIP), trip(L, [BROOKLYN], J, ROUND_TRIP), trip(MANHATTAN, [J], H), trip(MANHATTAN, [H], J), trip(L, [H], MANHATTAN), trip(J, [L, H], MANHATTAN)]) {
      await isQuote(fields, "stop-leg");
      await isQuote({ ...fields, class: "sprinter" }, "stop-leg");
      const { trip: resolved } = await run(fields);
      assert.deepEqual([resolved.route, resolved.legs.every((item) => !item.ride)], ["", true], JSON.stringify(fields));
    }
  });
  for (const [, fields] of CASES) await isQuote(fields, "stop-leg");
});

await test("with Google routes failing, trips with stops that need their whole route ask Google once for the whole route through the stops in order, and once more for the ride without the stops when that is priced by distance, then stay with dispatch as stop-leg, also when a part is an airport transfer or runs between two airports", async () => {
  const point = (id) => (localById(id).gid ? { placeId: localById(id).gid } : { address: localById(id).addr });
  await routesDown(async (sent) => {
    await isQuote({ ...FROM_JFK, stop1_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga", date: "2026-11-05" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[point("jfk-t4"), [{ address: MANHATTAN }], point("lga")]]);
    sent.length = 0;
    await isQuote({ ...BASE, from_text: BROOKLYN, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: MANHATTAN, to_id: "", date: "2026-11-05" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[{ address: BROOKLYN }, [point("jfk")], { address: MANHATTAN }], [{ address: BROOKLYN }, [], { address: MANHATTAN }]]);
    sent.length = 0;
    await isQuote({ ...FROM_JFK, stop1_text: MANHATTAN, stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: BROOKLYN, date: "2026-11-05" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[point("jfk-t4"), [{ address: MANHATTAN }, point("lga")], { address: BROOKLYN }]]);
    sent.length = 0;
    await isQuote({ ...FROM_JFK, stop1_text: "LaGuardia (LGA)", stop1_id: "lga", date: "2026-11-05" }, "stop-leg");
    await isQuote({ ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: PARK, to_id: "", date: "2026-11-05" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[point("jfk-t4"), [point("lga")], { address: MANHATTAN }], [{ address: MANHATTAN }, [point("jfk"), point("lga")], { address: PARK }], [{ address: MANHATTAN }, [], { address: PARK }]]);
    sent.length = 0;
    await isQuote({ ...FROM_JFK, stop1_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga", ...ROUND_TRIP, date: "2026-11-05", return_date: "2026-11-06" }, "stop-leg");
    await isQuote({ ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: "Westchester County (HPN)", to_id: "hpn", date: "2026-11-05" }, "stop-leg");
    assert.deepEqual(sent, [], "a return between two airports or a stop at another airport asks for no route");
  });
});

await test("Brooklyn by a JFK stop to 350 5th Ave in a Business SUV costs $280.56 over a whole route of 30.0 miles and 70 min, more than the trip without the stop plus the stop fee, where it cost the two flat JFK transfers of $370.00 before", async () => {
  const fields = { ...BASE, from_text: BROOKLYN, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: MANHATTAN, to_id: "" };
  const jfk = localById("jfk").gid ? { placeId: localById("jfk").gid } : { address: localById("jfk").addr };
  const key = routeKey({ address: BROOKLYN }, { address: MANHATTAN }, nycToUtc("2026-10-14", "07:30").toISOString(), [jfk]);
  await withMock(async () => {
    const price = await priced({ ...fields, route: signRoute([[key, 300, 70]], NOW) });
    assert.deepEqual(pairs(price.lines), [["Fare", 25050], [FEE_LINE, 3006]]);
    assert.deepEqual([price.total, price.stops, price.tolls, price.service, price.notes], [28056, 0, 0, "distance", [POLICY.later.outside]]);
    assert.equal(distanceFare("suv", 300, 70), 25050);
    const without = priceDistance("suv", { tenths: 48, minutes: 31 });
    assert.deepEqual([without.total, without.total + STOP_FEE_CENTS], [13272, 15272]);
    assert.ok(2 * AIRPORT_TOTALS.suv.jfk === 37000 && price.total < 37000);
    await isQuote({ ...fields, route: signRoute([[key, 5001, 70]], NOW) }, "long-trip");
  });
});

await test("a round trip with stops: a ride out with a stop a few blocks away costs its flat airport total plus the stop fee and the return keeps its flat total with its tolls line, a far stop prices the ride out over the whole route by distance and time with the return as today, and an address to address round trip prices the ride out without the stop plus the fee", async () => {
  await withMock(async () => {
    const NEAR = signRoute([[stopKey([ANN]), 100, 30]], NOW);
    const owner = await priced({ ...STOPS, ...ROUND_TRIP, route: NEAR });
    assert.deepEqual(owner.legs, [priceLeg("suv", "lga"), priceLeg("suv", "lga")]);
    assert.deepEqual([pairs(owner.lines), owner.total, owner.service, owner.notes], [[["Fare", 27186], [FEE_LINE, 3262], ["Tolls and airport fees", 2552], ["Extra stop", 2000]], 2 * AIRPORT_TOTALS.suv.lga + STOP_FEE_CENTS, "airport", [NOTES.included, POLICY.later.airport]]);
    assert.ok(owner.total > priceDistance("suv", { tenths: 100, minutes: 30 }, "lga").total + AIRPORT_TOTALS.suv.lga);
    const mock = await priced({ ...STOPS, ...ROUND_TRIP });
    assert.deepEqual([mock.legs, mock.total, mock.service], [[priceDistance("suv", { tenths: 168, minutes: 43 }, "lga"), priceLeg("suv", "lga")], 20177 + AIRPORT_TOTALS.suv.lga, "distance"], "the 16.8 mile route out is dearer than the flat total plus the fee");
    const { trip } = await run({ ...STOPS, ...ROUND_TRIP });
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back, leg.stops, leg.flat, leg.reason, leg.ride]), [["lga", "manhattan", false, 1, undefined, "", { tenths: 168, minutes: 43 }], ["manhattan", "lga", true, undefined, true, "", { tenths: 168, minutes: 43 }]]);
    assert.equal(serviceLabel((await run({ ...STOPS, ...ROUND_TRIP, route: NEAR })).trip), "Business SUV, 2 airport transfers");
    for (const cls of Object.keys(CLASSES)) assert.equal((await priced({ ...STOPS, ...ROUND_TRIP, class: cls, route: NEAR })).total, 2 * AIRPORT_TOTALS[rateKey(cls)].lga + STOP_FEE_CENTS, cls);
    const sprinter = await priced({ ...STOPS, ...ROUND_TRIP, class: "sprinter" });
    assert.deepEqual(sprinter.legs, [priceLeg("sprinter-executive", "lga"), priceLeg("sprinter-executive", "lga")]);
    assert.deepEqual([pairs(sprinter.lines), sprinter.total, sprinter.notes], [[["Fare", 2 * 39039], [FEE_LINE, 2 * 4685], ["Tolls and airport fees", 2 * 1276], ["Extra stop", 2000]], 2 * AIRPORT_TOTALS["sprinter-executive"].lga + 2000, [NOTES.included, POLICY.later.airport]]);
    const road = await priced({ ...RIDE, stop1_text: PARK, to_text: "Hoboken, NJ 07030", ...ROUND_TRIP });
    assert.deepEqual([road.legs.map((leg) => leg.fare), road.tolls, road.stops, road.service, road.notes], [[distanceFare("suv", 168, 43), distanceFare("suv", 168, 43)], 0, 2000, "distance", [POLICY.later.hourly]]);
    const turn = await priced({ ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: BROOKLYN, to_id: "", ...ROUND_TRIP });
    assert.deepEqual([turn.legs, turn.tolls, turn.stops, turn.service, turn.total], [[priceDistance("suv", { tenths: 168, minutes: 43 }, "jfk"), priceDistance("suv", { tenths: 48, minutes: 31 })], 0, 0, "distance", 33449]);
    const out = stopKey([ANN]);
    const home = routeKey({ address: CHURCH }, { address: LGA_ADDRESS }, nycToUtc("2026-10-18", "18:00").toISOString());
    const far = await priced({ ...STOPS, ...ROUND_TRIP, route: signRoute([[out, 250, 70], [home, 100, 30]], NOW) });
    assert.deepEqual(far.legs, [priceDistance("suv", { tenths: 250, minutes: 70 }, "lga"), priceLeg("suv", "lga")]);
    assert.deepEqual([far.total, far.stops, far.service, far.notes, far.lines.map((item) => item.label)], [priceDistance("suv", { tenths: 250, minutes: 70 }).total + AIRPORT_TOTALS.suv.lga, 0, "distance", [NOTES.returnFlat, POLICY.later.returnFlat], ["Fare", FEE_LINE, "Tolls and airport fees"]]);
    assert.ok(far.total > owner.total);
    assert.deepEqual([NOTES.returnFlat, POLICY.later.returnFlat], ["Tolls and airport fees for the return are included.", "Tolls for the ride out, extra waiting and parking are charged to your card after the ride."]);
    await isQuote({ ...STOPS, ...ROUND_TRIP, to_text: "Manhattan" }, "return-address");
  });
});

await test("a round trip with an airport stop on the ride out, 350 5th Ave by JFK to 277 Bedford Ave, takes the stop rule for the ride out over its whole route, never below the JFK fare, and prices the return by its own route as before, so adding the return never costs less than the ride out alone, in every class", async () => {
  const OUT = { ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: BROOKLYN, to_id: "" };
  const WHOLE = { tenths: 168, minutes: 43 };
  const jfk = localById("jfk").gid ? { placeId: localById("jfk").gid } : { address: localById("jfk").addr };
  const departure = nycToUtc("2026-10-14", "07:30").toISOString();
  const out = routeKey({ address: MANHATTAN }, { address: BROOKLYN }, departure, [jfk]);
  const alone = routeKey({ address: MANHATTAN }, { address: BROOKLYN }, departure, ["alone"]);
  const home = routeKey({ address: BROOKLYN }, { address: MANHATTAN }, nycToUtc("2026-10-18", "18:00").toISOString());
  const ROUND = { suv: 33449, premium: 38595, first: 48764, sedan: 27698, electric: 39872, sprinter: 82924 };
  await withMock(async () => {
    for (const cls of Object.keys(CLASSES)) {
      const one = await priced({ ...OUT, class: cls });
      const round = await priced({ ...OUT, ...ROUND_TRIP, class: cls });
      const ride = priceDistance(rateKey(cls), WHOLE, "jfk");
      const back = priceDistance(rateKey(cls), { tenths: 48, minutes: 31 });
      assert.ok(ride.total > priceDistance(rateKey(cls), { tenths: 46, minutes: 27 }).total + STOP_FEE_CENTS, cls);
      assert.deepEqual([one.total, one.stops, one.service], [ride.total, 0, "distance"], cls);
      assert.deepEqual(round.legs, [ride, back], cls);
      assert.deepEqual([round.total, round.tolls, round.stops, round.service, round.notes], [ROUND[cls], 0, 0, "distance", [POLICY.later.outside]], cls);
      assert.equal(ROUND[cls], one.total + back.total, cls);
      assert.deepEqual(pairs(round.lines).map(([label]) => label), ["Fare", FEE_LINE], cls);
      assert.ok(round.total > one.total, cls);
    }
    assert.deepEqual([NOTES.outFlat, POLICY.later.outFlat], ["Tolls and airport fees for the ride out are included.", "Tolls for the return, extra waiting and parking are charged to your card after the ride."]);
    const { trip } = await run({ ...OUT, ...ROUND_TRIP });
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.back, leg.stops, leg.flat, leg.reason, leg.ride]), [["manhattan", "brooklyn", false, 1, undefined, "", WHOLE], ["brooklyn", "manhattan", true, undefined, undefined, "", { tenths: 48, minutes: 31 }]]);
    assert.deepEqual([...readRoute(trip.route, NOW).keys()], [out, home, alone]);
    assert.equal(serviceLabel(trip), "Business SUV, 2 rides, 21.6 miles and 74 min");
    const sprinter = await priced({ ...OUT, ...ROUND_TRIP, class: "sprinter" });
    assert.deepEqual([priceDistance("sprinter-executive", { tenths: 48, minutes: 31 }).total, sprinter.total, sprinter.tolls], [39200, priceDistance("sprinter-executive", WHOLE, "jfk").total + 39200, 0]);
    assert.equal((await priced({ ...OUT, class: "sprinter" })).total, AIRPORT_TOTALS["sprinter-executive"].jfk - priceLeg("sprinter-executive", "jfk").tolls);
    const longer = await priced({ ...OUT, ...ROUND_TRIP, route: signRoute([[home, 100, 30]], NOW) });
    assert.equal(longer.total, priceDistance("suv", WHOLE, "jfk").total + priceDistance("suv", { tenths: 100, minutes: 30 }).total);
    await isQuote({ ...OUT, ...ROUND_TRIP, route: signRoute([[home, 5001, 30]], NOW) }, "long-trip");
    await isQuote({ ...OUT, ...ROUND_TRIP, route: signRoute([[out, 5001, 30]], NOW) }, "long-trip");
    await isQuote({ ...OUT, ...ROUND_TRIP, to_text: "Brooklyn" }, "return-address");
  });
  await routesDown(async (sent) => {
    await isQuote({ ...OUT, ...ROUND_TRIP, date: "2026-10-29", return_date: "2026-10-30" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[{ address: MANHATTAN }, [jfk], { address: BROOKLYN }], [{ address: BROOKLYN }, [], { address: MANHATTAN }], [{ address: MANHATTAN }, [], { address: BROOKLYN }]]);
  });
});

await test("an airport stop on a route priced by distance sets the floor like an airport pickup or drop-off: the fare is never below the flat fare of any airport on the route, so going on past a JFK stop never costs less than the plain JFK transfer, with the after the ride note of an airport trip", async () => {
  await withMock(async () => {
    const PAST = { ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: "Hoboken, NJ 07030", to_id: "" };
    const key = routeKey({ address: MANHATTAN }, { address: "Hoboken, NJ 07030" }, nycToUtc("2026-10-14", "07:30").toISOString(), [localById("jfk").gid ? { placeId: localById("jfk").gid } : { address: localById("jfk").addr }]);
    const alone = routeKey({ address: MANHATTAN }, { address: "Hoboken, NJ 07030" }, nycToUtc("2026-10-14", "07:30").toISOString(), ["alone"]);
    const NEAR = signRoute([[key, 60, 20], [alone, 40, 15]], NOW);
    for (const cls of Object.keys(CLASSES)) {
      const past = await priced({ ...PAST, class: cls, route: NEAR });
      assert.ok(distanceFare(rateKey(cls), 60, 20) < AIRPORT_FARES[rateKey(cls)].jfk, cls);
      assert.deepEqual([past.fare, past.fee, past.tolls, past.service, past.notes, past.legs.length], [AIRPORT_FARES[rateKey(cls)].jfk, FEE(AIRPORT_FARES[rateKey(cls)].jfk), 0, "distance", [POLICY.later.outside], 1], cls);
      assert.ok(past.fare >= (await priced({ ...BASE, class: cls })).fare, cls);
      const mock = await priced({ ...PAST, class: cls });
      assert.equal(mock.total, Math.max(priceDistance(rateKey(cls), { tenths: 168, minutes: 43 }, "jfk").total, priceDistance(rateKey(cls), { tenths: 168, minutes: 43 }).total + STOP_FEE_CENTS), `${cls}: the higher of the whole route and the trip without the stop plus the fee`);
      const two = await priced({ ...BASE, class: cls, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "Hoboken, NJ 07030", stop2_text: "John F. Kennedy (JFK)", stop2_id: "jfk", to_text: MANHATTAN, to_id: "" });
      const whole = priceRide(rateKey(cls), { tenths: 168, minutes: 43 }, ["lga", "jfk"]);
      assert.equal(whole.fare, Math.max(AIRPORT_FARES[rateKey(cls)].lga, AIRPORT_FARES[rateKey(cls)].jfk, distanceFare(rateKey(cls), 168, 43)), `${cls} from LaGuardia past a JFK stop`);
      assert.equal(two.fee, FEE(two.fare), `${cls}: a stop in Hoboken, New Jersey, carries the same service fee`);
      const fees = AIRPORT_TOTALS[rateKey(cls)].lga + 2 * STOP_FEE_CENTS;
      assert.equal(two.total, fees - priceLeg(rateKey(cls), "lga").tolls > whole.total ? fees : whole.total, `${cls} from LaGuardia past a JFK stop`);
      assert.ok(two.total >= whole.total && whole.fare >= AIRPORT_FARES[rateKey(cls)].jfk, cls);
    }
    const { trip } = await run(PAST);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.airport, leg.direction, leg.stops, leg.via, leg.reason]), [["manhattan", "outside", "jfk", "", 1, ["jfk"], ""]]);
    const sprinter = await priced({ ...PAST, class: "sprinter" });
    assert.deepEqual([pairs(sprinter.lines), sprinter.total, sprinter.notes], [[["Fare", AIRPORT_FARES["sprinter-executive"].jfk], [FEE_LINE, 4685]], AIRPORT_FARES["sprinter-executive"].jfk + 4685, [POLICY.later.outside]]);
    assert.deepEqual(pairs((await priced({ ...PAST, route: NEAR })).lines), [["Fare", 15379], [FEE_LINE, 1845]], "going on past a JFK stop never costs less than the plain JFK transfer without its tolls");
    assert.equal((await priced({ ...PAST, route: signRoute([[key, 300, 90]], NOW) })).fare, distanceFare("suv", 300, 90));
  });
});

await test("two stops are routed in their order, pickup, stop 1, stop 2 and the drop-off, as one ride, and each other order or stop is another route", async () => {
  await withMock(async () => {
    const two = { ...STOPS, stop2_text: WALL };
    const { trip } = await run(two);
    assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.stops, leg.ride]), [["lga", "manhattan", 2, { tenths: 168, minutes: 43 }]]);
    assert.deepEqual([...readRoute(trip.route, NOW).keys()], [stopKey([ANN, WALL])]);
    assert.equal(new Set([stopKey([ANN, WALL]), stopKey([WALL, ANN]), stopKey([ANN]), stopKey([WALL]), stopKey([])]).size, 5);
    assert.equal(stopKey([]), routeKey({ address: LGA_ADDRESS }, { address: CHURCH }, nycToUtc("2026-10-14", "09:00").toISOString()));
    const price = await priced({ ...two, route: signRoute([[stopKey([ANN, WALL]), 300, 80]], NOW) });
    assert.deepEqual([price.fare, price.total], [distanceFare("suv", 300, 80), priceDistance("suv", { tenths: 300, minutes: 80 }).total]);
    assert.equal(distanceFare("suv", 300, 80), 25700);
    assert.equal((await priced({ ...two, stop1_text: WALL, stop2_text: ANN, route: signRoute([[stopKey([ANN, WALL]), 300, 80]], NOW) })).fare, distanceFare("suv", 168, 43), "the other order is the mock route, not the signed one");
    assert.equal((await priced({ ...two, stop2_text: "", route: signRoute([[stopKey([ANN, WALL]), 300, 80]], NOW) })).fare, distanceFare("suv", 168, 43));
    assert.equal((await priced({ ...two, stop2_text: "", route: signRoute([[stopKey([ANN]), 100, 30]], NOW) })).fare, AIRPORT_FARES.suv.lga, "a near stop of its own route pays the flat fare plus the fee");
  });
  await routesDown(async (sent) => {
    await isQuote({ ...STOPS, stop2_text: WALL, date: "2026-10-29" }, "stop-leg");
    assert.deepEqual([sent.length, sent[0].origin, sent[0].intermediates, sent[0].destination], [1, { address: LGA_ADDRESS }, [{ address: ANN }, { address: WALL }], { address: CHURCH }]);
  });
});

await test("a stop priced by distance must be an exact spot: a typed or picked borough, ZIP code, city, town or neighborhood as a stop asks for the street address with no route lookup, after the pickup street address, also on a trip whose parts are all airport transfers, which takes the stop rule too", async () => {
  await withMock(async () => {
    const t = (id, zone, label, level) => signTicket(id, zone, label, NOW, level);
    const AREAS = [
      ["Brooklyn", ""],
      ["New York, NY 10001", ""],
      ["Hoboken, NJ, USA", t("mock-hoboken", "outside", "Hoboken, NJ, USA", 2)],
      ["Brooklyn, NY, USA", t("ChIJbrooklyn", "brooklyn", "Brooklyn, NY, USA", 1)],
      ["Upper East Side, New York, NY, USA", t("ChIJues", "manhattan", "Upper East Side, New York, NY, USA", 2)],
    ];
    for (const [stop1_text, stop1_ticket] of AREAS) {
      await isQuote({ ...STOPS, stop1_text, stop1_ticket }, "stop-address");
      await isQuote({ ...STOPS, stop2_text: stop1_text, stop2_ticket: stop1_ticket }, "stop-address");
      await isQuote({ ...STOPS, stop1_text, stop1_ticket, ...ROUND_TRIP }, "stop-address");
      await isQuote({ ...STOPS, from_text: "Manhattan", from_id: "", stop1_text, stop1_ticket }, "pickup-address");
      await isQuote({ ...STOPS, to_text: "Manhattan", stop1_text, stop1_ticket }, "street-address");
      const { trip } = await run({ ...STOPS, stop1_text, stop1_ticket });
      assert.deepEqual([trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", [["stop-address", undefined], ["stop-address", undefined]]], stop1_text);
    }
    assert.deepEqual(REASONS["stop-address"], { group: "price", text: "Add the street address of each stop to see the price.", google: "Add the street address of each stop, or pick it from the list, to see the price." });
    await isQuote({ ...STOPS, to_text: "Manhattan" }, "street-address");
    const street = await priced({ ...STOPS, stop1_text: "277 Bedford Ave, Brooklyn, NY 11211", stop1_ticket: t("mock-bedford", "brooklyn", "277 Bedford Ave, Brooklyn, NY 11211", 0) });
    assert.deepEqual([street.service, street.total], ["distance", 20177]);
    assert.equal(street.total, Math.max(priceDistance("suv", { tenths: 168, minutes: 43 }, "lga").total, AIRPORT_TOTALS.suv.lga - priceLeg("suv", "lga").tolls + STOP_FEE_CENTS));
    await isQuote({ ...FROM_JFK, stop1_text: "Brooklyn", stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: "Queens" }, "street-address");
    await isQuote({ ...FROM_JFK, stop1_text: "Brooklyn", stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: BROOKLYN }, "stop-address");
  });
  await routesDown(async (sent) => {
    await isQuote({ ...STOPS, stop1_text: "Brooklyn", date: "2026-10-29" }, "stop-address");
    assert.deepEqual(sent, []);
  });
});

await test("a stop outside the United States or at another airport stays with dispatch as stop-leg with no route lookup, a part of the ride out between two airports takes the stop rule, and an airport ZIP code address as a stop gets the airport ZIP code request", async () => {
  await withMock(async () => {
    for (const fields of [{ stop1_text: "Toronto, ON" }, { stop1_text: "CN Tower, 290 Bremner Blvd, Toronto, ON M5V 3L9" }, { stop2_text: "Montreal, QC" }, { stop1_text: "Westchester County (HPN)", stop1_id: "hpn" }, { stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", stop2_text: "Westchester County (HPN)", stop2_id: "hpn" }]) {
      await isQuote({ ...STOPS, ...fields }, "stop-leg");
      await isQuote({ ...STOPS, ...fields, class: "sprinter" }, "stop-leg");
      const { trip } = await run({ ...STOPS, ...fields });
      assert.deepEqual([trip.route, trip.legs.every((leg) => !leg.ride)], ["", true], JSON.stringify(fields));
    }
    await isQuote({ ...STOPS, from_text: "Toronto, ON", from_id: "" }, "stop-leg");
    const between = { suv: 20177, premium: 23430, first: 29724, sedan: 18500, electric: 25500, sprinter: 49000 };
    for (const [cls, total] of Object.entries(between)) {
      const price = await priced({ ...STOPS, class: cls, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", stop2_text: ANN });
      const whole = priceDistance(rateKey(cls), { tenths: 168, minutes: 43 }, "lga", "jfk").total;
      assert.equal(price.total, AIRPORT_TOTALS[rateKey(cls)].lga - priceLeg(rateKey(cls), "lga").tolls + 2 * STOP_FEE_CENTS > whole ? AIRPORT_TOTALS[rateKey(cls)].lga + 2 * STOP_FEE_CENTS : whole, cls);
      assert.deepEqual([price.total, price.stops], [total, price.service === "airport" ? 2 * STOP_FEE_CENTS : 0], cls);
    }
    for (const stop1_text of ["3 Brewster Rd, Newark, NJ 07114", "111 Industrial Ave, Teterboro, NJ 07608"]) await isQuote({ ...STOPS, stop1_text }, "airport-zip");
    await isQuote({ ...STOPS, stop1_text: "1 Idlewild Dr, 11430" }, "airport-zip", "stop1_text");
  });
  await routesDown(async (sent) => {
    await isQuote({ ...STOPS, stop1_text: "Toronto, ON", date: "2026-10-29" }, "stop-leg");
    await isQuote({ ...STOPS, stop1_text: "3 Brewster Rd, Newark, NJ 07114", date: "2026-10-29" }, "airport-zip");
    assert.deepEqual(sent, []);
  });
});

await test("the whole route of a trip with stops keeps DISTANCE_LIMITS: up to 500.0 miles and 720 minutes from pickup through the stops to the drop-off is priced, 500.1 miles or 721 minutes is long-trip", async () => {
  await withMock(async () => {
    assert.equal((await priced({ ...STOPS, route: signRoute([[stopKey([ANN]), 5000, 720]], NOW) })).fare, distanceFare("suv", 5000, 720));
    for (const ride of [[5001, 60], [100, 721], [5001, 721]]) await isQuote({ ...STOPS, route: signRoute([[stopKey([ANN]), ...ride]], NOW) }, "long-trip");
    await isQuote({ ...STOPS, stop2_text: WALL, route: signRoute([[stopKey([ANN, WALL]), 5001, 60]], NOW) }, "long-trip");
    const { trip } = await run({ ...STOPS, route: signRoute([[stopKey([ANN]), 5001, 60]], NOW) });
    assert.deepEqual(trip.legs.map((leg) => [leg.stops, leg.reason, leg.ride]), [[1, "long-trip", { tenths: 5001, minutes: 60 }]]);
  });
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ routes: [{ duration: "3600s", distanceMeters: 806281 }] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await isQuote({ ...STOPS, date: "2026-10-30" }, "long-trip");
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("with Google routes off or failing, a trip with stops that needs its whole route stays with dispatch as stop-leg, with the text of the new rule, also when every part is an airport transfer", async () => {
  assert.deepEqual(REASONS["stop-leg"], { group: "price", text: "We can't price this trip with stops online. Send it to us and we'll reply with a price." });
  assert.deepEqual(["sprinter-distance", "sprinter-outside", "sprinter-stops"].map((key) => REASONS[key]), [undefined, undefined, undefined]);
  for (const fields of [STOPS, { ...STOPS, stop2_text: WALL }, { ...STOPS, ...ROUND_TRIP }, { ...RIDE, stop1_text: PARK }]) {
    await isQuote(fields, "stop-leg");
    await isQuote({ ...fields, class: "sprinter" }, "stop-leg");
  }
  for (const fields of [{ ...BASE, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: BROOKLYN, to_id: "" }, { ...FROM_JFK, stop1_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga" }]) {
    await isQuote(fields, "stop-leg");
    await isQuote({ ...fields, ...ROUND_TRIP }, "stop-leg");
  }
  await routesDown(async (sent) => {
    await isQuote({ ...STOPS, date: "2026-10-31" }, "stop-leg");
    await isQuote({ ...STOPS, ...ROUND_TRIP, date: "2026-10-31", return_date: "2026-11-02" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[{ address: LGA_ADDRESS }, [{ address: ANN }], { address: CHURCH }], [{ address: LGA_ADDRESS }, [{ address: ANN }], { address: CHURCH }], [{ address: CHURCH }, [], { address: LGA_ADDRESS }]]);
    const { trip } = await run({ ...STOPS, date: "2026-10-31" });
    assert.deepEqual([trip.route, trip.legs.map((leg) => [leg.reason, leg.ride])], ["", [["", undefined], ["no-airport", undefined]]]);
  });
});

await test("an address to address trip with a stop a few blocks off the way costs the distance and time fare without the stop plus STOP_FEE_CENTS, a far stop is priced over the whole route, two near stops add two stop fees, a near and a far stop are priced over the whole route, in every class, and the route token keeps the ride without the stops", async () => {
  await withMock(async () => {
    const TRIP = { ...RIDE, to_text: GREENWICH };
    assert.deepEqual(legTax([{ region: "8081" }, { region: "8081" }, { region: "US" }]), { area: "", percent: "0" }, "Manhattan to Greenwich, Connecticut, is interstate");
    const at = nycToUtc("2026-10-14", "07:30").toISOString();
    const key = (stops) => routeKey({ address: MANHATTAN }, { address: GREENWICH }, at, stops.map((address) => ({ address })));
    const alone = routeKey({ address: MANHATTAN }, { address: GREENWICH }, at, ["alone"]);
    assert.notEqual(alone, key([]), "the ride without the stops never stands in for a trip with no stop");
    const direct = { tenths: 314, minutes: 52 };
    const CASES = [
      ["one near stop", { stop1_text: PARK }, [PARK], { tenths: 320, minutes: 58 }, true],
      ["one far stop", { stop1_text: PARK }, [PARK], { tenths: 450, minutes: 95 }, false],
      ["two near stops", { stop1_text: PARK, stop2_text: WALL }, [PARK, WALL], { tenths: 330, minutes: 62 }, true],
      ["a near and a far stop", { stop1_text: PARK, stop2_text: WALL }, [PARK, WALL], { tenths: 520, minutes: 110 }, false],
    ];
    for (const [name, stops, list, whole, near] of CASES) {
      const fields = { ...TRIP, ...stops, route: signRoute([[key(list), whole.tenths, whole.minutes]], NOW) };
      for (const cls of Object.keys(CLASSES)) {
        const price = await priced({ ...fields, class: cls });
        const fee = list.length * STOP_FEE_CENTS;
        const plain = priceRide(rateKey(cls), direct);
        const route = priceRide(rateKey(cls), whole);
        assert.equal(price.total, Math.max(plain.total + fee, route.total), `${name} ${cls}`);
        assert.ok(price.total >= plain.total + fee, `${name} ${cls}: a stop never costs less than the fee`);
        if (cls === "suv") assert.equal(plain.total + fee > route.total, near, name);
      }
      const suv = await priced(fields);
      const fee = list.length * STOP_FEE_CENTS;
      assert.deepEqual([suv.service, suv.tolls, suv.notes, suv.stops], ["distance", 0, [POLICY.later.hourly], near ? fee : 0], name);
      assert.deepEqual(suv.legs, [priceRide("suv", near ? direct : whole)], name);
      assert.deepEqual(pairs(suv.lines).map(([label]) => label), ["Fare", FEE_LINE, ...(near ? [list.length > 1 ? `Extra stops (${list.length} x $20.00)` : "Extra stop"] : [])], name);
      const { trip } = await run(fields);
      assert.equal(serviceLabel(trip), `Business SUV, ${(whole.tenths / 10).toFixed(1)} miles and ${whole.minutes} min`, `${name}: the label gives the miles and minutes of the route the car drives, also when the stop fee prices it`);
      assert.deepEqual([...readRoute(trip.route, NOW).entries()].map(([k, { tenths, minutes }]) => [k, tenths, minutes]), [[key(list), whole.tenths, whole.minutes], [alone, direct.tenths, direct.minutes]], name);
      assert.deepEqual([trip.legs.length, trip.legs[0].ride, trip.legs[0].plain], [1, whole, { from: "manhattan", to: "outside", airport: "", direction: "", back: false, reason: "", salesTax: { area: "", percent: "0" }, ride: direct }], name);
      assert.deepEqual(rideOf(trip), whole, `${name}: the map keeps the whole route`);
    }
    const near = await priced({ ...TRIP, stop1_text: PARK, route: signRoute([[key([PARK]), 320, 58]], NOW) });
    assert.deepEqual([pairs(near.lines), near.total], [[["Fare", 24440], [FEE_LINE, 2933], ["Extra stop", 2000]], 27373 + 2000]);
    const two = await priced({ ...TRIP, stop1_text: PARK, stop2_text: WALL, route: signRoute([[key([PARK, WALL]), 330, 62]], NOW) });
    assert.deepEqual([pairs(two.lines).at(-1), two.total, two.value], [["Extra stops (2 x $20.00)", 4000], 27373 + 4000, 24440 + 4000]);
    const far = await priced({ ...TRIP, stop1_text: PARK, route: signRoute([[key([PARK]), 450, 95]], NOW) });
    assert.deepEqual([far.fare, far.total, far.stops], [distanceFare("suv", 450, 95), priceRide("suv", { tenths: 450, minutes: 95 }).total, 0]);
    assert.ok(far.total > near.total);
    const cached = await run({ ...TRIP, stop1_text: PARK, route: signRoute([[key([PARK]), 320, 58], [alone, 400, 70]], NOW) });
    assert.equal(cached.price.total, Math.max(priceRide("suv", { tenths: 400, minutes: 70 }).total + 2000, priceRide("suv", { tenths: 320, minutes: 58 }).total), "the ride without the stops comes from the route token when it is there");
    await isQuote({ ...TRIP, stop1_text: PARK, route: signRoute([[key([PARK]), 320, 58], [alone, 5001, 60]], NOW) }, "long-trip");
  });
});

await test("trips with stops keep what is not new: a trip between two airports by an address stop is priced over its whole route with no stop fee, also when both its parts are airport transfers, hourly bookings drop their stops, and the stop fee never shows without a stop", async () => {
  await withMock(async () => {
    for (const cls of Object.keys(CLASSES)) {
      const flat = await priced({ ...BASE, class: cls, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: BROOKLYN });
      assert.deepEqual([flat.total, flat.stops, flat.service], [priceDistance(rateKey(cls), { tenths: 168, minutes: 43 }, "lga", "jfk").total, 0, "distance"], cls);
      const between = await priced({ ...STOPS, class: cls, stop1_text: "Hoboken, NJ 07030", to_text: "John F. Kennedy (JFK)", to_id: "jfk" });
      assert.deepEqual([between.stops, between.fee, between.total], [0, FEE(between.fare), priceRide(rateKey(cls), { tenths: 168, minutes: 43 }, ["lga", "jfk"]).total], `${cls}: LaGuardia by a Hoboken stop to JFK carries the same service fee`);
      const plain = await priced({ ...STOPS, class: cls, stop1_text: "" });
      assert.deepEqual([plain.total, plain.stops, plain.lines.some((item) => /^Extra/.test(item.label))], [AIRPORT_TOTALS[rateKey(cls)].lga, 0, false], cls);
    }
    const hourly = await priced({ ...HOURLY, stop1_text: ANN });
    assert.deepEqual([hourly.stops, hourly.total, hourly.lines.some((item) => /^Extra/.test(item.label))], [0, (await priced(HOURLY)).total, false]);
  });
});

await test("with Google routes failing for the ride without the stops, an address to address trip with a stop stays with dispatch as stop-leg, as when the whole route fails, and a trip whose ride without the stops is a flat airport transfer asks Google for the whole route only", async () => {
  const fetch = globalThis.fetch;
  process.env.GOOGLE_MAPS_SERVER_KEY = "route-test-key";
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return body.intermediates.length ? new Response(JSON.stringify({ routes: [{ duration: "3480s", distanceMeters: 51499 }] }), { status: 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 503 });
  };
  try {
    await isQuote({ ...RIDE, to_text: GREENWICH, stop1_text: PARK, date: "2026-11-02" }, "stop-leg");
    assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[{ address: MANHATTAN }, [{ address: PARK }], { address: GREENWICH }], [{ address: MANHATTAN }, [], { address: GREENWICH }]]);
    sent.length = 0;
    const { price } = await run({ ...STOPS, date: "2026-11-03" });
    assert.deepEqual([sent.length, price.total, price.stops], [1, priceDistance("suv", { tenths: 320, minutes: 58 }, "lga").total, 0], "32.0 miles and 58 min for the whole route costs more than the flat total plus the fee");
  } finally {
    globalThis.fetch = fetch;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  }
});

await test("receipt rebuilds the Extra stop line from stops_cents and the stop texts in the metadata, adds it to the value, and keeps the lines summing to the total", () => {
  const base = { service: "airport", direction: "from-airport", airport: "lga", class: "suv", date: "2026-10-14", time: "09:00", legs: "1", fare_cents: "13593", tax_cents: "1631", tolls_cents: "1276", total_cents: "18500", stop1_text: ANN };
  const one = receipt({ ...base, stops_cents: "2000" }, ON);
  assert.deepEqual([pairs(one.lines), one.value, one.summary, one.notes], [[["Fare", 13593], [FEE_LINE, 1631], ["Tolls and airport fees", 1276], ["Extra stop", 2000]], 15593, "Wed, Oct 14, 2026, 9:00 AM. From LaGuardia (LGA), Business SUV.", [NOTES.included, POLICY.later.airport]]);
  assert.equal(one.lines.reduce((sum, item) => sum + item.cents, 0), 18500);
  assert.deepEqual(pairs(receipt({ ...base, stop2_text: WALL, stops_cents: "4000" }, ON).lines).at(-1), ["Extra stops (2 x $20.00)", 4000]);
  assert.deepEqual(pairs(receipt({ ...base, stop1_text: "", stops_cents: "4000" }, ON).lines).at(-1), ["Extra stops", 4000]);
  assert.ok(!receipt({ ...base, total_cents: "16500" }, ON).lines.some((item) => /^Extra/.test(item.label)));
});

const MINEOLA = "1 Old Country Rd, Mineola, NY 11501";
const SCARSDALE = "2 Popham Rd, Scarsdale, NY 10583";
const YONKERS = "40 Warburton Ave, Yonkers, NY 10705";
const YONKERS_MIXED = "1 Getty Sq, Yonkers, NY 10701";
const YONKERS_CITY_HALL = "40 S Broadway, Yonkers, NY 10701";
const YONKERS_RIDGE_HILL = "1 Ridge Hill, Yonkers, NY 10710";
const TUCKAHOE = "1 Main St, Tuckahoe, NY 10707";
const HOBOKEN = "12 Washington St, Hoboken, NJ 07030";
const STAMFORD = "10 Elm St, Greenwich, CT 06830";
const EWR_ROW = { to_text: "Newark Liberty (EWR)", to_id: "ewr" };

await test("places: the Publication 718 table still places New York pickups by county, New York City 8081, Nassau 2811, Westchester 5581 and Yonkers 6511, from the 2/25 edition effective March 1, 2025, and no sales tax or Black Car Fund percent is left in api/_rates.mjs", () => {
  assert.deepEqual([RATES.PUB_718.edition, RATES.PUB_718.effective, RATES.PUB_718.url], ["2/25", "2025-03-01", "https://www.tax.ny.gov/pdf/publications/sales/pub718.pdf"]);
  assert.deepEqual(["8081", "2811", "5581", "6511", "4711", "3921", "3731", "5311", "4111"].map((area) => [RATES.TAX_AREAS[area].name, RATES.TAX_AREAS[area].percent]), [["New York City", "8.875"], ["Nassau", "8.625"], ["Westchester", "8.375"], ["Yonkers", "8.875"], ["Suffolk", "8.75"], ["Rockland", "8.375"], ["Putnam", "8.375"], ["Washington", "7"], ["Saratoga", "7"]]);
  assert.equal("NYC_TAX_PERCENT" in RATES || "BCF_PERCENT" in RATES, false);
  assert.equal(RATES.NYC_TAX_AREA, "8081");
  assert.equal(Object.keys(RATES.COUNTY_AREAS).length, 62);
  for (const borough of ["Bronx", "Kings", "New York", "Queens", "Richmond"]) assert.equal(RATES.COUNTY_AREAS[borough], "8081", borough);
  assert.ok(Object.values(RATES.COUNTY_AREAS).every((area) => area in RATES.TAX_AREAS));
  assert.deepEqual(RATES.CITY_AREAS, { Westchester: { Yonkers: "6511" } });
  assert.deepEqual(RATES.CITY_ZIPS, { "6511": "10583 10701 10707 10708 10710" });
  assert.ok(RATES.CITY_ZIPS["6511"].split(" ").every((zip) => RATES.ZIP_AREAS["5581"].split(" ").includes(zip)), "a ZIP code partly in Yonkers is listed under Westchester");
  const zips = Object.entries(RATES.ZIP_AREAS).flatMap(([area, list]) => list.split(" ").map((zip) => [zip, area]));
  assert.ok(zips.every(([zip, area]) => /^(?:1[0-4]\d{3}|00501|00544|06390)$/.test(zip) && area in RATES.TAX_AREAS && area !== "8081"));
  assert.equal(new Set(zips.map(([zip]) => zip)).size, zips.length);
  assert.deepEqual(["11501", "10583", "10705", "10701", "11954"].map((zip) => zips.find(([code]) => code === zip)[1]), ["2811", "5581", "6511", "5581", "4711"]);
  assert.ok(!zips.some(([zip]) => zip === "11001"), "a ZIP code in two counties is left out");
});

await test("places: legTax places a trip that starts and ends in New York State in its pickup's Publication 718 area, and in none when the pickup, a stop or the drop-off is outside the state, and no price uses it", () => {
  const at = (region) => ({ region });
  assert.deepEqual(legTax([at("8081"), at("8081")]), { area: "8081", percent: "8.875" });
  assert.deepEqual(legTax([at("2811"), at("8081")]), { area: "2811", percent: "8.625" });
  assert.deepEqual(legTax([at("8081"), at("2811")]), { area: "8081", percent: "8.875" });
  assert.deepEqual(legTax([at("8081"), at("NJ")]), { area: "", percent: "0" });
  assert.deepEqual(legTax([at("NJ"), at("8081")]), { area: "", percent: "0" });
  assert.deepEqual(legTax([at("8081"), at("US"), at("8081")]), { area: "", percent: "0" }, "a stop outside the state makes the trip interstate");
  assert.deepEqual(legTax([at("NY"), at("NJ")]), { area: "", percent: "0" }, "an interstate trip needs no county");
  assert.equal(legTax([at("NY"), at("8081")]), null, "a New York pickup with no known county is not guessed");
  assert.equal(legTax([at(""), at("8081")]), null);
  const ride = (salesTax) => priceTrip({ trip_type: "one", class: "suv", vehicle: "", tip: 0, passengers: "2", legs: [{ from: "outside", to: "manhattan", airport: "", direction: "", back: false, reason: "", salesTax, ride: { tenths: 231, minutes: 55 } }] });
  assert.deepEqual([ride(legTax([at("2811"), at("8081")])), ride(legTax([at("NY"), at("8081")])), ride(legTax([at("NJ"), at("8081")]))].map((price) => [price.fare, price.fee, price.total]), Array(3).fill([21315, 2558, 23873]));
});

await test("service fee: Manhattan to JFK, LaGuardia, Newark and Teterboro and back keeps every flat total with the AIRPORT_FARES fare and a 12% service fee, the same at the New Jersey airports as at JFK, in every class", async () => {
  for (const cls of Object.keys(CLASSES)) {
    for (const airport of ["jfk", "lga", "ewr", "teb"]) {
      for (const fields of [{ ...BASE, class: cls, to_text: localById(airport).label, to_id: airport }, { ...BASE, class: cls, from_text: localById(airport).label, from_id: airport, to_text: MANHATTAN, to_id: "" }]) {
        const price = await priced(fields);
        const fare = AIRPORT_FARES[rateKey(cls)][airport];
        assert.deepEqual([price.fare, price.fee, price.tolls, price.total, price.service], [fare, FEE(fare), priceLeg(rateKey(cls), airport).tolls, AIRPORT_TOTALS[rateKey(cls)][airport], "airport"], `${cls} ${airport}`);
        assert.equal(price.fare + price.fee + price.tolls, AIRPORT_TOTALS[rateKey(cls)][airport], `${cls} ${airport}`);
        assert.deepEqual(price.lines.map((item) => item.label), ["Fare", FEE_LINE, "Tolls and airport fees"], `${cls} ${airport}`);
      }
    }
    const jfk = priceLeg(rateKey(cls), "jfk");
    const ewr = priceLeg(rateKey(cls), "ewr");
    const teb = priceLeg(rateKey(cls), "teb");
    assert.equal(ewr.tolls, 2280, `${cls}: Newark includes the owner's $22.80 of tolls`);
    if (cls === "sprinter") assert.deepEqual([ewr.fare, ewr.fee, ewr.total - jfk.total, teb.total - jfk.total], [41268, 4952, 3500, 2500], "the Executive Sprinter costs $35 more at Newark and $25 more at Teterboro");
    else assert.deepEqual([teb.fare, teb.fee, teb.tolls, ewr.total - jfk.total], [jfk.fare, jfk.fee, jfk.tolls, cls === "electric" ? 0 : 1000], `${cls}: Teterboro splits like JFK and Newark costs $10 more`);
  }
  const suv = await priced({ ...BASE, ...EWR_ROW });
  assert.deepEqual(pairs(suv.lines), [["Fare", 15375], [FEE_LINE, 1845], ["Tolls and airport fees", 2280]]);
  assert.deepEqual(pairs(shownLines(suv.lines)), [["Fare", 15375], [FEE_LINE, 1845], ["Tolls", 2280]]);
  assert.equal(suv.total, 19500);
  const back = await priced({ ...BASE, ...EWR_ROW, ...ROUND_TRIP });
  assert.deepEqual([back.fare, back.fee, back.tolls, back.total, back.legs.map((leg) => leg.fee)], [2 * 15375, 2 * 1845, 2 * 2280, 39000, [1845, 1845]]);
  const newark = await priced({ ...BASE, from_text: "Newark Liberty (EWR)", from_id: "ewr", to_text: MANHATTAN, to_id: "", meet: "1" });
  assert.deepEqual(pairs(newark.lines), [["Fare", 15375], [FEE_LINE, 1845], ["Tolls and airport fees", 2280], ["Meet and greet", 2500]]);
  assert.deepEqual([newark.total, newark.notes], [22000, [NOTES.included, POLICY.later.airport]]);
  assert.ok(!/tax/i.test(NOTES.included), "the included note makes no claim about taxes");
  assert.equal(NOTES.included, "Tolls, airport fees and the service fee are included.");
  const { trip } = await run({ ...BASE, ...EWR_ROW, ...ROUND_TRIP });
  assert.deepEqual(trip.legs.map((leg) => leg.salesTax), [{ area: "", percent: "0" }, { area: "", percent: "0" }]);
});

await test("service fee: a New Jersey address to JFK and JFK to a Connecticut address are priced by distance and time at no less than the JFK fare, with the same 12% service fee", async () => {
  await withMock(async () => {
    for (const fields of [{ ...BASE, from_text: HOBOKEN }, { ...FROM_JFK, to_text: STAMFORD }]) {
      const { trip, price } = await run(fields);
      const ride = trip.legs[0].ride;
      const fare = Math.max(AIRPORT_FARES.suv.jfk, distanceFare("suv", ride.tenths, ride.minutes));
      assert.deepEqual([pairs(price.lines), price.total, price.service], [[["Fare", fare], [FEE_LINE, FEE(fare)]], fare + FEE(fare), "distance"], JSON.stringify(fields));
    }
    const nj = await priced({ ...BASE, from_text: HOBOKEN });
    assert.equal(nj.total, 20177);
    const { trip } = await run({ ...FROM_JFK, to_text: STAMFORD });
    assert.deepEqual([trip.ends.from.region, trip.ends.to.region, trip.legs[0].salesTax], ["8081", "US", { area: "", percent: "0" }]);
  });
});

await test("service fee: a pickup in New York State outside the city, in Nassau, Westchester or Yonkers, is still placed in its area and pays the same 12% service fee as any trip, one way and both ways of a round trip", async () => {
  await withMock(async () => {
    for (const [from_text, area] of [[MINEOLA, "2811"], [SCARSDALE, "5581"], [YONKERS, "6511"], [YONKERS_MIXED, "6511"], [YONKERS_CITY_HALL, "6511"], [YONKERS_RIDGE_HILL, "6511"], [TUCKAHOE, "5581"]]) {
      const { trip, price } = await run({ ...BASE, from_text });
      const ride = trip.legs[0].ride;
      const fare = Math.max(AIRPORT_FARES.suv.jfk, distanceFare("suv", ride.tenths, ride.minutes));
      assert.deepEqual([trip.ends.from.region, trip.legs[0].salesTax.area, price.fare, price.fee, price.total], [area, area, fare, FEE(fare), fare + FEE(fare)], from_text);
    }
    const round = await priced({ ...RIDE, to_text: SCARSDALE, ...ROUND_TRIP });
    assert.deepEqual(round.legs.map((leg) => [leg.fare, leg.fee]), [[18015, 2162], [18015, 2162]], "each direction pays the same fee on its own fare");
    assert.equal(round.total, 2 * 20177);
    const from = await priced({ ...RIDE, from_text: SCARSDALE, to_text: MANHATTAN });
    assert.equal(from.fee, FEE(from.fare));
  });
});

await test("service fee: a New York pickup outside the city whose county is unknown is priced like any other address outside the city, typed with a ZIP code in two counties or picked with no county, one way, round trip and to Newark, and the same street typed without a ZIP code still gets the ZIP code request", async () => {
  await withMock(async () => {
    const rides = [
      { ...BASE, from_text: "100 Jericho Tpke, Floral Park, NY 11001" },
      { ...BASE, from_text: "1 Tulip Ave, Floral Park, NY 11001" },
      { ...RIDE, to_text: "100 Jericho Tpke, Floral Park, NY 11001", ...ROUND_TRIP },
      { ...BASE, from_text: "Floral Park, NY, USA", from_ticket: signTicket("ChIJfloral", "outside", "Floral Park, NY, USA", NOW, 0, "NY") },
      { ...BASE, from_text: "Floral Park, NY, USA", from_ticket: signTicket("ChIJfloral", "outside", "Floral Park, NY, USA", NOW, 0, "2811") },
      { ...BASE, from_text: "100 Jericho Tpke, Floral Park, NY 11001", ...EWR_ROW },
    ];
    const got = [];
    for (const fields of rides) {
      const price = await priced(fields);
      assert.equal(price.fee, price.legs.reduce((sum, item) => sum + FEE(item.fare), 0), JSON.stringify(fields));
      got.push([price.service, price.total]);
    }
    assert.deepEqual(got, [["distance", 20177], ["distance", 20177], ["distance", 40354], ["distance", 20177], ["distance", 20177], ["distance", 20177]]);
    await isQuote({ ...BASE, from_text: "1 Tulip Ave, Floral Park, NY" }, "unplaced", "from_text");
    const out = await priced({ ...BASE, from_text: "100 Jericho Tpke, Floral Park, NY 11001", ...EWR_ROW });
    assert.deepEqual([out.fee, out.fare, out.total], [2162, 18015, 20177]);
    assert.ok(out.fare > AIRPORT_FARES.suv.ewr);
  });
});

await test("places: a typed address whose state and ZIP code disagree, New York with a ZIP code outside it or another state with a New York ZIP code or city name, gets the county request, also on a trip that leaves the state, and the same address with its own ZIP code is priced", async () => {
  await withMock(async () => {
    await isQuote({ ...BASE, from_text: "1 Old Country Rd, Mineola, NY 07030" }, "county", "from_text");
    await isQuote({ ...BASE, from_text: "1 Old Country Rd, Mineola, New York 06830" }, "county", "from_text");
    await isQuote({ ...BASE, from_text: "350 5th Ave, Manhattan, NY 07030" }, "county", "from_text");
    await isQuote({ ...BASE, from_text: "1 Old Country Rd, Mineola, NJ 11501" }, "county", "from_text");
    await isQuote({ ...BASE, from_text: "350 5th Ave, New York, NJ" }, "unplaced", "from_text");
    await isQuote({ ...RIDE, from_text: MANHATTAN, to_text: "1 Old Country Rd, Mineola, NY 07030" }, "county", "to_text");
    await isQuote({ ...BASE, stop1_text: "1 Old Country Rd, Mineola, NY 07030" }, "county", "stop1_text");
    await isQuote({ ...BASE, from_text: "1 Old Country Rd, Mineola, NY 07030", ...EWR_ROW }, "county", "from_text");
    const nassau = await priced({ ...BASE, from_text: MINEOLA });
    assert.deepEqual([nassau.fare, nassau.fee, nassau.total], [18015, 2162, 20177]);
  });
});

await test("places: a typed address in a ZIP code partly in Yonkers that names no place gets no county but is priced by its route, with no county request", async () => {
  await withMock(async () => {
    const unnamed = [];
    for (const from_text of ["40 S Broadway, NY 10701", "1 Ridge Hill 10710"]) {
      const { trip, price } = await run({ ...BASE, from_text });
      unnamed.push([trip.ends.from.region, price && price.service, price && price.fee === FEE(price.fare)]);
    }
    assert.deepEqual(unnamed, [["NY", "distance", true], ["NY", "distance", true]]);
    for (const from_text of [YONKERS_CITY_HALL, TUCKAHOE]) {
      const price = await priced({ ...BASE, from_text });
      assert.equal(price.fee, FEE(price.fare), from_text);
    }
  });
});

await test("service fee: a stop in New Jersey or in Brooklyn carries the same 12% service fee and the stop rule prices the trip", async () => {
  await withMock(async () => {
    for (const stop1_text of [HOBOKEN, BROOKLYN]) {
      const { trip, price } = await run({ ...BASE, stop1_text });
      const ride = trip.legs[0].ride;
      const whole = priceDistance("suv", ride, "jfk");
      assert.equal(price.total, Math.max(whole.total, AIRPORT_TOTALS.suv.jfk - priceLeg("suv", "jfk").tolls + STOP_FEE_CENTS), stop1_text);
      assert.equal(price.fee, FEE(price.fare), stop1_text);
      assert.ok(!price.lines.some((item) => [TAX, "Black Car Fund", "Taxes and fees"].includes(item.label)), stop1_text);
    }
    const near = await priced({ ...BASE, stop1_text: HOBOKEN, route: signRoute([[routeKey({ address: MANHATTAN }, { address: JFK_ADDRESS }, nycToUtc("2026-10-14", "07:30").toISOString(), [{ address: HOBOKEN }]), 60, 20]], NOW) });
    const jfkKey = localById("jfk").gid ? { placeId: localById("jfk").gid } : { address: localById("jfk").addr };
    const nearKey = routeKey({ address: MANHATTAN }, jfkKey, nycToUtc("2026-10-14", "07:30").toISOString(), [{ address: HOBOKEN }]);
    const flat = await priced({ ...BASE, stop1_text: HOBOKEN, route: signRoute([[nearKey, 60, 20]], NOW) });
    assert.deepEqual([pairs(flat.lines), flat.total, flat.service], [[...LEG, ["Extra stop", 2000]], AIRPORT_TOTALS.suv.jfk + STOP_FEE_CENTS, "airport"]);
    assert.ok(near.total >= flat.total);
    const far = await priced({ ...RIDE, stop1_text: HOBOKEN, to_text: PARK });
    assert.deepEqual([far.fee, far.service], [FEE(far.fare), "distance"]);
  });
});

await test("service fee: hourly bookings from New York City pay 12% of the fare, from an address and from JFK", async () => {
  for (const fields of [HOURLY, { ...HOURLY, from_text: "John F. Kennedy (JFK)", from_id: "jfk" }]) {
    const price = await priced(fields);
    assert.deepEqual([price.fare, price.fee], [25500, 3060]);
    assert.deepEqual(pairs(price.lines).slice(0, 2), [["Fare, 3 hours", 25500], [FEE_LINE, 3060]]);
  }
});

const CLINTON = "1332 Clinton Street, Hoboken, NJ";
const SCARSDALE_PICK = "2 Popham Road, Scarsdale, NY";
const HPN_PICK = "Westchester County Airport, White Plains, NY";
const NEAR_HOUR = { trip_type: "hour", from_text: CLINTON, date: "2026-11-29", time: "17:40", passengers: "5", hours: "4", class: "premium", tip: "0", action: "pay" };
const SUV_HOUR = { ...NEAR_HOUR, passengers: "2", class: "suv" };
const pickTicket = (id, label, region, at = NOW, zone = "outside") => signTicket(id, zone, label, at, 0, region);
const SUV_FARE = VEHICLES["suv-suburban"].hourly * 4;
const SUV_FEE = percentCents(SUV_FARE, "12");
const suvPickups = () => [
  ["Newark Liberty (EWR)", { from_text: "Newark Liberty (EWR)", from_id: "ewr" }, "NJ", "0"],
  ["Newark Liberty (EWR), Terminal B", { from_text: "Newark Liberty (EWR), Terminal B", from_id: "ewr-tb" }, "NJ", "0"],
  ["Teterboro (TEB)", { from_text: "Teterboro (TEB)", from_id: "teb" }, "NJ", "0"],
  ["Teterboro (TEB), Atlantic Aviation", { from_text: "Teterboro (TEB), Atlantic Aviation", from_id: "teb-atlantic" }, "NJ", "0"],
  ["John F. Kennedy (JFK)", { from_text: "John F. Kennedy (JFK)", from_id: "jfk" }, "8081", "8.875"],
  ["LaGuardia (LGA)", { from_text: "LaGuardia (LGA)", from_id: "lga" }, "8081", "8.875"],
  ["1332 Clinton Street, Hoboken", { from_text: CLINTON, from_ticket: pickTicket("mock-clinton", CLINTON, "NJ") }, "NJ", "0"],
  ["30 Station Place, Stamford", { from_text: "30 Station Place, Stamford, CT", from_ticket: pickTicket("mock-stamford", "30 Station Place, Stamford, CT", "CT") }, "CT", "0"],
  ["Nassau Hall, Princeton", { from_text: "Nassau Hall, Princeton, NJ", from_ticket: pickTicket("mock-princeton", "Nassau Hall, Princeton, NJ", "NJ") }, "NJ", "0"],
  ["1500 Market Street, Philadelphia", { from_text: "1500 Market Street, Philadelphia, PA", from_ticket: pickTicket("ChIJmarket", "1500 Market Street, Philadelphia, PA", "PA") }, "PA", "0"],
  ["2 Popham Road, Scarsdale", { from_text: SCARSDALE_PICK, from_ticket: pickTicket("mock-scarsdale", SCARSDALE_PICK, "5581") }, "5581", "8.375"],
  ["40 South Broadway, Yonkers", { from_text: "40 South Broadway, Yonkers, NY", from_ticket: pickTicket("mock-yonkers", "40 South Broadway, Yonkers, NY", "6511") }, "6511", "8.875"],
  ["Westchester County (HPN)", { from_text: "Westchester County (HPN)", from_id: "hpn" }, "5581", "8.375"],
  ["Westchester County (HPN) typed", { from_text: "Westchester County (HPN)" }, "5581", "8.375"],
  ["Westchester County Airport, picked", { from_text: HPN_PICK, from_ticket: pickTicket("mock-hpn", HPN_PICK, "5581", NOW, "airport-other") }, "5581", "8.375"],
  ["Long Island MacArthur (ISP)", { from_text: "Long Island MacArthur (ISP)", from_id: "isp" }, "4711", "8.75"],
];

await test("hourly from any pickup: api/_rates.mjs has no list of hourly start zones and no distance from Midtown, every pickup the site can place prices at the class's hourly rate", () => {
  for (const name of ["HOURLY_START", "HOURLY_NEAR", "EARTH_MILES"]) assert.ok(!(name in RATES), name);
  assert.deepEqual([VEHICLES["suv-suburban"].hourly, VEHICLES.premium.hourly, RATES.TAX_AREAS["5581"].percent, RATES.TAX_AREAS["4711"].percent], [9500, 10500, "8.375", "8.75"]);
});

await test("hourly from any pickup: 4 hours in a Business SUV from Newark Liberty, Teterboro, JFK, LaGuardia, Hoboken, Stamford, Princeton, Philadelphia, a Westchester address, Yonkers, Westchester County Airport and MacArthur, each placed in its region and each with the same 12% service fee", async () => {
  await withMock(async () => {
    const pickups = suvPickups();
    for (const [name, fields, region] of pickups) {
      const { trip, result, price } = await run({ ...SUV_HOUR, ...fields });
      assert.deepEqual([result, trip.ends.from.region, trip.vehicle], [{ kind: "price", reason: "", hold: "" }, region, "suv-suburban"], name);
      assert.deepEqual([price.fare, price.fee, price.tolls, price.total, price.service, price.notes], [SUV_FARE, SUV_FEE, 0, SUV_FARE + SUV_FEE, "hourly", [POLICY.later.hourly]], name);
      assert.deepEqual(pairs(price.lines), [["Fare, 4 hours", SUV_FARE], [FEE_LINE, SUV_FEE]], name);
      assert.equal(classTotal(trip, "suv"), SUV_FARE + SUV_FEE, name);
    }
    const totals = async (fields) => (await priced({ ...SUV_HOUR, ...fields })).total;
    assert.deepEqual(await Promise.all([0, 2, 6, 10, 4].map((i) => totals(pickups[i][1]))), [42560, 42560, 42560, 42560, 42560]);
  });
});

await test("hourly from any pickup: the customer's 4 hours in a Business Premium SUV from 1332 Clinton Street, Hoboken, NJ, Sun Nov 29 at 5:40 PM for 5 passengers, is priced at the hourly rate of $105 with the 12% service fee, $470.40", async () => {
  await withMock(async () => {
    const { trip, price } = await run({ ...NEAR_HOUR, from_ticket: pickTicket("mock-clinton", CLINTON, "NJ") });
    assert.deepEqual([trip.ends.from.zone, trip.ends.from.region, trip.ends.from.place, trip.vehicle], ["outside", "NJ", "mock-clinton", "premium"]);
    assert.ok(!("near" in trip.ends.from));
    assert.deepEqual(pairs(price.lines), [["Fare, 4 hours", 42000], [FEE_LINE, 5040]]);
    assert.deepEqual([price.fare, price.fee, price.tolls, price.total, price.service, price.notes], [VEHICLES.premium.hourly * 4, 5040, 0, 47040, "hourly", [POLICY.later.hourly]]);
    assert.deepEqual(pairs(shownLines(price.lines)), [["Fare, 4 hours", 42000], [FEE_LINE, 5040]]);
    assert.equal(classTotal(trip, "premium"), 47040);
    assert.equal(classTotal(trip, "suv"), VEHICLES["suv-suburban"].hourly * 4 + percentCents(VEHICLES["suv-suburban"].hourly * 4, "12"));
    assert.equal(classTotal(trip, "sedan"), null);
  });
});

await test("hourly from any pickup: Jersey City, Newark, Yonkers and Scarsdale pay the same hourly fare and the same 12% service fee", async () => {
  await withMock(async () => {
    const pickups = [
      ["mock-clinton", CLINTON, "NJ"],
      ["mock-jersey-city", "30 Hudson Street, Jersey City, NJ", "NJ"],
      ["mock-newark", "1 Gateway Center, Newark, NJ", "NJ"],
      ["mock-yonkers", "40 South Broadway, Yonkers, NY", "6511"],
      ["mock-scarsdale", SCARSDALE_PICK, "5581"],
    ];
    for (const [id, from_text, region] of pickups) {
      const { trip, price } = await run({ ...NEAR_HOUR, from_text, from_ticket: pickTicket(id, from_text, region) });
      assert.deepEqual([trip.ends.from.region, price.fare, price.fee, price.total], [region, 42000, 5040, 47040], from_text);
    }
  });
});

await test("hourly from any pickup: 10 hours for a day of meetings from Newark Liberty, Teterboro with meet and greet, and Hoboken, priced at 10 times the hourly rate with the 12% service fee, and the day can end back at the airport", async () => {
  await withMock(async () => {
    const ewr = await priced({ ...SUV_HOUR, from_text: "Newark Liberty (EWR)", from_id: "ewr", hours: "10", flight: "UA 1234" });
    assert.deepEqual([ewr.fare, ewr.fee, ewr.meet, ewr.total], [95000, 11400, 0, 106400]);
    const teb = await run({ ...SUV_HOUR, from_text: "Teterboro (TEB)", from_id: "teb", hours: "10", meet: "1" });
    assert.deepEqual([teb.trip.meet, teb.price.fare, teb.price.fee, teb.price.meet, teb.price.total], [true, 95000, 11400, 2500, 108900]);
    assert.deepEqual(pairs(teb.price.lines), [["Fare, 10 hours", 95000], [FEE_LINE, 11400], ["Meet and greet", 2500]]);
    const hoboken = await priced({ ...NEAR_HOUR, from_ticket: pickTicket("mock-clinton", CLINTON, "NJ"), hours: "10" });
    assert.deepEqual([hoboken.fare, hoboken.fee, hoboken.total], [105000, 12600, 117600]);
    await isQuote({ ...SUV_HOUR, from_text: "Newark Liberty (EWR)", from_id: "ewr", hours: "13" }, "hours-range");
    assert.equal((await priced({ ...SUV_HOUR, from_text: "Newark Liberty (EWR)", from_id: "ewr", hours: "12" })).fare, 114000);
  });
});

await test("hourly from any pickup: typed text outside the city with no pick, typed text that needs a ZIP, a pickup abroad and posted coordinates, zones or regions keep their requests, a New York State pickup with no county, picked from the list or Republic Airport, is priced, and an expired ticket is checked again with Place Details", async () => {
  await withMock(async () => {
    for (const from_text of [CLINTON, "1332 Clinton St, Hoboken, NJ 07030", "30 Hudson Street, Jersey City, NJ", "1 Gateway Center, Newark, NJ 07102", "40 S Broadway, Yonkers, NY 10701", "2 Popham Rd, Scarsdale, NY 10583", "30 Station Place, Stamford, CT"]) await isQuote({ ...NEAR_HOUR, from_text }, "outside-hourly");
    await isQuote({ ...NEAR_HOUR, from_text: "40 South Broadway, Yonkers, NY" }, "unplaced", "from_text");
    await isQuote({ ...NEAR_HOUR, from_text: "Hoboken" }, "unplaced", "from_text");
    await isQuote({ ...NEAR_HOUR, from_text: "Toronto, ON" }, "outside-hourly");
    const tower = "CN Tower, Bremner Boulevard, Toronto, ON, Canada";
    await isQuote({ ...NEAR_HOUR, from_text: tower, from_ticket: signTicket("mock-cn-tower", "abroad", tower, NOW) }, "outside-hourly");
    const somewhere = await priced({ ...NEAR_HOUR, from_text: "1 Main Street, Somewhere, NY", from_ticket: pickTicket("ChIJsomewhere", "1 Main Street, Somewhere, NY", "NY") });
    assert.deepEqual([somewhere.fare, somewhere.fee, somewhere.total], [42000, 5040, 47040]);
    const republic = await priced({ ...NEAR_HOUR, from_text: "Republic (FRG)", from_id: "frg" });
    assert.deepEqual([republic.fare, republic.fee, republic.total], [42000, 5040, 47040], "Republic Airport, a New York State pickup with no county, is priced by the hour");
    const posted = { from_lat: "40.753", from_lng: "-74.0343", lat: "40.753", lng: "-74.0343", near: "1", from_near: "1", from_zone: "manhattan", from_region: "8081", from_place: "mock-clinton", location: "40.753,-74.0343" };
    await isQuote({ ...NEAR_HOUR, ...posted }, "outside-hourly");
    const ignored = await run({ ...NEAR_HOUR, ...posted, from_text: "1 Main Street, Somewhere, NY", from_ticket: pickTicket("ChIJsomewhere", "1 Main Street, Somewhere, NY", "NY") });
    assert.deepEqual([ignored.trip.ends.from.zone, ignored.trip.ends.from.region, ignored.trip.ends.from.place, ignored.price.total], ["outside", "NY", "ChIJsomewhere", somewhere.total], "the posted zone, region and place are not read");
    const old = NOW - (TICKET_TTL + 60) * 1000;
    const fresh = await run({ ...SUV_HOUR, from_text: SCARSDALE_PICK, from_ticket: pickTicket("mock-scarsdale", SCARSDALE_PICK, "5581", old) });
    assert.deepEqual([fresh.result, fresh.trip.ends.from.region, fresh.price.total], [{ kind: "price", reason: "", hold: "" }, "5581", 42560]);
    const airport = await run({ ...SUV_HOUR, from_text: HPN_PICK, from_ticket: pickTicket("mock-hpn", HPN_PICK, "", old, "airport-other") });
    assert.deepEqual([airport.result, airport.trip.ends.from.zone, airport.trip.ends.from.region, airport.price.total], [{ kind: "price", reason: "", hold: "" }, "airport-other", "5581", 42560]);
  });
});

await test("hourly from any pickup: a tampered ticket and a ticket for another label are never read, so the pickup is typed text and keeps the request for typed text", async () => {
  await withMock(async () => {
    const plain = pickTicket("mock-scarsdale", SCARSDALE_PICK, "5581");
    const [, payload, mac] = plain.split(".");
    const forged = `v1.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), j: "NJ" })).toString("base64url")}.${mac}`;
    await isQuote({ ...NEAR_HOUR, from_text: SCARSDALE_PICK, from_ticket: forged }, "unplaced", "from_text");
    await isQuote({ ...NEAR_HOUR, from_text: "30 Station Place, Stamford, CT", from_ticket: pickTicket("mock-clinton", CLINTON, "NJ") }, "outside-hourly");
    await isQuote({ ...NEAR_HOUR, from_text: SCARSDALE_PICK, from_ticket: `v1.${payload}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}` }, "unplaced", "from_text");
    await isQuote({ ...NEAR_HOUR, from_ticket: `v1.${payload}.${mac}` }, "outside-hourly");
    assert.equal((await priced({ ...NEAR_HOUR, from_text: SCARSDALE_PICK, from_ticket: plain })).fee, 5040);
  });
});

await test("hourly from any pickup: every pickup keeps the other hourly rules, 3 to 12 hours, the Sprinter 4-hour minimum, the seats of each class and a street address for a town pick, also a town in New York State", async () => {
  await withMock(async () => {
    for (const fields of [{ from_ticket: pickTicket("mock-clinton", CLINTON, "NJ") }, { from_text: "Newark Liberty (EWR)", from_id: "ewr" }, { from_text: "Teterboro (TEB)", from_id: "teb" }]) {
      await isQuote({ ...NEAR_HOUR, ...fields, hours: "13" }, "hours-range");
      await isQuote({ ...NEAR_HOUR, ...fields, hours: "2" }, "hours-range");
      await isError({ ...NEAR_HOUR, ...fields, class: "sprinter", sprinter: "sprinter-executive", hours: "3" }, "sprinter-hours");
      await isClass({ ...NEAR_HOUR, ...fields, class: "sedan" }, "seats");
      const sprinter = await priced({ ...NEAR_HOUR, ...fields, class: "sprinter", sprinter: "sprinter-executive", passengers: "12" });
      assert.deepEqual([sprinter.fare, sprinter.fee, sprinter.total], [VEHICLES["sprinter-executive"].hourly * 4, 8400, 78400]);
    }
    await isQuote({ ...NEAR_HOUR, from_text: "Hoboken, NJ, USA", from_ticket: signTicket("mock-hoboken", "outside", "Hoboken, NJ, USA", NOW, 2, "NJ") }, "pickup-address");
    await isQuote({ ...NEAR_HOUR, from_text: "Yonkers, NY, USA", from_ticket: signTicket("ChIJyonkers", "outside", "Yonkers, NY, USA", NOW, 2) }, "pickup-address");
    await isQuote({ ...NEAR_HOUR, from_text: "Westchester County, NY, USA", from_ticket: signTicket("ChIJwestchester", "outside", "Westchester County, NY, USA", NOW, 1) }, "pickup-address");
  });
});

await test("hourly from New York City keeps its rates: Manhattan, Brooklyn, JFK and LaGuardia pay the 12% service fee, and meet and greet at JFK and LaGuardia is $25", async () => {
  for (const fields of [{}, { from_text: "277 Bedford Ave, Brooklyn, NY 11211" }, { from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "1" }, { from_text: "LaGuardia (LGA)", from_id: "lga", meet: "1" }]) {
    const price = await priced({ ...HOURLY, ...fields });
    assert.deepEqual([price.fare, price.fee, price.meet, price.total], [25500, 3060, fields.meet ? 2500 : 0, 28560 + (fields.meet ? 2500 : 0)], JSON.stringify(fields));
  }
});

await test("service fee: the receipt rebuilt from the payment metadata matches the charged lines and total for airport, distance, round and hourly trips, with one Service fee line from tax_cents and no sales tax line", async () => {
  await withMock(async () => {
    for (const fields of [BASE, { ...BASE, ...EWR_ROW, tip: "15" }, { ...BASE, from_text: MINEOLA }, { ...BASE, from_text: HOBOKEN, meet: "1" }, { ...BASE, ...EWR_ROW, ...ROUND_TRIP }, HOURLY]) {
      const { trip, price } = await run(fields);
      const meta = Object.fromEntries(Object.entries({ ref: "48213590", service: price.service, class: trip.class, hours: trip.hours, vehicle: trip.vehicle, airport: (trip.legs[0] || {}).airport || "", direction: (trip.legs[0] || {}).direction || "", legs: trip.trip_type === "hour" ? "0" : String(trip.legs.length), date: trip.date, time: trip.time, fare_cents: price.fare, tax_cents: price.fee, tolls_cents: price.tolls, meet_cents: price.meet, tip_percent: price.tipPercent, tip_cents: price.tip, total_cents: price.total }).map(([key, value]) => [key, String(value)]));
      const out = receipt(meta, ON);
      assert.deepEqual(pairs(shownLines(out.lines)), pairs(shownLines(price.lines)), JSON.stringify(fields));
      assert.equal(out.lines.reduce((sum, item) => sum + item.cents, 0), price.total, JSON.stringify(fields));
      assert.equal(out.lines.some((item) => item.label === TAX || item.label === "Black Car Fund"), false, JSON.stringify(fields));
      assert.deepEqual(out.lines.filter((item) => item.label === FEE_LINE).map((item) => item.cents), [price.fee], JSON.stringify(fields));
    }
  });
});

const DOGS = { small_dogs: "1", large_dogs: "2" };
const dogLines = [["Small dog (1 x $20.00)", 2000], ["Large dog (2 x $45.00)", 9000]];

await test("pets: SMALL_DOG_CENTS is 2000 and LARGE_DOG_CENTS is 4500 in api/_rates.mjs, next to the child seats, at most MAX_DOGS of 3 of each size, each size with its own form field read as a count", () => {
  assert.deepEqual([RATES.SMALL_DOG_CENTS, RATES.LARGE_DOG_CENTS, RATES.MAX_DOGS], [2000, 4500, 3]);
  assert.deepEqual(RATES.DOG_SIZES, ["small", "large"]);
  assert.deepEqual(readInput({ ...BASE, small_dogs: " 02 ", large_dogs: "" }).dogs, { small: "2", large: "" });
  assert.deepEqual(readInput({ ...BASE, dogs: "3", small: "1" }).dogs, { small: "", large: "" });
  assert.deepEqual(readInput({ ...HOURLY, large_dogs: "1" }).dogs, { small: "", large: "1" });
});

await test("pets on a one way airport trip: 1 small dog and 2 large dogs add $20.00 and 2 x $45.00 as two lines of their own after the child seats and before the gratuity, with no service fee on them and outside the gratuity like the child seats, and the fare, fee, tolls and gratuity stay the same", async () => {
  const base = await priced({ ...FROM_JFK, meet: "1", tip: "15", infant_seats: "1" });
  const dogs = await priced({ ...FROM_JFK, meet: "1", tip: "15", infant_seats: "1", ...DOGS });
  assert.deepEqual(pairs(dogs.lines), [...LEG, ["Meet and greet", 2500], ["Child seats (1 x $20.00)", 2000], ...dogLines, ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.deepEqual([dogs.fare, dogs.fee, dogs.tolls, dogs.meet, dogs.seats, dogs.tip], [base.fare, base.fee, base.tolls, base.meet, base.seats, base.tip]);
  assert.equal(dogs.fee, 1845);
  assert.deepEqual([dogs.dogs, dogs.dogCounts, dogs.dogCents], [11000, { small: 1, large: 2 }, { small: 2000, large: 9000 }]);
  assert.deepEqual([base.total, dogs.total, dogs.value], [25307, 36307, 15379 + 2500 + 2000 + 11000]);
  assert.equal(dogs.lines.reduce((sum, l) => sum + l.cents, 0), 36307);
  assert.deepEqual(pairs(shownLines(dogs.lines)).slice(-3), [...dogLines, ["Gratuity for your chauffeur (15%)", 2307]], "the dog lines are never merged with the fees or each other");
  assert.deepEqual(pairs((await priced({ ...BASE, small_dogs: "1" })).lines).at(-1), ["Small dog (1 x $20.00)", 2000]);
  assert.deepEqual(pairs((await priced({ ...BASE, large_dogs: "1" })).lines).at(-1), ["Large dog (1 x $45.00)", 4500]);
  const max = await priced({ ...BASE, small_dogs: "3", large_dogs: "3" });
  assert.deepEqual([pairs(max.lines).slice(-2), max.total], [[["Small dog (3 x $20.00)", 6000], ["Large dog (3 x $45.00)", 13500]], AIRPORT_TOTALS.suv.jfk + 19500]);
  const none = await priced({ ...BASE, small_dogs: "0", large_dogs: "0" });
  assert.deepEqual([none.dogs, none.total, none.lines.some((l) => /dog/i.test(l.label))], [0, AIRPORT_TOTALS.suv.jfk, false]);
});

await test("pets in every class at every airport, flat totals plus $20.00 for each small dog and $45.00 for each large dog, with no change to the service fee", async () => {
  for (const cls of Object.keys(CLASSES)) {
    for (const [airport, to_text, to_id] of [["jfk", "John F. Kennedy (JFK)", "jfk"], ["lga", "LaGuardia (LGA)", "lga"], ["ewr", "Newark Liberty (EWR)", "ewr"]]) {
      const fields = { ...BASE, class: cls, to_text, to_id, passengers: "1" };
      const plain = await priced(fields);
      const dogs = await priced({ ...fields, ...DOGS });
      assert.deepEqual([plain.total, dogs.total, dogs.fee, plain.fee], [AIRPORT_TOTALS[rateKey(cls)][airport], AIRPORT_TOTALS[rateKey(cls)][airport] + 11000, FEE(plain.fare), FEE(plain.fare)], `${cls} ${airport}`);
      assert.deepEqual(pairs(dogs.lines).slice(-2), dogLines, `${cls} ${airport}`);
    }
  }
});

await test("pets on a round trip are charged once for the booking, not once per ride, in a First Class and a Luxury Sprinter", async () => {
  for (const cls of ["first", "sprinter"]) {
    const none = await priced({ ...BASE, ...ROUND_TRIP, class: cls, passengers: "3", tip: "10" });
    const dogs = await priced({ ...BASE, ...ROUND_TRIP, class: cls, passengers: "3", tip: "10", ...DOGS });
    assert.deepEqual([dogs.legs.length, dogs.total - none.total, dogs.tip], [2, 11000, none.tip], cls);
    assert.equal(dogs.lines.filter((l) => /dog/.test(l.label)).length, 2);
    assert.deepEqual(pairs(dogs.lines).slice(-3, -1), dogLines, cls);
  }
  const sprinter = await priced({ ...BASE, ...ROUND_TRIP, class: "sprinter", passengers: "12", small_dogs: "3", large_dogs: "3" });
  assert.equal(sprinter.total, 2 * AIRPORT_TOTALS["sprinter-executive"].jfk + 19500);
});

await test("pets on hourly bookings in every class that books by the hour: count x $20.00 and count x $45.00 once, after the fare and the service fee, and the gratuity stays a percent of the fare", async () => {
  for (const [cls, vehicle, hourly] of [["sedan", "sedan", 8500], ["electric", "electric", 12500], ["suv", "suv-denali", 10000], ["premium", "premium", 10500], ["first", "first", 17500]]) {
    const fields = { ...HOURLY, class: cls, vehicle, passengers: "1", tip: "20" };
    const none = await priced(fields);
    const dogs = await priced({ ...fields, ...DOGS });
    assert.deepEqual([none.fare, dogs.fare, dogs.fee, none.fee, dogs.tip, dogs.total - none.total], [hourly * 3, hourly * 3, FEE(hourly * 3), FEE(hourly * 3), percentCents(hourly * 3, "20"), 11000], cls);
    assert.deepEqual(pairs(dogs.lines).slice(-3), [...dogLines, [`Gratuity for your chauffeur (20%)`, percentCents(hourly * 3, "20")]], cls);
  }
  const sedan = await priced({ ...HOURLY, tip: "20", small_dogs: "2" });
  assert.deepEqual(pairs(sedan.lines), [["Fare, 3 hours", 25500], [FEE_LINE, 3060], ["Small dog (2 x $20.00)", 4000], ["Gratuity for your chauffeur (20%)", 5100]]);
  assert.equal(sedan.total, 25500 + 3060 + 4000 + 5100);
});

await test("pets on trips priced by distance and time and on trips with stops add the same lines once on top of the route fare or the stop fee", async () => {
  await withMock(async () => {
    const one = await priced({ ...RIDE, class: "suv", ...DOGS });
    assert.deepEqual(pairs(one.lines), [["Fare", 11705], [FEE_LINE, 1405], ...dogLines]);
    assert.deepEqual([one.total, one.service], [13110 + 11000, "distance"]);
    const back = await priced({ ...RIDE, ...ROUND_TRIP, to_text: GREENWICH, class: "sedan", tip: "15", large_dogs: "1" });
    assert.deepEqual(pairs(back.lines), [["Fare", 39400], [FEE_LINE, 4728], ["Large dog (1 x $45.00)", 4500], ["Gratuity for your chauffeur (15%)", 5910]]);
    assert.equal(back.total, 39400 + 4728 + 4500 + 5910);
    const stop = await priced({ ...STOPS, ...DOGS, route: signRoute([[stopKey([ANN]), 100, 30]], NOW) });
    assert.deepEqual(pairs(stop.lines), [["Fare", 13593], [FEE_LINE, 1631], ["Tolls and airport fees", 1276], ["Extra stop", 2000], ...dogLines]);
    assert.deepEqual([stop.total, stop.service], [16500 + 2000 + 11000, "airport"]);
    const sprinter = await priced({ ...STOPS, class: "sprinter", small_dogs: "1" });
    assert.equal(sprinter.total, AIRPORT_TOTALS["sprinter-executive"].lga + 2000 + 2000);
  });
});

await test("class totals include the pets once: every priced class card adds them, and a car too small for the passengers keeps the seats reason", async () => {
  const { trip } = await run({ ...BASE, passengers: "3", ...DOGS });
  assert.deepEqual(Object.keys(CLASSES).map((cls) => classTotal(trip, cls)), Object.keys(CLASSES).map((cls) => AIRPORT_TOTALS[rateKey(cls)].jfk + 11000));
  const crowd = await run({ ...BASE, passengers: "5", class: "first", small_dogs: "1" });
  assert.deepEqual(crowd.result, { kind: "price", reason: "seats", hold: "" });
  assert.equal(classTotal(crowd.trip, "suv"), AIRPORT_TOTALS.suv.jfk + 2000);
});

await test("the pet limit: 0 to 3 dogs of each size, on one way, round trip and hourly bookings, and anything else is the dogs error with its own message, checked on the server whatever the page sent", async () => {
  for (const name of ["small_dogs", "large_dogs"]) {
    for (const bad of ["4", "10", "-1", "1.5", "x", "1e1", "0x1", "99999999999999999999999", "+1", "3 dogs"]) await isError({ ...BASE, [name]: bad }, "dogs");
    for (const ok of ["", "0", "00", " 2 ", "03", "3"]) assert.deepEqual((await run({ ...BASE, [name]: ok })).result, { kind: "price", reason: "", hold: "" }, `${name} ${ok}`);
    await isError({ ...BASE, ...ROUND_TRIP, [name]: "4" }, "dogs");
    await isError({ ...HOURLY, [name]: "4" }, "dogs");
    await isError({ ...BASE, action: "options", [name]: "4" }, "dogs");
  }
  await isError({ ...BASE, passengers: "2", infant_seats: "3", small_dogs: "4" }, "child_seats");
  assert.deepEqual(ERRORS.dogs, { field: "dogs", text: "Choose up to 3 small dogs and up to 3 large dogs." });
  assert.ok(ERRORS.dogs.text.includes(`up to ${RATES.MAX_DOGS} small dogs and up to ${RATES.MAX_DOGS} large dogs`));
  assert.equal((await priced({ ...BASE, passengers: "1", small_dogs: "3", large_dogs: "3" })).dogs, 19500, "dogs are not passengers, so one rider can bring six");
});

await test("the reserve by email and WhatsApp messages and the dispatch quote path list each dog size with its count after the child seats, only for the sizes chosen, and nothing when no dog is chosen", async () => {
  const { trip, price } = await run({ ...FROM_JFK, meet: "1", tip: "15", passengers: "3", infant_seats: "1", ...DOGS });
  const text = composeMessage(trip, "48213590", price.total);
  assert.ok(text.includes("\nMeet and greet: Yes\nInfant seats: 1\nSmall dogs: 1\nLarge dogs: 2\nGratuity: 15%\nTotal shown: $363.07"), text);
  assert.equal(price.total, 36307);
  const links = contactLinks(trip, "48213590", price.total);
  for (const href of [links.whatsapp, links.mailto]) assert.ok(decodeURIComponent(href).includes("\nSmall dogs: 1\nLarge dogs: 2\n"), href);
  assert.ok(!/dogs: /.test(composeMessage((await run(FROM_JFK)).trip, "48213590", 18500)));
  assert.ok(composeMessage((await run({ ...BASE, large_dogs: "1" })).trip, "48213590").includes("\nLarge dogs: 1") && !composeMessage((await run({ ...BASE, large_dogs: "1" })).trip, "48213590").includes("Small dogs"));
  for (const fields of [{ ...RIDE, to_text: "Niagara Falls, ON L2E 6T2", small_dogs: "2" }, { ...HOURLY, hours: "13", small_dogs: "2" }, { ...BASE, stop1_text: BROOKLYN, small_dogs: "2" }]) {
    const out = await run(fields);
    assert.ok(["quote", "price"].includes(out.result.kind) && (out.result.reason || out.result.kind === "quote"), JSON.stringify(out.result));
    assert.ok(composeMessage(out.trip, "48213590").includes("\nSmall dogs: 2"), JSON.stringify(fields));
  }
});

await test("the receipt rebuilds the dog lines from the dogs metadata, with the price per dog it was paid at, adds them to the value, counts the child seats by type when the booking has dogs, and leaves them out when there are none", () => {
  const meta = { ref: "48213590", service: "airport", direction: "from-airport", airport: "jfk", class: "suv", date: "2026-10-14", time: "07:30", legs: "1", fare_cents: "15379", tax_cents: "1845", tolls_cents: "1276", meet_cents: "2500", tip_percent: "15", tip_cents: "2307", seats_cents: "6000", infant_seats: "1", booster_seats: "2", dogs: "1 small 2000, 2 large 9000" };
  const r = receipt(meta, ON);
  assert.deepEqual(pairs(r.lines), [...LEG, ["Meet and greet", 2500], ["Child seats (3 x $20.00)", 6000], ...dogLines, ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(r.value, 15379 + 2500 + 6000 + 11000);
  assert.equal(r.lines.reduce((sum, l) => sum + l.cents, 0), 40307);
  assert.deepEqual(pairs(receipt({ ...meta, dogs: "2 large 6000" }, ON).lines).slice(-2, -1), [["Large dog (2 x $30.00)", 6000]], "an old booking keeps the price per dog it was paid at");
  assert.deepEqual(pairs(receipt({ ...meta, dogs: "3 small 6000" }, ON).lines).slice(-2, -1), [["Small dog (3 x $20.00)", 6000]]);
  const none = { ...meta };
  delete none.dogs;
  assert.deepEqual(pairs(receipt({ ...none, child_seats: "3" }, ON).lines), [...LEG, ["Meet and greet", 2500], ["Child seats (3 x $20.00)", 6000], ["Gratuity for your chauffeur (15%)", 2307]]);
  assert.equal(receipt({ ...none, child_seats: "3" }, ON).value, 23879);
  assert.deepEqual(pairs(receipt({ ...none, dogs: "lots of dogs" }, ON).lines).filter(([l]) => /dog/i.test(l)), []);
});

const BAGS = { large_bags: "4", medium_bags: "3", small_bags: "2" };

await test("bags: BAG_SIZES is large, medium and small and MAX_BAGS is 14 in api/_rates.mjs, next to the pets, each size with its own form field read as a count, and CLASSES states the luggage the over-capacity note reads", () => {
  assert.deepEqual([RATES.BAG_SIZES, RATES.MAX_BAGS], [["large", "medium", "small"], 14]);
  assert.deepEqual(readInput({ ...BASE, large_bags: " 03 ", small_bags: "" }).bags, { large: "3", medium: "", small: "" });
  assert.deepEqual(readInput({ ...BASE, bags: "3", large: "1", medium: "2" }).bags, { large: "", medium: "", small: "" });
  assert.deepEqual(readInput({ ...HOURLY, small_bags: "1" }).bags, { large: "", medium: "", small: "1" });
  assert.deepEqual(readInput({ ...HOURLY, medium_bags: " 05 " }).bags, { large: "", medium: "5", small: "" });
  assert.deepEqual(readInput({ ...BASE, ...BAGS, action: "options" }).bags, { large: "4", medium: "3", small: "2" });
  assert.deepEqual(Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.bags])), { suv: "3 large plus 3 small bags", premium: "3 large plus 3 small bags", first: "2 large plus 1 small bag", sedan: "", electric: "", sprinter: "10 large plus 2 small bags" });
});

await test("the bag limit: 0 to 14 bags of each size, on one way, round trip and hourly bookings and on options and quotes, and anything else is the bags error with its own message, checked on the server whatever the page sent", async () => {
  for (const name of ["large_bags", "medium_bags", "small_bags"]) {
    for (const bad of ["15", "99", "-1", "1.5", "x", "1e1", "0x1", "99999999999999999999999", "+1", "2 bags"]) await isError({ ...BASE, [name]: bad }, "bags");
    for (const ok of ["", "0", "00", " 7 ", "014", "14"]) assert.deepEqual((await run({ ...BASE, [name]: ok })).result, { kind: "price", reason: "", hold: "" }, `${name} ${ok}`);
    await isError({ ...BASE, ...ROUND_TRIP, [name]: "15" }, "bags");
    await isError({ ...HOURLY, [name]: "15" }, "bags");
    await isError({ ...BASE, action: "options", [name]: "15" }, "bags");
    await isError({ ...BASE, action: "quote", [name]: "15" }, "bags");
  }
  await isError({ ...BASE, small_dogs: "4", large_bags: "15" }, "dogs");
  assert.deepEqual(ERRORS.bags, { field: "bags", text: "Choose up to 14 suitcases of each size. For more bags, tell us in the notes." });
  assert.ok(ERRORS.bags.text.includes(`up to ${RATES.MAX_BAGS} suitcases of each size`));
});

await test("bags are free and never block a booking: no price line, the same totals and class cards for every class, one way, round trip and hourly, even far over what the car states, and they are not passengers", async () => {
  const most = { large_bags: "14", medium_bags: "14", small_bags: "14" };
  for (const cls of Object.keys(CLASSES)) {
    const plain = await priced({ ...BASE, class: cls });
    for (const bags of [BAGS, most, { small_bags: "1" }, { medium_bags: "2" }]) {
      const with_ = await priced({ ...BASE, class: cls, ...bags });
      assert.deepEqual([pairs(with_.lines), with_.total, with_.value], [pairs(plain.lines), plain.total, plain.value], `${cls} ${JSON.stringify(bags)}`);
    }
    const round = await priced({ ...BASE, ...ROUND_TRIP, class: cls, ...most });
    assert.equal(round.total, (await priced({ ...BASE, ...ROUND_TRIP, class: cls })).total, cls);
  }
  const hourly = await priced({ ...HOURLY, ...most });
  assert.equal(hourly.total, (await priced(HOURLY)).total);
  assert.ok(!(await priced({ ...BASE, ...most })).lines.some((l) => /bag/i.test(l.label)));
  const { trip } = await run({ ...BASE, ...most });
  assert.deepEqual(Object.keys(CLASSES).map((cls) => classTotal(trip, cls)), Object.keys(CLASSES).map((cls) => AIRPORT_TOTALS[rateKey(cls)].jfk));
  await isClass({ ...BASE, passengers: "4", class: "first", large_bags: "1" }, "seats");
  assert.deepEqual((await run({ ...BASE, passengers: "1", class: "first", ...most })).result, { kind: "price", reason: "", hold: "" }, "bags are not passengers, so one rider can bring 42");
});

await test("bag counts and text: bagCounts reads each size as a whole number, bagText names the sizes chosen in the site's count style, and nothing when no bag is chosen", () => {
  assert.deepEqual(bagCounts({ bags: { large: "2", small: "" } }), { large: 2, medium: 0, small: 0 });
  assert.deepEqual(bagCounts({ bags: { large: "x", medium: "1", small: "3" } }), { large: 0, medium: 1, small: 3 });
  assert.deepEqual(bagCounts({}), { large: 0, medium: 0, small: 0 });
  assert.equal(bagText({ bags: { large: "4", small: "2" } }), "4 large suitcases and 2 small suitcases or hand carry");
  assert.equal(bagText({ bags: { large: "1", small: "1" } }), "1 large suitcase and 1 small suitcase or hand carry");
  assert.equal(bagText({ bags: { large: "4", medium: "3", small: "2" } }), "4 large suitcases, 3 medium suitcases and 2 small suitcases or hand carry");
  assert.equal(bagText({ bags: { large: "1", medium: "1", small: "1" } }), "1 large suitcase, 1 medium suitcase and 1 small suitcase or hand carry");
  assert.equal(bagText({ bags: { medium: "2" } }), "2 medium suitcases");
  assert.equal(bagText({ bags: { large: "0", small: "3" } }), "3 small suitcases or hand carry");
  assert.equal(bagText({ bags: { large: "1", small: "0" } }), "1 large suitcase");
  assert.equal(bagText({ bags: { large: "", small: "" } }), "");
  assert.deepEqual(LABELS.bagTypes, { large: "Large suitcase", medium: "Medium suitcase", small: "Small suitcase or hand carry" });
});

await test("bags ride in the passengers metadata value: the count first, then each size chosen, so the worst case adds no key, and bookingData reads the counts back and old bookings without bags read as before", () => {
  assert.equal(paxMeta({ passengers: "3", bags: { large: "2", small: "1" } }), "3, 2 large bags, 1 small bag");
  assert.equal(paxMeta({ passengers: "12", bags: { large: "1", small: "14" } }), "12, 1 large bag, 14 small bags");
  assert.equal(paxMeta({ passengers: "1", bags: { large: "", small: "3" } }), "1, 3 small bags");
  assert.equal(paxMeta({ passengers: "3", bags: { large: "2", medium: "1", small: "1" } }), "3, 2 large bags, 1 medium bag, 1 small bag");
  assert.equal(paxMeta({ passengers: "14", bags: { large: "14", medium: "14", small: "14" } }), "14, 14 large bags, 14 medium bags, 14 small bags");
  assert.equal(paxMeta({ passengers: "2", bags: { medium: "3" } }), "2, 3 medium bags");
  assert.equal(paxMeta({ passengers: "2", bags: { large: "0", small: "0" } }), "2");
  assert.equal(paxMeta({ passengers: "2" }), "2");
  const base = { ref: "48213590", class: "suv", date: "2026-10-14", time: "07:30" };
  assert.deepEqual(bookingData({ ...base, passengers: "3, 2 large bags, 1 small bag" }), { ...base, passengers: "3", large_bags: "2", small_bags: "1" });
  assert.deepEqual(bookingData({ ...base, passengers: "1, 3 small bags" }), { ...base, passengers: "1", small_bags: "3" });
  assert.deepEqual(bookingData({ ...base, passengers: "3, 2 large bags, 1 medium bag, 4 small bags" }), { ...base, passengers: "3", large_bags: "2", medium_bags: "1", small_bags: "4" });
  assert.deepEqual(bookingData({ ...base, passengers: "2, 3 medium bags" }), { ...base, passengers: "2", medium_bags: "3" });
  assert.deepEqual(bookingData({ ...base, passengers: "3" }), { ...base, passengers: "3" }, "an old booking without bags");
  assert.deepEqual(bookingData({ ...base, passengers: "3, many bags" }), { ...base, passengers: "3, many bags" }, "a value the site never writes is left as it is");
  assert.deepEqual(bookingData(base), base);
  assert.deepEqual(bookingData({ ...base, passengers: 3 }), { ...base, passengers: 3 });
});

await test("the receipt of a booking with bags is the receipt without them: bags add no line and no value, from new and old metadata", () => {
  const meta = { ref: "48213590", service: "airport", direction: "from-airport", airport: "jfk", class: "suv", date: "2026-10-14", time: "07:30", legs: "1", passengers: "2", fare_cents: "15379", tax_cents: "1845", tolls_cents: "1276", meet_cents: "2500", tip_percent: "15", tip_cents: "2307" };
  const old = receipt(meta, ON);
  const bagged = receipt({ ...meta, passengers: "2, 4 large bags, 3 medium bags, 2 small bags" }, ON);
  assert.deepEqual([pairs(bagged.lines), bagged.value, bagged.summary, bagged.notes], [pairs(old.lines), old.value, old.summary, old.notes]);
  assert.deepEqual(pairs(old.lines), [...LEG, ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2307]]);
});

await test("the reserve by email and WhatsApp messages and the dispatch quote path list each bag size with its count right after the passengers, only for the sizes chosen, and nothing when no bag is chosen", async () => {
  const { trip, price } = await run({ ...FROM_JFK, meet: "1", tip: "15", passengers: "3", infant_seats: "1", small_dogs: "1", ...BAGS });
  const text = composeMessage(trip, "48213590", price.total);
  assert.ok(text.includes("\nPassengers: 3\nLarge suitcase: 4\nMedium suitcase: 3\nSmall suitcase or hand carry: 2\nVehicle: Business SUV\nMeet and greet: Yes\nInfant seats: 1\nSmall dogs: 1\nGratuity: 15%\n"), text);
  const links = contactLinks(trip, "48213590", price.total);
  for (const href of [links.whatsapp, links.mailto]) assert.ok(decodeURIComponent(href).includes("\nPassengers: 3\nLarge suitcase: 4\nMedium suitcase: 3\nSmall suitcase or hand carry: 2\n"), href);
  assert.ok(!/suitcase/i.test(composeMessage((await run(FROM_JFK)).trip, "48213590", 18500)));
  const small = composeMessage((await run({ ...BASE, small_bags: "1" })).trip, "48213590");
  assert.ok(small.includes("\nPassengers: 2\nSmall suitcase or hand carry: 1\n") && !small.includes("Large suitcase") && !small.includes("Medium suitcase"), small);
  const medium = composeMessage((await run({ ...BASE, medium_bags: "2" })).trip, "48213590");
  assert.ok(medium.includes("\nPassengers: 2\nMedium suitcase: 2\nVehicle: ") && !/(Large|Small) suitcase/.test(medium), medium);
  for (const fields of [{ ...RIDE, to_text: "Niagara Falls, ON L2E 6T2", large_bags: "2" }, { ...HOURLY, hours: "13", large_bags: "2" }, { ...BASE, stop1_text: BROOKLYN, large_bags: "2" }]) {
    const out = await run(fields);
    assert.ok(["quote", "price"].includes(out.result.kind) && (out.result.reason || out.result.kind === "quote"), JSON.stringify(out.result));
    assert.ok(composeMessage(out.trip, "48213590").includes("\nPassengers: 2\nLarge suitcase: 2\n"), JSON.stringify(fields));
  }
});

await test("child seat limits per class: the Executive Sedan and Electric Class take 1 child seat, the Business SUV and Business Premium SUV seat 6 with up to 3 child seats, at least 1 adult and 2 child seats with only 1 adult, and First Class and the Sprinters keep one child seat per passenger", async () => {
  const { childReason } = await import("../api/_trip.mjs");
  assert.deepEqual(RATES.CHILD_SEAT_LIMITS, { suv: { seats: 3, adults: 1, oneAdult: 2 }, premium: { seats: 3, adults: 1, oneAdult: 2 }, sedan: { seats: 1 }, electric: { seats: 1 } });
  assert.deepEqual([CLASSES.suv.seats, CLASSES.premium.seats, CLASSES.first.seats, CLASSES.sedan.seats, CLASSES.electric.seats], [6, 6, 3, 3, 3]);
  for (const cls of ["sedan", "electric"]) {
    assert.equal((await priced({ ...BASE, class: cls, passengers: "2", infant_seats: "1" })).seatCount, 1, cls);
    assert.equal((await priced({ ...BASE, class: cls, passengers: "1", booster_seats: "1" })).seatCount, 1, cls);
    await isClass({ ...BASE, class: cls, passengers: "3", infant_seats: "1", booster_seats: "1" }, "child-seats");
    await isClass({ ...BASE, class: cls, passengers: "2", toddler_seats: "2" }, "child-seats");
    await isClass({ ...HOURLY, class: cls, vehicle: cls, passengers: "3", toddler_seats: "2" }, "child-seats");
    await isClass({ ...BASE, class: cls, passengers: "4", toddler_seats: "1" }, "seats");
  }
  for (const cls of ["suv", "premium"]) {
    assert.equal((await priced({ ...BASE, class: cls, passengers: "6", toddler_seats: "2" })).total, AIRPORT_TOTALS[cls].jfk + 4000, `${cls}: 4 adults and 2 children`);
    assert.equal((await priced({ ...BASE, class: cls, passengers: "6", infant_seats: "1", toddler_seats: "1", booster_seats: "1" })).seatCount, 3, cls);
    assert.equal((await priced({ ...BASE, class: cls, passengers: "5", toddler_seats: "3" })).seatCount, 3, `${cls}: 2 adults and 3 child seats`);
    assert.equal((await priced({ ...BASE, class: cls, passengers: "3", toddler_seats: "2" })).seatCount, 2, `${cls}: 1 adult and 2 child seats`);
    assert.equal((await priced({ ...BASE, class: cls, passengers: "6" })).total, AIRPORT_TOTALS[cls].jfk, `${cls}: 6 passengers`);
    await isClass({ ...BASE, class: cls, passengers: "6", toddler_seats: "4" }, "child-seats");
    await isClass({ ...BASE, class: cls, passengers: "6", infant_seats: "2", booster_seats: "2" }, "child-seats");
    await isClass({ ...BASE, class: cls, passengers: "4", toddler_seats: "3" }, "one-adult");
    await isClass({ ...BASE, class: cls, passengers: "2", toddler_seats: "2" }, "adult");
    await isClass({ ...BASE, class: cls, passengers: "1", infant_seats: "1" }, "adult");
    await isClass({ ...BASE, class: cls, passengers: "3", infant_seats: "3" }, "adult");
    await isClass({ ...BASE, class: cls, passengers: "7" }, "seats");
    await isClass({ ...BASE, class: cls, passengers: "7", toddler_seats: "2" }, "seats");
  }
  await isClass({ ...HOURLY, class: "suv", vehicle: "suv-navigator", passengers: "4", booster_seats: "3" }, "one-adult");
  await isClass({ ...HOURLY, class: "premium", vehicle: "premium", passengers: "2", booster_seats: "2" }, "adult");
  assert.equal((await priced({ ...BASE, class: "first", passengers: "3", infant_seats: "3" })).seatCount, 3, "First Class keeps one child seat per passenger");
  assert.equal((await priced({ ...BASE, class: "sprinter", passengers: "1", infant_seats: "1" })).seatCount, 1, "the Sprinters keep one child seat per passenger");
  await isError({ ...BASE, class: "sedan", passengers: "1", infant_seats: "2" }, "child_seats");
  const four = { passengers: "4", seats: { toddler: "3" } };
  assert.deepEqual(Object.keys(CLASSES).map((cls) => childReason(four, cls)), ["one-adult", "one-adult", "", "child-seats", "child-seats", ""]);
  assert.deepEqual(Object.keys(CLASSES).map((cls) => childReason({ passengers: "3", seats: { infant: "1" } }, cls)), ["", "", "", "", "", ""]);
  assert.deepEqual(["child-seats", "adult", "one-adult"].map((r) => [REASONS[r].group, REASONS[r].text]), [
    ["phone", "This car can't take that many child seats. An Executive Sedan or Electric Class car takes 1, an SUV up to 3. Choose another car, or send us the trip."],
    ["phone", "A Business SUV or Business Premium SUV needs at least 1 adult on board. Children count as passengers. Choose another car, or send us the trip."],
    ["phone", "With only 1 adult, a Business SUV or Business Premium SUV takes up to 2 child seats. Choose another car, or send us the trip."],
  ]);
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
