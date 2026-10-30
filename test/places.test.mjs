import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { PLACE_LIST, ZONES, AIRPORT_ZONES, AREA_LABELS, NEIGHBORHOODS, norm, lite, zipBorough, classifyText, classifyPlace, localById, areaText, routeText } from "../api/_places.mjs";
import { TICKET, TICKET_TTL, ticketKey, labelHash, signTicket, verifyTicket, placeProof, proofOk } from "../api/_ticket.mjs";
import { PLACES, AIRPORT_FARES, AIRPORT_TOTALS } from "../api/_rates.mjs";
import { POST } from "../api/places.mjs";
import { readInput, readSettings, resolveTrip, resolveEnd, checkTrip, priceTrip } from "../api/_trip.mjs";
import { LABELS, REASONS } from "../api/_copy.mjs";

const SITE = "https://www.nycluxride.com";
const SERVER_KEY = "test-server-key-SENTINEL";
const SESSION = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const NOW = Date.parse("2026-10-01T16:00:00.000Z");
const ENV_KEYS = ["GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "PLACE_TICKET_SECRET", "GOOGLE_MOCK", "FLIGHT_MOCK", "VERCEL_ENV"];
const DASHES = /[\u2013\u2014;]/;
const IDS = [
  "jfk", "jfk-t1", "jfk-t4", "jfk-t5", "jfk-t7", "jfk-t8", "lga", "lga-ta", "lga-tb", "lga-tc", "ewr", "ewr-ta", "ewr-tb", "ewr-tc",
  "teb", "teb-atlantic", "teb-jet", "teb-sig-east", "teb-sig-south", "teb-sig-west", "hpn", "hpn-million", "hpn-atlantic", "hpn-signature",
  "isp", "swf", "swf-atlantic", "swf-signature", "frg", "frg-main", "frg-atlantic", "frg-modern",
];
const DENYLIST = [
  "inwood", "kensington", "chelsea", "floral park", "bellerose", "new hyde park", "brookville", "eastchester", "huguenot", "madison", "charleston",
  "arlington", "schuylerville", "park hill", "belmont", "clifton", "melrose", "woodlawn", "oakwood", "silver lake", "concourse", "bruckner", "erasmus",
  "farragut", "rugby", "utopia", "wingate", "travis", "steinway", "ditmars", "red hook", "norwood", "hillcrest", "washington heights", "mount hope",
  "yorkville", "shore acres", "murray hill",
];
const MODZCTA_CITY_ZIPS = [
  "10001 10002 10003 10004 10005 10006 10007 10009 10010 10011 10012 10013 10014 10016 10017 10018 10019 10020 10021 10022 10023 10024 10025 10026",
  "10027 10028 10029 10030 10031 10032 10033 10034 10035 10036 10037 10038 10039 10040 10044 10065 10069 10075 10103 10110 10111 10112 10115 10118",
  "10119 10128 10152 10153 10154 10162 10165 10167 10168 10169 10170 10171 10172 10173 10174 10177 10199 10271 10278 10279 10280 10282 10301 10302",
  "10303 10304 10305 10306 10307 10308 10309 10310 10311 10312 10314 10451 10452 10453 10454 10455 10456 10457 10458 10459 10460 10461 10462 10463",
  "10464 10465 10466 10467 10468 10469 10470 10471 10472 10473 10474 10475 11004 11005 11101 11102 11103 11104 11105 11106 11109 11201 11203 11204",
  "11205 11206 11207 11208 11209 11210 11211 11212 11213 11214 11215 11216 11217 11218 11219 11220 11221 11222 11223 11224 11225 11226 11228 11229",
  "11230 11231 11232 11233 11234 11235 11236 11237 11238 11239 11243 11249 11351 11354 11355 11356 11357 11358 11359 11360 11361 11362 11363 11364",
  "11365 11366 11367 11368 11369 11370 11372 11373 11374 11375 11377 11378 11379 11385 11411 11412 11413 11414 11415 11416 11417 11418 11419 11420",
  "11421 11422 11423 11424 11425 11426 11427 11428 11429 11432 11433 11434 11435 11436 11451 11691 11692 11693 11694 11697",
].join(" ").split(" ");
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

let failures = 0;
async function test(name, fn) {
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

function request(body, { origin = SITE, type = "application/json", ip, site, raw, length } = {}) {
  const headers = { "content-type": type, origin };
  if (ip) headers["x-real-ip"] = ip;
  if (site) headers["sec-fetch-site"] = site;
  if (length) headers["content-length"] = String(length);
  return new Request(`${SITE}/api/places`, { method: "POST", headers, body: raw ?? JSON.stringify(body) });
}

async function call(body, options) {
  const res = await POST(request(body, options));
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, headers: res.headers, body: JSON.parse(text) };
}

const suggest = (input, extra = {}) => ({ action: "suggest", input, session: SESSION, ...extra });
const pick = (id, label, extra = {}) => ({ action: "pick", id, session: SESSION, label, proof: placeProof(id, label), ...extra });
const labelOf = (item) => (item.main + (item.secondary ? `, ${item.secondary}` : "")).replace(/, USA$/, "");
const proofed = (items) => items.map((item) => ({ ...item, proof: createHmac("sha256", ticketKey()).update(`p1.${item.id}.${labelHash(labelOf(item))}`).digest("base64url") }));
const component = (types, longText, shortText = longText) => ({ longText, shortText, types });
const details = ({ state, county, sub, zip, types = ["street_address"], address = "" }) => ({
  id: "ChIJtest",
  formattedAddress: address,
  shortFormattedAddress: address.split(",")[0],
  addressComponents: [
    state && component(["administrative_area_level_1", "political"], state === "NY" ? "New York" : state, state),
    county && component(["administrative_area_level_2", "political"], county),
    sub && component(["sublocality_level_1", "sublocality", "political"], sub),
    zip && component(["postal_code"], zip),
  ].filter(Boolean),
  types,
});

await test("PLACE_LIST holds the 32 rows of the table in order, frozen, with the record shape", () => {
  assert.deepEqual(PLACE_LIST.map((row) => row.id), IDS);
  assert.ok(Object.isFrozen(PLACE_LIST) && PLACE_LIST.every((row) => Object.isFrozen(row) && Object.isFrozen(row.aliases) && Object.isFrozen(row.keys)));
  for (const row of PLACE_LIST) {
    assert.deepEqual(Object.keys(row), ["id", "label", "sub", "zone", "iata", "kind", "parent", "aliases", "keys", "addr", "gid"]);
    assert.equal(row.gid, "");
    assert.ok(row.label && row.sub && row.addr && row.keys.length, row.id);
  }
});

await test("ids are unique, zones are airport zones, kinds and parents are valid, iata matches the parent", () => {
  assert.equal(new Set(IDS).size, IDS.length);
  for (const row of PLACE_LIST) {
    assert.ok(AIRPORT_ZONES.includes(row.zone), row.id);
    assert.ok(["airport", "terminal", "fbo"].includes(row.kind), row.id);
    if (row.kind === "airport") assert.equal(row.parent, "", row.id);
    else {
      const parent = localById(row.parent);
      assert.ok(parent && parent.kind === "airport", row.id);
      assert.equal(parent.zone, row.zone, row.id);
      assert.equal(parent.iata, row.iata, row.id);
      assert.ok(row.label.startsWith(`${parent.label}, `), row.id);
    }
  }
  assert.deepEqual(PLACE_LIST.filter((row) => row.zone !== "airport-other").map((row) => row.zone).filter((zone, i, all) => all.indexOf(zone) === i), ["jfk", "lga", "ewr", "teb"]);
});

await test("labels and aliases are unique across rows after norm, and keys are never server aliases", () => {
  const seen = new Map();
  for (const row of PLACE_LIST) {
    for (const name of [row.label, ...row.aliases]) {
      const key = norm(name);
      assert.ok(!seen.has(key) || seen.get(key) === row.id, `${name} in ${row.id} and ${seen.get(key)}`);
      seen.set(key, row.id);
    }
    assert.ok(!row.aliases.map(norm).includes(norm(row.label)), `${row.id} repeats its label`);
  }
  assert.equal(classifyText("John F. Kennedy").zone, "unknown");
  assert.equal(classifyText("terminal 4").zone, "unknown");
});

await test("no em dash, en dash or semicolon in any label, sub, addr, alias or key", () => {
  for (const row of PLACE_LIST) for (const text of [row.label, row.sub, row.addr, ...row.aliases, ...row.keys]) assert.ok(!DASHES.test(text), `${row.id}: ${text}`);
});

await test("the labels of the owner examples exist", () => {
  assert.equal(localById("jfk-t5").label, "John F. Kennedy (JFK), Terminal 5");
  assert.equal(localById("ewr-tb").label, "Newark Liberty (EWR), Terminal B");
  assert.equal(localById("lga").sub, "LaGuardia Airport, East Elmhurst, NY 11371");
  assert.equal(localById("nope"), null);
  assert.equal(localById(undefined), null);
});

await test("norm and lite follow 4.2", () => {
  assert.equal(norm("John F. Kennedy (JFK), Terminal 4"), "john f kennedy jfk terminal 4");
  assert.equal(norm("  Hell\u2019s   Kitchen\u2014NYC "), "hell's kitchen nyc");
  assert.equal(norm("\uFF2A\uFF46\uFF4B"), "jfk");
  assert.equal(lite("  350 5th Ave,  New York, NY 10118, USA "), "350 5th ave, new york, ny 10118");
  assert.equal(lite("Hoboken, NJ, United States"), "hoboken, nj");
  assert.equal(lite("Hoboken, NJ, US"), "hoboken, nj");
});

const EXAMPLES = [
  ["JFK", "jfk", "jfk"], ["jfk airport", "jfk", "jfk"], ["John F. Kennedy (JFK), Terminal 4", "jfk", "jfk-t4"], ["JFK Airport, Queens, NY 11430", "jfk", "jfk"],
  ["LaGuardia", "lga", "lga"], ["LaGuardia Place, New York, NY", "manhattan", ""], ["John F. Kennedy Blvd, Jersey City, NJ", "outside", ""],
  ["John F Kennedy Blvd", "unknown", ""], ["Kennedy", "unknown", ""], ["Newark", "unknown", ""], ["Newark airport", "ewr", "ewr"], ["Teterboro", "teb", "teb"],
  ["HPN", "airport-other", "hpn"], ["350 5th Ave, New York, NY 10118", "manhattan", ""], ["350 5th Ave, 10118", "manhattan", ""], ["350 5th Ave", "unknown", ""],
  ["The Plaza Hotel", "unknown", ""], ["The Plaza Hotel, 10019", "manhattan", ""], ["277 Bedford Ave, Brooklyn, NY 11211", "brooklyn", ""],
  ["Queens Blvd", "unknown", ""], ["Manhattan Ave, Brooklyn", "brooklyn", ""], ["Brooklyn, MI", "outside", ""], ["Hoboken, NJ 07030", "outside", ""],
  ["07030", "outside", ""], ["Great Neck, NY", "unknown", ""], ["Floral Park, NY 11001", "outside", ""], ["11005", "queens", ""], ["Flushing, NY", "queens", ""],
  ["Astoria, NY 11102", "queens", ""], ["Williamsburg", "unknown", ""], ["Williamsburg, VA", "outside", ""], ["SoHo, New York", "manhattan", ""],
  ["Upper East Side, NYC", "manhattan", ""], ["Inwood, NY", "unknown", ""], ["Murray Hill, NY", "unknown", ""], ["Yankee Stadium, Bronx", "bronx", ""],
  ["St. George, Staten Island", "staten-island", ""], ["Pennsylvania Ave, Brooklyn", "brooklyn", ""],
  ["Little Italy, Baltimore", "unknown", ""], ["Port Richmond, Philadelphia", "unknown", ""], ["Financial District, Boston", "unknown", ""], ["Union Square, San Francisco", "unknown", ""],
  ["South Beach, Miami", "unknown", ""], ["Clinton Hill, Newark", "unknown", ""], ["Coney Island, Cincinnati", "unknown", ""], ["Richmond Hill, ON", "unknown", ""],
  ["Little Italy", "manhattan", ""], ["Union Square, New York", "manhattan", ""], ["Clinton Hill, Brooklyn", "brooklyn", ""],
  ["JFK Airport, Queens", "jfk", "jfk"], ["LaGuardia Airport, Queens, NY", "lga", "lga"], ["Newark Liberty International Airport, Newark, NJ 07114", "ewr", "ewr"],
  ["Teterboro Airport, Teterboro, NJ 07608", "teb", "teb"], ["123 Frelinghuysen Ave, Newark, NJ 07114", "outside", ""], ["100 Main St, Teterboro, NJ 07608", "outside", ""],
  ["123 Main St, Flushing, NY 11354 USA", "queens", ""], ["123 Main St, Flushing, NY 11354, USA", "queens", ""],
  ["LGA Airport", "lga", "lga"], ["EWR Airport", "ewr", "ewr"], ["TEB Airport", "teb", "teb"], ["JFK International", "jfk", "jfk"], ["JFK airport terminal 4", "jfk", "jfk-t4"],
  ["LGA Airport, Queens, NY", "lga", "lga"], ["EWR Airport, Newark, NJ", "ewr", "ewr"], ["Newark Liberty Terminal C", "ewr", "ewr-tc"],
];

await test(`classifyText gives every example of 4.3 (${EXAMPLES.length})`, () => {
  for (const [text, zone, id] of EXAMPLES) assert.deepEqual(classifyText(text), { zone, id }, text);
});

await test("classifyText: more state, ZIP, borough and city rules", () => {
  const cases = [
    ["Hoboken NJ 07030", "outside"], ["Portland, OR 97201", "outside"], ["Stamford, Connecticut", "outside"], ["1 Main St, Greenwich, CT, USA", "outside"],
    ["pick me up in front", "unknown"], ["Vermont St, Brooklyn", "brooklyn"], ["pick me up in 10001", "manhattan"], ["Queens, NY 11430", "unknown"],
    ["LaGuardia Airport, East Elmhurst, NY 11371", "lga"], ["350 5th Ave, New York, NY 10118-0110", "manhattan"], ["1 Main St, New York, NY, USA", "manhattan"],
    ["East New York, NY", "brooklyn"], ["Brooklyn Bridge", "unknown"], ["Brooklyn Bridge Park, Brooklyn", "brooklyn"], ["the bronx", "bronx"],
    ["Staten Island Mall", "unknown"], ["10550", "outside"], ["Manhattan, KS", "outside"], ["Red Hook, NY", "unknown"], ["Red Hook, Brooklyn", "brooklyn"],
    ["Bedford-Stuyvesant, NY", "brooklyn"], ["Co-op City, New York City", "bronx"], ["Hell's Kitchen, NYC", "manhattan"], ["Kingston, Jamaica", "unknown"],
  ];
  for (const [text, zone] of cases) assert.equal(classifyText(text).zone, zone, text);
});

await test("classifyText: an airport typed with its code, or named after a terminal in a later part, is that airport, and look-alike streets, places and other codes are not", () => {
  const cases = [
    ["LaGuardia Airport (LGA)", "lga", "lga"], ["JFK Airport (JFK)", "jfk", "jfk"], ["Newark Liberty International Airport (EWR)", "ewr", "ewr"], ["Teterboro Airport (TEB)", "teb", "teb"],
    ["Terminal 4, JFK Airport, Queens, NY", "jfk", "jfk"], ["Terminal B, LaGuardia Airport, Queens, NY", "lga", "lga"], ["LaGuardia Airport (LGA), Queens, NY", "lga", "lga"],
    ["Terminal C, Newark Liberty International Airport, Newark, NJ", "ewr", "ewr"], ["Arrivals, JFK Airport Terminal 4, Queens", "jfk", "jfk-t4"],
    ["LaGuardia Airport (JFK)", "unknown", ""], ["New York (LGA)", "unknown", ""], ["Hilton, JFK, Queens", "queens", ""], ["LaGuardia Pl, New York, NY 10012", "manhattan", ""],
    ["LaGuardia Community College, Long Island City, NY", "queens", ""], ["JFK Blvd, Philadelphia, PA", "outside", ""], ["100 Main St, Teterboro, NJ 07608", "outside", ""], ["Newark, NJ", "outside", ""],
  ];
  for (const [text, zone, id] of cases) assert.deepEqual(classifyText(text), { zone, id }, text);
});

await test("classifyText reads a ZIP code typed before New York, NY, NYC or New York City at the end of the text, and a house number or an airport ZIP code there stays unknown", () => {
  const cases = [
    ["1535 Broadway, 10036 New York", "manhattan"], ["Empire State Building, 10118, NYC", "manhattan"], ["Times Square, 10036 New York, USA", "manhattan"], ["Flushing, 11354 New York", "queens"],
    ["277 Bedford Ave, 11211 NY", "brooklyn"], ["1 Richmond Terrace, 10301 New York City", "staten-island"], ["Yankee Stadium, 10451-2100, New York, NY", "bronx"], ["123 Main St, 10601, New York, NY", "unknown"], ["123 Main St, 10601 New York", "outside"],
    ["10036 Broadway, New York", "unknown"], ["TWA Hotel, 11430 New York", "unknown"], ["Terminal B, 11371 NYC", "unknown"],
  ];
  for (const [text, zone] of cases) assert.deepEqual(classifyText(text), { zone, id: "" }, text);
  assert.deepEqual(["1535 Broadway, 10036 New York", "Empire State Building, 10118, NYC"].map(areaText), [false, false]);
});

await test("areaText marks text that names only a borough, New York, a ZIP code or a state, and never a street address, a place, a neighborhood or a town", () => {
  for (const text of ["Manhattan", "Brooklyn 11201", "Brooklyn NY", "The Bronx", "Staten Island, NY", "New York, NY", "10001", "New York, NY 10001", "Queens, USA", "Manhattan, New York City, NY 10001, USA", "07030", "07030, NJ", "NJ 07094", "07094-1234", "New Jersey 07030"]) assert.equal(areaText(text), true, text);
  for (const text of ["Times Square, New York, NY", "Upper East Side, New York, NY", "Williamsburg, Brooklyn, NY", "350 5th Ave, New York, NY 10118", "The Plaza Hotel, New York, NY", "Bronx Zoo", "Staten Island Ferry", "Brooklyn Bridge Park, Brooklyn, NY", "Manhattan Ave, Brooklyn, NY", "JFK Airport, Queens, NY", "pick me up in 10001", "Hoboken, NJ", "Hoboken, NJ 07030", "Secaucus, NJ 07094", "Greenwich, CT 06830", "12 Washington St, Hoboken, NJ 07030"]) assert.equal(areaText(text), false, text);
});

await test("areaText also marks a county and a borough named with its designator, and never a place, a building or a road that carries the word county or borough", () => {
  for (const text of ["Bergen County, NJ", "Bergen County, NJ, USA", "Morris County, NJ 07960", "Fairfield County, CT", "Hudson County, NJ", "Westchester County, NY 10601", "St. Lawrence County, NY", "Queens County", "Bronx County", "Kings County, NY", "Borough of Manhattan", "Manhattan Borough", "Borough of Queens, NY"]) assert.equal(areaText(text), true, text);
  for (const text of ["Kings County Hospital, 451 Clarkson Ave, Brooklyn, NY 11203", "Bergen County Courthouse, 10 Main St, Hackensack, NJ 07601", "Galloping Hill Golf Course, Union County, NJ", "Orange County Choppers, Newburgh, NY", "County Line Rd, Westbury, NY 11590", "1 County Rd, Secaucus, NJ 07094", "Brooklyn Borough Hall", "Queens County Farm Museum, Floral Park, NY", "Union County College, Cranford, NJ", "Secaucus, NJ 07094", "Hoboken, NJ"]) assert.equal(areaText(text), false, text);
});

await test("classifyText: text that names a New York City ZIP code or New York, NY and also another state or a ZIP code outside the city is unknown, so it asks for the ZIP code or a pick, while an address outside the city with neither stays outside", () => {
  for (const text of ["350 5th Ave, New York, NY 10118, NJ", "350 5th Ave, New York, NY 10118, CT", "350 5th Ave, New York, NY, NJ 07030", "350 5th Ave, 07030, New York, NY", "1 Main St, New York, NY 10701", "350 5th Ave, New York, NY 10118 07030"]) assert.deepEqual(classifyText(text), { zone: "unknown", id: "" }, text);
  for (const text of ["New York Ave, Union City, NJ 07087", "100 Manhattan Ave, Union City, NJ", "10020 Kennedy Blvd, North Bergen, NJ 07047", "West New York, NJ 07093", "1 Main St, White Plains, NY 10601", "Yonkers, New York 10701", "Secaucus, NJ 07094", "Greenwich, CT 06830"]) assert.deepEqual(classifyText(text), { zone: "outside", id: "" }, text);
  assert.deepEqual(classifyText("350 5th Ave, New York, NY 10118"), { zone: "manhattan", id: "" });
});

await test("routeText gives a typed New York City name its borough and NY, so Google routes it inside the city, and leaves an address with a ZIP code, NY, New York or NYC and every other zone as typed", () => {
  const cases = [
    ["Civic Center", "Civic Center, Manhattan, NY"], ["Manhattan Beach", "Manhattan Beach, Brooklyn, NY"], ["South Beach", "South Beach, Staten Island, NY"], ["Castle Hill", "Castle Hill, The Bronx, NY"],
    ["Union Square", "Union Square, Manhattan, NY"], ["Vermont St, Brooklyn", "Vermont St, Brooklyn, NY"], ["Yankee Stadium, Bronx", "Yankee Stadium, Bronx, NY"], ["Manhattan", "Manhattan, NY"],
    ["350 5th Ave, New York, NY 10118", "350 5th Ave, New York, NY 10118"], ["Times Square, New York", "Times Square, New York"], ["Upper East Side, NYC", "Upper East Side, NYC"],
    ["pick me up in 10001", "pick me up in 10001"], ["Hoboken, NJ", "Hoboken, NJ"], ["Secaucus, NJ 07094", "Secaucus, NJ 07094"],
  ];
  for (const [text, sent] of cases) assert.equal(routeText(text, classifyText(text).zone), sent, text);
  for (const zone of ["outside", "unknown", "jfk", "airport-other"]) assert.equal(routeText("Civic Center", zone), "Civic Center", zone);
  assert.equal(classifyText("Vermont St, Brooklyn").zone, "brooklyn", "the borough pattern keeps no state between calls");
});

await test(`zipBorough gives a borough for every MODZCTA ZIP (${MODZCTA_CITY_ZIPS.length}) and not New York City for the listed ZIPs`, () => {
  assert.ok(MODZCTA_CITY_ZIPS.length > 200);
  const boroughs = ["manhattan", "brooklyn", "queens", "bronx", "staten-island"];
  for (const zip of MODZCTA_CITY_ZIPS) assert.ok(boroughs.includes(zipBorough(zip)), zip);
  for (const zip of ["10550", "07030", "06830", "11550", "11001", "11003", "11040"]) assert.equal(zipBorough(zip), "outside", zip);
  for (const zip of ["11430", "11371", "1001", "100011", "", "abcde", undefined]) assert.equal(zipBorough(zip), "", String(zip));
  assert.deepEqual(["10118", "10301", "10451", "11211", "11101", "11004", "11005", "11691"].map(zipBorough), ["manhattan", "staten-island", "bronx", "brooklyn", "queens", "queens", "queens", "queens"]);
});

await test("NEIGHBORHOODS holds normalized names, no denylisted or multi-borough name, and borough zones only", () => {
  const names = Object.keys(NEIGHBORHOODS);
  assert.ok(names.length > 200);
  assert.ok(Object.isFrozen(NEIGHBORHOODS));
  for (const name of names) assert.equal(norm(name), name);
  for (const name of DENYLIST) assert.ok(!(name in NEIGHBORHOODS), name);
  for (const zone of Object.values(NEIGHBORHOODS)) assert.ok(["manhattan", "brooklyn", "queens", "bronx", "staten-island"].includes(zone), zone);
  assert.deepEqual([NEIGHBORHOODS.astoria, NEIGHBORHOODS.soho, NEIGHBORHOODS["bedford stuyvesant"], NEIGHBORHOODS["co op city"], NEIGHBORHOODS["st george"]], ["queens", "manhattan", "brooklyn", "bronx", "staten-island"]);
});

await test("ZONES, AIRPORT_ZONES and AREA_LABELS", () => {
  assert.deepEqual(ZONES, ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "jfk", "lga", "ewr", "teb", "airport-other", "outside", "unknown"]);
  assert.deepEqual(AIRPORT_ZONES, ["jfk", "lga", "ewr", "teb", "airport-other"]);
  assert.deepEqual(AREA_LABELS, { ...PLACES, "airport-other": "Price on request", unknown: "ZIP code needed" });
  assert.deepEqual(ZONES.map((zone) => AREA_LABELS[zone]), ["Manhattan", "Brooklyn", "Queens", "The Bronx", "Staten Island", "JFK", "LaGuardia (LGA)", "Newark Liberty (EWR)", "Teterboro (TEB)", "Price on request", "Outside New York City", "ZIP code needed"]);
});

await test("classifyPlace on synthetic Place Details objects", () => {
  const cases = [
    [details({ state: "NY", county: "Kings County", sub: "Brooklyn", zip: "11211", address: "277 Bedford Ave, Brooklyn, NY 11211, USA" }), "277 Bedford Avenue, Brooklyn, NY, USA", "brooklyn"],
    [details({ state: "NY", county: "Queens County", sub: "Queens", zip: "11430", types: ["airport"], address: "JFK Terminal 4, Jamaica, NY 11430, USA" }), "JFK Terminal 4, Queens, NY, USA", "jfk"],
    [details({ state: "NY", county: "Queens County", zip: "11371", types: ["airport", "international_airport"], address: "LaGuardia Airport, Queens, NY 11371, USA" }), "LaGuardia Airport", "lga"],
    [details({ state: "NJ", county: "Essex County", zip: "07114", types: ["international_airport", "airport"], address: "3 Brewster Rd, Newark, NJ 07114, USA" }), "Newark Liberty International Airport, Newark, NJ, USA", "ewr"],
    [details({ state: "NJ", county: "Bergen County", zip: "07608", types: ["point_of_interest"], address: "200 Fred Wehran Dr, Teterboro, NJ 07608, USA" }), "Signature Aviation, Fred Wehran Drive, Teterboro, NJ, USA", "teb"],
    [details({ state: "NY", county: "Westchester County", zip: "10604", types: ["airport"], address: "240 Airport Rd, White Plains, NY 10604, USA" }), "Westchester County Airport", "airport-other"],
    [details({ state: "NJ", county: "Hudson County", zip: "07030", types: ["locality", "political"], address: "Hoboken, NJ 07030, USA" }), "Hoboken, NJ, USA", "outside"],
    [details({ state: "NY", county: "Nassau County", zip: "11001", types: ["locality", "political"], address: "Floral Park, NY 11001, USA" }), "Floral Park, NY, USA", "outside"],
    [details({ state: "NY", county: "New York County", sub: "Manhattan", zip: "10010", types: ["lodging"] }), "The New York EDITION", "manhattan"],
    [details({ state: "NY", county: "Richmond County", zip: "10301" }), "1 Bay St", "staten-island"],
    [details({ state: "NY", county: "Bronx County", zip: "10451" }), "1 E 161st St", "bronx"],
    [details({ state: "NY", sub: "Queens", zip: "11101" }), "Long Island City", "queens"],
    [details({ state: "NY", zip: "11201" }), "Brooklyn Heights", "brooklyn"],
    [details({ state: "NJ", zip: "07608", types: ["point_of_interest"] }), "Some office, Teterboro, NJ", "outside"],
    [details({ state: "NJ", zip: "07114", types: ["airport"], address: "Somewhere, NJ 07114" }), "Cargo airport", "airport-other"],
    [details({ state: "NJ", county: "Essex County", zip: "07114", types: ["premise"], address: "Terminal B, Newark, NJ 07114, USA" }), "Terminal B, Brewster Road, Newark, NJ", "ewr"],
    [details({ state: "NJ", county: "Essex County", zip: "07114", types: ["lodging"], address: "1 Hotel Rd, Newark, NJ 07114, USA" }), "Newark Liberty International Airport Marriott, Hotel Road, Newark, NJ", "ewr"],
    [details({ state: "NJ", county: "Bergen County", zip: "07608", types: ["point_of_interest"], address: "111 Fred Wehran Dr, Teterboro, NJ 07608, USA" }), "Flexjet Teterboro Private Terminal, Fred Wehran Drive, Teterboro, NJ", "teb"],
    [details({ state: "NJ", county: "Bergen County", zip: "07608", types: ["street_address"], address: "485 Industrial Ave, Teterboro, NJ 07608, USA" }), "485 Industrial Ave, Teterboro, NJ", "teb"],
    [details({ state: "NJ", county: "Bergen County", zip: "07608", types: ["shopping_mall"], address: "1 Teterboro Landing Dr, Teterboro, NJ 07608, USA" }), "Teterboro Landing, Industrial Avenue, Teterboro, NJ", "outside"],
    [details({ state: "NJ", county: "Essex County", zip: "07114", types: ["premise", "geocode"], address: "Terminal C, Newark, NJ 07114, USA" }), "Terminal C, Newark Liberty International Airport (EWR), Brewster Road, Newark, NJ", "ewr"],
    [details({ state: "NY", types: ["locality", "political"] }), "New York, NY", "manhattan"],
    [details({ state: "NY", types: ["locality", "political"] }), "New York City, NY", "manhattan"],
    [details({ state: "NY", types: ["locality", "political"] }), "New York, NY, USA", "manhattan"],
    [details({ state: "NY", types: ["administrative_area_level_1", "political"] }), "New York, USA", "outside"],
    [details({ state: "NY", county: "Westchester County", types: ["locality", "political"] }), "Yonkers, NY", "outside"],
    [details({ state: "NY", types: ["locality", "political"] }), "New York Mills, NY", "outside"],
    [details({ state: "NJ", types: ["locality", "political"] }), "New York, NY", "outside"],
    [details({ state: "NJ", county: "Essex County", zip: "07114", types: ["premise"], address: "123 Frelinghuysen Ave, Newark, NJ 07114, USA" }), "123 Frelinghuysen Avenue, Newark, NJ, USA", "outside"],
    [{}, "", "outside"],
    [null, "", "outside"],
  ];
  for (const [place, label, zone] of cases) assert.equal(classifyPlace(place, label), zone, label);
});

await test("classifyPlace looks components up by type, never by position", () => {
  const place = details({ state: "NY", county: "Kings County", zip: "11211" });
  place.addressComponents.reverse();
  assert.equal(classifyPlace(place, "x"), "brooklyn");
});

await test("tickets: a round trip gives the id and zone back, the label hash is the first 16 base64url characters of sha256(norm(label))", () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const label = "The New York EDITION, Madison Avenue, New York, NY, USA";
  assert.equal(labelHash(label), createHash("sha256").update(norm(label)).digest("base64url").slice(0, 16));
  const ticket = signTicket("ChIJabc123", "manhattan", label, NOW);
  assert.match(ticket, TICKET);
  assert.ok(!ticket.includes(SERVER_KEY));
  const [, payload, mac] = ticket.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { v: 1, id: "ChIJabc123", z: "manhattan", h: labelHash(label), t: NOW / 1000 });
  const key = createHmac("sha256", SERVER_KEY).update("nlr place ticket v1").digest();
  assert.equal(mac, createHmac("sha256", key).update(`v1.${payload}`).digest("base64url"));
  assert.deepEqual(verifyTicket(ticket, label, NOW + 1000), { id: "ChIJabc123", zone: "manhattan", expired: false });
  assert.deepEqual(verifyTicket(ticket, "  the new york edition madison avenue new york ny usa ", NOW), { id: "ChIJabc123", zone: "manhattan", expired: false });
  assert.deepEqual(verifyTicket(ticket, null, NOW), { id: "ChIJabc123", zone: "manhattan", expired: false });
});

await test("tickets: a tampered payload or mac, another label, a wrong key and a bad shape are refused, an old one is expired", () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const label = "277 Bedford Avenue, Brooklyn, NY, USA";
  const ticket = signTicket("ChIJbedford", "brooklyn", label, NOW);
  const [, payload, mac] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, id: "ChIJbedford", z: "jfk", h: labelHash(label), t: NOW / 1000 })).toString("base64url");
  assert.equal(verifyTicket(`v1.${forged}.${mac}`, label, NOW), null);
  assert.equal(verifyTicket(`v1.${payload}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`, label, NOW), null);
  assert.equal(verifyTicket(ticket, "Hoboken, NJ, USA", NOW), null);
  assert.equal(verifyTicket(`v2.${payload}.${mac}`, label, NOW), null);
  assert.equal(verifyTicket("", label, NOW), null);
  assert.equal(verifyTicket(12, label, NOW), null);
  assert.deepEqual(verifyTicket(ticket, label, NOW + TICKET_TTL * 1000), { id: "ChIJbedford", zone: "brooklyn", expired: false });
  assert.deepEqual(verifyTicket(ticket, label, NOW + (TICKET_TTL + 1) * 1000), { id: "ChIJbedford", zone: "brooklyn", expired: true });
  process.env.GOOGLE_MAPS_SERVER_KEY = "another-server-key";
  assert.equal(verifyTicket(ticket, label, NOW), null);
});

await test("tickets: no key means none are issued or accepted, PLACE_TICKET_SECRET of 32 characters wins, the mock key only outside production", () => {
  assert.equal(ticketKey(), null);
  assert.equal(signTicket("ChIJx", "queens", "x", NOW), "");
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const ticket = signTicket("ChIJx", "queens", "x", NOW);
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  assert.equal(verifyTicket(ticket, "x", NOW), null);
  process.env.PLACE_TICKET_SECRET = "short-secret";
  assert.equal(ticketKey(), null);
  process.env.PLACE_TICKET_SECRET = "s".repeat(32);
  assert.deepEqual(ticketKey(), Buffer.from("s".repeat(32)));
  const own = signTicket("ChIJx", "queens", "x", NOW);
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  assert.deepEqual(verifyTicket(own, "x", NOW), { id: "ChIJx", zone: "queens", expired: false });
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.GOOGLE_MOCK = "true";
  assert.deepEqual(ticketKey(), createHmac("sha256", "nlr-mock-ticket").update("nlr place ticket v1").digest());
  process.env.VERCEL_ENV = "production";
  assert.equal(ticketKey(), null);
});

const AUTOCOMPLETE = {
  suggestions: [
    {
      placePrediction: {
        placeId: "ChIJedition",
        text: { text: "The New York EDITION, Madison Avenue, New York, NY, USA" },
        structuredFormat: { mainText: { text: "The New York EDITION", matches: [{ startOffset: 13, endOffset: 20 }] }, secondaryText: { text: "Madison Avenue, New York, NY, USA" } },
        types: ["lodging", "point_of_interest", "establishment", "hotel"],
      },
    },
    { queryPrediction: { text: { text: "edition hotels" } } },
    { placePrediction: { placeId: "ChIJtimes", structuredFormat: { mainText: { text: "EDITION Times Square", matches: [{ endOffset: 7 }] } }, types: ["lodging"] } },
    { placePrediction: { placeId: "ChIJplain", text: { text: "Edison, NJ, USA" } } },
    { placePrediction: { placeId: "ChIJ4", structuredFormat: { mainText: { text: "Four" } } } },
    { placePrediction: { placeId: "ChIJ5", structuredFormat: { mainText: { text: "Five" } } } },
    { placePrediction: { placeId: "ChIJ6", structuredFormat: { mainText: { text: "Six" } } } },
  ],
};

await test("suggest with a key: the exact request, field mask and body, the key only in the header, at most 5 items in Google's order", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  reply = answer(200, AUTOCOMPLETE);
  const res = await call(suggest("edition"));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": SERVER_KEY,
    "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
  });
  assert.deepEqual(JSON.parse(init.body), {
    input: "edition",
    sessionToken: SESSION,
    includedRegionCodes: ["us"],
    languageCode: "en",
    regionCode: "us",
    locationBias: { circle: { center: { latitude: 40.758, longitude: -73.9855 }, radius: 50000 } },
  });
  assert.ok(init.signal instanceof AbortSignal);
  assert.ok(!url.includes(SERVER_KEY) && !init.body.includes(SERVER_KEY));
  assert.deepEqual(res.body, {
    kind: "ok",
    google: true,
    items: proofed([
      { id: "ChIJedition", main: "The New York EDITION", mainMatches: [[13, 20]], secondary: "Madison Avenue, New York, NY, USA", types: ["lodging", "point_of_interest", "establishment", "hotel"] },
      { id: "ChIJtimes", main: "EDITION Times Square", mainMatches: [[0, 7]], secondary: "", types: ["lodging"] },
      { id: "ChIJplain", main: "Edison, NJ, USA", mainMatches: [], secondary: "", types: [] },
      { id: "ChIJ4", main: "Four", mainMatches: [], secondary: "", types: [] },
      { id: "ChIJ5", main: "Five", mainMatches: [], secondary: "", types: [] },
    ]),
    typed: { zone: "unknown", area: "ZIP code needed" },
  });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.ok(![...res.headers.keys()].some((name) => name.startsWith("access-control")));
});

await test("suggest without a key answers google false with the typed area and never calls fetch", async () => {
  const res = await call(suggest("350 5th Ave, 10118"));
  assert.deepEqual(res.body, { kind: "ok", google: false, items: [], typed: { zone: "manhattan", area: "Manhattan" } });
  assert.equal(calls.length, 0);
  assert.deepEqual((await call(suggest("350 5th Ave"))).body.typed, { zone: "unknown", area: "ZIP code needed" });
  assert.deepEqual((await call(suggest("Hoboken, NJ"))).body.typed, { zone: "outside", area: "Outside New York City" });
  assert.deepEqual((await call(suggest("HPN"))).body.typed, { zone: "airport-other", area: "Price on request" });
});

await test("suggest: an address typed in the JFK or LaGuardia ZIP code without the airport's name answers its typed area as an airport ZIP code with the text of the airport ZIP code request as its hint, and no other typed answer has a hint", async () => {
  for (const text of ["TWA Hotel, One Idlewild Dr, Jamaica, NY 11430", "Terminal B, East Elmhurst, NY 11371", "TWA Hotel, 11430 New York"]) assert.deepEqual((await call(suggest(text))).body.typed, { zone: "unknown", area: LABELS.airportZip, hint: REASONS["airport-zip"].text }, text);
  assert.equal(LABELS.airportZip, "Airport ZIP code");
  assert.deepEqual((await call(suggest("TWA Hotel at JFK, Jamaica, NY 11430"))).body.typed, { zone: "jfk", area: AREA_LABELS.jfk });
  assert.deepEqual((await call(suggest("3 Brewster Rd, Newark, NJ 07114"))).body.typed, { zone: "outside", area: "Outside New York City" });
  assert.deepEqual((await call(suggest("The Plaza Hotel"))).body.typed, { zone: "unknown", area: "ZIP code needed" });
  assert.equal(calls.length, 0);
});

await test("suggest: a Google error or timeout answers kind error with google true and the typed area, logs only the code", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  logs.length = 0;
  reply = answer(429, { error: { message: `quota for ${SERVER_KEY}` } });
  assert.deepEqual((await call(suggest("edition"))).body, { kind: "error", google: true, items: [], typed: { zone: "unknown", area: "ZIP code needed" } });
  reply = () => {
    throw new Error("timeout");
  };
  assert.equal((await call(suggest("edition"))).body.kind, "error");
  assert.deepEqual(logs, ["places-suggest 429", "places-suggest 0"]);
});

await test("bad requests: a wrong action, input, session, id or label answers 400 bad, without a call", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const cases = [
    { action: "other", input: "edition", session: SESSION },
    suggest("ed"),
    suggest("x".repeat(201)),
    suggest(12),
    suggest("edition", { session: SESSION.toUpperCase() }),
    suggest("edition", { session: "3f2b8c1e-4a5d-3e6f-9a7b-1c2d3e4f5a6b" }),
    suggest("edition", { session: "" }),
    pick("abc", "The label"),
    pick("ChIJ space", "The label"),
    pick("ChIJedition", ""),
    pick("ChIJedition", "x".repeat(201)),
    pick("ChIJedition", "The label", { session: "nope" }),
  ];
  for (const body of cases) assert.deepEqual(await call(body).then((res) => [res.status, res.body]), [400, { kind: "error", code: "bad" }], JSON.stringify(body).slice(0, 80));
  for (const raw of ["[]", "null", "\"text\"", "{bad json"]) assert.deepEqual(await call(null, { raw }).then((res) => [res.status, res.body]), [400, { kind: "error", code: "bad" }], raw);
  assert.equal(calls.length, 0);
});

await test("a cross-site request is 403, another type 415, a large body 413, and only POST is exported", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  assert.deepEqual(await call(suggest("edition"), { site: "cross-site" }).then((res) => [res.status, res.body]), [403, { kind: "error", code: "origin" }]);
  assert.deepEqual(await call(suggest("edition"), { site: "same-site" }).then((res) => [res.status, res.body]), [403, { kind: "error", code: "origin" }]);
  assert.deepEqual(await call(suggest("edition"), { origin: "https://evil.example" }).then((res) => [res.status, res.body]), [403, { kind: "error", code: "origin" }]);
  assert.deepEqual(await call(suggest("edition"), { type: "text/plain" }).then((res) => [res.status, res.body]), [415, { kind: "error", code: "type" }]);
  assert.deepEqual(await call(suggest("edition"), { type: "application/x-www-form-urlencoded" }).then((res) => [res.status, res.body]), [415, { kind: "error", code: "type" }]);
  assert.deepEqual(await call(suggest("edition"), { length: 1025 }).then((res) => [res.status, res.body]), [413, { kind: "error", code: "too-large" }]);
  assert.deepEqual(await call(null, { raw: JSON.stringify(suggest("edition", { pad: "x".repeat(1100) })) }).then((res) => [res.status, res.body]), [413, { kind: "error", code: "too-large" }]);
  assert.equal(calls.length, 0);
  const module = await import("../api/places.mjs");
  assert.deepEqual(Object.keys(module), ["POST"]);
});

await test("pick with a key: Place Details with the Essentials mask, the zone, area and airport flag, a ticket that verifies, and the map flag only with the browser key and signing secret", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  reply = answer(200, details({ state: "NY", county: "New York County", sub: "Manhattan", zip: "10010", types: ["lodging", "hotel"], address: "Madison Ave, New York, NY 10010, USA" }));
  const label = "The New York EDITION, Madison Avenue, New York, NY, USA";
  const res = await call(pick("ChIJedition", label));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://places.googleapis.com/v1/places/ChIJedition?sessionToken=${SESSION}&languageCode=en&regionCode=us`);
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(calls[0].init.headers, { "X-Goog-Api-Key": SERVER_KEY, "X-Goog-FieldMask": "id,formattedAddress,shortFormattedAddress,addressComponents,types,location" });
  assert.deepEqual(Object.keys(res.body), ["kind", "zone", "area", "airport", "ticket", "map"]);
  assert.deepEqual([res.body.kind, res.body.zone, res.body.area, res.body.airport, res.body.map], ["ok", "manhattan", "Manhattan", false, false]);
  assert.deepEqual(verifyTicket(res.body.ticket, label, Date.now()), { id: "ChIJedition", zone: "manhattan", expired: false });
  assert.ok(!JSON.stringify(res.body).includes("Madison Ave, New York, NY 10010"));
  reply = answer(200, details({ state: "NY", county: "Queens County", zip: "11430", types: ["airport"], address: "JFK Terminal 4, Jamaica, NY 11430, USA" }));
  process.env.GOOGLE_MAPS_BROWSER_KEY = "test-browser-key";
  const airport = await call(pick("ChIJjfkt4", "JFK Terminal 4, Queens, NY, USA"));
  assert.deepEqual([airport.body.zone, airport.body.area, airport.body.airport, airport.body.map], ["jfk", "JFK", true, false]);
  process.env.GOOGLE_MAPS_SIGNING_SECRET = "dGVzdC1zZWNyZXQ=";
  assert.equal((await call(pick("ChIJjfkt4", "JFK Terminal 4, Queens, NY, USA"))).body.map, true);
  delete process.env.GOOGLE_MAPS_BROWSER_KEY;
  assert.equal((await call(pick("ChIJjfkt4", "JFK Terminal 4, Queens, NY, USA"))).body.map, false);
});

await test("pick: the New York City entry of Google has no county, borough or ZIP and still prices as Manhattan at the airport rates, its ticket marks it as an area that gets no distance price, and the New York State entry stays outside", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const city = { id: "ChIJOwg_06VPwokRYv534QaPC8g", formattedAddress: "New York, NY, USA", shortFormattedAddress: "New York", addressComponents: [component(["locality", "political"], "New York"), component(["administrative_area_level_1", "political"], "New York", "NY"), component(["country", "political"], "United States", "US")], types: ["locality", "political", "geocode"] };
  reply = answer(200, city);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 10 * 86400000));
  for (const label of ["New York, NY", "New York City, NY"]) {
    const res = await call(pick(city.id, label));
    assert.deepEqual([res.body.kind, res.body.zone, res.body.area, res.body.airport], ["ok", "manhattan", "Manhattan", false], label);
    assert.deepEqual(verifyTicket(res.body.ticket, label, Date.now()), { id: city.id, zone: "manhattan", expired: false, area: true });
    const fields = { trip_type: "one", from_text: label, from_ticket: res.body.ticket, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: day, time: "14:00", passengers: "1", class: "suv", action: "options" };
    const airport = await resolveTrip(readInput(fields), { now: Date.now() });
    assert.deepEqual([airport.from, priceTrip(airport).total], ["manhattan", AIRPORT_TOTALS.suv.jfk], label);
    const before = calls.length;
    const ride = await resolveTrip(readInput({ ...fields, to_text: "277 Bedford Ave, Brooklyn, NY 11211", to_id: "" }), { now: Date.now() });
    assert.deepEqual([checkTrip(ride, Date.now(), readSettings({ PAYMENTS_ENABLED: "true" })), calls.length], [{ kind: "quote", reason: "street-address", field: "" }, before], label);
  }
  reply = answer(200, { ...city, id: "ChIJstate", formattedAddress: "New York, USA", addressComponents: city.addressComponents.slice(1), types: ["administrative_area_level_1", "political", "geocode"] });
  assert.equal((await call(pick("ChIJstate", "New York, USA"))).body.zone, "outside");
});

await test("pick marks a borough, a town, a ZIP code, a county or a state as an area in its ticket, and never a street address, a premise, a hotel, a neighborhood, an airport or a place that is also a point of interest", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const cases = [
    [details({ state: "NY", county: "New York County", sub: "Manhattan", types: ["sublocality_level_1", "sublocality", "political"] }), "Manhattan, New York, NY", "manhattan", true],
    [details({ state: "NJ", county: "Hudson County", zip: "07030", types: ["locality", "political"] }), "Hoboken, NJ", "outside", true],
    [details({ state: "NY", sub: "Brooklyn", zip: "11201", types: ["postal_code"] }), "11201, Brooklyn Heights, NY", "brooklyn", true],
    [details({ state: "NJ", county: "Bergen County", types: ["administrative_area_level_2", "political"] }), "Bergen County, NJ", "outside", true],
    [details({ state: "NJ", types: ["administrative_area_level_1", "political"] }), "New Jersey", "outside", true],
    [details({ state: "NY", county: "Kings County", sub: "Brooklyn", zip: "11211", types: ["street_address"] }), "277 Bedford Avenue, Brooklyn, NY", "brooklyn", false],
    [details({ state: "NJ", county: "Hudson County", zip: "07094", types: ["premise"] }), "1 Meadowlands Pkwy, Secaucus, NJ", "outside", false],
    [details({ state: "NY", county: "New York County", sub: "Manhattan", zip: "10010", types: ["lodging", "point_of_interest", "establishment"] }), "The New York EDITION, Madison Avenue, New York, NY", "manhattan", false],
    [details({ state: "NY", county: "New York County", sub: "Manhattan", zip: "10075", types: ["neighborhood", "political"] }), "Upper East Side, New York, NY", "manhattan", false],
    [details({ state: "NY", county: "Queens County", zip: "11430", types: ["airport", "point_of_interest", "establishment"] }), "JFK Terminal 4, Queens, NY", "jfk", false],
    [details({ state: "NJ", county: "Hudson County", zip: "07030", types: ["locality", "political", "point_of_interest"] }), "Hoboken Terminal, Hoboken, NJ", "outside", false],
  ];
  for (const [place, label, zone, area] of cases) {
    reply = answer(200, place);
    const res = await call(pick("ChIJarea", label));
    assert.deepEqual([res.body.kind, res.body.zone], ["ok", zone], label);
    assert.deepEqual(verifyTicket(res.body.ticket, label, Date.now()), { id: "ChIJarea", zone, expired: false, ...(area && { area: true }) }, label);
  }
});

await test("pick signs a ticket for the longest place ID of 300 characters, as Google gives for some intersections, and the ticket of that ID with the longest zone and the area mark still passes the ticket pattern, verifies and reaches the trip", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const id = `Ei${"x".repeat(298)}`;
  const label = "Adam Clayton Powell Jr Blvd & Dr Martin Luther King Jr Blvd, New York, NY";
  reply = answer(200, { ...details({ state: "NY", county: "New York County", types: ["intersection", "geocode"], address: `${label}, USA` }), id });
  const res = await call(pick(id, label));
  assert.deepEqual([res.body.kind, res.body.zone], ["ok", "manhattan"]);
  assert.deepEqual(verifyTicket(res.body.ticket, label, Date.now()), { id, zone: "manhattan", expired: false });
  assert.equal(readInput({ trip_type: "one", from_ticket: res.body.ticket }).from_ticket, res.body.ticket);
  for (const [zone, area] of [["staten-island", true], ["airport-other", true], ["outside", false]]) {
    const ticket = signTicket(id, zone, label, NOW, area);
    assert.match(ticket, TICKET, `${zone} ${ticket.length}`);
    assert.deepEqual(verifyTicket(ticket, label, NOW), { id, zone, expired: false, ...(area && { area: true }) }, zone);
    assert.equal(readInput({ trip_type: "one", to_ticket: ticket }).to_ticket, ticket, zone);
  }
  assert.equal(signTicket(id, "staten-island", label, NOW, true).length, 553);
  assert.equal((await resolveEnd("from", { from_text: label, from_ticket: res.body.ticket }, { now: Date.now() })).place, id);
  assert.equal(calls.length, 1);
});

await test("pick: no key answers off without a call, a Details failure answers error and logs places-pick with the status", async () => {
  assert.deepEqual((await call(pick("ChIJedition", "The label"))).body, { kind: "off" });
  assert.equal(calls.length, 0);
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  logs.length = 0;
  reply = answer(404, { error: "NOT_FOUND" });
  assert.deepEqual((await call(pick("ChIJgone", "The label"))).body, { kind: "error" });
  reply = () => {
    throw new Error("timeout");
  };
  assert.deepEqual((await call(pick("ChIJgone", "The label"))).body, { kind: "error" });
  assert.deepEqual(logs, ["places-pick 404", "places-pick 0"]);
});

await test("GOOGLE_MOCK: the fixtures of 13.6, prefix and contains matching, picks classified by classifyPlace, never fetch", async () => {
  process.env.GOOGLE_MOCK = "true";
  for (const input of ["edi", "edition", "the edition hotel", "EDITION"]) {
    const res = await call(suggest(input));
    assert.equal(res.body.google, true, input);
    assert.deepEqual(res.body.items.map((item) => item.id), ["mock-edition"], input);
  }
  assert.deepEqual((await call(suggest("edition"))).body.items, proofed([{ id: "mock-edition", main: "The New York EDITION", secondary: "Madison Avenue, New York, NY, USA", types: ["lodging", "hotel"], mainMatches: [[13, 20]] }]));
  assert.deepEqual((await call(suggest("the edition hotel"))).body.items[0].mainMatches, []);
  assert.deepEqual((await call(suggest("zzz"))).body.items, []);
  const zones = {};
  for (const [input, id, label] of [["edition", "mock-edition", "The New York EDITION, Madison Avenue, New York, NY, USA"], ["bedford", "mock-bedford", "277 Bedford Avenue, Brooklyn, NY, USA"], ["hoboken", "mock-hoboken", "Hoboken, NJ, USA"], ["westchester", "mock-hpn", "Westchester County Airport, White Plains, NY, USA"], ["terminal 4", "mock-jfk-t4", "JFK Terminal 4, Queens, NY, USA"]]) {
    assert.deepEqual((await call(suggest(input))).body.items.map((item) => item.id), [id], input);
    const res = await call(pick(id, label));
    zones[id] = res.body.zone;
    assert.equal(res.body.map, true, id);
    assert.deepEqual(verifyTicket(res.body.ticket, label, Date.now()).zone, res.body.zone);
  }
  assert.deepEqual(zones, { "mock-edition": "manhattan", "mock-bedford": "brooklyn", "mock-hoboken": "outside", "mock-hpn": "airport-other", "mock-jfk-t4": "jfk" });
  assert.deepEqual((await call(pick("mock-unknown", "x"))).body, { kind: "error" });
  assert.equal(calls.length, 0);
});

await test("GOOGLE_MOCK is refused in production: suggest answers google false, pick off", async () => {
  process.env.GOOGLE_MOCK = "true";
  process.env.VERCEL_ENV = "production";
  assert.deepEqual((await call(suggest("edition"))).body, { kind: "ok", google: false, items: [], typed: { zone: "unknown", area: "ZIP code needed" } });
  assert.deepEqual((await call(pick("mock-edition", "The New York EDITION"))).body, { kind: "off" });
  assert.equal(calls.length, 0);
});

await test("the server resolves a pick itself: a fresh ticket needs no call, an expired one is refreshed with Place Details, a bad one falls back to text rules", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  const label = "277 Bedford Avenue, Brooklyn, NY, USA";
  const fresh = signTicket("ChIJbedford", "brooklyn", label, Date.now());
  const fields = { trip_type: "one", from_text: label, from_ticket: fresh, to_text: "LaGuardia (LGA)", to_id: "lga" };
  const trip = await resolveTrip(readInput(fields), { now: Date.now() });
  assert.deepEqual(trip.ends.from, { text: label, zone: "brooklyn", place: "ChIJbedford", id: "" });
  assert.deepEqual(trip.ends.to, { text: "LaGuardia (LGA)", zone: "lga", place: "lga", id: "lga" });
  assert.equal(calls.length, 0);
  const old = signTicket("ChIJbedford", "jfk", label, Date.now() - (TICKET_TTL + 60) * 1000);
  reply = answer(200, details({ state: "NY", county: "Kings County", zip: "11211" }));
  const refreshed = await resolveEnd("from", readInput({ ...fields, from_ticket: old }), { now: Date.now() });
  assert.deepEqual(refreshed, { text: label, zone: "brooklyn", place: "ChIJbedford", id: "" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places/ChIJbedford?languageCode=en&regionCode=us");
  const other = await resolveEnd("from", readInput({ ...fields, from_text: "Hoboken, NJ" }), { now: Date.now() });
  assert.deepEqual(other, { text: "Hoboken, NJ", zone: "outside", place: "", id: "" });
  const claimed = await resolveEnd("from", readInput({ ...fields, from_ticket: "", from_id: "jfk" }), { now: Date.now() });
  assert.equal(claimed.zone, "brooklyn");
  const stale = signTicket("ChIJhoboken", "outside", "Hoboken, NJ, USA", Date.now() - (TICKET_TTL + 60) * 1000, true);
  reply = answer(200, details({ state: "NJ", county: "Hudson County", zip: "07030", types: ["locality", "political"] }));
  const before = calls.length;
  for (let i = 0; i < 2; i++) assert.deepEqual(await resolveEnd("from", readInput({ ...fields, from_text: "Hoboken, NJ, USA", from_ticket: stale }), { now: Date.now() }), { text: "Hoboken, NJ, USA", zone: "outside", place: "ChIJhoboken", id: "", area: true }, `request ${i + 1}`);
  assert.equal(calls.length, before + 1);
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
  calls.length = 0;
  process.env.PLACE_TICKET_SECRET = "p".repeat(40);
  const kept = signTicket("ChIJbedford", "jfk", "The Plaza Hotel", Date.now() - (TICKET_TTL + 60) * 1000);
  const offline = await resolveEnd("from", readInput({ ...fields, from_text: "The Plaza Hotel", from_ticket: kept }), { now: Date.now() });
  assert.deepEqual(offline, { text: "The Plaza Hotel", zone: "unknown", place: "", id: "" });
  assert.equal(calls.length, 0);
});

await test("pick refuses an id and label pair that suggest did not return, before Place Details is called", async () => {
  process.env.GOOGLE_MOCK = "true";
  logs.length = 0;
  const [item] = (await call(suggest("edition"))).body.items;
  const [other] = (await call(suggest("bedford"))).body.items;
  const label = labelOf(item);
  assert.ok(proofOk(item.id, label, item.proof) && !proofOk(item.id, "12 Washington St, Hoboken, NJ 07030", item.proof));
  const good = await call({ action: "pick", id: item.id, session: SESSION, label, proof: item.proof });
  assert.deepEqual([good.body.kind, good.body.zone], ["ok", "manhattan"]);
  for (const body of [
    { action: "pick", id: item.id, session: SESSION, label: "12 Washington St, Hoboken, NJ 07030", proof: item.proof },
    { action: "pick", id: item.id, session: SESSION, label },
    { action: "pick", id: item.id, session: SESSION, label, proof: other.proof },
    { action: "pick", id: item.id, session: SESSION, label, proof: "A".repeat(43) },
    { action: "pick", id: item.id, session: SESSION, label, proof: `${item.proof}x` },
    { action: "pick", id: item.id, session: SESSION, label, proof: 42 },
  ]) assert.deepEqual(await call(body).then((res) => [res.status, res.body]), [200, { kind: "error" }], JSON.stringify(body).slice(0, 90));
  assert.deepEqual(logs, Array(6).fill("places-pick proof"));
  delete process.env.GOOGLE_MOCK;
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  calls.length = 0;
  assert.deepEqual((await call({ action: "pick", id: "ChIJedition", session: SESSION, label: "1500 Market St, Philadelphia, PA 19102", proof: placeProof("ChIJedition", "The New York EDITION, Madison Avenue, New York, NY, USA") })).body, { kind: "error" });
  assert.equal(calls.length, 0);
});

await test("a Manhattan place labeled Hoboken, NJ never yields a ticket, and JFK to that text is priced as an address outside New York City, never at the Manhattan rate", async () => {
  process.env.GOOGLE_MOCK = "true";
  const [item] = (await call(suggest("edition"))).body.items;
  const forged = await call({ action: "pick", id: item.id, session: SESSION, label: "12 Washington St, Hoboken, NJ 07030", proof: item.proof });
  assert.deepEqual(forged.body, { kind: "error" });
  const fields = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "12 Washington St, Hoboken, NJ 07030", to_ticket: forged.body.ticket || "", date: "2026-10-14", time: "07:30", passengers: "1", class: "suv", action: "options" };
  const trip = await resolveTrip(readInput(fields), { now: NOW });
  assert.deepEqual([trip.to, trip.ends.to.place], ["outside", ""]);
  assert.deepEqual(checkTrip(trip, NOW, readSettings({ PAYMENTS_ENABLED: "true" })), { kind: "price", reason: "", hold: "" });
  assert.deepEqual(trip.legs.map((leg) => [leg.from, leg.to, leg.reason, leg.ride]), [["jfk", "outside", "", { tenths: 168, minutes: 43 }]]);
  const price = priceTrip(trip);
  assert.deepEqual([price.service, price.lines.map(({ label, cents }) => [label, cents]), price.total], ["distance", [["Fare", AIRPORT_FARES.suv.jfk], ["NYC sales tax (8.875%)", 1376], ["Black Car Fund (2.25%)", 349]], 17225]);
});

await test("pick refuses a label whose own words contradict Place Details, and keeps genuine airport and FBO labels", async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = SERVER_KEY;
  logs.length = 0;
  const manhattan = details({ state: "NY", county: "New York County", sub: "Manhattan", zip: "10010", types: ["lodging"] });
  for (const label of ["Newark Liberty (EWR), Terminal B", "Westchester County (HPN)", "1 Main St, Greenwich, CT 06830", "Hoboken, NJ 07030"]) {
    reply = answer(200, manhattan);
    assert.deepEqual((await call(pick("ChIJforged", label))).body, { kind: "error" }, label);
  }
  assert.deepEqual(logs, Array(4).fill("places-pick label"));
  reply = answer(200, details({ state: "NJ", county: "Essex County", zip: "07114", types: ["airport"], address: "3 Brewster Rd, Newark, NJ 07114, USA" }));
  assert.equal((await call(pick("ChIJewr", "Newark Liberty International Airport, Newark, NJ, USA"))).body.zone, "ewr");
  reply = answer(200, details({ state: "NJ", county: "Bergen County", zip: "07608", types: ["point_of_interest"], address: "200 Fred Wehran Dr, Teterboro, NJ 07608, USA" }));
  assert.equal((await call(pick("ChIJsig", "Signature Aviation, Fred Wehran Drive, Teterboro, NJ, USA"))).body.zone, "teb");
  reply = answer(200, details({ state: "NY", county: "Queens County", zip: "11430", types: ["airport"] }));
  assert.equal((await call(pick("ChIJt4", "JFK Terminal 4, Queens, NY, USA"))).body.zone, "jfk");
});

await test("budgets: 120 suggests and 15 picks per address a minute, then 429 busy without typed, another address still answers", async () => {
  process.env.GOOGLE_MOCK = "true";
  const ip = "203.0.113.7";
  const suggests = [];
  for (let i = 0; i < 120; i++) suggests.push((await call(suggest("edition"), { ip })).status);
  assert.deepEqual(suggests, Array(120).fill(200));
  const over = await call(suggest("edition"), { ip });
  assert.deepEqual([over.status, over.body], [429, { kind: "busy" }]);
  assert.equal((await call(suggest("edition"), { ip: "203.0.113.8" })).status, 200);
  const picks = [];
  for (let i = 0; i < 16; i++) picks.push((await call(pick("mock-edition", "The New York EDITION"), { ip: "198.51.100.4" })).status);
  assert.deepEqual(picks, [...Array(15).fill(200), 429]);
  assert.equal((await call(suggest("ed"), { ip })).status, 400);
});

await test("budgets: one instance answers at most 100 picks a minute, then 429 busy for everyone", async () => {
  process.env.GOOGLE_MOCK = "true";
  const statuses = [];
  for (let i = 0; i < 101; i++) statuses.push((await call(pick("mock-edition", "The New York EDITION"))).status);
  const first = statuses.indexOf(429);
  assert.ok(first > 0 && first <= 100, String(first));
  assert.ok(statuses.slice(first).every((status) => status === 429));
  assert.deepEqual((await call(pick("mock-edition", "The New York EDITION"), { ip: "192.0.2.50" })).body, { kind: "busy" });
});

await test("the sentinel key never appears in a response body or a log line, and logs carry codes only", () => {
  assert.ok(bodies.length > 100);
  for (const text of bodies) assert.ok(!text.includes("SENTINEL") && !text.includes(SERVER_KEY), text.slice(0, 80));
  for (const entry of logs) {
    assert.ok(!entry.includes("SENTINEL"), entry);
    assert.match(entry, /^(places-suggest|places-pick|client-budget|handler)( [\w-]+)?$/, entry);
  }
});

console.error = printError;
if (failures) {
  printError(`\n${failures} failing`);
  process.exit(1);
}
print("\nall places tests pass");
