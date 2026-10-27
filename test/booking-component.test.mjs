import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const load = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { CLASSES, VEHICLES, HOURS, PASSENGERS } = await load("_rates.mjs");
const { HEADINGS, REASONS, ERROR_BLOCK, ERRORS, NOTES, POLICY, LABELS } = await load("_copy.mjs");
const { PLACE_LIST, norm } = await load("_places.mjs");
const { COUNTRIES, MAIN_BY_DIAL, TRUNK } = await load("_phone.mjs");

const HOSTS = ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html"];
const AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"];
const SEARCH_HOSTS = ["services.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", "car-service-with-car-seat-nyc.html", ...AREAS.map((a) => `locations/${a}.html`)];
const WIDGET = [...HOSTS, ...SEARCH_HOSTS];
const BANNER_PAGES = [...SEARCH_HOSTS, "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html"];
const AIRPORT_PAGES = { "locations/jfk-airport.html": ["John F. Kennedy (JFK)", "jfk"], "locations/laguardia-airport.html": ["LaGuardia (LGA)", "lga"], "locations/newark-airport.html": ["Newark Liberty (EWR)", "ewr"] };
const START = '<form id="book-form" class="bk" method="post" action="/api/book" data-step="search" aria-label="Book a car">';
const SEARCH_START = '<form id="book-form" class="bk bk--go" method="get" action="/book#from-search" data-step="search" aria-label="Book a car">';
const VIEW = '<button class="btn bk-js-only" id="bk-view" type="submit" name="action" value="options">Book your ride<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow"></use></svg></button>';
const SEARCH_VIEW = '<button class="btn" id="bk-view" type="submit" name="action" value="options">Book your ride<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow"></use></svg></button>';
const CUT_FROM = '<div class="bk-sum" id="bk-sum" data-show="side">';
const CUT_TO = '<input type="hidden" id="bk-nonce" name="nonce">';
const PH = "Airport, hotel or address";
const WA_DEFAULT = "https://wa.me/16467750556?text=Hi%20NYC%20LUX%20RIDE%2C%20I%27d%20like%20to%20book%20a%20ride.";
const DETAILS = ["rider", "name", "email", "phone", "phone_cc", "reach", "pname", "pphone", "pphone_cc", "sign", "notes"];
const FIELDS = ["trip_type", "from_text", "from_id", "from_ticket", "stop1_text", "stop1_id", "stop1_ticket", "stop2_text", "stop2_id", "stop2_ticket", "to_text", "to_id", "to_ticket", "date", "time", "flight", "return", "return_date", "return_time", "return_flight", "passengers", "hours", "class", "vehicle", "meet", "tip", "tip_amount", "action", "nonce", "nlr_hp", ...DETAILS];
const SHOW = ["one", "hour", "stop1", "stop2", "return", "from-airport", "from-priced", "to-airport", "hour-suv", "options", "details", "side", "other", "meet"];
const ENDS = { from: "Pickup location", stop1: "Stop 1", stop2: "Stop 2", to: "Drop-off location" };
const NOJS = ["(one way)", "(by the hour)", " for airport pickups", " (airport pickups)", "(return trip)", "(return trip, optional)", "(by the hour, Business SUV)", "(airport pickups)", "(one way, optional)", "(if someone else is riding)", "(meet and greet)", "By email or WhatsApp. Put the pickup, drop-off, date and time in the message.", "If someone else is riding, your chauffeur contacts them on the day of the ride."];
const STEP1_IDS = ["bk-search", "bk-mode", "bk-one", "bk-hour", "e-trip_type", "bk-adds", "bk-addstop", "bk-addret", "bk-hours-f", "bk-hours", "bk-date-f", "bk-date-l", "bk-date", "bk-date-btn", "bk-cal", "bk-flight-f", "bk-flight", "bk-flight-status", "bk-time-f", "bk-time-l", "bk-time", "bk-time-btn", "bk-tm", "bk-time-h", "bk-ret-c", "bk-ret", "bk-ret-f", "bk-ret-sum", "bk-rdate-f", "bk-rdate-l", "bk-rdate", "bk-rdate-btn", "bk-rtime-f", "bk-rtime", "bk-rflight-f", "bk-rflight", "bk-rflight-status", "bk-rmret", "bk-view", "bk-status", "bk-assure", "bk-stop1-h", "bk-stop2-h"];
const END_IDS = Object.keys(ENDS).flatMap((e) => ["-f", "", "-id", "-ticket", "-area", "-x", "-pop", "-list"].map((s) => `bk-${e}${s}`)).concat(["bk-stop1-rm", "bk-stop2-rm"]);
const STEP2_IDS = ["bk-opts", "bk-sum", "bk-edit", "bk-opt-h", "bk-wait", "bk-map", "bk-drive", "bk-pax-f", "bk-pax", "bk-pax-h", "bk-cards", ...Object.keys(CLASSES).flatMap((c) => [`bk-c-${c}`, `bk-p-${c}`]), ...Object.keys(CLASSES).flatMap((c) => [`bk-n-${c}`, `bk-m-${c}`, `bk-s-${c}`]), "bk-qline", "bk-arrive", "bk-vehicle-f", "bk-vehicle", "bk-meet-f", "bk-meet-no", "bk-meet", "bk-meet-p", "bk-meet-h", "bk-meet-t57", "bk-tip", "bk-tip-opts", "bk-tipamt-f", "bk-tipamt", "bk-tipamt-h", "e-tip_amount", "bk-tip-h", "bk-result", "price", "price-h", "price-lines", "price-total", "price-notes", "bk-act", "bk-tot", "bk-tot-l", "bk-tot-v", "quote", "bk-qnotes-f", "bk-qnotes", "bk-qnotes-h", "q-body", "q-wa", "q-mail", "q-fix", "q-retry", "q-sent", "bk-route", "bk-route-n", "bk-policy", "bk-go", "bk-nopay", "bk-under", "bk-submit", "e-form", "bk-hp", "bk-nonce", "bk-places", "bk-more", "bk-incl-h", "bk-incl", "bk-pills", ...Object.keys(CLASSES).map((c) => `bk-pp-${c}`), "bk-side", "bk-choice", "bk-consent", "bk-next", "bk-bar", "bk-bar-name", "bk-bar-total", "bk-bar-q", "bk-bar-go", "bk-bar-mail"];
const STEP3_IDS = ["bk-det", "bk-back", "bk-det-h", "bk-who", "bk-r-other", "e-rider", "bk-name-f", "bk-name", "e-name", "bk-email-f", "bk-email", "e-email", "bk-phone-f", "bk-phone-cc", "bk-phone-face", "bk-phone", "bk-phone-h", "e-phone", "bk-reach", "bk-reach-phone", "bk-reach-wa", "e-reach", "bk-pname-f", "bk-pname", "e-pname", "bk-pphone-f", "bk-pphone-cc", "bk-pphone-face", "bk-pphone", "e-pphone", "bk-dflight-f", "bk-dflight", "bk-sign-f", "bk-sign", "bk-sign-h", "bk-notes-f", "bk-notes", "bk-notes-h", "bk-check", "bk-check-h", "bk-check-edit", "bk-check-route", "bk-check-rows", "bk-errs", "bk-email-s", "bk-phone-s", "bk-pphone-s", "bk-signcard", "bk-signname", "bk-notes-add", "bk-next3"];
const REMOVED_IDS = ["bk-help", "bk-wa", "bk-helpline", "bk-hl-wa", "bk-hl-h", "bk-noflight", "bk-addflight", "bk-from-address", "bk-to-address", "e-from_address", "e-to_address", "bk-class", "bk-estimate", "q-switch", "q-switch-fare", "q-class-airport", "q-first-lga", "q-call", "bk-bar-wa", "bk-bar-tel", "bk-msg", "bk-steps", "bk-r-me", "bk-email-h", "bk-notes-add-h"];
const ICON = (id) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
const MEET = ['<fieldset class="bk-meet" id="bk-meet-f" data-show="from-priced">', '<legend>Where we meet<span class="bk-nojs"> (airport pickups)</span></legend>', '<label class="bk-mrow" for="bk-meet-no"><input type="radio" id="bk-meet-no" name="meet" value="" checked><span class="bk-mrow__t">At the curb or pickup area</span><span class="bk-mrow__p">Included</span><span class="bk-mrow__s">Your chauffeur confirms the exact spot by phone or WhatsApp once you have your bags.</span></label>', '<label class="bk-mrow" for="bk-meet"><input type="radio" id="bk-meet" name="meet" value="1"><span class="bk-mrow__t">Inside the terminal with a name sign</span><span class="bk-mrow__p" id="bk-meet-p"></span><span class="bk-mrow__s" id="bk-meet-h"><span id="bk-meet-bc">Your chauffeur waits inside near baggage claim. </span>Airport parking is charged after the ride.</span></label>', '<p class="bk-mrow__x" id="bk-meet-t57" hidden>For now, car service pickups at Terminals 5 and 7 use a lot at the Howard Beach AirTrain station, a free AirTrain ride from the terminal.</p>', "</fieldset>"].join("\n");
const INCL = `<ul class="incl" id="bk-incl" role="list" aria-labelledby="bk-incl-h"><li data-show="from-airport">${ICON("i-plane-arrive")}<span>Free waiting</span> <small>after you land</small></li><li>${ICON("i-clock")}<span>15 minutes of free waiting</span> <small>at other pickups</small></li><li data-show="from-airport">${ICON("i-shield")}<span>Live flight tracking</span></li><li>${ICON("i-child")}<span>Infant, toddler and booster seats</span> <small>free on request</small></li><li>${ICON("i-wifi")}<span>Free Wi-Fi and charging ports</span> <small>in the executive fleet</small></li><li>${ICON("i-phone")}<span>We answer</span> <small>24 hours a&nbsp;day, every day</small></li></ul>`;
const INCL_FACTS = ["Free waiting after you land", "15 minutes of free waiting at other pickups", "Live flight tracking", "Infant, toddler and booster seats free on request", "Free Wi-Fi and charging ports in the executive fleet", "We answer 24 hours a day, every day"];
const PILLS = '<div class="bk-pills bk-js-only" id="bk-pills" aria-hidden="true"><button class="bk-pill" type="button" tabindex="-1" data-c="suv"><span>Business SUV</span><span id="bk-pp-suv"></span></button><button class="bk-pill" type="button" tabindex="-1" data-c="premium"><span>Business Premium SUV</span><span id="bk-pp-premium"></span></button><button class="bk-pill" type="button" tabindex="-1" data-c="first"><span>First Class</span><span id="bk-pp-first"></span></button><button class="bk-pill" type="button" tabindex="-1" data-c="sedan"><span>Sedan &amp; Electric</span><span id="bk-pp-sedan"></span></button><button class="bk-pill" type="button" tabindex="-1" data-c="sprinter"><span>Luxury Sprinter</span><span id="bk-pp-sprinter"></span></button></div>';
const BAR = `<div class="bk-bar bk-js-only" id="bk-bar" data-show="side"><p class="bk-bar__sum" aria-hidden="true"><span id="bk-bar-name"></span><span id="bk-bar-total"></span></p><p class="bk-bar__q" id="bk-bar-q"></p><button class="btn" id="bk-bar-go" type="button" aria-describedby="bk-nopay">Book and pay online</button><a class="btn" id="bk-bar-mail" href="mailto:info@nycluxride.com">Email to reserve</a></div>`;
const EXT = `${ICON("i-external")}<span class="sr-only"> (opens in a new tab)</span>`;
const CONSENT = `<p class="bk-consent" id="bk-consent" data-show="details">On the Stripe payment page you accept the <a href="/terms-of-service#payments" target="_blank" rel="noopener">terms of service${EXT}</a> and the <a href="/rates#cancellation" target="_blank" rel="noopener">rates and cancellation terms${EXT}</a>.</p>`;
const ASSURE = `<ul class="assure-row" id="bk-assure" role="list"><li>${ICON("i-check")}Airport prices include tolls, airport fees and taxes</li><li>${ICON("i-clock")}Free waiting after you land</li><li>${ICON("i-phone")}We answer 24 hours a day, every day</li></ul>`;
const MONITOR = "Set the pickup time to your scheduled landing time. We track your flight.";
const P1_FIRST = POLICY.cancel.slice(0, POLICY.cancel.indexOf(".") + 1);
const MODELS = { suv: "Chevrolet Suburban or similar", premium: "Cadillac Escalade ESV", first: "Mercedes-Benz S-Class or BMW 7 Series", sedan: "Cadillac Lyriq or similar", sprinter: "Limo Sprinter or Jet Sprinter" };

const nt = (s) => s.replace(/\s+/g, " ").trim();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const region = (html) => {
  const a = html.indexOf('<form id="book-form"');
  return a < 0 ? "" : html.slice(a, html.indexOf("</form>", a) + 7);
};
const revert = (f, part) => {
  if (!AIRPORT_PAGES[f]) return part;
  const [label, id] = AIRPORT_PAGES[f];
  return part
    .replace(`enterkeyhint="next" required value="${label}">`, `enterkeyhint="next" required>`)
    .replace(`id="bk-from-id" name="from_id" value="${id}"`, 'id="bk-from-id" name="from_id" value=""')
    .replace('class="field bk-flight is-shown" id="bk-flight-f"', 'class="field bk-flight" id="bk-flight-f"')
    .replace('class="bk-meet is-shown" id="bk-meet-f"', 'class="bk-meet" id="bk-meet-f"');
};
const HOURLY = [
  ['<input type="radio" id="bk-one" name="trip_type" value="one">', '<input type="radio" id="bk-one" name="trip_type" value="one" checked>'],
  ['<input type="radio" id="bk-hour" name="trip_type" value="hour" checked>', '<input type="radio" id="bk-hour" name="trip_type" value="hour">'],
  ['class="field bk-place" id="bk-to-f"', 'class="field bk-place is-shown" id="bk-to-f"'],
  ['class="bk-adds bk-js-only" id="bk-adds"', 'class="bk-adds bk-js-only is-shown" id="bk-adds"'],
  ['class="field is-shown" id="bk-hours-f"', 'class="field" id="bk-hours-f"'],
];
const HOURLY_HOSTS = ["chauffeur-service-nyc.html", "limousine-service-nyc.html"];
const revertSearch = (f, part) => (HOURLY_HOSTS.includes(f) ? HOURLY.reduce((t, [a, b]) => (t.split(a).length === 2 ? t.replace(a, b) : t + "\nmissing " + a), part) : part);
const derive = (full) => {
  const t = full.replace(START, SEARCH_START).replace(VIEW, SEARCH_VIEW);
  return t.slice(0, t.indexOf(CUT_FROM)) + t.slice(t.indexOf(CUT_TO) + CUT_TO.length);
};
function pages(dir = ROOT) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "test", "scripts", "assets", "fleet"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name.endsWith(".html")) out.push(relative(ROOT, full));
  }
  return out.sort();
}

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

const all = pages();
check("exactly one form#book-form on the 20 widget pages and on no other page, and no old trip form anywhere", () => {
  const withForm = all.filter((f) => read(f).includes('id="book-form"'));
  assert.deepEqual(withForm, [...WIDGET].sort());
  for (const f of WIDGET) assert.equal(read(f).split('<form id="book-form"').length - 1, 1, f);
  assert.deepEqual(all.filter((f) => /<form[^>]*class="trip"|(?<!bk-)trip__/.test(read(f))), []);
});

const parts = Object.fromEntries(WIDGET.map((f) => [f, region(read(f))]));
check("the start tags are exact and carry no novalidate", () => {
  for (const f of HOSTS) assert.ok(parts[f].startsWith(START), f);
  for (const f of SEARCH_HOSTS) assert.ok(parts[f].startsWith(SEARCH_START), f);
  for (const f of WIDGET) assert.doesNotMatch(parts[f], /novalidate/i, f);
});

check("the five FULL copies are byte identical after reverting the allowed airport page differences", () => {
  for (const f of HOSTS) assert.equal(revert(f, parts[f]), parts["book.html"], f);
  for (const [f, [label, id]] of Object.entries(AIRPORT_PAGES)) {
    assert.ok(parts[f].includes(`enterkeyhint="next" required value="${label}">`), `${f} pickup value`);
    assert.ok(parts[f].includes(`id="bk-from-id" name="from_id" value="${id}"`), `${f} from_id`);
    assert.ok(parts[f].includes('class="bk-meet is-shown" id="bk-meet-f"'), `${f} meet`);
  }
  assert.doesNotMatch(parts["book.html"], /id="bk-from"[^>]* value=/);
});

check("the 15 SEARCH copies equal the markup derived from book.html, after reverting the hourly start of chauffeur-service-nyc.html", () => {
  const want = derive(parts["book.html"]);
  assert.ok(!want.includes('id="bk-sum"') && !want.includes('id="bk-nonce"') && !want.includes("bk-hp") && want.includes('<datalist id="bk-places">') && want.includes('id="bk-assure"') && !want.includes('id="bk-help"'));
  for (const f of SEARCH_HOSTS) assert.equal(revertSearch(f, parts[f]), want, f);
  assert.ok(HOURLY_HOSTS.every((f) => parts[f] !== want && parts[f].includes('<input type="radio" id="bk-hour" name="trip_type" value="hour" checked>')) && parts["services.html"] === want);
});

check("index.html keeps the component directly inside the hero slot, the 18 banner pages inside div.banner__book", () => {
  const slot = (f, open) => {
    const html = read(f), a = html.indexOf('<form id="book-form"');
    assert.ok(html.slice(0, a).endsWith(`${open}\n`), `${f}: wrapper start tag on the line before the form`);
    assert.ok(html.slice(a + parts[f].length).startsWith("\n</div>\n"), `${f}: wrapper end tag on the line after the form`);
  };
  slot("index.html", '<div class="hero__book">');
  for (const f of BANNER_PAGES) slot(f, '<div class="banner__book">');
});

const doc = new JSDOM(read("book.html")).window.document;
const $ = (id) => doc.getElementById(id);
const form = $("book-form");
check("every id of the contract is present, the removed ids are gone, the notes sit outside the form", () => {
  assert.deepEqual([...STEP1_IDS, ...END_IDS, ...STEP2_IDS, ...STEP3_IDS].filter((id) => !$(id)), []);
  assert.deepEqual(REMOVED_IDS.filter((id) => $(id)), []);
  for (const id of ["resume", "restored", "retnote"]) assert.ok($(id) && !form.contains($(id)) && $(id).matches("div.notice.bk-note[role=status]"), id);
  assert.ok($("from-search") && !form.contains($("from-search")) && $("from-search").matches("p.bk-note"));
  assert.equal(nt($("resume").textContent), "Payment not completed. Nothing was charged. Your details are still here. Book and pay online when you're ready.Book and pay online");
  assert.equal(nt($("from-search").textContent), "JavaScript is off in your browser, and your trip didn't carry over. Please enter it again below.");
});

check("document order of the form, step 1, step 2, step 3, the three ways to finish, the information blocks and the summary card with the route map first in it, above the price (owner changes 2 and 3)", () => {
  const ids = (el) => [...el.children].map((e) => e.id || e.className);
  assert.deepEqual(ids(form), ["bk-search", "bk-assure", "bk-sum", "bk-edit", "bk-opts", "bk-det", "bk-act", "bk-more", "bk-next3", "bk-side", "bk-drive", "bk-hp", "bk-nonce", "bk-places"]);
  assert.deepEqual(ids($("bk-search")), ["bk-mode", "e-trip_type", "bk-from-f", "bk-stop1-f", "bk-stop2-f", "bk-to-f", "bk-adds", "bk-hours-f", "bk-date-f", "bk-flight-f", "bk-time-f", "bk-ret-c", "bk-ret-f", "bk-view", "bk-status"]);
  assert.deepEqual(ids($("bk-opts")), ["bk-opt-h", "bk-pax-f", "bk-pax-h", "bk-cards", "bk-vehicle-f", "bk-pills"]);
  assert.deepEqual(ids($("bk-act")), ["bk-tip", "bk-meet-f", "bk-sign-f", "bk-check", "bk-tot", "quote", "bk-go", "q-body"]);
  assert.deepEqual(ids($("bk-more")), ["bk-arrive", "bk-incl-h", "bk-incl"]);
  assert.deepEqual(ids($("bk-det")), ["bk-back", "bk-det-h", "bk-errs", "bk-who", "e-rider", "bk-pname-f", "bk-pphone-f", "bk-other-h", "bk-name-f", "bk-email-f", "bk-phone-f", "bk-reach", "e-reach", "bk-dflight-f", "bk-notes-add", "bk-notes-f"]);
  const pay = $("bk-side").querySelector(":scope > .bk-pay");
  assert.deepEqual(ids($("bk-side")), ["bk-map", "bk-pay"]);
  assert.deepEqual(ids(pay), ["bk-wait", "bk-choice", "bk-route", "bk-route-n", "bk-qline", "bk-result", "bk-policy", "bk-bar"]);
  assert.deepEqual(ids($("bk-result")), ["price"]);
  assert.deepEqual(ids($("bk-go")), ["bk-next", "bk-submit", "q-mail", "q-wa", "bk-nopay", "bk-consent", "bk-under", "q-sent", "e-form"]);
  assert.deepEqual(ids($("quote")).slice(-3), ["q-error", "q-fix", "bk-qnotes-f"]);
  assert.deepEqual([$("bk-sum").dataset.show, $("bk-edit").dataset.show, $("bk-side").dataset.show, $("bk-det").dataset.show, $("bk-tip").dataset.show, $("bk-submit").dataset.show, $("bk-next").dataset.show, $("bk-bar").dataset.show, $("bk-policy").dataset.show, $("bk-nopay").dataset.show, $("bk-under").dataset.show, $("bk-act").dataset.show, $("bk-more").dataset.show, $("bk-next3").dataset.show, $("bk-meet-f").dataset.show, $("bk-check").dataset.show], ["side", "side", "side", "details", "details", "details", "options", "side", "side", "options", "details", "side", "options", "details", "from-priced", "details"]);
  assert.deepEqual([...$("bk-incl").children].map((li) => li.dataset.show || ""), ["from-airport", "", "from-airport", "", "", ""]);
  assert.deepEqual([...$("bk-incl").children].map((li) => nt(li.textContent)), INCL_FACTS, "each tile still reads as the fact it stated as a list line");
  assert.deepEqual([...$("bk-incl").children].map((li) => [...li.children].map((c) => c.tagName.toLowerCase()).join(" ")), ["svg span small", "svg span small", "svg span", "svg span small", "svg span small", "svg span small"], "an icon, a caption and the small second line of the tile language");
  for (const f of WIDGET) assert.ok(parts[f].includes(' data-step="search" '), f);
});

check("every named control sends a request field of the contract, the flight mirror sends nothing", () => {
  const names = [...form.querySelectorAll("[name]")].map((c) => c.getAttribute("name"));
  assert.deepEqual([...new Set(names.filter((n) => !FIELDS.includes(n)))], []);
  assert.deepEqual(DETAILS.filter((n) => !names.includes(n)), []);
  assert.deepEqual([...form.querySelectorAll("button[type=submit]")].map((b) => [b.id, b.name, b.value]), [["bk-view", "action", "options"], ["bk-submit", "action", "pay"]]);
  assert.equal($("bk-dflight").hasAttribute("name"), false);
});

check("each place box has its label, input, hidden fields, badge, clear button and listbox", () => {
  for (const [end, label] of Object.entries(ENDS)) {
    const box = $(`bk-${end}-f`), input = $(`bk-${end}`);
    assert.ok(box.matches(`div.field.bk-place[data-end="${end}"]`), end);
    assert.equal(nt(box.querySelector(`label[for="bk-${end}"]`).firstChild.textContent), label, end);
    assert.deepEqual(["type", "maxlength", "autocomplete", "list", "placeholder"].map((a) => input.getAttribute(a)), ["text", "200", "off", "bk-places", PH], end);
    assert.equal(input.name, `${end}_text`);
    assert.equal(input.hasAttribute("required"), end === "from", end);
    for (const s of ["id", "ticket"]) assert.ok($(`bk-${end}-${s}`).matches(`input[type=hidden][name="${end}_${s}"][value=""]`), `${end} ${s}`);
    assert.ok($(`bk-${end}-area`).matches("span.bk-badge.bk-js-only:not([aria-hidden])") && $(`bk-${end}-area`).textContent === "");
    assert.ok($(`bk-${end}-x`).matches("button.bk-x[type=button][hidden]") && $(`bk-${end}-x`).querySelector('use[href="#i-close"]'));
    assert.equal(nt($(`bk-${end}-x`).querySelector(".sr-only").textContent), `Clear ${label}`);
    assert.ok($(`bk-${end}-pop`).matches("div.bk-pop[hidden]") && $(`bk-${end}-list`).parentElement === $(`bk-${end}-pop`));
    assert.equal($(`bk-${end}-list`).getAttribute("role"), "listbox");
    assert.equal($(`bk-${end}-list`).getAttribute("aria-label"), `${label} suggestions`);
    assert.deepEqual([box.lastElementChild.previousElementSibling.id, box.lastElementChild.id], [`e-${end}`, `e-${end}-zip`]);
    assert.ok($(`e-${end}-zip`).matches("p.bk-e.field__hint") && nt($(`e-${end}-zip`).textContent) === "Add the ZIP code after the name, like this: The New York EDITION, 10010.", end);
  }
  assert.equal($("bk-stop1-f").dataset.show, "stop1");
  assert.ok($("bk-stop2-f").matches('.bk-js-only[data-show="stop2"]'));
  assert.ok($("bk-to-f").matches('.is-shown[data-show="one"]'));
  assert.equal(nt($("bk-stop1-rm").textContent), "Remove stop 1");
  assert.equal(nt($("bk-stop2-rm").textContent), "Remove stop 2");
  for (const id of ["bk-stop1-rm", "bk-stop2-rm", "bk-rmret"]) assert.ok($(id).firstElementChild.matches('svg.icon[aria-hidden="true"]') && $(id).querySelector('use[href="#i-close"]'), id);
});

check("labels, qualifiers and texts of step 1 are exact", () => {
  const label = (id) => nt(form.querySelector(`label[for="${id}"]`).textContent);
  assert.deepEqual(["bk-stop1", "bk-to", "bk-hours", "bk-date", "bk-flight", "bk-time", "bk-ret", "bk-rdate", "bk-rtime", "bk-rflight"].map(label), ["Stop 1 (one way, optional)", "Drop-off location (one way)", "Duration (by the hour)", "Date", "Flight number (optional) for airport pickups", "Pickup time", "Add a return trip (one way)", "Return date (return trip)", "Return pickup time (return trip)", "Return flight number (return trip, optional)"]);
  assert.equal($("bk-flight").labels[0].innerHTML, 'Flight number <span class="bk-opt">(optional)</span><span class="bk-nojs"> for airport pickups</span>');
  assert.deepEqual([...form.querySelectorAll(".bk-nojs")].filter((e) => e.tagName === "SPAN").map((e) => e.textContent).filter((t) => !NOJS.includes(t.replace(/^ \(/, "(").replace(/^\((.*)\)$/, "($1)")) && !NOJS.includes(t)), []);
  assert.equal(nt($("bk-one").parentElement.textContent), "One way");
  assert.equal(nt($("bk-hour").parentElement.textContent), "By the hour");
  assert.ok($("bk-one").checked && !$("bk-hour").checked);
  assert.equal(nt($("bk-mode").querySelector("legend.sr-only").textContent), "Trip type");
  assert.equal($("e-trip_type").previousElementSibling, $("bk-mode"));
  assert.deepEqual([nt($("bk-addstop").textContent), nt($("bk-addret").textContent)], ["Add stop", "Add return trip"]);
  assert.ok($("bk-addstop").querySelector('use[href="#i-plus"]') && $("bk-addret").querySelector('use[href="#i-plus"]'));
  assert.deepEqual(["aria-expanded", "aria-controls"].map((a) => $("bk-addret").getAttribute(a)), ["false", "bk-ret-f"]);
  assert.ok($("bk-adds").matches('.bk-js-only.is-shown[data-show="one"]'));
  assert.equal($("bk-hours-f").dataset.show, "hour");
  assert.equal(nt($("bk-date-btn").textContent), "Select a date");
  assert.deepEqual(["type", "aria-haspopup", "aria-expanded", "aria-labelledby"].map((a) => $("bk-date-btn").getAttribute(a)), ["button", "dialog", "false", "bk-date-l bk-date-btn"]);
  assert.deepEqual(["type", "aria-haspopup", "aria-expanded", "aria-labelledby"].map((a) => $("bk-rdate-btn").getAttribute(a)), ["button", "dialog", "false", "bk-rdate-l bk-rdate-btn"]);
  assert.ok($("bk-date-btn").matches(".bk-pick.bk-js-only") && $("bk-date-btn").querySelector('use[href="#i-calendar"]'));
  assert.ok($("bk-cal").matches('div.bk-cal[role=dialog][aria-label="Choose a date"][hidden]'));
  assert.equal(nt($("bk-time-btn").textContent), "Select a time");
  for (const id of ["bk-time", "bk-rtime"]) {
    assert.deepEqual(["type", "aria-haspopup", "aria-labelledby", "aria-expanded"].map((a) => $(`${id}-btn`).getAttribute(a)), ["button", "dialog", `${id}-l ${id}-btn`, "false"], id);
    assert.ok($(`${id}-f`).matches("div.field.bk-time") && $(`${id}-l`).matches(`label[for="${id}"]`) && $(`${id}-btn`).matches("button.bk-pick.bk-js-only") && $(`${id}-btn`).querySelector('use[href="#i-clock"]') && $(`${id}-btn`).previousElementSibling === $(id) && $(id).matches("select"), id);
    assert.deepEqual([...$(id).options].map((o) => [o.value, o.textContent]).slice(0, 3).concat([...$(id).querySelectorAll("optgroup")].map((g) => [g.label, g.children.length])), [["", "Select a time"], ["00:00", "12:00 AM"], ["00:10", "12:10 AM"], ["Night", 36], ["Morning", 36], ["Afternoon", 36], ["Evening", 36]], id);
  }
  assert.ok($("bk-tm").matches('div.bk-pop.bk-tm[role=dialog][aria-label="Choose a time"][hidden]') && $("bk-tm").previousElementSibling === $("bk-time-btn") && $("bk-tm").innerHTML === "", "one empty time popover, filled by the script");
  assert.ok($("bk-time").matches("select[name=time][required]") && !$("bk-rtime").required);
  assert.ok($("bk-date").matches("input[type=date][name=date][required]") && $("bk-rdate").matches("input[type=date][name=return_date]"));
  assert.equal($("bk-flight-f").dataset.show, "from-airport");
  assert.equal($("bk-rflight-f").dataset.show, "to-airport");
  for (const id of ["bk-flight", "bk-rflight", "bk-dflight"]) assert.deepEqual(["type", "maxlength", "autocomplete", "autocapitalize", "spellcheck", "placeholder", "enterkeyhint"].map((a) => $(id).getAttribute(a)), ["text", "20", "off", "characters", "false", "For example DL 1234", "next"], id);
  for (const id of ["bk-flight-status", "bk-rflight-status"]) assert.ok($(id).matches('p.bk-fl[aria-live="polite"]'), id);
  assert.deepEqual([nt($("bk-flight-status").textContent), $("bk-rflight-status").textContent], [MONITOR, ""]);
  for (const e of Object.keys(ENDS)) assert.deepEqual(["spellcheck", "autocorrect", "enterkeyhint"].map((a) => $(`bk-${e}`).getAttribute(a)), ["false", "off", "next"], e);
  assert.ok($("bk-time-h").matches("p.field__hint.bk-js-only[hidden]") && $("bk-time-h").previousElementSibling === $("bk-tm") && $("bk-time-h").nextElementSibling === $("e-time") && $("bk-time-h").textContent === "");
  for (const n of [1, 2]) assert.ok($(`bk-stop${n}-rm`).matches("button.bk-rm.bk-js-only[type=button]") && $(`bk-stop${n}-rm`).previousElementSibling === $(`bk-stop${n}`) && $(`bk-stop${n}-h`).matches("p.field__hint[hidden]") && $(`bk-stop${n}-h`).previousElementSibling === $(`bk-stop${n}-pop`), `stop ${n}`);
  assert.ok($("bk-ret-c").matches("div.field.bk-nojs") && $("bk-ret").matches('input[type=checkbox][name=return][value="1"]'));
  assert.ok($("bk-ret-f").matches('div.bk-ret[data-show="return"]') && $("bk-ret-sum").matches("p.bk-note"));
  assert.equal(nt($("bk-rmret").textContent), "Remove return trip");
  assert.ok($("bk-view").matches("button.btn.bk-js-only[type=submit]") && nt($("bk-view").textContent) === "Book your ride");
  assert.ok($("bk-status").matches('p.bk-status.sr-only[role="status"]'));
  assert.ok(parts["book.html"].includes(`${VIEW}\n<p class="bk-status sr-only" id="bk-status" role="status"></p>`));
  assert.equal($("bk-assure").outerHTML, ASSURE);
  assert.equal($("bk-assure").previousElementSibling, $("bk-search"));
});

check("the flow carries no help row, call button or call line: WhatsApp and email live only in the three ways to finish, the request bar and the form error (owner changes 1 and 3)", () => {
  for (const id of ["bk-help", "bk-wa", "bk-helpline", "bk-hl-wa", "q-call", "bk-bar-wa", "bk-bar-tel"]) assert.equal($(id), null, id);
  assert.doesNotMatch(parts["book.html"], /No US phone|Book on WhatsApp/);
  const where = (a) => (a.closest("#e-form") ? "e-form" : a.closest("#bk-go") ? "go" : a.closest("#bk-bar") ? "bar" : "flow");
  assert.deepEqual([...form.querySelectorAll('a[href^="https://wa.me/"], a[href^="mailto:"], a[href^="tel:"]')].map((a) => (a.id || a.getAttribute("href")) + "@" + where(a)), ["q-mail@go", "q-wa@go", "mailto:info@nycluxride.com@e-form", "https://wa.me/16467750556@e-form", "bk-bar-mail@bar"]);
  for (const f of WIDGET) assert.doesNotMatch(parts[f], /tel:|Or call|>Call |775-0556|\bcall\b/i, f);
  for (const f of SEARCH_HOSTS) assert.doesNotMatch(parts[f], /wa\.me|mailto:/, f);
  for (const f of HOSTS) assert.equal(parts[f].match(/wa\.me|mailto:/g).length, 5, f);
  assert.ok(!$("bk-bar-mail").hidden && $("bk-bar").classList.contains("bk-js-only"), "the request bar's email button shows by the is-q class, the whole bar is script-only");
});


check("step 2: trip chips, Edit trip, heading, passengers, the request line, rows, vehicle, the total and the three ways to finish, then the arrival card and what is included, the pills and the bar, with Where we meet beside the gratuity of step 3", () => {
  assert.ok($("bk-opts").matches('section.bk-opts[data-show="options"][aria-labelledby="bk-opt-h"]'));
  assert.ok($("bk-sum").matches('div.bk-sum[data-show="side"]') && $("bk-sum").textContent === "");
  assert.equal($("bk-edit").outerHTML, '<button class="lnk-btn bk-js-only" id="bk-edit" type="button" data-show="side">Edit trip</button>', "Edit trip is a link button beside the trip line, no pill");
  assert.ok($("bk-opt-h").matches('h2[tabindex="-1"]') && $("bk-opt-h").innerHTML === '<span class="bk-stepno">Step 2 of 4</span> Choose your vehicle', "the step count opens the heading");
  assert.ok($("bk-wait").matches('p.bk-wait[role="status"]') && $("bk-wait").textContent === "");
  assert.ok($("bk-map").matches("figure.bk-map[hidden]") && !$("bk-map").children.length);
  assert.ok($("bk-drive").matches("p.bk-drive[hidden]"));
  assert.equal(nt(form.querySelector('label[for="bk-pax"]').textContent), "Passengers");
  assert.ok($("bk-qline").matches("p.bk-qline[hidden]") && $("bk-qline").nextElementSibling === $("bk-result") && $("bk-qline").textContent === "");
  assert.ok($("bk-cards").matches("fieldset.bk-cards") && nt($("bk-cards").querySelector("legend").textContent) === "Vehicle class");
  assert.ok($("bk-vehicle-f").matches('[data-show="hour-suv"]') && nt(form.querySelector('label[for="bk-vehicle"]').textContent) === "Vehicle (by the hour, Business SUV)");
  assert.deepEqual([...$("bk-vehicle").options].map((o) => [o.value, o.textContent, o.selected]), Object.entries(VEHICLES).filter(([, v]) => v.cls === "suv").map(([k, v], i) => [k, v.model, i === 0]));
  assert.ok($("bk-arrive").matches("div.bk-arrive[hidden]") && $("bk-arrive").parentElement === $("bk-more") && $("bk-arrive").nextElementSibling === $("bk-incl-h") && $("bk-arrive").textContent === "");
  assert.ok($("bk-act").matches('div.bk-act[data-show="side"]') && $("bk-det").nextElementSibling === $("bk-act") && $("bk-tip").nextElementSibling === $("bk-meet-f"), "the actions follow the step, Where we meet sits beside the gratuity");
  assert.ok($("bk-meet-f").nextElementSibling === $("bk-sign-f") && !$("bk-meet-f").contains($("bk-sign-f")) && $("bk-sign-f").nextElementSibling === $("bk-check") && $("bk-check").nextElementSibling === $("bk-tot"), "the sign name field comes right under the meet and greet row, outside its fieldset, then Check your trip right above the total");
  assert.ok($("bk-tot").matches("p.bk-tot.bk-js-only") && nt($("bk-tot-l").textContent) === "Total" && $("bk-tot-v").matches("b") && $("bk-tot-v").textContent === "" && $("bk-tot").nextElementSibling === $("quote"));
  assert.ok($("bk-more").matches('section.bk-more[data-show="options"][aria-labelledby="bk-incl-h"]'));
  assert.ok(parts["book.html"].includes(MEET), "Where we meet, two radio rows with the empty curb value");
  assert.deepEqual([...$("bk-meet-f").querySelectorAll("input")].map((i) => [i.id, i.name, i.value, i.checked]), [["bk-meet-no", "meet", "", true], ["bk-meet", "meet", "1", false]]);
  assert.ok($("bk-incl-h").matches("h3") && nt($("bk-incl-h").textContent) === "What is included");
  assert.ok(parts["book.html"].includes(INCL), "the included list");
  assert.ok(parts["book.html"].includes(PILLS), "the pills");
  assert.ok(parts["book.html"].includes(BAR), "the bar");
  assert.ok($("bk-tip").matches('fieldset.bk-tip.bk-js-only[data-show="details"]') && nt($("bk-tip").querySelector("legend").textContent) === "Gratuity for your chauffeur");
  assert.ok($("bk-tip-opts").matches("div.bk-chips") && $("bk-tip-opts").children.length === 0);
  assert.ok($("bk-tip-h").matches("p.field__hint") && $("bk-tip-h").previousElementSibling === $("bk-tipamt-f") && $("bk-tipamt-f").previousElementSibling === $("bk-tip-opts") && nt($("bk-tip-h").textContent) === LABELS.gratuityDescription && LABELS.gratuityDescription === "Paid in full to your chauffeur.");
  assert.equal($("bk-tipamt-f").outerHTML, '<div class="field bk-tipamt" id="bk-tipamt-f" hidden=""><label for="bk-tipamt">Amount in dollars</label><span class="bk-row bk-tipamt__in"><input id="bk-tipamt" name="tip_amount" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" enterkeyhint="done" aria-describedby="bk-tipamt-h"></span><p class="field__hint bk-js-only" id="bk-tipamt-h"></p><p class="bk-e field__hint" id="e-tip_amount">Type the gratuity in whole dollars, or choose None.</p></div>', "Other opens a whole dollar amount with a number keypad, its hint built at run time and its own message");
});


check("step 2: the Passengers hint, its own row between the passengers and the cars so the heading keeps its width, asks to count children and infants, describes the select and, with scripting, joins the stepper's name", () => {
  assert.equal($("bk-pax").getAttribute("aria-describedby"), "bk-pax-h");
  assert.ok($("bk-pax-h").matches("p.field__hint:not(.bk-e,.bk-js-only)") && $("bk-pax-h").previousElementSibling === $("bk-pax-f") && $("bk-pax-h").nextElementSibling === $("bk-cards"));
  assert.equal(nt($("bk-pax-h").textContent), "Count children and infants as passengers.");
  const pay = read(`assets/${readdirSync(join(ROOT, "assets")).find((n) => /^pay\.[A-Za-z0-9_-]+\.js$/.test(n))}`);
  assert.ok(pay.includes('SX.setAttribute("aria-labelledby","bk-pax-l bk-pax-h");'), "the stepper does not read the hint with its name");
});

check("step 2: trips our dispatch team prices show the notes field before Email to reserve and WhatsApp to reserve, it mirrors the details notes and adds a Notes line to both messages", () => {
  const f = $("bk-qnotes-f");
  assert.ok(f.matches('div.field.bk-js-only[data-show="options"]') && f.parentElement === $("quote") && f.previousElementSibling === $("q-fix") && $("quote").nextElementSibling === $("bk-go"));
  assert.deepEqual([nt(f.querySelector('label[for="bk-qnotes"]').textContent), $("bk-qnotes").tagName, $("bk-qnotes").getAttribute("maxlength"), $("bk-qnotes").getAttribute("rows"), $("bk-qnotes").getAttribute("aria-describedby"), $("bk-qnotes").hasAttribute("name")], [nt(form.querySelector('label[for="bk-notes"]').textContent), "TEXTAREA", "500", "3", "bk-qnotes-h", false]);
  assert.equal(nt($("bk-qnotes-h").textContent), nt($("bk-notes-h").textContent));
  const css = read(`assets/${readdirSync(join(ROOT, "assets")).find((n) => /^book\.[A-Za-z0-9_-]+\.css$/.test(n))}`);
  assert.ok(css.includes(".bk-quote:not(:has(.bk-q:target,.bk-q.is-on)){display:none}"), "the request block, and the notes field in it, show without a dispatch quote");
  const pay = read(`assets/${readdirSync(join(ROOT, "assets")).find((n) => /^pay\.[A-Za-z0-9_-]+\.js$/.test(n))}`);
  assert.ok(pay.includes('let q=$("bk-qnotes"),a='), "the message builder does not read the step 2 notes");
  assert.ok(pay.includes('a.concat(P2>0&&ab()<"e"?dw():(x=(d.activeElement==q?E.notes.value=q.value:q.value=E.notes.value).trim())?"Notes: "+x:[])'), "the step 2 messages carry no Notes line, or the two notes fields do not mirror each other");
});

check("five class rows and five pills, in the order Business SUV, Business Premium SUV, First Class, Sedan & Electric, Luxury Sprinter", () => {
  const order = ["suv", "premium", "first", "sedan", "sprinter"];
  const names = ["Business SUV", "Business Premium SUV", "First Class", "Sedan & Electric", "Luxury Sprinter"];
  assert.deepEqual(Object.keys(CLASSES), order);
  assert.deepEqual([...$("bk-cards").querySelectorAll("input[name=class]")].map((r) => r.value), order);
  assert.deepEqual([...$("bk-cards").querySelectorAll(".bk-card__name")].map((n) => nt(n.textContent)), names);
  assert.deepEqual([...$("bk-pills").querySelectorAll(".bk-pill")].map((b) => [b.dataset.c, nt(b.firstElementChild.textContent)]), order.map((c, i) => [c, names[i]]));
  assert.deepEqual([...$("bk-cards").querySelectorAll("label.bk-card")].map((c) => c.dataset.seats), ["5", "5", "3", "3", "12"]);
  assert.deepEqual([...$("bk-cards").querySelectorAll("picture > img")].map((i) => i.getAttribute("src")), ["/fleet/chevrolet-suburban-card-300.webp", "/fleet/cadillac-escalade-card-300.webp", "/fleet/mercedes-s-class-card-300.webp", "/fleet/cadillac-lyriq-card-300.webp", "/fleet/sprinter-limo-card-300.webp"]);
  const first = form.querySelector('label[for="bk-c-first"] picture > img');
  assert.deepEqual([first.getAttribute("width"), first.getAttribute("height")], ["960", "1192"]);
  assert.match(first.getAttribute("alt"), /^Black Mercedes-Benz S-Class /);
  const alts = ["Black Chevrolet Suburban in a white studio", "Black Cadillac Escalade ESV in a white studio", "Black Mercedes-Benz S-Class in a white studio", "Black Cadillac Lyriq in a white studio", "Black Mercedes-Benz Sprinter van in a white studio"];
  assert.deepEqual([...$("bk-cards").querySelectorAll("picture > img")].map((i) => [i.getAttribute("width"), i.getAttribute("height"), i.getAttribute("alt")]), alts.map((a) => ["960", "1192", a]));
  const sizes = "(min-width: 1280px) 176px, (min-width: 1024px) 128px, (min-width: 600px) 176px, 96px";
  assert.deepEqual([...$("bk-cards").querySelectorAll("picture")].map((p) => [...p.querySelectorAll("source")].map((s) => s.getAttribute("sizes"))), order.map(() => [sizes, sizes]));
});

check("the First Class model line keeps S-Class in one nowrap span and joins BMW 7 Series with no-break spaces, so neither splits on a phone, on Check your trip or on the confirmation", () => {
  const m = $("bk-m-first");
  assert.deepEqual([[...m.querySelectorAll("span.nowrap")].map((n) => n.textContent), m.textContent.includes("BMW\u00a07\u00a0Series")], [["S-Class"], true], m.innerHTML);
});

check("class rows follow CLASSES with photo, name, model line, seats and bags with their spoken forms, each bag count in its own nowrap span, empty price and check", () => {
  const cards = [...$("bk-cards").querySelectorAll("label.bk-card")];
  assert.deepEqual(cards.map((c) => c.getAttribute("for")), Object.keys(CLASSES).map((k) => `bk-c-${k}`));
  const BAGS = { suv: ["3 large, 3 small", "3 large and 3 small bags"], premium: ["3 large, 3 small", "3 large and 3 small bags"], first: ["2 large, 1 small", "2 large and 1 small bag"], sprinter: ["10 large, 2 small", "10 large and 2 small bags"] };
  for (const [k, c] of Object.entries(CLASSES)) {
    const card = form.querySelector(`label[for="bk-c-${k}"]`), radio = $(`bk-c-${k}`);
    assert.ok(card.contains(radio) && radio.matches(`input[type=radio][name=class][value="${k}"]`), k);
    assert.equal(radio.checked, k === "suv", k);
    assert.equal(card.dataset.seats, String(c.seats), k);
    assert.equal(radio.getAttribute("aria-labelledby"), `bk-n-${k} bk-p-${k}`, k);
    assert.equal(radio.getAttribute("aria-describedby"), `bk-m-${k} bk-s-${k}${c.bags ? ` bk-b-${k}` : ""}`, k);
    assert.equal(nt(card.querySelector(".bk-card__name").textContent), c.name, k);
    assert.ok($(`bk-m-${k}`).matches("span.bk-card__model") && $(`bk-m-${k}`).previousElementSibling === $(`bk-n-${k}`) && nt($(`bk-m-${k}`).textContent) === MODELS[k], k);
    const cap = $(`bk-s-${k}`);
    assert.ok(cap.matches("span.bk-card__cap") && cap.querySelector('use[href="#i-user"]'), k);
    assert.deepEqual([nt(cap.querySelector('[aria-hidden="true"]:not(svg)').textContent), nt(cap.querySelector(".sr-only").textContent)], [String(c.seats), `Up to ${c.seats} passengers`], k);
    const bags = card.querySelector(".bk-card__bags");
    if (c.bags) assert.deepEqual([bags.id, !!bags.querySelector('use[href="#i-case"]'), nt(bags.querySelector('[aria-hidden="true"]:not(svg)').textContent), nt(bags.querySelector(".sr-only").textContent), [...bags.querySelectorAll('[aria-hidden="true"]:not(svg) > span.nowrap')].map((n) => n.textContent)], [`bk-b-${k}`, true, ...BAGS[k], BAGS[k][0].split(/(?<=,) /)], k);
    else assert.ok(bags === null && k === "sedan", k);
    assert.equal($(`bk-p-${k}`).textContent, "", k);
    assert.ok(card.querySelector('svg.bk-card__check use[href="#i-check"]'), k);
    const img = card.querySelector("picture > img");
    assert.ok(img.getAttribute("width") && img.getAttribute("height") && img.getAttribute("alt"), k);
    assert.deepEqual([img.getAttribute("loading"), img.getAttribute("decoding")], ["lazy", "async"], k);
    assert.deepEqual([...card.querySelectorAll("picture source")].map((s) => s.type), ["image/avif", "image/webp"], k);
    for (const s of card.querySelectorAll("picture source")) assert.match(s.getAttribute("srcset"), /-300\.\w+ 300w, \/fleet\/.+-400\.\w+ 400w$/, k);
  }
});

check("the summary card: wait line, choice, route list, price section with the later-charges list and the policy line, then the request blocks in REASONS order, the three ways to finish, the T6 list and the form error", () => {
  assert.ok($("bk-side").matches('aside.bk-side[aria-label="Your booking"]'));
  assert.ok($("bk-choice").matches("p.bk-choice") && $("bk-choice").textContent === "");
  assert.ok($("bk-route").matches("ol.bk-route[hidden]") && $("bk-route-n").matches("p.bk-route__note[hidden]"));
  assert.ok($("bk-result").matches("div.bk-result:not([aria-live])") && $("bk-result").contains($("price")) && !$("bk-side").contains($("quote")) && $("bk-act").contains($("quote")));
  assert.ok($("q-edit").matches("button.bk-link.bk-js-only[type=button]") && $("q-edit").parentElement === $("q-unplaced") && nt($("q-edit").textContent) === "Edit trip");
  assert.ok($("price").matches('section.bk-price[hidden][aria-labelledby="price-h"]') && nt($("price-h").textContent) === "Your price" && $("price-h").tagName === "H3");
  assert.ok($("price-lines").matches("table.bk-lines > tbody") && $("price-lines").children.length === 0);
  assert.equal(nt($("price-total").closest("tr").querySelector("th[scope=row]").textContent), "Total");
  assert.ok($("price-total").closest("tfoot"));
  assert.ok($("price-notes").matches("ul.bk-later"));
  assert.deepEqual([$("price-notes").dataset.airport, $("price-notes").dataset.hourly, $("price-notes").textContent], [NOTES.included + "|" + POLICY.later.airport, POLICY.later.hourly, ""]);
  assert.equal($("quote").getAttribute("aria-label"), "Booking request");
  const blocks = [...$("quote").querySelectorAll("div.bk-q")];
  assert.deepEqual(blocks.map((b) => b.id), [...Object.keys(REASONS).map((r) => `q-${r}`), "q-error"]);
  for (const [r, { group, text }] of Object.entries(REASONS)) {
    assert.equal(nt($(`q-${r}`).querySelector("h3").textContent), HEADINGS[group], r);
    assert.equal(nt($(`q-${r}`).querySelector("p").textContent), text, r);
  }
  assert.equal(nt($("q-error").querySelector("h3").textContent), HEADINGS[ERROR_BLOCK.group]);
  assert.equal(nt($("q-error").querySelector("p").textContent), ERROR_BLOCK.text);
  assert.ok($("q-retry").matches("button.btn.btn--sm.bk-js-only[type=button]") && $("q-retry").parentElement === $("q-error") && nt($("q-retry").textContent) === "Try again");
  assert.ok($("q-fix").matches("button.btn.btn--sm.btn--ghost.bk-js-only[type=button][hidden]") && $("q-fix").nextElementSibling === $("bk-qnotes-f") && $("bk-qnotes-f").nextElementSibling === null && $("q-fix").textContent === "");
  assert.ok($("quote").nextElementSibling === $("bk-go") && $("bk-go").nextElementSibling === $("q-body"), "the request steps follow the buttons");
  assert.ok($("q-body").matches('ol.next[role="list"]'));
  assert.deepEqual([...$("q-body").children].map((li) => [nt(li.querySelector("b").textContent), nt([...li.querySelector("span").childNodes].filter((n) => !(n.classList && n.classList.contains("bk-nojs"))).map((n) => n.textContent).join(""))]), [["Send us the trip", "By email or WhatsApp, with everything you entered."], ["We reply with the fare and a payment link", "We answer 24 hours a day, every day."], ["Pay when you're ready", "Nothing is booked until you pay."]]);
  assert.deepEqual([...$("q-body").children[0].querySelectorAll("span > span")].map((s) => [s.className, nt(s.textContent)]), [["bk-js-only", "By email or WhatsApp, with everything you entered."], ["bk-nojs", "By email or WhatsApp. Put the pickup, drop-off, date and time in the message."]]);
  assert.ok($("q-retry").matches("button.btn.btn--sm.btn--ghost.bk-js-only"), "Try again is the outline button, so Email to reserve stays the one gold control of the block");
  assert.deepEqual([$("q-mail").className, $("q-mail").getAttribute("href"), !!$("q-mail").querySelector('use[href="#i-mail"]'), nt($("q-mail").textContent)], ["btn btn--ghost", "mailto:info@nycluxride.com", true, "Email to reserve"]);
  assert.deepEqual([$("q-wa").className, $("q-wa").getAttribute("href"), $("q-wa").hasAttribute("data-wa"), $("q-wa").getAttribute("target"), $("q-wa").getAttribute("rel"), !!$("q-wa").querySelector('use[href="#i-whatsapp"]'), nt($("q-wa").textContent)], ["btn btn--ghost", "https://wa.me/16467750556", false, "_blank", "noopener", true, "WhatsApp to reserve"]);
  assert.equal($("q-call"), null);
  assert.ok($("q-sent").matches('div.notice.bk-js-only[role="status"][hidden]') && $("q-sent").textContent === "");
  assert.equal($("bk-policy").innerHTML, `${P1_FIRST} <a class="lnk" href="/rates#cancellation" target="_blank" rel="noopener">Rates and cancellation terms${EXT}</a>`);
  assert.equal(P1_FIRST, "Cancellation terms are confirmed in writing with the reservation.");
  assert.ok(parts["book.html"].includes(CONSENT), "the consent line and its two links in a new tab");
  assert.ok($("bk-next").matches('button.btn.bk-js-only[type=button][aria-describedby="bk-nopay"]') && nt($("bk-next").textContent) === "Book and pay online");
  assert.equal(nt($("bk-nopay").textContent), "Next you add your details. Then you pay on a Stripe payment page.");
  assert.ok($("bk-submit").matches('button.btn[type=submit][aria-describedby="bk-consent"]') && nt($("bk-submit").textContent) === "Book and pay online" && $("bk-submit").firstElementChild.matches("svg.icon") && $("bk-submit").querySelector('use[href="#i-lock"]'));
  assert.ok(nt($("bk-under").textContent) === "Stripe handles your card. We never see the full card number." && $("bk-under").querySelector('use[href="#i-shield"]'));
  assert.ok($("bk-hp").parentElement.matches('div.bk-hp[aria-hidden="true"]'));
  assert.deepEqual(["name", "type", "tabindex", "autocomplete"].map((a) => $("bk-hp").getAttribute(a)), ["nlr_hp", "text", "-1", "off"]);
  assert.ok($("bk-nonce").matches("input[type=hidden][name=nonce]"));
});

check("step 3: the step count, the error summary, Someone else is riding, passenger fields first, labels, one hint on the mobile number, helper slots, the sign card, the notes toggle, Check your trip with Edit trip and the fine print", () => {
  assert.ok($("bk-det").matches('section.bk-det[data-show="details"][aria-labelledby="bk-det-h"]'));
  assert.ok($("bk-back").matches("button.bk-link.bk-js-only[type=button]") && nt($("bk-back").textContent) === "Back to vehicles" && $("bk-back").querySelector('use[href="#i-arrow"]'));
  assert.ok($("bk-det-h").matches('h2[tabindex="-1"]') && $("bk-det-h").innerHTML === '<span class="bk-stepno">Step 3 of 4</span> Your details');
  assert.equal($("bk-check").outerHTML, '<section class="bk-trip bk-js-only" id="bk-check" data-show="details" aria-labelledby="bk-check-h"><h3 id="bk-check-h">Check your trip</h3><button class="lnk-btn" id="bk-check-edit" type="button" data-c="trip">Edit trip</button><ol class="bk-trip__route" id="bk-check-route"></ol><dl class="bk-trip__rows" id="bk-check-rows"></dl></section>');
  assert.ok($("bk-errs").matches("div.bk-errs[hidden]") && $("bk-errs").textContent === "");
  assert.equal($("bk-who").outerHTML, '<div class="field bk-who" id="bk-who"><input type="checkbox" id="bk-r-other" name="rider" value="other"><label for="bk-r-other">Someone else is riding</label></div>', "one checkbox, unchecked: the booker rides unless it is checked");
  assert.ok($("bk-who").nextElementSibling === $("e-rider") && $("e-rider").nextElementSibling === $("bk-pname-f"));
  assert.equal($("bk-who").querySelector(".bk-tile, .bk-tile__s"), null);
  assert.ok($("bk-reach").matches("fieldset.bk-seg") && nt($("bk-reach").querySelector("legend").textContent) === "How should we contact you?");
  assert.deepEqual([...$("bk-reach").querySelectorAll("input")].map((i) => [i.id, i.name, i.value, i.checked, nt(i.parentElement.textContent)]), [["bk-reach-phone", "reach", "phone", true, "Phone"], ["bk-reach-wa", "reach", "whatsapp", false, "WhatsApp"]]);
  const f = (id) => { const c = $(id); return [nt(form.querySelector(`label[for="${id}"]`).textContent), c.getAttribute("type"), c.getAttribute("maxlength"), c.getAttribute("autocomplete"), c.getAttribute("placeholder"), c.getAttribute("aria-describedby"), c.getAttribute("enterkeyhint"), c.getAttribute("autocapitalize")]; };
  assert.deepEqual(f("bk-name"), ["Your full name", "text", "80", "name", null, null, "next", "words"]);
  assert.deepEqual(f("bk-email"), ["Your email", "email", "254", "email", "name@example.com", null, "next", null]);
  assert.deepEqual([$("bk-email").getAttribute("inputmode"), $("bk-email").getAttribute("spellcheck")], ["email", "false"]);
  assert.deepEqual(f("bk-phone"), ["Your mobile number", "tel", "32", "tel", "For example 212 555 0100", "bk-phone-h", "next", null]);
  assert.deepEqual(["bk-phone", "bk-pphone"].map((id) => $(id).getAttribute("pattern")), ["[+ \\(\\).\\-]*(?:[0-9][+ \\(\\).\\-]*){4,15}", "[+ \\(\\).\\-]*(?:[0-9][+ \\(\\).\\-]*){4,15}"]);
  assert.equal($("bk-phone").getAttribute("inputmode"), "tel");
  assert.deepEqual(f("bk-pname"), ["Passenger's full name (if someone else is riding)", "text", "80", "off", null, null, "next", "words"]);
  assert.deepEqual(f("bk-pphone"), ["Passenger's mobile number (if someone else is riding)", "tel", "32", "off", "For example 212 555 0100", "bk-other-h", "next", null]);
  assert.ok($("bk-other-h").matches('p.bk-mrow__x[data-show="other"]') && $("bk-other-h").previousElementSibling === $("bk-pphone-f"));
  assert.deepEqual([...$("bk-other-h").children].map((e) => [e.className, nt(e.textContent)]).concat([[nt($("bk-other-h").lastChild.previousSibling.textContent)], [$("bk-other-n").textContent]]), [["bk-nojs", "If someone else is riding, your chauffeur contacts them on the day of the ride."], ["bk-js-only", "Your chauffeur contacts the passenger on the day of the ride."], ["bk-cc-h", "Outside the US, start their number with + and the country code."], ["Your confirmation, receipt and any changes go to your email."], ["the passenger"]]);
  assert.ok($("bk-other-h").lastChild === $("bk-other-h").querySelector(".bk-cc-h"), "the passenger note ends with how to type a number from another country");
  assert.deepEqual([...$("bk-phone-h").childNodes].map((n) => [n.nodeName, n.className, n.textContent]), [["SPAN", "", "We use this number to arrange your pickup."], ["SPAN", "bk-cc-h", " Outside the US, start with + and the country code."]], "the first sentence hides when someone else rides, the second shows only without the picker");
  assert.deepEqual(f("bk-dflight"), ["Flight number", "text", "20", "off", "For example DL 1234", null, "next", "characters"]);
  assert.deepEqual(f("bk-sign"), ["Name for the sign (meet and greet)", "text", "45", "off", null, "bk-sign-h", "next", "words"]);
  assert.deepEqual([nt(form.querySelector('label[for="bk-notes"]').textContent), $("bk-notes").tagName, $("bk-notes").getAttribute("maxlength"), $("bk-notes").getAttribute("rows"), $("bk-notes").getAttribute("aria-describedby"), $("bk-notes").getAttribute("enterkeyhint")], ["Notes for your chauffeur (optional)", "TEXTAREA", "500", "3", "bk-notes-h", "done"]);
  assert.deepEqual(["bk-phone-h", "bk-sign-h", "bk-notes-h"].map((id) => $(id).matches("p.field__hint:not(.bk-e)") && nt($(id).textContent)), ["We use this number to arrange your pickup. Outside the US, start with + and the country code.", "Your chauffeur holds a sign with this name inside the terminal.", "For example child seats or large luggage."]);
  assert.deepEqual([...$("bk-det").querySelectorAll("p.field__hint:not(.bk-e,.bk-js-only)")].map((h) => h.id), ["bk-phone-h", "bk-notes-h"], "the details hold one hint before the notes open");
  assert.deepEqual([["bk-email-s", $("bk-email")], ["bk-phone-s", $("bk-phone-h")], ["bk-pphone-s", $("bk-pphone").parentElement]].map(([s, p]) => $(s).matches("p.field__hint.bk-js-only[hidden]") && $(s).previousElementSibling === p && $(s).textContent === ""), [true, true, true]);
  assert.ok($("bk-pphone").parentElement.matches("div.bk-row.bk-tel"), "the passenger hint slot follows the number row");
  assert.equal($("bk-signcard").outerHTML, '<div class="bk-signcard bk-js-only" id="bk-signcard" aria-hidden="true"><span id="bk-signname"></span></div>');
  assert.equal($("bk-signcard").previousElementSibling, $("bk-sign-h"));
  assert.deepEqual(["type", "aria-expanded", "aria-controls", "aria-describedby"].map((a) => $("bk-notes-add").getAttribute(a)).concat(nt($("bk-notes-add").textContent), $("bk-notes-add").className), ["button", "false", "bk-notes-f", null, "Add child seats or a note", "lnk-btn bk-js-only"]);
  assert.ok($("bk-next3").matches('ul.bk-fine[role="list"]'));
  assert.deepEqual([...$("bk-next3").children].map((li) => [li.tagName, li.children.length, nt(li.textContent)]), [["LI", 0, "Stripe emails your receipt with your reference."], ["LI", 0, "We confirm your car and chauffeur in writing before your ride."], ["LI", 0, "Cancellation terms are confirmed in writing with the reservation. To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference, and give as much notice as you can."]]);
  assert.deepEqual([$("bk-pname-f").dataset.show, $("bk-pphone-f").dataset.show, $("bk-dflight-f").dataset.show, $("bk-sign-f").dataset.show], ["other", "other", "from-airport", "meet"]);
  assert.ok($("bk-dflight-f").matches(".field.bk-js-only"));
  assert.deepEqual([...$("bk-det").querySelectorAll("[required]")], []);
});

check("both mobile numbers have a country select that ships with only United States +1, named for screen readers, and book.html alone holds the 244 countries in a template right after the form (owner request 3)", () => {
  for (const [id, name, label, face] of [["bk-phone-cc", "phone_cc", "Country code", "bk-phone-face"], ["bk-pphone-cc", "pphone_cc", "Passenger's country code", "bk-pphone-face"]]) {
    const s = $(id), l = form.querySelector(`label[for="${id}"]`);
    assert.ok(s.matches(`select[name="${name}"]`) && s.parentElement.matches("span.bk-cc") && s.parentElement.parentElement.matches("div.bk-row.bk-tel"), id);
    assert.deepEqual([...s.options].map((o) => [o.value, o.textContent, o.selected]), [["US", "United States +1", true]], id);
    assert.ok(l.matches("label.sr-only") && l.parentElement === s.parentElement && nt(l.textContent) === label, id);
    assert.equal($(face).outerHTML, `<span class="bk-cc__face" id="${face}" aria-hidden="true"><span class="bk-cc__flag">\u{1F1FA}\u{1F1F8}</span><span>+1</span></span>`);
    assert.ok(s.nextElementSibling === $(face) && s.parentElement.nextElementSibling === $(id.replace("-cc", "")), "the select comes right before its number, so it is the tab stop before it");
    assert.equal(s.hasAttribute("autocomplete"), false, "no tel-country-code autofill, which would pick the first +1 country");
  }
  const t = $("bk-cc");
  assert.ok(t && t.tagName === "TEMPLATE" && t.previousElementSibling === form && doc.querySelectorAll("template").length === 1, "one template right after the form");
  const want = COUNTRIES.map(([iso, n, dial]) => [iso, `${n} +${dial}`, MAIN_BY_DIAL[dial] === iso, iso in TRUNK ? TRUNK[iso] : null, iso === "US"]);
  assert.deepEqual([...t.content.children].map((o) => [o.tagName, o.value, o.textContent, o.hasAttribute("data-main"), o.hasAttribute("data-t") ? o.getAttribute("data-t") : null, o.hasAttribute("selected")]), want.map((w) => ["OPTION", ...w]));
  assert.equal(want.length, 244);
  assert.ok(!doc.body.textContent.includes("Afghanistan") && !doc.body.textContent.includes("United Kingdom +44"), "the country names are not page text");
  assert.deepEqual(all.filter((f) => f !== "book.html" && read(f).includes('id="bk-cc"')), []);
});

check("every ERRORS code has its message with the exact text in the place of its control, plus the browser-only messages", () => {
  const after = (id, prev) => () => $(id).previousElementSibling === $(prev);
  const where = { tip_amount: "bk-tipamt-f", trip_type: after("e-trip_type", "bk-mode"), from: "bk-from-f", to: "bk-to-f", date: "bk-date-f", "date-past": "bk-date-f", "return-date": "bk-rdate-f", passengers: "bk-pax-f", hours: "bk-hours-f", class: "bk-cards", vehicle: "bk-vehicle-f", flight: "bk-flight-f", return_flight: "bk-rflight-f", tip: "bk-tip", form: after("e-form", "q-sent"), rider: after("e-rider", "bk-who"), reach: after("e-reach", "bk-reach"), name: "bk-name-f", email: "bk-email-f", phone: "bk-phone-f", pname: "bk-pname-f", pphone: "bk-pphone-f" };
  assert.deepEqual(Object.keys(where).sort(), Object.keys(ERRORS).sort());
  for (const [code, { text }] of Object.entries(ERRORS)) {
    const p = $(`e-${code}`);
    assert.ok(p && p.matches("p.bk-e.field__hint"), code);
    assert.equal(nt(p.textContent), text, code);
    const w = where[code];
    assert.ok(typeof w === "function" ? w() : $(w).contains(p), `${code} placement`);
  }
  assert.ok($("e-form").querySelector('a[href="mailto:info@nycluxride.com"]') && $("e-form").querySelector('a[href="https://wa.me/16467750556"]') && !$("e-form").querySelector('a[href^="tel:"]') && $("bk-go").contains($("e-form")));
  assert.equal(nt($("e-stop1").textContent), "Add the address of stop 1, or remove the stop.");
  assert.equal(nt($("e-stop2").textContent), "Add the address of stop 2, or remove the stop.");
  assert.ok($("e-time").matches("p.bk-e.field__hint") && $("bk-time-f").contains($("e-time")) && nt($("e-time").textContent) === "Add a pickup time.");
  assert.equal(Object.keys(ERRORS).length, 22);
  assert.equal(form.querySelectorAll(".bk-e").length, Object.keys(ERRORS).length + 7);
});

check("every input, select and textarea has a label, and the time selects hold four optgroups", () => {
  for (const id of ["bk-time", "bk-rtime"]) assert.deepEqual([...$(id).children].map((c) => c.tagName === "OPTGROUP" ? [c.label, c.children.length, c.firstElementChild.value, c.lastElementChild.value] : c.value), ["", ["Night", 36, "00:00", "05:50"], ["Morning", 36, "06:00", "11:50"], ["Afternoon", 36, "12:00", "17:50"], ["Evening", 36, "18:00", "23:50"]], id);
  const bad = [...form.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((c) => !form.querySelector(`label[for="${c.id}"]`)).map((c) => c.id);
  assert.deepEqual(bad, []);
});

check("time selects: a placeholder then 144 times from 12:00 AM to 11:50 PM", () => {
  const want = [["", "Select a time"]];
  for (let m = 0; m < 1440; m += 10) {
    const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
    want.push([`${String(h).padStart(2, "0")}:${mm}`, `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`]);
  }
  for (const id of ["bk-time", "bk-rtime"]) {
    assert.deepEqual([...$(id).options].map((o) => [o.value, o.textContent]), want, id);
    assert.equal($(id).value, "", id);
  }
  assert.equal(want.length, 145);
});

check("only the pickup, the date and the pickup time are required", () => assert.deepEqual([...form.querySelectorAll("[required]")].map((c) => c.id), ["bk-from", "bk-date", "bk-time"]));

check("every data-show token is one of the contract", () => {
  const vals = [...form.querySelectorAll("[data-show]")].map((w) => w.dataset.show);
  assert.deepEqual([...new Set(vals.filter((v) => !SHOW.includes(v)))], []);
  assert.deepEqual(SHOW.filter((v) => !vals.includes(v)), []);
  assert.deepEqual([...form.querySelectorAll(".is-shown")].map((e) => e.id), ["bk-to-f", "bk-adds"]);
  for (const f of HOURLY_HOSTS) assert.deepEqual([...new JSDOM(read(f)).window.document.querySelectorAll("#book-form .is-shown")].map((e) => e.id), ["bk-hours-f"], f);
});

for (const f of WIDGET) {
  const d = new JSDOM(read(f)).window.document;
  const fm = d.getElementById("book-form");
  check(`${f}: hours run from ${HOURS.min} to ${HOURS.max}${HOSTS.includes(f) ? ` and passengers from ${PASSENGERS.min} to ${PASSENGERS.max}` : ""}`, () => {
    assert.deepEqual([...d.getElementById("bk-hours").options].map((o) => [o.value, o.textContent]), Array.from({ length: HOURS.max - HOURS.min + 1 }, (_, i) => [`${HOURS.min + i}`, `${HOURS.min + i} hours`]));
    assert.equal(d.getElementById("bk-hours").value, `${HOURS.min}`);
    if (!HOSTS.includes(f)) return assert.equal(d.getElementById("bk-pax"), null);
    assert.deepEqual([...d.getElementById("bk-pax").options].map((o) => [o.value, o.textContent]), Array.from({ length: PASSENGERS.max - PASSENGERS.min + 1 }, (_, i) => [`${PASSENGERS.min + i}`, `${PASSENGERS.min + i}`]));
    assert.equal(d.getElementById("bk-pax").value, "1");
  });
  check(`${f}: no dollar figure, percent figure or USD in the static component`, () => {
    const attrs = [...fm.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value));
    assert.equal([fm.textContent, ...attrs].join(" ").match(/\$\s*\d|\d\s*%|\bUSD\b/), null);
  });
  check(`${f}: no em dash, en dash or semicolon in the visible copy of the component`, () => {
    const attrs = [...fm.querySelectorAll("*")].flatMap((el) => ["alt", "aria-label", "placeholder", "title", "value"].map((a) => el.getAttribute(a) || ""));
    assert.equal([fm.textContent, ...attrs].join(" ").match(/[–—;]/), null);
  });
  check(`${f}: no inline script, style or handler and no comment inside the component`, () => {
    assert.doesNotMatch(parts[f], /<script|<style|\sstyle=|\son[a-z]+=|<!--/i);
  });
  check(`${f}: every a[data-wa] starts with https://wa.me/16467750556`, () => {
    const bad = [...d.querySelectorAll("a[data-wa]")].map((a) => a.getAttribute("href")).filter((h) => !h.startsWith("https://wa.me/16467750556"));
    assert.deepEqual(bad, []);
    assert.ok(d.querySelectorAll("a[data-wa]").length >= 2);
  });
}

const SCRIPT_PAGES = [...WIDGET, "booking-confirmed.html"];
const BLOCKING = ["book.html", "booking-confirmed.html"];
for (const f of SCRIPT_PAGES) {
  const d = new JSDOM(read(f)).window.document;
  const lazy = SEARCH_HOSTS.includes(f);
  check(`${f}: ${lazy ? "lux, gtag and tracking load deferred and lux.js brings pay" : f === "booking-confirmed.html" ? "lux, done, gtag and tracking load deferred in that order" : "lux, pay, gtag and tracking load deferred in that order"}, render blocking only on /book and /booking-confirmed`, () => {
    const s = [...d.head.querySelectorAll("script[src]")];
    assert.deepEqual(s.map((x) => x.getAttribute("src").replace(/\.[A-Za-z0-9_-]{6,}\.js$/, ".js")), lazy ? ["/assets/lux.js", "/assets/gtag.js", "/assets/tracking.js"] : ["/assets/lux.js", f === "booking-confirmed.html" ? "/assets/done.js" : "/assets/pay.js", "/assets/gtag.js", "/assets/tracking.js"]);
    assert.ok(s.every((x) => x.defer));
    lazy || assert.equal(s[1].getAttribute("blocking"), BLOCKING.includes(f) ? "render" : null);
    assert.equal(s.filter((x) => x.hasAttribute("blocking")).length, BLOCKING.includes(f) ? 1 : 0);
  });
}
check("no other page loads the pay script, and only booking-confirmed.html loads the done script", () => {
  assert.deepEqual(all.filter((f) => (!SCRIPT_PAGES.includes(f) || SEARCH_HOSTS.includes(f) || f === "booking-confirmed.html") && read(f).includes("/assets/pay.")), []);
  assert.deepEqual(all.filter((f) => read(f).includes("/assets/done.")), ["booking-confirmed.html"]);
});
{
  const assets = readdirSync(join(ROOT, "assets"));
  const lux = read(`assets/${assets.find((n) => /^lux\..+\.js$/.test(n))}`);
  const pay = assets.find((n) => /^pay\..+\.js$/.test(n));
  check("lux.js loads the current pay script only for the SEARCH form, after load when idle or at the first focus, pointerdown or keydown in it", () => {
    assert.ok(lux.includes(`s.src="/assets/${pay}"`), "lux.js does not point at the current pay file");
    assert.ok(lux.includes('d.querySelector("#book-form.bk--go")'));
    assert.ok(lux.includes('["focusin","pointerdown","keydown"]') && lux.includes("requestIdleCallback") && lux.includes('addEventListener("load",idle)'));
  });
}

const OPTION = (p) => {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const uniq = (list) => [...new Set(list.map(norm))].join("|");
  return `<option value="${esc(p.label)}" data-id="${p.id}" data-zone="${p.zone}" data-iata="${p.iata}" data-kind="${p.kind}"${p.parent ? ` data-parent="${p.parent}"` : ""}${p.aliases.length ? ` data-alias="${esc(uniq(p.aliases))}"` : ""} data-keys="${esc(uniq(p.keys))}">${p.sub.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</option>`;
};
check("the datalist holds one option per PLACE_LIST row, in order, one per line, built from api/_places.mjs, in every copy", () => {
  const want = ['<datalist id="bk-places">', ...PLACE_LIST.map(OPTION), "</datalist>"].join("\n");
  for (const f of WIDGET) assert.ok(parts[f].includes(`\n${want}\n</form>`), f);
  assert.equal(doc.querySelectorAll("#bk-places option").length, PLACE_LIST.length);
  assert.doesNotMatch(parts["book.html"], /data-addr|data-gid/);
});

check("the old booking code is gone from the scripts and the two stylesheets, the booking layer lives in book.css", () => {
  const assets = readdirSync(join(ROOT, "assets"));
  const lux = assets.find((n) => /^lux\..+\.js$/.test(n));
  assert.doesNotMatch(read(`assets/${lux}`), /\.trip|trip__/);
  const lcss = read(`assets/${assets.find((n) => /^lux\..+\.css$/.test(n))}`), bcss = read(`assets/${assets.find((n) => /^book\..+\.css$/.test(n))}`);
  for (const sheet of [lcss, bcss]) assert.doesNotMatch(sheet, /\.trip\b|\.book\b|\.bk-f\b|\.bk-cols\b|#q-switch|#bk-estimate|\.bk-help\b|#bk-wa\b|#bk-hl/);
  assert.match(lcss + bcss, /\n\.bk\{[^}]*container:bk\/inline-size/);
  assert.ok(bcss.startsWith("@layer booking{") && !lcss.includes("@layer booking{"));
});

check("the removed codes, reasons and the retired placeholder appear in no shipped file", () => {
  const shipped = [...all, ...readdirSync(join(ROOT, "assets")).filter((n) => /\.(js|css)$/.test(n)).map((n) => `assets/${n}`), ...readdirSync(join(ROOT, "api")).map((n) => `api/${n}`)];
  assert.deepEqual(shipped.filter((f) => /from_address|to_address|class-airport|first-lga|Address, airport, hotel/.test(read(f))), []);
});

if (failures) {
  console.error(`\n${failures} booking component assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll booking component tests passed");
process.exit(0);
