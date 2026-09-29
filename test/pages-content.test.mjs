import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const BASELINE = JSON.parse(readFileSync(join(ROOT, "test/fixtures/seo-baseline.json"), "utf8")).pages;

const AREAS = { "locations/manhattan.html": "Manhattan", "locations/brooklyn.html": "Brooklyn", "locations/queens.html": "Queens", "locations/bronx.html": "The Bronx", "locations/staten-island.html": "Staten Island", "locations/financial-district.html": "Financial District", "locations/soho.html": "SoHo", "locations/upper-east-side.html": "Upper East Side", "locations/upper-west-side.html": "Upper West Side", "locations/long-island-city.html": "Long Island City" };
const AIRPORTS = { "locations/jfk-airport.html": "JFK Airport", "locations/laguardia-airport.html": "LaGuardia Airport" };
const MONEY = { "chauffeur-service-nyc.html": ["/services", "Services", "Chauffeur service"], "limousine-service-nyc.html": ["/services", "Services", "Limousine service"], "black-car-service-brooklyn.html": ["/locations", "Service areas", "Black car service, Brooklyn"] };

const PHOTO = {
  "services.html": "/fleet/lincoln-navigator-900.webp",
  "chauffeur-service-nyc.html": "/fleet/mercedes-s-class-900.webp",
  "limousine-service-nyc.html": "/fleet/sprinter-jet-900.webp",
  "black-car-service-brooklyn.html": "/fleet/lincoln-navigator-900.webp",
  "locations/manhattan.html": "/fleet/mercedes-s-class-900.webp",
  "locations/brooklyn.html": "/fleet/chevrolet-suburban-900.webp",
  "locations/queens.html": "/fleet/cadillac-escalade-esv-900.webp",
  "locations/bronx.html": "/fleet/lincoln-navigator-900.webp",
  "locations/staten-island.html": "/fleet/sprinter-jet-900.webp",
  "locations/financial-district.html": "/fleet/bmw-7-series-900.webp",
  "locations/soho.html": "/fleet/cadillac-ct5-ct6-900.webp",
  "locations/upper-east-side.html": "/fleet/cadillac-lyriq-900.webp",
  "locations/upper-west-side.html": "/fleet/lincoln-continental-900.webp",
  "locations/long-island-city.html": "/fleet/cadillac-xt6-900.webp",
  "locations/jfk-airport.html": "/fleet/cadillac-escalade-esv-900.webp",
  "locations/laguardia-airport.html": "/fleet/gmc-denali-900.webp",
};
const BANNERS = Object.keys(PHOTO);
const BANNER_SIZES = "(max-width: 599px) 84vw, 100vw";
const SERVICES_JUMPS = [["#airport-transfers", "Airport transfers"], ["#hourly", "Hourly and as directed"], ["#corporate", "Corporate accounts"], ["#weddings", "Events"], ["#prom", "Prom"], ["#cruise", "Cruise terminals"]];
const POSTS = readdirSync(join(ROOT, "blog")).filter((f) => f.endsWith(".html")).sort().map((f) => `blog/${f}`);

const CRUMBS = {};
for (const [file, name] of Object.entries({ ...AREAS, ...AIRPORTS })) CRUMBS[file] = [["/locations", "Service areas"], [null, name]];
for (const [file, [href, text, name]] of Object.entries(MONEY)) CRUMBS[file] = [[href, text], [null, name]];
CRUMBS["services.html"] = [["/", "Home"], [null, "Services"]];

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const kids = (el) => [...el.children];
const tagOf = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")}`;

function read(file) {
  const html = readFileSync(join(ROOT, file), "utf8");
  return { html, lines: html.split("\n"), document: new JSDOM(html).window.document };
}

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

check("the SEO baseline lists every page this test reads", () => {
  for (const file of [...BANNERS, "locations.html", "blog.html", ...POSTS]) assert.ok(BASELINE[file], `${file} is not in the baseline`);
  assert.equal(POSTS.length, 10);
});

for (const file of BANNERS) {
  const { lines, document } = read(file);
  const main = document.querySelector("main");
  const banner = main.firstElementChild;
  const isServices = file === "services.html";
  check(`${file}: main starts with section.banner.banner--book labelled by its h1`, () => {
    assert.equal(tagOf(banner), "section.banner.banner--book");
    assert.equal(banner.getAttribute("aria-labelledby"), "page-h");
    assert.deepEqual(kids(banner).map(tagOf), ["figure.banner__photo", "div.banner__body"]);
  });
  check(`${file}: figure.banner__photo holds the twin, the page's former eager image at the banner sizes, then its caption`, () => {
    const fig = banner.querySelector(":scope>figure.banner__photo");
    assert.deepEqual(kids(fig).map(tagOf), ["img.plate__twin", "picture", "figcaption.slate"]);
    const img = fig.querySelector("picture>img");
    assert.equal(img.getAttribute("src"), PHOTO[file]);
    for (const [k, v] of [["loading", "eager"], ["decoding", "sync"], ["fetchpriority", "high"]]) assert.equal(img.getAttribute(k), v, k);
    for (const k of ["width", "height", "alt"]) assert.ok(img.getAttribute(k), `img has no ${k}`);
    const sources = [...fig.querySelectorAll("picture>source")];
    assert.deepEqual(sources.map((s) => s.getAttribute("type")), ["image/avif", "image/webp"]);
    for (const s of sources) assert.equal(s.getAttribute("sizes"), BANNER_SIZES);
    assert.equal(document.querySelectorAll('img[loading="eager"]').length, 1, "more than one eager image");
  });
  check(`${file}: banner body order is h1#page-h, div.banner__book, the lede, with no eyebrow on any Hero B banner`, () => {
    const body = banner.querySelector(":scope>div.banner__body");
    assert.deepEqual(kids(body).map(tagOf), ["h1#page-h", "div.banner__book", "p.lede"]);
    assert.deepEqual([...document.querySelectorAll("h1")].map((h) => norm(h.textContent)), BASELINE[file].h1);
  });
  check(`${file}: the banner__book wrapper lines sit as 5.8 places them`, () => {
    const at = lines.flatMap((l, i) => (l === '<div class="banner__book">' ? [i] : []));
    assert.equal(at.length, 1, `${at.length} wrapper lines`);
    assert.equal(lines.filter((l) => l.includes("banner__book")).length, 1, "banner__book on a line with other markup");
    const i = at[0];
    if (lines[i + 1].startsWith("<form")) {
      assert.match(lines[i + 1], /^<form id="book-form" /);
      const j = lines.indexOf("</form>", i);
      assert.ok(j > i, "no </form> line after the form");
      assert.equal(lines[j + 1], "</div>");
    } else assert.equal(lines[i + 1], "</div>", "the wrapper holds something other than the form");
  });
  check(`${file}: div.banner__book holds form#book-form as its only child`, () => {
    const slot = banner.querySelector("div.banner__book");
    assert.deepEqual(kids(slot).map((k) => `${k.tagName.toLowerCase()}#${k.id}`), ["form#book-form"]);
  });
  check(`${file}: the crumbs block follows the banner${isServices ? ", then the jumps nav" : ""}`, () => {
    const next = banner.nextElementSibling;
    assert.equal(tagOf(next), "div.frame");
    assert.equal(next.children.length, isServices ? 2 : 1);
    const nav = next.firstElementChild;
    if (isServices) {
      const jumps = nav.nextElementSibling;
      assert.equal(tagOf(jumps), "nav");
      assert.deepEqual([...jumps.attributes].map((x) => [x.name, x.value]), [["aria-label", "Services on this page"]]);
      const ul = jumps.querySelector(":scope>ul.jumps[role=list]");
      assert.ok(ul, "no ul.jumps");
      assert.deepEqual([...ul.querySelectorAll(":scope>li>a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]), SERVICES_JUMPS);
      for (const [href] of SERVICES_JUMPS) assert.ok(document.getElementById(href.slice(1)), `no target ${href}`);
    }
    assert.equal(nav.tagName, "NAV");
    assert.equal(nav.getAttribute("class"), "crumbs");
    assert.equal(nav.getAttribute("aria-label"), "Breadcrumb");
    const ol = nav.querySelector(":scope>ol[role=list]");
    assert.ok(ol, "no ol[role=list]");
    const items = [...ol.children].map((li) => {
      const a = li.querySelector(":scope>a");
      return [a ? a.getAttribute("href") : null, norm(li.textContent)];
    });
    assert.deepEqual(items, CRUMBS[file]);
    assert.equal(ol.lastElementChild.getAttribute("aria-current"), "page");
  });
  check(`${file}: no booking button row or photo strip left from the old hero`, () => {
    assert.equal([...banner.querySelectorAll(".btn-row")].filter((el) => !el.closest("#book-form")).length, 0, "btn-row in the banner");
    assert.equal(main.querySelectorAll(":scope>div.frame>figure, :scope>div.frame>.plate").length, 0, "photo strip block");
    assert.equal(main.querySelectorAll(":scope>section.section--tight").length, 0, "old section--tight hero");
  });
  check(`${file}: the head image preload equals the banner's AVIF source`, () => {
    const pre = [...document.querySelectorAll('head link[rel="preload"][as="image"]')];
    assert.equal(pre.length, 1);
    const avif = banner.querySelector('figure.banner__photo source[type="image/avif"]').getAttribute("srcset");
    assert.equal(pre[0].getAttribute("type"), "image/avif");
    assert.equal(pre[0].getAttribute("imagesrcset"), avif);
    assert.equal(pre[0].getAttribute("imagesizes"), BANNER_SIZES);
    assert.equal(pre[0].getAttribute("fetchpriority"), "high");
    assert.equal(pre[0].hasAttribute("media"), false, "preload has a media attribute");
    assert.ok(avif.split(",").map((c) => c.trim().split(/\s+/)[0]).includes(pre[0].getAttribute("href")), "href is not a candidate");
  });
}

{
  const { document } = read("locations.html");
  check("locations.html: main starts with section.band holding the eyebrow, h1, lede and the hero borough map", () => {
    const band = document.querySelector("main").firstElementChild;
    assert.equal(tagOf(band), "section.band");
    assert.deepEqual(kids(band).map(tagOf), ["div.frame"]);
    const grid = band.querySelector(":scope>div.frame>div.grid12");
    assert.ok(grid, "no div.frame>div.grid12");
    const text = grid.querySelector(":scope>div.prose");
    assert.deepEqual(kids(text).slice(0, 4).map(tagOf), ["nav.crumbs", "p.eyebrow.eyebrow--lead", "h1", "p.lede"]);
    assert.deepEqual([...document.querySelectorAll("h1")].map((h) => norm(h.textContent)), BASELINE["locations.html"].h1);
    assert.ok(grid.querySelector(":scope>figure.citymap.citymap--hero svg"), "no hero borough map");
  });
}

{
  const { document } = read("blog.html");
  check("blog.html: main starts with div.band.frame holding the eyebrow, h1 and lede", () => {
    const band = document.querySelector("main").firstElementChild;
    assert.equal(tagOf(band), "div.band.frame");
    assert.deepEqual(kids(band.querySelector(".prose")).slice(0, 2).map(tagOf), ["nav.crumbs", "p.eyebrow.eyebrow--lead"]);
    assert.ok(band.querySelector(".eyebrow"), "no eyebrow");
    assert.ok(band.querySelector("p.lede"), "no lede");
    assert.equal(band.querySelector("h1"), document.querySelector("h1"));
    assert.deepEqual([...document.querySelectorAll("h1")].map((h) => norm(h.textContent)), BASELINE["blog.html"].h1);
    assert.equal(tagOf(band.nextElementSibling), "div.frame");
    assert.ok(band.nextElementSibling.querySelector("article"), "the featured post does not follow the band");
  });
}

for (const file of POSTS) {
  const { document } = read(file);
  check(`${file}: the article starts with section.band.frame holding the crumbs, h1, dates line and lede`, () => {
    const article = document.querySelector("main>article");
    assert.ok(article, "no main>article");
    const band = article.firstElementChild;
    assert.equal(tagOf(band), "section.band.frame");
    const rail = band.querySelector(":scope>div.rail");
    assert.deepEqual(kids(rail).map(tagOf), ["nav.crumbs", "h1", "p", "p.lede"]);
    assert.ok(rail.children[2].querySelector("time.note__date[datetime]"), "no dates line");
    assert.deepEqual([...document.querySelectorAll("h1")].map((h) => norm(h.textContent)), BASELINE[file].h1);
  });
}

for (const file of [...BANNERS, "locations.html", "blog.html", ...POSTS]) {
  const { document } = read(file);
  check(`${file}: every crumbs nav has class="crumbs" only`, () => {
    const navs = new Set([...document.querySelectorAll('nav.crumbs, nav[aria-label="Breadcrumb"], [class*="crumbs"]')]);
    for (const nav of navs) {
      assert.equal(nav.tagName, "NAV");
      assert.equal(nav.getAttribute("class"), "crumbs");
      assert.equal(nav.getAttribute("aria-label"), "Breadcrumb");
    }
    assert.equal(navs.size, 1);
  });
}

const BREAD = (document) => {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    const j = JSON.parse(s.textContent);
    for (const n of j["@graph"] || [j]) if (n["@type"] === "BreadcrumbList") return n.itemListElement.map((i) => [i.item.replace("https://www.nycluxride.com", "") || "/", i.name]);
  }
  return null;
};
for (const file of ["services.html", "locations.html", "blog.html"]) {
  const { document } = read(file);
  check(`${file}: the crumbs equal the BreadcrumbList, the last item the current page`, () => {
    const items = [...document.querySelectorAll("main nav.crumbs ol[role=list]>li")];
    const want = BREAD(document);
    assert.deepEqual(items.map((li) => [li.querySelector("a")?.getAttribute("href") ?? want[items.indexOf(li)][0], norm(li.textContent)]), want);
    assert.equal(items.at(-1).getAttribute("aria-current"), "page");
    assert.equal(items.at(-1).querySelector("a"), null);
    for (const li of items.slice(0, -1)) assert.ok(li.querySelector("a"), "an earlier item is not a link");
  });
}

const FREE = ["Free waiting", "45 minutes after a domestic landing, 60 after an international landing, 15 at any other pickup."];
const HOUR = ["By the hour", "Any class, with a 3-hour minimum."];
const CHILD = ["Child seats", "Infant, toddler and booster seats, free on request."];
const AHEAD = ["Booking ahead", "Online at least 24 hours ahead. Sooner by phone or WhatsApp when a car is free."];
const PRICE = (area) => ["Airport price", `One total by class from any ${area}, with tolls, airport fees and taxes included.`];
const IN_AREA = { manhattan: "in Manhattan", brooklyn: "in Brooklyn", queens: "in Queens", bronx: "in the Bronx", "staten-island": "on Staten Island", "financial-district": "in the Financial District", soho: "in SoHo", "upper-east-side": "on the Upper East Side", "upper-west-side": "on the Upper West Side", "long-island-city": "in Long Island City" };
const RAILS = {};
for (const [slug, area] of Object.entries(IN_AREA)) RAILS[`locations/${slug}.html`] = [PRICE(`address ${area}`), FREE, HOUR, CHILD, AHEAD];
for (const [slug, at] of [["jfk-airport", "JFK"], ["laguardia-airport", "LaGuardia"]]) RAILS[`locations/${slug}.html`] = [["Where we meet you", `How we meet you at ${at}`], ["Flight tracking", "We move the pickup if your flight lands early or late."], PRICE("New York City address"), FREE, CHILD, AHEAD];
RAILS["chauffeur-service-nyc.html"] = [["By the hour", "3 to 12 hours online, with a 3-hour minimum."], ["Between stops", "The same car and chauffeur wait for you."], PRICE("New York City address"), CHILD, AHEAD];
RAILS["limousine-service-nyc.html"] = [["Seats", "Up to 12 in a Luxury Sprinter, with 10 large and 2 small bags."], HOUR, ["Sprinter by the hour", "Send us the trip. We reply with the fare and a payment link."], ["No smoking", "In any of our vehicles."], AHEAD];
RAILS["black-car-service-brooklyn.html"] = [PRICE("address in Brooklyn"), FREE, HOUR, CHILD, AHEAD];

for (const [file, rows] of Object.entries(RAILS)) {
  const { document } = read(file);
  const main = document.querySelector("main");
  check(`${file}: the rider facts box comes first in its grid, before the prose, with the exact labels and values`, () => {
    const aside = main.querySelector("aside.rail.c9-12");
    assert.ok(aside, "no aside.rail.c9-12");
    assert.equal(aside.getAttribute("aria-labelledby"), "lf-h");
    assert.equal(aside.hasAttribute("aria-label"), false);
    assert.ok(aside.parentElement.matches("div.grid12") && aside.parentElement.firstElementChild === aside, "the box is not the first child of its grid");
    assert.ok(aside.nextElementSibling.matches("div.prose.c1-8"), "no div.prose.c1-8 after the box");
    const crumbs = main.querySelector(":scope>div.frame>nav.crumbs").parentElement;
    assert.ok(crumbs.compareDocumentPosition(aside) & 4, "the box is not after the crumbs");
    assert.deepEqual(kids(aside).slice(0, 2).map(tagOf), ["h2#lf-h.rail__h", "dl.facts.facts--lead"]);
    assert.equal(norm(aside.firstElementChild.textContent), "Before you book");
    const got = [...aside.querySelectorAll("dl.facts--lead>div")].map((d) => [norm(d.querySelector("dt").textContent), norm(d.querySelector("dd").textContent)]);
    assert.deepEqual(got, rows);
    for (const dt of aside.querySelectorAll("dl.facts--lead dt")) assert.ok(dt.firstElementChild?.matches("svg.icon[aria-hidden=true]"), "a label has no icon first");
    assert.deepEqual([...aside.querySelectorAll(":scope>a")].map((a) => a.getAttribute("href")), ["/rates", "tel:+16467750556", "/book"]);
    const near = aside.querySelector(":scope>ul.jumps");
    if (file.startsWith("locations/")) {
      assert.equal(norm(aside.querySelector(":scope>p.eyebrow").textContent), "Nearby");
      const cards = [...main.querySelectorAll("a.loc-card")].map((a) => [a.getAttribute("href"), norm(a.querySelector("h3").textContent)]);
      assert.equal(cards.length, 3);
      assert.deepEqual([...near.querySelectorAll("a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]), cards);
    } else assert.equal(near, null, "a money page box has nearby chips");
  });
}

for (const [file, at, vals, ids] of [["locations/jfk-airport.html", "JFK", ["all", "1", "4", "5", "7", "8"], { "1 4 8": "Terminals 1, 4 and 8", "5 7": "Terminals 5 and 7", all: "Meet and greet" }], ["locations/laguardia-airport.html", "LaGuardia", ["all", "B", "C"], { "B C": "Terminals B and C", all: "Meet and greet" }]]) {
  const { document } = read(file);
  const SAY = file.includes("jfk") ? { "1": "Terminal 1: the curb or the car service pickup area for your terminal.", "4": "Terminal 4: the curb or the car service pickup area for your terminal.", "8": "Terminal 8: the curb or the car service pickup area for your terminal.", "5": "Terminal 5: for now, a lot at the Howard Beach AirTrain station, a free AirTrain ride from the terminal.", "7": "Terminal 7: for now, a lot at the Howard Beach AirTrain station, a free AirTrain ride from the terminal." } : { B: "Terminal B: the arrivals curb or the car service pickup area of your terminal.", C: "Terminal C: the arrivals curb or the car service pickup area of your terminal." };
  SAY.all = "With meet and greet: inside the terminal near baggage claim, with a name sign.";
  check(`${file}: section#arrival opens the prose right after the rider facts box, with its heading`, () => {
    const s = document.getElementById("arrival");
    assert.ok(s && s.tagName === "SECTION", "no section#arrival");
    assert.ok(s.parentElement.matches("div.prose.c1-8") && s.parentElement.firstElementChild === s, "section#arrival is not first in the prose");
    assert.ok(s.parentElement.previousElementSibling.matches("aside.rail"), "the rider facts box does not come before it");
    assert.equal(s.getAttribute("aria-labelledby"), "arrival-h");
    assert.equal(norm(document.getElementById("arrival-h").textContent), `How we meet you at ${at}`);
    assert.equal(document.querySelector('main aside.rail a[href="#arrival"]')?.textContent, `How we meet you at ${at}`);
  });
  check(`${file}: the terminal picker, its lines and the marked table rows`, () => {
    const s = document.getElementById("arrival");
    const fs = s.querySelector(":scope>fieldset.tpick");
    assert.ok(fs, "no fieldset.tpick");
    assert.equal(norm(fs.querySelector("legend").textContent), "Your terminal");
    const radios = [...fs.querySelectorAll("label>input[type=radio]")];
    assert.deepEqual(radios.map((r) => r.value), vals);
    assert.ok(radios[0].checked && norm(radios[0].parentElement.textContent) === "All terminals", "All terminals is not first and checked");
    assert.equal(new Set(radios.map((r) => r.name)).size, 1);
    for (const r of radios.slice(1)) {
      assert.equal(norm(r.parentElement.textContent), `Terminal ${r.value}`);
      assert.equal(r.getAttribute("aria-describedby"), `say-${r.value}`);
    }
    const says = [...s.querySelectorAll(":scope>p.pick-say")];
    assert.deepEqual(Object.fromEntries(says.map((p) => [p.dataset.t, norm(p.textContent)])), SAY);
    for (const p of says) assert.equal(p.id, `say-${p.dataset.t}`);
    assert.ok(fs.compareDocumentPosition(says[0]) & 4, "the lines are not under the picker");
    const table = s.querySelector(":scope>div.table-scroll>table");
    assert.ok(table, "no table in #arrival");
    assert.ok(says.at(-1).compareDocumentPosition(table) & 4, "the table is not under the lines");
    assert.deepEqual(Object.fromEntries([...table.querySelectorAll("tbody tr")].map((tr) => [tr.dataset.t, norm(tr.querySelector("th").textContent)])), ids);
  });
  check(`${file}: the safety tip${at === "JFK" ? " and the dated For now line with its source" : ""}`, () => {
    const s = document.getElementById("arrival");
    const tip = s.querySelector(":scope>aside.tip");
    assert.ok(tip, "no aside.tip");
    assert.ok(tip.firstElementChild.matches("svg.icon") && tip.firstElementChild.querySelector("use").getAttribute("href") === "#i-shield", "the tip does not start with the i-shield icon");
    assert.equal(norm(tip.querySelector("h3").textContent), "Only go with your chauffeur");
    const ps = [...tip.querySelectorAll(":scope>p")].map((p) => norm(p.textContent));
    assert.deepEqual(ps.slice(0, 3), ["Say no to anyone in the terminal who offers you a ride. The Port Authority warns that they may be unlicensed.", "Your chauffeur calls or messages you, or waits with a name sign if you booked meet and greet.", "Licensed cars show T&LC on the plate and a Taxi and Limousine Commission (TLC) decal."]);
    const src = tip.querySelector('a[href="https://www.jfkairport.com/transportation/van-shuttle-service"]');
    if (at === "JFK") {
      assert.ok(src && src.target === "_blank" && src.rel === "noopener", "no source link in a new tab");
      assert.equal(norm(src.textContent), "Port Authority advice on rides at JFK (opens in a new tab)");
      const dated = [...s.querySelectorAll(":scope>p")].find((p) => p.textContent.includes("checked October 15, 2026"));
      assert.ok(dated, "no dated line");
      assert.equal(norm(dated.textContent), "For now, car service pickups at Terminals 5 and 7 use a lot at the Howard Beach AirTrain station, a free AirTrain ride from the terminal. Source: Port Authority of New York and New Jersey (opens in a new tab), checked October 15, 2026.");
      assert.ok(dated.querySelector('a[target="_blank"] svg[aria-hidden="true"] use[href="#i-external"]'), "the dated source link shows the new tab icon");
      assert.equal(dated.querySelector("a").getAttribute("href"), "https://www.jfkairport.com/transportation/ride-share-services");
      assert.ok(s.querySelector("table").closest(".table-scroll").compareDocumentPosition(dated) & 4, "the dated line is not under the table");
      assert.ok(document.querySelector("#pickup-caption").textContent.includes("in use in September 2026"), "the caption lost its month");
    } else assert.equal(src, null, "LaGuardia carries the JFK source link");
  });
}

const HOURLY_POSTS = ["manhattan-hourly-chauffeur-service-april-10", "corporate-black-car-nyc-april-3", "wedding-event-limo-nyc-march-27", "nyc-prom-limo-booking-guide-march-13", "nyc-limo-service-comparison-guide-april-29"].map((s) => `blog/${s}.html`);
const AIRPORT_POSTS = ["jfk-lga-ewr-airport-transfer-guide-april-17", "whatsapp-airport-pickup-coordination-nyc-april-24", "best-black-car-service-brooklyn-queens-march-20"].map((s) => `blog/${s}.html`);
const POST_H2_IDS = {"blog/best-black-car-service-brooklyn-queens-march-20.html": ["which-airport-is-nearer-from-where", "the-bqe-and-its-narrow-middle", "over-newtown-creek-on-the-kosciuszko-bridge", "the-belt-the-jackie-robinson-and-the-van-wyck", "tolls-on-the-way-and-where-they-start", "when-a-train-is-the-simpler-answer"], "blog/chauffeur-service-nyc-booking-guide-april-30.html": ["three-licenses-behind-every-ride", "look-up-the-base-on-nyc-open-data", "check-the-car-and-the-driver", "where-illegal-rides-find-passengers", "questions-to-ask-before-you-pay", "what-a-written-quote-should-list"], "blog/corporate-black-car-nyc-april-3.html": ["what-a-black-car-base-is-in-new-york", "four-checks-before-signing", "line-items-on-a-new-york-invoice", "setting-up-an-account"], "blog/jfk-lga-ewr-airport-transfer-guide-april-17.html": ["three-airports-three-different-trips", "which-airport-a-flight-uses", "what-changes-at-jfk-in-2026-and-2027", "curb-rules-that-set-pickup-timing", "how-early-to-leave", "rail-links-and-when-a-car-is-simpler", "arriving-from-abroad", "when-hourly-service-is-the-better-option"], "blog/manhattan-hourly-chauffeur-service-april-10.html": ["how-three-hours-are-billed-by-class", "why-the-car-waits-nearby-not-at-the-door", "charges-below-60th-street-and-below-96th-street", "three-manhattan-days-written-out", "the-days-midtown-locks-up", "when-point-to-point-is-still-the-answer"], "blog/nyc-cruise-terminal-black-car-service-guide-march-6.html": ["which-terminal-your-ship-uses", "reaching-piers-88-and-90", "reaching-red-hook", "embarkation-morning-bags-pick-the-vehicle", "return-day-and-customs"], "blog/nyc-limo-service-comparison-guide-april-29.html": ["stretch-sprinter-or-suv", "when-the-clock-starts", "gratuity-waiting-time-and-extras", "surcharges-set-by-the-state-and-the-mta", "surge-pricing-and-a-quoted-rate", "questions-to-ask-before-you-book"], "blog/nyc-prom-limo-booking-guide-march-13.html": ["when-the-2027-prom-season-falls", "what-a-parent-can-check-before-the-night", "alcohol-and-new-york-law", "photo-stops-and-curb-rules", "a-prom-night-hour-by-hour", "what-to-send-dispatch-the-day-before", "one-sprinter-or-two-suvs"], "blog/wedding-event-limo-nyc-march-27.html": ["start-from-the-times-that-cannot-move", "a-wedding-day-timeline-template", "city-hall-ceremonies", "where-a-car-can-wait-at-a-venue", "dates-that-change-the-plan", "one-sprinter-several-cars-or-a-guest-shuttle"], "blog/whatsapp-airport-pickup-coordination-nyc-april-24.html": ["why-the-car-cannot-wait-at-the-door", "where-drivers-wait-for-your-message", "where-you-are-met", "four-messages-worth-sending", "when-the-flight-changes", "international-arrivals", "if-someone-offers-you-a-ride"]};
for (const file of POSTS) {
  const { document, html } = read(file);
  const body = document.querySelector("main>article>section.section.frame>div.grid12>div.prose.c1-8");
  check(`${file}: In short opens the body, then In this guide links every body h2 by its id`, () => {
    assert.ok(body, "no body prose");
    assert.deepEqual(kids(body).slice(0, 2).map(tagOf), ["section.in-short", "nav.toc-post"]);
    const box = body.firstElementChild;
    assert.equal(norm(box.querySelector(":scope>h2").textContent), "In short");
    assert.ok(box.querySelectorAll(":scope>ul>li").length >= 3, "In short holds fewer than 3 points");
    const heads = [...body.querySelectorAll(":scope>h2")];
    assert.ok(heads.length >= 4, `${heads.length} body h2`);
    assert.deepEqual(heads.map((h) => h.id), POST_H2_IDS[file], "the body h2 ids changed");
    const want = heads.map((h) => [`#${h.id}`, norm(h.textContent)]);
    const toc = body.children[1];
    assert.equal(norm(toc.firstElementChild.textContent), "In this guide");
    assert.equal(toc.getAttribute("aria-labelledby"), toc.firstElementChild.id);
    assert.deepEqual([...toc.querySelectorAll(":scope>ol>li>a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]), want);
    const rail = document.querySelector("main>article aside.rail.c9-12");
    const copy = rail.firstElementChild;
    assert.ok(copy.matches("nav.toc-post.toc-post--rail"), "the post rail does not start with nav.toc-post--rail");
    assert.equal(norm(copy.firstElementChild.textContent), "In this guide");
    assert.deepEqual([...copy.querySelectorAll(":scope>ol>li>a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]), want);
    assert.doesNotMatch(document.body.textContent, /Key points/);
  });
  check(`${file}: the date line ends with the reading time from the body word count`, () => {
    const line = norm(document.querySelector("main>article>section.band .rail>p:not(.lede)").textContent);
    const clone = body.cloneNode(true);
    clone.querySelector("nav.toc-post").remove();
    const words = norm(clone.textContent).split(" ").filter(Boolean).length;
    assert.ok(line.endsWith(`, ${Math.max(1, Math.round(words / 230))} min read`), line);
  });
  check(`${file}: the rail Book a car is secondary, so the closing card holds the one gold Book a car`, () => {
    const main = document.querySelector("main");
    assert.equal(main.querySelector("aside.rail a.btn:not(.btn--ghost)"), null, "the rail has a gold button");
    assert.ok(main.querySelector('aside.rail a.btn.btn--ghost[href^="/book"]'), "the rail lost its Book a car");
    assert.ok(main.querySelector(".section--close a.btn:not(.btn--ghost)"), "the closing card has no gold button");
  });
  if (HOURLY_POSTS.includes(file)) check(`${file}: the closing and rail Book a car buttons open By the hour`, () => {
    const main = document.querySelector("main");
    assert.equal(main.querySelectorAll('a[href="/book"]').length, 0, "a plain /book link is left in main");
    assert.equal(main.querySelector(".section--close a.btn").getAttribute("href"), "/book?trip-type=hour&hours=3");
    assert.equal(main.querySelector('aside.rail a.btn[href^="/book"]').getAttribute("href"), "/book?trip-type=hour&hours=3");
  });
  if (AIRPORT_POSTS.includes(file)) check(`${file}: the closing paragraph links Book a JFK transfer and Book a LaGuardia transfer inside a sentence`, () => {
    const close = document.querySelector("main .section--close");
    const p = [...close.querySelectorAll("p")].find((x) => !x.querySelector("a.lnk, a.btn, a.tel") && !x.classList.contains("eyebrow"));
    assert.deepEqual([...p.querySelectorAll("a")].map((a) => [a.getAttribute("href"), norm(a.textContent), a.className]), [["/locations/jfk-airport", "Book a JFK transfer", ""], ["/locations/laguardia-airport", "Book a LaGuardia transfer", ""]]);
  });
}

{
  const { document } = read("blog.html");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  check("blog.html: every card prints Updated Mon D, YYYY from its post's dateModified, and the featured card has one link in the Tab order", () => {
    const cards = [...document.querySelectorAll("main article")];
    assert.equal(cards.length, 10);
    for (const c of cards) {
      const href = c.querySelector("h2 a").getAttribute("href");
      const post = read(`${href.slice(1)}.html`).document;
      const dm = [...post.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { const j = JSON.parse(s.textContent); return j["@graph"] || [j]; }).find((n) => n["@type"] === "BlogPosting").dateModified.slice(0, 10);
      const [y, m, d] = dm.split("-").map(Number);
      const t = c.querySelector("time.note__date");
      assert.equal(t.getAttribute("datetime"), dm, href);
      assert.equal(norm(t.textContent), `Updated ${MON[m - 1]} ${d}, ${y}`, href);
    }
    const second = cards[0].querySelector("p a.lnk");
    assert.equal(second.getAttribute("tabindex"), "-1");
    assert.equal(second.getAttribute("aria-hidden"), "true");
  });
}

{
  const fix = [
    ["locations/bronx.html", "On board", "Free Wi-Fi and charging ports in the executive fleet"],
    ["locations/upper-west-side.html", "On board", "Free Wi-Fi and charging ports in the executive fleet"],
    ["locations/laguardia-airport.html", "On board", "Free Wi-Fi and charging ports in the executive fleet"],
    ["locations/soho.html", "Confirmation", "In writing before your ride"],
    ["locations/financial-district.html", "Early rides", "Pickups at any hour, including before the markets open"],
    ["locations/upper-east-side.html", "Regular bookings", "Repeat pickups, set up once"],
  ];
  for (const [file, b, span] of fix) {
    const { document } = read(file);
    check(`${file}: the honesty fix "${b} / ${span}" holds`, () => {
      assert.ok([...document.querySelectorAll("main ul.assure>li")].some((li) => norm(li.querySelector("b")?.textContent) === b && norm(li.querySelector("span")?.textContent) === span));
    });
  }
  check("locations/soho.html and locations/upper-east-side.html: the rewritten blocks are word for word", () => {
    const soho = read("locations/soho.html").document;
    assert.ok([...soho.querySelectorAll("main p")].some((p) => norm(p.textContent) === "The most common mix-up is West Broadway, a different street from Broadway, four short blocks to the west past Mercer, Greene and Wooster Streets. Another is the same house number on two streets. 100 Greene Street and 100 Wooster Street are one block apart and look almost the same from a car. Give us the cross street with the number, and neither is a problem."));
    const ues = read("locations/upper-east-side.html").document;
    assert.ok([...ues.querySelectorAll("main p")].some((p) => norm(p.textContent) === "If you have rides that repeat, like a weekly appointment on York Avenue or a school run, ask us to set them up as regular bookings. Then you don't book each one. You can book any class by the hour, with a 3-hour minimum. See hourly rates."));
  });
  check("the strings the honesty fixes removed appear on no page", () => {
    const gone = ["Wireless internet", "which is why every booking in this area asks for one", "Evening bookings acknowledged the day before", "Pre-market departures accepted", "household account", "Route knowledge is the last piece", "A chauffeur who has driven the same district for years"];
    const hits = [];
    for (const file of [...BANNERS, "locations.html", "blog.html", ...POSTS]) for (const s of gone) if (read(file).html.includes(s)) hits.push(`${file}: ${s}`);
    assert.deepEqual(hits, []);
  });
}

for (const file of Object.keys(AREAS).concat("locations/laguardia-airport.html")) {
  const { document } = read(file);
  check(`${file}: the hourly band ends with Book by the hour`, () => {
    const text = document.querySelector("main .section--band .svc__text");
    const last = text.lastElementChild.querySelector("a.lnk");
    assert.ok(last, "the band does not end with a .lnk");
    assert.deepEqual([last.getAttribute("href"), norm(last.textContent)], ["/book?trip-type=hour&hours=3", "Book by the hour"]);
  });
}

{
  const { document } = read("services.html");
  const ENDS = { "airport-transfers": [["/book", "Book an airport transfer"]], hourly: [["/book?trip-type=hour&hours=3", "Book by the hour"]], corporate: [["https://wa.me/16467750556?text=Hi%20NYC%20LUX%20RIDE%2C%20I%27d%20like%20to%20ask%20about%20a%20corporate%20account.", "Ask about a corporate account on WhatsApp (opens in a new tab)"]], weddings: [["/book?trip-type=hour&hours=3&class=sprinter", "Book a Sprinter by the hour"]], prom: [["/book?trip-type=hour&hours=3&class=sprinter", "Book a Sprinter by the hour"]], cruise: [["/book", "Book a cruise transfer"]] };
  check("services.html: each of the six sections ends with its one booking link, the Sprinter ones with the dispatch line", () => {
    for (const [id, want] of Object.entries(ENDS)) {
      const text = document.getElementById(id).querySelector(".svc__text");
      const lnks = [...text.querySelectorAll("a.lnk")];
      assert.deepEqual(lnks.map((a) => [a.getAttribute("href"), norm(a.textContent)]), want, id);
      const sprinter = want[0][0].includes("class=sprinter");
      const end = text.lastElementChild;
      assert.ok(end.contains(lnks[0]), `${id}: the link is not at the end`);
      if (sprinter) {
        assert.deepEqual([...end.children].map((e) => e.tagName), ["P", "P"], `${id}: the link and its line share one block`);
        assert.ok(end.firstElementChild.contains(lnks[0]));
        assert.equal(norm(end.lastElementChild.textContent), "Our dispatch team prices Luxury Sprinter bookings by the hour.");
      }
    }
    const wa = document.querySelector("#corporate a.lnk");
    assert.deepEqual([wa.target, wa.rel], ["_blank", "noopener"]);
    assert.doesNotMatch(document.querySelector("main").textContent.replace(/<form[\s\S]*<\/form>/, ""), /\$\s*\d/);
  });
}

for (const [file, prefix, classes] of [["chauffeur-service-nyc.html", "/book?trip-type=hour&hours=3&class=", ["suv", "premium", "first", "sedan"]], ["limousine-service-nyc.html", "/book?class=", ["suv", "premium", "first", "sprinter"]], ["black-car-service-brooklyn.html", "/book?class=", ["premium", "first", "sedan", "sedan"]]]) {
  const { document } = read(file);
  check(`${file}: the fleet card Book links carry their class and the seat glyph is #i-user`, () => {
    const links = [...document.querySelectorAll("main .fleet-card a.lnk")].filter((a) => norm(a.textContent) === "Book a car");
    assert.deepEqual(links.map((a) => a.getAttribute("href")), classes.map((c) => prefix + c));
    for (const a of links) assert.match(a.getAttribute("aria-label"), /^Book a car \(/);
    assert.equal(document.querySelectorAll('main use[href="#i-seat"]').length, 0);
    assert.ok(document.querySelectorAll('main .fleet-card use[href="#i-user"]').length >= 4);
  });
  check(`${file}: the First Class fleet card shows the Mercedes-Benz S-Class as on /fleet`, () => {
    const card = document.querySelector('main .fleet-card a.lnk[href$="class=first"]').closest(".fleet-card");
    assert.equal(norm(card.querySelector(".fleet-card__name").textContent), "Mercedes-Benz S-Class");
    assert.equal(card.querySelector("picture img").getAttribute("src"), "/fleet/mercedes-s-class-600.webp");
    assert.equal(card.querySelector("picture img").getAttribute("alt"), "Black Mercedes-Benz S-Class in a courtyard at night");
    assert.equal(norm(card.querySelector("figcaption").textContent), "S-Class First Class");
    assert.deepEqual([...card.querySelectorAll("a.lnk")].map((a) => a.getAttribute("aria-label").replace(/^.*\(/, "(")), ["(First Class, Mercedes-Benz S-Class)", "(First Class, Mercedes-Benz S-Class)"]);
    assert.doesNotMatch([...document.querySelectorAll("main .fleet-card")].map((c) => c.innerHTML).join(""), /bmw-7-series|BMW 7 Series/);
  });
}

{
  const s = read("locations/staten-island.html").document;
  const c = read("blog/nyc-limo-service-comparison-guide-april-29.html").document;
  check("locations/staten-island.html and the comparison guide show the Jet Sprinter cabin with its alt and caption", () => {
    for (const [doc, sel] of [[s, "figure.banner__photo"], [c, "main>article>section.section--tight figure"]]) {
      const img = doc.querySelector(`${sel} picture img`);
      assert.equal(img.getAttribute("src"), "/fleet/sprinter-jet-900.webp");
      assert.equal(img.getAttribute("alt"), "Inside the Jet Sprinter: two leather captain's chairs facing a screen");
      assert.equal(norm(doc.querySelector(`${sel} figcaption`).textContent), "Jet Sprinter Luxury Sprinter");
      for (const src of doc.querySelectorAll(`${sel} source`)) assert.doesNotMatch(src.getAttribute("srcset"), /sprinter-limo/);
      assert.match(doc.querySelector('head link[rel="preload"][as="image"]').getAttribute("imagesrcset"), /^\/fleet\/sprinter-jet-300\.avif/);
    }
  });
}

if (failures) {
  console.error(`\n${failures} pages-content assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pages-content tests passed");
process.exit(0);
