import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const api = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { AIRPORT_FARES, AIRPORT_TOTALS, MEET_AND_GREET, VEHICLES, TIP_PERCENTS, NYC_TAX_PERCENT, BCF_PERCENT, percentCents } = await api("_rates.mjs");
const { HEADINGS, NOTES, REASONS, POLICY } = await api("_copy.mjs");

const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "FLIGHT_API_KEY", "PLACE_TICKET_SECRET", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT"];
const nyDate = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + days * 864e5));
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
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && page.errors.push(m.text()));
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
async function pickDate(page, btn, iso) {
  if (!(await page.evaluate((b) => { const k = document.getElementById("bk-cal"); return !k.hidden && k.previousElementSibling === document.querySelector(b); }, btn))) await page.click(btn);
  for (let i = 0; i < 14 && !(await page.$(`#bk-cal [data-day="${iso}"]`)); i++) await page.click('#bk-cal .bk-cal__nav[data-dir="1"]');
  await page.click(`#bk-cal [data-day="${iso}"]`);
}
async function trip(page, { from = ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to = ["350 5th Ave, New York, NY 10118"], date = DATE, time = "12:40" } = {}) {
  await place(page, "from", ...from);
  if (to) await place(page, "to", ...to);
  await pickDate(page, "#bk-date-btn", date);
  await page.selectOption("#bk-time", time);
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
    assert.deepEqual(await mains(page, "from"), [], "one character shows no local row");
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
    assert.deepEqual([await page.inputValue("#bk-from"), await page.inputValue("#bk-from-id"), await page.inputValue("#bk-from-ticket")], ["John F. Kennedy (JFK), Terminal 4", "jfk-t4", ""]);
    assert.equal(await page.isVisible("#bk-from-pop"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-to");
    assert.equal(await page.isVisible("#bk-flight"), true, "an airport pickup shows the flight number");
    assert.equal(await page.getAttribute("#book-form", "data-step"), "search");
  });
  await check("B2 after a pick the next box stays closed, a tap on Date picks nothing, and an airport pickup lists no airport for an empty drop-off", async () => {
    assert.deepEqual([await page.getAttribute("#bk-to", "aria-expanded"), await page.isVisible("#bk-to-pop")], ["false", false]);
    await page.click("#bk-date-btn");
    assert.deepEqual([await page.inputValue("#bk-from"), await page.inputValue("#bk-to")], ["John F. Kennedy (JFK), Terminal 4", ""]);
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
  await check("B3 without keys an unplaced end shows its ZIP hint, not an error, View options passes on the first press to the unplaced row, and its Edit trip returns to that box", async () => {
    await place(page, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await type(page, "to", "edition");
    await page.waitForFunction(() => document.querySelector('#bk-to-list [data-kind="typed"] .bk-opt__area')?.textContent === "ZIP code needed");
    await page.keyboard.press("Escape");
    assert.deepEqual([await page.isVisible("#e-to-zip"), await page.getAttribute("#bk-to", "aria-invalid")], [true, null]);
    await pickDate(page, "#bk-date-btn", DATE);
    await page.selectOption("#bk-time", "12:40");
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
    await page.selectOption("#bk-time", "");
    await page.click("#bk-view");
    assert.deepEqual([await page.isVisible("#e-time"), await page.isVisible("#e-date"), await page.evaluate(() => document.activeElement.id)], [true, false, "bk-time"]);
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
    await page.selectOption("#bk-time", "12:40");
    await view(page);
    await priced(page);
    assert.deepEqual(await cards(page), JFK_CARDS);
    assert.deepEqual((await panel(page)).lines, AIRPORT_LINES);
  });
  await check("B8 with GOOGLE_MOCK on a phone there is no map image and no map size in the route request, the route list in the summary card carries the drive time with the Google attribution and the drive line stays hidden", async () => {
    await page.waitForFunction(() => /About/.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    assert.deepEqual([await page.isVisible("#bk-map"), await page.$("#bk-map img")], [false, null]);
    assert.equal(routeBodies.length, 1);
    assert.equal(routeBodies[0].map, undefined);
    assert.deepEqual(await page.$$eval("#bk-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMThe New York EDITION, Madison Avenue, New York, NY", "About 1:25 PMJohn F. Kennedy (JFK), Terminal 4"]);
    assert.equal(await page.textContent("#bk-route-n"), "Traffic estimate. Google Maps");
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
    assert.ok(await page.evaluate(() => document.getElementById("bk-time").classList.contains("is-washed")));
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
  await check("B5 the calendar: today marked current and muted with its email or WhatsApp label, past days disabled, it opens on the first bookable day, New York time, keys, Escape returns focus", async () => {
    await page.click("#bk-date-btn");
    assert.equal(await page.getAttribute("#bk-date-btn", "aria-expanded"), "true");
    const today = nyDate(0), first = await page.evaluate(() => document.activeElement.dataset.day);
    assert.ok(first > today, `the calendar opens on ${first}, a bookable day after today`);
    assert.equal(await page.getAttribute(`#bk-cal [data-day="${today}"]`, "aria-current"), "date");
    assert.ok(await page.evaluate((d) => document.querySelector(`#bk-cal [data-day="${d}"]`).classList.contains("is-mute"), today));
    assert.equal(await page.getAttribute(`#bk-cal [data-day="${today}"]`, "aria-label"), new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) + ", email or WhatsApp only");
    assert.equal(await page.isDisabled(`#bk-cal [data-day="${today}"]`), false, "a muted day stays pickable");
    assert.match(await page.textContent(".bk-cal__tz"), /^New York time(, now \d{1,2}:\d\d [AP]M)?$/);
    assert.equal(await page.textContent(".bk-cal__note"), "For a pickup in the next 24 hours, book by email or WhatsApp.");
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
  });
  await check("B5 picking a day shows it as Thu, Oct 15 style text and moves focus to the pickup time", async () => {
    await page.click("#bk-date-btn");
    const first = await page.evaluate(() => document.activeElement.dataset.day);
    for (let i = 0; i < Math.round((Date.parse(DATE) - Date.parse(first)) / 864e5); i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("#bk-date"), DATE);
    assert.equal(await page.textContent("#bk-date-btn"), shortDate(DATE));
    assert.equal(await page.isVisible("#bk-cal"), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-time");
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
    await page.selectOption("#bk-time", "12:40");
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
  await check("B7 View options switches to step 2 at once with the summary, the placeholder lines and focus on the heading, Finding prices... only after 150 ms", async () => {
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
      sum: `Change John F. Kennedy (JFK), Terminal 4 to 350 5th Ave, New YorkChange ${shortDate(DATE)}, 12:40 PMEdit trip`,
      search: "contents",
    });
    assert.deepEqual(await page.evaluate(() => [...document.getElementById("bk-search").children].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.id)), ["bk-status"], "only the status line of step 1 stays in the page in step 2");
    await page.waitForFunction(() => document.getElementById("bk-wait").textContent === "Finding prices\u2026");
    assert.deepEqual(await page.evaluate(() => [location.hash, [...document.querySelectorAll("#bk-sum .bk-chip")].length, document.querySelector("#bk-steps [aria-current]").textContent, document.getElementById("bk-bar-go").disabled, document.getElementById("bk-choice").textContent]), ["#options", 2, "Vehicle", false, "Business SUVChevrolet Suburban or similar"]);
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
    assert.deepEqual(await page.$$eval("#bk-tip-opts label", (l) => l.map((x) => x.textContent)), TIP_PERCENTS.map((n) => (n ? `${n}%` : "None")));
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
    assert.deepEqual(await page.evaluate(() => [location.hash, document.activeElement.id, document.querySelector("#bk-steps [aria-current]").textContent]), ["#details", "bk-det-h", "Details"]);
    assert.deepEqual([await page.isVisible("#bk-tip"), await page.isVisible("#bk-submit"), await page.isVisible("#bk-consent"), await page.isVisible("#bk-cards"), await page.isVisible("#bk-bar-go"), (await page.textContent("#bk-bar-go")).trim()], [true, true, true, false, true, "Book and pay online"], "below 1024 the pay button rides in the bar and follows the total in the flow");
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
    assert.equal(await page.textContent("#bk-ret-sum"), "Return: 350 5th Ave, New York, NY 10118 to John F. Kennedy (JFK), Terminal 4");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-rdate-btn");
    assert.equal(await page.isVisible("#bk-addret"), false);
    await page.click("#bk-view");
    assert.equal(await page.isVisible("#e-return-date"), true);
    await pickDate(page, "#bk-rdate-btn", RDATE);
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-rtime");
    await page.selectOption("#bk-rtime", "18:00");
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
    await page.click("#bk-edit");
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
  await check("B14 every data-wa link carries the trip text the browser knows, and the answer link after View options", async () => {
    const hrefs = () => page.$$eval("a[data-wa]", (a) => a.map((x) => x.getAttribute("href")));
    const before = await hrefs();
    assert.equal(before.length, 5, "the five chrome WhatsApp links carry data-wa, the booking buttons fill their own text");
    assert.equal(await page.getAttribute("#q-wa", "data-wa"), null);
    await trip(page);
    await page.waitForFunction(() => decodeURIComponent(document.querySelector(".site-footer a[data-wa]").getAttribute("href")).includes("Time: 12:40 PM"));
    const texts = (await hrefs()).map((h) => decodeURIComponent(h.split("?text=")[1] || ""));
    assert.ok(texts.every((t) => t === texts[0]), "all data-wa links share the text");
    assert.equal(texts[0], ["Hi NYC LUX RIDE, I would like to book this trip.", "Trip: One way", "Pickup: John F. Kennedy (JFK), Terminal 4", "Drop-off: 350 5th Ave, New York, NY 10118", `Date: ${new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`, "Time: 12:40 PM", "Passengers: 1"].join("\n"));
    await view(page);
    await priced(page);
    const wa = await waText(page, CHROME_WA);
    assert.match(wa, /^Hi NYC LUX RIDE, I would like to book this trip\.\nReference: NLR-[0-9A-HJKMNP-TV-Z]{8}\n/);
    assert.match(wa, /Vehicle: Business SUV\nTotal shown: \$185\.00$/);
    assert.equal(await waText(page, "#q-wa"), wa);
    assert.match(await page.getAttribute("#q-mail", "href"), /^mailto:info@nycluxride\.com\?subject=Booking%20request%20NLR-/);
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
    assert.match(s.ref, /^NLR-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.ok(s.summary.includes("Business SUV"), s.summary);
    assert.deepEqual(s.lines, [...AIRPORT_LINES, ["Meet and greet", cash(MEET_AND_GREET)], ["Gratuity for your chauffeur (20%)", cash(tip)]]);
    assert.equal(s.total, cash(TOTAL + MEET_AND_GREET + tip));
    assert.equal(s.test, true);
    assert.equal(s.search, "");
    assert.deepEqual(s.purchases, [[`cs_mock_${s.ref.slice(4)}`, s.ref, FARE + MEET_AND_GREET]]);
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
    assert.deepEqual([await page.isVisible("#bk-bar-go"), (await page.textContent("#bk-bar-go")).trim(), await page.isVisible("#bk-submit"), await page.isVisible("#bk-cards")], [true, "Book and pay online", true, false]);
    assert.equal(await page.evaluate(() => document.activeElement.id), "resume", "the cancelled payment notice takes focus once");
    assert.equal((await page.textContent("#resume b")).trim(), "Payment not completed. Nothing was charged.");
    await page.click("#resume-go");
    assert.equal(await page.evaluate(() => document.activeElement.id), "bk-bar-go", "Book and pay online in the notice focuses the bar button on phones");
    assert.deepEqual(await page.evaluate(() => ["bk-from", "bk-from-id", "bk-to", "bk-date", "bk-time"].map((id) => document.getElementById(id).value)), ["John F. Kennedy (JFK), Terminal 4", "jfk-t4", "350 5th Ave, New York, NY 10118", DATE, "12:40"]);
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
    await p3.route("**/api/book", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "pay", ref: "NLR-AAAAAA", url: "https://example.com/c/pay/cs_test_a1" }) }));
    await p3.click(await payBtn(p3));
    await p3.waitForSelector("#q-error", { state: "visible" });
    assert.equal(new URL(p3.url()).pathname, "/book");
    await p3.unroute("**/api/book");
    await p3.route("**/api/book", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>" }));
    await p3.click("#bk-back");
    await p3.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await p3.waitForSelector("#q-error", { state: "visible" });
    assert.match(decodeURIComponent(await p3.getAttribute("#q-wa", "href")), /^https:\/\/wa\.me\/16467750556\?text=Hi NYC LUX RIDE, I would like to book this trip\.\n(Reference: NLR-[0-9A-Z]{8}\n)?Trip: One way\nPickup: John F\. Kennedy \(JFK\), Terminal 4/, "a failed call rebuilds the trip link, never the bare one");
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
    assert.match(wa, /Reference: NLR-[0-9A-HJKMNP-TV-Z]{8}/);
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
      const ids = ["bk-one", "bk-hour", "bk-from", "bk-stop1", "bk-to", "bk-hours", "bk-date", "bk-flight", "bk-time", "bk-ret", "bk-rdate", "bk-rtime", "bk-rflight", "bk-pax", "bk-vehicle", "bk-meet", "bk-r-me", "bk-r-other", "bk-name", "bk-email", "bk-phone", "bk-reach-phone", "bk-reach-wa", "bk-pname", "bk-pphone", "bk-sign", "bk-notes", "bk-consent", "bk-submit"];
      const hidden = [];
      for (const id of ids) if (!(await p.isVisible(`#${id}`)) && !(await p.isVisible(`label[for="${id}"]`))) hidden.push(id);
      assert.deepEqual(hidden, []);
      assert.ok(await p.isVisible(".bk-card"));
      for (const id of ["bk-view", "bk-stop2", "bk-date-btn", "bk-edit", "bk-tip", "bk-addstop", "bk-noflight", "bk-wait", "price", "quote", "resume", "from-search", "bk-steps", "bk-next", "bk-bar", "bk-pills", "bk-back", "bk-dflight-f", "bk-msg"]) assert.equal(await p.isVisible(`#${id}`), false, id);
      assert.deepEqual(await p.$$eval("#bk-pname-f .bk-nojs, #bk-sign-f .bk-nojs", (e) => e.map((x) => x.textContent)), ["(if someone else is riding)", "(meet and greet)"]);
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
    await p.selectOption("#bk-time", "12:40");
    await details(p);
    await p.check("#bk-r-other");
    await p.fill("#bk-pname", "Ben Ortiz");
    await p.fill("#bk-notes", "Two large cases");
    const [post] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book")), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { waitUntil: "commit" }), p.click("#bk-submit")]);
    const sent = new URLSearchParams(post.postData());
    assert.deepEqual(["rider", "name", "email", "phone", "reach", "pname", "notes"].map((k) => sent.get(k)), ["other", ME.name, ME.email, ME.phone, "phone", "Ben Ortiz", "Two large cases"]);
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    await p.check("#bk-hour");
    await p.fill("#bk-from", "277 Bedford Ave, Brooklyn, NY 11211");
    await p.fill("#bk-date", DATE);
    await p.selectOption("#bk-time", "12:00");
    await p.click('label[for="bk-c-premium"]');
    await p.selectOption("#bk-hours", "4");
    const [hourlyPost] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book")), p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { waitUntil: "commit" }), p.click("#bk-submit")]);
    assert.deepEqual(["trip_type", "class", "hours"].map((k) => new URLSearchParams(hourlyPost.postData()).get(k)), ["hour", "premium", "4"]);
    await p.close();
  });
  await check("B15 without javascript an unplaced address lands on its request block and an empty pickup on its message", async () => {
    const p = await open(nojs, P, "/locations/jfk-airport");
    await p.fill("#bk-to", "350 5th Ave");
    await p.fill("#bk-date", DATE);
    await p.selectOption("#bk-time", "12:40");
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
    await p.selectOption("#bk-time", "12:40");
    await p.fill("#bk-email", "ana@example");
    assert.equal(await p.evaluate(() => document.getElementById("bk-email").validity.patternMismatch), true);
    await p.evaluate(() => document.getElementById("bk-email").removeAttribute("pattern"));
    await Promise.all([p.waitForURL(/\/book#e-email$/), p.click("#bk-submit")]);
    assert.ok(await p.isVisible("#e-email"));
    await p.close();
  });
  await check("B15 with scripting on but a failed script, View options still books with Business SUV and 1 passenger", async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await ctx2.route((u) => !u.href.startsWith(P.base) || /\/assets\/pay\./.test(u.href), (r) => r.fulfill({ status: 404, body: "" }));
    const p = await ctx2.newPage();
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    assert.equal(await p.evaluate(() => document.getElementById("book-form").classList.contains("is-js")), false);
    assert.deepEqual([await p.isVisible("#bk-view"), await p.isVisible("#bk-date"), await p.isVisible("#bk-date-btn"), await p.isVisible("#bk-opts")], [true, true, false, false]);
    await p.fill("#bk-from", "LaGuardia (LGA), Terminal C");
    await p.fill("#bk-to", "277 Bedford Ave, Brooklyn, NY 11211");
    await p.fill("#bk-date", DATE);
    await p.selectOption("#bk-time", "07:30");
    const [req] = await Promise.all([p.waitForRequest((r) => r.url().endsWith("/api/book") && r.method() === "POST"), p.click("#bk-view")]);
    const body = new URLSearchParams(req.postData());
    assert.deepEqual([body.get("action"), body.get("class"), body.get("passengers"), body.get("from_text")], ["options", "suv", "1", "LaGuardia (LGA), Terminal C"]);
    await p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/, { waitUntil: "commit" });
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "12 Washington St, Hoboken, NJ 07030");
    await p.fill("#bk-date", DATE);
    await p.selectOption("#bk-time", "07:30");
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
  await check(`B17 ${path}: with every answer delayed, CLS without recent input stays 0 through ${path === "/" ? "step 1, a flight lookup and the hand-off to /book#options" : "View options, a class change, Continue, then meet and greet and a gratuity in step 3"}`, async () => {
    const p = await open(ctx, G, path);
    await delayAll(p);
    await place(p, "from", "jfk", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await p.fill("#bk-flight", "EK201");
    await p.waitForFunction(() => document.getElementById("bk-flight-status").textContent.includes("EK 201 from"), null, { timeout: 6000 });
    await p.waitForTimeout(300);
    await p.selectOption("#bk-time", "15:00");
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
  await check(`B17 ${path} at ${width}: with Google keys the ${big ? "map card and the route list are" : "route list is"} drawn at the step switch, prices come before a late route, the drive time fills in place, CLS stays 0${path === "/book" ? ", also on /book#resume" : " on /book#options after the hand-off"}`, async () => {
    const p = await open(ctx, G, path);
    await place(p, "from", "edition", "The New York EDITION");
    await p.waitForFunction(() => /^v1\./.test(document.getElementById("bk-from-ticket").value));
    await place(p, "to", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await pickDate(p, "#bk-date-btn", DATE);
    await p.selectOption("#bk-time", "12:40");
    await p.route("**/api/route", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue().catch(() => {});
    });
    if (path === "/") await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
    else await p.click("#bk-view");
    assert.deepEqual([await p.isVisible("#bk-map"), await p.isVisible("#bk-drive"), await p.isVisible("#bk-route"), await p.isVisible("#bk-route-n")], [big, false, true, true]);
    assert.ok(await p.$("#bk-route .bk-route__z .bk-sk[aria-hidden=true]"), "the drop-off time waits in a skeleton");
    const frame = await p.evaluate(() => [document.getElementById("bk-map").getBoundingClientRect().height, document.getElementById("bk-route").getBoundingClientRect().height]);
    assert.ok(big ? frame[0] >= 80 : frame[0] === 0, JSON.stringify(frame));
    await priced(p);
    assert.equal(await p.$("#bk-map img"), null, "the prices did not wait for the route");
    if (big) await p.waitForSelector("#bk-map img");
    await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    await p.waitForTimeout(400);
    let [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-map").getBoundingClientRect().height, document.getElementById("bk-route").getBoundingClientRect().height]), frame);
    assert.deepEqual(await p.$$eval("#bk-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMThe New York EDITION, Madison Avenue, New York, NY", "About 1:25 PMJohn F. Kennedy (JFK), Terminal 4"]);
    assert.equal(await p.textContent("#bk-route-n"), "Traffic estimate. Google Maps");
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
  await check("B19 the tab order reaches View options, in step 2 the cards and Book and pay online, in step 3 every detail control, the gratuity, meet and greet, Book and pay online, Email to reserve and WhatsApp to reserve, each with a visible focus ring", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await p.focus("#bk-time");
    let reached = false;
    for (let i = 0; i < 8 && !reached; i++) {
      await p.keyboard.press("Tab");
      reached = await p.evaluate(() => document.activeElement.id === "bk-view");
    }
    assert.ok(reached, "Tab never reached View options");
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
    const want = ["bk-r-me", "bk-name", "bk-email", "bk-phone", "bk-reach-phone", "bk-notes-add", "bk-t-0", "bk-meet-no", "bk-submit", "q-mail", "q-wa"];
    const order = [];
    for (let i = 0; i < 40 && !order.includes("q-wa"); i++) {
      await p.keyboard.press("Tab");
      const id = await p.evaluate(() => document.activeElement.id);
      order.push(id);
      if (want.includes(id)) {
        const [st, wd] = await ring(id === "bk-meet-no" ? 'label[for="bk-meet-no"]' : `#${id}`);
        const under = await p.evaluate((x) => getComputedStyle(document.getElementById(x)).boxShadow, id);
        assert.ok((st !== "none" && wd >= 2) || /0px -2px/.test(under) || /rgb/.test(under), `${id}: ${st} ${wd} ${under}`);
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
    await next(p);
    const t = await p.evaluate(() => {
      const c = (s) => getComputedStyle(document.querySelector(s));
      const mark = (id) => {
        const g = document.getElementById(id), f = g.querySelector("label"), l = g.querySelector(":checked").parentNode, i = getComputedStyle(f, "::before"), m = new DOMMatrixReadOnly(i.transform === "none" ? undefined : i.transform), fr = f.getBoundingClientRect(), lr = l.getBoundingClientRect();
        if (!g.classList.contains("bk-ix")) return [getComputedStyle(l).backgroundColor, true];
        return [i.backgroundColor, Math.max(Math.abs(fr.left + f.clientLeft + m.m41 - lr.left), Math.abs(parseFloat(i.width) - lr.width), Math.abs(fr.top + f.clientTop + m.m42 - lr.top)) <= 1];
      };
      const other = c('label[for="bk-r-other"]'), off = c('label[for="bk-reach-wa"]');
      return [...mark("bk-who"), other.borderTopStyle, ...mark("bk-reach"), off.borderTopStyle];
    });
    assert.ok(!/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(t[0]) && t[1] && t[2] === "solid" && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(t[3]) && t[4] && t[5] === "solid", JSON.stringify(t));
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
  await check("B20 reduced motion: the opened window on / and the pills on /book have transitions of at most 1 ms", async () => {
    const p = await open(ctx, P, "/");
    await p.click("#bk-from");
    const t = await p.evaluate(() => [document.getElementById("bk-search"), document.querySelector(".hero h1"), document.querySelector(".hero__lede")].map((e) => getComputedStyle(e).transitionDuration.split(",").map(parseFloat)).flat());
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
  await page.selectOption("#bk-time", "14:00");
}
const chips = (page) => page.$$eval("#bk-sum .bk-chip", (c) => c.map((x) => x.textContent.replace(/^Change /, "")));
for (const [path, width] of [["/", 1440], ["/locations/manhattan", 390]]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await ctx.addInitScript(GT);
  await check(`B21 hand-off from ${path} at ${width}: View options opens /book#options with the same trip and the five prices, one book_now_click on the host, back and forward`, async () => {
    const p = await open(ctx, P, path);
    await hostTrip(p);
    await Promise.all([p.waitForURL(/\/book#options$/), p.click("#bk-view")]);
    await priced(p);
    assert.equal(new URL(p.url()).search, "");
    assert.deepEqual(await chips(p), [`John F. Kennedy (JFK), Terminal 4 to 350 5th Ave, New York`, `${shortDate(DATE)}, 2:00 PM`]);
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
    await p.check("#bk-r-other");
    assert.deepEqual([await p.isVisible("#bk-pname"), await p.isVisible("#bk-pphone")], [true, true]);
    await fail("pname");
    await p.fill("#bk-pname", "Ben Ortiz");
    assert.equal(await p.inputValue("#bk-sign"), "Ben Ortiz");
    await p.fill("#bk-pphone", "call me");
    await fail("pphone");
    await p.fill("#bk-pphone", "");
    await p.fill("#bk-sign", "Dr Ortiz");
    await p.fill("#bk-pname", "Benjamin Ortiz");
    assert.equal(await p.inputValue("#bk-sign"), "Dr Ortiz", "own typing stops the autofill");
    await p.check("#bk-r-me");
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
    assert.deepEqual(["rider", "name", "email", "phone", "reach", "sign", "notes", "flight"].map((k) => body[k]), ["me", "Ana Lopez", ME.email, ME.phone, "whatsapp", "Dr Ortiz", "Two large cases", "EK201"]);
    assert.ok(!("pname" in body) && !("pphone" in body), "no passenger fields for Me");
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
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isChecked("#bk-c-first"), await p.inputValue("#bk-from")], ["options", true, "John F. Kennedy (JFK), Terminal 4"]);
    await next(p);
    await p.click('label[for="bk-t-10"]');
    await details(p);
    await p.waitForTimeout(400);
    await p.reload({ waitUntil: "load" });
    await priced(p);
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isChecked("#bk-c-first"), await p.isChecked("#bk-t-10"), await p.inputValue("#bk-name"), await p.inputValue("#bk-phone")], ["details", true, true, ME.name, ME.phone]);
    assert.equal(await p.textContent("#price-total"), cash(AIRPORT_TOTALS.first.jfk + percentCents(AIRPORT_FARES.first.jfk, "10")));
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
  await check("B24 without javascript on /locations/manhattan, View options sends GET to /book?...&action=options#from-search and /book shows the FULL form and the note", async () => {
    const p = await open(nojs, P, "/locations/manhattan");
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", DATE);
    await p.selectOption("#bk-time", "14:00");
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
    await p.selectOption("#bk-time", "14:00");
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
    assert.deepEqual(box, [88, 64, 0, 0, "visible"]);
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
    assert.deepEqual([await p.getAttribute("#book-form", "data-step"), await p.isVisible("#bk-bar"), await bar(), await p.evaluate(() => document.activeElement.id)], ["details", true, "none", "bk-det-h"]);
    assert.deepEqual([(await p.textContent("#bk-bar-go")).trim(), await p.getAttribute("#bk-bar-go", "aria-describedby"), await p.isVisible("#bk-submit"), !!(await p.$("#bk-bar-go use[href='#i-lock']"))], ["Book and pay online", "bk-consent", true, true], "in step 3 the pay button rides in the bar and follows the total in the flow");
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
  await p.selectOption("#bk-time", "12:40");
  await view(p);
  await priced(p);
}

for (const [width, height] of [[1440, 900], [1280, 720]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B27 at ${width} by ${height} on /, focusing the pickup opens the window with its message, the drop-off has its own, Escape closes, the hero and the static trust row under it stay put`, async () => {
    const p = await open(ctx, P, "/");
    await settle(p, 300);
    const geo = () => p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return [Math.round(r(".hero").height), Math.round(r(".assure-row--page").top), Math.round(r(".hero h1").height)]; });
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-help"), getComputedStyle(document.getElementById("bk-assure")).display]), [null, "none"], "no help row, and the form's trust row hides on the hero from 1024");
    const [hero, help] = await geo();
    await tap(p, "#bk-from");
    await p.waitForTimeout(400);
    const msg = () => p.evaluate(() => [document.getElementById("bk-msg").dataset.on, [...document.querySelectorAll("#bk-msg [data-m]")].filter((s) => s.getBoundingClientRect().height > 0 && getComputedStyle(s).visibility === "visible").map((s) => s.dataset.m)]);
    assert.ok(await p.evaluate(() => document.querySelector(".hero__book").classList.contains("is-open") && document.getElementById("book-form").classList.contains("is-open")));
    assert.deepEqual(await msg(), ["from", ["from"]]);
    assert.deepEqual(await geo(), [hero, help, 0]);
    await tap(p, "#bk-to");
    await p.waitForTimeout(100);
    assert.deepEqual(await msg(), ["to", ["to"]]);
    assert.equal(await p.isVisible("#bk-to-pop"), true, "the empty drop-off shows the airport chips");
    await p.keyboard.press("Escape");
    assert.deepEqual([await p.isVisible("#bk-to-pop"), await p.evaluate(() => document.querySelector(".hero__book").classList.contains("is-open"))], [false, true], "the first Escape closes the list only");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.querySelector(".hero__book").classList.contains("is-open")), false);
    const [h2, help2, h1] = await geo();
    assert.deepEqual([h2, help2], [hero, help]);
    assert.ok(h1 > 0);
    const shifts = await p.evaluate(() => window.__shifts);
    assert.deepEqual(shifts, [], "a shift without input");
    const outside = await p.evaluate(() => performance.getEntriesByType("layout-shift").flatMap((e) => e.sources.map((s) => s.node)).filter((n) => n && !document.querySelector(".hero").contains(n)).length);
    assert.equal(outside, 0);
    await p.close();
  });
  await ctx.close();
}
{
  const ctx = await context(P, { viewport: { width: 390, height: 844 } });
  await check("B27 at 390 the window never opens", async () => {
    const p = await open(ctx, P, "/");
    await p.click("#bk-from");
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => document.querySelector(".hero__book").className), "hero__book");
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
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
    await p.waitForTimeout(300);
    const [value, shifts] = await cls(p);
    assert.equal(value, 0, shifts.join(" | "));
    assert.equal(await p.evaluate(() => document.getElementById("cf-receipt").lastElementChild.id), "cf-summary");
    if (kind === "one") {
      assert.deepEqual(await p.$$eval("#cf-trip dd", (d) => d.map((x) => x.textContent)), [`${new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, 12:40 PM, New York time`, "Business SUVChevrolet Suburban or similar"]);
      assert.deepEqual(await p.$$eval("#cf-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMJohn F. Kennedy (JFK), Terminal 4", "350 5th Ave, New York, NY 10118"]);
      assert.equal(await p.textContent("#cf-day span"), "Your chauffeur waits inside the terminal with a name sign.");
      await Promise.all([p.waitForURL(/\/book#trip$/), p.click("#cf-return")]);
      assert.deepEqual(await p.evaluate(() => [document.getElementById("book-form").dataset.step, document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-to-id").value, document.getElementById("bk-time").value, document.getElementById("bk-date").value, document.activeElement.dataset.day]), ["search", "350 5th Ave, New York, NY 10118", "John F. Kennedy (JFK), Terminal 4", "jfk-t4", "", DATE, DATE]);
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
      await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
      return [nonce, await p.textContent("#cf-ref")];
    };
    const p = await open(ctx, P, "/book");
    await trip(p);
    const [n1, r1] = await pay(p);
    await Promise.all([p.waitForURL(/\/book#trip$/), p.click("#cf-return")]);
    await p.selectOption("#bk-time", "18:00");
    await view(p);
    await p.goto(`${P.base}/booking-confirmed`, { waitUntil: "load" });
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
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
    await p.selectOption("#bk-rtime", "18:00");
    await view(p);
    await priced(p);
    await next(p);
    await priced(p);
    await details(p);
    await Promise.all([p.waitForURL(/\/booking-confirmed/), p.click(await payBtn(p))]);
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
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
  await check(`B33 at ${width} by ${height}, the first date calendar opens the hero window without scrolling, and every calendar opens whole below the header`, async () => {
    const whole = (p) => p.evaluate(() => { const c = document.getElementById("bk-cal").getBoundingClientRect(); return [c.top >= document.querySelector(".site-header").getBoundingClientRect().bottom, c.bottom <= innerHeight]; });
    const p = await open(ctx, P, "/");
    await tap(p, "#bk-date-btn");
    await p.waitForSelector("#bk-cal:not([hidden])");
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => document.querySelector(".hero__book").classList.contains("is-open")), true);
    assert.equal(await p.evaluate(() => scrollY), 0);
    await p.keyboard.press("ArrowDown");
    assert.equal(await p.evaluate(() => scrollY), 0);
    assert.deepEqual(await whole(p), [true, true]);
    await p.close();
    for (const path of ["/services", "/book"]) {
      const q = await open(ctx, P, path);
      await q.click("#bk-date-btn");
      await q.waitForSelector("#bk-cal:not([hidden])");
      await q.waitForTimeout(300);
      assert.deepEqual(await whole(q), [true, true], `${path} date`);
      await q.keyboard.press("Escape");
      await q.click("#bk-addret");
      await q.click("#bk-rdate-btn");
      await q.waitForSelector("#bk-cal:not([hidden])");
      await q.waitForTimeout(300);
      assert.deepEqual(await whole(q), [true, true], `${path} return date`);
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
      if (path === "/book") await p.setViewportSize({ width: 390, height: 700 });
      await p.evaluate(() => document.getElementById("bk-from").getBoundingClientRect().top > visualViewport.height / 2 || scrollTo(0, document.getElementById("bk-from").getBoundingClientRect().top + scrollY - visualViewport.height * 0.7));
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
  await check(`B35 at ${width} by ${height}, steps 2 and 3 open on /book with the step list below the header`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    const gap = () => p.evaluate(() => document.getElementById("bk-steps").getBoundingClientRect().top - document.querySelector(".site-header").getBoundingClientRect().bottom);
    await view(p);
    assert.ok((await gap()) >= 0, `options ${await gap()}`);
    await p.evaluate(() => scrollTo(0, document.getElementById("bk-steps").getBoundingClientRect().top + scrollY));
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
  await p.selectOption("#bk-time", "12:40");
  if (ret) {
    await p.click("#bk-addret");
    await pickDate(p, "#bk-rdate-btn", RDATE);
    await p.selectOption("#bk-rtime", "18:00");
  }
}
const mapBoxes = (p) =>
  p.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) }; };
    const go = (id) => { const a = r(document.getElementById(id)), h = document.querySelector(".site-header").getBoundingClientRect().bottom; return a.height && a.top >= h && a.bottom <= innerHeight ? a : r(document.getElementById("bk-bar-go")); };
    const m = document.getElementById("bk-map"), cs = (e) => getComputedStyle(e), img = m.querySelector("img"), route = document.getElementById("bk-route");
    return {
      map: r(m), cards: r(document.getElementById("bk-cards")), incl: r(document.getElementById("bk-incl")), side: r(document.getElementById("bk-side")), steps: r(document.getElementById("bk-steps")),
      next: go("bk-next"), submit: go("bk-submit"), header: r(document.querySelector(".site-header")), note: r(document.getElementById("resume")),
      look: [cs(m).borderRadius, cs(m).boxShadow, cs(m).borderTopWidth], display: cs(m).display, offText: m.classList.contains("is-off") ? m.innerText : "",
      img: img && { w: +img.getAttribute("width"), h: +img.getAttribute("height"), rw: Math.round(img.getBoundingClientRect().width), rh: Math.round(img.getBoundingClientRect().height), fit: cs(img).objectFit, srcset: img.srcset, ok: img.complete && img.naturalWidth > 0, alt: img.alt, policy: img.referrerPolicy },
      route: route.hidden ? null : [...route.children].map((li) => li.textContent), routeNote: document.getElementById("bk-route-n").hidden ? null : document.getElementById("bk-route-n").textContent,
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
      side: r(document.getElementById("bk-side")), steps: r(document.getElementById("bk-steps")), map: r(m), drive: r(document.getElementById("bk-drive")), card: r(c),
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
  await check(`B35 at ${width} by ${height} the route map sits in the left column after the included list, with no shadow, a sized request of at most 640 px and an image that covers it, the route list in the summary card carries the drive time, Book and pay online stays in view on steps 2 and 3 under the rows or at the foot of the summary card, after a cancelled payment and with meet and greet`, async () => {
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
    assert.deepEqual([b.map.left, b.map.width], [b.cards.left, b.cards.width], "the map has the width of the rows");
    assert.ok(b.map.top > b.incl.bottom, "the map comes after the included list");
    assert.deepEqual([b.display, ...b.look], ["block", "16px", "none", "0px"]);
    assert.ok(b.map.height >= 160 && b.map.height <= 320, JSON.stringify(b.map));
    const body = bodies[0].map;
    assert.ok(body.width <= 640 && body.width === Math.min(640, b.map.width) && Math.abs(body.height - Math.round(b.map.height * body.width / b.map.width)) <= 1, JSON.stringify([body, b.map]));
    assert.deepEqual([b.img.w, b.img.h, b.img.rw, b.img.rh, b.img.fit, b.img.ok], [body.width, body.height, b.map.width, b.map.height, "cover", true]);
    assert.deepEqual([b.img.alt, b.img.policy], ["Route map from The New York EDITION, Madison Avenue, New York, NY to John F. Kennedy (JFK), Terminal 4", "strict-origin-when-cross-origin"]);
    assert.ok(/ 2x$/.test(b.img.srcset), b.img.srcset);
    assert.deepEqual([b.route, b.routeNote, b.inCard, b.drive], [["12:40 PMThe New York EDITION, Madison Avenue, New York, NY", "About 1:25 PMJohn F. Kennedy (JFK), Terminal 4"], "Traffic estimate. Google Maps", true, null]);
    const end = await p.evaluate(() => Math.max(0, Math.round(document.getElementById("bk-map").getBoundingClientRect().bottom + scrollY - innerHeight)));
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
    await routeTrip(q, { from: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"], to: ["edition", "The New York EDITION"], ret: true });
    await view(q);
    await priced(q);
    await q.waitForSelector("#bk-map img");
    const m0 = await mapBoxes(q);
    await q.click('label[for="bk-c-premium"]');
    await priced(q);
    await q.evaluate(() => scrollTo(0, 0));
    await q.waitForTimeout(150);
    const m = await mapBoxes(q);
    assert.ok(m.next.bottom <= height, `another class ${JSON.stringify(m.next)}`);
    assert.deepEqual([m.map.width, m.map.height, m.img.rw, m.img.rh], [m0.map.width, m0.map.height, m0.map.width, m0.map.height], "the map keeps its size and the image covers it when the class changes");
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
  await check(`B35 at ${width} there is no map image and no map size is requested, the route list in the summary card carries the drive time and the drive line stays hidden`, async () => {
    const p = await open(ctx, G, "/book");
    const bodies = [];
    p.on("request", (r) => r.url().endsWith("/api/route") && bodies.push(JSON.parse(r.postData())));
    await routeTrip(p);
    await view(p);
    await priced(p);
    await p.waitForFunction(() => /^About /.test(document.querySelector("#bk-route .bk-route__z")?.textContent || ""));
    const b = await mapBoxes(p);
    assert.deepEqual([b.display, b.map.height, b.img, bodies.length, bodies[0].map, b.drive, b.routeNote], ["none", 0, null, 1, undefined, null, "Traffic estimate. Google Maps"]);
    assert.equal(b.route[1], "About 1:25 PMJohn F. Kennedy (JFK), Terminal 4");
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await check("B36 at 1440 a late route answer without a map keeps the map card's space (CLS 0) and says so in it, the route list keeps its rows and fills or empties its time slot, a server without static maps shows the drive line instead of the list, hourly trips draw neither", async () => {
    const DRIVE = "About 43 min by car at 12:40 PM, traffic estimate. Google Maps";
    for (const [name, body, box, time] of [
      ["off", { kind: "off" }, "The route map is not available right now.", ""],
      ["failed image", { kind: "ok", minutes: 43, miles: 16.8, map: { src: `${G.base}/assets/no-such-map.png`, src2x: `${G.base}/assets/no-such-map.png`, width: 440, height: 271 } }, DRIVE, "About 1:25 PM"],
      ["no map", { kind: "ok", minutes: 43, miles: 16.8, attribution: "Google Maps" }, DRIVE, "About 1:25 PM"],
    ]) {
      const p = await open(ctx, G, "/book");
      await p.route("**/api/route", async (r) => {
        await new Promise((z) => setTimeout(z, 900));
        await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
      });
      await routeTrip(p);
      await view(p);
      const a = await mapBoxes(p);
      await p.waitForSelector("#bk-map.is-off");
      await p.waitForTimeout(300);
      const b = await mapBoxes(p);
      const [value, shifts] = await cls(p);
      assert.ok(value < 0.001, `${name}: ${value} ${shifts.join(" | ")}`);
      assert.deepEqual([b.display, b.img, b.map.height, b.offText, b.drive], ["grid", null, a.map.height, box, null], name);
      assert.deepEqual([b.route.length, (await p.textContent("#bk-route .bk-route__z")).trim()], [2, time], `${name}: the route list`);
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

for (const [width, height] of [[1440, 900], [390, 844]]) {
  const ctx = await context(P, { viewport: { width, height } });
  await check(`B37 at ${width} every icon of the included grids on /book step 2 and the homepage sits beside its own label, none shows alone`, async () => {
    const lone = (p) =>
      p.evaluate(() =>
        [...document.querySelectorAll(".incl > li")].filter((li) => li.getBoundingClientRect().height).map((li) => {
          const i = li.querySelector("svg.icon").getBoundingClientRect(), t = li.querySelector("span"), r = t.getBoundingClientRect();
          return [t.textContent.trim().length > 0, i.right <= r.left, Math.abs(i.top + i.height / 2 - (r.top + parseFloat(getComputedStyle(t).lineHeight) / 2)) <= 1];
        }),
      );
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    const book = await lone(p);
    assert.equal(book.length, 6);
    assert.deepEqual(book, Array(6).fill([true, true, true]));
    if (width === 1440) {
      await p.evaluate(() => scrollTo(0, document.getElementById("bk-incl").getBoundingClientRect().top + scrollY - 60));
      await p.waitForFunction(() => document.getElementById("bk-pills").classList.contains("is-on"));
      const under = await p.evaluate(() => {
        const bar = document.getElementById("bk-pills").getBoundingClientRect().bottom;
        return [...document.querySelectorAll("#bk-incl > li")].filter((li) => li.getBoundingClientRect().height).map((li) => { const i = li.querySelector("svg").getBoundingClientRect(); return [i.top + i.height / 2 >= bar, li.querySelector("span").getBoundingClientRect().top + 10 >= bar]; });
      });
      assert.ok(under.every(([a, b]) => a === b), JSON.stringify(under));
    }
    await p.close();
    const h = await open(ctx, P, "/");
    const home = await lone(h);
    assert.ok(home.length >= 5);
    assert.ok(home.every((x) => x.every(Boolean)), JSON.stringify(home));
    await h.close();
  });
  await ctx.close();
}

{
  const ctx = await context(P);
  await check("B38 all errors at once: an empty search marks pickup, drop-off, date and pickup time together with focus on the pickup and one count sentence, a valid pickup clears only its own message, and step 3 lists two failures as links", async () => {
    const p = await open(ctx, P, "/book");
    await p.click("#bk-view");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)), ["e-from", "e-to", "e-date", "e-time"]);
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.textContent("#bk-status")], ["bk-from", "4 things to fix: pickup, drop-off, date and pickup time."]);
    assert.deepEqual(await p.evaluate(() => ["bk-from", "bk-to", "bk-date-btn", "bk-time"].map((id) => document.getElementById(id).getAttribute("aria-invalid"))), ["true", "true", "true", "true"]);
    await p.keyboard.type("jfk t4");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)), ["e-to", "e-date", "e-time"], "the first keystroke that makes the pickup valid clears only its message");
    await p.locator('#bk-from-list [role=option][aria-label="Terminal 4, John F. Kennedy (JFK)"]').click();
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-search .bk-e.is-on")].map((e) => e.id)), ["e-to", "e-date", "e-time"]);
    assert.equal(await p.getAttribute("#bk-from", "aria-invalid"), null);
    await p.keyboard.press("Escape");
    await place(p, "to", "350 5th Ave, New York, NY 10118");
    await pickDate(p, "#bk-date-btn", DATE);
    await p.selectOption("#bk-time", "12:40");
    await view(p);
    await priced(p);
    await next(p);
    await p.fill("#bk-name", "Ana Lopez");
    await p.click(await payBtn(p));
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-errs").hidden, document.querySelector("#bk-errs p").textContent, [...document.querySelectorAll("#bk-errs a")].map((a) => [a.getAttribute("href"), a.textContent])]), [false, "2 things to fix", [["#bk-email", "Add your email address, for example name@example.com."], ["#bk-phone", "Add your mobile number with the country code if it isn't a US number."]]]);
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-email");
    await p.click('#bk-errs a[href="#bk-phone"]');
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-phone");
    await p.fill("#bk-email", "ana@example.com");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#bk-det .bk-e.is-on")].map((e) => e.id)), ["e-phone"], "a valid email clears only its own message");
    await p.close();
  });
  await check("B39 the calendar opens by itself after the drop-off pick on the first bookable day, today is muted, New York time and the 24-hour line show, and a time under 24 hours shows its hint with no link", async () => {
    const p = await open(ctx, P, "/book");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await place(p, "to", "lga", "LaGuardia (LGA)");
    assert.equal(await p.isVisible("#bk-cal"), true, "the calendar opens after the drop-off pick");
    const today = nyDate(0), first = await p.evaluate(() => document.activeElement.dataset.day);
    assert.ok(first > today, first);
    assert.equal(await p.getAttribute(`#bk-cal [data-day="${today}"]`, "aria-label"), new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) + ", email or WhatsApp only");
    assert.match(await p.textContent(".bk-cal__tz"), /^New York time/);
    assert.equal(await p.textContent(".bk-cal__note"), "For a pickup in the next 24 hours, book by email or WhatsApp.");
    await p.keyboard.press("Escape");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-date-btn");
    await pickDate(p, "#bk-date-btn", today);
    const soon = await p.evaluate(() => [...document.getElementById("bk-time").options].find((o) => o.value && !o.disabled)?.value);
    assert.ok(soon, "a slot later today");
    assert.ok(await p.evaluate(() => [...document.getElementById("bk-time").options].filter((o) => o.value).some((o) => o.disabled)), "the slots before now plus 10 minutes are disabled");
    await p.selectOption("#bk-time", soon);
    await p.waitForFunction(() => !document.getElementById("bk-time-h").hidden);
    assert.deepEqual([await p.textContent("#bk-time-h"), await p.$("#bk-time-h a"), await p.textContent("#bk-status")], ["For a pickup in the next 24 hours, book by email or WhatsApp.", null, "For a pickup in the next 24 hours, book by email or WhatsApp."]);
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
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id")], ["John F. Kennedy (JFK), Terminal 4", "jfk-t4"]);
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
    assert.deepEqual([await p.inputValue("#bk-from"), await p.inputValue("#bk-from-id")], ["John F. Kennedy (JFK), Terminal 4", "jfk-t4"], "a bare airport pickup takes the answer's terminal");
    assert.match(await p.textContent("#bk-flight-status"), /Pickup set to Terminal 4 from your flight\./);
    assert.ok(await p.evaluate(() => document.getElementById("bk-from-f").classList.contains("is-washed")));
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
    await p.selectOption("#bk-time", "12:40");
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
  const later = nyDate(1);
  const far = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
  const cases = [
    ["short-notice", { date: later, time: "00:00" }, "Less than 24 hours away", "Change the date", async (p) => { await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden); return p.evaluate(() => document.activeElement.dataset.day > new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())); }],
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
      assert.match(b.href, /^mailto:info@nycluxride\.com\?subject=Booking request( NLR-[0-9A-Z]{8})?&body=Hi NYC LUX RIDE, I would like to book this trip\.\n/, reason);
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
    assert.match(decodeURIComponent(await p.getAttribute("#q-wa", "href")), /\?text=Hi NYC LUX RIDE, I would like to book this trip\.\nTrip: One way\nPickup: John F\. Kennedy \(JFK\), Terminal 4/);
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
    assert.deepEqual([await p.textContent("#bk-route-n"), await p.isVisible("#bk-drive")], ["Traffic estimate. Google Maps", false]);
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
  await check("B48 step 3: the check rows with Change and Add, When opens the calendar on the trip date, Car returns to the checked row, Trip updated only when the total moved, the email and phone helpers change nothing without a press, the sign card follows the name, Add child seats or a note opens the notes", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await p.check("#bk-meet");
    await priced(p);
    const rows = () => p.$$eval("#bk-check-rows > div", (d) => d.map((x) => [x.querySelector("dt").textContent, x.querySelector("dd").textContent, x.querySelector("button").textContent]));
    assert.deepEqual(await rows(), [["When", `${new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, 12:40 PM, New York time`, "Change date and time"], ["Flight", "Not provided", "Add a flight number"], ["Passengers", "1", "Change passengers"], ["Car", "Business SUVChevrolet Suburban or similar", "Change car"]]);
    assert.deepEqual(await p.$$eval("#bk-check-route li", (l) => l.map((x) => x.textContent)), ["12:40 PMJohn F. Kennedy (JFK), Terminal 4", "350 5th Ave, New York, NY 10118"]);
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
    await p.fill("#bk-email", "ana@gmial.com");
    await p.click("#bk-phone");
    await p.waitForSelector("#bk-email-s", { state: "visible" });
    assert.deepEqual([await p.isVisible("#bk-email-s"), await p.textContent("#bk-email-s"), await p.inputValue("#bk-email")], [true, "Did you mean ana@gmail.com? Use gmail.com", "ana@gmial.com"]);
    assert.equal(await p.getAttribute("#bk-email-s button", "aria-label"), null);
    await p.click("#bk-email-s button");
    assert.deepEqual([await p.inputValue("#bk-email"), await p.isVisible("#bk-email-s"), await p.textContent("#bk-status")], ["ana@gmail.com", false, "Email changed to ana@gmail.com."]);
    await p.fill("#bk-phone", "0044 7700 900123");
    await p.click("#bk-name");
    await p.waitForFunction(() => /^Use \+ in place/.test(document.getElementById("bk-phone-s").textContent));
    assert.deepEqual([await p.textContent("#bk-phone-s"), await p.inputValue("#bk-phone")], ["Use + in place of 00. Use +44 7700 900123", "0044 7700 900123"]);
    await p.click("#bk-phone-s button");
    assert.equal(await p.inputValue("#bk-phone"), "+44 7700 900123");
    await p.fill("#bk-phone", "07700 900123");
    await p.click("#bk-name");
    await p.waitForFunction(() => /^Numbers outside/.test(document.getElementById("bk-phone-s").textContent));
    assert.equal(await p.textContent("#bk-phone-s"), "Numbers outside the US need the country code, for example +44 7700 900123.");
    await p.fill("#bk-phone", "212 555 0100");
    await p.click("#bk-name");
    await p.waitForTimeout(400);
    assert.equal(await p.isVisible("#bk-phone-s"), false, "a US number shows nothing");
    await p.fill("#bk-name", "Ana Lopez");
    assert.deepEqual([await p.isVisible("#bk-signcard"), await p.textContent("#bk-signname"), await p.inputValue("#bk-sign")], [true, "Ana Lopez", "Ana Lopez"]);
    await p.fill("#bk-sign", "Dr Lopez");
    assert.equal(await p.textContent("#bk-signname"), "Dr Lopez");
    const card = await p.evaluate(() => { const r = document.getElementById("bk-signcard").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    assert.deepEqual(card, [240, 96]);
    assert.deepEqual([await p.isVisible("#bk-notes"), await p.isVisible("#bk-notes-add-h")], [false, true]);
    await p.click("#bk-notes-add");
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await p.isVisible("#bk-notes-add"), await p.getAttribute("#bk-notes-add", "aria-expanded")], ["bk-notes", false, "true"]);
    await p.close();
  });
  await ctx.close();
}

for (const width of [390, 1440]) {
  const ctx = await context(P, { viewport: { width, height: width === 390 ? 844 : 900 } });
  await check(`B49 at ${width} pay: on press the pay button keeps its gold, label and focus with aria-busy and is never disabled, the Stripe preconnect exists once${width === 390 ? ", and in step 3 the pay button rides in the bar and follows the total in the flow" : ""}`, async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await details(p);
    const btn = await payBtn(p);
    if (width === 390) assert.deepEqual([await p.isVisible("#bk-submit"), (await p.textContent("#bk-bar-go")).trim(), await p.getAttribute("#bk-bar-go", "aria-describedby"), await p.getAttribute("#bk-submit", "aria-describedby")], [true, "Book and pay online", "bk-consent", "bk-consent"]);
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
    assert.deepEqual(await p.evaluate(() => [document.getElementById("restored").classList.contains("is-on"), document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("book-form").dataset.step, location.hash]), [true, "350 5th Ave, New York, NY 10118", "John F. Kennedy (JFK), Terminal 4", DATE, "12:40", "search", ""]);
    assert.equal(await p.textContent("#restored span"), "We filled in your trip from earlier in this tab.");
    assert.ok(await p.evaluate(() => document.getElementById("bk-from-f").classList.contains("is-washed")));
    await p.click("#restored-clear");
    assert.deepEqual(await p.evaluate(() => [document.getElementById("restored").classList.contains("is-on"), document.getElementById("bk-from").value, document.getElementById("bk-date").value, sessionStorage.getItem("nlr-book"), document.activeElement.id]), [false, "", "", null, "bk-from"]);
    await trip(p, { from: ["350 5th Ave, New York, NY 10118"], to: ["jfk t4", "John F. Kennedy (JFK), Terminal 4"] });
    await view(p);
    await priced(p);
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("bk-from").value !== "");
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("bk-help")]), ["350 5th Ave, New York, NY 10118", "John F. Kennedy (JFK), Terminal 4", DATE, "12:40", null], "the homepage fills its default shape, with no help row");
    await p.evaluate((d) => sessionStorage.setItem("nlr-book", JSON.stringify({ v: 1, fields: { trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "350 5th Ave, New York, NY 10118", date: d, time: "12:40", passengers: "1", class: "suv" }, stops: 0, return: false, step: "options" })), DATE);
    await p.goto(`${P.base}/`, { waitUntil: "load" });
    await p.waitForFunction(() => document.getElementById("bk-from").value !== "");
    await settle(p, 800);
    assert.deepEqual(await p.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-to").value, document.getElementById("bk-date").value, document.getElementById("bk-time").value, document.getElementById("bk-flight-f").classList.contains("is-shown"), window.__cls]), ["John F. Kennedy (JFK), Terminal 4", "350 5th Ave, New York, NY 10118", DATE, "12:40", false, 0], "an airport pickup fills the homepage, the flight field waits, nothing moves");
    await p.selectOption("#bk-time", "13:00");
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
  await check("B51 INP proxy: with the CPU throttled 4 times, the longest event of View options, a class row, Book and pay online in step 2 and Book and pay online in step 3 each stays at or under 200 ms", async () => {
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
    for (const [name, ms] of [["View options", v], ["a class row", c], ["Book and pay online in step 2", n], ["Book and pay online in step 3", y]]) assert.ok(ms <= 200, `${name}: ${ms} ms`);
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
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
    const ref = await p.textContent("#cf-ref");
    const done = [p.url(), await p.evaluate(() => Object.entries(sessionStorage))];
    await p.close();
    p = await open(ctx, P, "/rates");
    await p.evaluate((s) => s.forEach(([k, v]) => sessionStorage.setItem(k, v)), done[1]);
    await p.goto(done[0], { waitUntil: "load" });
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
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
    assert.ok(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/NYC LUX RIDE\/\/Booking\/\/EN\r\nBEGIN:VEVENT\r\nUID:NLR-/.test(ics[1]) && ics[1].endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n") && !/BEGIN:VALARM/.test(ics[1]) && ics[1].split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "the file shape, no alarm, lines folded at 75 octets");
    await p.evaluate(() => { window.__share = null; navigator.share = undefined; });
    await p.click("#cf-share");
    await p.waitForTimeout(100);
    const share = await p.evaluate(() => navigator.clipboard.readText());
    assert.ok(!/\$|NLR-/.test(share) && share.startsWith("Your car is booked with NYC LUX RIDE.\n") && /Questions: \+1 \(646\) 775-0556 or https:\/\/wa\.me\/16467750556$/.test(share), share);
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
  await check("B53 step changes with motion on (Chrome): View options, Book and pay online, Back to vehicles and browser Back run as step-fwd and step-back view transitions, #bk-side holds still from 1024, the chips stay at opacity 1 at 150 ms, focus lands on the step heading, one bk-step name at a time", async () => {
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
    assert.match(wa, /^Hi NYC LUX RIDE, I would like to book this trip\.\nReference: NLR-[0-9A-Z]{8}\n[\s\S]*Meet and greet: Yes\nTotal shown: \$210\.00\nName: Ana Lopez\nEmail: ana@example\.org\nMobile: \+1 212 555 0100\nContact: Phone\nName for the sign: Ana Lopez$/);
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
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
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
  await check("B56 a search host with every field empty: View options marks the fields, says the count and moves focus to the pickup with no page error (UXA-02)", async () => {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const p = await open(ctx, P, "/locations/manhattan");
      await p.setViewportSize(vp);
      await p.focus("#bk-from");
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await p.evaluate(() => document.getElementById("bk-view").focus());
      await p.click("#bk-view");
      await p.waitForFunction(() => /things to fix/.test(document.getElementById("bk-status").textContent));
      assert.deepEqual([await p.textContent("#bk-status"), await p.evaluate(() => document.activeElement.id), p.errors, new URL(p.url()).pathname], ["4 things to fix: pickup, drop-off, date and pickup time.", "bk-from", [], "/locations/manhattan"], `${vp.width}`);
      await p.close();
    }
  });
  await check("B57 /book keeps the header at the top after a scroll and shows no phone or WhatsApp control outside the menu and the footer in steps 1 to 3, the nav stays in step 1 from 1024, and the current step is text, done steps buttons (UXA-01, UXA-12, P01, AI-2)", async () => {
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
      const r = await p.evaluate(() => [Math.round(document.querySelector(".site-header").getBoundingClientRect().top), [...document.querySelectorAll('.site-header a[href^="tel:"], .site-header a[href^="https://wa.me/"]')].filter((a) => a.getClientRects().length && !a.closest(".nav-panel")).length, [...document.querySelectorAll("#bk-steps li")].map((l) => [l.textContent, !!l.querySelector("button"), l.getAttribute("aria-current")]), document.querySelectorAll("#bk-steps button[disabled]").length]);
      assert.deepEqual(r, [0, 0, [["Trip", true, null], ["Vehicle", false, "step"], ["Details", false, null], ["Payment", false, null]], 0], `${vp.width} step 2`);
      await next(p);
      await p.evaluate(() => scrollTo(0, 500));
      await p.waitForTimeout(200);
      const s = await p.evaluate(() => [Math.round(document.querySelector(".site-header").getBoundingClientRect().top), [...document.querySelectorAll("#bk-steps li")].map((l) => [!!l.querySelector("button"), l.getAttribute("aria-current")])]);
      assert.deepEqual(s, [0, [[true, null], [true, null], [false, "step"], [false, null]]], `${vp.width} step 3`);
      await p.close();
    }
  });
  await check("B58 the step 3 error summary follows the fixes: three empty fields list three links, a filled name leaves two, all filled hides it (UXA-05)", async () => {
    const p = await open(ctx, P, "/book");
    await trip(p);
    await view(p);
    await priced(p);
    await next(p);
    await p.click(await payBtn(p));
    const sum = () => p.evaluate(() => { const r = document.getElementById("bk-errs"); return [r.hidden, (r.querySelector("p") || {}).textContent || "", [...r.querySelectorAll("a")].map((a) => a.getAttribute("href"))]; });
    assert.deepEqual(await sum(), [false, "3 things to fix", ["#bk-name", "#bk-email", "#bk-phone"]]);
    await p.fill("#bk-name", "Ana Lopez");
    assert.deepEqual(await sum(), [false, "2 things to fix", ["#bk-email", "#bk-phone"]]);
    await p.fill("#bk-email", "ana@example.com");
    assert.deepEqual(await sum(), [false, "1 thing to fix", ["#bk-phone"]]);
    await p.fill("#bk-phone", "+1 212 555 0100");
    assert.equal((await sum())[0], true);
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
    await stepTwo(p, { date: nyDate(0), time: "23:50" });
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
      await p.selectOption("#bk-time", "12:40");
      await Promise.all([p.waitForURL(/\/book/), p.click("#bk-view")]);
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
        await p.goBack({ waitUntil: "load" });
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js") && document.getElementById("bk-from").value);
      await p.waitForTimeout(600);
      const full = (x) => (x === "The New York EDITION" ? "The New York EDITION, Madison Avenue, New York, NY" : x);
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
  await check(`B64 at ${width} by ${height} with motion on, the homepage window opens below the header from the top, after a 300 px scroll and by keyboard (L1)`, async () => {
    for (const how of ["click", "scroll", "tab"]) {
      const p = await open(ctx, P, "/");
      await p.waitForTimeout(300);
      if (how === "scroll") { await p.evaluate(() => scrollTo(0, 300)); await p.waitForTimeout(300); }
      if (how === "tab") { await p.evaluate(() => document.querySelector("#bk-mode input:checked").focus({ preventScroll: true })); await p.keyboard.press("Tab"); }
      else await tap(p, "#bk-from");
      await p.waitForTimeout(1200);
      const r = await p.evaluate(() => [Math.round(document.querySelector(".hero__book").getBoundingClientRect().top), Math.round(document.querySelector(".site-header").getBoundingClientRect().bottom), document.activeElement.id, document.querySelector(".hero__book").classList.contains("is-open")]);
      assert.ok(r[0] >= r[1] && r[2] === "bk-from" && r[3], `${how}: window top ${r[0]}, header bottom ${r[1]}, focus ${r[2]}, open ${r[3]}`);
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
    await p.waitForFunction(() => /NLR-/.test(document.getElementById("cf-ref").textContent));
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
  await check(`B67 at ${width} by ${height}, one gold button is in view at every scroll position around the in-page button in steps 2 and 3, and the bar comes back once the button has left (AV-03, AI-5)`, async () => {
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
        if (Math.abs(k) === 6 && !(await p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); const h = document.querySelector(".site-header").getBoundingClientRect().bottom; return r.bottom > h && r.top < innerHeight; }, id))) assert.equal(g.length, 1, `${step} at scroll ${y}: the bar is back while the in-page button is out of view`);
      }
    }
    await p.close();
  });
  await ctx.close();
}

{
  const ctx = await context(G, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { for (const k of ["role", "ariaAutoComplete", "ariaBusy", "ariaCurrent", "ariaDisabled", "ariaExpanded", "ariaHidden", "ariaInvalid", "ariaLabel", "ariaModal", "ariaSelected"]) delete Element.prototype[k]; });
  await check("B68 where the browser has no ARIA reflection (Firefox before 119), the combobox, the swap button, the passenger stepper, the step list and the busy state still write their attributes, and /contact marks a missing field (AI-6)", async () => {
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
    assert.deepEqual(await p.evaluate(() => [document.querySelector(".bk-stepper button").getAttribute("aria-disabled"), [...document.querySelectorAll("#bk-steps li")].map((l) => l.getAttribute("aria-current"))]), ["true", [null, "step", null, null]]);
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
    await p.route("**/api/book", async (r) => { await new Promise((z) => setTimeout(z, 1500)); await r.continue(); });
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await p.evaluate(() => document.getElementById("bk-t-20").click());
    await p.waitForFunction(() => document.getElementById("price-total").getAttribute("aria-busy") === "true");
    const ratios = await p.evaluate(() => {
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
    assert.ok(ratios.length >= 1, "no busy total on screen");
    if (width < 1024) assert.ok(ratios.some(([id]) => id.startsWith("bk-bar-total")), JSON.stringify(ratios));
    for (const [id, r] of ratios) assert.ok(r >= 4.5, `${id} ${r}:1`);
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
    await check(`B71 ${name} step 3: Who is riding, How should we contact you and the gratuity chips move the same indicator to the new choice`, async () => {
      const p = await open(ctx, G, "/book");
      await trip(p);
      await view(p);
      await priced(p);
      await next(p);
      await priced(p);
      for (const [id, sel, text] of [["bk-who", 'label[for="bk-r-other"]', "Someone else"], ["bk-reach", 'label[for="bk-reach-wa"]', "WhatsApp"], ["bk-tip-opts", "#bk-tip-opts label:last-child", null]]) {
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
  for (const e of document.querySelectorAll("#bk-assure, .banner .lede, .hero__lede")) if (vis(e)) texts(e, "below");
  const bad = [], gr = S.getBoundingClientRect();
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j];
    if (a.g === b.g || (a.k === "control" && b.k === "control") || (a.g === "below" && b.g === "below")) continue;
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5) bad.push(`${a.g} ${a.k} x ${b.g} ${b.k}`);
  }
  for (const a of atoms.slice(0, inside)) if (a.b > gr.bottom + 0.5 || a.t < gr.top - 0.5) bad.push(`${a.g} ${a.k} outside the bar`);
  return [...new Set(bad)];
};
const SOON = nyDate(1);
const STATES = {
  airport: async (p) => { if (!(await p.inputValue("#bk-from"))) await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4"); },
  found: async (p) => { await STATES.airport(p); await p.fill("#bk-flight", "EK201"); await p.waitForTimeout(1500); },
  missing: async (p) => { await STATES.airport(p); await p.fill("#bk-flight", "DL1234"); await p.waitForTimeout(1500); },
  cleared: async (p) => { await STATES.found(p); await p.fill("#bk-flight", ""); await p.waitForTimeout(700); },
  hourly: async (p) => { await p.click('label[for="bk-hour"]'); await STATES.airport(p); },
  "return flight": async (p) => { await p.fill("#bk-from", ""); await place(p, "from", "350 5th Ave, New York, NY 10118"); await place(p, "to", "jfk t4", "John F. Kennedy (JFK), Terminal 4"); await p.keyboard.press("Escape"); await p.click("#bk-addret"); await p.fill("#bk-rflight", "EK201"); await p.waitForTimeout(1500); },
  "inside 24 hours": async (p) => { await STATES.found(p); await pickDate(p, "#bk-date-btn", SOON); const v = await p.$$eval("#bk-time option:not([disabled])", (o) => o.map((x) => x.value).filter(Boolean)); await p.selectOption("#bk-time", v[0]); },
  "inside 24 hours, no airport": async (p) => { await p.fill("#bk-from", ""); await place(p, "from", "350 5th Ave, New York, NY 10118"); await pickDate(p, "#bk-date-btn", SOON); const v = await p.$$eval("#bk-time option:not([disabled])", (o) => o.map((x) => x.value).filter(Boolean)); await p.selectOption("#bk-time", v[0]); },
  "missing fields": async (p) => { await STATES.airport(p); await p.keyboard.press("Escape"); await p.click("#bk-view"); await p.waitForTimeout(400); },
};
for (const [name, b] of ENGINES) {
  const plan = name === "chromium" ? [["/services", [768, 1024, 1180, 1280, 1440, 1920]], ["/book", [768, 1024, 1280, 1440]], ["/", [1024, 1440]], ["/locations/jfk-airport", [1024, 1440]]] : [["/services", [1024, 1440]], ["/book", [1440]]];
  for (const [path, widths] of plan) for (const width of widths) {
    const ctx = await engineContext(b, G, { viewport: { width, height: width < 1024 ? 1024 : 900 }, reducedMotion: "reduce" });
    await check(`B72 ${name} ${path} at ${width}: the flight field, its status, the return flight and the 24 hour line never cover a label, input, underline or divider, and stay inside the bar`, async () => {
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
    await check(`B74 ${name} at ${width} with motion on: a double click on View options or Book and pay online lands on the next step heading, a double click on Change the date opens the calendar on a day`, async () => {
      const dbl = async (p, sel) => {
        const r = await p.locator(sel).boundingBox();
        await p.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);
        await p.waitForTimeout(1500);
        return p.evaluate(() => [document.getElementById("book-form").dataset.step, document.activeElement.dataset.day ? "day" : document.activeElement.id || document.activeElement.tagName]);
      };
      const p = await open(ctx, P, "/book");
      await trip(p);
      await p.waitForTimeout(300);
      assert.deepEqual(await dbl(p, "#bk-view"), ["options", "bk-opt-h"]);
      await priced(p);
      assert.deepEqual(await dbl(p, width >= 1024 ? "#bk-next" : "#bk-bar-go"), ["details", "bk-det-h"]);
      await p.close();
      const q = await open(ctx, P, "/book");
      await trip(q, { date: SOON, time: "00:00" });
      await q.click("#bk-view");
      await q.waitForSelector("#q-fix", { state: "visible" });
      await q.waitForTimeout(1200);
      await q.locator("#q-fix").scrollIntoViewIfNeeded();
      await q.waitForTimeout(300);
      assert.deepEqual(await dbl(q, "#q-fix"), ["search", "day"]);
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
  await check("B76 a picked terminal shows its end while the box is not focused, and reads from the start while it is", async () => {
    const p = await open(ctx, P, "/book");
    await place(p, "from", "jfk t4", "John F. Kennedy (JFK), Terminal 4");
    await p.keyboard.press("Escape");
    await p.mouse.click(2, 2);
    const look = () => p.$eval("#bk-from", (i) => [i.value, getComputedStyle(i).direction, i.classList.contains("is-end")]);
    assert.deepEqual(await look(), ["John F. Kennedy (JFK), Terminal 4", "rtl", true]);
    await p.focus("#bk-from");
    assert.deepEqual(await look(), ["John F. Kennedy (JFK), Terminal 4", "ltr", true]);
    await p.keyboard.press("End");
    await p.keyboard.type(" x");
    assert.equal((await look())[2], false);
    await p.close();
  });
  await ctx.close();
  const nojs = await context(P, { viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  await check("B77 without javascript a short-notice answer leads with Email to reserve in gold, then WhatsApp, with no pay button", async () => {
    const p = await open(nojs, P, "/book");
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", SOON);
    await p.selectOption("#bk-time", "00:00");
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
for (const [name, b] of ENGINES.slice(1)) await b.close();

await browser.close();
if (failures) {
  console.error(`\n${failures} book browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll book browser tests passed");
process.exit(0);
