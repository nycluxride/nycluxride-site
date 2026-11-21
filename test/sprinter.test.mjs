import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { JSDOM } from "jsdom";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, receipt, shownLines, serviceLabel, composeMessage, classTotal, ownerSubject, bookingData, nycToUtc } from "../api/_trip.mjs";
import { sessionParams, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters, bookingText, bookingEvents } from "../api/_mail.mjs";
import { POST as bookPost, GET as bookGet } from "../api/book.mjs";
import { routeKey, signRoute } from "../api/_ticket.mjs";
import { ERRORS, LABELS, MAIL, POLICY } from "../api/_copy.mjs";
import { VEHICLES, CLASSES, CLASS_DEFAULT_VEHICLE, AIRPORT_TOTALS, DISTANCE_RATES, HOURS, PASSENGERS, NYC_TAX_PERCENT, BCF_PERCENT, percentCents } from "../api/_rates.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const SITE = "https://www.nycluxride.com";
const REF = "48213590";
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const BROOKLYN = "277 Bedford Ave, Brooklyn, NY 11211";
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100", rider: "me", reach: "phone" };
const HOURLY = { trip_type: "hour", from_text: MANHATTAN, date: "2026-10-14", time: "18:00", passengers: "10", hours: "4", class: "sprinter", event: "0", tip: "", action: "pay", ...ME };
const AIRPORT = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-10-14", time: "07:30", passengers: "12", class: "sprinter", tip: "", action: "pay", ...ME };
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
const expected = (key, hours, event, tip = 0) => {
  const rate = event && VEHICLES[key].event ? VEHICLES[key].event : VEHICLES[key].hourly;
  const fare = rate * hours;
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

await test("the owner's Sprinter rates: Shuttle $135, Jet $175, Executive $225 or $235 and Limo $250 or $260 an hour for weddings, proms and events, 14 seats but 10 in the Limo, a 4-hour minimum, the Limo by the hour only, and no Sprinter class rate of its own", () => {
  assert.deepEqual(SPRINTERS, ["sprinter-shuttle", "sprinter-jet", "sprinter-executive", "sprinter-limo"]);
  assert.deepEqual(SPRINTERS.map((key) => [VEHICLES[key].name, VEHICLES[key].hourly, VEHICLES[key].event ?? null, VEHICLES[key].seats, VEHICLES[key].minHours, Boolean(VEHICLES[key].hourlyOnly)]), [
    ["Shuttle Sprinter", 13500, null, 14, 4, false],
    ["Jet Sprinter", 17500, null, 14, 4, false],
    ["Executive Sprinter", 22500, 23500, 14, 4, false],
    ["Limo Sprinter", 25000, 26000, 10, 4, true],
  ]);
  assert.deepEqual([CLASSES.sprinter.name, CLASSES.sprinter.seats, CLASSES.sprinter.bags, CLASS_DEFAULT_VEHICLE.sprinter, PASSENGERS.max, HOURS.min, HOURS.max], ["Luxury Sprinter", 14, "10 large plus 2 small bags", "sprinter-shuttle", 14, 3, 12]);
  assert.equal("sprinter" in VEHICLES, false);
  assert.ok(Object.values(VEHICLES).filter((v) => v.cls !== "sprinter").every((v) => v.minHours === undefined && v.event === undefined && v.hourlyOnly === undefined));
});

await test("4 hours of each Sprinter, with and without the event rate: the fare, NYC sales tax, Black Car Fund and the total, written out", async () => {
  const WANT = {
    "sprinter-shuttle": [[54000, 4793, 1215, 60008], [54000, 4793, 1215, 60008]],
    "sprinter-jet": [[70000, 6213, 1575, 77788], [70000, 6213, 1575, 77788]],
    "sprinter-executive": [[90000, 7988, 2025, 100013], [94000, 8343, 2115, 104458]],
    "sprinter-limo": [[100000, 8875, 2250, 111125], [104000, 9230, 2340, 115570]],
  };
  for (const key of SPRINTERS) {
    for (const [i, event] of ["0", "1"].entries()) {
      const { price } = await priced({ ...HOURLY, sprinter: key, event });
      assert.deepEqual([price.fare, price.tax, price.bcf, price.total], WANT[key][i], `${key} ${event}`);
      assert.deepEqual(pairs(price.lines), [["Fare, 4 hours", WANT[key][i][0]], ["NYC sales tax", WANT[key][i][1]], ["Black Car Fund", WANT[key][i][2]]], key);
      assert.deepEqual(pairs(shownLines(price.lines)), [["Fare, 4 hours", WANT[key][i][0]], ["Taxes and fees", WANT[key][i][1] + WANT[key][i][2]]], key);
      assert.deepEqual([price.service, price.notes, price.tolls], ["hourly", [POLICY.later.hourly], 0], key);
    }
  }
});

await test("every Sprinter and occasion for 4, 5 and 12 hours, with no gratuity, 20% and a typed $40: fare, taxes and fees and gratuity from api/_rates.mjs", async () => {
  for (const key of SPRINTERS) {
    for (const event of ["0", "1"]) {
      for (const hours of [4, 5, 12]) {
        for (const [tip, extra] of [["", {}], ["20", {}], ["custom", { tip_amount: "40" }]]) {
          const { price } = await priced({ ...HOURLY, sprinter: key, event, hours: String(hours), tip, ...extra });
          const want = expected(key, hours, event === "1", tip === "20" ? 20 : 0);
          const gratuity = tip === "custom" ? 4000 : want.tip;
          assert.deepEqual([price.fare, price.tax, price.bcf, price.tip, price.total], [want.fare, want.tax, want.bcf, gratuity, want.fare + want.tax + want.bcf + gratuity], `${key} ${event} ${hours} ${tip}`);
          assert.equal(price.lines[0].label, `Fare, ${hours} hours`);
          if (tip) assert.deepEqual(pairs(price.lines).at(-1), [tip === "custom" ? LABELS.gratuityAmount : "Gratuity for your chauffeur (20%)", gratuity], key);
        }
      }
    }
  }
  assert.equal((await priced({ ...HOURLY, sprinter: "sprinter-limo", event: "1", hours: "12", tip: "20" })).price.total, 312000 + 27690 + 7020 + 62400);
});

await test("the 4-hour minimum is the server's: 3 hours of any Sprinter is refused with its own message, 2 hours too, and 13 hours goes to dispatch like every class", async () => {
  for (const key of SPRINTERS) {
    for (const hours of ["3", "2", "0", "1"]) await invalid({ ...HOURLY, sprinter: key, hours }, "sprinter-hours");
    assert.equal((await priced({ ...HOURLY, sprinter: key, hours: "4" })).price.fare, VEHICLES[key].hourly * 4);
    assert.deepEqual((await run({ ...HOURLY, sprinter: key, hours: "13" })).check, { kind: "quote", reason: "hours-range", field: "" });
  }
  assert.deepEqual(ERRORS["sprinter-hours"], { field: "hours", text: "A Sprinter is booked for 4 hours or more." });
  for (const cls of ["suv", "premium", "first", "sedan"]) assert.equal((await priced({ ...HOURLY, class: cls, passengers: "1", hours: "3" })).price.lines[0].label, "Fare, 3 hours", cls);
  for (const extra of [{ minHours: "3" }, { min_hours: "3" }, { hours_min: "3" }, { minimum: "3" }, { vehicle: "sprinter-shuttle", hours: "3" }]) await invalid({ ...HOURLY, hours: "3", ...extra }, "sprinter-hours");
});

await test("the class cards of a 3-hour booking show the Sprinter as 4 hours minimum, with no price, and a 4-hour booking prices every class", async () => {
  const three = (await priced({ ...HOURLY, class: "suv", passengers: "2", hours: "3" })).trip;
  assert.equal(classTotal(three, "sprinter"), null);
  const four = (await priced({ ...HOURLY, class: "suv", passengers: "2", hours: "4", sprinter: "sprinter-limo", event: "1" })).trip;
  assert.equal(classTotal(four, "sprinter"), expected("sprinter-limo", 4, true).total);
  assert.equal(classTotal(four, "suv"), expected("suv-suburban", 4, false).total);
});

await test("the Limo Sprinter is booked by the hour only: one way, a round trip, an airport transfer, a trip with stops and a trip priced by distance are refused, by its key in the sprinter or the vehicle field", async () => {
  process.env.GOOGLE_MOCK = "true";
  const trips = [
    ["airport", AIRPORT],
    ["round trip", { ...AIRPORT, ...BACK }],
    ["from the airport", { ...AIRPORT, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, to_id: "" }],
    ["stops", { ...AIRPORT, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", to_text: "55 Church St, New York, NY 10007", to_id: "" }],
    ["one way by distance", { ...AIRPORT, to_text: BROOKLYN, to_id: "" }],
  ];
  for (const [name, fields] of trips) {
    await invalid({ ...fields, sprinter: "sprinter-limo" }, "sprinter");
    await invalid({ ...fields, vehicle: "sprinter-limo" }, "sprinter");
    for (const key of ["sprinter-shuttle", "sprinter-jet", "sprinter-executive"]) assert.notEqual((await run({ ...fields, sprinter: key })).check.kind, "invalid", `${name} ${key}`);
  }
  assert.deepEqual(ERRORS.sprinter, { field: "sprinter", text: "The Limo Sprinter is booked by the hour only. Choose another Sprinter." });
  assert.equal((await priced({ ...AIRPORT, class: "suv", passengers: "2", sprinter: "sprinter-limo" })).price.total, AIRPORT_TOTALS.suv.jfk);
  assert.equal((await priced({ ...HOURLY, sprinter: "sprinter-limo" })).price.fare, 100000);
});

await test("Shuttle, Jet and Executive keep today's Sprinter transfer prices: $500 to JFK, Newark and Teterboro, $450 to LaGuardia, both ways and round trip, and the Sprinter distance rate", async () => {
  process.env.GOOGLE_MOCK = "true";
  for (const key of ["sprinter-shuttle", "sprinter-jet", "sprinter-executive"]) {
    for (const [airport, id, text] of [["jfk", "jfk", "John F. Kennedy (JFK)"], ["lga", "lga", "LaGuardia (LGA)"], ["ewr", "ewr", "Newark Liberty (EWR)"], ["teb", "teb", "Teterboro (TEB)"]]) {
      const { trip, price } = await priced({ ...AIRPORT, to_text: text, to_id: id, sprinter: key });
      assert.equal(price.total, AIRPORT_TOTALS.sprinter[airport], `${key} ${airport}`);
      assert.equal(trip.vehicle, key);
      assert.equal(serviceLabel(trip), `To ${{ jfk: "JFK", lga: "LaGuardia (LGA)", ewr: "Newark Liberty (EWR)", teb: "Teterboro (TEB)" }[airport]}, ${VEHICLES[key].name}`);
    }
    assert.equal((await priced({ ...AIRPORT, ...BACK, sprinter: key })).price.total, 2 * AIRPORT_TOTALS.sprinter.jfk);
    const ride = await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", sprinter: key, event: "1" });
    const shuttle = await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "" });
    assert.deepEqual([ride.price.total, ride.price.service, ride.price.fare >= DISTANCE_RATES.sprinter.minimum, ride.trip.event], [shuttle.price.total, "distance", true, false], key);
  }
  assert.deepEqual(AIRPORT_TOTALS.sprinter, { jfk: 50000, lga: 45000, ewr: 50000, teb: 50000 });
  assert.deepEqual(DISTANCE_RATES.sprinter, { base: 8000, mile: 900, minute: 145, minimum: 25000 });
});

await test("the event rate is ignored for the Shuttle and the Jet Sprinter and for every transfer, and only the value 1 asks for it", async () => {
  for (const key of ["sprinter-shuttle", "sprinter-jet"]) {
    const { trip, price } = await priced({ ...HOURLY, sprinter: key, event: "1" });
    assert.equal(price.total, expected(key, 4, false).total);
    assert.equal(serviceLabel(trip), `By the hour, ${VEHICLES[key].name}, 4 hours`);
    assert.equal(built(trip, price).metadata.event, undefined);
  }
  assert.equal((await priced({ ...HOURLY, sprinter: "sprinter-executive", event: "0" })).price.fare, 90000);
  for (const value of ["", "yes", "true", "on", "2", "11"]) {
    await invalid({ ...HOURLY, sprinter: "sprinter-executive", event: value }, "event");
    assert.equal((await priced({ ...HOURLY, sprinter: "sprinter-executive", event: value, action: "options" })).price.fare, 90000, value);
  }
  assert.equal((await priced({ ...HOURLY, sprinter: "sprinter-executive", event: "1" })).price.fare, 94000);
  assert.equal((await priced({ ...AIRPORT, sprinter: "sprinter-executive", event: "1" })).price.total, AIRPORT_TOTALS.sprinter.jfk);
  for (const cls of ["suv", "premium", "first", "sedan"]) {
    const plain = (await priced({ ...HOURLY, class: cls, passengers: "1", event: "" })).price.total;
    assert.equal((await priced({ ...HOURLY, class: cls, passengers: "1", event: "1" })).price.total, plain, cls);
  }
});

await test("the wedding, prom or event question is required for the Executive and Limo Sprinter by the hour: no answer is refused on pay, while options price the regular rate", async () => {
  for (const key of ["sprinter-executive", "sprinter-limo"]) {
    const { event, ...open } = { ...HOURLY, sprinter: key };
    await invalid(open, "event");
    await invalid({ ...open, event: "" }, "event");
    assert.equal(readInput(open).event, null, key);
    assert.equal((await priced({ ...open, action: "options" })).price.fare, VEHICLES[key].hourly * 4, key);
    assert.equal((await priced({ ...open, action: "quote" })).price.fare, VEHICLES[key].hourly * 4, key);
    assert.deepEqual([readInput({ ...open, event: "0" }).event, readInput({ ...open, event: "1" }).event], [false, true], key);
    assert.equal((await priced({ ...open, event: "0" })).price.fare, VEHICLES[key].hourly * 4, key);
    assert.equal((await priced({ ...open, event: "1" })).price.fare, VEHICLES[key].event * 4, key);
  }
  assert.deepEqual([ERRORS.event.field, ERRORS.event.text], ["event", "Choose Yes or No."]);
});

await test("every other vehicle ignores the event question: no answer, No or Yes never refuse or change the price of the Shuttle, the Jet, any car class by the hour or any transfer", async () => {
  for (const value of [undefined, "", "0", "1"]) {
    const answer = value === undefined ? {} : { event: value };
    for (const key of ["sprinter-shuttle", "sprinter-jet"]) {
      const { event, ...open } = { ...HOURLY, sprinter: key };
      assert.equal((await priced({ ...open, ...answer })).price.fare, VEHICLES[key].hourly * 4, `${key} ${value}`);
    }
    for (const cls of ["suv", "premium", "first", "sedan"]) {
      const { event, ...open } = { ...HOURLY, class: cls, passengers: "1" };
      assert.equal((await run({ ...open, ...answer })).check.kind, "price", `${cls} ${value}`);
    }
    for (const key of ["sprinter-shuttle", "sprinter-jet", "sprinter-executive"]) assert.equal((await priced({ ...AIRPORT, sprinter: key, ...answer })).price.total, AIRPORT_TOTALS.sprinter.jfk, `${key} ${value}`);
  }
});

await test("the booking handler refuses an Executive or Limo Sprinter by the hour paid with no answer, as JSON and without JavaScript, before any Stripe call, and books it once answered", async () => {
  mockEnv();
  const { event, ...open } = { ...HOURLY, ...soon };
  for (const key of ["sprinter-executive", "sprinter-limo"]) {
    const res = await post({ ...open, sprinter: key, nonce: "nonce-sprinter-event-0001" });
    assert.equal(res.status, 422, key);
    assert.deepEqual(await res.json(), { kind: "invalid", code: "event", field: "event", text: "Choose Yes or No." }, key);
    const form = await post({ ...open, sprinter: key }, { form: true });
    assert.deepEqual([form.status, form.headers.get("location")], [303, "/book#e-event"], key);
    const options = await (await post({ ...open, sprinter: key, action: "options", nonce: "nonce-sprinter-event-0002" })).json();
    assert.deepEqual([options.kind, options.selected.event, options.price.total_cents], ["options", false, expected(key, 4, false).total], key);
  }
  for (const [answer, rate] of [["0", false], ["1", true]]) {
    const pay = await (await post({ ...open, sprinter: "sprinter-executive", event: answer, nonce: `nonce-sprinter-event-pay${answer}` })).json();
    assert.equal(pay.kind, "pay", answer);
    const id = new URL(pay.url, SITE).searchParams.get("session_id");
    const page = await (await bookGet(new Request(`${SITE}/api/book?session_id=${id}`))).json();
    assert.equal(page.total_cents, expected("sprinter-executive", 4, rate).total, answer);
  }
  const jet = await (await post({ ...open, sprinter: "sprinter-jet", nonce: "nonce-sprinter-event-jet01" })).json();
  assert.equal(jet.kind, "pay");
});

await test("passengers follow the vehicle: up to 14 in the Shuttle, Jet and Executive, 10 in the Limo, and 15 is refused for every class", async () => {
  for (const key of ["sprinter-shuttle", "sprinter-jet", "sprinter-executive"]) assert.equal((await run({ ...HOURLY, sprinter: key, passengers: "14" })).check.reason, "", key);
  assert.deepEqual((await run({ ...HOURLY, sprinter: "sprinter-limo", passengers: "11" })).check, { kind: "price", reason: "seats", hold: "" });
  assert.equal((await run({ ...HOURLY, sprinter: "sprinter-limo", passengers: "10" })).check.reason, "");
  assert.equal((await run({ ...AIRPORT, passengers: "14" })).check.reason, "");
  await invalid({ ...AIRPORT, passengers: "15" }, "passengers");
  await invalid({ ...HOURLY, passengers: "15" }, "passengers");
  assert.deepEqual((await run({ ...AIRPORT, class: "suv", passengers: "13" })).check, { kind: "price", reason: "seats", hold: "" });
});

await test("tampering: an unknown or retired vehicle key, an SUV key sent for a Sprinter, a price, rate or total from the browser and a changed signed route are ignored or refused, never priced lower", async () => {
  process.env.GOOGLE_MOCK = "true";
  for (const sprinter of ["", "sprinter", "sprinter-bus", "suv-denali", "premium", "constructor", "__proto__", "sprinter-shuttle ", "SPRINTER-LIMO"]) {
    const { trip, price } = await priced({ ...HOURLY, sprinter, vehicle: "" });
    assert.deepEqual([trip.vehicle, price.fare], ["sprinter-shuttle", 54000], sprinter);
  }
  const loud = { fare: "100", fare_cents: "100", total_cents: "100", hourly: "1", rate: "1", event_rate: "1", price: "1", tax_cents: "0", minHours: "1", seats: "20" };
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-limo", event: "1", ...loud });
  assert.equal(price.total, expected("sprinter-limo", 4, true).total);
  assert.equal(built(trip, price).metadata.total_cents, String(expected("sprinter-limo", 4, true).total));
  const suv = await priced({ ...HOURLY, class: "suv", passengers: "2", vehicle: "sprinter-limo", sprinter: "sprinter-limo", event: "1" });
  assert.deepEqual([suv.trip.vehicle, suv.price.fare], ["suv-suburban", 38000]);
  const at = nycToUtc(AIRPORT.date, AIRPORT.time).toISOString();
  const route = signRoute([[routeKey({ address: "350 5th Ave, New York, NY 10118" }, { address: BROOKLYN }, at), 46, 27]], NOW);
  const shuttle = await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route });
  await invalid({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route, sprinter: "sprinter-limo" }, "sprinter");
  await invalid({ ...HOURLY, route, hours: "3" }, "sprinter-hours");
  assert.equal((await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route, sprinter: "sprinter-executive" })).price.total, shuttle.price.total);
  assert.equal((await priced({ ...AIRPORT, to_text: BROOKLYN, to_id: "", route: route.slice(0, -2) + (route.endsWith("A") ? "BB" : "AA"), sprinter: "sprinter-executive" })).price.total, shuttle.price.total);
});

await test("Stripe: the line items, the Checkout description in the owner's subject format, the line item description and the metadata name the Sprinter and the event, with vehicle and event as the only new keys", async () => {
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-executive", event: "1", tip: "20", hours: "5" });
  const b = built(trip, price);
  const want = expected("sprinter-executive", 5, true, 20);
  assert.deepEqual(b.items.map(([name, cents]) => [name, cents]), [["Fare, 5 hours", want.fare], ["Taxes and fees", want.tax + want.bcf], ["Gratuity for your chauffeur (20%)", want.tip]]);
  assert.equal(b.items.reduce((sum, [, cents]) => sum + cents, 0), want.total);
  assert.equal(b.items[0][2].split(". ")[0], "By the hour, Executive Sprinter for a wedding, prom or event, 5 hours");
  assert.ok(b.description.startsWith(`New booking ${REF}: Wed Oct 14, 6:00 PM, Executive Sprinter for a wedding, prom or event, 5 hours from 350 5th Ave. Customer Ana Lopez.`), b.description);
  assert.deepEqual([b.metadata.service, b.metadata.class, b.metadata.vehicle, b.metadata.event, b.metadata.hours, b.metadata.fare_cents, b.metadata.total_cents], ["hourly", "sprinter", "sprinter-executive", "1", "5", String(want.fare), String(want.total)]);
  assert.deepEqual(b.intentMetadata, b.metadata);
  const unasked = await priced({ ...HOURLY, sprinter: "sprinter-executive" });
  const plain = built(unasked.trip, unasked.price);
  assert.deepEqual([plain.metadata.vehicle, plain.metadata.event], ["sprinter-executive", undefined]);
  assert.ok(plain.description.includes(", Executive Sprinter, 4 hours from 350 5th Ave."), plain.description);
  const transfer = await priced({ ...AIRPORT, sprinter: "sprinter-jet" });
  const t = built(transfer.trip, transfer.price);
  assert.deepEqual([t.metadata.vehicle, t.metadata.event, t.items[0][2].split(". ")[0]], ["sprinter-jet", undefined, "To JFK, Jet Sprinter"]);
  assert.ok(t.description.startsWith(`New booking ${REF}: Wed Oct 14, 7:30 AM, Jet Sprinter, 350 5th Ave to JFK.`), t.description);
  const suv = await priced({ ...AIRPORT, class: "suv", passengers: "2" });
  assert.equal(built(suv.trip, suv.price).metadata.vehicle, undefined);
});

await test("metadata stays within budget: the worst Sprinter shapes, hourly with every extra and a round trip with stops, at most 48 keys, every value at most 500 characters", async () => {
  process.env.GOOGLE_MOCK = "true";
  const extras = { meet: "1", sign: "Ortiz family", tip: "custom", tip_amount: "40", rider: "other", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", pphone_cc: "GB", notes: "A".repeat(500), infant_seats: "3", toddler_seats: "3", booster_seats: "3", small_dogs: "3", large_dogs: "3", flight: "DL 401" };
  for (const fields of [
    { ...HOURLY, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", sprinter: "sprinter-limo", event: "1", hours: "12", ...extras },
    { ...AIRPORT, from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", stop1_text: MANHATTAN, stop2_text: BROOKLYN, to_text: "1 Old Country Rd, Mineola, NY 11501", to_id: "", ...BACK, return_flight: "DL 402", sprinter: "sprinter-executive", ...extras },
  ]) {
    const { trip, price } = await priced(fields);
    const b = built(trip, price);
    assert.ok(Object.keys(b.metadata).length <= 48, `${Object.keys(b.metadata).length}: ${Object.keys(b.metadata).join(" ")}`);
    assert.ok(Object.values(b.metadata).every((v) => v.length <= 500));
    assert.equal(b.metadata.vehicle, trip.vehicle);
  }
});

await test("the receipt and the confirmation page rebuild the same lines, total and summary from the metadata, the event too, and a changed event or vehicle in old metadata never changes the amount", async () => {
  for (const [fields, summary] of [
    [{ ...HOURLY, sprinter: "sprinter-limo", event: "1", tip: "20" }, "Wed, Oct 14, 2026, 6:00 PM. By the hour, Limo Sprinter for a wedding, prom or event, 4 hours."],
    [{ ...HOURLY, sprinter: "sprinter-jet", event: "1", tip: "20" }, "Wed, Oct 14, 2026, 6:00 PM. By the hour, Jet Sprinter, 4 hours."],
    [{ ...AIRPORT, sprinter: "sprinter-executive" }, "Wed, Oct 14, 2026, 7:30 AM. To JFK, Executive Sprinter."],
  ]) {
    const { trip, price } = await priced(fields);
    const b = built(trip, price);
    const r = receipt(b.metadata, ON);
    assert.equal(r.summary, summary);
    assert.deepEqual(shownLines(r.lines).map(({ label, cents }) => [label, cents]), b.items.map(([name, cents]) => [name, cents]));
    assert.equal(r.lines.reduce((sum, line) => sum + line.cents, 0), price.total);
    const flipped = receipt({ ...b.metadata, event: b.metadata.event ? "" : "1", vehicle: "sprinter-shuttle" }, ON);
    assert.equal(flipped.lines.reduce((sum, line) => sum + line.cents, 0), price.total, "the paid amounts come from the cents keys only");
  }
  mockEnv();
  const fields = { ...HOURLY, ...soon, sprinter: "sprinter-executive", event: "1", nonce: "nonce-sprinter-page-00001" };
  const paid = await (await post(fields)).json();
  assert.equal(paid.kind, "pay");
  const id = new URL(paid.url, SITE).searchParams.get("session_id");
  const page = await (await bookGet(new Request(`${SITE}/api/book?session_id=${id}`))).json();
  assert.match(page.summary, /\. By the hour, Executive Sprinter for a wedding, prom or event, 4 hours\.$/);
  assert.deepEqual(page.lines.map((l) => [l.label, l.cents]), [["Fare, 4 hours", 94000], ["Taxes and fees", 8343 + 2115]]);
  assert.equal(page.total_cents, 104458);
});

await test("both emails, the text message and the calendar name the Sprinter, and the occasion when it was charged, where the vehicle already shows", async () => {
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-executive", event: "1", hours: "5" });
  const s = session(built(trip, price).metadata);
  const [customer, owner] = bookingLetters(s, { owners: ["info@nycluxride.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }, NOW.getTime());
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes("\nVehicle: Executive Sprinter\nOccasion: Wedding, prom or event\n"), letter.text);
    assert.ok(letter.html.includes(">Occasion</th>") && letter.html.includes("Wedding, prom or event"), letter.kind);
  }
  assert.equal(owner.subject, `[TEST] New booking ${REF}: Wed Oct 14, 6:00 PM, Executive Sprinter for a wedding, prom or event, 5 hours from 350 5th Ave`);
  assert.equal(ownerSubject(bookingData(s.metadata), REF), owner.subject.replace("[TEST] ", ""));
  const text = bookingText(s);
  assert.ok(text.includes("\nExecutive Sprinter for a wedding, prom or event\n"), text);
  const [event] = bookingEvents(s);
  assert.equal(event.summary, `[TEST] ${REF} Executive Sprinter for a wedding, prom or event: 5 hours from 350 5th Ave`);
  assert.equal(new Date(event.end.dateTime) - new Date(event.start.dateTime), 5 * 3600000);
  assert.ok(event.description.includes("\nVehicle: Executive Sprinter\nOccasion: Wedding, prom or event\n"), event.description);
  const shuttle = await priced({ ...HOURLY, sprinter: "sprinter-shuttle", event: "1" });
  const plain = session(built(shuttle.trip, shuttle.price).metadata);
  const [mail] = bookingLetters(plain, { owners: ["info@nycluxride.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }, NOW.getTime());
  assert.ok(mail.text.includes("\nVehicle: Shuttle Sprinter\n") && !mail.text.includes("Occasion"), mail.text);
  assert.ok(bookingText(plain).includes("\nShuttle Sprinter\n") && !bookingText(plain).includes("wedding"));
  assert.equal(bookingEvents(plain)[0].summary, `[TEST] ${REF} Shuttle Sprinter: 4 hours from 350 5th Ave`);
  const transfer = await priced({ ...AIRPORT, sprinter: "sprinter-jet", ...BACK });
  const round = session(built(transfer.trip, transfer.price).metadata);
  assert.ok(bookingLetters(round, { owners: ["info@nycluxride.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }, NOW.getTime())[1].text.includes("\nVehicle: Jet Sprinter\n"));
  assert.deepEqual(bookingEvents(round).map((e) => e.summary), [`[TEST] ${REF} Jet Sprinter: 350 5th Ave to JFK`, `[TEST] Return: ${REF} Jet Sprinter: JFK to 350 5th Ave`]);
  assert.equal(MAIL.labels.occasion, "Occasion");
});

await test("the reserve by email and WhatsApp message names the Sprinter and the occasion like the Vehicle line of every booking", async () => {
  const { trip, price } = await priced({ ...HOURLY, sprinter: "sprinter-limo", event: "1" });
  assert.ok(composeMessage(trip, REF, price.total).includes("\nTrip: By the hour, 4 hours\n") && composeMessage(trip, REF, price.total).includes("\nVehicle: Limo Sprinter for a wedding, prom or event\n"));
  const one = await priced({ ...AIRPORT, sprinter: "sprinter-executive" });
  assert.ok(composeMessage(one.trip, REF, one.price.total).includes("\nVehicle: Executive Sprinter\n"));
  const suv = await priced({ ...HOURLY, class: "suv", passengers: "2", vehicle: "suv-denali", sprinter: "sprinter-limo", event: "1" });
  assert.ok(composeMessage(suv.trip, REF).split("\n").includes("Vehicle: GMC Denali (Business SUV)"));
});

await test("the booking handler: options list each Sprinter with its total and seats, the Limo only by the hour, quote and pay price the Sprinter chosen, and without JavaScript the Limo transfer and a 3-hour Sprinter land on their messages before any Stripe call", async () => {
  mockEnv();
  const hourly = await (await post({ ...HOURLY, ...soon, sprinter: "sprinter-limo", event: "1", action: "options", nonce: "nonce-sprinter-options-1" })).json();
  assert.equal(hourly.kind, "options");
  assert.deepEqual(hourly.vehicles.filter((v) => v.vehicle.startsWith("sprinter-")).map((v) => [v.vehicle, v.label, v.seats, v.total_cents]), [
    ["sprinter-shuttle", "Shuttle Sprinter", 14, 60008],
    ["sprinter-jet", "Jet Sprinter", 14, 77788],
    ["sprinter-executive", "Executive Sprinter", 14, 104458],
    ["sprinter-limo", "Limo Sprinter", 10, 115570],
  ]);
  assert.deepEqual([hourly.selected.vehicle, hourly.selected.event, hourly.price.total_cents, hourly.classes.at(-1).total_cents], ["sprinter-limo", true, 115570, 115570]);
  const one = await (await post({ ...AIRPORT, ...soon, time: "07:30", action: "options", nonce: "nonce-sprinter-options-2" })).json();
  assert.deepEqual(one.vehicles.map((v) => [v.vehicle, v.total_cents]), [["sprinter-shuttle", 50000], ["sprinter-jet", 50000], ["sprinter-executive", 50000]]);
  const refused = await post({ ...AIRPORT, ...soon, time: "07:30", sprinter: "sprinter-limo", action: "options", nonce: "nonce-sprinter-options-3" });
  assert.deepEqual([refused.status, (await refused.json()).code], [422, "sprinter"]);
  const short = await post({ ...HOURLY, ...soon, hours: "3", action: "quote", nonce: "nonce-sprinter-options-4" });
  assert.deepEqual([short.status, (await short.json()).field], [422, "hours"]);
  for (const [fields, location] of [[{ ...AIRPORT, ...soon, time: "07:30", sprinter: "sprinter-limo" }, "/book#e-sprinter"], [{ ...HOURLY, ...soon, hours: "3" }, "/book#e-sprinter-hours"]]) {
    const res = await post(fields, { form: true });
    assert.deepEqual([res.status, res.headers.get("location")], [303, location]);
  }
  const pay = await (await post({ ...HOURLY, ...soon, sprinter: "sprinter-jet", hours: "6", nonce: "nonce-sprinter-pay-000001" })).json();
  assert.equal(pay.kind, "pay");
  const id = new URL(pay.url, SITE).searchParams.get("session_id");
  const page = await (await bookGet(new Request(`${SITE}/api/book?session_id=${id}`))).json();
  assert.equal(page.total_cents, expected("sprinter-jet", 6, false).total);
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

await test("the prom, wedding and comparison posts give the Sprinter its 4 hours wherever they give the 3-hour minimum, and say four kinds of Sprinter, not a count of vans", async () => {
  for (const file of ["blog/nyc-prom-limo-booking-guide-march-13.html", "blog/wedding-event-limo-nyc-march-27.html", "blog/nyc-limo-service-comparison-guide-april-29.html", "limousine-service-nyc.html"]) {
    const said = sentences(dom(file));
    const three = said.filter((t) => /3-hour minimum/.test(t));
    assert.ok(three.length > 0, file);
    assert.deepEqual(three.filter((t) => !t.includes("4 hours in a Sprinter")), [], file);
    assert.deepEqual(said.filter((t) => /\b(4|four) (Luxury )?Sprinters\b/.test(t)), [], file);
  }
  assert.ok(sentences(dom("blog/nyc-limo-service-comparison-guide-april-29.html")).includes("Hourly bookings have a 3-hour minimum, or 4 hours in a Sprinter."));
  for (const file of ["blog/nyc-prom-limo-booking-guide-march-13.html", "blog/wedding-event-limo-nyc-march-27.html"]) assert.ok(sentences(dom(file)).includes("We have four kinds of Sprinter."), file);
  const limo = sentences(dom("limousine-service-nyc.html"));
  assert.ok(limo.includes("Our Sprinters have different cabins.") && limo.includes("The Executive Sprinter has captain's chairs around a table."));
});

await test("every Sprinter Book link on the fleet, rates and limousine pages carries the Sprinter it names, so /book opens that Sprinter", async () => {
  const byName = Object.fromEntries(SPRINTERS.map((key) => [VEHICLES[key].name, key]));
  const found = [];
  for (const file of ["fleet.html", "rates.html", "limousine-service-nyc.html"]) {
    for (const a of dom(file).querySelectorAll('main a[href^="/book?"]')) {
      const label = (a.getAttribute("aria-label") || "") + " " + flat(a.textContent);
      const name = Object.keys(byName).find((n) => label.includes(n));
      if (!name) continue;
      const q = new URL(a.getAttribute("href"), SITE).searchParams;
      found.push([file, name]);
      assert.deepEqual([q.get("class"), q.get("sprinter")], ["sprinter", byName[name]], `${file} ${label}`);
      if (VEHICLES[byName[name]].hourlyOnly) assert.deepEqual([q.get("trip-type"), q.get("hours")], ["hour", String(VEHICLES[byName[name]].minHours)], label);
    }
  }
  assert.deepEqual(found.map((x) => x.join(" ")), [...SPRINTERS.map((k) => `fleet.html ${VEHICLES[k].name}`), ...SPRINTERS.map((k) => `rates.html ${VEHICLES[k].name}`), "limousine-service-nyc.html Limo Sprinter"]);
});

await test("no page shows the older bar photo as the Limo Sprinter: the Brooklyn and Staten Island slots show the Jet Sprinter, the services page shows the white Limo for weddings, the Jet for prom and the Shuttle for Sprinter vans, and the fleet photo row is a named group", async () => {
  for (const file of pages()) {
    const html = readFileSync(SITE_ROOT + file, "utf8");
    assert.doesNotMatch(html, /fleet\/sprinter-limo(-\d+)?\.(webp|avif)|bench seats, a bar and a screen/, file);
  }
  const JET = ["/fleet/sprinter-jet-600.webp", "Inside the Jet Sprinter: two leather captain's chairs facing a screen", "Jet Sprinter"];
  const LIMO = ["/fleet/sprinter-limo-castle-600.webp", "The white Limo Sprinter with its door open in front of a stone castle", "Limo Sprinter"];
  const SHUTTLE = ["/fleet/sprinter-shuttle-side-600.webp", "The black Shuttle Sprinter parked at a curb at sunset", "Shuttle Sprinter"];
  for (const [file, sel, want] of [["locations/brooklyn.html", "figure.svc__plate", JET], ["services.html", "#weddings figure", LIMO], ["services.html", "#prom figure", JET], ["services.html", "#sprinter figure", SHUTTLE]]) {
    const fig = dom(file).querySelector(sel);
    assert.deepEqual([fig.querySelector("img").getAttribute("src"), fig.querySelector("img").alt, flat(fig.querySelector("figcaption b").textContent)], want, `${file} ${sel}`);
  }
  const svc = [...dom("services.html").querySelectorAll("figure.svc__plate img")].map((i) => i.getAttribute("src")).filter((src) => src.includes("sprinter"));
  assert.deepEqual([svc.length, new Set(svc).size], [3, 3]);
  const si = dom("locations/staten-island.html");
  assert.equal(si.querySelector('meta[property="og:image"]').content, "https://www.nycluxride.com/fleet/sprinter-jet.webp");
  const row = dom("fleet.html").querySelector(".fleet-photos");
  assert.deepEqual([row.getAttribute("role"), row.getAttribute("aria-labelledby"), flat(row.querySelector("#h-sprinter-photos").textContent)], ["group", "h-sprinter-photos", "Photos of our Sprinters"]);
});

if (failures) {
  console.error = (...args) => process.stderr.write(args.join(" ") + "\n");
  console.error(`\n${failures} sprinter test(s) failed`);
  process.exit(1);
}
console.log("\nAll sprinter tests passed");
process.exit(0);
