import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/";
  const candidates =
    clean === "/" ? ["index.html"] : [`${clean.slice(1)}.html`, clean.slice(1), join(clean.slice(1), "index.html")];
  for (const c of candidates) {
    const full = join(ROOT, c);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const file = resolvePath(req.url);
      if (!file) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end("<!doctype html><title>404</title>Not Found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function collectHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectHtml(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

const routeOf = (file) => {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  return rel === "index.html" ? "/" : `/${rel.replace(/\.html$/, "")}`;
};

const KNOWN_HYDRATION_FAILURES = new Set(["/", "/services"]);

const IGNORED_CONSOLE = [/favicon/i, /Failed to load resource/i, /net::ERR_/i, /googletagmanager/i, /moovs/i, /pexels|unsplash/i];

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

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const files = collectHtml(ROOT);

for (const file of files) {
  const rel = relative(ROOT, file);
  const route = routeOf(file);
  const staticHtml = readFileSync(file, "utf8");
  const staticTitle = staticHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/)[1];
  const staticLd = [...staticHtml.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].length;

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORED_CONSOLE.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${base}${route}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => ({
    title: document.title,
    h1s: [...document.querySelectorAll("h1")].map((n) => n.textContent.trim()),
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => n.textContent),
    nav: document.querySelectorAll("#nlr-service-areas a").length,
    bodyText: document.body.innerText,
    scrollW: document.documentElement.scrollWidth,
  }));

  check(`${rel}: no new hydration failures beyond the documented baseline`, () => {
    const unexpected = KNOWN_HYDRATION_FAILURES.has(route) ? errors.filter((e) => !/React error #418/.test(e)) : errors;
    assert.deepEqual(unexpected, []);
  });

  check(`${rel}: hydration does not overwrite the title`, () => {
    assert.equal(after.title, staticTitle.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  });

  check(`${rel}: exactly one non-empty h1 survives hydration`, () => {
    assert.equal(after.h1s.length, 1, `found ${after.h1s.length}: ${JSON.stringify(after.h1s)}`);
    assert.ok(after.h1s[0].length > 0);
  });

  check(`${rel}: json-ld survives hydration and still parses (static had ${staticLd})`, () => {
    assert.ok(after.ld.length > 0, "all json-ld was removed by hydration");
    for (const block of after.ld) JSON.parse(block);
  });

  check(`${rel}: the service-areas nav survives hydration with 15 links`, () => {
    assert.equal(after.nav, 15);
  });

  check(`${rel}: page does not render a not-found state`, () => {
    assert.ok(!/Post Not Found|Article could not be found|Blog Post Not Found/i.test(after.bodyText), after.bodyText.slice(0, 120));
  });

  if (route.startsWith("/blog/")) {
    check(`${rel}: article body is present after hydration`, () => {
      assert.ok(after.bodyText.length > 1500, `body is only ${after.bodyText.length} chars`);
    });
  }

  if (route === "/services") {
    check(`${rel}: published rates are visible after hydration`, () => {
      assert.match(after.bodyText, /165/);
      assert.match(after.bodyText, /130/);
    });
  }

  if (route === "/faq") {
    const buttons = await page.$$("[aria-expanded]");
    if (buttons.length) await buttons[0].click();
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => document.body.innerText);
    check(`${rel}: an faq answer becomes readable when its question is opened`, () => {
      assert.equal(buttons.length, 19, `expected 19 accordion controls, found ${buttons.length}`);
      assert.match(opened, /24 hours in advance/);
    });
  }

  await page.close();
}

const mobile = await browser.newPage({ viewport: { width: 360, height: 640 } });
await mobile.goto(`${base}/`, { waitUntil: "load" });
await mobile.waitForTimeout(1200);
const m = await mobile.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  navH: document.querySelector("#nlr-service-areas")?.getBoundingClientRect().height ?? 0,
}));
check(`360px viewport: no horizontal overflow (scrollWidth ${m.scrollW} vs ${m.clientW})`, () => {
  assert.ok(m.scrollW <= m.clientW + 1, `overflows by ${m.scrollW - m.clientW}px`);
});
check(`360px viewport: service-areas nav height is reasonable (${Math.round(m.navH)}px)`, () => {
  assert.ok(m.navH > 0, "nav not rendered");
  assert.ok(m.navH < 620, `nav is ${Math.round(m.navH)}px tall`);
});
await mobile.close();

const notFound = await browser.newPage();
const resp = await notFound.goto(`${base}/definitely-not-a-real-page`, { waitUntil: "load" });
check("unknown paths return 404", () => {
  assert.equal(resp.status(), 404);
});
await notFound.close();

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll browser hydration tests passed");
process.exit(0);
