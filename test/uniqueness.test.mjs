import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { measureSite, familyOf, htmlFiles, EXISTING, MIN_UNIQUE_WORDS, MAX_SHARED, N } from "./uniqueness-lib.mjs";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");

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

const files = htmlFiles(ROOT);
check("every page made after the 2026-11 plan belongs to a family, so it is measured", () => {
  const loose = files.filter((f) => !EXISTING.has(f) && !familyOf(f));
  assert.deepEqual(loose, []);
});

const results = measureSite(ROOT);
for (const r of results) {
  check(`${r.file}: at least ${MIN_UNIQUE_WORDS} words of body text no ${r.family} page shares (${r.unique} of ${r.words})`, () => {
    assert.ok(r.unique >= MIN_UNIQUE_WORDS, `${r.unique} unique words`);
  });
  check(`${r.file}: at most ${MAX_SHARED * 100}% of its ${N}-word phrases on any one ${r.family} page${r.shared[0] ? ` (most: ${(r.shared[0][1] * 100).toFixed(1)}% with ${r.shared[0][0]})` : ""}`, () => {
    const over = r.shared.filter(([, s]) => s > MAX_SHARED).map(([f, s]) => `${f} ${(s * 100).toFixed(1)}%`);
    assert.deepEqual(over, []);
  });
}

const plain = new Map(results.map((r) => [r.file, r.words]));
const listed = measureSite(ROOT, null, true).filter((r) => r.words < plain.get(r.file));
check("the county pages are measured again without their list of town names", () => assert.equal(listed.filter((r) => /-county-nj\.html$/.test(r.file)).length, 21));
for (const r of listed) {
  check(`${r.file}: at least ${MIN_UNIQUE_WORDS} words of body text no ${r.family} page shares, without the list of town names (${r.unique} of ${r.words})`, () => {
    assert.ok(r.unique >= MIN_UNIQUE_WORDS, `${r.unique} unique words`);
  });
}

if (failures) {
  console.error(`\n${failures} uniqueness assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll uniqueness tests passed");
process.exit(0);
