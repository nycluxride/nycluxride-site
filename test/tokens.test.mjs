import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const CSS_FILE = readdirSync(join(ROOT, "assets")).find((f) => /^lux\..*\.css$/.test(f));
const CSS = readFileSync(join(ROOT, "assets", CSS_FILE), "utf8");
const DESKTOP = {
  "--ink": "#0F1319", "--ink-2": "#505055", "--muted": "#6E6E73", "--muted-hover": "#4B4B50", "--subtle": "#AEAEAE", "--line": "#E6DFD2",
  "--line-strong": "#AEAEAE", "--white": "#FFFFFF", "--cream": "#FBF8F2", "--gold-50": "#FBF6EA", "--gold-100": "#F6EFDF", "--gold-200": "#E9DDBF",
  "--gold-300": "#EBC96A", "--gold-500": "#C9A227", "--gold-600": "#B8921F", "--gold-650": "#A8851C", "--gold-700": "#856823", "--champagne": "#F3E7C6",
  "--error": "#B02032", "--error-on-dark": "#FFC4BB", "--success": "#0F7244", "--warning": "#FFCB8F", "--on-glass": "#FFFFFF", "--on-glass-2": "#D9D9D9",
  "--on-pop-2": "#AEAEAE", "--glass-tint": "rgba(15,19,25,.2)", "--pop-tint": "rgba(15,19,25,.8)", "--caption-tint": "rgba(15,19,25,.72)", "--glass-dark": "radial-gradient(rgba(0,0,0,.15),rgba(0,0,0,0) 90%),radial-gradient(circle at 80% 200%,rgba(255,255,255,.25),rgba(255,255,255,0) 80%),linear-gradient(var(--glass-tint),var(--glass-tint))",
  "--glass-light": "radial-gradient(rgba(255,255,255,.15),rgba(255,255,255,0) 90%),radial-gradient(circle at 80% 200%,rgba(255,255,255,.25),rgba(255,255,255,0) 80%),linear-gradient(rgba(227,231,235,.3),rgba(227,231,235,.3))", "--glass-rim": "linear-gradient(-18deg,rgba(255,255,255,.8) 20%,rgba(255,255,255,.4) 30%,rgba(255,255,255,.05) 40%,rgba(255,255,255,.05) 60%,rgba(255,255,255,.4) 70%,rgba(255,255,255,.8) 90%)", "--glass-rim-fallback": "1px solid rgba(255,255,255,.4)", "--blur-glass": "blur(16px)", "--blur-header": "blur(24px)",
  "--blur-pop": "blur(24px)", "--blur-menu": "blur(40px)", "--hero-floor": "#2B2723", "--plate-tone": "#322C26", "--scrim-header": "linear-gradient(180deg,rgba(0,0,0,.6) 0,rgba(0,0,0,.6) 70%,rgba(0,0,0,0) 100%)", "--scrim-hero": "linear-gradient(0deg,rgba(43,39,35,.94) 0,rgba(43,39,35,.94) 232px,rgba(15,19,25,.64) 280px,rgba(15,19,25,.64) 470px,rgba(15,19,25,0) 700px)",
  "--overlay-banner": "rgba(14,14,12,.62)", "--overlay-menu": "rgba(15,19,25,.88)", "--overlay-dialog": "rgba(15,19,25,.45)", "--header-glass": "rgba(251,248,242,.92)", "--stage-warm": "linear-gradient(180deg,#F3E7C6 0%,#F6EFDF 38%,#FBF8F2 68%,#ECE6DA 100%)", "--stage-cool": "linear-gradient(180deg,#E3E7EB 0%,#EEF1F3 38%,#FBF8F2 68%,#E9E6E0 100%)",
  "--skeleton": "linear-gradient(90deg,#FFFFFF 0%,#E3E7EB 50%,#FFFFFF 100%) 0 0/200% 100%", "--shadow-glass": "0 2px 8px 0 rgba(6,10,13,.12),inset 4px 4px 8px rgba(0,0,0,.06)", "--shadow-1": "0 1px 2px rgb(43 39 35/.08),0 6px 20px rgb(43 39 35/.08)", "--shadow-2": "0 2px 6px rgb(43 39 35/.08),0 12px 32px rgb(43 39 35/.12)", "--shadow-2-up": "0 -2px 6px rgb(43 39 35/.06),0 -12px 32px rgb(43 39 35/.1)", "--shadow-3": "0 4px 12px rgb(43 39 35/.1),0 24px 56px rgb(43 39 35/.16)",
  "--shadow-card": "var(--shadow-1)", "--shadow-pop": "var(--shadow-3)", "--shadow-sheet": "var(--shadow-2-up)", "--focus-outer": "#0F1319",
  "--focus-inner": "#FFFFFF", "--radius-sm": "4px", "--radius-md": "8px", "--radius-lg": "16px", "--radius-pill": "999px", "--border-card-selected": "3px solid var(--gold-650)",
  "--border-tile-selected": "2px solid var(--gold-650)", "--control-xl": "52px", "--control-lg": "44px", "--control-md": "40px", "--control-sm": "32px", "--font-display": "\"Castoro\",\"Castoro Fallback\",Georgia,serif",
  "--font-sans": "\"Geist\",\"Geist Fallback\",Arial,system-ui,sans-serif", "--font-logo": "\"Archivo\",\"Archivo Fallback\",Arial,sans-serif", "--type-display-lg": "104px/120px", "--type-display-md": "80px/96px", "--type-display-sm": "64px/72px", "--type-headline-lg": "48px/56px",
  "--type-headline-md": "32px/40px", "--type-headline-sm": "24px/32px", "--type-subhead-lg": "32px/40px", "--type-subhead-md": "28px/36px", "--type-subhead-sm": "24px/32px", "--type-body-lg": "18px/26px",
  "--type-body-md": "16px/24px", "--type-body-sm": "14px/20px", "--type-caption": "12px/16px", "--tracking-display": ".25px", "--tracking-body": ".15px", "--tracking-lg": ".25px",
  "--tracking-caption": ".5px", "--space-4xs": "2px", "--space-3xs": "4px", "--space-2xs": "8px", "--space-xs": "12px", "--space-sm": "16px",
  "--space-md": "20px", "--space-lg": "24px", "--space-xl": "32px", "--space-2xl": "40px", "--space-3xl": "48px", "--space-4xl": "64px",
  "--space-5xl": "72px", "--space-6xl": "80px", "--space-7xl": "96px", "--icon-xs": "16px", "--icon-sm": "20px", "--icon-md": "24px",
  "--icon-lg": "32px", "--container": "1170px", "--container-wide": "1344px", "--gutter": "48px", "--header-h": "76px",
  "--bar-h": "60px", "--section-y": "80px", "--section-y-home": "96px", "--dur-fast": ".15s", "--dur-base": ".2s", "--dur-slow": ".3s",
  "--dur-settle": ".54s", "--dur-quick": ".33s", "--dur-exit": ".15s", "--ease-standard": "ease-in-out", "--ease-enter": "ease-out", "--ease-slide": "cubic-bezier(.4,0,.2,1)",
  "--ease-settle": "cubic-bezier(.16,1,.3,1)", "--ease-quick": "cubic-bezier(.2,.8,.2,1)", "--ease-exit": "cubic-bezier(.4,0,1,1)",
  "--i-pin": "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='1.8'%3E%3Cpath d='M12 21.5S18.5 14.9 18.5 10.5a6.5 6.5 0 1 0-13 0c0 4.4 6.5 11 6.5 11zM12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'/%3E%3C/svg%3E\")",
  "--i-alert": "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5v5.5M12 16v.5'/%3E%3C/svg%3E\")",
};
const GUTTER = {"--gutter": "32px"};
const PHONE = {
  "--type-display-lg": "48px/56px", "--type-display-md": "32px/40px", "--type-display-sm": "28px/36px", "--type-headline-lg": "32px/40px", "--type-headline-md": "24px/32px", "--type-headline-sm": "20px/28px",
  "--type-subhead-lg": "24px/32px", "--type-subhead-md": "20px/28px", "--type-subhead-sm": "18px/26px", "--space-3xs": "2px", "--space-2xs": "4px", "--space-xs": "8px",
  "--space-sm": "12px", "--space-md": "16px", "--space-lg": "20px", "--space-xl": "24px", "--space-2xl": "32px", "--space-3xl": "40px",
  "--space-4xl": "48px", "--space-5xl": "56px", "--space-6xl": "64px", "--space-7xl": "72px", "--icon-xs": "12px", "--icon-sm": "16px",
  "--icon-md": "20px", "--icon-lg": "24px", "--gutter": "24px", "--header-h": "56px", "--section-y": "48px", "--section-y-home": "56px",
};
const TABLET = { "--type-display-sm": "40px/48px", "--type-headline-lg": "36px/44px", "--header-h": "64px" };
const NO_GLASS = {
  "--glass-dark": "linear-gradient(#2B2723,#2B2723)", "--glass-light": "linear-gradient(#FFFFFF,#FFFFFF)", "--header-glass": "#FBF8F2",
  "--overlay-menu": "#0F1319", "--blur-glass": "none", "--blur-header": "none", "--blur-pop": "none", "--blur-menu": "none",
};
const LINEAR = {
  "--ease-settle": "linear(0,.074,.231,.406,.567,.699,.8,.874,.925,.959,.98,.993,1,1.003,1.004,1.004,1.003,1.003,1.002,1.001,1)",
  "--ease-quick": "linear(0,.07,.217,.381,.531,.658,.758,.833,.888,.926,.953,.971,.983,.99,.995,.998,1)",
};
const FACES = [
  "@font-face{font-family:\"Geist\";src:url(\"/assets/fonts/geist-latin.woff2\") format(\"woff2\");font-weight:400 600;font-style:normal;font-display:optional;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}",
  "@font-face{font-family:\"Castoro\";src:url(\"/assets/fonts/castoro-latin.woff2\") format(\"woff2\");font-weight:400;font-style:normal;font-display:optional;size-adjust:103%;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}",
  "@font-face{font-family:\"Archivo\";src:url(\"/assets/fonts/archivo-wordmark.woff2\") format(\"woff2\");font-weight:700;font-style:normal;font-display:swap;unicode-range:U+0020,U+0043-0045,U+0049,U+004C,U+004E,U+0052,U+0055,U+0058-0059}",
  "@font-face{font-family:\"Geist Fallback\";src:local(\"Arial\"),local(\"Liberation Sans\");font-weight:400;size-adjust:102.16%;ascent-override:98.38%;descent-override:28.88%;line-gap-override:0%}",
  "@font-face{font-family:\"Geist Fallback\";src:local(\"Arial\"),local(\"Liberation Sans\");font-weight:500;size-adjust:104.78%;ascent-override:95.92%;descent-override:28.15%;line-gap-override:0%}",
  "@font-face{font-family:\"Geist Fallback\";src:local(\"Arial Bold\"),local(\"Arial-BoldMT\"),local(\"Liberation Sans Bold\");font-weight:600;size-adjust:100.96%;ascent-override:99.54%;descent-override:29.22%;line-gap-override:0%}",
  "@font-face{font-family:\"Geist Fallback\";src:local(\"Helvetica Neue\");font-weight:400;size-adjust:101.38%;ascent-override:99.13%;descent-override:29.1%;line-gap-override:0%}",
  "@font-face{font-family:\"Geist Fallback\";src:local(\"Helvetica Neue Medium\"),local(\"HelveticaNeue-Medium\");font-weight:500;size-adjust:101.19%;ascent-override:99.32%;descent-override:29.15%;line-gap-override:0%}",
  "@font-face{font-family:\"Geist Fallback\";src:local(\"Helvetica Neue Bold\"),local(\"HelveticaNeue-Bold\");font-weight:600;size-adjust:100.85%;ascent-override:99.65%;descent-override:29.25%;line-gap-override:0%}",
  "@font-face{font-family:\"Castoro Fallback\";src:local(\"Times New Roman\"),local(\"Liberation Serif\");size-adjust:113.47%;ascent-override:68.53%;descent-override:22.24%;line-gap-override:29.96%}",
  "@font-face{font-family:\"Castoro Fallback\";src:local(\"Georgia\");size-adjust:103.9%;ascent-override:74.85%;descent-override:24.29%;line-gap-override:32.71%}",
  "@font-face{font-family:\"Archivo Fallback\";src:local(\"Arial\"),local(\"Liberation Sans\");size-adjust:101.44%;ascent-override:86.56%;descent-override:20.7%;line-gap-override:0%}",
];

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

function block(text, start) {
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`unclosed block at ${start}`);
}

function decls(body) {
  const out = {};
  let depth = 0;
  let cur = "";
  for (const ch of body.replace(/\n/g, "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      const i = cur.indexOf(":");
      if (i > 0) out[cur.slice(0, i).trim()] = cur.slice(i + 1).trim();
      cur = "";
    } else cur += ch;
  }
  const i = cur.indexOf(":");
  if (i > 0) out[cur.slice(0, i).trim()] = cur.slice(i + 1).trim();
  return out;
}

const tokensAt = CSS.indexOf("@layer tokens{");
const TOKENS = tokensAt < 0 ? "" : block(CSS, tokensAt);
const rootBody = (prefix) => {
  const at = TOKENS.indexOf(prefix);
  if (at < 0) return {};
  return decls(block(TOKENS, at + prefix.length - 1).replace(/^:root\{/, "").replace(/\}$/, ""));
};
const desktop = TOKENS ? decls(block(TOKENS, TOKENS.indexOf(":root{")).replace(/^color-scheme:only light;/, "")) : {};
const gutter = rootBody("@media (min-width:1024px) and (max-width:1279px){");
const phone = rootBody("@media (max-width:1023px){");
const tablet = rootBody("@media (min-width:600px) and (max-width:1023px){");
const noGlass = rootBody("@media (prefers-reduced-transparency:reduce){");
const linear = rootBody("@supports (transition-timing-function:linear(0,1)){");

check(`${CSS_FILE} has an @layer tokens block`, () => assert.ok(TOKENS.length > 0));
check("the layer order is reset, tokens, base, layout, components, booking, pages, utilities", () =>
  assert.ok(CSS.startsWith("@layer reset,tokens,base,layout,components,booking,pages,utilities;"), CSS.slice(0, 80)));
check("the stylesheet has the @layer pages block", () => assert.ok(CSS.includes("@layer pages{"), "no pages layer"));
for (const [name, value] of Object.entries(DESKTOP)) {
  check(`token ${name} is ${value.length > 40 ? value.slice(0, 40) + "..." : value}`, () => assert.equal(desktop[name], value));
}
for (const [name, value] of Object.entries(GUTTER)) {
  check(`token ${name} is ${value} from 1024 to 1279px`, () => assert.equal(gutter[name], value));
}
for (const [name, value] of Object.entries(PHONE)) {
  check(`phone token ${name} is ${value}`, () => assert.equal(phone[name], value));
}
for (const [name, value] of Object.entries(TABLET)) {
  check(`tablet token ${name} is ${value} from 600 to 1023px, after the phone block`, () => {
    assert.equal(tablet[name], value);
    assert.ok(TOKENS.indexOf("@media (min-width:600px) and (max-width:1023px){") > TOKENS.indexOf("@media (max-width:1023px){"), "the tablet rule must come after the phone block");
  });
}
for (const [name, value] of Object.entries(NO_GLASS)) {
  check(`reduced transparency token ${name} is ${value}`, () => assert.equal(noGlass[name], value));
}
for (const [name, value] of Object.entries(LINEAR)) {
  check(`where linear() is supported, ${name} is the linear() curve`, () => assert.equal(linear[name], value));
}
check("--dur-reveal is gone", () => assert.ok(!/--dur-reveal/.test(CSS)));
check("color-scheme is only light", () => assert.match(TOKENS, /:root\{color-scheme:only light;/));

const rgb = (v) => {
  const s = String(v).trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(",").map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error(`not a color: ${v}`);
};
const t = (name) => rgb(DESKTOP[name]);
const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
const lum = (c) => {
  const [r, g, b] = c.slice(0, 3).map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const WHITE = [255, 255, 255, 1];
const BLACK = [0, 0, 0, 1];
const D9 = rgb("#D9D9D9");
const AE = rgb("#AEAEAE");
const scrimHero = rgba(DESKTOP["--scrim-hero"], 0);
const scrimText = rgba(DESKTOP["--scrim-hero"], 2);
const scrimHeader = rgba(DESKTOP["--scrim-header"], 0);
function rgba(value, index) {
  return rgb(value.match(/rgba\([^)]+\)/g)[index]);
}
const floorBand = over(t("--glass-tint"), over(scrimHero, WHITE));
const bannerBar = over(t("--glass-tint"), over(t("--overlay-banner"), WHITE));
const popover = over(t("--pop-tint"), WHITE);
const banner = over(t("--overlay-banner"), WHITE);
const caption = over(t("--caption-tint"), WHITE);
const menu = over(t("--overlay-menu"), WHITE);
const headerGlass = over(t("--header-glass"), BLACK);
const PAIRS = [
  ["ink on white", t("--ink"), t("--white"), 4.5],
  ["ink on cream", t("--ink"), t("--cream"), 4.5],
  ["ink on gold-50", t("--ink"), t("--gold-50"), 4.5],
  ["ink on gold-100", t("--ink"), t("--gold-100"), 4.5],
  ["ink on gold-200", t("--ink"), t("--gold-200"), 4.5],
  ["ink-2 on white (8.02)", t("--ink-2"), t("--white"), 7],
  ["ink-2 on cream (7.56)", t("--ink-2"), t("--cream"), 7],
  ["ink-2 on gold-50 (7.43)", t("--ink-2"), t("--gold-50"), 7],
  ["ink-2 on gold-100 (7.00)", t("--ink-2"), t("--gold-100"), 7],
  ["ink-2 on gold-200", t("--ink-2"), t("--gold-200"), 4.5],
  ["muted on white", t("--muted"), t("--white"), 4.5],
  ["muted on cream", t("--muted"), t("--cream"), 4.5],
  ["muted on gold-50", t("--muted"), t("--gold-50"), 4.5],
  ["muted-hover on cream", t("--muted-hover"), t("--cream"), 4.5],
  ["gold-700 on white", t("--gold-700"), t("--white"), 4.5],
  ["gold-700 on cream", t("--gold-700"), t("--cream"), 4.5],
  ["gold-700 on gold-50", t("--gold-700"), t("--gold-50"), 4.5],
  ["gold-700 on gold-100", t("--gold-700"), t("--gold-100"), 4.5],
  ["error on white", t("--error"), t("--white"), 4.5],
  ["error on cream", t("--error"), t("--cream"), 4.5],
  ["white on success", t("--white"), t("--success"), 4.5],
  ["ink on warning", t("--ink"), t("--warning"), 4.5],
  ["primary button ink on gold-500", t("--ink"), t("--gold-500"), 4.5],
  ["primary button hover ink on gold-600", t("--ink"), t("--gold-600"), 4.5],
  ["primary button pressed ink on gold-650", t("--ink"), t("--gold-650"), 4.5],
  ["secondary button edge gold-650 on white", t("--gold-650"), t("--white"), 3],
  ["secondary button edge gold-650 on cream", t("--gold-650"), t("--cream"), 3],
  ["gold-650 line on gold-50", t("--gold-650"), t("--gold-50"), 3],
  ["gold-650 line on gold-100", t("--gold-650"), t("--gold-100"), 3],
  ["white on ink", t("--white"), t("--ink"), 4.5],
  ["gold-300 on ink", t("--gold-300"), t("--ink"), 4.5],
  ["gold-500 on ink", t("--gold-500"), t("--ink"), 4.5],
  ["champagne on ink", t("--champagne"), t("--ink"), 4.5],
  ["white on the header scrim over white", t("--white"), over(scrimHeader, WHITE), 4.5],
  ["ink-2 on the scrolled header glass over black", t("--ink-2"), headerGlass, 4.5],
  ["ink on the scrolled header glass over black", t("--ink"), headerGlass, 4.5],
  ["white in the hero text zone over white", t("--white"), over(scrimText, WHITE), 4.5],
  ["champagne in the hero text zone over white", t("--champagne"), over(scrimText, WHITE), 4.5],
  ["white on the closed Hero A bar", t("--white"), floorBand, 4.5],
  ["#D9D9D9 on the closed Hero A bar", D9, floorBand, 4.5],
  ["white on the Hero B bar", t("--white"), bannerBar, 4.5],
  ["#D9D9D9 on the Hero B bar", D9, bannerBar, 4.5],
  ["error-on-dark on the Hero B bar", t("--error-on-dark"), bannerBar, 4.5],
  ["white on a popover", t("--white"), popover, 4.5],
  ["#AEAEAE on a popover", AE, popover, 4.5],
  ["gold-300 on a popover", t("--gold-300"), popover, 4.5],
  ["gold-500 day fill on a popover", t("--gold-500"), popover, 3],
  ["white on the list row highlight", t("--white"), t("--muted"), 4.5],
  ["white on the banner overlay over white", t("--white"), banner, 4.5],
  ["champagne banner H1 (large) on the banner overlay", t("--champagne"), banner, 3],
  ["white banner lede link on the banner overlay", t("--white"), banner, 4.5],
  ["white banner lede link on the phone floor", t("--white"), t("--hero-floor"), 4.5],
  ["white on a photo caption", t("--white"), caption, 4.5],
  ["white on the hero floor", t("--white"), t("--hero-floor"), 4.5],
  ["#D9D9D9 on the hero floor", D9, t("--hero-floor"), 4.5],
  ["champagne on the hero floor", t("--champagne"), t("--hero-floor"), 4.5],
  ["white on the menu overlay", t("--white"), menu, 4.5],
  ["focus ring ink on cream", t("--focus-outer"), t("--cream"), 3],
  ["focus ring white on ink", t("--focus-inner"), t("--ink"), 3],
];
for (const [name, fg, bg, min] of PAIRS) {
  check(`contrast: ${name} meets ${min}:1`, () => {
    const r = ratio(fg, bg);
    assert.ok(Number(r.toFixed(2)) >= min, `${r.toFixed(2)}:1`);
  });
}

const css = CSS.replace(/\.[A-Za-z0-9_-]{6,}\.woff2/g, ".woff2");
const faces = css.match(/@font-face\{[^}]*\}/g) || [];
check("the stylesheet holds exactly the twelve @font-face rules, in order, with a metric-matched Geist Fallback per weight", () => assert.deepEqual(faces, FACES));
check("no length in lux.css uses ch, so measures keep their width when a fallback font is laid out first", () => assert.deepEqual(CSS.match(/[\d.]+ch\b/g), null));
check("every backdrop-filter in lux.css also sets -webkit-backdrop-filter to the same value for Safari 17 and older", () => {
  const unpaired = [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, , body]) => {
    const plain = [...body.matchAll(/(?:^|;)backdrop-filter:([^;]*)/g)].map((m) => m[1]);
    const prefixed = [...body.matchAll(/-webkit-backdrop-filter:([^;]*)/g)].map((m) => m[1]);
    return plain.join("|") !== prefixed.join("|");
  }).map(([, sel]) => sel.trim().slice(-60));
  assert.deepEqual(unpaired, []);
});
check("no Source Serif 4 face is left", () => assert.ok(!/Source Serif|SourceSerif/.test(CSS)));
check("Geist and Castoro use font-display optional, the wordmark swap", () => {
  assert.match(faces[0] || "", /font-display:optional/);
  assert.match(faces[1] || "", /font-display:optional/);
  assert.match(faces[2] || "", /font-display:swap/);
});
const fonts = readdirSync(join(ROOT, "assets/fonts")).sort();
check("assets/fonts holds exactly the Geist, Castoro and wordmark files and OFL.txt", () => {
  const kinds = fonts.map((f) => f.replace(/\.[A-Za-z0-9_-]{6,}\.woff2$/, ".woff2"));
  assert.deepEqual(kinds.sort(), ["OFL.txt", "archivo-wordmark.woff2", "castoro-latin.woff2", "geist-latin.woff2"]);
});
const ofl = readFileSync(join(ROOT, "assets/fonts/OFL.txt"), "utf8");
check("OFL.txt carries the Archivo, Geist and Castoro copyright lines and not the Adobe line", () => {
  assert.ok(ofl.startsWith("Copyright 2020 The Archivo Project Authors"), "Archivo first");
  assert.ok(ofl.includes("Copyright 2024 The Geist Project Authors"), "Geist");
  assert.ok(ofl.includes("Copyright 2020 The Castoro Project Authors"), "Castoro");
  assert.ok(!ofl.includes("Adobe"), "the Source Serif 4 part is still there");
});

if (failures) {
  console.error(`\n${failures} token test(s) failed`);
  process.exit(1);
}
console.log("\nAll token tests passed");
process.exit(0);
