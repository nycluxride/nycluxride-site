import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, getCACertificates, setDefaultCACertificates } from "node:tls";
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { readInput, resolveTrip, priceTrip, readSettings } from "../api/_trip.mjs";
import { metadataFor } from "../api/_stripe.mjs";
import { calendarSettings, oidcToken } from "../api/_calendar.mjs";
import { bookingEvents, mailBooking } from "../api/_mail.mjs";
import { GET } from "../api/book.mjs";
import { POST } from "../api/stripe-webhook.mjs";

const NOW = new Date("2026-11-01T15:00:00.000Z");
const REF = "83558982";
const KEY = ["rk", "test", "51NlrCalendarTestKey"].join("_");
const SECRET = ["whsec", "NlrCalendarTestSigning01"].join("_");
const OWNERS = ["info@nycluxride.com", "nycluxride@gmail.com"];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const OIDC = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: "https://oidc.vercel.com/nlr", sub: "owner:nlr:project:site:environment:production", aud: "https://vercel.com/nlr" })}.${Buffer.from("calendar test signature").toString("base64url")}`;
const ENV_OIDC = `${b64({ alg: "RS256" })}.${b64({ sub: "from the environment" })}.${Buffer.from("env signature").toString("base64url")}`;
const STS_TOKEN = `ya29.sts-${createHash("sha256").update("sts").digest("hex").slice(0, 24)}`;
const ACCESS_TOKEN = `ya29.sa-${createHash("sha256").update("sa").digest("hex").slice(0, 24)}`;
const GCAL = { GCAL_CALENDAR_ID: "c_0a1b2c3d4e5f@group.calendar.google.com", GCAL_SERVICE_ACCOUNT: "nlr-calendar@nlr-test-000000.iam.gserviceaccount.com", GCAL_WIF_AUDIENCE: "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/nycluxride" };
const sid = (prefix, seed) => `${prefix}${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
const SMS = { TWILIO_ACCOUNT_SID: sid("AC", "calendar test account"), TWILIO_API_KEY: sid("SK", "calendar test key"), TWILIO_API_SECRET: sid("", "calendar test secret"), TWILIO_FROM: "+12125550199" };
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "VERCEL_ENV", "BOOK_MOCK", "GOOGLE_MOCK", "BOOKING_REF_SECRET", "OWNER_SMS", "VERCEL_OIDC_TOKEN", ...Object.keys(SMS), ...Object.keys(GCAL)];
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_URL = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GCAL.GCAL_SERVICE_ACCOUNT}:generateAccessToken`;
const EVENTS_URL = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GCAL.GCAL_CALENDAR_ID)}/events`;
const REMINDERS = { useDefault: false, overrides: [{ method: "popup", minutes: 1440 }, { method: "popup", minutes: 120 }] };

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failures++;
    process.stderr.write(`  FAIL ${name}\n       ${String(err.stack || err.message).split("\n").slice(0, 16).join("\n       ")}\n`);
  }
}

const logged = [];
const noted = [];
const history = [];
console.error = (...args) => {
  logged.push(args.map(String).join(" "));
  history.push(logged.at(-1));
};
console.log = (...args) => {
  noted.push(args.map(String).join(" "));
  history.push(noted.at(-1));
};

const certDir = mkdtempSync(join(tmpdir(), "nlr-calendar-test-"));
let TLS_KEY;
let TLS_CERT;
try {
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  if (made.status !== 0) throw new Error("openssl could not make the throwaway test certificate");
  TLS_KEY = readFileSync(join(certDir, "key.pem"));
  TLS_CERT = readFileSync(join(certDir, "cert.pem"), "utf8");
} finally {
  rmSync(certDir, { recursive: true, force: true });
}
setDefaultCACertificates([...getCACertificates("default"), TLS_CERT]);

function fakeSmtp() {
  const state = { messages: [], behavior: {} };
  const server = createServer({ key: TLS_KEY, cert: TLS_CERT }, (socket) => {
    socket.on("error", () => {});
    socket.setEncoding("latin1");
    const say = (line) => socket.write(`${line}\r\n`);
    let buffer = "";
    let mail = null;
    let data = null;
    say("220 fake.test ESMTP ready");
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\r\n"); at >= 0; at = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) {
          if (line === ".") {
            mail.data = data.join("\r\n");
            mail.at = Date.now();
            state.messages.push(mail);
            data = null;
            mail = null;
            say("250 2.0.0 OK queued");
          } else data.push(line.startsWith(".") ? line.slice(1) : line);
          continue;
        }
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") {
          say("250-fake.test");
          say("250-AUTH LOGIN PLAIN");
          say("250 SMTPUTF8");
        } else if (verb === "AUTH") say(state.behavior.auth || "235 2.7.0 Accepted");
        else if (verb === "MAIL") {
          mail = { from: /<([^>]*)>/.exec(line)[1], to: [] };
          say("250 2.1.0 OK");
        } else if (verb === "RCPT") {
          mail.to.push(/<([^>]*)>/.exec(line)[1]);
          say("250 2.1.5 OK");
        } else if (verb === "DATA") {
          data = [];
          say("354 Go ahead");
        } else if (verb === "RSET") {
          mail = null;
          say("250 2.0.0 OK");
        } else if (verb === "QUIT") {
          say("221 2.0.0 Bye");
          socket.end();
        } else say("502 5.5.1 Unrecognized command");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(Object.assign(state, { server, port: server.address().port }))));
}

const stripe = { sessions: new Map(), keys: new Map(), calls: [], refuse: false, list: null };
const twilio = { calls: [] };
const google = { calls: [], events: new Map(), fail: null, delay: 0, custom: null };
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "request-id": "req_fake0001" } });

function apply(metadata, body) {
  for (const [name, value] of new URLSearchParams(body)) {
    const match = /^metadata\[(.+)\]$/.exec(name);
    if (!match) continue;
    if (value === "") delete metadata[match[1]];
    else metadata[match[1]] = value;
  }
}

function googleAnswer(target, method, headers, body, init) {
  const call = { url: target.href, method, headers, body, at: Date.now() };
  google.calls.push(call);
  const stage = target.origin === "https://sts.googleapis.com" ? "sts" : target.origin === "https://iamcredentials.googleapis.com" ? "iam" : "events";
  const custom = google.custom && google.custom(stage, init);
  if (custom) return custom;
  const failed = google.fail && google.fail(stage, call);
  if (failed) return answer(failed, { error: { code: failed, message: `${stage} said no`, status: "PERMISSION_DENIED" } });
  if (stage === "sts") return answer(200, { access_token: STS_TOKEN, issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 3599 });
  if (stage === "iam") return answer(200, { accessToken: ACCESS_TOKEN, expireTime: "2026-11-01T15:05:00Z" });
  const one = /\/events\/([^/]+)$/.exec(target.pathname);
  if (one) {
    const id = decodeURIComponent(one[1]);
    const held = google.events.get(id);
    if (!held) return answer(404, { error: { code: 404, message: "Not Found", status: "NOT_FOUND" } });
    const etag = held.etag || '"1"';
    if (method === "GET") return answer(200, { kind: "calendar#event", status: "confirmed", ...held, etag });
    if (headers.get("if-match") && headers.get("if-match") !== etag) return answer(412, { error: { code: 412, message: "Precondition Failed", status: "FAILED_PRECONDITION" } });
    const change = JSON.parse(body);
    const extendedProperties = { private: { ...(held.extendedProperties && held.extendedProperties.private), ...(change.extendedProperties && change.extendedProperties.private) } };
    const next = { ...held, ...change, extendedProperties, etag: `"${Number(etag.replace(/"/g, "")) + 1}"` };
    google.events.set(id, next);
    return answer(200, { kind: "calendar#event", status: "confirmed", ...next });
  }
  const event = JSON.parse(body);
  if (google.events.has(event.id)) return answer(409, { error: { code: 409, message: "The requested identifier already exists.", status: "ALREADY_EXISTS" } });
  google.events.set(event.id, event);
  return answer(200, { kind: "calendar#event", status: "confirmed", ...event });
}

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  const method = init.method || "GET";
  const headers = new Headers(init.headers);
  const body = String(init.body || "");
  if (/(^|\.)googleapis\.com$/.test(target.hostname)) {
    if (google.delay) await new Promise((resolve) => setTimeout(resolve, google.delay));
    return googleAnswer(target, method, headers, body, init);
  }
  if (target.origin === "https://api.twilio.com") {
    twilio.calls.push({ url: target.href, form: new URLSearchParams(body) });
    return new Response(JSON.stringify({ sid: sid("SM", String(twilio.calls.length)), status: "queued" }), { status: 201, headers: { "Content-Type": "application/json", "Twilio-Request-Id": sid("RQ", String(twilio.calls.length)) } });
  }
  if (target.origin !== "https://api.stripe.com") throw new Error(`a request went to ${target.origin}`);
  stripe.calls.push({ method, path: target.pathname, search: target.search, idempotency: headers.get("idempotency-key") || "", body });
  if (target.pathname === "/v1/checkout/sessions" && method === "GET") {
    const refused = stripe.list && stripe.list();
    if (refused) return answer(refused, { error: { type: refused === 403 ? "invalid_request_error" : "api_error", message: "list said no" } });
    const intent = target.searchParams.get("payment_intent");
    const data = [...stripe.sessions.values()].filter((session) => session.payment_intent === intent).map((session) => structuredClone(session));
    return answer(200, { object: "list", data, has_more: false, url: "/v1/checkout/sessions" });
  }
  const match = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(target.pathname);
  const session = match && stripe.sessions.get(decodeURIComponent(match[1]));
  if (!session) return answer(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
  if (method === "GET") return answer(200, structuredClone(session));
  if (stripe.refuse) return answer(400, { error: { type: "invalid_request_error", message: "This Checkout Session can no longer be updated." } });
  const key = headers.get("idempotency-key");
  const saved = stripe.keys.get(key);
  if (saved && saved.body !== body) return answer(400, { error: { type: "idempotency_error" } });
  if (saved) return answer(200, saved.result);
  const next = { ...session.metadata };
  apply(next, body);
  if (Object.keys(next).length > 50) return answer(400, { error: { type: "invalid_request_error", message: "Metadata can have up to 50 keys." } });
  apply(session.metadata, body);
  const result = structuredClone(session);
  stripe.keys.set(key, { body, result });
  return answer(200, result);
};

const smtp = await fakeSmtp();
function setEnv(vars = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  logged.length = 0;
  noted.length = 0;
  stripe.calls.length = 0;
  smtp.messages.length = 0;
  smtp.behavior = {};
  twilio.calls.length = 0;
  google.calls.length = 0;
  google.events.clear();
  google.fail = null;
  google.delay = 0;
  google.custom = null;
  stripe.refuse = false;
  stripe.list = null;
}
const fullEnv = (extra = {}) => ({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, SMTP_USER: "info@nycluxride.com", SMTP_PASS: "test-app-password-5521", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), ...SMS, ...GCAL, ...extra });

async function booked(fields) {
  const trip = await resolveTrip(readInput(fields), { now: NOW });
  const price = priceTrip(trip, readSettings({ PAYMENTS_ENABLED: "true" }));
  return { metadata: metadataFor(trip, price, REF), total: price.total };
}
setEnv({ GOOGLE_MOCK: "true" });
const ONE_WAY = await booked({ trip_type: "one", from_text: "253 West 72nd Street, New York, NY 10023, USA", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-08", time: "10:00", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "whatsapp" });
const ROUND = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "3", class: "premium", meet: "1", flight: "DL 401", tip: "15", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz Party", notes: "Infant seat, please\nTwo large cases" });
const HOURLY = await booked({ trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", tip: "custom", tip_amount: "40", rider: "me", ...ME, reach: "phone", notes: "A toddler seat, please" });
const STOPS = await booked({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "277 Bedford Ave, Brooklyn, NY 11211", stop2_text: "John F. Kennedy (JFK)", stop2_id: "jfk", to_text: MANHATTAN, date: "2026-11-21", time: "09:00", passengers: "2", class: "suv", flight: "AA 100", tip: "0", rider: "me", ...ME, reach: "phone" });
const NEW_JERSEY = await booked({ trip_type: "one", from_text: "Secaucus, NJ 07094", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-20", time: "05:15", passengers: "2", class: "sedan", tip: "20", rider: "me", ...ME, reach: "phone" });
const SPRINTER = await booked({ trip_type: "one", from_text: "Secaucus, NJ 07094", to_text: "Hoboken, NJ 07030", date: "2026-11-20", time: "05:15", return: "1", return_date: "2026-11-21", return_time: "09:00", passengers: "9", class: "sprinter", tip: "0", infant_seats: "1", rider: "me", ...ME, reach: "phone" });
const DOGS = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "3", class: "premium", meet: "1", flight: "DL 401", tip: "15", infant_seats: "1", small_dogs: "2", large_dogs: "1", rider: "me", ...ME, reach: "phone" });
setEnv();

let serial = 0;
function paid(fix, { live = false } = {}) {
  serial++;
  const tag = `CalTest${String(serial).padStart(4, "0")}`;
  const id = `cs_${live ? "live" : "test"}_${tag}a1B2c3D4e5F6`;
  const session = { id, object: "checkout.session", livemode: live, status: "complete", payment_status: "paid", amount_total: fix.total, currency: "usd", client_reference_id: fix.metadata.ref, payment_intent: `pi_${tag}Q7r8S9`, customer_details: { email: fix.metadata.email, name: fix.metadata.name, phone: "+12125550100" }, metadata: { ...fix.metadata } };
  stripe.sessions.set(id, session);
  return session;
}
const markersOf = (session) => stripe.sessions.get(session.id).metadata;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const waiting = (session) => /^(\S+) calendar (\d+) (\S+)$/.exec(markersOf(session).emailed_at || "");
const doneOf = (session) => ISO.test(markersOf(session).emailed_at || "") && !markersOf(session).email_attempt;
const aged = (session) => {
  const [, stamp, tries, at] = waiting(session);
  markersOf(session).emailed_at = `${stamp} calendar ${tries} ${new Date(Date.parse(at) - 61000).toISOString()}`;
};
const tag = (session) => createHash("sha256").update(session.id).digest("hex").slice(0, 16);
const withToken = (headers = {}) => ({ "x-vercel-oidc-token": OIDC, ...headers });
const lookup = (session, headers = withToken()) => GET(new Request(`http://127.0.0.1:4173/api/book?session_id=${encodeURIComponent(session.id)}`, { headers }));
function hook(session, headers = withToken()) {
  const body = JSON.stringify({ id: "evt_CalTest0001", object: "event", type: "checkout.session.completed", livemode: false, data: { object: { id: session.id, object: "checkout.session" } } });
  const at = Math.floor(Date.now() / 1000);
  const signature = `t=${at},v1=${createHmac("sha256", SECRET).update(`${at}.${body}`).digest("hex")}`;
  return POST(new Request("https://www.nycluxride.com/api/stripe-webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature, ...headers }, body }));
}
let waited = [];
const CONTEXT = Symbol.for("@vercel/request-context");
globalThis[CONTEXT] = { get: () => ({ waitUntil: (promise) => waited.push(promise) }) };
const settled = async () => {
  const results = await Promise.all(waited);
  waited = [];
  return results;
};
const inserted = () => google.calls.filter((c) => c.url === EVENTS_URL).map((c) => JSON.parse(c.body));
const stages = () => google.calls.map((c) => (c.url === STS_URL ? "sts" : c.url === IAM_URL ? "iam" : c.url === EVENTS_URL ? "events" : c.url));
const writes = () => stripe.calls.filter((c) => c.method === "POST");
const writtenKeys = () => [...new Set(writes().flatMap((c) => [...new URLSearchParams(c.body).keys()]))].sort();

await test("settings: the calendar is off with none of the three variables, misconfigured when any one is missing or malformed, and on only with all three", () => {
  setEnv();
  assert.deepEqual(calendarSettings(), { off: true });
  for (const name of Object.keys(GCAL)) {
    setEnv({ ...GCAL, [name]: "" });
    assert.deepEqual(calendarSettings(), { bad: true }, name);
    setEnv({ ...GCAL, [name]: "not a valid value" });
    assert.deepEqual(calendarSettings(), { bad: true }, name);
  }
  setEnv(GCAL);
  assert.deepEqual(calendarSettings(), { calendar: GCAL.GCAL_CALENDAR_ID, account: GCAL.GCAL_SERVICE_ACCOUNT, audience: GCAL.GCAL_WIF_AUDIENCE });
  setEnv({ ...GCAL, GCAL_SERVICE_ACCOUNT: "nlr-calendar@nlr-bookings-11161348.iam.gserviceaccount.com", GCAL_WIF_AUDIENCE: "//iam.googleapis.com/projects/771160577336/locations/global/workloadIdentityPools/vercel/providers/nycluxride" });
  assert.equal(calendarSettings().account, "nlr-calendar@nlr-bookings-11161348.iam.gserviceaccount.com");
});

await test("with any calendar variable missing, a paid booking sends both emails and the text as before and never asks Google for anything", async () => {
  for (const name of [...Object.keys(GCAL), "all"]) {
    setEnv(fullEnv(name === "all" ? Object.fromEntries(Object.keys(GCAL).map((k) => [k, ""])) : { [name]: "" }));
    const session = paid(ONE_WAY);
    assert.equal((await hook(session)).status, 200, name);
    assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1], name);
    assert.ok(doneOf(session), name);
    assert.deepEqual(logged, name === "all" ? [] : ["calendar-config 83558982"], name);
  }
});

await test("the OIDC token: the request header first, then VERCEL_OIDC_TOKEN, and nothing that is not a JWT", () => {
  setEnv({ VERCEL_OIDC_TOKEN: ENV_OIDC });
  assert.equal(oidcToken(OIDC), OIDC);
  assert.equal(oidcToken(""), ENV_OIDC);
  assert.equal(oidcToken(null), ENV_OIDC);
  setEnv();
  assert.equal(oidcToken(""), "");
  for (const bad of ["not-a-jwt", "a.b", "a.b.c d", "a.b.c\r\nX: y", `${"a".repeat(9000)}.b.c`]) assert.equal(oidcToken(bad), "", bad);
});

await test("one way trip: the exact STS exchange, the service account token request and the event, sent with the token from the request header", async () => {
  setEnv(fullEnv({ VERCEL_OIDC_TOKEN: ENV_OIDC }));
  const session = paid(ONE_WAY);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events"]);
  const [sts, iam, event] = google.calls;
  assert.equal(sts.method, "POST");
  assert.equal(sts.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(sts.headers.get("authorization"), null);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sts.body)), {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: GCAL.GCAL_WIF_AUDIENCE,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    subject_token: OIDC,
  });
  assert.equal(iam.method, "POST");
  assert.equal(iam.headers.get("authorization"), `Bearer ${STS_TOKEN}`);
  assert.equal(iam.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(iam.body), { scope: ["https://www.googleapis.com/auth/calendar.events"], lifetime: "300s" });
  assert.equal(event.method, "POST");
  assert.equal(event.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
  assert.equal(event.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(event.body), {
    id: `nlr83558982a${tag(session)}`,
    summary: "[TEST] 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)",
    location: "253 West 72nd Street, New York, NY 10023",
    description: ["Test booking. No real payment was taken.", "Reference: 83558982", "Customer: Ana Lopez", "Phone: +1 212 555 0100", "Email: ana.lopez@example.com", "Trip: One way", "Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Date: Sun, Nov 8, 2026", "Time: 10:00 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", "Paid: $185.00"].join("\n"),
    start: { dateTime: "2026-11-08T15:00:00.000Z", timeZone: "America/New_York" },
    end: { dateTime: "2026-11-08T16:00:00.000Z", timeZone: "America/New_York" },
    reminders: REMINDERS,
  });
  assert.deepEqual([smtp.messages.length, twilio.calls.length], [2, 1]);
  assert.ok(doneOf(session));
  assert.ok(noted.includes("calendar-added 83558982 1"));
  assert.deepEqual(logged, []);
});

await test("round trip: two events, the return at its own date and time from the drop-off, titled Return, with the passenger, flights, meet and greet, notes and the amount paid", async () => {
  setEnv(fullEnv());
  const session = paid(ROUND);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events", "events"]);
  const [out, back] = inserted();
  assert.deepEqual([out.id, back.id], [`nlr83558982a${tag(session)}`, `nlr83558982b${tag(session)}`]);
  assert.equal(out.summary, "[TEST] 83558982 Business Premium SUV: JFK to 350 5th Ave");
  assert.equal(back.summary, "[TEST] Return: 83558982 Business Premium SUV: 350 5th Ave to JFK");
  assert.deepEqual([out.location, back.location], ["John F. Kennedy (JFK), Terminal 4", MANHATTAN]);
  assert.deepEqual([out.start.dateTime, out.end.dateTime, back.start.dateTime, back.end.dateTime], ["2026-11-12T12:30:00.000Z", "2026-11-12T13:30:00.000Z", "2026-11-15T23:00:00.000Z", "2026-11-16T00:00:00.000Z"]);
  const lines = out.description.split("\n");
  for (const line of ["Reference: 83558982", "Customer: Ana Lopez", "Phone: +1 212 555 0100", "Email: ana.lopez@example.com", "Passenger: Ben Ortiz", "Passenger phone: +44 20 7946 0958", "Trip: Round trip", "Pickup: John F. Kennedy (JFK), Terminal 4", `Drop-off: ${MANHATTAN}`, "Return: Sun, Nov 15, 2026, 6:00 PM, New York time", "Flight: DL 401", "Passengers: 3", "Vehicle: Business Premium SUV", "Meet and greet: Yes", "Name for the sign: Ortiz Party", "Notes for the chauffeur: Infant seat, please", "  Two large cases", "Paid: $520.95"]) assert.ok(lines.includes(line), line);
  assert.equal(back.description, out.description);
  assert.deepEqual([out.reminders, back.reminders], [REMINDERS, REMINDERS]);
  assert.ok(noted.includes("calendar-added 83558982 2"));
});

await test("hourly booking: one event that lasts the booked hours, titled with the hours and the pickup", async () => {
  setEnv(fullEnv());
  const session = paid(HOURLY);
  await hook(session);
  const events = inserted();
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, "[TEST] 83558982 Business Premium SUV: 4 hours from 1 Main Street");
  assert.equal(events[0].location, "1 Main Street, Brooklyn, NY 11201");
  assert.deepEqual([events[0].start.dateTime, events[0].end.dateTime], ["2026-12-01T19:00:00.000Z", "2026-12-01T23:00:00.000Z"]);
  assert.ok(events[0].description.split("\n").includes("Trip: By the hour, 4 hours"));
  assert.ok(events[0].description.split("\n").includes("Notes for the chauffeur: A toddler seat, please"));
});

await test("a trip with two stops: the title runs pickup to drop-off and the description lists both stops in order with their full addresses", async () => {
  setEnv(fullEnv());
  const session = paid(STOPS);
  await hook(session);
  const [event] = inserted();
  assert.equal(event.summary, "[TEST] 83558982 Business SUV: LaGuardia (LGA) to 350 5th Ave");
  const lines = event.description.split("\n");
  const at = (line) => lines.indexOf(line);
  assert.ok(at("Pickup: LaGuardia (LGA)") < at("Stop 1: 277 Bedford Ave, Brooklyn, NY 11211"));
  assert.ok(at("Stop 1: 277 Bedford Ave, Brooklyn, NY 11211") < at("Stop 2: John F. Kennedy (JFK)"));
  assert.ok(at("Stop 2: John F. Kennedy (JFK)") < at(`Drop-off: ${MANHATTAN}`));
  assert.ok(lines.includes("Flight: AA 100"));
});

await test("drive minutes: a trip priced by distance lasts its drive time, and a Sprinter round trip splits the drive time between its two events", async () => {
  setEnv(fullEnv());
  const nj = paid(NEW_JERSEY);
  await hook(nj);
  const [ride] = inserted();
  assert.equal(NEW_JERSEY.metadata.minutes, "18");
  assert.deepEqual([ride.start.dateTime, ride.end.dateTime], ["2026-11-20T10:15:00.000Z", "2026-11-20T10:33:00.000Z"]);
  assert.equal(ride.summary, "[TEST] 83558982 Sedan & Electric: Secaucus to Newark Liberty (EWR)");
  setEnv(fullEnv());
  const van = paid(SPRINTER);
  await hook(van);
  const [out, back] = inserted();
  assert.deepEqual([SPRINTER.metadata.minutes, SPRINTER.metadata.legs], ["86", "2"]);
  assert.equal(out.summary, "[TEST] 83558982 Luxury Sprinter: Secaucus to Hoboken");
  assert.equal(back.summary, "[TEST] Return: 83558982 Luxury Sprinter: Hoboken to Secaucus");
  assert.deepEqual([out.start.dateTime, out.end.dateTime, back.start.dateTime, back.end.dateTime], ["2026-11-20T10:15:00.000Z", "2026-11-20T10:58:00.000Z", "2026-11-21T14:00:00.000Z", "2026-11-21T14:43:00.000Z"]);
  assert.ok(out.description.split("\n").includes("Child seats: 1 infant seat"), out.description);
});

await test("the events of a round trip with pets name the dogs right after the child seats in both descriptions, and the dog lines count once in the amount paid", async () => {
  setEnv(fullEnv());
  await hook(paid(DOGS));
  const events = inserted();
  assert.equal(events.length, 2);
  assert.equal(DOGS.metadata.dogs, "2 small 4000, 1 large 4500");
  for (const event of events) {
    const lines = event.description.split("\n");
    const at = lines.indexOf("Child seats: 1 infant seat");
    assert.ok(at > 0 && lines[at + 1] === "Pets: 2 small dogs and 1 large dog", event.description);
    assert.ok(lines.includes(`Paid: $${(DOGS.total / 100).toFixed(2)}`), event.description);
  }
  setEnv(fullEnv());
  await hook(paid(ROUND));
  for (const event of inserted()) assert.ok(!/Pets|dog/.test(event.description), event.description);
});

await test("[TEST] starts the title only for a test mode booking, and the event id is fixed per booking leg, made of 0-9 and a-v", () => {
  setEnv();
  const live = paid(ROUND, { live: true });
  const test = paid(ROUND);
  const [liveOut, liveBack] = bookingEvents(live);
  assert.equal(liveOut.summary, "83558982 Business Premium SUV: JFK to 350 5th Ave");
  assert.equal(liveBack.summary, "Return: 83558982 Business Premium SUV: 350 5th Ave to JFK");
  assert.ok(!liveOut.description.includes("Test booking"));
  assert.ok(bookingEvents(test).every((event) => event.summary.startsWith("[TEST] ")));
  const ids = [...bookingEvents(live), ...bookingEvents(test)].map((event) => event.id);
  assert.ok(ids.every((id) => /^[0-9a-v]{5,1024}$/.test(id)), ids.join(" "));
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(bookingEvents(live).map((event) => event.id), [liveOut.id, liveBack.id]);
  const odd = paid({ ...ONE_WAY, metadata: { ...ONE_WAY.metadata, ref: "Ref-Z9" } });
  assert.match(bookingEvents(odd)[0].id, /^nlrref9a[0-9a-f]{16}$/);
});

await test("an event Google already holds answers 409, which counts as added: the booking is marked done and nothing is tried again", async () => {
  setEnv(fullEnv());
  const session = paid(ROUND);
  for (const event of bookingEvents(session)) google.events.set(event.id, event);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events", "events"]);
  assert.ok(doneOf(session));
  assert.ok(noted.includes("calendar-added 83558982 2"));
  assert.deepEqual(logged, []);
  google.calls.length = 0;
  assert.equal((await hook(session)).status, 200);
  await lookup(session);
  await settled();
  assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1]);
});

await test("a passing Google failure at any step never holds back or repeats the emails or the text: the webhook answers 503, the retry adds the event alone, and later deliveries ask Google nothing", async () => {
  for (const [stage, status] of [["sts", 503], ["iam", 429], ["events", 500], ["events", 0]]) {
    setEnv(fullEnv());
    google.fail = (at) => (at === stage ? status || 503 : 0);
    const session = paid(ROUND);
    assert.equal((await hook(session)).status, 503, stage);
    assert.deepEqual([smtp.messages.length, twilio.calls.length], [2, 1], stage);
    assert.ok(markersOf(session).emailed_at, stage);
    const [, stamp, tries, at] = waiting(session);
    assert.match(stamp, ISO, stage);
    assert.equal(tries, "1", stage);
    assert.ok(Math.abs(Date.now() - Date.parse(at)) < 5000, stage);
    assert.equal(markersOf(session).email_attempt, undefined, stage);
    assert.ok(logged.some((line) => line.startsWith(`calendar-fail 83558982 ${stage}`)), logged.join(" | "));
    google.fail = null;
    google.calls.length = 0;
    assert.equal((await hook(session)).status, 503, stage);
    assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1], "a delivery within the minute waits");
    aged(session);
    assert.equal((await hook(session)).status, 200, stage);
    assert.deepEqual([smtp.messages.length, twilio.calls.length], [2, 1], stage);
    assert.deepEqual(stages(), ["sts", "iam", "events", "events"], stage);
    assert.equal(google.events.size, 2, stage);
    assert.ok(doneOf(session), stage);
    google.calls.length = 0;
    assert.equal((await hook(session)).status, 200);
    await lookup(session);
    assert.deepEqual(await settled(), ["done"]);
    assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1], stage);
  }
});

await test("the confirmation check retries a failed calendar step too, with its own request's token, and never sends an email or a text again", async () => {
  setEnv(fullEnv());
  google.fail = (at) => (at === "events" ? 503 : 0);
  const session = paid(ONE_WAY);
  await lookup(session);
  assert.deepEqual(await settled(), ["calendar"]);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 0]);
  google.fail = null;
  google.calls.length = 0;
  const other = `${b64({ alg: "RS256" })}.${b64({ sub: "a later request" })}.${Buffer.from("later").toString("base64url")}`;
  aged(session);
  await lookup(session, { "x-vercel-oidc-token": other });
  assert.deepEqual(await settled(), ["done"]);
  assert.equal(new URLSearchParams(google.calls[0].body).get("subject_token"), other);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 1]);
  assert.ok(doneOf(session));
});

await test("a calendar step that keeps failing gives up after five tries, clears its marker and lets the webhook answer 200", async () => {
  setEnv(fullEnv());
  google.fail = () => 503;
  const session = paid(ONE_WAY);
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    if (waiting(session)) aged(session);
    statuses.push((await hook(session)).status);
  }
  assert.deepEqual(statuses, [503, 503, 503, 503, 200, 200]);
  assert.equal(stages().filter((s) => s === "sts").length, 5);
  assert.ok(logged.includes("calendar-gave-up 83558982"));
  assert.ok(doneOf(session));
  assert.deepEqual([smtp.messages.length, twilio.calls.length], [2, 1]);
});

await test("a slow Google never delays the emails or their done marker: the emails go out first, the marker waits for the calendar, then clears", async () => {
  setEnv(fullEnv());
  google.delay = 400;
  const session = paid(ONE_WAY);
  assert.equal((await hook(session)).status, 200);
  const sent = Math.max(...smtp.messages.map((m) => m.at));
  const events = google.calls.find((c) => c.url === EVENTS_URL);
  assert.ok(sent < events.at, "the emails waited for Google");
  const marks = writes().map((c) => [c.idempotency, Object.fromEntries(new URLSearchParams(c.body))]);
  const stamps = marks.slice(1).map(([key, body]) => [key, body["metadata[emailed_at]"]]);
  assert.deepEqual(stamps.map(([key]) => key), [`nlr-mail-${session.id}-1-done`, `nlr-cal-${session.id}-done-0-${Date.parse(stamps[0][1].split(" ")[3])}`]);
  assert.match(stamps[0][1], /^\S+Z calendar 0 \S+Z$/);
  assert.equal(stamps[1][1], stamps[0][1].split(" ")[0]);
  assert.ok(doneOf(session));
});

await test("a mail server failure and a calendar that worked: the email retry sends the emails and asks Google nothing more", async () => {
  setEnv(fullEnv());
  smtp.behavior.auth = "535 5.7.8 Username and Password not accepted";
  const session = paid(ROUND);
  assert.equal((await hook(session)).status, 503);
  assert.deepEqual([smtp.messages.length, google.events.size], [0, 2]);
  const tried = JSON.parse(markersOf(session).email_attempt);
  assert.deepEqual([tried.failed, tried.booked], [true, 1]);
  smtp.behavior = {};
  google.calls.length = 0;
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.calls.length], [2, 1, 0]);
  assert.ok(doneOf(session));
});

await test("with the mail settings off, the calendar still gets the booking, a 409 on the next delivery counts as added, and a Google failure never fails the webhook", async () => {
  setEnv(fullEnv({ SMTP_USER: "", SMTP_PASS: "" }));
  const session = paid(ONE_WAY);
  assert.equal((await hook(session)).status, 200);
  assert.equal(google.events.size, 1);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events", "sts", "iam", "events"]);
  assert.equal(google.events.size, 1);
  google.fail = (at) => (at === "events" ? 500 : 0);
  assert.equal((await hook(paid(HOURLY))).status, 200);
  assert.equal(smtp.messages.length, 0);
});

await test("with no marker Stripe will keep, each verified webhook delivery sends as before and adds the events once, a later delivery getting 409 for them", async () => {
  setEnv(fullEnv());
  stripe.refuse = true;
  const session = paid(ROUND);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual([smtp.messages.length, google.events.size], [2, 2]);
  await lookup(session);
  assert.deepEqual(await settled(), ["unmarked"]);
  assert.equal(google.calls.length, 4);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual([smtp.messages.length, google.events.size, inserted().length], [4, 2, 4]);
  assert.ok(noted.filter((line) => line === "calendar-added 83558982 2").length === 2);
});

await test("no OIDC token on the request or in the environment: no Google call, one line says so, the webhook gives up at once, and a confirmation check without one keeps the step for a later delivery", async () => {
  setEnv(fullEnv());
  const session = paid(ONE_WAY);
  assert.equal((await hook(session, {})).status, 200);
  assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1]);
  assert.ok(logged.includes("calendar-token 83558982"));
  assert.ok(logged.includes("calendar-gave-up 83558982"));
  assert.ok(doneOf(session));
  assert.equal((await hook(session)).status, 200);
  assert.equal(google.calls.length, 0);
  setEnv(fullEnv());
  const checked = paid(ONE_WAY);
  await lookup(checked, {});
  assert.deepEqual(await settled(), ["calendar"]);
  assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1]);
  assert.ok(logged.includes("calendar-token 83558982"));
  assert.ok(!logged.includes("calendar-gave-up 83558982"));
  assert.equal(waiting(checked)[2], "0");
  aged(checked);
  assert.equal((await hook(checked)).status, 200);
  assert.equal(google.events.size, 1);
  assert.equal(new URLSearchParams(google.calls[0].body).get("subject_token"), OIDC);
  assert.ok(doneOf(checked));
  setEnv(fullEnv({ VERCEL_OIDC_TOKEN: ENV_OIDC }));
  const later = paid(HOURLY);
  assert.equal((await hook(later, {})).status, 200);
  assert.equal(new URLSearchParams(google.calls[0].body).get("subject_token"), ENV_OIDC);
});

await test("a Checkout Session is never given a new metadata key: the calendar state rides in emailed_at, so a booking at 49 keys never goes past 50", async () => {
  setEnv(fullEnv());
  const filler = Object.fromEntries(Array.from({ length: 49 - Object.keys(ROUND.metadata).length }, (_, i) => [`pad_${i}`, "x"]));
  const session = paid({ ...ROUND, metadata: { ...ROUND.metadata, ...filler } });
  assert.equal(Object.keys(markersOf(session)).length, 49);
  google.fail = (at) => (at === "events" ? 500 : 0);
  assert.equal((await hook(session)).status, 503);
  assert.equal(Object.keys(markersOf(session)).length, 50);
  assert.ok(waiting(session));
  google.fail = null;
  aged(session);
  assert.equal((await hook(session)).status, 200);
  await lookup(session);
  await settled();
  assert.deepEqual(writtenKeys(), ["metadata[email_attempt]", "metadata[emailed_at]"]);
  assert.equal(Object.keys(markersOf(session)).length, 50);
  assert.ok(doneOf(session));
  assert.equal(google.events.size, 2);
  assert.ok(writes().every((c) => [...new URLSearchParams(c.body).values()].every((value) => value.length <= 500)));
  assert.ok(!logged.some((line) => line.startsWith("mail-mark")), logged.join(" | "));
});

await test("an unpaid or unknown session, or one that is not a booking from this site, adds nothing to the calendar", async () => {
  setEnv(fullEnv());
  const open = paid(ONE_WAY);
  stripe.sessions.get(open.id).payment_status = "unpaid";
  assert.equal((await hook(open)).status, 200);
  const link = paid({ ...ONE_WAY, metadata: {} });
  stripe.sessions.get(link.id).client_reference_id = null;
  assert.equal((await hook(link)).status, 200);
  assert.equal(await mailBooking({ ...open, payment_status: "unpaid" }, KEY, { oidc: OIDC }), "unpaid");
  assert.equal(google.calls.length, 0);
});

await test("a Google answer that will not fix itself gives up on the first delivery: the emails and the text go out once, the webhook answers 200, and nothing asks Google again", async () => {
  for (const [stage, status] of [["sts", 400], ["sts", 401], ["sts", 403], ["sts", 404], ["iam", 403], ["iam", 404], ["events", 400], ["events", 403], ["events", 404]]) {
    setEnv(fullEnv());
    google.fail = (at) => (at === stage ? status : 0);
    const session = paid(ROUND);
    assert.equal((await hook(session)).status, 200, `${stage} ${status}`);
    assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 0], `${stage} ${status}`);
    assert.ok(logged.some((line) => line.startsWith(`calendar-fail 83558982 ${stage} ${status}`)), logged.join(" | "));
    assert.equal(logged.filter((line) => line === "calendar-gave-up 83558982").length, 1, `${stage} ${status}`);
    assert.ok(doneOf(session), `${stage} ${status}`);
    google.fail = null;
    google.calls.length = 0;
    assert.equal((await hook(session)).status, 200, `${stage} ${status}`);
    await lookup(session);
    assert.deepEqual(await settled(), ["done"], `${stage} ${status}`);
    assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1], `${stage} ${status}`);
  }
});

await test("a 403 from IAM with the emails failing too: the email retry sends the emails and asks Google nothing more", async () => {
  setEnv(fullEnv());
  smtp.behavior.auth = "535 5.7.8 Username and Password not accepted";
  google.fail = (at) => (at === "iam" ? 403 : 0);
  const session = paid(ONE_WAY);
  assert.equal((await hook(session)).status, 503);
  assert.equal(JSON.parse(markersOf(session).email_attempt).booked, 1);
  smtp.behavior = {};
  google.calls.length = 0;
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.calls.length], [2, 1, 0]);
  assert.ok(doneOf(session));
});

await test("a round trip with one leg refused and the other leg failing for a moment is tried again", async () => {
  setEnv(fullEnv());
  google.fail = (at, call) => (at === "events" ? (JSON.parse(call.body).id.startsWith("nlr83558982a") ? 404 : 500) : 0);
  const session = paid(ROUND);
  assert.equal((await hook(session)).status, 503);
  assert.equal(waiting(session)[2], "1");
  assert.ok(!logged.includes("calendar-gave-up 83558982"));
  assert.ok(logged.includes("calendar-fail 83558982 events 404 500"), logged.join(" | "));
});

await test("with the mail settings off, a Google that keeps failing never makes the webhook answer 503 and writes nothing to the session", async () => {
  for (const fail of [(at) => (at === "events" ? 500 : 0), (at) => (at === "sts" ? 503 : 0), (at) => (at === "iam" ? 403 : 0)]) {
    setEnv(fullEnv({ SMTP_USER: "", SMTP_PASS: "" }));
    google.fail = fail;
    const session = paid(HOURLY);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await hook(session)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200]);
    assert.deepEqual([markersOf(session).emailed_at, markersOf(session).email_attempt, writes().length], [undefined, undefined, 0]);
    assert.deepEqual([smtp.messages.length, google.events.size], [0, 0]);
  }
});

await test("a calendar step reopened by a run that failed at the same time still clears once a later run adds the event", async () => {
  setEnv(fullEnv());
  google.fail = (at) => (at === "events" ? 500 : 0);
  const session = paid(ONE_WAY);
  assert.equal((await hook(session)).status, 503);
  assert.equal(waiting(session)[2], "1");
  google.fail = null;
  aged(session);
  const [, stamp] = waiting(session);
  assert.equal((await hook(session)).status, 200);
  assert.ok(doneOf(session));
  markersOf(session).emailed_at = `${stamp} calendar 2 ${new Date(Date.now() - 61000).toISOString()}`;
  google.calls.length = 0;
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events"]);
  assert.equal(markersOf(session).emailed_at, stamp);
  google.calls.length = 0;
  assert.equal((await hook(session)).status, 200);
  await lookup(session);
  assert.deepEqual(await settled(), ["done"]);
  assert.equal(google.calls.length, 0);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 1]);
});

await test("a confirmation check with a token Google refuses never counts toward giving up, and the next webhook delivery adds the event", async () => {
  setEnv(fullEnv());
  google.fail = (at) => (at === "events" ? 500 : 0);
  const session = paid(ONE_WAY);
  assert.equal((await hook(session)).status, 503);
  google.fail = (at) => (at === "sts" ? 400 : 0);
  for (let i = 0; i < 6; i++) {
    aged(session);
    await lookup(session, { "x-vercel-oidc-token": "a.b.c" });
    assert.deepEqual(await settled(), ["calendar"]);
    assert.equal(waiting(session)[2], "1");
  }
  assert.equal(google.calls.filter((c) => c.url === STS_URL && new URLSearchParams(c.body).get("subject_token") === "a.b.c").length, 6);
  aged(session);
  await lookup(session, { "x-vercel-oidc-token": "not a token" });
  assert.deepEqual(await settled(), ["calendar"]);
  assert.equal(waiting(session)[2], "1");
  assert.ok(logged.includes("calendar-fail 83558982 sts 400"));
  assert.ok(logged.includes("calendar-token 83558982"));
  assert.ok(!logged.includes("calendar-gave-up 83558982"));
  google.fail = null;
  aged(session);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 1]);
  assert.ok(doneOf(session));
});

await test("a header that is not a JWT falls back to VERCEL_OIDC_TOKEN", () => {
  setEnv({ VERCEL_OIDC_TOKEN: ENV_OIDC });
  for (const bad of ["not-a-jwt", "a.b", "a.b.c d", `${"a".repeat(9000)}.b.c`]) assert.equal(oidcToken(bad), ENV_OIDC, bad);
});

await test("a network failure at each Google step is logged with status 0 and retried, and the emails and the text are untouched", async () => {
  for (const stage of ["sts", "iam", "events"]) {
    setEnv(fullEnv());
    google.custom = (at) => (at === stage ? Promise.reject(new TypeError("fetch failed")) : null);
    const session = paid(ONE_WAY);
    assert.equal((await hook(session)).status, 503, stage);
    assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 0], stage);
    assert.ok(logged.includes(`calendar-fail 83558982 ${stage} 0`), logged.join(" | "));
    assert.equal(waiting(session)[2], "1", stage);
    google.custom = null;
    aged(session);
    assert.equal((await hook(session)).status, 200, stage);
    assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 1], stage);
    assert.ok(doneOf(session), stage);
  }
});

await test("a Google step that hangs is cut off by the 4 second timeout and retried", async () => {
  const real = AbortSignal.timeout;
  const asked = [];
  AbortSignal.timeout = (ms) => {
    asked.push(ms);
    return real.call(AbortSignal, 50);
  };
  try {
    for (const stage of ["sts", "events"]) {
      setEnv(fullEnv());
      asked.length = 0;
      google.custom = (at, init) => (at === stage ? new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })) : null);
      const session = paid(ONE_WAY);
      assert.equal((await hook(session)).status, 503, stage);
      assert.ok(asked.includes(4000), asked.join(" "));
      assert.ok(logged.includes(`calendar-fail 83558982 ${stage} 0`), logged.join(" | "));
      assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 0], stage);
      assert.equal(waiting(session)[2], "1", stage);
    }
  } finally {
    AbortSignal.timeout = real;
  }
});

await test("a 200 from STS or IAM without a token, or with a body that is not JSON, fails at that step and is retried", async () => {
  const bodies = [["sts", "{}"], ["sts", "<html>busy</html>"], ["iam", "{}"], ["iam", "not json"]];
  for (const [stage, body] of bodies) {
    setEnv(fullEnv());
    google.custom = (at) => (at === stage ? new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }) : null);
    const session = paid(ONE_WAY);
    assert.equal((await hook(session)).status, 503, `${stage} ${body}`);
    assert.ok(logged.includes(`calendar-fail 83558982 ${stage} 200`), logged.join(" | "));
    assert.deepEqual(stages().slice(-1), [stage]);
    assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 0]);
    assert.equal(waiting(session)[2], "1");
  }
});

await test("daylight saving time: a July pickup starts at UTC minus 4, and round trips across the November and March clock changes get each leg's own offset", () => {
  setEnv();
  const [july] = bookingEvents(paid({ ...ONE_WAY, metadata: { ...ONE_WAY.metadata, date: "2027-07-15" } }));
  assert.deepEqual([july.start.dateTime, july.end.dateTime], ["2027-07-15T14:00:00.000Z", "2027-07-15T15:00:00.000Z"]);
  const [fallOut, fallBack] = bookingEvents(paid({ ...ROUND, metadata: { ...ROUND.metadata, date: "2027-10-29", return_date: "2027-11-08" } }));
  assert.deepEqual([fallOut.start.dateTime, fallOut.end.dateTime, fallBack.start.dateTime, fallBack.end.dateTime], ["2027-10-29T11:30:00.000Z", "2027-10-29T12:30:00.000Z", "2027-11-08T23:00:00.000Z", "2027-11-09T00:00:00.000Z"]);
  const [springOut, springBack] = bookingEvents(paid({ ...ROUND, metadata: { ...ROUND.metadata, date: "2027-03-12", return_date: "2027-03-15" } }));
  assert.deepEqual([springOut.start.dateTime, springBack.start.dateTime], ["2027-03-12T12:30:00.000Z", "2027-03-15T22:00:00.000Z"]);
  assert.ok([july, fallOut, fallBack, springOut, springBack].every((event) => event.start.timeZone === "America/New_York"));
});

const NOV17 = Date.parse("2026-11-17T15:00:00.000Z") / 1000;
const NOV18 = Date.parse("2026-11-18T16:00:00.000Z") / 1000;
const PRICED = { ...ONE_WAY, total: 24798 };
const signed = (body, headers = withToken(), secret = SECRET) => {
  const at = Math.floor(Date.now() / 1000);
  const signature = `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
  return POST(new Request("https://www.nycluxride.com/api/stripe-webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature, ...headers }, body }));
};
function refundBody(session, { refunded = session.amount_total, amount = session.amount_total, full = refunded === amount, created = NOV17, intent = session.payment_intent } = {}) {
  const charge = { id: `ch_${session.payment_intent.slice(3)}`, object: "charge", amount, amount_captured: amount, amount_refunded: refunded, refunded: full, paid: true, status: "succeeded", currency: "usd", livemode: session.livemode, payment_intent: intent };
  return JSON.stringify({ id: `evt_Refund${created}${refunded}`, object: "event", type: "charge.refunded", created, livemode: session.livemode, data: { object: charge } });
}
const refund = (session, options, headers) => signed(refundBody(session, options), headers);
const held = (session) => {
  for (const event of bookingEvents(session)) google.events.set(event.id, structuredClone(event));
  return bookingEvents(session);
};
const eventPath = (id) => `${EVENTS_URL}/${id}`;
const refundCalls = () => google.calls.map((c) => (c.url === STS_URL ? "sts" : c.url === IAM_URL ? "iam" : c.url.startsWith(`${EVENTS_URL}/`) ? `${c.method} ${c.url.slice(EVENTS_URL.length + 1)}` : c.url));
const patches = () => google.calls.filter((c) => c.method === "PATCH").map((c) => [c.url.slice(EVENTS_URL.length + 1), JSON.parse(c.body)]);
const lookups = () => stripe.calls.filter((c) => c.path === "/v1/checkout/sessions");
const untouched = () => assert.deepEqual([smtp.messages.length, twilio.calls.length, writes().length], [0, 0, 0]);
const NOTE_FULL = "Cancelled and refunded $247.98 on Nov 17, 2026.";

await test("refund: an unsigned or wrongly signed charge.refunded is refused with 400 and asks Stripe and Google nothing", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  held(session);
  const body = refundBody(session);
  assert.equal((await signed(body, withToken(), ["whsec", "SomeoneElsesSecret01"].join("_"))).status, 400);
  assert.equal((await POST(new Request("https://www.nycluxride.com/api/stripe-webhook", { method: "POST", headers: { "content-type": "application/json", ...withToken() }, body }))).status, 400);
  const at = Math.floor(Date.now() / 1000);
  const stale = `t=${at - 600},v1=${createHmac("sha256", SECRET).update(`${at - 600}.${body}`).digest("hex")}`;
  assert.equal((await POST(new Request("https://www.nycluxride.com/api/stripe-webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stale, ...withToken() }, body }))).status, 400);
  assert.deepEqual([stripe.calls.length, google.calls.length], [0, 0]);
  assert.equal(logged.filter((line) => line === "webhook-signature").length, 3);
  assert.deepEqual(bookingEvents(session).map((event) => google.events.get(event.id)), bookingEvents(session));
});

await test("refund: a full refund of a one way trip finds the session from the payment intent and patches the event title and description, nothing else", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = held(session);
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual(lookups().map((c) => [c.method, c.search]), [["GET", `?payment_intent=${session.payment_intent}`]]);
  assert.deepEqual(refundCalls(), ["sts", "iam", `GET ${event.id}`, `PATCH ${event.id}`]);
  const patch = google.calls.find((c) => c.method === "PATCH");
  assert.equal(patch.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
  assert.equal(patch.headers.get("content-type"), "application/json");
  assert.equal(patch.headers.get("if-match"), '"1"');
  assert.equal(patch.url, eventPath(event.id));
  assert.deepEqual(JSON.parse(patch.body), {
    summary: "[TEST] CANCELLED: 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)",
    description: [NOTE_FULL, "Test booking. No real payment was taken.", "Reference: 83558982", "Customer: Ana Lopez", "Phone: +1 212 555 0100", "Email: ana.lopez@example.com", "Trip: One way", "Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Date: Sun, Nov 8, 2026", "Time: 10:00 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", "Paid: $247.98"].join("\n"),
    extendedProperties: { private: { nlrRefundedCents: "24798" } },
  });
  const now = google.events.get(event.id);
  assert.deepEqual([now.start, now.end, now.location, now.reminders], [event.start, event.end, event.location, event.reminders]);
  untouched();
  assert.ok(noted.includes("calendar-refunded 83558982 1 0"), noted.join(" | "));
  assert.deepEqual(logged, []);
});

await test("refund: a full refund of a round trip renames and notes both legs, the return keeping its Return title after CANCELLED", async () => {
  setEnv(fullEnv());
  const session = paid(ROUND);
  const [out, back] = held(session);
  assert.equal((await refund(session)).status, 200);
  const done = patches();
  assert.deepEqual(done.map(([id]) => id).sort(), [out.id, back.id].sort());
  const byId = Object.fromEntries(done);
  assert.equal(byId[out.id].summary, "[TEST] CANCELLED: 83558982 Business Premium SUV: JFK to 350 5th Ave");
  assert.equal(byId[back.id].summary, "[TEST] CANCELLED: Return: 83558982 Business Premium SUV: 350 5th Ave to JFK");
  for (const event of [out, back]) {
    assert.equal(byId[event.id].description, `Cancelled and refunded $520.95 on Nov 17, 2026.\n${event.description}`);
    assert.deepEqual(byId[event.id].extendedProperties, { private: { nlrRefundedCents: "52095" } });
  }
  untouched();
  assert.ok(noted.includes("calendar-refunded 83558982 2 0"));
});

await test("refund: a partial refund keeps the title and starts the description with how much of the total went back", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = held(session);
  assert.equal((await refund(session, { refunded: 5000 })).status, 200);
  const [[id, body]] = patches();
  assert.equal(id, event.id);
  assert.deepEqual(body, { summary: event.summary, description: `Partly refunded $50.00 of $247.98 on Nov 17, 2026.\n${event.description}`, extendedProperties: { private: { nlrRefundedCents: "5000" } } });
  assert.equal(google.events.get(event.id).summary, "[TEST] 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)");
  untouched();
});

await test("refund: a charge counts as fully refunded when Stripe marks it refunded or when the refunded amount reaches the charge amount", async () => {
  for (const options of [{ full: false }, { full: true, refunded: 24798 }]) {
    setEnv(fullEnv());
    const session = paid(PRICED);
    const [event] = held(session);
    assert.equal((await refund(session, options)).status, 200);
    assert.deepEqual(patches()[0][1].summary, `[TEST] CANCELLED: ${event.summary.slice("[TEST] ".length)}`, JSON.stringify(options));
    assert.ok(patches()[0][1].description.startsWith(`${NOTE_FULL}\n`));
  }
});

await test("refund: a full refund after a partial one replaces the partial note, and the earlier partial event arriving late changes nothing", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = held(session);
  assert.equal((await refund(session, { refunded: 5000 })).status, 200);
  assert.equal((await refund(session, { refunded: 15000, created: NOV17 + 3600 })).status, 200);
  assert.ok(google.events.get(event.id).description.startsWith(`Partly refunded $150.00 of $247.98 on Nov 17, 2026.\n${event.description.split("\n")[0]}`));
  assert.equal((await refund(session, { created: NOV18 })).status, 200);
  const final = google.events.get(event.id);
  assert.equal(final.summary, "[TEST] CANCELLED: 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)");
  assert.equal(final.description, `Cancelled and refunded $247.98 on Nov 18, 2026.\n${event.description}`);
  assert.ok(!final.description.includes("Partly"));
  assert.equal(final.extendedProperties.private.nlrRefundedCents, "24798");
  const snapshot = structuredClone(final);
  google.calls.length = 0;
  for (const late of [{ refunded: 5000 }, { refunded: 15000, created: NOV17 + 3600 }]) assert.equal((await refund(session, late)).status, 200);
  assert.deepEqual(google.events.get(event.id), snapshot);
  assert.equal(patches().length, 0);
  untouched();
});

await test("refund: the same delivery twice leaves the event exactly as the first one did, and a fresh copy of the event patched by the second delivery gets the same body", async () => {
  setEnv(fullEnv());
  const session = paid(ROUND);
  const events = held(session);
  assert.equal((await refund(session)).status, 200);
  const first = events.map((event) => structuredClone(google.events.get(event.id)));
  const bodies = Object.fromEntries(patches());
  google.calls.length = 0;
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual(events.map((event) => google.events.get(event.id)), first);
  assert.equal(patches().length, 0);
  assert.ok(noted.includes("calendar-refunded 83558982 0 2"));
  held(session);
  google.calls.length = 0;
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual(Object.fromEntries(patches()), bodies);
  assert.deepEqual(events.map((event) => ({ ...google.events.get(event.id), etag: "" })), first.map((event) => ({ ...event, etag: "" })));
});

await test("refund: a charge with no Checkout Session, a session that is not a booking, a charge with no payment intent or nothing refunded all answer 200 and touch no event", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  held(session);
  assert.equal((await refund(session, { intent: "pi_NoSuchIntent01" })).status, 200);
  assert.equal(lookups().length, 1);
  const link = paid({ ...PRICED, metadata: {} });
  stripe.sessions.get(link.id).client_reference_id = null;
  assert.equal((await refund(link)).status, 200);
  const undated = paid({ ...PRICED, metadata: { ...PRICED.metadata, date: "", time: "" } });
  assert.equal((await refund(undated)).status, 200);
  assert.equal(lookups().length, 3);
  for (const options of [{ intent: null }, { intent: "not an intent" }, { refunded: 0 }, { refunded: 30000 }, { created: 0 }]) assert.equal((await refund(session, options)).status, 200, JSON.stringify(options));
  assert.equal((await signed(JSON.stringify({ id: "evt_NotACharge", object: "event", type: "charge.refunded", created: NOV17, data: { object: { id: session.id, object: "checkout.session" } } }))).status, 200);
  assert.equal(lookups().length, 3);
  assert.deepEqual(google.calls.length, 0);
  assert.equal(google.events.get(bookingEvents(session)[0].id).summary, bookingEvents(session)[0].summary);
  untouched();
  assert.deepEqual(logged, []);
});

await test("refund: an event that is not in the calendar yet is added already cancelled, one that was deleted from it is skipped without an error while the other leg is still patched", async () => {
  setEnv(fullEnv());
  const session = paid(ROUND);
  assert.equal((await refund(session)).status, 200);
  const [out, back] = bookingEvents(session);
  assert.deepEqual(refundCalls().filter((c) => c.startsWith("GET")).sort(), [`GET ${out.id}`, `GET ${back.id}`].sort());
  assert.equal(patches().length, 0);
  const added = inserted();
  assert.deepEqual(added.map((event) => event.id).sort(), [out.id, back.id].sort());
  for (const event of [out, back]) {
    const now = google.events.get(event.id);
    assert.deepEqual(added.find((one) => one.id === event.id), now);
    assert.deepEqual(now, { ...event, summary: `[TEST] CANCELLED: ${event.summary.slice("[TEST] ".length)}`, description: `Cancelled and refunded $520.95 on Nov 17, 2026.\n${event.description}`, extendedProperties: { private: { nlrRefundedCents: "52095" } } });
  }
  assert.ok(noted.includes("calendar-refunded 83558982 2 0"), noted.join(" | "));
  assert.deepEqual(logged, []);
  google.calls.length = 0;
  google.events.set(back.id, structuredClone(back));
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual(patches().map(([id]) => id), [back.id]);
  assert.equal(inserted().length, 0);
  google.calls.length = 0;
  google.events.set(out.id, { ...structuredClone(out), status: "cancelled" });
  assert.equal((await refund(session, { refunded: 60000, amount: 60000 })).status, 200);
  assert.deepEqual(patches().map(([id]) => id), [back.id]);
  assert.equal(google.events.get(out.id).summary, out.summary);
  google.calls.length = 0;
  google.custom = (at, init) => (at === "events" && init.method === "PATCH" ? answer(410, { error: { code: 410, message: "Resource has been deleted" } }) : null);
  assert.equal((await refund(session, { refunded: 70000, amount: 70000 })).status, 200);
  google.calls.length = 0;
  google.events.clear();
  google.custom = (at, init) => (at === "events" && (init.method || "GET") === "GET" ? answer(410, { error: { code: 410, message: "Resource has been deleted" } }) : null);
  assert.equal((await refund(session, { refunded: 80000, amount: 80000 })).status, 200);
  assert.deepEqual([inserted().length, patches().length, google.events.size], [0, 0, 0]);
  assert.deepEqual(logged, []);
  untouched();
});

await test("refund: a full refund before the event was added, then the payment notice again, leaves one cancelled event and adds no second one", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = bookingEvents(session);
  google.fail = (at) => (at === "sts" ? 503 : 0);
  assert.equal((await hook(session)).status, 503);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 0]);
  assert.ok(waiting(session));
  google.fail = null;
  google.calls.length = 0;
  logged.length = 0;
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual(refundCalls(), ["sts", "iam", `GET ${event.id}`, EVENTS_URL]);
  const cancelled = { ...event, summary: "[TEST] CANCELLED: 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)", description: `${NOTE_FULL}\n${event.description}`, extendedProperties: { private: { nlrRefundedCents: "24798" } } };
  assert.deepEqual(google.events.get(event.id), cancelled);
  assert.ok(noted.includes("calendar-refunded 83558982 1 0"), noted.join(" | "));
  assert.deepEqual(logged, []);
  aged(session);
  google.calls.length = 0;
  let answered = 0;
  google.custom = (at, init) => {
    if (at !== "events" || init.method !== "POST") return null;
    const sent = JSON.parse(init.body);
    if (!google.events.has(sent.id)) return null;
    answered++;
    return answer(409, { error: { code: 409, message: "The requested identifier already exists.", status: "ALREADY_EXISTS" } });
  };
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(inserted().map((one) => one.summary), [event.summary]);
  assert.equal(answered, 1);
  assert.deepEqual([google.events.size, google.events.get(event.id)], [1, cancelled]);
  assert.ok(doneOf(session));
  assert.equal((await lookup(session)).status, 200);
  await settled();
  assert.deepEqual(google.events.get(event.id), cancelled);
  assert.deepEqual([smtp.messages.length, twilio.calls.length], [2, 1]);
});

await test("refund: an event added by the payment notice between the refund's look and its insert is found again and patched", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = bookingEvents(session);
  let raced = false;
  google.custom = (at, init) => {
    if (at !== "events" || init.method !== "POST" || raced) return null;
    raced = true;
    google.events.set(event.id, structuredClone(event));
    return answer(409, { error: { code: 409, message: "The requested identifier already exists.", status: "ALREADY_EXISTS" } });
  };
  assert.equal((await refund(session, { refunded: 5000 })).status, 200);
  assert.deepEqual(refundCalls(), ["sts", "iam", `GET ${event.id}`, EVENTS_URL, `GET ${event.id}`, `PATCH ${event.id}`]);
  const now = google.events.get(event.id);
  assert.deepEqual([now.summary, now.description, now.extendedProperties], [event.summary, `Partly refunded $50.00 of $247.98 on Nov 17, 2026.\n${event.description}`, { private: { nlrRefundedCents: "5000" } }]);
  assert.ok(noted.includes("calendar-refunded 83558982 1 0"), noted.join(" | "));
  assert.deepEqual(logged, []);
  untouched();
});

await test("refund: what the owner typed into the event stays through a partial and then a full refund, and only the refund line and CANCELLED change", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = held(session);
  const notes = `${event.description}\nDriver: Sam, plate T123`;
  google.events.set(event.id, { ...structuredClone(event), summary: "[TEST] 83558982 Sam to EWR", description: notes });
  assert.equal((await refund(session, { refunded: 5000 })).status, 200);
  let now = google.events.get(event.id);
  assert.deepEqual([now.summary, now.description], ["[TEST] 83558982 Sam to EWR", `Partly refunded $50.00 of $247.98 on Nov 17, 2026.\n${notes}`]);
  now.description = `${now.description}\nPickup moved to door 4`;
  assert.equal((await refund(session, { created: NOV18 })).status, 200);
  now = google.events.get(event.id);
  assert.equal(now.summary, "[TEST] CANCELLED: 83558982 Sam to EWR");
  assert.equal(now.description, `Cancelled and refunded $247.98 on Nov 18, 2026.\n${notes}\nPickup moved to door 4`);
  assert.equal(now.description.split("\n").filter((line) => /^(Partly|Cancelled)/.test(line)).length, 1);
  assert.deepEqual([now.start, now.end, now.location, now.reminders], [event.start, event.end, event.location, event.reminders]);
  setEnv(fullEnv());
  const live = paid(PRICED, { live: true });
  const [mine] = held(live);
  google.events.set(mine.id, { ...structuredClone(mine), summary: "Sam: JFK run", description: undefined });
  assert.equal((await refund(live)).status, 200);
  now = google.events.get(mine.id);
  assert.deepEqual([now.summary, now.description], ["CANCELLED: Sam: JFK run", NOTE_FULL]);
  setEnv(fullEnv());
  const twice = paid(PRICED);
  const [again] = held(twice);
  google.events.set(again.id, { ...structuredClone(again), summary: `CANCELLED: ${again.summary}` });
  assert.equal((await refund(twice)).status, 200);
  assert.equal(google.events.get(again.id).summary, "[TEST] CANCELLED: 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)");
  untouched();
});

await test("refund: Google failing for a moment answers 503 so Stripe sends it again, and the retry patches the events", async () => {
  for (const [stage, status] of [["sts", 503], ["iam", 429], ["events", 500], ["events", 0]]) {
    setEnv(fullEnv());
    const session = paid(ROUND);
    held(session);
    google.fail = (at) => (at === stage ? status || 503 : 0);
    assert.equal((await refund(session)).status, 503, `${stage} ${status}`);
    assert.ok(logged.some((line) => line.startsWith(`calendar-fail 83558982 ${stage === "events" ? "refund" : stage}`)), logged.join(" | "));
    assert.ok(!logged.includes("calendar-gave-up 83558982"));
    assert.ok(bookingEvents(session).every((event) => !google.events.get(event.id).summary.includes("CANCELLED")));
    google.fail = null;
    assert.equal((await refund(session)).status, 200, `${stage} ${status}`);
    assert.ok(bookingEvents(session).every((event) => google.events.get(event.id).summary.startsWith("[TEST] CANCELLED: ")), stage);
    untouched();
  }
  setEnv(fullEnv());
  const session = paid(PRICED);
  held(session);
  google.custom = (at) => (at === "events" ? Promise.reject(new TypeError("fetch failed")) : null);
  assert.equal((await refund(session)).status, 503);
  google.custom = null;
  let raced = false;
  google.custom = (at, init) => (at === "events" && init.method === "PATCH" && !raced ? ((raced = true), answer(412, { error: { code: 412, message: "Precondition Failed" } })) : null);
  assert.equal((await refund(session)).status, 503);
  assert.ok(logged.includes("calendar-fail 83558982 refund 412"), logged.join(" | "));
  assert.equal((await refund(session)).status, 200);
  assert.ok(google.events.get(bookingEvents(session)[0].id).summary.startsWith("[TEST] CANCELLED: "));
});

await test("refund: Stripe failing for a moment answers 503 and asks Google nothing, and a Stripe refusal that will not fix itself answers 200", async () => {
  for (const status of [500, 429, 0, 401, 403]) {
    setEnv(fullEnv());
    const session = paid(PRICED);
    held(session);
    stripe.list = () => status;
    if (!status) {
      stripe.list = null;
      const real = globalThis.fetch;
      globalThis.fetch = async (url, init) => (String(url).startsWith("https://api.stripe.com/") ? Promise.reject(new TypeError("fetch failed")) : real(url, init));
      try {
        assert.equal((await refund(session)).status, 503);
      } finally {
        globalThis.fetch = real;
      }
    } else assert.equal((await refund(session)).status, 503, String(status));
    assert.equal(google.calls.length, 0);
    assert.ok(!logged.some((line) => line.startsWith("refund-gave-up")), logged.join(" | "));
    stripe.list = null;
    assert.equal((await refund(session)).status, 200);
    assert.equal(patches().length, 1);
    assert.ok(google.events.get(bookingEvents(session)[0].id).summary.startsWith("[TEST] CANCELLED: "), String(status));
  }
  for (const status of [400, 404]) {
    setEnv(fullEnv());
    const session = paid(PRICED);
    held(session);
    stripe.list = () => status;
    assert.equal((await refund(session)).status, 200, String(status));
    assert.ok(logged.includes(`refund-gave-up stripe ${status}`), logged.join(" | "));
    assert.equal(google.calls.length, 0);
  }
  setEnv(fullEnv({ STRIPE_SECRET_KEY: "" }));
  assert.equal((await refund(paid(PRICED))).status, 503);
  assert.equal(google.calls.length, 0);
});

await test("refund: a thin v1.charge.refunded with no charge snapshot answers 200, logs one unreadable line and changes no event", async () => {
  setEnv(fullEnv());
  const session = paid(PRICED);
  const [event] = held(session);
  const thin = { id: "evt_ThinRefund01", object: "v2.core.event", type: "v1.charge.refunded", created: "2026-11-17T15:00:00.000Z", livemode: false, related_object: { id: `ch_${session.payment_intent.slice(3)}`, type: "charge", url: `/v1/charges/ch_${session.payment_intent.slice(3)}` } };
  assert.equal((await signed(JSON.stringify(thin))).status, 200);
  assert.deepEqual(logged, ["refund-unreadable"]);
  assert.deepEqual([stripe.calls.length, google.calls.length], [0, 0]);
  assert.deepEqual(google.events.get(event.id), event);
  untouched();
  setEnv(fullEnv(Object.fromEntries(Object.keys(GCAL).map((k) => [k, ""]))));
  assert.equal((await signed(JSON.stringify(thin))).status, 200);
  assert.deepEqual([logged.length, stripe.calls.length, google.calls.length], [0, 0, 0]);
});

await test("refund: a Google refusal that will not fix itself answers 200 with a gave-up line, and a missing OIDC token gives up at once", async () => {
  for (const [stage, status] of [["sts", 400], ["sts", 401], ["iam", 403], ["events", 403], ["events", 400], ["events", 401]]) {
    setEnv(fullEnv());
    const session = paid(ROUND);
    held(session);
    google.fail = (at) => (at === stage ? status : 0);
    assert.equal((await refund(session)).status, 200, `${stage} ${status}`);
    assert.ok(logged.some((line) => line.startsWith(`calendar-fail 83558982 ${stage === "events" ? "refund" : stage} ${status}`)), logged.join(" | "));
    assert.equal(logged.filter((line) => line === "calendar-gave-up 83558982").length, 1, `${stage} ${status}`);
    untouched();
  }
  setEnv(fullEnv());
  google.fail = (at, call) => (at === "events" && call.method === "PATCH" ? (call.url.includes("83558982a") ? 403 : 500) : 0);
  const mixed = paid(ROUND);
  held(mixed);
  assert.equal((await refund(mixed)).status, 503);
  assert.ok(logged.some((line) => /^calendar-fail 83558982 refund (403 500|500 403)$/.test(line)), logged.join(" | "));
  setEnv(fullEnv());
  const session = paid(PRICED);
  held(session);
  assert.equal((await refund(session, {}, {})).status, 200);
  assert.equal(google.calls.length, 0);
  assert.ok(logged.includes("calendar-token 83558982"));
  assert.ok(logged.includes("calendar-gave-up 83558982"));
});

await test("refund: with the calendar settings off the webhook answers 200 and calls nobody, and with them misconfigured it answers 200 with one config line", async () => {
  setEnv(fullEnv(Object.fromEntries(Object.keys(GCAL).map((k) => [k, ""]))));
  const session = paid(PRICED);
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual([stripe.calls.length, google.calls.length], [0, 0]);
  assert.deepEqual(logged, []);
  untouched();
  setEnv(fullEnv({ GCAL_WIF_AUDIENCE: "" }));
  assert.equal((await refund(paid(PRICED))).status, 200);
  assert.equal(google.calls.length, 0);
  assert.ok(logged.includes("calendar-config 83558982"));
  untouched();
});

await test("refund: a live booking is renamed CANCELLED with no [TEST], a test booking reads [TEST] CANCELLED, and the date is the New York day of the refund", async () => {
  setEnv(fullEnv());
  const live = paid(PRICED, { live: true });
  const [event] = held(live);
  assert.equal((await refund(live, { created: Date.parse("2026-11-18T03:30:00.000Z") / 1000 })).status, 200);
  const [[, body]] = patches();
  assert.equal(body.summary, "CANCELLED: 83558982 Business SUV: 253 West 72nd Street to Newark Liberty (EWR)");
  assert.equal(body.description, `${NOTE_FULL}\n${event.description}`);
  assert.ok(!body.description.includes("Test booking"));
  setEnv(fullEnv());
  const test = paid(HOURLY);
  held(test);
  assert.equal((await refund(test, { created: Date.parse("2026-07-04T03:30:00.000Z") / 1000 })).status, 200);
  const [[, hourly]] = patches();
  assert.equal(hourly.summary, "[TEST] CANCELLED: 83558982 Business Premium SUV: 4 hours from 1 Main Street");
  assert.ok(hourly.description.startsWith(`Cancelled and refunded ${"$"}${(HOURLY.total / 100).toFixed(2)} on Jul 3, 2026.\nTest booking.`), hourly.description);
});

await test("checkout.session.completed is untouched by refunds: emails, text and events go out as before, a refund then renames the events, and the next payment notice adds and sends nothing", async () => {
  setEnv(fullEnv());
  const session = paid(ROUND);
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events", "events"]);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 2]);
  assert.ok(doneOf(session));
  const marks = writes().length;
  const metadata = structuredClone(markersOf(session));
  const added = inserted();
  google.calls.length = 0;
  assert.equal((await refund(session, { refunded: 2000 })).status, 200);
  assert.equal((await refund(session)).status, 200);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, writes().length], [2, 1, marks]);
  assert.deepEqual(markersOf(session), metadata);
  for (const event of added) {
    const now = google.events.get(event.id);
    assert.ok(now.summary.startsWith("[TEST] CANCELLED: "), now.summary);
    assert.equal(now.description, `Cancelled and refunded $520.95 on Nov 17, 2026.\n${event.description}`);
  }
  google.calls.length = 0;
  assert.equal((await hook(session)).status, 200);
  assert.deepEqual([google.calls.length, smtp.messages.length, twilio.calls.length], [0, 2, 1]);
  setEnv(fullEnv());
  const fresh = paid(ONE_WAY);
  assert.equal((await hook(fresh)).status, 200);
  assert.deepEqual(stages(), ["sts", "iam", "events"]);
  assert.deepEqual([smtp.messages.length, twilio.calls.length, google.events.size], [2, 1, 1]);
  assert.equal(lookups().length, 0);
  assert.ok(doneOf(fresh));
});

await test("no log line holds the OIDC token, the STS token, the access token, the calendar id or the service account", () => {
  const needles = [OIDC, ENV_OIDC, STS_TOKEN, ACCESS_TOKEN, GCAL.GCAL_CALENDAR_ID, GCAL.GCAL_SERVICE_ACCOUNT, OIDC.split(".")[2], STS_TOKEN.slice(5), ACCESS_TOKEN.slice(5)];
  assert.ok(history.length > 20, `only ${history.length} lines`);
  assert.deepEqual(history.filter((line) => needles.some((needle) => line.includes(needle))), []);
  assert.ok(history.every((line) => !/ya29|Bearer|eyJ/.test(line)), history.filter((line) => /ya29|Bearer|eyJ/.test(line)).join(" | "));
});

smtp.server.close();
delete globalThis[CONTEXT];
if (failures) {
  process.stderr.write(`\n${failures} calendar test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll calendar tests passed\n");
process.exit(0);
