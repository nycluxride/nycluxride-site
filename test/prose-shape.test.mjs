import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const WORDS = JSON.parse(readFileSync(join(ROOT, "test/fixtures/prose-words.json"), "utf8"));
const SHAPE_FILE = join(ROOT, "test/fixtures/prose-shape.json");
const RECORD = process.env.PROSE_SHAPE_RECORD === "1";
const SHAPE = RECORD ? {} : JSON.parse(readFileSync(SHAPE_FILE, "utf8"));
const COPY = await import(join(ROOT, "api/_copy.mjs"));
const { CHILD_SEAT_CENTS } = await import(join(ROOT, "api/_rates.mjs"));
const SEAT = `$${CHILD_SEAT_CENTS / 100} per seat`;

const squash = (s) => String(s).replace(/\s+/g, " ").trim();
const FAIL = WORDS.fail.map(([name, source, flags]) => [name, new RegExp(source, flags || "i")]);
const REPORT = WORDS.report.map(([name, source, flags]) => [name, new RegExp(source, (flags || "i") + "g")]);
const ALLOW = new Set(WORDS.allow.map(squash));

const A = [
  "Airport rides to or from JFK, LaGuardia, Newark and Teterboro are one flat price by vehicle class from anywhere in New York City, with tolls, airport fees and taxes included.",
  "A gratuity for your chauffeur is optional and chosen when you book.",
  "After an airport transfer, only true extras are charged to the card saved at booking: waiting beyond the free window, extra stops and parking, each with an itemized receipt.",
  "Hourly bookings are charged the hourly fare with NYC sales tax and the Black Car Fund at booking. Tolls and parking are charged after the ride to the card saved at booking, each with an itemized receipt.",
  "Airport rides to or from New York City include tolls, airport fees and taxes, and the tip is up to you. On other trips, tolls and parking are charged after the ride.",
  "Airport transfer prices for New York City addresses include tolls, airport fees and taxes, and the gratuity is optional.",
  "Airport transfer prices for New York City addresses include tolls, airport fees and taxes. Hourly rates and rates by distance and time are before sales tax, the Black Car Fund, tolls and parking, and the gratuity is optional.",
  "Flat airport rates from NYC LUX RIDE include tolls and airport fees, so the route does not change the price.",
];
const RATES_LEDE = "Airport transfers to or from anywhere in New York City are one flat price, with tolls, airport fees and taxes included. Hourly bookings have a 3-hour minimum. There's no meter and no surge pricing.";
const EXEMPT = [...A, COPY.POLICY.cancel, RATES_LEDE, ...Object.values(COPY.CHECKOUT)].sort((a, b) => b.length - a.length);
const LEGAL = new Set(["privacy-policy.html", "terms-of-service.html"]);
const MAP_CAPTION = "Lines mark destinations, not road routes.";

const FREE_FORMS = [
  "You get 45 minutes of free waiting after a domestic landing, 60 minutes after an international landing, and 15 minutes at any other pickup.",
  "You get 45 minutes of free waiting after a domestic landing and 60 minutes after an international landing.",
  "You get 15 minutes of free waiting from the pickup time.",
  "15 minutes of free waiting at other pickups",
];
const TRACK_FORMS = ["We track your flight and move the pickup if it lands early or late.", "We track your flight."];
const FORMS_64 = new Set([
  "We answer calls and messages 24 hours a day, every day.",
  "You can book any class by the hour, with a 3-hour minimum.",
  `Infant, toddler and booster seats are ${SEAT}, charged at booking.`,
  "For a pickup within the next 90 minutes, email info@nycluxride.com or message us on WhatsApp.",
  "Online at least 90 minutes before pickup.",
  "Sooner by email or WhatsApp when a car is free.",
  "45 minutes after a domestic landing, 60 after an international landing, 15 at any other pickup.",
  "One total by class from any New York City address, with tolls, airport fees and taxes included.",
  "Flat airport rates include tolls, airport fees and taxes.",
  "For now, car service pickups at Terminals 5 and 7 use a lot at the Howard Beach AirTrain station, a free AirTrain ride from the terminal.",
  "For now, JFK pickups at Terminals 5 and 7 are at the Howard Beach AirTrain station lot, a free AirTrain ride from your terminal.",
  "Book online at least 90 minutes before pickup.",
  "For a pickup within the next 90 minutes, email or WhatsApp us.",
  `Infant, toddler and booster seats, ${SEAT}, charged at booking.`,
  "We move the pickup if your flight lands early or late.",
  "For a Luxury Sprinter by the hour, we'll send you a price.",
]);
const VALUE_FORMS = {
  "Free waiting": "45 minutes after a domestic landing, 60 after an international landing, 15 at any other pickup.",
  "Flight tracking": "We move the pickup if your flight lands early or late.",
};
const AIRLINE_VALUE_FORMS = {
  "Free waiting": "45 minutes after a domestic airline landing and 60 after an international one.",
  "Flight tracking": "For airline flights, we move the pickup if your flight lands early or late.",
};
const AIRLINE_ONLY = new Set(["locations/westchester-airport.html"]);

const AREAS = {
  manhattan: ["Manhattan", "", "in Manhattan"],
  brooklyn: ["Brooklyn", "", "in Brooklyn"],
  queens: ["Queens", "", "in Queens"],
  bronx: ["Bronx", "the ", "in the Bronx"],
  "staten-island": ["Staten Island", "", "on Staten Island"],
  "financial-district": ["Financial District", "the ", "in the Financial District"],
  soho: ["SoHo", "", "in SoHo"],
  "upper-east-side": ["Upper East Side", "the ", "on the Upper East Side"],
  "upper-west-side": ["Upper West Side", "the ", "on the Upper West Side"],
  "long-island-city": ["Long Island City", "", "in Long Island City"],
  "midtown-manhattan": ["Midtown", "", "in Midtown"],
};
const SLOT_EYEBROWS = ["Nearby", "By the hour", "Questions", "Nearby areas", "Book"];
// Slot labels of the 2026-11 templates: T-B distance airports, T-C towns outside New York City, T-E routes.
const SLOTS = {
  "locations/westchester-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/hoboken.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "long-distance-car-service/nyc-to-philadelphia.html": ["Questions", "Other routes", "Book"],
  "locations/alpine-tenafly.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/bradley-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/edgewater.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/englewood.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/fort-lee.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/greenwich-ct.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/hamptons.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/jersey-city.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/long-island-macarthur-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/long-island.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/morristown-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/morristown.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/new-jersey.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/newark-nj.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/paramus.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/philadelphia-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/princeton.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/republic-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/secaucus.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/short-hills-livingston.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/stamford-ct.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/stewart-airport.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/summit.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/weehawken-north-bergen.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "locations/westchester-county.html": ["Nearby", "Questions", "Nearby areas", "Book"],
  "long-distance-car-service/nyc-to-atlantic-city.html": ["Questions", "Other routes", "Book"],
  "long-distance-car-service/nyc-to-boston.html": ["Questions", "Other routes", "Book"],
  "long-distance-car-service/nyc-to-connecticut.html": ["Questions", "Other routes", "Book"],
  "long-distance-car-service/nyc-to-washington-dc.html": ["Questions", "Other routes", "Book"],
};
const SLOT_H2 = {
  "locations/westchester-airport.html": ["How we meet you at Westchester", "Trips from Westchester Airport", "Questions about Westchester pickups", "Areas near Westchester Airport"],
  "locations/hoboken.html": ["Pickups in Hoboken", "To the airports from Hoboken", "Questions about Hoboken pickups", "Areas near Hoboken", "Book a car in Hoboken"],
  "long-distance-car-service/nyc-to-philadelphia.html": ["Questions about New York to Philadelphia", "More trips from New York"],
  "locations/alpine-tenafly.html": ["Pickups in Alpine and Tenafly", "To the airports from Alpine and Tenafly", "Questions about Alpine and Tenafly pickups", "Areas near Alpine and Tenafly", "Book a car in Alpine and Tenafly"],
  "locations/bradley-airport.html": ["How we meet you at Bradley", "Trips from Bradley Airport", "Questions about Bradley pickups", "Areas near Bradley Airport"],
  "locations/edgewater.html": ["Pickups in Edgewater", "To the airports from Edgewater", "Questions about Edgewater pickups", "Areas near Edgewater", "Book a car in Edgewater"],
  "locations/englewood.html": ["Pickups in Englewood", "To the airports from Englewood", "Questions about Englewood pickups", "Areas near Englewood", "Book a car in Englewood"],
  "locations/fort-lee.html": ["Pickups in Fort Lee", "To the airports from Fort Lee", "Questions about Fort Lee pickups", "Areas near Fort Lee", "Book a car in Fort Lee"],
  "locations/greenwich-ct.html": ["Pickups in Greenwich", "To the airports from Greenwich", "Questions about Greenwich pickups", "Areas near Greenwich", "Book a car in Greenwich"],
  "locations/hamptons.html": ["Pickups in the Hamptons", "To the airports from the Hamptons", "Questions about Hamptons trips", "Areas near the Hamptons", "Book a car to the Hamptons"],
  "locations/jersey-city.html": ["Pickups in Jersey City", "To the airports from Jersey City", "Questions about Jersey City pickups", "Areas near Jersey City", "Book a car in Jersey City"],
  "locations/long-island-macarthur-airport.html": ["How we meet you at MacArthur", "Trips from MacArthur Airport", "Questions about MacArthur pickups", "Areas near MacArthur Airport"],
  "locations/long-island.html": ["Pickups on Long Island", "To the airports from Long Island", "Questions about Long Island pickups", "Areas near Long Island", "Book a car on Long Island"],
  "locations/morristown-airport.html": ["The FBOs at Morristown", "Trips from Morristown Airport", "Questions about Morristown Airport pickups", "Areas near Morristown Airport"],
  "locations/morristown.html": ["Pickups in Morristown", "To the airports from Morristown", "Questions about Morristown pickups", "Areas near Morristown", "Book a car in Morristown"],
  "locations/new-jersey.html": ["Pickups in New Jersey", "To the airports from New Jersey", "Questions about New Jersey pickups", "Areas near New Jersey", "Book a car from New Jersey"],
  "locations/newark-nj.html": ["Pickups in Newark", "To the airports from Newark", "Questions about Newark pickups", "Areas near Newark", "Book a car in Newark"],
  "locations/paramus.html": ["Pickups in Paramus", "To the airports from Paramus", "Questions about Paramus pickups", "Areas near Paramus", "Book a car in Paramus"],
  "locations/philadelphia-airport.html": ["How we meet you at PHL", "Trips from Philadelphia Airport", "Questions about PHL pickups", "Areas near Philadelphia Airport"],
  "locations/princeton.html": ["Pickups in Princeton", "To the airports from Princeton", "Questions about Princeton pickups", "Areas near Princeton", "Book a car in Princeton"],
  "locations/republic-airport.html": ["The FBOs at Republic", "Trips from Republic Airport", "Questions about Republic Airport pickups", "Areas near Republic Airport"],
  "locations/secaucus.html": ["Pickups in Secaucus", "To the airports from Secaucus", "Questions about Secaucus pickups", "Areas near Secaucus", "Book a car in Secaucus"],
  "locations/short-hills-livingston.html": ["Pickups in Short Hills and Livingston", "To the airports from Short Hills and Livingston", "Questions about Short Hills and Livingston pickups", "Areas near Short Hills and Livingston", "Book a car in Short Hills and Livingston"],
  "locations/stamford-ct.html": ["Pickups in Stamford", "To the airports from Stamford", "Questions about Stamford pickups", "Areas near Stamford", "Book a car in Stamford"],
  "locations/stewart-airport.html": ["How we meet you at Stewart", "Trips from Stewart Airport", "Questions about Stewart pickups", "Areas near Stewart Airport"],
  "locations/summit.html": ["Pickups in Summit", "To the airports from Summit", "Questions about Summit pickups", "Areas near Summit", "Book a car in Summit"],
  "locations/weehawken-north-bergen.html": ["Pickups in Weehawken and North Bergen", "To the airports from Weehawken and North Bergen", "Questions about Weehawken and North Bergen pickups", "Areas near Weehawken and North Bergen", "Book a car in Weehawken or North Bergen"],
  "locations/westchester-county.html": ["Pickups in Westchester", "To the airports from Westchester", "Questions about Westchester pickups", "Areas near Westchester", "Book a car in Westchester"],
  "long-distance-car-service/nyc-to-atlantic-city.html": ["Questions about New York to Atlantic City", "More trips from New York"],
  "long-distance-car-service/nyc-to-boston.html": ["Questions about New York to Boston", "More trips from New York"],
  "long-distance-car-service/nyc-to-connecticut.html": ["Questions about New York to Connecticut", "More trips from New York"],
  "long-distance-car-service/nyc-to-washington-dc.html": ["Questions about New York to Washington", "More trips from New York"],
};

const SO = /, so (?!that\b)[a-z]+/gi;
const SO_START = /^So\b/;
const WHICH = /, which\b/gi;
const PLACES = [/\b(sits|stands)\b/gi, /\b(holds|fills|closes)\b/gi, /\bdecid(e|es)\b/gi, /\bbehav(e|es)\b/gi, /\bshap(es|ed)\b|\bshape (every|how|the|brooklyn)\b/gi, /\bsettl(e|es|ed)\b/gi];
const TRIAD = /^[^,]+(?:, [^,]+)+,? (?:and|or) [^,]+[.?!]?$/;
const PASSIVE = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b(?!\s+by\b)/gi;
const NOT_Y = /, not (a |an |the |by |from |at |on )?[a-z]+/gi;
const CONTRAST = /\b(rather than|instead)\b/gi;

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "cdn-cgi", "api"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

function jsStrings(src) {
  const out = [];
  let i = 0, prev = "";
  const isRegexStart = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of|delete|void|throw|new|do|else)$/.test(prev);
  const readString = (q) => {
    let j = i + 1, buf = "", parts = [];
    while (j < src.length && src[j] !== q) {
      if (src[j] === "\\") { buf += src[j + 1] === "n" ? "\n" : src[j + 1]; j += 2; continue; }
      if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
        parts.push(buf);
        buf = "{...}";
        let depth = 1, k = j + 2;
        while (k < src.length && depth) {
          if (src[k] === "{") depth++;
          else if (src[k] === "}") depth--;
          else if (src[k] === '"' || src[k] === "'" || src[k] === "`") {
            const save = i; i = k; const r = readString(src[k]); out.push(...r.found); k = r.end; i = save; continue;
          }
          k++;
        }
        j = k;
        continue;
      }
      buf += src[j];
      j++;
    }
    parts.push(buf);
    return { value: parts.join(""), end: j + 1, found: [] };
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const r = readString(c);
      out.push(r.value, ...r.found);
      i = r.end;
      prev = "x";
    } else if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 2;
    } else if (c === "/" && isRegexStart()) {
      let j = i + 1, cls = false;
      while (j < src.length && (src[j] !== "/" || cls)) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        j++;
      }
      i = j + 1;
      while (/[a-z]/.test(src[i] || "")) i++;
      prev = "x";
    } else {
      if (!/\s/.test(c)) prev = /[A-Za-z0-9_$]/.test(c) ? (/[A-Za-z0-9_$]$/.test(prev) ? prev + c : c) : c;
      i++;
    }
  }
  return out;
}

const CODE = /(querySelector|addEventListener|getElementById|classList|function\(|=>|\$\(|\bvar\b|\blet\b|\breturn\b|[{};]\s*$)/;
const isCopy = (s) => {
  const t = squash(String(s).replace(/<[^>]*>/g, " "));
  if (!/[A-Za-z]{2,} [A-Za-z]{2,}/.test(t) || CODE.test(s) || /^\s*[.#\[]/.test(t)) return false;
  const tokens = t.split(" ");
  if (!/[A-Z.!?]/.test(t) && tokens.every((w) => /^[a-z0-9_|-]+$/.test(w))) return false;
  return true;
};
const plain = (s) => squash(String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/ ([.,!?])/g, "$1"));
const unexempt = (t) => { let s = t; for (const e of EXEMPT) s = s.split(e).join(" "); return s.replace(/\{[^}]*\}/g, " "); };

function sentences(text) {
  let t = squash(text).replace(/\s+([.,;:!?])/g, "$1");
  t = t.replace(/\b([A-Z])\. (?=[A-Z])/g, "$1§ ").replace(/\b(St|Mt|Dr|No|Ave|Blvd|vs)\./g, "$1§").replace(/\bU\.S\./g, "U§S§");
  return t.split(/(?<=[.?!])\s+(?=["A-Z0-9])/).map((s) => s.replace(/§/g, ".").trim()).filter((s) => s.split(" ").length >= 2);
}
function syll(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

const BLOCK = "p, li, dd, dt, td, th, caption, summary, h1, h2, h3, h4, figcaption, legend, label, option, blockquote";
function read(file) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const { document } = new JSDOM(html).window;
  const ld = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else if (typeof v === "string" && /\s/.test(v) && !/^https?:/.test(v)) ld.push(v);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) walk(JSON.parse(s.textContent));
  const body = document.body.cloneNode(true);
  for (const n of body.querySelectorAll("script, style, svg")) n.remove();
  if (LEGAL.has(file)) for (const n of body.querySelectorAll("main")) n.setAttribute("data-legal", "");
  if (file === "rates.html") for (const n of body.querySelectorAll("table")) n.setAttribute("data-exempt", "");
  const blocks = [];
  for (const el of body.querySelectorAll(BLOCK)) {
    const pair = el.tagName === "LI" && el.querySelector(":scope > b + span, :scope > strong + span");
    if (pair) {
      const ex = !!el.closest("[data-legal], [data-exempt]");
      blocks.push({ el: pair.previousElementSibling, tag: "dt", text: squash(pair.previousElementSibling.textContent), exempt: ex }, { el: pair, tag: "dd", text: squash(pair.textContent), exempt: ex });
      continue;
    }
    if (el.querySelector(BLOCK.split(", ").filter((t) => !["summary", "label", "legend", "caption"].includes(t)).join(", "))) continue;
    blocks.push({ el, tag: el.tagName.toLowerCase(), text: squash(el.textContent), exempt: !!el.closest("[data-legal], [data-exempt]") });
  }
  const attrs = [];
  for (const el of body.querySelectorAll("[alt], [aria-label], [title], [placeholder]")) for (const a of ["alt", "aria-label", "title", "placeholder"]) if (el.getAttribute(a)) attrs.push(squash(el.getAttribute(a)));
  for (const el of body.querySelectorAll('button[value], input[type=button][value], input[type=submit][value], input[type=reset][value]')) attrs.push(squash(el.getAttribute("value")));
  const metas = [...document.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]')].map((m) => m.getAttribute("content")).filter((v) => v && /\s/.test(v)).map(squash);
  const visible = squash(body.textContent);
  return { file, document, body, blocks, attrs, metas, ld: ld.map(squash), title: squash(document.title), visible };
}

const FILES = htmlFiles(ROOT);
const pages = FILES.map(read);
const scriptFiles = readdirSync(join(ROOT, "assets")).filter((f) => /^(lux|pay2?|done|map)\.[A-Za-z0-9]+\.js$/.test(f)).sort();
const scriptStrings = [...new Set(scriptFiles.flatMap((f) => jsStrings(readFileSync(join(ROOT, "assets", f), "utf8"))).filter(isCopy).map(plain))].filter((s) => s.length > 3);
const copyStrings = [];
const walkCopy = (v) => {
  if (Array.isArray(v)) v.forEach(walkCopy);
  else if (v && typeof v === "object") Object.values(v).forEach(walkCopy);
  else if (typeof v === "string" && /[A-Za-z]{2,} [A-Za-z]{2,}/.test(v)) copyStrings.push(squash(v));
};
walkCopy(Object.fromEntries(Object.entries(COPY)));
const API_TEXT = [readFileSync(join(ROOT, "api/_flight.mjs"), "utf8").match(/STATUS_TEXT = new Map\((\[[^;]*\])\);/), readFileSync(join(ROOT, "api/_places.mjs"), "utf8").match(/AREA_LABELS = \{[^}]*?("airport-other"[^}]*)\}/)];
for (const m of API_TEXT) for (const [, t] of (m ? m[1] : "").matchAll(/"([^"]*[A-Za-z][^"]*)"/g)) if (/[A-Z]/.test(t[0]) && !/^[a-z-]+$/.test(t)) copyStrings.push(squash(t));
const SCRIPTS = { file: "scripts", strings: [...new Set([...copyStrings, ...scriptStrings])] };

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 14).join("\n       ")}`);
  }
}

const PROSE = new Set(["p", "li", "dd", "td", "summary", "figcaption", "blockquote", "caption"]);
const texts = (p) => [p.title, ...p.metas, ...p.attrs, ...p.ld, ...p.blocks.filter((b) => !b.exempt).map((b) => b.text)].filter((t) => !ALLOW.has(t));
const counts = (list) => {
  const n = (re) => list.reduce((a, t) => a + (unexempt(t).match(re) || []).length, 0);
  return { so: n(SO), sostart: list.flatMap((t) => sentences(unexempt(t))).filter((x) => SO_START.test(x)).length, which: n(WHICH), places: PLACES.reduce((a, re) => a + n(re), 0) };
};
function shapeOf(p) {
  const prose = p.blocks.filter((b) => !b.exempt);
  const c = counts([...prose.map((b) => b.text), ...p.metas, ...p.attrs]);
  const isTriad = (t) => {
    const s = t.replace(/[.?!]$/, "");
    if (!/, [^,]+ (and|or) /.test(s) && !/, (and|or) /.test(s)) return false;
    const items = s.split(/,? (?:and|or) |, /);
    return items.length >= 3 && items.every((x) => x.trim() && x.trim().split(" ").length <= 3);
  };
  const triads = prose.filter((b) => /^h[1-3]$/.test(b.tag) && isTriad(b.text)).length + prose.filter((b) => b.el.closest(".lede")).flatMap((b) => sentences(b.text)).filter(isTriad).length;
  const colons = prose.filter((b) => ["p", "li", "dd"].includes(b.tag)).reduce((a, b) => a + (unexempt(b.text).replace(/Source:/g, "").match(/:\s+[a-z]/g) || []).length, 0);
  const questions = prose.filter((b) => ["p", "li", "dd", "figcaption"].includes(b.tag) && !b.el.closest("summary, details > summary, h1, h2, h3")).flatMap((b) => sentences(unexempt(b.text))).filter((s) => s.endsWith("?")).length;
  return { ...c, triads, colons, questions };
}
const failHits = (list) => list.flatMap((t) => FAIL.filter(([, re]) => re.test(unexempt(t))).map(([name]) => `${name}: "${t.slice(0, 120)}"`));
const formHits = (list) => list.flatMap((t) => sentences(unexempt(t))).filter((s) => (((/\bfree\b/i.test(s) && /\bminutes\b/i.test(s)) || /\bgrace period\b/i.test(s)) && !FREE_FORMS.includes(s)) || (/\btrack\b/i.test(s) && /\bflight\b/i.test(s) && !TRACK_FORMS.includes(s)));
const shapes = {};

for (const p of pages) {
  const all = texts(p);
  check(`${p.file}: no word or phrase of the fail list (test/fixtures/prose-words.json)`, () => assert.deepEqual([...new Set(failHits(all))], []));
  check(`${p.file}: no em dash, en dash or semicolon in visible copy, attributes, metas or json-ld`, () => {
    const bad = [p.title, ...p.metas, ...p.attrs, ...p.ld, p.visible].filter((t) => /[—–;]/.test(t)).map((t) => t.slice(Math.max(0, t.search(/[—–;]/) - 40), t.search(/[—–;]/) + 20));
    assert.deepEqual(bad, []);
  });
  check(`${p.file}: at most one "rather than" or "instead" between two H2s`, () => {
    const main = p.body.querySelector("main");
    if (!main) return;
    const h2s = [...main.querySelectorAll("h2")];
    const seg = new Map();
    for (const b of p.blocks.filter((x) => !x.exempt && main.contains(x.el))) {
      const k = h2s.filter((h) => h.compareDocumentPosition(b.el) & 4).length;
      seg.set(k, (seg.get(k) || 0) + (unexempt(b.text).match(CONTRAST) || []).length);
    }
    assert.deepEqual([...seg].filter(([, n]) => n > 1).map(([k, n]) => `${k ? h2s[k - 1].textContent.trim() : "before the first h2"}: ${n}`), []);
  });
  check(`${p.file}: no "X, not Y" outside the map caption`, () => assert.deepEqual(all.map((t) => t.split(MAP_CAPTION).join(" ")).flatMap((t) => unexempt(t).match(NOT_Y) || []), []));
  check(`${p.file}: "three hour minimum" only inside the exempt strings`, () => assert.deepEqual(all.filter((t) => /three hour minimum/i.test(unexempt(t))), []));
  check(`${p.file}: no paragraph holds "every" twice`, () => assert.deepEqual([...p.blocks.filter((b) => !b.exempt && ["p", "li", "dd"].includes(b.tag)).map((b) => b.text), ...p.ld].filter((t) => (unexempt(t).match(/\bevery\b/gi) || []).length > 1), []));
  check(`${p.file}: free waiting and flight tracking sentences use the forms of 6.4`, () => {
    const meta = new Set(p.metas);
    assert.deepEqual([...new Set(formHits([p.title, ...p.attrs, ...p.ld.filter((t) => !meta.has(t)), ...p.blocks.filter((b) => !b.exempt).map((b) => b.text)].filter((t) => !ALLOW.has(t))))], []);
    const pairs = [...p.body.querySelectorAll("dt")].filter((dt) => !(p.file === "rates.html" && dt.closest("#add-ons"))).map((dt) => [squash(dt.textContent), dt.nextElementSibling && squash(dt.nextElementSibling.textContent)]);
    for (const li of p.body.querySelectorAll("li")) { const b = li.querySelector(":scope > b, :scope > strong"), s = li.querySelector(":scope > span"); if (b && s) pairs.push([squash(b.textContent), squash(s.textContent)]); }
    const forms = AIRLINE_ONLY.has(p.file) ? AIRLINE_VALUE_FORMS : VALUE_FORMS;
    assert.deepEqual(pairs.filter(([k, v]) => (forms[k] && v !== forms[k]) || (/^free waiting./i.test(k) && k !== "Free waiting")), []);
    if (AIRLINE_ONLY.has(p.file)) assert.deepEqual(Object.keys(forms).map((k) => pairs.filter(([a]) => a === k).length), [1, 1], "the airline-scoped free waiting and flight tracking facts are on the page");
  });
  const area = /^locations\/([a-z-]+)\.html$/.exec(p.file);
  if (area && AREAS[area[1]]) {
    const [name, the, inArea] = AREAS[area[1]];
    const The = the ? the[0].toUpperCase() + the.slice(1) : "";
    check(`${p.file}: the area page slots use the labels of 6.4`, () => {
      const main = p.body.querySelector("main");
      const brows = [...main.querySelectorAll("p.eyebrow")].filter((e) => !e.closest("form")).map((e) => squash(e.textContent));
      assert.deepEqual(brows, SLOT_EYEBROWS);
      const h2 = [...main.querySelectorAll("h2")].filter((e) => !e.closest("form")).map((e) => squash(e.textContent));
      for (const want of [`Airport routes from ${the}${name}`, `${The}${name} by the hour`, `Questions about ${name} pickups`, `Areas next to ${the}${name}`, `Book a car ${inArea}`]) assert.ok(h2.includes(want), `no H2 "${want}" in ${h2.join(" | ")}`);
      assert.ok(h2.filter((t) => t.startsWith("Other trips from")).every((t) => t === `Other trips from ${the}${name}`), "the other trips heading differs");
      const links = [...main.querySelectorAll("a.lnk")].map((a) => squash(a.textContent));
      assert.ok(links.includes("All service areas") && links.includes("Book by the hour"), links.join(" | "));
    });
  }
  if (SLOTS[p.file]) check(`${p.file}: the template slots use their labels`, () => {
    const main = p.body.querySelector("main");
    assert.deepEqual([...main.querySelectorAll("p.eyebrow")].filter((e) => !e.closest("form")).map((e) => squash(e.textContent)), SLOTS[p.file]);
    const h2 = [...main.querySelectorAll("h2")].filter((e) => !e.closest("form")).map((e) => squash(e.textContent));
    for (const want of SLOT_H2[p.file]) assert.ok(h2.includes(want), `no H2 "${want}" in ${h2.join(" | ")}`);
  });
  check(`${p.file}: no sentence of 8 or more words is said twice on the page, outside the one wording per fact of 6.4`, () => {
    const seen = new Map();
    const linkOnly = (b) => { const a = b.el.querySelectorAll("a"); return a.length === 1 && squash(a[0].textContent) === squash(b.el.textContent); };
    for (const b of p.blocks.filter((x) => !x.exempt && PROSE.has(x.tag) && x.el.closest("main") && !x.el.closest("#book-form, nav") && !linkOnly(x))) for (const t of sentences(unexempt(b.text))) {
      if (t.split(/\s+/).length < 8 || FORMS_64.has(t) || FREE_FORMS.includes(t) || TRACK_FORMS.includes(t)) continue;
      seen.set(t, (seen.get(t) || 0) + 1);
    }
    assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([t, n]) => `${n}x ${t}`), []);
  });
  check(`${p.file}: a static WhatsApp button that carries the booking message reads Book on WhatsApp, the closing card ends with Book a car and Book on WhatsApp`, () => {
    const main = p.body.querySelector("main");
    if (!main) return;
    const wa = [...main.querySelectorAll('a.btn[href^="https://wa.me/16467750556?text=Hi%20NYC%20LUX%20RIDE%2C%20I%27d%20like%20to%20book"]')].filter((a) => !a.closest("#book-form")).map((a) => squash(a.textContent));
    assert.deepEqual(wa.filter((t) => t !== "Book on WhatsApp"), []);
    const close = main.querySelector(".section--close .btn-row");
    if (close) assert.deepEqual([...close.querySelectorAll("a.btn")].map((a) => squash(a.textContent)), ["Book a car", "Book on WhatsApp"]);
  });
  shapes[p.file] = shapeOf(p);
}

check("scripts and api/_copy.mjs: no fail-list word, dash, semicolon, X not Y, every twice or other free waiting and flight tracking wording", () => {
  const s = SCRIPTS.strings;
  assert.deepEqual([...new Set(failHits(s))], [], "fail list");
  assert.deepEqual(s.filter((t) => /[—–;]/.test(t)), [], "dash or semicolon");
  assert.deepEqual(s.map((t) => t.split(MAP_CAPTION).join(" ")).flatMap((t) => unexempt(t).match(NOT_Y) || []), [], "X, not Y");
  assert.deepEqual(s.filter((t) => /three hour minimum/i.test(unexempt(t))), [], "three hour minimum");
  assert.deepEqual(s.filter((t) => (unexempt(t).match(/\bevery\b/gi) || []).length > 1), [], "every twice");
  assert.deepEqual([...new Set(formHits(s))], [], "6.4 forms");
});
shapes.scripts = { ...counts(SCRIPTS.strings), triads: 0, colons: 0, questions: SCRIPTS.strings.flatMap((t) => sentences(unexempt(t))).filter((x) => x.endsWith("?")).length };

const KEYS = ["so", "sostart", "which", "places", "triads", "colons", "questions"];
if (RECORD) {
  writeFileSync(SHAPE_FILE, JSON.stringify(Object.fromEntries(Object.entries(shapes).sort(([a], [b]) => a.localeCompare(b))), null, 1) + "\n");
  console.log(`  recorded ${SHAPE_FILE}`);
} else {
  check("test/fixtures/prose-shape.json covers every page and the scripts", () => assert.deepEqual(Object.keys(SHAPE).sort(), Object.keys(shapes).sort()));
  for (const [file, got] of Object.entries(shapes)) {
    check(`${file}: shape counts at or under test/fixtures/prose-shape.json`, () => {
      const want = SHAPE[file] || {};
      assert.deepEqual(KEYS.filter((k) => got[k] > (want[k] ?? 0)).map((k) => `${k} ${got[k]} > ${want[k] ?? 0}`), []);
    });
  }
}

const proseSentences = (p) => p.blocks.filter((b) => !b.exempt && PROSE.has(b.tag) && b.el.closest("main") && !b.el.closest("#book-form") && b.text.split(" ").length >= 4).flatMap((b) => sentences(unexempt(b.text))).filter((s) => s.split(" ").length >= 2);
const grade = (ss) => { if (!ss.length) return null; const w = ss.reduce((a, s) => a + s.split(/\s+/).length, 0); const y = ss.flatMap((s) => s.split(/\s+/)).reduce((a, x) => a + syll(x), 0); return 0.39 * (w / ss.length) + 11.8 * (y / w) - 15.59; };
console.log("\nReport (never fails)");
let total = 0, over = 0, every = 0, passive = 0;
const repeat = new Map();
for (const p of pages) {
  const ss = proseSentences(p);
  total += ss.length;
  over += ss.filter((s) => s.split(/\s+/).length > 25).length;
  every += ss.filter((s) => /\bevery\b/i.test(s)).length;
  const pv = ss.reduce((a, s) => a + (s.match(PASSIVE) || []).length, 0);
  passive += pv;
  for (const s of ss) { const k = s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); if (k.split(" ").length < 5) continue; if (!repeat.has(k)) repeat.set(k, { s, pages: new Set() }); repeat.get(k).pages.add(p.file); }
  const words = REPORT.map(([name, re]) => [name, texts(p).reduce((a, t) => a + (unexempt(t).match(re) || []).length, 0)]).filter(([, n]) => n);
  const g = grade(ss);
  const exempt = EXEMPT.filter((e) => p.visible.includes(e)).length + p.blocks.filter((b) => b.exempt).length;
  const metaForms = formHits(p.metas).length;
  if (/^(locations|blog)\//.test(p.file) || words.length || exempt || metaForms) console.log(`  ${p.file}: grade ${g === null ? "-" : g.toFixed(1)}, ${ss.length} sentences, ${ss.length ? Math.round((100 * ss.filter((s) => s.split(/\s+/).length > 25).length) / ss.length) : 0}% over 25 words, ${pv} passives with no actor${words.length ? ", report words " + words.map(([n, c]) => `${n} ${c}`).join(", ") : ""}${exempt ? `, ${exempt} exempt strings or blocks` : ""}${metaForms ? `, ${metaForms} meta sentence(s) with free waiting or flight tracking outside the 6.4 forms (metas follow 6.9 only)` : ""}`);
}
console.log(`  site: ${total} sentences, ${(100 * over / total).toFixed(1)}% over 25 words, "every" in ${(100 * every / total).toFixed(1)}%, ${passive} passives with no actor`);
console.log("  most repeated sentences across pages:");
for (const r of [...repeat.values()].filter((r) => r.pages.size > 1).sort((a, b) => b.pages.size - a.pages.size).slice(0, 5)) console.log(`    ${r.pages.size} pages: ${r.s.slice(0, 140)}`);

if (failures) {
  console.error(`\n${failures} prose shape assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll prose shape tests passed");
process.exit(0);
