import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { JSDOM } from "jsdom";

export const MIN_UNIQUE_WORDS = 500;
export const MAX_SHARED = 0.3;
export const N = 8;

export const EXISTING = new Set([
  "404.html", "about.html", "black-car-service-brooklyn.html", "blog.html", "book.html", "booking-confirmed.html", "car-service-with-car-seat-nyc.html", "card-authorization.html", "chauffeur-service-nyc.html", "contact.html", "corporate-car-service-nyc.html", "faq.html", "fleet.html", "index.html", "limousine-service-nyc.html", "locations.html", "privacy-policy.html", "rates.html", "schedule.html", "services.html", "terms-of-service.html",
  ...["bronx", "brooklyn", "financial-district", "jfk-airport", "laguardia-airport", "long-island-city", "manhattan", "newark-airport", "queens", "soho", "staten-island", "upper-east-side", "upper-west-side"].map((a) => `locations/${a}.html`),
  ...["best-black-car-service-brooklyn-queens-march-20", "chauffeur-service-nyc-booking-guide-april-30", "corporate-black-car-nyc-april-3", "jfk-lga-ewr-airport-transfer-guide-april-17", "manhattan-hourly-chauffeur-service-april-10", "nyc-cruise-terminal-black-car-service-guide-march-6", "nyc-limo-service-comparison-guide-april-29", "nyc-prom-limo-booking-guide-march-13", "wedding-event-limo-nyc-march-27", "whatsapp-airport-pickup-coordination-nyc-april-24"].map((s) => `blog/${s}.html`),
]);
const NYC_AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city", "midtown-manhattan"];
const SERVICES = ["chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", "car-service-with-car-seat-nyc.html", "corporate-car-service-nyc.html", "long-distance-car-service.html", "pet-friendly-car-service-nyc.html", "private-jet-car-service-nyc.html", "roadshow-transportation-nyc.html", "sprinter-van-service-nyc.html", "cruise-terminal-car-service-nyc.html", "wedding-car-service-nyc.html"];

export function familyOf(file) {
  const loc = /^locations\/([a-z0-9-]+)\.html$/.exec(file);
  if (loc) return /-airport$/.test(loc[1]) ? "airport" : NYC_AREAS.includes(loc[1]) ? "nyc-area" : "outside";
  if (/^long-distance-car-service\/[a-z0-9-]+\.html$/.test(file)) return "route";
  if (/^blog\/[a-z0-9-]+\.html$/.test(file)) return "post";
  if (SERVICES.includes(file)) return "service";
  return null;
}

export function htmlFiles(root, dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "api", "cdn-cgi"].includes(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(root, full));
    else if (name.endsWith(".html")) out.push(relative(root, full));
  }
  return out.sort();
}

const BLOCKS = "p, li, dd, dt, td, th, caption, summary, h2, h3, h4, figcaption, blockquote";
const SKIP = "#book-form, nav.crumbs, aside.rail, .section--close, figure.citymap, nav.toc-post";
const words = (s) => s.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9$]+/g) || [];

export function bodyBlocks(html) {
  const { document } = new JSDOM(html).window;
  const main = document.querySelector("main");
  if (!main) return [];
  for (const n of main.querySelectorAll(SKIP)) n.remove();
  const out = [];
  for (const el of main.querySelectorAll(BLOCKS)) {
    if (el.querySelector(BLOCKS.split(", ").filter((t) => !["summary", "caption"].includes(t)).join(", "))) continue;
    const w = words(el.textContent);
    if (w.length) out.push(w);
  }
  return out;
}

export function grams(blocks) {
  const set = new Set();
  for (const b of blocks) for (let i = 0; i + N <= b.length; i++) set.add(b.slice(i, i + N).join(" "));
  return set;
}

export function uniqueWords(blocks, siblingGrams, siblingShort) {
  let n = 0;
  for (const b of blocks) {
    if (b.length < N) {
      if (!siblingShort.has(b.join(" "))) n += b.length;
      continue;
    }
    const covered = new Array(b.length).fill(false);
    for (let i = 0; i + N <= b.length; i++) if (siblingGrams.has(b.slice(i, i + N).join(" "))) for (let k = i; k < i + N; k++) covered[k] = true;
    n += covered.filter((c) => !c).length;
  }
  return n;
}

export function measure(file, blocks, siblings) {
  const own = grams(blocks);
  const allGrams = new Set();
  const allShort = new Set();
  const shared = [];
  for (const [other, ob] of siblings) {
    const og = grams(ob);
    for (const g of og) allGrams.add(g);
    for (const b of ob) if (b.length < N) allShort.add(b.join(" "));
    let both = 0;
    for (const g of own) if (og.has(g)) both++;
    shared.push([other, own.size ? both / own.size : 0]);
  }
  shared.sort((a, b) => b[1] - a[1]);
  return { file, words: blocks.reduce((a, b) => a + b.length, 0), unique: uniqueWords(blocks, allGrams, allShort), grams: own.size, shared };
}

export function measureSite(root, only = null) {
  const files = htmlFiles(root);
  const blocks = new Map(files.filter((f) => familyOf(f)).map((f) => [f, bodyBlocks(readFileSync(join(root, f), "utf8"))]));
  const out = [];
  for (const [file, b] of blocks) {
    if (EXISTING.has(file) || (only && !only.includes(file))) continue;
    const fam = familyOf(file);
    out.push({ family: fam, ...measure(file, b, [...blocks].filter(([f]) => f !== file && familyOf(f) === fam)) });
  }
  return out;
}
