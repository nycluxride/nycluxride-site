import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readInput, readSettings, resolveTrip, priceTrip, priceDistance, priceRide, priceLeg, rateKey, bookingRef, requestRef, composeMessage, contactLinks, formatDate, receipt, firstSlot, shownLines, nycToUtc, REF, ownerSubject, bookingData } from "../api/_trip.mjs";
import { clientKey, clean } from "../api/_http.mjs";
import { sessionParams, encodeForm, metadataFor } from "../api/_stripe.mjs";
import { bookingLetters } from "../api/_mail.mjs";
import { POST, GET } from "../api/book.mjs";
import { CHECKOUT, ERRORS, HEADINGS, REASONS, ERROR_BLOCK, NOTES, POLICY } from "../api/_copy.mjs";
import { DESCRIPTOR_CODES, AIRPORT_PLACES, AIRPORT_FARES, AIRPORT_TOTALS, STOP_FEE_CENTS, CHECKOUT_ORIGINS, CONSENT_TERMS_LIVE, TIP_PERCENTS, MIN_NOTICE_MINUTES, AUTO_LEAD_MINUTES, PAID_NOTICE_MINUTES, CLASSES, WAIT_CENTS_PER_MINUTE } from "../api/_rates.mjs";
import { ROUTE, signTicket, signRoute, routeKey } from "../api/_ticket.mjs";
import { localById } from "../api/_places.mjs";

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
const ENV_KEYS = ["BOOKING_REF_SECRET", "PLACE_TICKET_SECRET", "STRIPE_SECRET_KEY", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT", "BOOK_MOCK", "VERCEL_ENV", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MOCK", "FLIGHT_MOCK", "FLIGHT_API_KEY", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "STRIPE_WEBHOOK_SECRET"];
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const TERMS =
  "I agree to the [terms of service](https://www.nycluxride.com/terms-of-service#payments) and the [cancellation, no-show and waiting terms](https://www.nycluxride.com/rates#policies). I allow charges to this card after the ride for extra waiting, stops added during the ride, parking and any tolls not in the price.";
const SUBMIT =
  "You pay the total shown today. Extra waiting, stops added during the ride and parking are charged to this card after the ride, with a receipt.";
const SUBMIT_HOURLY =
  "You pay the total shown today. Tolls and parking are charged to this card after the ride, with a receipt.";
const SUBMIT_DISTANCE =
  "You pay the total shown today. Tolls and parking are charged to this card after the ride, with a receipt.";
const SUBMIT_OUTSIDE =
  "You pay the total shown today. Extra waiting, tolls and parking are charged to this card after the ride, with a receipt.";
const AIRPORT_NOTE = "Tolls, airport fees, NYC sales tax and the Black Car Fund are included. Extra waiting, stops added during the ride and parking are charged to your card after the ride.";
const HOURLY_NOTE = "Tolls and parking are charged to your card after the ride.";
const OUTSIDE_NOTE = "Extra waiting, tolls and parking are charged to your card after the ride.";
const AIRPORT_NOTES = [NOTES.included, POLICY.later.airport];

const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
const PICKUP = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", meet: "1", flight: "DL 401", tip: "15", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", notes: "Two large cases" };
const DROPOFF = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv" };
const HOURLY = { trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", rider: "me", ...ME, reach: "phone", notes: "A toddler seat, please" };
const ROUND = { trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", date: "2026-10-14", time: "07:30", passengers: "3", class: "first", return: "1", return_date: "2026-10-18", return_time: "18:00", return_flight: "B6 1234", tip: "10", rider: "me", ...ME, pname: "Not Sent", pphone: "+1 917 555 0199", sign: "Not Sent Either" };
const CUSTOM = { ...DROPOFF, tip: "custom", tip_amount: "40", rider: "other", ...ME, phone: "07700 900123", phone_cc: "GB", reach: "whatsapp", pname: "Ben Ortiz", pphone: "(917) 555-0142" };

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

const TAX = "NYC sales tax";
const BCF = "Black Car Fund";
const TOLLS = "Tolls and airport fees";
const FEES = "Taxes and fees";
const TOLLS_SHOWN = "Tolls";
const MEET_TEXT = "Inside the terminal with a name sign. Airport parking is charged after the ride.";
const TIP_TEXT = "Paid in full to your chauffeur.";

const ROUND_REF = bookingRef("nonce-round-trip-000001");
const DISTANCE = { trip_type: "one", from_text: MANHATTAN, to_text: "Greenwich, CT 06830", date: "2026-10-14", time: "07:30", passengers: "2", class: "sedan", return: "1", return_date: "2026-10-18", return_time: "18:00", tip: "15", rider: "me", ...ME, reach: "phone" };
const DISTANCE_REF = bookingRef("nonce-distance-trip-00001");
const NJ_PICKUP = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "Secaucus, NJ 07094", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", meet: "1", flight: "EK 201", tip: "15", rider: "me", ...ME, reach: "whatsapp" };
const NJ_REF = bookingRef("nonce-nj-pickup-0000001");
const CUSTOM_REF = bookingRef("nonce-custom-tip-0000001");
const EXPECTED = {
  "an airport pickup with meet and greet and a 15% gratuity": [
    PICKUP,
    "nonce-airport-pickup-0001",
    "69042564",
    {
      ...common("69042564", { email: ME.email }),
      ...lines([
        ["Fare", 15500, "From JFK, Business SUV. Reference 69042564. Wed, Oct 14, 2026, 7:30 AM. 2 passengers. Extra waiting is $1.50 a minute."],
        [FEES, 1376 + 349],
        [TOLLS_SHOWN, 1275],
        ["Meet and greet", 2500, MEET_TEXT],
        ["Gratuity for your chauffeur (15%)", 2325, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `New booking 69042564: Wed Oct 14, 7:30 AM, Business SUV, JFK to 350 5th Ave. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Passenger Ben Ortiz. Passenger phone +44 20 7946 0958. Flight DL 401. 2 passengers. Meet and greet. Pickup "John F. Kennedy (JFK), Terminal 4". Drop-off "${MANHATTAN}". Note: Two large cases.`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: "69042564",
        service: "airport",
        direction: "from-airport",
        airport: "jfk",
        class: "suv",
        from_text: "John F. Kennedy (JFK), Terminal 4",
        to_text: MANHATTAN,
        zones: "from jfk, to manhattan",
        places: "from jfk-t4",
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
    "11131522",
    {
      ...common("11131522"),
      ...lines([["Fare", 15500, "To JFK, Business SUV. Reference 11131522. Wed, Oct 14, 2026, 7:30 AM. 2 passengers. Extra waiting is $1.50 a minute."], [FEES, 1376 + 349], [TOLLS_SHOWN, 1275]]),
      "payment_intent_data[description]": `New booking 11131522: Wed Oct 14, 7:30 AM, Business SUV, 350 5th Ave to JFK. 2 passengers. Pickup "${MANHATTAN}". Drop-off "John F. Kennedy (JFK)".`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: "11131522",
        service: "airport",
        direction: "to-airport",
        airport: "jfk",
        class: "suv",
        from_text: MANHATTAN,
        to_text: "John F. Kennedy (JFK)",
        zones: "from manhattan, to jfk",
        places: "to jfk",
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
    "77340023",
    {
      ...common("77340023", { hourly: true, email: ME.email }),
      ...lines([["Fare, 4 hours", 42000, "By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours. Reference 77340023. Tue, Dec 1, 2026, 2:00 PM. 1 passenger."], [FEES, 3728 + 945]]),
      "payment_intent_data[description]": 'New booking 77340023: Tue Dec 1, 2:00 PM, Business Premium SUV, 4 hours from 1 Main Street. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 1 passenger. Pickup "1 Main Street, Brooklyn, NY 11201". Note: A toddler seat, please.',
      "payment_intent_data[statement_descriptor_suffix]": "HOUR DEC01",
      ...bothMetadata({
        ref: "77340023",
        service: "hourly",
        class: "premium",
        vehicle: "premium",
        hours: "4",
        from_text: "1 Main Street, Brooklyn, NY 11201",
        zones: "from brooklyn",
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
        ["Fare", 53498, `First Class, 2 airport transfers. Reference ${ROUND_REF}. Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. 3 passengers. Extra waiting is $2.80 a minute.`],
        [FEES, 4748 + 1204],
        [TOLLS_SHOWN, 2550],
        ["Gratuity for your chauffeur (10%)", 5350, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `New booking ${ROUND_REF}: Wed Oct 14, 7:30 AM, First Class, 350 5th Ave to JFK, return Sun Oct 18, 6:00 PM. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Return flight B6 1234. 3 passengers. Pickup "${MANHATTAN}". Drop-off "John F. Kennedy (JFK), Terminal 5".`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: ROUND_REF,
        service: "airport",
        direction: "to-airport",
        airport: "jfk",
        class: "first",
        from_text: MANHATTAN,
        to_text: "John F. Kennedy (JFK), Terminal 5",
        zones: "from manhattan, to jfk",
        places: "to jfk-t5",
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
  "an airport drop-off with a gratuity of 40 dollars typed by the rider and mobile numbers from two countries": [
    CUSTOM,
    "nonce-custom-tip-0000001",
    CUSTOM_REF,
    {
      ...common(CUSTOM_REF, { email: ME.email }),
      ...lines([
        ["Fare", 15500, `To JFK, Business SUV. Reference ${CUSTOM_REF}. Wed, Oct 14, 2026, 7:30 AM. 2 passengers. Extra waiting is $1.50 a minute.`],
        [FEES, 1376 + 349],
        [TOLLS_SHOWN, 1275],
        ["Gratuity for your chauffeur", 4000, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `New booking ${CUSTOM_REF}: Wed Oct 14, 7:30 AM, Business SUV, 350 5th Ave to JFK. Customer Ana Lopez. Phone +44 7700 900123. Email ana.lopez@example.com. Passenger Ben Ortiz. Passenger phone +1 917 555 0142. 2 passengers. Pickup "${MANHATTAN}". Drop-off "John F. Kennedy (JFK)".`,
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: CUSTOM_REF,
        service: "airport",
        direction: "to-airport",
        airport: "jfk",
        class: "suv",
        from_text: MANHATTAN,
        to_text: "John F. Kennedy (JFK)",
        zones: "from manhattan, to jfk",
        places: "to jfk",
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
        tip_cents: "4000",
        total_cents: "22500",
        rider: "other",
        name: ME.name,
        email: ME.email,
        phone: "+44 7700 900123",
        reach: "whatsapp",
        passenger_name: "Ben Ortiz",
        passenger_phone: "+1 917 555 0142",
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
const noted = [];
console.log = (...args) => noted.push(args.map(String).join(" "));

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
  noted.length = 0;
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

await test("builder: a JFK terminal typed after the airport name, with meet and greet and a 15% gratuity, equals the complete expected map of the airport pickup with its own pickup text", async () => {
  const typed = "Terminal 4, JFK Airport, Queens, NY";
  const [fields, nonce, ref, expected] = EXPECTED["an airport pickup with meet and greet and a 15% gratuity"];
  const built = await build({ ...fields, from_text: typed, from_id: "" }, ON, nonce);
  assert.equal(built.ref, ref);
  assert.deepEqual(Object.fromEntries([...built.params]), { ...expected, ...bothMetadata({ from_text: typed, places: "from jfk" }), "payment_intent_data[description]": expected["payment_intent_data[description]"].replace('Pickup "John F. Kennedy (JFK), Terminal 4"', `Pickup "${typed}"`) });
  assert.deepEqual([built.trip.from, built.trip.flight, built.trip.meet, built.price.total], ["jfk", "DL 401", true, 23325]);
});

await test("builder: no line carries tax_rates, every line is quantity 1, names are the labels the site shows", async () => {
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND, CUSTOM]) {
    const { params, price } = await build(fields, ON, "nonce-tax-rates-000000");
    assert.ok(![...params.keys()].some((key) => key.includes("tax_rates")));
    const shown = shownLines(price.lines);
    shown.forEach((entry, i) => {
      assert.equal(params.get(`line_items[${i}][quantity]`), "1");
      assert.equal(params.get(`line_items[${i}][price_data][product_data][name]`), entry.label);
      assert.equal(params.get(`line_items[${i}][price_data][unit_amount]`), String(entry.cents));
      assert.ok(!params.has(`line_items[${i}][price_data][product_data][unit_label]`));
    });
    assert.ok(!params.has(`line_items[${shown.length}][quantity]`));
  }
});

await test("builder: NYCLUXRIDE* plus the suffix is at most 22 characters for every airport and for hourly, in every month", async () => {
  const cases = [];
  const labels = { jfk: "John F. Kennedy (JFK)", lga: "LaGuardia (LGA)", ewr: "Newark Liberty (EWR)", teb: "Teterboro (TEB)" };
  for (let month = 1; month <= 12; month++) {
    const date = `2027-${String(month).padStart(2, "0")}-28`;
    for (const airport of AIRPORT_PLACES) cases.push([{ ...DROPOFF, to_text: labels[airport], to_id: airport, date }, DESCRIPTOR_CODES[airport]]);
    cases.push([{ ...HOURLY, date }, DESCRIPTOR_CODES.hourly]);
    cases.push([{ ...DISTANCE, return: "", date }, DESCRIPTOR_CODES.distance]);
  }
  process.env.GOOGLE_MOCK = "true";
  for (const [fields, code] of cases) {
    const { params } = await build(fields, ON, "nonce-descriptor-0000");
    const suffix = params.get("payment_intent_data[statement_descriptor_suffix]");
    assert.match(suffix, new RegExp(`^${code} [A-Z]{3}28$`));
    assert.ok(`${DESCRIPTOR_PREFIX}* ${suffix}`.length <= 22, `${DESCRIPTOR_PREFIX}* ${suffix}`);
    assert.ok(/[A-Z]/.test(suffix) && !/[<>\\'"*]/.test(suffix), suffix);
  }
  delete process.env.GOOGLE_MOCK;
  const { params } = await build({ ...PICKUP, from_text: "LaGuardia (LGA), Terminal B", from_id: "lga-tb" }, ON, "nonce-descriptor-0001");
  assert.equal(params.get("payment_intent_data[statement_descriptor_suffix]"), "LGA OCT14");
});

await test("builder: metadata has at most 50 keys, the keys of 3.8 only, empty values left out, every value at most 500 characters", async () => {
  const ALLOWED = "ref service direction airport class vehicle event hours from_text to_text stop1_text stop2_text zones places date time pickup_at return_date return_time return_at passengers flight return_flight meet tip_percent legs fare_cents tax_cents bcf_cents tolls_cents meet_cents tip_cents total_cents rider name email phone reach passenger_name passenger_phone sign_name notes short_notice".split(" ");
  assert.equal(ALLOWED.length, 43);
  const stops = { ...PICKUP, from_text: "John F. Kennedy (JFK)", from_id: "jfk", stop1_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga", tip: "" };
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND, CUSTOM, stops]) {
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
  assert.deepEqual([params.get("metadata[stop1_text]"), params.get("metadata[zones]"), params.get("metadata[places]"), params.get("metadata[legs]"), params.get("metadata[total_cents]")], [MANHATTAN, "from jfk, stop1 manhattan, to lga", "from jfk, to lga", "2", "37500"]);
  const me = await build({ ...PICKUP, rider: "me" }, ON, "nonce-metadata-0000002");
  assert.deepEqual([me.params.get("metadata[rider]"), me.params.get("metadata[passenger_name]"), me.params.get("metadata[passenger_phone]"), me.params.get("metadata[sign_name]")], ["me", null, null, "Ana Lopez"]);
  const other = await build({ ...PICKUP, pname: `${"Dana Reyes ".repeat(9)}Long`, pphone: "+44 20 7946 0958" }, ON, "nonce-metadata-0000005");
  const om = [...other.params].filter(([key]) => key.startsWith("metadata["));
  assert.ok(om.length <= 50 && om.every(([key]) => key.length - 10 <= 40), "Stripe allows 50 keys of at most 40 characters");
  assert.deepEqual(["rider", "passenger_name", "passenger_phone"].map((k) => [other.params.get(`metadata[${k}]`), other.params.get(`payment_intent_data[metadata][${k}]`)]), [["other", "other"], ["Dana Reyes ".repeat(9).slice(0, 80).trim(), "Dana Reyes ".repeat(9).slice(0, 80).trim()], ["+44 20 7946 0958", "+44 20 7946 0958"]], "someone else: the rider's name (at most 80 characters) and mobile ride on the session and the payment");
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
  assert.equal(CHECKOUT.submitDistance, SUBMIT_DISTANCE);
  assert.equal(CHECKOUT.submitOutside, SUBMIT_OUTSIDE);
  assert.ok(`${CHECKOUT.license.replace("{license}", "B00000")} ${CHECKOUT.afterSubmit.replace("{ref}", "48213590")}`.length <= 1200);
});

await test("builder: descriptions start with the owner's booking email subject and the reference, within Stripe's limits, and the payer's page shows no free text", async () => {
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND, CUSTOM]) {
    const long = { ...fields, from_text: fields.from_id ? fields.from_text : `${"D".repeat(180)}, 10118`, to_text: fields.to_id || fields.trip_type === "hour" ? fields.to_text : `${"E".repeat(180)}, 10118` };
    const { params, ref } = await build(long, ON, "nonce-description-0000");
    const intent = params.get("payment_intent_data[description]");
    assert.ok(intent.startsWith(`New booking ${ref}: `), intent);
    assert.ok(intent.length <= 1000);
    assert.ok(intent.includes("D".repeat(150)) || intent.includes("E".repeat(150)), intent);
    const product = params.get("line_items[0][price_data][product_data][description]");
    assert.ok(product.includes(`. Reference ${ref}. `), product);
    assert.ok(!product.includes("DD") && !product.includes("EE") && !product.includes("5th Ave"), product);
    for (const [key, value] of params) if (key.startsWith("line_items[")) assert.ok(!value.includes("DD") && !value.includes("EE"), key);
  }
});

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const ownerMail = (params, ref, total) => {
  const metadata = Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  const session = { id: "cs_test_description0001", livemode: false, payment_status: "paid", client_reference_id: ref, amount_total: total, customer_details: {}, metadata };
  return { metadata, owner: bookingLetters(session, { owners: ["owner@example.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }).find((letter) => letter.kind === "owner") };
};

await test("builder: the payment description reads like the owner's booking email subject, from the same builder, then the customer, phone, email, flights, passengers, seats, meet and greet, the full addresses the subject shortens and the note, for an airport transfer, a trip with stops, a round trip, an hourly booking and a trip priced by distance", async () => {
  setEnv({ GOOGLE_MOCK: "true" });
  try {
    const DAY = { date: "2026-11-16", time: "15:00", rider: "me", ...ME, reach: "phone" };
    const CASES = [
      [{ trip_type: "one", from_text: "The Plaza Hotel, 768 5th Ave, New York, NY 10019", to_text: "Newark Liberty (EWR)", to_id: "ewr", passengers: "4", class: "suv", toddler_seats: "2", ...DAY },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, Business SUV, The Plaza Hotel to Newark Liberty (EWR). Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 4 passengers. 2 child seats. Pickup "The Plaza Hotel, 768 5th Ave, New York, NY 10019".`, "EWR NOV16"],
      [{ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", stop2_text: "40 Wall St, New York, NY 10005", to_text: "55 Church St, New York, NY 10007", passengers: "1", class: "suv", meet: "1", flight: "DL 401", ...DAY, notes: "Call on landing." },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, Business SUV, LaGuardia (LGA) to 55 Church St. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Flight DL 401. 1 passenger. Meet and greet. Stop 1 "26 Ann St, New York, NY 10038". Stop 2 "40 Wall St, New York, NY 10005". Drop-off "55 Church St, New York, NY 10007". Note: Call on landing.`, "LGA NOV16"],
      [{ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", to_text: "55 Church St, New York, NY 10007", passengers: "6", class: "sprinter", meet: "1", flight: "DL 401", ...DAY, notes: "Two large cases and a stroller." },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, Executive Sprinter, LaGuardia (LGA) to 55 Church St. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Flight DL 401. 6 passengers. Meet and greet. Stop 1 "26 Ann St, New York, NY 10038". Drop-off "55 Church St, New York, NY 10007". Note: Two large cases and a stroller.`, "LGA NOV16"],
      [{ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", to_text: "55 Church St, New York, NY 10007", passengers: "6", class: "sprinter", flight: "DL 401", return: "1", return_date: "2026-11-20", return_time: "18:00", ...DAY },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, Executive Sprinter, LaGuardia (LGA) to 55 Church St, return Fri Nov 20, 6:00 PM. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Flight DL 401. 6 passengers. Stop 1 "26 Ann St, New York, NY 10038". Drop-off "55 Church St, New York, NY 10007".`, "LGA NOV16"],
      [{ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", passengers: "3", class: "first", return: "1", return_date: "2026-11-20", return_time: "18:00", return_flight: "B6 1234", booster_seats: "1", ...DAY },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, First Class, 350 5th Ave to JFK, return Fri Nov 20, 6:00 PM. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Return flight B6 1234. 3 passengers. 1 booster seat. Pickup "${MANHATTAN}". Drop-off "John F. Kennedy (JFK), Terminal 5".`, "JFK NOV16"],
      [{ trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", passengers: "1", hours: "4", class: "premium", vehicle: "premium", ...DAY, notes: "Two stops in SoHo, then back." },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, Business Premium SUV, 4 hours from 1 Main Street. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 1 passenger. Pickup "1 Main Street, Brooklyn, NY 11201". Note: Two stops in SoHo, then back.`, "HOUR NOV16"],
      [{ trip_type: "one", from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: "Secaucus, NJ 07094", passengers: "2", class: "sedan", ...DAY, name: "", email: "", phone: "" },
        (ref) => `New booking ${ref}: Mon Nov 16, 3:00 PM, Executive Sedan, JFK to Secaucus. 2 passengers. Pickup "John F. Kennedy (JFK)". Drop-off "Secaucus, NJ 07094".`, "RIDE NOV16"],
    ];
    for (const [fields, want, suffix] of CASES) {
      const { params, ref, price } = await build(fields, ON, `nonce-description-${fields.class}-${fields.return ? "02" : "01"}`);
      const intent = params.get("payment_intent_data[description]");
      assert.equal(intent, want(ref), JSON.stringify(fields));
      const { metadata, owner } = ownerMail(params, ref, price.total);
      assert.equal(owner.subject, `[TEST] ${ownerSubject(metadata, ref)}`, "the owner email and the payment description use one subject builder");
      assert.ok(intent.startsWith(`${ownerSubject(metadata, ref)}. `), intent);
      assert.equal(params.get("payment_intent_data[statement_descriptor_suffix]"), suffix, JSON.stringify(fields));
    }
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("builder: the payment description removes control characters and runs of spaces, tabs and new lines from what the rider typed, and never repeats the period after a note or a place that ends with one", async () => {
  const { params, ref } = await build({ ...DROPOFF, from_text: "350  5th Ave,   New York, NY 10118", name: "Ana\u0007  Lopez\t", email: "ana.lopez@example.com", phone: "+1 212 555 0100", rider: "me", notes: "Two\n\nlarge\tbags please." }, ON, "nonce-description-clean-1");
  assert.equal(params.get("payment_intent_data[description]"), `New booking ${ref}: Wed Oct 14, 7:30 AM, Business SUV, 350 5th Ave to JFK. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 2 passengers. Pickup "350 5th Ave, New York, NY 10118". Drop-off "John F. Kennedy (JFK)". Note: Two large bags please.`);
});

await test("builder: the payment description adds no period after a note that ends with a question mark or an exclamation mark", async () => {
  const JFK = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-10-14", time: "07:30", passengers: "12", class: "sprinter" };
  for (const [notes, end] of [["Can you help with bags?", "Can you help with bags?"], ["Ring twice!", "Ring twice!"], ["Is the car seat ready?..", "Is the car seat ready?"], ["Wait at door 4...", "Wait at door 4."]]) {
    const { params, ref } = await build({ ...JFK, notes }, ON, "nonce-description-mark-1");
    assert.equal(params.get("payment_intent_data[description]"), `New booking ${ref}: Wed Oct 14, 7:30 AM, Executive Sprinter, JFK to 350 5th Ave. 12 passengers. Pickup "John F. Kennedy (JFK), Terminal 4". Drop-off "${MANHATTAN}". Note: ${end}`);
  }
});

await test("builder: a payment description over 1000 characters cuts only the note, never inside an emoji, and keeps the customer, phone, email and every address, and with the longest names, emails and addresses the addresses are shortened before the customer details", async () => {
  const LONG = { name: "N".repeat(80), email: `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.com`, phone: "+1 212 555 0100", rider: "me" };
  const far = (letter, zip) => `${letter.repeat(180)}, New York, NY ${zip}`;
  const base = { trip_type: "one", from_text: far("D", "10118"), to_text: far("E", "10007"), date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", ...LONG };
  for (const lead of ["", "x", "xy", "xyz"]) {
    const note = `${lead}${"\u{1F600}".repeat(300)}`;
    const { params, ref } = await build({ ...base, notes: note }, ON, "nonce-description-long-01");
    const intent = params.get("payment_intent_data[description]");
    const head = `New booking ${ref}: Wed Oct 14, 7:30 AM, Business SUV, ${"D".repeat(60)} to ${"E".repeat(60)}. Customer ${LONG.name}. Phone ${LONG.phone}. Email ${LONG.email}. 2 passengers. Pickup "${"D".repeat(160)}". Drop-off "${"E".repeat(160)}". Note: ${lead}`;
    assert.ok(intent.startsWith(head), intent);
    assert.ok(intent.length <= 1000 && intent.length >= 998, `${lead}: ${intent.length}`);
    assert.ok(intent.endsWith("\u{1F600}."), intent.slice(-8));
    assert.ok(!LONE_SURROGATE.test(intent), lead);
    assert.ok(intent.length - head.length - 1 < note.length, "the note is cut");
  }
  const { params } = await build({ ...base, stop1_text: far("S", "10038"), stop2_text: far("T", "10005"), notes: "Call on landing." }, ON, "nonce-description-long-02");
  const intent = params.get("payment_intent_data[description]");
  assert.ok(intent.length <= 1000, String(intent.length));
  assert.ok(intent.includes(`. Customer ${LONG.name}. Phone ${LONG.phone}. Email ${LONG.email}. 2 passengers. Pickup "${"D".repeat(80)}". Stop 1 "${"S".repeat(80)}". Stop 2 "${"T".repeat(80)}". Drop-off "${"E".repeat(80)}". Note: Call on landing.`), intent);
  assert.ok(!LONE_SURROGATE.test(intent));
  setEnv({ GOOGLE_MOCK: "true" });
  try {
    const crowded = { ...base, stop1_text: far("S", "10038"), stop2_text: far("T", "10005"), class: "premium", passengers: "6", infant_seats: "1", toddler_seats: "1", booster_seats: "1", email: `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(65)}` };
    const quiet = (await build(crowded, ON, "nonce-description-long-03")).params.get("payment_intent_data[description]");
    assert.ok(quiet.length > 990 && quiet.length < 1000 && quiet.includes(`Stop 1 "${"S".repeat(80)}"`) && !quiet.includes("Note:"), String(quiet.length));
    const kept = (await build({ ...crowded, notes: "Call on landing." }, ON, "nonce-description-long-03")).params.get("payment_intent_data[description]");
    assert.equal(kept, `${quiet.split(" Pickup ")[0]} Pickup "${"D".repeat(40)}". Stop 1 "${"S".repeat(40)}". Stop 2 "${"T".repeat(40)}". Drop-off "${"E".repeat(40)}". Note: Call on landing.`);
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("builder: expires_at is the creation time plus 1860 seconds", async () => {
  const now = new Date("2026-10-05T09:15:42.900Z");
  const { params } = await build(DROPOFF, ON, "nonce-expiry-000000000", now);
  assert.equal(Number(params.get("expires_at")), Math.floor(now.getTime() / 1000) + 1860);
});

await test("builder: a checkout that can still be paid inside the last hour before pickup carries short_notice in the session and payment metadata only, never in the description or any text a receipt can show", async () => {
  const pickup = Date.parse("2026-10-14T11:30:00.000Z");
  for (const [minutes, flag] of [[61, "1"], [90, "1"], [91, null], [24 * 60, null]]) {
    const { params } = await build(DROPOFF, ON, "nonce-short-notice-0000", new Date(pickup - minutes * 60000));
    assert.equal(params.get("metadata[pickup_at]"), "2026-10-14T11:30:00.000Z");
    assert.deepEqual([params.get("metadata[short_notice]"), params.get("payment_intent_data[metadata][short_notice]")], [flag, flag], `${minutes} minutes before pickup`);
    const intent = params.get("payment_intent_data[description]");
    assert.ok(intent.startsWith("New booking "), `${minutes} minutes before pickup: ${intent}`);
    for (const [key, value] of params) if (!key.includes("metadata")) assert.ok(!/short.?notice/i.test(value), `${minutes} minutes before pickup: ${key} = ${value}`);
  }
});

await test("builder: short_notice is set only when paying at the end of the Checkout lifetime would leave less than PAID_NOTICE_MINUTES, 1 hour, before pickup", async () => {
  assert.deepEqual([MIN_NOTICE_MINUTES, PAID_NOTICE_MINUTES], [90, 60]);
  const pickup = Date.parse("2026-10-14T11:30:00.000Z");
  const flags = [];
  for (let ahead = 85 * 60000; ahead <= 100 * 60000; ahead += 7300) {
    const { params } = await build(DROPOFF, ON, "nonce-short-notice-0001", new Date(pickup - ahead));
    const left = pickup - Number(params.get("expires_at")) * 1000;
    assert.equal(params.get("metadata[short_notice]"), left < PAID_NOTICE_MINUTES * 60000 ? "1" : null, `${ahead / 60000} minutes before pickup leaves ${left / 60000} minutes after the last moment to pay`);
    flags.push(params.get("metadata[short_notice]"));
  }
  assert.ok(flags.includes("1") && flags.includes(null));
  for (const [minutes, flag] of [[90, "1"], [90.5, "1"], [91, null], [95, null], [105, null]]) {
    const { params } = await build(DROPOFF, ON, "nonce-short-notice-0002", new Date(pickup - minutes * 60000));
    assert.equal(params.get("metadata[short_notice]"), flag, `${minutes} minutes before pickup`);
  }
  for (const [ms, flag] of [[1, null], [500, null], [999, null], [1000, "1"]]) {
    const { params } = await build(DROPOFF, ON, "nonce-short-notice-0003", new Date(pickup - 91 * 60000 + ms));
    assert.equal(pickup - Number(params.get("expires_at")) * 1000, ms < 1000 ? PAID_NOTICE_MINUTES * 60000 : PAID_NOTICE_MINUTES * 60000 - 1000);
    assert.equal(params.get("metadata[short_notice]"), flag, `91 minutes less ${ms} ms before pickup`);
  }
});

const stripeItems = (params) => {
  const items = [];
  for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) items.push({ label: params.get(`line_items[${i}][price_data][product_data][name]`), cents: Number(params.get(`line_items[${i}][price_data][unit_amount]`)) });
  return items;
};

await test("builder: Stripe Checkout gets the lines the site shows, one Taxes and fees line for NYC sales tax plus the Black Car Fund and Tolls, with no tax percentage, the same total and the itemized tax and Black Car Fund kept in the metadata", async () => {
  setEnv();
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND, CUSTOM, { ...PICKUP, passengers: "3", infant_seats: "2" }]) {
    const { params, price } = await build(fields, ON, "nonce-itemized-000000001");
    const items = stripeItems(params);
    assert.deepEqual(items, shownLines(price.lines), JSON.stringify(fields));
    assert.deepEqual(items[1], { label: FEES, cents: price.tax + price.bcf });
    assert.equal(items.some((item) => item.label === TOLLS_SHOWN), fields.trip_type === "one");
    assert.ok(!items.some((item) => [TAX, BCF, TOLLS].includes(item.label)));
    assert.deepEqual(items.filter((item) => /sales tax|Black Car Fund|\d\s*%/i.test(item.label) && !item.label.startsWith("Gratuity")), []);
    assert.equal(stripeTotal(params.toString()), price.total);
    assert.equal(Number(params.get("metadata[total_cents]")), price.total);
    assert.deepEqual([params.get("metadata[tax_cents]"), params.get("metadata[bcf_cents]")], [String(price.tax), String(price.bcf)]);
  }
});

await test("builder: for an airport transfer, a trip by distance and time, an hourly booking, a trip with a stop and a round trip with child seats and a gratuity, the Stripe line items are the labels and amounts of shownLines, the site's price box, to the cent", async () => {
  setEnv({ GOOGLE_MOCK: "true" });
  const STOP = { ...DROPOFF, from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", to_text: "55 Church St, New York, NY 10007", to_id: "", time: "09:00", tip: "20" };
  const CASES = [
    [PICKUP, [["Fare", 15500], [FEES, 1725], [TOLLS_SHOWN, 1275], ["Meet and greet", 2500], ["Gratuity for your chauffeur (15%)", 2325]]],
    [{ ...DROPOFF, to_text: "Greenwich, CT 06830", to_id: "", class: "sprinter" }, [["Fare", 43800], [FEES, 986]]],
    [{ ...HOURLY, infant_seats: "1" }, [["Fare, 4 hours", 42000], [FEES, 3728 + 945], ["Child seats (1 x $15.00)", 1500]]],
    [STOP, [["Fare", 13701], [FEES, 1216 + 308], [TOLLS_SHOWN, 1275], ["Extra stop", 2000], ["Gratuity for your chauffeur (20%)", 2740]]],
    [{ ...STOP, class: "sprinter" }, [["Fare", 39348], [FEES, 3492 + 885], [TOLLS_SHOWN, 1275], ["Extra stop", 2000], ["Gratuity for your chauffeur (20%)", 7870]]],
    [{ ...STOP, stop2_text: "40 Wall St, New York, NY 10005", class: "sedan", tip: "" }, [["Fare", 11901], [FEES, 1056 + 268], [TOLLS_SHOWN, 1275], ["Extra stops (2 x $20.00)", 4000]]],
    [{ ...ROUND, toddler_seats: "1", booster_seats: "1" }, [["Fare", 53498], [FEES, 4748 + 1204], [TOLLS_SHOWN, 2550], ["Child seats (2 x $15.00)", 3000], ["Gratuity for your chauffeur (10%)", 5350]]],
  ];
  for (const [fields, want] of CASES) {
    const { params, price } = await build(fields, ON, "nonce-shown-lines-0000001");
    const items = stripeItems(params);
    assert.deepEqual(items.map(({ label, cents }) => [label, cents]), want, JSON.stringify(fields));
    assert.deepEqual(items, shownLines(price.lines), JSON.stringify(fields));
    assert.equal(items.reduce((sum, item) => sum + item.cents, 0), price.total, JSON.stringify(fields));
    assert.equal(stripeTotal(params.toString()), price.total, JSON.stringify(fields));
  }
  setEnv();
});

await test("builder: sales tax by where the trip starts and ends, Manhattan to JFK, Manhattan to Newark and back, Newark to Manhattan, a Nassau, a Westchester and a Yonkers pickup, New Jersey to JFK, JFK to Connecticut, a New Jersey stop and an hourly booking send Stripe the shown lines, the metadata and a receipt that rebuild the charged total to the cent", async () => {
  setEnv({ GOOGLE_MOCK: "true" });
  const EWR = { to_text: "Newark Liberty (EWR)", to_id: "ewr" };
  const BACK = { return: "1", return_date: "2026-10-18", return_time: "18:00" };
  const CASES = [
    ["Manhattan to JFK", DROPOFF, 1376, 18500],
    ["Manhattan to Newark", { ...DROPOFF, ...EWR }, 0, 18500],
    ["Manhattan to Newark and back", { ...DROPOFF, ...EWR, ...BACK }, 0, 37000],
    ["Newark to Manhattan", { ...DROPOFF, from_text: "Newark Liberty (EWR)", from_id: "ewr", to_text: MANHATTAN, to_id: "", meet: "1", tip: "20" }, 0, 18500 + 2500 + 3369],
    ["Nassau to JFK", { ...DROPOFF, from_text: "1 Old Country Rd, Mineola, NY 11501" }, 1337, 17186],
    ["Westchester to JFK", { ...DROPOFF, from_text: "2 Popham Rd, Scarsdale, NY 10583" }, 1298, 17147],
    ["Yonkers to JFK", { ...DROPOFF, from_text: "40 Warburton Ave, Yonkers, NY 10705" }, 1376, 17225],
    ["New Jersey to JFK", { ...DROPOFF, from_text: "12 Washington St, Hoboken, NJ 07030" }, 0, 15849],
    ["JFK to Connecticut", { ...PICKUP, to_text: "10 Elm St, Greenwich, CT 06830", tip: "" }, 0, 15849 + 2500],
    ["a New Jersey stop", { ...DROPOFF, stop1_text: "12 Washington St, Hoboken, NJ 07030" }, 0, 20500],
    ["hourly", HOURLY, 3728, 46673],
  ];
  for (const [name, fields, tax, total] of CASES) {
    const { params, price, trip, ref } = await build({ ...ME, rider: "me", reach: "phone", ...fields }, ON, "nonce-sales-tax-0000001");
    const items = stripeItems(params);
    assert.deepEqual([price.tax, price.total], [tax, total], name);
    assert.deepEqual(items, shownLines(price.lines), name);
    assert.equal(items.reduce((sum, item) => sum + item.cents, 0), total, name);
    assert.equal(stripeTotal(params.toString()), total, name);
    assert.deepEqual([params.get("metadata[tax_cents]"), params.get("metadata[total_cents]"), params.get("payment_intent_data[metadata][tax_cents]")], [String(tax), String(total), String(tax)], name);
    assert.ok([...params.keys()].filter((key) => key.startsWith("metadata[")).length <= 48, name);
    const rebuilt = receipt(metadataFor(trip, price, ref), ON);
    assert.deepEqual(shownLines(rebuilt.lines), items, name);
    assert.equal(rebuilt.lines.reduce((sum, item) => sum + item.cents, 0), total, name);
    assert.deepEqual(rebuilt.notes, price.notes, name);
  }
  setEnv();
});

await test("builder: no custom fields are sent, the email prefills Stripe, and Stripe asks only for a missing name or phone", async () => {
  for (const fields of [PICKUP, DROPOFF, HOURLY, ROUND, CUSTOM]) {
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
const sameSlot = (a, b) => a.date === b.date && a.time === b.time;

async function slotted(send) {
  const before = firstSlot(Date.now());
  const body = await send();
  const after = firstSlot(Date.now());
  assert.deepEqual(Object.keys(body.earliest || {}), ["date", "time"], JSON.stringify(body));
  assert.ok(sameSlot(body.earliest, before) || sameSlot(body.earliest, after), `earliest ${JSON.stringify(body.earliest)}, firstSlot ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
  return body;
}

await test("handler: the Stripe call has the URL, method, form type, version, key, a 10 second timeout and no Idempotency-Key", async () => {
  setEnv(LIVE);
  const body = await readJson(await post({ ...STRIPE_JFK, nonce: "nonce-handler-call-0001" }), 200);
  assert.match(body.ref, /^[1-9]\d{7}$/);
  assert.ok(REF.test(body.ref), body.ref);
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
  assert.deepEqual([4, 5].map((i) => formOf(calls[0]).get(`line_items[${i}][price_data][product_data][name]`)), ["Gratuity for your chauffeur (15%)", null]);
  assert.equal(formOf(calls[0]).get("line_items[4][price_data][unit_amount]"), "2325");
  assert.equal(formOf(calls[1]).get("line_items[4][price_data][product_data][name]"), "Gratuity for your chauffeur (20%)");
  assert.equal(formOf(calls[1]).get("line_items[4][price_data][unit_amount]"), "3100");
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
  assertRedirect(await formPost({ ...trip(HOURLY), class: "sprinter" }), CHECKOUT_URL);
  assertRedirect(await formPost({ ...trip(HOURLY), class: "sprinter", hours: "3" }), "/book#e-sprinter-hours");
  assertRedirect(await formPost({ ...STRIPE_JFK, to_text: "LaGuardia (LGA)", to_id: "lga", class: "sprinter", sprinter: "sprinter-white-limo" }), "/book#q-sprinter-price");
  assertRedirect(await formPost({ ...STRIPE_JFK, class: "first", passengers: "4" }), "/book#q-seats");
  assertRedirect(await formPost({ ...STRIPE_JFK, date: inDays(400) }), "/book#q-far-ahead");
  assertRedirect(await formPost({ ...STRIPE_JFK, from_text: "" }), "/book#e-from");
  assertRedirect(await formPost({ ...STRIPE_JFK, to_text: "" }), "/book#e-to");
  assertRedirect(await formPost({ ...STRIPE_JFK, date: inDays(-2) }), "/book#e-date-past");
  assertRedirect(await formPost({ ...STRIPE_JFK, tip: "50" }), "/book#e-tip");
  assertRedirect(await formPost({ ...STRIPE_JFK, return: "1", return_date: inDays(1), return_time: "10:00" }), "/book#e-return-date");
  assert.equal(calls.length, 2);
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

await test("handler: options answers the 13.1.2 shape with all six classes priced in CLASSES order and never calls fetch", async () => {
  setEnv(LIVE);
  const fields = { ...trip(PICKUP), from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "", tip: "", flight: "", action: "options", nonce: "nonce-options-shape-0001" };
  const ref = reqRef(fields);
  const body = await slotted(async () => readJson(await post(fields), 200));
  assert.deepEqual(body, {
    kind: "options",
    ref,
    service: "airport",
    legs: 1,
    classes: [
      { class: "suv", name: "Business SUV", seats: 5, total_cents: 18500, reason: "" },
      { class: "premium", name: "Business Premium SUV", seats: 5, total_cents: 22000, reason: "" },
      { class: "first", name: "First Class", seats: 3, total_cents: 31000, reason: "" },
      { class: "sedan", name: "Executive Sedan", seats: 3, total_cents: 17000, reason: "" },
      { class: "electric", name: "Electric Class", seats: 3, total_cents: 18000, reason: "" },
      { class: "sprinter", name: "Luxury Sprinter", seats: 14, total_cents: 45000, reason: "" },
    ],
    vehicles: [
      { vehicle: "sprinter-executive", label: "Executive Sprinter", seats: 14, total_cents: 45000 },
      { vehicle: "sprinter-luxury-jet", label: "Luxury Jet Sprinter", seats: 8, total_cents: 57500 },
      { vehicle: "sprinter-presidential", label: "Presidential Sprinter", seats: 12, total_cents: 65000 },
      { vehicle: "sprinter-limo", label: "Limo Sprinter", seats: 14, total_cents: 70000 },
      { vehicle: "sprinter-white-limo", label: "White Luxury Limo Sprinter", seats: 10, total_cents: 75000 },
    ],
    tips: [0, 10, 15, 20, 25],
    tip_custom: { min_cents: 100, max_cents: 50000 },
    meet: true,
    meet_cents: 2500,
    seat_cents: 1500,
    small_dog_cents: 2000,
    large_dog_cents: 4500,
    stop_cents: 2000,
    selected: { class: "suv", vehicle: "", tip: 0, tip_amount: 0, meet: false },
    price: {
      lines: [
        { label: "Fare", cents: 15500 },
        { label: FEES, cents: 1725 },
        { label: TOLLS_SHOWN, cents: 1275 },
      ],
      total_cents: 18500,
      currency: "usd",
      notes: AIRPORT_NOTES,
    },
    reason: "",
    pay: true,
    hold: "",
    earliest: body.earliest,
    ...contactLinks(await resolved(fields), ref, 18500),
  });
  assert.match(ref, /^[1-9]\d{7}$/);
  assert.ok(decodeURIComponent(body.whatsapp).includes(`Reference: ${ref}`));
  assert.ok(decodeURIComponent(body.whatsapp).endsWith("Total shown: $185.00"));
  assert.equal(calls.length, 0);
});

await test("handler: options and quote price the selected class, tip and meet and greet, quote refuses an unknown class", async () => {
  setEnv(LIVE);
  const fields = { ...PICKUP_SOON, action: "quote" };
  const body = await readJson(await post(fields), 200);
  assert.equal(body.kind, "options");
  assert.deepEqual(body.selected, { class: "suv", vehicle: "", tip: 15, tip_amount: 0, meet: true });
  assert.deepEqual(body.price.lines.slice(3), [{ label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur (15%)", cents: 2325 }]);
  assert.equal(body.price.total_cents, 23325);
  assert.deepEqual(body.classes.map((item) => item.total_cents), [23325, 27298, 37512, 21623, 22758, 53402]);
  assert.equal(body.classes[0].total_cents, body.price.total_cents, "the selected row shows the total of the panel and the bar");
  assert.deepEqual((await readJson(await post({ ...fields, meet: "", tip: "" }), 200)).classes.map((item) => item.total_cents), [18500, 22000, 31000, 17000, 18000, 45000]);
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

await test("handler: a gratuity the rider types adds the same fixed amount to every class, and options and quote answers carry tip_custom and selected.tip_amount", async () => {
  setEnv(LIVE);
  const fields = { ...PICKUP_SOON, tip: "custom", tip_amount: "40", action: "quote" };
  const body = await slotted(async () => readJson(await post(fields), 200));
  assert.equal(body.kind, "options");
  assert.deepEqual([body.tips, body.tip_custom], [[0, 10, 15, 20, 25], { min_cents: 100, max_cents: 50000 }]);
  assert.deepEqual(body.selected, { class: "suv", vehicle: "", tip: "custom", tip_amount: 40, meet: true });
  assert.deepEqual(body.price.lines.slice(3), [{ label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur", cents: 4000 }]);
  assert.equal(body.price.total_cents, 25000);
  assert.deepEqual(body.classes.map((item) => item.total_cents), [25000, 28500, 37500, 23500, 24500, 51500]);
  assert.ok(decodeURIComponent(body.whatsapp).endsWith("Meet and greet: Yes\nGratuity: $40.00\nTotal shown: $250.00"), decodeURIComponent(body.whatsapp));
  assert.deepEqual((await readJson(await post({ ...fields, tip_amount: "040", action: "options" }), 200)).selected, body.selected);
  const hourly = await readJson(await post({ ...trip(HOURLY), class: "suv", vehicle: "suv-denali", hours: "3", tip: "custom", tip_amount: "40", action: "options" }), 200);
  assert.deepEqual(hourly.selected, { class: "suv", vehicle: "suv-denali", tip: "custom", tip_amount: 40, meet: false });
  assert.deepEqual(hourly.vehicles.map((item) => item.total_cents), [35670, 37338, 37338, null, null, null, null, null]);
  assert.deepEqual(hourly.classes.map((item) => item.total_cents), [37338, 39005, 62340, 32337, 34004, null]);
  const seats = await slotted(async () => readJson(await post({ ...fields, passengers: "6", action: "options" }), 200));
  assert.deepEqual([seats.price, seats.reason, seats.selected.tip, seats.selected.tip_amount, seats.classes.at(-1).total_cents], [null, "seats", "custom", 40, 51500]);
  const quote = await slotted(async () => readJson(await post({ ...fields, from_text: "350 5th Ave", action: "options" }), 200));
  assert.deepEqual([quote.kind, quote.reason, quote.tip_custom, quote.tips], ["quote", "unplaced", { min_cents: 100, max_cents: 50000 }, TIP_PERCENTS]);
  assert.equal(calls.length, 0);
});

await test("handler: a typed gratuity that is not 1 to 500 whole dollars is the invalid code tip_amount, a pay post with 40 sends the 4000 line to Stripe", async () => {
  setEnv(LIVE);
  assert.deepEqual(ERRORS.tip_amount, { field: "tip_amount", text: "Type the gratuity in whole dollars, or choose None." });
  for (const tip_amount of ["", "0", "501", "40.5", "40.00", "$40", "-1", "abc"]) {
    for (const action of ["options", "quote", "pay"]) assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, tip: "custom", tip_amount, action }), 422), { kind: "invalid", code: "tip_amount", field: "tip_amount", text: ERRORS.tip_amount.text }, `${action} ${tip_amount}`);
    assertRedirect(await formPost({ ...STRIPE_JFK, tip: "custom", tip_amount }), "/book#e-tip_amount");
  }
  assert.equal((await readJson(await post({ ...STRIPE_JFK, tip: "Other", tip_amount: "40" }), 422)).code, "tip");
  assert.equal(calls.length, 0);
  const pay = await readJson(await post({ ...STRIPE_JFK, tip: "custom", tip_amount: "40", nonce: "nonce-custom-pay-000001" }), 200);
  assert.equal(pay.kind, "pay");
  const sent = formOf(calls.at(-1));
  assert.deepEqual(["name", "description"].map((key) => sent.get(`line_items[3][price_data][product_data][${key}]`)), ["Gratuity for your chauffeur", "Paid in full to your chauffeur."]);
  assert.deepEqual([sent.get("line_items[3][price_data][unit_amount]"), sent.get("line_items[4][quantity]"), stripeTotal(calls.at(-1).init.body)], ["4000", null, 22500]);
  assert.deepEqual(["tip_percent", "tip_cents", "total_cents"].map((key) => [sent.get(`metadata[${key}]`), sent.get(`payment_intent_data[metadata][${key}]`)]), [["0", "0"], ["4000", "4000"], ["22500", "22500"]]);
  assert.deepEqual([...sent.keys()].filter((key) => key.includes("tip_amount")), []);
  assertRedirect(await formPost({ ...STRIPE_JFK, tip: "custom", tip_amount: "500" }), CHECKOUT_URL);
  assert.equal(formOf(calls.at(-1)).get("metadata[total_cents]"), "68500");
});

await test("handler: a class reason answers kind options with price null and that reason, the other cards keep their prices", async () => {
  setEnv(LIVE);
  const four = await readJson(await post({ ...STRIPE_JFK, class: "first", passengers: "4", action: "options" }), 200);
  assert.deepEqual([four.kind, four.price, four.reason, four.pay], ["options", null, "seats", false]);
  assert.deepEqual(four.classes.map((item) => [item.class, item.total_cents, item.reason]), [["suv", 18500, ""], ["premium", 22000, ""], ["first", null, "seats"], ["sedan", null, "seats"], ["electric", null, "seats"], ["sprinter", 45000, ""]]);
  assert.ok(!decodeURIComponent(four.whatsapp).includes("Total shown"));
  const six = await readJson(await post({ ...STRIPE_JFK, passengers: "6", action: "options" }), 200);
  assert.deepEqual(six.classes.map((item) => item.total_cents), [null, null, null, null, null, 45000]);
  assert.equal(six.reason, "seats");
  const hourly = await readJson(await post({ ...trip(HOURLY), class: "sprinter", sprinter: "sprinter-white-limo", passengers: "11", action: "options" }), 200);
  assert.deepEqual([hourly.kind, hourly.price, hourly.reason, hourly.service, hourly.legs], ["options", null, "seats", "hourly", 0]);
  assert.deepEqual(hourly.classes.map((item) => [item.total_cents, item.reason]), [[null, "seats"], [null, "seats"], [null, "seats"], [null, "seats"], [null, "seats"], [null, "seats"]]);
  assert.deepEqual(hourly.vehicles, [
    { vehicle: "suv-suburban", label: "Chevrolet Suburban or similar", seats: 5, total_cents: null },
    { vehicle: "suv-denali", label: "GMC Denali", seats: 5, total_cents: null },
    { vehicle: "suv-navigator", label: "Lincoln Navigator", seats: 5, total_cents: null },
    { vehicle: "sprinter-executive", label: "Executive Sprinter", seats: 14, total_cents: 77788 },
    { vehicle: "sprinter-luxury-jet", label: "Luxury Jet Sprinter", seats: 8, total_cents: null },
    { vehicle: "sprinter-presidential", label: "Presidential Sprinter", seats: 12, total_cents: 108903 },
    { vehicle: "sprinter-limo", label: "Limo Sprinter", seats: 14, total_cents: 117793 },
    { vehicle: "sprinter-white-limo", label: "White Luxury Limo Sprinter", seats: 10, total_cents: null },
  ]);
  const three = await readJson(await post({ ...trip(HOURLY), hours: "3", action: "options" }), 200);
  assert.deepEqual(three.classes.map((item) => [item.total_cents, item.reason]), [[31670, ""], [35005, ""], [58340, ""], [28337, ""], [30004, ""], [null, "min-hours"]]);
  assert.deepEqual([three.reason, three.price.total_cents, three.pay], ["", 35005, true]);
  assert.deepEqual(three.vehicles.map((item) => item.total_cents), [31670, 33338, 33338, null, null, null, null, null]);
  const crowd = await readJson(await post({ ...trip(HOURLY), passengers: "6", action: "options" }), 200);
  assert.deepEqual(crowd.vehicles.map((item) => item.total_cents), [null, null, null, 77788, 95568, 108903, 117793, 122238]);
  assert.deepEqual(crowd.classes.map((item) => [item.class, item.reason, item.total_cents]), [["suv", "seats", null], ["premium", "seats", null], ["first", "seats", null], ["sedan", "seats", null], ["electric", "seats", null], ["sprinter", "", 77788]]);
  assert.equal(calls.length, 0);
});

await test("handler: hourly options show the Business SUV vehicle chosen, its price in the suv card, and meet and greet only from JFK and LaGuardia", async () => {
  setEnv(LIVE);
  const denali = await readJson(await post({ ...trip(HOURLY), class: "suv", vehicle: "suv-denali", hours: "3", action: "options" }), 200);
  assert.deepEqual(denali.selected, { class: "suv", vehicle: "suv-denali", tip: 0, tip_amount: 0, meet: false });
  assert.equal(denali.classes[0].total_cents, 33338);
  assert.equal(denali.price.total_cents, 33338);
  assert.deepEqual(denali.price.notes, [HOURLY_NOTE]);
  assert.equal(denali.meet, false);
  assert.equal(denali.meet_cents, null);
  const first = await readJson(await post({ ...trip(HOURLY), class: "first", vehicle: "suv-denali", hours: "3", action: "options" }), 200);
  assert.deepEqual([first.selected.vehicle, first.classes[0].total_cents, first.price.total_cents], ["first", 33338, 58340]);
  const premium = await readJson(await post({ ...trip(HOURLY), vehicle: "suv-denali", hours: "3", action: "options" }), 200);
  assert.deepEqual(premium.selected, { class: "premium", vehicle: "premium", tip: 0, tip_amount: 0, meet: false });
  assert.deepEqual([premium.classes[0].total_cents, premium.classes[1].total_cents, premium.price.total_cents], [33338, 35005, 35005]);
  const jfk = await readJson(await post({ ...trip(HOURLY), from_text: "John F. Kennedy (JFK)", from_id: "jfk", meet: "1", action: "options" }), 200);
  assert.deepEqual([jfk.meet, jfk.selected.meet, jfk.price.lines.at(-1)], [true, true, { label: "Meet and greet", cents: 2500 }]);
});

await test("handler: a hold keeps the prices in options with pay false, and its WhatsApp text has the total shown", async () => {
  for (const [env, fields, hold] of [[{}, STRIPE_JFK, "paused"], [LIVE, { ...STRIPE_JFK, ...nyAt(Date.now() + 30 * 60000) }, "short-notice"], [LIVE, { ...STRIPE_JFK, date: inDays(370) }, "far-ahead"], [{ ...LIVE, PAY_BLACKOUT_DATES: SOON }, STRIPE_JFK, "paused"]]) {
    setEnv(env);
    const body = await slotted(async () => readJson(await post({ ...fields, action: "options" }), 200));
    assert.deepEqual([body.kind, body.hold, body.pay, body.reason, body.price.total_cents], ["options", hold, false, "", 18500], hold);
    assert.ok(decodeURIComponent(body.whatsapp).endsWith("Total shown: $185.00"));
    const held = await slotted(async () => readJson(await post(fields), 200));
    assert.deepEqual([held.kind, held.reason, held.tip_custom], ["quote", hold, { min_cents: 100, max_cents: 50000 }], hold);
  }
  assert.equal(calls.length, 0);
});

await test("handler: a pay post at the earliest slot of an answer passes the hold and reaches Stripe without short_notice, since paying at the end of the Checkout lifetime still leaves at least an hour", async () => {
  setEnv(LIVE);
  const soon = { ...STRIPE_JFK, ...nyAt(Date.now() + 30 * 60000) };
  const held = await slotted(async () => readJson(await post({ ...soon, action: "options" }), 200));
  assert.deepEqual([held.hold, held.pay], ["short-notice", false]);
  const at = await slotted(async () => readJson(await post({ ...STRIPE_JFK, ...held.earliest, action: "options" }), 200));
  assert.deepEqual([at.hold, at.pay, at.price.total_cents], ["", true, 18500]);
  assert.equal(calls.length, 0);
  assert.equal((await readJson(await post({ ...STRIPE_JFK, ...held.earliest, nonce: "nonce-earliest-pay-0001" }), 200)).kind, "pay");
  const sent = formOf(calls.at(-1));
  assert.deepEqual([sent.get("metadata[date]"), sent.get("metadata[time]")], [held.earliest.date, held.earliest.time]);
  const pickup = Date.parse(sent.get("metadata[pickup_at]"));
  assert.ok(pickup - Date.now() > (MIN_NOTICE_MINUTES + AUTO_LEAD_MINUTES - 1) * 60000, String(pickup - Date.now()));
  assert.ok(pickup - Number(sent.get("expires_at")) * 1000 >= PAID_NOTICE_MINUTES * 60000, sent.get("expires_at"));
  assert.equal(sent.get("metadata[short_notice]"), null);
});

await test("handler: the 90 minute notice holds pickups 30, 61 and 89 minutes away and lets one 91 minutes or 2 hours away pay online", async () => {
  setEnv(LIVE);
  const options = async (minutes) => readJson(await post({ ...STRIPE_JFK, ...nyAt(Date.now() + minutes * 60000), action: "options" }), 200);
  for (const minutes of [30, 61, 89]) assert.deepEqual(await options(minutes).then((b) => [b.hold, b.pay, b.price.total_cents]), ["short-notice", false, 18500], `${minutes} minutes`);
  for (const minutes of [91.5, 120]) assert.deepEqual(await options(minutes).then((b) => [b.hold, b.pay, b.price.total_cents]), ["", true, 18500], `${minutes} minutes`);
  const held = await readJson(await post({ ...STRIPE_JFK, ...nyAt(Date.now() + 89 * 60000), nonce: "nonce-notice-89-000001" }), 200);
  assert.deepEqual([held.kind, held.reason, held.text], ["quote", "short-notice", "For a pickup within the next 90 minutes, email info@nycluxride.com or message us on WhatsApp."]);
  assert.equal(calls.length, 0);
});

await test("handler: the price box, the confirmation page and Stripe Checkout show one Taxes and fees line, the sales tax plus the Black Car Fund, and Tolls, with the same total to the cent", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  for (const fields of [PICKUP_SOON, STRIPE_JFK, { ...PICKUP_SOON, passengers: "3", toddler_seats: "1", tip: "custom", tip_amount: "40" }, { ...trip(HOURLY), meet: "", tip: "20" }]) {
    const resolvedTrip = await resolved(fields);
    const priced = priceTrip(resolvedTrip);
    const fees = priced.tax + priced.bcf;
    const airport = fields.trip_type === "one";
    const want = priced.lines.filter((item) => item.label !== BCF).map((item) => (item.label === TAX ? { label: FEES, cents: fees } : item.label === TOLLS ? { label: TOLLS_SHOWN, cents: item.cents } : item));
    const options = await slotted(async () => readJson(await post({ ...fields, action: "options", nonce: "nonce-shown-lines-000001" }), 200));
    assert.deepEqual(options.price.lines, want, JSON.stringify(fields));
    assert.deepEqual(options.price.lines.filter((item) => /tax|fund|fee|toll/i.test(item.label)).map((item) => item.label), airport ? [FEES, TOLLS_SHOWN] : [FEES]);
    assert.equal(options.price.lines.reduce((sum, item) => sum + item.cents, 0), options.price.total_cents);
    assert.equal(options.price.total_cents, priced.total);
    const paid = await readJson(await post({ ...fields, nonce: "nonce-shown-lines-000002" }), 200);
    const session = await readJson(await get(`cs_mock_${paid.ref}`), 200);
    assert.deepEqual(session.lines, want);
    assert.equal(session.lines.reduce((sum, item) => sum + item.cents, 0), session.total_cents);
    assert.equal(session.total_cents, priced.total);
    assert.deepEqual(stripeItems(sessionParams(resolvedTrip, priced, paid.ref, ON, Date.now(), SITE)), want, JSON.stringify(fields));
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
});

await test("handler: a trip reason answers the quote shape: classes all null with the reason, the tips and the composed links", async () => {
  setEnv(LIVE);
  const fields = { ...STRIPE_JFK, from_text: "350 5th Ave", action: "options", nonce: "nonce-quote-shape-00001" };
  const ref = reqRef(fields);
  const body = await slotted(async () => readJson(await post(fields), 200));
  assert.deepEqual(body, {
    kind: "quote",
    ref,
    reason: "unplaced",
    group: "price",
    heading: HEADINGS.price,
    text: REASONS.unplaced.text,
    hourly: false,
    field: "from_text",
    classes: ["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls, i) => ({ class: cls, name: ["Business SUV", "Business Premium SUV", "First Class", "Executive Sedan", "Electric Class", "Luxury Sprinter"][i], seats: [5, 5, 3, 3, 3, 14][i], total_cents: null, reason: "unplaced" })),
    tips: TIP_PERCENTS,
    tip_custom: { min_cents: 100, max_cents: 50000 },
    seat_cents: 1500,
    small_dog_cents: 2000,
    large_dog_cents: 4500,
    stop_cents: 2000,
    earliest: body.earliest,
    ...contactLinks(await resolved(fields), ref),
  });
  assert.match(ref, /^[1-9]\d{7}$/);
  const message = decodeURIComponent(body.whatsapp.split("?text=")[1]);
  assert.equal(message, composeMessage(await resolved(fields), ref));
  assert.ok(message.includes(ref) && message.includes("Pickup: 350 5th Ave") && !message.includes("Total shown"));
  assert.ok(body.mailto.startsWith(`mailto:info@nycluxride.com?subject=Booking%20request%20${ref}&body=`));
  assert.ok(!("switch" in body));
  const outside = await readJson(await post({ ...fields, from_text: "Hoboken, NJ 07030" }), 200);
  assert.deepEqual([outside.kind, outside.reason, outside.group, outside.field, outside.text], ["quote", "outside-city", "price", "", REASONS["outside-city"].text]);
  process.env.GOOGLE_MOCK = "true";
  assert.equal((await readJson(await post(fields), 200)).text, REASONS.unplaced.google);
  const routed = await readJson(await post({ ...fields, from_text: "Hoboken, NJ 07030" }), 200);
  assert.deepEqual([routed.kind, routed.service, routed.reason, routed.text, routed.price], ["options", "distance", "", undefined, { lines: [{ label: "Fare", cents: 15500 }, { label: FEES, cents: 349 }], total_cents: 15849, currency: "usd", notes: [OUTSIDE_NOTE] }], "Hoboken, New Jersey, to JFK carries no New York sales tax");
  assert.match(routed.route, ROUTE);
  delete process.env.GOOGLE_MOCK;
  const dropoff = await readJson(await post({ ...fields, from_text: MANHATTAN, to_text: "somewhere quiet", to_id: "" }), 200);
  assert.deepEqual([dropoff.reason, dropoff.field], ["unplaced", "to_text"]);
  const county = { ...fields, from_text: "1 Tulip Ave, Floral Park, NY 11001" };
  const split = await readJson(await post(county), 200);
  assert.deepEqual([split.kind, split.reason, split.group, split.field, split.text], ["quote", "county", "price", "from_text", "We'll send you a price for trips from this address."], "a typed ZIP code in two counties without Google goes to dispatch, never back to Add the ZIP code");
  assert.ok(!split.text.includes("ZIP code"));
  process.env.GOOGLE_MOCK = "true";
  const pick = await readJson(await post(county), 200);
  assert.deepEqual([pick.reason, pick.field, pick.text], ["county", "from_text", "Pick the address from the list to see the price."], "with Google the rider picks the address from the list");
  delete process.env.GOOGLE_MOCK;
  const local = await readJson(await post({ ...fields, from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", to_id: "" }), 200);
  assert.deepEqual([local.reason, local.hourly, local.text], ["no-airport", true, REASONS["no-airport"].text]);
  const far = await readJson(await post({ ...fields, from_text: "Hoboken, NJ 07030", to_text: "350 5th Ave, New York, NY 10118", to_id: "" }), 200);
  assert.deepEqual([far.reason, far.hourly, far.text], ["no-airport", false, REASONS["no-airport"].short]);
  assert.equal(calls.length, 0);
});

await test("handler: an end that names only an area answers its request with its text, every class on that reason, no field and its redirect: a pickup area asks for the pickup street address on every trip type, a drop-off area on a trip with no airport end or to New Jersey asks for the street address, a round trip asks for the return pickup, the text offers the map only to a request sent with the map on the page, and Google off keeps the earlier requests", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const ride = trip({ trip_type: "one", from_text: "Manhattan", to_text: "Brooklyn", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const nj = trip({ trip_type: "one", from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: "07030, NJ", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const flat = trip({ trip_type: "one", from_text: "Manhattan", to_text: "John F. Kennedy (JFK)", to_id: "jfk", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const hourly = trip({ ...HOURLY, from_text: "Brooklyn", ...ME, reach: "phone" });
  const drop = trip({ trip_type: "one", from_text: MANHATTAN, to_text: "Brooklyn", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const back = { ...drop, return: "1", return_date: inDays(5), return_time: "18:00" };
  const cases = [[ride, "pickup-address"], [flat, "pickup-address"], [hourly, "pickup-address"], [nj, "street-address"], [drop, "street-address"], [back, "return-address"]];
  for (const [env, draw, variant] of [[{ ...LIVE, GOOGLE_MOCK: "true" }, "", "text"], [{ ...LIVE, GOOGLE_MOCK: "true", MAP_MOCK: "true" }, "", "text"], [{ ...LIVE, GOOGLE_MOCK: "true", MAP_MOCK: "true" }, "1", "map"], [{ ...LIVE, GOOGLE_MOCK: "true" }, "1", "map"]]) {
    setEnv(env);
    for (const [fields, reason] of cases) {
      assertRedirect(await formPost(fields), `/book#q-${reason}`);
      const text = reason === "street-address" ? REASONS[reason].google : REASONS[reason][variant];
      for (const action of ["options", "quote", "pay"]) {
        const body = await readJson(await post({ ...fields, action, ...(draw && { draw }) }), 200);
        assert.deepEqual([body.kind, body.reason, body.group, body.heading, body.text, body.field, "price" in body, "ride" in body, "route" in body], ["quote", reason, "price", HEADINGS.price, text, "", false, false, false], `${fields.from_text} to ${fields.to_text} ${action} ${env.MAP_MOCK ? "map on" : "map off"} ${draw ? "drawn" : "not drawn"}`);
        assert.ok(body.classes.every((c) => c.total_cents === null && c.reason === reason), action);
        assert.ok(!decodeURIComponent(body.whatsapp).includes("Total shown"), action);
      }
    }
  }
  assert.deepEqual([REASONS["pickup-address"].text, REASONS["pickup-address"].map], ["Add the pickup street address to see the price.", "Add the pickup street address, or choose the spot on the map, to see the price."]);
  const street = await readJson(await post({ ...ride, from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", action: "options" }), 200);
  assert.deepEqual([street.kind, street.service, street.reason, street.price.total_cents], ["options", "distance", "", 12224]);
  setEnv(LIVE);
  assertRedirect(await formPost(ride), "/book#q-no-airport");
  assertRedirect(await formPost(nj), "/book#q-outside-city");
  assertRedirect(await formPost(flat), "/book#q-pickup-address");
  assertRedirect(await formPost(hourly), "/book#q-pickup-address");
  assert.equal((await readJson(await post({ ...flat, action: "options" }), 200)).text, REASONS["pickup-address"].text);
  assert.equal(calls.length, 0);
});

await test("handler: a picked city, borough, neighborhood or ZIP code as the pickup asks for the pickup street address on a one way trip priced by distance, an airport trip at the flat rate, an airport trip priced by distance, a trip with a stop priced online and an hourly booking, and never reaches Stripe, while a map spot, a hotel and an airport pickup pay as before with the builder's body", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const picked = (label, zone, level) => ({ from_text: label, from_ticket: signTicket(`ChIJ${level}${zone}`, zone, label, Date.now(), level), from_id: "" });
  const PICKS = [picked("Hoboken, NJ, USA", "outside", 2), picked("New York, NY, USA", "manhattan", 1), picked("Brooklyn, NY, USA", "brooklyn", 1), picked("Upper East Side, New York, NY, USA", "manhattan", 2), picked("New York, NY 10001, USA", "manhattan", 1)];
  const TRIPS = [
    ["distance", { trip_type: "one", to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "suv" }],
    ["airport", { trip_type: "one", to_text: "John F. Kennedy (JFK)", to_id: "jfk", passengers: "2", class: "suv" }],
    ["hourly", { trip_type: "hour", hours: "3", passengers: "2", class: "suv", vehicle: "suv-suburban" }],
    ["stop", { trip_type: "one", stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "suv" }],
  ];
  for (const pick of PICKS) {
    for (const [name, base] of TRIPS) {
      const fields = trip({ ...base, ...pick, ...ME, reach: "phone" });
      const want = pick.from_text.startsWith("Hoboken") && name === "hourly" ? "outside-hourly" : "pickup-address";
      assertRedirect(await formPost(fields), `/book#q-${want}`);
      for (const action of ["options", "quote", "pay"]) {
        const body = await readJson(await post({ ...fields, action }), 200);
        assert.deepEqual([body.kind, body.reason, body.field, "price" in body, body.classes.every((c) => c.total_cents === null && c.reason === want)], ["quote", want, "", false, true], `${pick.from_text} ${name} ${action}`);
      }
    }
  }
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.stripe.com")).length, 0, "no Stripe call for a pickup that is no exact spot");
  const spot = "277 Bedford Ave, Brooklyn, NY 11211";
  const exact = [
    { from_text: spot, from_ticket: signTicket("mock-bedford", "brooklyn", spot, Date.now(), 0), from_id: "" },
    { from_text: "The New York EDITION, Madison Avenue, New York, NY", from_ticket: signTicket("mock-edition", "manhattan", "The New York EDITION, Madison Avenue, New York, NY", Date.now()), from_id: "" },
    { from_text: "John F. Kennedy (JFK)", from_id: "jfk", from_ticket: "", to_text: MANHATTAN, to_id: "" },
  ];
  for (const [n, end] of exact.entries()) {
    calls = [];
    const fields = trip({ ...DROPOFF, ...end, ...ME, nonce: `nonce-exact-pickup-00${n}` });
    const quote = await readJson(await post({ ...fields, action: "options" }), 200);
    assert.deepEqual([quote.kind, quote.reason, quote.pay], ["options", "", true], end.from_text);
    const body = await readJson(await post(fields), 200);
    assert.deepEqual([body.kind, body.url], ["pay", CHECKOUT_URL], end.from_text);
    const stripeCalls = calls.filter((c) => c.url === "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(stripeCalls.length, 1, end.from_text);
    assert.equal(stripeTotal(stripeCalls[0].init.body), quote.price.total_cents, end.from_text);
    const built = await build(fields, readSettings(LIVE), fields.nonce, new Date());
    assert.deepEqual([...formOf(stripeCalls[0]).keys()].sort(), [...built.params.keys()].sort(), end.from_text);
  }
});

await test("handler: an address typed in an airport ZIP code answers the airport-zip request with its text, every class on that reason and its redirect, with the field of that end for the JFK and LaGuardia ZIP codes and no field for Newark and Teterboro", async () => {
  setEnv(LIVE);
  const AIRPORT_ZIP = "This address is at or near an airport. Type the airport's name, like JFK or Newark Liberty (EWR), to see the price. Otherwise, we'll send you a price.";
  const cases = [
    [{ ...STRIPE_JFK, to_text: "TWA Hotel, One Idlewild Dr, Jamaica, NY 11430", to_id: "" }, "to_text"],
    [{ ...STRIPE_JFK, from_text: "Terminal B, East Elmhurst, NY 11371" }, "from_text"],
    [{ ...trip(HOURLY), from_text: "TWA Hotel, One Idlewild Dr, Jamaica, NY 11430" }, "from_text"],
    [{ ...STRIPE_JFK, to_text: "3 Brewster Rd, Newark, NJ 07114", to_id: "" }, ""],
    [{ ...STRIPE_JFK, to_text: "111 Industrial Ave, Teterboro, NJ 07608", to_id: "", return: "1", return_date: inDays(5), return_time: "18:00" }, ""],
  ];
  for (const [fields, field] of cases) {
    assertRedirect(await formPost(fields), "/book#q-airport-zip");
    for (const action of ["options", "pay"]) {
      const body = await readJson(await post({ ...fields, action }), 200);
      assert.deepEqual([body.kind, body.reason, body.group, body.heading, body.text, body.field, "price" in body], ["quote", "airport-zip", "price", HEADINGS.price, AIRPORT_ZIP, field, false], `${fields.from_text} to ${fields.to_text} ${action}`);
      assert.ok(body.classes.every((c) => c.total_cents === null && c.reason === "airport-zip"), action);
      assert.ok(!decodeURIComponent(body.whatsapp).includes("Total shown"), action);
    }
  }
  assert.equal(REASONS["airport-zip"].text, AIRPORT_ZIP);
  assert.equal(calls.length, 0);
});

await test("handler: a hold set by the return pickup names a pickup or return, for the clock change at the return time and a return more than a year away, on pay and options with JavaScript and on the redirect without it", async () => {
  setEnv(LIVE);
  const CLOCK = "A pickup or return at this hour can't be booked online because the clocks change. Choose another time, or email info@nycluxride.com or message us on WhatsApp.";
  const FAR = "For a pickup or return more than a year from now, email info@nycluxride.com or message us on WhatsApp.";
  const sunday = (year) => {
    const day = new Date(Date.UTC(year, 10, 1));
    day.setUTCDate(1 + ((7 - day.getUTCDay()) % 7));
    return day.toISOString().slice(0, 10);
  };
  const year = Number(inDays(0).slice(0, 4));
  const change = [sunday(year), sunday(year + 1)].find((day) => day > inDays(2));
  const before = new Date(Date.parse(`${change}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const round = { ...DROPOFF, ...ME, date: before, time: "22:00", return: "1", return_date: change, return_time: "01:30" };
  const far = { ...DROPOFF, ...ME, date: SOON, time: "10:00", return: "1", return_date: inDays(400), return_time: "10:00" };
  for (const [fields, hold, text] of [[round, "clock-change", CLOCK], [far, "far-ahead", FAR]]) {
    assertRedirect(await formPost(fields), `/book#q-${hold}`);
    const pay = await readJson(await post(fields), 200);
    assert.deepEqual([pay.kind, pay.reason, pay.group, pay.heading, pay.text], ["quote", hold, "phone", HEADINGS.phone, text], hold);
    const options = await readJson(await post({ ...fields, action: "options" }), 200);
    assert.deepEqual([options.kind, options.hold, options.pay], ["options", hold, false], hold);
    assert.equal(REASONS[hold].text, text);
  }
  assert.equal(calls.length, 0);
});

await test("handler: pay with a class reason or a hold answers the quote shape, with the computed classes and, for a hold, the total shown", async () => {
  setEnv(LIVE);
  const seats = await readJson(await post({ ...STRIPE_JFK, class: "sedan", passengers: "4" }), 200);
  assert.deepEqual([seats.kind, seats.reason, seats.group, seats.heading], ["quote", "seats", "phone", HEADINGS.phone]);
  assert.deepEqual(seats.classes.map((item) => item.total_cents), [18500, 22000, null, null, null, 45000]);
  setEnv();
  const paused = await readJson(await post(STRIPE_JFK), 200);
  assert.deepEqual([paused.kind, paused.reason, paused.text], ["quote", "paused", REASONS.paused.text]);
  assert.deepEqual(paused.classes.map((item) => item.total_cents), [18500, 22000, 31000, 17000, 18000, 45000]);
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
  await bad({ rider: "other", pname: "Ben Ortiz" }, "pphone");
  await bad({ rider: "other", pname: "Ben Ortiz", pphone: "  " }, "pphone");
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
  assertRedirect(await formPost({ ...bare, rider: "other", pname: "Ben Ortiz" }), "/book#e-pphone");
  assertRedirect(await formPost({ ...bare, rider: "other", pname: "Ben Ortiz", pphone: "+1 917 555 0142" }), CHECKOUT_URL);
  const someone = new URLSearchParams(calls.at(-1).init.body);
  assert.deepEqual(["rider", "passenger_name", "passenger_phone"].map((k) => [someone.get(`metadata[${k}]`), someone.get(`payment_intent_data[metadata][${k}]`)]), [["other", "other"], ["Ben Ortiz", "Ben Ortiz"], ["+1 917 555 0142", "+1 917 555 0142"]], "a form post for someone else carries the rider's name and mobile to Stripe");
  assertRedirect(await formPost({ ...bare, rider: "other", pname: "Ben Ortiz", pphone: "12" }), "/book#e-pphone");
  const meetFrom = { ...trip(PICKUP), name: "", email: "", phone: "", sign: "", rider: "me", pname: "", pphone: "" };
  assertRedirect(await formPost(meetFrom), "/book#e-name");
  assertRedirect(await formPost({ ...meetFrom, sign: "Ana Lopez" }), CHECKOUT_URL);
  assertRedirect(await formPost({ ...bare, reach: "fax" }), "/book#e-reach");
  assertRedirect(await formPost({ ...bare, rider: "both" }), "/book#e-rider");
});

await test("handler: mobile numbers reach Stripe with their country code, a form post without the codes reads US, and a bad number asks to check its country code", async () => {
  setEnv(LIVE);
  const sent = () => formOf(calls.at(-1));
  const phones = () => ["phone", "passenger_phone"].map((key) => [sent().get(`metadata[${key}]`), sent().get(`payment_intent_data[metadata][${key}]`)]);
  const someone = { ...STRIPE_JFK, rider: "other", pname: "Ben Ortiz" };
  assert.equal((await readJson(await post({ ...STRIPE_JFK, phone: "9294622366" }), 200)).kind, "pay");
  assert.deepEqual([sent().get("metadata[phone]"), sent().get("metadata[passenger_phone]"), sent().get("phone_number_collection[enabled]")], ["+1 929 462 2366", null, null]);
  assert.equal((await readJson(await post({ ...someone, phone: "(212) 555-0100", pphone: "07700 900123", pphone_cc: "GB" }), 200)).kind, "pay");
  assert.deepEqual(phones(), [["+1 212 555 0100", "+1 212 555 0100"], ["+44 7700 900123", "+44 7700 900123"]]);
  assert.equal((await readJson(await post({ ...someone, phone: "0044 7700 900123", phone_cc: "US", pphone: "+1 (917) 555-0142", pphone_cc: "GB" }), 200)).kind, "pay");
  assert.deepEqual(phones(), [["+44 7700 900123", "+44 7700 900123"], ["+1 917 555 0142", "+1 917 555 0142"]]);
  assert.equal((await readJson(await post({ ...STRIPE_JFK, phone: "06 12 34 56 78", phone_cc: "fr" }), 200)).kind, "pay");
  assert.equal(sent().get("metadata[phone]"), "+33 6 12 34 56 78");
  assertRedirect(await formPost({ ...trip(DROPOFF), phone: "212-555-0100", rider: "other", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" }), CHECKOUT_URL);
  assert.deepEqual(phones(), [["+1 212 555 0100", "+1 212 555 0100"], ["+44 20 7946 0958", "+44 20 7946 0958"]]);
  assertRedirect(await formPost({ ...trip(DROPOFF), phone_cc: "GB", phone: "07700 900123", rider: "other", pname: "Ben Ortiz", pphone_cc: "GB", pphone: "07700 900123" }), CHECKOUT_URL);
  assert.deepEqual(phones(), [["+44 7700 900123", "+44 7700 900123"], ["+44 7700 900123", "+44 7700 900123"]]);
  const paid = calls.length;
  for (const phone of ["07700 900123", "555-0100", "+888 1234 5678"]) assertRedirect(await formPost({ ...trip(DROPOFF), phone }), "/book#e-phone");
  assertRedirect(await formPost({ ...trip(DROPOFF), rider: "other", pname: "Ben Ortiz", pphone: "7700 900123", pphone_cc: "ZZ" }), "/book#e-pphone");
  assert.deepEqual([ERRORS.phone.text, ERRORS.pphone.text], ["Add your mobile number, and check its country code.", "Add the passenger's mobile number, and check its country code."]);
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, phone: "07700 900123" }), 422), { kind: "invalid", code: "phone", field: "phone", text: ERRORS.phone.text });
  assert.deepEqual(await readJson(await post({ ...someone, pphone: "212 155 0100" }), 422), { kind: "invalid", code: "pphone", field: "pphone", text: ERRORS.pphone.text });
  assert.equal(calls.length, paid);
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
  client_reference_id: "69042564",
  customer_details: { email: "pat@example.com", name: "Pat Example", phone: "+12125550100", address: { line1: "9 Secret Lane" } },
  metadata: {
    ref: "69042564",
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
    ref: "69042564",
    summary: "Wed, Oct 14, 2026, 7:30 AM. From JFK, Business SUV.",
    lines: [
      { label: "Fare", cents: 15500 },
      { label: FEES, cents: 1725 },
      { label: TOLLS_SHOWN, cents: 1275 },
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
  assert.deepEqual(noted, ["mail-off 69042564"]);
});

await test("handler: GET rebuilds an hourly receipt with the hourly note and no tolls line", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  const hourly = { ...PAID_SESSION, amount_total: 46673, metadata: { ref: "77340023", service: "hourly", class: "premium", vehicle: "premium", hours: "4", from_text: "1 Main Street", from_zone: "brooklyn", date: "2026-12-01", time: "14:00", meet: "0", tip_percent: "0", legs: "0", fare_cents: "42000", tax_cents: "3728", bcf_cents: "945", tolls_cents: "0", meet_cents: "0", tip_cents: "0", total_cents: "46673" } };
  stripe = () => new Response(JSON.stringify(hourly), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.equal(body.summary, "Tue, Dec 1, 2026, 2:00 PM. By the hour, Cadillac Escalade ESV (Business Premium SUV), 4 hours.");
  assert.deepEqual(body.lines, [{ label: "Fare, 4 hours", cents: 42000 }, { label: FEES, cents: 4673 }]);
  assert.deepEqual([body.value_cents, body.notes], [42000, [HOURLY_NOTE]]);
  assert.ok(!JSON.stringify(body).includes("1 Main Street"));
  assert.deepEqual(logged, []);
});

await test("handler: GET reads a session created before the deploy: its gratuity line, its sales tax from metadata or Stripe's total_details", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  const legacy = { ...PAID_SESSION, amount_total: 23986, metadata: { ref: "69042564", service: "transfer", direction: "from-airport", airport: "jfk", class: "suv", from: "jfk", to: "manhattan", date: "2026-10-14", time: "07:30", meet: "1", fare_cents: "16500", meet_cents: "2500", gratuity_cents: "3300", tax_cents: "1686", total_cents: "23986" } };
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

await test("handler: GET keeps the reference of a session paid before references became 8 digits, and labels a typed gratuity without a percent", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, client_reference_id: "NLR-Y8AHA2TE", metadata: { ...PAID_SESSION.metadata, ref: "NLR-Y8AHA2TE" } }), { status: 200 });
  assert.equal((await readJson(await get(PAID_SESSION.id), 200)).ref, "NLR-Y8AHA2TE");
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, client_reference_id: "NLR-Y8AHA2TE", metadata: {} }), { status: 200 });
  assert.equal((await readJson(await get(PAID_SESSION.id), 200)).ref, "NLR-Y8AHA2TE");
  const typed = { ...PAID_SESSION, amount_total: 25000, metadata: { ...PAID_SESSION.metadata, tip_percent: "0", tip_cents: "4000", total_cents: "25000" } };
  stripe = () => new Response(JSON.stringify(typed), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual(body.lines.slice(-2), [{ label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur", cents: 4000 }]);
  assert.deepEqual([body.ref, body.total_cents, body.value_cents], ["69042564", 25000, 18000]);
  assert.deepEqual(logged, []);
});

await test("handler: GET with a paid short-notice session adds short_notice for the confirmation page, other sessions leave it out", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, metadata: { ...PAID_SESSION.metadata, short_notice: "1" } }), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual(Object.keys(body), [...SESSION_KEYS, "short_notice"]);
  assert.equal(body.short_notice, true);
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, status: "open", payment_status: "unpaid", metadata: { ...PAID_SESSION.metadata, short_notice: "1" } }), { status: 200 });
  assert.deepEqual(await readJson(await get(PAID_SESSION.id), 200), { kind: "session", status: "open", payment_status: "unpaid" });
});

await test("handler: GET with an unpaid session returns only kind, status and payment_status", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, status: "open", payment_status: "unpaid" }), { status: 200 });
  assert.deepEqual(await readJson(await get(PAID_SESSION.id), 200), { kind: "session", status: "open", payment_status: "unpaid" });
  assert.deepEqual([calls.length, noted], [1, []]);
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

await test("handler: an Electric Class booking pays $180.00 to JFK through Stripe with the same keys as an Executive Sedan booking, names Electric Class everywhere, and a price or class posted by the browser is never read", async () => {
  setEnv(LIVE);
  const sedan = await readJson(await post({ ...STRIPE_JFK, class: "sedan", nonce: "nonce-sedan-pay-000000001" }), 200);
  assert.equal(sedan.kind, "pay");
  const sedanForm = formOf(calls.at(-1));
  const loud = { total_cents: "17000", fare_cents: "14151", price: "170", fare: "141.51", rate: "8500", seats: "9" };
  const body = await readJson(await post({ ...STRIPE_JFK, class: "electric", ...loud, nonce: "nonce-electric-pay-000001" }), 200);
  assert.equal(body.kind, "pay");
  const form = formOf(calls.at(-1));
  const items = [0, 1, 2].map((i) => [form.get(`line_items[${i}][price_data][product_data][name]`), Number(form.get(`line_items[${i}][price_data][unit_amount]`))]);
  assert.deepEqual(items, [["Fare", 15050], [FEES, 1336 + 339], [TOLLS_SHOWN, 1275]]);
  assert.equal(form.get("line_items[3][price_data][product_data][name]"), null);
  assert.deepEqual([form.get("metadata[class]"), form.get("metadata[total_cents]"), form.get("metadata[fare_cents]"), form.get("payment_intent_data[metadata][class]")], ["electric", "18000", "15050", "electric"]);
  assert.deepEqual([...form.keys()].filter((k) => k.startsWith("metadata[")).sort(), [...sedanForm.keys()].filter((k) => k.startsWith("metadata[")).sort());
  assert.deepEqual([...form.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).sort(), [...sedanForm.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).sort());
  const description = form.get("line_items[0][price_data][product_data][description]");
  assert.ok(description.startsWith("To JFK, Electric Class. "), description);
  assert.ok(description.endsWith(" Extra waiting is $1.20 a minute."), description);
  assert.ok(form.get("payment_intent_data[description]").includes(", Electric Class, 350 5th Ave to JFK."), form.get("payment_intent_data[description]"));
  assert.ok(sedanForm.get("line_items[0][price_data][product_data][description]").startsWith("To JFK, Executive Sedan. "));
  assert.equal(sedanForm.get("metadata[total_cents]"), "17000");
  for (const cls of ["Electric", "ELECTRIC", "sedan-electric", "lyriq", "electric-class"]) assert.equal((await readJson(await post({ ...STRIPE_JFK, class: cls, action: "quote" }), 422)).code, "class", cls);
  const crowd = await readJson(await post({ ...STRIPE_JFK, class: "electric", passengers: "4", action: "options" }), 200);
  assert.deepEqual([crowd.reason, crowd.price, crowd.classes.find((c) => c.class === "electric")], ["seats", null, { class: "electric", name: "Electric Class", seats: 3, total_cents: null, reason: "seats" }]);
});

await test("handler: GET rebuilds a session paid before the split, class sedan in its metadata, as an Executive Sedan, and an Electric Class session as Electric Class", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  const old = { ...PAID_SESSION, amount_total: 21623, metadata: { ...PAID_SESSION.metadata, class: "sedan", fare_cents: "14151", tax_cents: "1256", bcf_cents: "318", tip_cents: "2123", total_cents: "21623" } };
  stripe = () => new Response(JSON.stringify(old), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([body.summary, body.total_cents, body.lines.map((l) => l.cents)], ["Wed, Oct 14, 2026, 7:30 AM. From JFK, Executive Sedan.", 21623, [14151, 1574, 1275, 2500, 2123]]);
  const electric = { ...PAID_SESSION, amount_total: 22758, metadata: { ...PAID_SESSION.metadata, class: "electric", fare_cents: "15050", tax_cents: "1336", bcf_cents: "339", tip_cents: "2258", total_cents: "22758" } };
  stripe = () => new Response(JSON.stringify(electric), { status: 200 });
  const next = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([next.summary, next.total_cents, next.value_cents, next.lines.map((l) => l.cents)], ["Wed, Oct 14, 2026, 7:30 AM. From JFK, Electric Class.", 22758, 17550, [15050, 1675, 1275, 2500, 2258]]);
  assert.deepEqual(logged, []);
});

await test("handler: GET rebuilds an hourly session paid before the split, class and vehicle sedan, with the Executive Sedan model, and an hourly Electric Class session with the Lyriq", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  const meta = { ref: "77340023", service: "hourly", hours: "3", from_text: "1 Main Street", from_zone: "brooklyn", date: "2026-12-01", time: "14:00", meet: "0", tip_percent: "0", legs: "0", tolls_cents: "0", meet_cents: "0", tip_cents: "0" };
  const old = { ...PAID_SESSION, amount_total: 28337, metadata: { ...meta, class: "sedan", vehicle: "sedan", fare_cents: "25500", tax_cents: "2263", bcf_cents: "574", total_cents: "28337" } };
  stripe = () => new Response(JSON.stringify(old), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([body.summary, body.total_cents, body.lines], ["Tue, Dec 1, 2026, 2:00 PM. By the hour, Mercedes-Benz E-Class or similar (Executive Sedan), 3 hours.", 28337, [{ label: "Fare, 3 hours", cents: 25500 }, { label: FEES, cents: 2837 }]]);
  const electric = { ...PAID_SESSION, amount_total: 30004, metadata: { ...meta, class: "electric", vehicle: "electric", fare_cents: "27000", tax_cents: "2396", bcf_cents: "608", total_cents: "30004" } };
  stripe = () => new Response(JSON.stringify(electric), { status: 200 });
  const next = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([next.summary, next.total_cents, next.lines], ["Tue, Dec 1, 2026, 2:00 PM. By the hour, Cadillac Lyriq or similar (Electric Class), 3 hours.", 30004, [{ label: "Fare, 3 hours", cents: 27000 }, { label: FEES, cents: 3004 }]]);
  assert.deepEqual(logged, []);
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
  const id = `cs_mock_${ref}`;
  assert.match(ref, /^[1-9]\d{7}$/);
  assert.deepEqual(body, { kind: "pay", ref, url: `/booking-confirmed?session_id=${id}` });
  assert.notEqual(ref, reqRef(fields));
  const again = await formPost(fields);
  assert.equal(again.status, 303);
  assert.match(again.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_[1-9]\d{7}$/);
  assert.notEqual(again.headers.get("location"), body.url, "a second payment of the same trip gets its own reference");
  const session = await readJson(await get(id), 200);
  assert.deepEqual(Object.keys(session), SESSION_KEYS);
  assert.deepEqual([session.payment_status, session.ref, session.total_cents, session.value_cents, session.lines.length], ["paid", ref, 23325, 18000, 5]);
  assert.equal(session.lines.reduce((sum, item) => sum + item.cents, 0), 23325);
  assert.equal(session.summary, `${formatDate(SOON)}, 10:00 AM. From JFK, Business SUV.`);
  for (const unknown of ["cs_mock_ZZZZZZ", `cs_mock_NLR-${ref}`, `cs_mock_0${ref.slice(1)}`, `cs_mock_${ref.slice(1)}`, `cs_mock_${ref}0`]) assert.deepEqual(await readJson(await get(unknown), 200), { kind: "unknown" }, unknown);
  const typed = await readJson(await post({ ...fields, tip: "custom", tip_amount: "40" }), 200);
  const receipt = await readJson(await get(`cs_mock_${typed.ref}`), 200);
  assert.deepEqual(receipt.lines.slice(-2), [{ label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur", cents: 4000 }]);
  assert.deepEqual([receipt.total_cents, receipt.value_cents], [25000, 18000]);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
});

await test("handler: VERCEL_ENV=production with BOOK_MOCK=true and no key never mocks a payment, and refuses mock ids", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", VERCEL_ENV: "production" });
  const res = await post(STRIPE_JFK, { url: "https://www.nycluxride.com/api/book", origin: SITE });
  if (CONSENT_TERMS_LIVE) assert.deepEqual([(await readJson(res, 200)).reason, logged.includes("key-missing")], ["paused", true]);
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
  const id = `cs_mock_${ref}`;
  assert.deepEqual(paid, { kind: "pay", ref, url: `/booking-confirmed?session_id=${id}` });
  const form = await formPost(fields, ON_PREVIEW);
  assert.equal(form.status, 303);
  assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_[1-9]\d{7}$/);
  const session = await readJson(await get(id, PREVIEW), 200);
  assert.deepEqual([session.payment_status, session.ref, session.total_cents], ["paid", ref, 23325]);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
  setEnv({ VERCEL_ENV: "preview", STRIPE_SECRET_KEY: " \n" });
  assert.match((await readJson(await post(STRIPE_JFK, ON_PREVIEW), 200)).url, /^\/booking-confirmed\?session_id=cs_mock_[1-9]\d{7}$/);
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
  assert.match((await readJson(await post(STRIPE_JFK), 200)).url, /^\/booking-confirmed\?session_id=cs_mock_[1-9]\d{7}$/);
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
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const typed = (n) => Array.from({ length: n }, () => "+0123456789 ()-./x‑ "[Math.floor(random() * 16)]).join("");
  const codes = ["US", "GB", "gb", "RU", "BY", "IT", "BF", "ZZ", "", "constructor", text(2)];
  for (let i = 0; i < 60; i++) {
    const fields = { ...STRIPE_JFK, rider: "other", pname: "Ben Ortiz", phone: typed(4 + (i % 20)), phone_cc: codes[i % codes.length], pphone: i % 3 ? typed(10 + (i % 9)) : text(12), pphone_cc: codes[(i * 7) % codes.length], tip: i % 2 ? "custom" : "", tip_amount: i % 4 === 1 ? String(1 + (i % 500)) : typed(3) };
    const res = await post(fields);
    const body = await res.json();
    assert.ok((res.status === 200 && body.kind === "pay") || (res.status === 422 && ["phone", "pphone", "tip_amount"].includes(body.code)), `${res.status} ${JSON.stringify(body)} ${JSON.stringify(fields)}`);
    noStore(res);
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
  assert.deepEqual(logged, ["receipt-mismatch 69042564"]);
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, amount_total: 5000, metadata: {} }), { status: 200 });
  const link = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([link.ref, link.lines, link.total_cents, link.notes], ["69042564", [], 5000, AIRPORT_NOTES]);
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
  const outside = signTicket("mock-hoboken", "outside", "Hoboken", Date.now(), 0, "NJ");
  const hoboken = await readJson(await post({ ...fields, from_text: "Hoboken", from_ticket: outside }), 200);
  assert.deepEqual([hoboken.kind, hoboken.service, hoboken.reason, hoboken.price.total_cents, hoboken.classes.map((c) => [c.total_cents, c.reason])], ["options", "distance", "", 15849, [[15849, ""], [19070, ""], [27351, ""], [14469, ""], [15389, ""], [40233, ""]]]);
  const unknown = await readJson(await post({ ...fields, from_text: "Hoboken", from_ticket: signTicket("mock-hoboken", "outside", "Hoboken", Date.now()) }), 200);
  assert.deepEqual([unknown.kind, unknown.reason, unknown.field], ["quote", "unplaced", "from_text"], "a pickup outside New York City whose state the server can not tell goes to dispatch");
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
  for (const path of ["/api/places", "/api/route", "/api/flight", "/api/stripe-webhook"]) {
    const answer = await http(`${server.base}${path}`);
    assert.equal(answer.status, 405, path);
    assert.equal(answer.headers.allow, "POST", path);
  }
});

await test("dev server: helpers, sources and unknown names under /api/ are 404", async () => {
  const paths = ["/api/_rates", "/api/_copy", "/api/_trip", "/api/_stripe", "/api/_places", "/api/_ticket", "/api/_google", "/api/_flight", "/api/_http", "/api/_mock", "/api/_phone", "/api/_mail", "/api/_smtp", "/api/_phone.mjs", "/api/_mail.mjs", "/api/book.mjs", "/api/stripe-webhook.mjs", "/api/_rates.mjs", "/api/", "/api", "/api/missing", "/api/Book"];
  for (const path of paths) assert.equal((await http(`${server.base}${path}`)).status, 404, path);
});

await test("dev server: a full mock-mode booking: options, pay and the paid session", async () => {
  const fields = { ...PICKUP_SOON, nonce: "nonce-dev-server-000001" };
  const before = firstSlot(Date.now());
  const options = await send("/api/book", { ...fields, action: "options" });
  assert.equal(options.status, 200);
  const answer = JSON.parse(options.text);
  assert.equal(answer.price.total_cents, 23325);
  assert.ok(sameSlot(answer.earliest, before) || sameSlot(answer.earliest, firstSlot(Date.now())), JSON.stringify(answer.earliest));
  assert.deepEqual([answer.tip_custom, answer.selected.tip_amount], [{ min_cents: 100, max_cents: 50000 }, 0]);
  const pay = await send("/api/book", fields);
  assert.equal(pay.status, 200);
  assert.equal(pay.headers["cache-control"], "no-store");
  const { url, ref } = JSON.parse(pay.text);
  assert.match(ref, /^[1-9]\d{7}$/);
  assert.equal(url, `/booking-confirmed?session_id=cs_mock_${ref}`);
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
  assert.match(pay.headers.location, /^\/booking-confirmed\?session_id=cs_mock_[1-9]\d{7}$/);
  for (const [fields, location] of [[{ ...trip(HOURLY), class: "sprinter", hours: "3" }, "/book#e-sprinter-hours"], [{ ...STRIPE_JFK, to_text: "LaGuardia (LGA)", to_id: "lga", class: "sprinter", sprinter: "sprinter-white-limo" }, "/book#q-sprinter-price"], [{ ...STRIPE_JFK, from_text: "350 5th Ave" }, "/book#q-unplaced"], [{ ...STRIPE_JFK, from_text: "" }, "/book#e-from"]]) {
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
        const lookup = await http(`${demo.base}/api/book?session_id=cs_mock_${bookingRef("nonce-dev-preview-00001")}`);
        assert.deepEqual([lookup.status, JSON.parse(lookup.text)], [200, { kind: "unknown" }]);
        continue;
      }
      assert.equal(pay.status, 200);
      assert.equal(reply.url, `/booking-confirmed?session_id=cs_mock_${reply.ref}`);
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

await test("builder: a return trip priced by distance and time equals the complete expected map", async () => {
  process.env.GOOGLE_MOCK = "true";
  try {
    const built = await build(DISTANCE, ON, "nonce-distance-trip-00001");
    const service = "Executive Sedan, 2 rides, 63.0 miles and 110 min";
    const expected = {
      ...common(DISTANCE_REF, { email: ME.email }),
      "custom_text[submit][message]": SUBMIT_DISTANCE,
      ...lines([
        ["Fare", 29400, `${service}. Reference ${DISTANCE_REF}. Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. 2 passengers. Extra waiting is $1.20 a minute.`],
        [FEES, 662],
        ["Gratuity for your chauffeur (15%)", 4410, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `New booking ${DISTANCE_REF}: Wed Oct 14, 7:30 AM, Executive Sedan, 350 5th Ave to Greenwich, return Sun Oct 18, 6:00 PM. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 2 passengers. Pickup "${MANHATTAN}". Drop-off "Greenwich, CT 06830".`,
      "payment_intent_data[statement_descriptor_suffix]": "RIDE OCT14",
      ...bothMetadata({
        ref: DISTANCE_REF,
        service: "distance",
        class: "sedan",
        from_text: MANHATTAN,
        to_text: "Greenwich, CT 06830",
        zones: "from manhattan, to outside",
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        return_date: "2026-10-18",
        return_time: "18:00",
        return_at: "2026-10-18T22:00:00.000Z",
        passengers: "2",
        meet: "0",
        tip_percent: "15",
        legs: "2",
        miles: "63.0",
        minutes: "110",
        fare_cents: "29400",
        tax_cents: "0",
        bcf_cents: "662",
        tolls_cents: "0",
        meet_cents: "0",
        tip_cents: "4410",
        total_cents: "34472",
        rider: "me",
        ...ME,
        reach: "phone",
      }),
    };
    const entries = [...built.params];
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, "a parameter is sent twice");
    assert.deepEqual(Object.fromEntries(entries), expected);
    assert.equal(stripeTotal(built.params.toString()), 34472);
    assert.deepEqual(receipt(metadataFor(built.trip, built.price, built.ref), ON), {
      summary: `Wed, Oct 14, 2026, 7:30 AM. Return Sun, Oct 18, 2026, 6:00 PM. ${service}.`,
      lines: [{ label: "Fare", cents: 29400 }, { label: BCF, cents: 662 }, { label: "Gratuity for your chauffeur (15%)", cents: 4410 }],
      value: 29400,
      notes: [HOURLY_NOTE],
    });
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("handler: a one-way trip with no airport end gets distance prices on the cards, pays the same total with its route token, and without JavaScript", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const options = await readJson(await post({ ...fields, action: "options", nonce: "nonce-distance-options-1" }), 200);
  assert.deepEqual([options.kind, options.service, options.legs, options.pay, options.hold, options.reason], ["options", "distance", 1, true, "", ""]);
  assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents, c.reason]), [["suv", 12224, ""], ["premium", 13890, ""], ["first", 18892, ""], ["sedan", 9668, ""], ["electric", 10237, ""], ["sprinter", 27782, ""]]);
  assert.deepEqual(options.price, { lines: [{ label: "Fare", cents: 11000 }, { label: FEES, cents: 1224 }], total_cents: 12224, currency: "usd", notes: [HOURLY_NOTE] });
  assert.match(options.route, ROUTE);
  assert.ok(decodeURIComponent(options.whatsapp.split("?text=")[1]).endsWith("\nTotal shown: $122.24"));
  assert.equal(calls.length, 0);
  const paid = await readJson(await post({ ...fields, route: options.route, nonce: "nonce-distance-pay-00001" }), 200);
  assert.deepEqual([paid.kind, paid.url], ["pay", CHECKOUT_URL]);
  const form = Object.fromEntries(formOf(calls[0]));
  assert.deepEqual([0, 1].map((i) => [form[`line_items[${i}][price_data][product_data][name]`], form[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", "11000"], [FEES, "1224"]]);
  assert.equal(form["line_items[2][quantity]"], undefined);
  assert.deepEqual([form["metadata[tax_cents]"], form["metadata[bcf_cents]"]], ["976", "248"]);
  assert.deepEqual([form["custom_text[submit][message]"], form["custom_text[terms_of_service_acceptance][message]"], form["metadata[service]"], form["metadata[miles]"], form["metadata[minutes]"], form["metadata[total_cents]"]], [SUBMIT_DISTANCE, TERMS, "distance", "4.6", "27", "12224"]);
  assert.match(form["payment_intent_data[statement_descriptor_suffix]"], /^RIDE [A-Z]{3}\d\d$/);
  assert.equal(form["line_items[0][price_data][product_data][description]"].split(". ")[0], "Business SUV, 4.6 miles and 27 min");
  assertRedirect(await formPost(fields), CHECKOUT_URL);
  assert.equal(Object.fromEntries(formOf(calls[1]))["metadata[total_cents]"], "12224");
  const sprinter = await readJson(await post({ ...fields, class: "sprinter", route: options.route, nonce: "nonce-distance-sprinter-1" }), 200);
  assert.deepEqual([sprinter.kind, sprinter.url], ["pay", CHECKOUT_URL]);
  const van = Object.fromEntries(formOf(calls[2]));
  assert.deepEqual([0, 1].map((i) => [van[`line_items[${i}][price_data][product_data][name]`], van[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", "25000"], [FEES, String(2219 + 563)]]);
  assert.deepEqual([van["line_items[2][quantity]"], van["metadata[class]"], van["metadata[fare_cents]"], van["metadata[total_cents]"], stripeTotal(calls[2].init.body)], [undefined, "sprinter", "25000", "27782", 27782]);
  assert.equal(van["line_items[0][price_data][product_data][description]"].split(". ")[0], "Executive Sprinter, 4.6 miles and 27 min");
  assert.equal(calls.length, 3);
});

await test("handler: an options call with the map size answers the ride that set the distance price with the map of that ride, a return lists both rides, and other calls keep the priced ride", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const map = JSON.stringify({ width: 440, height: 233 });
  const fields = trip({ trip_type: "one", from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const one = await readJson(await post({ ...fields, action: "options", map, nonce: "nonce-ride-map-0000001" }), 200);
  assert.deepEqual([one.service, one.ride.kind, one.ride.minutes, one.ride.miles, "back" in one.ride, one.ride.map.width, one.ride.map.height, one.ride.map.src2x === one.ride.map.src], ["distance", "ok", 27, 4.6, false, 440, 233, true]);
  assert.ok(one.ride.map.src.startsWith("data:image/svg+xml,") && decodeURIComponent(one.ride.map.src).includes('width="440" height="233"'));
  assert.equal(one.classes.find((c) => c.class === "suv").total_cents, 12224);
  const quote = await readJson(await post({ ...fields, action: "quote", route: one.route, map, nonce: "nonce-ride-map-0000002" }), 200);
  assert.deepEqual([quote.ride, quote.classes.find((c) => c.class === "suv").total_cents], [{ kind: "ok", minutes: 27, miles: 4.6, attribution: "Google Maps" }, 12224]);
  const back = await readJson(await post({ ...trip({ ...fields, return: "1" }), return_time: "18:00", action: "options", map, nonce: "nonce-ride-map-0000003" }), 200);
  assert.deepEqual([back.service, back.legs, back.ride.minutes, back.ride.miles, back.ride.back, back.ride.map.width], ["distance", 2, 27, 4.6, { minutes: 31, miles: 4.8 }, 440]);
  const long = await readJson(await post({ ...fields, to_text: "Raleigh, NC", action: "options", map, nonce: "nonce-ride-map-0000004" }), 200);
  assert.deepEqual([long.kind, long.reason, long.ride.minutes, long.ride.miles, long.ride.map.height], ["quote", "long-trip", 480, 501, 233]);
  const far = await readJson(await post({ ...fields, from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, NY 14303", action: "options", map, nonce: "nonce-ride-map-0000006" }), 200);
  assert.deepEqual([far.kind, far.service, far.ride.minutes, far.ride.miles, far.ride.map.width, far.ride.map.height, far.classes.find((c) => c.class === "suv").total_cents], ["options", "distance", 420, 400, 440, 233, 195093]);
  for (const bad of ["640x239", "{\"width\":9999,\"height\":233}", "[440,233]", "{"]) assert.deepEqual((await readJson(await post({ ...fields, action: "options", map: bad }), 200)).ride, { kind: "ok", minutes: 27, miles: 4.6, attribution: "Google Maps" }, bad);
  const air = await readJson(await post({ ...fields, from_text: "John F. Kennedy (JFK)", from_id: "jfk", action: "options", map, nonce: "nonce-ride-map-0000005" }), 200);
  assert.deepEqual([air.service, "ride" in air, "route" in air], ["airport", false, false]);
  assert.equal(calls.length, 0);
});

await test("handler: with real keys the options call with a map size routes afresh even with an earlier ride token, signs one map with both legs of a return, and the pay call keeps the ride of that options answer", async () => {
  const POLY = "a~l~Fjk~uOwHJy@P|bA`@\\", BACK = "c~l~Fjk~uOxHJz@Q";
  const SECRET = Buffer.from("test-signing-secret-SENTINEL-bytes").toString("base64url");
  setEnv({ ...LIVE, GOOGLE_MAPS_SERVER_KEY: "test-server-key-SENTINEL" });
  Object.assign(process.env, { GOOGLE_MAPS_BROWSER_KEY: "test-browser-key", GOOGLE_MAPS_SIGNING_SECRET: SECRET });
  let minutes = 27;
  const leg = (latitude, longitude) => ({ latLng: { latitude, longitude } });
  stripe = (url, init) => {
    if (!url.startsWith("https://routes.googleapis.com/")) return STRIPE_OK(url, init);
    const home = JSON.parse(init.body).origin.address !== MANHATTAN;
    return new Response(JSON.stringify({ routes: [{ duration: `${(home ? 31 : minutes) * 60}s`, distanceMeters: home ? 7725 : 7403, polyline: { encodedPolyline: home ? BACK : POLY }, legs: [{ startLocation: leg(40.748441, -73.985664), endLocation: leg(40.714322, -73.961052) }] }] }), { status: 200 });
  };
  const map = JSON.stringify({ width: 440, height: 233 });
  const fields = { ...trip({ trip_type: "one", from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "suv", ...ME, reach: "phone" }), time: "11:15" };
  const first = await readJson(await post({ ...fields, action: "options", map, nonce: "nonce-ride-keys-000001" }), 200);
  assert.deepEqual([first.ride.minutes, first.ride.miles, calls.length], [27, 4.6, 1]);
  minutes = 120;
  const total = (body) => body.classes.find((c) => c.class === "suv").total_cents;
  const again = await readJson(await post({ ...fields, action: "options", route: first.route, map, nonce: "nonce-ride-keys-000002" }), 200);
  assert.deepEqual([again.ride.minutes, total(first), total(again) > total(first), calls.length], [120, 12224, true, 2]);
  assert.ok(again.ride.map.src.startsWith("https://maps.googleapis.com/maps/api/staticmap?size=440x233&scale=1&format=png&path=") && again.ride.map.src.split("&path=").length === 2 && /&signature=[\w-]{27}=?$/.test(again.ride.map.src));
  minutes = 50;
  const quote = await readJson(await post({ ...fields, action: "quote", route: again.route, nonce: "nonce-ride-keys-000003" }), 200);
  assert.deepEqual([quote.ride.minutes, total(quote), calls.length], [120, total(again), 2]);
  const round = await readJson(await post({ ...fields, return: "1", return_date: inDays(5), return_time: "18:00", action: "options", map, nonce: "nonce-ride-keys-000004" }), 200);
  assert.deepEqual([round.ride.minutes, round.ride.back, round.ride.map.src.split("&path=").length - 1, round.ride.map.src.includes(encodeURIComponent(BACK)), calls.length], [50, { minutes: 31, miles: 4.8 }, 2, true, 4]);
  assert.ok(!JSON.stringify([first, again, quote, round]).includes("test-server-key-SENTINEL") && !JSON.stringify(round).includes(SECRET));
});

await test("handler: the distance requests and their redirects, outside-us and long-trip, the Luxury Sprinter priced and sent to Checkout, and no-airport when there is no route", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "suv", ...ME, reach: "phone" });
  for (const [change, reason] of [[{ to_text: "Toronto, ON M5V 3L9" }, "outside-us"], [{ from_text: "Niagara Falls, Ontario", to_text: "Greenwich, CT 06830" }, "outside-us"], [{ to_text: "Raleigh, NC" }, "long-trip"], [{ to_text: "Bar Harbor, ME 04609" }, "long-trip"], [{ to_text: "Raleigh, NC", class: "sprinter" }, "long-trip"]]) {
    assertRedirect(await formPost({ ...fields, ...change }), `/book#q-${reason}`);
    const body = await readJson(await post({ ...fields, ...change, action: "quote" }), 200);
    assert.deepEqual([body.kind, body.reason, body.heading, body.text, body.classes.every((c) => c.total_cents === null && c.reason === reason)], ["quote", reason, HEADINGS.price, REASONS[reason].text, true], reason);
  }
  const sprinter = await readJson(await post({ ...fields, class: "sprinter", action: "quote" }), 200);
  assert.deepEqual([sprinter.kind, sprinter.reason, sprinter.pay, sprinter.price.total_cents, sprinter.price.lines], ["options", "", true, 27782, [{ label: "Fare", cents: 25000 }, { label: FEES, cents: 2782 }]]);
  assertRedirect(await formPost({ ...fields, class: "sprinter" }), CHECKOUT_URL);
  setEnv(LIVE);
  assertRedirect(await formPost(fields), "/book#q-no-airport");
  const away = { ...fields, from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, NY 14303" };
  assertRedirect(await formPost(away), "/book#q-no-airport-short");
  assertRedirect(await formPost({ ...away, from_text: "Hoboken, NJ 07030", to_text: MANHATTAN }), "/book#q-no-airport-short");
  assertRedirect(await formPost({ ...away, from_text: "277 Bedford Ave, Brooklyn, NY 11211" }), "/book#q-no-airport");
  for (const [change, text] of [[{}, REASONS["no-airport"].short], [{ from_text: "Hoboken, NJ 07030", to_text: MANHATTAN }, REASONS["no-airport"].short], [{ from_text: "277 Bedford Ave, Brooklyn, NY 11211" }, REASONS["no-airport"].text]]) {
    const body = await readJson(await post({ ...away, ...change, action: "options" }), 200);
    assert.deepEqual([body.kind, body.reason, body.text], ["quote", "no-airport", text], JSON.stringify(change));
  }
  assert.equal(calls.length, 0);
});

await test("handler: BOOK_MOCK pays a distance trip and GET rebuilds its receipt with the miles, the minutes and the hourly after the ride note", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: MANHATTAN, to_text: "277 Bedford Ave, Brooklyn, NY 11211", passengers: "2", class: "sedan", tip: "20", ...ME, reach: "phone", nonce: "nonce-distance-mock-0001" });
  const body = await readJson(await post(fields), 200);
  const session = await readJson(await get(`cs_mock_${body.ref}`), 200);
  assert.deepEqual(session.lines, [{ label: "Fare", cents: 8700 }, { label: FEES, cents: 968 }, { label: "Gratuity for your chauffeur (20%)", cents: 1740 }]);
  assert.deepEqual([session.total_cents, session.value_cents, session.notes], [11408, 8700, [HOURLY_NOTE]]);
  assert.equal(session.summary, `${formatDate(SOON)}, 10:00 AM. Executive Sedan, 4.6 miles and 27 min.`);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
});

await test("builder: a JFK pickup to New Jersey with meet and greet and a 15% gratuity, priced by distance and time over the airport fare, equals the complete expected map", async () => {
  process.env.GOOGLE_MOCK = "true";
  try {
    const built = await build(NJ_PICKUP, ON, "nonce-nj-pickup-0000001");
    const service = "Business SUV, 25.2 miles and 50 min";
    const expected = {
      ...common(NJ_REF, { email: ME.email }),
      "custom_text[submit][message]": SUBMIT_OUTSIDE,
      ...lines([
        ["Fare", 16830, `${service}. Reference ${NJ_REF}. Wed, Oct 14, 2026, 7:30 AM. 2 passengers. Extra waiting is $1.50 a minute.`],
        [FEES, 379],
        ["Meet and greet", 2500, MEET_TEXT],
        ["Gratuity for your chauffeur (15%)", 2525, TIP_TEXT],
      ]),
      "payment_intent_data[description]": `New booking ${NJ_REF}: Wed Oct 14, 7:30 AM, Business SUV, JFK to Secaucus. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. Flight EK 201. 2 passengers. Meet and greet. Pickup "John F. Kennedy (JFK), Terminal 4". Drop-off "Secaucus, NJ 07094".`,
      "payment_intent_data[statement_descriptor_suffix]": "RIDE OCT14",
      ...bothMetadata({
        ref: NJ_REF,
        service: "distance",
        direction: "from-airport",
        airport: "jfk",
        class: "suv",
        from_text: "John F. Kennedy (JFK), Terminal 4",
        to_text: "Secaucus, NJ 07094",
        zones: "from jfk, to outside",
        places: "from jfk-t4",
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        passengers: "2",
        flight: "EK 201",
        meet: "1",
        tip_percent: "15",
        legs: "1",
        miles: "25.2",
        minutes: "50",
        fare_cents: "16830",
        tax_cents: "0",
        bcf_cents: "379",
        tolls_cents: "0",
        meet_cents: "2500",
        tip_cents: "2525",
        total_cents: "22234",
        rider: "me",
        ...ME,
        reach: "whatsapp",
        sign_name: ME.name,
      }),
    };
    const entries = [...built.params];
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, "a parameter is sent twice");
    assert.deepEqual(Object.fromEntries(entries), expected);
    assert.ok(!entries.some(([, value]) => value === TOLLS), "no tolls line");
    assert.equal(stripeTotal(built.params.toString()), 22234);
    assert.deepEqual(receipt(metadataFor(built.trip, built.price, built.ref), ON), {
      summary: `Wed, Oct 14, 2026, 7:30 AM. ${service}.`,
      lines: [{ label: "Fare", cents: 16830 }, { label: BCF, cents: 379 }, { label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur (15%)", cents: 2525 }],
      value: 19330,
      notes: [OUTSIDE_NOTE],
    });
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("handler: a New Jersey address to JFK gets the airport fare or the distance and time fare on the cards, pays the same total with its route token, and without JavaScript", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: "Secaucus, NJ 07094", to_text: "John F. Kennedy (JFK)", to_id: "jfk", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const options = await readJson(await post({ ...fields, action: "options", nonce: "nonce-nj-options-000001" }), 200);
  assert.deepEqual([options.kind, options.service, options.legs, options.pay, options.hold, options.reason, options.meet], ["options", "distance", 1, true, "", "", false]);
  assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents, c.reason]), [["suv", 16795, ""], ["premium", 20424, ""], ["first", 27351, ""], ["sedan", 14469, ""], ["electric", 15389, ""], ["sprinter", 40233, ""]]);
  assert.deepEqual(options.price, { lines: [{ label: "Fare", cents: 16425 }, { label: FEES, cents: 370 }], total_cents: 16795, currency: "usd", notes: [OUTSIDE_NOTE] });
  assert.deepEqual(options.ride, { kind: "ok", minutes: 45, miles: 25, attribution: "Google Maps" });
  assert.match(options.route, ROUTE);
  assert.ok(decodeURIComponent(options.whatsapp.split("?text=")[1]).endsWith("\nTotal shown: $167.95"));
  assert.equal(calls.length, 0);
  const paid = await readJson(await post({ ...fields, route: options.route, nonce: "nonce-nj-pay-0000000001" }), 200);
  assert.deepEqual([paid.kind, paid.url], ["pay", CHECKOUT_URL]);
  const form = Object.fromEntries(formOf(calls[0]));
  assert.deepEqual([0, 1].map((i) => [form[`line_items[${i}][price_data][product_data][name]`], form[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", "16425"], [FEES, "370"]]);
  assert.equal(form["line_items[2][quantity]"], undefined);
  assert.deepEqual([form["custom_text[submit][message]"], form["custom_text[terms_of_service_acceptance][message]"], form["metadata[service]"], form["metadata[direction]"], form["metadata[airport]"], form["metadata[miles]"], form["metadata[minutes]"], form["metadata[tolls_cents]"], form["metadata[total_cents]"]], [SUBMIT_OUTSIDE, TERMS, "distance", "to-airport", "jfk", "25.0", "45", "0", "16795"]);
  assert.ok(!Object.values(form).includes(TOLLS) && !Object.values(form).includes(TOLLS_SHOWN), "no tolls line");
  assert.equal(stripeTotal(calls[0].init.body), 16795);
  assert.match(form["payment_intent_data[statement_descriptor_suffix]"], /^RIDE [A-Z]{3}\d\d$/);
  assert.equal(form["line_items[0][price_data][product_data][description]"].split(". ")[0], "Business SUV, 25.0 miles and 45 min");
  assertRedirect(await formPost(fields), CHECKOUT_URL);
  assert.equal(Object.fromEntries(formOf(calls[1]))["metadata[total_cents]"], "16795");
  await readJson(await post({ ...fields, class: "sedan", route: options.route, nonce: "nonce-nj-pay-0000000002" }), 200);
  const sedan = Object.fromEntries(formOf(calls[2]));
  assert.deepEqual([sedan["metadata[fare_cents]"], sedan["metadata[total_cents]"], sedan["line_items[2][quantity]"]], ["14151", "14469", undefined]);
  const sprinter = await readJson(await post({ ...fields, class: "sprinter", route: options.route, nonce: "nonce-nj-pay-0000000003" }), 200);
  assert.deepEqual([sprinter.kind, sprinter.url], ["pay", CHECKOUT_URL]);
  const van = Object.fromEntries(formOf(calls[3]));
  assert.deepEqual([0, 1].map((i) => [van[`line_items[${i}][price_data][product_data][name]`], van[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", String(AIRPORT_FARES["sprinter-executive"].jfk)], [FEES, String(885)]]);
  assert.deepEqual([van["line_items[2][quantity]"], van["metadata[fare_cents]"], van["metadata[tolls_cents]"], van["metadata[total_cents]"], stripeTotal(calls[3].init.body)], [undefined, "39348", "0", "40233", 40233]);
  assert.equal(calls.length, 4);
});

await test("handler: an airport trip to an address outside New York City asks dispatch as long-trip over the limits, as outside-us for an end in Canada and as outside-city for an airport ZIP code address or with no route, with their redirects, in the Luxury Sprinter too, and prices the Luxury Sprinter like every class", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: "Secaucus, NJ 07094", passengers: "2", class: "suv", ...ME, reach: "phone" });
  for (const [change, reason] of [[{ to_text: "Raleigh, NC" }, "long-trip"], [{ to_text: "Montreal, QC" }, "outside-us"], [{ to_text: "3 Brewster Rd, Newark, NJ 07114" }, "outside-city"], [{ to_text: "Montreal, QC", class: "sprinter" }, "outside-us"], [{ to_text: "3 Brewster Rd, Newark, NJ 07114", class: "sprinter" }, "outside-city"]]) {
    assertRedirect(await formPost({ ...fields, ...change }), `/book#q-${reason}`);
    const body = await readJson(await post({ ...fields, ...change, action: "quote" }), 200);
    assert.deepEqual([body.kind, body.reason, body.heading, body.text, body.classes.every((c) => c.total_cents === null && c.reason === reason)], ["quote", reason, HEADINGS.price, REASONS[reason].text, true], reason);
  }
  const sprinter = await readJson(await post({ ...fields, class: "sprinter", action: "quote" }), 200);
  assert.deepEqual([8000 + 254 * 90 + 52 * 145 < AIRPORT_FARES["sprinter-executive"].jfk, AIRPORT_FARES["sprinter-executive"].jfk], [true, 39348]);
  assert.deepEqual([sprinter.kind, sprinter.reason, sprinter.pay, sprinter.price.total_cents, sprinter.price.lines], ["options", "", true, 40233, [{ label: "Fare", cents: 39348 }, { label: FEES, cents: 885 }]]);
  assertRedirect(await formPost({ ...fields, class: "sprinter" }), CHECKOUT_URL);
  const long = await readJson(await post({ ...fields, to_text: "Raleigh, NC", action: "options" }), 200);
  assert.deepEqual([long.reason, long.ride], ["long-trip", { kind: "ok", minutes: 505, miles: 524.6, attribution: "Google Maps" }]);
  setEnv(LIVE);
  assertRedirect(await formPost(fields), "/book#q-outside-city");
  assert.equal((await readJson(await post({ ...fields, action: "options" }), 200)).text, REASONS["outside-city"].text);
  assert.equal(calls.length, 0);
});

await test("handler: BOOK_MOCK pays a JFK pickup to New Jersey with meet and greet, and GET rebuilds its receipt with no tolls line, the miles, the minutes and the after the ride note", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "Secaucus, NJ 07094", passengers: "2", class: "suv", meet: "1", flight: "EK 201", tip: "15", ...ME, reach: "phone", nonce: "nonce-nj-mock-00000001" });
  const body = await readJson(await post(fields), 200);
  const session = await readJson(await get(`cs_mock_${body.ref}`), 200);
  assert.deepEqual(session.lines, [{ label: "Fare", cents: 16830 }, { label: FEES, cents: 379 }, { label: "Meet and greet", cents: 2500 }, { label: "Gratuity for your chauffeur (15%)", cents: 2525 }]);
  assert.deepEqual([session.total_cents, session.value_cents, session.notes], [22234, 19330, [OUTSIDE_NOTE]]);
  assert.equal(session.summary, `${formatDate(SOON)}, 10:00 AM. Business SUV, 25.2 miles and 50 min.`);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
});

await test("handler: the owner's trip from 806 6th Street, Secaucus, NJ to Niagara Falls, NY, 400.0 miles and 420 minutes, gets distance prices on the cards in every class, and Stripe gets the same total, 195,093 cents in the Business SUV with no New York sales tax, in its line items and metadata, with its route token and without JavaScript", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, NY 14303", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const options = await readJson(await post({ ...fields, action: "options", nonce: "nonce-niagara-options-01" }), 200);
  assert.deepEqual([options.kind, options.service, options.legs, options.pay, options.hold, options.reason, options.meet], ["options", "distance", 1, true, "", "", false]);
  assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents, c.reason]), [["suv", 195093, ""], ["premium", 233232, ""], ["first", 258999, ""], ["sedan", 146729, ""], ["electric", 155529, ""], ["sprinter", 438550, ""]]);
  assert.deepEqual(options.price, { lines: [{ label: "Fare", cents: 190800 }, { label: FEES, cents: 4293 }], total_cents: 195093, currency: "usd", notes: [HOURLY_NOTE] });
  assert.deepEqual(options.ride, { kind: "ok", minutes: 420, miles: 400, attribution: "Google Maps" });
  assert.match(options.route, ROUTE);
  assert.ok(decodeURIComponent(options.whatsapp.split("?text=")[1]).endsWith("\nTotal shown: $1,950.93"));
  assert.equal(calls.length, 0);
  const paid = await readJson(await post({ ...fields, route: options.route, nonce: "nonce-niagara-pay-000001" }), 200);
  assert.deepEqual([paid.kind, paid.url, calls.length], ["pay", CHECKOUT_URL, 1]);
  const form = Object.fromEntries(formOf(calls[0]));
  assert.deepEqual([0, 1].map((i) => [form[`line_items[${i}][price_data][product_data][name]`], form[`line_items[${i}][price_data][unit_amount]`], form[`line_items[${i}][quantity]`]]), [["Fare", "190800", "1"], [FEES, String(4293), "1"]]);
  assert.equal(form["line_items[2][quantity]"], undefined);
  assert.deepEqual([form["metadata[tax_cents]"], form["metadata[bcf_cents]"]], ["0", "4293"]);
  assert.equal(stripeTotal(calls[0].init.body), 195093);
  assert.deepEqual([form["metadata[service]"], form["metadata[zones]"], form["metadata[miles]"], form["metadata[minutes]"], form["metadata[fare_cents]"], form["metadata[tolls_cents]"], form["metadata[total_cents]"], form["payment_intent_data[metadata][total_cents]"]], ["distance", "from outside, to outside", "400.0", "420", "190800", "0", "195093", "195093"]);
  assert.deepEqual([form["custom_text[submit][message]"], form["custom_text[terms_of_service_acceptance][message]"]], [SUBMIT_DISTANCE, TERMS]);
  assert.equal(form["line_items[0][price_data][product_data][description]"].split(". ")[0], "Business SUV, 400.0 miles and 420 min");
  assert.match(form["payment_intent_data[statement_descriptor_suffix]"], /^RIDE [A-Z]{3}\d\d$/);
  assertRedirect(await formPost(fields), CHECKOUT_URL);
  assert.equal(stripeTotal(calls[1].init.body), 195093);
  await readJson(await post({ ...fields, class: "first", route: options.route, nonce: "nonce-niagara-pay-000002" }), 200);
  assert.deepEqual([stripeTotal(calls[2].init.body), Object.fromEntries(formOf(calls[2]))["metadata[total_cents]"]], [258999, "258999"]);
  await readJson(await post({ ...fields, class: "sprinter", route: options.route, nonce: "nonce-niagara-pay-000004" }), 200);
  const van = Object.fromEntries(formOf(calls[3]));
  assert.deepEqual([0, 1].map((i) => [van[`line_items[${i}][price_data][product_data][name]`], van[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", "428900"], [FEES, String(9650)]]);
  assert.deepEqual([stripeTotal(calls[3].init.body), van["metadata[total_cents]"], van["line_items[0][price_data][product_data][description]"].split(". ")[0]], [438550, "438550", "Executive Sprinter, 400.0 miles and 420 min"]);
  assert.equal(calls.length, 4);
});

await test("handler: when Stripe's amount for the owner's trip differs from the total, the session is expired and the rider gets the payment error, never a payment link", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  stripe = (url, init) => (url.endsWith("/expire") ? new Response("{}", { status: 200 }) : new Response(JSON.stringify({ id: "cs_test_a1B2c3D4e5F6g7H8i9J0", object: "checkout.session", url: CHECKOUT_URL, amount_total: stripeTotal(init.body) - 1 }), { status: 200 }));
  const fields = trip({ trip_type: "one", from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, NY 14303", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const body = await readJson(await post({ ...fields, nonce: "nonce-niagara-pay-000003" }), 502);
  assert.deepEqual([body.kind, body.code, "url" in body], ["error", "stripe", false]);
  assert.deepEqual(calls.map((c) => c.url), ["https://api.stripe.com/v1/checkout/sessions", "https://api.stripe.com/v1/checkout/sessions/cs_test_a1B2c3D4e5F6g7H8i9J0/expire"]);
  assert.ok(logged.some((line) => line.startsWith("amount-mismatch 195092 195093 ")), logged.join(" | "));
});

await test("handler: BOOK_MOCK pays the owner's trip to Niagara Falls and GET rebuilds the confirmation with its lines, the total, 400.0 miles and 420 min and the after the ride note", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, NY 14303", passengers: "2", class: "sedan", tip: "15", ...ME, reach: "phone", nonce: "nonce-niagara-mock-0001" });
  const body = await readJson(await post(fields), 200);
  const session = await readJson(await get(`cs_mock_${body.ref}`), 200);
  assert.deepEqual(session.lines, [{ label: "Fare", cents: 143500 }, { label: FEES, cents: 3229 }, { label: "Gratuity for your chauffeur (15%)", cents: 21525 }]);
  assert.deepEqual([session.total_cents, session.value_cents, session.notes], [168254, 143500, [HOURLY_NOTE]]);
  assert.equal(session.summary, `${formatDate(SOON)}, 10:00 AM. Executive Sedan, 400.0 miles and 420 min.`);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
});

await test("handler: a trip to Canada answers the outside-us quote with its heading and text and no price on any card, its WhatsApp message names the end Outside the United States, and without JavaScript it lands on its request", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = trip({ trip_type: "one", from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, ON L2E 6T2", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const body = await readJson(await post({ ...fields, action: "options" }), 200);
  assert.deepEqual([body.kind, body.reason, body.group, body.heading, body.text, body.field, "price" in body, "ride" in body, "route" in body], ["quote", "outside-us", "price", HEADINGS.price, "For trips that start or end outside the United States, we'll send you a price.", "", false, false, false]);
  assert.ok(body.classes.every((c) => c.total_cents === null && c.reason === "outside-us"));
  const message = decodeURIComponent(body.whatsapp.split("?text=")[1]);
  assert.ok(message.includes("\nPickup: 806 6th Street, Secaucus, NJ (Outside New York City)\nDrop-off: Niagara Falls, ON L2E 6T2 (Outside the United States)\n"), message);
  assert.ok(!message.includes("Total shown"), message);
  assertRedirect(await formPost(fields), "/book#q-outside-us");
  assertRedirect(await formPost({ ...fields, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: "Toronto, ON" }), "/book#q-outside-us");
  for (const to_text of ["1 Place Ville Marie, Montreal, QC H3B 2B6, CA", "Montreal, QC, CA", "Tijuana, B.C. 22000"]) {
    const typed = await readJson(await post({ ...fields, to_text, action: "options" }), 200);
    assert.deepEqual([typed.kind, typed.reason, "price" in typed, typed.classes.every((c) => c.total_cents === null && c.reason === "outside-us")], ["quote", "outside-us", false, true], to_text);
    assertRedirect(await formPost({ ...fields, to_text }), "/book#q-outside-us");
    assertRedirect(await formPost({ ...fields, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text }), "/book#q-outside-us");
  }
  assert.equal(calls.length, 0);
});

const SEAT_KEYS = ["seats", "seats_cents", "child_seats", "infant_seats", "toddler_seats", "booster_seats"];
const metadataOf = (form) => Object.fromEntries([...form].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
const seatMeta = (form) => Object.fromEntries(SEAT_KEYS.filter((k) => form.has(`metadata[${k}]`)).map((k) => [k, form.get(`metadata[${k}]`)]));
const lineItems = (form) => {
  const out = [];
  for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) out.push([form.get(`line_items[${i}][price_data][product_data][name]`), Number(form.get(`line_items[${i}][price_data][unit_amount]`)), form.get(`line_items[${i}][quantity]`), form.get(`line_items[${i}][price_data][product_data][description]`)]);
  return out;
};

await test("builder: child seats on a one way airport pickup, 0, 1 and the maximum of 12, go to Stripe as their own line item after meet and greet with the count, the price per seat and the types, the amount of the total, and the counts per type in one seats key and seats_cents in both metadata maps, and nothing about seats when none is chosen", async () => {
  setEnv();
  for (const [seats, cls, pax, line, meta, intent] of [
    [{}, "suv", "2", null, {}, ". Flight DL 401. 2 passengers. Meet and greet. Pickup "],
    [{ infant_seats: "1" }, "suv", "2", ["Child seats (1 x $15.00)", 1500, "1", "1 infant seat."], { seats: "1 infant", seats_cents: "1500" }, ". Flight DL 401. 2 passengers. 1 infant seat. Meet and greet. Pickup "],
    [{ infant_seats: "4", toddler_seats: "4", booster_seats: "4" }, "sprinter", "12", ["Child seats (12 x $15.00)", 18000, "1", "4 child seats, 4 infant seats and 4 booster seats."], { seats: "4 toddler, 4 infant, 4 booster", seats_cents: "18000" }, ". Flight DL 401. 12 passengers. 4 child seats, 4 infant seats and 4 booster seats. Meet and greet. Pickup "],
  ]) {
    const { params, price } = await build({ ...PICKUP, ...seats, class: cls, passengers: pax }, ON, "nonce-seat-builder-000001");
    const items = lineItems(params);
    const at = items.findIndex(([name]) => name === "Meet and greet");
    assert.deepEqual(items[at + 1], line ? line : ["Gratuity for your chauffeur (15%)", price.tip, "1", TIP_TEXT], JSON.stringify(seats));
    if (line) assert.deepEqual(items[at + 2][0], "Gratuity for your chauffeur (15%)");
    assert.equal(items.filter(([name]) => name.startsWith("Child seats")).length, line ? 1 : 0);
    assert.equal(stripeTotal(params.toString()), price.total);
    assert.equal(params.get("metadata[total_cents]"), String(price.total));
    assert.deepEqual(seatMeta(params), meta);
    assert.deepEqual(Object.fromEntries(SEAT_KEYS.filter((k) => params.has(`payment_intent_data[metadata][${k}]`)).map((k) => [k, params.get(`payment_intent_data[metadata][${k}]`)])), meta);
    assert.ok(params.get("payment_intent_data[description]").includes(intent), params.get("payment_intent_data[description]"));
    assert.equal(params.get("custom_text[submit][message]"), SUBMIT);
  }
  const one = await build({ ...PICKUP, infant_seats: "1" }, ON, "nonce-seat-builder-000001");
  assert.equal(one.price.total, 23325 + 1500);
  const none = await build(PICKUP, ON, "nonce-airport-pickup-0001");
  assert.deepEqual(Object.fromEntries([...none.params]), EXPECTED["an airport pickup with meet and greet and a 15% gratuity"][3]);
  assert.deepEqual(SEAT_KEYS.filter((k) => none.params.has(`metadata[${k}]`) || none.params.has(`payment_intent_data[metadata][${k}]`)), []);
});

await test("builder: child seats on a round trip and on an hourly booking are one line item charged once for the booking, with the submit text that names them, 0, 1 and the maximum", async () => {
  setEnv();
  for (const [fields, seats, add, submit] of [
    [ROUND, {}, 0, SUBMIT],
    [ROUND, { booster_seats: "1" }, 1500, SUBMIT],
    [{ ...ROUND, class: "sprinter", passengers: "12", tip: "" }, { infant_seats: "6", booster_seats: "6" }, 18000, SUBMIT],
    [HOURLY, {}, 0, SUBMIT_HOURLY],
    [HOURLY, { toddler_seats: "1" }, 1500, SUBMIT_HOURLY],
    [{ ...HOURLY, passengers: "5" }, { infant_seats: "1", toddler_seats: "2", booster_seats: "2" }, 7500, SUBMIT_HOURLY],
  ]) {
    const plain = await build(fields, ON, "nonce-seat-round-0000001");
    const { params, price } = await build({ ...fields, ...seats }, ON, "nonce-seat-round-0000001");
    assert.equal(price.total - plain.price.total, add, JSON.stringify(seats));
    assert.equal(stripeTotal(params.toString()), price.total);
    const items = lineItems(params).filter(([name]) => name.startsWith("Child seats"));
    assert.equal(items.length, add ? 1 : 0);
    if (add) assert.deepEqual(items[0].slice(0, 3), [`Child seats (${add / 1500} x $15.00)`, add, "1"]);
    assert.equal(params.get("metadata[child_seats]"), null);
    assert.equal(bookingData(metadataOf(params)).child_seats, add ? String(add / 1500) : undefined);
    assert.equal(params.get("custom_text[submit][message]"), submit);
  }
});

await test("builder: the largest booking, two stops, a return, both flights, meet and greet, someone else riding, notes, short notice and 12 child seats of all three types, writes at most 48 metadata keys, so the send-once marker of the booking emails still fits in Stripe's 50", async () => {
  setEnv();
  const fields = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", stop1_text: MANHATTAN, stop2_text: "LaGuardia (LGA)", stop2_id: "lga", to_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-10-01", time: "13:20", return: "1", return_date: "2026-10-18", return_time: "18:00", flight: "DL 401", return_flight: "B6 1234", passengers: "12", class: "sprinter", meet: "1", tip: "custom", tip_amount: "40", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz family", notes: "Kids aged 1, 3 and 6", infant_seats: "4", toddler_seats: "4", booster_seats: "4" };
  const { params, price, trip } = await build(fields, ON, "nonce-seat-largest-000001", new Date("2026-10-01T16:00:00.000Z"));
  assert.deepEqual(trip.legs.map((l) => l.reason), ["", "", "", ""]);
  const keys = [...params.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
  assert.ok(keys.length <= 48, `${keys.length} keys`);
  assert.deepEqual(keys.filter((k) => SEAT_KEYS.includes(k)), ["seats", "seats_cents"]);
  assert.deepEqual([params.get("metadata[seats]"), params.get("metadata[zones]")], ["4 toddler, 4 infant, 4 booster", "from jfk, stop1 manhattan, stop2 lga, to brooklyn"]);
  assert.ok(keys.includes("short_notice") && keys.includes("return_at"), keys.join(" "));
  assert.equal([...params.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).length, keys.length);
  assert.equal(price.seats, 18000);
});

await test("builder: the largest booking with stop fees, two Manhattan stops on the way from JFK to Brooklyn, a return, both flights, meet and greet, someone else riding, notes, short notice and 12 child seats, adds only stops_cents and still writes at most 48 metadata keys", async () => {
  setEnv();
  process.env.GOOGLE_MOCK = "true";
  try {
    const fields = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", stop1_text: MANHATTAN, stop2_text: "40 Wall St, New York, NY 10005", to_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-10-01", time: "13:20", return: "1", return_date: "2026-10-18", return_time: "18:00", flight: "DL 401", return_flight: "B6 1234", passengers: "12", class: "sprinter", meet: "1", tip: "custom", tip_amount: "40", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz family", notes: "Kids aged 1, 3 and 6", infant_seats: "4", toddler_seats: "4", booster_seats: "4" };
    const { params, price } = await build(fields, ON, "nonce-stop-largest-000001", new Date("2026-10-01T16:00:00.000Z"));
    assert.deepEqual([price.stops, price.stopLabel, price.service], [4000, "Extra stops (2 x $20.00)", "airport"]);
    const keys = [...params.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
    assert.ok(keys.length <= 48, `${keys.length} keys`);
    assert.ok(keys.includes("stops_cents") && keys.includes("short_notice") && params.get("metadata[zones]").includes(", stop2 manhattan, "), keys.join(" "));
    assert.equal(params.get("metadata[stops_cents]"), "4000");
    assert.equal(stripeTotal(params.toString()), price.total);
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("handler: options sends the price per seat and the class cards include the seats, Stripe gets the seat line item and the amount, and when Stripe answers another amount the session is expired", async () => {
  setEnv(LIVE);
  const fields = { ...STRIPE_JFK, passengers: "3", infant_seats: "1", booster_seats: "1", nonce: "nonce-seat-handler-000001" };
  const options = await readJson(await post({ ...fields, action: "options" }), 200);
  assert.equal(options.seat_cents, 1500);
  assert.deepEqual(options.classes.map((c) => c.total_cents), [21500, 25000, 34000, 20000, 21000, 48000]);
  assert.deepEqual(options.price.lines.at(-1), { label: "Child seats (2 x $15.00)", cents: 3000 });
  assert.equal(options.price.total_cents, 21500);
  const message = decodeURIComponent(options.whatsapp.split("?text=")[1]);
  assert.ok(message.includes("\nPassengers: 3\nVehicle: Business SUV\nInfant seats: 1\nBooster seats: 1\nTotal shown: $215.00"), message);
  const paid = await readJson(await post(fields), 200);
  assert.deepEqual([paid.kind, paid.url], ["pay", CHECKOUT_URL]);
  const form = formOf(calls.at(-1));
  assert.deepEqual(lineItems(form).at(-1), ["Child seats (2 x $15.00)", 3000, "1", "1 infant seat and 1 booster seat."]);
  assert.deepEqual([stripeTotal(form.toString()), form.get("metadata[total_cents]")], [21500, "21500"]);
  assert.deepEqual(seatMeta(form), { seats: "1 infant, 1 booster", seats_cents: "3000" });
  setEnv(LIVE);
  stripe = (url, init) => (url.endsWith("/expire") ? new Response("{}", { status: 200 }) : new Response(JSON.stringify({ id: "cs_test_a1B2c3D4e5F6g7H8i9J0", object: "checkout.session", url: CHECKOUT_URL, amount_total: stripeTotal(init.body) - 3000 }), { status: 200 }));
  const body = await readJson(await post({ ...fields, nonce: "nonce-seat-handler-000002" }), 502);
  assert.deepEqual([body.kind, body.code, "url" in body], ["error", "stripe", false]);
  assert.ok(calls.some((c) => c.url.endsWith("/expire")));
  assert.ok(logged.some((line) => line.startsWith("amount-mismatch 18500 21500 ")), logged.join(" | "));
});

await test("handler: the seat limit answers the child_seats error on options, quote and pay, and without JavaScript lands on its message, before any Stripe call", async () => {
  setEnv(LIVE);
  const want = { kind: "invalid", code: "child_seats", field: "child_seats", text: ERRORS.child_seats.text };
  for (const action of ["options", "quote", "pay"]) {
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, passengers: "2", toddler_seats: "3", action }), 422), want, action);
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, passengers: "2", infant_seats: "1", toddler_seats: "1", booster_seats: "1", action }), 422), want, action);
  }
  for (const bad of ["-1", "1.5", "two", "1e9"]) assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, booster_seats: bad }), 422), want, bad);
  assertRedirect(await formPost({ ...STRIPE_JFK, passengers: "1", infant_seats: "2" }), "/book#e-child_seats");
  assert.equal(calls.length, 0);
});

await test("handler: BOOK_MOCK pays an airport pickup with meet and greet, two child seats and a gratuity, with JavaScript and without, and GET rebuilds the confirmation with the seat line, the total and the value", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const fields = { ...trip(PICKUP), passengers: "3", toddler_seats: "1", booster_seats: "1", nonce: "nonce-seat-mock-00000001" };
  const body = await readJson(await post(fields), 200);
  const session = await readJson(await get(`cs_mock_${body.ref}`), 200);
  assert.deepEqual(session.lines, [{ label: "Fare", cents: 15500 }, { label: FEES, cents: 1725 }, { label: TOLLS_SHOWN, cents: 1275 }, { label: "Meet and greet", cents: 2500 }, { label: "Child seats (2 x $15.00)", cents: 3000 }, { label: "Gratuity for your chauffeur (15%)", cents: 2325 }]);
  assert.deepEqual([session.total_cents, session.value_cents], [26325, 21000]);
  const res = await formPost({ ...fields, nonce: "nonce-seat-mock-00000002" });
  assert.equal(res.status, 303);
  const id = new URL(res.headers.get("location"), LOCAL).searchParams.get("session_id");
  assert.match(id, /^cs_mock_[1-9]\d{7}$/);
  const form = await readJson(await get(id), 200);
  assert.deepEqual([form.lines.find((l) => l.label.startsWith("Child seats")), form.total_cents], [{ label: "Child seats (2 x $15.00)", cents: 3000 }, 26325]);
  assert.equal(calls.length, 0);
});

await test("handler: the dispatch quote path keeps the seats in the WhatsApp and email messages, for a trip outside the United States and a Luxury Sprinter for more than 12 hours", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const abroad = await readJson(await post({ ...trip({ trip_type: "one", from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, ON L2E 6T2", passengers: "2", class: "suv", ...ME, reach: "phone" }), infant_seats: "1", action: "options" }), 200);
  assert.equal(abroad.reason, "outside-us");
  for (const href of [abroad.whatsapp, abroad.mailto]) assert.ok(decodeURIComponent(href).includes("\nInfant seats: 1"), href);
  const sprinter = await readJson(await post({ ...trip(HOURLY), class: "sprinter", sprinter: "sprinter-limo", hours: "13", passengers: "4", booster_seats: "2", action: "quote" }), 200);
  assert.equal(sprinter.reason, "hours-range");
  assert.ok(decodeURIComponent(sprinter.whatsapp).includes("\nBooster seats: 2"), sprinter.whatsapp);
  assert.equal(calls.length, 0);
});

const DOG_FIELDS = { small_dogs: "1", large_dogs: "2" };
const DOG_ITEMS = [["Small dog (1 x $20.00)", 2000, "1", "Charged once per booking."], ["Large dog (2 x $45.00)", 9000, "1", "Charged once per booking."]];
const dogMetaOf = (form, prefix = "metadata") => Object.fromEntries([...SEAT_KEYS, "dogs"].filter((k) => form.has(`${prefix}[${k}]`)).map((k) => [k, form.get(`${prefix}[${k}]`)]));

await test("builder: pets on a one way airport pickup go to Stripe as one line item per size after the child seats and before the gratuity, with the count and the price per dog, the amount of the total, and one dogs key in both metadata maps, and nothing about dogs when none is chosen", async () => {
  setEnv();
  for (const [dogs, items, meta] of [
    [{}, [], {}],
    [{ small_dogs: "1" }, [DOG_ITEMS[0]], { dogs: "1 small 2000" }],
    [{ large_dogs: "1" }, [["Large dog (1 x $45.00)", 4500, "1", "Charged once per booking."]], { dogs: "1 large 4500" }],
    [DOG_FIELDS, DOG_ITEMS, { dogs: "1 small 2000, 2 large 9000" }],
    [{ small_dogs: "3", large_dogs: "3" }, [["Small dog (3 x $20.00)", 6000, "1", "Charged once per booking."], ["Large dog (3 x $45.00)", 13500, "1", "Charged once per booking."]], { dogs: "3 small 6000, 3 large 13500" }],
  ]) {
    const { params, price } = await build({ ...PICKUP, ...dogs }, ON, "nonce-dog-builder-0000001");
    const all = lineItems(params);
    const at = all.findIndex(([name]) => name === "Meet and greet");
    assert.deepEqual(all.slice(at + 1, -1), items, JSON.stringify(dogs));
    assert.equal(all.at(-1)[0], "Gratuity for your chauffeur (15%)");
    assert.equal(price.total, 23325 + items.reduce((sum, item) => sum + item[1], 0));
    assert.deepEqual([stripeTotal(params.toString()), params.get("metadata[total_cents]")], [price.total, String(price.total)]);
    assert.deepEqual(dogMetaOf(params), meta);
    assert.deepEqual(dogMetaOf(params, "payment_intent_data[metadata]"), meta);
    assert.equal(params.get("custom_text[submit][message]"), SUBMIT);
  }
  const both = await build({ ...PICKUP, passengers: "3", infant_seats: "1", booster_seats: "2", ...DOG_FIELDS }, ON, "nonce-dog-builder-0000002");
  assert.deepEqual(lineItems(both.params).slice(4, 7), [["Child seats (3 x $15.00)", 4500, "1", "1 infant seat and 2 booster seats."], ...DOG_ITEMS]);
  assert.deepEqual(dogMetaOf(both.params), { seats: "1 infant, 2 booster", seats_cents: "4500", dogs: "1 small 2000, 2 large 9000" }, "the seat counts per type share one seats key, with or without dogs");
  assert.deepEqual(receipt(Object.fromEntries([...both.params].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v])), ON).lines.slice(5, 8).map((l) => [l.label, l.cents]), [["Child seats (3 x $15.00)", 4500], ["Small dog (1 x $20.00)", 2000], ["Large dog (2 x $45.00)", 9000]]);
});

await test("builder: pets on a round trip and on an hourly booking are charged once for the booking, with the submit text that says the total shown is paid today, and the payment description names them after the seats", async () => {
  setEnv();
  for (const [fields, submit] of [[ROUND, SUBMIT], [HOURLY, SUBMIT_HOURLY]]) {
    const plain = await build(fields, ON, "nonce-dog-round-00000001");
    const { params, price } = await build({ ...fields, ...DOG_FIELDS }, ON, "nonce-dog-round-00000001");
    assert.equal(price.total - plain.price.total, 11000);
    assert.equal(stripeTotal(params.toString()), price.total);
    assert.equal(lineItems(params).filter(([name]) => /dog/.test(name)).length, 2);
    assert.equal(params.get("custom_text[submit][message]"), submit);
    assert.ok(submit.startsWith("You pay the total shown today"), submit);
  }
  for (const key of ["submit", "submitHourly", "submitDistance", "submitOutside", "submitReturnFlat", "submitOutFlat"]) assert.ok(CHECKOUT[key].startsWith("You pay the total shown today"), key);
  const seats = await build({ ...PICKUP, passengers: "3", toddler_seats: "1", ...DOG_FIELDS }, ON, "nonce-dog-describe-000001");
  assert.ok(seats.params.get("payment_intent_data[description]").includes(". 3 passengers. 1 child seat. 1 small dog and 2 large dogs. Meet and greet. Pickup "), seats.params.get("payment_intent_data[description]"));
  const large = await build({ ...PICKUP, large_dogs: "1" }, ON, "nonce-dog-describe-000002");
  assert.ok(large.params.get("payment_intent_data[description]").includes(". 2 passengers. 1 large dog. Meet and greet. Pickup "), large.params.get("payment_intent_data[description]"));
  const none = await build(PICKUP, ON, "nonce-dog-describe-000003");
  assert.ok(!/dog/.test(none.params.get("payment_intent_data[description]")));
});

await test("builder: the largest booking with stop fees and pets, two Manhattan stops, a return, both flights, meet and greet, someone else riding, notes, short notice, 12 child seats and 3 dogs of each size, writes at most 48 metadata keys, so the send-once marker of the booking emails still fits in Stripe's 50, and the receipt rebuilds every line from them", async () => {
  setEnv();
  process.env.GOOGLE_MOCK = "true";
  try {
    for (const stop2 of [{ stop2_text: "40 Wall St, New York, NY 10005" }, { stop2_text: "LaGuardia (LGA)", stop2_id: "lga" }]) {
      const fields = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", stop1_text: MANHATTAN, ...stop2, to_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-10-01", time: "13:20", return: "1", return_date: "2026-10-18", return_time: "18:00", flight: "DL 401", return_flight: "B6 1234", passengers: "12", class: "sprinter", meet: "1", tip: "custom", tip_amount: "40", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz family", notes: "Kids aged 1, 3 and 6", infant_seats: "4", toddler_seats: "4", booster_seats: "4", small_dogs: "3", large_dogs: "3" };
      const { params, price } = await build(fields, ON, "nonce-dog-largest-0000001", new Date("2026-10-01T16:00:00.000Z"));
      const keys = [...params.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
      assert.ok(keys.length <= 48, `${keys.length} keys`);
      assert.equal([...params.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).length, keys.length);
      assert.ok(keys.includes("dogs") && keys.includes("short_notice") && keys.includes("seats") && keys.includes("seats_cents") && params.get("metadata[zones]").includes(", stop2 "), keys.join(" "));
      assert.equal(params.get("metadata[dogs]"), "3 small 6000, 3 large 13500");
      assert.deepEqual([price.dogs, price.seats], [19500, 18000]);
      assert.equal(stripeTotal(params.toString()), price.total);
      const metadata = Object.fromEntries([...params].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
      const rebuilt = receipt(metadata, ON);
      assert.equal(rebuilt.lines.reduce((sum, l) => sum + l.cents, 0), price.total);
      assert.deepEqual(rebuilt.lines.filter((l) => /^(Child|Small|Large)/.test(l.label)).map((l) => [l.label, l.cents]), [["Child seats (12 x $15.00)", 18000], ["Small dog (3 x $20.00)", 6000], ["Large dog (3 x $45.00)", 13500]]);
    }
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

const OLD_KEYS = ["from_zone", "from_place", "to_zone", "to_place", "stop1_zone", "stop2_zone", "child_seats", "infant_seats", "toddler_seats", "booster_seats"];
const picked = (name, id, zone, text, at, region = "") => ({ [`${name}_text`]: text, [`${name}_ticket`]: signTicket(id, zone, text, at, 0, region) });
const worstFields = (at, date, time, returnDate) => ({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", ...picked("stop1", "ChIJb8Jg9pZYwokR-qHGtvSkLzs", "manhattan", "350 5th Ave, New York, NY 10118, USA", at), ...picked("stop2", "ChIJ-b2RmVlZwokRpb1pwEQjss0", "brooklyn", "277 Bedford Ave, Brooklyn, NY 11211, USA", at), ...picked("to", "ChIJ7cv00DwsDogRAMDACa2m4K8", "outside", "1 Old Country Rd, Mineola, NY 11501, USA", at, "2811"), date, time, return: "1", return_date: returnDate, return_time: "18:00", flight: "DL 401", return_flight: "B6 1234", passengers: "12", class: "sprinter", meet: "1", tip: "custom", tip_amount: "40", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz family", notes: "Kids aged 1, 3 and 6", infant_seats: "4", toddler_seats: "4", booster_seats: "4", small_dogs: "3", large_dogs: "3" });

await test("builder: the true worst case, every optional field filled from real form input, a round trip from JFK Terminal 4 with two stops and a drop-off picked from Google suggestions, priced by distance with stop fees and Nassau sales tax, a flight, meet and greet with a sign name, 12 child seats of every type, 3 dogs of each size, someone else riding, notes, a typed gratuity and short notice, writes 45 metadata keys, and every other shape, at the flat airport rate, to New Jersey, from an address to LaGuardia with a return flight, without dogs and by the hour, stays at most 48, so email_attempt and emailed_at always fit in Stripe's 50", async () => {
  setEnv();
  process.env.GOOGLE_MOCK = "true";
  try {
    const at = new Date("2026-10-01T16:00:00.000Z");
    const worst = worstFields(at, "2026-10-01", "13:20", "2026-10-18");
    const shapes = [
      ["the worst case", worst, "distance", 46],
      ["without dogs", { ...worst, small_dogs: "", large_dogs: "" }, "distance", 45],
      ["at the flat airport rate with stop fees", { ...worst, ...picked("stop2", "ChIJmanhattanWallStreet00000", "manhattan", "40 Wall St, New York, NY 10005, USA", at), ...picked("to", "ChIJ-b2RmVlZwokRpb1pwEQjss0", "brooklyn", "277 Bedford Ave, Brooklyn, NY 11211, USA", at) }, "airport", 44],
      ["to New Jersey with no New York sales tax", { ...worst, ...picked("to", "ChIJhobokenGardenStreet00000", "outside", "300 Garden St, Hoboken, NJ 07030, USA", at, "NJ") }, "distance", 46],
      ["from a picked address to LaGuardia with a return flight", { ...worst, from_id: "", ...picked("from", "ChIJb8Jg9pZYwokR-qHGtvSkLzs", "manhattan", "350 5th Ave, New York, NY 10118, USA", at), to_text: "LaGuardia (LGA)", to_id: "lga", to_ticket: "" }, "airport", 43],
      ["by the hour", { ...worst, trip_type: "hour", hours: "4", class: "premium", passengers: "5", infant_seats: "1", toddler_seats: "2", booster_seats: "2" }, "hourly", 36],
    ];
    const counts = [];
    for (const [name, fields, service, count] of shapes) {
      const { params, price, trip } = await build(fields, ON, "nonce-worst-case-00000001", at);
      const keys = [...params.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
      if (service !== "hourly") assert.deepEqual(trip.legs.map((l) => l.reason), trip.legs.map(() => ""), name);
      assert.deepEqual([price.service, keys.length], [service, count], `${name}: ${keys.join(" ")}`);
      assert.ok(keys.length <= 48, name);
      assert.deepEqual(keys.filter((k) => OLD_KEYS.includes(k)), [], name);
      assert.equal([...params.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).length, keys.length, name);
      assert.equal(stripeTotal(params.toString()), price.total, name);
      assert.deepEqual(shownLines(receipt(metadataOf(params), ON).lines), stripeItems(params), name);
      counts.push(keys.length);
    }
    assert.equal(Math.max(...counts), 46);
    const { params, price } = await build(worst, ON, "nonce-worst-case-00000001", at);
    const meta = metadataOf(params);
    assert.deepEqual(Object.keys(meta), "ref service direction airport class vehicle from_text to_text stop1_text stop2_text zones places date time pickup_at return_date return_time return_at passengers flight meet tip_percent legs miles minutes fare_cents tax_cents bcf_cents tolls_cents stops_cents meet_cents seats seats_cents dogs tip_cents total_cents rider name email phone reach passenger_name passenger_phone sign_name notes short_notice".split(" "));
    assert.deepEqual([meta.zones, meta.places, meta.seats, meta.dogs, meta.stops_cents, meta.short_notice], ["from jfk, stop1 manhattan, stop2 brooklyn, to outside", "from jfk-t4, to ChIJ7cv00DwsDogRAMDACa2m4K8", "4 toddler, 4 infant, 4 booster", "3 small 6000, 3 large 13500", "4000", "1"]);
    assert.deepEqual(bookingData(meta), { ...meta, from_zone: "jfk", stop1_zone: "manhattan", stop2_zone: "brooklyn", to_zone: "outside", from_place: "jfk-t4", to_place: "ChIJ7cv00DwsDogRAMDACa2m4K8", infant_seats: "4", toddler_seats: "4", booster_seats: "4", child_seats: "12" });
    assert.deepEqual(bookingData({ ...meta, seats: "4 infant, 4 toddler, 4 booster" }), { ...bookingData(meta), seats: "4 infant, 4 toddler, 4 booster" }, "a booking paid before the child seat came first reads the same");
    const description = params.get("payment_intent_data[description]");
    assert.ok(description.includes(`. Stop 1 "350 5th Ave, New York, NY 10118, USA". Stop 2 "277 Bedford Ave, Brooklyn, NY 11211, USA". Drop-off "1 Old Country Rd, Mineola, NY 11501, USA".`), description);
    assert.ok(description.includes(", Executive Sprinter, JFK to 1 Old Country Rd, return ") && description.includes(". 12 passengers. 4 child seats, 4 infant seats and 4 booster seats. 3 small dogs and 3 large dogs. Meet and greet. "), description);
    assert.equal(price.total, stripeTotal(params.toString()));
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("builder: the true worst case with the Google toll estimate on both rides adds only tolls_est_cents, 47 metadata keys, at most 48, the Tolls line holds both estimates and the receipt rebuilds the same lines", async () => {
  setEnv();
  process.env.GOOGLE_MOCK = "true";
  try {
    const at = new Date("2026-10-01T16:00:00.000Z");
    const worst = worstFields(at, "2026-10-01", "13:20", "2026-10-18");
    const row = localById("jfk-t4");
    const from = row.gid ? { placeId: row.gid } : { address: row.addr };
    const to = { placeId: "ChIJ7cv00DwsDogRAMDACa2m4K8" };
    const stops = [{ placeId: "ChIJb8Jg9pZYwokR-qHGtvSkLzs" }, { placeId: "ChIJ-b2RmVlZwokRpb1pwEQjss0" }];
    const route = signRoute([[routeKey(from, to, nycToUtc("2026-10-01", "13:20").toISOString(), stops), 168, 43, 1679], [routeKey(to, from, nycToUtc("2026-10-18", "18:00").toISOString()), 168, 43, 571]], at.getTime());
    const { params, price, trip } = await build({ ...worst, route }, ON, "nonce-worst-case-00000001", at);
    const keys = [...params.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
    assert.deepEqual([price.service, price.estimate, price.tolls, keys.length], ["distance", 2250, 2250, 47], keys.join(" "));
    assert.ok(keys.length <= 48);
    assert.deepEqual(trip.legs.map((l) => l.reason), ["", ""]);
    assert.equal(params.get("metadata[tolls_est_cents]"), "2250");
    assert.equal(params.get("payment_intent_data[metadata][tolls_est_cents]"), "2250");
    assert.equal([...params.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).length, keys.length);
    assert.ok(stripeItems(params).some(({ label, cents }) => label === "Tolls" && cents === 2250));
    assert.deepEqual(shownLines(receipt(metadataOf(params), ON).lines), stripeItems(params));
    assert.equal(stripeTotal(params.toString()), price.total);
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("builder: two long Google place ids share the places key only as whole parts, so a pickup and a drop-off with ids of 200 or 245 characters (exactly 500) keep both, and ids of 246, 260 or 300 characters keep the pickup id whole and leave the drop-off id out, and bookingData never returns a cut id", async () => {
  setEnv();
  process.env.GOOGLE_MOCK = "true";
  try {
    const at = new Date("2026-10-01T16:00:00.000Z");
    const FROM = "350 5th Ave, New York, NY 10118, USA";
    const TO = "1 Old Country Rd, Mineola, NY 11501, USA";
    for (const [n, both] of [[200, true], [245, true], [246, false], [260, false], [300, false]]) {
      const a = `Ei${"A".repeat(n - 2)}`;
      const b = `Ei${"B".repeat(n - 2)}`;
      const fields = { trip_type: "one", ...picked("from", a, "manhattan", FROM, at), ...picked("to", b, "outside", TO, at, "2811"), date: "2026-10-03", time: "13:20", passengers: "2", class: "suv", ...ME, reach: "phone", rider: "me" };
      assert.ok(fields.from_ticket && fields.to_ticket, `${n}: both tickets signed`);
      const { params, price, trip } = await build(fields, ON, "nonce-long-place-ids-0001", at);
      assert.deepEqual([trip.ends.from.place, trip.ends.to.place, price.service], [a, b, "distance"], `${n}`);
      const meta = metadataOf(params);
      const data = bookingData(meta);
      assert.equal(meta.places, both ? `from ${a}, to ${b}` : `from ${a}`, `${n}`);
      assert.ok(meta.places.length <= 500, `${n}: ${meta.places.length}`);
      assert.equal(params.get("payment_intent_data[metadata][places]"), meta.places, `${n}`);
      assert.deepEqual([data.from_place, data.to_place], [a, both ? b : undefined], `${n}`);
      assert.deepEqual(shownLines(receipt(meta, ON).lines), stripeItems(params), `${n}`);
    }
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("handler: the worst case sent as the booking form posts it, without JavaScript, reaches Stripe with 45 metadata keys on the session and the payment, at most 48, and none of the old keys", async () => {
  setEnv({ ...LIVE, GOOGLE_MOCK: "true" });
  const fields = { ...worstFields(Date.now(), SOON, "10:00", inDays(5)), nonce: "nonce-worst-form-00000001" };
  assertRedirect(await formPost(fields), CHECKOUT_URL);
  const form = formOf(calls.at(-1));
  const keys = [...form.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
  assert.deepEqual([keys.length, keys.includes("short_notice"), keys.filter((k) => OLD_KEYS.includes(k))], [45, false, []], keys.join(" "));
  assert.equal([...form.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).length, 45);
  assert.deepEqual([form.get("metadata[service]"), form.get("metadata[zones]"), form.get("metadata[places]"), form.get("metadata[seats]"), form.get("metadata[dogs]")], ["distance", "from jfk, stop1 manhattan, stop2 brooklyn, to outside", "from jfk-t4, to ChIJ7cv00DwsDogRAMDACa2m4K8", "4 toddler, 4 infant, 4 booster", "3 small 6000, 3 large 13500"]);
});

await test("handler: options and quote send the price per dog of each size from api/_rates.mjs, the class cards include the dogs, Stripe gets both dog line items and the amount, and the messages name the dogs", async () => {
  setEnv(LIVE);
  const fields = { ...STRIPE_JFK, ...DOG_FIELDS, nonce: "nonce-dog-handler-0000001" };
  const options = await readJson(await post({ ...fields, action: "options" }), 200);
  assert.deepEqual([options.small_dog_cents, options.large_dog_cents, options.seat_cents], [2000, 4500, 1500]);
  assert.deepEqual(options.classes.map((c) => c.total_cents), [29500, 33000, 42000, 28000, 29000, 56000]);
  assert.deepEqual(options.price.lines.slice(-2), [{ label: "Small dog (1 x $20.00)", cents: 2000 }, { label: "Large dog (2 x $45.00)", cents: 9000 }]);
  assert.equal(options.price.total_cents, 29500);
  const message = decodeURIComponent(options.whatsapp.split("?text=")[1]);
  assert.ok(message.includes("\nVehicle: Business SUV\nSmall dogs: 1\nLarge dogs: 2\nTotal shown: $295.00"), message);
  const quote = await readJson(await post({ ...fields, from_text: "806 6th Street, Secaucus, NJ", to_text: "Niagara Falls, ON L2E 6T2", to_id: "", action: "options" }), 200);
  assert.deepEqual([quote.kind, quote.reason, quote.small_dog_cents, quote.large_dog_cents], ["quote", "outside-us", 2000, 4500]);
  for (const href of [quote.whatsapp, quote.mailto]) assert.ok(decodeURIComponent(href).includes("\nSmall dogs: 1\nLarge dogs: 2"), href);
  const paid = await readJson(await post(fields), 200);
  assert.deepEqual([paid.kind, paid.url], ["pay", CHECKOUT_URL]);
  const form = formOf(calls.at(-1));
  assert.deepEqual(lineItems(form).slice(-2), DOG_ITEMS);
  assert.deepEqual([stripeTotal(form.toString()), form.get("metadata[total_cents]"), form.get("metadata[dogs]")], [29500, "29500", "1 small 2000, 2 large 9000"]);
});

await test("handler: the pet limit answers the dogs error on options, quote and pay, and without JavaScript lands on its message, before any Stripe call", async () => {
  setEnv(LIVE);
  const want = { kind: "invalid", code: "dogs", field: "dogs", text: ERRORS.dogs.text };
  for (const action of ["options", "quote", "pay"]) {
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, small_dogs: "4", action }), 422), want, action);
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, large_dogs: "9", action }), 422), want, action);
  }
  for (const bad of ["-1", "1.5", "two", "1e9"]) assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, large_dogs: bad }), 422), want, bad);
  assertRedirect(await formPost({ ...STRIPE_JFK, small_dogs: "4" }), "/book#e-dogs");
  assert.equal(calls.length, 0);
});

await test("handler: BOOK_MOCK pays an airport pickup with meet and greet, a child seat, a small and a large dog and a gratuity, with JavaScript and without, and GET rebuilds the confirmation with the dog lines, the total and the value", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const fields = { ...trip(PICKUP), passengers: "3", booster_seats: "1", small_dogs: "1", large_dogs: "1", nonce: "nonce-dog-mock-000000001" };
  const body = await readJson(await post(fields), 200);
  const session = await readJson(await get(`cs_mock_${body.ref}`), 200);
  assert.deepEqual(session.lines, [{ label: "Fare", cents: 15500 }, { label: FEES, cents: 1725 }, { label: TOLLS_SHOWN, cents: 1275 }, { label: "Meet and greet", cents: 2500 }, { label: "Child seats (1 x $15.00)", cents: 1500 }, { label: "Small dog (1 x $20.00)", cents: 2000 }, { label: "Large dog (1 x $45.00)", cents: 4500 }, { label: "Gratuity for your chauffeur (15%)", cents: 2325 }]);
  assert.deepEqual([session.total_cents, session.value_cents], [31325, 15500 + 2500 + 1500 + 6500]);
  const res = await formPost({ ...fields, nonce: "nonce-dog-mock-000000002" });
  assert.equal(res.status, 303);
  const id = new URL(res.headers.get("location"), LOCAL).searchParams.get("session_id");
  assert.match(id, /^cs_mock_[1-9]\d{7}$/);
  const form = await readJson(await get(id), 200);
  assert.deepEqual([form.lines.filter((l) => /dog/.test(l.label)), form.total_cents], [[{ label: "Small dog (1 x $20.00)", cents: 2000 }, { label: "Large dog (1 x $45.00)", cents: 4500 }], 31325]);
  assert.equal(calls.length, 0);
});

const ANN = "26 Ann St, New York, NY 10038";
const WALL = "40 Wall St, New York, NY 10005";
const CHURCH = "55 Church St, New York, NY 10007";
const LGA_ADDRESS = "LaGuardia Airport, East Elmhurst, NY 11371";

await test("handler: a stop that names only a borough on a trip priced over the whole route asks for the street address of each stop, by JSON and by form post, with no route lookup", async () => {
  setEnv({ ...LIVE, GOOGLE_MAPS_SERVER_KEY: "test-server-key-SENTINEL" });
  const sent = [];
  stripe = (url, init) => (url.startsWith("https://routes.googleapis.com/") ? (sent.push(url), new Response("{}", { status: 503 })) : STRIPE_OK(url, init));
  const fields = trip({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "Brooklyn", to_text: CHURCH, passengers: "2", class: "suv", ...ME, reach: "phone" });
  const body = await readJson(await post({ ...fields, action: "options" }), 200);
  assert.deepEqual([body.kind, body.reason, body.text, body.field, body.classes.every((c) => c.total_cents === null && c.reason === "stop-address")], ["quote", "stop-address", REASONS["stop-address"].google, "", true]);
  assertRedirect(await formPost(fields), "/book#q-stop-address");
  assert.deepEqual(sent, []);
});

await test("the Checkout texts say the total shown, stop fees included, is paid today wherever a stop fee can be charged, and the texts about charges after the ride name stops added during the ride, never extra stops", () => {
  for (const key of ["submit", "submitDistance", "submitOutside", "submitReturnFlat"]) assert.ok(CHECKOUT[key].startsWith("You pay the total shown today"), key);
  for (const text of [CHECKOUT.submit, CHECKOUT.terms, POLICY.later.airport, NOTES.airport]) assert.ok(text.includes("stops added during the ride") && !/extra stops/i.test(text), text);
});

await test("handler: when Google expects tolls but gives no price, the owner's trip from LaGuardia with stops at 26 Ann St and 40 Wall St to 55 Church St prices each class at the LaGuardia flat total plus two stop fees, or over the whole route by distance and time when that costs more than the flat total without its tolls plus the fees, pays the same total with its route token, Stripe gets the Extra stops line item and the stops_cents metadata, the receipt rebuilds its lines, the receipt check finds no mismatch, and a changed or reordered stop at pay can't reuse the signed route", async () => {
  setEnv({ ...LIVE, GOOGLE_MAPS_SERVER_KEY: "test-server-key-SENTINEL" });
  let down = false;
  const sent = [];
  stripe = (url, init) => {
    if (!url.startsWith("https://routes.googleapis.com/")) return STRIPE_OK(url, init);
    sent.push(JSON.parse(init.body));
    return down ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ routes: [{ duration: "4200s", distanceMeters: 32187, travelAdvisory: { tollInfo: {} } }] }), { status: 200 });
  };
  const stripeCalls = () => calls.filter((c) => c.url.startsWith("https://api.stripe.com"));
  const fields = trip({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: ANN, stop2_text: WALL, to_text: CHURCH, passengers: "2", class: "suv", ...ME, reach: "phone" });
  const options = await readJson(await post({ ...fields, action: "options", nonce: "nonce-stops-options-0001" }), 200);
  const totals = ["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => priceDistance(rateKey(cls), { tenths: 200, minutes: 70 }, "lga").total);
  assert.deepEqual(totals, [17835, 21781, 24781, 13335, 14225, 43725]);
  const flat = ["suv", "premium", "first", "sedan", "electric", "sprinter"].map((cls) => AIRPORT_TOTALS[rateKey(cls)].lga + 2 * STOP_FEE_CENTS);
  assert.deepEqual(flat, [20500, 23000, 29000, 18500, 19500, 49000]);
  assert.deepEqual([options.kind, options.service, options.legs, options.pay, options.hold, options.reason, options.meet, options.stop_cents], ["options", "airport", 1, true, "", "", true, STOP_FEE_CENTS]);
  assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents, c.reason]), [["suv", 20500, ""], ["premium", 21781, ""], ["first", 29000, ""], ["sedan", 18500, ""], ["electric", 19500, ""], ["sprinter", 49000, ""]]);
  assert.deepEqual(options.classes.map((c, i) => c.total_cents), totals.map((total, i) => (flat[i] - priceLeg(rateKey(["suv", "premium", "first", "sedan", "electric", "sprinter"][i]), "lga").tolls > total ? flat[i] : total)));
  assert.deepEqual(options.price, { lines: [{ label: "Fare", cents: 13701 }, { label: FEES, cents: 1524 }, { label: TOLLS_SHOWN, cents: 1275 }, { label: "Extra stops (2 x $20.00)", cents: 4000 }], total_cents: 20500, currency: "usd", notes: AIRPORT_NOTES });
  assert.deepEqual(options.ride, { kind: "ok", minutes: 70, miles: 20, attribution: "Google Maps" });
  assert.deepEqual(sent.map((body) => [body.origin, body.intermediates, body.destination]), [[{ address: LGA_ADDRESS }, [{ address: ANN }, { address: WALL }], { address: CHURCH }]]);
  assert.match(options.route, ROUTE);
  assert.match(decodeURIComponent(options.whatsapp.split("?text=")[1]), /\nStop 1: 26 Ann St, New York, NY 10038 \(Manhattan\)\nStop 2: 40 Wall St, New York, NY 10005 \(Manhattan\)\nDrop-off: 55 Church St[\s\S]*\nTotal shown: \$205\.00$/);
  down = true;
  const paid = await readJson(await post({ ...fields, route: options.route, nonce: "nonce-stops-pay-000001" }), 200);
  assert.deepEqual([paid.kind, paid.url, sent.length, stripeCalls().length], ["pay", CHECKOUT_URL, 1, 1]);
  const form = Object.fromEntries(formOf(stripeCalls()[0]));
  assert.deepEqual([0, 1, 2, 3].map((i) => [form[`line_items[${i}][price_data][product_data][name]`], form[`line_items[${i}][price_data][unit_amount]`], form[`line_items[${i}][quantity]`]]), [["Fare", "13701", "1"], [FEES, String(1216 + 308), "1"], [TOLLS_SHOWN, "1275", "1"], ["Extra stops (2 x $20.00)", "4000", "1"]]);
  assert.equal(form["line_items[4][quantity]"], undefined);
  assert.equal(stripeTotal(stripeCalls()[0].init.body), 20500);
  const metadata = Object.fromEntries(Object.entries(form).filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  assert.deepEqual(["service", "direction", "airport", "legs", "miles", "minutes", "zones", "stop1_text", "stop2_text", "fare_cents", "tolls_cents", "stops_cents", "total_cents"].map((key) => metadata[key]), ["airport", "from-airport", "lga", "1", undefined, undefined, "from lga, stop1 manhattan, stop2 manhattan, to manhattan", ANN, WALL, "13701", "1275", "4000", "20500"]);
  assert.deepEqual(Object.fromEntries(Object.entries(form).filter(([key]) => key.startsWith("payment_intent_data[metadata][stops_cents]"))), { "payment_intent_data[metadata][stops_cents]": "4000" });
  assert.deepEqual([form["custom_text[submit][message]"], form["custom_text[terms_of_service_acceptance][message]"]], [SUBMIT, TERMS]);
  assert.equal(form["line_items[0][price_data][product_data][description]"].split(". ")[0], "From LaGuardia (LGA), Business SUV");
  assert.ok(form["payment_intent_data[description]"].startsWith(`New booking ${form["metadata[ref]"]}: `), form["payment_intent_data[description]"]);
  assert.ok(form["payment_intent_data[description]"].endsWith(`, Business SUV, LaGuardia (LGA) to 55 Church St. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 2 passengers. Stop 1 "${ANN}". Stop 2 "${WALL}". Drop-off "${CHURCH}".`), form["payment_intent_data[description]"]);
  assert.match(form["payment_intent_data[statement_descriptor_suffix]"], /^LGA [A-Z]{3}\d\d$/);
  assert.deepEqual(receipt(metadata, ON), {
    summary: `${formatDate(SOON)}, 10:00 AM. From LaGuardia (LGA), Business SUV.`,
    lines: [{ label: "Fare", cents: 13701 }, { label: TAX, cents: 1216 }, { label: BCF, cents: 308 }, { label: TOLLS, cents: 1275 }, { label: "Extra stops (2 x $20.00)", cents: 4000 }],
    value: 13701 + 4000,
    notes: AIRPORT_NOTES,
  });
  assertRedirect(await formPost({ ...fields, route: options.route }), CHECKOUT_URL);
  assert.deepEqual([sent.length, stripeCalls().length, stripeTotal(stripeCalls()[1].init.body)], [1, 2, 20500]);
  const premium = await readJson(await post({ ...fields, class: "premium", route: options.route, nonce: "nonce-stops-premium-001" }), 200);
  const plus = Object.fromEntries(formOf(stripeCalls()[2]));
  assert.deepEqual([premium.kind, stripeTotal(stripeCalls()[2].init.body), plus["metadata[service]"], plus["metadata[stops_cents]"], plus["line_items[2][quantity]"]], ["pay", 21781, "distance", undefined, undefined], "the Business Premium SUV costs more over the whole route than its flat total without tolls plus the fees, so it has no stop fee");
  for (const [name, change] of [["changed", { stop1_text: "30 Ann St, New York, NY 10038" }], ["reordered", { stop1_text: WALL, stop2_text: ANN }], ["dropped", { stop2_text: "" }], ["added", { stop2_text: WALL, stop1_text: ANN, to_text: "1 Liberty St, New York, NY 10006" }]]) {
    const before = sent.length;
    const body = await readJson(await post({ ...fields, ...change, route: options.route, nonce: `nonce-stops-${name}-0001` }), 200);
    assert.deepEqual([body.kind, body.reason, body.text, "route" in body, body.classes.every((c) => c.total_cents === null && c.reason === "stop-leg"), sent.length, stripeCalls().length], ["quote", "stop-leg", REASONS["stop-leg"].text, false, true, before + 1, 3], name);
    assertRedirect(await formPost({ ...fields, ...change, route: options.route }), "/book#q-stop-leg");
  }
  assert.deepEqual([8000 + 200 * 90 + 70 * 145, AIRPORT_FARES["sprinter-executive"].lga], [36150, 39348]);
  const looked = sent.length;
  const sprinter = await readJson(await post({ ...fields, class: "sprinter", route: options.route, nonce: "nonce-stops-sprinter-001" }), 200);
  assert.deepEqual([sprinter.kind, sprinter.url, sent.length, stripeCalls().length], ["pay", CHECKOUT_URL, looked, 4]);
  const van = Object.fromEntries(formOf(stripeCalls()[3]));
  assert.deepEqual([0, 1, 2, 3].map((i) => [van[`line_items[${i}][price_data][product_data][name]`], van[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", String(AIRPORT_FARES["sprinter-executive"].lga)], [FEES, String(3492 + 885)], [TOLLS_SHOWN, "1275"], ["Extra stops (2 x $20.00)", "4000"]], "the Luxury Sprinter costs more by the LaGuardia flat total without tolls plus the fees than over the whole route, so it pays the flat total and the fees");
  assert.deepEqual([van["line_items[4][quantity]"], van["metadata[class]"], van["metadata[service]"], van["metadata[stop2_text]"], van["metadata[stops_cents]"], van["metadata[total_cents]"], stripeTotal(stripeCalls()[3].init.body)], [undefined, "sprinter", "airport", WALL, "4000", "49000", AIRPORT_TOTALS["sprinter-executive"].lga + 2 * STOP_FEE_CENTS]);
  assertRedirect(await formPost({ ...fields, class: "sprinter", route: options.route }), CHECKOUT_URL);
  assert.equal(stripeCalls().length, 5);
});

await test("handler: an address to address trip with a stop a few blocks off the way pays the ride without the stop plus the stop fee, the booking page caption, the Stripe line item description, the metadata and the receipt summary all give the miles and minutes of the whole route the car drives, and the payment description reads like the owner's booking email subject with every address", async () => {
  setEnv({ ...LIVE, GOOGLE_MAPS_SERVER_KEY: "test-server-key-SENTINEL" });
  stripe = (url, init) => {
    if (!url.startsWith("https://routes.googleapis.com/")) return STRIPE_OK(url, init);
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ routes: [body.intermediates.length ? { duration: "3480s", distanceMeters: 51499 } : { duration: "3120s", distanceMeters: 50533 }] }), { status: 200 });
  };
  const fields = trip({ trip_type: "one", from_text: MANHATTAN, stop1_text: "200 Park Ave, New York, NY 10166", to_text: "Greenwich, CT 06830", passengers: "2", class: "suv", ...ME, reach: "phone" });
  const fee = priceRide("suv", { tenths: 314, minutes: 52 }, [], "0").total + STOP_FEE_CENTS;
  assert.equal(fee, 19877 + STOP_FEE_CENTS, "Manhattan to Greenwich, Connecticut, has no New York sales tax");
  assert.ok(fee > priceRide("suv", { tenths: 320, minutes: 58 }, [], "0").total);
  const options = await readJson(await post({ ...fields, action: "options", nonce: "nonce-stop-caption-0001" }), 200);
  assert.deepEqual([options.price.total_cents, options.price.lines.at(-1), options.ride.miles, options.ride.minutes], [fee, { label: "Extra stop", cents: STOP_FEE_CENTS }, 32, 58]);
  const paid = await readJson(await post({ ...fields, route: options.route, nonce: "nonce-stop-caption-0002" }), 200);
  assert.equal(paid.kind, "pay");
  const form = Object.fromEntries(formOf(calls.filter((c) => c.url.startsWith("https://api.stripe.com")).at(-1)));
  const service = "Business SUV, 32.0 miles and 58 min";
  assert.equal(form["line_items[0][price_data][product_data][description]"].split(". ")[0], service);
  const metadata = Object.fromEntries(Object.entries(form).filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
  assert.ok(ownerSubject(metadata, metadata.ref).endsWith(", Business SUV, 350 5th Ave to Greenwich"), ownerSubject(metadata, metadata.ref));
  assert.equal(form["payment_intent_data[description]"], `${ownerSubject(metadata, metadata.ref)}. Customer Ana Lopez. Phone +1 212 555 0100. Email ana.lopez@example.com. 2 passengers. Pickup "${MANHATTAN}". Stop 1 "200 Park Ave, New York, NY 10166". Drop-off "Greenwich, CT 06830".`);
  assert.deepEqual(["service", "miles", "minutes", "stops_cents", "total_cents"].map((key) => metadata[key]), ["distance", "32.0", "58", "2000", String(fee)]);
  assert.equal(receipt(metadata, ON).summary, `${formatDate(SOON)}, 10:00 AM. ${service}.`);
  assert.deepEqual([Number(metadata.miles), Number(metadata.minutes)], [options.ride.miles, options.ride.minutes], "the receipt and the booking page caption agree");
});

await test("builder: a round trip with a stop, LaGuardia to 26 Ann St then 55 Church St and back to LaGuardia, sends Stripe two flat airport totals with their tolls line and the Extra stop line, and with a far stop the whole route ride by distance and the flat return with its tolls line, says which tolls are paid today, and the receipt rebuilds the same lines and notes", async () => {
  process.env.GOOGLE_MOCK = "true";
  try {
    const fields = { trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: ANN, to_text: CHURCH, date: "2026-10-14", time: "09:00", passengers: "2", class: "suv", return: "1", return_date: "2026-10-18", return_time: "18:00", rider: "me", ...ME, reach: "phone" };
    const built = await build(fields, ON, "nonce-stops-round-00001");
    const out = priceDistance("suv", { tenths: 168, minutes: 43 }, "lga");
    const home = priceLeg("suv", "lga");
    assert.deepEqual([out.total, home.total, home.total - home.tolls + STOP_FEE_CENTS > out.total], [15225, 16500, true]);
    const form = Object.fromEntries(built.params);
    const service = "Business SUV, 2 airport transfers";
    assert.deepEqual([0, 1, 2, 3].map((i) => [form[`line_items[${i}][price_data][product_data][name]`], form[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", String(2 * home.fare)], [FEES, String(2 * home.tax + 2 * home.bcf)], [TOLLS_SHOWN, String(2 * home.tolls)], ["Extra stop", "2000"]]);
    assert.deepEqual([form["line_items[4][quantity]"], stripeTotal(built.params.toString()), form["custom_text[submit][message]"]], [undefined, 2 * home.total + STOP_FEE_CENTS, SUBMIT]);
    assert.equal(form["line_items[0][price_data][product_data][description]"], `${service}. Reference ${built.ref}. Wed, Oct 14, 2026, 9:00 AM. Return Sun, Oct 18, 2026, 6:00 PM. 2 passengers. Extra waiting is $1.50 a minute.`);
    const metadata = metadataFor(built.trip, built.price, built.ref);
    assert.deepEqual(["service", "legs", "miles", "minutes", "fare_cents", "tax_cents", "bcf_cents", "tolls_cents", "stops_cents", "total_cents", "stop1_text"].map((key) => metadata[key]), ["airport", "2", undefined, undefined, "27402", "2432", "616", "2550", "2000", "35000", ANN]);
    assert.deepEqual(receipt(metadata, ON), {
      summary: `Wed, Oct 14, 2026, 9:00 AM. Return Sun, Oct 18, 2026, 6:00 PM. ${service}.`,
      lines: [{ label: "Fare", cents: 27402 }, { label: TAX, cents: 2432 }, { label: BCF, cents: 616 }, { label: TOLLS, cents: 2550 }, { label: "Extra stop", cents: 2000 }],
      value: 27402 + 2000,
      notes: AIRPORT_NOTES,
    });
    const whole = routeKey({ address: LGA_ADDRESS }, { address: CHURCH }, nycToUtc("2026-10-14", "09:00").toISOString(), [{ address: ANN }]);
    const far = await build({ ...fields, route: signRoute([[whole, 250, 70]], NOW) }, ON, "nonce-stops-round-00002");
    const ride = priceDistance("suv", { tenths: 250, minutes: 70 }, "lga");
    assert.ok(ride.total > home.total + STOP_FEE_CENTS);
    const farForm = Object.fromEntries(far.params);
    const farService = "Business SUV, 25.0 miles and 70 min, return at the flat airport rate";
    assert.deepEqual([0, 1, 2].map((i) => [farForm[`line_items[${i}][price_data][product_data][name]`], farForm[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", String(ride.fare + home.fare)], [FEES, String(ride.tax + home.tax + ride.bcf + home.bcf)], [TOLLS_SHOWN, String(home.tolls)]]);
    assert.deepEqual([farForm["line_items[3][quantity]"], stripeTotal(far.params.toString()), farForm["custom_text[submit][message]"]], [undefined, ride.total + home.total, CHECKOUT.submitReturnFlat]);
    assert.equal(CHECKOUT.submitReturnFlat, "You pay the total shown today, including tolls and airport fees for the return. Extra waiting, tolls for the ride out and parking are charged to this card after the ride, with a receipt.");
    assert.ok(farForm["line_items[0][price_data][product_data][description]"].startsWith(`${farService}. Reference ${far.ref}.`));
    const farMeta = metadataFor(far.trip, far.price, far.ref);
    assert.deepEqual(["service", "legs", "miles", "minutes", "tolls_cents", "stops_cents", "total_cents"].map((key) => farMeta[key]), ["distance", "2", "25.0", "70", "1275", undefined, String(ride.total + home.total)]);
    assert.deepEqual(receipt(farMeta, ON), {
      summary: `Wed, Oct 14, 2026, 9:00 AM. Return Sun, Oct 18, 2026, 6:00 PM. ${farService}.`,
      lines: [{ label: "Fare", cents: ride.fare + home.fare }, { label: TAX, cents: ride.tax + home.tax }, { label: BCF, cents: ride.bcf + home.bcf }, { label: TOLLS, cents: home.tolls }],
      value: ride.fare + home.fare,
      notes: [NOTES.returnFlat, POLICY.later.returnFlat],
    });
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("builder: a round trip from 350 5th Ave by a JFK stop to 277 Bedford Ave takes the stop rule for the ride out, priced over its whole route at no less than the JFK fare with no tolls line, prices the return by distance, says tolls come after the ride, and the receipt rebuilds the same lines and notes", async () => {
  process.env.GOOGLE_MOCK = "true";
  try {
    const fields = { trip_type: "one", from_text: MANHATTAN, stop1_text: "John F. Kennedy (JFK)", stop1_id: "jfk", to_text: "277 Bedford Ave, Brooklyn, NY 11211", date: "2026-10-14", time: "09:00", passengers: "2", class: "suv", return: "1", return_date: "2026-10-18", return_time: "18:00", rider: "me", ...ME, reach: "phone" };
    const built = await build(fields, ON, "nonce-stops-turn-000001");
    const out = priceDistance("suv", { tenths: 168, minutes: 43 }, "jfk");
    const back = priceDistance("suv", { tenths: 48, minutes: 31 });
    const form = Object.fromEntries(built.params);
    const service = "Business SUV, 2 rides, 21.6 miles and 74 min";
    assert.deepEqual([out.fare, out.total, out.total + back.total], [AIRPORT_FARES.suv.jfk, 17225, 29449]);
    assert.deepEqual([0, 1].map((i) => [form[`line_items[${i}][price_data][product_data][name]`], form[`line_items[${i}][price_data][unit_amount]`]]), [["Fare", "26500"], [FEES, "2949"]]);
    assert.deepEqual([form["line_items[2][quantity]"], stripeTotal(built.params.toString()), form["custom_text[submit][message]"]], [undefined, 29449, SUBMIT_OUTSIDE]);
    assert.equal(CHECKOUT.submitOutFlat, "You pay the total shown today, including tolls and airport fees for the ride out. Extra waiting, tolls for the return and parking are charged to this card after the ride, with a receipt.");
    assert.ok(form["line_items[0][price_data][product_data][description]"].startsWith(`${service}. Reference ${built.ref}.`));
    assert.match(form["payment_intent_data[statement_descriptor_suffix]"], /^RIDE OCT14$/);
    const metadata = metadataFor(built.trip, built.price, built.ref);
    assert.deepEqual(["service", "legs", "miles", "minutes", "tolls_cents", "stops_cents", "total_cents"].map((key) => metadata[key]), ["distance", "2", "21.6", "74", "0", undefined, "29449"]);
    assert.deepEqual(receipt(metadata, ON), {
      summary: `Wed, Oct 14, 2026, 9:00 AM. Return Sun, Oct 18, 2026, 6:00 PM. ${service}.`,
      lines: [{ label: "Fare", cents: out.fare + back.fare }, { label: TAX, cents: out.tax + back.tax }, { label: BCF, cents: out.bcf + back.bcf }],
      value: out.fare + back.fare,
      notes: [OUTSIDE_NOTE],
    });
    const past = await build({ ...fields, return: "", to_text: "1 Hudson Pl, Hoboken, NJ 07030" }, ON, "nonce-stops-past-000001");
    const pastForm = Object.fromEntries(past.params);
    assert.deepEqual([past.price.fare, pastForm["custom_text[submit][message]"]], [AIRPORT_FARES.suv.jfk, SUBMIT_OUTSIDE]);
    const pastMeta = metadataFor(past.trip, past.price, past.ref);
    assert.deepEqual(["service", "airport", "direction", "legs", "tolls_cents"].map((key) => pastMeta[key]), ["distance", "jfk", undefined, "1", "0"]);
    assert.deepEqual(receipt(pastMeta, ON).notes, [OUTSIDE_NOTE]);
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
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

const BAG_FIELDS = { large_bags: "4", medium_bags: "3", small_bags: "2" };
const MARKERS = ["emailed_at", "email_attempt", "reminded"];

await test("builder: bags ride to Stripe in the passengers value of both metadata maps, after the passenger count in the fare line and the payment description, with no line item, no amount and no new key, and the receipt rebuilt from the metadata is the receipt without them", async () => {
  setEnv();
  const plain = await build(PICKUP, ON, "nonce-bag-builder-0000001");
  for (const [bags, packed, said] of [
    [BAG_FIELDS, "2, 4 large bags, 3 medium bags, 2 small bags", "4 large suitcases, 3 medium suitcases and 2 small suitcases or hand carry"],
    [{ large_bags: "4", small_bags: "2" }, "2, 4 large bags, 2 small bags", "4 large suitcases and 2 small suitcases or hand carry"],
    [{ large_bags: "1" }, "2, 1 large bag", "1 large suitcase"],
    [{ medium_bags: "1" }, "2, 1 medium bag", "1 medium suitcase"],
    [{ small_bags: "1" }, "2, 1 small bag", "1 small suitcase or hand carry"],
    [{ large_bags: "14", medium_bags: "14", small_bags: "14" }, "2, 14 large bags, 14 medium bags, 14 small bags", "14 large suitcases, 14 medium suitcases and 14 small suitcases or hand carry"],
  ]) {
    const { params, price } = await build({ ...PICKUP, ...bags }, ON, "nonce-bag-builder-0000001");
    assert.deepEqual([params.get("metadata[passengers]"), params.get("payment_intent_data[metadata][passengers]")], [packed, packed], JSON.stringify(bags));
    assert.deepEqual([...params.keys()].filter((k) => k.startsWith("metadata[")), [...plain.params.keys()].filter((k) => k.startsWith("metadata[")), "no new metadata key");
    assert.deepEqual([...params.keys()].filter((k) => !/description\]$|metadata\]\[passengers\]$|^metadata\[passengers\]$/.test(k)).map((k) => [k, params.get(k)]), [...plain.params.keys()].filter((k) => !/description\]$|metadata\]\[passengers\]$|^metadata\[passengers\]$/.test(k)).map((k) => [k, plain.params.get(k)]), "everything else is the booking without bags");
    assert.deepEqual([price.total, stripeTotal(params.toString()), lineItems(params).length], [plain.price.total, plain.price.total, lineItems(plain.params).length]);
    assert.ok(!lineItems(params).some(([name]) => /bag/i.test(name)));
    const intent = params.get("payment_intent_data[description]");
    assert.ok(intent.includes(`. 2 passengers. ${said}. Meet and greet. Pickup `), intent);
    assert.ok(intent.startsWith(ownerSubject(metadataOf(params), plain.ref)), "the payment description keeps the owner subject format");
    assert.equal(params.get("line_items[0][price_data][product_data][description]"), plain.params.get("line_items[0][price_data][product_data][description]").replace(" Extra waiting is $1.50 a minute.", ` ${said}. Extra waiting is $1.50 a minute.`));
    const meta = metadataOf(params);
    assert.deepEqual(shownLines(receipt(meta, ON).lines), stripeItems(params));
    assert.deepEqual(receipt(meta, ON), receipt(metadataOf(plain.params), ON));
    assert.equal(bookingData(meta).passengers, "2");
  }
  assert.equal(plain.params.get("metadata[passengers]"), "2");
  assert.ok(!/bag|suitcase/.test(plain.params.get("payment_intent_data[description]")) && !/bag|suitcase/.test(plain.params.get("line_items[0][price_data][product_data][description]")));
  const seats = await build({ ...PICKUP, passengers: "3", toddler_seats: "1", ...DOG_FIELDS, ...BAG_FIELDS }, ON, "nonce-bag-describe-000001");
  assert.ok(seats.params.get("payment_intent_data[description]").includes(". 3 passengers. 4 large suitcases, 3 medium suitcases and 2 small suitcases or hand carry. 1 child seat. 1 small dog and 2 large dogs. Meet and greet. Pickup "), seats.params.get("payment_intent_data[description]"));
  const hourly = await build({ ...HOURLY, ...BAG_FIELDS }, ON, "nonce-bag-describe-000002");
  assert.deepEqual([hourly.params.get("metadata[passengers]"), hourly.params.get("line_items[0][price_data][product_data][description]").endsWith(". 1 passenger. 4 large suitcases, 3 medium suitcases and 2 small suitcases or hand carry.")], ["1, 4 large bags, 3 medium bags, 2 small bags", true]);
});

await test("builder: the true worst case with 14 large, 14 medium and 14 small bags, the Google toll estimate on both rides and every other optional field still writes 47 metadata keys, the keys of the worst case without bags, so with the email, calendar and ride reminder markers it stays within Stripe's 50, and every other shape with bags stays at most 48", async () => {
  setEnv();
  process.env.GOOGLE_MOCK = "true";
  try {
    const at = new Date("2026-10-01T16:00:00.000Z");
    const worst = { ...worstFields(at, "2026-10-01", "13:20", "2026-10-18"), large_bags: "14", medium_bags: "14", small_bags: "14" };
    const row = localById("jfk-t4");
    const from = row.gid ? { placeId: row.gid } : { address: row.addr };
    const to = { placeId: "ChIJ7cv00DwsDogRAMDACa2m4K8" };
    const stops = [{ placeId: "ChIJb8Jg9pZYwokR-qHGtvSkLzs" }, { placeId: "ChIJ-b2RmVlZwokRpb1pwEQjss0" }];
    const route = signRoute([[routeKey(from, to, nycToUtc("2026-10-01", "13:20").toISOString(), stops), 168, 43, 1679], [routeKey(to, from, nycToUtc("2026-10-18", "18:00").toISOString()), 168, 43, 571]], at.getTime());
    const keysOf = (params) => [...params.keys()].filter((k) => k.startsWith("metadata[")).map((k) => k.slice(9, -1));
    const bagged = await build({ ...worst, route }, ON, "nonce-worst-case-00000001", at);
    const bare = await build({ ...worst, route, large_bags: "", medium_bags: "", small_bags: "" }, ON, "nonce-worst-case-00000001", at);
    assert.deepEqual([keysOf(bagged.params).length, keysOf(bagged.params)], [47, keysOf(bare.params)]);
    assert.ok(keysOf(bagged.params).length <= 48);
    assert.deepEqual(MARKERS.filter((k) => keysOf(bagged.params).includes(k)), []);
    assert.ok(keysOf(bagged.params).length + MARKERS.length <= 50, "the booking keys and every marker the site writes fit in Stripe's 50");
    assert.equal([...bagged.params.keys()].filter((k) => k.startsWith("payment_intent_data[metadata][")).length, 47);
    assert.equal(bagged.params.get("metadata[passengers]"), "12, 14 large bags, 14 medium bags, 14 small bags");
    assert.ok(bagged.params.get("metadata[passengers]").length <= 500);
    assert.deepEqual(shownLines(receipt(metadataOf(bagged.params), ON).lines), stripeItems(bagged.params));
    assert.equal(stripeTotal(bagged.params.toString()), bare.price.total);
    const description = bagged.params.get("payment_intent_data[description]");
    assert.ok(description.length <= 1000 && description.includes(". 12 passengers. 14 large suitcases, 14 medium suitcases and 14 small suitcases or hand carry. 4 child seats, 4 infant seats and 4 booster seats. 3 small dogs and 3 large dogs. Meet and greet. "), description);
    for (const [name, fields, count] of [
      ["at the flat airport rate with stop fees", { ...worst, ...picked("stop2", "ChIJmanhattanWallStreet00000", "manhattan", "40 Wall St, New York, NY 10005, USA", at), ...picked("to", "ChIJ-b2RmVlZwokRpb1pwEQjss0", "brooklyn", "277 Bedford Ave, Brooklyn, NY 11211, USA", at) }, 44],
      ["to New Jersey", { ...worst, ...picked("to", "ChIJhobokenGardenStreet00000", "outside", "300 Garden St, Hoboken, NJ 07030, USA", at, "NJ") }, 46],
      ["by the hour", { ...worst, trip_type: "hour", hours: "4", class: "premium", passengers: "5", infant_seats: "1", toddler_seats: "2", booster_seats: "2" }, 36],
    ]) {
      const { params } = await build(fields, ON, "nonce-worst-case-00000001", at);
      assert.equal(keysOf(params).length, count, name);
      assert.ok(keysOf(params).length <= 48 && keysOf(params).length + MARKERS.length <= 50, name);
      assert.ok(/ 14 large bags, 14 medium bags, 14 small bags$/.test(params.get("metadata[passengers]")), name);
    }
  } finally {
    delete process.env.GOOGLE_MOCK;
  }
});

await test("handler: options, quote and pay send the bags to the server, which keeps them on the trip, puts them in the WhatsApp and email messages right after the passengers and in the Stripe metadata, changes no price, and pays with JavaScript and without", async () => {
  setEnv(LIVE);
  const fields = { ...STRIPE_JFK, passengers: "3", ...BAG_FIELDS, nonce: "nonce-bag-handler-0000001" };
  const options = await readJson(await post({ ...fields, action: "options" }), 200);
  const bare = await readJson(await post({ ...STRIPE_JFK, passengers: "3", nonce: "nonce-bag-handler-0000001", action: "options" }), 200);
  assert.deepEqual([options.classes, options.price], [bare.classes, bare.price]);
  const message = decodeURIComponent(options.whatsapp.split("?text=")[1]);
  assert.ok(message.includes("\nPassengers: 3\nLarge suitcase: 4\nMedium suitcase: 3\nSmall suitcase or hand carry: 2\nVehicle: Business SUV\n"), message);
  assert.ok(decodeURIComponent(options.mailto).includes("\nPassengers: 3\nLarge suitcase: 4\nMedium suitcase: 3\nSmall suitcase or hand carry: 2\n"));
  const paid = await readJson(await post(fields), 200);
  assert.deepEqual([paid.kind, paid.url], ["pay", CHECKOUT_URL]);
  const form = formOf(calls.at(-1));
  assert.deepEqual([form.get("metadata[passengers]"), form.get("payment_intent_data[metadata][passengers]")], ["3, 4 large bags, 3 medium bags, 2 small bags", "3, 4 large bags, 3 medium bags, 2 small bags"]);
  assert.equal(stripeTotal(form.toString()), bare.price.total_cents);
  const nojs = await formPost({ ...fields, nonce: "nonce-bag-handler-0000002" });
  assert.equal(nojs.status, 303);
  assert.equal(formOf(calls.at(-1)).get("metadata[passengers]"), "3, 4 large bags, 3 medium bags, 2 small bags");
});

await test("handler: the bag limit answers the bags error on options, quote and pay, and without JavaScript lands on its message, before any Stripe call", async () => {
  setEnv(LIVE);
  const want = { kind: "invalid", code: "bags", field: "bags", text: ERRORS.bags.text };
  for (const action of ["options", "quote", "pay"]) {
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, large_bags: "15", action }), 422), want, action);
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, medium_bags: "15", action }), 422), want, action);
    assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, small_bags: "15", action }), 422), want, action);
  }
  for (const bad of ["-1", "1.5", "two", "1e9"]) assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, large_bags: bad }), 422), want, bad);
  for (const bad of ["-1", "15", "two"]) assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, medium_bags: bad }), 422), want, `medium ${bad}`);
  assertRedirect(await formPost({ ...STRIPE_JFK, small_bags: "99" }), "/book#e-bags");
  assert.equal(calls.length, 0);
});

await test("handler: BOOK_MOCK pays an airport pickup with bags, with JavaScript and without, and GET rebuilds the confirmation with the same lines, total and value as without them", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const fields = { ...trip(PICKUP), ...BAG_FIELDS, nonce: "nonce-bag-mock-000000001" };
  const body = await readJson(await post(fields), 200);
  const session = await readJson(await get(`cs_mock_${body.ref}`), 200);
  const plainBody = await readJson(await post({ ...trip(PICKUP), nonce: "nonce-bag-mock-000000003" }), 200);
  const plain = await readJson(await get(`cs_mock_${plainBody.ref}`), 200);
  assert.deepEqual([session.lines, session.total_cents, session.value_cents, session.summary], [plain.lines, plain.total_cents, plain.value_cents, plain.summary]);
  const res = await formPost({ ...fields, nonce: "nonce-bag-mock-000000002" });
  assert.equal(res.status, 303);
  const id = new URL(res.headers.get("location"), LOCAL).searchParams.get("session_id");
  assert.deepEqual((await readJson(await get(id), 200)).total_cents, plain.total_cents);
  assert.equal(calls.length, 0);
});

await test("builder: the Stripe fare line of every class gives that class's extra waiting price per minute from WAIT_CENTS_PER_MINUTE, as its last sentence, with nothing about waiting in the metadata, and an hourly booking gives none", async () => {
  const base = await build(DROPOFF, ON, "nonce-wait-rate-base-00001");
  for (const cls of Object.keys(CLASSES)) {
    const { params } = await build({ ...DROPOFF, class: cls, passengers: "2" }, ON, `nonce-wait-rate-${cls}`.padEnd(26, "0"));
    const description = params.get("line_items[0][price_data][product_data][description]");
    const price = `$${(WAIT_CENTS_PER_MINUTE[cls] / 100).toFixed(2)}`;
    assert.ok(description.endsWith(` Extra waiting is ${price} a minute.`), `${cls}: ${description}`);
    assert.equal(description.split("Extra waiting").length, 2, description);
    assert.deepEqual([...params].filter(([k, v]) => /metadata/.test(k) && /waiting|a minute/i.test(`${k} ${v}`)), []);
  }
  const hourly = await build(HOURLY, ON, "nonce-wait-rate-hourly-001");
  assert.doesNotMatch(hourly.params.get("line_items[0][price_data][product_data][description]"), /Extra waiting|a minute/);
  assert.equal(base.params.get("custom_text[terms_of_service_acceptance][message]"), CHECKOUT.terms);
  assert.ok(CHECKOUT.terms.includes(`[${POLICY.link.toLowerCase()}](https://www.nycluxride.com/rates#policies)`), CHECKOUT.terms);
});

server.child.kill();

if (failures) {
  process.stderr.write(`\n${failures} test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll book-params tests passed\n");
process.exit(0);
