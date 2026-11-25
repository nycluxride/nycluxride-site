import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { JSDOM } from "jsdom";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, receipt, shownLines, serviceLabel, composeMessage, classTotal, ownerSubject, bookingData, nycToUtc, rateKey } from "../api/_trip.mjs";
import { sessionParams, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters, bookingText, bookingEvents, reminderLetter } from "../api/_mail.mjs";
import { POST as bookPost, GET as bookGet } from "../api/book.mjs";
import { routeKey, signRoute } from "../api/_ticket.mjs";
import { ERRORS, REASONS, LABELS, MAIL, POLICY, HEADINGS, SPRINTER_AHEAD, SPRINTER_SWAP, SPRINTER_BUSY } from "../api/_copy.mjs";
import { VEHICLES, RETIRED_VEHICLES, CLASSES, CLASS_DEFAULT_VEHICLE, AIRPORT_TOTALS, AIRPORT_FARES, DISTANCE_RATES, HOURS, PASSENGERS, NYC_TAX_PERCENT, BCF_PERCENT, percentCents, SPRINTER_NOTICE_HOURS, MIN_NOTICE_MINUTES } from "../api/_rates.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const SITE = "https://www.nycluxride.com";
const REF = "48213590";
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const BROOKLYN = "277 Bedford Ave, Brooklyn, NY 11211";
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100", rider: "me", reach: "phone" };
const HOURLY = { trip_type: "hour", from_text: MANHATTAN, date: "2026-10-14", time: "18:00", passengers: "8", hours: "4", class: "sprinter", tip: "", action: "pay", ...ME };
const AIRPORT = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-10-14", time: "07:30", passengers: "8", class: "sprinter", tip: "", action: "pay", ...ME };
const AIRPORTS = [["jfk", "John F. Kennedy (JFK)", "JFK"], ["lga", "LaGuardia (LGA)", "LaGuardia (LGA)"], ["ewr", "Newark Liberty (EWR)", "Newark Liberty (EWR)"], ["teb", "Teterboro (TEB)", "Teterboro (TEB)"]];
const PLACES_SHOWN = { jfk: "JFK", lga: "LaGuardia (LGA)", ewr: "Newark Liberty (EWR)", teb: "Teterboro (TEB)" };
const UNRATED = ["sprinter-luxury-jet", "sprinter-presidential", "sprinter-limo", "sprinter-white-limo"];
const BACK = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
const SPRINTERS = Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === "sprinter");
const ENV_KEYS = ["GOOGLE_MOCK", "GOOGLE_MAPS_SERVER_KEY", "PLACE_TICKET_SECRET", "PAYMENTS_ENABLED", "BOOK_MOCK", "STRIPE_SECRET_KEY", "VERCEL_ENV"];
const realFetch = globalThis.fetch;
const logged = [];
console.error = (...args) => logged.push(args.map(String).join(" "));

let failures = 0;
async function test(name, fn) {
  for (const key of ENV_KEYS) delete process.env[key];
  globalThis.fetch = realFetch;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    process.stderr.write(`  FAIL ${name}\n       ${String(err.stack || err.message).split("\n").slice(0, 14).join("\n       ")}\n`);
  } finally {
    for (const key of ENV_KEYS) delete process.env[key];
    globalThis.fetch = realFetch;
  }
}

const pairs = (lines) => lines.map(({ label, cents }) => [label, cents]);
async function run(fields, now = NOW) {
  const trip = await resolveTrip(readInput(fields), { now });
  const check = checkTrip(trip, now, ON);
  return { trip, check, price: check.kind === "price" && !check.reason ? priceTrip(trip, ON) : null };
}
async function priced(fields) {
  const out = await run(fields);
  assert.deepEqual(out.check, { kind: "price", reason: "", hold: "" }, JSON.stringify(fields));
  return out;
}
const invalid = async (fields, code) => assert.deepEqual((await run(fields)).check, { kind: "invalid", code }, JSON.stringify(fields));
function built(trip, price) {
  const params = sessionParams(trip, price, REF, ON, NOW, SITE);
  const metadata = Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  const items = [];
  for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) items.push([params.get(`line_items[${i}][price_data][product_data][name]`), Number(params.get(`line_items[${i}][price_data][unit_amount]`)), params.get(`line_items[${i}][price_data][product_data][description]`)]);
  return { params, metadata, items, description: params.get("payment_intent_data[description]"), intentMetadata: Object.fromEntries([...params].filter(([key]) => key.startsWith("payment_intent_data[metadata][")).map(([key, value]) => [key.slice(30, -1), value])) };
}
const session = (metadata) => ({ id: "cs_test_sprinter000000000000000001", livemode: false, status: "complete", payment_status: "paid", amount_total: Number(metadata.total_cents), currency: "usd", client_reference_id: metadata.ref, customer_details: { email: ME.email, name: ME.name, phone: "+12125550100" }, metadata });
const expected = (key, hours, tip = 0) => {
  const fare = VEHICLES[key].hourly * hours;
  const tax = percentCents(fare, NYC_TAX_PERCENT);
  const bcf = percentCents(fare, BCF_PERCENT);
  const gratuity = tip ? percentCents(fare, String(tip)) : 0;
  return { fare, tax, bcf, tip: gratuity, total: fare + tax + bcf + gratuity };
};
const nyDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 864e5));
const post = (fields, { form = false } = {}) =>
  bookPost(
    new Request(`${SITE}/api/book`, {
      method: "POST",
      headers: form ? { "content-type": "application/x-www-form-urlencoded", origin: SITE, "sec-fetch-site": "same-origin" } : { "content-type": "application/json", accept: "application/json", origin: SITE, "sec-fetch-site": "same-origin" },
      body: form ? new URLSearchParams(fields).toString() : JSON.stringify(fields),
    }),
  );
const mockEnv = () => Object.assign(process.env, { BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
const soon = { date: nyDate(5), time: "18:00" };
const letters = (s) => bookingLetters(s, { owners: ["info@nycluxride.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }, NOW.getTime());
const OLD = {"executiveEvent": {"metadata": {"ref": "48213590", "service": "hourly", "class": "sprinter", "vehicle": "sprinter-executive", "event": "1", "hours": "5", "from_text": "350 5th Ave, New York, NY 10118", "zones": "from manhattan", "date": "2026-10-14", "time": "18:00", "pickup_at": "2026-10-14T22:00:00.000Z", "passengers": "10", "meet": "0", "tip_percent": "20", "legs": "0", "fare_cents": "117500", "tax_cents": "10428", "bcf_cents": "2644", "tolls_cents": "0", "meet_cents": "0", "tip_cents": "23500", "total_cents": "154072", "rider": "me", "name": "Ana Lopez", "email": "ana.lopez@example.com", "phone": "+1 212 555 0100", "reach": "phone"}, "summary": "Wed, Oct 14, 2026, 6:00 PM. By the hour, Executive Sprinter for a wedding, prom or event, 5 hours.", "lines": [["Fare, 5 hours", 117500], ["NYC sales tax", 10428], ["Black Car Fund", 2644], ["Gratuity for your chauffeur (20%)", 23500]], "subject": "[TEST] New booking 48213590: Wed Oct 14, 6:00 PM, Executive Sprinter for a wedding, prom or event, 5 hours from 350 5th Ave", "rows": ["Vehicle: Executive Sprinter", "Occasion: Wedding, prom or event"], "text": ["Executive Sprinter for a wedding, prom or event"], "events": [["[TEST] 48213590 Executive Sprinter for a wedding, prom or event: 5 hours from 350 5th Ave", ["Vehicle: Executive Sprinter", "Occasion: Wedding, prom or event"]]], "reminder": ["Vehicle: Executive Sprinter"]}, "limoEvent": {"metadata": {"ref": "48213590", "service": "hourly", "class": "sprinter", "vehicle": "sprinter-limo", "event": "1", "hours": "4", "from_text": "350 5th Ave, New York, NY 10118", "zones": "from manhattan", "date": "2026-10-14", "time": "18:00", "pickup_at": "2026-10-14T22:00:00.000Z", "passengers": "10", "meet": "0", "tip_percent": "0", "legs": "0", "fare_cents": "104000", "tax_cents": "9230", "bcf_cents": "2340", "tolls_cents": "0", "meet_cents": "0", "tip_cents": "0", "total_cents": "115570", "rider": "me", "name": "Ana Lopez", "email": "ana.lopez@example.com", "phone": "+1 212 555 0100", "reach": "phone"}, "summary": "Wed, Oct 14, 2026, 6:00 PM. By the hour, Limo Sprinter for a wedding, prom or event, 4 hours.", "lines": [["Fare, 4 hours", 104000], ["NYC sales tax", 9230], ["Black Car Fund", 2340]], "subject": "[TEST] New booking 48213590: Wed Oct 14, 6:00 PM, Limo Sprinter for a wedding, prom or event, 4 hours from 350 5th Ave", "rows": ["Vehicle: Limo Sprinter", "Occasion: Wedding, prom or event"], "text": ["Limo Sprinter for a wedding, prom or event"], "events": [["[TEST] 48213590 Limo Sprinter for a wedding, prom or event: 4 hours from 350 5th Ave", ["Vehicle: Limo Sprinter", "Occasion: Wedding, prom or event"]]], "reminder": ["Vehicle: Limo Sprinter"]}, "shuttle": {"metadata": {"ref": "48213590", "service": "hourly", "class": "sprinter", "vehicle": "sprinter-shuttle", "hours": "4", "from_text": "350 5th Ave, New York, NY 10118", "zones": "from manhattan", "date": "2026-10-14", "time": "18:00", "pickup_at": "2026-10-14T22:00:00.000Z", "passengers": "10", "meet": "0", "tip_percent": "0", "legs": "0", "fare_cents": "54000", "tax_cents": "4793", "bcf_cents": "1215", "tolls_cents": "0", "meet_cents": "0", "tip_cents": "0", "total_cents": "60008", "rider": "me", "name": "Ana Lopez", "email": "ana.lopez@example.com", "phone": "+1 212 555 0100", "reach": "phone"}, "summary": "Wed, Oct 14, 2026, 6:00 PM. By the hour, Shuttle Sprinter, 4 hours.", "lines": [["Fare, 4 hours", 54000], ["NYC sales tax", 4793], ["Black Car Fund", 1215]], "subject": "[TEST] New booking 48213590: Wed Oct 14, 6:00 PM, Shuttle Sprinter, 4 hours from 350 5th Ave", "rows": ["Vehicle: Shuttle Sprinter"], "text": ["Shuttle Sprinter"], "events": [["[TEST] 48213590 Shuttle Sprinter: 4 hours from 350 5th Ave", ["Vehicle: Shuttle Sprinter"]]], "reminder": ["Vehicle: Shuttle Sprinter"]}, "jetRound": {"metadata": {"ref": "48213590", "service": "airport", "direction": "to-airport", "airport": "jfk", "class": "sprinter", "vehicle": "sprinter-jet", "from_text": "350 5th Ave, New York, NY 10118", "to_text": "John F. Kennedy (JFK)", "zones": "from manhattan, to jfk", "places": "to jfk", "date": "2026-10-14", "time": "07:30", "pickup_at": "2026-10-14T11:30:00.000Z", "return_date": "2026-10-18", "return_time": "18:00", "return_at": "2026-10-18T22:00:00.000Z", "passengers": "12", "meet": "0", "tip_percent": "0", "legs": "2", "fare_cents": "87694", "tax_cents": "7782", "bcf_cents": "1974", "tolls_cents": "2550", "meet_cents": "0", "tip_cents": "0", "total_cents": "100000", "rider": "me", "name": "Ana Lopez", "email": "ana.lopez@example.com", "phone": "+1 212 555 0100", "reach": "phone"}, "summary": "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. Jet Sprinter, 2 airport transfers.", "lines": [["Fare", 87694], ["NYC sales tax", 7782], ["Black Car Fund", 1974], ["Tolls and airport fees", 2550]], "subject": "[TEST] New booking 48213590: Wed Oct 14, 7:30 AM, Jet Sprinter, 350 5th Ave to JFK, return Sun Oct 18, 6:00 PM", "rows": ["Vehicle: Jet Sprinter"], "text": ["Jet Sprinter"], "events": [["[TEST] 48213590 Jet Sprinter: 350 5th Ave to JFK", ["Vehicle: Jet Sprinter"]], ["[TEST] Return: 48213590 Jet Sprinter: JFK to 350 5th Ave", ["Vehicle: Jet Sprinter"]]], "reminder": ["Vehicle: Jet Sprinter"]}};


await test("the owner's Sprinter fleet: Executive $175, Luxury Jet $215, Presidential $245, Limo $265 and White Luxury Limo $275 an hour, for 14, 8, 12, 14 and 10 passengers, each with a 4-hour minimum, no event rate and no hourly-only Sprinter", () => {
  assert.deepEqual(SPRINTERS, ["sprinter-executive", "sprinter-luxury-jet", "sprinter-presidential", "sprinter-limo", "sprinter-white-limo"]);
  assert.deepEqual(SPRINTERS.map((key) => [VEHICLES[key].name, VEHICLES[key].hourly, VEHICLES[key].seats, VEHICLES[key].minHours]), [
    ["Executive Sprinter", 17500, 14, 4],
    ["Luxury Jet Sprinter", 21500, 8, 4],
    ["Presidential Sprinter", 24500, 12, 4],
    ["Limo Sprinter", 26500, 14, 4],
    ["White Luxury Limo Sprinter", 27500, 10, 4],
  ]);
  assert.ok(Object.values(VEHICLES).every((v) => v.event === undefined && v.hourlyOnly === undefined));
  assert.deepEqual([CLASSES.sprinter.name, CLASSES.sprinter.seats, CLASSES.sprinter.bags, CLASS_DEFAULT_VEHICLE.sprinter, PASSENGERS.max, HOURS.min, HOURS.max], ["Luxury Sprinter", 14, "10 large plus 2 small bags", "sprinter-executive", 14, 3, 12]);
  assert.equal("sprinter" in VEHICLES, false);
  assert.ok(Object.values(VEHICLES).filter((v) => v.cls !== "sprinter").every((v) => v.minHours === undefined));
  assert.deepEqual(RETIRED_VEHICLES, { "sprinter-shuttle": { cls: "sprinter", name: "Shuttle Sprinter" }, "sprinter-jet": { cls: "sprinter", name: "Jet Sprinter" } });
  assert.ok(Object.keys(RETIRED_VEHICLES).every((key) => !(key in VEHICLES) && !(key in AIRPORT_TOTALS) && !(key in DISTANCE_RATES)));
});

await test("4 hours of each Sprinter: the fare, NYC sales tax, Black Car Fund and the total, written out", async () => {
  const WANT = {
    "sprinter-executive": [70000, 6213, 1575, 77788],
    "sprinter-luxury-jet": [86000, 7633, 1935, 95568],
    "sprinter-presidential": [98000, 8698, 2205, 108903],
    "sprinter-limo": [106000, 9408, 2385, 117793],
    "sprinter-white-limo": [110000, 9763, 2475, 122238],
  };
  for (const key of SPRINTERS) {
    const { price } = await priced({ ...HOURLY, sprinter: key });
    assert.deepEqual([price.fare, price.tax, price.bcf, price.total], WANT[key], key);
    assert.deepEqual(pairs(price.lines), [["Fare, 4 hours", WANT[key][0]], ["NYC sales tax", WANT[key][1]], ["Black Car Fund", WANT[key][2]]], key);
    assert.deepEqual(pairs(shownLines(price.lines)), [["Fare, 4 hours", WANT[key][0]], ["Taxes and fees", WANT[key][1] + WANT[key][2]]], key);
    assert.deepEqual([price.service, price.notes, price.tolls], ["hourly", [POLICY.later.hourly], 0], key);
  }
});

await test("every Sprinter for 4, 5 and 12 hours, with no gratuity, 20% and a typed $40: fare, taxes and fees and gratuity from api/_rates.mjs", async () => {
  for (const key of SPRINTERS) {
    for (const hours of [4, 5, 12]) {
      for (const [tip, extra] of [["", {}], ["20", {}], ["custom", { tip_amount: "40" }]]) {
        const { price } = await priced({ ...HOURLY, sprinter: key, hours: String(hours), tip, ...extra });
        const want = expected(key, hours, tip === "20" ? 20 : 0);
        const gratuity = tip === "custom" ? 4000 : want.tip;
        assert.deepEqual([price.fare, price.tax, price.bcf, price.tip, price.total], [want.fare, want.tax, want.bcf, gratuity, want.fare + want.tax + want.bcf + gratuity], `${key} ${hours} ${tip}`);
        assert.equal(price.lines[0].label, `Fare, ${hours} hours`);
        if (tip) assert.deepEqual(pairs(price.lines).at(-1), [tip === "custom" ? LABELS.gratuityAmount : "Gratuity for your chauffeur (20%)", gratuity], key);
      }
    }
  }
  assert.equal((await priced({ ...HOURLY, sprinter: "sprinter-white-limo", hours: "12", tip: "20" })).price.total, 330000 + 29288 + 7425 + 66000);
});

await test("the 4-hour minimum is the server's: 3 hours of any Sprinter is refused with its own message, 2 hours too, and 13 hours goes to dispatch like every class", async () => {
  for (const key of SPRINTERS) {
    for (const hours of ["3", "2", "0", "1"]) await invalid({ ...HOURLY, sprinter: key, hours }, "sprinter-hours");
    assert.equal((await priced({ ...HOURLY, sprinter: key, hours: "4" })).price.fare, VEHICLES[key].hourly * 4);
    assert.deepEqual((await run({ ...HOURLY, sprinter: key, hours: "13" })).check, { kind: "quote", reason: "hours-range", field: "" });
  }
  assert.deepEqual(ERRORS["sprinter-hours"], { field: "hours", text: "A Sprinter is booked for 4 hours or more." });
  for (const cls of ["suv", "premium", "first", "sedan"]) assert.equal((await priced({ ...HOURLY, class: cls, passengers: "1", hours: "3" })).price.lines[0].label, "Fare, 3 hours", cls);
  for (const extra of [{ minHours: "3" }, { min_hours: "3" }, { hours_min: "3" }, { minimum: "3" }, { vehicle: "sprinter-executive", hours: "3" }, { sprinter: "sprinter-shuttle", hours: "3" }]) await invalid({ ...HOURLY, hours: "3", ...extra }, "sprinter-hours");
});

await test("the class cards of a 3-hour booking show the Sprinter as 4 hours minimum, with no price, and a 4-hour booking prices every class with the Sprinter chosen", async () => {
  const three = (await priced({ ...HOURLY, class: "suv", passengers: "2", hours: "3" })).trip;
  assert.equal(classTotal(three, "sprinter"), null);
  for (const key of SPRINTERS) {
    const four = (await priced({ ...HOURLY, class: "suv", passengers: "2", hours: "4", sprinter: key })).trip;
    assert.equal(classTotal(four, "sprinter"), expected(key, 4).total, key);
    assert.equal(classTotal(four, "suv"), expected("suv-suburban", 4).total, key);
  }
});

await test("every Sprinter is booked for airport transfers at its own total: to and from JFK, LaGuardia, Newark and Teterboro, and round trip, by its key in the sprinter or the vehicle field", async () => {
  for (const key of SPRINTERS) {
    for (const [airport, id, text] of AIRPORTS) {
      if (!(airport in AIRPORT_TOTALS[key])) continue;
      for (const fields of [{ ...AIRPORT, to_text: text, to_id: id }, { ...AIRPORT, from_text: text, from_id: id, to_text: MANHATTAN, to_id: "" }]) {
        for (const pick of [{ sprinter: key }, { vehicle: key }]) {
          const { trip, price } = await priced({ ...fields, ...pick });
          assert.deepEqual([trip.vehicle, price.total, price.service], [key, AIRPORT_TOTALS[key][airport], "airport"], `${key} ${airport} ${JSON.stringify(pick)}`);
          assert.equal(price.fare, AIRPORT_FARES[key][airport], `${key} ${airport}`);
        }
      }
      const { trip } = await priced({ ...AIRPORT, to_text: text, to_id: id, sprinter: key });
      assert.equal(serviceLabel(trip), `To ${PLACES_SHOWN[airport]}, ${VEHICLES[key].name}`);
    }
    assert.equal((await priced({ ...AIRPORT, ...BACK, sprinter: key })).price.total, 2 * AIRPORT_TOTALS[key].jfk, key);
  }
  assert.deepEqual(SPRINTERS.map((key) => [AIRPORT_TOTALS[key].jfk, AIRPORT_TOTALS[key].ewr, AIRPORT_TOTALS[key].teb, AIRPORT_TOTALS[key].lga ?? null]), [
    [45000, 47500, 47500, 45000],
    [57500, 59500, 59500, 55000],
    [65000, 67500, 67500, 62500],
    [70000, 72500, 72500, 67500],
    [75000, 77500, 77500, null],
  ]);
  assert.equal((await priced({ ...AIRPORT, class: "suv", passengers: "2", sprinter: "sprinter-white-limo" })).price.total, AIRPORT_TOTALS.suv.jfk);
});

await test("the White Luxury Limo Sprinter to or from LaGuardia has no price yet: one way, from the airport and round trip get the we'll send you a price path, the card shows no price, and the other Sprinters keep their LaGuardia totals", async () => {
  const LGA = { ...AIRPORT, to_text: "LaGuardia (LGA)", to_id: "lga" };
  for (const fields of [LGA, { ...AIRPORT, from_text: "LaGuardia (LGA)", from_id: "lga", to_text: MANHATTAN, to_id: "" }, { ...LGA, ...BACK }, { ...AIRPORT, ...BACK, from_text: "LaGuardia (LGA)", from_id: "lga", to_text: "John F. Kennedy (JFK)", to_id: "jfk" }]) {
    const { trip, check } = await run({ ...fields, sprinter: "sprinter-white-limo" });
    if (fields.from_id === "lga" && fields.to_id === "jfk") {
      assert.equal(check.kind, "quote", "between two airports stays with dispatch");
      continue;
    }
    assert.deepEqual(check, { kind: "price", reason: "sprinter-price", hold: "" }, JSON.stringify(fields));
    assert.equal(classTotal(trip, "sprinter"), null);
    for (const key of SPRINTERS.filter((k) => k !== "sprinter-white-limo")) assert.equal((await run({ ...fields, sprinter: key })).check.reason, "", key);
  }
  const mixed = await run({ ...AIRPORT, from_text: "LaGuardia (LGA)", from_id: "lga", to_text: MANHATTAN, to_id: "", ...BACK, sprinter: "sprinter-white-limo" });
  assert.equal(mixed.check.reason, "sprinter-price");
  assert.deepEqual(REASONS["sprinter-price"], { group: "price", text: "For this Sprinter on this trip, we'll send you a price." });
  const suv = await run({ ...LGA, class: "suv", passengers: "2", sprinter: "sprinter-white-limo" });
  assert.deepEqual([suv.check.reason, classTotal(suv.trip, "sprinter")], ["", null]);
  assert.equal(classTotal((await run({ ...LGA, class: "suv", passengers: "2", sprinter: "sprinter-limo" })).trip, "sprinter"), AIRPORT_TOTALS["sprinter-limo"].lga);
});

await test("trips priced by distance and time: the Executive Sprinter keeps today's Sprinter distance rates and prices, and the Luxury Jet, Presidential, Limo and White Luxury Limo Sprinters get the we'll send you a price path, one way, with stops, to an airport outside the city and on a round trip with a ride priced by distance", async () => {
  process.env.GOOGLE_MOCK = "true";
  assert.deepEqual(DISTANCE_RATES["sprinter-executive"], { base: 8000, mile: 900, minute: 145, minimum: 35000 });
  assert.equal(rateKey("sprinter", "sprinter-executive"), "sprinter-executive");
  const TRIPS = [
    ["one way by distance", { ...AIRPORT, to_text: BROOKLYN, to_id: "" }, 38894],
    ["one way by distance, round trip", { ...AIRPORT, to_text: BROOKLYN, to_id: "", ...BACK }, 77788],
    ["a stop", { ...AIRPORT, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", to_text: "55 Church St, New York, NY 10007", to_id: "" }, 47000],
    ["New Jersey to JFK", { ...AIRPORT, from_text: "Secaucus, NJ 07094", to_text: "John F. Kennedy (JFK)", to_id: "jfk" }, 40233],
    ["JFK to Connecticut", { ...AIRPORT, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "1 Greenwich Ave, Greenwich, CT 06830", to_id: "" }, null],
  ];
  for (const [name, fields, total] of TRIPS) {
    const executive = await run({ ...fields, sprinter: "sprinter-executive" });
    assert.equal(executive.check.kind, "price", name);
    assert.equal(executive.check.reason, "", name);
    if (total !== null) assert.equal(executive.price.total, total, name);
    for (const key of UNRATED) {
      const { trip, check } = await run({ ...fields, sprinter: key });
      assert.deepEqual(check, { kind: "price", reason: "sprinter-price", hold: "" }, `${name} ${key}`);
      assert.equal(classTotal(trip, "sprinter"), null, `${name} ${key}`);
      assert.equal(classTotal(trip, "suv") === null, classTotal(executive.trip, "suv") === null, `${name} ${key}: the other classes keep their prices`);
    }
  }
  const ride = await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", sprinter: "sprinter-executive" });
  assert.deepEqual(pairs(ride.price.lines), [["Fare", 35000], ["NYC sales tax", 3106], ["Black Car Fund", 788]]);
  assert.equal(ride.price.fare, DISTANCE_RATES["sprinter-executive"].minimum, "a short ride in the Executive Sprinter costs the $350 minimum fare before taxes and fees");
  assert.deepEqual([ride.price.service, serviceLabel(ride.trip)], ["distance", "Executive Sprinter, 4.6 miles and 27 min"]);
  assert.equal((await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "" })).price.total, 38894, "the class default is the Executive Sprinter");
  for (const key of UNRATED) assert.equal(key in DISTANCE_RATES, false, key);
});

await test("the wedding, prom or event question is gone: any answer, or none, never refuses or changes the price of any Sprinter, car class or transfer, and the server never reads it", async () => {
  for (const value of [undefined, "", "0", "1", "yes"]) {
    const answer = value === undefined ? {} : { event: value };
    for (const key of SPRINTERS) {
      assert.equal((await priced({ ...HOURLY, sprinter: key, ...answer })).price.fare, VEHICLES[key].hourly * 4, `${key} ${value}`);
      assert.equal((await priced({ ...AIRPORT, sprinter: key, ...answer })).price.total, AIRPORT_TOTALS[key].jfk, `${key} ${value}`);
    }
    for (const cls of ["suv", "premium", "first", "sedan"]) assert.equal((await run({ ...HOURLY, class: cls, passengers: "1", ...answer })).check.kind, "price", `${cls} ${value}`);
  }
  assert.equal("event" in readInput({ ...HOURLY, event: "1" }), false);
  assert.equal(ERRORS.event, undefined);
  assert.equal(ERRORS.sprinter, undefined);
});

await test("the booking handler books every Sprinter by the hour with no event answer, as JSON and without JavaScript, and an event answer changes nothing", async () => {
  mockEnv();
  for (const key of SPRINTERS) {
    const pay = await (await post({ ...HOURLY, ...soon, sprinter: key, nonce: `nonce-sprinter-pay-${key.slice(9, 20)}` })).json();
    assert.equal(pay.kind, "pay", key);
    const id = new URL(pay.url, SITE).searchParams.get("session_id");
    const page = await (await bookGet(new Request(`${SITE}/api/book?session_id=${id}`))).json();
    assert.equal(page.total_cents, expected(key, 4).total, key);
    const form = await post({ ...HOURLY, ...soon, sprinter: key }, { form: true });
    assert.equal(form.status, 303, key);
    assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/, key);
  }
  const yes = await (await post({ ...HOURLY, ...soon, sprinter: "sprinter-limo", event: "1", action: "options", nonce: "nonce-sprinter-event-yes1" })).json();
  assert.deepEqual([yes.kind, yes.price.total_cents, "event" in yes.selected], ["options", expected("sprinter-limo", 4).total, false]);
});

await test("passengers follow the vehicle: up to 14 in the Executive and Limo, 8 in the Luxury Jet, 12 in the Presidential and 10 in the White Luxury Limo, by the hour and on transfers, and 15 is refused for every class", async () => {
  for (const [key, seats] of [["sprinter-executive", 14], ["sprinter-luxury-jet", 8], ["sprinter-presidential", 12], ["sprinter-limo", 14], ["sprinter-white-limo", 10]]) {
    for (const fields of [HOURLY, AIRPORT]) {
      assert.equal((await run({ ...fields, sprinter: key, passengers: String(seats) })).check.reason, "", `${key} ${seats}`);
      if (seats < 14) assert.deepEqual((await run({ ...fields, sprinter: key, passengers: String(seats + 1) })).check, { kind: "price", reason: "seats", hold: "" }, `${key} ${seats + 1}`);
    }
  }
  await invalid({ ...AIRPORT, passengers: "15" }, "passengers");
  await invalid({ ...HOURLY, passengers: "15" }, "passengers");
  assert.deepEqual((await run({ ...AIRPORT, class: "suv", passengers: "13" })).check, { kind: "price", reason: "seats", hold: "" });
  const nine = (await run({ ...AIRPORT, class: "suv", passengers: "9", sprinter: "sprinter-luxury-jet" })).trip;
  assert.equal(classTotal(nine, "sprinter"), null);
});

await test("tampering: an unknown or retired vehicle key, an SUV key sent for a Sprinter, a price, rate, seat count or total from the browser and a changed signed route are ignored or refused, never priced lower", async () => {
  process.env.GOOGLE_MOCK = "true";
  for (const sprinter of ["", "sprinter", "sprinter-bus", "sprinter-shuttle", "sprinter-jet", "suv-denali", "premium", "constructor", "__proto__", "sprinter-executive ", "SPRINTER-LIMO", "toString"]) {
    const { trip, price } = await priced({ ...HOURLY, sprinter, vehicle: "" });
    assert.deepEqual([trip.vehicle, price.fare], ["sprinter-executive", 70000], sprinter);
    const one = await priced({ ...AIRPORT, sprinter, vehicle: "" });
    assert.deepEqual([one.trip.vehicle, one.price.total], ["sprinter-executive", 45000], sprinter);
  }
  const loud = { fare: "100", fare_cents: "100", total_cents: "100", hourly: "1", rate: "1", event_rate: "1", event: "1", price: "1", tax_cents: "0", minHours: "1", seats: "20", airport_total: "100" };
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-white-limo", ...loud });
  assert.equal(price.total, expected("sprinter-white-limo", 4).total);
  assert.equal(built(trip, price).metadata.total_cents, String(expected("sprinter-white-limo", 4).total));
  assert.deepEqual((await run({ ...HOURLY, sprinter: "sprinter-luxury-jet", passengers: "9", ...loud })).check.reason, "seats");
  const suv = await priced({ ...HOURLY, class: "suv", passengers: "2", vehicle: "sprinter-limo", sprinter: "sprinter-limo" });
  assert.deepEqual([suv.trip.vehicle, suv.price.fare], ["suv-suburban", 38000]);
  const at = nycToUtc(AIRPORT.date, AIRPORT.time).toISOString();
  const route = signRoute([[routeKey({ address: "350 5th Ave, New York, NY 10118" }, { address: BROOKLYN }, at), 46, 27]], NOW);
  const executive = await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route });
  for (const key of UNRATED) assert.equal((await run({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route, sprinter: key })).check.reason, "sprinter-price", key);
  await invalid({ ...HOURLY, route, hours: "3" }, "sprinter-hours");
  assert.equal((await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route: route.slice(0, -2) + (route.endsWith("A") ? "BB" : "AA"), sprinter: "sprinter-executive" })).price.total, executive.price.total);
  assert.equal((await run({ ...AIRPORT, to_text: "LaGuardia (LGA)", to_id: "lga", sprinter: "sprinter-white-limo", ...loud })).check.reason, "sprinter-price");
});

await test("Stripe: the line items, the Checkout description in the owner's subject format, the line item description and the metadata name the Sprinter, with no event key", async () => {
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-presidential", tip: "20", hours: "5" });
  const b = built(trip, price);
  const want = expected("sprinter-presidential", 5, 20);
  assert.deepEqual(b.items.map(([name, cents]) => [name, cents]), [["Fare, 5 hours", want.fare], ["Taxes and fees", want.tax + want.bcf], ["Gratuity for your chauffeur (20%)", want.tip]]);
  assert.equal(b.items.reduce((sum, [, cents]) => sum + cents, 0), want.total);
  assert.equal(b.items[0][2].split(". ")[0], "By the hour, Presidential Sprinter, 5 hours");
  assert.ok(b.description.startsWith(`New booking ${REF}: Wed Oct 14, 6:00 PM, Presidential Sprinter, 5 hours from 350 5th Ave. Customer Ana Lopez.`), b.description);
  assert.deepEqual([b.metadata.service, b.metadata.class, b.metadata.vehicle, b.metadata.event, b.metadata.hours, b.metadata.fare_cents, b.metadata.total_cents], ["hourly", "sprinter", "sprinter-presidential", undefined, "5", String(want.fare), String(want.total)]);
  assert.deepEqual(b.intentMetadata, b.metadata);
  for (const key of SPRINTERS) {
    const transfer = await priced({ ...AIRPORT, to_text: "Newark Liberty (EWR)", to_id: "ewr", sprinter: key });
    const t = built(transfer.trip, transfer.price);
    assert.deepEqual([t.metadata.vehicle, t.metadata.event, t.items[0][2].split(". ")[0], t.metadata.total_cents], [key, undefined, `To Newark Liberty (EWR), ${VEHICLES[key].name}`, String(AIRPORT_TOTALS[key].ewr)], key);
    assert.ok(t.items[0][2].endsWith(` ${POLICY.waitRate.replace("{price}", POLICY.waitPrices.sprinter)}`), `${key}: ${t.items[0][2]}`);
    assert.equal(t.items[0][2].split("Extra waiting").length, 2, key);
    assert.ok(t.description.startsWith(`New booking ${REF}: Wed Oct 14, 7:30 AM, ${VEHICLES[key].name}, 350 5th Ave to Newark Liberty (EWR).`), t.description);
  }
  const suv = await priced({ ...AIRPORT, class: "suv", passengers: "2" });
  assert.equal(built(suv.trip, suv.price).metadata.vehicle, undefined);
});

await test("metadata stays within budget: the worst Sprinter shapes, hourly with every extra and a round trip with stops, at most 48 keys, every value at most 500 characters, with no event key", async () => {
  process.env.GOOGLE_MOCK = "true";
  const extras = { meet: "1", sign: "Ortiz family", tip: "custom", tip_amount: "40", rider: "other", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", pphone_cc: "GB", notes: "A".repeat(500), infant_seats: "3", toddler_seats: "3", booster_seats: "3", small_dogs: "3", large_dogs: "3", flight: "DL 401", event: "1", passengers: "10" };
  for (const fields of [
    { ...HOURLY, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", sprinter: "sprinter-white-limo", hours: "12", ...extras },
    { ...AIRPORT, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", stop1_text: MANHATTAN, stop2_text: BROOKLYN, to_text: "1 Old Country Rd, Mineola, NY 11501", to_id: "", ...BACK, return_flight: "DL 402", sprinter: "sprinter-executive", ...extras },
  ]) {
    const { trip, price } = await priced(fields);
    const b = built(trip, price);
    assert.ok(Object.keys(b.metadata).length <= 48, `${Object.keys(b.metadata).length}: ${Object.keys(b.metadata).join(" ")}`);
    assert.ok(Object.values(b.metadata).every((v) => v.length <= 500));
    assert.equal(b.metadata.vehicle, trip.vehicle);
    assert.equal("event" in b.metadata, false);
  }
});

await test("the receipt and the confirmation page rebuild the same lines, total and summary from the metadata, and a changed vehicle in the metadata never changes the amount", async () => {
  for (const [fields, summary] of [
    [{ ...HOURLY, sprinter: "sprinter-white-limo", tip: "20" }, "Wed, Oct 14, 2026, 6:00 PM. By the hour, White Luxury Limo Sprinter, 4 hours."],
    [{ ...HOURLY, sprinter: "sprinter-luxury-jet", tip: "20" }, "Wed, Oct 14, 2026, 6:00 PM. By the hour, Luxury Jet Sprinter, 4 hours."],
    [{ ...AIRPORT, sprinter: "sprinter-limo" }, "Wed, Oct 14, 2026, 7:30 AM. To JFK, Limo Sprinter."],
    [{ ...AIRPORT, to_text: "Teterboro (TEB)", to_id: "teb", sprinter: "sprinter-white-limo", ...BACK }, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. White Luxury Limo Sprinter, 2 airport transfers."],
  ]) {
    const { trip, price } = await priced(fields);
    const b = built(trip, price);
    const r = receipt(b.metadata, ON);
    assert.equal(r.summary, summary);
    assert.deepEqual(shownLines(r.lines).map(({ label, cents }) => [label, cents]), b.items.map(([name, cents]) => [name, cents]));
    assert.equal(r.lines.reduce((sum, line) => sum + line.cents, 0), price.total);
    const flipped = receipt({ ...b.metadata, event: "1", vehicle: "sprinter-executive" }, ON);
    assert.equal(flipped.lines.reduce((sum, line) => sum + line.cents, 0), price.total, "the paid amounts come from the cents keys only");
  }
  mockEnv();
  const paid = await (await post({ ...HOURLY, ...soon, sprinter: "sprinter-limo", nonce: "nonce-sprinter-page-00001" })).json();
  assert.equal(paid.kind, "pay");
  const id = new URL(paid.url, SITE).searchParams.get("session_id");
  const page = await (await bookGet(new Request(`${SITE}/api/book?session_id=${id}`))).json();
  assert.match(page.summary, /\. By the hour, Limo Sprinter, 4 hours\.$/);
  assert.deepEqual(page.lines.map((l) => [l.label, l.cents]), [["Fare, 4 hours", 106000], ["Taxes and fees", 9408 + 2385]]);
  assert.equal(page.total_cents, 117793);
});

await test("bookings made before this change read as they were booked: the Shuttle, Jet, Executive and Limo Sprinter keys and the event answer in old metadata give the same receipt, confirmation page, owner subject, both emails, text, calendar and ride reminder", async () => {
  for (const [name, old] of Object.entries(OLD)) {
    const s = session(old.metadata);
    const r = receipt(old.metadata, ON);
    assert.deepEqual([r.summary, r.lines.map(({ label, cents }) => [label, cents])], [old.summary, old.lines], name);
    assert.equal(r.lines.reduce((sum, line) => sum + line.cents, 0), Number(old.metadata.total_cents), name);
    const [customer, owner] = letters(s);
    for (const letter of [customer, owner]) {
      assert.equal(letter.text.split(POLICY.cancel).length, 2, `${name} ${letter.kind}`);
      assert.ok(letter.text.includes(`\n${POLICY.link}: https://www.nycluxride.com/rates#policies\n`), `${name} ${letter.kind}`);
    }
    assert.ok(reminderLetter(s, ["a"]).text.includes("https://www.nycluxride.com/rates#policies"), name);
    assert.equal(owner.subject, old.subject, name);
    assert.equal(ownerSubject(bookingData(old.metadata), REF), old.subject.replace("[TEST] ", ""), name);
    for (const letter of [customer, owner]) assert.deepEqual(letter.text.split("\n").filter((l) => /^(Vehicle|Occasion):/.test(l)), old.rows, `${name} ${letter.kind}`);
    if (old.rows.length > 1) assert.ok(customer.html.includes(">Occasion</th>") && customer.html.includes("Wedding, prom or event"), name);
    assert.deepEqual(bookingText(s).split("\n").filter((l) => l.includes("Sprinter")), old.text, name);
    assert.deepEqual(bookingEvents(s).map((e) => [e.summary, e.description.split("\n").filter((l) => /^(Vehicle|Occasion):/.test(l))]), old.events, name);
    assert.deepEqual(reminderLetter(s, ["a"]).text.split("\n").filter((l) => /Sprinter|Occasion/.test(l)), old.reminder, name);
  }
  const transfer = receipt({ ...OLD.jetRound.metadata, vehicle: "sprinter-unknown" }, ON);
  assert.equal(transfer.summary, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. Luxury Sprinter, 2 airport transfers.", "an unknown Sprinter key on a transfer reads as the class");
});

await test("both emails, the text message and the calendar name the Sprinter of a new booking where the vehicle already shows, with no Occasion row", async () => {
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-white-limo", hours: "5" });
  const s = session(built(trip, price).metadata);
  const [customer, owner] = letters(s);
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes("\nVehicle: White Luxury Limo Sprinter\n"), letter.text);
    assert.ok(!letter.text.includes("Occasion") && !letter.html.includes(">Occasion</th>"), letter.kind);
    assert.equal(letter.text.split(POLICY.cancel).length, 2, letter.kind);
    assert.ok(letter.text.includes(`\n${POLICY.link}: https://www.nycluxride.com/rates#policies\n`), letter.kind);
  }
  assert.equal(owner.subject, `[TEST] New booking ${REF}: Wed Oct 14, 6:00 PM, White Luxury Limo Sprinter, 5 hours from 350 5th Ave`);
  assert.equal(ownerSubject(bookingData(s.metadata), REF), owner.subject.replace("[TEST] ", ""));
  assert.ok(bookingText(s).includes("\nWhite Luxury Limo Sprinter\n"), bookingText(s));
  const [event] = bookingEvents(s);
  assert.equal(event.summary, `[TEST] ${REF} White Luxury Limo Sprinter: 5 hours from 350 5th Ave`);
  assert.equal(new Date(event.end.dateTime) - new Date(event.start.dateTime), 5 * 3600000);
  assert.ok(event.description.includes("\nVehicle: White Luxury Limo Sprinter\n") && !event.description.includes("Occasion"), event.description);
  assert.ok(reminderLetter(s, ["a"]).text.includes("Vehicle: White Luxury Limo Sprinter"));
  const transfer = await priced({ ...AIRPORT, sprinter: "sprinter-luxury-jet", ...BACK });
  const round = session(built(transfer.trip, transfer.price).metadata);
  assert.ok(letters(round)[1].text.includes("\nVehicle: Luxury Jet Sprinter\n"));
  assert.deepEqual(bookingEvents(round).map((e) => e.summary), [`[TEST] ${REF} Luxury Jet Sprinter: 350 5th Ave to JFK`, `[TEST] Return: ${REF} Luxury Jet Sprinter: JFK to 350 5th Ave`]);
  assert.deepEqual([MAIL.labels.occasion, LABELS.event, LABELS.forEvent], ["Occasion", "Wedding, prom or event", "{vehicle} for a wedding, prom or event"]);
});

await test("the reserve by email and WhatsApp message names the Sprinter like the Vehicle line of every booking, also for the we'll send you a price path", async () => {
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-presidential" });
  assert.ok(composeMessage(trip, REF, price.total).includes("\nTrip: By the hour, 4 hours\n") && composeMessage(trip, REF, price.total).includes("\nVehicle: Presidential Sprinter\n"));
  const one = await priced({ ...AIRPORT, sprinter: "sprinter-limo" });
  assert.ok(composeMessage(one.trip, REF, one.price.total).includes("\nVehicle: Limo Sprinter\n"));
  const lga = await run({ ...AIRPORT, to_text: "LaGuardia (LGA)", to_id: "lga", sprinter: "sprinter-white-limo" });
  assert.ok(composeMessage(lga.trip, REF).split("\n").includes("Vehicle: White Luxury Limo Sprinter"));
  const suv = await priced({ ...HOURLY, class: "suv", passengers: "2", vehicle: "suv-denali", sprinter: "sprinter-limo" });
  assert.ok(composeMessage(suv.trip, REF).split("\n").includes("Vehicle: GMC Denali (Business SUV)"));
});

await test("the booking handler: options list each Sprinter with its total and seats on every trip type, quote and pay price the Sprinter chosen, the White Luxury Limo at LaGuardia and the other Sprinters on a trip by distance send the we'll send you a price answer, and without JavaScript a 3-hour Sprinter and an unpriced Sprinter land on their messages before any Stripe call", async () => {
  mockEnv();
  const hourly = await (await post({ ...HOURLY, ...soon, sprinter: "sprinter-white-limo", action: "options", nonce: "nonce-sprinter-options-1" })).json();
  assert.equal(hourly.kind, "options");
  assert.deepEqual(hourly.vehicles.filter((v) => v.vehicle.startsWith("sprinter-")).map((v) => [v.vehicle, v.label, v.seats, v.total_cents]), [
    ["sprinter-executive", "Executive Sprinter", 14, 77788],
    ["sprinter-luxury-jet", "Luxury Jet Sprinter", 8, 95568],
    ["sprinter-presidential", "Presidential Sprinter", 12, 108903],
    ["sprinter-limo", "Limo Sprinter", 14, 117793],
    ["sprinter-white-limo", "White Luxury Limo Sprinter", 10, 122238],
  ]);
  assert.deepEqual([hourly.selected.vehicle, hourly.price.total_cents, hourly.classes.at(-1).total_cents, "event" in hourly.selected], ["sprinter-white-limo", 122238, 122238, false]);
  const one = await (await post({ ...AIRPORT, ...soon, time: "07:30", action: "options", nonce: "nonce-sprinter-options-2" })).json();
  assert.deepEqual(one.vehicles.map((v) => [v.vehicle, v.total_cents]), SPRINTERS.map((key) => [key, AIRPORT_TOTALS[key].jfk]));
  assert.equal("tolls_differ" in one.price, false);
  const later = { return: "1", return_date: nyDate(6), return_time: "18:00" };
  for (const [key, back, tolls, differ] of [["sprinter-limo", {}, 1276, true], ["sprinter-limo", later, 2552, true], ["sprinter-executive", {}, 1275, undefined], ["sprinter-white-limo", later, 2550, undefined]]) {
    const answer = await (await post({ ...AIRPORT, ...soon, time: "07:30", ...back, sprinter: key, action: "options", nonce: `nonce-sprinter-tolls-${key}-${tolls}` })).json();
    assert.deepEqual([answer.price.lines.find((l) => l.label === LABELS.tollsShort).cents, answer.price.tolls_differ], [tolls, differ], key);
  }
  const suvTolls = await (await post({ ...AIRPORT, ...soon, time: "07:30", class: "suv", passengers: "2", action: "options", nonce: "nonce-sprinter-tolls-suv" })).json();
  assert.deepEqual([suvTolls.price.lines.find((l) => l.label === LABELS.tollsShort).cents, "tolls_differ" in suvTolls.price], [1275, false]);
  const lga = await (await post({ ...AIRPORT, ...soon, time: "07:30", to_text: "LaGuardia (LGA)", to_id: "lga", sprinter: "sprinter-white-limo", action: "options", nonce: "nonce-sprinter-options-3" })).json();
  assert.deepEqual([lga.kind, lga.reason, lga.price, lga.pay, lga.classes.at(-1).total_cents, lga.classes.at(-1).reason], ["options", "sprinter-price", null, false, null, "sprinter-price"]);
  assert.deepEqual(lga.vehicles.map((v) => [v.vehicle, v.total_cents]), SPRINTERS.map((key) => [key, AIRPORT_TOTALS[key].lga ?? null]));
  const payLga = await (await post({ ...AIRPORT, ...soon, time: "07:30", to_text: "LaGuardia (LGA)", to_id: "lga", sprinter: "sprinter-white-limo", nonce: "nonce-sprinter-options-4" })).json();
  assert.deepEqual([payLga.kind, payLga.reason, payLga.group, payLga.text], ["quote", "sprinter-price", "price", REASONS["sprinter-price"].text]);
  assert.ok(payLga.whatsapp.includes(encodeURIComponent("Vehicle: White Luxury Limo Sprinter")));
  const short = await post({ ...HOURLY, ...soon, hours: "3", action: "quote", nonce: "nonce-sprinter-options-5" });
  assert.deepEqual([short.status, (await short.json()).field], [422, "hours"]);
  for (const [fields, location] of [[{ ...HOURLY, ...soon, hours: "3" }, "/book#e-sprinter-hours"], [{ ...AIRPORT, ...soon, time: "07:30", to_text: "LaGuardia (LGA)", to_id: "lga", sprinter: "sprinter-white-limo" }, "/book#q-sprinter-price"]]) {
    const res = await post(fields, { form: true });
    assert.deepEqual([res.status, res.headers.get("location")], [303, location]);
  }
  process.env.GOOGLE_MOCK = "true";
  const ride = await (await post({ ...AIRPORT, ...soon, time: "07:30", to_text: BROOKLYN, to_id: "", action: "options", nonce: "nonce-sprinter-options-6" })).json();
  assert.deepEqual(ride.vehicles.map((v) => [v.vehicle, v.total_cents === null]), SPRINTERS.map((key) => [key, key !== "sprinter-executive"]));
  const pay = await (await post({ ...HOURLY, ...soon, sprinter: "sprinter-luxury-jet", hours: "6", nonce: "nonce-sprinter-pay-000001" })).json();
  assert.equal(pay.kind, "pay");
  const id = new URL(pay.url, SITE).searchParams.get("session_id");
  const page = await (await bookGet(new Request(`${SITE}/api/book?session_id=${id}`))).json();
  assert.equal(page.total_cents, expected("sprinter-luxury-jet", 6).total);
});

const SITE_ROOT = new URL("..", import.meta.url).pathname;
const pages = (dir = SITE_ROOT) => readdirSync(dir).flatMap((name) => {
  if (["node_modules", "test", "scripts", "assets", "fleet", "api"].includes(name) || name.startsWith(".")) return [];
  const full = dir + name;
  return statSync(full).isDirectory() ? pages(full + "/") : name.endsWith(".html") ? [full.slice(SITE_ROOT.length)] : [];
});
const dom = (file) => new JSDOM(readFileSync(SITE_ROOT + file, "utf8")).window.document;
const flat = (s) => s.replace(/\s+/g, " ").trim();
const sentences = (doc) => [...doc.querySelectorAll("main p, main li, main dd")].filter((el) => !el.closest("form, .fleet-card")).flatMap((el) => flat(el.textContent).split(/(?<=[.?!])\s+/));

await test("every sentence that gives any class, any car or every hourly booking a 3-hour minimum also gives the Sprinter 4 hours, on every page and in the FAQ JSON-LD", async () => {
  const wrong = [];
  let seen = 0;
  for (const file of pages()) {
    const doc = dom(file);
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((x) => x.textContent).join(" ").split(/(?<=[.?!])\s+|"text":"/);
    const blocks = [...doc.querySelectorAll("main p, main li, main dd")].filter((el) => !el.closest("form, .fleet-card")).map((el) => flat(el.textContent));
    for (const block of [...blocks, ...ld]) for (const t of block.split(/(?<=[.?!])\s+/)) {
      if (!/3-hour minimum/.test(t) || !/\b(any class|Any class|any car|any hourly booking)\b/.test(t)) continue;
      seen++;
      if (!t.includes("4 hours in a Sprinter") && !block.includes(`${t} Sprinters have a 4-hour minimum.`)) wrong.push(`${file}: ${t}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(seen > 30, String(seen));
  const faq = dom("faq.html");
  const hourly = [...faq.querySelectorAll(".acc__body")].map((d) => flat(d.textContent)).find((t) => t.startsWith("Yes. You can book any class by the hour"));
  assert.equal(hourly, "Yes. You can book any class by the hour for meetings, events, shopping or a day of stops in New York City, with a 3-hour minimum, or 4 hours in a Sprinter. See hourly rates.");
  assert.ok([...faq.querySelectorAll('script[type="application/ld+json"]')].some((x) => x.textContent.includes(`"text":"${hourly}"`)));
});

await test("the prom, wedding and comparison posts give the Sprinter its 4 hours wherever they give the 3-hour minimum, and say five kinds of Sprinter, not a count of vans", async () => {
  for (const file of ["blog/nyc-prom-limo-booking-guide-march-13.html", "blog/wedding-event-limo-nyc-march-27.html", "blog/nyc-limo-service-comparison-guide-april-29.html", "limousine-service-nyc.html"]) {
    const said = sentences(dom(file));
    const three = said.filter((t) => /3-hour minimum/.test(t));
    assert.ok(three.length > 0, file);
    assert.deepEqual(three.filter((t) => !t.includes("4 hours in a Sprinter")), [], file);
    assert.deepEqual(said.filter((t) => /\b(\d+|four|five) (Luxury )?Sprinters\b/.test(t)), [], file);
    assert.deepEqual(said.filter((t) => /four kinds|Shuttle Sprinter|\bJet Sprinter|starlight|captain's chairs facing a screen/.test(t.replace(/Luxury Jet Sprinter/g, ""))), [], file);
  }
  assert.ok(sentences(dom("blog/nyc-limo-service-comparison-guide-april-29.html")).includes("Hourly bookings have a 3-hour minimum, or 4 hours in a Sprinter."));
  for (const file of ["blog/nyc-prom-limo-booking-guide-march-13.html", "blog/wedding-event-limo-nyc-march-27.html"]) assert.ok(sentences(dom(file)).includes("We have five kinds of Sprinter."), file);
  const van = sentences(dom("sprinter-van-service-nyc.html"));
  assert.ok(van.includes("There are five kinds of Sprinter.") && van.includes("The fleet page shows all five."), van.join("\n"));
  assert.deepEqual(van.filter((t) => /all four|four kinds|\b(\d+|four|five) (Luxury )?Sprinters\b|Shuttle Sprinter|\bJet Sprinter/.test(t.replace(/Luxury Jet Sprinter/g, ""))), []);
  const wedding = sentences(dom("blog/wedding-event-limo-nyc-march-27.html"));
  for (const t of ["The Presidential Sprinter seats 12, the White Luxury Limo Sprinter 10 and the Luxury Jet Sprinter 8.", "See Sprinter limousine service for weddings and groups for the event terms.", "For a guest shuttle, the Executive and Limo Sprinters carry up to 14 guests per trip between a hotel and the venue."]) assert.ok(wedding.includes(t), t);
  assert.deepEqual(wedding.filter((t) => /each Sprinter carries|can choose between them|for each cabin/.test(t)), []);
  const limo = sentences(dom("limousine-service-nyc.html"));
  assert.ok(limo.includes("You choose the Sprinter when you book.") && limo.includes("The Executive and Limo Sprinters seat 14, the Presidential Sprinter 12, the White Luxury Limo Sprinter 10 and the Luxury Jet Sprinter 8."), limo.join("\n"));
});

await test("the seats of each Sprinter on every page follow VEHICLES, and no page names a retired Sprinter, the event rate or a Sprinter booked by the hour only", async () => {
  const seatsOf = Object.fromEntries(SPRINTERS.map((key) => [VEHICLES[key].name, VEHICLES[key].seats]));
  const wrong = [];
  for (const file of pages()) {
    const html = readFileSync(SITE_ROOT + file, "utf8");
    if (/Shuttle Sprinter|(?<!Luxury )Jet Sprinter|sprinter=sprinter-(shuttle|jet)\b|"sprinter-(shuttle|jet)"|starlight|booked by the hour only|Weddings, proms and events|wedding, prom or event\?/.test(html)) wrong.push(`${file}: retired Sprinter copy`);
    for (const t of sentences(dom(file))) {
      for (const m of t.matchAll(/(?:the |an? )((?:White Luxury Limo|Luxury Jet|Presidential|Executive|Limo) Sprinter) (?:seats|takes) (?:up to )?(\d+)/g)) if (seatsOf[m[1]] !== Number(m[2])) wrong.push(`${file}: ${t}`);
    }
  }
  assert.deepEqual(wrong, []);
});

await test("every Sprinter Book link on the fleet, rates and limousine pages carries the Sprinter it names, so /book opens that Sprinter, and the links by the hour open 4 hours", async () => {
  const byName = Object.fromEntries(SPRINTERS.map((key) => [VEHICLES[key].name, key]));
  const names = Object.keys(byName).sort((a, b) => b.length - a.length);
  const found = [];
  for (const file of ["fleet.html", "rates.html", "limousine-service-nyc.html"]) {
    for (const a of dom(file).querySelectorAll('main a[href^="/book?"]')) {
      const label = (a.getAttribute("aria-label") || "") + " " + flat(a.textContent);
      const name = names.find((n) => label.includes(n));
      if (!name) continue;
      const q = new URL(a.getAttribute("href"), SITE).searchParams;
      found.push([file, name, q.get("trip-type") || "one"].join(" "));
      assert.deepEqual([q.get("class"), q.get("sprinter")], ["sprinter", byName[name]], `${file} ${label}`);
      if (q.get("trip-type") === "hour") assert.equal(q.get("hours"), String(VEHICLES[byName[name]].minHours), label);
    }
  }
  const all = (file, kind) => SPRINTERS.map((k) => `${file} ${VEHICLES[k].name} ${kind}`);
  assert.deepEqual(found, [...all("fleet.html", "one"), ...all("rates.html", "one"), ...all("rates.html", "hour"), "limousine-service-nyc.html White Luxury Limo Sprinter hour"]);
});

await test("each Sprinter photo shows the Sprinter its caption and alt name, as in PHOTOS.md after the owner's captions: every Sprinter, the Presidential included, has its studio photo on its booking and fleet card, the forward seats and the luggage space are the Executive, the garage front and the render the Luxury Jet, the black van with purple lights and the black van in a lot the Limo and the white van the White Luxury Limo, the earlier card photos and the earlier Luxury Jet photos are gone and the older Jet photo is captioned only as a Luxury Sprinter", async () => {
  const PHOTOS = {
    "sprinter-shuttle-seats": "Executive Sprinter",
    "sprinter-shuttle-side": "Executive Sprinter",
    "sprinter-shuttle-luggage": "Executive Sprinter",
    "sprinter-executive-studio": "Executive Sprinter",
    "sprinter-executive-studio-card": "Executive Sprinter",
    "sprinter-luxury-jet-studio": "Luxury Jet Sprinter",
    "sprinter-luxury-jet-studio-card": "Luxury Jet Sprinter",
    "sprinter-presidential-studio": "Presidential Sprinter",
    "sprinter-presidential-studio-card": "Presidential Sprinter",
    "sprinter-luxury-jet-front": "Luxury Jet Sprinter",
    "sprinter-luxury-jet-render": "Luxury Jet Sprinter",
    "sprinter-limo-black-studio": "Limo Sprinter",
    "sprinter-limo-black-studio-card": "Limo Sprinter",
    "sprinter-limo-black-door": "Limo Sprinter",
    "sprinter-limo-black-lot": "Limo Sprinter",
    "sprinter-limo-lounge": "White Luxury Limo Sprinter",
    "sprinter-limo-white": "White Luxury Limo Sprinter",
    "sprinter-limo-castle": "White Luxury Limo Sprinter",
    "sprinter-white-limo-studio": "White Luxury Limo Sprinter",
    "sprinter-white-limo-studio-card": "White Luxury Limo Sprinter",
  };
  const seen = new Set();
  for (const file of pages()) {
    const doc = dom(file);
    assert.doesNotMatch(readFileSync(SITE_ROOT + file, "utf8"), /fleet\/sprinter-limo(-\d+)?\.(webp|avif)|bench seats, a bar and a screen/, file);
    for (const img of doc.querySelectorAll("img[src^='/fleet/sprinter-']")) {
      const slug = img.getAttribute("src").replace(/^\/fleet\//, "").replace(/-\d+\.webp$/, "");
      const fig = img.closest("figure, .plate, li");
      const cap = fig && fig.querySelector("figcaption b") ? flat(fig.querySelector("figcaption b").textContent) : "";
      const heading = img.closest("article") && img.closest("article").querySelector("h3") ? flat(img.closest("article").querySelector("h3").textContent) : "";
      if (slug === "sprinter-jet") {
        if (img.alt) assert.equal(img.alt, "Inside a Luxury Sprinter: two leather captain's chairs facing a screen", file);
        if (cap) assert.equal(cap, "Mercedes-Benz Sprinter", file);
        continue;
      }
      if (slug === "sprinter-limo-card") continue;
      assert.ok(slug in PHOTOS, `${file} ${slug}`);
      seen.add(slug);
      assert.ok(img.alt === "" || img.alt.includes(PHOTOS[slug]) && !Object.values(PHOTOS).some((n) => n !== PHOTOS[slug] && !PHOTOS[slug].includes(n) && img.alt.includes(n)), `${file} ${slug} alt: ${img.alt}`);
      for (const text of [cap, heading].filter((t) => t.endsWith("Sprinter"))) assert.equal(text, PHOTOS[slug], `${file} ${slug}`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(PHOTOS).sort());
  const fleet = dom("fleet.html");
  const presidential = [...fleet.querySelectorAll("#luxury-sprinter article.fleet-card")].find((c) => flat(c.querySelector("h3").textContent) === "Presidential Sprinter");
  assert.deepEqual([presidential.querySelector("img").getAttribute("src"), presidential.querySelector("img").alt, fleet.querySelector(".plate__none")], ["/fleet/sprinter-presidential-studio-600.webp", "The black Presidential Sprinter with chrome wheels, in a white studio", null]);
  assert.doesNotMatch(fleet.querySelector("main").textContent, /No photo/);
  for (const [file, sel, slug, alt, cap] of [
    ["locations/brooklyn.html", "figure.svc__plate", "sprinter-jet", "Inside a Luxury Sprinter: two leather captain's chairs facing a screen", "Mercedes-Benz Sprinter"],
    ["services.html", "#weddings figure", "sprinter-limo-castle", "The White Luxury Limo Sprinter with its door open in front of a stone castle", "White Luxury Limo Sprinter"],
    ["services.html", "#prom figure", "sprinter-jet", "Inside a Luxury Sprinter: two leather captain's chairs facing a screen", "Mercedes-Benz Sprinter"],
    ["services.html", "#sprinter figure", "sprinter-shuttle-side", "The black Executive Sprinter parked at a curb at sunset", "Executive Sprinter"],
  ]) {
    const fig = dom(file).querySelector(sel);
    assert.deepEqual([fig.querySelector("img").getAttribute("src").replace(/-\d+\.webp$/, ""), fig.querySelector("img").alt, flat(fig.querySelector("figcaption b").textContent)], [`/fleet/${slug}`, alt, cap], `${file} ${sel}`);
  }
  const svc = [...dom("services.html").querySelectorAll("figure.svc__plate img")].map((i) => i.getAttribute("src")).filter((src) => src.includes("sprinter"));
  assert.deepEqual([svc.length, new Set(svc).size], [3, 3]);
  const si = dom("locations/staten-island.html");
  assert.deepEqual([si.querySelector('meta[property="og:image"]').content, si.querySelector('meta[property="og:image:alt"]').content], ["https://www.nycluxride.com/fleet/sprinter-jet.webp", "Inside a Luxury Sprinter: two leather captain's chairs facing a screen"]);
  const row = fleet.querySelector(".fleet-photos");
  assert.deepEqual([row.getAttribute("role"), row.getAttribute("aria-labelledby"), flat(row.querySelector("#h-sprinter-photos").textContent)], ["group", "h-sprinter-photos", "Photos of our Sprinters"]);
  assert.deepEqual([...row.querySelectorAll("figcaption b")].map((b) => flat(b.textContent)), ["Executive Sprinter", "Executive Sprinter", "Luxury Jet Sprinter", "Luxury Jet Sprinter", "Limo Sprinter", "Limo Sprinter", "White Luxury Limo Sprinter", "White Luxury Limo Sprinter"]);
  const frames = [...fleet.querySelectorAll("#luxury-sprinter img")].map((i) => i.getAttribute("src").replace(/^\/fleet\/|-\d+\.webp$/g, ""));
  assert.deepEqual(frames.filter((f) => f.startsWith("sprinter-limo-black")), ["sprinter-limo-black-studio", "sprinter-limo-black-lot", "sprinter-limo-black-door"]);
  assert.deepEqual([...fleet.querySelectorAll("#luxury-sprinter article.fleet-card")].map((c) => [flat(c.querySelector("h3").textContent), c.querySelector("img") ? c.querySelector("img").getAttribute("src") : ""]), [["Executive Sprinter", "/fleet/sprinter-executive-studio-600.webp"], ["Luxury Jet Sprinter", "/fleet/sprinter-luxury-jet-studio-600.webp"], ["Presidential Sprinter", "/fleet/sprinter-presidential-studio-600.webp"], ["Limo Sprinter", "/fleet/sprinter-limo-black-studio-600.webp"], ["White Luxury Limo Sprinter", "/fleet/sprinter-white-limo-studio-600.webp"]]);
  const book = dom("book.html");
  assert.deepEqual(Object.keys(VEHICLES).filter((k) => VEHICLES[k].cls === "sprinter").map((k) => { const i = book.querySelector(`label[for="bk-c-${k}"] img`); return [k, i ? i.getAttribute("src").replace(/^\/fleet\/|-300\.webp$/g, "") : ""]; }), [["sprinter-executive", "sprinter-executive-studio-card"], ["sprinter-luxury-jet", "sprinter-luxury-jet-studio-card"], ["sprinter-presidential", "sprinter-presidential-studio-card"], ["sprinter-limo", "sprinter-limo-black-studio-card"], ["sprinter-white-limo", "sprinter-white-limo-studio-card"]]);
  const files = readdirSync(SITE_ROOT + "fleet");
  assert.deepEqual(files.filter((f) => /^sprinter-executive-(lounge|night|cabin)|^sprinter-luxury-jet-cab/.test(f)), [], "the earlier Luxury Jet photos and the unused cab photo are not deployed");
  assert.deepEqual(files.filter((f) => /^(sprinter-executive-card|sprinter-luxury-jet-card|sprinter-limo-black-card|sprinter-white-limo-card|sprinter-executive-rear|sprinter-luxury-jet-door|sprinter-limo-black-seats)[-.]/.test(f)), [], "the card photos the studio photos replaced are not deployed");
  for (const slug of Object.keys(PHOTOS)) assert.ok(files.includes(`${slug}.webp`) && files.includes(`${slug}-300.avif`) && files.includes(`${slug}-400.webp`), slug);
  assert.equal(new Set(frames).size, frames.length);
});

await test("the owner's 3 hour Sprinter notice, followed by the two SUVs sentence everywhere but the FAQ, is said once where each page describes booking a Sprinter: both Sprinter tables on the rates page, the fleet page's Sprinter part, the Sprinter van page's booking fact, the FAQ answer on when to book, visible and in its JSON-LD, and after the 90 minute booking facts and the itinerary step on the limousine and wedding pages", async () => {
  assert.deepEqual([SPRINTER_NOTICE_HOURS, SPRINTER_AHEAD, SPRINTER_SWAP], [3, "Book a Sprinter at least 3 hours ahead.", "If no Sprinter is free, we send two SUVs."]);
  const text = (el) => flat(el.textContent);
  const rates = dom("rates.html");
  assert.ok(text(rates.getElementById("sprinter-airport-caption")).endsWith(`New York City address. ${SPRINTER_AHEAD} ${SPRINTER_SWAP}`));
  assert.ok(text(rates.getElementById("sprinter-caption")).includes(`Every Sprinter has a 4-hour minimum. ${SPRINTER_AHEAD} ${SPRINTER_SWAP} Taxes`));
  const fleet = dom("fleet.html").getElementById("luxury-sprinter").querySelector("p");
  assert.ok(text(fleet).includes(`By the hour, every Sprinter has a 4-hour minimum. ${SPRINTER_AHEAD} ${SPRINTER_SWAP} Our luxury limo service page`), text(fleet));
  const van = [...dom("sprinter-van-service-nyc.html").querySelectorAll("dl.facts dt")].map((dt) => [text(dt), text(dt.nextElementSibling)]);
  assert.deepEqual(van.find(([dt]) => dt === "Booking ahead"), ["Booking ahead", `${SPRINTER_AHEAD} ${SPRINTER_SWAP}`]);
  assert.ok(!sentences(dom("sprinter-van-service-nyc.html")).some((t) => new RegExp(`${MIN_NOTICE_MINUTES} minutes|Sooner by email`).test(t)), "the Sprinter van page offers no Sprinter online sooner than 3 hours");
  const faq = dom("faq.html");
  const answer = text(faq.querySelector("#q-when-to-book .acc__body"));
  assert.equal(answer, `Book online at least ${MIN_NOTICE_MINUTES} minutes before pickup. For a pickup within the next ${MIN_NOTICE_MINUTES} minutes, email info@nycluxride.com or message us on WhatsApp. ${SPRINTER_AHEAD}`);
  const ld = [...faq.querySelectorAll('script[type="application/ld+json"]')].flatMap((el) => JSON.parse(el.textContent)["@graph"]).find((g) => g["@type"] === "FAQPage").mainEntity.find((q) => q.name === "When is the best time to schedule my ride?");
  assert.equal(ld.acceptedAnswer.text, answer);
  for (const file of ["rates.html", "fleet.html", "sprinter-van-service-nyc.html", "faq.html", "limousine-service-nyc.html", "wedding-car-service-nyc.html"]) {
    const body = flat(dom(file).querySelector("main").textContent);
    assert.equal(body.split(SPRINTER_AHEAD).length - 1, file === "limousine-service-nyc.html" ? 3 : file === "rates.html" ? 2 : 1, file);
    assert.equal(body.split(`${SPRINTER_AHEAD} ${SPRINTER_SWAP}`).length - 1, file === "faq.html" ? 0 : file === "limousine-service-nyc.html" ? 3 : file === "rates.html" ? 2 : 1, file);
    assert.equal(body.split(SPRINTER_SWAP).length - 1, file === "faq.html" ? 0 : file === "limousine-service-nyc.html" ? 3 : file === "rates.html" ? 2 : 1, file);
  }
  const ahead = `Online at least ${MIN_NOTICE_MINUTES} minutes before pickup. Sooner by email or WhatsApp when a car is free. ${SPRINTER_AHEAD} ${SPRINTER_SWAP}`;
  const limo = dom("limousine-service-nyc.html");
  assert.deepEqual([...limo.querySelectorAll("dl.facts dt")].filter((dt) => text(dt) === "Booking ahead").map((dt) => text(dt.nextElementSibling)), [ahead]);
  assert.deepEqual([...limo.querySelectorAll(".assure li")].filter((li) => text(li.querySelector("b")) === "Booking ahead").map((li) => text(li.querySelector("span"))), [ahead]);
  assert.ok([...limo.querySelectorAll("ol.steps li")].some((li) => text(li) === `Send us the trip at least ${MIN_NOTICE_MINUTES} minutes before pickup. A Sprinter by the hour has a 4-hour minimum. ${SPRINTER_AHEAD} ${SPRINTER_SWAP}`));
  const wedding = [...dom("wedding-car-service-nyc.html").querySelectorAll("dl.facts dt")].map((dt) => [text(dt), text(dt.nextElementSibling)]);
  assert.deepEqual(wedding.find(([dt]) => dt === "Booking ahead"), ["Booking ahead", ahead]);
  for (const t of [SPRINTER_AHEAD, SPRINTER_SWAP, SPRINTER_BUSY, HEADINGS.sprinter, REASONS["sprinter-notice"].text, ERRORS["sprinter-notice"].text]) assert.doesNotMatch(t, /[\u2013\u2014;]/, t);
});

await test("every full booking form carries the Sprinter notice message and its request block with the texts of api/_copy.mjs, right after the vehicle class message and the Sprinter price block", async () => {
  assert.deepEqual([ERRORS["sprinter-notice"], REASONS["sprinter-notice"], HEADINGS.sprinter], [{ field: "class", text: `${SPRINTER_AHEAD} Choose a later pickup or another car, or send us the trip.` }, { group: "sprinter", text: "We need 3 hours to arrange a Sprinter. Choose a later pickup or another car, or send us the trip." }, "Book a Sprinter 3 hours ahead"]);
  for (const file of ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"]) {
    const d = dom(file);
    const e = d.getElementById("e-sprinter-notice");
    const q = d.getElementById("q-sprinter-notice");
    assert.ok(e.matches("p.bk-e.field__hint") && e.previousElementSibling.id === "e-class" && d.getElementById("bk-cards").contains(e) && flat(e.textContent) === ERRORS["sprinter-notice"].text, file);
    assert.ok(q.matches("div.bk-q") && q.previousElementSibling.id === "q-sprinter-price" && flat(q.querySelector("h3").textContent) === HEADINGS.sprinter && flat(q.querySelector("p").textContent) === REASONS["sprinter-notice"].text && q.children.length === 2, file);
  }
});

if (failures) {
  console.error = (...args) => process.stderr.write(args.join(" ") + "\n");
  console.error(`\n${failures} sprinter test(s) failed`);
  process.exit(1);
}
console.log("\nAll sprinter tests passed");
process.exit(0);
