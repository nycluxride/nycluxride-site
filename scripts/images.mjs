#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET = join(ROOT, 'fleet');
const MANIFEST = join(FLEET, 'MANIFEST.json');
const WIDTHS = [300, 400, 600, 900, 1100, 1400];
const FORCE = process.argv.includes('--force');

const AVIF_ARGS = ['-j', 'all', '-q', '58', '-s', '4', '-y', '444', '-d', '10'];
const WEBP_ARGS = ['-q', '80', '-m', '6', '-sharp_yuv', '-af', '-pass', '10', '-quiet'];
const RESIZE_FILTER = 'Lanczos';

const ENCODERS = {
  resize: `magick {master} -filter ${RESIZE_FILTER} -resize {width}x -strip {tmp.png}`,
  avif: `avifenc ${AVIF_ARGS.join(' ')} {tmp.png} {out.avif}`,
  webp: `cwebp ${WEBP_ARGS.join(' ')} {tmp.png} -o {out.webp}`
};

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function probe(file) {
  const out = sh('magick', ['identify', '-format', '%w %h', `${file}[0]`]).trim().split(/\s+/);
  return { width: Number(out[0]), height: Number(out[1]), bytes: statSync(file).size };
}

function isFresh(target, masterMtime) {
  if (FORCE || !existsSync(target)) return false;
  return statSync(target).mtimeMs >= masterMtime;
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(2)}M`;
}

function pad(s, w, right = false) {
  s = String(s);
  return right ? s.padStart(w) : s.padEnd(w);
}

const derivative = /-\d+\.webp$/;
const masters = readdirSync(FLEET)
  .filter((f) => f.endsWith('.webp') && !derivative.test(f))
  .sort();

if (masters.length === 0) {
  console.error('no masters found in fleet/');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'nlr-images-'));
const rows = [];
const images = [];
let built = 0;
let skipped = 0;

try {
  for (const file of masters) {
    const slug = basename(file, '.webp');
    const masterPath = join(FLEET, file);
    const masterStat = statSync(masterPath);
    const master = probe(masterPath);
    const variants = [];

    const widths = WIDTHS.filter((w) => w < master.width);
    if (widths.length < WIDTHS.length) widths.push(master.width);

    for (const width of widths) {
      const avifOut = join(FLEET, `${slug}-${width}.avif`);
      const webpOut = join(FLEET, `${slug}-${width}.webp`);
      const needAvif = !isFresh(avifOut, masterStat.mtimeMs);
      const needWebp = !isFresh(webpOut, masterStat.mtimeMs);

      if (needAvif || needWebp) {
        const png = join(tmp, `${slug}-${width}.png`);
        sh('magick', [masterPath, '-filter', RESIZE_FILTER, '-resize', `${width}x`, '-strip', png]);
        if (needAvif) sh('avifenc', [...AVIF_ARGS, png, avifOut]);
        if (needWebp) sh('cwebp', [...WEBP_ARGS, png, '-o', webpOut]);
        rmSync(png, { force: true });
        built += (needAvif ? 1 : 0) + (needWebp ? 1 : 0);
      }
      skipped += (needAvif ? 0 : 1) + (needWebp ? 0 : 1);

      const a = probe(avifOut);
      const w = probe(webpOut);
      variants.push({
        path: relative(ROOT, avifOut),
        url: `/${relative(ROOT, avifOut)}`,
        format: 'avif',
        width: a.width,
        height: a.height,
        bytes: a.bytes
      });
      variants.push({
        path: relative(ROOT, webpOut),
        url: `/${relative(ROOT, webpOut)}`,
        format: 'webp',
        width: w.width,
        height: w.height,
        bytes: w.bytes
      });
      const state = needAvif || needWebp ? 'built' : 'cached';
      rows.push([slug, width, fmtBytes(a.bytes), fmtBytes(w.bytes), state]);
    }

    const srcset = (fmt) =>
      variants
        .filter((v) => v.format === fmt)
        .sort((x, y) => x.width - y.width)
        .map((v) => `${v.url} ${v.width}w`)
        .join(', ');

    images.push({
      slug,
      master: {
        path: relative(ROOT, masterPath),
        url: `/${relative(ROOT, masterPath)}`,
        width: master.width,
        height: master.height,
        bytes: master.bytes,
        aspectRatio: Number((master.width / master.height).toFixed(4))
      },
      variants,
      srcset: { avif: srcset('avif'), webp: srcset('webp') }
    });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const variantBytes = images.reduce((s, i) => s + i.variants.reduce((t, v) => t + v.bytes, 0), 0);
const variantCount = images.reduce((s, i) => s + i.variants.length, 0);
const masterBytes = images.reduce((s, i) => s + i.master.bytes, 0);

const manifest = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/images.mjs',
  targetWidths: WIDTHS,
  encoders: ENCODERS,
  totals: { masters: images.length, masterBytes, variantCount, variantBytes },
  images
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const head = ['master', 'w', 'avif', 'webp', 'state'];
const widthsCol = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const line = (r) => r.map((c, i) => pad(c, widthsCol[i], i === 1 || i === 2 || i === 3)).join('  ');
console.log(line(head));
console.log(widthsCol.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));
console.log('');
console.log(`masters      ${images.length}  (${fmtBytes(masterBytes)})`);
console.log(`variants     ${variantCount}  (${fmtBytes(variantBytes)})`);
console.log(`encoded      ${built}`);
console.log(`up to date   ${skipped}`);
console.log(`manifest     ${relative(ROOT, MANIFEST)}`);
