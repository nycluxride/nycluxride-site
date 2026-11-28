import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const { VEHICLES, AIRPORT_TOTALS, FEE_PERCENT, percentCents, SPRINTER_NOTICE_HOURS } = await import(pathToFileURL(join(ROOT, "api", "_rates.mjs")).href);
const { HEADINGS, REASONS, SPRINTER_BUSY } = await import(pathToFileURL(join(ROOT, "api", "_copy.mjs")).href);
const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "MAP_MOCK", "GOOGLE_MAPS_JS", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET"];
const SPRINTERS = Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === "sprinter");
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 3 * 864e5));
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const parts = (key, hours) => {
  const fare = VEHICLES[key].hourly * hours;
  return { fare, fees: percentCents(fare, FEE_PERCENT) };
};
const total = (key, hours) => {
  const { fare, fees } = parts(key, hours);
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
const shown = (page) => page.evaluate(() => ["bk-vehicle-f", "bk-sprinter-f"].map((id) => document.getElementById(id).checkVisibility()));
const choice = (page) => page.$eval("#bk-choice", (c) => [c.firstChild.textContent, c.querySelector("small").textContent]);
const vans = async (page) => (await cards(page)).slice(5);
const names = (page) => page.$$eval(".bk-card__name", (n) => n.map((x) => x.textContent));
const scopes = (page) => page.$$eval("[name=class][data-v]", (r) => r.map((x) => (x.parentElement.querySelector(".bk-scope") || {}).textContent || ""));
const picked = (page) => page.$eval("[name=class]:checked", (r) => [r.value, r.dataset.v || ""]);
const hourOptions = (page) => page.$$eval("#bk-hours option", (o) => o.filter((x) => !x.hidden && !x.disabled).map((x) => x.value));
const waText = async (page, sel = ".site-footer a[data-wa]") => decodeURIComponent((await page.getAttribute(sel, "href")).split("?text=")[1] || "");
const totalIs = (page, cents) => page.waitForFunction((t) => (document.getElementById("price-total").firstChild || {}).textContent === t && !document.getElementById("price-total").getAttribute("aria-busy") && !document.getElementById("bk-wait").textContent.startsWith("Finding"), cash(cents));
async function pax(page, n) {
  for (let i = 0; i < 16; i++) {
    const v = +(await page.inputValue("#bk-pax"));
    if (v === n) return;
    await page.click(v < n ? '#bk-pax-f [aria-label="More passengers"]' : '#bk-pax-f [aria-label="Fewer passengers"]');
  }
  throw new Error(`the stepper did not reach ${n}`);
}
async function ride(page) {
  const [tip, meet] = await page.evaluate(() => [!document.getElementById("bk-tip").disabled && !document.getElementById("bk-t-0").checked, document.getElementById("bk-meet-f").checkVisibility() && !document.getElementById("bk-meet-f").disabled && document.getElementById("bk-meet").checked]);
  if (tip) await page.click('label[for="bk-t-0"]');
  if (meet) await page.check("#bk-meet-no");
  if (tip || meet) await page.waitForFunction(() => !document.getElementById("price-total").getAttribute("aria-busy") && !document.getElementById("bk-wait").textContent.startsWith("Finding"));
}
async function priceShown(page) {
  await page.waitForFunction(() => !document.getElementById("price").hidden && !document.getElementById("bk-tip").disabled && !document.getElementById("price-total").getAttribute("aria-busy"));
  await ride(page);
}
async function view(page) {
  await page.click("#bk-view");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && !document.getElementById("bk-wait").textContent.startsWith("Finding") && !document.querySelector(".bk-card__price .bk-sk") && /\d/.test(document.getElementById("bk-p-suv").textContent));
  await ride(page);
}
const quoted = (p, id = "q-sprinter-quote") => p.waitForFunction((i) => document.getElementById(i).classList.contains("is-on") && !document.getElementById("bk-wait").textContent.startsWith("Finding") && !document.querySelector(".bk-card__price .bk-sk"), id);
const ASK = "Price on request";
const named = (p, key) => p.waitForFunction((n) => decodeURIComponent(document.getElementById("q-wa").getAttribute("href")).includes(`Vehicle: ${n}`), VEHICLES[key].name);
async function request(p, bar = "Request a quote") {
  assert.deepEqual([await p.isVisible("#price"), await p.isVisible("#bk-next"), await p.isVisible("#q-mail"), await p.isVisible("#q-wa"), await p.textContent("#bk-bar-q")], [false, false, true, true, bar]);
  assert.doesNotMatch(await waText(p, "#q-wa"), /Total shown/);
}
const HOURLY_URL = `/book?trip-type=hour&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&hours=3&date=${DATE}&time=12:40`;
const ONE_URL = `/book?pickup=JFK&dropoff=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&date=${DATE}&time=12:40`;

const page = await open(HOURLY_URL);

await check("S1 by the hour the hours start at 3 for the other cars, each Sprinter has its own card after the five classes and asks for 4 hours, the picker under the cards is gone, and picking a Sprinter card moves to 4 hours with no price and the Request a quote block, since Sprinters by the hour are by quote", async () => {
  await view(page);
  assert.deepEqual(await hourOptions(page), ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  assert.deepEqual(await names(page), ["Business SUV", "Business Premium SUV", "First Class", "Executive Sedan", "Electric Class", ...SPRINTERS.map((key) => VEHICLES[key].name)]);
  assert.deepEqual(await vans(page), SPRINTERS.map(() => "4 hours minimum"));
  assert.deepEqual(await shown(page), [true, false]);
  assert.deepEqual([await page.$("#bk-c-sprinter"), await page.$$eval("[name=class]", (r) => r.filter((x) => x.value === "sprinter").map((x) => x.dataset.v))], [null, SPRINTERS]);
  await page.click('label[for="bk-c-sprinter-executive"]');
  assert.equal(await page.textContent("#bk-wait"), "Changed to 4 hours, the Sprinter minimum.");
  await quoted(page);
  assert.equal(await page.inputValue("#bk-hours"), "4");
  assert.match(await page.textContent("#bk-sum"), /By the hour, 4 hours from 277 Bedford Ave/);
  assert.deepEqual(await hourOptions(page), ["4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  assert.deepEqual(await shown(page), [false, false]);
  await request(page);
  assert.deepEqual([(await page.textContent("#q-sprinter-quote h3")).trim(), (await page.textContent("#q-sprinter-quote p")).trim()], [HEADINGS.quote, REASONS["sprinter-quote"].text]);
  assert.deepEqual(await vans(page), SPRINTERS.map(() => ASK));
  assert.deepEqual(await scopes(page), SPRINTERS.map(() => ""));
  assert.deepEqual([await picked(page), await page.inputValue("#bk-sprinter")], [["sprinter", "sprinter-executive"], "sprinter-executive"]);
  assert.deepEqual(await choice(page), ["Executive Sprinter", "Luxury Sprinter"]);
  assert.equal(await page.$('[name="event"], #bk-event-f, #e-event'), null);
  assert.equal(await page.isVisible("#q-error"), false);
  assert.deepEqual(page.errors, []);
});

await check("S2 picking each Sprinter card by the hour checks that card only, shows Price on request on the card and the Request a quote block, keeps the Luxury Sprinter pill on, and the message names it with no occasion and no price", async () => {
  for (const key of SPRINTERS) {
    await page.click(`label[for="bk-c-${key}"]`);
    await page.waitForFunction((k) => document.querySelector("[name=class]:checked").dataset.v === k, key);
    await quoted(page);
    await named(page, key);
    assert.equal(await page.textContent(`#bk-p-${key} .bk-fig`), ASK, key);
    assert.deepEqual([await picked(page), await page.inputValue("#bk-sprinter"), await page.$$eval("[name=class]:checked", (r) => r.length)], [["sprinter", key], key, 1], key);
    assert.deepEqual(await choice(page), [VEHICLES[key].name, "Luxury Sprinter"], key);
    assert.deepEqual([await page.textContent("#bk-bar-name"), await page.$eval('.bk-pill[data-c="sprinter"]', (b) => b.classList.contains("is-on"))], [VEHICLES[key].name, true], key);
    assert.deepEqual(await shown(page), [false, false], key);
    await request(page);
    const message = await waText(page);
    assert.match(message, new RegExp(`Trip: By the hour, 4 hours[\\s\\S]*\\nVehicle: ${VEHICLES[key].name}(\\n|$)`), key);
    assert.doesNotMatch(message, /wedding|Occasion|Total shown/, key);
  }
});

await check("S3 the Sprinter cards work from the keyboard and read well to a screen reader: the arrow keys move through the classes and the Sprinters in order and each step asks for the new choice, each Sprinter radio is named by its Sprinter and Price on request and described by Luxury Sprinter, its seats and its bags, and the hidden picker is not in the tab order", async () => {
  await page.focus("#bk-c-sprinter-white-limo");
  await page.keyboard.press("ArrowUp");
  assert.deepEqual([await page.evaluate(() => document.activeElement.id), await picked(page)], ["bk-c-sprinter-limo", ["sprinter", "sprinter-limo"]]);
  await quoted(page);
  for (const key of ["sprinter-presidential", "sprinter-luxury-jet", "sprinter-executive"]) {
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(() => document.activeElement.id), `bk-c-${key}`);
    await quoted(page);
  }
  await page.keyboard.press("ArrowUp");
  assert.deepEqual([await page.evaluate(() => document.activeElement.id), await picked(page)], ["bk-c-electric", ["electric", ""]]);
  await page.keyboard.press("ArrowUp");
  assert.deepEqual([await page.evaluate(() => document.activeElement.id), await picked(page)], ["bk-c-sedan", ["sedan", ""]]);
  await page.keyboard.press("ArrowDown");
  assert.deepEqual([await page.evaluate(() => document.activeElement.id), await picked(page)], ["bk-c-electric", ["electric", ""]]);
  await page.keyboard.press("ArrowDown");
  assert.deepEqual([await page.evaluate(() => document.activeElement.id), await picked(page)], ["bk-c-sprinter-executive", ["sprinter", "sprinter-executive"]]);
  await quoted(page);
  for (const key of SPRINTERS) {
    const radio = page.getByRole("radio", { name: new RegExp(`^${VEHICLES[key].name} ${ASK}$`) });
    assert.equal(await radio.count(), 1, key);
    const described = await page.$eval(`#bk-c-${key}`, (r) => r.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim()).join(" | "));
    assert.equal(described, `Luxury Sprinter | ${VEHICLES[key].seats}Up to ${VEHICLES[key].seats} passengers | 10 large, 2 small10 large and 2 small bags`, key);
  }
  assert.equal(await page.$eval("#bk-sprinter", (s) => s.checkVisibility() || s.tabIndex >= 0 && s.offsetParent !== null), false);
  await page.focus("#bk-c-sprinter-executive");
  await page.keyboard.press("Tab");
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "bk-sprinter");
  assert.deepEqual(page.errors, []);
});

await check("S4 passengers follow each Sprinter card: above 8 the Luxury Jet, above 10 the White Luxury Limo and above 12 the Presidential read Seats N and dim like a class card, a chosen one moves to the Executive Sprinter with a status line, a too small card picked anyway asks to show cars for the group, and each comes back when the group fits", async () => {
  for (const [key, seats] of [["sprinter-luxury-jet", 8], ["sprinter-white-limo", 10], ["sprinter-presidential", 12]]) {
    await pax(page, 1);
    await page.click(`label[for="bk-c-${key}"]`);
    await quoted(page);
    await pax(page, seats);
    await quoted(page);
    assert.deepEqual(await picked(page), ["sprinter", key]);
    await pax(page, seats + 1);
    assert.deepEqual([await picked(page), await page.inputValue("#bk-sprinter")], [["sprinter", "sprinter-executive"], "sprinter-executive"], key);
    assert.match(await page.textContent("#bk-wait"), new RegExp(`^Changed to Executive Sprinter for ${seats + 1} passengers\\.`), key);
    await quoted(page);
    assert.deepEqual(await vans(page), SPRINTERS.map((k) => (VEHICLES[k].seats < seats + 1 ? `Seats ${VEHICLES[k].seats}` : ASK)), key);
    assert.deepEqual(await page.$$eval(".bk-card", (l) => l.slice(5).map((x) => x.classList.contains("is-small"))), SPRINTERS.map((k) => VEHICLES[k].seats < seats + 1), key);
    assert.equal(await page.getAttribute(`#bk-c-${key}`, "aria-describedby"), `bk-fit bk-m-${key} bk-s-${key} bk-b-${key}`, key);
  }
  await pax(page, 14);
  await quoted(page);
  assert.deepEqual(await cards(page), ["Seats 6", "Seats 6", "Seats 3", "Seats 3", "Seats 3", ASK, "Seats 8", "Seats 12", ASK, "Seats 10"]);
  await page.click('label[for="bk-c-sprinter-white-limo"]');
  await page.waitForFunction(() => document.getElementById("bk-bar-q").textContent === "Too small for 14 passengers");
  assert.deepEqual([await page.isVisible("#price"), await page.textContent("#q-fix")], [false, "Show cars for 14"]);
  await page.click("#q-fix");
  await page.waitForFunction(() => document.querySelector("[name=class]:checked").dataset.v === "sprinter-executive");
  await quoted(page);
  assert.deepEqual(await picked(page), ["sprinter", "sprinter-executive"]);
  await page.click('label[for="bk-c-sprinter-limo"]');
  await quoted(page);
  await pax(page, 1);
  await quoted(page);
  assert.deepEqual([await vans(page), await page.$$eval(".bk-card.is-small", (l) => l.length)], [SPRINTERS.map(() => ASK), 0]);
  assert.deepEqual(await picked(page), ["sprinter", "sprinter-limo"]);
  assert.deepEqual(page.errors, []);
});

await check("S5 back on step 1 the hours start at 4 while a Sprinter is chosen, 5 hours keeps every Sprinter card on Price on request, another car brings the 3 hours back, and the Luxury Sprinter pill goes back to the Sprinter chosen before", async () => {
  await page.click("#bk-edit");
  assert.deepEqual(await hourOptions(page), ["4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  await page.selectOption("#bk-hours", "5");
  await page.click("#bk-view");
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
  await quoted(page);
  assert.deepEqual([await vans(page), await scopes(page)], [SPRINTERS.map(() => ASK), SPRINTERS.map(() => "")]);
  await page.click('label[for="bk-c-premium"]');
  await page.waitForFunction(() => !document.getElementById("price-total").getAttribute("aria-busy") && /Cadillac/.test(document.getElementById("bk-choice").textContent) && !document.getElementById("price").hidden);
  assert.deepEqual(await hourOptions(page), ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  assert.deepEqual(await shown(page), [false, false]);
  assert.equal(await page.inputValue("#bk-hours"), "5");
  await page.evaluate(() => document.querySelector('.bk-pill[data-c="sprinter"]').click());
  await quoted(page);
  assert.deepEqual(await picked(page), ["sprinter", "sprinter-limo"]);
});

await check("S6 a Presidential Sprinter card by the hour is requested, never paid online: the price box and Next stay hidden, and Email and WhatsApp carry the trip with the Presidential Sprinter and 5 hours and no price", async () => {
  await page.click('label[for="bk-c-sprinter-presidential"]');
  await page.waitForFunction(() => document.querySelector("[name=class]:checked").dataset.v === "sprinter-presidential");
  await quoted(page);
  await named(page, "sprinter-presidential");
  await request(page);
  const message = await waText(page, "#q-wa");
  assert.match(message, /Trip: By the hour, 5 hours[\s\S]*\nVehicle: Presidential Sprinter/);
  assert.match(decodeURIComponent(await page.getAttribute("#q-mail", "href")), /Presidential Sprinter/);
  assert.equal(await page.isVisible("#bk-submit"), false);
  assert.deepEqual(page.errors, []);
});

await check("S7 one way every Sprinter card shows its own JFK total, the Limo and White Luxury Limo too, each card prices the trip when picked, and a Sprinter chosen by the hour stays chosen when the trip turns one way", async () => {
  const p = await open(ONE_URL);
  await view(p);
  assert.deepEqual([await vans(p), await scopes(p)], [SPRINTERS.map((key) => cash(AIRPORT_TOTALS[key].jfk)), SPRINTERS.map(() => "ride price")]);
  await p.click('label[for="bk-c-sprinter-executive"]');
  await totalIs(p, AIRPORT_TOTALS["sprinter-executive"].jfk);
  assert.deepEqual(await shown(p), [false, false]);
  for (const key of SPRINTERS) {
    await p.click(`label[for="bk-c-${key}"]`);
    await totalIs(p, AIRPORT_TOTALS[key].jfk);
    assert.equal(await p.textContent(`#bk-p-${key} .bk-fig`), cash(AIRPORT_TOTALS[key].jfk), key);
    assert.deepEqual(await choice(p), [VEHICLES[key].name, "Luxury Sprinter"]);
    assert.match(await waText(p), new RegExp(`\\nVehicle: ${VEHICLES[key].name}\\n`));
    assert.deepEqual(await p.$$eval("#price-lines tr", (r) => r.filter((x) => x.cells[0].textContent === "Tolls" || x.classList.contains("bk-hint")).map((x) => x.textContent)), ["Tolls$12.76", "The same in every class."], key);
    await p.waitForSelector("#q-sprinter-check", { state: "visible" });
    assert.deepEqual([await p.isVisible("#price"), await p.isVisible("#bk-next"), await p.textContent("#bk-bar-q"), (await p.textContent("#q-sprinter-check h3")).trim()], [true, false, "Request this Sprinter", HEADINGS.check], key);
    await p.waitForFunction((n) => decodeURIComponent(document.getElementById("q-wa").getAttribute("href")).includes(`Vehicle: ${n}`), VEHICLES[key].name);
    assert.ok((await waText(p, "#q-wa")).includes(`Total shown: ${cash(AIRPORT_TOTALS[key].jfk)}`), key);
  }
  assert.equal(await p.inputValue("#bk-hours"), "3", "a one way trip leaves the hours alone");
  await p.click("#bk-edit");
  await p.click('label[for="bk-hour"]');
  await p.fill("#bk-from", "277 Bedford Ave, Brooklyn, NY 11211");
  await p.keyboard.press("Escape");
  await view(p);
  assert.deepEqual([await p.inputValue("#bk-hours"), await picked(p)], ["4", ["sprinter", "sprinter-white-limo"]]);
  await p.click('label[for="bk-c-sprinter-limo"]');
  await quoted(p);
  await p.click("#bk-edit");
  await p.click('label[for="bk-one"]');
  assert.deepEqual([await p.inputValue("#bk-sprinter"), await picked(p)], ["sprinter-limo", ["sprinter", "sprinter-limo"]], "the Limo Sprinter is booked one way too");
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S14 the White Luxury Limo Sprinter to LaGuardia has no price yet: its card says Price on request while the other Sprinter cards show their LaGuardia totals, the request block says we'll send a price with Email and WhatsApp to reserve, and another Sprinter card brings the price back", async () => {
  const p = await open(`/book?pickup=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&dropoff=LGA&date=${DATE}&time=12:40&class=sprinter&sprinter=sprinter-white-limo`);
  await view(p);
  await p.waitForFunction(() => document.getElementById("q-sprinter-price").classList.contains("is-on"));
  assert.deepEqual([await picked(p), await p.isVisible("#price"), await p.textContent("#bk-bar-q")], [["sprinter", "sprinter-white-limo"], false, "We'll send you a price"]);
  assert.deepEqual([(await p.textContent("#q-sprinter-price h3")).trim(), (await p.textContent("#q-sprinter-price p")).trim()], ["Get a price for this trip", "For this Sprinter on this trip, we'll send you a price."]);
  assert.deepEqual(await vans(p), SPRINTERS.map((key) => (AIRPORT_TOTALS[key].lga ? cash(AIRPORT_TOTALS[key].lga) : "Price on request")));
  assert.deepEqual(await p.$eval("#bk-p-sprinter-white-limo", (x) => [x.classList.contains("is-q"), x.querySelector(".bk-scope")]), [true, null]);
  assert.deepEqual([await p.isVisible("#q-mail"), await p.isVisible("#q-wa"), await p.isVisible("#bk-next")], [true, true, false]);
  assert.match(await waText(p, "#q-wa"), /\nVehicle: White Luxury Limo Sprinter(\n|$)/);
  await p.click('label[for="bk-c-sprinter-limo"]');
  await priceShown(p);
  await totalIs(p, AIRPORT_TOTALS["sprinter-limo"].lga);
  assert.deepEqual([await p.isVisible("#q-sprinter-price"), await p.isVisible("#q-sprinter-check"), await p.isVisible("#price"), await p.isVisible("#bk-next")], [false, true, true, false]);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S15 a one way trip priced by distance shows Price on request on every Sprinter card, the Executive Sprinter too, with the Request a quote block, while the car classes keep their prices", async () => {
  const p = await open(`/book?pickup=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&dropoff=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&date=${DATE}&time=12:40&class=sprinter`);
  await view(p);
  await quoted(p);
  assert.deepEqual([await picked(p), await vans(p)], [["sprinter", "sprinter-executive"], SPRINTERS.map(() => ASK)]);
  assert.ok((await cards(p)).slice(0, 5).every((c) => /^\$\d/.test(c)));
  await request(p);
  await p.click('label[for="bk-c-sprinter-luxury-jet"]');
  await p.waitForFunction(() => document.querySelector("[name=class]:checked").dataset.v === "sprinter-luxury-jet");
  await quoted(p);
  assert.deepEqual([(await vans(p))[1], await p.isVisible("#price")], [ASK, false]);
  await p.click('label[for="bk-c-suv"]');
  await priceShown(p);
  assert.equal(await p.isVisible("#q-sprinter-quote"), false);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S10 a Sprinter Book link checks that Sprinter's card: the White Luxury Limo by the hour with a pickup lands on it at its 4-hour total, the Luxury Jet one way at its JFK total, a link that names only the Sprinter class opens the Executive Sprinter, and a link with a retired Sprinter key opens the Executive Sprinter", async () => {
  const limo = await open(`/book?trip-type=hour&hours=4&class=sprinter&sprinter=sprinter-white-limo&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&date=${DATE}&time=12:40`);
  assert.equal(await limo.inputValue("#bk-sprinter"), "sprinter-white-limo");
  assert.equal(await limo.evaluate(() => location.search), "");
  await view(limo);
  assert.deepEqual(await picked(limo), ["sprinter", "sprinter-white-limo"]);
  await quoted(limo);
  assert.deepEqual([await limo.inputValue("#bk-sprinter"), await limo.inputValue("#bk-hours")], ["sprinter-white-limo", "4"]);
  assert.deepEqual(await choice(limo), ["White Luxury Limo Sprinter", "Luxury Sprinter"]);
  assert.deepEqual(await shown(limo), [false, false]);
  assert.deepEqual(limo.errors, []);
  await limo.context().close();
  const jet = await open(`${ONE_URL}&class=sprinter&sprinter=sprinter-luxury-jet`);
  await view(jet);
  await totalIs(jet, AIRPORT_TOTALS["sprinter-luxury-jet"].jfk);
  assert.deepEqual([await jet.inputValue("#bk-sprinter"), await picked(jet), ...(await choice(jet))], ["sprinter-luxury-jet", ["sprinter", "sprinter-luxury-jet"], "Luxury Jet Sprinter", "Luxury Sprinter"]);
  assert.deepEqual(jet.errors, []);
  await jet.context().close();
  for (const old of ["", "&sprinter=sprinter-shuttle", "&sprinter=sprinter-jet"]) {
    const one = await open(`${ONE_URL}&class=sprinter${old}`);
    await view(one);
    await totalIs(one, AIRPORT_TOTALS["sprinter-executive"].jfk);
    assert.deepEqual([await one.inputValue("#bk-sprinter"), await picked(one)], ["sprinter-executive", ["sprinter", "sprinter-executive"]], old);
    assert.deepEqual(one.errors, []);
    await one.context().close();
  }
});

const EXEC_URL = (key) => `/book?trip-type=hour&hours=4&class=sprinter&sprinter=${key}&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&date=${DATE}&time=12:40`;
const stepIs = (p, step) => p.waitForFunction((s) => document.getElementById("book-form").dataset.step === s, step);

await check("S13 a saved trip keeps its Sprinter card: a reload keeps the Luxury Jet by the hour with its request, and a trip saved before this change with a retired Sprinter and an event answer opens on the Executive Sprinter card, with no error", async () => {
  const p = await open(EXEC_URL("sprinter-luxury-jet"));
  await view(p);
  await quoted(p);
  await p.reload({ waitUntil: "load" });
  await stepIs(p, "options");
  await quoted(p);
  assert.deepEqual([await p.inputValue("#bk-sprinter"), await picked(p)], ["sprinter-luxury-jet", ["sprinter", "sprinter-luxury-jet"]]);
  assert.deepEqual(await p.$$eval("[name=class]:checked", (r) => r.map((x) => x.id)), ["bk-c-sprinter-luxury-jet"]);
  const old = await p.evaluate(() => {
    const b = JSON.parse(sessionStorage.getItem("nlr-book"));
    b.fields = { ...b.fields, sprinter: "sprinter-shuttle", event: "1" };
    return JSON.stringify(b);
  });
  await p.context().addInitScript((v) => sessionStorage.setItem("nlr-book", v), old);
  await p.reload({ waitUntil: "load" });
  await quoted(p);
  assert.deepEqual([await p.inputValue("#bk-sprinter"), await picked(p)], ["sprinter-executive", ["sprinter", "sprinter-executive"]]);
  assert.doesNotMatch(await waText(p), /wedding|Shuttle/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S16 at 320 each Sprinter card shows the whole Sprinter name and, clear of it, its price inside the card with no sideways scroll, by the hour at 4 hours, to LaGuardia with Price on request and above a Sprinter's seats", async () => {
  const runs = [
    [`${HOURLY_URL.replace("hours=3", "hours=4")}&class=sprinter`, null],
    [`/book?pickup=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&dropoff=LGA&date=${DATE}&time=12:40&class=sprinter`, null],
    [`${HOURLY_URL.replace("hours=3", "hours=4")}&class=sprinter`, 9],
  ];
  for (const [url, n] of runs) {
    const p = await open(url, { width: 320, height: 700 });
    await view(p);
    if (n) await pax(p, n);
    await p.waitForFunction(() => !document.querySelector(".bk-card__price .bk-sk") && !document.getElementById("bk-wait").textContent.startsWith("Finding"));
    const fit = await p.$$eval("[name=class][data-v]", (rs) => rs.map((r) => {
      const card = r.parentElement.getBoundingClientRect(), name = r.parentElement.querySelector(".bk-card__name"), fig = r.parentElement.querySelector(".bk-card__price .bk-fig");
      const f = fig.getBoundingClientRect(), m = name.getBoundingClientRect();
      return [r.dataset.v, name.scrollWidth <= name.clientWidth + 1 && !(m.right > f.left + 1 && m.left < f.right - 1 && m.bottom > f.top + 1 && m.top < f.bottom - 1), f.right <= card.right && f.bottom <= card.bottom && f.width > 0, card.right <= innerWidth, fig.textContent];
    }));
    for (const [key, nameFits, priceIn, inView, text] of fit) {
      assert.deepEqual([nameFits, priceIn, inView], [true, true, true], `${url} ${n} ${key} ${text}`);
      assert.ok(n && VEHICLES[key].seats < n ? text === `Seats ${VEHICLES[key].seats}` : /^\$|^Price on request$/.test(text), `${key} ${text}`);
    }
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

await check("S12 the Sprinter cards keep the step steady and light: every card has the same photo tile, no card moves while the prices load, the five Sprinter studio photos load lazily from their 300 or 400 files, and the step shifts no layout", async () => {
  for (const width of [320, 390, 768, 1440]) {
    const p = await open(ONE_URL, { width, height: width < 1024 ? 844 : 900 });
    await p.evaluate(() => { window.__cls = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => e.hadRecentInput || (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true }); });
    await p.click("#bk-view");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    const box = () => p.$$eval("label.bk-card", (l) => l.map((c) => { const t = c.querySelector("picture, .bk-ph").getBoundingClientRect(); return [Math.round(t.width), Math.round(t.height), Math.round(c.getBoundingClientRect().height)]; }));
    const early = await box();
    await p.waitForFunction(() => !document.querySelector(".bk-card__price .bk-sk") && /\d/.test(document.getElementById("bk-p-sprinter-white-limo").textContent));
    const late = await box();
    assert.deepEqual(late, early, `${width}: the cards keep their size when the prices arrive`);
    assert.equal(new Set(late.map(([w, h]) => `${w}x${h}`)).size, 1, `${width}: ${JSON.stringify(late)}`);
    assert.deepEqual([await p.locator(".bk-ph").count(), await p.$eval('label[for="bk-c-sprinter-presidential"] picture', (x) => getComputedStyle(x).backgroundColor)], [0, await p.$eval('label[for="bk-c-suv"] picture', (x) => getComputedStyle(x).backgroundColor)]);
    await p.evaluate(() => document.querySelector('label[for="bk-c-sprinter-white-limo"]').scrollIntoView({ block: "center", behavior: "instant" }));
    await p.waitForFunction(() => [...document.querySelectorAll("[data-v] ~ picture img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    const files = await p.$$eval("[data-v] ~ picture img", (imgs) => imgs.map((i) => [i.loading, new URL(i.currentSrc).pathname.split("/").pop()]));
    assert.deepEqual(files.map(([l]) => l), ["lazy", "lazy", "lazy", "lazy", "lazy"]);
    files.forEach(([, f], i) => assert.match(f, new RegExp(`^${["sprinter-executive-studio-card", "sprinter-luxury-jet-studio-card", "sprinter-presidential-studio-card", "sprinter-limo-black-studio-card", "sprinter-white-limo-studio-card"][i]}-(300|400)\\.(avif|webp)$`), `${width} ${f}`));
    assert.ok((await p.evaluate(() => window.__cls)) < 0.01, `${width}: layout shift ${await p.evaluate(() => window.__cls)}`);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}`);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

await check("S11 at 320 on a 2x phone the fleet photo row keeps two columns, so each photo gets a file at least twice its width", async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(G.base), (route) => route.fulfill({ status: 204, body: "" }));
  const p = await ctx.newPage();
  await p.goto(`${G.base}/fleet`, { waitUntil: "load" });
  for (const img of await p.$$(".fleet-photos img")) await img.scrollIntoViewIfNeeded();
  await p.waitForFunction(() => [...document.querySelectorAll(".fleet-photos img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  const boxes = await p.$$eval(".fleet-photos img", (imgs) => imgs.map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.top + scrollY), r.width, +new URL(i.currentSrc).pathname.match(/-(\d+)\.(avif|webp)$/)[1]]; }));
  assert.equal(boxes.length, 8);
  assert.equal(new Set(boxes.map(([top]) => top)).size, 4, JSON.stringify(boxes));
  assert.ok(boxes.every(([, w, file]) => w < 150 && file >= 2 * w), JSON.stringify(boxes));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();
});

for (const width of [390, 1440]) {
  await check(`S8 at ${width} the rates page asks for a quote for a Sprinter by the hour with no hourly Sprinter price, shows the Sprinter airport table with each Sprinter's totals and the availability check, and Who is traveling? marks the Sprinters too small for 11 to 14`, async () => {
    const p = await open("/rates", { width, height: 900 });
    await p.locator("#luxury-sprinter").scrollIntoViewIfNeeded();
    assert.ok(await p.isVisible("#luxury-sprinter"));
    assert.equal((await p.textContent("#luxury-sprinter")).replace(/\s+/g, " ").trim(), "Request a Luxury Sprinter by the hour. We check that a Sprinter is free and reply with a price.");
    assert.equal(await p.$("#sprinter-caption"), null);
    assert.match(await p.textContent("#sprinter-airport-caption"), /We check that a Sprinter is free before you pay\. Book a Sprinter at least 3 hours ahead\.$/);
    await p.locator("#sprinter-airport").scrollIntoViewIfNeeded();
    assert.ok(await p.isVisible("#sprinter-airport"));
    const NAMES = { jfk: "JFK", ewr: "Newark", teb: "Teterboro", lga: "LaGuardia" };
    const airport = await p.$$eval("#sprinter-airport tbody tr td", (r) => r.map((td) => td.textContent.replace(/Request.*/, "").trim()));
    assert.deepEqual(airport, SPRINTERS.map((key) => ["jfk", "ewr", "teb", "lga"].map((a) => (AIRPORT_TOTALS[key][a] ? `${NAMES[a]} $${AIRPORT_TOTALS[key][a] / 100}` : `${NAMES[a]}, ask for a price`)).join(", ")));
    await p.click('.fits label:has(input[value="14"])');
    const fits = (sel) => p.$$eval(sel, (r) => r.map((tr) => [tr.querySelector(".fits-yes").checkVisibility(), tr.querySelector(".fits-no").checkVisibility()]));
    const for14 = SPRINTERS.map((key) => (VEHICLES[key].seats === 14 ? [true, false] : [false, true]));
    assert.deepEqual(await fits("#sprinter-airport tbody tr"), for14);
    assert.deepEqual(await p.$eval("#airport-sprinter", (tr) => [tr.querySelector(".fits-yes").checkVisibility(), tr.querySelector("small").textContent]), [true, "Five kinds of Sprinter, lowest prices shown"]);
    await p.click('.fits label:has(input[value="10"])');
    assert.deepEqual(await p.$$eval("#sprinter-airport tbody tr", (r) => r.map((tr) => tr.querySelector(".fits-yes").checkVisibility())), SPRINTERS.map((key) => VEHICLES[key].seats >= 10));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  await check(`S9 at ${width} the fleet page shows the five Sprinters with their seats and studio photos, the gallery of the owner's photos loads lazily below the fold, and none of them is in the first screen`, async () => {
    const p = await open("/fleet", { width, height: 900 });
    const before = await p.$$eval("#luxury-sprinter img", (imgs) => imgs.map((i) => [i.getAttribute("loading"), i.getBoundingClientRect().top > innerHeight]));
    assert.ok(before.length === 13 && before.every(([loading, below]) => loading === "lazy" && below), JSON.stringify(before));
    const lcp = await p.evaluate(() => new Promise((ok) => new PerformanceObserver((l) => ok(l.getEntries().at(-1).url || "")).observe({ type: "largest-contentful-paint", buffered: true })));
    assert.match(lcp, /page-fleet/);
    await p.locator("#luxury-sprinter").scrollIntoViewIfNeeded();
    const cardsIn = await p.$$eval("#luxury-sprinter .fleet-card", (c) => c.map((x) => [x.querySelector("h3").textContent, x.dataset.seats, x.querySelector(".fleet-card__specs li").textContent]));
    assert.deepEqual(cardsIn, SPRINTERS.map((key) => [VEHICLES[key].name, String(VEHICLES[key].seats), `Up to ${VEHICLES[key].seats} passengers`]));
    assert.deepEqual([await p.locator("#luxury-sprinter .plate__none").count(), await p.locator("#luxury-sprinter .fleet-card").evaluateAll((c) => c.map((x) => x.querySelectorAll(".plate__img img").length))], [0, [1, 1, 1, 1, 1]]);
    for (const img of await p.$$("#luxury-sprinter img")) await img.scrollIntoViewIfNeeded();
    await p.waitForFunction(() => [...document.querySelectorAll("#luxury-sprinter img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    const srcs = await p.$$eval("#luxury-sprinter img", (imgs) => imgs.map((i) => new URL(i.currentSrc).pathname.replace(/-\d+\.(avif|webp)$/, "")));
    assert.deepEqual(srcs, ["/fleet/sprinter-executive-studio", "/fleet/sprinter-luxury-jet-studio", "/fleet/sprinter-presidential-studio", "/fleet/sprinter-limo-black-studio", "/fleet/sprinter-white-limo-studio", "/fleet/sprinter-shuttle-luggage", "/fleet/sprinter-shuttle-seats", "/fleet/sprinter-luxury-jet-front", "/fleet/sprinter-luxury-jet-render", "/fleet/sprinter-limo-black-lot", "/fleet/sprinter-limo-black-door", "/fleet/sprinter-limo-white", "/fleet/sprinter-limo-castle"]);
    assert.deepEqual(await p.$$eval(".fleet-photos figcaption", (f) => f.map((x) => x.textContent)), ["Executive Sprinter", "Executive Sprinter", "Luxury Jet Sprinter", "Luxury Jet Sprinter", "Limo Sprinter", "Limo Sprinter", "White Luxury Limo Sprinter", "White Luxury Limo Sprinter"]);
    assert.ok(await p.$$eval("#luxury-sprinter img", (imgs) => imgs.every((i) => i.alt.length > 20 && Math.abs(i.getBoundingClientRect().width / i.getBoundingClientRect().height - 1.5) < 0.02)), "every photo has alt text and shows at 3:2");
    await p.click('.fits label:has(input[value="14"])');
    assert.deepEqual(await p.$$eval("#luxury-sprinter .fleet-card", (c) => c.map((x) => x.querySelector(".fits-no").checkVisibility())), SPRINTERS.map((key) => VEHICLES[key].seats < 14));
    await p.click('.fits label:has(input[value="10"])');
    assert.deepEqual(await p.$$eval("#luxury-sprinter .fleet-card", (c) => c.map((x) => x.querySelector(".fits-yes").checkVisibility())), SPRINTERS.map((key) => VEHICLES[key].seats >= 10));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

for (const width of [390, 1440]) {
  await check(`S17 at ${width} by the hour at 4 hours with the Business SUV checked, the SUV vehicle picker sits right under the Business SUV card, Tab from the card reaches it and ArrowDown still moves to the next class`, async () => {
    const p = await open(HOURLY_URL.replace("hours=3", "hours=4"), { width, height: width < 1024 ? 844 : 900 });
    await view(p);
    assert.deepEqual(await picked(p), ["suv", ""]);
    assert.deepEqual(await shown(p), [true, false]);
    const gap = await p.evaluate(() => document.getElementById("bk-vehicle-f").getBoundingClientRect().top - document.getElementById("bk-c-suv").parentNode.getBoundingClientRect().bottom);
    assert.ok(gap >= 0 && gap <= 16, `gap ${gap}`);
    await p.focus("#bk-c-suv");
    await p.keyboard.press("Tab");
    assert.equal(await p.evaluate(() => document.activeElement.id), "bk-vehicle");
    await p.focus("#bk-c-suv");
    await p.keyboard.press("ArrowDown");
    assert.deepEqual([await p.evaluate(() => document.activeElement.id), await picked(p)], ["bk-c-premium", ["premium", ""]]);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

await check("S18 at 1440 by 800, where the page scrolls the cards above the header, the Luxury Sprinter pill names the Sprinter its price belongs to: the Executive Sprinter at first, then the White Luxury Limo Sprinter at its own total after the rider picks it and goes back to the Business SUV, and the pill picks that Sprinter", async () => {
  const p = await open(ONE_URL, { width: 1440, height: 800 });
  await view(p);
  await totalIs(p, AIRPORT_TOTALS.suv.jfk);
  const pill = () => p.$eval(".bk-pill[data-c=sprinter]", (b) => [b.firstElementChild.textContent, b.lastElementChild.textContent]);
  assert.deepEqual(await pill(), ["Executive Sprinter", cash(AIRPORT_TOTALS["sprinter-executive"].jfk)]);
  await p.click('label[for="bk-c-sprinter-white-limo"]');
  await totalIs(p, AIRPORT_TOTALS["sprinter-white-limo"].jfk);
  await p.click('label[for="bk-c-suv"]');
  await totalIs(p, AIRPORT_TOTALS.suv.jfk);
  await p.evaluate(() => scrollTo(0, document.getElementById("bk-cards").getBoundingClientRect().bottom + scrollY + 20));
  await p.waitForFunction(() => document.getElementById("bk-pills").classList.contains("is-on"));
  assert.deepEqual(await pill(), ["White Luxury Limo Sprinter", cash(AIRPORT_TOTALS["sprinter-white-limo"].jfk)]);
  await p.click(".bk-pill[data-c=sprinter]");
  await totalIs(p, AIRPORT_TOTALS["sprinter-white-limo"].jfk);
  assert.deepEqual([await picked(p), ...(await choice(p))], [["sprinter", "sprinter-white-limo"], "White Luxury Limo Sprinter", "Luxury Sprinter"]);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

const NY_SLOT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const slotAt = (ms) => {
  const p = Object.fromEntries(NY_SLOT.formatToParts(new Date(Math.ceil(ms / 6e5) * 6e5)).map(({ type, value }) => [type, value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const NOTICE_MS = SPRINTER_NOTICE_HOURS * 36e5;
const CLASS_KEYS = ["suv", "premium", "first", "sedan", "electric"];
const SOON_MS = 2 * 36e5;
const soonUrl = (at, extra = "&class=sprinter&sprinter=sprinter-limo") => `/book?pickup=JFK&dropoff=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&date=${at.date}&time=${at.time}${extra}`;
const notice = (p) => p.evaluate(() => ({
  cards: [...document.querySelectorAll(".bk-card")].map((l) => [l.firstChild.dataset.v || l.firstChild.value, l.classList.contains("is-small"), (l.querySelector(".bk-card__price .bk-fig") || {}).textContent]),
  blocks: [...document.querySelectorAll("#quote .bk-q")].filter((e) => e.getClientRects().length).map((e) => [e.id, e.querySelector("h3").textContent, e.querySelector("p").textContent]),
  shown: ["price", "bk-next", "q-mail", "q-wa", "q-body", "bk-qnotes-f", "q-fix"].map((id) => document.getElementById(id).checkVisibility()),
  fix: document.getElementById("q-fix").textContent,
  bar: document.getElementById("bk-bar-q").textContent,
  wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
async function described(p, sel) {
  const cdp = await p.context().newCDPSession(p);
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
  await cdp.detach();
  return (nodes[0].description || {}).value || "";
}
const settled = (p) => p.waitForFunction(() => !document.querySelector(".bk-card__price .bk-sk") && !document.getElementById("bk-wait").textContent.startsWith("Finding") && !document.getElementById("price-total").getAttribute("aria-busy"));
const OFF = SPRINTERS.map((key) => [key, true, "Book 3 hours ahead"]);
const NOTICE_BLOCK = [["q-sprinter-notice", HEADINGS.sprinter, REASONS["sprinter-notice"].text]];
const QUIET = [false, false, true, true, true, true, true];
const CHECK_BLOCK = [["q-sprinter-check", HEADINGS.check, REASONS["sprinter-check"].text]];

for (const width of [390, 1440]) {
  await check(`S19 at ${width} a pickup under 3 hours away turns the five Sprinter cards off like a seat limit, dimmed with Book 3 hours ahead in the price, keeps a chosen Sprinter on the vehicle step with Book a Sprinter 3 hours ahead, Change the date and no price or pay button, keeps Email and WhatsApp to reserve, and another car brings the price back`, async () => {
    const p = await open(soonUrl(slotAt(Date.now() + SOON_MS)), { width, height: 900 });
    await view(p);
    await settled(p);
    const s = await notice(p);
    assert.deepEqual(s.cards, [...CLASS_KEYS.map((cls) => [cls, false, cash(AIRPORT_TOTALS[cls].jfk)]), ...OFF]);
    assert.deepEqual([await picked(p), s.blocks, s.shown, s.fix, s.bar, s.wide], [["sprinter", "sprinter-limo"], NOTICE_BLOCK, QUIET, "Change the date", "Book a Sprinter 3 hours ahead", 0]);
    assert.equal(await p.getByRole("radio", { name: "Limo Sprinter Book 3 hours ahead", exact: true }).count(), 1);
    assert.deepEqual(await p.$$eval(".bk-card.is-small picture", (x) => x.map((e) => getComputedStyle(e).opacity)), ["0.6", "0.6", "0.6", "0.6", "0.6"], "the five Sprinter photos dim like a card that is too small");
    await p.click('label[for="bk-c-suv"]');
    await priceShown(p);
    await totalIs(p, AIRPORT_TOTALS.suv.jfk);
    const suv = await notice(p);
    assert.deepEqual([suv.blocks, suv.shown.slice(0, 2), suv.cards.slice(5)], [[], [true, true], OFF]);
    await p.click('label[for="bk-c-sprinter-executive"]');
    await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
    await settled(p);
    const back = await notice(p);
    assert.deepEqual([await picked(p), back.blocks, back.shown], [["sprinter", "sprinter-executive"], NOTICE_BLOCK, QUIET]);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

await check("S20 with the pickup under 3 hours away, more passengers than a car seats no longer moves the rider into a Sprinter that is off: a Sedan picked for 4 passengers asks for a larger car that is on, and at 7 passengers, which only a Sprinter seats, the SUV stays chosen with the Sprinter notice instead of the seat block, Email and WhatsApp to reserve stay, and Change the date moves the group into a Sprinter", async () => {
  const p = await open(soonUrl(slotAt(Date.now() + SOON_MS), ""));
  await view(p);
  await totalIs(p, AIRPORT_TOTALS.suv.jfk);
  await pax(p, 4);
  await totalIs(p, AIRPORT_TOTALS.suv.jfk);
  await p.click('label[for="bk-c-sedan"]');
  await p.waitForSelector("#q-seats", { state: "visible" });
  assert.deepEqual([await picked(p), await p.textContent("#q-fix")], [["sedan", ""], "Show cars for 4"]);
  await p.click('label[for="bk-c-suv"]');
  await totalIs(p, AIRPORT_TOTALS.suv.jfk);
  await pax(p, 7);
  await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
  assert.deepEqual(await picked(p), ["suv", ""]);
  assert.doesNotMatch(await p.textContent("#bk-wait"), /Changed to/);
  await settled(p);
  const seven = await notice(p);
  assert.deepEqual([await p.isVisible("#q-seats"), seven.blocks, seven.shown, seven.fix, seven.bar, seven.cards.slice(5)], [false, NOTICE_BLOCK, QUIET, "Change the date", "Book a Sprinter 3 hours ahead", OFF], "no car seats 7 under 3 hours, so the rider is told to book a Sprinter 3 hours ahead");
  await p.click("#q-fix");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
  assert.deepEqual(await picked(p), ["sprinter", "sprinter-executive"], "Change the date moves the 7 passengers into the first Sprinter that seats them");
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S21 Change the date opens the calendar on the first day a Sprinter can be booked, and a pickup moved past 3 hours brings the five Sprinter cards back with their prices and the chosen Sprinter's total", async () => {
  const p = await open(soonUrl(slotAt(Date.now() + SOON_MS)));
  await view(p);
  await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
  const first = await p.evaluate(() => fetch("/api/book", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ trip_type: "one", from_text: "JFK", from_id: "jfk", to_text: "350 5th Ave, New York, NY 10118", date: "2030-01-01", time: "12:00", passengers: "1", class: "suv", action: "options" }) }).then((r) => r.json()).then((b) => (b.sprinter_from.time <= "23:50" ? b.sprinter_from.date : new Date(Date.parse(b.sprinter_from.date) + 864e5).toISOString().slice(0, 10))));
  await p.click("#q-fix");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
  await p.waitForFunction((d) => document.activeElement.dataset.day === d, first);
  for (let i = 0; i < 3 && !(await p.$(`#bk-cal [data-day="${DATE}"]`)); i++) await p.click('#bk-cal .bk-cal__nav[data-dir="1"]');
  await p.click(`#bk-cal [data-day="${DATE}"]`);
  await p.selectOption("#bk-time", "12:40", { force: true });
  await view(p);
  await totalIs(p, AIRPORT_TOTALS["sprinter-limo"].jfk);
  await settled(p);
  const s = await notice(p);
  assert.deepEqual([s.cards.slice(5), s.blocks, s.shown.slice(0, 2)], [SPRINTERS.map((key) => [key, false, cash(AIRPORT_TOTALS[key].jfk)]), CHECK_BLOCK, [true, false]]);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S22 the 3 hours are counted by the server clock: a pickup 20 minutes short of 3 hours is off and one just past 3 hours is priced, by the hour too, and a browser clock two days slow changes nothing", async () => {
  for (const [ms, off] of [[Date.now() + NOTICE_MS - 20 * 6e4, true], [Date.now() + NOTICE_MS + 6e4, false]]) {
    const p = await open(soonUrl(slotAt(ms)));
    await view(p);
    await settled(p);
    if (!off) await totalIs(p, AIRPORT_TOTALS["sprinter-limo"].jfk);
    const s = await notice(p);
    assert.deepEqual([s.cards.slice(5).map((c) => c[1]), s.blocks, s.shown[0]], [SPRINTERS.map(() => off), off ? NOTICE_BLOCK : CHECK_BLOCK, !off], String(off));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
  const at = slotAt(Date.now() + SOON_MS);
  const hourly = await open(`/book?trip-type=hour&hours=4&class=sprinter&sprinter=sprinter-white-limo&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}&date=${at.date}&time=${at.time}`);
  await view(hourly);
  await settled(hourly);
  const h = await notice(hourly);
  assert.deepEqual([h.cards.slice(5), h.blocks], [OFF, NOTICE_BLOCK]);
  assert.deepEqual(hourly.errors, []);
  await hourly.context().close();
  const slow = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await slow.route((url) => !url.href.startsWith(G.base), (route) => route.fulfill({ status: 204, body: "" }));
  await slow.addInitScript(() => { const real = Date.now; Date.now = () => real() - 2 * 864e5; });
  const p = await slow.newPage();
  p.setDefaultTimeout(8000);
  await p.goto(`${G.base}${soonUrl(at)}`, { waitUntil: "load" });
  await view(p);
  await settled(p);
  const s = await notice(p);
  assert.deepEqual([s.cards.slice(5), s.blocks], [OFF, NOTICE_BLOCK]);
  await slow.close();
});

await check("S23 the server has the last word: answers rewritten to price a Sprinter 2 hours away still show only the availability check and no pay button, so no pay post goes out, and the real answer turns the Sprinters off with the notice", async () => {
  const at = slotAt(Date.now() + SOON_MS);
  const p = await open(soonUrl(at));
  let rewrite = true;
  const paid = [];
  await p.route("**/api/book", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.action === "pay") paid.push(body.date);
    if (!rewrite || body.action === "pay") return route.continue();
    return route.continue({ postData: JSON.stringify({ ...body, date: DATE, time: "12:40" }) });
  });
  await view(p);
  await totalIs(p, AIRPORT_TOTALS["sprinter-limo"].jfk);
  await p.waitForSelector("#q-sprinter-check", { state: "visible" });
  assert.deepEqual([await p.isVisible("#bk-next"), await p.isVisible("#bk-submit")], [false, false]);
  rewrite = false;
  await p.click('label[for="bk-c-suv"]');
  await priceShown(p);
  await p.click('label[for="bk-c-sprinter-limo"]');
  await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
  await settled(p);
  assert.deepEqual([paid, p.url().includes("booking-confirmed"), (await notice(p)).cards.slice(5)], [[], false, OFF]);
  await p.unroute("**/api/book");
  assert.deepEqual(p.errors.filter((e) => !/422/.test(e)), []);
  await p.context().close();
});

await check("S25 Change the date then Enter on the first Sprinter day leaves only the times from the server's first Sprinter minute, clears a pickup time a Sprinter can't take and says so under the time, and the first time left prices every Sprinter, also when the pickup is already on that day, and another car brings every time back", async () => {
  for (const hours of [1.75, 2.5]) {
    const p = await open(soonUrl(slotAt(Date.now() + hours * 36e5)));
    await view(p);
    await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
    await settled(p);
    await p.click("#q-fix");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
    const from = await p.evaluate(() => ({ date: SF.slice(0, 10), time: SF.slice(11) }));
    const day = from.time <= "23:50" ? from.date : new Date(Date.parse(from.date) + 864e5).toISOString().slice(0, 10);
    await p.waitForFunction((d) => document.activeElement.dataset.day === d, day);
    await p.keyboard.press("Enter");
    await p.waitForFunction((d) => document.getElementById("bk-date").value === d, day);
    const t = await p.evaluate(() => ({ value: document.getElementById("bk-time").value, open: [...document.getElementById("bk-time").options].filter((o) => o.value && !o.disabled).map((o) => o.value), hint: document.getElementById("bk-time-h").hidden ? "" : document.getElementById("bk-time-h").textContent }));
    if (day === from.date) assert.ok(t.open.length && t.open.every((v) => v >= from.time), JSON.stringify([t.open[0], from]));
    assert.ok(t.value === "" || `${day} ${t.value}` >= `${from.date} ${from.time}`, JSON.stringify([t.value, from]));
    if (t.value === "") {
      assert.equal(t.hint, `Book a Sprinter at least ${SPRINTER_NOTICE_HOURS} hours ahead.`);
      await p.selectOption("#bk-time", t.open[0], { force: true });
    }
    await view(p);
    await totalIs(p, AIRPORT_TOTALS["sprinter-limo"].jfk);
    await settled(p);
    const s = await notice(p);
    assert.deepEqual([s.cards.slice(5), s.blocks, s.shown.slice(0, 2)], [SPRINTERS.map((key) => [key, false, cash(AIRPORT_TOTALS[key].jfk)]), CHECK_BLOCK, [true, false]], String(hours));
    if (hours === 2.5) {
      await p.click('label[for="bk-c-suv"]');
      await totalIs(p, AIRPORT_TOTALS.suv.jfk);
      await p.click("#bk-edit");
      await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search");
      const earliest = await p.evaluate(() => fetch("/api/book", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ trip_type: "one", from_text: "JFK", from_id: "jfk", to_text: "350 5th Ave, New York, NY 10118", date: "2030-01-01", time: "12:00", passengers: "1", class: "suv", action: "options" }) }).then((r) => r.json()).then((b) => b.earliest));
      const off = await p.$$eval("#bk-time option", (o) => o.filter((x) => x.value && x.disabled).map((x) => x.value));
      assert.ok(off.every((v) => `${day} ${v}` < `${earliest.date} ${earliest.time}`), `an SUV on that day can take any time from the 90 minute online cutoff: ${JSON.stringify([off.at(-1), earliest])}`);
      const all = await p.$$eval("#bk-time option", (o) => o.filter((x) => x.value).length);
      assert.ok(off.length < all - t.open.length, "the times a Sprinter can't take are back for the SUV");
    }
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

await check("S29 with the server clock at 9:30 PM the first Sprinter minute is 12:30 AM the next day, so Change the date leaves none of the pickup day's times for a Sprinter, 11:30 PM included, and the next day opens from 12:30 AM", async () => {
  const at = slotAt(Date.now() + SOON_MS);
  const next = new Date(Date.parse(at.date) + 864e5).toISOString().slice(0, 10);
  const p = await open(soonUrl(at));
  await p.route("**/api/book", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.sprinter_from) body.sprinter_from = { date: next, time: "00:30" };
    await route.fulfill({ response: res, json: body });
  });
  await view(p);
  await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
  await settled(p);
  await p.click("#q-fix");
  await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
  await p.waitForFunction((d) => document.activeElement.dataset.day === d, next);
  const times = () => p.evaluate(() => ({ date: document.getElementById("bk-date").value, value: document.getElementById("bk-time").value, open: [...document.getElementById("bk-time").options].filter((o) => o.value && !o.disabled).map((o) => o.value), late: document.querySelector('#bk-time option[value="23:30"]').disabled }));
  assert.deepEqual(await times(), { date: at.date, value: "", open: [], late: true });
  await p.keyboard.press("Enter");
  await p.waitForFunction((d) => document.getElementById("bk-date").value === d, next);
  const t = await times();
  assert.deepEqual([t.open[0], t.open.every((v) => v >= "00:30"), t.late], ["00:30", true, false]);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("S26 a Sprinter Book link with no pickup time fills in a pickup at least 3 hours ahead by the server clock, so the Sprinter it names is offered with no notice, at its airport price with the availability check one way and by quote by the hour", async () => {
  for (const [path, key, cents] of [[`/book?pickup=JFK&dropoff=${encodeURIComponent("350 5th Ave, New York, NY 10118")}&class=sprinter&sprinter=sprinter-limo`, "sprinter-limo", AIRPORT_TOTALS["sprinter-limo"].jfk], [`/book?trip-type=hour&hours=4&class=sprinter&sprinter=sprinter-luxury-jet&pickup=${encodeURIComponent("277 Bedford Ave, Brooklyn, NY 11211")}`, "sprinter-luxury-jet", null]]) {
    const p = await open(path);
    const when = await p.evaluate(() => [document.getElementById("bk-date").value, document.getElementById("bk-time").value]);
    await view(p);
    if (cents) await totalIs(p, cents);
    else await quoted(p);
    await settled(p);
    const from = await p.evaluate(() => SF);
    assert.ok(when.join(" ") >= from, JSON.stringify([when, from]));
    const s = await notice(p);
    assert.deepEqual([await picked(p), s.blocks, s.shown.slice(0, 2), s.cards.slice(5).map((c) => c[1])], [["sprinter", key], cents ? CHECK_BLOCK : [["q-sprinter-quote", HEADINGS.quote, REASONS["sprinter-quote"].text]], [Boolean(cents), false], SPRINTERS.map(() => false)]);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

await check("S27 at 320 and 390 the bar under the cards keeps Email to reserve with the trip while the Sprinter notice is on, like every other request, with its line readable and no sideways scroll, it goes back to the price bar once another car is chosen, and Change the date in the notice opens the calendar on the first Sprinter day", async () => {
  for (const width of [320, 390]) {
    const p = await open(soonUrl(slotAt(Date.now() + SOON_MS)), { width, height: 800 });
    await view(p);
    await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
    await settled(p);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForSelector("#bk-bar-mail", { state: "visible" });
    const bar = () => p.evaluate(() => {
      const r = document.getElementById("bk-bar-mail").getBoundingClientRect(), q = document.getElementById("bk-bar-q").getBoundingClientRect();
      return [document.getElementById("bk-bar").classList.contains("is-q"), document.getElementById("bk-bar-q").textContent, document.getElementById("bk-bar-mail").textContent, r.bottom <= innerHeight, r.right <= innerWidth, r.height >= 44, q.width >= 100, document.getElementById("bk-bar-mail").getAttribute("href") === document.getElementById("q-mail").getAttribute("href"), [...document.querySelectorAll("#bk-bar button")].filter((b) => b.checkVisibility()).length, document.documentElement.scrollWidth - document.documentElement.clientWidth];
    });
    assert.deepEqual(await bar(), [true, "Book a Sprinter 3 hours ahead", "Email to reserve", true, true, true, true, true, 0, 0], String(width));
    assert.match(decodeURIComponent(await p.getAttribute("#bk-bar-mail", "href")), /Limo Sprinter/, "the email carries the trip with its Sprinter");
    await p.click('label[for="bk-c-suv"]');
    await priceShown(p);
    await totalIs(p, AIRPORT_TOTALS.suv.jfk);
    assert.deepEqual([await p.isHidden("#bk-bar-mail"), await p.evaluate(() => document.getElementById("bk-bar").classList.contains("is-q"))], [true, false]);
    await p.click('label[for="bk-c-sprinter-limo"]');
    await p.waitForSelector("#q-sprinter-notice", { state: "visible" });
    await settled(p);
    await p.click("#q-fix");
    await p.waitForFunction(() => document.getElementById("book-form").dataset.step === "search" && !document.getElementById("bk-cal").hidden);
    await p.waitForFunction(() => document.activeElement.dataset.day === (SF.slice(11) <= "23:50" ? SF.slice(0, 10) : new Date(Date.parse(SF.slice(0, 10)) + 864e5).toISOString().slice(0, 10)));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

for (const width of [390, 1440]) {
  await check(`S28 at ${width} a Sprinter pickup under 24 hours away shows no two SUVs line on the cards, in the price box or in what a screen reader hears, since every Sprinter is checked before you pay: the chosen Sprinter shows its flat price with Request this Sprinter and no pay button, and an SUV picked next pays as before`, async () => {
    const swaps = (p) => p.evaluate(() => [document.getElementById("bk-busy"), document.getElementById("price-busy"), document.body.innerText.includes("two SUVs"), [...document.querySelectorAll(".bk-card > input")].flatMap((i) => (i.getAttribute("aria-describedby") || "").split(" ").filter(Boolean).map((id) => document.getElementById(id).textContent)).filter((t) => t.includes("two SUVs")), document.documentElement.scrollWidth - document.documentElement.clientWidth]);
    const p = await open(soonUrl(slotAt(Date.now() + 5 * 36e5)), { width, height: 900 });
    await view(p);
    await totalIs(p, AIRPORT_TOTALS["sprinter-limo"].jfk);
    await settled(p);
    assert.deepEqual(await swaps(p), [null, null, false, [], 0]);
    assert.deepEqual((await notice(p)).cards.slice(5), SPRINTERS.map((key) => [key, false, cash(AIRPORT_TOTALS[key].jfk)]), "the Sprinters 5 hours away are priced");
    assert.deepEqual([await p.textContent("#bk-bar-q"), await p.isVisible("#q-sprinter-check"), await p.isVisible("#bk-next")], [HEADINGS.check, true, false]);
    assert.ok(!SPRINTER_BUSY.startsWith("If") && SPRINTER_BUSY.endsWith("we send two SUVs."), "the line is kept only for Sprinters paid before this release");
    await p.click('label[for="bk-c-suv"]');
    await totalIs(p, AIRPORT_TOTALS.suv.jfk);
    assert.deepEqual(await swaps(p), [null, null, false, [], 0]);
    await p.waitForFunction(() => document.getElementById("bk-next").checkVisibility());
    assert.equal(await p.textContent("#bk-bar-name"), "Business SUV");
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

await check("S24 without javascript a Sprinter under 3 hours away posts to the server and lands on the Sprinter notice message under the vehicle cards, and the same trip in an SUV goes on to payment", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(G.base), (route) => route.fulfill({ status: 204, body: "" }));
  const at = slotAt(Date.now() + SOON_MS);
  for (const [cls, want] of [["sprinter", /#e-sprinter-notice$/], ["suv", /\/booking-confirmed\?session_id=cs_mock_/]]) {
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.goto(`${G.base}/book`, { waitUntil: "load" });
    await p.fill("#bk-from", "John F. Kennedy (JFK), Terminal 4");
    await p.fill("#bk-to", "350 5th Ave, New York, NY 10118");
    await p.fill("#bk-date", at.date);
    await p.selectOption("#bk-time", at.time);
    await p.check(cls === "sprinter" ? "#bk-c-sprinter" : "#bk-c-suv");
    if (cls === "sprinter") await p.selectOption("#bk-sprinter", "sprinter-limo");
    await p.fill("#bk-name", "Ana Lopez");
    await p.fill("#bk-email", "ana.lopez@example.com");
    await p.fill("#bk-phone", "212 555 0100");
    await Promise.all([p.waitForURL(want), p.click("#bk-submit")]);
    if (cls === "sprinter") {
      assert.deepEqual([await p.isVisible("#e-sprinter-notice"), (await p.textContent("#e-sprinter-notice")).trim()], [true, "Book a Sprinter at least 3 hours ahead. Choose a later pickup or another car, or send us the trip."]);
      assert.deepEqual([await p.isVisible("#q-mail"), await p.isVisible("#q-wa")], [true, true], "Email and WhatsApp to reserve stay on the page");
      assert.ok(await p.evaluate(() => document.getElementById("bk-cards").contains(document.getElementById("e-sprinter-notice"))));
    }
    await p.close();
  }
  await ctx.close();
});

await page.context().close();
await browser.close();
if (failures) {
  console.error(`\n${failures} sprinter browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll sprinter browser tests passed");
process.exit(0);
