import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const HASHED = /^(.+)\.([A-Za-z0-9_-]{6,})\.(js|css|webp|webmanifest|woff2)$/;
const REFERRERS = /\.(css|js|webmanifest)$/;
const BUDGETS = [
  [/^lux\..*\.css$/, 106000, true],
  [/^book\..*\.css$/, 59600, true],
  [/^lux\..*\.js$/, 11264, true],
  [/^pay\..*\.js$/, 59000, true],
  [/^pay2\..*\.js$/, 7800, true],
  [/^done\..*\.js$/, 8600, false],
];
const AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"];
const BOOKING_PAGES = ["index.html", "book.html", "booking-confirmed.html", "services.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", ...AREAS.map((a) => `locations/${a}.html`)];
const BOOKING_CSS = 163600;
const BOOK_SCRIPTS = 71000;
const SPECULATION_BYTES = 600;
const FONT_FILES = 3;
const FONT_BYTES = 60000;

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "test", "scripts"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
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

test("every hashed filename is derived from its own bytes", () => {
  const wrong = [];
  for (const dir of ["assets", "assets/fonts"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      const m = HASHED.exec(name);
      if (!m) continue;
      const want = createHash("sha256")
        .update(readFileSync(join(ROOT, dir, name)))
        .digest("base64url")
        .replace(/[-_]/g, "")
        .slice(0, 8);
      if (m[2] !== want) wrong.push(`${dir}/${name} should be ${m[1]}.${want}.${m[3]}`);
    }
  }
  assert.deepEqual(wrong, [], "run: node scripts/rehash.mjs");
});

test("every font file name carries a content hash", () => {
  const plain = readdirSync(join(ROOT, "assets/fonts")).filter((name) => name.endsWith(".woff2") && !HASHED.test(name));
  assert.deepEqual(plain, [], `${plain.join(", ")}: vercel.json caches fonts as immutable, run: node scripts/rehash.mjs`);
});

test("every /assets/ file referenced by the html or by assets/*.css, *.js and *.webmanifest exists on disk", () => {
  const referrers = [...htmlFiles(ROOT), ...readdirSync(join(ROOT, "assets")).filter((name) => REFERRERS.test(name)).map((name) => join(ROOT, "assets", name))];
  const missing = [];
  for (const file of referrers) {
    for (const m of readFileSync(file, "utf8").matchAll(/\/assets\/([A-Za-z0-9_.\/-]+)/g)) {
      if (!existsSync(join(ROOT, "assets", m[1]))) missing.push(`${file} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

for (const [pattern, budget, required] of BUDGETS) {
  const names = readdirSync(join(ROOT, "assets")).filter((f) => pattern.test(f));
  if (required) test(`budget: exactly one asset matches ${pattern}`, () => assert.equal(names.length, 1, names.join(", ")));
  else test(`budget: at most one asset matches ${pattern}`, () => assert.ok(names.length <= 1, names.join(", ")));
  for (const name of names) {
    const bytes = statSync(join(ROOT, "assets", name)).size;
    test(`budget: ${name} is ${bytes} bytes, under ${budget}`, () => assert.ok(bytes <= budget, `${bytes} exceeds ${budget} by ${bytes - budget}`));
  }
}

const linked = (file, re) =>
  [...readFileSync(join(ROOT, file), "utf8").matchAll(re)].map((m) => m[1]).filter((p) => existsSync(join(ROOT, p)));

test(`booking pages load lux and book CSS within ${BOOKING_CSS} bytes`, () => {
  assert.equal(BOOKING_PAGES.length, 19);
  for (const file of BOOKING_PAGES) {
    const css = linked(file, /<link rel="stylesheet" href="\/(assets\/(?:lux|book)\.[^"]+\.css)">/g);
    assert.ok(css.some((p) => /^assets\/lux\./.test(p)), `${file} links no lux.css`);
    const bytes = css.reduce((sum, p) => sum + statSync(join(ROOT, p)).size, 0);
    assert.ok(bytes <= BOOKING_CSS, `${file}: ${bytes} bytes of CSS exceeds ${BOOKING_CSS} by ${bytes - BOOKING_CSS}`);
  }
});

test(`/book loads lux.js and pay.js within ${BOOK_SCRIPTS} bytes`, () => {
  const js = linked("book.html", /<script[^>]*\ssrc="\/(assets\/(?:lux|pay)\.[^"]+\.js)"/g);
  assert.deepEqual(js.map((p) => p.replace(/\.[^.]+\.js$/, ".js")).sort(), ["assets/lux.js", "assets/pay.js"]);
  const bytes = js.reduce((sum, p) => sum + statSync(join(ROOT, p)).size, 0);
  assert.ok(bytes <= BOOK_SCRIPTS, `${bytes} bytes exceeds ${BOOK_SCRIPTS} by ${bytes - BOOK_SCRIPTS}`);
});

test(`assets/speculation.json is valid JSON of at most ${SPECULATION_BYTES} bytes with prefetch rules only, no prerender, and excludes /api/*`, () => {
  const file = join(ROOT, "assets/speculation.json");
  assert.ok(existsSync(file), "assets/speculation.json is missing");
  const text = readFileSync(file, "utf8");
  assert.ok(Buffer.byteLength(text) <= SPECULATION_BYTES, `${Buffer.byteLength(text)} bytes`);
  const rules = JSON.parse(text);
  assert.deepEqual(Object.keys(rules), ["prefetch"]);
  assert.ok(Array.isArray(rules.prefetch) && rules.prefetch.length > 0, "no prefetch rule");
  for (const rule of rules.prefetch) {
    assert.ok(["immediate", "eager", "moderate", "conservative"].includes(rule.eagerness), `eagerness ${rule.eagerness}`);
    const where = JSON.stringify(rule.where || {});
    assert.ok(where.includes('{"not":{"href_matches":"/api/*"}}'), "the rule does not exclude /api/*");
  }
});

test(`fonts: at most ${FONT_FILES} woff2 files and at most ${FONT_BYTES} bytes of woff2 in assets/fonts`, () => {
  const fonts = readdirSync(join(ROOT, "assets/fonts")).filter((name) => name.endsWith(".woff2"));
  const bytes = fonts.reduce((sum, name) => sum + statSync(join(ROOT, "assets/fonts", name)).size, 0);
  assert.ok(fonts.length <= FONT_FILES, `${fonts.length} woff2 files: ${fonts.join(", ")}`);
  assert.ok(bytes <= FONT_BYTES, `${bytes} bytes of woff2 exceeds ${FONT_BYTES} by ${bytes - FONT_BYTES}`);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll asset hash tests passed");
process.exit(0);
