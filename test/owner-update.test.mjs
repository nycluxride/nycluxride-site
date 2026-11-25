import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, getCACertificates, setDefaultCACertificates } from "node:tls";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as route from "../api/owner-update.mjs";

const { GET } = route;
const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const RealDate = Date;
const SEND = "2026-11-25T17:00:00.000Z";
const CRON = `cron-${createHash("sha256").update("owner update cron").digest("hex").slice(0, 32)}`;
const USER = "info@nycluxride.com";
const PASS = `pw-${createHash("sha256").update("owner update smtp").digest("hex").slice(0, 16)}`;
const ENV_KEYS = ["CRON_SECRET", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "VERCEL_ENV"];
const LINES = [
  "Assalamu Alaikum,",
  "",
  "These are now live on www.nycluxride.com:",
  "- Child seats and dogs are chosen on the first step, next to passengers and bags.",
  "- Car seats are $20 each.",
  "- Every car photo in the booking form is a studio shot on a white background.",
  "- Booking is now two steps, with a shorter payment box. The cancellation terms fold under \"Cancellation and terms\" next to the pay button.",
  "- A page for each of the 21 New Jersey counties with every town you sent, and Signature Newark on the Newark Airport and private jet pages.",
  "",
  "One thing to check: on your phone, book a test ride at www.nycluxride.com/book up to the pay button, without paying. Reply OK, or tell me what to change.",
  "",
  "Your to-do list. Only you can do these because they need your accounts.",
  "",
  "1. Google reviews (most important). Send your Google review link to every rider 2 to 4 hours after the ride. Reply to each review within two days and name the trip, for example \"Thank you for riding with us from Morristown to Newark.\" Never offer anything for a review.",
  "",
  "2. Google service areas. In Google Maps tap Business, then Edit profile, Location, Service area. Remove all, then add these 20: Manhattan, Brooklyn, Queens, Bronx, Staten Island, Nassau County NY, Suffolk County NY, Westchester County NY, Fairfield County CT, and in New Jersey the Bergen, Hudson, Essex, Union, Middlesex, Morris, Passaic, Somerset, Monmouth, Ocean and Mercer counties.",
  "",
  "3. Google categories. Primary: Limousine service. Additional: Chauffeur service. Nothing else.",
  "",
  "4. Google services. Under Edit services add Private jet and FBO transportation, New Jersey car service, Long-distance car service and Roadshow transportation. Set your car seat service to $20 per seat.",
  "",
  "5. Free listings. Claim your business on Data Axle (local-listings.data-axle.com), Foursquare (business.foursquare.com), Bing Places (bingplaces.com) and Yelp (biz.yelp.com). Use exactly: NYC LUX RIDE, (646) 775-0556, https://www.nycluxride.com/, open 24 hours.",
  "",
  "6. Private jet terminals. Ask each front desk to add you to their car service list and to link nycluxride.com/private-jet-car-service-nyc: Signature Newark (973 624 1660), Signature Morristown (973 292 1300), Atlantic Morristown (973 401 1900), and the Teterboro terminals (Atlantic, Jet Aviation and Signature).",
  "",
  "7. Old website. Ask Muhammad Bassam Khuram for access to nyc-lux-ride.com so it can send its visitors to nycluxride.com.",
  "",
  "JazakAllah Khair,",
  "Ali",
];

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

const certDir = mkdtempSync(join(tmpdir(), "nlr-owner-update-test-"));
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

globalThis.fetch = async (url) => {
  throw new Error(`a request went to ${new URL(String(url)).origin}`);
};

const smtp = await fakeSmtp();
function setEnv(vars = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  lines.length = 0;
  smtp.messages.length = 0;
  smtp.behavior = {};
  smtp.sessions = 0;
}
const liveEnv = (extra = {}) => ({ CRON_SECRET: CRON, VERCEL_ENV: "production", SMTP_USER: USER, SMTP_PASS: PASS, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), ...extra });

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
const run = (iso = SEND, headers = { authorization: `Bearer ${CRON}` }) => at(iso, () => GET(new Request("https://www.nycluxride.com/api/owner-update", { headers })));

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

await test("the route answers GET only and nothing else is exported", () => {
  assert.deepEqual(Object.keys(route), ["GET"]);
});

await test("without the cron bearer the route answers 401 on the send day and opens no mail connection: no header, a wrong secret, lowercase bearer, a bare secret, a secret one character short of 32, a secret with a space, an empty and an unset CRON_SECRET", async () => {
  const short = CRON.slice(0, 31);
  const spaced = `${CRON.slice(0, 20)} ${CRON.slice(20)}`;
  const cases = [
    [liveEnv(), {}],
    [liveEnv(), { authorization: `Bearer ${CRON}x` }],
    [liveEnv(), { authorization: `Bearer ${CRON.slice(0, -1)}` }],
    [liveEnv(), { authorization: `bearer ${CRON}` }],
    [liveEnv(), { authorization: CRON }],
    [liveEnv({ CRON_SECRET: short }), { authorization: `Bearer ${short}` }],
    [liveEnv({ CRON_SECRET: spaced }), { authorization: `Bearer ${spaced}` }],
    [liveEnv({ CRON_SECRET: "" }), { authorization: "Bearer " }],
    [{ ...liveEnv(), CRON_SECRET: undefined }, { authorization: "Bearer undefined" }],
  ];
  for (const [env, headers] of cases) {
    setEnv(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)));
    const res = await run(SEND, headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(await res.json(), { kind: "unauthorized" });
    assert.deepEqual([smtp.sessions, smtp.messages.length, lines.length], [0, 0, 0], JSON.stringify(headers));
  }
});

await test("the 17:00 UTC cron lands at noon in New York on November 25, 2026", () => {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(SEND));
  assert.equal(hour, "11/25/2026, 12");
});

await test("on every other New York day the route answers 204 with no body, opens no mail connection and logs nothing", async () => {
  for (const iso of ["2026-11-24T17:00:00.000Z", "2026-11-25T04:59:59.000Z", "2026-11-26T05:00:00.000Z", "2026-11-26T17:00:00.000Z", "2026-11-22T17:00:00.000Z", "2027-11-25T17:00:00.000Z", "2025-11-25T17:00:00.000Z"]) {
    setEnv(liveEnv());
    const res = await run(iso);
    assert.equal(res.status, 204, iso);
    assert.equal(res.headers.get("cache-control"), "no-store", iso);
    assert.equal(await res.text(), "", iso);
    assert.deepEqual([smtp.sessions, smtp.messages.length, lines], [0, 0, []], iso);
  }
});

await test("on November 25 in New York, from midnight to 11:59 PM, the route sends one email to info@nycluxride.com only and logs owner-update-sent", async () => {
  for (const iso of [SEND, "2026-11-25T05:00:00.000Z", "2026-11-26T04:59:59.000Z"]) {
    setEnv(liveEnv());
    const res = await run(iso);
    assert.equal(res.status, 200, iso);
    assert.deepEqual(await res.json(), { kind: "sent" });
    assert.equal(smtp.sessions, 1, iso);
    assert.equal(smtp.messages.length, 1, iso);
    assert.deepEqual(smtp.messages[0].to, ["info@nycluxride.com"], iso);
    assert.equal(smtp.messages[0].from, "info@nycluxride.com", iso);
    assert.deepEqual(lines, ["owner-update-sent"], iso);
  }
});

await test("the email has the subject, the message id, the exact lines as text and the same lines as simple HTML paragraphs", async () => {
  setEnv(liveEnv());
  await run();
  const { headers, text, html } = parse(smtp.messages[0].data);
  assert.equal(headers.get("to"), "info@nycluxride.com");
  assert.equal(headers.get("subject"), "Website updates and a short to-do list");
  assert.equal(headers.get("message-id"), "<owner-update.20261125b@nycluxride.com>");
  assert.equal(headers.get("from"), "\"NYC LUX RIDE\" <info@nycluxride.com>");
  assert.equal(headers.has("cc") || headers.has("bcc") || headers.has("reply-to"), false);
  assert.equal(text, LINES.join("\n"));
  assert.equal(html, `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${LINES.filter(Boolean).map((l) => `<p style="margin:0 0 10px">${l.replace(/"/g, "&quot;")}</p>`).join("")}</body></html>`);
  const { document } = new JSDOM(html).window;
  assert.deepEqual([...document.querySelectorAll("p")].map((p) => p.textContent), LINES.filter(Boolean));
  assert.equal(document.querySelectorAll("a, img, script, link, style, iframe, form").length, 0);
});

await test("the subject and the lines hold no em dash, en dash or semicolon", async () => {
  setEnv(liveEnv());
  await run();
  const { headers, text, html } = parse(smtp.messages[0].data);
  const { document } = new JSDOM(html).window;
  for (const value of [headers.get("subject"), ...text.split("\n"), document.body.textContent]) assert.doesNotMatch(value, /[–—;]/, value);
  assert.deepEqual(LINES.filter((l) => /^\d+\. /.test(l)).map((l) => l.split(".")[0]), ["1", "2", "3", "4", "5", "6", "7"]);
});

await test("mail not set up or broken answers 500 with one line and opens no mail connection, and an SMTP refusal answers 500 with the stage and code", async () => {
  for (const [env, line] of [
    [liveEnv({ SMTP_USER: "" }), "owner-update-fail mail-settings"],
    [liveEnv({ SMTP_PASS: "" }), "owner-update-fail mail-settings"],
    [liveEnv({ SMTP_PORT: "99999" }), "owner-update-fail mail-settings"],
  ]) {
    setEnv(env);
    const res = await run();
    assert.equal(res.status, 500, line);
    assert.deepEqual(await res.json(), { kind: "error" });
    assert.deepEqual([smtp.sessions, lines], [0, [line]]);
  }
  setEnv(liveEnv());
  smtp.behavior.auth = () => "454 4.7.0 Temporary authentication failure";
  const res = await run();
  assert.equal(res.status, 500);
  assert.deepEqual([smtp.messages.length, lines], [0, ["owner-update-fail smtp auth 454"]]);
});

await test("no log line carries the cron secret or the SMTP password", async () => {
  setEnv(liveEnv());
  await run();
  await run(SEND, { authorization: `Bearer ${CRON}x` });
  smtp.behavior.auth = () => "535 5.7.8 Bad credentials";
  await run();
  assert.ok(lines.length >= 2);
  for (const line of lines) for (const needle of [CRON, PASS]) assert.ok(!line.includes(needle), line);
});

await test("the route file is registered with the static suite and a daily cron, and holds no comment", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  assert.deepEqual(config.crons.filter((c) => c.path === "/api/owner-update"), [{ path: "/api/owner-update", schedule: "0 17 * * *" }]);
  assert.match(readFileSync(join(ROOT, "test", "run-all.mjs"), "utf8"), /\n  "owner-update",\n/);
  assert.doesNotMatch(readFileSync(join(ROOT, "api", "owner-update.mjs"), "utf8"), /^\s*\/\/|\/\*/m);
});

smtp.server.close();
if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.stdout.write(`\n${failures} owner update test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll owner update tests passed\n");
process.exit(0);
