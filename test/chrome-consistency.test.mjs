import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const BOOK = "https://customer.moovs.app/nyc-lux-ride/request/new";

const SECTIONS = {
  "/services": ["chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html"],
  "/contact": ["schedule.html", "card-authorization.html"],
  "/locations": (f) => f.startsWith("locations/"),
  "/blog": (f) => f.startsWith("blog/"),
};
const HEADER_NAV = ["/services", "/fleet", "/rates", "/locations", "/faq"];
const PANEL_NAV = ["/rates", "/services", "/fleet", "/locations", "/faq", "/blog", "/about", "/contact"];
const FOOTER = {
  Book: [BOOK, "/rates", "/schedule", "/card-authorization"],
  Services: ["/services", "/fleet", "/chauffeur-service-nyc", "/limousine-service-nyc", "/black-car-service-brooklyn"],
  Company: ["/about", "/contact", "/faq", "/blog", "/privacy-policy", "/terms-of-service"],
};

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "cdn-cgi"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

const route = (f) => (f === "index.html" ? "/" : `/${f.replace(/\.html$/, "")}`);
const parentOf = (f) =>
  Object.entries(SECTIONS).find(([, m]) => (typeof m === "function" ? m(f) : m.includes(f)))?.[0] || null;

function block(html, open, close) {
  const starts = html.split(open).length - 1;
  assert.equal(starts, 1, `expected one ${open}, found ${starts}`);
  const s = html.indexOf(open);
  return html.slice(s, html.indexOf(close, s) + close.length);
}

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

const FILES = htmlFiles(ROOT);
check("page discovery found the site", () => assert.ok(FILES.length >= 30, `only ${FILES.length} html files`));

const shared = { header: new Map(), footer: new Map(), actionbar: new Map() };
for (const file of FILES) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const { document } = new JSDOM(html).window;
  const hrefs = (sel) => [...document.querySelectorAll(sel)].map((a) => a.getAttribute("href"));

  check(`${file}: one header, footer and action bar`, () => {
    shared.header.set(file, block(html, '<header class="site-header">', "</header>").replace(/ aria-current="[^"]*"/g, ""));
    shared.footer.set(file, block(html, '<footer class="site-footer">', "</footer>"));
    shared.actionbar.set(file, block(html, '<nav class="actionbar"', "</nav>"));
  });

  check(`${file}: header row is logo, five links, phone, WhatsApp and Book a car`, () => {
    assert.deepEqual(hrefs(".site-nav a"), HEADER_NAV);
    assert.deepEqual(hrefs(".site-header__desk a").map((h) => h.split("?")[0]), ["tel:+16467750556", "https://wa.me/16467750556", BOOK]);
    assert.equal(document.querySelector(".site-header__desk .tel").textContent.trim(), "+1 (646) 775-0556");
    assert.equal(document.querySelector('.site-header__desk a[href^="https://wa.me/"]').getAttribute("aria-label"), "WhatsApp");
  });

  check(`${file}: menu panel order is Book a car, sections, then Call and WhatsApp`, () => {
    const panel = document.getElementById("nav-panel");
    const links = [...panel.querySelectorAll("a")];
    assert.equal(links[0].getAttribute("href"), BOOK);
    assert.equal(links[0].textContent.trim(), "Book a car");
    assert.deepEqual(hrefs(".nav-panel__list > li > a"), PANEL_NAV);
    const areas = hrefs('.nav-panel__list > li > a[href="/locations"] + .nav-panel__areas a');
    assert.equal(areas.length, 12, `${areas.length} area links under Service areas`);
    assert.deepEqual(links.slice(-2).map((a) => a.getAttribute("href").split("?")[0]), ["tel:+16467750556", "https://wa.me/16467750556"]);
  });

  check(`${file}: aria-current marks the page or its parent section and nothing else`, () => {
    const marked = [...document.querySelectorAll("header [aria-current]")].map((a) => `${a.getAttribute("href")}=${a.getAttribute("aria-current")}`);
    const own = route(file);
    const parent = parentOf(file);
    const expected = [];
    if (own === "/") expected.push("/=page");
    else if (PANEL_NAV.includes(own)) {
      if (HEADER_NAV.includes(own)) expected.push(`${own}=page`);
      expected.push(`${own}=page`);
    } else if (parent) {
      if (HEADER_NAV.includes(parent)) expected.push(`${parent}=true`);
      expected.push(`${parent}=true`);
    }
    assert.deepEqual(marked, expected);
    assert.equal(document.querySelectorAll("footer [aria-current]").length, 0, "footer carries aria-current");
  });

  check(`${file}: footer columns are Book, Services, Service areas and Company`, () => {
    const cols = [...document.querySelectorAll(".site-footer nav")].map((n) => n.querySelector("h2").textContent.trim());
    assert.deepEqual(cols, ["Book", "Services", "Service areas", "Company"]);
    for (const [title, want] of Object.entries(FOOTER)) {
      const nav = [...document.querySelectorAll(".site-footer nav")].find((n) => n.querySelector("h2").textContent.trim() === title);
      assert.deepEqual([...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")), want, title);
    }
    assert.equal(document.querySelectorAll(".site-footer nav .footer-links--cols a").length, 13);
  });

  check(`${file}: every booking link reads Book a car`, () => {
    const off = [...document.querySelectorAll('a[href^="https://customer.moovs.app/"]')]
      .map((a) => a.textContent.replace(/\s+/g, " ").trim())
      .filter((t) => t !== "Book a car");
    assert.deepEqual(off, []);
  });
}

for (const [name, map] of Object.entries(shared)) {
  check(`the ${name} is byte-identical on every page${name === "header" ? " apart from aria-current" : ""}`, () => {
    const variants = new Set(map.values());
    assert.equal(map.size, FILES.length, `${map.size} of ${FILES.length} pages parsed`);
    assert.equal(variants.size, 1, `${variants.size} variants`);
  });
}

if (failures) {
  console.error(`\n${failures} chrome assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll chrome consistency tests passed");
process.exit(0);
