import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const BOOK = "/book";

const SECTIONS = {
  "/services": ["chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html"],
  "/contact": ["schedule.html", "card-authorization.html"],
  "/locations": (f) => f.startsWith("locations/"),
  "/blog": (f) => f.startsWith("blog/"),
};
const HEADER_NAV = ["/services", "/fleet", "/rates", "/locations", "/faq"];
const PANEL_NAV = ["/services", "/fleet", "/rates", "/faq", "/blog", "/about", "/contact"];
const PANEL_ORDER = ["/", "/book", "/services", "/fleet", "/rates", "/locations"];
const AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "jfk-airport", "laguardia-airport", "long-island-city", "soho", "upper-east-side", "upper-west-side", "financial-district"].map((a) => `/locations/${a}`);
const BOOKING_PAGES = ["index.html", "book.html", "booking-confirmed.html", "services.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", ...["jfk-airport", "laguardia-airport", "manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"].map((a) => `locations/${a}.html`)];
const FOOTER = {
  Book: [BOOK, "/rates", "/schedule", "/card-authorization"],
  Services: ["/services", "/fleet", "/chauffeur-service-nyc", "/limousine-service-nyc", "/black-car-service-brooklyn"],
  Company: ["/about", "/contact", "/faq", "/blog", "/privacy-policy", "/terms-of-service"],
};
const WA = "https://wa.me/16467750556?text=Hi%20NYC%20LUX%20RIDE%2C%20I%27d%20like%20to%20book%20a%20ride.";
const FOOTER_ABOUT = "Black car and SUV service with a chauffeur in New York City. Flat airport rates, cars by the hour across the five boroughs, and corporate accounts billed monthly.";
const TOPBAR = [
  '<div class="topbar">',
  '<div class="frame topbar__row">',
  '<a class="topbar__link" href="mailto:info@nycluxride.com"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-mail"></use></svg><span>info@nycluxride.com</span></a>',
  `<p class="topbar__end"><a class="topbar__link" href="tel:+16467750556"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone"></use></svg><span>+1 (646) 775-0556</span></a> <a class="topbar__link" href="${WA}" target="_blank" rel="noopener" data-wa><svg class="icon icon--fill" aria-hidden="true" focusable="false"><use href="#i-whatsapp"></use></svg><span>WhatsApp</span></a></p>`,
  "</div>",
  "</div>",
].join("\n");
const NEW_SYMBOLS = [
  '<symbol id="i-building" viewBox="0 0 24 24"><path d="M5 20.5V4.5h9v16M14 9h5v11.5M3.5 20.5h17M8 8h3M8 11.5h3M8 15h3"/></symbol>',
  '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>',
  '<symbol id="i-user" viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0"/></symbol>',
  '<symbol id="i-users" viewBox="0 0 24 24"><path d="M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14a6.5 6.5 0 0 1 4 6"/></symbol>',
  '<symbol id="i-sign" viewBox="0 0 24 24"><path d="M4 4.5h16v9H4zM8 8h8M8 10.5h5M12 13.5v7M9 20.5h6"/></symbol>',
  '<symbol id="i-child" viewBox="0 0 24 24"><path d="M12 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 12 8zM8.5 21l1-6.5h5l1 6.5M7 11.5l5 2 5-2"/></symbol>',
  '<symbol id="i-lock" viewBox="0 0 24 24"><path d="M6 10.5h12v10H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5"/></symbol>',
  '<symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></symbol>',
  '<symbol id="i-swap" viewBox="0 0 24 24"><path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5"/></symbol>',
  '<symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>',
].join("\n");
const FONT_PRELOADS = [
  '<link rel="preload" href="/assets/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="/assets/fonts/castoro-latin.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="/assets/fonts/archivo-wordmark.woff2" as="font" type="font/woff2" crossorigin>',
];
const fontPreload = (href) => href.replace(/\.[A-Za-z0-9_-]{6,}\.woff2$/, ".woff2");
const REVIEWS = "https://maps.app.goo.gl/6dGNLcMvGazKFzkc7?g_st=iw";
const SOCIAL = ["https://www.instagram.com/nycluxride/", "https://www.facebook.com/nycluxride", "https://www.tiktok.com/@nycluxride.com"];
const SPRITE = readFileSync(join(ROOT, "assets/icons.svg.html"), "utf8").trim();
const BOOKING_WA = ["q-wa", "bk-bar-wa"];
const waPlace = (a) =>
  a.closest(".topbar") ? "top bar" :
  a.closest(".site-header__desk") ? "header" :
  a.closest(".nav-panel__foot") ? "menu panel" :
  a.closest(".site-footer") ? "footer" :
  a.closest(".actionbar") ? "action bar" :
  `#${a.id || a.tagName.toLowerCase()}`;

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
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

const FILES = htmlFiles(ROOT);
check("page discovery found the site", () => assert.ok(FILES.length >= 30, `only ${FILES.length} html files`));

check("assets/icons.svg.html ends its defs with i-building, i-plus, i-user, i-users, i-sign, i-child, i-lock, i-edit, i-swap and i-minus", () =>
  assert.ok(SPRITE.endsWith(`${NEW_SYMBOLS}\n</defs>\n</svg>`), "the ten symbols are not the last ones in the sprite, byte exact"));

const shared = { header: new Map(), footer: new Map(), actionbar: new Map(), sprite: new Map() };
for (const file of FILES) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const { document } = new JSDOM(html).window;
  const hrefs = (sel) => [...document.querySelectorAll(sel)].map((a) => a.getAttribute("href"));

  check(`${file}: one header, footer and action bar`, () => {
    shared.header.set(file, block(html, '<header class="site-header">', "</header>").replace(/ aria-current="[^"]*"/g, ""));
    shared.footer.set(file, block(html, '<footer class="site-footer">', "</footer>"));
    shared.actionbar.set(file, block(html, '<nav class="actionbar"', "</nav>"));
  });

  check(`${file}: the sprite is the first element of the body and equals assets/icons.svg.html`, () => {
    const sprite = block(html, '<svg width="0" height="0"', "</svg>");
    shared.sprite.set(file, sprite);
    assert.equal(document.body.firstElementChild.outerHTML.startsWith('<svg width="0" height="0"'), true, "the sprite is not the first element after <body>");
    assert.equal(sprite, SPRITE);
  });

  check(`${file}: the top bar is the first thing in the header, byte exact`, () => {
    assert.ok(html.includes(`<header class="site-header">\n${TOPBAR}\n<div class="frame">`), "the top bar markup differs or is not the first child of the header");
    const bar = document.querySelector("header.site-header").firstElementChild;
    assert.ok(bar.matches("div.topbar"));
    assert.deepEqual(
      [...bar.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent.trim(), a.hasAttribute("data-wa")]),
      [["mailto:info@nycluxride.com", "info@nycluxride.com", false], ["tel:+16467750556", "+1 (646) 775-0556", false], [WA, "WhatsApp", true]]
    );
  });

  check(`${file}: header row is logo, five links, phone, WhatsApp and Book a car`, () => {
    assert.deepEqual(hrefs(".site-nav a"), HEADER_NAV);
    assert.deepEqual(hrefs(".site-header__desk a").map((h) => h.split("?")[0]), ["tel:+16467750556", "https://wa.me/16467750556", BOOK]);
    assert.equal(document.querySelector(".site-header__desk .tel").textContent.trim(), "+1 (646) 775-0556");
    const wa = document.querySelector('.site-header__desk a[href^="https://wa.me/"]');
    assert.ok(wa.matches("a.tel.tel--wa[data-wa]"), "the header WhatsApp link is not a.tel.tel--wa[data-wa]");
    assert.equal(wa.textContent.trim(), "WhatsApp");
    assert.equal(wa.querySelector("span")?.textContent, "WhatsApp");
    assert.equal(wa.getAttribute("aria-label"), null, "the visible label names the link, aria-label must go");
    assert.equal(document.querySelector(".site-header__desk a.btn").textContent.trim(), "Book a car");
  });

  check(`${file}: every chrome WhatsApp link carries data-wa, the default text and opens a new tab`, () => {
    const chrome = [...document.querySelectorAll("[data-wa]")].filter((a) => !BOOKING_WA.includes(a.id));
    assert.deepEqual(chrome.map(waPlace), ["top bar", "header", "menu panel", "footer", "action bar"]);
    for (const a of chrome) {
      assert.equal(a.tagName, "A");
      assert.equal(a.getAttribute("data-wa"), "", `${waPlace(a)}: data-wa must be a boolean attribute`);
      assert.deepEqual([a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")], [WA, "_blank", "noopener"], waPlace(a));
    }
    const unmarked = [...document.querySelectorAll(".site-header a, .site-footer a, .actionbar a")].filter((a) => a.getAttribute("href").startsWith("https://wa.me/") && !a.hasAttribute("data-wa"));
    assert.deepEqual(unmarked.map(waPlace), []);
    assert.ok(document.querySelector(".nav-panel__foot a.btn.btn--ghost[data-wa]").textContent.trim() === "WhatsApp", "menu panel WhatsApp text");
    assert.equal(document.querySelector(".site-footer a.tel[data-wa]").textContent.trim(), "WhatsApp");
  });

  check(`${file}: action bar is Call, a labeled WhatsApp and Book a car`, () => {
    const cells = [...document.querySelectorAll(".actionbar > a")];
    assert.deepEqual(cells.map((a) => a.getAttribute("href")), ["tel:+16467750556", WA, BOOK]);
    assert.ok(cells[1].matches(".actionbar__cell.actionbar__cell--wa[data-wa]"), "the WhatsApp cell is not .actionbar__cell--wa[data-wa]");
    assert.equal(cells[1].querySelector("span")?.textContent, "WhatsApp");
    assert.ok(cells[2].matches(".actionbar__cell--book"));
    assert.equal(cells[2].textContent.trim(), "Book a car");
  });

  check(`${file}: menu panel order is the brand, Book a car, the sections in the desktop order with the areas in a closed disclosure, then Call and WhatsApp`, () => {
    const panel = document.getElementById("nav-panel");
    const links = [...panel.querySelectorAll("a")];
    assert.deepEqual(links.slice(0, 6).map((a) => a.getAttribute("href")), PANEL_ORDER);
    assert.ok(links[0].matches(".nav-panel__head > a.nav-panel__brand"), "the first menu link is not the wordmark in the head");
    assert.equal(links[0].querySelector(".sr-only")?.textContent, "NYC LUX RIDE, home");
    assert.ok(panel.querySelector(".nav-panel__head > [data-nav-close]"), "Close is not in the sticky head");
    assert.equal(links[1].textContent.trim(), "Book a car");
    assert.deepEqual(hrefs(".nav-panel__list > li > a"), PANEL_NAV);
    const more = panel.querySelector(".nav-panel__list > li > details.nav-panel__more");
    assert.ok(more, "no Service areas disclosure");
    assert.equal(more.hasAttribute("open"), false, "the disclosure must be closed in the markup");
    assert.equal(more.querySelector("summary").textContent.trim(), "Service areas");
    assert.equal([...panel.querySelectorAll(".nav-panel__list > li")].indexOf(more.parentElement), 3, "Service areas is not the fourth row");
    assert.deepEqual(hrefs(".nav-panel__more .nav-panel__areas a"), ["/locations", ...AREAS]);
    assert.equal(more.querySelector('.nav-panel__areas a[href="/locations"]').textContent.trim(), "All service areas");
    assert.equal(panel.querySelectorAll('.nav-panel__list a use[href="#i-arrow"]').length, 0, "menu rows still carry arrows");
    assert.deepEqual(links.slice(-2).map((a) => a.getAttribute("href").split("?")[0]), ["tel:+16467750556", "https://wa.me/16467750556"]);
  });

  check(`${file}: book.css is linked ${BOOKING_PAGES.includes(file) ? "on the line after lux.css" : "nowhere"}`, () => {
    const head = html.slice(0, html.indexOf("</head>"));
    const book = [...head.matchAll(/<link rel="stylesheet" href="\/assets\/book\.[A-Za-z0-9_-]+\.css">/g)];
    if (!BOOKING_PAGES.includes(file)) return assert.equal(book.length, 0);
    assert.equal(book.length, 1);
    assert.match(head, /<link rel="stylesheet" href="\/assets\/lux\.[A-Za-z0-9_-]+\.css">\n<link rel="stylesheet" href="\/assets\/book\.[A-Za-z0-9_-]+\.css">\n/);
  });

  check(`${file}: aria-current marks the page or its parent section and nothing else`, () => {
    const marked = [...document.querySelectorAll("header [aria-current]")].map((a) => `${a.getAttribute("href")}=${a.getAttribute("aria-current")}`);
    const own = route(file);
    const parent = parentOf(file);
    const expected = [];
    if (own === "/") expected.push("/=page");
    else if ([...PANEL_NAV, "/locations"].includes(own)) {
      if (HEADER_NAV.includes(own)) expected.push(`${own}=page`);
      expected.push(`${own}=page`);
    } else if (parent) {
      if (HEADER_NAV.includes(parent)) expected.push(`${parent}=true`);
      expected.push(`${parent}=true`);
    }
    assert.deepEqual(marked, expected);
    assert.equal(document.querySelectorAll("footer [aria-current]").length, 0, "footer carries aria-current");
  });

  check(`${file}: the footer top row is the brand, the phone, the email and WhatsApp, the bottom row the copyright, the reviews and three social links`, () => {
    const top = document.querySelector(".site-footer__top");
    assert.ok(top, "no .site-footer__top");
    assert.deepEqual([...top.querySelectorAll("a")].map((a) => a.getAttribute("href").split("?")[0]), ["/", "tel:+16467750556", "mailto:info@nycluxride.com", "https://wa.me/16467750556"]);
    const bottom = document.querySelector(".site-footer__bottom");
    assert.ok(bottom, "no .site-footer__bottom");
    assert.equal(bottom.querySelector("p").textContent.trim(), "Copyright 2026 NYC LUX RIDE, New York, NY.");
    const reviews = [...bottom.querySelectorAll("a")].find((a) => a.getAttribute("href") === REVIEWS);
    assert.ok(reviews, "no reviews link in the bottom row");
    assert.deepEqual([reviews.textContent.trim(), reviews.getAttribute("target"), !!reviews.querySelector('svg[aria-hidden="true"] use[href="#i-external"]')], ["Read the reviews on Google Maps (opens in a new tab)", "_blank", true]);
    assert.deepEqual([...bottom.querySelectorAll(".social a")].map((a) => a.getAttribute("href")), SOCIAL);
    assert.equal(document.querySelectorAll('.site-footer use[href="#i-star"]').length, 0, "the footer still uses i-star");
  });

  check(`${file}: theme-color is #FBF8F2 and the head preloads exactly the three fonts in order`, () => {
    assert.deepEqual([...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")), ["#FBF8F2"]);
    const head = html.slice(0, html.indexOf("</head>"));
    const tags = [...head.matchAll(/<link rel="preload"[^>]*as="font"[^>]*>/g)].map((m) => m[0]);
    const fonts = tags.map((t) => t.replace(/href="([^"]+)"/, (_, h) => `href="${fontPreload(h)}"`));
    assert.deepEqual(fonts, FONT_PRELOADS);
    assert.ok(head.includes(tags.join("")), "the font preloads are not one line in this order");
  });

  check(`${file}: footer columns are Book, Services, Service areas and Company`, () => {
    const cols = [...document.querySelectorAll(".site-footer nav")].map((n) => n.querySelector("h2").textContent.trim());
    assert.deepEqual(cols, ["Book", "Services", "Service areas", "Company"]);
    for (const [title, want] of Object.entries(FOOTER)) {
      const nav = [...document.querySelectorAll(".site-footer nav")].find((n) => n.querySelector("h2").textContent.trim() === title);
      assert.deepEqual([...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")), want, title);
    }
    assert.equal(document.querySelectorAll(".site-footer nav .footer-links--cols a").length, 13);
    assert.equal(document.querySelector('.site-footer a[href="/schedule"]').textContent.trim(), "Schedule a chauffeur");
    assert.equal(document.querySelector('.site-footer a[href="/fleet"]').textContent.trim(), "Fleet");
    assert.equal(document.querySelector(".site-footer__about").textContent.trim(), FOOTER_ABOUT);
  });

  check(`${file}: every booking link in the chrome and every a.btn to /book reads Book a car`, () => {
    const off = [...document.querySelectorAll('header a[href="/book"], footer a[href="/book"], .actionbar a[href="/book"], a.btn[href="/book"]')]
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
