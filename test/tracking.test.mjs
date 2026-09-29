import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const SRC = readFileSync(fileURLToPath(new URL("../assets/tracking.js", import.meta.url)), "utf8");
const LABEL_LINE = 'var PURCHASE_LABEL = "";';
const TEST_LABEL = "TESTPURCHASELABEL";
const ADS_ID = "AW-18190711813";

function boot(url, body = "", label = false) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, runScripts: "outside-only" });
  const { window } = dom;
  const calls = [];
  window.NLR_ADS_ID = ADS_ID;
  window.nlrGtag = (...args) => calls.push(args);
  window.eval(label ? SRC.replace(LABEL_LINE, `var PURCHASE_LABEL = "${TEST_LABEL}";`) : SRC);
  return { window, calls, conversions: () => JSON.parse(JSON.stringify(calls.filter((c) => c[0] === "event" && c[1] === "conversion"))) };
}

function click(window, selector) {
  window.document.querySelector(selector).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function submit(window, button) {
  const b = window.document.querySelector(button);
  b.form.addEventListener("submit", (e) => e.preventDefault());
  b.form.requestSubmit(b);
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 12).join("\n       ")}`);
  }
}

test("tracking.js carries no comments", () => {
  assert.doesNotMatch(SRC, /\/\*|(^|[^:"'])\/\/(?!wa\.me)/m);
});

test("the purchase label line is exactly the empty constant", () => {
  assert.equal(SRC.split("\n").filter((l) => l.includes("PURCHASE_LABEL =")).map((l) => l.trim()).join("|"), LABEL_LINE);
});

test("nlrPurchase fires one conversion with value, currency and transaction id for a live session", () => {
  const { window, conversions } = boot("https://www.nycluxride.com/booking-confirmed", "", true);
  assert.equal(window.nlrPurchase("cs_live_a1b2c3d4e5f6", "NLR-7K3Q2P", 22300), true);
  assert.deepEqual(conversions(), [["event", "conversion", { send_to: `${ADS_ID}/${TEST_LABEL}`, value: 223, currency: "USD", transaction_id: "NLR-7K3Q2P" }]]);
});

for (const [why, url, id] of [
  ["a test session", "https://www.nycluxride.com/booking-confirmed", "cs_test_a1b2c3d4e5f6"],
  ["a mock session", "https://www.nycluxride.com/booking-confirmed", "cs_mock_7K3Q2P"],
  ["a vercel.app host", "https://nycluxride-git-main.vercel.app/booking-confirmed", "cs_live_a1b2c3d4e5f6"],
  ["the bare domain", "https://nycluxride.com/booking-confirmed", "cs_live_a1b2c3d4e5f6"],
  ["a local server", "http://127.0.0.1:4173/booking-confirmed", "cs_live_a1b2c3d4e5f6"],
]) {
  test(`nlrPurchase fires nothing for ${why}`, () => {
    const { window, calls } = boot(url, "", true);
    assert.equal(window.nlrPurchase(id, "NLR-7K3Q2P", 16500), false);
    assert.deepEqual(calls, []);
  });
}

test("nlrPurchase fires nothing with the real empty label", () => {
  const { window, calls } = boot("https://www.nycluxride.com/booking-confirmed");
  assert.equal(window.nlrPurchase("cs_live_a1b2c3d4e5f6", "NLR-7K3Q2P", 16500), false);
  assert.deepEqual(calls, []);
});

test("nlrPurchase returns false without throwing when the tag is absent", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://www.nycluxride.com/booking-confirmed", runScripts: "outside-only" });
  dom.window.eval(SRC.replace(LABEL_LINE, `var PURCHASE_LABEL = "${TEST_LABEL}";`));
  assert.equal(dom.window.nlrPurchase("cs_live_a1b2c3d4e5f6", "NLR-7K3Q2P", 16500), false);
});

const LINKS = '<a id="book" href="/book">Book a car</a><a id="bookq" href="/book?trip-type=one">Book a car</a><a id="bookh" href="/book#resume">Book a car</a><a id="booking" href="/booking-guide">Guide</a><a id="tel" href="tel:+16467750556">Call</a><a id="wa" href="https://wa.me/16467750556">WhatsApp</a><a id="rates" href="/rates">Rates</a>';
const events = (calls) => calls.filter((c) => c[0] === "event" && c[1] !== "conversion").map((c) => c[1]);

test("a click on a /book link fires book_now_click on /rates", () => {
  const { window, calls, conversions } = boot("https://www.nycluxride.com/rates", LINKS);
  for (const id of ["#book", "#bookq", "#bookh"]) click(window, id);
  assert.deepEqual(events(calls), ["book_now_click", "book_now_click", "book_now_click"]);
  assert.deepEqual(conversions().map((c) => c[2].send_to), Array(3).fill(`${ADS_ID}/0YD2COGt8L8cEIX4gOJD`));
});

test("a click on a path that only starts with /book fires nothing", () => {
  const { window, calls } = boot("https://www.nycluxride.com/rates", LINKS);
  click(window, "#booking");
  click(window, "#rates");
  assert.deepEqual(calls, []);
});

for (const path of ["/book", "/booking-confirmed"]) {
  test(`a click on a /book link fires nothing on ${path}`, () => {
    const { window, calls } = boot(`https://www.nycluxride.com${path}`, LINKS);
    click(window, "#book");
    assert.deepEqual(calls, []);
  });
}

test("phone and WhatsApp clicks keep their labels on /book", () => {
  const { window, calls, conversions } = boot("https://www.nycluxride.com/book", LINKS);
  click(window, "#tel");
  click(window, "#wa");
  assert.deepEqual(events(calls), ["call_click", "whatsapp_click"]);
  assert.deepEqual(conversions().map((c) => c[2].send_to), [`${ADS_ID}/Sz9RCOSt8L8cEIX4gOJD`, `${ADS_ID}/yIstCOet8L8cEIX4gOJD`]);
});

test("phone and WhatsApp clicks fire nothing on /booking-confirmed", () => {
  const { window, calls } = boot("https://www.nycluxride.com/booking-confirmed", LINKS);
  click(window, "#tel");
  click(window, "#wa");
  assert.deepEqual(calls, []);
});

const FORM = '<form id="book-form" class="bk" method="post" action="/api/book"><button class="btn" id="bk-view" type="submit" name="action" value="options">View options</button><button class="btn" id="bk-submit" type="submit" name="action" value="pay">Continue to payment</button></form>';

for (const path of ["/", "/locations/jfk-airport", "/locations/laguardia-airport"]) {
  test(`View options on the booking form fires book_now_click once per page view on ${path}`, () => {
    const { window, calls, conversions } = boot(`https://www.nycluxride.com${path}`, FORM);
    submit(window, "#bk-view");
    submit(window, "#bk-view");
    assert.deepEqual(events(calls), ["book_now_click"]);
    assert.equal(conversions().length, 1);
    assert.equal(conversions()[0][2].send_to, `${ADS_ID}/0YD2COGt8L8cEIX4gOJD`);
  });
}

const SEARCH_FORM = '<form id="book-form" class="bk bk--go" method="get" action="/book#from-search"><button class="btn" id="bk-view" type="submit" name="action" value="options">View options</button></form>';
for (const path of ["/services", "/chauffeur-service-nyc", "/locations/manhattan"]) {
  test(`View options on the SEARCH form fires book_now_click once per page view on ${path}`, () => {
    const { window, calls, conversions } = boot(`https://www.nycluxride.com${path}`, SEARCH_FORM);
    submit(window, "#bk-view");
    submit(window, "#bk-view");
    assert.deepEqual(events(calls), ["book_now_click"]);
    assert.equal(conversions()[0][2].send_to, `${ADS_ID}/0YD2COGt8L8cEIX4gOJD`);
  });
}

test("Continue in step 2, on the card column or on the phone bar, fires nothing", () => {
  const steps = '<form id="book-form" class="bk" method="post" action="/api/book" data-step="options"><button class="btn" id="bk-next" type="button">Continue</button><div id="bk-bar"><button class="btn" id="bk-bar-go" type="button">Continue</button></div></form>';
  for (const path of ["/book", "/"]) {
    const { window, calls } = boot(`https://www.nycluxride.com${path}`, steps);
    click(window, "#bk-next");
    click(window, "#bk-bar-go");
    assert.deepEqual(calls, [], path);
  }
});

test("step 1 controls that are not View options fire nothing on a SEARCH host: the swap, Add stop, the calendar day and the stop remove button", () => {
  const form = '<form id="book-form" class="bk bk--go" method="get" action="/book#from-search"><div id="bk-to-f"><button class="bk-swap" type="button" aria-label="Swap pickup and drop-off"></button></div><button class="bk-link" id="bk-addstop" type="button">Add stop</button><button class="bk-rm" id="bk-stop1-rm" type="button">Remove stop 1</button><div class="bk-cal"><button class="bk-cal__day" type="button" data-day="2026-10-22">22</button></div><button class="btn" id="bk-view" type="submit" name="action" value="options">View options</button></form>';
  const { window, calls } = boot("https://www.nycluxride.com/locations/jfk-airport", form);
  for (const s of [".bk-swap", "#bk-addstop", "#bk-stop1-rm", ".bk-cal__day"]) click(window, s);
  assert.deepEqual(calls, []);
  submit(window, "#bk-view");
  assert.deepEqual(events(calls), ["book_now_click"]);
});

test("the passenger stepper, the trip chips, the Change buttons and the phone bar fire nothing in steps 2 and 3", () => {
  const steps = '<form id="book-form" class="bk" method="post" action="/api/book" data-step="details"><div class="bk-sum"><button class="bk-chip" type="button" data-f="from">JFK</button></div><div class="bk-stepper"><button type="button" aria-label="More passengers"></button></div><dl id="bk-check-rows"><div><dd><button class="lnk-btn" type="button" data-c="when">Change</button></dd></div></dl><div id="bk-bar"><button class="btn" id="bk-bar-go" type="button">Continue to payment</button></div></form>';
  for (const path of ["/book", "/"]) {
    const { window, calls } = boot(`https://www.nycluxride.com${path}`, steps);
    for (const s of [".bk-chip", ".bk-stepper button", "#bk-check-rows button", "#bk-bar-go"]) click(window, s);
    assert.deepEqual(calls, [], path);
  }
});

test("Book a car in the header, the action bar or the menu of a host fires nothing once the handler points it at #book-form", () => {
  const chrome = '<div class="site-header__desk"><a class="btn" href="#book-form">Book a car</a></div><nav class="actionbar"><a class="actionbar__cell actionbar__cell--book" href="#book-form">Book a car</a></nav><div class="nav-panel__book"><a class="btn btn--block" href="#book-form">Book a car</a></div>' + SEARCH_FORM;
  const { window, calls } = boot("https://www.nycluxride.com/locations/manhattan", chrome);
  for (const s of [".site-header__desk .btn", ".actionbar__cell--book", ".nav-panel__book .btn"]) click(window, s);
  assert.deepEqual(calls, []);
});

test("View options on /book fires nothing", () => {
  const { window, calls } = boot("https://www.nycluxride.com/book", FORM);
  submit(window, "#bk-view");
  assert.deepEqual(calls, []);
});

test("Continue to payment fires nothing on the homepage and on /book", () => {
  for (const path of ["/", "/book"]) {
    const { window, calls } = boot(`https://www.nycluxride.com${path}`, FORM);
    submit(window, "#bk-submit");
    assert.deepEqual(calls, [], path);
  }
});

test("a submit of another form fires nothing", () => {
  const { window, calls } = boot("https://www.nycluxride.com/", '<form id="other"><button id="go" type="submit" name="action" value="options">Go</button></form>');
  submit(window, "#go");
  assert.deepEqual(calls, []);
});

test("a click on View options is not counted as a link click", () => {
  const { window, calls } = boot("https://www.nycluxride.com/", FORM);
  window.document.querySelector("#book-form").addEventListener("submit", (e) => e.preventDefault());
  click(window, "#bk-view");
  assert.deepEqual(events(calls), ["book_now_click"]);
});

test("tracking.js no longer names the old hero form", () => {
  assert.doesNotMatch(SRC, /form\.trip|trip__/);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tracking tests passed");
process.exit(0);
