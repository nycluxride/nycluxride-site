import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const TWINS = JSON.parse(readFileSync(join(ROOT, "fleet/twins.json"), "utf8"));
const HERO_B = ["services.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", ...["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city", "jfk-airport", "laguardia-airport"].map((a) => `locations/${a}.html`)];

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 8).join("\n       ")}`);
  }
}

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "api"].includes(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

const masterOf = (src) => {
  const m = /^\/fleet\/([a-z0-9-]+?)-\d+\.(?:webp|avif)$/.exec(src || "");
  return m && `${m[1]}.webp`;
};

check("fleet/twins.json holds at least the hero and banner masters, each a small 64 px WebP data URI", () => {
  assert.ok(Object.keys(TWINS).length >= 13, `${Object.keys(TWINS).length} entries`);
  for (const [name, t] of Object.entries(TWINS)) {
    assert.deepEqual(Object.keys(t).sort(), ["height", "sha256", "src", "width"], name);
    assert.equal(t.width, 64, name);
    assert.ok(Number.isInteger(t.height) && t.height > 0, name);
    assert.match(t.src, /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/, name);
    const bytes = Buffer.from(t.src.split(",")[1], "base64").length;
    assert.ok(bytes < 600, `${name}: ${bytes} bytes`);
  }
});

check("every twin entry matches the current bytes of its master photo", () => {
  for (const [name, t] of Object.entries(TWINS)) {
    const file = join(ROOT, "fleet", name);
    assert.ok(existsSync(file), `${name} has no master in fleet/`);
    assert.equal(t.sha256, createHash("sha256").update(readFileSync(file)).digest("hex"), `${name}: the master changed, run node scripts/images.mjs`);
  }
});

const pages = htmlFiles(ROOT);
const withTwins = new Set();
for (const file of pages) {
  const { document } = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window;
  const twins = [...document.querySelectorAll("img.plate__twin")];
  if (!twins.length) continue;
  withTwins.add(file);
  check(`${file}: each twin is the first child of a hero or banner figure, decorative, 64 px wide, and is the twin of the photo beside it`, () => {
    for (const img of twins) {
      const fig = img.parentElement;
      assert.ok(fig.matches("figure.hero__photo, figure.banner__photo"), `parent is ${fig.tagName.toLowerCase()}.${fig.className}`);
      assert.equal(fig.firstElementChild, img, "the twin is not the first child");
      assert.deepEqual([img.getAttribute("alt"), img.getAttribute("aria-hidden"), img.getAttribute("width"), img.getAttribute("decoding")], ["", "true", "64", "async"]);
      assert.equal(img.hasAttribute("loading"), false, "a twin is inline and needs no loading attribute");
      const master = masterOf(fig.querySelector("picture img")?.getAttribute("src"));
      assert.ok(master, "the figure has no fleet photo beside the twin");
      const entry = TWINS[master];
      assert.ok(entry, `fleet/twins.json has no entry for ${master}`);
      assert.equal(img.getAttribute("src"), entry.src, `the twin is not the current twin of ${master}`);
      assert.equal(img.getAttribute("height"), String(entry.height), `${master}: height`);
    }
  });
}

check("the Hero A photo has its twin", () => assert.ok(withTwins.has("index.html")));
for (const file of HERO_B) check(`${file}: the Hero B banner photo has its twin`, () => assert.ok(withTwins.has(file)));
check("no page outside Hero A and the 16 Hero B banners carries a twin", () => assert.deepEqual([...withTwins].filter((f) => f !== "index.html" && !HERO_B.includes(f)), []));

if (failures) {
  console.error(`\n${failures} twin assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll twin tests passed");
process.exit(0);
