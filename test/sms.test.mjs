import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readInput, resolveTrip, priceTrip, readSettings, money } from "../api/_trip.mjs";
import { metadataFor } from "../api/_stripe.mjs";
import { MAIL } from "../api/_copy.mjs";
import { smsSettings, sendText, gsmText, fitText } from "../api/_sms.mjs";
import { bookingText, bookingLetters } from "../api/_mail.mjs";

const REF = "83558982";
const NOW = new Date("2026-11-01T15:00:00.000Z");
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const hex = (seed) => createHash("sha256").update(seed).digest("hex").slice(0, 32);
const ACCOUNT_SID = `AC${hex("sms test account")}`;
const API_KEY_SID = `SK${hex("sms test key")}`;
const API_SECRET = hex("sms test secret");
const SERVICE_SID = `MG${hex("sms test service")}`;
const REQUEST_ID = `RQ${hex("sms test request")}`;
const SENDER = "+12125550199";
const OWNER = "+16467750556";
const BODY = "NYC LUX RIDE booking\nReference 83558982";
const TWILIO = { TWILIO_ACCOUNT_SID: ACCOUNT_SID, TWILIO_API_KEY: API_KEY_SID, TWILIO_API_SECRET: API_SECRET, TWILIO_FROM: SENDER };
const ENV_KEYS = [...Object.keys(TWILIO), "OWNER_SMS", "GOOGLE_MOCK"];
const AUTH = `Basic ${Buffer.from(`${API_KEY_SID}:${API_SECRET}`).toString("base64")}`;
const GSM = new Set([...`@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}[~]|€`, "\n", String.fromCharCode(92)]);
const cp = (...codes) => String.fromCodePoint(...codes);

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

const twilio = { calls: [], replies: [] };
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  const call = { url: target.href, method: init.method || "GET", headers: new Headers(init.headers), form: new URLSearchParams(String(init.body || "")), signal: init.signal };
  twilio.calls.push(call);
  if (target.origin !== "https://api.twilio.com") throw new Error(`a request went to ${target.origin}`);
  return (twilio.replies.shift() || created)(call);
};
const answer = (status, body, id = REQUEST_ID) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Twilio-Request-Id": id } });
const created = (call) => answer(201, { sid: `SM${hex(String(twilio.calls.length))}`, status: "queued", to: call.form.get("To"), from: call.form.get("From"), body: call.form.get("Body") });
const refused = (status, code) => () => answer(status, { code, message: `The 'To' number ${OWNER} is not a valid phone number.`, more_info: `https://www.twilio.com/docs/errors/${code}`, status });
const broken = (code) => () => {
  throw new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code} 203.0.113.9:443`), { code }) });
};
const hanging = (call) => new Promise((resolve, reject) => call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true }));
const within = (promise, ms = 3000) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms, "still waiting"))]);
const slowBody = (call) => new Response(new ReadableStream({ start: (stream) => call.signal.addEventListener("abort", () => stream.error(call.signal.reason), { once: true }) }), { status: 201, headers: { "Twilio-Request-Id": REQUEST_ID } });

function setEnv(vars = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  logged.length = 0;
  noted.length = 0;
  twilio.calls.length = 0;
  twilio.replies = [];
}

async function booked(fields) {
  const trip = await resolveTrip(readInput(fields), { now: NOW });
  const price = priceTrip(trip, readSettings({ PAYMENTS_ENABLED: "true" }));
  return { metadata: metadataFor(trip, price, REF), total: price.total };
}
setEnv({ GOOGLE_MOCK: "true" });
const ONE_WAY = await booked({ trip_type: "one", from_text: "253 West 72nd Street, New York, NY 10023, USA", to_text: "Newark Liberty (EWR)", to_id: "ewr", date: "2026-11-08", time: "10:00", passengers: "2", class: "suv", tip: "0", rider: "me", ...ME, reach: "whatsapp" });
const ROUND = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", return: "1", return_date: "2026-11-15", return_time: "18:00", passengers: "3", class: "premium", meet: "1", flight: "DL 401", tip: "15", rider: "other", ...ME, reach: "phone", pname: "Ben Ortiz", pphone: "+44 20 7946 0958", sign: "Ortiz Party" });
const HOURLY = await booked({ trip_type: "hour", from_text: "1 Main Street, Brooklyn, NY 11201", date: "2026-12-01", time: "14:00", passengers: "1", hours: "4", class: "premium", vehicle: "premium", tip: "custom", tip_amount: "40", rider: "me", ...ME, reach: "phone" });
const SEATS = await booked({ trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: MANHATTAN, date: "2026-11-12", time: "07:30", passengers: "3", class: "suv", meet: "1", sign: "Lopez Family", tip: "15", infant_seats: "1", booster_seats: "2", rider: "me", ...ME, reach: "phone" });
setEnv();

let serial = 0;
function paid(fix, { live = false, metadata = {}, customer = {} } = {}) {
  serial++;
  const data = { ...fix.metadata, ...metadata };
  const id = `cs_${live ? "live" : "test"}_SmsTest${String(serial).padStart(4, "0")}a1B2c3D4e5F6`;
  return { id, object: "checkout.session", livemode: live, status: "complete", payment_status: "paid", amount_total: fix.total, currency: "usd", client_reference_id: data.ref, payment_intent: null, customer_details: { email: data.email, name: data.name, phone: "+12125550100", ...customer }, metadata: data };
}
const ownerLetter = (session) => bookingLetters(session, { owners: ["info@nycluxride.com"], from: { name: "NYC LUX RIDE", address: "info@nycluxride.com" } }, NOW.getTime()).find((letter) => letter.kind === "owner");
const nonGsm = (body) => [...body].filter((ch) => !GSM.has(ch));

await test("settings: off with no Twilio setting, a config error when any of the four is missing or malformed, the owner number defaults to +16467750556 and OWNER_SMS replaces it", () => {
  setEnv();
  assert.deepEqual(smsSettings(), { off: true });
  setEnv({ OWNER_SMS: "+12125550123" });
  assert.deepEqual(smsSettings(), { off: true });
  setEnv(TWILIO);
  assert.deepEqual(smsSettings(), { account: ACCOUNT_SID, key: API_KEY_SID, secret: API_SECRET, from: SENDER, to: OWNER });
  setEnv({ ...TWILIO, TWILIO_FROM: ` ${SERVICE_SID} `, OWNER_SMS: "+1 (212) 555-0123" });
  assert.deepEqual(smsSettings(), { account: ACCOUNT_SID, key: API_KEY_SID, secret: API_SECRET, from: SERVICE_SID, to: "+12125550123" });
  setEnv({ ...TWILIO, TWILIO_FROM: "+1 212-555-0199", TWILIO_ACCOUNT_SID: ACCOUNT_SID.toUpperCase() });
  assert.deepEqual([smsSettings().from, smsSettings().account], [SENDER, ACCOUNT_SID.toUpperCase()]);
  for (const name of Object.keys(TWILIO)) {
    for (const value of [undefined, "", "   "]) {
      const env = { ...TWILIO };
      if (value === undefined) delete env[name];
      else env[name] = value;
      setEnv(env);
      assert.deepEqual(smsSettings(), { bad: true }, `${name} ${JSON.stringify(value)}`);
    }
  }
  const malformed = {
    TWILIO_ACCOUNT_SID: [API_KEY_SID, ACCOUNT_SID.slice(0, -1), `${ACCOUNT_SID}0`, `AC${"g".repeat(32)}`, `${ACCOUNT_SID.slice(0, 20)} ${ACCOUNT_SID.slice(20)}`, `ac${ACCOUNT_SID.slice(2)}`],
    TWILIO_API_KEY: [ACCOUNT_SID, API_KEY_SID.slice(0, -1), `${API_KEY_SID}0`, `SK${"z".repeat(32)}`],
    TWILIO_API_SECRET: ["too-short", `${API_SECRET.slice(0, 16)} ${API_SECRET.slice(16)}`, `${API_SECRET}${"x".repeat(100)}`, "é".repeat(32)],
    TWILIO_FROM: ["2125550199", "+02125550199", "+1212555019912345", `MG${"0".repeat(31)}`, `PN${hex("number")}`, "NYC LUX RIDE"],
    OWNER_SMS: ["646-775-0556", "+0646775055", "+1646775055612345", "owner"],
  };
  for (const [name, values] of Object.entries(malformed)) {
    for (const value of values) {
      setEnv({ ...TWILIO, [name]: value });
      assert.deepEqual(smsSettings(), { bad: true }, `${name} ${value}`);
    }
  }
  assert.equal(twilio.calls.length, 0);
});

await test("the request: one POST to the account's Messages.json, Basic auth with the API key SID and secret, and a form of To, From and Body, or MessagingServiceSid in place of From", async () => {
  setEnv(TWILIO);
  assert.equal(await sendText(smsSettings(), BODY, REF), "sent");
  assert.equal(twilio.calls.length, 1);
  const [call] = twilio.calls;
  assert.equal(call.url, `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
  assert.equal(call.method, "POST");
  assert.equal(call.headers.get("authorization"), AUTH);
  assert.equal(call.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.deepEqual([...call.form], [["To", OWNER], ["From", SENDER], ["Body", BODY]]);
  assert.ok(call.signal instanceof AbortSignal && !call.signal.aborted);
  setEnv({ ...TWILIO, TWILIO_FROM: SERVICE_SID, OWNER_SMS: "+12125550123" });
  assert.equal(await sendText(smsSettings(), BODY, REF), "sent");
  assert.deepEqual([...twilio.calls[0].form], [["To", "+12125550123"], ["MessagingServiceSid", SERVICE_SID], ["Body", BODY]]);
});

await test("a 2xx is one message: never retried, even when its body never arrives, and logged as sms-sent with the status and the request id", async () => {
  for (const status of [200, 201]) {
    setEnv(TWILIO);
    twilio.replies = [() => answer(status, { sid: `SM${hex("one")}`, status: "queued" })];
    assert.equal(await sendText(smsSettings(), BODY, REF), "sent");
    assert.equal(twilio.calls.length, 1);
    assert.deepEqual([noted, logged], [[`sms-sent ${REF} ${status} ${REQUEST_ID}`], []]);
  }
  setEnv(TWILIO);
  twilio.replies = [slowBody];
  assert.equal(await within(sendText(smsSettings(), BODY, REF, 300)), "sent");
  assert.equal(twilio.calls.length, 1);
  assert.deepEqual(noted, [`sms-sent ${REF} 201 ${REQUEST_ID}`]);
});

await test("429 and 5xx mean Twilio made no message: one retry after a short pause, and the second answer is final", async () => {
  for (const [status, code] of [[429, 20429], [500, 20500], [503, 20503]]) {
    setEnv(TWILIO);
    twilio.replies = [refused(status, code)];
    const started = Date.now();
    assert.equal(await sendText(smsSettings(), BODY, REF), "sent", String(status));
    assert.ok(Date.now() - started >= 450, "it pauses before the retry");
    assert.equal(twilio.calls.length, 2);
    assert.equal(twilio.calls[1].form.toString(), twilio.calls[0].form.toString());
    assert.deepEqual([logged, noted], [[`sms-retry ${REF} ${status} ${code} ${REQUEST_ID}`], [`sms-sent ${REF} 201 ${REQUEST_ID}`]]);
    setEnv(TWILIO);
    twilio.replies = [refused(status, code), refused(status, code)];
    assert.equal(await sendText(smsSettings(), BODY, REF), "unsent", String(status));
    assert.equal(twilio.calls.length, 2);
    assert.deepEqual([logged, noted], [[`sms-retry ${REF} ${status} ${code} ${REQUEST_ID}`, `sms-fail ${REF} ${status} ${code} ${REQUEST_ID}`], []]);
  }
  for (const status of [502, 504]) {
    setEnv(TWILIO);
    twilio.replies = [() => new Response("<html>Gateway</html>", { status })];
    assert.equal(await sendText(smsSettings(), BODY, REF), "sent", String(status));
    assert.deepEqual([twilio.calls.length, logged], [2, [`sms-retry ${REF} ${status}`]], String(status));
  }
  setEnv(TWILIO);
  twilio.replies = [refused(503, 20503), refused(400, 21211)];
  assert.equal(await sendText(smsSettings(), BODY, REF), "unsent");
  assert.equal(twilio.calls.length, 2);
});

await test("a connection that never opened is retried once, and any other network error is never retried, because the request may have reached Twilio", async () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]) {
    setEnv(TWILIO);
    twilio.replies = [broken(code)];
    assert.equal(await sendText(smsSettings(), BODY, REF), "sent", code);
    assert.equal(twilio.calls.length, 2);
    assert.deepEqual([logged, noted], [[`sms-retry ${REF} ${code}`], [`sms-sent ${REF} 201 ${REQUEST_ID}`]]);
  }
  setEnv(TWILIO);
  twilio.replies = [broken("ECONNREFUSED"), broken("ECONNREFUSED")];
  assert.equal(await sendText(smsSettings(), BODY, REF), "unsent");
  assert.deepEqual([twilio.calls.length, logged], [2, [`sms-retry ${REF} ECONNREFUSED`, `sms-fail ${REF} ECONNREFUSED`]]);
  for (const code of ["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT", "EPIPE"]) {
    setEnv(TWILIO);
    twilio.replies = [broken(code)];
    assert.equal(await sendText(smsSettings(), BODY, REF), "unknown", code);
    assert.deepEqual([twilio.calls.length, logged, noted], [1, [`sms-fail ${REF} ${code}`], []]);
  }
  setEnv(TWILIO);
  twilio.replies = [() => Promise.reject(new TypeError("fetch failed"))];
  assert.equal(await sendText(smsSettings(), BODY, REF), "unknown");
  assert.deepEqual([twilio.calls.length, logged], [1, [`sms-fail ${REF} network`]]);
});

await test("a timeout is never retried: the request is aborted when the time is up, the answer is unknown, and time that runs out before a retry stops the retry", async () => {
  setEnv(TWILIO);
  twilio.replies = [hanging];
  const started = Date.now();
  assert.equal(await within(sendText(smsSettings(), BODY, REF, 300)), "unknown");
  const took = Date.now() - started;
  assert.ok(took >= 290 && took < 1000, `took ${took} ms`);
  assert.equal(twilio.calls.length, 1);
  assert.ok(twilio.calls[0].signal.aborted);
  assert.deepEqual([logged, noted], [[`sms-fail ${REF} timeout`], []]);
  setEnv(TWILIO);
  twilio.replies = [refused(503, 20503), hanging];
  const begun = Date.now();
  assert.equal(await within(sendText(smsSettings(), BODY, REF, 1500)), "unknown");
  const spent = Date.now() - begun;
  assert.ok(spent >= 1450 && spent < 1800, `took ${spent} ms, one deadline covers the first try, the pause and the retry`);
  assert.equal(twilio.calls.length, 2);
  assert.deepEqual(logged, [`sms-retry ${REF} 503 20503 ${REQUEST_ID}`, `sms-fail ${REF} timeout`]);
  setEnv(TWILIO);
  twilio.replies = [refused(503, 20503)];
  assert.equal(await sendText(smsSettings(), BODY, REF, 200), "unsent");
  assert.equal(twilio.calls.length, 1);
  assert.deepEqual(logged, [`sms-retry ${REF} 503 20503 ${REQUEST_ID}`, `sms-fail ${REF} 503 20503 ${REQUEST_ID}`]);
});

await test("any other answer from Twilio is final: 400, 401, 403, 404, 408, 409 and 422 are never retried, and a reply without JSON or a Twilio request id logs only its status", async () => {
  for (const [status, code] of [[400, 21211], [401, 20003], [403, 20003], [404, 20404], [408, 20408], [409, 20409], [422, 21610]]) {
    setEnv(TWILIO);
    twilio.replies = [refused(status, code)];
    assert.equal(await sendText(smsSettings(), BODY, REF), "unsent", String(status));
    assert.equal(twilio.calls.length, 1);
    assert.deepEqual([logged, noted], [[`sms-fail ${REF} ${status} ${code} ${REQUEST_ID}`], []]);
  }
  setEnv(TWILIO);
  twilio.replies = [() => new Response("<html>Bad request</html>", { status: 400, headers: { "Twilio-Request-Id": "RQ <script>" } })];
  assert.equal(await sendText(smsSettings(), BODY, REF), "unsent");
  assert.deepEqual(logged, [`sms-fail ${REF} 400`]);
});

await test("no log line holds the API secret, the auth header, a SID, a phone number, the message or Twilio's error text, and sendText returns only sent, unsent or unknown", () => {
  assert.ok(history.length > 30, `${history.length} log lines`);
  const all = history.join("\n");
  for (const secret of [API_SECRET, API_KEY_SID, ACCOUNT_SID, SERVICE_SID, AUTH.slice(6), "6467750556", "2125550199", "2125550123", "NYC LUX RIDE", "Reference", "not a valid phone number", "203.0.113.9", "<script>", "twilio.com"]) assert.ok(!all.includes(secret), secret);
  for (const line of history) assert.match(line, /^sms-(sent|retry|fail) 83558982( [A-Za-z0-9_]+){1,3}$/);
});

await test("the text: the heading, the customer's name and phone, the pickup in New York time on a server in any time zone, the route, the vehicle, the child seats, the total paid and the reference, from the facts of the owner email", () => {
  setEnv();
  const zone = process.env.TZ;
  try {
    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, tz);
      const one = paid(ONE_WAY);
      assert.equal(one.metadata.pickup_at, "2026-11-08T15:00:00.000Z");
      assert.equal(bookingText(one), ["[TEST] NYC LUX RIDE booking", "Ana Lopez, +1 212 555 0100", "Sun Nov 8, 10:00 AM", "253 West 72nd Street to Newark Liberty (EWR)", "Business SUV", "Paid $185.00", "Reference 83558982"].join("\n"));
      const round = paid(ROUND);
      assert.equal(bookingText(round), ["[TEST] NYC LUX RIDE booking", "Ana Lopez, +1 212 555 0100", "Thu Nov 12, 7:30 AM", "JFK to 350 5th Ave, return Sun Nov 15, 6:00 PM", "Business Premium SUV", `Paid ${money(ROUND.total)}`, "Reference 83558982"].join("\n"));
      const hourly = paid(HOURLY);
      assert.equal(bookingText(hourly), ["[TEST] NYC LUX RIDE booking", "Ana Lopez, +1 212 555 0100", "Tue Dec 1, 2:00 PM", "4 hours from 1 Main Street", "Cadillac Escalade ESV (Business Premium SUV)", `Paid ${money(HOURLY.total)}`, "Reference 83558982"].join("\n"));
      const seats = paid(SEATS);
      assert.equal(bookingText(seats), ["[TEST] NYC LUX RIDE booking", "Ana Lopez, +1 212 555 0100", "Thu Nov 12, 7:30 AM", "JFK to 350 5th Ave", "Business SUV", "Child seats: 1 infant seat and 2 booster seats", `Paid ${money(SEATS.total)}`, "Reference 83558982"].join("\n"));
      for (const session of [one, round, hourly, seats]) {
        const lines = bookingText(session).split("\n");
        const owner = ownerLetter(session);
        assert.ok(owner.subject.startsWith(`${MAIL.test}New booking ${REF}: ${lines[2]}, `) && owner.subject.endsWith(`, ${lines[3]}`), `${owner.subject} | ${lines[2]} | ${lines[3]}`);
        assert.ok(owner.text.includes(`\nName: ${ME.name}\n`) && owner.text.includes(`\nPhone: ${ME.phone}\n`));
        assert.ok(owner.text.includes(`\nVehicle: ${lines[4]}\n`), lines[4]);
        assert.ok(owner.text.includes(`\n${MAIL.paid}: ${money(session.amount_total)}\n`) && lines.includes(`${MAIL.paid} ${money(session.amount_total)}`));
        const seatLine = lines.find((line) => line.startsWith("Child seats: "));
        assert.equal(Boolean(seatLine), owner.text.includes("\nChild seats: "));
        if (seatLine) assert.ok(owner.text.includes(`\n${seatLine}\n`), seatLine);
        assert.equal(lines.at(-1), `${MAIL.labels.ref} ${REF}`);
      }
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

await test("[TEST] starts the text only for a test mode Checkout Session", () => {
  const live = paid(ONE_WAY, { live: true });
  assert.ok(live.id.startsWith("cs_live_"));
  assert.ok(bookingText(live).startsWith("NYC LUX RIDE booking\nAna Lopez"));
  assert.ok(!bookingText(live).includes("TEST"));
  const testMode = paid(ONE_WAY);
  assert.ok(testMode.id.startsWith("cs_test_"));
  assert.ok(bookingText(testMode).startsWith(`${MAIL.test}NYC LUX RIDE booking\n`));
  assert.equal(MAIL.test, "[TEST] ");
});

await test("GSM-7 only: curly quotes, dashes, ellipses, accents and odd spaces become plain ASCII and emoji are dropped, in the name, the phone and the addresses", () => {
  const session = paid(ONE_WAY, {
    metadata: {
      name: `Zoë ${cp(0x1f697)} O${cp(0x2019)}Brien${cp(0x2014)}Łukasz ${cp(0x1f469, 0x200d, 0x1f467)}`,
      phone: `+1${cp(0x202f)}212${cp(0x2011)}555${cp(0x2011)}0100`,
      from_text: `${cp(0x201c)}The Café${cp(0x201d)} ${cp(0x2013)} Straße 5${cp(0x2026)}${cp(0xa0)}Rear, New York, NY 10023`,
    },
  });
  const body = bookingText(session);
  const lines = body.split("\n");
  assert.equal(lines[1], "Zoe O'Brien-Lukasz, +1 212-555-0100");
  assert.equal(lines[3], `"The Cafe" - Strasse 5... Rear to Newark Liberty (EWR)`);
  assert.deepEqual(nonGsm(body), []);
  assert.match(body, /^[\n\x20-\x5f\x61-\x7e]+$/);
  const cases = [
    [`It${cp(0x2019)}s ${cp(0x2018)}here${cp(0x2019)} and ${cp(0x201c)}there${cp(0x201d)}`, `It's 'here' and "there"`],
    [`A ${cp(0x2013)} B ${cp(0x2014)} C ${cp(0x2212)} D ${cp(0x2022)} E`, "A - B - C - D - E"],
    [`Wait${cp(0x2026)} ${cp(0xab)}quoted${cp(0xbb)} \`tick\``, `Wait... "quoted" 'tick'`],
    [`Crème brûlée, Ærøskøbing, Œuvre, Kraków, Ðakovo, Þór`, "Creme brulee, AEroskobing, OEuvre, Krakow, Dakovo, Thor"],
    [`a${cp(0x200b)}b${cp(0xfeff)}c${cp(0x2009)}d\te\nf${cp(0x3000)}g`, "abc d e f g"],
    [`${cp(0x1f697)}${cp(0x2764, 0xfe0f)} Ride ${cp(0x1f1fa, 0x1f1f8)}${cp(0x1f44d, 0x1f3fd)}`, "Ride"],
    [`${cp(0xfb01)}ve ${cp(0xff21)}${cp(0x2460)}`, "five A1"],
  ];
  for (const [input, want] of cases) {
    assert.equal(gsmText(input), want, input);
    assert.deepEqual(nonGsm(want), [], want);
  }
});

await test("every Unicode code point folds to GSM-7 or is dropped", () => {
  const kept = [];
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (nonGsm(gsmText(`a${String.fromCodePoint(code)}b`)).length) kept.push(`U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  assert.deepEqual(kept.slice(0, 20), [], `${kept.length} code points survive`);
});

await test("at most 320 characters: an address is cut only when the text is too long, long addresses are shortened first, then the name, and the reference always ends the text", () => {
  const avenue = "1 Avenue of the Americas and West Forty Second St";
  const fits = bookingText(paid(ONE_WAY, { metadata: { from_text: `${avenue}, New York, NY 10036`, from_zone: "manhattan", from_place: "" } }));
  assert.ok(fits.length < 320 && fits.split("\n")[3].startsWith(`${avenue} to `), fits);
  const street = (n) => `${n} Avenue of the Americas Between Forty Second and Forty Third Streets, New York, NY 10036`;
  const name = "Alexandria Catherine Montgomery-Fitzgerald Wellington-Smythe of Kent and Sussex";
  const long = { from_text: street(1), from_zone: "manhattan", from_place: "", to_text: street(2), to_zone: "manhattan", return_date: "2026-11-15", return_time: "18:00" };
  const one = bookingText(paid(SEATS, { metadata: { ...long, name } }));
  const lines = one.split("\n");
  assert.ok(one.length <= 320 && one.length > 300, `${one.length} characters`);
  assert.equal(lines.length, 8);
  assert.equal(lines[1], `${name}, +1 212 555 0100`);
  const [from, to] = lines[3].replace(/, return Sun Nov 15, 6:00 PM$/, "").split(" to ");
  assert.ok(from.endsWith("...") && to.endsWith("...") && from.length === to.length && from.length < 60, lines[3]);
  assert.ok(from.startsWith("1 Avenue of the Am") && to.startsWith("2 Avenue of the Am"), lines[3]);
  assert.deepEqual(lines.slice(4), ["Business SUV", "Child seats: 1 infant seat and 2 booster seats", `Paid ${money(SEATS.total)}`, "Reference 83558982"]);
  const longer = bookingText(paid(SEATS, { metadata: { ...long, name: "", phone: "" }, customer: { name: "Bartholomew ".repeat(20).trim(), phone: "+1 212 555 0100 extension 4455 then ask the front desk for the night manager" } }));
  const tight = longer.split("\n");
  assert.ok(longer.length <= 320, `${longer.length} characters`);
  assert.equal(tight[3], "1 Avenu... to 2 Avenu..., return Sun Nov 15, 6:00 PM");
  assert.ok(tight[1].startsWith("Bartholomew Bartholomew") && tight[1].includes("..., +1 212 555 0100 extension"), tight[1]);
  assert.equal(tight.at(-1), "Reference 83558982");
  assert.deepEqual([...nonGsm(one), ...nonGsm(longer)], []);
  const capped = fitText(() => ["x".repeat(400), "Reference 83558982"]);
  assert.equal(capped.length, 320);
  assert.ok(capped.endsWith("x\nReference 83558982"));
  for (const fix of [ONE_WAY, ROUND, HOURLY, SEATS]) for (const live of [false, true]) assert.ok(bookingText(paid(fix, { live })).length <= 320);
});

if (failures) {
  process.stderr.write(`\n${failures} sms test(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nAll sms tests passed\n");
process.exit(0);
