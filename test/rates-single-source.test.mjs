import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DISTANCE_RATES, CHILD_SEAT_CENTS, SMALL_DOG_CENTS, LARGE_DOG_CENTS, STOP_FEE_CENTS, AIRPORT_TOTALS, CLASSES, WAIT_CENTS_PER_MINUTE, CANCEL_TIERS, VEHICLES } from "../api/_rates.mjs";
import { POLICY } from "../api/_copy.mjs";

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
const SEAT_PRICE = `$${CHILD_SEAT_CENTS / 100} per seat`;
const PET_CARD = "index.html";
const PET_PRICES = [`$${SMALL_DOG_CENTS / 100} per dog`, `$${LARGE_DOG_CENTS / 100} per dog`];
const PET_PAGE = "pet-friendly-car-service-nyc.html";
const PET_PAGE_PRICES = [`$${SMALL_DOG_CENTS / 100} per small dog`, `$${LARGE_DOG_CENTS / 100} per large dog`];
const CANCEL_PAGES = ["faq.html", "terms-of-service.html", "card-authorization.html", "schedule.html", "book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"];
const SEAT_FORM = /\$\s*(\d+(?:[.,]\d+)*)\s*(?:per|a)\s+seat/gi;
const RATE_ANCHORS = ["airport", "jfk", "ewr", "teb", "lga", "airport-total", "hourly", "executive-sedan", "electric-class", "airport-sedan", "airport-electric", "business-suv", "business-premium-suv", "first-class", "luxury-sprinter", "add-ons", "policies", "waiting", "cancellation", "no-show", "changes"];

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
const unseat = (text) => text.replace(new RegExp(`${escape(SEAT_PRICE)}(?!\\w)`, "g"), "");

function walk(node, visit, key = null) {
  if (Array.isArray(node)) node.forEach((v) => walk(v, visit, key));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { visit(k, v); walk(v, visit, k); }
  else visit(key, node, true);
}

function textOf(root) {
  const w = root.ownerDocument.createTreeWalker(root, 4);
  const parts = [];
  while (w.nextNode()) parts.push(w.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ");
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
  const allowed = [...(ALLOWED[file] || []), ...(file === PET_CARD ? PET_PRICES : []), ...(file === PET_PAGE ? PET_PAGE_PRICES : []), ...(CANCEL_PAGES.includes(file) ? [POLICY.cancel] : [])];

  check(`${file}: no NYC LUX RIDE price in text, title, attributes or json-ld apart from the child seat price written ${SEAT_PRICE}${file === PET_CARD ? ` and the pets card prices ${PET_PRICES.join(" and ")}` : ""}${file === PET_PAGE ? ` and the dog prices ${PET_PAGE_PRICES.join(" and ")}` : ""}${CANCEL_PAGES.includes(file) ? ", and the cancellation charges only inside POLICY.cancel word for word" : ""}`, () => {
    const hits = [];
    const scan = (where, s, re = PROSE_PRICE) => {
      const rest = unseat(strip(String(s), allowed));
      for (const m of rest.matchAll(re)) hits.push(`${where}: ...${rest.slice(Math.max(0, m.index - 40), m.index + 30).trim()}...`);
    };
    scan("title", p.title);
    scan("text", p.text);
    for (const [name, value] of p.attrs) scan(`${name}=`, value, PROSE_ATTRS.has(name) ? PROSE_PRICE : PRICE);
    for (const block of p.ld)
      walk(block, (k, v, leaf) => leaf && typeof v === "string" && !NOT_A_PRICE.has(k) && scan(`json-ld ${k}`, v, /^https?:/.test(v) ? PRICE : PROSE_PRICE));
    assert.deepEqual(hits, [], `${hits.length} hit(s): ${hits.slice(0, 3).join(" | ")}`);
  });

  check(`${file}: every price per seat in text, title, attributes or json-ld is CHILD_SEAT_CENTS / 100 from api/_rates.mjs`, () => {
    const found = [p.title, p.text, ...p.attrs.map(([, v]) => v), JSON.stringify(p.ld)].flatMap((s) => [...String(s).matchAll(SEAT_FORM)]);
    const wrong = [...new Set(found.filter((m) => Number(m[1].replace(/,/g, "")) !== CHILD_SEAT_CENTS / 100).map((m) => m[0]))];
    assert.deepEqual(wrong, [], `want ${SEAT_PRICE}, found ${wrong.join(", ")}`);
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

  for (const tok of ALLOWED[file] || []) {
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
    for (const fig of ["$185", "$165", "$220", "$190", "$310", "$250", "$170", "$145", "$450", "$475", "$85", "$95", "$100", "$105", "$175", "$525", "$25"]) assert.ok(rates.text.includes(fig), `${fig} missing`);
    assert.match(rates.title, /\$145(?!\d)/);
  });
  check(`${RATES}: the stop fee is STOP_FEE_CENTS / 100 from api/_rates.mjs, in the distance section and the Extra stops fact, and no other price per stop appears`, () => {
    const fee = `$${STOP_FEE_CENTS / 100}`;
    assert.ok(rates.text.includes(`Each stop adds ${fee}, or more if it takes the car out of the way.`), "distance section");
    assert.ok(rates.text.includes(`${fee} per stop, charged at booking`), "Extra stops fact");
    const found = [...rates.text.matchAll(/(?:stop adds\s+\$\s*(\d+(?:\.\d+)?)|\$\s*(\d+(?:\.\d+)?)\s+(?:per stop|on top of the price))/g)].map((m) => Number(m[1] || m[2]));
    assert.deepEqual([...new Set(found)], [STOP_FEE_CENTS / 100]);
  });
  check(`${RATES}: the retired figures appear nowhere: the old $130 LaGuardia total, the old First Class $125 an hour, the old Electric Class $180, $155 and $90 an hour, and no distance card, base or minimum, while $375 is only the Electric Class three hours and $125 only its hourly rate`, () => {
    assert.equal(rates.document.getElementById("distance-rates"), null);
    assert.equal(rates.document.getElementById("distance-premium"), null);
    const all = [rates.title, rates.text, ...rates.attrs.map(([, v]) => v), JSON.stringify(rates.ld)].join(" ");
    assert.doesNotMatch(all, /\$\s*(?:130|155|90)(?!\d)|"price":"(?:130|155|90)"|\d+(?:\.\d+)? (?:base|minimum)\b/);
    const electric = rates.document.getElementById("electric-class").textContent.replace(/\s+/g, " ");
    assert.equal(all.split(/\$375(?![\d.])/).length - 1, 1, "$375 appears once");
    assert.ok(electric.includes("$375"), electric);
    assert.equal(VEHICLES.electric.hourly * 3, 37500);
    assert.equal(VEHICLES.first.hourly, 17500);
  });
  check(`${RATES}: the add-ons carry the child seat price other pages quote, ${SEAT_PRICE}`, () => {
    const row = [...rates.document.querySelectorAll("#add-ons dt")].find((dt) => dt.textContent.trim() === "Child seats");
    assert.ok(row?.nextElementSibling?.textContent.includes(SEAT_PRICE), "no child seat price in the add-ons");
  });
  check(`${RATES}: the add-ons carry the pet prices of api/_rates.mjs, $${SMALL_DOG_CENTS / 100} per small dog and $${LARGE_DOG_CENTS / 100} per large dog, and no other price per dog appears`, () => {
    const row = [...rates.document.querySelectorAll("#add-ons dt")].find((dt) => dt.textContent.trim() === "Pets");
    assert.ok(row?.nextElementSibling?.textContent.includes(`$${SMALL_DOG_CENTS / 100} per small dog and $${LARGE_DOG_CENTS / 100} per large dog`), "no pet prices in the add-ons");
    assert.ok(row.nextElementSibling.textContent.includes("Service animals ride free"));
    const found = [...rates.text.matchAll(/\$\s*(\d+(?:\.\d+)?)\s+per (small|large) dog/g)].map((m) => [m[2], Number(m[1]) * 100]);
    assert.deepEqual(found, [["small", SMALL_DOG_CENTS], ["large", LARGE_DOG_CENTS]]);
  });
  check(`no page other than the rates page names a price per dog, apart from the homepage pets card, which names exactly ${PET_PRICES[0]} for a small dog and ${PET_PRICES[1]} for a large dog from api/_rates.mjs, and the pet page, which names only ${PET_PAGE_PRICES.join(" and ")}`, () => {
    const outside = (file, p) => {
      if (file === PET_PAGE) return strip(p.text, PET_PAGE_PRICES);
      if (file !== PET_CARD) return p.text;
      const body = p.document.body.cloneNode(true);
      for (const n of body.querySelectorAll("script, style, main > section.hero > section.pets")) n.remove();
      return textOf(body);
    };
    const hits = [...pages].filter(([file]) => file !== RATES).filter(([file, p]) => /\$\s*\d[^.]{0,40}\bdogs?\b|\bdogs?\b[^.]{0,40}\$\s*\d/i.test(outside(file, p))).map(([file]) => file);
    assert.deepEqual(hits, []);
    const card = pages.get(PET_CARD).document.querySelector("main > section.hero > section.pets");
    assert.ok(card, "no pets card on the homepage");
    assert.deepEqual([...textOf(card).matchAll(/\$\s*\d[\d.,]*/g)].map((m) => m[0]), [`$${SMALL_DOG_CENTS / 100}`, `$${LARGE_DOG_CENTS / 100}`]);
    assert.deepEqual([...card.querySelectorAll(".pets__list > li")].map((li) => textOf(li).trim()), [`Small dog ${PET_PRICES[0]}`, `Large dog ${PET_PRICES[1]}`]);
    assert.equal(pages.get(PET_CARD).text.split(" per dog").length - 1, 2, "a price per dog outside the pets card");
    const pet = pages.get(PET_PAGE);
    assert.ok(pet, `${PET_PAGE} is missing`);
    const named = [...pet.text.matchAll(/\$\s*(\d+(?:\.\d+)?)\s+per (small|large) dog/g)].map((m) => [m[2], Number(m[1]) * 100]);
    assert.deepEqual([...new Set(named.map(([size, cents]) => `${size} ${cents}`))].sort(), [`large ${LARGE_DOG_CENTS}`, `small ${SMALL_DOG_CENTS}`]);
    assert.equal(pet.title.match(/\$/g), null, "a dog price in the pet page title");
    assert.equal(JSON.stringify(pet.ld).match(/\$\s*\d/g), null, "a dog price in the pet page json-ld");
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
  check(`${RATES}: the Luxury Sprinter airport totals come from api/_rates.mjs, from $450 in the class row and both rate questions, each Sprinter's own totals in the Sprinter table and its offer, and the retired $500 Sprinter total, $400 and $350 appear nowhere`, () => {
    const keys = Object.keys(VEHICLES).filter((k) => VEHICLES[k].cls === "sprinter");
    const far = Math.min(...keys.map((k) => AIRPORT_TOTALS[k].jfk)) / 100;
    const teb = Math.min(...keys.map((k) => AIRPORT_TOTALS[k].teb)) / 100;
    const ewr = Math.min(...keys.map((k) => AIRPORT_TOTALS[k].ewr)) / 100;
    const lga = Math.min(...keys.filter((k) => AIRPORT_TOTALS[k].lga).map((k) => AIRPORT_TOTALS[k].lga)) / 100;
    assert.deepEqual([far, teb, ewr, lga], [450, 475, 485, 450]);
    assert.deepEqual([...rates.document.querySelectorAll("#airport-sprinter td")].map((td) => td.firstChild.textContent), [`$${far} to $${teb}`, `$${ewr}`, `$${lga}`]);
    for (const key of keys) {
      const cell = rates.document.querySelector(`#${key.replace("sprinter-", "sprinter-airport-")} td`).textContent.replace(/Request.*/, "");
      assert.deepEqual([...cell.matchAll(/(JFK|Newark|Teterboro|LaGuardia)(?: \$(\d+)|, ask for a price)/g)].map((m) => m[2] || ""), ["jfk", "ewr", "teb", "lga"].map((a) => (AIRPORT_TOTALS[key][a] ? String(AIRPORT_TOTALS[key][a] / 100) : "")), key);
    }
    const offers = rates.ld.flatMap((b) => b["@graph"] || [b]).find((n) => n["@type"] === "OfferCatalog").itemListElement.filter((o) => o.name.startsWith("Airport transfer") && o.name.endsWith("Sprinter"));
    assert.deepEqual(offers.map((o) => [o.name, o.priceSpecification.minPrice, o.priceSpecification.maxPrice]), keys.map((k) => [`Airport transfer, ${VEHICLES[k].name}`, String(Math.min(...Object.values(AIRPORT_TOTALS[k])) / 100), String(Math.max(...Object.values(AIRPORT_TOTALS[k])) / 100)]));
    const answers = [...rates.document.querySelectorAll("#q-jfk .acc__body, #q-laguardia .acc__body")].map((n) => n.textContent.replace(/\s+/g, " "));
    assert.ok(answers[0].includes(`Luxury Sprinter from $${far}.`), answers[0]);
    assert.ok(answers[1].includes(`Luxury Sprinter from $${lga}.`), answers[1]);
    const all = [rates.title, rates.text, ...rates.attrs.map(([, v]) => v), JSON.stringify(rates.ld)].join(" ");
    assert.equal(DISTANCE_RATES["sprinter-executive"].minimum, 35000);
    assert.doesNotMatch(all, /\$\s*(?:500|400|350)(?![\d.])|"price":"(?:500|400|350)"|minimum"/);
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

check(`the cancellation charges appear outside the rates page only on ${CANCEL_PAGES.join(", ")}, and only as POLICY.cancel word for word, built from CANCEL_TIERS`, () => {
  const [free, late, later, last] = CANCEL_TIERS;
  assert.deepEqual([free.percent, last.percent, last.hours], [0, 100, 0]);
  assert.equal(POLICY.cancel, `Free cancellation up to ${free.hours} hours before pickup. Under ${free.hours} hours, the charge is ${late.percent}% of the price. Under ${late.hours} hours, it's ${later.percent}%. Under ${later.hours} hours, it's the full price.`);
  for (const file of CANCEL_PAGES) {
    const p = pages.get(file);
    const text = [p.text, JSON.stringify(p.ld)].join(" ");
    assert.ok(p.text.includes(POLICY.cancel), `${file} does not show POLICY.cancel`);
    const left = text.split(POLICY.cancel).join(" ");
    assert.doesNotMatch(left, /\d\s*%/, `${file}: a percent outside POLICY.cancel`);
  }
});

if (rates) {
  check(`${RATES}: #waiting lists every class of api/_rates.mjs with its WAIT_CENTS_PER_MINUTE price per minute, in class order, the Sprinter row for every Sprinter, after POLICY.waiting`, () => {
    const rows = [...rates.document.querySelectorAll("#waiting-rates tbody tr")].map((tr) => [tr.id, tr.querySelector("th").firstChild.textContent, tr.querySelector("td").textContent]);
    assert.deepEqual(rows, Object.keys(CLASSES).map((k) => [`waiting-${k}`, CLASSES[k].name, `$${(WAIT_CENTS_PER_MINUTE[k] / 100).toFixed(2)}`]));
    assert.deepEqual(Object.entries(WAIT_CENTS_PER_MINUTE).sort(), Object.entries({ sedan: 120, electric: 120, suv: 150, premium: 180, first: 280, sprinter: 400 }).sort());
    assert.equal(rates.document.querySelector("#waiting-sprinter small").textContent, "Every Sprinter");
    assert.equal(rates.document.querySelector("#waiting p").textContent.replace(/\s+/g, " "), POLICY.waiting);
  });
  check(`${RATES}: #cancellation lists POLICY.cancel sentence by sentence, and the Extra waiting fact gives the lowest and highest rate of WAIT_CENTS_PER_MINUTE`, () => {
    const items = [...rates.document.querySelectorAll("#cancellation li")].map((li) => li.textContent);
    assert.equal(items.length, CANCEL_TIERS.length);
    assert.equal(items.join(" "), POLICY.cancel);
    const cents = Object.values(WAIT_CENTS_PER_MINUTE);
    const fact = [...rates.document.querySelectorAll("#add-ons dt")].find((dt) => dt.textContent === "Extra waiting").nextElementSibling;
    assert.equal(fact.textContent, `$${(Math.min(...cents) / 100).toFixed(2)} to $${(Math.max(...cents) / 100).toFixed(2)} a minute after the free waiting, by vehicle class`);
    assert.equal(fact.querySelector("a").getAttribute("href"), "#waiting");
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
