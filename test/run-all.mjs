import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, loadavg } from "node:os";

const STATIC = [
  "asset-hashes",
  "vercel-config",
  "no-secrets",
  "no-moovs",
  "swap-resilience",
  "pay-rates",
  "book-pricing",
  "book-params",
  "phone",
  "book-page",
  "tracking",
  "gtag",
  "rates-single-source",
  "chrome-consistency",
  "inner-pages",
  "seo",
  "airport-total",
  "places",
  "route-flight",
  "booking-component",
  "content-copy",
  "tokens",
  "seo-baseline",
  "pages-core",
  "pages-content",
  "twins",
  "policy-single-source",
  "prose-shape",
  "landing",
];
const BROWSER = ["redesign-browser", "book-browser", "parity-browser", "lcp-budget", "motion-browser", "banners-browser", "pages-core-browser", "hero-browser", "landing-browser", "panel-browser"];

const files = process.argv.includes("--static") ? STATIC : [...STATIC, ...BROWSER];
const failed = [];
for (const f of files) {
  console.log(`\n== ${f}`);
  if (BROWSER.includes(f) && loadavg()[0] >= cpus().length) {
    console.log(`  ..   load ${loadavg()[0].toFixed(0)} on ${cpus().length} cores, waiting up to 4 minutes for it to drop before the browser checks`);
    for (const end = Date.now() + 240000; loadavg()[0] >= cpus().length && Date.now() < end; ) await new Promise((r) => setTimeout(r, 5000));
  }
  const { status } = spawnSync(process.execPath, [`${f}.test.mjs`], { cwd: dirname(fileURLToPath(import.meta.url)), stdio: "inherit" });
  if (status !== 0) failed.push(f);
}

if (failed.length) {
  console.error(`\n${failed.length} of ${files.length} test files failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test files passed`);
