import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const load = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { CLASSES, VEHICLES, PLACES, ADDRESS_PLACES, AIRPORT_PLACES, HOURS, PASSENGERS, DEFAULT_CLASS, DEFAULT_VEHICLE } = await load("_rates.mjs");
const { CHECKOUT_ORIGINS = ["https://checkout.stripe.com"] } = await load("_rates.mjs");
const { HEADINGS, QUOTE_BODY, REASONS, ERROR_BLOCK, ERRORS } = await load("_copy.mjs");

const FIELDS = ["trip_type", "from", "from_address", "to", "to_address", "date", "time", "passengers", "hours", "class", "vehicle", "meet", "flight", "action", "nonce", "nlr_hp"];
const SHOW = ["one", "hour", "from-address", "to-address", "from-airport"];
const BOOK_IDS = [
  "resume", "book-form", "bk-one", "bk-hour", "bk-from", "bk-from-address", "bk-to", "bk-to-address", "bk-date", "bk-time", "bk-hours", "bk-pax",
  "bk-class", "bk-vehicle", "bk-meet", "bk-flight", "bk-hp", "bk-nonce", "bk-submit", "bk-result", "price", "price-h", "price-lines", "price-total",
  "price-notes", "quote", "q-body", "q-switch", "q-switch-fare", "q-wa", "q-mail", "q-error", "bk-estimate",
];
const CONFIRMED_IDS = ["cf-h", "cf-test", "cf-ok", "cf-ref", "cf-missing", "cf-receipt", "cf-receipt-h", "cf-summary", "cf-lines", "cf-total", "cf-notes"];

const norm = (s) => s.replace(/\s+/g, " ").trim();
const read = (f) => {
  const html = readFileSync(join(ROOT, f), "utf8");
  return { html, document: new JSDOM(html).window.document };
};
const book = read("book.html");
const confirmed = read("booking-confirmed.html");
const doc = book.document;
const $ = (id, d = doc) => d.getElementById(id);
const options = (sel) => [...sel.querySelectorAll("option")].map((o) => [o.value, norm(o.textContent)]);
const label = (cls) => `${CLASSES[cls].name}, up to ${CLASSES[cls].seats} passengers`;

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

check("book.html carries every id of the contract", () => assert.deepEqual(BOOK_IDS.filter((id) => !$(id)), []));
check("booking-confirmed.html carries every id of the contract", () => assert.deepEqual(CONFIRMED_IDS.filter((id) => !$(id, confirmed.document)), []));

const form = $("book-form");
check("the form posts to /api/book with the book class", () => {
  assert.equal(form.getAttribute("method"), "post");
  assert.equal(form.getAttribute("action"), "/api/book");
  assert.ok(form.classList.contains("book"));
});

check("every named control sends a request field of the contract", () => {
  const names = [...form.querySelectorAll("[name]")].map((c) => c.getAttribute("name"));
  assert.deepEqual([...new Set(names.filter((n) => !FIELDS.includes(n)))], []);
});

check("every control except the hidden nonce has a label with for", () => {
  const bad = [...form.querySelectorAll("input:not([type=hidden]), select")].filter((c) => !form.querySelector(`label[for="${c.id}"]`)).map((c) => c.id);
  assert.deepEqual(bad, []);
});

check("the trip type radios are in a fieldset with a legend, One way checked", () => {
  const fs = $("bk-one").closest("fieldset");
  assert.ok(fs && fs.contains($("bk-hour")) && fs.querySelector("legend"));
  assert.equal(norm(fs.querySelector("legend").textContent), "Trip type");
  assert.ok($("bk-one").checked);
  assert.ok(!$("bk-hour").checked);
});

check("pickup and drop-off list Choose, the address places, then the airports", () => {
  const want = [["", "Choose"], ...ADDRESS_PLACES.map((p) => [p, PLACES[p]]), ...AIRPORT_PLACES.map((p) => [p, PLACES[p]])];
  for (const id of ["bk-from", "bk-to"]) {
    assert.deepEqual(options($(id)), want, id);
    assert.deepEqual([...$(id).querySelectorAll("optgroup")].map((g) => [g.label, g.querySelectorAll("option").length]), [["Address", ADDRESS_PLACES.length], ["Airport", AIRPORT_PLACES.length]], id);
  }
});

check("vehicle class options are the classes with their seat counts, Business SUV selected", () => {
  assert.deepEqual(options($("bk-class")), Object.keys(CLASSES).map((k) => [k, label(k)]));
  assert.equal($("bk-class").value, DEFAULT_CLASS);
  assert.equal(DEFAULT_CLASS, "suv");
});

check("vehicle options are the hourly vehicles with their seat counts, Suburban selected", () => {
  const sel = $("bk-vehicle");
  const want = Object.entries(VEHICLES).map(([k, v]) => [k, v.cls === "suv" ? v.model : label(v.cls)]);
  assert.deepEqual(options(sel), want);
  const groups = [...sel.querySelectorAll("optgroup")];
  assert.equal(groups[0].label, label("suv"));
  assert.deepEqual([...groups[0].querySelectorAll("option")].map((o) => o.value), Object.keys(VEHICLES).filter((k) => VEHICLES[k].cls === "suv"));
  assert.equal(groups[1].label, "Other classes");
  assert.equal(sel.value, DEFAULT_VEHICLE);
  assert.equal(DEFAULT_VEHICLE, "suv-suburban");
});

check("hours run from the minimum to the maximum, the minimum selected", () => {
  const want = Array.from({ length: HOURS.max - HOURS.min + 1 }, (_, i) => [`${HOURS.min + i}`, `${HOURS.min + i} hours`]);
  assert.deepEqual(options($("bk-hours")), want);
  assert.equal($("bk-hours").value, `${HOURS.min}`);
});

check("passengers run from the minimum to the maximum, one selected", () => {
  const want = Array.from({ length: PASSENGERS.max - PASSENGERS.min + 1 }, (_, i) => [`${PASSENGERS.min + i}`, `${PASSENGERS.min + i}`]);
  assert.deepEqual(options($("bk-pax")), want);
  assert.equal($("bk-pax").value, "1");
});

check("no form control or field wrapper carries hidden, only the price panel and the Switch button inside the result region", () => {
  assert.deepEqual([...form.querySelectorAll("[hidden]")].filter((e) => !$("bk-result").contains(e)).map((e) => e.id || e.tagName), []);
  assert.deepEqual([...$("bk-result").querySelectorAll("[hidden]")].map((e) => e.id), ["price", "q-switch"]);
});

check("every data-show value is one of the five conditions", () => {
  const vals = [...form.querySelectorAll("[data-show]")].map((w) => w.dataset.show);
  assert.ok(vals.length >= 7);
  assert.deepEqual([...new Set(vals.filter((v) => !SHOW.includes(v)))], []);
});

check("each conditional control sits in the wrapper the contract names", () => {
  const want = { "bk-from-address": "from-address", "bk-to": "one", "bk-to-address": "to-address", "bk-hours": "hour", "bk-class": "one", "bk-vehicle": "hour", "bk-meet": "from-airport", "bk-flight": "from-airport" };
  const got = Object.fromEntries(Object.keys(want).map((id) => [id, $(id).closest("[data-show]")?.dataset.show]));
  assert.deepEqual(got, want);
  for (const id of ["bk-from", "bk-date", "bk-time", "bk-pax"]) assert.equal($(id).closest("[data-show]"), null, id);
});

check("only pickup, date and time are required in the static html", () =>
  assert.deepEqual([...form.querySelectorAll("[required]")].map((c) => c.id), ["bk-from", "bk-date", "bk-time"]));

check("each labelled control except the radios and the honeypot sits in a field wrapper", () => {
  const bad = [...form.querySelectorAll("input:not([type=hidden]):not([type=radio]), select")].filter((c) => c.id !== "bk-hp" && !c.parentElement.matches("div.field")).map((c) => c.id);
  assert.deepEqual(bad, []);
});

check("static attributes of the text, date and time controls", () => {
  for (const id of ["bk-from-address", "bk-to-address"]) {
    assert.equal($(id).getAttribute("maxlength"), "200", id);
    assert.equal($(id).getAttribute("autocomplete"), "address-line1", id);
  }
  assert.equal($("bk-flight").getAttribute("maxlength"), "20");
  assert.equal($("bk-flight").getAttribute("autocomplete"), "off");
  assert.equal($("bk-date").type, "date");
  assert.equal($("bk-time").type, "time");
  assert.equal($("bk-time").getAttribute("step"), "900");
  assert.equal($("bk-meet").type, "checkbox");
  assert.equal($("bk-meet").value, "1");
  assert.equal($("bk-nonce").type, "hidden");
});

check("the honeypot is moved off screen, out of the tab order, and named so autofill never matches it", () => {
  const hp = $("bk-hp");
  assert.ok(hp.parentElement.matches("div.bk-hp[aria-hidden=true]"));
  assert.equal(hp.getAttribute("tabindex"), "-1");
  assert.equal(hp.getAttribute("autocomplete"), "off");
  assert.equal(hp.value, "");
  const words = [hp.name, hp.id, form.querySelector('label[for="bk-hp"]').textContent].join(" ");
  assert.doesNotMatch(words, /compan|organi[sz]|business|name|mail|phone|tel|addr|street|city|zip|postal|country/i, "an autofill heuristic would match the honeypot");
});

check("the one submit button reads Continue, and the only other button is Switch inside the result region", () => {
  assert.deepEqual([...form.querySelectorAll("button")].map((b) => b.id), ["q-switch", "bk-submit"]);
  const buttons = [...form.querySelectorAll("button[type=submit]")];
  assert.deepEqual(buttons.map((b) => b.id), ["bk-submit"]);
  assert.equal(buttons[0].type, "submit");
  assert.ok(buttons[0].classList.contains("btn"));
  assert.equal(norm(buttons[0].textContent), "Continue");
});

check("each error message holds its sentence beside the control its field names", () => {
  const bad = [];
  for (const [code, { field, text }] of Object.entries(ERRORS)) {
    const p = $(`e-${code}`);
    if (!p) { bad.push(`no #e-${code}`); continue; }
    if (!p.matches("p.bk-e")) bad.push(`#e-${code} is not p.bk-e`);
    if (norm(p.textContent) !== text) bad.push(`#e-${code} text`);
    if (field === "form") {
      if (p.previousElementSibling !== $("bk-submit")) bad.push("#e-form does not follow the button");
    } else if (field === "trip_type") {
      if (p.previousElementSibling?.tagName !== "FIELDSET") bad.push("#e-trip_type does not follow the fieldset");
    } else {
      const control = form.querySelector(`[name="${field}"]`);
      if (p.parentElement !== control.parentElement) bad.push(`#e-${code} is outside the ${field} wrapper`);
      if (control.compareDocumentPosition(p) & 2) bad.push(`#e-${code} comes before its control`);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(doc.querySelectorAll(".bk-e").length, Object.keys(ERRORS).length);
});

check("each request block holds its group heading and its reason", () => {
  const bad = [];
  for (const [reason, { group, text }] of Object.entries(REASONS)) {
    const q = $(`q-${reason}`);
    if (!q || !q.matches("div.bk-q")) { bad.push(`no div.bk-q#q-${reason}`); continue; }
    if (norm(q.querySelector("h2").textContent) !== HEADINGS[group]) bad.push(`#q-${reason} heading`);
    if (norm(q.querySelector("p").textContent) !== text) bad.push(`#q-${reason} text`);
  }
  assert.deepEqual(bad, []);
  assert.equal(doc.querySelectorAll(".bk-q").length, Object.keys(REASONS).length + 1);
});

check("the error block holds the phone heading and the error sentence", () => {
  assert.equal(norm($("q-error").querySelector("h2").textContent), HEADINGS[ERROR_BLOCK.group]);
  assert.equal(ERROR_BLOCK.group, "phone");
  assert.equal(norm($("q-error").querySelector("p").textContent), ERROR_BLOCK.text);
});

check("the request body, links and switch match the contract", () => {
  assert.equal(norm($("q-body").textContent), QUOTE_BODY);
  assert.equal($("q-wa").getAttribute("href"), "https://wa.me/16467750556");
  assert.equal($("q-wa").getAttribute("target"), "_blank");
  assert.equal($("q-wa").getAttribute("rel"), "noopener");
  assert.equal(norm($("q-wa").textContent), "Send on WhatsApp");
  assert.equal($("q-mail").getAttribute("href"), "mailto:info@nycluxride.com");
  assert.equal(norm($("q-mail").textContent), "Email the trip");
  const call = $("quote").querySelector('a[href="tel:+16467750556"]');
  assert.ok(call && norm(call.textContent) === "+1 (646) 775-0556");
  assert.match(norm(call.parentElement.textContent), /^Or call \+1 \(646\) 775-0556/);
  const sw = $("q-switch");
  assert.equal(sw.type, "button");
  assert.ok(sw.hidden && sw.classList.contains("btn"));
  assert.equal(norm(sw.textContent), "Switch to Business SUV, fare");
  assert.equal($("q-switch-fare").textContent, "");
});

check("the price panel is hidden and labelled, with a total row", () => {
  const p = $("price");
  assert.ok(p.hidden && p.matches("section.bk-price"));
  assert.equal(p.getAttribute("aria-labelledby"), "price-h");
  assert.equal(norm($("price-h").textContent), "Your price");
  assert.ok($("price-lines").matches("table.bk-lines > tbody"));
  assert.equal(norm($("price-total").closest("tr").querySelector("th").textContent), "Total today");
  assert.ok($("price-total").closest("tfoot"));
  assert.equal($("price-lines").children.length, 0);
});

check("the result region is polite, wraps the panel and the request block, and sits in the form directly before Continue", () => {
  const r = $("bk-result");
  assert.equal(r.getAttribute("aria-live"), "polite");
  assert.ok(r.contains($("price")) && r.contains($("quote")));
  assert.equal(r.parentElement, form);
  assert.equal(r.nextElementSibling, $("bk-submit"));
  assert.equal(r.querySelectorAll("[name]").length, 0);
  assert.equal($("quote").getAttribute("aria-label"), "Booking request");
  assert.ok($("quote").classList.contains("bk-quote"));
});

check("the page states the h1, the lede, the resume note and the fare estimate", () => {
  assert.deepEqual([...doc.querySelectorAll("h1")].map((h) => norm(h.textContent)), ["Book a car"]);
  assert.equal(norm(doc.querySelector(".lede").textContent), "One form for an airport transfer or an hourly booking.");
  assert.ok($("resume").matches("p.bk-note"));
  assert.equal(norm($("resume").textContent), "Payment not completed. Nothing was charged.");
  assert.ok($("resume").compareDocumentPosition(form) & 4);
  const est = $("bk-estimate");
  assert.equal(norm(est.textContent), "You can ask for a fare estimate that includes all fees at +1 (646) 775-0556 or on WhatsApp.");
  assert.ok(est.querySelector('a[href="tel:+16467750556"]') && est.querySelector('a[href^="https://wa.me/16467750556"]'));
  assert.ok(doc.querySelector('main a[href="/rates"]'));
});

check("book.html head: title, description, canonical, indexable", () => {
  assert.equal(doc.title, "Book a car | NYC LUX RIDE");
  assert.equal(doc.querySelector('meta[name="description"]').content, "Book an airport transfer or an hourly car in New York City. Choose the pickup, the drop-off, the date and the vehicle.");
  assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://www.nycluxride.com/book");
  assert.doesNotMatch(doc.querySelector('meta[name="robots"]')?.content || "", /noindex/);
});

const cf = confirmed.document;
check("booking-confirmed.html is noindex with no canonical", () => {
  assert.equal(cf.title, "Payment received | NYC LUX RIDE");
  assert.equal(cf.querySelector('meta[name="robots"]').content, "noindex");
  assert.equal(cf.querySelector('link[rel="canonical"]'), null);
});

check("booking-confirmed.html static copy works without javascript", () => {
  const h = $("cf-h", cf);
  assert.equal(norm(h.textContent), "Payment received");
  assert.equal(h.dataset.missing, "This payment was not found");
  assert.equal(norm($("cf-ok", cf).textContent), "Dispatch confirms your vehicle and chauffeur in writing before the day. Your reference: on your receipt from Stripe");
  assert.equal($("cf-ref", cf).tagName, "B");
  assert.ok(!$("cf-ok", cf).hidden);
  assert.ok($("cf-test", cf).hidden);
  assert.equal(norm($("cf-test", cf).textContent), "Test booking. No real payment was taken.");
  assert.ok($("cf-missing", cf).hidden);
  assert.equal(norm($("cf-missing", cf).textContent), "Call +1 (646) 775-0556 or message on WhatsApp and dispatch will check the booking.");
  const r = $("cf-receipt", cf);
  assert.ok(r.hidden && r.matches("section.bk-price") && r.getAttribute("aria-labelledby") === "cf-receipt-h");
  assert.equal(norm($("cf-receipt-h", cf).textContent), "Your payment");
  assert.equal(norm($("cf-total", cf).closest("tr").querySelector("th").textContent), "Paid");
  const text = norm(cf.querySelector("main").textContent);
  assert.ok(text.includes("To change or cancel, call +1 (646) 775-0556 or message on WhatsApp with your reference."));
  assert.ok(cf.querySelector('main a[href="/rates"]'));
});

for (const [name, { document }] of [["book.html", book], ["booking-confirmed.html", confirmed]]) {
  check(`${name}: no dollar figure, percent or USD in text or attributes`, () => {
    const body = document.body.cloneNode(true);
    for (const n of body.querySelectorAll("script, style")) n.remove();
    const attrs = [...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value));
    const all = [document.title, body.textContent, ...attrs].join(" ");
    assert.equal(all.match(/\$\s*\d|\d\s*%|\bUSD\b/), null);
  });

  check(`${name}: pay loads after lux and before gtag and tracking, all deferred`, () => {
    const scripts = [...document.head.querySelectorAll("script[src]")];
    assert.deepEqual(scripts.map((s) => s.getAttribute("src").replace(/\.[A-Za-z0-9_-]{6,}\.js$/, ".js")), ["/assets/lux.js", "/assets/pay.js", "/assets/gtag.js", "/assets/tracking.js"]);
    assert.ok(scripts.every((s) => s.defer), "a script is not deferred");
  });

  check(`${name}: every phone and WhatsApp link is exact`, () => {
    const bad = [...document.querySelectorAll('a[href^="tel:"], a[href*="wa.me"]')]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h !== "tel:+16467750556" && !h.startsWith("https://wa.me/16467750556"));
    assert.deepEqual(bad, []);
  });
}

check("only the two booking pages load the pay script", () => {
  assert.ok(book.html.includes("/assets/pay.") && confirmed.html.includes("/assets/pay."));
  const others = ["index.html", "rates.html", "404.html", "locations/jfk-airport.html"].filter((f) => readFileSync(join(ROOT, f), "utf8").includes("/assets/pay."));
  assert.deepEqual(others, []);
});

check("the pay script follows only a Checkout origin of the config or the mock confirmation", () => {
  const name = readdirSync(join(ROOT, "assets")).find((n) => /^pay\..+\.js$/.test(n));
  const src = readFileSync(join(ROOT, "assets", name), "utf8");
  const m = src.match(/\/(\^\(https:\\\/\\\/checkout[^)]*\))\/\.test/);
  assert.ok(m, "no payment URL rule found");
  const rule = new RegExp(m[1]);
  for (const o of CHECKOUT_ORIGINS) assert.ok(rule.test(`${o}/c/pay/cs_test_a1`), `${o} is refused`);
  assert.ok(rule.test("/booking-confirmed?session_id=cs_mock_7K3Q2P"));
  for (const bad of ["https://checkout.stripe.com.example.com/c/pay", "https://example.com/c/pay", "//checkout.stripe.com/c/pay", "/booking-confirmed?session_id=cs_live_a1", "javascript:alert(1)"]) {
    assert.equal(rule.test(bad), false, `${bad} is followed`);
  }
});

check("the pay script labels a test or mock session and never a live one", () => {
  const name = readdirSync(join(ROOT, "assets")).find((n) => /^pay\..+\.js$/.test(n));
  const src = readFileSync(join(ROOT, "assets", name), "utf8");
  const m = src.match(/\$\("cf-test"\)\.hidden=!\/([^/]+)\/\.test\(id\)/);
  assert.ok(m, "no test label rule found");
  const rule = new RegExp(m[1]);
  for (const id of ["cs_test_a1b2c3d4e5f6", "cs_mock_7K3Q2P"]) assert.ok(rule.test(id), `${id} is not labelled`);
  for (const id of ["cs_live_a1b2c3d4e5f6", "xcs_test_a1", ""]) assert.equal(rule.test(id), false, `${id} is labelled`);
});

if (failures) {
  console.error(`\n${failures} book page assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll book page tests passed");
process.exit(0);
