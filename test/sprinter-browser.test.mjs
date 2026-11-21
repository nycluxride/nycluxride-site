import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const { VEHICLES, AIRPORT_TOTALS, NYC_TAX_PERCENT, BCF_PERCENT, percentCents } = await import(pathToFileURL(join(ROOT, "api", "_rates.mjs")).href);
const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "MAP_MOCK", "GOOGLE_MAPS_JS", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET"];
const SPRINTERS = Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === "sprinter");
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 3 * 864e5));
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const parts = (key, hours, event = false) => {
  const fare = (event && VEHICLES[key].event ? VEHICLES[key].event : VEHICLES[key].hourly) * hours;
  return { fare, fees: percentCents(fare, NYC_TAX_PERCENT) + percentCents(fare, BCF_PERCENT) };
};
const total = (key, hours, event) => {
  const { fare, fees } = parts(key, hours, event);
  return fare + fees;
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

const G = await serve({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" });
process.on("exit", () => G.child.kill());

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

async function open(path, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(G.base), (route) => route.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to (load resource|preconnect)/.test(m.text()) && page.errors.push(m.text()));
  page.on("response", (r) => r.url().startsWith(G.base) && !r.url().includes("/api/") && r.status() >= 400 && page.errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${G.base}${path}`, { waitUntil: "load" });
  return page;
}

const cards = (page) => page.$$eval(".bk-card__price", (o) => o.map((x) => (x.querySelector(".bk-fig") || x).textContent));
const panel = (page) => page.evaluate(() => ({ lines: [...document.querySelectorAll("#price-lines tr:not(.bk-hint)")].map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]), total: (document.getElementById("price-total").firstChild || {}).textContent }));
const shown = (page) => page.evaluate(() => ["bk-vehicle-f", "bk-sprinter-f", "bk-event-f"].map((id) => document.getElementById(id).checkVisibility()));
const choice = (page) => page.$eval("#bk-choice", (c) => [c.firstChild.textContent, c.querySelector("small").textContent]);
const options = (page) => page.$$eval("#bk-sprinter option", (o) => o.map((x) => [x.value, x.textContent, x.hidden, x.disabled]));
const hourOptions = (page) => page.$$eval("#bk-hours option", (o) => o.filter((x) => !x.hidden && !x.disabled).map((x) => x.value));
const waText = async (page) => decodeURIComponent((await page.getAttribute(".site-footer a[data-wa]", "href")).split("?text=")[1] || "");
const totalIs = (page, cents) => page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t && !document.getElementById("price-total").getAttribute("aria-busy") && !document.getElementById("bk-wait").textContent.startsWith("Finding"), cash(cents));
async function pax(page, n) {
  for (let i = 0; i < 16; i++) {
    const v = +(await page.inputValue("#bk-pax"));
    if (v === n) return;
    await page.click(v < n ? '#bk-pax-f [aria-label="More passengers"]' : '#bk-pax-f [aria-label="Fewer passengers"]');
  }
  throw new Error(`the stepper did not reach ${n}`);
}
async function view(page) {
  await page.click("#bk-view");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && !document.getElementById("bk-wait").textContent.startsWith("Finding") && !document.querySelector(".bk-card__price .bk-sk") && /\d/.test(document.getElementById("bk-p-suv").textContent));
}
const HOURLY_URL = `/book?trip-type=hour&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&hours=3&date=${DATE}&time=12:40`;
const ONE_URL = `/book?pickup=JFK&dropoff=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&date=${DATE}&time=12:40`;

const page = await open(HOURLY_URL);

await check("S1 by the hour the hours start at 3 for the other cars, the Sprinter card asks for 4 hours, and picking it moves to 4 hours with the Shuttle Sprinter price, its picker and no occasion", async () => {
  await view(page);
  assert.deepEqual(await hourOptions(page), ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  assert.equal((await cards(page)).at(-1), "4 hours minimum");
  assert.deepEqual(await shown(page), [true, false, false]);
  await page.click('label[for="bk-c-sprinter"]');
  assert.equal(await page.textContent("#bk-wait"), "Changed to 4 hours, the Sprinter minimum.");
  await totalIs(page, total("sprinter-shuttle", 4));
  assert.equal(await page.inputValue("#bk-hours"), "4");
  assert.match(await page.textContent("#bk-sum"), /By the hour, 4 hours from 277 Bedford Ave/);
  assert.deepEqual(await hourOptions(page), ["4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  assert.deepEqual(await shown(page), [false, true, false]);
  const { fare, fees } = parts("sprinter-shuttle", 4);
  assert.deepEqual(await panel(page), { lines: [["Fare, 4 hours", cash(fare)], ["Taxes and fees", cash(fees)]], total: cash(fare + fees) });
  assert.deepEqual(await options(page), SPRINTERS.map((key) => [key, `${cash(total(key, 4))}, ${VEHICLES[key].name}`, false, false]));
  assert.deepEqual(await choice(page), ["Luxury Sprinter", "Shuttle Sprinter"]);
  assert.equal(await page.isVisible("#q-error"), false);
  assert.deepEqual(page.errors, []);
});

await check("S2 picking each Sprinter by the hour shows its price in the price box, the card and the choice, and the occasion appears only for the Executive and the Limo Sprinter", async () => {
  for (const key of SPRINTERS) {
    await page.selectOption("#bk-sprinter", key);
    await totalIs(page, total(key, 4));
    assert.equal((await cards(page)).at(-1), cash(total(key, 4)), key);
    assert.deepEqual(await choice(page), ["Luxury Sprinter", VEHICLES[key].name], key);
    assert.deepEqual(await shown(page), [false, true, Number.isInteger(VEHICLES[key].event)], key);
    assert.match(await waText(page), new RegExp(`Trip: By the hour, 4 hours[\\s\\S]*\\nVehicle: ${VEHICLES[key].name}\\n`), key);
  }
});

await check("S3 a wedding, prom or event in the Executive and the Limo Sprinter charges the event rate in the price box and the picker, names the occasion in the choice and the message, and No brings the hourly rate back", async () => {
  for (const key of ["sprinter-executive", "sprinter-limo"]) {
    await page.selectOption("#bk-sprinter", key);
    await totalIs(page, total(key, 4));
    assert.equal(await page.inputValue("#bk-event"), key === "sprinter-executive" ? "" : "0", "the question starts unanswered and keeps an answer across Sprinters");
    assert.deepEqual(await page.$$eval("#bk-event option", (o) => o.map((x) => x.textContent)), ["Choose one", "No", "Yes"]);
    assert.equal(await page.textContent('label[for="bk-event"]'), "Is this for a wedding, prom or event? (Executive or Limo Sprinter by the hour)");
    await page.selectOption("#bk-event", "1");
    await totalIs(page, total(key, 4, true));
    const { fare, fees } = parts(key, 4, true);
    assert.deepEqual(await panel(page), { lines: [["Fare, 4 hours", cash(fare)], ["Taxes and fees", cash(fees)]], total: cash(fare + fees) });
    assert.ok(total(key, 4, true) > total(key, 4), key);
    assert.deepEqual(await choice(page), ["Luxury Sprinter", `${VEHICLES[key].name} for a wedding, prom or event`]);
    assert.match(await waText(page), new RegExp(`\\nVehicle: ${VEHICLES[key].name} for a wedding, prom or event\\n`));
    assert.equal((await options(page)).find(([v]) => v === key)[1], `${cash(total(key, 4, true))}, ${VEHICLES[key].name}`);
    await page.selectOption("#bk-event", "0");
    await totalIs(page, total(key, 4));
  }
  await page.selectOption("#bk-event", "1");
  await page.selectOption("#bk-sprinter", "sprinter-jet");
  await totalIs(page, total("sprinter-jet", 4));
  assert.deepEqual(await shown(page), [false, true, false]);
  assert.deepEqual(await choice(page), ["Luxury Sprinter", "Jet Sprinter"]);
  await page.selectOption("#bk-sprinter", "sprinter-executive");
  await totalIs(page, total("sprinter-executive", 4, true));
  await page.selectOption("#bk-event", "0");
  await totalIs(page, total("sprinter-executive", 4));
});

await check("S4 the Limo Sprinter seats 10: with 11 or more passengers it is off in the picker and a chosen Limo moves to the Shuttle Sprinter with a status line, or to the Executive Sprinter at the event rate when it is for a wedding, prom or event, then comes back for 10", async () => {
  await page.selectOption("#bk-sprinter", "sprinter-limo");
  await totalIs(page, total("sprinter-limo", 4));
  await pax(page, 11);
  assert.equal(await page.inputValue("#bk-sprinter"), "sprinter-shuttle");
  assert.match(await page.textContent("#bk-wait"), /^Changed to Shuttle Sprinter for 11 passengers\./);
  await totalIs(page, total("sprinter-shuttle", 4));
  assert.deepEqual((await options(page)).at(-1), ["sprinter-limo", "Seats 10, Limo Sprinter", false, true]);
  await pax(page, 14);
  await totalIs(page, total("sprinter-shuttle", 4));
  assert.deepEqual(await cards(page), ["Seats 5", "Seats 5", "Seats 3", "Seats 3", cash(total("sprinter-shuttle", 4))]);
  await pax(page, 10);
  await totalIs(page, total("sprinter-shuttle", 4));
  assert.equal((await options(page)).at(-1)[3], false);
  await page.selectOption("#bk-sprinter", "sprinter-limo");
  await totalIs(page, total("sprinter-limo", 4));
  await pax(page, 1);
  await totalIs(page, total("sprinter-limo", 4));
  await page.selectOption("#bk-event", "1");
  await totalIs(page, total("sprinter-limo", 4, true));
  await pax(page, 11);
  assert.equal(await page.inputValue("#bk-sprinter"), "sprinter-executive");
  assert.match(await page.textContent("#bk-wait"), /^Changed to Executive Sprinter for 11 passengers\./);
  await totalIs(page, total("sprinter-executive", 4, true));
  assert.deepEqual([await page.inputValue("#bk-event"), ...(await shown(page)).slice(1)], ["1", true, true]);
  assert.deepEqual(await choice(page), ["Luxury Sprinter", "Executive Sprinter for a wedding, prom or event"]);
  await pax(page, 1);
  await page.selectOption("#bk-event", "0");
  await page.selectOption("#bk-sprinter", "sprinter-limo");
  await totalIs(page, total("sprinter-limo", 4));
  assert.deepEqual(page.errors, []);
});

await check("S5 back on step 1 the hours start at 4 while a Sprinter is chosen, 5 hours prices the Sprinter for 5 hours, and another car brings the 3 hours back", async () => {
  await page.click("#bk-edit");
  assert.deepEqual(await hourOptions(page), ["4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  await page.selectOption("#bk-hours", "5");
  await view(page);
  await totalIs(page, total("sprinter-limo", 5));
  assert.equal((await cards(page)).at(-1), cash(total("sprinter-limo", 5)));
  await page.click('label[for="bk-c-premium"]');
  await page.waitForFunction(() => !document.getElementById("price-total").getAttribute("aria-busy") && /Cadillac/.test(document.getElementById("bk-choice").textContent));
  assert.deepEqual(await hourOptions(page), ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  assert.deepEqual(await shown(page), [false, false, false]);
  assert.equal(await page.inputValue("#bk-hours"), "5");
  await page.click('label[for="bk-c-sprinter"]');
  await totalIs(page, total("sprinter-limo", 5));
});

await check("S6 an Executive Sprinter for an event pays online: Stripe Checkout in mock mode lands on the confirmation page with the Sprinter, the occasion and the event total", async () => {
  await page.selectOption("#bk-sprinter", "sprinter-executive");
  await page.selectOption("#bk-event", "1");
  await totalIs(page, total("sprinter-executive", 5, true));
  await page.click("#bk-next");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
  for (const [k, v] of Object.entries({ name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" })) await page.fill(`#bk-${k}`, v);
  assert.match(await page.textContent("#bk-check-rows"), /Executive Sprinter for a wedding, prom or event/);
  await Promise.all([page.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), page.click("#bk-submit")]);
  await page.waitForFunction(() => /By the hour/.test(document.getElementById("cf-summary").textContent) && /\d/.test(document.getElementById("cf-total").textContent), null, { timeout: 15000 });
  const body = await page.textContent("main");
  assert.match(body, /By the hour, Executive Sprinter for a wedding, prom or event, 5 hours/);
  assert.match(body, /Luxury Sprinter\s*Executive Sprinter for a wedding, prom or event/);
  assert.ok(body.includes(cash(total("sprinter-executive", 5, true))), body.slice(0, 400));
  assert.deepEqual(page.errors, []);
});

await check("S7 one way the Sprinter picker offers the Shuttle, Jet and Executive Sprinter at the Sprinter transfer price, never the Limo Sprinter, and asks no occasion, and a Limo chosen by the hour moves to the Shuttle with a status line when the trip turns one way", async () => {
  const p = await open(ONE_URL);
  await view(p);
  await p.click('label[for="bk-c-sprinter"]');
  await totalIs(p, AIRPORT_TOTALS.sprinter.jfk);
  assert.deepEqual(await shown(p), [false, true, false]);
  assert.deepEqual(await options(p), [
    ["sprinter-shuttle", `${cash(AIRPORT_TOTALS.sprinter.jfk)}, Shuttle Sprinter`, false, false],
    ["sprinter-jet", `${cash(AIRPORT_TOTALS.sprinter.jfk)}, Jet Sprinter`, false, false],
    ["sprinter-executive", `${cash(AIRPORT_TOTALS.sprinter.jfk)}, Executive Sprinter`, false, false],
    ["sprinter-limo", "Limo Sprinter", true, true],
  ]);
  for (const key of ["sprinter-jet", "sprinter-executive"]) {
    await p.selectOption("#bk-sprinter", key);
    await totalIs(p, AIRPORT_TOTALS.sprinter.jfk);
    assert.deepEqual(await choice(p), ["Luxury Sprinter", VEHICLES[key].name]);
    assert.match(await waText(p), new RegExp(`\\nVehicle: ${VEHICLES[key].name}\\n`));
  }
  assert.equal(await p.inputValue("#bk-hours"), "3", "a one way trip leaves the hours alone");
  await p.click("#bk-edit");
  await p.click('label[for="bk-hour"]');
  await p.fill("#bk-from", "277 Bedford Ave, Brooklyn, NY 11211");
  await p.keyboard.press("Escape");
  await view(p);
  assert.equal(await p.inputValue("#bk-hours"), "4");
  await p.selectOption("#bk-sprinter", "sprinter-limo");
  await totalIs(p, total("sprinter-limo", 4));
  await p.click("#bk-edit");
  await p.click('label[for="bk-one"]');
  assert.equal(await p.inputValue("#bk-sprinter"), "sprinter-shuttle", "the Limo Sprinter falls back to the Shuttle on a one way trip");
  await p.waitForFunction(() => document.getElementById("bk-wait").textContent.startsWith("Changed to Shuttle Sprinter. The Limo Sprinter is booked by the hour only."));
  assert.deepEqual((await options(p)).at(-1).slice(2), [true, true]);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S10 a Sprinter Book link opens that Sprinter: the Limo by the hour with a pickup lands on the Limo at its 4-hour total, the Jet one way at the transfer price, and a Limo link for a one way trip falls back to the Shuttle", async () => {
  const limo = await open(`/book?trip-type=hour&hours=4&class=sprinter&sprinter=sprinter-limo&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&date=${DATE}&time=12:40`);
  assert.equal(await limo.inputValue("#bk-sprinter"), "sprinter-limo");
  assert.equal(await limo.evaluate(() => location.search), "");
  await view(limo);
  assert.equal(await limo.evaluate(() => document.querySelector("[name=class]:checked").value), "sprinter");
  await totalIs(limo, total("sprinter-limo", 4));
  assert.deepEqual([await limo.inputValue("#bk-sprinter"), await limo.inputValue("#bk-hours")], ["sprinter-limo", "4"]);
  assert.deepEqual(await choice(limo), ["Luxury Sprinter", "Limo Sprinter"]);
  assert.deepEqual(await shown(limo), [false, true, true]);
  assert.deepEqual(limo.errors, []);
  await limo.context().close();
  const jet = await open(`${ONE_URL}&class=sprinter&sprinter=sprinter-jet`);
  await view(jet);
  await totalIs(jet, AIRPORT_TOTALS.sprinter.jfk);
  assert.deepEqual([await jet.inputValue("#bk-sprinter"), ...(await choice(jet))], ["sprinter-jet", "Luxury Sprinter", "Jet Sprinter"]);
  assert.deepEqual(jet.errors, []);
  await jet.context().close();
  const one = await open(`${ONE_URL}&class=sprinter&sprinter=sprinter-limo`);
  await view(one);
  await totalIs(one, AIRPORT_TOTALS.sprinter.jfk);
  assert.equal(await one.inputValue("#bk-sprinter"), "sprinter-shuttle");
  assert.deepEqual(one.errors, []);
  await one.context().close();
});

const EXEC_URL = (key) => `/book?trip-type=hour&hours=4&class=sprinter&sprinter=${key}&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&date=${DATE}&time=12:40`;
const stepIs = (p, step) => p.waitForFunction((s) => document.getElementById("book-form").dataset.step === s, step);

await check("S12 the wedding, prom or event question starts with no answer: the price box shows the hourly rate, Next keeps the rider on step 2 with the question marked, its message and focus, and No or Yes clears it and goes on", async () => {
  for (const [key, answer] of [["sprinter-executive", "0"], ["sprinter-limo", "1"]]) {
    const p = await open(EXEC_URL(key));
    await view(p);
    await totalIs(p, total(key, 4));
    assert.deepEqual([await p.inputValue("#bk-event"), await p.$$eval("#bk-event option", (o) => o.map((x) => [x.value, x.textContent, x.disabled]))], ["", [["", "Choose one", true], ["0", "No", false], ["1", "Yes", false]]], key);
    assert.deepEqual(await shown(p), [false, true, true], key);
    assert.equal(await p.isVisible("#e-event"), false, key);
    await p.click("#bk-next");
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === "bk-event");
    assert.equal(await p.evaluate(() => document.getElementById("book-form").dataset.step), "options", key);
    assert.deepEqual([await p.isVisible("#e-event"), await p.textContent("#e-event"), await p.getAttribute("#bk-event", "aria-invalid"), (await p.getAttribute("#bk-event", "aria-describedby")).split(" ").includes("e-event")], [true, "Choose Yes or No.", "true", true], key);
    await totalIs(p, total(key, 4));
    await p.selectOption("#bk-event", answer);
    await totalIs(p, total(key, 4, answer === "1"));
    assert.deepEqual([await p.isVisible("#e-event"), await p.getAttribute("#bk-event", "aria-invalid")], [false, null], key);
    await p.click("#bk-next");
    await stepIs(p, "details");
    const rows = await p.textContent("#bk-check-rows");
    assert.ok(rows.includes(answer === "1" ? `${VEHICLES[key].name} for a wedding, prom or event` : VEHICLES[key].name) && (answer === "1" || !/wedding/.test(rows)), rows);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

await check("S13 the Shuttle and the Jet Sprinter never ask the question and go on to Check your trip, and a saved trip keeps the answer: a reload on Check your trip keeps Yes and the event total, and a saved Limo trip with no answer opens on step 2", async () => {
  for (const key of ["sprinter-shuttle", "sprinter-jet"]) {
    const p = await open(EXEC_URL(key));
    await view(p);
    await totalIs(p, total(key, 4));
    assert.deepEqual(await shown(p), [false, true, false], key);
    await p.click("#bk-next");
    await stepIs(p, "details");
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
  const p = await open(EXEC_URL("sprinter-limo"));
  await view(p);
  await p.selectOption("#bk-event", "1");
  await totalIs(p, total("sprinter-limo", 4, true));
  await p.click("#bk-next");
  await stepIs(p, "details");
  await p.reload({ waitUntil: "load" });
  await stepIs(p, "details");
  await totalIs(p, total("sprinter-limo", 4, true));
  assert.deepEqual([await p.inputValue("#bk-sprinter"), await p.inputValue("#bk-event")], ["sprinter-limo", "1"]);
  await p.evaluate(() => (document.getElementById("bk-event").selectedIndex = 0));
  await p.reload({ waitUntil: "load" });
  await stepIs(p, "options");
  await totalIs(p, total("sprinter-limo", 4));
  assert.deepEqual([await p.inputValue("#bk-sprinter"), await p.inputValue("#bk-event")], ["sprinter-limo", ""]);
  await p.click("#bk-next");
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "bk-event");
  assert.equal(await p.isVisible("#e-event"), true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S11 at 320 on a 2x phone the fleet photo row keeps two columns, so each photo gets a file at least twice its width", async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(G.base), (route) => route.fulfill({ status: 204, body: "" }));
  const p = await ctx.newPage();
  await p.goto(`${G.base}/fleet`, { waitUntil: "load" });
  for (const img of await p.$$(".fleet-photos img")) await img.scrollIntoViewIfNeeded();
  await p.waitForFunction(() => [...document.querySelectorAll(".fleet-photos img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  const boxes = await p.$$eval(".fleet-photos img", (imgs) => imgs.map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.top + scrollY), r.width, +new URL(i.currentSrc).pathname.match(/-(\d+)\.(avif|webp)$/)[1]]; }));
  assert.equal(new Set(boxes.map(([top]) => top)).size, 3, JSON.stringify(boxes));
  assert.ok(boxes.every(([, w, file]) => w < 150 && file >= 2 * w), JSON.stringify(boxes));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();
});

for (const width of [390, 1440]) {
  await check(`S8 at ${width} the rates page shows the four Sprinters with their seats, hourly and event rates, the 4-hour minimum and the Limo by the hour only, and Who is traveling? marks the Limo too small for 11 to 14`, async () => {
    const p = await open("/rates", { width, height: 900 });
    await p.locator("#luxury-sprinter").scrollIntoViewIfNeeded();
    assert.ok(await p.isVisible("#luxury-sprinter"));
    const rows = await p.$$eval("#luxury-sprinter tbody tr", (r) => r.map((tr) => [tr.querySelector("th").firstChild.textContent, ...[...tr.querySelectorAll("td")].map((td) => td.firstChild.textContent.trim())]));
    assert.deepEqual(rows, SPRINTERS.map((key) => [VEHICLES[key].name, String(VEHICLES[key].seats), `$${VEHICLES[key].hourly / 100}`, `$${(VEHICLES[key].event || VEHICLES[key].hourly) / 100}`]));
    assert.match(await p.textContent("#sprinter-caption"), /4-hour minimum\. The Limo Sprinter is booked by the hour only\./);
    await p.click('.fits label:has(input[value="14"])');
    assert.deepEqual(await p.$$eval("#luxury-sprinter tbody tr", (r) => r.map((tr) => [tr.querySelector(".fits-yes").checkVisibility(), tr.querySelector(".fits-no").checkVisibility()])), [[true, false], [true, false], [true, false], [false, true]]);
    assert.deepEqual(await p.$eval("#airport-sprinter", (tr) => [tr.querySelector(".fits-yes").checkVisibility(), tr.querySelector("small").textContent]), [true, "Shuttle, Jet and Executive Sprinter"]);
    await p.click('.fits label:has(input[value="10"])');
    assert.deepEqual(await p.$$eval("#luxury-sprinter tbody tr", (r) => r.map((tr) => tr.querySelector(".fits-yes").checkVisibility())), [true, true, true, true]);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  await check(`S9 at ${width} the fleet page shows the four Sprinters with their seats and photos, says the Limo Sprinter is booked by the hour only, the gallery of the owner's photos loads lazily below the fold, and none of them is in the first screen`, async () => {
    const p = await open("/fleet", { width, height: 900 });
    const before = await p.$$eval("#luxury-sprinter img", (imgs) => imgs.map((i) => [i.getAttribute("loading"), i.getBoundingClientRect().top > innerHeight]));
    assert.ok(before.length === 10 && before.every(([loading, below]) => loading === "lazy" && below), JSON.stringify(before));
    const lcp = await p.evaluate(() => new Promise((ok) => new PerformanceObserver((l) => ok(l.getEntries().at(-1).url || "")).observe({ type: "largest-contentful-paint", buffered: true })));
    assert.match(lcp, /page-fleet/);
    await p.locator("#luxury-sprinter").scrollIntoViewIfNeeded();
    const cardsIn = await p.$$eval("#luxury-sprinter .fleet-card", (c) => c.map((x) => [x.querySelector("h3").textContent, x.dataset.seats, x.querySelector(".fleet-card__specs li").textContent]));
    assert.deepEqual(cardsIn, SPRINTERS.map((key) => [VEHICLES[key].name, String(VEHICLES[key].seats), `Up to ${VEHICLES[key].seats} passengers`]));
    const byHour = p.locator("#luxury-sprinter .prose p", { hasText: "The Limo Sprinter is booked by the hour only." });
    assert.deepEqual([await byHour.count(), await byHour.isVisible()], [1, true]);
    for (const img of await p.$$("#luxury-sprinter img")) await img.scrollIntoViewIfNeeded();
    await p.waitForFunction(() => [...document.querySelectorAll("#luxury-sprinter img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    const srcs = await p.$$eval("#luxury-sprinter img", (imgs) => imgs.map((i) => new URL(i.currentSrc).pathname.replace(/-\d+\.(avif|webp)$/, "")));
    assert.deepEqual(srcs, ["/fleet/sprinter-shuttle-seats", "/fleet/sprinter-jet", "/fleet/sprinter-executive-lounge", "/fleet/sprinter-limo-lounge", "/fleet/sprinter-shuttle-side", "/fleet/sprinter-shuttle-luggage", "/fleet/sprinter-executive-night", "/fleet/sprinter-executive-cabin", "/fleet/sprinter-limo-white", "/fleet/sprinter-limo-castle"]);
    assert.deepEqual(await p.$$eval(".fleet-photos figcaption", (f) => f.map((x) => x.textContent)), ["Shuttle Sprinter", "Shuttle Sprinter", "Executive Sprinter", "Executive Sprinter", "Limo Sprinter", "Limo Sprinter"]);
    assert.ok(await p.$$eval("#luxury-sprinter img", (imgs) => imgs.every((i) => i.alt.length > 20 && Math.abs(i.getBoundingClientRect().width / i.getBoundingClientRect().height - 1.5) < 0.02)), "every photo has alt text and shows at 3:2");
    await p.click('.fits label:has(input[value="14"])');
    assert.deepEqual(await p.$$eval("#luxury-sprinter .fleet-card", (c) => c.map((x) => x.querySelector(".fits-no").checkVisibility())), [false, false, false, true]);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

await page.context().close();
await browser.close();
if (failures) {
  console.error(`\n${failures} sprinter browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll sprinter browser tests passed");
process.exit(0);
