import assert from "node:assert/strict";
import handler, { authorized, letter, LINES, SUBJECT, TO } from "../api/owner-questions.mjs";

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
};
const SECRET = "s".repeat(40);
const reply = () => {
  const r = { code: 0, status(c) { r.code = c; return r; }, end() { return r; } };
  return r;
};

await test("only Vercel cron's bearer CRON_SECRET passes, fail closed when the secret is unset, short or wrong", () => {
  assert.equal(authorized(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(authorized(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(authorized("", SECRET), false);
  assert.equal(authorized(undefined, SECRET), false);
  assert.equal(authorized(`Bearer ${SECRET}`, undefined), false);
  assert.equal(authorized("Bearer short", "short"), false);
});

await test("the handler answers 405 to anything but GET and 401 without the secret, before any mail work", async () => {
  process.env.CRON_SECRET = SECRET;
  const post = reply();
  await handler({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }, post);
  assert.equal(post.code, 405);
  const none = reply();
  await handler({ method: "GET", headers: {} }, none);
  assert.equal(none.code, 401);
  delete process.env.CRON_SECRET;
  const unset = reply();
  await handler({ method: "GET", headers: { authorization: `Bearer ${SECRET}` } }, unset);
  assert.equal(unset.code, 401);
});

await test("the letter goes only to info@nycluxride.com with the twelve questions and no dashes or semicolons", () => {
  const m = letter({ name: "NYC LUX RIDE", address: "bookings@nycluxride.com" });
  assert.deepEqual(m.to, [TO]);
  assert.equal(TO, "info@nycluxride.com");
  assert.equal(SUBJECT, "A few quick questions for the new website pages");
  assert.equal(LINES.filter((l) => /^\d+\. /.test(l)).length, 12);
  for (const l of LINES) assert.doesNotMatch(l, /[–—;]/, l);
  assert.match(m.data, /To: info@nycluxride\.com/);
});

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("All owner question tests passed");
