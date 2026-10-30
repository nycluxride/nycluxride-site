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

await check("M1 /services: the search only widget never loads the map", async () => {
  const ctx = await context(M);
  const p = await open(ctx, M, "/services");
  await p.click("#bk-from");
  await p.keyboard.type("edition");
  await settle(p, 1200);
  assert.deepEqual(ctx.assets, []);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

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
  await check(`M21 ${w}x${h}: the short side map on the vehicle step still frames the trip, zoom 10 or closer with both pins inside the map and apart`, async () => {
    const ctx = await context(M, { viewport: { width: w, height: h } });
    const p = await open(ctx, M, "/book");
    await start(p);
    await routeOf(p, EDITION_ROW, BEDFORD_ROW);
    await drawn(p);
    await view(p);
    await settle(p);
    const m = await p.evaluate(() => { const r = document.getElementById("bk-live").getBoundingClientRect(); return { zoom: __gmock.map.getZoom(), box: [r.left, r.top, r.right, r.bottom].map(Math.round), shown: getComputedStyle(document.getElementById("bk-live")).display }; });
    const a = await px(p, EDITION), b = await px(p, BEDFORD);
    assert.equal(m.shown, "block");
    assert.ok(m.zoom >= 10, JSON.stringify(m));
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 24, JSON.stringify([a, b, m]));
    for (const q of [a, b]) assert.ok(q.x >= m.box[0] && q.x <= m.box[2] && q.y >= m.box[1] && q.y <= m.box[3], JSON.stringify([q, m]));
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

for (const [, b] of ENGINES) await b.close();
if (failures) {
  console.error(`\n${failures} map browser check(s) failed`);
  process.exit(1);
}
console.log("\nAll map browser checks passed");
process.exit(0);
