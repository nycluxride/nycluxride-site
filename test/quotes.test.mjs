import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceRide, distanceFare, billedMinutes, routeCap, capPrice, requestOnly, feeOf, nycToUtc, rateKey } from "../api/_trip.mjs";
import { CLASSES, AIRPORT_TOTALS, AIRPORT_FARES, LONG_RATES, LONG_MILES, ROUTE_CAPS, TIME_CAP_PER_MILE, TIME_CAP_BASE, DISTANCE_RATES, VEHICLES } from "../api/_rates.mjs";
import { REASONS, HEADINGS } from "../api/_copy.mjs";
import { routeKey, signRoute, signTicket } from "../api/_ticket.mjs";
import { POST } from "../api/book.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const NOW = new Date("2026-10-01T16:00:00.000Z");
const ON = readSettings({ PAYMENTS_ENABLED: "true" });
const SITE = "https://www.nycluxride.com";
const MANHATTAN = "350 5th Ave, New York, NY 10118";
const GREENWICH = "Greenwich, CT 06830";
const BOSTON = "1 Beacon St, Boston, MA 02108";
const MONTAUK = "1 Ocean Rd, Montauk, NY 11954";
const T4 = { from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4" };
const CPW = "500 Communipaw Avenue, Jersey City, NJ";
const CARS = ["suv", "premium", "first", "sedan", "electric"];
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100", rider: "me", reach: "phone" };
const BASE = { trip_type: "one", date: "2026-10-14", time: "17:00", passengers: "2", class: "suv", tip: "0", action: "pay" };

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.stack || err.message).split("\n").slice(0, 10).join("\n       ")}`);
  }
}

const withEnv = async (env, fn) => {
  const keep = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};
const mocked = (fn) => withEnv({ GOOGLE_MOCK: "true", BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" }, fn);
const post = (fields, form = false) =>
  POST(new Request(`${SITE}/api/book`, { method: "POST", headers: form ? { "content-type": "application/x-www-form-urlencoded", origin: SITE } : { "content-type": "application/json", accept: "application/json", origin: SITE }, body: form ? new URLSearchParams(fields).toString() : JSON.stringify(fields) }));
const ny = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const SOON = ny(Date.now() + 6 * 86400000);
const end = (text, zone, region = zone === "outside" ? "NJ" : "8081") => ({ text, zone, place: "", id: "", region });
const leg = (from, to, ride, back = false) => ({ from: from.zone, to: to.zone, airport: ["jfk", "lga", "ewr", "teb"].includes(from.zone) ? from.zone : ["jfk", "lga", "ewr", "teb"].includes(to.zone) ? to.zone : "", direction: "", back, reason: "", salesTax: { area: "", percent: "0" }, ride });
const rideTrip = (cls, from, to, ride, extra = {}) => ({ trip_type: "one", class: cls, vehicle: cls === "sprinter" ? "sprinter-executive" : "", tip: 0, passengers: "2", date: "2026-10-14", time: "17:00", ends: { from, stop1: null, stop2: null, to }, legs: [leg(from, to, ride)], ...extra });
const JFK = end("John F. Kennedy (JFK), Terminal 4", "jfk");

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "api", ".vercel"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

const PER = /\bper[ -]mile|\bper[ -]minute|\ba mile\b(?! and a half| of each other| south| from)|\bbase (?:rate|fare)|\$\s*\d[\d.,]*\s*(?:base|minimum)\b|distance and time|priced by distance|by distance\b|rates? per mile|long-distance rates|blends? the two/i;

await test("no page shows a per-mile, per-minute or base fare figure or names the distance and time calculation, in the visible text, the attributes, the structured data or the meta tags, apart from the extra waiting charge on the rates page", () => {
  const hits = [];
  const files = htmlFiles(ROOT);
  assert.ok(files.length > 100, String(files.length));
  for (const file of files) {
    const doc = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
    const body = doc.body.cloneNode(true);
    for (const n of [...body.querySelectorAll("script, style, #waiting, form")]) n.parentNode.removeChild(n);
    const parts = [body.textContent, doc.title, ...[...doc.querySelectorAll("meta[content]")].map((m) => m.getAttribute("content")), ...[...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent), ...[...doc.querySelectorAll("main *")].flatMap((el) => [...el.attributes].map((a) => a.value))];
    const text = parts.join(" ").replace(/\s+/g, " ").replace("$1.20 to $4.00 a minute after the free waiting", "");
    const m = PER.exec(text);
    if (m) hits.push(`${file}: ...${text.slice(Math.max(0, m.index - 60), m.index + 40)}...`);
  }
  assert.deepEqual(hits, []);
});

await test("the public pages say trips of LONG_MILES miles or more and Sprinters other than airport transfers are by quote, and that trips to Canada run 24/7 for tourism and transfers in every vehicle, on the rates page, the long-distance page and the FAQ", () => {
  assert.equal(LONG_MILES, 75);
  const text = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document.querySelector("main").textContent.replace(/\s+/g, " ");
  const canada = "We drive to Canada 24/7 for tourism and transfers, in every vehicle, by quote.";
  for (const file of ["long-distance-car-service.html", "faq.html"]) assert.ok(text(file).includes(canada), file);
  assert.ok(text("rates.html").includes("We drive to Canada 24/7 for tourism and transfers, in every vehicle, request a quote"));
  assert.ok(text("rates.html").includes(`For ${LONG_MILES} miles or more, request a quote`));
  assert.ok(text("rates.html").includes("For Sprinter trips other than airport transfers, request a quote"));
  assert.ok(text("long-distance-car-service.html").includes(`Trips of ${LONG_MILES} miles or more are by quote.`));
  for (const t of [canada, REASONS["long-distance"].text, REASONS["sprinter-check"].text, REASONS["sprinter-quote"].text, HEADINGS.quote, HEADINGS.check]) assert.doesNotMatch(t, /[–—;]/, t);
});

await test("every full booking form carries the Request a quote block for long trips, after the very long trip block, and pay.js labels the bar Request a quote or Request this Sprinter", () => {
  for (const file of ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"]) {
    const d = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
    const q = d.getElementById("q-long-distance");
    assert.deepEqual([q.className, q.previousElementSibling.id, q.querySelector("h3").textContent, q.querySelector("p").textContent], ["bk-q", "q-long-trip", HEADINGS.quote, REASONS["long-distance"].text], file);
  }
  const book = readFileSync(join(ROOT, "book.html"), "utf8");
  const pay = readFileSync(join(ROOT, "assets", book.match(/assets\/(pay\.[A-Za-z0-9_-]+\.js)/)[1]), "utf8");
  assert.ok(pay.includes('"long-distance":["Request a quote"],"sprinter-quote":["Request a quote"],"sprinter-check":["Request this Sprinter"]'));
  assert.ok(pay.includes('P.hidden=!1;qb(HO||r.reason);bh(!r.pay)'), "a priced Sprinter shows its request block and no pay button");
});

await test("the billed minutes of a distance ride never pass TIME_CAP_PER_MILE x miles + TIME_CAP_BASE, so traffic cannot raise the price: 25.6 miles bills at most 74 minutes in every class, and the price at 86, 120 or 300 minutes is the price at 74", () => {
  assert.deepEqual([TIME_CAP_PER_MILE, TIME_CAP_BASE], [2.5, 10]);
  assert.deepEqual([billedMinutes(256, 86), billedMinutes(256, 60), billedMinutes(0, 30), billedMinutes(2150, 290)], [74, 60, 10, 290]);
  for (const key of [...CARS, "sprinter-executive"]) {
    const at74 = distanceFare(key, 256, 74);
    for (const minutes of [86, 120, 300]) assert.equal(distanceFare(key, 256, minutes), at74, `${key} ${minutes}`);
    assert.ok(distanceFare(key, 256, 60) <= at74, key);
  }
  assert.equal(distanceFare("suv", 256, 86), 8500 + 10240 + 74 * 65);
});

await test("the First Class lowest price stays $170: DISTANCE_RATES.first.minimum is 17000 and a short ride in First Class costs at least $170 plus the service fee", () => {
  assert.equal(DISTANCE_RATES.first.minimum, 17000);
  for (const [tenths, minutes] of [[0, 0], [9, 8], [46, 27], [60, 20]]) assert.equal(distanceFare("first", tenths, minutes), 17000, `${tenths} ${minutes}`);
  assert.deepEqual(priceRide("first", { tenths: 9, minutes: 8 }), { fare: 17000, fee: 2040, tolls: 0, total: 19040 });
  assert.ok(distanceFare("first", 314, 52) > 17000);
});

await test("ROUTE_CAPS: between JFK, LaGuardia, Queens or Brooklyn and Jersey City, Hoboken, North Bergen or Union City the total never passes the cap of each class, which is the Business SUV $211.43 times the class's JFK total over $185 with the Electric Class at $250, and the Sprinter has no cap", () => {
  const { hudson } = ROUTE_CAPS;
  assert.deepEqual(hudson.from, ["jfk", "lga", "queens", "brooklyn"]);
  assert.deepEqual([hudson.state, hudson.stateName, hudson.towns, hudson.miles], ["NJ", "New Jersey", ["Jersey City", "Hoboken", "North Bergen", "Union City"], LONG_MILES - 1]);
  assert.deepEqual(hudson.totals, { suv: 21143, premium: 25143, first: 35429, sedan: 19428, electric: 28572 });
  for (const cls of ["premium", "first", "electric"]) assert.equal(hudson.totals[cls], Math.round((21143 * AIRPORT_TOTALS[cls].jfk) / AIRPORT_TOTALS.suv.jfk), cls);
  assert.equal(Math.floor((21143 * AIRPORT_TOTALS.sedan.jfk) / AIRPORT_TOTALS.suv.jfk), hudson.totals.sedan, "the owner's $194.28 for the Executive Sedan");
  assert.equal(AIRPORT_TOTALS.electric.jfk, 25000);
  assert.equal("sprinter-executive" in hudson.totals, false);
});

await test("a capped ride keeps the 12% service fee on the fare to the cent and its tolls, and the fare takes the cut so fare + fee + tolls is the cap, or one cent under it when no fare hits it exactly; a lower price stands", () => {
  const ride = { tenths: 256, minutes: 86, tolls: 2720 };
  for (const cls of CARS) {
    const plain = priceRide(cls, ride, ["jfk"]);
    const capped = capPrice(plain, ROUTE_CAPS.hudson.totals[cls]);
    assert.ok(plain.total > ROUTE_CAPS.hudson.totals[cls], cls);
    assert.equal(capped.fee, feeOf(capped.fare), cls);
    assert.equal(capped.tolls, 2720, cls);
    assert.equal(capped.fare + capped.fee + capped.tolls, capped.total, cls);
    assert.ok(capped.total <= ROUTE_CAPS.hudson.totals[cls] && capped.total >= ROUTE_CAPS.hudson.totals[cls] - 1, `${cls} ${capped.total}`);
    assert.ok(capped.fare + 1 + feeOf(capped.fare + 1) + capped.tolls > ROUTE_CAPS.hudson.totals[cls], `${cls}: the highest fare under the cap`);
  }
  assert.deepEqual(capPrice({ fare: 15379, fee: 1845, tolls: 1041, total: 18265 }, 21143), { fare: 15379, fee: 1845, tolls: 1041, total: 18265 });
  assert.deepEqual(capPrice({ fare: 23550, fee: 2826, tolls: 2720, total: 29096 }, 21143), { fare: 16449, fee: 1974, tolls: 2720, total: 21143 });
  assert.deepEqual(capPrice({ fare: 23550, fee: 2826, tolls: 2720, total: 29096 }, null), { fare: 23550, fee: 2826, tolls: 2720, total: 29096 });
});

await test("the cap applies in both directions from JFK, LaGuardia, Queens and Brooklyn to each of the four towns, by name or ZIP code, and not from Manhattan, not to Secaucus or Weehawken, not over 74 miles, not to a town label in another state and not on a trip with a stop", () => {
  const ride = { tenths: 256, minutes: 86, tolls: 2720 };
  const from = [JFK, end("LaGuardia (LGA)", "lga"), end("35-01 Ditmars Blvd, Queens, NY 11105", "queens"), end("1 City Point, Brooklyn, NY 11201", "brooklyn")];
  const to = [end(CPW, "outside"), end("300 Garden Street, Hoboken, NJ, USA", "outside"), end("7000 Kennedy Blvd E, North Bergen, NJ 07047", "outside"), end("3911 Bergenline Ave, Union City, New Jersey", "outside"), end("1 Newark Ave, NJ 07302", "outside", "US")];
  for (const a of from) {
    for (const b of to) {
      for (const cls of CARS) {
        assert.equal(routeCap(rideTrip(cls, a, b, ride), rideTrip(cls, a, b, ride).legs[0], cls), ROUTE_CAPS.hudson.totals[cls], `${a.text} to ${b.text} ${cls}`);
        assert.equal(routeCap(rideTrip(cls, b, a, ride), rideTrip(cls, b, a, ride).legs[0], cls), ROUTE_CAPS.hudson.totals[cls], `${b.text} to ${a.text} ${cls}`);
        assert.ok(priceTrip(rideTrip(cls, a, b, ride), ON).total <= ROUTE_CAPS.hudson.totals[cls], cls);
      }
    }
  }
  const capOf = (a, b, r = ride, extra = {}) => routeCap(rideTrip("suv", a, b, r, extra), rideTrip("suv", a, b, r, extra).legs[0], "suv");
  assert.equal(capOf(end(MANHATTAN, "manhattan"), to[0]), null, "Manhattan is not on the route");
  assert.equal(capOf(JFK, end("806 6th Street, Secaucus, NJ", "outside")), null);
  assert.equal(capOf(JFK, end("1 Hackensack Ave, Weehawken, NJ", "outside")), null);
  assert.equal(capOf(JFK, end("500 Communipaw Avenue, Jersey City, NJ", "outside", "PA")), null, "a Jersey City label placed in another state");
  assert.equal(capOf(JFK, to[0], { tenths: 741, minutes: 150, tolls: 2720 }), null, "over 74 miles");
  for (const tenths of [400, 401, 455, 740]) assert.equal(capOf(JFK, to[0], { tenths, minutes: 150, tolls: 2720 }), 21143, String(tenths));
  const stopped = rideTrip("suv", JFK, to[0], ride);
  stopped.ends.stop1 = end(MANHATTAN, "manhattan");
  assert.equal(routeCap(stopped, stopped.legs[0], "suv"), null);
  assert.equal(routeCap(rideTrip("sprinter", JFK, to[0], ride), rideTrip("sprinter", JFK, to[0], ride).legs[0], "sprinter-executive"), null);
});

await test("a rush-hour detour does not lift the cap: JFK to North Bergen, NJ at 40.0, 40.1, 45.5 and 74.0 miles and 95 to 180 minutes stays at the cap of every class, where 40.1 miles used to cost $371.21 in a Business SUV", () => {
  const bergen = end("7000 Kennedy Blvd E, North Bergen, NJ 07047", "outside");
  for (const [tenths, minutes] of [[400, 95], [401, 95], [455, 95], [455, 180], [740, 180]]) {
    for (const cls of CARS) {
      const ride = { tenths, minutes, tolls: 2720 };
      const uncapped = priceRide(cls, ride, ["jfk"]).total;
      for (const trip of [rideTrip(cls, JFK, bergen, ride), rideTrip(cls, bergen, JFK, ride)]) {
        const price = priceTrip(trip, ON);
        assert.ok(uncapped > ROUTE_CAPS.hudson.totals[cls], `${cls} ${tenths} ${uncapped}`);
        assert.ok(price.total <= ROUTE_CAPS.hudson.totals[cls] && price.total >= ROUTE_CAPS.hudson.totals[cls] - 1, `${cls} ${tenths} ${price.total}`);
        assert.deepEqual([price.fee, price.tolls], [feeOf(price.fare), 2720], cls);
      }
    }
  }
  assert.equal(priceRide("suv", { tenths: 401, minutes: 95, tolls: 2720 }, ["jfk"]).total, 37121);
  assert.equal(priceTrip(rideTrip("suv", JFK, bergen, { tenths: 455, minutes: 95, tolls: 2720 }), ON).total, 21143);
  assert.ok(ROUTE_CAPS.hudson.miles < LONG_MILES, "the cap ends before a trip becomes a quote");
});

await test("a stop takes the trip off the fixed price, and the rates page says so: JFK Terminal 4 with a stop at 350 5th Ave to 500 Communipaw Ave, Jersey City at 5 PM is priced in full with the stop fee, while the same trip with no stops is capped", async () => {
  const routes = new JSDOM(readFileSync(join(ROOT, "rates.html"), "utf8")).window.document.getElementById("routes");
  assert.ok(routes.querySelector(".prose p").textContent.replace(/\s+/g, " ").includes("a trip with no stops never costs more than the price below"));
  assert.ok(routes.querySelector("tfoot td").textContent.startsWith("In either direction with no stops,"));
  await mocked(async () => {
    const now = Date.now();
    const fields = { ...BASE, ...T4, to_text: CPW, to_ticket: signTicket("mock-communipaw", "outside", CPW, now, 0, "NJ"), date: SOON, ...ME, action: "options", nonce: "nonce-quotes-stop-0000001" };
    const plain = await (await post(fields)).json();
    const stopped = await (await post({ ...fields, stop1_text: MANHATTAN })).json();
    assert.equal(plain.price.total_cents, 21143);
    assert.deepEqual(stopped.price.lines.map((l) => [l.label, l.cents]), [["Fare", 23550], ["Service fee", 2826], ["Tolls", 3316], ["Extra stop", 2000]]);
    assert.equal(stopped.price.total_cents, 31692);
    assert.ok(stopped.classes.slice(0, 5).every((c) => c.total_cents > ROUTE_CAPS.hudson.totals[c.class]), JSON.stringify(stopped.classes));
  });
});

await test("no page says Newark costs the same as JFK or Teterboro, or that anything is the same as Newark, since Newark costs more in most cars and SUVs and in every Sprinter, in the visible text, the attributes and the structured data", () => {
  assert.ok(AIRPORT_TOTALS.suv.ewr > AIRPORT_TOTALS.suv.jfk && AIRPORT_TOTALS.suv.ewr > AIRPORT_TOTALS.suv.teb && AIRPORT_TOTALS["sprinter-executive"].ewr > AIRPORT_TOTALS["sprinter-executive"].teb);
  const hits = [];
  for (const file of htmlFiles(ROOT)) {
    const doc = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
    const parts = [doc.body.textContent, ...[...doc.querySelectorAll("meta[content]")].map((m) => m.getAttribute("content")), ...[...doc.querySelectorAll('script[type="application/ld+json"]')].map((x) => x.textContent)];
    for (const sentence of parts.join(" ").replace(/\s+/g, " ").split(/(?<=[.?!])\s+|","/)) {
      if (/same (?:price )?as Newark/i.test(sentence) || (/Newark/.test(sentence) && /cost(?:s)? the same|same (?:price|flat rate|flat price|rate)|is the same for both/i.test(sentence))) hits.push(`${file}: ${sentence.slice(0, 160)}`);
    }
  }
  assert.deepEqual(hits, []);
});

await test("the owner's JFK Terminal 4 to 500 Communipaw Ave, Jersey City at 5 PM, 25.6 miles and 86 min with $27.20 of tolls, is $211.43 in a Business SUV: options, the cards and Stripe agree, the way back is capped too, and a ride under the cap keeps its own price", async () => {
  await mocked(async () => {
    const now = Date.now();
    const to = { to_text: CPW, to_ticket: signTicket("mock-communipaw", "outside", CPW, now, 0, "NJ") };
    const fields = { ...BASE, ...T4, ...to, date: SOON, ...ME, nonce: "nonce-quotes-jc-0000001" };
    const options = await (await post({ ...fields, action: "options" })).json();
    assert.deepEqual([options.kind, options.service, options.pay, options.reason], ["options", "distance", true, ""]);
    assert.deepEqual(options.price.lines.map((l) => [l.label, l.cents]), [["Fare", 16449], ["Service fee", 1974], ["Tolls", 2720]]);
    assert.equal(options.price.total_cents, 21143);
    assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents]), [["suv", 21143], ["premium", 25142], ["first", 35428], ["sedan", 19428], ["electric", 28572], ["sprinter", null]]);
    for (const c of options.classes.slice(0, 5)) assert.ok(c.total_cents <= ROUTE_CAPS.hudson.totals[c.class] && c.total_cents >= ROUTE_CAPS.hudson.totals[c.class] - 1, c.class);
    const paid = await (await post({ ...fields, route: options.route })).json();
    assert.equal(paid.kind, "pay");
    const back = { ...BASE, from_text: CPW, from_ticket: signTicket("mock-communipaw", "outside", CPW, now, 0, "NJ"), to_text: T4.from_text, to_id: "jfk-t4", date: SOON, ...ME, nonce: "nonce-quotes-jc-0000002", action: "options" };
    const home = await (await post(back)).json();
    assert.deepEqual([home.price.total_cents, home.price.lines.map((l) => [l.label, l.cents])], [21143, [["Fare", 16891], ["Service fee", 2027], ["Tolls", 2225]]]);
    const early = await (await post({ ...fields, time: "14:00", action: "options" })).json();
    assert.ok(early.price.total_cents <= 21143);
  });
});

await test("ROUTE_CAPS.boston: anywhere in New York City to Boston and back in an Executive Sedan never passes $780, the other classes in the ratio of their long-distance card at 215 miles and 230 minutes, while the public booking shows Boston only as a request", async () => {
  const { boston } = ROUTE_CAPS;
  assert.deepEqual(boston.from, ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "jfk", "lga"]);
  assert.deepEqual([boston.state, boston.towns, boston.miles], ["MA", ["Boston"], 260]);
  const card = (key) => LONG_RATES[key].base + 215 * LONG_RATES[key].mile + 230 * LONG_RATES[key].minute;
  for (const key of Object.keys(boston.totals)) assert.equal(boston.totals[key], Math.round((78000 * card(key)) / card("sedan")), key);
  assert.deepEqual(boston.totals, { suv: 87037, premium: 100061, first: 124045, sedan: 78000, electric: 108403, "sprinter-executive": 198323 });
  await withEnv({ GOOGLE_MOCK: "true" }, async () => {
    for (const [from, to] of [[MANHATTAN, BOSTON], [BOSTON, MANHATTAN]]) {
      const trip = await resolveTrip(readInput({ ...BASE, from_text: from, to_text: to, class: "sedan" }), { now: NOW });
      assert.deepEqual(checkTrip(trip, NOW, ON), { kind: "quote", reason: "long-distance", field: "" });
      assert.ok(trip.legs[0].ride.tenths > 2100 && trip.legs[0].ride.minutes > 280, JSON.stringify(trip.legs[0].ride));
      for (const cls of [...CARS, "sprinter"]) {
        const key = rateKey(cls, cls === "sprinter" ? "sprinter-executive" : "");
        const uncapped = priceRide(key, trip.legs[0].ride, []).total;
        const price = priceTrip({ ...trip, class: cls, vehicle: cls === "sprinter" ? "sprinter-executive" : "" }, ON);
        assert.ok(uncapped > boston.totals[key], `${cls} ${uncapped}`);
        assert.equal(price.total, boston.totals[key], `${from} ${cls}`);
        assert.equal(price.fee, feeOf(price.fare), cls);
      }
      assert.equal(priceTrip(trip, ON).total, 78000);
    }
    const philly = await resolveTrip(readInput({ ...BASE, from_text: "1500 Market St, Philadelphia, PA 19102", to_text: BOSTON, class: "sedan" }), { now: NOW });
    assert.ok(priceTrip(philly, ON).total > 78000, "Philadelphia is not New York City");
  });
});

await test("long trips are never paid online: a ride of LONG_MILES miles or more is the long-distance request, as options, quote, pay and a form post, with no price on any card and no price in the messages, while 74.9 miles is priced and pays", async () => {
  await mocked(async () => {
    const departure = nycToUtc(SOON, "10:00").toISOString();
    const key = routeKey({ address: MANHATTAN }, { address: GREENWICH }, departure);
    const fields = { ...BASE, from_text: MANHATTAN, to_text: GREENWICH, date: SOON, time: "10:00", ...ME };
    for (const [tenths, want] of [[750, "long-distance"], [1200, "long-distance"], [749, ""]]) {
      const route = signRoute([[key, tenths, 90]], Date.now());
      for (const action of ["options", "quote", "pay"]) {
        const body = await (await post({ ...fields, route, action, nonce: `nonce-quotes-long-${tenths}-${action}` })).json();
        if (want) {
          assert.deepEqual([body.kind, body.reason, "url" in body, "price" in body], ["quote", want, false, false], `${tenths} ${action}`);
          assert.ok(body.classes.every((c) => c.total_cents === null && c.reason === want), `${tenths} ${action}`);
          assert.doesNotMatch(decodeURIComponent(body.whatsapp) + decodeURIComponent(body.mailto), /Total shown|\$\d/, `${tenths} ${action}`);
        } else assert.equal(body.kind, action === "pay" ? "pay" : "options", `${tenths} ${action}`);
      }
      const form = await post({ ...fields, route }, true);
      assert.equal(form.headers.get("location"), want ? "/book#q-long-distance" : form.headers.get("location"), String(tenths));
      if (!want) assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/);
    }
    for (const to_text of [MONTAUK, BOSTON]) {
      const body = await (await post({ ...fields, to_text, nonce: `nonce-quotes-far-${to_text.length}` })).json();
      assert.deepEqual([body.kind, body.reason, "url" in body], ["quote", "long-distance", false], to_text);
    }
  });
});

await test("no Sprinter is ever paid online: an airport Sprinter shows its flat price with the availability check, a Sprinter by distance or by the hour shows no price, and every pay post or form post is refused before Stripe, also when the class card would pay", async () => {
  await mocked(async () => {
    const airport = { ...BASE, from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: SOON, time: "10:00", class: "sprinter", passengers: "8", ...ME };
    const hourly = { trip_type: "hour", from_text: MANHATTAN, date: SOON, time: "10:00", hours: "4", passengers: "8", class: "sprinter", tip: "0", ...ME };
    const ride = { ...airport, to_text: "277 Bedford Ave, Brooklyn, NY 11211", to_id: "" };
    for (const sprinter of Object.keys(VEHICLES).filter((k) => VEHICLES[k].cls === "sprinter")) {
      const options = await (await post({ ...airport, sprinter, action: "options" })).json();
      assert.deepEqual([options.reason, options.pay, options.price.total_cents, options.vehicles.find((v) => v.vehicle === sprinter).total_cents], ["sprinter-check", false, AIRPORT_TOTALS[sprinter].jfk, AIRPORT_TOTALS[sprinter].jfk], sprinter);
      for (const fields of [airport, hourly, ride]) {
        const body = await (await post({ ...fields, sprinter, nonce: `nonce-quotes-spr-${sprinter.slice(9, 18)}` })).json();
        assert.deepEqual([body.kind, body.reason, "url" in body], ["quote", fields === airport ? "sprinter-check" : "sprinter-quote", false], `${sprinter} ${fields.trip_type} ${fields.to_text}`);
        const form = await post({ ...fields, sprinter }, true);
        assert.equal(form.headers.get("location"), fields === airport ? "/book#q-sprinter-check" : "/book#q-sprinter-quote");
      }
    }
    for (const fields of [hourly, ride]) {
      const options = await (await post({ ...fields, action: "options" })).json();
      assert.deepEqual([options.reason, options.pay, options.price, options.classes.at(-1).total_cents], ["sprinter-quote", false, null, null], fields.trip_type);
      assert.doesNotMatch(decodeURIComponent(options.whatsapp), /Total shown|\$\d/);
    }
    assert.deepEqual([HEADINGS.check, REASONS["sprinter-check"].group, REASONS["sprinter-quote"].group], ["Request this Sprinter", "check", "quote"]);
  });
  const trip = await resolveTrip(readInput({ ...BASE, from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", class: "sprinter", passengers: "8" }), { now: NOW });
  assert.equal(requestOnly(trip), "sprinter-check", "the handler's last check before Stripe refuses it too");
  assert.equal(requestOnly({ ...trip, class: "suv" }), "");
});

if (failures) {
  console.error(`\n${failures} quote test(s) failed`);
  process.exit(1);
}
console.log("\nAll quote tests passed");
