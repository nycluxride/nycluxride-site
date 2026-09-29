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
      await ctx.close();
      const at = `${engine} ${width}px${spaced ? " with the WCAG 1.4.12 text spacing" : ""}`;
      await check(`${at}: each of the ${Object.keys(CLASSES).length} class cards shows "Up to" before its seat count`, () => assert.deepEqual(cards.map((c) => c.upTo && c.upTo[0]), Object.keys(CLASSES).map(() => "Up to")));
      await check(`${at}: "Up to" sits on one line in every class card`, () => assert.deepEqual(cards.filter((c) => c.upTo && c.upTo[1] !== 1).map((c) => [c.id, c.upTo[1]]), []));
      await check(`${at}: no text in the class cards runs past the card edge`, () => assert.deepEqual(cards.filter((c) => c.cut.length).map((c) => [c.id, ...c.cut]), []));
    }
  }
}

const chrome = await chromium.launch();
await sweep("chromium", chrome);
await chrome.close();
for (const [engine, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (!b) {
    console.log(`  ..   ${engine} is not installed here, its class card sweep is skipped`);
    continue;
  }
  await sweep(engine, b);
  await b.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} pages-core browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pages-core browser tests passed");
process.exit(0);
