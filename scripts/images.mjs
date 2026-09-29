#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET = join(ROOT, 'fleet');
const CROP_DIR = join(FLEET, 'crop');
const MANIFEST = join(FLEET, 'MANIFEST.json');
const TWIN_FILE = join(FLEET, 'twins.json');
const WIDTHS = [300, 400, 600, 900, 1100, 1400];
const EXTRA_WIDTHS = { 'cadillac-escalade-hero': [1620] };
const LEAD_WIDTHS = [1800, 2400];
const CROPS = {
  'cadillac-escalade-hero': { name: '125', geometry: '1500x851+90+120', width: 1500, height: 1200, fadeFrom: 700, fadeRows: 160, background: '#08090C', widths: [600, 900, 1200, 1500] }
};
const FORCE = process.argv.includes('--force');
const PRUNE = process.argv.includes('--prune');

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

function buildCrop(masterPath, c, png) {
  const base = `${png}.base.png`;
  const ramp = `${png}.ramp.png`;
  const alpha = `${png}.alpha.png`;
  sh('magick', [masterPath, '-crop', c.geometry, '+repage', '-background', c.background, '-gravity', 'north', '-extent', `${c.width}x${c.height}`, base]);
  sh('magick', ['-size', `1x${c.fadeRows}`, 'gradient:white-black', '-sigmoidal-contrast', '4x50%', '-scale', `${c.width}x${c.fadeRows}!`, ramp]);
  sh('magick', ['(', '-size', `${c.width}x${c.fadeFrom}`, 'xc:white', ')', ramp, '(', '-size', `${c.width}x${c.height - c.fadeFrom - c.fadeRows}`, 'xc:black', ')', '-append', alpha]);
  sh('magick', ['(', '-size', `${c.width}x${c.height}`, `xc:${c.background}`, ')', '(', base, alpha, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', ')', '-compose', 'Over', '-composite', '-strip', png]);
  for (const f of [base, ramp, alpha]) rmSync(f, { force: true });
}

const htmlPages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['fleet', 'assets', 'api', 'test', 'scripts', 'node_modules'].includes(e.name) || e.name.startsWith('.') ? [] : htmlPages(join(dir, e.name))) : e.name.endsWith('.html') ? [join(dir, e.name)] : []));
const LEADS = new Set();
const BANNERS = new Set();
for (const page of htmlPages(ROOT)) {
  const html = readFileSync(page, 'utf8');
  const figures = [...html.matchAll(/<figure class="(?:hero__photo|banner__photo)">[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  if (relative(ROOT, page).startsWith('blog/')) figures.push((html.slice(html.indexOf('<main')).match(/<figure[\s\S]*?<\/figure>/) || [''])[0]);
  for (const f of figures) for (const m of f.matchAll(/\/fleet\/([a-z0-9-]+?)-\d+\.(?:avif|webp)/g)) {
    LEADS.add(m[1]);
    if (f.startsWith('<figure class="banner__photo">')) BANNERS.add(m[1]);
  }
}
const webps = readdirSync(FLEET).filter((f) => f.endsWith('.webp'));
const isDerivative = (f) => {
  const m = /^(.+)-(\d+)\.webp$/.exec(f);
  if (!m || !webps.includes(`${m[1]}.webp`)) return false;
  const n = Number(m[2]);
  return WIDTHS.includes(n) || LEAD_WIDTHS.includes(n) || (EXTRA_WIDTHS[m[1]] || []).includes(n) || n === probe(join(FLEET, `${m[1]}.webp`)).width;
};
const masters = webps.filter((f) => !isDerivative(f)).sort();

if (masters.length === 0) {
  console.error('no masters found in fleet/');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'nlr-images-'));
const rows = [];
const images = [];
const twins = {};
let twinsBuilt = 0;
let built = 0;
let skipped = 0;

function encode(source, width, out, masterMtime, label, extra = [], webp = true) {
  const avifOut = `${out}.avif`;
  const webpOut = `${out}.webp`;
  const needAvif = !isFresh(avifOut, masterMtime);
  const needWebp = webp && !isFresh(webpOut, masterMtime);

  if (needAvif || needWebp) {
    const png = join(tmp, `${basename(out)}.png`);
    sh('magick', [source(), '-filter', RESIZE_FILTER, '-resize', `${width}x`, '-strip', ...extra, png]);
    if (needAvif) sh('avifenc', [...AVIF_ARGS, png, avifOut]);
    if (needWebp) sh('cwebp', [...WEBP_ARGS, png, '-o', webpOut]);
    rmSync(png, { force: true });
    built += (needAvif ? 1 : 0) + (needWebp ? 1 : 0);
  }
  skipped += (needAvif ? 0 : 1) + (webp && !needWebp ? 1 : 0);

  const a = probe(avifOut);
  const w = webp && probe(webpOut);
  const state = needAvif || needWebp ? 'built' : 'cached';
  rows.push([label, width, fmtBytes(a.bytes), w ? fmtBytes(w.bytes) : '-', state]);
  const variants = [{ path: relative(ROOT, avifOut), url: `/${relative(ROOT, avifOut)}`, format: 'avif', width: a.width, height: a.height, bytes: a.bytes }];
  if (w) variants.push({ path: relative(ROOT, webpOut), url: `/${relative(ROOT, webpOut)}`, format: 'webp', width: w.width, height: w.height, bytes: w.bytes });
  return variants;
}

const srcset = (variants, fmt) =>
  variants
    .filter((v) => v.format === fmt)
    .sort((x, y) => x.width - y.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');

try {
  for (const file of masters) {
    const slug = basename(file, '.webp');
    const masterPath = join(FLEET, file);
    const masterStat = statSync(masterPath);
    const master = probe(masterPath);

    const widths = WIDTHS.filter((w) => w < master.width);
    if (widths.length < WIDTHS.length) widths.push(master.width);
    if (LEADS.has(slug)) widths.push(...LEAD_WIDTHS.filter((w) => w <= master.width && !widths.includes(w)));
    if (BANNERS.has(slug) && !widths.includes(master.width)) widths.push(master.width);
    const extraWidths = (EXTRA_WIDTHS[slug] || []).filter((w) => !widths.includes(w));
    widths.push(...extraWidths);
    const variants = widths.flatMap((width) => encode(() => masterPath, width, join(FLEET, `${slug}-${width}`), masterStat.mtimeMs, slug, [], !extraWidths.includes(width)));

    const image = {
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
      srcset: { avif: srcset(variants, 'avif'), webp: srcset(variants, 'webp') }
    };

    const crop = CROPS[slug];
    if (crop) {
      const png = join(tmp, `${slug}-${crop.name}.png`);
      const source = () => {
        if (!existsSync(png)) buildCrop(masterPath, crop, png);
        return png;
      };
      mkdirSync(CROP_DIR, { recursive: true });
      const cropped = crop.widths.flatMap((width) => encode(source, width, join(CROP_DIR, `${slug}-${crop.name}-${width}`), masterStat.mtimeMs, `${slug} crop ${crop.name}`, ['-depth', '8']));
      image.crops = [{ ...crop, variants: cropped, srcset: { avif: srcset(cropped, 'avif'), webp: srcset(cropped, 'webp') } }];
    }
    images.push(image);
  }
  const oldTwins = existsSync(TWIN_FILE) ? JSON.parse(readFileSync(TWIN_FILE, 'utf8')) : {};
  for (const file of masters) {
    const masterPath = join(FLEET, file);
    const sha256 = createHash('sha256').update(readFileSync(masterPath)).digest('hex');
    const prev = oldTwins[file];
    if (!FORCE && prev && prev.sha256 === sha256) {
      twins[file] = prev;
      continue;
    }
    const png = join(tmp, `${basename(file, '.webp')}-twin.png`);
    const out = join(tmp, `${basename(file, '.webp')}-twin.webp`);
    sh('magick', [masterPath, '-resize', '64x', '-blur', '0x2.5', '-strip', png]);
    sh('cwebp', ['-q', '50', '-quiet', png, '-o', out]);
    const t = probe(out);
    twins[file] = { sha256, width: t.width, height: t.height, src: `data:image/webp;base64,${readFileSync(out).toString('base64')}` };
    twinsBuilt++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const variantBytes = images.reduce((s, i) => s + i.variants.reduce((t, v) => t + v.bytes, 0), 0);
const variantCount = images.reduce((s, i) => s + i.variants.length, 0);
const masterBytes = images.reduce((s, i) => s + i.master.bytes, 0);
const cropVariants = images.flatMap((i) => (i.crops || []).flatMap((c) => c.variants));
const cropBytes = cropVariants.reduce((s, v) => s + v.bytes, 0);

const known = new Set(images.flatMap((i) => [i.master, ...i.variants, ...(i.crops || []).flatMap((c) => c.variants)]).map((v) => v.path));
const unused = [FLEET, CROP_DIR]
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).filter((f) => /\.(avif|webp)$/.test(f)).map((f) => relative(ROOT, join(dir, f))))
  .filter((path) => !known.has(path))
  .sort();
if (PRUNE) for (const path of unused) rmSync(join(ROOT, path));

const manifest = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/images.mjs',
  targetWidths: WIDTHS,
  leadWidths: { widths: LEAD_WIDTHS, masters: [...LEADS].sort() },
  extraWidths: EXTRA_WIDTHS,
  encoders: ENCODERS,
  totals: { masters: images.length, masterBytes, variantCount, variantBytes, cropCount: cropVariants.length, cropBytes },
  images
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(TWIN_FILE, JSON.stringify(twins, null, 2) + '\n');

const head = ['master', 'w', 'avif', 'webp', 'state'];
const widthsCol = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const line = (r) => r.map((c, i) => pad(c, widthsCol[i], i === 1 || i === 2 || i === 3)).join('  ');
console.log(line(head));
console.log(widthsCol.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));
console.log('');
console.log(`masters      ${images.length}  (${fmtBytes(masterBytes)})`);
console.log(`variants     ${variantCount}  (${fmtBytes(variantBytes)})`);
console.log(`crops        ${cropVariants.length}  (${fmtBytes(cropBytes)})`);
console.log(`encoded      ${built}`);
console.log(`up to date   ${skipped}`);
console.log(`twins        ${Object.keys(twins).length}  (${twinsBuilt} built)`);
console.log(`manifest     ${relative(ROOT, MANIFEST)}`);
for (const path of unused) console.log(`${pad(PRUNE ? 'deleted' : 'unused', 13)}${path}`);
if (unused.length && !PRUNE) console.log('             run with --prune to delete the unused images');
