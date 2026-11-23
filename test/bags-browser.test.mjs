import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const { CLASSES, MAX_BAGS, AIRPORT_TOTALS } = await import(pathToFileURL(join(ROOT, "api", "_rates.mjs")).href);
const { ERRORS } = await import(pathToFileURL(join(ROOT, "api", "_copy.mjs")).href);
const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "MAP_MOCK", "GOOGLE_MAPS_JS", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET"];
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 3 * 864e5));
const NOTE = "Your bags may not fit in this car. Choose a larger car or tell us in the notes.";
const NONE = "Your bags may not fit in any of our cars. Tell us in the notes.";
const cash = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const ROOM = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, (/^(\d+) large plus (\d+) small bags?$/.exec(c.bags) || []).slice(1).map(Number)]));
const ME = { name: "Ana Lopez", email: "ana.lopez@example.com", phone: "+1 212 555 0100" };
const TRIP = { action: "options", trip_type: "one", from_text: "John F. Kennedy (JFK), Terminal 4", from_id: "jfk-t4", to_text: "350 5th Ave, New York, NY 10118", date: DATE, time: "12:40", passengers: "2" };

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
process.on("exit", () => P.child.kill());

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

async function context(viewport, options = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", ...options });
  ctx.api = [];
  await ctx.route((url) => !url.href.startsWith(P.base), (route) => route.fulfill({ status: 204, body: "" }));
  ctx.on("request", (r) => r.url().startsWith(`${P.base}/api/`) && ctx.api.push(r.url()));
  if (options.javaScriptEnabled !== false) await ctx.addInitScript(SPY);
  return ctx;
}

async function open(ctx, path) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to (load resource|preconnect)/.test(m.text()) && page.errors.push(m.text()));
  page.on("response", (r) => r.url().startsWith(P.base) && !r.url().includes("/api/") && r.status() >= 400 && page.errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${P.base}${path}`, { waitUntil: "load" });
  return page;
}

const priced = (page) => page.waitForFunction(() => /\$/.test(document.getElementById("bk-p-suv").textContent) && /\d/.test((document.getElementById("price-total").firstChild || {}).textContent || "") && !document.getElementById("price-total").getAttribute("aria-busy"));
async function options(ctx, extra = {}) {
  const page = await open(ctx, `/book?${new URLSearchParams({ ...TRIP, ...extra })}`);
  await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
  await priced(page);
  return page;
}
const counts = (page) => page.evaluate(() => ["large", "medium", "small"].map((k) => [document.getElementById(`bk-bags-${k}`).value, document.querySelector(`#bk-bags-${k}-l`).closest(".field").querySelector(".bk-stepper output").textContent]));
async function bags(page, large, small, medium = 0) {
  for (const [k, n] of [["large", large], ["medium", medium], ["small", small]]) {
    for (let i = 0; i < 30; i++) {
      const v = +(await page.inputValue(`#bk-bags-${k}`));
      if (v === n) break;
      await page.click(`[aria-label="${v < n ? "More" : "Fewer"} ${k} suitcases"]`);
    }
    assert.equal(+(await page.inputValue(`#bk-bags-${k}`)), n, `${k} suitcases stepper`);
  }
}
const SPRINTER_CARDS = ["sprinter-executive", "sprinter-luxury-jet", "sprinter-presidential", "sprinter-limo", "sprinter-white-limo"];
const pick = (page, card) => page.click(`label[for="bk-c-${card}"]`);
const noteShown = (page) => page.evaluate(() => { const n = document.getElementById("bk-bagfit"); return !n.hidden && n.offsetHeight > 0; });
const cls = (page) => page.evaluate(() => [window.__cls, window.__shifts]);
const waText = async (page) => decodeURIComponent((await page.getAttribute(".site-footer a[data-wa]", "href")).split("?text=")[1] || "");
async function waFor(page, part) {
  await page.waitForFunction((p) => decodeURIComponent(document.querySelector(".site-footer a[data-wa]").getAttribute("href")).includes(p), part).catch(() => {});
  const text = await waText(page);
  assert.ok(text.includes(part), `${part}\n${text}`);
  return text;
}
const layout = (page) =>
  page.evaluate(() => {
    const box = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const $ = (i) => box(document.getElementById(i));
    return { head: $("bk-opt-h"), pax: $("bk-pax-f"), hint: $("bk-pax-h"), bags: $("bk-bags"), bagHint: $("bk-bags-h"), cards: $("bk-cards"), steppers: [...document.querySelectorAll("#bk-pax-f .bk-stepper, #bk-bags .bk-stepper")].map(box), fields: [...document.querySelectorAll("#bk-bags > .field")].map(box), labels: [...document.querySelectorAll("#bk-bags > .field > label")].map(box), buttons: [...document.querySelectorAll("#bk-bags .bk-stepper button")].map(box), align: getComputedStyle(document.getElementById("bk-bags-h")).textAlign, vw: innerWidth };
  });
function sideBySide(r) {
  assert.equal(r.fields.length, 3);
  assert.ok(r.fields.every((f) => f.t === r.fields[0].t), "the three sizes on one line");
  assert.ok(r.labels.every((l, i) => l.b <= r.steppers[i + 1].t && Math.abs(l.l - r.steppers[i + 1].l) <= 1), `each size name sits above its stepper: ${JSON.stringify(r.labels)}`);
  assert.ok(r.fields[0].r < r.fields[1].l && r.fields[1].r < r.fields[2].l && r.fields[2].r < Math.min(r.hint.l, r.bagHint.l), `the steppers stay clear of the hints: ${JSON.stringify(r)}`);
  assert.ok(r.hint.t >= r.pax.b && Math.abs(r.hint.t - r.bags.t) <= 1 && r.bagHint.t >= r.hint.b && r.bagHint.b <= r.bags.b, `the hints stack beside the steppers: ${JSON.stringify(r)}`);
  assert.ok(Math.abs(r.hint.r - r.pax.r) <= 1 && Math.abs(r.bagHint.r - r.pax.r) <= 1, JSON.stringify(r));
  assert.ok(r.cards.t - r.hint.b <= 44, `the cars move down by at most one stepper row: ${JSON.stringify(r)}`);
}
const STATED = Object.values(ROOM).filter((r) => r.length);
const holds = ([l, s], large, small, medium = 0) => large <= l && large + medium + small <= l + s;
const fits = (cls, large, small, medium = 0) => (ROOM[cls].length ? [ROOM[cls]] : STATED).every((r) => holds(r, large, small, medium));
const noteFor = (large, small, medium = 0) => (STATED.some((r) => holds(r, large, small, medium)) ? NOTE : NONE);
const status = (page) => page.textContent("#bk-status");
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function pickStill(page, cls) {
  const sel = `label[for="bk-c-${cls}"]`;
  await page.locator(sel).scrollIntoViewIfNeeded();
  const top = () => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
  const before = await top();
  await page.click(sel);
  await frames(page);
  const after = await top();
  await priced(page);
  const settled = await top();
  assert.ok(Math.abs(after - before) <= 1 && Math.abs(settled - before) <= 1, `${cls} card moved under the pointer: ${before} -> ${after} -> ${settled}`);
}
const noteIs = async (page, want) => {
  const got = await noteState(page);
  assert.deepEqual(Object.fromEntries(Object.keys(want).map((k) => [k, got[k]])), want, JSON.stringify(got));
};
const noteState = (page) => page.evaluate(() => { const n = document.getElementById("bk-bagfit"); return { shown: !n.hidden, keep: n.classList.contains("keep"), h: n.offsetHeight, after: (n.previousElementSibling || {}).htmlFor || n.parentNode.id }; });

for (const [width, height] of [[390, 844], [1440, 900]]) {
  const ctx = await context({ width, height });
  let page;
  await check(`BG1 ${width}: step 2 shows Large suitcase, Medium suitcase and Small suitcase or hand carry next to the passengers, each a stepper at 0 with Fewer off, named by its label with the hint that bags are free, no note, no horizontal scroll, and CLS 0 on load and on the way to step 2`, async () => {
    page = await options(ctx);
    await page.waitForTimeout(800);
    assert.deepEqual(await counts(page), [["0", "0"], ["0", "0"], ["0", "0"]]);
    const s = await page.evaluate(() => [...document.querySelectorAll("#bk-bags .bk-stepper")].map((x) => [document.getElementById(x.getAttribute("aria-labelledby")).textContent, x.getAttribute("aria-describedby"), x.getAttribute("role"), x.firstChild.getAttribute("aria-label"), x.firstChild.ariaDisabled, x.lastChild.getAttribute("aria-label"), x.lastChild.ariaDisabled]));
    assert.deepEqual(s, [["Large suitcase", "bk-bags-h", "group", "Fewer large suitcases", "true", "More large suitcases", "false"], ["Medium suitcase", "bk-bags-h", "group", "Fewer medium suitcases", "true", "More medium suitcases", "false"], ["Small suitcase or hand carry", "bk-bags-h", "group", "Fewer small suitcases", "true", "More small suitcases", "false"]]);
    assert.deepEqual(await page.evaluate(() => [document.getElementById("bk-bags-large").offsetParent, document.getElementById("bk-bags-medium").offsetParent, document.getElementById("bk-bags-small").offsetParent, document.getElementById("bk-bags-h").textContent, document.getElementById("bk-bags-h").offsetHeight > 0]), [null, null, null, "Bags are free.", true]);
    assert.equal(await noteShown(page), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    const [value, shifts] = await cls(page);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(page.errors, []);
  });
  await check(`BG2 ${width}: ${width < 1024 ? "the bag rows sit between the Passengers hint and the cars, each full width with its stepper at the right edge like the passengers" : "the three bag steppers sit on one line under the heading, each under its size name, beside the Passengers hint, with the bags hint under it at the right edge of the passengers, so the cars move down by at most one stepper row below the hints"}, and every stepper button is 44 px and inside the viewport`, async () => {
    const r = await layout(page);
    assert.ok(r.bags.b <= r.cards.t && r.head.b <= r.bags.t, JSON.stringify(r));
    assert.ok(r.buttons.every((b) => b.w === 44 && b.h === 44 && b.l >= 0 && b.r <= r.vw), JSON.stringify(r.buttons));
    const [pax, large, medium, small] = r.steppers;
    if (width < 1024) {
      assert.ok(r.hint.b <= r.bags.t, "under the Passengers hint");
      assert.ok(r.fields[0].b <= r.fields[1].t && r.fields[1].b <= r.fields[2].t, "one row per size");
      assert.ok([large, medium, small].every((x) => Math.abs(x.r - pax.r) <= 1), JSON.stringify(r.steppers));
      assert.ok(r.labels.every((l, i) => Math.abs((l.t + l.b) / 2 - (r.steppers[i + 1].t + r.steppers[i + 1].b) / 2) <= 2), `each size name is on the row of its stepper: ${JSON.stringify(r.labels)}`);
    } else {
      sideBySide(r);
      assert.equal(r.align, "end");
    }
  });
  await check(`BG3 ${width}: the over-capacity note per class, at the stated luggage no note, one large bag more or one bag more in all shows it, small and medium bags may take large bag room, all three sizes count toward the total, the Sedan & Electric, which states no luggage, is checked against the smallest stated luggage, each Sprinter card holds the Luxury Sprinter luggage, the note says so when no car holds the bags, it follows a change of car, it is spoken once in the status line and its words leave the status line when it hides`, async () => {
    let asked = 0;
    const cases = {
      suv: [[3, 3, false], [4, 0, true], [3, 4, true], [2, 4, false], [0, 6, false], [0, 7, true], [0, 3, false, 3], [3, 0, false, 3], [3, 3, true, 1], [0, 0, false, 6], [0, 0, true, 7], [4, 0, true, 0]],
      premium: [[3, 3, false], [4, 0, true], [1, 6, true], [2, 4, false], [1, 1, false, 4], [1, 2, true, 4]],
      first: [[2, 1, false], [3, 0, true], [2, 2, true], [1, 2, false], [0, 3, false], [0, 4, true], [2, 0, false, 1], [2, 0, true, 2], [0, 0, false, 3], [0, 0, true, 4]],
      sedan: [[0, 1, false], [2, 1, false], [0, 3, false], [3, 0, true], [1, 3, true], [5, 5, true], [14, 14, true], [0, 0, false, 3], [1, 1, true, 2]],
      sprinter: [[10, 2, false], [11, 0, true], [10, 3, true], [0, 12, false], [8, 4, false], [0, 13, true], [10, 0, false, 2], [10, 1, true, 2], [0, 0, false, 12], [0, 0, true, 13]],
    };
    for (const [k, list] of Object.entries(cases)) for (const card of k === "sprinter" ? SPRINTER_CARDS : [k]) {
      await pick(page, card);
      await priced(page);
      for (const [large, small, want, medium = 0] of list) {
        const before = ctx.api.length;
        await bags(page, large, small, medium);
        await page.waitForTimeout(250);
        asked += ctx.api.length - before;
        assert.equal(want, !fits(k, large, small, medium), `${k} ${large} ${medium} ${small} follows CLASSES`);
        assert.equal(await noteShown(page), want, `${k} ${large} large ${medium} medium ${small} small`);
        if (want) assert.equal(await page.textContent("#bk-bagfit"), noteFor(large, small, medium), `${k} ${large} large ${medium} medium ${small} small`);
      }
    }
    await bags(page, 4, 0);
    await pick(page, "first");
    assert.equal(await noteShown(page), true);
    await pick(page, "sprinter-white-limo");
    assert.equal(await noteShown(page), false, "a larger car clears it");
    assert.notEqual(await status(page), NOTE, "the status line drops the note when it hides");
    await page.evaluate(() => (document.getElementById("bk-status").textContent = ""));
    await pick(page, "suv");
    assert.equal(await page.textContent("#bk-status"), NOTE);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".bk-card.is-small")].length), 0, "bags never mark a car too small");
    assert.equal(asked, 0, "a bag change asks the server for nothing");
    const [value, shifts] = await cls(page);
    assert.equal(value, 0, shifts.join(" | "));
  });
  await check(`BG4 ${width}: the note never blocks the booking, the price and the class cards stay as they were, More at ${MAX_BAGS} shows the bags message and the next change clears it`, async () => {
    await pick(page, "suv");
    await priced(page);
    await bags(page, 4, 0);
    assert.equal(await noteShown(page), true);
    assert.equal((await page.evaluate(() => document.getElementById("price-total").firstChild.textContent)), cash(AIRPORT_TOTALS.suv.jfk));
    assert.deepEqual(await page.$$eval(".bk-card__price .bk-fig", (o) => o.map((x) => x.textContent)), ["$185.00", "$220.00", "$310.00", "$170.00", "$450.00", "$575.00", "$650.00", "$700.00", "$750.00"]);
    assert.equal(await page.isDisabled("#bk-next"), false);
    await bags(page, MAX_BAGS, 0);
    assert.equal(await page.getAttribute('[aria-label="More large suitcases"]', "aria-disabled"), "true");
    const ink = () => page.$$eval("#bk-bags .bk-stepper output", (o) => o.map((x) => getComputedStyle(x).color));
    const calm = await ink();
    await page.click('[aria-label="More large suitcases"]', { force: true });
    assert.deepEqual(await ink(), calm, "the bag counts keep their color, only the message is red");
    assert.equal(await page.inputValue("#bk-bags-large"), String(MAX_BAGS));
    assert.deepEqual(await page.evaluate(() => [document.getElementById("e-bags").classList.contains("is-on"), document.getElementById("e-bags").textContent, document.getElementById("bk-bags").getAttribute("aria-invalid")]), [true, ERRORS.bags.text, "true"]);
    await page.click('[aria-label="Fewer large suitcases"]');
    assert.deepEqual(await page.evaluate(() => [document.getElementById("e-bags").classList.contains("is-on"), document.getElementById("bk-bags").getAttribute("aria-invalid")]), [false, null]);
    await bags(page, 4, 2);
  });
  await check(`BG13 ${width}: with 3 large bags every clicked car card stays under the pointer, the note shows right after a newly chosen card that is too small, a larger car hides it but keeps its space, and the next bag change lets that space go`, async () => {
    await pick(page, "suv");
    await priced(page);
    await bags(page, 3, 0);
    await noteIs(page, { shown: false, keep: false, h: 0 });
    await pickStill(page, "first");
    await noteIs(page, { shown: true, keep: false, after: "bk-c-first" });
    assert.equal(await page.textContent("#bk-bagfit"), NOTE);
    await pickStill(page, "sedan");
    assert.equal((await noteState(page)).shown, true, "the Sedan & Electric holds no more than First Class");
    await pickStill(page, "sprinter-luxury-jet");
    const kept = await noteState(page);
    assert.ok(!kept.shown && kept.keep && kept.h > 0, JSON.stringify(kept));
    await pickStill(page, "premium");
    assert.equal((await noteState(page)).shown, false);
    await pickStill(page, "first");
    assert.equal((await noteState(page)).shown, true);
    await pickStill(page, "sedan");
    await pickStill(page, "suv");
    await page.click('[aria-label="Fewer large suitcases"]');
    await noteIs(page, { shown: false, keep: false, h: 0 });
    assert.deepEqual(page.errors, []);
  });
  await check(`BG14 ${width}: when no car holds the bags, as on the Luxury Sprinter with ${ROOM.sprinter[0] + 1} large bags, or ${ROOM.sprinter[0] + ROOM.sprinter[1] + 1} medium bags, or any car with ${MAX_BAGS} of each, the note says so and the status line speaks it, and fewer bags take it back`, async () => {
    await pick(page, "sprinter-presidential");
    await priced(page);
    await bags(page, ROOM.sprinter[0] + 1, 0);
    assert.equal(await noteShown(page), true);
    assert.equal(await page.textContent("#bk-bagfit"), NONE);
    assert.equal(await status(page), NONE);
    await bags(page, ROOM.sprinter[0], 0);
    assert.equal(await noteShown(page), false);
    await bags(page, 0, 0, ROOM.sprinter[0] + ROOM.sprinter[1] + 1);
    assert.equal(await page.textContent("#bk-bagfit"), NONE, "medium suitcases past the largest total");
    await bags(page, 0, 0, ROOM.sprinter[0] + ROOM.sprinter[1]);
    assert.equal(await noteShown(page), false);
    await bags(page, ROOM.sprinter[0], 0, 0);
    assert.notEqual(await status(page), NONE);
    await pick(page, "suv");
    await priced(page);
    assert.equal(await page.textContent("#bk-bagfit"), NOTE);
    assert.equal(await status(page), NOTE);
    await bags(page, MAX_BAGS, MAX_BAGS, MAX_BAGS);
    assert.equal(await page.textContent("#bk-bagfit"), NONE);
    assert.equal(await status(page), NONE);
    await bags(page, 4, 2);
    assert.equal(await page.textContent("#bk-bagfit"), NOTE);
    assert.deepEqual(page.errors, []);
  });
  await check(`BG5 ${width}: the WhatsApp message carries one line per bag size right after Passengers with no server call, and the server's message after a passenger change says the same`, async () => {
    const before = ctx.api.length;
    await bags(page, 4, 2, 1);
    await waFor(page, "\nPassengers: 2\nLarge suitcase: 4\nMedium suitcase: 1\nSmall suitcase or hand carry: 2\nVehicle: Business SUV");
    await bags(page, 0, 1);
    const one = await waFor(page, "\nPassengers: 2\nSmall suitcase or hand carry: 1\nVehicle: ");
    assert.ok(!one.includes("Large suitcase") && !one.includes("Medium suitcase"), one);
    assert.equal(ctx.api.length, before, "the messages change with no server call");
    await page.click('[aria-label="More passengers"]');
    await page.waitForFunction(() => /Passengers: 3/.test(decodeURIComponent(document.querySelector(".site-footer a[data-wa]").getAttribute("href"))));
    await priced(page);
    await waFor(page, "\nPassengers: 3\nSmall suitcase or hand carry: 1\n");
    await page.click('[aria-label="Fewer passengers"]');
    await priced(page);
    await bags(page, 4, 2, 3);
    await waFor(page, "\nPassengers: 2\nLarge suitcase: 4\nMedium suitcase: 3\nSmall suitcase or hand carry: 2\n");
  });
  await check(`BG6 ${width}: Check your trip has a Bags row after Passengers with its Change button, which goes back to step 2 with focus on the large suitcases, and no Bags row without bags`, async () => {
    await bags(page, 4, 2, 1);
    await page.click("#bk-next");
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    const rows = await page.$$eval("#bk-check-rows > div", (o) => o.map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent, (d.querySelector("button") || {}).textContent || ""]));
    const at = rows.findIndex(([t]) => t === "Passengers");
    assert.deepEqual(rows.slice(at, at + 3).map((r) => r.slice(0, 3)), [["Passengers", "2", "Change passengers"], ["Bags", "4 large, 1 medium, 2 small", "Change bags"], ["Car", rows[at + 2][1], "Change car"]]);
    await page.click('#bk-check-rows button[data-c="bags"]');
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("aria-label") === "Fewer large suitcases");
    await bags(page, 0, 0);
    await page.click("#bk-next");
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    assert.ok(!(await page.$$eval("#bk-check-rows dt", (o) => o.map((x) => x.textContent))).includes("Bags"));
  });
  await check(`BG7 ${width}: paying sends the three counts, the confirmation page shows them in a Bags row after the car and keeps them in its saved state, and Book the return trip carries them`, async () => {
    await page.click("#bk-back");
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options");
    await bags(page, 4, 2, 1);
    await page.click("#bk-next");
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "details");
    for (const [k, v] of Object.entries(ME)) await page.fill(`#bk-${k}`, v);
    const [post] = await Promise.all([page.waitForRequest((r) => r.url().endsWith("/api/book") && JSON.parse(r.postData() || "{}").action === "pay"), page.waitForURL(/\/booking-confirmed\?session_id=cs_mock_/), page.click("#bk-submit")]);
    const sent = JSON.parse(post.postData());
    assert.deepEqual([sent.large_bags, sent.medium_bags, sent.small_bags, sent.passengers], ["4", "1", "2", "2"]);
    await page.waitForSelector("#cf-receipt", { state: "visible" });
    await page.waitForSelector("#cf-trip:not([hidden])");
    const rows = await page.$$eval("#cf-rows > div", (o) => o.map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]));
    const car = rows.findIndex(([t]) => t === "Car");
    assert.deepEqual(rows[car + 1], ["Bags", "4 large, 1 medium, 2 small"], JSON.stringify(rows));
    assert.equal(await page.textContent("#cf-total"), cash(AIRPORT_TOTALS.suv.jfk));
    const stored = await page.evaluate(() => [JSON.parse(sessionStorage.getItem("nlr-book")).fields, JSON.parse(sessionStorage.getItem("nlr-cf")).b.fields]);
    for (const f of stored) assert.deepEqual([f.large_bags, f.medium_bags, f.small_bags], ["4", "1", "2"]);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#cf-trip:not([hidden])");
    assert.ok((await page.$$eval("#cf-rows dt", (o) => o.map((x) => x.textContent))).includes("Bags"), "the saved state shows them again after a reload");
    await Promise.all([page.waitForURL(/\/book#trip/), page.click("#cf-return")]);
    await page.waitForFunction(() => document.getElementById("bk-from").value.includes("350 5th Ave"));
    assert.deepEqual([await page.inputValue("#bk-bags-large"), await page.inputValue("#bk-bags-medium"), await page.inputValue("#bk-bags-small")], ["4", "1", "2"]);
    assert.deepEqual(page.errors, []);
  });
  if (page) await page.close();
  await ctx.close();
}

for (const [width, height] of [[1024, 768], [1280, 800], [1366, 768]]) {
  const ctx = await context({ width, height });
  await check(`BG12 ${width} by ${height}: ${width < 1280 ? "on a narrow desktop the bag rows stack under the passengers hint, steppers at the right edge of the passengers, clear of the cars" : "the bag steppers sit beside the passengers hints, every class price up to the Executive Sprinter stays inside the first screen and the other Sprinter prices follow below"}, with CLS 0 and no horizontal scroll`, async () => {
    const page = await options(ctx);
    await page.evaluate(() => scrollTo(0, 0));
    const r = await layout(page);
    assert.ok(r.bags.b <= r.cards.t && r.head.b <= r.bags.t, JSON.stringify(r));
    if (width < 1280) {
      assert.ok(r.hint.b <= r.bags.t && r.fields[0].b <= r.fields[1].t && r.fields[1].b <= r.fields[2].t && [1, 2, 3].every((i) => Math.abs(r.steppers[i].r - r.steppers[0].r) <= 1), JSON.stringify(r));
    } else {
      sideBySide(r);
      const prices = await page.$$eval(".bk-card__price", (o) => o.map((x) => Math.round(x.getBoundingClientRect().bottom)));
      assert.ok(prices.length === 9 && prices.slice(0, 5).every((b) => b <= height) && prices.every((b, i) => !i || b > prices[i - 1]), JSON.stringify(prices));
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true);
    const [value, shifts] = await cls(page);
    assert.equal(value, 0, shifts.join(" | "));
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}

for (const [width, height] of [[320, 640], [360, 740]]) {
  const ctx = await context({ width, height });
  await check(`BG16 ${width} by ${height}: on a small phone each size name sits on the row of its stepper, wrapping onto two lines if it must, and the three bag steppers line up at the right edge of the Passengers row, with no horizontal scroll`, async () => {
    const page = await options(ctx);
    const r = await layout(page);
    const [, large, medium, small] = r.steppers;
    assert.ok(r.bags.b <= r.cards.t && r.hint.b <= r.bags.t && r.fields[0].b <= r.fields[1].t && r.fields[1].b <= r.fields[2].t, JSON.stringify(r));
    assert.ok([large, medium, small].every((x) => Math.abs(x.r - r.pax.r) <= 1), JSON.stringify(r.steppers));
    assert.ok(r.labels.every((l, i) => Math.abs((l.t + l.b) / 2 - (r.steppers[i + 1].t + r.steppers[i + 1].b) / 2) <= 2), `each size name is on the row of its stepper: ${JSON.stringify(r.labels)}`);
    assert.ok(r.labels.every((l, i) => l.r <= r.steppers[i + 1].l), `each size name stays clear of its stepper: ${JSON.stringify(r.labels)}`);
    assert.ok(r.buttons.every((b) => b.w === 44 && b.h === 44 && b.l >= 0 && b.r <= r.vw), JSON.stringify(r.buttons));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}

for (const [width, height] of [[600, 900], [768, 1024], [1023, 800]]) {
  const ctx = await context({ width, height });
  await check(`BG15 ${width} by ${height}: the bag rows are as wide as the Passengers row, so the three bag steppers line up with the passengers stepper, each size name on its stepper row, clear of the cars, with no horizontal scroll`, async () => {
    const page = await options(ctx);
    const r = await layout(page);
    assert.ok(r.bags.b <= r.cards.t && r.hint.b <= r.bags.t && r.fields[0].b <= r.fields[1].t && r.fields[1].b <= r.fields[2].t, JSON.stringify(r));
    assert.ok([1, 2, 3].every((i) => Math.abs(r.steppers[i].r - r.steppers[0].r) <= 1), JSON.stringify(r.steppers));
    assert.ok(r.fields.every((f) => f.h <= 48), `each size name stays on its stepper row: ${JSON.stringify(r.fields)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}

{
  const ctx = await context({ width: 390, height: 844 });
  await check("BG8 deep links: the options link from the homepage form carries large_bags, medium_bags and small_bags, a readable link takes large-bags, medium-bags and small-bags, and a value out of range falls back to 0", async () => {
    const page = await options(ctx, { large_bags: "3", medium_bags: "2", small_bags: "1" });
    assert.deepEqual(await counts(page), [["3", "3"], ["2", "2"], ["1", "1"]]);
    await waFor(page, "\nPassengers: 2\nLarge suitcase: 3\nMedium suitcase: 2\nSmall suitcase or hand carry: 1\n");
    await page.goto(`${P.base}/book?pickup=JFK&dropoff=Brooklyn&passengers=2&large-bags=2&medium-bags=4&small-bags=5`, { waitUntil: "load" });
    assert.equal(new URL(page.url()).search, "");
    assert.deepEqual([await page.inputValue("#bk-bags-large"), await page.inputValue("#bk-bags-medium"), await page.inputValue("#bk-bags-small")], ["2", "4", "5"]);
    await page.goto(`${P.base}/book?pickup=JFK&large-bags=99&medium-bags=15&small-bags=x`, { waitUntil: "load" });
    assert.deepEqual([await page.inputValue("#bk-bags-large"), await page.inputValue("#bk-bags-medium"), await page.inputValue("#bk-bags-small")], ["0", "0", "0"]);
    const over = await options(ctx, { large_bags: "15", medium_bags: "15" });
    assert.deepEqual([await over.inputValue("#bk-bags-large"), await over.inputValue("#bk-bags-medium")], ["0", "0"]);
    assert.deepEqual([...page.errors, ...over.errors], []);
  });
  await check("BG11 a trip our dispatch team prices: Email to reserve and WhatsApp to reserve take the server's message with its reference and put the current bag counts right after Passengers, with no server call on a bag change", async () => {
    const page = await open(ctx, `/book?${new URLSearchParams({ ...TRIP, to_text: "LaGuardia (LGA)", to_id: "lga" })}`);
    await page.waitForFunction(() => document.getElementById("book-form").dataset.step === "options" && /Reference: /.test(decodeURIComponent(document.getElementById("q-wa").getAttribute("href") || "")));
    const before = ctx.api.length;
    await bags(page, 2, 3, 1);
    const read = (id) => page.evaluate((i) => decodeURIComponent(document.getElementById(i).getAttribute("href").split(/[?&](?:text|body)=/)[1]), id);
    await page.waitForFunction(() => /\nPassengers: 2\nLarge suitcase: 2\nMedium suitcase: 1\nSmall suitcase or hand carry: 3\n/.test(decodeURIComponent(document.getElementById("q-wa").getAttribute("href"))));
    for (const id of ["q-wa", "q-mail"]) {
      const text = await read(id);
      assert.ok(/^Hi NYC LUX RIDE, I would like to book this trip\.\nReference: \d{8}\n/.test(text) && text.includes("\nPassengers: 2\nLarge suitcase: 2\nMedium suitcase: 1\nSmall suitcase or hand carry: 3\nVehicle: ") && text.split("Large suitcase").length === 2 && text.split("Medium suitcase").length === 2, `${id}: ${text}`);
    }
    await bags(page, 0, 0);
    await page.waitForFunction(() => !/suitcase/.test(decodeURIComponent(document.getElementById("q-wa").getAttribute("href"))));
    assert.ok((await read("q-mail")).includes("\nPassengers: 2\nVehicle: "));
    assert.equal(ctx.api.length, before);
    assert.deepEqual(page.errors, []);
  });
  await check("BG9 the homepage form hands its bag counts to the booking page", async () => {
    const page = await open(ctx, "/");
    await page.evaluate(() => { for (const [k, v] of [["large", "2"], ["medium", "4"], ["small", "3"]]) { const s = document.getElementById(`bk-bags-${k}`); s.value = v; } });
    const href = await page.evaluate(() => "/book?" + new URLSearchParams({ ...Object.fromEntries(new FormData(document.getElementById("book-form"))) }));
    assert.ok(/large_bags=2/.test(href) && /medium_bags=4/.test(href) && /small_bags=3/.test(href), href);
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}

{
  const ctx = await context({ width: 390, height: 844 }, { javaScriptEnabled: false });
  await check("BG10 without JavaScript the three bag selects show with their labels and 0 chosen, level at the bottom, the note never shows, a booking posts the three counts, and /book#e-bags shows the bags message", async () => {
    const page = await open(ctx, "/book");
    assert.deepEqual(await page.evaluate(() => ["large", "medium", "small"].map((k) => { const s = document.getElementById(`bk-bags-${k}`); return [s.offsetHeight > 0, s.value, s.labels[0].textContent]; })), [[true, "0", "Large suitcase"], [true, "0", "Medium suitcase"], [true, "0", "Small suitcase or hand carry"]]);
    const bottoms = await page.evaluate(() => ["large", "medium", "small"].map((k) => Math.round(document.getElementById(`bk-bags-${k}`).getBoundingClientRect().bottom)));
    assert.ok(bottoms.every((b) => b === bottoms[0]), `the selects line up: ${bottoms}`);
    assert.equal(await page.evaluate(() => document.getElementById("bk-bagfit").offsetHeight), 0);
    await page.goto(`${P.base}/book#e-bags`, { waitUntil: "load" });
    assert.deepEqual(await page.evaluate(() => { const e = document.getElementById("e-bags"); return [e.offsetHeight > 0, e.textContent]; }), [true, ERRORS.bags.text]);
    const res = await page.request.post(`${P.base}/api/book`, { form: { ...TRIP, action: "", large_bags: "3", medium_bags: "1", small_bags: "2", class: "suv", rider: "me", ...ME, reach: "phone", nonce: "nonce-bags-nojs-00000001" }, headers: { accept: "text/html", origin: P.base }, maxRedirects: 0 });
    assert.equal(res.status(), 303);
    assert.match(res.headers().location, /^\/booking-confirmed\?session_id=cs_mock_/);
    const bad = await page.request.post(`${P.base}/api/book`, { form: { ...TRIP, large_bags: "15", class: "suv" }, headers: { accept: "text/html", origin: P.base }, maxRedirects: 0 });
    assert.equal(bad.headers().location, "/book#e-bags");
    const badMedium = await page.request.post(`${P.base}/api/book`, { form: { ...TRIP, medium_bags: "15", class: "suv" }, headers: { accept: "text/html", origin: P.base }, maxRedirects: 0 });
    assert.equal(badMedium.headers().location, "/book#e-bags");
  });
  await ctx.close();
}

await browser.close();
if (failures) {
  console.error(`\n${failures} bags browser check(s) failed`);
  process.exit(1);
}
console.log("\nAll bags browser checks passed");
process.exit(0);
