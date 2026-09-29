import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const FIXTURE = join(ROOT, "test/fixtures/lcp-baseline.json");
const TIMING = process.env.LCP_TIMING === "1";
const RECORD = process.env.LCP_RECORD === "1";
const POST = "/blog/jfk-lga-ewr-airport-transfer-guide-april-17";
const ROUTES = ["/", "/locations/manhattan", "/rates", "/locations/bronx", "/locations/jfk-airport", "/book", POST];
const PRELOADED = new Set(["/", "/locations/manhattan", "/locations/bronx", "/locations/jfk-airport", POST]);
const FONTS = ["geist-latin", "castoro-latin", "archivo-wordmark"];
const VIEWPORTS = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 } },
};
const THROTTLE = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
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
const GZIP = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".xml", ".txt", ".svg"]);

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
  const packed = new Map();
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const file = resolvePath(req.url);
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      const headers = { "content-type": MIME[extname(file)] || "application/octet-stream" };
      let body = readFileSync(file);
      if (GZIP.has(extname(file))) {
        headers.vary = "accept-encoding";
        if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
          if (!packed.has(file)) packed.set(file, gzipSync(body));
          body = packed.get(file);
          headers["content-encoding"] = "gzip";
        }
      }
      res.writeHead(200, headers);
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 8).join("\n       ")}`);
  }
}

const LCP_PROBE = () => {
  window.__lcp = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const el = e.element;
      window.__lcp.push({
        t: e.startTime,
        size: e.size,
        el: el ? `${el.nodeName.toLowerCase()}.${String(el.className || "").split(" ")[0]}` : "removed node",
        inHero: !!(el && el.closest && el.closest("figure.hero__photo, figure.banner__photo")),
        inBand: !!(el && el.closest && el.closest("main section.band")),
        inLead: !!(el && el.closest && el.closest("figure") && el.closest("figure") === document.querySelector("main figure")),
        twin: !!(el && el.matches && el.matches("img.plate__twin")),
      });
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
};

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

async function load(route, width, throttled) {
  const ctx = await browser.newContext(VIEWPORTS[width]);
  await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => {
    if (r.url().startsWith(base)) requests.push(new URL(r.url()).pathname);
  });
  await page.addInitScript(LCP_PROBE);
  if (throttled) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", THROTTLE);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(throttled ? 2500 : 1200);
  const s = await page.evaluate((lead) => {
    const list = (v) => (v || "").split(",").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
    const fig = lead ? document.querySelector("main figure") : document.querySelector("figure.hero__photo, figure.banner__photo");
    const img = fig && fig.querySelector("picture img");
    const cands = fig ? [...fig.querySelectorAll("source[srcset], img[srcset]")].flatMap((n) => list(n.getAttribute("srcset"))) : [];
    if (img && img.getAttribute("src")) cands.push(img.getAttribute("src"));
    const preloads = [...document.querySelectorAll('link[rel="preload"][as="image"]')]
      .filter((l) => !l.media || matchMedia(l.media).matches)
      .flatMap((l) => [...list(l.getAttribute("imagesrcset")), ...(l.getAttribute("href") ? [l.getAttribute("href")] : [])]);
    const blocking = [...document.querySelectorAll("script[src]")]
      .filter((n) => (!n.defer && !n.async && n.type !== "module") || /\brender\b/.test(n.getAttribute("blocking") || ""))
      .map((n) => n.getAttribute("src"));
    const blockingRes = performance
      .getEntriesByType("resource")
      .filter((e) => e.initiatorType === "script" && e.renderBlockingStatus === "blocking")
      .map((e) => new URL(e.name).pathname);
    return {
      lcp: window.__lcp,
      fig: fig ? fig.className : null,
      current: img && img.currentSrc ? new URL(img.currentSrc).pathname : null,
      cands: cands.map((u) => new URL(u, location.href).pathname),
      preloads: preloads.map((u) => new URL(u, location.href).pathname),
      fontPreloads: [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => new URL(l.href).pathname),
      blocking: [...blocking, ...blockingRes],
    };
  }, route === POST);
  await ctx.close();
  return { ...s, requests };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

if (!RECORD) {
  for (const route of ROUTES) {
    for (const width of [390, 1440]) {
      const s = await load(route, width, false);
      const last = s.lcp[s.lcp.length - 1];
      const where = route === "/book" ? "inside main section.band" : route === POST ? "inside the lead figure" : "inside the hero or banner photo";
      check(`${route} at ${width}px: the LCP element is ${where} (${last ? last.el : "none"})`, () => {
        if (route === "/book") return assert.ok(last && last.inBand, `LCP element ${last && last.el}`);
        assert.ok(s.fig, route === POST ? "no lead figure in main" : "no figure.hero__photo or figure.banner__photo on the page");
        assert.ok(last && (route === POST ? last.inLead : last.inHero), `LCP element ${last && last.el}`);
      });
      check(`${route} at ${width}px: the LCP element is never img.plate__twin`, () => assert.ok(!s.lcp.some((e) => e.twin), JSON.stringify(s.lcp.map((e) => e.el))));
      if (route !== "/book") {
        check(`${route} at ${width}px: the ${route === POST ? "lead" : "hero or banner"} image is requested once`, () => {
          const hits = s.requests.filter((p) => s.cands.includes(p));
          assert.equal(hits.length, 1, `requested ${JSON.stringify(hits)}`);
        });
      }
      if (PRELOADED.has(route)) {
        check(`${route} at ${width}px: the image the page shows is a candidate of its preload`, () => {
          assert.ok(s.preloads.length > 0, "no image preload");
          assert.ok(s.preloads.includes(s.current), `${s.current} is not in ${JSON.stringify(s.preloads)}`);
        });
      }
      check(`${route} at ${width}px: at most the three fonts are requested and each was preloaded`, () => {
        const fonts = s.requests.filter((p) => p.endsWith(".woff2"));
        assert.ok(fonts.length <= 3, `${fonts.length} fonts: ${fonts.join(", ")}`);
        for (const f of fonts) {
          assert.ok(FONTS.some((n) => f.includes(`/${n}.`)), `${f} is not one of ${FONTS.join(", ")}`);
          assert.ok(s.fontPreloads.includes(f), `${f} was not preloaded`);
        }
      });
      if (route === "/book") {
        check(`${route} at ${width}px: the only render-blocking script is /assets/pay.*.js`, () =>
          assert.deepEqual([...new Set(s.blocking.map((p) => p.replace(/^\/assets\/pay\.[A-Za-z0-9_-]+\.js$/, "/assets/pay.*.js")))], ["/assets/pay.*.js"]));
      } else {
        check(`${route} at ${width}px: no render-blocking script`, () => assert.deepEqual(s.blocking, []));
      }
    }
  }
}

if (TIMING || RECORD) {
  const timings = {};
  for (const route of ROUTES) {
    timings[route] = {};
    for (const width of [390, 1440]) {
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const s = await load(route, width, true);
        const last = s.lcp[s.lcp.length - 1];
        runs.push(last ? Math.round(last.t) : Infinity);
      }
      timings[route][width] = median(runs);
      console.log(`  ..   ${route} at ${width}px: LCP runs ${runs.join(", ")} ms, median ${timings[route][width]} ms`);
    }
  }
  if (RECORD) {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify({ recorded: new Date().toISOString(), throttle: { latency: 150, downKbps: 1638.4, upKbps: 750, cpu: 4 }, encoding: "gzip", median: timings }, null, 1)}\n`);
    console.log(`  ok   recorded ${FIXTURE}`);
  } else {
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
    check("the baseline was recorded with gzip responses, like the timed runs", () => assert.equal(fixture.encoding, "gzip"));
    const baseline = fixture.median;
    for (const route of ROUTES) {
      for (const width of [390, 1440]) {
        const limit = Math.round(baseline[route][width] * 1.1 + 50);
        check(`${route} at ${width}px: median LCP ${timings[route][width]} ms is at most ${limit} ms (baseline ${baseline[route][width]} ms)`, () =>
          assert.ok(timings[route][width] <= limit));
      }
    }
  }
}

await browser.close();
server.close();

if (failures) {
  console.error(`\n${failures} lcp budget assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll lcp budget tests passed");
process.exit(0);
