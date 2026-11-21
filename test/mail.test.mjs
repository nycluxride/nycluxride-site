import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, getCACertificates, setDefaultCACertificates } from "node:tls";
import { createServer as createNetServer } from "node:net";
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readInput, resolveTrip, priceTrip, readSettings, receipt, shownLines, money, fill, nycToUtc, bookingData } from "../api/_trip.mjs";
import { routeKey, signRoute, signTicket } from "../api/_ticket.mjs";
import { metadataFor } from "../api/_stripe.mjs";
import { MAIL, CHECKOUT, NOTES, POLICY } from "../api/_copy.mjs";
import { smtpSend, buildMessage, header, mailbox } from "../api/_smtp.mjs";
import { bookingLetters as lettersAt, mailSettings, bookingText, bookingEvents, refundChanges } from "../api/_mail.mjs";
import { GET } from "../api/book.mjs";
import { POST } from "../api/stripe-webhook.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const NOW = new Date("2026-11-01T15:00:00.000Z");
const bookingLetters = (session, settings, now = NOW.getTime()) => lettersAt(session, settings, now);
const REF = "83558982";
const KEY = ["rk", "test", "51NlrMailTestKeyOnly"].join("_");
const LIVE_KEY = ["rk", "live", "51NlrMailTestKeyOnly"].join("_");
const SECRET = ["whsec", "NlrMailTestSigningSecret01"].join("_");
const USER = "info@nycluxride.com";
const PASS = "test-app-password-9137";
const OWNERS = ["info@nycluxride.com", "nycluxride@gmail.com"];
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "VERCEL_ENV", "BOOK_MOCK", "PAYMENTS_ENABLED", "GOOGLE_MOCK", "BOOKING_REF_SECRET", "PAY_BLACKOUT_DATES", "FLIGHT_MOCK", "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY", "TWILIO_API_SECRET", "TWILIO_FROM", "OWNER_SMS"];
const sid = (prefix, seed) => `${prefix}${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
const ACCOUNT_SID = sid("AC", "mail test account");
const API_KEY_SID = sid("SK", "mail test key");
const API_SECRET = sid("", "mail test secret");
const SENDER = "+12125550199";
const OWNER_PHONE = "+16467750556";
const SMS = { TWILIO_ACCOUNT_SID: ACCOUNT_SID, TWILIO_API_KEY: API_KEY_SID, TWILIO_API_SECRET: API_SECRET, TWILIO_FROM: SENDER };
const CONTEXT = Symbol.for("@vercel/request-context");
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
const MANHATTAN = "350 5th Ave, New York, NY 10118";

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

const certDir = mkdtempSync(join(tmpdir(), "nlr-mail-test-"));
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

function fakeSmtp() {
  const state = { sessions: [], behavior: {}, sockets: new Set(), refused: 0 };
  const server = createServer({ key: TLS_KEY, cert: TLS_CERT }, (socket) => {
    state.sockets.add(socket);
    socket.on("close", () => state.sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("latin1");
    const session = { commands: [], auth: null, messages: [], wire: [] };
    state.sessions.push(session);
    const b = state.behavior;
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
            const refusal = b.refuse ? b.refuse(mail) : "";
            if (!refusal) session.messages.push(mail);
            data = null;
            mail = null;
            say(refusal || "250 2.0.0 OK queued");
          } else {
            session.wire.push(line);
            data.push(line.startsWith(".") ? line.slice(1) : line);
          }
          continue;
        }
        const verb = line.split(" ")[0].toUpperCase();
        session.commands.push(verb === "AUTH" ? line.split(" ").slice(0, 2).join(" ") : line);
        if (b.hang === verb) continue;
        if (verb === "EHLO") {
          say("250-fake.test");
          say("250-AUTH LOGIN PLAIN");
          say("250 SMTPUTF8");
        } else if (verb === "AUTH") {
          session.auth = Buffer.from(line.split(" ")[2] || "", "base64").toString("utf8");
          say(b.auth || "235 2.7.0 Accepted");
        } else if (verb === "MAIL") {
          if (b.sender) say(b.sender);
          else {
            mail = { from: /<([^>]*)>/.exec(line)[1], to: [] };
            say("250 2.1.0 OK");
          }
        } else if (verb === "RCPT") {
          const to = /<([^>]*)>/.exec(line)[1];
          if ((b.reject || []).includes(to)) say("550 5.1.1 No such user");
          else {
            mail.to.push(to);
            say("250 2.1.5 OK");
          }
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
  server.on("tlsClientError", () => state.refused++);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(Object.assign(state, { server, port: server.address().port }))));
}

const stripe = { sessions: new Map(), intents: new Map(), keys: new Map(), calls: [], intentCalls: [], intentAccess: "write", sessionUpdates: "allow", delay: 0, lose: null, fail: null };
const answer = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "request-id": "req_fake0001", ...headers } });
const forbidden = () => answer(403, { error: { type: "invalid_request_error", message: "The provided key does not have the required permissions for this endpoint." } });
const missing = () => answer(404, { error: { type: "invalid_request_error", code: "resource_missing" } });

function apply(metadata, body) {
  for (const [name, value] of new URLSearchParams(body)) {
    const match = /^metadata\[(.+)\]$/.exec(name);
    if (!match) continue;
    if (value === "") delete metadata[match[1]];
    else metadata[match[1]] = value;
  }
}

async function keyed(key, body, run) {
  const saved = key ? stripe.keys.get(key) : null;
  if (saved && saved.body !== body) return answer(400, { error: { type: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters they were first used with." } });
  if (saved && saved.pending) return answer(409, { error: { type: "idempotency_error", message: "There is currently another in-progress request using this Idempotent Key." } });
  if (saved) return answer(saved.status, saved.result, { "idempotent-replayed": "true" });
  const entry = { body, pending: true };
  if (key) stripe.keys.set(key, entry);
  const ms = typeof stripe.delay === "function" ? stripe.delay(key) : stripe.delay;
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  const [status, result] = run();
  Object.assign(entry, { pending: false, status, result });
  return answer(status, result);
}

function idempotent(key, body, run) {
  const reply = keyed(key, body, run);
  if (!stripe.lose || !stripe.lose(key)) return reply;
  reply.catch(() => {});
  return Promise.reject(new TypeError("fetch failed"));
}

const twilio = { calls: [], replies: [] };
const twilioAnswer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Twilio-Request-Id": sid("RQ", `request ${twilio.calls.length}`) } });
const texted = (call) => twilioAnswer(201, { sid: sid("SM", `message ${twilio.calls.length}`), status: "queued", to: call.form.get("To"), body: call.form.get("Body") });
const turnedDown = (status, code) => () => twilioAnswer(status, { code, message: `Twilio could not send to ${OWNER_PHONE}`, more_info: `https://www.twilio.com/docs/errors/${code}`, status });
const dropped = (code) => () => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code} 203.0.113.9:443`), { code }) }));
const silent = (call) => new Promise((resolve, reject) => call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true }));

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  const method = init.method || "GET";
  const headers = new Headers(init.headers);
  const body = String(init.body || "");
  if (target.origin === "https://api.twilio.com") {
    const call = { url: target.href, method, auth: headers.get("authorization"), form: new URLSearchParams(body), signal: init.signal, mails: smtp.sessions.reduce((n, session) => n + session.messages.length, 0) };
    twilio.calls.push(call);
    return (twilio.replies.shift() || texted)(call);
  }
  stripe.calls.push({ method, path: target.pathname, idempotency: headers.get("idempotency-key") || "", body, auth: headers.get("authorization") });
  if (target.origin !== "https://api.stripe.com") return answer(599, {});
  if (stripe.fail && stripe.fail(method, target.pathname)) return answer(500, { error: { type: "api_error" } });
  let match = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(target.pathname);
  if (match) {
    const session = stripe.sessions.get(decodeURIComponent(match[1]));
    if (!session) return missing();
    if (method === "GET") return answer(200, structuredClone(session));
    const closed = { error: { type: "invalid_request_error", message: "This Checkout Session can no longer be updated." } };
    if (stripe.sessionUpdates === "refuse") return answer(400, closed);
    if (stripe.sessionUpdates === "refuse-kept") return idempotent(headers.get("idempotency-key"), body, () => [400, closed]);
    return idempotent(headers.get("idempotency-key"), body, () => {
      apply(session.metadata, body);
      return [200, structuredClone(session)];
    });
  }
  match = /^\/v1\/payment_intents\/([^/]+)$/.exec(target.pathname);
  if (match) {
    stripe.intentCalls.push(`${method} ${target.pathname}`);
    if (stripe.intentAccess === "none") return forbidden();
    const intent = stripe.intents.get(decodeURIComponent(match[1]));
    if (!intent) return missing();
    if (method === "GET") return answer(200, structuredClone(intent));
    if (stripe.intentAccess === "read") return forbidden();
    if (stripe.intentAccess === "read-kept") return idempotent(headers.get("idempotency-key"), body, () => [403, { error: { type: "invalid_request_error", message: "The provided key does not have the required permissions for this endpoint." } }]);
    return idempotent(headers.get("idempotency-key"), body, () => {
      apply(intent.metadata, body);
      return [200, structuredClone(intent)];
    });
  }
  return missing();
};

let waited = [];
const withContext = () => {
  waited = [];
  globalThis[CONTEXT] = { get: () => ({ waitUntil: (promise) => waited.push(promise) }) };
};
const withoutContext = () => {
  delete globalThis[CONTEXT];
  waited = [];
};
const settled = async () => {
  const results = await Promise.all(waited);
  waited = [];
  return results;
};
const until = async (check, ms = 10000) => {
  for (const end = Date.now() + ms; !check(); ) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const smtp = await fakeSmtp();
function setEnv(vars = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  logged.length = 0;
  noted.length = 0;
  stripe.calls.length = 0;
  stripe.intentAccess = "write";
  stripe.sessionUpdates = "allow";
  stripe.delay = 0;
  stripe.lose = null;
  stripe.fail = null;
  smtp.sessions.length = 0;
  smtp.behavior = {};
  twilio.calls.length = 0;
  twilio.replies = [];
  withoutContext();
}
const mailEnv = (extra = {}) => ({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, SMTP_USER: USER, SMTP_PASS: PASS, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), ...extra });

async function booked(fields) {
  const trip = await resolveTrip(readInput(fields), { now: NOW });
  const price = priceTrip(trip, readSettings({ PAYMENTS_ENABLED: "true" }));
  return { metadata: metadataFor(trip, price, REF), total: price.total };
}
setEnv({ GOOGLE_MOCK: "true" });
const ONE_WAY = await booked({ trip_type: "one", from_text: "253 West 72nd Street, New York, NY 10023, USA", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-08", time: "10:00", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "whatsapp" });
const ROUND = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "3", class: "premium", meet: "1", flight: "DL 401", tip: "15", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz Party", notes: "Infant seat, please\nTwo large cases" });
const HOURLY = await booked({ trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", tip: "custom", tip_amount: "40", rider: "me", ...ME, reach: "phone", notes: "A toddler seat, please" });
const NEW_JERSEY = await booked({ trip_type: "one", from_text: "Secaucus, NJ 07094", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-20", time: "05:15", passengers: "2", class: "sedan", tip: "20", rider: "me", ...ME, reach: "phone" });
const STOPS = await booked({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "277 Bedford Ave, Brooklyn, NY 11211", stop2_text: "John F. Kennedy (JFK)", stop2_id: "jfk", to_text: MANHATTAN, date: "2026-11-21", time: "09:00", passengers: "2", class: "suv", flight: "AA 100", tip: "0", rider: "me", ...ME, reach: "phone" });
const STOPS_ROUND_FIELDS = { trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "26 Ann St, New York, NY 10038", to_text: "55 Church St, New York, NY 10007", date: "2026-11-21", time: "09:00", return: "1", return_date: "2026-11-23", return_time: "18:00", passengers: "2", class: "suv", flight: "AA 100", tip: "0", rider: "me", ...ME, reach: "phone" };
const STOPS_ROUND = await booked(STOPS_ROUND_FIELDS);
const STOPS_FAR = await booked({ ...STOPS_ROUND_FIELDS, route: signRoute([[routeKey({ address: "LaGuardia Airport, East Elmhurst, NY 11371" }, { address: "55 Church St, New York, NY 10007" }, nycToUtc("2026-11-21", "09:00").toISOString(), [{ address: "26 Ann St, New York, NY 10038" }]), 250, 70]], NOW) });
const STOP_ONE_WAY = await booked({ ...STOPS_ROUND_FIELDS, return: "", stop2_text: "40 Wall St, New York, NY 10005" });
const TERMINAL = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", return_flight: "B6 1234", passengers: "2", class: "suv", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const NO_FLIGHT = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const NO_RETURN_FLIGHT = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4", date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const FOR_OTHER = await booked({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", flight: "UA 523", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const TO_T5 = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const SEATS = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "3", class: "suv", meet: "1", sign: "Lopez Family", tip: "15", infant_seats: "1", booster_seats: "2", rider: "me", ...ME, reach: "phone" });
const DOGS = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "3", class: "suv", meet: "1", sign: "Lopez Family", tip: "15", infant_seats: "1", booster_seats: "2", small_dogs: "1", large_dogs: "2", rider: "me", ...ME, reach: "phone" });
const HOURLY_JFK = await booked({ trip_type: "hour", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", flight: "BA 117", meet: "1", tip: "0", rider: "me", ...ME, reach: "phone" });
const NASSAU = await booked({ trip_type: "one", from_text: "1 Old Country Rd, Mineola, NY 11501", to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const NEWARK_ROUND = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const picked = (name, id, zone, text, region = "") => ({ [`${name}_text`]: text, [`${name}_ticket`]: signTicket(id, zone, text, NOW, 0, region) });
const WORST_FIELDS = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", ...picked("stop1", "ChIJb8Jg9pZYwokR-qHGtvSkLzs", "manhattan", "350 5th Ave, New York, NY 10118, USA"), ...picked("stop2", "ChIJ-b2RmVlZwokRpb1pwEQjss0", "brooklyn", "277 Bedford Ave, Brooklyn, NY 11211, USA"), ...picked("to", "ChIJ7cv00DwsDogRAMDACa2m4K8", "outside", "1 Old Country Rd, Mineola, NY 11501, USA", "2811"), date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", flight: "DL 401", passengers: "12", class: "sprinter", sprinter: "sprinter-executive", meet: "1", sign: "Ortiz family", tip: "custom", tip_amount: "40", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", notes: "Kids aged 1, 3 and 6", infant_seats: "4", toddler_seats: "4", booster_seats: "4" };
const WORST = await booked(WORST_FIELDS);
const WORST_DOGS = await booked({ ...WORST_FIELDS, small_dogs: "3", large_dogs: "3" });
const CONNECTICUT = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "10 Elm St, Greenwich, CT 06830", date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
setEnv();

let serial = 0;
function paid(fix, { live = false, intent = true, metadata = {}, customer = {} } = {}) {
  serial++;
  const tag = `MailTest${String(serial).padStart(4, "0")}`;
  const id = `cs_${live ? "live" : "test"}_${tag}a1B2c3D4e5F6`;
  const pi = `pi_${tag}Q7r8S9`;
  const data = { ...fix.metadata, ...metadata };
  const session = { id, object: "checkout.session", livemode: live, status: "complete", payment_status: "paid", amount_total: fix.total, currency: "usd", client_reference_id: data.ref, payment_intent: intent ? pi : null, customer_details: { email: data.email, name: data.name, phone: "+12125550100", address: { line1: "9 Secret Lane" }, ...customer }, metadata: data };
  stripe.sessions.set(id, session);
  if (intent) stripe.intents.set(pi, { id: pi, object: "payment_intent", status: "succeeded", amount: fix.total, metadata: { ...data } });
  return session;
}
const markersOf = (session) => stripe.sessions.get(session.id);
const lookup = (session) => GET(new Request(`http://127.0.0.1:4173/api/book?session_id=${encodeURIComponent(session.id)}`));
const sessionBodyOf = (session) => {
  const r = receipt(session.metadata, readSettings({}), undefined);
  return { kind: "session", status: "complete", payment_status: "paid", ref: session.metadata.ref, summary: r.summary, lines: shownLines(r.lines), total_cents: session.amount_total, value_cents: r.value, currency: "usd", notes: r.notes };
};

function signature(body, { secret = SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  return `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
}
function hook(event, { header: sig, secret, at } = {}) {
  const body = typeof event === "string" ? event : JSON.stringify(event);
  const headers = { "content-type": "application/json; charset=utf-8" };
  const value = sig === undefined ? signature(body, { secret, at }) : sig;
  if (value !== null) headers["stripe-signature"] = value;
  return POST(new Request("https://www.nycluxride.com/api/stripe-webhook", { method: "POST", headers, body }));
}
const forged = { email: "attacker@example.org", name: "Forged Name", phone: "+15555550123" };
const completed = (session, type = "checkout.session.completed") => ({ id: "evt_MailTest0001", object: "event", type, livemode: false, data: { object: { id: session.id, object: "checkout.session", payment_status: "paid", customer_details: forged, metadata: { ...forged, notes: "Forged notes" } } } });
const thin = (session) => ({ id: "evt_test_MailThin0001", object: "v2.core.event", type: "v1.checkout.session.completed", livemode: false, related_object: { id: session.id, type: "checkout.session", url: `/v1/checkout/sessions/${session.id}` } });

function parse(raw) {
  const split = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, split);
  const body = raw.slice(split + 4);
  const fields = [];
  for (const line of head.split("\r\n")) {
    if (/^[ \t]/.test(line)) fields[fields.length - 1][1] += line;
    else fields.push([line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]);
  }
  const decode = (value) => value.replace(/\?=\s+=\?/g, "?==?").replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/gi, (match, data) => Buffer.from(data, "base64").toString("utf8"));
  const headers = new Map(fields.map(([name, value]) => [name.toLowerCase(), decode(value)]));
  const boundary = /boundary="([^"]+)"/.exec(headers.get("content-type"))[1];
  const parts = body.split(`--${boundary}`).slice(1, -1).map((part) => {
    const at = part.indexOf("\r\n\r\n");
    const meta = part.slice(0, at);
    return { meta, type: /Content-Type: ([^;\r\n]+)/i.exec(meta)[1], text: Buffer.from(part.slice(at + 4).replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n") };
  });
  return { raw, head, fields, headers, body, parts, text: parts.find((p) => p.type === "text/plain").text, html: parts.find((p) => p.type === "text/html").text };
}
const delivered = () => smtp.sessions.flatMap((s) => s.messages.map((m) => ({ ...m, mail: parse(m.data) })));
const byKind = (list, kind) => list.filter((m) => m.mail.headers.get("message-id").startsWith(`<${kind}.`));
const sectionOf = (text, heading) => {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return null;
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end < 0 ? undefined : end);
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const SETTINGS = { owners: OWNERS, from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } };
const ALLOWED_LINKS = ["mailto:info@nycluxride.com", "https://wa.me/16467750556", "https://www.nycluxride.com/terms-of-service", "https://www.nycluxride.com/rates#cancellation", "tel:+16467750556", "https://www.nycluxride.com"];

function checkHtml(letter, { stripeLink = "" } = {}) {
  const { document } = new JSDOM(letter.html).window;
  assert.match(letter.html, /^<!DOCTYPE html>\n<html lang="en">/);
  assert.equal(document.title, letter.subject);
  assert.equal(document.querySelectorAll("h1").length, 1);
  assert.equal(document.querySelectorAll("img, script, link, iframe, form, style, object, embed, video, audio, picture, source, svg").length, 0, "no image, script or embedded resource");
  assert.doesNotMatch(letter.html, /url\(|\s(src|srcset|background|on[a-z]+)\s*=|javascript:/i);
  for (const row of document.querySelectorAll("tr")) {
    assert.equal(row.children.length, 2);
    assert.deepEqual([row.children[0].tagName, row.children[0].getAttribute("scope"), row.children[1].tagName], ["TH", "row", "TD"]);
  }
  const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(links.filter((href) => !ALLOWED_LINKS.includes(href) && href !== stripeLink), []);
  assert.ok(links.every((href) => !href.includes("?")), "no link carries a query string");
  assert.ok([...document.querySelectorAll("a")].every((a) => a.textContent.trim().length > 1));
  for (const [fg, bg] of [["#14181f", "#ffffff"], ["#0b4fa8", "#ffffff"]]) {
    assert.ok(letter.html.includes(`color:${fg}`), fg);
    assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
  }
  return document;
}

const tripTable = (document) => [...document.querySelectorAll("h2")].map((h) => [h.textContent, h.nextElementSibling && h.nextElementSibling.tagName === "TABLE" ? [...h.nextElementSibling.querySelectorAll("tr")].map((tr) => [tr.children[0].textContent, tr.children[1].innerHTML]) : null]);

await test("the SMTP client refuses a server whose certificate it cannot verify, so no password, address or message goes out", async () => {
  setEnv();
  const results = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "Subject: x\r\n\r\nhello" }], 5000);
  assert.deepEqual(results.map((r) => [r.ok, r.stage, r.code]), [[false, "connect", "DEPTH_ZERO_SELF_SIGNED_CERT"]]);
  assert.equal(smtp.sessions.length, 0);
});

setDefaultCACertificates([...getCACertificates("default"), TLS_CERT]);

await test("the SMTP exchange over implicit TLS: greeting, EHLO, AUTH PLAIN with SMTP_USER and SMTP_PASS, then MAIL FROM, every RCPT TO and DATA for each message, then QUIT", async () => {
  setEnv();
  const mails = [
    { from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "Subject: one\r\n\r\nfirst" },
    { from: "info@nycluxride.com", to: OWNERS, data: "Subject: two\r\n\r\nsecond" },
  ];
  const results = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, mails, 5000);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.equal(smtp.sessions.length, 1);
  const [session] = smtp.sessions;
  assert.deepEqual(session.commands, ["EHLO nycluxride.com", "AUTH PLAIN", "MAIL FROM:<info@nycluxride.com>", "RCPT TO:<ana.lopez@example.com>", "DATA", "MAIL FROM:<info@nycluxride.com>", "RCPT TO:<info@nycluxride.com>", "RCPT TO:<nycluxride@gmail.com>", "DATA", "QUIT"]);
  assert.equal(session.auth, `\u0000${USER}\u0000${PASS}`);
  assert.deepEqual(session.messages.map((m) => [m.from, m.to, m.data]), [["info@nycluxride.com", ["ana.lopez@example.com"], "Subject: one\r\n\r\nfirst"], ["info@nycluxride.com", OWNERS, "Subject: two\r\n\r\nsecond"]]);
});

await test("dot-stuffing: lines that start with a period go out doubled and arrive whole, bare line breaks become CRLF", async () => {
  setEnv();
  const data = "Subject: dots\r\n\r\n.starts with a dot\r\n..two dots\n.\nend";
  const results = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data }], 5000);
  assert.equal(results[0].ok, true);
  const [session] = smtp.sessions;
  assert.deepEqual(session.wire.slice(2), ["..starts with a dot", "...two dots", "..", "end"]);
  assert.equal(session.messages[0].data, "Subject: dots\r\n\r\n.starts with a dot\r\n..two dots\r\n.\r\nend");
});

await test("a refused password stops at AUTH with 535: no MAIL FROM, no message, both messages reported failed", async () => {
  setEnv();
  smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
  const mails = [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "a" }, { from: "info@nycluxride.com", to: OWNERS, data: "b" }];
  const results = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, mails, 5000);
  assert.deepEqual(results.map((r) => [r.ok, r.stage, r.code]), [[false, "auth", 535], [false, "auth", 535]]);
  assert.deepEqual(smtp.sessions[0].commands, ["EHLO nycluxride.com", "AUTH PLAIN"]);
});

await test("a rejected recipient is skipped and the others still get the message, a message with no accepted recipient is reset and fails alone", async () => {
  setEnv();
  smtp.behavior = { reject: ["nycluxride@gmail.com", "ana.lopez@example.com"] };
  const mails = [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "a" }, { from: "info@nycluxride.com", to: OWNERS, data: "b" }];
  const results = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, mails, 5000);
  assert.deepEqual(results.map((r) => [r.ok, r.stage, r.code, r.rejected]), [[false, "rcpt", 550, undefined], [true, "message", 250, 1]]);
  assert.deepEqual(smtp.sessions[0].commands.slice(2), ["MAIL FROM:<info@nycluxride.com>", "RCPT TO:<ana.lopez@example.com>", "RSET", "MAIL FROM:<info@nycluxride.com>", "RCPT TO:<info@nycluxride.com>", "RCPT TO:<nycluxride@gmail.com>", "DATA", "QUIT"]);
  assert.deepEqual(smtp.sessions[0].messages.map((m) => m.to), [["info@nycluxride.com"]]);
});

await test("a message the server refuses after DATA fails alone with its code and the next message still goes out, and a refused sender resets and fails each message without dropping the session", async () => {
  setEnv();
  smtp.behavior = { refuse: (mail) => (mail.to.includes("ana.lopez@example.com") ? "554 5.7.0 Message rejected" : "") };
  const mails = [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "Subject: one\r\n\r\nfirst" }, { from: "info@nycluxride.com", to: OWNERS, data: "Subject: two\r\n\r\nsecond" }];
  const results = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, mails, 5000);
  assert.deepEqual(results.map((r) => [r.ok, r.stage, r.code]), [[false, "message", 554], [true, "message", 250]]);
  assert.deepEqual(smtp.sessions[0].commands.slice(2), ["MAIL FROM:<info@nycluxride.com>", "RCPT TO:<ana.lopez@example.com>", "DATA", "MAIL FROM:<info@nycluxride.com>", "RCPT TO:<info@nycluxride.com>", "RCPT TO:<nycluxride@gmail.com>", "DATA", "QUIT"]);
  assert.deepEqual(smtp.sessions[0].messages.map((m) => [m.to, m.data]), [[OWNERS, "Subject: two\r\n\r\nsecond"]]);
  setEnv();
  smtp.behavior = { sender: "553 5.7.1 Sender address rejected" };
  const refused = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, mails, 5000);
  assert.deepEqual(refused.map((r) => [r.ok, r.stage, r.code]), [[false, "mail", 553], [false, "mail", 553]]);
  assert.deepEqual(smtp.sessions[0].commands.slice(2), ["MAIL FROM:<info@nycluxride.com>", "RSET", "MAIL FROM:<info@nycluxride.com>", "RSET", "QUIT"]);
  assert.equal(smtp.sessions[0].messages.length, 0);
});

await test("a server that stops answering times out, a closed port fails at connect, and an address with a line break is never sent", async () => {
  setEnv();
  smtp.behavior = { hang: "EHLO" };
  const started = Date.now();
  const hung = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "a" }], 300);
  assert.deepEqual(hung.map((r) => [r.ok, r.stage, r.code]), [[false, "ehlo", "timeout"]]);
  assert.ok(Date.now() - started < 2000);
  const closed = await new Promise((resolve) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const refused = await smtpSend({ host: "127.0.0.1", port: closed, user: USER, pass: PASS, helo: "nycluxride.com" }, [{ from: "info@nycluxride.com", to: ["ana.lopez@example.com"], data: "a" }], 3000);
  assert.deepEqual(refused.map((r) => [r.ok, r.stage, r.code]), [[false, "connect", "ECONNREFUSED"]]);
  smtp.sessions.length = 0;
  const bad = await smtpSend({ host: "127.0.0.1", port: smtp.port, user: USER, pass: PASS, helo: "nycluxride.com" }, [{ from: "info@nycluxride.com", to: ["ana@example.com>\r\nRCPT TO:<evil@example.org"], data: "a" }], 3000);
  assert.deepEqual(bad.map((r) => [r.ok, r.stage]), [[false, "address"]]);
  assert.equal(smtp.sessions.length, 0);
});

await test("headers: CR and LF are stripped from every value, long ASCII values fold at spaces under 78 characters, other text is UTF-8 encoded words that decode back", async () => {
  assert.equal(header("Subject", "Line one\r\nBcc: evil@example.org"), "Subject: Line one Bcc: evil@example.org");
  assert.equal(header("Subject", "a b\u0085c‮d\td"), "Subject: a b c d d");
  const long = header("Subject", "New booking 83558982: Sun Nov 8, 10:00 AM, Business Premium SUV, 253 West 72nd Street to Newark Liberty (EWR)");
  assert.ok(long.split("\r\n").every((line) => line.length <= 78), long);
  assert.equal(long.replace(/\r\n /g, " "), "Subject: New booking 83558982: Sun Nov 8, 10:00 AM, Business Premium SUV, 253 West 72nd Street to Newark Liberty (EWR)");
  const coded = header("Subject", "Your trip from Café Boulud to Zoë’s place 🚗 at JFK, with a much longer tail to fold");
  assert.ok(coded.split("\r\n").every((line) => line.length <= 76 && /^[\x20-\x7e]+$/.test(line)), coded);
  assert.equal(parse(`${coded}\r\nContent-Type: multipart/alternative; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\n\r\n--b\r\nContent-Type: text/html\r\n\r\n\r\n--b--`).headers.get("subject"), "Your trip from Café Boulud to Zoë’s place 🚗 at JFK, with a much longer tail to fold");
  assert.equal(mailbox({ name: 'Ana "AJ" O\'Neil\\Lopez', address: "ana@example.com" }), '"Ana \\"AJ\\" O\'Neil\\\\Lopez" <ana@example.com>');
  assert.equal(mailbox({ name: "Ana\r\nBcc: evil@example.org", address: "ana@example.com" }), '"Ana Bcc: evil@example.org" <ana@example.com>');
  assert.equal(mailbox({ name: "", address: "ana@example.com" }), "ana@example.com");
  assert.throws(() => mailbox({ name: "x", address: "ana@example.com>\r\nBcc: evil@example.org" }));
});

await test("one way trip, live: both emails' headers, the whole plain text and the HTML, with every price line and the total paid", async () => {
  setEnv();
  const session = paid(ONE_WAY, { live: true });
  const letters = bookingLetters(session, SETTINGS);
  assert.deepEqual(letters.map((l) => l.kind), ["customer", "owner"]);
  const [customer, owner] = letters;
  assert.equal(customer.subject, "Your NYC LUX RIDE booking 83558982, Sun Nov 8, 10:00 AM");
  assert.equal(owner.subject, "New booking 83558982: Sun Nov 8, 10:00 AM, Business SUV, 253 West 72nd Street to Newark Liberty (EWR)");
  assert.deepEqual(customer.to, [{ name: "Ana Lopez", address: "ana.lopez@example.com" }]);
  assert.deepEqual(owner.to, OWNERS.map((address) => ({ name: "", address })));
  assert.deepEqual(owner.replyTo, { name: "Ana Lopez", address: "ana.lopez@example.com" });
  const steps = ["What happens next", "Paid: Stripe emails your receipt with your reference.", "Confirmed in writing: We confirm your car and chauffeur in writing before your ride.", "", "Where to meet your chauffeur", "Your chauffeur comes to the pickup address. You get 15 minutes of free waiting from the pickup time.", ""];
  const trip = ["Reference: 83558982", "Trip: One way", "Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Date: Sun, Nov 8, 2026", "Time: 10:00 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", ""];
  const pay = ["Fare: $168.46", "Taxes and fees: $3.79", "Tolls: $12.75", "Paid: $185.00", "", NOTES.included, "", POLICY.later.airport, "", "Sun, Nov 8, 2026, 10:00 AM. To Newark Liberty (EWR), Business SUV.", ""];
  const change = ["To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference 83558982.", "WhatsApp: https://wa.me/16467750556", "Terms of service: https://www.nycluxride.com/terms-of-service", "Rates and cancellation terms: https://www.nycluxride.com/rates#cancellation"];
  assert.equal(customer.text, [`Payment received`, "", "Your trip", ...trip, "Your payment", ...pay, ...steps.slice(0, 1), ...steps.slice(1), ...change, "", "NYC LUX RIDE", "+1 (646) 775-0556", "https://www.nycluxride.com", ""].join("\n"));
  assert.equal(owner.text, ["New booking 83558982", "", "Customer", "Name: Ana Lopez", "Email: ana.lopez@example.com", "Phone: +1 212 555 0100", "Preferred contact: WhatsApp", "", "Trip", ...trip, "Payment", ...pay, `Open the payment in Stripe: https://dashboard.stripe.com/payments/${session.payment_intent}`, "", "What the customer email says", ...steps.slice(1), ...change, ""].join("\n"));
  const doc = checkHtml(customer);
  assert.deepEqual([...doc.querySelectorAll("h2")].map((h) => h.textContent), ["Your trip", "Your payment", "What happens next", "Where to meet your chauffeur"]);
  assert.equal(doc.querySelector("h1").textContent, "Payment received");
  assert.deepEqual(tripTable(doc)[0][1], trip.slice(0, -1).map((line) => line.split(": ")));
  assert.deepEqual(tripTable(doc)[1][1], [["Fare", "$168.46"], ["Taxes and fees", "$3.79"], ["Tolls", "$12.75"], ["Paid", "$185.00"]]);
  assert.deepEqual([session.metadata.fare_cents, session.metadata.tax_cents, session.metadata.bcf_cents], ["16846", "0", "379"], "Manhattan to Newark is interstate: no New York sales tax");
  assert.deepEqual([...doc.querySelectorAll("ol li")].map((li) => [li.querySelector("strong").textContent, li.textContent.slice(li.querySelector("strong").textContent.length)]), [["Paid", "Stripe emails your receipt with your reference."], ["Confirmed in writing", "We confirm your car and chauffeur in writing before your ride."]]);
  const where = [...doc.querySelectorAll("h2")].find((h) => h.textContent === "Where to meet your chauffeur").nextElementSibling;
  assert.deepEqual([where.tagName, where.innerHTML], ["P", "Your chauffeur comes to the pickup address. You get 15 minutes of free waiting from the pickup time."]);
  const odoc = checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/payments/${session.payment_intent}` });
  assert.deepEqual([...odoc.querySelectorAll("h2")].map((h) => h.textContent), ["Customer", "Trip", "Payment", "What the customer email says", "Where to meet your chauffeur"]);
  assert.deepEqual(tripTable(odoc)[0][1], [["Name", "Ana Lopez"], ["Email", "ana.lopez@example.com"], ["Phone", "+1 212 555 0100"], ["Preferred contact", "WhatsApp"]]);
  assert.equal(odoc.querySelector(`a[href="https://dashboard.stripe.com/payments/${session.payment_intent}"]`).textContent, "Open the payment in Stripe");
  const total = receipt(session.metadata, readSettings({}), undefined).lines.reduce((sum, line) => sum + line.cents, 0);
  assert.equal(total, session.amount_total);
});

await test("both emails show the price as the site does (owner change 2): one Taxes and fees line that is the sales tax plus the Black Car Fund, Tolls on an airport transfer, every other line and the total paid as charged, in the text and the HTML", async () => {
  setEnv();
  for (const fix of [ONE_WAY, ROUND, HOURLY, NEW_JERSEY, STOPS, SEATS, HOURLY_JFK]) {
    const session = paid(fix);
    const m = session.metadata;
    const charged = receipt(m, readSettings({}), undefined).lines;
    const fees = Number(m.tax_cents) + Number(m.bcf_cents);
    const tolls = Number(m.tolls_cents || 0);
    const want = [["Fare", m.fare_cents], ["Taxes and fees", fees], ...(tolls ? [["Tolls", tolls]] : []), ...charged.slice(1).filter((line) => !["NYC sales tax", "Black Car Fund", "Tolls and airport fees"].includes(line.label)).map((line) => [line.label, line.cents])].map(([label, cents]) => [label.startsWith("Fare") ? charged[0].label : label, money(Number(cents))]);
    assert.equal(charged.reduce((sum, line) => sum + line.cents, 0), session.amount_total, m.ref);
    for (const letter of bookingLetters(session, SETTINGS)) {
      const at = `${letter.kind} ${fix.metadata.service} ${m.date}`;
      const text = sectionOf(letter.text, letter.kind === "owner" ? "Payment" : "Your payment");
      assert.deepEqual(text.slice(0, -1), want.map(([label, value]) => `${label}: ${value}`), at);
      assert.equal(text.at(-1), `Paid: ${money(session.amount_total)}`, at);
      const table = tripTable(new JSDOM(letter.html).window.document).find(([h]) => h === (letter.kind === "owner" ? "Payment" : "Your payment"))[1];
      assert.deepEqual(table, [...want, ["Paid", money(session.amount_total)]], at);
      assert.doesNotMatch(`${letter.text}\n${letter.html}`, /NYC sales tax \(|Black Car Fund \(|Tolls and airport fees|workers' compensation/, at);
    }
  }
});

await test("round trip with meet and greet, the sign name, notes and someone else riding: the return, the flight, the passenger and where to meet the chauffeur on each pickup", async () => {
  setEnv();
  const session = paid(ROUND);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(customer.subject, "[TEST] Your NYC LUX RIDE booking 83558982, Thu Nov 12, 7:30 AM");
  assert.equal(owner.subject, "[TEST] New booking 83558982: Thu Nov 12, 7:30 AM, Business Premium SUV, JFK to 350 5th Ave, return Sun Nov 15, 6:00 PM");
  assert.deepEqual(sectionOf(customer.text, "Your trip"), ["Reference: 83558982", "Trip: Round trip", "Pickup: John F. Kennedy (JFK), Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", "Date: Thu, Nov 12, 2026", "Time: 7:30 AM, New York time", "Return: Sun, Nov 15, 2026, 6:00 PM, New York time", "Passengers: 3", "Vehicle: Business Premium SUV", "Flight: DL 401", "Meet and greet: Yes", "Name for the sign: Ortiz Party", "Notes for the chauffeur: Infant seat, please", "  Two large cases"]);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $373.00", "Taxes and fees: $41.50", "Tolls: $25.50", "Meet and greet: $25.00", "Gratuity for your chauffeur (15%): $55.95", "Paid: $520.95"]);
  assert.deepEqual(sectionOf(customer.text, "Where to meet your chauffeur"), [`Ride out: ${MAIL.where.insideOther} ${MAIL.day.tracked} ${MAIL.where.landing}`, `Return ride: ${MAIL.where.address}`]);
  assert.ok(customer.text.includes("\nRide out: Your chauffeur waits inside the terminal near baggage claim with a name sign and takes their bags. We track your flight. You get 45 minutes of free waiting after a domestic landing and 60 minutes after an international landing.\nReturn ride: Your chauffeur comes to the pickup address.\n"));
  assert.ok(customer.text.includes("\nYour chauffeur contacts Ben Ortiz on the day of the ride. Your confirmation, receipt and any changes go to your email.\n"));
  assert.ok(customer.text.includes("\nThu, Nov 12, 2026, 7:30 AM. Return Sun, Nov 15, 2026, 6:00 PM. Business Premium SUV, 2 airport transfers.\n"));
  assert.ok(customer.text.startsWith("Test booking. No real payment was taken.\n\nPayment received\n"));
  assert.deepEqual(sectionOf(owner.text, "Customer"), ["Name: Ana Lopez", "Email: ana.lopez@example.com", "Phone: +1 212 555 0100", "Preferred contact: Phone"]);
  assert.deepEqual(sectionOf(owner.text, "Passenger"), ["Name: Ben Ortiz", "Phone: +44 20 7946 0958"]);
  assert.deepEqual(sectionOf(owner.text, "Trip"), sectionOf(customer.text, "Your trip"));
  assert.ok(owner.text.includes(`\nOpen the payment in Stripe: https://dashboard.stripe.com/test/payments/${session.payment_intent}\n`));
  const doc = checkHtml(customer);
  assert.equal(doc.querySelector("p").textContent, "Test booking. No real payment was taken.");
  assert.equal(doc.querySelector("p strong").textContent, "Test booking.");
  assert.deepEqual(tripTable(doc)[0][1].at(-1), ["Notes for the chauffeur", "Infant seat, please<br>Two large cases"]);
  assert.deepEqual(tripTable(doc)[0][1][1], ["Trip", "Round trip"]);
  const odoc = checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` });
  assert.deepEqual([...odoc.querySelectorAll("h2")].map((h) => h.textContent), ["Customer", "Passenger", "Trip", "Payment", "What the customer email says", "Where to meet your chauffeur"]);
  const where = [...doc.querySelectorAll("h2")].find((h) => h.textContent === MAIL.where.heading).nextElementSibling;
  assert.deepEqual([where.tagName, where.innerHTML, where.nextElementSibling.innerHTML], ["P", `<strong>Ride out</strong><br>${MAIL.where.insideOther} ${MAIL.day.tracked} ${MAIL.where.landing}`, `<strong>Return ride</strong><br>${MAIL.where.address}`]);
  assert.deepEqual(tripTable(odoc).find(([heading]) => heading === MAIL.ownerTrip)[1][1], ["Trip", "Round trip"]);
});

await test("hourly booking: the hours, the vehicle model, the typed gratuity, the hourly note and the hourly meeting wording, for the rider and for someone else", async () => {
  setEnv();
  const session = paid(HOURLY, { live: true });
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(customer.subject, "Your NYC LUX RIDE booking 83558982, Tue Dec 1, 2:00 PM");
  assert.equal(owner.subject, "New booking 83558982: Tue Dec 1, 2:00 PM, Business Premium SUV, 4 hours from 1 Main Street");
  assert.deepEqual(sectionOf(customer.text, "Your trip"), ["Reference: 83558982", "Trip: By the hour, 4 hours", "Pickup: 1 Main Street, Brooklyn, NY 11201", "Date: Tue, Dec 1, 2026", "Time: 2:00 PM, New York time", "Passengers: 1", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Notes for the chauffeur: A toddler seat, please"]);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare, 4 hours: $420.00", "Taxes and fees: $46.73", "Gratuity for your chauffeur: $40.00", "Paid: $506.73"]);
  assert.ok(customer.text.includes(`\n${NOTES.hourly}\n`));
  assert.ok(customer.text.includes("\nWhere to meet your chauffeur\nYour chauffeur comes to the pickup address. The same car and chauffeur stay with you for the hours you booked. If your day might run long, message us an hour ahead so we can keep the car for you.\n"));
  assert.doesNotMatch(customer.text, /Drop-off|Stop 1|Tolls:|Tolls and airport fees:/);
  checkHtml(customer);
  checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/payments/${session.payment_intent}` });
  const other = paid(HOURLY, { metadata: { rider: "other", passenger_name: "Ben Ortiz", passenger_phone: "+1 917 555 0199" } });
  const [forOther] = bookingLetters(other, SETTINGS);
  assert.ok(forOther.text.includes("\nWhere to meet your chauffeur\nYour chauffeur comes to the pickup address. The same car and chauffeur stay with them for the hours you booked. If your day might run long"));
});

await test("airport trip from New Jersey: priced by distance and time, no tolls line, the outside note, the miles and minutes, and an escaped class name", async () => {
  setEnv();
  const session = paid(NEW_JERSEY);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(customer.subject, "[TEST] Your NYC LUX RIDE booking 83558982, Fri Nov 20, 5:15 AM");
  assert.equal(owner.subject, "[TEST] New booking 83558982: Fri Nov 20, 5:15 AM, Sedan & Electric, Secaucus to Newark Liberty (EWR)");
  assert.deepEqual(sectionOf(customer.text, "Your trip"), ["Reference: 83558982", "Trip: One way", "Pickup: Secaucus, NJ 07094", "Drop-off: Newark Liberty (EWR)", "Date: Fri, Nov 20, 2026", "Time: 5:15 AM, New York time", "Passengers: 2", "Vehicle: Sedan & Electric"]);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $153.79", "Taxes and fees: $3.46", "Gratuity for your chauffeur (20%): $30.76", "Paid: $188.01"]);
  assert.ok(customer.text.includes(`\n${POLICY.later.outside}\n`));
  assert.ok(customer.text.includes("\nFri, Nov 20, 2026, 5:15 AM. Sedan & Electric, 9.0 miles and 18 min.\n"));
  assert.ok(customer.text.includes("\nWhere to meet your chauffeur\nYour chauffeur comes to the pickup address. You get 15 minutes of free waiting from the pickup time.\n"));
  const doc = checkHtml(customer);
  assert.ok(customer.html.includes("Sedan &#38; Electric") && !customer.html.includes("Sedan & Electric"));
  assert.equal(tripTable(doc)[0][1].find(([label]) => label === "Vehicle")[1], "Sedan &amp; Electric");
  checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` });
});

await test("a trip to JFK Terminal 5 with a return pickup there: the pickup wording, the return wording for someone else with the Terminals 5 and 7 note, and the flight lines only on the first pickup", async () => {
  setEnv();
  const [customer] = bookingLetters(paid(TERMINAL), SETTINGS);
  assert.ok(customer.text.includes("\nTrip: Round trip\n"));
  assert.ok(customer.text.includes("\nReturn flight: B6 1234\n"));
  assert.deepEqual(sectionOf(customer.text, MAIL.where.heading), [`Ride out: ${MAIL.day.pickup}`, `Return ride: ${MAIL.where.terminalsOther} ${MAIL.day.bagsOther}`]);
  const [mine] = bookingLetters(paid(TERMINAL, { metadata: { rider: "me", passenger_name: "", passenger_phone: "" } }), SETTINGS);
  assert.deepEqual(sectionOf(mine.text, MAIL.where.heading), [`Ride out: ${MAIL.day.pickup}`, `Return ride: ${MAIL.day.terminals} ${MAIL.day.bags}`]);
  const [pickup] = bookingLetters(paid(ROUND, { metadata: { meet: "0", meet_cents: "0", sign_name: "", rider: "me", from_place: "jfk-t5", from_text: "John F. Kennedy (JFK), Terminal 5" } }), SETTINGS);
  assert.deepEqual(sectionOf(pickup.text, MAIL.where.heading), [`Ride out: ${MAIL.day.terminals} ${MAIL.day.bags} ${MAIL.day.tracked} ${MAIL.where.landing}`, `Return ride: ${MAIL.where.address}`]);
  assert.ok(!pickup.text.includes(MAIL.where.curb) && !customer.text.includes(MAIL.where.curbOther), "the Terminals 5 and 7 lot stands in for the curb sentence");
});

await test("a trip with two stops: Stop 1 and Stop 2 in order between the pickup and the drop-off, in the text and the HTML of both emails, with every price line and the airport pickup wording", async () => {
  setEnv();
  const session = paid(STOPS);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(owner.subject, "[TEST] New booking 83558982: Sat Nov 21, 9:00 AM, Business SUV, LaGuardia (LGA) to 350 5th Ave");
  const route = ["Pickup: LaGuardia (LGA)", "Stop 1: 277 Bedford Ave, Brooklyn, NY 11211", "Stop 2: John F. Kennedy (JFK)", "Drop-off: 350 5th Ave, New York, NY 10118"];
  assert.deepEqual(sectionOf(customer.text, "Your trip").slice(2, 6), route);
  assert.deepEqual(sectionOf(owner.text, "Trip").slice(2, 6), route);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $137.01", "Taxes and fees: $15.24", "Tolls: $12.75", "Extra stops (2 x $20.00): $40.00", "Paid: $205.00"]);
  assert.ok(customer.text.includes("\nSat, Nov 21, 2026, 9:00 AM. From LaGuardia (LGA), Business SUV.\n"));
  assert.deepEqual(sectionOf(customer.text, MAIL.where.heading), [`${MAIL.where.curb} ${MAIL.day.bags} ${MAIL.where.signs} ${MAIL.day.tracked} ${MAIL.where.landing}`]);
  for (const letter of [customer, owner]) {
    const doc = checkHtml(letter, letter.kind === "owner" ? { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` } : {});
    const [, rows] = tripTable(doc).find(([heading]) => heading === (letter.kind === "owner" ? MAIL.ownerTrip : MAIL.trip));
    assert.deepEqual(rows.slice(2, 6), route.map((line) => line.split(": ")));
  }
});

await test("a round trip with a stop a few blocks away and a flat return: both emails show two flat airport totals with their tolls and the Extra stop line, and say tolls and airport fees are included", async () => {
  setEnv();
  const [customer, owner] = bookingLetters(paid(STOPS_ROUND), SETTINGS);
  assert.deepEqual(STOPS_ROUND.metadata.stops_cents, "2000");
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $274.02", "Taxes and fees: $30.48", "Tolls: $25.50", "Extra stop: $20.00", "Paid: $350.00"]);
  assert.deepEqual(sectionOf(owner.text, "Payment"), sectionOf(customer.text, "Your payment"));
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes(`\n${NOTES.included}\n\n${POLICY.later.airport}\n`), letter.kind);
    assert.ok(!letter.text.includes(POLICY.later.returnFlat), letter.kind);
  }
  assert.ok(customer.text.includes("\nSat, Nov 21, 2026, 9:00 AM. Return Mon, Nov 23, 2026, 6:00 PM. Business SUV, 2 airport transfers.\n"));
});

await test("a one way trip with two stops a few blocks apart: both emails, text and HTML, carry the Extra stops line with its count and the price per stop", async () => {
  setEnv();
  const [customer, owner] = bookingLetters(paid(STOP_ONE_WAY), SETTINGS);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $137.01", "Taxes and fees: $15.24", "Tolls: $12.75", "Extra stops (2 x $20.00): $40.00", "Paid: $205.00"]);
  assert.deepEqual(sectionOf(owner.text, "Payment"), sectionOf(customer.text, "Your payment"));
  for (const letter of [customer, owner]) assert.ok(letter.html.includes("Extra stops (2 x $20.00)") && letter.html.includes("$40.00"), letter.kind);
});

await test("a round trip with a stop priced over the whole route and a flat return: both emails say the return's tolls and airport fees are paid and only the ride out's tolls come after the ride, with the tolls line and the miles of the ride out", async () => {
  setEnv();
  const [customer, owner] = bookingLetters(paid(STOPS_FAR), SETTINGS);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $317.51", "Taxes and fees: $35.32", "Tolls: $12.75", "Paid: $365.58"]);
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes(`\n${NOTES.returnFlat}\n\n${POLICY.later.returnFlat}\n`), letter.kind);
    assert.ok(!letter.text.includes(POLICY.later.outside), letter.kind);
  }
  assert.ok(customer.text.includes("\nSat, Nov 21, 2026, 9:00 AM. Return Mon, Nov 23, 2026, 6:00 PM. Business SUV, 25.0 miles and 70 min, return at the flat airport rate.\n"));
});

await test("an airport pickup, or a return pickup at an airport, with no flight number asks for it in both emails, on WhatsApp with the reference, where the confirmation page shows its flight number link", async () => {
  setEnv();
  const ask = "Send us your flight number on WhatsApp with your reference 83558982.";
  const askReturn = "Send us your return flight number on WhatsApp with your reference 83558982.";
  const linked = `<a href="https://wa.me/16467750556" style="color:#0b4fa8;text-decoration:underline">WhatsApp</a>`;
  for (const [fix, where] of [[NO_FLIGHT, [["", `${MAIL.where.curb} ${MAIL.day.bags}`], ["", ask]]], [NO_RETURN_FLIGHT, [["Ride out", MAIL.day.pickup], ["Return ride", `${MAIL.where.curb} ${MAIL.day.bags}`], ["", askReturn]]]]) {
    const session = paid(fix);
    const [customer, owner] = bookingLetters(session, SETTINGS);
    const steps = [`Paid: ${MAIL.steps[0][1]}`, `Confirmed in writing: ${MAIL.steps[1][1]}`];
    const lines = where.map(([label, value]) => (label ? `${label}: ${value}` : value));
    assert.deepEqual(sectionOf(customer.text, "What happens next"), steps);
    assert.deepEqual(sectionOf(owner.text, "What the customer email says"), steps);
    assert.deepEqual(sectionOf(customer.text, MAIL.where.heading), lines);
    assert.deepEqual(sectionOf(owner.text, MAIL.where.heading), lines);
    assert.ok(!customer.text.includes(MAIL.day.tracked) && !customer.text.includes(MAIL.where.landing));
    for (const letter of [customer, owner]) {
      const doc = checkHtml(letter, letter.kind === "owner" ? { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` } : {});
      const heading = [...doc.querySelectorAll("h2")].find((h) => h.textContent === MAIL.where.heading);
      const paragraphs = [];
      for (let at = heading.nextElementSibling; at && at.tagName === "P" && !at.textContent.startsWith("To change") && !at.textContent.startsWith("Your chauffeur contacts"); at = at.nextElementSibling) paragraphs.push(at.innerHTML);
      assert.deepEqual(paragraphs, where.map(([label, value]) => `${label ? `<strong>${label}</strong><br>` : ""}${value.replace("WhatsApp", linked)}`));
    }
  }
});

await test("an airport pickup for someone else, a one way drop-off at JFK Terminal 5 and an hourly booking from JFK with meet and greet: the bags wording for them, no Terminals 5 and 7 note on a drop-off, the flight row by the hour and the meet and greet sentence before the hourly ones", async () => {
  setEnv();
  const day = (letter) => sectionOf(letter.text, MAIL.where.heading).join(" ");
  const [other] = bookingLetters(paid(FOR_OTHER), SETTINGS);
  assert.deepEqual(sectionOf(other.text, "Your trip"), ["Reference: 83558982", "Trip: One way", "Pickup: LaGuardia (LGA)", "Drop-off: 350 5th Ave, New York, NY 10118", "Date: Thu, Nov 12, 2026", "Time: 7:30 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", "Flight: UA 523"]);
  assert.equal(day(other), `${MAIL.where.curbOther} ${MAIL.day.bagsOther} ${MAIL.where.signs} ${MAIL.day.tracked} ${MAIL.where.landing}`);
  assert.ok(other.text.includes("\nYour chauffeur contacts Ben Ortiz on the day of the ride. Your confirmation, receipt and any changes go to your email.\n"));
  const [drop] = bookingLetters(paid(TO_T5), SETTINGS);
  assert.deepEqual(sectionOf(drop.text, "Your trip").slice(1, 4), ["Trip: One way", "Pickup: 350 5th Ave, New York, NY 10118", "Drop-off: John F. Kennedy (JFK), Terminal 5"]);
  assert.equal(day(drop), MAIL.day.pickup);
  assert.ok(!drop.text.includes("Terminals 5 and 7") && !drop.html.includes("Terminals 5 and 7"));
  const session = paid(HOURLY_JFK);
  const [hourly, owner] = bookingLetters(session, SETTINGS);
  const rows = ["Reference: 83558982", "Trip: By the hour, 4 hours", "Pickup: John F. Kennedy (JFK), Terminal 4", "Date: Tue, Dec 1, 2026", "Time: 2:00 PM, New York time", "Passengers: 1", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Flight: BA 117", "Meet and greet: Yes", "Name for the sign: Ana Lopez"];
  assert.deepEqual(sectionOf(hourly.text, "Your trip"), rows);
  assert.deepEqual(sectionOf(owner.text, "Trip"), rows);
  assert.equal(day(hourly), `${MAIL.where.inside} ${MAIL.day.tracked} ${fill(MAIL.day.hourly, { who: MAIL.day.you })} ${MAIL.day.long}`);
  assert.deepEqual(tripTable(checkHtml(hourly))[0][1].find(([label]) => label === "Flight"), ["Flight", "BA 117"]);
  checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` });
});

await test("once the pickup, and the return when there is one, has passed, the customer email keeps the trip and the payment but drops What happens next, the change line and the links, and the owner notice drops the customer email section", async () => {
  setEnv();
  const pickup = Date.parse("2026-11-08T15:00:00.000Z");
  const session = paid(ONE_WAY, { live: true });
  const [before, ownerBefore] = bookingLetters(session, SETTINGS, pickup - 1);
  assert.ok(before.text.includes("\nWhat happens next\n") && ownerBefore.text.includes(`\n${MAIL.ownerNext}\n`));
  const [customer, owner] = bookingLetters(session, SETTINGS, pickup);
  assert.deepEqual([customer.subject, owner.subject], [before.subject, ownerBefore.subject]);
  assert.equal(customer.text, ["Payment received", "", "Your trip", "Reference: 83558982", "Trip: One way", "Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Date: Sun, Nov 8, 2026", "Time: 10:00 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", "", "Your payment", "Fare: $168.46", "Taxes and fees: $3.79", "Tolls: $12.75", "Paid: $185.00", "", NOTES.included, "", POLICY.later.airport, "", "Sun, Nov 8, 2026, 10:00 AM. To Newark Liberty (EWR), Business SUV.", "", "NYC LUX RIDE", "+1 (646) 775-0556", "https://www.nycluxride.com", ""].join("\n"));
  const doc = checkHtml(customer);
  assert.deepEqual([...doc.querySelectorAll("h2")].map((h) => h.textContent), ["Your trip", "Your payment"]);
  assert.equal(doc.querySelectorAll("ol, ul").length, 0);
  assert.deepEqual([...doc.querySelectorAll("a")].map((a) => a.getAttribute("href")), ["tel:+16467750556", "https://www.nycluxride.com"]);
  assert.equal(owner.text, ownerBefore.text.slice(0, ownerBefore.text.indexOf(`\n${MAIL.ownerNext}\n`)));
  const odoc = checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/payments/${session.payment_intent}` });
  assert.deepEqual([...odoc.querySelectorAll("h2")].map((h) => h.textContent), ["Customer", "Trip", "Payment"]);
  const round = paid(ROUND);
  const ahead = bookingLetters(round, SETTINGS);
  assert.deepEqual(bookingLetters(round, SETTINGS, Date.parse("2026-11-13T12:00:00.000Z")).map((l) => l.text), ahead.map((l) => l.text));
  const [back, backOwner] = bookingLetters(round, SETTINGS, Date.parse("2026-11-15T23:00:00.000Z"));
  assert.ok(ahead[0].text.includes("\nWhat happens next\n") && !back.text.includes("What happens next") && !back.text.includes(MAIL.where.heading) && !back.text.includes(MAIL.where.insideOther) && !back.text.includes("contacts Ben Ortiz"));
  assert.ok(!backOwner.text.includes(MAIL.ownerNext) && backOwner.text.includes("\nPassenger\nName: Ben Ortiz\n"));
  setEnv(mailEnv());
  withContext();
  const old = paid(ONE_WAY, { metadata: { date: "2026-01-04" } });
  await lookup(old);
  assert.deepEqual(await settled(), ["sent"]);
  const [mailed, notice] = delivered().map((m) => m.mail);
  assert.equal(mailed.headers.get("subject"), "[TEST] Your NYC LUX RIDE booking 83558982, Sun Jan 4, 10:00 AM");
  assert.ok(mailed.text.includes("\nDate: Sun, Jan 4, 2026\n") && mailed.text.endsWith("\nSun, Jan 4, 2026, 10:00 AM. To Newark Liberty (EWR), Business SUV.\n\nNYC LUX RIDE\n+1 (646) 775-0556\nhttps://www.nycluxride.com\n"));
  assert.ok(!mailed.text.includes("What happens next") && !notice.text.includes(MAIL.ownerNext));
});

await test("both emails as they go out for a one way trip, a round trip, an hourly booking and an airport trip from New Jersey: every header, the plain text and the HTML", async () => {
  setEnv();
  const at = new Date("2026-11-08T03:12:00Z");
  const trips = [
    [ONE_WAY, { live: true }, "Your NYC LUX RIDE booking 83558982, Sun Nov 8, 10:00 AM", "New booking 83558982: Sun Nov 8, 10:00 AM, Business SUV, 253 West 72nd Street to Newark Liberty (EWR)"],
    [ROUND, {}, "[TEST] Your NYC LUX RIDE booking 83558982, Thu Nov 12, 7:30 AM", "[TEST] New booking 83558982: Thu Nov 12, 7:30 AM, Business Premium SUV, JFK to 350 5th Ave, return Sun Nov 15, 6:00 PM"],
    [HOURLY, {}, "[TEST] Your NYC LUX RIDE booking 83558982, Tue Dec 1, 2:00 PM", "[TEST] New booking 83558982: Tue Dec 1, 2:00 PM, Business Premium SUV, 4 hours from 1 Main Street"],
    [NEW_JERSEY, {}, "[TEST] Your NYC LUX RIDE booking 83558982, Fri Nov 20, 5:15 AM", "[TEST] New booking 83558982: Fri Nov 20, 5:15 AM, Sedan & Electric, Secaucus to Newark Liberty (EWR)"],
  ];
  for (const [fix, options, customerSubject, ownerSubject] of trips) {
    const session = paid(fix, options);
    const letters = bookingLetters(session, SETTINGS);
    assert.deepEqual(letters.map((l) => [l.kind, l.subject]), [["customer", customerSubject], ["owner", ownerSubject]]);
    for (const letter of letters) {
      const owner = letter.kind === "owner";
      const raw = buildMessage({ ...letter, from: SETTINGS.from, date: at });
      assert.match(raw, /^[\x00-\x7f]*$/);
      assert.ok(raw.split("\r\n").every((line) => line.length <= 78), letter.subject);
      const mail = parse(raw);
      assert.deepEqual(mail.fields.map(([name]) => name), ["From", "To", "Reply-To", "Subject", "Date", "Message-ID", "MIME-Version", "Auto-Submitted", "Content-Type"]);
      assert.deepEqual(Object.fromEntries(mail.headers), {
        from: '"NYC LUX RIDE" <info@nycluxride.com>',
        to: owner ? "info@nycluxride.com, nycluxride@gmail.com" : '"Ana Lopez" <ana.lopez@example.com>',
        "reply-to": owner ? '"Ana Lopez" <ana.lopez@example.com>' : '"NYC LUX RIDE" <info@nycluxride.com>',
        subject: letter.subject,
        date: "Sun, 08 Nov 2026 03:12:00 +0000",
        "message-id": `<${letter.kind}.${createHash("sha256").update(`${session.id} ${letter.kind}`).digest("hex").slice(0, 32)}@nycluxride.com>`,
        "mime-version": "1.0",
        "auto-submitted": "auto-generated",
        "content-type": mail.headers.get("content-type"),
      });
      assert.match(mail.headers.get("content-type"), /^multipart\/alternative; boundary="nlr-[0-9a-f]{24}"$/);
      assert.deepEqual(mail.parts.map((p) => p.type), ["text/plain", "text/html"]);
      assert.equal(mail.text, letter.text);
      assert.equal(mail.html, letter.html);
      assert.ok(mail.text.includes(`\nReference: ${REF}\n`) && mail.text.includes(`\nPaid: ${money(session.amount_total)}\n`), letter.subject);
      checkHtml(letter, owner ? { stripeLink: `https://dashboard.stripe.com/${options.live ? "" : "test/"}payments/${session.payment_intent}` } : {});
    }
  }
});

await test("the email wording is the confirmation page's wording, word for word, from one source", () => {
  const page = new JSDOM(readFileSync(join(ROOT, "booking-confirmed.html"), "utf8")).window.document;
  const day = page.getElementById("cf-day").dataset;
  assert.deepEqual([MAIL.day.pickup, MAIL.day.meet, MAIL.day.bags, MAIL.day.bagsOther, MAIL.day.back, MAIL.day.backOther, MAIL.day.long, MAIL.day.terminals], [day.p, day.m, day.b1, day.b2, day.r1, day.r2, day.x, day.t]);
  const next = [...page.querySelectorAll("#cf-next > li")].map((li) => [li.querySelector("b").textContent, li.querySelector("span") ? li.querySelector("span").textContent : ""]);
  assert.deepEqual(MAIL.steps, next.slice(0, 2));
  assert.equal(next[2][0], MAIL.day.label);
  assert.equal(page.getElementById("cf-test").textContent.trim(), MAIL.testNote.join(" "));
  assert.equal(page.getElementById("cf-h").textContent, MAIL.heading);
  assert.equal(page.getElementById("cf-receipt-h").textContent, MAIL.payment);
  const done = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((f) => /^done\..+\.js$/.test(f))), "utf8");
  assert.ok(done.includes('"We track your flight. "') && MAIL.day.tracked === "We track your flight.");
  assert.ok(done.includes('hd("fl",!(q&&!fl||X[2]&&!fr))'), "the page links its flight number request for an airport pickup with no flight or an airport return pickup with no return flight");
  assert.equal(page.getElementById("cf-fl").getAttribute("href"), "https://wa.me/16467750556");
  assert.equal(fill(MAIL.day.askFlight, { ref: REF }), "Send us your flight number on WhatsApp with your reference 83558982.");
  assert.ok(done.includes('"The same car and chauffeur stay with "+(R?"them":"you")+" for the hours you booked. "'));
  assert.equal(fill(MAIL.day.hourly, { who: MAIL.day.them }), "The same car and chauffeur stay with them for the hours you booked.");
  assert.ok(done.includes('"Your chauffeur contacts "+(f.pname||"the passenger")+" on the day of the ride. Your confirmation, receipt and any changes go to your email."'));
  assert.equal(fill(MAIL.other, { name: MAIL.thePassenger }), "Your chauffeur contacts the passenger on the day of the ride. Your confirmation, receipt and any changes go to your email.");
  assert.equal(CHECKOUT.afterSubmit, `${MAIL.steps[1][1]} ${MAIL.change}`);
  assert.equal(MAIL.change, "To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference {ref}.");
});

await test("HTML escaping and header injection: names, places, notes and sign text with tags, quotes, CR and LF reach both emails as text, never as markup or extra headers", async () => {
  setEnv();
  const evil = "<script>alert(1)</script>";
  const session = paid(ROUND, {
    metadata: { name: `Ana\r\nBcc: victim@example.org ${evil}`, from_text: "253 West 72nd Street\r\nX-Injected: yes <b>bold</b>", notes: `${evil}\n<img src=x onerror=alert(2)>\n"quoted" & 'single'`, sign_name: "</td><td>Owner", passenger_name: "Ben <i>Ortiz</i>" },
    customer: { name: "Pat\nCc: victim@example.org" },
  });
  const letters = bookingLetters(session, SETTINGS);
  for (const letter of letters) {
    const raw = buildMessage({ ...letter, from: SETTINGS.from });
    const mail = parse(raw);
    assert.match(raw, /^[\x00-\x7f]*$/, "the message is 7-bit");
    assert.ok(raw.split("\r\n").every((line) => line.length <= 78), "no line over 78 characters");
    assert.deepEqual(mail.fields.map(([name]) => name), ["From", "To", "Reply-To", "Subject", "Date", "Message-ID", "MIME-Version", "Auto-Submitted", "Content-Type"]);
    assert.ok(!/^(bcc|cc|x-injected):/im.test(mail.head));
    assert.ok(!mail.headers.get("subject").includes("\n") && !mail.headers.get("subject").includes("\r"));
    const { document } = new JSDOM(letter.html).window;
    assert.equal(document.querySelectorAll("script, img, b, i").length, 0);
    assert.ok(document.body.textContent.includes(`${evil}`));
    assert.ok(document.body.textContent.includes(`<img src=x onerror=alert(2)>`));
    assert.ok(document.body.textContent.includes(`"quoted" & 'single'`));
    assert.equal(document.querySelectorAll("td").length, document.querySelectorAll("th").length);
    assert.ok(!letter.html.includes("<script>") && !letter.html.includes("<img") && !letter.html.includes("</td><td>Owner"));
  }
  const [customer, owner] = letters.map((letter) => parse(buildMessage({ ...letter, from: SETTINGS.from })));
  assert.equal(customer.headers.get("to"), `"Ana Bcc: victim@example.org ${evil}" <ana.lopez@example.com>`);
  assert.equal(customer.headers.get("reply-to"), '"NYC LUX RIDE" <info@nycluxride.com>');
  assert.equal(owner.headers.get("reply-to"), `"Ana Bcc: victim@example.org ${evil}" <ana.lopez@example.com>`);
  assert.equal(owner.headers.get("subject"), "[TEST] New booking 83558982: Thu Nov 12, 7:30 AM, Business Premium SUV, JFK to 350 5th Ave, return Sun Nov 15, 6:00 PM");
  const nameless = bookingLetters(paid(ONE_WAY, { metadata: { from_text: "253 W 72nd St\r\nBcc: victim@example.org, NY", to_text: "Somewhere\nX-Injected: 1", to_zone: "manhattan" } }), SETTINGS)[1];
  assert.equal(nameless.subject, "[TEST] New booking 83558982: Sun Nov 8, 10:00 AM, Business SUV, 253 W 72nd St Bcc: victim@example.org to Somewhere X-Injected: 1");
  const header = buildMessage({ ...nameless, from: SETTINGS.from }).split("\r\n\r\n")[0];
  assert.ok(!/^(bcc|x-injected):/im.test(header));
  const typed = paid(ONE_WAY, { metadata: { from_text: "Smith & Wollensky </title><img/src=x>, 797 3rd Ave, New York, NY 10022", from_zone: "manhattan", to_text: "Tom & Jerry's </title><img/src=x>, 1 Main Street, Brooklyn, NY 11201", to_zone: "brooklyn", to_place: "" } });
  const titled = bookingLetters(typed, SETTINGS)[1];
  assert.equal(titled.subject, "[TEST] New booking 83558982: Sun Nov 8, 10:00 AM, Business SUV, Smith & Wollensky </title><img/src=x> to Tom & Jerry's </title><img/src=x>");
  const titledDoc = checkHtml(titled, { stripeLink: `https://dashboard.stripe.com/test/payments/${typed.payment_intent}` });
  assert.equal(titledDoc.title, titled.subject);
  assert.equal(titledDoc.querySelectorAll("img").length, 0);
  assert.ok(titled.html.includes("<title>[TEST] New booking 83558982: Sun Nov 8, 10:00 AM, Business SUV, Smith &#38; Wollensky &#60;/title&#62;&#60;img/src=x&#62; to Tom &#38; Jerry&#39;s &#60;/title&#62;&#60;img/src=x&#62;</title>"));
  assert.ok(!titled.html.includes("</title><img") && !titled.html.includes("Smith & Wollensky"));
});

await test("the customer never receives the owner addresses: separate envelope, no Cc or Bcc, no owner address in the headers, the text or the HTML", async () => {
  setEnv();
  const owners = ["dispatch.desk@nycluxride.com", "owner.private@example.net", "nycluxride@gmail.com"];
  const session = paid(ROUND);
  const [customer, owner] = bookingLetters(session, { ...SETTINGS, owners });
  assert.deepEqual(customer.to.map((box) => box.address), ["ana.lopez@example.com"]);
  assert.deepEqual(owner.to.map((box) => box.address), owners);
  const raw = buildMessage({ ...customer, from: SETTINGS.from });
  const mail = parse(raw);
  for (const address of owners) {
    for (const part of [mail.head, mail.text, mail.html, customer.text, customer.html]) assert.ok(!part.includes(address), address);
  }
  assert.ok(!/^(cc|bcc):/im.test(mail.head));
});

await test("non-ASCII names and places: RFC 2047 words in To, Reply-To and the owner subject that decode back, UTF-8 bodies that decode back, every line ASCII and short", async () => {
  setEnv();
  const session = paid(ROUND, { metadata: { name: "Zoë Ångström-Øster", to_text: "Café Boulud, 20 East 76th Street, New York, NY 10021", to_zone: "manhattan", notes: "Bébé seat 👶, merci" } });
  const [customer, owner] = bookingLetters(session, SETTINGS);
  for (const letter of [customer, owner]) {
    const raw = buildMessage({ ...letter, from: SETTINGS.from });
    assert.match(raw, /^[\x00-\x7f]*$/);
    assert.ok(raw.split("\r\n").every((line) => line.length <= 78));
    const mail = parse(raw);
    assert.equal(mail.headers.get("subject"), letter.subject);
    assert.equal(mail.text, letter.text);
    assert.equal(mail.html, letter.html);
    assert.ok(mail.parts.every((part) => /Content-Type: text\/(plain|html); charset=utf-8\r\nContent-Transfer-Encoding: base64/.test(part.meta)));
  }
  assert.equal(parse(buildMessage({ ...customer, from: SETTINGS.from })).headers.get("to"), "Zoë Ångström-Øster <ana.lopez@example.com>");
  assert.equal(owner.subject, "[TEST] New booking 83558982: Thu Nov 12, 7:30 AM, Business Premium SUV, JFK to Café Boulud, return Sun Nov 15, 6:00 PM");
  assert.ok(customer.text.includes("Notes for the chauffeur: Bébé seat 👶, merci"));
});

await test("sales tax in both emails: a Nassau pickup pays the Nassau rate, a round trip to Newark and a trip from JFK to Connecticut pay no New York sales tax, and every payment section adds up to the total paid", async () => {
  setEnv();
  assert.deepEqual([NASSAU.metadata.fare_cents, NASSAU.metadata.tax_cents, NASSAU.metadata.bcf_cents, NASSAU.total], ["15500", "1337", "349", 17186]);
  assert.deepEqual([NEWARK_ROUND.metadata.fare_cents, NEWARK_ROUND.metadata.tax_cents, NEWARK_ROUND.metadata.tolls_cents, NEWARK_ROUND.total], ["33692", "0", "2550", 37000]);
  assert.deepEqual([CONNECTICUT.metadata.tax_cents, CONNECTICUT.total], ["0", 15849]);
  const want = {
    [NASSAU.metadata.date + NASSAU.metadata.from_text]: ["Fare: $155.00", "Taxes and fees: $16.86", "Paid: $171.86"],
    [NEWARK_ROUND.metadata.date + NEWARK_ROUND.metadata.from_text]: ["Fare: $336.92", "Taxes and fees: $7.58", "Tolls: $25.50", "Paid: $370.00"],
    [CONNECTICUT.metadata.date + CONNECTICUT.metadata.from_text]: ["Fare: $155.00", "Taxes and fees: $3.49", "Paid: $158.49"],
  };
  for (const fix of [NASSAU, NEWARK_ROUND, CONNECTICUT]) {
    const session = paid(fix);
    const charged = receipt(session.metadata, readSettings({}), undefined).lines;
    assert.equal(charged.reduce((sum, line) => sum + line.cents, 0), session.amount_total);
    for (const letter of bookingLetters(session, SETTINGS)) {
      const lines = sectionOf(letter.text, letter.kind === "owner" ? "Payment" : "Your payment");
      assert.deepEqual(lines, want[fix.metadata.date + fix.metadata.from_text], letter.kind);
      assert.ok(!letter.text.includes("NYC sales tax"), letter.kind);
    }
  }
});

await test("a child seats line whenever the payment metadata has child_seats, and none without it", async () => {
  setEnv();
  const [withSeats, owner] = bookingLetters(paid(ONE_WAY, { metadata: { child_seats: "1 infant seat, 1 booster" } }), SETTINGS);
  assert.ok(withSeats.text.includes("\nChild seats: 1 infant seat, 1 booster\n") && owner.text.includes("\nChild seats: 1 infant seat, 1 booster\n"));
  assert.ok(withSeats.html.includes(">Child seats</th>"));
  const [without] = bookingLetters(paid(ONE_WAY), SETTINGS);
  assert.ok(!without.text.includes("Child seats"));
});

await test("a paid booking with child seats from the booking form names the seat types in the Child seats row of both emails and lists the seat line of the receipt at $15.00 a seat with the total paid", async () => {
  setEnv();
  assert.deepEqual([SEATS.metadata.seats_cents, SEATS.metadata.seats, ["child_seats", "infant_seats", "toddler_seats", "booster_seats"].filter((k) => k in SEATS.metadata), SEATS.total], ["4500", "1 infant, 2 booster", [], 27825]);
  const session = paid(SEATS);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  const pay = ["Fare: $155.00", "Taxes and fees: $17.25", "Tolls: $12.75", "Meet and greet: $25.00", "Child seats (3 x $15.00): $45.00", "Gratuity for your chauffeur (15%): $23.25", "Paid: $278.25"];
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes("\nPassengers: 3\nVehicle: Business SUV\n"), letter.kind);
    assert.ok(letter.text.includes("\nChild seats: 1 infant seat and 2 booster seats\n"), letter.kind);
    assert.deepEqual(sectionOf(letter.text, letter.kind === "customer" ? "Your payment" : "Payment"), pay, letter.kind);
    const doc = checkHtml(letter, letter.kind === "owner" ? { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` } : {});
    const tables = Object.fromEntries(tripTable(doc));
    assert.deepEqual(tables[letter.kind === "customer" ? "Your trip" : "Trip"].find(([label]) => label === "Child seats"), ["Child seats", "1 infant seat and 2 booster seats"], letter.kind);
    assert.deepEqual(tables[letter.kind === "customer" ? "Your payment" : "Payment"], pay.map((line) => line.split(": ")), letter.kind);
  }
  assert.equal(receipt(session.metadata, readSettings({}), undefined).lines.reduce((sum, line) => sum + line.cents, 0), session.amount_total);
  const one = bookingLetters(paid(ONE_WAY, { metadata: { seats_cents: "1500", child_seats: "1", toddler_seats: "1" } }), SETTINGS)[0];
  assert.ok(one.text.includes("\nChild seats: 1 toddler seat\n") && one.text.includes("\nChild seats (1 x $15.00): $15.00\n"), one.text);
});

await test("a paid booking with pets names them in a Pets row right after the Child seats row of both emails, lists a Small dog and a Large dog line in the receipt at $20.00 and $45.00 a dog with the total paid, and shows no Pets row without dogs", async () => {
  setEnv();
  assert.deepEqual([DOGS.metadata.dogs, DOGS.metadata.seats_cents, "child_seats" in DOGS.metadata, DOGS.total], ["1 small 2000, 2 large 9000", "4500", false, 38825]);
  const session = paid(DOGS);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  const pay = ["Fare: $155.00", "Taxes and fees: $17.25", "Tolls: $12.75", "Meet and greet: $25.00", "Child seats (3 x $15.00): $45.00", "Small dog (1 x $20.00): $20.00", "Large dog (2 x $45.00): $90.00", "Gratuity for your chauffeur (15%): $23.25", "Paid: $388.25"];
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes("\nChild seats: 1 infant seat and 2 booster seats\nPets: 1 small dog and 2 large dogs\n"), letter.kind);
    assert.deepEqual(sectionOf(letter.text, letter.kind === "customer" ? "Your payment" : "Payment"), pay, letter.kind);
    const doc = checkHtml(letter, letter.kind === "owner" ? { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` } : {});
    const tables = Object.fromEntries(tripTable(doc));
    const rows = tables[letter.kind === "customer" ? "Your trip" : "Trip"];
    const at = rows.findIndex(([label]) => label === "Child seats");
    assert.deepEqual(rows[at + 1], ["Pets", "1 small dog and 2 large dogs"], letter.kind);
    assert.deepEqual(tables[letter.kind === "customer" ? "Your payment" : "Payment"], pay.map((line) => line.split(": ")), letter.kind);
  }
  assert.equal(receipt(session.metadata, readSettings({}), undefined).lines.reduce((sum, line) => sum + line.cents, 0), session.amount_total);
  const one = bookingLetters(paid(ONE_WAY, { metadata: { dogs: "1 large 4500" } }), SETTINGS)[0];
  assert.ok(one.text.includes("\nPets: 1 large dog\n") && one.text.includes("\nLarge dog (1 x $45.00): $45.00\n") && !one.text.includes("Child seats"), one.text);
  for (const letter of bookingLetters(paid(SEATS), SETTINGS)) assert.ok(!/Pets|dog/.test(letter.text) && !letter.html.includes(">Pets</th>"), letter.kind);
});

const LEGACY_KEYS = ["from_zone", "from_place", "to_zone", "to_place", "stop1_zone", "stop2_zone", "child_seats", "infant_seats", "toddler_seats", "booster_seats"];
const LEGACY_WORST = { ref: "83558982", service: "distance", direction: "from-airport", airport: "jfk", class: "sprinter", vehicle: "sprinter-executive", from_text: "John F. Kennedy (JFK), Terminal 4", from_zone: "jfk", from_place: "jfk-t4", to_text: "1 Old Country Rd, Mineola, NY 11501, USA", to_zone: "outside", to_place: "ChIJ7cv00DwsDogRAMDACa2m4K8", stop1_text: "350 5th Ave, New York, NY 10118, USA", stop1_zone: "manhattan", stop2_text: "277 Bedford Ave, Brooklyn, NY 11211, USA", stop2_zone: "brooklyn", date: "2026-11-12", time: "07:30", pickup_at: "2026-11-12T12:30:00.000Z", return_date: "2026-11-15", return_time: "18:00", return_at: "2026-11-15T23:00:00.000Z", passengers: "12", flight: "DL 401", meet: "1", tip_percent: "0", legs: "2", miles: "33.6", minutes: "86", fare_cents: "87694", tax_cents: "7673", bcf_cents: "1974", tolls_cents: "0", stops_cents: "4000", meet_cents: "2500", seats_cents: "18000", child_seats: "12", infant_seats: "4", toddler_seats: "4", booster_seats: "4", tip_cents: "4000", total_cents: "125841", rider: "other", name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100", reach: "whatsapp", passenger_name: "Ben Ortiz", passenger_phone: "+44 20 7946 0958", sign_name: "Ortiz family", notes: "Kids aged 1, 3 and 6" };
const legacyOf = (metadata) => {
  const out = { ...metadata };
  for (const [key, fields] of [["zones", "zone"], ["places", "place"]]) for (const part of (out[key] || "").split(", ").filter(Boolean)) out[`${part.split(" ")[0]}_${fields}`] = part.split(" ")[1];
  const seats = (out.seats || "").split(", ").filter(Boolean).map((part) => part.split(" "));
  if (seats.length) out.child_seats = String(seats.reduce((sum, [n]) => sum + Number(n), 0));
  for (const [n, kind] of seats) out[`${kind}_seats`] = n;
  delete out.zones;
  delete out.places;
  delete out.seats;
  return out;
};
const rebuilt = (session) => ({
  letters: bookingLetters(session, SETTINGS),
  text: bookingText(session),
  events: bookingEvents(session),
  refund: refundChanges(session, { amount: session.amount_total, amount_refunded: 10000, refunded: false }, 1794600000).map(({ id, refunded, event }) => ({ id, refunded, event })),
  receipt: receipt(session.metadata, readSettings({}), undefined),
  page: sessionBodyOf(session),
});

await test("a booking paid before the metadata was packed, with from_zone, from_place, to_zone, to_place, stop1_zone, stop2_zone, child_seats and the seat counts per type, rebuilds exactly the emails, the owner text, the calendar events, the refund note, the receipt and the confirmation page of the same booking written with zones, places and seats", async () => {
  setEnv({ STRIPE_SECRET_KEY: KEY });
  assert.deepEqual([Object.keys(LEGACY_WORST).length, Object.keys(WORST.metadata).length, LEGACY_KEYS.filter((k) => k in WORST.metadata), WORST.total], [51, 44, [], 125841]);
  assert.deepEqual([WORST.metadata.zones, WORST.metadata.places, WORST.metadata.seats], ["from jfk, stop1 manhattan, stop2 brooklyn, to outside", "from jfk-t4, to ChIJ7cv00DwsDogRAMDACa2m4K8", "4 infant, 4 toddler, 4 booster"]);
  assert.deepEqual(legacyOf(WORST.metadata), LEGACY_WORST);
  assert.deepEqual(bookingData(WORST.metadata), { ...LEGACY_WORST, zones: WORST.metadata.zones, places: WORST.metadata.places, seats: WORST.metadata.seats });
  const packed = paid(WORST);
  const legacy = { ...packed, metadata: LEGACY_WORST };
  const now = rebuilt(packed);
  assert.deepEqual(rebuilt(legacy), now);
  const [customer, owner] = now.letters;
  for (const letter of [customer, owner]) {
    assert.ok(letter.text.includes("\nStop 1: 350 5th Ave, New York, NY 10118\nStop 2: 277 Bedford Ave, Brooklyn, NY 11211\nDrop-off: 1 Old Country Rd, Mineola, NY 11501\n"), letter.kind);
    assert.ok(letter.text.includes("\nChild seats: 4 infant seats, 4 toddler seats and 4 booster seats\n"), letter.kind);
    assert.ok(letter.text.includes("\nChild seats (12 x $15.00): $180.00\n"), letter.kind);
  }
  for (const key of ["zones", "seats"]) assert.notDeepEqual(rebuilt({ ...packed, metadata: { ...WORST.metadata, [key]: "" } }), now, key);
  assert.match(owner.subject, /^\[TEST\] New booking 83558982: Thu Nov 12, 7:30 AM, Executive Sprinter, JFK to 1 Old Country Rd, return Sun Nov 15, 6:00 PM$/);
  assert.equal(now.receipt.lines.reduce((sum, line) => sum + line.cents, 0), WORST.total);
  assert.deepEqual(now.events.map((event) => event.summary), ["[TEST] 83558982 Executive Sprinter: JFK to 1 Old Country Rd", "[TEST] Return: 83558982 Executive Sprinter: 1 Old Country Rd to JFK"]);
  const { vehicle, ...unnamed } = LEGACY_WORST;
  const old = rebuilt({ ...legacy, metadata: unnamed });
  assert.equal(vehicle, "sprinter-executive");
  assert.match(old.letters[1].subject, /^\[TEST\] New booking 83558982: Thu Nov 12, 7:30 AM, Luxury Sprinter, JFK to 1 Old Country Rd, return Sun Nov 15, 6:00 PM$/);
  assert.deepEqual(old.events.map((event) => event.summary), ["[TEST] 83558982 Luxury Sprinter: JFK to 1 Old Country Rd", "[TEST] Return: 83558982 Luxury Sprinter: 1 Old Country Rd to JFK"]);
  assert.deepEqual([old.receipt.lines, old.page.total_cents], [now.receipt.lines, now.page.total_cents]);
  stripe.sessions.set(packed.id, legacy);
  const before = await (await lookup(packed)).json();
  stripe.sessions.set(packed.id, packed);
  assert.deepEqual(await (await lookup(packed)).json(), before);
  assert.deepEqual(before, now.page);
});

await test("every booking shape written with zones, places and seats rebuilds the same emails, owner text, calendar events, refund note, receipt and confirmation page as the old keys: one way, round trip, hourly, stops, a JFK terminal, New Jersey, Nassau, someone else riding, child seats and pets", async () => {
  setEnv();
  for (const [name, fix] of Object.entries({ ONE_WAY, ROUND, HOURLY, NEW_JERSEY, STOPS, STOPS_ROUND, STOPS_FAR, STOP_ONE_WAY, TERMINAL, NO_FLIGHT, NO_RETURN_FLIGHT, FOR_OTHER, TO_T5, SEATS, DOGS, HOURLY_JFK, NASSAU, NEWARK_ROUND, CONNECTICUT, WORST, WORST_DOGS })) {
    assert.deepEqual(LEGACY_KEYS.filter((k) => k in fix.metadata), [], name);
    assert.ok(Object.keys(fix.metadata).length <= 48, name);
    const packed = paid(fix);
    assert.deepEqual(rebuilt({ ...packed, metadata: legacyOf(fix.metadata) }), rebuilt(packed), name);
  }
});

await test("[TEST] starts both subjects only for a test mode session, and the test booking notice opens both bodies", async () => {
  setEnv();
  const test = bookingLetters(paid(ONE_WAY), SETTINGS);
  const live = bookingLetters(paid(ONE_WAY, { live: true }), SETTINGS);
  assert.deepEqual(test.map((l) => l.subject.startsWith("[TEST] ")), [true, true]);
  assert.deepEqual(live.map((l) => l.subject.includes("[TEST]")), [false, false]);
  assert.deepEqual(test.map((l) => l.text.startsWith("Test booking. No real payment was taken.\n")), [true, true]);
  assert.deepEqual(live.map((l) => l.text.includes("Test booking")), [false, false]);
  const flagged = paid(ONE_WAY, { live: true });
  flagged.livemode = false;
  assert.ok(bookingLetters(flagged, SETTINGS)[0].subject.startsWith("[TEST] "));
});

await test("settings: defaults for host, port, sender and owners, OWNER_EMAILS parsed and de-duplicated, a bad sender, host or port turns sending off", () => {
  setEnv({ SMTP_USER: USER, SMTP_PASS: PASS });
  assert.deepEqual(mailSettings(), { host: "smtp.gmail.com", port: 465, user: USER, pass: PASS, from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" }, owners: OWNERS, helo: "nycluxride.com" });
  setEnv({ SMTP_USER: USER, SMTP_PASS: PASS, OWNER_EMAILS: " a@example.com; B@example.com,b@example.com  not-an-address\nc@example.com ", MAIL_FROM: "Bookings <bookings@nycluxride.com>" });
  assert.deepEqual([mailSettings().owners, mailSettings().from], [["a@example.com", "B@example.com", "c@example.com"], { name: "Bookings", address: "bookings@nycluxride.com" }]);
  for (const bad of [{ MAIL_FROM: "NYC LUX RIDE <not an address>" }, { SMTP_HOST: "smtp.gmail.com\r\nRCPT" }, { SMTP_PORT: "70000" }, { SMTP_PORT: "465x" }]) {
    setEnv({ SMTP_USER: USER, SMTP_PASS: PASS, ...bad });
    assert.deepEqual(mailSettings(), { bad: true }, JSON.stringify(bad));
  }
  for (const off of [{}, { SMTP_USER: USER }, { SMTP_PASS: PASS }, { SMTP_USER: " ", SMTP_PASS: PASS }]) {
    setEnv(off);
    assert.deepEqual(mailSettings(), { off: true }, JSON.stringify(off));
  }
});

await test("dormant mode: without SMTP_USER or SMTP_PASS the confirmation check and the webhook answer as before, open no connection, touch no marker and log one line each", async () => {
  for (const env of [{}, { SMTP_USER: USER }, { SMTP_PASS: PASS }]) {
    setEnv({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), ...env });
    const session = paid(ONE_WAY);
    const res = await lookup(session);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), sessionBodyOf(session));
    assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path}`), [`GET /v1/checkout/sessions/${session.id}`]);
    assert.deepEqual([noted, logged], [["mail-off 83558982"], []]);
    noted.length = 0;
    stripe.calls.length = 0;
    const hooked = await hook(completed(session));
    assert.equal(hooked.status, 200);
    assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path}`), [`GET /v1/checkout/sessions/${session.id}`]);
    assert.deepEqual([noted, logged], [["mail-off 83558982"], []]);
    assert.equal(smtp.sessions.length, 0);
    assert.deepEqual([markersOf(session).metadata, stripe.intents.get(session.payment_intent).metadata], [ONE_WAY.metadata, ONE_WAY.metadata]);
  }
});

await test("the confirmation check sends both emails once a session is paid, sets emailed_at on the Checkout Session, and later checks and the webhook send nothing more", async () => {
  setEnv(mailEnv());
  withContext();
  const session = paid(ONE_WAY);
  const res = await lookup(session);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), sessionBodyOf(session));
  assert.deepEqual(await settled(), ["sent"]);
  const sent = delivered();
  assert.deepEqual(sent.map((m) => [m.to, m.mail.headers.get("subject")]), [[["ana.lopez@example.com"], "[TEST] Your NYC LUX RIDE booking 83558982, Sun Nov 8, 10:00 AM"], [OWNERS, "[TEST] New booking 83558982: Sun Nov 8, 10:00 AM, Business SUV, 253 West 72nd Street to Newark Liberty (EWR)"]]);
  const [customer, owner] = sent.map((m) => m.mail);
  assert.equal(customer.headers.get("from"), '"NYC LUX RIDE" <info@nycluxride.com>');
  assert.equal(customer.headers.get("to"), '"Ana Lopez" <ana.lopez@example.com>');
  assert.equal(customer.headers.get("reply-to"), '"NYC LUX RIDE" <info@nycluxride.com>');
  assert.equal(owner.headers.get("to"), "info@nycluxride.com, nycluxride@gmail.com");
  assert.equal(owner.headers.get("reply-to"), '"Ana Lopez" <ana.lopez@example.com>');
  assert.match(customer.headers.get("date"), /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/);
  assert.match(customer.headers.get("message-id"), /^<customer\.[0-9a-f]{32}@nycluxride\.com>$/);
  assert.match(owner.headers.get("message-id"), /^<owner\.[0-9a-f]{32}@nycluxride\.com>$/);
  assert.deepEqual([customer.headers.get("mime-version"), customer.headers.get("auto-submitted")], ["1.0", "auto-generated"]);
  assert.match(customer.headers.get("content-type"), /^multipart\/alternative; boundary="nlr-[0-9a-f]{24}"$/);
  assert.deepEqual(customer.parts.map((p) => p.type), ["text/plain", "text/html"]);
  const marker = markersOf(session).metadata;
  assert.match(marker.emailed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(marker.email_attempt, undefined);
  assert.ok(Object.keys(marker).length <= 50);
  assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET /v1/checkout/sessions/${session.id} `, `POST /v1/checkout/sessions/${session.id} nlr-mail-${session.id}-1`, `POST /v1/checkout/sessions/${session.id} nlr-mail-${session.id}-1-done`]);
  assert.deepEqual(stripe.intents.get(session.payment_intent).metadata, ONE_WAY.metadata);
  assert.ok(stripe.calls.every((c) => c.auth === `Bearer ${KEY}`));
  assert.deepEqual(noted, ["sms-off 83558982", "mail-sent 83558982 customer owner"]);
  assert.deepEqual(logged, []);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await (await lookup(session)).json(), sessionBodyOf(session));
    assert.deepEqual(await settled(), ["done"]);
  }
  const hooked = await hook(completed(session));
  assert.equal(hooked.status, 200);
  assert.equal(delivered().length, 2);
  assert.equal(smtp.sessions.length, 1);
});

await test("the webhook sends both emails to the addresses Stripe holds for the session, never to the ones in the event body, and the confirmation check then sends nothing", async () => {
  setEnv(mailEnv());
  const session = paid(ROUND);
  const res = await hook(completed(session));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
  const sent = delivered();
  assert.deepEqual(sent.map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  for (const m of sent) for (const value of Object.values(forged)) assert.ok(!m.data.includes(value) && !m.mail.text.includes(value) && !m.mail.html.includes(value));
  assert.ok(!sent[1].mail.text.includes("Forged notes"));
  assert.ok(markersOf(session).metadata.emailed_at);
  withContext();
  await lookup(session);
  assert.deepEqual(await settled(), ["done"]);
  assert.equal(delivered().length, 2);
});

await test("the send-once claim: a confirmation check and a webhook that arrive together send each email exactly once", async () => {
  setEnv(mailEnv());
  stripe.delay = 40;
  withContext();
  const session = paid(HOURLY);
  const [page, hooked] = await Promise.all([lookup(session), hook(completed(session))]);
  assert.equal(page.status, 200);
  assert.deepEqual(await page.json(), sessionBodyOf(session));
  const results = await settled();
  assert.equal(hooked.status, 200);
  assert.ok(["sent", "busy"].includes(results[0]), results[0]);
  const sent = delivered();
  assert.deepEqual(sent.map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(smtp.sessions.length, 1);
  const claims = stripe.calls.filter((c) => c.method === "POST" && c.idempotency === `nlr-mail-${session.id}-1`);
  assert.equal(claims.length, 2);
  assert.ok(markersOf(session).metadata.emailed_at);
});

await test("a failing SMTP server never breaks the confirmation page: a refused password, a dropped connection and a closed port all answer the normal paid body, mark the try failed, and the next check sends", async () => {
  setEnv(mailEnv());
  withContext();
  smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
  const session = paid(ONE_WAY);
  const res = await lookup(session);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), sessionBodyOf(session));
  assert.deepEqual(await settled(), ["failed"]);
  assert.deepEqual(logged, ["mail-fail 83558982 customer auth 535", "mail-fail 83558982 owner auth 535"]);
  assert.equal(delivered().length, 0);
  const tried = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.failed, tried.sent, markersOf(session).metadata.emailed_at], [1, true, [], undefined]);
  smtp.behavior = {};
  logged.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.equal(delivered().length, 2);
  assert.ok(markersOf(session).metadata.emailed_at && !markersOf(session).metadata.email_attempt);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.id}-2`));
  const closed = await new Promise((resolve) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  setEnv(mailEnv({ SMTP_PORT: String(closed) }));
  withContext();
  const other = paid(HOURLY);
  const answer = await lookup(other);
  assert.deepEqual([answer.status, await answer.json()], [200, sessionBodyOf(other)]);
  assert.deepEqual(await settled(), ["failed"]);
  assert.deepEqual(logged, ["mail-fail 83558982 customer connect ECONNREFUSED", "mail-fail 83558982 owner connect ECONNREFUSED"]);
});

await test("a mail server that stops answering never holds the confirmation page past the short bound, and the late failure is marked for the next try", async () => {
  setEnv(mailEnv());
  smtp.behavior = { hang: "EHLO" };
  const session = paid(NEW_JERSEY);
  const started = Date.now();
  const res = await lookup(session);
  const took = Date.now() - started;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), sessionBodyOf(session));
  assert.ok(took >= 1400 && took < 2500, `took ${took} ms`);
  await until(() => smtp.sockets.size > 0);
  for (const socket of smtp.sockets) socket.destroy();
  await until(() => logged.length === 2);
  assert.ok(logged.every((line, i) => new RegExp(`^mail-fail 83558982 ${["customer", "owner"][i]} ehlo (closed|ECONNRESET)$`).test(line)), logged.join(" | "));
  await until(() => markersOf(session).metadata.email_attempt && JSON.parse(markersOf(session).metadata.email_attempt).failed);
});

await test("a request context that throws never breaks the confirmation page: the paid body comes back, one line says so, and the emails still go out once", async () => {
  const broken = [
    { get: () => { throw new Error("context"); } },
    { get: () => ({ waitUntil: () => { throw new Error("waitUntil"); } }) },
  ];
  for (const context of broken) {
    setEnv(mailEnv());
    globalThis[CONTEXT] = context;
    const session = paid(ONE_WAY);
    const res = await lookup(session);
    const answered = [res.status, await res.json()];
    await until(() => delivered().length === 2 && markersOf(session).metadata.emailed_at);
    assert.deepEqual(answered, [200, sessionBodyOf(session)]);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    assert.deepEqual(logged, ["mail-context"]);
    withoutContext();
  }
});

await test("a message that fails alone is retried alone: the customer email is never sent twice when only the owner email failed", async () => {
  setEnv(mailEnv());
  withContext();
  smtp.behavior = { reject: OWNERS };
  const session = paid(ROUND);
  await lookup(session);
  assert.deepEqual(await settled(), ["failed"]);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"]]);
  assert.deepEqual(JSON.parse(markersOf(session).metadata.email_attempt).sent, ["customer"]);
  assert.deepEqual(logged, ["mail-fail 83558982 owner rcpt 550"]);
  smtp.behavior = {};
  smtp.sessions.length = 0;
  const hooked = await hook(completed(session));
  assert.equal(hooked.status, 200);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[OWNERS, "<owner"]]);
  assert.ok(markersOf(session).metadata.emailed_at);
});

await test("a customer email the mail server refuses never holds back the owner notice: the owner gets it, the try is marked failed, and the next check sends only the customer email", async () => {
  setEnv(mailEnv());
  withContext();
  smtp.behavior = { refuse: (mail) => (mail.to.includes("ana.lopez@example.com") ? "554 5.7.0 Message rejected" : "") };
  const session = paid(ONE_WAY);
  const res = await lookup(session);
  assert.deepEqual([res.status, await res.json()], [200, sessionBodyOf(session)]);
  assert.deepEqual(await settled(), ["failed"]);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[OWNERS, "<owner"]]);
  assert.deepEqual([logged, noted], [["mail-fail 83558982 customer message 554"], ["sms-off 83558982", "mail-sent 83558982 owner"]]);
  const tried = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.failed, tried.sent, markersOf(session).metadata.emailed_at], [1, true, ["owner"], undefined]);
  smtp.behavior = {};
  smtp.sessions.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[["ana.lopez@example.com"], "<customer"]]);
  assert.ok(markersOf(session).metadata.emailed_at && !markersOf(session).metadata.email_attempt);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.id}-2`));
});

await test("refused logins and bad mail settings never use up the tries: until the setting is fixed the webhook answers 503 so Stripe retries, and after five refused logins the fixed password sends each email once", async () => {
  setEnv(mailEnv());
  withContext();
  smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
  const session = paid(ONE_WAY);
  for (let i = 0; i < 5; i++) {
    if (i % 2) assert.equal((await hook(completed(session))).status, 503);
    else {
      await lookup(session);
      assert.deepEqual(await settled(), ["failed"]);
    }
  }
  const tried = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.failed, tried.sent, delivered().length], [5, true, [], 0]);
  assert.deepEqual(logged, Array(5).fill(["mail-fail 83558982 customer auth 535", "mail-fail 83558982 owner auth 535"]).flat());
  smtp.behavior = {};
  logged.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[["ana.lopez@example.com"], "<customer"], [OWNERS, "<owner"]]);
  assert.ok(markersOf(session).metadata.emailed_at && !markersOf(session).metadata.email_attempt);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.id}-6`));
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual([delivered().length, logged, tried.tries], [2, [], 0]);
  for (const bad of [{ MAIL_FROM: "NYC LUX RIDE <not an address>" }, { SMTP_HOST: "smtp.gmail.com\r\nRCPT" }, { SMTP_PORT: "70000" }]) {
    setEnv(mailEnv(bad));
    const other = paid(HOURLY);
    const res = await hook(completed(other));
    assert.deepEqual([res.status, await res.json()], [503, { received: false }], JSON.stringify(bad));
    assert.deepEqual([logged, smtp.sessions.length, stripe.calls.map((c) => `${c.method} ${c.path}`)], [["mail-config 83558982"], 0, [`GET /v1/checkout/sessions/${other.id}`]]);
    for (const name of Object.keys(bad)) delete process.env[name];
    Object.assign(process.env, mailEnv());
    assert.equal((await hook(completed(other))).status, 200);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  }
});

await test("a message the server refuses after DATA, or a claim that never finished, uses up a try, so after five the next check and the webhook give up instead of sending without end", async () => {
  setEnv(mailEnv());
  withContext();
  smtp.behavior = { refuse: (mail) => (mail.to.includes("ana.lopez@example.com") ? "554 5.7.0 Message rejected" : "") };
  const session = paid(ROUND);
  for (let i = 0; i < 5; i++) {
    await lookup(session);
    assert.deepEqual(await settled(), ["failed"]);
  }
  const tried = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.sent], [5, ["owner"]]);
  smtp.behavior = {};
  logged.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["gave-up"]);
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(logged, ["mail-gave-up 83558982", "mail-gave-up 83558982"]);
  assert.deepEqual(delivered().map((m) => m.to), [OWNERS]);
  const unfinished = (tries) => {
    const booking = paid(ONE_WAY);
    markersOf(booking).metadata.email_attempt = JSON.stringify({ n: 7, at: new Date(Date.now() - 130000).toISOString(), id: "abc123", sent: [], tries });
    return booking;
  };
  const spent = unfinished(4);
  await lookup(spent);
  assert.deepEqual(await settled(), ["gave-up"]);
  const left = unfinished(3);
  await lookup(left);
  assert.deepEqual(await settled(), ["sent"]);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${left.id}-8`));
  assert.deepEqual(delivered().slice(1).map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(tried.tries, 5);
});

await test("a webhook that finds the work already claimed waits for it, and answers 503 so Stripe retries when the claim is still open", async () => {
  setEnv(mailEnv());
  const session = paid(ONE_WAY);
  markersOf(session).metadata.email_attempt = JSON.stringify({ n: 1, at: new Date().toISOString(), id: "abc123", sent: [] });
  const started = Date.now();
  const res = await hook(completed(session));
  assert.equal(res.status, 503);
  assert.ok(Date.now() - started >= 3900, "it waits twice before it gives up");
  assert.equal(stripe.calls.filter((c) => c.method === "GET" && c.path.startsWith("/v1/checkout/sessions/")).length, 3);
  assert.equal(delivered().length, 0);
  markersOf(session).metadata.email_attempt = JSON.stringify({ n: 1, at: new Date(Date.now() - 130000).toISOString(), id: "abc123", sent: [] });
  assert.equal((await hook(completed(session))).status, 200);
  assert.equal(delivered().length, 2);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.id}-2`));
});

await test("the marker lives only on the Checkout Session metadata, which the documented key can write: whatever the key may do with the PaymentIntent, it is never read or written, no 403 is logged, and the emails go out once", async () => {
  for (const access of ["write", "read", "none"]) {
    setEnv(mailEnv());
    stripe.intentAccess = access;
    withContext();
    const session = paid(ONE_WAY);
    await lookup(session);
    assert.deepEqual(await settled(), ["sent"]);
    assert.equal(delivered().length, 2);
    assert.ok(stripe.sessions.get(session.id).metadata.emailed_at, access);
    assert.deepEqual(stripe.intents.get(session.payment_intent).metadata, ONE_WAY.metadata, access);
    assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET /v1/checkout/sessions/${session.id} `, `POST /v1/checkout/sessions/${session.id} nlr-mail-${session.id}-1`, `POST /v1/checkout/sessions/${session.id} nlr-mail-${session.id}-1-done`], access);
    assert.deepEqual(logged, [], access);
    const before = [stripe.calls.length, logged.length];
    await lookup(session);
    assert.deepEqual(await settled(), ["done"]);
    assert.deepEqual(stripe.calls.slice(before[0]).map((c) => `${c.method} ${c.path}`), [`GET /v1/checkout/sessions/${session.id}`], access);
    assert.equal(logged.length, before[1], access);
    assert.equal((await hook(completed(session))).status, 200);
    assert.equal(delivered().length, 2);
  }
});

await test("with no marker Stripe will keep, the confirmation check sends nothing and says so, and only the verified webhook sends, once per event", async () => {
  setEnv(mailEnv());
  stripe.sessionUpdates = "refuse";
  withContext();
  const session = paid(ONE_WAY);
  await lookup(session);
  assert.deepEqual(await settled(), ["unmarked"]);
  assert.equal(delivered().length, 0);
  assert.deepEqual(logged, ["mail-marker 83558982 checkout/sessions 400", "mail-unmarked 83558982"]);
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
});

await test("a refused marker that Stripe keeps under its idempotency key is not mistaken for another trigger's claim: the webhook re-reads twice, finds no claim and sends, instead of answering 503 until the key expires", async () => {
  for (const access of ["write", "read-kept", "none"]) {
    setEnv(mailEnv());
    stripe.intentAccess = access;
    stripe.sessionUpdates = "refuse-kept";
    withContext();
    const session = paid(ONE_WAY);
    await lookup(session);
    assert.deepEqual(await settled(), ["unmarked"]);
    assert.equal(delivered().length, 0);
    stripe.calls.length = 0;
    logged.length = 0;
    const res = await hook(completed(session));
    assert.equal(res.status, 200, access);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    const checkout = `/v1/checkout/sessions/${session.id}`;
    assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET ${checkout} `, `POST ${checkout} nlr-mail-${session.id}-1`, `GET ${checkout} `, `GET ${checkout} `], access);
    assert.deepEqual(logged, ["mail-marker 83558982 checkout/sessions 400"], access);
  }
});

await test("a paid Checkout Session that is not a booking from this site, like a payment link, gets no email and no marker, from the webhook or the confirmation check", async () => {
  setEnv(mailEnv());
  withContext();
  const link = paid(ONE_WAY, { metadata: { ref: "", date: "", time: "" } });
  link.client_reference_id = null;
  stripe.sessions.get(link.id).metadata = {};
  assert.equal((await hook(completed(link))).status, 200);
  await lookup(link);
  assert.deepEqual(await settled(), ["skip"]);
  const undated = paid(ONE_WAY, { metadata: { date: "" } });
  assert.equal((await hook(completed(undated))).status, 200);
  assert.deepEqual([delivered().length, smtp.sessions.length, stripe.calls.filter((c) => c.method === "POST").length], [0, 0, 0]);
  assert.deepEqual([logged, noted], [[], []]);
});

await test("a booking with no valid customer email still sends the owner notice, which says no confirmation went to the customer", async () => {
  setEnv(mailEnv());
  withContext();
  const session = paid(ONE_WAY, { metadata: { email: "not-an-address" }, customer: { email: "" } });
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  const sent = delivered();
  assert.deepEqual(sent.map((m) => m.to), [OWNERS]);
  const owner = sent[0].mail;
  assert.ok(owner.text.startsWith(`Test booking. No real payment was taken.\n\nNew booking 83558982\n\n${MAIL.noCustomer}\n`));
  assert.equal(owner.headers.get("reply-to"), undefined);
  assert.ok(!owner.text.includes(MAIL.ownerNext) && !owner.text.includes("Email:"));
  assert.ok(markersOf(session).metadata.emailed_at);
});

await test("webhook: every request is rejected with 503 while STRIPE_WEBHOOK_SECRET is unset, before Stripe or the mail server is touched", async () => {
  setEnv(mailEnv({ STRIPE_WEBHOOK_SECRET: "" }));
  const session = paid(ONE_WAY);
  const body = JSON.stringify(completed(session));
  for (const res of [await hook(completed(session)), await hook(completed(session), { header: null }), await hook("not json", { header: "t=1,v1=00" }), await hook(body, { header: signature(body, { secret: "" }) })]) {
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { received: false });
  }
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await hook(completed(session))).status, 503);
  process.env.STRIPE_WEBHOOK_SECRET = "   ";
  assert.equal((await hook(completed(session))).status, 503);
  assert.deepEqual([stripe.calls.length, smtp.sessions.length], [0, 0]);
  assert.deepEqual(logged, Array(6).fill("webhook-off"));
});

await test("webhook: a valid signature is accepted, a wrong secret, a changed body, an old or future timestamp, a missing or malformed header are rejected with 400 and nothing else happens", async () => {
  setEnv(mailEnv());
  const session = paid(ONE_WAY);
  const event = completed(session);
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const rejected = [
    { header: signature(body, { secret: ["whsec", "SomeOtherSecret0000"].join("_") }) },
    { header: signature(body.replace("checkout.session.completed", "checkout.session.expired")) },
    { header: signature(body, { at: now - 301 }) },
    { header: signature(body, { at: now + 301 }) },
    { header: null },
    { header: "" },
    { header: `t=${now}` },
    { header: signature(body).replace("v1=", "v0=") },
    { header: signature(body).replace(/v1=.*/, "v1=zz") },
    { header: `v1=${createHmac("sha256", SECRET).update(`${now}.${body}`).digest("hex")}` },
  ];
  for (const options of rejected) {
    const res = await hook(body, options);
    assert.equal(res.status, 400, JSON.stringify(options));
  }
  assert.deepEqual([stripe.calls.length, smtp.sessions.length], [0, 0]);
  assert.deepEqual(logged, Array(rejected.length).fill("webhook-signature"));
  const other = JSON.stringify({ id: "evt_MailTest0002", object: "event", type: "customer.created", data: { object: { id: "cus_123" } } });
  assert.equal((await hook(other, { at: now - 299 })).status, 200);
  const valid = signature(body, { at: now }).split(",")[1];
  assert.equal((await hook(body, { header: `t=${now},v1=${"0".repeat(64)},${valid}` })).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  logged.length = 0;
  const pretty = JSON.stringify({ ...completed(paid(ONE_WAY)), note: "Zoë’s café, 🚗" }, null, 2);
  const spaced = pretty.replace("{\n", "{\n ");
  assert.equal((await hook(spaced, { header: signature(pretty) })).status, 400);
  assert.deepEqual([logged, delivered().length], [["webhook-signature"], 2]);
  assert.equal((await hook(pretty)).status, 200);
  assert.equal((await hook(JSON.stringify({ ...completed(paid(ONE_WAY)), note: "Zoë’s café, 🚗" }))).status, 200);
  assert.equal(delivered().length, 6);
});

await test("webhook: thin events, async payments, other event types, unpaid and unknown sessions, a Stripe failure and an oversized body", async () => {
  setEnv(mailEnv());
  const session = paid(HOURLY);
  assert.equal((await hook(thin(session))).status, 200);
  assert.equal(delivered().length, 2);
  smtp.sessions.length = 0;
  const later = paid(NEW_JERSEY);
  assert.equal((await hook(completed(later, "checkout.session.async_payment_succeeded"))).status, 200);
  assert.equal(delivered().length, 2);
  stripe.calls.length = 0;
  for (const type of ["checkout.session.expired", "payment_intent.succeeded", "charge.refunded"]) assert.equal((await hook(completed(later, type))).status, 200);
  assert.equal((await hook({ type: "checkout.session.completed", data: { object: { id: "cs_test_../../v1/customers" } } })).status, 200);
  assert.equal(stripe.calls.length, 0);
  const open = paid(ONE_WAY);
  stripe.sessions.get(open.id).payment_status = "unpaid";
  assert.equal((await hook(completed(open))).status, 200);
  assert.equal((await hook({ type: "checkout.session.completed", data: { object: { id: "cs_test_MailTestUnknown0000001" } } })).status, 200);
  stripe.fail = (method, path) => method === "GET" && path.startsWith("/v1/checkout/sessions/");
  assert.equal((await hook(completed(paid(ONE_WAY)))).status, 503);
  stripe.fail = null;
  assert.equal(delivered().length, 2);
  const big = JSON.stringify({ ...completed(session), pad: "x".repeat(262144) });
  assert.equal((await hook(big)).status, 413);
  setEnv(mailEnv({ STRIPE_SECRET_KEY: "" }));
  assert.equal((await hook(completed(paid(ONE_WAY)))).status, 503);
  assert.deepEqual(logged, ["key-missing"]);
});

await test("a live session on Production sends from the live key without [TEST], with the live dashboard link", async () => {
  setEnv(mailEnv({ STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "production" }));
  withContext();
  const session = paid(ONE_WAY, { live: true });
  const res = await GET(new Request(`https://www.nycluxride.com/api/book?session_id=${session.id}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await settled(), ["sent"]);
  const [customer, owner] = delivered().map((m) => m.mail);
  assert.equal(customer.headers.get("subject"), "Your NYC LUX RIDE booking 83558982, Sun Nov 8, 10:00 AM");
  assert.ok(owner.text.includes(`Open the payment in Stripe: https://dashboard.stripe.com/payments/${session.payment_intent}`));
  assert.ok(stripe.calls.every((c) => c.auth === `Bearer ${LIVE_KEY}`));
});

await test("texting off: with no Twilio setting, or one missing or malformed, both emails still go out, Twilio is never asked, the claim carries no text marker and one line says why", async () => {
  const cases = [
    [{}, "sms-off 83558982"],
    [{ ...SMS, TWILIO_API_SECRET: "" }, "sms-config 83558982"],
    [{ ...SMS, TWILIO_FROM: undefined }, "sms-config 83558982"],
    [{ ...SMS, TWILIO_ACCOUNT_SID: API_KEY_SID }, "sms-config 83558982"],
    [{ ...SMS, TWILIO_API_KEY: ACCOUNT_SID }, "sms-config 83558982"],
    [{ ...SMS, TWILIO_FROM: "212 555 0199" }, "sms-config 83558982"],
    [{ ...SMS, OWNER_SMS: "646-775-0556" }, "sms-config 83558982"],
  ];
  for (const [env, line] of cases) {
    setEnv(mailEnv(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))));
    const session = paid(ONE_WAY);
    const res = await hook(completed(session));
    assert.deepEqual([res.status, await res.json()], [200, { received: true }], line);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    assert.ok(markersOf(session).metadata.emailed_at);
    assert.equal(twilio.calls.length, 0);
    const claimed = stripe.calls.find((c) => c.idempotency === `nlr-mail-${session.id}-1`);
    assert.equal(JSON.parse(new URLSearchParams(claimed.body).get("metadata[email_attempt]")).texted_at, undefined);
    const [said, quiet] = line.startsWith("sms-off") ? [noted, logged] : [logged, noted];
    assert.deepEqual([said.filter((l) => l.startsWith("sms-")), quiet.filter((l) => l.startsWith("sms-"))], [[line], []], JSON.stringify(env));
  }
});

await test("with Twilio set, the confirmation check texts the owner once as the emails go out, under the same claim and with no extra Stripe call, and later checks and the webhook text nothing more", async () => {
  setEnv(mailEnv(SMS));
  withContext();
  const session = paid(ROUND);
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(twilio.calls.length, 1);
  const [call] = twilio.calls;
  assert.equal(call.url, `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
  assert.equal(call.auth, `Basic ${Buffer.from(`${API_KEY_SID}:${API_SECRET}`).toString("base64")}`);
  assert.deepEqual([...call.form.keys()], ["To", "From", "Body"]);
  assert.deepEqual([call.form.get("To"), call.form.get("From"), call.form.get("Body")], [OWNER_PHONE, SENDER, bookingText(session)]);
  assert.ok(call.form.get("Body").startsWith("[TEST] NYC LUX RIDE booking\nAna Lopez, +1 212 555 0100\nThu Nov 12, 7:30 AM\nJFK to 350 5th Ave, return Sun Nov 15, 6:00 PM\n"));
  assert.equal(call.mails, 0, "the text starts with the emails, not after them");
  const claimed = stripe.calls.find((c) => c.idempotency === `nlr-mail-${session.id}-1`);
  const attempt = JSON.parse(new URLSearchParams(claimed.body).get("metadata[email_attempt]"));
  assert.equal(attempt.texted_at, attempt.at);
  assert.ok(markersOf(session).metadata.emailed_at && !markersOf(session).metadata.email_attempt);
  assert.ok(Object.keys(markersOf(session).metadata).length <= 50);
  assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET /v1/checkout/sessions/${session.id} `, `POST /v1/checkout/sessions/${session.id} nlr-mail-${session.id}-1`, `POST /v1/checkout/sessions/${session.id} nlr-mail-${session.id}-1-done`]);
  assert.deepEqual([noted.filter((l) => l.startsWith("sms-")), logged], [[`sms-sent 83558982 201 ${sid("RQ", "request 1")}`], []]);
  for (let i = 0; i < 3; i++) {
    await lookup(session);
    assert.deepEqual(await settled(), ["done"]);
  }
  assert.equal((await hook(completed(session))).status, 200);
  assert.equal((await hook(thin(session))).status, 200);
  assert.deepEqual([twilio.calls.length, delivered().length], [1, 2]);
});

await test("with Twilio set, a confirmation check and a webhook that arrive together send one text", async () => {
  for (const delay of [0, 40]) {
    setEnv(mailEnv(SMS));
    stripe.delay = delay;
    withContext();
    const session = paid(HOURLY);
    const [page, hooked] = await Promise.all([lookup(session), hook(completed(session))]);
    assert.equal(page.status, 200);
    const results = await settled();
    assert.equal(hooked.status, 200);
    assert.ok(["sent", "busy", "done"].includes(results[0]), results[0]);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    assert.equal(twilio.calls.length, 1, `delay ${delay}`);
    assert.equal(twilio.calls[0].form.get("Body"), bookingText(session));
    assert.ok(markersOf(session).metadata.emailed_at);
  }
  assert.equal(stripe.calls.filter((c) => c.method === "POST" && c.idempotency.endsWith("-1")).length, 2, "both triggers tried the claim");
});

await test("with Twilio set, a webhook retry after the mail server failed sends the emails and no second text, and so does a confirmation check after one email failed", async () => {
  setEnv(mailEnv(SMS));
  smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
  const session = paid(ONE_WAY);
  assert.equal((await hook(completed(session))).status, 503);
  assert.equal(twilio.calls.length, 1);
  const tried = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([tried.failed, tried.sent, tried.texted_at === tried.at], [true, [], true]);
  assert.equal((await hook(completed(session))).status, 503);
  const again = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([again.n, again.failed, again.texted_at], [2, true, tried.texted_at]);
  assert.equal(twilio.calls.length, 1);
  smtp.behavior = {};
  for (let i = 0; i < 2; i++) assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.ok(markersOf(session).metadata.emailed_at);
  assert.equal(twilio.calls.length, 1);
  setEnv(mailEnv(SMS));
  withContext();
  smtp.behavior = { refuse: (mail) => (mail.to.includes("ana.lopez@example.com") ? "554 5.7.0 Message rejected" : "") };
  const other = paid(ROUND);
  await lookup(other);
  assert.deepEqual(await settled(), ["failed"]);
  assert.deepEqual(JSON.parse(markersOf(other).metadata.email_attempt).sent, ["owner"]);
  smtp.behavior = {};
  await lookup(other);
  assert.deepEqual(await settled(), ["sent"]);
  assert.equal((await hook(completed(other))).status, 200);
  assert.deepEqual(delivered().map((m) => m.mail.headers.get("message-id").split(".")[0]), ["<owner", "<customer"]);
  assert.equal(twilio.calls.length, 1);
});

await test("with Twilio set, a text Twilio refused before the emails failed is tried again with the email retry, and a text still on its way when the failure is marked, or one that may have reached Twilio, never is", async () => {
  const runs = [
    [[turnedDown(400, 21211)], undefined, 2],
    [[turnedDown(429, 20429), turnedDown(429, 20429)], "kept", 2],
    [[dropped("ECONNRESET")], "kept", 1],
    [[turnedDown(503, 20503), dropped("ECONNRESET")], "kept", 2],
  ];
  for (const [replies, marker, asked] of runs) {
    setEnv(mailEnv(SMS));
    smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
    twilio.replies = [...replies];
    const session = paid(NEW_JERSEY);
    assert.equal((await hook(completed(session))).status, 503);
    const tried = JSON.parse(markersOf(session).metadata.email_attempt);
    assert.deepEqual([tried.failed, marker ? tried.texted_at === tried.at : tried.texted_at], [true, marker ? true : undefined], JSON.stringify(logged));
    smtp.behavior = {};
    assert.equal((await hook(completed(session))).status, 200);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    assert.equal(twilio.calls.length, asked, JSON.stringify(logged));
    if (!marker) assert.equal(twilio.calls.at(-1).form.get("Body"), bookingText(session));
    assert.equal((await hook(completed(session))).status, 200);
    assert.equal(twilio.calls.length, asked);
  }
});

await test("with Twilio set, a Twilio that fails never holds back the emails or turns the webhook into an error, and is asked at most twice", async () => {
  const cases = [
    [[turnedDown(500, 20500), turnedDown(503, 20503)], 2, "sms-fail 83558982 503 20503"],
    [[dropped("ECONNREFUSED"), dropped("ECONNREFUSED")], 2, "sms-fail 83558982 ECONNREFUSED"],
    [[turnedDown(401, 20003)], 1, "sms-fail 83558982 401 20003"],
    [[dropped("ECONNRESET")], 1, "sms-fail 83558982 ECONNRESET"],
    [[turnedDown(429, 20429), texted], 2, "sms-retry 83558982 429 20429"],
  ];
  for (const [replies, asked, line] of cases) {
    setEnv(mailEnv(SMS));
    twilio.replies = [...replies];
    const session = paid(ONE_WAY);
    const res = await hook(completed(session));
    assert.deepEqual([res.status, await res.json()], [200, { received: true }], line);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    assert.ok(markersOf(session).metadata.emailed_at && !markersOf(session).metadata.email_attempt);
    assert.equal(twilio.calls.length, asked, line);
    assert.ok(logged.some((l) => l.startsWith(line)), `${line} | ${logged.join(" | ")}`);
    assert.equal((await hook(completed(session))).status, 200);
    assert.equal(twilio.calls.length, asked);
  }
});

await test("with Twilio set, a Twilio that never answers holds a webhook only for the 8 second text timeout, never holds back the emails or their marker, and is never asked again", async () => {
  setEnv(mailEnv(SMS));
  smtp.behavior = { reject: ["ben.ortiz@example.com"] };
  twilio.replies = [silent, silent];
  const fine = paid(ONE_WAY);
  const failing = paid(ONE_WAY, { metadata: { email: "ben.ortiz@example.com" }, customer: { email: "ben.ortiz@example.com" } });
  const started = Date.now();
  const answers = Promise.all([hook(completed(fine)), hook(completed(failing))]);
  await until(() => markersOf(fine).metadata.emailed_at && twilio.calls.length === 2);
  assert.ok(twilio.calls.every((c) => !c.signal.aborted), "the emails and their marker never wait for the text");
  assert.deepEqual(delivered().filter((m) => m.to.includes("ana.lopez@example.com")).length, 1);
  const [first, second] = await answers;
  const took = Date.now() - started;
  assert.deepEqual([first.status, second.status], [200, 503]);
  assert.ok(took >= 7900 && took < 9500, `took ${took} ms`);
  assert.ok(twilio.calls.every((c) => c.signal.aborted));
  assert.deepEqual(logged.filter((l) => l.startsWith("sms-")), ["sms-fail 83558982 timeout", "sms-fail 83558982 timeout"]);
  const kept = JSON.parse(markersOf(failing).metadata.email_attempt);
  assert.deepEqual([kept.failed, kept.sent, kept.texted_at === kept.at], [true, ["owner"], true]);
  smtp.behavior = {};
  assert.equal((await hook(completed(failing))).status, 200);
  assert.ok(markersOf(failing).metadata.emailed_at);
  assert.equal(delivered().filter((m) => m.to.includes("ben.ortiz@example.com")).length, 1);
  assert.equal(twilio.calls.length, 2);
});

await test("with Twilio set but no marker Stripe will keep, the confirmation check sends nothing and the webhook sends the emails without a text, since only the claim holder may text", async () => {
  setEnv(mailEnv(SMS));
  stripe.sessionUpdates = "refuse";
  withContext();
  const session = paid(ONE_WAY);
  await lookup(session);
  assert.deepEqual(await settled(), ["unmarked"]);
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(twilio.calls.length, 0);
  assert.deepEqual(logged.filter((l) => l.startsWith("sms-")), ["sms-unmarked 83558982"]);
});

await test("with Twilio set, the claim and its text marker live on the Checkout Session whatever the key may do with the PaymentIntent: one text, and a webhook retry after the mail server failed sends the emails and no second text", async () => {
  for (const access of ["write", "read", "none"]) {
    setEnv(mailEnv(SMS));
    stripe.intentAccess = access;
    smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
    const session = paid(ONE_WAY);
    assert.equal((await hook(completed(session))).status, 503, access);
    assert.equal(twilio.calls.length, 1, access);
    const tried = JSON.parse(stripe.sessions.get(session.id).metadata.email_attempt);
    assert.deepEqual([tried.failed, tried.texted_at === tried.at, stripe.intents.get(session.payment_intent).metadata.email_attempt], [true, true, undefined], access);
    smtp.behavior = {};
    for (let i = 0; i < 2; i++) assert.equal((await hook(completed(session))).status, 200, access);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS], access);
    assert.ok(stripe.sessions.get(session.id).metadata.emailed_at, access);
    assert.equal(twilio.calls.length, 1, access);
    assert.deepEqual(stripe.intents.get(session.payment_intent).metadata, ONE_WAY.metadata, access);
  }
});

await test("with Twilio set, a claim left by a run that died is taken over after two minutes with its text marker: the emails go out, no second text, and one line says the text may be lost, which a failed try never needs", async () => {
  setEnv(mailEnv(SMS));
  const at = new Date(Date.now() - 130000).toISOString();
  const session = paid(ONE_WAY);
  markersOf(session).metadata.email_attempt = JSON.stringify({ n: 1, at, id: "abc123", sent: [], tries: 0, texted_at: at });
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(twilio.calls.length, 0);
  const claimed = stripe.calls.find((c) => c.idempotency === `nlr-mail-${session.id}-2`);
  assert.equal(JSON.parse(new URLSearchParams(claimed.body).get("metadata[email_attempt]")).texted_at, at);
  assert.deepEqual(logged, ["sms-inherited 83558982"]);
  setEnv(mailEnv(SMS));
  const failed = paid(ONE_WAY);
  markersOf(failed).metadata.email_attempt = JSON.stringify({ n: 1, at, id: "abc123", sent: ["owner"], tries: 1, failed: true, texted_at: at });
  assert.equal((await hook(completed(failed))).status, 200);
  assert.deepEqual([delivered().map((m) => m.to), twilio.calls.length, logged], [[["ana.lopez@example.com"]], 0, []]);
});

await test("with Twilio set, a claim whose answer never comes back is read back once, and when Stripe holds the run's own claim the run texts and sends the emails at once", async () => {
  for (const [delay, lost] of [[0, 2], [1000, 1]]) {
    setEnv(mailEnv(SMS));
    const session = paid(ONE_WAY);
    const claimKey = `nlr-mail-${session.id}-1`;
    let left = lost;
    stripe.delay = (key) => (key === claimKey ? delay : 0);
    stripe.lose = (key) => key === claimKey && left-- > 0;
    assert.equal((await hook(completed(session))).status, 200, `delay ${delay}`);
    assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
    assert.ok(markersOf(session).metadata.emailed_at);
    assert.equal(twilio.calls.length, 1);
    const checkout = `/v1/checkout/sessions/${session.id}`;
    assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET ${checkout} `, `POST ${checkout} ${claimKey}`, `POST ${checkout} ${claimKey}`, `GET ${checkout} `, `POST ${checkout} ${claimKey}-done`]);
    assert.deepEqual(logged, []);
  }
});

await test("with Twilio set, a claim read back after lost answers counts only when Stripe holds the run's own claim, so a webhook that lost its answers while the confirmation check claimed sends nothing", async () => {
  setEnv(mailEnv(SMS));
  withContext();
  const session = paid(ONE_WAY);
  const claimKey = `nlr-mail-${session.id}-1`;
  stripe.delay = (key) => (key === claimKey ? 1000 : key === `${claimKey}-done` ? 3000 : 0);
  const page = lookup(session);
  await until(() => stripe.calls.some((c) => c.idempotency === claimKey));
  stripe.lose = (key) => key === claimKey;
  assert.equal((await hook(completed(session))).status, 503);
  assert.deepEqual(logged, ["mail-stripe 83558982 0"]);
  assert.equal((await page).status, 200);
  assert.deepEqual(await settled(), ["sent"]);
  assert.equal(twilio.calls.length, 1);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(stripe.calls.filter((c) => c.idempotency === claimKey).length, 3);
});

await test("with Twilio set, a slow text never holds back the mark of a failed email, so a webhook that arrives meanwhile sends that email at once and no second text", async () => {
  setEnv(mailEnv(SMS));
  withContext();
  let refusals = 1;
  smtp.behavior = { refuse: (mail) => (mail.to.includes("ana.lopez@example.com") && refusals-- > 0 ? "451 4.3.0 Try again later" : "") };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  twilio.replies = [(call) => Promise.race([gate.then(() => texted(call)), silent(call)])];
  const session = paid(ONE_WAY);
  const page = lookup(session);
  await until(() => /"failed":true/.test(markersOf(session).metadata.email_attempt || ""), 3000);
  const tried = JSON.parse(markersOf(session).metadata.email_attempt);
  assert.deepEqual([tried.sent, tried.texted_at === tried.at], [["owner"], true]);
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [OWNERS, ["ana.lopez@example.com"]]);
  assert.ok(markersOf(session).metadata.emailed_at);
  assert.ok(twilio.calls.length === 1 && !twilio.calls[0].signal.aborted, "the text is still on its way");
  release();
  assert.equal((await page).status, 200);
  assert.deepEqual(await settled(), ["failed"]);
  assert.equal(twilio.calls.length, 1);
  assert.deepEqual(noted.filter((l) => l.startsWith("sms-")), [`sms-sent 83558982 201 ${sid("RQ", "request 1")}`]);
});

await test("with Twilio set, a trigger that cannot see the other trigger's slow claim on the Checkout Session sends the emails but never a second text", async () => {
  setEnv(mailEnv(SMS));
  withContext();
  const session = paid(HOURLY);
  const claimKey = `nlr-mail-${session.id}-1`;
  stripe.delay = (key) => (key === claimKey ? 3000 : 0);
  const [page, hooked] = await Promise.all([lookup(session), hook(completed(session))]);
  assert.deepEqual([page.status, hooked.status], [200, 200]);
  assert.deepEqual(await settled(), ["sent"]);
  assert.equal(twilio.calls.length, 1);
  assert.equal(twilio.calls[0].form.get("Body"), bookingText(session));
  assert.ok(markersOf(session).metadata.emailed_at);
  assert.deepEqual(logged, ["mail-marker 83558982 checkout/sessions 400", "sms-unmarked 83558982"]);
  const claims = stripe.calls.filter((c) => c.method === "POST" && c.idempotency === claimKey).map((c) => JSON.parse(new URLSearchParams(c.body).get("metadata[email_attempt]")));
  assert.equal(claims.length, 2, "both triggers tried the one claim on the Checkout Session");
  assert.equal(claims[0].texted_at, claims[0].at, "the text goes with the claim Stripe kept");
  assert.ok(["customer", "owner"].every((kind) => byKind(delivered(), kind).length), "both emails went out");
  assert.deepEqual(stripe.intents.get(session.payment_intent).metadata, HOURLY.metadata);
});

await test("no request ever goes to /v1/payment_intents, so a restricted key that can only read PaymentIntents leaves no 403 in the Stripe logs: a confirmation check, a webhook, a failed email retried by the webhook, a claim taken over after two minutes and a text all mark only the Checkout Session, even with a key that could write the PaymentIntent", async () => {
  setEnv(mailEnv(SMS));
  withContext();
  const session = paid(ROUND);
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.equal((await hook(completed(session))).status, 200);
  smtp.behavior = { reject: OWNERS };
  const failing = paid(ONE_WAY);
  assert.equal((await hook(completed(failing))).status, 503);
  smtp.behavior = {};
  assert.equal((await hook(completed(failing))).status, 200);
  const stale = paid(HOURLY);
  markersOf(stale).metadata.email_attempt = JSON.stringify({ n: 1, at: new Date(Date.now() - 130000).toISOString(), id: "abc123", sent: [], tries: 0 });
  assert.equal((await hook(completed(stale))).status, 200);
  assert.equal(twilio.calls.length, 3);
  for (const booking of [session, failing, stale]) {
    assert.ok(markersOf(booking).metadata.emailed_at && !markersOf(booking).metadata.email_attempt);
    const pi = stripe.intents.get(booking.payment_intent).metadata;
    assert.deepEqual(["email_attempt", "emailed_at"].map((name) => pi[name]), [undefined, undefined]);
  }
  assert.equal(stripe.intentAccess, "write");
  assert.deepEqual(stripe.calls.filter((c) => c.path.startsWith("/v1/payment_intents")), []);
  assert.deepEqual([...new Set(stripe.calls.map((c) => `${c.method} ${c.path.replace(/cs_test_\w+/, "{id}")}`))], ["GET /v1/checkout/sessions/{id}", "POST /v1/checkout/sessions/{id}"]);
  assert.ok(!history.some((line) => line.includes("payment_intents")), "no marker line names the PaymentIntent");
});

await test("across every test above, webhook retries, confirmation checks, failed emails retried alone, texts and claims taken over, no request went to /v1/payment_intents, neither a POST nor a GET", () => {
  assert.ok(stripe.intents.size > 30, `${stripe.intents.size} bookings with a PaymentIntent`);
  assert.deepEqual(stripe.intentCalls, []);
});

await test("no log line holds the SMTP password, the AUTH string, an address, a name, a phone number or any part of an email", () => {
  assert.ok(history.length > 40, `${history.length} log lines`);
  const all = history.join("\n");
  const secrets = [PASS, Buffer.from(`\u0000${USER}\u0000${PASS}`).toString("base64"), "ana.lopez@example.com", "Ana Lopez", "Ben Ortiz", "Zo\u00eb", "212 555", "2125550100", "917 555", "7946", "Main Street", "72nd", "Secaucus", "Infant", "toddler", "Subject", "Payment received", "@"];
  for (const secret of secrets) assert.ok(!all.includes(secret), secret);
});

await test("no log line holds the Twilio secret, the Basic auth string, a Twilio SID, the owner or sender number, Twilio's error text or any line of a text", () => {
  const all = history.join("\n");
  assert.ok(["sms-off ", "sms-config ", "sms-sent ", "sms-retry ", "sms-fail ", "sms-unmarked ", "sms-inherited "].every((start) => history.some((line) => line.startsWith(start))));
  const secrets = [API_SECRET, Buffer.from(`${API_KEY_SID}:${API_SECRET}`).toString("base64"), API_KEY_SID, ACCOUNT_SID, "6467750556", "2125550199", "NYC LUX RIDE", "Reference 83558982", "Paid $", "could not send", "203.0.113.9", "twilio.com"];
  for (const secret of secrets) assert.ok(!all.includes(secret), secret);
  for (const line of history.filter((l) => l.startsWith("sms-"))) assert.match(line, /^sms-(off|config|sent|retry|fail|unmarked|inherited) 83558982( [A-Za-z0-9_]+){0,3}$/);
});

smtp.server.close();
withoutContext();
if (failures) {
  console.error(`\n${failures} mail test(s) failed`);
  process.stderr.write(`\n${failures} mail test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll mail tests passed\n");
process.exit(0);
