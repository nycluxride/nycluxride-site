import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { getTransformedRoutes } from "@vercel/routing-utils";
import { pathToRegexp } from "path-to-regexp";
import { CHECKOUT_ORIGINS } from "../api/_rates.mjs";

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

test("no redirect source is /book", () => {
  const hits = (config.redirects || []).filter((r) => r.source === "/book" || pathToRegexp(r.source).test("/book"));
  assert.deepEqual(hits.map((r) => r.source), []);
});

test("vercel's transformed routes redirect nothing on /book", () => {
  const { routes } = getTransformedRoutes(config);
  const hits = routes.filter((r) => r.status >= 300 && r.status < 400 && new RegExp(r.src).test("/book"));
  assert.deepEqual(hits.map((r) => r.src), []);
});

test("a Cache-Control: no-store header rule matches /api/book", () => {
  const rules = (config.headers || []).filter((h) => pathToRegexp(h.source).test("/api/book"));
  const values = rules.flatMap((h) => h.headers.filter((x) => x.key === "Cache-Control").map((x) => x.value));
  assert.deepEqual(values, ["no-store"]);
});

test("vercel's transformed routes give /api/book only Cache-Control: no-store", () => {
  const { routes } = getTransformedRoutes(config);
  const values = routes
    .filter((r) => r.headers && "Cache-Control" in r.headers && new RegExp(r.src).test("/api/book"))
    .map((r) => r.headers["Cache-Control"]);
  assert.deepEqual(values, ["no-store"]);
});

const policiesFor = (path) =>
  getTransformedRoutes(config)
    .routes.filter((r) => r.headers && "Content-Security-Policy" in r.headers && new RegExp(r.src).test(path))
    .map((r) => r.headers["Content-Security-Policy"]);

test("vercel's transformed routes send one Content-Security-Policy on /book and /booking-confirmed and none elsewhere", () => {
  const book = policiesFor("/book");
  assert.equal(book.length, 1);
  assert.deepEqual(policiesFor("/booking-confirmed"), book);
  for (const path of ["/", "/rates", "/booking", "/book/x", "/books", "/api/book", "/booking-confirmed-old"]) assert.deepEqual(policiesFor(path), [], path);
});

test("the payment pages' policy limits scripts, form targets, framing, the base URL and plugins", () => {
  const [policy] = policiesFor("/book");
  const directives = Object.fromEntries(policy.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(Object.keys(directives).sort(), ["base-uri", "form-action", "frame-ancestors", "object-src", "script-src"]);
  assert.deepEqual(directives["script-src"], ["'self'", "https://www.googletagmanager.com", "https://www.googleadservices.com", "https://www.google.com", "https://googleads.g.doubleclick.net", "https://www.gstatic.com"]);
  assert.deepEqual(directives["form-action"], ["'self'", ...CHECKOUT_ORIGINS]);
  assert.deepEqual(directives["frame-ancestors"], ["'self'"]);
  assert.deepEqual(directives["base-uri"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
});

test("the payment pages hold no inline script and no inline event handler", () => {
  for (const file of ["book.html", "booking-confirmed.html"]) {
    const html = readFileSync(join(ROOT, file), "utf8");
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs) && body.trim());
    assert.deepEqual(inline.map(([tag]) => tag.slice(0, 60)), [], file);
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=|javascript:/i, file);
  }
});

test("there is no root package.json", () => {
  assert.equal(existsSync(join(ROOT, "package.json")), false);
});

test(".vercelignore does not exclude api/", () => {
  const lines = readFileSync(join(ROOT, ".vercelignore"), "utf8").split("\n").map((l) => l.trim());
  assert.deepEqual(lines.filter((l) => /^\/?api(\/.*)?$/.test(l)), []);
});

test("api/book.mjs is the only file in api/ without a leading underscore", () => {
  assert.deepEqual(readdirSync(join(ROOT, "api")).filter((f) => !f.startsWith("_")), ["book.mjs"]);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll vercel config tests passed");
process.exit(0);
