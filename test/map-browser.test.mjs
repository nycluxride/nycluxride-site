import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
process.env.GOOGLE_MOCK = "true";
const api = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { priceDistance } = await api("_trip.mjs");
const { readRoute } = await api("_ticket.mjs");
const { AIRPORT_TOTALS } = await api("_rates.mjs");
const { REASONS } = await api("_copy.mjs");

const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "MAP_MOCK", "GOOGLE_MAPS_JS", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "FLIGHT_API_KEY", "PLACE_TICKET_SECRET", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT"];
const nyDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 864e5));
const DATE = nyDate(3);
const RDATE = nyDate(6);
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const BEDFORD = [40.714224, -73.961452];
const EDITION = [40.741389, -73.987193];
const JFK_T4 = [40.644166, -73.782425];
const MAP_REQ = /\/assets\/map\.|\/__maps-mock|maps\.googleapis\.com|maps\.gstatic\.com/;

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function serve(env) {
  const port = await freePort();
  const clean = { ...process.env };
  for (const k of ENV_KEYS) delete clean[k];
  const child = spawn(process.execPath, [join(ROOT, "scripts", "serve.mjs"), String(port)], { cwd: ROOT, env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${base}/robots.txt`)).ok) return { base, child, log: () => log };
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error(`dev server did not start\n${log}`);
}

const BASE_ENV = { BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" };
const M = await serve({ ...BASE_ENV, MAP_MOCK: "true" });
const A = await serve({ ...BASE_ENV, MAP_MOCK: "auth" });
const LD = await serve({ ...BASE_ENV, MAP_MOCK: "load" });
process.on("exit", () => [M, A, LD].forEach((s) => s.child.kill()));

const SPY = () => {
  window.__cls = 0;
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__cls += e.value;
      window.__shifts.push(e.sources.map((s) => (s.node && (s.node.id || s.node.className || s.node.nodeName)) || "?").join(","));
    }
  }).observe({ type: "layout-shift", buffered: true });
};

let failures = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function check(name, fn) {
  const DEBUG = process.env.DEBUG;
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
    if (DEBUG) console.error(err.stack);
  }
}

const ENGINES = [["chromium", await chromium.launch()]];
for (const [name, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (b) ENGINES.push([name, b]);
  else console.log(`  ..   ${name} is not installed here, the cross engine checks run in Chromium only`);
}
const browser = ENGINES[0][1];

async function context(server, options = {}, b = browser) {
  const { engine, ...rest } = options;
  const o = { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", ...rest };
  if (engine === "firefox") delete o.isMobile;
  const ctx = await b.newContext(o);
  ctx.external = [];
  ctx.api = [];
  ctx.assets = [];
  await ctx.route((url) => !url.href.startsWith(server.base), (route) => {
    ctx.external.push(route.request().url());
    route.fulfill({ status: 204, body: "" });
  });
  ctx.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(`${server.base}/api/`)) ctx.api.push({ path: u.slice(server.base.length + 5), body: r.postData() || "" });
    if (MAP_REQ.test(u)) ctx.assets.push(u);
  });
  if (o.javaScriptEnabled !== false) await ctx.addInitScript(SPY);
  return ctx;
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function open(ctx, server, path) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to (load resource|preconnect)/.test(m.text()) && page.errors.push(m.text()));
  await page.goto(`${server.base}${path}`, { waitUntil: "load" });
  return page;
}

async function type(page, end, text) {
  await page.fill(`#bk-${end}`, "");
  await page.click(`#bk-${end}`);
  await page.keyboard.type(text);
}
async function place(page, end, text, label) {
  await type(page, end, text);
  await page.locator(`#bk-${end}-list [role=option][aria-label="${label}"], #bk-${end}-list [role=option][aria-label="${label.replace(/^(.*? \(\w+\)), (.+)$/, "$2, $1")}"], #bk-${end}-list [role=option]:has-text("${label}")`).first().click();
}
const ticket = (page, end) => page.waitForFunction((e) => /^v1\./.test(document.getElementById(`bk-${e}-ticket`).value), end);
const live = (page) => page.waitForFunction(() => document.getElementById("book-form").classList.contains("bk--live"), null, { timeout: 8000 });
async function start(page) {
  await page.click("#bk-from");
  await live(page);
}
async function routeOf(page, from, to) {
  await place(page, "from", ...from);
  if (from[0] === "edition" || from[0] === "bedford") await ticket(page, "from");
  await place(page, "to", ...to);
  if (to[0] === "edition" || to[0] === "bedford") await ticket(page, "to");
}
const EDITION_ROW = ["edition", "The New York EDITION"];
const BEDFORD_ROW = ["bedford", "277 Bedford Avenue"];
const JFK_ROW = ["jfk t4", "John F. Kennedy (JFK), Terminal 4"];
const drawn = (page, n = 1) => page.waitForFunction((k) => window.__gmock && __gmock.lines().filter((l) => l.color === "#0F1319").length >= k && __gmock.lines().every((l) => l.points > 1), n, { timeout: 6000 });
const pins = (page) => page.evaluate(() => __gmock.overlays().filter((o) => /bk-pin/.test(o.className)).map((o) => ({ c: o.className.replace("bk-pin ", ""), hidden: o.hidden, lat: +o.lat.toFixed(4), lng: +o.lng.toFixed(4) })));
const near = (a, [lat, lng]) => Math.abs(a.lat - lat) < 0.002 && Math.abs(a.lng - lng) < 0.002;
const routes = (ctx) => ctx.api.filter((x) => x.path === "route");
const settle = (page, ms = 600) => page.waitForTimeout(ms);
const cls = (page) => page.evaluate(() => [window.__cls, window.__shifts]);
async function view(page) {
  await page.click("#bk-view");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && !document.getElementById("bk-wait").textContent.startsWith("Finding") && /\d/.test(document.getElementById("bk-p-suv").textContent));
}
async function showMap(page) {
  await page.evaluate(() => document.getElementById("bk-live").scrollIntoView({ block: "center", behavior: "instant" }));
  await settle(page, 150);
}
async function frame(page, lat, lng, zoom) {
  await page.evaluate(([a, b, z]) => (__gmock.map.setZoom(z), __gmock.map.setCenter({ lat: a, lng: b })), [lat, lng, zoom]);
  await showMap(page);
}
const px = (page, [lat, lng]) => page.evaluate(([a, b]) => __gmock.px(a, b), [lat, lng]);
const bar = (page) => page.evaluate(() => { const b = document.querySelector(".bk-mc"); return { hidden: b.hidden, label: b.getAttribute("aria-label"), text: b.querySelector(".bk-mc__a").textContent, use: b.querySelector(".bk-mc__u").textContent, off: b.querySelector(".bk-mc__u").getAttribute("aria-disabled") }; });
const addressIs = (page, re, sel = ".bk-mc .bk-mc__a") => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).textContent), [sel, re.source], { timeout: 5000 });

for (const path of ["/", "/book", "/locations/jfk-airport"]) {
  await check(`M1 ${path}: no map code, request or element before the rider touches the form, then map.js, map.css and the map library load once at the first focus`, async () => {
    const ctx = await context(M);
    const p = await open(ctx, M, path);
    await settle(p, 1200);
    assert.deepEqual(ctx.assets, [], "nothing before interaction");
    assert.equal(await p.evaluate(() => !!document.querySelector("#bk-live, #bk-mp, .bk-mapd, script[src*='__maps-mock']")), false);
    await start(p);
    await settle(p, 300);
    const names = ctx.assets.map((u) => new URL(u).pathname.replace(/\.[A-Za-z0-9_-]+\.(js|css)$/, ".$1"));
    assert.deepEqual(names.sort(), ["/__maps-mock.js", "/assets/map.css", "/assets/map.js"]);
    assert.equal(await p.evaluate(() => document.querySelectorAll('link[rel=preconnect][href="https://maps.googleapis.com"]').length), 1);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

for (const path of ["/services", "/locations/manhattan"]) {
  await check(`M1 ${path}: the compact bar that hands the trip on to /book loads no map code, request or element before the rider touches it, then map.js, map.css and the map library once at the first focus like the full forms, also when the rider types at once`, async () => {
    const ctx = await context(M);
    const p = await open(ctx, M, path);
    await settle(p, 1200);
    assert.deepEqual(ctx.assets, [], "nothing before interaction");
    assert.equal(await p.evaluate(() => !!document.querySelector("#bk-live, #bk-mp, .bk-mapd, script[src*='__maps-mock']")), false);
    await p.click("#bk-from");
    await p.keyboard.type("edition");
    await live(p);
    await settle(p, 300);
    const names = ctx.assets.map((u) => new URL(u).pathname.replace(/\.[A-Za-z0-9_-]+\.(js|css)$/, ".$1"));
    assert.deepEqual(names.sort(), ["/__maps-mock.js", "/assets/map.css", "/assets/map.js"]);
    assert.equal(await p.evaluate(() => document.querySelectorAll('link[rel=preconnect][href="https://maps.googleapis.com"]').length), 1);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M2 M3 M12 one map for the whole page view: pins appear at the picked places, a local row is located once, one route is drawn and the caption shows its miles and minutes, nothing moves", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.waitForFunction(() => __gmock.overlays().some((o) => /bk-pin--a/.test(o.className)));
  assert.ok(near((await pins(p)).find((x) => x.c === "bk-pin--a"), EDITION), JSON.stringify(await pins(p)));
  assert.equal(await p.textContent(".bk-mp__c"), "Click the map to set the drop-off.");
  await place(p, "to", ...JFK_ROW);
  await drawn(p);
  await settle(p);
  const located = ctx.api.filter((x) => x.path === "places" && /"locate"/.test(x.body));
  assert.equal(located.length, 1, "locate runs once for the local row");
  assert.ok(near((await pins(p)).find((x) => x.c === "bk-pin--b"), JFK_T4), JSON.stringify(await pins(p)));
  assert.equal(routes(ctx).length, 1);
  assert.equal(await p.textContent(".bk-mp__c"), "16.8 miles, about 43 min by car.");
  const [main] = (await p.evaluate(() => __gmock.lines())).filter((l) => l.color === "#0F1319");
  assert.ok(main.points > 1 && main.weight === 4 && main.z === 2, JSON.stringify(main));
  await view(p);
  await p.click("#bk-next");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
  await p.click("#bk-back");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
  await p.click("#bk-edit");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
  assert.equal(await p.evaluate(() => document.getElementById("bk-live").parentNode.id), "bk-mp");
  await view(p);
  assert.equal(await p.evaluate(() => __gmock.maps), 1, "one map instance");
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const [from, to, tenths, minutes, note] of [[EDITION_ROW, BEDFORD_ROW, 46, 27, "4.6 miles, about 27 min by car."], [["350 5th Ave, New York, NY 10118"], ["Greenwich, CT 06830"], 314, 52, "31.4 miles, about 52 min by car."]]) {
  await check(`M4 ${from[0]} to ${to[0]}: the priced route is the drawn route, the note reads ${note} with no Traffic estimate, the options request carries the token and no map size, no second route request`, async () => {
    const ctx = await context(M);
    const p = await open(ctx, M, "/book");
    await start(p);
    if (from.length > 1) await routeOf(p, from, to);
    else {
      await type(p, "from", from[0]);
      await p.locator("#bk-from-list [data-kind=typed]").click();
      await type(p, "to", to[0]);
      await p.locator("#bk-to-list [data-kind=typed]").click();
    }
    await drawn(p);
    await settle(p);
    const [r] = routes(ctx);
    assert.ok(r && JSON.parse(r.body).draw === 1);
    await view(p);
    await settle(p);
    const opt = ctx.api.find((x) => x.path === "book" && JSON.parse(x.body).action === "options");
    const body = JSON.parse(opt.body);
    assert.equal(body.map, undefined, "no static map size");
    assert.equal(body.draw, "1");
    const rides = [...readRoute(body.route, Date.now()).values()];
    assert.deepEqual(rides.map((x) => [x.tenths, x.minutes]), [[tenths, minutes]]);
    assert.equal(routes(ctx).length, 1, "no second route request");
    const n = await p.evaluate(() => ({ text: document.getElementById("bk-route-n").textContent, seen: document.getElementById("bk-route-n").innerText.trim(), attr: getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility }));
    assert.equal(n.text, `${note} Google Maps`);
    assert.equal(n.attr, "hidden", "the map logo is on screen");
    assert.ok(!/traffic estimate/i.test(await p.evaluate(() => document.body.innerText)));
    assert.equal(await p.evaluate(() => document.getElementById("bk-p-suv").querySelector(".bk-fig").textContent), cash(priceDistance("suv", { tenths, minutes }).total));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M5 an airport trip keeps the flat rate: the JFK cards and lines show, the route is drawn and the vehicle step asks for no second route", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, JFK_ROW, EDITION_ROW);
  await drawn(p);
  await settle(p);
  await view(p);
  await settle(p);
  const cards = await p.$$eval(".bk-card__price", (o) => o.map((x) => (x.querySelector(".bk-fig") || x).textContent));
  assert.deepEqual(cards.slice(0, 4), ["suv", "premium", "first", "sedan"].map((c) => cash(AIRPORT_TOTALS[c].jfk)));
  assert.ok(await p.evaluate(() => [...document.querySelectorAll("#price-lines th")].some((t) => t.textContent === "Tolls and airport fees")));
  assert.equal(routes(ctx).length, 1, "the vehicle step reuses the drawn route");
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bk-live")).display), "block");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const [name, b] of ENGINES) {
  await check(`M6 ${name} 1440 click to choose: the caption asks for the drop-off, a click at Bedford looks up the street address, Use this drop-off fills the field with a ticket and moves on, one route, and beside the side map the note drops Google Maps`, async () => {
    const ctx = await context(M, { engine: name }, b);
    const p = await open(ctx, M, "/book");
    await start(p);
    await place(p, "from", ...EDITION_ROW);
    await ticket(p, "from");
    await settle(p, 300);
    assert.equal(await p.textContent(".bk-mp__c"), "Click the map to set the drop-off.");
    await p.keyboard.press("Escape");
    await frame(p, 40.728, -73.975, 12);
    const at = await px(p, BEDFORD);
    await p.mouse.click(at.x, at.y);
    const b0 = await bar(p);
    assert.deepEqual([b0.hidden, b0.label, b0.use, b0.off], [false, "Choose the drop-off", "Use this drop-off", "true"]);
    await addressIs(p, /Finding the address…|Bedford/);
    await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/);
    assert.equal((await bar(p)).off, null);
    assert.ok((await bar(p)).text.includes("Brooklyn"));
    await p.click(".bk-mc__u");
    await drawn(p);
    await settle(p);
    const state = await p.evaluate(() => [document.getElementById("bk-to").value, document.getElementById("bk-to-ticket").value.slice(0, 3), document.getElementById("bk-to-id").value, document.getElementById("bk-status").textContent, document.activeElement.id]);
    assert.deepEqual(state, ["277 Bedford Ave, Brooklyn, NY 11211", "v1.", "", "Drop-off set to 277 Bedford Ave, Brooklyn, NY 11211.", "bk-date-btn"]);
    assert.equal(routes(ctx).length, 1);
    assert.equal(await p.textContent(".bk-mp__c"), "4.6 miles, about 27 min by car.");
    assert.ok((await pins(p)).every((x) => !x.hidden));
    await view(p);
    await p.waitForFunction(() => getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility === "hidden", null, { timeout: 4000 });
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M7 drag to adjust: dragging the pickup pin opens the choice at the drop point, Cancel puts the pin and the field back, a second drag commits with one new route", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await drawn(p);
  await settle(p);
  await p.evaluate(() => document.activeElement.blur());
  await frame(p, 40.70, -73.88, 11);
  const drag = async (to) => {
    const a = (await pins(p)).find((x) => x.c === "bk-pin--a");
    const s = await px(p, [a.lat, a.lng]), t = await px(p, to);
    await p.mouse.move(s.x, s.y);
    await p.mouse.down();
    await p.mouse.move(s.x + 8, s.y + 8, { steps: 2 });
    await p.mouse.move(t.x, t.y, { steps: 8 });
    await p.mouse.up();
  };
  await drag(JFK_T4);
  assert.deepEqual([(await bar(p)).hidden, (await bar(p)).label], [false, "Choose the pickup"]);
  await addressIs(p, /JFK Terminal 4/);
  await p.click(".bk-mc__c");
  assert.equal((await bar(p)).hidden, true);
  assert.equal(await p.inputValue("#bk-from"), "The New York EDITION, Madison Avenue, New York, NY");
  assert.ok(near((await pins(p)).find((x) => x.c === "bk-pin--a"), EDITION));
  const before = routes(ctx).length;
  await drag(JFK_T4);
  await addressIs(p, /JFK Terminal 4/);
  await p.click(".bk-mc__u");
  await p.waitForFunction(() => document.getElementById("bk-from").value.startsWith("JFK Terminal 4"));
  await settle(p, 1000);
  assert.equal(routes(ctx).length - before, 1, "one new route after the debounce");
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bk-flight-f")).display !== "none"), true, "an airport pickup shows the flight field");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M8 keyboard: Choose on the map is the last row, Enter moves focus into the map, the arrows pan, Enter puts the pin in the middle, Tab reaches Use this drop-off, Escape cancels back to the field", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.click("#bk-to");
  await p.keyboard.type("bedf");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=google]"));
  const rows = await p.$$eval("#bk-to-list [role=option]", (o) => o.map((x) => x.dataset.kind));
  assert.equal(rows[rows.length - 1], "map");
  assert.equal(await p.textContent("#bk-to-list [data-kind=map]"), "Choose on the map");
  for (let i = 0; i < rows.length; i++) await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  assert.deepEqual(await p.evaluate(() => [document.activeElement.getAttribute("role"), document.activeElement.getAttribute("aria-label")]), ["region", "Map"]);
  const c0 = await p.evaluate(() => __gmock.map.getCenter().toJSON());
  await p.keyboard.press("ArrowLeft");
  const c1 = await p.evaluate(() => __gmock.map.getCenter().toJSON());
  assert.ok(c1.lng < c0.lng, "the arrow pans the map");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".bk-live__x")).display), "block", "the crosshair shows while the map has focus");
  await p.evaluate(([a, b]) => __gmock.map.setCenter({ lat: a, lng: b }), BEDFORD);
  await p.keyboard.press("Enter");
  await addressIs(p, /277 Bedford Ave/);
  for (let i = 0; i < 12 && !(await p.evaluate(() => document.activeElement.classList.contains("bk-mc__u"))); i++) await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => document.activeElement.textContent), "Use this drop-off");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.getElementById("bk-to").value === "277 Bedford Ave, Brooklyn, NY 11211");
  assert.equal(await p.evaluate(() => document.activeElement.id), "bk-date-btn");
  await type(p, "to", "bedford x");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=google]") && document.querySelector("#bk-to-list [data-kind=map]"));
  await p.keyboard.press("Enter");
  assert.equal(await p.evaluate(() => document.querySelector(".bk-mc").hidden), true, "Enter with no row highlighted never opens the map");
  await type(p, "to", "bedford y");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=map]"));
  await p.keyboard.press("ArrowUp");
  assert.equal(await p.evaluate(() => document.getElementById(document.getElementById("bk-to").getAttribute("aria-activedescendant")).dataset.kind), "map");
  await p.keyboard.press("Enter");
  assert.equal((await bar(p)).hidden, false);
  await p.keyboard.press("Escape");
  assert.deepEqual(await p.evaluate(() => [document.querySelector(".bk-mc").hidden, document.activeElement.id, document.getElementById("bk-book-form") === null]), [true, "bk-to", true]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M8 keyboard as the first map action: Choose on the map from an empty pickup opens the map with focus inside it and Enter places the pin", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await type(p, "from", "bedf");
  await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("role") === "region");
  assert.deepEqual([(await bar(p)).hidden, (await bar(p)).label], [false, "Choose the pickup"]);
  await p.evaluate(([a, b]) => __gmock.map.setCenter({ lat: a, lng: b }), BEDFORD);
  await p.keyboard.press("Enter");
  await addressIs(p, /277 Bedford Ave/);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const [name, b] of ENGINES) {
  await check(`M9 ${name} 390 phone: Choose on the map opens the full screen dialog, a tap moves the pin, Use this pickup commits and the same map is back in the panel, a tap on the inline map opens the dialog for the drop-off`, async () => {
    const ctx = await context(M, { ...PHONE, engine: name }, b);
    const p = await open(ctx, M, "/book");
    await start(p);
    await type(p, "from", "bedf");
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
    await p.locator("#bk-from-list [data-kind=map]").click();
    await p.waitForFunction(() => document.querySelector(".bk-mapd").open);
    const d = await p.evaluate(() => { const g = document.querySelector(".bk-mapd"), r = g.getBoundingClientRect(); return [g.querySelector("h2").textContent, document.activeElement.tagName, getComputedStyle(g).display, Math.round(r.height) === innerHeight, !!g.querySelector("#bk-live"), getComputedStyle(document.documentElement).overflow]; });
    assert.deepEqual(d, ["Choose the pickup", "H2", "grid", true, true, "hidden"]);
    await p.evaluate(([a, b2]) => (__gmock.map.setZoom(13), __gmock.map.setCenter({ lat: a, lng: b2 })), [40.728, -73.975]);
    const t = await px(p, BEDFORD);
    await p.touchscreen.tap(t.x, t.y);
    await addressIs(p, /277 Bedford Ave/, ".bk-mapd .bk-mc__a");
    assert.equal(await p.textContent(".bk-mapd__s p"), "Tap the map or drag the pin.");
    await p.locator(".bk-mapd .bk-mc__u").tap();
    await p.waitForFunction(() => !document.querySelector(".bk-mapd").open);
    const s = await p.evaluate(() => [document.getElementById("bk-from").value, document.activeElement.id, document.getElementById("bk-live").parentNode.id, __gmock.maps]);
    assert.deepEqual(s, ["277 Bedford Ave, Brooklyn, NY 11211", "bk-to", "bk-mp", 1]);
    await p.keyboard.press("Escape");
    await p.evaluate(() => document.activeElement.blur());
    await frame(p, 40.728, -73.975, 12);
    const e = await px(p, EDITION);
    await p.touchscreen.tap(e.x, e.y);
    await p.waitForFunction(() => document.querySelector(".bk-mapd").open);
    assert.equal(await p.textContent(".bk-mapd h2"), "Choose the drop-off");
    await addressIs(p, /Madison Ave/, ".bk-mapd .bk-mc__a");
    await p.locator(".bk-mapd__x").tap();
    await p.waitForFunction(() => !document.querySelector(".bk-mapd").open);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-to").value, document.getElementById("bk-live").parentNode.id]), ["", "bk-mp"]);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M10 attribution: no Google Maps text beside the visible map logo, the text again when the map is off screen or hidden, Places in the popup group and the popup's Google attribution kept for place suggestions, also beside the visible map", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await drawn(p);
  await view(p);
  await settle(p);
  const vis = () => p.evaluate(() => getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility);
  assert.equal(await vis(), "hidden");
  await p.click("#bk-next");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
  await settle(p, 300);
  assert.equal(await vis(), "visible", "the details step hides the map");
  await p.click("#bk-edit").catch(() => p.click("#bk-check-edit"));
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
  await p.evaluate(() => document.getElementById("bk-mp").scrollIntoView({ block: "end", behavior: "instant" }));
  await type(p, "to", "bedford");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=google]"));
  await settle(p, 200);
  const pop = await p.evaluate(() => {
    const a = document.querySelector("#bk-to-pop .bk-attr"), r = document.getElementById("bk-live").getBoundingClientRect(), e = document.elementFromPoint(r.left + 36, r.bottom - 14);
    return [document.getElementById("bk-to-g2").textContent, a && a.textContent, a && a.getAttribute("translate"), a && getComputedStyle(a).visibility, document.getElementById("bk-live").contains(e)];
  });
  assert.deepEqual(pop, ["Places", "Google Maps", "no", "visible", true], "the map logo is in view and uncovered, the suggestions keep their attribution");
  await ctx.close();
  const phone = await context(M, PHONE);
  const q = await open(phone, M, "/book");
  await start(q);
  await routeOf(q, EDITION_ROW, BEDFORD_ROW);
  await drawn(q);
  await q.evaluate(() => document.getElementById("bk-mp").scrollIntoView({ block: "end", behavior: "instant" }));
  await type(q, "to", "bedford");
  await q.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=google]"));
  await settle(q, 200);
  assert.equal(await q.evaluate(() => { const a = document.querySelector("#bk-to-pop .bk-attr"); return a && a.getAttribute("translate"); }), "no", "the popup keeps its attribution on a phone");
  await q.locator("#bk-to-list [data-kind=google]").first().click();
  await ticket(q, "to");
  await view(q);
  await q.evaluate(() => scrollTo(0, 0));
  await settle(q, 300);
  assert.equal(await q.evaluate(() => getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility), "visible", "the map is below the fold on a phone");
  await q.evaluate(() => document.getElementById("bk-live").scrollIntoView({ block: "center", behavior: "instant" }));
  await settle(q, 300);
  assert.equal(await q.evaluate(() => getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility), "hidden");
  await phone.close();
});

for (const width of [390, 1440]) {
  await check(`M11 at ${width}: in the live flow every route list time sits on one line and the dots of a list share one x`, async () => {
    const ctx = await context(M, width < 768 ? PHONE : {});
    const p = await open(ctx, M, "/book");
    await start(p);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await drawn(p);
    await view(p);
    await p.waitForFunction(() => /About/.test(document.getElementById("bk-route").textContent));
    const r = await p.evaluate(() => {
      const list = document.getElementById("bk-route");
      const times = [...list.querySelectorAll(".bk-route__t")].filter((t) => t.textContent).map((t) => { const range = document.createRange(); range.selectNodeContents(t); return range.getClientRects().length; });
      const xs = [...list.children].map((li) => { const s = getComputedStyle(li, "::before"); return Math.round(li.getBoundingClientRect().left + parseFloat(s.left)); });
      return { times, xs };
    });
    assert.ok(r.times.every((n) => n === 1), JSON.stringify(r));
    assert.equal(new Set(r.xs).size, 1, JSON.stringify(r));
    await ctx.close();
  });
}

for (const motion of ["reduce", "no-preference"]) {
  await check(`M13 ${motion}: the route ${motion === "reduce" ? "appears at once and pins have no animation" : "draws in steps"}`, async () => {
    const ctx = await context(M, { reducedMotion: motion });
    const p = await open(ctx, M, "/book");
    await start(p);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await drawn(p);
    await settle(p, 1100);
    const lines = await p.evaluate(() => __gmock.lines());
    const ink = lines.find((l) => l.color === "#0F1319");
    if (motion === "reduce") {
      assert.ok(lines.every((l) => l.sets <= 1), JSON.stringify(lines));
      assert.ok(await p.evaluate(() => [...document.querySelectorAll(".bk-pin")].every((e) => getComputedStyle(e, "::before").animationName === "none")));
    } else assert.ok(ink.sets > 10, JSON.stringify(ink));
    await ctx.close();
  });
}

await check("M14 forced colors: pins use system colors and the choose buttons keep a focus ring", async () => {
  const ctx = await context(M, { forcedColors: "active" });
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.keyboard.press("Escape");
  await frame(p, 40.728, -73.975, 12);
  const at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  await addressIs(p, /277 Bedford Ave/);
  const s = await p.evaluate(() => { const pin = document.querySelector(".bk-pin--a"); return getComputedStyle(pin, "::before").forcedColorAdjust; });
  assert.equal(s, "none");
  await p.focus(".bk-mc__u");
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none");
  await ctx.close();
});

for (const [server, mode] of [[A, "auth"], [LD, "load"]]) {
  await check(`M15 MAP_MOCK=${mode}: the map gives up quietly and the vehicle step shows the static map image as in the release`, async () => {
    const ctx = await context(server);
    const p = await open(ctx, server, "/book");
    await p.click("#bk-from");
    await settle(p, 1200);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await view(p);
    await p.waitForSelector("#bk-map img");
    const s = await p.evaluate(() => [!!document.getElementById("bk-live"), document.getElementById("book-form").classList.contains("bk--live"), sessionStorage.getItem("nlr-map-off"), document.getElementById("bk-route-n").textContent]);
    assert.deepEqual(s, [false, false, "1", "4.6 miles, about 27 min by car. Google Maps"]);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M16 JavaScript off: /book makes no map request", async () => {
  const ctx = await context(M, { javaScriptEnabled: false });
  const p = await open(ctx, M, "/book");
  await p.fill("#bk-from", "277 Bedford Ave, Brooklyn, NY 11211");
  await settle(p, 500);
  assert.deepEqual(ctx.assets, []);
  await ctx.close();
});

await check("M17 by the hour: only the pickup pin, no route request, the side map shows the pin", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await p.click("label[for=bk-hour]");
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.waitForFunction(() => __gmock.overlays().some((o) => /bk-pin--a/.test(o.className)));
  await settle(p, 800);
  assert.equal(routes(ctx).length, 0);
  assert.deepEqual((await pins(p)).map((x) => x.c), ["bk-pin--a"]);
  await view(p);
  await settle(p);
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bk-live")).display), "block");
  assert.equal(routes(ctx).length, 0);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M18 a stop: one line through three points, three pins, the dispatch quote stays and no token is signed", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.click("#bk-addstop");
  await place(p, "stop1", ...BEDFORD_ROW);
  await ticket(p, "stop1");
  await place(p, "to", ...JFK_ROW);
  await drawn(p);
  await settle(p);
  const ink = (await p.evaluate(() => __gmock.lines())).find((l) => l.color === "#0F1319");
  assert.ok(ink.points >= 3);
  assert.deepEqual((await pins(p)).map((x) => x.c).sort(), ["bk-pin--a", "bk-pin--b", "bk-pin--s"]);
  const r = routes(ctx).at(-1);
  assert.equal(JSON.parse(r.body).stops.length, 1);
  await p.click("#bk-view");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && document.getElementById("q-stop-leg").classList.contains("is-on"));
  await settle(p);
  const opt = ctx.api.filter((x) => x.path === "book").map((x) => JSON.parse(x.body)).find((b) => b.action === "options");
  assert.ok(!opt.route, "no token for a trip with a stop");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M19 restore: a reload on the vehicle step shows the static map until the rider acts, then the live map takes the same box and nothing moves", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await drawn(p);
  await view(p);
  await p.reload({ waitUntil: "load" });
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && /\d/.test(document.getElementById("bk-p-suv").textContent));
  await p.waitForSelector("#bk-map img");
  await settle(p, 800);
  const box = await p.evaluate(() => { const r = document.getElementById("bk-map").getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; });
  assert.equal(await p.evaluate(() => !!document.getElementById("bk-live")), false, "no live map before the rider acts");
  await p.click("label[for=bk-c-premium]");
  await live(p);
  await p.waitForFunction(() => window.__gmock && __gmock.lines().length > 1);
  const after = await p.evaluate(() => { const r = document.getElementById("bk-live").getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; });
  assert.deepEqual(after, box);
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M20 a late route answer never changes the priced trip: a new time with See vehicles at once sends no route request after the options request, a route answer that lands after the options answer leaves the token, and the next quote carries the token the options answer signed", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  const answers = [];
  p.on("response", (r) => r.url().endsWith("/api/book") && r.json().then((j) => answers.push(j), () => 0));
  const until = async (f, what) => {
    for (let i = 0; i < 80 && !f(); i++) await settle(p, 100);
    assert.ok(f(), what);
  };
  const when = (time, go) =>
    p.evaluate(([day, t, g]) => {
      const e = document.getElementById("bk-date"), s = document.getElementById("bk-time");
      e.value = day;
      e.dispatchEvent(new Event("change", { bubbles: true }));
      s.value = t;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      g && document.getElementById("bk-view").click();
    }, [DATE, time, go]);
  const sent = (action, time) => ctx.api.findIndex((x) => x.path === "book" && JSON.parse(x.body).action === action && JSON.parse(x.body).time === time);
  const atTime = (time) => routes(ctx).filter((x) => JSON.parse(x.body).time === time).length;
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await when("14:30");
  await until(() => atTime("14:30") === 1, "the route for 14:30");
  await drawn(p);
  await settle(p);
  await when("15:00", true);
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && /\d/.test(document.getElementById("bk-p-suv").textContent));
  await settle(p, 1200);
  assert.ok(sent("options", "15:00") >= 0, "the options request for 15:00");
  assert.deepEqual(ctx.api.slice(sent("options", "15:00")).filter((x) => x.path === "route"), [], "no route request after the options request");
  assert.equal(atTime("15:00"), 0, "the waiting route request is dropped");
  await p.click("#bk-edit");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
  let release;
  const gate = new Promise((r) => (release = r));
  await p.route("**/api/route", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await gate;
    await route.fulfill({ response: res, json: { ...body, minutes: body.minutes + 5, route: "late" } });
  });
  await when("15:30");
  await until(() => atTime("15:30") === 1, "the route request for 15:30 is on its way");
  const known = answers.length;
  await view(p);
  await until(() => answers.slice(known).some((a) => a.kind === "options"), "the options answer");
  const opt = answers.slice(known).find((a) => a.kind === "options");
  assert.ok(opt.route && opt.ride && opt.ride.minutes === 27, JSON.stringify(opt.ride));
  release();
  await settle(p, 1000);
  assert.equal(await p.textContent("#bk-route-n"), "4.6 miles, about 27 min by car. Google Maps");
  const n = ctx.api.length;
  await p.click("label[for=bk-c-premium]");
  await until(() => ctx.api.slice(n).some((x) => x.path === "book"), "the quote request");
  const quote = JSON.parse(ctx.api.slice(n).find((x) => x.path === "book").body);
  assert.equal(quote.route, opt.route, "the quote carries the token the options answer signed");
  await settle(p);
  assert.equal(await p.textContent("#bk-route-n"), "4.6 miles, about 27 min by car. Google Maps");
  await p.unroute("**/api/route");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const [w, h] of [[1440, 900], [1366, 768], [1280, 720], [1024, 768]]) {
  const short = h <= 786;
  await check(`M21 ${w}x${h}: ${short ? "a window under 787 px tall hides the side map on the vehicle step and the route note carries the Google Maps credit" : "the short side map on the vehicle step still frames the trip, zoom 10 or closer with both pins inside the map and apart"}`, async () => {
    const ctx = await context(M, { viewport: { width: w, height: h } });
    const p = await open(ctx, M, "/book");
    await start(p);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await drawn(p);
    await view(p);
    await settle(p);
    const m = await p.evaluate(() => { const r = document.getElementById("bk-live").getBoundingClientRect(); return { zoom: __gmock.map.getZoom(), box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown: getComputedStyle(document.getElementById("bk-live")).display, credit: getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility }; });
    if (short) assert.deepEqual([m.shown, m.credit], ["none", "visible"], JSON.stringify(m));
    else {
      const a = await px(p, EDITION), b = await px(p, BEDFORD);
      assert.equal(m.shown, "block");
      assert.ok(m.zoom >= 10, JSON.stringify(m));
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 24, JSON.stringify([a, b, m]));
      for (const q of [a, b]) assert.ok(q.x >= m.box[0] && q.x <= m.box[2] && q.y >= m.box[1] && q.y <= m.box[3], JSON.stringify([q, m]));
    }
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

for (const [w, h] of [[1366, 768], [1280, 720]]) {
  await check(`M22 ${w}x${h}: after a click on the map the address, Use this drop-off and Cancel are in view`, async () => {
    const ctx = await context(M, { viewport: { width: w, height: h } });
    const p = await open(ctx, M, "/book");
    await p.evaluate(() => document.getElementById("bk-from").scrollIntoView({ block: "center", behavior: "instant" }));
    await start(p);
    await place(p, "from", ...EDITION_ROW);
    await ticket(p, "from");
    await settle(p, 300);
    await p.keyboard.press("Escape");
    const c = await p.evaluate(() => { const r = document.getElementById("bk-live").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 + 30), y: Math.round(r.top + r.height / 2) }; });
    assert.ok(c.y < h - 10, JSON.stringify(c));
    await p.mouse.click(c.x, c.y);
    await addressIs(p, /EDITION|Madison/);
    await settle(p, 200);
    const r = await p.evaluate(() => [".bk-mc", ".bk-mc .bk-mc__a", ".bk-mc .bk-mc__u", ".bk-mc .bk-mc__c"].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(b.top), Math.round(b.bottom), b.top >= 0 && b.bottom <= innerHeight]; }));
    assert.ok(r.every((x) => x[3]), JSON.stringify(r));
    assert.equal((await bar(p)).use, "Use this drop-off");
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M23 desktop Choose on the map from the popup: the address line says Click the map or drag the pin. and Use waits, then a click finds the address", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await type(p, "to", "bedf");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=map]"));
  await p.locator("#bk-to-list [data-kind=map]").click();
  const b0 = await bar(p);
  assert.deepEqual([b0.hidden, b0.label, b0.text, b0.off], [false, "Choose the drop-off", "Click the map or drag the pin.", "true"]);
  await frame(p, 40.728, -73.975, 12);
  const at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  await addressIs(p, /277 Bedford Ave/);
  assert.equal((await bar(p)).off, null);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M24 a place typed and picked for the field being chosen ends the map choice: the bar closes, the typed place stays and its pin and route show", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.keyboard.press("Escape");
  await frame(p, 40.728, -73.975, 12);
  const at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  await addressIs(p, /277 Bedford Ave/);
  await place(p, "to", ...JFK_ROW);
  const picked = await p.inputValue("#bk-to");
  await drawn(p);
  await settle(p);
  assert.equal((await bar(p)).hidden, true, "the map choice ended");
  assert.equal(await p.inputValue("#bk-to"), picked);
  assert.ok(!/Bedford/.test(picked), picked);
  const all = await pins(p);
  assert.ok(near(all.find((x) => x.c === "bk-pin--b"), JFK_T4), JSON.stringify(all));
  assert.ok(all.every((x) => !/bk-pin--c/.test(x.c) && !x.hidden), JSON.stringify(all));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M25 the popup opened by the click that loads the map gains the Choose on the map row", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await p.click("#bk-from");
  await live(p);
  await p.waitForFunction(() => !document.getElementById("bk-from-pop").hidden && document.querySelector("#bk-from-list [data-kind=map]"), null, { timeout: 4000 });
  assert.equal(await p.evaluate(() => document.activeElement.id), "bk-from");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const fails of [false, true]) {
  await check(`M26 restore with a slow route answer: the static image stays until the route comes back, ${fails ? "and a map failure meanwhile keeps the static image for good" : "then the live map shows the drawn route in the same box with nothing moving"}`, async () => {
    const ctx = await context(M);
    const p = await open(ctx, M, "/book");
    await start(p);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await drawn(p);
    await view(p);
    await p.route("**/api/route", async (r) => {
      await new Promise((z) => setTimeout(z, 900));
      await r.continue();
    });
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && /\d/.test(document.getElementById("bk-p-suv").textContent));
    await p.waitForSelector("#bk-map img");
    await settle(p, 800);
    const rect = (id) => p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; }, id);
    const box = await rect("bk-map");
    await p.evaluate(() => {
      window.__blank = 0;
      const f = () => {
        const l = document.getElementById("bk-live");
        l && l.isConnected && !l.hidden && getComputedStyle(l).display !== "none" && !(window.__gmock && __gmock.lines().some((x) => x.points > 1)) && window.__blank++;
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await p.click("label[for=bk-c-premium]");
    await settle(p, 500);
    const still = () => p.evaluate(() => [document.getElementById("book-form").classList.contains("bk--live"), getComputedStyle(document.getElementById("bk-map")).display, !!document.querySelector("#bk-map img"), !!(document.getElementById("bk-live") && document.getElementById("bk-live").isConnected)]);
    assert.deepEqual(await still(), [false, "block", true, false], "the static image while the route is on its way");
    if (fails) {
      await p.evaluate(() => window.gm_authFailure());
      await settle(p, 1800);
      assert.deepEqual(await still(), [false, "block", true, false], "the static image after the failure");
      assert.equal(await p.evaluate(() => sessionStorage.getItem("nlr-map-off")), "1");
    } else {
      await live(p);
      await p.waitForFunction(() => window.__gmock && __gmock.lines().some((l) => l.color === "#0F1319" && l.points > 1));
      await settle(p, 300);
      assert.deepEqual(await rect("bk-live"), box);
      assert.equal(await p.evaluate(() => window.__blank), 0, "no frame shows the live map without the route");
    }
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    await p.unroute("**/api/route");
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M27 a New Jersey address to JFK: the caption reads 25.0 miles, about 45 min by car. as on a trip priced by distance and time, the options request carries that route token, no second route request, and the cards show the airport fare or the distance and time fare with no tolls line", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await type(p, "from", "Secaucus, NJ 07094");
  await p.locator("#bk-from-list [data-kind=typed]").click();
  await place(p, "to", "jfk", "John F. Kennedy (JFK)");
  await drawn(p);
  await settle(p);
  assert.equal(await p.textContent(".bk-mp__c"), "25.0 miles, about 45 min by car.");
  const [r] = routes(ctx);
  assert.ok(r && JSON.parse(r.body).draw === 1);
  await view(p);
  await settle(p);
  const body = JSON.parse(ctx.api.find((x) => x.path === "book" && JSON.parse(x.body).action === "options").body);
  assert.deepEqual([body.map, body.draw], [undefined, "1"]);
  assert.deepEqual([...readRoute(body.route, Date.now()).values()].map((x) => [x.tenths, x.minutes]), [[250, 45]]);
  assert.equal(routes(ctx).length, 1, "no second route request");
  const n = await p.evaluate(() => ({ text: document.getElementById("bk-route-n").textContent, attr: getComputedStyle(document.querySelector("#bk-route-n .bk-attr")).visibility }));
  assert.deepEqual([n.text, n.attr], ["25.0 miles, about 45 min by car. Google Maps", "hidden"]);
  const cards = await p.$$eval(".bk-card__price", (o) => o.map((x) => (x.querySelector(".bk-fig") || x).textContent));
  assert.deepEqual(cards, [...["suv", "premium", "first", "sedan"].map((c) => cash(priceDistance(c, { tenths: 250, minutes: 45 }, "jfk").total)), "Price on request"]);
  assert.deepEqual(cards.slice(0, 4), ["$182.53", "$221.97", "$297.25", "$157.25"]);
  assert.ok(!(await p.evaluate(() => [...document.querySelectorAll("#price-lines th")].some((t) => t.textContent === "Tolls and airport fees"))));
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

const visiblePins = (page) => page.evaluate(() => { const r = document.getElementById("bk-live").getBoundingClientRect(); return __gmock.overlays().filter((o) => /bk-pin--[ab]\b/.test(o.className) && !o.hidden).map((o) => { const b = o.node.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2; return { c: o.className.replace("bk-pin ", ""), lat: +o.lat.toFixed(4), lng: +o.lng.toFixed(4), inside: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom }; }); });
const inked = (page) => page.waitForFunction(() => window.__gmock && __gmock.lines().some((l) => l.color === "#0F1319" && l.points > 1), null, { timeout: 8000 });
const panelOf = (page) => page.evaluate(() => { const m = document.getElementById("bk-mp"); return !m || !m.isConnected ? "none" : m.hidden ? "hidden" : "shown"; });
const setTrip = (page, names, values) => page.evaluate(([n, v]) => { const f = document.getElementById("book-form").elements; n.forEach((k, i) => { f[k].value = v[i]; f[k].dispatchEvent(new Event("change", { bubbles: true })); }); }, [names, values]);

await check("M28 keyboard pick while the map loads: the empty pickup list starts with Use my current location, keeps the highlighted row when the map adds Choose on the map, and Enter picks that row", async () => {
  const ctx = await context(M);
  await ctx.route((u) => u.pathname === "/__maps-mock.js", async (r) => {
    await new Promise((z) => setTimeout(z, 2000));
    await r.continue();
  });
  const p = await open(ctx, M, "/book");
  await p.focus("#bk-from");
  await p.waitForFunction(() => !document.getElementById("bk-from-pop").hidden && document.querySelectorAll("#bk-from-list [role=option]").length === 5);
  assert.deepEqual(await p.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => [x.id, x.dataset.kind])), [["bk-from-o0", "here"], ["bk-from-o1", "local"], ["bk-from-o2", "local"], ["bk-from-o3", "local"], ["bk-from-o4", "local"]]);
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowDown");
  const lit = () => p.evaluate(() => { const i = document.getElementById("bk-from").getAttribute("aria-activedescendant"); return i && document.getElementById(i).textContent; });
  const before = await lit();
  assert.match(before, /LaGuardia/);
  assert.equal(await p.evaluate(() => document.getElementById("book-form").classList.contains("bk--live")), false, "the map is still loading");
  await live(p);
  await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
  assert.deepEqual(await p.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => x.dataset.kind)), ["here", "local", "local", "local", "local", "map"]);
  assert.equal(await lit(), before);
  await p.keyboard.press("Enter");
  assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id")], ["LaGuardia (LGA)", "lga"]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M29 an airport pickup leaves the empty drop-off with one row, Choose on the map, and ArrowDown then Enter opens that choice", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...JFK_ROW);
  await p.waitForFunction(() => document.activeElement.id === "bk-to");
  const list = () => p.evaluate(() => [document.getElementById("bk-to-pop").hidden, [...document.querySelectorAll("#bk-to-list [role=option]")].map((o) => o.dataset.kind), document.getElementById("bk-to").getAttribute("aria-expanded")]);
  assert.deepEqual(await list(), [false, ["map"], "true"]);
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  const b = await bar(p);
  assert.deepEqual([b.hidden, b.label], [false, "Choose the drop-off"]);
  assert.deepEqual(await p.evaluate(() => [document.activeElement.getAttribute("role"), document.getElementById("bk-to").value]), ["region", ""]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M30 Choose on the map ends when its stop is removed or the trip turns By the hour, and a drop-off choice stays open when a stop is removed", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.click("#bk-addstop");
  await p.evaluate(() => document.activeElement.blur());
  await frame(p, 40.728, -73.975, 12);
  const at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  assert.equal((await bar(p)).label, "Choose stop 1");
  await addressIs(p, /277 Bedford Ave/);
  await p.click("#bk-stop1-rm");
  assert.equal((await bar(p)).hidden, true, "removing the stop being chosen ends the choice");
  await p.click("#bk-addstop");
  await place(p, "stop1", ...BEDFORD_ROW);
  await ticket(p, "stop1");
  await type(p, "to", "bedf");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=map]"));
  await p.locator("#bk-to-list [data-kind=map]").click();
  assert.equal((await bar(p)).label, "Choose the drop-off");
  await p.click("#bk-stop1-rm");
  assert.equal((await bar(p)).hidden, false, "removing a stop keeps the drop-off choice");
  await p.click("label[for=bk-hour]");
  assert.equal((await bar(p)).hidden, true, "By the hour ends the drop-off choice");
  assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-stop1").value, document.getElementById("bk-to-ticket").value]), ["", ""]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const held of [false, true]) {
  await check(`M31 typed ends and Book at once: the vehicle step map shows the route with a pin at each end${held ? ", and when the answer carries no path the map asks for the route once" : " from the path in the answer, with no route request"}`, async () => {
    const ctx = await context(M);
    const p = await open(ctx, M, "/book");
    if (held) await p.route("**/api/book", async (r) => {
      const res = await r.fetch();
      const j = await res.json();
      if (j.ride) delete j.ride.path;
      await r.fulfill({ response: res, json: j });
    });
    await start(p);
    await type(p, "from", "350 5th Ave, New York, NY 10118");
    await p.locator("#bk-from-list [data-kind=typed]").click();
    await type(p, "to", "277 Bedford Ave, Brooklyn, NY 11211");
    await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=typed]"));
    await p.evaluate(async () => {
      document.querySelector("#bk-to-list [data-kind=typed]").click();
      await new Promise((z) => setTimeout(z, 30));
      document.getElementById("bk-view").click();
    });
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && /\d/.test(document.getElementById("bk-p-suv").textContent));
    await inked(p);
    await settle(p);
    const ends = await visiblePins(p);
    assert.deepEqual(ends.map((x) => x.c).sort(), ["bk-pin--a", "bk-pin--b"], JSON.stringify(ends));
    assert.ok(near(ends.find((x) => x.c === "bk-pin--a"), [40.748441, -73.985664]) && near(ends.find((x) => x.c === "bk-pin--b"), BEDFORD), JSON.stringify(ends));
    assert.equal(await p.evaluate(() => document.getElementById("bk-side").contains(document.getElementById("bk-live"))), true);
    const after = ctx.api.slice(ctx.api.findIndex((x) => x.path === "book" && JSON.parse(x.body).action === "options"));
    assert.equal(after.filter((x) => x.path === "route").length, held ? 1 : 0);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M32 a reload on the search step: the map for the restored trip opens with both pins, the route and the caption after one route request", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await drawn(p);
  await settle(p, 800);
  await p.reload({ waitUntil: "load" });
  await p.waitForFunction(() => document.getElementById("bk-to-ticket").value.startsWith("v1."));
  const n = ctx.api.length;
  await p.click("#bk-date-btn");
  await live(p);
  await settle(p, 300);
  await p.keyboard.press("Escape");
  await inked(p);
  await settle(p);
  const all = await pins(p);
  assert.ok(near(all.find((x) => x.c === "bk-pin--a"), EDITION) && near(all.find((x) => x.c === "bk-pin--b"), BEDFORD), JSON.stringify(all));
  assert.equal(await p.textContent(".bk-mp__c"), "4.6 miles, about 27 min by car.");
  assert.equal(ctx.api.slice(n).filter((x) => x.path === "route").length, 1);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const phone of [true, false]) {
  await check(`M33 ${phone ? "390 phone" : "1440 desktop"}: a long trip to Montauk fits, both pins inside the search map and the vehicle step map${phone ? "" : ", at zoom 8 or closer as before"}`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, "/book");
    await start(p);
    await place(p, "from", ...EDITION_ROW);
    await ticket(p, "from");
    await type(p, "to", "1 Ocean Rd, Montauk, NY 11954");
    await p.locator("#bk-to-list [data-kind=typed]").click();
    await drawn(p);
    await settle(p);
    for (const step of ["search", "options"]) {
      if (step === "options") {
        await view(p);
        await settle(p);
      }
      await p.evaluate(() => document.getElementById("bk-live").scrollIntoView({ block: "center", behavior: "instant" }));
      const ends = await visiblePins(p);
      assert.deepEqual(ends.map((x) => x.inside), [true, true], `${step} ${JSON.stringify(ends)} zoom ${await p.evaluate(() => __gmock.map.getZoom())}`);
      if (!phone) assert.ok((await p.evaluate(() => __gmock.map.getZoom())) >= 8);
    }
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M34 a round trip: the search map caption gives both legs in the vehicle step words, and at 320 px the caption keeps its height when Remove return lands late", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await drawn(p);
  await p.click("#bk-addret");
  await setTrip(p, ["return_date", "return_time"], [RDATE, "18:00"]);
  await p.waitForFunction(() => __gmock.lines().some((l) => l.color === "#6E6E73" && l.points > 1));
  await settle(p);
  assert.equal(await p.textContent(".bk-mp__c"), "4.6 miles, about 27 min by car. Return: 4.8 miles, about 31 min by car.");
  await view(p);
  assert.equal(await p.textContent("#bk-route-n"), "4.6 miles, about 27 min by car. Return: 4.8 miles, about 31 min by car. Google Maps");
  await ctx.close();
  const narrow = await context(M, { ...PHONE, viewport: { width: 320, height: 640 } });
  const q = await open(narrow, M, "/book");
  await start(q);
  await routeOf(q, EDITION_ROW, BEDFORD_ROW);
  await drawn(q);
  await q.click("#bk-addret");
  await setTrip(q, ["return_date", "return_time"], [RDATE, "18:00"]);
  await q.waitForFunction(() => /Return/.test(document.querySelector(".bk-mp__c").textContent));
  const k = routes(narrow).length;
  await setTrip(q, ["date", "time"], [DATE, "15:00"]);
  for (let i = 0; i < 80 && routes(narrow).length === k; i++) await settle(q, 100);
  await settle(q, 600);
  await q.waitForFunction(() => /Return/.test(document.querySelector(".bk-mp__c").textContent));
  await q.evaluate(() => document.querySelector(".bk-mp__c").scrollIntoView({ block: "center", behavior: "instant" }));
  await settle(q);
  const h = () => q.evaluate(() => Math.round(document.querySelector(".bk-mp__c").getBoundingClientRect().height));
  assert.equal(await h(), 68);
  await q.route("**/api/route", async (r) => {
    await new Promise((z) => setTimeout(z, 900));
    await r.continue();
  });
  const c0 = await q.evaluate(() => window.__cls);
  await q.click("#bk-rmret");
  await q.waitForFunction(() => !/Return/.test(document.querySelector(".bk-mp__c").textContent), null, { timeout: 8000 });
  await settle(q);
  assert.deepEqual([await h(), await q.evaluate((c) => +(window.__cls - c).toFixed(4), c0)], [68, 0]);
  await q.unroute("**/api/route");
  assert.deepEqual(q.errors, []);
  await narrow.close();
});

await check("M35 the map region describes the Enter key while Enter places a pin, keeps Google's own description, and drops the hint once every end is set and on the vehicle step", async () => {
  const ctx = await context(M);
  await ctx.addInitScript(() => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) n.nodeType === 1 && n.getAttribute("role") === "region" && !n.hasAttribute("aria-describedby") && n.setAttribute("aria-describedby", "gm-keys"); }).observe(document, { childList: true, subtree: true }));
  const p = await open(ctx, M, "/book");
  const desc = (want) => p.waitForFunction((w) => { const g = document.querySelector("#bk-live [role=region]"); return g && g.getAttribute("aria-describedby") === w; }, want, { timeout: 5000 });
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await desc("bk-mc-k gm-keys");
  assert.equal(await p.textContent("#bk-mc-k"), "Move the map with the arrow keys and press Enter to put the pin in the middle.");
  await place(p, "to", ...BEDFORD_ROW);
  await ticket(p, "to");
  await drawn(p);
  await desc("gm-keys");
  await type(p, "to", "bedford y");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=map]"));
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("role") === "region");
  await desc("bk-mc-k gm-keys");
  await p.keyboard.press("Escape");
  await place(p, "to", ...BEDFORD_ROW);
  await ticket(p, "to");
  await view(p);
  await desc("gm-keys");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M36 a time change and back redraws the cached route and the options request carries that route's token", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  const tokens = {};
  p.on("response", (r) => r.url().endsWith("/api/route") && r.json().then((j) => (tokens[JSON.parse(r.request().postData()).time] = j.route), () => 0));
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  const at = async (t) => {
    await setTrip(p, ["date", "time"], [DATE, t]);
    for (let i = 0; i < 80 && !tokens[t]; i++) await settle(p, 100);
    assert.ok(tokens[t], `route for ${t}`);
  };
  await at("14:30");
  await at("15:00");
  const n = routes(ctx).length;
  await setTrip(p, ["date", "time"], [DATE, "14:30"]);
  await settle(p, 1200);
  assert.equal(routes(ctx).length, n, "the cached route is reused");
  await view(p);
  const opt = JSON.parse(ctx.api.find((x) => x.path === "book" && JSON.parse(x.body).action === "options").body);
  assert.notEqual(tokens["14:30"], tokens["15:00"]);
  assert.equal(opt.route, tokens["14:30"]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M37 By the hour with a typed pickup shows no empty map, the panel comes back for a one way trip, and Choose on the map still opens it", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await p.click("label[for=bk-hour]");
  await type(p, "from", "350 5th Ave, New York, NY 10118");
  await p.locator("#bk-from-list [data-kind=typed]").click();
  await settle(p);
  assert.match(await panelOf(p), /^(none|hidden)$/);
  await ctx.close();
  const one = await context(M);
  const q = await open(one, M, "/book");
  await start(q);
  await type(q, "from", "350 5th Ave, New York, NY 10118");
  await q.locator("#bk-from-list [data-kind=typed]").click();
  await settle(q);
  assert.equal(await panelOf(q), "shown");
  await q.click("label[for=bk-hour]");
  await settle(q);
  assert.equal(await panelOf(q), "hidden");
  await q.click("label[for=bk-one]");
  await settle(q);
  assert.deepEqual([await panelOf(q), await q.textContent(".bk-mp__c")], ["shown", "Click the map to set the drop-off."]);
  await q.click("label[for=bk-hour]");
  await type(q, "from", "bedf");
  await q.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
  await q.locator("#bk-from-list [data-kind=map]").click();
  assert.deepEqual([await panelOf(q), (await bar(q)).label], ["shown", "Choose the pickup"]);
  const [value, shifts] = await cls(q);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(q.errors, []);
  await one.close();
});

await check("M38 an address answer from a cancelled map choice never lands in the next choice", async () => {
  const ctx = await context(M);
  let held = 0;
  await ctx.route((u) => u.pathname === "/api/places", async (r) => {
    if (!/"action":"here"/.test(r.request().postData() || "") || held++) return r.continue();
    const res = await r.fetch();
    const body = await res.text();
    await new Promise((z) => setTimeout(z, 1500));
    await r.fulfill({ response: res, body });
  });
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.activeElement.blur());
  await frame(p, 40.68, -73.87, 12);
  let at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  await settle(p, 450);
  await p.click(".bk-mc .bk-mc__c");
  at = await px(p, JFK_T4);
  await p.mouse.click(at.x, at.y);
  await addressIs(p, /JFK Terminal 4/);
  await settle(p, 1800);
  assert.equal(held, 2);
  const b = await bar(p);
  assert.ok(/JFK Terminal 4/.test(b.text) && b.off === null, JSON.stringify(b));
  const c = (await pins(p)).find((x) => /bk-pin--c/.test(x.c));
  assert.ok(near(c, JFK_T4), JSON.stringify(c));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M39 320 phone: a long place name with its area line fits the address line of the map sheet", async () => {
  const ctx = await context(M, { ...PHONE, viewport: { width: 320, height: 640 } });
  await ctx.route((u) => u.pathname === "/api/places", async (r) => {
    if (!/"action":"here"/.test(r.request().postData() || "")) return r.continue();
    const res = await r.fetch();
    const j = await res.json();
    await r.fulfill({ response: res, json: { ...j, label: "Long Island MacArthur Airport, 100 Arrival Ave, Ronkonkoma, NY 11779", area: "Outside New York City" } });
  });
  const p = await open(ctx, M, "/book");
  await start(p);
  await type(p, "from", "bedf");
  await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
  await p.locator("#bk-from-list [data-kind=map]").click();
  await p.waitForFunction(() => document.querySelector(".bk-mapd").open);
  await p.evaluate(([a, b]) => (__gmock.map.setZoom(13), __gmock.map.setCenter({ lat: a, lng: b })), [40.728, -73.975]);
  const t = await px(p, BEDFORD);
  await p.touchscreen.tap(t.x, t.y);
  await addressIs(p, /Outside New York City/, ".bk-mapd .bk-mc__a");
  const a = await p.evaluate(() => { const e = document.querySelector(".bk-mapd .bk-mc__a"); return { text: e.textContent, scroll: e.scrollHeight, box: e.clientHeight }; });
  assert.ok(a.text.split(" ").length > 8 && a.scroll <= a.box, JSON.stringify(a));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M40 the trip is framed again when the map box changes size: 1280 to 700 px wide keeps both pins inside", async () => {
  const ctx = await context(M, { viewport: { width: 1280, height: 800 } });
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, JFK_ROW);
  await drawn(p);
  await settle(p);
  await p.setViewportSize({ width: 700, height: 800 });
  await settle(p, 800);
  await p.evaluate(() => document.getElementById("bk-live").scrollIntoView({ block: "center", behavior: "instant" }));
  const ends = await visiblePins(p);
  assert.deepEqual(ends.map((x) => x.inside), [true, true], JSON.stringify(ends));
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M41 dragging a pin past the edge of the map stops it 16 px inside the map, and the address is looked up there", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await routeOf(p, EDITION_ROW, BEDFORD_ROW);
  await drawn(p);
  await settle(p);
  await p.evaluate(() => document.activeElement.blur());
  await showMap(p);
  const a = (await pins(p)).find((x) => x.c === "bk-pin--a");
  const s = await px(p, [a.lat, a.lng]);
  const box = await p.locator("#bk-live").boundingBox();
  const looked = [];
  p.on("request", (r) => r.url().endsWith("/api/places") && /"action":"here"/.test(r.postData() || "") && looked.push(JSON.parse(r.postData())));
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.mouse.move(s.x + 8, s.y - 8, { steps: 2 });
  await p.mouse.move(s.x, box.y - 400, { steps: 8 });
  await p.mouse.up();
  await settle(p, 800);
  const c = await p.evaluate(() => { const e = document.querySelector(".bk-pin--c").getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2]; });
  assert.ok(c[1] >= box.y + 14 && c[1] <= box.y + 19, JSON.stringify([c, box]));
  assert.equal(looked.length, 1);
  const top = await p.evaluate(() => __gmock.ll(0, document.getElementById("bk-live").getBoundingClientRect().top).lat);
  assert.ok(looked[0].lat < top, JSON.stringify([looked[0], top]));
  assert.equal((await bar(p)).label, "Choose the pickup");
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M42 Escape inside a Google map dialog keeps the map choice, and Escape on the map itself still cancels it", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.keyboard.press("Escape");
  await frame(p, 40.728, -73.975, 12);
  const at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  await addressIs(p, /277 Bedford Ave/);
  await p.evaluate(() => {
    const d = document.createElement("dialog");
    d.innerHTML = '<button type="button">Close</button>';
    document.querySelector("#bk-live .gm-style").append(d);
    d.show();
    d.querySelector("button").focus();
  });
  await p.keyboard.press("Escape");
  assert.equal((await bar(p)).hidden, false, "Escape inside the Google dialog keeps the choice");
  await p.focus("#bk-live [role=region]");
  await p.keyboard.press("Escape");
  assert.equal((await bar(p)).hidden, true);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M43 forced colors: the text of Use this drop-off is GrayText while no address is found, and the button text color once it can be used", async () => {
  const ctx = await context(M, { forcedColors: "active" });
  await ctx.route((u) => u.pathname === "/api/places", async (r) => {
    if (/"action":"here"/.test(r.request().postData() || "")) await new Promise((z) => setTimeout(z, 1200));
    await r.continue();
  });
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await p.keyboard.press("Escape");
  await frame(p, 40.728, -73.975, 12);
  const look = () => p.evaluate(() => { const u = document.querySelector(".bk-mc .bk-mc__u"); return [u.getAttribute("aria-disabled"), getComputedStyle(u).color]; });
  const at = await px(p, BEDFORD);
  await p.mouse.click(at.x, at.y);
  const off = await look();
  await addressIs(p, /277 Bedford Ave/);
  const on = await look();
  assert.equal(off[0], "true");
  assert.equal(on[0], null);
  const gray = await p.evaluate(() => { const s = document.createElement("span"); s.style.color = "GrayText"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; });
  assert.deepEqual([off[1], on[1] !== gray], [gray, true]);
  await ctx.close();
});

await check("M44 a failed pin lookup is tried again: By the hour, after an error answer a new pick of the same place shows its pin", async () => {
  const ctx = await context(M);
  let n = 0;
  await ctx.route((u) => u.pathname === "/api/places", async (r) => {
    if (!/"action":"locate"/.test(r.request().postData() || "")) return r.continue();
    if (n++) return r.continue();
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "error" }) });
  });
  const p = await open(ctx, M, "/book");
  await start(p);
  await p.click("label[for=bk-hour]");
  await place(p, "from", ...JFK_ROW);
  await settle(p, 800);
  assert.deepEqual([n, (await pins(p)).length], [1, 0]);
  await place(p, "from", ...JFK_ROW);
  await p.waitForFunction(() => __gmock.overlays().some((o) => /bk-pin--a/.test(o.className)), null, { timeout: 5000 });
  assert.equal(n, 2);
  assert.ok(near((await pins(p)).find((x) => x.c === "bk-pin--a"), JFK_T4));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const phone of [false, true]) {
  await check(`M45 ${phone ? "390 phone" : "1440"}: when Google rejects the map after the search map is shown, the map box stays in place hidden until the next step, nothing moves, and the vehicle step shows the static map`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, "/book");
    await start(p);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await drawn(p);
    await p.click("h1");
    await settle(p, 1500);
    const c0 = await p.evaluate(() => window.__cls);
    await p.evaluate(() => window.gm_authFailure());
    await settle(p, 1200);
    const r = await p.evaluate((c) => { const m = document.getElementById("bk-mp"); return [+(window.__cls - c).toFixed(4), m && m.isConnected ? getComputedStyle(m).visibility : "gone"]; }, c0);
    assert.deepEqual(r, [0, "hidden"]);
    await p.click("#bk-view");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && /\d/.test(document.getElementById("bk-p-suv").textContent));
    await p.waitForSelector("#bk-map img");
    assert.deepEqual(await p.evaluate(() => [!!document.getElementById("bk-mp"), !!document.getElementById("bk-live"), sessionStorage.getItem("nlr-map-off")]), [false, false, "1"]);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M46 when the map fails, Choose on the map leaves the open list and the other rows stay, Use my current location first", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await p.click("#bk-from");
  await live(p);
  await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
  await p.evaluate(() => window.gm_authFailure());
  await settle(p, 300);
  const rows = await p.evaluate(() => [document.getElementById("bk-from-pop").hidden, [...document.querySelectorAll("#bk-from-list [role=option]")].map((o) => o.dataset.kind)]);
  assert.deepEqual(rows, [false, ["here", "local", "local", "local", "local"]]);
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Enter");
  assert.deepEqual([await p.inputValue("#bk-from-id"), await p.evaluate(() => document.activeElement.id)], ["teb", "bk-to"]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const phone of [true, false]) {
  await check(`M47 ${phone ? "390 phone" : "1440 desktop"}: the owner's long trip with no end in New York City, 806 6th Street, Secaucus, NJ to Niagara Falls, NY 14303, is framed on the trip itself with both pins inside the search map and the vehicle step map, the caption reads 400.0 miles, about 420 min by car., the cards show the distance and time prices with the Luxury Sprinter on Price on request, and nothing moves`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, "/book");
    await start(p);
    await type(p, "from", "806 6th Street, Secaucus, NJ");
    await p.locator("#bk-from-list [data-kind=typed]").click();
    await type(p, "to", "Niagara Falls, NY 14303");
    await p.locator("#bk-to-list [data-kind=typed]").click();
    await drawn(p);
    await settle(p);
    assert.equal(await p.textContent(".bk-mp__c"), "400.0 miles, about 420 min by car.");
    for (const step of ["search", "options"]) {
      if (step === "options") {
        await view(p);
        await settle(p);
      }
      await p.evaluate(() => document.getElementById("bk-live").scrollIntoView({ block: "center", behavior: "instant" }));
      const ends = await visiblePins(p);
      const at = await p.evaluate(() => ({ zoom: __gmock.map.getZoom(), center: __gmock.map.getCenter().toJSON() }));
      assert.deepEqual(ends.map((x) => x.inside), [true, true], `${step} ${JSON.stringify(ends)} ${JSON.stringify(at)}`);
      assert.ok(Math.abs(at.center.lng - (-74.06184 + -79.05671) / 2) < 0.05 && at.center.lat > 40.78825 && at.center.lat < 43.09447, `${step} the map is centered on the trip, ${JSON.stringify(at)}`);
      assert.ok(at.zoom >= 3 && at.zoom <= 8, `${step} ${JSON.stringify(at)}`);
    }
    const body = JSON.parse(ctx.api.find((x) => x.path === "book" && JSON.parse(x.body).action === "options").body);
    assert.deepEqual([...readRoute(body.route, Date.now()).values()].map((x) => [x.tenths, x.minutes]), [[4000, 420]]);
    assert.equal(routes(ctx).length, 1, "no second route request");
    const cards = await p.$$eval(".bk-card__price", (o) => o.map((x) => (x.querySelector(".bk-fig") || x).textContent));
    assert.deepEqual(cards, [...["suv", "premium", "first", "sedan"].map((c) => cash(priceDistance(c, { tenths: 4000, minutes: 420 }).total)), "Price on request"]);
    assert.deepEqual(cards.slice(0, 4), ["$2,120.27", "$2,534.76", "$2,814.79", "$1,594.65"]);
    await p.waitForTimeout(300);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

const FAR = "Choose on the map works in the United States. Type the address for a place outside it.";
const BOSTON = [42.3601, -71.0589];
const ATLANTIC = [38.5, -60];
const BOSTON_LABEL = "4 S Market St, Boston, MA 02109";
await check("M48 1440 desktop: a click on the map in Boston, outside New York City, looks up the street address there and Use this drop-off fills the field with a ticket, while a click outside the United States says that Choose on the map works in the United States and to type the address, with no lookup, and Use this drop-off stays off", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await type(p, "to", "bedf");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=map]"));
  await p.locator("#bk-to-list [data-kind=map]").click();
  await frame(p, ATLANTIC[0], ATLANTIC[1], 8);
  const sea = await px(p, ATLANTIC);
  await p.mouse.click(sea.x, sea.y);
  await addressIs(p, new RegExp(FAR.replace(/\./g, "\\.")));
  const b0 = await bar(p);
  assert.deepEqual([b0.hidden, b0.label, b0.text, b0.use, b0.off], [false, "Choose the drop-off", FAR, "Use this drop-off", "true"]);
  const here = () => ctx.api.filter((x) => x.path === "places" && JSON.parse(x.body).action === "here");
  assert.equal(here().length, 1);
  await frame(p, BOSTON[0], BOSTON[1], 12);
  const center = await p.evaluate(() => __gmock.map.getCenter().toJSON());
  assert.ok(Math.abs(center.lat - BOSTON[0]) < 0.01 && Math.abs(center.lng - BOSTON[1]) < 0.01, `the map can show Boston while choosing, ${JSON.stringify(center)}`);
  const at = await px(p, BOSTON);
  await p.mouse.click(at.x, at.y);
  await addressIs(p, /4 S Market St, Boston, MA 02109/);
  const b1 = await bar(p);
  assert.deepEqual([b1.text, b1.use, b1.off, here().length], [`${BOSTON_LABEL} Outside New York City`, "Use this drop-off", null, 2]);
  await p.click(".bk-mc .bk-mc__u");
  await p.waitForFunction((l) => document.getElementById("bk-to").value === l, BOSTON_LABEL);
  assert.match(await p.inputValue("#bk-to-ticket"), /^v1\./);
  assert.equal((await bar(p)).hidden, true);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});
await check("M48 390 phone: a tap on the map sheet in Boston looks up the street address there, and a tap outside the United States says that Choose on the map works in the United States and to type the address, and Use this drop-off stays off", async () => {
  const ctx = await context(M, PHONE);
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await type(p, "to", "bedf");
  await p.waitForFunction(() => document.querySelector("#bk-to-list [data-kind=map]"));
  await p.locator("#bk-to-list [data-kind=map]").click();
  await p.waitForFunction(() => document.querySelector(".bk-mapd").open);
  await p.evaluate(([a, b2]) => (__gmock.map.setZoom(8), __gmock.map.setCenter({ lat: a, lng: b2 })), ATLANTIC);
  const t = await px(p, ATLANTIC);
  await p.touchscreen.tap(t.x, t.y);
  await addressIs(p, new RegExp(FAR.replace(/\./g, "\\.")), ".bk-mapd .bk-mc__a");
  assert.equal(await p.getAttribute(".bk-mapd .bk-mc__u", "aria-disabled"), "true");
  await p.evaluate(([a, b2]) => (__gmock.map.setZoom(12), __gmock.map.setCenter({ lat: a, lng: b2 })), BOSTON);
  const u = await px(p, BOSTON);
  await p.touchscreen.tap(u.x, u.y);
  await addressIs(p, /4 S Market St, Boston, MA 02109/, ".bk-mapd .bk-mc__a");
  assert.equal(await p.getAttribute(".bk-mapd .bk-mc__u", "aria-disabled"), null);
  await p.locator(".bk-mapd .bk-mc__u").tap();
  await p.waitForFunction((l) => document.getElementById("bk-to").value === l && !document.querySelector(".bk-mapd").open, BOSTON_LABEL);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

const HOBOKEN = [40.743991, -74.032363];
const GARDEN = [40.744712, -74.031862];
const GARDEN_LABEL = "300 Garden St, Hoboken, NJ 07030";
const CONFIRM = "Move the pin to the exact pickup spot";
const chooser = (page, phone) => page.evaluate((ph) => {
  const root = ph ? document.querySelector(".bk-mapd") : document.querySelector(".bk-mc"), cap = document.querySelector(".bk-mp__c"), u = root.querySelector(".bk-mc__u"), a = document.activeElement;
  return { open: ph ? root.open : !root.hidden, name: ph ? document.getElementById(root.getAttribute("aria-labelledby")).textContent : root.getAttribute("aria-label"), caption: ph ? "" : cap.hidden ? null : cap.textContent, use: u.textContent, off: u.getAttribute("aria-disabled"), address: root.querySelector(".bk-mc__a").textContent, live: root.querySelector(".bk-mc__a").getAttribute("aria-live"), focus: a.getAttribute("role") || a.tagName, hint: (a.getAttribute("aria-describedby") || "").split(" ").includes("bk-mc-k"), center: __gmock.map.getCenter().toJSON(), zoom: __gmock.map.getZoom() };
}, phone);
const at = (a, [lat, lng], d = 1e-4) => Math.abs(a.lat - lat) < d && Math.abs(a.lng - lng) < d;
const KEYS_HINT = "Move the map with the arrow keys and press Enter to put the pin in the middle.";
const described = (page) => page.evaluate(() => { const g = document.querySelector("#bk-live [role=region]"); return (g.getAttribute("aria-describedby") || "").split(" ").filter(Boolean).map((id) => document.getElementById(id).textContent); });
for (const [name, b] of ENGINES) {
  for (const phone of name === "chromium" ? [false, true] : [true]) {
    await check(`M49 ${name} ${phone ? "390 phone" : "1440 desktop"}: a picked city as the pickup opens Choose on the map at once, centered on the city with the pin in the middle, the caption Move the pin to the exact pickup spot and Use this pickup, the street address there is looked up, one tap uses it and the trip is priced, with focus and screen reader text right and nothing moving`, async () => {
      const ctx = await context(M, phone ? { ...PHONE, engine: name } : {}, b);
      const p = await open(ctx, M, "/book");
      await start(p);
      await type(p, "from", "hoboken");
      await p.waitForSelector("#bk-from-list [data-kind=google]");
      const pick = p.locator("#bk-from-list [data-kind=google]").first();
      phone ? await pick.tap() : await pick.click();
      await p.waitForFunction((ph) => (ph ? document.querySelector(".bk-mapd").open : !document.querySelector(".bk-mc").hidden), phone);
      const first = await chooser(p, phone);
      assert.deepEqual([first.open, first.name, first.caption, first.use, first.live], [true, CONFIRM, phone ? "" : `${CONFIRM}.`, "Use this pickup", "polite"]);
      assert.deepEqual(phone ? [first.focus] : [first.focus, first.hint], phone ? ["H2"] : ["region", true]);
      if (!phone) assert.deepEqual(await described(p), [`${CONFIRM}.`, KEYS_HINT], "the map region that takes focus says why");
      await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a");
      const ready = await chooser(p, phone);
      assert.deepEqual([ready.address, ready.off, ready.zoom, at(ready.center, HOBOKEN)], [`${GARDEN_LABEL} Outside New York City`, null, 16, true], JSON.stringify(ready));
      const pin = (await pins(p)).find((x) => /bk-pin--c/.test(x.c));
      assert.ok(pin && !pin.hidden && near(pin, GARDEN), JSON.stringify(await pins(p)));
      const here = ctx.api.filter((x) => x.path === "places" && JSON.parse(x.body).action === "here");
      assert.deepEqual(here.map((x) => [JSON.parse(x.body).lat, JSON.parse(x.body).lng]), [HOBOKEN], "the lookup is at the city's center");
      const use = p.locator(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
      phone ? await use.tap() : await use.click();
      await p.waitForFunction((l) => document.getElementById("bk-from").value === l, GARDEN_LABEL);
      assert.deepEqual([await p.inputValue("#bk-from-ticket").then((t) => t.slice(0, 3)), await p.textContent("#bk-status"), (await chooser(p, phone)).open], ["v1.", `Pickup set to ${GARDEN_LABEL}.`, false]);
      assert.ok(!(await described(p)).includes(`${CONFIRM}.`), "the reason leaves the map region with the chooser");
      await place(p, "to", ...BEDFORD_ROW);
      await ticket(p, "to");
      await view(p);
      assert.equal(await p.isVisible("#q-pickup-address"), false);
      const cards = await p.$$eval(".bk-card__price .bk-fig", (o) => o.map((x) => x.textContent));
      assert.ok(cards.slice(0, 4).every((c) => /^\$\d/.test(c)), cards.join(" | "));
      const options = JSON.parse(ctx.api.filter((x) => x.path === "book").map((x) => x.body).find((x) => JSON.parse(x).action === "options"));
      assert.equal(options.from_text, GARDEN_LABEL);
      const [value, shifts] = await cls(p);
      assert.equal(value, 0, shifts.join(" | "));
      assert.deepEqual(p.errors, []);
      await ctx.close();
    });
  }
}

await check("M50 a picked neighborhood or borough as the pickup also asks to confirm the pin, Cancel keeps the pick and goes back to the field, a hotel and an airport do not ask, a picked city drop-off on a one way trip opens nothing, and on a round trip a picked city drop-off asks for the exact return pickup", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  await start(p);
  for (const [text, label, address] of [["williamsburg", "Williamsburg", /277 Bedford Ave, Brooklyn, NY 11211/], ["the bronx", "The Bronx", /2344 Arthur Ave, Bronx, NY 10458/]]) {
    await type(p, "from", text);
    await p.waitForSelector("#bk-from-list [data-kind=google]");
    await p.locator("#bk-from-list [data-kind=google]").first().click();
    await addressIs(p, address);
    const c = await chooser(p, false);
    assert.deepEqual([c.open, c.name, c.caption, c.use], [true, CONFIRM, `${CONFIRM}.`, "Use this pickup"], label);
    await p.click(".bk-mc .bk-mc__c");
    assert.deepEqual([(await chooser(p, false)).open, await p.inputValue("#bk-from"), await p.evaluate(() => document.activeElement.id)], [false, `${label}, ${label === "Williamsburg" ? "Brooklyn, NY" : "Bronx, NY"}`, "bk-from"], label);
  }
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  assert.equal((await chooser(p, false)).open, false, "a hotel is an exact spot");
  await place(p, "from", ...JFK_ROW);
  assert.equal((await chooser(p, false)).open, false, "an airport is an exact spot");
  await type(p, "to", "hoboken");
  await p.waitForSelector("#bk-to-list [data-kind=google]");
  await p.locator("#bk-to-list [data-kind=google]").first().click();
  await ticket(p, "to");
  await settle(p, 300);
  assert.equal((await chooser(p, false)).open, false, "a city drop-off on a one way trip needs no exact spot");
  await p.click("#bk-addret");
  await type(p, "to", "hoboken");
  await p.waitForSelector("#bk-to-list [data-kind=google]");
  await p.locator("#bk-to-list [data-kind=google]").first().click();
  await addressIs(p, /300 Garden St, Hoboken, NJ 07030/);
  const r = await chooser(p, false);
  assert.deepEqual([r.open, r.name, r.caption, r.use], [true, "Move the pin to the exact return pickup spot", "Move the pin to the exact return pickup spot.", "Use this drop-off"]);
  await p.click(".bk-mc .bk-mc__u");
  await p.waitForFunction((l) => document.getElementById("bk-to").value === l, GARDEN_LABEL);
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

const BEDFORD_LABEL = "277 Bedford Ave, Brooklyn, NY 11211";
const LOCATED = { geolocation: { latitude: BEDFORD[0], longitude: BEDFORD[1] }, permissions: ["geolocation"] };
const geoRows = (page) => page.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => [x.dataset.kind, x.textContent]));
const GEO_SPY = () => {
  window.__geo = [];
  const g = navigator.geolocation;
  if (!g) return;
  for (const name of ["getCurrentPosition", "watchPosition"]) {
    const real = g[name].bind(g);
    g[name] = (ok, fail, options) => (window.__geo.push([name, options]), real(ok, fail, options));
  }
};
for (const phone of [false, true]) {
  await check(`M51 ${phone ? "390 phone" : "1440 desktop"} current location, permission granted: Use my current location is the first row of the empty pickup list, the browser asks for the position only after the tap, once and for a precise fix, the position turns into its street address with a ticket and moves on, the map shows the pickup pin, and nothing moves`, async () => {
    const ctx = await context(M, { ...(phone ? PHONE : {}), ...LOCATED });
    await ctx.addInitScript(GEO_SPY);
    const p = await open(ctx, M, "/book");
    await start(p);
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]"));
    assert.deepEqual(await p.evaluate(() => window.__geo), [], "no position is asked for before the tap");
    const rows = await geoRows(p);
    assert.deepEqual(rows[0], ["here", "Use my current location"]);
    assert.equal(await p.getAttribute("#bk-from-list [data-kind=here]", "id"), "bk-from-o0");
    assert.equal(await p.evaluate(() => document.querySelector("#bk-from-list [data-kind=here]").closest("[role=group]").getAttribute("aria-label")), "Your location");
    const row = p.locator("#bk-from-list [data-kind=here]");
    phone ? await row.tap() : await row.click();
    await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
    assert.deepEqual(await p.evaluate(() => window.__geo), [["getCurrentPosition", { timeout: 10000, enableHighAccuracy: true }]]);
    assert.deepEqual([await p.inputValue("#bk-from-ticket").then((t) => t.slice(0, 3)), await p.textContent("#bk-status"), await p.evaluate(() => document.activeElement.id)], ["v1.", `Pickup set to ${BEDFORD_LABEL}.`, "bk-to"]);
    const here = ctx.api.filter((x) => x.path === "places" && JSON.parse(x.body).action === "here").map((x) => JSON.parse(x.body));
    assert.deepEqual(here.map((x) => [x.lat, x.lng]), [BEDFORD]);
    await p.waitForFunction(() => __gmock.overlays().some((o) => /bk-pin--a/.test(o.className) && !o.hidden));
    assert.ok(near((await pins(p)).find((x) => x.c === "bk-pin--a"), BEDFORD), JSON.stringify(await pins(p)));
    assert.equal(ctx.api.filter((x) => x.path === "places" && /"locate"/.test(x.body)).length, 0, "the position needs no second lookup for its pin");
    await place(p, "to", ...EDITION_ROW);
    await ticket(p, "to");
    await view(p);
    assert.equal(await p.isVisible("#q-pickup-address"), false);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M52 current location, permission denied, position unavailable, a timeout, a spot outside the United States, a browser with no geolocation: the row says what happened in the open list and the status, the pickup stays empty, and the row shows only in an empty pickup list", async () => {
  const DENIED = "Location access is off. Type the address.";
  const MISSED = "We couldn't find your location. Type the address.";
  const cases = [
    ["denied", {}, null, DENIED],
    ["unavailable", LOCATED, () => (navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 2, message: "unavailable" }), 50)), MISSED],
    ["timeout", LOCATED, () => (navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 3, message: "timeout" }), 50)), MISSED],
    ["outside the United States", { geolocation: { latitude: 51.5072, longitude: -0.1276 }, permissions: ["geolocation"] }, null, "Your location is outside the United States. Type the address."],
  ];
  for (const [label, options, init, text] of cases) {
    const ctx = await context(M, options);
    if (init) await ctx.addInitScript(init);
    const p = await open(ctx, M, "/book");
    await start(p);
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]"));
    await p.locator("#bk-from-list [data-kind=here]").click();
    await p.waitForFunction((t) => document.querySelector("#bk-from-list [data-kind=here] .bk-opt__main")?.textContent === t, text);
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-ticket"), await p.textContent("#bk-status"), await p.isVisible("#bk-from-pop"), await p.evaluate(() => document.activeElement.id)], ["", "", text, true, "bk-from"], label);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, `${label} ${shifts.join(" | ")}`);
    assert.deepEqual(p.errors, [], label);
    await ctx.close();
  }
  const ctx = await context(M, LOCATED);
  await ctx.addInitScript(() => delete Object.getPrototypeOf(navigator).geolocation);
  const p = await open(ctx, M, "/book");
  await start(p);
  await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
  assert.equal(await p.$("#bk-from-list [data-kind=here]"), null, "no row without geolocation");
  await ctx.close();
  const qx = await context(M, LOCATED);
  const q = await open(qx, M, "/book");
  await start(q);
  await q.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]"));
  await q.keyboard.press("Enter");
  const asked = () => qx.api.filter((x) => x.path === "places" && JSON.parse(x.body).action === "here").length;
  assert.deepEqual([await q.inputValue("#bk-from-id"), asked()], ["jfk", 0], "Enter with no highlighted row picks the first airport as before and never asks for the location");
  await type(q, "from", "bedf");
  await q.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=google]"));
  assert.equal(await q.$("#bk-from-list [data-kind=here]"), null, "typed text hides the row");
  await place(q, "from", ...EDITION_ROW);
  await q.click("#bk-to");
  await q.waitForFunction(() => !document.getElementById("bk-to-pop").hidden);
  assert.equal(await q.$("#bk-to-list [data-kind=here]"), null, "the drop-off list has no row");
  await q.fill("#bk-from", "");
  await q.click("#bk-from");
  await q.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]"));
  await q.keyboard.press("ArrowDown");
  assert.equal(await q.evaluate(() => document.getElementById(document.getElementById("bk-from").getAttribute("aria-activedescendant")).dataset.kind), "here");
  await q.keyboard.press("Enter");
  await q.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
  assert.equal(asked(), 1);
  assert.deepEqual(q.errors, []);
  await qx.close();
});

const chooserOpen = (page, phone, open = true) => page.waitForFunction(([ph, o]) => (ph ? document.querySelector(".bk-mapd").open : !document.querySelector(".bk-mc").hidden) === o, [phone, open]);
const priceShown = (page) => page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && !document.getElementById("bk-wait").textContent.startsWith("Finding") && /\d/.test(document.getElementById("bk-p-suv").textContent));
for (const [phone, typedTo, path = "/book"] of [[false, true], [false, false], [true, true], [true, false], [false, false, "/"]]) {
  await check(`M53 ${phone ? "390 phone" : "1440 desktop"}${path === "/" ? " on the home page" : ""} typed but not picked with the map, ${typedTo ? "both ends typed" : "a typed pickup and a picked drop-off"}: Book your ride uses the first suggestion of a typed city that clearly matches, the city pickup opens Choose on the map at once and the trip waits on the search step with no price request, and one tap on Use this pickup goes on to the prices with no second press, one options request and the picked labels in the trip summary`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, path);
    const tap = (sel) => (phone ? p.locator(sel).tap() : p.click(sel));
    await start(p);
    await type(p, "from", "hoboken");
    await p.waitForSelector("#bk-from-list [data-kind=google]");
    await p.keyboard.press("Escape");
    if (typedTo) {
      await type(p, "to", "277 Bedford");
      await p.waitForSelector("#bk-to-list [data-kind=google]");
      await p.keyboard.press("Escape");
    } else {
      await place(p, "to", ...BEDFORD_ROW);
      await ticket(p, "to");
    }
    const options = () => ctx.api.filter((x) => x.path === "book").map((x) => JSON.parse(x.body)).filter((x) => x.action === "options");
    await tap("#bk-view");
    await chooserOpen(p, phone);
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-to"), await p.getAttribute("#book-form", "data-step"), (await chooser(p, phone)).name], ["Hoboken, NJ", "277 Bedford Avenue, Brooklyn, NY", "search", CONFIRM]);
    await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a");
    await ticket(p, "to");
    assert.equal(options().length, 0, "no price request while the pin waits");
    await tap(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
    if (path !== "/book") await p.waitForURL(/\/book#options$/);
    await priceShown(p);
    assert.deepEqual([await p.inputValue("#bk-from"), (await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.isVisible("#q-pickup-address"), path === "/book" && (await chooser(p, phone)).open, await p.evaluate(() => document.activeElement.id)], [GARDEN_LABEL, "v1.", false, false, "bk-opt-h"]);
    assert.deepEqual(options().map((x) => [x.from_text, x.to_text, x.from_ticket.slice(0, 3), x.to_ticket.slice(0, 3)]), [[GARDEN_LABEL, "277 Bedford Avenue, Brooklyn, NY", "v1.", "v1."]], "one options request after the tap");
    const cards = await p.$$eval(".bk-card__price .bk-fig", (o) => o.map((x) => x.textContent));
    assert.ok(cards.slice(0, 4).every((c) => /^\$\d/.test(c)), cards.join(" | "));
    const chip = await p.textContent("#bk-sum .bk-chip");
    assert.ok(chip.includes("300 Garden St") && chip.includes("277 Bedford Avenue"), chip);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

for (const phone of [false, true]) {
  await check(`M54 ${phone ? "390 phone" : "1440 desktop"}: when the pin that Book your ride asked for is closed without a choice, the picked city stays, Book your ride then asks for the pickup street address with the map text alone in the quote, no price and the pickup line in the bar, and a later Choose on the map for the pickup moves on as before and waits for Book your ride to price the trip`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, "/book");
    const tap = (sel) => (phone ? p.locator(sel).tap() : p.click(sel));
    const address = phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a";
    const books = () => ctx.api.filter((x) => x.path === "book" && JSON.parse(x.body).action === "options").length;
    await start(p);
    await type(p, "from", "hoboken");
    await p.waitForSelector("#bk-from-list [data-kind=google]");
    await p.keyboard.press("Escape");
    await place(p, "to", ...EDITION_ROW);
    await ticket(p, "to");
    await tap("#bk-view");
    await chooserOpen(p, phone);
    await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, address);
    await tap(phone ? ".bk-mapd__x" : ".bk-mc .bk-mc__c");
    await chooserOpen(p, phone, false);
    await settle(p, 300);
    assert.deepEqual([await p.inputValue("#bk-from"), (await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.getAttribute("#book-form", "data-step"), books()], ["Hoboken, NJ", "v1.", "search", 0]);
    await tap("#bk-view");
    await p.waitForSelector("#q-pickup-address", { state: "visible" });
    await settle(p, 600);
    const shown = await p.evaluate(() => [...document.querySelectorAll("#quote .bk-q")].filter((e) => e.getClientRects().length).map((e) => [e.id, e.querySelector("p").textContent]));
    assert.deepEqual([shown, await p.isHidden("#price"), await p.textContent("#bk-bar-q")], [[["q-pickup-address", REASONS["pickup-address"].map]], true, "Add the pickup street address to see the price"]);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await tap("#bk-edit");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
    const sent = books();
    await type(p, "from", "hobo");
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
    await tap("#bk-from-list [data-kind=map]");
    await chooserOpen(p, phone);
    assert.equal((await chooser(p, phone)).name, "Choose the pickup");
    if (phone) await p.evaluate(([a, b]) => (__gmock.map.setZoom(16), __gmock.map.setCenter({ lat: a, lng: b })), GARDEN);
    else await frame(p, GARDEN[0], GARDEN[1], 16);
    const spot = await px(p, GARDEN);
    phone ? await p.touchscreen.tap(spot.x, spot.y) : await p.mouse.click(spot.x, spot.y);
    await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, address);
    await tap(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
    await p.waitForFunction((l) => document.getElementById("bk-from").value === l, GARDEN_LABEL);
    await settle(p, 600);
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), books()], ["search", sent], "a map choice of its own waits for Book your ride");
    await view(p);
    assert.equal(await p.isVisible("#q-pickup-address"), false);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M55 a slow pick answer never moves a spot the customer already chose: the chooser says Finding the place… until the place is found, a click on the map sets the spot, and the late answer leaves the map, the pin and the address there", async () => {
  const ctx = await context(M);
  await ctx.route((u) => u.pathname === "/api/places", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    if (body.action === "pick" && body.id === "mock-hoboken") await new Promise((z) => setTimeout(z, 2500));
    await r.continue();
  });
  const p = await open(ctx, M, "/book");
  await start(p);
  await type(p, "from", "hoboken");
  await p.waitForSelector("#bk-from-list [data-kind=google]");
  await p.locator("#bk-from-list [data-kind=google]").first().click();
  await chooserOpen(p, false);
  const wait = await chooser(p, false);
  assert.deepEqual([wait.name, wait.address, wait.off], [CONFIRM, "Finding the place…", "true"]);
  await frame(p, BEDFORD[0], BEDFORD[1], 16);
  const spot = await px(p, BEDFORD);
  await p.mouse.click(spot.x, spot.y);
  await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/);
  await ticket(p, "from");
  await settle(p, 400);
  const after = await chooser(p, false);
  assert.deepEqual([after.open, after.address, after.zoom, at(after.center, BEDFORD)], [true, `${BEDFORD_LABEL} Brooklyn`, 16, true], JSON.stringify(after));
  assert.ok(near((await pins(p)).find((x) => /bk-pin--c/.test(x.c)), BEDFORD), JSON.stringify(await pins(p)));
  await p.click(".bk-mc .bk-mc__u");
  await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

const RETURN_PIN = "Move the pin to the exact return pickup spot";
for (const phone of [false, true]) {
  await check(`M56 ${phone ? "390 phone" : "1440 desktop"}: a round trip whose pickup and drop-off are both typed towns, Book your ride confirms the pickup pin and then the return pickup pin, and the price follows the second tap with one options request and both street addresses`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, "/book");
    const tap = (sel) => (phone ? p.locator(sel).tap() : p.click(sel));
    const address = phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a";
    const options = () => ctx.api.filter((x) => x.path === "book").map((x) => JSON.parse(x.body)).filter((x) => x.action === "options");
    await start(p);
    await type(p, "from", "hoboken");
    await p.waitForSelector("#bk-from-list [data-kind=google]");
    await p.keyboard.press("Escape");
    await type(p, "to", "williamsburg");
    await p.waitForSelector("#bk-to-list [data-kind=google]");
    await p.keyboard.press("Escape");
    await tap("#bk-addret");
    await setTrip(p, ["return_date", "return_time"], [RDATE, "18:00"]);
    await tap("#bk-view");
    await chooserOpen(p, phone);
    assert.equal((await chooser(p, phone)).name, CONFIRM);
    await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, address);
    await tap(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
    await p.waitForFunction((l) => document.getElementById("bk-from").value === l, GARDEN_LABEL);
    await chooserOpen(p, phone);
    await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/, address);
    const second = await chooser(p, phone);
    assert.deepEqual([second.name, second.use, second.zoom, await p.getAttribute("#book-form", "data-step"), options().length], [RETURN_PIN, "Use this drop-off", 16, "search", 0]);
    await tap(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
    await priceShown(p);
    assert.deepEqual([await p.isVisible("#q-return-address"), await p.isVisible("#q-pickup-address"), (await chooser(p, phone)).open], [false, false, false]);
    assert.deepEqual(options().map((x) => [x.from_text, x.to_text, x.from_ticket.slice(0, 3), x.to_ticket.slice(0, 3), x.return]), [[GARDEN_LABEL, BEDFORD_LABEL, "v1.", "v1.", "1"]], "one options request after the second tap");
    const cards = await p.$$eval(".bk-card__price .bk-fig", (o) => o.map((x) => x.textContent));
    assert.ok(cards.slice(0, 4).every((c) => /^\$\d/.test(c)), cards.join(" | "));
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M57 an end that turns into one that must be exact after its pick: a picked city drop-off after Add the return trip, and a picked city drop-off swapped to the pickup, opens Choose on the map at Book your ride and one tap goes on to the prices, while Cancel there leaves the next Book your ride with the request", async () => {
  const ctx = await context(M);
  const city = async (page) => {
    await type(page, "to", "hoboken");
    await page.waitForSelector("#bk-to-list [data-kind=google]");
    await page.locator("#bk-to-list [data-kind=google]").first().click();
    await ticket(page, "to");
    await settle(page, 300);
    assert.equal((await chooser(page, false)).open, false, "a one way city drop-off needs no pin");
  };
  const p = await open(ctx, M, "/book");
  await start(p);
  await place(p, "from", ...EDITION_ROW);
  await ticket(p, "from");
  await city(p);
  await p.click("#bk-addret");
  await setTrip(p, ["return_date", "return_time"], [RDATE, "18:00"]);
  await p.click("#bk-view");
  await chooserOpen(p, false);
  await addressIs(p, /300 Garden St, Hoboken, NJ 07030/);
  const back = await chooser(p, false);
  assert.deepEqual([back.name, back.caption, back.use, back.zoom, at(back.center, HOBOKEN), await p.getAttribute("#book-form", "data-step")], [RETURN_PIN, `${RETURN_PIN}.`, "Use this drop-off", 16, true, "search"]);
  await p.click(".bk-mc .bk-mc__u");
  await priceShown(p);
  assert.deepEqual([await p.inputValue("#bk-to"), await p.isVisible("#q-return-address")], [GARDEN_LABEL, false]);
  await ctx.close();
  const qx = await context(M);
  const q = await open(qx, M, "/book");
  const books = () => qx.api.filter((x) => x.path === "book" && JSON.parse(x.body).action === "options").length;
  await start(q);
  await place(q, "from", ...EDITION_ROW);
  await ticket(q, "from");
  await city(q);
  await q.click(".bk-swap");
  await q.click("#bk-view");
  await chooserOpen(q, false);
  await addressIs(q, /300 Garden St, Hoboken, NJ 07030/);
  assert.deepEqual([(await chooser(q, false)).name, await q.inputValue("#bk-from")], [CONFIRM, "Hoboken, NJ"]);
  await q.click(".bk-mc .bk-mc__c");
  await chooserOpen(q, false, false);
  await settle(q, 300);
  assert.deepEqual([await q.getAttribute("#book-form", "data-step"), books(), await q.evaluate(() => document.activeElement.id)], ["search", 0, "bk-from"]);
  await q.click("#bk-view");
  await q.waitForSelector("#q-pickup-address", { state: "visible" });
  await settle(q, 300);
  assert.deepEqual([await q.textContent("#q-pickup-address p"), (await chooser(q, false)).open], [REASONS["pickup-address"].map, false]);
  const [value, shifts] = await cls(q);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual([p.errors, q.errors], [[], []]);
  await qx.close();
});

await check("M58 when the map fails to load or Google refuses the key, a pickup that is no exact spot gets the request with no word of the map, since the page offers no Choose on the map", async () => {
  for (const [server, label] of [[LD, "load"], [M, "auth"]]) {
    const ctx = await context(server);
    const p = await open(ctx, server, "/book");
    await p.click("#bk-from");
    if (label === "auth") {
      await live(p);
      await p.evaluate(() => window.gm_authFailure());
    }
    await p.waitForFunction(() => sessionStorage.getItem("nlr-map-off") === "1");
    await type(p, "from", "Brooklyn");
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=typed]"));
    assert.deepEqual([await p.$("#bk-from-list [data-kind=map]"), await p.evaluate(() => document.getElementById("book-form").classList.contains("bk--live"))], [null, false], label);
    await place(p, "to", ...JFK_ROW);
    await p.click("#bk-view");
    await p.waitForSelector("#q-pickup-address", { state: "visible" });
    const body = JSON.parse(ctx.api.filter((x) => x.path === "book").pop().body);
    assert.deepEqual([await p.textContent("#q-pickup-address p"), "draw" in body], [REASONS["pickup-address"].text, false], label);
    assert.deepEqual(p.errors, [], label);
    await ctx.close();
  }
});

const COARSE = { geolocation: { latitude: BEDFORD[0], longitude: BEDFORD[1], accuracy: 3000 }, permissions: ["geolocation"] };
for (const phone of [false, true]) {
  await check(`M59 ${phone ? "390 phone" : "1440 desktop"} current location from a coarse position: Use my current location opens Choose on the map at the position with the pin in the middle and the reason, the lookup there finds the street address, and one tap uses it, with no lookup of its own`, async () => {
    const ctx = await context(M, { ...(phone ? PHONE : {}), ...COARSE });
    const p = await open(ctx, M, "/book");
    await start(p);
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]"));
    const row = p.locator("#bk-from-list [data-kind=here]");
    phone ? await row.tap() : await row.click();
    await chooserOpen(p, phone);
    await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/, phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a");
    const c = await chooser(p, phone);
    assert.deepEqual([c.name, c.use, c.zoom, at(c.center, BEDFORD), await p.inputValue("#bk-from")], [CONFIRM, "Use this pickup", 16, true, ""], JSON.stringify(c));
    assert.deepEqual(phone ? [c.focus] : [c.focus, c.hint, ...(await described(p))], phone ? ["H2"] : ["region", true, `${CONFIRM}.`, KEYS_HINT]);
    const here = ctx.api.filter((x) => x.path === "places" && JSON.parse(x.body).action === "here").map((x) => JSON.parse(x.body));
    assert.deepEqual(here.map((x) => [x.lat, x.lng]), [BEDFORD], "one lookup, the chooser's own");
    const use = p.locator(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
    phone ? await use.tap() : await use.click();
    await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
    assert.deepEqual([(await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.textContent("#bk-status"), (await chooser(p, phone)).open], ["v1.", `Pickup set to ${BEDFORD_LABEL}.`, false]);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M59 current location from a coarse position with no map: the row and the status say we couldn't find the location and the pickup stays empty, while a position within 100 meters still fills the street address", async () => {
  for (const [accuracy, filled] of [[3000, false], [100, true]]) {
    const ctx = await context(LD, { geolocation: { latitude: BEDFORD[0], longitude: BEDFORD[1], accuracy }, permissions: ["geolocation"] });
    const p = await open(ctx, LD, "/book");
    await p.click("#bk-from");
    await p.waitForFunction(() => sessionStorage.getItem("nlr-map-off") === "1" && document.querySelector("#bk-from-list [data-kind=here]"));
    await p.locator("#bk-from-list [data-kind=here]").click();
    if (filled) await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
    else await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here] .bk-opt__main")?.textContent === "We couldn't find your location. Type the address.");
    assert.deepEqual([await p.inputValue("#bk-from"), await p.textContent("#bk-status")], filled ? [BEDFORD_LABEL, `Pickup set to ${BEDFORD_LABEL}.`] : ["", "We couldn't find your location. Type the address."], String(accuracy));
    assert.deepEqual(p.errors, [], String(accuracy));
    await ctx.close();
  }
});

await check("M60 a current location answer that lands after the customer moved on fills the pickup without taking focus: the typing goes on in the drop-off", async () => {
  const ctx = await context(M, LOCATED);
  await ctx.addInitScript(() => {
    const g = navigator.geolocation, real = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (ok, fail, o) => real((pos) => setTimeout(() => ok(pos), 2500), fail, o);
  });
  const p = await open(ctx, M, "/book");
  await start(p);
  await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]"));
  await p.locator("#bk-from-list [data-kind=here]").click();
  await p.click("#bk-to");
  await p.keyboard.type("27");
  await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL, { timeout: 8000 });
  await p.keyboard.type("7 Bed");
  assert.deepEqual([await p.inputValue("#bk-to"), await p.evaluate(() => document.activeElement.id), await p.isHidden("#bk-from-pop"), (await p.inputValue("#bk-from-ticket")).slice(0, 3)], ["277 Bed", "bk-to", true, "v1."]);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

for (const phone of [false, true]) {
  await check(`M61 ${phone ? "390 phone" : "1440 desktop"} by the hour: a picked neighborhood as the pickup opens Choose on the map at once with the reason, one tap uses the street address and the hourly price shows`, async () => {
    const ctx = await context(M, phone ? PHONE : {});
    const p = await open(ctx, M, "/book");
    await start(p);
    phone ? await p.locator("label[for=bk-hour]").tap() : await p.click("label[for=bk-hour]");
    await type(p, "from", "williamsburg");
    await p.waitForSelector("#bk-from-list [data-kind=google]");
    const pick = p.locator("#bk-from-list [data-kind=google]").first();
    phone ? await pick.tap() : await pick.click();
    await chooserOpen(p, phone);
    await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/, phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a");
    const c = await chooser(p, phone);
    assert.deepEqual([c.open, c.name, c.caption, c.use, c.zoom], [true, CONFIRM, phone ? "" : `${CONFIRM}.`, "Use this pickup", 16]);
    const use = p.locator(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
    phone ? await use.tap() : await use.click();
    await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
    assert.equal((await p.inputValue("#bk-from-ticket")).slice(0, 3), "v1.");
    phone ? await p.locator("#bk-view").tap() : await p.click("#bk-view");
    await priceShown(p);
    assert.equal(await p.isVisible("#q-pickup-address"), false);
    const options = JSON.parse(ctx.api.filter((x) => x.path === "book").map((x) => x.body).find((x) => JSON.parse(x).action === "options"));
    assert.deepEqual([options.trip_type, options.from_text, options.from_ticket.slice(0, 3)], ["hour", BEDFORD_LABEL, "v1."]);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

await check("M62 with the map, a pick that could not be looked up puts the typed text back with a message, the chooser it opened says to click the map, and after Cancel Book your ride asks for the ZIP code with no second pick", async () => {
  const ctx = await context(M);
  await ctx.route((u) => u.pathname === "/api/places", (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    return body.action === "pick" && body.id === "mock-hoboken" ? r.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"error"}' }) : r.continue();
  });
  const p = await open(ctx, M, "/book");
  const picks = () => ctx.api.filter((x) => x.path === "places" && JSON.parse(x.body).action === "pick" && JSON.parse(x.body).id === "mock-hoboken").length;
  await start(p);
  await place(p, "to", ...EDITION_ROW);
  await ticket(p, "to");
  await type(p, "from", "hoboken");
  await p.waitForSelector("#bk-from-list [data-kind=google]");
  await p.locator("#bk-from-list [data-kind=google]").first().click();
  await chooserOpen(p, false);
  await p.waitForFunction(() => document.getElementById("bk-from").value === "hoboken");
  await addressIs(p, /^Click the map or drag the pin\.$/);
  const c = await chooser(p, false);
  assert.deepEqual([c.name, c.off, await p.textContent("#bk-status"), await p.inputValue("#bk-from-ticket")], [CONFIRM, "true", "We couldn't look up this place. Type the address.", ""]);
  await p.click(".bk-mc .bk-mc__c");
  await chooserOpen(p, false, false);
  await p.click("#bk-view");
  await p.waitForSelector("#q-unplaced", { state: "visible" });
  assert.deepEqual([await p.inputValue("#bk-from"), await p.textContent("#q-unplaced p"), (await chooser(p, false)).open, picks()], ["hoboken", REASONS.unplaced.google, false, 1]);
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

await check("M63 a second press of Book your ride while the pin it asked for is open keeps that chooser and the spot the customer chose there, sends no price request, and Use this pickup then goes on to the prices from that spot", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/book");
  const books = () => ctx.api.filter((x) => x.path === "book" && JSON.parse(x.body).action === "options").length;
  await start(p);
  await type(p, "from", "hoboken");
  await p.waitForSelector("#bk-from-list [data-kind=google]");
  await p.keyboard.press("Escape");
  await place(p, "to", ...EDITION_ROW);
  await ticket(p, "to");
  await p.click("#bk-view");
  await chooserOpen(p, false);
  await addressIs(p, /300 Garden St, Hoboken, NJ 07030/);
  await frame(p, BEDFORD[0], BEDFORD[1], 16);
  const spot = await px(p, BEDFORD);
  await p.mouse.click(spot.x, spot.y);
  await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/);
  await p.click("#bk-view");
  await settle(p, 600);
  const c = await chooser(p, false);
  assert.deepEqual([c.open, c.name, c.address, c.zoom, at(c.center, BEDFORD), await p.getAttribute("#book-form", "data-step"), books()], [true, CONFIRM, `${BEDFORD_LABEL} Brooklyn`, 16, true, "search", 0]);
  await p.click(".bk-mc .bk-mc__u");
  await priceShown(p);
  assert.deepEqual([await p.inputValue("#bk-from"), (await p.inputValue("#bk-from-ticket")).slice(0, 3), books()], [BEDFORD_LABEL, "v1.", 1]);
  const [value, shifts] = await cls(p);
  assert.equal(value, 0, shifts.join(" | "));
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

const COMPACT = ["/services", "/locations/manhattan"];
const scripted = (page) => page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const outOfView = (page, sels) => page.evaluate((s) => s.filter((x) => { const b = document.querySelector(x).getBoundingClientRect(); return !(b.width && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth); }), sels);
const mapNames = (ctx) => ctx.assets.map((u) => new URL(u).pathname.replace(/\.[A-Za-z0-9_-]+\.(js|css)$/, ".$1")).sort();
for (const path of COMPACT) {
  for (const phone of [false, true]) {
    await check(`M64 ${path} ${phone ? "390 phone" : "1440 desktop"}: the compact bar loads no map with JavaScript off or before the first focus, then the empty pickup list starts with Use my current location and ends with Choose on the map as on the home page, also when the field took focus before the page script arrived, the location fills the pickup with its street address, and nothing moves or scrolls sideways`, async () => {
      const off = await context(M, { ...(phone ? PHONE : {}), javaScriptEnabled: false });
      const o = await open(off, M, path);
      await settle(o, 500);
      assert.deepEqual([off.assets, await o.getAttribute("#book-form", "method"), await o.getAttribute("#book-form", "action"), await o.evaluate(() => !!document.querySelector("#bk-live, #bk-mp, .bk-mapd"))], [[], "get", "/book#from-search", false], "JavaScript off");
      await off.close();
      const ctx = await context(M, { ...(phone ? PHONE : {}), ...LOCATED });
      await ctx.addInitScript(GEO_SPY);
      const p = await open(ctx, M, path);
      await scripted(p);
      await settle(p, 1000);
      assert.deepEqual(ctx.assets, [], "nothing before the first focus");
      phone ? await p.locator("#bk-from").tap() : await p.click("#bk-from");
      await live(p);
      await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=here]") && document.querySelector("#bk-from-list [data-kind=map]"));
      const rows = await geoRows(p);
      const groups = await p.$$eval("#bk-from-list [data-kind=here], #bk-from-list [data-kind=map]", (o) => o.map((x) => x.closest("[role=group]").getAttribute("aria-label")));
      assert.deepEqual([rows[0], rows.at(-1), groups, await p.getAttribute("#bk-from-list [data-kind=here]", "id")], [["here", "Use my current location"], ["map", "Choose on the map"], ["Your location", "Map"], "bk-from-o0"]);
      assert.deepEqual([await p.evaluate(() => window.__geo), mapNames(ctx), await sideways(p)], [[], ["/__maps-mock.js", "/assets/map.css", "/assets/map.js"], 0], "no position before the tap, the map loads once");
      const row = p.locator("#bk-from-list [data-kind=here]");
      phone ? await row.tap() : await row.click();
      await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
      assert.deepEqual([(await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.textContent("#bk-status"), await p.evaluate(() => document.activeElement.id), await p.evaluate(() => window.__geo), await sideways(p)], ["v1.", `Pickup set to ${BEDFORD_LABEL}.`, "bk-to", [["getCurrentPosition", { timeout: 10000, enableHighAccuracy: true }]], 0]);
      const [value, shifts] = await cls(p);
      assert.equal(value, 0, shifts.join(" | "));
      assert.deepEqual(p.errors, []);
      await ctx.close();
      const lx = await context(M, phone ? PHONE : {});
      let release;
      const held = new Promise((z) => (release = z));
      await lx.route(/\/assets\/pay\.[A-Za-z0-9_-]+\.js$/, async (r) => (await held, r.continue()));
      const q = await open(lx, M, path);
      phone ? await q.locator("#bk-from").tap() : await q.click("#bk-from");
      assert.equal(await q.evaluate(() => document.getElementById("book-form").classList.contains("is-js")), false, "the page script is still on its way");
      release();
      await q.waitForFunction(() => !document.getElementById("bk-from-pop").hidden && document.querySelector("#bk-from-list [data-kind=here]") && document.querySelector("#bk-from-list [data-kind=map]"), null, { timeout: 8000 });
      assert.deepEqual([await q.evaluate(() => document.activeElement.id), (await geoRows(q))[0], mapNames(lx)], ["bk-from", ["here", "Use my current location"], ["/__maps-mock.js", "/assets/map.css", "/assets/map.js"]], "the field that took focus first gets the same list with no second tap");
      assert.deepEqual(q.errors, []);
      await lx.close();
    });
  }
}

for (const path of COMPACT) {
  await check(`M65 ${path} 1440 desktop: Choose on the map from the empty pickup list opens the pin chooser in the compact bar, whole in view and inside the bar with no sideways scroll, and works by keyboard as on the home page: focus in the map with the key hint, Enter puts the pin in the middle and finds the street address, Tab reaches Use this pickup and Enter fills the pickup and moves on, with no pin animation under reduced motion and nothing moving`, async () => {
    const ctx = await context(M);
    const p = await open(ctx, M, path);
    await scripted(p);
    await start(p);
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
    await p.keyboard.press("ArrowUp");
    assert.equal(await p.evaluate(() => document.getElementById(document.getElementById("bk-from").getAttribute("aria-activedescendant")).dataset.kind), "map");
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("role") === "region");
    const b0 = await bar(p);
    assert.deepEqual([b0.hidden, b0.label, b0.text, b0.use, b0.off, await p.evaluate(() => document.activeElement.getAttribute("aria-label")), await described(p)], [false, "Choose the pickup", "Click the map or drag the pin.", "Use this pickup", "true", "Map", [KEYS_HINT]]);
    await settle(p, 300);
    assert.deepEqual([await outOfView(p, [".bk-mc .bk-mc__a", ".bk-mc .bk-mc__u", ".bk-mc .bk-mc__c", "#bk-live"]), await sideways(p)], [[], 0]);
    assert.ok(await p.evaluate(() => { const f = document.getElementById("book-form").getBoundingClientRect(), m = document.getElementById("bk-mp").getBoundingClientRect(); return document.getElementById("bk-mp").closest("#book-form") && m.left >= f.left && m.right <= f.right && m.bottom <= f.bottom; }), "the chooser sits inside the bar");
    await p.evaluate(([a, b]) => __gmock.map.setCenter({ lat: a, lng: b }), BEDFORD);
    await p.keyboard.press("Enter");
    await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll(".bk-pin")].every((e) => getComputedStyle(e, "::before").animationName === "none")), "no pin animation under reduced motion");
    for (let i = 0; i < 12 && !(await p.evaluate(() => document.activeElement.classList.contains("bk-mc__u"))); i++) await p.keyboard.press("Tab");
    assert.equal(await p.evaluate(() => document.activeElement.textContent), "Use this pickup");
    await p.keyboard.press("Enter");
    await p.waitForFunction((l) => document.getElementById("bk-from").value === l, BEDFORD_LABEL);
    assert.deepEqual([(await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.textContent("#bk-status"), await p.evaluate(() => document.activeElement.id), (await bar(p)).hidden, new URL(p.url()).pathname, await sideways(p)], ["v1.", `Pickup set to ${BEDFORD_LABEL}.`, "bk-to", true, path, 0]);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });

  await check(`M65 ${path} 390 phone: Choose on the map from the empty pickup list opens the full screen map dialog over the compact bar, named by its title in focus, with no sideways scroll and no sheet animation under reduced motion, a tap sets the pin and finds the street address, and Use this pickup fills the pickup and moves on, with nothing moving`, async () => {
    const ctx = await context(M, PHONE);
    const p = await open(ctx, M, path);
    await scripted(p);
    await p.locator("#bk-from").tap();
    await live(p);
    await p.waitForFunction(() => document.querySelector("#bk-from-list [data-kind=map]"));
    await p.locator("#bk-from-list [data-kind=map]").tap();
    await p.waitForFunction(() => document.querySelector(".bk-mapd").open);
    const d = await p.evaluate(() => { const g = document.querySelector(".bk-mapd"), r = g.getBoundingClientRect(); return [document.getElementById(g.getAttribute("aria-labelledby")).textContent, document.activeElement.tagName, Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, !!g.querySelector("#bk-live"), getComputedStyle(document.documentElement).overflow, g.querySelector(".bk-mapd__x").getAttribute("aria-label"), getComputedStyle(g.querySelector(".bk-mapd__s")).animationName]; });
    assert.deepEqual(d, ["Choose the pickup", "H2", true, true, "hidden", "Close the map", "none"]);
    assert.deepEqual([await outOfView(p, [".bk-mapd .bk-mc__a", ".bk-mapd .bk-mc__u", ".bk-mapd__x"]), await sideways(p)], [[], 0]);
    await p.evaluate(([a, b]) => (__gmock.map.setZoom(13), __gmock.map.setCenter({ lat: a, lng: b })), [40.728, -73.975]);
    const t = await px(p, BEDFORD);
    await p.touchscreen.tap(t.x, t.y);
    await addressIs(p, /277 Bedford Ave, Brooklyn, NY 11211/, ".bk-mapd .bk-mc__a");
    assert.equal(await p.getAttribute(".bk-mapd .bk-mc__u", "aria-disabled"), null);
    await p.locator(".bk-mapd .bk-mc__u").tap();
    await p.waitForFunction(() => !document.querySelector(".bk-mapd").open);
    assert.deepEqual([await p.inputValue("#bk-from"), (await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.textContent("#bk-status"), await p.evaluate(() => document.activeElement.id), new URL(p.url()).pathname, await sideways(p)], [BEDFORD_LABEL, "v1.", `Pickup set to ${BEDFORD_LABEL}.`, "bk-to", path, 0]);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

const handed = (ctx) => ctx.api.filter((x) => x.path === "book").map((x) => JSON.parse(x.body)).filter((x) => x.action === "options");
for (const path of COMPACT) {
  for (const phone of [false, true]) {
    await check(`M66 ${path} ${phone ? "390 phone" : "1440 desktop"}: a typed pickup that is no exact spot, hoboken, opens the pin chooser on the compact bar at Book your ride with the reason, with no price request and no hand-off while it waits, and one tap on Use this pickup goes on to /book#options with one options request from the street address there and the prices`, async () => {
      const ctx = await context(M, phone ? PHONE : {});
      const p = await open(ctx, M, path);
      const tap = (sel) => (phone ? p.locator(sel).tap() : p.click(sel));
      await scripted(p);
      await start(p);
      await type(p, "from", "hoboken");
      await p.waitForSelector("#bk-from-list [data-kind=google]");
      await p.keyboard.press("Escape");
      await place(p, "to", ...BEDFORD_ROW);
      await ticket(p, "to");
      await tap("#bk-view");
      await chooserOpen(p, phone);
      const c = await chooser(p, phone);
      assert.deepEqual([await p.inputValue("#bk-from"), c.name, c.caption, c.use, c.live], ["Hoboken, NJ", CONFIRM, phone ? "" : `${CONFIRM}.`, "Use this pickup", "polite"]);
      assert.deepEqual(phone ? [c.focus] : [c.focus, await described(p)], phone ? ["H2"] : ["region", [`${CONFIRM}.`, KEYS_HINT]]);
      await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a");
      await settle(p, 400);
      const ready = await chooser(p, phone);
      assert.deepEqual([ready.off, ready.zoom, at(ready.center, HOBOKEN), handed(ctx).length, new URL(p.url()).pathname, await sideways(p), await outOfView(p, phone ? [".bk-mapd .bk-mc__u"] : [".bk-mc .bk-mc__u", ".bk-mc .bk-mc__c"])], [null, 16, true, 0, path, 0, []], "no price request and no hand-off while the pin waits");
      const [v0, s0] = await cls(p);
      assert.equal(v0, 0, s0.join(" | "));
      await tap(phone ? ".bk-mapd .bk-mc__u" : ".bk-mc .bk-mc__u");
      await p.waitForURL(/\/book#options$/);
      await priceShown(p);
      assert.deepEqual([await p.inputValue("#bk-from"), (await p.inputValue("#bk-from-ticket")).slice(0, 3), await p.isVisible("#q-pickup-address"), await p.evaluate(() => document.activeElement.id)], [GARDEN_LABEL, "v1.", false, "bk-opt-h"]);
      assert.deepEqual(handed(ctx).map((x) => [x.from_text, x.to_text, x.from_ticket.slice(0, 3), x.to_ticket.slice(0, 3)]), [[GARDEN_LABEL, "277 Bedford Avenue, Brooklyn, NY", "v1.", "v1."]], "one options request after the tap");
      const cards = await p.$$eval(".bk-card__price .bk-fig", (o) => o.map((x) => x.textContent));
      assert.ok(cards.slice(0, 4).every((x) => /^\$\d/.test(x)), cards.join(" | "));
      const chip = await p.textContent("#bk-sum .bk-chip");
      assert.ok(chip.includes("300 Garden St") && chip.includes("277 Bedford Avenue"), chip);
      const [value, shifts] = await cls(p);
      assert.equal(value, 0, shifts.join(" | "));
      assert.deepEqual(p.errors, []);
      await ctx.close();
    });
  }
}

for (const path of COMPACT) {
  for (const phone of [false, true]) {
    await check(`M67 ${path} ${phone ? "390 phone" : "1440 desktop"}: a picked pickup that is no exact spot, Hoboken, NJ, opens the pin chooser on the compact bar at once with the reason, ${phone ? "Use this pickup fills its street address, and Book your ride then" : "Book your ride while it is open keeps it with no price request and no hand-off, and one tap on Use this pickup then"} goes on to /book#options with one options request from that street address and the prices`, async () => {
      const ctx = await context(M, phone ? PHONE : {});
      const p = await open(ctx, M, path);
      const tap = (sel) => (phone ? p.locator(sel).tap() : p.click(sel));
      await scripted(p);
      await start(p);
      await place(p, "to", ...EDITION_ROW);
      await ticket(p, "to");
      await type(p, "from", "hoboken");
      await p.waitForSelector("#bk-from-list [data-kind=google]");
      const pick = p.locator("#bk-from-list [data-kind=google]").first();
      phone ? await pick.tap() : await pick.click();
      await chooserOpen(p, phone);
      const c = await chooser(p, phone);
      assert.deepEqual([await p.inputValue("#bk-from"), c.name, c.caption, c.use], ["Hoboken, NJ", CONFIRM, phone ? "" : `${CONFIRM}.`, "Use this pickup"]);
      await addressIs(p, /300 Garden St, Hoboken, NJ 07030/, phone ? ".bk-mapd .bk-mc__a" : ".bk-mc .bk-mc__a");
      if (phone) {
        await tap(".bk-mapd .bk-mc__u");
        await chooserOpen(p, phone, false);
        assert.deepEqual([await p.inputValue("#bk-from"), (await p.inputValue("#bk-from-ticket")).slice(0, 3), new URL(p.url()).pathname, handed(ctx).length], [GARDEN_LABEL, "v1.", path, 0]);
        await tap("#bk-view");
      } else {
        await p.click("#bk-view");
        await settle(p, 600);
        const k = await chooser(p, phone);
        assert.deepEqual([k.open, k.name, await p.inputValue("#bk-from"), handed(ctx).length, new URL(p.url()).pathname], [true, CONFIRM, "Hoboken, NJ", 0, path], "Book your ride keeps the open chooser");
        const [v0, s0] = await cls(p);
        assert.equal(v0, 0, s0.join(" | "));
        await p.click(".bk-mc .bk-mc__u");
      }
      await p.waitForURL(/\/book#options$/);
      await priceShown(p);
      assert.deepEqual(handed(ctx).map((x) => [x.from_text, x.to_text, x.from_ticket.slice(0, 3), x.to_ticket.slice(0, 3)]), [[GARDEN_LABEL, "The New York EDITION, Madison Avenue, New York, NY", "v1.", "v1."]], "one options request");
      assert.equal(await p.isVisible("#q-pickup-address"), false);
      const cards = await p.$$eval(".bk-card__price .bk-fig", (o) => o.map((x) => x.textContent));
      assert.ok(cards.slice(0, 4).every((x) => /^\$\d/.test(x)), cards.join(" | "));
      const [value, shifts] = await cls(p);
      assert.equal(value, 0, shifts.join(" | "));
      assert.deepEqual(p.errors, []);
      await ctx.close();
    });
  }
}

for (const path of COMPACT) {
  for (const phone of [false, true]) {
    await check(`M68 ${path} ${phone ? "390 phone" : "1440 desktop"}: when Google rejects the map after the compact bar shows the trip on it, the map box stays in place hidden with nothing moving and no page error, and Book your ride still goes on to /book#options with one options request and the prices`, async () => {
      const ctx = await context(M, phone ? PHONE : {});
      const p = await open(ctx, M, path);
      await scripted(p);
      await start(p);
      await routeOf(p, EDITION_ROW, BEDFORD_ROW);
      await drawn(p);
      await p.click("h1");
      await settle(p, 1500);
      const c0 = await p.evaluate(() => window.__cls);
      await p.evaluate(() => window.gm_authFailure());
      await settle(p, 1200);
      const r = await p.evaluate((c) => { const m = document.getElementById("bk-mp"); return [+(window.__cls - c).toFixed(4), m && m.isConnected ? getComputedStyle(m).visibility : "gone", document.getElementById("book-form").classList.contains("bk--live"), sessionStorage.getItem("nlr-map-off")]; }, c0);
      assert.deepEqual([r, p.errors], [[0, "hidden", false, "1"], []]);
      phone ? await p.locator("#bk-view").tap() : await p.click("#bk-view");
      await p.waitForURL(/\/book#options$/);
      await priceShown(p);
      assert.deepEqual(handed(ctx).map((x) => [x.from_text, x.to_text, "draw" in x]), [["The New York EDITION, Madison Avenue, New York, NY", "277 Bedford Avenue, Brooklyn, NY", false]]);
      assert.deepEqual(p.errors, []);
      await ctx.close();
    });
  }
}

for (const [, b] of ENGINES) await b.close();
if (failures) {
  console.error(`\n${failures} map browser check(s) failed`);
  process.exit(1);
}
console.log("\nAll map browser checks passed");
process.exit(0);
