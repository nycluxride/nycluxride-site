import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";
import { CLASSES } from "../api/_rates.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const SPACING = "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-bottom:2em !important}";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 10).join("\n       ")}`);
  }
}

function resolvePath(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
  for (const c of clean === "/" ? ["index.html"] : [`${clean.slice(1)}.html`, clean.slice(1)]) {
    const full = join(ROOT, c);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}
const server = createServer((req, res) => {
  const file = resolvePath(req.url);
  if (!file) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(ROOT, "404.html")));
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const CARDS = () => {
  const range = document.createRange();
  const lines = (rects) => [...rects].filter((q) => q.width > 0.5).map((q) => (q.top + q.bottom) / 2).sort((a, b) => a - b).filter((y, i, a) => !i || y - a[i - 1] > 6).length;
  return [...document.querySelectorAll("main .slide")].map((card) => {
    const r = card.getBoundingClientRect(), cs = getComputedStyle(card);
    const left = r.left + parseFloat(cs.borderLeftWidth), right = r.right - parseFloat(cs.borderRightWidth);
    const cut = [];
    const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.data.trim()) continue;
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 0.5 && (q.right > right + 0.5 || q.left < left - 0.5)) cut.push(`"${n.data.trim()}" by ${Math.max(q.right - right, left - q.left).toFixed(1)}px`);
    }
    const up = card.querySelector(".chips .nowrap")?.previousSibling;
    if (!up || up.nodeType !== Node.TEXT_NODE) return { id: card.id, cut, upTo: null };
    range.selectNodeContents(up);
    return { id: card.id, cut, upTo: [up.data.trim(), lines(range.getClientRects())] };
  });
};

const TABLES = ["/rates", "/fleet", "/locations/jfk-airport", "/locations/laguardia-airport", "/black-car-service-brooklyn"];
async function sweep(engine, browser) {
  for (const width of [320, 360, 600]) {
    for (const spaced of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, reducedMotion: "reduce", ...(width < 600 && engine !== "firefox" ? { isMobile: true, hasTouch: true } : {}) });
      await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
      const p = await ctx.newPage();
      await p.goto(base + "/", { waitUntil: "load" });
      if (spaced) await p.addStyleTag({ content: SPACING });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const cards = await p.evaluate(CARDS);
      const wide = [];
      for (const path of TABLES) {
        await p.goto(base + path, { waitUntil: "load" });
        if (spaced) await p.addStyleTag({ content: SPACING });
        await p.evaluate(() => document.fonts.ready);
        const [over, bar] = await p.evaluate(() => [document.documentElement.scrollWidth - document.documentElement.clientWidth, Math.round(document.querySelector(".actionbar").getBoundingClientRect().width)]);
        if (over > 0 || bar > width) wide.push(`${path}: the page scrolls ${over}px sideways and the action bar is ${bar}px wide`);
      }
      await ctx.close();
      const at = `${engine} ${width}px${spaced ? " with the WCAG 1.4.12 text spacing" : ""}`;
      await check(`${at}: each of the ${Object.keys(CLASSES).length} class cards shows "Up to" before its seat count`, () => assert.deepEqual(cards.map((c) => c.upTo && c.upTo[0]), Object.keys(CLASSES).map(() => "Up to")));
      await check(`${at}: "Up to" sits on one line in every class card`, () => assert.deepEqual(cards.filter((c) => c.upTo && c.upTo[1] !== 1).map((c) => [c.id, c.upTo[1]]), []));
      await check(`${at}: no text in the class cards runs past the card edge`, () => assert.deepEqual(cards.filter((c) => c.cut.length).map((c) => [c.id, ...c.cut]), []));
      await check(`${at}: the rate tables scroll inside their frames, so ${TABLES.join(", ")} never scroll sideways and the action bar keeps the window width`, () => assert.deepEqual(wide, []));
    }
  }
}

const MAP = () => {
  const svg = document.querySelector(".citymap svg");
  const pin = svg && svg.querySelector("a.cm-pin[aria-current]");
  if (!pin) return null;
  const at = (el, x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(el.getCTM()); return [r.x, r.y]; };
  const glyphs = (t) => [...Array(t.getNumberOfChars()).keys()].filter((i) => t.textContent[i].trim()).map((i) => { const b = t.getExtentOfChar(i); return [at(t, b.x, b.y), at(t, b.x + b.width, b.y), at(t, b.x + b.width, b.y + b.height), at(t, b.x, b.y + b.height)]; });
  const axes = (q) => q.map((a, i) => { const b = q[(i + 1) % 4]; return [a[1] - b[1], b[0] - a[0]]; });
  const span = (q, u) => { const v = q.map((a) => a[0] * u[0] + a[1] * u[1]); return [Math.min(...v), Math.max(...v)]; };
  const meet = (p, q) => [...axes(p), ...axes(q)].every((u) => { const [a, b] = span(p, u), [c, d] = span(q, u); return Math.min(b, d) > Math.max(a, c); });
  const inside = (q, [x, y]) => { const s = q.map((a, i) => { const b = q[(i + 1) % 4]; return Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])); }); return s.every((v) => v >= 0) || s.every((v) => v <= 0); };
  const near = (q, [x, y], r) => inside(q, [x, y]) || q.some((a, i) => { const b = q[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) < r; });
  const c = pin.querySelector("circle"), cx = c.cx.baseVal.value, cy = c.cy.baseVal.value, ctr = at(c, cx, cy), rim = at(c, cx + c.r.baseVal.value + parseFloat(getComputedStyle(c).strokeWidth) / 2, cy), r = Math.hypot(rim[0] - ctr[0], rim[1] - ctr[1]);
  const man = [...svg.querySelectorAll("text")].find((t) => t.textContent.trim() === "Manhattan"), label = pin.querySelector("text");
  const gm = glyphs(man), gl = glyphs(label);
  return [gm.some((a) => gl.some((b) => meet(a, b))), gm.some((a) => near(a, ctr, r)), gl.some((a) => near(a, ctr, r))];
};
const AREA_MAPS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "soho", "financial-district", "upper-east-side", "upper-west-side", "long-island-city", "jfk-airport", "laguardia-airport"];
async function maps(engine, browser) {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const bad = [];
    for (const slug of AREA_MAPS) {
      const p = await ctx.newPage();
      await p.goto(`${base}/locations/${slug}`, { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      const m = await p.evaluate(MAP);
      if (m && m.some(Boolean)) bad.push(`${slug}: ${["Manhattan touches the area name", "Manhattan runs into the pin", "the area name runs into the pin"].filter((_, i) => m[i]).join(", ")}`);
      await p.close();
    }
    await ctx.close();
    await check(`${engine} ${width}px: on every area map the borough name Manhattan, the page's own pin and its label keep clear of one another`, () => assert.deepEqual(bad, []));
  }
}

const MAP_PAGES = ["/locations", "/contact", "/locations/manhattan"];
async function mapFocus(engine, browser) {
  for (const [width, height] of [[640, 400], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const p = await ctx.newPage();
    const hidden = [];
    for (const path of MAP_PAGES) {
      await p.goto(base + path, { waitUntil: "load" });
      const n = await p.evaluate(() => {
        const links = [...document.querySelectorAll(".citymap svg a[href]")];
        const before = [...document.querySelectorAll("a[href],button,input,select,textarea,summary,[tabindex]")].filter((e) => e.tabIndex >= 0 && e.compareDocumentPosition(links[0]) & Node.DOCUMENT_POSITION_FOLLOWING);
        before.reverse().find((e) => (e.focus({ preventScroll: true }), document.activeElement === e));
        scrollTo(0, 0);
        return links.length;
      });
      for (let i = 0; i < n; i++) {
        await p.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
        const miss = await p.evaluate((i) => new Promise((done) => requestAnimationFrame(() => {
          const a = document.querySelectorAll(".citymap svg a[href]")[i], e = document.activeElement;
          if (a !== e) return done(`Tab ${i + 1} went to ${e.getAttribute("aria-label") || e.textContent.trim().slice(0, 40) || e.tagName}`);
          const r = a.getBoundingClientRect(), bar = document.querySelector(".actionbar"), b = bar.getBoundingClientRect();
          const name = a.getAttribute("aria-label") || a.textContent.trim();
          const under = getComputedStyle(bar).visibility !== "hidden" && b.height > 0 && b.top < innerHeight && r.top >= b.top;
          done(r.top >= innerHeight ? `${name} is below the window` : r.bottom <= 0 ? `${name} is above the window` : under ? `${name} is under the action bar` : null);
        })), i);
        if (miss) hidden.push(`${path}: ${miss}`);
      }
    }
    await ctx.close();
    await check(`${engine} ${width}x${height}: Tab scrolls each city map link on ${MAP_PAGES.join(", ")} into view, clear of the action bar`, () => assert.deepEqual(hidden, []));
  }
}

const chrome = await chromium.launch();
await sweep("chromium", chrome);
await maps("chromium", chrome);
await mapFocus("chromium", chrome);
await chrome.close();
for (const [engine, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (!b) {
    console.log(`  ..   ${engine} is not installed here, its class card sweep is skipped`);
    continue;
  }
  await sweep(engine, b);
  await maps(engine, b);
  await mapFocus(engine, b);
  await b.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} pages-core browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pages-core browser tests passed");
process.exit(0);
