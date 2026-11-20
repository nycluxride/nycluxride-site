import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceRide, receipt, shownLines, serviceLabel, laterNotes, tollsIn, bookingData } from "../api/_trip.mjs";
import { tollCents, computeRoute, TOLL_PASSES } from "../api/_google.mjs";
import { readRoute, signRoute, routeKey, ROUTE } from "../api/_ticket.mjs";
import { sessionParams, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters, bookingEvents } from "../api/_mail.mjs";
import { POST as routePost } from "../api/route.mjs";
import { POST as bookPost } from "../api/book.mjs";
import { CHECKOUT, NOTES, POLICY, LABELS } from "../api/_copy.mjs";
import { AIRPORT_TOTALS, BCF_PERCENT, NYC_TAX_PERCENT, STOP_FEE_CENTS, percentCents } from "../api/_rates.mjs";
import { distanceFare } from "../api/_trip.mjs";

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
const fare = (cls, tenths, minutes, airport = "ewr") => priceRide(cls, { tenths, minutes }, [airport], "0").fare;

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

await test("the Routes request asks for tolls the way Google documents it: extraComputations TOLLS, the tollInfo field mask, a gasoline car and the Northeast E-ZPass passes, and reads the estimate into cents", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = "toll-test-key";
  const calls = [];
  let body = { routes: [{ duration: "3840s", distanceMeters: 84490, ...tolled(money("16", 790000000), money("5", 710000000)) }] };
  globalThis.fetch = async (url, init) => (calls.push({ url: String(url), init }), new Response(JSON.stringify(body), { status: 200 }));
  const result = await computeRoute([{ address: EWR_ADDRESS }, { address: RIVERSIDE }], new Date("2026-10-14T11:30:00.000Z"), null);
  assert.deepEqual([result.ok, result.minutes, result.miles, result.tolls], [true, 64, 52.5, 2250]);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual([sent.extraComputations, sent.routeModifiers], [["TOLLS"], { vehicleInfo: { emissionType: "GASOLINE" }, tollPasses: TOLL_PASSES }]);
  assert.deepEqual(TOLL_PASSES, ["US_NY_EZPASSNY", "US_NJ_EZPASSNJ", "US_PA_EZPASSPA", "US_DE_EZPASSDE", "US_MD_EZPASSMD", "US_MA_EZPASSMA", "US_RI_EZPASSRI", "US_NH_EZPASSNH", "US_ME_EZPASSME"]);
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

if (failures) {
  console.error(`\n${failures} toll test(s) failed`);
  process.exit(1);
}
console.log("\nAll toll tests passed");
