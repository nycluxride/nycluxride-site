import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readInput, readSettings, priceTrip, bookingRef, composeMessage, contactLinks, formatDate } from "../api/_trip.mjs";
import { sessionParams, encodeForm, metadataFor } from "../api/_stripe.mjs";
import { POST, GET } from "../api/book.mjs";
import { CHECKOUT, ERRORS, HEADINGS, REASONS, ERROR_BLOCK, NOTES } from "../api/_copy.mjs";
import { DESCRIPTOR_PREFIX, DESCRIPTOR_CODES, AIRPORT_PLACES, CHECKOUT_ORIGINS, CONSENT_TERMS_LIVE } from "../api/_rates.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const NOW = new Date("2026-10-01T16:00:00.000Z");
const SITE = "https://www.nycluxride.com";
const LOCAL = "http://127.0.0.1:4173";
const PREVIEW = "https://nycluxride-git-stripe-nlr.vercel.app";
const KEY = ["rk", "test", "51NlrFakeKeyUsedOnlyInTests"].join("_");
const LIVE_KEY = ["rk", "live", "51NlrFakeKeyUsedOnlyInTests"].join("_");
const ADDRESS = "350 Fifth Avenue";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5F6g7H8i9J0";
const ENV_KEYS = ["STRIPE_SECRET_KEY", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT", "BOOK_MOCK", "VERCEL_ENV"];
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const TAXED = readSettings({ PAYMENTS_ENABLED: "true", SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000", SALES_TAX_PERCENT: "8.875" });

const PICKUP = { trip_type: "one", from: "jfk", to: "manhattan", to_address: ADDRESS, date: "2026-10-14", time: "07:30", passengers: "2", class: "suv", meet: "1", flight: "DL 401" };
const DROPOFF = { trip_type: "one", from: "manhattan", from_address: ADDRESS, to: "jfk", date: "2026-10-14", time: "07:30", passengers: "2", class: "suv" };
const HOURLY = { trip_type: "hour", from: "brooklyn", from_address: "1 Main Street", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", vehicle: "suv-escalade" };
const TAXED_LGA = { trip_type: "one", from: "lga", to: "queens", to_address: "Astoria Park", date: "2026-11-05", time: "18:45", passengers: "3", class: "suv", meet: "1" };

function build(fields, settings, nonce, now = NOW, origin = SITE) {
  const trip = readInput(fields);
  const price = priceTrip(trip, settings);
  const ref = bookingRef(nonce);
  return { trip, price, ref, params: sessionParams(trip, price, ref, settings, now, origin) };
}

function common(ref, { taxed = false, meet = false } = {}) {
  const fields = {
    "custom_fields[0][key]": "passenger",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Passenger name and mobile, if not you",
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "true",
  };
  const last = meet ? 2 : 1;
  if (meet) {
    Object.assign(fields, {
      "custom_fields[1][key]": "signname",
      "custom_fields[1][label][type]": "custom",
      "custom_fields[1][label][custom]": "Name for the sign",
      "custom_fields[1][type]": "text",
      "custom_fields[1][optional]": "true",
    });
  }
  Object.assign(fields, {
    [`custom_fields[${last}][key]`]: "notes",
    [`custom_fields[${last}][label][type]`]: "custom",
    [`custom_fields[${last}][label][custom]`]: "Notes for your chauffeur",
    [`custom_fields[${last}][type]`]: "text",
    [`custom_fields[${last}][optional]`]: "true",
  });
  return {
    mode: "payment",
    ui_mode: "hosted_page",
    submit_type: "book",
    customer_creation: "always",
    "allowed_payment_method_types[0]": "card",
    "allowed_payment_method_types[1]": "link",
    "adaptive_pricing[enabled]": "false",
    "phone_number_collection[enabled]": "true",
    "name_collection[individual][enabled]": "true",
    "consent_collection[terms_of_service]": "required",
    "consent_collection[payment_method_reuse_agreement][position]": "auto",
    "custom_text[terms_of_service_acceptance][message]":
      "I agree to the [terms of service](https://www.nycluxride.com/terms-of-service#payments) and the [rates and cancellation terms](https://www.nycluxride.com/rates#cancellation). I allow the charges to this card after the ride that the terms describe.",
    "custom_text[submit][message]": taxed
      ? "Today you pay the fare, meet and greet if chosen, sales tax, and the 20% gratuity for your chauffeur. After the ride, tolls, airport parking, government trip charges and the tax on them are charged to this card, with an itemized receipt. You can ask for a fare estimate that includes all fees at +1 (646) 775-0556."
      : "Today you pay the fare, meet and greet if chosen, and the 20% gratuity for your chauffeur. After the ride, tolls, airport parking, taxes and government trip charges are charged to this card, with an itemized receipt. You can ask for a fare estimate that includes all fees at +1 (646) 775-0556.",
    "custom_text[after_submit][message]": `Dispatch confirms your vehicle and chauffeur in writing before the day. To change or cancel, call +1 (646) 775-0556 or message on WhatsApp with your reference ${ref}.`,
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

function line(i, { quantity = "1", amount, name, description, unitLabel, taxRate }) {
  const out = {
    [`line_items[${i}][quantity]`]: quantity,
    [`line_items[${i}][price_data][currency]`]: "usd",
    [`line_items[${i}][price_data][unit_amount]`]: amount,
    [`line_items[${i}][price_data][product_data][name]`]: name,
    [`line_items[${i}][price_data][product_data][description]`]: description,
  };
  if (unitLabel) out[`line_items[${i}][price_data][product_data][unit_label]`] = unitLabel;
  if (taxRate) out[`line_items[${i}][tax_rates][0]`] = taxRate;
  return out;
}

const MEET_LINE = { amount: "2500", name: "Meet and greet", description: "Inside the terminal with a name sign. Airport parking is charged after the ride." };
const GRATUITY = (amount) => ({ amount, name: "Gratuity for your chauffeur (20%)", description: "Paid in full to your chauffeur." });

const EXPECTED = {
  "an airport pickup with meet and greet": [
    PICKUP,
    ON,
    "nonce-airport-pickup-0001",
    "NLR-5RQMTS",
    {
      ...common("NLR-5RQMTS", { meet: true }),
      ...line(0, { amount: "16500", name: "From JFK, Business SUV", description: "NLR-5RQMTS. Wed, Oct 14, 2026, 7:30 AM. JFK to Manhattan. 2 passengers." }),
      ...line(1, MEET_LINE),
      ...line(2, GRATUITY("3300")),
      "payment_intent_data[description]": "2026-10-14 07:30 NLR-5RQMTS. From JFK, Business SUV. Drop-off \"350 Fifth Avenue\", Manhattan. 2 passengers. Flight DL 401. Meet and greet.",
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: "NLR-5RQMTS",
        service: "transfer",
        direction: "from-airport",
        airport: "jfk",
        class: "suv",
        from: "jfk",
        to: "manhattan",
        to_address: ADDRESS,
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        passengers: "2",
        flight: "DL 401",
        meet: "1",
        fare_cents: "16500",
        meet_cents: "2500",
        gratuity_cents: "3300",
        tax_cents: "0",
        total_cents: "22300",
      }),
    },
  ],
  "an airport drop-off": [
    DROPOFF,
    ON,
    "nonce-airport-dropoff-0001",
    "NLR-SYEKN4",
    {
      ...common("NLR-SYEKN4"),
      ...line(0, { amount: "16500", name: "To JFK, Business SUV", description: "NLR-SYEKN4. Wed, Oct 14, 2026, 7:30 AM. Manhattan to JFK. 2 passengers." }),
      ...line(1, GRATUITY("3300")),
      "payment_intent_data[description]": "2026-10-14 07:30 NLR-SYEKN4. To JFK, Business SUV. Pickup \"350 Fifth Avenue\", Manhattan. 2 passengers.",
      "payment_intent_data[statement_descriptor_suffix]": "JFK OCT14",
      ...bothMetadata({
        ref: "NLR-SYEKN4",
        service: "transfer",
        direction: "to-airport",
        airport: "jfk",
        class: "suv",
        from: "manhattan",
        from_address: ADDRESS,
        to: "jfk",
        date: "2026-10-14",
        time: "07:30",
        pickup_at: "2026-10-14T11:30:00.000Z",
        passengers: "2",
        meet: "0",
        fare_cents: "16500",
        meet_cents: "0",
        gratuity_cents: "3300",
        tax_cents: "0",
        total_cents: "19800",
      }),
    },
  ],
  "an hourly booking with quantity=hours and unit_label=hour": [
    HOURLY,
    ON,
    "nonce-hourly-escalade-0001",
    "NLR-DMJ26V",
    {
      ...common("NLR-DMJ26V"),
      ...line(0, {
        quantity: "4",
        amount: "10500",
        name: "By the hour, Cadillac Escalade ESV (Business SUV)",
        description: "NLR-DMJ26V. Tue, Dec 1, 2026, 2:00 PM. Pickup Brooklyn. 1 passenger.",
        unitLabel: "hour",
      }),
      ...line(1, GRATUITY("8400")),
      "payment_intent_data[description]": "2026-12-01 14:00 NLR-DMJ26V. By the hour, Cadillac Escalade ESV (Business SUV), 4 hours. Pickup \"1 Main Street\", Brooklyn. 1 passenger.",
      "payment_intent_data[statement_descriptor_suffix]": "HOUR DEC01",
      ...bothMetadata({
        ref: "NLR-DMJ26V",
        service: "hourly",
        class: "suv",
        vehicle: "suv-escalade",
        hours: "4",
        from: "brooklyn",
        from_address: "1 Main Street",
        date: "2026-12-01",
        time: "14:00",
        pickup_at: "2026-12-01T19:00:00.000Z",
        passengers: "1",
        meet: "0",
        fare_cents: "42000",
        meet_cents: "0",
        gratuity_cents: "8400",
        tax_cents: "0",
        total_cents: "50400",
      }),
    },
  ],
  "a taxed booking, rate on the fare and meet lines and not on the gratuity": [
    TAXED_LGA,
    TAXED,
    "nonce-taxed-lga-pickup-0001",
    "NLR-5GV3KF",
    {
      ...common("NLR-5GV3KF", { taxed: true, meet: true }),
      ...line(0, {
        amount: "13000",
        name: "From LaGuardia (LGA), Business SUV",
        description: "NLR-5GV3KF. Thu, Nov 5, 2026, 6:45 PM. LaGuardia (LGA) to Queens. 3 passengers.",
        taxRate: "txr_1SaLesTaxNYC0000",
      }),
      ...line(1, { ...MEET_LINE, taxRate: "txr_1SaLesTaxNYC0000" }),
      ...line(2, GRATUITY("2600")),
      "payment_intent_data[description]": "2026-11-05 18:45 NLR-5GV3KF. From LaGuardia (LGA), Business SUV. Drop-off \"Astoria Park\", Queens. 3 passengers. Meet and greet.",
      "payment_intent_data[statement_descriptor_suffix]": "LGA NOV05",
      ...bothMetadata({
        ref: "NLR-5GV3KF",
        service: "transfer",
        direction: "from-airport",
        airport: "lga",
        class: "suv",
        from: "lga",
        to: "queens",
        to_address: "Astoria Park",
        date: "2026-11-05",
        time: "18:45",
        pickup_at: "2026-11-05T23:45:00.000Z",
        passengers: "3",
        meet: "1",
        fare_cents: "13000",
        meet_cents: "2500",
        gratuity_cents: "2600",
        tax_cents: "1376",
        total_cents: "19476",
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
    process.stderr.write(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}\n`);
  }
}

const logged = [];
console.error = (...args) => logged.push(args.map(String).join(" "));

const realFetch = globalThis.fetch;
function stripeTotal(body) {
  const form = new URLSearchParams(body);
  let total = Number(form.get("metadata[tax_cents]") || 0);
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

const LIVE = { PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: KEY };
const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const inDays = (days) => NY_DATE.format(new Date(Date.now() + days * 86400000));
const SOON = inDays(3);
const trip = (fields) => ({ ...fields, date: SOON, time: "10:00" });

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

for (const [name, [fields, settings, nonce, ref, expected]] of Object.entries(EXPECTED)) {
  await test(`builder: ${name} equals the complete expected map`, () => {
    const built = build(fields, settings, nonce);
    assert.equal(built.ref, ref);
    const entries = [...built.params];
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, "a parameter is sent twice");
    assert.deepEqual(Object.fromEntries(entries), expected);
  });
}

await test("builder: the gratuity line never carries a tax rate, the fare and meet lines do when taxed", () => {
  const { params } = build(TAXED_LGA, TAXED, "nonce-taxed-lga-pickup-0001");
  const keys = [...params.keys()].filter((k) => k.includes("tax_rates"));
  assert.deepEqual(keys, ["line_items[0][tax_rates][0]", "line_items[1][tax_rates][0]"]);
  assert.equal(params.get("line_items[2][price_data][product_data][name]"), "Gratuity for your chauffeur (20%)");
  const untaxedJfk = build(DROPOFF, TAXED, "nonce-x-0000000000000");
  assert.ok([...untaxedJfk.params.keys()].some((k) => k === "line_items[0][tax_rates][0]"));
  const newark = build({ ...DROPOFF, to: "ewr" }, TAXED, "nonce-x-0000000000000");
  assert.ok(![...newark.params.keys()].some((k) => k.includes("tax_rates")), "Newark is never taxed");
  assert.equal(newark.params.get("custom_text[submit][message]"), fill20(CHECKOUT.submit));
});

function fill20(template) {
  return template.replace("{rate}", "20");
}

await test("builder: NYCLUXRIDE* plus the suffix is at most 22 characters for every airport and for hourly, in every month", () => {
  const cases = [];
  for (let month = 1; month <= 12; month++) {
    const date = `2027-${String(month).padStart(2, "0")}-28`;
    for (const airport of AIRPORT_PLACES) cases.push({ ...DROPOFF, to: airport, date });
    cases.push({ ...HOURLY, date });
  }
  for (const fields of cases) {
    const settings = readSettings({ PAYMENTS_ENABLED: "true" });
    const { params } = build(fields, settings, "nonce-descriptor-0000", NOW);
    const suffix = params.get("payment_intent_data[statement_descriptor_suffix]");
    const code = fields.trip_type === "hour" ? DESCRIPTOR_CODES.hourly : DESCRIPTOR_CODES[fields.to];
    assert.match(suffix, new RegExp(`^${code} [A-Z]{3}28$`));
    assert.ok(`${DESCRIPTOR_PREFIX}* ${suffix}`.length <= 22, `${DESCRIPTOR_PREFIX}* ${suffix}`);
    assert.ok(/[A-Z]/.test(suffix) && !/[<>\\'"*]/.test(suffix), suffix);
  }
  assert.equal(`${DESCRIPTOR_PREFIX}* HOUR OCT14`.length, 22);
});

await test("builder: empty metadata keys are left out and every value is at most 500 characters", () => {
  const long = { ...DROPOFF, from_address: "B".repeat(400) };
  const { params, trip: t, price, ref } = build(long, ON, "nonce-long-address-000");
  const meta = [...params].filter(([k]) => k.startsWith("metadata["));
  assert.ok(meta.length <= 22, `${meta.length} metadata keys`);
  for (const [key, value] of meta) {
    assert.ok(value.length > 0 && value.length <= 500, key);
  }
  assert.ok(!params.has("metadata[flight]") && !params.has("metadata[to_address]") && !params.has("metadata[vehicle]") && !params.has("metadata[hours]"));
  const direct = metadataFor({ ...t, from_address: "C".repeat(600), flight: "" }, price, ref);
  assert.equal(direct.from_address.length, 500);
  assert.ok(!("flight" in direct));
  assert.ok(!params.has("metadata[source]"));
});

await test("builder: custom_text messages are at most 1200 characters, also with a license line", () => {
  const { params } = build(PICKUP, TAXED, "nonce-text-length-0000");
  for (const key of ["custom_text[terms_of_service_acceptance][message]", "custom_text[submit][message]", "custom_text[after_submit][message]"]) {
    assert.ok(params.get(key).length <= 1200, key);
    assert.ok(!params.get(key).includes("{"), `${key} has an unfilled placeholder`);
  }
  const withLicense = `${CHECKOUT.license.replace("{license}", "B00000")} ${CHECKOUT.afterSubmit.replace("{ref}", "NLR-7K3Q2P")}`;
  assert.ok(withLicense.length <= 1200);
});

await test("builder: descriptions start with the sortable date and with the reference, within Stripe's limits, and the payer's page shows no free text", () => {
  for (const [fields, settings] of [[PICKUP, ON], [DROPOFF, ON], [HOURLY, ON], [TAXED_LGA, TAXED]]) {
    const long = { ...fields, from_address: fields.from_address ? "D".repeat(200) : "", to_address: fields.to_address ? "E".repeat(200) : "" };
    const { params, ref } = build(long, settings, "nonce-description-0000");
    const intent = params.get("payment_intent_data[description]");
    assert.ok(intent.startsWith(`${fields.date} ${fields.time} ${ref}. `), intent);
    assert.ok(intent.length <= 1000);
    const product = params.get("line_items[0][price_data][product_data][description]");
    assert.ok(product.startsWith(`${ref}. `));
    assert.ok(!product.includes("DD") && !product.includes("EE"), product);
    assert.ok(intent.includes("D".repeat(150)) || intent.includes("E".repeat(150)), intent);
  }
});

await test("builder: expires_at is the creation time plus 1860 seconds", () => {
  const now = new Date("2026-10-05T09:15:42.900Z");
  const { params } = build(DROPOFF, ON, "nonce-expiry-000000000", now);
  assert.equal(Number(params.get("expires_at")), Math.floor(now.getTime() / 1000) + 1860);
});

await test("builder: at most three custom fields, in order, with alphanumeric keys", () => {
  const { params } = build(PICKUP, ON, "nonce-fields-000000000");
  const keys = [0, 1, 2, 3].map((i) => params.get(`custom_fields[${i}][key]`));
  assert.deepEqual(keys, ["passenger", "signname", "notes", null]);
  for (const key of keys.filter(Boolean)) assert.match(key, /^[a-z0-9]+$/i);
});

await test("builder: every custom field label is at most 50 characters and every key is alphanumeric", () => {
  for (const [fields, settings] of [[PICKUP, ON], [DROPOFF, ON], [HOURLY, ON], [TAXED_LGA, TAXED]]) {
    const { params } = build(fields, settings, "nonce-label-length-0000");
    for (const [key, value] of params) {
      if (/^custom_fields\[\d+\]\[label\]\[custom\]$/.test(key)) assert.ok(value.length <= 50, key);
      if (/^custom_fields\[\d+\]\[key\]$/.test(key)) assert.match(value, /^[A-Za-z0-9]{1,200}$/, key);
    }
  }
});

await test("builder: none of the parameters the spec leaves out are sent", () => {
  const { params } = build(PICKUP, ON, "nonce-left-out-0000000");
  for (const key of params.keys()) {
    assert.ok(!/^(payment_method_types|automatic_tax|invoice_creation|billing_address_collection|shipping_address_collection|allow_promotion_codes|locale)\b/.test(key), key);
  }
  assert.equal(params.get("ui_mode"), "hosted_page");
});

await test("encodeForm nests objects and arrays with brackets and skips undefined and null", () => {
  const params = encodeForm({ a: "1", b: { c: true, d: [{ e: 2 }, "f"] }, g: undefined, h: null, i: false });
  assert.deepEqual([...params], [["a", "1"], ["b[c]", "true"], ["b[d][0][e]", "2"], ["b[d][1]", "f"], ["i", "false"]]);
});

const STRIPE_JFK = trip(DROPOFF);
const PICKUP_SOON = trip(PICKUP);

await test("handler: the Stripe call has the URL, method, form type, version, key, a 10 second timeout and no Idempotency-Key", async () => {
  setEnv(LIVE);
  const body = await readJson(await post({ ...STRIPE_JFK, nonce: "nonce-handler-call-0001" }), 200);
  assert.deepEqual(body, { kind: "pay", ref: bookingRef("nonce-handler-call-0001"), url: CHECKOUT_URL });
  assert.equal(calls.length, 1);
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
  const before = Math.floor(Date.now() / 1000);
  await post({ ...STRIPE_JFK, nonce: "nonce-handler-body-0001" });
  const after = Math.floor(Date.now() / 1000);
  const sent = Object.fromEntries(formOf(calls[0]));
  const t = readInput(STRIPE_JFK);
  const expected = Object.fromEntries(sessionParams(t, priceTrip(t, ON), bookingRef("nonce-handler-body-0001"), ON, new Date(), LOCAL));
  const expires = Number(sent.expires_at);
  assert.ok(expires >= before + 1860 && expires <= after + 1860, String(expires));
  delete sent.expires_at;
  delete expected.expires_at;
  assert.deepEqual(sent, expected);
  assert.equal(sent["line_items[0][price_data][unit_amount]"], "16500");
});

await test("handler: two posts with the same nonce and a different meet make two calls and both succeed", async () => {
  setEnv(LIVE);
  const nonce = "nonce-same-twice-000001";
  const first = await readJson(await post({ ...PICKUP_SOON, nonce }), 200);
  const second = await readJson(await post({ ...PICKUP_SOON, meet: "", nonce }), 200);
  assert.equal(calls.length, 2);
  assert.equal(first.kind, "pay");
  assert.equal(second.kind, "pay");
  assert.equal(first.ref, second.ref);
  assert.equal(formOf(calls[0]).get("line_items[1][price_data][unit_amount]"), "2500");
  assert.equal(formOf(calls[1]).get("line_items[1][price_data][unit_amount]"), "3300");
});

await test("handler: JSON Accept gets 200 pay with the URL, no JSON Accept gets 303 to the session URL", async () => {
  setEnv(LIVE);
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).url, CHECKOUT_URL);
  assertRedirect(await formPost(STRIPE_JFK), CHECKOUT_URL);
  assertRedirect(await post(STRIPE_JFK, { accept: "" }), CHECKOUT_URL);
});

await test("handler: every redirect of 14.3 for a form post", async () => {
  setEnv(LIVE);
  assertRedirect(await formPost(STRIPE_JFK), CHECKOUT_URL);
  assertRedirect(await formPost({ ...STRIPE_JFK, class: "sedan" }), "/book#q-class-airport");
  assertRedirect(await formPost({ ...STRIPE_JFK, trip_type: "hour", vehicle: "sprinter", hours: "3" }), "/book#q-sprinter-hourly");
  assertRedirect(await formPost({ ...STRIPE_JFK, from: "" }), "/book#e-from");
  assertRedirect(await formPost({ ...STRIPE_JFK, date: inDays(-2) }), "/book#e-date-past");
  stripe = () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
  assertRedirect(await formPost(STRIPE_JFK), "/book#q-error");
  setEnv({ PAYMENTS_ENABLED: "true" });
  assertRedirect(await formPost(STRIPE_JFK), "/book#q-error");
  assertRedirect(await formPost(STRIPE_JFK, { origin: "https://evil.example" }), "/book#q-error");
  assertRedirect(await formPost(STRIPE_JFK, { type: "text/plain", raw: "x" }), "/book#q-error");
  setEnv();
  assertRedirect(await formPost(STRIPE_JFK), "/book#q-paused");
});

await test("handler: a booking request never calls fetch and carries the composed links", async () => {
  setEnv(LIVE);
  const fields = { ...STRIPE_JFK, class: "sedan", nonce: "nonce-request-links-0001" };
  const ref = bookingRef(fields.nonce);
  const body = await readJson(await post(fields), 200);
  assert.equal(calls.length, 0);
  assert.deepEqual(body, {
    kind: "quote",
    ref,
    reason: "class-airport",
    group: "price",
    heading: HEADINGS.price,
    text: REASONS["class-airport"].text,
    switch: { class: "suv", cents: 16500 },
    ...contactLinks(readInput(fields), ref),
  });
  const message = decodeURIComponent(body.whatsapp.split("?text=")[1]);
  assert.equal(message, composeMessage(readInput(fields), ref));
  assert.ok(message.includes(ref) && message.includes(ADDRESS) && message.includes("Vehicle: Sedan & Electric"));
  assert.ok(body.mailto.startsWith(`mailto:info@nycluxride.com?subject=Booking%20request%20${ref}&body=`));
  assert.equal(body.tel, "tel:+16467750556");
});

await test("handler: switch carries the Business SUV fare for class-airport and first-lga only", async () => {
  setEnv(LIVE);
  const lga = await readJson(await post({ ...STRIPE_JFK, to: "lga", class: "first" }), 200);
  assert.equal(lga.reason, "first-lga");
  assert.deepEqual(lga.switch, { class: "suv", cents: 13000 });
  const sprinter = await readJson(await post({ ...STRIPE_JFK, class: "sprinter", passengers: "4" }), 200);
  assert.equal(sprinter.reason, "class-airport");
  assert.deepEqual(sprinter.switch, { class: "suv", cents: 16500 });
  const crowd = await readJson(await post({ ...STRIPE_JFK, class: "sprinter", passengers: "8" }), 200);
  assert.equal(crowd.reason, "class-airport");
  assert.equal(crowd.switch, null);
  const noAirport = await readJson(await post({ ...STRIPE_JFK, to: "brooklyn", to_address: "1 Main Street" }), 200);
  assert.equal(noAirport.reason, "no-airport");
  assert.equal(noAirport.switch, null);
  assert.equal(calls.length, 0);
});

await test("handler: a price check returns the price shape and never calls fetch", async () => {
  setEnv(LIVE);
  const fields = { ...PICKUP_SOON, action: "quote", nonce: "nonce-price-check-00001" };
  const body = await readJson(await post(fields), 200);
  assert.deepEqual(body, {
    kind: "price",
    ref: bookingRef(fields.nonce),
    lines: [
      { label: "From JFK, Business SUV", cents: 16500 },
      { label: "Meet and greet", cents: 2500 },
      { label: "Gratuity for your chauffeur (20%)", cents: 3300 },
    ],
    total_cents: 22300,
    currency: "usd",
    notes: [NOTES.after],
  });
  setEnv({ ...LIVE, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000", SALES_TAX_PERCENT: "8.875" });
  const taxed = await readJson(await post(fields), 200);
  assert.deepEqual(taxed.lines.at(-1), { label: "Sales tax (8.875%)", cents: 1686 });
  assert.equal(taxed.total_cents, 23986);
  assert.deepEqual(taxed.notes, [NOTES.afterTaxed]);
  assert.equal(calls.length, 0);
});

await test("handler: an invalid trip returns the invalid shape with the field to focus", async () => {
  setEnv(LIVE);
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, from_address: "" }), 422), { kind: "invalid", code: "from_address", field: "from_address", text: ERRORS.from_address.text });
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, date: inDays(-1) }), 422), { kind: "invalid", code: "date-past", field: "date", text: ERRORS["date-past"].text });
  assert.deepEqual(await readJson(await post({ ...STRIPE_JFK, nlr_hp: "Acme" }), 422), { kind: "invalid", code: "form", field: "form", text: ERRORS.form.text });
  assert.deepEqual(await readJson(await post({}, { raw: "{not json" }), 422), { kind: "invalid", code: "form", field: "form", text: ERRORS.form.text });
  assert.equal((await readJson(await post({}, { raw: "[1,2]" }), 422)).code, "form");
  assert.equal(calls.length, 0);
});

await test("handler: a Stripe 400 and a timeout both give 502 stripe with the composed links, and the log holds no key, address or body", async () => {
  const fields = { ...STRIPE_JFK, nonce: "nonce-stripe-fails-0001" };
  const ref = bookingRef(fields.nonce);
  const composed = contactLinks(readInput(fields), ref);
  const expected = { kind: "error", code: "stripe", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...composed };
  setEnv(LIVE);
  stripe = () => new Response(JSON.stringify({ error: { message: "Invalid request: secret-body-text" } }), { status: 400, headers: { "request-id": "req_fail0001" } });
  assert.deepEqual(await readJson(await post(fields), 502), expected);
  assert.deepEqual(logged, [`stripe 400 req_fail0001 ${ref}`]);
  noLeak(KEY, ADDRESS, "secret-body-text", "Invalid request");
  setEnv(LIVE);
  stripe = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  assert.deepEqual(await readJson(await post(fields), 502), expected);
  assert.deepEqual(logged, [`stripe 0  ${ref}`]);
  noLeak(KEY, ADDRESS);
  setEnv(LIVE);
  stripe = () => new Response(JSON.stringify({ id: "cs_test_nourl00000000", amount_total: 19800 }), { status: 200 });
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
  amount_total: 22300,
  currency: "usd",
  client_reference_id: "NLR-5RQMTS",
  customer_details: { email: "pat@example.com", name: "Pat Example", phone: "+12125550100", address: { line1: "9 Secret Lane" } },
  metadata: {
    ref: "NLR-5RQMTS",
    service: "transfer",
    direction: "from-airport",
    airport: "jfk",
    class: "suv",
    from: "jfk",
    to: "manhattan",
    to_address: ADDRESS,
    date: "2026-10-14",
    time: "07:30",
    pickup_at: "2026-10-14T11:30:00.000Z",
    passengers: "2",
    flight: "DL 401",
    meet: "1",
    fare_cents: "16500",
    meet_cents: "2500",
    gratuity_cents: "3300",
    tax_cents: "0",
    total_cents: "22300",
    chauffeur: "Sam",
  },
};

await test("handler: GET with a paid session returns exactly the keys of 14.3 and no address, flight, name, email or phone", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify(PAID_SESSION), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual(body, {
    kind: "session",
    status: "complete",
    payment_status: "paid",
    ref: "NLR-5RQMTS",
    summary: "Wed, Oct 14, 2026, 7:30 AM. From JFK, Business SUV.",
    lines: [
      { label: "From JFK, Business SUV", cents: 16500 },
      { label: "Meet and greet", cents: 2500 },
      { label: "Gratuity for your chauffeur (20%)", cents: 3300 },
    ],
    total_cents: 22300,
    value_cents: 19000,
    currency: "usd",
    notes: [NOTES.after],
  });
  const text = JSON.stringify(body);
  for (const secret of [ADDRESS, "DL 401", "Pat Example", "pat@example.com", "+12125550100", "9 Secret Lane", "Sam"]) assert.ok(!text.includes(secret), secret);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.stripe.com/v1/checkout/sessions/${PAID_SESSION.id}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  assert.equal(new Headers(calls[0].init.headers).get("stripe-version"), "2026-09-30.endive");
  assert.deepEqual(timeouts, [10000]);
});

await test("handler: GET rebuilds an hourly receipt and a taxed receipt from the metadata", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000", SALES_TAX_PERCENT: "8.875" });
  const hourly = { ...PAID_SESSION, amount_total: 54128, metadata: { ref: "NLR-DMJ26V", service: "hourly", class: "suv", vehicle: "suv-escalade", hours: "4", from: "brooklyn", from_address: "1 Main Street", date: "2026-12-01", time: "14:00", meet: "0", fare_cents: "42000", meet_cents: "0", gratuity_cents: "8400", tax_cents: "3728", total_cents: "54128" } };
  stripe = () => new Response(JSON.stringify(hourly), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.equal(body.summary, "Tue, Dec 1, 2026, 2:00 PM. By the hour, Cadillac Escalade ESV (Business SUV), 4 hours.");
  assert.deepEqual(body.lines, [
    { label: "By the hour, Cadillac Escalade ESV (Business SUV), 4 hours", cents: 42000 },
    { label: "Gratuity for your chauffeur (20%)", cents: 8400 },
    { label: "Sales tax (8.875%)", cents: 3728 },
  ]);
  assert.equal(body.value_cents, 42000);
  assert.deepEqual(body.notes, [NOTES.afterTaxed]);
  assert.ok(!JSON.stringify(body).includes("1 Main Street"));
});

await test("handler: GET with an unpaid session returns only kind, status and payment_status", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, status: "open", payment_status: "unpaid" }), { status: 200 });
  assert.deepEqual(await readJson(await get(PAID_SESSION.id), 200), { kind: "session", status: "open", payment_status: "unpaid" });
});

await test("handler: GET with a malformed id or an unknown id returns 404, a Stripe failure 502, no key 503", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  for (const id of ["", "cs_live_short", "pi_123456789012345", "cs_test_abc/../../x", "cs_mock_7K3Q2P", "cs_test_ünicode0000000"]) {
    assert.deepEqual(await readJson(await get(id), 404), { kind: "unknown" }, id);
  }
  assert.equal(calls.length, 0);
  stripe = () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing" } }), { status: 404 });
  assert.deepEqual(await readJson(await get("cs_live_a1B2c3D4e5F6g7H8i9J0"), 404), { kind: "unknown" });
  stripe = () => new Response("oops", { status: 500, headers: { "request-id": "req_read0001" } });
  assert.deepEqual(await readJson(await get(PAID_SESSION.id), 502), { kind: "error", code: "stripe", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...contactLinks() });
  assert.deepEqual(logged, ["stripe 500 req_read0001"]);
  setEnv();
  assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
  assert.equal(calls.length, 0);
});

await test("handler: the honeypot gives 422 form, an autofilled company field is ignored, a 5000 byte body 413, text/plain 415", async () => {
  setEnv(LIVE);
  assert.equal((await readJson(await post({ ...STRIPE_JFK, nlr_hp: "x" }), 422)).code, "form");
  assert.equal((await readJson(await post({ ...STRIPE_JFK, company: "Acme", organization: "Acme" }), 200)).kind, "pay");
  const big = JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(5000) });
  const plain = contactLinks();
  assert.deepEqual(await readJson(await post({}, { raw: big, headers: { "content-length": String(big.length) } }), 413), { kind: "error", code: "too-large", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...plain });
  assert.equal((await readJson(await post({}, { raw: big }), 413)).code, "too-large");
  assert.deepEqual(await readJson(await post({}, { type: "text/plain", raw: JSON.stringify(STRIPE_JFK) }), 415), { kind: "error", code: "type", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...plain });
  assert.equal((await readJson(await post({}, { type: "multipart/form-data", raw: "x" }), 415)).code, "type");
  assert.equal((await readJson(await post(STRIPE_JFK, { type: "application/json; charset=utf-8" }), 200)).kind, "pay");
  assert.equal((await readJson(await post({ ...STRIPE_JFK, pad: "x".repeat(3500) }), 200)).kind, "pay");
});

await test("handler: a cross-site Origin and Sec-Fetch-Site cross-site or same-site give 403", async () => {
  setEnv(LIVE);
  const origin = { kind: "error", code: "origin", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...contactLinks() };
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

await test("handler: with no key outside mock mode a priced trip gets 503 with the composed links", async () => {
  setEnv({ PAYMENTS_ENABLED: "true" });
  const fields = { ...STRIPE_JFK, nonce: "nonce-no-key-0000000001" };
  const body = await readJson(await post(fields), 503);
  assert.deepEqual(body, { kind: "error", code: "unavailable", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...contactLinks(readInput(fields), bookingRef(fields.nonce)) });
  assert.equal(calls.length, 0);
});

await test("handler: Release 1, PAYMENTS_ENABLED unset, every complete trip is paused with no key and no fetch", async () => {
  setEnv();
  for (const fields of [STRIPE_JFK, { ...STRIPE_JFK, class: "sedan" }, trip(HOURLY)]) {
    const body = await readJson(await post(fields), 200);
    assert.equal(body.reason, "paused");
    assert.equal(body.heading, HEADINGS.phone);
    assert.ok(body.whatsapp.startsWith("https://wa.me/16467750556?text="));
  }
  assert.equal((await readJson(await post({ ...STRIPE_JFK, from: "" }), 422)).code, "from");
  assert.equal(calls.length, 0);
});

await test("handler: a half-set tax pair pauses every trip and logs tax-config", async () => {
  setEnv({ ...LIVE, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000" });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).reason, "paused");
  assert.deepEqual(logged, ["tax-config"]);
  assert.equal(calls.length, 0);
});

await test("handler: BOOK_MOCK=true with no key never calls fetch, returns the mock URL, and GET returns the mock session", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const fields = { ...PICKUP_SOON, nonce: "nonce-mock-booking-0001" };
  const ref = bookingRef(fields.nonce);
  const id = `cs_mock_${ref.slice(4)}`;
  assert.deepEqual(await readJson(await post(fields), 200), { kind: "pay", ref, url: `/booking-confirmed?session_id=${id}` });
  assertRedirect(await formPost(fields), `/booking-confirmed?session_id=${id}`);
  const session = await readJson(await get(id), 200);
  assert.deepEqual(Object.keys(session), ["kind", "status", "payment_status", "ref", "summary", "lines", "total_cents", "value_cents", "currency", "notes"]);
  assert.equal(session.payment_status, "paid");
  assert.equal(session.ref, ref);
  assert.equal(session.total_cents, 22300);
  assert.equal(session.value_cents, 19000);
  assert.equal(session.lines.length, 3);
  assert.equal(session.summary, `${formatDate(SOON)}, 10:00 AM. From JFK, Business SUV.`);
  assert.deepEqual(await readJson(await get("cs_mock_ZZZZZZ"), 404), { kind: "unknown" });
  assert.equal(calls.length, 0);
});

await test("handler: VERCEL_ENV=production with BOOK_MOCK=true and no key never mocks a payment, and refuses mock ids", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", VERCEL_ENV: "production" });
  const res = await post(STRIPE_JFK, { url: "https://www.nycluxride.com/api/book", origin: SITE });
  if (CONSENT_TERMS_LIVE) assert.equal((await readJson(res, 503)).code, "unavailable");
  else assert.equal((await readJson(res, 200)).reason, "paused");
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const { url } = await readJson(await post({ ...STRIPE_JFK, nonce: "nonce-mock-prod-000001" }), 200);
  setEnv({ BOOK_MOCK: "true", VERCEL_ENV: "production" });
  assert.equal((await get(url.split("=")[1])).status, 404);
  assert.equal(calls.length, 0);
});

await test("handler: the mock session map keeps at most 100 sessions and drops the oldest", async () => {
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
  const ids = [];
  for (let i = 0; i < 101; i++) ids.push((await readJson(await post({ ...STRIPE_JFK, nonce: `nonce-cap-${String(i).padStart(4, "0")}-000000` }), 200)).url.split("=")[1]);
  assert.equal(new Set(ids).size, 101);
  assert.equal((await get(ids[0])).status, 404);
  assert.equal((await get(ids[1])).status, 200);
  assert.equal((await get(ids[100])).status, 200);
});

const ON_PREVIEW = { url: `${PREVIEW}/api/book`, origin: PREVIEW };

await test("handler: a preview with VERCEL_ENV as its only variable runs the mock flow with payments on and never calls fetch", async () => {
  setEnv({ VERCEL_ENV: "preview" });
  const fields = { ...PICKUP_SOON, nonce: "nonce-preview-demo-0001" };
  const ref = bookingRef(fields.nonce);
  const id = `cs_mock_${ref.slice(4)}`;
  assert.equal((await readJson(await post({ ...fields, action: "quote" }, ON_PREVIEW), 200)).total_cents, 22300);
  assert.deepEqual(await readJson(await post(fields, ON_PREVIEW), 200), { kind: "pay", ref, url: `/booking-confirmed?session_id=${id}` });
  assertRedirect(await formPost(fields, ON_PREVIEW), `/booking-confirmed?session_id=${id}`);
  const session = await readJson(await get(id, PREVIEW), 200);
  assert.equal(session.payment_status, "paid");
  assert.equal(session.ref, ref);
  assert.equal(session.total_cents, 22300);
  assert.equal(calls.length, 0);
  assert.deepEqual(logged, []);
  setEnv({ VERCEL_ENV: "preview", STRIPE_SECRET_KEY: " \n" });
  assert.match((await readJson(await post(STRIPE_JFK, ON_PREVIEW), 200)).url, /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{6}$/);
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
    assert.equal((await get(id)).status, 404, JSON.stringify(env));
    assert.equal(calls.length, 0);
  }
  for (const env of [{ VERCEL_ENV: "production" }, {}]) {
    setEnv({ ...env, PAYMENTS_ENABLED: "true" });
    const res = await post(STRIPE_JFK, env.VERCEL_ENV ? prod : {});
    if (env.VERCEL_ENV && !CONSENT_TERMS_LIVE) assert.equal((await readJson(res, 200)).reason, "paused");
    else assert.equal((await readJson(res, 503)).code, "unavailable");
    assert.equal((await get(id)).status, 404);
    assert.equal(calls.length, 0);
  }
  setEnv({ VERCEL_ENV: "preview", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: KEY });
  assert.equal((await readJson(await post(STRIPE_JFK, ON_PREVIEW), 200)).url, CHECKOUT_URL);
  assert.equal(calls.length, 1);
});

await test("handler: no reply carries an Access-Control header, so another origin can never read one", async () => {
  setEnv(LIVE);
  stripe = (url, init) => (init.method === "GET" ? new Response(JSON.stringify(PAID_SESSION), { status: 200 }) : STRIPE_OK(url, init));
  const replies = [await post(STRIPE_JFK), await post({ ...STRIPE_JFK, action: "quote" }), await post({ ...STRIPE_JFK, class: "sprinter" }), await post({ ...STRIPE_JFK, from: "" }), await post(STRIPE_JFK, { origin: "https://evil.example" }), await formPost(STRIPE_JFK), await get(PAID_SESSION.id)];
  assert.deepEqual(replies.map((res) => res.status), [200, 200, 200, 422, 403, 303, 200]);
  for (const res of replies) assert.deepEqual([...res.headers.keys()].filter((name) => name.startsWith("access-control-")), []);
});

const EXPIRED = (url) => url.endsWith("/expire");
const created = (fields) => ({ id: "cs_test_a1B2c3D4e5F6g7H8i9J0", object: "checkout.session", url: CHECKOUT_URL, ...fields });

await test("handler: a create reply whose amount_total is not the total shown gives 502, logs amount-mismatch and expires the session", async () => {
  const fields = { ...STRIPE_JFK, nonce: "nonce-amount-check-0001" };
  const ref = bookingRef(fields.nonce);
  const composed = { kind: "error", code: "stripe", group: "phone", heading: HEADINGS.phone, text: ERROR_BLOCK.text, ...contactLinks(readInput(fields), ref) };
  for (const amount of [19799, 19801, null]) {
    setEnv(LIVE);
    stripe = (url) => new Response(JSON.stringify(EXPIRED(url) ? { status: "expired" } : created({ amount_total: amount })), { status: 200 });
    assert.deepEqual(await readJson(await post(fields), 502), composed);
    assert.deepEqual(logged, [`amount-mismatch ${amount} 19800 ${ref}`]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "https://api.stripe.com/v1/checkout/sessions/cs_test_a1B2c3D4e5F6g7H8i9J0/expire");
    assert.equal(calls[1].init.method, "POST");
    assert.equal(new Headers(calls[1].init.headers).get("authorization"), `Bearer ${KEY}`);
    assertRedirect(await formPost(fields), "/book#q-error");
  }
  setEnv(LIVE);
  stripe = (url) => new Response(JSON.stringify(created({ amount_total: 19800 })), { status: 200 });
  assert.equal((await readJson(await post(fields), 200)).kind, "pay");
  assert.equal(calls.length, 1);
  assert.deepEqual(logged, []);
});

await test("handler: with tax on, a Stripe total that rounds the half cent the other way is refused", async () => {
  setEnv({ ...LIVE, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000", SALES_TAX_PERCENT: "8.875" });
  stripe = (url) => new Response(JSON.stringify(EXPIRED(url) ? {} : created({ amount_total: 38662 })), { status: 200 });
  const fields = trip({ trip_type: "hour", from: "manhattan", from_address: ADDRESS, passengers: "2", hours: "3", vehicle: "suv-denali", nonce: "nonce-half-cent-0000001" });
  assert.equal((await readJson(await post(fields), 502)).code, "stripe");
  assert.deepEqual(logged, [`amount-mismatch 38662 38663 ${bookingRef(fields.nonce)}`]);
  assert.equal(formOf(calls[0]).get("metadata[tax_cents]"), "2663");
});

await test("handler: a create reply whose URL is not on a Checkout origin gives 502 and is never followed", async () => {
  for (const url of ["https://evil.example/c/pay/cs_test_x", "https://checkout.stripe.com.evil.example/c/pay", "http://checkout.stripe.com/c/pay", "/booking-confirmed?session_id=cs_mock_AAAAAA", 7]) {
    setEnv(LIVE);
    stripe = () => new Response(JSON.stringify(created({ url, amount_total: 19800 })), { status: 200, headers: { "request-id": "req_url0001" } });
    assert.equal((await readJson(await post(STRIPE_JFK), 502)).code, "stripe", String(url));
    assertRedirect(await formPost(STRIPE_JFK), "/book#q-error");
    assert.equal(calls.length, 2);
  }
  for (const origin of CHECKOUT_ORIGINS) assert.ok(CHECKOUT_URL.startsWith(`${origin}/`), origin);
});

await test("handler: a key pasted with spaces or a newline is trimmed, a key of the wrong shape gives 503 and logs key-shape", async () => {
  setEnv({ ...LIVE, STRIPE_SECRET_KEY: ` ${KEY}\n` });
  assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), `Bearer ${KEY}`);
  for (const bad of ["not-a-key", ["pk", "test", "51NlrFakeKeyUsedOnlyInTests"].join("_"), ["rk", "test", "short"].join("_"), `${KEY} extra`]) {
    setEnv({ ...LIVE, STRIPE_SECRET_KEY: bad });
    assert.equal((await readJson(await post(STRIPE_JFK), 503)).code, "unavailable", bad);
    assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable", bad);
    assert.deepEqual(logged, ["key-shape", "key-shape"]);
    assert.equal(calls.length, 0);
  }
});

await test("handler: a live key outside production never runs mock mode or calls Stripe, a test key in production is refused", async () => {
  for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}]) {
    setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: LIVE_KEY, ...env });
    assert.equal((await readJson(await post(STRIPE_JFK), 503)).code, "unavailable");
    assert.equal((await get("cs_mock_7K3Q2P")).status, 404);
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
  assert.equal((await readJson(await post(STRIPE_JFK), 503)).code, "unavailable");
  assert.equal(calls.length, 0);
  setEnv({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: KEY });
  assert.match((await readJson(await post(STRIPE_JFK), 200)).url, /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{6}$/);
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
    assert.equal(calls.length, 0);
  }
  setEnv({ ...LIVE, VERCEL_ENV: "preview" });
  assert.equal((await readJson(await post(STRIPE_JFK, { url: `${PREVIEW}/api/book`, origin: PREVIEW }), 200)).kind, "pay");
});

await test("handler: odd text never throws, and a body that fails mid-read gives 503 with no-store", async () => {
  setEnv();
  for (const from_address of ["350 Fifth Avenue\ud800", `${"A".repeat(199)}\u{1F600}`, "\udc00\u202e\u0000"]) {
    const res = await post({ ...STRIPE_JFK, from_address });
    assert.equal(res.status, from_address.startsWith("\udc00") ? 422 : 200, JSON.stringify(from_address));
    noStore(res);
  }
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const text = (n) => String.fromCharCode(...Array.from({ length: n }, () => Math.floor(random() * 65536)));
  for (let i = 0; i < 40; i++) {
    const fields = { ...STRIPE_JFK, from_address: text(200), to_address: text(50), flight: text(20), nonce: text(30), [text(5)]: text(100) };
    for (const res of [await post(fields), await formPost(fields), await post({}, { raw: text(1000) })]) {
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

await test("handler: the read-back tax line uses Stripe's total_details, and lines that do not add up are logged", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY, SALES_TAX_RATE_ID: "txr_1SaLesTaxNYC0000", SALES_TAX_PERCENT: "8.875" });
  const metadata = { ref: "NLR-AAAAAA", service: "hourly", class: "suv", vehicle: "suv-denali", hours: "3", from: "manhattan", date: "2026-12-01", time: "14:00", meet: "0", fare_cents: "30000", meet_cents: "0", gratuity_cents: "6000", tax_cents: "2663", total_cents: "38663" };
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, amount_total: 38662, total_details: { amount_tax: 2662 }, metadata }), { status: 200 });
  const body = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual(body.lines.at(-1), { label: "Sales tax (8.875%)", cents: 2662 });
  assert.equal(body.total_cents, 38662);
  assert.deepEqual(logged, []);
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, amount_total: 22400 }), { status: 200 });
  assert.equal((await readJson(await get(PAID_SESSION.id), 200)).total_cents, 22400);
  assert.deepEqual(logged, ["receipt-mismatch NLR-5RQMTS"]);
  setEnv({ STRIPE_SECRET_KEY: KEY });
  stripe = () => new Response(JSON.stringify({ ...PAID_SESSION, amount_total: 5000, metadata: {} }), { status: 200 });
  const link = await readJson(await get(PAID_SESSION.id), 200);
  assert.deepEqual([link.ref, link.lines, link.total_cents], ["NLR-5RQMTS", [], 5000]);
  assert.deepEqual(logged, []);
});

await test("handler: one instance makes at most 120 Stripe calls a minute, then answers 503 without calling Stripe", async () => {
  const realNow = Date.now;
  const start = realNow() + 3600000;
  let clock = start;
  Date.now = () => clock;
  try {
    setEnv(LIVE);
    for (let i = 0; i < 120; i++) assert.equal((await post(STRIPE_JFK)).status, 200, String(i));
    assert.equal(calls.length, 120);
    assert.equal((await readJson(await post(STRIPE_JFK), 503)).code, "unavailable");
    assert.equal(calls.length, 120);
    for (let i = 0; i < 60; i++) assert.equal((await get(PAID_SESSION.id)).status, 200, String(i));
    assert.equal((await readJson(await get(PAID_SESSION.id), 503)).code, "unavailable");
    assert.equal(calls.length, 180);
    assert.deepEqual(logged, ["stripe-budget", "stripe-budget"]);
    clock = start + 60001;
    assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
    assert.equal(calls.length, 181);
  } finally {
    Date.now = realNow;
  }
});

await test("handler: a cross-site read never calls Stripe, and a read flood never blocks a booking", async () => {
  const realNow = Date.now;
  const start = realNow() + 7200000;
  let clock = start;
  Date.now = () => clock;
  try {
    setEnv(LIVE);
    const cross = await GET(new Request(`${SITE}/api/book?session_id=${PAID_SESSION.id}`, { headers: { "sec-fetch-site": "cross-site" } }));
    assert.equal(cross.status, 404);
    assert.equal(calls.length, 0);
    for (let i = 0; i < 200; i++) await get(`cs_live_${"a".repeat(12)}${i}`);
    assert.equal((await readJson(await post(STRIPE_JFK), 200)).kind, "pay");
  } finally {
    Date.now = realNow;
  }
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
const server = await startServer({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
const http = async (url, init = {}) => {
  const res = await realFetch(url, { ...init, redirect: "manual" });
  return { status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() };
};

await test("dev server: a PUT gives 405 with Allow: GET, POST", async () => {
  const res = await http(`${server.base}/api/book`, { method: "PUT" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "GET, POST");
});

await test("dev server: helpers, sources and unknown names under /api/ are 404", async () => {
  for (const path of ["/api/_rates", "/api/_copy", "/api/_trip", "/api/_stripe", "/api/book.mjs", "/api/_rates.mjs", "/api/", "/api", "/api/missing", "/api/Book"]) {
    assert.equal((await http(`${server.base}${path}`)).status, 404, path);
  }
});

await test("dev server: a full mock-mode booking returns a payment URL and the paid session", async () => {
  const fields = { ...PICKUP_SOON, nonce: "nonce-dev-server-000001" };
  const headers = { "content-type": "application/json", accept: "application/json", origin: server.base };
  const price = await http(`${server.base}/api/book`, { method: "POST", headers, body: JSON.stringify({ ...fields, action: "quote" }) });
  assert.equal(price.status, 200);
  assert.equal(JSON.parse(price.text).total_cents, 22300);
  const pay = await http(`${server.base}/api/book`, { method: "POST", headers, body: JSON.stringify(fields) });
  assert.equal(pay.status, 200);
  assert.equal(pay.headers["cache-control"], "no-store");
  const { url, ref } = JSON.parse(pay.text);
  assert.equal(url, `/booking-confirmed?session_id=cs_mock_${ref.slice(4)}`);
  const session = await http(`${server.base}/api${url.replace("/booking-confirmed", "/book")}`);
  assert.equal(session.status, 200);
  const body = JSON.parse(session.text);
  assert.equal(body.payment_status, "paid");
  assert.equal(body.ref, ref);
  assert.equal(body.total_cents, 22300);
});

await test("dev server: a form post without JavaScript gets 303 redirects", async () => {
  const headers = { "content-type": "application/x-www-form-urlencoded", origin: server.base };
  const pay = await http(`${server.base}/api/book`, { method: "POST", headers, body: new URLSearchParams({ ...STRIPE_JFK, nonce: "nonce-dev-form-0000001" }).toString() });
  assert.equal(pay.status, 303);
  assert.match(pay.headers.location, /^\/booking-confirmed\?session_id=cs_mock_[0-9A-Z]{6}$/);
  const request = await http(`${server.base}/api/book`, { method: "POST", headers, body: new URLSearchParams({ ...STRIPE_JFK, class: "sprinter" }).toString() });
  assert.equal(request.status, 303);
  assert.equal(request.headers.location, "/book#q-class-airport");
});

await test("dev server: a 5000 byte body is refused on its Content-Length with 413", async () => {
  const body = JSON.stringify({ ...STRIPE_JFK, pad: "x".repeat(5000) });
  const res = await http(`${server.base}/api/book`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "content-length": String(Buffer.byteLength(body)) }, body });
  assert.equal(res.status, 413);
  assert.equal(JSON.parse(res.text).code, "too-large");
});

await test("dev server: static pages are still served", async () => {
  assert.equal((await http(`${server.base}/rates`)).status, 200);
});

await test("dev server: /book and /booking-confirmed carry the Content-Security-Policy of vercel.json, other pages do not", async () => {
  const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  for (const path of ["/book", "/booking-confirmed"]) {
    const rule = config.headers.find((r) => r.source === path);
    const policy = rule.headers.find((h) => h.key === "Content-Security-Policy").value;
    assert.equal((await http(`${server.base}${path}`)).headers["content-security-policy"], policy, path);
  }
  for (const path of ["/", "/rates", "/api/book?session_id=x"]) assert.equal((await http(`${server.base}${path}`)).headers["content-security-policy"], undefined, path);
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
        assert.equal(pay.status, CONSENT_TERMS_LIVE ? 503 : 200);
        assert.equal(CONSENT_TERMS_LIVE ? reply.code : reply.reason, CONSENT_TERMS_LIVE ? "unavailable" : "paused");
        assert.equal((await http(`${demo.base}/api/book?session_id=cs_mock_${bookingRef("nonce-dev-preview-00001").slice(4)}`)).status, 404);
        continue;
      }
      assert.equal(pay.status, 200);
      assert.equal(reply.url, `/booking-confirmed?session_id=cs_mock_${reply.ref.slice(4)}`);
      const session = JSON.parse((await http(`${demo.base}/api${reply.url.replace("/booking-confirmed", "/book")}`)).text);
      assert.equal(session.payment_status, "paid");
      assert.equal(session.total_cents, 22300);
    } finally {
      demo.child.kill();
    }
  }
});

server.child.kill();

if (failures) {
  process.stderr.write(`\n${failures} test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll book-params tests passed\n");
process.exit(0);
