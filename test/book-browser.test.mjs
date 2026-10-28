import { join, dirname } from "node:path";
import { readdirSync, existsSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const api = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { AIRPORT_FARES, AIRPORT_TOTALS, MEET_AND_GREET, VEHICLES, TIP_PERCENTS, TIP_CUSTOM, NYC_TAX_PERCENT, BCF_PERCENT, percentCents, DISTANCE_RATES } = await api("_rates.mjs");
const { readPhone } = await api("_phone.mjs");
const { HEADINGS, NOTES, REASONS, POLICY } = await api("_copy.mjs");

const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "MAP_MOCK", "GOOGLE_MAPS_JS", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "FLIGHT_API_KEY", "PLACE_TICKET_SECRET", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT"];
const nyDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 864e5));
const nyClock = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
const { MIN_NOTICE_HOURS } = await api("_rates.mjs");
const nyNow = () => nyClock(Date.now() + MIN_NOTICE_HOURS * 36e5 + 59999);
const firstDay = () => { const n = nyNow(); return n.slice(11) <= "23:50" ? n.slice(0, 10) : new Date(Date.parse(n.slice(0, 10)) + 864e5).toISOString().slice(0, 10); };
const inWindow = () => { const t = nyClock(Math.ceil((Date.now() + 15 * 6e4) / 6e5) * 6e5); return { date: t.slice(0, 10), time: t.slice(11) }; };
const HOUR_NOTE = "For a pickup within the next hour, email or WhatsApp us.";
const DRIVE_N = "16.8 miles, about 43 min by car. Google Maps";
const DRIVE_SEEN = "16.8 miles, about 43 min by car.";
const DATE = nyDate(3);
const RDATE = nyDate(6);
const YEAR = nyDate(0).slice(0, 4);
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) + (iso.slice(0, 4) !== YEAR ? `, ${iso.slice(0, 4)}` : "");
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const FARE = AIRPORT_FARES.suv.jfk;
const TAX = percentCents(FARE, NYC_TAX_PERCENT);
const BCF = percentCents(FARE, BCF_PERCENT);
const TOTAL = AIRPORT_TOTALS.suv.jfk;
const CLASS_KEYS = ["suv", "premium", "first", "sedan", "sprinter"];
const JFK_CARDS = ["$185.00", "$220.00", "$310.00", "$170.00", "$400.00"];
const TOLLS = TOTAL - FARE - TAX - BCF;
const L_TAX = `NYC sales tax (${NYC_TAX_PERCENT}%)`;
const L_BCF = `Black Car Fund (${BCF_PERCENT}%)`;
const AIRPORT_LINES = [["Fare", cash(FARE)], [L_TAX, cash(TAX)], [L_BCF, cash(BCF)], ["Tolls and airport fees", cash(TOLLS)]];
const hourly = (vehicle, hours = 3) => {
  const fare = VEHICLES[vehicle].hourly * hours;
  return fare + percentCents(fare, NYC_TAX_PERCENT) + percentCents(fare, BCF_PERCENT);
};

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

const P = await serve({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true" });
const G = await serve({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" });
const Q = await serve({ BOOK_MOCK: "true" });
process.on("exit", () => [P, G, Q].forEach((s) => s.child.kill()));

const SPY = () => {
  window.__purchases = [];
  let real;
  Object.defineProperty(window, "nlrPurchase", {
    configurable: true,
    get: () => real && ((...a) => (window.__purchases.push(a), real(...a))),
    set: (f) => (real = f),
  });
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
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

const browser = await chromium.launch();

async function context(server, options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", ...options });
  ctx.external = [];
  ctx.api = [];
  await ctx.route((url) => !url.href.startsWith(server.base), (route) => {
    ctx.external.push(route.request().url());
    route.fulfill({ status: 204, body: "" });
  });
  ctx.on("request", (r) => r.url().startsWith(`${server.base}/api/`) && ctx.api.push(r.url()));
  if (options.javaScriptEnabled !== false) await ctx.addInitScript(SPY);
  return ctx;
}

async function open(ctx, server, path) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.failed = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to (load resource|preconnect)/.test(m.text()) && page.errors.push(m.text()));
  page.on("requestfailed", (r) => r.url().startsWith(server.base) && page.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.url().startsWith(server.base) && !r.url().includes("/api/") && r.status() >= 400 && page.failed.push(`${r.status()} ${r.url()}`));
  await page.goto(`${server.base}${path}`, { waitUntil: "load" });
  return page;
}

const rows = (page, end) => page.$$eval(`#bk-${end}-list [role=option]`, (o) => o.map((x) => [x.dataset.kind, x.getAttribute("aria-label") || x.querySelector(".bk-opt__main").textContent, (x.querySelector(".bk-opt__area") || {}).textContent || ""]));
const mains = async (page, end) => (await rows(page, end)).filter((r) => r[0] === "local").map((r) => r[1]);
async function type(page, end, text) {
  await page.fill(`#bk-${end}`, "");
  await page.click(`#bk-${end}`);
  await page.keyboard.type(text);
}
async function place(page, end, text, label) {
  await type(page, end, text);
  if (label) await page.locator(`#bk-${end}-list [role=option][aria-label="${label}"], #bk-${end}-list [role=option][aria-label="${label.replace(/^(.*? \(\w+\)), (.+)$/, "$2, $1")}"], #bk-${end}-list [role=option]:has-text("${label}")`).first().click();
  else await page.keyboard.press("Escape");
}
const scrollIdle = (page) => page.waitForFunction(() => new Promise((ok) => { let y = scrollY, n = 0; const t0 = performance.now(); const t = () => (scrollY === y ? ++n : ((y = scrollY), (n = 0)), n > 8 && performance.now() - t0 > 200 ? ok(true) : requestAnimationFrame(t)); requestAnimationFrame(t); }), null, { timeout: 6000 });
async function pickDate(page, btn, iso) {
  if (!(await page.evaluate((b) => { const k = document.getElementById("bk-cal"); return !k.hidden && k.previousElementSibling === document.querySelector(b); }, btn))) await page.click(btn);
  await scrollIdle(page);
  for (let i = 0; i < 14 && !(await page.$(`#bk-cal [data-day="${iso}"]`)); i++) await page.click('#bk-cal .bk-cal__nav[data-dir="1"]');
  await page.click(`#bk-cal [data-day="${iso}"]`);
}
async function clickTime(page, v) {
  const o = page.locator(`#bk-tm [role=option][data-v="${v}"]`);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("bk-tm")).opacity === "1");
  await scrollIdle(page);
  await o.evaluate((x) => { const l = x.closest("[role=listbox]"), a = x.getBoundingClientRect(), b = l.getBoundingClientRect(); l.scrollTop += a.top - b.top - (b.height - a.height) / 2; });
  await o.click();
}
async function setTime(page, v, sel = "#bk-time") {
  if (!(await page.isVisible(`${sel}-btn`))) return page.selectOption(sel, v);
  if (v === "") return page.selectOption(sel, v, { force: true });
  if ((await page.getAttribute(`${sel}-btn`, "aria-expanded")) !== "true") await page.click(`${sel}-btn`);
  await clickTime(page, v);
  await page.waitForFunction(([s, x]) => document.querySelector(s).value === x && document.getElementById("bk-tm").hidden, [sel, v]);
}
async function trip(page, { from = ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to = ["350 5th Ave, New York, NY 10118"], date = DATE, time = "12:40" } = {}) {
  await place(page, "from", ...from);
  if (to) await place(page, "to", ...to);
  await pickDate(page, "#bk-date-btn", date);
  await setTime(page, time);
}
const priced = (page) => page.waitForFunction(() => !document.getElementById("price").hidden && /\d/.test((document.getElementById("price-total").firstChild || {}).textContent) && !document.getElementById("price-total").getAttribute("aria-busy") && !document.getElementById("bk-wait").textContent.startsWith("Finding"));
async function view(page) {
  await page.click("#bk-view");
  await page.waitForFunction(() => !document.getElementById("bk-wait").textContent.startsWith("Finding") && !/^(|\.\.\.)$/.test(document.getElementById("bk-p-suv").textContent));
}
const wide = (page) => page.evaluate(() => matchMedia("(min-width:1024px)").matches);
async function next(page) {
  await page.click("#bk-next");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
}
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
async function details(page, d = ME) {
  for (const [k, v] of Object.entries(d)) await page.fill(`#bk-${k}`, v);
}
const go = async () => "#bk-next";
async function tap(page, sel) {
  const [x, y] = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(x, y);
}
const showBar = (page) => page.evaluate(() => scrollTo({ top: Math.max(0, document.getElementById("bk-search").getBoundingClientRect().bottom + scrollY + 24 - innerHeight), behavior: "instant" }));
const payBtn = async () => "#bk-submit";
const panel = (page) =>
  page.evaluate(() => ({
    lines: [...document.querySelectorAll("#price-lines tr:not(.bk-hint)")].map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]),
    total: (document.getElementById("price-total").firstChild || {}).textContent,
    notes: document.getElementById("price-notes").textContent,
  }));
const cards = (page) => page.$$eval(".bk-card__price", (o) => o.map((x) => (x.querySelector(".bk-fig") || x).textContent));
const scopes = (page) => page.$$eval(".bk-card__price", (o) => o.map((x) => (x.querySelector(".bk-scope") || {}).textContent || ""));
const waText = async (page, sel) => decodeURIComponent((await page.getAttribute(sel, "href")).split("?text=")[1] || "");
const CHROME_WA = ".site-footer a[data-wa]";
async function pax(page, n) {
  for (let i = 0; i < 12; i++) {
    const v = +(await page.inputValue("#bk-pax"));
    if (v === n) return;
    await page.click(v < n ? '#bk-pax-f [aria-label="More passengers"]' : '#bk-pax-f [aria-label="Fewer passengers"]');
  }
  throw new Error(`the stepper did not reach ${n}`);
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cls = (page) => page.evaluate(() => [window.__cls, window.__shifts]);
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
const blank = (page) => page.evaluate(() => { const e = document.getElementById("bk-date"); e.value = ""; e.dispatchEvent(new Event("change", { bubbles: true })); });

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height } });
  for (const path of ["/", "/book", "/locations/jfk-airport", "/locations/laguardia-airport", "/locations/manhattan", "/chauffeur-service-nyc"]) {
    await check(`B1 ${path} at ${width}: no console error, no failed request, no /api call, CLS 0 on load`, async () => {
      const page = await open(ctx, P, path);
      await settle(page);
      assert.deepEqual(page.errors, []);
      assert.deepEqual(page.failed, []);
      assert.deepEqual(ctx.api, []);
      const [value, shifts] = await cls(page);
      assert.equal(value, 0, shifts.join(" | "));
      assert.ok(await page.evaluate(() => document.getElementById("book-form").classList.contains("is-js") && document.getElementById("book-form").noValidate));
      assert.equal(await page.getAttribute("#bk-from", "list"), null);
      assert.deepEqual(await page.evaluate(() => ["role", "aria-autocomplete", "aria-expanded", "aria-controls"].map((a) => document.getElementById("bk-to").getAttribute(a))), ["combobox", "list", "false", "bk-to-list"]);
      assert.equal(await page.isVisible("#bk-date"), false);
      assert.equal(await page.isVisible("#bk-date-btn"), true);
      await page.close();
    });
  }
  await ctx.close();
}

{
  const ctx = await context(P);
  const page = await open(ctx, P, "/book");
  await check("B2 an empty box shows the four airport chips on focus with no active row, ArrowDown activates row 1, and only the flight probe calls the server", async () => {
    await page.click("#bk-from");
    assert.deepEqual([await page.getAttribute("#bk-from", "aria-expanded"), await page.isVisible("#bk-from-pop"), await page.getAttribute("#bk-from", "aria-activedescendant")], ["true", true, null]);
    assert.deepEqual(await page.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => [x.textContent, x.getAttribute("aria-label")])), [["JFK", "JFK, John F. Kennedy"], ["LaGuardia", "LaGuardia (LGA)"], ["Newark", "Newark Liberty (EWR)"], ["Teterboro", "Teterboro (TEB)"]]);
    assert.ok(await page.$("#bk-from-list .bk-grp--chips"));
    assert.equal(await page.$("#bk-from-list [aria-selected=true]"), null);
    assert.equal(await page.textContent("#bk-from-g1"), "Airports");
    assert.equal(await page.textContent("#bk-status"), "4 suggestions");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.getAttribute("#bk-from", "aria-activedescendant"), "bk-from-o0");
    assert.equal(await page.getAttribute("#bk-from-o0", "aria-selected"), "true");
    assert.deepEqual(ctx.api, [`${P.base}/api/flight`]);
    await page.keyboard.press("Escape");
  });
  await check("B2 local ranking: the examples of the contract", async () => {
    const want = {
      jfk: ["John F. Kennedy (JFK)", "Terminal 1, John F. Kennedy (JFK)", "Terminal 4, John F. Kennedy (JFK)", "Terminal 5, John F. Kennedy (JFK)", "Terminal 7, John F. Kennedy (JFK)", "Terminal 8, John F. Kennedy (JFK)"],
      lga: ["LaGuardia (LGA)", "Terminal A, LaGuardia (LGA)", "Terminal B, LaGuardia (LGA)", "Terminal C, LaGuardia (LGA)"],
      "terminal b": ["Terminal B, LaGuardia (LGA)", "Terminal B, Newark Liberty (EWR)"],
      teterboro: ["Teterboro (TEB)", "Teterboro (TEB), Atlantic Aviation", "Teterboro (TEB), Jet Aviation", "Teterboro (TEB), Signature Aviation East", "Teterboro (TEB), Signature Aviation South", "Teterboro (TEB), Signature Aviation West"],
      edition: [],
    };
    for (const [q, list] of Object.entries(want)) {
      await type(page, "from", q);
      assert.deepEqual(await mains(page, "from"), list, q);
    }
    for (const [q, first] of [["kennedy", "John F. Kennedy (JFK)"], ["newark", "Newark Liberty (EWR)"], ["islip", "Long Island MacArthur (ISP)"], ["white plains", "Westchester County (HPN)"]]) {
      await type(page, "from", q);
      assert.equal((await mains(page, "from"))[0], first, q);
    }
    for (const [q, first] of [["jfk airport terminal 4", "Terminal 4, John F. Kennedy (JFK)"], ["kennedy terminal 4", "Terminal 4, John F. Kennedy (JFK)"], ["newark international", "Newark Liberty (EWR)"], ["lga b", "Terminal B, LaGuardia (LGA)"], ["ewr c", "Terminal C, Newark Liberty (EWR)"]]) {
      await type(page, "from", q);
      assert.equal((await mains(page, "from"))[0], first, q);
    }
    await type(page, "from", "j");
    assert.deepEqual([await page.isHidden("#bk-from-pop"), await page.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => x.textContent)), await page.$$eval("#bk-from-list [role=option] b", (o) => o.length)], [false, ["JFK", "LaGuardia", "Newark", "Teterboro"], 0], "one character matches nothing and keeps the open list as it was, so it does not close and reopen");
    await page.fill("#bk-from", "");
    assert.deepEqual(await page.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => x.textContent)), ["JFK", "LaGuardia", "Newark", "Teterboro"], "an emptied box shows the airport chips again");
    await page.keyboard.press("Escape");
    assert.deepEqual(ctx.api.filter((u) => !u.endsWith("/api/places") && !u.endsWith("/api/flight")), []);
  });
  await check("B2 the typed part is bold, the typed row comes last and Google rows are absent without mocks", async () => {
    await type(page, "from", "jfk");
    assert.equal(await page.textContent("#bk-from-o0 b"), "JFK");
    const r = await rows(page, "from");
    assert.deepEqual(r[r.length - 1].slice(0, 2), ["typed", "Use “jfk”"]);
    assert.equal(await page.$("#bk-from-g2"), null);
    assert.ok(await page.$('#bk-from-o0 use[href="#i-plane-arrive"]'));
    await type(page, "to", "lga");
    assert.ok(await page.$('#bk-to-o0 use[href="#i-plane-depart"]'));
    await page.keyboard.press("Escape");
  });
  await check("B2 keys: ArrowDown and ArrowUp move the highlight, Enter picks, the id is set and focus moves on", async () => {
    await page.fill("#bk-to", "");
    await type(page, "from", "jfk");
    assert.equal(await page.getAttribute("#bk-from", "aria-activedescendant"), null, "the list opens with no active row");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.getAttribute("#bk-from", "aria-activedescendant"), "bk-from-o2");
    assert.deepEqual(await page.$eval("#bk-from-o2", (o) => [o.querySelector(".bk-opt__main").textContent, o.querySelector(".bk-opt__sub").textContent, o.getAttribute("aria-label")]), ["Terminal 4", "John F. Kennedy (JFK)", "Terminal 4, John F. Kennedy (JFK)"]);
    await page.keyboard.press("Enter");
    assert.deepEqual([await page.inputValue("#bk-from"), await page.inputValue("#bk-from-id"), await page.inputValue("#bk-from-ticket")], ["JFK Terminal 4", "jfk-t4", ""]);
    assert.equal(await page.isVisible("#bk-from-pop"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-to");
    assert.equal(await page.isVisible("#bk-flight"), true, "an airport pickup shows the flight number");
    assert.equal(await page.getAttribute("#book-form", "data-step"), "search");
  });
  await check("B2 after a pick the next box stays closed, a tap on Date picks nothing, and an airport pickup lists no airport for an empty drop-off", async () => {
    assert.deepEqual([await page.getAttribute("#bk-to", "aria-expanded"), await page.isVisible("#bk-to-pop")], ["false", false]);
    await page.click("#bk-date-btn");
    assert.deepEqual([await page.inputValue("#bk-from"), await page.inputValue("#bk-to")], ["JFK Terminal 4", ""]);
    await page.keyboard.press("Escape");
    await page.focus("#bk-to");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.getAttribute("#bk-to", "aria-expanded"), "false");
  });
  await check("B2 Escape and Tab close the list and keep the text without a pick, typing clears the hidden id", async () => {
    await type(page, "to", "jfk");
    await page.keyboard.press("Escape");
    assert.equal(await page.isVisible("#bk-to-pop"), false);
    assert.equal(await page.inputValue("#bk-to"), "jfk");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.isVisible("#bk-to-pop"), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.isVisible("#bk-to-pop"), false);
    assert.equal(await page.inputValue("#bk-to"), "jfk");
    await page.click("#bk-from");
    await page.keyboard.press("End");
    await page.keyboard.type(" x");
    assert.deepEqual([await page.inputValue("#bk-from-id"), await page.inputValue("#bk-from-ticket")], ["", ""]);
    await page.keyboard.press("Escape");
  });
  await check("B2 the clear button empties the box and its hidden fields", async () => {
    await place(page, "from", "jfk", "John F. Kennedy (JFK), Terminal 5");
    assert.equal(await page.isVisible("#bk-from-x"), true);
    await page.click("#bk-from-x");
    assert.deepEqual([await page.inputValue("#bk-from"), await page.inputValue("#bk-from-id")], ["", ""]);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-from");
    assert.equal(await page.isVisible("#bk-from-x"), false);
    await page.keyboard.press("Escape");
  });
  await check("B3 the typed row shows the server area, then the badge, with no Google group without mocks", async () => {
    for (const [text, area] of [["350 5th Ave, 10118", "Manhattan"], ["350 5th Ave", "ZIP code needed"], ["Hoboken, NJ 07030", "Outside New York City"]]) {
      await type(page, "to", text);
      await page.waitForFunction((a) => document.querySelector('#bk-to-list [data-kind="typed"] .bk-opt__area')?.textContent === a, area);
      assert.equal(await page.$("#bk-to-g2"), null);
      assert.equal(await page.$("#bk-to-pop .bk-attr"), null);
      await page.keyboard.press("Escape");
      assert.equal(await page.textContent("#bk-to-area"), area);
      assert.equal(await page.isVisible("#bk-to-area"), true);
      assert.deepEqual([await page.getAttribute("#bk-to", "aria-describedby"), await page.textContent("#bk-status")], [area === "ZIP code needed" ? "e-to-zip bk-to-area" : "bk-to-area", `Drop-off: ${area}`]);
      assert.equal(await page.isVisible("#e-to-zip"), area === "ZIP code needed", "the ZIP hint shows as a hint once the box is left with an unknown area");
      assert.equal(await page.getAttribute("#bk-to", "aria-invalid"), null, "a ZIP hint is never an error");
      const [badgeTop, badgeBottom, inputTop, inputBottom, cut] = await page.evaluate(() => {
        const b = document.getElementById("bk-to-area"), r = b.getBoundingClientRect(), i = document.getElementById("bk-to").getBoundingClientRect();
        return [r.top, r.bottom, i.top, i.bottom, b.scrollWidth > b.clientWidth];
      });
      assert.ok(badgeBottom - inputTop <= 26 || badgeTop >= inputBottom - 1, `the badge sits in the label row or under the box (${badgeTop - inputTop}px)`);
      assert.equal(cut, false, "the badge text is not cut");
    }
    assert.deepEqual(page.errors, []);
  });
  await page.close();
  await ctx.close();
}

{
  const ctx = await context(P);
  const page = await open(ctx, P, "/book");
  await check("B3 without keys an unplaced end shows its ZIP hint, not an error, Book your ride passes on the first press to the unplaced row, and its Edit trip returns to that box", async () => {
    await place(page, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await type(page, "to", "edition");
    await page.waitForFunction(() => document.querySelector('#bk-to-list [data-kind="typed"] .bk-opt__area')?.textContent === "ZIP code needed");
    await page.keyboard.press("Escape");
    assert.deepEqual([await page.isVisible("#e-to-zip"), await page.getAttribute("#bk-to", "aria-invalid")], [true, null]);
    await pickDate(page, "#bk-date-btn", DATE);
    await setTime(page, "12:40");
    await page.click("#bk-view");
    await page.waitForSelector("#q-unplaced", { state: "visible" });
    assert.equal(await page.getAttribute("#book-form", "data-step"), "options");
    assert.equal((await page.textContent("#q-unplaced p")).trim(), REASONS.unplaced.text);
    assert.ok(!REASONS.unplaced.text.includes("from the list"));
    assert.equal(await page.textContent("#bk-bar-q"), "Add the ZIP code to see the price");
    await page.click("#q-edit");
    assert.deepEqual([await page.getAttribute("#book-form", "data-step"), await page.isVisible("#e-to-zip"), await page.evaluate(() => document.activeElement.id)], ["search", true, "bk-to"]);
    await page.fill("#bk-to", "The New York EDITION, 10010");
    await view(page);
    await priced(page);
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), cash(TOTAL));
  });
  await check("B3 a missing pickup time shows its message under Pickup time", async () => {
    await page.click("#bk-edit");
    await setTime(page, "");
    await page.click("#bk-view");
    assert.deepEqual([await page.isVisible("#e-time"), await page.isVisible("#e-date"), await page.evaluate(() => document.activeElement.id)], [true, false, "bk-time-btn"]);
    assert.deepEqual(await page.evaluate(() => ["aria-invalid", "aria-describedby"].map((a) => document.getElementById("bk-time-btn").getAttribute(a))), ["true", "e-time"], "the error marks the time field the rider sees");
    assert.ok(await page.evaluate(() => document.getElementById("bk-time-f").contains(document.getElementById("e-time"))));
  });
  await page.close();
  await ctx.close();
}

{
  const ctx = await context(G);
  const page = await open(ctx, G, "/book");
  const routeBodies = [];
  page.on("request", (r) => r.url().endsWith("/api/route") && routeBodies.push(JSON.parse(r.postData())));
  await check("B4 with GOOGLE_MOCK, edition shows the Google group with its attribution and the typed row", async () => {
    await type(page, "from", "edition");
    await page.waitForSelector("#bk-from-g2");
    assert.equal(await page.textContent("#bk-from-g2"), "Google Maps results");
    const r = await rows(page, "from");
    assert.deepEqual(r.map((x) => x[0]), ["google", "typed"]);
    assert.equal(r[0][1], "The New York EDITION");
    assert.equal(await page.textContent("#bk-from-o0 b"), "EDITION");
    assert.equal(await page.textContent("#bk-from-o0 .bk-opt__sub"), "Madison Avenue, New York, NY", "Google rows drop the trailing USA");
    assert.ok(await page.$('#bk-from-o0 use[href="#i-building"]'));
    assert.equal(await page.textContent("#bk-from-pop .bk-attr"), "Google Maps");
    assert.equal(await page.getAttribute("#bk-from-pop .bk-attr", "translate"), "no");
    assert.equal(await page.$("#bk-from-g1"), null, "no local airport row for edition");
  });
  await check("B4 picking the Google row writes its text, stores a ticket and moves on", async () => {
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("#bk-from"), "The New York EDITION, Madison Avenue, New York, NY", "the field reads like the row, without the trailing USA");
    await page.waitForFunction(() => /^v1\./.test(document.getElementById("bk-from-ticket").value));
    assert.equal(await page.inputValue("#bk-from-id"), "");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-to");
    assert.equal(await page.isVisible("#bk-flight"), false, "a hotel pickup shows no flight number");
  });
  await check("B4 the hotel to JFK trip prices from the ticket", async () => {
    await place(page, "to", "jfk", "John F. Kennedy (JFK), Terminal 4");
    await pickDate(page, "#bk-date-btn", DATE);
    await setTime(page, "12:40");
    await view(page);
    await priced(page);
    assert.deepEqual(await cards(page), JFK_CARDS);
    assert.deepEqual((await panel(page)).lines, AIRPORT_LINES);
  });
  await check("B8 with GOOGLE_MOCK on a phone the route map shows above the summary card at the size the route request asked for, the route list in the summary card carries the drive time, the note the miles and minutes with the Google attribution, and the drive line stays hidden", async () => {
    await page.waitForFunction(() => /About/.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    await page.waitForSelector("#bk-map img");
    assert.equal(routeBodies.length, 1);
    const inner = await page.evaluate(() => { const m = document.getElementById("bk-map"); return { width: m.clientWidth, height: m.clientHeight }; });
    assert.deepEqual([await page.isVisible("#bk-map"), routeBodies[0].map], [true, inner]);
    assert.deepEqual(await page.$$eval("#bk-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMThe New York EDITION, Madison Avenue, New York, NY", "About 1:25 PMJFK Terminal 4"]);
    assert.equal(await page.textContent("#bk-route-n"), DRIVE_N);
    assert.equal((await page.innerText("#bk-route-n")).trim(), DRIVE_SEEN, "beside the map image its own Google logo is the attribution");
    assert.equal(await page.getAttribute("#bk-route-n .bk-attr", "translate"), "no");
    assert.deepEqual([await page.isVisible("#bk-drive"), await page.evaluate(() => document.getElementById("bk-route").closest("#bk-side .bk-pay") !== null)], [false, true]);
  });
  await check("B6 with FLIGHT_MOCK, EK201 three days ahead: Checking EK 201..., then the card with only the scheduled time, and Set pickup to from it", async () => {
    await page.click("#bk-edit");
    await place(page, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
    await place(page, "to", "350 5th Ave, New York, NY 10118");
    await page.route("**/api/flight", async (route) => (route.request().postData() || "").includes('"number"') ? (await new Promise((r) => setTimeout(r, 600)), route.continue().catch(() => {})) : route.continue());
    await page.fill("#bk-flight", "ek 201");
    await page.waitForFunction(() => document.getElementById("bk-flight-status").textContent === "Checking EK 201\u2026" && document.querySelector("#bk-flight-status .bk-ring[aria-hidden=true]"));
    await page.unroute("**/api/flight");
    await page.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc"));
    assert.equal(await page.textContent("#bk-flight-status b"), "EK 201 from Dubai lands 2:55 PM at Terminal 4.");
    assert.equal(await page.evaluate(() => document.getElementById("book-form").classList.contains("fl-off")), false);
    assert.equal(await page.textContent("#bk-flight-status"), "EK 201 from Dubai lands 2:55 PM at Terminal 4.Set pickup to 3:00 PM");
    assert.equal(await page.textContent("#bk-flight-status button"), "Set pickup to 3:00 PM");
    await page.click("#bk-flight-status button");
    assert.deepEqual([await page.inputValue("#bk-time"), await page.textContent("#bk-flight-status button"), await page.getAttribute("#bk-flight-status button", "aria-disabled"), await page.textContent("#bk-status")], ["15:00", "Pickup set to 3:00 PM", "true", "Pickup time set to 3:00 PM."]);
    assert.deepEqual(await page.evaluate(() => [document.getElementById("bk-time-f").classList.contains("is-tint"), document.getElementById("bk-time-btn").textContent]), [true, "3:00 PM"], "the time field shows the new time with the brief tint");
  });
  await check("B6 with FLIGHT_MOCK, EK201 tomorrow is live: lands at the scheduled time, now the estimate, and Set pickup to from the estimate", async () => {
    await pickDate(page, "#bk-date-btn", nyDate(1));
    await page.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes(", now "));
    assert.equal(await page.textContent("#bk-flight-status"), "EK 201 from Dubai lands 2:55 PM, now 3:10 PM, at Terminal 4.Set pickup to 3:10 PM");
    await page.click("#bk-flight-status button");
    assert.equal(await page.inputValue("#bk-time"), "15:10");
    await pickDate(page, "#bk-date-btn", DATE);
    await page.waitForFunction(() => /lands 2:55 PM at Terminal 4\.Set pickup/.test(document.getElementById("bk-flight-status").textContent));
  });
  await check("B6 only Delayed, Canceled and Diverted add a status word: Unknown, no status and Expected show none (P05)", async () => {
    const answer = (number, status) => ({ kind: "ok", flight: { airline: "Emirates", number, origin: { city: "Dubai", iata: "DXB" }, destination: { city: "New York", iata: "JFK" }, terminal: "4", scheduled: `${DATE} 14:55`, estimated: "", status, updated: "" } });
    await page.route("**/api/flight", (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      if (body.number === "EK203") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer("EK 203", "Unknown")) });
      if (body.number === "EK204") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer("EK 204", "")) });
      if (body.number === "EK205") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer("EK 205", "Delayed")) });
      return route.continue();
    });
    await page.fill("#bk-flight", "EK203");
    await page.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("EK 203"));
    assert.equal(await page.textContent("#bk-flight-status"), "EK 203 from Dubai lands 2:55 PM at Terminal 4.Set pickup to 3:00 PM");
    await page.fill("#bk-flight", "EK204");
    await page.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("EK 204"));
    assert.equal(await page.textContent("#bk-flight-status"), "EK 204 from Dubai lands 2:55 PM at Terminal 4.Set pickup to 3:00 PM");
    await page.fill("#bk-flight", "EK205");
    await page.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("EK 205"));
    assert.equal(await page.textContent("#bk-flight-status"), "EK 205 from Dubai lands 2:55 PM at Terminal 4. Delayed.Set pickup to 3:00 PM");
    await page.unroute("**/api/flight");
    await page.fill("#bk-flight", "EK201");
    await page.waitForFunction(() => /EK 201 from Dubai lands 2:55 PM at Terminal 4\.Set pickup/.test(document.getElementById("bk-flight-status").textContent));
  });
  await check("B6 ZZ9999 gives the not found sentence, ZZ5000 the quiet fallback", async () => {
    await page.fill("#bk-flight", "ZZ9999");
    const want = `We couldn't find ZZ 9999 on ${shortDate(DATE)}. Check the number, or book without it.`;
    await page.waitForFunction((w) => document.getElementById("bk-flight-status").textContent === w, want);
    await page.fill("#bk-flight", "ZZ5000");
    await page.waitForFunction(() => document.getElementById("bk-flight-status").textContent === "Set the pickup time to your scheduled landing time. We track your flight.");
  });
  await check("B6 the flight number is optional: no Book without flight number or Add flight number buttons, an empty field books as it is", async () => {
    assert.deepEqual([await page.$("#bk-noflight"), await page.$("#bk-addflight")], [null, null]);
    await page.fill("#bk-flight", "");
    assert.equal(await page.textContent("#bk-flight-status"), "Set the pickup time to your scheduled landing time. We track your flight.");
    assert.equal(await page.isVisible("#bk-flight"), true);
  });
  await page.close();
  await ctx.close();
}

{
  const ctx = await context(P);
  const page = await open(ctx, P, "/book");
  await check("B5 the calendar: today marked current and bookable online until its last hour, past days disabled, it opens on the date that filled in by itself, or with no date on the first bookable day, New York time, keys, Escape returns focus", async () => {
    const auto = await page.inputValue("#bk-date");
    await page.click("#bk-date-btn");
    assert.equal(await page.getAttribute("#bk-date-btn", "aria-expanded"), "true");
    const today = nyDate(0), first = await page.evaluate(() => document.activeElement.dataset.day), late = firstDay() > today;
    assert.equal(first, auto, `the calendar opens on ${first}, the date that filled in by itself`);
    assert.equal(await page.getAttribute(`#bk-cal [data-day="${today}"]`, "aria-current"), "date");
    assert.equal(await page.evaluate((d) => document.querySelector(`#bk-cal [data-day="${d}"]`).classList.contains("is-mute"), today), late, "today is muted only once its last time is inside the hour");
    assert.equal(await page.getAttribute(`#bk-cal [data-day="${today}"]`, "aria-label"), new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) + (late ? ", email or WhatsApp only" : ""));
    assert.equal(await page.isDisabled(`#bk-cal [data-day="${today}"]`), false, "today stays pickable");
    assert.match(await page.textContent(".bk-cal__tz"), /^New York time(, now \d{1,2}:\d\d [AP]M)?$/);
    assert.equal(await page.evaluate(() => (document.querySelector("#bk-cal .bk-cal__note") || {}).textContent || null), late ? HOUR_NOTE : null);
    assert.equal(await page.$(".bk-cal__note a"), null, "no phone, email or WhatsApp link inside the calendar (owner changes 1 and 3)");
    const past = await page.$$eval("#bk-cal [data-day]", (b) => b.filter((x) => x.dataset.day < x.ownerDocument.querySelector('[aria-current="date"]').dataset.day).map((x) => x.disabled));
    assert.ok(past.every(Boolean));
    assert.equal(await page.isDisabled('#bk-cal .bk-cal__nav[data-dir="-1"]'), true);
    assert.deepEqual(await page.$$eval("#bk-cal th", (t) => t.map((x) => x.getAttribute("abbr"))), ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.day), new Date(Date.parse(first) + 7 * 864e5).toISOString().slice(0, 10));
    await page.keyboard.press("PageDown");
    assert.notEqual(await page.textContent(".bk-cal__month"), "");
    await page.keyboard.press("PageUp");
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.day), first);
    await page.keyboard.press("Escape");
    assert.equal(await page.isVisible("#bk-cal"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-date-btn");
    assert.equal(await page.getAttribute("#bk-date-btn", "aria-expanded"), "false");
    await page.evaluate(() => { ED.value = ET.value = ""; AD = AT = 0; bt(); });
    await page.click("#bk-date-btn");
    const none = await page.evaluate(() => document.activeElement.dataset.day);
    assert.equal(none, firstDay(), `with no date the calendar opens on ${none}, the first day with a pickup time at least 1 hour away`);
    await page.keyboard.press("Escape");
  });
  await check("B5 picking a day shows it as Thu, Oct 15 style text and moves focus to the pickup time", async () => {
    await page.click("#bk-date-btn");
    const first = await page.evaluate(() => document.activeElement.dataset.day);
    for (let i = 0; i < Math.round((Date.parse(DATE) - Date.parse(first)) / 864e5); i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("#bk-date"), DATE);
    assert.equal(await page.textContent("#bk-date-btn"), shortDate(DATE));
    assert.equal(await page.isVisible("#bk-cal"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-time-btn");
    await page.click("#bk-date-btn");
    assert.equal(await page.getAttribute(`#bk-cal [data-day="${DATE}"]`, "aria-pressed"), "true");
    await page.mouse.click(5, 5);
    await page.waitForTimeout(100);
    assert.equal(await page.isVisible("#bk-cal"), false);
  });
  await check("B6 without the flight mock a flight number shows the quiet line and the booking still prices", async () => {
    await place(page, "from", "lga", "LaGuardia (LGA)");
    await place(page, "to", "350 5th Ave, New York, NY 10118");
    await page.fill("#bk-flight", "EK201");
    await page.waitForTimeout(1100);
    assert.equal(await page.textContent("#bk-flight-status"), "Set the pickup time to your scheduled landing time. We track your flight.");
    const [off, h] = await page.evaluate(() => [document.getElementById("book-form").classList.contains("fl-off"), document.getElementById("bk-flight-status").getBoundingClientRect().height]);
    assert.ok(off && h <= 40, `fl-off ${off}, the idle line ${h}px (at most two lines at 390)`);
    await setTime(page, "12:40");
    await view(page);
    await priced(page);
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), cash(AIRPORT_TOTALS.suv.lga));
    assert.deepEqual(await cards(page), ["$165.00", "$190.00", "$250.00", "$145.00", "$350.00"]);
  });
  await check("B8 without Google keys there is no route figure and no reserved space", async () => {
    assert.deepEqual([await page.isVisible("#bk-map"), await page.isVisible("#bk-drive"), await page.$("#bk-map img")], [false, false, null]);
  });
  await page.close();
  await ctx.close();
}

{
  const ctx = await context(P);
  const page = await open(ctx, P, "/book");
  await check("B7 Book your ride switches to step 2 at once with the summary, the placeholder lines and focus on the heading, Finding prices... only after 150 ms", async () => {
    await trip(page);
    await page.route("**/api/book", async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue().catch(() => {});
    });
    await page.click("#bk-view");
    const s = await page.evaluate(() => ({
      step: document.getElementById("book-form").dataset.step,
      focus: document.activeElement.id,
      wait: document.getElementById("bk-wait").textContent,
      lines: [...document.querySelectorAll("#price-lines tr:not(.bk-hint)")].map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]),
      hints: [...document.querySelectorAll("#price-lines tr.bk-hint")].map((tr) => tr.textContent),
      total: (document.getElementById("price-total").firstChild || {}).textContent,
      sum: document.getElementById("bk-sum").textContent,
      search: getComputedStyle(document.getElementById("bk-search")).display,
    }));
    assert.deepEqual(s, {
      step: "options",
      focus: "bk-opt-h",
      wait: "",
      lines: [["Fare", "..."], ["NYC sales tax", "..."], ["Black Car Fund", "..."], ["Tolls and airport fees", "..."]],
      hints: ["Pays for drivers' workers' compensation.", "The same in every class."],
      total: "...",
      sum: `Change JFK Terminal 4 to 350 5th Ave, New YorkChange ${shortDate(DATE)}, 12:40 PMEdit trip`,
      search: "contents",
    });
    assert.deepEqual(await page.evaluate(() => [...document.getElementById("bk-search").children].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.id)), ["bk-status"], "only the status line of step 1 stays in the page in step 2");
    await page.waitForFunction(() => document.getElementById("bk-wait").textContent === "Finding prices\u2026");
    assert.deepEqual(await page.evaluate(() => [location.hash, [...document.querySelectorAll("#bk-sum .bk-chip")].length, document.getElementById("bk-opt-h").textContent, document.getElementById("bk-bar-go").disabled, document.getElementById("bk-choice").textContent]), ["#options", 2, "Step 2 of 4 Choose your vehicle", false, "Business SUVChevrolet Suburban or similar"]);
    await priced(page);
    await page.unroute("**/api/book");
  });
  await check("B7 five rows at their class totals with the scope word, in class order, the exact lines with their hints, total and the two later-charges rows, Book and pay online enabled", async () => {
    assert.deepEqual(await page.$$eval("#bk-cards input[name=class]", (r) => r.map((x) => x.value)), CLASS_KEYS);
    assert.deepEqual(await cards(page), JFK_CARDS);
    assert.deepEqual(await scopes(page), Array(5).fill("total"));
    assert.deepEqual(JFK_CARDS, CLASS_KEYS.map((k) => cash(AIRPORT_TOTALS[k].jfk)));
    assert.deepEqual(await panel(page), { lines: AIRPORT_LINES, total: cash(TOTAL), notes: NOTES.included + POLICY.later.airport });
    assert.deepEqual(await page.$$eval("#price-notes li", (l) => l.map((x) => [x.querySelector("use").getAttribute("href"), x.textContent])), [["#i-check", NOTES.included], ["#i-clock", POLICY.later.airport]]);
    assert.deepEqual(await page.$$eval("#price-lines tr.bk-hint", (r) => r.map((x) => [x.cells.length, x.cells[0].colSpan, x.textContent])), [[1, 2, "Pays for drivers' workers' compensation."], [1, 2, "The same in every class."]]);
    assert.deepEqual(await page.$$eval("#bk-tip-opts label", (l) => l.map((x) => [...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""))), ["None", "Other", "20%", "15%", "10%"], "None, Other, then the percents from the highest (owner request 1)");
    assert.deepEqual(await page.$$eval("#bk-tip-opts input", (l) => l.map((x) => x.value)), ["0", "custom", ...TIP_PERCENTS.filter(Boolean).sort((a, b) => b - a).map(String)]);
    assert.equal(await page.isChecked("#bk-t-0"), true);
    assert.deepEqual([await page.isVisible("#bk-bar-go"), await page.isEnabled("#bk-bar-go"), await page.isVisible("#bk-next"), await page.isVisible("#bk-submit"), await page.isVisible("#bk-tip"), await page.isVisible("#bk-meet-f")], [true, true, true, false, false, false], "step 2 shows Book and pay online in the bar and under the rows, meet and greet waits for step 3");
    assert.deepEqual(await page.evaluate(() => [document.getElementById("bk-tot").innerText.replace(/\s+/g, " "), ...["bk-next", "q-mail", "q-wa"].map((i) => [document.getElementById(i).className, document.getElementById(i).textContent.trim()])]), [`Total ${cash(TOTAL)}`, ["btn bk-js-only is-shown", "Book and pay online"], ["btn btn--ghost", "Email to reserve"], ["btn btn--ghost", "WhatsApp to reserve"]]);
    assert.equal(await page.textContent("#bk-bar-total"), `${cash(TOTAL)} total`);
    assert.equal(await page.isVisible("#quote"), false);
    assert.deepEqual([await page.isChecked("#bk-meet-no"), await page.isChecked("#bk-meet"), await page.textContent("#bk-meet-p"), await page.textContent("#bk-meet-f .bk-mrow__p")], [true, false, cash(MEET_AND_GREET).replace(/^/, "+"), "Included"]);
    assert.equal(await page.textContent("#bk-wait"), `Your price: ${cash(TOTAL)}`);
    assert.equal(await page.getAttribute("#bk-result", "aria-live"), null);
  });
  await check("B7 Book and pay online opens step 3, a 15% tip adds its own line there and meet and greet, beside the gratuity, adds its fee", async () => {
    const tip = percentCents(FARE, "15");
    await next(page);
    assert.deepEqual(await page.evaluate(() => [location.hash, document.activeElement.id, document.activeElement.textContent, getComputedStyle(document.getElementById("bk-sum")).display]), ["#details", "bk-det-h", "Step 3 of 4 Your details", "none"], "the step count is part of the focused heading, the trip line waits in Check your trip");
    assert.deepEqual([await page.isVisible("#bk-tip"), await page.isVisible("#bk-submit"), await page.isVisible("#bk-consent"), await page.isVisible("#bk-cards"), await page.isVisible("#bk-bar-go"), (await page.textContent("#bk-bar-go")).trim()], [true, true, true, false, false, "Book and pay online"], "below 1024 the details step has no bar over the form, the pay button follows the total (owner request 4)");
    assert.deepEqual([await page.getByRole("radio", { name: "Other amount" }).count(), await page.isVisible("#bk-tipamt")], [1, false], "Other is read as Other amount, its field waits until it is chosen");
    await page.click('label[for="bk-t-15"]');
    assert.deepEqual([await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), await page.getAttribute("#price-total", "aria-busy")], [cash(TOTAL), "true"], "a reprice keeps the old total readable and busy");
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + tip));
    assert.deepEqual((await panel(page)).lines, [...AIRPORT_LINES, ["Gratuity for your chauffeur (15%)", cash(tip)]]);
    assert.deepEqual([tip, TOTAL + tip], [2325, 20825]);
    assert.ok(await page.evaluate(() => document.getElementById("bk-tip").nextElementSibling === document.getElementById("bk-meet-f") && document.getElementById("bk-meet-f").getBoundingClientRect().bottom <= document.getElementById("bk-submit").getBoundingClientRect().top), "meet and greet sits beside the gratuity, above the pay button");
    await page.check("#bk-meet");
    assert.deepEqual((await panel(page)).lines.slice(-2), [["Meet and greet", "..."], ["Gratuity for your chauffeur (15%)", "..."]]);
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + tip + MEET_AND_GREET));
    assert.deepEqual((await panel(page)).lines, [...AIRPORT_LINES, ["Meet and greet", cash(MEET_AND_GREET)], ["Gratuity for your chauffeur (15%)", cash(tip)]]);
    assert.equal(await page.$eval("#bk-tot-v", (x) => x.firstChild.textContent), cash(TOTAL + tip + MEET_AND_GREET), "the total above the pay button follows");
    await page.check("#bk-meet-no");
    await page.click('label[for="bk-t-0"]');
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL));
    assert.deepEqual((await panel(page)).lines, AIRPORT_LINES);
    await page.click("#bk-back");
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(page);
  });
  await check("B7 who fits: with 4 passengers First Class and Sedan & Electric show Seats 3 and stay selectable, choosing one shows the seats request with Show cars for 4, with 6 the selection moves to Luxury Sprinter with its status line", async () => {
    await pax(page, 4);
    await page.waitForFunction(() => document.getElementById("bk-p-first").textContent === "Seats 3");
    assert.deepEqual(await cards(page), [JFK_CARDS[0], JFK_CARDS[1], "Seats 3", "Seats 3", JFK_CARDS[4]]);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".bk-card")].map((l) => l.classList.contains("is-small"))), [false, false, true, true, false]);
    assert.deepEqual([await page.getAttribute("#bk-c-first", "aria-describedby"), await page.textContent("#bk-fit")], ["bk-fit bk-m-first bk-s-first bk-b-first", "Too small for 4 passengers"]);
    assert.equal(await page.textContent("#bk-pax-f output"), "4 passengers");
    await page.waitForFunction(() => !document.getElementById("price-total").getAttribute("aria-busy"));
    await page.click('label[for="bk-c-first"]');
    assert.deepEqual([await page.isVisible("#q-seats"), await page.isVisible("#price"), await page.isVisible("#bk-bar-go"), await page.isVisible("#bk-bar-mail"), await page.textContent("#bk-bar-q"), await page.isVisible("#bk-next"), await page.getAttribute("#q-mail", "class"), await page.getAttribute("#q-wa", "class")], [true, false, false, true, "Too small for 4 passengers", false, "btn", "btn btn--ghost"], "a request: Email to reserve turns gold first, WhatsApp to reserve second, no pay button");
    assert.equal((await page.textContent("#q-seats h3")).trim(), HEADINGS.phone);
    assert.deepEqual([await page.isVisible("#q-fix"), await page.textContent("#q-fix")], [true, "Show cars for 4"]);
    await page.click("#q-fix");
    await priced(page);
    assert.equal(await page.evaluate(() => document.querySelector("[name=class]:checked").value), "suv");
    await pax(page, 6);
    assert.equal(await page.evaluate(() => document.querySelector("[name=class]:checked").value), "sprinter");
    assert.match(await page.textContent("#bk-wait"), /^Changed to Luxury Sprinter for 6 passengers\./);
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, JFK_CARDS[4]);
    assert.deepEqual(await cards(page), ["Seats 5", "Seats 5", "Seats 3", "Seats 3", JFK_CARDS[4]]);
    assert.equal(await page.isVisible("#q-seats"), false);
    assert.match(await waText(page, CHROME_WA), /Vehicle: Luxury Sprinter[\s\S]*Total shown: \$400\.00/);
    await pax(page, 1);
    await page.click('label[for="bk-c-suv"]');
    await priced(page);
  });
  await check("B7 a passenger change marks the rows that are too small at once, before the answer, keeps the old total readable and busy, and comes back", async () => {
    await page.route("**/api/book", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue().catch(() => {});
    });
    await pax(page, 6);
    assert.deepEqual(await cards(page), ["Seats 5", "Seats 5", "Seats 3", "Seats 3", JFK_CARDS[4]], "the marks come before the answer");
    assert.deepEqual([await page.isVisible("#price"), await page.getAttribute("#price-total", "aria-busy"), await page.evaluate(() => document.querySelector("[name=class]:checked").value)], [true, "true", "sprinter"]);
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t && !document.getElementById("price-total").getAttribute("aria-busy"), JFK_CARDS[4]);
    await pax(page, 1);
    assert.deepEqual(await cards(page), ["...total", "...total", "...total", "...total", JFK_CARDS[4]], "rows that fit again wait for their prices, the scope drawn with the skeleton");
    await page.click('label[for="bk-c-suv"]');
    await priced(page);
    await page.unroute("**/api/book");
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), cash(TOTAL));
    assert.deepEqual(await cards(page), JFK_CARDS);
  });
  await check("B7 by the hour: Sprinter priced by dispatch, the Vehicle select with totals and the hourly lines", async () => {
    await page.click("#bk-edit");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-from");
    await page.click('label[for="bk-hour"]');
    await place(page, "from", "277 Bedford Ave, Brooklyn, NY 11211");
    await view(page);
    await priced(page);
    assert.deepEqual(await cards(page), [cash(hourly("suv-suburban")), cash(hourly("premium")), cash(hourly("first")), cash(hourly("sedan")), "Price on request"]);
    assert.equal(cash(hourly("first")), "$583.40");
    assert.equal(await page.isVisible("#bk-vehicle"), true);
    assert.deepEqual(await page.$$eval("#bk-vehicle option", (o) => o.map((x) => x.textContent)), ["suv-suburban", "suv-denali", "suv-navigator"].map((v) => `${cash(hourly(v))}, ${VEHICLES[v].model}`));
    const fare = VEHICLES["suv-suburban"].hourly * 3;
    assert.deepEqual(await panel(page), { lines: [["Fare, 3 hours", cash(fare)], [L_TAX, cash(percentCents(fare, NYC_TAX_PERCENT))], [L_BCF, cash(percentCents(fare, BCF_PERCENT))]], total: cash(hourly("suv-suburban")), notes: NOTES.hourly });
    assert.equal(await page.isVisible("#bk-meet"), false);
    await page.selectOption("#bk-vehicle", "suv-navigator");
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(hourly("suv-navigator")));
    await page.click('label[for="bk-c-premium"]');
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(hourly("premium")));
    assert.equal(await page.isVisible("#bk-vehicle"), false);
    assert.deepEqual(await page.$eval("#bk-choice", (c) => [c.firstChild.textContent, c.querySelector("small").textContent]), ["Business Premium SUV", "Cadillac Escalade ESV"]);
    assert.match(await waText(page, CHROME_WA), /Trip: By the hour, 3 hours[\s\S]*Vehicle: Cadillac Escalade ESV \(Business Premium SUV\)/);
    await page.click('label[for="bk-c-sprinter"]');
    assert.equal(await page.isVisible("#q-sprinter-hourly"), true);
    assert.equal(await page.isVisible("#bk-vehicle"), false);
    await page.click('label[for="bk-c-suv"]');
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(hourly("suv-navigator")));
    assert.match(await waText(page, CHROME_WA), /Trip: By the hour, 3 hours[\s\S]*Vehicle: Lincoln Navigator \(Business SUV\)/);
  });
  await check("B9 a stop with a non-airport leg shows the stop-leg block, removing it restores the price", async () => {
    await page.click("#bk-edit");
    await page.click('label[for="bk-one"]');
    await place(page, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
    await place(page, "to", "350 5th Ave, New York, NY 10118");
    await page.click("#bk-addstop");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-stop1");
    await place(page, "stop1", "277 Bedford Ave, Brooklyn, NY 11211");
    await page.click("#bk-view");
    await page.waitForSelector("#q-stop-leg", { state: "visible" });
    assert.equal(await page.isVisible("#price"), false);
    assert.equal(await page.isVisible("#bk-bar-go"), false);
    assert.deepEqual(await cards(page), Array(5).fill(""), "a reason for every class leaves the price slots empty");
    assert.deepEqual([await page.isVisible("#bk-qline"), await page.textContent("#bk-qline"), await page.textContent("#q-fix"), await page.textContent("#bk-bar-q")], [true, "Price on request for this trip. Remove the stop", "Remove the stop", "With a stop, our dispatch team prices it"]);
    assert.match(await page.textContent("#bk-sum"), /Terminal 4 to 277 Bedford Ave, Brooklyn to 350 5th Ave/);
    assert.match(await waText(page, "#q-wa"), /Stop 1: 277 Bedford Ave, Brooklyn, NY 11211/);
    assert.ok(await page.evaluate(() => document.getElementById("bk-tip").disabled && document.getElementById("bk-meet").matches(":disabled")), "tip and meet and greet are off on the stop-leg block");
    assert.equal(await page.textContent("#bk-wait"), HEADINGS.price);
    await page.click("#bk-edit");
    await page.click("#bk-stop1-rm");
    assert.equal(await page.isVisible("#bk-stop1"), false);
    await view(page);
    await priced(page);
    assert.equal(await page.isVisible("#q-stop-leg"), false);
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), cash(TOTAL));
    assert.ok(await page.evaluate(() => !document.getElementById("bk-tip").disabled && !document.getElementById("bk-meet").disabled));
  });
  await check("B9 a stop shows Add stop again until two stops exist", async () => {
    await page.click("#bk-edit");
    await page.click("#bk-addstop");
    assert.equal(await page.isVisible("#bk-stop1-pop"), false, "an empty stop next to an airport pickup opens no list");
    await page.click("#bk-addstop");
    assert.deepEqual([await page.isVisible("#bk-stop1"), await page.isVisible("#bk-stop2"), await page.isVisible("#bk-addstop")], [true, true, false]);
    await page.click("#bk-view");
    assert.equal(await page.getAttribute("#bk-stop1", "aria-invalid"), "true");
    assert.equal(await page.isVisible("#e-stop1"), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-stop1");
    await page.click("#bk-stop2-rm");
    await page.click("#bk-stop1-rm");
    assert.deepEqual([await page.isVisible("#bk-stop1"), await page.isVisible("#bk-addstop")], [false, true]);
  });
  await check("B10 a return trip shows the summary, the two leg total and the summed lines", async () => {
    await page.click("#bk-addret");
    assert.equal(await page.textContent("#bk-ret-sum"), "Return: 350 5th Ave, New York, NY 10118 to JFK Terminal 4");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-rdate-btn");
    assert.equal(await page.isVisible("#bk-addret"), false);
    await page.click("#bk-view");
    assert.equal(await page.isVisible("#e-return-date"), true);
    await pickDate(page, "#bk-rdate-btn", RDATE);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-rtime-btn");
    await setTime(page, "18:00", "#bk-rtime");
    assert.equal(await page.isVisible("#bk-rflight"), false, "the return pickup is not an airport");
    await view(page);
    await priced(page);
    const f = FARE * 2, t = TAX * 2, b = BCF * 2;
    assert.deepEqual(await panel(page), { lines: [["Fare", cash(f)], [L_TAX, cash(t)], [L_BCF, cash(b)], ["Tolls and airport fees", cash(TOTAL * 2 - f - t - b)]], total: cash(TOTAL * 2), notes: NOTES.included + POLICY.later.airport });
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), "$370.00");
    assert.deepEqual(await cards(page), ["$370.00", "$440.00", "$620.00", "$340.00", "$800.00"]);
    assert.deepEqual(await scopes(page), Array(5).fill("total, both rides"));
    assert.equal(await page.evaluate(() => document.getElementById("price-total").previousElementSibling.textContent), "Total, both rides");
    assert.match(await page.textContent("#bk-sum"), new RegExp(`Return: ${shortDate(RDATE)}, 6:00 PM`));
    await next(page);
    await page.click('label[for="bk-t-15"]');
    await page.waitForFunction(() => (document.getElementById("price-total").firstChild || {}).textContent === "$416.50");
  });
  await check("B10 Remove return trip clears the return fields", async () => {
    assert.equal(await page.isVisible("#bk-edit"), false, "on step 3 Edit trip sits in Check your trip");
    await page.click("#bk-check-edit");
    await page.click("#bk-rmret");
    assert.deepEqual([await page.inputValue("#bk-rdate"), await page.inputValue("#bk-rtime"), await page.isVisible("#bk-ret-f"), await page.isVisible("#bk-addret"), await page.isChecked("#bk-ret")], ["", "", false, true, false]);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-addret");
  });
  await page.close();
  await ctx.close();
}

{
  const ctx = await context(P);
  const page = await open(ctx, P, "/book");
  let ref = "";
  await check("B14 every data-wa link carries the trip text the browser knows, and the answer link after Book your ride", async () => {
    const hrefs = () => page.$$eval("a[data-wa]", (a) => a.map((x) => x.getAttribute("href")));
    const before = await hrefs();
    assert.equal(before.length, 5, "the five chrome WhatsApp links carry data-wa, the booking buttons fill their own text");
    assert.equal(await page.getAttribute("#q-wa", "data-wa"), null);
    await trip(page);
    await page.waitForFunction(() => decodeURIComponent(document.querySelector(".site-footer a[data-wa]").getAttribute("href")).includes("Time: 12:40 PM"));
    const texts = (await hrefs()).map((h) => decodeURIComponent(h.split("?text=")[1] || ""));
    assert.ok(texts.every((t) => t === texts[0]), "all data-wa links share the text");
    assert.equal(texts[0], ["Hi NYC LUX RIDE, I would like to book this trip.", "Trip: One way", "Pickup: JFK Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", `Date: ${new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`, "Time: 12:40 PM", "Passengers: 1"].join("\n"));
    await view(page);
    await priced(page);
    const wa = await waText(page, CHROME_WA);
    assert.match(wa, /^Hi NYC LUX RIDE, I would like to book this trip\.\nReference: [1-9]\d{7}\n/);
    assert.match(wa, /Vehicle: Business SUV\nTotal shown: \$185\.00$/);
    assert.equal(await waText(page, "#q-wa"), wa);
    assert.match(await page.getAttribute("#q-mail", "href"), /^mailto:info@nycluxride\.com\?subject=Booking%20request%20[1-9]\d{7}&/);
    assert.equal(decodeURIComponent((await page.getAttribute("#q-mail", "href")).split("&body=")[1]), wa);
    await next(page);
    await page.check("#bk-meet");
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + MEET_AND_GREET));
    await page.waitForTimeout(400);
    const met = await waText(page, CHROME_WA);
    assert.match(met, /Meet and greet: Yes\nTotal shown: \$210\.00$/);
    assert.equal(await waText(page, "#q-wa"), `${met}\nContact: Phone`, "on the payment step the buttons add the details typed so far");
    await page.check("#bk-meet-no");
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL));
    await page.click("#bk-back");
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(page);
  });
  await check("B14 the header and action bar Book a car links stay on /book, marked current", async () => {
    assert.deepEqual(await page.evaluate(() => [".site-header__desk a.btn", ".actionbar__cell--book", ".nav-panel__book a"].map((s) => [document.querySelector(s).getAttribute("href"), document.querySelector(s).getAttribute("aria-current")])), [["#book-form", "page"], ["#book-form", "page"], ["/book", null]]);
    let nav = false;
    page.on("request", (r) => r.isNavigationRequest() && (nav = true));
    await page.evaluate(() => document.querySelector(".actionbar__cell--book").click());
    await page.waitForTimeout(200);
    assert.equal(nav, false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-bar-go");
    assert.equal(await page.isVisible("#price"), true);
  });
  await check("B11 Book and pay online reaches the mock confirmation through step 3 with the receipt lines and one purchase call", async () => {
    await next(page);
    await page.check("#bk-meet");
    await page.click('label[for="bk-t-20"]');
    const tip = percentCents(FARE, "20");
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + MEET_AND_GREET + tip));
    await page.click(await payBtn(page));
    assert.deepEqual(await page.evaluate(() => [document.activeElement.id, document.getElementById("e-name").classList.contains("is-on"), new URL(location.href).pathname]), ["bk-name", true, "/book"]);
    await details(page);
    assert.match(await page.inputValue("#bk-nonce"), /^[0-9a-f-]{36}$/);
    await Promise.all([page.waitForURL(/\/booking-confirmed/), page.click(await payBtn(page))]);
    await page.waitForSelector("#cf-receipt", { state: "visible" });
    const s = await page.evaluate(() => ({
      ref: document.getElementById("cf-ref").textContent,
      summary: document.getElementById("cf-summary").textContent,
      lines: [...document.querySelectorAll("#cf-lines tr")].map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]),
      total: document.getElementById("cf-total").textContent,
      test: !document.getElementById("cf-test").hidden,
      purchases: window.__purchases,
      stored: JSON.parse(sessionStorage.getItem("nlr-book")),
      search: location.search,
      wa: [...document.querySelectorAll("a[data-wa]")].map((a) => a.getAttribute("href")),
    }));
    ref = s.ref;
    assert.match(s.ref, /^[1-9]\d{7}$/);
    assert.ok(s.summary.includes("Business SUV"), s.summary);
    assert.deepEqual(s.lines, [...AIRPORT_LINES, ["Meet and greet", cash(MEET_AND_GREET)], ["Gratuity for your chauffeur (20%)", cash(tip)]]);
    assert.equal(s.total, cash(TOTAL + MEET_AND_GREET + tip));
    assert.equal(s.test, true);
    assert.equal(s.search, "");
    assert.deepEqual(s.purchases, [[`cs_mock_${s.ref}`, s.ref, FARE + MEET_AND_GREET]]);
    assert.deepEqual([s.stored.v, s.stored.step, s.stored.stops, s.stored.return, s.stored.fields.nonce, s.stored.fields.from_id, s.stored.fields.tip, s.stored.fields.meet, s.stored.fields.name, s.stored.fields.rider], [1, "details", 0, false, "", "jfk-t4", "20", "1", ME.name, "me"]);
    assert.ok(s.wa.every((h) => !h.includes("Pickup")), "the confirmation page rewrote a WhatsApp link");
    assert.deepEqual(page.errors, []);
  });
  await check("B11 a reload shows the receipt again without a second purchase call", async () => {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#cf-receipt", { state: "visible" });
    assert.equal(await page.textContent("#cf-ref"), ref);
    assert.deepEqual(await page.evaluate(() => window.__purchases), []);
  });
  await check("B12 a paid trip is never refilled: /book#resume shows the booked notice with its reference and an empty search", async () => {
    await page.goto(`${P.base}/book#resume`, { waitUntil: "load" });
    await page.waitForSelector("#booked", { state: "visible" });
    assert.deepEqual(await page.evaluate(() => [document.getElementById("booked-ref").textContent, document.getElementById("book-form").dataset.step, document.getElementById("bk-from").value, location.hash, document.querySelector("#booked a").getAttribute("href")]), [ref, "search", "", "", "/booking-confirmed"]);
    await page.goto(`${P.base}/rates`, { waitUntil: "load" });
    await page.evaluate(() => { const b = JSON.parse(sessionStorage.getItem("nlr-book")); delete b.paid; delete b.sid; sessionStorage.setItem("nlr-book", JSON.stringify(b)); });
  });
  await check("B12 /book#resume restores step 3, the choices, the details and the note, and prices again", async () => {
    await page.goto(`${P.base}/book`, { waitUntil: "load" });
    await trip(page);
    await view(page);
    await priced(page);
    await next(page);
    await page.check("#bk-meet");
    await page.click('label[for="bk-t-20"]');
    await page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + MEET_AND_GREET + percentCents(FARE, "20")));
    await details(page);
    await page.goto(`${P.base}/rates`, { waitUntil: "load" });
    await page.goto(`${P.base}/book#resume`, { waitUntil: "load" });
    await priced(page);
    assert.equal(await page.isVisible("#resume"), true);
    assert.equal(await page.getAttribute("#book-form", "data-step"), "details");
    assert.deepEqual(await page.evaluate(() => ["bk-name", "bk-email", "bk-phone"].map((id) => document.getElementById(id).value)), [ME.name, ME.email, ME.phone]);
    assert.deepEqual([await page.isVisible("#bk-bar-go"), (await page.textContent("#bk-bar-go")).trim(), await page.isVisible("#bk-submit"), await page.isVisible("#bk-cards")], [false, "Book and pay online", true, false], "no bar on the details step below 1024 (owner request 4)");
    assert.equal(await page.evaluate(() => document.activeElement.id), "resume", "the cancelled payment notice takes focus once");
    assert.equal((await page.textContent("#resume b")).trim(), "Payment not completed. Nothing was charged.");
    await page.click("#resume-go");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-submit", "Book and pay online in the notice focuses the pay button under the total at every width");
    assert.deepEqual(await page.evaluate(() => ["bk-from", "bk-from-id", "bk-to", "bk-date", "bk-time"].map((id) => document.getElementById(id).value)), ["JFK Terminal 4", "jfk-t4", "350 5th Ave, New York, NY 10118", DATE, "12:40"]);
    assert.equal(await page.isChecked("#bk-meet"), true);
    assert.equal(await page.isChecked("#bk-t-20"), true);
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), cash(TOTAL + MEET_AND_GREET + percentCents(FARE, "20")));
    assert.equal(await page.textContent("#bk-date-btn"), shortDate(DATE));
  });
  await check("B11 the nonce is cleared before leaving for payment and a page shown again gets a new one", async () => {
    const p2 = await open(ctx, P, "/book");
    await trip(p2);
    await view(p2);
    await priced(p2);
    await next(p2);
    await details(p2);
    const nonce = await p2.inputValue("#bk-nonce");
    await p2.route("**/booking-confirmed*", (r) => r.fulfill({ status: 204, body: "" }));
    await Promise.all([p2.waitForRequest((r) => r.url().includes("/booking-confirmed")), p2.click(await payBtn(p2))]);
    await p2.waitForTimeout(300);
    assert.deepEqual(await p2.evaluate(() => [document.getElementById("bk-nonce").value, JSON.parse(sessionStorage.getItem("nlr-book")).fields.nonce]), ["", nonce]);
    await p2.close();
  });
  await check("B11 a payment URL off Stripe is never followed and a broken answer shows the error block", async () => {
    const p3 = await open(ctx, P, "/book");
    await trip(p3);
    await view(p3);
    await priced(p3);
    await next(p3);
    await details(p3);
    await p3.route("**/api/book", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "pay", ref: "12345678", url: "https://example.com/c/pay/cs_test_a1" }) }));
    await p3.click(await payBtn(p3));
    await p3.waitForSelector("#q-error", { state: "visible" });
    assert.equal(new URL(p3.url()).pathname, "/book");
    assert.equal(await p3.isVisible("#bk-det-h .bk-stepno"), false, "a failed pay call has no step count");
    await p3.unroute("**/api/book");
    await p3.route("**/api/book", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>" }));
    await p3.click("#bk-back");
    await p3.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await p3.waitForSelector("#q-error", { state: "visible" });
    assert.match(decodeURIComponent(await p3.getAttribute("#q-wa", "href")), /^https:\/\/wa\.me\/16467750556\?text=Hi NYC LUX RIDE, I would like to book this trip\.\nReference: [1-9]\d{7}\nTrip: One way\nPickup: JFK Terminal 4/, "a failed call rebuilds the trip link with its reference, never the bare one");
    assert.match(decodeURIComponent(await p3.getAttribute("#q-mail", "href")), /^mailto:info@nycluxride\.com\?subject=Booking request [1-9]\d{7}&body=/, "the email subject keeps the trip reference after a failed call");
    assert.deepEqual([await p3.isVisible("#bk-bar-go"), await p3.isVisible("#bk-submit")], [false, false]);
    assert.deepEqual(p3.errors, []);
    await p3.close();
  });
  await check("B13 the old query hand-off fills the boxes, maps exact labels and aliases, rounds the time and clears the URL", async () => {
    const p4 = await open(ctx, P, `/book?trip-type=one&pickup=JFK+Airport&dropoff=350+Fifth+Avenue&hours=5&date=${DATE}&time=14%3A05&passengers=2&flight=DL+401&utm_source=x`);
    const v = await p4.evaluate(() => ["bk-one", "bk-from", "bk-from-id", "bk-to", "bk-to-id", "bk-date", "bk-time", "bk-pax", "bk-flight", "bk-hours"].map((id) => { const e = document.getElementById(id); return e.type === "radio" ? e.checked : e.value; }));
    assert.deepEqual(v, [true, "JFK Airport", "jfk", "350 Fifth Avenue", "", DATE, "14:10", "2", "DL 401", "3"]);
    assert.equal(new URL(p4.url()).search, "?utm_source=x");
    assert.equal(await p4.textContent("#bk-date-btn"), shortDate(DATE));
    assert.equal(await p4.isVisible("#bk-flight"), true);
    await p4.goto(`${P.base}/book?trip-type=one&pickup=John+F.+Kennedy+Blvd%2C+Jersey+City%2C+NJ&dropoff=LaGuardia+Place%2C+New+York%2C+NY`, { waitUntil: "load" });
    assert.deepEqual(await p4.evaluate(() => ["bk-from", "bk-from-id", "bk-to", "bk-to-id"].map((id) => document.getElementById(id).value)), ["John F. Kennedy Blvd, Jersey City, NJ", "", "LaGuardia Place, New York, NY", ""]);
    assert.equal(await p4.isVisible("#bk-flight"), false);
    await p4.goto(`${P.base}/book?trip-type=hour&pickup=LaGuardia&dropoff=JFK&hours=5&date=${DATE}&time=09:00`, { waitUntil: "load" });
    assert.deepEqual(await p4.evaluate(() => [document.getElementById("bk-hour").checked, document.getElementById("bk-from-id").value, document.getElementById("bk-hours").value, document.getElementById("bk-to").value]), [true, "lga", "5", ""]);
    assert.equal(await p4.isVisible("#bk-meet-f"), false, "meet and greet is a step 2 control");
    await p4.close();
  });
  await page.close();
  await ctx.close();
}

{
  const ctx = await context(Q);
  const page = await open(ctx, Q, "/book");
  await check("B16 with payments off the prices still show, the paused block replaces Book and pay online, Email to reserve turns gold, and its WhatsApp text has the total", async () => {
    await trip(page);
    await view(page);
    await page.waitForSelector("#q-paused", { state: "visible" });
    assert.equal(await page.isVisible("#price"), true);
    assert.equal(await page.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), cash(TOTAL));
    assert.deepEqual([await page.isVisible("#bk-bar-go"), await page.isVisible("#bk-next"), await page.isVisible("#bk-submit"), await page.getAttribute("#book-form", "data-step")], [false, false, false, "options"]);
    assert.deepEqual([await page.isVisible("#bk-tot"), await page.getAttribute("#q-mail", "class"), await page.getAttribute("#q-wa", "class"), await page.isVisible("#bk-bar-mail")], [true, "btn", "btn btn--ghost", true]);
    assert.equal((await page.textContent("#q-paused h3")).trim(), HEADINGS.phone);
    const wa = await waText(page, "#q-wa");
    assert.match(wa, /Reference: [1-9]\d{7}\n/);
    assert.match(wa, /Total shown: \$185\.00/);
    assert.deepEqual(page.errors, []);
  });
  await check("B16 an unknown session shows the not found copy and no purchase call", async () => {
    const p = await open(ctx, Q, "/booking-confirmed?session_id=cs_mock_ZZZZZZ");
    await p.waitForSelector("#cf-missing", { state: "visible" });
    assert.equal((await p.textContent("#cf-h")).trim(), "We couldn't find this payment");
    assert.equal(await p.title(), "We couldn't find this payment | NYC LUX RIDE");
    assert.equal(await p.isVisible("#cf-receipt"), false);
    assert.equal(new URL(p.url()).search, "");
    assert.deepEqual(await p.evaluate(() => window.__purchases), []);
    await p.close();
  });
  await check("B16 a confirmation visit with no session makes no request and says it can't show a booking in this tab", async () => {
    const p = await ctx.newPage();
    const calls = [];
    p.on("request", (r) => r.url().includes("/api/") && calls.push(r.url()));
    await p.goto(`${Q.base}/booking-confirmed`, { waitUntil: "load" });
    await p.waitForTimeout(400);
    assert.deepEqual(calls, []);
    assert.equal((await p.textContent("#cf-h")).trim(), "We can't show a booking in this tab");
    assert.deepEqual(await p.evaluate(() => [document.title, getComputedStyle(document.querySelector(".bk-seal")).display, document.getElementById("cf-refrow").hidden, document.getElementById("cf-none").hidden, document.querySelector("#cf-none a.btn").getAttribute("href")]), ["We can't show a booking in this tab | NYC LUX RIDE", "none", true, false, "/book"]);
    await p.close();
  });
  await page.close();
  await ctx.close();
}

{
  const nojs = await context(P, { javaScriptEnabled: false });
  for (const path of ["/book", "/"]) {
    await check(`B15 without javascript on ${path} every control of steps 1 to 3 is visible with its qualifier and the script-only parts are hidden`, async () => {
      const p = await open(nojs, P, path);
      const ids = ["bk-one", "bk-hour", "bk-from", "bk-stop1", "bk-to", "bk-hours", "bk-date", "bk-flight", "bk-time", "bk-ret", "bk-rdate", "bk-rtime", "bk-rflight", "bk-pax", "bk-vehicle", "bk-meet", "bk-r-other", "bk-name", "bk-email", "bk-phone", "bk-reach-phone", "bk-reach-wa", "bk-pname", "bk-pphone", "bk-sign", "bk-notes", "bk-consent", "bk-submit"];
      const hidden = [];
      for (const id of ids) if (!(await p.isVisible(`#${id}`)) && !(await p.isVisible(`label[for="${id}"]`))) hidden.push(id);
      assert.deepEqual(hidden, []);
      assert.deepEqual([await p.isVisible("#bk-time-btn"), await p.isVisible("#bk-rtime-btn"), await p.isVisible("#bk-tm")], [false, false, false], "without javascript the native time selects are the control");
      assert.ok(await p.isVisible(".bk-card"));
      for (const id of ["bk-view", "bk-stop2", "bk-date-btn", "bk-edit", "bk-tip", "bk-addstop", "bk-noflight", "bk-wait", "price", "quote", "resume", "from-search", "bk-check", "bk-next", "bk-bar", "bk-pills", "bk-back", "bk-dflight-f", "bk-msg"]) assert.equal(await p.isVisible(`#${id}`), false, id);
      assert.deepEqual(await p.$$eval("#bk-pname-f .bk-nojs, #bk-sign-f .bk-nojs", (e) => e.map((x) => x.textContent)), ["(if someone else is riding)", "(meet and greet)"]);
      assert.deepEqual(await p.$$eval(".bk-stepno", (e) => e.map((x) => x.getClientRects().length)), [0, 0], "no step count without the steps");
      assert.deepEqual([await p.getAttribute("#bk-r-other", "type"), await p.textContent('label[for="bk-r-other"]')], ["checkbox", "Someone else is riding"]);
      assert.equal(await p.textContent('label[for="bk-to"] .bk-nojs'), "(one way)");
      assert.ok(await p.evaluate(() => document.getElementById("bk-hp").getBoundingClientRect().right <= 0), "the honeypot is on screen");
      assert.equal(await p.getAttribute("#bk-from", "list"), "bk-places");
      await p.close();
    });
  }
  await check("B15 without javascript a priced one way and a priced hourly reach the mock confirmation", async () => {
    const p = await open(nojs, P, "/");
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await setTime(p, "12:40");
    await details(p);
    await p.check("#bk-r-other");
    await p.fill("#bk-pname", "Ben Ortiz");
    await p.fill("#bk-notes", "Two large cases");
    await p.fill("#bk-pphone", "+1 917 555 0142");
    const [post] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book")), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { waitUntil: "commit" }), p.click("#bk-submit")]);
    const sent = new URLSearchParams(post.postData());
    assert.deepEqual(["rider", "name", "email", "phone", "phone_cc", "reach", "pname", "pphone", "pphone_cc", "notes"].map((k) => sent.get(k)), ["other", ME.name, ME.email, ME.phone, "US", "phone", "Ben Ortiz", "+1 917 555 0142", "US", "Two large cases"], "without javascript the hidden country selects post US");
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    await p.check("#bk-hour");
    await p.fill("#bk-from", "277 Bedford Ave, Brooklyn, NY 11211");
    await p.fill("#bk-date", DATE);
    await setTime(p, "12:00");
    await p.click('label[for="bk-c-premium"]');
    await p.selectOption("#bk-hours", "4");
    const [hourlyPost] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book")), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { waitUntil: "commit" }), p.click("#bk-submit")]);
    assert.deepEqual(["trip_type", "class", "hours"].map((k) => new URLSearchParams(hourlyPost.postData()).get(k)), ["hour", "premium", "4"]);
    await p.close();
  });
  await check("B15 without javascript someone else riding needs the passenger's mobile: a post without it lands on its message", async () => {
    const p = await open(nojs, P, "/");
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await p.selectOption("#bk-time", "12:40");
    await details(p);
    await p.check("#bk-r-other");
    await p.fill("#bk-pname", "Ben Ortiz");
    assert.equal(await p.textContent('label[for="bk-pphone"]'), "Passenger's mobile number (if someone else is riding)");
    assert.equal((await p.innerText("#bk-other-h")).replace(/\s+/g, " ").trim(), "If someone else is riding, your chauffeur contacts them on the day of the ride. Your confirmation, receipt and any changes go to your email. Outside the US, start their number with + and the country code.");
    assert.deepEqual([await p.isVisible("#bk-phone-h span"), await p.isVisible("#bk-phone-h .bk-cc-h"), await p.isVisible(".bk-cc"), await p.locator(".bk-cc").count()], [false, true, false, 2], "the booker's mobile hint drops the pickup sentence for someone else with CSS alone, keeps how to type another country, and no picker shows without javascript");
    await Promise.all([p.waitForURL(/\/book#e-pphone$/), p.click("#bk-submit")]);
    assert.ok(await p.isVisible("#e-pphone"));
    assert.equal(await p.textContent("#e-pphone"), "Add the passenger's mobile number, and check its country code.");
    await p.close();
  });
  await check("B15 without javascript an unplaced address lands on its request block and an empty pickup on its message", async () => {
    const p = await open(nojs, P, "/locations/jfk-airport");
    await p.fill("#bk-to", "350 5th Ave");
    await p.fill("#bk-date", DATE);
    await setTime(p, "12:40");
    await Promise.all([p.waitForURL(/\/book#q-unplaced$/), p.click("#bk-submit")]);
    assert.ok(await p.isVisible("#q-unplaced"));
    assert.ok(await p.isVisible("#q-wa"));
    await p.evaluate(() => document.querySelectorAll("[required]").forEach((c) => c.removeAttribute("required")));
    await Promise.all([p.waitForURL(/\/book#e-from$/), p.click("#bk-submit")]);
    assert.ok(await p.isVisible("#e-from"));
    assert.equal(await p.isVisible("#quote"), false);
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await setTime(p, "12:40");
    await p.fill("#bk-email", "ana@example");
    assert.equal(await p.evaluate(() => document.getElementById("bk-email").validity.patternMismatch), true);
    await p.evaluate(() => document.getElementById("bk-email").removeAttribute("pattern"));
    await Promise.all([p.waitForURL(/\/book#e-email$/), p.click("#bk-submit")]);
    assert.ok(await p.isVisible("#e-email"));
    await p.close();
  });
  await check("B15 with scripting on but a failed script, Book your ride still books with Business SUV and 1 passenger", async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await ctx2.route((u) => !u.href.startsWith(P.base) || /\/assets\/pay\./.test(u.href), (r) => r.fulfill({ status: 404, body: "" }));
    const p = await ctx2.newPage();
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    assert.equal(await p.evaluate(() => document.getElementById("book-form").classList.contains("is-js")), false);
    assert.deepEqual([await p.isVisible("#bk-view"), await p.isVisible("#bk-date"), await p.isVisible("#bk-date-btn"), await p.isVisible("#bk-opts")], [true, true, false, false]);
    await p.fill("#bk-from", "LaGuardia (LGA), Terminal C");
    await p.fill("#bk-to", "277 Bedford Ave, Brooklyn, NY 11211");
    await p.fill("#bk-date", DATE);
    await setTime(p, "07:30");
    const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && r.method() === "POST"), p.click("#bk-view")]);
    const body = new URLSearchParams(req.postData());
    assert.deepEqual([body.get("action"), body.get("class"), body.get("passengers"), body.get("from_text")], ["options", "suv", "1", "LaGuardia (LGA), Terminal C"]);
    await p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { waitUntil: "commit" });
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "12 Washington St, Hoboken, NJ 07030");
    await p.fill("#bk-date", DATE);
    await setTime(p, "07:30");
    await Promise.all([p.waitForURL(/\/book#q-outside-city$/), p.click("#bk-view")]);
    assert.deepEqual(await p.evaluate(() => { const q = document.getElementById("q-outside-city"), v = (i) => getComputedStyle(document.getElementById(i)).display; return [q.getBoundingClientRect().height > 0, document.getElementById("bk-act").contains(q), v("bk-act"), v("q-mail"), v("q-wa"), v("bk-tot"), v("bk-submit")]; }), [true, true, "grid", "flex", "flex", "none", "none"], "the request block shows with Email to reserve and WhatsApp to reserve, no total and no pay button");
    await ctx2.close();
  });
  await check("B15 without javascript /book#resume shows the note", async () => {
    const p = await open(nojs, P, "/book#resume");
    assert.ok(await p.isVisible("#resume"));
    await p.close();
  });
  await nojs.close();
}

const delayAll = (p, ms = 900) =>
  p.route("**/api/**", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    if (route.request().url().endsWith("/api/route")) await route.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"off"}' }).catch(() => {});
    else await route.continue().catch(() => {});
  });
for (const path of ["/", "/book"]) {
  const ctx = await context(G, { viewport: { width: 390, height: 844 } });
  await check(`B17 ${path}: with every answer delayed, CLS without recent input stays 0 through ${path === "/" ? "step 1, a flight lookup and the hand-off to /book#options" : "Book your ride, a class change, Continue, then meet and greet and a gratuity in step 3"}`, async () => {
    const p = await open(ctx, G, path);
    await delayAll(p);
    await place(p, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await p.fill("#bk-flight", "EK201");
    await p.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("EK 201 from"), null, { timeout: 6000 });
    await p.waitForTimeout(300);
    await setTime(p, "15:00");
    if (path === "/") {
      let [value, shifts] = await cls(p);
      assert.equal(value, 0, `step 1: ${shifts.join(" | ")}`);
      await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
      await p.waitForTimeout(1600);
      await priced(p);
      [value, shifts] = await cls(p);
      assert.equal(value, 0, `after the hand-off: ${shifts.join(" | ")}`);
      return p.close();
    }
    await p.click("#bk-view");
    await p.waitForTimeout(1600);
    await p.click('label[for="bk-c-first"]');
    await p.waitForTimeout(1300);
    await p.click(await go(p));
    await p.waitForTimeout(300);
    await p.check("#bk-meet");
    await p.waitForTimeout(1300);
    await p.click('label[for="bk-t-15"]');
    await p.waitForTimeout(1300);
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(AIRPORT_TOTALS.first.jfk + MEET_AND_GREET + percentCents(AIRPORT_FARES.first.jfk, "15")));
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    await p.close();
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(G, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B17 a load of /book#options at ${width} with every answer delayed 900 ms, no input at all: CLS stays 0`, async () => {
    const p = await open(ctx, G, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await delayAll(p);
    await p.reload({ waitUntil: "load" });
    await p.waitForTimeout(1800);
    await priced(p);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.equal(await p.getAttribute("#book-form", "data-step"), "options");
    await p.close();
  });
  await ctx.close();
}

{
  const F = await serve({ BOOK_MOCK: "true", FLIGHT_MOCK: "true" });
  for (const path of ["/", "/locations/jfk-airport", "/locations/manhattan"]) {
    for (const width of [320, 340, 360]) {
      const ctx = await context(F, { viewport: { width, height: 800 } });
      await check(`B17 ${path} at ${width}: in the hero or banner form the flight card reserves the live answer, so its arrival keeps CLS 0`, async () => {
        const p = await open(ctx, F, path);
        assert.ok(await p.evaluate(() => !!document.querySelector("[class*=__book] > #book-form")), "the form sits in a hero or banner");
        if (!/JFK/.test(await p.inputValue("#bk-from"))) await place(p, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
        await place(p, "to", "350 5th Ave, New York, NY 10118");
        await pickDate(p, "#bk-date-btn", nyDate(1));
        await p.evaluate(() => document.getElementById("bk-flight-f").scrollIntoView({ block: "center" }));
        await p.waitForTimeout(600);
        await p.evaluate(() => ((window.__cls = 0), (window.__shifts = [])));
        await p.click("#bk-flight");
        await p.keyboard.type("EK201");
        await p.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes(", now 3:10 PM"), null, { timeout: 6000 });
        await p.waitForTimeout(600);
        const [value, shifts] = await cls(p);
        assert.equal(value, 0, shifts.join(" | "));
        await p.close();
      });
      await ctx.close();
    }
  }
  F.child.kill();
}

for (const [path, width] of [["/book", 390], ["/locations/jfk-airport", 390], ["/book", 430], ["/locations/manhattan", 1024], ["/", 1100]]) {
  const ctx = await context(G, { viewport: { width, height: 800 } });
  await check(`B17 ${path} at ${width}: a long origin (LH 400 from Frankfurt-am-Main) with 12 PM times fits the flight card reserve, so its arrival keeps CLS 0`, async () => {
    const p = await open(ctx, G, path);
    const date = nyDate(1);
    const flight = { airline: "Lufthansa", number: "LH 400", origin: { city: "Frankfurt-am-Main", iata: "FRA" }, destination: { city: "New York", iata: "JFK" }, terminal: "1", scheduled: `${date} 12:55`, estimated: `${date} 12:10`, status: "Expected", updated: "" };
    await p.route("**/api/flight", (route) => (JSON.parse(route.request().postData() || "{}").probe ? route.continue() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "ok", flight }) })));
    if (!/JFK/.test(await p.inputValue("#bk-from"))) await place(p, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", date);
    await p.evaluate(() => document.getElementById("bk-flight-f").scrollIntoView({ block: "center" }));
    await p.waitForTimeout(600);
    await p.evaluate(() => ((window.__cls = 0), (window.__shifts = [])));
    await p.click("#bk-flight");
    await p.keyboard.type("LH400");
    await p.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("Set pickup to 12:10 PM"), null, { timeout: 6000 });
    await p.waitForTimeout(600);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    await p.close();
  });
  await ctx.close();
}

for (const [path, width, height] of [["/", 390, 844], ["/book", 390, 844], ["/", 1440, 900], ["/book", 1440, 900]]) {
  const ctx = await context(G, { viewport: { width, height } });
  const big = width >= 1024;
  await check(`B17 ${path} at ${width}: with Google keys the map card and the route list are drawn at the step switch${big ? "" : " on a phone too"}, prices come before a late route, the drive time fills in place, CLS stays 0${path === "/book" ? ", also on /book#resume" : " on /book#options after the hand-off"}`, async () => {
    const p = await open(ctx, G, path);
    await place(p, "from", "edition", "The New York EDITION");
    await p.waitForFunction(() => /^v1\./.test(document.getElementById("bk-from-ticket").value));
    await place(p, "to", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await pickDate(p, "#bk-date-btn", DATE);
    await setTime(p, "12:40");
    await p.route("**/api/route", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue().catch(() => {});
    });
    if (path === "/") await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
    else await p.click("#bk-view");
    assert.deepEqual([await p.isVisible("#bk-map"), await p.isVisible("#bk-drive"), await p.isVisible("#bk-route"), await p.isVisible("#bk-route-n")], [true, false, true, true]);
    assert.ok(await p.$("#bk-route .bk-route__z .bk-sk[aria-hidden=true]"), "the drop-off time waits in a skeleton");
    const frame = await p.evaluate(() => [document.getElementById("bk-map").getBoundingClientRect().height, document.getElementById("bk-route").getBoundingClientRect().height]);
    assert.ok(frame[0] >= 80, JSON.stringify(frame));
    await priced(p);
    assert.equal(await p.$("#bk-map img"), null, "the prices did not wait for the route");
    await p.waitForSelector("#bk-map img");
    await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    await p.waitForTimeout(400);
    let [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-map").getBoundingClientRect().height, document.getElementById("bk-route").getBoundingClientRect().height]), frame);
    assert.deepEqual(await p.$$eval("#bk-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMThe New York EDITION, Madison Avenue, New York, NY", "About 1:25 PMJFK Terminal 4"]);
    assert.equal(await p.textContent("#bk-route-n"), DRIVE_N);
    assert.equal((await p.innerText("#bk-route-n")).trim(), DRIVE_SEEN, "beside the map image its own Google logo is the attribution");
    if (path === "/book") {
      await p.evaluate(() => sessionStorage.setItem("nlr-book", JSON.stringify({ ...JSON.parse(sessionStorage.getItem("nlr-book")), fields: Object.fromEntries(new FormData(document.getElementById("book-form"))), step: "details" })));
      await p.goto("about:blank");
      await p.goto(`${G.base}/book#resume`, { waitUntil: "load" });
      await priced(p);
      await p.waitForTimeout(1300);
      assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isVisible("#bk-map")], ["details", false]);
      [value, shifts] = await cls(p);
      assert.equal(value, 0, `resume: ${shifts.join(" | ")}`);
    }
    await p.unroute("**/api/route");
    await p.close();
  });
  await ctx.close();
}

for (const path of ["/", "/book", "/locations/laguardia-airport", "/locations/manhattan"]) {
  const ctx = await context(P);
  await check(`B18 ${path}: no horizontal overflow at 320 and 360 in ${path === "/book" ? "steps 1, 2 and 3" : "step 1"}`, async () => {
    const p = await open(ctx, P, path);
    for (const w of [320, 360]) {
      await p.setViewportSize({ width: w, height: 720 });
      await p.waitForTimeout(100);
      assert.ok((await overflow(p)) <= 1, `step 1 at ${w}: ${await overflow(p)}px`);
    }
    await trip(p, { from: ["lga", "LaGuardia (LGA), Terminal B"] });
    await type(p, "to", "terminal");
    for (const w of [320, 360]) {
      await p.setViewportSize({ width: w, height: 720 });
      await p.waitForTimeout(100);
      assert.ok((await overflow(p)) <= 1, `open list at ${w}: ${await overflow(p)}px`);
    }
    await p.keyboard.press("Escape");
    await p.click("#bk-date-btn");
    for (const w of [320, 360]) {
      await p.setViewportSize({ width: w, height: 720 });
      await p.waitForTimeout(100);
      assert.ok((await overflow(p)) <= 1, `open calendar at ${w}: ${await overflow(p)}px`);
    }
    await p.keyboard.press("Escape");
    if (path !== "/book") return p.close();
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await view(p);
    await priced(p);
    for (const w of [320, 360]) {
      await p.setViewportSize({ width: w, height: 720 });
      await p.waitForTimeout(100);
      assert.ok((await overflow(p)) <= 1, `step 2 at ${w}: ${await overflow(p)}px`);
    }
    await next(p);
    await p.check("#bk-r-other");
    for (const w of [320, 360]) {
      await p.setViewportSize({ width: w, height: 720 });
      await p.waitForTimeout(100);
      assert.ok((await overflow(p)) <= 1, `step 3 at ${w}: ${await overflow(p)}px`);
    }
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1280, height: 900 } });
  await check("B19 the tab order reaches Book your ride, in step 2 the cards and Book and pay online, in step 3 every detail control, the gratuity, meet and greet, Book and pay online, Email to reserve and WhatsApp to reserve, each with a visible focus ring", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await p.focus("#bk-time");
    let reached = false;
    for (let i = 0; i < 8 && !reached; i++) {
      await p.keyboard.press("Tab");
      reached = await p.evaluate(() => document.activeElement.id === "bk-view");
    }
    assert.ok(reached, "Tab never reached Book your ride");
    const ring = (sel) => p.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return [c.outlineStyle, parseFloat(c.outlineWidth)]; }, sel);
    const [style, width] = await ring("#bk-view");
    assert.ok(style !== "none" && width >= 2, `${style} ${width}`);
    await p.keyboard.press("Enter");
    await priced(p);
    const seen = [];
    for (let i = 0; i < 40 && !seen.includes("bk-next"); i++) {
      await p.keyboard.press("Tab");
      seen.push(await p.evaluate(() => document.activeElement.id));
    }
    assert.ok(seen.includes("bk-c-suv") && seen.includes("bk-next"), seen.join(" "));
    const [s2, w2] = await ring("#bk-next");
    assert.ok(s2 !== "none" && w2 >= 2, `${s2} ${w2}`);
    await p.keyboard.press("Enter");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-det-h");
    const want = ["bk-r-other", "bk-name", "bk-email", "bk-phone-cc", "bk-phone", "bk-reach-phone", "bk-notes-add", "bk-t-0", "bk-meet-no", "bk-check-edit", "bk-submit", "q-mail", "q-wa"];
    const order = [];
    for (let i = 0; i < 40 && !order.includes("q-wa"); i++) {
      await p.keyboard.press("Tab");
      const id = await p.evaluate(() => document.activeElement.id);
      order.push(id);
      if (want.includes(id)) {
        const [st, wd] = await ring(id === "bk-meet-no" ? 'label[for="bk-meet-no"]' : id === "bk-phone-cc" ? "#bk-phone-f .bk-cc" : `#${id}`);
        const under = await p.evaluate((x) => getComputedStyle(document.getElementById(x).closest(".bk-row") || document.getElementById(x)).boxShadow, id);
        if (id === "bk-phone-cc") assert.ok(st !== "none" && wd >= 2, `the country select draws its ring on its face: ${st} ${wd}`);
        else assert.ok((st !== "none" && wd >= 2) || /0px -2px/.test(under) || /rgb/.test(under), `${id}: ${st} ${wd} ${under}`);
      }
    }
    assert.deepEqual(want.map((id) => order.indexOf(id) >= 0), want.map(() => true), order.join(" "));
    assert.deepEqual(want.map((id) => order.indexOf(id)), [...want.map((id) => order.indexOf(id))].sort((a, b) => a - b), order.join(" "));
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B19 with the pills showing at 1440, Shift+Tab from Book and pay online back to the class rows leaves the checked row fully below the pills bar", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await p.evaluate(() => scrollTo(0, document.getElementById("bk-cards").getBoundingClientRect().bottom + scrollY + 40));
    await p.waitForFunction(() => document.getElementById("bk-pills").classList.contains("is-on"));
    await p.focus("#bk-next");
    let id = "";
    for (let i = 0; i < 12 && id !== "bk-c-suv"; i++) {
      await p.keyboard.press("Shift+Tab");
      id = await p.evaluate(() => document.activeElement.id);
    }
    assert.equal(id, "bk-c-suv", "Shift+Tab reaches the checked class row");
    await p.waitForTimeout(200);
    const [box, bar] = await p.evaluate(() => [document.getElementById("bk-c-suv").getBoundingClientRect().top, document.getElementById("bk-pills").getBoundingClientRect().bottom]);
    assert.ok(box >= bar, `checkbox top ${box}, pills bottom ${bar}`);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { forcedColors: "active" });
  await check("B20 forced colors: the selected card has a visible Highlight border, the cards and the list a CanvasText border", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const b = await p.evaluate(() => {
      const sel = getComputedStyle(document.querySelector('label[for="bk-c-suv"]'));
      const other = getComputedStyle(document.querySelector('label[for="bk-c-first"]'));
      return [sel.borderTopStyle, parseFloat(sel.borderTopWidth), sel.borderTopColor, other.borderTopStyle, parseFloat(other.borderTopWidth), other.borderTopColor];
    });
    assert.ok(b[0] === "solid" && b[1] >= 2 && b[3] === "solid" && b[4] >= 1 && b[2] !== b[5], JSON.stringify(b));
    assert.deepEqual(await p.$$eval("#bk-sum .bk-chip", (c) => c.map((x) => getComputedStyle(x).textDecorationLine)), ["underline", "underline"], "the trip chips keep an underline as their button cue");
    await next(p);
    const t = await p.evaluate(() => {
      const c = (s) => getComputedStyle(document.querySelector(s));
      const mark = (id) => {
        const g = document.getElementById(id), f = g.querySelector("label"), l = g.querySelector(":checked").parentNode, i = getComputedStyle(f, "::before"), m = new DOMMatrixReadOnly(i.transform === "none" ? undefined : i.transform), fr = f.getBoundingClientRect(), lr = l.getBoundingClientRect();
        if (!g.classList.contains("bk-ix")) return [getComputedStyle(l).backgroundColor, true];
        return [i.backgroundColor, Math.max(Math.abs(fr.left + f.clientLeft + m.m41 - lr.left), Math.abs(parseFloat(i.width) - lr.width), Math.abs(fr.top + f.clientTop + m.m42 - lr.top)) <= 1];
      };
      const box = c("#bk-r-other"), off = c('label[for="bk-reach-wa"]');
      return [box.appearance, ...mark("bk-reach"), off.borderTopStyle];
    });
    assert.ok(t[0] === "auto" && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(t[1]) && t[2] && t[3] === "solid", JSON.stringify(t));
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P, { reducedMotion: "reduce" });
  await check("B20 reduced motion: the popups, the calendar and the cards have transitions of at most 1 ms", async () => {
    const p = await open(ctx, P, "/book");
    await p.click("#bk-from");
    const t = await p.evaluate(() => [...document.querySelectorAll(".bk-pop, .bk-pop [role=option], .bk-cal, .bk-card, .bk-link, .bk-mode label, .btn")].map((e) => getComputedStyle(e).transitionDuration.split(",").map(parseFloat)).flat());
    await p.keyboard.press("Escape");
    await p.click("#bk-date-btn");
    t.push(...(await p.evaluate(() => [...document.querySelectorAll(".bk-cal, .bk-cal button")].map((e) => getComputedStyle(e).transitionDuration.split(",").map(parseFloat)).flat())));
    assert.ok(t.every((d) => d <= 0.001), JSON.stringify([...new Set(t)]));
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P, { reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  await check("B20 reduced motion: the pickup panel on / and the pills on /book have transitions of at most 1 ms", async () => {
    const p = await open(ctx, P, "/");
    await p.click("#bk-from");
    const t = await p.evaluate(() => [document.getElementById("bk-from-pop"), document.getElementById("bk-search"), document.querySelector(".hero h1")].map((e) => getComputedStyle(e).transitionDuration.split(",").map(parseFloat)).flat());
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    t.push(...(await p.evaluate(() => [document.getElementById("bk-pills"), ...document.querySelectorAll(".bk-pill")].map((e) => getComputedStyle(e).transitionDuration.split(",").map(parseFloat)).flat())));
    assert.ok(t.every((d) => d <= 0.001), JSON.stringify([...new Set(t)]));
    await p.close();
  });
  await ctx.close();
}

const GT = () => {
  window.nlrGtag = (...a) => {
    const v = JSON.parse(sessionStorage.getItem("__gt") || "[]");
    v.push(`${location.pathname} ${a[1]}`);
    sessionStorage.setItem("__gt", JSON.stringify(v));
  };
};
async function hostTrip(page) {
  await place(page, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
  await place(page, "to", "350 5th Ave, New York, NY 10118");
  await pickDate(page, "#bk-date-btn", DATE);
  await setTime(page, "14:00");
}
const chips = (page) => page.$$eval("#bk-sum .bk-chip", (c) => c.map((x) => x.textContent.replace(/^Change /, "")));
for (const [path, width] of [["/", 1440], ["/locations/manhattan", 390]]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await ctx.addInitScript(GT);
  await check(`B21 hand-off from ${path} at ${width}: Book your ride opens /book#options with the same trip and the five prices, one book_now_click on the host, back and forward`, async () => {
    const p = await open(ctx, P, path);
    await hostTrip(p);
    await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
    await priced(p);
    assert.equal(new URL(p.url()).search, "");
    assert.deepEqual(await chips(p), [`JFK Terminal 4 to 350 5th Ave, New York`,`${shortDate(DATE)}, 2:00 PM`]);
    assert.deepEqual(await cards(p), JFK_CARDS);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("book-form").dataset.step, JSON.parse(sessionStorage.getItem("nlr-book")).step, document.activeElement.id]), ["options", "options", "bk-opt-h"]);
    const gt = await p.evaluate(() => JSON.parse(sessionStorage.getItem("__gt") || "[]"));
    assert.deepEqual(gt.filter((e) => e.endsWith(" book_now_click")), [`${path} book_now_click`]);
    await p.goBack({ waitUntil: "load" });
    assert.equal(new URL(p.url()).pathname, path);
    await p.goForward({ waitUntil: "load" });
    assert.equal(new URL(p.url()).pathname + new URL(p.url()).hash, "/book#options");
    await priced(p);
    assert.deepEqual(await cards(p), JFK_CARDS);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B22 details: the browser checks run in order, someone else needs a passenger name, the sign follows the rider, the flight mirror writes flight, and the pay body carries the details without the passenger for Me", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await p.check("#bk-meet");
    await priced(p);
    const fail = async (...ids) => {
      await p.click(await payBtn(p));
      assert.deepEqual(await p.evaluate(() => [document.activeElement.id, [...document.querySelectorAll(".bk-det .bk-e.is-on")].map((e) => e.id)]), [`bk-${ids[0]}`, ids.map((id) => `e-${id}`)], ids.join());
      for (const id of ids) assert.equal(await p.getAttribute(`#bk-${id}`, "aria-invalid"), "true", id);
      const errs = await p.evaluate(() => [document.getElementById("bk-errs").hidden, document.querySelectorAll("#bk-errs a").length]);
      assert.deepEqual(ids.length > 1 ? errs : errs[0], ids.length > 1 ? [false, ids.length] : true, "the error summary lists two or more");
    };
    await fail("name", "email", "phone");
    assert.equal(await p.textContent("#bk-status"), "3 things to fix: full name, email and mobile number.");
    await p.fill("#bk-name", "Ana Lopez");
    await p.fill("#bk-email", "ana@example");
    await fail("email", "phone");
    await p.fill("#bk-email", ME.email);
    await p.fill("#bk-phone", "555 01");
    await fail("phone");
    await p.fill("#bk-phone", ME.phone);
    assert.deepEqual([await p.isVisible("#bk-sign"), await p.inputValue("#bk-sign"), await p.isVisible("#bk-pname"), await p.isVisible("#bk-dflight")], [true, "Ana Lopez", false, true]);
    await p.click("#bk-name");
    assert.deepEqual([await p.inputValue("#bk-phone"), await p.inputValue("#bk-phone-cc")], ["212 555 0100", "US"], "a typed +1 moves to the country code when the field is left");
    await p.check("#bk-r-other");
    assert.deepEqual([await p.isVisible("#bk-pname"), await p.isVisible("#bk-pphone")], [true, true]);
    await fail("pname", "pphone");
    await p.fill("#bk-pname", "Ben Ortiz");
    assert.equal(await p.inputValue("#bk-sign"), "Ben Ortiz");
    await p.fill("#bk-pphone", "call me");
    await fail("pphone");
    await p.fill("#bk-pphone", "");
    await fail("pphone");
    assert.equal(await p.textContent("#e-pphone"), "Add the passenger's mobile number, and check its country code.");
    await p.fill("#bk-sign", "Dr Ortiz");
    await p.fill("#bk-pname", "Benjamin Ortiz");
    assert.equal(await p.inputValue("#bk-sign"), "Dr Ortiz", "own typing stops the autofill");
    await p.uncheck("#bk-r-other");
    assert.equal(await p.isVisible("#bk-pname"), false);
    await p.fill("#bk-dflight", "EK201");
    assert.equal(await p.inputValue("#bk-flight"), "EK201");
    assert.equal(await p.isVisible("#bk-notes"), false, "the notes wait behind Add child seats or a note");
    await p.click("#bk-notes-add");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-notes");
    await p.fill("#bk-notes", "Two large cases");
    await p.click('label[for="bk-reach-wa"]');
    await p.route("**/booking-confirmed*", (r) => r.fulfill({ status: 204, body: "" }));
    const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), p.click(await payBtn(p))]);
    const body = JSON.parse(req.postData());
    assert.deepEqual(["rider", "name", "email", "phone", "phone_cc", "reach", "sign", "notes", "flight"].map((k) => body[k]), ["me", "Ana Lopez", ME.email, "212 555 0100", "US", "whatsapp", "Dr Ortiz", "Two large cases", "EK201"]);
    assert.ok(!("pname" in body) && !("pphone" in body) && !("pphone_cc" in body), "no passenger fields for Me");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B23 reload and back: a reload on #options and on #details keeps the step, the class, the gratuity and the details, Back walks the steps", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await p.click('label[for="bk-c-first"]');
    await priced(p);
    await p.reload({ waitUntil: "load" });
    await priced(p);
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isChecked("#bk-c-first"), await p.inputValue("#bk-from")], ["options", true, "JFK Terminal 4"]);
    await next(p);
    await p.click('label[for="bk-t-10"]');
    await details(p);
    await p.waitForTimeout(400);
    await p.reload({ waitUntil: "load" });
    await priced(p);
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isChecked("#bk-c-first"), await p.isChecked("#bk-t-10"), await p.inputValue("#bk-name"), await p.inputValue("#bk-phone")], ["details", true, true, ME.name, ME.phone]);
    assert.equal(await p.textContent("#price-total"), cash(AIRPORT_TOTALS.first.jfk + percentCents(AIRPORT_FARES.first.jfk, "10")));
    await p.click('label[for="bk-t-custom"]');
    await p.fill("#bk-tipamt", "40");
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(AIRPORT_TOTALS.first.jfk + 4000));
    await p.waitForTimeout(400);
    await p.reload({ waitUntil: "load" });
    await priced(p);
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isChecked("#bk-t-custom"), await p.inputValue("#bk-tipamt"), await p.isVisible("#bk-tipamt"), await p.textContent("#price-total")], ["details", true, "40", true, cash(AIRPORT_TOTALS.first.jfk + 4000)], "a reload keeps Other and the amount (owner request 1)");
    await p.click('label[for="bk-t-10"]');
    await priced(p);
    await p.goBack();
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    assert.equal(new URL(p.url()).hash, "#options");
    await p.goBack();
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
    assert.equal(new URL(p.url()).hash, "");
    await p.close();
  });
  await ctx.close();
}

{
  const nojs = await context(P, { javaScriptEnabled: false });
  await check("B24 without javascript on /locations/manhattan, Book your ride sends GET to /book?...&action=options#from-search and /book shows the FULL form and the note", async () => {
    const p = await open(nojs, P, "/locations/manhattan");
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await setTime(p, "14:00");
    await Promise.all([p.waitForURL(/\/book\?.*#from-search$/), p.click("#bk-view")]);
    const u = new URL(p.url());
    assert.deepEqual([u.pathname, u.searchParams.get("action"), u.searchParams.get("from_text"), u.searchParams.get("date"), u.searchParams.get("time"), u.searchParams.get("trip_type")], ["/book", "options", "John F. Kennedy (JFK), Terminal 4", DATE, "14:00", "one"]);
    assert.ok(await p.isVisible("#from-search"));
    assert.ok(await p.isVisible("#bk-submit"));
    assert.equal(await p.getAttribute("#book-form", "method"), "post");
    assert.equal(await p.inputValue("#bk-from"), "");
    await p.close();
  });
  await nojs.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await ctx.route((u) => !u.href.startsWith(P.base), (r) => r.fulfill({ status: 204, body: "" }));
  await check("B25 with the host page's pay script blocked, the GET from /locations/manhattan reaches /book, which restores the query, opens step 2 and leaves /book#options with no query", async () => {
    const p = await ctx.newPage();
    await p.route(/\/assets\/pay\./, (r) => (/\/locations\/manhattan$/.test(r.request().headers().referer || "") ? r.fulfill({ status: 404, body: "" }) : r.continue()));
    await p.goto(`${P.base}/locations/manhattan`, { waitUntil: "load" });
    assert.equal(await p.evaluate(() => document.getElementById("book-form").classList.contains("is-js")), false);
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-from-id", "jfk-t4").catch(() => p.evaluate(() => (document.getElementById("bk-from-id").value = "jfk-t4")));
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await setTime(p, "14:00");
    await Promise.all([p.waitForURL(/\/book/), p.click("#bk-view")]);
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(p);
    assert.equal(new URL(p.url()).search + new URL(p.url()).hash, "#options");
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-from-id").value, document.getElementById("bk-to").value, document.getElementById("bk-time").value, JSON.parse(sessionStorage.getItem("nlr-book")).step]), ["John F. Kennedy (JFK), Terminal 4", "jfk-t4", "350 5th Ave, New York, NY 10118", "14:00", "options"]);
    assert.equal(await p.isVisible("#from-search"), false);
    assert.deepEqual(await cards(p), JFK_CARDS);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B26 at 1440 the sticky pills appear after the cards scroll above the header, a pill click selects its class and reprices", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    assert.equal(await p.evaluate(() => document.getElementById("bk-pills").classList.contains("is-on")), false);
    assert.deepEqual(await p.$$eval(".bk-pill", (s) => s.map((x) => [x.dataset.c, x.firstElementChild.textContent, x.lastElementChild.textContent])), CLASS_KEYS.map((k, i) => [k, ["Business SUV", "Business Premium SUV", "First Class", "Sedan & Electric", "Luxury Sprinter"][i], JFK_CARDS[i]]));
    await p.evaluate(() => scrollTo(0, document.getElementById("bk-cards").getBoundingClientRect().bottom + scrollY + 20));
    await p.waitForFunction(() => document.getElementById("bk-pills").classList.contains("is-on"));
    const box = await p.evaluate(() => { const r = document.getElementById("bk-pills").getBoundingClientRect(), c = document.getElementById("bk-cards").getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.left - c.left), Math.round(r.width - c.width), getComputedStyle(document.getElementById("bk-pills")).visibility]; });
    assert.deepEqual(box, [76, 64, 0, 0, "visible"]);
    const pills = await p.$$eval(".bk-pill", (s) => s.map((x) => { const [n, v] = x.children; return [Math.round(x.getBoundingClientRect().height), Math.round(n.getBoundingClientRect().height), getComputedStyle(v).display !== "none" && v.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1]; }));
    assert.deepEqual(pills, CLASS_KEYS.map(() => [40, 16, true]), "each pill shows its name on one line and its price below");
    await p.click(".bk-pill[data-c=sedan]");
    assert.equal(await p.isChecked("#bk-c-sedan"), true);
    await priced(p);
    assert.deepEqual([await p.textContent("#bk-choice"), await p.evaluate(() => document.querySelector(".bk-pill.is-on").dataset.c), (await p.textContent("#bk-next")).trim(), await p.$eval("#bk-tot-v", (x) => x.firstChild.textContent)], ["Sedan & ElectricCadillac Lyriq or similar", "sedan", "Book and pay online", JFK_CARDS[3]]);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForFunction(() => !document.getElementById("bk-pills").classList.contains("is-on"));
    await p.close();
  });
  await ctx.close();
}
for (const width of [1366, 1440]) {
  const ctx = await context(P, { viewport: { width, height: 900 } });
  await check(`B26 at ${width} with the WCAG text spacing each sticky pill shows its whole class name, wrapped where it needs to be, inside the pill and the bar (WCAG 1.4.12)`, async () => {
    const p = await open(ctx, P, "/book");
    await p.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}" });
    await trip(p);
    await view(p);
    await priced(p);
    await p.evaluate(() => scrollTo(0, document.getElementById("bk-cards").getBoundingClientRect().bottom + scrollY + 20));
    await p.waitForFunction(() => document.getElementById("bk-pills").classList.contains("is-on"));
    const cut = await p.$$eval(".bk-pill", (s) => {
      const bar = document.getElementById("bk-pills").getBoundingClientRect();
      return s.flatMap((x) => {
        const n = x.firstElementChild, r = x.getBoundingClientRect();
        return n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 || r.top < bar.top - 0.5 || r.bottom > bar.bottom + 0.5 ? [n.textContent] : [];
      });
    });
    assert.deepEqual(cut, []);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  await check("B26 at 390 the bottom bar shows the class and the total, its Book and pay online opens step 3, and the site action bar is display none on /book in every step", async () => {
    const p = await open(ctx, P, "/book");
    const bar = () => p.evaluate(() => getComputedStyle(document.querySelector("nav.actionbar")).display);
    assert.equal(await bar(), "none", "no call or WhatsApp bar on /book step 1");
    await trip(p);
    await view(p);
    await priced(p);
    assert.deepEqual([await p.isVisible("#bk-bar"), await p.textContent("#bk-bar-name"), await p.textContent("#bk-bar-total"), await p.isVisible("#bk-next"), (await p.textContent("#bk-bar-go")).trim(), await p.getAttribute("#bk-bar-go", "aria-label"), await p.getAttribute("#bk-bar-go", "aria-describedby")], [true, "Business SUV", `${cash(TOTAL)} total`, true, "Book and pay online", null, "bk-nopay"]);
    assert.ok(await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById("bk-bar")).minHeight) >= 68), "the bar is at least 68 px tall");
    assert.equal(await bar(), "none");
    const r = await p.evaluate(() => { const b = document.getElementById("bk-bar").getBoundingClientRect(); return [Math.round(b.bottom), Math.round(b.left), Math.round(b.right - document.documentElement.getBoundingClientRect().width)]; });
    assert.deepEqual(r, [844, 0, 0]);
    await p.click("#bk-bar-go");
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isVisible("#bk-bar"), await bar(), await p.evaluate(() => document.activeElement.id)], ["details", false, "none", "bk-det-h"]);
    assert.deepEqual(await p.evaluate(() => [getComputedStyle(document.getElementById("bk-bar")).display, getComputedStyle(document.getElementById("book-form")).paddingBottom, document.getElementById("bk-submit").textContent.trim(), !!document.querySelector("#bk-submit use[href='#i-lock']")]), ["none", "0px", "Book and pay online", true], "in step 3 no bar covers the form and the form keeps no room for one, the pay button follows the total (owner request 4)");
    assert.ok(await p.evaluate(() => document.getElementById("bk-submit").getBoundingClientRect().top > innerHeight), "the pay button waits at the end of the step, below the details");
    await p.evaluate(() => document.getElementById("bk-submit").scrollIntoView({ block: "center" }));
    assert.deepEqual(await p.evaluate(() => { const r = document.getElementById("bk-submit").getBoundingClientRect(); return [r.top >= 0 && r.bottom <= innerHeight, getComputedStyle(document.getElementById("bk-bar")).display]; }), [true, "none"]);
    await p.close();
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B14 on a SEARCH host at ${width}, the ${width === 390 ? "action bar" : "header"} Book a car focuses the pickup box without leaving the page`, async () => {
    const p = await open(ctx, P, "/locations/manhattan");
    const sel = width === 390 ? ".actionbar__cell--book" : ".site-header__desk a.btn";
    assert.deepEqual(await p.evaluate((s) => [document.querySelector(s).getAttribute("href"), document.querySelector(s).getAttribute("aria-current")], sel), ["#book-form", null]);
    let nav = false;
    p.on("request", (r) => r.isNavigationRequest() && (nav = true));
    await p.evaluate((s) => document.querySelector(s).click(), sel);
    await p.waitForTimeout(200);
    assert.deepEqual([nav, await p.evaluate(() => document.activeElement.id)], [false, "bk-from"]);
    await p.close();
  });
  await ctx.close();
}

async function hourlyTrip(p) {
  await p.click('label[for="bk-hour"]');
  await place(p, "from", "277 Bedford Ave, Brooklyn, NY 11211");
  await pickDate(p, "#bk-date-btn", DATE);
  await setTime(p, "12:40");
  await view(p);
  await priced(p);
}

for (const [width, height] of [[1440, 900], [1280, 720]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B27 at ${width} by ${height} on /, focusing the pickup opens its list as a panel under the field and above the page, the drop-off has its own under its field, Escape closes each with focus kept, and the hero and the static trust row under it stay put`, async () => {
    const p = await open(ctx, P, "/");
    await settle(p, 300);
    await showBar(p);
    const geo = () => p.evaluate(() => [".hero", ".assure-row--page", ".hero h1", ".hero__tags--svc", "#bk-mode", "#bk-search"].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top + scrollY), Math.round(b.height)].join(); }));
    const under = (id) => p.evaluate((i) => { const e = document.getElementById(i), a = e.getBoundingClientRect(), f = e.parentElement.getBoundingClientRect(); return [e.matches(":popover-open"), Math.round(a.top - f.bottom), Math.round(a.left - f.left), a.bottom <= innerHeight && a.right <= innerWidth && a.top >= document.querySelector(".site-header").getBoundingClientRect().bottom]; }, id);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-help"), getComputedStyle(document.getElementById("bk-assure")).display]), [null, "none"], "no help row, and the form's trust row hides on the hero from 1024");
    const still = await geo();
    await tap(p, "#bk-from");
    await p.waitForTimeout(400);
    assert.deepEqual(await under("bk-from-pop"), [true, 4, 0, true]);
    assert.deepEqual(await geo(), still, "the hero, the trust row, the headline, the lines under it, the switch and the bar keep their places");
    await tap(p, "#bk-to");
    await p.waitForTimeout(400);
    assert.deepEqual(await under("bk-to-pop"), [true, 4, 0, true], "the drop-off list sits under the drop-off");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(200);
    assert.deepEqual([await p.isVisible("#bk-to-pop"), await p.evaluate(() => document.activeElement.id)], [false, "bk-to"], "Escape closes the list and keeps focus");
    assert.deepEqual(await geo(), still);
    assert.deepEqual(await p.evaluate(() => window.__shifts), [], "a shift without input");
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  await check("B27 at 390 the pickup list stays in the page flow under the field", async () => {
    const p = await open(ctx, P, "/");
    await p.click("#bk-from");
    await p.waitForTimeout(200);
    assert.deepEqual(await p.evaluate(() => { const e = document.getElementById("bk-from-pop"); return [e.hidden, e.matches(":popover-open"), getComputedStyle(e).position, document.querySelector(".hero__book").className]; }), [false, false, "absolute", "hero__book"]);
    await p.close();
  });
  await ctx.close();
}

for (const [width, kind] of [[390, "one"], [1440, "one"], [390, "hour"], [1440, "hour"]]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B28 at ${width}, ${kind === "one" ? "a one way trip with meet and greet and a gratuity" : "an hourly trip"}: the trip card, the receipt rows in place before paint, CLS 0 with the receipt delayed, and the return trip`, async () => {
    const p = await open(ctx, P, "/book");
    if (kind === "hour") {
      await hourlyTrip(p);
    } else {
      await trip(p);
      await view(p);
      await priced(p);
    }
    await p.click(await go(p));
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    if (kind === "one") {
      await p.check("#bk-meet");
      await priced(p);
      await p.click('label[for="bk-t-15"]');
    }
    await priced(p);
    await details(p);
    await p.route("**/api/book?session_id=*", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue().catch(() => {});
    });
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    const first = await p.evaluate(() => ({ rows: [...document.querySelectorAll("#cf-lines tr")].map((tr) => tr.cells[0].textContent), trip: [...document.querySelectorAll("#cf-trip dt")].map((d) => d.textContent), test: !document.getElementById("cf-test").hidden, notes: document.getElementById("cf-notes").textContent, ret: !document.getElementById("cf-return").hidden }));
    const rows = kind === "one" ? ["Fare", "NYC sales tax", "Black Car Fund", "Tolls and airport fees", "Meet and greet", "Gratuity for your chauffeur (15%)"] : ["Fare, 3 hours", "NYC sales tax", "Black Car Fund"];
    assert.deepEqual(first, { rows, trip: ["When", "Car"], test: true, notes: kind === "one" ? NOTES.included + POLICY.later.airport : POLICY.later.hourly, ret: kind === "one" });
    assert.deepEqual(await p.evaluate(() => [document.getElementById("cf").classList.contains("is-wait"), document.getElementById("cf-refrow").hidden, document.getElementById("cf-noref").hidden, document.querySelector("#cf-ref .bk-sk") !== null, document.getElementById("cf-copy").getAttribute("aria-disabled"), document.getElementById("cf-ics").getAttribute("aria-disabled")]), [true, false, true, true, "true", "true"], "the checking state: skeletons in the chip, Copy and Add to calendar wait");
    const pill = () => p.evaluate(() => { const r = document.getElementById("cf-refrow").getBoundingClientRect(), c = document.getElementById("cf-copy").getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(c.left * 10) / 10]; });
    const skel = await pill();
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    assert.deepEqual(await pill(), skel, "the 8 digits take the skeleton's width, so the pill and Copy do not move (owner request 5)");
    await p.waitForTimeout(300);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.equal(await p.evaluate(() => document.getElementById("cf-receipt").lastElementChild.id), "cf-summary");
    if (kind === "one") {
      assert.deepEqual(await p.$$eval("#cf-trip dd", (d) => d.map((x) => x.textContent)), [`${new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, 12:40 PM, New York time`, "Business SUVChevrolet Suburban or similar"]);
      assert.deepEqual(await p.$$eval("#cf-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMJFK Terminal 4", "350 5th Ave, New York, NY 10118"]);
      assert.equal(await p.textContent("#cf-day span"), "Your chauffeur waits inside the terminal with a name sign.");
      await Promise.all([p.waitForURL(/\/book#trip$/), p.click("#cf-return")]);
      assert.deepEqual(await p.evaluate(() => [document.getElementById("book-form").dataset.step, document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-to-id").value, document.getElementById("bk-time").value, document.getElementById("bk-date").value, document.activeElement.dataset.day]), ["search", "350 5th Ave, New York, NY 10118", "JFK Terminal 4", "jfk-t4", "", DATE, DATE]);
      assert.deepEqual(await p.evaluate(() => [document.getElementById("retnote").classList.contains("is-on"), !document.getElementById("bk-cal").hidden, JSON.parse(sessionStorage.getItem("nlr-book")).ret]), [true, true, undefined], "the return trip note, the calendar on the outbound date, and ret cleared");
    }
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B31 the return trip gets its own nonce and reference, and the confirmation does not show it before it is paid", async () => {
    const pay = async (p, restored) => {
      if (!restored) await view(p);
      await priced(p);
      await next(p);
      await priced(p);
      await details(p);
      const nonce = await p.inputValue("#bk-nonce");
      await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click("#bk-submit")]);
      await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
      return [nonce, await p.textContent("#cf-ref")];
    };
    const p = await open(ctx, P, "/book");
    await trip(p);
    const [n1, r1] = await pay(p);
    await Promise.all([p.waitForURL(/\/book#trip$/), p.click("#cf-return")]);
    await setTime(p, "18:00");
    await view(p);
    await p.goto(`${P.base}/booking-confirmed`, { waitUntil: "load" });
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    assert.deepEqual(await p.evaluate(() => [document.getElementById("cf-ref").textContent, document.getElementById("cf-trip").hidden, document.getElementById("cf-return").hidden]), [r1, false, false]);
    const card = await p.textContent("#cf-trip");
    assert.ok(card.includes("12:40 PM") && !card.includes("6:00 PM"), `the card shows the paid trip, not the return draft: ${card}`);
    await p.goto(`${P.base}/book#options`, { waitUntil: "load" });
    const [n2, r2] = await pay(p, true);
    assert.ok(n1 && n2 && n1 !== n2, `${n1} ${n2}`);
    assert.notEqual(r1, r2);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check("B32 a paid round trip: the confirmation lists the return ride after the outbound one and hides the summary line that repeats the trip", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await p.click("#bk-addret");
    await pickDate(p, "#bk-rdate-btn", RDATE);
    await setTime(p, "18:00", "#bk-rtime");
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    const long = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    assert.deepEqual(await p.$$eval("#cf-trip dt", (d) => d.map((x) => x.textContent)), ["When", "Return", "Car"]);
    assert.deepEqual((await p.$$eval("#cf-trip dd", (d) => d.map((x) => x.textContent))).slice(0, 2), [`${long(DATE)}, 12:40 PM, New York time`, `${long(RDATE)}, 6:00 PM, New York time`]);
    assert.equal(await p.isVisible("#cf-summary"), false);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

for (const [width, height] of [[1440, 900], [1280, 720]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B33 at ${width} by ${height}, every calendar opens whole under its field, below the header and inside the window, and on / the hero keeps its place`, async () => {
    const whole = (p) => p.evaluate(() => { const k = document.getElementById("bk-cal"), c = k.getBoundingClientRect(); return [c.top >= document.querySelector(".site-header").getBoundingClientRect().bottom, c.bottom <= innerHeight, Math.round(c.top - k.parentElement.getBoundingClientRect().bottom)]; });
    const hero = (p) => p.evaluate(() => [".hero h1", ".hero__tags--svc", "#bk-search"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY)));
    const p = await open(ctx, P, "/");
    await showBar(p);
    const still = await hero(p);
    await tap(p, "#bk-date-btn");
    await p.waitForSelector("#bk-cal:not([hidden])");
    await p.waitForTimeout(300);
    assert.deepEqual(await whole(p), [true, true, 4]);
    await p.keyboard.press("ArrowDown");
    assert.deepEqual(await whole(p), [true, true, 4]);
    assert.deepEqual(await hero(p), still);
    await p.close();
    for (const path of ["/services", "/book"]) {
      const q = await open(ctx, P, path);
      await q.click("#bk-date-btn");
      await q.waitForSelector("#bk-cal:not([hidden])");
      await q.waitForTimeout(300);
      assert.deepEqual(await whole(q), [true, true, 4], `${path} date`);
      await q.keyboard.press("Escape");
      await q.click("#bk-addret");
      await q.click("#bk-rdate-btn");
      await q.waitForSelector("#bk-cal:not([hidden])");
      await q.waitForTimeout(300);
      assert.deepEqual(await whole(q), [true, true, 4], `${path} return date`);
      assert.deepEqual(q.errors, []);
      await q.close();
    }
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await check("B34 at 390 on a touch screen, focusing the pickup in the lower half scrolls the trip type switch to just under the header", async () => {
    for (const path of ["/", "/book"]) {
      const p = await open(ctx, P, path);
      await p.setViewportSize({ width: 390, height: path === "/book" ? 640 : 800 });
      await p.evaluate(() => document.getElementById("bk-from-f").getBoundingClientRect().top > visualViewport.height / 2 || scrollTo(0, document.getElementById("bk-from").getBoundingClientRect().top + scrollY - visualViewport.height * 0.7));
      await p.waitForTimeout(100);
      await p.tap("#bk-from");
      await p.waitForTimeout(400);
      const [mode, header] = await p.evaluate(() => [document.getElementById("bk-mode").getBoundingClientRect().top, document.querySelector(".site-header").getBoundingClientRect().bottom]);
      assert.ok(mode >= header && mode <= header + 24, `${path} ${mode} ${header}`);
      await p.close();
    }
  });
  await ctx.close();
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B35 at ${width} by ${height}, steps 2 and 3 open on /book with the trip line and Back to vehicles below the header`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    const gap = () => p.evaluate(() => document.getElementById(document.getElementById("book-form").dataset.step === "details" ? "bk-back" : "bk-sum").getBoundingClientRect().top - document.querySelector(".site-header").getBoundingClientRect().bottom);
    await view(p);
    assert.ok((await gap()) >= 0, `options ${await gap()}`);
    await p.evaluate(() => scrollTo(0, document.getElementById("bk-cards").getBoundingClientRect().bottom + scrollY));
    await next(p);
    await p.waitForTimeout(300);
    assert.ok((await gap()) >= 0, `details ${await gap()}`);
    await p.close();
  });
  await ctx.close();
}

for (const [width, height] of [[1280, 800], [1366, 768], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B29 at ${width} by ${height}, /book#options restored for the reference trip: the five rows and every price are inside the first screen, nothing scrolls sideways and Book and pay online is in view, under the rows or at the foot of the summary card`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await p.reload({ waitUntil: "load" });
    await priced(p);
    await p.evaluate(() => scrollTo(0, 0));
    const r = await p.evaluate((keys) => keys.map((c) => { const b = document.getElementById(`bk-p-${c}`).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), b.width > 0 ? (document.querySelector(`#bk-p-${c} .bk-fig`) || {}).textContent : ""]; }), CLASS_KEYS);
    assert.ok(r.every(([t], i) => !i || t > r[i - 1][0]), `five rows in one column: ${JSON.stringify(r)}`);
    assert.ok(r.every(([, b]) => b <= height), `every price inside the first screen: ${JSON.stringify(r)}`);
    assert.deepEqual(r.map((x) => x[2]), JFK_CARDS);
    const fit = await p.evaluate((h) => { const c = document.getElementById("bk-cards"), go = ["bk-next", "bk-bar-go"].map((i) => document.getElementById(i).getBoundingClientRect()).find((n) => n.height && n.top > 0 && n.bottom <= h); return [document.documentElement.scrollWidth - document.documentElement.clientWidth, c.scrollWidth - c.clientWidth, go ? Math.round(go.top) : -1, go ? Math.round(go.bottom) : -1]; }, height);
    assert.ok(fit[0] <= 0 && fit[1] === 0, `nothing scrolls sideways (the stable scrollbar gutter leaves scrollWidth under clientWidth): ${JSON.stringify(fit)}`);
    assert.ok(fit[2] > 0 && fit[3] <= height, `Book and pay online at ${fit.slice(2)}`);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B30 at 1440 on /locations/manhattan the calendar opened from the banner bar is whole in view and paints above the content around it", async () => {
    const p = await open(ctx, P, "/locations/manhattan");
    await p.click("#bk-date-btn");
    await p.waitForSelector("#bk-cal:not([hidden])");
    const hit = await p.evaluate(() => {
      const rows = document.querySelectorAll("#bk-cal tbody tr");
      const b = rows[rows.length - 1].getBoundingClientRect();
      const c = document.getElementById("bk-cal").getBoundingClientRect(), h = document.querySelector(".site-header").getBoundingClientRect().bottom;
      const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return [c.top >= h && c.bottom <= innerHeight, !!(e && (e.closest(".bk-cal__day") || e.closest("#bk-cal")))];
    });
    assert.deepEqual(hit, [true, true], "the whole calendar is in view and paints above what is under it");
    await p.close();
  });
  await ctx.close();
}

async function routeTrip(p, { from = ["edition", "The New York EDITION"], to = ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], ret = false } = {}) {
  await place(p, "from", ...from);
  if (from[0] === "edition") await p.waitForFunction(() => /^v1\./.test(document.getElementById("bk-from-ticket").value));
  if (to) await place(p, "to", ...to);
  if (to && to[0] === "edition") await p.waitForFunction(() => /^v1\./.test(document.getElementById("bk-to-ticket").value));
  await pickDate(p, "#bk-date-btn", DATE);
  await setTime(p, "12:40");
  if (ret) {
    await p.click("#bk-addret");
    await pickDate(p, "#bk-rdate-btn", RDATE);
    await setTime(p, "18:00", "#bk-rtime");
  }
}
const mapBoxes = (p) =>
  p.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) }; };
    const go = (id) => { const a = r(document.getElementById(id)), h = document.querySelector(".site-header").getBoundingClientRect().bottom; return a.height && a.top >= h && a.bottom <= innerHeight ? a : r(document.getElementById("bk-bar-go")); };
    const m = document.getElementById("bk-map"), cs = (e) => getComputedStyle(e), img = m.querySelector("img"), route = document.getElementById("bk-route"), side = document.getElementById("bk-side");
    const whole = (i) => { const nw = i.naturalWidth, nh = i.naturalHeight, cw = i.clientWidth, ch = i.clientHeight, f = cs(i).objectFit, s = f === "cover" ? Math.max(cw / nw, ch / nh) : f === "contain" ? Math.min(cw / nw, ch / nh) : f === "none" ? 1 : NaN; return f === "fill" ? Math.abs(cw / ch - nw / nh) < 0.02 : nw * s <= cw + 0.5 && nh * s <= ch + 0.5 && i.offsetLeft >= 0 && i.offsetTop >= 0 && cw <= m.clientWidth && ch <= m.clientHeight; };
    return {
      map: r(m), cards: r(document.getElementById("bk-cards")), incl: r(document.getElementById("bk-incl")), side: r(side), pay: r(document.querySelector("#bk-side .bk-pay")),
      next: go("bk-next"), submit: go("bk-submit"), header: r(document.querySelector(".site-header")), note: r(document.getElementById("resume")),
      look: [cs(m).borderRadius, cs(m).boxShadow, cs(m).borderTopWidth], edge: [cs(m).borderTopStyle, cs(m).borderBottomStyle, cs(m).borderTopColor === cs(document.querySelector(".bk-lines tfoot th") || m).borderTopColor], display: cs(m).display, vis: cs(m).visibility, offText: m.classList.contains("is-off") ? m.innerText : "",
      inner: [m.clientWidth, m.clientHeight], first: side.firstElementChild === m,
      seen: ((t, g, sd) => t.height > 0 && t.top >= sd.top && t.bottom <= Math.min(sd.bottom, cs(document.getElementById("bk-bar")).display === "none" ? Infinity : g.top))(document.getElementById("price-total").getBoundingClientRect(), document.getElementById("bk-bar").getBoundingClientRect(), side.getBoundingClientRect()),
      img: img && { w: +img.getAttribute("width"), h: +img.getAttribute("height"), rw: Math.round(img.getBoundingClientRect().width), rh: Math.round(img.getBoundingClientRect().height), fit: cs(img).objectFit, whole: whole(img), srcset: img.srcset, ok: img.complete && img.naturalWidth > 0, alt: img.alt, policy: img.referrerPolicy },
      route: route.hidden ? null : [...route.children].map((li) => li.textContent), routeNote: document.getElementById("bk-route-n").hidden ? null : document.getElementById("bk-route-n").textContent, routeSeen: document.getElementById("bk-route-n").hidden ? null : document.getElementById("bk-route-n").innerText.trim(),
      inCard: !!route.closest("#bk-side"), drive: cs(document.getElementById("bk-drive")).display === "none" ? null : document.getElementById("bk-drive").innerText,
    };
  });
const sideBoxes = (p) =>
  p.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) }; };
    const go = (id) => { const a = r(document.getElementById(id)), h = document.querySelector(".site-header").getBoundingClientRect().bottom; return a.height && a.top >= h && a.bottom <= innerHeight ? a : r(document.getElementById("bk-bar-go")); };
    const m = document.getElementById("bk-map"), c = document.querySelector("#bk-side .bk-pay"), cs = (e) => getComputedStyle(e);
    const img = m.querySelector("img");
    return {
      side: r(document.getElementById("bk-side")), map: r(m), drive: r(document.getElementById("bk-drive")), card: r(c),
      next: go("bk-next"), submit: go("bk-submit"), header: r(document.querySelector(".site-header")),
      look: [cs(m).borderRadius, cs(m).boxShadow, cs(m).borderTopWidth, cs(c).borderRadius, cs(c).boxShadow, cs(c).borderTopWidth],
      order: [...document.getElementById("bk-side").children].map((e) => e.id || e.className),
      img: img && { w: +img.getAttribute("width"), h: +img.getAttribute("height"), srcset: img.srcset, cw: m.clientWidth, ch: m.clientHeight, ok: img.complete && img.naturalWidth > 0, alt: img.alt, policy: img.referrerPolicy },
      note: r(document.getElementById("resume")), drive_text: document.getElementById("bk-drive").innerText, box_text: m.innerText,
      display: cs(m).display, vh: innerHeight,
    };
  });

for (const [width, height] of [[1024, 768], [1280, 800], [1366, 768], [1440, 900]]) {
  const ctx = await context(G, { viewport: { width, height } });
  await check(`B35 at ${width} by ${height} the route map is the first card of the right column, as wide as the summary card and above the price, with a 1 px line edge and no shadow, a sized request of at most 640 px and an image shown whole that still fits after a resize, the total in view above Book and pay online, the route list carries the drive time and the note the miles and minutes, a return trip routes and lists both legs in one request, Book and pay online stays in view on steps 2 and 3 under the rows or at the foot of the summary card, after a cancelled payment and with meet and greet`, async () => {
    const p = await open(ctx, G, "/book");
    const bodies = [];
    p.on("request", (r) => r.url().endsWith("/api/route") && bodies.push(JSON.parse(r.postData())));
    await routeTrip(p);
    await view(p);
    await priced(p);
    await p.waitForSelector("#bk-map img");
    await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    await p.waitForTimeout(300);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(100);
    const b = await mapBoxes(p);
    assert.ok(b.next.bottom <= height && b.next.top >= b.header.bottom, `Book and pay online at scroll 0 ${JSON.stringify(b.next)}`);
    assert.deepEqual([b.first, b.map.left, b.map.width, b.map.top], [true, b.side.left, b.side.width, b.side.top], "the map is the first card of the right column, as wide as the summary card");
    assert.ok(b.map.bottom <= b.pay.top && b.pay.width === b.map.width, `the map sits above the price card ${JSON.stringify([b.map, b.pay])}`);
    assert.deepEqual([b.display, ...b.look, ...b.edge], ["block", "16px", "none", "1px", "solid", "solid", true]);
    assert.ok(b.map.height >= 80 && b.map.height <= 330 && b.seen, `the map, the total and Book and pay online all show in the right column ${JSON.stringify([b.map, b.side, b.seen])}`);
    const body = bodies[0].map;
    assert.ok(body.width <= 640 && body.width === Math.min(640, b.inner[0]) && Math.abs(body.height - Math.round(b.inner[1] * body.width / b.inner[0])) <= 1, JSON.stringify([body, b.inner]));
    assert.deepEqual([b.img.w, b.img.h, b.img.rw, b.img.rh, b.img.fit, b.img.whole, b.img.ok], [body.width, body.height, ...b.inner, "contain", true, true]);
    assert.deepEqual([b.img.alt, b.img.policy], ["Route map from The New York EDITION, Madison Avenue, New York, NY to JFK Terminal 4", "strict-origin-when-cross-origin"]);
    assert.ok(/ 2x$/.test(b.img.srcset), b.img.srcset);
    assert.deepEqual([b.route, b.routeNote, b.routeSeen, b.inCard, b.drive], [["12:40 PMThe New York EDITION, Madison Avenue, New York, NY", "About 1:25 PMJFK Terminal 4"], DRIVE_N, DRIVE_SEEN, true, null]);
    await p.setViewportSize({ width, height: height - 200 });
    await p.waitForTimeout(200);
    const z = await mapBoxes(p);
    assert.deepEqual([z.img.fit, z.img.whole], ["contain", true], `after a resize the map image is still shown whole ${JSON.stringify([z.map, z.img])}`);
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(200);
    const end = await p.evaluate(() => Math.max(0, Math.round(document.getElementById("bk-incl").getBoundingClientRect().bottom + scrollY - innerHeight)));
    for (const y of [100, Math.round(end / 2), end]) {
      await p.evaluate((y) => scrollTo(0, y), y);
      await p.waitForTimeout(120);
      const at = await mapBoxes(p);
      const [shown, part, bg] = await p.evaluate(() => { const h = document.querySelector(".site-header").getBoundingClientRect().bottom, x = document.getElementById("bk-next"), n = x.getBoundingClientRect(), g = document.getElementById("bk-bar-go").getBoundingClientRect(); return [[n.height > 0 && n.top >= h && n.bottom <= innerHeight, g.height > 0 && g.top >= h && g.bottom <= innerHeight], n.bottom > h && n.top < innerHeight, getComputedStyle(x).backgroundColor]; });
      assert.ok(shown[0] !== shown[1], `exactly one whole Book and pay online on screen at scroll ${y}, the one under the rows or the card foot ${JSON.stringify([shown, at.side, at.next, at.header])}`);
      if (part && shown[1]) assert.ok(!["rgb(201, 162, 39)", "rgb(184, 146, 31)", "rgb(168, 133, 28)"].includes(bg), `a partly shown Book and pay online under the rows is not gold while the card foot shows one (${bg})`);
    }
    await next(p);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    const s3 = await mapBoxes(p);
    assert.equal(s3.display, "none", "no map in step 3");
    assert.ok(s3.submit.bottom <= height && s3.submit.top >= s3.header.bottom, `Book and pay online in step 3 ${JSON.stringify(s3.submit)}`);
    await p.goto(`${G.base}/book#resume`, { waitUntil: "load" });
    await priced(p);
    await p.waitForTimeout(300);
    await p.evaluate(() => scrollTo(0, 0));
    const r3 = await mapBoxes(p);
    assert.ok(r3.note.height > 0 && r3.note.left + r3.note.width <= r3.side.left, `the payment note stays left of the right column ${JSON.stringify([r3.note, r3.side])}`);
    assert.ok(r3.submit.bottom <= height, `resume step 3 ${JSON.stringify(r3.submit)}`);
    await p.click("#bk-back");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(p);
    await p.waitForSelector("#bk-map img");
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    const r2 = await mapBoxes(p);
    assert.deepEqual([r2.display, r2.next.bottom <= height], ["block", true], `resume, Back to vehicles ${JSON.stringify([r2.map, r2.next])}`);
    await p.close();
    const q = await open(ctx, G, "/book");
    const qb = [];
    q.on("request", (r) => r.url().endsWith("/api/route") && qb.push(JSON.parse(r.postData())));
    await routeTrip(q, { from: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to: ["edition", "The New York EDITION"], ret: true });
    await view(q);
    await priced(q);
    await q.waitForSelector("#bk-map img");
    await q.waitForFunction(() => /Return/.test(document.getElementById("bk-route-n").textContent));
    const m0 = await mapBoxes(q);
    assert.equal(m0.routeNote, "16.8 miles, about 43 min by car. Return: 16.8 miles, about 43 min by car. Google Maps", "a return trip lists both rides");
    assert.deepEqual([qb.length, qb[0].from, qb[0].back, qb[0].map], [1, { id: "jfk-t4" }, { date: RDATE, time: "18:00" }, { width: Math.min(640, m0.inner[0]), height: Math.round(m0.inner[1] * Math.min(640, m0.inner[0]) / m0.inner[0]) }], "one route request carries both legs and the map size");
    await q.click('label[for="bk-c-premium"]');
    await priced(q);
    await q.evaluate(() => scrollTo(0, 0));
    await q.waitForTimeout(150);
    const m = await mapBoxes(q);
    assert.ok(m.next.bottom <= height, `another class ${JSON.stringify(m.next)}`);
    assert.deepEqual([m.map.width, m.map.height, m.img.rw, m.img.rh, m.img.whole], [m0.map.width, m0.map.height, ...m0.inner, true], "the map keeps its size and the image fits it whole when the class changes");
    await next(q);
    await q.check("#bk-meet");
    await q.waitForFunction(() => [...document.querySelectorAll("#price-lines th, #price-lines td")].some((x) => x.textContent === "Meet and greet"));
    await priced(q);
    await q.evaluate(() => scrollTo(0, 0));
    await q.waitForTimeout(150);
    const m3 = await mapBoxes(q);
    assert.ok(m3.submit.bottom <= height, `meet and greet, Book and pay online ${JSON.stringify(m3.submit)}`);
    await q.close();
  });
  await ctx.close();
}

for (const [width, height] of [[1023, 768], [390, 844]]) {
  const ctx = await context(G, { viewport: { width, height } });
  await check(`B35 at ${width} the route map sits right above the summary card, as wide as it, 16/9 and at most 360 px tall with a 1 px line edge, a map of that size is requested and shown whole, the route list carries the drive time, the note the miles and minutes, and the drive line stays hidden`, async () => {
    const p = await open(ctx, G, "/book");
    const bodies = [];
    p.on("request", (r) => r.url().endsWith("/api/route") && bodies.push(JSON.parse(r.postData())));
    await routeTrip(p);
    await view(p);
    await priced(p);
    await p.waitForSelector("#bk-map img");
    await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    const b = await mapBoxes(p);
    assert.deepEqual([b.display, b.first, b.map.left, b.map.width, b.map.bottom + 16, ...b.look, ...b.edge], ["block", true, b.pay.left, b.pay.width, b.pay.top, "16px", "none", "1px", "solid", "solid", true], JSON.stringify([b.map, b.pay]));
    assert.ok(Math.abs(b.map.height - Math.min(360, b.map.width * 9 / 16)) <= 1, JSON.stringify(b.map));
    assert.deepEqual([bodies.length, bodies[0].map, b.img.fit, b.img.whole, b.img.ok, b.drive, b.routeNote, b.routeSeen], [1, { width: Math.min(640, b.inner[0]), height: Math.round(b.inner[1] * Math.min(640, b.inner[0]) / b.inner[0]) }, "contain", true, true, null, DRIVE_N, DRIVE_SEEN]);
    assert.equal(b.route[1], "About 1:25 PMJFK Terminal 4");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await check("B36 at 1440 a late route answer without a map hides the map card but keeps its space (CLS 0), the route list keeps its rows and fills or empties its time slot, its note gives the miles and minutes only when a route came, a server without static maps shows the drive line instead of the list, hourly trips draw neither", async () => {
    const DRIVE = DRIVE_N;
    for (const [name, body, box, time] of [
      ["off", { kind: "off" }, "", ""],
      ["failed image", { kind: "ok", minutes: 43, miles: 16.8, map: { src: `${G.base}/assets/no-such-map.png`, src2x: `${G.base}/assets/no-such-map.png`, width: 440, height: 271 } }, "", "About 1:25 PM"],
      ["no map", { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" }, "", "About 1:25 PM"],
    ]) {
      const p = await open(ctx, G, "/book");
      await p.route("**/api/route", async (r) => {
        await new Promise((z) => setTimeout(z, 900));
        await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
      });
      await routeTrip(p);
      await view(p);
      const a = await mapBoxes(p);
      await p.waitForSelector("#bk-map.is-off", { state: "attached" });
      await p.waitForTimeout(300);
      const b = await mapBoxes(p);
      const [value, shifts] = await cls(p);
      assert.ok(value < 0.001, `${name}: ${value} ${shifts.join(" | ")}`);
      assert.deepEqual([b.display, b.vis, b.img, b.map.height, b.offText, b.drive], ["block", "hidden", null, a.map.height, box, null], name);
      assert.deepEqual([b.route.length, (await p.textContent("#bk-route .bk-route__z")).trim(), b.routeNote, b.routeSeen], [2, time, time ? DRIVE : "", time ? DRIVE : ""], `${name}: the route list, with Google Maps in the note while no map image shows`);
      await p.close();
    }
    const n = await open(ctx, G, "/book");
    const bodies = [];
    n.on("request", (r) => r.url().endsWith("/api/route") && bodies.push(JSON.parse(r.postData())));
    await n.route("**/api/places", async (r) => {
      const res = await r.fetch();
      const j = await res.json();
      await r.fulfill({ status: res.status(), contentType: "application/json", body: JSON.stringify(j.ticket ? { ...j, map: false } : j) });
    });
    await n.route("**/api/route", async (r) => {
      await new Promise((z) => setTimeout(z, 900));
      await r.continue().catch(() => {});
    });
    await routeTrip(n);
    await view(n);
    assert.equal(await n.getAttribute("#bk-map", "hidden"), "");
    await n.waitForFunction(() => document.getElementById("bk-drive").textContent.length > 0);
    await n.waitForTimeout(300);
    const c = await mapBoxes(n);
    const [value, shifts] = await cls(n);
    assert.ok(value < 0.001, `no static maps: ${value} ${shifts.join(" | ")}`);
    assert.deepEqual([c.display, c.map.height, c.route, c.drive, bodies.map((x) => x.map)], ["none", 0, null, DRIVE, [undefined]]);
    await n.close();
    const h = await open(ctx, G, "/book");
    await h.click('label[for="bk-hour"]');
    await routeTrip(h, { to: null });
    await view(h);
    await priced(h);
    await h.evaluate(() => scrollTo(0, 0));
    await h.waitForTimeout(300);
    const b = await mapBoxes(h);
    assert.deepEqual([b.display, b.route, b.drive], ["none", null, null]);
    assert.ok(b.next.bottom <= 900);
    await h.close();
  });
  await ctx.close();
}

const typedTrip = async (p, { from = "350 5th Ave, New York, NY 10118", to = "277 Bedford Ave, Brooklyn, NY 11211", id = "", ret = false } = {}) => {
  if (id) await place(p, "from", ...id);
  else await place(p, "from", from);
  await place(p, "to", to);
  await pickDate(p, "#bk-date-btn", DATE);
  await setTime(p, "14:00");
  if (ret) {
    await p.click("#bk-addret");
    await pickDate(p, "#bk-rdate-btn", RDATE);
    await setTime(p, "18:00", "#bk-rtime");
  }
};
const drift = (p) =>
  p.route("**/api/route", async (r) => {
    const res = await r.fetch();
    const j = await res.json();
    await r.fulfill({ status: res.status(), contentType: "application/json", body: JSON.stringify(j.kind === "ok" ? { ...j, minutes: 41, miles: 9.9 } : j) });
  });
const routed = (p) => p.waitForFunction(() => document.querySelector("#bk-map img") && /miles/.test(document.getElementById("bk-route-n").textContent));
const watch = (p) => {
  const w = { route: [], options: [], ride: undefined };
  p.on("request", (r) => {
    if (r.url().endsWith("/api/route")) w.route.push(JSON.parse(r.postData()));
    if (r.url().endsWith("/api/book") && JSON.parse(r.postData()).action === "options") w.options.push(JSON.parse(r.postData()));
  });
  p.on("response", (r) => r.url().endsWith("/api/book") && JSON.parse(r.request().postData()).action === "options" && r.json().then((j) => w.ride === undefined && (w.ride = j.ride || null), () => 0));
  return w;
};
const shown = (p) => p.evaluate(() => document.getElementById("price-total").firstChild.textContent);

for (const [width, height] of [[1440, 900], [390, 844]]) {
  const ctx = await context(G, { viewport: { width, height } });
  await check(`B139 at ${width} typed addresses get their route on the map: a trip priced by distance draws and labels the ride that set its price from the options answer with no second route call, a return lists both rides, an airport trip to a typed address and an airport return are routed in one request each beside the flat total, and an address the server cannot place gets no route`, async () => {
    const p = await open(ctx, G, "/book");
    const w = watch(p);
    await drift(p);
    await typedTrip(p);
    await view(p);
    await priced(p);
    await routed(p);
    const a = await mapBoxes(p);
    assert.deepEqual([w.route.length, w.options.length, JSON.parse(w.options[0].map), w.ride.minutes, w.ride.miles], [0, 1, { width: Math.min(640, a.inner[0]), height: Math.round(a.inner[1] * Math.min(640, a.inner[0]) / a.inner[0]) }, 27, 4.6], "one route call: the options answer that priced the trip carries its map");
    assert.deepEqual([a.routeNote, a.routeSeen, a.route[1], await shown(p), a.img.ok, a.img.alt], ["4.6 miles, about 27 min by car. Google Maps", "4.6 miles, about 27 min by car.", "About 2:30 PM277 Bedford Ave, Brooklyn, NY 11211", "$122.24", true, "Route map from 350 5th Ave, New York, NY 10118 to 277 Bedford Ave, Brooklyn, NY 11211"]);
    let [value, shifts] = await cls(p);
    assert.ok(value < 0.001, `${value} ${shifts.join(" | ")}`);
    await p.close();
    const q = await open(ctx, G, "/book");
    const v = watch(q);
    await drift(q);
    await typedTrip(q, { ret: true });
    await view(q);
    await priced(q);
    await routed(q);
    const b = await mapBoxes(q);
    assert.deepEqual([v.route.length, v.ride.minutes, v.ride.back, b.routeNote, await shown(q)], [0, 27, { minutes: 31, miles: 4.8 }, "4.6 miles, about 27 min by car. Return: 4.8 miles, about 31 min by car. Google Maps", "$244.48"]);
    [value, shifts] = await cls(q);
    assert.ok(value < 0.001, `return: ${value} ${shifts.join(" | ")}`);
    await q.close();
    for (const ret of [false, true]) {
      const t = await open(ctx, G, "/book");
      const u = watch(t);
      await typedTrip(t, { id: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to: "350 5th Ave, New York, NY 10118", ret });
      await view(t);
      await priced(t);
      await routed(t);
      const c = await mapBoxes(t);
      assert.deepEqual([u.route.length, u.route[0].from, u.route[0].to, u.route[0].back, u.ride], [1, { id: "jfk-t4" }, { text: "350 5th Ave, New York, NY 10118" }, ret ? { date: RDATE, time: "18:00" } : undefined, null]);
      assert.deepEqual([c.routeNote, c.route[1], await shown(t)], [ret ? "16.8 miles, about 43 min by car. Return: 16.8 miles, about 43 min by car. Google Maps" : DRIVE_N, "About 2:45 PM350 5th Ave, New York, NY 10118", ret ? "$370.00" : "$185.00"]);
      await t.close();
    }
    const n = await open(ctx, G, "/book");
    const x = watch(n);
    await place(n, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await type(n, "to", "350 5th Ave");
    await n.waitForFunction(() => /ZIP code needed/.test(document.querySelector('#bk-to-list [data-kind="typed"]')?.textContent || ""));
    await n.keyboard.press("Escape");
    await pickDate(n, "#bk-date-btn", DATE);
    await setTime(n, "14:00");
    await view(n);
    await n.waitForTimeout(600);
    const d = await mapBoxes(n);
    assert.deepEqual([x.route.length, x.options.every((o) => o.map === undefined), d.display, d.route], [0, true, "none", null], "a typed end the server cannot place gets no route and no empty map");
    await n.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 390, height: 844 } });
  await check("B142 at 390 a route answer that comes back off while the map card is below the screen removes the card and leaves the note empty, and nothing on screen moves", async () => {
    const p = await open(ctx, G, "/book");
    await p.route("**/api/route", async (r) => {
      await new Promise((z) => setTimeout(z, 900));
      await r.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"off"}' }).catch(() => {});
    });
    await routeTrip(p);
    await view(p);
    await p.evaluate(() => scrollTo(0, 0));
    const a = await mapBoxes(p);
    assert.ok(a.map.height > 80 && a.map.top >= 844, JSON.stringify(a.map));
    await p.waitForFunction(() => document.getElementById("bk-map").hidden);
    await p.waitForTimeout(300);
    const b = await mapBoxes(p);
    const [value, shifts] = await cls(p);
    assert.ok(value < 0.001, `${value} ${shifts.join(" | ")}`);
    assert.deepEqual([b.display, b.map.height, b.routeNote, (await p.textContent("#bk-route .bk-route__z")).trim(), b.route.length], ["none", 0, "", "", 2]);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await check("B140 a paid trip priced by distance: the confirmation keeps the line with the miles and minutes that set the fare, and its trip card arrives at the time of that ride", async () => {
    const p = await open(ctx, G, "/book");
    await typedTrip(p);
    await view(p);
    await priced(p);
    await routed(p);
    await next(p);
    await priced(p);
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    const long = new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    assert.deepEqual([await p.isVisible("#cf-summary"), await p.textContent("#cf-summary"), await p.textContent("#cf-total")], [true, `${long}, 2:00 PM. Business SUV, 4.6 miles and 27 min.`, "$122.24"]);
    assert.deepEqual(await p.$$eval("#cf-route li", (l) => l.map((x) => x.textContent)), ["2:00 PM350 5th Ave, New York, NY 10118", "About 2:30 PM277 Bedford Ave, Brooklyn, NY 11211"]);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 }, forcedColors: "active" });
  await check("B141 forced colors: every place suggestion row has a CanvasText border and the active one a Highlight border", async () => {
    const p = await open(ctx, P, "/book");
    await type(p, "from", "jfk");
    await p.waitForSelector("#bk-from-list [role=option]");
    await p.keyboard.press("ArrowDown");
    const b = await p.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => { const s = getComputedStyle(x); return [s.borderTopStyle, s.borderBottomStyle, parseFloat(s.borderTopWidth) >= 1, x.getAttribute("aria-selected") === "true"]; }));
    assert.ok(b.length >= 6 && b.every(([t, u, w]) => t === "solid" && u === "solid" && w), JSON.stringify(b));
    const [rest, active] = await p.evaluate(() => [...document.querySelectorAll("#bk-from-list [role=option]")].slice(0, 2).reverse().map((x) => getComputedStyle(x).borderTopColor));
    assert.notEqual(rest, active);
    await p.close();
  });
  await ctx.close();
}

const inclGrid = (p) =>
  p.evaluate(() => {
    const lis = [...document.querySelectorAll("#bk-incl > li")].filter((li) => li.getBoundingClientRect().height);
    const lines = (li) => {
      const tops = [], walk = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode()); ) for (const m of n.data.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        const q = r.getClientRects()[0];
        if (q && q.width && !tops.some((t) => Math.abs(t - q.top) <= 3)) tops.push(q.top);
      }
      return tops.length;
    };
    return [lis.length, new Set(lis.map((li) => Math.round(li.getBoundingClientRect().top))).size, new Set(lis.map((li) => Math.round(li.getBoundingClientRect().left))).size, Math.max(...lis.map(lines)), Math.round(document.getElementById("bk-incl").getBoundingClientRect().height)];
  });

for (const [width, height] of [[1440, 900], [390, 844]]) {
  const ctx = await context(P, { viewport: { width, height } });
  const wide = width >= 600;
  await check(`B37 at ${width} every icon of the included grids sits centred above its own caption, on /book step 2 and in the homepage strip, the six /book tiles stand ${wide ? "three" : "two"} to a row with none past three lines in at most ${wide ? 140 : 240} px, and none shows over the ${wide ? "header or the sticky pills bar" : "sticky header"}`, async () => {
    const lone = (p, sel) =>
      p.evaluate((sel) =>
        [...document.querySelectorAll(sel)].filter((li) => li.getBoundingClientRect().height).map((li) => {
          const i = li.querySelector("svg.icon").getBoundingClientRect(), t = li.querySelector(":scope > span"), r = t.getBoundingClientRect();
          return [t.textContent.trim().length > 0, i.bottom <= r.top && r.top - i.bottom <= 16, Math.abs(i.left + i.width / 2 - (r.left + r.width / 2)) <= 1];
        }), sel);
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const book = await lone(p, ".incl > li");
    assert.equal(book.length, 6);
    assert.deepEqual(book, Array(6).fill([true, true, true]));
    const [, rows, cols, most, tall] = await inclGrid(p);
    assert.deepEqual([rows, cols], wide ? [2, 3] : [3, 2], wide ? "the six tiles of an airport pickup take two rows of three" : "on a phone the six tiles take three rows of two");
    assert.ok(most <= 3, `a tile runs to ${most} lines`);
    assert.ok(tall <= (wide ? 140 : 240), `the list is ${tall}px tall`);
    await p.evaluate(() => scrollTo(0, document.getElementById("bk-incl").getBoundingClientRect().top + scrollY - 44));
    if (wide) await p.waitForFunction(() => document.getElementById("bk-pills").classList.contains("is-on"));
    const [under, shows] = await p.evaluate(() => {
      const bar = Math.max(...[document.querySelector(".site-header"), document.getElementById("bk-pills")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => e.getBoundingClientRect().bottom));
      const hid = [...document.querySelectorAll("#bk-incl > li")].filter((li) => li.getBoundingClientRect().height).flatMap((li) => [li.querySelector("svg"), li.querySelector(":scope > span")].map((e) => {
        const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 8);
        return y < bar ? [e.textContent.trim() || e.tagName, li.contains(document.elementFromPoint(x, y))] : null;
      })).filter(Boolean);
      return [hid.length, hid.filter(([, seen]) => seen).map(([name]) => name)];
    });
    assert.ok(under > 0, "no tile sat under the header in this check");
    assert.deepEqual(shows, [], `an icon or a caption shows over the ${wide ? "header or the sticky pills bar" : "header"}`);
    await p.close();
    const h = await open(ctx, P, "/");
    const home = await lone(h, ".amen__list > li");
    assert.equal(home.length, 8, `the homepage's On board strip: ${home.length} items`);
    assert.ok(home.every((x) => x.every(Boolean)), JSON.stringify(home));
    await h.close();
  });
  await check(`B37 at ${width} a pickup away from the airport hides the two airport tiles and the other four stand ${wide ? "in one row" : "two to a row"} in at most ${wide ? 86 : 168} px, and with JavaScript off all six show ${wide ? "three" : "two"} to a row in at most ${wide ? 160 : 256} px, none past three lines`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p, { from: ["350 5th Ave, New York, NY 10118"], to: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"] });
    await view(p);
    await priced(p);
    const city = await inclGrid(p);
    assert.deepEqual(city.slice(0, 3), wide ? [4, 1, 4] : [4, 2, 2]);
    assert.ok(city[3] <= 3, `a tile runs to ${city[3]} lines`);
    assert.ok(city[4] <= (wide ? 86 : 168), `the list is ${city[4]}px tall`);
    await p.close();
    const off = await context(P, { viewport: { width, height }, javaScriptEnabled: false });
    const q = await open(off, P, "/book");
    const all = await inclGrid(q);
    assert.deepEqual(all.slice(0, 3), wide ? [6, 2, 3] : [6, 3, 2]);
    assert.ok(all[3] <= 3, `a tile runs to ${all[3]} lines`);
    assert.ok(all[4] <= (wide ? 160 : 256), `the list is ${all[4]}px tall`);
    await off.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B38 all errors at once: an empty search marks pickup, drop-off, date and pickup time together with focus on the pickup and one count sentence, a valid pickup clears only its own message, and step 3 lists two failures as links", async () => {
    const p = await open(ctx, P, "/book");
    await blank(p);
    await p.click("#bk-view");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)), ["e-from", "e-to", "e-date", "e-time"]);
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.textContent("#bk-status")], ["bk-from", "4 things to fix: pickup, drop-off, date and pickup time."]);
    assert.deepEqual(await p.evaluate(() => ["bk-from", "bk-to", "bk-date-btn", "bk-time-btn"].map((id) => document.getElementById(id).getAttribute("aria-invalid"))), ["true", "true", "true", "true"]);
    await p.keyboard.type("jfk t4");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)), ["e-to", "e-date", "e-time"], "the first keystroke that makes the pickup valid clears only its message");
    await p.locator('#bk-from-list [role=option][aria-label="Terminal 4, John F. Kennedy (JFK)"]').click();
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)), ["e-to", "e-date", "e-time"]);
    assert.equal(await p.getAttribute("#bk-from", "aria-invalid"), null);
    await p.keyboard.press("Escape");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await setTime(p, "12:40");
    await view(p);
    await priced(p);
    await next(p);
    await p.fill("#bk-name", "Ana Lopez");
    await p.click(await payBtn(p));
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-errs").hidden, document.querySelector("#bk-errs p").textContent, [...document.querySelectorAll("#bk-errs a")].map((a) => [a.getAttribute("href"), a.textContent])]), [false, "2 things to fix", [["#bk-email", "Add your email address, for example name@example.com."], ["#bk-phone", "Add your mobile number, and check its country code."]]]);
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-email");
    await p.click('#bk-errs a[href="#bk-phone"]');
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-phone");
    await p.fill("#bk-email", "ana@example.com");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-det .bk-e.is-on")].map((e) => e.id)), ["e-phone"], "a valid email clears only its own message");
    await p.close();
  });
  await check("B39 the calendar opens by itself after the drop-off pick on the first bookable day, today is bookable until its last hour, New York time shows, a time inside the next hour shows its hint with no link, and a time 1 hour away or more shows none", async () => {
    const p = await open(ctx, P, "/book");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "lga", "LaGuardia (LGA)");
    assert.deepEqual([await p.isVisible("#bk-cal"), await p.evaluate(() => document.activeElement.id)], [false, "bk-date-btn"], "with the date already filled in the calendar waits after the drop-off pick, focus on the date (owner request 2)");
    const auto = await p.inputValue("#bk-date");
    await p.click("#bk-date-btn");
    assert.equal(await p.isVisible("#bk-cal"), true);
    const today = nyDate(0), first = await p.evaluate(() => document.activeElement.dataset.day), late = firstDay() > today;
    assert.equal(first, auto, `the calendar opens on the date that filled in by itself: ${first}`);
    assert.equal(await p.getAttribute(`#bk-cal [data-day="${today}"]`, "aria-label"), new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) + (late ? ", email or WhatsApp only" : ""));
    assert.match(await p.textContent(".bk-cal__tz"), /^New York time/);
    assert.equal(await p.evaluate(() => (document.querySelector("#bk-cal .bk-cal__note") || {}).textContent || null), late ? HOUR_NOTE : null);
    await p.keyboard.press("Escape");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-date-btn");
    await pickDate(p, "#bk-date-btn", today);
    const soon = await p.evaluate(() => [...document.getElementById("bk-time").options].find((o) => o.value && !o.disabled)?.value);
    assert.ok(soon, "a slot later today");
    assert.ok(await p.evaluate(() => [...document.getElementById("bk-time").options].filter((o) => o.value).some((o) => o.disabled)), "the slots before now plus 10 minutes are disabled");
    await setTime(p, soon);
    await p.waitForFunction(() => !document.getElementById("bk-time-h").hidden);
    assert.deepEqual([await p.textContent("#bk-time-h"), await p.$("#bk-time-h a"), await p.textContent("#bk-status")], [HOUR_NOTE, null, HOUR_NOTE]);
    const bookable = await p.evaluate(([d, n]) => [...document.getElementById("bk-time").options].find((o) => o.value && !o.disabled && `${d} ${o.value}` >= n)?.value, [today, nyNow()]);
    if (bookable) {
      await setTime(p, bookable);
      await p.waitForFunction(() => document.getElementById("bk-time-h").hidden, null, { timeout: 3000 });
    }
    await p.close();
  });
  await check("B40 suggestions: an empty pickup shows the four airport chips with no active row, Enter picks row 1 and never the typed row, jfk shows Terminal 4 over John F. Kennedy (JFK) and writes the full name", async () => {
    const p = await open(ctx, P, "/book");
    await p.click("#bk-from");
    assert.deepEqual([await p.getAttribute("#bk-from", "aria-activedescendant"), await p.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => x.textContent))], [null, ["JFK", "LaGuardia", "Newark", "Teterboro"]]);
    await p.keyboard.type("jfk");
    assert.equal(await p.getAttribute("#bk-from", "aria-activedescendant"), null);
    assert.deepEqual(await p.$$eval("#bk-from-list [role=option][data-kind=local]", (o) => o.slice(0, 3).map((x) => [x.querySelector(".bk-opt__main").textContent, (x.querySelector(".bk-opt__sub") || {}).textContent || "", x.getAttribute("aria-label")])), [["John F. Kennedy (JFK)", "John F. Kennedy International Airport, Queens, NY 11430", null], ["Terminal 1", "John F. Kennedy (JFK)", "Terminal 1, John F. Kennedy (JFK)"], ["Terminal 4", "John F. Kennedy (JFK)", "Terminal 4, John F. Kennedy (JFK)"]]);
    await p.keyboard.press("Enter");
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id")], ["John F. Kennedy (JFK)", "jfk"], "Enter with no active row picks row 1");
    await type(p, "from", "jfk t4");
    await p.locator('#bk-from-list [role=option][aria-label="Terminal 4, John F. Kennedy (JFK)"]').click();
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id")], ["JFK Terminal 4", "jfk-t4"]);
    await type(p, "to", "zzzz qqqq");
    await p.keyboard.press("Enter");
    assert.equal(await p.inputValue("#bk-to-id"), "", "the typed row is never picked by Enter");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await check("B41 flight lookup with FLIGHT_MOCK: Checking EK 201..., the card, a bare airport pickup gets the answer's terminal with the wash, another chosen terminal gets Pick up at Terminal 4, the answer is stored as nlr-book.fa, and off, later, error and busy answers keep the idle line", async () => {
    const p = await open(ctx, G, "/book");
    await place(p, "from", "jfk", "John F. Kennedy (JFK)");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await p.keyboard.press("Escape").catch(() => {});
    await p.route("**/api/flight", async (route) => (route.request().postData() || "").includes('"number"') ? (await new Promise((r) => setTimeout(r, 500)), route.continue().catch(() => {})) : route.continue());
    await p.fill("#bk-flight", "EK201");
    await p.waitForFunction(() => document.getElementById("bk-flight-status").textContent === "Checking EK 201…");
    await p.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc"));
    await p.unroute("**/api/flight");
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id")], ["JFK Terminal 4", "jfk-t4"], "a bare airport pickup takes the answer's terminal");
    assert.match(await p.textContent("#bk-flight-status"), /Pickup set to Terminal 4 from your flight\./);
    assert.ok(await p.evaluate(() => document.getElementById("bk-from-f").classList.contains("is-tint")));
    const fa = await p.evaluate(() => JSON.parse(sessionStorage.getItem("nlr-book")).fa);
    assert.deepEqual(fa, { k: `EK201|${DATE}|JFK`, l: `${DATE} 14:55`, n: "EK 201", o: "Dubai", t: "14:55", term: "4", s: "Expected" });
    await type(p, "from", "jfk t1");
    await p.locator('#bk-from-list [role=option][aria-label="Terminal 1, John F. Kennedy (JFK)"]').click();
    await p.fill("#bk-flight", "");
    await p.fill("#bk-flight", "EK201");
    await p.waitForFunction(() => [...document.querySelectorAll("#bk-flight-status button")].some((b) => b.textContent === "Pick up at Terminal 4"));
    assert.equal(await p.inputValue("#bk-from-id"), "jfk-t1", "a chosen terminal is never changed without a press");
    await p.locator("#bk-flight-status button", { hasText: "Pick up at Terminal 4" }).click();
    assert.deepEqual([await p.inputValue("#bk-from-id"), await p.textContent("#bk-status")], ["jfk-t4", "Pickup set to Terminal 4."]);
    const IDLE = "Set the pickup time to your scheduled landing time. We track your flight.";
    for (const [i, [status, body]] of [[200, { kind: "off" }], [200, { kind: "later" }], [200, { kind: "error" }], [429, { kind: "busy" }]].entries()) {
      await p.route("**/api/flight", (route) => (route.request().postData() || "").includes('"number"') ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }) : route.continue());
      await p.fill("#bk-flight", `ZZ${400 + i}`);
      await p.waitForTimeout(1200);
      assert.equal(await p.textContent("#bk-flight-status"), IDLE, body.kind);
      await p.unroute("**/api/flight");
    }
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B42 swap on /locations/jfk-airport: text, id, ticket and zone move together, the flight field hides and its value comes back on a second swap, focus stays on the button, the status line says it", async () => {
    const p = await open(ctx, P, "/locations/jfk-airport");
    assert.equal(await p.isVisible(".bk-swap"), true, "the swap shows once an end holds text");
    assert.equal(await p.getAttribute(".bk-swap", "aria-label"), "Swap pickup and drop-off");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-flight", "EK201");
    const ends = () => p.evaluate(() => ["bk-from", "bk-from-id", "bk-to", "bk-to-id"].map((id) => document.getElementById(id).value));
    await p.click(".bk-swap");
    assert.deepEqual(await ends(), ["350 5th Ave, New York, NY 10118", "", "John F. Kennedy (JFK)", "jfk"]);
    assert.deepEqual([await p.isVisible("#bk-flight"), await p.evaluate(() => document.activeElement.className), await p.textContent("#bk-status")], [false, "bk-swap", "Pickup and drop-off swapped."]);
    await p.click(".bk-swap");
    assert.deepEqual(await ends(), ["John F. Kennedy (JFK)", "jfk", "350 5th Ave, New York, NY 10118", ""]);
    assert.deepEqual([await p.isVisible("#bk-flight"), await p.inputValue("#bk-flight")], [true, "EK201"], "the flight number comes back");
    await p.close();
  });
  await check("B43 Enter moves on: in step 1 Enter in the pickup with the drop-off empty moves to the drop-off with no message, and in step 3 Enter in the name with the email empty moves to the email with no error", async () => {
    const p = await open(ctx, P, "/book");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await p.focus("#bk-from");
    await p.keyboard.press("Enter");
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.evaluate(() => document.querySelectorAll(".bk-e.is-on").length), await p.getAttribute("#book-form", "data-step")], ["bk-to", 0, "search"]);
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await setTime(p, "12:40");
    await view(p);
    await priced(p);
    await next(p);
    await p.fill("#bk-name", "Ana Lopez");
    await p.keyboard.press("Enter");
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.evaluate(() => document.querySelectorAll(".bk-det .bk-e.is-on").length), await p.getAttribute("#book-form", "data-step")], ["bk-email", 0, "details"]);
    await p.close();
  });
  await check("B44 who fits: 4 passengers mark First Class and Sedan & Electric Seats 3, with First Class chosen 4 passengers switch to Business SUV with the status line, 6 or 7 passengers switch to Luxury Sprinter", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await p.click('label[for="bk-c-first"]');
    await priced(p);
    await pax(p, 4);
    assert.deepEqual([await p.evaluate(() => document.querySelector("[name=class]:checked").value), (await p.textContent("#bk-wait")).startsWith("Changed to Business SUV for 4 passengers.")], ["suv", true]);
    assert.deepEqual(await cards(p), [JFK_CARDS[0], JFK_CARDS[1], "Seats 3", "Seats 3", JFK_CARDS[4]]);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".bk-card.is-small img")].map((i) => getComputedStyle(i.closest("picture")).opacity)), ["0.6", "0.6"], "only the photo of a car that is too small is dimmed");
    await priced(p);
    await pax(p, 6);
    assert.deepEqual([await p.evaluate(() => document.querySelector("[name=class]:checked").value), (await p.textContent("#bk-wait")).startsWith("Changed to Luxury Sprinter for 6 passengers.")], ["sprinter", true]);
    await pax(p, 7);
    assert.equal(await p.evaluate(() => document.querySelector("[name=class]:checked").value), "sprinter", "7 passengers ride in the Luxury Sprinter");
    await priced(p);
    assert.equal(await p.$eval("#price-total", (x) => (x.firstChild || {}).textContent || ""), JFK_CARDS[4]);
    await p.close();
  });
  await ctx.close();
}

async function stepTwo(p, { from = ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to = ["350 5th Ave, New York, NY 10118"], date = DATE, time = "12:40", hour = false, stop = null } = {}) {
  if (hour) await p.click('label[for="bk-hour"]');
  await place(p, "from", ...from);
  if (!hour) await place(p, "to", ...to);
  if (stop) {
    await p.click("#bk-addstop");
    await place(p, "stop1", stop);
  }
  if (await p.evaluate(() => !document.getElementById("bk-cal").hidden)) await p.keyboard.press("Escape");
  await p.evaluate(([d, t]) => {
    const e = document.getElementById("bk-date");
    e.value = d;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("bk-time").value = t;
    document.getElementById("bk-time").dispatchEvent(new Event("change", { bubbles: true }));
  }, [date, time]);
  await p.click("#bk-view");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && !document.getElementById("bk-wait").textContent.startsWith("Finding"));
  await p.waitForTimeout(400);
}
const reqBar = (p) => p.evaluate(() => {
  const b = document.getElementById("bk-bar"), v = (id) => getComputedStyle(document.getElementById(id)).display !== "none";
  return { shown: getComputedStyle(b).display !== "none", isq: b.classList.contains("is-q"), line: document.getElementById("bk-bar-q").textContent, mail: v("bk-bar-mail"), go: v("bk-bar-go"), next: v("bk-next"), gold: document.getElementById("q-mail").className, href: decodeURIComponent(document.getElementById("bk-bar-mail").getAttribute("href")), wa: decodeURIComponent(document.getElementById("q-wa").getAttribute("href")), fix: document.getElementById("q-fix").hidden ? "" : document.getElementById("q-fix").textContent, qline: document.getElementById("bk-qline").hidden ? "" : document.getElementById("bk-qline").textContent };
});
{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  const far = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
  const cases = [
    ["short-notice", inWindow(), "Less than an hour away", "Change the time", async (p) => { await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && (document.activeElement.id === "bk-time-btn" || !document.getElementById("bk-cal").hidden)); return p.evaluate((d) => document.activeElement.id === "bk-time-btn" || document.activeElement.dataset.day === d, firstDay()); }],
    ["far-ahead", { date: far }, "More than a year away", "Change the date", async (p) => { await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden); return true; }],
    ["no-airport", { from: ["350 5th Ave, New York, NY 10118"], to: ["277 Bedford Ave, Brooklyn, NY 11211"] }, "Our dispatch team prices this trip", "Book by the hour instead", async (p) => { await priced(p); return p.evaluate(() => document.getElementById("bk-hour").checked && document.getElementById("bk-hours").value === "3"); }],
    ["stop-leg", { stop: "277 Bedford Ave, Brooklyn, NY 11211" }, "With a stop, our dispatch team prices it", "Remove the stop", async (p) => { await priced(p); return p.evaluate(() => !document.getElementById("bk-stop1").value && !document.getElementById("bk-stop1-f").classList.contains("is-shown")); }],
    ["sprinter-hourly", { hour: true, from: ["350 5th Ave, New York, NY 10118"] }, "Our dispatch team prices the Sprinter by the hour", "Choose another car", async (p) => p.evaluate(() => document.activeElement.id === "bk-c-suv")],
  ];
  for (const [reason, trip, line, fix, after] of cases) {
    await check(`B45 at 390 the ${reason} request: the bar stays as the request bar with its line and Email to reserve with the trip, no call icon, Email to reserve turns gold above WhatsApp to reserve, the recovery "${fix}" works, and both show their after-send notices`, async () => {
      const p = await open(ctx, P, "/book");
      await stepTwo(p, trip);
      if (reason === "sprinter-hourly") {
        await p.click('label[for="bk-c-sprinter"]');
        await p.waitForTimeout(500);
        await p.evaluate(() => scrollTo(0, 0));
        await p.waitForTimeout(200);
      }
      const b = await reqBar(p);
      assert.deepEqual([b.shown, b.isq, b.line, b.mail, b.go, b.next, b.gold, b.fix], [true, true, line, true, false, false, "btn", fix], reason);
      assert.deepEqual([await p.isVisible("#bk-opt-h .bk-stepno"), await p.getByRole("heading", { name: "Choose your vehicle", exact: true }).count()], [false, 1], `${reason}: a request has no step count`);
      assert.match(b.href, /^mailto:info@nycluxride\.com\?subject=Booking request( [1-9]\d{7})?&body=Hi NYC LUX RIDE, I would like to book this trip\.\n/, reason);
      assert.match(b.wa, /^https:\/\/wa\.me\/16467750556\?text=Hi NYC LUX RIDE, I would like to book this trip\.\n/, reason);
      assert.equal(b.href.split("&body=")[1], b.wa.split("?text=")[1], `${reason}: the email and the WhatsApp message carry the same text`);
      if (/^(short-notice|far-ahead)$/.test(reason)) assert.deepEqual([b.qline, await cards(p)], ["", JFK_CARDS], `${reason} holds the payment, the prices stay`);
      else if (reason !== "sprinter-hourly") assert.equal(b.qline, `Price on request for this trip. ${fix}`, reason);
      await p.evaluate(() => document.getElementById("bk-bar-mail").addEventListener("click", (e) => e.preventDefault()));
      await p.click("#bk-bar-mail");
      assert.deepEqual([await p.isVisible("#q-sent"), await p.textContent("#q-sent b")], [true, "Your email app should open with the trip."]);
      const [popup] = await Promise.all([p.waitForEvent("popup", { timeout: 3000 }).catch(() => null), p.click("#q-wa")]);
      popup && (await popup.close());
      assert.deepEqual([await p.isVisible("#q-sent"), await p.textContent("#q-sent")], [true, /^(short-notice|far-ahead)$/.test(reason) ? "Your trip is in a WhatsApp message. Press send there, and we'll reply to confirm your booking." : "Your trip is in a WhatsApp message. Press send there, and we'll reply with the fare and a payment link."]);
      assert.notEqual(await p.evaluate(() => document.activeElement.id), "q-sent", "the notice never takes focus");
      await p.click("#q-fix");
      assert.ok(await after(p), `${reason}: the recovery`);
      await p.close();
    });
  }
  await check("B45 at 390 the hours-range request (answer from the server mock): Over 12 hours, Change the duration returns to the trip with focus on Duration", async () => {
    const p = await open(ctx, P, "/book");
    await p.route("**/api/book", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      if (body.action !== "options") return route.continue();
      const res = await route.fetch();
      const j = await res.json();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...j, kind: "quote", reason: "hours-range", price: null, pay: false, classes: (j.classes || []).map((c) => ({ ...c, total_cents: null, reason: "hours-range" })) }) });
    });
    await stepTwo(p, { hour: true, from: ["350 5th Ave, New York, NY 10118"] });
    const b = await reqBar(p);
    assert.deepEqual([b.isq, b.line, b.fix], [true, "Over 12 hours, our dispatch team prices it", "Change the duration"]);
    await p.click("#q-fix");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-hours");
    await p.close();
  });
  await check("B45 at 390 the unplaced request: Add the ZIP code to see the price, Edit trip returns to the box with its hint", async () => {
    const p = await open(ctx, P, "/book");
    await stepTwo(p, { to: ["edition"] });
    const b = await reqBar(p);
    assert.deepEqual([b.isq, b.line, b.mail], [true, "Add the ZIP code to see the price", true]);
    await p.click("#q-edit");
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.evaluate(() => document.activeElement.id), await p.isVisible("#e-to-zip")], ["search", "bk-to", true]);
    await p.close();
  });
  await ctx.close();
  const qctx = await context(Q, { viewport: { width: 390, height: 844 } });
  await check("B45 at 390 the paused request with payments off: Online payment isn't available for this trip, no recovery button", async () => {
    const p = await open(qctx, Q, "/book");
    await stepTwo(p);
    await p.waitForSelector("#q-paused", { state: "visible" });
    const b = await reqBar(p);
    assert.deepEqual([b.isq, b.line, b.fix, b.mail, b.gold], [true, "Online payment isn't available for this trip", "", true, "btn"]);
    await p.close();
  });
  await qctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  await check("B46 failed calls: an aborted options call retries once by itself after 2 s, then shows Price not loaded and the error request with the trip in its WhatsApp link, Try again repeats it, offline shows the offline line and the online event retries", async () => {
    const p = await open(ctx, P, "/book");
    let calls = 0, fail = true;
    await p.route("**/api/book", (route) => (JSON.parse(route.request().postData() || "{}").action ? (calls++, fail ? route.abort() : route.continue()) : route.continue()));
    await stepTwo(p);
    await p.waitForSelector("#q-error", { state: "visible", timeout: 8000 });
    assert.equal(calls, 2, "one automatic retry");
    assert.deepEqual(await cards(p), Array(5).fill("Price not loaded"));
    const b = await reqBar(p);
    assert.deepEqual([b.isq, b.line, b.fix], [true, "Prices didn't load", ""]);
    assert.match(decodeURIComponent(await p.getAttribute("#q-wa", "href")), /\?text=Hi NYC LUX RIDE, I would like to book this trip\.\nTrip: One way\nPickup: JFK Terminal 4/);
    fail = false;
    await p.click("#q-retry");
    await priced(p);
    assert.equal(calls, 3);
    assert.equal(await p.isVisible("#q-error"), false);
    await p.unroute("**/api/book");
    await p.context().setOffline(true);
    await pax(p, 2);
    await p.waitForFunction(() => /You're offline/.test(document.querySelector("#q-error p").textContent), null, { timeout: 8000 });
    assert.equal((await p.textContent("#q-error p")).trim(), "You're offline. Your trip is kept in this tab. We'll try again when you're back online.");
    await p.context().setOffline(false);
    await priced(p);
    assert.equal(await p.isVisible("#q-error"), false);
    await p.close();
  });
  await ctx.close();
}

for (const width of [1440, 390]) {
  const ctx = await context(G, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B47 at ${width} the summary: the route list drawn at the step switch with a skeleton time and the time in place later with CLS 0, the attribution, the delta chip after Inside the terminal with a name sign in step 3, busy totals during the reprice, Book and pay online and the bar line`, async () => {
    const p = await open(ctx, G, "/book");
    await routeTrip(p, { from: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to: ["edition", "The New York EDITION"] });
    await p.route("**/api/route", async (r) => { await new Promise((z) => setTimeout(z, 900)); await r.continue().catch(() => {}); });
    await p.click("#bk-view");
    assert.ok(await p.$("#bk-route .bk-route__z .bk-sk"), "the drop-off time waits in a skeleton");
    await priced(p);
    await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    await p.waitForTimeout(300);
    const [v, s] = await cls(p);
    assert.equal(v, 0, s.join(" | "));
    assert.deepEqual([await p.textContent("#bk-route-n"), await p.isVisible("#bk-drive")], [DRIVE_N, false]);
    assert.deepEqual([(await p.textContent("#bk-next")).trim(), await p.$eval("#bk-tot-v", (x) => x.firstChild.textContent)], ["Book and pay online", cash(TOTAL)]);
    if (width === 390) assert.deepEqual([await p.textContent("#bk-bar-total"), await p.getAttribute("#bk-bar-go", "aria-label")], [`${cash(TOTAL)} total`, null]);
    await next(p);
    await p.route("**/api/book", async (r) => { await new Promise((z) => setTimeout(z, 600)); await r.continue().catch(() => {}); });
    await p.check("#bk-meet");
    assert.deepEqual([await p.getAttribute("#price-total", "aria-busy"), await p.getAttribute("#bk-bar-total", "aria-busy"), await p.getAttribute("#bk-tot-v", "aria-busy")], ["true", "true", "true"]);
    await p.waitForFunction(() => document.querySelector("#price-total .bk-delta") && document.querySelector("#bk-tot-v .bk-delta"));
    assert.deepEqual(await p.evaluate(() => [document.querySelector("#price-total .bk-delta").textContent, document.querySelector("#price-total .bk-delta").getAttribute("aria-hidden"), (document.getElementById("price-total").firstChild || {}).textContent, document.getElementById("price-total").getAttribute("aria-busy"), document.getElementById("bk-meet-p").textContent]), ["+$25.00", "true", cash(TOTAL + MEET_AND_GREET), null, "+$25.00"]);
    assert.match(await p.textContent("#bk-wait"), /Your price: \$210\.00/);
    await p.unroute("**/api/book");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B48 step 3: the check rows with Change and Edit trip, When opens the calendar on the trip date, Car returns to the checked row, Trip updated in view and only when the total moved, the email and phone helpers change nothing without a press, the sign card follows the name, Add child seats or a note opens the notes", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await p.check("#bk-meet");
    await priced(p);
    const rows = () => p.$$eval("#bk-check-rows > div", (d) => d.map((x) => [x.querySelector("dt").textContent, x.querySelector("dd").textContent, x.querySelector("button").textContent]));
    assert.deepEqual(await rows(), [["When", `${new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, 12:40 PM, New York time`, "Change date and time"], ["Passengers", "1", "Change passengers"], ["Car", "Business SUVChevrolet Suburban or similar", "Change car"]]);
    assert.deepEqual(await p.$$eval("#bk-check-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMJFK Terminal 4", "350 5th Ave, New York, NY 10118"]);
    assert.ok(await p.evaluate(() => { const c = document.getElementById("bk-check"), r = c.getBoundingClientRect(); return c.previousElementSibling.id === "bk-sign-f" && c.nextElementSibling.id === "bk-tot" && r.top >= document.getElementById("bk-meet-f").getBoundingClientRect().bottom && r.bottom <= document.getElementById("bk-tot").getBoundingClientRect().top; }), "Check your trip comes after Where we meet, right above the total");
    assert.deepEqual([await p.isVisible("#bk-sum"), await p.textContent("#bk-check-edit")], [false, "Edit trip"]);
    await p.click('#bk-check-rows button[data-c="when"]');
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
    assert.equal(await p.evaluate(() => document.activeElement.dataset.day), DATE, "When opens the calendar on the trip date");
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.$("#bk-upd")], ["bk-check-h", null], "back with an unchanged trip, no Trip updated notice");
    await p.click('#bk-check-rows button[data-c="car"]');
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-c-suv", "Car returns to the checked row");
    await p.click('label[for="bk-c-first"]');
    await priced(p);
    await next(p);
    await p.waitForSelector("#bk-upd");
    assert.equal(await p.textContent("#bk-upd"), `Trip updated. The total is now ${cash(AIRPORT_TOTALS.first.jfk + MEET_AND_GREET)}.`);
    assert.ok(await p.evaluate(() => { const h = document.getElementById("bk-check-h").getBoundingClientRect(), n = document.getElementById("bk-upd").getBoundingClientRect(); return document.activeElement.id === "bk-check-h" && h.top >= document.querySelector(".site-header").getBoundingClientRect().bottom && n.bottom <= innerHeight; }), "a second visit shows Check your trip and Trip updated on screen");
    await p.fill("#bk-email", "ana@gmial.com");
    await p.click("#bk-phone");
    await p.waitForSelector("#bk-email-s", { state: "visible" });
    assert.deepEqual([await p.isVisible("#bk-email-s"), await p.textContent("#bk-email-s"), await p.inputValue("#bk-email")], [true, "Did you mean ana@gmail.com? Use gmail.com", "ana@gmial.com"]);
    assert.equal(await p.getAttribute("#bk-email-s button", "aria-label"), null);
    await p.click("#bk-email-s button");
    assert.deepEqual([await p.inputValue("#bk-email"), await p.isVisible("#bk-email-s"), await p.textContent("#bk-status")], ["ana@gmail.com", false, "Email changed to ana@gmail.com."]);
    await p.fill("#bk-phone", "0044 7700 900123");
    await p.click("#bk-name");
    await p.waitForFunction(() => document.getElementById("bk-phone-cc").value === "GB");
    assert.deepEqual([await p.inputValue("#bk-phone"), await p.textContent("#bk-phone-face"), await p.textContent("#bk-status"), await p.getAttribute("#bk-phone", "placeholder")], ["7700 900123", "\u{1F1EC}\u{1F1E7}+44", "Country code set to United Kingdom +44.", " "], "00 and the code move to the country code when the field is left, the rest stays as typed");
    await p.waitForTimeout(400);
    assert.equal(await p.isVisible("#bk-phone-s"), false, "no hint and no button for a number that reads");
    await p.selectOption("#bk-phone-cc", "US");
    assert.deepEqual([await p.textContent("#bk-phone-face"), await p.getAttribute("#bk-phone", "placeholder")], ["\u{1F1FA}\u{1F1F8}+1", "For example 212 555 0100"]);
    await p.fill("#bk-phone", "07700 900123");
    await p.click("#bk-name");
    await p.waitForSelector("#bk-phone-s", { state: "visible" });
    assert.deepEqual([await p.textContent("#bk-phone-s"), await p.inputValue("#bk-phone"), await p.inputValue("#bk-phone-cc"), (await p.getAttribute("#bk-phone", "aria-describedby")).split(" ")], ["For a number from another country, choose its country code.", "07700 900123", "US", ["bk-phone-s", "bk-phone-h"]], "a +1 country and a number starting with 0 get the one hint, the input keeps what was typed");
    await p.fill("#bk-phone", "212 555 0100");
    await p.click("#bk-name");
    await p.waitForTimeout(400);
    assert.deepEqual([await p.isVisible("#bk-phone-s"), await p.getAttribute("#bk-phone", "aria-describedby")], [false, "bk-phone-h"], "a US number shows nothing");
    await p.fill("#bk-name", "Ana Lopez");
    assert.deepEqual([await p.isVisible("#bk-signcard"), await p.textContent("#bk-signname"), await p.inputValue("#bk-sign")], [true, "Ana Lopez", "Ana Lopez"]);
    await p.fill("#bk-sign", "Dr Lopez");
    assert.equal(await p.textContent("#bk-signname"), "Dr Lopez");
    const card = await p.evaluate(() => { const r = document.getElementById("bk-signcard").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    assert.deepEqual(card, [240, 96]);
    assert.deepEqual([await p.isVisible("#bk-notes"), await p.isVisible("#bk-notes-add"), await p.getAttribute("#bk-notes-add", "aria-describedby")], [false, true, null]);
    await p.click("#bk-notes-add");
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.isVisible("#bk-notes-add"), await p.getAttribute("#bk-notes-add", "aria-expanded")], ["bk-notes", false, "true"]);
    await p.click("#bk-check-edit");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-from", "Edit trip in Check your trip opens the trip with focus on the pickup");
    await p.close();
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B49 at ${width} pay: on press the pay button keeps its gold, label and focus with aria-busy and is never disabled, the Stripe preconnect exists once${width === 390 ? ", and in step 3 the pay button follows the total with no bar over the form" : ""}`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    const btn = await payBtn(p);
    if (width === 390) assert.deepEqual([await p.isVisible("#bk-submit"), (await p.textContent("#bk-bar-go")).trim(), await p.getAttribute("#bk-bar-go", "aria-describedby"), await p.getAttribute("#bk-submit", "aria-describedby"), await p.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display)], [true, "Book and pay online", "bk-consent", "bk-consent", "none"]);
    assert.equal(await p.$$eval('link[rel=preconnect][href="https://checkout.stripe.com"]', (l) => l.length), 1);
    await p.route("**/api/book", async (route) => (JSON.parse(route.request().postData() || "{}").action === "pay" ? (await new Promise((r) => setTimeout(r, 900)), route.continue().catch(() => {})) : route.continue()));
    await p.route("**/booking-confirmed*", (r) => r.fulfill({ status: 204, body: "" }));
    await p.mouse.move(0, 0);
    await p.$eval(btn, (b) => b.scrollIntoView({ block: "center" }));
    await p.waitForTimeout(250);
    const bg = await p.$eval(btn, (b) => getComputedStyle(b).backgroundColor);
    assert.ok(["rgb(201, 162, 39)", "rgb(184, 146, 31)", "rgb(168, 133, 28)"].includes(bg), `the whole pay button is gold before the press (${bg})`);
    await p.click(btn);
    await p.mouse.move(0, 0);
    await p.waitForTimeout(200);
    const s = await p.evaluate((sel) => { const b = document.querySelector(sel); return [b.getAttribute("aria-busy"), b.getAttribute("aria-disabled"), b.disabled, b.textContent.trim(), getComputedStyle(b).backgroundColor, document.activeElement === b, document.getElementById("bk-status").textContent, getComputedStyle(b).cursor]; }, btn);
    assert.deepEqual(s, ["true", "true", false, "Book and pay online", bg, true, "Opening the Stripe payment page.", "progress"]);
    await p.click(btn, { force: true }).catch(() => {});
    assert.equal(await p.$$eval('link[rel=preconnect][href="https://checkout.stripe.com"]', (l) => l.length), 1, "the preconnect is added once");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  await check("B50 memory in this tab: /book without a hash restores this tab's trip with the notice and the wash, Clear empties it, the homepage fills a one way trip of its default shape and an airport trip with its flight field held until the rider's first change, a typed form is never filled, a past date restores the places only, and nothing goes to localStorage", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p, { from: ["350 5th Ave, New York, NY 10118"], to: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"] });
    await view(p);
    await priced(p);
    await p.goto(`${P.base}/rates`, { waitUntil: "load" });
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    assert.deepEqual(await p.evaluate(() => [document.getElementById("restored").classList.contains("is-on"), document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("book-form").dataset.step, location.hash]), [true, "350 5th Ave, New York, NY 10118", "JFK Terminal 4", DATE, "12:40", "search", ""]);
    assert.equal(await p.textContent("#restored span"), "We filled in your trip from earlier in this tab.");
    assert.ok(await p.evaluate(() => document.getElementById("bk-from-f").classList.contains("is-tint")));
    await p.click("#restored-clear");
    const cleared = await p.evaluate(() => [document.getElementById("restored").classList.contains("is-on"), document.getElementById("bk-from").value, sessionStorage.getItem("nlr-book"), document.activeElement.id, [document.getElementById("bk-date").value, document.getElementById("bk-time").value].join(" ") === AQ(), AD, AT, document.getElementById("bk-date-btn").classList.contains("is-ph")]);
    assert.deepEqual(cleared, [false, "", null, "bk-from", true, 1, 1, false], "Clear empties the trip and the date and time fill in by themselves again (owner request 2)");
    await trip(p, { from: ["350 5th Ave, New York, NY 10118"], to: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"] });
    await view(p);
    await priced(p);
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("bk-from").value !== "");
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("bk-help")]), ["350 5th Ave, New York, NY 10118", "JFK Terminal 4", DATE, "12:40", null], "the homepage fills its default shape, with no help row");
    await p.evaluate((d) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "350 5th Ave, New York, NY 10118", date: d, time: "12:40", passengers: "1", class: "suv" }, stops: 0, return: false, step: "options" })), DATE);
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("bk-from").value !== "");
    await settle(p, 800);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("bk-flight-f").classList.contains("is-shown"), window.__cls]), ["John F. Kennedy (JFK), Terminal 4", "350 5th Ave, New York, NY 10118", DATE, "12:40", false, 0], "an airport pickup fills the homepage, the flight field waits, nothing moves");
    await setTime(p, "13:00");
    assert.equal(await p.evaluate(() => document.getElementById("bk-flight-f").classList.contains("is-shown")), true, "the rider's first change shows the flight field");
    await p.route("**/assets/pay.*", async (r) => { await new Promise((z) => setTimeout(z, 1500)); await r.continue(); });
    await p.evaluate((d) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: { trip_type: "one", from_text: "350 5th Ave, New York, NY 10118", to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4", date: d, time: "12:40", passengers: "1", class: "suv" }, stops: 0, return: false, step: "options" })), DATE);
    await p.goto(`${P.base}/locations/manhattan`, { waitUntil: "domcontentloaded" });
    await p.fill("#bk-to", "Penn Station");
    await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"), null, { timeout: 8000 });
    await settle(p, 400);
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-to")], ["", "Penn Station"], "a form the rider typed in is never filled");
    await p.unroute("**/assets/pay.*");
    await p.evaluate(() => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: { trip_type: "one", from_text: "350 5th Ave, New York, NY 10118", to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4", date: "2026-01-02", time: "12:40", passengers: "1", class: "suv" }, stops: 0, return: false, step: "options" })));
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    assert.deepEqual(await p.evaluate(() => [document.getElementById("restored").classList.contains("is-on"), document.querySelector("#restored span").textContent, document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value]), [true, "We filled in your trip from earlier in this tab. Choose a new date.", "350 5th Ave, New York, NY 10118", "John F. Kennedy (JFK), Terminal 4", "", ""]);
    assert.equal(await p.evaluate(() => localStorage.length), 0);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B51 INP proxy: with the CPU throttled 4 times, the longest event of Book your ride, a class row, Book and pay online in step 2 and Book and pay online in step 3 each stays at or under 200 ms", async () => {
    const p = await open(ctx, P, "/book");
    await p.evaluate(() => { window.__ev = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push([e.name, Math.round(e.duration), (e.target && (e.target.id || e.target.getAttribute?.("for") || e.target.className)) || ""]); }).observe({ type: "event", durationThreshold: 16, buffered: true }); });
    await trip(p);
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const press = async (sel, wait) => {
      await p.evaluate(() => (window.__ev = []));
      await p.click(sel);
      await wait();
      await p.waitForTimeout(400);
      return p.evaluate(() => Math.max(0, ...window.__ev.filter((e) => /pointer|click|key/.test(e[0])).map((e) => e[1])));
    };
    const v = await press("#bk-view", () => priced(p));
    const c = await press('label[for="bk-c-premium"]', () => priced(p));
    const n = await press("#bk-next", () => p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details"));
    await details(p);
    await p.route("**/booking-confirmed*", (r) => r.fulfill({ status: 204, body: "" }));
    const y = await press("#bk-submit", () => p.waitForTimeout(100));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    for (const [name, ms] of [["Book your ride", v], ["a class row", c], ["Book and pay online in step 2", n], ["Book and pay online in step 3", y]]) assert.ok(ms <= 200, `${name}: ${ms} ms`);
    await p.close();
  });
  await ctx.close();
}

for (const motion of ["no-preference", "reduce"]) {
  const ctx = await context(P, { viewport: { width: 390, height: 844 }, reducedMotion: motion });
  if (motion === "no-preference") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: P.base });
  await check(`B52 confirmation with ${motion} motion: the seal ${motion === "reduce" ? "is drawn" : "draws once"}${motion === "reduce" ? "" : ", Copy writes the reference, Add to calendar downloads a text/calendar file with the pickup in UTC, the share text holds no price and no reference, every WhatsApp link asks about the booking, print hides the actions and no URL follows WhatsApp, no session says it can't show a booking, and an aborted lookup offers Try again"}`, async () => {
    let p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    const ref = await p.textContent("#cf-ref");
    const done = [p.url(), await p.evaluate(() => Object.entries(sessionStorage))];
    await p.close();
    p = await open(ctx, P, "/rates");
    await p.evaluate((s) => s.forEach(([k, v]) => sessionStorage.setItem(k, v)), done[1]);
    await p.goto(done[0], { waitUntil: "load" });
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    assert.equal(await p.textContent("#cf-ref"), ref);
    const seal = await p.evaluate(() => [document.getElementById("cf").classList.contains("is-paid"), document.getAnimations().filter((a) => a.animationName === "bk-seal").length, getComputedStyle(document.querySelector(".bk-seal path")).strokeDashoffset]);
    if (motion === "reduce") {
      assert.deepEqual([seal[0], seal[1], ["0", "0px"].includes(seal[2])], [true, 0, true], JSON.stringify(seal));
      return p.close();
    }
    assert.deepEqual([seal[0], seal[1] <= 1], [true, true], JSON.stringify(seal));
    await p.waitForTimeout(700);
    assert.ok(["0", "0px"].includes(await p.evaluate(() => getComputedStyle(document.querySelector(".bk-seal path")).strokeDashoffset)), "the check ends drawn");
    await p.click("#cf-copy");
    await p.waitForTimeout(100);
    assert.deepEqual([await p.evaluate(() => navigator.clipboard.readText()), await p.textContent("#cf-copy"), await p.textContent("#cf-status")], [ref, "Copied", "Reference copied."]);
    await p.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; b.text().then((t) => (window.__ics = t)); return o(b); }; });
    await p.click("#cf-ics");
    await p.waitForFunction(() => window.__ics);
    const ics = await p.evaluate(() => [window.__blob.type, window.__ics]);
    assert.equal(ics[0], "text/calendar");
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).format(new Date(`${DATE}T16:40:00Z`)).slice(-2) * 1;
    const want = `${DATE.replace(/-/g, "")}T${String(12 - offset).padStart(2, "0")}4000Z`;
    assert.match(ics[1], new RegExp(`\\r\\nDTSTART:${want}\\r\\n`), ics[1]);
    assert.ok(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/NYC LUX RIDE\/\/Booking\/\/EN\r\nBEGIN:VEVENT\r\nUID:[1-9]\d{7}@nycluxride\.com\r\n/.test(ics[1]) && ics[1].includes(`\r\nUID:${ref}@nycluxride.com\r\n`) && ics[1].endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n") && !/BEGIN:VALARM/.test(ics[1]) && ics[1].split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "the file shape, no alarm, lines folded at 75 octets");
    await p.evaluate(() => { window.__share = null; navigator.share = undefined; });
    await p.click("#cf-share");
    await p.waitForTimeout(100);
    const share = await p.evaluate(() => navigator.clipboard.readText());
    assert.ok(!share.includes("$") && !share.includes(ref) && share.startsWith("Your car is booked with NYC LUX RIDE.\n") && /Questions: \+1 \(646\) 775-0556 or https:\/\/wa\.me\/16467750556$/.test(share), share);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('a[href^="https://wa.me/16467750556"]')].filter((a) => !decodeURIComponent(a.href).includes("this is about my booking")).length), 0);
    assert.match(decodeURIComponent(await p.getAttribute("#cf-wa", "href")), new RegExp(`this is about my booking ${ref} on `));
    await p.emulateMedia({ media: "print" });
    assert.deepEqual(await p.evaluate(() => [getComputedStyle(document.getElementById("cf-acts")).display, getComputedStyle(document.getElementById("cf-quiet")).display, getComputedStyle(document.querySelector(".bk-seal")).display, getComputedStyle(document.querySelector("#cf-help a[href^='https://wa.me']"), "::after").content, getComputedStyle(document.querySelector(".site-header")).display]), ["none", "none", "none", "none", "none"]);
    await p.emulateMedia({ media: "screen" });
    await p.goto(`${P.base}/rates`);
    await p.evaluate(() => sessionStorage.clear());
    await p.goto(`${P.base}/booking-confirmed`, { waitUntil: "load" });
    assert.equal(await p.textContent("#cf-h"), "We can't show a booking in this tab");
    await p.route("**/api/book?session_id=*", (r) => r.abort());
    await p.goto(`${P.base}/booking-confirmed?session_id=cs_mock_ZZZZZZ`, { waitUntil: "load" });
    await p.waitForSelector("#cf-fail", { state: "visible", timeout: 8000 });
    assert.deepEqual([await p.textContent("#cf-h"), (await p.textContent("#cf-fail span")).trim(), await p.isVisible("#cf-retry"), await p.isVisible("#cf-refrow"), await p.isVisible("#cf-receipt .bk-lines")], ["Payment received", "We couldn't load your booking details. Your reference is on your Stripe receipt.", true, false, false]);
    await p.close();
  });
  await ctx.close();
}

{
  const chrome = await chromium.launch({ channel: "chrome" }).catch(() => null);
  await check("B53 step changes with motion on (Chrome): Book your ride, Book and pay online, Back to vehicles and browser Back run as step-fwd and step-back view transitions, #bk-side holds still from 1024, the chips stay at opacity 1 at 150 ms, focus lands on the step heading, one bk-step name at a time", async () => {
    assert.ok(chrome, "Google Chrome is not installed for the view transition check");
    const ctx = await chrome.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    await ctx.route((url) => !url.href.startsWith(P.base), (route) => route.fulfill({ status: 204, body: "" }));
    await ctx.addInitScript(() => {
      window.__vt = [];
      const o = Document.prototype.startViewTransition;
      if (!o) return;
      Document.prototype.startViewTransition = function (arg) {
        const t = o.call(this, arg);
        const rec = { types: arg && arg.types ? [...arg.types] : [], side: [], sum: null, names: 0, focus: "" };
        window.__vt.push(rec);
        const s0 = document.getElementById("bk-side").getBoundingClientRect();
        t.ready.then(() => { rec.names = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).viewTransitionName === "bk-step").length; });
        setTimeout(() => { const s1 = document.getElementById("bk-side").getBoundingClientRect(); rec.side = [Math.round(s1.top - s0.top), Math.round(s1.left - s0.left)]; rec.sum = getComputedStyle(document.getElementById("bk-sum")).opacity; }, 150);
        t.updateCallbackDone.then(() => setTimeout(() => (rec.focus = document.activeElement.id)));
        return t;
      };
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    await trip(p);
    await view(p);
    await priced(p);
    await p.waitForTimeout(700);
    await p.click("#bk-next");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    await p.waitForTimeout(700);
    await p.click("#bk-back");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await p.waitForTimeout(700);
    await p.click("#bk-next");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    await p.waitForTimeout(700);
    await p.goBack();
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await p.waitForTimeout(700);
    const vt = await p.evaluate(() => window.__vt);
    assert.deepEqual(vt.map((v) => v.types.join()), ["step-fwd", "step-fwd", "step-back", "step-fwd", "step-back"], JSON.stringify(vt));
    assert.deepEqual(vt.slice(1).map((v) => v.side), Array(4).fill([0, 0]), "the summary card holds still");
    assert.deepEqual(vt.map((v) => v.sum), Array(5).fill("1"), "the chips are not faded");
    assert.deepEqual(vt.map((v) => v.focus), ["bk-opt-h", "bk-det-h", "bk-opt-h", "bk-check-h", "bk-opt-h"], "a second Continue lands on Check your trip");
    assert.ok(vt.every((v) => v.names <= 1), "at most one bk-step name");
    await ctx.close();
  });
  if (chrome) await chrome.close();
}

for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B54 at ${width} by ${height} Book and pay online is fully in view with no scrolling in step 3 of the reference trip with meet and greet and a 15% gratuity, at the foot of the summary card until the one under the total shows, and the flow reads gratuity, meet and greet, total, then the three ways to finish`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await p.check("#bk-meet");
    await priced(p);
    await p.click('label[for="bk-t-15"]');
    await priced(p);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => { const s = document.getElementById("bk-submit").getBoundingClientRect(), h = document.querySelector(".site-header").getBoundingClientRect(), b = s.top >= h.bottom && s.bottom <= innerHeight ? s : document.getElementById("bk-bar-go").getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(h.bottom), innerHeight, scrollY, document.getElementById("bk-bar-go").textContent.trim()]; });
    assert.ok(r[0] >= r[2] && r[1] <= r[3] && r[4] === 0 && r[5] === "Book and pay online", JSON.stringify(r));
    const order = await p.evaluate(() => ["bk-tip", "bk-meet-f", "bk-tot", "bk-submit", "q-mail", "q-wa", "bk-consent", "bk-under"].map((i) => Math.round(document.getElementById(i).getBoundingClientRect().top)));
    assert.ok(order.every((y, i) => !i || y > order[i - 1]), `gratuity, meet and greet, total, Book and pay online, Email to reserve, WhatsApp to reserve, then the consent and the line under the button: ${order}`);
    await p.close();
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B55 at ${width} the owner order (owner changes 2 and 3): on the vehicle step the rows, the total, Book and pay online, Email to reserve and WhatsApp to reserve, then the information, First Class shows the S-Class, ${width === 390 ? "the bar keeps Book and pay online" : "the summary card foot holds Book and pay online only while the one under the total is out of view"}, and on the payment step the gratuity, meet and greet, the total and the three buttons, with the typed details in both messages`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const tops = (ids) => p.evaluate((ids) => ids.map((i) => { const e = document.getElementById(i); return e && e.getClientRects().length ? Math.round(e.getBoundingClientRect().top) : null; }), ids);
    const s2 = await tops(["bk-c-sprinter", "bk-tot", "bk-next", "q-mail", "q-wa", "bk-nopay", "bk-incl-h"]);
    assert.ok(s2.every((y, i) => y !== null && (!i || y > s2[i - 1])), `step 2 order ${s2}`);
    assert.equal(await p.isVisible("#bk-meet-f"), false, "meet and greet is not on the vehicle step");
    const gap = await p.evaluate(() => Math.round(document.getElementById("bk-tot").getBoundingClientRect().top - document.querySelector('label[for="bk-c-sprinter"]').getBoundingClientRect().bottom));
    assert.ok(gap > 0 && gap <= 32, `nothing sits between the rows and the total, ${gap} px`);
    await p.waitForFunction(() => { const i = document.querySelector('label[for="bk-c-first"] img'); return i.complete && i.naturalWidth > 0; });
    const img = await p.$eval('label[for="bk-c-first"] img', (i) => [i.currentSrc.split("/").pop(), i.alt]);
    assert.match(img[0], /^mercedes-s-class-card-(300|400)\.(avif|webp)$/);
    assert.match(img[1], /^Black Mercedes-Benz S-Class /);
    if (width === 1440) {
      await p.evaluate(() => scrollTo(0, 0));
      await p.waitForTimeout(200);
      await p.evaluate(() => scrollTo(0, document.getElementById("bk-next").getBoundingClientRect().bottom + scrollY - document.querySelector(".site-header").offsetHeight + 8));
      await p.waitForFunction(() => getComputedStyle(document.getElementById("bk-bar")).display === "flex");
      assert.ok(await p.evaluate(() => document.getElementById("bk-side").contains(document.getElementById("bk-bar"))), "the card foot shows while the button under the total is out of view");
      await p.evaluate(() => document.getElementById("bk-next").scrollIntoView({ block: "center" }));
      await p.waitForFunction(() => getComputedStyle(document.getElementById("bk-bar")).display === "none");
    } else {
      await p.evaluate(() => scrollTo(0, 0));
      await p.waitForTimeout(300);
      assert.deepEqual([await p.isVisible("#bk-bar-go"), (await p.textContent("#bk-bar-go")).trim()], [true, "Book and pay online"]);
      await p.evaluate(() => document.getElementById("bk-next").scrollIntoView({ block: "center" }));
      await p.waitForTimeout(300);
      assert.equal(await p.isVisible("#bk-bar-go"), false, "the phone bar steps aside while the button under the total is in view, so one gold button shows");
      await p.evaluate(() => scrollTo(0, 0));
      await p.waitForTimeout(300);
      assert.equal(await p.isVisible("#bk-bar-go"), true, "the phone bar comes back with its button");
    }
    await next(p);
    await p.check("#bk-meet");
    await priced(p);
    await p.fill("#bk-name", "Ana Lopez");
    await p.fill("#bk-email", "ana@example.org");
    await p.fill("#bk-phone", "+1 212 555 0100");
    const s3 = await tops(["bk-tip", "bk-meet-f", "bk-tot", "bk-submit", "q-mail", "q-wa", "bk-consent", "bk-under", "bk-next3"]);
    assert.ok(s3.every((y, i) => y !== null && (!i || y > s3[i - 1])), `step 3 order ${s3}`);
    const mail = decodeURIComponent((await p.getAttribute("#q-mail", "href")).split("&body=")[1]), wa = await waText(p, "#q-wa");
    assert.equal(mail, wa, "the email and the WhatsApp message carry the same text");
    assert.match(wa, /^Hi NYC LUX RIDE, I would like to book this trip\.\nReference: [1-9]\d{7}\n[\s\S]*Meet and greet: Yes\nTotal shown: \$210\.00\nName: Ana Lopez\nEmail: ana@example\.org\nMobile: \+1 212 555 0100\nContact: Phone\nName for the sign: Ana Lopez$/);
    await p.close();
  });
  await ctx.close();
}

for (const path of ["/book", "/booking-confirmed"]) {
  const ctx = await context(P, { viewport: { width: 320, height: 700 } });
  await check(`B18 at 320: ${path === "/book" ? "a request case" : "the confirmation page"} has no horizontal overflow`, async () => {
    const p = await open(ctx, P, path);
    if (path === "/book") {
      await trip(p, { from: ["350 5th Ave, New York, NY 10118"], to: ["277 Bedford Ave, Brooklyn, NY 11211"] });
      await p.click("#bk-view");
      await p.waitForSelector("#q-no-airport", { state: "visible" });
    }
    await settle(p, 400);
    assert.ok((await overflow(p)) <= 0, `overflow ${await overflow(p)}`);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B28 a curb airport pickup: the receipt skeleton has no meet and greet row and the receipt matches it", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    assert.equal(await p.isChecked("#bk-meet-no"), true);
    await next(p);
    await details(p);
    await p.route("**/api/book?session_id=*", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue().catch(() => {}); });
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    const first = await p.$$eval("#cf-lines tr", (r) => r.map((x) => x.cells[0].textContent));
    assert.deepEqual(first, ["Fare", "NYC sales tax", "Black Car Fund", "Tolls and airport fees"]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    assert.deepEqual(await p.$$eval("#cf-lines tr", (r) => r.length), 4);
    assert.equal(await p.textContent("#cf-day span"), "Once you have your bags, your chauffeur calls or messages you with the exact spot.");
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B56 a search host with no place typed: Book your ride marks the two places, says the count and moves focus to the pickup with no page error, the date and time having filled in by themselves (UXA-02, owner request 2)", async () => {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const p = await open(ctx, P, "/locations/manhattan");
      await p.setViewportSize(vp);
      await p.focus("#bk-from");
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await p.evaluate(() => document.getElementById("bk-view").focus());
      await p.click("#bk-view");
      await p.waitForFunction(() => /things to fix/.test(document.getElementById("bk-status").textContent));
      assert.deepEqual([await p.textContent("#bk-status"), await p.evaluate(() => document.activeElement.id), p.errors, new URL(p.url()).pathname], ["2 things to fix: pickup and drop-off.", "bk-from", [], "/locations/manhattan"], `${vp.width}`);
      assert.deepEqual(await p.evaluate(() => [!!document.getElementById("bk-date").value, !!document.getElementById("bk-time").value, [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)]), [true, true, ["e-from", "e-to"]], `${vp.width}`);
      await p.close();
    }
  });
  await check("B57 /book keeps the header at the top after a scroll and shows no phone or WhatsApp control outside the menu and the footer in steps 1 to 3, the nav stays in step 1 from 1024, and the current step is the heading's step count with the ways back as buttons (UXA-01, UXA-12, P01, AI-2)", async () => {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const p = await open(ctx, P, "/book");
      await p.setViewportSize(vp);
      await p.evaluate(() => scrollTo(0, 400));
      await p.waitForTimeout(200);
      const s1 = await p.evaluate(() => [Math.round(document.querySelector(".site-header").getBoundingClientRect().top), [...document.querySelectorAll('a[href^="tel:"], a[href^="https://wa.me/"]')].filter((a) => a.getClientRects().length && !a.closest(".nav-panel, .site-footer")).length, getComputedStyle(document.querySelector(".actionbar")).display, getComputedStyle(document.querySelector(".site-nav")).display !== "none", !!document.querySelector(".site-header__desk").getClientRects().length]);
      assert.deepEqual(s1, [0, 0, "none", vp.width >= 1024, false], `${vp.width} step 1`);
      await p.evaluate(() => scrollTo(0, 0));
      await trip(p);
      await view(p);
      await priced(p);
      await p.evaluate(() => scrollTo(0, 500));
      await p.waitForTimeout(200);
      const r = await p.evaluate(() => [Math.round(document.querySelector(".site-header").getBoundingClientRect().top), [...document.querySelectorAll('.site-header a[href^="tel:"], .site-header a[href^="https://wa.me/"]')].filter((a) => a.getClientRects().length && !a.closest(".nav-panel")).length, document.querySelector("#bk-opt-h .bk-stepno").textContent, document.getElementById("bk-edit").matches("button:not([disabled])") && !!document.getElementById("bk-edit").getClientRects().length]);
      assert.deepEqual(r, [0, 0, "Step 2 of 4", true], `${vp.width} step 2`);
      await next(p);
      await p.evaluate(() => scrollTo(0, 500));
      await p.waitForTimeout(200);
      const s = await p.evaluate(() => [Math.round(document.querySelector(".site-header").getBoundingClientRect().top), document.querySelector("#bk-det-h .bk-stepno").textContent, ["bk-back", "bk-check-edit"].map((i) => document.getElementById(i).matches("button:not([disabled])") && !!document.getElementById(i).getClientRects().length)]);
      assert.deepEqual(s, [0, "Step 3 of 4", [true, true]], `${vp.width} step 3`);
      await p.close();
    }
  });
  await check("B58 the step 3 error summary follows the fixes: three empty fields list three links, a filled name leaves two, all filled turns every row into a check under All fixed at the same height, and the next press clears it (UXA-05)", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await p.click(await payBtn(p));
    const sum = () => p.evaluate(() => { const r = document.getElementById("bk-errs"); return [r.hidden, (r.querySelector("p") || {}).textContent || "", [...r.querySelectorAll("a")].map((a) => a.getAttribute("href"))]; });
    assert.deepEqual(await sum(), [false, "3 things to fix", ["#bk-name", "#bk-email", "#bk-phone"]]);
    const h0 = await p.evaluate(() => Math.round(document.getElementById("bk-errs").getBoundingClientRect().height));
    await p.fill("#bk-name", "Ana Lopez");
    assert.deepEqual(await sum(), [false, "2 things to fix", ["#bk-email", "#bk-phone"]]);
    await p.fill("#bk-email", "ana@example.com");
    assert.deepEqual(await sum(), [false, "1 thing to fix", ["#bk-phone"]]);
    await p.fill("#bk-phone", "+1 212 555 0100");
    assert.deepEqual(await sum(), [false, "All fixed", []]);
    assert.deepEqual(await p.evaluate(() => { const r = document.getElementById("bk-errs"); return [r.classList.contains("is-ok"), Math.round(r.getBoundingClientRect().height), [...r.querySelectorAll("li")].map((l) => [l.className, l.getAttribute("aria-hidden"), l.textContent])]; }), [true, h0, [["is-ok", "true", "Add your full name."], ["is-ok", "true", "Add your email address, for example name@example.com."], ["is-ok", "true", "Add your mobile number, and check its country code."]]], "every fixed row stays in place as a check and the summary keeps its height");
    await p.fill("#bk-email", "");
    await p.click(await payBtn(p));
    await p.waitForFunction(() => document.getElementById("e-email").classList.contains("is-on"));
    assert.deepEqual(await p.evaluate(() => { const r = document.getElementById("bk-errs"); return [r.hidden, r.classList.contains("is-ok"), r.querySelectorAll("li").length]; }), [true, false, 0], "the next press drops the fixed rows, and one thing left to fix shows no summary");
    await p.close();
  });
  await check("B59 suggestions: a pick empties the polite status, so no suggestion count is left behind (UXA-13)", async () => {
    const p = await open(ctx, P, "/book");
    await type(p, "from", "jfk");
    assert.match(await p.textContent("#bk-status"), /suggestion/);
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    assert.doesNotMatch(await p.textContent("#bk-status"), /suggestion/);
    await p.close();
  });
  await check("B60 when pay.js fails, Add stop and Add return trip are hidden on /book, on a full host and on a search host (UXA-16)", async () => {
    for (const path of ["/book", "/locations/jfk-airport", "/locations/manhattan"]) {
      const p = await ctx.newPage();
      await p.route(/\/assets\/pay\.[A-Za-z0-9]+\.js$/, (r) => r.abort());
      await p.goto(`${P.base}${path}`, { waitUntil: "load" });
      if (path === "/locations/manhattan") {
        await p.focus("#bk-from");
        await p.waitForFunction(() => document.getElementById("book-form").classList.contains("bk-off"));
      }
      assert.deepEqual([await p.isVisible("#bk-addstop"), await p.isVisible("#bk-addret"), await p.isVisible("#bk-view")], [false, false, true], path);
      await p.close();
    }
  });
  await check("B61 a request with a total on screen says We confirm the car and send a payment link, a price on request says We reply with the fare (P04)", async () => {
    const p = await open(ctx, P, "/book");
    await stepTwo(p, inWindow());
    await p.waitForSelector("#q-short-notice", { state: "visible" });
    assert.equal(await p.textContent("#q-body li:nth-child(2) b"), "We confirm the car and send a payment link");
    await p.close();
    const q = await open(ctx, P, "/book");
    await stepTwo(q, { from: ["350 5th Ave, New York, NY 10118"], to: ["277 Bedford Ave, Brooklyn, NY 11211"] });
    await q.waitForSelector("#q-no-airport", { state: "visible" });
    assert.equal(await q.textContent("#q-body li:nth-child(2) b"), "We reply with the fare and a payment link");
    await q.close();
  });
  await check("B62 the bar name wraps instead of cutting the class name at 390 (UXA-17)", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await p.click('label[for="bk-c-premium"]');
    await priced(p);
    await p.evaluate(() => scrollTo(0, 0));
    const r = await p.evaluate(() => { const n = document.getElementById("bk-bar-name"), s = getComputedStyle(n); return [n.textContent, s.whiteSpace, s.textOverflow, n.scrollWidth <= n.clientWidth]; });
    assert.deepEqual(r, ["Business Premium SUV", "normal", "clip", true]);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await check("B63 Back from /book#options to a host shows the trip again, an airport pickup on the homepage included, with the flight field held and nothing moving (UXA-08, AV-04)", async () => {
    for (const [host, a, b, width] of [["/locations/manhattan", ["edition", "The New York EDITION"], ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], 1440], ["/", ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], ["edition", "The New York EDITION"], 1440], ["/", ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], ["edition", "The New York EDITION"], 390]]) {
      const p = await open(ctx, G, host);
      await p.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
      await place(p, "from", ...a);
      await place(p, "to", ...b);
      await pickDate(p, "#bk-date-btn", DATE);
      await setTime(p, "12:40");
      await Promise.all([p.waitForURL(/\/book/), p.click("#bk-view")]);
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
        await p.goBack({ waitUntil: "load" });
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js") && document.getElementById("bk-from").value);
      await p.waitForTimeout(600);
      const full = (x) => (x === "The New York EDITION" ? "The New York EDITION, Madison Avenue, New York, NY" : x.replace("John F. Kennedy (JFK), ", "JFK "));
      const [v, sh] = await cls(p);
      assert.deepEqual(await p.evaluate(() => [...["bk-from", "bk-to", "bk-date", "bk-time"].map((id) => document.getElementById(id).value), document.getElementById("bk-flight-f").classList.contains("is-shown")]), [full(a[1]), full(b[1]), DATE, "12:40", false], `${host} at ${width}`);
      assert.ok(v < 0.001, `${host} at ${width}: CLS ${v} ${sh.join(" | ")}`);
      await p.close();
    }
  });
  await ctx.close();
}

for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height }, reducedMotion: "no-preference" });
  await check(`B64 at ${width} by ${height} with motion on, the homepage pickup list opens under the field and inside the window once the bar is in view, after a 300 px scroll and by keyboard, and the hero keeps its place (L1)`, async () => {
    for (const how of ["click", "scroll", "tab"]) {
      const p = await open(ctx, P, "/");
      await p.waitForTimeout(300);
      if (how === "scroll") { await p.evaluate(() => scrollTo(0, 300)); await p.waitForTimeout(300); }
      if (how === "click") { await showBar(p); await p.waitForTimeout(300); }
      const at = () => p.evaluate(() => [".hero h1", "#bk-search"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY)).join());
      const still = await at();
      if (how === "tab") { await p.evaluate(() => document.querySelector("#bk-mode input:checked").focus({ preventScroll: true })); await p.keyboard.press("Tab"); }
      else await tap(p, "#bk-from");
      await p.waitForTimeout(1200);
      const r = await p.evaluate(() => { const e = document.getElementById("bk-from-pop"), a = e.getBoundingClientRect(), f = document.getElementById("bk-from-f").getBoundingClientRect(); return [Math.round(a.top - f.bottom), a.top >= document.querySelector(".site-header").getBoundingClientRect().bottom && a.bottom <= innerHeight, document.activeElement.id, e.matches(":popover-open")]; });
      assert.deepEqual([...r, await at()], [4, true, "bk-from", true, still], how);
      await p.close();
    }
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await ctx.addInitScript(() => {
    const D = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function (l, o) { if (o && o.timeZoneName === "shortOffset") throw new RangeError("Value shortOffset out of range"); return new D(l, o); };
    Intl.DateTimeFormat.prototype = D.prototype;
    Intl.DateTimeFormat.supportedLocalesOf = D.supportedLocalesOf;
  });
  await check("B65 the confirmation works where Intl has no shortOffset: no page error, Copy and Add to calendar enabled, the Google link carries the dates (F1)", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    const r = await p.evaluate(() => [document.getElementById("cf-copy").getAttribute("aria-disabled"), document.getElementById("cf-ics").getAttribute("aria-disabled"), /&dates=\d{8}T\d{6}Z\/\d{8}T\d{6}Z/.test(document.getElementById("cf-gcal").href)]);
    assert.deepEqual([r, p.errors], [[null, null, true], []]);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await check("B66 below 1024 the pickup clear button sits clear of the swap button, so a tap near its edge clears the pickup (UXA-03)", async () => {
    const p = await open(ctx, P, "/locations/jfk-airport");
    await p.focus("#bk-to");
    await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    await p.fill("#bk-to", "350 5th Ave");
    await p.keyboard.press("Escape");
    const hits = await p.evaluate(() => { const x = document.getElementById("bk-from-x").getBoundingClientRect(); let n = 0; for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { const e = document.elementFromPoint(x.left + (i * x.width) / 12, x.top + (j * x.height) / 12); if (e && e.closest(".bk-swap")) n++; } return n; });
    assert.equal(hits, 0, `${hits} probe points of the clear button land on the swap button`);
    const [x, y] = await p.evaluate(() => { const r = document.getElementById("bk-from-x").getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 4]; });
    await p.touchscreen.tap(x, y);
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-to")], ["", "350 5th Ave"]);
    await p.close();
  });
  await ctx.close();
}

const GOLD_BG = ["rgb(201, 162, 39)", "rgb(184, 146, 31)", "rgb(168, 133, 28)"];
const goldSeen = (page) =>
  page.evaluate((gold) => [...document.querySelectorAll("a, button")].filter((n) => {
    const cs = getComputedStyle(n);
    if (!gold.includes(cs.backgroundColor) || cs.visibility !== "visible") return false;
    const r = n.getBoundingClientRect();
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
      const x = r.left + (i * r.width) / 8, y = r.top + (j * r.height) / 8;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const e = document.elementFromPoint(x, y);
      if (e && n.contains(e)) return true;
    }
    return false;
  }).map((n) => n.id || n.className), GOLD_BG);
for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B67 at ${width} by ${height}, one gold button is in view at every scroll position around the in-page button in steps 2 and 3, and the bar comes back once the button has left${width < 1024 ? " in step 2 while step 3 has no bar (owner request 4)" : ""} (AV-03, AI-5)`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    for (const [step, id] of [["options", "bk-next"], ["details", "bk-submit"]]) {
      if (step === "details") { await next(p); await priced(p); }
      const m = await p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, hh: document.querySelector(".site-header").getBoundingClientRect().bottom, max: document.documentElement.scrollHeight - innerHeight }; }, id);
      const marks = [m.bottom - m.hh, m.top - height].filter((x) => x > -40 && x < m.max + 40);
      for (const mark of marks) for (let k = -6; k <= 6; k++) {
        const y = Math.max(0, Math.min(m.max, Math.round(mark + k * 8)));
        await p.evaluate((t) => scrollTo(0, t), y);
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await p.waitForTimeout(60);
        const g = await goldSeen(p);
        assert.ok(g.length <= 1, `${step} at scroll ${y}: ${g.join(", ")}`);
        if (step === "details" && width < 1024) assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display), "none", `details at scroll ${y}: no bar on the details step below 1024 (owner request 4)`);
        else if (Math.abs(k) === 6 && !(await p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); const h = document.querySelector(".site-header").getBoundingClientRect().bottom; return r.bottom > h && r.top < innerHeight; }, id))) assert.equal(g.length, 1, `${step} at scroll ${y}: the bar is back while the in-page button is out of view`);
      }
    }
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { for (const k of ["role", "ariaAutoComplete", "ariaBusy", "ariaCurrent", "ariaDisabled", "ariaExpanded", "ariaHidden", "ariaInvalid", "ariaLabel", "ariaModal", "ariaSelected"]) delete Element.prototype[k]; });
  await check("B68 where the browser has no ARIA reflection (Firefox before 119), the combobox, the swap button, the passenger stepper, the header Book a car link and the busy state still write their attributes, and /contact marks a missing field (AI-6)", async () => {
    const p = await open(ctx, G, "/book");
    assert.equal(await p.evaluate(() => "ariaExpanded" in document.body), true, "the shim defines the reflection properties");
    assert.deepEqual(await p.evaluate(() => ["role", "aria-autocomplete", "aria-expanded"].map((a) => document.getElementById("bk-from").getAttribute(a))), ["combobox", "list", "false"]);
    await type(p, "from", "jfk");
    await p.waitForSelector("#bk-from-list [role=option]");
    assert.equal(await p.getAttribute("#bk-from", "aria-expanded"), "true");
    await p.keyboard.press("Escape");
    await trip(p);
    assert.equal(await p.getAttribute(".bk-swap", "aria-label"), "Swap pickup and drop-off");
    await view(p);
    await priced(p);
    assert.deepEqual(await p.evaluate(() => [document.querySelector(".bk-stepper button").getAttribute("aria-disabled"), document.querySelector(".site-header__desk .btn").getAttribute("aria-current")]), ["true", "page"]);
    await p.route("**/api/book", async (r) => { await new Promise((z) => setTimeout(z, 800)); await r.continue(); });
    await p.click('label[for="bk-c-premium"]');
    await p.waitForFunction(() => document.getElementById("price-total").getAttribute("aria-busy") === "true");
    await priced(p);
    await p.unroute("**/api/book");
    assert.deepEqual(p.errors, []);
    await p.goto(`${G.base}/contact`, { waitUntil: "load" });
    await p.click('#main form button[type="submit"]');
    assert.equal(await p.getAttribute("#f-name", "aria-invalid"), "true");
    await p.close();
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width < 1024 ? 844 : 900 } });
  await check(`B69 at ${width}, a total that waits for a new price stays at 4.5 to 1 or more against its background (AI-4)`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    const measure = () => p.evaluate(() => {
      const rgb = (c) => c.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      return ["price-total", "bk-tot-v", "bk-bar-total"].map((id) => document.getElementById(id)).filter((t) => t && t.getClientRects().length && t.getAttribute("aria-busy") === "true").flatMap((t) => [t, ...t.querySelectorAll("*")].filter((x) => [...x.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim()) && x.getClientRects().length).map((e) => {
        let o = 1, n = e;
        for (; n && n !== document.documentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        let b = e, bg;
        for (; b; b = b.parentElement) { const c = getComputedStyle(b).backgroundColor; if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") { bg = rgb(c).slice(0, 3); break; } }
        bg = bg || [255, 255, 255];
        const fg = rgb(getComputedStyle(e).color).slice(0, 3).map((v, i) => v * o + bg[i] * (1 - o));
        const [a, c] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return [`${t.id} ${e.tagName.toLowerCase()}`, Math.round(((a + 0.05) / (c + 0.05)) * 100) / 100];
      }));
    });
    await p.route("**/api/book", async (r) => { await new Promise((z) => setTimeout(z, 1500)); await r.continue(); });
    await p.click("#bk-back");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(p);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await p.evaluate(() => document.getElementById("bk-c-premium").click());
    await p.waitForFunction(() => document.getElementById("price-total").getAttribute("aria-busy") === "true");
    const two = await measure();
    if (width < 1024) assert.ok(two.some(([id]) => id.startsWith("bk-bar-total")), JSON.stringify(two));
    await priced(p);
    await p.evaluate(() => document.getElementById("bk-c-suv").click());
    await priced(p);
    await next(p);
    await priced(p);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await p.evaluate(() => document.getElementById("bk-t-20").click());
    await p.waitForFunction(() => document.getElementById("price-total").getAttribute("aria-busy") === "true");
    const ratios = await measure();
    assert.ok(ratios.length >= 1, "no busy total on screen");
    if (width < 1024) assert.ok(ratios.some(([id]) => id.startsWith("bk-tot-v")) && !ratios.some(([id]) => id.startsWith("bk-bar-total")), JSON.stringify(ratios));
    for (const [id, r] of [...two, ...ratios]) assert.ok(r >= 4.5, `${id} ${r}:1`);
    await p.unroute("**/api/book");
    await p.close();
  });
  await ctx.close();
}

for (const width of [320, 390, 1024, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width < 1024 ? 844 : 900 } });
  await check(`B70 at ${width}, the new tab icons of the consent and policy links stay on the line of their last word (AI-7)`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    for (const step of ["options", "details"]) {
      if (step === "details") { await next(p); await priced(p); }
      const off = await p.evaluate(() => [...document.querySelectorAll("#bk-consent a, #bk-policy a")].filter((a) => a.getClientRects().length).map((a) => {
        const t = [...a.childNodes].filter((n) => n.nodeType === 3).pop();
        const rg = document.createRange();
        rg.setStart(t, t.length - 1);
        rg.setEnd(t, t.length);
        const last = rg.getBoundingClientRect(), icon = a.querySelector("svg").getBoundingClientRect();
        return [a.textContent.trim().slice(0, 30), Math.round(Math.abs(icon.top + icon.height / 2 - (last.top + last.height / 2)))];
      }).filter(([, d]) => d > 6));
      assert.deepEqual(off, [], step);
    }
    await p.close();
  });
  await ctx.close();
}

const IND = (id) => {
  const g = document.getElementById(id), f = g && g.querySelector("label"), i = g && g.querySelector(":checked");
  if (!f || !i) return null;
  const l = i.parentNode, s = getComputedStyle(f, "::before"), m = new DOMMatrixReadOnly(s.transform === "none" ? undefined : s.transform), fr = f.getBoundingClientRect(), lr = l.getBoundingClientRect();
  return { on: g.classList.contains("bk-ix"), x: fr.left + f.clientLeft + parseFloat(s.left) + m.m41, y: fr.top + f.clientTop + parseFloat(s.top) + m.m42, w: parseFloat(s.width), h: parseFloat(s.height), lx: lr.left, ly: lr.top, lw: lr.width, lh: lr.height, bg: s.backgroundColor, label: getComputedStyle(l).backgroundColor, dur: s.transitionDuration, text: l.textContent };
};
const near = (r) => r && Math.max(Math.abs(r.x - r.lx), Math.abs(r.y - r.ly), Math.abs(r.w - r.lw), Math.abs(r.h - r.lh)) <= 1;
const ENGINES = [["chromium", browser]];
for (const [name, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (b) ENGINES.push([name, b]);
  else console.log(`  ..   ${name} is not installed here, B71 and B72 run in Chromium only`);
}
async function engineContext(b, server, options) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await ctx.route((url) => !url.href.startsWith(server.base), (route) => route.fulfill({ status: 204, body: "" }));
  return ctx;
}
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/services", 1440], ["/", 1440], ["/book", 1440], ["/services", 390]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: "no-preference" });
    await check(`B71 ${name} ${path} at ${width}: the checked label marks the choice until the first press, then one gold indicator slides from One way to By the hour and back, the radios and the keyboard work as before`, async () => {
      const p = await open(ctx, G, path);
      await p.waitForTimeout(300);
      const idle = await p.evaluate(IND, "bk-mode");
      assert.ok(idle && !idle.on && !/^rgba\(0, 0, 0, 0\)$/.test(idle.label) && idle.text === "One way", JSON.stringify(idle));
      await p.dispatchEvent('label[for="bk-one"]', "pointerdown");
      await p.waitForTimeout(50);
      const a = await p.evaluate(IND, "bk-mode");
      assert.ok(a && a.on && near(a) && /^rgba\(0, 0, 0, 0\)$/.test(a.label) && a.text === "One way", JSON.stringify(a));
      await p.click('label[for="bk-hour"]');
      await p.waitForTimeout(70);
      const mid = await p.evaluate(IND, "bk-mode");
      await p.waitForTimeout(400);
      const z = await p.evaluate(IND, "bk-mode");
      assert.ok(near(z) && z.text === "By the hour" && mid.x > a.x + 2 && mid.x < z.x - 2, JSON.stringify({ a: a.x, mid: mid.x, z }));
      await p.focus("#bk-hour");
      await p.keyboard.press("ArrowLeft");
      await p.waitForTimeout(400);
      const back = await p.evaluate(IND, "bk-mode");
      assert.ok(near(back) && back.text === "One way" && (await p.isChecked("#bk-one")), JSON.stringify(back));
      assert.deepEqual(await p.$$eval("#bk-mode input", (i) => i.map((x) => [x.type, x.name, x.value, x.labels[0].textContent])), [["radio", "trip_type", "one", "One way"], ["radio", "trip_type", "hour", "By the hour"]]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
  {
    const ctx = await engineContext(b, G, { reducedMotion: "reduce" });
    await check(`B71 ${name} reduced motion: the indicator lands on the new option at once`, async () => {
      const p = await open(ctx, G, "/services");
      await p.waitForTimeout(300);
      await p.click('label[for="bk-hour"]');
      await p.waitForTimeout(30);
      const z = await p.evaluate(IND, "bk-mode");
      assert.ok(near(z) && z.text === "By the hour" && z.dur.split(",").every((d) => parseFloat(d) <= 0.001), JSON.stringify(z));
      await p.close();
    });
    await ctx.close();
  }
  {
    const ctx = await engineContext(b, G, { reducedMotion: "no-preference" });
    await check(`B71 ${name} step 3: How should we contact you and the gratuity chips move the same indicator to the new choice`, async () => {
      const p = await open(ctx, G, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await priced(p);
      for (const [id, sel, text] of [["bk-reach", 'label[for="bk-reach-wa"]', "WhatsApp"], ["bk-tip-opts", "#bk-tip-opts label:last-child", null]]) {
        await p.dispatchEvent(`#${id} label`, "pointerdown");
        await p.waitForTimeout(50);
        const a = await p.evaluate(IND, id);
        assert.ok(a && a.on && near(a), `${id} ${JSON.stringify(a)}`);
        await p.click(sel);
        await p.waitForTimeout(450);
        const z = await p.evaluate(IND, id);
        assert.ok(near(z) && z.text !== a.text && (!text || z.text === text), `${id} ${JSON.stringify(z)}`);
      }
      await p.close();
    });
    await ctx.close();
  }
}
{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 }, forcedColors: "active", reducedMotion: "no-preference" });
  await check("B71 forced colors: the moving indicator is drawn in Highlight and the selected text in HighlightText", async () => {
    const p = await open(ctx, G, "/services");
    await p.click('label[for="bk-hour"]');
    await p.waitForTimeout(450);
    const r = await p.evaluate(IND, "bk-mode");
    const [hl, ht, txt] = await p.evaluate(() => { const t = document.createElement("i"); t.style.cssText = "background:Highlight;color:HighlightText;forced-color-adjust:none"; document.body.append(t); const c = getComputedStyle(t); return [c.backgroundColor, c.color, getComputedStyle(document.querySelector('label[for="bk-hour"]')).color]; });
    assert.ok(near(r) && r.bg === hl && txt === ht, JSON.stringify([r, hl, ht, txt]));
    await p.close();
  });
  await ctx.close();
}
const BAR = () => {
  const S = document.getElementById("bk-search");
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0 || e.closest("[hidden]")) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const atoms = [], add = (g, k, r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5 && atoms.push({ g, k, l: r.left, t: r.top, r: r.right, b: r.bottom });
  for (const f of S.querySelectorAll(".field")) {
    if (!vis(f)) continue;
    for (const l of f.querySelectorAll(":scope>label")) if (vis(l)) add(f.id, "label", l.getBoundingClientRect());
    for (const c of f.querySelectorAll(":scope>input:not([type=hidden]), :scope>select, :scope>.bk-pick")) {
      if (!vis(c)) continue;
      const r = c.getBoundingClientRect();
      add(f.id, "control", r);
      add(f.id, "underline", { left: r.left, top: r.bottom - 1.5, right: r.right, bottom: r.bottom + 0.5 });
    }
    const cs = getComputedStyle(f), fr = f.getBoundingClientRect();
    if (parseFloat(cs.borderLeftWidth)) add(f.id, "divider", { left: fr.left - 0.5, top: fr.top, right: fr.left + 1.5, bottom: fr.bottom });
    if (parseFloat(cs.borderRightWidth)) add(f.id, "divider", { left: fr.right - 1.5, top: fr.top, right: fr.right + 0.5, bottom: fr.bottom });
  }
  const texts = (root, g) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) if (n.textContent.trim() && vis(n.parentElement)) { const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) add(g, "text", r); }
    for (const x of root.querySelectorAll("button, .btn, .bk-flc")) if (vis(x)) add(g, "box", x.getBoundingClientRect());
  };
  for (const id of ["bk-flight-status", "bk-rflight-status", "bk-time-h", "bk-adds", "bk-view"]) { const e = document.getElementById(id); if (vis(e)) texts(e, id); }
  for (const e of S.querySelectorAll(".bk-e.is-on, .field__hint")) if (vis(e) && !["bk-flight-status", "bk-rflight-status", "bk-time-h"].includes(e.id)) texts(e, (e.closest(".field") || {}).id || e.id);
  const inside = atoms.length;
  for (const e of document.querySelectorAll("#bk-assure, .banner .lede, .hero__tags")) if (vis(e)) texts(e, "below");
  const bad = [], gr = S.getBoundingClientRect();
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j];
    if (a.g === b.g || (a.k === "control" && b.k === "control") || (a.g === "below" && b.g === "below")) continue;
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5) bad.push(`${a.g} ${a.k} x ${b.g} ${b.k}`);
  }
  for (const a of atoms.slice(0, inside)) if (a.b > gr.bottom + 0.5 || a.t < gr.top - 0.5) bad.push(`${a.g} ${a.k} outside the bar`);
  return [...new Set(bad)];
};
const STATES = {
  airport: async (p) => { if (!(await p.inputValue("#bk-from"))) await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4"); },
  found: async (p) => { await STATES.airport(p); await p.fill("#bk-flight", "EK201"); await p.waitForTimeout(1500); },
  missing: async (p) => { await STATES.airport(p); await p.fill("#bk-flight", "DL1234"); await p.waitForTimeout(1500); },
  cleared: async (p) => { await STATES.found(p); await p.fill("#bk-flight", ""); await p.waitForTimeout(700); },
  hourly: async (p) => { await p.click('label[for="bk-hour"]'); await STATES.airport(p); },
  "return flight": async (p) => { await p.fill("#bk-from", ""); await place(p, "from", "350 5th Ave, New York, NY 10118"); await place(p, "to", "jfk t4", "John F. Kennedy (JFK), Terminal 4"); await p.keyboard.press("Escape"); await p.click("#bk-addret"); await p.fill("#bk-rflight", "EK201"); await p.waitForTimeout(1500); },
  "inside the hour": async (p) => { await STATES.found(p); await pickDate(p, "#bk-date-btn", inWindow().date); const v = await p.$$eval("#bk-time option:not([disabled])", (o) => o.map((x) => x.value).filter(Boolean)); await setTime(p, v[0]); },
  "inside the hour, no airport": async (p) => { await p.fill("#bk-from", ""); await place(p, "from", "350 5th Ave, New York, NY 10118"); await pickDate(p, "#bk-date-btn", inWindow().date); const v = await p.$$eval("#bk-time option:not([disabled])", (o) => o.map((x) => x.value).filter(Boolean)); await setTime(p, v[0]); },
  "missing fields": async (p) => { await STATES.airport(p); await p.keyboard.press("Escape"); await p.click("#bk-view"); await p.waitForTimeout(400); },
};
for (const [name, b] of ENGINES) {
  const plan = name === "chromium" ? [["/services", [768, 1024, 1180, 1280, 1440, 1920]], ["/book", [768, 1024, 1280, 1440]], ["/", [1024, 1440]], ["/locations/jfk-airport", [1024, 1440]]] : [["/services", [1024, 1440]], ["/book", [1440]]];
  for (const [path, widths] of plan) for (const width of widths) {
    const ctx = await engineContext(b, G, { viewport: { width, height: width < 1024 ? 1024 : 900 }, reducedMotion: "reduce" });
    await check(`B72 ${name} ${path} at ${width}: the flight field, its status, the return flight and the 1 hour line never cover a label, input, underline or divider, and stay inside the bar`, async () => {
      const found = [];
      for (const [state, set] of Object.entries(STATES)) {
        if (state.startsWith("return") && path === "/locations/jfk-airport") continue;
        const p = await open(ctx, G, path);
        await set(p);
        await p.keyboard.press("Escape");
        await p.mouse.click(2, 2);
        await p.waitForTimeout(200);
        for (const x of await p.evaluate(BAR)) found.push(`${state}: ${x}`);
        await p.close();
      }
      assert.deepEqual(found, []);
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  for (const path of ["/book", "/", "/locations/manhattan"]) {
    await check(`B73 ${name} ${path} at 1440: the calendar's next and previous month buttons keep it open, and a day of the next month can be picked`, async () => {
      const p = await open(ctx, P, path);
      const cal = async (sel) => {
        await p.click(sel);
        await p.waitForTimeout(300);
        return p.evaluate(() => [!document.getElementById("bk-cal").hidden, document.querySelector("#bk-cal .bk-cal__month").textContent]);
      };
      const [shown, month] = await cal("#bk-date-btn");
      assert.equal(shown, true);
      const [afterNext, nextMonth] = await cal('#bk-cal .bk-cal__nav[data-dir="1"]');
      assert.deepEqual([afterNext, nextMonth === month], [true, false]);
      assert.deepEqual(await cal('#bk-cal .bk-cal__nav[data-dir="-1"]'), [true, month]);
      assert.deepEqual(await cal('#bk-cal .bk-cal__nav[data-dir="1"]'), [true, nextMonth]);
      const day = await p.getAttribute('#bk-cal [data-day$="-10"]', "data-day");
      await p.click(`#bk-cal [data-day="${day}"]`);
      assert.deepEqual([await p.inputValue("#bk-date"), await p.isHidden("#bk-cal")], [day, true]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
  }
  await ctx.close();
}
for (const [name, b] of ENGINES) {
  for (const width of [1440, 390]) {
    const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: "no-preference" });
    await check(`B74 ${name} at ${width} with motion on: a double click on Book your ride or Book and pay online lands on the next step heading, a double click on Change the date opens the calendar on a day`, async () => {
      const dbl = async (p, sel, want) => {
        await p.waitForFunction((s) => { const e = document.querySelector(s), r = e && e.getBoundingClientRect(); return r && r.width > 0 && !document.getAnimations().some((a) => /^::view-transition/.test((a.effect && a.effect.pseudoElement) || "")) && e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }, sel, { timeout: 5000 });
        const r = await p.locator(sel).boundingBox();
        await p.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);
        await p.waitForFunction(([s, f]) => { const a = document.activeElement; return document.getElementById("book-form").dataset.step === s && (a.dataset.day ? "day" : a.id || a.tagName) === f; }, want, { timeout: 5000 }).catch(() => {});
        await p.waitForTimeout(500);
        return p.evaluate(() => [document.getElementById("book-form").dataset.step, document.activeElement.dataset.day ? "day" : document.activeElement.id || document.activeElement.tagName]);
      };
      const p = await open(ctx, P, "/book");
      await trip(p);
      await p.waitForTimeout(300);
      assert.deepEqual(await dbl(p, "#bk-view", ["options", "bk-opt-h"]), ["options", "bk-opt-h"]);
      await priced(p);
      assert.deepEqual(await dbl(p, width >= 1024 ? "#bk-next" : "#bk-bar-go", ["details", "bk-det-h"]), ["details", "bk-det-h"]);
      await p.close();
      const q = await open(ctx, P, "/book");
      await stepTwo(q, { date: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10) });
      await q.waitForSelector("#q-fix", { state: "visible" });
      await q.waitForTimeout(1200);
      await q.locator("#q-fix").scrollIntoViewIfNeeded();
      await q.waitForTimeout(300);
      assert.deepEqual(await dbl(q, "#q-fix", ["search", "day"]), ["search", "day"]);
      assert.equal(await q.isVisible("#bk-cal"), true);
      await q.close();
    });
    await ctx.close();
  }
}
{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B75 the clock-change hour is disabled with its reason on both change days, and the hour after it stays bookable", async () => {
    const sunday = (y, m, n) => { const d = new Date(Date.UTC(y, m, 1)); d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1)); return d.toISOString().slice(0, 10); };
    const next = (m, n) => { const y = +nyDate(0).slice(0, 4); const a = sunday(y, m, n); return a > nyDate(2) ? a : sunday(y + 1, m, n); };
    for (const [day, hour, after] of [[next(10, 1), "01", "02:00"], [next(2, 2), "02", "03:00"]]) {
      const p = await open(ctx, P, "/book");
      await trip(p, { date: day, time: after });
      const slots = await p.$$eval("#bk-time option", (o, h) => o.filter((x) => x.value.startsWith(h + ":")).map((x) => x.disabled), hour);
      assert.deepEqual(slots, Array(6).fill(true), day);
      assert.equal(await p.textContent("#bk-time-h"), "The clocks change that night. Pickups in that hour can't be booked online.");
      assert.equal(await p.inputValue("#bk-time"), after);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
  await check("B76 a picked terminal shows a short label that fits the box, left to right, with the same place, focused or not", async () => {
    for (const [path, width, typed, label, short, id] of [["/book", 1440, "jfk t4", "John F. Kennedy (JFK), Terminal 4", "JFK Terminal 4", "jfk-t4"], ["/", 1024, "lga terminal b", "LaGuardia (LGA), Terminal B", "LGA Terminal B", "lga-tb"], ["/book", 390, "ewr terminal a", "Newark Liberty (EWR), Terminal A", "EWR Terminal A", "ewr-ta"]]) {
      const p = await open(ctx, P, path);
      await p.setViewportSize({ width, height: 900 });
      await place(p, "from", typed, label);
      await p.keyboard.press("Escape");
      await p.mouse.click(2, 2);
      const look = () => p.$eval("#bk-from", (i) => [i.value, document.getElementById("bk-from-id").value, getComputedStyle(i).direction, i.scrollWidth <= i.clientWidth]);
      assert.deepEqual(await look(), [short, id, "ltr", true], `${path} at ${width}`);
      await p.focus("#bk-from");
      assert.deepEqual(await look(), [short, id, "ltr", true], `${path} at ${width}, focused`);
      await p.close();
    }
  });
  await ctx.close();
  const nojs = await context(P, { viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  await check("B77 without javascript a short-notice answer leads with Email to reserve in gold, then WhatsApp, with no pay button", async () => {
    const p = await open(nojs, P, "/book");
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    const t = inWindow();
    await p.fill("#bk-date", t.date);
    await setTime(p, t.time);
    for (const [k, v] of Object.entries(ME)) await p.fill(`#bk-${k}`, v);
    await Promise.all([p.waitForURL(/#q-short-notice$/), p.click("#bk-submit")]);
    const shown = await p.evaluate(() => [...document.querySelectorAll("#bk-submit, #q-mail, #q-wa")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => [e.id, getComputedStyle(e).backgroundColor]));
    assert.deepEqual(shown.map((x) => x[0]), ["q-mail", "q-wa"]);
    assert.notEqual(shown[0][1], shown[1][1], "Email to reserve is the gold one");
    assert.equal(await p.isVisible("#bk-next3"), false);
    await p.close();
  });
  await nojs.close();
}
const SWAP_HINTS = () => {
  const s = document.querySelector("#bk-to-f > .bk-swap").getBoundingClientRect(), bad = [];
  for (const h of document.querySelectorAll("#bk-search .field__hint")) {
    if (!h.getClientRects().length || getComputedStyle(h).visibility === "hidden") continue;
    const rg = document.createRange();
    rg.selectNodeContents(h);
    for (const r of rg.getClientRects()) if (Math.min(r.right, s.right) - Math.max(r.left, s.left) > 0.5 && Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 0.5) bad.push(`${h.id}: "${h.textContent.trim().slice(0, 40)}" ends at ${Math.round(r.right)}, the swap starts at ${Math.round(s.left)}`);
  }
  return bad;
};
for (const [name, b] of ENGINES) {
  await check(`B78 ${name} below 55rem: the pickup and stop hints and errors never run under the swap button, 320 to 430 wide`, async () => {
    const found = [];
    for (const width of [320, 360, 375, 390, 414, 430]) {
      const ctx = await engineContext(b, G, { viewport: { width, height: 844 }, reducedMotion: "reduce" });
      for (const stop of [false, true]) {
        const p = await open(ctx, G, "/book");
        for (const [end, text] of [["from", "Some Hotel Name"], ...(stop ? [["stop1", "Another Hotel"]] : []), ["to", "Another Place"]]) {
          if (end === "stop1") await p.click("#bk-addstop");
          await type(p, end, text);
          await p.waitForTimeout(1000);
          await p.keyboard.press("Escape");
        }
        await blank(p);
        await p.click("#bk-view");
        await p.waitForSelector(stop ? "#bk-stop1-f .bk-e.is-on" : "#e-from-zip.is-on");
        for (const x of await p.evaluate(SWAP_HINTS)) found.push(`${width}${stop ? " with a stop" : ""}: ${x}`);
        await p.close();
      }
      await ctx.close();
    }
    assert.deepEqual(found, []);
  });
}
for (const [name, b] of ENGINES) {
  for (const width of [1440, 390]) {
    const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: "reduce" });
    await check(`B79 ${name} at ${width}: Book and pay online pressed in the same moment as a gratuity change reprices first, and only the next press pays the new total`, async () => {
      const p = await open(ctx, P, "/book");
      const posts = [];
      p.on("request", (r) => r.url().endsWith("/api/book") && r.method() === "POST" && posts.push(JSON.parse(r.postData() || "{}")));
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await details(p);
      await priced(p);
      const before = posts.length, want = cash(TOTAL + percentCents(FARE, "20"));
      await p.evaluate(() => { document.querySelector('label[for="bk-t-20"]').click(); document.getElementById("bk-submit").click(); });
      await p.waitForFunction((t) => document.getElementById("bk-status").textContent === `The total is now ${t}. Press Book and pay online to continue.`, want);
      assert.deepEqual([posts.slice(before).map((x) => x.action + ":" + x.tip), new URL(p.url()).pathname, await p.$eval("#price-total", (x) => (x.firstChild || {}).textContent)], [["quote:20"], "/book", want]);
      await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click("#bk-submit")]);
      await p.waitForFunction(() => /\d/.test(document.getElementById("cf-total").textContent));
      assert.deepEqual([await p.textContent("#cf-total"), posts.slice(before).map((x) => x.action + ":" + x.tip)], [want, ["quote:20", "pay:20"]]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
const PLACEHOLDER_FIT = (ids) => ids.map((id) => {
  const i = document.getElementById(id);
  if (!i || !i.getClientRects().length) return [id, "hidden"];
  const s = getComputedStyle(i), ps = getComputedStyle(i, "::placeholder"), sp = document.createElement("span");
  sp.textContent = i.placeholder;
  Object.assign(sp.style, { font: ps.font, letterSpacing: ps.letterSpacing, whiteSpace: "pre", position: "absolute" });
  document.body.append(sp);
  const need = sp.getBoundingClientRect().width, r = i.getBoundingClientRect();
  sp.remove();
  return [id, Math.round(need * 10) / 10, Math.round((r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth)) * 10) / 10, ps.fontSize];
});
for (const [name, b] of ENGINES) {
  await check(`B80 ${name}: the Stop 1 and Stop 2 placeholder fits its box from 320 to 430 wide with a pickup set, 14px below 360 and 16px from 360`, async () => {
    const bad = [];
    for (const width of [320, 336, 344, 360, 375, 390, 430]) {
      const ctx = await engineContext(b, G, { viewport: { width, height: 844 }, reducedMotion: "reduce" });
      const p = await open(ctx, G, "/book");
      await p.evaluate(() => document.fonts.ready);
      await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
      await p.click("#bk-addstop");
      await p.click("#bk-addstop");
      for (const [id, need, box, size] of await p.evaluate(PLACEHOLDER_FIT, ["bk-stop1", "bk-stop2", "bk-to"])) {
        if (need === "hidden") bad.push(`${width} ${id} not shown`);
        else if (need > box) bad.push(`${width} ${id} needs ${need} px of ${box}`);
        else if (size !== (id !== "bk-to" && width < 360 ? "14px" : "16px")) bad.push(`${width} ${id} ${size}`);
      }
      await ctx.close();
    }
    assert.deepEqual(bad, []);
  });
}
{
  const ctx = await context(G, { viewport: { width: 1280, height: 800 } });
  await check("B81 every place option and the email hint button carry their visible words in their names", async () => {
    const p = await open(ctx, G, "/book");
    await type(p, "from", "jfk");
    await p.waitForTimeout(1000);
    const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const rows = await p.$$eval("#bk-from-list [role=option]", (o) => o.map((x) => [x.textContent, x.getAttribute("aria-label")]));
    assert.ok(rows.filter((r) => r[1]).length >= 3, JSON.stringify(rows));
    assert.deepEqual(rows.filter(([t, l]) => l && !norm(l).includes(norm(t))), []);
    assert.ok(rows.some(([t]) => /Terminal 4 John F\. Kennedy \(JFK\)/.test(t)), JSON.stringify(rows));
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  await check("B82 pay.js loads the second booking script once and never blocks rendering with it, on /book and on a full host", async () => {
    for (const path of ["/book", "/"]) {
      const p = await open(ctx, P, path);
      const r = await p.evaluate(() => performance.getEntriesByType("resource").filter((e) => /\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/.test(e.name)).map((e) => [e.initiatorType, e.renderBlockingStatus]));
      assert.deepEqual([r, await p.evaluate(() => P2)], [[["script", "non-blocking"]], 1], path);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
  await check("B82 a press on the date button or on Book and pay online before the second script arrives runs once it does", async () => {
    let hold;
    const gate = new Promise((r) => (hold = r));
    await ctx.route(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/, async (r) => { await gate; await r.continue(); });
    const p = await ctx.newPage();
    p.errors = [];
    p.on("pageerror", (e) => p.errors.push(e.message));
    await p.goto(`${P.base}/book`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    await p.click("#bk-date-btn");
    assert.deepEqual([await p.evaluate(() => P2), await p.isHidden("#bk-cal")], [0, true]);
    hold();
    await p.waitForSelector("#bk-cal [data-day]", { state: "visible" });
    assert.deepEqual([await p.getAttribute("#bk-date-btn", "aria-expanded"), p.errors], ["true", []]);
    await ctx.unroute(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/);
    await p.close();
  });
  await check("B82 when the second script fails once it is fetched again and the calendar works", async () => {
    let n = 0;
    await ctx.route(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/, (r) => (n++ ? r.continue() : r.fulfill({ status: 503, body: "" })));
    const p = await ctx.newPage();
    await p.goto(`${P.base}/book`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => P2 === 1, null, { timeout: 8000 });
    await p.click("#bk-date-btn");
    await p.waitForSelector("#bk-cal [data-day]", { state: "visible" });
    assert.equal(n, 2);
    await ctx.unroute(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/);
    await p.close();
  });
  await check("B82 when the second script fails, the native date input and time select show at once, and a trip booked with them goes to the payment page with the first press", async () => {
    let n = 0;
    await ctx.route(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/, (r) => (n++, r.abort()));
    const p = await open(ctx, P, "/book");
    await p.waitForFunction(() => P2 === -1 && document.getElementById("book-form").classList.contains("bk-p2off"), null, { timeout: 1500 });
    assert.deepEqual(await p.evaluate(() => ["bk-date", "bk-time", "bk-date-btn"].map((i) => getComputedStyle(document.getElementById(i)).display !== "none")), [true, true, false]);
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await setTime(p, "12:40");
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { timeout: 8000 }), p.click("#bk-submit")]);
    assert.ok(n >= 1);
    await ctx.unroute(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/);
    await p.close();
  });
  await check("B82 when the second script hangs, the native date input and time select show 4 s in, and the script turning up after the form was used leaves them in place", async () => {
    let hold;
    const gate = new Promise((r) => (hold = r));
    await ctx.route(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/, async (r) => { await gate; await r.continue().catch(() => {}); });
    const p = await ctx.newPage();
    p.errors = [];
    p.on("pageerror", (e) => p.errors.push(e.message));
    const t0 = Date.now();
    await p.goto(`${P.base}/book`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => P2 === -1 && getComputedStyle(document.getElementById("bk-date")).display !== "none", null, { timeout: 6000 });
    const after = Date.now() - t0;
    assert.ok(after >= 3500 && after < 5500, `the fallback came ${after} ms in`);
    await p.fill("#bk-date", DATE);
    hold();
    await p.waitForFunction(() => typeof pc === "function", null, { timeout: 4000 });
    assert.deepEqual(await p.evaluate(() => [P2, document.getElementById("book-form").classList.contains("bk-p2off"), document.getElementById("bk-date").value]), [-1, true, DATE]);
    assert.deepEqual(p.errors, []);
    await ctx.unroute(/\/assets\/pay2\.[A-Za-z0-9_-]+\.js$/);
    await p.close();
  });
  await ctx.close();
}
for (const [name, b] of ENGINES) {
  await check(`B83 ${name}: a reload of /book#options or #details with pay.js 400 ms late never shows step 1 or the step 1 header`, async () => {
    for (const width of [390, 1280]) {
      const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 800 }, reducedMotion: "reduce" });
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      for (const hash of ["#options", "#details"]) {
        if (hash === "#details") await next(p);
        await p.route(/\/assets\/pay\.[A-Za-z0-9_-]+\.js$/, async (r) => { await new Promise((ok) => setTimeout(ok, 400)); await r.continue(); });
        await p.addInitScript(() => {
          window.__fr = [];
          const t0 = performance.now(), tick = () => {
            const f = document.getElementById("book-form"), m = document.querySelector("main"), n = document.querySelector(".site-nav");
            if (f && m && !f.classList.contains("is-js")) window.__fr.push([getComputedStyle(m).visibility, n ? getComputedStyle(n).visibility : "-"]);
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await p.evaluate(() => location.reload());
        await p.waitForLoadState("load");
        await p.waitForTimeout(700);
        const seen = await p.evaluate(() => window.__fr);
        assert.deepEqual(seen.filter((x) => x.includes("visible")), [], `${width} ${hash}`);
        assert.equal(await p.evaluate(() => [document.getElementById("book-form").dataset.step, getComputedStyle(document.querySelector("main")).visibility].join()), `${hash.slice(1)},visible`);
        await p.unroute(/\/assets\/pay\.[A-Za-z0-9_-]+\.js$/);
      }
      await ctx.close();
    }
  });
}
for (const [name, b] of ENGINES) {
  await check(`B84 ${name}: ${name === "webkit" ? "no first paint hold" : "no frame is painted with the layout from before the web fonts arrive"}, with motion on and with reduced motion`, async () => {
    const bad = [];
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, P, { viewport: { width: 1280, height: 800 }, reducedMotion });
      await ctx.addInitScript(() => {
        window.__f = [];
        const t0 = performance.now(), tick = () => {
          const a = document.querySelector(".site-nav a"), y = document.body;
          a && y && window.__f.push([getComputedStyle(y).opacity, Math.round(a.getBoundingClientRect().width * 10) / 10]);
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      for (const path of ["/about", "/rates", "/"]) {
        const p = await open(ctx, P, path);
        await p.waitForTimeout(1300);
        const f = await p.evaluate(() => window.__f), end = f.length && f[f.length - 1][1];
        const early = f.filter((x) => x[0] !== "0" && x[1] !== end);
        name !== "webkit" && early.length && bad.push(`${path} ${reducedMotion}: ${early.length} frames`);
        name === "firefox" && (await p.evaluate(() => getComputedStyle(document.body).animationName)) !== "ffh" && bad.push(`${path}: no first paint hold`);
        name !== "firefox" && (await p.evaluate(() => getComputedStyle(document.body).animationName)) !== "none" && bad.push(`${path}: hold outside Firefox`);
        await p.close();
      }
      await ctx.close();
    }
    assert.deepEqual(bad, []);
  });
}
for (const [name, b] of ENGINES) {
  await check(`B85 ${name}: /book#options and /book#details opened from another page put focus on the step heading at once, with the first paint hold in Firefox`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const got = [];
    for (const [hash, id] of [["#options", "bk-opt-h"], ["#details", "bk-det-h"]]) {
      await p.goto(`${P.base}/rates`, { waitUntil: "load" });
      await p.goto(`${P.base}/book${hash}`, { waitUntil: "load" });
      await p.waitForFunction((x) => document.getElementById("book-form").dataset.step === x, hash.slice(1));
      await p.waitForTimeout(400);
      got.push([hash, await p.evaluate(() => document.activeElement.id)]);
    }
    assert.deepEqual(got, [["#options", "bk-opt-h"], ["#details", "bk-det-h"]]);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}
const TM_STATE = () => {
  const m = document.getElementById("bk-tm"), b = document.getElementById("bk-time-btn"), a = document.activeElement, l = m.querySelector("[role=listbox]");
  const lr = l && l.getBoundingClientRect(), ar = a.getBoundingClientRect();
  return { open: !m.hidden, expanded: b.getAttribute("aria-expanded"), role: a.getAttribute("role"), v: a.dataset.v || a.id, text: a.firstElementChild ? a.firstElementChild.textContent : a.textContent, inView: !!lr && ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1, selected: a.getAttribute("aria-selected"), value: document.getElementById("bk-time").value, label: b.textContent };
};
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/book", 1440], ["/", 1440], ["/book", 390], ["/", 390]]) {
    await check(`B86 ${name} ${path} at ${width}: the time picker (owner request 1) looks like Date, opens on 9:00 AM on later days and on the first bookable time today, right under its group label, groups the 144 times in 12 hour format by part of day, marks the times inside the online notice window (MIN_NOTICE_HOURS) with their reason, keeps the native select as the source of truth, and works with the arrows, Home, End, Page Up, Page Down, typed digits, Enter, Escape and the mouse, with CLS 0`, async () => {
      const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: "no-preference" });
      await ctx.addInitScript(SPY);
      const p = await open(ctx, P, path);
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      const look = await p.evaluate(() => {
        const d = document.getElementById("bk-date-btn"), t = document.getElementById("bk-time-btn"), r = (e) => e.getBoundingClientRect(), cs = (e) => getComputedStyle(e), sp = (e) => cs(e.lastElementChild);
        return [r(t).height === r(d).height, Math.abs(r(t).top - r(d).top) < 1, [sp(t).fontSize, sp(t).fontWeight, sp(t).lineHeight, cs(t).boxShadow, cs(t).paddingBottom].join() === [sp(d).fontSize, sp(d).fontWeight, sp(d).lineHeight, cs(d).boxShadow, cs(d).paddingBottom].join(), !!t.querySelector('use[href="#i-clock"]'), t.classList.contains("is-ph"), cs(document.getElementById("bk-time")).display, getComputedStyle(document.getElementById("bk-time-f"), "::after").content, t.textContent];
      });
      const auto = await p.evaluate(() => document.getElementById("bk-time").selectedOptions[0].textContent);
      assert.ok(/^(1[0-2]|[1-9]):[0-5]0 (AM|PM)$/.test(auto), auto);
      assert.deepEqual(look, [true, true, true, true, false, "none", "none", auto], "the field is styled exactly like Date: height, label row, value type, underline and icon, and shows the time that filled in by itself (owner request 2)");
      await pickDate(p, "#bk-date-btn", DATE);
      assert.equal(await p.evaluate(() => document.activeElement.id), "bk-time-btn");
      const rect = () => p.evaluate(() => { const r = document.getElementById("bk-time-f").getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height].join(); });
      const field = await rect();
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => !document.getElementById("bk-tm").hidden && document.activeElement.getAttribute("role") === "option");
      let s = await p.evaluate(TM_STATE);
      assert.deepEqual([s.open, s.expanded, s.v, s.text, s.inView], [true, "true", "09:00", "9:00 AM", true], "a date days ahead opens on 9:00 AM, focused and in view");
      const under = await p.evaluate(() => { const a = document.activeElement, l = a.closest("[role=listbox]"), g = a.parentNode.querySelector(".bk-grp__label"); return [Math.round(a.getBoundingClientRect().top - g.getBoundingClientRect().bottom), Math.round(g.getBoundingClientRect().top - l.getBoundingClientRect().top)]; });
      assert.ok(under[0] >= 0 && under[0] <= 6 && Math.abs(under[1]) <= 1, `9:00 AM sits right under its sticky group label at the top of the list, no row is cut by the label: ${under}`);
      const shape = await p.evaluate(() => {
        const m = document.getElementById("bk-tm"), l = m.querySelector("[role=listbox]"), o = [...l.querySelectorAll("[role=option]")], g = [...l.querySelectorAll("[role=group]")];
        return { dialog: [m.getAttribute("role"), m.getAttribute("aria-label")], listbox: document.getElementById(l.getAttribute("aria-labelledby")).textContent, head: m.querySelector(".bk-tm__h").textContent, tz: m.querySelector(".bk-cal__tz").textContent.slice(0, 13), groups: g.map((x) => [document.getElementById(x.getAttribute("aria-labelledby")).textContent, x.querySelectorAll("[role=option]").length]), count: o.length, first: o[0].textContent, last: o.at(-1).textContent, twelve: o.every((x) => /^(1[0-2]|[1-9]):[0-5]0 (AM|PM)$/.test(x.textContent)), muted: o.filter((x) => x.matches(".is-mute,[aria-disabled]")).length, selected: o.filter((x) => x.getAttribute("aria-selected") === "true").length, inside: m.parentElement.id };
      });
      assert.deepEqual(shape, { dialog: ["dialog", "Choose a time"], listbox: "Pickup time", head: shortDate(DATE), tz: "New York time", groups: [["Night", 36], ["Morning", 36], ["Afternoon", 36], ["Evening", 36]], count: 144, first: "12:00 AM", last: "11:50 PM", twelve: true, muted: 0, selected: 0, inside: "bk-time-f" });
      const keys = [];
      for (const k of ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageDown", "PageUp"]) { await p.keyboard.press(k); keys.push((await p.evaluate(TM_STATE)).v); }
      assert.deepEqual(keys, ["09:10", "09:20", "09:10", "23:50", "00:00", "01:00", "02:00", "01:00"], "arrows move by 10 minutes, Page Up and Down by an hour, Home and End to the ends");
      await p.keyboard.type("9");
      const nine = (await p.evaluate(TM_STATE)).v;
      await p.keyboard.type("3");
      const ninethirty = (await p.evaluate(TM_STATE)).v;
      await p.waitForTimeout(1100);
      await p.keyboard.type("9");
      const again = (await p.evaluate(TM_STATE)).v;
      await p.keyboard.type("p");
      assert.deepEqual([nine, ninethirty, again, (await p.evaluate(TM_STATE)).v], ["09:00", "09:30", "21:00", "21:00"], "typing digits jumps to the time, a typed hour lands on the hour, the next 9 finds 9 PM");
      await p.keyboard.press("ArrowUp");
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => document.getElementById("bk-tm").hidden);
      s = await p.evaluate(TM_STATE);
      assert.deepEqual([s.open, s.expanded, s.v, s.value, s.label], [false, "false", "bk-time-btn", "20:50", "8:50 PM"], "Enter picks the time into the native select and returns focus to the field");
      assert.equal(await p.getByRole("button", { name: "Pickup time 8:50 PM" }).count(), 1, "the field announces its label and value");
      await p.click("#bk-time-btn");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      s = await p.evaluate(TM_STATE);
      const gold = await p.evaluate(() => getComputedStyle(document.activeElement).backgroundColor);
      assert.deepEqual([s.v, s.selected, s.inView, gold], ["20:50", "true", true, "rgb(201, 162, 39)"], "it reopens on the selected time in the gold style");
      assert.equal(await p.getByRole("listbox", { name: "Pickup time" }).getByRole("option", { name: "8:50 PM", selected: true }).count(), 1);
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => document.getElementById("bk-tm").hidden);
      s = await p.evaluate(TM_STATE);
      assert.deepEqual([s.v, s.value], ["bk-time-btn", "20:50"], "Escape closes with no change and returns focus");
      assert.equal(await rect(), field, "opening and closing the picker moves no part of the page");
      await p.click("#bk-time-btn");
      await clickTime(p, "07:30");
      await p.waitForFunction(() => document.getElementById("bk-tm").hidden);
      assert.deepEqual([await p.inputValue("#bk-time"), await p.textContent("#bk-time-btn"), await p.evaluate(() => document.activeElement.id)], ["07:30", "7:30 AM", "bk-time-btn"]);
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      await p.keyboard.press("Tab");
      await p.waitForTimeout(250);
      assert.equal(await p.evaluate(() => document.getElementById("bk-tm").hidden), true, "Tab closes it");
      const soon = nyNow();
      await setTime(p, "");
      assert.deepEqual([await p.textContent("#bk-time-btn"), await p.evaluate(() => document.getElementById("bk-time-btn").classList.contains("is-ph"))], ["Select a time", true], "the field follows the native select");
      await pickDate(p, "#bk-date-btn", soon.slice(0, 10));
      await p.click("#bk-time-btn");
      await p.waitForFunction(() => !document.getElementById("bk-tm").hidden);
      const near = await p.evaluate(() => {
        const o = [...document.querySelectorAll("#bk-tm [role=option]")], a = document.activeElement;
        return { muted: o.filter((x) => x.classList.contains("is-mute")).map((x) => [x.dataset.v, x.lastElementChild.textContent, x.getAttribute("aria-disabled")]), first: o.find((x) => !x.matches(".is-mute,[aria-disabled]")), active: a.dataset.v, note: (document.querySelector("#bk-tm .bk-cal__note") || {}).textContent, past: o.length && o[0].dataset.v };
      });
      const cut = soon.slice(11);
      assert.ok(near.muted.length && near.muted.every(([v, r, d]) => v < cut && r === "Email or WhatsApp only" && d === null), `times inside the notice window are marked with their reason and stay selectable for a request: ${JSON.stringify(near.muted)} before ${cut}`);
      assert.ok(cut > "23:50" || near.active >= cut, `it opens on the first bookable time ${near.active} after ${cut}`);
      assert.ok(near.note, "the time list explains the window under the times");
      await clickTime(p, near.muted[0][0]);
      await p.waitForFunction(() => !document.getElementById("bk-time-h").hidden);
      assert.equal(await p.textContent("#bk-time-h"), near.note, "a time inside the window shows the same reason under the field");
      assert.deepEqual(await cls(p).then(([v]) => v), 0, "CLS 0");
      assert.deepEqual(p.errors, []);
      await ctx.close();
    });
  }
  await check(`B86 ${name}: the return time and the hourly start time use the same picker, the dialog moves into the field it opens for, and the timing is about 150 ms like the other panels with motion and instant with reduced motion`, async () => {
    for (const motion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 }, reducedMotion: motion });
      const p = await open(ctx, P, "/book");
      await trip(p, { time: "12:40" });
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bk-tm")).transitionDuration.split(",")[0].trim()), motion === "reduce" ? "0s" : "0.15s");
      await p.click("#bk-addret");
      await pickDate(p, "#bk-rdate-btn", RDATE);
      await p.waitForFunction(() => document.activeElement.id === "bk-rtime-btn", null, { timeout: 3000 });
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-tm").parentElement.id, document.getElementById("bk-rtime-btn").getAttribute("aria-expanded"), document.querySelector("#bk-tm [role=listbox]").getAttribute("aria-labelledby")]), ["bk-rtime-f", "true", "bk-rtime-l"]);
      await p.keyboard.type("6p");
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => document.getElementById("bk-tm").hidden);
      assert.deepEqual([await p.inputValue("#bk-rtime"), await p.textContent("#bk-rtime-btn"), await p.evaluate(() => document.activeElement.id)], ["18:00", "6:00 PM", "bk-rtime-btn"]);
      await p.click("#bk-rmret");
      await p.click('label[for="bk-hour"]');
      await p.click("#bk-time-btn");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-tm").parentElement.id, document.activeElement.dataset.v, document.querySelector("#bk-tm .bk-tm__h").textContent !== ""]), ["bk-time-f", "12:40", true], "by the hour, the start time opens on the chosen 12:40");
      await p.keyboard.press("Escape");
      assert.deepEqual(p.errors, []);
      await ctx.close();
    }
  });
  await check(`B86 ${name}: on phones the time list opens with the calendar's width and edges, its glass background is opaque, and times inside the notice window are clearly dimmer than bookable times`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    for (const path of ["/", "/book"]) {
      const p = await open(ctx, P, path);
      await pickDate(p, "#bk-date-btn", inWindow().date);
      await p.click("#bk-date-btn");
      await p.waitForSelector("#bk-cal:not([hidden])");
      const cal = await p.evaluate(() => { const r = document.getElementById("bk-cal").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; });
      await p.keyboard.press("Escape");
      await p.waitForSelector("#bk-cal", { state: "hidden" });
      await p.click("#bk-time-btn");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      const t = await p.evaluate(() => {
        const m = document.getElementById("bk-tm"), r = m.getBoundingClientRect(), lum = (c) => { const v = c.match(/[\d.]+/g).map(Number); return (v[0] + v[1] + v[2]) / 3; };
        const mute = m.querySelector("[role=option].is-mute:not([aria-selected=true]) span");
        return { x: [Math.round(r.left), Math.round(r.right)], bg: getComputedStyle(m).backgroundColor, gap: mute ? Math.abs(lum(getComputedStyle(m).color) - lum(getComputedStyle(mute).color)) : -1 };
      });
      assert.deepEqual(t.x, cal, `${path}: the time list spans the calendar`);
      if (path === "/") assert.match(t.bg, /^rgb\(/, "an opaque background on the glass bar, so the page never shows through");
      assert.ok(t.gap >= 60, `${path}: muted times are clearly dimmer than bookable ones (${t.gap})`);
      await p.close();
    }
    await ctx.close();
  });
  await check(`B86 ${name}: on a 1280 by 720 laptop the time list is no taller than 240 px and the whole picker sits inside the window, like the calendar`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    for (const path of ["/", "/book"]) {
      const p = await open(ctx, P, path);
      await pickDate(p, "#bk-date-btn", DATE);
      await p.click("#bk-time-btn");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => { const m = document.getElementById("bk-tm"), l = m.querySelector(".bk-list"); return [Math.round(l.getBoundingClientRect().height), m.getBoundingClientRect().bottom <= innerHeight]; });
      assert.ok(r[0] <= 240 && r[1], `${path}: list ${r[0]} px, inside the window ${r[1]}`);
      await p.close();
    }
    await ctx.close();
  });
  await check(`B86 ${name}: a typed time stays in the half of the day the typing started from (2:00 PM then 230 is 2:30 PM, 9:00 AM then 930 is 9:30 AM, 1:00 AM then 10 is 10:00 AM)`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const p = await open(ctx, P, "/book");
    await trip(p, { time: "14:00" });
    const got = [];
    for (const [from, keys] of [["14:00", "230"], ["09:00", "930"], ["01:00", "10"]]) {
      await setTime(p, from);
      await p.click("#bk-time-btn");
      await p.waitForFunction((v) => document.activeElement.dataset.v === v, from);
      await p.keyboard.type(keys);
      got.push((await p.evaluate(TM_STATE)).v);
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => document.getElementById("bk-tm").hidden);
      await p.waitForTimeout(1100);
    }
    assert.deepEqual(got, ["14:30", "09:30", "10:00"]);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}
{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 }, forcedColors: "active", reducedMotion: "no-preference" });
  await check("B86 forced colors: the chosen time is drawn in Highlight, the focused time has an outline, and the times are readable", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p, { time: "12:40" });
    await p.focus("#bk-time-btn");
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
    await p.keyboard.press("ArrowDown");
    const fc = await p.evaluate(() => { const sel = document.querySelector('#bk-tm [aria-selected="true"]'), f = document.activeElement, o = document.querySelector('#bk-tm [data-v="03:00"]'); return [getComputedStyle(sel).backgroundColor !== getComputedStyle(o).backgroundColor, getComputedStyle(f).outlineStyle, parseFloat(getComputedStyle(f).outlineWidth) >= 2, getComputedStyle(sel).forcedColorAdjust]; });
    assert.deepEqual(fc, [true, "solid", true, "none"]);
    await p.close();
  });
  await check("B86 forced colors: times inside the notice window are drawn in GrayText on the glass bar and on the light card", async () => {
    for (const path of ["/", "/book"]) {
      const p = await open(ctx, P, path);
      await pickDate(p, "#bk-date-btn", inWindow().date);
      await p.click("#bk-time-btn");
      await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
      assert.deepEqual(await p.evaluate(() => { const g = document.createElement("span"); g.style.color = "GrayText"; document.body.append(g); const gray = getComputedStyle(g).color, m = document.querySelector("#bk-tm [role=option].is-mute:not([aria-selected=true])"); g.remove(); return m ? [getComputedStyle(m.firstElementChild).color, getComputedStyle(m.querySelector(".bk-tm__r")).color].map((c) => c === gray) : null; }), [true, true], path);
      await p.close();
    }
  });
  await ctx.close();
}
const REQUEST_TRIP = { trip_type: "one", from_text: "350 5th Ave, New York, NY 10118", to_text: "Grand Central Terminal, New York, NY 10017", date: DATE, time: "12:40", passengers: "1", class: "suv" };
const JFK_TRIP = { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "350 5th Ave, New York, NY 10118", date: DATE, time: "12:40", passengers: "1", class: "suv" };
const FRAMES = () => {
  window.__fr = [];
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const op = (e) => { let v = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) v *= +getComputedStyle(x).opacity; return Math.round(v * 100) / 100; };
  const hi = (e) => Math.round(e.getBoundingClientRect().height * 10) / 10;
  const tick = () => {
    const f = document.getElementById("book-form"), g = (i) => document.getElementById(i);
    if (f && f.dataset.step !== "search") {
      const s = g("bk-side"), bar = g("bk-bar");
      window.__fr.push({ t: Math.round(performance.now()), side: hi(s), pay: hi(s.querySelector(".bk-pay")), bar: hi(bar), act: hi(g("bk-act")), more: Math.round(g("bk-more").getBoundingClientRect().top + scrollY), q: bar.classList.contains("is-q"), off: bar.classList.contains("is-off"), xo: document.querySelectorAll(".bk-xo").length, keys: ["bk-side", "bk-act"].flatMap((i) => g(i).getAnimations()).map((a) => a.effect.getKeyframes().map((k) => k.height || "").join(">")).filter((v) => v.length > 1).join(), choice: op(g("bk-choice")), barop: op(bar), line: vis(g("bk-bar-q")) ? op(g("bk-bar-q")) : -1, qbody: vis(g("q-body")), tot: vis(g("bk-tot")) });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const frames = async (p, q, ms) => {
  const t = Date.now();
  await p.waitForFunction((q) => { const f = window.__fr, i = q === null ? 0 : f.findIndex((x) => x.q === q); return i >= 0 && f.length - i > 5; }, q, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(Math.max(0, ms - (Date.now() - t)));
};
async function cardStep(b, width, motion, t, delay = 900) {
  const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: motion });
  await ctx.addInitScript(SPY);
  await ctx.addInitScript(FRAMES);
  await ctx.route("**/api/book", async (r) => { await new Promise((z) => setTimeout(z, delay)); await r.continue().catch(() => {}); });
  const p = await open(ctx, P, "/rates");
  await p.evaluate((x) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: x, stops: 0, return: false, step: "search" })), t);
  await p.goto(`${P.base}/book`, { waitUntil: "load" });
  await p.waitForTimeout(200);
  await p.click("#bk-view");
  return [ctx, p];
}
for (const [name, b] of ENGINES) {
  for (const width of [1440, 390]) {
    await check(`B87 ${name} at ${width}: the ${width < 1024 ? "phone pay bar" : "summary card"} (owner request 2) shows soft placeholder lines while the price loads, and when a request answer lands only what changed fades in over about 200 ms ${width < 1024 ? "while the bar keeps its height and never dims" : "while the card height moves through measured pixel heights with the white card under it in every frame"}, nothing is left behind and nothing on the page moves`, async () => {
      const [ctx, p] = await cardStep(b, width, "no-preference", REQUEST_TRIP);
      await p.waitForTimeout(400);
      const sk = await p.evaluate(() => [...document.querySelectorAll("#price-lines .bk-sk, #price-total .bk-sk, #bk-bar-total .bk-sk")].filter((x) => x.getClientRects().length).map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      assert.ok(sk.length && sk.every(([w, h]) => w >= 40 && h >= 14), `placeholders in the final layout, not slivers: ${JSON.stringify(sk)}`);
      await p.waitForFunction(() => document.getElementById("bk-bar").classList.contains("is-q"));
      await frames(p, true, 450);
      const fr = await p.evaluate(() => window.__fr);
      const i = fr.findIndex((x) => x.q), before = fr[i - 1], during = fr.slice(i), after = fr.at(-1);
      assert.ok(i > 0 && during.length >= 5, `the answer lands after the first frames: ${JSON.stringify(fr.slice(Math.max(0, i - 2), i + 3))}`);
      assert.ok(fr.every((x) => x.xo === 0), "no overlay copy of the old content in any frame");
      const line = during.map((x) => x.line).filter((v) => v >= 0);
      assert.ok(line.length && line[0] < 0.5 && line.at(-1) === 1 && line.filter((v) => v > 0 && v < 1).length >= 3, `the request line fades in: ${line.join()}`);
      if (width >= 1024) {
        assert.ok(fr.every((x) => x.choice === 1), "the class name in the card never dims");
        const mid = during.filter((x) => x.side < before.side - 2 && x.side > after.side + 2);
        assert.ok(before.side - after.side > 100 && mid.length >= 3, `the card height moves through ${mid.length} frames from ${before.side} to ${after.side}`);
        const keys = during.map((x) => x.keys).filter(Boolean);
        assert.ok(keys.length && keys.every((h) => /^[\d.]+px>[\d.]+px(,[\d.]+px>[\d.]+px)*$/.test(h)), `measured pixel heights in every engine: ${[...new Set(keys)].join(" ")}`);
        assert.ok(during.every((x) => x.pay >= x.side - 1), `the white card fills the moving card in every frame: ${JSON.stringify(during.filter((x) => x.pay < x.side - 1).slice(0, 2))}`);
      } else {
        assert.ok(Math.abs(before.bar - after.bar) <= 1, `the phone bar keeps its height: ${before.bar} and ${after.bar}`);
        assert.ok(fr.every((x) => x.barop === 1), `the phone bar never dims: ${[...new Set(fr.map((x) => x.barop))].join()}`);
      }
      assert.deepEqual(await p.evaluate(() => [document.querySelectorAll(".bk-xo").length, ["bk-side", "bk-act", "bk-bar"].map((i) => document.getElementById(i).getAttribute("style") || "").join(""), ["bk-side", "bk-act", "bk-bar"].flatMap((i) => document.getElementById(i).getAnimations()).length]), [0, "", 0], "the clip and the animations are gone after the change");
      assert.deepEqual(await cls(p), [0, []], "the answer moves nothing on the page");
      assert.deepEqual(p.errors, []);
      await ctx.close();
    });
  }
  await check(`B87 ${name}: with reduced motion every change of the card, the bar and the actions is instant, with no fade and no measured height`, async () => {
    for (const width of [1440, 390]) {
      const [ctx, p] = await cardStep(b, width, "reduce", REQUEST_TRIP);
      await p.waitForFunction(() => document.getElementById("bk-bar").classList.contains("is-q"));
      await p.waitForTimeout(300);
      const fr = await p.evaluate(() => window.__fr);
      assert.ok(fr.every((x) => x.xo === 0 && x.keys === "" && x.line !== 0 && x.line < 1.01), "no overlay, no inline height, nothing fading in any frame");
      assert.ok(fr.filter((x) => x.line >= 0).every((x) => x.line === 1), "the request line is there at full strength in its first frame");
      const i = fr.findIndex((x) => x.q);
      if (width >= 1024) assert.equal(fr[i].side, fr.at(-1).side, "the new height is there in the first frame");
      await ctx.close();
    }
  });
  await check(`B87 ${name}: by the hour, a change to the Sprinter (a request) and back animates the card and the actions both ways, and the request steps and the total follow the answer from its first frame`, async () => {
    const [ctx, p] = await cardStep(b, 1440, "no-preference", { ...JFK_TRIP, trip_type: "hour", from_text: "350 5th Ave, New York, NY 10118", from_id: "", to_text: "", hours: "3", vehicle: "suv-suburban" }, 300);
    await p.waitForFunction(() => /\d/.test(document.getElementById("price-total").textContent) && !document.querySelector("#price-total .bk-sk"));
    await p.waitForTimeout(400);
    const h0 = await p.evaluate(() => document.getElementById("bk-side").getBoundingClientRect().height);
    await p.evaluate(() => (window.__fr = []));
    await p.click('label[for="bk-c-sprinter"]');
    await frames(p, true, 450);
    let fr = await p.evaluate(() => window.__fr);
    let i = fr.findIndex((x) => x.q);
    assert.ok(i >= 0 && fr.slice(i).every((x) => x.qbody && !x.tot), "to the Sprinter request: the request steps show and the total hides from the first frame");
    assert.ok(fr.at(-1).side < h0 - 100 && fr.filter((x) => x.side < h0 - 2 && x.side > fr.at(-1).side + 2).length >= 3, "the card shrinks over several frames");
    assert.ok(fr.filter((x) => x.act > fr[i].act + 2 && x.act < fr.at(-1).act - 2).length >= 3, "the actions grow over several frames");
    await p.evaluate(() => (window.__fr = []));
    await p.click('label[for="bk-c-suv"]');
    await frames(p, false, 450);
    fr = await p.evaluate(() => window.__fr);
    i = fr.findIndex((x) => !x.q);
    assert.ok(i >= 0 && fr.slice(i).every((x) => !x.qbody && x.tot), `back to the priced class: the request steps go and the total shows from the first frame: ${JSON.stringify(fr.slice(i, i + 2))}`);
    const act = fr.slice(i), more = act.map((x) => x.more);
    assert.ok(act.filter((x) => x.act < act[0].act - 2 && x.act > act.at(-1).act + 2).length >= 3, `the actions shrink over several frames, not in one: ${act.map((x) => x.act).join()}`);
    assert.ok(more.filter((y) => y < Math.max(...more) - 2 && y > more.at(-1) + 2).length >= 3, `What is included follows over several frames: ${more.join()}`);
    assert.ok(fr.filter((x) => x.side > fr[0].side + 2 && x.side < fr.at(-1).side - 2).length >= 3, "the card grows over several frames");
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
  await check(`B87 ${name}: scrolling Book and pay online into view hides the copy of the button in the summary card while the card height moves over several frames, and scrolling back brings it back the same way`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 700 }, reducedMotion: "no-preference" });
    await ctx.addInitScript(FRAMES);
    const p = await open(ctx, P, "/rates");
    await p.evaluate((x) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: x, stops: 0, return: false, step: "options" })), JFK_TRIP);
    await p.goto(`${P.base}/book#options`, { waitUntil: "load" });
    await p.waitForFunction(() => /\d/.test(document.getElementById("price-total").textContent) && !document.querySelector("#price-total .bk-sk"));
    await p.waitForTimeout(500);
    for (const [to, off] of [["center", true], ["top", false]]) {
      await p.evaluate(() => (window.__fr = []));
      await p.evaluate((t) => (t === "top" ? scrollTo(0, 0) : document.getElementById("bk-next").scrollIntoView({ block: "center" })), to);
      await frames(p, null, 500);
      const fr = await p.evaluate(() => window.__fr);
      const a = fr[0].side, z = fr.at(-1).side;
      assert.ok(fr.at(-1).off === off && Math.abs(a - z) > 30, `${to}: the card button ${off ? "hides" : "shows"}: ${a} to ${z}`);
      assert.ok(fr.filter((x) => x.side > Math.min(a, z) + 2 && x.side < Math.max(a, z) - 2).length >= 3, `${to}: the card height moves over several frames: ${fr.map((x) => x.side).join()}`);
    }
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}
{
  const ctx = await context(P, { viewport: { width: 1440, height: 1600 } });
  await check("B87 a request trip with the email button under the rows in view keeps its request line in the summary card, so the card never reads as only the class name", async () => {
    const p = await open(ctx, P, "/rates");
    await p.evaluate((x) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: x, stops: 0, return: false, step: "options" })), REQUEST_TRIP);
    await p.goto(`${P.base}/book#options`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("bk-bar").classList.contains("is-q"));
    await p.evaluate(() => document.getElementById("q-mail").scrollIntoView({ block: "center" }));
    await p.waitForTimeout(300);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-bar").classList.contains("is-off"), getComputedStyle(document.getElementById("bk-bar")).display, getComputedStyle(document.getElementById("bk-bar-q")).display, document.getElementById("bk-bar-q").textContent, getComputedStyle(document.getElementById("bk-bar-mail")).display]), [true, "flex", "block", "Our dispatch team prices this trip", "none"]);
    await p.close();
  });
  await ctx.close();
}
const WATCH = () => {
  window.__bg = [];
  const ids = ["bk-from-f", "bk-to-f", "bk-date-f", "bk-time-f"];
  const tick = () => {
    const els = ids.map((i) => document.getElementById(i));
    if (els.every(Boolean) && document.getElementById("bk-from").value) {
      window.__bg.push([Math.round(performance.now()), ...els.flatMap((e) => { const c = e.querySelector("#bk-from,#bk-to,.bk-pick"); return [getComputedStyle(e).backgroundColor, getComputedStyle(c).backgroundColor, getComputedStyle(c).color, e.className.includes("washed")]; })]);
    }
    if (performance.now() < 2500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
for (const [name, b] of ENGINES) {
  for (const path of ["/", "/book"]) {
    for (const width of [1440, 390]) {
      await check(`B88 ${name} ${path} at ${width}: after a reload with a trip restored (owner request 3) the four fields never get a box behind them, the value shows a faint gold tint that is gone within a second, and with reduced motion nothing changes at all`, async () => {
        for (const motion of ["no-preference", "reduce"]) {
          const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: motion });
          await ctx.addInitScript(WATCH);
          const p = await open(ctx, P, "/rates");
          await p.evaluate((x) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: x, stops: 0, return: false, step: "options" })), { ...JFK_TRIP, from_text: "350 5th Ave, New York, NY 10118", from_id: "", to_text: "John F. Kennedy (JFK), Terminal 4", to_id: "jfk-t4" });
          await p.goto(`${P.base}${path}`, { waitUntil: "load" });
          await p.reload({ waitUntil: "load" });
          await p.waitForTimeout(1600);
          const bg = await p.evaluate(() => window.__bg);
          assert.ok(bg.length > 10, `frames: ${bg.length}`);
          const steady = bg.at(-1);
          const boxes = bg.filter((x) => [1, 2, 5, 6, 9, 10, 13, 14].some((k) => x[k] !== "rgba(0, 0, 0, 0)"));
          assert.deepEqual(boxes.slice(0, 2), [], "no background box behind any of the four fields in any frame");
          assert.ok(bg.every((x) => [4, 8, 12, 16].every((k) => x[k] === false)), "no wash class");
          const tinted = bg.filter((x) => [3, 7, 11, 15].some((k) => x[k] !== steady[k]));
          if (motion === "reduce") assert.deepEqual(tinted, [], "reduced motion: no tint");
          else {
            assert.ok(tinted.length >= 3, "a brief tint shows");
            assert.ok(tinted.at(-1)[0] - tinted[0][0] < 1000, `the tint fades within a second: ${tinted.at(-1)[0] - tinted[0][0]} ms`);
          }
          assert.deepEqual(p.errors, []);
          await ctx.close();
        }
      });
    }
  }
  await check(`B88 ${name}: a reload of / with a stored trip, after the browser restores the form, brings back Pickup and Drop-off with the date and the time`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const p = await open(ctx, P, "/rates");
    await p.evaluate((x) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: x, stops: 0, return: false, step: "options" })), { ...JFK_TRIP, time: "14:00" });
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.waitForTimeout(500);
    await Promise.all([p.waitForNavigation({ waitUntil: "load" }), p.evaluate(() => location.reload())]);
    await p.waitForTimeout(800);
    assert.deepEqual(await p.evaluate(() => ["bk-from", "bk-from-id", "bk-to", "bk-date", "bk-time"].map((i) => document.getElementById(i).value)), [JFK_TRIP.from_text, JFK_TRIP.from_id, JFK_TRIP.to_text, JFK_TRIP.date, "14:00"]);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
  await check(`B88 ${name}: an autofilled field keeps the look of a filled field, on the glass bar and on the light card (the browser's autofill colors wait, no box is painted, the text keeps its color)`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 } });
    const p = await open(ctx, P, "/");
    const rule = await p.evaluate(() => { for (const sh of document.styleSheets) { let r; try { r = [...sh.cssRules]; } catch { continue; } const all = []; const walk = (l) => l.forEach((x) => { if (x.selectorText) all.push(x); if (x.cssRules) walk([...x.cssRules]); }); walk(r); const f = all.find((x) => x.selectorText && /autofill/.test(x.selectorText)); if (f) return f.cssText; } return ""; });
    assert.match(rule, /:(-webkit-)?autofill/);
    assert.doesNotMatch(rule, /box-shadow|text-fill|caret|background:|inset/, `the autofill rule paints nothing of its own: ${rule}`);
    const got = [];
    for (const path of ["/", "/book"]) {
      await p.goto(`${P.base}${path}`, { waitUntil: "load" });
      got.push(await p.evaluate((r) => {
        const st = document.createElement("style");
        st.textContent = `@layer x{.ua-af{background-color:#E8F0FE!important;background-image:none!important;color:#000!important}}${r.replace(/:(-webkit-)?autofill/g, ".ua-af")}`;
        document.head.append(st);
        const i = document.getElementById("bk-from");
        i.value = "350 5th Ave, New York, NY 10118";
        return new Promise((ok) => setTimeout(ok, 400)).then(() => {
        const before = [getComputedStyle(i).backgroundColor, getComputedStyle(i).color, getComputedStyle(i).boxShadow];
        i.classList.add("ua-af");
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => { const after = [getComputedStyle(i).backgroundColor, getComputedStyle(i).color, getComputedStyle(i).boxShadow]; res([before, after]); })));
        });
      }, rule));
    }
    const alpha = (c) => (/^rgba\(/.test(c) ? +c.split(",")[3].replace(")", "") : 1);
    for (const [before, after] of got) assert.deepEqual([alpha(after[0]), ...after.slice(1)], [alpha(before[0]), ...before.slice(1)], `still transparent with the same text and underline: ${after.join(" | ")}`);
    assert.deepEqual(got.map(([x]) => x[1]), ["rgb(255, 255, 255)", "rgb(15, 19, 25)"], "white text on the glass bar, ink on the card");
    await ctx.close();
  });
}
for (const [name, b, width] of [["chromium", browser, 1440], ["chromium", browser, 390], ...ENGINES.slice(1).map(([n, x]) => [n, x, 390])]) {
  await check(`B89 ${name} at ${width}: someone else riding (owner request 4): the rider's name and mobile are required, the payment step says the chauffeur contacts them and the booker gets everything by email, both reserve messages carry them, the pay post sends them and the confirmation page says the same`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: "reduce" });
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await p.click(width < 1024 ? "#bk-bar-go" : "#bk-next");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    await details(p);
    const hint = () => p.evaluate(() => document.getElementById("bk-phone-h").innerText.replace(/\s+/g, " ").trim());
    assert.equal(await hint(), "We use this number to arrange your pickup.", "with the country code picker the hint keeps one sentence");
    await p.click('label[for="bk-r-other"]');
    assert.deepEqual([await p.isVisible("#bk-pname"), await p.isVisible("#bk-pphone"), await p.innerText('label[for="bk-pphone"]').then((t) => t.replace(/\s+/g, " ").trim())], [true, true, "Passenger's mobile number"]);
    const note = () => p.evaluate(() => document.getElementById("bk-other-h").innerText.replace(/\s+/g, " ").trim());
    assert.equal(await note(), "Your chauffeur contacts the passenger on the day of the ride. Your confirmation, receipt and any changes go to your email.");
    assert.equal(await hint(), "", "the booker's mobile is not the one used for the pickup");
    await p.click("#bk-submit");
    assert.deepEqual(await p.evaluate(() => [document.activeElement.id, [...document.querySelectorAll(".bk-det .bk-e.is-on")].map((e) => e.id)]), ["bk-pname", ["e-pname", "e-pphone"]], "both rider fields are required");
    assert.equal(await p.textContent("#e-pphone"), "Add the passenger's mobile number, and check its country code.");
    await p.fill("#bk-pname", "Dana Reyes");
    assert.equal(await note(), "Your chauffeur contacts Dana Reyes on the day of the ride. Your confirmation, receipt and any changes go to your email.");
    await p.click("#bk-submit");
    assert.deepEqual(await p.evaluate(() => [document.activeElement.id, document.getElementById("bk-pphone").getAttribute("aria-invalid"), document.getElementById("bk-pphone").getAttribute("aria-describedby")]), ["bk-pphone", "true", "e-pphone bk-other-h"]);
    await p.fill("#bk-pphone", "+1 917 555 0142");
    await p.waitForTimeout(100);
    const wa = await waText(p, "#q-wa");
    const mail = decodeURIComponent((await p.getAttribute("#q-mail", "href")).split("&body=")[1] || "");
    for (const t of [wa, mail]) assert.match(t, /\nPassenger: Dana Reyes\nPassenger mobile: \+1 917 555 0142(\n|$)/, "the reserve messages carry the rider");
    const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
    const body = JSON.parse(req.postData());
    assert.deepEqual(["rider", "pname", "pphone", "pphone_cc", "name", "email"].map((k) => body[k]), ["other", "Dana Reyes", "917 555 0142", "US", ME.name, ME.email], "the +1 moved to the passenger's country code when the field was left");
    await p.waitForFunction(() => document.getElementById("cf").classList.contains("is-paid"), null, { timeout: 15000 });
    const cf = await p.evaluate(() => [document.getElementById("cf-other").hidden, document.getElementById("cf-other").textContent, [...document.querySelectorAll("#cf-rows dt")].find((d) => d.textContent === "Passenger").nextElementSibling.innerText.replace(/\s+/g, " ").trim(), document.querySelector("#cf-day span").textContent]);
    assert.deepEqual(cf, [false, "Your chauffeur contacts Dana Reyes on the day of the ride. Your confirmation, receipt and any changes go to your email.", "Dana Reyes +1 917 555 0142", "Once they have their bags, your chauffeur calls or messages them with the exact spot."]);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}
for (const [name, b] of ENGINES) {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B90 ${name} at ${width}: in step 3 choosing Inside the terminal with a name sign keeps that row where it is and opens Name for the sign right under it, in view`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await p.fill("#bk-name", ME.name);
      const row = 'label[for="bk-meet"]';
      await scrollIdle(p);
      await p.evaluate((s) => scrollBy({ top: document.querySelector(s).getBoundingClientRect().top - innerHeight * 0.4, behavior: "instant" }), row);
      await scrollIdle(p);
      const at = () => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(), f = document.getElementById("bk-sign-f"); return { top: Math.round(r.top), y: Math.round(scrollY), shown: f.classList.contains("is-shown"), gap: Math.round(f.getBoundingClientRect().top - r.bottom), bottom: Math.round(document.getElementById("bk-sign").getBoundingClientRect().bottom), room: innerHeight, sign: document.getElementById("bk-sign").value }; }, row);
      const a = await at();
      await p.click(row);
      await p.waitForFunction(() => document.getElementById("bk-sign-f").classList.contains("is-shown"));
      const c = await at();
      assert.ok(!a.shown && c.shown && Math.abs(c.top - a.top) <= 1 && c.y === a.y, JSON.stringify([a, c]));
      assert.ok(c.gap >= 0 && c.gap <= 32 && c.bottom <= c.room && c.sign === ME.name, JSON.stringify(c));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/", 1440], ["/book", 1280], ["/locations/manhattan", 1024], ["/locations/jfk-airport", 1366], ["/book", 390]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await check(`B91 ${name} ${path} at ${width}: ${width >= 1024 ? "the flight row sits under Pickup with its line beside it from Drop-off on, " : ""}one letter reserves nothing, a number that can be looked up reserves the answer's room at once${width >= 1024 ? " (2 px at most)" : ""}, and the answer fits it`, async () => {
      const p = await open(ctx, G, path);
      if (!/JFK/.test(await p.inputValue("#bk-from"))) await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
      await place(p, "to", "350 5th Ave, New York, NY 10118");
      await pickDate(p, "#bk-date-btn", DATE);
      await p.keyboard.press("Escape");
      await p.click("#bk-flight");
      await p.waitForTimeout(300);
      const geo = () => p.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(), s = r("bk-flight-status"); return { bar: Math.round(r("bk-search").height), input: Math.round(r("bk-flight").left - r("bk-from").left), line: Math.round(s.left - r("bk-to-f").left), top: Math.round(s.top - r("bk-flight-f").top) }; });
      const idle = await geo();
      if (width >= 1024) assert.deepEqual([idle.input, idle.line, idle.top], [0, 0, 0], JSON.stringify(idle));
      await p.keyboard.type("E");
      await p.waitForTimeout(200);
      const one = await geo();
      await p.keyboard.type("K201");
      const typed = await geo();
      await p.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc"), null, { timeout: 6000 });
      await p.waitForTimeout(200);
      const found = await geo();
      assert.ok(one.bar === idle.bar && typed.bar >= idle.bar && (width < 1024 || typed.bar - idle.bar <= 2) && found.bar === typed.bar, JSON.stringify({ idle, one, typed, found }));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, G, { viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  await check(`B92 ${name} at 390 with motion on: a time that adds the before-landing line under Pickup time closes its list where it stands`, async () => {
    const p = await open(ctx, G, "/book");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await p.keyboard.press("Escape");
    await p.fill("#bk-flight", "EK201");
    await p.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc"), null, { timeout: 6000 });
    await p.click("#bk-time-btn");
    await p.waitForFunction(() => getComputedStyle(document.getElementById("bk-tm")).opacity === "1");
    await scrollIdle(p);
    const o = p.locator('#bk-tm [role=option][data-v="14:00"]');
    await o.evaluate((x) => { const l = x.closest("[role=listbox]"), a = x.getBoundingClientRect(), c = l.getBoundingClientRect(); l.scrollTop += a.top - c.top - (c.height - a.height) / 2; });
    await p.evaluate(() => { const t = document.getElementById("bk-tm"); window.__tm = []; const f = () => { const s = getComputedStyle(t); if (s.display !== "none" && +s.opacity > 0.05) window.__tm.push(Math.round(t.getBoundingClientRect().top)); window.__tm.length < 60 && requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await o.click();
    await p.waitForTimeout(500);
    const [tops, hint] = await p.evaluate(() => [window.__tm, document.getElementById("bk-time-h").textContent]);
    assert.equal(hint, "This pickup is before your flight lands.");
    assert.ok(tops.length && Math.max(...tops) - Math.min(...tops) <= 6, tops.join(","));
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 }, forcedColors: "active" });
  await check(`B93 ${name} forced colors: Date and Pickup time keep an underline like Pickup and Drop-off, on the light card and on the glass bar`, async () => {
    for (const path of ["/book", "/"]) {
      const p = await open(ctx, P, path);
      const u = await p.evaluate(() => ["bk-from", "bk-to", "bk-date-btn", "bk-time-btn"].map((id) => { const c = getComputedStyle(document.getElementById(id)); return [c.borderBottomStyle, parseFloat(c.borderBottomWidth) >= 1]; }));
      assert.deepEqual(u, Array(4).fill(["solid", true]), path);
      await p.close();
    }
  });
  await ctx.close();
}
for (const [name, b] of ENGINES) {
  for (const width of [320, 340, 356]) {
    const ctx = await engineContext(b, P, { viewport: { width, height: 800 }, javaScriptEnabled: false });
    await check(`B94 ${name} without javascript at ${width}: every field stays inside the booking card, Choose your vehicle is one line with Passengers under it, and WCAG text spacing scrolls nothing sideways`, async () => {
      for (const path of ["/book", "/", "/locations/jfk-airport"]) {
        const p = await open(ctx, P, path);
        const fit = () => p.evaluate(() => { const f = document.getElementById("book-form"), edge = f.getBoundingClientRect().right - parseFloat(getComputedStyle(f).paddingRight) + 0.5, h = document.getElementById("bk-opt-h"); return { out: [...f.querySelectorAll(".field input:not([type=hidden]), .field select, .field textarea")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > edge).map((e) => e.id), h2: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)), pax: document.getElementById("bk-pax-f").getBoundingClientRect().top >= h.getBoundingClientRect().bottom, side: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
        assert.deepEqual(await fit(), { out: [], h2: 1, pax: true, side: 0 }, path);
        await p.evaluate(() => { const s = document.createElement("style"); s.textContent = "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}"; document.head.append(s); });
        assert.equal((await fit()).side, 0, `${path} with text spacing`);
        await p.close();
      }
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.__cls = 0; if ((PerformanceObserver.supportedEntryTypes || []).includes("layout-shift")) new PerformanceObserver((l) => { for (const e of l.getEntries()) e.hadRecentInput || (window.__cls += e.value); }).observe({ type: "layout-shift", buffered: true }); });
  await check(`B95 ${name} airport pages at 390 with pay.js held back 700 ms: the flight row has its final height from the first paint, so the late script moves nothing`, async () => {
    for (const path of ["/locations/jfk-airport", "/locations/laguardia-airport"]) {
      const p = await ctx.newPage();
      await p.route(/\/assets\/pay\.[\w-]+\.js$/, async (r) => { await new Promise((x) => setTimeout(x, 700)); await r.continue(); });
      await p.goto(`${P.base}${path}`, { waitUntil: "commit" });
      await p.waitForFunction(() => { const f = document.getElementById("book-form"); return f && getComputedStyle(f).containerType === "inline-size" && document.getElementById("bk-view"); });
      await p.waitForTimeout(150);
      const at = () => p.evaluate(() => [document.getElementById("book-form").classList.contains("is-js"), getComputedStyle(document.getElementById("bk-flight-status")).display, Math.round(document.getElementById("bk-view").getBoundingClientRect().top)]);
      const early = await at();
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await p.waitForTimeout(400);
      const late = await at();
      const v = await p.evaluate(() => window.__cls);
      assert.ok(!early[0] && early[1] === "none" && late[1] === "none" && early[2] === late[2] && v === 0, JSON.stringify([path, early, late, v]));
      await p.close();
    }
  });
  await ctx.close();
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 }, contrast: "more" });
  await check(`B96 ${name} with more contrast: the flight line and the list's second lines are white on the dark glass bar and ink on the light card`, async () => {
    for (const [path, want] of [["/", "rgb(255, 255, 255)"], ["/book", "rgb(15, 19, 25)"]]) {
      const p = await open(ctx, P, path);
      await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
      await p.click("#bk-to");
      await p.keyboard.type("lga");
      await p.waitForSelector("#bk-to-list .bk-opt__sub");
      assert.deepEqual(await p.evaluate(() => ["#bk-flight-status", "#bk-to-list .bk-opt__sub"].map((s) => getComputedStyle(document.querySelector(s)).color)), [want, want], path);
      await p.close();
    }
  });
  await ctx.close();
}
for (const [name, b] of ENGINES) {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B97 ${name} at ${width}: after Inside the terminal with a name sign and a typed name, Back to vehicles hides Name for the sign with Where we meet, and the payment step shows both again with the name`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await p.click('label[for="bk-meet"]');
      await p.waitForFunction(() => document.getElementById("bk-sign-f").classList.contains("is-shown"));
      await p.fill("#bk-sign", ME.name);
      const seen = () => p.evaluate(() => ["bk-meet-f", "bk-sign-f", "bk-signcard"].map((i) => document.getElementById(i).getClientRects().length > 0));
      await p.click("#bk-back");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
      const back = await seen();
      await next(p);
      assert.deepEqual([back, await seen(), await p.inputValue("#bk-sign")], [[false, false, false], [true, true, true], ME.name]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, G, { viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  await check(`B98 ${name} with motion on, the drop-off at 390 and the pickup at 600 by 800, where the hero leaves room above it: a place list that opened above its field closes where it stands when a place is picked`, async () => {
    for (const [end, width, height] of [["to", 390, 844], ["from", 600, 800]]) {
      const p = await open(ctx, G, "/");
      await p.setViewportSize({ width, height });
      await p.click("#bk-view");
      await p.waitForFunction(() => document.getElementById("e-from").classList.contains("is-on"));
      await p.focus(`#bk-${end}`);
      await scrollIdle(p);
      await p.evaluate((e) => { const h = document.documentElement; h.style.scrollBehavior = "auto"; scrollBy(0, document.getElementById(`bk-${e}-f`).getBoundingClientRect().top - innerHeight * 0.7); h.style.scrollBehavior = ""; }, end);
      await scrollIdle(p);
      await p.keyboard.type("edition");
      const o = p.locator(`#bk-${end}-list [role=option]:has-text("The New York EDITION")`).first();
      await o.waitFor();
      await p.waitForFunction((e) => getComputedStyle(document.getElementById(`bk-${e}-pop`)).opacity === "1", end);
      assert.ok(await p.evaluate((e) => document.getElementById(`bk-${e}-f`).classList.contains("is-up"), end), `${end}: the list opens above the field`);
      await p.evaluate((e) => { const l = document.getElementById(`bk-${e}-pop`); window.__lt = []; const t0 = performance.now(); const f = () => { const s = getComputedStyle(l); if (s.display !== "none" && +s.opacity > 0.05) window.__lt.push(Math.round(l.getBoundingClientRect().top + scrollY)); performance.now() - t0 < 700 && requestAnimationFrame(f); }; requestAnimationFrame(f); }, end);
      await o.click();
      await p.waitForTimeout(800);
      const tops = await p.evaluate(() => window.__lt);
      assert.ok(tops.length && Math.max(...tops) - Math.min(...tops) <= 6, `${end}: ${tops.join(",")}`);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
  await ctx.close();
}
const LONG = { airline: "Lufthansa", number: "LH 400", origin: { city: "Frankfurt-am-Main", iata: "FRA" }, destination: { city: "New York", iata: "JFK" }, terminal: "1", scheduled: `${DATE} 12:55`, estimated: `${DATE} 13:40`, status: "Delayed", updated: "" };
const LATE = { airline: "Emirates", number: "EK 205", origin: { city: "Dubai", iata: "DXB" }, destination: { city: "New York", iata: "JFK" }, terminal: "8", scheduled: `${DATE} 23:55`, estimated: `${nyDate(4)} 00:40`, status: "Delayed", updated: "" };
async function answerWith(p, answers) {
  await p.route("**/api/flight", (route) => { const d = JSON.parse(route.request().postData() || "{}"); return d.probe || !answers[d.number] ? route.continue() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "ok", flight: answers[d.number] }) }); });
  if (!/JFK/.test(await p.inputValue("#bk-from"))) await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
  await place(p, "to", "350 5th Ave, New York, NY 10118");
  await pickDate(p, "#bk-date-btn", DATE);
  await p.keyboard.press("Escape");
}
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/", 768], ["/book", 768], ["/locations/jfk-airport", 700], ["/locations/manhattan", 900]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await check(`B99 ${name} ${path} at ${width}: on a tablet a number that can be looked up reserves 101px, not 137, and a delayed long-origin answer with two buttons and an overnight one both fit it`, async () => {
      const p = await open(ctx, G, path);
      await answerWith(p, { LH400: LONG, EK205: LATE });
      const out = [];
      for (const [num, text] of [["LH400", "Delayed."], ["EK205", "Pick up at Terminal 8"]]) {
        await p.fill("#bk-flight", num);
        await p.waitForFunction((t) => document.getElementById("bk-flight-status").textContent.includes(t), text, { timeout: 6000 });
        await p.waitForTimeout(200);
        out.push([num, ...(await p.evaluate(() => { const s = document.getElementById("bk-flight-status"); return [parseFloat(getComputedStyle(s).minHeight), Math.round(s.getBoundingClientRect().height)]; }))]);
      }
      assert.ok(out.every(([, r, h]) => r <= 101 && h === r), JSON.stringify(out));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/", 960], ["/locations/manhattan", 960], ["/book", 984], ["/book", 1024]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await check(`B100 ${name} ${path} at ${width}: a delayed long-origin answer with two buttons fits the flight row's reserve, so the bar keeps its height when it lands${width >= 1024 ? ", and the reserve adds 2 px at most" : ""}`, async () => {
      const p = await open(ctx, G, path);
      await answerWith(p, { LH400: LONG });
      const bar = () => p.evaluate(() => Math.round(document.getElementById("bk-search").getBoundingClientRect().height));
      await p.click("#bk-flight");
      const idle = await bar();
      await p.keyboard.type("LH400");
      await p.waitForFunction(() => document.getElementById("bk-flight-status").classList.contains("is-on"));
      const typed = await bar();
      await p.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("Pick up at Terminal 1"), null, { timeout: 6000 });
      await p.waitForTimeout(200);
      const found = await bar();
      assert.ok(found === typed && (width < 1024 || typed - idle <= 2), JSON.stringify({ idle, typed, found }));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
const LONG2 = { ...LONG, number: "LH 405", scheduled: `${DATE} 23:55`, estimated: `${nyDate(4)} 00:40` };
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/", 320], ["/locations/jfk-airport", 330], ["/", 340], ["/book", 390], ["/", 1000], ["/book", 1000], ["/locations/manhattan", 1024], ["/book", 1024], ["/book", 1040]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await check(`B116 ${name} ${path} at ${width}: a delayed answer that lands after midnight says Set pickup to with the time and gives the day to screen readers, fits the flight row's reserve with two buttons${width < 1024 ? ", a long origin too," : ""} so the bar keeps its height when it lands, and keeps its own height when it is pressed`, async () => {
      const p = await open(ctx, G, path);
      await answerWith(p, { EK205: LATE, LH405: LONG2 });
      const bar = () => p.evaluate(() => Math.round(document.getElementById("bk-search").getBoundingClientRect().height));
      const out = [];
      for (const num of width < 1024 ? ["EK205", "LH405"] : ["EK205"]) {
        await p.fill("#bk-flight", "");
        await p.click("#bk-flight");
        await p.keyboard.type(num);
        await p.waitForFunction(() => document.getElementById("bk-flight-status").classList.contains("is-on"));
        const typed = await bar();
        await p.waitForFunction(() => document.querySelector("#bk-flight-status button[data-d]"), null, { timeout: 6000 });
        await p.waitForTimeout(200);
        out.push([num, typed, await bar()]);
      }
      assert.ok(out.every(([, t, f]) => t === f), JSON.stringify(out));
      const day = await p.evaluate(() => fd(document.querySelector("#bk-flight-status button[data-d]").dataset.d));
      const btn = p.locator("#bk-flight-status button[data-d]");
      assert.deepEqual([await btn.evaluate((x) => x.firstChild.data), await p.getByRole("button", { name: `Set pickup to 12:40 AM on ${day}`, exact: true }).count()], ["Set pickup to 12:40 AM", 1]);
      const box = () => p.evaluate(() => Math.round(document.getElementById("bk-flight-status").getBoundingClientRect().height));
      const before = await box();
      await btn.click();
      await p.waitForTimeout(200);
      assert.deepEqual(await p.evaluate(() => { const x = document.querySelector("#bk-flight-status button[data-d]"); return [ED.value, ET.value, x.firstChild.data, x.textContent, x.getAttribute("aria-disabled"), document.getElementById("bk-status").textContent]; }), [nyDate(4), "00:40", "Pickup set to 12:40 AM", `Pickup set to 12:40 AM on ${day}`, "true", `Pickup time set to ${day}, 12:40 AM.`]);
      assert.equal(await box(), before);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
const RD = nyDate(5), RET = (o) => ({ airline: "Lufthansa", origin: { city: "Frankfurt-am-Main", iata: "FRA" }, destination: { city: "New York", iata: "JFK" }, terminal: "1", estimated: "", status: "Expected", updated: "", ...o });
const RETURNS = { LH400: { kind: "ok", flight: RET({ number: "LH 400", scheduled: `${RD} 12:55`, estimated: `${RD} 13:40`, status: "Delayed" }) }, LH405: { kind: "ok", flight: RET({ number: "LH 405", scheduled: `${RD} 23:55`, estimated: `${nyDate(6)} 00:40`, status: "Delayed" }) }, LH402: { kind: "elsewhere", flight: RET({ number: "LH 402", destination: { city: "Newark", iata: "EWR" }, terminal: "B", scheduled: `${RD} 12:55` }) }, LH403: { kind: "none" } };
for (const [name, b] of ENGINES) {
  for (const [path, width] of [["/", 928], ["/", 1024], ["/locations/manhattan", 1100], ["/", 1440], ["/book", 984], ["/book", 1280]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await check(`B117 ${name} ${path} at ${width}: from 55rem the return flight number opens its answer's room while it is typed, so EK 201, a delayed, an overnight, an elsewhere and a not-found answer land without moving the bar`, async () => {
      const p = await open(ctx, G, path);
      await p.route("**/api/flight", (route) => { const d = JSON.parse(route.request().postData() || "{}"); return d.probe || !RETURNS[d.number] ? route.continue() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RETURNS[d.number]) }); });
      await place(p, "from", "350 5th Ave, New York, NY 10118");
      await place(p, "to", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
      await pickDate(p, "#bk-date-btn", DATE);
      await p.keyboard.press("Escape");
      await p.click("#bk-addret");
      await pickDate(p, "#bk-rdate-btn", RD);
      await p.keyboard.press("Escape");
      const bar = () => p.evaluate(() => Math.round(document.getElementById("bk-search").getBoundingClientRect().height));
      const out = [];
      for (const [num, text] of [["EK201", "EK 201 from Dubai"], ["LH400", "Delayed."], ["LH405", "now "], ["LH402", "Check the pickup airport."], ["LH403", "Check the number"]]) {
        await p.fill("#bk-rflight", "");
        await p.click("#bk-rflight");
        await p.keyboard.type(num);
        await p.waitForFunction(() => document.getElementById("bk-rflight-status").classList.contains("is-on"));
        const typed = await bar();
        await p.waitForFunction((t) => document.getElementById("bk-rflight-status").textContent.includes(t), text, { timeout: 6000 });
        await p.waitForTimeout(200);
        out.push([num, typed, await bar()]);
      }
      assert.ok(out.every(([, t, f]) => t === f), JSON.stringify(out));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
const nyOff = (ms) => Date.parse(nyClock(ms).replace(" ", "T") + "Z") - Math.floor(ms / 6e4) * 6e4;
const nyAt = (date, time) => { const g = Date.parse(`${date}T${time}Z`); return g - nyOff(g - nyOff(g)); };
async function openAt(ctx, server, path, time) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to (load resource|preconnect)/.test(m.text()) && page.errors.push(m.text()));
  await page.clock.install({ time });
  await page.goto(`${server.base}${path}`, { waitUntil: "load" });
  return page;
}
const posts = (p) => { const a = []; p.on("request", (r) => r.url().endsWith("/api/book") && r.method() === "POST" && a.push(JSON.parse(r.postData() || "{}"))); return a; };
const dollars = (c) => "$" + (c / 100).toLocaleString("en-US");
const TIP_HINT = `From ${dollars(TIP_CUSTOM.min)} to ${dollars(TIP_CUSTOM.max)}.`;
const TIP_ERROR = `Type an amount from ${dollars(TIP_CUSTOM.min)} to ${dollars(TIP_CUSTOM.max)}, or choose None.`;
const WA_HELLO = "Hi NYC LUX RIDE, I'd like to book a ride.";
const chipText = (p) => p.$$eval("#bk-tip-opts label", (l) => l.map((x) => [...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")));
const lastGratuity = (p) => panel(p).then((x) => x.lines.filter(([l]) => /^Gratuity/.test(l)));

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const touch = width < 1024;
  const ctx = await context(P, { viewport: { width, height }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  await check(`B101 at ${width}, the gratuity Other (owner request 1): the five chips in order, Other read as Other amount, a ${touch ? "tap" : "click"} on Other opens the whole dollar amount with its hint and focus while the arrows stay in the chips, the price follows 400 ms after the last key, $40, 40.00 and 040 read as 40 and show as 40 once the field is left, 0 counts as None, and every request carries the chosen tip even while the price is hidden`, async () => {
    const p = await open(ctx, P, "/book");
    const sent = posts(p);
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    assert.deepEqual(await chipText(p), ["None", "Other", "20%", "15%", "10%"]);
    assert.deepEqual([await p.getByRole("radio", { name: "Other amount" }).count(), await p.isChecked("#bk-t-0"), await p.isVisible("#bk-tipamt")], [1, true, false]);
    await p.focus("#bk-t-0");
    await p.keyboard.press("ArrowRight");
    await p.waitForFunction(() => document.getElementById("bk-t-custom").checked);
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.isVisible("#bk-tipamt"), await p.textContent("#bk-tipamt-h"), await p.textContent('label[for="bk-tipamt"]')], ["bk-t-custom", true, TIP_HINT, "Amount in dollars"], "an arrow key chooses Other, shows the amount and keeps focus in the chips");
    assert.deepEqual(await p.evaluate(() => { const i = document.getElementById("bk-tipamt"); return [i.inputMode, i.getAttribute("pattern"), i.getAttribute("aria-describedby"), getComputedStyle(i.parentElement, "::before").content.replace(/\s*\/\s*""$/, "")]; }), ["numeric", "[0-9]*", "bk-tipamt-h", '"$"'], "a number keypad, the hint read with the field and a dollar sign in front");
    await p.keyboard.press("ArrowLeft");
    await p.waitForFunction(() => document.getElementById("bk-t-0").checked);
    assert.equal(await p.isVisible("#bk-tipamt"), false, "None hides the amount");
    await priced(p);
    if (touch) await p.tap('label[for="bk-t-custom"]');
    else await p.click('label[for="bk-t-custom"]');
    await p.waitForFunction(() => document.activeElement.id === "bk-tipamt", null, { timeout: 3000 });
    await priced(p);
    const n0 = sent.length;
    await p.keyboard.type("40");
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + 4000));
    assert.deepEqual(await lastGratuity(p), [["Gratuity for your chauffeur", "$40.00"]]);
    assert.deepEqual([await p.$eval("#bk-tot-v", (x) => x.firstChild.textContent), ...(touch ? [] : [await p.$eval("#bk-side #price-total", (x) => x.firstChild.textContent)])], [cash(TOTAL + 4000), ...(touch ? [] : [cash(TOTAL + 4000)])], "the total above the buttons and the side card follow");
    assert.deepEqual(sent.slice(n0).filter((b) => b.tip === "custom").map((b) => [b.action, b.tip_amount]), [["quote", "40"]], "one price request after the last key, with the amount");
    for (const v of ["$40", "40.00", "040", "40."]) {
      const n = sent.length;
      await p.fill("#bk-tipamt", v);
      await p.waitForTimeout(700);
      assert.deepEqual([sent.length - n, await p.$eval("#price-total", (x) => (x.firstChild || {}).textContent)], [0, cash(TOTAL + 4000)], `${v} reads as 40, so the price stays and no request goes out`);
      await p.click("#bk-name");
      await p.waitForFunction(() => document.getElementById("bk-tipamt").value === "40", null, { timeout: 3000 });
      assert.deepEqual([sent.length - n, await p.isVisible("#e-tip_amount")], [0, false], `leaving the field shows ${v} as 40, so the dollar sign in front is never doubled`);
    }
    await p.fill("#bk-tipamt", "0");
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL));
    assert.deepEqual([await lastGratuity(p), sent.at(-1).tip, "tip_amount" in sent.at(-1)], [[], "0", false], "0 counts as None");
    await p.click("#bk-name");
    await p.waitForTimeout(300);
    assert.deepEqual([await p.isVisible("#e-tip_amount"), await p.getAttribute("#bk-tipamt", "aria-invalid")], [false, null], "0 is no error");
    await p.fill("#bk-tipamt", "");
    await p.click("#bk-back");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(p);
    let n = sent.length;
    await pax(p, 2);
    await priced(p);
    const o1 = sent.slice(n).find((b) => b.action === "options");
    assert.deepEqual([o1 && o1.tip, o1 && "tip_amount" in o1], ["0", false], "while the amount is empty an options request carries no gratuity");
    await pax(p, 1);
    await priced(p);
    await next(p);
    await priced(p);
    assert.deepEqual([await p.isChecked("#bk-t-custom"), await p.isVisible("#bk-tipamt"), await p.inputValue("#bk-tipamt")], [true, true, ""]);
    await p.fill("#bk-tipamt", "40");
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + 4000));
    await p.click("#bk-back");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(p);
    await pax(p, 6);
    await priced(p);
    n = sent.length;
    await p.click('label[for="bk-c-suv"]');
    await p.waitForFunction(() => document.getElementById("price").hidden && document.getElementById("bk-tip").disabled);
    await p.waitForSelector("#q-seats.is-on");
    await p.waitForTimeout(400);
    const q1 = sent.slice(n);
    assert.ok(q1.length >= 1 && q1.every((b) => b.tip === "custom" && b.tip_amount === "40"), `a request made while the price is hidden still carries Other and 40: ${JSON.stringify(q1.map((b) => [b.action, b.tip, b.tip_amount]))}`);
    n = sent.length;
    await pax(p, 5);
    await priced(p);
    const o2 = sent.slice(n).find((b) => b.action === "options");
    assert.deepEqual([o2 && o2.tip, o2 && o2.tip_amount], ["custom", "40"], "the next options request still carries Other and 40");
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check(`B101 at ${width}, the gratuity Other: the pay button checks the amount (empty, 501, 40.5 and abc) with its message as wide as the gratuity box, focus and summary link, None takes it out of the summary, a typed mistake shows on leaving the field, 20% hides the field and Other brings 40 back, the messages say Gratuity: $40.00, the pay post carries custom and 40, and the confirmation shows the line with a skeleton of the same rows and CLS 0`, async () => {
    const p = await open(ctx, P, "/book");
    const sent = posts(p);
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await details(p);
    await p.click('label[for="bk-t-custom"]');
    await priced(p);
    for (const v of ["", "501", "40.5", "abc"]) {
      await p.fill("#bk-tipamt", v);
      await p.waitForTimeout(500);
      await priced(p);
      await p.click(await payBtn(p));
      await p.waitForFunction(() => document.getElementById("e-tip_amount").classList.contains("is-on"));
      assert.deepEqual([await p.textContent("#e-tip_amount"), await p.evaluate(() => document.activeElement.id), await p.getAttribute("#bk-tipamt", "aria-invalid"), await p.textContent("#bk-status"), new URL(p.url()).pathname], [TIP_ERROR, "bk-tipamt", "true", "1 thing to fix: gratuity amount.", "/book"], `${JSON.stringify(v)} is not a whole dollar amount in range`);
    }
    const fit = await p.evaluate(() => { const e = document.getElementById("e-tip_amount"), w = (x) => Math.round(x.getBoundingClientRect().width); return [w(e) === w(document.getElementById("bk-tip")), w(document.querySelector(".bk-tipamt__in")), Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))]; });
    assert.ok(fit[0] && fit[1] === 192 && fit[2] <= (width < 1024 ? 2 : 1), `the message takes the width of the gratuity box and only the amount stays 12rem wide: ${JSON.stringify(fit)}`);
    await p.fill("#bk-email", "");
    await p.click(await payBtn(p));
    await p.waitForFunction(() => !document.getElementById("bk-errs").hidden);
    assert.deepEqual(await p.$$eval("#bk-errs a", (a) => a.map((x) => [x.getAttribute("href"), x.textContent])), [["#bk-email", "Add your email address, for example name@example.com."], ["#bk-tipamt", TIP_ERROR]], "the summary lists the gratuity amount after the details");
    assert.equal(await p.textContent("#bk-status"), "2 things to fix: email and gratuity amount.");
    await p.click('#bk-errs a[href="#bk-tipamt"]');
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-tipamt");
    await p.click('label[for="bk-t-0"]');
    await p.waitForFunction(() => !document.getElementById("e-tip_amount").classList.contains("is-on"), null, { timeout: 3000 });
    assert.deepEqual([await p.$$eval("#bk-errs a", (a) => a.map((x) => x.getAttribute("href"))), await p.textContent("#bk-errs p"), await p.getAttribute("#bk-tipamt", "aria-invalid")], [["#bk-email"], "1 thing to fix", null], "None, as the message says, takes the amount out of the summary");
    await p.click('label[for="bk-t-custom"]');
    await p.waitForFunction(() => document.activeElement.id === "bk-tipamt", null, { timeout: 3000 });
    await p.fill("#bk-email", ME.email);
    await p.fill("#bk-tipamt", "4o");
    await p.click("#bk-name");
    await p.waitForFunction(() => document.getElementById("e-tip_amount").classList.contains("is-on"));
    assert.equal(await p.textContent("#e-tip_amount"), TIP_ERROR, "a typed mistake shows when the field is left");
    await p.fill("#bk-tipamt", "40");
    await p.waitForFunction(() => !document.getElementById("e-tip_amount").classList.contains("is-on"));
    assert.equal(await p.getAttribute("#bk-tipamt", "aria-invalid"), null, "a valid amount clears it at once");
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + 4000));
    await p.click('label[for="bk-t-20"]');
    await priced(p);
    assert.deepEqual([await p.isVisible("#bk-tipamt"), await lastGratuity(p)], [false, [["Gratuity for your chauffeur (20%)", cash(percentCents(FARE, "20"))]]]);
    await p.click('label[for="bk-t-custom"]');
    await p.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t, cash(TOTAL + 4000));
    assert.deepEqual([await p.isVisible("#bk-tipamt"), await p.inputValue("#bk-tipamt")], [true, "40"], "Other brings back what was typed");
    await p.waitForTimeout(400);
    const wa = await waText(p, "#q-wa"), mail = decodeURIComponent((await p.getAttribute("#q-mail", "href")).split("&body=")[1] || "");
    for (const t of [wa, mail]) assert.match(t, /\nVehicle: Business SUV\nGratuity: \$40\.00\nTotal shown: \$225\.00\n/, "both messages carry the typed gratuity");
    await p.route("**/api/book?session_id=*", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue().catch(() => {}); });
    const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    const body = JSON.parse(req.postData());
    assert.deepEqual([body.tip, body.tip_amount], ["custom", "40"]);
    const rows = await p.$$eval("#cf-lines tr", (r) => r.map((x) => x.cells[0].textContent));
    assert.deepEqual(rows, ["Fare", "NYC sales tax", "Black Car Fund", "Tolls and airport fees", "Gratuity for your chauffeur"], "the skeleton already has the gratuity row");
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    await p.waitForTimeout(300);
    assert.deepEqual(await p.$$eval("#cf-lines tr", (r) => r.map((x) => [x.cells[0].textContent, x.cells[1].textContent])), [...AIRPORT_LINES, ["Gratuity for your chauffeur", "$40.00"]]);
    assert.equal(await p.textContent("#cf-total"), cash(TOTAL + 4000));
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check(`B101 at ${width}, a wrong amount still in the field when the rider ${touch ? "taps" : "clicks"} Book and pay online or Email to reserve: the press lands on the button, then the message shows under the amount, Book and pay online moves focus to it and Email to reserve opens the email`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await details(p);
    await p.evaluate(() => document.getElementById("q-mail").addEventListener("click", (e) => e.preventDefault()));
    if (touch) await p.tap('label[for="bk-t-custom"]');
    else await p.click('label[for="bk-t-custom"]');
    await p.waitForFunction(() => document.activeElement.id === "bk-tipamt", null, { timeout: 3000 });
    await p.keyboard.type("501");
    await p.waitForTimeout(500);
    const press = (sel) => (touch ? p.tap(sel) : p.click(sel));
    assert.equal(await p.isVisible("#e-tip_amount"), false, "no message while the amount is being typed");
    await press("#bk-submit");
    await p.waitForFunction(() => document.getElementById("bk-status").textContent === "1 thing to fix: gratuity amount.", null, { timeout: 3000 });
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.isVisible("#e-tip_amount"), new URL(p.url()).pathname], ["bk-tipamt", true, "/book"], "the press reached Book and pay online, which checks the amount and moves focus to it");
    await p.fill("#bk-tipamt", "40");
    await p.waitForFunction(() => !document.getElementById("e-tip_amount").classList.contains("is-on"));
    await p.fill("#bk-tipamt", "abc");
    await p.waitForTimeout(500);
    assert.equal(await p.isVisible("#e-tip_amount"), false, "a new mistake shows no message before the field is left");
    await press("#q-mail");
    await p.waitForFunction(() => !document.getElementById("q-sent").hidden, null, { timeout: 3000 });
    assert.equal(await p.textContent("#q-sent b"), "Your email app should open with the trip.", "the press reached Email to reserve");
    await p.waitForFunction(() => document.getElementById("e-tip_amount").classList.contains("is-on"), null, { timeout: 3000 });
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  await check("B102 one line under the amount and under each mobile number: the row draws it at rest, darker once a number is typed, 2 px on hover and focus, red when invalid, 3 px when invalid with focus, the hover never replacing the red, at 390 and 1440, and in forced colors a 1 px system line on the row only with the face and the focus outline in Highlight", async () => {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const p = await open(ctx, P, "/book");
      await p.setViewportSize(vp);
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await priced(p);
      await p.click('label[for="bk-t-custom"]');
      await p.check("#bk-r-other");
      const look = (input) => p.evaluate((id) => {
        const i = document.getElementById(id), r = i.closest(".bk-row"), ci = getComputedStyle(i), cr = getComputedStyle(r);
        const m = cr.boxShadow.match(/inset 0px (-?\d+)px/) || cr.boxShadow.match(/(-?\d+)px\s*0px\s*inset|0px (-?\d+)px 0px 0px inset/);
        const px = (s) => { const x = s.match(/(-?\d+(?:\.\d+)?)px/g) || []; return x.map(parseFloat); };
        return { input: [ci.boxShadow, parseFloat(ci.borderBottomWidth) || 0], row: cr.boxShadow, rowB: parseFloat(cr.borderBottomWidth) || 0, ink: cr.boxShadow.replace(/\s*-?\d+(\.\d+)?px/g, "").replace("inset", "").trim(), w: Math.max(0, ...px(cr.boxShadow).map((v) => -v)) };
      }, input);
      for (const id of ["bk-tipamt", "bk-phone", "bk-pphone"]) {
        const rest = await look(id);
        assert.deepEqual([rest.input, rest.w, rest.rowB], [["none", 0], 1, 0], `${id} ${vp.width} at rest: the input draws nothing, the row one 1 px line ${JSON.stringify(rest)}`);
        if (vp.width >= 1024) {
          await p.hover(`#${id}`);
          const hov = await look(id);
          assert.deepEqual([hov.input, hov.w], [["none", 0], 2], `${id} hover ${JSON.stringify(hov)}`);
        }
        await p.focus(`#${id}`);
        const foc = await look(id);
        assert.deepEqual([foc.input, foc.w], [["none", 0], 2], `${id} focus ${JSON.stringify(foc)}`);
        assert.notEqual(foc.ink, rest.ink, `${id}: focus turns the line gold`);
        await p.evaluate((x) => document.getElementById(x).setAttribute("aria-invalid", "true"), id);
        const bad = await look(id);
        assert.deepEqual([bad.input, bad.w], [["none", 0], 3], `${id} invalid with focus ${JSON.stringify(bad)}`);
        await p.focus("#bk-name");
        const bad2 = await look(id);
        assert.deepEqual([bad2.input, bad2.w], [["none", 0], 2], `${id} invalid ${JSON.stringify(bad2)}`);
        if (vp.width >= 1024) {
          await p.hover(`#${id}`);
          const bh = await look(id);
          assert.deepEqual([bh.w, bh.ink], [2, bad2.ink], `${id}: hover keeps the red line ${JSON.stringify(bh)}`);
          await p.mouse.move(0, 0);
        }
        await p.evaluate((x) => document.getElementById(x).removeAttribute("aria-invalid"), id);
      }
      await p.fill("#bk-phone", "212 555 0100");
      await p.focus("#bk-name");
      const filled = await look("bk-phone"), empty = await look("bk-pphone");
      assert.ok(filled.w === 1 && filled.ink !== empty.ink, `a typed number darkens its line: ${filled.ink} ${empty.ink}`);
      await p.emulateMedia({ forcedColors: "active" });
      for (const id of ["bk-tipamt", "bk-phone", "bk-pphone"]) {
        const fc = await look(id);
        assert.deepEqual([fc.input[1], fc.rowB], [0, 1], `${id} forced colors: one system line on the row ${JSON.stringify(fc)}`);
      }
      assert.deepEqual(await p.evaluate(() => { const f = document.getElementById("bk-phone-face"); return [getComputedStyle(f).display, f.getBoundingClientRect().width > 40, getComputedStyle(document.getElementById("bk-phone-cc")).opacity]; }), ["flex", true, "0"], "forced colors keep the face, the select stays invisible over it");
      await p.focus("#bk-phone-cc");
      await p.keyboard.press("Shift+Tab");
      await p.keyboard.press("Tab");
      assert.equal(await p.evaluate(() => document.activeElement.id), "bk-phone-cc");
      assert.deepEqual(await p.evaluate(() => { const c = getComputedStyle(document.querySelector("#bk-phone-f .bk-cc")); return [c.outlineStyle, parseFloat(c.outlineWidth) >= 2]; }), ["solid", true], "the keyboard focus ring is drawn on the face");
      await p.emulateMedia({ forcedColors: "none" });
      assert.deepEqual(await p.evaluate(() => ["bk-phone-cc", "bk-pphone-cc"].map((id) => getComputedStyle(document.getElementById(id)).fontSize)), ["16px", "16px"], "the selects keep 16px, so iOS does not zoom");
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  });
  await ctx.close();
}

for (const width of [320, 340, 359, 360, 375, 390]) {
  const ctx = await context(P, { viewport: { width, height: 844 } });
  await check(`B103 at ${width}, the five gratuity chips stay in one row with targets of at least 44 by 44 px, the mobile row and the amount fit with no sideways scroll`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await p.click('label[for="bk-t-custom"]');
    await p.check("#bk-r-other");
    await p.waitForTimeout(200);
    const rows = await p.$$eval("#bk-tip-opts label", (l) => new Set(l.map((x) => Math.round(x.getBoundingClientRect().top))).size);
    assert.equal(rows, 1, `${rows} rows`);
    assert.ok(await p.$$eval("#bk-tip-opts label", (l) => l.every((x) => x.getBoundingClientRect().width >= 44 && x.getBoundingClientRect().height >= 44)), "every chip is at least 44 by 44 px");
    assert.ok((await overflow(p)) <= 0, `overflow ${await overflow(p)}`);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll(".bk-tel")].every((r) => r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().right <= document.documentElement.clientWidth)), "the country face and the number fit their row");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  const cases = [
    ["2026-10-19T10:46:20-04:00", "2026-10-19", "12:00", "Today", "12:00 PM"],
    ["2026-10-19T10:55:01-04:00", "2026-10-19", "12:10", "Today", "12:10 PM"],
    ["2026-10-19T22:46:00-04:00", "2026-10-20", "00:00", "Tomorrow", "12:00 AM"],
    ["2026-12-31T23:30:00-05:00", "2027-01-01", "00:40", "Tomorrow", "12:40 AM"],
    ["2026-11-01T00:30:00-04:00", "2026-11-01", "02:00", "Today", "2:00 AM"],
    ["2027-03-14T00:58:00-05:00", "2027-03-14", "03:10", "Today", "3:10 AM"],
  ];
  await check("B104 the pickup date and time fill in by themselves (owner request 2) with the first 10 minute slot at least MIN_NOTICE_HOURS and AUTO_LEAD_MINUTES ahead outside a clock change hour, labeled Today or Tomorrow, with no request on load, on /book and on /", async () => {
    for (const [now, date, time, day, label] of cases) {
      for (const path of ["/book", "/"]) {
        ctx.api.length = 0;
        const p = await openAt(ctx, P, path, new Date(now));
        await p.waitForTimeout(200);
        const s = await p.evaluate(() => [document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("bk-date-btn").textContent.trim(), document.getElementById("bk-time-btn").textContent.trim(), document.getElementById("bk-date-btn").classList.contains("is-ph"), document.getElementById("bk-time-btn").classList.contains("is-ph"), AD, AT, document.getElementById("bk-status").textContent]);
        assert.deepEqual(s, [date, time, day, label, false, false, 1, 1, ""], `${now} on ${path}`);
        assert.deepEqual(ctx.api, [], `${now} on ${path}: no request on load`);
        assert.deepEqual(p.errors, []);
        await p.close();
      }
    }
  });
  await check("B104 without javascript the date and the time start empty and required", async () => {
    const nojs = await context(P, { javaScriptEnabled: false });
    const p = await open(nojs, P, "/book");
    assert.deepEqual(await p.evaluate(() => ["bk-date", "bk-time"].map((id) => [document.getElementById(id).value, document.getElementById(id).required])), [["", true], ["", true]]);
    await p.close();
    await nojs.close();
  });
  await ctx.close();
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height } });
  const D = nyDate(2);
  await check(`B105 at ${width}, a time that filled in by itself stays bookable (owner request 2): on step 1 the labels move with nothing announced, never while the time list is open, a hidden tab catches up when it shows, on steps 2 and 3 the trip chip, the When row and the route move in place with focus kept, no layout shift and the status sentence, the next requests carry the new time, and a lapsed time found while a request is built sends one request`, async () => {
    const p = await openAt(ctx, P, "/book", new Date(nyAt(D, "10:50:00")));
    const sent = posts(p);
    const at = () => p.evaluate(() => [document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("bk-time-btn").textContent.trim()]);
    assert.deepEqual(await at(), [D, "12:00", "12:00 PM"]);
    await p.clock.fastForward("09:30");
    await p.waitForFunction(() => document.getElementById("bk-time").value === "12:10");
    assert.deepEqual([await at(), await p.textContent("#bk-status"), sent.length], [[D, "12:10", "12:10 PM"], "", 0], "on step 1 only the labels change and nothing is announced");
    await p.click("#bk-time-btn");
    await p.waitForFunction(() => !document.getElementById("bk-tm").hidden);
    await p.clock.fastForward("10:00");
    await p.waitForTimeout(100);
    assert.equal(await p.inputValue("#bk-time"), "12:10", "never while the time list is open");
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => document.getElementById("bk-tm").hidden);
    await p.clock.fastForward("00:20");
    await p.waitForFunction(() => document.getElementById("bk-time").value === "12:20");
    await p.clock.pauseAt(new Date(nyAt(D, "11:15:00")));
    await p.clock.setSystemTime(new Date(nyAt(D, "11:19:30")));
    assert.equal(await p.inputValue("#bk-time"), "12:20", "the clock is past the guard, no timer has run yet");
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await p.waitForFunction(() => document.getElementById("bk-time").value === "12:30");
    await p.clock.resume();
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await view(p);
    await priced(p);
    assert.deepEqual(sent.map((b) => [b.action, b.date, b.time]), [["options", D, "12:30"]]);
    const chip = '#bk-sum [data-f="when"]';
    assert.equal((await p.textContent(chip)).replace(/^Change /, ""), "Today, 12:30 PM");
    await p.focus(chip);
    const before = await p.evaluate(() => window.__cls);
    await p.clock.fastForward("09:45");
    await p.waitForFunction(() => document.getElementById("bk-time").value === "12:40");
    await p.waitForTimeout(300);
    assert.deepEqual([(await p.textContent(chip)).replace(/^Change /, ""), await p.evaluate(() => document.activeElement.matches('#bk-sum [data-f="when"]')), await p.textContent("#bk-status")], ["Today, 12:40 PM", true, "Pickup moved to 12:40 PM, the earliest time to book online."], "the chip moves in place, focus stays on it, the move is announced");
    await priced(p);
    assert.deepEqual([sent.at(-1).action, sent.at(-1).time], ["quote", "12:40"], "the move asks for the new price with the new time");
    assert.equal(await p.evaluate(() => window.__cls) - before, 0, "no layout shift from the move on step 2");
    await next(p);
    await priced(p);
    const when = '#bk-check-rows button[data-c="when"]';
    await p.focus(when);
    const b3 = await p.evaluate(() => window.__cls);
    await p.clock.fastForward("10:00");
    await p.waitForFunction(() => document.getElementById("bk-time").value === "12:50");
    await p.waitForTimeout(300);
    const s3 = await p.evaluate(() => [document.querySelector("#bk-check-rows dd").textContent, document.querySelector("#bk-check-route li").textContent, document.activeElement.dataset.c]);
    assert.deepEqual(s3, [`${new Date(`${D}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, 12:50 PM, New York time`, "12:50 PMJFK Terminal 4", "when"], "the When row and the route move in place, focus stays on Change date and time");
    assert.equal(await p.evaluate(() => window.__cls) - b3, 0, "no layout shift from the move on step 3");
    await priced(p);
    await details(p);
    await p.route("**/booking-confirmed*", (r) => r.fulfill({ status: 204, body: "" }));
    await p.clock.pauseAt(new Date(nyAt(D, "11:44:00")));
    await p.clock.setSystemTime(new Date(nyAt(D, "11:49:30")));
    const n = sent.length;
    await Promise.all([p.waitForRequest((r) => r.url().includes("/booking-confirmed")), p.click(await payBtn(p))]);
    assert.deepEqual(sent.slice(n).map((b) => [b.action, b.date, b.time]), [["pay", D, "13:00"]], "a lapsed time found while the payment is built moves first and sends one request");
    await p.clock.resume();
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  const D = nyDate(2);
  await check("B106 a day the rider picked keeps an automatic time inside that day: it moves until no slot is left, then stops, the flag clears and the within the hour hint shows", async () => {
    const p = await openAt(ctx, P, "/book", new Date(nyAt(D, "22:30:00")));
    assert.deepEqual(await p.evaluate(() => [ED.value, ET.value]), [D, "23:40"]);
    await pickDate(p, "#bk-date-btn", D);
    assert.deepEqual(await p.evaluate(() => [ET.value, AD, AT]), ["23:40", 0, 1], "picking the same day keeps the time that filled in by itself");
    await p.clock.fastForward("09:30");
    await p.waitForFunction(() => ET.value === "23:50");
    await p.clock.fastForward("10:30");
    await p.waitForTimeout(200);
    assert.deepEqual(await p.evaluate(() => [ED.value, ET.value]), [D, "23:50"], "no slot is left on that day, so the time stops and the date never changes");
    await p.clock.fastForward("02:00");
    await p.waitForFunction(() => !document.getElementById("bk-time-h").hidden);
    assert.deepEqual(await p.evaluate(() => [ED.value, ET.value, AT, document.getElementById("bk-time-h").textContent]), [D, "23:50", 0, HOUR_NOTE]);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check("B107 a time the rider picks never moves and keeps today's short notice block, another day clears the time and the list opens on 9:00 AM, the same day keeps it automatic and it moves within the day", async () => {
    let p = await openAt(ctx, P, "/book", new Date());
    const soon = inWindow();
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await p.keyboard.press("Escape");
    await p.evaluate(([d, t]) => { const e = document.getElementById("bk-date"); e.value = d; e.dispatchEvent(new Event("change", { bubbles: true })); const s = document.getElementById("bk-time"); s.value = t; s.dispatchEvent(new Event("change", { bubbles: true })); }, [soon.date, soon.time]);
    await p.clock.fastForward("02:00");
    await p.waitForTimeout(200);
    assert.deepEqual(await p.evaluate(() => [ED.value + " " + ET.value, AT]), [`${soon.date} ${soon.time}`, 0], "a picked time stays");
    await p.click("#bk-view");
    await p.waitForSelector("#q-short-notice", { state: "visible" });
    await p.close();
    p = await openAt(ctx, P, "/book", new Date());
    await pickDate(p, "#bk-date-btn", DATE);
    assert.deepEqual(await p.evaluate(() => [ET.value, AT, AD, document.getElementById("bk-time-btn").textContent.trim(), document.getElementById("bk-time-btn").classList.contains("is-ph"), document.activeElement.id]), ["", 0, 0, "Select a time", true, "bk-time-btn"], "another day clears the time, focus moves to it");
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
    assert.equal(await p.evaluate(() => document.activeElement.dataset.v), "09:00");
    await p.close();
    const D = nyDate(2);
    p = await openAt(ctx, P, "/book", new Date(nyAt(D, "10:50:00")));
    await pickDate(p, "#bk-date-btn", D);
    assert.deepEqual(await p.evaluate(() => [ED.value, ET.value, AD, AT]), [D, "12:00", 0, 1]);
    await p.clock.fastForward("09:30");
    await p.waitForFunction(() => ET.value === "12:10");
    assert.equal(await p.inputValue("#bk-date"), D);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B108 a restore with a time that filled in by itself and has lapsed comes back bookable: /book#resume and /book without a hash add the sentence to their notice, which reads from the start, a #details reload moves the chip and the When row and announces it", async () => {
    const stale = nyClock(Math.ceil((Date.now() + 30 * 6e4) / 6e5) * 6e5);
    const state = (step) => ({ v: 1, fields: { ...JFK_TRIP, date: stale.slice(0, 10), time: stale.slice(11), rider: "me", name: ME.name, email: ME.email, phone: "212 555 0100", phone_cc: "US", reach: "phone" }, stops: 0, return: false, step, at: 1, ad: 1 });
    const sentence = (p) => p.evaluate((d) => "Pickup moved to " + (ED.value != d ? fd(ED.value) + ", " : "") + ft(ET.value) + ", the earliest time to book online.", stale.slice(0, 10));
    let p = await open(ctx, P, "/rates");
    await p.evaluate((s) => sessionStorage.setItem("nlr-book", JSON.stringify(s)), state("details"));
    await p.goto(`${P.base}/book#resume`, { waitUntil: "load" });
    await priced(p);
    assert.ok(await p.evaluate(() => AT === 1 && !(ED.value + " " + ET.value < ny(Date.now() + 36e5 + 12e4))), "the time moved to a slot that can be booked online");
    const want = await sentence(p);
    assert.equal((await p.innerText("#resume")).replace(/\s+/g, " ").trim(), `Payment not completed. Nothing was charged. Your details are still here. ${want} Book and pay online when you're ready. Book and pay online`);
    assert.deepEqual(await p.evaluate(() => ["resume", "restored"].map((id) => getComputedStyle(document.getElementById(id)).textAlign)), ["start", "start"], "the longer notice reads from the start, like the other notices and its button");
    await p.goto(`${P.base}/rates`, { waitUntil: "load" });
    await p.evaluate((s) => sessionStorage.setItem("nlr-book", JSON.stringify(s)), state("search"));
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    assert.equal(await p.textContent("#restored span"), `We filled in your trip from earlier in this tab. ${await sentence(p)}`);
    await p.goto(`${P.base}/rates`, { waitUntil: "load" });
    await p.evaluate((s) => sessionStorage.setItem("nlr-book", JSON.stringify(s)), state("details"));
    await p.goto(`${P.base}/book#details`, { waitUntil: "load" });
    await priced(p);
    assert.deepEqual([await p.isVisible("#resume"), await p.textContent("#bk-status"), (await p.textContent('#bk-sum [data-f="when"]')).includes(await p.evaluate(() => ft(ET.value)))], [false, await sentence(p), true]);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P, { viewport: { width: 1440, height: 900 } });
  const hold = (r, e, extra = {}) => ({ kind: "quote", ref: "12345678", reason: "short-notice", group: "phone", heading: "Reserve this trip by email or WhatsApp", text: "For a pickup within the next hour, email info@nycluxride.com or message us on WhatsApp.", hourly: false, field: "", classes: [], tips: TIP_PERCENTS, earliest: e, whatsapp: "https://wa.me/16467750556?text=x", mailto: "mailto:info@nycluxride.com?subject=Booking%20request%2012345678&body=x", ...extra });
  const later = (p, m) => p.evaluate((m) => { const x = ny(wi(...AQ().split(" ")) + m * 6e4); return { date: x.slice(0, 10), time: x.slice(11) }; }, m);
  await check("B109 the server's earliest time corrects a slow clock (owner request 2): a short notice hold on the payment moves the form to it and pays once more with the new time, two holds in a row show the hold, a held price answer moves the form once and later moves follow the server, and a day the rider picked keeps the hold", async () => {
    let p = await open(ctx, P, "/book");
    let sent = posts(p);
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await details(p);
    let e = await later(p, 20), holds = 1;
    await p.route("**/api/book", (route) => (JSON.parse(route.request().postData() || "{}").action === "pay" && holds-- > 0 ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hold(null, e)) }) : route.continue()));
    await Promise.all([p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
    const pays = sent.filter((b) => b.action === "pay");
    assert.deepEqual(pays.map((b) => b.date + " " + b.time), [pays[0].date + " " + pays[0].time, e.date + " " + e.time], "one more payment with the server's time");
    await p.close();
    p = await open(ctx, P, "/book");
    sent = posts(p);
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await details(p);
    e = await later(p, 20);
    holds = 2;
    await p.route("**/api/book", (route) => (JSON.parse(route.request().postData() || "{}").action === "pay" && holds-- > 0 ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hold(null, e)) }) : route.continue()));
    await p.click("#bk-submit");
    await p.waitForSelector("#q-short-notice", { state: "visible" });
    assert.deepEqual([sent.filter((b) => b.action === "pay").length, new URL(p.url()).pathname], [2, "/book"], "after one retry the hold shows");
    await p.unroute("**/api/book");
    await p.close();
    p = await open(ctx, P, "/book");
    sent = posts(p);
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    e = await later(p, 10);
    let once = 1;
    await p.route("**/api/book", async (route) => {
      if (!once--) return route.continue();
      const r = await route.fetch();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...(await r.json()), hold: "short-notice", pay: false, earliest: e }) });
    });
    await p.click("#bk-view");
    await p.waitForFunction((x) => ET.value === x, e.time);
    await priced(p);
    assert.deepEqual([await p.isVisible("#q-short-notice"), await p.evaluate(() => AO), sent.map((b) => b.time)], [false, 6e5, [sent[0].time, e.time]], "the held answer moves the form once, keeps the difference and asks again");
    assert.equal(await p.evaluate(() => wi(...AQ().split(" ")) >= Date.now() + 36e5 + 3e5 + 6e5), true, "later moves add the server's lead");
    await p.close();
    p = await open(ctx, P, "/book");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await p.keyboard.press("Escape");
    const today = await p.inputValue("#bk-date");
    await pickDate(p, "#bk-date-btn", today);
    const tomorrow = { date: new Date(Date.parse(today) + 864e5).toISOString().slice(0, 10), time: "00:10" };
    await p.route("**/api/book", async (route) => { const r = await route.fetch(); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...(await r.json()), hold: "short-notice", pay: false, earliest: tomorrow }) }); });
    await p.click("#bk-view");
    await p.waitForSelector("#q-short-notice", { state: "visible" });
    assert.deepEqual(await p.evaluate(() => [AD, AT, ED.value]), [0, 0, today], "a day the rider picked keeps the hold and the time stops moving");
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B14 right after load the date and time have filled in by themselves and every data-wa link still says hello, then a typed pickup brings the trip with its date and time into them (owner request 2)", async () => {
    const p = await open(ctx, P, "/book");
    const texts = () => p.$$eval("a[data-wa]", (a) => a.map((x) => decodeURIComponent(x.getAttribute("href").split("?text=")[1] || "")));
    assert.ok(await p.evaluate(() => !!(ED.value && ET.value && AD && AT)));
    assert.deepEqual(await texts(), Array(5).fill(WA_HELLO));
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await p.waitForTimeout(400);
    const [d, t] = await p.evaluate(() => [fy(ED.value), ft(ET.value)]);
    const all = await texts();
    assert.ok(all.every((x) => x === all[0] && x.includes(`\nPickup: JFK Terminal 4\nDate: ${d}\nTime: ${t}\n`)), all[0]);
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P);
  for (const [path, pick] of [["/locations/jfk-airport", "John F. Kennedy (JFK)"], ["/locations/laguardia-airport", "LaGuardia (LGA)"]]) {
    await check(`B118 ${path}: right after load every data-wa link carries the page's pickup with no date or time, because the date and time filled in by themselves, and a typed drop-off brings the trip with its date and time into them (owner request 2)`, async () => {
      const p = await open(ctx, P, path);
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js") && AT && AD);
      await p.waitForTimeout(400);
      const texts = () => p.$$eval("a[data-wa]", (a) => a.map((x) => decodeURIComponent(x.getAttribute("href").split("?text=")[1] || "")));
      assert.deepEqual(await texts(), Array(5).fill(["Hi NYC LUX RIDE, I would like to book this trip.", "Trip: One way", `Pickup: ${pick}`, "Passengers: 1"].join("\n")));
      await place(p, "to", "350 5th Ave, New York, NY 10118");
      await p.waitForTimeout(400);
      const [d, t] = await p.evaluate(() => [fy(ED.value), ft(ET.value)]);
      const all = await texts();
      assert.ok(all.every((x) => x === all[0] && x.includes(`\nDrop-off: 350 5th Ave, New York, NY 10118\nDate: ${d}\nTime: ${t}\n`)), all[0]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
  }
  await ctx.close();
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B110 at ${width}, the country code picker (owner request 3): /book ships one option per select and no country names, the details step brings the 244 countries with United States +1 chosen, the face and the placeholder follow the select, a pasted +44 number and a typed 0044 number move their code with a status line, both messages carry the number with its code, a #details restore keeps GB, the pay post sends both codes and the confirmation shows the passenger's number`, async () => {
    const p = await open(ctx, P, "/book");
    assert.deepEqual(await p.evaluate(() => [E.phone_cc.length, E.pphone_cc.length, document.body.textContent.includes("Afghanistan"), document.body.textContent.includes("United Kingdom")]), [1, 1, false, false]);
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    assert.deepEqual(await p.evaluate(() => [E.phone_cc.length, E.pphone_cc.length, E.phone_cc.value, E.pphone_cc.value, E.phone_cc.selectedOptions[0].text]), [244, 244, "US", "US", "United States +1"]);
    assert.deepEqual([await p.textContent("#bk-phone-face"), await p.getAttribute("#bk-phone", "placeholder")], ["\u{1F1FA}\u{1F1F8}+1", "For example 212 555 0100"]);
    await p.selectOption("#bk-phone-cc", "GB");
    assert.deepEqual([await p.textContent("#bk-phone-face"), await p.getAttribute("#bk-phone", "placeholder")], ["\u{1F1EC}\u{1F1E7}+44", " "]);
    await p.selectOption("#bk-phone-cc", "US");
    await p.focus("#bk-phone");
    await p.evaluate(() => { const i = document.getElementById("bk-phone"); i.value = "+44 7700 900123"; i.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true })); });
    assert.deepEqual([await p.inputValue("#bk-phone-cc"), await p.inputValue("#bk-phone"), await p.textContent("#bk-status"), await p.textContent("#bk-phone-face")], ["GB", "7700 900123", "Country code set to United Kingdom +44.", "\u{1F1EC}\u{1F1E7}+44"], "a pasted number moves its code to the select");
    await p.selectOption("#bk-phone-cc", "US");
    await p.fill("#bk-phone", "");
    await p.keyboard.type("0044 7700 900123");
    assert.equal(await p.inputValue("#bk-phone"), "0044 7700 900123", "typing is never rewritten on the way");
    await p.click("#bk-name");
    await p.waitForFunction(() => E.phone_cc.value === "GB");
    assert.deepEqual([await p.inputValue("#bk-phone"), await p.textContent("#bk-status")], ["7700 900123", "Country code set to United Kingdom +44."]);
    await details(p, { name: ME.name, email: ME.email });
    await p.fill("#bk-phone", "07700 900123");
    await p.check("#bk-r-other");
    await p.fill("#bk-pname", "Dana Reyes");
    await p.selectOption("#bk-pphone-cc", "FR");
    await p.fill("#bk-pphone", "06 12 34 56 78");
    await p.waitForTimeout(400);
    const wa = await waText(p, "#q-wa"), mail = decodeURIComponent((await p.getAttribute("#q-mail", "href")).split("&body=")[1] || "");
    for (const t of [wa, mail]) assert.match(t, /\nMobile: \+44 7700 900123\nContact: Phone\nPassenger: Dana Reyes\nPassenger mobile: \+33 6 12 34 56 78(\n|$)/, "the messages carry each number with its country code and no trunk 0");
    assert.deepEqual([await p.inputValue("#bk-phone"), await p.inputValue("#bk-pphone")], ["07700 900123", "06 12 34 56 78"], "the fields keep what was typed");
    await p.reload({ waitUntil: "load" });
    await priced(p);
    assert.deepEqual(await p.evaluate(() => [E.phone_cc.length, E.phone_cc.value, E.pphone_cc.value, document.getElementById("bk-phone-face").textContent, document.getElementById("bk-pphone-face").textContent, E.phone.value]), [244, "GB", "FR", "\u{1F1EC}\u{1F1E7}+44", "\u{1F1EB}\u{1F1F7}+33", "07700 900123"], "a #details reload keeps the countries");
    const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
    const body = JSON.parse(req.postData());
    assert.deepEqual(["phone", "phone_cc", "pphone", "pphone_cc"].map((k) => body[k]), ["07700 900123", "GB", "06 12 34 56 78", "FR"]);
    await p.waitForFunction(() => document.getElementById("cf").classList.contains("is-paid"), null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => [...document.querySelectorAll("#cf-rows dt")].find((d) => d.textContent === "Passenger").nextElementSibling.innerText.replace(/\s+/g, " ").trim()), "Dana Reyes +33 6 12 34 56 78", "the confirmation shows the passenger's number with its code");
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  const rows = [["GB", "44 7911 123456"], ["GB", "447911123456"], ["GB", "44 07911 123456"], ["FR", "33 6 12 34 56 78"], ["RU", "7 912 345 67 89"], ["BR", "55 11 91234 5678"], ["BR", "55 99123 4567"], ["IN", "9123456789"], ["KZ", "7011234567"], ["IT", "3931234567"], ["FR", "3 33 12 34 56"], ["US", "2125550100"], ["US", "(212) 555-0100"], ["US", "1 212 555 0100"], ["US", "+1 1 212 555 0100"], ["US", "+1242 555 0100"], ["US", "555-0100"], ["US", "123 456 7890"], ["US", "212 155 0100"], ["US", "0207 946 0958"], ["US", "+44 7700 900123"], ["US", "0044 7700 900123"], ["US", "011 44 7700 900123"], ["GB", "7700 900123"], ["GB", "07700 900123"], ["GB", "+44 07700 900123"], ["GB", "+44 (0)20 7946 0958"], ["DE", "+49 171/1234567"], ["DE", "0171 1234567"], ["FR", "06 12 34 56 78"], ["AU", "0412 345 678"], ["IT", "06 1234 5678"], ["IT", "347 123 4567"], ["BJ", "01 97 12 34 56"], ["RU", "8 912 345 67 89"], ["RU", "812 123 45 67"], ["BY", "8 029 123 45 67"], ["BY", "029 123 45 67"], ["HU", "06 30 123 4567"], ["JP", "090-1234-5678"], ["JP", "＋８１ ９０１２３４５６７８"], ["AE", "+٩٧١٥٠١٢٣٤٥٦٧"], ["NU", "+683 1234"], ["CA", "+7 495 123 45 67"], [undefined, "2125550100"], ["ZZ", "7700 900123"], ["ZZ", "+44 7700 900123"], ["US", "+888 1234 5678"], ["US", "+1 212 555 0100 x2"], ["US", "call me"], ["BF", "07 12 34 56"], ["TJ", "01 123 4567"], ["US", "+226 07 12 34 56"], ["GB", "0"], ["US", ""], ["GB", "+888 1234 5678"], ["DE", "00888 1234 5678"], ["IT", "00888 1234 5678"], ["RU", "+0 1234 5678"], ["FR", "+999 123 456"]];
  await check("B111 the browser reads a mobile number exactly as the server does (owner request 3): the readPhone table of the spec plus the edge cases give the same ok and the same text", async () => {
    const p = await open(ctx, P, "/book");
    await p.evaluate(() => cf());
    const got = await p.evaluate((r) => r.map(([c, t]) => RP(t, c)), rows);
    assert.deepEqual(got.map((x) => [x.ok, x.ok ? x.text : ""]), rows.map(([c, t]) => { const s = readPhone(t, c); return [s.ok, s.ok ? s.text : ""]; }));
    assert.ok(got.filter((x) => x.ok).length >= 30);
    await p.close();
  });
  await ctx.close();
}

for (const [width, height] of [[390, 844], [768, 1024]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B112 at ${width}, the details step has no bottom bar (owner request 4): not at load, not while typing the name, email, mobile or notes, not at the top or the foot of the page, not with a short notice or paused hold, the step ends with the total, Book and pay online, Email to reserve and WhatsApp to reserve, and on the vehicle step the bar steps aside while the hourly Vehicle select has focus`, async () => {
    const p = await open(ctx, P, "/book");
    const none = async (why) => assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display), "none", why);
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await none("at load");
    for (const id of ["bk-name", "bk-email", "bk-phone"]) { await p.click(`#${id}`); await p.keyboard.type("a1"); await none(`while typing in ${id}`); }
    await p.click("#bk-notes-add");
    await p.keyboard.type("A note");
    await none("while typing a note");
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await none("at the top");
    await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(150);
    await none("at the foot");
    const order = await p.evaluate(() => ["bk-tot", "bk-submit", "q-mail", "q-wa"].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
    assert.ok(order.every((y, i) => !i || y > order[i - 1]), `total, pay, email, WhatsApp in that order: ${order}`);
    await p.close();
    for (const [server, reason, t] of [[P, "short-notice", inWindow()], [Q, "paused", { date: DATE, time: "12:40" }]]) {
      const qc = server === P ? ctx : await context(Q, { viewport: { width, height } });
      const q = await open(qc, server, "/rates");
      await q.evaluate((s) => sessionStorage.setItem("nlr-book", JSON.stringify(s)), { v: 1, fields: { ...JFK_TRIP, date: t.date, time: t.time, rider: "me", name: ME.name, email: ME.email, phone: "212 555 0100", phone_cc: "US", reach: "phone" }, stops: 0, return: false, step: "details" });
      await q.goto(`${server.base}/book#details`, { waitUntil: "load" });
      await q.waitForSelector(`#q-${reason}`, { state: "visible" });
      assert.deepEqual([await q.getAttribute("#book-form", "data-step"), await q.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display)], ["details", "none"], reason);
      await q.close();
      if (qc !== ctx) await qc.close();
    }
    const h = await open(ctx, P, "/book");
    await h.click('label[for="bk-hour"]');
    await place(h, "from", "350 5th Ave, New York, NY 10118");
    await view(h);
    await priced(h);
    await h.evaluate(() => scrollTo(0, 0));
    await h.waitForTimeout(300);
    assert.equal(await h.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display), "flex");
    await h.focus("#bk-vehicle");
    assert.equal(await h.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display), "none", "the bar steps aside while the Vehicle select has focus");
    await h.focus("#bk-opt-h");
    assert.equal(await h.evaluate(() => getComputedStyle(document.getElementById("bk-bar")).display), "flex");
    assert.deepEqual(h.errors, []);
    await h.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B113 after a priced answer a failed call keeps the trip reference (owner request 5): the WhatsApp text and the email subject the browser builds carry Reference and the 8 digits", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const ref = await p.evaluate(() => RR);
    assert.match(ref, /^[1-9]\d{7}$/);
    await p.route("**/api/book", (r) => r.abort());
    await p.click('label[for="bk-c-first"]');
    await p.waitForSelector("#q-error", { state: "visible", timeout: 8000 });
    assert.match(await waText(p, "#q-wa"), new RegExp(`^Hi NYC LUX RIDE, I would like to book this trip\\.\\nReference: ${ref}\\nTrip: One way\\n`));
    assert.match(decodeURIComponent(await p.getAttribute("#q-mail", "href")), new RegExp(`^mailto:info@nycluxride\\.com\\?subject=Booking request ${ref}&body=`));
    await p.close();
  });
  await ctx.close();
}
for (const width of [1440, 390]) {
  const ctx = await context(P, { viewport: { width, height: width > 1000 ? 900 : 844 } });
  await check(`B113 at ${width}, when Book and pay online fails the price stays on screen and the bar says Payment didn't open beside Email to reserve, never Prices didn't load${width > 1000 ? "" : ", also after Back to vehicles"}`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    await p.route("**/api/book", (r) => (JSON.parse(r.request().postData() || "{}").action === "pay" ? r.abort() : r.continue()));
    await p.click(await payBtn(p));
    await p.waitForSelector("#q-error", { state: "visible", timeout: 9000 });
    assert.match(await p.textContent("#q-error"), /Online payment isn't available right now/);
    if (width < 1000) {
      await p.click("#bk-back");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    }
    await p.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await p.waitForFunction(() => [document.getElementById("bk-bar"), document.getElementById("bk-bar-mail")].every((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"));
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-bar-q").textContent, document.getElementById("price").hidden, (document.getElementById("price-total").firstChild || {}).textContent]), ["Payment didn't open", false, cash(TOTAL)]);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  await check(`B114 ${name}: both mobile number placeholders fit next to the country code from 320 to 1920 wide, including 1024 wide where the details step has two narrow columns, at 16px wherever the row has room (owner request 3)`, async () => {
    const ctx = await engineContext(b, P, { viewport: { width: 1024, height: 900 }, reducedMotion: "reduce" });
    const p = await open(ctx, P, "/rates");
    await p.evaluate((s) => sessionStorage.setItem("nlr-book", JSON.stringify(s)), { v: 1, fields: { ...JFK_TRIP, rider: "other", phone_cc: "US", pphone_cc: "US" }, stops: 0, return: false, step: "details" });
    await p.goto(`${P.base}/book#details`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    await p.evaluate(() => document.fonts.ready);
    const bad = [];
    for (const width of [320, 336, 344, 360, 390, 430, 768, 1000, 1024, 1032, 1040, 1048, 1056, 1064, 1280, 1440, 1920]) {
      await p.setViewportSize({ width, height: 900 });
      for (const [id, need, box, size] of await p.evaluate(PLACEHOLDER_FIT, ["bk-phone", "bk-pphone"])) {
        if (need === "hidden") bad.push(`${width} ${id} not shown`);
        else if (need > box) bad.push(`${width} ${id} needs ${need} px of ${box}`);
        else if ([360, 390, 430, 768, 1280, 1440, 1920].includes(width) && size !== "16px") bad.push(`${width} ${id} ${size}`);
      }
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });
}

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
  const ctx = await context(P, { viewport: { width, height } });
  const D = nyDate(2);
  const LONG = ["The Lobby Bar at The New York EDITION, Madison Avenue, New York, NY"];
  await check(`B115 at ${width}, a move that makes the time or the day longer moves nothing on the page (owner request 2): Today, 11:50 PM to Tomorrow, 12:00 AM on the vehicle step and 9:50 AM to 10:00 AM on the details step with a long drop-off keep the trip chips, the route list and everything below in place, and every time of the day fits the route list's time column on one line`, async () => {
    const box = () => {
      const r = (id) => { const e = document.getElementById(id); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top + scrollY), Math.round(b.height)]; };
      return { sum: r("bk-sum"), cards: r("bk-cards"), route: r("bk-check-route"), rows: r("bk-check-rows"), tip: r("bk-tip"), pay: r("bk-submit"), side: r("bk-side"), chip: document.querySelector('#bk-sum [data-f="when"]').textContent.replace(/^Change /, "") };
    };
    const p = await openAt(ctx, P, "/book", new Date(nyAt(D, "22:44:00")));
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", ...LONG);
    await view(p);
    await priced(p);
    const a = await p.evaluate(box), c2 = await p.evaluate(() => window.__cls);
    assert.equal(a.chip, "Today, 11:50 PM");
    await p.clock.fastForward("06:00");
    await p.waitForFunction(() => ET.value === "00:00");
    await p.waitForTimeout(300);
    await priced(p);
    const b = await p.evaluate(box);
    assert.equal(b.chip, "Tomorrow, 12:00 AM");
    assert.deepEqual({ ...b, chip: 0 }, { ...a, chip: 0 }, "the vehicle step keeps every box in place when the day changes");
    assert.equal(await p.evaluate(() => window.__cls) - c2, 0);
    await p.close();
    const q = await openAt(ctx, P, "/book", new Date(nyAt(D, "08:44:00")));
    await place(q, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(q, "to", ...LONG);
    await view(q);
    await priced(q);
    await next(q);
    await priced(q);
    const short = [];
    for (const w of [360, 400, 414, 430, 768, 1024, 1040, width]) {
      await q.setViewportSize({ width: w, height });
      const [have, need] = await q.evaluate(() => {
        const dd = document.querySelector("#bk-check-rows dd"), keep = [dd.textContent, dd.style.minHeight], have = dd.offsetHeight;
        dd.style.minHeight = "";
        dd.textContent = fy(ED.value) + ", 10:00 AM, New York time";
        const need = dd.offsetHeight;
        [dd.textContent, dd.style.minHeight] = keep;
        return [have, need];
      });
      if (have < need) short.push(`${w}: ${have} px for ${need}`);
    }
    assert.deepEqual(short, [], "at every width the When row is already as tall as the next time needs");
    await q.waitForTimeout(300);
    const x = await q.evaluate(box), c3 = await q.evaluate(() => window.__cls);
    assert.equal(x.chip, "Today, 9:50 AM");
    await q.clock.fastForward("06:00");
    await q.waitForFunction(() => ET.value === "10:00");
    await q.waitForTimeout(300);
    await priced(q);
    const y = await q.evaluate(box);
    assert.deepEqual([y.chip, await q.textContent("#bk-check-route li")], ["Today, 10:00 AM", "10:00 AMJFK Terminal 4"]);
    assert.deepEqual({ ...y, chip: 0 }, { ...x, chip: 0 }, "the details step keeps every box in place when the hour gains a digit");
    assert.equal(await q.evaluate(() => window.__cls) - c3, 0);
    const wrap = await q.evaluate(() => {
      const ol = document.createElement("ol"), out = [];
      ol.className = "bk-trip__route bk-route";
      document.getElementById("bk-check").append(ol);
      for (let m = 0; m < 1440; m += 5) {
        const t = ft(String(m / 60 | 0).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
        ol.innerHTML = `<li><span class="bk-route__t">${t}</span><span class="bk-route__p">JFK Terminal 4</span></li><li><span class="bk-route__t bk-route__z">About ${t}</span><span class="bk-route__p">350 5th Ave</span></li>`;
        const [s, z] = ol.querySelectorAll(".bk-route__t");
        if (s.getBoundingClientRect().height > 21 || z.getBoundingClientRect().height > 21) out.push(t);
      }
      ol.remove();
      return out;
    });
    assert.deepEqual(wrap, [], "these times wrap in the route list");
    assert.deepEqual([p.errors, q.errors], [[], []]);
    await q.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  for (const host of name === "chromium" ? ["/", "/locations/jfk-airport", "/locations/laguardia-airport"] : ["/"]) {
    const ctx = await engineContext(b, P, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await check(`B119 ${name} ${host}: a trip that goes from the details step to this page and back through Book your ride keeps the booker's and the passenger's country codes, so the payment and the confirmation carry +44 and +91, never +1 (owner request 3)`, async () => {
      const p = await open(ctx, P, "/book");
      const saved = () => p.evaluate(() => { const f = JSON.parse(sessionStorage.getItem("nlr-book")).fields; return [f.phone_cc, f.phone, f.pphone_cc, f.pphone]; });
      const want = ["GB", "20 7946 0958", "IN", "98765 43210"];
      await trip(p, host.includes("laguardia") ? { from: ["laguardia terminal b", "LaGuardia (LGA), Terminal B"] } : {});
      await view(p);
      await priced(p);
      await next(p);
      await priced(p);
      await p.selectOption("#bk-phone-cc", "GB");
      await details(p, { name: ME.name, email: ME.email, phone: want[1] });
      await p.check("#bk-r-other");
      await p.fill("#bk-pname", "Sam Lee");
      await p.selectOption("#bk-pphone-cc", "IN");
      await p.fill("#bk-pphone", want[3]);
      await p.waitForTimeout(500);
      assert.deepEqual(await saved(), want);
      await p.goto(`${P.base}${host}`, { waitUntil: "load" });
      await p.waitForFunction((v) => document.getElementById("book-form").classList.contains("is-js") && document.getElementById("bk-phone").value === v, want[1]);
      await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
      await priced(p);
      assert.deepEqual(await saved(), want, "Book your ride on the host page saves the codes the trip came with");
      await next(p);
      await priced(p);
      assert.deepEqual(await p.evaluate(() => [E.phone_cc.value, E.pphone_cc.value, document.getElementById("bk-phone-face").textContent, document.getElementById("bk-pphone-face").textContent, E.phone.value, E.pphone.value]), ["GB", "IN", "\u{1F1EC}\u{1F1E7}+44", "\u{1F1EE}\u{1F1F3}+91", want[1], want[3]]);
      const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
      const body = JSON.parse(req.postData());
      assert.deepEqual(["phone_cc", "phone", "pphone_cc", "pphone"].map((k) => body[k]), want);
      await p.waitForFunction(() => document.getElementById("cf").classList.contains("is-paid"), null, { timeout: 15000 });
      assert.equal(await p.evaluate(() => [...document.querySelectorAll("#cf-rows dt")].find((d) => d.textContent === "Passenger").nextElementSibling.innerText.replace(/\s+/g, " ").trim()), "Sam Lee +91 98765 43210");
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const width of [390, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width < 1024 ? 844 : 900 } });
  await check(`B120 at ${width} the clean steps: step 2 opens with the trip line as text on the heading's edge and Edit trip, then the step count and a one-line heading, step 3 reads Back to vehicles, the step count, the details with one hint, the gratuity, Where we meet, Check your trip, the total, the three ways to finish and the fine print in that order with the car named once, a second visit shows Check your trip on screen, and the rider checkbox keeps the stored rider`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const tops = (ids) => p.evaluate((ids) => ids.map((id) => { const e = document.getElementById(id); return e && e.getClientRects().length ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }), ids);
    const inOrder = (y) => y.every((v, i) => v !== null && (!i || v >= y[i - 1]));
    const s2 = await tops(["bk-sum", "bk-opt-h", "bk-pax-f", "bk-cards"]);
    assert.ok(inOrder(s2), `step 2 ${s2}`);
    assert.deepEqual(await p.$$eval("#bk-sum .bk-chip", (c) => c.map((x) => [getComputedStyle(x).borderTopStyle, getComputedStyle(x).backgroundColor])), [["none", "rgba(0, 0, 0, 0)"], ["none", "rgba(0, 0, 0, 0)"]], "the trip line is text, not boxes");
    assert.deepEqual([await p.getByRole("heading", { name: "Step 2 of 4 Choose your vehicle" }).count(), await p.isVisible("#bk-edit"), await p.$("#bk-steps")], [1, true, null]);
    assert.ok(await p.evaluate(() => Math.abs(document.querySelector("#bk-sum .bk-chip > .icon").getBoundingClientRect().left - document.getElementById("bk-opt-h").getBoundingClientRect().left) < 1), "the trip line starts on the heading's edge");
    const lines = () => p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("bk-opt-h").lastChild); return r.getClientRects().length; });
    for (const w of width < 1024 ? [width] : [1024, 1060, width]) {
      await p.setViewportSize({ width: w, height: width < 1024 ? 844 : 900 });
      assert.equal(await lines(), 1, `Choose your vehicle stays on one line at ${w}`);
    }
    await next(p);
    const ids = ["bk-back", "bk-det-h", "bk-who", "bk-name-f", "bk-email-f", "bk-phone-f", "bk-reach", "bk-dflight-f", "bk-notes-add", "bk-tip", "bk-meet-f", "bk-check", "bk-tot", "bk-submit", "q-mail", "q-wa", "bk-consent", "bk-under", "bk-next3"];
    const s3 = await tops(ids);
    assert.ok(inOrder(s3), `step 3 ${JSON.stringify(ids.map((id, i) => [id, s3[i]]))}`);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-det .field__hint:not(.bk-e)")].filter((h) => h.getClientRects().length).map((h) => h.id)), ["bk-phone-h"], "one hint in the details");
    assert.deepEqual([await p.isVisible("#bk-sum"), await p.isVisible("#bk-edit"), await p.getByRole("heading", { name: "Step 3 of 4 Your details" }).count(), await p.getByRole("checkbox", { name: "Someone else is riding" }).isChecked()], [false, false, 1, false]);
    assert.equal(await p.isVisible("#bk-choice"), width >= 1024, "on phones the car is named once, in Check your trip");
    assert.ok(width >= 1024 || (await p.evaluate(() => { const c = document.querySelector("#bk-side .bk-pay"); return Math.abs(document.getElementById("bk-result").getBoundingClientRect().top - c.getBoundingClientRect().top - parseFloat(getComputedStyle(c).paddingTop)) < 1; })), "on phones the price card opens with Your price at its padding");
    await p.click('#bk-check-rows button[data-c="car"]');
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await p.click('label[for="bk-c-premium"]');
    await priced(p);
    await next(p);
    await p.waitForSelector("#bk-upd");
    assert.ok(await p.evaluate(() => { const h = document.getElementById("bk-check-h").getBoundingClientRect(), n = document.getElementById("bk-upd").getBoundingClientRect(); return document.activeElement.id === "bk-check-h" && h.top >= document.querySelector(".site-header").getBoundingClientRect().bottom && n.bottom <= innerHeight; }), "a second visit shows Check your trip and Trip updated on screen");
    await p.check("#bk-r-other");
    await p.fill("#bk-pname", "Dana Reyes");
    await p.reload({ waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    assert.deepEqual([await p.isChecked("#bk-r-other"), await p.inputValue("#bk-pname"), await p.isVisible("#bk-pname"), await p.evaluate(() => JSON.parse(sessionStorage.getItem("nlr-book")).fields.rider)], [true, "Dana Reyes", true, "other"], "a reload keeps someone else riding, stored as other as before");
    await p.uncheck("#bk-r-other");
    await p.waitForFunction(() => JSON.parse(sessionStorage.getItem("nlr-book")).fields.rider === "me");
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check(`B120 at ${width} a round trip: Check your trip shows When, Return, Passengers and Car, and Change return date and time opens the return calendar on the return day`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await p.click("#bk-addret");
    await pickDate(p, "#bk-rdate-btn", RDATE);
    await setTime(p, "18:00", "#bk-rtime");
    await view(p);
    await priced(p);
    await next(p);
    assert.deepEqual(await p.$$eval("#bk-check-rows > div", (d) => d.map((x) => [x.querySelector("dt").textContent, x.querySelector("button").textContent])), [["When", "Change date and time"], ["Return", "Change return date and time"], ["Passengers", "Change passengers"], ["Car", "Change car"]]);
    assert.match(await p.textContent("#bk-check-rows > div:nth-child(2) dd"), /, 6:00 PM, New York time$/);
    await p.click('#bk-check-rows button[data-c="rd"]');
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-cal").previousElementSibling.id, document.activeElement.dataset.day]), ["bk-rdate-btn", RDATE]);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  for (const [width, height, kind] of [[320, 568, "one"], [320, 568, "round"], [375, 667, "round"], [390, 664, "round"]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B120 ${name} at ${width} by ${height} a ${kind === "one" ? "one way" : "round"} trip: after Change car a second visit shows Check your trip below the header and Trip updated on screen, also when the card is taller than the screen`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p, { to: ["The New York EDITION, 701 7th Ave, New York, NY 10036"] });
      if (kind === "round") {
        await p.click("#bk-addret");
        await pickDate(p, "#bk-rdate-btn", RDATE);
        await setTime(p, "18:00", "#bk-rtime");
      }
      await view(p);
      await priced(p);
      await next(p);
      await p.click('#bk-check-rows button[data-c="car"]');
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
      await p.click('label[for="bk-c-premium"]');
      await priced(p);
      await next(p);
      await p.waitForSelector("#bk-upd");
      const m = await p.evaluate(() => { const h = document.getElementById("bk-check-h").getBoundingClientRect(), n = document.getElementById("bk-upd").getBoundingClientRect(); return { active: document.activeElement.id, header: document.querySelector(".site-header").getBoundingClientRect().bottom, heading: [h.top, h.bottom], upd: [n.top, n.bottom], card: document.getElementById("bk-check").getBoundingClientRect().height, screen: innerHeight }; });
      assert.ok(m.active === "bk-check-h" && m.heading[0] >= m.header && m.upd[1] <= m.screen, JSON.stringify(m));
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const host of name === "chromium" ? ["/locations/manhattan", "/services"] : ["/locations/manhattan"]) {
    for (const width of [390, 1440]) {
      const ctx = await engineContext(b, P, { viewport: { width, height: width < 1024 ? 844 : 900 }, reducedMotion: "reduce" });
      await check(`B121 ${name} ${host} at ${width}: someone else riding goes from the details step to this search page and back through Book your ride with the box still checked, so the payment carries the passenger`, async () => {
        const p = await open(ctx, P, "/book");
        const saved = () => p.evaluate(() => { const f = JSON.parse(sessionStorage.getItem("nlr-book")).fields; return [f.rider, f.pname, f.pphone]; });
        const want = ["other", "Sam Lee", "212 555 0199"];
        await trip(p);
        await view(p);
        await priced(p);
        await next(p);
        await priced(p);
        await details(p, { name: ME.name, email: ME.email, phone: "212 555 0100" });
        await p.check("#bk-r-other");
        await p.fill("#bk-pname", want[1]);
        await p.fill("#bk-pphone", want[2]);
        await p.waitForFunction((w) => { const f = JSON.parse(sessionStorage.getItem("nlr-book")).fields; return [f.rider, f.pname, f.pphone].join("|") === w; }, want.join("|"));
        await p.goto(`${P.base}${host}`, { waitUntil: "load" });
        await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js") && document.getElementById("bk-from").value !== "");
        assert.equal(await p.$("#bk-r-other"), null, "the search page has no rider control");
        await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
        await priced(p);
        assert.deepEqual(await saved(), want, "Book your ride on the search page keeps the stored rider");
        await next(p);
        await priced(p);
        assert.deepEqual([await p.isChecked("#bk-r-other"), await p.inputValue("#bk-pname"), await p.isVisible("#bk-pname")], [true, want[1], true]);
        const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
        const body = JSON.parse(req.postData());
        assert.deepEqual([body.rider, body.pname, body.pphone], want);
        assert.deepEqual(p.errors, []);
        await p.close();
      });
      await ctx.close();
    }
  }
}

for (const [name, b] of ENGINES) {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B120 ${name} at ${width}: Book and pay online pressed while the new class total is still loading waits for it, then the second visit shows Trip updated with that total`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p, { to: ["The New York EDITION, 701 7th Ave, New York, NY 10036"] });
      await view(p);
      await priced(p);
      await next(p);
      await priced(p);
      const total = () => p.evaluate(() => document.getElementById("price-total").firstChild.textContent);
      const first = await total();
      await p.click('#bk-check-rows button[data-c="car"]');
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
      await priced(p);
      await p.click('label[for="bk-c-premium"]');
      assert.equal(await p.getAttribute("#price-total", "aria-busy"), "true", "the new total is still loading at the press");
      await next(p);
      await p.waitForSelector("#bk-upd");
      await priced(p);
      const now = await total();
      assert.notEqual(now, first);
      assert.equal((await p.textContent("#bk-upd")).trim(), `Trip updated. The total is now ${now}.`);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const [width, height] of [[336, 900], [375, 844], [960, 800]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B122 ${name} at ${width}: after the date chip on step 2 the search form has the columns of a fresh load at once, and one press on Book your ride opens step 2`, async () => {
      const p = await open(ctx, P, "/book");
      const cols = () => p.evaluate(() => getComputedStyle(document.getElementById("bk-search")).gridTemplateColumns);
      const fresh = await cols();
      await trip(p);
      await view(p);
      await p.click("#bk-sum [data-f=when]");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => document.getElementById("bk-cal").hidden);
      assert.equal(await cols(), fresh);
      await tap(p, "#bk-view");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options", null, { timeout: 4000 });
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const [width, height] of [[320, 700], [340, 700], [390, 844], [1024, 768], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B123 ${name} at ${width}: a change of country code never moves the mobile number field, and the example number fits in it`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      const m = await p.evaluate(async () => {
        const s = document.getElementById("bk-phone-cc"), i = document.getElementById("bk-phone"), lefts = [];
        for (const v of ["US", "GB", "IE", "FK", "AE", "US"]) {
          s.value = v;
          s.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((r) => requestAnimationFrame(r));
          lefts.push(Math.round(i.getBoundingClientRect().left * 10) / 10);
        }
        const cs = getComputedStyle(i, "::placeholder"), g = document.createElement("canvas").getContext("2d"), st = getComputedStyle(i);
        g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        g.letterSpacing = cs.letterSpacing;
        return { n: s.options.length, lefts, ph: i.placeholder, text: g.measureText(i.placeholder).width, room: i.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) };
      });
      assert.ok(m.n > 200, `${m.n} country codes`);
      assert.deepEqual(m.lefts, m.lefts.map(() => m.lefts[0]));
      assert.ok(m.ph === "For example 212 555 0100" && m.text <= m.room, `${Math.round(m.text)} px of example in ${Math.round(m.room)} px`);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const path of ["/book", "/", "/services"]) {
    const ctx = await engineContext(b, P, { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await check(`B124 ${name} ${path}: from 320 to 430 no item of the trust row under the booking form ends on a line under half as long as its longest`, async () => {
      const p = await open(ctx, P, path);
      const bad = [];
      for (const width of [320, 360, 375, 390, 414, 430]) {
        await p.setViewportSize({ width, height: 844 });
        await p.evaluate(() => document.fonts.ready);
        bad.push(...(await p.evaluate((w) => [...document.querySelectorAll("#bk-assure>li")].filter((li) => li.getClientRects().length).flatMap((li) => {
          const lines = [], walk = document.createTreeWalker(li, NodeFilter.SHOW_TEXT), r = document.createRange();
          for (let n; (n = walk.nextNode());) {
            r.selectNodeContents(n);
            for (const q of r.getClientRects()) {
              if (q.width < 2) continue;
              const l = lines.find((x) => Math.abs(x.y - q.top) < 4);
              l ? (l.w += q.width) : lines.push({ y: q.top, w: q.width });
            }
          }
          return lines.length > 1 && lines.at(-1).w < Math.max(...lines.map((l) => l.w)) / 2 ? [`${w}: ${li.textContent} (${lines.map((l) => Math.round(l.w)).join(", ")})`] : [];
        }), width)));
      }
      assert.deepEqual(bad, []);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    for (const blur of [false, true]) {
      await check(`B125 ${name} at ${width}: after a failed Book and pay online, name, email and mobile filled the way autofill fills them (value, input and change, no key or pointer press${blur ? ", with focus and blur around each field" : ""}) move nothing, their messages go at once, the summary keeps its place with every row turned into a check under All fixed and no empty box, and the next press gives their room back`, async () => {
        const p = await open(ctx, P, "/book");
        await trip(p);
        await view(p);
        await priced(p);
        await next(p);
        const box = () => p.evaluate(() => ["bk-name-f", "bk-email-f", "bk-phone-f", "bk-reach", "bk-act", "bk-submit", "q-mail"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round((r.top + scrollY) * 2) / 2, Math.round(r.height * 2) / 2]; }));
        const fresh = await box();
        await p.click(await payBtn(p));
        await p.waitForFunction(() => document.querySelectorAll("#bk-det .bk-e.is-on").length === 3 && document.querySelectorAll("#bk-errs a").length === 3);
        await p.waitForTimeout(700);
        const before = await box();
        await p.evaluate(() => { window.__ls = []; if ((PerformanceObserver.supportedEntryTypes || []).includes("layout-shift")) new PerformanceObserver((l) => { for (const e of l.getEntries()) e.hadRecentInput || window.__ls.push(e.sources.map((s) => (s.node && (s.node.id || s.node.className)) || "?").join(",")); }).observe({ type: "layout-shift" }); });
        await p.evaluate((blur) => {
          for (const [id, v] of [["bk-name", "Ana Lopez"], ["bk-email", "ana.lopez@example.com"], ["bk-phone", "212 555 0100"]]) {
            const e = document.getElementById(id);
            if (blur) e.focus();
            e.value = v;
            e.dispatchEvent(new Event("input", { bubbles: true }));
            e.dispatchEvent(new Event("change", { bubbles: true }));
            if (blur) e.blur();
          }
        }, blur);
        await p.waitForTimeout(1000);
        assert.deepEqual(await box(), before, "nothing moves while the values arrive");
        assert.deepEqual(await p.evaluate(() => window.__ls), [], "no layout shift without a press");
        assert.deepEqual(await p.evaluate(() => [[...document.querySelectorAll("#bk-det .bk-e")].filter((e) => e.getClientRects().length).map((e) => e.id), ["bk-name", "bk-email", "bk-phone"].map((id) => document.getElementById(id).getAttribute("aria-invalid")), document.getElementById("bk-errs").hidden, document.querySelectorAll("#bk-errs a").length]), [[], [null, null, null], false, 0], "the messages and the invalid marks go at once and the summary stays");
        assert.deepEqual(await p.evaluate(() => { const r = document.getElementById("bk-errs"); return { title: r.firstChild.textContent, ok: r.classList.contains("is-ok"), rows: [...r.querySelectorAll("li")].map((l) => [l.className, l.getAttribute("aria-hidden"), l.textContent]), empty: [r, ...r.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().height > 1 && !e.textContent.trim()).map((e) => e.tagName), hidden: getComputedStyle(r).visibility }; }), { title: "All fixed", ok: true, rows: [["is-ok", "true", "Add your full name."], ["is-ok", "true", "Add your email address, for example name@example.com."], ["is-ok", "true", "Add your mobile number, and check its country code."]], empty: [], hidden: "visible" }, "the summary keeps its rows, each a check, and shows no empty box");
        await p.click("#bk-email");
        await p.keyboard.press("ControlOrMeta+A");
        await p.keyboard.type("ana@example");
        await p.click(await payBtn(p));
        await p.waitForFunction(() => document.getElementById("e-email").classList.contains("is-on"));
        const last = await box();
        assert.deepEqual([last[0][1], last[2][2], last[1][2]], [fresh[0][1], fresh[2][2], before[1][2]], "the press gives the room back: the fields start where they do on a fresh step, the mobile field is as high as there and the email field keeps its message");
        assert.deepEqual(await p.evaluate(() => [[...document.querySelectorAll("#bk-det .bk-e.is-on")].map((e) => e.id), document.activeElement.id, document.querySelectorAll("#bk-det [style*=min-height]").length, document.getElementById("bk-errs").style.cssText, document.getElementById("bk-errs").getClientRects().length]), [["e-email"], "bk-email", 0, "", 0]);
        await p.keyboard.press("ControlOrMeta+A");
        await p.keyboard.type("ana@example.com");
        await p.waitForFunction(() => !document.getElementById("e-email").classList.contains("is-on"));
        assert.deepEqual([(await box())[1][2], await p.evaluate(() => document.querySelectorAll("#bk-det [style*=min-height]").length)], [fresh[1][2], 0], "a typed fix gives its room back at once, as before");
        assert.deepEqual(await p.evaluate(() => window.__ls), [], "the room comes back right after a press or a key");
        assert.deepEqual(p.errors, []);
        await p.close();
      });
    }
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B126 ${name} at ${width}: after a failed Book and pay online, typing a valid name, email and mobile keeps the field being typed in still (1 px at most), each fix turns its summary row into a check, the count drops to All fixed and the summary keeps its height`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await p.click(await payBtn(p));
      await p.waitForFunction(() => document.querySelectorAll("#bk-errs a").length === 3);
      await p.waitForTimeout(500);
      const tall = () => p.evaluate(() => Math.round(document.getElementById("bk-errs").getBoundingClientRect().height));
      const h0 = await tall();
      const moved = [], titles = [];
      for (const [id, text] of [["bk-name", "Ana Lopez"], ["bk-email", "ana.lopez@example.com"], ["bk-phone", "2125550100"]]) {
        await p.click(`#${id}`);
        await p.waitForTimeout(150);
        for (const ch of text) {
          const a = await p.evaluate((i) => document.getElementById(i).getBoundingClientRect().top, id);
          await p.keyboard.type(ch);
          const c = await p.evaluate((i) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementById(i).getBoundingClientRect().top)))), id);
          if (Math.abs(c - a) > 1) moved.push(`${id} ${JSON.stringify(ch)} ${Math.round(c - a)}px`);
        }
        titles.push(await p.textContent("#bk-errs p"));
      }
      assert.deepEqual(moved, [], "the field being typed in moved");
      assert.deepEqual(titles, ["2 things to fix", "1 thing to fix", "All fixed"]);
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-errs li")].map((l) => [l.className, l.getAttribute("aria-hidden")])), [["is-ok", "true"], ["is-ok", "true"], ["is-ok", "true"]]);
      assert.equal(await tall(), h0, "the summary keeps its height");
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

const VIEW_STEPS = () => {
  window.__st = [];
  let y = null;
  const f = () => {
    const v = document.getElementById("bk-view").getBoundingClientRect().top + scrollY;
    if (y !== null && Math.round(v - y)) window.__st.push(Math.round(v - y));
    y = v;
    if (window.__st.length < 80) window.__fr = requestAnimationFrame(f);
  };
  window.__fr = requestAnimationFrame(f);
};
const stopFrames = (p) => p.evaluate(() => (cancelAnimationFrame(window.__fr), window.__st));
for (const [name, b] of ENGINES) {
  for (const width of [390, 768]) {
    for (const motion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, G, { viewport: { width, height: width < 600 ? 844 : 1024 }, reducedMotion: motion });
      await check(`B127 ${name} at ${width} with ${motion} motion, on / and /book: Flight number ${motion === "reduce" ? "opens at once" : "grows smoothly, no frame over 24 px,"} to the room of the flight answer when it gets focus, then typing the number and the answer move nothing`, async () => {
        for (const path of ["/", "/book"]) {
          const p = await open(ctx, G, path);
          await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
          await place(p, "to", "350 5th Ave, New York, NY 10118");
          await p.waitForFunction(() => document.getElementById("bk-to-area").getClientRects().length > 0, null, { timeout: 8000 });
          await p.$eval("#bk-flight", (e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
          await p.waitForTimeout(300);
          const at = () => p.evaluate(() => [Math.round(document.getElementById("bk-view").getBoundingClientRect().top + scrollY), Math.round(document.getElementById("bk-flight-status").getBoundingClientRect().height)]);
          const a = await at();
          await p.evaluate(VIEW_STEPS);
          await p.click("#bk-flight");
          await p.waitForTimeout(800);
          const steps = await stopFrames(p);
          const c = await at();
          assert.ok(c[1] >= 100 && c[0] - a[0] >= c[1] - a[1] && c[0] - a[0] <= c[1] - a[1] + 8, `${path}: the room is ${c[1]}px and Book your ride moved ${c[0] - a[0]}px`);
          if (motion === "reduce") assert.equal(steps.length, 1, `${path}: ${steps}`);
          else assert.ok(steps.length >= 5 && Math.max(...steps.map(Math.abs)) <= 24, `${path}: ${steps}`);
          await p.keyboard.type("EK201", { delay: 60 });
          await p.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc button"), null, { timeout: 8000 });
          await p.waitForTimeout(400);
          assert.deepEqual(await at(), c, `${path}: typing the number or the answer moved Book your ride or resized the room`);
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      });
      await ctx.close();
    }
  }
}
for (const [name, b] of ENGINES) {
  for (const width of [390, 768]) {
    for (const motion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, G, { viewport: { width, height: width < 600 ? 844 : 1024 }, reducedMotion: motion });
      await check(`B128 ${name} at ${width} with ${motion} motion: a pickup time before the landing adds its line under Pickup time ${motion === "reduce" ? "at once" : "smoothly, no frame over 24 px"}`, async () => {
        const p = await open(ctx, G, "/book");
        await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
        await place(p, "to", "350 5th Ave, New York, NY 10118");
        await pickDate(p, "#bk-date-btn", DATE);
        await p.keyboard.press("Escape");
        await p.fill("#bk-flight", "EK201");
        await p.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc"), null, { timeout: 8000 });
        const y0 = await p.evaluate(() => Math.round(document.getElementById("bk-view").getBoundingClientRect().top + scrollY));
        if ((await p.getAttribute("#bk-time-btn", "aria-expanded")) !== "true") await p.click("#bk-time-btn");
        const o = p.locator('#bk-tm [role=option][data-v="14:00"]');
        await p.waitForFunction(() => getComputedStyle(document.getElementById("bk-tm")).opacity === "1");
        await scrollIdle(p);
        await o.evaluate((x) => { const l = x.closest("[role=listbox]"), a = x.getBoundingClientRect(), c = l.getBoundingClientRect(); l.scrollTop += a.top - c.top - (c.height - a.height) / 2; });
        await p.evaluate(VIEW_STEPS);
        await o.click();
        await p.waitForTimeout(800);
        const steps = await stopFrames(p);
        const [y1, hint] = await p.evaluate(() => [Math.round(document.getElementById("bk-view").getBoundingClientRect().top + scrollY), document.getElementById("bk-time-h").textContent]);
        assert.equal(hint, "This pickup is before your flight lands.");
        const grew = y1 - y0;
        assert.ok(grew >= 20 && Math.abs(steps.reduce((x, v) => x + v, 0) - grew) <= steps.length, `Book your ride moved ${grew}px in ${steps}`);
        if (motion === "reduce") assert.equal(steps.length, 1, String(steps));
        else assert.ok(steps.length >= 5 && Math.max(...steps.map(Math.abs)) <= 24, String(steps));
        assert.deepEqual(p.errors, []);
        await p.close();
      });
      await ctx.close();
    }
  }
}
for (const [name, b] of ENGINES) {
  for (const [width, height] of [[320, 640], [1024, 768], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B129 ${name} at ${width}: when Add return trip is used it keeps its place, so Add stop, the link row and Date stay where they are, and Remove return trip brings it back there`, async () => {
      const p = await open(ctx, P, "/locations/jfk-airport");
      await place(p, "to", "350 5th Ave, New York, NY 10118");
      await p.waitForTimeout(200);
      const at = () => p.evaluate(() => ["bk-addstop", "bk-adds", "bk-date-f"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.height)]; }));
      const a = await at();
      await p.click("#bk-addret");
      await p.waitForFunction(() => document.getElementById("bk-ret").checked);
      assert.deepEqual([await at(), await p.isVisible("#bk-addret")], [a, false], "Add stop, the link row or Date moved");
      await p.click("#bk-rmret");
      await p.waitForFunction(() => !document.getElementById("bk-ret").checked);
      assert.deepEqual([await at(), await p.isVisible("#bk-addret")], [a, true]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  for (const width of [320, 375, 390]) {
    const ctx = await engineContext(b, P, { viewport: { width, height: 844 }, reducedMotion: "reduce" });
    await check(`B130 ${name} at ${width}: the clock time and New York time stay whole on Check your trip and on the confirmation, and 24 hours stays whole in the help line`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      const whole = (sel) => p.evaluate((q) => [...document.querySelectorAll(q)].map((e) => { const r = document.createRange(); r.selectNodeContents(e); return [e.textContent, new Set([...r.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size]; }), sel);
      assert.deepEqual(await whole("#bk-check-rows dd .nowrap"), [["12:40 PM", 1], ["New York time", 1]]);
      await details(p);
      await Promise.all([p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { timeout: 20000 }), p.click(await payBtn(p))]);
      await p.waitForFunction(() => /\d/.test((document.getElementById("cf-total") || {}).textContent || ""), null, { timeout: 15000 });
      assert.deepEqual(await whole("#cf-rows dd .nowrap"), [["12:40 PM", 1], ["New York time", 1]]);
      assert.deepEqual(await whole("#cf-help .nowrap"), [["24 hours", 1]]);
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
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
  if (!cb) console.log("  ..   classic scroll bars cannot be forced here, B131 is skipped");
  else {
    for (const [width, height] of [[1024, 768], [1060, 800]]) {
      const ctx = await engineContext(cb, P, { viewport: { width, height }, reducedMotion: "reduce" });
      await check(`B131 chromium at ${width} with classic 15 px scroll bars, as on Windows or a Mac with a mouse: Choose your vehicle stays on one line`, async () => {
        const p = await open(ctx, P, "/book");
        assert.equal(await p.evaluate(() => innerWidth - document.documentElement.scrollWidth), 15, "the scroll bar takes no room, so this run proves nothing");
        await trip(p);
        await view(p);
        await priced(p);
        assert.equal(await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("bk-opt-h").lastChild); return r.getClientRects().length; }), 1);
        assert.deepEqual(p.errors, []);
        await p.close();
      });
      await ctx.close();
    }
    await cb.close();
  }
}

const SHIFTS = () => { window.__ls = []; if ((PerformanceObserver.supportedEntryTypes || []).includes("layout-shift")) new PerformanceObserver((l) => { for (const e of l.getEntries()) e.hadRecentInput || window.__ls.push(e.sources.map((s) => (s.node && (s.node.id || s.node.className)) || "?").join(",")); }).observe({ type: "layout-shift" }); };
const TIMED_STEPS = (id) => {
  window.__st = [];
  let y = null, t = null;
  const f = (now) => {
    const v = document.getElementById(id).getBoundingClientRect().top + scrollY;
    if (y !== null && Math.round(v - y)) window.__st.push([Math.round(v - y), Math.round(now - t)]);
    y = v;
    t = now;
    if (window.__st.length < 80) window.__fr = requestAnimationFrame(f);
  };
  window.__fr = requestAnimationFrame(f);
};
const glides = (steps) => steps.length >= 2 && steps.every(([d, dt]) => Math.abs(d) <= 24 * Math.max(1, dt / 17));
const fmtSteps = (steps) => steps.map(([d, dt]) => `${d}px/${dt}ms`).join(" ");
for (const [name, b] of ENGINES) {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const ctx = await engineContext(b, P, { viewport: { width, height }, reducedMotion: "reduce" });
    await check(`B132 ${name} at ${width}: after a failed Book and pay online, a fixed field that goes wrong again, by a wrong email or by emptying it, turns its summary row back into its link and the count back up at once, gets its message and invalid mark back when it is left, and All fixed shows only while every field is right`, async () => {
      const p = await open(ctx, P, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await p.click(await payBtn(p));
      await p.waitForFunction(() => document.querySelectorAll("#bk-errs a").length === 3);
      await p.waitForTimeout(500);
      const h0 = await p.evaluate(() => Math.round(document.getElementById("bk-errs").getBoundingClientRect().height));
      const sum = () => p.evaluate(() => { const r = document.getElementById("bk-errs"); return [r.firstChild.textContent, [...r.querySelectorAll("li")].map((l) => (l.querySelector("a") ? l.querySelector("a").getAttribute("href") : `${l.className} ${l.getAttribute("aria-hidden")}`)), r.classList.contains("is-ok"), Math.round(r.getBoundingClientRect().height), document.getElementById("e-email").classList.contains("is-on"), document.getElementById("bk-email").getAttribute("aria-invalid")]; });
      await p.evaluate(SHIFTS);
      await p.click("#bk-email");
      await p.keyboard.type("ana.lopez@example.com");
      assert.deepEqual(await sum(), ["2 things to fix", ["#bk-name", "is-ok true", "#bk-phone"], false, h0, false, null], "a typed fix turns its row into a check");
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.type("ana@example");
      assert.deepEqual(await sum(), ["3 things to fix", ["#bk-name", "#bk-email", "#bk-phone"], false, h0, false, null], "a wrong email turns the row back into its link at once, and its message waits while the field is typed in");
      await p.keyboard.press("Tab");
      await p.waitForFunction(() => document.getElementById("e-email").classList.contains("is-on"));
      assert.deepEqual(await sum(), ["3 things to fix", ["#bk-name", "#bk-email", "#bk-phone"], false, h0, true, "true"], "leaving the email wrong brings its message and invalid mark back");
      await p.fill("#bk-name", "Ana Lopez");
      await p.fill("#bk-phone", "+1 212 555 0100");
      assert.deepEqual((await sum()).slice(0, 4), ["1 thing to fix", ["is-ok true", "#bk-email", "is-ok true"], false, h0], "the wrong email keeps All fixed away");
      await p.click("#bk-email");
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.type("ana@example.com");
      await p.waitForFunction(() => !document.getElementById("e-email").classList.contains("is-on"));
      assert.deepEqual(await sum(), ["All fixed", ["is-ok true", "is-ok true", "is-ok true"], true, h0, false, null]);
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.press("Backspace");
      assert.deepEqual(await sum(), ["1 thing to fix", ["is-ok true", "#bk-email", "is-ok true"], false, h0, false, null], "emptying a fixed field turns its row back into its link at once");
      await p.keyboard.press("Tab");
      await p.waitForFunction(() => document.getElementById("e-email").classList.contains("is-on"));
      assert.deepEqual((await sum()).slice(0, 2).concat((await sum()).slice(4)), ["1 thing to fix", ["is-ok true", "#bk-email", "is-ok true"], true, "true"], "leaving it empty brings its message and invalid mark back");
      assert.deepEqual(await p.evaluate(() => window.__ls), [], "nothing moves without a key or a press");
      assert.deepEqual(p.errors, []);
      await p.close();
    });
    await ctx.close();
  }
}
for (const [name, b] of ENGINES) {
  for (const width of [390, 768]) {
    for (const motion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, G, { viewport: { width, height: width < 600 ? 844 : 1024 }, reducedMotion: motion });
      await check(`B133 ${name} at ${width} with ${motion} motion, on / and /book: Flight number left empty, with part of a number, with a number that is not found or after a failed lookup gives its answer room back ${motion === "reduce" ? "at once" : "smoothly, no frame over 24 px,"} down to the line it shows, with no shift that a key or a tap did not start, and tabbing through the empty field leaves no room`, async () => {
        for (const [path, num] of [["/", ""], ["/", "ZZ9999"], ["/book", "EK"], ["/book", "ZZ5000"]]) {
          const p = await open(ctx, G, path);
          await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
          await place(p, "to", "350 5th Ave, New York, NY 10118");
          await p.waitForFunction(() => document.getElementById("bk-to-area").getClientRects().length > 0, null, { timeout: 8000 });
          await p.$eval("#bk-flight", (e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
          await p.waitForTimeout(300);
          const at = () => p.evaluate(() => { const s = document.getElementById("bk-flight-status"), r = s.getBoundingClientRect(), q = document.createRange(); q.selectNodeContents(s); const t = [...q.getClientRects()].filter((x) => x.height > 1); return [Math.round(document.getElementById("bk-view").getBoundingClientRect().top + scrollY), Math.round(r.height), Math.round(r.height - (t.length ? Math.max(...t.map((x) => x.bottom)) - r.top : 0))]; });
          await p.click("#bk-flight");
          await p.waitForTimeout(500);
          if (num) await p.keyboard.type(num, { delay: 40 });
          if (/\d/.test(num)) {
            await p.waitForResponse((r) => r.url().includes("/api/flight") && (r.request().postData() || "").includes(num), { timeout: 8000 });
            await p.waitForFunction(() => !document.querySelector("#bk-flight-status .bk-ring"));
            await p.waitForTimeout(200);
          }
          const o = await at();
          assert.ok(o[1] >= 100 && o[2] >= 40, `${path} ${num}: the open room is ${o[1]}px with ${o[2]}px blank`);
          await p.evaluate(SHIFTS);
          await p.evaluate(TIMED_STEPS, "bk-view");
          await p.waitForTimeout(100);
          await p.keyboard.press("Tab");
          await p.waitForTimeout(800);
          const steps = await stopFrames(p);
          const c = await at();
          assert.ok(c[2] <= 2 && c[1] < o[1] - 40, `${path} ${num}: the box is ${c[1]}px with ${c[2]}px blank after the field was left`);
          assert.ok(Math.abs(o[0] - c[0] - (o[1] - c[1])) <= 1, `${path} ${num}: Book your ride moved ${c[0] - o[0]}px for ${o[1] - c[1]}px of room`);
          if (motion === "reduce") assert.equal(steps.length, 1, `${path} ${num}: ${fmtSteps(steps)}`);
          else assert.ok(glides(steps), `${path} ${num}: ${fmtSteps(steps)}`);
          assert.deepEqual(await p.evaluate(() => window.__ls), [], `${path} ${num}: a shift without a key or a tap`);
          if (!num) {
            await p.keyboard.press("Shift+Tab");
            await p.waitForFunction(() => document.activeElement.id === "bk-flight");
            await p.waitForTimeout(600);
            assert.ok((await at())[1] >= 100, `${path}: the room opens again on the way back in`);
            await p.keyboard.press("Tab");
            await p.waitForTimeout(800);
            assert.deepEqual(await at(), c, `${path}: tabbing through the empty field leaves no room`);
          }
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      });
      await ctx.close();
    }
  }
}
for (const [name, b] of ENGINES) {
  for (const [width, height] of [[320, 256], [360, 225]]) {
    for (const motion of ["reduce", "no-preference"]) {
      const ctx = await engineContext(b, G, { viewport: { width, height }, reducedMotion: motion });
      await check(`B133 ${name} at ${width} by ${height}, a laptop at 400% zoom, with ${motion} motion, on /book and /: Tab from Flight number to Pickup time leaves Pickup time whole in view under the sticky header once the flight room has closed (WCAG 2.4.11)`, async () => {
        for (const path of ["/book", "/"]) {
          const p = await open(ctx, G, path);
          await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
          await p.evaluate(() => { document.activeElement.blur(); scrollTo({ top: 0, behavior: "instant" }); });
          await p.focus("#bk-flight");
          await p.waitForTimeout(500);
          await p.keyboard.press(name === "webkit" ? "Alt+Tab" : "Tab");
          await p.waitForFunction(() => document.activeElement.id === "bk-time-btn" && document.getElementById("bk-flight-status").getAnimations().every((a) => a.playState !== "running"));
          await scrollIdle(p);
          const at = await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return [Math.round(r.top - document.querySelector(".site-header").getBoundingClientRect().bottom), Math.round(innerHeight - r.bottom)]; });
          assert.ok(at[0] >= 0 && at[1] >= 0, `${path}: Pickup time is ${at[0]}px under the header bottom and ${at[1]}px over the window bottom`);
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      });
      await ctx.close();
    }
  }
}
for (const [name, b] of ENGINES) {
  for (const width of [390, 768]) {
    for (const motion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, G, { viewport: { width, height: width < 600 ? 844 : 1024 }, reducedMotion: motion });
      await check(`B134 ${name} at ${width} with ${motion} motion, on / and /book: picking an airport as the pickup opens the flight row ${motion === "reduce" ? "at once" : "smoothly, no frame over 24 px,"} and nothing moves without the pick`, async () => {
        for (const path of ["/", "/book"]) {
          const p = await open(ctx, G, path);
          await type(p, "from", "jfk t4");
          const label = "John F. Kennedy (JFK), Terminal 4";
          const opt = p.locator(`#bk-from-list [role=option][aria-label="${label}"], #bk-from-list [role=option][aria-label="Terminal 4, John F. Kennedy (JFK)"]`).first();
          await opt.waitFor({ state: "visible" });
          await p.waitForTimeout(300);
          const y = () => p.evaluate(() => [Math.round(document.getElementById("bk-view").getBoundingClientRect().top + scrollY), document.getElementById("bk-flight-f").classList.contains("is-shown"), Math.round(document.getElementById("bk-flight-f").getBoundingClientRect().height)]);
          const a = await y();
          assert.equal(a[1], false, `${path}: the flight row shows before the pick`);
          await p.evaluate(SHIFTS);
          await p.evaluate(TIMED_STEPS, "bk-view");
          await opt.click();
          await p.waitForTimeout(800);
          const steps = await stopFrames(p);
          const c = await y();
          assert.ok(c[1] && c[2] >= 40 && c[0] - a[0] >= c[2], `${path}: the row is ${c[2]}px and Book your ride moved ${c[0] - a[0]}px`);
          if (motion === "reduce") assert.equal(steps.length, 1, `${path}: ${fmtSteps(steps)}`);
          else assert.ok(glides(steps), `${path}: ${fmtSteps(steps)}`);
          assert.deepEqual(await p.evaluate(() => window.__ls), [], `${path}: a shift without the pick`);
          assert.deepEqual(p.errors, []);
          await p.close();
        }
      });
      await ctx.close();
    }
  }
}
for (const [name, b] of ENGINES) {
  for (const [width, height] of [[1440, 900], [1024, 768]]) {
    for (const motion of ["no-preference", "reduce"]) {
      const ctx = await engineContext(b, G, { viewport: { width, height }, reducedMotion: motion });
      await check(`B135 ${name} / at ${width} with ${motion} motion: on the desktop homepage the before-landing line under Pickup time comes and goes ${motion === "reduce" ? "at once" : "smoothly, no frame over 24 px,"} as on /book, so the flight row slides`, async () => {
        const p = await open(ctx, G, "/");
        await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
        await place(p, "to", "350 5th Ave, New York, NY 10118");
        await p.waitForFunction(() => document.getElementById("bk-to-area").getClientRects().length > 0, null, { timeout: 8000 });
        await pickDate(p, "#bk-date-btn", DATE);
        await p.keyboard.press("Escape");
        await p.fill("#bk-flight", "EK201");
        await p.waitForFunction(() => document.querySelector("#bk-flight-status .bk-flc"), null, { timeout: 8000 });
        for (const [v, on] of [["14:00", true], ["16:00", false]]) {
          const y0 = await p.evaluate(() => Math.round(document.getElementById("bk-flight-f").getBoundingClientRect().top + scrollY));
          if ((await p.getAttribute("#bk-time-btn", "aria-expanded")) !== "true") await p.click("#bk-time-btn");
          const o = p.locator(`#bk-tm [role=option][data-v="${v}"]`);
          await p.waitForFunction(() => getComputedStyle(document.getElementById("bk-tm")).opacity === "1");
          await scrollIdle(p);
          await o.evaluate((x) => { const l = x.closest("[role=listbox]"), a = x.getBoundingClientRect(), c = l.getBoundingClientRect(); l.scrollTop += a.top - c.top - (c.height - a.height) / 2; });
          await p.evaluate(TIMED_STEPS, "bk-flight-f");
          await o.click();
          await p.waitForTimeout(800);
          const steps = await stopFrames(p);
          const [y1, hint] = await p.evaluate(() => [Math.round(document.getElementById("bk-flight-f").getBoundingClientRect().top + scrollY), document.getElementById("bk-time-h").hidden ? "" : document.getElementById("bk-time-h").textContent]);
          assert.equal(hint, on ? "This pickup is before your flight lands." : "", v);
          const moved = y1 - y0;
          assert.ok((on ? moved : -moved) >= 20 && Math.abs(steps.reduce((x, s) => x + s[0], 0) - moved) <= steps.length, `${v}: the flight row moved ${moved}px in ${fmtSteps(steps)}`);
          if (motion === "reduce") assert.equal(steps.length, 1, `${v}: ${fmtSteps(steps)}`);
          else assert.ok(glides(steps), `${v}: ${fmtSteps(steps)}`);
        }
        assert.deepEqual(p.errors, []);
        await p.close();
      });
      await ctx.close();
    }
  }
}
for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 320, height: 844 }, reducedMotion: "reduce" });
  await check(`B136 ${name} from 320 to 430: S-Class and BMW 7 Series each stay on one line in the First Class card, and at 320 on Check your trip and on the confirmation`, async () => {
    const whole = (sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => e.getClientRects().length).flatMap((e) => {
      const out = [], walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode()); ) for (const m of n.data.matchAll(/S-Class|BMW\s7\sSeries/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        out.push([m[0].replace(/\s/g, " "), new Set([...r.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size]);
      }
      return out;
    }), sel);
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    for (const width of [320, 360, 375, 390, 414, 430]) {
      await p.setViewportSize({ width, height: 844 });
      await p.waitForTimeout(100);
      assert.deepEqual(await whole("#bk-m-first"), [["S-Class", 1], ["BMW 7 Series", 1]], `${width}`);
    }
    await p.setViewportSize({ width: 320, height: 844 });
    await p.click('label[for="bk-c-first"]');
    await p.waitForTimeout(300);
    await next(p);
    assert.deepEqual(await whole("#bk-check-rows dd"), [["S-Class", 1], ["BMW 7 Series", 1]], "Check your trip");
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { timeout: 20000 }), p.click(await payBtn(p))]);
    await p.waitForFunction(() => /\d/.test((document.getElementById("cf-total") || {}).textContent || ""), null, { timeout: 15000 });
    assert.deepEqual(await whole("#cf-rows dd"), [["S-Class", 1], ["BMW 7 Series", 1]], "the confirmation");
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 320, height: 800 }, javaScriptEnabled: false });
  await check(`B137 ${name} without javascript at 320: a line that cannot break and is wider than the card, added at the end of the actions, overflows on its own and leaves every field inside the booking card`, async () => {
    for (const path of ["/book", "/", "/locations/jfk-airport"]) {
      const p = await open(ctx, P, path);
      const out = await p.evaluate(() => {
        const f = document.getElementById("book-form"), x = document.createElement("p");
        x.textContent = "W".repeat(40);
        document.getElementById("bk-act").append(x);
        const edge = f.getBoundingClientRect().right - parseFloat(getComputedStyle(f).paddingRight) + 0.5;
        const r = document.createRange();
        r.selectNodeContents(x);
        return [r.getBoundingClientRect().right > edge, [...f.querySelectorAll(".field input:not([type=hidden]), .field select, .field textarea")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > edge).map((e) => e.id)];
      });
      assert.deepEqual(out, [true, []], path);
      await p.close();
    }
  });
  await ctx.close();
}

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const ctx = await context(G, { viewport: { width, height } });
  const ride = (cls) => {
    const r = DISTANCE_RATES[cls];
    const fare = Math.max(r.minimum, r.base + Math.round((46 * r.mile) / 10) + 27 * r.minute);
    return { fare, tax: percentCents(fare, NYC_TAX_PERCENT), bcf: percentCents(fare, BCF_PERCENT) };
  };
  const total = (cls) => { const x = ride(cls); return x.fare + x.tax + x.bcf; };
  await check(`B138 at ${width} a one-way trip with no airport end shows distance and time prices on the cards, the panel with no tolls line and the after the ride note, keeps CLS 0, and pays the same total with its route token`, async () => {
    const p = await open(ctx, G, "/book");
    await trip(p, { from: ["edition", "The New York EDITION"], to: ["bedford", "277 Bedford Avenue"], time: "14:00" });
    await view(p);
    await priced(p);
    await settle(p, 600);
    assert.deepEqual(await cards(p), [...CLASS_KEYS.slice(0, 4).map((cls) => cash(total(cls))), "Price on request"]);
    const suv = ride("suv");
    assert.deepEqual(await panel(p), { lines: [["Fare", cash(suv.fare)], [L_TAX, cash(suv.tax)], [L_BCF, cash(suv.bcf)]], total: cash(total("suv")), notes: POLICY.later.hourly });
    let [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    await p.click('label[for="bk-c-sprinter"]');
    await settle(p, 500);
    assert.deepEqual(await p.evaluate(() => [[...document.querySelectorAll("#quote .bk-q")].filter((e) => e.getClientRects().length).map((e) => e.id), document.getElementById("price").hidden]), [["q-sprinter-distance"], true]);
    assert.equal(await p.textContent("#q-sprinter-distance p"), REASONS["sprinter-distance"].text);
    await p.click('label[for="bk-c-sedan"]');
    await priced(p);
    await next(p);
    await details(p);
    await priced(p);
    const sedan = ride("sedan");
    const want = [["Fare", cash(sedan.fare)], [L_TAX, cash(sedan.tax)], [L_BCF, cash(sedan.bcf)]];
    assert.deepEqual((await panel(p)).lines, want);
    assert.ok((await waText(p, "#q-wa")).endsWith(`\nTotal shown: ${cash(total("sedan"))}\nName: Ana Lopez\nEmail: ana.lopez@example.com\nMobile: +1 212 555 0100\nContact: Phone`));
    const bodies = [];
    p.on("request", (r) => r.method() === "POST" && r.url().endsWith("/api/book") && bodies.push(JSON.parse(r.postData() || "{}")));
    await p.route("**/api/book?session_id=*", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue().catch(() => {}); });
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    assert.match(bodies.find((b) => b.action === "pay").route, /^r1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(await p.evaluate(() => [[...document.querySelectorAll("#cf-lines tr")].map((tr) => tr.cells[0].textContent), document.getElementById("cf-notes").textContent]), [["Fare", "NYC sales tax", "Black Car Fund"], POLICY.later.hourly]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    assert.deepEqual(await p.$$eval("#cf-lines tr", (r) => r.map((x) => [x.cells[0].textContent, x.cells[1].textContent])), want);
    assert.deepEqual([await p.textContent("#cf-total"), await p.textContent("#cf-notes")], [cash(total("sedan")), POLICY.later.hourly]);
    await p.waitForTimeout(300);
    [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual([p.errors, p.failed], [[], []]);
    await p.close();
  });
  await check(`B138 at ${width} Book your ride on /locations/manhattan hands a one-way trip with no airport end to /book, and on /book a price that takes over 500 ms, show the distance and time prices with the Luxury Sprinter on Price on request from the first frame and CLS 0`, async () => {
    for (const host of ["/locations/manhattan", "/book"]) {
      const p = await open(ctx, G, host);
      await place(p, "from", "edition", "The New York EDITION");
      await place(p, "to", "bedford", "277 Bedford Avenue");
      await pickDate(p, "#bk-date-btn", DATE);
      await setTime(p, "14:00");
      if (host === "/book") await p.route("**/api/book", async (route) => { if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 900)); await route.continue().catch(() => {}); });
      if (host === "/book") await p.click("#bk-view");
      else await Promise.all([p.waitForURL(/\/book/), p.click("#bk-view")]);
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
      assert.equal(await p.textContent("#bk-p-sprinter"), "Price on request", host);
      await priced(p);
      await settle(p, 600);
      assert.deepEqual(await cards(p), [...CLASS_KEYS.slice(0, 4).map((cls) => cash(total(cls))), "Price on request"], host);
      const [value, shifts] = await cls(p);
      assert.equal(value, 0, `${host}: ${shifts.join(" | ")}`);
      assert.deepEqual([p.errors, p.failed], [[], []], host);
      await p.close();
    }
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 390, height: 844 } });
  const form = async (p, path) => {
    await p.goto(`${G.base}${path}`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    return [await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id"), await p.inputValue("#bk-to"), (await p.inputValue("#bk-date")) === DATE];
  };
  await check("B143 an airport page restores this tab's trip only when its pickup is that airport: after a JFK trip the Newark and LaGuardia pages keep their own pickup with no drop-off, the JFK page and the homepage bring the trip back, and an EWR Terminal B trip comes back on the Newark page only", async () => {
    let p = await open(ctx, G, "/locations/jfk-airport");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await setTime(p, "14:00");
    await Promise.all([p.waitForURL(/\/book/), p.click("#bk-view")]);
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    const jfk = ["John F. Kennedy (JFK)", "jfk", "350 5th Ave, New York, NY 10118", true];
    assert.deepEqual(await form(p, "/locations/newark-airport"), ["Newark Liberty (EWR)", "ewr", "", false]);
    assert.deepEqual(await form(p, "/locations/laguardia-airport"), ["LaGuardia (LGA)", "lga", "", false]);
    assert.deepEqual(await form(p, "/locations/jfk-airport"), jfk);
    assert.deepEqual(await form(p, "/"), jfk);
    assert.deepEqual(p.errors, []);
    await p.close();
    p = await open(ctx, G, "/locations/newark-airport");
    await place(p, "from", "ewr terminal b", "Newark Liberty (EWR), Terminal B");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await setTime(p, "14:00");
    await Promise.all([p.waitForURL(/\/book/), p.click("#bk-view")]);
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    assert.deepEqual(await form(p, "/locations/newark-airport"), ["EWR Terminal B", "ewr-tb", "350 5th Ave, New York, NY 10118", true]);
    assert.deepEqual(await form(p, "/locations/jfk-airport"), ["John F. Kennedy (JFK)", "jfk", "", false]);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check("B145 step 2 of a round trip: the return chip opens the return calendar on the return day, a day picked there moves only the return, and the date chip still opens the pickup calendar on the pickup day", async () => {
    const p = await open(ctx, G, "/book");
    await trip(p, { from: ["edition", "The New York EDITION"], to: ["bedford", "277 Bedford Avenue"], time: "14:00" });
    await p.click("#bk-addret");
    await pickDate(p, "#bk-rdate-btn", RDATE);
    await setTime(p, "18:00", "#bk-rtime");
    await view(p);
    const open2 = async (n) => {
      await p.click(`#bk-sum .bk-chip:nth-child(${n})`);
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
      await scrollIdle(p);
      return p.evaluate(() => [document.getElementById("bk-cal").previousElementSibling.id, document.activeElement.dataset.day]);
    };
    assert.deepEqual((await chips(p)).slice(1), [`${shortDate(DATE)}, 2:00 PM`, `Return: ${shortDate(RDATE)}, 6:00 PM`]);
    assert.deepEqual(await open2(3), ["bk-rdate-btn", RDATE]);
    const later = nyDate(8);
    await pickDate(p, "#bk-rdate-btn", later);
    assert.deepEqual([await p.inputValue("#bk-date"), await p.inputValue("#bk-time"), await p.inputValue("#bk-rdate"), await p.inputValue("#bk-rtime")], [DATE, "14:00", later, "18:00"]);
    await view(p);
    assert.deepEqual((await chips(p)).slice(1), [`${shortDate(DATE)}, 2:00 PM`, `Return: ${shortDate(later)}, 6:00 PM`]);
    assert.deepEqual(await open2(2), ["bk-date-btn", DATE]);
    assert.deepEqual([p.errors, p.failed], [[], []]);
    await p.close();
  });
  await check("B146 the drive time belongs to its own trip: after a picked route showed 4.6 miles, about 27 min by car, a typed drop-off pays with the arrival time of its own route, an airport pickup with a flight whose route does not come pays with no drive time after pickup and an hour long calendar event, and a picked route still shows its arrival", async () => {
    const dm = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("nlr-book")).dm);
    const drawn = (p, m) => p.waitForFunction((x) => new RegExp(`about ${x} min by car`).test(document.getElementById("bk-route-n").textContent), m);
    const pay = async (p) => {
      await next(p);
      await details(p);
      await priced(p);
      await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
      await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent) && !document.getElementById("cf-gcal").hasAttribute("aria-disabled"));
      return p.evaluate(() => {
        const [a, z] = new URL(document.getElementById("cf-gcal").href).searchParams.get("dates").split("/").map((s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13)));
        return [document.getElementById("cf-route").textContent, (z - a) / 6e4];
      });
    };
    let p = await open(ctx, G, "/book");
    await trip(p, { from: ["edition", "The New York EDITION"], to: ["bedford", "277 Bedford Avenue"], time: "14:00" });
    await view(p);
    await drawn(p, 27);
    assert.equal(await dm(p), 27);
    await p.click("#bk-edit");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
    await place(p, "to", "Greenwich, CT 06830");
    await view(p);
    await priced(p);
    await drawn(p, 43);
    assert.equal(await dm(p), 43);
    const [route, minutes] = await pay(p);
    assert.match(route, /About 2:45 PM/);
    assert.equal(minutes, 43);
    await p.close();
    p = await open(ctx, G, "/book");
    await p.route("**/api/route", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"kind":"off"}' }));
    await trip(p, { from: ["edition", "The New York EDITION"], to: ["bedford", "277 Bedford Avenue"], time: "14:00" });
    await view(p);
    await drawn(p, 27);
    await p.click("#bk-edit");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-flight", "EK201");
    await view(p);
    await priced(p);
    await p.waitForFunction(() => !document.querySelector("#bk-route .bk-sk") && document.getElementById("bk-route-n").textContent === "");
    assert.equal(await dm(p), undefined);
    const [flown, hour] = await pay(p);
    assert.ok(!/About|after pickup/.test(flown), flown);
    assert.equal(hour, 60);
    await p.close();
    p = await open(ctx, G, "/book");
    await trip(p, { from: ["edition", "The New York EDITION"], to: ["bedford", "277 Bedford Avenue"], time: "14:00" });
    await view(p);
    await drawn(p, 27);
    const [picked, length] = await pay(p);
    assert.match(picked, /About 2:30 PM/);
    assert.equal(length, 27);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await check("B149 at 390 the Luxury Sprinter on a distance and time trip: the bar reads Our dispatch team prices this Sprinter trip with Choose another car, and Choose another car moves to a car with a price", async () => {
    const p = await open(ctx, G, "/book");
    await trip(p, { from: ["edition", "The New York EDITION"], to: ["bedford", "277 Bedford Avenue"], time: "14:00" });
    await view(p);
    await priced(p);
    await p.click('label[for="bk-c-sprinter"]');
    await p.waitForSelector("#q-sprinter-distance", { state: "visible" });
    await p.waitForTimeout(300);
    const b = await reqBar(p);
    assert.deepEqual([b.shown, b.isq, b.line, b.fix], [true, true, "Our dispatch team prices this Sprinter trip", "Choose another car"]);
    await p.click("#q-fix");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-c-suv");
    assert.deepEqual([p.errors, p.failed], [[], []]);
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await check("B144 a one-way trip with no airport end is priced at its pickup time: when the automatic pickup moves to the next slot before Book and pay online, the press asks for the total at the new time and shows it, and the next press pays that time", async () => {
    const p = await openAt(ctx, G, "/book", Date.now());
    const sent = posts(p);
    await place(p, "from", "edition", "The New York EDITION");
    await place(p, "to", "bedford", "277 Bedford Avenue");
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    await priced(p);
    const n = sent.length, was = sent[n - 1].time;
    await p.clock.setSystemTime(Date.now() + 20 * 6e4);
    await p.click("#bk-submit");
    await p.waitForFunction(() => location.pathname !== "/book" || /^The total is now \$[\d,]+\.\d\d\. Press Book and pay online to continue\.$/.test(document.getElementById("bk-status").textContent));
    assert.equal(new URL(p.url()).pathname, "/book", "the first press paid at the new time with no new total");
    const moved = sent.slice(n);
    assert.deepEqual(moved.map((b) => b.action), ["quote"], "the press asks for the new total before paying");
    assert.notEqual(moved[0].time, was);
    const shown = (await panel(p)).total;
    assert.equal(await p.textContent("#bk-status"), `The total is now ${shown}. Press Book and pay online to continue.`);
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click("#bk-submit")]);
    assert.deepEqual(sent.slice(n).map((b) => b.action + " " + b.time), ["quote " + moved[0].time, "pay " + moved[0].time]);
    await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
    assert.equal(await p.textContent("#cf-total"), shown);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

const BOOKABLE = () => {
  const on = [...document.querySelectorAll("#bk-cal [data-day]")].filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const seen = (b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; };
  return { on: on.length, seen: on.filter(seen).length, focus: document.activeElement.dataset.day || "", focusSeen: seen(document.activeElement), last: (on[on.length - 1] || {}).dataset?.day };
};
for (const [name, b] of ENGINES) {
  const touch = name === "firefox" ? { hasTouch: true } : { hasTouch: true, isMobile: true };
  for (const [width, height, motion] of name === "webkit" ? [[734, 343, "reduce"], [734, 343, "no-preference"], [667, 375, "reduce"]] : [[844, 390, "reduce"], [844, 390, "no-preference"], [740, 360, "reduce"]]) {
    const ctx = await engineContext(b, G, { viewport: { width, height }, ...touch, reducedMotion: motion });
    await check(`B147 ${name} at ${width} by ${height} with ${motion} motion: on a phone held sideways the date picker opens with every bookable day of the month and the focused day in view, and a tap on the last one picks it`, async () => {
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      await p.goto(`${G.base}/book`, { waitUntil: "load" });
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
      await place(p, "to", "350 5th Ave, New York, NY 10118");
      await scrollIdle(p);
      await p.tap("#bk-date-btn");
      await p.waitForFunction(() => !document.getElementById("bk-cal").hidden);
      await p.waitForTimeout(300);
      await scrollIdle(p);
      const r = await p.evaluate(BOOKABLE);
      assert.ok(r.on > 0 && r.seen === r.on && r.focus && r.focusSeen, JSON.stringify(r));
      await p.tap(`#bk-cal [data-day="${r.last}"]`);
      assert.equal(await p.inputValue("#bk-date"), r.last);
      await p.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  const ctx = await engineContext(b, P, { viewport: { width: 390, height: 844 }, ...(name === "firefox" ? { hasTouch: true } : { hasTouch: true, isMobile: true }) });
  for (const hour of [true, false]) {
    await check(`B148 ${name} at 390 with touch, ${hour ? "by the hour" : "one way"}: a tap at the end of a long pickup address lands in the field and keeps the address, because the clear button takes taps only from where the text ends`, async () => {
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      await p.goto(`${P.base}/book`, { waitUntil: "load" });
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      if (hour) await p.click('label[for="bk-hour"]');
      await type(p, "from", "350 5th Ave, New York, NY 10118");
      await p.keyboard.press("Escape");
      await p.evaluate(() => document.activeElement.blur());
      const [x, y, gap] = await p.evaluate(() => {
        const i = document.getElementById("bk-from"), r = i.getBoundingClientRect(), s = getComputedStyle(i), end = r.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight), mid = r.top + r.height / 2;
        let f = Math.ceil(r.left) + 1;
        while (f < r.right && document.elementFromPoint(f, mid) === i) f++;
        return [end - 3, mid, f - end];
      });
      assert.ok(gap >= -1, `the clear button takes taps ${-gap} px inside the text`);
      await p.touchscreen.tap(x, y);
      assert.equal(await p.inputValue("#bk-from"), "350 5th Ave, New York, NY 10118");
      await p.close();
    });
  }
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  await check(`B150 ${name} without javascript: /book#resume says nothing was charged and does not promise that the details are still there, and the form error /book#e-form is one text block next to its icon with no sideways scroll at 320 and 390`, async () => {
    for (const width of [320, 390]) {
      const ctx = await engineContext(b, P, { viewport: { width, height: 740 }, javaScriptEnabled: false });
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      await p.goto(`${P.base}/book#resume`, { waitUntil: "load" });
      await p.waitForSelector("#resume", { state: "visible" });
      assert.equal((await p.innerText("#resume")).replace(/\s+/g, " ").trim(), "Payment not completed. Nothing was charged. Book and pay online when you're ready.", `${width}`);
      await p.goto(`${P.base}/book#e-form`, { waitUntil: "load" });
      await p.waitForSelector("#e-form", { state: "visible" });
      const m = await p.evaluate(() => {
        const e = document.getElementById("e-form"), r = e.getBoundingClientRect(), s = e.firstElementChild.getBoundingClientRect();
        return { kids: [...e.children].map((c) => c.tagName), wide: s.width >= r.width * 0.75, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert.deepEqual(m, { kids: ["SPAN"], wide: true, over: 0 }, `${width}`);
      await ctx.close();
    }
  });
}

const { inflateSync } = await import("node:zlib");
const pngAt = (buf) => {
  let i = 8, w = 0, h = 0, ct = 0;
  const parts = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i), t = buf.toString("latin1", i + 4, i + 8);
    if (t === "IHDR") [w, h, ct] = [buf.readUInt32BE(i + 8), buf.readUInt32BE(i + 12), buf[i + 17]];
    if (t === "IDAT") parts.push(buf.subarray(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const bpp = { 6: 4, 2: 3, 4: 2 }[ct] || 1, s = w * bpp, raw = inflateSync(Buffer.concat(parts)), px = Buffer.alloc(h * s);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (s + 1)];
    for (let x = 0; x < s; x++) {
      const a = x >= bpp ? px[y * s + x - bpp] : 0, b = y ? px[(y - 1) * s + x] : 0, c = x >= bpp && y ? px[(y - 1) * s + x - bpp] : 0, q = a + b - c;
      const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      px[y * s + x] = (raw[y * (s + 1) + 1 + x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
  }
  return { w, h, dark: (x, y) => { const o = y * s + x * bpp; return (bpp >= 3 ? (px[o] + px[o + 1] + px[o + 2]) / 3 : px[o]) < 200; } };
};
const lined = async (p, sel) => {
  const rows = await p.evaluate((sel) => {
    const ol = document.querySelector(sel);
    if (!ol || !ol.getClientRects().length) return null;
    ol.scrollIntoView({ block: "center" });
    return [...ol.children].map((li) => {
      const r = li.getBoundingClientRect(), t = li.querySelector(".bk-route__t"), a = li.querySelector(".bk-route__p"), g = document.createRange();
      g.selectNodeContents(t);
      const text = [...g.getClientRects()];
      return { text: t.textContent, lines: new Set(text.map((x) => Math.round(x.top))).size, ink: text.length ? Math.max(...text.map((x) => x.right)) - r.left : 0, left: Math.round(t.getBoundingClientRect().left - r.left), end: Math.round(t.getBoundingClientRect().right - r.left), at: Math.round(a.getBoundingClientRect().left - r.left), x: r.left, y: r.top, line: parseFloat(getComputedStyle(a).lineHeight) };
    });
  }, sel);
  if (!rows) return null;
  for (const r of rows) {
    const img = pngAt(await p.screenshot({ clip: { x: r.x + r.end, y: r.y, width: r.at - r.end, height: r.line } }));
    const dot = [];
    for (let y = 0; y < img.h; y++) {
      const xs = [];
      for (let x = 0; x < img.w; x++) if (img.dark(x, y)) xs.push(x);
      if (xs.length >= 4) dot.push([y, xs[0], xs[xs.length - 1] + 1]);
    }
    r.dot = dot.length ? { gaps: [Math.min(...dot.map((d) => d[1])), img.w - Math.max(...dot.map((d) => d[2]))], y: (dot[0][0] + dot[dot.length - 1][0] + 1) / 2 } : null;
  }
  return rows;
};
const linedUp = (rows, where) => {
  const msg = `${where} ${JSON.stringify(rows)}`;
  assert.ok(rows && rows.length >= 2, msg);
  assert.ok(rows.every((r) => r.lines <= 1 && (r.text === "" || /^(About )?\d{1,2}:\d\d [AP]M$/.test(r.text))), `every time sits on one line: ${msg}`);
  assert.equal(new Set(rows.map((r) => r.left)).size, 1, `the times start in one column: ${msg}`);
  assert.equal(new Set(rows.map((r) => r.at)).size, 1, `the addresses start in one column: ${msg}`);
  for (const r of rows) {
    assert.ok(r.ink <= r.end + 0.5 && r.dot, `the time ends before its dot: ${msg}`);
    assert.ok(Math.abs(r.dot.gaps[0] - r.dot.gaps[1]) <= 1 && r.dot.gaps[0] >= 4, `each dot is centered between its time and its address: ${msg}`);
    assert.ok(Math.abs(r.dot.y - r.line / 2) <= 1, `each dot is centered on its address line: ${msg}`);
  }
};
for (const [name, b] of ENGINES) {
  for (const width of [320, 1440]) {
    const ctx = name === "chromium" ? await context(G, { viewport: { width, height: 900 } }) : await engineContext(b, G, { viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await check(`B151 ${name} at ${width}: the route lists line up, the times in one column, every dot centered between its time and its address and on its address line, and About 10:35 AM on one line in the summary card, Check your trip and the confirmation`, async () => {
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(`${G.base}/book`, { waitUntil: "load" });
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await trip(p, { from: ["bedford", "277 Bedford Avenue"], to: ["edition", "The New York EDITION"], time: "10:00" });
      await view(p);
      await priced(p);
      await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
      const s2 = await lined(p, "#bk-route");
      assert.equal(s2[1].text, "About 10:35 AM");
      linedUp(s2, "summary card");
      if (name === "chromium") {
        const [value, shifts] = await cls(p);
        assert.ok(value < 0.001, `${value} ${shifts.join(" | ")}`);
      }
      await next(p);
      await p.waitForTimeout(300);
      const s3 = await lined(p, "#bk-check-route");
      if (s3) linedUp(s3, "Check your trip");
      linedUp(await lined(p, "#bk-route"), "summary card on the details step");
      await details(p);
      await priced(p);
      await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
      await p.waitForFunction(() => /^[1-9]\d{7}$/.test(document.getElementById("cf-ref").textContent));
      await p.waitForTimeout(300);
      const cf = await lined(p, "#cf-route");
      assert.equal(cf[1].text, "About 10:35 AM");
      linedUp(cf, "confirmation");
      assert.deepEqual(errors, []);
      await p.close();
    });
    await ctx.close();
  }
}

for (const width of [1440, 390]) {
  const ctx = await context(G, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B152 at ${width} the route note names Google Maps only when no map image is on screen: beside the map image it reads 4.8 miles, about 31 min by car. and the image's own Google logo is the attribution, the details step hides the map and the note adds Google Maps, back on the vehicle step the map returns and the text goes, Traffic estimate shows nowhere and nothing moves`, async () => {
    const p = await open(ctx, G, "/book");
    const seen = () => p.evaluate(() => {
      const n = document.getElementById("bk-route-n"), m = document.getElementById("bk-map"), img = m.querySelector("img");
      return [n.getClientRects().length > 0 && n.innerText.trim(), getComputedStyle(n.querySelector(".bk-attr")).visibility, !!img && img.getClientRects().length > 0 && getComputedStyle(m).visibility === "visible", /traffic estimate/i.test(document.body.innerText + n.textContent)];
    });
    await routeTrip(p, { from: ["bedford", "277 Bedford Avenue"], to: ["edition", "The New York EDITION"] });
    await view(p);
    await priced(p);
    await p.waitForSelector("#bk-map img");
    assert.deepEqual(await seen(), ["4.8 miles, about 31 min by car.", "hidden", true, false], "the vehicle step with the map image");
    await next(p);
    assert.deepEqual(await seen(), ["4.8 miles, about 31 min by car. Google Maps", "visible", false, false], "the details step without the map");
    await p.click("#bk-back");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await priced(p);
    await p.waitForSelector("#bk-map img");
    await p.waitForFunction(() => /miles/.test(document.getElementById("bk-route-n").textContent));
    assert.deepEqual(await seen(), ["4.8 miles, about 31 min by car.", "hidden", true, false], "back on the vehicle step");
    const [value, shifts] = await cls(p);
    assert.ok(value < 0.001, `${value} ${shifts.join(" | ")}`);
    assert.deepEqual(p.errors, []);
    await p.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES.slice(1)) await b.close();

await browser.close();
if (failures) {
  console.error(`\n${failures} book browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll book browser tests passed");
process.exit(0);
