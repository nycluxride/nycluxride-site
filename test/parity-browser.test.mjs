import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "FLIGHT_API_KEY", "PLACE_TICKET_SECRET", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT"];
const nyDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 864e5));
const DATE = nyDate(5);
const SLUGS = ["chevrolet-suburban", "cadillac-escalade", "mercedes-s-class", "cadillac-lyriq", "sprinter-limo"];
const CLASS_KEYS = ["suv", "premium", "first", "sedan", "sprinter"];
const RATIO = 960 / 1192;
const GOLD = "rgb(168, 133, 28)";
const LINE = "rgb(230, 223, 210)";
const TILE = "rgb(244, 244, 243)";
const CREAM = "rgb(251, 248, 242)";
const WHITE = "rgb(255, 255, 255)";
const INK = "rgb(15, 19, 25)";
const ring = (color, px) => `${color} 0px 0px 0px ${px}px inset`;

const ONE_WAY = [
  [320, 640, 68, [152, 156, 128, 112, 152]],
  [375, 812, 92, [108, 132, 128, 88, 108]],
  [390, 844, 92, [88, 112, 108, 88, 88]],
  [430, 932, 92, [88, 88, 108, 88, 88]],
  [768, 1024, 172, [88, 88, 88, 88, 88]],
  [1024, 768, 124, [96, 96, 96, 96, 96]],
  [1280, 800, 172, [96, 96, 96, 96, 96]],
  [1366, 768, 172, [96, 96, 96, 96, 96]],
  [1440, 900, 172, [96, 96, 96, 96, 96]],
  [1920, 1080, 172, [96, 96, 96, 96, 96]],
];
const BY_THE_HOUR = [
  [390, 844, 92, [108, 132, 128, 108, 108]],
  [768, 1024, 172, [108, 108, 108, 108, 108]],
  [1440, 900, 172, [96, 96, 96, 96, 96]],
];
const FIRST_SCREEN = [1280, 1366, 1440, 1920];

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function serve() {
  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !ENV_KEYS.includes(k)));
  const child = spawn(process.execPath, [join(ROOT, "scripts", "serve.mjs"), String(port)], { cwd: ROOT, env: { ...env, BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(`${base}/robots.txt`)).ok) return { child, base }; } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error("dev server did not start");
}

let failures = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function check(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 10).join("\n       ")}`);
  }
}

const MANIFEST = JSON.parse(readFileSync(join(ROOT, "fleet", "MANIFEST.json"), "utf8"));
const FLEET = readdirSync(join(ROOT, "fleet"));
for (const slug of SLUGS) {
  await check(`P5 ${slug}: the card master is 960x1192, with 300 and 400 in AVIF and WebP, and no card file wider than the master`, () => {
    const image = MANIFEST.images.find((i) => i.slug === `${slug}-card`);
    assert.ok(image, `${slug}-card is not in fleet/MANIFEST.json`);
    assert.deepEqual([image.master.path, image.master.width, image.master.height], [`fleet/${slug}-card.webp`, 960, 1192]);
    for (const width of [300, 400]) for (const format of ["avif", "webp"]) {
      const v = image.variants.find((x) => x.width === width && x.format === format);
      assert.ok(v && FLEET.includes(`${slug}-card-${width}.${format}`), `${slug}-card-${width}.${format}`);
      assert.ok(Math.abs(v.width / v.height - RATIO) / RATIO < 0.005, `${slug}-card-${width}.${format} is ${v.width}x${v.height}`);
    }
    assert.ok(image.variants.every((v) => v.width <= image.master.width), JSON.stringify(image.variants.map((v) => v.width)));
    const files = FLEET.filter((f) => f.startsWith(`${slug}-card-`)).map((f) => Number(/^.+-card-(\d+)\.(avif|webp)$/.exec(f)?.[1]));
    assert.ok(files.length && files.every((w) => w > 0 && w <= image.master.width), `${slug}: ${files.join(", ")}`);
    assert.deepEqual(files.sort((a, b) => a - b), image.variants.map((v) => v.width).sort((a, b) => a - b), `${slug}: every card file on disk is a variant in the manifest`);
  });
}

const { child, base } = await serve();
process.on("exit", () => child.kill());

const ENGINES = [["chromium", chromium]];
for (const [name, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (b) { await b.close(); ENGINES.push([name, type]); }
  else console.log(`  ..   ${name} is not installed here, its checks are skipped`);
}

async function context(browser, options = {}) {
  const width = (options.viewport || {}).width || 390;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", hasTouch: width < 1024, ...options });
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  return ctx;
}
async function open(ctx, path) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  return page;
}
async function place(page, end, text, label) {
  await page.fill(`#bk-${end}`, "");
  await page.click(`#bk-${end}`);
  await page.keyboard.type(text);
  await page.locator(`#bk-${end}-list [role=option][aria-label="${label}"], #bk-${end}-list [role=option][aria-label="${label.replace(/^(.*? \(\w+\)), (.+)$/, "$2, $1")}"], #bk-${end}-list [role=option]:has-text("${label}")`).first().click();
}
async function options(page, hourly = false) {
  if (hourly) {
    await page.click("label:has(#bk-hour)");
    await page.waitForFunction(() => document.getElementById("bk-hour").checked);
    await place(page, "from", "edition", "The New York EDITION");
  } else {
    await place(page, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(page, "to", "edition", "The New York EDITION");
  }
  if (await page.evaluate(() => document.getElementById("bk-cal").hidden)) await page.click("#bk-date-btn");
  for (let i = 0; i < 3 && !(await page.$(`#bk-cal [data-day="${DATE}"]`)); i++) await page.click('#bk-cal .bk-cal__nav[data-dir="1"]');
  await page.click(`#bk-cal [data-day="${DATE}"]`);
  if ((await page.getAttribute("#bk-time-btn", "aria-expanded")) !== "true") await page.click("#bk-time-btn");
  const o = page.locator('#bk-tm [role=option][data-v="12:40"]');
  await page.waitForFunction(() => getComputedStyle(document.getElementById("bk-tm")).opacity === "1");
  await o.evaluate((x) => { const l = x.closest("[role=listbox]"), a = x.getBoundingClientRect(), b = l.getBoundingClientRect(); l.scrollTop += a.top - b.top - (b.height - a.height) / 2; });
  await o.click();
  await page.waitForFunction(() => document.getElementById("bk-time").value === "12:40");
  await page.click("#bk-view");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && !document.getElementById("bk-wait").textContent.startsWith("Finding") && /\$/.test(document.getElementById("bk-p-suv").textContent));
  await page.evaluate(() => [...document.querySelectorAll("label.bk-card")].pop().scrollIntoView({ block: "end", behavior: "instant" }));
  await page.waitForFunction(() => [...document.querySelectorAll(".bk-card img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(150);
}
const rows = (page) =>
  page.evaluate((keys) => {
    const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size; };
    return [...document.querySelectorAll("label.bk-card")].map((c, i) => {
      const a = c.getBoundingClientRect(), t = c.querySelector("picture").getBoundingClientRect(), img = c.querySelector("picture img"), price = document.getElementById(`bk-p-${keys[i]}`).getBoundingClientRect();
      return { row: Math.round(a.height), tile: [Math.round(t.width), Math.round(t.height)], left: Math.round(t.left - a.left), top: Math.round(t.top - a.top), bottom: Math.round(a.bottom - t.bottom), name: lines(c.querySelector(".bk-card__name")), model: lines(c.querySelector(".bk-card__model")), src: img.currentSrc.replace(/^.*\/fleet\//, ""), ratio: img.naturalWidth / img.naturalHeight, price: price.bottom };
    });
  }, CLASS_KEYS);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [engine, type] of ENGINES) {
  const browser = await type.launch();
  for (const [width, height, tile, heights] of ONE_WAY) {
    const ctx = await context(browser, { viewport: { width, height } });
    await check(`P1 ${engine} one way at ${width}x${height}: the photo tiles are ${tile} px wide${width < 600 ? ", 80 px tall, 4 px in from the card's left and centred in the row" : " and 4 px inside the card"}, the rows keep their heights ${heights.join(", ")}${width >= 600 ? ", every name and model line is one line" : ""}${FIRST_SCREEN.includes(width) ? ", every price is in the first screen" : ""}, each photo is the new 960x1192 studio photo and nothing scrolls sideways`, async () => {
      const p = await open(ctx, "/book");
      await options(p);
      const r = await rows(p);
      assert.deepEqual(r.map((x) => x.row), heights, "row heights");
      assert.deepEqual(r.map((x) => x.tile[0]), Array(5).fill(tile), "tile widths");
      assert.deepEqual(r.map((x) => x.left), Array(5).fill(4), "tile left insets");
      if (width < 600) assert.deepEqual(r.map((x) => [x.tile[1], x.top, x.bottom]), heights.map((h) => [80, (h - 80) / 2, (h - 80) / 2]), "80 px tiles centred in the row");
      else assert.deepEqual(r.map((x) => [x.tile[1], x.top, x.bottom]), heights.map((h) => [h - 8, 4, 4]), "tile heights and insets");
      if (width >= 600) assert.deepEqual(r.map((x) => [x.name, x.model]), Array(5).fill([1, 1]), "name and model lines");
      if (FIRST_SCREEN.includes(width)) assert.ok(r.every((x) => x.price <= height), `price ends ${r.map((x) => Math.round(x.price))}`);
      assert.deepEqual(r.map((x) => x.src.replace(/-card-(300|400)\.(avif|webp)$/, "")), SLUGS, r.map((x) => x.src).join(", "));
      assert.ok(r.every((x) => Math.abs(x.ratio - RATIO) / RATIO < 0.005), `natural ratios ${r.map((x) => x.ratio.toFixed(4))}`);
      assert.ok((await sideways(p)) <= 0, "the page scrolls sideways");
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
  for (const [width, height, tile, heights] of BY_THE_HOUR) {
    const ctx = await context(browser, { viewport: { width, height } });
    await check(`P1 ${engine} by the hour from The New York EDITION at ${width}x${height}: the rows keep their heights ${heights.join(", ")}, the tiles are ${tile} px wide and ${width < 600 ? "80 px tall, 4 px in from the left and centred in the row" : "4 px inside the card"}, and nothing scrolls sideways`, async () => {
      const p = await open(ctx, "/book");
      await options(p, true);
      const r = await rows(p);
      assert.deepEqual(r.map((x) => x.row), heights, "row heights");
      assert.deepEqual(r.map((x) => [x.tile[0], x.tile[1], x.left, x.top, x.bottom]), heights.map((h) => (width < 600 ? [tile, 80, 4, (h - 80) / 2, (h - 80) / 2] : [tile, h - 8, 4, 4, 4])), "tiles");
      assert.ok((await sideways(p)) <= 0, "the page scrolls sideways");
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
  for (const [width, height] of [[360, 780], [390, 844], [568, 320]]) {
    const ctx = await context(browser, { viewport: { width, height }, javaScriptEnabled: false });
    await check(`P1 ${engine} without javascript at ${width}x${height} on /, /locations/jfk-airport and /book: the photo tiles are 92 px wide and nothing scrolls sideways`, async () => {
      for (const path of ["/", "/locations/jfk-airport", "/book"]) {
        const p = await open(ctx, path);
        const tiles = await p.evaluate(() => [...document.querySelectorAll("label.bk-card picture")].map((t) => Math.round(t.getBoundingClientRect().width)));
        assert.deepEqual(tiles, Array(5).fill(92), path);
        assert.ok((await sideways(p)) <= 0, `${path} scrolls sideways`);
        await p.close();
      }
    });
    await ctx.close();
  }
  await browser.close();
}

const look = (page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.boxShadow = "var(--shadow-card)";
    document.body.append(probe);
    const shadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const radius = (s) => [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].join(" ");
    return { shadow, cards: [...document.querySelectorAll("label.bk-card")].map((c) => {
      const s = getComputedStyle(c), t = c.querySelector("picture"), ts = getComputedStyle(t), a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      return { on: c.querySelector("input").checked, radius: radius(s), shadow: s.boxShadow, ring: getComputedStyle(c, "::after").boxShadow, tile: [radius(ts), ts.backgroundColor, Math.round(b.left - a.left), Math.round(b.top - a.top), Math.round(a.bottom - b.bottom), Math.round(b.height)], h: Math.round(a.height), badge: getComputedStyle(c.querySelector(".bk-card__check")).opacity };
    }) };
  });
const meet = (page) => page.evaluate(() => [...document.querySelectorAll("#bk-meet-f label.bk-mrow")].filter((m) => m.getClientRects().length).map((m) => { const s = getComputedStyle(m); return { on: m.querySelector("input").checked, radius: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].join(" "), ring: s.boxShadow }; }));
function cardLook(l, chosen, phone) {
  assert.deepEqual(l.cards.map((c) => c.on), CLASS_KEYS.map((k) => k === chosen), "the chosen card");
  for (const [i, c] of l.cards.entries()) {
    const k = CLASS_KEYS[i];
    assert.equal(c.radius, "16px 16px 16px 16px", k);
    assert.equal(c.shadow, l.shadow, `${k}: the card shadow is --shadow-card`);
    assert.equal(c.ring, ring(c.on ? GOLD : LINE, c.on ? 3 : 1), k);
    assert.deepEqual(c.tile, ["12px 12px 12px 12px", TILE, 4, ...(phone ? [(c.h - 80) / 2, (c.h - 80) / 2, 80] : [4, 4, c.h - 8])], k);
    assert.equal(c.badge, c.on ? "1" : "0", `${k}: the check badge`);
  }
}

for (const [engine, type] of ENGINES) {
  const browser = await type.launch();
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await context(browser, { viewport: { width, height } });
    await check(`P2 ${engine} at ${width}: the class rows are white cards with radius 16 and the card shadow, a 3 px gold ring and the check badge on the chosen card, a 1 px line on the others, the photo on a light grey tile with radius 12 ${width < 600 ? "80 px tall, 4 px in from the left and centred in the row" : "set 4 px inside"}, and on step 3 the Where we meet rows have radius 16 with a 2 px gold edge on the chosen one`, async () => {
      const p = await open(ctx, "/book");
      await options(p);
      await p.mouse.move(0, 0);
      cardLook(await look(p), "suv", width < 600);
      await p.click('label[for="bk-c-first"]');
      await p.waitForFunction(() => document.getElementById("bk-c-first").checked);
      await p.mouse.move(0, 0);
      await p.waitForTimeout(100);
      cardLook(await look(p), "first", width < 600);
      await p.click("#bk-next");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
      await p.mouse.move(0, 0);
      await p.waitForTimeout(100);
      const m = await meet(p);
      assert.ok(m.length >= 2 && m.filter((x) => x.on).length === 1, JSON.stringify(m));
      for (const x of m) assert.deepEqual([x.radius, x.ring], ["16px 16px 16px 16px", ring(x.on ? GOLD : LINE, x.on ? 2 : 1)], JSON.stringify(x));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
  {
    const ctx = await context(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    await check(`P3 ${engine} at 1440 with motion allowed: the photo eases its scale over 0.6 s on the settle curve, a hovered row's photo drifts to 1.04 over 1.2 s and the row's box does not move`, async () => {
      const p = await open(ctx, "/book");
      await options(p);
      await p.mouse.move(0, 0);
      await p.waitForTimeout(700);
      const card = 'label[for="bk-c-first"]';
      const rest = await p.evaluate((sel) => {
        const probe = document.createElement("div");
        probe.style.transitionTimingFunction = "var(--ease-settle)";
        document.body.append(probe);
        const settle = getComputedStyle(probe).transitionTimingFunction;
        probe.remove();
        const s = getComputedStyle(document.querySelector(`${sel} picture img`));
        return { settle, t: [s.transitionProperty, s.transitionDuration, s.transitionTimingFunction], scale: s.scale, box: JSON.stringify(document.querySelector(sel).getBoundingClientRect()) };
      }, card);
      assert.deepEqual(rest.t, ["scale", "0.6s", rest.settle], "the photo transition at rest");
      assert.equal(rest.scale, "none");
      await p.hover(card);
      await p.waitForTimeout(1600);
      const on = await p.evaluate((sel) => { const s = getComputedStyle(document.querySelector(`${sel} picture img`)); return { scale: s.scale, d: s.transitionDuration, box: JSON.stringify(document.querySelector(sel).getBoundingClientRect()) }; }, card);
      assert.deepEqual([on.scale, on.d], ["1.04", "1.2s"], "the hovered photo");
      assert.equal(on.box, rest.box, "the row moved on hover");
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
  {
    const ctx = await context(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await check(`P3 ${engine} at 1440 with reduced motion: the photo has no transition and does not scale on hover`, async () => {
      const p = await open(ctx, "/book");
      await options(p);
      await p.hover('label[for="bk-c-first"]');
      await p.waitForTimeout(300);
      const s = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('label[for="bk-c-first"] picture img')); return [c.transitionDuration, c.scale]; });
      assert.deepEqual(s, ["0s", "none"]);
      await p.close();
    });
    await ctx.close();
  }
  {
    const ctx = await context(browser, { viewport: { width: 1440, height: 900 }, forcedColors: "active" });
    await check(`P3 ${engine} at 1440 in forced colors: the chosen card keeps its 3 px Highlight border and the others a 1 px CanvasText border`, async () => {
      const p = await open(ctx, "/book");
      await options(p);
      await p.mouse.move(0, 0);
      const b = await p.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "Highlight";
        document.body.append(probe);
        const hl = getComputedStyle(probe).color;
        probe.style.color = "CanvasText";
        const ct = getComputedStyle(probe).color;
        probe.remove();
        return { hl, ct, cards: [...document.querySelectorAll("label.bk-card")].map((c) => { const s = getComputedStyle(c); return [c.querySelector("input").checked, ["Top", "Right", "Bottom", "Left"].map((e) => `${s[`border${e}Width`]} ${s[`border${e}Style`]} ${s[`border${e}Color`]}`)]; }) };
      });
      assert.notEqual(b.hl, b.ct);
      for (const [on, sides] of b.cards) assert.deepEqual(sides, Array(4).fill(on ? `3px solid ${b.hl}` : `1px solid ${b.ct}`), JSON.stringify(b.cards));
      assert.deepEqual(b.cards.map(([on]) => on), CLASS_KEYS.map((k) => k === "suv"));
      await p.close();
    });
    await ctx.close();
  }
  await browser.close();
}

const CLS_PROBE = () => {
  window.__cls = null;
  if (!(PerformanceObserver.supportedEntryTypes || []).includes("layout-shift")) return;
  window.__cls = 0;
  window.__shifts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(e.sources.map((s) => (s.node && (s.node.id || s.node.className || s.node.nodeName)) || "?").join(",")); } }).observe({ type: "layout-shift", buffered: true });
};
const header = (page) => page.evaluate(() => getComputedStyle(document.querySelector(".site-header")).backgroundColor);
for (const [engine, type] of ENGINES) {
  const browser = await type.launch();
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await context(browser, { viewport: { width, height } });
    await ctx.addInitScript(CLS_PROBE);
    await check(`P4 ${engine} at ${width}: the /book header is ${width < 1024 ? "the ink phone bar" : "cream"} on steps 1, 2 and 3, the page does not shift from load to step 2 with typed places, and /rates and /booking-confirmed keep ${width < 1024 ? "the same ink bar" : "a white header"}`, async () => {
      const book = width < 1024 ? INK : CREAM, plain = width < 1024 ? INK : WHITE;
      const p = await open(ctx, "/book");
      assert.equal(await header(p), book, "step 1");
      await options(p);
      assert.equal(await header(p), book, "step 2");
      const cls = await p.evaluate(() => [window.__cls, window.__shifts]);
      if (cls[0] !== null) assert.equal(cls[0], 0, `layout shifts ${JSON.stringify(cls[1])}`);
      await p.click("#bk-next");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
      assert.equal(await header(p), book, "step 3");
      assert.deepEqual(p.errors, []);
      await p.close();
      for (const path of ["/rates", "/booking-confirmed"]) {
        const q = await open(ctx, path);
        assert.equal(await header(q), plain, path);
        await q.close();
      }
    });
    await ctx.close();
  }
  await browser.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll parity checks passed");
process.exit(0);
