import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const { AIRPORT_FARES, VEHICLES, GRATUITY_RATE, HOURS } = await import(pathToFileURL(join(ROOT, "api", "_rates.mjs")).href);
const { HEADINGS } = await import(pathToFileURL(join(ROOT, "api", "_copy.mjs")).href);

const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "SALES_TAX_RATE_ID", "SALES_TAX_PERCENT", "STRIPE_SECRET_KEY", "VERCEL_ENV"];
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 3 * 864e5));
const SHOWN_DATE = new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const withTip = (fare) => fare + Math.round(fare * GRATUITY_RATE);

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
const Q = await serve({ BOOK_MOCK: "true" });
process.on("exit", () => {
  P.child.kill();
  Q.child.kill();
});

const SPY = () => {
  window.__purchases = [];
  let real;
  Object.defineProperty(window, "nlrPurchase", {
    configurable: true,
    get: () => real && ((...a) => (window.__purchases.push(a), real(...a))),
    set: (f) => (real = f),
  });
  let ads;
  Object.defineProperty(window, "NLR_ADS_ID", {
    configurable: true,
    get: () => ads,
    set: (v) => ((window.__gtagHref = location.href), (ads = v)),
  });
  document.addEventListener("DOMContentLoaded", () => {
    const price = document.getElementById("price");
    window.__priceShown = false;
    if (price) new MutationObserver(() => price.hidden || (window.__priceShown = true)).observe(price, { attributes: true });
  });
};

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`);
  }
}

const browser = await chromium.launch();

async function context(server, options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", ...options });
  ctx.external = [];
  ctx.api = [];
  await ctx.route((url) => !url.href.startsWith(server.base), (route) => {
    ctx.external.push(route.request().url());
    route.fulfill({ status: 204, body: "" });
  });
  ctx.on("request", (r) => r.url().startsWith(`${server.base}/api/`) && ctx.api.push(r));
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

async function fillPriced(page) {
  await page.selectOption("#bk-from", "manhattan");
  await page.fill("#bk-from-address", "350 Fifth Avenue");
  await page.selectOption("#bk-to", "jfk");
  await page.fill("#bk-date", DATE);
  await page.fill("#bk-time", "07:30");
}

const priceShown = (page) => page.waitForFunction(() => !document.getElementById("price").hidden && document.getElementById("price-total").textContent !== "");
const panel = (page) =>
  page.evaluate(() => ({
    lines: [...document.querySelectorAll("#price-lines tr")].map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]),
    total: document.getElementById("price-total").textContent,
    notes: document.getElementById("price-notes").textContent,
  }));
const visible = (page, sels) => Promise.all(sels.map((s) => page.isVisible(s)));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const waText = async (page) => decodeURIComponent((await page.getAttribute("#q-wa", "href")).split("?text=")[1] || "");

const ctx = await context(P);
const page = await open(ctx, P, "/book");

await check("P1 /book loads with no console error, no failed request and no call to the function", async () => {
  await page.waitForTimeout(700);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.failed, []);
  assert.equal(ctx.api.length, 0, `${ctx.api.length} calls before any change`);
});

await check("P1 the static request block and panel are not shown on load", async () => {
  assert.deepEqual(await visible(page, ["#price", "#quote", "#resume", "#q-switch", ".bk-e"]), [false, false, false, false, false]);
  assert.match(await page.inputValue("#bk-nonce"), /^[A-Za-z0-9-]{16,64}$/);
});

await check("P2 one way defaults to Business SUV, by the hour to Suburban or similar", async () => {
  assert.equal(await page.inputValue("#bk-class"), "suv");
  assert.ok(await page.isVisible("#bk-class"));
  await page.check("#bk-hour");
  assert.ok(await page.isVisible("#bk-vehicle"));
  assert.equal(await page.inputValue("#bk-vehicle"), "suv-suburban");
  await page.check("#bk-one");
});

await check("P12 one way hides Hours and Vehicle, and hidden controls are disabled", async () => {
  assert.deepEqual(await visible(page, ["#bk-hours", "#bk-vehicle", "#bk-to", "#bk-class"]), [false, false, true, true]);
  assert.deepEqual(await page.evaluate(() => ["bk-hours", "bk-vehicle"].map((id) => document.getElementById(id).disabled)), [true, true]);
});

await check("P12 by the hour hides Drop-off, both drop-off fields and Vehicle class", async () => {
  await page.check("#bk-hour");
  await page.selectOption("#bk-from", "manhattan");
  assert.deepEqual(await visible(page, ["#bk-to", "#bk-to-address", "#bk-class", "#bk-hours", "#bk-vehicle", "#bk-from-address"]), [false, false, false, true, true, true]);
  await page.check("#bk-one");
  await page.selectOption("#bk-to", "brooklyn");
  assert.ok(await page.isVisible("#bk-to-address"));
  assert.ok(await page.evaluate(() => document.getElementById("bk-to-address").required));
});

await check("P12 an airport pickup shows Meet and greet and Flight and needs no address", async () => {
  assert.deepEqual(await visible(page, ["#bk-meet", "#bk-flight"]), [false, false]);
  await page.selectOption("#bk-from", "jfk");
  assert.deepEqual(await visible(page, ["#bk-meet", "#bk-flight", "#bk-from-address"]), [true, true, false]);
  assert.equal(await page.evaluate(() => document.getElementById("bk-from-address").disabled), true);
  await page.selectOption("#bk-from", "");
  await page.selectOption("#bk-to", "");
});

await check("P3 Manhattan address to JFK prices by itself: two lines and the config total", async () => {
  await fillPriced(page);
  await priceShown(page);
  const p = await panel(page);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.lines[0], ["To JFK, Business SUV", cash(AIRPORT_FARES.suv.jfk)]);
  assert.equal(p.lines[1][0], `Gratuity for your chauffeur (${GRATUITY_RATE * 100}%)`);
  assert.equal(p.total, cash(withTip(AIRPORT_FARES.suv.jfk)));
  assert.equal(p.total, "$198.00");
  assert.ok(p.notes.length > 20);
  assert.equal(await page.isVisible("#quote"), false);
});

await check("P3 an identical price check is never repeated", async () => {
  const before = ctx.api.length;
  await page.evaluate(() => document.getElementById("bk-to").dispatchEvent(new Event("change", { bubbles: true })));
  await page.waitForTimeout(800);
  assert.equal(ctx.api.length, before);
  for (const r of ctx.api) {
    const body = JSON.parse(r.postData());
    assert.equal(r.headers()["content-type"], "application/json");
    assert.match(r.headers().accept, /application\/json/);
    assert.ok(Object.values(body).every((v) => typeof v === "string"), "a value is not a string");
    assert.ok(!("amount" in body || "price" in body || "total" in body || "fare" in body));
  }
});

await check("P3 typing in the address after a price checks again but leaves the unchanged price as it is", async () => {
  const before = ctx.api.length;
  await page.evaluate(() => {
    window.__mutations = 0;
    new MutationObserver((list) => (window.__mutations += list.length)).observe(document.getElementById("bk-result"), { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await page.type("#bk-from-address", " Suite 1", { delay: 40 });
  await page.waitForTimeout(900);
  await page.fill("#bk-from-address", "350 Fifth Avenue");
  await page.waitForTimeout(900);
  assert.ok(ctx.api.length > before, "no check was sent");
  assert.equal(await page.evaluate(() => window.__mutations), 0);
  assert.equal((await panel(page)).total, "$198.00");
});

let waAfterSedan = "";
await check("P4 Sedan & Electric shows the request block with the Switch button and its fare", async () => {
  await page.selectOption("#bk-class", "sedan");
  await page.waitForSelector("#q-class-airport", { state: "visible" });
  assert.equal((await page.textContent("#q-class-airport h2")).trim(), HEADINGS.price);
  assert.equal(await page.isVisible("#price"), false);
  assert.ok(await page.isVisible("#q-switch"));
  assert.equal(await page.textContent("#q-switch-fare"), cash(AIRPORT_FARES.suv.jfk));
  assert.equal((await page.textContent("#q-switch")).replace(/\s+/g, " ").trim(), `Switch to Business SUV, fare ${cash(AIRPORT_FARES.suv.jfk)}`);
  waAfterSedan = await waText(page);
});

await check("P5 the WhatsApp link of a request carries the reference, the address and the date", async () => {
  assert.match(waAfterSedan, /^Hi NYC LUX RIDE, I would like to book this trip\.\nReference: NLR-[0-9A-HJKMNP-TV-Z]{6}\n/);
  assert.ok(waAfterSedan.includes("Pickup: 350 Fifth Avenue, Manhattan"));
  assert.ok(waAfterSedan.includes(`Date: ${SHOWN_DATE}`), `no "Date: ${SHOWN_DATE}"`);
  assert.ok(waAfterSedan.includes("Vehicle: Sedan & Electric"));
  assert.match(await page.getAttribute("#q-mail", "href"), /^mailto:info@nycluxride\.com\?subject=Booking%20request%20NLR-/);
});

await check("P4 pressing Switch selects Business SUV and the panel fills", async () => {
  await page.click("#q-switch");
  await priceShown(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), "bk-class");
  assert.equal(await page.inputValue("#bk-class"), "suv");
  assert.equal((await panel(page)).total, "$198.00");
  assert.equal(await page.isVisible("#quote"), false);
});

await check("P15 no horizontal overflow at 320 and 360 pixels with the panel and with the request block", async () => {
  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(100);
    assert.ok((await overflow(page)) <= 1, `panel overflows at ${w}px`);
  }
  await page.selectOption("#bk-class", "first");
  await page.selectOption("#bk-to", "lga");
  await page.waitForSelector("#q-first-lga", { state: "visible" });
  assert.ok(await page.isVisible("#q-switch"));
  assert.equal(await page.textContent("#q-switch-fare"), cash(AIRPORT_FARES.suv.lga));
  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(100);
    assert.ok((await overflow(page)) <= 1, `request block overflows at ${w}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.selectOption("#bk-class", "suv");
  await page.selectOption("#bk-to", "jfk");
  await priceShown(page);
});

let ref = "";
await check("P6 submitting the priced trip lands on the confirmation with the receipt and one purchase call", async () => {
  await Promise.all([page.waitForURL(/\/booking-confirmed/), page.click("#bk-submit")]);
  await page.waitForSelector("#cf-receipt", { state: "visible" });
  assert.equal(new URL(page.url()).search, "", "session_id still in the address bar");
  assert.equal(new URL(page.url()).pathname, "/booking-confirmed");
  const s = await page.evaluate(() => ({
    ref: document.getElementById("cf-ref").textContent,
    h: document.getElementById("cf-h").textContent,
    summary: document.getElementById("cf-summary").textContent,
    lines: document.querySelectorAll("#cf-lines tr").length,
    total: document.getElementById("cf-total").textContent,
    test: !document.getElementById("cf-test").hidden,
    purchases: window.__purchases,
    gtagHref: window.__gtagHref,
    stored: sessionStorage.getItem("nlr-cf"),
    layer: [...(window.nlrDataLayer || [])].filter((a) => a[0] === "event" && a[1] === "conversion").length,
  }));
  ref = s.ref;
  assert.match(s.ref, /^NLR-[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(s.h, "Payment received");
  assert.ok(s.summary.includes("To JFK, Business SUV"), s.summary);
  assert.equal(s.lines, 2);
  assert.equal(s.total, "$198.00");
  assert.equal(s.test, true, "the mock session is not labelled as a test booking");
  assert.equal(s.stored, `cs_mock_${s.ref.slice(4)}`);
  assert.deepEqual(s.purchases, [[`cs_mock_${s.ref.slice(4)}`, s.ref, AIRPORT_FARES.suv.jfk]]);
  assert.doesNotMatch(s.gtagHref, /session_id/, "the ad tag ran while the session id was in the URL");
  assert.equal(s.layer, 0, "a conversion reached the data layer");
  assert.deepEqual(ctx.external.filter((u) => /transaction_id|cs_mock|session_id/.test(u)), []);
  assert.deepEqual(page.errors, []);
});

await check("P7 a reload shows the receipt again and does not call nlrPurchase again", async () => {
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#cf-receipt", { state: "visible" });
  assert.equal(await page.textContent("#cf-ref"), ref);
  assert.deepEqual(await page.evaluate(() => window.__purchases), []);
});

await check("P10 with nlr-book saved, /book#resume refills the form and shows the note", async () => {
  await page.goto(`${P.base}/rates`);
  await page.evaluate((d) => sessionStorage.setItem("nlr-book", JSON.stringify({ action: "pay", trip_type: "one", from: "brooklyn", from_address: "1 Main Street", to: "lga", date: d, time: "09:15", passengers: "3", class: "first", meet: "", nonce: "resume-nonce-0123456789" })), DATE);
  await page.goto(`${P.base}/book#resume`, { waitUntil: "load" });
  assert.ok(await page.isVisible("#resume"));
  assert.deepEqual(
    await page.evaluate(() => ["bk-from", "bk-from-address", "bk-to", "bk-date", "bk-time", "bk-pax", "bk-class", "bk-nonce"].map((id) => document.getElementById(id).value)),
    ["brooklyn", "1 Main Street", "lga", DATE, "09:15", "3", "first", "resume-nonce-0123456789"],
  );
  await page.waitForSelector("#q-first-lga", { state: "visible" });
});

await check("P8 the hero hand-off maps the texts, ignores hours one way, keeps the flight and clears the URL", async () => {
  const before = ctx.external.length;
  const q = `/book?trip-type=one&pickup=JFK+Airport&dropoff=350+Fifth+Avenue&hours=5&date=${DATE}&time=14%3A00&passengers=2&flight=DL+401`;
  await page.goto(`${P.base}${q}`, { waitUntil: "load" });
  const v = await page.evaluate(() => ({
    one: document.getElementById("bk-one").checked,
    from: document.getElementById("bk-from").value,
    fromAddress: document.getElementById("bk-from-address").value,
    to: document.getElementById("bk-to").value,
    toAddress: document.getElementById("bk-to-address").value,
    hours: document.getElementById("bk-hours").value,
    pax: document.getElementById("bk-pax").value,
    flight: document.getElementById("bk-flight").value,
    date: document.getElementById("bk-date").value,
    time: document.getElementById("bk-time").value,
    search: location.search,
    gtagHref: window.__gtagHref,
  }));
  assert.deepEqual(
    [v.one, v.from, v.fromAddress, v.to, v.toAddress, v.hours, v.pax, v.flight, v.date, v.time, v.search],
    [true, "jfk", "", "", "350 Fifth Avenue", `${HOURS.min}`, "2", "DL 401", DATE, "14:00", ""],
  );
  assert.ok(await page.isVisible("#bk-flight"));
  assert.doesNotMatch(v.gtagHref, /pickup|dropoff|flight|Fifth/, "the ad tag ran with the trip in the URL");
  assert.deepEqual(ctx.external.slice(before).filter((u) => /pickup|dropoff|Fifth|DL\+401|DL%20401/i.test(u)), []);
});

await check("P8 LaGuardia Place stays an address, Newark Liberty Airport maps to EWR", async () => {
  await page.goto(`${P.base}/book?trip-type=one&pickup=100+LaGuardia+Place&dropoff=Newark+Liberty+Airport`, { waitUntil: "load" });
  assert.deepEqual(await page.evaluate(() => ["bk-from", "bk-from-address", "bk-to", "bk-to-address"].map((id) => document.getElementById(id).value)), ["", "100 LaGuardia Place", "ewr", ""]);
});

await check("P8 by the hour the hand-off keeps the hours and ignores the drop-off, other parameters survive", async () => {
  await page.goto(`${P.base}/book?trip-type=hour&pickup=LGA&dropoff=Somewhere&hours=5&gclid=abc123`, { waitUntil: "load" });
  assert.deepEqual(await page.evaluate(() => [document.getElementById("bk-hour").checked, document.getElementById("bk-from").value, document.getElementById("bk-hours").value, document.getElementById("bk-to-address").value, location.search]), [true, "lga", "5", "", "?gclid=abc123"]);
});

await check("P11 by the hour from JFK prices with no address field shown", async () => {
  await page.goto(`${P.base}/book`, { waitUntil: "load" });
  await page.check("#bk-hour");
  await page.selectOption("#bk-from", "jfk");
  await page.fill("#bk-date", DATE);
  await page.fill("#bk-time", "10:00");
  await priceShown(page);
  assert.equal(await page.isVisible("#bk-from-address"), false);
  const p = await panel(page);
  assert.deepEqual(p.lines[0], [`By the hour, ${VEHICLES["suv-suburban"].model} (Business SUV), ${HOURS.min} hours`, cash(HOURS.min * VEHICLES["suv-suburban"].hourly)]);
  assert.equal(p.total, cash(withTip(HOURS.min * VEHICLES["suv-suburban"].hourly)));
});

await check("P11 by the hour from Newark Liberty shows the outside-hourly request", async () => {
  await page.selectOption("#bk-from", "ewr");
  await page.waitForSelector("#q-outside-hourly", { state: "visible" });
  assert.equal(await page.isVisible("#price"), false);
  assert.equal(await page.isVisible("#q-switch"), false);
});

await check("P11 a Luxury Sprinter by the hour shows the sprinter-hourly request", async () => {
  await page.selectOption("#bk-from", "queens");
  await page.fill("#bk-from-address", "30-30 Thomson Avenue");
  await page.selectOption("#bk-vehicle", "sprinter");
  await page.waitForSelector("#q-sprinter-hourly", { state: "visible" });
  assert.equal(await page.isVisible("#q-outside-hourly"), false);
});

await check("P13 submitting with no pickup shows the message, focuses Pickup and marks it invalid", async () => {
  await page.goto(`${P.base}/book`, { waitUntil: "load" });
  await page.click("#bk-submit");
  await page.waitForSelector("#e-from", { state: "visible" });
  const s = await page.evaluate(() => ({ focus: document.activeElement.id, invalid: document.getElementById("bk-from").getAttribute("aria-invalid"), by: document.getElementById("bk-from").getAttribute("aria-describedby") }));
  assert.deepEqual(s, { focus: "bk-from", invalid: "true", by: "e-from" });
  const look = await page.evaluate(() => {
    document.activeElement.blur();
    const from = getComputedStyle(document.getElementById("bk-from")).borderTopColor;
    const pax = getComputedStyle(document.getElementById("bk-pax")).borderTopColor;
    return { differs: from !== pax, chevron: getComputedStyle(document.getElementById("bk-from").parentElement, "::after").display };
  });
  assert.deepEqual(look, { differs: true, chevron: "block" });
  assert.equal(await page.isEnabled("#bk-submit"), true);
  await page.selectOption("#bk-from", "manhattan");
  assert.equal(await page.isVisible("#e-from"), false);
  assert.equal(await page.getAttribute("#bk-from", "aria-invalid"), null);
  assert.equal(await page.getAttribute("#bk-from", "aria-describedby"), null);
});

await check("P13 a second server error focuses the field it names", async () => {
  await page.fill("#bk-from-address", "350 Fifth Avenue");
  await page.selectOption("#bk-to", "jfk");
  await page.fill("#bk-date", "2020-01-01");
  await page.fill("#bk-time", "07:30");
  await page.click("#bk-submit");
  await page.waitForSelector("#e-date-past", { state: "visible" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "bk-date");
  assert.equal(await page.getAttribute("#bk-date", "aria-describedby"), "e-date-past");
});

await check("UX9 a missing time is marked and focused on the Time field", async () => {
  await page.fill("#bk-date", DATE);
  await page.fill("#bk-time", "");
  await page.click("#bk-submit");
  await page.waitForSelector("#e-date", { state: "visible" });
  const s = await page.evaluate(() => ({ focus: document.activeElement.id, invalid: document.getElementById("bk-time").getAttribute("aria-invalid"), by: document.getElementById("bk-time").getAttribute("aria-describedby"), date: document.getElementById("bk-date").getAttribute("aria-invalid") }));
  assert.deepEqual(s, { focus: "bk-time", invalid: "true", by: "e-date", date: null });
});

await check("P16 the tab order on /book reaches the submit button", async () => {
  await page.goto(`${P.base}/book`, { waitUntil: "load" });
  let id = "";
  for (let i = 0; i < 80 && id !== "bk-submit"; i++) {
    await page.keyboard.press("Tab");
    id = await page.evaluate(() => document.activeElement.id);
    assert.notEqual(id, "bk-hp", "the honeypot takes focus");
  }
  assert.equal(id, "bk-submit");
});

await check("D48 a response that is not the expected JSON shows the error block with the static links", async () => {
  await page.goto(`${P.base}/book`, { waitUntil: "load" });
  await page.route("**/api/book", (route) => route.fulfill({ status: 429, contentType: "text/plain", body: "Too Many Requests" }));
  await fillPriced(page);
  await page.waitForSelector("#q-error", { state: "visible" });
  assert.equal((await page.textContent("#q-error h2")).trim(), HEADINGS.phone);
  assert.equal(await page.getAttribute("#q-wa", "href"), "https://wa.me/16467750556");
  assert.equal(await page.getAttribute("#q-mail", "href"), "mailto:info@nycluxride.com");
  await page.unroute("**/api/book");
});

await check("a payment URL off Stripe is never followed", async () => {
  await page.goto(`${P.base}/book`, { waitUntil: "load" });
  await fillPriced(page);
  await priceShown(page);
  await page.route("**/api/book", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "pay", ref: "NLR-AAAAAA", url: "https://example.com/c/pay" }) }));
  await page.click("#bk-submit");
  await page.waitForSelector("#q-error", { state: "visible" });
  assert.equal(new URL(page.url()).pathname, "/book");
  assert.equal(await page.isEnabled("#bk-submit"), true);
  await page.unroute("**/api/book");
});

await check("P15 no horizontal overflow at 320 and 360 pixels on the confirmation with the receipt", async () => {
  await page.goto(`${P.base}/book`, { waitUntil: "load" });
  await fillPriced(page);
  await priceShown(page);
  await Promise.all([page.waitForURL(/\/booking-confirmed/), page.click("#bk-submit")]);
  await page.waitForSelector("#cf-receipt", { state: "visible" });
  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(100);
    assert.ok((await overflow(page)) <= 1, `overflows at ${w}px`);
  }
});

await check("F1 a paid booking clears the nonce before leaving /book, so a page brought back by Back gets a new reference", async () => {
  const p = await open(ctx, P, "/book");
  await fillPriced(p);
  await priceShown(p);
  const nonce = await p.inputValue("#bk-nonce");
  await p.route("**/booking-confirmed*", (route) => route.fulfill({ status: 204, body: "" }));
  await Promise.all([p.waitForRequest((r) => r.url().includes("/booking-confirmed")), p.click("#bk-submit")]);
  await p.waitForTimeout(400);
  const s = await p.evaluate(() => ({ now: document.getElementById("bk-nonce").value, saved: JSON.parse(sessionStorage.getItem("nlr-book")).nonce, url: location.pathname }));
  assert.deepEqual(s, { now: "", saved: nonce, url: "/book" });
  await p.unroute("**/booking-confirmed*");
  await p.close();
});

await check("UX4 the total sits directly above Continue on phones and tablets", async () => {
  const p = await open(ctx, P, "/book");
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await p.setViewportSize({ width, height });
    await p.goto(`${P.base}/book`, { waitUntil: "load" });
    await fillPriced(p);
    await priceShown(p);
    const r = await p.evaluate(() => [document.getElementById("price-total").getBoundingClientRect().bottom, document.getElementById("bk-submit").getBoundingClientRect().top]);
    assert.ok(r[0] < r[1] && r[1] - r[0] < 160, `${width}px: total ends at ${r[0]}, Continue starts at ${r[1]}`);
  }
  await p.close();
});

await check("UX2 on /book the header and action bar Book a car links stay on the page and keep the trip", async () => {
  const p = await open(ctx, P, "/book");
  await p.setViewportSize({ width: 390, height: 844 });
  await fillPriced(p);
  await priceShown(p);
  assert.deepEqual(await p.evaluate(() => [".site-header__desk .btn", ".actionbar__cell--book", ".nav-panel__book a"].map((sel) => [document.querySelector(sel).getAttribute("href"), document.querySelector(sel).getAttribute("aria-current")])), [["#book-form", "page"], ["#book-form", "page"], ["/book", null]]);
  let reloaded = false;
  p.on("request", (r) => r.isNavigationRequest() && (reloaded = true));
  await p.click(".actionbar__cell--book");
  await p.waitForTimeout(300);
  assert.equal(reloaded, false);
  assert.equal(new URL(p.url()).pathname, "/book");
  assert.deepEqual(await p.evaluate(() => ["bk-from", "bk-from-address", "bk-to", "bk-date"].map((id) => document.getElementById(id).value)), ["manhattan", "350 Fifth Avenue", "jfk", DATE]);
  assert.equal(await p.isVisible("#price"), true);
  await p.close();
});

await check("UX1 a street address from the hero shows in the pickup address field with a prompt to choose the borough", async () => {
  const hero = await open(ctx, P, "/");
  await hero.fill("#trip-pick", "350 Fifth Avenue");
  await hero.fill("#trip-drop", "JFK Terminal 4");
  await hero.fill("#trip-date", DATE);
  await hero.fill("#trip-time", "10:00");
  await Promise.all([hero.waitForURL((u) => u.pathname === "/book"), hero.click(".trip__book")]);
  await hero.waitForLoadState("load");
  assert.deepEqual(await hero.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-from-address").value, document.getElementById("bk-to").value]), ["", "350 Fifth Avenue", "jfk"]);
  assert.ok(await hero.isVisible("#bk-from-address"), "the typed address is hidden");
  assert.ok(await hero.isVisible("#e-from"), "no prompt to choose the borough");
  assert.notEqual(await hero.evaluate(() => document.activeElement.id), "bk-from");
  await hero.selectOption("#bk-from", "manhattan");
  await priceShown(hero);
  assert.equal(await hero.isVisible("#e-from"), false);
  assert.equal((await panel(hero)).total, "$198.00");
  await hero.close();
});

await check("UX12 an invalid value during the automatic check shows its message without moving focus", async () => {
  const p = await open(ctx, P, "/book");
  await p.selectOption("#bk-from", "jfk");
  await p.selectOption("#bk-to", "manhattan");
  await p.fill("#bk-to-address", "350 Fifth Avenue");
  await p.fill("#bk-date", DATE);
  await p.fill("#bk-time", "07:30");
  await priceShown(p);
  await p.fill("#bk-flight", "DL-401!");
  await p.waitForSelector("#e-flight", { state: "visible" });
  assert.equal(await p.isVisible("#price"), false);
  assert.equal(await p.evaluate(() => document.activeElement.id), "bk-flight");
  assert.equal(await p.getAttribute("#bk-flight", "aria-invalid"), null);
  await p.fill("#bk-flight", "DL 401");
  await priceShown(p);
  assert.equal(await p.isVisible("#e-flight"), false);
  await p.close();
});

await check("P9 submitting the homepage hero form navigates to /book carrying the trip", async () => {
  const hero = await open(ctx, P, "/");
  await hero.fill("#trip-pick", "LaGuardia Airport");
  await hero.fill("#trip-drop", "200 Park Avenue");
  await hero.fill("#trip-date", DATE);
  await hero.fill("#trip-time", "18:45");
  await hero.selectOption("#trip-pax", "4");
  const [nav] = await Promise.all([hero.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/book"), hero.click(".trip__book")]);
  const q = new URL(nav.url()).searchParams;
  assert.equal(nav.method(), "GET");
  assert.deepEqual(["trip-type", "pickup", "dropoff", "date", "time", "passengers"].map((k) => q.get(k)), ["one", "LaGuardia Airport", "200 Park Avenue", DATE, "18:45", "4"]);
  await hero.waitForURL((u) => u.pathname === "/book");
  await hero.waitForLoadState("load");
  assert.deepEqual(await hero.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-to-address").value, location.search]), ["lga", "200 Park Avenue", ""]);
  await hero.close();
});

await check("P9 an incomplete hero form does not navigate", async () => {
  const hero = await open(ctx, P, "/");
  let navigated = false;
  hero.on("request", (r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/book" && (navigated = true));
  await hero.click(".trip__book");
  await hero.waitForTimeout(400);
  assert.equal(navigated, false);
  assert.match(await hero.textContent(".trip__msg"), /^Add a pickup/);
  await hero.close();
});

await page.close();
await ctx.close();

const nojs = await context(P, { javaScriptEnabled: false });

await check("P14 without javascript every control on /book is visible and the result is hidden", async () => {
  const p = await open(nojs, P, "/book");
  const ids = ["bk-from", "bk-from-address", "bk-to", "bk-to-address", "bk-date", "bk-time", "bk-hours", "bk-pax", "bk-class", "bk-vehicle", "bk-meet", "bk-flight", "bk-submit"];
  assert.deepEqual((await visible(p, ids.map((id) => `#${id}`))).map((v, i) => (v ? "" : ids[i])).filter(Boolean), []);
  assert.ok(await p.isVisible('label[for="bk-one"]'));
  assert.ok(await p.isVisible('label[for="bk-hour"]'));
  assert.deepEqual(await visible(p, ["#price", "#quote", "#q-switch", "#resume"]), [false, false, false, false]);
  assert.ok(await p.evaluate(() => document.getElementById("bk-hp").getBoundingClientRect().right <= 0), "the honeypot is on screen");
  await p.close();
});

await check("P14 without javascript a priced one way submit reaches the mock confirmation", async () => {
  const p = await open(nojs, P, "/book");
  await fillPriced(p);
  await Promise.all([p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
  assert.equal((await p.textContent("#cf-h")).trim(), "Payment received");
  assert.equal(await p.textContent("#cf-ref"), "on your receipt from Stripe");
  assert.ok(await p.isVisible("#cf-ok"));
  assert.equal(await p.isVisible("#cf-receipt"), false);
  await p.close();
});

await check("P14 without javascript a priced hourly submit reaches the mock confirmation", async () => {
  const p = await open(nojs, P, "/book");
  await p.check("#bk-hour");
  await p.selectOption("#bk-from", "brooklyn");
  await p.fill("#bk-from-address", "1 Main Street");
  await p.fill("#bk-date", DATE);
  await p.fill("#bk-time", "12:00");
  await p.selectOption("#bk-vehicle", "suv-escalade");
  await p.selectOption("#bk-hours", "4");
  await Promise.all([p.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), p.click("#bk-submit")]);
  await p.close();
});

await check("P14 without javascript a Sprinter hourly submit lands on its request block", async () => {
  const p = await open(nojs, P, "/book");
  await p.check("#bk-hour");
  await p.selectOption("#bk-from", "manhattan");
  await p.fill("#bk-from-address", "350 Fifth Avenue");
  await p.fill("#bk-date", DATE);
  await p.fill("#bk-time", "12:00");
  await p.selectOption("#bk-vehicle", "sprinter");
  await Promise.all([p.waitForURL(/\/book#q-sprinter-hourly$/), p.click("#bk-submit")]);
  assert.ok(await p.isVisible("#q-sprinter-hourly"));
  assert.ok(await p.isVisible("#quote"));
  assert.ok(await p.isVisible("#q-wa"));
  assert.equal(await p.isVisible("#q-paused"), false);
  await p.close();
});

await check("P14 without javascript a submit with no pickup lands on its message", async () => {
  const p = await open(nojs, P, "/book");
  await p.evaluate(() => document.querySelectorAll("[required]").forEach((c) => c.removeAttribute("required")));
  await Promise.all([p.waitForURL(/\/book#e-from$/), p.click("#bk-submit")]);
  assert.ok(await p.isVisible("#e-from"));
  assert.equal(await p.isVisible("#quote"), false);
  await p.close();
});

await check("P14 without javascript /book#resume shows the note", async () => {
  const p = await open(nojs, P, "/book#resume");
  assert.ok(await p.isVisible("#resume"));
  await p.close();
});

await check("P14 without javascript the hero form still reaches /book", async () => {
  const p = await open(nojs, P, "/locations/jfk-airport");
  await Promise.all([p.waitForURL((u) => u.pathname === "/book"), p.click(".trip__book")]);
  assert.equal(new URL(p.url()).searchParams.get("pickup"), "JFK Airport");
  await p.close();
});

await nojs.close();

const qctx = await context(Q);

await check("Q17 with payments off a complete trip shows the paused request and the panel never shows", async () => {
  const p = await open(qctx, Q, "/book");
  await fillPriced(p);
  await p.waitForSelector("#q-paused", { state: "visible" });
  assert.equal((await p.textContent("#q-paused h2")).trim(), HEADINGS.phone);
  assert.equal(HEADINGS.phone, "Book this trip by phone or WhatsApp");
  const wa = await waText(p);
  assert.match(wa, /Reference: NLR-[0-9A-HJKMNP-TV-Z]{6}/);
  assert.ok(wa.includes("Drop-off: JFK"));
  await p.focus("#bk-submit");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(600);
  assert.ok(await p.isVisible("#q-paused"));
  assert.equal(await p.evaluate(() => document.activeElement.id), "q-wa", "Continue left focus on the page body");
  assert.equal(await p.isEnabled("#bk-submit"), true);
  assert.equal(new URL(p.url()).pathname, "/book");
  assert.equal(await p.evaluate(() => window.__priceShown), false);
  assert.equal(await p.isVisible("#price"), false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

await check("Q18 an unknown session shows the not found copy", async () => {
  const p = await open(qctx, Q, "/booking-confirmed?session_id=cs_mock_ZZZZZZ");
  await p.waitForSelector("#cf-missing", { state: "visible" });
  assert.equal((await p.textContent("#cf-h")).trim(), "This payment was not found");
  assert.equal(await p.title(), "This payment was not found | NYC LUX RIDE");
  assert.equal(await p.isVisible("#cf-ok"), false);
  assert.equal(await p.isVisible("#cf-receipt"), false);
  assert.equal(new URL(p.url()).search, "");
  assert.deepEqual(await p.evaluate(() => window.__purchases), []);
  await p.close();
});

await check("Q18 a confirmation visit with no session makes no request", async () => {
  const p = await open(qctx, Q, "/booking-confirmed");
  const before = qctx.api.length;
  await p.waitForTimeout(500);
  assert.equal(qctx.api.length, before);
  assert.equal((await p.textContent("#cf-h")).trim(), "Payment received");
  await p.close();
});

await qctx.close();
await browser.close();

if (failures) {
  console.error(`\n${failures} book browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll book browser tests passed");
process.exit(0);
