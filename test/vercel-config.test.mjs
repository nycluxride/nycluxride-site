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
    .map((r) => r.destination.split("#")[0])
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

test("vercel's transformed routes redirect nothing on /book", () => {
  const { routes } = getTransformedRoutes(config);
  const hits = routes.filter((r) => !r.has && r.status >= 300 && r.status < 400 && new RegExp(r.src).test("/book"));
  assert.deepEqual(hits.map((r) => r.src), []);
});

test("the production alias nycluxride-site.vercel.app sends every path to the same path on www with 301, and no other host is redirected", () => {
  const { routes } = getTransformedRoutes(config);
  const hosted = routes.filter((r) => r.has);
  assert.equal(hosted.length, 1);
  assert.deepEqual(hosted[0].has, [{ type: "host", value: "nycluxride-site.vercel.app" }]);
  assert.equal(hosted[0].status, 301);
  assert.equal(hosted[0].headers.Location, "https://www.nycluxride.com/$1");
  for (const path of ["/", "/book", "/locations/manhattan", "/api/book"]) assert.ok(new RegExp(hosted[0].src).test(path), path);
  assert.equal(config.redirects.at(-1).source, "/:path(.*)");
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

test("vercel's transformed routes send nosniff, SAMEORIGIN framing and the referrer policy on every kind of response", () => {
  const { routes } = getTransformedRoutes(config);
  for (const path of ["/", "/book", "/booking-confirmed", "/rates", "/api/book", "/fleet/gmc-denali-300.webp", "/assets/tracking.js"]) {
    const headers = Object.assign({}, ...routes.filter((r) => r.headers && new RegExp(r.src).test(path)).map((r) => r.headers));
    assert.equal(headers["X-Content-Type-Options"], "nosniff", path);
    assert.equal(headers["X-Frame-Options"], "SAMEORIGIN", path);
    assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin", path);
  }
});

const policiesFor = (path) =>
  getTransformedRoutes(config)
    .routes.filter((r) => r.headers && "Content-Security-Policy" in r.headers && new RegExp(r.src).test(path))
    .map((r) => r.headers["Content-Security-Policy"]);

const SEARCH_PAGES = ["/services", "/chauffeur-service-nyc", "/limousine-service-nyc", "/black-car-service-brooklyn", ...["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"].map((a) => `/locations/${a}`)];
const PAYMENT_PAGES = ["/", "/book", "/booking-confirmed", "/locations/jfk-airport", "/locations/laguardia-airport", ...SEARCH_PAGES];
const PAYMENT_FILES = ["index.html", "book.html", "booking-confirmed.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", ...SEARCH_PAGES.map((p) => `${p.slice(1)}.html`)];

test("vercel's transformed routes send one identical Content-Security-Policy on the 19 payment pages and none elsewhere", () => {
  const book = policiesFor("/book");
  assert.equal(book.length, 1);
  assert.equal(PAYMENT_PAGES.length, 19);
  for (const path of PAYMENT_PAGES) assert.deepEqual(policiesFor(path), book, path);
  const paths = ["/rates", "/faq", "/about", "/blog", "/services/x", "/locations/manhattan/x", "/locations", "/locations/jfk-airport/x", "/locations/jfk-airports", "/booking", "/book/x", "/books", "/api/book", "/api/places", "/booking-confirmed-old", "/index", "/fleet"];
  for (const path of paths) assert.deepEqual(policiesFor(path), [], path);
});

test("the 19 payment pages use one header rule each with the same policy text in vercel.json", () => {
  const rules = (config.headers || []).filter((h) => h.headers.some((x) => x.key === "Content-Security-Policy"));
  assert.deepEqual(rules.map((r) => r.source).sort(), [...PAYMENT_PAGES].sort());
  const values = new Set(rules.map((r) => r.headers.find((x) => x.key === "Content-Security-Policy").value));
  assert.equal(values.size, 1);
  for (const rule of rules) assert.equal(rule.headers.length, 1, rule.source);
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

test("the policy needs no new origin: no img-src, connect-src or default-src, so the signed map image and same-origin fetches load", () => {
  const [policy] = policiesFor("/");
  for (const directive of ["img-src", "connect-src", "default-src", "frame-src"]) assert.ok(!policy.includes(directive), directive);
  assert.ok(!policy.includes("unsafe-eval") && !policy.includes("unsafe-inline"));
});

test("the 19 payment pages hold no inline script and no inline event handler", () => {
  for (const file of PAYMENT_FILES) {
    const html = readFileSync(join(ROOT, file), "utf8");
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs) && body.trim());
    assert.deepEqual(inline.map(([tag]) => tag.slice(0, 60)), [], file);
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=|javascript:/i, file);
  }
});

const REDIRECTS = {
  "/pricing": "/rates", "/prices": "/rates", "/booking": "/book", "/book-now": "/book", "/reserve": "/book", "/reservations": "/book", "/quote": "/book",
  "/contact-us": "/contact", "/about-us": "/about", "/airport-transfers": "/services#airport-transfers", "/jfk": "/locations/jfk-airport", "/lga": "/locations/laguardia-airport", "/newark": "/rates#ewr",
};

test("the 13 short paths redirect with 301 to their pages, and every fragment they name exists on its page", () => {
  for (const [from, to] of Object.entries(REDIRECTS)) {
    const rule = (config.redirects || []).find((r) => r.source === from);
    assert.ok(rule, `no redirect for ${from}`);
    assert.deepEqual([rule.destination, rule.statusCode], [to, 301], from);
    const [page, frag] = to.split("#");
    if (frag) assert.ok(readFileSync(join(ROOT, `${page.slice(1)}.html`), "utf8").includes(` id="${frag}"`), `${to}: no id ${frag}`);
  }
  for (const file of ["pricing", "prices", "booking", "book-now", "reserve", "reservations", "quote", "contact-us", "about-us", "airport-transfers", "jfk", "lga", "newark"]) {
    assert.equal(existsSync(join(ROOT, `${file}.html`)), false, `${file}.html exists, so a redirect would hide a page`);
  }
});

test("vercel's transformed routes send 301 for the short paths and nothing for the pages they point at", () => {
  const { routes } = getTransformedRoutes(config);
  const hit = (path) => routes.filter((r) => !r.has && r.status >= 300 && r.status < 400 && new RegExp(r.src).test(path));
  for (const from of Object.keys(REDIRECTS)) assert.deepEqual(hit(from).map((r) => r.status), [301], from);
  for (const path of ["/rates", "/book", "/contact", "/about", "/services", "/locations/jfk-airport", "/locations/laguardia-airport", "/pricing-old", "/jfk-airport"]) assert.deepEqual(hit(path), [], path);
});

test("the Speculation-Rules header points every page at /assets/speculation.json, and the rules file is served as speculation rules for an hour", () => {
  const rule = (config.headers || []).find((h) => h.headers.some((x) => x.key === "Speculation-Rules"));
  assert.ok(rule, "no Speculation-Rules header rule");
  assert.equal(rule.source, "/((?!api/|assets/|fleet/).*)");
  assert.deepEqual(rule.headers, [{ key: "Speculation-Rules", value: '"/assets/speculation.json"' }]);
  const file = (config.headers || []).find((h) => h.source === "/assets/speculation.json");
  assert.ok(file, "no header rule for /assets/speculation.json");
  assert.deepEqual(file.headers, [{ key: "Content-Type", value: "application/speculationrules+json" }, { key: "Cache-Control", value: "public, max-age=3600" }]);
  const { routes } = getTransformedRoutes(config);
  const sends = (path) => routes.filter((r) => r.headers && "Speculation-Rules" in r.headers && new RegExp(r.src).test(path)).length;
  for (const path of ["/", "/book", "/rates", "/locations/manhattan", "/blog/jfk-lga-ewr-airport-transfer-guide-april-17"]) assert.equal(sends(path), 1, path);
  for (const path of ["/api/book", "/assets/lux.css", "/fleet/gmc-denali-300.webp"]) assert.equal(sends(path), 0, path);
});

test("assets/speculation.json prefetches same-site documents only, never prerenders, and skips the API, the confirmation page and new-tab or download links", () => {
  const rules = JSON.parse(readFileSync(join(ROOT, "assets/speculation.json"), "utf8"));
  assert.deepEqual(Object.keys(rules), ["prefetch"]);
  assert.deepEqual(rules, {"prefetch":[{"source":"document","where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/api/*"}},{"not":{"href_matches":"/booking-confirmed*"}},{"not":{"selector_matches":"[target=_blank],[download],[rel~=nofollow]"}}]},"eagerness":"moderate"}]});
});

test("there is no root package.json", () => {
  assert.equal(existsSync(join(ROOT, "package.json")), false);
});

test(".vercelignore does not exclude api/", () => {
  const lines = readFileSync(join(ROOT, ".vercelignore"), "utf8").split("\n").map((l) => l.trim());
  assert.deepEqual(lines.filter((l) => /^\/?api(\/.*)?$/.test(l)), []);
});

test("the files in api/ without a leading underscore are exactly book, flight, places and route", () => {
  assert.deepEqual(readdirSync(join(ROOT, "api")).filter((f) => !f.startsWith("_")).sort(), ["book.mjs", "flight.mjs", "places.mjs", "route.mjs"]);
});

test("every api route answers no-store through the /api rule", () => {
  for (const path of ["/api/book", "/api/places", "/api/route", "/api/flight"]) {
    const values = (config.headers || []).filter((h) => pathToRegexp(h.source).test(path)).flatMap((h) => h.headers.filter((x) => x.key === "Cache-Control").map((x) => x.value));
    assert.deepEqual(values, ["no-store"], path);
  }
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll vercel config tests passed");
process.exit(0);
