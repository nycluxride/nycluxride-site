#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'assets', readdirSync(join(ROOT, 'assets')).find((n) => /^lux\..+\.css$/.test(n))), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'fleet/MANIFEST.json'), 'utf8'));
const STOPS = 4;
const WIDTH = 400;
const KNEE = 0.08;
const FLOOR_KNEE = 0.12;
const SATURATION = 0.7;
const TO_FLOOR = 0.25;
const OWN_RULE_ABOVE = 15;
const SHARE_WITHIN = 8;

const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const FLOOR = [0x2b, 0x27, 0x23].map(lin);
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function tone(c, knee = KNEE) {
  const y = luma(c);
  const t = c.map((v) => v / (1 + y / knee));
  const m = luma(t);
  return t.map((v, i) => enc(FLOOR[i] * TO_FLOOR + (m + (v - m) * SATURATION) * (1 - TO_FLOOR)));
}

function pixels(file) {
  const [w, h] = execFileSync('magick', [file, '-resize', `${WIDTH}x`, '-format', '%w %h', 'info:'], { encoding: 'utf8' }).trim().split(' ').map(Number);
  const raw = execFileSync('magick', [file, '-resize', `${WIDTH}x`, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 26 });
  return { w, h, at: (x, y) => [0, 1, 2].map((i) => lin(raw[(y * w + x) * 3 + i])) };
}

function palette(slug, cl) {
  const { w, h, at } = pixels(join(ROOT, MANIFEST.images.find((i) => i.slug === slug).master.path));
  const x1 = Math.max(2, Math.floor(w * cl * 0.6));
  const rows = Array.from({ length: h }, (_, y) => {
    const s = [0, 0, 0];
    for (let x = 0; x < x1; x++) at(x, y).forEach((v, i) => (s[i] += v / x1));
    return s;
  });
  const sigma = 0.04 * h, r = Math.ceil(3 * sigma);
  const blur = (y) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let d = -r; d <= r; d++) {
      const g = Math.exp(-(d * d) / (2 * sigma * sigma));
      rows[Math.min(h - 1, Math.max(0, y + d))].forEach((v, i) => (s[i] += v * g));
      n += g;
    }
    return s.map((v) => v / n);
  };
  const floor = [0, 0, 0], y0 = Math.floor(h * 0.95);
  for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) at(x, y).forEach((v, i) => (floor[i] += v / ((h - y0) * w)));
  return [...Array.from({ length: STOPS - 1 }, (_, i) => tone(blur(Math.round((i * (h - 1)) / (STOPS - 1))))), tone(floor, FLOOR_KNEE)];
}

const photos = [...CSS.matchAll(/\.banner\[data-photo=([a-z0-9-]+)\]\{--ct:[.\d]+;--ch:[.\d]+;--ar:[.\d]+;--cl:([.\d]+);--cw:[.\d]+\}/g)].map((m) => [m[1], palette(m[1], +m[2])]);
const shared = Array.from({ length: STOPS }, (_, s) => [0, 1, 2].map((i) => {
  const v = photos.map(([, p]) => p[s][i]).sort((a, b) => a - b);
  return Math.round((v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2);
}));
const near = (a, b, d) => a.every((c, s) => c.every((v, i) => Math.abs(v - b[s][i]) <= d));
const groups = [];
for (const [slug, p] of photos) {
  if (near(p, shared, OWN_RULE_ABOVE)) continue;
  const g = groups.find((x) => x.every(([, q]) => near(p, q, SHARE_WITHIN)));
  if (g) g.push([slug, p]);
  else groups.push([[slug, p]]);
}
console.log(`.banner{--ex:${shared.map(hex).join(',')}}`);
for (const g of groups) {
  const mean = g[0][1].map((c, s) => c.map((v, i) => Math.round(g.reduce((t, [, q]) => t + q[s][i], 0) / g.length)));
  console.log(`${g.map(([slug]) => `[data-photo=${slug}]`).join(',')}{--ex:${mean.map(hex).join(',')}}`);
}
