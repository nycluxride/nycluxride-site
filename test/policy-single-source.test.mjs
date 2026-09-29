import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const { POLICY, NOTES, CHECKOUT } = await import(pathToFileURL(join(ROOT, "api", "_copy.mjs")).href);
const FULL = ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html"];
const nt = (s) => s.replace(/\s+/g, " ").trim();
const doc = (f) => new JSDOM(readFileSync(join(ROOT, f), "utf8")).window.document;
const jsonld = (d) => [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));

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

check("POLICY.cancel is today's cancellation sentence, with its phone number and WhatsApp, and no dash or semicolon", () => {
  assert.equal(POLICY.cancel, "Cancellation terms are confirmed in writing with the reservation. To change or cancel, call +1 (646) 775-0556 or message on WhatsApp with your reference, and give as much notice as you can.");
  for (const s of [POLICY.cancel, POLICY.later.airport, POLICY.later.hourly, NOTES.included]) assert.doesNotMatch(s, /[–—;]/);
});

check("rates.html shows POLICY.cancel word for word in #cancellation", () => {
  const d = doc("rates.html");
  assert.ok(d.getElementById("cancellation"), "no #cancellation");
  assert.ok([...d.querySelectorAll("#cancellation p")].some((p) => nt(p.textContent) === POLICY.cancel || nt(p.textContent).includes(POLICY.cancel)));
});

check("faq.html shows POLICY.cancel in a visible answer and in its FAQPage JSON-LD", () => {
  const d = doc("faq.html");
  assert.ok([...d.querySelectorAll("main details")].some((x) => nt(x.textContent).includes(POLICY.cancel)), "no visible answer");
  const faq = jsonld(d).flatMap((o) => (Array.isArray(o["@graph"]) ? o["@graph"] : [o])).find((o) => o["@type"] === "FAQPage");
  assert.ok(faq && faq.mainEntity.some((q) => nt(q.acceptedAnswer.text).includes(POLICY.cancel)), "no FAQPage answer");
});

for (const f of ["card-authorization.html", "terms-of-service.html", "booking-confirmed.html"]) {
  check(`${f} shows POLICY.cancel word for word`, () => assert.ok(nt(doc(f).querySelector("main").textContent).includes(POLICY.cancel)));
}

check("schedule.html carries POLICY.cancel as the value of its Cancellation fact", () => {
  const d = doc("schedule.html");
  const dt = [...d.querySelectorAll("main dl.facts dt")].find((x) => nt(x.textContent) === "Cancellation");
  assert.ok(dt, "no Cancellation fact");
  assert.equal(nt(dt.nextElementSibling.textContent), POLICY.cancel);
});

const FLOW = "Cancellation terms are confirmed in writing with the reservation. To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference, and give as much notice as you can.";
check("the booking flow's cancellation sentence is POLICY.cancel with email in place of the call", () => assert.equal(FLOW.replace("email info@nycluxride.com or message us on WhatsApp", "call +1 (646) 775-0556 or message on WhatsApp"), POLICY.cancel));

for (const f of FULL) {
  check(`${f}: #bk-next3 ends with the booking flow's cancellation sentence, #bk-policy holds the first sentence of POLICY.cancel, and the form names no phone number`, () => {
    const d = doc(f);
    const last = d.getElementById("bk-next3").lastElementChild;
    assert.deepEqual([nt(last.querySelector("b").textContent), nt(last.querySelector("span").textContent)], ["If plans change", FLOW]);
    assert.ok(nt(d.getElementById("bk-policy").textContent).startsWith(POLICY.cancel.slice(0, POLICY.cancel.indexOf(".") + 1) + " "));
    assert.doesNotMatch(nt(d.getElementById("book-form").textContent), /775-0556|\bcall\b/i);
  });
}

check("booking-confirmed.html: #cf-policy is POLICY.cancel and nothing more", () => assert.equal(nt(doc("booking-confirmed.html").getElementById("cf-policy").textContent), POLICY.cancel));

check("the price notes are built from POLICY and NOTES.included", () => {
  assert.equal(NOTES.airport, NOTES.included + " " + POLICY.later.airport);
  assert.equal(NOTES.hourly, POLICY.later.hourly);
  assert.equal(NOTES.included, "Tolls, airport fees, NYC sales tax and the Black Car Fund are included.");
});

check("CHECKOUT.afterSubmit tells the rider how to change or cancel by email or WhatsApp, with no call", () => {
  assert.ok(CHECKOUT.afterSubmit.includes("To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference {ref}."));
  assert.doesNotMatch(CHECKOUT.afterSubmit, /775-0556|\bcall\b/i);
});

if (failures) {
  console.error(`\n${failures} policy single-source assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll policy single-source tests passed");
process.exit(0);
