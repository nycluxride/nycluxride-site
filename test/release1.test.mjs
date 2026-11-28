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

const COPY = await import(join(ROOT, "api", "_copy.mjs"));
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
    assert.match(main(f), /tolls are added (at booking|to your price when you book)|added to your price when you book|with tolls in the price|tolls (and the service fee )?are in (the|your) price/i, f);
  }
});

check("the pages of airports with no flat price say the price shows when you book and you can pay online, with no quote wording, and their search snippets stay as they were", () => {
  const banned = [/All of them are priced when you book/, /Each one is priced when you book/, /Every one is priced when you book/, /The price for each shows when you book/, /well inside our online limit/, /There's no quote to wait for by email/, /priced like any trip outside the city\. Priced by distance/, /other airfields are priced by distance and time/, /Bradley in Connecticut\. Priced by distance and time/];
  assert.deepEqual(files.flatMap((f) => banned.filter((b) => b.test(main(f))).map((b) => `${f}: ${b}`)), []);
  for (const f of ["locations/westchester-airport.html", "locations/long-island-macarthur-airport.html", "locations/stewart-airport.html", "locations/republic-airport.html", "locations/morristown-airport.html", "locations/philadelphia-airport.html", "locations/bradley-airport.html"]) {
    const rail = [...pages.get(f).querySelectorAll("main .rail dl.facts > div")].map((d) => [norm(d.querySelector("dt").textContent), norm(d.querySelector("dd").textContent)]);
    assert.deepEqual(rail.filter(([k]) => k === "Your price"), [["Your price", "You see the price when you book, and you can pay online."]], f);
    assert.doesNotMatch(main(f), /send you a price|by quote|request a quote/i, f);
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
  for (const f of ["locations/teterboro-airport.html", "private-jet-car-service-nyc.html", "locations/morristown-airport.html", "locations/republic-airport.html", "blog/teterboro-airport-fbos-manhattan-november-19.html", "locations/newark-airport.html", "locations/new-jersey.html", "locations/bergen-county-nj.html", "locations/morris-county-nj.html", "locations/mercer-county-nj.html", "locations/atlantic-county-nj.html"]) {
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
  for (const f of jets) assert.deepEqual(assure(f), ["Flat airport rates include tolls, airport fees and the service fee", "Free waiting after airline landings", "We answer 24 hours a day, every day"], f);
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
  const a = "Yes. It is about 8 miles from Chappaqua and 10 from Scarsdale. We drop off and pick up there. Add your flight number when you book, and you see the price before you pay.";
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
  assert.match(ldAnswer("long-distance-car-service.html", "How far will you drive?"), /far enough for Boston and Washington, booked online\. For Canada, call or WhatsApp us\.$/);
});

check("child seats name the three seats on the owner's sheet, the Nuna RAVA, the Safety 1st Grow and Go and a backless booster, no page names Graco, and no page tells parents to bring their own seat", () => {
  const { SEATS } = COPY;
  assert.equal(SEATS.line, "Our seats are the Nuna RAVA, the Safety 1st Grow and Go and a backless booster.");
  for (const f of ["car-service-with-car-seat-nyc.html", "faq.html", "blog/car-seats-nyc-car-service-parents-november-19.html"]) assert.ok(main(f).includes(SEATS.line), f);
  assert.deepEqual(files.filter((f) => /\bGraco\b/i.test(readFileSync(join(ROOT, f), "utf8"))), []);
  assert.deepEqual(files.filter((f) => /Our seats are from/.test(main(f))), []);
  assert.deepEqual(files.filter((f) => /\bRAVA Premium\b|Grow and Go 3-in-1/.test(readFileSync(join(ROOT, f), "utf8"))), []);
  const list = [...new JSDOM(readFileSync(join(ROOT, "car-service-with-car-seat-nyc.html"), "utf8")).window.document.querySelectorAll("#seats ~ ul li b")].map((b) => b.textContent);
  assert.deepEqual(list, ["Nuna RAVA.", "Safety 1st Grow and Go.", "Backless booster."]);
});

check("parents tell us the seat they'd like, as the owner's sheet asks: the car seat page, the booking hint and the seat email ask for it, and the Nuna RAVA height limit covers both directions", () => {
  const { SEATS } = COPY;
  const d = new JSDOM(readFileSync(join(ROOT, "car-service-with-car-seat-nyc.html"), "utf8")).window.document;
  const items = [...d.querySelectorAll("#seats ~ ul li")].map((li) => li.textContent.replace(/\s+/g, " ").trim());
  assert.equal(items[0], "Nuna RAVA. A convertible seat. Rear-facing from 5 to 50 lb, and forward-facing from 30 to 65 lb from age 2. Up to 49 inches tall.");
  assert.equal(d.querySelector("#seats ~ ul").nextElementSibling.textContent, "When you book, choose an infant seat for a baby, a child seat for a young child or a booster seat for an older child. The infant seat faces the rear and the child seat faces forward or rear. Both are the Nuna RAVA or the Safety 1st Grow and Go. The booster seat is the backless booster. Tell us which seat you'd like. We check it suits each child's age, weight and height.");
  assert.ok(!main("car-service-with-car-seat-nyc.html").includes("We choose the right seat"));
  assert.equal(SEATS.mail, "For the child seats, send us each child's age, weight and height and the seat you'd like, with your reference {ref}, by WhatsApp or email.");
  assert.equal(SEATS.hint, "Charged once per trip. Add ages and the seat you'd like in the notes.");
  assert.ok(SEATS.notes.includes("age, weight and height"), "the notes placeholder still asks for each child's age, weight and height");
  for (const f of ["locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"]) assert.deepEqual([main(f).split("weight and height and the seat you'd like in the notes.").length, main(f).includes(SEATS.hint)], [2, true], f);
  assert.deepEqual(files.filter((f) => /\bNova\b/.test(main(f))), []);
  assert.deepEqual(files.filter((f) => /bring (your|their) own (car )?seat/i.test(main(f))), []);
  assert.deepEqual(files.filter((f) => /ride in their own seats/i.test(main(f))), []);
  assert.match(main("blog/nyc-to-philadelphia-kids-car-or-amtrak-november-19.html"), /We bring a car seat for each child\. Choose child, infant or booster seats when you book\./);
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

check("hourly bookings may travel outside New York City with tolls charged after the ride, and start from any pickup", () => {
  assert.match(main("roadshow-transportation-nyc.html"), /To keep the same car through the Connecticut meeting, book the day by the hour from New York\. Hourly bookings can travel outside the city, and tolls are charged after the ride\./);
  assert.match(main("wedding-car-service-nyc.html"), /a venue outside the city, book it by the hour\. On an hourly booking, tolls and parking are charged after the ride\./);
  const stamford = "Yes. Book the trip to Stamford and back as a one-way booking with a return, and the total shows before you pay. If the same car should wait for you there, book the day by the hour. On an hourly booking, tolls are charged after the ride.";
  assert.deepEqual([faq("roadshow-transportation-nyc.html", "q-rs-stamford"), ldAnswer("roadshow-transportation-nyc.html", "Can we add a Stamford meeting?")], [stamford, stamford]);
  assert.match(main("blog/roadshow-day-manhattan-planning-november-19.html"), /book the day by the hour\. On an hourly booking, tolls are charged after the ride\./);
  for (const f of ["roadshow-transportation-nyc.html", "blog/roadshow-day-manhattan-planning-november-19.html", "wedding-car-service-nyc.html"]) assert.doesNotMatch(main(f), /(^|\. )Tolls (and parking )?are charged after the ride\./, f);
  assert.match(main("locations/long-island.html"), /See pet friendly car service\. Book by the hour from any pickup\./);
  const island = "Yes. Book by the hour from any pickup on Long Island, or book a one-way ride to the city.";
  assert.deepEqual([faq("locations/long-island.html", "q-li-hourly"), ldAnswer("locations/long-island.html", "Can I book by the hour from Long Island?")], [island, island]);
  assert.match(main("locations/westchester-county.html"), /dog friendly car service\. Book by the hour from any pickup\./);
  assert.doesNotMatch(main("locations/westchester-county.html"), /From Westchester, book/);
  assert.doesNotMatch(main("locations/long-island.html"), /From Long Island, book/);
});

check("no page or FAQ answer limits where an hourly booking starts, and the Teterboro, Greenwich, Stamford and wedding answers say an hourly booking can start there", () => {
  for (const f of files) {
    const text = `${main(f)} ${ld(f).filter((n) => n["@type"] === "FAQPage").flatMap((n) => n.mainEntity).map((q) => q.acceptedAnswer.text).join(" ")}`;
    assert.doesNotMatch(text, /Hourly bookings (start|can't start) (in|there)|in or near New York City|New York City or nearby|From farther out|Yes, from New York\.|can start at JFK or LaGuardia\.|From Teterboro, book the|by the hour from your New York address/, f);
  }
  const teb = "Yes. An hourly booking can start at JFK, LaGuardia, Newark or Teterboro.";
  assert.deepEqual([faq("roadshow-transportation-nyc.html", "q-rs-airport"), ldAnswer("roadshow-transportation-nyc.html", "Can the day start at JFK or Teterboro?")], [teb, teb]);
  assert.match(main("roadshow-transportation-nyc.html"), /An hourly booking can start there too\. You can also book the ride from Teterboro to your first meeting as an airport transfer\./);
  assert.match(main("blog/roadshow-day-manhattan-planning-november-19.html"), /The day can start at JFK, LaGuardia, Newark or Teterboro\..*An hourly booking can start there too\. You can also book the ride from the FBO/);
  assert.equal(ldAnswer("locations/greenwich-ct.html", "Can I book a day of meetings in Manhattan?"), "Yes. Book by the hour from any pickup, with a 3-hour minimum, or 4 hours in a Sprinter. The same car waits between stops.");
  assert.match(main("locations/greenwich-ct.html"), /For a day in Manhattan, book the car by the hour from Greenwich\./);
  assert.match(ldAnswer("locations/stamford-ct.html", "Can you drive our team to Manhattan meetings?"), /Book the car by the hour from any pickup, with a 3-hour minimum, or 4 hours in a Sprinter\.$/);
  assert.match(main("locations/hamptons.html"), /drop you at your building\. Book it one way, or by the hour from any pickup\./);
  assert.equal(ldAnswer("wedding-car-service-nyc.html", "Can the car go to a New Jersey venue?"), "Yes. Book the ride to the venue one way and add the ride back to New York as the return. To keep the car there all day, book it by the hour.");
  assert.match(main("wedding-car-service-nyc.html"), /New Jersey\. Book by the hour from any pickup\. For a venue outside the city, you can also book the ride/);
  for (const f of ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"]) assert.equal(norm(pages.get(f).querySelector("#q-outside-hourly p").textContent), COPY.REASONS["outside-hourly"].text, f);
  assert.equal(COPY.REASONS["outside-hourly"].text, "For this pickup, we'll send you a price.");
});

check("the weekly search email ships and the one-time owner questions route does not", () => {
  assert.ok(existsSync(join(ROOT, "api", "seo-weekly.mjs")));
  assert.ok(!existsSync(join(ROOT, "api", "owner-questions.mjs")));
  assert.ok(!existsSync(join(ROOT, "test", "owner-questions.test.mjs")));
  assert.doesNotMatch(readFileSync(join(ROOT, "vercel.json"), "utf8"), /owner-questions/);
});

check("New Jersey has one page per county: 21 pages under the hub, each with its county and every municipality in the official list as areaServed, a Newark Airport or Philadelphia Airport row and no thin page per town", () => {
  const COUNTS = { Atlantic: 23, Bergen: 70, Burlington: 40, Camden: 36, "Cape May": 16, Cumberland: 14, Essex: 22, Gloucester: 24, Hudson: 12, Hunterdon: 26, Mercer: 12, Middlesex: 25, Monmouth: 53, Morris: 39, Ocean: 33, Passaic: 16, Salem: 15, Somerset: 21, Sussex: 24, Union: 21, Warren: 22 };
  const slug = (c) => `locations/${c.toLowerCase().replace(/ /g, "-")}-county-nj.html`;
  assert.deepEqual(files.filter((f) => /-county-nj\.html$/.test(f)), Object.keys(COUNTS).map(slug).sort());
  const hub = pages.get("locations/new-jersey.html");
  const linked = [...hub.querySelectorAll("main #counties ~ ul a")].map((a) => a.getAttribute("href")).filter((h) => h.endsWith("-county-nj"));
  assert.deepEqual(linked.sort(), Object.keys(COUNTS).map((c) => `/${slug(c).replace(/\.html$/, "")}`).sort());
  const hubArea = ld("locations/new-jersey.html").find((n) => n["@type"] === "Service").areaServed;
  assert.deepEqual(hubArea.filter((a) => a["@type"] === "AdministrativeArea").map((a) => a.name).sort(), Object.keys(COUNTS).map((c) => `${c} County`).sort());
  for (const [county, n] of Object.entries(COUNTS)) {
    const f = slug(county);
    const area = ld(f).find((x) => x["@type"] === "Service").areaServed;
    assert.deepEqual(area[0], { "@type": "AdministrativeArea", name: `${county} County`, containedInPlace: { "@type": "State", name: "New Jersey" } }, f);
    assert.equal(area.filter((a) => a["@type"] === "City").length, n, f);
    assert.ok(area.slice(1).every((a) => a.containedInPlace.name === `${county} County` && main(f).includes(a.name)), f);
    assert.deepEqual([...pages.get(f).querySelectorAll("main nav.crumbs a")].map((a) => a.getAttribute("href")), ["/locations", "/locations/new-jersey"], f);
    const rows = [...pages.get(f).querySelectorAll("main a.ledger__row .ledger__name")].map((e) => norm(e.textContent));
    assert.ok(rows.some((r) => / to (Newark|Philadelphia) Airport rates$/.test(r)), f);
  }
  for (const [f, town] of [["locations/bergen-county-nj.html", "Closter"], ["locations/bergen-county-nj.html", "North Arlington"], ["locations/camden-county-nj.html", "Pennsauken"], ["locations/camden-county-nj.html", "Barrington"], ["locations/monmouth-county-nj.html", "Avon-by-the-Sea"], ["locations/cape-may-county-nj.html", "Wildwood Crest"], ["locations/gloucester-county-nj.html", "Glassboro"], ["locations/essex-county-nj.html", "Short Hills"]]) assert.ok(main(f).includes(town), `${f}: ${town}`);
  assert.deepEqual(files.filter((f) => /\bBarri\b/.test(main(f))), []);
  assert.doesNotMatch(main("locations/new-jersey.html"), /Every ride on this page goes to New York/);
  assert.equal(faq("locations/new-jersey.html", "q-nj-anywhere"), "Yes. We pick up in all 21 counties, for rides to Newark Liberty, Teterboro, JFK, LaGuardia, New York City and other towns in New Jersey. Find your county on this page, or send us the address.");
});

check("every page's business entity lists all 21 New Jersey counties", () => {
  const want = ["Hudson", "Bergen", "Essex", "Morris", "Union", "Mercer", "Atlantic", "Passaic", "Middlesex", "Somerset", "Monmouth", "Ocean", "Hunterdon", "Sussex", "Warren", "Burlington", "Camden", "Gloucester", "Salem", "Cumberland", "Cape May"].map((c) => `${c} County`);
  for (const f of files) {
    const biz = ld(f).find((n) => n["@id"] === "https://www.nycluxride.com/#organization" && n["@type"] === "LocalBusiness");
    if (!biz) continue;
    assert.deepEqual(biz.areaServed.filter((a) => a.containedInPlace?.name === "New Jersey").map((a) => a.name), want, f);
  }
});

check("Signature Newark, the one FBO at Newark Liberty, is on the Newark Airport and private jet pages with its address and how to book it", () => {
  for (const f of ["locations/newark-airport.html", "private-jet-car-service-nyc.html", "locations/essex-county-nj.html"]) {
    assert.match(main(f), /Signature Newark/, f);
    assert.match(main(f), /15 Brewster Road/, f);
    assert.match(main(f), /Newark Liberty \(EWR\)/, f);
  }
  assert.match(main("locations/newark-airport.html"), /Private flights at Newark Liberty use one FBO, Signature Aviation\./);
  assert.equal(question("private-jet-car-service-nyc.html", "q-jet-ewr"), "Do you go to Signature Flight Support at Newark?");
  assert.equal(ldAnswer("private-jet-car-service-nyc.html", "Do you go to Signature Flight Support at Newark?"), faq("private-jet-car-service-nyc.html", "q-jet-ewr"));
  assert.match(pages.get("private-jet-car-service-nyc.html").querySelector('meta[name="description"]').getAttribute("content"), /Teterboro, Newark,/);
  assert.match(main("locations/morris-county-nj.html"), /Signature Aviation at 1 Airport Road and Atlantic Aviation at 50 Airport Road/);
  assert.match(main("locations/bergen-county-nj.html"), /Atlantic Aviation, Jet Aviation and Signature Aviation East, South and West/);
});

check("every New Jersey town page sits under its county: the crumbs and the BreadcrumbList go Service areas, New Jersey, the county, the town, and the airport and route pages near a county link it in the text", () => {
  const TOWNS = { "alpine-tenafly": "bergen", edgewater: "bergen", englewood: "bergen", "fort-lee": "bergen", paramus: "bergen", hoboken: "hudson", "jersey-city": "hudson", secaucus: "hudson", "weehawken-north-bergen": "hudson", "newark-nj": "essex", "short-hills-livingston": "essex", morristown: "morris", princeton: "mercer", summit: "union" };
  for (const [town, county] of Object.entries(TOWNS)) {
    const f = `locations/${town}.html`;
    const href = `/locations/${county}-county-nj`;
    assert.deepEqual([...pages.get(f).querySelectorAll("main nav.crumbs a")].map((a) => a.getAttribute("href")), ["/locations", "/locations/new-jersey", href], f);
    const list = ld(f).find((n) => n["@type"] === "BreadcrumbList").itemListElement;
    assert.deepEqual(list.map((i) => [i.position, i.item.replace("https://www.nycluxride.com", "")]), [[1, "/"], [2, "/locations"], [3, "/locations/new-jersey"], [4, href], [5, `/locations/${town}`]], f);
    assert.equal(list[3].name, norm(pages.get(f).querySelector(`main nav.crumbs a[href="${href}"]`).textContent), f);
    assert.ok(pages.get(`locations/${county}-county-nj.html`).querySelector(`main p a[href="/locations/${town}"]`), `${county} does not link ${town}`);
  }
  const BODY = { "locations/teterboro-airport.html": ["bergen"], "locations/newark-airport.html": ["essex", "union"], "locations/morristown-airport.html": ["morris"], "locations/philadelphia-airport.html": ["camden", "gloucester", "burlington"], "long-distance-car-service/nyc-to-atlantic-city.html": ["atlantic"] };
  for (const [f, counties] of Object.entries(BODY)) for (const c of counties) assert.ok(pages.get(f).querySelector(`main p a[href="/locations/${c}-county-nj"]`), `${f} ${c}`);
});

check("each county title names the county and NJ within 59 characters, and each paragraph of the town list links a town page once", () => {
  for (const f of files.filter((x) => /-county-nj\.html$/.test(x))) {
    const doc = pages.get(f);
    const county = norm(doc.querySelector("main nav.crumbs [aria-current=page]").textContent);
    assert.ok(doc.title.startsWith(`${county} NJ Car Service`) && doc.title.endsWith(" | NYC LUX RIDE") && doc.title.length <= 59, doc.title);
    assert.equal(doc.querySelector('meta[property="og:title"]').getAttribute("content"), doc.title, f);
    const h = [...doc.querySelectorAll("main h2")].find((x) => norm(x.textContent).startsWith("Towns we serve in"));
    for (const p of [h.nextElementSibling, h.nextElementSibling.nextElementSibling]) {
      const hrefs = [...p.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      assert.equal(new Set(hrefs).size, hrefs.length, f);
    }
  }
  assert.match(main("locations/bergen-county-nj.html"), /Fort Lee, Edgewater and Paramus have their own pages\. Englewood and Englewood Cliffs share one, and so do Alpine and Tenafly\./);
  assert.match(main("locations/hudson-county-nj.html"), /Jersey City, Hoboken and Secaucus have their own pages, and Weehawken and North Bergen share one\./);
});

check("the county copy agrees with its own drive times: Newton, Jersey City, Drew, Cherry Hill and Woodbury", () => {
  const same = (f, id) => assert.equal(ldAnswer(f, question(f, id)), faq(f, id), f);
  assert.match(faq("locations/sussex-county-nj.html", "q-sus-air"), /^Morristown Airport, about 35 miles, is the closest field for private flights\. For airline flights, Newark Liberty is about 52 miles/);
  same("locations/sussex-county-nj.html", "q-sus-air");
  assert.match(main("locations/hudson-county-nj.html"), /Signature Newark, at 15 Brewster Road, is about 14 minutes from Jersey City with light traffic, and Teterboro is about 18 minutes\./);
  assert.doesNotMatch(main("locations/hudson-county-nj.html"), /closest to most of the county/);
  assert.match(faq("locations/morris-county-nj.html", "q-mrs-drew"), /about 44 miles, around 75 minutes/);
  same("locations/morris-county-nj.html", "q-mrs-drew");
  assert.match(faq("locations/camden-county-nj.html", "q-cam-ewr"), /From Cherry Hill the drive is about 75 miles up the Turnpike, close to 95 minutes/);
  same("locations/camden-county-nj.html", "q-cam-ewr");
  assert.match(main("locations/gloucester-county-nj.html"), /From Woodbury, a car reaches Philadelphia Airport in under 30 minutes with light traffic/);
  assert.doesNotMatch(main("locations/new-jersey.html"), /north of the Meadowlands/);
  assert.doesNotMatch(main("locations/hudson-county-nj.html"), /North of the Meadowlands/);
});

check("the private jet page links Signature Newark to the Newark Airport private section and its Service names Newark Liberty", () => {
  const doc = pages.get("private-jet-car-service-nyc.html");
  assert.ok(doc.querySelector('#newark + p a[href="/locations/newark-airport#private"]'));
  assert.ok(pages.get("locations/newark-airport.html").getElementById("private"));
  assert.match(ld("private-jet-car-service-nyc.html").find((n) => n["@type"] === "Service").description, /the FBOs at Teterboro, Newark Liberty, Westchester, Morristown, Republic, Long Island MacArthur and Stewart airports/);
});

if (failures) {
  console.error(`\n${failures} release 1 assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll release 1 tests passed");
process.exit(0);
