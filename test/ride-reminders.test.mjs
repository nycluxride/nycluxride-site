import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, getCACertificates, setDefaultCACertificates } from "node:tls";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readInput, resolveTrip, priceTrip, readSettings, fill } from "../api/_trip.mjs";
import { metadataFor } from "../api/_stripe.mjs";
import { MAIL, CALENDAR } from "../api/_copy.mjs";
import { bookingEvents, bookingLetters, reminderLetter } from "../api/_mail.mjs";
import { newYork, dueLegs, MARK } from "../api/_remind.mjs";
import * as route from "../api/ride-reminders.mjs";

const { GET } = route;
const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const RealDate = Date;
const RUN = "2026-11-21T22:30:00.000Z";
const CATCH_UP = "2026-11-21T23:30:00.000Z";
const TOMORROW = "2026-11-22";
const BOOKED = new RealDate("2026-11-19T15:00:00.000Z");
const CREATED = Math.floor(BOOKED.getTime() / 1000);
const REF = "83558982";
const KEY = ["rk", "live", "51NlrReminderTestKeyOnly"].join("_");
const CRON = `cron-${createHash("sha256").update("ride reminders cron").digest("hex").slice(0, 32)}`;
const USER = "info@nycluxride.com";
const PASS = `pw-${createHash("sha256").update("reminder smtp").digest("hex").slice(0, 16)}`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const OIDC = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: "https://oidc.vercel.com/nlr", sub: "owner:nlr:project:site:environment:production" })}.${Buffer.from("reminder test signature").toString("base64url")}`;
const STS_TOKEN = `ya29.sts-${createHash("sha256").update("reminder sts").digest("hex").slice(0, 24)}`;
const ACCESS_TOKEN = `ya29.sa-${createHash("sha256").update("reminder sa").digest("hex").slice(0, 24)}`;
const GCAL = { GCAL_CALENDAR_ID: "c_0a1b2c3d4e5f@group.calendar.google.com", GCAL_SERVICE_ACCOUNT: "nlr-calendar@nlr-test-000000.iam.gserviceaccount.com", GCAL_WIF_AUDIENCE: "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/nycluxride" };
const ENV_KEYS = ["CRON_SECRET", "STRIPE_SECRET_KEY", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "VERCEL_ENV", "GOOGLE_MOCK", "VERCEL_OIDC_TOKEN", ...Object.keys(GCAL)];
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

const lines = [];
console.error = (...args) => lines.push(args.map(String).join(" "));
console.log = (...args) => lines.push(args.map(String).join(" "));

const certDir = mkdtempSync(join(tmpdir(), "nlr-reminder-test-"));
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
  const state = { messages: [], behavior: {}, sessions: 0 };
  const server = createServer({ key: TLS_KEY, cert: TLS_CERT }, (socket) => {
    state.sessions++;
    socket.on("error", () => {});
    socket.setEncoding("latin1");
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
            if (!refusal) state.messages.push(mail);
            data = null;
            mail = null;
            say(refusal || "250 2.0.0 OK queued");
          } else data.push(line.startsWith(".") ? line.slice(1) : line);
          continue;
        }
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") {
          say("250-fake.test");
          say("250-AUTH LOGIN PLAIN");
          say("250 SMTPUTF8");
        } else if (verb === "AUTH") say(b.auth ? b.auth() : "235 2.7.0 Accepted");
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

const stripe = { sessions: new Map(), keys: new Map(), calls: [], fail: null, delay: 0 };
const google = { calls: [], events: new Map(), fail: null };
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "request-id": "req_fake0001" } });

function apply(metadata, body) {
  for (const [name, value] of new URLSearchParams(body)) {
    const match = /^metadata\[(.+)\]$/.exec(name);
    if (!match) continue;
    if (value === "") delete metadata[match[1]];
    else metadata[match[1]] = value;
  }
}

function listed(search) {
  const created = (name) => Number(search.get(`created[${name}]`));
  const all = [...stripe.sessions.values()].filter((s) => s.status === search.get("status") && s.created >= created("gte") && s.created <= created("lte")).sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
  const after = search.get("starting_after");
  const start = after ? all.findIndex((s) => s.id === after) + 1 : 0;
  const limit = Number(search.get("limit") || 10);
  return { object: "list", data: structuredClone(all.slice(start, start + limit)), has_more: start + limit < all.length, url: "/v1/checkout/sessions" };
}

async function update(session, key, body) {
  const saved = stripe.keys.get(key);
  if (saved && saved.body !== body) return answer(400, { error: { type: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters they were first used with." } });
  if (saved && saved.pending) return answer(409, { error: { type: "idempotency_error", message: "There is currently another in-progress request using this Idempotent Key." } });
  if (saved) return answer(saved.status, saved.result);
  const entry = { body, pending: true };
  stripe.keys.set(key, entry);
  if (stripe.delay) await new Promise((resolve) => setTimeout(resolve, stripe.delay));
  const next = { ...session.metadata };
  apply(next, body);
  const [status, result] = Object.keys(next).length > 50 ? [400, { error: { type: "invalid_request_error", message: "Metadata can have up to 50 keys." } }] : [200, null];
  if (status === 200) apply(session.metadata, body);
  Object.assign(entry, { pending: false, status, result: result || structuredClone(session) });
  return answer(status, entry.result);
}

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  const method = init.method || "GET";
  const headers = new Headers(init.headers);
  const body = String(init.body || "");
  if (/(^|\.)googleapis\.com$/.test(target.hostname)) {
    const stage = target.origin === "https://sts.googleapis.com" ? "sts" : target.origin === "https://iamcredentials.googleapis.com" ? "iam" : "events";
    google.calls.push({ stage, method, path: target.pathname, auth: headers.get("authorization") });
    const failed = google.fail && google.fail(stage, target.pathname);
    if (failed) return answer(failed, { error: { code: failed, message: `${stage} said no` } });
    if (stage === "sts") return answer(200, { access_token: STS_TOKEN, token_type: "Bearer", expires_in: 3599 });
    if (stage === "iam") return answer(200, { accessToken: ACCESS_TOKEN, expireTime: "2026-11-21T23:05:00Z" });
    const id = decodeURIComponent(/\/events\/([^/]+)$/.exec(target.pathname)[1]);
    const held = google.events.get(id);
    if (held === "gone") return answer(410, { error: { code: 410, message: "Resource has been deleted" } });
    if (!held) return answer(404, { error: { code: 404, message: "Not Found" } });
    return answer(200, { kind: "calendar#event", status: "confirmed", ...held });
  }
  if (target.origin !== "https://api.stripe.com") throw new Error(`a request went to ${target.origin}`);
  stripe.calls.push({ method, path: target.pathname, search: target.search, idempotency: headers.get("idempotency-key") || "", body, auth: headers.get("authorization") });
  const failed = stripe.fail && stripe.fail(method, target.pathname, headers.get("idempotency-key") || "");
  const key = headers.get("idempotency-key");
  if (failed >= 500 && method === "POST" && key && !stripe.keys.has(key)) stripe.keys.set(key, { body, pending: false, status: failed, result: { error: { type: "api_error" } } });
  if (failed) return failed === "drop" ? Promise.reject(new TypeError("fetch failed")) : answer(failed, { error: { type: "api_error" } });
  if (target.pathname === "/v1/checkout/sessions" && method === "GET") return answer(200, listed(target.searchParams));
  const match = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(target.pathname);
  const session = match && stripe.sessions.get(decodeURIComponent(match[1]));
  if (!session) return answer(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
  if (method === "GET") return answer(200, structuredClone(session));
  return update(session, headers.get("idempotency-key"), body);
};

const smtp = await fakeSmtp();
function setEnv(vars = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  lines.length = 0;
  stripe.sessions.clear();
  stripe.keys.clear();
  stripe.calls.length = 0;
  stripe.fail = null;
  stripe.delay = 0;
  google.calls.length = 0;
  google.events.clear();
  google.fail = null;
  smtp.messages.length = 0;
  smtp.behavior = {};
  smtp.sessions = 0;
}
const liveEnv = (extra = {}) => ({ CRON_SECRET: CRON, VERCEL_ENV: "production", STRIPE_SECRET_KEY: KEY, SMTP_USER: USER, SMTP_PASS: PASS, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), ...extra });

async function booked(fields) {
  const trip = await resolveTrip(readInput(fields), { now: BOOKED });
  const price = priceTrip(trip, readSettings({ PAYMENTS_ENABLED: "true" }));
  return { metadata: metadataFor(trip, price, REF), total: price.total };
}
const day = { date: TOMORROW, time: "15:30" };
setEnv({ GOOGLE_MOCK: "true" });
const ADDRESS = await booked({ trip_type: "one", from_text: "253 West 72nd Street, New York, NY 10023, USA", to_text: "Newark Liberty (EWR)", to_id: "ewr", ...day, passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "whatsapp" });
const JFK = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, ...day, flight: "DL 401", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const JFK_T5 = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 5", from_id: "jfk-t5", to_text: MANHATTAN, ...day, flight: "B6 1234", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const LGA = await booked({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", stop1_text: "277 Bedford Ave, Brooklyn, NY 11211", to_text: MANHATTAN, ...day, flight: "AA 100", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const EWR = await booked({ trip_type: "one", from_text: "Newark Liberty (EWR)", from_id: "ewr", to_text: MANHATTAN, ...day, passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const MEET = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, ...day, flight: "DL 401", meet: "1", sign: "Lopez Family", passengers: "3", class: "suv", tip: "15", rider: "me", ...ME, reach: "phone" });
const TEB = await booked({ trip_type: "one", from_text: "Teterboro (TEB), Atlantic Aviation", from_id: "teb-atlantic", to_text: MANHATTAN, ...day, passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const HOURLY = await booked({ trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", ...day, passengers: "1", hours: "4", class: "premium", vehicle: "premium", tip: "0", rider: "me", ...ME, reach: "phone" });
const HOURLY_JFK = await booked({ trip_type: "hour", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", ...day, passengers: "1", hours: "4", class: "premium", vehicle: "premium", flight: "BA 117", meet: "1", tip: "0", rider: "me", ...ME, reach: "phone" });
const ROUND = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4", date: TOMORROW, time: "07:30", return: "1", return_date: "2026-11-25", return_time: "18:00", return_flight: "DL 402", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const ROUND_HOME = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-20", time: "07:30", return: "1", return_date: TOMORROW, return_time: "18:00", flight: "DL 401", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const SAME_DAY = await booked({ trip_type: "one", from_text: MANHATTAN, to_text: "LaGuardia (LGA)", to_id: "lga", date: TOMORROW, time: "09:00", return: "1", return_date: TOMORROW, return_time: "20:00", return_flight: "AA 101", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const OTHER = await booked({ trip_type: "one", from_text: "LaGuardia (LGA)", from_id: "lga", to_text: MANHATTAN, ...day, flight: "UA 523", passengers: "2", class: "suv", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const WORST = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", stop1_text: MANHATTAN, stop2_text: "277 Bedford Ave, Brooklyn, NY 11211", to_text: "1 Main Street, Brooklyn, NY 11201", date: TOMORROW, time: "13:20", return: "1", return_date: "2026-11-25", return_time: "18:00", flight: "DL 401", return_flight: "B6 1234", passengers: "12", class: "sprinter", sprinter: "sprinter-executive", meet: "1", tip: "custom", tip_amount: "40", rider: "other", ...ME, reach: "whatsapp", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz family", notes: "Kids aged 1, 3 and 6", infant_seats: "4", toddler_seats: "4", booster_seats: "4", small_dogs: "3", large_dogs: "3" });
const FBO_HOURLY = await booked({ trip_type: "hour", from_text: "Westchester County (HPN), Million Air", from_id: "hpn-million", ...day, passengers: "2", hours: "4", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const ISP_HOURLY = await booked({ trip_type: "hour", from_text: "Long Island MacArthur (ISP)", from_id: "isp", ...day, passengers: "2", hours: "4", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const FBO_OTHER = await booked({ trip_type: "one", from_text: "New York Stewart (SWF), Signature Flight Support", from_id: "swf-signature", to_text: MANHATTAN, ...day, passengers: "2", class: "suv", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const MEET_T5 = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 5", from_id: "jfk-t5", to_text: MANHATTAN, ...day, flight: "B6 1234", meet: "1", sign: "Lopez Family", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
const T5_OTHER = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 5", from_id: "jfk-t5", to_text: MANHATTAN, ...day, flight: "B6 1234", passengers: "2", class: "suv", tip: "0", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958" });
const NIGHT = await booked({ trip_type: "one", from_text: "253 West 72nd Street, New York, NY 10023, USA", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: TOMORROW, time: "00:30", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "phone" });
setEnv();

let serial = 0;
function paid(fix, { live = true, metadata = {}, created = CREATED, status = "complete", payment = "paid" } = {}) {
  serial++;
  const tag = `RemindTest${String(serial).padStart(4, "0")}`;
  const id = `cs_${live ? "live" : "test"}_${tag}a1B2c3D4e5F6`;
  const data = Object.fromEntries(Object.entries({ ...fix.metadata, ...metadata }).filter(([, value]) => value !== undefined));
  const session = { id, object: "checkout.session", livemode: live, created, status, payment_status: payment, amount_total: fix.total, currency: "usd", client_reference_id: data.ref, payment_intent: `pi_${tag}Q7r8S9`, customer_details: { email: data.email, name: data.name, phone: "+12125550100" }, metadata: data };
  stripe.sessions.set(id, session);
  return session;
}
const stored = (session) => stripe.sessions.get(session.id).metadata;
const marks = (session) => JSON.parse(stored(session)[MARK] || "{}");

async function at(iso, fn) {
  const fixed = RealDate.parse(iso);
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
const ask = (headers = { authorization: `Bearer ${CRON}` }) => GET(new Request("https://www.nycluxride.com/api/ride-reminders", { headers: { "x-vercel-oidc-token": OIDC, ...headers } }));
const run = (iso = RUN, headers) => at(iso, () => ask(headers));

function parse(raw) {
  const split = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, split);
  const fields = [];
  for (const line of head.split("\r\n")) {
    if (/^[ \t]/.test(line)) fields[fields.length - 1][1] += line;
    else fields.push([line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]);
  }
  const decode = (value) => value.replace(/\?=\s+=\?/g, "?==?").replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/gi, (match, data) => Buffer.from(data, "base64").toString("utf8"));
  const headers = new Map(fields.map(([name, value]) => [name.toLowerCase(), decode(value)]));
  const boundary = /boundary="([^"]+)"/.exec(headers.get("content-type"))[1];
  const parts = raw.slice(split + 4).split(`--${boundary}`).slice(1, -1).map((part) => {
    const cut = part.indexOf("\r\n\r\n");
    return { type: /Content-Type: ([^;\r\n]+)/i.exec(part.slice(0, cut))[1], text: Buffer.from(part.slice(cut + 4).replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n") };
  });
  return { headers, text: parts.find((p) => p.type === "text/plain").text, html: parts.find((p) => p.type === "text/html").text };
}
const sent = () => smtp.messages.map((m) => ({ to: m.to, ...parse(m.data) }));
const sectionOf = (text, heading) => {
  const all = text.split("\n");
  const start = all.indexOf(heading);
  if (start < 0) return null;
  const end = all.indexOf("", start);
  return all.slice(start + 1, end < 0 ? undefined : end);
};
const ALLOWED_LINKS = ["mailto:info@nycluxride.com", "https://wa.me/16467750556", "tel:+16467750556", "https://www.nycluxride.com", "https://www.nycluxride.com/rates#policies"];

function checkLetter(letter) {
  const { document } = new JSDOM(letter.html).window;
  assert.match(letter.html, /^<!DOCTYPE html>\n<html lang="en">/);
  assert.equal(document.title, letter.subject);
  assert.equal(document.querySelectorAll("h1").length, 1);
  assert.equal(document.querySelectorAll("img, script, link, iframe, form, style, object, embed, video, audio, picture, source, svg").length, 0);
  assert.doesNotMatch(letter.html, /url\(|\s(src|srcset|background|on[a-z]+)\s*=|javascript:/i);
  for (const row of document.querySelectorAll("tr")) assert.deepEqual([row.children.length, row.children[0].tagName, row.children[0].getAttribute("scope"), row.children[1].tagName], [2, "TH", "row", "TD"]);
  assert.deepEqual([...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((href) => !ALLOWED_LINKS.includes(href)), []);
  assert.ok(letter.html.includes("color:#14181f") && letter.html.includes("color:#0b4fa8"), "the booking email colors");
  assert.doesNotMatch(`${letter.subject}\n${letter.text}`, /[—–;]/, "no dash or semicolon");
  return document;
}
const whereOf = (letter) => sectionOf(letter.text, MAIL.where.heading);
const rowsOf = (letter) => sectionOf(letter.text, MAIL.trip);

await test("the route answers GET only and nothing else is exported", () => {
  assert.deepEqual(Object.keys(route), ["GET"]);
});

await test("without the cron bearer the route answers 401 and calls nothing: no header, a wrong secret, a secret one character short of 32, a 32 character secret with the wrong header, a secret with a space, and no CRON_SECRET at all", async () => {
  const short = CRON.slice(0, 31);
  const cases = [
    [liveEnv(), {}],
    [liveEnv(), { authorization: `Bearer ${CRON}x` }],
    [liveEnv(), { authorization: `bearer ${CRON}` }],
    [liveEnv(), { authorization: CRON }],
    [liveEnv({ CRON_SECRET: short }), { authorization: `Bearer ${short}` }],
    [liveEnv({ CRON_SECRET: CRON.slice(0, 32) }), { authorization: `Bearer ${CRON.slice(0, 31)}` }],
    [liveEnv({ CRON_SECRET: `${CRON.slice(0, 20)} ${CRON.slice(20)}` }), { authorization: `Bearer ${CRON.slice(0, 20)} ${CRON.slice(20)}` }],
    [liveEnv({ CRON_SECRET: "" }), { authorization: "Bearer " }],
  ];
  for (const [env, headers] of cases) {
    setEnv(env);
    paid(ADDRESS);
    const res = await run(RUN, headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(await res.json(), { kind: "unauthorized" });
    assert.deepEqual([stripe.calls.length, smtp.sessions, google.calls.length, lines.length], [0, 0, 0, 0], JSON.stringify(headers));
  }
  setEnv(liveEnv({ CRON_SECRET: CRON.slice(0, 32) }));
  paid(ADDRESS);
  assert.equal((await run(RUN, { authorization: `Bearer ${CRON.slice(0, 32)}` })).status, 200, "a 32 character secret is enough");
  assert.equal(smtp.messages.length, 1);
});

await test("New York time: tomorrow is the next calendar day, across both clock changes and the end of a month and a year", () => {
  assert.deepEqual(newYork(new RealDate("2026-11-21T22:30:00Z")), { hour: 17, today: "2026-11-21", tomorrow: "2026-11-22" });
  assert.deepEqual(newYork(new RealDate("2026-10-31T21:15:00Z")), { hour: 17, today: "2026-10-31", tomorrow: "2026-11-01" });
  assert.deepEqual(newYork(new RealDate("2026-11-01T22:15:00Z")), { hour: 17, today: "2026-11-01", tomorrow: "2026-11-02" });
  assert.deepEqual(newYork(new RealDate("2027-03-13T22:59:59Z")), { hour: 17, today: "2027-03-13", tomorrow: "2027-03-14" });
  assert.deepEqual(newYork(new RealDate("2027-03-14T21:00:00Z")), { hour: 17, today: "2027-03-14", tomorrow: "2027-03-15" });
  assert.deepEqual(newYork(new RealDate("2026-12-31T23:30:00Z")), { hour: 18, today: "2026-12-31", tomorrow: "2027-01-01" });
  assert.deepEqual(newYork(new RealDate("2028-02-28T22:00:00Z")), { hour: 17, today: "2028-02-28", tomorrow: "2028-02-29" });
  assert.deepEqual(newYork(new RealDate("2026-11-22T04:59:59Z")), { hour: 23, today: "2026-11-21", tomorrow: "2026-11-22" });
});

await test("the schedule: of the three daily crons at 21, 22 and 23 UTC, the 5 PM New York run sends and the 6 PM run catches up, in winter and in summer, anywhere inside the hour Vercel picks, and the third run does nothing", async () => {
  const seasons = [
    ["2026-12-15", "2026-12-16", { "21": "off", "22": "send", "23": "catch-up" }],
    ["2027-07-15", "2027-07-16", { "21": "send", "22": "catch-up", "23": "off" }],
    ["2027-03-14", "2027-03-15", { "21": "send", "22": "catch-up", "23": "off" }],
    ["2026-11-01", "2026-11-02", { "21": "off", "22": "send", "23": "catch-up" }],
  ];
  for (const [today, tomorrow, hours] of seasons) {
    for (const [hour, want] of Object.entries(hours)) {
      for (const minute of ["00:00", "59:59"]) {
        setEnv(liveEnv());
        const created = Math.floor(RealDate.parse(`${today}T00:00:00Z`) / 1000) - 86400;
        const session = paid(ADDRESS, { created, metadata: { date: tomorrow, time: "08:00" } });
        if (want === "catch-up") {
          await run(`${today}T${String(Number(hour) - 1).padStart(2, "0")}:30:00.000Z`);
          assert.equal(smtp.messages.length, 1, `${today} ${hour}: the earlier run sent`);
        }
        const res = await run(`${today}T${hour}:${minute}.000Z`);
        const label = `${today} ${hour}:${minute} UTC`;
        if (want === "off") {
          assert.equal(res.status, 204, label);
          assert.deepEqual([stripe.calls.length, smtp.messages.length], [0, 0], label);
          assert.match(lines.at(-1), /^reminders-off hour (16|19)$/, label);
        } else {
          assert.equal(res.status, 200, label);
          assert.equal(smtp.messages.length, 1, label);
          assert.equal(marks(session).a.sent !== undefined, true, label);
        }
        if (want === "catch-up") {
          setEnv(liveEnv());
          paid(ADDRESS, { created, metadata: { date: tomorrow, time: "08:00" } });
          assert.equal((await run(`${today}T${hour}:${minute}.000Z`)).status, 200);
          assert.equal(smtp.messages.length, 1, `${label}: the catch-up run sends when the 5 PM run was missed`);
        }
      }
    }
  }
});

await test("the Stripe listing asks for complete sessions created from 366 days before the run up to the run, 100 at a time, pages with starting_after, and uses the live restricted key", async () => {
  setEnv(liveEnv());
  const due = [];
  for (let i = 0; i < 230; i++) {
    const session = paid(ADDRESS, { created: CREATED - i * 60, metadata: i % 50 === 0 ? {} : { date: "2026-12-30" } });
    if (i % 50 === 0) due.push(session);
  }
  assert.equal((await run()).status, 200);
  const lists = stripe.calls.filter((c) => c.method === "GET" && c.path === "/v1/checkout/sessions").map((c) => Object.fromEntries(new URLSearchParams(c.search)));
  const run_s = RealDate.parse(RUN) / 1000;
  assert.deepEqual(lists.map((q) => q.starting_after || ""), ["", lists[1].starting_after, lists[2].starting_after]);
  for (const q of lists) assert.deepEqual([q.status, q["created[gte]"], q["created[lte]"], q.limit], ["complete", String(run_s - 366 * 86400), String(run_s), "100"]);
  assert.ok(stripe.calls.every((c) => c.auth === `Bearer ${KEY}`));
  assert.equal(smtp.messages.length, due.length);
  assert.ok(due.every((session) => marks(session).a.sent));
});

await test("which rides: only pickups dated tomorrow in New York, today's, the day after's and last year's same day are left alone, and expired or open sessions are never read", async () => {
  setEnv(liveEnv());
  const tomorrow = paid(JFK);
  const others = [paid(JFK, { metadata: { date: "2026-11-21" } }), paid(JFK, { metadata: { date: "2026-11-23" } }), paid(JFK, { metadata: { date: "2025-11-22" } }), paid(JFK, { status: "expired" }), paid(JFK, { status: "open", payment: "unpaid" }), paid(JFK, { payment: "unpaid" }), paid(JFK, { metadata: { time: "25:00" } }), paid(JFK, { metadata: { ref: undefined } })];
  const byClient = paid(JFK, { metadata: { ref: undefined } });
  stripe.sessions.get(byClient.id).client_reference_id = REF;
  assert.equal((await run()).status, 200);
  const mails = sent();
  assert.equal(mails.length, 2);
  assert.deepEqual(mails.map((m) => m.to), [["ana.lopez@example.com"], ["ana.lopez@example.com"]]);
  assert.ok(mails.every((m) => m.headers.get("subject").endsWith(`booking ${REF}`)));
  assert.ok(marks(tomorrow).a.sent && marks(byClient).a.sent);
  for (const session of others) {
    assert.equal(stored(session)[MARK], undefined, session.id);
    assert.ok(!stripe.calls.some((c) => c.path === `/v1/checkout/sessions/${session.id}`), session.id);
  }
  assert.deepEqual(dueLegs(others.at(-1), TOMORROW), []);
});

await test("a round trip: the ride out is reminded the day before it, the return the day before the return with its own pickup, drop-off and flight, each once, in its own email", async () => {
  setEnv(liveEnv());
  const out = paid(ROUND);
  const home = paid(ROUND_HOME);
  assert.deepEqual([dueLegs(out, TOMORROW), dueLegs(home, TOMORROW), dueLegs(out, "2026-11-25")], [["a"], ["b"], ["b"]]);
  await run();
  const [first, second] = sent();
  assert.equal(sent().length, 2);
  const byRef = (mail) => mail.headers.get("subject");
  assert.deepEqual([first, second].map(byRef).sort(), ["Your ride tomorrow, Sun Nov 22, 6:00 PM, NYC LUX RIDE booking 83558982", "Your ride tomorrow, Sun Nov 22, 7:30 AM, NYC LUX RIDE booking 83558982"]);
  const outMail = [first, second].find((m) => byRef(m).includes("7:30 AM"));
  const homeMail = [first, second].find((m) => byRef(m).includes("6:00 PM"));
  assert.deepEqual(sectionOf(outMail.text, MAIL.trip), ["Reference: 83558982", "Date: Sun, Nov 22, 2026", "Time: 7:30 AM, New York time", "Pickup: 350 5th Ave, New York, NY 10118", "Drop-off: John F. Kennedy (JFK), Terminal 4", "Vehicle: Business SUV", "Passengers: 2"]);
  assert.deepEqual(sectionOf(outMail.text, MAIL.where.heading), [MAIL.day.pickup]);
  assert.deepEqual(sectionOf(homeMail.text, MAIL.trip), ["Reference: 83558982", "Trip: Return ride", "Date: Sun, Nov 22, 2026", "Time: 6:00 PM, New York time", "Pickup: 350 5th Ave, New York, NY 10118", "Drop-off: John F. Kennedy (JFK), Terminal 4", "Vehicle: Business SUV", "Passengers: 2"]);
  assert.deepEqual(sectionOf(homeMail.text, MAIL.where.heading), [MAIL.where.address], "a return picked up at an address says where, with no waiting promise");
  assert.deepEqual(Object.keys(marks(out)), ["a"]);
  assert.deepEqual(Object.keys(marks(home)), ["b"]);
  smtp.messages.length = 0;
  await run("2026-11-24T22:30:00.000Z");
  const [back] = sent();
  assert.equal(sent().length, 1);
  assert.equal(back.headers.get("subject"), "Your ride tomorrow, Wed Nov 25, 6:00 PM, NYC LUX RIDE booking 83558982");
  assert.deepEqual(sectionOf(back.text, MAIL.trip), ["Reference: 83558982", "Trip: Return ride", "Date: Wed, Nov 25, 2026", "Time: 6:00 PM, New York time", "Pickup: John F. Kennedy (JFK), Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", "Flight: DL 402", "Vehicle: Business SUV", "Passengers: 2"]);
  assert.deepEqual(sectionOf(back.text, MAIL.where.heading), [`${MAIL.where.curb} ${MAIL.day.bags}`]);
  assert.deepEqual(Object.keys(marks(out)).sort(), ["a", "b"]);
  assert.ok(marks(out).a.sent && marks(out).b.sent);
  smtp.messages.length = 0;
  await run("2026-11-24T23:30:00.000Z");
  assert.equal(smtp.messages.length, 0);
});

await test("a round trip out and back tomorrow gets one email with both pickups, and an hourly booking is reminded once with no return", async () => {
  setEnv(liveEnv());
  const both = paid(SAME_DAY);
  const hourly = paid(HOURLY, { metadata: { return_date: TOMORROW, return_time: "20:00" } });
  assert.deepEqual([dueLegs(both, TOMORROW), dueLegs(hourly, TOMORROW)], [["a", "b"], ["a"]]);
  await run();
  assert.equal(sent().length, 2);
  const one = sent().find((m) => m.text.includes("LaGuardia"));
  assert.equal(one.headers.get("subject"), "Your ride tomorrow, Sun Nov 22, 9:00 AM, NYC LUX RIDE booking 83558982");
  assert.deepEqual(sectionOf(one.text, MAIL.where.heading), [`Ride out: ${MAIL.day.pickup}`, `Return ride: ${MAIL.where.curb} ${MAIL.day.bags} ${MAIL.where.signs}`]);
  assert.deepEqual(sectionOf(one.text, MAIL.trip), ["Reference: 83558982", "Date: Sun, Nov 22, 2026", "Time: 9:00 AM, New York time", "Pickup: 350 5th Ave, New York, NY 10118", "Drop-off: LaGuardia (LGA)", "Return: Sun, Nov 22, 2026, 8:00 PM, New York time", "Return flight: AA 101", "Vehicle: Business SUV", "Passengers: 2"]);
  assert.deepEqual(Object.keys(marks(both)), ["a", "b"]);
  assert.equal(marks(both).a.n, 1);
  const by = sent().find((m) => !m.text.includes("LaGuardia"));
  assert.deepEqual(sectionOf(by.text, MAIL.trip), ["Reference: 83558982", "Trip: By the hour, 4 hours", "Date: Sun, Nov 22, 2026", "Time: 3:30 PM, New York time", "Pickup: 1 Main Street, Brooklyn, NY 11201", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Passengers: 1"]);
  assert.deepEqual(Object.keys(marks(hourly)), ["a"]);
});

await test("skips: test mode, a session that is not live, a booking made less than 12 hours before 5 PM New York time, and the run's one line counts them", async () => {
  setEnv(liveEnv());
  const run_s = RealDate.parse(RUN) / 1000;
  const cutoff = RealDate.parse("2026-11-21T22:00:00.000Z") / 1000 - 43200;
  const skipped = [paid(JFK, { live: false }), paid(JFK, { created: cutoff + 1 })];
  const testKey = paid(JFK);
  stripe.sessions.get(testKey.id).livemode = false;
  const edge = paid(JFK, { created: cutoff });
  const old = paid(JFK, { created: run_s - 366 * 86400 });
  const older = paid(JFK, { created: run_s - 366 * 86400 - 1 });
  assert.equal((await run()).status, 200);
  assert.equal(smtp.messages.length, 2);
  assert.ok(marks(edge).a.sent && marks(old).a.sent);
  for (const session of [...skipped, testKey, older]) assert.equal(stored(session)[MARK], undefined);
  assert.deepEqual(lines, ["reminders 2026-11-22 recent 1 test 2 sent 2"]);
  setEnv(liveEnv());
  const recent = paid(JFK);
  stripe.sessions.get(recent.id).created = run_s - 3600;
  await run();
  assert.equal(smtp.messages.length, 0);
  assert.deepEqual(lines, ["reminders 2026-11-22 recent 1"]);
});

await test("skips, with the booking calendar on: a full refund marks the event CANCELLED and stops the reminder, so do a refunded amount of the whole payment and an event the owner deleted, a partial refund is still reminded, and a missing event is reminded", async () => {
  setEnv(liveEnv(GCAL));
  const full = paid(JFK);
  const fullTest = paid(JFK);
  const amount = paid(JFK);
  const deleted = paid(JFK);
  const gone = paid(JFK);
  const partial = paid(JFK);
  const missing = paid(JFK);
  const event = (session) => bookingEvents(stripe.sessions.get(session.id))[0];
  google.events.set(event(full).id, { ...event(full), summary: `${CALENDAR.cancelled}${event(full).summary}`, extendedProperties: { private: { nlrRefundedCents: String(JFK.total) } } });
  google.events.set(event(fullTest).id, { ...event(fullTest), summary: `${MAIL.test}${CALENDAR.cancelled}${event(fullTest).summary}` });
  google.events.set(event(amount).id, { ...event(amount), extendedProperties: { private: { nlrRefundedCents: String(JFK.total) } } });
  google.events.set(event(deleted).id, { ...event(deleted), status: "cancelled" });
  google.events.set(event(gone).id, "gone");
  google.events.set(event(partial).id, { ...event(partial), description: `${fill(CALENDAR.partlyRefunded, { amount: "$20.00", total: "$185.00", date: "Nov 20, 2026" })}\n${event(partial).description}`, extendedProperties: { private: { nlrRefundedCents: "2000" } } });
  assert.equal((await run()).status, 200);
  assert.deepEqual(sent().map((m) => m.to[0]), ["ana.lopez@example.com", "ana.lopez@example.com"]);
  for (const session of [full, fullTest, amount, deleted, gone]) assert.equal(stored(session)[MARK], undefined, session.id);
  assert.ok(marks(partial).a.sent && marks(missing).a.sent);
  assert.deepEqual(google.calls.filter((c) => c.stage !== "events").map((c) => c.stage), ["sts", "iam"], "one Google token for the whole run");
  assert.ok(google.calls.filter((c) => c.stage === "events").every((c) => c.method === "GET" && c.auth === `Bearer ${ACCESS_TOKEN}`));
  assert.deepEqual(lines, ["reminders 2026-11-22 sent 2 cancelled 5"]);
});

await test("with the calendar on but unreadable, a ride is never reminded on a guess: a refused token, a failed event read and a bad calendar setting leave it for the catch-up run", async () => {
  for (const [env, fail] of [[GCAL, (stage) => (stage === "iam" ? 403 : 0)], [GCAL, (stage) => (stage === "events" ? 503 : 0)], [{ ...GCAL, GCAL_CALENDAR_ID: "not a calendar" }, null]]) {
    setEnv(liveEnv(env));
    google.fail = fail;
    const session = paid(JFK);
    assert.equal((await run()).status, 200);
    assert.equal(smtp.messages.length, 0);
    assert.equal(stored(session)[MARK], undefined);
    assert.deepEqual(lines, ["reminders 2026-11-22 unchecked 1"]);
    google.fail = null;
    await run(CATCH_UP);
    if (env.GCAL_CALENDAR_ID === GCAL.GCAL_CALENDAR_ID) assert.equal(smtp.messages.length, 1, "the catch-up run sends once the calendar answers");
  }
});

await test("exactly once: a second run, a duplicate of the same run and the 6 PM catch-up send nothing more, and the Message-ID is the same for a session and its legs", async () => {
  setEnv(liveEnv());
  const session = paid(MEET);
  await run();
  await run("2026-11-21T22:31:00.000Z");
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  const mark = marks(session);
  assert.deepEqual(Object.keys(mark), ["a"]);
  assert.deepEqual(Object.keys(mark.a).sort(), ["at", "n", "sent"]);
  assert.equal(mark.a.n, 1);
  assert.deepEqual(lines, ["reminders 2026-11-22 sent 1", "reminders 2026-11-22 done 1", "reminders 2026-11-22 done 1"]);
  const id = sent()[0].headers.get("message-id");
  assert.equal(id, `<reminder.${createHash("sha256").update(`${session.id} reminder a`).digest("hex").slice(0, 32)}@nycluxride.com>`);
  assert.equal(reminderLetter(stripe.sessions.get(session.id), ["a"]).id, id.slice(1, -"@nycluxride.com>".length));
  const writes = stripe.calls.filter((c) => c.method === "POST");
  assert.deepEqual(writes.map((c) => c.idempotency), [`nlr-remind-${session.id}-a-1`, `nlr-remind-${session.id}-a-1-sent`]);
});

await test("exactly once when two runs overlap: both read the ride as open, one wins the claim and sends, the other backs off on the idempotency key", async () => {
  setEnv(liveEnv());
  const session = paid(JFK);
  stripe.delay = 300;
  const [a, b] = await at(RUN, () => Promise.all([ask(), ask()]));
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(smtp.messages.length, 1);
  assert.ok(marks(session).a.sent);
  assert.deepEqual(lines.sort(), ["reminders 2026-11-22 claimed 1", "reminders 2026-11-22 sent 1"]);
  const claims = stripe.calls.filter((c) => c.method === "POST" && c.idempotency === `nlr-remind-${session.id}-a-1`);
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].body, claims[1].body, "each run claims with its own nonce");
});

await test("a claim left by a run that stopped mid-send is never sent again, and neither is a ride whose email may have reached the mail server", async () => {
  setEnv(liveEnv());
  const stale = paid(JFK, { metadata: { [MARK]: JSON.stringify({ a: { n: 1, at: "2026-11-21T22:05:00.000Z", id: "a1b2c3d4e5f6" } }) } });
  const reached = paid(JFK, { metadata: { [MARK]: JSON.stringify({ a: { n: 1, at: "2026-11-21T22:05:00.000Z", reached: 1 } }) } });
  const odd = paid(JFK, { metadata: { [MARK]: "not json" } });
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 0);
  assert.equal(stripe.calls.filter((c) => c.method === "POST").length, 0);
  for (const session of [stale, reached, odd]) assert.ok(stored(session)[MARK]);
  assert.deepEqual(lines, ["reminders 2026-11-22 done 2 claimed 1"]);
});

await test("failure mid-run: a mail server that refuses the login before DATA is marked failed and the catch-up run sends once, a refusal after DATA is never resent", async () => {
  setEnv(liveEnv());
  const session = paid(JFK);
  smtp.behavior.auth = () => "454 4.7.0 Temporary authentication failure";
  await run();
  assert.equal(smtp.messages.length, 0);
  assert.deepEqual([marks(session).a.failed, marks(session).a.n], [1, 1]);
  assert.deepEqual(lines, ["reminders 2026-11-22 failed 1"]);
  smtp.behavior = {};
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual([marks(session).a.n, Boolean(marks(session).a.sent), marks(session).a.failed], [2, true, undefined]);
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  setEnv(liveEnv());
  const data = paid(JFK);
  smtp.behavior.refuse = () => "451 4.3.0 Mail server temporarily rejected message";
  await run();
  assert.deepEqual([smtp.messages.length, marks(data).a.reached], [0, 1]);
  smtp.behavior = {};
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 0);
  assert.deepEqual(lines, ["reminders 2026-11-22 reached 1", "reminders 2026-11-22 done 1"]);
});

await test("failure mid-run: pre-DATA failures are tried at most three times in all", async () => {
  setEnv(liveEnv());
  const session = paid(JFK);
  smtp.behavior.auth = () => "454 4.7.0 Temporary authentication failure";
  for (const iso of [RUN, CATCH_UP, CATCH_UP, CATCH_UP]) await run(iso);
  assert.equal(marks(session).a.n, 3);
  assert.equal(stripe.calls.filter((c) => c.method === "POST" && /-\d$/.test(c.idempotency)).length, 3);
});

await test("failure mid-run: one ride's Stripe read failing does not stop the others, and the catch-up run sends the one left", async () => {
  setEnv(liveEnv());
  const first = paid(JFK, { created: CREATED });
  const broken = paid(LGA, { created: CREATED - 60 });
  const last = paid(EWR, { created: CREATED - 120 });
  stripe.fail = (method, path) => (method === "GET" && path === `/v1/checkout/sessions/${broken.id}` ? 500 : 0);
  assert.equal((await run()).status, 200);
  assert.equal(smtp.messages.length, 2);
  assert.ok(marks(first).a.sent && marks(last).a.sent && !stored(broken)[MARK]);
  assert.deepEqual(lines, ["reminders 2026-11-22 sent 2 failed 1"]);
  stripe.fail = null;
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 3);
  assert.ok(marks(broken).a.sent);
});

await test("failure mid-run: a listing that fails on any page sends nothing and answers 500, and the catch-up run does the whole list", async () => {
  setEnv(liveEnv());
  for (let i = 0; i < 150; i++) paid(JFK, { created: CREATED - i, metadata: i === 0 || i === 149 ? {} : { date: "2026-12-30" } });
  let pages = 0;
  stripe.fail = (method, path) => (method === "GET" && path === "/v1/checkout/sessions" && ++pages === 2 ? 500 : 0);
  const res = await run();
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { kind: "error" });
  assert.equal(smtp.messages.length, 0);
  assert.deepEqual(lines, ["reminders-fail list 500"]);
  stripe.fail = null;
  assert.equal((await run(CATCH_UP)).status, 200);
  assert.equal(smtp.messages.length, 2);
});

await test("failure mid-run: a claim whose answer is lost is read back, a mark that fails after the email went out leaves the claim so nothing is sent twice", async () => {
  setEnv(liveEnv());
  const session = paid(JFK);
  let dropped = 0;
  stripe.fail = (method, path, key) => (method === "POST" && key === `nlr-remind-${session.id}-a-1` && dropped++ < 2 ? "drop" : 0);
  await run();
  assert.equal(smtp.messages.length, 0, "two unanswered claims and nothing stored means no email");
  assert.equal(stored(session)[MARK], undefined);
  assert.deepEqual(lines, ["reminders 2026-11-22 failed 1"]);
  stripe.fail = (method, path, key) => (method === "POST" && key.endsWith("-sent") ? 500 : 0);
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  assert.ok(marks(session).a.id && !marks(session).a.sent, "the claim stays");
  stripe.fail = null;
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
});

await test("the metadata budget: the reminder adds exactly one key and clears a leftover email_attempt once emailed_at is set, so a booking at the tested cap of 48 data keys with both email markers stays within Stripe's 50, and a session already full is skipped without an email", async () => {
  setEnv(liveEnv());
  const keys = Object.keys(WORST.metadata);
  assert.ok(keys.length >= 40 && keys.length <= 48, `${keys.length} keys`);
  const padded = Object.fromEntries(Array.from({ length: 48 - keys.length }, (_, i) => [`pad_${i}`, "x"]));
  const full = paid(WORST, { metadata: { ...padded, emailed_at: "2026-11-19T15:01:00.000Z", email_attempt: JSON.stringify({ n: 1, at: "2026-11-19T15:00:30.000Z", id: "a1b2c3d4e5f6", sent: ["customer", "owner"], tries: 0 }) } });
  const unsent = paid(WORST, { metadata: { ...padded, email_attempt: JSON.stringify({ n: 5, at: "2026-11-19T15:00:30.000Z", id: "a1b2c3d4e5f6", sent: [], tries: 5, failed: true }) } });
  const crowded = paid(JFK, { metadata: Object.fromEntries(Array.from({ length: 50 - Object.keys(JFK.metadata).length }, (_, i) => [`pad_${i}`, "x"])) });
  assert.deepEqual([Object.keys(stored(full)).length, Object.keys(stored(unsent)).length, Object.keys(stored(crowded)).length], [50, 49, 50]);
  await run();
  assert.equal(smtp.messages.length, 2);
  assert.deepEqual([Object.keys(stored(full)).length, stored(full).email_attempt, stored(full).emailed_at], [50, undefined, "2026-11-19T15:01:00.000Z"]);
  assert.deepEqual([Object.keys(stored(unsent)).length, typeof stored(unsent).email_attempt], [50, "string"]);
  assert.ok(marks(full).a.sent && marks(unsent).a.sent);
  assert.equal(stored(crowded)[MARK], undefined);
  const written = new Set(stripe.calls.filter((c) => c.method === "POST").flatMap((c) => [...new URLSearchParams(c.body).keys()]));
  assert.deepEqual([...written].sort(), ["metadata[email_attempt]", `metadata[${MARK}]`]);
  assert.ok(stripe.calls.filter((c) => c.method === "POST").every((c) => [...new URLSearchParams(c.body).values()].every((value) => value.length <= 500)));
  assert.equal(MARK.length <= 40, true);
  assert.deepEqual(lines, ["reminders 2026-11-22 unmarked 1 sent 2"]);
  const both = JSON.stringify({ a: { n: 3, at: "2026-11-21T22:30:00.000Z", sent: "2026-11-21T22:30:01.000Z" }, b: { n: 3, at: "2026-11-24T22:59:59.000Z", sent: "2026-11-24T22:59:59.999Z" } });
  assert.ok(both.length < 200);
});

await test("the reminder names the bags in a Bags row right after the Passengers row, on the ride out, the return and both rides in one letter, by the hour too, and an old booking without bags or with none chosen shows the plain passenger count", () => {
  setEnv();
  const bagged = (fix, passengers) => ({ ...fix, metadata: { ...fix.metadata, passengers } });
  for (const [fix, legs] of [[JFK, [["a"]]], [ROUND_HOME, [["b"]]], [SAME_DAY, [["a", "b"]]], [HOURLY, [["a"]]]]) {
    const n = fix.metadata.passengers;
    for (const leg of legs) {
      const trip = rowsOf(reminderLetter(paid(bagged(fix, `${n}, 4 large bags, 2 small bags`)), leg));
      const at = trip.indexOf(`Passengers: ${n}`);
      assert.ok(at > 0 && trip[at + 1] === "Bags: 4 large bags and 2 small bags", `${fix.metadata.from_text} ${leg}: ${trip.join(" | ")}`);
      const html = checkLetter(reminderLetter(paid(bagged(fix, `${n}, 4 large bags, 2 small bags`)), leg));
      assert.ok([...html.querySelectorAll("tr")].some((tr) => tr.children[0].textContent === "Bags" && tr.children[1].textContent === "4 large bags and 2 small bags"));
      const plain = rowsOf(reminderLetter(paid(fix), leg));
      assert.ok(plain.includes(`Passengers: ${n}`) && !plain.some((row) => row.startsWith("Bags")), plain.join(" | "));
    }
  }
  assert.ok(rowsOf(reminderLetter(paid(bagged(EWR, "2, 1 large bag")), ["a"])).includes("Bags: 1 large bag"));
});

await test("letters for every pickup type: an address, JFK at the curb, JFK Terminal 5, LaGuardia with a stop, Newark without a flight, meet and greet with the sign name, Teterboro, by the hour from an address and from JFK, and someone else riding", () => {
  setEnv();
  const cases = [
    [ADDRESS, [MAIL.day.pickup], ["Pickup: 253 West 72nd Street, New York, NY 10023", "Drop-off: Newark Liberty (EWR)", "Vehicle: Business SUV", "Passengers: 2"]],
    [JFK, [`${MAIL.where.curb} ${MAIL.day.bags} ${MAIL.day.tracked} ${MAIL.where.landing}`], ["Pickup: John F. Kennedy (JFK), Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", "Flight: DL 401", "Vehicle: Business SUV", "Passengers: 2"]],
    [JFK_T5, [`${MAIL.day.terminals} ${MAIL.day.bags} ${MAIL.day.tracked} ${MAIL.where.landing}`], ["Pickup: John F. Kennedy (JFK), Terminal 5", "Drop-off: 350 5th Ave, New York, NY 10118", "Flight: B6 1234", "Vehicle: Business SUV", "Passengers: 2"]],
    [LGA, [`${MAIL.where.curb} ${MAIL.day.bags} ${MAIL.where.signs} ${MAIL.day.tracked} ${MAIL.where.landing}`], ["Pickup: LaGuardia (LGA)", "Stop 1: 277 Bedford Ave, Brooklyn, NY 11211", "Drop-off: 350 5th Ave, New York, NY 10118", "Flight: AA 100", "Vehicle: Business SUV", "Passengers: 2"]],
    [EWR, [`${MAIL.where.curb} ${MAIL.day.bags} ${MAIL.where.signs}`], ["Pickup: Newark Liberty (EWR)", "Drop-off: 350 5th Ave, New York, NY 10118", "Vehicle: Business SUV", "Passengers: 2"]],
    [MEET, [`${MAIL.where.inside} ${MAIL.day.tracked} ${MAIL.where.landing}`], ["Pickup: John F. Kennedy (JFK), Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", "Flight: DL 401", "Name for the sign: Lopez Family", "Vehicle: Business SUV", "Passengers: 3"]],
    [TEB, [MAIL.where.lobby], ["Pickup: Teterboro (TEB), Atlantic Aviation", "Drop-off: 350 5th Ave, New York, NY 10118", "Vehicle: Business SUV", "Passengers: 2"]],
    [HOURLY, [`${MAIL.where.address} ${fill(MAIL.day.hourly, { who: MAIL.day.you })} ${MAIL.day.long}`], ["Pickup: 1 Main Street, Brooklyn, NY 11201", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Passengers: 1"]],
    [HOURLY_JFK, [`${MAIL.where.inside} ${MAIL.day.tracked} ${fill(MAIL.day.hourly, { who: MAIL.day.you })} ${MAIL.day.long}`], ["Pickup: John F. Kennedy (JFK), Terminal 4", "Flight: BA 117", "Name for the sign: Ana Lopez", "Vehicle: Cadillac Escalade ESV (Business Premium SUV)", "Passengers: 1"]],
    [OTHER, [`${MAIL.where.curbOther} ${MAIL.day.bagsOther} ${MAIL.where.signs} ${MAIL.day.tracked} ${MAIL.where.landing}`], ["Pickup: LaGuardia (LGA)", "Drop-off: 350 5th Ave, New York, NY 10118", "Flight: UA 523", "Vehicle: Business SUV", "Passengers: 2", "Passenger: Ben Ortiz"]],
  ];
  for (const [fix, where, rows] of cases) {
    const session = paid(fix);
    const letter = reminderLetter(session, ["a"]);
    const at = fix.metadata.from_text;
    assert.equal(letter.subject, "Your ride tomorrow, Sun Nov 22, 3:30 PM, NYC LUX RIDE booking 83558982", at);
    assert.deepEqual(letter.to, [{ name: "Ana Lopez", address: "ana.lopez@example.com" }], at);
    assert.deepEqual(letter.replyTo, { name: "NYC LUX RIDE", address: "info@nycluxride.com" }, at);
    assert.deepEqual(whereOf(letter), where, at);
    const trip = rowsOf(letter);
    assert.deepEqual(trip.slice(0, fix === HOURLY || fix === HOURLY_JFK ? 4 : 3), ["Reference: 83558982", ...(fix === HOURLY || fix === HOURLY_JFK ? ["Trip: By the hour, 4 hours"] : []), "Date: Sun, Nov 22, 2026", "Time: 3:30 PM, New York time"], at);
    assert.deepEqual(trip.slice(fix === HOURLY || fix === HOURLY_JFK ? 4 : 3), rows, at);
    assert.ok(letter.text.startsWith("Your ride is tomorrow\n\nWhere to meet your chauffeur\n"), at);
    assert.ok(letter.text.endsWith(`\n\n${fill(MAIL.reminder.help, { phone: "+1 (646) 775-0556" })}\n\n${fill(MAIL.change, { ref: REF })}\nWhatsApp: https://wa.me/16467750556\n${MAIL.rates}: https://www.nycluxride.com/rates#policies\n\nNYC LUX RIDE\n+1 (646) 775-0556\nhttps://www.nycluxride.com\n`), at);
    assert.equal(letter.text.includes("contacts Ben Ortiz on the day of the ride.\n"), fix === OTHER, at);
    assert.doesNotMatch(letter.text, /\$|Paid|Fare|Notes for the chauffeur|ana\.lopez@example\.com|\+1 212 555 0100|\+44 20/, at);
    const doc = checkLetter(letter);
    assert.deepEqual([...doc.querySelectorAll('a[href="https://www.nycluxride.com/rates#policies"]')].map((a) => a.textContent), ["Cancellation, no-show and waiting terms"], at);
    assert.deepEqual([...doc.querySelectorAll("h2")].map((h) => h.textContent), [MAIL.where.heading, MAIL.trip], at);
    assert.equal(doc.querySelector("h1").textContent, "Your ride is tomorrow");
    assert.deepEqual([...doc.querySelectorAll("tr")].map((tr) => `${tr.children[0].textContent}: ${tr.children[1].textContent}`), trip, at);
    const help = [...doc.querySelectorAll("p")].find((p) => p.textContent.startsWith("Call "));
    assert.deepEqual([...help.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]), [["tel:+16467750556", "+1 (646) 775-0556"], ["https://wa.me/16467750556", "WhatsApp"]]);
  }
});

await test("every meeting sentence the reminder adds is the site's own wording, found on a page, and the copy for someone else only swaps you for them", () => {
  const pages = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "test", "scripts", "assets", "fleet", "api"].includes(name) || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".html")) pages.push(readFileSync(full, "utf8").replace(/<[^>]*>/g, "").replace(/&#39;|&rsquo;|’/g, "'").replace(/\s+/g, " "));
    }
  };
  walk(ROOT);
  const site = pages.join("\n");
  const W = MAIL.where;
  for (const sentence of [W.curb, W.inside, W.lobby, W.signs, W.landing, "Call +1 (646) 775-0556 or message us on WhatsApp.", "We answer calls and messages 24 hours a day, every day."]) assert.ok(site.includes(sentence.replace(/\.$/, "")), sentence);
  assert.equal(W.address, MAIL.day.pickup.slice(0, MAIL.day.pickup.indexOf(".") + 1));
  const swap = (s) => s.replace(/\byou\b/g, "them").replace(/\byour bags\b/g, "their bags");
  assert.deepEqual([W.curbOther, W.lobbyOther], [swap(W.curb), swap(W.lobby)]);
  assert.equal(W.insideOther, W.inside.replace("your bags", "their bags"));
  assert.deepEqual([W.terminalsOther, W.farCarOther], [MAIL.day.terminals.replace("your terminal", "their terminal"), W.farCar.replace("your terminal", "their terminal")]);
  assert.equal(W.farCar, MAIL.day.terminals.replace("JFK pickups at Terminals 5 and 7 are", "the car is"));
  assert.equal(MAIL.reminder.other, MAIL.other.slice(0, MAIL.other.indexOf(".") + 1));
  for (const value of [...Object.values(W), ...Object.values(MAIL.reminder)]) assert.doesNotMatch(value, /[—–;]/, value);
});

await test("private aviation and smaller airports: an FBO at Westchester, Stewart or Republic meets in the lobby or at the aircraft, never at a curb, and Islip by the hour says only the bags sentence, in the reminder and the confirmation", () => {
  setEnv();
  const hourly = `${fill(MAIL.day.hourly, { who: MAIL.day.you })} ${MAIL.day.long}`;
  const cases = [
    [FBO_HOURLY, `${MAIL.where.lobby} ${hourly}`],
    [ISP_HOURLY, `${MAIL.day.bags} ${hourly}`],
    [FBO_OTHER, MAIL.where.lobbyOther],
  ];
  for (const [fix, where] of cases) {
    const session = paid(fix);
    const letter = reminderLetter(session, ["a"]);
    assert.deepEqual(whereOf(letter), [where], fix.metadata.from_text);
    assert.deepEqual(sectionOf(bookingLetters(session, { owners: [] }, BOOKED.getTime())[0].text, MAIL.where.heading), [where, fill(MAIL.day.askFlight, { ref: REF })], fix.metadata.from_text);
    assert.ok(!letter.text.includes("curb") && !letter.text.includes("car service pickup area"), fix.metadata.from_text);
    checkLetter(letter);
  }
});

await test("JFK Terminals 5 and 7: with meet and greet the inside sentence comes first and the lot is where the car is, and for someone else the meeting sentences speak of them while flight tracking and free waiting keep the site's one wording", () => {
  setEnv();
  assert.deepEqual(whereOf(reminderLetter(paid(MEET_T5), ["a"])), [`${MAIL.where.inside} ${MAIL.where.farCar} ${MAIL.day.tracked} ${MAIL.where.landing}`]);
  assert.deepEqual(whereOf(reminderLetter(paid(T5_OTHER), ["a"])), [`${MAIL.where.terminalsOther} ${MAIL.day.bagsOther} ${MAIL.day.tracked} ${MAIL.where.landing}`]);
  for (const fix of [T5_OTHER, OTHER]) assert.doesNotMatch(whereOf(reminderLetter(paid(fix), ["a"])).join(" ").replace(MAIL.day.tracked, "").replace(MAIL.where.landing, ""), /\byour (flight|terminal|bags)\b|\bYou get\b/, fix.metadata.from_text);
});

await test("a pickup just after midnight says tonight, with the evening it falls on, and a pickup at 5 AM says tomorrow", () => {
  setEnv();
  const letter = reminderLetter(paid(NIGHT), ["a"]);
  assert.equal(letter.subject, "Your ride tonight after midnight, Sun Nov 22, 12:30 AM, NYC LUX RIDE booking 83558982");
  assert.ok(letter.text.startsWith("Your ride is tonight\n\nYour pickup is at 12:30 AM, after midnight on the night of Sat, Nov 21.\n\nWhere to meet your chauffeur\n"));
  assert.deepEqual(rowsOf(letter).slice(1, 3), ["Date: Sun, Nov 22, 2026", "Time: 12:30 AM, New York time"]);
  const doc = checkLetter(letter);
  assert.equal(doc.querySelector("h1").textContent, MAIL.reminder.headingNight);
  const early = reminderLetter(paid(NIGHT, { metadata: { time: "04:59" } }), ["a"]);
  assert.ok(early.subject.startsWith("Your ride tonight after midnight, Sun Nov 22, 4:59 AM,"));
  const morning = reminderLetter(paid(NIGHT, { metadata: { time: "05:00" } }), ["a"]);
  assert.equal(morning.subject, "Your ride tomorrow, Sun Nov 22, 5:00 AM, NYC LUX RIDE booking 83558982");
  assert.ok(morning.text.startsWith("Your ride is tomorrow\n\nWhere to meet your chauffeur\n"));
  const monthEnd = reminderLetter(paid(NIGHT, { metadata: { date: "2027-01-01", time: "01:15" } }), ["a"]);
  assert.ok(monthEnd.text.includes("\nYour pickup is at 1:15 AM, after midnight on the night of Thu, Dec 31.\n"));
});

await test("the 12 hour cutoff is set from 5 PM, so the 5 PM run and the 6 PM catch-up agree: a booking made 11.5 hours before 5 PM is counted recent by both, and one made 12 hours before is reminded once", async () => {
  setEnv(liveEnv());
  const five = RealDate.parse("2026-11-21T22:00:00.000Z") / 1000;
  const late = paid(JFK, { created: five - 41400 });
  const early = paid(EWR, { created: five - 43200 });
  await run();
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  assert.equal(stored(late)[MARK], undefined);
  assert.ok(marks(early).a.sent);
  assert.deepEqual(lines, ["reminders 2026-11-22 recent 1 sent 1", "reminders 2026-11-22 recent 1 done 1"]);
});

await test("a claim answered 500, which Stripe saves on the key, is claimed again on the next key by the catch-up run, which sends exactly one email", async () => {
  setEnv(liveEnv());
  const session = paid(JFK);
  let first = true;
  stripe.fail = (method, path, key) => (method === "POST" && key === `nlr-remind-${session.id}-a-1` && first ? ((first = false), 500) : 0);
  await run();
  assert.equal(smtp.messages.length, 0);
  assert.equal(stored(session)[MARK], undefined);
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual([marks(session).a.n, Boolean(marks(session).a.sent)], [2, true]);
  assert.deepEqual(lines, ["reminders 2026-11-22 failed 1", "reminders 2026-11-22 sent 1"]);
  assert.deepEqual(stripe.calls.filter((c) => c.method === "POST").map((c) => c.idempotency.slice(`nlr-remind-${session.id}`.length)), ["-a-1", "-a-1", "-a-1", "-a-2", "-a-2-sent"]);
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
});

await test("a failed mark after a refusal before DATA, answered 500 and saved by Stripe, is written on a second key so the catch-up run still sends once", async () => {
  setEnv(liveEnv());
  const session = paid(JFK);
  smtp.behavior.auth = () => "454 4.7.0 Temporary authentication failure";
  stripe.fail = (method, path, key) => (method === "POST" && key === `nlr-remind-${session.id}-a-1-failed` ? 500 : 0);
  await run();
  assert.deepEqual([smtp.messages.length, marks(session).a.failed], [0, 1]);
  smtp.behavior = {};
  stripe.fail = null;
  await run(CATCH_UP);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual([marks(session).a.n, Boolean(marks(session).a.sent)], [2, true]);
});

await test("an event Google has purged long after the owner deleted it answers 404 and is reminded, which is why the owner cancels by adding CANCELLED: to the title and keeps the event", async () => {
  setEnv(liveEnv(GCAL));
  const purged = paid(JFK);
  const marked = paid(LGA);
  const event = (session) => bookingEvents(stripe.sessions.get(session.id))[0];
  google.events.set(event(marked).id, { ...event(marked), summary: `${CALENDAR.cancelled}${event(marked).summary}` });
  await run();
  assert.deepEqual(google.calls.filter((c) => c.stage === "events").map((c) => c.path.endsWith(`/events/${encodeURIComponent(event(purged).id)}`) || c.path.endsWith(`/events/${encodeURIComponent(event(marked).id)}`)), [true, true]);
  assert.equal(smtp.messages.length, 1);
  assert.ok(marks(purged).a.sent);
  assert.equal(stored(marked)[MARK], undefined);
  assert.deepEqual(lines, ["reminders 2026-11-22 cancelled 1 sent 1"]);
});

await test("no customer data in the logs: each run writes one short line of counts, never a name, email, phone, address, flight, reference or session id", async () => {
  setEnv(liveEnv(GCAL));
  const sessions = [paid(OTHER), paid(MEET), paid(ROUND), paid(ROUND_HOME, { metadata: { [MARK]: JSON.stringify({ b: { n: 1, at: "2026-11-21T22:00:00.000Z", id: "a1b2c3d4e5f6" } }) } })];
  smtp.behavior.refuse = (mail) => (parse(mail.data).text.includes("Ben Ortiz") ? "451 4.3.0 Try later" : "");
  await run();
  await run(CATCH_UP);
  await run("2026-11-21T21:30:00.000Z");
  assert.equal(lines.length, 3);
  const needles = [REF, "Ana", "Lopez", "Ben", "Ortiz", "ana.lopez", "example.com", "212", "7946", "5th Ave", "Terminal", "DL 401", "UA 523", "Lopez Family", "cs_live", "pi_", OIDC.slice(0, 20), ACCESS_TOKEN, KEY, CRON, PASS];
  for (const line of lines) {
    assert.ok(line.length <= 120, line);
    for (const needle of needles) assert.ok(!line.includes(needle), `${needle} in ${line}`);
  }
  assert.deepEqual(lines, ["reminders 2026-11-22 claimed 1 sent 2 reached 1", "reminders 2026-11-22 claimed 1 done 3", "reminders-off hour 16"]);
  assert.equal(sessions.length, 4);
});

await test("mail or Stripe not set up: the run answers 204 with one line and sends nothing, and a test key on production or a broken mail setting answers 500", async () => {
  for (const [env, status, line] of [
    [liveEnv({ SMTP_USER: "" }), 204, "reminders-off mail"],
    [liveEnv({ STRIPE_SECRET_KEY: "" }), 204, "reminders-off stripe"],
    [liveEnv({ STRIPE_SECRET_KEY: ["rk", "test", "51NlrReminderTestKeyOnly"].join("_") }), 500, "reminders-fail key-environment"],
    [liveEnv({ SMTP_PORT: "99999" }), 500, "reminders-fail mail-settings"],
  ]) {
    setEnv(env);
    paid(JFK);
    const res = await run();
    assert.equal(res.status, status, line);
    assert.deepEqual([stripe.calls.length, smtp.sessions, lines], [0, 0, [line]]);
  }
});

smtp.server.close();
if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.stdout.write(`\n${failures} ride reminder test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll ride reminder tests passed\n");
process.exit(0);
