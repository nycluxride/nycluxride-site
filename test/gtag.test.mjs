import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const SRC = readFileSync(fileURLToPath(new URL("../assets/gtag.js", import.meta.url)), "utf8");
const TRACKING = readFileSync(fileURLToPath(new URL("../assets/tracking.js", import.meta.url)), "utf8");
const ADS_ID = "AW-18190711813";
const TAG_URL = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}&l=nlrDataLayer`;

function boot(url, body = "", setup) {
  const { window } = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, { url, runScripts: "outside-only" });
  if (setup) setup(window);
  window.eval(SRC);
  return window;
}

const configs = (window) => [...window.nlrDataLayer].filter((a) => a[0] === "config");
const tags = (window) => [...window.document.querySelectorAll("script[src]")].map((s) => s.src);
const loaded = (window) => new Promise((ok) => (window.document.readyState === "complete" ? ok() : window.addEventListener("load", () => ok())));
const pause = (window, ms) => new Promise((ok) => window.setTimeout(ok, ms));

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

const pending = [];
function later(name, fn) {
  pending.push([name, fn().then(() => null, (err) => err)]);
}

test("gtag.js carries no comments", () => {
  assert.doesNotMatch(SRC, /\/\*|(^|[^:"'])\/\//m);
});

later("on www gtag.js adds the Google tag for the Ads id on nlrDataLayer about a second after the page has loaded, and only once", async () => {
  const window = boot("https://www.nycluxride.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp");
  assert.equal(window.NLR_ADS_ID, ADS_ID);
  assert.equal(window.document.readyState, "loading");
  assert.deepEqual(tags(window), []);
  await loaded(window);
  await pause(window, 300);
  assert.deepEqual(tags(window), []);
  await pause(window, 900);
  assert.deepEqual(tags(window), [TAG_URL]);
  for (const type of ["pointerdown", "keydown"]) window.document.body.dispatchEvent(new window.Event(type, { bubbles: true }));
  assert.deepEqual(tags(window), [TAG_URL]);
});

later("on www in a browser with requestIdleCallback, gtag.js asks for an idle moment a second after the load, with a 1 s timeout, and adds the Google tag there, once", async () => {
  const idle = [];
  const window = boot("https://www.nycluxride.com/rates", "", (w) => {
    w.requestIdleCallback = (cb, options) => {
      idle.push(JSON.stringify(options));
      return w.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
    };
  });
  await loaded(window);
  await pause(window, 300);
  assert.deepEqual([tags(window), idle], [[], []]);
  await pause(window, 900);
  assert.deepEqual([tags(window), idle], [[TAG_URL], ['{"timeout":1000}']]);
  window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  assert.deepEqual([tags(window), idle.length], [[TAG_URL], 1]);
});

test("on www a pointerdown on an element whose own handler stops it still adds the Google tag at once, because the early listeners sit on the document in the capture phase", () => {
  const window = boot("https://www.nycluxride.com/book", '<button id="b" type="button">Book</button>');
  const b = window.document.getElementById("b");
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
  b.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  assert.deepEqual(tags(window), [TAG_URL]);
});

for (const type of ["pointerdown", "keydown"]) {
  later(`on www a ${type} before the page has loaded adds the Google tag at once, and the load adds no second copy`, async () => {
    const window = boot("https://www.nycluxride.com/book");
    assert.deepEqual(tags(window), []);
    window.document.body.dispatchEvent(new window.Event(type, { bubbles: true }));
    assert.deepEqual(tags(window), [TAG_URL]);
    await loaded(window);
    await pause(window, 1200);
    assert.deepEqual(tags(window), [TAG_URL]);
  });
}

later("on www the confirmation page adds the Google tag at once, so the purchase does not wait for the load, and only once", async () => {
  const window = boot("https://www.nycluxride.com/booking-confirmed?session_id=cs_test_a1");
  assert.deepEqual(tags(window), [TAG_URL]);
  await loaded(window);
  await pause(window, 1200);
  window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  assert.deepEqual(tags(window), [TAG_URL]);
});

for (const param of ["gclid", "gbraid", "wbraid"]) {
  later(`on www an ad click landing with ${param} adds the Google tag at once, so the click is kept before the visitor moves on`, async () => {
    const window = boot(`https://www.nycluxride.com/locations/manhattan?utm_source=google&${param}=TEST123`);
    assert.deepEqual(tags(window), [TAG_URL]);
    await loaded(window);
    await pause(window, 1200);
    assert.deepEqual(tags(window), [TAG_URL]);
  });
}

later("on www the call conversion callback of the later Google tag still swaps the site number in links and text", async () => {
  const window = boot("https://www.nycluxride.com/", '<a id="call" href="tel:+16467750556"><span>+1 (646) 775-0556</span></a>');
  window.eval(TRACKING);
  await loaded(window);
  await pause(window, 1200);
  assert.deepEqual(tags(window), [TAG_URL]);
  configs(window)[1][2].phone_conversion_callback("+1 (800) 555-1212", "+18005551212");
  const a = window.document.getElementById("call");
  assert.equal(a.getAttribute("href"), "tel:+18005551212");
  assert.equal(a.textContent, "+1 (800) 555-1212");
});

test("on www gtag.js configures the account and the call conversion for the site number", () => {
  const window = boot("https://www.nycluxride.com/rates");
  assert.deepEqual(configs(window).map((a) => a[1]), [ADS_ID, `${ADS_ID}/s5hCCPecteMcEIX4gOJD`]);
  assert.equal(configs(window)[1][2].phone_conversion_number, "+16467750556");
});

for (const url of ["http://127.0.0.1:4173/", "https://nycluxride-git-main.vercel.app/", "https://nycluxride.com/"]) {
  later(`on ${new URL(url).host} gtag.js keeps the id and the stub but loads and configures nothing, before or after the load and a pointerdown`, async () => {
    const window = boot(url);
    assert.equal(window.NLR_ADS_ID, ADS_ID);
    assert.equal(typeof window.nlrGtag, "function");
    assert.equal(window.document.querySelectorAll("script[src]").length, 0);
    assert.deepEqual(configs(window), []);
    await loaded(window);
    await pause(window, 1200);
    window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    assert.equal(window.document.querySelectorAll("script[src]").length, 0);
    assert.deepEqual(configs(window), []);
  });
}

test("on www the Vercel bypass parameters leave the address before the tag reads it", () => {
  const window = boot("https://www.nycluxride.com/book?utm_source=test&x-vercel-protection-bypass=SECRET123&x-vercel-set-bypass-cookie=true&gclid=TESTGCLID");
  assert.equal(window.location.href, "https://www.nycluxride.com/book?utm_source=test&gclid=TESTGCLID");
});

for (const [name, result] of pending) {
  const err = await result;
  if (!err) {
    console.log(`  ok   ${name}`);
    continue;
  }
  failures++;
  console.error(`  FAIL ${name}\n       ${err.message}`);
}

if (failures) {
  console.error(`\n${failures} gtag test(s) failed`);
  process.exit(1);
}
console.log("\nAll gtag tests passed");
process.exit(0);
