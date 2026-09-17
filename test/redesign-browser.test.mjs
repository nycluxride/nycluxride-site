import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");

const PAGES = [
  "/",
  "/services",
  "/fleet",
  "/locations",
  "/locations/manhattan",
  "/about",
  "/contact",
  "/faq",
  "/blog",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/";
  const candidates = clean === "/" ? ["index.html"] : [`${clean.slice(1)}.html`, clean.slice(1)];
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

const SPRITE_HIDER = "position:absolute;inline-size:0;block-size:0;overflow:hidden";

const EMOJI = /[←-⇿⌀-➿⬀-⯿️\u{1F300}-\u{1FAFF}]/u;

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

for (const route of PAGES) {
  if (!resolvePath(route)) {
    failures++;
    console.error(`  FAIL ${route}: page does not exist`);
    continue;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/googletagmanager|google-analytics|net::ERR/.test(m.text())) errors.push(m.text());
  });
  const failed = [];
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(base)) return;
    failed.push(`${r.url()} ${r.failure()?.errorText}`);
  });

  await page.goto(`${base}${route}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const s = await page.evaluate(() => {
    const styleOf = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    return {
      h1s: [...document.querySelectorAll("h1")].map((n) => n.textContent.trim()),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => n.textContent),
      archivoLoaded: document.fonts.check('600 24px "Archivo"'),
      serifLoaded: document.fonts.check('400 18px "Source Serif 4"'),
      loadedFaces: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      bodyFont: styleOf("body", "fontFamily"),
      h1Font: styleOf("h1", "fontFamily"),
      bg: styleOf("body", "backgroundColor"),
      text: document.body.innerText,
      imgs: [...document.querySelectorAll("img")].map((n) => ({
        w: n.getAttribute("width"),
        h: n.getAttribute("height"),
        alt: n.getAttribute("alt"),
        loading: n.getAttribute("loading"),
        broken: n.complete && n.naturalWidth === 0,
        src: n.getAttribute("src"),
      })),
      useRefs: [...document.querySelectorAll("use")].map((n) => n.getAttribute("href") || ""),
      symbols: document.querySelectorAll("symbol").length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      inlineStyles: [...document.querySelectorAll("[style]")].map((n) => n.getAttribute("style")),
      sceneP: document.querySelectorAll(".plate--scene").length,
      grade: document.querySelectorAll("#lux-grade").length,
    };
  });

  check(`${route}: no page or console errors`, () => assert.deepEqual(errors, []));
  check(`${route}: no failed first-party requests`, () => assert.deepEqual(failed, []));
  check(`${route}: exactly one non-empty h1`, () => {
    assert.equal(s.h1s.length, 1, JSON.stringify(s.h1s));
    assert.ok(s.h1s[0].length > 0);
  });
  check(`${route}: Archivo actually renders`, () => {
    assert.ok(s.archivoLoaded, "document.fonts.check failed for Archivo");
    assert.match(s.h1Font, /Archivo/);
  });
  check(`${route}: Source Serif 4 actually renders`, () => {
    assert.ok(s.serifLoaded, "document.fonts.check failed for Source Serif 4");
  });
  check(`${route}: every json-ld block parses`, () => {
    assert.ok(s.ld.length > 0, "no json-ld");
    for (const b of s.ld) JSON.parse(b);
  });
  check(`${route}: no schema declares aggregateRating or LimousineService`, () => {
    const all = s.ld.join(" ");
    assert.ok(!all.includes("aggregateRating"), "aggregateRating present");
    assert.ok(!all.includes("LimousineService"), "LimousineService is not a real schema.org type");
  });
  check(`${route}: no emoji or dingbat in rendered text`, () => {
    const m = s.text.match(EMOJI);
    assert.equal(m, null, m && `found ${JSON.stringify(m[0])}`);
  });
  check(`${route}: icon sprite is inline, not cross-document`, () => {
    assert.ok(s.symbols > 0, "no inline <symbol> found");
    const external = s.useRefs.filter((h) => !h.startsWith("#"));
    assert.deepEqual(external, []);
  });
  check(`${route}: every image has width, height, alt, and is not broken`, () => {
    const bad = s.imgs.filter((i) => !i.w || !i.h || !i.alt || i.broken);
    assert.deepEqual(bad, []);
  });
  check(`${route}: at most one eager image`, () => {
    const eager = s.imgs.filter((i) => i.loading === "eager");
    assert.ok(eager.length <= 1, `${eager.length} eager images`);
  });
  check(`${route}: no hotlinked stock imagery`, () => {
    const hot = s.imgs.map((i) => i.src || "").filter((u) => /unsplash|pexels/.test(u));
    assert.deepEqual(hot, []);
  });
  const inlineLayout = s.inlineStyles
    .filter((v) => v !== SPRITE_HIDER)
    .filter((v) => /display|position|width|margin|padding|flex|grid|top|left/i.test(v));
  check(`${route}: no inline layout styles`, () => assert.deepEqual(inlineLayout, []));
  check(`${route}: plate--scene is not used without the #lux-grade filter`, () => {
    if (s.sceneP > 0) assert.ok(s.grade > 0, "plate--scene present but #lux-grade filter missing");
  });
  check(`${route}: page background is the token surface, not pure black`, () => {
    assert.equal(s.bg, "rgb(8, 9, 12)");
  });
  check(`${route}: no horizontal overflow at 1280px`, () => {
    assert.ok(s.scrollW <= s.clientW + 1, `overflows by ${s.scrollW - s.clientW}px`);
  });

  for (const w of [1200, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    const clipped = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (!/auto|hidden|paint|clip/.test(`${cs.contentVisibility} ${cs.contain} ${cs.overflowX} ${cs.overflow}`)) continue;
        const pr = el.getBoundingClientRect();
        for (const d of el.querySelectorAll("*")) {
          const dr = d.getBoundingClientRect();
          if (dr.width > 0 && dr.right > pr.right + 2) {
            out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").split(" ")[0]} clips ${(d.getAttribute("class") || d.tagName).slice(0, 24)} by ${Math.round(dr.right - pr.right)}px`);
          }
        }
      }
      return [...new Set(out)].slice(0, 4);
    });
    check(`${route}: nothing is silently clipped by paint containment at ${w}px`, () => {
      assert.deepEqual(clipped, []);
    });
  }

  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(120);
    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    check(`${route}: no horizontal overflow at ${w}px`, () => {
      assert.ok(o.scrollW <= o.clientW + 1, `overflows by ${o.scrollW - o.clientW}px`);
    });
  }

  await page.close();
}

const nojs = await browser.newContext({ javaScriptEnabled: false });

for (const route of ["/faq", "/fleet", "/"]) {
  if (!resolvePath(route)) continue;
  const p = await nojs.newPage();
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  const r = await p.evaluate(() => ({
    links: document.querySelectorAll("a[href]").length,
    details: document.querySelectorAll("details").length,
    text: document.body.innerText.length,
    fleetSets: document.querySelectorAll(".fleet-set").length,
  }));
  check(`${route}: usable with javascript disabled (${r.links} links, ${r.text} chars)`, () => {
    assert.ok(r.links >= 15, `only ${r.links} links`);
    assert.ok(r.text > 800, `only ${r.text} chars of text`);
  });
  if (route === "/faq") {
    check(`/faq: 19 native details elements render without javascript`, () => {
      assert.equal(r.details, 19);
    });
    const answers = await p.evaluate(() => document.body.textContent);
    check(`/faq: answers are in the static html, not javascript`, () => {
      assert.match(answers, /24 hours in advance/);
    });
  }
  if (route === "/fleet") {
    check(`/fleet: tier sets render without javascript`, () => assert.ok(r.fleetSets >= 4, `${r.fleetSets} sets`));
  }
  await p.close();
}
await nojs.close();

const kb = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await kb.goto(`${base}/`, { waitUntil: "load" });
await kb.keyboard.press("Tab");
const firstFocus = await kb.evaluate(() => {
  const a = document.activeElement;
  const cs = getComputedStyle(a);
  return { cls: a.className, text: a.textContent.trim().slice(0, 30), outline: cs.outlineWidth, offset: cs.outlineOffset };
});
check(`keyboard: first tab stop is the skip link`, () => assert.match(firstFocus.cls, /skip/));
check(`keyboard: focus ring is visible with a positive offset`, () => {
  assert.notEqual(firstFocus.outline, "0px");
  assert.ok(parseFloat(firstFocus.offset) >= 2, `offset ${firstFocus.offset}`);
});
await kb.close();

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} redesign assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll redesign browser tests passed");
process.exit(0);
