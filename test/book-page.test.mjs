import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const load = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { CHECKOUT_ORIGINS, MAX_ADVANCE_DAYS, MIN_NOTICE_HOURS, AUTO_LEAD_MINUTES, AUTO_GUARD_MINUTES, AIRPORT_FARES, AIRPORT_TOTALS, MEET_AND_GREET, VEHICLES } = await load("_rates.mjs");
const { REASONS, ERRORS, NOTES, POLICY } = await load("_copy.mjs");

const CONFIRMED_IDS = ["cf", "cf-h", "cf-test", "cf-refrow", "cf-ref", "cf-copy", "cf-noref", "cf-fail", "cf-retry", "cf-missing", "cf-none", "cf-trip", "cf-route", "cf-rows", "cf-other", "cf-next", "cf-day", "cf-policy", "cf-acts", "cf-ics", "cf-return", "cf-quiet", "cf-gcal", "cf-share", "cf-wa", "cf-print", "cf-receipt", "cf-receipt-h", "cf-lines", "cf-total", "cf-notes", "cf-summary", "cf-help", "cf-home", "cf-status"];
const AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"];
const HOSTS = ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "services.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", "car-service-with-car-seat-nyc.html", ...AREAS.map((a) => `locations/${a}.html`)];

const norm = (s) => s.replace(/\s+/g, " ").trim();
const read = (f) => {
  const html = readFileSync(join(ROOT, f), "utf8");
  return { html, document: new JSDOM(html).window.document };
};
const book = read("book.html");
const confirmed = read("booking-confirmed.html");
const doc = book.document;
const $ = (id, d = doc) => d.getElementById(id);
const payName = readdirSync(join(ROOT, "assets")).find((n) => /^pay\..+\.js$/.test(n));
const pay2Name = readdirSync(join(ROOT, "assets")).find((n) => /^pay2\..+\.js$/.test(n));
const PAY = readFileSync(join(ROOT, "assets", payName), "utf8");
const SRC = [PAY, pay2Name ? readFileSync(join(ROOT, "assets", pay2Name), "utf8") : ""].join("\n");
const doneName = readdirSync(join(ROOT, "assets")).find((n) => /^done\..+\.js$/.test(n));
const DONE = doneName ? readFileSync(join(ROOT, "assets", doneName), "utf8") : "";
const LUX = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((n) => /^lux\..+\.js$/.test(n))), "utf8");
const SHEETS = readdirSync(join(ROOT, "assets")).filter((n) => /^(lux|book)\..+\.css$/.test(n)).map((n) => readFileSync(join(ROOT, "assets", n), "utf8")).join("\n");

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

check("book.html head: title, description, canonical, indexable", () => {
  assert.equal(doc.title, "Book a car | NYC LUX RIDE");
  assert.equal(doc.querySelector('meta[name="description"]').content, "Book an airport transfer or an hourly car in New York City. Choose the pickup, the drop-off, the date and the vehicle.");
  assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://www.nycluxride.com/book");
  assert.doesNotMatch(doc.querySelector('meta[name="robots"]')?.content || "", /noindex/);
});

check("book.html main is the band with the heading and the four notes, the step counts in the step headings, then section.bk-page with the form and the country list template after it", () => {
  const main = doc.querySelector("main");
  assert.deepEqual([...main.children].map((e) => `${e.tagName.toLowerCase()}.${e.className}`), ["section.band", "section.section bk-page"]);
  const band = main.children[0], frame = band.querySelector(":scope > .frame");
  assert.equal(band.getAttribute("aria-labelledby"), "book-h");
  assert.deepEqual([...frame.children].map((e) => e.id || e.className), ["eyebrow", "book-h", "lede", "resume", "restored", "booked", "retnote", "from-search"]);
  assert.ok($("booked").matches('div.notice.bk-note[role="status"]') && norm($("booked").querySelector("span").textContent) === "This trip is booked. Reference ." && $("booked-ref").matches("span") && $("booked").querySelector('a.lnk[href="/booking-confirmed"]').textContent === "See your booking");
  assert.deepEqual(["resume-k", "resume-p"].map((id) => [$(id).parentElement.parentElement.id, norm($(id).textContent)]), [["resume", "Your details are still here."], ["resume", "Book and pay online when you're ready."]]);
  assert.equal(norm(frame.querySelector(".eyebrow").textContent), "Reservations");
  assert.deepEqual([...doc.querySelectorAll("h1")].map((h) => [h.id, norm(h.textContent)]), [["book-h", "Book a car"]]);
  assert.equal(norm(frame.querySelector(".lede").textContent), "One form for an airport transfer or an hourly booking.");
  assert.equal($("bk-steps"), null);
  assert.deepEqual([...doc.querySelectorAll(".bk-stepno")].map((s) => [s.parentElement.id, s.tagName, s.textContent]), [["bk-opt-h", "SPAN", "Step 2 of 4"], ["bk-det-h", "SPAN", "Step 3 of 4"]]);
  const steps = $("book-h");
  const icon = (id) => $(id).firstElementChild.matches('svg.icon[aria-hidden="true"]') && $(id).firstElementChild.querySelector("use").getAttribute("href");
  assert.deepEqual(["resume", "restored", "retnote"].map((id) => [id, $(id).matches('div.notice.bk-note[role="status"]'), icon(id), norm($(id).querySelector("span").textContent)]), [
    ["resume", true, "#i-shield", "Payment not completed. Nothing was charged. Your details are still here. Book and pay online when you're ready."],
    ["restored", true, "#i-check", "We filled in your trip from earlier in this tab."],
    ["retnote", true, "#i-calendar", "Return trip: pickup and drop-off are swapped. Check the date and choose a time."]]);
  assert.equal($("resume").getAttribute("tabindex"), "-1");
  assert.ok($("resume-go").matches("button.btn.btn--sm.btn--ghost.js-only[type=button]") && norm($("resume-go").textContent) === "Book and pay online");
  assert.ok($("restored-clear").matches("button.lnk-btn[type=button]") && norm($("restored-clear").textContent) === "Clear" && $("restored").contains($("restored-clear")));
  assert.equal(norm($("resume").querySelector("b").textContent), "Payment not completed. Nothing was charged.");
  assert.ok($("from-search").matches("p.bk-note") && norm($("from-search").textContent) === "JavaScript is off in your browser, and your trip didn't carry over. Please enter it again below.");
  for (const id of ["resume", "restored", "retnote", "from-search"]) assert.ok(steps.compareDocumentPosition($(id)) & 4 && $(id).compareDocumentPosition($("book-form")) & 4 && !$("book-form").contains($(id)), id);
  const page = main.children[1].querySelector(":scope > .frame");
  assert.deepEqual([...page.children].map((e) => e.id || e.tagName.toLowerCase()), ["book-form", "bk-cc"]);
  assert.equal(page.lastElementChild.tagName, "TEMPLATE");
  assert.equal(main.querySelector('a[href="/rates"]'), null);
  assert.doesNotMatch(norm(main.textContent), /See all rates/);
});

check("book.html holds every #e- message and every #q- block a 303 can land on", () => {
  const ids = [...Object.keys(ERRORS).map((c) => `e-${c}`), ...Object.keys(REASONS).map((r) => `q-${r}`), "q-error"];
  assert.deepEqual(ids.filter((id) => !$(id)), []);
});

check("booking-confirmed.html carries every id of the contract", () => assert.deepEqual(CONFIRMED_IDS.filter((id) => !$(id, confirmed.document)), []));

const cf = confirmed.document;
check("booking-confirmed.html is noindex with no canonical", () => {
  assert.equal(cf.title, "Payment received | NYC LUX RIDE");
  assert.equal(cf.querySelector('meta[name="robots"]').content, "noindex");
  assert.equal(cf.querySelector('link[rel="canonical"]'), null);
});

check("booking-confirmed.html static copy works without javascript: seal, H1, the fallback reference line, next steps, P1, help line, home link, every scripted part hidden", () => {
  const h = $("cf-h", cf);
  assert.deepEqual([norm(h.textContent), h.dataset.missing, h.dataset.none], ["Payment received", "We couldn't find this payment", "We can't show a booking in this tab"]);
  const col = cf.querySelector("main > section.section.bk-conf#cf > .frame.bk-conf__col");
  assert.ok(col, "the one centered column");
  assert.deepEqual([...col.children].map((e) => e.id || e.className), ["bk-seal", "cf-h", "cf-test", "cf-refrow", "cf-noref", "cf-missing", "cf-none", "cf-trip", "cf-other", "cf-other-nojs", "cf-next", "cf-policy", "cf-acts", "cf-quiet", "cf-receipt", "cf-help", "", "cf-status"]);
  assert.deepEqual([...$("cf-receipt", cf).children].map((e) => e.id || e.tagName.toLowerCase()), ["cf-receipt-h", "cf-fail", "table", "cf-notes", "cf-summary"]);
  assert.deepEqual(["cf-gcal", "cf-share"].map((id) => $(id, cf).getAttribute("aria-disabled")), ["true", "true"]);
  assert.equal(col.querySelector(".bk-seal").outerHTML, '<p class="bk-seal" aria-hidden="true"><svg viewBox="0 0 56 56" width="56" height="56"><circle cx="28" cy="28" r="28"></circle><path d="M17 29l7.5 7.5L39 21" pathLength="1"></path></svg></p>');
  assert.ok($("cf-test", cf).matches('div.notice[role="status"][hidden]') && norm($("cf-test", cf).textContent) === "Test booking. No real payment was taken.");
  const chip = $("cf-refrow", cf);
  assert.ok(chip.matches("p.bk-ref[hidden]") && norm(chip.firstElementChild.textContent) === "Reference" && $("cf-ref", cf).matches("b") && $("cf-ref", cf).querySelector(".bk-sk"));
  assert.deepEqual(["type", "aria-label", "aria-disabled", "class"].map((a) => $("cf-copy", cf).getAttribute(a)).concat(norm($("cf-copy", cf).textContent)), ["button", "Copy the reference", "true", "lnk-btn", "Copy"]);
  assert.ok(!$("cf-noref", cf).hidden && norm($("cf-noref", cf).textContent) === "Your reference is on your Stripe receipt.");
  assert.ok($("cf-fail", cf).matches("div.notice[hidden]") && norm($("cf-fail", cf).querySelector("span").textContent) === "We couldn't load your booking details. Your reference is on your Stripe receipt." && $("cf-retry", cf).matches("button.btn.btn--sm.btn--ghost") && norm($("cf-retry", cf).textContent) === "Try again");
  assert.ok($("cf-missing", cf).hidden && norm($("cf-missing", cf).textContent) === "We'll check your booking when you call or message us.");
  assert.ok($("cf-none", cf).hidden && norm($("cf-none", cf).querySelector("p").textContent) === "This page shows your booking right after payment, in the tab you paid in. Your reference is on your Stripe receipt." && $("cf-none", cf).querySelector('a.btn[href="/book"]') && norm($("cf-none", cf).querySelector("a.btn").textContent) === "Book a car");
  assert.ok($("cf-other", cf).matches("div.bk-mrow__x[hidden]") && !$("cf-other", cf).textContent, "the someone-else line waits for the script");
  assert.ok($("cf-other-nojs", cf).matches("p.bk-mrow__x.bk-nojs:not([hidden])") && norm($("cf-other-nojs", cf).textContent) === norm($("bk-other-h").querySelector(".bk-nojs").textContent + $("bk-other-h").querySelector(".bk-cc-h").previousSibling.textContent), "without javascript the page repeats the step 3 sentence for someone else riding");
  assert.ok($("cf-trip", cf).matches("section.bk-trip[hidden]") && $("cf-route", cf).matches("ol.bk-trip__route.bk-route") && $("cf-rows", cf).matches("dl.bk-trip__rows") && !$("cf-route", cf).children.length && !$("cf-rows", cf).children.length);
  assert.ok($("cf-next", cf).matches('ol.next[role="list"]'));
  assert.deepEqual([...$("cf-next", cf).children].map((li) => [li.id, li.hidden, norm(li.querySelector("b").textContent), norm(li.querySelector("span").textContent)]), [["", false, "Paid", "Stripe emails your receipt with your reference."], ["", false, "Confirmed in writing", "We confirm your car and chauffeur in writing before your ride."], ["cf-day", true, "On the day", ""]]);
  assert.ok($("cf-policy", cf).matches("p.bk-policy") && norm($("cf-policy", cf).textContent) === POLICY.cancel);
  assert.ok($("cf-acts", cf).matches("p.btn-row[hidden]") && $("cf-ics", cf).matches('button.btn[type=button][aria-disabled="true"]') && norm($("cf-ics", cf).textContent) === "Add to calendar");
  assert.ok($("cf-return", cf).matches('a.btn.btn--ghost[href="/book#trip"][hidden]') && norm($("cf-return", cf).textContent) === "Book the return trip");
  assert.ok($("cf-quiet", cf).matches("p.bk-quiet[hidden]"));
  assert.deepEqual([...$("cf-quiet", cf).children].map((e) => [e.id, e.tagName, norm(e.textContent)]), [["cf-gcal", "A", "Add to Google Calendar (opens in a new tab)"], ["cf-share", "BUTTON", "Share trip details"], ["cf-wa", "A", "Message on WhatsApp (opens in a new tab)"], ["cf-print", "BUTTON", "Print or save as PDF"]]);
  assert.ok($("cf-gcal", cf).getAttribute("href").startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE") && $("cf-gcal", cf).target === "_blank" && $("cf-wa", cf).getAttribute("href") === "https://wa.me/16467750556");
  const r = $("cf-receipt", cf);
  assert.ok(r.hidden && r.matches("section.bk-price") && r.getAttribute("aria-labelledby") === "cf-receipt-h");
  assert.equal(norm($("cf-receipt-h", cf).textContent), "Your payment");
  assert.equal(norm($("cf-total", cf).closest("tr").querySelector("th").textContent), "Paid");
  assert.equal($("cf-receipt", cf).lastElementChild, $("cf-summary", cf));
  assert.ok($("cf-notes", cf).matches("ul.bk-later"));
  assert.deepEqual([$("cf-notes", cf).dataset.airport, $("cf-notes", cf).dataset.hourly, $("cf-notes", cf).dataset.outside, $("cf-notes", cf).textContent], [NOTES.included + "|" + POLICY.later.airport, POLICY.later.hourly, POLICY.later.outside, ""]);
  assert.equal(norm($("cf-help", cf).textContent), "Call +1 (646) 775-0556 or message us on WhatsApp. We answer calls and messages 24 hours a day, every day.");
  assert.deepEqual([...$("cf-help", cf).querySelectorAll("a")].map((a) => a.getAttribute("href")), ["tel:+16467750556", "https://wa.me/16467750556"]);
  assert.deepEqual([...$("cf-help", cf).querySelectorAll("span.nowrap")].map((n) => n.textContent), ["24 hours"], "24 hours stays whole, as on every other page");
  assert.ok($("cf-home", cf).matches('a.lnk[href="/"]') && norm($("cf-home", cf).textContent) === "Back to the homepage" && $("cf-home", cf).querySelector('svg.icon > use[href="#i-arrow"]'));
  assert.ok($("cf-status", cf).matches('p.sr-only[role="status"]'));
  assert.doesNotMatch(norm(cf.querySelector("main").textContent), /See all rates|Dispatch confirms your vehicle/);
  assert.equal(cf.querySelector('main a[href="/rates"]'), null);
  assert.equal(cf.getElementById("book-form"), null);
  const done = [...cf.head.querySelectorAll("script[src]")].find((x) => x.getAttribute("src").startsWith("/assets/done."));
  assert.ok(done && done.defer && done.getAttribute("blocking") === "render");
});

check("booking-confirmed.html: the phone number in the cancellation sentence stays on one line", () => {
  const n = $("cf-policy", cf).querySelector(".nowrap");
  assert.ok(n && n.matches("span") && n.textContent === "+1 (646) 775-0556", n ? n.outerHTML : "no .nowrap in #cf-policy");
});
check("booking-confirmed.html main uses only booking classes that lux.css or book.css styles, and no vehicle card class", () => {
  const used = [...new Set([...cf.querySelectorAll("main [class]")].flatMap((el) => [...el.classList]))].filter((c) => c.startsWith("bk-"));
  assert.deepEqual(used.filter((c) => !new RegExp(`\\.${c.replace(/[-_]/g, "\\$&")}(?![\\w-])`).test(SHEETS)), []);
  assert.equal(cf.querySelector("main .bk-card, main .bk-cols"), null);
  assert.ok(cf.querySelector("main .bk-conf #cf-receipt"));
});

for (const [name, { document }] of [["book.html", book], ["booking-confirmed.html", confirmed]]) {
  check(`${name}: no dollar figure, percent or USD in text or attributes`, () => {
    const body = document.body.cloneNode(true);
    for (const n of body.querySelectorAll("script, style")) n.remove();
    const attrs = [...document.querySelectorAll("*")].map((el) => [...el.attributes].map((a) => a.value)).flat();
    const all = [document.title, body.textContent, ...attrs].join(" ");
    assert.equal(all.match(/\$\s*\d|\d\s*%|\bUSD\b/), null);
  });

  const own = name === "book.html" ? "pay" : "done";
  check(`${name}: ${own} loads after lux and before gtag and tracking, all deferred`, () => {
    const scripts = [...document.head.querySelectorAll("script[src]")];
    assert.deepEqual(scripts.map((s) => s.getAttribute("src").replace(/\.[A-Za-z0-9_-]{6,}\.js$/, ".js")), ["/assets/lux.js", `/assets/${own}.js`, "/assets/gtag.js", "/assets/tracking.js"]);
    assert.ok(scripts.every((s) => s.defer), "a script is not deferred");
  });

  check(`${name}: every phone and WhatsApp link is exact`, () => {
    const bad = [...document.querySelectorAll('a[href^="tel:"], a[href*="wa.me"]')]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h !== "tel:+16467750556" && !h.startsWith("https://wa.me/16467750556"));
    assert.deepEqual(bad, []);
  });
}

check("the pay script loads in the head of the five FULL hosts, lux.js brings it to the 15 SEARCH hosts, the confirmation page loads the done script, and nowhere else checked here", () => {
  assert.equal(HOSTS.length, 20);
  for (const f of HOSTS.slice(0, 5)) assert.ok(readFileSync(join(ROOT, f), "utf8").includes(`/assets/${payName}`), f);
  for (const f of [...HOSTS.slice(5), "booking-confirmed.html"]) assert.ok(!readFileSync(join(ROOT, f), "utf8").includes("/assets/pay."), f);
  assert.ok(doneName && readFileSync(join(ROOT, "booking-confirmed.html"), "utf8").includes(`/assets/${doneName}`));
  assert.ok(LUX.includes(`"/assets/${payName}"`), "lux.js does not load the current pay script");
  const others = ["rates.html", "404.html", "faq.html", "locations.html"].filter((f) => /\/assets\/(pay|done)\./.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(others, []);
});

check("pay.js loads the current second booking script, and no page links it", () => {
  assert.ok(pay2Name && PAY.includes(`"/assets/${pay2Name}"`), "pay.js does not load the current second booking script");
  assert.deepEqual([...HOSTS, "booking-confirmed.html"].filter((f) => readFileSync(join(ROOT, f), "utf8").includes("/assets/pay2.")), []);
});

check("lux.js, done.js, gtag.js and tracking.js keep their own function scope, so the top-level names of pay.js and pay2.js meet no other script", () => {
  const own = [["lux", LUX], ["done", DONE], ...["gtag.js", "tracking.js"].map((n) => [n, readFileSync(join(ROOT, "assets", n), "utf8")])];
  assert.deepEqual(own.filter(([, s]) => !/^\((\(\)=>\{|function \(\) \{)/.test(s.trim()) || !/\}\)\(\);$/.test(s.trim())).map(([n]) => n), []);
});

check("the pay script follows only a Checkout origin of the config or the mock confirmation", () => {
  const m = SRC.match(/\/(\^\(https:\\\/\\\/checkout[^)]*\))\/\.test/);
  assert.ok(m, "no payment URL rule found");
  const rule = new RegExp(m[1]);
  for (const o of CHECKOUT_ORIGINS) assert.ok(rule.test(`${o}/c/pay/cs_test_a1`), `${o} is refused`);
  assert.ok(rule.test("/booking-confirmed?session_id=cs_mock_7K3Q2P"));
  for (const bad of ["https://checkout.stripe.com.example.com/c/pay", "https://example.com/c/pay", "//checkout.stripe.com/c/pay", "/booking-confirmed?session_id=cs_live_a1", "javascript:alert(1)"]) {
    assert.equal(rule.test(bad), false, `${bad} is followed`);
  }
});

check("the done script labels a test or mock session and never a live one, and pay.js no longer holds the confirmation", () => {
  const m = DONE.match(/hd\("test",!\/([^/]+)\/\.test\(id\)\)/);
  assert.ok(m, "no test label rule found");
  const rule = new RegExp(m[1]);
  for (const id of ["cs_test_a1b2c3d4e5f6", "cs_mock_7K3Q2P"]) assert.ok(rule.test(id), `${id} is not labelled`);
  for (const id of ["cs_live_a1b2c3d4e5f6", "xcs_test_a1", ""]) assert.equal(rule.test(id), false, `${id} is labelled`);
  assert.doesNotMatch(SRC, /cf-h|cf-receipt|cf-test/);
});

check("the done script repeats the rider's notes on the trip card as Your notes, escaped, from the booking saved in this tab, and the session lookup never returns them", () => {
  assert.ok(DONE.includes('+rw("Your notes",ES([f.notes]));'), "the trip card does not repeat the notes");
  assert.doesNotMatch(DONE, /rider_notes|s\.notes_text/);
  assert.doesNotMatch(readFileSync(join(ROOT, "api/book.mjs"), "utf8"), /rider_notes|metadata\.notes/);
});

check("the pay and done scripts carry no comment, hold no price figure, and pay.js uses the config advance limit and notice window", () => {
  for (const s of [SRC, DONE.replace('"PRODID:-//NYC LUX RIDE//Booking//EN"', '""')]) assert.doesNotMatch(s, /\/\*|(^|[^:"'\\])\/\/(?![\\/]|wa\.me)/m);
  assert.equal(DONE.match(/\$\d|8\.875|2\.25/g), null);
  const figures = [...new Set([...Object.values(AIRPORT_FARES), ...Object.values(AIRPORT_TOTALS)].flatMap((o) => Object.values(o)).concat(MEET_AND_GREET, ...Object.values(VEHICLES).map((v) => v.hourly).filter(Boolean)))];
  assert.deepEqual(figures.filter((c) => new RegExp(`(^|[^\\d.])${c}(?![\\d])`).test(SRC)), []);
  assert.equal(SRC.match(/\$\d|8\.875|2\.25/g), null);
  assert.match(SRC, new RegExp(`${MAX_ADVANCE_DAYS}\\*864e5`));
  const notice = SRC.match(/NW=\(\)=>ny\(Date\.now\(\)\+([\de.]+)\+59999\)/);
  assert.equal(notice && Number(notice[1]), MIN_NOTICE_HOURS * 36e5, "the browser notice window is MIN_NOTICE_HOURS");
  assert.doesNotMatch(SRC, /next 24 hours|24 hours (ahead|away)/);
  assert.doesNotMatch(SRC, /moovs/i);
});

check("the pickup that fills in by itself (owner request 2) is the first slot MIN_NOTICE_HOURS plus AUTO_LEAD_MINUTES ahead, it moves once it is less than MIN_NOTICE_HOURS plus AUTO_GUARD_MINUTES away, and the scripts hold no NLR- reference (owner request 5)", () => {
  const slot = SRC.match(/AQ=\(\)=>\{for\(let t=Math\.ceil\(\(Date\.now\(\)\+AO\+([\de.]+)\+([\de.]+)\)\/6e5\)\*6e5/);
  assert.ok(slot, "no auto slot");
  assert.deepEqual([Number(slot[1]), Number(slot[2])], [MIN_NOTICE_HOURS * 36e5, AUTO_LEAD_MINUTES * 6e4]);
  const guard = SRC.match(/ED\.value\+" "\+ET\.value<ny\(Date\.now\(\)\+AO\+([\de.]+)\+([\de.]+)\)/);
  assert.ok(guard, "no guard");
  assert.deepEqual([Number(guard[1]), Number(guard[2])], [MIN_NOTICE_HOURS * 36e5, AUTO_GUARD_MINUTES * 6e4]);
  assert.match(SRC, /NW=\(\)=>ny\(Date\.now\(\)\+36e5\+59999\)/);
  assert.doesNotMatch(SRC, /NLR-/);
});

check("pay.js, done.js and lux.js store only the booking state in sessionStorage and never use localStorage or cookies", () => {
  for (const s of [SRC, DONE, LUX]) assert.doesNotMatch(s, /localStorage|document\.cookie/);
  assert.deepEqual([...new Set([SRC, DONE, LUX].join("\n").match(/"nlr-[a-z-]+"/g))].sort(), ['"nlr-book"', '"nlr-cf"', '"nlr-purchase-"']);
});

check("restored and autofilled fields keep the filled look (owner request 3): no wash box anywhere, the restore cue is a colour-only tint under 1 s with motion only, and the autofill rule only holds the browser's autofill colours back", () => {
  assert.doesNotMatch(SHEETS, /is-washed/);
  assert.doesNotMatch(SRC, /is-washed/);
  const af = SHEETS.match(/[^{}]*:autofill[^{}]*\{([^}]*)\}/g) || [];
  assert.deepEqual(af.map((r) => r.slice(r.indexOf("{"))), ["{transition:background-color 0s 99999s,color 0s 99999s}"]);
  assert.match(SHEETS, /@media \(prefers-reduced-motion:no-preference\)\{\.bk \.is-tint :is\(input,\.bk-pick\)\{animation:bk-tint \.9s [^}]*\}\}/);
  assert.match(SHEETS, /@keyframes bk-tint\{from\{color:var\(--bg\)\}\}/);
  assert.match(PAY, /ws=e=>\{e\.classList\.remove\("is-tint"\);e\.offsetWidth;e\.classList\.add\("is-tint"\);setTimeout\(\(\)=>e\.classList\.remove\("is-tint"\),1e3\)\}/);
});

check("the time picker (owner request 1) lives in the booking layer with the date picker's popover look and the panels' 0.15 s open and close that reduced motion drops, and the pay scripts keep the native select as the source of truth", () => {
  assert.match(SHEETS, /\.bk\.is-js:not\(\.bk-p2off\) :is\(\.bk-date>input,\.bk-time>select\),\.bk:is\(:not\(\.is-js\),\.bk-p2off\) \.bk-pick\{display:none\}/);
  assert.match(SHEETS, /\.bk-tm\{left:auto;width:max\(100%,17\.5rem\);gap:0;padding:8px;border-radius:16px\}/);
  assert.match(SHEETS, /@media \(prefers-reduced-motion:no-preference\)\{\.bk-pop,\.bk-cal\{transition:opacity var\(--dur-fast\) var\(--ease-quick\),translate var\(--dur-fast\) var\(--ease-quick\),display var\(--dur-exit\) allow-discrete\}/);
  assert.doesNotMatch(SHEETS, /\.bk-tm[^{]*\{transition-duration/);
  assert.match(SRC, /TI\.value=o\.dataset\.v,xt\(1\),TI\.dispatchEvent\(new Event\("change",\{bubbles:!0\}\)\)/, "a pick writes the select and fires its change event");
  assert.match(SRC, /AXF=\(f,a\)=>\{if\(AX\|\|IL\|\|PS\|\|RM\(\)\|\|F\.dataset\.step=="search"\)return f\(\.\.\.a\)/, "the card motion (owner request 2) never runs with reduced motion, on the first load, during a step switch or on step 1");
});

check("a short-notice payment tells the rider on the confirmation page that the car is confirmed shortly", () => {
  const s = $("cf-confirm", confirmed.document);
  assert.ok(s && s.matches("#cf-next > li > span"), "no #cf-confirm in the next steps");
  assert.equal(s.textContent, "We confirm your car and chauffeur in writing before your ride.");
  assert.equal(s.dataset.soon, "Your pickup is soon, so we'll confirm your car and chauffeur in writing shortly.");
  assert.match(DONE, /s\.short_notice&&T\("cf-confirm",\$\("cf-confirm"\)\.dataset\.soon\)/);
});

check("if pay2.js fails to load, or has not run 4 s in, the form shows the native date input and time select at once, drops the queued picker work, still fetches the script once more, keeps the native controls when the script turns up after the form was used, and pays by a plain form post until the script runs", () => {
  assert.match(SRC, /p2f=\(\)=>P2\|\|\(P2=-1,PQ\.length=0,F\.classList\.add\("bk-p2off"\)/);
  assert.match(SRC, /onerror:\(\)=>\(p2f\(\),x\|\|setTimeout\(l2,2e3,1\)\)/);
  assert.match(SRC, /setTimeout\(p2f,4e3\)/);
  assert.match(SRC, /P2<0&&\(FF\|\|F\.contains\(d\.activeElement\)\)\|\|\(P2=1,F\.classList\.remove\("bk-p2off"\),bt\(\)/);
  assert.match(SRC, /p2=f=>P2>0\?f\(\):P2\|\|PQ\.push\(f\)/);
  assert.match(SRC, /F\.onsubmit=e=>\{let s=F\.dataset\.step;if\(s=="details"&&P2<1\)return;e\.preventDefault\(\)/);
  assert.match(SRC, /BG\.onclick=\(\)=>F\.dataset\.step=="details"\?P2<1\?F\.requestSubmit\(B\)/);
  assert.doesNotMatch(SRC, /p2\([A-Za-z0-9_$]+\)/, "a bare pay2 name is read before pay2.js is there");
  assert.match(SHEETS, /\.bk\.is-js:not\(\.bk-p2off\) \.bk-time::after\{content:none\}/);
});

check("without javascript the payment notice makes no promise about kept details, and on every page with the booking form the form error is one text block, so it reads as one line next to its icon", () => {
  assert.ok($("resume-k").classList.contains("js-only"));
  for (const f of ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html"]) {
    const e = read(f).document.getElementById("e-form");
    assert.deepEqual([...e.childNodes].map((n) => n.nodeName), ["SPAN"], f);
    assert.equal(norm(e.textContent), ERRORS.form.text, f);
  }
});

if (failures) {
  console.error(`\n${failures} book page assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll book page tests passed");
process.exit(0);
