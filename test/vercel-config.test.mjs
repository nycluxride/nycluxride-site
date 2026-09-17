import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { getTransformedRoutes } from "@vercel/routing-utils";
import { pathToRegexp } from "path-to-regexp";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

const HASHED = /\.[A-Za-z0-9_-]{6,}\.(?:js|css|webp|webmanifest)$/;

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

test("vercel.json is accepted by vercel's route transformer", () => {
  const { error } = getTransformedRoutes(config);
  assert.equal(error, null, error && error.message);
});

test("every header source compiles under path-to-regexp", () => {
  for (const header of config.headers || []) pathToRegexp(header.source);
});

test("every redirect source compiles under path-to-regexp", () => {
  for (const redirect of config.redirects || []) pathToRegexp(redirect.source);
});

const cacheRule = (config.headers || []).find((h) =>
  h.headers.some((x) => x.key === "Cache-Control" && x.value.includes("immutable"))
);

test("an immutable cache rule exists", () => {
  assert.ok(cacheRule);
});

if (cacheRule) {
  const re = pathToRegexp(cacheRule.source);
  const files = readdirSync(join(ROOT, "assets")).filter((f) => !f.startsWith("."));
  const hashed = files.filter((f) => HASHED.test(f));
  const unhashed = files.filter((f) => !HASHED.test(f) && f.includes("."));

  test(`content-hashed assets are cached immutably (${hashed.length} files)`, () => {
    assert.ok(hashed.length >= 5, `expected at least 5 hashed assets, found ${hashed.length}`);
    const missed = hashed.filter((f) => !re.test(`/assets/${f}`));
    assert.deepEqual(missed, []);
  });

  test(`hand-maintained assets are never cached immutably (${unhashed.length} files)`, () => {
    const frozen = unhashed.filter((f) => re.test(`/assets/${f}`));
    assert.deepEqual(frozen, []);
  });
}

test("cleanUrls and trailingSlash are unchanged", () => {
  assert.equal(config.cleanUrls, true);
  assert.equal(config.trailingSlash, false);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll vercel config tests passed");
process.exit(0);
