import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DISTANCE_RATES } from "../api/_rates.mjs";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const RATES = "rates.html";

const ALLOWED = {
  "blog/best-black-car-service-brooklyn-queens-march-20.html": ["$8.75", "$4 billion"],
  "blog/chauffeur-service-nyc-booking-guide-april-30.html": ["$2.75", "$0.75"],
  "blog/corporate-black-car-nyc-april-3.html": ["$2.75", "$0.75", "$14"],
  "blog/jfk-lga-ewr-airport-transfer-guide-april-17.html": ["$45", "$8.75"],
  "blog/manhattan-hourly-chauffeur-service-april-10.html": ["$2.75", "$0.75", "$1.50", "$17"],
  "blog/nyc-limo-service-comparison-guide-april-29.html": ["$2.75", "$0.75", "$1.50"],
  "blog/nyc-prom-limo-booking-guide-march-13.html": ["$50"],
  "terms-of-service.html": ["USD $100"],
};

const NOT_A_PRICE = new Set(["currenciesAccepted"]);
const PRICE = /\$\s*\d|\bUSD\b/g;
const PROSE_PRICE = /\$\s*\d|\bUSD\b|\d\s*%|\d\s*dollars?\b/gi;
const PROSE_ATTRS = new Set(["content", "aria-label", "alt", "title", "placeholder"]);
const PRICE_KEY = /price|offer/i;
const PRICE_TYPE = /Offer|PriceSpecification|MonetaryAmount/;
const RATE_ANCHORS = ["airport", "jfk", "ewr", "teb", "lga", "airport-total", "hourly", "sedan-electric", "business-suv", "business-premium-suv", "first-class", "luxury-sprinter", "add-ons", "cancellation"];

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "cdn-cgi"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const strip = (text, tokens) =>
  tokens.reduce((t, tok) => t.replace(new RegExp(`${escape(tok)}(?![\\d]|[.,]\\d)`, "g"), ""), text);

function walk(node, visit, key = null) {
  if (Array.isArray(node)) node.forEach((v) => walk(v, visit, key));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { visit(k, v); walk(v, visit, k); }
  else visit(key, node, true);
}

function read(file) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const { document } = new JSDOM(html).window;
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => JSON.parse(n.textContent));
  const attrs = [...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => [a.name, a.value]));
  const body = document.body.cloneNode(true);
  for (const n of body.querySelectorAll("script, style")) n.remove();
  const w = document.createTreeWalker(body, 4);
  const parts = [];
  while (w.nextNode()) parts.push(w.currentNode.nodeValue);
  return { document, ld, attrs, title: document.title, text: parts.join(" ").replace(/\s+/g, " ") };
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

const FILES = htmlFiles(ROOT);
check("page discovery found the site and the rates page", () => {
  assert.ok(FILES.length >= 30, `only ${FILES.length} html files`);
  assert.ok(FILES.includes(RATES), `${RATES} is missing`);
});

const pages = new Map(FILES.map((f) => [f, read(f)]));

for (const [file, p] of pages) {
  if (file === RATES) continue;
  const allowed = ALLOWED[file] || [];

  check(`${file}: no NYC LUX RIDE price in text, title, attributes or json-ld`, () => {
    const hits = [];
    const scan = (where, s, re = PROSE_PRICE) => {
      const rest = strip(String(s), allowed);
      for (const m of rest.matchAll(re)) hits.push(`${where}: ...${rest.slice(Math.max(0, m.index - 40), m.index + 30).trim()}...`);
    };
    scan("title", p.title);
    scan("text", p.text);
    for (const [name, value] of p.attrs) scan(`${name}=`, value, PROSE_ATTRS.has(name) ? PROSE_PRICE : PRICE);
    for (const block of p.ld)
      walk(block, (k, v, leaf) => leaf && typeof v === "string" && !NOT_A_PRICE.has(k) && scan(`json-ld ${k}`, v, /^https?:/.test(v) ? PRICE : PROSE_PRICE));
    assert.deepEqual(hits, [], `${hits.length} hit(s): ${hits.slice(0, 3).join(" | ")}`);
  });

  check(`${file}: json-ld carries no price, offer or price specification`, () => {
    const hits = [];
    for (const block of p.ld)
      walk(block, (k, v, leaf) => {
        if (!leaf && PRICE_KEY.test(k)) hits.push(`key ${k}`);
        if (k === "@type" && [].concat(v).some((t) => PRICE_TYPE.test(t))) hits.push(`@type ${v}`);
      });
    const found = [...new Set(hits)];
    assert.deepEqual(found, [], found.join(", "));
  });

  for (const tok of allowed) {
    check(`${file}: allowlisted third-party figure ${tok} is still in use`, () => assert.ok(p.text.includes(tok), `${tok} no longer appears, drop it from the allowlist`));
  }
}

const ratesIds = new Set([...(pages.get(RATES)?.document.querySelectorAll("[id]") || [])].map((el) => el.id));

for (const [file, p] of pages) {
  check(`${file}: links to /rates`, () =>
    assert.ok(p.document.querySelector('a[href="/rates"], a[href^="/rates#"], a[href="https://www.nycluxride.com/rates"]'), "no link to /rates"));

  check(`${file}: every /rates#fragment link has a target on the rates page`, () => {
    const missing = [...p.document.querySelectorAll('a[href^="/rates#"]')].map((a) => a.getAttribute("href").slice(7)).filter((id) => !ratesIds.has(id));
    assert.deepEqual([...new Set(missing)], [], `missing ids: ${[...new Set(missing)].join(", ")}`);
  });
}

const rates = pages.get(RATES);
if (rates) {
  check(`${RATES}: carries the published airport and hourly rates`, () => {
    for (const fig of ["$185", "$165", "$220", "$190", "$310", "$250", "$170", "$145", "$400", "$350", "$155.00", "$13.76", "$3.49", "$12.75", "$85", "$95", "$100", "$105", "$175", "$525", "$25"]) assert.ok(rates.text.includes(fig), `${fig} missing`);
    assert.match(rates.title, /\$145(?!\d)/);
  });
  check(`${RATES}: the retired figures appear nowhere: the old $130 LaGuardia total and the old First Class $125 an hour and $375 for three hours, apart from the Business Premium SUV distance minimum of api/_rates.mjs`, () => {
    const minimum = [...rates.document.querySelectorAll("#distance-premium td span")].map((s) => s.textContent).find((t) => t.endsWith(" minimum"));
    assert.equal(minimum, `$${DISTANCE_RATES.premium.minimum / 100} minimum`);
    const text = rates.text.split(` ${minimum}`);
    assert.equal(text.length, 2, "the distance minimum is the one $125 on the page");
    const all = [rates.title, text.join(" "), ...rates.attrs.map(([, v]) => v), JSON.stringify(rates.ld)].join(" ");
    assert.doesNotMatch(all, /\$\s*(?:130|125|375)(?!\d)|"price":"(?:130|125|375)"/);
  });
  check(`${RATES}: every anchor other pages link to exists`, () => {
    const missing = RATE_ANCHORS.filter((id) => !ratesIds.has(id));
    assert.deepEqual(missing, [], `missing ids: ${missing.join(", ")}`);
  });
  check(`${RATES}: json-ld holds the offer catalog`, () => {
    const types = [];
    for (const block of rates.ld) walk(block, (k, v) => k === "@type" && types.push(...[].concat(v)));
    assert.ok(types.includes("OfferCatalog"), "no OfferCatalog");
  });
  check(`${RATES}: the retired $85 to $175 range appears nowhere`, () => {
    const all = [rates.text, ...rates.attrs.map(([, v]) => v), JSON.stringify(rates.ld)].join(" ");
    assert.doesNotMatch(all, /\$?85\s*(?:to|-)\s*\$?175/);
  });
  check(`${RATES}: offer prices, title, description and faq figures match the tables`, () => {
    const nodes = rates.ld.flatMap((b) => b["@graph"] || [b]);
    const offers = nodes.find((n) => n["@type"] === "OfferCatalog").itemListElement;
    const bad = [];
    for (const o of offers) {
      const s = o.priceSpecification;
      if (o.price !== undefined && o.price !== s.price) bad.push(`${o.name}: ${o.price} vs ${s.price}`);
      const row = rates.document.getElementById(new URL(o.url).hash.slice(1));
      const shown = row ? row.textContent.replace(/\s+/g, " ") : "";
      for (const p of [s.price, s.minPrice, s.maxPrice].filter((x) => x !== undefined))
        if (!new RegExp(`\\$${p}(?!\\d)`).test(shown)) bad.push(`${o.name}: $${p} not shown in #${row?.id}`);
    }
    const tables = [...rates.document.querySelectorAll("main table, main dl")].map((t) => t.textContent).join(" ");
    const told = [rates.title, rates.document.querySelector('meta[name="description"]').content, ...nodes.filter((n) => n["@type"] === "FAQPage").flatMap((f) => f.mainEntity.map((q) => q.acceptedAnswer.text))].join(" ");
    for (const m of told.matchAll(/\$\d+/g)) if (!new RegExp(`\\${m[0]}(?!\\d)`).test(tables)) bad.push(`${m[0]} is not in a rates table`);
    assert.deepEqual(bad, [], bad.join(" | "));
  });
}

check("services.html keeps id=rates so old /services#rates links still land", () =>
  assert.ok(pages.get("services.html")?.document.getElementById("rates"), "no #rates on /services"));

check("site scripts and styles carry no dollar figure", () => {
  const assets = readdirSync(join(ROOT, "assets")).filter((n) => /^(lux\..+\.(js|css)|pay2?\..+\.js|book\..+\.css|done\..+\.js|tracking\.js)$/.test(n));
  assert.ok(assets.length >= 6, `only ${assets.length} assets found`);
  const hits = assets.filter((n) => /\$\s*\d/.test(readFileSync(join(ROOT, "assets", n), "utf8")));
  assert.deepEqual(hits, [], hits.join(", "));
});

check("sitemap.xml lists every page except 404 and the confirmation page, and nothing else", () => {
  const locs = [...readFileSync(join(ROOT, "sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/www\.nycluxride\.com([^<]*)<\/loc>/g)].map((m) => m[1] || "/").sort();
  const want = FILES.filter((f) => f !== "404.html" && f !== "booking-confirmed.html").map((f) => (f === "index.html" ? "/" : "/" + f.replace(/\.html$/, ""))).sort();
  assert.deepEqual(locs, want);
});

if (failures) {
  console.error(`\n${failures} rates single-source assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll rates single-source tests passed");
process.exit(0);
