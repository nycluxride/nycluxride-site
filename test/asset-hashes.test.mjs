import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const LOCK = join(ROOT, "test", "asset-hashes.json");
const HASHED = /^(.+)\.([A-Za-z0-9_-]{6,})\.(js|css|webp|webmanifest)$/;

const current = {};
for (const name of readdirSync(join(ROOT, "assets"))) {
  if (!HASHED.test(name)) continue;
  current[name] = createHash("sha256").update(readFileSync(join(ROOT, "assets", name))).digest("hex").slice(0, 16);
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

if (process.argv.includes("--update")) {
  writeFileSync(LOCK, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`wrote ${Object.keys(current).length} entries to test/asset-hashes.json`);
  process.exit(0);
}

test("test/asset-hashes.json exists", () => {
  assert.ok(existsSync(LOCK), "run: node asset-hashes.test.mjs --update");
});

if (existsSync(LOCK)) {
  const locked = JSON.parse(readFileSync(LOCK, "utf8"));

  test("no content-hashed asset was edited without being renamed", () => {
    const drifted = Object.keys(current)
      .filter((name) => locked[name] && locked[name] !== current[name])
      .map((name) => `${name}: locked ${locked[name]} but content is ${current[name]}`);
    assert.deepEqual(drifted, [], "a hashed filename promises immutable content, and vercel.json caches these for a year");
  });

  test("the asset lock and the assets directory agree", () => {
    assert.deepEqual(Object.keys(current).sort(), Object.keys(locked).sort());
  });
}

test("every hashed asset referenced by the html exists on disk", () => {
  const missing = [];
  for (const name of readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
    for (const m of readFileSync(join(ROOT, name), "utf8").matchAll(/\/assets\/([A-Za-z0-9_.-]+)/g)) {
      if (HASHED.test(m[1]) && !existsSync(join(ROOT, "assets", m[1]))) missing.push(`${name} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("no html references a hashed asset filename that no longer exists anywhere", () => {
  const known = new Set(Object.keys(current));
  const stale = [];
  for (const name of readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
    for (const m of readFileSync(join(ROOT, name), "utf8").matchAll(/\/assets\/([A-Za-z0-9_.-]+\.(?:js|css|webp|webmanifest))/g)) {
      if (HASHED.test(m[1]) && !known.has(basename(m[1]))) stale.push(`${name} -> ${m[1]}`);
    }
  }
  assert.deepEqual(stale, []);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll asset hash tests passed");
process.exit(0);
