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

function submit(window, selector) {
  window.document.querySelector(selector).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`);
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
  assert.ok(conversions().every((c) => c[2].send_to === `${ADS_ID}/0YD2COGt8L8cEIX4gOJD`));
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

const FORMS = '<form class="trip" method="get" action="/book"><button class="btn trip__book" type="submit">Book a car</button></form><form id="book-form" class="book" method="post" action="/api/book"><button id="bk-submit" type="submit">Continue</button></form>';

test("a submit of the hero trip form fires book_now_click once", () => {
  const { window, calls, conversions } = boot("https://www.nycluxride.com/", FORMS);
  submit(window, "form.trip");
  assert.deepEqual(events(calls), ["book_now_click"]);
  assert.equal(conversions().length, 1);
  assert.equal(conversions()[0][2].send_to, `${ADS_ID}/0YD2COGt8L8cEIX4gOJD`);
});

test("a submit of the booking form fires nothing", () => {
  const { window, calls } = boot("https://www.nycluxride.com/book", FORMS);
  submit(window, "#book-form");
  assert.deepEqual(calls, []);
});

test("a click on the hero submit button is not counted as a link click", () => {
  const { window, calls } = boot("https://www.nycluxride.com/", FORMS);
  window.document.querySelector("form.trip").addEventListener("submit", (e) => e.preventDefault());
  click(window, ".trip__book");
  assert.deepEqual(events(calls), ["book_now_click"]);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tracking tests passed");
process.exit(0);
