import { readFileSync, readdirSync, existsSync } from "node:fs";
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

test("every literal redirect destination exists", () => {
  const missing = (config.redirects || [])
    .map((r) => r.destination)
    .filter((d) => d.startsWith("/") && !d.includes(":"))
    .filter((d) => !existsSync(join(ROOT, d.slice(1))) && !existsSync(join(ROOT, `${d.slice(1)}.html`)));
  assert.deepEqual(missing, []);
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
    assert.ok(hashed.length >= 2, `expected at least 2 hashed assets, found ${hashed.length}`);
    const missed = hashed.filter((f) => !re.test(`/assets/${f}`));
    assert.deepEqual(missed, []);
  });

  test(`hand-maintained assets are never cached immutably (${unhashed.length} files)`, () => {
    const frozen = unhashed.filter((f) => re.test(`/assets/${f}`));
    assert.deepEqual(frozen, []);
  });
}

function cacheRuleFor(path) {
  return (config.headers || []).find(
    (h) => h.headers.some((x) => x.key === "Cache-Control") && pathToRegexp(h.source).test(path)
  );
}

test("fleet image variants get a long cache lifetime and are never immutable", () => {
  const variants = readdirSync(join(ROOT, "fleet")).filter((f) => /-\d+\.(?:avif|webp)$/.test(f));
  assert.ok(variants.length >= 100, `expected the generated variants, found ${variants.length}`);
  for (const f of variants) {
    const rule = cacheRuleFor(`/fleet/${f}`);
    assert.ok(rule, `/fleet/${f} has no Cache-Control rule`);
    const value = rule.headers.find((x) => x.key === "Cache-Control").value;
    assert.ok(/max-age=(\d+)/.test(value) && Number(RegExp.$1) >= 86400, `${f}: ${value}`);
    assert.ok(!value.includes("immutable"), `${f} is not content-hashed, so it must not be immutable`);
  }
});

test("fonts get a long cache lifetime", () => {
  const fonts = readdirSync(join(ROOT, "assets/fonts")).filter((f) => f.endsWith(".woff2"));
  assert.ok(fonts.length > 0);
  for (const f of fonts) {
    const rule = cacheRuleFor(`/assets/fonts/${f}`);
    assert.ok(rule, `/assets/fonts/${f} has no Cache-Control rule`);
    assert.match(rule.headers.find((x) => x.key === "Cache-Control").value, /max-age=31536000/);
  }
});

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
