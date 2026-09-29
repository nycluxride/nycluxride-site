import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const ORIGIN = "https://www.nycluxride.com";
const BASELINE = JSON.parse(readFileSync(join(ROOT, "test/fixtures/seo-baseline.json"), "utf8"));
const VOLATILE = { "privacy-policy.html": ["dateModified"] };

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

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function extract(html) {
  const doc = new JSDOM(html).window.document;
  const meta = (sel) => {
    const el = doc.querySelector(sel);
    return el ? el.getAttribute("content") : null;
  };
  const links = new Set();
  for (const el of doc.querySelectorAll("a[href], area[href]")) {
    const href = el.getAttribute("href");
    let path = null;
    if (href.startsWith(`${ORIGIN}/`)) path = href.slice(ORIGIN.length);
    else if (href.startsWith("/") && !href.startsWith("//")) path = href;
    if (!path) continue;
    const u = new URL(path, ORIGIN);
    if (u.pathname.startsWith("/assets/")) continue;
    links.add(`${u.pathname}${u.hash}`);
  }
  return {
    title: norm(doc.querySelector("title")?.textContent),
    description: meta('meta[name="description"]'),
    robots: meta('meta[name="robots"]'),
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    h1: [...doc.querySelectorAll("h1")].map((n) => norm(n.textContent)),
    og: [...doc.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute("property"), m.getAttribute("content")]),
    jsonld: [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.stringify(JSON.parse(s.textContent))),
    links: [...links].sort(),
  };
}

function strip(value, keys) {
  if (Array.isArray(value)) return value.map((v) => strip(v, keys));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k) && value["@type"] === "WebPage") continue;
      out[k] = strip(v, keys);
    }
    return out;
  }
  return value;
}

const ALLOWED_LINK_CHANGES = {"fleet.html":[["/rates#business-suv","/rates#airport-suv"],["/rates#business-premium-suv","/rates#airport-premium"],["/rates#first-class","/rates#airport-first"],["/rates#sedan-electric","/rates#airport-sedan"],["/rates#luxury-sprinter","/rates#airport-sprinter"]]};

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

const files = htmlFiles(ROOT);
check("the same pages exist as in the baseline", () => assert.deepEqual(files, Object.keys(BASELINE.pages).sort()));

for (const file of files) {
  const want = BASELINE.pages[file];
  if (!want) continue;
  const got = extract(readFileSync(join(ROOT, file), "utf8"));
  check(`${file}: title, description, robots, canonical, H1 and Open Graph equal the baseline`, () => {
    for (const key of ["title", "description", "robots", "canonical", "h1", "og"]) assert.deepEqual(got[key], want[key], key);
  });
  check(`${file}: JSON-LD equals the baseline`, () => {
    const keys = VOLATILE[file] || [];
    assert.deepEqual(got.jsonld.map((s) => strip(JSON.parse(s), keys)), want.jsonld.map((s) => strip(JSON.parse(s), keys)));
  });
  check(`${file}: every internal link target of the baseline is still linked`, () => {
    const have = new Set(got.links);
    const swaps = new Map(ALLOWED_LINK_CHANGES[file] || []);
    assert.deepEqual(want.links.filter((l) => !have.has(l) && !(swaps.has(l) && have.has(swaps.get(l)))), []);
  });
}

const sitemap = [...readFileSync(join(ROOT, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check("sitemap.xml lists exactly the baseline URLs", () => assert.deepEqual(sitemap, BASELINE.sitemap));

if (failures) {
  console.error(`\n${failures} seo baseline assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll seo baseline tests passed");
process.exit(0);
