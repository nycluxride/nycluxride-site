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
import { readInput, resolveTrip, priceTrip, readSettings, receipt, money, fill } from "../api/_trip.mjs";
import { metadataFor } from "../api/_stripe.mjs";
import { MAIL, CHECKOUT, NOTES, POLICY } from "../api/_copy.mjs";
import { smtpSend, buildMessage, header, mailbox } from "../api/_smtp.mjs";
import { bookingLetters as lettersAt, mailSettings } from "../api/_mail.mjs";
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
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "VERCEL_ENV", "BOOK_MOCK", "PAYMENTS_ENABLED", "GOOGLE_MOCK", "BOOKING_REF_SECRET", "PAY_BLACKOUT_DATES", "FLIGHT_MOCK"];
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

const stripe = { sessions: new Map(), intents: new Map(), keys: new Map(), calls: [], intentAccess: "write", sessionUpdates: "allow", delay: 0, fail: null };
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

async function idempotent(key, body, run) {
  const saved = key ? stripe.keys.get(key) : null;
  if (saved && saved.body !== body) return answer(400, { error: { type: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters they were first used with." } });
  if (saved && saved.pending) return answer(409, { error: { type: "idempotency_error", message: "There is currently another in-progress request using this Idempotent Key." } });
  if (saved) return answer(saved.status, saved.result, { "idempotent-replayed": "true" });
  const entry = { body, pending: true };
  if (key) stripe.keys.set(key, entry);
  if (stripe.delay) await new Promise((resolve) => setTimeout(resolve, stripe.delay));
  const [status, result] = run();
  Object.assign(entry, { pending: false, status, result });
  return answer(status, result);
}

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  const method = init.method || "GET";
  const headers = new Headers(init.headers);
  const body = String(init.body || "");
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
  stripe.fail = null;
  smtp.sessions.length = 0;
  smtp.behavior = {};
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
const TERMINAL = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", return_flight: "B6 1234", passengers: "2", class: "suv", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const NO_FLIGHT = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const NO_RETURN_FLIGHT = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4", date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const FOR_OTHER = await booked({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", flight: "UA 523", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const TO_T5 = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 5", to_id: "jfk-t5", date: "2026-11-12", time: "07:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const SEATS = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "3", class: "suv", meet: "1", sign: "Lopez Family", tip: "15", infant_seats: "1", booster_seats: "2", rider: "me", ...ME, reach: "phone" });
const HOURLY_JFK = await booked({ trip_type: "hour", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", flight: "BA 117", meet: "1", tip: "0", rider: "me", ...ME, reach: "phone" });
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
const intentOf = (session) => stripe.intents.get(session.payment_intent);
const lookup = (session) => GET(new Request(`http://127.0.0.1:4173/api/book?session_id=${encodeURIComponent(session.id)}`));
const sessionBodyOf = (session) => {
  const r = receipt(session.metadata, readSettings({}), undefined);
  return { kind: "session", status: "complete", payment_status: "paid", ref: session.metadata.ref, summary: r.summary, lines: r.lines, total_cents: session.amount_total, value_cents: r.value, currency: "usd", notes: r.notes };
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
  const steps = ["What happens next", "Paid: Stripe emails your receipt with your reference.", "Confirmed in writing: We confirm your car and chauffeur in writing before your ride.", "On the day: Your chauffeur comes to the pickup address. You get 15 minutes of free waiting from the pickup time.", ""];
  const trip = ["Reference: 83558982", "Trip: One way", "Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Date: Sun, Nov 8, 2026", "Time: 10:00 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", ""];
  const pay = ["Fare: $155.00", "NYC sales tax (8.875%): $13.76", "Black Car Fund (2.25%): $3.49", "Tolls and airport fees: $12.75", "Paid: $185.00", "", NOTES.included, "", POLICY.later.airport, "", "Sun, Nov 8, 2026, 10:00 AM. To Newark Liberty (EWR), Business SUV.", ""];
  const change = ["To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference 83558982.", "WhatsApp: https://wa.me/16467750556", "Terms of service: https://www.nycluxride.com/terms-of-service", "Rates and cancellation terms: https://www.nycluxride.com/rates#cancellation"];
  assert.equal(customer.text, [`Payment received`, "", "Your trip", ...trip, "Your payment", ...pay, ...steps.slice(0, 1), ...steps.slice(1), ...change, "", "NYC LUX RIDE", "+1 (646) 775-0556", "https://www.nycluxride.com", ""].join("\n"));
  assert.equal(owner.text, ["New booking 83558982", "", "Customer", "Name: Ana Lopez", "Email: ana.lopez@example.com", "Phone: +1 212 555 0100", "Preferred contact: WhatsApp", "", "Trip", ...trip, "Payment", ...pay, `Open the payment in Stripe: https://dashboard.stripe.com/payments/${session.payment_intent}`, "", "What the customer email says", ...steps.slice(1), ...change, ""].join("\n"));
  const doc = checkHtml(customer);
  assert.deepEqual([...doc.querySelectorAll("h2")].map((h) => h.textContent), ["Your trip", "Your payment", "What happens next"]);
  assert.equal(doc.querySelector("h1").textContent, "Payment received");
  assert.deepEqual(tripTable(doc)[0][1], trip.slice(0, -1).map((line) => line.split(": ")));
  assert.deepEqual(tripTable(doc)[1][1], [["Fare", "$155.00"], ["NYC sales tax (8.875%)", "$13.76"], ["Black Car Fund (2.25%)", "$3.49"], ["Tolls and airport fees", "$12.75"], ["Paid", "$185.00"]]);
  assert.deepEqual([...doc.querySelectorAll("ol li")].map((li) => [li.querySelector("strong").textContent, li.textContent.slice(li.querySelector("strong").textContent.length)]), [["Paid", "Stripe emails your receipt with your reference."], ["Confirmed in writing", "We confirm your car and chauffeur in writing before your ride."], ["On the day", "Your chauffeur comes to the pickup address. You get 15 minutes of free waiting from the pickup time."]]);
  const odoc = checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/payments/${session.payment_intent}` });
  assert.deepEqual([...odoc.querySelectorAll("h2")].map((h) => h.textContent), ["Customer", "Trip", "Payment", "What the customer email says"]);
  assert.deepEqual(tripTable(odoc)[0][1], [["Name", "Ana Lopez"], ["Email", "ana.lopez@example.com"], ["Phone", "+1 212 555 0100"], ["Preferred contact", "WhatsApp"]]);
  assert.equal(odoc.querySelector(`a[href="https://dashboard.stripe.com/payments/${session.payment_intent}"]`).textContent, "Open the payment in Stripe");
  const total = receipt(session.metadata, readSettings({}), undefined).lines.reduce((sum, line) => sum + line.cents, 0);
  assert.equal(total, session.amount_total);
});

await test("round trip with meet and greet, the sign name, notes and someone else riding: the return, the flight, the passenger and the On the day wording", async () => {
  setEnv();
  const session = paid(ROUND);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(customer.subject, "[TEST] Your NYC LUX RIDE booking 83558982, Thu Nov 12, 7:30 AM");
  assert.equal(owner.subject, "[TEST] New booking 83558982: Thu Nov 12, 7:30 AM, Business Premium SUV, JFK to 350 5th Ave, return Sun Nov 15, 6:00 PM");
  assert.deepEqual(sectionOf(customer.text, "Your trip"), ["Reference: 83558982", "Trip: Round trip", "Pickup: John F. Kennedy (JFK), Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", "Date: Thu, Nov 12, 2026", "Time: 7:30 AM, New York time", "Return: Sun, Nov 15, 2026, 6:00 PM, New York time", "Passengers: 3", "Vehicle: Business Premium SUV", "Flight: DL 401", "Meet and greet: Yes", "Name for the sign: Ortiz Party", "Notes for the chauffeur: Infant seat, please", "  Two large cases"]);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $373.00", "NYC sales tax (8.875%): $33.10", "Black Car Fund (2.25%): $8.40", "Tolls and airport fees: $25.50", "Meet and greet: $25.00", "Gratuity for your chauffeur (15%): $55.95", "Paid: $520.95"]);
  assert.ok(customer.text.includes("\nOn the day: Your chauffeur waits inside the terminal with a name sign.\n"));
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
  assert.deepEqual([...odoc.querySelectorAll("h2")].map((h) => h.textContent), ["Customer", "Passenger", "Trip", "Payment", "What the customer email says"]);
  assert.deepEqual(tripTable(odoc).find(([heading]) => heading === MAIL.ownerTrip)[1][1], ["Trip", "Round trip"]);
});

await test("hourly booking: the hours, the vehicle model, the typed gratuity, the hourly note and the hourly On the day wording, for the rider and for someone else", async () => {
  setEnv();
  const session = paid(HOURLY, { live: true });
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(customer.subject, "Your NYC LUX RIDE booking 83558982, Tue Dec 1, 2:00 PM");
  assert.equal(owner.subject, "New booking 83558982: Tue Dec 1, 2:00 PM, Business Premium SUV, 4 hours from 1 Main Street");
  assert.deepEqual(sectionOf(customer.text, "Your trip"), ["Reference: 83558982", "Trip: By the hour, 4 hours", "Pickup: 1 Main Street, Brooklyn, NY 11201", "Date: Tue, Dec 1, 2026", "Time: 2:00 PM, New York time", "Passengers: 1", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Notes for the chauffeur: A toddler seat, please"]);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare, 4 hours: $420.00", "NYC sales tax (8.875%): $37.28", "Black Car Fund (2.25%): $9.45", "Gratuity for your chauffeur: $40.00", "Paid: $506.73"]);
  assert.ok(customer.text.includes(`\n${NOTES.hourly}\n`));
  assert.ok(customer.text.includes("\nOn the day: The same car and chauffeur stay with you for the hours you booked. If your day might run long, tell us early. A message an hour ahead gives us time to keep the car for you.\n"));
  assert.doesNotMatch(customer.text, /Drop-off|Stop 1|Tolls and airport fees:/);
  checkHtml(customer);
  checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/payments/${session.payment_intent}` });
  const other = paid(HOURLY, { metadata: { rider: "other", passenger_name: "Ben Ortiz", passenger_phone: "+1 917 555 0199" } });
  const [forOther] = bookingLetters(other, SETTINGS);
  assert.ok(forOther.text.includes("\nOn the day: The same car and chauffeur stay with them for the hours you booked. If your day might run long"));
});

await test("airport trip from New Jersey: priced by distance and time, no tolls line, the outside note, the miles and minutes, and an escaped class name", async () => {
  setEnv();
  const session = paid(NEW_JERSEY);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(customer.subject, "[TEST] Your NYC LUX RIDE booking 83558982, Fri Nov 20, 5:15 AM");
  assert.equal(owner.subject, "[TEST] New booking 83558982: Fri Nov 20, 5:15 AM, Sedan & Electric, Secaucus to Newark Liberty (EWR)");
  assert.deepEqual(sectionOf(customer.text, "Your trip"), ["Reference: 83558982", "Trip: One way", "Pickup: Secaucus, NJ 07094", "Drop-off: Newark Liberty (EWR)", "Date: Fri, Nov 20, 2026", "Time: 5:15 AM, New York time", "Passengers: 2", "Vehicle: Sedan & Electric"]);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $141.51", "NYC sales tax (8.875%): $12.56", "Black Car Fund (2.25%): $3.18", "Gratuity for your chauffeur (20%): $28.30", "Paid: $185.55"]);
  assert.ok(customer.text.includes(`\n${POLICY.later.outside}\n`));
  assert.ok(customer.text.includes("\nFri, Nov 20, 2026, 5:15 AM. Sedan & Electric, 9.0 miles and 18 min.\n"));
  assert.ok(customer.text.includes("\nOn the day: Your chauffeur comes to the pickup address. You get 15 minutes of free waiting from the pickup time.\n"));
  const doc = checkHtml(customer);
  assert.ok(customer.html.includes("Sedan &#38; Electric") && !customer.html.includes("Sedan & Electric"));
  assert.equal(tripTable(doc)[0][1].find(([label]) => label === "Vehicle")[1], "Sedan &amp; Electric");
  checkHtml(owner, { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` });
});

await test("a trip to JFK Terminal 5 with a return pickup there: the pickup wording, the return bags wording for someone else and the Terminals 5 and 7 note", async () => {
  setEnv();
  const [customer] = bookingLetters(paid(TERMINAL), SETTINGS);
  assert.ok(customer.text.includes("\nTrip: Round trip\n"));
  assert.ok(customer.text.includes("\nReturn flight: B6 1234\n"));
  assert.ok(customer.text.includes(`\nOn the day: ${MAIL.day.pickup} ${MAIL.day.backOther} ${MAIL.day.terminals}\n`));
  const [mine] = bookingLetters(paid(TERMINAL, { metadata: { rider: "me", passenger_name: "", passenger_phone: "" } }), SETTINGS);
  assert.ok(mine.text.includes(`\nOn the day: ${MAIL.day.pickup} ${MAIL.day.back} ${MAIL.day.terminals}\n`));
  const [pickup] = bookingLetters(paid(ROUND, { metadata: { meet: "0", meet_cents: "0", sign_name: "", rider: "me", from_place: "jfk-t5", from_text: "John F. Kennedy (JFK), Terminal 5" } }), SETTINGS);
  assert.ok(pickup.text.includes(`\nOn the day: ${MAIL.day.tracked} ${MAIL.day.bags} ${MAIL.day.terminals}\n`));
});

await test("a trip with two stops: Stop 1 and Stop 2 in order between the pickup and the drop-off, in the text and the HTML of both emails, with every price line and the airport pickup wording", async () => {
  setEnv();
  const session = paid(STOPS);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  assert.equal(owner.subject, "[TEST] New booking 83558982: Sat Nov 21, 9:00 AM, Business SUV, LaGuardia (LGA) to 350 5th Ave");
  const route = ["Pickup: LaGuardia (LGA)", "Stop 1: 277 Bedford Ave, Brooklyn, NY 11211", "Stop 2: John F. Kennedy (JFK)", "Drop-off: 350 5th Ave, New York, NY 10118"];
  assert.deepEqual(sectionOf(customer.text, "Your trip").slice(2, 6), route);
  assert.deepEqual(sectionOf(owner.text, "Trip").slice(2, 6), route);
  assert.deepEqual(sectionOf(customer.text, "Your payment"), ["Fare: $447.01", "NYC sales tax (8.875%): $39.68", "Black Car Fund (2.25%): $10.06", "Tolls and airport fees: $38.25", "Paid: $535.00"]);
  assert.ok(customer.text.includes("\nSat, Nov 21, 2026, 9:00 AM. Business SUV, 3 airport transfers.\n"));
  assert.ok(customer.text.includes(`\nOn the day: ${MAIL.day.tracked} ${MAIL.day.bags}\n`));
  for (const letter of [customer, owner]) {
    const doc = checkHtml(letter, letter.kind === "owner" ? { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` } : {});
    const [, rows] = tripTable(doc).find(([heading]) => heading === (letter.kind === "owner" ? MAIL.ownerTrip : MAIL.trip));
    assert.deepEqual(rows.slice(2, 6), route.map((line) => line.split(": ")));
  }
});

await test("an airport pickup, or a return pickup at an airport, with no flight number asks for it in both emails, on WhatsApp with the reference, where the confirmation page shows its flight number link", async () => {
  setEnv();
  const ask = "Send us your flight number on WhatsApp with your reference 83558982.";
  const linked = `<a href="https://wa.me/16467750556" style="color:#0b4fa8;text-decoration:underline">WhatsApp</a>`;
  for (const [fix, day] of [[NO_FLIGHT, [MAIL.day.bags, ask]], [NO_RETURN_FLIGHT, [MAIL.day.pickup, MAIL.day.back, ask]]]) {
    const session = paid(fix);
    const [customer, owner] = bookingLetters(session, SETTINGS);
    const steps = [`Paid: ${MAIL.steps[0][1]}`, `Confirmed in writing: ${MAIL.steps[1][1]}`, `On the day: ${day.join(" ")}`];
    assert.deepEqual(sectionOf(customer.text, "What happens next"), steps);
    assert.deepEqual(sectionOf(owner.text, "What the customer email says"), steps);
    assert.ok(!customer.text.includes(MAIL.day.tracked));
    for (const letter of [customer, owner]) {
      const doc = checkHtml(letter, letter.kind === "owner" ? { stripeLink: `https://dashboard.stripe.com/test/payments/${session.payment_intent}` } : {});
      assert.equal([...doc.querySelectorAll("ol li")].at(-1).innerHTML, `<strong>On the day</strong><br>${day.join(" ").replace("WhatsApp", linked)}`);
    }
  }
});

await test("an airport pickup for someone else, a one way drop-off at JFK Terminal 5 and an hourly booking from JFK with meet and greet: the bags wording for them, no Terminals 5 and 7 note on a drop-off, the flight row by the hour and the meet and greet sentence before the hourly ones", async () => {
  setEnv();
  const day = (letter) => sectionOf(letter.text, "What happens next").at(-1);
  const [other] = bookingLetters(paid(FOR_OTHER), SETTINGS);
  assert.deepEqual(sectionOf(other.text, "Your trip"), ["Reference: 83558982", "Trip: One way", "Pickup: LaGuardia (LGA)", "Drop-off: 350 5th Ave, New York, NY 10118", "Date: Thu, Nov 12, 2026", "Time: 7:30 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", "Flight: UA 523"]);
  assert.equal(day(other), `On the day: ${MAIL.day.tracked} ${MAIL.day.bagsOther}`);
  assert.ok(other.text.includes("\nYour chauffeur contacts Ben Ortiz on the day of the ride. Your confirmation, receipt and any changes go to your email.\n"));
  const [drop] = bookingLetters(paid(TO_T5), SETTINGS);
  assert.deepEqual(sectionOf(drop.text, "Your trip").slice(1, 4), ["Trip: One way", "Pickup: 350 5th Ave, New York, NY 10118", "Drop-off: John F. Kennedy (JFK), Terminal 5"]);
  assert.equal(day(drop), `On the day: ${MAIL.day.pickup}`);
  assert.ok(!drop.text.includes("Terminals 5 and 7") && !drop.html.includes("Terminals 5 and 7"));
  const session = paid(HOURLY_JFK);
  const [hourly, owner] = bookingLetters(session, SETTINGS);
  const rows = ["Reference: 83558982", "Trip: By the hour, 4 hours", "Pickup: John F. Kennedy (JFK), Terminal 4", "Date: Tue, Dec 1, 2026", "Time: 2:00 PM, New York time", "Passengers: 1", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Flight: BA 117", "Meet and greet: Yes", "Name for the sign: Ana Lopez"];
  assert.deepEqual(sectionOf(hourly.text, "Your trip"), rows);
  assert.deepEqual(sectionOf(owner.text, "Trip"), rows);
  assert.equal(day(hourly), `On the day: ${MAIL.day.meet} ${fill(MAIL.day.hourly, { who: MAIL.day.you })} ${MAIL.day.long}`);
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
  assert.equal(customer.text, ["Payment received", "", "Your trip", "Reference: 83558982", "Trip: One way", "Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Date: Sun, Nov 8, 2026", "Time: 10:00 AM, New York time", "Passengers: 2", "Vehicle: Business SUV", "", "Your payment", "Fare: $155.00", "NYC sales tax (8.875%): $13.76", "Black Car Fund (2.25%): $3.49", "Tolls and airport fees: $12.75", "Paid: $185.00", "", NOTES.included, "", POLICY.later.airport, "", "Sun, Nov 8, 2026, 10:00 AM. To Newark Liberty (EWR), Business SUV.", "", "NYC LUX RIDE", "+1 (646) 775-0556", "https://www.nycluxride.com", ""].join("\n"));
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
  assert.ok(ahead[0].text.includes("\nWhat happens next\n") && !back.text.includes("What happens next") && !back.text.includes(MAIL.day.meet) && !back.text.includes("contacts Ben Ortiz"));
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
  assert.deepEqual([SEATS.metadata.seats_cents, SEATS.metadata.child_seats, SEATS.metadata.infant_seats, SEATS.metadata.booster_seats, "toddler_seats" in SEATS.metadata, SEATS.total], ["4500", "3", "1", "2", false, 27825]);
  const session = paid(SEATS);
  const [customer, owner] = bookingLetters(session, SETTINGS);
  const pay = ["Fare: $155.00", "NYC sales tax (8.875%): $13.76", "Black Car Fund (2.25%): $3.49", "Tolls and airport fees: $12.75", "Meet and greet: $25.00", "Child seats (3 x $15.00): $45.00", "Gratuity for your chauffeur (15%): $23.25", "Paid: $278.25"];
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
    assert.deepEqual(intentOf(session).metadata, session.metadata);
  }
});

await test("the confirmation check sends both emails once a session is paid, sets emailed_at on the PaymentIntent, and later checks and the webhook send nothing more", async () => {
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
  const marker = intentOf(session).metadata;
  assert.match(marker.emailed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(marker.email_attempt, undefined);
  assert.ok(Object.keys(marker).length <= 50);
  assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET /v1/checkout/sessions/${session.id} `, `GET /v1/payment_intents/${session.payment_intent} `, `POST /v1/payment_intents/${session.payment_intent} nlr-mail-${session.payment_intent}-1`, `POST /v1/payment_intents/${session.payment_intent} nlr-mail-${session.payment_intent}-1-done`]);
  assert.ok(stripe.calls.every((c) => c.auth === `Bearer ${KEY}`));
  assert.deepEqual(noted, ["mail-sent 83558982 customer owner"]);
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
  assert.ok(intentOf(session).metadata.emailed_at);
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
  const claims = stripe.calls.filter((c) => c.method === "POST" && c.idempotency === `nlr-mail-${session.payment_intent}-1`);
  assert.equal(claims.length, 2);
  assert.ok(intentOf(session).metadata.emailed_at);
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
  const tried = JSON.parse(intentOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.failed, tried.sent, intentOf(session).metadata.emailed_at], [1, true, [], undefined]);
  smtp.behavior = {};
  logged.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.equal(delivered().length, 2);
  assert.ok(intentOf(session).metadata.emailed_at && !intentOf(session).metadata.email_attempt);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.payment_intent}-2`));
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
  await until(() => intentOf(session).metadata.email_attempt && JSON.parse(intentOf(session).metadata.email_attempt).failed);
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
    await until(() => delivered().length === 2 && intentOf(session).metadata.emailed_at);
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
  assert.deepEqual(JSON.parse(intentOf(session).metadata.email_attempt).sent, ["customer"]);
  assert.deepEqual(logged, ["mail-fail 83558982 owner rcpt 550"]);
  smtp.behavior = {};
  smtp.sessions.length = 0;
  const hooked = await hook(completed(session));
  assert.equal(hooked.status, 200);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[OWNERS, "<owner"]]);
  assert.ok(intentOf(session).metadata.emailed_at);
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
  assert.deepEqual([logged, noted], [["mail-fail 83558982 customer message 554"], ["mail-sent 83558982 owner"]]);
  const tried = JSON.parse(intentOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.failed, tried.sent, intentOf(session).metadata.emailed_at], [1, true, ["owner"], undefined]);
  smtp.behavior = {};
  smtp.sessions.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[["ana.lopez@example.com"], "<customer"]]);
  assert.ok(intentOf(session).metadata.emailed_at && !intentOf(session).metadata.email_attempt);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.payment_intent}-2`));
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
  const tried = JSON.parse(intentOf(session).metadata.email_attempt);
  assert.deepEqual([tried.n, tried.failed, tried.sent, delivered().length], [5, true, [], 0]);
  assert.deepEqual(logged, Array(5).fill(["mail-fail 83558982 customer auth 535", "mail-fail 83558982 owner auth 535"]).flat());
  smtp.behavior = {};
  logged.length = 0;
  await lookup(session);
  assert.deepEqual(await settled(), ["sent"]);
  assert.deepEqual(delivered().map((m) => [m.to, m.mail.headers.get("message-id").split(".")[0]]), [[["ana.lopez@example.com"], "<customer"], [OWNERS, "<owner"]]);
  assert.ok(intentOf(session).metadata.emailed_at && !intentOf(session).metadata.email_attempt);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.payment_intent}-6`));
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
  const tried = JSON.parse(intentOf(session).metadata.email_attempt);
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
    intentOf(booking).metadata.email_attempt = JSON.stringify({ n: 7, at: new Date(Date.now() - 130000).toISOString(), id: "abc123", sent: [], tries });
    return booking;
  };
  const spent = unfinished(4);
  await lookup(spent);
  assert.deepEqual(await settled(), ["gave-up"]);
  const left = unfinished(3);
  await lookup(left);
  assert.deepEqual(await settled(), ["sent"]);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${left.payment_intent}-8`));
  assert.deepEqual(delivered().slice(1).map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
  assert.equal(tried.tries, 5);
});

await test("a webhook that finds the work already claimed waits for it, and answers 503 so Stripe retries when the claim is still open", async () => {
  setEnv(mailEnv());
  const session = paid(ONE_WAY);
  intentOf(session).metadata.email_attempt = JSON.stringify({ n: 1, at: new Date().toISOString(), id: "abc123", sent: [] });
  const started = Date.now();
  const res = await hook(completed(session));
  assert.equal(res.status, 503);
  assert.ok(Date.now() - started >= 3900, "it waits twice before it gives up");
  assert.equal(stripe.calls.filter((c) => c.method === "GET" && c.path.startsWith("/v1/checkout/sessions/")).length, 3);
  assert.equal(delivered().length, 0);
  intentOf(session).metadata.email_attempt = JSON.stringify({ n: 1, at: new Date(Date.now() - 130000).toISOString(), id: "abc123", sent: [] });
  assert.equal((await hook(completed(session))).status, 200);
  assert.equal(delivered().length, 2);
  assert.ok(stripe.calls.some((c) => c.idempotency === `nlr-mail-${session.payment_intent}-2`));
});

await test("without PaymentIntent access the marker falls back to the Checkout Session metadata, which the documented key can write, and still sends once", async () => {
  for (const access of ["none", "read"]) {
    setEnv(mailEnv());
    stripe.intentAccess = access;
    withContext();
    const session = paid(ONE_WAY);
    await lookup(session);
    assert.deepEqual(await settled(), ["sent"]);
    assert.equal(delivered().length, 2);
    assert.ok(stripe.sessions.get(session.id).metadata.emailed_at, access);
    assert.equal(intentOf(session).metadata.emailed_at, undefined);
    assert.ok(logged.includes("mail-marker 83558982 payment_intents 403"), logged.join(" | "));
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
  stripe.intentAccess = "none";
  stripe.sessionUpdates = "refuse";
  withContext();
  const session = paid(ONE_WAY);
  await lookup(session);
  assert.deepEqual(await settled(), ["unmarked"]);
  assert.equal(delivered().length, 0);
  assert.deepEqual(logged, ["mail-marker 83558982 payment_intents 403", "mail-marker 83558982 checkout/sessions 400", "mail-unmarked 83558982"]);
  assert.equal((await hook(completed(session))).status, 200);
  assert.deepEqual(delivered().map((m) => m.to), [["ana.lopez@example.com"], OWNERS]);
});

await test("a refused marker that Stripe keeps under its idempotency key is not mistaken for another trigger's claim: the webhook re-reads twice, finds no claim and sends, instead of answering 503 until the key expires", async () => {
  for (const access of ["none", "read-kept"]) {
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
    const reread = (path, id) => [`POST ${path} nlr-mail-${id}-1`, `GET ${path} `, `GET ${path} `];
    const intent = `/v1/payment_intents/${session.payment_intent}`;
    const checkout = `/v1/checkout/sessions/${session.id}`;
    assert.deepEqual(stripe.calls.map((c) => `${c.method} ${c.path} ${c.idempotency}`), [`GET ${checkout} `, `GET ${intent} `, ...(access === "none" ? [] : reread(intent, session.payment_intent)), ...reread(checkout, session.id)], access);
    assert.deepEqual(logged, [`mail-marker 83558982 payment_intents ${access === "none" ? 403 : 400}`, "mail-marker 83558982 checkout/sessions 400"]);
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
  assert.ok(intentOf(session).metadata.emailed_at);
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

await test("no log line holds the SMTP password, the AUTH string, an address, a name, a phone number or any part of an email", () => {
  assert.ok(history.length > 40, `${history.length} log lines`);
  const all = history.join("\n");
  const secrets = [PASS, Buffer.from(`\u0000${USER}\u0000${PASS}`).toString("base64"), "ana.lopez@example.com", "Ana Lopez", "Ben Ortiz", "Zo\u00eb", "212 555", "2125550100", "917 555", "7946", "Main Street", "72nd", "Secaucus", "Infant", "toddler", "Subject", "Payment received", "@"];
  for (const secret of secrets) assert.ok(!all.includes(secret), secret);
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
