import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, getCACertificates, setDefaultCACertificates } from "node:tls";
import { createServer as createNetServer } from "node:net";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import * as route from "../api/seo-weekly.mjs";
import { windows, pageName, change, cronAllowed } from "../api/_seo.mjs";
import { SEO } from "../api/_copy.mjs";

const { GET } = route;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const OIDC = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: "https://oidc.vercel.com/nlr", sub: "owner:nlr:project:site:environment:production" })}.${Buffer.from("seo test signature").toString("base64url")}`;
const ENV_OIDC = `${b64({ alg: "RS256" })}.${b64({ sub: "from the environment" })}.${Buffer.from("env signature").toString("base64url")}`;
const STS_TOKEN = `ya29.sts-${createHash("sha256").update("seo sts").digest("hex").slice(0, 24)}`;
const ACCESS_TOKEN = `ya29.sa-${createHash("sha256").update("seo sa").digest("hex").slice(0, 24)}`;
const CRON = `cron-${createHash("sha256").update("seo cron").digest("hex").slice(0, 32)}`;
const USER = "info@nycluxride.com";
const PASS = `pw-${createHash("sha256").update("seo smtp").digest("hex").slice(0, 16)}`;
const OWNERS = ["info@nycluxride.com", "nycluxride@gmail.com"];
const SITE = "https://www.nycluxride.com/";
const SEO_ENV = { SEO_GSC_SERVICE_ACCOUNT: "nlr-search@nlr-test-000000.iam.gserviceaccount.com", SEO_GSC_SITE: SITE, GCAL_WIF_AUDIENCE: "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/nycluxride" };
const ENV_KEYS = ["CRON_SECRET", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "OWNER_EMAILS", "VERCEL_OIDC_TOKEN", "GCAL_CALENDAR_ID", "GCAL_SERVICE_ACCOUNT", ...Object.keys(SEO_ENV)];
const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_URL = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SEO_ENV.SEO_GSC_SERVICE_ACCOUNT}:generateAccessToken`;
const QUERY_URL = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
const BRAND = [{ filters: [{ dimension: "query", operator: "includingRegex", expression: "(?i)lux ?ride" }] }];

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
const allLogged = [];
const allNoted = [];
console.error = (...args) => {
  logged.push(args.map(String).join(" "));
  allLogged.push(logged.at(-1));
};
console.log = (...args) => {
  noted.push(args.map(String).join(" "));
  allNoted.push(noted.at(-1));
};

const certDir = mkdtempSync(join(tmpdir(), "nlr-seo-test-"));
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

const row = (key, clicks, impressions, position) => ({ keys: [key], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
const total = (clicks, impressions, position) => [{ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position }];
const page = (path) => `https://www.nycluxride.com${path}`;
const FILLERS = Array.from({ length: 8 }, (_, i) => row(`filler search ${i + 1}`, 0, 20 - i, 50));
const SAMPLE = {
  week: total(469, 10000, 8),
  prior: total(400, 9600, 9),
  weekBrand: total(57, 130, 1.2),
  priorBrand: total(51, 110, 1.1),
  queries: [
    row("nyc lux ride", 40, 90, 1.1),
    row("black car service nyc", 40, 900, 6.2),
    row("nyc luxury car service", 30, 700, 5.5),
    row("jfk car service", 25, 1200, 9.4),
    row("lga car service", 25, 600, 3.1),
    row("luxride", 17, 40, 1.3),
    row("limo service queens", 3, 85, 11.3),
    row("car service", 0, 400, 35),
    row("chauffeur nyc", 0, 9, 7),
    ...FILLERS,
  ],
  pages: [row(page("/locations/jfk-airport"), 60, 2000, 7), row(page("/"), 120, 3000, 4), row(page("/services#airport-transfers"), 5, 100, 9), row(page("/blog/corporate-black-car-nyc-april-3"), 2, 50, 12)],
  recent: [row(page("/"), 400, 11000, 4), row(page("/black-car-service-brooklyn"), 1, 34, 14), row(page("/locations/jfk-airport"), 200, 8000, 7), row(page("/car-service-with-car-seat-nyc"), 0, 12, 22)],
  older: [row(page("/"), 3000, 90000, 5), row(page("/locations/jfk-airport"), 900, 30000, 8), row(page("/services#airport-transfers"), 10, 300, 9)],
};
const EMPTY = { week: [], prior: [], weekBrand: [], priorBrand: [], queries: [], pages: [], recent: [], older: [] };

const google = { calls: [], data: SAMPLE, fail: null, thrown: null };
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function which(ask, when) {
  const range = `${ask.startDate} ${ask.endDate}`;
  const branded = Boolean(ask.dimensionFilterGroups);
  if (!ask.dimensions) return range === when.week.join(" ") ? (branded ? "weekBrand" : "week") : branded ? "priorBrand" : "prior";
  if (ask.dimensions[0] === "query") return "queries";
  if (range === when.week.join(" ")) return "pages";
  return range === when.recent.join(" ") ? "recent" : "older";
}

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  if (!/(^|\.)googleapis\.com$/.test(target.hostname)) throw new Error(`a request went to ${target.origin}`);
  const headers = new Headers(init.headers);
  const body = String(init.body || "");
  const stage = target.origin === "https://sts.googleapis.com" ? "sts" : target.origin === "https://iamcredentials.googleapis.com" ? "iam" : "search";
  google.calls.push({ url: target.href, method: init.method || "GET", headers, body, stage, signal: init.signal });
  if (google.thrown === stage) throw new TypeError("fetch failed");
  const failed = google.fail && google.fail(stage, body);
  if (failed) return answer(failed, { error: { code: failed, message: `${stage} said no`, status: "PERMISSION_DENIED" } });
  if (stage === "sts") return answer(200, { access_token: STS_TOKEN, issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 3599 });
  if (stage === "iam") return answer(200, { accessToken: ACCESS_TOKEN, expireTime: "2026-11-23T13:05:00Z" });
  const rows = google.data[which(JSON.parse(body), expectedWindows())];
  return answer(200, rows.length ? { rows, responseAggregationType: "byProperty" } : { responseAggregationType: "byProperty" });
};

const smtp = await fakeSmtp();
const closed = await new Promise((resolve) => {
  const server = createNetServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

function setEnv(values) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}
const fullEnv = (extra = {}) => ({ CRON_SECRET: CRON, SMTP_USER: USER, SMTP_PASS: PASS, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), ...SEO_ENV, ...extra });

function reset(values = fullEnv()) {
  setEnv(values);
  google.calls.length = 0;
  google.data = SAMPLE;
  google.fail = null;
  google.thrown = null;
  smtp.messages.length = 0;
  smtp.behavior = {};
  logged.length = 0;
  noted.length = 0;
}

const request = (headers = { authorization: `Bearer ${CRON}`, "x-vercel-oidc-token": OIDC }, method = "GET") => new Request("https://www.nycluxride.com/api/seo-weekly", { method, headers });

const pacificToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dayShift = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function expectedWindows() {
  const end = dayShift(pacificToday(), -3);
  const recent = dayShift(end, -27);
  return { week: [dayShift(end, -6), end], prior: [dayShift(end, -13), dayShift(end, -7)], recent: [recent, end], older: [dayShift(recent, -481), dayShift(recent, -1)] };
}

function parse(data) {
  const [head, ...rest] = data.split("\r\n\r\n");
  const headers = {};
  for (const line of head.replace(/\r\n /g, " ").split("\r\n")) {
    const at = line.indexOf(":");
    headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
  }
  const boundary = /boundary="([^"]+)"/.exec(headers["content-type"])[1];
  const parts = rest.join("\r\n\r\n").split(`--${boundary}`).slice(1, -1).map((part) => {
    const [partHead, ...partBody] = part.replace(/^\r\n/, "").split("\r\n\r\n");
    return { type: /Content-Type: ([^;]+)/.exec(partHead)[1], body: Buffer.from(partBody.join("").replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n") };
  });
  return { headers, text: parts.find((p) => p.type === "text/plain").body, html: parts.find((p) => p.type === "text/html").body };
}
const sent = () => smtp.messages.map((m) => ({ ...m, mail: parse(m.data) }));
const secretsIn = (lines) => lines.filter((line) => [CRON, OIDC, ENV_OIDC, STS_TOKEN, ACCESS_TOKEN, PASS, SEO_ENV.SEO_GSC_SERVICE_ACCOUNT].some((secret) => line.includes(secret)));

await test("the route answers GET only: no other method is exported", () => {
  assert.deepEqual(Object.keys(route), ["GET"]);
});

await test("without an Authorization header, or with a wrong bearer, the route answers 401 and does no work", async () => {
  for (const headers of [{}, { authorization: "Bearer" }, { authorization: `Bearer ${CRON}x` }, { authorization: `Bearer ${CRON.slice(0, -1)}` }, { authorization: `bearer ${CRON}` }, { authorization: CRON }, { authorization: `Basic ${CRON}` }, { "x-vercel-cron": "1", "user-agent": "vercel-cron/1.0" }]) {
    reset();
    const res = await GET(request({ ...headers, "x-vercel-oidc-token": OIDC }));
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.equal(google.calls.length, 0);
    assert.equal(smtp.messages.length, 0);
    assert.deepEqual(logged, []);
  }
});

await test("when CRON_SECRET is unset, empty, shorter than 16 characters or holds a space, the route answers 401 even to a matching bearer", async () => {
  for (const secret of [undefined, "", "short-secret-15", `${CRON.slice(0, 10)} ${CRON.slice(10)}`]) {
    const env = fullEnv();
    if (secret === undefined) delete env.CRON_SECRET;
    else env.CRON_SECRET = secret;
    reset(env);
    for (const auth of ["Bearer ", `Bearer ${secret}`, "Bearer undefined"]) {
      const res = await GET(request({ authorization: auth, "x-vercel-oidc-token": OIDC }));
      assert.equal(res.status, 401, `${secret} ${auth}`);
    }
    assert.equal(google.calls.length, 0);
    assert.equal(smtp.messages.length, 0);
  }
});

await test("the bearer check compares the whole header and accepts exactly Bearer and CRON_SECRET", () => {
  reset();
  assert.equal(cronAllowed(request({ authorization: `Bearer ${CRON}` })), true);
  assert.equal(cronAllowed(request({ authorization: `Bearer ${CRON} ` })), true, "Headers trims trailing spaces before the route sees them");
  assert.equal(cronAllowed(request({ authorization: `Bearer ${CRON}${CRON}` })), false);
  assert.equal(cronAllowed(request({ authorization: `Bearer  ${CRON}` })), false);
});

await test("the route is off with 204 and no request or email unless SEO_GSC_SERVICE_ACCOUNT, SEO_GSC_SITE and GCAL_WIF_AUDIENCE are all set", async () => {
  for (const missing of Object.keys(SEO_ENV)) {
    const env = fullEnv();
    delete env[missing];
    reset(env);
    const res = await GET(request());
    assert.equal(res.status, 204, missing);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(await res.text(), "");
    assert.equal(google.calls.length, 0);
    assert.equal(smtp.messages.length, 0);
    assert.deepEqual(logged, []);
  }
});

await test("a malformed service account, site or audience answers 500 with one log line and no request", async () => {
  for (const [key, value] of [["SEO_GSC_SERVICE_ACCOUNT", "someone@gmail.com"], ["SEO_GSC_SITE", "https://www.nycluxride.com"], ["SEO_GSC_SITE", "http://www.nycluxride.com/"], ["GCAL_WIF_AUDIENCE", "projects/1/pools/x"]]) {
    reset(fullEnv({ [key]: value }));
    const res = await GET(request());
    assert.equal(res.status, 500, `${key} ${value}`);
    assert.deepEqual(logged, ["seo-fail settings"]);
    assert.equal(google.calls.length, 0);
  }
});

await test("with the search settings on and no mail settings, the route answers 500 and asks Google nothing", async () => {
  const env = fullEnv();
  delete env.SMTP_PASS;
  reset(env);
  const res = await GET(request());
  assert.equal(res.status, 500);
  assert.deepEqual(logged, ["seo-fail mail-settings"]);
  assert.equal(google.calls.length, 0);
});

await test("with no Vercel OIDC token in the header or the environment, the route answers 500 and asks Google nothing", async () => {
  reset();
  const res = await GET(request({ authorization: `Bearer ${CRON}`, "x-vercel-oidc-token": "not a token" }));
  assert.equal(res.status, 500);
  assert.deepEqual(logged, ["seo-fail token"]);
  assert.equal(google.calls.length, 0);
});

await test("the exact STS exchange, IAM generateAccessToken and eight Search Console queries, in that order", async () => {
  reset();
  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { kind: "sent" });
  assert.equal(google.calls.length, 10);
  const [sts, iam, ...queries] = google.calls;
  assert.equal(sts.url, STS_URL);
  assert.equal(sts.method, "POST");
  assert.equal(sts.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(sts.headers.get("authorization"), null);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(sts.body)), {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: SEO_ENV.GCAL_WIF_AUDIENCE,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    subject_token: OIDC,
  });
  assert.equal(iam.url, IAM_URL);
  assert.equal(iam.method, "POST");
  assert.equal(iam.headers.get("authorization"), `Bearer ${STS_TOKEN}`);
  assert.deepEqual(JSON.parse(iam.body), { scope: ["https://www.googleapis.com/auth/webmasters.readonly"], lifetime: "300s" });
  const when = expectedWindows();
  const range = ([startDate, endDate]) => ({ startDate, endDate, type: "web" });
  assert.deepEqual(
    queries.map((q) => JSON.parse(q.body)),
    [
      range(when.week),
      range(when.prior),
      { ...range(when.week), dimensionFilterGroups: BRAND },
      { ...range(when.prior), dimensionFilterGroups: BRAND },
      { ...range(when.week), dimensions: ["query"], rowLimit: 1000 },
      { ...range(when.week), dimensions: ["page"], rowLimit: 1000 },
      { ...range(when.recent), dimensions: ["page"], rowLimit: 1000 },
      { ...range(when.older), dimensions: ["page"], rowLimit: 25000 },
    ],
  );
  for (const q of queries) {
    assert.equal(q.url, QUERY_URL);
    assert.equal(q.method, "POST");
    assert.equal(q.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.equal(q.headers.get("content-type"), "application/json");
    assert.ok(q.signal instanceof AbortSignal);
  }
});

await test("without the header, the token comes from VERCEL_OIDC_TOKEN, and a domain property is sent encoded in the path", async () => {
  reset(fullEnv({ VERCEL_OIDC_TOKEN: ENV_OIDC, SEO_GSC_SITE: "sc-domain:nycluxride.com" }));
  const res = await GET(request({ authorization: `Bearer ${CRON}` }));
  assert.equal(res.status, 200);
  assert.equal(new URLSearchParams(google.calls[0].body).get("subject_token"), ENV_OIDC);
  assert.equal(google.calls[2].url, "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Anycluxride.com/searchAnalytics/query");
});

await test("the date windows: 7 days ending 3 days before today in Google's Pacific day, the 7 before, the last 28 days and 480 days before them", () => {
  assert.deepEqual(windows(new Date("2026-11-23T13:00:00Z")), { week: ["2026-11-14", "2026-11-20"], prior: ["2026-11-07", "2026-11-13"], recent: ["2026-10-24", "2026-11-20"], older: ["2025-06-30", "2026-10-23"] });
  assert.deepEqual(windows(new Date("2026-07-06T13:00:00Z")).week, ["2026-06-27", "2026-07-03"]);
  assert.deepEqual(windows(new Date("2026-03-09T13:00:00Z")).week, ["2026-02-28", "2026-03-06"]);
  assert.deepEqual(windows(new Date("2026-11-24T05:00:00Z")).week, ["2026-11-14", "2026-11-20"], "05:00 UTC Tuesday is still Monday in California");
});

await test("one email to the owner inboxes with the sample numbers, the change, the brand split and the lists", async () => {
  reset();
  const res = await GET(request());
  assert.equal(res.status, 200);
  const mails = sent();
  assert.equal(mails.length, 1);
  const [{ from, to, mail }] = mails;
  assert.equal(from, "info@nycluxride.com");
  assert.deepEqual(to, OWNERS);
  assert.equal(mail.headers.subject, "Google search this week: 412 clicks, up 18%");
  assert.equal(mail.headers.from, '"NYC LUX RIDE" <info@nycluxride.com>');
  assert.equal(mail.headers.to, OWNERS.join(", "));
  assert.equal(mail.headers["reply-to"], undefined);
  assert.equal(mail.headers["auto-submitted"], "auto-generated");
  const when = expectedWindows();
  const short = (day) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T00:00:00Z`));
  const lines = mail.text.split("\n");
  assert.deepEqual(lines.slice(0, 10), [
    "Your Google search week",
    "",
    `${short(when.week[0])} to ${short(when.week[1])}, compared with the 7 days before. Google shares these numbers about 3 days late.`,
    "",
    "This week",
    "Clicks from Google: 412, up 18%",
    "Times the site showed in Google: 9,870, up 4%",
    "Share of people who clicked: 4.2%, was 3.7%",
    "Average spot in the results: 8.1, closer to the top than 9.1",
    "Searches for your name: 57 clicks, kept out of the numbers above",
  ]);
  const HEADINGS = ["Top searches", "Top pages", "Close to page one", "New pages in Google", "If the numbers drop"];
  assert.deepEqual(lines.filter((line) => HEADINGS.includes(line)), HEADINGS);
  const section = (heading) => {
    const at = lines.indexOf(heading);
    const end = lines.findIndex((line, i) => i > at && HEADINGS.includes(line));
    return lines.slice(at + 1, end).filter(Boolean);
  };
  assert.deepEqual(section("Top searches"), [
    '1. "black car service nyc"', "   40 clicks, shown 900 times, spot 6.2",
    '2. "nyc luxury car service"', "   30 clicks, shown 700 times, spot 5.5",
    '3. "jfk car service"', "   25 clicks, shown 1,200 times, spot 9.4",
    '4. "lga car service"', "   25 clicks, shown 600 times, spot 3.1",
    '5. "limo service queens"', "   3 clicks, shown 85 times, spot 11.3",
    '6. "car service"', "   0 clicks, shown 400 times, spot 35.0",
    '7. "filler search 1"', "   0 clicks, shown 20 times, spot 50.0",
    '8. "filler search 2"', "   0 clicks, shown 19 times, spot 50.0",
    '9. "filler search 3"', "   0 clicks, shown 18 times, spot 50.0",
    '10. "filler search 4"', "   0 clicks, shown 17 times, spot 50.0",
  ]);
  assert.deepEqual(section("Top pages"), ["1. Home page", "   120 clicks, shown 3,000 times", "2. JFK Airport", "   60 clicks, shown 2,000 times", "3. Services, Airport Transfers section", "   5 clicks, shown 100 times", "4. Blog post: Corporate Black Car NYC April 3", "   2 clicks, shown 50 times"]);
  assert.deepEqual(section("Close to page one"), ["These searches put the site in spots 4 to 20. They are the easiest to move up.", '1. "jfk car service"', "   25 clicks, shown 1,200 times, spot 9.4", '2. "black car service nyc"', "   40 clicks, shown 900 times, spot 6.2", '3. "nyc luxury car service"', "   30 clicks, shown 700 times, spot 5.5", '4. "limo service queens"', "   3 clicks, shown 85 times, spot 11.3"]);
  assert.deepEqual(section("New pages in Google"), ["Pages Google started showing in the last 4 weeks.", "1. Black Car Service Brooklyn", "   1 click, shown 34 times", "2. Car Service With Car Seat NYC", "   0 clicks, shown 12 times"]);
  assert.ok(mail.text.includes("If the numbers drop\nDo nothing. Search numbers go up and down from week to week. Look into it only if clicks fall three weeks in a row."));
  assert.ok(mail.text.includes(`Open Search Console: https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(SITE)}`));
  assert.doesNotMatch(mail.text, /nyc lux ride"|"luxride"/);
  assert.doesNotMatch("nyc luxury car service", new RegExp(BRAND[0].filters[0].expression.replace("(?i)", ""), "i"), "a generic luxury search is not a search for the name");
  for (const body of [mail.text, mail.html.replace(/<[^>]*>/g, " ").replace(/&#\d+;/g, "'"), mail.headers.subject]) assert.doesNotMatch(body, /[–—;]/, "no dash or semicolon in the email copy");
  assert.ok(mail.html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.ok(mail.html.includes("max-width:600px"));
  assert.ok(mail.html.includes("<li style=\"margin:0 0 10px\"><strong>&#34;black car service nyc&#34;</strong><br>40 clicks, shown 900 times, spot 6.2</li>"));
  assert.ok(mail.html.includes("<strong>Services, Airport Transfers section</strong>"));
  assert.equal((mail.html.match(/<table/g) || []).length, 1, "one two column table, the rest are lists");
  assert.deepEqual(noted, [`seo-sent ${when.week[1]} 412`]);
  assert.deepEqual(logged, []);
});

await test("a query or page with markup is escaped in the HTML email", async () => {
  reset();
  google.data = { ...SAMPLE, queries: [row("<b>car</b> & \"limo\"", 5, 50, 8)], pages: [row(page("/a<b>"), 1, 10, 3)] };
  await GET(request());
  const [{ mail }] = sent();
  assert.ok(mail.html.includes("&#34;&#60;b&#62;car&#60;/b&#62; &#38; &#34;limo&#34;&#34;"));
  assert.doesNotMatch(mail.html, /<b>car/);
});

await test("a week with no data sends a short email that says so, with zero numbers and empty lists", async () => {
  reset();
  google.data = EMPTY;
  const res = await GET(request());
  assert.equal(res.status, 200);
  const [{ mail }] = sent();
  assert.equal(mail.headers.subject, "Google search this week: 0 clicks");
  assert.ok(mail.text.includes(`${SEO.empty}\n`));
  assert.ok(mail.text.includes("Clicks from Google: 0, about the same as the week before"));
  assert.ok(mail.text.includes("Times the site showed in Google: 0, about the same as the week before"));
  assert.ok(mail.text.includes("Share of people who clicked: 0.0%, was 0.0%"));
  assert.ok(mail.text.includes("Average spot in the results: None this week."));
  assert.ok(mail.text.includes("Searches for your name: 0 clicks, kept out of the numbers above"));
  assert.equal(mail.text.match(/^None this week\.$/gm).length, 4);
});

await test("a first week after a week of nothing says up from 0, and a fall says down with the rounded percent and further down", async () => {
  reset();
  google.data = { ...EMPTY, week: total(30, 500, 12) };
  await GET(request());
  assert.equal(sent()[0].mail.headers.subject, "Google search this week: 30 clicks, up from 0 the week before");
  assert.ok(sent()[0].mail.text.includes("Average spot in the results: 12.0\n"));
  reset();
  google.data = { ...EMPTY, week: total(1, 300, 12), prior: total(8, 290, 10) };
  await GET(request());
  assert.equal(sent()[0].mail.headers.subject, "Google search this week: 1 click, down 88%");
  assert.ok(sent()[0].mail.text.includes("Average spot in the results: 12.0, further down than 10.0"));
  assert.equal(change(100, 100), "about the same as the week before");
  assert.equal(change(1004, 1000), "about the same as the week before");
  assert.equal(change(2500, 1000), "up 150%");
  assert.equal(change(0, 7), "down 100%");
});

await test("page names: home, sections, locations, blog posts and addresses outside the site", () => {
  assert.equal(pageName("https://www.nycluxride.com/", SITE), "Home page");
  assert.equal(pageName("https://nycluxride.com/rates", SITE), "Rates");
  assert.equal(pageName("https://www.nycluxride.com/locations/laguardia-airport", SITE), "LaGuardia Airport");
  assert.equal(pageName("https://www.nycluxride.com/fleet.html", "sc-domain:nycluxride.com"), "Fleet");
  assert.equal(pageName("https://www.nycluxride.com/faq#child-seats", SITE), "FAQ, Child Seats section");
  assert.equal(pageName("https://example.com/limo", SITE), "https://example.com/limo");
  assert.equal(pageName("not a url", SITE), "not a url");
  assert.equal(pageName("https://www.nycluxride.com/%E0%A4%A", SITE), "https://www.nycluxride.com/%E0%A4%A");
});

for (const [stage, status, calls] of [["sts", 403, 1], ["iam", 403, 2], ["sts", 500, 1], ["iam", 429, 2]]) {
  await test(`when ${stage.toUpperCase()} answers ${status}, the route logs one line with no token and answers 500, with no retry and no email`, async () => {
    reset();
    google.fail = (at) => (at === stage ? status : 0);
    const res = await GET(request());
    assert.equal(res.status, 500);
    assert.deepEqual(logged, [`seo-fail ${stage} ${status}`]);
    assert.equal(google.calls.length, calls);
    assert.equal(smtp.messages.length, 0);
  });
}

await test("when one Search Console query fails, the route logs one line and answers 500, sends nothing and asks each query once", async () => {
  reset();
  google.fail = (at, body) => (at === "search" && body.includes('"page"') && body.includes("25000") ? 403 : 0);
  const res = await GET(request());
  assert.equal(res.status, 500);
  assert.deepEqual(logged, ["seo-fail search 403"]);
  assert.equal(google.calls.length, 10);
  assert.equal(smtp.messages.length, 0);
});

await test("when the network fails, the route logs the stage with status 0 and answers 500", async () => {
  for (const [stage, calls] of [["sts", 1], ["iam", 2], ["search", 10]]) {
    reset();
    google.thrown = stage;
    const res = await GET(request());
    assert.equal(res.status, 500, stage);
    assert.deepEqual(logged, [`seo-fail ${stage} 0`]);
    assert.equal(google.calls.length, calls);
    assert.equal(smtp.messages.length, 0);
  }
});

await test("a Search Console answer with no rows or odd rows counts as zero, it never breaks the email", async () => {
  reset();
  google.data = { ...EMPTY, week: [{ clicks: "12", impressions: -4, position: null }], queries: [{ keys: null, clicks: 3 }, { clicks: 1 }] };
  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.equal(sent()[0].mail.headers.subject, "Google search this week: 0 clicks");
});

await test("when the mail server refuses the login, the route logs one line and answers 500, after one try", async () => {
  reset();
  smtp.behavior = { auth: "535 5.7.8 Username and Password not accepted" };
  const res = await GET(request());
  assert.equal(res.status, 500);
  assert.deepEqual(logged, ["seo-fail smtp auth 535"]);
  assert.equal(smtp.messages.length, 0);
  assert.equal(google.calls.length, 10);
});

await test("when the mail server cannot be reached, the route logs one line and answers 500", async () => {
  reset(fullEnv({ SMTP_PORT: String(closed) }));
  const res = await GET(request());
  assert.equal(res.status, 500);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^seo-fail smtp connect \S+$/);
});

await test("OWNER_EMAILS picks the inboxes, the same setting as the owner booking email", async () => {
  reset(fullEnv({ OWNER_EMAILS: "owner@example.com, Owner@example.com" }));
  await GET(request());
  assert.deepEqual(sent()[0].to, ["owner@example.com"]);
});

await test("no log line across every test holds the cron secret, the OIDC token, the STS token, the access token, the SMTP password or the service account", () => {
  assert.deepEqual(secretsIn([...allLogged, ...allNoted]), []);
});

if (failures) {
  process.stderr.write(`\n${failures} test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll seo weekly tests passed\n");
process.exit(0);
