import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const WIDTHS = [320, 360, 390, 768, 1024, 1440];
const PAGES = { "/": [".hero__book", 4], "/book": ["#book-form", 4], "/locations/jfk-airport": [".banner__book", 4], "/locations/teterboro-airport": [".banner__book", 3] };
const GOLD_700 = "rgb(133, 104, 35)";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 10).join("\n       ")}`);
  }
}

function resolvePath(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
  for (const c of clean === "/" ? ["index.html"] : [`${clean.slice(1)}.html`, clean.slice(1)]) {
    const full = join(ROOT, c);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}
const server = createServer((req, res) => {
  const file = resolvePath(req.url);
  if (!file) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(ROOT, "404.html")));
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const MEASURE = (above) => {
  const t = document.querySelector("section.trust");
  const r = t.getBoundingClientRect(), a = document.querySelector(above).getBoundingClientRect();
  const lum = (c) => {
    const [r1, g1, b1] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
  };
  const ratio = (fg) => (1 + 0.05) / (lum(fg) + 0.05);
  const items = [...t.querySelectorAll(".trust__list > li")].map((li) => {
    const b = li.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), n: Math.round(li.querySelector(".trust__n").getBoundingClientRect().top), s: Math.round(li.querySelector(".trust__s").getBoundingClientRect().top), inside: b.left >= r.left && b.right <= r.right && b.bottom <= r.bottom, clipped: [...li.querySelectorAll("p")].some((p) => p.scrollWidth > p.clientWidth + 1) };
  });
  const icons = [...t.querySelectorAll("svg.icon")].map((s) => { const cs = getComputedStyle(s); return [Math.round(s.getBoundingClientRect().width * 10) / 10, cs.color, cs.strokeWidth, getComputedStyle(s.querySelector("path")).vectorEffect, s.getAttribute("aria-hidden")]; });
  const seat = document.querySelector(".seats__list .icon");
  return {
    shown: getComputedStyle(t).display !== "none" && r.height > 0,
    gap: Math.round(r.top - a.bottom),
    between: [...document.querySelectorAll("main *")].filter((e) => e !== t && !t.contains(e) && !e.contains(t) && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").filter((e) => { const b = e.getBoundingClientRect(); return b.height > 0 && b.top >= a.bottom - 0.5 && b.bottom <= r.top + 0.5 && b.left < r.right && b.right > r.left; }).map((e) => e.tagName + "." + e.className),
    items,
    icons,
    seat: seat && Math.round(seat.getBoundingClientRect().width * 10) / 10,
    contrast: [...t.querySelectorAll(".trust__h, .trust__n, .trust__s")].map((e) => Math.round(ratio(getComputedStyle(e).color) * 10) / 10),
    font: getComputedStyle(t.querySelector(".trust__h")).fontFamily,
    level: t.querySelector("h2")?.id,
    sideways: document.documentElement.scrollWidth - innerWidth,
  };
};

for (const [engine, type] of [["chromium", chromium], ["webkit", webkit], ["firefox", firefox]]) {
  let browser;
  try {
    browser = await type.launch();
  } catch (err) {
    console.log(`  ..   ${engine} skipped: ${String(err.message).split("\n")[0]}`);
    continue;
  }
  for (const [path, [above, count]] of Object.entries(PAGES)) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
      const p = await ctx.newPage();
      if (engine === "chromium") await p.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      });
      await p.goto(base + path, { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      const m = await p.evaluate(MEASURE, above);
      const one = width >= 600;
      await check(`${engine} ${path} ${width}px: the trust section shows directly below the booking form, ${count} items in page order ${one ? "in one row" : "in two columns"}, nothing clipped or spilling sideways`, () => {
        assert.ok(m.shown, "the section is not shown");
        assert.ok(m.gap >= 12 && m.gap <= 24, `gap ${m.gap}`);
        assert.deepEqual(m.between, []);
        assert.equal(m.items.length, count);
        assert.ok(m.items.every((i) => i.inside && !i.clipped), JSON.stringify(m.items));
        const rows = new Set(m.items.map((i) => i.y));
        if (one) {
          assert.equal(rows.size, 1, JSON.stringify(m.items));
          assert.ok(m.items.every((i, k) => !k || i.x > m.items[k - 1].x), JSON.stringify(m.items));
        }
        else {
          assert.equal(rows.size, Math.ceil(count / 2), JSON.stringify(m.items));
          assert.equal(new Set(m.items.slice(0, count - (count % 2)).map((i) => i.x)).size, 2, JSON.stringify(m.items));
          assert.ok(m.items.every((i, k) => !k || i.y > m.items[k - 1].y || (i.y === m.items[k - 1].y && i.x > m.items[k - 1].x)), JSON.stringify(m.items));
        }
        assert.ok(m.sideways <= 0, `scrolls sideways by ${m.sideways}px`);
      });
      await check(`${engine} ${path} ${width}px: in each row of the trust section the item names start on one line and the lines under them start on one line`, () => {
        for (const y of new Set(m.items.map((i) => i.y))) {
          const row = m.items.filter((i) => i.y === y);
          assert.equal(new Set(row.map((i) => i.n)).size, 1, JSON.stringify(row));
          assert.equal(new Set(row.map((i) => i.s)).size, 1, JSON.stringify(row));
        }
      });
      await check(`${engine} ${path} ${width}px: gold-700 line icons at stroke 1.25 that do not scale the stroke, hidden from screen readers, in the Castoro h2, every text at least 4.5:1 on white`, () => {
        assert.ok(m.icons.every(([w, c, s, v, h]) => w >= 33 && w <= 35 && c === GOLD_700 && s === "1.25px" && v === "non-scaling-stroke" && h === "true"), JSON.stringify(m.icons));
        if (m.seat) assert.ok(m.icons.every(([w]) => w === m.seat), `icons ${m.icons.map(([w]) => w)} differ from the child seat icon ${m.seat}`);
        assert.equal(m.level, "trust-h");
        assert.match(m.font, /^"?Castoro"?/);
        assert.ok(m.contrast.every((c) => c >= 4.5), m.contrast.join(", "));
      });
      if (engine === "chromium") {
        const cls = await p.evaluate(() => window.__cls);
        await check(`${engine} ${path} ${width}px: no layout shift while the page loads`, () => assert.equal(cls, 0));
      }
      if (width === 390 || width === 1440) {
        const steps = await p.evaluate(() => {
          const f = document.getElementById("book-form"), t = document.querySelector("section.trust"), out = [];
          for (const s of ["options", "details", "search"]) { f.dataset.step = s; out.push([s, getComputedStyle(t).display]); }
          return out;
        });
        await check(`${engine} ${path} ${width}px: the section hides at the options and details steps, where the form's own Stripe and included lines show, and comes back with the search step`, () => {
          assert.deepEqual(steps, [["options", "none"], ["details", "none"], ["search", "grid"]]);
        });
      }
      await ctx.close();
    }
  }

  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(base + "/", { waitUntil: "load" });
    const order = await p.evaluate(() => [".hero__book", ".hero > .trust", ".hero > .seats", ".hero > .pets"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.width)]; }));
    await check(`${engine} / ${width}px: the hero stacks the booking card, the trust section, child seats and pets, 16 px apart and the same width`, () => {
      for (let i = 1; i < 4; i++) assert.equal(order[i][0] - order[i - 1][1], 16, JSON.stringify(order));
      assert.equal(new Set(order.map(([, , l, w]) => `${l} ${w}`)).size, 1, JSON.stringify(order));
    });
    await ctx.close();
    const nojs = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
    const q = await nojs.newPage();
    await q.goto(base + "/", { waitUntil: "load" });
    const plain = await q.evaluate(() => [".hero > .seats", ".hero > .pets", ".hero__book", ".hero > .trust"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }));
    await check(`${engine} / ${width}px without javascript: the trust section still sits right under the booking form, after the child seats and pets cards`, () => {
      assert.ok(plain[0][1] <= plain[1][0] && plain[1][1] <= plain[2][0], JSON.stringify(plain));
      assert.equal(plain[3][0] - plain[2][1], 16, JSON.stringify(plain));
    });
    await nojs.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const form = () => p.evaluate(() => [document.getElementById("bk-flight-status").textContent, [...document.querySelectorAll("#bk-incl > li")].filter((li) => !li.dataset.show || li.classList.contains("is-shown")).map((li) => li.textContent.replace(/\s+/g, " ").trim()), document.getElementById("bk-meet").parentNode.querySelector(".bk-mrow__t").textContent + ": " + document.getElementById("bk-meet-bc").textContent.trim()]);
    const pick = async (text, label, id) => {
      await p.click("#bk-from");
      await p.fill("#bk-from", text);
      await p.locator("#bk-from-list [role=option]", { hasText: label }).first().click();
      await p.waitForFunction((v) => document.getElementById("bk-from-id").value === v, id);
      await p.waitForTimeout(200);
    };
    const PRIVATE = "For a private flight, add the details as a note in the Details step.";
    const MON = "Set the pickup time to your scheduled landing time. We track your flight.";
    const ALL = ["Free waiting after you land", "15 minutes of free waiting at other pickups", "Live flight tracking", "Free Wi-Fi in every class", "We answer 24 hours a day, every day"];
    const NOT_AIRLINE = [ALL[1], ALL[3], ALL[4]];
    await p.goto(base + "/locations/teterboro-airport", { waitUntil: "load" });
    const teb = await form();
    await pick("jfk", "JFK", "jfk");
    const jfk = await form();
    await pick("million air", "Million Air", "hpn-million");
    const fbo = await form();
    await check(`${engine} /locations/teterboro-airport: a Teterboro or FBO pickup asks for private flight details as a note, leaves out the airline waiting and flight tracking lines and meets in the FBO lobby, and an airline pickup brings them back`, () => {
      assert.deepEqual(teb, [PRIVATE, NOT_AIRLINE, "Inside pickup: Your chauffeur waits in the FBO lobby with a name sign."]);
      assert.deepEqual(jfk, [MON, ALL, "Inside pickup: Your chauffeur waits inside near baggage claim with a name sign."]);
      assert.deepEqual(fbo.slice(0, 2), [PRIVATE, NOT_AIRLINE]);
    });
    await ctx.close();
  }

  if (engine === "chromium") {
    for (const path of ["/", "/book"]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: "active" });
      const p = await ctx.newPage();
      await p.goto(base + path, { waitUntil: "load" });
      const fc = await p.evaluate(() => { const t = document.querySelector("section.trust"), cs = getComputedStyle(t), ring = getComputedStyle(t.querySelector(".trust__art")); return [matchMedia("(forced-colors: active)").matches, cs.backgroundImage, cs.borderTopStyle, parseFloat(cs.borderTopWidth) >= 1, ring.borderTopStyle, getComputedStyle(t.querySelector("svg.icon")).stroke]; });
      await check(`${engine} ${path} forced colors: the card keeps a solid outline on a plain Canvas, the rings keep their outline and the icons draw in the text color`, () => {
        assert.deepEqual(fc.slice(0, 5), [true, "none", "solid", true, "solid"]);
        assert.notEqual(fc[5], "none");
      });
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.emulateMedia({ contrast: "more" });
    await p.goto(base + "/book", { waitUntil: "load" });
    const more = await p.evaluate(MEASURE, "#book-form");
    await check(`${engine} /book with more contrast: every text of the section is at least 7:1`, () => assert.ok(more.contrast.every((c) => c >= 7), more.contrast.join(", ")));
    await ctx.close();
  }
  await browser.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} trust browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll trust browser tests passed");
process.exit(0);
