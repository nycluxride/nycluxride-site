import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const TRACKING_SRC = readFileSync(
  fileURLToPath(new URL("../assets/tracking.js", import.meta.url)),
  "utf8"
);

const ORIGINAL_TEL = "tel:+16467750556";
const FORWARD = { formatted: "+1 (800) 555-1212", mobile: "+18005551212" };
const FORWARD_TEL = "tel:+18005551212";
const FORWARD_DIGITS = "18005551212";

function boot(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: "outside-only",
  });
  const { window } = dom;
  window.__nlrForwardNumber = { formatted: FORWARD.formatted, mobile: FORWARD.mobile };
  window.eval(TRACKING_SRC);
  window.__nlrApplyForwardNumber();
  return window;
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

test("tel: re-swaps after React restores the original href with a stale marker", () => {
  const win = boot(`<a id="call" href="${ORIGINAL_TEL}">Call us</a>`);
  const a = win.document.getElementById("call");

  assert.equal(a.getAttribute("href"), FORWARD_TEL, "initial tel: swap did not apply");
  assert.equal(a.dataset.nlrSwapped, FORWARD_DIGITS, "marker not set after tel: swap");

  a.setAttribute("href", ORIGINAL_TEL);
  assert.equal(a.dataset.nlrSwapped, FORWARD_DIGITS, "precondition: marker must still be stale");

  win.__nlrApplyForwardNumber();

  assert.equal(
    a.getAttribute("href"),
    FORWARD_TEL,
    "stale marker blocked the tel: re-swap — guard is NOT content-authoritative"
  );
});

test("text node re-swaps after React restores the original text with a stale marker", () => {
  const win = boot(`<span id="txt">Call +1 (646) 775-0556 today</span>`);
  const span = win.document.getElementById("txt");

  assert.equal(span.textContent, "Call +1 (800) 555-1212 today", "initial text swap did not apply");
  assert.equal(span.getAttribute("data-nlr-swapped"), FORWARD_DIGITS, "marker not set after text swap");

  span.firstChild.nodeValue = "Call +1 (646) 775-0556 today";
  assert.equal(span.getAttribute("data-nlr-swapped"), FORWARD_DIGITS, "precondition: marker must still be stale");

  win.__nlrApplyForwardNumber();

  assert.equal(
    span.textContent,
    "Call +1 (800) 555-1212 today",
    "stale marker blocked the text re-swap — guard is NOT content-authoritative"
  );
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll re-render resilience tests passed");
process.exit(0);
