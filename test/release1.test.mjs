import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", ".vercel"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

const files = htmlFiles(ROOT);
const pages = new Map(files.map((f) => [f, new JSDOM(readFileSync(join(ROOT, f), "utf8")).window.document]));
const main = (f) => norm(pages.get(f).querySelector("main")?.textContent);
const ld = (f) => [...pages.get(f).querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { const d = JSON.parse(s.textContent); return d["@graph"] || [d]; });
const ldAnswer = (f, name) => ld(f).filter((n) => n["@type"] === "FAQPage").flatMap((n) => n.mainEntity).find((q) => q.name === name)?.acceptedAnswer.text;
const faq = (f, id) => norm(pages.get(f).querySelector(`#${id} .acc__body`)?.textContent);
const question = (f, id) => norm(pages.get(f).querySelector(`#${id} summary`)?.textContent);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

check("index.html: the title, description and H1 all say airport transfers and chauffeur service, with a luxury position", () => {
  const doc = pages.get("index.html");
  const title = norm(doc.querySelector("title").textContent);
  const desc = doc.querySelector('meta[name="description"]').getAttribute("content");
  const h1 = norm(doc.querySelector("main h1").textContent);
  assert.equal(title, "NYC Luxury Airport and Chauffeur Service | NYC LUX RIDE");
  assert.equal(desc, "Luxury airport transfers and chauffeur service in New York City. Flat rates to JFK, LaGuardia, Newark and Teterboro, and cars by the hour.");
  assert.equal(h1, "NYC luxury airport transfers and chauffeur service. Travel in First Class");
  assert.deepEqual([doc.querySelector('meta[property="og:title"]').getAttribute("content"), doc.querySelector('meta[property="og:description"]').getAttribute("content")], [title, desc]);
  assert.ok(title.length <= 59 && desc.length <= 154, `${title.length} ${desc.length}`);
});

check("no page says tolls on distance trips are charged after the ride, and the pages that explain tolls say they are added at booking", () => {
  const old = /On other trips, tolls and parking are charged after the ride|On hourly and other trips|Tolls and any parking go on the card|Any tolls and parking are charged after the ride|added to your card with any parking/;
  assert.deepEqual(files.filter((f) => old.test(main(f)) || ld(f).some((n) => old.test(JSON.stringify(n)))), []);
  for (const f of ["about.html", "contact.html", "schedule.html", "faq.html", "rates.html", "locations/staten-island.html", "long-distance-car-service/nyc-to-boston.html", "long-distance-car-service/nyc-to-philadelphia.html", "long-distance-car-service/nyc-to-connecticut.html", "long-distance-car-service/nyc-to-atlantic-city.html", "long-distance-car-service/nyc-to-washington-dc.html"]) {
    assert.match(main(f), /tolls are added (at booking|to your price when you book)|added to your price when you book/i, f);
  }
});

check("pages promise no instant online price for airports the calculator only quotes", () => {
  const banned = [/All of them are priced when you book/, /Each one is priced when you book/, /Every one is priced when you book/, /The price for each shows when you book/, /well inside our online limit/, /There's no quote to wait for by email/, /priced like any trip outside the city\. Priced by distance/, /other airfields are priced by distance and time/, /Bradley in Connecticut\. Priced by distance and time/];
  assert.deepEqual(files.flatMap((f) => banned.filter((b) => b.test(main(f))).map((b) => `${f}: ${b}`)), []);
  for (const f of ["locations/westchester-airport.html", "locations/long-island-macarthur-airport.html", "locations/stewart-airport.html", "locations/republic-airport.html", "locations/morristown-airport.html", "locations/philadelphia-airport.html", "locations/bradley-airport.html"]) {
    const rail = [...pages.get(f).querySelectorAll("main .rail dl.facts > div")].map((d) => [norm(d.querySelector("dt").textContent), norm(d.querySelector("dd").textContent)]);
    assert.deepEqual(rail.filter(([k]) => k === "Your price"), [["Your price", "For this airport, we'll send you a price."]], f);
    for (const sel of ['meta[name="description"]', 'meta[property="og:description"]']) assert.doesNotMatch(pages.get(f).querySelector(sel).getAttribute("content"), /see your price|price first|price shows|instantly/i, `${f} ${sel}`);
  }
  for (const f of ["locations/bradley-airport.html", "locations/philadelphia-airport.html"]) assert.match(pages.get(f).querySelector('meta[name="description"]').getAttribute("content"), / Book online\.$/, f);
  const sprinter = pages.get("sprinter-van-service-nyc.html").querySelector('meta[name="description"]').getAttribute("content");
  assert.equal(sprinter, "A Mercedes-Benz Sprinter and chauffeur for groups, airport transfers, events and trips to Boston, Philadelphia or the Hamptons. Book online.");
  const county = pages.get("locations/westchester-county.html").querySelector('meta[name="description"]').getAttribute("content");
  assert.match(county, /to JFK, LaGuardia, Newark and Manhattan\. See your price and book online\.$/);
  assert.doesNotMatch(county, /the airports/);
});

check("New Jersey pages offer Newark Airport and Teterboro from New Jersey towns, priced by distance", () => {
  const rows = { "locations/hoboken.html": "Hoboken to Newark Airport", "locations/jersey-city.html": "Exchange Place to Newark Airport", "locations/fort-lee.html": "Fort Lee to Newark Airport", "locations/englewood.html": "Englewood to Newark Airport", "locations/paramus.html": "Garden State Plaza to Newark Airport", "locations/short-hills-livingston.html": "Short Hills to Newark Airport", "locations/morristown.html": "Morristown to Newark Airport", "locations/summit.html": "Summit to Newark Airport", "locations/princeton.html": "Princeton to Newark Airport", "locations/new-jersey.html": "Essex County to Newark Airport" };
  for (const [f, name] of Object.entries(rows)) {
    const row = [...pages.get(f).querySelectorAll("main a.ledger__row")].find((a) => norm(a.querySelector(".ledger__name").textContent) === `${name} rates`);
    assert.ok(row, `${f}: no ${name} row`);
    assert.equal(row.getAttribute("href"), "/rates#distance", f);
    assert.match(norm(row.querySelector(".ledger__note").textContent), /[Aa]bout \d+ miles.*close to \d+ minutes with light traffic\.$/, f);
  }
  assert.ok([...pages.get("locations/fort-lee.html").querySelectorAll("main a.ledger__row")].some((a) => norm(a.textContent).startsWith("Fort Lee to Teterboro")));
  for (const f of ["locations/jersey-city.html", "locations/hoboken.html", "locations/morristown.html", "locations/summit.html", "locations/princeton.html"]) assert.match(norm(pages.get(f).querySelector("title").textContent), /Newark/, f);
  for (const f of ["locations/fort-lee.html", "locations/englewood.html", "locations/alpine-tenafly.html", "locations/new-jersey.html"]) assert.match(pages.get(f).querySelector('meta[name="description"]').getAttribute("content"), /Teterboro/, f);
  assert.match(main("locations/teterboro-airport.html"), /We drive from the FBOs to towns across New Jersey/);
});

check("private flights: lobby or aircraft-side pickup subject to airport access and rules, with no tail number, private flight tracking or private free waiting claims", () => {
  for (const f of ["locations/teterboro-airport.html", "private-jet-car-service-nyc.html", "locations/morristown-airport.html", "locations/republic-airport.html", "blog/teterboro-airport-fbos-manhattan-november-19.html"]) {
    assert.match(main(f), /in the (FBO )?lobby or at the aircraft, subject to airport access and rules\./, f);
  }
  assert.deepEqual(files.filter((f) => /tail number/i.test(main(f))), []);
  assert.doesNotMatch(norm([...pages.get("private-jet-car-service-nyc.html").querySelectorAll("main .prose, main details")].map((e) => e.textContent).join(" ")), /track (your|private) (flight|arrival)|free waiting/i);
});

check("private flights: the Teterboro page and its form promise no flight tracking or free waiting at the search step, and the private aviation booking bars scope free waiting to airline landings", () => {
  const atSearch = pages.get("locations/teterboro-airport.html").querySelector("main").cloneNode(true);
  atSearch.querySelectorAll("[data-show]:not(.is-shown), script, template, datalist").forEach((e) => e.remove());
  assert.ok(atSearch.querySelector("#bk-flight-f") && atSearch.querySelector("#bk-assure"), "the flight field and the trust row show at the search step");
  assert.doesNotMatch(norm(atSearch.textContent), /track your flight|free waiting after you land|live flight tracking/i);
  assert.equal(norm(atSearch.querySelector("#bk-flight-status").textContent), "For a private flight, add the details as a note in the Details step.");
  const assure = (f) => [...pages.get(f).querySelectorAll("#bk-assure > li")].map((li) => norm(li.textContent));
  const jets = ["locations/teterboro-airport.html", "private-jet-car-service-nyc.html", "locations/morristown-airport.html", "locations/republic-airport.html", "locations/westchester-airport.html"];
  for (const f of jets) assert.deepEqual(assure(f), ["Flat airport rates include tolls, airport fees and taxes", "Free waiting after airline landings", "We answer 24 hours a day, every day"], f);
  assert.deepEqual(files.filter((f) => !jets.includes(f) && assure(f).includes("Free waiting after airline landings")), []);
  for (const f of files.filter((x) => pages.get(x).getElementById("bk-incl"))) {
    assert.deepEqual([...pages.get(f).querySelectorAll("#bk-incl > li[data-show]")].map((li) => [li.dataset.show, norm(li.textContent)]), [["from-airline", "Free waiting after you land"], ["from-airline", "Live flight tracking"]], f);
  }
});

check("Westchester Airport, where most flights are private, scopes flight tracking and free waiting to airline flights", () => {
  const rail = Object.fromEntries([...pages.get("locations/westchester-airport.html").querySelectorAll("main .rail dl.facts > div")].map((d) => [norm(d.querySelector("dt").textContent), norm(d.querySelector("dd").textContent)]));
  assert.equal(rail["Flight tracking"], "For airline flights, we move the pickup if your flight lands early or late.");
  assert.equal(rail["Free waiting"], "45 minutes after a domestic airline landing and 60 after an international one.");
  assert.doesNotMatch(main("locations/westchester-airport.html"), /15 at any other pickup/);
});

check("Westchester Airport pickups are offered and no county or state license is named", () => {
  const a = "Yes. It is about 8 miles from Chappaqua and 10 from Scarsdale. We drop off and pick up there. Add your flight number when you book. For this airport, we'll send you a price.";
  assert.deepEqual([faq("locations/westchester-county.html", "q-wch-hpn"), ldAnswer("locations/westchester-county.html", "Do you go to Westchester Airport?")], [a, a]);
  const named = /(Westchester|Nassau|Suffolk) County (Taxi|TLC)|Taxi and Limousine Commission license|New Jersey (authority|license)|Pennsylvania (authority|license)/i;
  assert.deepEqual(files.filter((f) => named.test(main(f))), []);
});

check("every page's business entity serves New York, New Jersey, Connecticut, Philadelphia and Pennsylvania, with no street address", () => {
  for (const f of files) {
    const biz = ld(f).find((n) => n["@id"] === "https://www.nycluxride.com/#organization" && n["@type"] === "LocalBusiness");
    if (!biz) continue;
    const states = biz.areaServed.filter((a) => a["@type"] === "State").map((a) => a.name);
    assert.deepEqual(states, ["New York", "New Jersey", "Connecticut", "Pennsylvania"], f);
    assert.ok(biz.areaServed.some((a) => a["@type"] === "City" && a.name === "Philadelphia"), f);
    assert.ok(!JSON.stringify(ld(f)).includes("streetAddress"), f);
  }
  assert.match(main("locations.html"), /We also cover all of New York, New Jersey and Connecticut, plus Philadelphia and Pennsylvania\./);
  assert.match(ldAnswer("long-distance-car-service.html", "How far will you drive?"), /anywhere in the United States or to Canada, send us the details and we'll send you a price\.$/);
});

check("child seats name only Graco and Safety 1st, and no page tells parents to bring their own seat", () => {
  assert.match(main("car-service-with-car-seat-nyc.html"), /Our seats are from Graco and Safety 1st\./);
  assert.deepEqual(files.filter((f) => /\bNova\b/.test(main(f))), []);
  assert.deepEqual(files.filter((f) => /bring (your|their) own (car )?seat/i.test(main(f))), []);
  assert.deepEqual(files.filter((f) => /ride in their own seats/i.test(main(f))), []);
  assert.match(main("blog/nyc-to-philadelphia-kids-car-or-amtrak-november-19.html"), /We bring a car seat for each child\. Choose infant, toddler or booster seats when you book\./);
});

check("the toll close line says parking is charged after the ride on every trip, and the trust section promises only what the owner confirmed", () => {
  const line = "On distance trips, tolls are added at booking, and parking, plus tolls on hourly trips, is charged after the ride.";
  for (const f of ["about.html", "contact.html", "schedule.html", "blog/teterboro-airport-fbos-manhattan-november-19.html", "blog/car-seats-nyc-car-service-parents-november-19.html"]) assert.ok(main(f).includes(line), f);
  assert.deepEqual(files.filter((f) => /parking and tolls on hourly trips are charged/.test(main(f))), []);
  assert.deepEqual(files.filter((f) => /professionally trained/i.test(main(f))), []);
  assert.deepEqual(files.filter((f) => pages.get(f).querySelector("section.trust") && !main(f).includes("Every chauffeur is background checked.")), []);
});

check("groups can book several Sprinters at once by email or WhatsApp", () => {
  assert.match(main("sprinter-van-service-nyc.html"), /For a bigger group, we can send several Sprinters at the same time\. Book them by email or WhatsApp\./);
});

check("weddings: decorations by special arrangement booked several days ahead, and one drinks answer that says we don't provide alcohol", () => {
  const f = "wedding-car-service-nyc.html";
  const deco = "Yes, by special arrangement. Book several days ahead and describe what you have in mind in the notes, and we'll confirm in writing what the car can take.";
  assert.deepEqual([faq(f, "q-wed-decorate"), ldAnswer(f, "Can we decorate the car?")], [deco, deco]);
  const drinks = "You may bring your own permitted drinks, subject to the law, age limits and safety. We don't provide alcohol.";
  assert.equal(question(f, "q-wed-drinks"), "Can we bring drinks?");
  assert.deepEqual([faq(f, "q-wed-drinks"), ldAnswer(f, "Can we bring drinks?")], [drinks, drinks]);
  assert.deepEqual(files.filter((x) => main(x).includes("We don't provide alcohol")), [f]);
});

check("hourly bookings may travel outside New York City with tolls charged after the ride, and still start in the city", () => {
  assert.match(main("roadshow-transportation-nyc.html"), /To keep the same car through the Connecticut meeting, book the day by the hour from New York\. Hourly bookings can travel outside the city, and tolls are charged after the ride\./);
  assert.match(main("wedding-car-service-nyc.html"), /book it by the hour from your New York address\. On an hourly booking, tolls and parking are charged after the ride\./);
  const stamford = "Yes. Book the trip to Stamford and back as a one-way booking with a return, and the total shows before you pay. If the same car should wait for you there, book the day by the hour. On an hourly booking, tolls are charged after the ride.";
  assert.deepEqual([faq("roadshow-transportation-nyc.html", "q-rs-stamford"), ldAnswer("roadshow-transportation-nyc.html", "Can we add a Stamford meeting?")], [stamford, stamford]);
  assert.match(main("blog/roadshow-day-manhattan-planning-november-19.html"), /book the day by the hour\. On an hourly booking, tolls are charged after the ride\./);
  for (const f of ["roadshow-transportation-nyc.html", "blog/roadshow-day-manhattan-planning-november-19.html", "wedding-car-service-nyc.html"]) assert.doesNotMatch(main(f), /(^|\. )Tolls (and parking )?are charged after the ride\./, f);
  assert.match(main("locations/long-island.html"), /Hourly bookings start in New York City\./);
});

check("the weekly search email ships and the one-time owner questions route does not", () => {
  assert.ok(existsSync(join(ROOT, "api", "seo-weekly.mjs")));
  assert.ok(!existsSync(join(ROOT, "api", "owner-questions.mjs")));
  assert.ok(!existsSync(join(ROOT, "test", "owner-questions.test.mjs")));
  assert.doesNotMatch(readFileSync(join(ROOT, "vercel.json"), "utf8"), /owner-questions/);
});

if (failures) {
  console.error(`\n${failures} release 1 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll release 1 tests passed");
process.exit(0);
