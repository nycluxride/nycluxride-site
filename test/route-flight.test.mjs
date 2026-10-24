import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { POST as routePost } from "../api/route.mjs";
import { POST as flightPost } from "../api/flight.mjs";
import { signUrl, staticMapUrl } from "../api/_google.mjs";
import { FLIGHT_LOOKUP, FLIGHT_HORIZON_DAYS, FLIGHT_LIVE_HOURS, FLIGHT_DAILY, normalizeFlight, lookupFlight } from "../api/_flight.mjs";
import { signTicket, TICKET_TTL } from "../api/_ticket.mjs";
import { nycToUtc } from "../api/_trip.mjs";
import { localById } from "../api/_places.mjs";

const SITE = "https://www.nycluxride.com";
const SERVER_KEY = "test-server-key-SENTINEL";
const FLIGHT_KEY = "test-flight-key-SENTINEL";
const BROWSER_KEY = "test-browser-key";
const SECRET = Buffer.from("test-signing-secret-SENTINEL-bytes").toString("base64url");
const ENV_KEYS = ["GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "PLACE_TICKET_SECRET", "FLIGHT_API_KEY", "GOOGLE_MOCK", "FLIGHT_MOCK", "VERCEL_ENV"];
const POLYLINE = "a~l~Fjk~uOwHJy@P|bA`@\\";
const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (offset) => NY_DATE.format(new Date(Date.now() + offset * 86400000));
const DATE = day(10);
const NEAR = day(1);
const LIVE = ["Basic", "Live"];

const logs = [];
const print = console.log.bind(console);
const printError = console.error.bind(console);
console.error = (...args) => logs.push(args.map(String).join(" "));
const calls = [];
let reply = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return reply(String(url), init);
};
const bodies = [];

const realNow = Date.now;
const nyMinute = (t) => { const [h, m] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t)).split(":").map(Number); return h * 60 + m; };
let skew = nyMinute(realNow()) >= 22 * 60 ? (24 * 60 + 5 - nyMinute(realNow())) * 60000 : 0;
Date.now = () => realNow() + skew;

let failures = 0;
async function test(name, fn) {
  skew += 61000;
  for (const key of ENV_KEYS) delete process.env[key];
  calls.length = 0;
  try {
    await fn();
    print(`  ok   ${name}`);
  } catch (err) {
    failures++;
    printError(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
  }
}

const answer = (status, body) => () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function send(handler, path, body, { ip, raw, type = "application/json", site } = {}) {
  const headers = { "content-type": type, origin: SITE };
  if (ip) headers["x-real-ip"] = ip;
  if (site) headers["sec-fetch-site"] = site;
  const res = await handler(new Request(`${SITE}${path}`, { method: "POST", headers, body: raw ?? JSON.stringify(body) }));
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, headers: res.headers, body: JSON.parse(text) };
}
const route = (body, options) => send(routePost, "/api/route", body, options);
const flight = (body, options) => send(flightPost, "/api/flight", body, options);

const ROUTES = {
  routes: [
    {
      duration: "2580s",
      staticDuration: "2100s",
      distanceMeters: 27037,
      polyline: { encodedPolyline: POLYLINE },
      legs: [
        { startLocation: { latLng: { latitude: 40.7484405, longitude: -73.9856644 } }, endLocation: { latLng: { latitude: 40.7769271, longitude: -73.8739659 } } },
        { startLocation: { latLng: { latitude: 40.7769271, longitude: -73.8739659 } }, endLocation: { latLng: { latitude: 40.6413111, longitude: -73.7781391 } } },
      ],
    },
  ],
};

function expectedMap(width, height, scale) {
  const url = `https://maps.googleapis.com/maps/api/staticmap?size=${width}x${height}&scale=${scale}&format=png&path=color:0x111111ff%7Cweight:5%7Cenc:${encodeURIComponent(POLYLINE)}&markers=size:mid%7Clabel:A%7C40.748441,-73.985664&markers=size:mid%7Clabel:B%7C40.641311,-73.778139&key=${BROWSER_KEY}`;
  const resource = url.slice("https://maps.googleapis.com".length);
  const signature = createHmac("sha1", Buffer.from(SECRET, "base64url")).update(resource).digest("base64").replace(/\+/g, "-").replace(/\//g, "_");
  return `${url}&signature=${signature}`;
}

await test("route: the Routes request has the field mask, TRAFFIC_AWARE, the departure time, placeId and address waypoints, and the key only in the header", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  reply = answer(200, ROUTES);
  const label = "The New York EDITION, Madison Avenue, New York, NY, USA";
  const ticket = signTicket("ChIJedition", "manhattan", label, Date.now());
  const res = await route({ from: { ticket }, stops: [{ id: "lga" }], to: { id: "jfk-t4" }, date: DATE, time: "12:40" });
  assert.deepEqual(res.body, { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://routes.googleapis.com/directions/v2:computeRoutes");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": SERVER_KEY,
    "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation",
  });
  assert.deepEqual(JSON.parse(init.body), {
    origin: { placeId: "ChIJedition" },
    destination: { address: localById("jfk-t4").addr },
    intermediates: [{ address: localById("lga").addr }],
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    departureTime: nycToUtc(DATE, "12:40").toISOString(),
    languageCode: "en-US",
    units: "IMPERIAL",
  });
  assert.ok(!init.body.includes(SERVER_KEY) && !init.body.includes(label));
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

await test("route: with the browser key and the signing secret the answer carries signed Maps Static URLs at the shown size, 1x and 2x, checked with node:crypto", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  process.env.GOOGLE_MAPS_BROWSER_KEY = BROWSER_KEY;
  process.env.GOOGLE_MAPS_SIGNING_SECRET = SECRET;
  reply = answer(200, ROUTES);
  const res = await route({ from: { id: "jfk" }, stops: [{ id: "lga" }], to: { id: "ewr" }, date: DATE, time: "08:00", map: { width: 440, height: 235 } });
  assert.deepEqual(res.body, { kind: "ok", minutes: 43, miles: 16.8, map: { src: expectedMap(440, 235, 1), src2x: expectedMap(440, 235, 2), width: 440, height: 235 } });
  assert.ok(res.body.map.src.startsWith("https://maps.googleapis.com/maps/api/staticmap?size=440x235&scale=1&"));
  assert.ok(res.body.map.src2x.startsWith("https://maps.googleapis.com/maps/api/staticmap?size=440x235&scale=2&"));
  assert.ok(!JSON.stringify(res.body).includes("640x360") && !JSON.stringify(res.body).includes("1280"));
  assert.ok(!JSON.stringify(res.body).includes(SECRET) && !JSON.stringify(res.body).includes(SERVER_KEY));
  assert.equal(signUrl("https://maps.googleapis.com/maps/api/staticmap?size=1x1&key=k", SECRET), `https://maps.googleapis.com/maps/api/staticmap?size=1x1&key=k&signature=${createHmac("sha1", Buffer.from(SECRET, "base64url")).update("/maps/api/staticmap?size=1x1&key=k").digest("base64").replace(/\+/g, "-").replace(/\//g, "_")}`);
  assert.equal(staticMapUrl(POLYLINE, { lat: 1, lng: 2 }, { lat: 3, lng: 4 }), "");
  delete process.env.GOOGLE_MAPS_SIGNING_SECRET;
  assert.equal(staticMapUrl(POLYLINE, { lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { width: 440, height: 235 }, 2), "");
});

await test("route: without a map size, or with a size outside 120 to 640 by 80 to 640, the answer has the text attribution and no map", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  process.env.GOOGLE_MAPS_BROWSER_KEY = BROWSER_KEY;
  process.env.GOOGLE_MAPS_SIGNING_SECRET = SECRET;
  reply = answer(200, ROUTES);
  const base = { from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" };
  for (const map of [undefined, null, [440, 235], { width: 440 }, { width: "440", height: "235" }, { width: 440.5, height: 235 }, { width: 119, height: 235 }, { width: 641, height: 235 }, { width: 440, height: 79 }, { width: 440, height: 641 }]) {
    assert.deepEqual((await route(map === undefined ? base : { ...base, map })).body, { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" }, JSON.stringify(map));
  }
  const edge = await route({ ...base, map: { width: 120, height: 80 } });
  assert.deepEqual([edge.body.map.width, edge.body.map.height], [120, 80]);
  assert.ok(edge.body.map.src.includes("size=120x80&scale=1&") && edge.body.map.src2x.includes("size=120x80&scale=2&"));
});

await test("route: without the browser key or the secret the answer has the text attribution and no map", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  process.env.GOOGLE_MAPS_SIGNING_SECRET = SECRET;
  reply = answer(200, ROUTES);
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" });
});

await test("route: no server key and no mock answers off without a call, GOOGLE_MOCK answers the data URI map without a call", async () => {
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "off" });
  process.env.GOOGLE_MOCK = "true";
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" });
  const res = await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00", map: { width: 403, height: 139 } });
  assert.equal(res.body.kind, "ok");
  assert.deepEqual([res.body.minutes, res.body.miles, res.body.map.width, res.body.map.height], [43, 16.8, 403, 139]);
  assert.ok(res.body.map.src.startsWith("data:image/svg+xml,") && res.body.map.src2x === res.body.map.src);
  assert.ok(decodeURIComponent(res.body.map.src).includes('width="403" height="139"'));
  process.env.VERCEL_ENV = "production";
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "off" });
  assert.equal(calls.length, 0);
});

await test("route: typed text is never routed, ends must be one id or one ticket, at most 2 stops", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const bad = [
    { from: { text: "350 5th Ave" }, to: { id: "jfk" }, date: DATE, time: "08:00" },
    { from: "jfk", to: { id: "lga" }, date: DATE, time: "08:00" },
    { from: { id: "jfk", ticket: "v1.x.y" }, to: { id: "lga" }, date: DATE, time: "08:00" },
    { to: { id: "lga" }, date: DATE, time: "08:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, stops: { id: "ewr" }, date: DATE, time: "08:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, stops: [{ id: "ewr" }, { id: "teb" }, { id: "hpn" }], date: DATE, time: "08:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, stops: [null], date: DATE, time: "08:00" },
  ];
  for (const body of bad) assert.deepEqual(await route(body).then((res) => [res.status, res.body]), [400, { kind: "error", code: "bad" }], JSON.stringify(body));
  assert.deepEqual(await route(null, { raw: "[1]" }).then((res) => [res.status, res.body]), [400, { kind: "error", code: "bad" }]);
  assert.equal(calls.length, 0);
});

await test("route: an unknown id, a bad or expired ticket, a bad date or time, or a pickup in the past answers off without a call", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const old = signTicket("ChIJold", "manhattan", "x", Date.now() - (TICKET_TTL + 10) * 1000);
  const offs = [
    { from: { id: "nowhere" }, to: { id: "lga" }, date: DATE, time: "08:00" },
    { from: { ticket: "v1.notaticket.abc" }, to: { id: "lga" }, date: DATE, time: "08:00" },
    { from: { ticket: old }, to: { id: "lga" }, date: DATE, time: "08:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, date: "2026-02-30", time: "08:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "8:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, date: day(-1), time: "08:00" },
    { from: { id: "jfk" }, to: { id: "lga" }, time: "08:00" },
  ];
  for (const body of offs) assert.deepEqual((await route(body)).body, { kind: "off" }, JSON.stringify(body));
  assert.equal(calls.length, 0);
});

await test("route: a Routes error, a timeout or an empty answer is off and logs route with the status, the budget is 10 per address", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  logs.length = 0;
  reply = answer(500, { error: SERVER_KEY });
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "off" });
  reply = () => {
    throw new Error("timeout");
  };
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "off" });
  reply = answer(200, { routes: [] });
  assert.deepEqual((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" })).body, { kind: "off" });
  assert.deepEqual(logs, ["route 500", "route 0", "route 0"]);
  reply = answer(200, ROUTES);
  const kinds = [];
  for (let i = 0; i < 11; i++) kinds.push((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" }, { ip: "203.0.113.20" })).body.kind);
  assert.deepEqual(kinds, [...Array(10).fill("ok"), "off"]);
  assert.equal((await route({ from: { id: "jfk" }, to: { id: "lga" }, date: DATE, time: "08:00" }, { ip: "203.0.113.21" })).body.kind, "ok");
});

await test("route and flight refuse cross-site, other types and large bodies, and export only POST", async () => {
  for (const [handler, path] of [[routePost, "/api/route"], [flightPost, "/api/flight"]]) {
    assert.deepEqual(await send(handler, path, {}, { site: "cross-site" }).then((res) => [res.status, res.body]), [403, { kind: "error", code: "origin" }]);
    assert.deepEqual(await send(handler, path, {}, { type: "text/plain" }).then((res) => [res.status, res.body]), [415, { kind: "error", code: "type" }]);
    assert.deepEqual(await send(handler, path, null, { raw: JSON.stringify({ pad: "x".repeat(1100) }) }).then((res) => [res.status, res.body]), [413, { kind: "error", code: "too-large" }]);
  }
  assert.deepEqual(Object.keys(await import("../api/route.mjs")), ["POST"]);
  assert.deepEqual(Object.keys(await import("../api/flight.mjs")), ["POST"]);
});

const leg = ({ arrive = "JFK", date = DATE, time = "14:55", utc = `${date} 19:55Z`, revised, predicted, quality = ["Basic"], terminal = "4", status = "Expected", from = ["Dubai", "DXB"], to = "New York" } = {}) => ({
  number: "EK 201",
  status,
  lastUpdatedUtc: `${date} 09:12Z`,
  airline: { name: "Emirates", iata: "EK", icao: "UAE" },
  departure: { airport: { iata: from[1], icao: "OMDB", name: "Dubai", municipalityName: from[0] }, scheduledTime: { utc: `${date} 05:30Z`, local: `${date} 09:30+04:00` }, terminal: "3" },
  arrival: {
    airport: { iata: arrive, icao: "KJFK", name: "New York John F Kennedy", municipalityName: to },
    scheduledTime: { ...(utc ? { utc } : {}), local: `${date} ${time}-05:00` },
    ...(revised ? { revisedTime: { utc: "x", local: revised } } : {}),
    ...(predicted ? { predictedTime: { utc: "x", local: predicted } } : {}),
    ...(terminal ? { terminal } : {}),
    gate: "B22",
    baggageBelt: "5",
    ...(quality ? { quality } : {}),
  },
  aircraft: { model: "Airbus A380" },
});

await test("flight numbers are normalized and checked with the lookup pattern", () => {
  assert.deepEqual(["ek 201", "ek-201", " Ba 117 ", "dl4012", "b6 123"].map(normalizeFlight), ["EK201", "EK201", "BA117", "DL4012", "B6123"]);
  for (const number of ["EK201", "UAE201", "B6123", "DL4012", "AA1234X", "9W1"]) assert.match(number, FLIGHT_LOOKUP);
  for (const number of ["EK12345", "E2", "EK", "EK201XY", "EK 201", "ek201", "E-201"]) assert.doesNotMatch(number, FLIGHT_LOOKUP);
  assert.equal(FLIGHT_HORIZON_DAYS, 180);
  assert.equal(FLIGHT_LIVE_HOURS, 48);
});

await test("flight: the AeroDataBox call through API.Market, the key only in the x-api-market-key header, and the answer of 13.1.5", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  reply = answer(200, [leg({ date: NEAR, revised: `${NEAR} 15:10-05:00`, quality: LIVE })]);
  const res = await flight({ number: "ek 201", date: NEAR, airport: "JFK" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/EK201/${NEAR}?dateLocalRole=Both&withAircraftImage=false&withLocation=false`);
  assert.deepEqual(calls[0].init.headers, { "x-api-market-key": FLIGHT_KEY });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.ok(!calls[0].url.includes(FLIGHT_KEY));
  assert.deepEqual(res.body, {
    kind: "ok",
    flight: { airline: "Emirates", number: "EK 201", origin: { city: "Dubai", iata: "DXB" }, destination: { city: "New York", iata: "JFK" }, terminal: "4", scheduled: `${NEAR} 14:55`, estimated: `${NEAR} 15:10`, status: "Expected", updated: `${NEAR} 09:12Z` },
  });
});

await test("flight: local times are sliced, never converted, a predicted time is never the estimate, and empty fields stay empty", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  reply = answer(200, [leg({ date: NEAR, time: "23:50", revised: `${NEAR}T23:58:00-05:00`, quality: LIVE, terminal: "" })]);
  const one = (await flight({ number: "EK202", date: NEAR, airport: "JFK" })).body.flight;
  assert.deepEqual([one.scheduled, one.estimated, one.terminal], [`${NEAR} 23:50`, `${NEAR} 23:58`, ""]);
  reply = answer(200, [leg({ date: NEAR, predicted: `${NEAR} 15:21-05:00`, quality: LIVE })]);
  assert.equal((await flight({ number: "EK203", date: NEAR, airport: "JFK" })).body.flight.estimated, "");
});

await test("flight: the provider status reaches the browser as plain words, Unknown, CheckIn, CanceledUncertain and any other value as empty", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const now = Date.now() + 2 * 86400000;
  const date = NY_DATE.format(new Date(now + 3 * 86400000));
  const want = { Expected: "Expected", EnRoute: "En route", Boarding: "Boarding", GateClosed: "Gate closed", Departed: "Departed", Delayed: "Delayed", Approaching: "Approaching", Arrived: "Arrived", Canceled: "Canceled", Diverted: "Diverted", Unknown: "", CheckIn: "", CanceledUncertain: "", constructor: "", "": "" };
  const got = {};
  let n = 700;
  for (const status of Object.keys(want)) {
    reply = answer(200, [leg({ date, status })]);
    got[status] = (await lookupFlight(`EK${n++}`, date, "JFK", now)).flight.status;
  }
  assert.deepEqual(got, want);
});

await test(`flight: the estimate stays only for a Live revised arrival within ${FLIGHT_LIVE_HOURS} hours, judged at answer time, else only the scheduled time`, async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const date = day(5);
  const at = Date.parse(`${date}T19:55:00Z`);
  const near = at - 3600000;
  const edge = at - FLIGHT_LIVE_HOURS * 3600000;
  const estimate = async (number, options, now = near) => {
    reply = answer(200, [leg({ date, revised: `${date} 15:10-05:00`, ...options })]);
    const res = await lookupFlight(number, date, "JFK", now);
    return [res.kind, res.flight.scheduled, res.flight.estimated];
  };
  assert.deepEqual(await estimate("EK501", { quality: LIVE }), ["ok", `${date} 14:55`, `${date} 15:10`]);
  assert.deepEqual(await estimate("EK502", { quality: ["Basic"] }), ["ok", `${date} 14:55`, ""]);
  assert.deepEqual(await estimate("EK503", { quality: [] }), ["ok", `${date} 14:55`, ""]);
  assert.deepEqual(await estimate("EK504", { quality: null }), ["ok", `${date} 14:55`, ""]);
  assert.deepEqual(await estimate("EK505", { quality: ["Basic", "Live", "Approximate"] }), ["ok", `${date} 14:55`, ""]);
  assert.deepEqual(await estimate("EK506", { quality: LIVE, utc: "" }), ["ok", `${date} 14:55`, ""]);
  assert.deepEqual(await estimate("EK507", { quality: LIVE, revised: undefined, predicted: `${date} 15:21-05:00` }), ["ok", `${date} 14:55`, ""]);
  assert.deepEqual(await estimate("EK508", { quality: LIVE }, edge), ["ok", `${date} 14:55`, `${date} 15:10`]);
  assert.deepEqual((await lookupFlight("EK508", date, "JFK", edge - 60000)).flight.estimated, "");
  assert.deepEqual(await estimate("EK509", { quality: LIVE }, at - 14 * 86400000), ["ok", `${date} 14:55`, ""]);
  assert.equal(calls.length, 9);
});

await test("flight: the leg is chosen by arrival airport and arrival date, the first leg on that date without an airport, elsewhere with the New York area leg when it lands at another airport", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const date = day(12);
  reply = answer(200, [leg({ date, arrive: "MXP", to: "Milan", from: ["Dubai", "DXB"] }), leg({ date, arrive: "JFK", from: ["Milan", "MXP"], time: "16:40" }), leg({ date: day(13), arrive: "EWR" })]);
  const jfk = (await flight({ number: "EK205", date, airport: "JFK" })).body;
  assert.deepEqual([jfk.kind, jfk.flight.origin, jfk.flight.scheduled], ["ok", { city: "Milan", iata: "MXP" }, `${date} 16:40`]);
  assert.deepEqual((await flight({ number: "EK205", date, airport: "" })).body.flight.destination, { city: "Milan", iata: "MXP" });
  const other = (await flight({ number: "EK205", date, airport: "EWR" })).body;
  assert.deepEqual([other.kind, other.flight.destination.iata, other.flight.scheduled, other.flight.estimated], ["elsewhere", "JFK", `${date} 16:40`, ""]);
  assert.equal(calls.length, 1);
  reply = answer(200, [leg({ date, arrive: "MXP", to: "Milan" })]);
  const far = (await flight({ number: "EK206", date, airport: "LGA" })).body;
  assert.deepEqual([far.kind, far.flight.destination.iata], ["elsewhere", "MXP"]);
});

await test("flight: a pickup before 4 AM also reads the day before and takes a late landing of that day, a later pickup reads one day", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const date = day(15), before = day(14);
  reply = (url) => answer(200, url.includes(`/${before}?`) ? [leg({ date: before, time: "23:55" })] : [leg({ date, time: "23:55" })])();
  const early = (await flight({ number: "EK231", date, time: "00:10", airport: "JFK" })).body;
  assert.deepEqual([early.kind, early.flight.scheduled], ["ok", `${before} 23:55`]);
  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => c.url.includes(`/${before}?`)) && calls.some((c) => c.url.includes(`/${date}?`)));
  const noon = (await flight({ number: "EK232", date, time: "12:00", airport: "JFK" })).body;
  assert.deepEqual([noon.kind, noon.flight.scheduled], ["ok", `${date} 23:55`]);
  assert.equal(calls.length, 3);
  assert.equal((await flight({ number: "EK233", date, time: "1:00", airport: "JFK" })).body.flight.scheduled, `${date} 23:55`, "a malformed time reads one day");
});

await test("flight: 204 is none and is cached, a second lookup of the same number and date makes no call", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const date = day(14);
  reply = answer(204);
  assert.deepEqual((await flight({ number: "ZZ9999", date, airport: "JFK" })).body, { kind: "none" });
  assert.deepEqual((await flight({ number: "ZZ9999", date, airport: "JFK" })).body, { kind: "none" });
  reply = answer(200, [leg({ date })]);
  assert.equal((await flight({ number: "EK207", date, airport: "JFK" })).body.kind, "ok");
  assert.equal((await flight({ number: "EK207", date, airport: "JFK" })).body.kind, "ok");
  assert.equal(calls.length, 2);
});

await test("flight: the cache keeps a far date 6 hours, a near date 10 minutes and a not found 30 minutes", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const start = Date.now();
  const far = day(20);
  const near = day(1);
  reply = answer(200, [leg({ date: far }), leg({ date: near })]);
  await lookupFlight("EK301", far, "JFK", start);
  await lookupFlight("EK301", far, "JFK", start + 6 * 3600000 - 1000);
  assert.equal(calls.length, 1);
  await lookupFlight("EK301", far, "JFK", start + 6 * 3600000 + 1000);
  assert.equal(calls.length, 2);
  await lookupFlight("EK302", near, "JFK", start);
  await lookupFlight("EK302", near, "JFK", start + 9 * 60000);
  assert.equal(calls.length, 3);
  await lookupFlight("EK302", near, "JFK", start + 11 * 60000);
  assert.equal(calls.length, 4);
  reply = answer(204);
  await lookupFlight("EK303", far, "JFK", start);
  await lookupFlight("EK303", far, "JFK", start + 29 * 60000);
  assert.equal(calls.length, 5);
  await lookupFlight("EK303", far, "JFK", start + 31 * 60000);
  assert.equal(calls.length, 6);
});

await test("flight: a past date or a date beyond 180 days answers later without a call, also with the mock", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  assert.deepEqual((await flight({ number: "EK201", date: day(-1), airport: "JFK" })).body, { kind: "later" });
  assert.deepEqual((await flight({ number: "EK201", date: day(181), airport: "JFK" })).body, { kind: "later" });
  assert.equal(calls.length, 0);
  delete process.env.FLIGHT_API_KEY;
  process.env.FLIGHT_MOCK = "true";
  assert.deepEqual((await flight({ number: "EK201", date: day(181), airport: "JFK" })).body, { kind: "later" });
  reply = answer(204);
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  delete process.env.FLIGHT_MOCK;
  assert.equal((await flight({ number: "EK208", date: day(180), airport: "JFK" })).body.kind, "none");
  assert.equal((await flight({ number: "EK208", date: day(0), airport: "JFK" })).body.kind, "none");
});

await test("flight: a provider error or a timeout answers error and logs flight with the status, never the key", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  logs.length = 0;
  reply = answer(503, { message: FLIGHT_KEY });
  assert.deepEqual((await flight({ number: "EK401", date: day(15), airport: "JFK" })).body, { kind: "error" });
  reply = () => {
    throw new Error("timeout");
  };
  assert.deepEqual((await flight({ number: "EK402", date: day(15), airport: "JFK" })).body, { kind: "error" });
  assert.deepEqual(logs, ["flight 503", "flight 0"]);
});

await test("flight: no key and no mock answers off without a call, bad fields answer 400 bad", async () => {
  assert.deepEqual((await flight({ number: "EK201", date: DATE, airport: "JFK" })).body, { kind: "off" });
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  for (const body of [{ number: "E2", date: DATE }, { number: "EK201", date: "2026-13-01" }, { number: "EK201", date: DATE, airport: "jfk" }, { number: "EK201", date: DATE, airport: "JFKX" }, { date: DATE }, { number: 201, date: DATE }]) {
    assert.deepEqual(await flight(body).then((res) => [res.status, res.body]), [400, { kind: "error", code: "bad" }], JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

await test(`FLIGHT_MOCK: EK201 at JFK or with no airport through the same live rule (estimated within ${FLIGHT_LIVE_HOURS} hours only), none elsewhere, ZZ9999 none, ZZ5000 error, refused in production`, async () => {
  process.env.FLIGHT_MOCK = "true";
  const ok = (await flight({ number: "EK 201", date: NEAR, airport: "JFK" })).body;
  assert.deepEqual(ok, {
    kind: "ok",
    flight: { airline: "Emirates", number: "EK 201", origin: { city: "Dubai", iata: "DXB" }, destination: { city: "New York", iata: "JFK" }, terminal: "4", scheduled: `${NEAR} 14:55`, estimated: `${NEAR} 15:10`, status: "Expected", updated: `${NEAR} 09:00Z` },
  });
  assert.deepEqual((await flight({ number: "EK201", date: DATE, airport: "JFK" })).body, { kind: "ok", flight: { ...ok.flight, scheduled: `${DATE} 14:55`, estimated: "", updated: `${DATE} 09:00Z` } });
  assert.equal((await flight({ number: "EK201", date: DATE, airport: "" })).body.kind, "ok");
  const lga = (await flight({ number: "EK201", date: DATE, airport: "LGA" })).body;
  assert.deepEqual([lga.kind, lga.flight.destination, lga.flight.terminal], ["elsewhere", { city: "New York", iata: "JFK" }, "4"]);
  assert.deepEqual((await flight({ number: "ZZ9999", date: DATE, airport: "JFK" })).body, { kind: "none" });
  assert.deepEqual((await flight({ number: "ZZ5000", date: DATE, airport: "JFK" })).body, { kind: "error" });
  assert.deepEqual((await flight({ number: "BA117", date: DATE, airport: "JFK" })).body, { kind: "none" });
  assert.equal(calls.length, 0);
  process.env.VERCEL_ENV = "production";
  assert.deepEqual((await flight({ number: "EK201", date: DATE, airport: "JFK" })).body, { kind: "off" });
});

await test("flight: 4 provider lookups per address a minute, 12 per instance, then 429 busy, while cached answers and the mock spend nothing", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  reply = answer(204);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await flight({ number: `EK${300 + i}`, date: DATE, airport: "JFK" }, { ip: "203.0.113.30" })).status);
  assert.deepEqual(statuses, [...Array(4).fill(200), 429]);
  assert.deepEqual((await flight({ number: "EK399", date: DATE, airport: "JFK" }, { ip: "203.0.113.30" })).body, { kind: "busy" });
  assert.deepEqual((await flight({ number: "EK300", date: DATE, airport: "JFK" }, { ip: "203.0.113.30" })).body, { kind: "none" }, "a cached answer spends nothing");
  assert.equal(calls.length, 4);
  skew += 61000;
  const instance = [];
  for (let i = 0; i < 13; i++) instance.push((await flight({ number: `EK${400 + i}`, date: DATE, airport: "JFK" })).status);
  assert.deepEqual(instance, [...Array(12).fill(200), 429]);
  delete process.env.FLIGHT_API_KEY;
  process.env.FLIGHT_MOCK = "true";
  skew += 61000;
  const mock = [];
  for (let i = 0; i < 6; i++) mock.push((await flight({ number: "EK201", date: DATE, airport: "JFK" }, { ip: "203.0.113.32" })).status);
  assert.deepEqual(mock, Array(6).fill(200));
});

await test("flight: one address gets 10 provider lookups a New York day, then busy, while another address still looks up", async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  reply = answer(204);
  const date = day(20), kinds = [];
  for (let i = 0; i < 11; i++) {
    skew += 61000;
    kinds.push((await flight({ number: `ZQ${500 + i}`, date, airport: "JFK" }, { ip: "203.0.113.33" })).body.kind);
  }
  assert.deepEqual(kinds, [...Array(10).fill("none"), "busy"]);
  assert.equal((await flight({ number: "ZQ600", date, airport: "JFK" }, { ip: "203.0.113.34" })).body.kind, "none");
  assert.ok(logs.includes("flight client-daily"));
});

await test("flight: the probe answers on or off without a lookup and without spending a budget", async () => {
  assert.deepEqual((await flight({ probe: true })).body, { kind: "off" });
  process.env.FLIGHT_MOCK = "true";
  assert.deepEqual((await flight({ probe: true })).body, { kind: "on" });
  delete process.env.FLIGHT_MOCK;
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  const answers = [];
  for (let i = 0; i < 20; i++) answers.push((await flight({ probe: true }, { ip: "203.0.113.31" })).body.kind);
  assert.deepEqual(answers, Array(20).fill("on"));
  reply = answer(204);
  assert.deepEqual((await flight({ number: "EK990", date: DATE, airport: "JFK" }, { ip: "203.0.113.31" })).body, { kind: "none" });
  assert.deepEqual(await flight({ probe: "yes" }).then((res) => [res.status, res.body]), [400, { kind: "error", code: "bad" }]);
  assert.equal(calls.length, 1);
});

await test(`flight: at most ${FLIGHT_DAILY} provider lookups per instance and New York day, then off without a call, cache hits are free and a new day starts again`, async () => {
  process.env.FLIGHT_API_KEY = FLIGHT_KEY;
  logs.length = 0;
  reply = answer(204);
  const start = Date.now() + 3 * 86400000;
  const date = NY_DATE.format(new Date(start + 5 * 86400000));
  for (let i = 1; i <= FLIGHT_DAILY; i++) assert.equal((await lookupFlight(`ZZ${i}`, date, "JFK", start)).kind, "none", String(i));
  assert.equal(calls.length, FLIGHT_DAILY);
  assert.deepEqual(await lookupFlight("ZZ9001", date, "JFK", start + 60000), { kind: "off" });
  assert.deepEqual(await lookupFlight("ZZ7", date, "JFK", start + 60000), { kind: "none" });
  assert.equal(calls.length, FLIGHT_DAILY);
  assert.deepEqual(logs, ["flight daily"]);
  assert.equal(FLIGHT_DAILY, 80);
  assert.equal((await lookupFlight("ZZ9001", date, "JFK", start + 86400000)).kind, "none");
  assert.equal(calls.length, FLIGHT_DAILY + 1);
});

await test("no sentinel key or signing secret appears in a response body or a log line", () => {
  assert.ok(bodies.length > 50);
  for (const text of bodies) assert.ok(!text.includes("SENTINEL") && !text.includes(SECRET), text.slice(0, 80));
  for (const entry of logs) assert.ok(!entry.includes("SENTINEL"), entry);
});

console.error = printError;
if (failures) {
  printError(`\n${failures} failing`);
  process.exit(1);
}
print("\nall route and flight tests pass");
