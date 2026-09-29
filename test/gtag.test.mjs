import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const SRC = readFileSync(fileURLToPath(new URL("../assets/gtag.js", import.meta.url)), "utf8");
const ADS_ID = "AW-18190711813";
const TAG_URL = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}&l=nlrDataLayer`;

function boot(url) {
  const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url, runScripts: "outside-only" });
  window.eval(SRC);
  return window;
}

const configs = (window) => [...window.nlrDataLayer].filter((a) => a[0] === "config");

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

test("gtag.js carries no comments", () => {
  assert.doesNotMatch(SRC, /\/\*|(^|[^:"'])\/\//m);
});

test("on www gtag.js loads the Google tag for the Ads id on nlrDataLayer", () => {
  const window = boot("https://www.nycluxride.com/");
  assert.equal(window.NLR_ADS_ID, ADS_ID);
  assert.deepEqual([...window.document.querySelectorAll("script[src]")].map((s) => s.src), [TAG_URL]);
});

test("on www gtag.js configures the account and the call conversion for the site number", () => {
  const window = boot("https://www.nycluxride.com/rates");
  assert.deepEqual(configs(window).map((a) => a[1]), [ADS_ID, `${ADS_ID}/s5hCCPecteMcEIX4gOJD`]);
  assert.equal(configs(window)[1][2].phone_conversion_number, "+16467750556");
});

for (const url of ["http://127.0.0.1:4173/", "https://nycluxride-git-main.vercel.app/", "https://nycluxride.com/"]) {
  test(`on ${new URL(url).host} gtag.js keeps the id and the stub but loads and configures nothing`, () => {
    const window = boot(url);
    assert.equal(window.NLR_ADS_ID, ADS_ID);
    assert.equal(typeof window.nlrGtag, "function");
    assert.equal(window.document.querySelectorAll("script[src]").length, 0);
    assert.deepEqual(configs(window), []);
  });
}

test("on www the Vercel bypass parameters leave the address before the tag reads it", () => {
  const window = boot("https://www.nycluxride.com/book?utm_source=test&x-vercel-protection-bypass=SECRET123&x-vercel-set-bypass-cookie=true&gclid=TESTGCLID");
  assert.equal(window.location.href, "https://www.nycluxride.com/book?utm_source=test&gclid=TESTGCLID");
});

if (failures) {
  console.error(`\n${failures} gtag test(s) failed`);
  process.exit(1);
}
console.log("\nAll gtag tests passed");
process.exit(0);
