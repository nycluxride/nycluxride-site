import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceRide, receipt, shownLines, serviceLabel, laterNotes, tollsIn, bookingData, rateKey } from "../api/_trip.mjs";
import { tollCents, computeRoute, googleUp, TOLL_PASSES } from "../api/_google.mjs";
import { decodePath, tollPlan, priceSplit, arcsOf, project, crossingCents, tollClassOf, TOLL_GROUP, intoJersey, returnCents } from "../api/_tolls.mjs";
import { mockRoute, mockSplit } from "../api/_mock.mjs";
import { readRoute, signRoute, routeKey, ROUTE, signTicket } from "../api/_ticket.mjs";
import { sessionParams, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters, bookingEvents } from "../api/_mail.mjs";
import { POST as routePost } from "../api/route.mjs";
import { POST as bookPost } from "../api/book.mjs";
import { CHECKOUT, NOTES, POLICY, LABELS } from "../api/_copy.mjs";
import { AIRPORT_TOTALS, FEE_PERCENT, STOP_FEE_CENTS, TOLL_CLASS, PA_TOLLS, PA_PEAK, NJTP_TOLLS, TOLL_TABLE_UNTIL, percentCents } from "../api/_rates.mjs";
import { instanceBudget } from "../api/_http.mjs";
import { distanceFare, nycToUtc, requestReason } from "../api/_trip.mjs";

const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const SITE = "https://www.nycluxride.com";
const EWR_ADDRESS = "Newark Liberty International Airport, Newark, NJ 07114";
const RIVERSIDE = "19 Coventry Ln, Riverside, CT 06878";
const STEAMBOAT = "1 Steamboat Rd, Greenwich, CT 06830";
const GREENWICH = "Greenwich, CT 06830";
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100", rider: "me", reach: "phone" };
const OWNER = { trip_type: "one", from_text: "Newark Liberty (EWR)", from_id: "ewr", to_text: RIVERSIDE, date: "2026-10-14", time: "07:30", passengers: "2", class: "sedan", action: "pay", ...ME };
const BACK = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
const CLASSES = ["suv", "premium", "first", "sedan", "electric", "sprinter"];
const ENV_KEYS = ["GOOGLE_MOCK", "GOOGLE_MAPS_SERVER_KEY", "PLACE_TICKET_SECRET", "PAYMENTS_ENABLED", "BOOK_MOCK", "STRIPE_SECRET_KEY", "VERCEL_ENV"];
const realFetch = globalThis.fetch;

let failures = 0;
async function test(name, fn) {
  for (const key of ENV_KEYS) delete process.env[key];
  globalThis.fetch = realFetch;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.stack || err.message).split("\n").slice(0, 14).join("\n       ")}`);
  } finally {
    for (const key of ENV_KEYS) delete process.env[key];
    globalThis.fetch = realFetch;
  }
}

const mock = () => (process.env.GOOGLE_MOCK = "true");
const pairs = (lines) => lines.map(({ label, cents }) => [label, cents]);
const money = (units, nanos, currencyCode = "USD") => ({ currencyCode, ...(units !== undefined && { units }), ...(nanos !== undefined && { nanos }) });
const tolled = (...prices) => ({ travelAdvisory: { tollInfo: { estimatedPrice: prices } } });
const fare = (cls, tenths, minutes, airport = "ewr") => priceRide(rateKey(cls), { tenths, minutes }, [airport]).fare;
const feeOf = (cents) => percentCents(cents, FEE_PERCENT);

async function run(fields, now = NOW) {
  const trip = await resolveTrip(readInput(fields), { now });
  const check = checkTrip(trip, now, ON);
  return { trip, check, price: check.kind === "price" && (!check.reason || /^sprinter-(check|quote)$/.test(check.reason)) ? priceTrip(trip, ON) : null };
}

async function priced(fields, now = NOW) {
  const out = await run(fields, now);
  assert.deepEqual(out.check, { kind: "price", reason: requestReason(out.trip, out.trip.class), hold: "" }, JSON.stringify(fields));
  return out;
}

function built(trip, price) {
  const params = sessionParams(trip, price, "48213590", ON, NOW, SITE);
  const metadata = Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  const items = [];
  for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) items.push([params.get(`line_items[${i}][price_data][product_data][name]`), Number(params.get(`line_items[${i}][price_data][unit_amount]`))]);
  return { params, metadata, items, submit: params.get("custom_text[submit][message]") };
}

const session = (metadata) => ({ id: "cs_test_tolls00000000000000000001", livemode: false, status: "complete", payment_status: "paid", amount_total: Number(metadata.total_cents), currency: "usd", client_reference_id: metadata.ref, customer_details: { email: ME.email, name: ME.name, phone: ME.phone }, payment_intent: "pi_test_tolls0001", metadata });

await test("Money to cents: units and nanos, units as a string or a number, either part left out, several USD entries added, half a cent rounded up", () => {
  assert.equal(tollCents(tolled(money("16", 790000000))), 1679);
  assert.equal(tollCents(tolled(money("5", 710000000))), 571);
  assert.equal(tollCents(tolled(money("16", 790000000), money("5", 710000000))), 2250);
  assert.equal(tollCents(tolled(money(22, 500000000))), 2250);
  assert.equal(tollCents(tolled(money("12"))), 1200);
  assert.equal(tollCents(tolled(money(undefined, 450000000))), 45);
  assert.equal(tollCents(tolled(money(undefined, undefined))), 0);
  assert.equal(tollCents(tolled(money("1", 5000000))), 101);
  assert.equal(tollCents(tolled(money("1", 4999999))), 100);
  assert.equal(tollCents(tolled(money("999999", 999999999))), 100000000);
});

await test("Money to cents: no tollInfo or no travelAdvisory means no tolls, tollInfo without a price, an empty price list, any other currency, a mixed list or a malformed amount is unknown", () => {
  assert.equal(tollCents({}), 0);
  assert.equal(tollCents({ travelAdvisory: {} }), 0);
  assert.equal(tollCents({ travelAdvisory: { tollInfo: {} } }), null);
  assert.equal(tollCents({ travelAdvisory: { tollInfo: { estimatedPrice: [] } } }), null);
  assert.equal(tollCents({ travelAdvisory: { tollInfo: { estimatedPrice: "16.79" } } }), null);
  assert.equal(tollCents(tolled(money("16", 790000000, "CAD"))), null);
  assert.equal(tollCents(tolled(money("16", 790000000), money("4", 0, "CAD"))), null);
  assert.equal(tollCents(tolled({ units: "16", nanos: 790000000 })), null);
  for (const bad of [money("-1", 0), money("1.5", 0), money("1e3", 0), money("", 0), money("1", -10000000), money("1", 1000000000), money("1", 0.5), money("1234567", 0), null, "USD 16.79"]) assert.equal(tollCents(tolled(bad)), null, JSON.stringify(bad));
});

await test("the Routes request asks for tolls the way Google documents it: extraComputations TOLLS, the tollInfo field mask, a gasoline car and only the New York E-ZPass pass, so Google prices the NJ Turnpike at the E-ZPass rate the cars pay and not the NJ off-peak discount, and reads the estimate into cents", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const calls = [];
  let body = { routes: [{ duration: "3840s", distanceMeters: 84490, ...tolled(money("16", 790000000), money("5", 710000000)) }] };
  globalThis.fetch = async (url, init) => (calls.push({ url: String(url), init }), new Response(JSON.stringify(body), { status: 200 }));
  const result = await computeRoute([{ address: EWR_ADDRESS }, { address: RIVERSIDE }], new Date("2026-10-14T11:30:00.000Z"), null);
  assert.deepEqual([result.ok, result.minutes, result.miles, result.tolls], [true, 64, 52.5, 2250]);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual([sent.extraComputations, sent.routeModifiers], [["TOLLS"], { vehicleInfo: { emissionType: "GASOLINE" }, tollPasses: TOLL_PASSES }]);
  assert.deepEqual(TOLL_PASSES, ["US_NY_EZPASSNY"]);
  assert.ok(calls[0].init.headers["X-Goog-FieldMask"].split(",").includes("routes.travelAdvisory.tollInfo"));
  body = { routes: [{ duration: "540s", distanceMeters: 5150 }] };
  assert.equal((await computeRoute([{ address: STEAMBOAT }, { address: RIVERSIDE }], new Date("2026-10-14T11:30:00.000Z"), null)).tolls, 0);
  body = { routes: [{ duration: "540s", distanceMeters: 5150, travelAdvisory: { tollInfo: {} } }] };
  assert.equal((await computeRoute([{ address: STEAMBOAT }, { address: RIVERSIDE }], new Date("2026-10-14T11:30:00.000Z"), null)).tolls, null);
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  assert.deepEqual(await computeRoute([{ address: STEAMBOAT }, { address: RIVERSIDE }], new Date("2026-10-14T11:30:00.000Z"), null), { ok: false, status: 503 });
});

await test("the owner's trip, Newark Liberty (EWR) to 19 Coventry Ln, Riverside, CT, 52.5 miles and 64 min: every class adds the Google toll estimate as a Tolls line, with no service fee on it and outside the gratuity, the fare blended between the short and long cards and never below the short card at 50 miles, and the after the ride note drops tolls", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  assert.deepEqual(trip.legs.map((leg) => leg.ride), [{ tenths: 525, minutes: 64, tolls: 2250 }]);
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", 25876], ["Service fee", 3105], ["Tolls", 2250]]);
  assert.deepEqual([price.fare, price.fee, price.tolls, price.estimate, price.total, price.service], [25876, 3105, 2250, 2250, 31231, "distance"]);
  assert.equal(price.fare, Math.round(26450 + ((20705 - 26450) * (525 - 500)) / 250), "a tenth of the way from the short card at 50 miles to the long card at 75 miles");
  assert.deepEqual(price.notes, [POLICY.later.waiting]);
  assert.equal(POLICY.later.waiting, "Extra waiting and parking are charged to your card after the ride.");
  const totals = [];
  for (const cls of CLASSES) {
    const p = (await priced({ ...OWNER, class: cls, passengers: "2" })).price;
    const f = fare(cls, 525, 64);
    assert.deepEqual([p.fare, p.fee, p.tolls, p.total], [f, feeOf(f), 2250, f + feeOf(f) + 2250], cls);
    totals.push(p.total);
  }
  assert.deepEqual(totals, [38829, 45224, 50114, 31231, 44344, 73882]);
  assert.deepEqual([fare("suv", 525, 64), fare("premium", 525, 64)], [8500 + 20000 + 64 * 65, 9500 + 23750 + 64 * 80], "the Business SUV and Business Premium SUV never fall below their short card at 50 miles");
  const tipped = (await priced({ ...OWNER, tip: "20" })).price;
  assert.deepEqual([tipped.tip, tipped.value, tipped.total], [percentCents(25876, "20"), 25876, 31231 + 5175]);
});

await test("tolls carry no service fee: a New York trip with tolls pays the 12% service fee on the fare only, and the gratuity is on the fare only", () => {
  const ride = { tenths: 142, minutes: 35, tolls: 750 };
  const p = priceRide("suv", ride);
  const f = distanceFare("suv", 142, 35);
  assert.equal(f, 16455);
  assert.deepEqual(p, { fare: f, fee: feeOf(f), tolls: 750, total: f + feeOf(f) + 750 });
  assert.deepEqual(priceRide("suv", { tenths: 142, minutes: 35 }).tolls, 0);
  const trip = { trip_type: "one", class: "suv", tip: 15, passengers: "2", legs: [{ from: "manhattan", to: "staten-island", airport: "", direction: "", back: false, reason: "", salesTax: { area: "3630", percent: "8.875" }, ride }] };
  const price = priceTrip(trip);
  assert.deepEqual([price.fee, price.tolls, price.tip, price.value, price.estimate], [1975, 750, percentCents(f, "15"), f, 750]);
  assert.deepEqual(pairs(price.lines), [["Fare", f], [LABELS.fee, 1975], [LABELS.tolls, 750], [LABELS.gratuity.replace("{rate}", "15"), percentCents(f, "15")]]);
  assert.deepEqual(price.notes, [POLICY.later.distance]);
  assert.equal(POLICY.later.distance, "Parking is charged to your card after the ride.");
});

await test("Stripe: the line items carry Tolls, the Checkout text says only extra waiting and parking come after the ride, the metadata adds tolls_est_cents, and the receipt rebuilds the same lines and notes", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  const { metadata, items, submit } = built(trip, price);
  assert.deepEqual(items, [["Fare", 25876], ["Service fee", 3105], ["Tolls", 2250]]);
  assert.equal(submit, CHECKOUT.submitOutsideTolled);
  assert.equal(CHECKOUT.submitOutsideTolled, "You pay the total shown today. Extra waiting and parking are charged to this card after the ride, with a receipt.");
  assert.deepEqual([metadata.service, metadata.tolls_cents, metadata.tolls_est_cents, metadata.total_cents, metadata.miles, metadata.minutes], ["distance", "2250", "2250", "31231", "52.5", "64"]);
  assert.deepEqual([metadata.tax_cents, metadata.bcf_cents], ["3105", undefined]);
  const rebuilt = receipt(metadata, ON);
  assert.deepEqual(shownLines(rebuilt.lines).map(({ label, cents }) => [label, cents]), items);
  assert.deepEqual(rebuilt.notes, price.notes);
  assert.equal(rebuilt.summary, "Wed, Oct 14, 2026, 7:30 AM. Executive Sedan, 52.5 miles and 64 min.");
  assert.equal(rebuilt.value, 25876);
});

await test("emails and the calendar: both letters list Tolls with the paid total and the new note, and the calendar event keeps the drive time of the ride", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  const { metadata } = built(trip, price);
  const letters = bookingLetters(session(metadata), { owners: ["owner@example.com"] }, NOW.getTime());
  assert.deepEqual(letters.map((l) => l.kind), ["customer", "owner"]);
  for (const letter of letters) {
    const text = letter.text.split("\n");
    const at = text.indexOf("Fare: $258.76");
    assert.deepEqual(text.slice(at, at + 6), ["Fare: $258.76", "Service fee: $31.05", "Tolls: $22.50", "Paid: $312.31", "", POLICY.later.waiting], letter.kind);
    assert.ok(!letter.text.includes(POLICY.later.outside), letter.kind);
    assert.ok(letter.html.includes("Tolls") && letter.html.includes("$22.50"), letter.kind);
  }
  const events = bookingEvents(session(metadata));
  assert.equal(events.length, 1);
  assert.equal((new Date(events[0].end.dateTime) - new Date(events[0].start.dateTime)) / 60000, 64);
  assert.ok(events[0].description.includes("Paid: $312.31"));
  assert.ok(!/\btax|Black Car Fund/i.test(events[0].description));
});

await test("round trip: each direction is estimated on its own route, $22.50 out over the George Washington Bridge and $5.71 back, one Tolls line of $28.21, and the metadata, receipt and calendar keep both rides", async () => {
  mock();
  const { trip, price } = await priced({ ...OWNER, ...BACK });
  assert.deepEqual(trip.legs.map((leg) => [leg.back, leg.ride]), [[false, { tenths: 525, minutes: 64, tolls: 2250 }], [true, { tenths: 529, minutes: 70, tolls: 571 }]]);
  assert.deepEqual(price.legs.map((leg) => leg.tolls), [2250, 571]);
  const f = fare("sedan", 525, 64) + fare("sedan", 529, 70);
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", f], ["Service fee", feeOf(fare("sedan", 525, 64)) + feeOf(fare("sedan", 529, 70))], ["Tolls", 2821]]);
  assert.deepEqual([f, price.fee], [25876 + 26186, 3105 + 3142]);
  assert.deepEqual([price.estimate, price.notes], [2821, [POLICY.later.waiting]]);
  const { metadata, items, submit } = built(trip, price);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, metadata.legs, submit], ["2821", "2821", "2", CHECKOUT.submitOutsideTolled]);
  const rebuilt = receipt(metadata, ON);
  assert.deepEqual(shownLines(rebuilt.lines).map(({ label, cents }) => [label, cents]), items);
  assert.deepEqual(rebuilt.notes, [POLICY.later.waiting]);
  assert.equal(rebuilt.summary, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. Executive Sedan, 2 rides, 105.4 miles and 134 min.");
  const events = bookingEvents(session(metadata));
  assert.deepEqual(events.map((event) => (new Date(event.end.dateTime) - new Date(event.start.dateTime)) / 60000), [67, 67]);
});

await test("round trip with a flat airport return: the ride out by distance adds its toll estimate to the flat return's tolls and airport fees, the notes and Checkout text say tolls and airport fees are included, and the receipt still finds the flat return", async () => {
  mock();
  const fields = { ...OWNER, stop1_text: STEAMBOAT, to_text: MANHATTAN, ...BACK };
  const { trip, price } = await priced(fields);
  assert.deepEqual(trip.legs.map((leg) => [leg.back, Boolean(leg.flat), leg.ride && leg.ride.tolls]), [[false, false, 2250], [true, true, undefined]]);
  const flatReturn = AIRPORT_TOTALS.sedan.ewr - 14036 - feeOf(14036);
  assert.equal(flatReturn, 2280);
  assert.deepEqual([price.tolls, price.estimate, price.service], [2250 + flatReturn, 2250, "distance"]);
  assert.deepEqual(price.notes, [NOTES.flatTolled, POLICY.later.waiting]);
  assert.equal(NOTES.flatTolled, "Tolls and airport fees are included.");
  const { metadata, items, submit } = built(trip, price);
  assert.equal(submit, CHECKOUT.submitFlatTolled);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents], [String(2250 + flatReturn), "2250"]);
  const rebuilt = receipt(metadata, ON);
  assert.deepEqual(shownLines(rebuilt.lines).map(({ label, cents }) => [label, cents]), items);
  assert.deepEqual(rebuilt.notes, price.notes);
  assert.ok(rebuilt.summary.endsWith("return at the flat airport rate."), rebuilt.summary);
  const events = bookingEvents(session(metadata));
  assert.equal((new Date(events[0].end.dateTime) - new Date(events[0].start.dateTime)) / 60000, Number(metadata.minutes));
});

await test("stops: the whole route with its stop is estimated, the stop rule compares like for like with tolls on both sides, and the trip pays the tolls of the route the car drives", async () => {
  mock();
  const fields = { ...OWNER, stop1_text: STEAMBOAT };
  const { trip, price } = await priced(fields);
  assert.deepEqual([trip.legs[0].ride, trip.legs[0].plain.ride], [{ tenths: 551, minutes: 72, tolls: 2250 }, { tenths: 525, minutes: 64, tolls: 2250 }]);
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", 25876], ["Service fee", 3105], ["Tolls", 2250], ["Extra stop", STOP_FEE_CENTS]]);
  assert.equal(price.total, 25876 + 3105 + 2250 + STOP_FEE_CENTS);
  assert.ok(price.total > priceRide("sedan", { tenths: 551, minutes: 72, tolls: 2250 }, ["ewr"]).total);
  assert.equal(serviceLabel(trip), "Executive Sedan, 55.1 miles and 72 min");
  const sprinter = (await priced({ ...fields, class: "sprinter", passengers: "2" })).price;
  const whole = fare("sprinter", 551, 72);
  assert.deepEqual([sprinter.fare, sprinter.tolls, sprinter.stops, sprinter.total], [whole, 2250, 0, whole + feeOf(whole) + 2250]);
  const { metadata, items } = built(trip, price);
  assert.deepEqual([metadata.tolls_est_cents, metadata.stops_cents], ["2250", String(STOP_FEE_CENTS)]);
  assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
});

await test("stops with a flat airport part: the flat side drops its own tolls and airport fees and takes the whole route's toll estimate, so the choice is the same with $0, $15 or no toll price", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  let advisory = {};
  let [duration, meters] = ["4200s", 32187];
  globalThis.fetch = async () => new Response(JSON.stringify({ routes: [{ duration, distanceMeters: meters, ...advisory }] }), { status: 200 });
  const fields = { trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", stop2_text: "40 Wall St, New York, NY 10005", to_text: "55 Church St, New York, NY 10007", date: "2026-10-14", time: "10:00", passengers: "2", class: "premium", action: "pay" };
  const flat = AIRPORT_TOTALS.premium.lga + 2 * STOP_FEE_CENTS;
  const whole = priceRide("premium", { tenths: 200, minutes: 70 }, ["lga"]).total;
  assert.deepEqual([flat, whole], [23000, 26656]);
  assert.deepEqual([(await priced(fields)).price.total, (await priced(fields)).price.service, (await priced(fields)).price.tolls], [whole, "distance", 0]);
  advisory = tolled(money("15", 0));
  const known = (await priced({ ...fields, date: "2026-10-15" })).price;
  assert.deepEqual([known.total, known.service, known.tolls, known.stops], [whole + 1500, "distance", 1500, 0]);
  advisory = { travelAdvisory: { tollInfo: {} } };
  const unknown = (await priced({ ...fields, date: "2026-10-16" })).price;
  assert.deepEqual([unknown.total, unknown.service, unknown.tolls, unknown.estimate], [whole, "distance", 0, null]);
  [duration, meters] = ["600s", 3219];
  const short = [];
  for (const [day, toll] of [["17", {}], ["18", tolled(money("15", 0))], ["19", { travelAdvisory: { tollInfo: {} } }]]) {
    advisory = toll;
    const { price } = await priced({ ...fields, date: `2026-10-${day}` });
    short.push([price.total, price.service, price.tolls, price.stops]);
  }
  assert.deepEqual(short, Array(3).fill([flat, "airport", AIRPORT_TOTALS.premium.lga - 15825 - feeOf(15825), 2 * STOP_FEE_CENTS]));
});

await test("booking asks Google for tolls only on rides it prices by distance: the no-stop comparison ride and a flat return are routed without tolls", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ routes: [{ duration: "4320s", distanceMeters: 88675, ...tolled(money("22", 500000000)) }] }), { status: 200 }));
  const asked = () => sent.splice(0).map((body) => [body.intermediates.length, body.extraComputations || null, "routeModifiers" in body]).sort((a, b) => b[0] - a[0] || String(a[1]).localeCompare(String(b[1])));
  const alone = await priced({ ...OWNER, stop1_text: STEAMBOAT, date: "2026-10-22" });
  assert.deepEqual([alone.trip.legs[0].ride.tolls, alone.trip.legs[0].plain.ride.tolls, alone.price.tolls], [2250, 2250, 2250]);
  assert.deepEqual(asked(), [[1, ["TOLLS"], true], [0, null, false]]);
  const flat = await priced({ ...OWNER, stop1_text: STEAMBOAT, to_text: MANHATTAN, ...BACK, date: "2026-10-23", return_date: "2026-10-24" });
  assert.deepEqual(flat.trip.legs.map((leg) => [Boolean(leg.flat), leg.ride.tolls]), [[false, 2250], [true, undefined]]);
  assert.equal(flat.price.estimate, 2250);
  assert.deepEqual(asked(), [[1, ["TOLLS"], true], [0, null, false]]);
});

await test("Google says the route has tolls but gives no price: no Tolls line, today's after the ride note and Checkout text, no tolls_est_cents, and the receipt keeps today's note", async () => {
  mock();
  const { trip, price } = await priced({ ...OWNER, from_text: MANHATTAN, from_id: "", to_text: GREENWICH });
  assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate, tollsIn(trip)], [{ tenths: 314, minutes: 52 }, 0, null, false]);
  assert.deepEqual(shownLines(price.lines).map(({ label }) => label), ["Fare", "Service fee"]);
  assert.deepEqual(price.notes, [POLICY.later.hourly]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, "tolls_est_cents" in metadata, metadata.tolls_cents], [CHECKOUT.submitDistance, false, "0"]);
  assert.deepEqual(receipt(metadata, ON).notes, [POLICY.later.hourly]);
  const airport = await priced({ ...OWNER, to_text: "1 Ocean Rd, Montauk, NY 11954" });
  assert.deepEqual([airport.price.tolls, airport.price.notes, built(airport.trip, airport.price).submit], [0, [POLICY.later.outside], CHECKOUT.submitOutside]);
});

await test("the route has no tolls: no Tolls line, the after the ride note and the Checkout text leave tolls out, and tolls_est_cents is 0", async () => {
  mock();
  const { trip, price } = await priced({ ...OWNER, from_text: STEAMBOAT, from_id: "" });
  assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate], [{ tenths: 32, minutes: 9, tolls: 0 }, 0, 0]);
  assert.deepEqual(shownLines(price.lines).map(({ label }) => label), ["Fare", "Service fee"]);
  assert.deepEqual(price.notes, [POLICY.later.distance]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, metadata.tolls_est_cents, metadata.tolls_cents], [CHECKOUT.submitDistanceTolled, "0", "0"]);
  assert.equal(CHECKOUT.submitDistanceTolled, "You pay the total shown today. Parking is charged to this card after the ride, with a receipt.");
  assert.deepEqual(receipt(metadata, ON).notes, [POLICY.later.distance]);
  for (const note of [POLICY.later.distance, POLICY.later.waiting, NOTES.flatTolled, CHECKOUT.submitDistanceTolled, CHECKOUT.submitOutsideTolled, CHECKOUT.submitFlatTolled]) {
    assert.doesNotMatch(note, /[–—;]/);
    assert.deepEqual(note.split(". ").filter((part) => part.includes("after the ride") && /toll/i.test(part)), [], note);
  }
});

await test("a round trip with one direction priced and the other without a toll price keeps today's behavior for the whole trip", async () => {
  mock();
  const { trip, price } = await priced({ ...OWNER, from_text: STEAMBOAT, from_id: "", ...BACK });
  assert.deepEqual(trip.legs.map((leg) => leg.ride), [{ tenths: 32, minutes: 9 }, { tenths: 33, minutes: 9 }]);
  assert.deepEqual([tollsIn(trip), price.tolls, price.estimate, price.notes, shownLines(price.lines).map((l) => l.label)], [false, 0, null, [POLICY.later.hourly], ["Fare", "Service fee"]]);
});

await test("a Google failure keeps today's behavior: no route, no price, and a signed route from before tolls were estimated prices with no Tolls line", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  const down = await run({ ...OWNER, date: "2026-10-20" });
  assert.equal(down.check.kind, "quote");
  const old = signRoute([[routeKey({ address: EWR_ADDRESS }, { address: RIVERSIDE }, new Date("2026-10-21T11:30:00.000Z").toISOString()), 525, 64]], NOW.getTime());
  const { trip, price } = await priced({ ...OWNER, date: "2026-10-21", route: old });
  assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate, price.notes], [{ tenths: 525, minutes: 64 }, 0, null, [POLICY.later.outside]]);
});

await test("tamper: the toll estimate rides in the signed route token, a changed token is ignored and priced from Google again, and a toll amount posted by the browser is never read", async () => {
  mock();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 5 * 86400000));
  const res = await routePost(new Request(`${SITE}/api/route`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ from: { id: "ewr" }, to: { text: RIVERSIDE }, date, time: "07:30", draw: 1 }) }));
  const body = await res.json();
  assert.deepEqual([body.kind, body.minutes, body.miles], ["ok", 64, 52.5]);
  assert.match(body.route, ROUTE);
  const now = Date.now();
  const [ride] = [...readRoute(body.route, now).values()];
  assert.deepEqual([ride.tenths, ride.minutes, ride.tolls], [525, 64, 2250]);
  const [, payload, mac] = body.route.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const changed = `r1.${Buffer.from(JSON.stringify({ ...data, l: [[data.l[0][0], 525, 64, 0]] })).toString("base64url")}.${mac}`;
  assert.equal(readRoute(changed, now).size, 0);
  const fields = { ...OWNER, date, route: changed, tolls: "0", tolls_cents: "0", tolls_est_cents: "0" };
  assert.equal((await priced(fields, new Date(now))).price.tolls, 2250);
  const resigned = signRoute([[data.l[0][0], 525, 64, 1999]], now);
  assert.equal((await priced({ ...fields, route: resigned }, new Date(now))).price.tolls, 1999, "a token the server signed is the server's own estimate");
  const options = await bookPost(new Request(`${SITE}/api/book`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: SITE, "sec-fetch-site": "same-origin" }, body: JSON.stringify({ ...fields, route: changed, action: "options", nonce: "nonce-tolls-tamper-0001" }) }));
  const answer = await options.json();
  assert.deepEqual(answer.price.lines.map(({ label, cents }) => [label, cents]), [["Fare", 25876], ["Service fee", 3105], ["Tolls", 2250]]);
  assert.deepEqual([answer.price.total_cents, answer.price.notes, answer.classes.map((c) => c.total_cents)], [31231, [POLICY.later.waiting], [38829, 45224, 50114, 31231, 44344, null]]);
  assert.match(answer.route, ROUTE);
});

await test("the Luxury Sprinter pays the same toll estimate as every class", async () => {
  mock();
  const { price } = await priced({ ...OWNER, class: "sprinter", passengers: "9" });
  assert.deepEqual([price.tolls, shownLines(price.lines).find((l) => l.label === "Tolls").cents, price.total], [2250, 2250, 73882]);
});

await test("hourly is unaffected: no Tolls line, tolls still charged after the ride, no tolls_est_cents, and Google is never asked", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  let asked = 0;
  globalThis.fetch = async () => (asked++, new Response("{}", { status: 503 }));
  const { trip, price } = await priced({ trip_type: "hour", from_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "2", hours: "3", class: "sedan", action: "pay", ...ME });
  assert.deepEqual([price.tolls, price.estimate, price.notes, shownLines(price.lines).map((l) => l.label)], [0, null, [POLICY.later.hourly], ["Fare, 3 hours", "Service fee"]]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, "tolls_est_cents" in metadata, receipt(metadata, ON).notes, asked], [CHECKOUT.submitHourly, false, [POLICY.later.hourly], 0]);
});

await test("flat airport transfers are unaffected: Manhattan to Newark keeps its fixed tolls and airport fees, its notes and Checkout text, and Google is never asked", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  let asked = 0;
  globalThis.fetch = async () => (asked++, new Response("{}", { status: 503 }));
  const { trip, price } = await priced({ ...OWNER, from_text: MANHATTAN, from_id: "", to_text: "Newark Liberty (EWR)", to_id: "ewr", class: "suv" });
  assert.deepEqual([price.service, price.total, price.tolls, price.estimate, price.notes], ["airport", AIRPORT_TOTALS.suv.ewr, 2280, null, [NOTES.included, POLICY.later.airport]]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, "tolls_est_cents" in metadata, metadata.tolls_cents, receipt(metadata, ON).notes, asked], [CHECKOUT.submit, false, "2280", [NOTES.included, POLICY.later.airport], 0]);
});

await test("laterNotes picks one note set per service, flat part and toll estimate", () => {
  assert.deepEqual(laterNotes("hourly", "", false, true), [POLICY.later.hourly]);
  assert.deepEqual(laterNotes("airport", "", true, true), [NOTES.included, POLICY.later.airport]);
  assert.deepEqual(laterNotes("distance", "return", true, false), [NOTES.returnFlat, POLICY.later.returnFlat]);
  assert.deepEqual(laterNotes("distance", "out", true, false), [NOTES.outFlat, POLICY.later.outFlat]);
  assert.deepEqual(laterNotes("distance", "return", true, true), [NOTES.flatTolled, POLICY.later.waiting]);
  assert.deepEqual(laterNotes("distance", "", true, false), [POLICY.later.outside]);
  assert.deepEqual(laterNotes("distance", "", true, true), [POLICY.later.waiting]);
  assert.deepEqual(laterNotes("distance", "", false, false), [POLICY.later.hourly]);
  assert.deepEqual(laterNotes("distance", "", false, true), [POLICY.later.distance]);
});

await test("metadata: tolls_est_cents is the only new key, written only when the tolls are estimated, and bookingData passes it through", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  const meta = metadataFor(trip, price, "48213590");
  const without = metadataFor(trip, { ...price, estimate: null }, "48213590");
  assert.deepEqual(Object.keys(meta).filter((key) => !(key in without)), ["tolls_est_cents"]);
  assert.equal(bookingData(meta).tolls_est_cents, "2250");
});

const LATER = new Date("2026-11-01T16:00:00.000Z");
const WEEKDAY = { ...OWNER, date: "2026-11-09", time: "14:00" };
const HOME = { return: "1", return_date: "2026-11-13", return_time: "18:00" };
const OWNER_ENDS = [{ address: EWR_ADDRESS }, { address: RIVERSIDE }];
const SPLIT_MASK = "routes.distanceMeters,routes.legs.distanceMeters,routes.legs.duration,routes.legs.travelAdvisory.tollInfo";
const ownerPath = () => {
  const saved = process.env.GOOGLE_MOCK;
  process.env.GOOGLE_MOCK = "true";
  const route = mockRoute(null, OWNER_ENDS, nycToUtc("2026-11-09", "14:00"));
  process.env.GOOGLE_MOCK = saved;
  return route;
};
const leg = (seconds, meters, advisory = {}) => ({ duration: `${seconds}s`, distanceMeters: meters, ...advisory });
const SPLIT_LEGS = [leg(2030, 36182, { travelAdvisory: { tollInfo: {} } }), leg(2710, 48308, tolled(money("3", 420000000)))];

function googleAnswers({ first = {}, legs = SPLIT_LEGS, total, status = 200, thrown = false } = {}) {
  const sent = [];
  const path = ownerPath();
  const latLng = ([latitude, longitude]) => ({ latLng: { latitude, longitude } });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const split = body.intermediates.some((item) => item.location);
    sent.push({ body, mask: init.headers["X-Goog-FieldMask"], split });
    if (split && thrown) throw new Error("network");
    if (split && status !== 200) return new Response("{}", { status });
    const routes = split ? [{ distanceMeters: total === undefined ? legs.reduce((sum, item) => sum + item.distanceMeters, 0) : total, legs }] : [{ duration: "4740s", distanceMeters: 84490, polyline: { encodedPolyline: path.polyline }, legs: [{ startLocation: latLng(path.points[0]), endLocation: latLng(path.points[1]) }], travelAdvisory: { tollInfo: {} }, ...first }];
    return new Response(JSON.stringify({ routes }), { status: 200 });
  };
  return sent;
}

function logged(fn) {
  const lines = [];
  const before = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  return Promise.resolve(fn()).then((value) => ({ value, lines }), (err) => Promise.reject(err)).finally(() => (console.error = before));
}

await test("the toll table in api/_rates.mjs: Port Authority E-ZPass by vehicle class, $14.79 off-peak and $16.79 peak for Class 1, peak on weekdays 6 to 10 AM and 4 to 8 PM and on weekends 11 AM to 9 PM, the NJ Turnpike E-ZPass rates between interchanges 13, 13A, 14, 18E and 18W, and every car class is Class 1", () => {
  assert.deepEqual(PA_TOLLS, { 1: { offPeak: 1479, peak: 1679 }, 2: { offPeak: 4334, peak: 4534 }, "8A": { offPeak: 1680, peak: 2100 } });
  assert.deepEqual(PA_PEAK, { weekday: [[360, 600], [960, 1200]], weekend: [[660, 1260]] });
  assert.deepEqual([NJTP_TOLLS[1][14]["18E"], NJTP_TOLLS[1][14]["18W"], NJTP_TOLLS[1]["18E"][14], NJTP_TOLLS[1]["18W"][14], NJTP_TOLLS[1]["13A"]["18E"], NJTP_TOLLS[1]["13A"][13], NJTP_TOLLS[1][13][14]], [571, 571, 571, 571, 750, 141, 229]);
  for (const [from, row] of Object.entries(NJTP_TOLLS[1])) for (const [to, cents] of Object.entries(row)) assert.equal(NJTP_TOLLS[1][to][from], cents, `${from} ${to}`);
  const at = (date, time) => crossingCents(nycToUtc(date, time));
  const monday = ["05:59", "06:00", "09:59", "10:00", "14:00", "15:59", "16:00", "19:59", "20:00"].map((time) => at("2026-11-09", time));
  assert.deepEqual(monday, [1479, 1679, 1679, 1479, 1479, 1479, 1679, 1679, 1479]);
  assert.deepEqual(["10:59", "11:00", "14:00", "20:59", "21:00"].map((time) => at("2026-11-14", time)), [1479, 1679, 1679, 1679, 1479]);
  assert.deepEqual([at("2026-11-15", "14:00"), at("2026-11-13", "07:00"), at("2026-11-13", "12:00")], [1679, 1679, 1479]);
  assert.deepEqual([crossingCents(nycToUtc("2026-11-09", "08:00"), "2"), crossingCents(nycToUtc("2026-11-09", "14:00"), "2"), crossingCents(nycToUtc("2026-11-09", "17:00"), "8A"), crossingCents(nycToUtc("2026-11-09", "14:00"), "8A")], [4534, 4334, 2100, 1680]);
  assert.deepEqual([TOLL_CLASS, TOLL_GROUP], [{ suv: "1", premium: "1", first: "1", sedan: "1", electric: "1", sprinter: "1" }, "1"]);
  assert.throws(() => tollClassOf({ ...TOLL_CLASS, sprinter: "2" }), /toll-config/);
  assert.throws(() => tollClassOf({ suv: "3", premium: "3", first: "3", sedan: "3", electric: "3", sprinter: "3" }), /toll-config/);
});

await test("the fallback finds the table tolls on the route Google drew: Newark Liberty to 19 Coventry Ln enters the Turnpike at 14, leaves at 18E and crosses the George Washington Bridge into New York, all in one part from the airport to past the bridge, the way back pays only the Turnpike, a ride that leaves the Turnpike at an exit with no table entry or a stop on the bridge is never split", () => {
  const out = decodePath(ownerPath().polyline);
  const arcs = arcsOf(out);
  const at = (meters) => arcs.findIndex((item) => item >= meters);
  const plan = tollPlan(out, []);
  assert.deepEqual(plan.legs, [{ tolls: [{ kind: "njtp", id: "14-18E", share: 0.13, cents: 571 }, { kind: "pa", id: "gwb", share: 0.944 }] }, null]);
  assert.deepEqual(plan.marks, [{ cut: { latitude: 40.849269, longitude: -73.941172, heading: 107 } }]);
  const back = tollPlan([...out].reverse(), []);
  assert.deepEqual(back.legs, [null, { tolls: [{ kind: "njtp", id: "18E-14", share: 0.084, cents: 571 }] }]);
  assert.deepEqual(back.marks, [{ cut: { latitude: 40.828984, longitude: -74.024671, heading: 212 } }]);
  assert.deepEqual(tollPlan(out.slice(0, at(12000)), []), { reason: "turnpike" });
  assert.deepEqual(tollPlan(out.slice(at(25000)), []).legs, [null, { tolls: [{ kind: "pa", id: "gwb", share: 0.2 }] }, null]);
  assert.deepEqual(tollPlan(out.slice(at(37000)), []), { reason: "none" });
  assert.deepEqual(tollPlan(out, [[40.70376, -74.18322]]).legs, [null, { tolls: [{ kind: "njtp", id: "14-18E", share: 0.082, cents: 571 }, { kind: "pa", id: "gwb", share: 0.941 }] }, null]);
  assert.deepEqual(tollPlan(out, [[40.85178, -73.95432]]), { reason: "stop" });
  assert.deepEqual(tollPlan(out, [[40.75627, -74.10352]]), { reason: "turnpike" });
  assert.deepEqual(tollPlan([], []), { reason: "none" });
  assert.deepEqual(decodePath("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.deepEqual([decodePath("_p~iF~ps|U_"), decodePath(null)], [[], []]);
});

await test("the owner's trip on a weekday at 2:00 PM, Newark Liberty to 19 Coventry Ln over the George Washington Bridge, where Google gives tolls with no price: before, no Tolls line and tolls after the ride, now the bridge at the off-peak $14.79 plus the NJ Turnpike from 14 to 18E at $5.71 and the $1.74 Google prices on I-95 in New York, Tolls $22.24 the same in every class, and Stripe, the receipt and the metadata keys work as for a Google price", async () => {
  mock();
  const first = mockRoute(null, OWNER_ENDS, nycToUtc("2026-11-09", "14:00"));
  assert.deepEqual([first.minutes, first.miles, tollCents(first)], [79, 52.5, null]);
  const { trip, price } = await priced(WEEKDAY, LATER);
  assert.deepEqual(trip.legs.map((item) => item.ride), [{ tenths: 525, minutes: 79, tolls: 2224 }]);
  const f = fare("sedan", 525, 79);
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", f], ["Service fee", feeOf(f)], ["Tolls", 2224]]);
  assert.equal(f, 26581);
  assert.deepEqual([price.tolls, price.estimate, price.notes], [2224, 2224, [POLICY.later.waiting]]);
  const totals = [];
  for (const cls of CLASSES) {
    const p = (await priced({ ...WEEKDAY, class: cls }, LATER)).price;
    const cf = fare(cls, 525, 79);
    assert.deepEqual([p.fare, p.tolls, p.total], [cf, 2224, cf + feeOf(cf) + 2224], cls);
    totals.push(p.total);
  }
  assert.deepEqual(totals, [39895, 46542, 51508, 31995, 45484, 76269]);
  const { metadata, items, submit } = built(trip, price);
  assert.deepEqual([items.at(-1), submit, metadata.tolls_cents, metadata.tolls_est_cents, metadata.miles, metadata.minutes], [["Tolls", 2224], CHECKOUT.submitOutsideTolled, "2224", "2224", "52.5", "79"]);
  assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
  const google = await priced(OWNER);
  assert.deepEqual(Object.keys(metadata).sort(), Object.keys(built(google.trip, google.price).metadata).sort());
});

await test("peak or off-peak at the time the car reaches the bridge: a Monday pickup at 7:30 AM, 3:40 PM or 5:40 AM crosses in the peak at $16.79, at 3:20 PM, 9:40 AM or 9:00 PM off-peak at $14.79, and a Saturday at 2:00 PM in the weekend peak, the Turnpike part is $5.71 and I-95 in New York $1.74 at any hour", async () => {
  mock();
  const tolls = [];
  for (const [date, time] of [["2026-11-09", "07:30"], ["2026-11-09", "15:40"], ["2026-11-09", "05:40"], ["2026-11-09", "15:20"], ["2026-11-09", "09:40"], ["2026-11-09", "21:00"], ["2026-11-14", "14:00"], ["2026-11-15", "08:00"]]) tolls.push((await priced({ ...WEEKDAY, date, time }, LATER)).trip.legs[0].ride.tolls);
  assert.deepEqual(tolls, [2424, 2424, 2424, 2224, 2224, 2224, 2424, 2224]);
});

await test("each direction of a round trip on its own: the ride out pays the bridge and the Turnpike, the way back into New Jersey pays the Turnpike from 18W to 14 plus the return crossing over the bridge at the peak $16.79 for the Friday 7:21 PM drop-off, one Tolls line of $44.74, and the metadata and receipt keep it", async () => {
  mock();
  const back = await priced({ ...WEEKDAY, from_text: RIVERSIDE, from_id: "", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-13", time: "18:00" }, LATER);
  assert.deepEqual(back.trip.legs.map((item) => item.ride), [{ tenths: 509, minutes: 81, tolls: 2250 }]);
  const { trip, price } = await priced({ ...WEEKDAY, ...HOME }, LATER);
  assert.deepEqual(trip.legs.map((item) => [item.back, item.ride.tolls]), [[false, 2224], [true, 2250]]);
  assert.deepEqual([price.tolls, price.estimate, shownLines(price.lines).find((item) => item.label === "Tolls").cents, price.notes], [4474, 4474, 4474, [POLICY.later.waiting]]);
  const { metadata, items } = built(trip, price);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, metadata.legs], ["4474", "4474", "2"]);
  assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
});

await test("stops: a stop at 1 Steamboat Rd on the owner's weekday trip keeps the bridge and the Turnpike on the whole route, Tolls $22.24, and the Luxury Sprinter pays the same tolls as every class", async () => {
  mock();
  const { trip, price } = await priced({ ...WEEKDAY, stop1_text: STEAMBOAT }, LATER);
  assert.deepEqual([trip.legs[0].ride, trip.legs[0].stops, price.tolls, price.estimate], [{ tenths: 551, minutes: 87, tolls: 2224 }, 1, 2224, 2224]);
  assert.ok(shownLines(price.lines).some((item) => item.label === "Tolls" && item.cents === 2224));
  const sprinter = (await priced({ ...WEEKDAY, class: "sprinter", passengers: "9" }, LATER)).price;
  assert.deepEqual([sprinter.tolls, shownLines(sprinter.lines).find((item) => item.label === "Tolls").cents], [2224, 2224]);
});

await test("the Routes request of the fallback: only when Google gives tolls with no price and the route crosses a table toll, one more computeRoutes with the same origin, destination, departure, passes and toll request, a waypoint with a heading just before and after each table toll, the leg toll field mask, Google's prices for the other parts and the table for the bridge and the Turnpike", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const departure = nycToUtc("2026-11-09", "14:00");
  let sent = googleAnswers();
  const result = await computeRoute(OWNER_ENDS, departure, null);
  assert.deepEqual([result.ok, result.minutes, result.miles, result.tolls], [true, 79, 52.5, 571 + 1479 + 342]);
  assert.deepEqual(sent.map((item) => [item.split, item.mask]), [[false, "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation,routes.travelAdvisory.tollInfo,routes.legs.travelAdvisory.tollInfo"], [true, SPLIT_MASK]]);
  const [{ body: firstBody }, { body }] = sent;
  assert.deepEqual(Object.keys(body), Object.keys(firstBody));
  for (const key of ["origin", "destination", "travelMode", "routingPreference", "departureTime", "languageCode", "units", "extraComputations", "routeModifiers"]) assert.deepEqual(body[key], firstBody[key], key);
  assert.deepEqual(firstBody.intermediates, []);
  assert.equal(body.intermediates.length, 1);
  for (const item of body.intermediates) assert.deepEqual(Object.keys(item.location).sort(), ["heading", "latLng"]);
  sent = googleAnswers({ first: { travelAdvisory: { tollInfo: { estimatedPrice: [money("14", 790000000)] } } } });
  assert.equal((await computeRoute(OWNER_ENDS, departure, null)).tolls, 1479);
  assert.equal(sent.length, 1);
  sent = googleAnswers({ first: { polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } } });
  assert.equal((await computeRoute(OWNER_ENDS, departure, null)).tolls, null);
  assert.equal(sent.length, 1);
  sent = googleAnswers();
  assert.equal((await computeRoute(OWNER_ENDS, departure, null, false)).tolls, undefined);
  assert.equal(sent.length, 1);
});

await test("the fallback with a stop sends the stop as it was, in its place between the waypoints around the tolls, and prices each leg", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const path = ownerPath();
  const stop = { address: "1 Westchester Ave, Port Chester, NY 10573" };
  const legs = [SPLIT_LEGS[0], leg(1200, 20000), leg(1510, 28308)];
  const sent = googleAnswers({ legs, first: { legs: [{ startLocation: { latLng: { latitude: path.points[0][0], longitude: path.points[0][1] } }, endLocation: { latLng: { latitude: 41.00, longitude: -73.66 } } }, { startLocation: { latLng: { latitude: 41.00, longitude: -73.66 } }, endLocation: { latLng: { latitude: path.points[1][0], longitude: path.points[1][1] } } }] } });
  const result = await computeRoute([OWNER_ENDS[0], stop, OWNER_ENDS[1]], nycToUtc("2026-11-09", "14:00"), null);
  assert.equal(result.tolls, 571 + 1479);
  assert.deepEqual(sent[1].body.intermediates.map((item) => (item.location ? "cut" : item)), ["cut", stop]);
});

await test("when the fallback can not price every part it keeps today's behavior and logs a short reason: a Google error or a dropped call that never marks Google down, a part outside the table with no price, a table toll Google does not see, a detour of more than 2%, a wrong number of legs, and the booking shows no Tolls line and tolls after the ride", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const departure = nycToUtc("2026-11-09", "14:00");
  const cases = [
    [{ status: 503 }, "route-tolls google 503"],
    [{ thrown: true }, "route-tolls google 0"],
    [{ legs: [SPLIT_LEGS[0], leg(2710, 48308, { travelAdvisory: { tollInfo: {} } })] }, "route-tolls unpriced leg 2/2 48308m plan njtp+pa,g"],
    [{ legs: [leg(2030, 36182), SPLIT_LEGS[1]] }, "route-tolls facility"],
    [{ total: Math.round(84490 * 1.03) }, "route-tolls detour"],
    [{ legs: SPLIT_LEGS.slice(0, 1) }, "route-tolls legs"],
    [{ legs: [SPLIT_LEGS[0], { distanceMeters: 48308 }] }, "route-tolls legs"],
  ];
  for (const [answer, line] of cases) {
    googleAnswers(answer);
    const { value, lines } = await logged(() => computeRoute(OWNER_ENDS, departure, null));
    assert.deepEqual([value.ok, value.tolls, lines], [true, null, [line]], line);
    assert.equal(googleUp(), true, line);
  }
  googleAnswers({ status: 503 });
  const { value } = await logged(() => priced({ ...WEEKDAY, date: "2026-11-10" }, LATER));
  const { trip, price } = value;
  assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate, price.notes, shownLines(price.lines).map((item) => item.label)], [{ tenths: 525, minutes: 79 }, 0, null, [POLICY.later.outside], ["Fare", "Service fee"]]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, "tolls_est_cents" in metadata, metadata.tolls_cents], [CHECKOUT.submitOutside, false, "0"]);
});

await test("tamper: the fallback total rides in the signed route token from /api/route, a changed token is ignored and the booking asks Google again, and toll amounts posted by the browser are never read", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 5 * 86400000));
  const departure = nycToUtc(date, "14:00");
  const share = tollPlan(decodePath(ownerPath().polyline), []).legs[0].tolls[1].share;
  const expected = 571 + crossingCents(new Date(departure.getTime() + 2030 * share * 1000)) + 342;
  let sent = googleAnswers();
  const res = await routePost(new Request(`${SITE}/api/route`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ from: { id: "ewr" }, to: { text: RIVERSIDE }, date, time: "14:00", draw: 1 }) }));
  const body = await res.json();
  assert.deepEqual([body.kind, body.minutes, body.miles, sent.length], ["ok", 79, 52.5, 2]);
  const now = Date.now();
  const [ride] = [...readRoute(body.route, now).values()];
  assert.equal(ride.tolls, expected);
  const [, payload, mac] = body.route.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const changed = `r1.${Buffer.from(JSON.stringify({ ...data, l: [[data.l[0][0], 525, 79, 0]] })).toString("base64url")}.${mac}`;
  assert.equal(readRoute(changed, now).size, 0);
  const fields = { ...OWNER, date, time: "14:00", tolls: "0", tolls_cents: "0", tolls_est_cents: "0" };
  sent = googleAnswers();
  assert.equal((await priced({ ...fields, route: changed }, new Date(now))).price.tolls, expected);
  assert.equal(sent.length, 2);
  sent = googleAnswers();
  assert.equal((await priced({ ...fields, route: body.route }, new Date(now))).price.tolls, expected);
  assert.equal(sent.length, 0);
});

await test("the toll table ends on January 1, 2028 New York time: a table toll reached before then is priced, a table toll reached on or after it logs route-tolls stale and keeps today's behavior, so a pickup at 11:20 PM on December 31 is priced and one at 11:30 PM that reaches the bridge after midnight is not", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  assert.equal(TOLL_TABLE_UNTIL, "2028-01-01T00:00:00-05:00");
  assert.equal(Date.parse(TOLL_TABLE_UNTIL), nycToUtc("2028-01-01", "00:00").getTime());
  const cases = [
    [["2027-12-31", "14:00"], 571 + 1479 + 342, []],
    [["2027-12-31", "23:20"], 571 + 1479 + 342, []],
    [["2027-12-31", "23:30"], null, ["route-tolls stale"]],
    [["2027-12-31", "23:50"], null, ["route-tolls stale"]],
    [["2028-01-04", "14:00"], null, ["route-tolls stale"]],
  ];
  for (const [[date, time], tolls, lines] of cases) {
    const sent = googleAnswers();
    const out = await logged(() => computeRoute(OWNER_ENDS, nycToUtc(date, time), null));
    assert.deepEqual([out.value.ok, out.value.tolls, out.lines, sent.length], [true, tolls, lines, 2], `${date} ${time}`);
  }
});

const RICHMOND = "2700 Richmond Ave, Staten Island, NY 10314";
const RICHMOND_ENDS = [{ address: EWR_ADDRESS }, { address: RICHMOND }];
const LIVE_CUTS = {
  owner: [[40.709764, -74.160663, 113], [40.822152, -74.027247, 7], [40.854653, -73.969981, 117], [40.849269, -73.941172, 107]],
  richmond: [[40.67223, -74.185786, 149], [40.642819, -74.210654, 88], [40.638612, -74.203034, 135], [40.627199, -74.181198, 127]],
};
const OLD_PLAN = { legs: [null, { tolls: [{ kind: "njtp", share: 0.5, cents: 571 }] }, null, { tolls: [{ kind: "pa", share: 0.5 }] }, null] };
const splitBody = (ends, departure, cuts) => ({ origin: ends[0], destination: ends[1], departureTime: departure.toISOString(), intermediates: cuts.map(([latitude, longitude, heading]) => ({ location: { latLng: { latitude, longitude }, heading } })) });
const mockLine = (ends, departure) => {
  const saved = process.env.GOOGLE_MOCK;
  process.env.GOOGLE_MOCK = "true";
  const route = mockRoute(null, ends, departure);
  process.env.GOOGLE_MOCK = saved;
  return route;
};

await test("the live route lines of Monday December 7 2026 at 2:00 PM: Newark Liberty to 19 Coventry Ln starts on US 1 and 9 at the airport, passes 57 m from the interchange 14 toll point and never near 13A, and Newark Liberty to 2700 Richmond Ave enters at 13A, leaves at 13 and crosses the Goethals Bridge, the same lines as November 30", () => {
  const owner = mockLine(OWNER_ENDS, nycToUtc("2026-11-09", "14:00"));
  const out = decodePath(owner.polyline);
  const arcs = arcsOf(out);
  assert.deepEqual([out.length, Math.round(arcs.at(-1)), out[0], out.at(-1), owner.miles, owner.minutes], [682, 84435, [40.68881, -74.19111], [41.03234, -73.58183], 52.5, 79]);
  const near = (path, point) => Math.min(...path.slice(1).map((_, i) => project(path, arcsOf(path), point, i + 1).gap));
  assert.ok(near(out, [40.70858, -74.15627]) < 100);
  assert.ok(near(out, [40.66891, -74.18406]) > 2000);
  assert.ok(near(out, [40.64095, -74.20992]) > 5000);
  const richmond = mockLine(RICHMOND_ENDS, nycToUtc("2026-11-09", "14:00"));
  const south = decodePath(richmond.polyline);
  assert.deepEqual([south.length, Math.round(arcsOf(south).at(-1)), south[0], south.at(-1), richmond.miles, richmond.minutes], [238, 19470, [40.69351, -74.18717], [40.5832, -74.16909], 12.1, 23]);
  assert.deepEqual(tollPlan(south, []), { marks: [{ cut: { latitude: 40.627199, longitude: -74.181198, heading: 127 } }], legs: [{ tolls: [{ kind: "njtp", id: "13A-13", share: 0.424, cents: 141 }, { kind: "pa", id: "goethals", share: 0.853 }] }, null] });
});

await test("the live failure: with the waypoints production sent, 400 m before the 14 toll point and around 18E and the bridge, Google's first part from the airport already holds the start of the Turnpike ticket and has tolls with no price, route-tolls unpriced leg 1/5 4275m, and the same cut before 13A fails the Staten Island route", () => {
  const departure = nycToUtc("2026-11-09", "14:00");
  const owner = mockSplit(splitBody(OWNER_ENDS, departure, LIVE_CUTS.owner)).routes[0];
  assert.deepEqual(owner.legs.map((item) => [item.distanceMeters, Boolean(item.travelAdvisory)]), [[4275, true], [18863, true], [10393, false], [2503, true], [48456, true]]);
  assert.deepEqual(owner.legs[0].travelAdvisory, { tollInfo: {} });
  assert.deepEqual(priceSplit(OLD_PLAN, owner, departure, 52.5 * 1609.344), { reason: "unpriced", detail: "leg 1/5 4275m plan g,njtp,g,pa,g" });
  const south = mockSplit(splitBody(RICHMOND_ENDS, departure, LIVE_CUTS.richmond)).routes[0];
  assert.deepEqual(south.legs.map((item) => [item.distanceMeters, Boolean(item.travelAdvisory)]), [[5190, true], [4929, true], [826, false], [2242, true], [6287, false]]);
  assert.deepEqual(priceSplit(OLD_PLAN, south, departure, 12.1 * 1609.344), { reason: "unpriced", detail: "leg 1/5 5190m plan g,njtp,g,pa,g" });
});

await test("the fix keeps each Turnpike ticket in one part: the owner's trip asks Google for two parts, the airport to just past the bridge priced from the table and the rest by Google, Tolls $22.24 on Monday at 2:00 PM and $24.24 at 3:40 PM when the car reaches the bridge in the peak, with no log line", async () => {
  mock();
  for (const [time, tolls] of [["14:00", 2224], ["15:40", 2424], ["07:30", 2424], ["21:00", 2224]]) {
    const departure = nycToUtc("2026-11-09", time);
    const plan = tollPlan(decodePath(mockLine(OWNER_ENDS, departure).polyline), []);
    const route = mockSplit(splitBody(OWNER_ENDS, departure, plan.marks.map(({ cut }) => [cut.latitude, cut.longitude, cut.heading]))).routes[0];
    assert.deepEqual(route.legs.map((item) => [item.distanceMeters, Boolean(item.travelAdvisory)]), [[36035, true], [48456, true]], time);
    assert.deepEqual(priceSplit(plan, route, departure, 52.5 * 1609.344), { cents: tolls }, time);
    const { value, lines } = await logged(() => computeRoute(OWNER_ENDS, departure, null));
    assert.deepEqual([value.ok, value.miles, value.minutes, value.tolls, lines], [true, 52.5, 79, tolls, []], time);
  }
});

await test("the Staten Island route when tolls are asked for: 13A to 13 at $1.41 plus the Goethals Bridge, $16.20 off-peak at 2:00 PM and $18.20 in the peak at 7:30 AM, in two parts with the cut past the bridge", async () => {
  mock();
  for (const [time, tolls] of [["14:00", 141 + 1479], ["07:30", 141 + 1679]]) {
    const { value, lines } = await logged(() => computeRoute(RICHMOND_ENDS, nycToUtc("2026-11-09", time), null));
    assert.deepEqual([value.ok, value.miles, value.minutes, value.tolls, lines], [true, 12.1, 23, tolls, []], time);
  }
});

await test("Newark Liberty to 2700 Richmond Ave is a flat airport transfer: /api/route asks Google without tolls, so no fallback runs and no route-tolls line is logged, the route token has no toll amount, and the booking keeps the flat price with its fixed tolls and airport fees", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 5 * 86400000));
  const line = mockLine(RICHMOND_ENDS, nycToUtc("2026-11-09", "14:00"));
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ body: JSON.parse(init.body), mask: init.headers["X-Goog-FieldMask"] });
    return new Response(JSON.stringify({ routes: [{ duration: "1380s", distanceMeters: 19470, polyline: { encodedPolyline: line.polyline }, legs: [{ startLocation: { latLng: { latitude: 40.693507, longitude: -74.187174 } }, endLocation: { latLng: { latitude: 40.583199, longitude: -74.169089 } } }] }] }), { status: 200 });
  };
  const { value, lines } = await logged(async () => (await routePost(new Request(`${SITE}/api/route`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ from: { id: "ewr" }, to: { text: RICHMOND }, date, time: "14:00", draw: 1 }) }))).json());
  assert.deepEqual([value.kind, value.miles, value.minutes, sent.length, "extraComputations" in sent[0].body, sent[0].mask.includes("tollInfo"), lines], ["ok", 12.1, 23, 1, false, false, []]);
  assert.deepEqual([...readRoute(value.route, Date.now()).values()].map((ride) => ride.tolls), [undefined]);
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  mock();
  const { price } = await priced({ ...WEEKDAY, to_text: RICHMOND, class: "sedan" }, LATER);
  assert.deepEqual([price.service, price.total, price.tolls, price.estimate, price.notes, shownLines(price.lines).map((item) => item.label)], ["airport", AIRPORT_TOTALS.sedan.ewr, 2280, null, [NOTES.included, POLICY.later.airport], ["Fare", "Service fee", "Tolls"]]);
});

const KAPPOCK_LINE = "k_iwFt|ycM?YkATWe@?WBM`AJxAZfBn@`B|@vIzF}GfCkNnFwD`Aw@VaAN}EaAmCWVwAFiACcA[{Bu@kE[mBKqACsATcDCk@K_@OYSOaBc@m@A]FcAVi@AcAW]OSBqBwAsAsAqC{D}FmIq@w@cAeAeBsAK_@qDwCqE_DyBmAuB{@iBa@mDq@cGo@aEUuF@qAMkA[cAg@kAaA}@iAu@yAc@mAoDmOa@}@e@w@k@q@kA_A}@a@kAWqAMsLGk@Se@]]k@Ws@Ky@I}P?wMJeSG[^_M^sHd@_Gh@kEn@wDp@{C~@iD`@oAPSXI`@mA`@wAxC_NZYRw@bA{Cn@oA|@eA~DmD`@o@Pq@@u@Io@Ui@o@m@aAg@kFgB}A{@_CeBcCaCeBsBcBgCeBcDmAuCqAwDsIsZ}AqEyBkFqBeEoBgD}BgDo@{@{@e@aBoA}A}@sBy@sBe@iG}@yFs@aJ{B]LwCcA_C}@oCyAcCgBaCyBmCiD}KcP}DcF_DcDkAaAwBsAcCkAeBo@kBg@wCi@wCQcS_@oDQgC]eUkFaD}@cDoA}CyAcDoB}C{BeD{CiCqCwAeB}A{BqAuByAsC_CeFyEqLeFcNuD}KeDoKiAmEgA{Fk@wD_@cDe@aGSqEKcFW_s@O{EYsEe@sEq@cEu@wD}@iDgAcDeMy\\kWiu@aC{FoB_EaDqFkCwDcBuBuC}CyCoCmEkDqD}BgTkLoHsDqOmI{FsDeGsEwE}DoXmW{]w\\yfAadAaEgDaFsDsFiDqFuC}E{BmFqBwGoBmHeB_Di@}Eo@{Hs@_L}@cLeA}UsBmDa@qDw@{Bs@{BaAoC{AwB}AkX}SmDiCiDsBaCgAgDiAyX}HeDo@{C[uCK_LOaGg@oEs@aHaBmHsBiIsC__@yN{GyCcCu@mE}@_CSsCC{FFiAEeBQmA]_Ai@{@s@w@iAq@}A]yA}AmIa@yA{AyDuA_C}B}CkUaY{CkE_C}DgCcFmBqEoBwFkBkGeBgH{@sEg@uDY}CKwBCqDHgDRqBb@wCt@sCrA{DpAiCjGyKbA{AnFyGvD}D|EoEpEqDzHkEhDyAfCy@xBe@vASbBGpAH~A\\dPbEvCf@p@D`AMf@M`Ai@~@}@p@aA^cAn@cDh@yAnBgD~BcE@c@lA_Cd@wAv@gDr@iC^kBVgCH{AFyDJcBb@kEFqACEvA{LlBcQrQ{}AVYpA_KZi@^W\\Cb@LRTTn@f@nDTr@^\\j@Rn@FzEQtADz@NVJj@t@Pl@@n@E\\U^[Ni@@oBW{Bi@qLkEqASSFcEg@qAa@_Aq@cEmEaBoAsEuCsBu@qAe@m@_@eRaOoCqBs@y@iA}Bm@s@i@a@aAc@u@O}AOeA[qKuFwAe@{EqAcNyGcOsHyGmDmJsFqBwA_B_BqCoDmA}AaC{D_Ro[e@eAq@_Bk@_AwAkBs@u@";
const JERSEY_CITY_LINE = "a`jwFlmycMw@IaFOcAYW?g@WuAgAuA_B{C_ESAaDuEq@w@cAeAeBsAK_@qDwCqE_DyBmAuB{@iBa@mDq@cGo@aEUuF@qAMkA[cAg@kAaA}@iAu@yAc@mAoDmOa@}@e@w@k@q@kA_A}@a@kAWqAMsLGk@Se@]]k@Ws@Ky@I}P?wMJeSG[^_M^sHd@_Gh@kEn@wDp@{C~@iD`@oAPSXI`@mA`@wAhH}[dFyS~C{LpAaEhGgPnAaEtFiU|CsN`{@ycE`AuDr@wBpAwCtAcCbDmEhKeNhAkBx@oBl@yB`@cCV_CJmC?uCKmC[yCk@oD}@}D{A}EuAmDkB}DkBaDgCoDoAwAsa@ab@}BoCwBgDoBqDcB_EoAqDiAmEcEcSy@yCoAsDyAgDaB}CyCcEcCmC{JwJqA_BcA}Am@mAwHgQ@w@qAqDmCaGfHaHs@aCaD{Oc@uA_@s@y@cAq@a@_AWyGu@iDQc@MkHgDeA_@e@[}NmGG@iDyAbAwQ\\cGl@kK{Ca@d@gIrC\\UbEGb@AT_@E";
const FORT_LEE_LINE = "a`jwFlmycMw@IaFOcAYW?g@WuAgAuA_B{C_ESAaDuEq@w@cAeAeBsAK_@qDwCqE_DyBmAuB{@iBa@mDq@cGo@aEUuF@qAMkA[cAg@kAaA}@iAu@yAc@mAoDmOa@}@e@w@k@q@kA_A}@a@kAWqAMsLGk@Se@]]k@Ws@Ky@I}P?wMJeSG[^_M^sHd@_Gh@kEn@wDp@{C~@iD`@oAPSXI`@mA`@wAxC_NZYRw@bA{Cn@oA|@eA~DmD`@o@Pq@@u@Io@Ui@o@m@aAg@kFgB}A{@_CeBcCaCeBsBcBgCeBcDmAuCqAwDsIsZ}AqEyBkFqBeEoBgD}BgDo@{@{@e@aBoA}A}@sBy@sBe@iG}@yFs@aJ{B]LwCcA_C}@oCyAcCgBaCyBmCiD}KcP}DcF_DcDkAaAwBsAcCkAeBo@kBg@wCi@wCQcS_@oDQgC]eUkFaD}@cDoA}CyAcDoB}C{BeD{CiCqCwAeB}A{BqAuByAsC_CeFyEqLeFcNuD}KeDoKiAmEgA{Fk@wD_@cDe@aGSqEKcFW_s@O{EYsEe@sEq@cEu@wD}@iDgAcDeMy\\kWiu@aC{FoB_EaDqFkCwDcBuBuC}CyCoCmEkDqD}BgTkLoHsDqOmI{FsDeGsEwE}DoXmW{]w\\yfAadAaEgDaFsDsFiDqFuC}E{BmFqBwGoBmHeB_Di@}Eo@{Hs@_L}@cLeA}UsBmDa@qDw@{Bs@{BaAoC{AwB}AkX}SmDiCiDsBaCgAgDiAyX}HeDo@{C[uCK_LOaGg@oEs@aHaBmHsBiIsC__@yN{GyCcCu@mE}@_CSsCC{FFiAEeBQmA]_Ai@{@s@w@iAq@}A]yA}AmIa@yA{AyDuA_C}B}CkUaY{CkE_C}DgCcFmBqEoBwFkBkGeBgH{@sEg@uDY}CKwBCqDHgDRqBb@wCt@sCrA{DpAiCjGyKbA{AnFyGvD}D|EoEpEqDzHkEhDyAfCy@xBe@vASbBGpAH~A\\dPbEvCf@p@D`AMf@M`Ai@~@}@p@aA^cAn@cDh@yAnBgD~AsCVDzAiB`BoBHOHDtA{ClBwGxC|A";
const FORT_LEE = [40.852896, -73.969068];
const along = (path, point) => path.slice(1).map((_, i) => project(path, arcsOf(path), point, i + 1)).reduce((best, hit) => (hit.gap < best.gap ? hit : best));

await test("a stop where Google prices the route but not every leg: Newark Liberty to 19 Coventry Ln with a stop at 2000 Lemoine Ave, Fort Lee, comes back at $16.53 for the whole route with no price on the leg to the stop, so the fallback asks Google again and adds the Turnpike from 14 to 18E, Tolls $22.24, and a route with every leg priced keeps Google's total", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const path = ownerPath();
  const stop = { address: "2000 Lemoine Ave, Fort Lee, NJ 07024" };
  const ends = [OWNER_ENDS[0], stop, OWNER_ENDS[1]];
  const departure = nycToUtc("2026-11-09", "14:00");
  const at = ([latitude, longitude]) => ({ latLng: { latitude, longitude } });
  const first = { ...tolled(money("16", 530000000)), legs: [{ startLocation: at(path.points[0]), endLocation: at(FORT_LEE), travelAdvisory: { tollInfo: {} } }, { startLocation: at(FORT_LEE), endLocation: at(path.points[1]), ...tolled(money("16", 530000000)) }] };
  const legs = [leg(1500, 23923, { travelAdvisory: { tollInfo: {} } }), leg(700, 9712), leg(300, 2376, { travelAdvisory: { tollInfo: {} } }), leg(2710, 48424, tolled(money("1", 740000000)))];
  const sent = googleAnswers({ first, legs });
  const { value, lines } = await logged(() => computeRoute(ends, departure, null));
  assert.deepEqual([value.ok, value.tolls, lines, sent.length], [true, 571 + 1479 + 174, [], 2]);
  assert.deepEqual(sent[0].mask.split(",").slice(-2), ["routes.travelAdvisory.tollInfo", "routes.legs.travelAdvisory.tollInfo"]);
  assert.deepEqual(sent[1].body.intermediates.map((item) => (item.location ? "cut" : item)), ["cut", stop, "cut"]);
  const whole = googleAnswers({ first: { ...tolled(money("22", 240000000)), legs: [{ ...first.legs[0], ...tolled(money("5", 710000000)) }, first.legs[1]] } });
  assert.deepEqual([(await computeRoute(ends, departure, null)).tolls, whole.length], [2224, 1]);
});

await test("a drop-off past the George Washington Bridge keeps its own Google part: 1000 Spring St, Elizabeth to 100 Kappock St, Bronx, and the same line ending 200 m short, both cut 300 m past the bridge, so the Henry Hudson Bridge further on stays in the part Google prices", () => {
  const line = decodePath(KAPPOCK_LINE);
  const arcs = arcsOf(line);
  const short = line.slice(0, arcs.findIndex((item) => item >= arcs.at(-1) - 200) + 1);
  const cut = { latitude: 40.848928, longitude: -73.941599, heading: 196 };
  const expected = { marks: [{ cut }], legs: [{ tolls: [{ kind: "njtp", id: "14-18E", share: 0.174, cents: 571 }, { kind: "pa", id: "gwb", share: 0.947 }] }, null] };
  assert.deepEqual(tollPlan(line, []), expected);
  assert.deepEqual(tollPlan(short, []), expected);
  const bridge = along(short, [40.87563, -73.9254]);
  const past = along(short, [cut.latitude, cut.longitude]).at;
  assert.ok(bridge.gap < 50);
  assert.deepEqual([Math.round(bridge.at - past), Math.round(arcsOf(short).at(-1) - past)], [4336, 4954]);
});

await test("other Turnpike trips on live lines: Newark Liberty to 200 Marin Blvd, Jersey City leaves at 14C, which has no table entry, so there is no plan and Google's own price stands, and Newark Liberty to 2000 Lemoine Ave, Fort Lee leaves at 18E with no bridge, one table part for the Turnpike up to a cut 2 km past 18E", () => {
  assert.deepEqual(tollPlan(decodePath(JERSEY_CITY_LINE), []), { reason: "turnpike" });
  const line = decodePath(FORT_LEE_LINE);
  assert.ok(along(line, FORT_LEE).gap < 50);
  assert.deepEqual(tollPlan(line, []), { marks: [{ cut: { latitude: 40.828984, longitude: -74.024671, heading: 32 } }], legs: [{ tolls: [{ kind: "njtp", id: "14-18E", share: 0.195, cents: 571 }] }, null] });
});

const T4_ADDRESS = "John F. Kennedy International Airport Terminal 4, Queens, NY 11430";
const T4_END = { from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4" };
const T4_DROP = { to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4" };
const CPW_LABEL = "500 Communipaw Avenue, Jersey City, NJ";
const R_NOW = new Date("2026-11-24T15:00:00.000Z");
const MAN_EWR = "mxuwFbkqbMuK~\\aBrFmG~RwAfEuBxGoCoB{AwBeCkEi@o@_@Wk@Ia@Bm@Xi@f@o@dA}DhIwAjEa@fBk@rD_@rAqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAtClAzB~Ab@Jt@Kr@[`@_@\\k@Rs@H{@AaAOw@[u@_@c@k@_@uDwAsDaAaDo@aDc@aA@}@Pw@`@m@h@q@hAsJ`Y}FpR{A~DcHrQsBbGmB`H{ClLqC`L}GjWyDpN{Jt_@kClKW|AItA?lAJdBTxA^lAr@tAj@l@fBdAtCdArB~@pBfArDvAxHnCrAl@XAdH|DdIrEvEtCbDdCbD|C~ClDzBvClBrCfBzC~BxEnBtEzCrI|Tzo@|KnYfAjDhAlE|@xEj@lE`@xERzEFdFVxp@NzFX|E`@pEp@hFv@pEdAxElAfEhE~MtErMpElLjF~LlBvDhBvCpCtDvBbC|CxCfDjClCfBhCvAzCpAzDnAbMxChIhBdC\\fDTtS\\rCTjDl@zBp@dDtAvBtA`BrAvBzBjB|BbMnQvC`EjApApDhDpDfCpCvAjB|@hVdK`G|Bf@b@xFxDxCdC@PvBxBjBbC|AlCvAvClA~CzA`FtGfUxA~D`BrD`BtChBrCfBxB`CpCj@bA`@dAX|@Ff@f@nDRlCBbAE|ASvAsDjPy@zCa@fByA|EeAvCiDnIg@dBq@rDKbBC`AHPRxA`@xAf@dAv@~@`Ar@HBDLxChCx@bAp@nAp@pBZzA?LJnA@pBIb[@zFHPGpHFnBFpAFN`@fC^|AZbAv@fB`A|AfArAx@r@bGlEhDbCxDlCvD~B|C|AfOtGLHXIXDd@Ah@Q~A{@p@Mr@@n@Rd@\\tC~Dv@fAz@p@JTlA`@~@LfAC|@Sz@c@h@a@j@{@z@cB";
const OUTERBRIDGE = "uwfvFhfhdMtAqHSMsCcAmDqAeC}@}DuAw[eM}B_Ae@So@IaA@_@LqGbEi@L}@@_@EqFuBaE}A_@Gc@QoDuBwHwCo@My@Bq@Ni@Ta@XmJrJYZ~BvEn@~Ad@rBz@pEn@vBXx@Jp@EXDl@@j@ItA[nBo@tCGj@iBrHBZ}BfJ_@VeAzCkB~G@j@FLl@PNE^YLg@Ac@`C_LBWEUfGuVj@_DXgCRuC|D}u@H{EAsEmEotB_@qRIgKi@gVMeDFa@EyBF{An@oI@}AGgAWqA]eAg@{@w@y@q@a@_AWaAG}@Fq@Rq@ZgO|JaAb@iBb@_@FIJs]xAi@@WKeBMaGu@]CMQ_Jq@GFKtEBRLJbF`@tERnEDpBCh@fDTrBBrAoBjSkAlKo@zGk@fGs@`HWpEeLr@mCWkCc@_@Qu@eA]u@kAyD";
const PEAK = PA_TOLLS[1].peak;
const OFF_PEAK = PA_TOLLS[1].offPeak;
const HOLLAND_GOOGLE = 1041;
const signed = (id, label, now = R_NOW) => signTicket(id, "outside", label, now, 0, "NJ");
const toCpw = (now) => ({ to_text: CPW_LABEL, to_ticket: signed("mock-communipaw", CPW_LABEL, now) });
const fromCpw = (now) => ({ from_text: CPW_LABEL, from_ticket: signed("mock-communipaw", CPW_LABEL, now) });
const OWNER_JC = (now) => ({ trip_type: "one", ...T4_END, ...toCpw(now), date: "2026-12-01", time: "17:00", passengers: "2", toddler_seats: "1", class: "suv", action: "pay", ...ME });
const lineOf = (ends, date, time) => decodePath(mockLine(ends, nycToUtc(date, time)).polyline);
const reversed = (path) => [...path].reverse();
const googleRoute = (route) => {
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ routes: [route] }), { status: 200 }));
  return sent;
};
const ownerAnswer = (extra = {}) => ({ duration: "5160s", distanceMeters: 41199, legs: [{ startLocation: { latLng: { latitude: 40.643925, longitude: -73.783068 } }, endLocation: { latLng: { latitude: 40.715799, longitude: -74.068787 } } }], ...tolled(money("10", 410000000)), ...extra });

await test("the return crossing is found on Google's route line the way the fallback finds a crossing, in the New Jersey direction: the live lines that cross the Holland or Lincoln tunnel, the Bayonne, Goethals or George Washington bridge or the Outerbridge into New Jersey are found, the live lines into New York or with no crossing are not, and a line that crosses back into New York before its end is not", () => {
  const T4 = { address: T4_ADDRESS };
  const CPW = { placeId: "mock-communipaw" };
  const MAN = { address: MANHATTAN };
  const HOB = { placeId: "mock-clinton" };
  const owner = lineOf([T4, CPW], "2026-12-01", "17:00");
  const into = {
    "JFK T4 to 500 Communipaw Ave at 5:00 PM, Holland Tunnel": owner,
    "JFK T4 to 500 Communipaw Ave at 2:00 PM, Bayonne Bridge": lineOf([T4, CPW], "2026-12-01", "14:00"),
    "JFK T4 by 350 5th Ave to 500 Communipaw Ave, Holland Tunnel": lineOf([T4, MAN, CPW], "2026-12-01", "17:00"),
    "350 5th Ave to 1332 Clinton St, Hoboken, Lincoln Tunnel": lineOf([MAN, HOB], "2026-12-01", "14:00"),
    "Empire State Building to Newark Liberty, Lincoln Tunnel": decodePath(MAN_EWR),
    "19 Coventry Ln to Newark Liberty, George Washington Bridge": lineOf([{ address: RIVERSIDE }, { address: EWR_ADDRESS }], "2026-11-13", "18:00"),
    "2700 Richmond Ave to Newark Liberty, Goethals Bridge": reversed(lineOf([{ address: EWR_ADDRESS }, { address: RICHMOND }], "2026-11-09", "14:00")),
    "4000 Arthur Kill Rd to Perth Amboy, Outerbridge Crossing": reversed(decodePath(OUTERBRIDGE)),
  };
  const not = {
    "500 Communipaw Ave to JFK T4, Bayonne Bridge into Staten Island": lineOf([CPW, T4], "2026-12-03", "10:00"),
    "1332 Clinton St to 350 5th Ave, Lincoln Tunnel": lineOf([HOB, MAN], "2026-12-01", "14:00"),
    "1 Gateway Center, Newark to 350 5th Ave, Lincoln Tunnel": lineOf([{ placeId: "mock-newark" }, MAN], "2026-12-01", "14:00"),
    "30 Hudson St, Jersey City to 1332 Clinton St, no crossing": lineOf([{ placeId: "mock-jersey-city" }, HOB], "2026-12-01", "14:00"),
    "Newark Liberty to 19 Coventry Ln, George Washington Bridge": lineOf([{ address: EWR_ADDRESS }, { address: RIVERSIDE }], "2026-11-09", "14:00"),
    "Newark Liberty to 2700 Richmond Ave, Goethals Bridge": lineOf([{ address: EWR_ADDRESS }, { address: RICHMOND }], "2026-11-09", "14:00"),
    "Perth Amboy to 4000 Arthur Kill Rd, Outerbridge Crossing": decodePath(OUTERBRIDGE),
    "into New Jersey and back into New York": [...owner, ...reversed(owner)],
    "into New Jersey by the Holland Tunnel and back by the Lincoln Tunnel": [...owner, ...lineOf([HOB, MAN], "2026-12-01", "14:00")],
    "into New Jersey by the Bayonne Bridge and back by the George Washington Bridge": [...lineOf([T4, CPW], "2026-12-01", "14:00"), ...lineOf([{ address: EWR_ADDRESS }, { address: RIVERSIDE }], "2026-11-09", "14:00")],
  };
  for (const [name, path] of Object.entries(into)) assert.equal(intoJersey(path), true, name);
  for (const [name, path] of Object.entries(not)) assert.equal(intoJersey(path), false, name);
  assert.equal(intoJersey([...reversed(owner), ...owner]), true, "into New York and back into New Jersey");
  for (const path of [[], [[40.7, -74]], undefined, null, "x", decodePath(""), decodePath("?")]) assert.equal(intoJersey(path), false, JSON.stringify(path));
  for (const path of Object.values(not)) assert.equal(returnCents(path, nycToUtc("2026-12-01", "18:00")), 0);
});

await test("the owner's booking 39333380, JFK Terminal 4 to 500 Communipaw Ave, Jersey City, NJ 07304 in a Business SUV with a child seat, 25.6 miles and 86 min over the Queens Midtown and Holland tunnels: Google's $10.41 stays, the return crossing adds the Port Authority peak $16.79 for a Tuesday 6:26 PM drop-off, Tolls $27.20 and $319.70, through Stripe, the metadata keys and the receipt, and without a route line the same booking on Wednesday is $302.91", async () => {
  mock();
  const { trip, price } = await priced(OWNER_JC(R_NOW), R_NOW);
  assert.deepEqual(trip.legs.map((item) => item.ride), [{ tenths: 256, minutes: 86, tolls: HOLLAND_GOOGLE + PEAK }]);
  assert.deepEqual([PEAK, HOLLAND_GOOGLE + PEAK], [1679, 2720]);
  assert.deepEqual(pairs(shownLines(price.lines)), [["Fare", 16449], ["Service fee", 1974], ["Tolls", 2720], ["Child seats (1 x $20.00)", 2000]]);
  assert.deepEqual([price.fare, price.fee, price.tolls, price.estimate, price.seats, price.total, price.service], [16449, 1974, 2720, 2720, 2000, 23143, "distance"]);
  assert.deepEqual(price.notes, [POLICY.later.waiting]);
  const { metadata, items, submit } = built(trip, price);
  assert.deepEqual(items, [["Fare", 16449], ["Service fee", 1974], ["Tolls", 2720], ["Child seats (1 x $20.00)", 2000]]);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, metadata.total_cents, submit], ["2720", "2720", "23143", CHECKOUT.submitOutsideTolled]);
  assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
  delete process.env.GOOGLE_MOCK;
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  googleRoute(ownerAnswer());
  const before = await priced({ ...OWNER_JC(R_NOW), date: "2026-12-02" }, R_NOW);
  assert.deepEqual(before.trip.legs.map((item) => item.ride), [{ tenths: 256, minutes: 86, tolls: 1041 }]);
  assert.deepEqual([pairs(shownLines(before.price.lines)), before.price.total], [[["Fare", 17948], ["Service fee", 2154], ["Tolls", 1041], ["Child seats (1 x $20.00)", 2000]], 23143]);
  assert.deepEqual(Object.keys(built(before.trip, before.price).metadata).sort(), Object.keys(metadata).sort(), "no metadata key is added");
});

await test("the owner's booking off-peak and at the peak edges: the Port Authority rate is taken at the estimated drop-off time in New York, $16.79 for a drop-off weekdays 6 to 10 AM or 4 to 8 PM and weekends 11 AM to 9 PM, else $14.79, so a pickup at 2:45 PM that arrives at 4:11 PM pays the peak, and the 2:00 PM line over the Bayonne Bridge adds the off-peak rate to Google's $8.87", async () => {
  mock();
  const cases = [
    ["2026-12-01", "17:00", HOLLAND_GOOGLE + PEAK],
    ["2026-12-01", "20:00", HOLLAND_GOOGLE + OFF_PEAK],
    ["2026-12-01", "14:45", HOLLAND_GOOGLE + PEAK],
    ["2026-12-01", "14:30", HOLLAND_GOOGLE + OFF_PEAK],
    ["2026-12-01", "04:40", HOLLAND_GOOGLE + PEAK],
    ["2026-12-01", "04:30", HOLLAND_GOOGLE + OFF_PEAK],
    ["2026-12-01", "08:30", HOLLAND_GOOGLE + PEAK],
    ["2026-12-01", "08:40", HOLLAND_GOOGLE + OFF_PEAK],
    ["2026-12-05", "17:00", HOLLAND_GOOGLE + PEAK],
    ["2026-12-05", "09:40", HOLLAND_GOOGLE + PEAK],
    ["2026-12-05", "09:30", HOLLAND_GOOGLE + OFF_PEAK],
    ["2026-12-05", "20:00", HOLLAND_GOOGLE + OFF_PEAK],
    ["2026-12-01", "14:00", 887 + OFF_PEAK],
  ];
  const found = [];
  for (const [date, time] of cases) found.push((await priced({ ...OWNER_JC(R_NOW), date, time }, R_NOW)).trip.legs[0].ride.tolls);
  assert.deepEqual(found, cases.map((item) => item[2]));
  assert.deepEqual([OFF_PEAK, HOLLAND_GOOGLE + OFF_PEAK], [1479, 2520]);
  const off = (await priced({ ...OWNER_JC(R_NOW), time: "20:00" }, R_NOW)).price;
  assert.deepEqual([pairs(shownLines(off.lines)), off.total], [[["Fare", 16628], ["Service fee", 1995], ["Tolls", 2520], ["Child seats (1 x $20.00)", 2000]], 23143]);
  const afternoon = (await priced({ ...OWNER_JC(R_NOW), time: "14:00" }, R_NOW)).trip.legs[0].ride;
  assert.deepEqual(afternoon, { tenths: 377, minutes: 80, tolls: 2366 });
  const totals = [];
  for (const cls of CLASSES) totals.push((await priced({ ...OWNER_JC(R_NOW), class: cls, passengers: "2" }, R_NOW)).price.tolls);
  assert.deepEqual(totals, CLASSES.map(() => 2720), "every class, the Luxury Sprinter too, pays the Class 1 return crossing");
});

await test("round trips in each direction: JFK T4 to 500 Communipaw Ave and back adds the return crossing only to the ride into New Jersey, $27.20 out and Google's $22.25 back into New York, and 500 Communipaw Ave to JFK T4 and back adds it to the return ride by its own drop-off time, $22.25 out and $27.20 or $25.20 back", async () => {
  mock();
  const out = await priced({ ...OWNER_JC(R_NOW), return: "1", return_date: "2026-12-03", return_time: "10:00" }, R_NOW);
  assert.deepEqual(out.trip.legs.map((item) => [item.back, item.ride]), [[false, { tenths: 256, minutes: 86, tolls: 2720 }], [true, { tenths: 362, minutes: 69, tolls: 2225 }]]);
  assert.deepEqual([out.price.tolls, out.price.estimate, shownLines(out.price.lines).find((item) => item.label === "Tolls").cents], [4945, 4945, 4945]);
  const { metadata, items } = built(out.trip, out.price);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, metadata.legs], ["4945", "4945", "2"]);
  assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
  const home = { trip_type: "one", ...fromCpw(R_NOW), ...T4_DROP, date: "2026-12-01", time: "10:00", passengers: "2", class: "suv", action: "pay", ...ME, return: "1", return_date: "2026-12-03" };
  const peak = await priced({ ...home, return_time: "17:00" }, R_NOW);
  assert.deepEqual(peak.trip.legs.map((item) => [item.back, item.ride.tolls]), [[false, 2225], [true, 2720]]);
  assert.equal(peak.price.tolls, 4945);
  const late = await priced({ ...home, return_time: "20:00" }, R_NOW);
  assert.deepEqual([late.trip.legs.map((item) => item.ride.tolls), late.price.tolls], [[2225, 2520], 4745]);
});

await test("stops: JFK T4 by a stop at 350 5th Ave to 500 Communipaw Ave adds one return crossing to the whole route at the 6:32 PM drop-off, Google's $16.37 plus $16.79, and the stop fee stays its own line", async () => {
  mock();
  const { trip, price } = await priced({ ...OWNER_JC(R_NOW), stop1_text: MANHATTAN }, R_NOW);
  assert.deepEqual([trip.legs[0].ride, trip.legs[0].stops], [{ tenths: 265, minutes: 92, tolls: 1637 + PEAK }, 1]);
  assert.deepEqual([price.tolls, price.estimate], [3316, 3316]);
  assert.ok(shownLines(price.lines).some((item) => item.cents === STOP_FEE_CENTS && item.label !== "Tolls"));
});

await test("into New York and with no crossing nothing changes: 1 Gateway Center, Newark and 1332 Clinton St, Hoboken to 350 5th Ave and 500 Communipaw Ave to JFK T4 keep Google's estimate, and 30 Hudson St, Jersey City to 1332 Clinton St keeps no Tolls line", async () => {
  mock();
  const base = { trip_type: "one", date: "2026-12-01", time: "14:00", passengers: "2", class: "suv", action: "pay", ...ME };
  const newark = await priced({ ...base, from_text: "1 Gateway Center, Newark, NJ", from_ticket: signed("mock-newark", "1 Gateway Center, Newark, NJ"), to_text: MANHATTAN }, R_NOW);
  const hoboken = await priced({ ...base, from_text: "1332 Clinton Street, Hoboken, NJ", from_ticket: signed("mock-clinton", "1332 Clinton Street, Hoboken, NJ"), to_text: MANHATTAN }, R_NOW);
  const airport = await priced({ ...base, ...fromCpw(R_NOW), ...T4_DROP, time: "10:00" }, R_NOW);
  assert.deepEqual([newark, hoboken, airport].map(({ trip, price }) => [trip.legs[0].ride.tolls, price.tolls]), [[2296, 2296], [2079, 2079], [2225, 2225]]);
  const local = await priced({ ...base, from_text: "30 Hudson Street, Jersey City, NJ", from_ticket: signed("mock-jersey-city", "30 Hudson Street, Jersey City, NJ"), to_text: "1332 Clinton Street, Hoboken, NJ", to_ticket: signed("mock-clinton", "1332 Clinton Street, Hoboken, NJ") }, R_NOW);
  assert.deepEqual([local.trip.legs[0].ride, local.price.tolls, local.price.estimate, shownLines(local.price.lines).map(({ label }) => label)], [{ tenths: 33, minutes: 20, tolls: 0 }, 0, 0, ["Fare", "Service fee"]]);
});

await test("no route line keeps today's behavior: a Google answer without a line or with a line that does not decode adds nothing", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const T4 = { address: T4_ADDRESS };
  const CPW = { placeId: "mock-communipaw" };
  const departure = nycToUtc("2026-12-01", "17:00");
  for (const extra of [{}, { polyline: {} }, { polyline: { encodedPolyline: "" } }, { polyline: { encodedPolyline: "?" } }, { polyline: { encodedPolyline: 42 } }]) {
    googleRoute(ownerAnswer(extra));
    assert.equal((await computeRoute([T4, CPW], departure, null)).tolls, 1041, JSON.stringify(extra));
  }
  googleRoute(ownerAnswer({ polyline: { encodedPolyline: mockLine([T4, CPW], departure).polyline } }));
  assert.equal((await computeRoute([T4, CPW], departure, null)).tolls, 2720);
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
});

await test("flat airport transfers are unchanged although the line crosses into New Jersey: /api/route asks Google for Manhattan to Newark Liberty without tolls, the route token has no toll amount, and the booking keeps the flat total with its fixed tolls and airport fees", async () => {
  assert.equal(intoJersey(decodePath(MAN_EWR)), true);
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const sent = googleRoute({ duration: "1860s", distanceMeters: 25589, polyline: { encodedPolyline: MAN_EWR }, legs: [{ startLocation: { latLng: { latitude: 40.749028, longitude: -73.985937 } }, endLocation: { latLng: { latitude: 40.693507, longitude: -74.187174 } } }], ...tolled(money("0", 0)) });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 5 * 86400000));
  const res = await routePost(new Request(`${SITE}/api/route`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ from: { text: MANHATTAN }, to: { id: "ewr" }, date, time: "17:00", draw: 1 }) }));
  const body = await res.json();
  assert.deepEqual([body.kind, body.minutes, body.miles, sent.length, sent[0].extraComputations], ["ok", 31, 15.9, 1, undefined]);
  assert.deepEqual([...readRoute(body.route, Date.now()).values()].map(({ tenths, minutes, tolls }) => [tenths, minutes, tolls]), [[159, 31, undefined]]);
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  mock();
  const { price } = await run({ trip_type: "one", from_text: MANHATTAN, to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-12-01", time: "17:00", passengers: "2", class: "suv", action: "pay", ...ME }, R_NOW);
  assert.equal(price.total, AIRPORT_TOTALS.suv.ewr);
  assert.deepEqual(shownLines(price.lines).find((item) => item.label === "Tolls").cents, AIRPORT_TOTALS.suv.ewr - price.fare - price.fee);
});

await test("hourly is unchanged: 4 hours from JFK T4 or from 500 Communipaw Ave shows no Tolls line, keeps tolls after the ride and never asks Google", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const sent = googleRoute(ownerAnswer());
  for (const from of [T4_END, fromCpw(R_NOW)]) {
    const { price } = await priced({ trip_type: "hour", ...from, date: "2026-12-01", time: "17:00", passengers: "2", hours: "4", class: "premium", vehicle: "premium", action: "pay", ...ME }, R_NOW);
    assert.deepEqual([price.tolls, price.estimate, shownLines(price.lines).some((item) => item.label === "Tolls"), price.notes], [0, null, false, [POLICY.later.hourly]]);
  }
  assert.equal(sent.length, 0);
});

await test("Google's own drive time sets the drop-off: the owner's line with a Google duration of 85 min pays the peak for a 2:40 PM pickup that arrives at 4:05 PM and the off-peak rate for 2:30 PM, and a drop-off on or after January 1, 2028 adds nothing and logs route-tolls return stale", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const T4 = { address: T4_ADDRESS };
  const CPW = { placeId: "mock-communipaw" };
  const polyline = { encodedPolyline: mockLine([T4, CPW], nycToUtc("2026-12-01", "17:00")).polyline };
  googleRoute(ownerAnswer({ duration: "5100s", polyline }));
  assert.equal((await computeRoute([T4, CPW], nycToUtc("2026-12-01", "14:40"), null)).tolls, 1041 + PEAK);
  assert.equal((await computeRoute([T4, CPW], nycToUtc("2026-12-01", "14:30"), null)).tolls, 1041 + OFF_PEAK);
  googleRoute(ownerAnswer({ polyline }));
  for (const [date, time, tolls, lines] of [["2027-12-31", "22:30", 1041 + OFF_PEAK, []], ["2027-12-31", "22:40", 1041, ["route-tolls return stale"]], ["2028-01-04", "17:00", 1041, ["route-tolls return stale"]]]) {
    const out = await logged(() => computeRoute([T4, CPW], nycToUtc(date, time), null));
    assert.deepEqual([out.value.tolls, out.lines], [tolls, lines], `${date} ${time}`);
  }
});

await test("tamper: the return crossing rides in the signed route token from /api/route, for each direction of a round trip, a changed token is ignored and the booking asks Google again, a token the server signed is its own estimate, and toll amounts posted by the browser are never read", async () => {
  mock();
  const now = Date.now();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + 5 * 86400000));
  const back = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + 7 * 86400000));
  const ticket = signed("mock-communipaw", CPW_LABEL, now);
  const res = await routePost(new Request(`${SITE}/api/route`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ from: { id: "jfk-t4" }, to: { ticket }, date, time: "17:00", back: { date: back, time: "10:00" }, draw: 1 }) }));
  const body = await res.json();
  assert.deepEqual([body.kind, body.minutes, body.miles, body.back.minutes, body.back.miles], ["ok", 86, 25.6, 69, 36.2]);
  const rides = [...readRoute(body.route, now).values()].map(({ tenths, minutes, tolls }) => [tenths, minutes, tolls]);
  assert.deepEqual(rides, [[256, 86, 2720], [362, 69, 2225]]);
  const [, payload, mac] = body.route.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const changed = `r1.${Buffer.from(JSON.stringify({ ...data, l: [[data.l[0][0], 256, 86, 1041]] })).toString("base64url")}.${mac}`;
  assert.equal(readRoute(changed, now).size, 0);
  const fields = { ...OWNER_JC(now), ...toCpw(now), date, tolls: "1041", tolls_cents: "1041", tolls_est_cents: "1041", return_cents: "0" };
  assert.equal((await priced({ ...fields, route: changed }, new Date(now))).price.tolls, 2720);
  assert.equal((await priced({ ...fields, route: signRoute([[data.l[0][0], 256, 86, 1999]], now) }, new Date(now))).price.tolls, 1999, "a token the server signed is the server's own estimate");
  const options = await bookPost(new Request(`${SITE}/api/book`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: SITE, "sec-fetch-site": "same-origin" }, body: JSON.stringify({ ...fields, route: changed, action: "options", nonce: "nonce-return-tamper-0001" }) }));
  const answer = await options.json();
  assert.deepEqual([answer.price.lines.map(({ label, cents }) => [label, cents]), answer.price.total_cents], [[["Fare", 16449], ["Service fee", 1974], ["Tolls", 2720], ["Child seats (1 x $20.00)", 2000]], 23143]);
});

const WILLOW_CUT = { cut: { latitude: 40.76087, longitude: -74.027305, heading: 206 } };
const LINCOLN_CUTS = [{ cut: { latitude: 40.753014, longitude: -73.99542, heading: 300 } }, WILLOW_CUT];
const LINCOLN_LEGS = [null, { tolls: [{ kind: "free", id: "lincoln", share: 0.425 }] }, null];
const EIGHTH_CUTS = [{ cut: { latitude: 40.754742, longitude: -73.993622, heading: 299 } }, WILLOW_CUT];
const EIGHTH_LEGS = [null, { tolls: [{ kind: "free", id: "lincoln", share: 0.404 }] }, null];
const HOB_LABEL = "1332 Clinton Street, Hoboken, NJ";
const WEE_LABEL = "1 Hackensack Avenue, Weehawken, NJ";
const EIGHTH = "500 8th Ave, New York, NY 10018";
const lincolnAnswers = ({ legs, total, first = {} } = {}) => {
  const line = mockLine([{ address: MANHATTAN }, { placeId: "mock-clinton" }], nycToUtc("2026-12-01", "14:00"));
  const sent = [];
  const latLng = ([latitude, longitude]) => ({ latLng: { latitude, longitude } });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const split = body.intermediates.some((item) => item.location);
    sent.push({ body, mask: init.headers["X-Goog-FieldMask"], split });
    const routes = split ? [{ distanceMeters: total === undefined ? legs.reduce((sum, item) => sum + item.distanceMeters, 0) : total, legs }] : [{ duration: "1140s", distanceMeters: 6116, polyline: { encodedPolyline: line.polyline }, legs: [{ startLocation: latLng(line.points[0]), endLocation: latLng(line.points[1]) }], travelAdvisory: { tollInfo: {} }, ...first }];
    return new Response(JSON.stringify({ routes }), { status: 200 });
  };
  return sent;
};
const LINCOLN_SPLIT = [leg(170, 913), leg(750, 4047, { travelAdvisory: { tollInfo: {} } }), leg(220, 1156)];

await test("the Lincoln and Holland tunnels into New Jersey are free parts of the toll fallback: on the live lines into New Jersey the plan cuts the route before and after the tunnel, outside the tube, and lines into New York, over a bridge into New Jersey or with no crossing keep their plans", () => {
  const MAN = { address: MANHATTAN };
  const HOB = { placeId: "mock-clinton" };
  const T4 = { address: T4_ADDRESS };
  const CPW = { placeId: "mock-communipaw" };
  assert.deepEqual(tollPlan(lineOf([MAN, HOB], "2026-12-01", "14:00"), []), { marks: LINCOLN_CUTS, legs: LINCOLN_LEGS });
  assert.deepEqual(tollPlan(lineOf([{ address: EIGHTH }, { placeId: "mock-weehawken" }], "2026-12-01", "14:00"), []), { marks: EIGHTH_CUTS, legs: EIGHTH_LEGS });
  assert.deepEqual(tollPlan(lineOf([T4, CPW], "2026-12-01", "17:00"), []), { marks: [{ cut: { latitude: 40.723596, longitude: -74.00463, heading: 283 } }, { cut: { latitude: 40.731858, longitude: -74.042896, heading: 277 } }], legs: [null, { tolls: [{ kind: "free", id: "holland", share: 0.321 }] }, null] });
  const none = {
    "1332 Clinton St to 350 5th Ave, Lincoln Tunnel into New York": lineOf([HOB, MAN], "2026-12-01", "14:00"),
    "1 Gateway Center to 350 5th Ave, Lincoln Tunnel into New York": lineOf([{ placeId: "mock-newark" }, MAN], "2026-12-01", "14:00"),
    "JFK T4 to 500 Communipaw Ave at 2:00 PM, Bayonne Bridge into New Jersey": lineOf([T4, CPW], "2026-12-01", "14:00"),
    "4000 Arthur Kill Rd to Perth Amboy, Outerbridge Crossing into New Jersey": reversed(decodePath(OUTERBRIDGE)),
    "30 Hudson St to 1332 Clinton St, no crossing": lineOf([{ placeId: "mock-jersey-city" }, HOB], "2026-12-01", "14:00"),
  };
  for (const [name, path] of Object.entries(none)) assert.deepEqual(tollPlan(path, []), { reason: "none" }, name);
  const line = lineOf([MAN, HOB], "2026-12-01", "14:00");
  const arcs = arcsOf(line);
  const tube = [[40.75916, -74.00019], [40.76693, -74.01866]].map((end) => arcs[line.findIndex((point) => point[0] === end[0] && point[1] === end[1])]);
  const cuts = LINCOLN_CUTS.map(({ cut }) => arcs[1 + line.slice(1).findIndex((point, i) => project(line, arcs, [cut.latitude, cut.longitude], i + 1).gap < 1)]);
  assert.ok(cuts[0] < tube[0] && cuts[1] > tube[1], JSON.stringify({ tube, cuts }));
});

await test("the Lincoln Tunnel into New Jersey, where Google gives tolls with no price: the fallback asks Google again with a waypoint before and after the tunnel, the tunnel part is $0, Google prices the rest, and the return crossing is added, $14.79 for a 2:19 PM drop-off and $16.79 at 6:19 PM, with or without a toll on Google's tunnel part, Google's price on that part when it gives one, and today's behavior when another part has no price, the split route is longer, or the drop-off is in 2028", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const ends = [{ address: MANHATTAN }, { placeId: "mock-clinton" }];
  const at2 = nycToUtc("2026-12-01", "14:00");
  let sent = lincolnAnswers({ legs: LINCOLN_SPLIT });
  const out = await logged(() => computeRoute(ends, at2, null));
  assert.deepEqual([out.value.ok, out.value.minutes, out.value.miles, out.value.tolls, out.lines], [true, 19, 3.8, OFF_PEAK, []]);
  assert.deepEqual(sent.map((item) => [item.split, item.mask]), [[false, sent[0].mask], [true, SPLIT_MASK]]);
  assert.deepEqual(sent[1].body.intermediates, LINCOLN_CUTS.map(({ cut }) => ({ location: { latLng: { latitude: cut.latitude, longitude: cut.longitude }, heading: cut.heading } })));
  for (const key of ["origin", "destination", "departureTime", "extraComputations", "routeModifiers"]) assert.deepEqual(sent[1].body[key], sent[0].body[key], key);
  lincolnAnswers({ legs: LINCOLN_SPLIT });
  assert.equal((await computeRoute(ends, nycToUtc("2026-12-01", "18:00"), null)).tolls, PEAK);
  lincolnAnswers({ legs: [LINCOLN_SPLIT[0], leg(750, 4047), LINCOLN_SPLIT[2]] });
  assert.equal((await computeRoute(ends, at2, null)).tolls, OFF_PEAK, "no toll seen on the tunnel part");
  lincolnAnswers({ legs: [LINCOLN_SPLIT[0], leg(750, 4047, tolled(money("1", 0))), LINCOLN_SPLIT[2]] });
  assert.equal((await computeRoute(ends, at2, null)).tolls, 100 + OFF_PEAK, "Google's price on the tunnel part");
  for (const [legs, total, line] of [
    [[LINCOLN_SPLIT[0], LINCOLN_SPLIT[1], leg(220, 1156, { travelAdvisory: { tollInfo: {} } })], undefined, "route-tolls unpriced leg 3/3 1156m plan g,free,g"],
    [LINCOLN_SPLIT, 6400, "route-tolls detour"],
    [[LINCOLN_SPLIT[0], LINCOLN_SPLIT[1]], undefined, "route-tolls legs"],
  ]) {
    lincolnAnswers({ legs, total });
    const failed = await logged(() => computeRoute(ends, at2, null));
    assert.deepEqual([failed.value.tolls, failed.lines], [null, [line]], line);
  }
  lincolnAnswers({ legs: LINCOLN_SPLIT });
  const late = await logged(() => computeRoute(ends, nycToUtc("2028-01-05", "14:00"), null));
  assert.deepEqual([late.value.tolls, late.lines], [null, ["route-tolls stale"]]);
  sent = lincolnAnswers({ legs: LINCOLN_SPLIT, first: { travelAdvisory: { tollInfo: { estimatedPrice: [money("0", 0)] } } } });
  assert.deepEqual([(await computeRoute(ends, at2, null)).tolls, sent.length], [OFF_PEAK, 1]);
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
});

await test("bookings into New Jersey over the Lincoln Tunnel get the Tolls line: 350 5th Ave to 1332 Clinton St, Hoboken is $0 plus the return crossing, $14.79 at 2:00 PM and $16.79 at 6:00 PM, 500 8th Ave to 1 Hackensack Ave, Weehawken $14.79, round trips pay Google's $20.79 into New York and the return crossing on the ride into New Jersey, and through Stripe, the metadata and the receipt; a drop-off in 2028 keeps no Tolls line and tolls after the ride", async () => {
  mock();
  const base = { trip_type: "one", from_text: MANHATTAN, to_text: HOB_LABEL, to_ticket: signed("mock-clinton", HOB_LABEL), date: "2026-12-01", time: "14:00", passengers: "2", class: "suv", action: "pay", ...ME };
  const { trip, price } = await priced(base, R_NOW);
  assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate, price.notes], [{ tenths: 38, minutes: 19, tolls: OFF_PEAK }, OFF_PEAK, OFF_PEAK, [POLICY.later.distance]]);
  assert.deepEqual(shownLines(price.lines).find((item) => item.label === "Tolls").cents, OFF_PEAK);
  const { metadata, items } = built(trip, price);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents], [String(OFF_PEAK), String(OFF_PEAK)]);
  assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
  assert.equal((await priced({ ...base, time: "18:00" }, R_NOW)).trip.legs[0].ride.tolls, PEAK);
  const weehawken = await priced({ ...base, from_text: EIGHTH, to_text: WEE_LABEL, to_ticket: signed("mock-weehawken", WEE_LABEL) }, R_NOW);
  assert.deepEqual([weehawken.trip.legs[0].ride, weehawken.price.tolls], [{ tenths: 28, minutes: 12, tolls: OFF_PEAK }, OFF_PEAK]);
  const round = await priced({ ...base, return: "1", return_date: "2026-12-01", return_time: "18:00" }, R_NOW);
  assert.deepEqual([round.trip.legs.map((item) => item.ride), round.price.tolls, round.price.estimate], [[{ tenths: 38, minutes: 19, tolls: OFF_PEAK }, { tenths: 39, minutes: 24, tolls: 2079 }], OFF_PEAK + 2079, OFF_PEAK + 2079]);
  const home = await priced({ ...base, from_text: HOB_LABEL, from_ticket: signed("mock-clinton", HOB_LABEL), to_text: MANHATTAN, to_ticket: undefined, return: "1", return_date: "2026-12-01", return_time: "18:00" }, R_NOW);
  assert.deepEqual([home.trip.legs.map((item) => item.ride.tolls), home.price.tolls], [[2079, PEAK], 2079 + PEAK]);
  const late = await logged(() => priced({ ...base, date: "2028-01-05" }, new Date("2027-11-24T15:00:00.000Z")));
  assert.deepEqual([late.value.trip.legs[0].ride, late.value.price.tolls, late.value.price.estimate, tollsIn(late.value.trip), shownLines(late.value.price.lines).map(({ label }) => label)], [{ tenths: 38, minutes: 19 }, 0, null, false, ["Fare", "Service fee"]]);
  assert.ok(late.lines.includes("route-tolls stale"), JSON.stringify(late.lines));
});

const LINCOLN_NY_PORTAL = [40.75887, -73.9992];
const LINCOLN_NJ_PORTAL = [40.76654, -74.02291];
const DYER_34TH = [40.75393, -73.99757];
const RAMP_37TH = [40.75533, -73.995];
const WILLOW_RAMP = [40.76179, -74.02659];
const PRODUCTION_LINCOLN = [[40.758471, -73.998027, 300], [40.767469, -74.020878, 272]];
const WASHINGTON_HEIGHTS_FORT_LEE = "uyixFvlgbMtH|C`F|FoAvK?\\u@jH@hAJT]vCKJu@tHIbBFR_W`yBG^SH}ArGUhBEb@Or@KHOEGM@s@PiBXsA\\k@f@{@Le@l@gDsBu@Mf@iBfE|Ax@BF@R]|AS`BOvDMvASbBhMxG";
const SOHO_JERSEY_CITY = "owpwF|aubMeA[YzEKl@Q`AYn@[`@g@Ty@AKB_AEs@Re@X]`@Wj@Qn@Ix@s@dOm@nI_A|SOdCkB`SoAzLgC|XUzDmAnZIvBUjBmDzOa@pAm@rAm@fAoAjBo@|AQj@S`Ay@zRlHl@JgBNQRaElKx@XCjr@`GxAJFHRB|EaUl@kC?a@z@qFHi@xCZlCPv@{M";
const WEE = { placeId: "mock-weehawken" };

await test("the cuts around a tunnel into New Jersey sit on the streets outside the Port Authority's roads: on the live lines from 350 5th Ave and 500 8th Ave the first cut is on West 34th or West 37th Street at least 100 m before Dyer Avenue or the 37th Street ramp and the second on Willow Avenue past the ramps from the helix, where production cut 1,868 m and 1,061 m along the December 2 lines, on the Lincoln Tunnel Expressway before the New York portal, and again inside the tube in New Jersey; the Holland cuts sit before the Watts Street ramp and before the Turnpike's Newark Bay Extension; a line that starts or ends on the tunnel roads keeps the tunnel part to its end, a line 90 m beside the tube is no tunnel part, and the George Washington Bridge into New Jersey, which Google prices, keeps no plan", () => {
  const meters = (line, point) => Math.round(along(line, point).at);
  const MAN = { address: MANHATTAN };
  const HOB = { placeId: "mock-clinton" };
  const cases = [
    ["350 5th Ave to 1332 Clinton St, December 1", lineOf([MAN, HOB], "2026-12-01", "14:00"), DYER_34TH, [1121, 1942, 4217, 4840], [913, 4960], [1833, 4010]],
    ["350 5th Ave to 1332 Clinton St, December 2", lineOf([MAN, HOB], "2026-12-02", "14:00"), DYER_34TH, [1156, 1976, 4252, 4875], [948, 4995], [1868, 4045]],
    ["500 8th Ave to 1 Hackensack Ave, December 2", lineOf([{ address: EIGHTH }, WEE], "2026-12-02", "14:00"), RAMP_37TH, [415, 1170, 3445, 4068], [281, 4188], [1061, 3238]],
  ];
  for (const [name, line, entry, marks, cuts, before] of cases) {
    assert.deepEqual([entry, LINCOLN_NY_PORTAL, LINCOLN_NJ_PORTAL, WILLOW_RAMP].map((point) => meters(line, point)), marks, name);
    assert.deepEqual(tollPlan(line, []).marks.map(({ cut }) => meters(line, [cut.latitude, cut.longitude])), cuts, name);
    assert.deepEqual(PRODUCTION_LINCOLN.map((cut) => meters(line, cut)), before, name);
    assert.ok(cuts[0] <= marks[0] - 100 && cuts[1] >= marks[3] + 100, name);
    assert.ok(before[0] > marks[0] && before[0] < marks[1] && before[1] < marks[2], name);
  }
  assert.deepEqual(tollPlan(cases[1][1], []), { marks: LINCOLN_CUTS, legs: LINCOLN_LEGS });
  const owner = lineOf([{ address: T4_ADDRESS }, { placeId: "mock-communipaw" }], "2026-12-01", "17:00");
  const holland = [[40.72384, -74.00622], [40.72501, -74.00697], [40.73056, -74.03633], [40.73197, -74.04605]].map((point) => meters(owner, point));
  const hollandCuts = tollPlan(owner, []).marks.map(({ cut }) => meters(owner, [cut.latitude, cut.longitude]));
  assert.deepEqual([holland, hollandCuts], [[30680, 30843, 33445, 34300], [30543, 34033]]);
  assert.ok(hollandCuts[0] <= holland[0] - 100 && hollandCuts[1] > holland[2] && holland[3] - hollandCuts[1] >= 200);
  assert.deepEqual(tollPlan(decodePath(SOHO_JERSEY_CITY), []), { marks: [{ cut: { latitude: 40.728387, longitude: -74.039978, heading: 186 } }], legs: [{ tolls: [{ kind: "free", id: "holland", share: 0.298 }] }, null] });
  const eighth = cases[2][1];
  const arcs = arcsOf(eighth);
  assert.deepEqual(tollPlan(eighth.slice(arcs.findIndex((at) => at >= 600)), []), { marks: [WILLOW_CUT], legs: [{ tolls: [{ kind: "free", id: "lincoln", share: 0.346 }] }, null] });
  assert.deepEqual(tollPlan(eighth.slice(0, arcs.findIndex((at) => at >= 4000) + 1), []), { marks: [EIGHTH_CUTS[0]], legs: [null, { tolls: [{ kind: "free", id: "lincoln", share: 0.421 }] }] });
  const bridge = decodePath(WASHINGTON_HEIGHTS_FORT_LEE);
  assert.deepEqual([intoJersey(bridge), tollPlan(bridge, [])], [true, { reason: "none" }]);
  const beside = [[40.76098, -74.00299], [40.76242, -74.00601], [40.76492, -74.01201], [40.76642, -74.01561]];
  assert.deepEqual([intoJersey(beside), tollPlan(beside, [])], [true, { reason: "none" }]);
});

const GRAND_CENTRAL_HOBOKEN = "}pvwFjpobML[iCaBo@Ui@DQZKD_B_AqGgEcB}@mApDsRnm@gBrF}C~JmWvx@nVfPh@ZN?pIlF\\iALIZe@h@_BNIHFHpA[lDY~AUx@?Lqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAlAf@JXt@p@jBtCl@j@bAh@dCbAP?lBhApC|BVPL?n@h@vAv@r@XjE`Axg@nKc@`E{EaA";
const BATTERY_PARK_WEEHAWKEN = "_qnwFzdwbMDLLBBCRCLBVTx@oCDIFWLIj@aB{@O_Ec@_Dg@iBc@iEiAyJ{A{F_AqKyAoSeC}QwBqF_@_Mi@oR{@_]sAuA?yEXaAGo@MsAm@oBcA_A]{E{@}ASDWOmAUw@uH_FaOqJcb@qXrAmE?YOUyH{EqBq@_Ag@c@Wc@_AS_Ag@oDQs@_@w@cAmAw@{@q@c@YGS@u@Pa@Tm@n@wEjJ_BvEc@pBk@rD_@rAqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAlAf@JXt@p@jBtCl@j@bAh@dCbAP?lBhApC|BVPL?n@h@vAv@r@X`@JSrBpGtG";
const EMPIRE_SECAUCUS = "owuwFzhqbMsLf_@aBrFmG~RwAfEuBxGoCoB{AwBeCkEi@o@_@Wk@Ia@Bm@Xi@f@o@dA}DhIwAjEa@fBk@rD_@rAqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAtClAzB~Ab@Jt@Kr@[`@_@\\k@Rs@H{@AaAOw@[u@_@c@k@_@uDwAsDaAaDo@aDc@aA@}@Pw@`@m@h@q@hAsJ`Y}FpR{A~DcHrQsBbGmB`H{ClLqC`LkDzMOF[bAm@rAm@`AaAfAuEvE}AhAqBhAUE{M~CyH`B}@QYUO_@Ek@Fi@PYnA_Aj@Q\\@VTJ\\B^MlAKh@kCtJm@~AS^}CrEOg@Hu@Jg@`@wAWm@WeAWSc@Na@NH`@";
const LINK_40TH = [40.7593, -73.99874];
const DYER_30TH = [40.75191, -73.99958];
const HELIX_TOP = [40.76476, -74.0218];

await test("the other live approaches to the Lincoln Tunnel into New Jersey on December 2 get the same cuts outside the Port Authority roads: 89 E 42nd St to 1332 Clinton St at 5:00 PM by 11th Avenue and the West 40th Street ramp, 200 Vesey St to 1 Hackensack Ave by 10th Avenue and Dyer Avenue at West 30th Street, and 350 5th Ave to 1 Harmon Meadow Blvd, Secaucus, which leaves the helix on Route 495, are cut at least 100 m before the first Port Authority road and 100 m past the ramps or the top of the helix, where production cut between that road and the New York portal and inside the tube in New Jersey", () => {
  const cases = [
    ["89 E 42nd St to 1332 Clinton St", GRAND_CENTRAL_HOBOKEN, [LINK_40TH, LINCOLN_NY_PORTAL, LINCOLN_NJ_PORTAL, WILLOW_RAMP], [3240, 3421, 5696, 6319], [{ cut: { latitude: 40.760345, longitude: -73.998596, heading: 208 } }, WILLOW_CUT], 0.305, [3092, 6439], [[40.758926, -73.998059], [40.767469, -74.020878]], [3312, 5489]],
    ["200 Vesey St to 1 Hackensack Ave", BATTERY_PARK_WEEHAWKEN, [DYER_30TH, LINCOLN_NY_PORTAL, LINCOLN_NJ_PORTAL, WILLOW_RAMP], [5164, 6297, 8572, 9195], [{ cut: { latitude: 40.752066, longitude: -74.000986, heading: 29 } }, WILLOW_CUT], 0.458, [5018, 9315], [[40.758477, -73.998024], [40.767469, -74.020878]], [6189, 8365]],
    ["350 5th Ave to 1 Harmon Meadow Blvd", EMPIRE_SECAUCUS, [DYER_34TH, LINCOLN_NY_PORTAL, LINCOLN_NJ_PORTAL, HELIX_TOP], [1156, 1976, 4252, 5080], [LINCOLN_CUTS[0], { cut: { latitude: 40.77156, longitude: -74.030099, heading: 302 } }], 0.324, [948, 6255], PRODUCTION_LINCOLN, [1868, 4045]],
  ];
  for (const [name, text, points, marks, cuts, share, at, production, before] of cases) {
    const line = decodePath(text);
    const meters = (point) => Math.round(along(line, point).at);
    assert.deepEqual(points.map(meters), marks, name);
    assert.deepEqual([intoJersey(line), tollPlan(line, [])], [true, { marks: cuts, legs: [null, { tolls: [{ kind: "free", id: "lincoln", share }] }, null] }], name);
    assert.deepEqual(cuts.map(({ cut }) => meters([cut.latitude, cut.longitude])), at, name);
    assert.deepEqual(production.map(meters), before, name);
    assert.ok(at[0] <= marks[0] - 100 && at[1] >= marks[3] + 100, name);
    assert.ok(before[0] > marks[0] && before[0] < marks[1] && before[1] < marks[2], name);
  }
});

await test("the live failure on December 2 at 2:00 PM and the fix: with production's waypoints Google's first part from 350 5th Ave or 500 8th Ave holds the Lincoln Tunnel approach and has tolls with no price, route-tolls unpriced leg 1/3 plan g,free,g as in the live log, and with the new cuts both other parts have no toll, the tunnel part is $0 and the toll is the return crossing alone, $14.79 for a drop-off before 4:00 PM or after 8:00 PM and $16.79 in the peak, with no log line", async () => {
  mock();
  const departure = nycToUtc("2026-12-02", "14:00");
  for (const [ends, minutes, tenths, detail] of [
    [[{ address: MANHATTAN }, { placeId: "mock-clinton" }], 20, 38, "leg 1/3 1858m plan g,free,g"],
    [[{ address: EIGHTH }, WEE], 12, 28, "leg 1/3 1056m plan g,free,g"],
  ]) {
    const line = lineOf(ends, "2026-12-02", "14:00");
    const plan = tollPlan(line, []);
    const meters = mockRoute(null, ends, departure).miles * 1609.344;
    const old = mockSplit(splitBody(ends, departure, PRODUCTION_LINCOLN)).routes[0];
    assert.deepEqual(old.legs.map((item) => Boolean(item.travelAdvisory)), [true, true, true], detail);
    assert.deepEqual(priceSplit({ ...plan, legs: [null, { tolls: [{ kind: "free", id: "lincoln", share: 0.368 }] }, null] }, old, departure, meters), { reason: "unpriced", detail });
    const fresh = mockSplit(splitBody(ends, departure, plan.marks.map(({ cut }) => [cut.latitude, cut.longitude, cut.heading]))).routes[0];
    assert.deepEqual(fresh.legs.map((item) => Boolean(item.travelAdvisory)), [false, true, false], detail);
    assert.deepEqual(priceSplit(plan, fresh, departure, meters), { cents: 0 }, detail);
    const { value, lines } = await logged(() => computeRoute(ends, departure, null));
    assert.deepEqual([value.ok, value.minutes, Math.round(value.miles * 10), value.tolls, lines], [true, minutes, tenths, OFF_PEAK, []], detail);
    const dropOff = (time) => new Date(nycToUtc("2026-12-02", time).getTime() + minutes * 60000);
    assert.deepEqual(["14:00", "15:30", "15:50", "17:00", "19:35", "20:00"].map((time) => returnCents(line, dropOff(time))), [OFF_PEAK, OFF_PEAK, PEAK, PEAK, PEAK, OFF_PEAK], detail);
  }
});

await test("bookings on December 2 into New Jersey over the Lincoln Tunnel: 350 5th Ave to 1332 Clinton St and 500 8th Ave to 1 Hackensack Ave pay the return crossing alone, $14.79 at 2:00 PM and $16.79 at 5:00 PM, through Stripe, the metadata and the receipt, while JFK T4 to 500 Communipaw Ave at 5:00 PM stays at Google's $10.41 plus $16.79 and 1332 Clinton St to 350 5th Ave at Google's $20.79", async () => {
  mock();
  const base = { trip_type: "one", from_text: MANHATTAN, to_text: HOB_LABEL, to_ticket: signed("mock-clinton", HOB_LABEL), date: "2026-12-02", time: "14:00", passengers: "2", class: "suv", action: "pay", ...ME };
  const weehawken = { ...base, from_text: EIGHTH, to_text: WEE_LABEL, to_ticket: signed("mock-weehawken", WEE_LABEL) };
  for (const [fields, ride] of [
    [base, { tenths: 38, minutes: 20, tolls: OFF_PEAK }],
    [{ ...base, time: "17:00" }, { tenths: 38, minutes: 20, tolls: PEAK }],
    [weehawken, { tenths: 28, minutes: 12, tolls: OFF_PEAK }],
    [{ ...weehawken, time: "17:00" }, { tenths: 28, minutes: 12, tolls: PEAK }],
  ]) {
    const { trip, price } = await priced(fields, R_NOW);
    assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate, price.notes], [ride, ride.tolls, ride.tolls, [POLICY.later.distance]], `${fields.from_text} ${fields.time}`);
    const { metadata, items } = built(trip, price);
    assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, items.find(([label]) => label === "Tolls")], [String(ride.tolls), String(ride.tolls), ["Tolls", ride.tolls]]);
    assert.deepEqual(shownLines(receipt(metadata, ON).lines).map(({ label, cents }) => [label, cents]), items);
  }
  assert.equal((await priced(OWNER_JC(R_NOW), R_NOW)).price.tolls, HOLLAND_GOOGLE + PEAK);
  const home = await priced({ ...base, from_text: HOB_LABEL, from_ticket: signed("mock-clinton", HOB_LABEL), to_text: MANHATTAN, to_ticket: undefined }, R_NOW);
  assert.deepEqual([home.trip.legs[0].ride.tolls, home.price.tolls], [2079, 2079]);
});

await test("the second Routes call has its own budget per instance: once 60 split calls are spent in the window, the route keeps today's behavior, logs route-tolls budget and Google is asked only once", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  while (instanceBudget("route-split", 60));
  const sent = googleAnswers();
  const { value, lines } = await logged(() => computeRoute(OWNER_ENDS, nycToUtc("2026-11-09", "14:00"), null));
  assert.deepEqual([value.ok, value.minutes, value.miles, value.tolls, lines, sent.length], [true, 79, 52.5, null, ["route-tolls budget"], 1]);
  assert.equal(googleUp(), true);
  const priced = googleAnswers({ first: { travelAdvisory: { tollInfo: { estimatedPrice: [money("14", 790000000)] } } } });
  assert.deepEqual([(await computeRoute(OWNER_ENDS, nycToUtc("2026-11-09", "14:00"), null)).tolls, priced.length], [1479, 1]);
});

if (failures) {
  console.error(`\n${failures} toll test(s) failed`);
  process.exit(1);
}
console.log("\nAll toll tests passed");
