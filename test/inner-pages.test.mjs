import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const isBook = (a) => /^\/book([?#]|$)/.test(a.getAttribute("href"));
const WHATSAPP = /^https:\/\/wa\.me\/16467750556/;
const CLOSES = [
  "services.html", "fleet.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html",
  "about.html", "faq.html", "locations.html", "blog.html", "schedule.html", "rates.html",
  ...["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city", "jfk-airport", "laguardia-airport"].map((a) => `locations/${a}.html`),
];

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

const norm = (s) => s.replace(/\s+/g, " ").trim();
const sentences = (s) => (norm(s).match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).length;

function read(file) {
  const { document } = new JSDOM(readFileSync(join(ROOT, file), "utf8")).window;
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((n) => JSON.parse(n.textContent))
    .flatMap((b) => b["@graph"] || [b]);
  return { document, ld };
}

function visibleFaq(document) {
  return [...document.querySelectorAll("main details")].map((d) => {
    const body = d.cloneNode(true);
    const q = norm(body.querySelector("summary").textContent);
    body.querySelector("summary").remove();
    return [q, norm(body.textContent)];
  });
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

const files = htmlFiles(ROOT);
const pages = new Map(files.map((f) => [f, read(f)]));
const locations = files.filter((f) => f.startsWith("locations/"));
const posts = files.filter((f) => f.startsWith("blog/"));

check("there are 12 location pages and 10 blog posts", () => {
  assert.equal(locations.length, 12);
  assert.equal(posts.length, 10);
});

for (const [file, { document, ld }] of pages) {
  const faq = ld.filter((n) => [].concat(n["@type"]).includes("FAQPage"));
  if (!faq.length && !file.startsWith("locations/")) continue;
  check(`${file}: FAQPage questions and answers equal the visible questions, in order`, () => {
    assert.equal(faq.length, 1, `${faq.length} FAQPage nodes`);
    const marked = faq[0].mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
    const shown = visibleFaq(document);
    assert.ok(shown.length >= 4, `only ${shown.length} visible questions`);
    assert.deepEqual(marked, shown);
  });
}

check("no page uses the retired rate board component", () => {
  const hits = files.filter((f) => pages.get(f).document.querySelector(".rate-board, .rate-row"));
  assert.deepEqual(hits, []);
});

const AIRPORT_HOME = { "locations/jfk-airport.html": "jfk", "locations/laguardia-airport.html": "lga" };
const AIRPORT_OF = (name) => (/\bJFK\b/.test(name) ? "jfk" : /LaGuardia/.test(name) ? "lga" : /Newark/.test(name) ? "ewr" : /Teterboro/.test(name) ? "teb" : null);
const T1_LABELS = ["Airport price", "Free waiting", "By the hour", "Child seats", "Booking ahead"];
const T1_AIRPORT = ["Where we meet you", "Flight tracking", "Airport price", "Free waiting", "Child seats", "Booking ahead"];

for (const file of locations) {
  const { document } = pages.get(file);
  const home = AIRPORT_HOME[file];
  check(`${file}: ${home ? "one routes list of six trips from this airport, each to its rates row" : "airport routes cover the four airports, each row to its rates row"}, with no figures`, () => {
    const h = [...document.querySelectorAll("main h2")].find((n) => /^(Airport routes from|Routes into the city|Routes from LaGuardia)/.test(n.textContent.trim()));
    assert.ok(h, "no airport routes heading");
    let n = h.nextElementSibling;
    while (n && !n.matches("ul.ledger")) n = n.nextElementSibling;
    assert.ok(n, "no route list after the heading");
    const rows = [...n.querySelectorAll("a.ledger__row")];
    for (const r of rows) {
      assert.doesNotMatch(r.textContent, /\$\s*\d/);
      assert.equal(norm(r.querySelector(".ledger__name .sr-only")?.textContent || ""), "rates", `${norm(r.textContent)}: no sr-only rates`);
      const want = home || AIRPORT_OF(r.querySelector(".ledger__name").textContent);
      assert.equal(r.getAttribute("href"), `/rates#${want}`, norm(r.textContent));
    }
    if (home) {
      assert.equal(rows.length, 6);
      for (const r of rows) assert.ok(norm(r.querySelector(".ledger__name").textContent).startsWith(home === "jfk" ? "JFK to " : "LaGuardia to "), "a row starts at another airport");
      assert.equal(document.querySelectorAll("main ul.ledger").length, 1, "more than one routes list");
    } else {
      assert.ok(rows.length >= 4 && rows.length <= 5, `${rows.length} rows`);
      assert.deepEqual([...new Set(rows.map((r) => r.getAttribute("href")))].sort(), ["/rates#ewr", "/rates#jfk", "/rates#lga", "/rates#teb"]);
      for (const other of document.querySelectorAll("main ul.ledger")) {
        if (other === n) continue;
        for (const r of other.querySelectorAll("a.ledger__row")) assert.equal(AIRPORT_OF(r.querySelector(".ledger__name").textContent), null, `airport row left in the second list: ${norm(r.textContent)}`);
      }
    }
  });
  check(`${file}: the sidebar is the rider facts box, first in its grid`, () => {
    const aside = document.querySelector("main aside:not(#bk-side)");
    assert.equal(aside.parentElement.firstElementChild, aside, "the box is not first in its grid");
    assert.ok(aside.nextElementSibling.matches(".prose"), "the prose does not follow the box");
    const h = aside.firstElementChild;
    assert.ok(h.matches("h2.rail__h#lf-h"), "no h2.rail__h first");
    assert.equal(norm(h.textContent), "Before you book");
    assert.equal(aside.getAttribute("aria-labelledby"), "lf-h");
    assert.equal(h.nextElementSibling.tagName, "DL");
    assert.deepEqual([...aside.querySelectorAll(".facts--lead dt")].map((d) => norm(d.textContent)), home ? T1_AIRPORT : T1_LABELS);
    assert.equal(norm(aside.querySelector(".eyebrow").textContent), "Nearby");
    assert.ok(aside.querySelector('a[href="/rates"]'), "no See all rates link");
    assert.ok(aside.querySelector('a[href="tel:+16467750556"]'), "no phone link");
    assert.ok([...aside.querySelectorAll("a[href]")].some(isBook), "no Book a car link");
  });
}

check("locations/jfk-airport.html: terminal pickup table is built from sentences on the page", () => {
  const { document } = pages.get("locations/jfk-airport.html");
  const table = document.querySelector("main table.rate-table");
  assert.ok(table, "no table");
  const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [norm(tr.querySelector("th").textContent), norm(tr.querySelector("td").textContent)]);
  assert.deepEqual(rows.map((r) => r[0]), ["Terminals 1, 4 and 8", "Terminals 5 and 7", "Meet and greet"]);
  const flat = (s) => norm(s).toLowerCase().replace(/,/g, "");
  const prose = flat([...document.querySelectorAll("main .prose > p:not(.pick-say), main details p")].map((p) => p.textContent).join(" "));
  assert.ok(prose.includes("terminals 1 4 5 7 and 8"), "page prose no longer lists the terminals in use");
  for (const [, cell] of rows) assert.ok(prose.includes(flat(cell)), `"${cell}" is not stated in the page prose`);
});

for (const file of posts) {
  const { document } = pages.get(file);
  check(`${file}: no trip form, close block is one paragraph and one rates link`, () => {
    assert.equal(document.querySelectorAll("main form, main input, main select").length, 0, "trip form on a blog post");
    const close = document.querySelector("main .section--close");
    const text = [...close.querySelectorAll("p")].filter((p) => !p.querySelector("a.lnk, a.btn, a.tel") && !p.classList.contains("eyebrow"));
    assert.equal(text.length, 1, `${text.length} text paragraphs`);
    assert.ok(sentences(text[0].textContent) <= 4, "more than four sentences");
    assert.doesNotMatch(text[0].textContent, /moovs\.app/);
    const lnks = [...close.querySelectorAll("a.lnk")];
    assert.deepEqual(lnks.map((a) => [a.getAttribute("href"), norm(a.textContent)]), [["/rates", "See all rates"]]);
    assert.ok(close.querySelector('a[href="tel:+16467750556"]'), "no phone link");
    assert.ok([...close.querySelectorAll("a[href]")].some(isBook), "no Book a car link");
  });
}

for (const file of CLOSES) {
  const { document } = pages.get(file);
  check(`${file}: close block is eyebrow, heading, phone, one line, Book a car and WhatsApp`, () => {
    const close = document.querySelector("main .section--close");
    assert.ok(close, "no close block");
    assert.ok(close.querySelector(".eyebrow"), "no eyebrow");
    assert.equal(close.querySelectorAll("h2").length, 1);
    assert.equal(close.querySelectorAll('a[href="tel:+16467750556"]').length, 1);
    const lines = [...close.querySelectorAll("p")].filter((p) => !p.querySelector("a") && !p.classList.contains("eyebrow"));
    assert.equal(lines.length, 1, `${lines.length} text lines`);
    assert.equal(sentences(lines[0].textContent), file.startsWith("locations") ? 2 : 1);
    const links = [...close.querySelectorAll("a[href]")].filter((a) => !a.href.startsWith("tel:"));
    const reviews = file === "rates.html" || file === "about.html" ? ["Read the reviews on Google Maps (opens in a new tab)"] : [];
    assert.deepEqual(links.map((a) => norm(a.textContent)), ["Book a car", "Book on WhatsApp", ...reviews]);
    assert.ok(isBook(links[0]), `first link is ${links[0].getAttribute("href")}`);
    assert.match(links[1].href, WHATSAPP);
    assert.equal(close.querySelectorAll("dl").length, 0, "facts list in the close");
  });
}

if (failures) {
  console.error(`\n${failures} inner page assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll inner page tests passed");
process.exit(0);
