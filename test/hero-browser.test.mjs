import { readFileSync, existsSync, statSync, readdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const CARS = { "home-hero-phone-v3": [0.43, 0.578, 0.02, 0.985], "home-hero-v3": [0.553, 0.926, 0.01, 0.99] };
const PLANES = { "home-hero-phone-v3": [0.64, 0.955, 0.15, 0.22], "home-hero-v3": [0.745, 0.958, 0.2, 0.31] };
const VEIL = { 390: "rgba(251, 248, 242, 0.5)", 1440: "rgba(251, 248, 242, 0.5)" };
const PHONES = [[320, 568], [360, 780], [390, 844], [430, 932]];
const LANDSCAPE = [[568, 320], [667, 375], [844, 390], [932, 430]];
const FADE = 24;
const SIDE_FADE = 4;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

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

const CLS_PROBE = () => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
};

const MEASURE = (cars) => {
  const hero = document.querySelector("main > section.hero");
  const h1 = hero.querySelector(":scope > h1");
  const quiet = h1.querySelector(":scope > .sr-only");
  const range = document.createRange();
  const tops = new Set();
  for (const n of h1.childNodes) {
    if (n === quiet || !n.textContent.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
  }
  const hb = h1.getBoundingClientRect();
  const [tb, sb] = [...hero.querySelectorAll(":scope > .hero__tags")].map((e) => e.getBoundingClientRect());
  const img = hero.querySelector(".hero__photo picture img");
  const head1 = {
    slug: /\/fleet\/([a-z0-9-]+?)-\d+\.(?:avif|webp)$/.exec(img.currentSrc)[1],
    lines: tops.size,
    inside: hb.left >= hero.getBoundingClientRect().left && hb.right <= innerWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    font: parseFloat(getComputedStyle(h1).fontSize),
  };
  if (!cars[head1.slug]) return head1;
  const [ct, cb, cx0, cx1] = cars[head1.slug];
  const ib = img.getBoundingClientRect(), cs = getComputedStyle(img);
  const s = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight), rw = img.naturalWidth * s, rh = img.naturalHeight * s;
  const [px, py] = cs.objectPosition.split(" ");
  const at = (v, free) => (v.endsWith("%") ? (free * parseFloat(v)) / 100 : parseFloat(v));
  const ox = ib.left + at(px, ib.width - rw), oy = ib.top + at(py, ib.height - rh);
  const car = { t: oy + ct * rh, b: oy + cb * rh, l: ox + cx0 * rw, r: ox + cx1 * rw };
  const fig = hero.querySelector(".hero__photo").getBoundingClientRect();
  const head = document.querySelector(".site-header").getBoundingClientRect();
  const from = document.getElementById("bk-from").getBoundingClientRect();
  return {
    ...head1,
    whole: [car.t - ib.top, ib.bottom - car.b, car.l - Math.max(ib.left, 0), Math.min(ib.right, innerWidth) - car.r].map(Math.round),
    crop: s / Math.min(ib.width / img.naturalWidth, ib.height / img.naturalHeight),
    side: [car.l - ib.left, ib.right - car.r].map(Math.round),
    header: Math.round(car.t - head.bottom),
    below: Math.round(fig.bottom - car.b),
    text: Math.round(hb.top - fig.bottom),
    order: [hb.bottom <= tb.top, tb.bottom <= sb.top, sb.bottom <= hero.querySelector(".hero__book").getBoundingClientRect().top],
    fromTop: Math.round(from.top),
    band: getComputedStyle(hero.querySelector(".hero__photo")).position === "absolute",
    clear: Math.round(car.t - sb.bottom),
    under: Math.round(hero.querySelector(".hero__book").getBoundingClientRect().top - car.b),
    seats: hero.querySelector(".hero__book").getBoundingClientRect().bottom <= hero.querySelector(".seats").getBoundingClientRect().top || getComputedStyle(document.documentElement).getPropertyValue("--x") === "" && !matchMedia("(scripting: enabled)").matches,
  };
};

for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await type.launch();
  for (const [jsOn, fonts] of [[true, true], [true, false], [false, true]]) {
    const how = `${jsOn ? "" : ", without JavaScript"}${fonts ? "" : ", with Castoro blocked"}`;
    for (const [width, height] of [...PHONES, ...LANDSCAPE]) {
      const ctx = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: jsOn });
      if (!fonts) await ctx.route(/\/castoro-latin\.[^/]+\.woff2$/, (r) => r.abort());
      const p = await ctx.newPage();
      if (engine === "chromium" && jsOn) await p.addInitScript(CLS_PROBE);
      await p.goto(`${base}/`, { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      const m = await p.evaluate(MEASURE, CARS);
      await check(`${engine} ${width}x${height}${how}: the homepage H1 is two lines, Travel in then First Class, inside the page`, () => {
        assert.equal(m.lines, 2, `${m.lines} lines at ${m.font}px`);
        assert.ok(m.inside, "the H1 overflows or the page scrolls sideways");
      });
      if (fonts) {
        if (width > height) await check(`${engine} ${width}x${height}${how}: the photo band under the header shows the whole car above the fade, and the H1, the two lines and the form follow it in order`, () => {
          assert.ok(CARS[m.slug], `no car box for ${m.slug} in CARS`);
          assert.ok(m.band, "the photo is not a band");
          assert.ok(m.whole.every((v) => v >= 0), `car cut by the band or the screen: top, bottom, left, right ${m.whole.join(", ")}`);
          assert.ok(m.header >= 0, `the car starts ${-m.header}px under the header`);
          assert.ok(m.below >= FADE, `the car ends ${FADE - m.below}px inside the ${FADE}px fade`);
          assert.ok(m.text >= 0, `the H1 starts ${-m.text}px inside the band`);
          assert.deepEqual(m.order, [true, true, true]);
        });
        else await check(`${engine} ${width}x${height}${how}: the car is whole in the photo and the screen under the header, the H1 and the two lines end at least 12px above it, and the booking card starts below it`, () => {
          assert.ok(CARS[m.slug], `no car box for ${m.slug} in CARS`);
          assert.ok(m.whole.every((v) => v >= 0), `car cut by the photo or the screen: top, bottom, left, right ${m.whole.join(", ")}`);
          assert.ok(m.header >= 0, `the car starts ${-m.header}px under the header`);
          assert.ok(m.clear >= 12, `the second line ends ${12 - m.clear}px too close to the car`);
          assert.ok(m.under >= 0, `the booking card starts ${-m.under}px over the car`);
          assert.deepEqual(m.order, [true, true, true]);
        });
        if (width > height) {
          await check(`${engine} ${width}x${height}${how}: a landscape phone shows the photo uncropped, and the car clears the ${SIDE_FADE}px side fades`, () => {
            assert.ok(m.crop < 1.01, `the photo is cropped ${((m.crop - 1) * 100).toFixed(1)}%`);
            assert.ok(m.side.every((v) => v >= SIDE_FADE), `the car is ${m.side.join(", ")}px from the photo's left and right edges`);
          });
        }
      }
      if (engine === "chromium" && jsOn && fonts) {
        const cls = await p.evaluate(() => window.__cls);
        await check(`${engine} ${width}x${height}: CLS on load is 0`, () => assert.equal(cls, 0));
      }
      await ctx.close();
    }
  }
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const m = await p.evaluate(MEASURE, CARS);
  await check(`${engine} 375x667: the pickup field starts inside the first screen`, () => assert.ok(m.fromTop < 667 - 48, `pickup starts at ${m.fromTop}`));
  await ctx.close();
  await browser.close();
}

const DESK = [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440], [2560, 1080], [1920, 800], [1280, 650], [1366, 657], [1440, 790], [1536, 730], [1920, 950]];
const DESK_MEASURE = (cars) => {
  const hero = document.querySelector("main > section.hero"), img = hero.querySelector(".hero__photo picture img");
  const slug = /\/fleet\/([a-z0-9-]+?)-\d+\.(?:avif|webp)$/.exec(img.currentSrc)[1];
  const [ct, cb, cx0, cx1] = cars[slug];
  const ib = img.getBoundingClientRect(), hb = hero.getBoundingClientRect(), head = document.querySelector(".site-header__bar").getBoundingClientRect(), cs = getComputedStyle(img);
  const sc = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight), rw = img.naturalWidth * sc, rh = img.naturalHeight * sc;
  const [px, py] = cs.objectPosition.split(" ");
  const at = (v, free) => (v.endsWith("%") ? (free * parseFloat(v)) / 100 : parseFloat(v));
  const ox = ib.left + at(px, ib.width - rw), oy = ib.top + at(py, ib.height - rh);
  const card = document.getElementById("bk-search").getBoundingClientRect();
  const car = { t: oy + ct * rh, b: oy + cb * rh, l: ox + cx0 * rw, r: ox + cx1 * rw };
  const range = document.createRange();
  const rects = [...hero.querySelectorAll("h1, .hero__tags, .bk-mode, #bk-search, #bk-adds")].filter((e) => e.getClientRects().length).flatMap((e) => {
    range.selectNodeContents(e);
    return [...(e.matches("h1, .hero__tags") ? range.getClientRects() : [e.getBoundingClientRect()])].filter((q) => q.width > 1).map((q) => [e.id || e.className.split(" ")[0] || e.tagName, q]);
  });
  const text = rects.filter(([n]) => n === "h-hero" || n === "hero__tags").map(([, q]) => q);
  return {
    shape: cs.objectFit === "cover" && Math.abs(rh / rw - img.naturalHeight / img.naturalWidth) < 0.01 && rw >= ib.width - 0.5 && rh >= ib.height - 0.5,
    whole: [car.t - Math.max(hb.top, head.bottom), card.top - car.b, car.l - hb.left, hb.right - car.r].map(Math.round),
    covered: [...new Set(rects.filter(([, q]) => Math.min(q.right, car.r) - Math.max(q.left, car.l) > 1 && Math.min(q.bottom, car.b) - Math.max(q.top, car.t) > 1).map(([n]) => n))],
    above: Math.round(car.t - Math.max(...text.map((q) => q.bottom))),
    fold: Math.round(innerHeight - car.b),
    cover: ib.left <= 0 && ib.top <= 0 && ib.right >= innerWidth && ib.bottom >= innerHeight,
    off: [ib.top - hb.top, ib.left - hb.left].map(Math.round),
  };
};
for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await type.launch();
  for (const motion of ["no-preference", "reduce"]) {
    for (const [width, height] of DESK) {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
      const p = await ctx.newPage();
      if (engine === "chromium") await p.addInitScript(CLS_PROBE);
      await p.goto(`${base}/`, { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      const m = await p.evaluate(DESK_MEASURE, CARS);
      await check(`${engine} ${width}x${height}, ${motion} motion: the homepage photo is drawn with object-fit cover, never stretched, the car is whole under the menu, above the booking card and at least 24px above the fold, nothing of the headline, the two lines or the booking bar sits on it, the headline and the two lines end at least 24px above it, and the photo stays smaller than the screen so it can be the LCP`, () => {
        assert.ok(m.shape, "the photo is cropped or stretched");
        assert.ok(m.whole.every((v) => v >= 0), `car cut: ${m.whole.join(", ")}`);
        assert.deepEqual(m.covered, []);
        assert.ok(m.above >= 24, `the text ends ${m.above}px above the car`);
        assert.ok(m.fold >= 24, `the car ends ${m.fold}px above the fold`);
        assert.equal(m.cover, false, "the photo covers the whole screen, so Chromium drops it as the LCP candidate");
      });
      const scrolled = [];
      for (const y of [120, 240, 360]) {
        await p.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y);
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        scrolled.push([y, await p.evaluate(DESK_MEASURE, CARS)]);
      }
      await check(`${engine} ${width}x${height}, ${motion} motion: scrolled 120, 240 and 360 px the photo and its fades move with the hero, and no headline, line under it, switch, add link or bar slides onto the car`, () =>
        assert.deepEqual(scrolled.filter(([, s]) => s.covered.length || s.off.join() !== m.off.join()).map(([y, s]) => [y, s.covered, s.off, m.off]), []));
      if (engine === "chromium") {
        const cls = await p.evaluate(() => window.__cls);
        await check(`${engine} ${width}x${height}, ${motion} motion: CLS on load is 0`, () => assert.equal(cls, 0));
      }
      await ctx.close();
    }
  }
  await browser.close();
}

async function classicChromium() {
  if (process.platform !== "darwin") return null;
  const m = /^(.*[\\/]ms-playwright)[\\/]chromium-(\d+)[\\/]/.exec(chromium.executablePath());
  const dir = m && join(m[1], `chromium_headless_shell-${m[2]}`);
  const sub = dir && existsSync(dir) && readdirSync(dir).find((n) => n.startsWith("chrome-headless-shell-"));
  const bin = sub && join(dir, sub, "chrome-headless-shell");
  if (!bin || !existsSync(bin)) return null;
  const wrap = join(mkdtempSync(join(tmpdir(), "nlr-scrollbars-")), "chrome-headless-shell");
  writeFileSync(wrap, `#!/bin/sh\nexec "${bin}" "$@" -AppleShowScrollBars Always\n`);
  chmodSync(wrap, 0o755);
  return chromium.launch({ executablePath: wrap }).catch(() => null);
}
{
  const cb = await classicChromium();
  if (!cb) console.log("  ..   classic scroll bars cannot be forced here, the classic scroll bar checks are skipped");
  else {
    for (const [width, height] of [[1024, 768], [1030, 772], [1040, 780], [1060, 795], [1280, 720], [1440, 900], [1920, 1080]]) {
      const ctx = await cb.newContext({ viewport: { width, height } });
      const p = await ctx.newPage();
      await p.goto(`${base}/`, { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      const bar = await p.evaluate(() => innerWidth - document.documentElement.scrollWidth);
      const m = await p.evaluate(DESK_MEASURE, CARS);
      await check(`chromium ${width}x${height} with classic 15 px scroll bars, as on Windows or a Mac with a mouse: the homepage photo is never stretched, the car is whole and at least 24px above the fold, nothing of the headline, the two lines or the booking bar sits on it, and the headline and the two lines end at least 24px above it`, () => {
        assert.equal(bar, 15, "the scroll bar takes no room, so this run proves nothing");
        assert.ok(m.shape, "the photo is cropped or stretched");
        assert.ok(m.whole.every((v) => v >= 0), `car cut: ${m.whole.join(", ")}`);
        assert.deepEqual(m.covered, []);
        assert.ok(m.above >= 24, `the text ends ${m.above}px above the car`);
        assert.ok(m.fold >= 24, `the car ends ${m.fold}px above the fold`);
      });
      await ctx.close();
    }
    await cb.close();
  }
}

const LINES = () => {
  const out = [];
  const range = document.createRange();
  const h1 = document.querySelector("main > section.hero > h1"), gold = h1.querySelector(".hero__gold");
  const [tags, svc] = document.querySelectorAll("main > section.hero > .hero__tags");
  const add = (name, el, owner) => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 2) out.push({ name, x: q.left, y: q.top, w: q.width, h: q.height, color: getComputedStyle(owner).color });
    }
  };
  add("Travel in", h1, h1);
  add("First Class", gold, gold);
  for (const li of tags.children) add("Professional, Luxury, Reliable", li, li);
  for (const li of svc.children) add("Airport Transfers, Hourly Service, Corporate Travel", li, li);
  if (matchMedia("(min-width: 1024px)").matches) {
    for (const a of document.querySelectorAll(".site-nav a")) add("the header links", a, a);
    for (const e of document.querySelectorAll(".site-header__bar :is(.site-header__name, .site-header__name > span, .site-header__tag)")) add("the brand name and tag", e, e);
  }
  return out;
};
const DARKEST = async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const ls = [];
  for (let i = 0; i < d.length; i += 4) ls.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
  ls.sort((a, b) => a - b);
  return ls[Math.floor(ls.length * 0.01)];
};
const lum = (color) => {
  const n = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => (color.startsWith("color(") ? v * 255 : v));
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(n[0]) + 0.7152 * lin(n[1]) + 0.0722 * lin(n[2]);
};
const PLANE = (planes) => {
  const img = document.querySelector(".hero__photo picture img");
  const slug = /\/fleet\/([a-z0-9-]+?)-\d+\.(?:avif|webp)$/.exec(img.currentSrc)[1];
  const ib = img.getBoundingClientRect(), cs = getComputedStyle(img);
  const s = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight), rw = img.naturalWidth * s, rh = img.naturalHeight * s;
  const at = (v, free) => (v.endsWith("%") ? (free * parseFloat(v)) / 100 : parseFloat(v));
  const [px, py] = cs.objectPosition.split(" ");
  const ox = ib.left + at(px, ib.width - rw), oy = ib.top + at(py, ib.height - rh);
  const [x0, x1, y0, y1] = planes[slug];
  const plane = { l: ox + x0 * rw, r: ox + x1 * rw, t: oy + y0 * rh, b: oy + y1 * rh };
  const range = document.createRange(), rects = [];
  const h1 = document.querySelector("main > section.hero > h1");
  for (const [name, el] of [["Travel in", h1], ["First Class", h1.querySelector(".hero__gold")], ...[...document.querySelectorAll("main > section.hero > .hero__tags > li")].map((li) => [li.textContent, li])]) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 1 && q.height > 1) rects.push([name, q]);
    }
  }
  for (const e of document.querySelectorAll(".site-header a, .site-header button")) {
    if (!e.getClientRects().length || getComputedStyle(e).visibility === "hidden") continue;
    const q = e.getBoundingClientRect();
    if (q.width > 1 && q.height > 1) rects.push([`header ${e.textContent.trim().slice(0, 16) || e.getAttribute("aria-label") || e.className}`, q]);
  }
  return { slug, hits: [...new Set(rects.filter(([, q]) => Math.min(q.right, plane.r) - Math.max(q.left, plane.l) > 0.5 && Math.min(q.bottom, plane.b) - Math.max(q.top, plane.t) > 0.5).map(([n]) => n))] };
};
const settle = async (p) => {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForFunction(() => {
    const img = document.querySelector(".hero__photo picture img");
    return img.complete && img.naturalWidth > 0;
  });
  await p.waitForTimeout(300);
};
for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await type.launch();
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 720], [1366, 657], [1440, 900], [1920, 950], [1920, 1080], [2560, 1440]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await settle(p);
    const lines = await p.evaluate(LINES);
    await p.addStyleTag({ content: ".hero > h1, .hero > h1 *, .hero__tags, .hero__tags *, .site-nav a, .site-header__word * { color: transparent !important } .hero__tags { background: none !important } .hero__tags > li + li::before { background: transparent !important }" });
    await p.waitForTimeout(100);
    const worst = {};
    for (const q of lines) {
      const png = await p.screenshot({ clip: { x: Math.max(0, Math.floor(q.x)), y: Math.max(0, Math.floor(q.y)), width: Math.ceil(q.w), height: Math.ceil(q.h) } });
      const bg = await p.evaluate(DARKEST, `data:image/png;base64,${png.toString("base64")}`);
      const fg = lum(q.color);
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      worst[q.name] = Math.min(worst[q.name] ?? Infinity, Math.round(ratio * 100) / 100);
    }
    const want = ["Airport Transfers, Hourly Service, Corporate Travel", "First Class", "Professional, Luxury, Reliable", "Travel in", ...(width >= 1024 ? ["the brand name and tag", "the header links"] : [])];
    await check(`${engine} ${width}x${height}: on the photo, with the text hidden, the darkest 1% behind every line keeps the two lines${width >= 1024 ? ", the header links and the brand" : ""} at 4.5:1 and Travel in and First Class at 3:1`, () => {
      assert.deepEqual(Object.keys(worst).sort(), want);
      assert.deepEqual(Object.entries(worst).filter(([n, r]) => r < (n === "Travel in" || n === "First Class" ? 3 : 4.5)), []);
    });
    await ctx.close();
  }
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    const veil = await p.evaluate(() => getComputedStyle(document.querySelector(".hero"), "::after").backgroundImage);
    await check(`${engine} ${width}x${height}: the veil over the photo is painted with its ${VEIL[width]} cream`, () => {
      assert.notEqual(veil, "none");
      assert.ok(veil.includes(VEIL[width]), veil);
    });
    await ctx.close();
  }
  for (const block of ["Geist", "Castoro", "Geist and Castoro"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (block.includes("Geist")) await ctx.route(/\/geist-latin\.[^/]+\.woff2$/, (r) => r.abort());
    if (block.includes("Castoro")) await ctx.route(/\/castoro-latin\.[^/]+\.woff2$/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const f = await p.evaluate(() => ({
      button: document.getElementById("bk-view").getBoundingClientRect().bottom,
      lines: [...document.querySelectorAll(".hero > .hero__tags")].map((ul) => new Set([...ul.children].map((li) => Math.round(li.getBoundingClientRect().top))).size),
    }));
    await check(`${engine} 390x844, with ${block} blocked: Book your ride ends at least 16px inside the first screen and each of the two lines under the H1 stays one line`, () => {
      assert.ok(f.button <= 844 - 16, `Book your ride ends at ${f.button}`);
      assert.deepEqual(f.lines, [1, 1]);
    });
    await ctx.close();
  }
  for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440], [1366, 657], [1440, 790], [1536, 730], [1920, 950], [320, 568], [325, 640], [360, 780], [390, 844], [430, 932]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await settle(p);
    const m = await p.evaluate(PLANE, PLANES);
    await check(`${engine} ${width}x${height}: the plane of the ${m.slug} photo sits clear of every header link, button and pill and of every hero text line`, () => assert.deepEqual(m.hits, []));
    await ctx.close();
  }
  for (const [width, height] of [[1024, 768], [1100, 768], [1150, 768], [1170, 768], [1171, 768], [1280, 720], [1440, 900], [1024, 800], [390, 844], [320, 568]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    const n = await p.evaluate(() => [...document.querySelectorAll(".seats__n")].map((e) => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top))).size; }));
    await check(`${engine} ${width}x${height}: the three child seat names wrap to the same number of lines`, () => assert.ok(n.length === 3 && n.every((v) => v === n[0]), n.join(" ")));
    await ctx.close();
  }
  await browser.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} hero assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll hero tests passed");
process.exit(0);
