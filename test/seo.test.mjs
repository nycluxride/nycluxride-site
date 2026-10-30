import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { getTransformedRoutes } from "@vercel/routing-utils";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const ORIGIN = "https://www.nycluxride.com";
const NOINDEX = ["404.html", "booking-confirmed.html"];
const NOINDEX_RE = /(^|,)\s*(noindex|none)\s*(,|$)/i;
const RETIRED = {
  "/blog/brooklyn-black-car-service-local-guide-april-28": "/black-car-service-brooklyn",
  "/home.webp": "/hero-new.webp",
  "/airports/jfk-limo": "/locations/jfk-airport",
  "/airports/ewr-limo": "/locations/newark-airport",
};

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const robots = readFileSync(join(ROOT, "robots.txt"), "utf8");
test("robots.txt allows crawling and names the sitemap", () => {
  assert.doesNotMatch(robots, /^\s*Disallow:\s*\/\s*$/im);
  assert.match(robots, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "m"));
});

const pages = htmlFiles(ROOT);
test("the page scan finds every page and both noindex pages", () => {
  assert.ok(pages.length >= 40, `${pages.length} pages`);
  for (const file of NOINDEX) assert.ok(pages.includes(file), file);
});

for (const file of pages) {
  const doc = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
  const robotsMeta = [...doc.querySelectorAll('meta[name="robots"]')].map((m) => m.content).join(",");
  const canon = [...doc.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute("href"));
  const route = file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}`;
  if (NOINDEX.includes(file)) {
    test(`${file}: noindex and no canonical`, () => {
      assert.match(robotsMeta, NOINDEX_RE);
      assert.deepEqual(canon, []);
    });
  } else {
    test(`${file}: indexable with one canonical to its own route`, () => {
      assert.doesNotMatch(robotsMeta, NOINDEX_RE);
      assert.deepEqual(canon, [`${ORIGIN}${route}`]);
    });
  }
}

test("retired URLs redirect permanently to live pages", () => {
  const { routes } = getTransformedRoutes(JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")));
  for (const [from, to] of Object.entries(RETIRED)) {
    const hit = routes.find((r) => r.status >= 300 && r.status < 400 && new RegExp(r.src).test(from));
    assert.ok(hit, `${from} no longer redirects`);
    assert.equal(hit.status, 301, from);
    assert.equal(hit.headers.Location, to, from);
    assert.ok(existsSync(join(ROOT, `${to.slice(1)}.html`)) || existsSync(join(ROOT, to.slice(1))), `${to} does not exist`);
  }
});

if (failures) {
  console.error(`\n${failures} seo test(s) failed`);
  process.exit(1);
}
console.log("\nAll seo tests passed");
process.exit(0);
