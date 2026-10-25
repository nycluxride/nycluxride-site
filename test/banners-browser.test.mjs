import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const CARS = {
  "page-404": [0.55, 0.93, 0.01, 0.99],
  "page-about": [0.52, 0.94, 0.4, 0.95],
  "page-black-car-service-brooklyn": [0.45, 0.88, 0.48, 0.96],
  "page-bronx": [0.51, 0.89, 0.45, 0.88],
  "page-brooklyn": [0.38, 0.8, 0.41, 0.93],
  "page-chauffeur-service-nyc": [0.31, 0.9, 0.15, 0.93],
  "page-contact": [0.46, 0.89, 0.44, 0.99],
  "page-faq": [0.35, 0.99, 0.11, 0.79],
  "page-financial-district": [0.4, 0.94, 0.32, 0.94],
  "page-fleet": [0.39, 0.65, 0.32, 0.99],
  "page-jfk-airport": [0.35, 0.81, 0.31, 0.97],
  "page-laguardia-airport": [0.37, 0.76, 0.21, 0.72],
  "page-limousine-service-nyc": [0.33, 0.7, 0.03, 0.99],
  "page-long-island-city": [0.34, 0.96, 0.02, 0.99],
  "page-manhattan": [0.47, 0.93, 0.42, 0.95],
  "page-queens": [0.48, 0.86, 0.5, 0.91],
  "page-rates": [0.51, 0.9, 0.52, 0.95],
  "page-schedule": [0.26, 0.88, 0.07, 0.95],
  "page-services": [0.39, 0.81, 0.38, 0.97],
  "page-soho": [0.16, 0.91, 0.04, 0.91],
  "page-staten-island": [0.15, 0.91, 0.01, 0.97],
  "page-upper-east-side": [0.35, 0.95, 0.27, 0.94],
  "page-upper-west-side": [0.41, 0.93, 0.36, 0.93],
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
const ZOOM = (slug) => {
  const k = +(/\.banner\{--z:calc\(([.\d]+) \/ min\(var\(--cx\),1 - var\(--cx\)\)\)\}/.exec(CSS) || [])[1];
  const [, cl, cw] = new RegExp(`\\[data-photo=${slug}\\]\\{[^}]*--cl:([.\\d]+);--cw:([.\\d]+)\\}`).exec(CSS) || [];
  const cx = +cl + cw / 2;
  return Math.ceil(Math.max(1, k / Math.min(cx, 1 - cx)) * 100) / 100;
};
const SIZES = (slug) => `(max-width: 1023px) ${ZOOM(slug) > 1 ? `calc((100vw - 48px) * ${ZOOM(slug)})` : "calc(100vw - 48px)"}, (max-width: 1234px) calc(54vw - 35px), 632px`;

await check(`every banner page is found (${BANNERS.length})`, () => assert.equal(BANNERS.length, 25, BANNERS.join(", ")));

for (const f of BANNERS) {
  const html = readFileSync(join(ROOT, f), "utf8");
  const fig = html.slice(html.indexOf('<figure class="banner__photo">'), html.indexOf("</figure>", html.indexOf('<figure class="banner__photo">')));
  const slug = (/src="\/fleet\/([a-z0-9-]+?)-900\.webp"/.exec(fig) || [])[1];
  await check(`${f}: the banner photo is the framed picture, sized ${SIZES(slug)}, and its largest candidate is the master at ${slug && MASTER[slug] && MASTER[slug].width}w`, () => {
    assert.ok(slug && CARS[slug] && MASTER[slug], `no car data or master for ${slug}`);
    const sources = [...fig.matchAll(/<source type="image\/(avif|webp)" srcset="([^"]+)" sizes="([^"]+)">/g)];
    assert.deepEqual(sources.map((m) => m[1]), ["avif", "webp"]);
    for (const [, ext, set, sizes] of sources) {
      assert.equal(sizes, SIZES(slug), ext);
      const widths = set.split(", ").map((c) => +c.split(" ")[1].slice(0, -1));
      assert.equal(Math.max(...widths), MASTER[slug].width, `${ext} srcset tops out at ${Math.max(...widths)}w`);
      assert.ok(set.split(", ").every((c) => existsSync(join(ROOT, c.split(" ")[0]))), `${ext} candidate missing on disk`);
    }
    const pre = /<link rel="preload" as="image" type="image\/avif" href="[^"]+" imagesrcset="([^"]+)" imagesizes="([^"]+)"/.exec(html);
    if (pre) assert.deepEqual([pre[1], pre[2]], [sources[0][2], SIZES(slug)]);
  });
  await check(`${f}: the banner names its photo ${slug} and lux.css carries that car geometry`, () => {
    assert.equal((/<section class="banner[^"]*" data-photo="([a-z0-9-]+)"/.exec(html) || [])[1], slug);
    const m = new RegExp(`(?:^|[\\n}])\\[data-photo=${slug}\\]\\{--ct:([.\\d]+);--ch:([.\\d]+);(?:--ar:([.\\d]+);)?--cl:([.\\d]+);--cw:([.\\d]+)\\}`).exec(CSS);
    assert.ok(m, "no rule");
    m[3] = m[3] || (/\.banner,\.band\[data-photo\]\{[^}]*--ar:([.\d]+)/.exec(CSS) || [])[1];
    const [t, b, l, r] = CARS[slug], ar = MASTER[slug].height / MASTER[slug].width;
    assert.ok(Math.abs(+m[3] - ar) < 0.002 && Math.abs(+m[1] - t * ar) < 0.002 && Math.abs(+m[2] - (b - t) * ar) < 0.002 && Math.abs(+m[4] - l) < 0.002 && Math.abs(+m[5] - (r - l)) < 0.002, `css ${m.slice(1).join(" ")} vs ${(t * ar).toFixed(3)} ${((b - t) * ar).toFixed(3)} ${ar.toFixed(3)} ${l} ${(r - l).toFixed(2)}`);
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
  const boxes = [...ban.querySelectorAll(".bk-mode, #bk-search, .btn, .bk-badge, .slate, .assure-row, h1, .eyebrow, .lede, #bk-adds")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => {
    const r = e.getBoundingClientRect(), g = e.id === "bk-search" && getComputedStyle(e, "::before");
    return { n: e.id || e.className.split(" ")[0], l: r.left, r: r.right, t: g && g.position === "absolute" ? r.top + (parseFloat(g.top) || 0) : r.top, b: r.bottom };
  });
  const h1 = ban.querySelector("h1").getBoundingClientRect();
  const mode = ban.querySelector(".bk-mode"), bar = ban.querySelector("#bk-search"), view = ban.querySelector("#bk-view");
  const m = mode && mode.getBoundingClientRect(), gb = bar && bar.getBoundingClientRect().bottom, vb = view && view.getBoundingClientRect();
  const row = vb && Math.max(vb.bottom, ...[...ban.querySelectorAll("#bk-search .field")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().top < vb.bottom).map((e) => e.getBoundingClientRect().bottom));
  const sources = [...img.parentElement.querySelectorAll("source")].map((x) => x.srcset.split(", ").map((c) => c.split(" ")));
  const fig = ban.querySelector(".banner__photo"), fr = fig.getBoundingClientRect(), fs = getComputedStyle(fig), bs = getComputedStyle(ban);
  const ar = img.naturalHeight / img.naturalWidth, slot = Math.max((cb - ct) * ar + 0.04, Math.min(2 / 3, ar / (cx1 - cx0 + 0.03)));
  const content = br.width - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
  const texts = [...ban.querySelectorAll(".banner__body > :not(.banner__book), .banner__book .assure-row")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => [e.tagName.toLowerCase() + (e.className ? "." + e.className.split(" ")[0] : ""), e.getBoundingClientRect()]);
  const gold = ban.querySelector("h1 .h-gold");
  return {
    slug,
    fit: cs.objectFit,
    cover: [ib.left - fr.left, fr.right - ib.right, ib.top - fr.top, Math.min(fr.bottom, bar ? bar.getBoundingClientRect().top : Infinity) - ib.bottom].every((d) => d <= 0.5),
    slot: +slot.toFixed(4),
    ratio: +(fr.height / fr.width).toFixed(4),
    frame: { w: Math.round(fr.width), h: Math.round(fr.height), content: Math.round(content), left: Math.round(fr.left - br.left - parseFloat(bs.paddingLeft)) },
    onPhoto: texts.filter(([, r]) => Math.min(r.right, fr.right) - Math.max(r.left, fr.left) > 1 && Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top) > 1).map(([n]) => n),
    hairline: [fs.outlineStyle, fs.outlineWidth, fs.boxShadow !== "none", parseFloat(fs.borderTopLeftRadius) >= 16],
    ink: [getComputedStyle(ban.querySelector("h1")).color, gold && getComputedStyle(gold).color, bs.backgroundColor],
    above: Math.round(fr.top - h1.bottom),
    whole: [car.t - ib.top, ib.bottom - car.b, car.l - ib.left, ib.right - car.r].map(Math.round),
    inside: (() => { const f = ban.querySelector(".banner__photo").getBoundingClientRect(); return [car.t - f.top, f.bottom - car.b, car.l - f.left, f.right - car.r].map(Math.round); })(),
    side: Math.round(car.l - h1.right),
    lines: (() => { const q = document.createRange(); q.selectNodeContents(ban.querySelector("h1")); return new Set([...q.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; })(),
    hourly: !!(ban.querySelector("#bk-hour") && ban.querySelector("#bk-hour").checked),
    airport: !!(ban.querySelector("#bk-from") && ban.querySelector("#bk-from").defaultValue),

    bandH: Math.round(ban.querySelector(".banner__photo").getBoundingClientRect().height),
    imgW: Math.round(ib.width),
    dateRoom: (() => { const e = ban.querySelector("#bk-date-f"); return e ? Math.round(innerHeight - e.getBoundingClientRect().bottom) : null; })(),
    centered: Math.round((((car.l + car.r) / 2 - (br.left + br.width / 2)) / br.width) * 100),
    covered: boxes.filter((x) => Math.min(x.r, car.r) - Math.max(x.l, car.l) > 1 && Math.min(x.b, car.b) - Math.max(x.t, car.t) > 1).map((x) => x.n),
    h1Seen: h1.top >= br.top && h1.bottom <= innerHeight,
    glass: m && gb ? [Math.round(innerHeight - (car.b + 6 + gb - m.top)), Math.round(innerHeight - gb)] : null,
    room: vb ? [Math.round(innerHeight - row), Math.round(innerHeight - vb.bottom)] : null,
    modeTop: m && Math.round(m.top),
    h1Top: Math.round(h1.top - br.top),
    book: ban.classList.contains("banner--book"),
    fetched: (() => {
      const set = sources.find((x) => x.some((c) => img.currentSrc.endsWith(c[0]))) || [], ws = set.map((c) => parseInt(c[1], 10));
      const got = ws[set.findIndex((c) => img.currentSrc.endsWith(c[0]))], top = Math.max(...ws), cover = (n) => Math.min(top, ...ws.filter((w) => w >= n));
      return { got, ok: !!got && (got >= ib.width * devicePixelRatio || got === top) && got <= cover(Math.min(632, innerWidth * 0.54) * devicePixelRatio) };
    })(),

    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    drawn: ib.width * devicePixelRatio,
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
    const h1 = document.querySelector(".banner h1"), gold = h1 && h1.querySelector(".h-gold"), eb = document.querySelector(".banner__body > p:first-child"), add = document.querySelector(".banner #bk-adds .bk-link");
    return [["H1", h1, 3], ["H1 key words", gold, 3], ["eyebrow", eb, 4.5], ["Add stop", add, 4.5]].filter(([, e]) => e && box(e)).map(([n, e, need]) => [n, box(e), rgb(e), need]);
  });
  await p.addStyleTag({ content: ".banner h1,.banner h1 *,.banner__body>p:first-child,.banner #bk-adds .bk-link,.banner #bk-adds .bk-link *{color:#0000!important;-webkit-text-stroke-color:#0000!important;text-decoration-color:#0000!important}" });
  const out = [];
  for (const [name, clip, color, need] of parts) {
    const png = await p.screenshot({ clip, type: "png" });
    const fg = LUMA(color);
    const back = await p.evaluate(async ([src, dark]) => {
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
      return lum[Math.floor(lum.length * (dark ? 0.01 : 0.99))];
    }, [`data:image/png;base64,${png.toString("base64")}`, fg < 0.18]);
    out.push([name, +((Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05)).toFixed(2), need]);
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
    await check(`${engine} ${width}x${height}: the H1 and its gold key words keep 3:1, and the eyebrow and Add stop links 4.5:1, against the 1% of pixels behind them that sit closest to their own colour`, () => {
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
    await check(`${engine} ${width}x${height}: every banner photo covers its whole frame, down to the booking card where the card overlaps it, with object-fit cover, never stretched, and ${width >= 1024 ? "every frame keeps its slot, 3:2 or wider where the car needs it" : "every frame spans the banner, the plain ones at their slot, 3:2 or wider where the car needs it, the widget ones between 100px and that tall"}`, () =>
      assert.deepEqual(rows.filter(([, r]) => r.fit !== "cover" || !r.cover || (width < 1024 && (r.frame.left !== 0 || Math.abs(r.frame.w - r.frame.content) > 1)) || (width >= 1024 || !r.book ? Math.abs(r.ratio - r.slot) > 0.01 : r.frame.h < 100 || r.frame.h > r.frame.w * r.slot + 1)).map(([f, r]) => [f, r.fit, r.cover, r.ratio, r.slot, r.frame]), []));
    await check(`${engine} ${width}x${height}: the car stays whole inside the photo and inside the frame${width >= 1024 ? "" : ", centered within 6%"}`, () => assert.deepEqual(rows.filter(([, r]) => r.whole.some((d) => d < 0) || r.inside.some((d) => d < 0) || (width < 1024 && Math.abs(r.centered) > 6)).map(([f, r]) => [f, r.whole, r.inside, r.centered]), []));
    await check(`${engine} ${width}x${height}: no text and no part of the form sits on the car: no H1, eyebrow, lede, bar, switch, add links, button, badge, trust row or caption`, () =>
      assert.deepEqual(rows.filter(([, r]) => r.covered.length).map(([f, r]) => [f, r.covered]), []));
    await check(`${engine} ${width}x${height}: the text sits on the cream banner, never on the photo, the H1 is ink with its key words in gold, the frame carries ${width >= 1024 ? "its 1px gold hairline, " : "no hairline, "}a soft shadow and round corners, and nothing scrolls sideways`, () =>
      assert.deepEqual(rows.filter(([, r]) => r.onPhoto.length || r.ink.join() !== "rgb(15, 19, 25),rgb(148, 102, 32),rgb(251, 248, 242)" || (width >= 1024 ? r.hairline.join() !== "solid,1px,true,true" : r.hairline[0] !== "none" || !r.hairline[2] || !r.hairline[3]) || r.sideways).map(([f, r]) => [f, r.onPhoto, r.ink, r.hairline, r.sideways]), []));
    await check(`${engine} ${width}x${height}: the H1 is inside the first screen`, () => assert.deepEqual(rows.filter(([, r]) => !r.h1Seen).map(([f]) => f), []));
    if (width >= 1024) await check(`${engine} ${width}x${height}: the headline sits left of the car, at least 24px from it`, () =>
      assert.deepEqual(rows.filter(([, r]) => r.side < 24).map(([f, r]) => [f, r.side]), []));
    if (width >= 1024) await check(`${engine} ${width}x${height}: the booking card, with the flight row on the airport pages, ends at least 23px inside the first screen`, () =>
      assert.deepEqual(rows.filter(([, r]) => r.glass && r.glass[1] < 23).map(([f, r]) => [f, r.glass]), []));
    if (width >= 1024 && engine === "chromium") await check(`${engine} ${width}x${height}: the browser fetches a file at least as wide as the photo is drawn, or the largest, and no larger than the first file that covers the 632px slot`, () => assert.deepEqual(rows.filter(([, r]) => !r.fetched.ok).map(([f, r]) => [f, r.fetched.got]), []));
  }
}

async function pixels(engine, browser, pages, [width, height, dpr]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "reduce", ...(engine !== "firefox" ? { isMobile: true, hasTouch: true } : {}) });
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
  await check(`${engine} ${width}x${height} at ${dpr}x: every banner fetches a file with at least as many pixels across as the photo is drawn, its zoom included`, () =>
    assert.deepEqual(rows.filter(([, r]) => !(r.fetched.got >= r.drawn)).map(([f, r]) => [f, r.fetched.got, Math.ceil(r.drawn)]), []));
}

async function fold(engine, browser, pages, viewports, fits = true) {
  for (const [width, height] of viewports) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", ...(width < 600 && engine !== "firefox" ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const rows = [];
    for (const f of pages) {
      const p = await ctx.newPage();
      await p.goto(base + route(f), { waitUntil: "load" });
      await p.waitForFunction(() => { const i = document.querySelector(".banner__photo picture img"); return i && i.complete && i.naturalWidth > 0; });
      await p.evaluate(() => document.fonts.ready);
      rows.push([f, await p.evaluate(MEASURE, CARS)]);
      await p.close();
    }
    await ctx.close();
    const edge = width >= 1024 ? 24 : 8;
    if (fits) await check(`${engine} ${width}x${height}: on every widget banner the bar's first row, each field in it and Book your ride, ends at least ${edge}px inside the first screen`, () =>
      assert.deepEqual(rows.filter(([, r]) => !r.room || r.room[0] < edge).map(([f, r]) => [f, r.room]), []));
    if (fits && width < 1024) {
      await check(`${engine} ${width}x${height}: Book your ride ends at least ${edge}px inside the first screen on every widget banner off the airports whose one-way H1 runs to ${height <= 700 ? "two" : "three"} lines or less, or that starts by the hour`, () =>
        assert.deepEqual(rows.filter(([, r]) => !r.airport && (r.hourly || r.lines <= (height <= 700 ? 2 : 3)) && (!r.room || r.room[0] < edge)).map(([f, r]) => [f, r.room, r.lines]), []));
      await check(`${engine} ${width}x${height}: on the airport pages the date field ends inside the first screen`, () =>
        assert.deepEqual(rows.filter(([, r]) => r.airport && !(r.dateRoom >= 0)).map(([f, r]) => [f, r.dateRoom]), []));
    }
    await check(`${engine} ${width}x${height}: the car stays whole inside the photo and the banner, no text sits on it, the H1 starts inside the banner, and nothing scrolls sideways`, () =>
      assert.deepEqual(rows.filter(([, r]) => r.whole.some((d) => d < 0) || r.inside.some((d) => d < 0) || r.covered.length || r.h1Top < 0 || !r.h1Seen || r.sideways).map(([f, r]) => [f, r.whole, r.inside, r.covered, r.h1Top, r.sideways]), []));
    if (width >= 1024) {
      await check(`${engine} ${width}x${height}: on every widget banner the booking card, with the flight row on the airport pages, ends at least 24px inside the first screen`, () =>
        assert.deepEqual(rows.filter(([, r]) => !r.glass || r.glass[1] < 23).map(([f, r]) => [f, r.glass]), []));
      const tops = [...new Set(rows.filter(([, r]) => Math.abs(r.room[0] - 48) <= 2).map(([, r]) => r.modeTop))];
      await check(`${engine} ${width}x${height}: every widget banner with a one-row bar that needs the room puts its switch at the same height`, () => assert.ok(tops.length < 2 || Math.max(...tops) - Math.min(...tops) <= 1, tops.join(", ")));
    }
    if (width < 1024) {
      await check(`${engine} ${width}x${height}: the H1 starts at least 12px into the banner, under the header`, () => assert.deepEqual(rows.filter(([, r]) => r.h1Top < 12).map(([f, r]) => [f, r.h1Top]), []));
      await check(`${engine} ${width}x${height}: the H1 ends at least 8px above the photo frame, never on it, and the frame gets shorter on short screens instead`, () =>
        assert.deepEqual(rows.filter(([, r]) => r.above < 8).map(([f, r]) => [f, r.above]), []));
      await check(`${engine} ${width}x${height}: every widget banner, the airports too, keeps a photo frame of at least 100px, so no car shrinks to a thumbnail`, () =>
        assert.deepEqual(rows.filter(([, r]) => r.bandH < 100).map(([f, r]) => [f, r.bandH, r.imgW]), []));
      if (height < 597) await check(`${engine} ${width}x${height}: on a screen too short for Book your ride at any frame height, the frame keeps its slot and the photo is drawn across the whole frame`, () =>
        assert.deepEqual(rows.filter(([, r]) => Math.abs(r.ratio - r.slot) > 0.01 || r.imgW < r.frame.w - 1).map(([f, r]) => [f, r.bandH, r.imgW, r.frame]), []));
      await check(`${engine} ${width}x${height}: on every widget banner the frame shrinks below its slot only while that keeps Book your ride on the first screen`, () =>
        assert.deepEqual(rows.filter(([, r]) => r.frame.h < r.frame.w * r.slot - 1 && !(r.room && r.room[1] >= 0)).map(([f, r]) => [f, r.frame, r.room, r.lines]), []));
    }
  }
}

const WIDGET = BANNERS.filter((f) => /<section class="banner banner--book[ "]/.test(readFileSync(join(ROOT, f), "utf8")));
const FOLD = [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1680, 1050], [1920, 1080], [2560, 1440], [1024, 768], [820, 1180], [390, 844], [375, 667], [390, 664], [360, 800], [375, 812], [384, 832], [412, 839], [360, 780], [390, 800], [393, 786], [412, 915], [430, 932], [393, 659], [360, 660], [768, 954], [768, 1024], [600, 960], [810, 1080], [834, 1112]];
await check(`every widget banner page is found (${WIDGET.length})`, () => assert.equal(WIDGET.length, 18, WIDGET.join(", ")));

const chrome = await chromium.launch();
await sweep("chromium", chrome, BANNERS, VIEWPORTS);
await fold("chromium", chrome, WIDGET, FOLD);
await fold("chromium", chrome, WIDGET, [[375, 548], [320, 568], [360, 600], [360, 640], [375, 600], [375, 620], [414, 622]], false);
await pixels("chromium", chrome, BANNERS, [390, 844, 3]);
for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [375, 667]]) {
  const ctx = await chrome.newContext({ viewport: { width, height } });
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  for (const f of ["services.html", "locations/bronx.html", "black-car-service-brooklyn.html", "chauffeur-service-nyc.html", "car-service-with-car-seat-nyc.html", "locations/jfk-airport.html", "locations/newark-airport.html", "about.html", "faq.html"]) {
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
await readable("chromium", chrome, ["services.html", "black-car-service-brooklyn.html", "chauffeur-service-nyc.html", "car-service-with-car-seat-nyc.html", "limousine-service-nyc.html", "locations/jfk-airport.html", "locations/newark-airport.html", "locations/manhattan.html", "fleet.html", "rates.html", "404.html"], [[1024, 768], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]]);
await readable("chromium", chrome, ["services.html", "black-car-service-brooklyn.html", "car-service-with-car-seat-nyc.html", "limousine-service-nyc.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/manhattan.html", "fleet.html"], [[375, 667], [390, 844]]);
await chrome.close();

const SAMPLE = ["services.html", "locations/bronx.html", "locations/jfk-airport.html", "about.html", "faq.html", "404.html"];
for (const [engine, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (!b) {
    console.log(`  ..   ${engine} is not installed here, its banner sweep is skipped`);
    continue;
  }
  await sweep(engine, b, [...SAMPLE, "car-service-with-car-seat-nyc.html", "locations/newark-airport.html", "fleet.html"], [[390, 844], [1024, 768], [1440, 900], [2560, 1440]]);
  await fold(engine, b, ["services.html", "black-car-service-brooklyn.html", "chauffeur-service-nyc.html", "locations/jfk-airport.html", "locations/manhattan.html", "locations/queens.html"], [[1280, 720], [1366, 768], [1920, 1080], [390, 844], [375, 667], [360, 800], [390, 664]]);
  await fold(engine, b, ["locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/manhattan.html", "black-car-service-brooklyn.html"], [[320, 568], [360, 640], [375, 600]], false);
  await readable(engine, b, ["services.html", "locations/jfk-airport.html", "about.html"], [[1440, 900]]);
  await readable(engine, b, ["services.html", "locations/jfk-airport.html"], [[1366, 768], [375, 667]]);
  await pixels(engine, b, BANNERS, [390, 844, 3]);
  await b.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} banner assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll banner browser tests passed");
process.exit(0);
