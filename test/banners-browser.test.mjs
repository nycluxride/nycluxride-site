import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const SIZES = "(max-width: 599px) 84vw, 100vw";
const CARS = {
  "mercedes-s-class": [0.27, 0.86, 0.11, 0.91],
  "lincoln-navigator": [0.14, 0.8, 0.07, 0.96],
  "cadillac-escalade-esv": [0.21, 0.86, 0.06, 0.93],
  "gmc-denali": [0.32, 0.82, 0.09, 0.92],
  "sprinter-jet": [0.2, 0.9, 0.05, 0.95],
  "chevrolet-suburban": [0.24, 0.82, 0.06, 0.91],
  "bmw-7-series": [0.25, 0.88, 0.13, 0.93],
  "cadillac-ct5-ct6": [0.31, 0.76, 0.1, 0.91],
  "cadillac-xt6": [0.25, 0.78, 0.09, 0.91],
  "cadillac-xt6-showroom": [0.11, 0.91, 0.1, 0.94],
  "cadillac-lyriq": [0.31, 0.82, 0.1, 0.91],
  "lincoln-continental": [0.24, 0.75, 0.09, 0.93],
  "cadillac-escalade": [0.23, 0.82, 0.14, 0.9],
};
const VIEWPORTS = [[390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];
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

const htmlFiles = (dir, prefix = "") => readdirSync(dir).flatMap((name) => {
  if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "api"].includes(name) || name.startsWith(".")) return [];
  const full = join(dir, name);
  return statSync(full).isDirectory() ? htmlFiles(full, `${prefix}${name}/`) : name.endsWith(".html") ? [`${prefix}${name}`] : [];
});
const BANNERS = htmlFiles(ROOT).filter((f) => /<section class="banner[ "]/.test(readFileSync(join(ROOT, f), "utf8"))).sort();
const route = (f) => "/" + f.replace(/\.html$/, "");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "fleet/MANIFEST.json"), "utf8"));
const MASTER = Object.fromEntries(MANIFEST.images.map((i) => [i.slug, i.master]));
const CSS = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((n) => /^lux\..+\.css$/.test(n))), "utf8");

await check(`every banner page is found (${BANNERS.length})`, () => assert.equal(BANNERS.length, 23, BANNERS.join(", ")));

for (const f of BANNERS) {
  const html = readFileSync(join(ROOT, f), "utf8");
  const fig = html.slice(html.indexOf('<figure class="banner__photo">'), html.indexOf("</figure>", html.indexOf('<figure class="banner__photo">')));
  const slug = (/src="\/fleet\/([a-z0-9-]+?)-900\.webp"/.exec(fig) || [])[1];
  await check(`${f}: the banner photo is the full-width picture, sized ${SIZES}, and its largest candidate is the master at ${slug && MASTER[slug] && MASTER[slug].width}w`, () => {
    assert.ok(slug && CARS[slug] && MASTER[slug], `no car data or master for ${slug}`);
    const sources = [...fig.matchAll(/<source type="image\/(avif|webp)" srcset="([^"]+)" sizes="([^"]+)">/g)];
    assert.deepEqual(sources.map((m) => m[1]), ["avif", "webp"]);
    for (const [, ext, set, sizes] of sources) {
      assert.equal(sizes, SIZES, ext);
      const widths = set.split(", ").map((c) => +c.split(" ")[1].slice(0, -1));
      assert.equal(Math.max(...widths), MASTER[slug].width, `${ext} srcset tops out at ${Math.max(...widths)}w`);
      assert.ok(set.split(", ").every((c) => existsSync(join(ROOT, c.split(" ")[0]))), `${ext} candidate missing on disk`);
    }
    const pre = /<link rel="preload" as="image" type="image\/avif" href="[^"]+" imagesrcset="([^"]+)" imagesizes="([^"]+)"/.exec(html);
    if (pre) assert.deepEqual([pre[1], pre[2]], [sources[0][2], SIZES]);
  });
  await check(`${f}: the banner names its photo ${slug} and lux.css carries that car geometry`, () => {
    assert.equal((/<section class="banner[^"]*" data-photo="([a-z0-9-]+)"/.exec(html) || [])[1], slug);
    const m = new RegExp(`\\.banner\\[data-photo=${slug}\\]\\{--ct:([.\\d]+);--ch:([.\\d]+);--ar:([.\\d]+)\\}`).exec(CSS);
    assert.ok(m, "no rule");
    const [t, b] = CARS[slug], ar = MASTER[slug].height / MASTER[slug].width;
    assert.ok(Math.abs(+m[3] - ar) < 0.002 && Math.abs(+m[1] - t * ar) < 0.002 && Math.abs(+m[2] - (b - t) * ar) < 0.002, `css ${m.slice(1).join(" ")} vs ${(t * ar).toFixed(3)} ${((b - t) * ar).toFixed(3)} ${ar.toFixed(3)}`);
  });
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

const MEASURE = (cars) => {
  const ban = document.querySelector("main > .banner"), img = ban.querySelector(".banner__photo picture img");
  const slug = /\/fleet\/([a-z0-9-]+?)-900\.webp$/.exec(img.getAttribute("src"))[1];
  const [ct, cb, cx0, cx1] = cars[slug];
  const br = ban.getBoundingClientRect(), ib = img.getBoundingClientRect(), cs = getComputedStyle(img);
  const s = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight), rw = img.naturalWidth * s, rh = img.naturalHeight * s;
  const [px, py] = cs.objectPosition.split(" ");
  const at = (v, free) => (v.endsWith("%") ? (free * parseFloat(v)) / 100 : parseFloat(v));
  const ox = ib.left + at(px, ib.width - rw), oy = ib.top + at(py, ib.height - rh);
  const car = { l: ox + cx0 * rw, r: ox + cx1 * rw, t: oy + ct * rh, b: oy + cb * rh };
  const boxes = [...ban.querySelectorAll(".bk-mode, #bk-search, .btn, .bk-badge, .slate, .assure-row")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => {
    const r = e.getBoundingClientRect(), g = e.id === "bk-search" && getComputedStyle(e, "::before");
    return { n: e.id || e.className.split(" ")[0], l: r.left, r: r.right, t: g && g.position === "absolute" ? r.top + (parseFloat(g.top) || 0) : r.top, b: r.bottom };
  });
  const h1 = ban.querySelector("h1").getBoundingClientRect();
  const mode = ban.querySelector(".bk-mode"), from = ban.querySelector("#bk-from-f");
  const m = mode && mode.getBoundingClientRect(), fr = from && from.getBoundingClientRect();
  const sources = [...img.parentElement.querySelectorAll("source")].map((x) => x.srcset.split(", ").map((c) => c.split(" ")));
  return {
    slug,
    full: [Math.round(ib.left - br.left), Math.round(ib.width - br.width), cs.objectFit],
    whole: [car.t - ib.top, ib.bottom - car.b, car.l - ib.left, ib.right - car.r].map(Math.round),
    centered: Math.round((((car.l + car.r) / 2 - (br.left + br.width / 2)) / br.width) * 100),
    covered: boxes.filter((x) => Math.min(x.r, car.r) - Math.max(x.l, car.l) > 1 && Math.min(x.b, car.b) - Math.max(x.t, car.t) > 1).map((x) => x.n),
    h1End: Math.round(car.b - h1.bottom),
    h1Seen: h1.top >= br.top && h1.bottom <= innerHeight,
    fit: m && fr ? [Math.round(innerHeight - (car.b + 6 + fr.bottom - m.top)), Math.round(fr.bottom - innerHeight)] : null,
    book: ban.classList.contains("banner--book"),
    largest: sources.some((set) => set[set.length - 1][0].endsWith(img.currentSrc.split("/").pop())) || !img.currentSrc,
    scrim: getComputedStyle(ban.querySelector(".banner__photo"), "::after").backgroundImage.startsWith("linear-gradient"),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const LIN = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const LUMA = ([r, g, b]) => 0.2126 * LIN(r) + 0.7152 * LIN(g) + 0.0722 * LIN(b);
async function legibility(p) {
  const parts = await p.evaluate(() => {
    const box = (e) => {
      if (!e || !e.getClientRects().length || getComputedStyle(e).visibility === "hidden") return null;
      const r = e.getBoundingClientRect();
      return r.bottom > innerHeight ? null : { x: Math.max(0, Math.round(r.left)), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const rgb = (e) => getComputedStyle(e).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const h1 = document.querySelector(".banner h1"), eb = document.querySelector(".banner__body > p:first-child"), add = document.querySelector(".banner #bk-adds .bk-link");
    return [["H1", h1, 3], ["eyebrow", eb, 4.5], ["Add stop", add, 4.5]].filter(([, e]) => e && box(e)).map(([n, e, need]) => [n, box(e), rgb(e), need]);
  });
  await p.addStyleTag({ content: ".banner__body{visibility:hidden!important}" });
  const out = [];
  for (const [name, clip, color, need] of parts) {
    const png = await p.screenshot({ clip, type: "png" });
    const top = await p.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data, lum = [];
      const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
      lum.sort((a, b) => a - b);
      return lum[Math.floor(lum.length * 0.99)];
    }, `data:image/png;base64,${png.toString("base64")}`);
    const fg = LUMA(color);
    out.push([name, +((Math.max(fg, top) + 0.05) / (Math.min(fg, top) + 0.05)).toFixed(2), need]);
  }
  return out;
}

async function readable(engine, browser, pages, viewports) {
  for (const [width, height] of viewports) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const rows = [];
    for (const f of pages) {
      const p = await ctx.newPage();
      await p.goto(base + route(f), { waitUntil: "load" });
      await p.waitForFunction(() => { const i = document.querySelector(".banner__photo picture img"); return i && i.complete && i.naturalWidth > 0; });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate(() => Promise.all(document.body.getAnimations().map((a) => a.finished)));
      rows.push([f, await legibility(p)]);
      await p.close();
    }
    await ctx.close();
    await check(`${engine} ${width}x${height}: over the scrimmed photo the H1 keeps 3:1 and the eyebrow and Add stop links 4.5:1 against the brightest 1% of pixels behind them`, () => {
      assert.ok(rows.every(([, r]) => r.some(([n]) => n === "H1")), "an H1 was not measured");
      assert.deepEqual(rows.flatMap(([f, r]) => r.filter(([, ratio, need]) => ratio < need).map((x) => [f, ...x])), []);
    });
  }
}

async function sweep(engine, browser, pages, viewports) {
  for (const [width, height] of viewports) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", ...(width < 600 && engine !== "firefox" ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const rows = [];
    for (const f of pages) {
      const p = await ctx.newPage();
      await p.goto(base + route(f), { waitUntil: "load" });
      await p.waitForFunction(() => { const i = document.querySelector(".banner__photo picture img"); return i && i.complete && i.naturalWidth > 0; });
      rows.push([f, await p.evaluate(MEASURE, CARS)]);
      await p.close();
    }
    await ctx.close();
    await check(`${engine} ${width}x${height}: every banner photo spans the banner width with object-fit cover`, () => assert.deepEqual(rows.filter(([, r]) => r.full[0] !== 0 || r.full[1] !== 0 || r.full[2] !== "cover").map(([f, r]) => [f, r.full]), []));
    await check(`${engine} ${width}x${height}: the car stays whole inside the photo and centered within 6% of the banner`, () => assert.deepEqual(rows.filter(([, r]) => r.whole.some((d) => d < 0) || Math.abs(r.centered) > 6).map(([f, r]) => [f, r.whole, r.centered]), []));
    await check(`${engine} ${width}x${height}: no bar, switch, button, badge, trust row or caption box sits on the car`, () => assert.deepEqual(rows.filter(([, r]) => r.covered.length).map(([f, r]) => [f, r.covered]), []));
    await check(`${engine} ${width}x${height}: the scrim is on and nothing scrolls sideways`, () => assert.deepEqual(rows.filter(([, r]) => !r.scrim || r.sideways).map(([f, r]) => [f, r.scrim, r.sideways]), []));
    await check(`${engine} ${width}x${height}: the H1 is inside the first screen`, () => assert.deepEqual(rows.filter(([, r]) => !r.h1Seen).map(([f]) => f), []));
    if (width >= 1024) {
      await check(`${engine} ${width}x${height}: the H1 ends at most 32px above the car's lowest point`, () => assert.deepEqual(rows.filter(([, r]) => r.h1End > 32).map(([f, r]) => [f, r.h1End]), []));
      await check(`${engine} ${width}x${height}: where the car leaves room for the switch and the bar under it, the bar's first row ends 24px inside the first screen`, () =>
        assert.deepEqual(rows.filter(([, r]) => r.fit && r.fit[0] >= 48 && r.fit[1] > -24).map(([f, r]) => [f, r.fit]), []));
    }
    if (width >= 1920 && engine === "chromium") await check(`${engine} ${width}x${height}: the browser fetches the largest file of the srcset`, () => assert.deepEqual(rows.filter(([, r]) => !r.largest).map(([f]) => f), []));
  }
}

const chrome = await chromium.launch();
await sweep("chromium", chrome, BANNERS, VIEWPORTS);
for (const [width, height] of [[1440, 900], [1024, 768]]) {
  const ctx = await chrome.newContext({ viewport: { width, height } });
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  for (const f of ["services.html", "locations/bronx.html", "black-car-service-brooklyn.html", "chauffeur-service-nyc.html", "about.html", "faq.html"]) {
    await check(`${f} at ${width}: the banner loads with no layout shift`, async () => {
      const p = await ctx.newPage();
      await p.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
      await p.goto(base + route(f), { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(800);
      assert.equal(await p.evaluate(() => window.__cls), 0);
      await p.close();
    });
  }
  await ctx.close();
}
await readable("chromium", chrome, ["services.html", "black-car-service-brooklyn.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "locations/jfk-airport.html", "locations/manhattan.html", "fleet.html", "rates.html", "404.html"], [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]]);
await chrome.close();

const SAMPLE = ["services.html", "locations/bronx.html", "locations/jfk-airport.html", "about.html", "faq.html", "404.html"];
for (const [engine, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (!b) {
    console.log(`  ..   ${engine} is not installed here, its banner sweep is skipped`);
    continue;
  }
  await sweep(engine, b, SAMPLE, [[390, 844], [1024, 768], [1440, 900], [2560, 1440]]);
  await readable(engine, b, ["services.html", "locations/jfk-airport.html", "about.html"], [[1440, 900]]);
  await b.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} banner assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll banner browser tests passed");
process.exit(0);
