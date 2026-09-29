import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel"]);
const NEEDLES = [
  ["sk", "live"],
  ["sk", "test"],
  ["rk", "live"],
  ["rk", "test"],
  ["pk", "live"],
  ["whsec", ""],
].map((parts) => parts.join("_"));

const skipEnv = (name) => /^\.env/.test(name) && !/^\.env\.(example|sample)$/.test(name);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (SKIP_DIRS.has(name) || rel === join("test", "node_modules")) continue;
    if (skipEnv(name)) continue;
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(rel);
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
    console.error(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
  }
}

const all = files(ROOT);

test(`the repository holds no Stripe key or webhook secret (${all.length} files)`, () => {
  assert.ok(all.length > 50, `only ${all.length} files walked`);
  const hits = [];
  for (const file of all) {
    const text = readFileSync(join(ROOT, file), "latin1");
    for (const needle of NEEDLES) if (text.includes(needle)) hits.push(`${file}: ${needle}`);
  }
  assert.deepEqual(hits, []);
});

test("the walk covers api/, test/ and scripts/", () => {
  for (const file of ["api/book.mjs", "api/_stripe.mjs", "test/book-params.test.mjs", "scripts/serve.mjs"]) assert.ok(all.includes(file), file);
});

test("the walk skips local .env files but scans .env.example and .env.sample", () => {
  for (const name of [".env", ".env.local", ".env.production", ".envrc"]) assert.equal(skipEnv(name), true, name);
  for (const name of [".env.example", ".env.sample", "env.mjs"]) assert.equal(skipEnv(name), false, name);
});

test(".gitignore still ignores .env*", () => {
  const lines = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(lines.includes(".env*"), ".gitignore has no .env* line");
});

test("no file in api/ reads a key from anywhere but process.env", () => {
  for (const name of readdirSync(join(ROOT, "api"))) {
    const text = readFileSync(join(ROOT, "api", name), "utf8");
    const uses = [...text.matchAll(/STRIPE_SECRET_KEY/g)].length;
    const fromEnv = [...text.matchAll(/process\.env\.STRIPE_SECRET_KEY/g)].length;
    assert.equal(uses, fromEnv, name);
  }
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll no-secrets tests passed");
process.exit(0);
