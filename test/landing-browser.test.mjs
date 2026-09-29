import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const WIDTHS = [320, 359, 360, 370, 375, 390, 414, 430, 480, 600, 719, 720, 768, 1023, 1024, 1199, 1200, 1280, 1440, 1920];
const INK = "rgb(15, 19, 25)";
const WHITE = "rgb(255, 255, 255)";
const CLEAR = "rgba(0, 0, 0, 0)";
const GOLD_300 = "rgb(235, 201, 106)";
const GOLD_500 = "rgb(201, 162, 39)";
const GOLD_700 = "rgb(133, 104, 35)";
const FIRST_CLASS = "rgb(148, 102, 32)";
const CREAM = "rgb(251, 248, 242)";
const ZONES = { desk: [0.01, 0.99, 0.553, 0.926], phone: [0.02, 0.985, 0.43, 0.578] };
const BLACK = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/></svg>`;
const SPACING = "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-bottom:2em !important}";

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

const CARD = () => {
  const cs = (s, pseudo) => getComputedStyle(document.querySelector(s), pseudo || null);
  const card = cs("#bk-search", "::before");
  const pin = (s) => {
    const q = cs(s, "::before");
    return [q.content, q.width, q.height, q.backgroundColor, /^url\("data:image\/svg\+xml,/.test(q.maskImage || q.webkitMaskImage)];
  };
  return {
    card: [card.content, card.backgroundColor, card.backgroundImage, [card.top, card.right, card.bottom, card.left].join(" "), card.borderTopLeftRadius, card.backdropFilter || card.webkitBackdropFilter || "none"],
    edge: card.boxShadow,
    padding: cs("#bk-search").padding,
    labels: [cs("#bk-from-f > label").color, cs("#bk-to-f > label").color],
    pins: [pin("#bk-from-f > label"), pin("#bk-to-f > label")],
    icons: [...document.querySelectorAll(".bk-search :is(.bk-pick, #bk-adds) .icon")].filter((i) => i.getClientRects().length).map((i) => getComputedStyle(i).color),
    pills: [...document.querySelectorAll(".bk-mode label")].map((l) => [getComputedStyle(l).backgroundColor, getComputedStyle(l).color]),
    form: [cs(".bk").backgroundColor, cs(".bk").color],
  };
};

const TAB = () => {
  const [one, hour] = document.querySelectorAll(".hero__book .bk-mode label");
  const ix = getComputedStyle(one, "::before");
  return { ix: ix.backgroundColor, at: new DOMMatrix(ix.transform).m41, to: hour.getBoundingClientRect().left - one.getBoundingClientRect().left, labels: [getComputedStyle(one).backgroundColor, getComputedStyle(hour).backgroundColor] };
};

const SHAPE = () => {
  const grid = (sel) => {
    const boxes = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
    return [new Set(boxes.map((b) => Math.round(b.top))).size, new Set(boxes.map((b) => Math.round(b.left))).size];
  };
  const lines = (e) => new Set([...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).flatMap((n) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    return [...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top));
  })).size;
  const split = (e) => {
    const s = e.firstElementChild.getBoundingClientRect(), r = document.createRange();
    r.selectNodeContents(e.lastChild);
    return r.getBoundingClientRect().top >= s.bottom - 2;
  };
  const words = (e) => {
    const out = [], walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) if (!n.parentElement.closest(".sr-only")) for (const m of n.data.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const q = r.getClientRects()[0];
      if (q && q.width) out.push(q);
    }
    return out;
  };
  const lineCount = (e) => words(e).reduce((tops, q) => (tops.some((t) => Math.abs(t - q.top) <= 3) ? tops : [...tops, q.top]), []).length;
  const level = (a, b) => Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) <= 1;
  const near = (sel) => {
    const els = [...document.querySelectorAll(sel)];
    let min = Infinity;
    for (let i = 1; i < els.length; i++) if (level(els[i - 1], els[i])) for (const a of words(els[i - 1])) for (const b of words(els[i])) if (Math.abs(a.top - b.top) <= 3) min = Math.min(min, b.left - a.right);
    return Math.round(min * 10) / 10;
  };
  const clear = (sel, pick = (e) => e) => {
    const els = [...document.querySelectorAll(sel)];
    let min = Infinity;
    els.forEach((e, i) => {
      const cs = getComputedStyle(e);
      if (cs.borderInlineStartStyle !== "solid") return;
      const x = e.getBoundingClientRect().left;
      for (const q of words(pick(e))) min = Math.min(min, q.left - x - parseFloat(cs.borderInlineStartWidth));
      if (i && level(els[i - 1], e)) for (const q of words(pick(els[i - 1]))) min = Math.min(min, x - q.right);
    });
    return min === Infinity ? null : Math.round(min * 10) / 10;
  };
  const box = (s) => document.querySelector(s).getBoundingClientRect();
  const blocks = [document.getElementById("wait-h").closest("section"), document.querySelector(".perks").parentElement, document.querySelector(".hero .seats")];
  const out = [];
  const clipped = [];
  for (const b of blocks) {
    for (const el of b.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < -0.5 || r.right > innerWidth + 0.5)) out.push(el.className || el.tagName);
      if (el.matches("p, li, h2, span, small") && !el.closest(".sr-only") && getComputedStyle(el).display !== "inline" && el.scrollWidth > el.clientWidth + 1) clipped.push(el.textContent.trim().slice(0, 40));
    }
  }
  const seats = box(".hero .seats"), amen = box(".amen"), line = box(".seats__line"), list = box(".seats__list"), label = box("#seats-h"), band = document.getElementById("wait-h").closest("section").getBoundingClientRect();
  const tiles = [...document.querySelectorAll(".amen__list > li")];
  const cap = (li) => li.querySelector(":scope > span") || li;
  const caps = tiles.map(cap);
  const rows = new Map();
  for (const li of tiles) {
    const k = Math.round(li.getBoundingClientRect().top);
    rows.set(k, [...(rows.get(k) || []), Math.round(cap(li).getBoundingClientRect().top * 2) / 2]);
  }
  const rule = (e) => getComputedStyle(e).borderInlineStartStyle === "solid" && getComputedStyle(e).borderInlineStartWidth === "1px";
  return {
    page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    out,
    clipped,
    waits: grid(".waits > li"),
    seats: grid(".seats__list > li"),
    amen: grid(".amen__list > li"),
    stripFirst: seats.bottom <= band.top,
    oneRowCard: label.right <= list.left && line.right <= list.left,
    heights: [document.getElementById("wait-h").closest("section").getBoundingClientRect().height, amen.height, seats.height].map(Math.round),
    icons: [...new Set(tiles.map((li) => { const r = li.querySelector("svg.icon").getBoundingClientRect(); return `${r.width}x${r.height}`; }))],
    stroke: [...new Set(tiles.map((li) => getComputedStyle(li.querySelector("svg.icon")).strokeWidth))],
    color: [...new Set(tiles.map((li) => getComputedStyle(li.querySelector("svg.icon")).color))],
    baselines: [...rows.values()].filter((tops) => new Set(tops).size > 1),
    capLines: Math.max(...caps.map((c) => Math.round(c.getBoundingClientRect().height / parseFloat(getComputedStyle(c).lineHeight)))),
    wraps: caps.filter((c) => Math.round(c.getBoundingClientRect().height / parseFloat(getComputedStyle(c).lineHeight)) > 1).length,
    tileLines: Math.max(...tiles.map(lineCount)),
    stripGap: near(".amen__list > li"),
    stripClear: clear(".amen__list > li"),
    stripRows: (() => {
      const m = new Map();
      for (const li of tiles) { const r = li.getBoundingClientRect(), k = Math.round(r.top); m.set(k, [...(m.get(k) || []), r]); }
      const all = [...m.values()], mid = (rs) => (Math.min(...rs.map((r) => r.left)) + Math.max(...rs.map((r) => r.right))) / 2;
      return [all.map((rs) => rs.length), Math.round(Math.abs(mid(all.at(-1)) - mid(all[0])) * 10) / 10];
    })(),
    stripEdge: Math.round(Math.min(...tiles.flatMap((li) => words(li)).flatMap((q) => [q.left, innerWidth - q.right]))),
    seatGap: near(".seats__list > li"),
    bandClear: clear(".waits > li"),
    numClear: clear(".waits > li", (e) => e.querySelector(".waits__n")),
    capPx: Math.min(...caps.map((c) => parseFloat(getComputedStyle(c).fontSize))),
    centred: tiles.filter((li) => { const i = li.querySelector("svg.icon").getBoundingClientRect(), c = cap(li).getBoundingClientRect(); return cap(li) === li || Math.abs(i.left + i.width / 2 - (c.left + c.width / 2)) > 1; }).length,
    stripRules: tiles.filter(rule).length,
    waitRules: [...document.querySelectorAll(".waits > li")].filter(rule).length,
    caps: [...document.querySelectorAll(".h-caps")].filter((e) => lines(e) > 1).map((e) => e.textContent.trim()),
    wrapped: [...document.querySelectorAll(".seats__n, .seats__s")].filter((e) => lines(e) > 1).map((e) => e.textContent.trim()),
    wrapped2: [...document.querySelectorAll(".seats__n, .seats__s")].filter((e) => lines(e) > 2).map((e) => e.textContent.trim()),
    split: [...document.querySelectorAll(".waits__n")].filter(split).map((e) => e.textContent.trim()),
    freeHero: [...document.querySelectorAll(".hero li, .hero p")].filter((e) => e.getClientRects().length && /free waiting/i.test(e.textContent)).map((e) => e.textContent.trim()),
    moving: blocks.flatMap((b) => b.getAnimations({ subtree: true })).length,
    L: matchMedia("(min-width: 1024px) and (min-aspect-ratio: 4/3)").matches,
    wrappedN: [...document.querySelectorAll(".seats__n")].filter((e) => lines(e) > 1).map((e) => e.textContent.trim()),
  };
};

const HEADER = () => {
  const words = (e) => {
    const out = [];
    if (!e || !e.getClientRects().length) return out;
    const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) if (!n.parentElement.closest(".sr-only") && getComputedStyle(n.parentElement).clipPath === "none") for (const m of n.data.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) out.push(q);
    }
    return out;
  };
  const boxes = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => e.getBoundingClientRect());
  const brand = [...words(document.querySelector(".site-header__bar .site-header__word")), ...boxes(".site-header__bar .site-header__logo")];
  const rest = [...[".site-header__lines", ".site-nav", ".site-header__desk"].flatMap((s) => words(document.querySelector(s))), ...boxes(".site-header__lines .icon, [data-nav-toggle], .site-header__desk > *")];
  const meet = brand.flatMap((a) => rest.filter((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5).map((b) => `${Math.round(a.left)} to ${Math.round(a.right)} meets ${Math.round(b.left)} to ${Math.round(b.right)}`));
  const out = [...document.querySelectorAll(".site-header__bar *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && !e.closest(".sr-only") && (r.left < -0.5 || r.right > innerWidth + 0.5); }).map((e) => e.className || e.tagName);
  return { meet, out };
};

const NO_GUTTER = () => {
  const s = new CSSStyleSheet();
  s.replaceSync("html{scrollbar-gutter:auto}");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
};

for (const [engine, type] of [["chromium", chromium], ["webkit", webkit], ["firefox", firefox]]) {
  const browser = await type.launch();
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(NO_GUTTER);
    if (engine === "chromium") await p.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    const s = await p.evaluate(SHAPE);
    const phone = width < 600, wide = width >= 1024, L = s.L;
    await check(`${engine} ${width}px: the waiting band, child seats and amenities fit the screen with no sideways scroll and no clipped text`, () => {
      assert.ok(s.page[0] <= s.page[1], `the page is ${s.page[0]}px wide in ${s.page[1]}px`);
      assert.deepEqual(s.out, []);
      assert.deepEqual(s.clipped, []);
    });
    await check(`${engine} ${width}px: the times and the seats are each one row of 3, the amenities are ${wide ? "one row of 8" : width < 360 ? "3 rows of 3, 3 and 2 with the last 2 centred, every word at least 24 px from the screen edges" : "2 rows of 4"}, the child seats card ends above the waiting band${L ? ", with its heading and line left of the seats" : ""}`, () => {
      assert.deepEqual([s.waits, s.seats, s.amen], [[1, 3], [1, 3], wide ? [1, 8] : width < 360 ? [3, 5] : [2, 4]]);
      if (width < 360) {
        assert.deepEqual(s.stripRows[0], [3, 3, 2]);
        assert.ok(s.stripRows[1] <= 1, `the last row sits ${s.stripRows[1]}px off the centre of the first`);
        assert.ok(s.stripEdge >= 24, `a word of the strip sits ${s.stripEdge}px from the screen edge`);
      }
      assert.ok(s.stripFirst, "the child seats card does not end above the waiting band");
      if (L) assert.ok(s.oneRowCard, "the heading and the line do not sit left of the seats");
      assert.equal(s.moving, 0);
    });
    await check(`${engine} ${width}px: the strip reads at a glance, gold icons of one size and stroke centred over captions of at most two lines and at least ${phone ? 13 : 14} px that start on one baseline per row, with ${wide ? "7 thin rules between the 8 tiles" : width >= 375 ? "thin rules between the columns" : "no rules"} and 2 rules between the 3 times`, () => {
      assert.equal(s.icons.length, 1, s.icons.join(" "));
      assert.deepEqual(s.stroke, ["1.5px"]);
      assert.deepEqual(s.color, [GOLD_700], "the strip icons are not all gold");
      assert.equal(s.centred, 0, "an icon is off the centre of its caption");
      assert.deepEqual(s.baselines, []);
      assert.ok(s.capLines <= 2, `a caption runs to ${s.capLines} lines`);
      assert.ok(s.capPx >= (phone ? 13 : 14), `a caption is ${s.capPx}px`);
      assert.equal(s.stripRules, wide ? 7 : width >= 375 ? 6 : 0);
      assert.equal(s.waitRules, 2);
    });
    await check(`${engine} ${width}px: no strip tile runs past ${width >= 480 ? 2 : 3} lines with its small line${wide ? ", no caption wraps alone in the row of 8" : ""}, and neighbouring captions keep at least 8 px apart and ${width >= 390 ? 8 : 6} px clear of a rule`, () => {
      assert.ok(s.tileLines <= (width >= 480 ? 2 : 3), `a tile runs to ${s.tileLines} lines`);
      if (wide) assert.notEqual(s.wraps, 1, "one caption wraps alone on a wide screen");
      assert.ok(s.stripGap >= 8, `two captions sit ${s.stripGap}px apart`);
      assert.ok(s.stripClear === null || s.stripClear >= (width >= 390 ? 8 : 6), `a caption sits ${s.stripClear}px from a rule`);
    });
    await check(`${engine} ${width}px: the three seats keep at least 14 px between their lines, every line of the band at least 5 px clear of its rules and every number at least ${width >= 360 ? 9 : 7} px`, () => {
      assert.ok(s.seatGap >= 14, `two seat lines sit ${s.seatGap}px apart`);
      assert.ok(s.bandClear >= 5, `a line of the band sits ${s.bandClear}px from a rule`);
      assert.ok(s.numClear >= (width >= 360 ? 9 : 7), `a number of the band sits ${s.numClear}px from a rule`);
    });
    await check(`${engine} ${width}px: compact, the band is at most ${phone ? 320 : 440} px tall, the strip at most ${wide ? 130 : width < 360 ? 320 : 230} px and the child seats card at most ${L ? 200 : 360} px`, () => {
      const [band, strip, card] = s.heights;
      assert.ok(band <= (phone ? 320 : 440) && strip <= (wide ? 130 : width < 360 ? 320 : 230) && card <= (L ? 200 : 360), JSON.stringify(s.heights));
    });
    await check(`${engine} ${width}px: every heading stays on one line and every number keeps its min beside it${width >= 360 ? ", and every seat name and Free on request stays on one line" : ""}${L ? " (in L Free on request takes two lines)" : ""}`, () => {
      assert.deepEqual(s.caps, []);
      assert.deepEqual(s.split, [], "min drops below its number");
      if (L) assert.deepEqual([s.wrappedN, s.wrapped2], [[], []]);
      else if (width >= 360) assert.deepEqual(s.wrapped, []);
    });
    await check(`${engine} ${width}px: free waiting is said once, by the band, not by the trust row of the hero form above it`, () => assert.deepEqual(s.freeHero, []));
    if (engine === "chromium" && [390, 1440].includes(width)) {
      const cls = await p.evaluate(() => window.__cls);
      await check(`${engine} ${width}px: CLS on load is 0`, () => assert.equal(cls, 0));
    }
    await p.addStyleTag({ content: SPACING });
    await p.waitForTimeout(100);
    const t = await p.evaluate(SHAPE);
    const hd = await p.evaluate(HEADER);
    await check(`${engine} ${width}px: with the WCAG text spacing the header brand still clears the ${width < 1024 ? "phone, WhatsApp and email lines and the menu button" : "links and the pills"}, and nothing in the header bar leaves the screen`, () => {
      assert.deepEqual(hd.meet, []);
      assert.deepEqual(hd.out, []);
    });
    await check(`${engine} ${width}px: with the WCAG text spacing the band, the strip and the child seats card still fit, no sideways scroll and no clipped text`, () => {
      assert.ok(t.page[0] <= t.page[1], `the page is ${t.page[0]}px wide in ${t.page[1]}px`);
      assert.deepEqual(t.out, []);
      assert.deepEqual(t.clipped, []);
    });
    await ctx.close();
  }

  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    const c = await p.evaluate(CARD);
    await check(`${engine} ${width}px: the homepage booking card is solid ink with a 1px gold-500 edge over the whole search part, no blur, ${width < 1024 ? "16px" : "12px, 24px and 24px"} padding, white labels with a 16px gold-300 pin before Pickup location and Drop-off location, gold-300 calendar, clock and plus icons, and One way a gold-300 pill with ink text`, () => {
      assert.deepEqual(c.card, ['""', INK, "none", "0px 0px 0px 0px", "16px", "none"]);
      assert.ok(c.edge.startsWith(`${GOLD_500} 0px 0px 0px 1px inset`), c.edge);
      assert.equal(c.padding, width < 1024 ? "16px" : "12px 24px 24px");
      assert.deepEqual(c.labels, [WHITE, WHITE]);
      assert.deepEqual(c.pins, Array(2).fill(['""', "16px", "16px", GOLD_300, true]));
      assert.deepEqual(c.icons, Array(4).fill(GOLD_300));
      assert.deepEqual(c.pills, [[GOLD_300, INK], [CLEAR, WHITE]]);
    });
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
    await p.click("label[for=bk-hour]");
    await p.waitForTimeout(60);
    const mid = await p.evaluate(TAB);
    await p.waitForTimeout(500);
    const end = await p.evaluate(TAB);
    await check(`${engine} 390x844: 60 ms after a tap on By the hour the gold pill is the sliding indicator and no label turns gold, then it rests under By the hour`, () => {
      assert.deepEqual([mid.ix, ...mid.labels], [GOLD_300, CLEAR, CLEAR]);
      assert.deepEqual([end.ix, ...end.labels], [GOLD_300, CLEAR, CLEAR]);
      assert.ok(Math.abs(end.at - end.to) <= 1.5, `the indicator rests at ${end.at}px, By the hour starts at ${end.to}px`);
    });
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    const c = await p.evaluate(CARD);
    await check(`${engine} 390px without JavaScript: the homepage form stays the white card with ink labels, no ink card and no pins`, () => {
      assert.deepEqual([c.card[0], ...c.pins.map(([content]) => content)], ["none", "none", "none"]);
      assert.deepEqual([c.form, c.labels], [[WHITE, INK], [INK, INK]]);
    });
    await ctx.close();
  }

  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    for (const path of ["/locations/jfk-airport", "/locations/manhattan"]) {
      const p = await ctx.newPage();
      await p.goto(`${base}${path}`, { waitUntil: "load" });
      await p.waitForFunction(() => document.getElementById("book-form").classList.contains("is-js"));
      const c = await p.evaluate(CARD);
      await check(`${engine} ${width}px ${path}: the widget pages wear the homepage card in their banner, solid ink with a 1px gold-500 edge over the whole search part, no blur, ${width < 1024 ? "16px" : "12px, 24px and 24px"} padding, white labels with the gold-300 pins, gold-300 calendar, clock and plus icons, and One way a gold-300 pill with ink text`, () => {
        assert.deepEqual(c.card, ['""', INK, "none", "0px 0px 0px 0px", "16px", "none"]);
        assert.ok(c.edge.startsWith(`${GOLD_500} 0px 0px 0px 1px inset`), c.edge);
        assert.equal(c.padding, width < 1024 ? "16px" : "12px 24px 24px");
        assert.deepEqual(c.labels, [WHITE, WHITE]);
        assert.deepEqual(c.pins, Array(2).fill(['""', "16px", "16px", GOLD_300, true]));
        assert.deepEqual(c.icons, Array(4).fill(GOLD_300));
        assert.deepEqual(c.pills, [[GOLD_300, INK], [CLEAR, WHITE]]);
      });
      await p.close();
    }
    await ctx.close();
  }

  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    const m = await p.evaluate(() => {
      const cs = (s, pseudo) => getComputedStyle(document.querySelector(s), pseudo || null);
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      return {
        h1: cs(".hero > h1").color, gold: cs(".hero__gold").color, tags: [cs(".hero__tags").color, cs(".hero__tags--svc").color], label: cs("#bk-from-f > label").color,
        card: cs(".hero__book > .bk > .bk-search", "::before").backgroundColor, header: cs(".site-header__brand").color, bar: cs(".site-header").backgroundColor, floor: cs(".hero").backgroundColor,
        h1Left: box(".hero > h1").left, barLeft: box("#bk-search").left,
      };
    });
    await check(`${engine} ${width}px: the headline and the two lines read ink, First Class the warm gold #946620, the pickup label white on the black card${width < 1024 ? ", and the header brand white on the ink header bar" : " and the header brand ink"}`, () => {
      assert.deepEqual([m.h1, m.gold, ...m.tags, m.label, m.card], [INK, FIRST_CLASS, INK, INK, WHITE, INK]);
      assert.deepEqual(width < 1024 ? [m.header, m.bar] : [m.header], width < 1024 ? [WHITE, INK] : [INK]);
    });
    if (width >= 1024) await check(`${engine} ${width}px: the headline lines up with the booking card`, () => assert.ok(Math.abs(m.h1Left - m.barLeft) < 1, `${m.h1Left} vs ${m.barLeft}`));
    else await check(`${engine} ${width}px: the hero floor is cream`, () => assert.equal(m.floor, CREAM));
    await ctx.close();
  }

  for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440], [2560, 1080], [1920, 800], [320, 568], [360, 780], [390, 844], [430, 932], [768, 1024]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await ctx.route(/\/fleet\/home-hero[^/]*$/, (r) => r.fulfill({ contentType: "image/svg+xml", body: /\/home-hero-phone-/.test(r.request().url()) ? BLACK(1200, 1800) : BLACK(3000, 2000) }));
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForFunction(() => document.documentElement.classList.contains("hdr-ready"));
    await p.waitForTimeout(400);
    const zone = await p.evaluate(() => (document.querySelector(".hero__photo picture img").currentSrc.includes("/home-hero-phone-") ? "phone" : "desk"));
    const clip = await p.evaluate(([x0, x1, y0, y1]) => {
      const img = document.querySelector(".hero__photo picture img");
      const ib = img.getBoundingClientRect(), cs = getComputedStyle(img);
      const s = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
      const at = (v, free) => (v.endsWith("%") ? (free * parseFloat(v)) / 100 : parseFloat(v));
      const [px, py] = cs.objectPosition.split(" ");
      const ox = ib.left + at(px, ib.width - w), oy = ib.top + at(py, ib.height - h);
      const x = Math.ceil(ox + x0 * w), y = Math.ceil(oy + y0 * h);
      return { x, y, width: Math.floor(ox + x1 * w) - x, height: Math.floor(oy + y1 * h) - y };
    }, ZONES[zone]);
    const png = await p.screenshot({ clip, type: "png" });
    const lit = await p.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 8) n++;
      return n;
    }, `data:image/png;base64,${png.toString("base64")}`);
    const [x0, x1, y0, y1] = ZONES[zone];
    await check(`${engine} ${width}x${height}: nothing covers the ${zone} photo's subject zone (x ${x0} to ${x1}, y ${y0} to ${y1} of the photo), no veil, no menu and no text`, () =>
      assert.equal(lit, 0, `${lit} of ${clip.width * clip.height} pixels of the zone are covered`));
    await ctx.close();
  }

  if (engine === "chromium") {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, forcedColors: "active" });
    const p = await ctx.newPage();
    await p.goto(`${base}/`, { waitUntil: "load" });
    const border = await p.evaluate(() => getComputedStyle(document.querySelector(".hero .seats")).borderTopStyle);
    await check(`${engine}: with forced colors the child seats card keeps an outline`, () => assert.equal(border, "solid"));
    const f = await p.evaluate(() => {
      const sys = (c) => {
        const d = document.createElement("div");
        d.style.cssText = `forced-color-adjust:none;background:${c}`;
        document.body.append(d);
        const v = getComputedStyle(d).backgroundColor;
        d.remove();
        return v;
      };
      return {
        card: getComputedStyle(document.getElementById("bk-search"), "::before").display,
        pill: getComputedStyle(document.querySelector("label[for=bk-one]")).backgroundColor,
        pins: ["#bk-from-f", "#bk-to-f"].map((s) => getComputedStyle(document.querySelector(`${s} > label`), "::before").backgroundColor),
        highlight: sys("Highlight"),
        text: sys("CanvasText"),
      };
    });
    await check(`${engine}: with forced colors the homepage card keeps the Highlight pill and paints both pins in CanvasText`, () => {
      assert.equal(f.card, "none");
      assert.equal(f.pill, f.highlight);
      assert.deepEqual(f.pins, [f.text, f.text]);
    });
    await ctx.close();
    const fc = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: "active" });
    const q = await fc.newPage();
    await q.goto(`${base}/`, { waitUntil: "load" });
    const fb = await q.evaluate(() => [document.querySelector(".hero__photo").getBoundingClientRect().bottom, document.getElementById("bk-search").getBoundingClientRect().top]);
    await check(`${engine}: with forced colors at 390 the photo ends at or above the top of the booking card`, () => assert.ok(fb[0] <= fb[1] + 0.5, `photo ends ${fb[0]}, card ${fb[1]}`));
    await fc.close();
  }
  await browser.close();
}

server.close();
if (failures) {
  console.error(`\n${failures} landing browser assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll landing browser tests passed");
process.exit(0);
