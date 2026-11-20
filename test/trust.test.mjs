import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

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

const SPRITE = read("assets/icons.svg.html");
const symbol = (id) => SPRITE.match(new RegExp(`<symbol id="${id}" viewBox="0 0 24 24"><path d="([^"]+)"/></symbol>`))?.[1];
const ITEMS = {
  licensed: [symbol("i-shield"), "Licensed and insured", "NYC TLC-licensed chauffeurs and vehicles, commercially insured."],
  chauffeurs: ["M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20.5a7 7 0 0 1 11.5-5.4M15.5 18.5l2 2 4-4.5", "Trusted chauffeurs", "Every chauffeur is background checked."],
  payments: [symbol("i-lock"), "Secure payments", "Card payments through Stripe."],
  pricing: ["M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5zM9 8h6M9 11.5h6M9 15h3.5", "Transparent pricing", "You see the total before you pay."],
};
const FOUR = ["licensed", "chauffeurs", "payments", "pricing"];
const PAGES = {
  "index.html": FOUR,
  "book.html": FOUR,
  "locations/jfk-airport.html": FOUR,
  "locations/laguardia-airport.html": FOUR,
  "locations/newark-airport.html": FOUR,
  "locations/teterboro-airport.html": ["licensed", "chauffeurs", "payments"],
};
const TITLE = "Why ride with NYC LUX RIDE";
const SUPPORT = "We answer 24 hours a day, every day";
const TRACKING = "We track your flight.";
const PRIVATE_FLIGHT = "For a private flight, add the details as a note in the Details step.";
const PRICING = /see (the|your) total (before you pay|first)/i;

function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "test", "scripts"].includes(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(full));
    else if (e.name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

check("the trust section is on the six pages with the full booking form and on no other page, quick booking bars included", () => {
  const withTrust = htmlFiles(ROOT).filter((f) => read(f).includes('class="trust"'));
  assert.deepEqual(withTrust, Object.keys(PAGES).sort());
  for (const f of withTrust) assert.ok(read(f).includes('<form id="book-form" class="bk" method="post"'), `${f} has no full booking form`);
  for (const f of htmlFiles(ROOT).filter((x) => read(x).includes('class="bk bk--go"'))) assert.ok(!read(f).includes('class="trust"'), f);
});

check("the sprite still holds the shield and the lock the section draws", () => {
  assert.ok(symbol("i-shield") && symbol("i-lock"));
});

const sections = {};
for (const [file, keys] of Object.entries(PAGES)) {
  const doc = new JSDOM(read(file)).window.document;
  const trust = doc.querySelector("section.trust");
  const form = doc.getElementById("book-form");
  sections[file] = trust?.outerHTML;

  check(`${file}: one section.trust labelled by its h2, ${keys.length} list items, each a gold ring with an aria-hidden line icon, a short title and one line`, () => {
    assert.equal(doc.querySelectorAll("section.trust").length, 1);
    assert.equal(trust.getAttribute("aria-labelledby"), "trust-h");
    assert.deepEqual([...trust.children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`), ["h2.trust__h", "ul.trust__list"]);
    assert.equal(norm(trust.querySelector(":scope > h2#trust-h").textContent), TITLE);
    const list = trust.querySelector(":scope > ul.trust__list");
    assert.equal(list.getAttribute("role"), "list");
    const items = [...list.children];
    assert.equal(items.length, keys.length);
    assert.deepEqual(items.map((li) => [li.tagName, ...[...li.children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`)]), Array(keys.length).fill(["LI", "span.trust__art", "p.trust__n", "p.trust__s"]));
    for (const li of items) {
      const svg = li.querySelector(":scope > span.trust__art > svg");
      assert.deepEqual([svg.getAttribute("class"), svg.getAttribute("viewBox"), svg.getAttribute("aria-hidden"), svg.getAttribute("focusable")], ["icon", "0 0 24 24", "true", "false"]);
      assert.deepEqual([...svg.children].map((c) => [c.tagName, [...c.attributes].map((a) => a.name)]), [["path", ["d"]]]);
    }
  });

  check(`${file}: the items are ${keys.join(", ")} in that order, word for word, with the shield and lock paths of the sprite`, () => {
    const got = [...trust.querySelectorAll("ul.trust__list > li")].map((li) => [li.querySelector("path").getAttribute("d"), norm(li.querySelector(".trust__n").textContent), norm(li.querySelector(".trust__s").textContent)]);
    assert.deepEqual(got, keys.map((k) => ITEMS[k]));
  });

  check(`${file}: the copy has no question mark, ampersand, dash other than the TLC-licensed hyphen, semicolon, hidden fees or round the clock promise`, () => {
    const text = norm(trust.textContent);
    assert.doesNotMatch(text, /[?&;–—]/);
    assert.deepEqual(text.match(/-/g) || [], ["-"]);
    assert.doesNotMatch(text, /hidden fees|24\/7|24 hours|response|minutes/i);
  });

  check(`${file}: the section's h2 follows the page's only h1 and the booking form, and the form holds no trust section`, () => {
    const h1 = doc.querySelectorAll("h1");
    assert.equal(h1.length, 1);
    assert.ok(h1[0].compareDocumentPosition(trust) & 4);
    assert.ok(form.compareDocumentPosition(trust) & 4);
    assert.ok(!form.contains(trust));
  });

  check(`${file}: the section sits directly below the booking form`, () => {
    if (file === "index.html") {
      const hero = doc.querySelector("main > section.hero");
      assert.equal(trust.parentElement, hero);
      assert.ok(trust.previousElementSibling.matches("div.hero__book") && trust.previousElementSibling.firstElementChild === form);
      assert.ok(trust.nextElementSibling.matches("section.seats"));
    } else if (file === "book.html") {
      assert.ok(trust.parentElement.matches("main > section.bk-page > .frame"));
      assert.deepEqual([form.nextElementSibling.id, form.nextElementSibling.nextElementSibling], ["bk-cc", trust]);
      assert.equal(form.nextElementSibling.tagName, "TEMPLATE");
    } else {
      assert.ok(trust.parentElement.matches("section.banner--book > div.banner__body"));
      assert.ok(trust.previousElementSibling.matches("div.banner__book") && trust.previousElementSibling.firstElementChild === form);
      assert.ok(trust.nextElementSibling.matches("p.lede"));
    }
  });

  const outside = () => {
    const body = doc.body.cloneNode(true);
    body.querySelectorAll("section.trust, svg, datalist, template, script").forEach((e) => e.remove());
    return body;
  };
  check(`${file}: no promise of the section is made again on the page, Stripe only in the booking steps the section hides for`, () => {
    const text = norm(outside().textContent);
    assert.doesNotMatch(text, /TLC[- ]licensed (chauffeurs|drivers|vehicles|cars)|commercial(ly)? insur|background[- ]check|professionally trained/i);
    if (keys.includes("pricing")) assert.doesNotMatch(text, PRICING);
    const stripe = [...outside().querySelectorAll("p, li, span, b, small, dd, td, h2, h3")].filter((e) => !e.children.length && /stripe/i.test(e.textContent));
    for (const e of stripe) {
      const step = e.closest("[data-show]")?.getAttribute("data-show");
      assert.ok(e.closest("#book-form") && ["options", "details"].includes(step), `${norm(e.textContent)} is shown with the search step`);
    }
  });

  const jet = file === "locations/teterboro-airport.html";
  check(`${file}: the items left out are already promised on the page, support in the form's trust row, ${jet ? "no flight tracking for the private flights the form takes as a note" : "flight tracking in the form"}${keys.includes("pricing") ? "" : ", the total before you pay in the page copy"}`, () => {
    assert.ok([...doc.querySelectorAll("#bk-assure > li")].some((li) => norm(li.textContent) === SUPPORT), "no support line in the trust row");
    if (jet) {
      assert.ok(!norm(form.textContent).includes(TRACKING), "the Teterboro form promises flight tracking");
      assert.equal(norm(doc.getElementById("bk-flight-status").textContent), PRIVATE_FLIGHT);
    } else assert.ok(norm(form.textContent).includes(TRACKING), "no flight tracking line in the form");
    if (!keys.includes("pricing")) assert.match(norm(outside().textContent), PRICING);
    assert.doesNotMatch(norm(trust.textContent), /phone|whatsapp|support|answer|flight/i);
  });
}

check("the six sections are the same markup, less the items a page leaves out", () => {
  const full = sections["index.html"];
  for (const [file, keys] of Object.entries(PAGES)) {
    const doc = new JSDOM(full).window.document;
    [...doc.querySelectorAll("li")].forEach((li, i) => { if (!keys.includes(FOUR[i])) { li.nextSibling?.remove(); li.remove(); } });
    assert.equal(sections[file], doc.querySelector("section").outerHTML, file);
  }
});

const cssName = (re) => readdirSync(join(ROOT, "assets")).find((f) => re.test(f));
const LUX = read(`assets/${cssName(/^lux\.[A-Za-z0-9_-]+\.css$/)}`);
const BOOK = read(`assets/${cssName(/^book\.[A-Za-z0-9_-]+\.css$/)}`);
const parse = (s) => [...s.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, sel, body]) => [norm(sel), body.split(";")]);
const block = (src, head) => {
  const a = src.indexOf(head);
  let d = 0;
  for (let i = a; a >= 0 && i < src.length; i++) {
    if (src[i] === "{") d++;
    if (src[i] === "}" && !--d) return src.slice(a, i + 1);
  }
  return "";
};
const booking = block(BOOK, "@layer booking{");
const rule = (list, sel) => list.find(([s]) => s === sel)?.[1] || [];
const prop = (decls, name) => decls.find((d) => d.startsWith(`${name}:`));

check("book.css: the trust rules sit in the booking layer and match the home cards, a 56 px gold-300 ring on gold-50, a 31 px gold-700 icon at stroke 1.25, the same card padding, radius and edge", () => {
  const rules = parse(booking);
  const home = parse(block(LUX, "@layer pages{"));
  const ring = rule(home, ".home :is(.seats__art,.pets__art)"), icon = rule(home, ".home :is(.seats__list,.pets__list) .icon"), card = rule(home, ".home :is(.seats,.pets)");
  for (const p of ["inline-size", "aspect-ratio", "border", "border-radius", "background"]) assert.equal(prop(rule(rules, ".trust__art"), p), prop(ring, p), p);
  for (const p of ["font-size", "color", "stroke-width"]) assert.equal(prop(rule(rules, ".trust .icon"), p), prop(icon, p), p);
  for (const p of ["margin-block-start", "padding", "border-radius"]) assert.equal(prop(rule(rules, ".trust"), p), prop(card, p), p);
  assert.deepEqual(rule(rules, ".trust path"), ["vector-effect:non-scaling-stroke"]);
  const edge = (src, sel) => rule(parse(block(src, "@media screen and (forced-colors:none){")), sel).filter((d) => /^(border|background):/.test(d));
  const homeEdge = parse(block(LUX.slice(LUX.indexOf("@layer pages{")), "@media screen and (forced-colors:none){")).find(([s]) => s.includes(".home .hero>:is(.seats,.pets)"))?.[1] || [];
  assert.deepEqual(edge(booking, ".trust"), homeEdge.filter((d) => /^(border|background):/.test(d)));
  assert.deepEqual(rule(parse(block(booking, "@media (forced-colors:active){.trust")), ".trust"), ["background:Canvas"]);
});

check("book.css: two columns on phones with an odd last item across both, one row from 600 px, the heading left of the row from 1024 px", () => {
  const rules = parse(booking);
  assert.ok(rule(rules, ".trust__list").includes("grid-template-columns:repeat(2,minmax(0,1fr))"));
  assert.ok(["grid-row:span 3", "grid-template-rows:subgrid"].every((d) => rule(rules, ".trust li").includes(d)), "each item shares its row's tracks, so names and lines start level");
  assert.deepEqual(rule(parse(block(booking, "@media (max-width:599px){.trust")), ".trust li:nth-child(odd):last-child"), ["grid-column:1/-1"]);
  assert.ok(!parse(booking.replace(block(booking, "@media (max-width:599px){.trust"), "")).some(([s]) => s.includes(":last-child") && s.includes(".trust")), "a last item rule reaches wider screens");
  const at600 = parse(block(booking, "@media (min-width:600px){.trust"));
  assert.ok(["grid-template-columns:none", "grid-auto-flow:column", "grid-auto-columns:minmax(0,1fr)"].every((d) => rule(at600, ".trust__list").includes(d)));
  const at1024 = parse(block(booking, "@media (min-width:1024px){.trust"));
  assert.ok(rule(at1024, ".trust").includes("grid-template-columns:minmax(0,1.05fr) minmax(0,2.8fr)"));
});

check("book.css: the section shows with the search step only, like the form's trust row, and keeps its place below the form without javascript", () => {
  const rules = parse(booking);
  assert.deepEqual(rule(rules, ":has(>.bk[data-step$=s])+.trust,.bk[data-step$=s]~.trust"), ["display:none"]);
  assert.ok(rule(rules, ".bk[data-step$=s]>#bk-assure,.bk[data-step$=s]>.bk-search>:not(#bk-status)").includes("display:none"), "the trust row rule it mirrors is gone");
  assert.ok(rule(rules, ".hero>.trust").includes("grid-row:7"));
  assert.ok(rule(parse(block(booking, "@media (scripting:none){.hero>.trust")), ".hero>.trust").includes("grid-row:9"));
  const pages = parse(block(LUX, "@layer pages{"));
  assert.ok(rule(pages, ".home :is(.seats,.pets)").includes("grid-row:8") && rule(pages, ".home .pets").includes("grid-row:9"));
  assert.ok(LUX.includes("@media (scripting:none){.hero__book{grid-row:8;"));
});

if (failures) {
  console.error(`\n${failures} trust assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll trust tests passed");
