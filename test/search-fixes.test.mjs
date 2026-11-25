import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { getTransformedRoutes } from "@vercel/routing-utils";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const ORIGIN = "https://www.nycluxride.com";
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const cache = new Map();
const load = (file) => {
  if (!cache.has(file)) cache.set(file, new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document);
  return cache.get(file);
};
const graph = (doc) => [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { const j = JSON.parse(s.textContent); return j["@graph"] || [j]; });
const content = (doc, sel) => doc.querySelector(sel)?.getAttribute("content");

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

const PAGES = {
  "limousine-service-nyc.html": ["Luxury Limo Service NYC for Prom and Groups | NYC LUX RIDE", "Luxury limo service in New York City for prom and group nights. Luxury Sprinters seat up to 14 and book by the hour, with a 4-hour minimum."],
  "chauffeur-service-nyc.html": ["Hourly Luxury Chauffeur Service NYC | NYC LUX RIDE", "Luxury chauffeur service in New York City by the hour, from 3 hours, with one car and chauffeur for every stop. Corporate accounts on monthly billing."],
  "rates.html": ["Car Service Rates and Airport Cost from $145 | NYC LUX RIDE", "A car service to the airport costs from $145 to LaGuardia and $170 to JFK, Newark or Teterboro, with tolls and taxes included. Hourly from $85."],
  "locations/soho.html": ["SoHo Car Service with a Chauffeur | NYC LUX RIDE", "SoHo car service from a corner on West Broadway, Sixth Avenue, Lafayette or Houston Street. One flat price to JFK, LaGuardia, Newark and Teterboro."],
  "car-service-with-car-seat-nyc.html": ["Car Service with Car Seats NYC, $20 per seat | NYC LUX RIDE", null],
  "blog/car-seats-nyc-car-service-parents-november-19.html": ["Car Seat Law in NYC Taxis and Car Services | NYC LUX RIDE", "What New York law says about car seats in taxis and car services, the right seat for each age, and how to book a car with child seats in NYC."],
};
for (const [file, [title, description]] of Object.entries(PAGES)) {
  check(`${file}: the title and its og copy name the searched service, end with | NYC LUX RIDE and stay within 59 characters, and the description and its og copy are exact and 120 to 154 characters`, () => {
    const doc = load(file);
    assert.deepEqual([norm(doc.title), content(doc, 'meta[property="og:title"]')], [title, title]);
    assert.ok(title.endsWith(" | NYC LUX RIDE") && title.length <= 59, `${title.length}: ${title}`);
    const d = content(doc, 'meta[name="description"]');
    if (description) assert.equal(d, description);
    assert.equal(content(doc, 'meta[property="og:description"]'), d);
    assert.ok(d.length >= 120 && d.length <= 154, `${d.length}: ${d}`);
  });
}

check("limousine-service-nyc.html: the lede and the Service description say luxury limo service and name the two limo Sprinters, the lede says luxury once in its first clause, the title and description leave weddings to the wedding page, the H1 keeps its gold span", () => {
  const doc = load("limousine-service-nyc.html");
  assert.ok(norm(doc.querySelector("main .lede").textContent).startsWith("Our luxury limo service in New York City uses five kinds of Sprinter, including the Limo Sprinter and the White Luxury Limo Sprinter, with up to 14 seats"));
  assert.doesNotMatch([norm(doc.title), content(doc, 'meta[name="description"]')].join(" "), /wedding/i);
  assert.match(graph(doc).find((n) => n["@type"] === "Service").description, /^Chauffeured luxury limo service in New York City in five kinds of Luxury Sprinter, including the Limo Sprinter and White Luxury Limo Sprinter,/);
  assert.equal(norm(doc.querySelector("h1 .h-gold").textContent), "weddings, prom and group travel");
});

check("chauffeur-service-nyc.html: the Service description starts with Luxury chauffeur service in New York City by the hour", () => {
  assert.match(graph(load("chauffeur-service-nyc.html")).find((n) => n["@type"] === "Service").description, /^Luxury chauffeur service in New York City by the hour or as directed,/);
});

check("locations/soho.html: the H1 reads SoHo car service with a chauffeur, with SoHo in the gold span, and the Service description equals the meta description", () => {
  const doc = load("locations/soho.html");
  assert.equal(norm(doc.querySelector("h1").textContent), "SoHo car service with a chauffeur");
  assert.equal(norm(doc.querySelector("h1 .h-gold").textContent), "SoHo");
  assert.equal(graph(doc).find((n) => n["@type"] === "Service").description, content(doc, 'meta[name="description"]'));
});

const LINKS = [
  ["index.html", "/limousine-service-nyc", "Limo service"],
  ["locations/soho.html", "/limousine-service-nyc", "limo service"],
  ["locations/queens.html", "/limousine-service-nyc", "limo service"],
  ["locations/bronx.html", "/limousine-service-nyc", "luxury limo service"],
  ["fleet.html", "/limousine-service-nyc", "luxury limo service"],
  ["index.html", "/chauffeur-service-nyc", "Chauffeur service"],
  ["locations/manhattan.html", "/chauffeur-service-nyc", "chauffeur service by the hour"],
  ["locations/upper-west-side.html", "/chauffeur-service-nyc", "NYC chauffeur service"],
  ["black-car-service-brooklyn.html", "/chauffeur-service-nyc", "chauffeur service"],
  ["about.html", "/chauffeur-service-nyc", "chauffeur service"],
  ["locations/jfk-airport.html", "/chauffeur-service-nyc", "Read about chauffeur service in NYC"],
  ["locations/manhattan.html", "/locations/soho", "SoHo car service"],
  ["locations/financial-district.html", "/locations/soho", "SoHo car service"],
  ["locations/midtown-manhattan.html", "/locations/soho", "car service in SoHo"],
  ["locations/hoboken.html", "/locations/soho", "SoHo car service"],
  ["blog/manhattan-hourly-chauffeur-service-april-10.html", "/locations/soho", "car service in SoHo"],
  ["chauffeur-service-nyc.html", "/locations/jfk-airport", "JFK chauffeur service"],
  ["blog/jfk-lga-ewr-airport-transfer-guide-april-17.html", "/locations/jfk-airport", "JFK chauffeur service"],
  ["car-service-with-car-seat-nyc.html", "/blog/car-seats-nyc-car-service-parents-november-19", "our guide to New York car seat law"],
];
check("the reworded internal links carry the service phrase as their anchor text inside main", () => {
  const miss = LINKS.filter(([file, href, text]) => ![...load(file).querySelectorAll(`main a[href="${href}"]`)].some((a) => norm(a.textContent) === text));
  assert.deepEqual(miss, []);
});
const RETIRED_ANCHORS = [
  ["index.html", "/limousine-service-nyc", "Weddings, prom and groups"],
  ["index.html", "/chauffeur-service-nyc", "Hourly chauffeur"],
  ["fleet.html", "/limousine-service-nyc", "limousine service"],
  ...["locations/soho.html", "locations/queens.html", "locations/bronx.html"].map((f) => [f, "/limousine-service-nyc", "14-seat Sprinter"]),
  ...["locations/manhattan.html", "locations/upper-west-side.html", "black-car-service-brooklyn.html", "about.html"].map((f) => [f, "/chauffeur-service-nyc", "by the hour"]),
  ["locations/jfk-airport.html", "/chauffeur-service-nyc", "Read about hourly chauffeur service"],
  ["blog/jfk-lga-ewr-airport-transfer-guide-april-17.html", "/locations/jfk-airport", "JFK terminal pickups"],
  ...["locations/financial-district.html", "locations/midtown-manhattan.html", "blog/manhattan-hourly-chauffeur-service-april-10.html"].map((f) => [f, "/locations/soho", "SoHo"]),
];
check("the anchors these links replaced are gone from main on those pages", () => {
  const left = RETIRED_ANCHORS.filter(([file, href, text]) => [...load(file).querySelectorAll(`main .prose a[href="${href}"], main .icard a[href="${href}"], main details a[href="${href}"]`)].some((a) => norm(a.textContent) === text));
  assert.deepEqual(left, []);
});
check("the FAQ answers that gained a SoHo car service link say the same in their FAQPage JSON-LD", () => {
  for (const [file, text] of [["locations/financial-district.html", "North of that, see our SoHo car service page and the rest of Manhattan."], ["locations/midtown-manhattan.html", "Downtown has its own pages for car service in SoHo and the Financial District."]]) {
    const doc = load(file);
    const ld = graph(doc).filter((n) => n["@type"] === "FAQPage").flatMap((n) => n.mainEntity).map((q) => q.acceptedAnswer.text);
    assert.ok(ld.some((a) => a.includes(text)), `${file}: JSON-LD`);
    assert.ok([...doc.querySelectorAll("main details .acc__body")].some((b) => norm(b.textContent).includes(text)), `${file}: visible`);
  }
});

const TAXI_Q = "Do I need a car seat in a New York taxi?";
const TAXI_A = "New York law doesn't require one. The child seat rules don't apply to taxis and liveries, though passengers aged 8 and older must wear a seat belt. For a younger child, book a child, infant or booster seat with us, $20 per seat.";
check("car-service-with-car-seat-nyc.html: Car seats in taxis and car services follows Our seats, cites VTL section 1229-c with the New York State Senate link in a new tab, and the taxi question is second, the same in the page and in JSON-LD", () => {
  const doc = load("car-service-with-car-seat-nyc.html");
  const h = doc.getElementById("taxis-and-the-law");
  assert.equal(norm(h.textContent), "Car seats in taxis and car services");
  const ps = [];
  for (let n = h.nextElementSibling; n && n.tagName === "P"; n = n.nextElementSibling) ps.push(n);
  assert.equal(ps.length, 3);
  assert.ok(norm(ps[0].textContent).startsWith("Under New York's Vehicle and Traffic Law, section 1229-c, the child seat rules don't apply in taxis and liveries. Passengers aged 8 and older in a taxi or livery still have to wear a seat belt."));
  const law = ps[0].querySelector('a[href="https://www.nysenate.gov/legislation/laws/VAT/1229-C"]');
  assert.deepEqual([law?.getAttribute("target"), law?.getAttribute("rel"), norm(law?.textContent)], ["_blank", "noopener", "New York State Senate site (opens in a new tab)"]);
  assert.equal(h.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.id, "passengers");
  assert.ok(norm(doc.querySelector("main").textContent).match(/\btaxis?\b/gi).length >= 4, "the page says taxi fewer than 4 times");
  const visible = [...doc.querySelectorAll("main details")].map((d) => [d.id, norm(d.querySelector("summary").textContent), norm(d.querySelector(".acc__body").textContent)]);
  assert.deepEqual(visible[1], ["q-taxi-seat", TAXI_Q, TAXI_A]);
  const ld = graph(doc).find((n) => n["@type"] === "FAQPage").mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
  assert.deepEqual(ld[1], [TAXI_Q, TAXI_A]);
  assert.deepEqual(ld.map(([q]) => q), visible.map(([, q]) => q));
});

check("blog/car-seats-nyc-car-service-parents-november-19.html: Car seats and New York law is the second body section, in both In this guide lists, and dateModified is 2026-11-25 in the post, blog.html and the date line", () => {
  const doc = load("blog/car-seats-nyc-car-service-parents-november-19.html");
  const heads = [...doc.querySelectorAll("main .prose > h2[id]")].map((h) => h.id);
  assert.equal(heads[1], "car-seats-and-new-york-law");
  assert.equal(norm(doc.getElementById("car-seats-and-new-york-law").textContent), "Car seats and New York law");
  assert.equal(doc.querySelectorAll('nav.toc-post a[href="#car-seats-and-new-york-law"]').length, 2);
  assert.equal(graph(doc).find((n) => n["@type"] === "BlogPosting").dateModified, "2026-11-25T12:00:00.000Z");
  assert.equal(graph(doc).find((n) => n["@type"] === "BlogPosting").description, content(doc, 'meta[name="description"]'));
  const nodes = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { nodes.push(v); Object.values(v).forEach(walk); } };
  walk(graph(load("blog.html")));
  const listed = nodes.find((x) => x.url === `${ORIGIN}/blog/car-seats-nyc-car-service-parents-november-19` && x.dateModified);
  assert.deepEqual([listed?.dateModified, listed?.description], ["2026-11-25T12:00:00.000Z", content(doc, 'meta[name="description"]')]);
});

const RATES_FAQ_ORDER = ["How much does a car service to the airport cost?", "How much is a car from Manhattan to JFK?", "How much is a car to LaGuardia?", "How much is a car service by the hour in NYC?", "What is the shortest hourly booking?", "When is my fare confirmed?"];
check("rates.html: the two cost questions in searchers' words come first and fourth, in the page and in JSON-LD", () => {
  const doc = load("rates.html");
  assert.deepEqual([...doc.querySelectorAll("main details summary")].map((s) => norm(s.textContent)), RATES_FAQ_ORDER);
  assert.deepEqual(graph(doc).find((n) => n["@type"] === "FAQPage").mainEntity.map((q) => q.name), RATES_FAQ_ORDER);
});

const COUNTIES = ["atlantic", "bergen", "burlington", "camden", "cape-may", "cumberland", "essex", "gloucester", "hudson", "hunterdon", "mercer", "middlesex", "monmouth", "morris", "ocean", "passaic", "salem", "somerset", "sussex", "union", "warren"];
check("sitemap.xml: the 21 New Jersey county pages carry 2026-11-25, the day they went live, and so do the pages whose copy changed", () => {
  const xml = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
  const mods = Object.fromEntries([...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]));
  const want = [...COUNTIES.map((c) => `locations/${c}-county-nj`), "car-service-with-car-seat-nyc", "rates", "chauffeur-service-nyc", "limousine-service-nyc", "locations/soho", "blog/car-seats-nyc-car-service-parents-november-19"];
  assert.deepEqual(want.filter((p) => mods[`${ORIGIN}/${p}`] !== "2026-11-25"), []);
  assert.equal(Object.keys(mods).filter((u) => /-county-nj$/.test(u)).length, 21);
});

const { routes } = getTransformedRoutes(JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")));
const hops = (path) => {
  const out = [];
  for (let p = path, i = 0; i < 10; i++) {
    const r = routes.find((x) => x.status >= 300 && x.status < 400 && !x.has && !x.missing && new RegExp(x.src).test(p));
    if (!r) break;
    const m = new RegExp(r.src).exec(p);
    p = r.headers.Location.replace(/\$(\d)/g, (_, n) => m[n] ?? "");
    out.push([r.status, p]);
  }
  return out;
};
check("redirects: the old airport pages reach their airport page in two permanent hops, the slash copy of the chauffeur page goes to the page in one, /pricing and /prices go to /rates, and none of the edited pages redirects", () => {
  assert.deepEqual(hops("/airports/jfk-limo.html"), [[308, "/airports/jfk-limo"], [301, "/locations/jfk-airport"]]);
  assert.deepEqual(hops("/airports/ewr-limo.html"), [[308, "/airports/ewr-limo"], [301, "/locations/newark-airport"]]);
  assert.deepEqual(hops("/chauffeur-service-nyc/"), [[308, "/chauffeur-service-nyc"]]);
  assert.deepEqual(hops("/limousine-service-nyc.html"), [[308, "/limousine-service-nyc"]]);
  assert.deepEqual([hops("/pricing"), hops("/prices")], [[[301, "/rates"]], [[301, "/rates"]]]);
  for (const file of [...Object.keys(PAGES), ...LINKS.map(([f]) => f)]) {
    const path = file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}`;
    assert.deepEqual(hops(path), [], path);
  }
});

if (failures) {
  console.error(`\n${failures} search fix test(s) failed`);
  process.exit(1);
}
console.log("\nAll search fix tests passed");
process.exit(0);
