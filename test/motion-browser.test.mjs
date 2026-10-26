import { readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const SHOTS = process.env.MOTION_SHOTS_DIR || join(tmpdir(), "nlr-motion-shots");
const POST = "/blog/jfk-lga-ewr-airport-transfer-guide-april-17";
const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "FLIGHT_API_KEY", "PLACE_TICKET_SECRET", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT"];
const nyDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 864e5));
const DATE = nyDate(7);

function pages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "api"].includes(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name.endsWith(".html")) {
      const f = relative(ROOT, full);
      out.push(f === "index.html" ? "/" : `/${f.replace(/\.html$/, "")}`);
    }
  }
  return out.sort();
}

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
async function serve() {
  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !ENV_KEYS.includes(k)));
  const child = spawn(process.execPath, [join(ROOT, "scripts", "serve.mjs"), String(port)], { cwd: ROOT, env: { ...env, BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/`)).ok) return { child, base }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("dev server did not start");
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 8).join("\n       ")}`);
  }
}

const PROBE = (pause) => {
  window.__vt = { on: false, ready: false, done: false, cls: 0, names: [], types: [], anims: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vt.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  addEventListener("pagereveal", (e) => {
    const t = e.viewTransition;
    if (!t) return;
    window.__vt.on = true;
    t.ready.then(() => {
      window.__vt.types = [...t.types];
      window.__vt.anims = document.getAnimations().filter((a) => a.effect && /^::view-transition/.test(a.effect.pseudoElement || ""));
      window.__vt.names = [...new Set(window.__vt.anims.map((a) => (a.effect.pseudoElement.match(/\(([^)]+)\)/) || [])[1]).filter(Boolean))].sort();
      if (pause) window.__vt.anims.forEach((a) => a.pause());
      window.__vt.ready = true;
    }, () => (window.__vt.done = true));
    t.finished.then(() => (window.__vt.done = true), () => (window.__vt.done = true));
  });
  window.__seek = (ms) => { window.__vt.anims.forEach((a) => (a.currentTime = ms)); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); };
  window.__finish = () => window.__vt.anims.forEach((a) => a.finish());
  window.__pe = (pe, prop) => getComputedStyle(document.documentElement, pe)[prop];
};

const { child, base } = await serve();
process.on("exit", () => child.kill());
const browser = await chromium.launch({ channel: "chrome" });

async function context(width, { motion = "no-preference", pause = false, engine = browser } = {}) {
  const ctx = await engine.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: motion, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.addInitScript(PROBE, pause);
  return ctx;
}
const revealed = async (page) => {
  await page.waitForLoadState("load");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => window.__vt.ready || window.__vt.done || !window.__vt.on, null, { timeout: 8000 }).catch(() => {});
};
async function go(page, path) {
  await Promise.all([page.waitForURL((u) => u.pathname === path.split(/[?#]/)[0]), page.evaluate((u) => { location.href = u; }, path)]);
  await revealed(page);
}
const settle = (page) => page.waitForFunction(() => !window.__vt.on || window.__vt.done, null, { timeout: 8000 }).catch(() => {});
const namedElements = (page) => page.evaluate(() => [...document.querySelectorAll("*")].map((e) => getComputedStyle(e).viewTransitionName).filter((n) => n && n !== "none"));
const dupes = (list) => list.filter((n, i) => list.indexOf(n) !== i);

async function place(page, end, text, label) {
  await page.fill(`#bk-${end}`, "");
  await page.click(`#bk-${end}`);
  await page.keyboard.type(text);
  await page.locator(`#bk-${end}-list [role=option][aria-label="${label}"], #bk-${end}-list [role=option][aria-label="${label.replace(/^(.*? \(\w+\)), (.+)$/, "$2, $1")}"], #bk-${end}-list [role=option]:has-text("${label}")`).first().click();
}
async function referenceTrip(page) {
  await place(page, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
  await place(page, "to", "edition", "The New York EDITION");
  const open = await page.isVisible("#bk-cal");
  if (!open) await page.click("#bk-date-btn");
  for (let i = 0; i < 14 && !(await page.$(`#bk-cal [data-day="${DATE}"]`)); i++) await page.click('#bk-cal .bk-cal__nav[data-dir="1"]');
  await page.click(`#bk-cal [data-day="${DATE}"]`);
  await page.click("#bk-time-btn");
  const o = page.locator('#bk-tm [role=option][data-v="14:00"]');
  await page.waitForFunction(() => getComputedStyle(document.getElementById("bk-tm")).opacity === "1");
  await o.evaluate((x) => x.scrollIntoView({ block: "nearest" }));
  await o.click();
}
const step = (page) => page.evaluate(() => document.getElementById("book-form").dataset.step);

const ALL = pages(ROOT);
for (const width of [390, 1440]) {
  const ctx = await context(width);
  const p = await ctx.newPage();
  const bad = [];
  for (const route of ALL) {
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    const d = dupes(await namedElements(p));
    if (d.length) bad.push(`${route}: ${d.join(", ")}`);
  }
  await p.goto(`${base}/book`, { waitUntil: "load" });
  await referenceTrip(p);
  for (const [button, want] of [["#bk-view", "options"], [width < 1024 ? "#bk-bar-go" : "#bk-next", "details"]]) {
    await p.click(button);
    await p.waitForFunction((s) => document.getElementById("book-form").dataset.step === s, want, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
    const d = dupes(await namedElements(p));
    if (d.length) bad.push(`/book#${want}: ${d.join(", ")}`);
  }
  await check(`(1) at ${width}px no two elements share a view-transition-name on any of the ${ALL.length} pages or in the /book steps`, () => assert.deepEqual(bad, []));
  await ctx.close();
}

{
  const ctx = await context(1440, { motion: "reduce" });
  const p = await ctx.newPage();
  const busy = [];
  for (const route of ["/", "/rates", "/fleet", "/faq", "/locations/manhattan", POST, "/book"]) {
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    await p.waitForTimeout(50);
    const run = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName || (a.effect && a.effect.pseudoElement) || "animation"));
    if (run.length) busy.push(`${route}: ${run.join(", ")}`);
  }
  await referenceTrip(p);
  await p.click("#bk-view");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options", null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(50);
  const run = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName || "animation"));
  if (run.length) busy.push(`/book#options: ${run.join(", ")}`);
  await check("(2) with reduced motion no animation is running 50 ms after load or after a step switch", () => assert.deepEqual(busy, []));
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(width);
  const p = await ctx.newPage();
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await go(p, "/fleet");
  await settle(p);
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => [window.__vt.on, window.__vt.cls]);
  await check(`(3) at ${width}px CLS stays 0 on /fleet through a transition from /rates`, () => {
    assert.equal(r[0], true, "no view transition ran");
    assert.equal(r[1], 0, `CLS ${r[1]}`);
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  for (const route of ["/", "/locations/manhattan", "/rates", POST]) {
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__lcp = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push(e.element ? e.element.className : ""); }).observe({ type: "largest-contentful-paint", buffered: true }); });
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => [window.__lcp, !!document.querySelector("img.plate__twin")]);
    await check(`(4) ${route} at ${width}px: the LCP element is never the twin${["/", "/locations/manhattan"].includes(route) ? ", and the page has its twin" : ""}`, () => {
      assert.ok(r[0].length > 0, "no LCP entry");
      assert.ok(!r[0].some((c) => /\bplate__twin\b/.test(c)), JSON.stringify(r[0]));
      if (["/", "/locations/manhattan"].includes(route)) assert.ok(r[1], "no img.plate__twin on the page");
    });
    await p.close();
  }
  await ctx.close();
}

const lumOf = async (helper, png) => helper.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4);
}, png.toString("base64"));
const helper = await browser.newPage();

{
  const ctx = await context(1440, { pause: true });
  const p = await ctx.newPage();
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await go(p, "/fleet");
  await p.evaluate(() => window.__seek(0));
  const first = await lumOf(helper, await p.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 600 } }));
  await p.evaluate(() => window.__seek(150));
  const at150 = await lumOf(helper, await p.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 600 } }));
  const old = await p.evaluate(() => [window.__pe("::view-transition-old(root)", "opacity"), window.__pe("::view-transition-old(banner-text)", "opacity"), window.__vt.names]);
  await check("(5) 150 ms into /rates to /fleet the old page and its headings are no longer visible", () => {
    assert.ok(old[2].includes("banner") && old[2].includes("banner-text"), `groups ${old[2].join(" ")}`);
    assert.deepEqual(old.slice(0, 2).map(Number), [0, 0]);
  });
  await check(`(6) 150 ms into /rates to /fleet at 1440 the top 600px keeps its luminance within 15% (first ${first.toFixed(1)}, at 150 ms ${at150.toFixed(1)})`, () =>
    assert.ok(Math.abs(at150 - first) <= first * 0.15, `${((Math.abs(at150 - first) / first) * 100).toFixed(1)}%`));
  await p.evaluate(() => window.__finish());
  await ctx.close();
}

{
  const ctx = await context(1440, { pause: true });
  const p = await ctx.newPage();
  await p.goto(`${base}/`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await referenceTrip(p);
  await p.waitForTimeout(400);
  await Promise.all([p.waitForURL((u) => u.pathname === "/book", { timeout: 10000 }), p.click("#bk-view")]);
  await p.waitForFunction(() => window.__vt.ready || window.__vt.done, null, { timeout: 8000 }).catch(() => {});
  const s = await p.evaluate(() => [window.__vt.on, window.__vt.names, window.__vt.types]);
  mkdirSync(SHOTS, { recursive: true });
  const saved = [];
  for (const t of [90, 180, 270]) {
    await p.evaluate((ms) => window.__seek(ms), t);
    const file = join(SHOTS, `home-to-options-1440-${t}ms.jpg`);
    writeFileSync(file, await p.screenshot({ type: "jpeg", quality: 55 }));
    saved.push(file);
  }
  await p.evaluate(() => window.__finish());
  await settle(p);
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => [window.__vt.cls, document.getElementById("book-form").dataset.step]);
  await check(`(7) / to /book#options at 1440: a trip group morphs, the type is floor, CLS stays 0 (frames in ${SHOTS})`, () => {
    assert.equal(s[0], true, "no view transition ran");
    assert.ok(s[1].includes("trip"), `groups ${s[1].join(" ")}`);
    assert.ok(s[2].includes("floor"), `types ${s[2].join(" ")}`);
    assert.equal(after[1], "options");
    assert.equal(after[0], 0, `CLS ${after[0]}`);
  });
  console.log(`  ..   saved ${saved.map((f) => relative(SHOTS, f)).join(", ")}`);
  await ctx.close();
}

{
  const ctx = await context(1440, { pause: true });
  const p = await ctx.newPage();
  await p.goto(`${base}/locations/manhattan`, { waitUntil: "load" });
  await go(p, "/locations/brooklyn");
  await p.evaluate(() => window.__seek(180));
  const mid = await p.evaluate(() => [window.__vt.names, window.__pe("::view-transition-group(trip)", "transform"), window.__pe("::view-transition-group(trip)", "width"), window.__pe("::view-transition-group(trip)", "height")]);
  await p.evaluate(() => window.__finish());
  await settle(p);
  const rest = await p.evaluate(() => { const r = document.querySelector(".banner__book").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const m = /matrix\(1, 0, 0, 1, ([-\d.]+), ([-\d.]+)\)/.exec(mid[1] || "");
  await check("(8) /locations/manhattan to /locations/brooklyn at 1440: the banner and the bar hold, the bar within 2px of its resting box at 180 ms", () => {
    assert.ok(mid[0].includes("banner-b") && mid[0].includes("trip"), `groups ${mid[0].join(" ")}`);
    assert.ok(m, `group transform ${mid[1]}`);
    const box = [Number(m[1]), Number(m[2]), parseFloat(mid[2]), parseFloat(mid[3])];
    box.forEach((v, i) => assert.ok(Math.abs(v - rest[i]) <= 2, `box ${box.map(Math.round)} against ${rest.map(Math.round)}`));
  });
  await ctx.close();
}

for (const [from, to] of [["/services", "/fleet"], ["/fleet", "/services"]]) {
  const ctx = await context(1440, { pause: true });
  const p = await ctx.newPage();
  await p.goto(`${base}${from}`, { waitUntil: "load" });
  await go(p, to);
  const r = await p.evaluate(() => [window.__vt.names, window.__vt.anims.map((a) => a.effect.pseudoElement)]);
  await p.evaluate(() => window.__finish());
  await check(`(8b) ${from} to ${to} at 1440: the booking banner and the plain banner do not morph into each other, each fades on its own`, () => {
    assert.ok(r[0].includes("banner") && r[0].includes("banner-b"), `groups ${r[0].join(" ")}`);
    const pair = (n) => ["old", "new"].every((k) => r[1].includes(`::view-transition-${k}(${n})`));
    assert.deepEqual(["banner", "banner-b", "banner-text", "banner-text-b"].filter(pair), []);
  });
  await ctx.close();
}

{
  const ctx = await context(1440);
  const p = await ctx.newPage();
  await p.goto(`${base}/locations/manhattan`, { waitUntil: "load" });
  await go(p, "/locations/brooklyn");
  await settle(p);
  await Promise.all([p.waitForURL((u) => u.pathname === "/locations/manhattan"), p.goBack()]);
  await revealed(p);
  const b = await p.evaluate(() => [window.__vt.on, window.__vt.types, window.__vt.names]);
  await check("(9) a Back navigation carries the back type and names nothing but the header and the action bar", () => {
    assert.equal(b[0], true, "no view transition ran on Back");
    assert.ok(b[1].includes("back"), `types ${b[1].join(" ")}`);
    assert.deepEqual(b[2].filter((n) => !["root", "header", "actionbar"].includes(n)), []);
  });
  await ctx.close();
}

{
  const ctx = await context(390);
  const p = await ctx.newPage();
  await p.goto(`${base}/locations/manhattan`, { waitUntil: "load" });
  await go(p, "/locations/brooklyn");
  const n = await p.evaluate(() => [window.__vt.on, window.__vt.names]);
  await settle(p);
  await check("(10) at 390 nothing but the header and the action bar is named during a transition", () => {
    assert.equal(n[0], true, "no view transition ran");
    assert.deepEqual(n[1].filter((x) => !["root", "header", "actionbar"].includes(x)), []);
  });
  await ctx.close();
}

const wk = await webkit.launch();
for (const [name, width, path] of [["chromium", 1024, "/book"], ["chromium", 1440, "/book"], ["chromium", 1920, "/book"], ["chromium", 1440, "/services"], ["webkit", 1440, "/book"]]) {
  const ctx = await context(width, { pause: true, engine: name === "webkit" ? wk : browser });
  const p = await ctx.newPage();
  await p.goto(`${base}/`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  if (path === "/book") {
    await referenceTrip(p);
    await p.waitForTimeout(400);
  }
  await Promise.all([p.waitForURL((u) => u.pathname === path, { timeout: 10000 }), p.click(path === "/book" ? "#bk-view" : `.site-nav a[href="${path}"]`)]);
  await p.waitForFunction(() => window.__vt.ready || window.__vt.done, null, { timeout: 8000 }).catch(() => {});
  const types = await p.evaluate(() => window.__vt.types);
  const lums = [];
  for (const t of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 540]) {
    await p.evaluate((ms) => window.__seek(ms), t);
    lums.push(Math.round(await lumOf(helper, await p.screenshot())));
  }
  await p.evaluate(() => window.__finish());
  await settle(p);
  const [from, to] = [lums[0], lums[lums.length - 1]];
  await check(`(11) ${name} / to ${path} at ${width}: the floor type runs and no frame is more than 10% darker than the darker page or lighter than the lighter page (${lums.join(" ")})`, () => {
    assert.ok(types.includes("floor"), `types ${types.join(" ")}`);
    assert.deepEqual(lums.filter((v) => v < Math.min(from, to) * 0.9 || v > Math.max(from, to) * 1.1), []);
  });
  await ctx.close();
}
await wk.close();

await helper.close();
await browser.close();
child.kill();

if (failures) {
  console.error(`\n${failures} motion assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll motion browser tests passed");
process.exit(0);
