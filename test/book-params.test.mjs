import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, priceTrip, bookingRef, requestRef, composeMessage, contactLinks, formatDate, receipt } from "../api/_trip.mjs";
import { clientKey, clean } from "../api/_http.mjs";
import { sessionParams, encodeForm, metadataFor } from "../api/_stripe.mjs";
import { POST, GET } from "../api/book.mjs";
import { CHECKOUT, ERRORS, HEADINGS, REASONS, ERROR_BLOCK, NOTES, POLICY } from "../api/_copy.mjs";
import { DESCRIPTOR_CODES, AIRPORT_PLACES, CHECKOUT_ORIGINS, CONSENT_TERMS_LIVE, TIP_PERCENTS } from "../api/_rates.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const NOW = new Date("2026-10-01T16:00:00.000Z");
const SITE = "https://www.nycluxride.com";
const LOCAL = "http://127.0.0.1:4173";
const PREVIEW = "https://nycluxride-git-stripe-nlr.vercel.app";
const KEY = ["rk", "test", "51NlrFakeKeyUsedOnlyInTests"].join("_");
const LIVE_KEY = ["rk", "live", "51NlrFakeKeyUsedOnlyInTests"].join("_");
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5F6g7H8i9J0";
const DESCRIPTOR_PREFIX = "NYCLUXRIDE";
const ENV_KEYS = ["BOOKING_REF_SECRET", "PLACE_TICKET_SECRET", "STRIPE_SECRET_KEY", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT", "BOOK_MOCK", "VERCEL_ENV", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MOCK", "FLIGHT_MOCK", "FLIGHT_API_KEY"];
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const TERMS =
  "I agree to the [terms of service](https://www.nycluxride.com/terms-of-service#payments) and the [rates and cancellation terms](https://www.nycluxride.com/rates#cancellation). I allow charges to this card after the ride for waiting beyond the free window, extra stops, parking and, on hourly bookings, tolls, as the terms describe.";
const SUBMIT =
  "Today you pay the total shown: the fare, NYC sales tax, the Black Car Fund, tolls and airport fees, meet and greet if chosen, and the gratuity if you chose one. After the ride, only waiting beyond the free window, extra stops and parking are charged to this card, with an itemized receipt.";
const SUBMIT_HOURLY =
  "Today you pay the hourly fare, NYC sales tax, the Black Car Fund, meet and greet if chosen, and the gratuity if you chose one. After the ride, tolls and parking are charged to this card, with an itemized receipt.";
const AIRPORT_NOTE = "Tolls, airport fees, NYC sales tax and the Black Car Fund are included. After the ride, only waiting beyond the free window, extra stops and parking are charged to your card, each on an itemized receipt.";
const HOURLY_NOTE = "After the ride, tolls and parking are charged to your card, each on an itemized receipt.";
const AIRPORT_NOTES = [NOTES.included, POLICY.later.airport];

const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
const PICKUP = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", meet: "1", flight: "DL 401", tip: "15", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", notes: "Two large cases" };
const DROPOFF = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv" };
const HOURLY = { trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", rider: "me", ...ME, reach: "phone", notes: "A toddler seat, please" };
const ROUND = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", date: "2026-10-14", time: "07:30", passengers: "3", class: "first", return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "B6 1234", tip: "10", rider: "me", ...ME, pname: "Not Sent", pphone: "+1 917 555 0199", sign: "Not Sent Either" };

async function build(fields, settings, nonce, now = NOW, origin = SITE) {
  const trip = await resolveTrip(readInput(fields), { now });
  const price = priceTrip(trip, settings);
  const ref = bookingRef(nonce);
  return { trip, price, ref, params: sessionParams(trip, price, ref, settings, now, origin) };
}

function common(ref, { hourly = false, email = "" } = {}) {
  const fields = email ? { customer_email: email } : { "phone_number_collection[enabled]": "true", "name_collection[individual][enabled]": "true" };
  return {
    mode: "payment",
    ui_mode: "hosted_page",
    submit_type: "book",
    customer_creation: "always",
    "allowed_payment_method_types[0]": "card",
    "allowed_payment_method_types[1]": "link",
    "adaptive_pricing[enabled]": "false",
    "consent_collection[terms_of_service]": "required",
    "consent_collection[payment_method_reuse_agreement][position]": "auto",
    "custom_text[terms_of_service_acceptance][message]": TERMS,
    "custom_text[submit][message]": hourly ? SUBMIT_HOURLY : SUBMIT,
    "custom_text[after_submit][message]": `We confirm your car and chauffeur in writing before your ride. To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference ${ref}.`,
    ...fields,
    "payment_intent_data[setup_future_usage]": "off_session",
    client_reference_id: ref,
    success_url: "https://www.nycluxride.com/booking-confirmed?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://www.nycluxride.com/book#resume",
    expires_at: "1790872260",
  };
}

function bothMetadata(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[`payment_intent_data[metadata][${key}]`] = value;
    out[`metadata[${key}]`] = value;
  }
  return out;
}

function lines(items) {
  const out = {};
  items.forEach(([name, amount, description], i) => {
    out[`line_items[${i}][quantity]`] = "1";
    out[`line_items[${i}][price_data][currency]`] = "usd";
    out[`line_items[${i}][price_data][unit_amount]`] = String(amount);
    out[`line_items[${i}][price_data][product_data][name]`] = name;
    if (description) out[`line_items[${i}][price_data][product_data][description]`] = description;
  });
  return out;
}

const TAX = "NYC sales tax (8.875%)";
const BCF = "Black Car Fund (2.25%)";
const TOLLS = "Tolls and airport fees";
const MEET_TEXT = "Inside the terminal with a name sign. Airport parking is charged after the ride.";
const TIP_TEXT = "Paid in full to your chauffeur.";

const ROUND_REF = bookingRef("nonce-round-trip-000001");
const EXPECTED = {
  "an airport pickup with meet and greet and a 15% gratuity": [
    PICKUP,
    "nonce-airport-pickup-0001",
    "NLR-Y8AHA2TE",
    {
      ...common("NLR-Y8AHA2TE", { email: ME.email }),
      ...lines([
        ["Fare", 15500, "From JFK, Business SUV. NLR-Y8AHA2TE. Wed, Oct 14, 2026, 7:30 AM. 2 passengers."],
        [TAX, 1376],
        [BCF, 349],
        [TOLLS, 1275],
        ["Meet and greet", 2500, MEET_TEXT],
        ["Gratuity for your chauffeur (15%)", 2325, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `2026-10-14 07:30 NLR-Y8AHA2TE. From JFK, Business SUV. Pickup "John F. Kennedy (JFK), Terminal 4". Drop-off "${MANHATTAN}". 2 passengers. Flight DL 401. Meet and greet.`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: "NLR-Y8AHA2TE",
        service: "airport",
        direction: "from-airport",
        airport: "jfk",
        class: "suv",
        from_text: "John F. Kennedy (JFK), Terminal 4",
        from_zone: "jfk",
        from_place: "jfk-t4",
        to_text: MANHATTAN,
        to_zone: "manhattan",
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        passengers: "2",
        flight: "DL 401",
        meet: "1",
        tip_percent: "15",
        legs: "1",
        fare_cents: "15500",
        tax_cents: "1376",
        bcf_cents: "349",
        tolls_cents: "1275",
        meet_cents: "2500",
        tip_cents: "2325",
        total_cents: "23325",
        rider: "other",
        ...ME,
        reach: "whatsapp",
        passenger_name: "Ben Ortiz",
        passenger_phone: "+44 20 7946 0958",
        sign_name: "Ben Ortiz",
        notes: "Two large cases",
      }),
    },
  ],
  "an airport drop-off with no gratuity": [
    DROPOFF,
    "nonce-airport-dropoff-0001",
    "NLR-YN3QF77C",
    {
      ...common("NLR-YN3QF77C"),
      ...lines([["Fare", 15500, "To JFK, Business SUV. NLR-YN3QF77C. Wed, Oct 14, 2026, 7:30 AM. 2 passengers."], [TAX, 1376], [BCF, 349], [TOLLS, 1275]]),
      "payment_intent_data[description]": `2026-10-14 07:30 NLR-YN3QF77C. To JFK, Business SUV. Pickup "${MANHATTAN}". Drop-off "John F. Kennedy (JFK)". 2 passengers.`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: "NLR-YN3QF77C",
        service: "airport",
        direction: "to-airport",
        airport: "jfk",
        class: "suv",
        from_text: MANHATTAN,
        from_zone: "manhattan",
        to_text: "John F. Kennedy (JFK)",
        to_zone: "jfk",
        to_place: "jfk",
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        passengers: "2",
        meet: "0",
        tip_percent: "0",
        legs: "1",
        fare_cents: "15500",
        tax_cents: "1376",
        bcf_cents: "349",
        tolls_cents: "1275",
        meet_cents: "0",
        tip_cents: "0",
        total_cents: "18500",
        rider: "me",
        reach: "phone",
      }),
    },
  ],
  "an hourly booking, one fare line of quantity 1 with tax and the Black Car Fund": [
    HOURLY,
    "nonce-hourly-escalade-0001",
    "NLR-9FVTAQ7D",
    {
      ...common("NLR-9FVTAQ7D", { hourly: true, email: ME.email }),
      ...lines([["Fare, 4 hours", 42000, "By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours. NLR-9FVTAQ7D. Tue, Dec 1, 2026, 2:00 PM. 1 passenger."], [TAX, 3728], [BCF, 945]]),
      "payment_intent_data[description]": '2026-12-01 14:00 NLR-9FVTAQ7D. By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours. Pickup "1 Main Street, Brooklyn, NY 11201". 1 passenger.',
      "payment_intent_data[statement_descriptor_suffix]": "HOUR DEC01",
      ...bothMetadata({
        ref: "NLR-9FVTAQ7D",
        service: "hourly",
        class: "premium",
        vehicle: "premium",
        hours: "4",
        from_text: "1 Main Street, Brooklyn, NY 11201",
        from_zone: "brooklyn",
        date: "2026-12-01",
        time: "14:00",
        pickup_at: "2026-12-01T19:00:00.000Z",
        passengers: "1",
        meet: "0",
        tip_percent: "0",
        legs: "0",
        fare_cents: "42000",
        tax_cents: "3728",
        bcf_cents: "945",
        tolls_cents: "0",
        meet_cents: "0",
        tip_cents: "0",
        total_cents: "46673",
        rider: "me",
        ...ME,
        reach: "phone",
        notes: "A toddler seat, please",
      }),
    },
  ],
  "a round trip in First Class with a return flight and a 10% gratuity": [
    ROUND,
    "nonce-round-trip-000001",
    ROUND_REF,
    {
      ...common(ROUND_REF, { email: ME.email }),
      ...lines([
        ["Fare", 53498, `First Class, 2 airport transfers. ${ROUND_REF}. Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. 3 passengers.`],
        [TAX, 4748],
        [BCF, 1204],
        [TOLLS, 2550],
        ["Gratuity for your chauffeur (10%)", 5350, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `2026-10-14 07:30 ${ROUND_REF}. First Class, 2 airport transfers. Pickup "${MANHATTAN}". Drop-off "John F. Kennedy (JFK), Terminal 5". Return 2026-10-18 18:00. 3 passengers. Return flight B6 1234.`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: ROUND_REF,
        service: "airport",
        direction: "to-airport",
        airport: "jfk",
        class: "first",
        from_text: MANHATTAN,
        from_zone: "manhattan",
        to_text: "John F. Kennedy (JFK), Terminal 5",
        to_zone: "jfk",
        to_place: "jfk-t5",
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        return_date: "2026-10-18",
        return_time: "18:00",
        return_at: "2026-10-18T22:00:00.000Z",
        passengers: "3",
        return_flight: "B6 1234",
        meet: "0",
        tip_percent: "10",
        legs: "2",
        fare_cents: "53498",
        tax_cents: "4748",
        bcf_cents: "1204",
        tolls_cents: "2550",
        meet_cents: "0",
        tip_cents: "5350",
        total_cents: "67350",
        rider: "me",
        ...ME,
        reach: "phone",
      }),
    },
  ],
};

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failures++;
    process.stderr.write(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 14).join("\n       ")}\n`);
  }
}

const logged = [];
console.error = (...args) => logged.push(args.map(String).join(" "));

const realFetch = globalThis.fetch;
function stripeTotal(body) {
  const form = new URLSearchParams(body);
  let total = 0;
  for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) total += Number(form.get(`line_items[${i}][quantity]`)) * Number(form.get(`line_items[${i}][price_data][unit_amount]`));
  return total;
}
const STRIPE_OK = (url, init = {}) => new Response(JSON.stringify({ id: "cs_test_a1B2c3D4e5F6g7H8i9J0", object: "checkout.session", url: CHECKOUT_URL, amount_total: stripeTotal(init.body) }), { status: 200, headers: { "request-id": "req_create0001" } });
let calls = [];
let timeouts = [];
let stripe = STRIPE_OK;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return stripe(String(url), init);
};
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms) => {
  timeouts.push(ms);
  return realTimeout(ms);
};

function setEnv(vars = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  stripe = STRIPE_OK;
  calls = [];
  timeouts = [];
  logged.length = 0;
}

for (const [name, [fields, nonce, ref, expected]] of Object.entries(EXPECTED)) {
  await test(`builder: ${name} equals the complete expected map`, async () => {
    const built = await build(fields, ON, nonce);
    assert.equal(built.ref, ref);
    const entries = [...built.params];
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, "a parameter is sent twice");
    assert.deepEqual(Object.fromEntries(entries), expected);
    assert.equal(stripeTotal(built.params.toString()), built.price.total);
    assert.equal(Number(built.params.get("metadata[total_cents]")), built.price.total);
  });
}

await test("builder: no line carries tax_rates, every line is quantity 1, names are the price labels", async () => {
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND]) {
    const { params, price } = await build(fields, ON, "nonce-tax-rates-000000");
    assert.ok(![...params.keys()].some((key) => key.includes("tax_rates")));
    price.lines.forEach((entry, i) => {
      assert.equal(params.get(`line_items[${i}][quantity]`), "1");
      assert.equal(params.get(`line_items[${i}][price_data][product_data][name]`), entry.label);
      assert.equal(params.get(`line_items[${i}][price_data][unit_amount]`), String(entry.cents));
      assert.ok(!params.has(`line_items[${i}][price_data][product_data][unit_label]`));
    });
    assert.ok(!params.has(`line_items[${price.lines.length}][quantity]`));
  }
});

await test("builder: NYCLUXRIDE* plus the suffix is at most 22 characters for every airport and for hourly, in every month", async () => {
  const cases = [];
  const labels = { jfk: "John F. Kennedy (JFK)", lga: "LaGuardia (LGA)", ewr: "Newark Liberty (EWR)", teb: "Teterboro (TEB)" };
  for (let month = 1; month <= 12; month++) {
    const date = `2027-${String(month).padStart(2, "0")}-28`;
    for (const airport of AIRPORT_PLACES) cases.push([{ ...DROPOFF, to_text: labels[airport], to_id: airport, date }, DESCRIPTOR_CODES[airport]]);
    cases.push([{ ...HOURLY, date }, DESCRIPTOR_CODES.hourly]);
  }
  for (const [fields, code] of cases) {
    const { params } = await build(fields, ON, "nonce-descriptor-0000");
    const suffix = params.get("payment_intent_data[statement_descriptor_suffix]");
    assert.match(suffix, new RegExp(`^${code} [A-Z]{3}28$`));
    assert.ok(`${DESCRIPTOR_PREFIX}* ${suffix}`.length <= 22, `${DESCRIPTOR_PREFIX}* ${suffix}`);
    assert.ok(/[A-Z]/.test(suffix) && !/[<>\\'"*]/.test(suffix), suffix);
  }
  const { params } = await build({ ...PICKUP, from_text: "LaGuardia (LGA), Terminal B", from_id: "lga-tb" }, ON, "nonce-descriptor-0001");
  assert.equal(params.get("payment_intent_data[statement_descriptor_suffix]"), "LGA OCT14");
});

await test("builder: metadata has at most 50 keys, the keys of 3.8 only, empty values left out, every value at most 500 characters", async () => {
  const ALLOWED = "ref service direction airport class vehicle hours from_text from_zone from_place to_text to_zone to_place stop1_text stop1_zone stop2_text stop2_zone date time pickup_at return_date return_time return_at passengers flight return_flight meet tip_percent legs fare_cents tax_cents bcf_cents tolls_cents meet_cents tip_cents total_cents rider name email phone reach passenger_name passenger_phone sign_name notes".split(" ");
  assert.equal(ALLOWED.length, 45);
  const stops = { ...PICKUP, from_text: "John F. Kennedy (JFK)", from_id: "jfk", stop1_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga", tip: "" };
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND, stops]) {
    const { params, trip, price, ref } = await build(fields, ON, "nonce-metadata-0000000");
    const meta = [...params].filter(([key]) => key.startsWith("metadata["));
    assert.ok(meta.length <= 50);
    for (const [key, value] of meta) {
      assert.ok(ALLOWED.includes(key.slice(9, -1)), key);
      assert.ok(value.length > 0 && value.length <= 500, key);
    }
    const direct = metadataFor({ ...trip, from_text: "C".repeat(600), flight: "" }, price, ref);
    assert.equal(direct.from_text.length, 500);
    assert.ok(!("flight" in direct));
  }
  const { params } = await build(stops, ON, "nonce-metadata-0000001");
  assert.deepEqual([params.get("metadata[stop1_text]"), params.get("metadata[stop1_zone]"), params.get("metadata[legs]"), params.get("metadata[total_cents]")], [MANHATTAN, "manhattan", "2", "37500"]);
  const me = await build({ ...PICKUP, rider: "me" }, ON, "nonce-metadata-0000002");
  assert.deepEqual([me.params.get("metadata[rider]"), me.params.get("metadata[passenger_name]"), me.params.get("metadata[passenger_phone]"), me.params.get("metadata[sign_name]")], ["me", null, null, "Ana Lopez"]);
  const own = await build({ ...PICKUP, sign: "Dr Ortiz" }, ON, "nonce-metadata-0000003");
  assert.equal(own.params.get("metadata[sign_name]"), "Dr Ortiz");
  const noMeet = await build({ ...PICKUP, meet: "", sign: "Dr Ortiz" }, ON, "nonce-metadata-0000004");
  assert.equal(noMeet.params.get("metadata[sign_name]"), null);
  const long = await build({ ...PICKUP, notes: "N".repeat(700), name: "M".repeat(120) }, ON, "nonce-metadata-0000005");
  assert.deepEqual([long.params.get("metadata[notes]").length, long.params.get("metadata[name]").length], [500, 80]);
});

await test("builder: custom_text messages are at most 1200 characters, also with a license line, with no unfilled placeholder", async () => {
  for (const fields of [PICKUP, HOURLY]) {
    const { params } = await build(fields, ON, "nonce-text-length-0000");
    for (const key of ["custom_text[terms_of_service_acceptance][message]", "custom_text[submit][message]", "custom_text[after_submit][message]"]) {
      assert.ok(params.get(key).length <= 1200, key);
      assert.ok(!params.get(key).includes("{"), key);
    }
  }
  assert.equal(CHECKOUT.terms, TERMS);
  assert.equal(CHECKOUT.submit, SUBMIT);
  assert.equal(CHECKOUT.submitHourly, SUBMIT_HOURLY);
  assert.ok(`${CHECKOUT.license.replace("{license}", "B00000")} ${CHECKOUT.afterSubmit.replace("{ref}", "NLR-7K3Q2P")}`.length <= 1200);
});

await test("builder: descriptions start with the sortable date and the reference, within Stripe's limits, and the payer's page shows no free text", async () => {
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND]) {
    const long = { ...fields, from_text: fields.from_id ? fields.from_text : `${"D".repeat(180)}, 10118`, to_text: fields.to_id || fields.trip_type === "hour" ? fields.to_text : `${"E".repeat(180)}, 10118` };
    const { params, ref } = await build(long, ON, "nonce-description-0000");
    const intent = params.get("payment_intent_data[description]");
    assert.ok(intent.startsWith(`${fields.date} ${fields.time} ${ref}. `), intent);
    assert.ok(intent.length <= 1000);
    assert.ok(intent.includes("D".repeat(150)) || intent.includes("E".repeat(150)), intent);
    const product = params.get("line_items[0][price_data][product_data][description]");
    assert.ok(product.includes(`. ${ref}. `), product);
    assert.ok(!product.includes("DD") && !product.includes("EE") && !product.includes("5th Ave"), product);
    for (const [key, value] of params) if (key.startsWith("line_items[")) assert.ok(!value.includes("DD") && !value.includes("EE"), key);
  }
});

await test("builder: expires_at is the creation time plus 1860 seconds", async () => {
  const now = new Date("2026-10-05T09:15:42.900Z");
  const { params } = await build(DROPOFF, ON, "nonce-expiry-000000000", now);
  assert.equal(Number(params.get("expires_at")), Math.floor(now.getTime() / 1000) + 1860);
});

await test("builder: no custom fields are sent, the email prefills Stripe, and Stripe asks only for a missing name or phone", async () => {
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND]) {
    const built = await build(fields, ON, "nonce-label-length-0000");
    for (const key of built.params.keys()) assert.ok(!key.startsWith("custom_fields"), key);
  }
  const check = async (fields, email, phone, name) => {
    const { params } = await build(fields, ON, "nonce-fields-000000000");
    assert.deepEqual([params.get("customer_email"), params.get("phone_number_collection[enabled]"), params.get("name_collection[individual][enabled]")], [email, phone, name], JSON.stringify(fields));
  };
  await check(PICKUP, ME.email, null, null);
  await check(DROPOFF, null, "true", "true");
  await check({ ...PICKUP, email: "not an email" }, null, null, null);
  await check({ ...PICKUP, phone: "" }, ME.email, "true", null);
  await check({ ...PICKUP, name: "" }, ME.email, null, "true");
});

await test("builder: none of the parameters the spec leaves out are sent", async () => {
  const { params } = await build(PICKUP, ON, "nonce-left-out-0000000");
  for (const key of params.keys()) {
    assert.ok(!/^(payment_method_types|automatic_tax|invoice_creation|billing_address_collection|shipping_address_collection|allow_promotion_codes|locale|tax_id_collection)\b/.test(key), key);
    assert.ok(!key.includes("tax_rates") && !key.includes("unit_label"), key);
  }
  assert.equal(params.get("ui_mode"), "hosted_page");
});

await test("encodeForm nests objects and arrays with brackets and skips undefined and null", () => {
  const params = encodeForm({ a: "1", b: { c: true, d: [{ e: 2 }, "f"] }, g: undefined, h: null, i: false });
  assert.deepEqual([...params], [["a", "1"], ["b[c]", "true"], ["b[d][0][e]", "2"], ["b[d][1]", "f"], ["i", "false"]]);
});

const LIVE = { PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: KEY };
const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const inDays = (days) => NY_DATE.format(new Date(Date.now() + days * 86400000));
const SOON = inDays(3);
const NY_CLOCK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nyAt = (ms) => {
  const parts = Object.fromEntries(NY_CLOCK.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};
const trip = (fields) => ({ ...fields, date: SOON, time: "10:00", ...(fields.return ? { return_date: inDays(5) } : {}) });

function post(fields, { accept = "application/json", type = "application/json", origin = LOCAL, url = `${LOCAL}/api/book`, headers = {}, raw } = {}) {
  const body = raw ?? (type.startsWith("application/json") ? JSON.stringify(fields) : new URLSearchParams(fields).toString());
  const all = { "content-type": type, ...headers };
  if (accept) all.accept = accept;
  if (origin) all.origin = origin;
  return POST(new Request(url, { method: "POST", headers: all, body }));
}
const formPost = (fields, options = {}) => post(fields, { accept: "text/html,application/xhtml+xml", type: "application/x-www-form-urlencoded", ...options });
const get = (id, origin = LOCAL) => GET(new Request(`${origin}/api/book?session_id=${encodeURIComponent(id)}`));
const formOf = (call) => new URLSearchParams(call.init.body);
const noStore = (res) => assert.equal(res.headers.get("cache-control"), "no-store");
const resolved = async (fields) => resolveTrip(readInput(fields), { now: Date.now() });

async function readJson(res, status) {
  assert.equal(res.status, status, `status ${res.status}`);
  noStore(res);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  return res.json();
}

function assertRedirect(res, location) {
  assert.equal(res.status, 303);
  noStore(res);
  assert.equal(res.headers.get("location"), location);
}

function noLeak(...needles) {
  for (const entry of logged) for (const needle of needles) assert.ok(!entry.includes(needle), `log line "${entry}" contains "${needle}"`);
}

const STRIPE_JFK = trip({ ...DROPOFF, ...ME });
const PICKUP_SOON = trip(PICKUP);
const errorBlock = (code, links) => ({ kind: "error", code, group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...links });
const reqRef = (fields) => requestRef({ ...readInput(fields), action: "options" });

await test("handler: the Stripe call has the URL, method, form type, version, key, a 10 second timeout and no Idempotency-Key", async () => {
  setEnv(LIVE);
  const body = await readJson(await post({ ...STRIPE_JFK, nonce: "nonce-handler-call-0001" }), 200);
  assert.match(body.ref, /^NLR-[0-9A-HJKNPQRSTVXYZ]{8}$/);
  assert.deepEqual(body, { kind: "pay", ref: body.ref, url: CHECKOUT_URL });
  assert.equal(calls.length, 1);
  assert.equal(Object.fromEntries(formOf(calls[0]))["metadata[ref]"], body.ref);
  const [{ url, init }] = calls;
  const headers = new Headers(init.headers);
  assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(init.method, "POST");
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(headers.get("stripe-version"), "2026-09-30.endive");
  assert.equal(headers.get("authorization"), `Bearer ${KEY}`);
  assert.equal(headers.has("idempotency-key"), false);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(timeouts, [10000]);
});

await test("handler: the body sent to Stripe is the builder's output for the same trip", async () => {
  setEnv(LIVE);
  const fields = { ...PICKUP_SOON, nonce: "nonce-handler-body-0001" };
  const before = Math.floor(Date.now() / 1000);
  await post(fields);
  const after = Math.floor(Date.now() / 1000);
  const sent = Object.fromEntries(formOf(calls[0]));
  const t = await resolved(fields);
  const expected = Object.fromEntries(sessionParams(t, priceTrip(t, ON), sent["metadata[ref]"], ON, new Date(), LOCAL));
  const expires = Number(sent.expires_at);
  assert.ok(expires >= before + 1860 && expires <= after + 1860, String(expires));
  delete sent.expires_at;
  delete expected.expires_at;
  assert.deepEqual(sent, expected);
  assert.equal(sent["metadata[total_cents]"], "23325");
});

await test("handler: two posts with the same nonce and a different tip make two calls, both succeed and each payment gets its own reference", async () => {
  setEnv(LIVE);
  const nonce = "nonce-same-twice-000001";
  const first = await readJson(await post({ ...PICKUP_SOON, nonce }), 200);
  const second = await readJson(await post({ ...PICKUP_SOON, tip: "20", nonce }), 200);
  assert.equal(calls.length, 2);
  assert.deepEqual([first.kind, second.kind, first.ref === second.ref], ["pay", "pay", false]);
  assert.deepEqual([formOf(calls[0]).get("client_reference_id"), formOf(calls[1]).get("client_reference_id")], [first.ref, second.ref]);
  assert.equal(formOf(calls[0]).get("line_items[5][price_data][unit_amount]"), "2325");
  assert.equal(formOf(calls[1]).get("line_items[5][price_data][unit_amount]"), "3100");
});

await test("handler: JSON Accept gets 200 pay with the URL, no JSON Accept gets 303 to the session URL, whatever action says", async () => {
  setEnv(LIVE);
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).url, CHECKOUT_URL);
  assertRedirect(await formPost(STRIPE_JFK), CHECKOUT_URL);
  assertRedirect(await formPost({ ...STRIPE_JFK, action: "options" }), CHECKOUT_URL);
  assertRedirect(await post({ ...STRIPE_JFK, action: "options" }, { accept: "" }), CHECKOUT_URL);
  assert.equal(calls.length, 4);
});

await test("handler: every redirect of 13.1.8 for a form post", async () => {
  setEnv(LIVE);
  assertRedirect(await formPost(STRIPE_JFK), CHECKOUT_URL);
  assertRedirect(await formPost({ ...STRIPE_JFK, from_text: "350 5th Ave" }), "/book#q-unplaced");
  assertRedirect(await formPost({ ...STRIPE_JFK, to_text: "277 Bedford Ave, Brooklyn, NY 11211", to_id: "" }), "/book#q-no-airport");
  assertRedirect(await formPost({ ...STRIPE_JFK, stop1_text: "277 Bedford Ave, Brooklyn, NY 11211" }), "/book#q-stop-leg");
  assertRedirect(await formPost({ ...trip(HOURLY), class: "sprinter" }), "/book#q-sprinter-hourly");
  assertRedirect(await formPost({ ...STRIPE_JFK, class: "first", passengers: "4" }), "/book#q-seats");
  assertRedirect(await formPost({ ...STRIPE_JFK, date: inDays(400) }), "/book#q-far-ahead");
  assertRedirect(await formPost({ ...STRIPE_JFK, from_text: "" }), "/book#e-from");
  assertRedirect(await formPost({ ...STRIPE_JFK, to_text: "" }), "/book#e-to");
  assertRedirect(await formPost({ ...STRIPE_JFK, date: inDays(-2) }), "/book#e-date-past");
  assertRedirect(await formPost({ ...STRIPE_JFK, tip: "50" }), "/book#e-tip");
  assertRedirect(await formPost({ ...STRIPE_JFK, return: "1", return_date: inDays(1), return_time: "10:00" }), "/book#e-return-date");
  assert.equal(calls.length, 1);
  stripe = () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
  assertRedirect(await formPost(STRIPE_JFK), "/book#q-error");
  setEnv({ PAYMENTS_ENABLED: "true" });
  assertRedirect(await formPost(STRIPE_JFK), "/book#q-paused");
  assertRedirect(await formPost(STRIPE_JFK, { origin: "https://evil.example" }), "/book#q-error");
  assertRedirect(await formPost(STRIPE_JFK, { type: "text/plain", raw: "x" }), "/book#q-error");
  assertRedirect(await formPost(STRIPE_JFK, { headers: { "content-length": "13000" } }), "/book#q-error");
  setEnv();
  assertRedirect(await formPost(STRIPE_JFK), "/book#q-paused");
});

await test("handler: options answers the 13.1.2 shape with all five classes priced in CLASSES order and never calls fetch", async () => {
  setEnv(LIVE);
  const fields = { ...trip(PICKUP), from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "", tip: "", flight: "", action: "options", nonce: "nonce-options-shape-0001" };
  const ref = reqRef(fields);
  const body = await readJson(await post(fields), 200);
  assert.deepEqual(body, {
    kind: "options",
    ref,
    service: "airport",
    legs: 1,
    classes: [
      { class: "suv", name: "Business SUV", seats: 5, total_cents: 18500, reason: "" },
      { class: "premium", name: "Business Premium SUV", seats: 5, total_cents: 22000, reason: "" },
      { class: "first", name: "First Class", seats: 3, total_cents: 31000, reason: "" },
      { class: "sedan", name: "Sedan & Electric", seats: 3, total_cents: 17000, reason: "" },
      { class: "sprinter", name: "Luxury Sprinter", seats: 12, total_cents: 40000, reason: "" },
    ],
    vehicles: [],
    tips: [0, 10, 15, 20],
    meet: true,
    meet_cents: 2500,
    selected: { class: "suv", vehicle: "", tip: 0, meet: false },
    price: {
      lines: [
        { label: "Fare", cents: 15500 },
        { label: "NYC sales tax (8.875%)", cents: 1376 },
        { label: "Black Car Fund (2.25%)", cents: 349 },
        { label: "Tolls and airport fees", cents: 1275 },
      ],
      total_cents: 18500,
      currency: "usd",
      notes: AIRPORT_NOTES,
    },
    reason: "",
    pay: true,
    hold: "",
    ...contactLinks(await resolved(fields), ref, 18500),
  });
  assert.ok(decodeURIComponent(body.whatsapp).includes(`Reference: ${ref}`));
  assert.ok(decodeURIComponent(body.whatsapp).endsWith("Total shown: $185.00"));
  assert.equal(calls.length, 0);
});

await test("handler: options and quote price the selected class, tip and meet and greet, quote refuses an unknown class", async () => {
  setEnv(LIVE);
  const fields = { ...PICKUP_SOON, action: "quote" };
  const body = await readJson(await post(fields), 200);
  assert.equal(body.kind, "options");
  assert.deepEqual(body.selected, { class: "suv", vehicle: "", tip: 15, meet: true });
  assert.deepEqual(body.price.lines.slice(4), [{ label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur (15%)", cents: 2325 }]);
  assert.equal(body.price.total_cents, 23325);
  assert.deepEqual(body.classes.map((item) => item.total_cents), [23325, 27298, 37512, 21623, 47727]);
  assert.equal(body.classes[0].total_cents, body.price.total_cents, "the selected row shows the total of the panel and the bar");
  assert.deepEqual((await readJson(await post({ ...fields, meet: "", tip: "" }), 200)).classes.map((item) => item.total_cents), [18500, 22000, 31000, 17000, 40000]);
  assert.deepEqual(await readJson(await post({ ...fields, class: "limo" }), 422), { kind: "invalid", code: "class", field: "class", text: ERRORS.class.text });
  const options = await readJson(await post({ ...fields, class: "limo", action: "options" }), 200);
  assert.equal(options.selected.class, "suv");
  assert.equal(options.meet_cents, 2500);
  const curb = await readJson(await post({ ...fields, meet: "" }), 200);
  assert.deepEqual([curb.selected.meet, curb.price.lines.some((l) => l.label === "Meet and greet"), curb.price.total_cents], [false, false, 20825]);
  const zero = await readJson(await post({ ...fields, meet: "0" }), 200);
  assert.equal(zero.selected.meet, false);
  assert.equal(calls.length, 0);
});

await test("handler: a class reason answers kind options with price null and that reason, the other cards keep their prices", async () => {
  setEnv(LIVE);
  const four = await readJson(await post({ ...STRIPE_JFK, class: "first", passengers: "4", action: "options" }), 200);
  assert.deepEqual([four.kind, four.price, four.reason, four.pay], ["options", null, "seats", false]);
  assert.deepEqual(four.classes.map((item) => [item.class, item.total_cents, item.reason]), [["suv", 18500, ""], ["premium", 22000, ""], ["first", null, "seats"], ["sedan", null, "seats"], ["sprinter", 40000, ""]]);
  assert.ok(!decodeURIComponent(four.whatsapp).includes("Total shown"));
  const six = await readJson(await post({ ...STRIPE_JFK, passengers: "6", action: "options" }), 200);
  assert.deepEqual(six.classes.map((item) => item.total_cents), [null, null, null, null, 40000]);
  assert.equal(six.reason, "seats");
  const hourly = await readJson(await post({ ...trip(HOURLY), class: "sprinter", action: "options" }), 200);
  assert.deepEqual([hourly.kind, hourly.price, hourly.reason, hourly.service, hourly.legs], ["options", null, "sprinter-hourly", "hourly", 0]);
  assert.deepEqual(hourly.classes.map((item) => [item.total_cents, item.reason]), [[42228, ""], [46673, ""], [77788, ""], [37783, ""], [null, "sprinter-hourly"]]);
  assert.deepEqual(hourly.vehicles, [
    { vehicle: "suv-suburban", label: "Chevrolet Suburban or similar", total_cents: 42228 },
    { vehicle: "suv-denali", label: "GMC Denali", total_cents: 44450 },
    { vehicle: "suv-navigator", label: "Lincoln Navigator", total_cents: 44450 },
  ]);
  const crowd = await readJson(await post({ ...trip(HOURLY), passengers: "6", action: "options" }), 200);
  assert.deepEqual(crowd.vehicles.map((item) => item.total_cents), [null, null, null]);
  assert.deepEqual(crowd.classes.map((item) => [item.class, item.reason]), [["suv", "seats"], ["premium", "seats"], ["first", "seats"], ["sedan", "seats"], ["sprinter", "sprinter-hourly"]]);
  assert.equal(calls.length, 0);
});

await test("handler: hourly options show the Business SUV vehicle chosen, its price in the suv card, and meet and greet only from JFK and LaGuardia", async () => {
  setEnv(LIVE);
  const denali = await readJson(await post({ ...trip(HOURLY), class: "suv", vehicle: "suv-denali", hours: "3", action: "options" }), 200);
  assert.deepEqual(denali.selected, { class: "suv", vehicle: "suv-denali", tip: 0, meet: false });
  assert.equal(denali.classes[0].total_cents, 33338);
  assert.equal(denali.price.total_cents, 33338);
  assert.deepEqual(denali.price.notes, [HOURLY_NOTE]);
  assert.equal(denali.meet, false);
  assert.equal(denali.meet_cents, null);
  const first = await readJson(await post({ ...trip(HOURLY), class: "first", vehicle: "suv-denali", hours: "3", action: "options" }), 200);
  assert.deepEqual([first.selected.vehicle, first.classes[0].total_cents, first.price.total_cents], ["first", 33338, 58340]);
  const premium = await readJson(await post({ ...trip(HOURLY), vehicle: "suv-denali", hours: "3", action: "options" }), 200);
  assert.deepEqual(premium.selected, { class: "premium", vehicle: "premium", tip: 0, meet: false });
  assert.deepEqual([premium.classes[0].total_cents, premium.classes[1].total_cents, premium.price.total_cents], [33338, 35005, 35005]);
  const jfk = await readJson(await post({ ...trip(HOURLY), from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "1", action: "options" }), 200);
  assert.deepEqual([jfk.meet, jfk.selected.meet, jfk.price.lines.at(-1)], [true, true, { label: "Meet and greet", cents: 2500 }]);
});

await test("handler: a hold keeps the prices in options with pay false, and its WhatsApp text has the total shown", async () => {
  for (const [env, fields, hold] of [[{}, STRIPE_JFK, "paused"], [LIVE, { ...STRIPE_JFK, ...nyAt(Date.now() + 3 * 3600000) }, "short-notice"], [LIVE, { ...STRIPE_JFK, date: inDays(370) }, "far-ahead"], [{ ...LIVE, PAY_BLACKOUT_DATES: SOON }, STRIPE_JFK, "paused"]]) {
    setEnv(env);
    const body = await readJson(await post({ ...fields, action: "options" }), 200);
    assert.deepEqual([body.kind, body.hold, body.pay, body.reason, body.price.total_cents], ["options", hold, false, "", 18500], hold);
    assert.ok(decodeURIComponent(body.whatsapp).endsWith("Total shown: $185.00"));
  }
  assert.equal(calls.length, 0);
});

await test("handler: a trip reason answers the quote shape: classes all null with the reason, the tips and the composed links", async () => {
  setEnv(LIVE);
  const fields = { ...STRIPE_JFK, from_text: "350 5th Ave", action: "options", nonce: "nonce-quote-shape-00001" };
  const ref = reqRef(fields);
  const body = await readJson(await post(fields), 200);
  assert.deepEqual(body, {
    kind: "quote",
    ref,
    reason: "unplaced",
    group: "price",
    heading: HEADINGS.price,
    text: REASONS.unplaced.text,
    hourly: false,
    field: "from_text",
    classes: ["suv", "premium", "first", "sedan", "sprinter"].map((cls, i) => ({ class: cls, name: ["Business SUV", "Business Premium SUV", "First Class", "Sedan & Electric", "Luxury Sprinter"][i], seats: [5, 5, 3, 3, 12][i], total_cents: null, reason: "unplaced" })),
    tips: TIP_PERCENTS,
    ...contactLinks(await resolved(fields), ref),
  });
  const message = decodeURIComponent(body.whatsapp.split("?text=")[1]);
  assert.equal(message, composeMessage(await resolved(fields), ref));
  assert.ok(message.includes(ref) && message.includes("Pickup: 350 5th Ave") && !message.includes("Total shown"));
  assert.ok(body.mailto.startsWith(`mailto:info@nycluxride.com?subject=Booking%20request%20${ref}&body=`));
  assert.ok(!("switch" in body));
  const outside = await readJson(await post({ ...fields, from_text: "Hoboken, NJ 07030" }), 200);
  assert.deepEqual([outside.kind, outside.reason, outside.group, outside.field], ["quote", "outside-city", "price", ""]);
  process.env.GOOGLE_MOCK = "true";
  assert.equal((await readJson(await post(fields), 200)).text, REASONS.unplaced.google);
  assert.equal((await readJson(await post({ ...fields, from_text: "Hoboken, NJ 07030" }), 200)).text, REASONS["outside-city"].text);
  delete process.env.GOOGLE_MOCK;
  const dropoff = await readJson(await post({ ...fields, from_text: MANHATTAN, to_text: "somewhere quiet", to_id: "" }), 200);
  assert.deepEqual([dropoff.reason, dropoff.field], ["unplaced", "to_text"]);
  const local = await readJson(await post({ ...fields, from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", to_id: "" }), 200);
  assert.deepEqual([local.reason, local.hourly, local.text], ["no-airport", true, REASONS["no-airport"].text]);
  const far = await readJson(await post({ ...fields, from_text: "Hoboken, NJ 07030", to_text: "350 5th Ave, New York, NY 10118", to_id: "" }), 200);
  assert.deepEqual([far.reason, far.hourly, far.text], ["no-airport", false, REASONS["no-airport"].short]);
  assert.equal(calls.length, 0);
});

await test("handler: pay with a class reason or a hold answers the quote shape, with the computed classes and, for a hold, the total shown", async () => {
  setEnv(LIVE);
  const seats = await readJson(await post({ ...STRIPE_JFK, class: "sedan", passengers: "4" }), 200);
  assert.deepEqual([seats.kind, seats.reason, seats.group, seats.heading], ["quote", "seats", "phone", HEADINGS.phone]);
  assert.deepEqual(seats.classes.map((item) => item.total_cents), [18500, 22000, null, null, 40000]);
  setEnv();
  const paused = await readJson(await post(STRIPE_JFK), 200);
  assert.deepEqual([paused.kind, paused.reason, paused.text], ["quote", "paused", REASONS.paused.text]);
  assert.deepEqual(paused.classes.map((item) => item.total_cents), [18500, 22000, 31000, 17000, 40000]);
  assert.ok(decodeURIComponent(paused.whatsapp).endsWith("Total shown: $185.00"));
  assert.equal(calls.length, 0);
});

await test("handler: an invalid trip returns the invalid shape with the field to focus", async () => {
  setEnv(LIVE);
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, from_text: "" }), 422), { kind: "invalid", code: "from", field: "from_text", text: ERRORS.from.text });
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, to_text: "", action: "options" }), 422), { kind: "invalid", code: "to", field: "to_text", text: ERRORS.to.text });
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, date: inDays(-1) }), 422), { kind: "invalid", code: "date-past", field: "date", text: ERRORS["date-past"].text });
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, tip: "12" }), 422), { kind: "invalid", code: "tip", field: "tip", text: ERRORS.tip.text });
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, nlr_hp: "Acme" }), 422), { kind: "invalid", code: "form", field: "form", text: ERRORS.form.text });
  assert.deepEqual(await readJson(await post({}, { raw: "{not json" }), 422), { kind: "invalid", code: "form", field: "form", text: ERRORS.form.text });
  assert.equal((await readJson(await post({}, { raw: "[1,2]" }), 422)).code, "form");
  assert.equal(calls.length, 0);
});

await test("handler: pay checks the details of step 3 in order, options and quote never do, and a form post may leave them empty", async () => {
  setEnv(LIVE);
  const bad = async (fields, code) => assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, ...fields }), 422), { kind: "invalid", code, field: ERRORS[code].field, text: ERRORS[code].text }, JSON.stringify(fields));
  await bad({ name: "" }, "name");
  await bad({ name: " A " }, "name");
  await bad({ rider: "guest", reach: "sms", name: "" }, "rider");
  await bad({ reach: "sms", name: "" }, "reach");
  await bad({ email: "", phone: "" }, "email");
  await bad({ email: "ana@example" }, "email");
  await bad({ email: "ana lopez@example.com" }, "email");
  await bad({ phone: "" }, "phone");
  await bad({ phone: "555 01" }, "phone");
  await bad({ phone: "+1 212 555 0100 ext 4" }, "phone");
  await bad({ phone: "1234567890123456" }, "phone");
  await bad({ rider: "other" }, "pname");
  await bad({ rider: "other", pname: "B" }, "pname");
  await bad({ rider: "other", pname: "Ben Ortiz", pphone: "call me" }, "pphone");
  assert.equal(calls.length, 0);
  for (const action of ["options", "quote"]) assert.equal((await readJson(await post({ ...DROPOFF, date: SOON, time: "10:00", rider: "guest", action }), 200)).kind, "options", action);
  assert.equal((await readJson(await post({ ...STRIPE_JFK, rider: "", reach: "", phone: "(212) 555-0100", email: "a.b+c@mail.example.co" }), 200)).kind, "pay");
  const sent = new URLSearchParams(calls.at(-1).init.body);
  assert.deepEqual([sent.get("customer_email"), sent.get("phone_number_collection[enabled]"), sent.get("name_collection[individual][enabled]"), sent.get("metadata[rider]"), sent.get("metadata[reach]"), sent.get("metadata[name]")], ["a.b+c@mail.example.co", null, null, "me", "phone", ME.name]);
  assert.equal((await readJson(await post({ ...STRIPE_JFK, rider: "me", pname: "Ben Ortiz", pphone: "x" }), 200)).kind, "pay");
  assert.equal(new URLSearchParams(calls.at(-1).init.body).get("metadata[passenger_name]"), null);
  const bare = trip(DROPOFF);
  assertRedirect(await formPost(bare), CHECKOUT_URL);
  const plain = new URLSearchParams(calls.at(-1).init.body);
  assert.deepEqual([plain.get("customer_email"), plain.get("phone_number_collection[enabled]"), plain.get("name_collection[individual][enabled]")], [null, "true", "true"]);
  assertRedirect(await formPost({ ...bare, email: "nope" }), "/book#e-email");
  assertRedirect(await formPost({ ...bare, name: "A" }), "/book#e-name");
  assertRedirect(await formPost({ ...bare, phone: "12" }), "/book#e-phone");
  assertRedirect(await formPost({ ...bare, rider: "other" }), "/book#e-pname");
  assertRedirect(await formPost({ ...bare, rider: "other", pname: "Ben Ortiz" }), CHECKOUT_URL);
  assertRedirect(await formPost({ ...bare, rider: "other", pname: "Ben Ortiz", pphone: "12" }), "/book#e-pphone");
  const meetFrom = { ...trip(PICKUP), name: "", email: "", phone: "", sign: "", rider: "me", pname: "", pphone: "" };
  assertRedirect(await formPost(meetFrom), "/book#e-name");
  assertRedirect(await formPost({ ...meetFrom, sign: "Ana Lopez" }), CHECKOUT_URL);
  assertRedirect(await formPost({ ...bare, reach: "fax" }), "/book#e-reach");
  assertRedirect(await formPost({ ...bare, rider: "both" }), "/book#e-rider");
});

await test("handler: a Stripe 400 and a timeout both give 502 stripe with the composed links, and the log holds no key, address or body", async () => {
  const fields = { ...STRIPE_JFK, nonce: "nonce-stripe-fails-0001" };
  const ref = reqRef(fields);
  const expected = errorBlock("stripe", contactLinks(await resolved(fields), ref, 18500));
  setEnv(LIVE);
  stripe = () => new Response(JSON.stringify({ error: { message: "Invalid request: secret-body-text" } }), { status: 400, headers: { "request-id": "req_fail0001" } });
  assert.deepEqual(await readJson(await post(fields), 502), expected);
  assert.deepEqual(logged, [`stripe 400 req_fail0001 ${ref}`]);
  noLeak(KEY, MANHATTAN, "secret-body-text", "Invalid request");
  setEnv(LIVE);
  stripe = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  assert.deepEqual(await readJson(await post(fields), 502), expected);
  assert.deepEqual(logged, [`stripe 0  ${ref}`]);
  noLeak(KEY, MANHATTAN);
  setEnv(LIVE);
  stripe = () => new Response(JSON.stringify({ id: "cs_test_nourl00000000", amount_total: 18500 }), { status: 200 });
  assert.equal((await readJson(await post(fields), 502)).code, "stripe");
});

await test("handler: success_url and cancel_url use the production origin, the preview origin and the local origin", async () => {
  const urls = async (env, options) => {
    setEnv({ ...LIVE, ...env });
    assert.equal((await readJson(await post(STRIPE_JFK, options), 200)).kind, "pay");
    const form = formOf(calls[0]);
    return [form.get("success_url"), form.get("cancel_url")];
  };
  const production = [`${SITE}/booking-confirmed?session_id={CHECKOUT_SESSION_ID}`, `${SITE}/book#resume`];
  for (const options of [{ url: `${SITE}/api/book`, origin: SITE }, { url: "https://nyc-lux-ride.vercel.app/api/book", origin: SITE }]) {
    const env = { VERCEL_ENV: "production", STRIPE_SECRET_KEY: LIVE_KEY };
    if (CONSENT_TERMS_LIVE) assert.deepEqual(await urls(env, options), production);
    else {
      setEnv({ ...LIVE, ...env });
      assert.equal((await readJson(await post(STRIPE_JFK, options), 200)).reason, "paused");
      assert.equal(calls.length, 0);
    }
  }
  assert.deepEqual(await urls({ VERCEL_ENV: "preview" }, { url: `${PREVIEW}/api/book`, origin: PREVIEW }), [`${PREVIEW}/booking-confirmed?session_id={CHECKOUT_SESSION_ID}`, `${PREVIEW}/book#resume`]);
  assert.deepEqual(await urls({}, {}), [`${LOCAL}/booking-confirmed?session_id={CHECKOUT_SESSION_ID}`, `${LOCAL}/book#resume`]);
});

const PAID_SESSION = {
  id: "cs_test_a1B2c3D4e5F6g7H8i9J0",
  object: "checkout.session",
  status: "complete",
  payment_status: "paid",
  amount_total: 23325,
  currency: "usd",
  client_reference_id: "NLR-Y8AHA2TE",
  customer_details: { email: "pat@example.com", name: "Pat Example", phone: "+12125550100", address: { line1: "9 Secret Lane" } },
  metadata: {
    ref: "NLR-Y8AHA2TE",
    service: "airport",
    direction: "from-airport",
    airport: "jfk",
    class: "suv",
    from_text: "John F. Kennedy (JFK), Terminal 4",
    from_zone: "jfk",
    from_place: "jfk-t4",
    to_text: MANHATTAN,
    to_zone: "manhattan",
    date: "2026-10-14",
    time: "07:30",
    pickup_at: "2026-10-14T11:30:00.000Z",
    passengers: "2",
    flight: "DL 401",
    meet: "1",
    tip_percent: "15",
    legs: "1",
    fare_cents: "15500",
    tax_cents: "1376",
    bcf_cents: "349",
    tolls_cents: "1275",
    meet_cents: "2500",
    tip_cents: "2325",
    total_cents: "23325",
    chauffeur: "Sam",
  },
};
const SESSION_KEYS = ["kind", "status", "payment_status", "ref", "summary", "lines", "total_cents", "value_cents", "currency", "notes"];

await test("handler: GET with a paid session returns exactly the keys of 13.1.7, the checkout lines, and no address, flight, name, email or phone", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify(PAID_SESSION), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual(body, {
    kind: "session",
    status: "complete",
    payment_status: "paid",
    ref: "NLR-Y8AHA2TE",
    summary: "Wed, Oct 14, 2026, 7:30 AM. From JFK, Business SUV.",
    lines: [
      { label: "Fare", cents: 15500 },
      { label: "NYC sales tax (8.875%)", cents: 1376 },
      { label: "Black Car Fund (2.25%)", cents: 349 },
      { label: "Tolls and airport fees", cents: 1275 },
      { label: "Meet and greet", cents: 2500 },
      { label: "Gratuity for your chauffeur (15%)", cents: 2325 },
    ],
    total_cents: 23325,
    value_cents: 18000,
    currency: "usd",
    notes: AIRPORT_NOTES,
  });
  assert.deepEqual(Object.keys(body), SESSION_KEYS);
  const text = JSON.stringify(body);
  for (const secret of [MANHATTAN, "DL 401", "Pat Example", "pat@example.com", "+12125550100", "9 Secret Lane", "Sam", "Terminal 4"]) assert.ok(!text.includes(secret), secret);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.stripe.com/v1/checkout/sessions/${PAID_SESSION.id}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  assert.equal(new Headers(calls[0].init.headers).get("stripe-version"), "2026-09-30.endive");
  assert.deepEqual(timeouts, [10000]);
  assert.deepEqual(logged, []);
});

await test("handler: GET rebuilds an hourly receipt with the hourly note and no tolls line", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  const hourly = { ...PAID_SESSION, amount_total: 46673, metadata: { ref: "NLR-9FVTAQ7D", service: "hourly", class: "premium", vehicle: "premium", hours: "4", from_text: "1 Main Street", from_zone: "brooklyn", date: "2026-12-01", time: "14:00", meet: "0", tip_percent: "0", legs: "0", fare_cents: "42000", tax_cents: "3728", bcf_cents: "945", tolls_cents: "0", meet_cents: "0", tip_cents: "0", total_cents: "46673" } };
  stripe = () => new Response(JSON.stringify(hourly), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.equal(body.summary, "Tue, Dec 1, 2026, 2:00 PM. By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours.");
  assert.deepEqual(body.lines, [{ label: "Fare, 4 hours", cents: 42000 }, { label: "NYC sales tax (8.875%)", cents: 3728 }, { label: "Black Car Fund (2.25%)", cents: 945 }]);
  assert.deepEqual([body.value_cents, body.notes], [42000, [HOURLY_NOTE]]);
  assert.ok(!JSON.stringify(body).includes("1 Main Street"));
  assert.deepEqual(logged, []);
});

await test("handler: GET reads a session created before the deploy: its gratuity line, its sales tax from metadata or Stripe's total_details", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  const legacy = { ...PAID_SESSION, amount_total: 23986, metadata: { ref: "NLR-Y8AHA2TE", service: "transfer", direction: "from-airport", airport: "jfk", class: "suv", from: "jfk", to: "manhattan", date: "2026-10-14", time: "07:30", meet: "1", fare_cents: "16500", meet_cents: "2500", gratuity_cents: "3300", tax_cents: "1686", total_cents: "23986" } };
  stripe = () => new Response(JSON.stringify(legacy), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual(body.lines, [{ label: "Fare", cents: 16500 }, { label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur (20%)", cents: 3300 }, { label: "Sales tax", cents: 1686 }]);
  assert.deepEqual([body.summary, body.value_cents, body.notes], ["Wed, Oct 14, 2026, 7:30 AM. From JFK, Business SUV.", 19000, AIRPORT_NOTES]);
  assert.deepEqual(logged, []);
  stripe = () => new Response(JSON.stringify({ ...legacy, amount_total: 23985, total_details: { amount_tax: 1685 } }), { status: 200 });
  assert.deepEqual((await readJson(await get(PAID_SESSION.id), 200)).lines.at(-1), { label: "Sales tax", cents: 1685 });
  assert.deepEqual(logged, []);
  stripe = () => new Response(JSON.stringify({ ...legacy, amount_total: 22300, metadata: { ...legacy.metadata, tax_cents: "0", total_cents: "22300" } }), { status: 200 });
  assert.equal((await readJson(await get(PAID_SESSION.id), 200)).lines.length, 3);
});

await test("handler: GET with an unpaid session returns only kind, status and payment_status", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, status: "open", payment_status: "unpaid" }), { status: 200 });
  assert.deepEqual(await readJson(await get(PAID_SESSION.id), 200), { kind: "session", status: "open", payment_status: "unpaid" });
});

await test("handler: GET with a malformed id or an unknown id answers 200 unknown, an id Stripe did not know is not asked again, a Stripe failure 502, no key 503", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  for (const id of ["", "cs_live_short", "pi_123456789012345", "cs_test_abc/../../x", "cs_mock_7K3Q2P", "cs_test_\u00fcnicode0000000"]) {
    assert.deepEqual(await readJson(await get(id), 200), { kind: "unknown" }, id);
  }
  assert.equal(calls.length, 0);
  stripe = () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing" } }), { status: 404 });
  assert.deepEqual(await readJson(await get("cs_live_a1B2c3D4e5F6g7H8i9J0"), 200), { kind: "unknown" });
  assert.equal(calls.length, 1);
  assert.deepEqual(await readJson(await get("cs_live_a1B2c3D4e5F6g7H8i9J0"), 200), { kind: "unknown" });
  assert.equal(calls.length, 1, "an id Stripe did not know is answered from memory");
  calls.length = 0;
  stripe = () => new Response("oops", { status: 500, headers: { "request-id": "req_read0001" } });
  assert.deepEqual(await readJson(await get(PAID_SESSION.id), 502), errorBlock("stripe", contactLinks()));
  assert.deepEqual(logged, ["stripe 500 req_read0001"]);
  setEnv();
  assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
  assert.equal(calls.length, 0);
});

await test("handler: the honeypot gives 422 form, an autofilled company field is ignored, MAX_BODY is 12288 bytes, text/plain 415", async () => {
  setEnv(LIVE);
  assert.equal((await readJson(await post({ ...STRIPE_JFK, nlr_hp: "x" }), 422)).code, "form");
  assert.equal((await readJson(await post({ ...STRIPE_JFK, company: "Acme", organization: "Acme" }), 200)).kind, "pay");
  const big = JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(12300) });
  const plain = contactLinks();
  assert.deepEqual(await readJson(await post({}, { raw: big, headers: { "content-length": String(big.length) } }), 413), errorBlock("too-large", plain));
  assert.equal((await readJson(await post({}, { raw: big }), 413)).code, "too-large");
  assert.equal((await readJson(await post({}, { raw: JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(11800) }) }), 200)).kind, "pay");
  const edge = JSON.stringify({ ...STRIPE_JFK, pad: "" });
  assert.equal((await readJson(await post({}, { raw: JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(12288 - edge.length) }) }), 200)).kind, "pay");
  assert.equal((await readJson(await post({}, { raw: JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(12289 - edge.length) }) }), 413)).code, "too-large");
  const full = { ...PICKUP_SOON, name: "N".repeat(80), email: `${"e".repeat(240)}@example.com`, phone: "+1 212 555 0100", pname: "P".repeat(80), pphone: "+1 917 555 0199", sign: "S".repeat(45), notes: "\u00e9".repeat(500), pad: "\u00e9".repeat(2900) };
  assert.ok(new TextEncoder().encode(JSON.stringify(full)).length < 12288);
  assert.equal((await readJson(await post(full), 200)).kind, "pay");
  assert.deepEqual(await readJson(await post({}, { type: "text/plain", raw: JSON.stringify(STRIPE_JFK) }), 415), errorBlock("type", plain));
  assert.equal((await readJson(await post({}, { type: "multipart/form-data", raw: "x" }), 415)).code, "type");
  assert.equal((await readJson(await post(STRIPE_JFK, { type: "application/json; charset=utf-8" }), 200)).kind, "pay");
});

await test("handler: a cross-site Origin and Sec-Fetch-Site cross-site or same-site give 403", async () => {
  setEnv(LIVE);
  const origin = errorBlock("origin", contactLinks());
  assert.deepEqual(await readJson(await post(STRIPE_JFK, { origin: "https://evil.example" }), 403), origin);
  assert.deepEqual(await readJson(await post(STRIPE_JFK, { origin: "null" }), 403), origin);
  assert.deepEqual(await readJson(await post(STRIPE_JFK, { headers: { "sec-fetch-site": "cross-site" } }), 403), origin);
  assert.deepEqual(await readJson(await post(STRIPE_JFK, { origin: "", headers: { "sec-fetch-site": "same-site" } }), 403), origin);
  assert.equal(calls.length, 0);
  for (const allowed of [SITE, "https://nycluxride.com", PREVIEW, ""]) assert.equal((await readJson(await post(STRIPE_JFK, { origin: allowed, headers: { "sec-fetch-site": "same-origin" } }), 200)).kind, "pay", allowed);
  setEnv({ ...LIVE, STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "production" });
  const prod = { url: "https://www.nycluxride.com/api/book" };
  assert.equal((await readJson(await post(STRIPE_JFK, { ...prod, origin: PREVIEW }), 403)).code, "origin");
  assert.equal((await readJson(await post(STRIPE_JFK, { ...prod, origin: "http://www.nycluxride.com" }), 403)).code, "origin");
  assert.equal((await readJson(await post(STRIPE_JFK, { ...prod, origin: "https://nycluxride.com" }), 200)).kind, CONSENT_TERMS_LIVE ? "pay" : "quote");
});

await test("handler: with no usable key outside mock mode payments pause: options price with pay false and the paused hold, pay answers the paused quote, key-missing is logged once", async () => {
  setEnv({ PAYMENTS_ENABLED: "true" });
  const fields = { ...STRIPE_JFK, nonce: "nonce-no-key-0000000001" };
  const options = await readJson(await post({ ...fields, action: "options" }), 200);
  assert.deepEqual([options.kind, options.pay, options.hold, options.price.total_cents], ["options", false, "paused", 18500]);
  const pay = await readJson(await post(fields), 200);
  assert.deepEqual([pay.kind, pay.reason, pay.ref], ["quote", "paused", reqRef(fields)]);
  assert.ok(decodeURIComponent(pay.whatsapp).includes("Total shown: $185.00"));
  assert.equal(calls.length, 0);
  assert.ok(logged.filter((l) => l === "key-missing").length <= 1, logged.join(" | "));
});

await test("handler: PAYMENTS_ENABLED unset, every complete trip pays nowhere: paused on pay, prices with pay false on options, no key and no fetch", async () => {
  setEnv();
  for (const fields of [STRIPE_JFK, { ...STRIPE_JFK, class: "sedan" }, trip(HOURLY)]) {
    const body = await readJson(await post(fields), 200);
    assert.deepEqual([body.kind, body.reason, body.heading], ["quote", "paused", HEADINGS.phone]);
    assert.ok(body.whatsapp.startsWith("https://wa.me/16467750556?text="));
    const options = await readJson(await post({ ...fields, action: "options" }), 200);
    assert.deepEqual([options.kind, options.hold, options.pay], ["options", "paused", false]);
    assert.ok(options.price.total_cents > 0);
  }
  assert.equal((await readJson(await post({ ...STRIPE_JFK, from_text: "" }), 422)).code, "from");
  assert.equal(calls.length, 0);
});

await test("handler: the old tax settings change nothing", async () => {
  setEnv({ ...LIVE, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000" });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  setEnv({ ...LIVE, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000", SALES_TAX_PERCENT: "8.875" });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  assert.ok(![...formOf(calls[0]).keys()].some((key) => key.includes("tax_rates")));
  assert.equal(formOf(calls[0]).get("metadata[total_cents]"), "18500");
  assert.deepEqual(logged, []);
});

await test("handler: BOOK_MOCK=true with no key never calls fetch, returns the mock URL, and GET returns the mock session", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const fields = { ...PICKUP_SOON, nonce: "nonce-mock-booking-0001" };
  const body = await readJson(await post(fields), 200);
  const ref = body.ref;
  const id = `cs_mock_${ref.slice(4)}`;
  assert.deepEqual(body, { kind: "pay", ref, url: `/booking-confirmed?session_id=${id}` });
  assert.notEqual(ref, reqRef(fields));
  const again = await formPost(fields);
  assert.equal(again.status, 303);
  assert.match(again.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{8}$/);
  assert.notEqual(again.headers.get("location"), body.url, "a second payment of the same trip gets its own reference");
  const session = await readJson(await get(id), 200);
  assert.deepEqual(Object.keys(session), SESSION_KEYS);
  assert.deepEqual([session.payment_status, session.ref, session.total_cents, session.value_cents, session.lines.length], ["paid", ref, 23325, 18000, 6]);
  assert.equal(session.lines.reduce((sum, item) => sum + item.cents, 0), 23325);
  assert.equal(session.summary, `${formatDate(SOON)}, 10:00 AM. From JFK, Business SUV.`);
  assert.deepEqual(await readJson(await get("cs_mock_ZZZZZZ"), 200), { kind: "unknown" });
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
});

await test("handler: VERCEL_ENV=production with BOOK_MOCK=true and no key never mocks a payment, and refuses mock ids", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", VERCEL_ENV: "production" });
  const res = await post(STRIPE_JFK, { url: "https://www.nycluxride.com/api/book", origin: SITE });
  if (CONSENT_TERMS_LIVE) assert.equal((await readJson(res, 503)).code, "unavailable");
  else assert.equal((await readJson(res, 200)).reason, "paused");
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const { url } = await readJson(await post({ ...STRIPE_JFK, nonce: "nonce-mock-prod-000001" }), 200);
  setEnv({ BOOK_MOCK: "true", VERCEL_ENV: "production" });
  assert.deepEqual(await readJson(await get(url.split("=")[1]), 200), { kind: "unknown" });
  assert.equal(calls.length, 0);
});

await test("handler: the mock session map keeps at most 100 sessions and drops the oldest", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const ids = [];
  for (let i = 0; i < 101; i++) ids.push((await readJson(await post({ ...STRIPE_JFK, nonce: `nonce-cap-${String(i).padStart(4, "0")}-000000` }), 200)).url.split("=")[1]);
  assert.equal(new Set(ids).size, 101);
  assert.deepEqual(await readJson(await get(ids[0]), 200), { kind: "unknown" });
  assert.equal((await readJson(await get(ids[1]), 200)).payment_status, "paid");
  assert.equal((await readJson(await get(ids[100]), 200)).payment_status, "paid");
});

const ON_PREVIEW = { url: `${PREVIEW}/api/book`, origin: PREVIEW };

await test("handler: a preview with VERCEL_ENV as its only variable runs the mock flow with payments on and never calls fetch", async () => {
  setEnv({ VERCEL_ENV: "preview" });
  const fields = { ...PICKUP_SOON, nonce: "nonce-preview-demo-0001" };
  const options = await readJson(await post({ ...fields, action: "options" }, ON_PREVIEW), 200);
  assert.deepEqual([options.pay, options.price.total_cents, options.ref], [true, 23325, reqRef(fields)]);
  const paid = await readJson(await post(fields, ON_PREVIEW), 200);
  const ref = paid.ref;
  const id = `cs_mock_${ref.slice(4)}`;
  assert.deepEqual(paid, { kind: "pay", ref, url: `/booking-confirmed?session_id=${id}` });
  const form = await formPost(fields, ON_PREVIEW);
  assert.equal(form.status, 303);
  assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{8}$/);
  const session = await readJson(await get(id, PREVIEW), 200);
  assert.deepEqual([session.payment_status, session.ref, session.total_cents], ["paid", ref, 23325]);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
  setEnv({ VERCEL_ENV: "preview", STRIPE_SECRET_KEY: " \n" });
  assert.match((await readJson(await post(STRIPE_JFK, ON_PREVIEW), 200)).url, /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{8}$/);
  assert.equal(calls.length, 0);
});

await test("handler: the mock flow never starts by itself in production, with VERCEL_ENV unset or not exactly preview, or on a preview with a key", async () => {
  setEnv({ VERCEL_ENV: "preview" });
  const { url } = await readJson(await post({ ...STRIPE_JFK, nonce: "nonce-preview-demo-0002" }, ON_PREVIEW), 200);
  const id = url.split("=")[1];
  assert.equal((await get(id)).status, 200);
  const prod = { url: `${SITE}/api/book`, origin: SITE };
  const envs = [{ VERCEL_ENV: "production" }, {}, { VERCEL_ENV: "" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: "Preview" }, { VERCEL_ENV: " preview" }, { VERCEL_ENV: "preview", STRIPE_SECRET_KEY: KEY }, { VERCEL_ENV: "preview", STRIPE_SECRET_KEY: LIVE_KEY }];
  for (const env of envs) {
    setEnv(env);
    const options = env.VERCEL_ENV === "production" ? prod : {};
    assert.equal((await readJson(await post(STRIPE_JFK, options), 200)).reason, "paused", JSON.stringify(env));
    assertRedirect(await formPost(STRIPE_JFK, options), "/book#q-paused");
    assert.deepEqual(await readJson(await get(id), 200), { kind: "unknown" }, JSON.stringify(env));
    assert.equal(calls.length, 0);
  }
  for (const env of [{ VERCEL_ENV: "production" }, {}]) {
    setEnv({ ...env, PAYMENTS_ENABLED: "true" });
    const res = await post(STRIPE_JFK, env.VERCEL_ENV ? prod : {});
    assert.equal((await readJson(res, 200)).reason, "paused", "without a usable key payments pause");
    assert.deepEqual(await readJson(await get(id), 200), { kind: "unknown" });
    assert.equal(calls.length, 0);
  }
  setEnv({ VERCEL_ENV: "preview", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: KEY });
  assert.equal((await readJson(await post(STRIPE_JFK, ON_PREVIEW), 200)).url, CHECKOUT_URL);
  assert.equal(calls.length, 1);
});

await test("handler: no reply carries an Access-Control header, so another origin can never read one", async () => {
  setEnv(LIVE);
  stripe = (url, init) => (init.method === "GET" ? new Response(JSON.stringify(PAID_SESSION), { status: 200 }) : STRIPE_OK(url, init));
  const replies = [await post(STRIPE_JFK), await post({ ...STRIPE_JFK, action: "options" }), await post({ ...STRIPE_JFK, from_text: "350 5th Ave", action: "quote" }), await post({ ...STRIPE_JFK, from_text: "" }), await post(STRIPE_JFK, { origin: "https://evil.example" }), await formPost(STRIPE_JFK), await get(PAID_SESSION.id)];
  assert.deepEqual(replies.map((res) => res.status), [200, 200, 200, 422, 403, 303, 200]);
  for (const res of replies) assert.deepEqual([...res.headers.keys()].filter((name) => name.startsWith("access-control-")), []);
});

const EXPIRED = (url) => url.endsWith("/expire");
const created = (fields) => ({ id: "cs_test_a1B2c3D4e5F6g7H8i9J0", object: "checkout.session", url: CHECKOUT_URL, ...fields });

await test("handler: a create reply whose amount_total is not the total shown gives 502, logs amount-mismatch and expires the session", async () => {
  const fields = { ...STRIPE_JFK, nonce: "nonce-amount-check-0001" };
  const ref = reqRef(fields);
  const composed = errorBlock("stripe", contactLinks(await resolved(fields), ref, 18500));
  for (const amount of [18499, 18501, null]) {
    setEnv(LIVE);
    stripe = (url) => new Response(JSON.stringify(EXPIRED(url) ? { status: "expired" } : created({ amount_total: amount })), { status: 200 });
    assert.deepEqual(await readJson(await post(fields), 502), composed);
    assert.deepEqual(logged, [`amount-mismatch ${amount} 18500 ${formOf(calls[0]).get("metadata[ref]")}`]);
    assert.notEqual(formOf(calls[0]).get("metadata[ref]"), ref, "the payment carries its own reference, the request links the trip's");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "https://api.stripe.com/v1/checkout/sessions/cs_test_a1B2c3D4e5F6g7H8i9J0/expire");
    assert.equal(calls[1].init.method, "POST");
    assert.equal(new Headers(calls[1].init.headers).get("authorization"), `Bearer ${KEY}`);
    assertRedirect(await formPost(fields), "/book#q-error");
  }
  setEnv(LIVE);
  stripe = () => new Response(JSON.stringify(created({ amount_total: 18500 })), { status: 200 });
  assert.equal((await readJson(await post(fields), 200)).kind, "pay");
  assert.equal(calls.length, 1);
  assert.deepEqual(logged, []);
});

await test("handler: the total Stripe must match includes the tax, the Black Car Fund, the tolls, meet and greet and the tip", async () => {
  setEnv(LIVE);
  stripe = (url) => new Response(JSON.stringify(EXPIRED(url) ? {} : created({ amount_total: 15500 })), { status: 200 });
  const fields = { ...PICKUP_SOON, nonce: "nonce-full-total-000001" };
  assert.equal((await readJson(await post(fields), 502)).code, "stripe");
  assert.deepEqual(logged, [`amount-mismatch 15500 23325 ${formOf(calls[0]).get("metadata[ref]")}`]);
  setEnv(LIVE);
  const hourly = { ...trip(HOURLY), hours: "3", class: "suv", vehicle: "suv-denali", nonce: "nonce-half-cent-0000001" };
  assert.equal((await readJson(await post(hourly), 200)).kind, "pay");
  assert.deepEqual([formOf(calls[0]).get("metadata[tax_cents]"), formOf(calls[0]).get("metadata[total_cents]")], ["2663", "33338"]);
});

await test("handler: a create reply whose URL is not on a Checkout origin gives 502 and is never followed", async () => {
  for (const url of ["https://evil.example/c/pay/cs_test_x", "https://checkout.stripe.com.evil.example/c/pay", "http://checkout.stripe.com/c/pay", "/booking-confirmed?session_id=cs_mock_AAAAAA", 7]) {
    setEnv(LIVE);
    stripe = () => new Response(JSON.stringify(created({ url, amount_total: 18500 })), { status: 200, headers: { "request-id": "req_url0001" } });
    assert.equal((await readJson(await post(STRIPE_JFK), 502)).code, "stripe", String(url));
    assertRedirect(await formPost(STRIPE_JFK), "/book#q-error");
    assert.equal(calls.length, 2);
  }
  for (const origin of CHECKOUT_ORIGINS) assert.ok(CHECKOUT_URL.startsWith(`${origin}/`), origin);
});

await test("handler: a key pasted with spaces or a newline is trimmed, a key of the wrong shape pauses payment, makes lookups 503 and logs key-shape", async () => {
  setEnv({ ...LIVE, STRIPE_SECRET_KEY: ` ${KEY}\n` });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  for (const bad of ["not-a-key", ["pk", "test", "51NlrFakeKeyUsedOnlyInTests"].join("_"), ["rk", "test", "short"].join("_"), `${KEY} extra`]) {
    setEnv({ ...LIVE, STRIPE_SECRET_KEY: bad });
    assert.equal((await readJson(await post(STRIPE_JFK), 200)).reason, "paused", bad);
    assert.deepEqual([(await readJson(await post({ ...STRIPE_JFK, action: "options" }), 200)).pay, logged.length], [false, 1], bad);
    assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable", bad);
    assert.deepEqual(logged, ["key-shape", "key-shape"]);
    assert.equal(calls.length, 0);
  }
});

await test("handler: a live key outside production never runs mock mode or calls Stripe, a test key in production is refused", async () => {
  for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}]) {
    setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: LIVE_KEY, ...env });
    assert.equal((await readJson(await post(STRIPE_JFK), 200)).reason, "paused");
    assert.deepEqual(await readJson(await get("cs_mock_7K3Q2P"), 200), { kind: "unknown" });
    assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
    assert.deepEqual(logged, ["key-environment", "key-environment"]);
    assert.equal(calls.length, 0);
  }
  setEnv({ STRIPE_SECRET_KEY: KEY, VERCEL_ENV: "production" });
  assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
  assert.deepEqual(logged, ["key-environment"]);
  assert.equal(calls.length, 0);
  setEnv({ STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "production" });
  stripe = () => new Response(JSON.stringify(PAID_SESSION), { status: 200 });
  assert.equal((await readJson(await get(PAID_SESSION.id), 200)).payment_status, "paid");
  assert.equal(calls.length, 1);
  setEnv({ STRIPE_SECRET_KEY: ["sk", "live", "51NlrFakeKeyUsedOnlyInTests"].join("_"), VERCEL_ENV: "production" });
  assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
  assert.deepEqual(logged, ["key-shape"]);
  assert.equal(calls.length, 0);
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: ["sk", "live", "51NlrFakeKeyUsedOnlyInTests"].join("_") });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).reason, "paused");
  assert.equal(calls.length, 0);
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: KEY });
  assert.match((await readJson(await post(STRIPE_JFK), 200)).url, /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{8}$/);
  assert.equal(calls.length, 0);
});

await test("handler: production never opens a payment while CONSENT_TERMS_LIVE is false", async () => {
  const prod = { url: `${SITE}/api/book`, origin: SITE };
  setEnv({ PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "production" });
  const body = await readJson(await post(STRIPE_JFK, prod), 200);
  if (CONSENT_TERMS_LIVE) assert.equal(body.kind, "pay");
  else {
    assert.equal(body.reason, "paused");
    assertRedirect(await formPost(STRIPE_JFK, prod), "/book#q-paused");
    const options = await readJson(await post({ ...STRIPE_JFK, action: "options" }, prod), 200);
    assert.deepEqual([options.pay, options.hold, options.price.total_cents], [false, "paused", 18500]);
    assert.equal(calls.length, 0);
  }
  setEnv({ ...LIVE, VERCEL_ENV: "preview" });
  assert.equal((await readJson(await post(STRIPE_JFK, { url: `${PREVIEW}/api/book`, origin: PREVIEW }), 200)).kind, "pay");
});

await test("handler: odd text never throws, and a body that fails mid-read gives 503 with no-store", async () => {
  setEnv();
  for (const from_text of ["350 Fifth Avenue\ud800, 10118", `${"A".repeat(193)}\u{1F600}, 10118`, "\udc00\u202e\u0000"]) {
    const res = await post({ ...STRIPE_JFK, from_text });
    assert.equal(res.status, from_text.startsWith("\udc00") ? 422 : 200, JSON.stringify(from_text));
    noStore(res);
  }
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const text = (n) => String.fromCharCode(...Array.from({ length: n }, () => Math.floor(random() * 65536)));
  for (let i = 0; i < 40; i++) {
    const fields = { ...STRIPE_JFK, from_text: text(200), to_text: text(50), stop1_text: text(30), from_ticket: text(100), to_id: text(10), flight: text(20), nonce: text(30), tip: text(2), [text(5)]: text(100) };
    for (const res of [await post(fields), await post({ ...fields, action: "options" }), await formPost(fields), await post({}, { raw: text(1000) })]) {
      assert.ok([200, 303, 413, 422].includes(res.status), String(res.status));
      noStore(res);
    }
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
  const broken = new ReadableStream({ pull(controller) { controller.error(new Error("reset")); } });
  const res = await POST(new Request(`${LOCAL}/api/book`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: broken, duplex: "half" }));
  assert.equal((await readJson(res, 503)).code, "unavailable");
  assert.deepEqual(logged, ["handler"]);
});

await test("handler: read-back lines that do not add up to amount_total are logged, a session without metadata has no lines", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, amount_total: 23400 }), { status: 200 });
  assert.equal((await readJson(await get(PAID_SESSION.id), 200)).total_cents, 23400);
  assert.deepEqual(logged, ["receipt-mismatch NLR-Y8AHA2TE"]);
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, amount_total: 5000, metadata: {} }), { status: 200 });
  const link = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([link.ref, link.lines, link.total_cents, link.notes], ["NLR-Y8AHA2TE", [], 5000, AIRPORT_NOTES]);
  assert.deepEqual(logged, []);
});

async function later(offset, fn) {
  const realNow = Date.now;
  const start = realNow() + offset;
  const clock = { now: start };
  Date.now = () => clock.now;
  try {
    await fn(clock, start);
  } finally {
    Date.now = realNow;
  }
}

await test("handler: one instance makes at most 1200 Stripe creates and 1200 reads a minute as a runaway guard, then answers 503 without calling Stripe", async () => {
  await later(3600000, async (clock, start) => {
    setEnv(LIVE);
    for (let i = 0; i < 1200; i++) assert.equal((await post(STRIPE_JFK)).status, 200, String(i));
    assert.equal(calls.length, 1200);
    assert.equal((await readJson(await post(STRIPE_JFK), 503)).code, "unavailable");
    assert.equal(calls.length, 1200);
    stripe = () => new Response(JSON.stringify(PAID_SESSION), { status: 200 });
    for (let i = 0; i < 1200; i++) assert.equal((await get(PAID_SESSION.id)).status, 200, String(i));
    assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
    assert.equal(calls.length, 2400);
    assert.deepEqual(logged, ["stripe-budget", "stripe-budget"]);
    clock.now = start + 60001;
    stripe = STRIPE_OK;
    assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
    assert.equal(calls.length, 2401);
  });
});

await test("handler: a cross-site read never calls Stripe, and a read flood never blocks a booking", async () => {
  await later(7200000, async () => {
    setEnv(LIVE);
    const cross = await GET(new Request(`${SITE}/api/book?session_id=${PAID_SESSION.id}`, { headers: { "sec-fetch-site": "cross-site" } }));
    assert.equal(cross.status, 404);
    assert.equal(calls.length, 0);
    for (let i = 0; i < 200; i++) await get(`cs_live_${"a".repeat(12)}${i}`);
    assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  });
});

await test("handler: one address gets 10 Stripe creates a minute, the 11th answers 503 without calling Stripe, and another address still pays", async () => {
  await later(10800000, async (clock, start) => {
    setEnv(LIVE);
    const from = (ip) => post(STRIPE_JFK, { headers: { "x-real-ip": ip } });
    for (let i = 0; i < 10; i++) assert.equal((await readJson(await from("203.0.113.9"), 200)).kind, "pay", String(i));
    assert.equal(calls.length, 10);
    assert.equal((await readJson(await from("203.0.113.9"), 503)).code, "unavailable");
    assert.equal(calls.length, 10);
    assert.deepEqual(logged, ["client-budget"]);
    assert.equal((await readJson(await from("198.51.100.7"), 200)).kind, "pay");
    assert.equal(calls.length, 11);
    clock.now = start + 60001;
    assert.equal((await readJson(await from("203.0.113.9"), 200)).kind, "pay");
  });
});

await test("handler: one address gets 10 Stripe reads a minute, the 11th answers 503 without calling Stripe, and another address still reads", async () => {
  await later(14400000, async (clock, start) => {
    setEnv(LIVE);
    stripe = () => new Response(JSON.stringify(PAID_SESSION), { status: 200 });
    const read = (ip) => GET(new Request(`${LOCAL}/api/book?session_id=${PAID_SESSION.id}`, { headers: { "x-real-ip": ip } }));
    for (let i = 0; i < 10; i++) assert.equal((await readJson(await read("203.0.113.9"), 200)).payment_status, "paid", String(i));
    assert.equal(calls.length, 10);
    assert.equal((await readJson(await read("203.0.113.9"), 503)).code, "unavailable");
    assert.equal(calls.length, 10);
    assert.deepEqual(logged, ["client-budget"]);
    assert.equal((await readJson(await read("198.51.100.7"), 200)).payment_status, "paid");
    assert.equal(calls.length, 11);
    clock.now = start + 60001;
    assert.equal((await readJson(await read("203.0.113.9"), 200)).payment_status, "paid");
  });
});

await test("handler: options and quote requests never reach the Stripe budgets", async () => {
  await later(18000000, async () => {
    setEnv(LIVE);
    for (let i = 0; i < 130; i++) assert.equal((await readJson(await post({ ...STRIPE_JFK, action: "options" }, { headers: { "x-real-ip": "203.0.113.40" } }), 200)).kind, "options");
    assert.equal(calls.length, 0);
    assert.equal((await readJson(await post(STRIPE_JFK, { headers: { "x-real-ip": "203.0.113.40" } }), 200)).kind, "pay");
  });
});

await test("handler: a PAY_BLACKOUT_DATES entry that is not a year-month-day date pauses every trip and logs blackout-config", async () => {
  for (const PAY_BLACKOUT_DATES of ["12/31/2026", "2026-12-31,01/01/2027"]) {
    setEnv({ ...LIVE, PAY_BLACKOUT_DATES });
    const body = await readJson(await post(STRIPE_JFK), 200);
    assert.deepEqual([body.kind, body.reason], ["quote", "paused"], PAY_BLACKOUT_DATES);
    assert.equal(calls.length, 0);
    assert.deepEqual(logged, ["blackout-config"]);
  }
  setEnv({ ...LIVE, PAY_BLACKOUT_DATES: "2020-12-31; 2021-01-01" });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  assert.deepEqual(logged, []);
});

await test("handler: the place resolution of the server decides the price, a ticket from the pick prices a hotel", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const { signTicket } = await import("../api/_ticket.mjs");
  const label = "The New York EDITION";
  const ticket = signTicket("mock-edition", "manhattan", label, Date.now());
  const fields = { ...STRIPE_JFK, from_text: label, from_ticket: ticket, action: "options" };
  const body = await readJson(await post(fields), 200);
  assert.deepEqual([body.kind, body.price.total_cents], ["options", 18500]);
  assert.equal((await readJson(await post({ ...fields, from_ticket: "" }), 200)).reason, "unplaced");
  const full = "The New York EDITION, Madison Avenue, New York, NY, USA";
  assert.equal((await readJson(await post({ ...fields, from_text: full, from_ticket: "" }), 200)).price.total_cents, 18500);
  const outside = signTicket("mock-hoboken", "outside", "Hoboken", Date.now());
  assert.equal((await readJson(await post({ ...fields, from_text: "Hoboken", from_ticket: outside }), 200)).reason, "outside-city");
  assert.equal((await readJson(await post({ ...fields, from_text: "The Plaza Hotel" }), 200)).reason, "unplaced");
  assert.equal((await readJson(await post({ ...fields, from_ticket: `${ticket.slice(0, -2)}AA` }), 200)).reason, "unplaced");
  assert.equal(calls.length, 0);
});

async function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, "scripts/serve.mjs"), String(port)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dev server did not start")), 10000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("dev server")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", () => reject(new Error("dev server exited")));
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

for (const key of ENV_KEYS) delete process.env[key];
const server = await startServer({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" });
const http = async (url, init = {}) => {
  const res = await realFetch(url, { ...init, redirect: "manual" });
  return { status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() };
};
const jsonHeaders = () => ({ "content-type": "application/json", accept: "application/json", origin: server.base });
const send = (path, body) => http(`${server.base}${path}`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) });

await test("dev server: a PUT gives 405 with Allow: GET, POST, and the new endpoints answer only POST with Allow: POST", async () => {
  const res = await http(`${server.base}/api/book`, { method: "PUT" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "GET, POST");
  for (const path of ["/api/places", "/api/route", "/api/flight"]) {
    const answer = await http(`${server.base}${path}`);
    assert.equal(answer.status, 405, path);
    assert.equal(answer.headers.allow, "POST", path);
  }
});

await test("dev server: helpers, sources and unknown names under /api/ are 404", async () => {
  const paths = ["/api/_rates", "/api/_copy", "/api/_trip", "/api/_stripe", "/api/_places", "/api/_ticket", "/api/_google", "/api/_flight", "/api/_http", "/api/_mock", "/api/book.mjs", "/api/_rates.mjs", "/api/", "/api", "/api/missing", "/api/Book"];
  for (const path of paths) assert.equal((await http(`${server.base}${path}`)).status, 404, path);
});

await test("dev server: a full mock-mode booking: options, pay and the paid session", async () => {
  const fields = { ...PICKUP_SOON, nonce: "nonce-dev-server-000001" };
  const options = await send("/api/book", { ...fields, action: "options" });
  assert.equal(options.status, 200);
  assert.equal(JSON.parse(options.text).price.total_cents, 23325);
  const pay = await send("/api/book", fields);
  assert.equal(pay.status, 200);
  assert.equal(pay.headers["cache-control"], "no-store");
  const { url, ref } = JSON.parse(pay.text);
  assert.equal(url, `/booking-confirmed?session_id=cs_mock_${ref.slice(4)}`);
  const session = await http(`${server.base}/api${url.replace("/booking-confirmed", "/book")}`);
  assert.equal(session.status, 200);
  const body = JSON.parse(session.text);
  assert.deepEqual([body.payment_status, body.ref, body.total_cents], ["paid", ref, 23325]);
});

await test("dev server: a form post without JavaScript gets 303 redirects", async () => {
  const headers = { "content-type": "application/x-www-form-urlencoded", origin: server.base };
  const form = (fields) => http(`${server.base}/api/book`, { method: "POST", headers, body: new URLSearchParams(fields).toString() });
  const pay = await form({ ...STRIPE_JFK, nonce: "nonce-dev-form-0000001" });
  assert.equal(pay.status, 303);
  assert.match(pay.headers.location, /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{8}$/);
  for (const [fields, location] of [[{ ...trip(HOURLY), class: "sprinter" }, "/book#q-sprinter-hourly"], [{ ...STRIPE_JFK, from_text: "350 5th Ave" }, "/book#q-unplaced"], [{ ...STRIPE_JFK, from_text: "" }, "/book#e-from"]]) {
    const res = await form(fields);
    assert.deepEqual([res.status, res.headers.location], [303, location]);
  }
});

await test("dev server: a body over 12288 bytes is refused on its Content-Length with 413", async () => {
  const body = JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(12400) });
  const res = await http(`${server.base}/api/book`, { method: "POST", headers: { ...jsonHeaders(), "content-length": String(Buffer.byteLength(body)) }, body });
  assert.equal(res.status, 413);
  assert.equal(JSON.parse(res.text).code, "too-large");
});

await test("dev server: the places, route and flight mocks answer through the server", async () => {
  const session = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
  const suggest = JSON.parse((await send("/api/places", { action: "suggest", input: "edition", session })).text);
  assert.deepEqual([suggest.kind, suggest.google, suggest.items[0].id], ["ok", true, "mock-edition"]);
  const label = "The New York EDITION, Madison Avenue, New York, NY";
  const pick = JSON.parse((await send("/api/places", { action: "pick", id: "mock-edition", session, label, proof: suggest.items[0].proof })).text);
  const older = JSON.parse((await send("/api/places", { action: "pick", id: "mock-edition", session, label: `${label}, USA`, proof: suggest.items[0].proof })).text);
  assert.deepEqual([older.kind, older.zone], ["ok", "manhattan"], "a page loaded before the label change still picks with the USA label");
  assert.equal(JSON.parse((await send("/api/places", { action: "pick", id: "mock-edition", session, label: "12 Washington St, Hoboken, NJ 07030", proof: suggest.items[0].proof })).text).kind, "error");
  assert.deepEqual([pick.kind, pick.zone, pick.airport], ["ok", "manhattan", false]);
  const route = JSON.parse((await send("/api/route", { from: { ticket: pick.ticket }, to: { id: "jfk-t4" }, date: SOON, time: "10:00", map: { width: 440, height: 271 } })).text);
  assert.deepEqual([route.kind, route.minutes, route.map.width, route.map.height], ["ok", 43, 440, 271]);
  const phone = JSON.parse((await send("/api/route", { from: { ticket: pick.ticket }, to: { id: "jfk-t4" }, date: SOON, time: "10:00" })).text);
  assert.deepEqual(phone, { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" });
  const flight = JSON.parse((await send("/api/flight", { number: "EK201", date: SOON, airport: "JFK" })).text);
  assert.equal(flight.flight.number, "EK 201");
  const options = JSON.parse((await send("/api/book", { ...STRIPE_JFK, from_text: label, from_ticket: pick.ticket, action: "options" })).text);
  assert.equal(options.price.total_cents, 18500);
});

await test("dev server: static pages are still served", async () => {
  for (const path of ["/", "/rates", "/book", "/locations/jfk-airport"]) assert.equal((await http(`${server.base}${path}`)).status, 200, path);
});

await test("dev server: the 19 booking pages carry the Content-Security-Policy of vercel.json, other pages do not", async () => {
  const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const areas = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"].map((a) => `/locations/${a}`);
  for (const path of ["/", "/book", "/booking-confirmed", "/locations/jfk-airport", "/locations/laguardia-airport", "/services", "/chauffeur-service-nyc", "/limousine-service-nyc", "/black-car-service-brooklyn", ...areas]) {
    const rule = config.headers.find((r) => r.source === path);
    const policy = rule.headers.find((h) => h.key === "Content-Security-Policy").value;
    assert.equal((await http(`${server.base}${path}`)).headers["content-security-policy"], policy, path);
  }
  for (const path of ["/rates", "/faq", "/about", "/locations", "/blog", "/api/book?session_id=x"]) assert.equal((await http(`${server.base}${path}`)).headers["content-security-policy"], undefined, path);
});

await test("dev server: with VERCEL_ENV=preview as the only variable a booking reaches the paid mock session, with VERCEL_ENV=production it does not", async () => {
  for (const VERCEL_ENV of ["preview", "production"]) {
    const demo = await startServer({ VERCEL_ENV });
    try {
      const origin = VERCEL_ENV === "production" ? SITE : demo.base;
      const headers = { "content-type": "application/json", accept: "application/json", origin };
      const pay = await http(`${demo.base}/api/book`, { method: "POST", headers, body: JSON.stringify({ ...PICKUP_SOON, nonce: "nonce-dev-preview-00001" }) });
      const reply = JSON.parse(pay.text);
      if (VERCEL_ENV === "production") {
        assert.equal(pay.status, 200);
        assert.equal(reply.reason, "paused");
        const lookup = await http(`${demo.base}/api/book?session_id=cs_mock_${bookingRef("nonce-dev-preview-00001").slice(4)}`);
        assert.deepEqual([lookup.status, JSON.parse(lookup.text)], [200, { kind: "unknown" }]);
        continue;
      }
      assert.equal(pay.status, 200);
      assert.equal(reply.url, `/booking-confirmed?session_id=cs_mock_${reply.ref.slice(4)}`);
      const session = JSON.parse((await http(`${demo.base}/api${reply.url.replace("/booking-confirmed", "/book")}`)).text);
      assert.deepEqual([session.payment_status, session.total_cents], ["paid", 23325]);
    } finally {
      demo.child.kill();
    }
  }
});

await test("receipt: a round trip summary names the return pickup, a one way trip does not", async () => {
  const round = await build(ROUND, ON, "nonce-round-trip-000001");
  const one = await build({ ...ROUND, return: "" }, ON, "nonce-round-trip-000001");
  assert.equal(receipt(metadataFor(round.trip, round.price, round.ref), ON).summary, "Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. First Class, 2 airport transfers.");
  assert.equal(receipt(metadataFor(one.trip, one.price, one.ref), ON).summary, "Wed, Oct 14, 2026, 7:30 AM. To JFK, First Class.");
});

await test("budgets: IPv6 clients share one key per /64 and mapped IPv4 reads as IPv4", () => {
  const key = (ip) => clientKey(new Request(SITE, { headers: { "x-real-ip": ip } }));
  assert.deepEqual(["2001:db8:1:2:3:4:5:6", "2001:DB8:0001:0002:aaaa::1", "2001:db8:1:2::9"].map(key), Array(3).fill("2001:db8:1:2::/64"));
  assert.equal(key("2001:db8:1:3::9"), "2001:db8:1:3::/64");
  assert.deepEqual([key("::ffff:203.0.113.9"), key("203.0.113.9")], ["203.0.113.9", "203.0.113.9"]);
});

await test("clean: invisible format characters are dropped, joiners inside emoji stay", () => {
  const ch = (...codes) => String.fromCharCode(...codes);
  assert.equal(clean(ch(0x200b, 0x200b), 50), "");
  assert.equal(clean(`Ana${ch(0x200b)} Lopez${ch(0xfeff)}`, 50), "Ana Lopez");
  assert.equal(clean(`a${ch(0x200d)}b`, 50), `a${ch(0x200d)}b`);
});

server.child.kill();

if (failures) {
  process.stderr.write(`\n${failures} test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll book-params tests passed\n");
process.exit(0);
