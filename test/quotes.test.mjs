import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { readInput, readSettings, resolveTrip, checkTrip, priceTrip, priceRide, distanceFare, billedMinutes, routeCap, capPrice, classReason, feeOf, nycToUtc, rateKey } from "../api/_trip.mjs";
import { sessionParams } from "../api/_stripe.mjs";
import { CLASSES, AIRPORT_TOTALS, AIRPORT_FARES, LONG_RATES, LONG_MILES, ROUTE_CAPS, TIME_CAP_PER_MILE, TIME_CAP_BASE, DISTANCE_RATES, DISTANCE_LIMITS, VEHICLES } from "../api/_rates.mjs";
import { REASONS, HEADINGS } from "../api/_copy.mjs";
import { classifyText } from "../api/_places.mjs";
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
const PHILADELPHIA = "1500 Market St, Philadelphia, PA 19102";
const WASHINGTON = "1600 Pennsylvania Ave NW, Washington, DC 20500";
const FAR_AIRPORTS = ["Boston Logan International Airport, East Boston, MA 02128", "Philadelphia International Airport, Philadelphia, PA 19153", "Washington Dulles International Airport, Dulles, VA 20166"];
const PRICE_SHOWN = "You see the price when you book, and you can pay online.";
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
const stripeSum = (params) => {
  let sum = 0;
  for (let i = 0; params.has(`line_items[${i}][price_data][unit_amount]`); i++) sum += Number(params.get(`line_items[${i}][price_data][unit_amount]`)) * Number(params.get(`line_items[${i}][quantity]`));
  return sum;
};
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

await test("the public pages say long-distance trips, Sprinters and airports with no flat price show their price when you book and pay online, Canada trips run 24/7 in the Executive Sedan, Business SUV and Business Premium SUV with a car within an hour for a last-minute call, booked by phone or WhatsApp, and no public page keeps any quote or request wording outside the booking form's request blocks", () => {
  assert.equal(LONG_MILES, 75);
  const text = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document.querySelector("main").textContent.replace(/\s+/g, " ");
  const canada = `We drive to Canada 24/7 in the ${CLASSES.sedan.name}, ${CLASSES.suv.name} and ${CLASSES.premium.name}. For a last-minute call, a car can be with you within an hour.`;
  assert.ok(text("long-distance-car-service.html").includes(`${canada} Call or WhatsApp us to book.`));
  assert.ok(text("faq.html").includes(`Yes. ${canada} Call or WhatsApp us to book.`));
  assert.ok(text("rates.html").includes(`Canada trips run 24/7 in the ${CLASSES.sedan.name}, ${CLASSES.suv.name} and ${CLASSES.premium.name}, with a car within an hour for a last-minute call. Call or WhatsApp us to book`));
  const call = new JSDOM(readFileSync(join(ROOT, "long-distance-car-service.html"), "utf8")).window.document.getElementById("canada").nextElementSibling;
  assert.deepEqual([...call.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]), [["tel:+16467750556", "Call"], ["https://wa.me/16467750556", "WhatsApp"]]);
  const rates = [...new JSDOM(readFileSync(join(ROOT, "rates.html"), "utf8")).window.document.querySelectorAll("#quotes dt")].find((dt) => dt.textContent === "Canada").nextElementSibling;
  assert.deepEqual([...rates.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]), [["/long-distance-car-service#canada", "Canada trips run 24/7"], ["tel:+16467750556", "Call"], ["https://wa.me/16467750556", "WhatsApp"]], "the rates page links Call and WhatsApp like the long-distance page");
  const longDay = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document.querySelector("main").innerHTML;
  assert.ok(longDay("roadshow-transportation-nyc.html").includes('For more than 12 hours, <a href="tel:+16467750556">call</a> or <a href="https://wa.me/16467750556">WhatsApp</a> us to book.'));
  assert.ok(longDay("blog/roadshow-day-manhattan-planning-november-19.html").includes('For more than 12 hours or a second car, <a href="tel:+16467750556">call</a> or <a href="https://wa.me/16467750556">WhatsApp</a> us to book.'));
  assert.ok(text("schedule.html").includes("Use this form to book a day longer than 12 hours or a day with many stops."));
  assert.equal(REASONS["hours-range"].text, "You can book 3 to 12 hours online. For more than 12 hours, email or WhatsApp us to book.");
  assert.ok(text("rates.html").includes(`For ${LONG_MILES} miles or more, the price shows when you book and you can pay online`));
  assert.ok(text("rates.html").includes(`For other one-way trips up to ${DISTANCE_LIMITS.miles} miles, you see the total before you pay`));
  assert.ok(text("long-distance-car-service.html").includes(PRICE_SHOWN));
  assert.ok(text("long-distance-car-service.html").includes("choose the car and the price is there. You can pay online. ") && !text("long-distance-car-service.html").includes("Sprinters are by quote"));
  for (const route of ["nyc-to-philadelphia", "nyc-to-boston", "nyc-to-washington-dc", "nyc-to-atlantic-city", "nyc-to-connecticut"]) assert.ok(text(`long-distance-car-service/${route}.html`).includes(PRICE_SHOWN), route);
  assert.ok(text("faq.html").includes("Outside New York City, one-way trips are priced when you book, and you can pay online."));
  for (const file of ["locations/westchester-airport.html", "locations/long-island-macarthur-airport.html", "locations/stewart-airport.html", "locations/republic-airport.html", "locations/philadelphia-airport.html", "locations/bradley-airport.html", "locations/morristown-airport.html"]) assert.ok(text(file).includes(PRICE_SHOWN), file);
  const stale = /\bby quote\b|request a quote|Request this Sprinter|request (?:a|the) (?:Luxury )?Sprinter|check (?:that )?(?:a Sprinter|one) is free|send you a price|reply with a price|price we send you|[Uu]nder 75 miles|we'll quote|doesn't show a total|longer day|person to price/i;
  const hits = [];
  for (const file of htmlFiles(ROOT)) {
    const doc = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
    doc.querySelectorAll("#quote").forEach((x) => x.remove());
    const parts = [doc.body.textContent, ...[...doc.querySelectorAll("meta[content]")].map((m) => m.getAttribute("content")), ...[...doc.querySelectorAll('script[type="application/ld+json"]')].map((x) => x.textContent)].join(" ").replace(/\s+/g, " ");
    const m = stale.exec(parts);
    if (m) hits.push(`${file}: ${parts.slice(Math.max(0, m.index - 60), m.index + 60)}`);
  }
  assert.deepEqual(hits, []);
  for (const t of [canada, PRICE_SHOWN, REASONS["too-many-bags"].text, REASONS["hours-range"].text, HEADINGS.bags]) assert.doesNotMatch(t, /[\u2013\u2014;]/, t);
});

await test("no booking form, reason or pay.js label is left for a long-distance, Sprinter or other airport request, and the bar has no Request a quote or Request this Sprinter label", () => {
  for (const key of ["long-distance", "sprinter-check", "sprinter-quote", "other-airport"]) assert.equal(key in REASONS, false, key);
  assert.deepEqual(["quote", "check"].filter((k) => k in HEADINGS), []);
  for (const file of ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"]) {
    const d = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
    assert.deepEqual([d.getElementById("q-long-distance"), d.getElementById("q-sprinter-check"), d.getElementById("q-sprinter-quote"), d.getElementById("q-other-airport"), d.getElementById("q-long-trip").nextElementSibling.id, d.getElementById("q-seats").nextElementSibling.id], [null, null, null, null, "q-outside-city", "q-too-many-bags"], file);
    assert.doesNotMatch(d.getElementById("quote").textContent, /Request a quote|Request this Sprinter|by quote|is free before you pay/, file);
  }
  const book = readFileSync(join(ROOT, "book.html"), "utf8");
  const pay = readFileSync(join(ROOT, "assets", book.match(/assets\/(pay\.[A-Za-z0-9_-]+\.js)/)[1]), "utf8");
  assert.ok(!/long-distance|sprinter-check|sprinter-quote|other-airport|Request a quote|Request this Sprinter/.test(pay));
  assert.ok(pay.includes('P.hidden=!1;qb(HO||r.reason);bh(!r.pay)'), "a priced answer on hold shows its block and no pay button");
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
    assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents]), [["suv", 21143], ["premium", 25142], ["first", 35428], ["sedan", 19428], ["electric", 28572], ["sprinter", 49502]]);
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

await test("ROUTE_CAPS.boston: anywhere in New York City to Boston and back in an Executive Sedan never passes $780, the other classes in the ratio of their long-distance card at 215 miles and 230 minutes, and the booking shows those capped prices and pays them online", async () => {
  const { boston } = ROUTE_CAPS;
  assert.deepEqual(boston.from, ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "jfk", "lga"]);
  assert.deepEqual([boston.state, boston.towns, boston.miles], ["MA", ["Boston"], 260]);
  const card = (key) => LONG_RATES[key].base + 215 * LONG_RATES[key].mile + 230 * LONG_RATES[key].minute;
  for (const key of Object.keys(boston.totals)) assert.equal(boston.totals[key], Math.round((78000 * card(key)) / card("sedan")), key);
  assert.deepEqual(boston.totals, { suv: 87037, premium: 100061, first: 124045, sedan: 78000, electric: 108403, "sprinter-executive": 198323 });
  await withEnv({ GOOGLE_MOCK: "true" }, async () => {
    for (const [from, to] of [[MANHATTAN, BOSTON], [BOSTON, MANHATTAN]]) {
      const trip = await resolveTrip(readInput({ ...BASE, from_text: from, to_text: to, class: "sedan" }), { now: NOW });
      assert.deepEqual(checkTrip(trip, NOW, ON), { kind: "price", reason: "", hold: "" });
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
  await mocked(async () => {
    const fields = { ...BASE, from_text: MANHATTAN, to_text: BOSTON, date: SOON, time: "10:00", class: "sedan", ...ME };
    const options = await (await post({ ...fields, action: "options", nonce: "nonce-quotes-boston-0001" })).json();
    assert.deepEqual([options.kind, options.service, options.reason, options.pay, options.price.total_cents], ["options", "distance", "", true, 78000]);
    assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents]), [["suv", 87037], ["premium", 100061], ["first", 124045], ["sedan", 78000], ["electric", 108403], ["sprinter", 198323]]);
    assert.ok(options.classes.every((c) => c.total_cents === null || c.total_cents <= boston.totals[rateKey(c.class)]), JSON.stringify(options.classes));
    assert.equal(options.price.lines.reduce((sum, l) => sum + l.cents, 0), 78000);
    assert.ok(decodeURIComponent(options.whatsapp).endsWith("\nTotal shown: $780.00"));
    const paid = await (await post({ ...fields, route: options.route, nonce: "nonce-quotes-boston-0002" })).json();
    assert.equal(paid.kind, "pay");
    const form = await post({ ...fields, route: options.route, nonce: "nonce-quotes-boston-0003" }, true);
    assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/);
    const van = await (await post({ ...fields, class: "sprinter", route: options.route, nonce: "nonce-quotes-boston-0004" })).json();
    assert.equal(van.kind, "pay", "the Executive Sprinter to Boston pays its capped total");
  });
});

await test("long trips are paid online like any other trip: a ride of LONG_MILES miles or more shows its price on the cards and the price box, as options, quote and pay and a form post, the Stripe line items add up to the total, while 74.9 miles prices on the same rule, a long trip in the Executive Sprinter pays too and a trip to Canada is still a quote", async () => {
  await mocked(async () => {
    const departure = nycToUtc(SOON, "10:00").toISOString();
    const key = routeKey({ address: MANHATTAN }, { address: GREENWICH }, departure);
    const fields = { ...BASE, from_text: MANHATTAN, to_text: GREENWICH, date: SOON, time: "10:00", ...ME };
    for (const tenths of [749, 750, 1200]) {
      const route = signRoute([[key, tenths, 90]], Date.now());
      for (const action of ["options", "quote"]) {
        const body = await (await post({ ...fields, route, action, nonce: `nonce-quotes-long-${tenths}-${action}` })).json();
        assert.deepEqual([body.kind, body.reason, body.pay, body.price.total_cents > 0], ["options", "", true, true], `${tenths} ${action}`);
        assert.deepEqual(body.classes.map((c) => c.total_cents === null), [false, false, false, false, false, false], `${tenths} ${action}`);
        assert.equal(body.classes.find((c) => c.class === "suv").total_cents, body.price.total_cents);
        assert.ok(decodeURIComponent(body.whatsapp).includes("\nTotal shown: $"), `${tenths} ${action}`);
      }
      const paid = await (await post({ ...fields, route, nonce: `nonce-quotes-long-${tenths}-pay` })).json();
      assert.equal(paid.kind, "pay", String(tenths));
      const form = await post({ ...fields, route }, true);
      assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/, String(tenths));
      const van = await (await post({ ...fields, route, class: "sprinter", nonce: `nonce-quotes-long-${tenths}-van` })).json();
      assert.deepEqual([van.kind, "url" in van], ["pay", true], String(tenths));
      assert.match((await post({ ...fields, route, class: "sprinter" }, true)).headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/, String(tenths));
    }
    for (const to_text of [MONTAUK, BOSTON, PHILADELPHIA]) {
      const body = await (await post({ ...fields, to_text, nonce: `nonce-quotes-far-${to_text.length}` })).json();
      assert.deepEqual([body.kind, "url" in body], ["pay", true], to_text);
    }
    const canada = await (await post({ ...fields, to_text: "Toronto, ON M5V 3L9", action: "options", nonce: "nonce-quotes-canada-001" })).json();
    assert.deepEqual([canada.kind, canada.reason, "price" in canada, canada.classes.every((c) => c.total_cents === null)], ["quote", "outside-us", false, true]);
    assert.equal((await post({ ...fields, to_text: "Toronto, ON M5V 3L9" }, true)).headers.get("location"), "/book#q-outside-us");
  });
  await withEnv({ GOOGLE_MOCK: "true" }, async () => {
    const trip = await resolveTrip(readInput({ ...BASE, from_text: MANHATTAN, to_text: PHILADELPHIA }), { now: NOW });
    assert.ok(trip.legs[0].ride.tenths >= LONG_MILES * 10, JSON.stringify(trip.legs[0].ride));
    assert.deepEqual([checkTrip(trip, NOW, ON), classReason(trip, trip.class)], [{ kind: "price", reason: "", hold: "" }, ""]);
    for (const cls of CARS) {
      const priced = { ...trip, class: cls };
      const price = priceTrip(priced, ON);
      const params = sessionParams(priced, price, "48213590", ON, NOW, SITE);
      assert.deepEqual([stripeSum(params), Number(params.get("metadata[total_cents]")), price.lines.reduce((sum, l) => sum + l.cents, 0)], [price.total, price.total, price.total], cls);
      assert.ok(price.tolls > 0, `${cls}: the tolls are in the price`);
    }
    assert.equal(classReason({ ...trip, class: "sprinter", vehicle: "sprinter-executive" }, "sprinter"), "", "the last check before Stripe lets the Executive Sprinter pay");
  });
});

await test("a search snippet that says Book online names no airport on the long-distance pages, and a Sprinter named there is never by quote", async () => {
  const files = htmlFiles(ROOT).filter((file) => file.startsWith("long-distance-car-service"));
  assert.ok(files.length >= 6, files.join(" "));
  for (const file of files) {
    const doc = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) {
      const text = doc.querySelector(selector).getAttribute("content");
      if (!/book online/i.test(text)) continue;
      assert.doesNotMatch(text, /\b(?:Logan|PHL|Reagan|Dulles|BWI|ACY|airports?)\b/i, `${file} ${selector}`);
      assert.doesNotMatch(text, /quote/i, `${file} ${selector}`);
    }
  }
});

await test("a far airport typed and not picked from the list is another airport, priced by distance like any ride both ways as options, pay and a form post with its signed route, Logan with the Boston cap, while a street named Airport Road and a hotel by a New York airport keep their own place", async () => {
  for (const text of FAR_AIRPORTS) assert.deepEqual(classifyText(text), { zone: "airport-other", id: "" }, text);
  for (const [text, zone] of [["123 Airport Rd, Allentown, PA 18109", "outside"], ["Airport Rd, Hazleton, PA", "outside"], ["1 Airport Blvd, Pittsburgh, PA 15231", "outside"], ["Hilton Newark Airport, 1170 Spring St, Elizabeth, NJ 07201", "outside"], ["Crowne Plaza JFK Airport, 138-10 135th Ave, Queens, NY 11436", "queens"], ["Newark Liberty International Airport, Newark, NJ 07114", "ewr"], ["Westchester County Airport, White Plains, NY", "airport-other"], [PHILADELPHIA, "outside"]]) assert.equal(classifyText(text).zone, zone, text);
  await mocked(async () => {
    let n = 0;
    for (const airport of FAR_AIRPORTS) {
      for (const ends of [{ from_text: MANHATTAN, to_text: airport }, { from_text: airport, to_text: MANHATTAN }]) {
        const fields = { ...BASE, ...ends, date: SOON, time: "10:00", class: "sedan", ...ME };
        const route = signRoute([[routeKey({ address: ends.from_text }, { address: ends.to_text }, nycToUtc(SOON, "10:00").toISOString()), 2154, 290, 1790]], Date.now());
        const options = await (await post({ ...fields, route, action: "options", nonce: `nonce-quotes-typed-air-${++n}` })).json();
        const trip = await resolveTrip(readInput({ ...fields, route, action: "pay" }), { now: new Date() });
        const want = priceTrip(trip, ON).total;
        assert.deepEqual([options.kind, options.reason, options.service, options.pay, options.price.total_cents, options.classes.every((c) => c.total_cents > 0)], ["options", "", "distance", true, want, true], `${airport} options`);
        if (/Logan/.test(airport)) assert.equal(want, ROUTE_CAPS.boston.totals.sedan, "Logan is in Boston, so the Boston cap holds");
        else assert.ok(want > ROUTE_CAPS.boston.totals.sedan, airport);
        assert.ok(options.price.lines.some((l) => l.label === "Tolls" && l.cents === 1790), `${airport}: the tolls of the route are in the price`);
        const paid = await (await post({ ...fields, route, nonce: `nonce-quotes-typed-air-${++n}` })).json();
        assert.deepEqual([paid.kind, "url" in paid], ["pay", true], `${airport} pay`);
        assert.match((await post({ ...fields, route }, true)).headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/, airport);
      }
    }
  });
});

await test("Midtown to the White House, 226.2 miles and 250 minutes with $31.50 of tolls, shows every car class priced on the long-distance card, the price lines and the Stripe line items add up to the total, the Executive Sedan pays $1,024.87 online and the Executive Sprinter pays too", async () => {
  await mocked(async () => {
    const fields = { ...BASE, from_text: MANHATTAN, to_text: WASHINGTON, date: SOON, time: "10:00", class: "sedan", ...ME };
    const options = await (await post({ ...fields, action: "options", nonce: "nonce-quotes-dc-0000001" })).json();
    assert.deepEqual([options.kind, options.service, options.reason, options.pay, options.price.total_cents], ["options", "distance", "", true, 102487]);
    assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents]), [["suv", 114021], ["premium", 130622], ["first", 161156], ["sedan", 102487], ["electric", 141209], ["sprinter", options.classes.at(-1).total_cents]]);
    assert.ok(options.classes.at(-1).total_cents > 141209, "the Executive Sprinter is priced on its own long-distance card");
    assert.equal(options.price.lines.reduce((sum, l) => sum + l.cents, 0), 102487);
    assert.ok(decodeURIComponent(options.whatsapp).endsWith("\nTotal shown: $1,024.87"));
    const paid = await (await post({ ...fields, route: options.route, nonce: "nonce-quotes-dc-0000002" })).json();
    assert.deepEqual([paid.kind, "url" in paid], ["pay", true]);
    const form = await post({ ...fields, route: options.route, nonce: "nonce-quotes-dc-0000003" }, true);
    assert.match(form.headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/);
    const van = await (await post({ ...fields, class: "sprinter", route: options.route, nonce: "nonce-quotes-dc-0000004" })).json();
    assert.deepEqual([van.kind, "url" in van], ["pay", true]);
    assert.match((await post({ ...fields, class: "sprinter", route: options.route }, true)).headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/);
  });
  await withEnv({ GOOGLE_MOCK: "true" }, async () => {
    const trip = await resolveTrip(readInput({ ...BASE, from_text: MANHATTAN, to_text: WASHINGTON }), { now: NOW });
    assert.deepEqual([trip.legs[0].ride.tenths, trip.legs[0].ride.minutes, trip.legs[0].ride.tolls, checkTrip(trip, NOW, ON)], [2262, 250, 3150, { kind: "price", reason: "", hold: "" }]);
    for (const [cls, total] of [["suv", 114021], ["premium", 130622], ["first", 161156], ["sedan", 102487], ["electric", 141209]]) {
      const priced = { ...trip, class: cls };
      const price = priceTrip(priced, ON);
      const params = sessionParams(priced, price, "48213591", ON, NOW, SITE);
      assert.deepEqual([price.total, stripeSum(params), Number(params.get("metadata[total_cents]")), price.lines.reduce((sum, l) => sum + l.cents, 0)], [total, total, total, total], cls);
    }
    assert.equal(classReason({ ...trip, class: "sprinter", vehicle: "sprinter-executive" }, "sprinter"), "");
  });
});

await test("every Sprinter with a price pays online: an airport Sprinter pays its flat total, a Sprinter by the hour pays its hourly total, the Executive Sprinter by distance pays its card price, the other Sprinters by distance stay a price on request, and every pay post or form post reaches Checkout", async () => {
  await mocked(async () => {
    const airport = { ...BASE, from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: SOON, time: "10:00", class: "sprinter", passengers: "8", ...ME };
    const hourly = { trip_type: "hour", from_text: MANHATTAN, date: SOON, time: "10:00", hours: "4", passengers: "8", class: "sprinter", tip: "0", ...ME };
    const ride = { ...airport, to_text: "277 Bedford Ave, Brooklyn, NY 11211", to_id: "" };
    for (const sprinter of Object.keys(VEHICLES).filter((k) => VEHICLES[k].cls === "sprinter")) {
      const options = await (await post({ ...airport, sprinter, action: "options" })).json();
      assert.deepEqual([options.reason, options.pay, options.price.total_cents, options.vehicles.find((v) => v.vehicle === sprinter).total_cents], ["", true, AIRPORT_TOTALS[sprinter].jfk, AIRPORT_TOTALS[sprinter].jfk], sprinter);
      const hours = await (await post({ ...hourly, sprinter, action: "options" })).json();
      assert.deepEqual([hours.reason, hours.pay, hours.price.total_cents], ["", true, VEHICLES[sprinter].hourly * 4 + feeOf(VEHICLES[sprinter].hourly * 4)], sprinter);
      for (const fields of [airport, hourly]) {
        const body = await (await post({ ...fields, sprinter, nonce: `nonce-quotes-spr-${sprinter.slice(9, 18)}` })).json();
        assert.deepEqual([body.kind, "url" in body], ["pay", true], `${sprinter} ${fields.trip_type}`);
        assert.match((await post({ ...fields, sprinter }, true)).headers.get("location"), /^\/booking-confirmed\?session_id=cs_mock_/, `${sprinter} ${fields.trip_type}`);
      }
      const far = await (await post({ ...ride, sprinter, nonce: `nonce-quotes-ride-${sprinter.slice(9, 18)}` })).json();
      if (sprinter === "sprinter-executive") assert.deepEqual([far.kind, "url" in far], ["pay", true], sprinter);
      else assert.deepEqual([far.kind, far.reason, "url" in far], ["quote", "sprinter-price", false], sprinter);
    }
    const options = await (await post({ ...ride, action: "options" })).json();
    assert.deepEqual([options.reason, options.pay, options.price.total_cents, options.classes.at(-1).total_cents], ["", true, 39200, 39200]);
  });
  const trip = await resolveTrip(readInput({ ...BASE, from_text: MANHATTAN, to_text: "John F. Kennedy (JFK)", to_id: "jfk", class: "sprinter", passengers: "8" }), { now: NOW });
  assert.deepEqual([classReason(trip, "sprinter"), classReason({ ...trip, passengers: "15" }, "sprinter")], ["", "seats"], "the last check before Stripe refuses only a reason of the class");
  assert.equal(classReason({ ...trip, bags: { large: "11", medium: "", small: "" } }, "sprinter"), "too-many-bags");
});

await test("every airport with no flat price is priced by distance and time like any ride and pays online, picked from the list or typed: Long Island MacArthur, Westchester, Stewart, Republic, Philadelphia, Bradley, Logan, Dulles, BWI, Reagan, Atlantic City, Morristown and Trenton, both ways, with the route's tolls in the price, meet and greet only at the flat airports, and Long Island MacArthur to Midtown in a Business SUV is $378.56", async () => {
  const { GET } = await import("../api/book.mjs");
  const PICKED = [["Long Island MacArthur (ISP)", "isp"], ["Westchester County (HPN)", "hpn"], ["New York Stewart (SWF)", "swf"], ["Republic (FRG)", "frg"], ["Westchester County (HPN), Million Air", "hpn-million"]];
  const TYPED = ["Philadelphia International Airport, Philadelphia, PA 19153", "Bradley International Airport, Windsor Locks, CT 06096", "Boston Logan International Airport, East Boston, MA 02128", "Washington Dulles International Airport, Dulles, VA 20166", "Baltimore/Washington International Thurgood Marshall Airport, Baltimore, MD 21240", "Ronald Reagan Washington National Airport, Arlington, VA 22202", "Atlantic City International Airport, Egg Harbor Township, NJ 08234", "Morristown Municipal Airport, Morristown, NJ 07960", "Trenton-Mercer Airport, West Trenton, NJ 08628"];
  for (const text of TYPED) assert.equal(classifyText(text).zone, "airport-other", text);
  assert.equal("other-airport" in REASONS, false);
  await mocked(async () => {
    let n = 0;
    const ends = [...PICKED.map(([text, id]) => ({ text, id })), ...TYPED.map((text) => ({ text, id: "" }))];
    for (const end of ends) {
      for (const [from, to] of [[end, { text: MANHATTAN, id: "" }], [{ text: MANHATTAN, id: "" }, end]]) {
        const fields = { ...BASE, from_text: from.text, from_id: from.id, to_text: to.text, to_id: to.id, date: SOON, time: "10:00", ...ME };
        const options = await (await post({ ...fields, action: "options", nonce: `nonce-quotes-other-air-${++n}` })).json();
        assert.deepEqual([options.kind, options.reason, options.service, options.pay, options.meet, options.classes.slice(0, 5).every((c) => c.total_cents > 0)], ["options", "", "distance", true, false, true], `${from.text} to ${to.text}`);
        assert.equal(options.classes.find((c) => c.class === "suv").total_cents, options.price.total_cents, `${from.text} to ${to.text}`);
        const paid = await (await post({ ...fields, route: options.route, nonce: `nonce-quotes-other-air-${++n}` })).json();
        assert.deepEqual([paid.kind, "url" in paid], ["pay", true], `${from.text} to ${to.text} pays`);
        const session = await (await GET(new Request(`${SITE}${paid.url.replace("/booking-confirmed", "/api/book")}`))).json();
        assert.deepEqual([session.total_cents, session.notes], [options.price.total_cents, options.price.notes], `${from.text} to ${to.text}: the confirmation has the same total and notes`);
      }
    }
    const isp = await (await post({ ...BASE, from_text: "Long Island MacArthur (ISP)", from_id: "isp", to_text: MANHATTAN, date: SOON, time: "10:00", ...ME, action: "options", nonce: "nonce-quotes-isp-midtown1" })).json();
    assert.deepEqual([isp.ride.miles, isp.ride.minutes, isp.price.lines.map((l) => [l.label, l.cents]), isp.price.total_cents], [50.8, 72, [["Fare", 33180], ["Service fee", 3982], ["Tolls", 694]], 37856], "Long Island MacArthur to 350 5th Ave in a Business SUV, 50.8 miles and 72 min with $6.94 of tolls");
    assert.equal(feeOf(33180), 3982);
    const jfk = await (await post({ ...BASE, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: MANHATTAN, date: SOON, time: "10:00", ...ME, action: "options", nonce: "nonce-quotes-isp-midtown2" })).json();
    assert.deepEqual([jfk.meet, jfk.service], [true, "airport"], "meet and greet stays at JFK");
  });
});

await test("a trip between two airports is priced by distance and time, never below the flat total of either flat airport on it in that class: JFK to LaGuardia over 10.6 miles costs the JFK flat total in every class, Long Island MacArthur to JFK and Newark to Teterboro price by distance, and with the route off it is still the airport-to-airport request", async () => {
  const { floorPrice } = await import("../api/_trip.mjs");
  assert.deepEqual(floorPrice({ fare: 14000, fee: 1680, tolls: 0, total: 15680 }, 18500), { fare: 16518, fee: 1982, tolls: 0, total: 18500 });
  assert.deepEqual(floorPrice({ fare: 30000, fee: 3600, tolls: 1679, total: 35279 }, 18500), { fare: 30000, fee: 3600, tolls: 1679, total: 35279 }, "a dearer ride keeps its own price");
  assert.deepEqual(floorPrice({ fare: 10000, fee: 1200, tolls: 1000, total: 12200 }, 18500), { fare: 15625, fee: 1875, tolls: 1000, total: 18500 }, "the tolls stay and the fare rises");
  await mocked(async () => {
    const departure = nycToUtc(SOON, "10:00").toISOString();
    const short = signRoute([[routeKey({ address: "John F. Kennedy International Airport, Queens, NY 11430" }, { address: "LaGuardia Airport, East Elmhurst, NY 11371" }, departure), 106, 22, 0]], Date.now());
    const fields = { ...BASE, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: "LaGuardia (LGA)", to_id: "lga", date: SOON, time: "10:00", ...ME };
    const options = await (await post({ ...fields, route: short, action: "options", nonce: "nonce-quotes-jfk-lga-0001" })).json();
    assert.deepEqual(options.classes.map((c) => [c.class, c.total_cents]), CARS.map((cls) => [cls, Math.max(AIRPORT_TOTALS[cls].jfk, AIRPORT_TOTALS[cls].lga)]).concat([["sprinter", AIRPORT_TOTALS["sprinter-executive"].jfk]]));
    assert.deepEqual([options.meet, options.pay, options.price.lines.map((l) => l.label)], [true, true, ["Fare", "Service fee"]]);
    const paid = await (await post({ ...fields, route: short, nonce: "nonce-quotes-jfk-lga-0002" })).json();
    assert.equal(paid.kind, "pay");
    for (const [from, to] of [[["Long Island MacArthur (ISP)", "isp"], ["John F. Kennedy (JFK)", "jfk"]], [["Newark Liberty (EWR)", "ewr"], ["Teterboro (TEB)", "teb"]]]) {
      const body = await (await post({ ...BASE, from_text: from[0], from_id: from[1], to_text: to[0], to_id: to[1], date: SOON, time: "10:00", ...ME, action: "options", nonce: `nonce-quotes-pair-${from[1]}-${to[1]}0` })).json();
      assert.deepEqual([body.kind, body.reason, body.service], ["options", "", "distance"], `${from[0]} to ${to[0]}`);
      for (const c of body.classes.slice(0, 5)) assert.ok(c.total_cents >= Math.max(...[from[1], to[1]].filter((z) => AIRPORT_TOTALS[c.class][z]).map((z) => AIRPORT_TOTALS[c.class][z])), `${from[0]} to ${to[0]} ${c.class}`);
    }
  });
  const trip = await resolveTrip(readInput({ ...BASE, from_text: "John F. Kennedy (JFK)", from_id: "jfk", to_text: "LaGuardia (LGA)", to_id: "lga" }), { now: NOW });
  assert.deepEqual(checkTrip(trip, NOW, ON), { kind: "quote", reason: "airport-to-airport", field: "" });
});

if (failures) {
  console.error(`\n${failures} quote test(s) failed`);
  process.exit(1);
}
console.log("\nAll quote tests passed");
