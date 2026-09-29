import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright";

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
const BUDGETS = [
  [/^lux\..*\.css$/, 52000],
  [/^lux\..*\.js$/, 6144],
];


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
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/\/+$/, "") || "/";
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
    console.error(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`);
  }
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const sitewide = new Map();

for (const route of PAGES) {
  if (!resolvePath(route)) {
    failures++;
    console.error(`  FAIL ${route}: page does not exist`);
    continue;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/googletagmanager|google-analytics|net::ERR/.test(m.text())) errors.push(m.text());
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
      archivoLoaded: document.fonts.check('600 24px "Archivo"'),
      serifLoaded: document.fonts.check('400 18px "Source Serif 4"'),
      loadedFaces: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      bodyFont: styleOf("body", "fontFamily"),
      h1Font: styleOf("h1", "fontFamily"),
      bg: styleOf("body", "backgroundColor"),
      text: document.body.innerText,
      imgs: [...document.querySelectorAll("img")].map((n) => ({
        w: n.getAttribute("width"),
        h: n.getAttribute("height"),
        alt: n.getAttribute("alt"),
        decorative: !!n.closest(".note__thumb"),
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
  check(`${route}: Archivo actually renders`, () => {
    assert.ok(s.archivoLoaded, "document.fonts.check failed for Archivo");
    assert.match(s.h1Font, /Archivo/);
  });
  check(`${route}: Source Serif 4 actually renders`, () => {
    assert.ok(s.serifLoaded, "document.fonts.check failed for Source Serif 4");
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
    assert.equal(s.bg, "rgb(8, 9, 12)");
  });
  check(`${route}: no horizontal overflow at 1280px`, () => {
    assert.ok(s.scrollW <= s.clientW + 1, `overflows by ${s.scrollW - s.clientW}px`);
  });

  for (const w of [390, 1200, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
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

  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.waitForTimeout(120);
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
    details: document.querySelectorAll("details").length,
    text: document.body.innerText.length,
    fleetSets: document.querySelectorAll(".fleet-set").length,
  }));
  check(`${route}: usable with javascript disabled (${r.links} links, ${r.text} chars)`, () => {
    assert.ok(r.links >= 15, `only ${r.links} links`);
    assert.ok(r.text > 800, `only ${r.text} chars of text`);
  });
  if (route === "/faq") {
    check(`/faq: 19 native details elements render without javascript`, () => {
      assert.equal(r.details, 19);
    });
    const answers = await p.evaluate(() => document.body.textContent);
    check(`/faq: answers are in the static html, not javascript`, () => {
      assert.match(answers, /24 hours in advance/);
    });
  }
  if (route === "/fleet") {
    check(`/fleet: tier sets render without javascript`, () => assert.ok(r.fleetSets >= 4, `${r.fleetSets} sets`));
  }
  await p.close();
}
await nojs.close();

const kb = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${base}/`, { waitUntil: "load" });
const barAt = () => phone.evaluate(() => document.querySelector(".actionbar").getBoundingClientRect().top);
const barFirst = await barAt();
check(`/: the action bar starts below the first screen while the trip form is in view (${Math.round(barFirst)}px)`, () =>
  assert.ok(barFirst >= 844, `bar starts at ${barFirst}`));
await phone.evaluate(() => scrollTo(0, innerHeight));
await phone.waitForTimeout(150);
const barLater = await barAt();
check(`/: the action bar is on screen once the trip form scrolls away (${Math.round(barLater)}px)`, () =>
  assert.ok(barLater < 844 - 40, `bar starts at ${barLater}`));
await phone.fill("#trip-pick", "JFK Airport");
await phone.fill("#trip-drop", "350 Fifth Avenue");
await phone.fill("#trip-date", "2030-10-13");
await phone.fill("#trip-time", "14:00");
const hrefs = await phone.evaluate(() => [...document.querySelectorAll('a[href^="https://customer.moovs.app/"]')].map((a) => a.getAttribute("href")));
check(`/: every Book a car link carries the trip typed into the form (${hrefs.length} links)`, () => {
  assert.ok(hrefs.length >= 3, `${hrefs.length} links`);
  assert.deepEqual([...new Set(hrefs)].length, 1, "links differ");
  assert.match(hrefs[0], /\/new\/vehicle\?trip=/);
});
await phone.close();

const miss = await fetch(`${base}/no/such/page`);
const missBody = await miss.text();
check("unmatched routes return 404.html with status 404 and noindex", () => {
  assert.equal(miss.status, 404);
  assert.match(missBody, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(missBody, /rel="canonical"/);
});

await browser.close();
server.close();

for (const [pattern, budget] of BUDGETS) {
  const names = readdirSync(join(ROOT, "assets")).filter((f) => pattern.test(f));
  check(`budget: exactly one asset matches ${pattern}`, () => assert.equal(names.length, 1, names.join(", ")));
  for (const name of names) {
    const bytes = statSync(join(ROOT, "assets", name)).size;
    check(`budget: ${name} is ${bytes} bytes, under ${budget}`, () =>
      assert.ok(bytes <= budget, `${bytes} exceeds ${budget} by ${bytes - budget}`));
  }
}

if (failures) {
  console.error(`\n${failures} redesign assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll redesign browser tests passed");
process.exit(0);
