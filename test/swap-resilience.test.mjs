/*
 * Re-render resilience regression tests for assets/tracking.js (phone-swap).
 *
 * The bug class these lock out: a React re-render patches an element's href/text
 * back to the ORIGINAL number IN PLACE (same DOM node, no remount) while our
 * data-nlr-swapped marker is left stale. The swap must still re-fire, because the
 * guards are CONTENT-authoritative — the marker is bookkeeping only and must never
 * gate a re-swap. If anyone later reintroduces a `dataset.nlrSwapped === fwdDigits
 * -> skip` short-circuit ahead of the href/text inspection, both tests below fail.
 *
 * Driven through the real, unmodified public entry point
 * window.__nlrApplyForwardNumber() — the same hook gtag.js's
 * phone_conversion_callback invokes. No test framework: node:assert only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const TRACKING_SRC = readFileSync(
  fileURLToPath(new URL("../assets/tracking.js", import.meta.url)),
  "utf8"
);

const ORIGINAL_TEL = "tel:+16467750556";
// A Google forwarding number distinct from the original, exactly as
// gtag.js stashes it on window.__nlrForwardNumber = { formatted, mobile }.
const FORWARD = { formatted: "+1 (800) 555-1212", mobile: "+18005551212" };
const FORWARD_TEL = "tel:+18005551212";
const FORWARD_DIGITS = "18005551212";

// Build a jsdom window, stash the forwarding number, then evaluate tracking.js.
// Evaluating the source runs its start()->apply() immediately (the document is
// already parsed), so the fixture is swapped on load. `outside-only` gives us
// window.eval without executing any in-document <script>. Returns the window.
function boot(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: "outside-only",
  });
  const { window } = dom;
  window.__nlrForwardNumber = { formatted: FORWARD.formatted, mobile: FORWARD.mobile };
  window.eval(TRACKING_SRC);
  // tracking.js defers start() to DOMContentLoaded when readyState is "loading"
  // (jsdom's state right after construction), so drive the initial "on load"
  // swap explicitly through the real public entry point rather than depending on
  // jsdom's event-loop timing.
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

// --- tel: path ---------------------------------------------------------------
test("tel: re-swaps after React restores the original href with a stale marker", () => {
  const win = boot(`<a id="call" href="${ORIGINAL_TEL}">Call us</a>`);
  const a = win.document.getElementById("call");

  // Initial swap happened on load.
  assert.equal(a.getAttribute("href"), FORWARD_TEL, "initial tel: swap did not apply");
  assert.equal(a.dataset.nlrSwapped, FORWARD_DIGITS, "marker not set after tel: swap");

  // Simulate React patching href back to the original, in place, WITHOUT clearing
  // our marker — the exact re-render race we must survive.
  a.setAttribute("href", ORIGINAL_TEL);
  assert.equal(a.dataset.nlrSwapped, FORWARD_DIGITS, "precondition: marker must still be stale");

  win.__nlrApplyForwardNumber();

  assert.equal(
    a.getAttribute("href"),
    FORWARD_TEL,
    "stale marker blocked the tel: re-swap — guard is NOT content-authoritative"
  );
});

// --- text path ---------------------------------------------------------------
test("text node re-swaps after React restores the original text with a stale marker", () => {
  const win = boot(`<span id="txt">Call +1 (646) 775-0556 today</span>`);
  const span = win.document.getElementById("txt");

  assert.equal(span.textContent, "Call +1 (800) 555-1212 today", "initial text swap did not apply");
  assert.equal(span.getAttribute("data-nlr-swapped"), FORWARD_DIGITS, "marker not set after text swap");

  // React restores the original text node value in place; marker left stale.
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
