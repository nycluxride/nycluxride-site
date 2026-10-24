import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const ENV_KEYS = ["BOOK_MOCK", "PAYMENTS_ENABLED", "PAY_BLACKOUT_DATES", "STRIPE_SECRET_KEY", "VERCEL_ENV", "GOOGLE_MOCK", "FLIGHT_MOCK", "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_SIGNING_SECRET", "FLIGHT_API_KEY", "PLACE_TICKET_SECRET"];
const HOSTS = ["/", "/book", "/locations/manhattan", "/locations/jfk-airport", "/services"];
const SIZES = [[768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]];

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
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${base}/robots.txt`)).ok) return { base, child };
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error("dev server did not start");
}
const S = await serve({ BOOK_MOCK: "true", PAYMENTS_ENABLED: "true", GOOGLE_MOCK: "true", FLIGHT_MOCK: "true" });
process.on("exit", () => S.child.kill());

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

const PROBE = () => {
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
const BOXES = () => {
  const f = document.getElementById("book-form");
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height].map(Math.round).join(); };
  const before = (s) => [...document.querySelectorAll(s)].find((e) => e.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { eyebrow: r(before("main .eyebrow")), h1: r(document.querySelector("main h1")), lede: r(before("main :is(.lede,.hero__tags--svc)")), mode: r(document.getElementById("bk-mode")), bar: r(document.getElementById("bk-search")) };
};
const PANEL = (id) => {
  const p = document.getElementById(id), f = p.parentElement, a = p.getBoundingClientRect(), b = f.getBoundingClientRect();
  const h = document.querySelector(".site-header").getBoundingClientRect().bottom, v = visualViewport;
  const hit = document.elementFromPoint(a.left + a.width / 2, a.top + Math.min(a.height / 2, 40));
  const cs = getComputedStyle(p);
  return {
    open: !p.hidden, top: p.matches(":popover-open"), gap: Math.round(a.top - b.bottom), left: Math.round(a.left - b.left), right: Math.round(a.right - b.right), width: Math.round(a.width), field: Math.round(b.width),
    inside: a.left >= 0 && a.right <= document.documentElement.clientWidth && a.top >= h - 1 && a.bottom <= v.offsetTop + v.height + 1, above: !!hit && p.contains(hit), radius: cs.borderTopLeftRadius, border: [cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor].join(" "),
  };
};
const idle = (page) => page.waitForFunction(() => new Promise((ok) => { let y = scrollY, n = 0; const t0 = performance.now(); const t = () => (scrollY === y ? ++n : ((y = scrollY), (n = 0)), n > 12 && performance.now() - t0 > 250 ? ok(true) : requestAnimationFrame(t)); requestAnimationFrame(t); }), null, { timeout: 6000 });
const quiet = (page, id) => page.waitForFunction((i) => document.getElementById(i).getAnimations().every((a) => a.playState !== "running"), id, { timeout: 4000 });
async function fresh(page) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo({ top: 0, behavior: "instant" }); });
  await idle(page);
}

const ENGINES = [["chromium", await chromium.launch()]];
for (const [name, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (b) ENGINES.push([name, b]);
  else console.log(`  ..   ${name} is not installed here, the panel checks run in the other engines only`);
}

for (const [name, b] of ENGINES) {
  for (const [width, height] of SIZES) {
    const ctx = await b.newContext({ viewport: { width, height }, reducedMotion: "no-preference" });
    await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
    await ctx.addInitScript(PROBE);
    for (const path of HOSTS) {
      await check(`${name} ${path} at ${width} by ${height}: the hero holds still, the pickup list, the drop-off list, the calendar and the time picker open as panels under their fields, inside the window and above the page, and Escape closes them with focus kept`, async () => {
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${S.base}${path}`, { waitUntil: "load" });
        await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
        await page.waitForTimeout(300);
        const seen = [];
        for (const [opener, id, focus] of [["#bk-from", "bk-from-pop", "bk-from"], ["#bk-to", "bk-to-pop", "bk-to"], ["#bk-date-btn", "bk-cal", "bk-date-btn"], ["#bk-time-btn", "bk-tm", "bk-time-btn"]]) {
          await fresh(page);
          const still = await page.evaluate(BOXES);
          await page.click(opener);
          if (id === "bk-to-pop" && !(await page.waitForFunction(() => !document.getElementById("bk-to-pop").hidden, null, { timeout: 600 }).catch(() => null))) await page.keyboard.type("grand");
          await page.waitForFunction((i) => !document.getElementById(i).hidden, id);
          await quiet(page, id);
          await idle(page);
          const s = await page.evaluate(PANEL, id);
          seen.push(id);
          assert.deepEqual(await page.evaluate(BOXES), still, `${id}: the eyebrow, headline, lede, switch and bar keep their places`);
          assert.ok(s.top && s.gap >= 0 && s.gap <= 8 && s.width >= s.field - 1 && s.inside && s.above, `${id}: ${JSON.stringify(s)}`);
          if (id.endsWith("-pop")) assert.ok(s.left === 0 && s.width >= Math.min(420, width - 32) && s.width <= Math.max(560, s.field), `${id} starts at the field and is wide enough for the rows: ${JSON.stringify(s)}`);
          else if (id === "bk-tm") assert.ok(Math.abs(s.right) <= 1, `the time picker lines up with the end of its field: ${s.right}`);
          else assert.ok(Math.abs(s.left) <= 1, `the calendar lines up with the start of its field: ${s.left}`);
          await page.keyboard.press("Escape");
          await page.waitForFunction((i) => document.getElementById(i).hidden, id);
          await quiet(page, id);
          assert.equal(await page.evaluate(() => document.activeElement.id), focus, `${id}: Escape returns focus to the field`);
          assert.equal(await page.evaluate((i) => document.getElementById(i).matches(":popover-open"), id), false, `${id} leaves the top layer once it has faded`);
          if (id.endsWith("-pop")) await page.keyboard.press("Escape");
        }
        assert.deepEqual(seen.length, 4);
        const [v, shifts] = await page.evaluate(() => [window.__cls, window.__shifts]);
        assert.ok(v < 0.001, `CLS ${v} ${shifts.join(" | ")}`);
        assert.deepEqual(errors, []);
        await page.close();
      });
    }
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  for (const motion of ["no-preference", "reduce"]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: motion });
    await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
    await check(`${name}: with ${motion} motion the panels fade and slide 4 px in about 150 ms ${motion === "reduce" ? "with no transition, and the page jumps to show the calendar at once" : "each way, and the page scrolls smoothly by the least amount that shows the calendar"}`, async () => {
      const page = await ctx.newPage();
      await page.goto(`${S.base}/`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      const t = await page.evaluate(() => [...document.querySelectorAll(".bk-pop,.bk-cal")].map((e) => { const s = getComputedStyle(e); return [s.transitionProperty, s.transitionDuration.split(", ").map(parseFloat).join("/")]; }));
      assert.ok(t.every(([p, d]) => (motion === "reduce" ? d.split("/").every((x) => +x <= 0.001) : p === "opacity, translate" && d.split("/").every((x) => +x === 0.15))), JSON.stringify(t));
      await page.evaluate(() => scrollTo({ top: Math.max(0, document.getElementById("bk-search").getBoundingClientRect().bottom + scrollY + 24 - innerHeight), behavior: "instant" }));
      const y00 = await page.evaluate(() => scrollY);
      await page.click("#bk-date-btn");
      const y0 = await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(scrollY)))));
      await idle(page);
      const y = await page.evaluate(() => scrollY);
      const fit = await page.evaluate(() => { const c = document.getElementById("bk-cal").getBoundingClientRect(); return Math.round(innerHeight - c.bottom); });
      assert.ok(y > y00 && fit >= 8 && fit <= 24, `scrolled from ${y00} to ${y}, the calendar ends ${fit} px above the window bottom`);
      if (motion === "reduce") assert.equal(y0, y, "no smooth scroll with reduced motion");
      else assert.ok(y0 < y, `a smooth scroll: ${y0} after two frames, ${y} at rest`);
      if (motion !== "reduce") {
        await page.keyboard.press("Escape");
        const mid = await page.evaluate(() => { const c = document.getElementById("bk-cal"), s = getComputedStyle(c); return [c.hidden, c.matches(":popover-open"), s.display, c.getAnimations().some((a) => a.transitionProperty === "opacity" && a.playState === "running")]; });
        assert.deepEqual(mid, [true, true, "grid", true], "on close the panel fades out in place in the top layer");
        const out = await page.waitForFunction(() => { const c = document.getElementById("bk-cal"); return !c.matches(":popover-open") && getComputedStyle(c).display; });
        assert.equal(await out.jsonValue(), "none", "once out of the top layer the faded panel is gone at once");
      }
      await page.close();
    });
    await ctx.close();
  }
}

{
  const [, b] = ENGINES[0];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, forcedColors: "active", reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check("forced colors: the pickup list, the calendar and the time picker show a CanvasText border on the hero and on /book", async () => {
    for (const path of ["/", "/book"]) {
      const page = await ctx.newPage();
      await page.goto(`${S.base}${path}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      const out = [];
      for (const [opener, id] of [["#bk-from", "bk-from-pop"], ["#bk-date-btn", "bk-cal"], ["#bk-time-btn", "bk-tm"]]) {
        await fresh(page);
        await page.click(opener);
        await page.waitForFunction((i) => !document.getElementById(i).hidden, id);
        out.push(await page.evaluate((i) => { const s = getComputedStyle(document.getElementById(i)); return [s.borderTopStyle, parseFloat(s.borderTopWidth) >= 1, !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(s.borderTopColor)]; }, id));
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
      assert.deepEqual(out, [["solid", true, true], ["solid", true, true], ["solid", true, true]], path);
      await page.close();
    }
  });
  await ctx.close();
}

{
  const [, b] = ENGINES[0];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check("keyboard on /: the pickup combobox opens its listbox panel, ArrowDown and Enter pick JFK, focus moves to the drop-off, typing opens its panel under it, Tab closes it", async () => {
    const page = await ctx.newPage();
    await page.goto(`${S.base}/`, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    await page.evaluate(() => document.querySelector("#bk-mode input:checked").focus({ preventScroll: true }));
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => !document.getElementById("bk-from-pop").hidden);
    const a = await page.evaluate(() => { const i = document.getElementById("bk-from"); return [document.activeElement.id, i.getAttribute("role"), i.getAttribute("aria-expanded"), i.getAttribute("aria-controls"), document.getElementById("bk-from-list").getAttribute("role"), document.getElementById("bk-from-pop").matches(":popover-open")]; });
    assert.deepEqual(a, ["bk-from", "combobox", "true", "bk-from-list", "listbox", true]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement.id === "bk-to");
    const t = await page.evaluate(() => [document.getElementById("bk-from").value, document.getElementById("bk-from-pop").hidden, document.getElementById("bk-from-pop").matches(":popover-open")]);
    assert.deepEqual(t, ["John F. Kennedy (JFK)", true, false]);
    await page.keyboard.type("grand");
    await page.waitForFunction(() => !document.getElementById("bk-to-pop").hidden);
    const s = await page.evaluate(PANEL, "bk-to-pop");
    assert.ok(s.top && s.gap >= 0 && s.gap <= 8 && s.inside, JSON.stringify(s));
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => document.getElementById("bk-to-pop").hidden);
    assert.equal(await page.evaluate(() => document.getElementById("bk-to-pop").matches(":popover-open")), false);
    await page.close();
  });
  await ctx.close();
}

{
  const [, b] = ENGINES[0];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check("phones below 768 keep the list in the page flow, out of the top layer", async () => {
    for (const path of ["/", "/locations/manhattan", "/book"]) {
      const page = await ctx.newPage();
      await page.goto(`${S.base}${path}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await page.click("#bk-from");
      await page.waitForFunction(() => !document.getElementById("bk-from-pop").hidden);
      assert.deepEqual(await page.evaluate(() => { const p = document.getElementById("bk-from-pop"); return [p.matches(":popover-open"), getComputedStyle(p).position, Math.round(p.getBoundingClientRect().width) === Math.round(p.parentElement.getBoundingClientRect().width)]; }), [false, "absolute", true], path);
      await page.close();
    }
  });
  await ctx.close();
}

for (const [name, b] of ENGINES.filter(([n]) => n !== "firefox")) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check(`${name}: on a 390 phone the pickup list, a plain element outside the top layer, fades out in the page flow when it closes`, async () => {
    const page = await ctx.newPage();
    await page.goto(`${S.base}/`, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    await page.click("#bk-from");
    await page.waitForFunction(() => !document.getElementById("bk-from-pop").hidden);
    await quiet(page, "bk-from-pop");
    await page.keyboard.press("Escape");
    const mid = await page.evaluate(() => { const p = document.getElementById("bk-from-pop"), s = getComputedStyle(p); return [p.hidden, p.hasAttribute("popover"), s.display, p.getAnimations().some((a) => a.transitionProperty === "opacity" && a.playState === "running")]; });
    assert.deepEqual(mid, [true, false, "grid", true]);
    await page.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check(`${name}: an open time picker follows its field when the window is resized, drops back into the page flow below 768 and keeps focus on its time`, async () => {
    const page = await ctx.newPage();
    await page.goto(`${S.base}/`, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    await page.click("#bk-time-btn");
    await page.waitForFunction(() => document.activeElement.getAttribute("role") === "option");
    const v = await page.evaluate(() => document.activeElement.dataset.v);
    const at = () => page.evaluate(() => { const p = document.getElementById("bk-tm"), a = p.getBoundingClientRect(), f = p.parentElement.getBoundingClientRect(); return [p.matches(":popover-open"), Math.round(a.top - f.bottom), Math.abs(a.right - f.right) <= 1, document.activeElement.dataset.v]; });
    await page.setViewportSize({ width: 1300, height: 860 });
    await page.waitForTimeout(300);
    assert.deepEqual(await at(), [true, 4, true, v], "after a resize");
    await page.setViewportSize({ width: 700, height: 860 });
    await page.waitForTimeout(300);
    assert.deepEqual(await at(), [false, 4, true, v], "below 768");
    await page.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check(`${name} on /: the page scrolling under a still mouse as the pickup list opens lights no row, so Enter keeps JFK, and a real mouse move lights the row under it`, async () => {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const lit = () => page.evaluate(() => document.getElementById("bk-from").getAttribute("aria-activedescendant"));
    for (const step of ["still", "move"]) {
      await page.goto(`${S.base}/`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await page.waitForTimeout(300);
      await page.click("#bk-from");
      await page.waitForFunction(() => !document.getElementById("bk-from-pop").hidden);
      await quiet(page, "bk-from-pop");
      await idle(page);
      await page.waitForTimeout(300);
      if (step === "still") {
        assert.deepEqual([await page.evaluate(() => scrollY > 0), await lit()], [true, null], "the opening scroll lights no row");
        await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.getElementById("bk-from").value), "John F. Kennedy (JFK)");
      } else {
        const [x, y] = await page.evaluate(() => { const r = document.getElementById("bk-from-o1").getBoundingClientRect(); return [r.left + 24, r.top + r.height / 2]; });
        await page.mouse.move(x, y, { steps: 4 });
        assert.equal(await lit(), "bk-from-o1", "moving the mouse lights the row under it");
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  for (const [width, height, motion] of [[1024, 768, "no-preference"], [1440, 900, "no-preference"], [1920, 1080, "no-preference"], [1440, 900, "reduce"]]) {
    const ctx = await b.newContext({ viewport: { width, height }, reducedMotion: motion });
    await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
    await check(`${name} / at ${width} by ${height} with ${motion} motion: typing jfk shows no flight row until JFK is picked, then the row comes while the headline, the two lines under it, the bar and the photo keep their places and the hero grows down on its floor, and clearing the pickup puts it back`, async () => {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${S.base}/`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await page.waitForTimeout(300);
      const at = () => page.evaluate(() => {
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top + scrollY) || 0, Math.round(b.height)]; };
        const f = document.querySelector(".hero__photo"), fb = f.getBoundingClientRect(), i = f.querySelector("picture img"), c = getComputedStyle(f).clipPath.match(/[\d.]+px\)$/);
        const end = getComputedStyle(i).position === "fixed" ? fb.bottom - (c ? parseFloat(c[0]) : 0) : i.getBoundingClientRect().bottom;
        return { h1: r("main h1"), tags: [r(".hero__tags"), r(".hero__tags--svc")], form: r("#book-form"), hero: r(".hero"), figure: r(".hero__photo"), photo: [Math.round(end + scrollY), Math.round(fb.top + scrollY) || 0] };
      });
      const a = await at();
      await page.click("#bk-from");
      await page.keyboard.type("jfk", { delay: 100 });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.getElementById("bk-flight-f").classList.contains("is-shown")), false, "the flight row shows while jfk is still being typed");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.getElementById("bk-flight-f").classList.contains("is-shown"));
      await idle(page);
      await quiet(page, "bk-flight-f");
      const g = await at();
      assert.deepEqual([g.h1, g.tags, g.form[0], g.photo], [a.h1, a.tags, a.form[0], a.photo], "nothing above the flight row moves, and the photo starts and ends where it did");
      assert.ok(g.form[1] > a.form[1] && g.hero[0] === a.hero[0] && g.hero[1] - a.hero[1] === g.form[1] - a.form[1], `the hero grows down with the bar: ${JSON.stringify([a, g])}`);
      assert.deepEqual(g.figure, g.hero, "the photo figure still spans the whole hero");
      await page.click("#bk-from-x");
      await page.waitForFunction(() => !document.getElementById("bk-flight-f").classList.contains("is-shown"));
      await idle(page);
      assert.deepEqual(await at(), a, "clearing the pickup puts everything back");
      assert.deepEqual(errors, []);
      await page.close();
    });
    await ctx.close();
  }
}

for (const [name, b] of ENGINES) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check(`${name}: on / and /book at 1280 by 800 an open pickup list closes once its field has scrolled under the sticky header, is never drawn over the header, and opens whole again from the field once scrolled back`, async () => {
    for (const path of ["/", "/book"]) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${S.base}${path}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      await page.click("#bk-from");
      await page.waitForFunction(() => !document.getElementById("bk-from-pop").hidden);
      await idle(page);
      const y0 = await page.evaluate(() => scrollY);
      await page.evaluate(() => scrollBy({ top: document.getElementById("bk-from-pop").getBoundingClientRect().top - document.querySelector(".site-header").getBoundingClientRect().bottom + 24, behavior: "instant" }));
      await idle(page);
      const s = await page.evaluate(() => {
        const p = document.getElementById("bk-from-pop"), f = document.getElementById("bk-from-f").getBoundingClientRect(), h = document.querySelector(".site-header"), hb = h.getBoundingClientRect().bottom, up = document.elementFromPoint(f.left + 24, hb - 4), down = document.elementFromPoint(f.left + 24, hb + 8);
        return { hidden: p.hidden, open: p.matches(":popover-open"), field: Math.round(hb - f.bottom), header: !!up && h.contains(up), list: !!down && p.contains(down) };
      });
      assert.ok(s.hidden && !s.open && s.field > 0 && s.header && !s.list, `${path}: ${JSON.stringify(s)}`);
      await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y0);
      await idle(page);
      await page.click("#bk-from");
      await page.waitForFunction(() => !document.getElementById("bk-from-pop").hidden);
      await idle(page);
      assert.equal(await page.evaluate(() => { const p = document.getElementById("bk-from-pop"), a = p.getBoundingClientRect(), e = document.elementFromPoint(a.left + 24, a.top + 8); return !!e && p.contains(e); }), true, `${path}: the whole list shows again`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  });
  await ctx.close();
}

for (const [name, b] of ENGINES) {
  const ctx = await b.newContext({ viewport: { width: 863, height: 360 }, reducedMotion: "reduce" });
  await ctx.route((url) => !url.href.startsWith(S.base), (route) => route.fulfill({ status: 204, body: "" }));
  await check(`${name}: on /book and / at 863 by 360, a phone held sideways, the open calendar stays open while the page scrolls down to its last row, so every bookable day of this month and the next can be tapped, and it closes once it has scrolled whole under the sticky header`, async () => {
    const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const state = (page) => page.evaluate(() => {
      const c = document.getElementById("bk-cal"), h = document.querySelector(".site-header").getBoundingClientRect().bottom;
      if (c.hidden) return null;
      const tap = [...c.querySelectorAll(".bk-cal__day:not([disabled])")].map((x) => [x, x.getBoundingClientRect()]).filter(([x, r]) => { const y = r.top + r.height / 2, e = document.elementFromPoint(r.left + r.width / 2, y); return y > h && y < innerHeight && !!e && x.contains(e); });
      return { tap: tap.map(([x, r]) => [x.dataset.day, r.left + r.width / 2, r.top + r.height / 2]), below: c.getBoundingClientRect().bottom - h };
    });
    for (const path of ["/book", "/"]) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${S.base}${path}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      let first = [];
      for (const month of [0, 1]) {
        await fresh(page);
        await page.click("#bk-date-btn");
        await page.waitForFunction(() => !document.getElementById("bk-cal").hidden);
        if (month) await page.click('#bk-cal .bk-cal__nav[data-dir="1"]');
        await idle(page);
        const days = await page.$$eval("#bk-cal .bk-cal__day:not([disabled])", (o) => o.map((x) => x.dataset.day));
        if (!month) first = days;
        const seen = new Set();
        let s = await state(page), last = s;
        for (let i = 0; s && i < 60; i++) {
          s.tap.forEach(([day]) => seen.add(day));
          last = s;
          await page.evaluate(() => scrollBy({ top: 20, behavior: "instant" }));
          await frames(page);
          s = await state(page);
        }
        assert.deepEqual(days.filter((day) => !seen.has(day)), [], `${path}, month +${month}: these bookable days never came into view under the header while the calendar was open`);
        assert.ok(!s && last.below <= 20, `${path}, month +${month}: ${s ? "the calendar stayed open" : `the calendar closed with ${Math.round(last.below)}px of it still below the header`}`);
      }
      const day = first.at(-1);
      await fresh(page);
      await page.click("#bk-date-btn");
      await page.waitForFunction(() => !document.getElementById("bk-cal").hidden);
      await idle(page);
      let at = null;
      for (let i = 0; !at && i < 60; i++) {
        const s = await state(page);
        if (!s) break;
        at = s.tap.find(([d]) => d === day);
        if (!at) {
          await page.evaluate(() => scrollBy({ top: 20, behavior: "instant" }));
          await frames(page);
        }
      }
      assert.ok(at, `${path}: ${day} could not be reached`);
      await page.mouse.click(at[1], at[2]);
      await page.waitForFunction(() => document.getElementById("bk-cal").hidden);
      assert.equal(await page.inputValue("#bk-date"), day, `${path}: the last bookable day is picked`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  });
  await ctx.close();
}

for (const [, b] of ENGINES) await b.close();
S.child.kill();
if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
process.exit(0);
