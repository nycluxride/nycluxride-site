import assert from "node:assert/strict";
import { POST as placesPost } from "../api/places.mjs";
import { POST as routePost } from "../api/route.mjs";
import { POST as flightPost } from "../api/flight.mjs";
import { POST as bookPost } from "../api/book.mjs";
import { classifyPlace } from "../api/_places.mjs";
import { googleUp, reverseGeocode, mapJs } from "../api/_google.mjs";
import { signTicket, verifyTicket, readRoute, TICKET, TICKET_TTL } from "../api/_ticket.mjs";
import { readInput, resolveTrip, priceDistance } from "../api/_trip.mjs";

const SITE = "https://www.nycluxride.com";
const SERVER_KEY = "test-server-key-SENTINEL";
const BROWSER_KEY = "test-browser-key";
const TICKET_SECRET = "test-place-ticket-secret-of-at-least-32-chars";
const ENV_KEYS = ["GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "GOOGLE_MAPS_JS", "GOOGLE_MAPS_MAP_ID", "PLACE_TICKET_SECRET", "GOOGLE_MOCK", "MAP_MOCK", "FLIGHT_MOCK", "FLIGHT_API_KEY", "VERCEL_ENV", "BOOK_MOCK", "PAYMENTS_ENABLED"];
const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const DATE = NY_DATE.format(new Date(Date.now() + 10 * 86400000));
const RDATE = NY_DATE.format(new Date(Date.now() + 12 * 86400000));
const BEDFORD = { lat: 40.714224, lng: -73.961452 };
const JFK_T4 = { lat: 40.644166, lng: -73.782425 };
const EDITION_LABEL = "The New York EDITION, Madison Avenue, New York, NY";
const BEDFORD_LABEL = "277 Bedford Avenue, Brooklyn, NY";
const REVERSE_FIELDS = ["placeId", "location", "granularity", "formattedAddress", "addressComponents", "types"];
const GEOCODE_RESULT = ["place", "placeId", "location", "granularity", "viewport", "bounds", "formattedAddress", "postalAddress", "addressComponents", "postalCodeLocalities", "types", "plusCode"];

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
const answer = (status, body) => () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let failures = 0;
let ip = 0;
async function test(name, fn) {
  for (const key of ENV_KEYS) delete process.env[key];
  calls.length = 0;
  reply = answer(200, {});
  ip++;
  try {
    await fn();
    print(`  ok   ${name}`);
  } catch (err) {
    failures++;
    printError(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
  }
}

async function send(handler, path, body, { raw, from = `10.1.${ip}.1` } = {}) {
  const headers = { "content-type": "application/json", accept: "application/json", origin: SITE, "x-real-ip": from };
  const res = await handler(new Request(`${SITE}${path}`, { method: "POST", headers, body: raw ?? JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const places = (body, options) => send(placesPost, "/api/places", body, options);
const route = (body, options) => send(routePost, "/api/route", body, options);
const flight = (body, options) => send(flightPost, "/api/flight", body, options);
const book = (body, options) => send(bookPost, "/api/book", body, options);
const mock = () => Object.assign(process.env, { GOOGLE_MOCK: "true", MAP_MOCK: "true", PLACE_TICKET_SECRET: TICKET_SECRET });
const live = () => Object.assign(process.env, { GOOGLE_MAPS_SERVER_KEY: SERVER_KEY, GOOGLE_MAPS_BROWSER_KEY: BROWSER_KEY, GOOGLE_MAPS_JS: "on", PLACE_TICKET_SECRET: TICKET_SECRET });
const part = (types, longText, shortText = longText) => ({ longText, shortText, types });
const v4 = (formattedAddress, components, types = ["street_address"], placeId = "ChIJtest") => ({ placeId, location: { latitude: 40.7, longitude: -73.9 }, granularity: "ROOFTOP", formattedAddress, addressComponents: components, types });
const state = (code, name) => part(["administrative_area_level_1", "political"], name, code);
const county = (name) => part(["administrative_area_level_2", "political"], name);
const zip = (code) => part(["postal_code"], code);
const routes = (minutes, meters, line = "_p~iF~ps|U_ulLnnqC") => ({ routes: [{ duration: `${minutes * 60}s`, staticDuration: `${minutes * 60}s`, distanceMeters: meters, polyline: { encodedPolyline: line }, legs: [{ startLocation: { latLng: { latitude: 40.7414, longitude: -73.9872 } }, endLocation: { latLng: { latitude: 40.7142, longitude: -73.9615 } } }] }] });
const fields = (extra = {}) => ({ trip_type: "one", from_text: EDITION_LABEL, to_text: BEDFORD_LABEL, date: DATE, time: "14:30", passengers: "1", class: "suv", action: "options", ...extra });

async function pickTickets() {
  const a = await places({ action: "pick", id: "mock-edition", session: "6f1c8a52-1b0e-4c1a-9d2e-3f4a5b6c7d8e", label: EDITION_LABEL, proof: await proof("mock-edition", EDITION_LABEL) });
  const b = await places({ action: "pick", id: "mock-bedford", session: "6f1c8a52-1b0e-4c1a-9d2e-3f4a5b6c7d8e", label: BEDFORD_LABEL, proof: await proof("mock-bedford", BEDFORD_LABEL) });
  return [a.body.ticket, b.body.ticket];
}
async function proof(id, label) {
  const { placeProof } = await import("../api/_ticket.mjs");
  return placeProof(id, label);
}

await test("U1 probe: the mock map script only under GOOGLE_MOCK and MAP_MOCK, the Maps JavaScript URL with the browser key only after GOOGLE_MAPS_JS=on, the switch, and never a map ID", async () => {
  Object.assign(process.env, { GOOGLE_MOCK: "true", MAP_MOCK: "true" });
  assert.deepEqual((await flight({ probe: true })).body.js, { src: "/__maps-mock.js?callback=nlrMap" });
  delete process.env.MAP_MOCK;
  assert.equal((await flight({ probe: true })).body.js, undefined);
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { GOOGLE_MAPS_SERVER_KEY: "test-server-key", GOOGLE_MAPS_BROWSER_KEY: BROWSER_KEY });
  assert.equal((await flight({ probe: true })).body.js, undefined, "the interactive map stays off until GOOGLE_MAPS_JS=on");
  process.env.GOOGLE_MAPS_JS = "on";
  const js = (await flight({ probe: true })).body.js, { src } = js;
  assert.ok(src.startsWith(`https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&v=weekly&loading=async&libraries=maps`), src);
  assert.ok(src.includes("callback=nlrMap") && src.includes("language=en") && src.includes("region=US"), src);
  assert.deepEqual(Object.keys(js), ["src"]);
  process.env.GOOGLE_MAPS_JS = "off";
  assert.equal((await flight({ probe: true })).body.js, undefined);
  process.env.GOOGLE_MAPS_JS = "on";
  delete process.env.GOOGLE_MAPS_BROWSER_KEY;
  assert.equal((await flight({ probe: true })).body.js, undefined, "no browser key, no map");
  process.env.GOOGLE_MAPS_BROWSER_KEY = BROWSER_KEY;
  process.env.GOOGLE_MAPS_MAP_ID = "abc";
  assert.deepEqual((await flight({ probe: true })).body.js, js, "no map ID, the styled raster map");
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { GOOGLE_MOCK: "true", MAP_MOCK: "true", VERCEL_ENV: "production" });
  assert.equal(JSON.stringify((await flight({ probe: true })).body).includes("__maps-mock"), false);
  Object.assign(process.env, { GOOGLE_MAPS_BROWSER_KEY: BROWSER_KEY, GOOGLE_MAPS_SERVER_KEY: SERVER_KEY, GOOGLE_MAPS_JS: "on" });
  assert.ok((await flight({ probe: true })).body.js.src.startsWith("https://maps.googleapis.com/maps/api/js?"));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { GOOGLE_MOCK: "true", MAP_MOCK: "auth" });
  assert.equal(mapJs().src, "/__maps-mock.js?callback=nlrMap&fail=auth");
  process.env.MAP_MOCK = "load";
  assert.equal(mapJs().src, "/__maps-mock-missing.js?callback=nlrMap");
});

await test("U2 here: the Bedford fixture gives its label, Brooklyn and a ticket for that label, JFK Terminal 4 gives jfk, water gives none, bad input gives 400, the 21st call in a minute gives 429", async () => {
  mock();
  const a = await places({ action: "here", ...BEDFORD });
  assert.equal(a.status, 200);
  assert.deepEqual([a.body.kind, a.body.label, a.body.zone, a.body.area, a.body.airport], ["ok", "277 Bedford Ave, Brooklyn, NY 11211", "brooklyn", "Brooklyn", false]);
  assert.deepEqual(a.body.location, BEDFORD);
  assert.deepEqual(verifyTicket(a.body.ticket, a.body.label, Date.now()), { id: "mock-bedford", zone: "brooklyn", expired: false });
  const j = await places({ action: "here", lat: 40.6442, lng: -73.7826 });
  assert.deepEqual([j.body.kind, j.body.zone, j.body.airport, j.body.area], ["ok", "jfk", true, "JFK"]);
  assert.deepEqual((await places({ action: "here", lat: 40.68, lng: -74.04 })).body, { kind: "none" });
  for (const bad of [{ lat: 30, lng: -73.9 }, { lat: 40.7, lng: -80 }, { lat: "40.7", lng: -73.9 }, { lat: 40.7 }, { lat: null, lng: -73.9 }, {}]) {
    const r = await places({ action: "here", ...bad });
    assert.deepEqual([r.status, r.body], [400, { kind: "error", code: "bad" }], JSON.stringify(bad));
  }
  assert.equal((await places(null, { raw: '{"action":"here","lat":NaN,"lng":-73.9}' })).status, 400);
  const from = "10.9.9.9";
  for (let i = 0; i < 20; i++) assert.equal((await places({ action: "here", ...BEDFORD }, { from })).status, 200, `call ${i + 1}`);
  const busy = await places({ action: "here", ...BEDFORD }, { from });
  assert.deepEqual([busy.status, busy.body], [429, { kind: "busy" }]);
  delete process.env.GOOGLE_MOCK;
  assert.deepEqual((await places({ action: "here", ...BEDFORD })).body, { kind: "off" });
});

await test("U3 classifyPlace reads Geocoding v4 results like Place Details: airports by ZIP and grounds, boroughs by county, outside otherwise", () => {
  const ny = [state("NY", "New York")];
  const nj = [state("NJ", "New Jersey")];
  assert.equal(classifyPlace(v4("JFK Terminal 4, Jamaica, NY 11430, USA", [...ny, county("Queens County"), zip("11430")], ["airport"]), "JFK Terminal 4, Jamaica, NY 11430"), "jfk");
  assert.equal(classifyPlace(v4("LaGuardia Airport, Queens, NY 11371, USA", [...ny, county("Queens County"), zip("11371")]), "LaGuardia Airport, Queens, NY 11371"), "lga");
  assert.equal(classifyPlace(v4("3 Brewster Rd, Newark, NJ 07114, USA", [...nj, county("Essex County"), zip("07114")], ["premise"]), "3 Brewster Rd, Newark, NJ 07114"), "ewr");
  assert.equal(classifyPlace(v4("400 Frelinghuysen Ave, Newark, NJ 07114, USA", [...nj, county("Essex County"), zip("07114")]), "400 Frelinghuysen Ave, Newark, NJ 07114"), "outside");
  assert.equal(classifyPlace(v4("Teterboro Airport, Teterboro, NJ 07608, USA", [...nj, county("Bergen County"), zip("07608")], ["airport", "establishment"]), "Teterboro Airport, Teterboro, NJ 07608"), "teb");
  assert.equal(classifyPlace(v4("240 Airport Rd, White Plains, NY 10604, USA", [...ny, county("Westchester County"), zip("10604")], ["airport", "establishment"]), "240 Airport Rd, White Plains, NY 10604"), "airport-other");
  assert.equal(classifyPlace(v4("277 Bedford Ave, Brooklyn, NY 11211, USA", [...ny, county("Kings County"), zip("11211")]), "277 Bedford Ave, Brooklyn, NY 11211"), "brooklyn");
  assert.equal(classifyPlace(v4("1 Washington St, Hoboken, NJ 07030, USA", [...nj, county("Hudson County"), zip("07030")]), "1 Washington St, Hoboken, NJ 07030"), "outside");
});

await test("U4 here with Google: the v4 reverse request, the key in the header, the exact field mask, premise before route, intersection last, plus code never, errors set the down window", async () => {
  live();
  const result = (types, formattedAddress, placeId) => ({ ...v4(formattedAddress, [state("NY", "New York"), county("Kings County"), zip("11211")], types, placeId) });
  reply = answer(200, { results: [result(["route"], "Bedford Ave, Brooklyn, NY 11211, USA", "ChIJroute"), result(["premise"], "277 Bedford Ave, Brooklyn, NY 11211, USA", "ChIJpremise"), result(["plus_code"], "PX7Q+P8 Brooklyn, NY, USA", "ChIJplus")] });
  const a = await places({ action: "here", ...BEDFORD });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://geocode.googleapis.com/v4/geocode/location/40.714224,-73.961452?languageCode=en&regionCode=us");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(calls[0].init.headers, { "X-Goog-Api-Key": SERVER_KEY, "X-Goog-FieldMask": "results.placeId,results.location,results.granularity,results.formattedAddress,results.addressComponents,results.types" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual([a.body.kind, a.body.label, verifyTicket(a.body.ticket, a.body.label, Date.now()).id], ["ok", "277 Bedford Ave, Brooklyn, NY 11211", "ChIJpremise"]);
  assert.ok(!JSON.stringify(a.body).includes(SERVER_KEY));
  reply = answer(200, { results: [result(["route"], "Bedford Ave, Brooklyn, NY 11211, USA", "ChIJroute"), result(["intersection"], "Bedford Ave & N 6th St, Brooklyn, NY 11211, USA", "ChIJcross"), result(["neighborhood", "political"], "Williamsburg, Brooklyn, NY, USA", "ChIJhood")] });
  const b = await places({ action: "here", ...BEDFORD });
  assert.deepEqual([b.body.kind, b.body.label], ["ok", "Bedford Ave & N 6th St, Brooklyn, NY 11211"]);
  reply = answer(200, { results: [result(["plus_code"], "PX7Q+P8 Brooklyn, NY, USA", "ChIJplus"), result(["route"], "Bedford Ave, Brooklyn, NY 11211, USA", "ChIJroute"), result(["postal_code"], "Brooklyn, NY 11211, USA", "ChIJzip")] });
  assert.deepEqual((await places({ action: "here", ...BEDFORD })).body, { kind: "none" });
  reply = answer(200, { results: [result(["street_address", "political"], "Brooklyn, NY, USA", "ChIJmixed")] });
  assert.deepEqual((await places({ action: "here", ...BEDFORD })).body, { kind: "none" });
  assert.ok(REVERSE_FIELDS.every((name) => GEOCODE_RESULT.includes(name)));
  reply = answer(503, { error: { status: "UNAVAILABLE" } });
  assert.deepEqual((await places({ action: "here", ...BEDFORD })).body, { kind: "error" });
  assert.equal(googleUp(), false);
  assert.ok(logs.some((l) => l === "places-here 503"), logs.join(" | "));
  reply = () => Promise.reject(new DOMException("timed out", "TimeoutError"));
  assert.deepEqual(await reverseGeocode(40.7, -73.9), { ok: false, status: 0 });
});

await test("U5 a Geocoding place ID of 300 characters, the longest the places API takes, signs a ticket with the longest zone and the area mark that passes the ticket pattern and verifyTicket, the here answer signs it, and a longer ID gives the error answer", async () => {
  live();
  const id = "Ei" + "x".repeat(298);
  const ticket = signTicket(id, "staten-island", "1 Very Long Street Name, Staten Island, NY 10314", Date.now(), true);
  assert.ok(TICKET.test(ticket), String(ticket.length));
  assert.deepEqual([verifyTicket(ticket, "1 Very Long Street Name, Staten Island, NY 10314", Date.now()).id, readInput({ trip_type: "one", from_ticket: ticket }).from_ticket], [id, ticket]);
  const long = "Ei" + "y".repeat(298);
  reply = answer(200, { results: [v4("277 Bedford Ave, Brooklyn, NY 11211, USA", [state("NY", "New York"), county("Kings County"), zip("11211")], ["street_address"], long)] });
  const here = (await places({ action: "here", ...BEDFORD })).body;
  assert.deepEqual([here.kind, here.zone, verifyTicket(here.ticket, here.label, Date.now()).id], ["ok", "brooklyn", long]);
  reply = answer(200, { results: [v4("277 Bedford Ave, Brooklyn, NY 11211, USA", [state("NY", "New York"), county("Kings County"), zip("11211")], ["street_address"], `${long}y`)] });
  assert.deepEqual((await places({ action: "here", ...BEDFORD })).body, { kind: "error" });
});

await test("U6 locate: a local row answers a location and is cached, an unknown id gives 400, a restored ticket uses place geocoding, an expired ticket gives error", async () => {
  live();
  reply = answer(200, { results: [{ location: { latitude: 40.6441, longitude: -73.7822 } }] });
  const a = await places({ action: "locate", id: "jfk-t4" });
  assert.deepEqual(a.body, { kind: "ok", location: { lat: 40.6441, lng: -73.7822 } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent("John F. Kennedy International Airport Terminal 4, Queens, NY 11430")}?`), calls[0].url);
  assert.equal(calls[0].init.headers["X-Goog-FieldMask"], "results.location");
  assert.deepEqual((await places({ action: "locate", id: "jfk-t4" })).body, a.body);
  assert.equal(calls.length, 1, "the second call for the same row is cached");
  assert.equal((await places({ action: "locate", id: "nowhere" })).status, 400);
  assert.equal((await places({ action: "locate", ticket: "v1.bad" })).status, 400);
  reply = answer(200, { location: { latitude: 40.7414, longitude: -73.9872 } });
  const ticket = signTicket("ChIJedition", "manhattan", EDITION_LABEL, Date.now());
  assert.deepEqual((await places({ action: "locate", ticket })).body, { kind: "ok", location: { lat: 40.7414, lng: -73.9872 } });
  assert.equal(calls[1].url, "https://geocode.googleapis.com/v4/geocode/places/ChIJedition?languageCode=en&regionCode=us");
  assert.equal(calls[1].init.headers["X-Goog-FieldMask"], "location");
  const old = signTicket("ChIJold", "manhattan", EDITION_LABEL, Date.now() - (TICKET_TTL + 60) * 1000);
  assert.deepEqual((await places({ action: "locate", ticket: old })).body, { kind: "error" });
  assert.equal(calls.length, 2);
});

await test("U7 one route: the drawn route answers path, points and a token whose ride the options price reuses with no Routes call, for one way and return trips, and stops get no token", async () => {
  mock();
  const [from, to] = await pickTickets();
  const r = await route({ from: { ticket: from }, to: { ticket: to }, stops: [], date: DATE, time: "14:30", draw: 1 });
  assert.equal(r.body.kind, "ok");
  assert.deepEqual([r.body.minutes, r.body.miles], [27, 4.6]);
  assert.ok(typeof r.body.path === "string" && r.body.path.length > 4);
  assert.deepEqual(r.body.points, [[40.741389, -73.987193], [40.714224, -73.961452]]);
  const rides = [...readRoute(r.body.route, Date.now())];
  assert.equal(rides.length, 1);
  assert.deepEqual([rides[0][1].tenths, rides[0][1].minutes], [46, 27]);
  const trip = await resolveTrip(readInput(fields({ from_ticket: from, to_ticket: to, route: r.body.route })), { now: Date.now() });
  assert.deepEqual([...readRoute(trip.route, Date.now())].map(([k]) => k), [rides[0][0]], "the options trip finds the ride by the same key");
  for (const key of ENV_KEYS) delete process.env[key];
  live();
  reply = answer(500, {});
  const o = await book(fields({ from_ticket: from, to_ticket: to, route: r.body.route, draw: "1" }));
  assert.equal(calls.filter((c) => c.url.startsWith("https://routes.googleapis.com")).length, 0, "no Routes call");
  assert.deepEqual(o.body.ride, { kind: "ok", minutes: 27, miles: 4.6, attribution: "Google Maps" });
  assert.equal(o.body.classes.find((c) => c.class === "suv").total_cents, priceDistance("suv", { tenths: 46, minutes: 27 }).total);
  assert.ok(o.body.route && readRoute(o.body.route, Date.now()).size === 1);
  for (const key of ENV_KEYS) delete process.env[key];
  mock();
  const back = await route({ from: { ticket: from }, to: { ticket: to }, stops: [], date: DATE, time: "14:30", back: { date: RDATE, time: "18:00" }, draw: 1 });
  assert.deepEqual([back.body.back.minutes, back.body.back.miles, typeof back.body.back.path], [31, 4.8, "string"]);
  assert.equal(readRoute(back.body.route, Date.now()).size, 2);
  for (const key of ENV_KEYS) delete process.env[key];
  live();
  const ob = await book(fields({ from_ticket: from, to_ticket: to, route: back.body.route, return: "1", return_date: RDATE, return_time: "18:00", draw: "1" }));
  assert.equal(calls.filter((c) => c.url.startsWith("https://routes.googleapis.com")).length, 0);
  assert.equal(ob.body.classes.find((c) => c.class === "suv").total_cents, priceDistance("suv", { tenths: 46, minutes: 27 }).total + priceDistance("suv", { tenths: 48, minutes: 31 }).total);
  for (const key of ENV_KEYS) delete process.env[key];
  mock();
  const stop = await route({ from: { ticket: from }, to: { ticket: to }, stops: [{ id: "lga" }], date: DATE, time: "14:30", draw: 1 });
  assert.equal(stop.body.kind, "ok");
  assert.equal(stop.body.route, undefined);
  assert.equal(stop.body.points.length, 3);
  const plain = await route({ from: { ticket: from }, to: { ticket: to }, stops: [], date: DATE, time: "14:30" });
  assert.deepEqual(plain.body, { kind: "ok", minutes: 27, miles: 4.6, attribution: "Google Maps" }, "without the draw flag the answer keeps the release shape");
});

await test("U8 a token for another time is not reused: the options request computes once, prices from the new numbers and answers the path", async () => {
  mock();
  const [from, to] = await pickTickets();
  const r = await route({ from: { ticket: from }, to: { ticket: to }, stops: [], date: DATE, time: "14:30", draw: 1 });
  for (const key of ENV_KEYS) delete process.env[key];
  live();
  reply = (url) => (url.startsWith("https://routes.googleapis.com") ? answer(200, routes(33, 9000, "_ibE_seK_seK_seK"))() : answer(404, {})());
  const o = await book(fields({ from_ticket: from, to_ticket: to, route: r.body.route, time: "15:00", draw: "1" }));
  assert.equal(calls.filter((c) => c.url.startsWith("https://routes.googleapis.com")).length, 1);
  assert.deepEqual(o.body.ride, { kind: "ok", minutes: 33, miles: 5.6, path: "_ibE_seK_seK_seK", attribution: "Google Maps" });
  assert.equal(o.body.classes.find((c) => c.class === "suv").total_cents, priceDistance("suv", { tenths: 56, minutes: 33 }).total);
  calls.length = 0;
  const without = await book(fields({ from_ticket: from, to_ticket: to, route: r.body.route, time: "15:10" }));
  assert.deepEqual(without.body.ride, { kind: "ok", minutes: 33, miles: 5.6, attribution: "Google Maps" }, "the static flow gets no path");
});

await test("U9 cost guards: Place Details asks Essentials fields only, the reverse mask stays inside GeocodeResult, routes stay traffic aware", async () => {
  live();
  reply = answer(200, { id: "ChIJedition", formattedAddress: "Madison Ave, New York, NY 10010, USA", addressComponents: [state("NY", "New York"), county("New York County"), zip("10010")], types: ["lodging"], location: { latitude: 40.7414, longitude: -73.9872 } });
  const { placeProof } = await import("../api/_ticket.mjs");
  const p = await places({ action: "pick", id: "ChIJedition", session: "6f1c8a52-1b0e-4c1a-9d2e-3f4a5b6c7d8e", label: EDITION_LABEL, proof: placeProof("ChIJedition", EDITION_LABEL) });
  assert.equal(p.body.kind, "ok");
  assert.equal(calls[0].init.headers["X-Goog-FieldMask"], "id,formattedAddress,shortFormattedAddress,addressComponents,types,location");
  reply = answer(200, { results: [] });
  await places({ action: "here", ...BEDFORD });
  assert.ok(calls[1].init.headers["X-Goog-FieldMask"].split(",").every((f) => f.startsWith("results.") && GEOCODE_RESULT.includes(f.slice(8))));
  reply = answer(200, routes(27, 7400));
  const ticket = signTicket("ChIJedition", "manhattan", EDITION_LABEL, Date.now());
  await route({ from: { ticket }, to: { id: "jfk-t4" }, stops: [], date: DATE, time: "14:30", draw: 1 });
  assert.equal(JSON.parse(calls[2].init.body).routingPreference, "TRAFFIC_AWARE");
});

await test("U10 pick answers the place location from Place Details", async () => {
  mock();
  const { placeProof } = await import("../api/_ticket.mjs");
  const p = await places({ action: "pick", id: "mock-bedford", session: "6f1c8a52-1b0e-4c1a-9d2e-3f4a5b6c7d8e", label: BEDFORD_LABEL, proof: placeProof("mock-bedford", BEDFORD_LABEL) });
  assert.deepEqual([p.body.kind, p.body.zone, p.body.location], ["ok", "brooklyn", BEDFORD]);
  const t = await places({ action: "here", ...JFK_T4 });
  assert.deepEqual(t.body.location, JFK_T4);
});

await test("U11 while the interactive map is off, here and locate answer off and send no Geocoding request: the mock without MAP_MOCK, Google without GOOGLE_MAPS_JS=on, with GOOGLE_MAPS_JS=off and with no browser key", async () => {
  const both = async (why) => {
    const ticket = signTicket("ChIJedition", "manhattan", EDITION_LABEL, Date.now());
    assert.deepEqual((await places({ action: "here", ...BEDFORD })).body, { kind: "off" }, `here ${why}`);
    assert.deepEqual((await places({ action: "locate", id: "jfk-t4" })).body, { kind: "off" }, `locate a row ${why}`);
    assert.deepEqual((await places({ action: "locate", ticket })).body, { kind: "off" }, `locate a ticket ${why}`);
  };
  Object.assign(process.env, { GOOGLE_MOCK: "true", PLACE_TICKET_SECRET: TICKET_SECRET });
  await both("under GOOGLE_MOCK without MAP_MOCK");
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { GOOGLE_MAPS_SERVER_KEY: SERVER_KEY, GOOGLE_MAPS_BROWSER_KEY: BROWSER_KEY, PLACE_TICKET_SECRET: TICKET_SECRET });
  reply = answer(200, { results: [v4("277 Bedford Ave, Brooklyn, NY 11211, USA", [state("NY", "New York"), county("Kings County"), zip("11211")])] });
  await both("without GOOGLE_MAPS_JS");
  process.env.GOOGLE_MAPS_JS = "off";
  await both("with GOOGLE_MAPS_JS=off");
  process.env.GOOGLE_MAPS_JS = "on";
  delete process.env.GOOGLE_MAPS_BROWSER_KEY;
  await both("without a browser key");
  assert.equal(calls.length, 0, "no Geocoding request while the map is off");
  process.env.GOOGLE_MAPS_BROWSER_KEY = BROWSER_KEY;
  assert.equal((await places({ action: "here", ...BEDFORD })).body.kind, "ok", "the switch on answers again");
  assert.equal(calls.length, 1);
});

await test("U12 a typed New York City name is drawn and priced on one route, the options price reuses its token with no Routes call, and an area pick drawn on the map gets no distance price from its token", async () => {
  mock();
  const r = await route({ from: { text: "Civic Center" }, to: { text: BEDFORD_LABEL }, stops: [], date: DATE, time: "14:30", draw: 1 });
  assert.deepEqual([r.body.kind, typeof r.body.route], ["ok", "string"]);
  for (const key of ENV_KEYS) delete process.env[key];
  live();
  reply = answer(500, {});
  const o = await book(fields({ from_text: "Civic Center", route: r.body.route, draw: "1" }));
  assert.equal(calls.filter((c) => c.url.startsWith("https://routes.googleapis.com")).length, 0, "no Routes call");
  assert.deepEqual([o.body.kind, o.body.service, o.body.ride.minutes, o.body.ride.miles], ["options", "distance", r.body.minutes, r.body.miles]);
  for (const key of ENV_KEYS) delete process.env[key];
  mock();
  const label = "Manhattan, New York, NY";
  const area = signTicket("ChIJmanhattan", "manhattan", label, Date.now(), true);
  const drawn = await route({ from: { ticket: area }, to: { text: BEDFORD_LABEL }, stops: [], date: DATE, time: "14:30", draw: 1 });
  assert.deepEqual([drawn.body.kind, typeof drawn.body.route], ["ok", "string"]);
  const q = await book(fields({ from_text: label, from_ticket: area, route: drawn.body.route }));
  assert.deepEqual([q.body.kind, q.body.reason, q.body.classes.every((c) => c.total_cents === null && c.reason === "street-address"), "route" in q.body], ["quote", "street-address", true, false]);
});

if (failures) {
  printError(`\n${failures} test(s) failed`);
  process.exit(1);
}
print("\nAll map API tests passed");
process.exit(0);
