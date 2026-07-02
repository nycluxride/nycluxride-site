/*
 * NYC LUX RIDE — inject the static top utility bar + floating contact stack into
 * every committed page (the built HTML is the source of record; nothing rebuilds it).
 *
 * For each *.html page this script, idempotently:
 *   1. links /assets/nlr-contact.css in <head>;
 *   2. inserts #nlr-topbar (phone + email) and #nlr-fab-stack (WhatsApp + Call) as
 *      direct <body> children, BEFORE #root, so React hydration never removes them.
 *
 * It deliberately does NOT edit anything inside #root. The nav "Call" block is
 * hidden via CSS (assets/nlr-contact.css) instead of deleted, and the footer is
 * left untouched — both render inside the React-hydrated #root, so a static edit
 * there would be reverted at runtime and would cause a hydration mismatch.
 *
 * Run from the repo root:  node scripts/inject-contact-ui.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CSS_LINK = '<link rel="stylesheet" href="/assets/nlr-contact.css">';

// Inline SVGs (no icon dependency). WhatsApp glyph reuses the site's proven 0 0 32 32 path.
const ICON_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>';
const ICON_WA = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 4C9.96 4 5 8.95 5 15.02c0 2.65.86 5.1 2.32 7.12L5.5 28l6.06-1.78a11.1 11.1 0 0 0 4.47.94h.01c6.08 0 11.03-4.95 11.03-11.02C27.08 8.95 22.12 4 16.04 4zm0 20.1h-.01a9.2 9.2 0 0 1-4.68-1.28l-.34-.2-3.6 1.06 1.08-3.5-.22-.36a9.06 9.06 0 0 1-1.4-4.86c0-5.02 4.1-9.1 9.16-9.1 2.45 0 4.75.95 6.48 2.68a9.06 9.06 0 0 1 2.68 6.43c0 5.02-4.1 9.1-9.15 9.1zm5.02-6.82c-.27-.14-1.63-.8-1.88-.9-.25-.09-.43-.13-.62.14-.18.27-.71.9-.87 1.08-.16.18-.32.2-.59.07-.27-.14-1.16-.43-2.2-1.36-.81-.72-1.36-1.62-1.52-1.89-.16-.27-.02-.42.12-.55.12-.12.27-.32.4-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.05-.22-.53-.45-.46-.62-.47l-.53-.01c-.18 0-.48.07-.73.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.12 2.85.14.18 1.94 2.96 4.7 4.15.66.28 1.17.45 1.57.58.66.21 1.26.18 1.74.11.53-.08 1.63-.67 1.86-1.31.23-.64.23-1.19.16-1.31-.07-.12-.25-.18-.52-.32z"/></svg>';

const WA_URL = 'https://wa.me/16467750556?text=Hi%20NYC%20Lux%20Ride%2C%20I%27d%20like%20to%20book%20a%20ride';

const FRAGMENT =
  '<div id="nlr-topbar" role="region" aria-label="Contact bar">' +
    '<div class="nlr-topbar-inner">' +
      '<a class="nlr-tb-link nlr-tb-phone" href="tel:+16467750556" aria-label="Call NYC LUX RIDE">' +
        ICON_PHONE + '<span>+1 (646) 775-0556</span>' +
      '</a>' +
      '<a class="nlr-tb-link nlr-tb-email" href="mailto:info@nycluxride.com" aria-label="Email NYC LUX RIDE">' +
        ICON_MAIL + '<span class="nlr-tb-email-text">info@nycluxride.com</span>' +
      '</a>' +
    '</div>' +
  '</div>' +
  '<div id="nlr-fab-stack" role="region" aria-label="Quick contact">' +
    '<a class="nlr-fab nlr-fab-wa" href="' + WA_URL + '" target="_blank" rel="noopener" aria-label="Message NYC LUX RIDE on WhatsApp">' + ICON_WA + '</a>' +
    '<a class="nlr-fab nlr-fab-call" href="tel:+16467750556" aria-label="Call NYC LUX RIDE">' + ICON_PHONE + '</a>' +
  '</div>';

const BODY_OPEN = '<body class="bg-black text-white">';

function collectHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'scripts') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

let changed = 0;
const report = [];
for (const file of collectHtml(ROOT)) {
  let html = readFileSync(file, 'utf8');
  const before = html;
  const notes = [];

  if (!html.includes('/assets/nlr-contact.css') && html.includes('</head>')) {
    html = html.replace('</head>', '  ' + CSS_LINK + '\n</head>');
    notes.push('css');
  }
  if (!html.includes('id="nlr-topbar"') && html.includes(BODY_OPEN)) {
    html = html.replace(BODY_OPEN, BODY_OPEN + FRAGMENT);
    notes.push('fragment');
  }

  if (html !== before) {
    writeFileSync(file, html);
    changed++;
    report.push(file.replace(ROOT, '.') + '  [' + notes.join(', ') + ']');
  }
}

console.log('Pages updated: ' + changed);
for (const line of report) console.log('  ' + line);
