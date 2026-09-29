import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const SKIP = ["node_modules", ".git", "test", "scripts"];
const TYPES = [".html", ".css", ".js", ".mjs", ".json", ".xml", ".txt", ".webmanifest"];
const BOOK = 'href="/book"';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (TYPES.includes(extname(name))) out.push(relative(ROOT, full));
  }
  return out.sort();
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`);
  }
}

const files = walk(ROOT);
const pages = files.filter((f) => f.endsWith(".html") && !f.startsWith("assets/"));

check("the walk found the site, its assets and its config", () => {
  assert.ok(pages.length >= 39, `only ${pages.length} pages`);
  for (const f of ["vercel.json", "sitemap.xml", "assets/tracking.js"]) assert.ok(files.includes(f), `${f} not walked`);
});

check("no file outside test and scripts mentions Moovs", () => {
  const hits = files.flatMap((f) => {
    const text = readFileSync(join(ROOT, f), "utf8");
    const n = (text.match(/moovs/gi) || []).length;
    return n ? [`${f} (${n})`] : [];
  });
  assert.deepEqual(hits, [], hits.join(", "));
});

const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

check("vercel.json has no redirect from /book", () => {
  const bad = (config.redirects || []).filter((r) => r.source === "/book" || r.source.startsWith("/book/"));
  assert.deepEqual(bad, []);
});

check("vercel.json has no redirect to Moovs", () => {
  const bad = (config.redirects || []).filter((r) => /moovs/i.test(r.destination));
  assert.deepEqual(bad, []);
});

let total = 0;
for (const file of pages) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const count = html.split(BOOK).length - 1;
  total += count;
  if (!html.includes('<header class="site-header">')) continue;
  check(`${file}: at least four links to /book`, () => assert.ok(count >= 4, `${count} links`));
}

check(`the site links to /book at least 248 times (${total})`, () => assert.ok(total >= 248, `${total} links`));

check("the three hero forms submit to /book with a button", () => {
  const forms = pages.filter((f) => readFileSync(join(ROOT, f), "utf8").includes('<form class="trip" method="get" action="/book"'));
  assert.deepEqual(forms, ["index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html"]);
});

if (failures) {
  console.error(`\n${failures} no-moovs assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll no-moovs tests passed");
process.exit(0);
