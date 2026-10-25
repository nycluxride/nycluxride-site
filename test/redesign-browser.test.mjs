import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");

function discover() {
  const out = [];
  const skipped = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "cdn-cgi"].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith(".html")) {
        const route = name === "index.html" && prefix === "/" ? "/" : `${prefix}${name.replace(/\.html$/, "")}`;
        if (/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/[^"]+\.css"/.test(readFileSync(full, "utf8"))) out.push(route);
        else skipped.push(route);
      }
    }
  };
  walk(ROOT, "/");
  return { pages: out.sort(), skipped: skipped.sort() };
}

const { pages: PAGES, skipped: SKIPPED } = discover();

if (SKIPPED.length || PAGES.length < 30) {
  console.error(
    `FAIL discovery: ${PAGES.length} pages matched, ${SKIPPED.length} html files carry no stylesheet link` +
      (SKIPPED.length ? `\n       ${SKIPPED.join(", ")}` : "")
  );
  console.error("\nrefusing to run a silently reduced suite");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function resolvePath(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
  const candidates = clean === "/" ? ["index.html"] : [`${clean.slice(1)}.html`, clean.slice(1)];
  for (const c of candidates) {
    const full = join(ROOT, c);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const file = resolvePath(req.url);
      if (!file) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(existsSync(join(ROOT, "404.html")) ? readFileSync(join(ROOT, "404.html")) : "<!doctype html><title>404</title>Not Found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const SPRITE_HIDER = "position:absolute;inline-size:0;block-size:0;overflow:hidden";

const EMOJI = /[←-⇿⌀-➿⬀-⯿️\u{1F300}-\u{1FAFF}]/u;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const open = async (o) => {
  const p = await browser.newPage(o);
  await p.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  return p;
};
const sitewide = new Map();

for (const route of PAGES) {
  if (!resolvePath(route)) {
    failures++;
    console.error(`  FAIL ${route}: page does not exist`);
    continue;
  }

  const page = await open({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/net::ERR/.test(m.text())) errors.push(m.text());
  });
  const failed = [];
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(base)) return;
    failed.push(`${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`${base}${route}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const s = await page.evaluate(() => {
    const styleOf = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    return {
      h1s: [...document.querySelectorAll("h1")].map((n) => n.textContent.trim()),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => n.textContent),
      fontsOk: ['400 16px "Geist"', '500 16px "Geist"', '400 48px "Castoro"', '700 13px "Archivo"'].map((f) => [f, document.fonts.check(f)]),
      loadedFaces: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      bodyFont: styleOf("body", "fontFamily"),
      h1Font: styleOf("h1", "fontFamily"),
      bg: styleOf("body", "backgroundColor"),
      text: document.body.innerText,
      imgs: [...document.querySelectorAll("img")].map((n) => ({
        w: n.getAttribute("width"),
        h: n.getAttribute("height"),
        alt: n.getAttribute("alt"),
        decorative: !!n.closest(".note__thumb") || (n.matches("img.plate__twin") && n.getAttribute("aria-hidden") === "true"),
        loading: n.getAttribute("loading"),
        broken: n.complete && n.naturalWidth === 0,
        src: n.getAttribute("src"),
      })),
      useRefs: [...document.querySelectorAll("use")].map((n) => n.getAttribute("href") || ""),
      symbols: document.querySelectorAll("symbol").length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      inlineStyles: [...document.querySelectorAll("[style]")].map((n) => n.getAttribute("style")),
      unresolvedUses: [...document.querySelectorAll("use")]
        .map((n) => n.getAttribute("href") || "")
        .filter((h) => h.startsWith("#") && !document.getElementById(h.slice(1))),
      duplicateIds: (() => {
        const seen = new Set();
        const dupes = [];
        for (const el of document.querySelectorAll("[id]")) {
          if (seen.has(el.id)) dupes.push(el.id);
          seen.add(el.id);
        }
        return dupes;
      })(),
      danglingIdrefs: (() => {
        const bad = [];
        for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls", "for", "headers"]) {
          for (const el of document.querySelectorAll(`[${attr}]`)) {
            for (const id of el.getAttribute(attr).split(/\s+/).filter(Boolean)) {
              if (!document.getElementById(id)) bad.push(`${attr}="${id}"`);
            }
          }
        }
        return bad;
      })(),
      headingOrder: (() => {
        const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((n) => Number(n.tagName[1]));
        const skips = [];
        if (levels.length && levels[0] !== 1) skips.push(`starts at h${levels[0]}`);
        for (let i = 1; i < levels.length; i++) {
          if (levels[i] > levels[i - 1] + 1) skips.push(`h${levels[i - 1]} -> h${levels[i]}`);
        }
        return skips;
      })(),
      deadFragments: [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute("href"))
        .filter((h) => h.length > 1 && !document.getElementById(h.slice(1))),
    };
  });

  check(`${route}: no page or console errors`, () => assert.deepEqual(errors, []));
  check(`${route}: no failed first-party requests`, () => assert.deepEqual(failed, []));
  check(`${route}: exactly one non-empty h1`, () => {
    assert.equal(s.h1s.length, 1, JSON.stringify(s.h1s));
    assert.ok(s.h1s[0].length > 0);
  });
  check(`${route}: Geist and Castoro render`, () => {
    assert.deepEqual(s.fontsOk.filter(([, ok]) => !ok).map(([f]) => f), []);
    assert.match(s.h1Font, /^"?Castoro/);
    assert.match(s.bodyFont, /^"?Geist/);
  });
  check(`${route}: every json-ld block parses`, () => {
    assert.ok(s.ld.length > 0, "no json-ld");
    for (const b of s.ld) JSON.parse(b);
  });
  sitewide.set(route, s.ld[0]);
  check(`${route}: #organization is only typed LocalBusiness`, () =>
    assert.deepEqual(
      [...s.ld.join(" ").matchAll(/"@type":"(\w+)","@id":"https:\/\/www\.nycluxride\.com\/#organization"/g)]
        .map((m) => m[1])
        .filter((t) => t !== "LocalBusiness"),
      []
    ));
  check(`${route}: no schema declares aggregateRating or LimousineService`, () => {
    const all = s.ld.join(" ");
    assert.ok(!all.includes("aggregateRating"), "aggregateRating present");
    assert.ok(!all.includes("LimousineService"), "LimousineService is not a real schema.org type");
  });
  check(`${route}: no emoji or dingbat in rendered text`, () => {
    const m = s.text.match(EMOJI);
    assert.equal(m, null, m && `found ${JSON.stringify(m[0])}`);
  });
  check(`${route}: icon sprite is inline, not cross-document`, () => {
    assert.ok(s.symbols > 0, "no inline <symbol> found");
    const external = s.useRefs.filter((h) => !h.startsWith("#"));
    assert.deepEqual(external, []);
  });
  check(`${route}: every image has width, height, alt, and is not broken`, () => {
    const bad = s.imgs.filter((i) => !i.w || !i.h || i.alt === null || (!i.alt && !i.decorative) || i.broken);
    assert.deepEqual(bad, []);
  });
  check(`${route}: at most one eager image`, () => {
    const eager = s.imgs.filter((i) => i.loading === "eager");
    assert.ok(eager.length <= 1, `${eager.length} eager images`);
  });
  check(`${route}: no hotlinked stock imagery`, () => {
    const hot = s.imgs.map((i) => i.src || "").filter((u) => /unsplash|pexels/.test(u));
    assert.deepEqual(hot, []);
  });
  const inlineLayout = s.inlineStyles
    .filter((v) => v !== SPRITE_HIDER)
    .filter((v) => /display|position|width|margin|padding|flex|grid|top|left/i.test(v));
  check(`${route}: no inline layout styles`, () => assert.deepEqual(inlineLayout, []));
  check(`${route}: every icon reference resolves to a symbol in the document`, () =>
    assert.deepEqual(s.unresolvedUses, []));
  check(`${route}: no duplicate element id`, () => assert.deepEqual(s.duplicateIds, []));
  check(`${route}: every aria and label idref resolves`, () => assert.deepEqual(s.danglingIdrefs, []));
  check(`${route}: heading levels start at h1 and never skip`, () => assert.deepEqual(s.headingOrder, []));
  check(`${route}: every in-page fragment link has a target`, () => assert.deepEqual(s.deadFragments, []));
  check(`${route}: page background is the token surface, not pure black`, () => {
    assert.equal(s.bg, "rgb(255, 255, 255)");
  });
  check(`${route}: no horizontal overflow at 1280px`, () => {
    assert.ok(s.scrollW <= s.clientW + 1, `overflows by ${s.scrollW - s.clientW}px`);
  });

  for (const w of [390, 1200, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const clipped = await page.evaluate(() => {
      const out = [];
      const scrollable = (el) => {
        for (let n = el; n; n = n.parentElement) {
          if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (!/auto|hidden|paint|clip/.test(`${cs.contentVisibility} ${cs.contain} ${cs.overflowX} ${cs.overflow}`)) continue;
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX)) continue;
        const pr = el.getBoundingClientRect();
        for (const d of el.querySelectorAll("*")) {
          const dr = d.getBoundingClientRect();
          if (dr.width > 0 && dr.right > pr.right + 2 && !scrollable(d)) {
            out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").split(" ")[0]} clips ${(d.getAttribute("class") || d.tagName).slice(0, 24)} by ${Math.round(dr.right - pr.right)}px`);
          }
        }
      }
      return [...new Set(out)].slice(0, 4);
    });
    check(`${route}: nothing is silently clipped by paint containment at ${w}px`, () => {
      assert.deepEqual(clipped, []);
    });
  }

  for (const w of [320, 360, 390]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    check(`${route}: no horizontal overflow at ${w}px`, () => {
      assert.ok(o.scrollW <= o.clientW + 1, `overflows by ${o.scrollW - o.clientW}px`);
    });
  }

  await page.close();
}

check("the site-wide json-ld block is identical on every page", () => assert.equal(new Set(sitewide.values()).size, 1));

const nojs = await browser.newContext({ javaScriptEnabled: false });

for (const route of ["/faq", "/fleet", "/"]) {
  if (!resolvePath(route)) continue;
  const p = await nojs.newPage();
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  const r = await p.evaluate(() => ({
    links: document.querySelectorAll("a[href]").length,
    details: document.querySelectorAll("main details").length,
    text: document.body.innerText.length,
    fleetSets: document.querySelectorAll(".fleet-set").length,
  }));
  check(`${route}: usable with javascript disabled (${r.links} links, ${r.text} chars)`, () => {
    assert.ok(r.links >= 15, `only ${r.links} links`);
    assert.ok(r.text > 800, `only ${r.text} chars of text`);
  });
  if (route === "/faq") {
    check(`/faq: 19 native details elements render in main without javascript`, () => {
      assert.equal(r.details, 19);
    });
    const answers = await p.evaluate(() => document.body.textContent);
    check(`/faq: answers are in the static html, not javascript`, () => {
      assert.match(answers, /Book online at least 1 hour before pickup/);
    });
  }
  if (route === "/fleet") {
    check(`/fleet: tier sets render without javascript`, () => assert.ok(r.fleetSets >= 4, `${r.fleetSets} sets`));
  }
  await p.close();
}
await nojs.close();

const kb = await open({ viewport: { width: 1280, height: 900 } });
await kb.goto(`${base}/`, { waitUntil: "load" });
await kb.keyboard.press("Tab");
const firstFocus = await kb.evaluate(() => {
  const a = document.activeElement;
  const cs = getComputedStyle(a);
  return { cls: a.className, text: a.textContent.trim().slice(0, 30), outline: cs.outlineWidth, offset: cs.outlineOffset };
});
check(`keyboard: first tab stop is the skip link`, () => assert.match(firstFocus.cls, /skip/));
check(`keyboard: focus ring is visible with a positive offset`, () => {
  assert.notEqual(firstFocus.outline, "0px");
  assert.ok(parseFloat(firstFocus.offset) >= 2, `offset ${firstFocus.offset}`);
});
await kb.close();

const ROUTES = new Set(PAGES);
const resolvesLocally = (p) => ROUTES.has(p.replace(/\/$/, "") || "/") || existsSync(join(ROOT, p.slice(1)));
for (const route of PAGES) {
  const html = readFileSync(resolvePath(route), "utf8");
  const links = [...html.matchAll(/href="(?:https:\/\/www\.nycluxride\.com)?(\/[^"#?]*)/g)].map((m) => m[1]);
  const cands = [...html.matchAll(/(?:srcset|imagesrcset)="([^"]+)"/g)].flatMap((m) =>
    m[1].split(",").map((c) => c.trim().split(/\s+/)[0].split("?")[0])
  );
  check(`${route}: every internal link resolves to a page or file`, () =>
    assert.deepEqual([...new Set(links.filter((p) => !resolvesLocally(p)))], []));
  check(`${route}: every srcset candidate exists`, () =>
    assert.deepEqual([...new Set(cands.filter((u) => u.startsWith("/") && !existsSync(join(ROOT, u.slice(1)))))], []));
}

const phone = await open({ viewport: { width: 390, height: 844 } });
await phone.goto(`${base}/`, { waitUntil: "load" });
const barAt = () => phone.evaluate(() => document.querySelector(".actionbar").getBoundingClientRect().top);
const barFirst = await barAt();
check(`/: the action bar starts below the first screen while the booking form is in view (${Math.round(barFirst)}px)`, () =>
  assert.ok(barFirst >= 844, `bar starts at ${barFirst}`));
await phone.evaluate(() => scrollTo(0, scrollY + document.getElementById("book-form").getBoundingClientRect().bottom + 1));
await phone.waitForTimeout(700);
const barLater = await barAt();
check(`/: the action bar is on screen once the booking form scrolls away (${Math.round(barLater)}px)`, () =>
  assert.ok(barLater < 844 - 40, `bar starts at ${barLater}`));
await phone.close();

const CLS_PROBE = () => {
  window.__cls = { value: 0, sources: [] };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__cls.value += e.value;
      for (const s of e.sources || []) window.__cls.sources.push(s.node ? `${s.node.nodeName.toLowerCase()}.${String(s.node.className || "").split(" ")[0]}` : "removed node");
    }
  }).observe({ type: "layout-shift", buffered: true });
};
const clsOf = async (route, width) => {
  const p = await open({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await p.addInitScript(CLS_PROBE);
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => window.__cls);
  await p.close();
  return r;
};
const clsJobs = PAGES.flatMap((route) => [390, 1280].map((width) => [route, width]));
for (let i = 0; i < clsJobs.length; i += 6) {
  const batch = await Promise.all(clsJobs.slice(i, i + 6).map(async ([route, width]) => [route, width, await clsOf(route, width)]));
  for (const [route, width, r] of batch) {
    check(`${route}: CLS on load is 0 at ${width}px`, () =>
      assert.equal(r.value, 0, `CLS ${r.value.toFixed(4)} from ${[...new Set(r.sources)].join(", ")}`));
  }
}

const LATE_FONTS = ["/", "/book", "/rates", "/fleet", "/faq", "/locations", "/locations/manhattan", "/locations/jfk-airport", "/chauffeur-service-nyc", "/blog", "/blog/jfk-lga-ewr-airport-transfer-guide-april-17"];
const clsLate = async (route, width) => {
  const p = await open({ viewport: { width, height: width < 600 ? 844 : 900 } });
  await p.route(/\.woff2$/, async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await p.addInitScript(CLS_PROBE);
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => window.__cls);
  await p.close();
  return r;
};
const lateJobs = LATE_FONTS.filter((route) => resolvePath(route)).flatMap((route) => [390, 1280].map((width) => [route, width]));
for (let i = 0; i < lateJobs.length; i += 6) {
  const batch = await Promise.all(lateJobs.slice(i, i + 6).map(async ([route, width]) => [route, width, await clsLate(route, width)]));
  for (const [route, width, r] of batch) {
    check(`${route}: CLS on load is 0 at ${width}px with the fonts held back 1500 ms`, () =>
      assert.equal(r.value, 0, `CLS ${r.value.toFixed(4)} from ${[...new Set(r.sources)].join(", ")}`));
  }
}

const shown = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 4 && r.height > 4 && cs.visibility === "visible" && cs.clipPath === "none" && r.left >= -1 && r.right <= innerWidth + 1;
};
for (const width of [390, 768, 1440]) {
  const p = await open({ viewport: { width, height: 900 } });
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const t = await p.evaluate(`(() => {
    const shown = ${shown};
    const r = document.querySelector(".site-header__bar").getBoundingClientRect();
    return { top: r.top, height: r.height, links: [...document.querySelectorAll(".site-header__lines a")].map((a) => [a.textContent.trim(), shown(a.querySelector("span")), a.getBoundingClientRect().height, a.getBoundingClientRect().width, shown(a.querySelector(".icon"))]) };
  })()`);
  check(`/rates: at ${width}px the header bar is the top of the page${width < 768 ? " and shows the phone, WhatsApp and email icons as 44px targets named by their hidden text" : width < 1024 ? " and shows the phone, WhatsApp and email lines as 44px tall targets" : ", its phone lines are hidden and the pills carry phone and WhatsApp"}`, () => {
    assert.equal(Math.round(t.top), 0);
    assert.equal(Math.round(t.height), width < 600 ? 56 : width < 1024 ? 64 : 76, `the header bar is ${t.height}px tall`);
    const lab = width >= 768 && width < 1024;
    const want = [["+1 (646) 775-0556", lab], ["WhatsApp", lab], ["info@nycluxride.com", lab]];
    assert.deepEqual(t.links.map((l) => l.slice(0, 2)), want);
    if (width < 1024) for (const [text, , h, w, icon] of t.links) assert.ok(icon && h >= 44 && w >= 44, `${text} is a ${w}x${h}px target${icon ? "" : " without its icon"}`);
  });
  await p.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));
  await p.waitForTimeout(500);
  const s = await p.evaluate(() => [document.querySelector(".site-header").getBoundingClientRect().top, document.querySelector(".site-header__bar").getBoundingClientRect().top, document.querySelector(".site-header__bar").getBoundingClientRect().bottom, document.documentElement.classList.contains("hdr-away")]);
  if (width < 1024) {
    check(`/rates: at ${width}px after 600px down the header steps away (hdr-away)`, () => {
      assert.ok(s[3], "html has no hdr-away");
      assert.ok(s[2] <= 0.5, `the header bar still ends at ${s[2]}px`);
    });
    await p.evaluate(() => scrollTo({ top: 590, behavior: "instant" }));
    await p.waitForTimeout(500);
    const back = await p.evaluate(() => [document.documentElement.classList.contains("hdr-away"), document.querySelector(".site-header__bar").getBoundingClientRect().top]);
    check(`/rates: at ${width}px the header returns after 10px up`, () => {
      assert.equal(back[0], false);
      assert.ok(Math.abs(back[1]) <= 0.5, `the header bar starts at ${back[1]}px`);
    });
    await p.evaluate(() => scrollTo({ top: 1200, behavior: "instant" }));
    await p.waitForTimeout(500);
    await p.focus(".site-header__mobile .icon-btn");
    await p.waitForTimeout(500);
    const focused = await p.evaluate(() => [document.documentElement.classList.contains("hdr-away"), document.querySelector(".site-header__bar").getBoundingClientRect().top]);
    check(`/rates: at ${width}px the header returns when focus moves into it`, () => {
      assert.equal(focused[0], false);
      assert.ok(Math.abs(focused[1]) <= 0.5, `the header bar starts at ${focused[1]}px`);
    });
  } else {
    check(`/rates: at ${width}px after 600px down the header and its bar stay at the top`, () => {
      assert.ok(Math.abs(s[0]) <= 0.5, `the header starts at ${s[0]}px`);
      assert.ok(Math.abs(s[1]) <= 0.5, `the header bar starts at ${s[1]}px`);
      assert.equal(s[3], false, "hdr-away on desktop");
    });
  }
  await p.close();
}

for (const [width, sel, where] of [[1024, ".site-header__desk .tel--wa span", "header"], [1440, ".site-header__desk .tel--wa span", "header"], [390, ".actionbar__cell--wa span", "action bar"], [320, ".actionbar__cell--wa span", "action bar"]]) {
  const p = await open({ viewport: { width, height: 844 } });
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const label = await p.evaluate(`(() => { const shown = ${shown}; const el = document.querySelector(${JSON.stringify(sel)}); return [el && el.textContent, shown(el)]; })()`);
  check(`/rates: the ${where} shows the WhatsApp label at ${width}px`, () => assert.deepEqual(label, ["WhatsApp", true]));
  await p.close();
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const heroBoxes = (p) =>
  p.evaluate(() => {
    const box = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
    };
    return {
      hero: box(".hero"),
      photo: box(".hero__photo"),
      book: box(".hero__book"),
      form: box(".hero__book > form#book-form:only-child"),
      bar: box("#bk-search"),
      help: box("#bk-help"),
      view: box("#bk-view"),
      h1: box(".hero > h1"),
      twin: box(".hero__photo > img.plate__twin:first-child"),
      twinShown: !!document.querySelector(".hero__photo > img.plate__twin:first-child")?.getClientRects().length,
      captions: document.querySelectorAll(".hero figcaption.slate").length,
      header: box(".site-header"),
      h1Color: getComputedStyle(document.querySelector(".hero > h1")).color,
      hdrBg: getComputedStyle(document.querySelector(".site-header")).backgroundColor,
      btn: getComputedStyle(document.querySelector(".site-header__desk .btn")).visibility,
      scrolled: document.documentElement.classList.contains("is-scrolled"),
      vw: document.documentElement.getBoundingClientRect().width,
      helpDisplay: document.getElementById("bk-help") ? getComputedStyle(document.getElementById("bk-help")).display : null,
      mask: (() => { const cs = getComputedStyle(document.querySelector(".hero__photo picture img")); return cs.maskImage || cs.webkitMaskImage; })(),
    };
  });
const wide = await open({ viewport: { width: 1440, height: 900 } });
await wide.goto(`${base}/`, { waitUntil: "load" });
await wide.evaluate(() => document.fonts.ready);
const w1 = await heroBoxes(wide);
check("/: at 1440x900 the hero photo spans the viewport width and the hero height under a transparent header that shows Book a car, since Book your ride starts below the first screen", () => {
  assert.ok(w1.form, "no form#book-form as the only child of .hero__book");
  assert.ok(Math.abs(w1.photo.left) <= 0.5 && Math.abs(w1.photo.width - w1.vw) <= 0.5, `photo ${w1.photo.left} to ${w1.photo.right}, viewport ${w1.vw}`);
  assert.ok(Math.abs(w1.photo.top - w1.hero.top) <= 0.5 && Math.abs(w1.photo.height - w1.hero.height) <= 0.5, "the photo does not cover the hero");
  assert.equal(w1.hdrBg, TRANSPARENT);
  assert.ok(w1.view.top >= 900, `Book your ride starts at ${w1.view.top}`);
  assert.equal(w1.btn, "visible");
});
check("/: at 1440x900 the hero keeps its twin hidden, no caption chip, and no #bk-help (the booking flow carries no help row, owner change)", () => {
  assert.ok(w1.twin && !w1.twinShown, "no hidden img.plate__twin as the first child of the hero figure");
  assert.equal(w1.captions, 0, "the hero still has a figcaption.slate");
  assert.equal(w1.helpDisplay, null);
});
await wide.evaluate(() => scrollTo(0, 1000));
await wide.waitForFunction(() => document.documentElement.classList.contains("is-scrolled"), null, { timeout: 2000 }).catch(() => {});
await wide.waitForTimeout(400);
const w2 = await heroBoxes(wide);
check("/: after scrolling 1000px the header is no longer transparent and shows Book a car", () => {
  assert.ok(w2.scrolled, "html has no is-scrolled");
  assert.notEqual(w2.hdrBg, TRANSPARENT);
  assert.equal(w2.btn, "visible");
});
await wide.evaluate(() => scrollTo(0, 0));
await wide.evaluate(() => {
  const f = document.getElementById("book-form");
  if (!f) return;
  const grow = document.createElement("div");
  grow.style.blockSize = "300px";
  f.append(grow);
});
await wide.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const w3 = await heroBoxes(wide);
check("/: when the form grows by 300px the figure still covers the whole hero and the photo fades into the floor", () => {
  assert.ok(w3.book.height >= w1.book.height + 290, `the form did not grow (${w1.book.height} to ${w3.book.height})`);
  assert.match(w3.mask, /linear-gradient\(rgb\(0, 0, 0\) calc\(100% - 24px\), rgba\(0, 0, 0, 0\)\)/);
  assert.ok(Math.abs(w3.photo.height - w3.hero.height) <= 0.5 && Math.abs(w3.photo.top - w3.hero.top) <= 0.5, `photo ${w3.photo.height}, hero ${w3.hero.height}`);
});
const chain = await wide.evaluate(() => {
  const out = [];
  for (let n = document.querySelector(".hero__book")?.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    out.push({ el: `${n.tagName.toLowerCase()}.${String(n.className).split(" ")[0]}`, overflow: `${cs.overflowX} ${cs.overflowY}`, contain: cs.contain, cv: cs.contentVisibility });
  }
  return out;
});
check("/: .hero and every ancestor of .hero__book keep overflow visible, no paint containment and no content-visibility", () => {
  assert.ok(chain.length >= 4 && chain[0].el === "section.frame", JSON.stringify(chain[0]));
  assert.deepEqual(chain.filter((c) => c.overflow !== "visible visible" || /paint|strict|content/.test(c.contain) || c.cv !== "visible"), []);
});
const eager = await wide.evaluate(() => [...document.querySelectorAll("img:not(.plate__twin)")].filter((i) => i.loading === "eager").map((i) => ({ hero: !!i.closest("figure.hero__photo"), ok: i.complete && i.naturalWidth > 0 })));
check("/: the hero photo is the only eager image and it loads", () => assert.deepEqual(eager, [{ hero: true, ok: true }]));
const seatArt = await wide.evaluate(() => [...document.querySelectorAll(".hero .seats__list > li")].map((li) => {
  const art = li.querySelector(":scope > .seats__art");
  const img = art?.querySelector(":scope > picture > img");
  if (!img) return art?.querySelector(":scope > svg.icon > use")?.getAttribute("href") || "none";
  return [img.loading, img.getAttribute("fetchpriority"), img.getAttribute("width"), img.getAttribute("height"), img.alt.trim().length > 0].join(" ");
}));
check("/: each child seat tile shows its line icon, or a seat photo that is lazy, low priority, 1200 by 1200 and has an alt", () => {
  assert.equal(seatArt.length, 3);
  assert.deepEqual(seatArt.filter((a, i) => a !== `#${["i-seat-infant", "i-seat-toddler", "i-seat-booster"][i]}` && a !== "lazy low 1200 1200 true"), []);
});
await wide.close();

const ancestry = (p, sel) =>
  p.evaluate((s) => {
    const start = document.querySelector(s);
    if (!start) return null;
    const out = [];
    for (let n = start.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      out.push({ el: `${n.tagName.toLowerCase()}.${String(n.className).split(" ")[0]}`, overflow: `${cs.overflowX} ${cs.overflowY}`, contain: cs.contain, cv: cs.contentVisibility });
    }
    return out;
  }, sel);
{
  const p = await open({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${base}/locations/manhattan`, { waitUntil: "load" });
  const bchain = await ancestry(p, ".banner__book");
  check("/locations/manhattan: .banner and every ancestor of .banner__book keep overflow visible, no paint containment and no content-visibility", () => {
    assert.ok(bchain, "no .banner__book on the page");
    assert.ok(bchain.some((c) => c.el === "section.banner"), JSON.stringify(bchain[0]));
    assert.deepEqual(bchain.filter((c) => c.overflow !== "visible visible" || /paint|strict|content/.test(c.contain) || c.cv !== "visible"), []);
  });
  await p.close();
}
for (const route of ["/locations/manhattan", "/fleet"]) {
  const p = await open({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  const link = await p.evaluate(() => {
    const a = document.querySelector(".banner .lede a:not([class])");
    if (!a) return null;
    const cs = getComputedStyle(a);
    return [cs.color, cs.textDecorationLine];
  });
  check(`${route}: the plain link in the banner lede is gold-700 with an underline on the cream banner`, () => assert.deepEqual(link, ["rgb(133, 104, 35)", "underline"]));
  await p.close();
}

const nojsWide = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
{
  const p = await nojsWide.newPage();
  await p.goto(`${base}/`, { waitUntil: "load" });
  const n0 = await heroBoxes(p);
  check("/: without javascript at 1440 the header is solid with Book a car and every word of the hero sits on the floor below the photo band", () => {
    assert.equal(n0.hdrBg, "rgb(255, 255, 255)");
    assert.equal(n0.btn, "visible");
    assert.ok(n0.hero.top >= n0.header.bottom - 0.5, `hero ${n0.hero.top}, header ${n0.header.bottom}`);
    assert.ok(n0.h1.top >= n0.photo.bottom - 24 - 0.5, `h1 ${n0.h1.top}, band ${n0.photo.bottom}`);
  });
}
await nojsWide.close();
for (const [width, height] of [[1024, 768], [1440, 900], [1920, 1080]]) {
  const c = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false });
  const q = await c.newPage();
  await q.goto(`${base}/`, { waitUntil: "load" });
  const s = await q.evaluate(() => [document.querySelector(".hero > .seats"), document.querySelector(".hero__book")].flatMap((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }));
  check(`/: without javascript at ${width}x${height} the child seats card ends above the booking form, so the form never covers the seats`, () => assert.ok(s[1] <= s[2], `seats ${s[0]} to ${s[1]}, form ${s[2]} to ${s[3]}`));
  await c.close();
}

const narrow = await open({ viewport: { width: 390, height: 844 } });
await narrow.goto(`${base}/`, { waitUntil: "load" });
await narrow.evaluate(() => document.fonts.ready);
const n1 = await heroBoxes(narrow);
check("/: at 390x844 the twin shows under the photo", () => assert.ok(n1.twinShown, "the twin is hidden at 390"));
check("/: at 390x844 the photo starts above the ink headline and the hero has no caption chip", () => {
  assert.ok(n1.photo.top < n1.h1.top, "the headline starts above the photo");
  assert.equal(n1.h1Color, "rgb(15, 19, 25)");
  assert.equal(n1.captions, 0);
});
check("/: at 390x844 Book your ride ends inside the first screen", () => assert.ok(n1.view && n1.view.bottom <= 844, `Book your ride ends at ${n1.view && n1.view.bottom}`));
await narrow.close();

{
  const p = await open({ viewport: { width: 1440, height: 900 } });
  await p.route(/\/assets\/lux\.[^/]*\.js$/, (r) => r.abort());
  await p.goto(`${base}/`, { waitUntil: "load" });
  await p.waitForTimeout(3500);
  const d = await heroBoxes(p);
  check("/: with lux.js blocked the header turns solid and shows Book a car 3 s after load", () => {
    assert.equal(d.hdrBg, "rgb(255, 255, 255)");
    assert.equal(d.btn, "visible");
  });
  await p.close();
}
for (const [motion, want] of [["no-preference", "absolute"], ["reduce", "absolute"]]) {
  const p = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: motion });
  await p.goto(`${base}/`, { waitUntil: "load" });
  const pos = await p.evaluate(() => getComputedStyle(document.querySelector(".hero__photo picture img")).position);
  check(`/: at 1440 with ${motion} motion the hero photo is ${want}`, () => assert.equal(pos, want));
  await p.close();
}

const menu = await open({ viewport: { width: 390, height: 844 } });
await menu.goto(`${base}/`, { waitUntil: "load" });
await menu.click("[data-nav-toggle]");
await menu.waitForFunction(() => document.activeElement?.matches("[data-nav-close]"), null, { timeout: 2000 }).catch(() => {});
const menuOpen = await menu.evaluate(() => [document.documentElement.hasAttribute("data-nav-open"), document.querySelector("main").inert, [...document.querySelectorAll(".site-header__lines a")].every((a) => a.inert), document.activeElement.matches("[data-nav-close]")]);
const menuLink = await menu.isVisible('#nav-panel a[href="/rates"]');
const panelBox = await menu.evaluate(() => {
  const r = document.getElementById("nav-panel").getBoundingClientRect();
  return [r.left, r.top, r.width - document.documentElement.getBoundingClientRect().width, r.height].map(Math.round);
});
check("/: at 390 the open menu covers the viewport", () => assert.deepEqual(panelBox, [0, 0, 0, 844]));
check("/: the phone menu opens, makes the page and the header lines inert and moves focus to Close", () => {
  assert.deepEqual(menuOpen, [true, true, true, true]);
  assert.ok(menuLink, "the Rates link in the menu is not visible");
});
await menu.keyboard.press("Escape");
const menuClosed = await menu.evaluate(() => [document.documentElement.hasAttribute("data-nav-open"), document.activeElement.matches("[data-nav-toggle]"), [...document.querySelectorAll(".site-header__lines a")].some((a) => a.inert)]);
check("/: Escape closes the phone menu, returns focus to the toggle and the header lines are live again", () => assert.deepEqual(menuClosed, [false, true, false]));
await menu.close();

for (const width of [375, 390, 430]) {
  const p = await open({ viewport: { width, height: 844 } });
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const at = (sels) => p.evaluate((ss) => ss.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v)); }), sels);
  const shut = await at(["[data-nav-toggle]", ".site-header__brand"]);
  await p.click("[data-nav-toggle]");
  await p.waitForFunction(() => document.documentElement.hasAttribute("data-nav-open"), null, { timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(400);
  const shown = await at(["[data-nav-close]", ".nav-panel__brand"]);
  check(`/rates: at ${width} the open menu puts Close exactly over the menu button and its brand exactly over the header brand`, () => assert.deepEqual(shown, shut));
  await p.close();
}

const bare = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
const bareMenu = await bare.newPage();
await bareMenu.goto(`${base}/`, { waitUntil: "load" });
await bareMenu.click("[data-nav-toggle]");
const bareLink = await bareMenu.waitForSelector('#nav-panel a[href="/rates"]', { state: "visible", timeout: 2000 }).then(() => true, () => false);
const bareOpen = [await bareMenu.evaluate(() => document.getElementById("nav-panel").matches(":popover-open")), bareLink];
check("/: without javascript the Menu button still opens the menu", () => assert.deepEqual(bareOpen, [true, true]));
await bare.close();

const reveal = await open({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
await reveal.goto(`${base}/fleet`, { waitUntil: "load" });
await reveal.evaluate(async () => {
  for (let y = 0; y <= document.body.scrollHeight; y += innerHeight / 2) {
    scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 60));
  }
});
const stillHidden = await reveal
  .waitForFunction(() => ![...document.querySelectorAll(".plate__img img")].some((n) => getComputedStyle(n).opacity === "0"), null, { timeout: 4000, polling: 100 })
  .then(() => 0, () => reveal.evaluate(() => [...document.querySelectorAll(".plate__img img")].filter((n) => getComputedStyle(n).opacity === "0").length));
const marked = await reveal.evaluate(() => [...document.querySelectorAll("[data-rv]")].filter((n) => !n.matches(".citymap") && !n.querySelector("img[loading=lazy]")).length);
check("/fleet: after scrolling with motion allowed no photo inside .plate__img stays at opacity 0, and every [data-rv] plate holds a lazy image", () => {
  assert.equal(stillHidden, 0, `${stillHidden} photos still at opacity 0`);
  assert.equal(marked, 0, `${marked} [data-rv] plates without a lazy image`);
});
await reveal.close();

for (const width of [320, 390, 900, 1280, 1440]) {
  const p = await open({ viewport: { width, height: 900 } });
  await p.goto(`${base}/`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const gaps = await p.evaluate(() => [...document.querySelectorAll("main [id^=class-] .lnk")].map((a) => {
    const range = document.createRange();
    range.selectNodeContents(a.firstChild);
    const rects = [...range.getClientRects()];
    const word = rects[rects.length - 1];
    const icon = a.querySelector(".icon").getBoundingClientRect();
    return [Math.round(icon.left - word.right), Math.abs(icon.top + icon.height / 2 - (word.top + word.height / 2)) <= 2];
  }));
  check(`/: at ${width}px every fleet slide link ends with its arrow 8px after the last word, on the same line`, () => {
    assert.equal(gaps.length, 5);
    assert.deepEqual(gaps, gaps.map(() => [8, true]));
  });
  await p.close();
}

for (const width of [320, 390, 768, 900, 1024]) {
  const p = await open({ viewport: { width, height: 900 } });
  await p.goto(`${base}/fleet`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const [scrollW, clientW] = await p.evaluate(() => { const n = document.querySelector(".jumps--tabs"); return [n.scrollWidth, n.clientWidth]; });
  check(`/fleet: at ${width}px the six class tabs fit without sideways scrolling`, () => assert.ok(scrollW <= clientW, `${scrollW}px of tabs in ${clientW}px`));
  await p.close();
}

{
  const p = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.click("[data-nav-toggle]");
  await p.waitForFunction(() => document.activeElement?.matches("[data-nav-close]"), null, { timeout: 2000 }).catch(() => {});
  const closed = await p.evaluate(() => {
    const n = document.getElementById("nav-panel");
    const cur = n.querySelector(".nav-panel__list [aria-current]");
    const bar = cur && getComputedStyle(cur, "::before");
    return { fits: n.scrollHeight <= n.clientHeight, bar: bar && [bar.content !== "none", bar.width, bar.height, bar.backgroundColor], head: getComputedStyle(n.querySelector(".nav-panel__head")).position };
  });
  check("menu at 390x844: the closed menu needs no scrolling, the head is sticky and the current page shows a 2px gold bar", () => {
    assert.ok(closed.fits, "the menu scrolls with the disclosure closed");
    assert.equal(closed.head, "sticky");
    assert.deepEqual(closed.bar, [true, "2px", "24px", "rgb(201, 162, 39)"]);
  });
  await p.click(".nav-panel__more > summary");
  await p.evaluate(() => { const n = document.getElementById("nav-panel"); n.scrollTop = n.scrollHeight; });
  await p.waitForTimeout(200);
  const opened = await p.evaluate(() => {
    const n = document.getElementById("nav-panel");
    const c = n.querySelector("[data-nav-close]").getBoundingClientRect();
    const rows = [...n.querySelectorAll(".nav-panel__areas a")].map((a) => a.getBoundingClientRect());
    return { scrolled: n.scrollTop, close: [c.top, c.bottom], h: [...new Set(rows.map((r) => Math.round(r.height)))], cols: new Set(rows.map((r) => Math.round(r.left))).size };
  });
  check("menu at 390: with the areas open and scrolled, Close stays in view and the areas are two columns of 44px rows", () => {
    assert.ok(opened.scrolled > 0, "the open menu did not scroll");
    assert.ok(opened.close[0] >= 0 && opened.close[1] <= 844, `Close at ${opened.close}`);
    assert.deepEqual([opened.h, opened.cols], [[44], 2]);
  });
  const trapped = [];
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press(i % 9 === 8 ? "Shift+Tab" : "Tab");
    trapped.push(await p.evaluate(() => document.getElementById("nav-panel").contains(document.activeElement)));
  }
  check("menu at 390: Tab and Shift+Tab stay inside the open menu", () => assert.deepEqual(trapped.filter((x) => !x).length, 0));
  await p.keyboard.press("Escape");
  await p.click("[data-nav-toggle]");
  await p.waitForTimeout(150);
  const top = await p.evaluate(() => document.getElementById("nav-panel").scrollTop);
  check("menu at 390: a reopened menu starts at the top", () => assert.equal(top, 0));
  await p.keyboard.press("Escape");
  const touch = await p.evaluate(() => [getComputedStyle(document.documentElement).webkitTapHighlightColor, getComputedStyle(document.querySelector("button")).touchAction, getComputedStyle(document.querySelector("a[href]")).touchAction, getComputedStyle(document.documentElement).colorScheme, getComputedStyle(document.querySelector(".plate__img") || document.body).backgroundColor]);
  check("taps: the tap highlight is transparent and buttons and links take touch-action manipulation", () => assert.deepEqual(touch.slice(0, 3), ["rgba(0, 0, 0, 0)", "manipulation", "manipulation"]));
  check("color-scheme computes only light", () => assert.match(touch[3], /^(only light|light only)$/));
  const foot = await p.evaluate(() => { const f = document.querySelector(".site-footer"); return { h: f.getBoundingClientRect().height, wraps: [...f.querySelectorAll(".site-footer__grid a")].filter((a) => a.getClientRects().length > 1).map((a) => a.textContent.trim()) }; });
  check(`/rates: the footer at 390 is at most 1,560px tall with no wrapped link (${Math.round(foot.h)}px)`, () => {
    assert.ok(foot.h <= 1560, `${foot.h}px`);
    assert.deepEqual(foot.wraps, []);
  });
  await p.close();
}
{
  const p = await open({ viewport: { width: 390, height: 844 } });
  await p.goto(`${base}/locations/manhattan`, { waitUntil: "load" });
  await p.click("[data-nav-toggle]");
  await p.waitForTimeout(200);
  const bar = await p.evaluate(() => { const b = getComputedStyle(document.querySelector(".nav-panel__more > summary"), "::before"); return [b.content !== "none", b.width, b.height]; });
  check("menu on /locations/manhattan: the closed Service areas row carries the current-page bar", () => assert.deepEqual(bar, [true, "2px", "24px"]));
  await p.close();
}
{
  const p = await open({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
  await p.goto(`${base}/locations/manhattan`, { waitUntil: "load" });
  await p.evaluate(async () => { for (const y of [400, 900, 1400]) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
  await p.waitForTimeout(500);
  const away = await p.evaluate(() => [document.documentElement.classList.contains("bar-on"), document.documentElement.classList.contains("hdr-away"), document.querySelector(".site-header__bar").getBoundingClientRect().bottom]);
  check("/locations/manhattan at 390: with the action bar shown, scrolling down moves the header away", () => {
    assert.deepEqual(away.slice(0, 2), [true, true]);
    assert.ok(away[2] <= 0.5, `the header bar ends at ${away[2]}px`);
  });
  await p.close();
}
{
  const p = await open({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
  await p.goto(`${base}/fleet`, { waitUntil: "load" });
  const r = await p.evaluate(() => ({ tone: getComputedStyle(document.querySelector(".plate__img")).backgroundColor, bad: [...document.querySelectorAll("[data-rv]")].filter((n) => !n.matches(".citymap") && (!n.querySelector("img[loading=lazy]") || n.closest(".hero__photo,.banner__photo"))).length }));
  check("/fleet: plates sit on the warm tone and data-rv marks only lazy plates", () => {
    assert.equal(r.tone, "rgb(50, 44, 38)");
    assert.equal(r.bad, 0);
  });
  await p.close();
}
for (const [route, id] of [["/faq#q-cancellation", "q-cancellation"], ["/rates#q-jfk", "q-jfk"]]) {
  for (const width of [390, 1280]) {
    const p = await open({ viewport: { width, height: width < 600 ? 844 : 900 } });
    await p.addInitScript(CLS_PROBE);
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    await p.waitForTimeout(1200);
    const r = await p.evaluate((i) => [document.getElementById(i).open, window.__cls.value, [...new Set(window.__cls.sources)].join(", ")], id);
    check(`${route} at ${width}px: the linked answer opens on load with CLS 0`, () => {
      assert.equal(r[0], true, "the details is closed");
      assert.equal(r[1], 0, `CLS ${r[1].toFixed(4)} from ${r[2]}`);
    });
    await p.close();
  }
}
for (const [route, id] of [["/faq#q-cancellation", "q-cancellation"], ["/rates#q-jfk", "q-jfk"]]) {
  const p = await open({ viewport: { width: 390, height: 844 } });
  await p.route(/\/assets\/lux\.[^/]+\.js$/, (r) => r.abort());
  await p.addInitScript(CLS_PROBE);
  await p.goto(`${base}${route}`, { waitUntil: "load" });
  await p.waitForTimeout(800);
  const r = await p.evaluate((i) => [document.getElementById(i).open, window.__cls.value], id);
  check(`${route}: the page opens the linked answer while it parses, before the first paint, without waiting for lux.js`, () => {
    assert.equal(r[0], true, "the details stays closed until lux.js runs");
    assert.equal(r[1], 0, `CLS ${r[1].toFixed(4)}`);
  });
  await p.close();
}
{
  const p = await open({ viewport: { width: 390, height: 844 } });
  await p.goto(`${base}/faq`, { waitUntil: "load" });
  const t = await p.evaluate(() => {
    const d = document.getElementById("q-cancellation");
    const before = getComputedStyle(d, "::details-content").transitionDuration;
    d.classList.add("no-anim");
    return [before, getComputedStyle(d, "::details-content").transitionDuration];
  });
  check("/faq: no-anim switches off the open animation of an answer", () => {
    assert.notEqual(t[0].split(",")[0].trim(), "0s", "the answers have no open animation");
    assert.ok(t[1].split(",").every((x) => x.trim() === "0s"), `no-anim leaves ${t[1]}`);
  });
  await p.close();
}
for (const width of [320, 390]) {
  const p = await open({ viewport: { width, height: 844 } });
  await p.goto(`${base}/rates`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const t = await p.evaluate(() => [...document.querySelectorAll("main .table-scroll")].map((n) => n.scrollWidth - n.clientWidth));
  check(`/rates at ${width}px: every rate table fits its box with no sideways scroll`, () => {
    assert.ok(t.length >= 3, `${t.length} tables`);
    assert.deepEqual(t.filter((x) => x > 0), []);
  });
  await p.close();
}
for (const width of [320, 340]) {
  const p = await open({ viewport: { width, height: 740 } });
  await p.goto(`${base}/fleet`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const t = await p.evaluate(() => [...document.querySelectorAll("main .table-scroll")].map((n) => n.scrollWidth - n.clientWidth));
  check(`/fleet at ${width}px: the vehicle table fits its box with no sideways scroll`, () => assert.deepEqual(t, [0]));
  await p.close();
}
for (const width of [1024, 1280, 1440, 1920]) {
  const p = await open({ viewport: { width, height: 900 } });
  const rows = {};
  for (const route of ["/rates", "/schedule", "/contact"]) {
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    rows[route] = await p.evaluate(() => { const b = [...document.querySelectorAll(".banner .btn-row a")].filter((a) => getComputedStyle(a).display !== "none"); return [new Set(b.map((a) => Math.round(a.getBoundingClientRect().top))).size, b.map((a) => a.textContent.trim())]; });
  }
  check(`Hero C banners at ${width}px: the button row stays on one line, and /contact keeps Book on WhatsApp from 1280`, () => {
    for (const route of ["/rates", "/schedule", "/contact"]) assert.equal(rows[route][0], 1, `${route}: ${rows[route][1].join(" | ")}`);
    assert.equal(rows["/contact"][1].includes("Book on WhatsApp"), width >= 1280);
  });
  if (width >= 1440) {
    await p.goto(`${base}/chauffeur-service-nyc`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    const h = await p.evaluate(() => [...document.querySelectorAll("main dl.facts:not(.facts--lead) > dd")].map((d) => Math.round(Math.max(d.getBoundingClientRect().height, d.previousElementSibling.getBoundingClientRect().height))));
    check(`/chauffeur-service-nyc at ${width}px: fact rows keep their own height next to a taller column`, () => assert.ok(h.length && h.every((x) => x <= 60), h.join(", ")));
  }
  await p.close();
}
for (const width of [320, 390, 1440]) {
  const p = await open({ viewport: { width, height: 844 } });
  const off = [];
  for (const route of ["/rates", "/about", "/privacy-policy", "/locations/jfk-airport"]) {
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    off.push(...(await p.evaluate((r) => [...document.querySelectorAll("a")].filter((a) => a.getClientRects().length && a.querySelector('use[href="#i-external"]') && !/flex/.test(getComputedStyle(a).display)).map((a) => {
      const svg = a.querySelector("svg"), w = document.createTreeWalker(a, 4);
      let t = null;
      while (w.nextNode()) if (w.currentNode.compareDocumentPosition(svg) & 4 && w.currentNode.nodeValue.trim()) t = w.currentNode;
      const rg = document.createRange();
      rg.setStart(t, t.length - 1);
      rg.setEnd(t, t.length);
      const last = rg.getBoundingClientRect(), icon = svg.getBoundingClientRect();
      return Math.abs(icon.top + icon.height / 2 - (last.top + last.height / 2)) > 6 ? `${r}: ${a.textContent.trim().slice(0, 40)}` : "";
    }).filter(Boolean), route)));
  }
  check(`new tab icons of inline links stay on the line of the link's last word at ${width}px (rates, about, privacy, JFK)`, () => assert.deepEqual(off, []));
  await p.close();
}
const GOLD = ["rgb(201, 162, 39)", "rgb(184, 146, 31)", "rgb(168, 133, 28)"];
const goldInView = (p) =>
  p.evaluate((gold) => [...document.querySelectorAll("a, button")].filter((n) => {
    const cs = getComputedStyle(n);
    if (!gold.includes(cs.backgroundColor) || cs.visibility !== "visible" || Number(cs.opacity) === 0) return false;
    const r = n.getBoundingClientRect(), h = document.querySelector(".site-header"), hs = h && getComputedStyle(h);
    const top = h && !n.closest(".site-header") && /sticky|fixed/.test(hs.position) && /^rgb\(\d+, \d+, \d+\)$/.test(hs.backgroundColor) ? Math.max(0, h.getBoundingClientRect().bottom) : 0;
    return r.width > 0 && r.height > 0 && r.bottom > top && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !n.closest("[hidden],[inert]");
  }).map((n) => `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}.${String(n.className).split(" ").join(".")}`), GOLD);
const goldJobs = PAGES.flatMap((route) => [390, 1440].map((width) => [route, width]));
for (let i = 0; i < goldJobs.length; i += 6) {
  const batch = await Promise.all(goldJobs.slice(i, i + 6).map(async ([route, width]) => {
    const p = await open({ viewport: { width, height: width < 600 ? 844 : 900 } });
    await p.goto(`${base}${route}`, { waitUntil: "load" });
    await p.waitForTimeout(700);
    const atLoad = await goldInView(p);
    await p.evaluate(() => scrollTo({ top: 900, behavior: "instant" }));
    await p.waitForTimeout(700);
    const scrolled = await goldInView(p);
    await p.close();
    return [route, width, atLoad, scrolled];
  }));
  for (const [route, width, atLoad, scrolled] of batch) {
    check(`${route} at ${width}px: at most one gold control in view at load and after 900px of scroll`, () => {
      assert.ok(atLoad.length <= 1, `at load: ${atLoad.join(", ")}`);
      assert.ok(scrolled.length <= 1, `after scroll: ${scrolled.join(", ")}`);
    });
  }
}
{
  const p = await open({ viewport: { width: 1280, height: 900 } });
  const FIELD = '<div class="field faq-find js-only"><label for="faq-q">Search the questions</label><input id="faq-q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-describedby="faq-n"><p class="field__hint" id="faq-n" role="status"></p></div>';
  let injected = false;
  await p.route(`${base}/faq`, async (r) => {
    const res = await r.fetch();
    let body = await res.text();
    if (!body.includes('id="faq-q"')) {
      injected = true;
      body = body.replace('<section class="section section--tight" id="reservations">', `${FIELD}\n<section class="section section--tight" id="reservations">`);
    }
    await r.fulfill({ response: res, body });
  });
  await p.goto(`${base}/faq`, { waitUntil: "load" });
  await p.fill("#faq-q", "cancel");
  await p.waitForTimeout(150);
  const f = await p.evaluate(() => {
    const all = [...document.querySelectorAll("main details")];
    const shown = all.filter((d) => !d.hidden);
    return { total: all.length, shown: shown.length, open: shown.every((d) => d.open), match: shown.every((d) => d.textContent.toLowerCase().includes("cancel")), status: document.getElementById("faq-n").textContent, groups: [...new Set(all.map((d) => d.closest("section")))].filter((s) => s.hidden).length };
  });
  check(`/faq${injected ? " (filter field injected until PAGES-CORE adds it)" : ""}: typing cancel shows only matching questions, open, with the count line`, () => {
    assert.ok(f.shown > 0 && f.shown < f.total, `${f.shown} of ${f.total} shown`);
    assert.ok(f.open && f.match, JSON.stringify(f));
    assert.equal(f.status, f.shown === 1 ? "1 answer matches" : `${f.shown} answers match`);
    assert.ok(f.groups > 0, "no group heading hid with its questions");
  });
  await p.press("#faq-q", "Escape");
  await p.waitForTimeout(150);
  const g = await p.evaluate(() => ({ hidden: document.querySelectorAll("main details[hidden]").length, open: [...document.querySelectorAll("main details")].filter((d) => d.open).length, status: document.getElementById("faq-n").textContent }));
  check("/faq: Escape clears the filter, shows every question, closes the ones it opened and empties the count", () => assert.deepEqual(g, { hidden: 0, open: 0, status: "" }));
  await p.close();
}
for (const [w, h, slack] of [[1024, 768, 0], [1280, 720, 0], [1280, 800, 0], [1366, 768, 0], [1440, 900, 0], [1536, 864, 0], [1920, 1080, 0], [2560, 1440, 0], [2560, 1080, 0], [1920, 800, 0]]) {
  const p = await open({ viewport: { width: w, height: h } });
  await p.goto(`${base}/`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const r = await p.evaluate(() => {
    const img = document.querySelector(".hero__photo picture img");
    const ib = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    const s = Math.max(ib.width / img.naturalWidth, ib.height / img.naturalHeight);
    const rh = img.naturalHeight * s;
    const py = cs.objectPosition.split(" ")[1];
    const oy = ib.top + (py.endsWith("%") ? ((ib.height - rh) * parseFloat(py)) / 100 : parseFloat(py));
    const sb = document.getElementById("bk-search");
    const b = sb.getBoundingClientRect();
    const g = getComputedStyle(sb, "::before");
    return { car: Math.round(oy + 0.713 * rh), glass: Math.round(b.top + (parseFloat(g.top) || 0)) };
  });
  check(`/: at ${w}x${h} the glass bar covers at most ${slack}px of the car (car bottom ${r.car}, glass top ${r.glass})`, () => assert.ok(r.car - r.glass <= slack, `${r.car - r.glass}px of the car under the bar`));
  await p.close();
}

const miss = await fetch(`${base}/no/such/page`);
const missBody = await miss.text();
check("unmatched routes return 404.html with status 404 and noindex", () => {
  assert.equal(miss.status, 404);
  assert.match(missBody, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(missBody, /rel="canonical"/);
});

const PROBES = ["Services", "Book a car JFK Airport LaGuardia Manhattan Brooklyn Queens Fleet Rates", "Your chauffeur meets you inside the terminal with a name sign and tracks the flight."];
async function engineChecks(engine, b) {
  const page = async (path, o = {}) => {
    const c = await b.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 }, ...o });
    await c.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const p = await c.newPage();
    p.errors = [];
    p.on("pageerror", (e) => p.errors.push(e.message));
    await p.goto(base + path, { waitUntil: "load" });
    return p;
  };
  const done = (p) => p.context().close();

  let p = await page("/about");
  const fonts = await p.evaluate(async (probes) => {
    for (const w of [400, 500, 600]) await Promise.all([document.fonts.load(`${w} 16px "Geist"`), document.fonts.load(`${w} 16px "Geist Fallback"`)]);
    const s = document.createElement("span");
    s.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden";
    document.body.append(s);
    const off = [];
    for (const w of [400, 500, 600]) for (const t of probes) {
      s.textContent = t;
      s.style.font = `${w} 16px "Geist"`;
      const g = s.getBoundingClientRect().width;
      s.style.font = `${w} 16px "Geist Fallback"`;
      const f = s.getBoundingClientRect().width;
      if (Math.abs(f / g - 1) > 0.02) off.push(`${w} "${t.slice(0, 24)}" ${((f / g - 1) * 100).toFixed(1)}%`);
    }
    s.remove();
    const sel = ["main .lede", ".site-footer__about"];
    const geist = sel.map((x) => getComputedStyle(document.querySelector(x)).maxInlineSize);
    const st = document.createElement("style");
    st.textContent = ':root{--font-sans:"Geist Fallback",Arial}';
    document.head.append(st);
    const fallback = sel.map((x) => getComputedStyle(document.querySelector(x)).maxInlineSize);
    st.remove();
    return { off, geist, fallback };
  }, PROBES);
  check(`${engine}: Geist Fallback stays within 2% of Geist's width at 400, 500 and 600`, () => assert.deepEqual(fonts.off, []));
  check(`${engine}: the lede and footer measures keep their width when the fallback font is laid out`, () => assert.deepEqual(fonts.fallback, fonts.geist));
  await done(p);

  p = await page("/about", { viewport: { width: 800, height: 900 } });
  await p.evaluate(() => scrollTo(0, 300));
  await p.waitForTimeout(200);
  const at = await p.evaluate(() => { const r = [...document.querySelectorAll("[data-nav-toggle]")].find((e) => e.offsetParent).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.click(at[0], at[1]);
  await p.waitForTimeout(300);
  const opened = await p.evaluate(() => document.documentElement.hasAttribute("data-nav-open"));
  await p.mouse.move(400, 500);
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(400);
  await p.keyboard.press("PageDown");
  await p.waitForTimeout(400);
  const held = await p.evaluate(() => Math.round(scrollY));
  await p.keyboard.press("Escape");
  const second = await p.evaluate(() => { const li = [...document.querySelectorAll(".footer-links--cols li")]; const x0 = Math.min(...li.map((l) => Math.round(l.getBoundingClientRect().left))); return li.find((l) => Math.round(l.getBoundingClientRect().left) !== x0)?.textContent.trim(); });
  check(`${engine}: /about at 800: the open menu holds the page at 300 under the wheel and PageDown`, () => assert.deepEqual([opened, held], [true, 300]));
  check(`${engine}: the footer's second Service areas column starts with JFK Airport`, () => assert.equal(second, "JFK Airport"));
  await done(p);

  p = await page("/schedule");
  const fields = await p.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    const h = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height);
    return { heights: [h("s-date"), h("s-time")], text: h("s-name"), colors: ["s-date", "s-time"].map((id) => getComputedStyle(document.getElementById(id)).color) };
  });
  check(`${engine}: /schedule: the empty date and time are as tall as a text field and read muted`, () => {
    assert.deepEqual(fields.heights, [fields.text, fields.text]);
    assert.deepEqual(fields.colors, ["rgb(110, 110, 115)", "rgb(110, 110, 115)"]);
  });
  await done(p);

  p = await page("/about", { reducedMotion: "no-preference" });
  await p.waitForTimeout(300);
  await Promise.all([p.waitForURL(`${base}/`), p.evaluate(() => document.querySelector("a.site-header__brand").click())]);
  await p.waitForTimeout(800);
  check(`${engine}: /about to / with motion allowed raises no page error`, () => assert.deepEqual(p.errors, []));
  await done(p);

  p = await page("/locations/manhattan", { reducedMotion: "no-preference", viewport: { width: 390, height: 844 } });
  await p.waitForFunction(() => document.querySelector("main .citymap:not(.citymap--hero)").hasAttribute("data-rv"));
  const rv = [await p.evaluate(() => document.querySelector("main .citymap:not(.citymap--hero)").getAttribute("data-rv"))];
  await p.evaluate(() => { const m = document.querySelector("main .citymap:not(.citymap--hero)"), r = m.getBoundingClientRect(); scrollTo({ top: scrollY + r.top - innerHeight + r.height * 0.3, behavior: "instant" }); });
  await p.waitForTimeout(400);
  rv.push(await p.evaluate(() => document.querySelector("main .citymap:not(.citymap--hero)").getAttribute("data-rv")));
  check(`${engine}: /locations/manhattan: the map below the fold waits with data-rv 0 and draws at 15% in view`, () => assert.deepEqual(rv, ["0", "1"]));
  await done(p);

  p = await page("/locations/jfk", { viewport: { width: 390, height: 844 } });
  const guesses = [];
  for (const path of ["/locations/jfk", "/black-car-service-brooklin", "/chauffeur-services-nyc", "/home"]) {
    await p.goto(base + path, { waitUntil: "load" });
    guesses.push(await p.evaluate(() => { const g = document.getElementById("nf-guess"), a = g.querySelector("a"); return a ? `${g.textContent} ${a.getAttribute("href")}` : g.textContent; }));
  }
  check(`${engine}: the 404 guesses the closest page and stays empty without one`, () => assert.deepEqual(guesses, ["Did you mean JFK Airport? /locations/jfk-airport", "Did you mean Black car service Brooklyn? /black-car-service-brooklyn", "Did you mean Chauffeur service NYC? /chauffeur-service-nyc", ""]));
  await done(p);

  for (const width of [390, 1440]) {
    p = await page("/limousine-service-nyc", { viewport: { width, height: 900 } });
    const step = await p.evaluate(() => {
      const sp = [...document.querySelectorAll("ol.steps>li")].map((l) => l.querySelector(".nowrap")).find(Boolean);
      const g = document.createRange();
      g.selectNodeContents(sp.previousSibling);
      const a = [...g.getClientRects()].pop();
      g.selectNodeContents(sp);
      const s = [...g.getClientRects()];
      return [Math.round(s[0].left - a.right), Math.round(s[0].top - a.top), s.length];
    });
    check(`${engine}: /limousine-service-nyc at ${width}: the steps' nowrap words run on in the sentence, unbroken`, () => assert.deepEqual(step, [0, 0, 1]));
    await done(p);
  }

  for (const width of [390, 1440]) {
    p = await page("/faq", { viewport: { width, height: 900 } });
    p.setDefaultTimeout(10000);
    let crashed = false;
    p.on("crash", () => (crashed = true));
    const shown = async (q) => {
      await p.fill("#faq-q", q);
      await p.waitForTimeout(150);
      return p.evaluate(() => [...document.querySelectorAll("main details")].filter((d) => !d.hidden).map((d) => d.id));
    };
    const spot = () => p.evaluate(() => [".faq-find", ".grid12>.rail"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY)).join());
    if (width === 1440) {
      const hits = {};
      try {
        for (const q of ["wifi", "Wi-Fi", "wi-fi", "internet", "meet and greet", "meet & greet", "meet&greet", "Meet&Greet", "bags", "luggage", "carseat", "baby seat", "refund", "tip", "ewr"]) hits[q] = await shown(q);
      } catch (e) {
        hits.error = String(e.message).split("\n")[0];
      }
      check(`${engine}: /faq: wifi and wi-fi find the Wi-Fi answer, meet & greet and meet&greet find what meet and greet finds, luggage what bags finds, and other everyday words find their answer`, () => {
        assert.equal(hits.error, undefined);
        for (const q of ["wifi", "Wi-Fi", "wi-fi", "internet"]) assert.deepEqual(hits[q], ["q-wifi"], q);
        assert.ok(hits["meet and greet"].length && hits.bags.length);
        assert.deepEqual([hits["meet & greet"], hits["meet&greet"], hits["Meet&Greet"], hits.luggage], [hits["meet and greet"], hits["meet and greet"], hits["meet and greet"], hits.bags]);
        assert.deepEqual([hits.carseat, hits["baby seat"], hits.refund, hits.tip, hits.ewr], [["q-child-seats"], ["q-child-seats"], ["q-cancellation"], ["q-tolls-and-gratuity"], ["q-airport-rates"]]);
      });
    }
    let none;
    try {
      const at = await spot();
      const ids = await shown("zzz");
      await p.evaluate(() => scrollBy(0, 400));
      await p.waitForTimeout(300);
      const [status, groups] = await p.evaluate(() => [document.getElementById("faq-n").textContent, [...document.querySelectorAll("main details")].filter((d) => !d.closest("section").hidden).length]);
      none = { ids, status, groups, moved: (await spot()) !== at, crashed };
    } catch (e) {
      none = { error: String(e.message).split("\n")[0], crashed };
    }
    check(`${engine}: /faq at ${width}: a search with no answer says so and hides every group, the field and the question groups stay in place, and the page keeps running`, () => assert.deepEqual(none, { ids: [], status: "No answers match. Try another word.", groups: 0, moved: false, crashed: false }));
    if (!crashed) {
      await p.press("#faq-q", "Escape");
      await p.waitForTimeout(150);
      const back = await p.evaluate(() => [document.querySelectorAll("main details[hidden]").length, document.getElementById("faq-n").textContent]);
      check(`${engine}: /faq at ${width}: Escape after a search with no answer shows every question again`, () => assert.deepEqual(back, [0, ""]));
    }
    if (!crashed && (await p.evaluate(() => CSS.supports("scroll-target-group", "auto")))) {
      const track = [];
      for (const q of ["jfk", ""]) {
        await p.fill("#faq-q", q);
        await p.waitForTimeout(150);
        track.push(await p.evaluate(() => getComputedStyle(document.querySelector(".toc")).scrollTargetGroup));
      }
      check(`${engine}: /faq at ${width}: while a search hides some groups the question groups list stops tracking them, and tracks them again once the field is empty`, () => assert.deepEqual(track, ["none", "auto"]));
    }
    await done(p);
  }

  for (const width of [390, 1440]) {
    p = await page("/", { viewport: { width, height: 900 }, javaScriptEnabled: false });
    const cards = [];
    for (const path of ["/", "/locations/jfk-airport", "/locations/manhattan"]) {
      if (path !== "/") await p.goto(base + path, { waitUntil: "load" });
      cards.push([path, await p.evaluate(() => {
        const f = document.getElementById("book-form"), card = getComputedStyle(f).backgroundColor;
        const lum = (s) => s.match(/[\d.]+/g).slice(0, 3).map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (e) => { const x = lum(getComputedStyle(e).color), y = lum(card); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const seen = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
        return {
          card,
          text: [...f.querySelectorAll("#bk-assure li, b, #q-mail, #q-wa")].filter((e) => seen(e) && e.textContent.trim() && ratio(e) < 4.5).map((e) => e.textContent.trim().slice(0, 24)),
          icons: [...f.querySelectorAll("#bk-assure .icon")].filter((e) => seen(e) && ratio(e) < 3).length,
        };
      })]);
    }
    check(`${engine}: JavaScript off at ${width}: on the white form card in the hero and the banners the trust row, its icons, the step names and the Email and WhatsApp buttons read dark`, () =>
      assert.deepEqual(cards.filter(([, r]) => r.card !== "rgb(255, 255, 255)" || r.text.length || r.icons), []));
    await done(p);
  }

  p = await page("/about");
  await p.route(/\/assets\/pay\.[^/]+\.js$/, (r) => r.abort());
  const glass = [];
  for (const [path, width] of [["/", 390], ["/locations/jfk-airport", 1440]]) {
    await p.setViewportSize({ width, height: 900 });
    await p.goto(base + path, { waitUntil: "load" });
    glass.push(await p.evaluate(() => {
      const li = [...document.querySelectorAll("#bk-assure li")].find((e) => e.getClientRects().length);
      return [document.getElementById("book-form").classList.contains("is-js"), getComputedStyle(li).color, getComputedStyle(li.querySelector(".icon")).color];
    }));
  }
  check(`${engine}: JavaScript on, before pay.js runs, the trust row reads ink-2 with gold-700 icons on the homepage floor and on the cream banner under the ink card`, () =>
    assert.deepEqual(glass, [[false, "rgb(80, 80, 85)", "rgb(133, 104, 35)"], [false, "rgb(80, 80, 85)", "rgb(133, 104, 35)"]]));
  await done(p);

  const menu = [];
  for (const path of ["/", "/book", "/about"]) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 } });
    await c.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    await c.route(/\/assets\/(?:lux|book)\.[\w-]+\.css$/, async (r) => { await new Promise((x) => setTimeout(x, 400)); await r.continue(); });
    await c.addInitScript(() => {
      window.__menu = 0;
      const f = () => {
        const n = document.getElementById("nav-panel"), s = n && document.styleSheets.length && getComputedStyle(n);
        if (s && s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.02) window.__menu++;
        if (performance.now() < 3000) requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    const q = await c.newPage();
    await q.goto(base + path, { waitUntil: "load" });
    await q.waitForTimeout(800);
    menu.push([path, await q.evaluate(() => window.__menu)]);
    await c.close();
  }
  check(`${engine}: with the stylesheets held back 400 ms, the site menu never shows while /, /book or /about load`, () => assert.deepEqual(menu, [["/", 0], ["/book", 0], ["/about", 0]]));

  const brand = [];
  for (let i = 0; i < 6; i++) {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await c.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    const q = await c.newPage();
    await q.goto(`${base}/`, { waitUntil: "load" });
    await q.waitForTimeout(500);
    brand.push(await q.evaluate(async () => {
      const n = document.querySelector(".site-header__bar .site-header__brand"), was = getComputedStyle(n).scale;
      document.documentElement.classList.add("is-scrolled");
      const moving = n.getAnimations().some((a) => a.transitionProperty === "scale");
      await Promise.all(n.getAnimations().map((a) => a.finished));
      return [was, moving, getComputedStyle(n).scale];
    }));
    await c.close();
  }
  check(`${engine}: at 1440x900 the homepage brand goes from 1.1 to 1 with a transition on the first scroll, 6 times out of 6`, () => assert.deepEqual(brand, Array(6).fill(["1.1", true, "1"])));
}

await engineChecks("chromium", browser);
for (const [engine, type] of [["webkit", webkit], ["firefox", firefox]]) {
  const b = await type.launch().catch(() => null);
  if (!b) {
    console.log(`  ..   ${engine} is not installed here, its engine checks are skipped`);
    continue;
  }
  await engineChecks(engine, b);
  await b.close();
}

{
  const p = await open({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  await p.goto(`${base}/contact`, { waitUntil: "load" });
  const hit = await p.evaluate(() => ["Copy", "Print or save as PDF"].map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lnk-btn";
    b.textContent = t;
    document.querySelector("main").append(b);
    const r = b.getBoundingClientRect(), a = getComputedStyle(b, "::after");
    const out = [Math.round(r.width), Math.round(r.width - parseFloat(a.left) - parseFloat(a.right)), Math.round(r.height - parseFloat(a.top) - parseFloat(a.bottom))];
    b.remove();
    return out;
  }));
  check("375 touch: a .lnk-btn hit area is at least 44x44 and no wider than a button that is already wider", () => {
    assert.ok(hit[0][1] >= 44 && hit[0][2] >= 44, `Copy ${hit[0][1]}x${hit[0][2]}`);
    assert.deepEqual([hit[1][1], hit[1][2] >= 44], [hit[1][0], true]);
  });
  await p.goto(`${base}/contact`, { waitUntil: "load" });
  await p.focus("#f-message");
  const bar = [await p.evaluate(() => getComputedStyle(document.querySelector(".actionbar")).visibility)];
  await p.evaluate(() => document.activeElement.blur());
  bar.push(await p.evaluate(() => getComputedStyle(document.querySelector(".actionbar")).visibility));
  check("/contact at 375: the action bar steps aside while the message field has focus and returns after", () => assert.deepEqual(bar, ["hidden", "visible"]));
  await p.close();
}

{
  const p = await open({ viewport: { width: 1366, height: 768 } });
  const rails = [];
  for (const path of ["/blog/jfk-lga-ewr-airport-transfer-guide-april-17", "/blog/manhattan-hourly-chauffeur-service-april-10", "/blog/whatsapp-airport-pickup-coordination-nyc-april-24", "/privacy-policy"]) {
    await p.goto(base + path, { waitUntil: "load" });
    rails.push(await p.evaluate(() => { const r = document.querySelector(".grid12>.rail"); scrollTo(0, r.getBoundingClientRect().top + scrollY + 300); return r.scrollHeight > r.clientHeight ? "cut" : getComputedStyle(r).position; }));
  }
  check("1366x768: the post rails show Call and All guides in full and the privacy rail still sticks", () => assert.deepEqual(rails, ["static", "static", "static", "sticky"]));
  await p.close();
}

{
  const p = await open({ viewport: { width: 320, height: 568 } });
  await p.goto(`${base}/fleet`, { waitUntil: "load" });
  await p.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-bottom:2em !important}" });
  const spaced = await p.evaluate(() => {
    const g = document.createRange();
    const rects = (n) => { g.selectNodeContents(n); return [...g.getClientRects()].filter((x) => x.width > 1); };
    const spill = [...document.querySelectorAll(".fleet-card")].filter((c) => { const q = c.getBoundingClientRect(); return [...c.querySelectorAll(".nowrap")].some((s) => rects(s).some((x) => x.right > q.right + 0.5)); }).length;
    const cell = document.querySelector(".actionbar__cell--book"), q = cell.getBoundingClientRect();
    return [spill, rects(cell).every((x) => x.left >= q.left - 0.5 && x.right <= q.right + 0.5)];
  });
  check("/fleet at 320 with WCAG text spacing: no seat line crosses its card and Book a car stays inside its pill", () => assert.deepEqual(spaced, [0, true]));
  await p.close();
}

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} redesign assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll redesign browser tests passed");
process.exit(0);
