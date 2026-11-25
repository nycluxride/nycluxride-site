import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CHILD_SEAT_CENTS } from "../api/_rates.mjs";
import { readInput, readSettings, resolveTrip, priceTrip } from "../api/_trip.mjs";
import { POST } from "../api/book.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const load = (file) => new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document;
const squash = (node) => node.textContent.replace(/\s+/g, " ").trim();

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 14).join("\n       ")}`);
  }
}

globalThis.fetch = async (url) => {
  throw new Error(`no network in this test: ${url}`);
};

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 3 * 86400000));
const RIDE = { trip_type: "one", from_text: "350 5th Ave, New York, NY 10118", to_text: "John F. Kennedy (JFK)", to_id: "jfk", date: day, time: "10:00", passengers: "3", class: "suv" };
const LOCAL = "http://127.0.0.1:4173";
const options = async (fields, nonce) => {
  const res = await POST(new Request(`${LOCAL}/api/book`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: LOCAL }, body: JSON.stringify({ ...fields, action: "options", nonce }) }));
  assert.equal(res.status, 200);
  return res.json();
};
const priced = async (fields) => priceTrip(await resolveTrip(readInput(fields), { now: new Date() }), readSettings({}));

function offersNamed(node, name, out = []) {
  if (Array.isArray(node)) node.forEach((n) => offersNamed(n, name, out));
  else if (node && typeof node === "object") {
    if (node["@type"] === "Offer" && node.name === name) out.push(node);
    Object.values(node).forEach((n) => offersNamed(n, name, out));
  }
  return out;
}

await test("the seat price is $20 in the rates: CHILD_SEAT_CENTS is 2000 in api/_rates.mjs", () => {
  assert.equal(CHILD_SEAT_CENTS, 2000);
});

await test("the rates page lists child seats at $20 per seat in the add-ons and in the Child seat offer", () => {
  const page = load("rates.html");
  const dt = [...page.querySelectorAll("#add-ons dl.facts dt")].find((x) => squash(x) === "Child seats");
  assert.ok(dt, "a Child seats add-on");
  assert.match(squash(dt.nextElementSibling), /\$20 per seat/);
  assert.doesNotMatch(page.documentElement.outerHTML, /\$15 per seat/);
  const offers = [...page.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => offersNamed(JSON.parse(s.textContent), "Child seat"));
  assert.deepEqual(offers.map((o) => [o.price, o.priceSpecification.price]), [["20", "20"]]);
});

await test("the car seat page says $20 per seat in its title and description", () => {
  const page = load("car-service-with-car-seat-nyc.html");
  assert.match(page.title, /\$20 per seat/);
  assert.match(page.querySelector('meta[name="description"]').getAttribute("content"), /\$20 per seat/);
});

await test("the booking extras get $20 per seat: the options answer sends seat_cents 2000 and the seat line of two seats is 2 x $20.00", async () => {
  const none = await options(RIDE, "nonce-seat-price-0000001");
  const two = await options({ ...RIDE, infant_seats: "1", booster_seats: "1" }, "nonce-seat-price-0000002");
  assert.equal(two.seat_cents, 2000);
  assert.deepEqual(two.price.lines.at(-1), { label: "Child seats (2 x $20.00)", cents: 4000 });
  assert.equal(two.price.total_cents - none.price.total_cents, 4000);
});

await test("a priced quote with one seat adds a Child seats (1 x $20.00) line of $20 to the total", async () => {
  const none = await priced(RIDE);
  const one = await priced({ ...RIDE, infant_seats: "1" });
  assert.deepEqual([one.seats, one.total - none.total], [2000, 2000]);
  assert.deepEqual(one.lines.at(-1), { label: "Child seats (1 x $20.00)", cents: 2000 });
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll seat-price tests passed");
process.exit(0);
