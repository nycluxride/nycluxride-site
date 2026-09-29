import assert from "node:assert/strict";
import {
  readInput,
  readSettings,
  checkTrip,
  priceTrip,
  bookingRef,
  nycToUtc,
  formatDate,
  formatTime,
  composeMessage,
  contactLinks,
  fill,
} from "../api/_trip.mjs";
import { ERRORS, REASONS, NOTES } from "../api/_copy.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const TAXED = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_RATE_ID: "txr_test0000000000", SALES_TAX_PERCENT: "8.875" });
const ADDRESS = "350 Fifth Avenue";
const BASE = { trip_type: "one", from: "manhattan", from_address: ADDRESS, to: "jfk", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv" };
const FROM_JFK = { ...BASE, from: "jfk", from_address: "", to: "manhattan", to_address: ADDRESS };
const HOURLY = { trip_type: "hour", from: "manhattan", from_address: ADDRESS, date: "2026-10-14", time: "07:30", passengers: "2", hours: "3" };

const seenErrors = new Set();
const seenReasons = new Set();

function run(fields, settings = ON, now = NOW) {
  const trip = readInput(fields);
  const result = checkTrip(trip, now, settings);
  if (result.kind === "invalid") seenErrors.add(result.code);
  if (result.kind === "quote") seenReasons.add(result.reason);
  return { trip, result, price: result.kind === "price" ? priceTrip(trip, settings) : null };
}

function priced(fields, settings = ON) {
  const out = run(fields, settings);
  assert.equal(out.result.kind, "price", JSON.stringify(out.result));
  return out.price;
}

const isError = (fields, code, settings = ON, now = NOW) => assert.deepEqual(run(fields, settings, now).result, { kind: "invalid", code }, JSON.stringify(fields));
const isQuote = (fields, reason, settings = ON, now = NOW) => assert.deepEqual(run(fields, settings, now).result, { kind: "quote", reason }, JSON.stringify(fields));

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

const PRICED = [
  ["JFK, Business SUV, drop-off", BASE, 19800],
  ["from JFK, Business SUV, with meet and greet", { ...FROM_JFK, meet: "1" }, 22300],
  ["LaGuardia, Business SUV", { ...BASE, to: "lga" }, 15600],
  ["Newark Liberty, Business SUV", { ...BASE, to: "ewr" }, 19800],
  ["Teterboro, Business SUV", { ...BASE, to: "teb" }, 19800],
  ["JFK, First Class", { ...BASE, class: "first" }, 19800],
  ["Sedan & Electric, 3 hours", { ...HOURLY, vehicle: "sedan" }, 30600],
  ["Chevrolet Suburban or similar, 3 hours", { ...HOURLY, vehicle: "suv-suburban" }, 34200],
  ["GMC Denali, 3 hours", { ...HOURLY, vehicle: "suv-denali" }, 36000],
  ["Lincoln Navigator, 3 hours", { ...HOURLY, vehicle: "suv-navigator" }, 36000],
  ["Cadillac Escalade ESV, 4 hours", { ...HOURLY, vehicle: "suv-escalade", hours: "4" }, 50400],
  ["First Class, 12 hours", { ...HOURLY, vehicle: "first", hours: "12" }, 180000],
  ["hourly from JFK with no address, Sedan & Electric, 3 hours", { ...HOURLY, from: "jfk", from_address: "", vehicle: "sedan" }, 30600],
  ["hourly from LaGuardia, Sedan & Electric, 3 hours", { ...HOURLY, from: "lga", from_address: "", vehicle: "sedan" }, 30600],
];

for (const [name, fields, total] of PRICED) {
  test(`priced: ${name} is ${total} cents`, () => assert.equal(priced(fields).total, total));
}

test("the JFK drop-off lines, notes and value", () => {
  const price = priced(BASE);
  assert.deepEqual(price.lines, [
    { label: "To JFK, Business SUV", cents: 16500 },
    { label: "Gratuity for your chauffeur (20%)", cents: 3300 },
  ]);
  assert.deepEqual(price.notes, [NOTES.after]);
  assert.deepEqual([price.fare, price.meet, price.gratuity, price.tax, price.value], [16500, 0, 3300, 0, 16500]);
});

test("the JFK pickup with meet and greet lines match the contract example", () => {
  assert.deepEqual(priced({ ...FROM_JFK, meet: "1" }).lines, [
    { label: "From JFK, Business SUV", cents: 16500 },
    { label: "Meet and greet", cents: 2500 },
    { label: "Gratuity for your chauffeur (20%)", cents: 3300 },
  ]);
});

test("the hourly fare line names the vehicle and the hours", () => {
  const price = priced({ ...HOURLY, vehicle: "suv-escalade", hours: "4" });
  assert.deepEqual(price.lines[0], { label: "By the hour, Cadillac Escalade ESV (Business SUV), 4 hours", cents: 42000 });
  assert.equal(priced({ ...HOURLY, vehicle: "sedan" }).lines[0].label, "By the hour, Sedan & Electric, 3 hours");
});

test("LaGuardia First Class and the Teterboro label", () => {
  assert.equal(priced({ ...BASE, to: "teb" }).lines[0].label, "To Teterboro (TEB), Business SUV");
  assert.equal(priced({ ...FROM_JFK, from: "lga" }).lines[0].label, "From LaGuardia (LGA), Business SUV");
});

const ERROR_CASES = [
  ["form", { ...BASE, nlr_hp: "Acme" }],
  ["trip_type", { ...BASE, trip_type: "round" }],
  ["from", { ...BASE, from: "" }],
  ["from", { ...BASE, from: "mars" }],
  ["to", { ...BASE, to: "" }],
  ["from_address", { ...BASE, from_address: "" }],
  ["from_address", { ...BASE, from_address: "A" }],
  ["to_address", { ...FROM_JFK, to_address: " " }],
  ["date", { ...BASE, date: "2026-02-30" }],
  ["date", { ...BASE, date: "10/14/2026" }],
  ["date", { ...BASE, time: "7:30" }],
  ["date", { ...BASE, time: "24:00" }],
  ["date-past", { ...BASE, date: "2026-10-01", time: "11:59" }],
  ["passengers", { ...BASE, passengers: "0" }],
  ["passengers", { ...BASE, passengers: "13" }],
  ["passengers", { ...BASE, passengers: "two" }],
  ["hours", { ...HOURLY, vehicle: "sedan", hours: "" }],
  ["hours", { ...HOURLY, vehicle: "sedan", hours: "3.5" }],
  ["class", { ...BASE, class: "limo" }],
  ["vehicle", { ...HOURLY, vehicle: "limo" }],
  ["flight", { ...FROM_JFK, flight: "DL<401>" }],
  ["flight", { ...FROM_JFK, flight: "A".repeat(21) }],
];

for (const [code, fields] of ERROR_CASES) {
  test(`error ${code}: ${JSON.stringify(fields).slice(0, 90)}`, () => isError(fields, code));
}

const REASON_CASES = [
  ["class-airport", { ...BASE, class: "sedan" }],
  ["class-airport", { ...BASE, class: "sprinter" }],
  ["first-lga", { ...BASE, class: "first", to: "lga" }],
  ["sprinter-hourly", { ...HOURLY, vehicle: "sprinter" }],
  ["airport-to-airport", { ...FROM_JFK, to: "lga", to_address: "" }],
  ["no-airport", { ...BASE, to: "brooklyn", to_address: "1 Main Street" }],
  ["outside-city", { ...BASE, from: "outside", from_address: "Greenwich, Connecticut" }],
  ["outside-city", { ...FROM_JFK, to: "outside", to_address: "Hoboken" }],
  ["outside-hourly", { ...HOURLY, from: "outside", from_address: "Yonkers", vehicle: "sedan" }],
  ["hours-range", { ...HOURLY, vehicle: "sedan", hours: "2" }],
  ["seats", { ...BASE, passengers: "6" }],
  ["short-notice", { ...BASE, date: "2026-10-02", time: "11:00" }],
  ["far-ahead", { ...BASE, date: "2027-10-01", time: "12:01" }],
  ["paused", BASE, readSettings({})],
];

for (const [reason, fields, settings] of REASON_CASES) {
  test(`booking request ${reason}: ${JSON.stringify(fields).slice(0, 80)}`, () => isQuote(fields, reason, settings || ON));
}

test("meet and greet on a drop-off adds nothing", () => {
  const { trip, price } = run({ ...BASE, meet: "1" });
  assert.equal(trip.meet, false);
  assert.equal(price.total, 19800);
  assert.equal(price.lines.length, 2);
});

test("gratuity is never on meet and greet: 22300, not 22800", () => {
  const price = priced({ ...FROM_JFK, meet: "1" });
  assert.equal(price.gratuity, 3300);
  assert.notEqual(price.total, 22800);
});

test("6 passengers in any SUV and 4 in a Sedan give seats", () => {
  isQuote({ ...BASE, passengers: "6" }, "seats");
  for (const vehicle of ["suv-suburban", "suv-denali", "suv-navigator", "suv-escalade"]) isQuote({ ...HOURLY, vehicle, passengers: "6" }, "seats");
  isQuote({ ...HOURLY, vehicle: "sedan", passengers: "4" }, "seats");
  isQuote({ ...BASE, class: "sedan", passengers: "4" }, "seats");
  isQuote({ ...BASE, class: "first", passengers: "4" }, "seats");
  assert.equal(priced({ ...BASE, passengers: "5" }).total, 19800);
  assert.equal(priced({ ...BASE, class: "first", passengers: "3" }).total, 19800);
});

test("hours 2 and 13 give hours-range, 3 and 12 price", () => {
  isQuote({ ...HOURLY, vehicle: "sedan", hours: "2" }, "hours-range");
  isQuote({ ...HOURLY, vehicle: "sedan", hours: "13" }, "hours-range");
  assert.equal(priced({ ...HOURLY, vehicle: "sedan", hours: "3" }).total, 30600);
  assert.equal(priced({ ...HOURLY, vehicle: "sedan", hours: "12" }).total, 122400);
});

test("an amount, price, total or fare field changes nothing", () => {
  assert.equal(priced({ ...BASE, amount: "1", price: "1", total: "1", fare: "1" }).total, 19800);
});

test("JFK at both ends gives airport-to-airport", () => {
  isQuote({ ...FROM_JFK, to: "jfk", to_address: "" }, "airport-to-airport");
});

test("hourly from ewr, teb and outside give outside-hourly", () => {
  for (const from of ["ewr", "teb", "outside"]) isQuote({ ...HOURLY, from, from_address: from === "outside" ? "Yonkers" : "", vehicle: "sedan" }, "outside-hourly");
});

test("one way with vehicle=suv-escalade and no class prices as suv", () => {
  const { trip, price } = run({ ...BASE, class: "", vehicle: "suv-escalade" });
  assert.equal(trip.class, "suv");
  assert.equal(trip.vehicle, "");
  assert.equal(price.total, 19800);
});

test("hourly with class=suv and no vehicle prices as suv-suburban", () => {
  const { trip, price } = run({ ...HOURLY, class: "suv" });
  assert.equal(trip.vehicle, "suv-suburban");
  assert.equal(trip.class, "");
  assert.equal(price.total, 34200);
});

test("hourly with vehicle=first prices as First Class", () => {
  assert.equal(run({ ...HOURLY, vehicle: "first" }).trip.vehicle, "first");
  assert.equal(run({ ...HOURLY, class: "sprinter" }).trip.vehicle, "sprinter");
});

test("a pickup 23 hours ahead is short-notice and 25 hours ahead prices", () => {
  isQuote({ ...BASE, date: "2026-10-02", time: "11:00" }, "short-notice");
  assert.equal(priced({ ...BASE, date: "2026-10-02", time: "13:00" }).total, 19800);
  assert.equal(priced({ ...BASE, date: "2026-10-02", time: "12:00" }).total, 19800);
});

test("a pickup 365 days ahead prices and one minute later is far-ahead", () => {
  assert.equal(priced({ ...BASE, date: "2027-10-01", time: "12:00" }).total, 19800);
  isQuote({ ...BASE, date: "2027-10-01", time: "12:01" }, "far-ahead");
});

test("a pickup one minute in the past is date-past, and now itself is date-past", () => {
  isError({ ...BASE, date: "2026-10-01", time: "11:59" }, "date-past");
  isError({ ...BASE, date: "2026-10-01", time: "12:00" }, "date-past");
});

test("PAYMENTS_ENABLED unset gives paused for a complete trip and an input error for an incomplete one", () => {
  const off = readSettings({});
  isQuote(BASE, "paused", off);
  isQuote({ ...BASE, class: "sedan" }, "paused", off);
  isError({ ...BASE, from_address: "" }, "from_address", off);
  isQuote(BASE, "paused", readSettings({ PAYMENTS_ENABLED: "1" }));
  isQuote(BASE, "paused", readSettings({ PAYMENTS_ENABLED: "TRUE" }));
});

test("a blackout date gives paused", () => {
  const settings = readSettings({ PAYMENTS_ENABLED: "true", PAY_BLACKOUT_DATES: "2026-12-31, 2026-10-14" });
  assert.deepEqual(settings.blackout, ["2026-12-31", "2026-10-14"]);
  isQuote(BASE, "paused", settings);
  assert.equal(priced({ ...BASE, date: "2026-10-15" }, settings).total, 19800);
});

test("one tax setting without the other gives paused", () => {
  const rateOnly = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_RATE_ID: "txr_test0000000000" });
  const percentOnly = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_PERCENT: "8.875" });
  const badPercent = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_RATE_ID: "txr_test0000000000", SALES_TAX_PERCENT: "8.875%" });
  for (const settings of [rateOnly, percentOnly, badPercent]) {
    assert.equal(settings.taxHalfSet, true);
    assert.equal(settings.taxOn, false);
    isQuote(BASE, "paused", settings);
  }
  assert.equal(TAXED.taxOn, true);
  assert.equal(TAXED.taxHalfSet, false);
});

test("with 8.875% the JFK meet and greet trip has tax 1464 plus 222 and total 23986, gratuity untaxed", () => {
  const price = priced({ ...FROM_JFK, meet: "1" }, TAXED);
  assert.equal(price.tax, 1464 + 222);
  assert.equal(price.total, 23986);
  assert.equal(price.gratuity, 3300);
  assert.deepEqual(price.lines, [
    { label: "From JFK, Business SUV", cents: 16500 },
    { label: "Meet and greet", cents: 2500 },
    { label: "Gratuity for your chauffeur (20%)", cents: 3300 },
    { label: "Sales tax (8.875%)", cents: 1686 },
  ]);
  assert.deepEqual(price.notes, [NOTES.afterTaxed]);
  assert.equal(price.value, 19000);
});

test("Newark and Teterboro are never taxed, LaGuardia and hourly are", () => {
  for (const to of ["ewr", "teb"]) {
    const price = priced({ ...BASE, to }, TAXED);
    assert.equal(price.taxable, false);
    assert.equal(price.tax, 0);
    assert.equal(price.total, 19800);
    assert.deepEqual(price.notes, [NOTES.after]);
  }
  assert.equal(priced({ ...BASE, to: "lga" }, TAXED).tax, 1154);
  assert.equal(priced({ ...HOURLY, vehicle: "sedan" }, TAXED).tax, 2263);
});

test("with tax off nothing is taxed", () => {
  const price = priced({ ...FROM_JFK, meet: "1" });
  assert.equal(price.taxable, true);
  assert.equal(price.tax, 0);
});

test("tax arithmetic is exact at the half cent: Denali 3 hours 2663, Navigator 5 hours 4438, First Class 3 hours 3328", () => {
  assert.equal(priced({ ...HOURLY, vehicle: "suv-denali" }, TAXED).tax, 2663);
  assert.equal(priced({ ...HOURLY, vehicle: "suv-navigator", hours: "5" }, TAXED).tax, 4438);
  assert.equal(priced({ ...HOURLY, vehicle: "first" }, TAXED).tax, 3328);
  const odd = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_RATE_ID: "txr_test0000000000", SALES_TAX_PERCENT: "4.004" });
  assert.equal(priced({ ...HOURLY, vehicle: "first" }, odd).tax, 1502);
});

test("the New York time helper gives the instants recorded in the spec", () => {
  assert.equal(nycToUtc("2026-10-14", "07:30").toISOString(), "2026-10-14T11:30:00.000Z");
  assert.equal(nycToUtc("2026-12-01", "14:00").toISOString(), "2026-12-01T19:00:00.000Z");
  assert.equal(nycToUtc("2027-03-14", "03:30").toISOString(), "2027-03-14T07:30:00.000Z");
  assert.equal(nycToUtc("2026-11-01", "01:30").toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(nycToUtc("2026-11-01", "02:30").toISOString(), "2026-11-01T07:30:00.000Z");
  assert.equal(nycToUtc("2027-03-14", "02:30").toISOString(), "2027-03-14T07:30:00.000Z");
});

test("bookingRef is stable for one nonce, differs for another, and matches the Crockford pattern", () => {
  const nonce = "4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b";
  assert.equal(bookingRef(nonce), bookingRef(nonce));
  assert.notEqual(bookingRef(nonce), bookingRef(`${nonce}x`));
  const refs = new Set();
  for (let i = 0; i < 500; i++) {
    const ref = bookingRef(`nonce-${i}-0123456789abcdef`);
    assert.match(ref, /^NLR-[0-9A-HJKMNP-TV-Z]{6}$/);
    refs.add(ref);
  }
  assert.ok(refs.size > 495, `${refs.size} distinct references from 500 nonces`);
});

test("formatDate and formatTime write by hand with ordinary spaces", () => {
  assert.equal(formatDate("2026-10-14"), "Wed, Oct 14, 2026");
  assert.equal(formatDate("2027-01-03"), "Sun, Jan 3, 2027");
  assert.equal(formatTime("07:30"), "7:30 AM");
  assert.equal(formatTime("00:05"), "12:05 AM");
  assert.equal(formatTime("12:00"), "12:00 PM");
  assert.equal(formatTime("23:45"), "11:45 PM");
  for (const text of [formatDate("2026-10-14"), formatTime("07:30"), formatTime("19:15")]) assert.ok(!/[\u202f\u00a0]/.test(text), JSON.stringify(text));
});

const SECTION_3_3 = [
  "Hi NYC LUX RIDE, I would like to book this trip.",
  "Reference: NLR-7K3Q2P",
  "Trip: One way",
  "Pickup: 350 Fifth Avenue, Manhattan",
  "Drop-off: JFK",
  "Date: Wed, Oct 14, 2026",
  "Time: 7:30 AM",
  "Passengers: 2",
  "Vehicle: Luxury Sprinter",
  "Meet and greet: Yes",
  "Flight: DL 401",
].join("\n");

const sprinterTrip = { ...readInput({ ...BASE, class: "sprinter" }), meet: true, flight: "DL 401" };

test("the composed message for a Sprinter request matches section 3.3 exactly", () => {
  assert.equal(composeMessage(sprinterTrip, "NLR-7K3Q2P"), SECTION_3_3);
});

test("the WhatsApp, email and phone links for that request match section 3.3, and the email uses %20, not +", () => {
  const links = contactLinks(sprinterTrip, "NLR-7K3Q2P");
  assert.equal(links.whatsapp, `https://wa.me/16467750556?text=${encodeURIComponent(SECTION_3_3)}`);
  assert.equal(links.mailto, `mailto:info@nycluxride.com?subject=Booking%20request%20NLR-7K3Q2P&body=${encodeURIComponent(SECTION_3_3)}`);
  assert.equal(links.tel, "tel:+16467750556");
  assert.ok(links.whatsapp.startsWith("https://wa.me/16467750556?text=Hi%20NYC%20LUX%20RIDE%2C%20I%20would%20like%20to%20book%20this%20trip.%0AReference%3A%20NLR-7K3Q2P"));
  assert.ok(!links.mailto.includes("+"), links.mailto);
  assert.ok(links.mailto.includes("%20"));
  assert.equal(decodeURIComponent(new URL(links.whatsapp).search.slice(6)), SECTION_3_3);
});

test("the plain links carry no trip", () => {
  assert.deepEqual(contactLinks(), { whatsapp: "https://wa.me/16467750556", mailto: "mailto:info@nycluxride.com", tel: "tel:+16467750556" });
});

test("an hourly message names the hours and the vehicle and has no Drop-off line", () => {
  const trip = readInput({ ...HOURLY, hours: "4", vehicle: "suv-escalade", to: "jfk", to_address: "x" });
  const message = composeMessage(trip, "NLR-7K3Q2P");
  assert.equal(
    message,
    [
      "Hi NYC LUX RIDE, I would like to book this trip.",
      "Reference: NLR-7K3Q2P",
      "Trip: By the hour, 4 hours",
      "Pickup: 350 Fifth Avenue, Manhattan",
      "Date: Wed, Oct 14, 2026",
      "Time: 7:30 AM",
      "Passengers: 2",
      "Vehicle: Cadillac Escalade ESV (Business SUV)",
    ].join("\n")
  );
});

test("an address pickup drops meet and greet and the flight, an airport pickup keeps them", () => {
  const address = readInput({ ...BASE, meet: "1", flight: "DL 401" });
  assert.equal(address.meet, false);
  assert.equal(address.flight, "");
  assert.ok(!composeMessage(address, "NLR-7K3Q2P").includes("Flight"));
  const airport = readInput({ ...FROM_JFK, meet: "1", flight: "DL 401" });
  assert.equal(airport.meet, true);
  assert.equal(airport.flight, "DL 401");
  assert.ok(composeMessage(airport, "NLR-7K3Q2P").endsWith("Meet and greet: Yes\nFlight: DL 401"));
  assert.equal(readInput({ ...FROM_JFK, meet: "yes" }).meet, false);
});

test("hourly ignores to, to_address and class, one way ignores hours and vehicle", () => {
  const hourly = readInput({ ...HOURLY, vehicle: "sedan", to: "jfk", to_address: "x", class: "first" });
  assert.deepEqual([hourly.to, hourly.to_address, hourly.class, hourly.vehicle], ["", "", "", "sedan"]);
  const one = readInput({ ...BASE, hours: "99", vehicle: "sprinter" });
  assert.deepEqual([one.hours, one.vehicle, one.class], ["", "", "suv"]);
  assert.equal(priced({ ...BASE, hours: "99" }).total, 19800);
});

test("every string is trimmed and cut to 200 characters, and an airport keeps no address", () => {
  const trip = readInput({ ...BASE, from_address: `  ${"A".repeat(250)}  `, to_address: "ignored", passengers: " 02 " });
  assert.equal(trip.from_address, "A".repeat(200));
  assert.equal(trip.to_address, "");
  assert.equal(trip.passengers, "2");
  assert.equal(run({ ...BASE, from_address: "A".repeat(250) }).result.kind, "price");
  assert.equal(readInput({ ...FROM_JFK, from_address: "Terminal 4" }).from_address, "");
});

test("lone surrogates, control and direction characters are dropped, and an emoji at character 200 is kept whole", () => {
  assert.equal(readInput({ ...BASE, from_address: "350 Fifth Avenue\ud800" }).from_address, ADDRESS);
  assert.equal(readInput({ ...BASE, from_address: "\udc00350 Fifth Avenue" }).from_address, ADDRESS);
  assert.equal(readInput({ ...BASE, from_address: "a\nb\u202ec\u2066d\u0000e" }).from_address, "a b c d e");
  const emoji = `${"A".repeat(199)}\u{1F600}`;
  assert.equal(readInput({ ...BASE, from_address: emoji }).from_address, emoji);
  assert.equal(readInput({ ...BASE, from_address: `${"A".repeat(200)}\u{1F600}` }).from_address, "A".repeat(200));
  assert.equal(run({ ...BASE, from_address: "\u{1F600}".repeat(200) }).result.kind, "price");
  assert.equal(run({ ...BASE, from_address: "\u{1F600}" }).result.kind, "invalid");
  for (const from_address of ["350 Fifth Avenue\ud800", emoji, "x\u0000y\u2028z", "\udbff\udbff"]) {
    const trip = readInput({ ...BASE, from_address });
    assert.doesNotThrow(() => contactLinks(trip, bookingRef("nonce-unicode-0000000")), JSON.stringify(from_address));
  }
});

test("a bad or missing nonce is dropped, a good one is kept", () => {
  assert.equal(readInput({ nonce: "short" }).nonce, "");
  assert.equal(readInput({ nonce: "has spaces in it 0000" }).nonce, "");
  assert.equal(readInput({ nonce: "4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b" }).nonce, "4f6c2a8e-1b3d-4e5f-9a7b-0c1d2e3f4a5b");
  assert.equal(readInput({ action: "quote" }).action, "quote");
  assert.equal(readInput({ action: "other" }).action, "pay");
});

test("non-string and inherited fields are ignored", () => {
  const fields = Object.create({ trip_type: "one" });
  fields.from = 7;
  const trip = readInput(fields);
  assert.equal(trip.trip_type, "");
  assert.equal(trip.from, "");
});

test("fill replaces every named placeholder and leaves unknown ones", () => {
  assert.equal(fill("Booking request {ref}", { ref: "NLR-7K3Q2P" }), "Booking request NLR-7K3Q2P");
  assert.equal(fill("{a} and {b}", { a: 1 }), "1 and {b}");
});

test("every error code and every reason code has a case", () => {
  assert.deepEqual([...seenErrors].sort(), Object.keys(ERRORS).sort());
  assert.deepEqual([...seenReasons].sort(), Object.keys(REASONS).sort());
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll book-pricing tests passed");
process.exit(0);
