import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const BUNDLE = readFileSync(join(ROOT, "assets/app.6xvjthKL.js"), "utf8");

function collectHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectHtml(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

function routeOf(file) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (rel === "index.html") return "/";
  return "/" + rel.replace(/\.html$/, "");
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function unquote(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s.replace(/\\(.)/g, "$1");
  }
}

const LDJSON = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

const SLUG_SUFFIXES = [...BUNDLE.matchAll(/slugSuffix:"([^"]*)"/g)].map((m) => m[1]);

const BLOG_POSTS = [...BUNDLE.matchAll(/\{slug:"([a-z0-9-]+)",metaTitle:"((?:[^"\\]|\\.)*)",metaDescription:"((?:[^"\\]|\\.)*)"/g)].map(
  (m, i) => ({
    authoredSlug: m[1],
    effectiveSlug: `${m[1]}-${SLUG_SUFFIXES[i]}`,
    metaTitle: unquote(m[2]),
    metaDescription: unquote(m[3]),
  })
);

function bundleMeta(route) {
  const at = BUNDLE.indexOf(`${JSON.stringify(route)}:{title:"`);
  if (at !== -1) {
    const slice = BUNDLE.slice(at, at + 2000);
    const title = slice.match(/title:"((?:[^"\\]|\\.)*)"/);
    const desc = slice.match(/description:"((?:[^"\\]|\\.)*)"/);
    return { title: unquote(title[1]), description: unquote(desc[1]) };
  }

  const blog = route.match(/^\/blog\/(.+)$/);
  if (blog) {
    const post = BLOG_POSTS.find((p) => p.effectiveSlug === blog[1]);
    return post ? { title: post.metaTitle, description: post.metaDescription } : null;
  }

  const loc = route.match(/^\/locations\/(.+)$/);
  if (loc) {
    const at3 = BUNDLE.indexOf(`{slug:"${loc[1]}",metaDescription:"`);
    if (at3 === -1) return null;
    const slice = BUNDLE.slice(at3, at3 + 2000);
    return {
      title: `${unquote(slice.match(/name:"((?:[^"\\]|\\.)*)"/)[1])} Chauffeur Service | NYC LUX RIDE`,
      description: unquote(slice.match(/metaDescription:"((?:[^"\\]|\\.)*)"/)[1]),
    };
  }

  return null;
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

const ROUTELESS = new Set(["/card-authorization"]);

const files = collectHtml(ROOT);

test(`36 html pages discovered (found ${files.length})`, () => {
  assert.equal(files.length, 36);
});

for (const file of files) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, "utf8");
  const route = routeOf(file);
  const meta = bundleMeta(route);

  if (!ROUTELESS.has(route)) {
    test(`${rel}: route ${route} is resolvable in the bundle`, () => {
      assert.ok(meta, `no bundle metadata found for ${route}`);
    });
  }

  test(`${rel}: title, og:title and twitter:title agree`, () => {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const og = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/);
    const tw = html.match(/<meta[^>]*name="twitter:title"[^>]*content="([^"]*)"/);
    assert.ok(t && og && tw, "missing one of the title trio");
    assert.equal(decode(og[1]), decode(t[1]));
    assert.equal(decode(tw[1]), decode(t[1]));
    assert.ok(decode(t[1]).length > 0);
  });

  test(`${rel}: description, og:description and twitter:description agree`, () => {
    const d = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    const og = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/);
    const tw = html.match(/<meta[^>]*name="twitter:description"[^>]*content="([^"]*)"/);
    assert.ok(d && og && tw, "missing one of the description trio");
    assert.equal(decode(og[1]), decode(d[1]));
    assert.equal(decode(tw[1]), decode(d[1]));
    assert.ok(decode(d[1]).length > 0);
  });

  if (!meta) continue;

  test(`${rel}: static <title> matches the bundle route table`, () => {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    assert.ok(m, "no <title> in static html");
    assert.equal(decode(m[1]), meta.title);
  });

  test(`${rel}: static meta description matches the bundle route table`, () => {
    const m = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    assert.ok(m, "no meta description in static html");
    assert.equal(decode(m[1]), meta.description);
  });
}

const CORRUPT = ["Nyc Limo", "Book nyc limo with", "NYC Lux Ride", "How much does chauffeur cost in New York"];
for (const bad of CORRUPT) {
  test(`no page or bundle contains the broken string ${JSON.stringify(bad)}`, () => {
    const hits = files.filter((f) => readFileSync(f, "utf8").includes(bad)).map((f) => relative(ROOT, f));
    if (BUNDLE.includes(bad)) hits.push("assets/app.6xvjthKL.js");
    assert.deepEqual(hits, []);
  });
}

test("the bundle is syntactically valid javascript", () => {
  const tmp = join(tmpdir(), "nlr-bundle-check.mjs");
  writeFileSync(tmp, BUNDLE);
  execFileSync(process.execPath, ["--check", tmp]);
});

test("effective runtime blog slugs match the files on disk", () => {
  assert.equal(BLOG_POSTS.length, 11, "expected 11 blog data objects in the bundle");
  assert.equal(SLUG_SUFFIXES.length, 11, "expected 11 slugSuffix values in the bundle");
  const onDisk = readdirSync(join(ROOT, "blog")).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
  assert.deepEqual(BLOG_POSTS.map((p) => p.effectiveSlug).sort(), onDisk.sort());
});

test("no page declares aggregateRating", () => {
  const hits = files.filter((f) => readFileSync(f, "utf8").includes("aggregateRating")).map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test("every page carries the shared schema graph and the service-areas nav", () => {
  const missingGraph = files.filter((f) => !readFileSync(f, "utf8").includes("#organization")).map((f) => relative(ROOT, f));
  const missingNav = files.filter((f) => !readFileSync(f, "utf8").includes('id="nlr-service-areas"')).map((f) => relative(ROOT, f));
  assert.deepEqual(missingGraph, [], "pages missing the schema graph");
  assert.deepEqual(missingNav, [], "pages missing the service-areas nav");
});

test("every json-ld block on every page parses, whatever its attribute order", () => {
  const bad = [];
  let blocks = 0;
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(LDJSON)) {
      blocks++;
      try {
        JSON.parse(m[1]);
      } catch (err) {
        bad.push(`${relative(ROOT, file)}: ${err.message}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(blocks >= 81, `expected at least 81 json-ld blocks, found ${blocks}`);
});

test("no page loads a synchronous first-party script in head", () => {
  const bad = [];
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script src="\/assets\/[^"]+"><\/script>/g)) {
      bad.push(`${relative(ROOT, file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("no page references the removed cloudflare challenge script", () => {
  const hits = files.filter((f) => readFileSync(f, "utf8").includes("__CF$cv$params")).map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll hydration parity tests passed");
process.exit(0);
