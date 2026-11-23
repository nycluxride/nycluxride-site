import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceRide, receipt, shownLines, serviceLabel, laterNotes, tollsIn, bookingData, rateKey } from "../api/_trip.mjs";
import { tollCents, computeRoute, googleUp, TOLL_PASSES } from "../api/_google.mjs";
import { decodePath, tollPlan, priceSplit, arcsOf, project, crossingCents, tollClassOf, TOLL_GROUP } from "../api/_tolls.mjs";
import { mockRoute, mockSplit } from "../api/_mock.mjs";
import { readRoute, signRoute, routeKey, ROUTE } from "../api/_ticket.mjs";
import { sessionParams, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters, bookingEvents } from "../api/_mail.mjs";
import { POST as routePost } from "../api/route.mjs";
import { POST as bookPost } from "../api/book.mjs";
import { CHECKOUT, NOTES, POLICY, LABELS } from "../api/_copy.mjs";
import { AIRPORT_TOTALS, BCF_PERCENT, NYC_TAX_PERCENT, STOP_FEE_CENTS, TOLL_CLASS, PA_TOLLS, PA_PEAK, NJTP_TOLLS, TOLL_TABLE_UNTIL, percentCents } from "../api/_rates.mjs";
import { instanceBudget } from "../api/_http.mjs";
import { distanceFare, nycToUtc } from "../api/_trip.mjs";

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
const CLASSES = ["suv", "premium", "first", "sedan", "sprinter"];
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
const fare = (cls, tenths, minutes, airport = "ewr") => priceRide(rateKey(cls), { tenths, minutes }, [airport], "0").fare;

async function run(fields, now = NOW) {
  const trip = await resolveTrip(readInput(fields), { now });
  const check = checkTrip(trip, now, ON);
  return { trip, check, price: check.kind === "price" && !check.reason ? priceTrip(trip, ON) : null };
}

async function priced(fields, now = NOW) {
  const out = await run(fields, now);
  assert.deepEqual(out.check, { kind: "price", reason: "", hold: "" }, JSON.stringify(fields));
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

await test("the owner's trip, Newark Liberty (EWR) to 19 Coventry Ln, Riverside, CT, 52.5 miles and 64 min: every class adds the Google toll estimate as a Tolls line, untaxed and outside the gratuity, and the after the ride note drops tolls", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  assert.deepEqual(trip.legs.map((leg) => leg.ride), [{ tenths: 525, minutes: 64, tolls: 2250 }]);
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", 21450], ["Taxes and fees", 483], ["Tolls", 2250]]);
  assert.deepEqual([price.fare, price.tax, price.bcf, price.tolls, price.estimate, price.total, price.service], [21450, 0, 483, 2250, 2250, 24183, "distance"]);
  assert.deepEqual(price.notes, [POLICY.later.waiting]);
  assert.equal(POLICY.later.waiting, "Extra waiting and parking are charged to your card after the ride.");
  const totals = [];
  for (const cls of CLASSES) {
    const p = (await priced({ ...OWNER, class: cls, passengers: "2" })).price;
    const f = fare(cls, 525, 64);
    assert.deepEqual([p.fare, p.tax, p.bcf, p.tolls, p.total], [f, 0, percentCents(f, BCF_PERCENT), 2250, f + percentCents(f, BCF_PERCENT) + 2250], cls);
    totals.push(p.total);
  }
  assert.deepEqual(totals, [31555, 37586, 41947, 24183, 68232]);
  const tipped = (await priced({ ...OWNER, tip: "20" })).price;
  assert.deepEqual([tipped.tip, tipped.value, tipped.total], [percentCents(21450, "20"), 21450, 24183 + 4290]);
});

await test("tolls are never taxed: a New York trip with tolls pays NYC sales tax and the Black Car Fund on the fare only, and the gratuity is on the fare only", () => {
  const ride = { tenths: 142, minutes: 35, tolls: 750 };
  const p = priceRide("suv", ride, [], NYC_TAX_PERCENT);
  const f = distanceFare("suv", 142, 35);
  assert.deepEqual(p, { fare: f, tax: percentCents(f, NYC_TAX_PERCENT), bcf: percentCents(f, BCF_PERCENT), tolls: 750, total: f + percentCents(f, NYC_TAX_PERCENT) + percentCents(f, BCF_PERCENT) + 750 });
  assert.deepEqual(priceRide("suv", { tenths: 142, minutes: 35 }, [], NYC_TAX_PERCENT).tolls, 0);
  const trip = { trip_type: "one", class: "suv", tip: 15, passengers: "2", legs: [{ from: "manhattan", to: "staten-island", airport: "", direction: "", back: false, reason: "", salesTax: { area: "3630", percent: NYC_TAX_PERCENT }, ride }] };
  const price = priceTrip(trip);
  assert.deepEqual([price.tax, price.tolls, price.tip, price.value, price.estimate], [percentCents(f, NYC_TAX_PERCENT), 750, percentCents(f, "15"), f, 750]);
  assert.deepEqual(pairs(price.lines), [["Fare", f], [LABELS.tax, percentCents(f, NYC_TAX_PERCENT)], [LABELS.bcf, percentCents(f, BCF_PERCENT)], [LABELS.tolls, 750], [LABELS.gratuity.replace("{rate}", "15"), percentCents(f, "15")]]);
  assert.deepEqual(price.notes, [POLICY.later.distance]);
  assert.equal(POLICY.later.distance, "Parking is charged to your card after the ride.");
});

await test("Stripe: the line items carry Tolls, the Checkout text says only extra waiting and parking come after the ride, the metadata adds tolls_est_cents, and the receipt rebuilds the same lines and notes", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  const { metadata, items, submit } = built(trip, price);
  assert.deepEqual(items, [["Fare", 21450], ["Taxes and fees", 483], ["Tolls", 2250]]);
  assert.equal(submit, CHECKOUT.submitOutsideTolled);
  assert.equal(CHECKOUT.submitOutsideTolled, "You pay the total shown today. Extra waiting and parking are charged to this card after the ride, with a receipt.");
  assert.deepEqual([metadata.service, metadata.tolls_cents, metadata.tolls_est_cents, metadata.total_cents, metadata.miles, metadata.minutes], ["distance", "2250", "2250", "24183", "52.5", "64"]);
  const rebuilt = receipt(metadata, ON);
  assert.deepEqual(shownLines(rebuilt.lines).map(({ label, cents }) => [label, cents]), items);
  assert.deepEqual(rebuilt.notes, price.notes);
  assert.equal(rebuilt.summary, "Wed, Oct 14, 2026, 7:30 AM. Sedan & Electric, 52.5 miles and 64 min.");
  assert.equal(rebuilt.value, 21450);
});

await test("emails and the calendar: both letters list Tolls with the paid total and the new note, and the calendar event keeps the drive time of the ride", async () => {
  mock();
  const { trip, price } = await priced(OWNER);
  const { metadata } = built(trip, price);
  const letters = bookingLetters(session(metadata), { owners: ["owner@example.com"] }, NOW.getTime());
  assert.deepEqual(letters.map((l) => l.kind), ["customer", "owner"]);
  for (const letter of letters) {
    const text = letter.text.split("\n");
    const at = text.indexOf("Fare: $214.50");
    assert.deepEqual(text.slice(at, at + 6), ["Fare: $214.50", "Taxes and fees: $4.83", "Tolls: $22.50", "Paid: $241.83", "", POLICY.later.waiting], letter.kind);
    assert.ok(!letter.text.includes(POLICY.later.outside), letter.kind);
    assert.ok(letter.html.includes("Tolls") && letter.html.includes("$22.50"), letter.kind);
  }
  const events = bookingEvents(session(metadata));
  assert.equal(events.length, 1);
  assert.equal((new Date(events[0].end.dateTime) - new Date(events[0].start.dateTime)) / 60000, 64);
  assert.ok(events[0].description.includes("Paid: $241.83"));
});

await test("round trip: each direction is estimated on its own route, $22.50 out over the George Washington Bridge and $5.71 back, one Tolls line of $28.21, and the metadata, receipt and calendar keep both rides", async () => {
  mock();
  const { trip, price } = await priced({ ...OWNER, ...BACK });
  assert.deepEqual(trip.legs.map((leg) => [leg.back, leg.ride]), [[false, { tenths: 525, minutes: 64, tolls: 2250 }], [true, { tenths: 529, minutes: 70, tolls: 571 }]]);
  assert.deepEqual(price.legs.map((leg) => leg.tolls), [2250, 571]);
  const f = fare("sedan", 525, 64) + fare("sedan", 529, 70);
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", f], ["Taxes and fees", percentCents(fare("sedan", 525, 64), BCF_PERCENT) + percentCents(fare("sedan", 529, 70), BCF_PERCENT)], ["Tolls", 2821]]);
  assert.deepEqual([price.estimate, price.notes], [2821, [POLICY.later.waiting]]);
  const { metadata, items, submit } = built(trip, price);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, metadata.legs, submit], ["2821", "2821", "2", CHECKOUT.submitOutsideTolled]);
  const rebuilt = receipt(metadata, ON);
  assert.deepEqual(shownLines(rebuilt.lines).map(({ label, cents }) => [label, cents]), items);
  assert.deepEqual(rebuilt.notes, [POLICY.later.waiting]);
  assert.equal(rebuilt.summary, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. Sedan & Electric, 2 rides, 105.4 miles and 134 min.");
  const events = bookingEvents(session(metadata));
  assert.deepEqual(events.map((event) => (new Date(event.end.dateTime) - new Date(event.start.dateTime)) / 60000), [67, 67]);
});

await test("round trip with a flat airport return: the ride out by distance adds its toll estimate to the flat return's tolls and airport fees, the notes and Checkout text say tolls and airport fees are included, and the receipt still finds the flat return", async () => {
  mock();
  const fields = { ...OWNER, stop1_text: STEAMBOAT, to_text: MANHATTAN, ...BACK };
  const { trip, price } = await priced(fields);
  assert.deepEqual(trip.legs.map((leg) => [leg.back, Boolean(leg.flat), leg.ride && leg.ride.tolls]), [[false, false, 2250], [true, true, undefined]]);
  const flatReturn = AIRPORT_TOTALS.sedan.ewr - 15379 - percentCents(15379, BCF_PERCENT);
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
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", 21450], ["Taxes and fees", 483], ["Tolls", 2250], ["Extra stop", STOP_FEE_CENTS]]);
  assert.equal(price.total, 21450 + 483 + 2250 + STOP_FEE_CENTS);
  assert.equal(serviceLabel(trip), "Sedan & Electric, 55.1 miles and 72 min");
  const sprinter = (await priced({ ...fields, class: "sprinter", passengers: "2" })).price;
  const whole = fare("sprinter", 551, 72);
  assert.deepEqual([sprinter.fare, sprinter.tolls, sprinter.stops, sprinter.total], [whole, 2250, 0, whole + percentCents(whole, BCF_PERCENT) + 2250]);
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
  const whole = priceRide("premium", { tenths: 200, minutes: 70 }, ["lga"], NYC_TAX_PERCENT).total;
  assert.deepEqual([flat, whole], [23000, 21781]);
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
  assert.deepEqual(short, Array(3).fill([flat, "airport", AIRPORT_TOTALS.premium.lga - 15950 - percentCents(15950, NYC_TAX_PERCENT) - percentCents(15950, BCF_PERCENT), 2 * STOP_FEE_CENTS]));
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
  assert.deepEqual(shownLines(price.lines).map(({ label }) => label), ["Fare", "Taxes and fees"]);
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
  assert.deepEqual(shownLines(price.lines).map(({ label }) => label), ["Fare", "Taxes and fees"]);
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
  assert.deepEqual([tollsIn(trip), price.tolls, price.estimate, price.notes, shownLines(price.lines).map((l) => l.label)], [false, 0, null, [POLICY.later.hourly], ["Fare", "Taxes and fees"]]);
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
  assert.deepEqual(answer.price.lines.map(({ label, cents }) => [label, cents]), [["Fare", 21450], ["Taxes and fees", 483], ["Tolls", 2250]]);
  assert.deepEqual([answer.price.total_cents, answer.price.notes, answer.classes.map((c) => c.total_cents)], [24183, [POLICY.later.waiting], [31555, 37586, 41947, 24183, 68232]]);
  assert.match(answer.route, ROUTE);
});

await test("the Luxury Sprinter pays the same toll estimate as every class", async () => {
  mock();
  const { price } = await priced({ ...OWNER, class: "sprinter", passengers: "9" });
  assert.deepEqual([price.tolls, shownLines(price.lines).find((l) => l.label === "Tolls").cents, price.total], [2250, 2250, 68232]);
});

await test("hourly is unaffected: no Tolls line, tolls still charged after the ride, no tolls_est_cents, and Google is never asked", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  let asked = 0;
  globalThis.fetch = async () => (asked++, new Response("{}", { status: 503 }));
  const { trip, price } = await priced({ trip_type: "hour", from_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "2", hours: "3", class: "sedan", action: "pay", ...ME });
  assert.deepEqual([price.tolls, price.estimate, price.notes, shownLines(price.lines).map((l) => l.label)], [0, null, [POLICY.later.hourly], ["Fare, 3 hours", "Taxes and fees"]]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, "tolls_est_cents" in metadata, receipt(metadata, ON).notes, asked], [CHECKOUT.submitHourly, false, [POLICY.later.hourly], 0]);
});

await test("flat airport transfers are unaffected: Manhattan to Newark keeps its fixed tolls and airport fees, its notes and Checkout text, and Google is never asked", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  let asked = 0;
  globalThis.fetch = async () => (asked++, new Response("{}", { status: 503 }));
  const { trip, price } = await priced({ ...OWNER, from_text: MANHATTAN, from_id: "", to_text: "Newark Liberty (EWR)", to_id: "ewr", class: "suv" });
  assert.deepEqual([price.service, price.total, price.tolls, price.estimate, price.notes], ["airport", AIRPORT_TOTALS.suv.ewr, 1275, null, [NOTES.included, POLICY.later.airport]]);
  const { metadata, submit } = built(trip, price);
  assert.deepEqual([submit, "tolls_est_cents" in metadata, metadata.tolls_cents, receipt(metadata, ON).notes, asked], [CHECKOUT.submit, false, "1275", [NOTES.included, POLICY.later.airport], 0]);
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
  assert.deepEqual([TOLL_CLASS, TOLL_GROUP], [{ suv: "1", premium: "1", first: "1", sedan: "1", sprinter: "1" }, "1"]);
  assert.throws(() => tollClassOf({ ...TOLL_CLASS, sprinter: "2" }), /toll-config/);
  assert.throws(() => tollClassOf({ suv: "3", premium: "3", first: "3", sedan: "3", sprinter: "3" }), /toll-config/);
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
  assert.deepEqual(shownLines(price.lines).map(({ label, cents }) => [label, cents]), [["Fare", f], ["Taxes and fees", percentCents(f, BCF_PERCENT)], ["Tolls", 2224]]);
  assert.deepEqual([price.tolls, price.estimate, price.notes], [2224, 2224, [POLICY.later.waiting]]);
  const totals = [];
  for (const cls of CLASSES) {
    const p = (await priced({ ...WEEKDAY, class: cls }, LATER)).price;
    const cf = fare(cls, 525, 79);
    assert.deepEqual([p.fare, p.tolls, p.total], [cf, 2224, cf + percentCents(cf, BCF_PERCENT) + 2224], cls);
    totals.push(p.total);
  }
  assert.deepEqual(totals, [32526, 38787, 43301, 24924, 70430]);
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

await test("each direction of a round trip on its own: the ride out pays the bridge and the Turnpike, the way back into New Jersey pays only the Turnpike from 18W to 14, one Tolls line of $27.95, and the metadata and receipt keep it", async () => {
  mock();
  const back = await priced({ ...WEEKDAY, from_text: RIVERSIDE, from_id: "", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-13", time: "18:00" }, LATER);
  assert.deepEqual(back.trip.legs.map((item) => item.ride), [{ tenths: 509, minutes: 81, tolls: 571 }]);
  const { trip, price } = await priced({ ...WEEKDAY, ...HOME }, LATER);
  assert.deepEqual(trip.legs.map((item) => [item.back, item.ride.tolls]), [[false, 2224], [true, 571]]);
  assert.deepEqual([price.tolls, price.estimate, shownLines(price.lines).find((item) => item.label === "Tolls").cents, price.notes], [2795, 2795, 2795, [POLICY.later.waiting]]);
  const { metadata, items } = built(trip, price);
  assert.deepEqual([metadata.tolls_cents, metadata.tolls_est_cents, metadata.legs], ["2795", "2795", "2"]);
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
  assert.deepEqual([trip.legs[0].ride, price.tolls, price.estimate, price.notes, shownLines(price.lines).map((item) => item.label)], [{ tenths: 525, minutes: 79 }, 0, null, [POLICY.later.outside], ["Fare", "Taxes and fees"]]);
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

await test("the toll table ends on January 1, 2027 New York time: a table toll reached before then is priced, a table toll reached on or after it logs route-tolls stale and keeps today's behavior, so a pickup at 11:20 PM on December 31 is priced and one at 11:30 PM that reaches the bridge after midnight is not", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  assert.equal(TOLL_TABLE_UNTIL, "2027-01-01T00:00:00-05:00");
  assert.equal(Date.parse(TOLL_TABLE_UNTIL), nycToUtc("2027-01-01", "00:00").getTime());
  const cases = [
    [["2026-12-31", "14:00"], 571 + 1479 + 342, []],
    [["2026-12-31", "23:20"], 571 + 1479 + 342, []],
    [["2026-12-31", "23:30"], null, ["route-tolls stale"]],
    [["2026-12-31", "23:50"], null, ["route-tolls stale"]],
    [["2027-01-04", "14:00"], null, ["route-tolls stale"]],
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
  assert.deepEqual([price.service, price.total, price.tolls, price.estimate, price.notes, shownLines(price.lines).map((item) => item.label)], ["airport", AIRPORT_TOTALS.sedan.ewr, 1275, null, [NOTES.included, POLICY.later.airport], ["Fare", "Taxes and fees", "Tolls"]]);
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
