import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CLASSES, VEHICLES, DISTANCE_RATES, CHILD_SEAT_CENTS, CLASS_DEFAULT_VEHICLE } from "../api/_rates.mjs";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const BASELINE = JSON.parse(readFileSync(join(ROOT, "test/fixtures/seo-baseline.json"), "utf8"));
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const cache = new Map();
const load = (file) => {
  if (!cache.has(file)) cache.set(file, new JSDOM(readFileSync(join(ROOT, file), "utf8")).window.document);
  return cache.get(file);
};
const tags = (el) => [...el.children].map((c) => c.tagName.toLowerCase() + [...c.classList].map((k) => `.${k}`).join(""));
const graph = (doc) => [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
  const b = JSON.parse(s.textContent);
  return b["@graph"] || [b];
});

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

const CARDS = [
  ["/services#airport-transfers", "Airport transfers", "One flat price to or from JFK, LaGuardia, Newark and Teterboro, from anywhere in New York City. Tolls, airport fees and the service fee are included.", "gmc-denali", 1448, 1086, "Black GMC Denali in a stone lobby"],
  ["/chauffeur-service-nyc", "Chauffeur service", "The same car and chauffeur for meetings, events, shopping or a day of stops, with a 3-hour minimum, or 4 hours in a Sprinter.", "bmw-7-series", 1607, 979, "Dark gray BMW 7 Series outside a stone building at night"],
  ["/limousine-service-nyc", "Limo service", "Five kinds of Sprinter for up to 14 passengers, with 10 large and 2 small bags.", "sprinter-jet", 1236, 650, "Inside a Luxury Sprinter: two leather captain's chairs facing a screen"],
  ["/services#corporate", "Corporate accounts", "Monthly billing and priority scheduling for your company.", "lincoln-navigator", 1536, 1024, "Black Lincoln Navigator in a showroom"],
];
const LUX = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((n) => /^lux\..+\.css$/.test(n))), "utf8");
const ZOOM = (slug) => {
  const [, k] = /\.banner\{--z:calc\(([.\d]+) \/ min\(var\(--cx\),1 - var\(--cx\)\)\)\}/.exec(LUX);
  const [, cl, cw] = new RegExp(`\\[data-photo=${slug}\\]\\{[^}]*--cl:([.\\d]+);--cw:([.\\d]+)\\}`).exec(LUX);
  const cx = +cl + cw / 2;
  return Math.ceil(Math.max(1, k / Math.min(cx, 1 - cx)) * 100) / 100;
};
const BANNER_SIZES = (img) => {
  const z = ZOOM(/^\/fleet\/([a-z0-9-]+?)-900\.webp$/.exec(img.getAttribute("src"))[1]);
  return `(max-width: 1023px) ${z > 1 ? `calc((100vw - 48px) * ${z})` : "calc(100vw - 48px)"}, (max-width: 1234px) calc(54vw - 35px), 632px`;
};
const SLIDE_SIZES = () => "(min-width: 1280px) 361px, (min-width: 600px) calc((100vw - 128px) / 3), 120px";
const CARD_SIZES = (w, h) => {
  const f = Math.max(1, w / h / 1.5);
  return f === 1 ? "(min-width: 1280px) 262px, (min-width: 600px) calc(50vw - 52px), 112px" : `(min-width: 1280px) ${Math.ceil(262 * f)}px, (min-width: 600px) calc(${(50 * f).toFixed(1)}vw - ${Math.round(52 * f)}px), ${Math.round(112 * f)}px`;
};
const ARROW = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow"></use></svg>';
const EXT = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-external"></use></svg><span class="sr-only"> (opens in a new tab)</span>';
const REVIEWS = `<p><a class="lnk" href="https://www.google.com/maps?cid=15477906940128800338" target="_blank" rel="noopener">Read the reviews on Google <span class="nowrap">Maps<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-external"></use></svg></span><span class="sr-only"> (opens in a new tab)</span></a></p>`;
const TRUST = '<ul class="assure-row assure-row--page" role="list"><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg>Flat airport rates include tolls, airport fees and the service fee</li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone"></use></svg>We answer 24 hours a day, every day</li></ul>';
const FITS = '<fieldset class="fits"><legend>Who is traveling?</legend><label><input type="radio" name="fits" value="0" checked="">All</label><label><input type="radio" name="fits" value="3">1 to 3</label><label><input type="radio" name="fits" value="6">4 to 6</label><label><input type="radio" name="fits" value="10">7 to 10</label><label><input type="radio" name="fits" value="14">11 to 14</label></fieldset>';
const { POLICY } = await import(join(ROOT, "api", "_copy.mjs"));
const P1 = `${POLICY.cancel} ${POLICY.howTo}`;
const NOTE = "This form opens your email app with a message to info@nycluxride.com. Nothing is sent until you press send there. For a faster answer, call or use WhatsApp.";
const KEYS = Object.keys(CLASSES);
const SPRINTERS = Object.values(VEHICLES).filter((v) => v.cls === "sprinter");
const SPRINTER_KEY = new Map(Object.entries(VEHICLES).filter(([, v]) => v.cls === "sprinter").map(([k, v]) => [v, k]));
const BY_HOUR = KEYS.filter((k) => k !== "sprinter");

{
  const doc = load("index.html");
  const svc = doc.querySelector('main section[aria-labelledby="svc-h"]');
  check("index.html: the services section holds ul.icards with four li.icard and no assurance list", () => {
    assert.ok(svc, "no services section");
    const list = svc.querySelector(":scope > ul.icards");
    assert.ok(list, "no ul.icards");
    assert.equal(list.getAttribute("role"), "list");
    assert.deepEqual(tags(list), ["li.icard", "li.icard", "li.icard", "li.icard"]);
    assert.equal(svc.querySelectorAll(".assure, .assure--row").length, 0);
    assert.ok(svc.querySelector(".sec-head h2#svc-h"), "the section head is gone");
  });
  check("index.html: the first section after the hero is the waiting band, it starts with the static trust row of 2.7 item 1 without the free waiting item the band states, exact", () => {
    const band = doc.querySelector("main > section.hero").nextElementSibling;
    assert.equal(band, doc.querySelector('main > section.section--band[aria-labelledby="wait-h"]'));
    assert.equal(band.firstElementChild.outerHTML, TRUST);
    assert.equal(doc.querySelectorAll(".assure-row--page").length, 1);
  });
  check("index.html: every section ends with its links, centered in one p.btn-row, and no section head holds a link (H-10)", () => {
    const end = (id) => doc.querySelector(`main section[aria-labelledby="${id}"]`).lastElementChild;
    const links = (n) => [...n.querySelectorAll("a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]);
    assert.equal(end("svc-h").outerHTML, `<p class="btn-row"><a class="lnk" href="/services">All services ${ARROW}</a></p>`);
    assert.equal(end("areas-h").outerHTML, `<p class="btn-row"><a class="lnk" href="/locations">All service areas ${ARROW}</a></p>`);
    assert.deepEqual(links(end("fleet-h")), [["/fleet", "See the fleet"], ["/rates#hourly", "See hourly rates"]]);
    assert.equal(end("fleet-h").className, "btn-row");
    assert.deepEqual(links(doc.getElementById("amen-h").closest("main > .section").lastElementChild), [["/rates#add-ons", "See all add-ons and terms"], ["/faq", "Read the FAQ"]]);
    assert.equal(doc.querySelectorAll("main .sec-head a").length, 0);
  });
  check("index.html: the coverage section says where we pick up (H-13), the 17 area pills include the four flat rate airport guides", () => {
    const sec = doc.querySelector('main section[aria-labelledby="areas-h"]');
    assert.equal(norm(sec.querySelector("h2#areas-h").textContent), "Where we pick up");
    assert.equal(norm(sec.querySelector(".sec-head .prose > p:not(.eyebrow)").textContent), "We pick up anywhere in the five boroughs and at JFK, LaGuardia, Newark and Teterboro. These guides cover the five boroughs, six neighborhoods, the airports and the towns around the city.");
    assert.equal(sec.querySelectorAll(":scope > ul.jumps > li > a[href^='/locations/']").length, 17);
    assert.deepEqual([...sec.querySelectorAll(":scope > ul.jumps > li > a")].slice(0, 3).map((a) => [a.getAttribute("href"), norm(a.textContent)]), [["/locations/jfk-airport", "JFK Airport"], ["/locations/laguardia-airport", "LaGuardia Airport"], ["/locations/newark-airport", "Newark Airport"]]);
    assert.ok(!sec.textContent.includes("book the most rides"));
  });
  CARDS.forEach(([href, title, text, photo, w, h, alt], i) => {
    check(`index.html: card ${i + 1} "${title}" is photo, h3 link and text, sized for rows, two columns and four columns`, () => {
      const li = svc.querySelectorAll("ul.icards > li.icard")[i];
      assert.deepEqual(tags(li), ["div.plate.icard__photo", "div.icard__body"]);
      const body = li.querySelector(".icard__body");
      assert.deepEqual(tags(body), ["h3", "p"]);
      const a = body.querySelector("h3 > a");
      assert.deepEqual([a.getAttribute("href"), norm(a.textContent), a.attributes.length], [href, title, 1]);
      assert.equal(norm(body.querySelector("p").textContent), text);
      assert.equal(li.querySelectorAll("svg").length, 0, "the item icon is still there");
      const pic = li.querySelector(".icard__photo > picture");
      assert.ok(pic, "no picture in the photo frame");
      const [avif, webp] = pic.querySelectorAll("source");
      assert.equal(avif.getAttribute("type"), "image/avif");
      assert.equal(avif.getAttribute("srcset"), `/fleet/${photo}-600.avif 600w, /fleet/${photo}-900.avif 900w`);
      assert.equal(webp.getAttribute("type"), "image/webp");
      assert.equal(webp.getAttribute("srcset"), `/fleet/${photo}-600.webp 600w, /fleet/${photo}-900.webp 900w`);
      for (const s of [avif, webp]) assert.equal(s.getAttribute("sizes"), CARD_SIZES(w, h));
      const img = pic.querySelector("img");
      assert.deepEqual(
        ["src", "width", "height", "alt", "loading", "decoding"].map((k) => img.getAttribute(k)),
        [`/fleet/${photo}-600.webp`, String(w), String(h), alt, "lazy", "async"],
      );
    });
  });
  check("index.html: the What is included section is folded into the waiting band, child seats and amenities, no ul.incl is left outside the booking form", () => {
    assert.equal(doc.getElementById("terms-h"), null);
    assert.equal([...doc.querySelectorAll("main ul.incl")].filter((ul) => !ul.closest("#book-form")).length, 0);
  });
  for (const id of ["how-h"]) {
    check(`index.html: the intro prose of section ${id} has no c1-8`, () => {
      const prose = doc.getElementById(id).closest(".prose");
      assert.ok(prose, "no prose block");
      assert.equal(prose.className, "prose");
    });
  }
  check("index.html: How it works keeps its three steps, without the boxes (H-08)", () => {
    const how = doc.querySelector('main section[aria-labelledby="how-h"]');
    assert.deepEqual([...how.querySelectorAll("ol.steps > li h3")].map((n) => norm(n.textContent)), ["Book", "Confirm", "Ride"]);
    assert.equal(doc.querySelectorAll(".steps--cards").length, 0);
  });
  check("index.html: no slider is left on the homepage, no [data-slider], no .slider__tab, no class name with slider (H-05, H-07)", () => {
    assert.equal(doc.querySelectorAll("[data-slider], .slider__tab, [class*=slider]").length, 0);
    assert.equal(doc.getElementById("fleet-track").parentElement.getAttribute("aria-labelledby"), "fleet-h");
  });
  check("index.html: the fleet slides are the six classes in class order, sized to the shelf grid, with #i-user seats and their own /fleet link", () => {
    const slides = [...doc.querySelectorAll("#fleet-track > article.slide")];
    assert.deepEqual(slides.map((a) => norm(a.querySelector(".eyebrow").textContent)), ["Business SUV", "Business Premium SUV", "First Class", "Executive Sedan", "Electric Class", "Luxury Sprinter"]);
    assert.deepEqual(slides.map((a) => a.id), ["class-business-suv", "class-business-premium-suv", "class-first-class", "class-executive-sedan", "class-electric-class", "class-luxury-sprinter"]);
    assert.deepEqual(slides.map((a) => [...a.querySelectorAll(".lnk")].map((l) => l.getAttribute("href"))), ["business-suv", "business-premium-suv", "first-class", "executive-sedan", "electric-class", "luxury-sprinter"].map((id) => [`/fleet#${id}`]));
    slides.forEach((a, i) => assert.deepEqual([...a.querySelectorAll("source")].map((src) => src.getAttribute("sizes")), [SLIDE_SIZES(i), SLIDE_SIZES(i)], a.id));
    assert.deepEqual(slides.map((a) => a.querySelector(".chips li use").getAttribute("href")), Array(6).fill("#i-user"));
    assert.deepEqual(slides.slice(3, 5).map((a) => [norm(a.querySelector("h3").textContent), a.querySelector("img").getAttribute("src"), a.querySelector("img").getAttribute("alt")]), [["Mercedes-Benz E-Class or similar", "/fleet/mercedes-e-class-600.webp", "Mercedes-Benz E-Class"], ["Cadillac Lyriq or similar", "/fleet/cadillac-lyriq-600.webp", "Black Cadillac Lyriq electric SUV at dusk"]]);
    assert.equal(doc.querySelectorAll('main use[href="#i-seat"]').length, 0);
    for (const a of doc.querySelectorAll("#fleet-track .lnk")) {
      assert.equal(a.lastElementChild, a.lastChild, "the arrow is the last node of the link");
      assert.match(a.lastChild.previousSibling.textContent, /\S$/, "no space before the arrow");
    }
  });
}

const HERO_C = {
  "rates.html": { img: "/fleet/page-rates-900.webp", gold: "rates", eyebrow: "Rates", btns: ["Book a car", "Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Rates</li></ol></nav>', preload: false },
  "fleet.html": { img: "/fleet/page-fleet-900.webp", gold: "six classes", eyebrow: "Fleet", btns: null, after: ["You book a class. We confirm your car in writing before your ride.", `Child, infant and booster seats are $${CHILD_SEAT_CENTS / 100} per seat, charged at booking. Count children and infants as passengers when you choose a class.`], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Fleet</li></ol></nav>', preload: true },
  "about.html": { img: "/fleet/page-about-900.webp", gold: "NYC\u00a0LUX\u00a0RIDE", eyebrow: "Chauffeur and black car service in New York City", btns: null, crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">About</li></ol></nav>', preload: true },
  "contact.html": { img: "/fleet/page-contact-900.webp", gold: "NYC\u00a0LUX\u00a0RIDE", eyebrow: "Reservations and inquiries", btns: ["Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Contact</li></ol></nav>', preload: true },
  "faq.html": { img: "/fleet/page-faq-900.webp", gold: "questions", eyebrow: "Support", btns: null, crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">FAQ</li></ol></nav>', preload: true },
  "schedule.html": { img: "/fleet/page-schedule-900.webp", gold: "chauffeur", eyebrow: "Reservations", btns: ["Book a car", "Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Schedule a chauffeur</li></ol></nav>', preload: true },
  "corporate-car-service-nyc.html": { img: "/fleet/page-financial-district-900.webp", gold: "New\u00a0York City", eyebrow: "Corporate travel", btns: ["Book a car", "Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li><a href="/services">Services</a></li><li aria-current="page">Corporate car service</li></ol></nav>', preload: true },
};

for (const [file, want] of Object.entries(HERO_C)) {
  const doc = load(file);
  const main = doc.querySelector("main");
  const banner = main.firstElementChild;
  check(`${file}: main starts with section.banner (Hero C) labelled by its H1`, () => {
    assert.equal(banner.tagName, "SECTION");
    assert.equal(banner.className, "banner");
    const h1 = banner.querySelector("h1");
    assert.ok(h1, "no h1 in the banner");
    assert.equal(h1.id, "page-h");
    assert.equal(banner.getAttribute("aria-labelledby"), h1.id);
    assert.deepEqual(norm(h1.textContent), BASELINE.pages[file].h1[0]);
    assert.deepEqual(tags(banner), ["figure.banner__photo", "div.banner__body"]);
    assert.equal(main.querySelectorAll("h1").length, 1);
  });
  check(`${file}: the H1 sets its key words, ${want.gold}, in one span.h-gold and holds no other markup`, () => {
    const h1 = banner.querySelector("h1");
    assert.deepEqual([...h1.children].map((c) => [c.tagName, c.className, c.textContent, c.children.length]), [["SPAN", "h-gold", want.gold, 0]]);
  });
  check(`${file}: figure.banner__photo holds the twin, the page's eager photo with the banner sizes, then its caption`, () => {
    const fig = banner.querySelector(":scope > figure.banner__photo");
    assert.deepEqual(tags(fig), ["img.plate__twin", "picture", "figcaption.slate"]);
    const img = fig.querySelector("picture > img");
    assert.deepEqual(["src", "loading", "decoding", "fetchpriority"].map((k) => img.getAttribute(k)), [want.img, "eager", "sync", "high"]);
    assert.ok(img.getAttribute("alt") && img.getAttribute("width") && img.getAttribute("height"), "img lost alt, width or height");
    const sources = [...fig.querySelectorAll("picture > source")];
    assert.deepEqual(sources.map((s) => [s.getAttribute("type"), s.getAttribute("sizes")]), [["image/avif", BANNER_SIZES(img)], ["image/webp", BANNER_SIZES(img)]]);
    assert.equal(doc.querySelectorAll('img[loading="eager"]').length, 1);
  });
  check(`${file}: banner body is eyebrow, H1, lede and buttons in today's order`, () => {
    const body = banner.querySelector(":scope > div.banner__body");
    const expect = [...(want.eyebrow ? ["p.eyebrow.eyebrow--lead"] : []), "h1", "p.lede", ...(want.after || []).map(() => "p"), ...(want.btns ? ["p.btn-row"] : [])];
    assert.deepEqual(tags(body), expect);
    if (want.after) assert.deepEqual([...body.querySelectorAll(".lede ~ p:not(.btn-row)")].map((p) => norm(p.textContent)), want.after);
    if (want.eyebrow) assert.equal(norm(body.querySelector(".eyebrow").textContent), want.eyebrow);
    if (want.btns) assert.deepEqual([...body.querySelectorAll(".btn-row a")].map((a) => norm(a.textContent)), want.btns);
  });
  check(`${file}: the old two-column hero is gone and every crumbs nav carries only the crumbs class`, () => {
    assert.equal(main.querySelectorAll(":scope > section.section--tight").length, 0);
    assert.equal(main.querySelectorAll("figure.plate--product.c7-12").length, 0);
    for (const nav of main.querySelectorAll("nav.crumbs")) assert.equal(nav.className, "crumbs");
  });
  if (want.crumbs) {
    check(`${file}: the crumbs block follows the banner`, () => {
      const next = banner.nextElementSibling;
      assert.equal(next.outerHTML, `<div class="frame">${want.crumbs}</div>`);
    });
  }
  check(`${file}: the head image preload ${want.preload ? "matches the banner's AVIF source" : "stays absent"}`, () => {
    const links = [...doc.querySelectorAll('head link[rel="preload"][as="image"]')];
    if (!want.preload) return assert.equal(links.length, 0);
    assert.equal(links.length, 1);
    const [l] = links;
    const avif = banner.querySelector('picture > source[type="image/avif"]');
    assert.equal(l.getAttribute("imagesizes"), BANNER_SIZES(banner.querySelector("picture > img")));
    assert.equal(l.getAttribute("imagesrcset"), avif.getAttribute("srcset"));
    assert.equal(l.getAttribute("type"), "image/avif");
    assert.equal(l.getAttribute("fetchpriority"), "high");
    assert.equal(l.hasAttribute("media"), false);
    assert.ok(avif.getAttribute("srcset").includes(`${l.getAttribute("href")} `), "href is not a candidate of the source");
  });
}

check("rates.html: the On this page links follow the crumbs block, exact", () => {
  const doc = load("rates.html");
  const nav = doc.querySelector("main > section.banner").nextElementSibling.nextElementSibling;
  assert.equal(nav.outerHTML, '<nav class="frame" aria-label="On this page"><ul class="jumps" role="list"><li><a href="#airport">Airport transfers</a></li><li><a href="#hourly">Hourly</a></li><li><a href="#routes">Fixed-price routes</a></li><li><a href="#distance">Quotes</a></li><li><a href="#add-ons">Add-ons and terms</a></li><li><a href="#policies">Policies</a></li></ul></nav>');
  for (const id of ["airport", "hourly", "routes", "distance", "add-ons", "cancellation"]) assert.ok(doc.getElementById(id), `no #${id}`);
});

check("fleet.html: the class jump list of #fleet-all is tabs, one per class in class order, each with its set", () => {
  const doc = load("fleet.html");
  const ul = doc.querySelector('#fleet-all nav[aria-label="Vehicle classes"] > ul');
  assert.equal(ul.className, "jumps jumps--tabs");
  assert.deepEqual([...ul.querySelectorAll("a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]), [["#fleet-all", "All vehicles"], ["#business-suv", "Business SUV"], ["#business-premium-suv", "Business Premium SUV"], ["#first-class", "First Class"], ["#executive-sedan", "Executive Sedan"], ["#electric-class", "Electric Class"], ["#luxury-sprinter", "Luxury Sprinter"]]);
  assert.deepEqual([...doc.querySelectorAll(".fleet-set")].map((set) => [set.id, set.querySelectorAll(".fleet-card").length]), [["business-suv", 3], ["business-premium-suv", 1], ["first-class", 2], ["executive-sedan", 1], ["electric-class", 1], ["luxury-sprinter", 5]]);
  assert.deepEqual([...doc.querySelectorAll("#executive-sedan .fleet-card__name, #electric-class .fleet-card__name")].map((h) => norm(h.textContent)), ["Mercedes-Benz E-Class or similar", "Cadillac Lyriq or similar"]);
  assert.deepEqual([...doc.querySelectorAll("#executive-sedan figcaption.slate, #electric-class figcaption.slate")].map((f) => norm(f.textContent)), ["E-Class Executive Sedan", "Lyriq Electric Class"]);
  for (const file of ["fleet.html", "chauffeur-service-nyc.html", "black-car-service-brooklyn.html"]) {
    const card = [...load(file).querySelectorAll(".fleet-card")].find((c) => c.querySelector('img[src*="mercedes-e-class"]'));
    assert.deepEqual([norm(card.querySelector(".fleet-card__name").textContent), [...card.querySelectorAll(".fleet-card__feats li")].map((li) => norm(li.textContent)).pop(), card.querySelector("img").getAttribute("alt"), card.querySelector("img").getAttribute("src"), card.querySelector("img").getAttribute("width"), card.querySelector("img").getAttribute("height")], ["Mercedes-Benz E-Class or similar", "Pictured: Mercedes-Benz E-Class", ...(file === "fleet.html" ? ["Black Mercedes-Benz E-Class in a white studio", "/fleet/mercedes-e-class-studio-600.webp", "1800", "1200"] : ["Mercedes-Benz E-Class", "/fleet/mercedes-e-class-600.webp", "1600", "1200"])], file);
    assert.equal(load(file).querySelector('.fleet-card img[src*="cadillac-ct5-ct6"]'), null, file);
  }
  const plate = [...load("services.html").querySelectorAll("figure")].find((f) => f.querySelector('img[src*="mercedes-e-class"]'));
  assert.deepEqual([plate.querySelector("img").getAttribute("alt"), norm(plate.querySelector("figcaption").textContent)], ["Mercedes-Benz E-Class", "Mercedes-Benz E-Class Executive Sedan"]);
  const srcset = [...load("fleet.html").querySelectorAll('#executive-sedan source')].map((x) => x.getAttribute("srcset"));
  assert.deepEqual(srcset, ["avif", "webp"].map((t) => [300, 400, 600, 900, 1100, 1400].map((w) => `/fleet/mercedes-e-class-studio-${w}.${t} ${w}w`).join(", ")), "the E-Class studio photo goes through the image pipeline in every size and both formats");
  assert.equal(norm(load("blog/flying-from-new-jersey-jfk-laguardia-november-19.html").querySelector("main figure figcaption").textContent), "Cadillac XT6");
  assert.doesNotMatch(norm(doc.querySelector("main").textContent), /Sedan & Electric|CT6|XT6|Continental/);
  assert.deepEqual([...doc.querySelectorAll("#business-premium-suv .fleet-card__name")].map((h) => norm(h.textContent)), ["Cadillac Escalade ESV"]);
});

const FORMS = {
  "contact.html": [["f-name", "Full name", true], ["f-contact", "Email or mobile number", true], ["f-ref", "Booking reference", false], ["f-message", "Message", true]],
  "schedule.html": [["s-name", "Full name", true], ["s-email", "Email", true], ["s-mobile", "Mobile number", true], ["s-pickup", "Pickup address", true], ["s-destination", "Destination", true], ["s-date", "Pickup date", true], ["s-time", "Pickup time", true], ["s-flight", "Flight or train number", false], ["s-passengers", "Passengers", false], ["s-vehicle", "Vehicle class", false], ["s-notes", "Notes", false]],
};
for (const [file, fields] of Object.entries(FORMS)) {
  const form = load(file).querySelector('form[aria-labelledby="enquiry-heading"]');
  check(`${file}: the inquiry form posts to mailto as before, opens with the note, and sends by email only (4.5)`, () => {
    assert.ok(form, "no inquiry form");
    assert.deepEqual([...form.attributes].map((a) => [a.name, a.value]), [["class", "form-card"], ["action", "mailto:info@nycluxride.com"], ["method", "post"], ["enctype", "text/plain"], ["aria-labelledby", "enquiry-heading"]]);
    assert.equal(form.firstElementChild.outerHTML, `<p class="form-note">${NOTE}</p>`);
    assert.equal(form.lastElementChild.outerHTML, '<p class="btn-row"><button class="btn" type="submit">Send by email</button></p>');
    assert.equal(form.querySelectorAll("button, [type=submit], a.btn").length, 1);
    assert.equal(form.querySelectorAll(".req").length + (form.textContent.includes("Required") ? 1 : 0), 0);
  });
  check(`${file}: the fields in order, each label for its input, required marks gone, optional fields marked (optional)`, () => {
    const got = [...form.querySelectorAll(":scope > .field")].map((f) => {
      const i = f.querySelector("input, select, textarea");
      const l = f.querySelector(`label[for="${i.id}"]`);
      const opt = l.querySelector(".field__opt");
      return [i.id, norm([...l.childNodes].filter((n) => n !== opt).map((n) => n.textContent).join("")), i.required, opt ? opt.outerHTML : null];
    });
    assert.deepEqual(got, fields.map(([id, label, req]) => [id, label, req, req ? null : '<span class="field__opt"> (optional)</span>']));
  });
}
{
  const doc = load("contact.html");
  const form = doc.querySelector('form[aria-labelledby="enquiry-heading"]');
  check("contact.html: a short message form (C-03), To book a ride points to Book a car, the reference hint, no trip fields", () => {
    assert.equal(form.previousElementSibling.outerHTML, '<p>To book a ride, use <a class="lnk" href="/book">Book a car</a>.</p>');
    assert.equal(form.previousElementSibling.previousElementSibling.id, "enquiry-heading");
    assert.equal(norm(doc.getElementById("f-ref-hint").textContent), "Your reference is on your Stripe receipt.");
    assert.equal(doc.getElementById("f-ref").getAttribute("aria-describedby"), "f-ref-hint");
    assert.deepEqual(["inputmode", "autocapitalize"].map((a) => doc.getElementById("f-ref").getAttribute(a)), ["numeric", null], "the reference is 8 digits, so phones show the number keypad");
    assert.equal(doc.getElementById("f-message").tagName, "TEXTAREA");
    assert.equal(form.querySelectorAll("select, [type=date], [type=time], [name=pickup-address]").length, 0);
    assert.ok(!doc.querySelector("main").textContent.includes("Fields marked Required"));
  });
}
{
  const doc = load("schedule.html");
  const main = doc.querySelector("main");
  check("schedule.html: the short how booking works page, four steps in ol.next, exact (C-16)", () => {
    const ol = main.querySelector("ol.next");
    assert.equal(ol.getAttribute("role"), "list");
    assert.deepEqual([...ol.children].map((li) => [li.children[0].tagName, norm(li.children[0].textContent), li.children[1].tagName, norm(li.children[1].textContent)]), [
      ["B", "Send the trip", "SPAN", "Book online, call or message us on WhatsApp."],
      ["B", "We confirm in writing", "SPAN", "We confirm the car, the chauffeur and the fare in writing."],
      ["B", "Pay on Stripe", "SPAN", "Pay online when you book, or by a payment link we send you."],
      ["B", "On the day", "SPAN", "We track your flight and move the pickup if it lands early or late."],
    ]);
    assert.equal(main.querySelectorAll("ol.steps").length, 0);
  });
  check("schedule.html: five facts in the forms of 6.4 with P1 word for word, then See all add-ons and terms", () => {
    const dl = [...main.querySelectorAll("dl.facts")];
    assert.equal(dl.length, 1);
    assert.deepEqual([...dl[0].querySelectorAll("dt")].map((dt) => [norm(dt.textContent), norm(dt.nextElementSibling.textContent)]), [
      ["Booking ahead", "Online at least 90 minutes before pickup. Sooner by email or WhatsApp when a car is free."],
      ["Free waiting", "45 minutes after a domestic landing, 60 after an international landing, 15 at any other pickup."],
      ["By the hour", "Any class, with a 3-hour minimum, or 4 hours in a Sprinter."],
      ["First booking", "We may ask for a card authorization."],
      ["Cancellation", P1],
    ]);
    const cancel = [...dl[0].querySelectorAll("dd")].at(-1);
    assert.deepEqual([...cancel.querySelectorAll("a")].map((a) => a.getAttribute("href")), ["mailto:info@nycluxride.com", "https://wa.me/16467750556"]);
    assert.equal(dl[0].nextElementSibling.outerHTML, `<p><a class="lnk" href="/rates#add-ons">See all add-ons and terms${ARROW}</a></p>`);
  });
  check("schedule.html: the inquiry form sits inside a closed details.acc, Send the details by email", () => {
    const d = main.querySelector('form[aria-labelledby="enquiry-heading"]').parentElement;
    assert.ok(d.matches("details.acc") && !d.open, "the form is not in a closed details.acc");
    assert.equal(norm(d.querySelector(":scope > summary").textContent), "Send the details by email");
    assert.deepEqual([...main.querySelectorAll("a.btn:not(.btn--ghost)")].map((a) => [a.closest("section").className, a.getAttribute("href")]), [["banner", "/book"], ["section section--close frame", "/book"]]);
  });
  check("schedule.html: the email form's date hint sends a pickup within the next 90 minutes to WhatsApp, not back to email", () => {
    assert.equal(norm(main.querySelector('form[aria-labelledby="enquiry-heading"] #s-date-hint').textContent), "Send the trip at least 90 minutes before pickup. For a pickup within the next 90 minutes, message us on WhatsApp.");
  });
}

const HERO_D = {
  "card-authorization.html": { first: "how-it-works", name: "Card authorization", band: ["nav.crumbs", "p.eyebrow.eyebrow--lead", "h1", "p.lede"], grid: ["div.c1-8.prose", "div.c9-12.rail"] },
  "privacy-policy.html": { first: "scope", name: "Privacy policy", band: ["nav.crumbs", "p.eyebrow.eyebrow--lead", "h1", "p.lede", "p"], grid: ["div.c9-12.rail", "div.c1-8.prose"] },
  "terms-of-service.html": { first: "acceptance", name: "Terms of service", band: ["nav.crumbs", "p.eyebrow.eyebrow--lead", "h1", "p.lede", "p"], grid: ["div.c9-12.rail", "div.c1-8.prose"] },
};
for (const [file, want] of Object.entries(HERO_D)) {
  const doc = load(file);
  const main = doc.querySelector("main");
  check(`${file}: main is a section.band.frame title band, then a section.section.frame that starts with the first h2`, () => {
    assert.deepEqual(tags(main), ["section.band.frame", "section.section.frame"]);
    const [band, rest] = main.children;
    assert.deepEqual(tags(band), ["div.prose"]);
    assert.deepEqual(tags(band.firstElementChild), want.band);
    assert.equal(norm(band.querySelector("h1").textContent), BASELINE.pages[file].h1[0]);
    assert.equal(band.querySelectorAll("h2").length, 0);
    if (want.band.length === 5) assert.match(norm(band.querySelector("p:last-child").textContent), /^Last Updated: /);
    assert.equal(band.querySelector("nav.crumbs").outerHTML, `<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">${want.name}</li></ol></nav>`);
    assert.deepEqual(tags(rest), ["div.grid12"]);
    assert.deepEqual(tags(rest.firstElementChild), want.grid);
    const prose = rest.querySelector(".c1-8.prose");
    const first = file === "card-authorization.html" ? prose.children[1] : prose.firstElementChild;
    assert.equal(first.tagName, "H2");
    assert.equal(first.id, want.first);
    assert.equal(doc.querySelector("main h2:not(.tip h2)"), first);
  });
}
for (const file of ["privacy-policy.html", "terms-of-service.html"]) {
  check(`${file}: the rail with the sections list comes first in the grid, so Tab and screen readers meet it before the text (C-18)`, () => {
    const rail = load(file).querySelector("main > section.section > .grid12 > :first-child");
    assert.ok(rail.matches("div.c9-12.rail"), rail.className);
    assert.equal(rail.querySelector(":scope > nav.toc").getAttribute("aria-label").startsWith("Sections of "), true);
    assert.equal(rail.querySelectorAll("nav.toc a").length, file === "privacy-policy.html" ? 14 : 16);
  });
}
{
  const doc = load("card-authorization.html");
  check("card-authorization.html: What we never ask for is an aside.tip with i-shield at the top of the first section, its h2 and id kept, its words in the we voice (C38, heading order)", () => {
    const tip = doc.querySelector("main > section.section > .grid12 > .c1-8.prose > :first-child");
    assert.ok(tip.matches("aside.tip"), tip.tagName);
    assert.equal(tip.getAttribute("aria-labelledby"), "what-is-never-asked");
    assert.deepEqual(tags(tip), ["svg.icon", "h2", "ul", "p"]);
    assert.equal(tip.querySelector("svg use").getAttribute("href"), "#i-shield");
    assert.equal(tip.querySelector("h2").outerHTML, '<h2 id="what-is-never-asked">What we never ask for</h2>');
    assert.deepEqual([...tip.querySelectorAll("li")].map((li) => norm(li.textContent)), ["Card numbers, security codes or expiration dates sent by phone, email, text message or WhatsApp.", "A photograph of a card, front or back.", "A copy or photograph of a passport, driver's license or any other identity document."]);
    assert.equal(norm(tip.querySelector("p").textContent), "Any request like that is fraud, whatever name or number it comes from. Report it to info@nycluxride.com, and call +1 (646) 775-0556 to check your booking.");
    assert.equal(doc.querySelectorAll("#what-is-never-asked").length, 1);
  });
}

const COPY = [
  ["card-authorization.html", "When the booking page can price the trip, it opens the Stripe payment page straight away.", "When the booking page can price the trip, it asks for your details and then opens the Stripe payment page."],
  ["privacy-policy.html", "In the booking form, on the booking page, the homepage and the JFK and LaGuardia pages, you enter the trip type, the pickup and drop-off locations and any stops, the date and time, an optional return trip, the number of passengers, the hours for a trip by the hour, the vehicle class or vehicle, meet and greet, an optional gratuity and an optional flight number. On Stripe's payment page you enter your name, email, phone and card, which is saved for the charges after the ride, and optionally the passenger's name and mobile, a name for the sign and notes for your chauffeur.", "When you book a ride, you enter the trip type, the pickup, drop-off and any stops, the date and time, an optional return trip, the number of passengers and large, medium and small suitcases, the hours for a trip by the hour, the vehicle class or vehicle, the number of child, infant and booster seats and small and large dogs, meet and greet, an optional gratuity and flight number for the pickup and the return. Before payment, we ask for your name, email, mobile number and whether we should call or WhatsApp you. You can also add the passenger's name and mobile, a name for the sign and notes for your chauffeur. You enter your card on Stripe's payment page, which may also ask for your name, email and mobile. The card is saved for any charges after the ride."],
  ["privacy-policy.html", "The booking form keeps the trip you enter, and the confirmation page keeps your payment reference, in your browser's session storage until the tab closes.", "The booking form keeps the trip and the details you enter, and the confirmation page keeps your payment reference, in your browser's session storage until the tab closes."],
  ["privacy-policy.html", "Trip details entered in the booking form are sent to NYC LUX RIDE to prepare the booking.", "Your trip and contact details are sent to NYC LUX RIDE to prepare the booking."],
];
COPY.forEach(([file, old, neu], i) => {
  check(`${file}: copy change ${i + 1} of 5.11 is exact and the old sentence is gone`, () => {
    const text = norm(load(file).querySelector("main").textContent);
    assert.ok(text.includes(neu), `missing: ${neu}`);
    assert.ok(!text.includes(old), `still there: ${old}`);
  });
});
check("privacy-policy.html: section 2 starts with the new paragraph and the session storage line is its last paragraph", () => {
  const doc = load("privacy-policy.html");
  const ps = [];
  for (let n = doc.getElementById("information-we-collect").nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) ps.push(norm(n.textContent));
  assert.equal(ps[0], COPY[1][2]);
  assert.equal(ps.at(-1), COPY[2][2]);
  const next = doc.getElementById("how-we-collect").nextElementSibling.nextElementSibling;
  assert.ok(norm(next.textContent).startsWith(COPY[3][2]), norm(next.textContent).slice(0, 120));
});
check("privacy-policy.html: section 2 names the child, infant and booster seat counts the booking form asks for, and the paragraph without them is gone", () => {
  const text = norm(load("privacy-policy.html").querySelector("main").textContent);
  assert.ok(text.includes(COPY[1][2]) && COPY[1][2].includes("the number of child, infant and booster seats and small and large dogs, meet and greet"), COPY[1][2]);
  assert.ok(!text.includes("In the booking form, on the booking page, the homepage, the service and area pages and the JFK, LaGuardia and Newark pages, you enter the trip type, the pickup and drop-off locations and any stops, the date and time, an optional return trip, the number of passengers, the hours for a trip by the hour, the vehicle class or vehicle, the number of child, infant and booster seats, the number of small and large dogs, meet and greet, an optional gratuity and an optional flight number. Before payment the booking page asks for your name, email and mobile number, whether dispatch should contact you by phone or WhatsApp, and optionally the passenger's name and mobile, a name for the sign and notes for your chauffeur. On Stripe's payment page you enter your card, which is saved for the charges after the ride, and also your name, email and mobile number if the booking page did not send them."));
  assert.ok(!text.includes("In the booking form, on the booking page, the homepage, the service and area pages and the JFK, LaGuardia and Newark pages, you enter the trip type, the pickup and drop-off locations and any stops, the date and time, an optional return trip, the number of passengers, the hours for a trip by the hour, the vehicle class or vehicle, meet and greet, an optional gratuity and an optional flight number. Before payment the booking page asks for your name, email and mobile number, whether dispatch should contact you by phone or WhatsApp, and optionally the passenger's name and mobile, a name for the sign and notes for your chauffeur. On Stripe's payment page you enter your card, which is saved for the charges after the ride, and also your name, email and mobile number if the booking page did not send them."));
});
check("privacy-policy.html: section 2 names the large, medium and small suitcase counts the booking form asks for, next to the passengers, and the paragraphs without them are gone", () => {
  const text = norm(load("privacy-policy.html").querySelector("main").textContent);
  assert.ok(COPY[1][2].includes("an optional return trip, the number of passengers and large, medium and small suitcases, the hours for a trip by the hour,") && text.includes(COPY[1][2]), COPY[1][2]);
  assert.ok(!text.includes("an optional return trip, the number of passengers, the hours for a trip by the hour,"));
  assert.ok(!text.includes("the number of passengers and bags,"));
});
check("privacy-policy.html: section 2 names the small and large dog counts the booking form asks for, and the paragraph without them is gone", () => {
  const text = norm(load("privacy-policy.html").querySelector("main").textContent);
  assert.ok(text.includes("the vehicle class or vehicle, the number of child, infant and booster seats and small and large dogs, meet and greet, an optional gratuity and flight number for the pickup and the return."));
  assert.ok(!text.includes("the number of child, infant and booster seats, meet and greet"));
});
check("privacy-policy.html: Last Updated November 22, 2026 and WebPage dateModified 2026-11-22", () => {
  const doc = load("privacy-policy.html");
  const page = graph(doc).find((n) => n["@type"] === "WebPage");
  assert.equal(page.dateModified, "2026-11-22");
  const lines = [...doc.querySelectorAll("main p")].map((p) => norm(p.textContent)).filter((t) => t.startsWith("Last Updated:"));
  assert.deepEqual(lines, ["Last Updated: November 22, 2026"]);
});
check("privacy-policy.html: section 3 says the booking details are emailed to the customer and to NYC LUX RIDE through Gmail, right after the Stripe sentence, and nowhere else", () => {
  const doc = load("privacy-policy.html");
  const said = "When you pay online, your booking details go to Stripe, which hosts the payment page and keeps them with the payment record. After you pay, the booking details are emailed to you and to NYC LUX RIDE through Gmail, Google's email service. Stripe processes your card, and NYC LUX RIDE never receives or stores full card numbers.";
  const next = norm(doc.getElementById("how-we-collect").nextElementSibling.nextElementSibling.textContent);
  assert.ok(next.includes(said), next);
  assert.equal(norm(doc.querySelector("main").textContent).split("are emailed").length, 2);
});
check("privacy-policy.html: the lede names email clicks, section 2 says the Google tag also sends each page view and an event for call, WhatsApp and email taps and a count of paid bookings with the booking reference and no amount to Google and names its _ga and _ga_9MT2ZW7LPV cookies, and section 6 links the Google policy for Google Analytics and Gmail", () => {
  const doc = load("privacy-policy.html");
  const ps = [];
  for (let n = doc.getElementById("information-we-collect").nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) ps.push(norm(n.textContent));
  const tag = ps.find((t) => t.startsWith("Every page loads the Google Ads tag"));
  assert.ok(tag.includes("in your browser's local storage. The tag also sends each page view to Google Analytics, and an event when you tap to call, message us on WhatsApp or email us. When you pay for a booking, Google gets a count of paid bookings with the booking reference, not the amount. Google Analytics sets the _ga and _ga_9MT2ZW7LPV cookies on this site. Third-party vendors"), tag);
  assert.ok(norm(doc.querySelector("main .lede").textContent).includes("the Google Ads tag that measures ad results such as Book a car, call, WhatsApp and email clicks."), norm(doc.querySelector("main .lede").textContent));
  assert.deepEqual([...doc.querySelectorAll('main a[href="https://policies.google.com/privacy"]')].map((a) => norm(a.textContent)), ["Google Privacy Policy (Google Ads, Google Analytics, Gmail, Maps) (opens in a new tab)"]);
});
check("about.html: the At a glance service areas figure equals the number of area guides and the count in the copy above it", () => {
  const doc = load("about.html");
  const guides = readdirSync(join(ROOT, "locations")).filter((f) => f.endsWith(".html")).length;
  const dt = [...doc.querySelectorAll("main dl.facts dt")].find((d) => norm(d.textContent) === "Service areas");
  assert.equal(norm(dt.nextElementSibling.textContent), String(guides));
  assert.ok(norm(doc.querySelector("main").textContent).includes(`Our guides cover ${guides} areas:`));
});
check("rates.html: the OfferCatalog carries no provider, which schema.org does not define for it, and stays the main entity of a WebPage about the business", () => {
  const nodes = graph(load("rates.html"));
  const catalog = nodes.find((n) => n["@type"] === "OfferCatalog");
  const page = nodes.find((n) => n["@type"] === "WebPage");
  assert.equal(Object.hasOwn(catalog, "provider"), false);
  assert.deepEqual([page.mainEntity, page.about], [{ "@id": catalog["@id"] }, { "@id": "https://www.nycluxride.com/#organization" }]);
});
check("privacy-policy.html: section 2 lists the fields the schedule and contact forms ask for, and no others", () => {
  const fields = (file) => [...load(file).querySelectorAll("main form label")].map((l) => norm(l.textContent));
  assert.deepEqual(fields("schedule.html"), ["Full name", "Email", "Mobile number", "Pickup address", "Destination", "Pickup date", "Pickup time", "Flight or train number (optional)", "Passengers (optional)", "Vehicle class (optional)", "Notes (optional)"]);
  assert.deepEqual(fields("contact.html"), ["Full name", "Email or mobile number", "Booking reference (optional)", "Message"]);
  const doc = load("privacy-policy.html");
  const ps = [];
  for (let n = doc.getElementById("information-we-collect").nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) if (/\b(schedule|contact) forms?\b/.test(n.textContent)) ps.push(norm(n.textContent));
  assert.deepEqual(ps, ["The schedule form asks for your name, email, mobile, pickup address, destination, date and time. You can also add a flight or train number, the number of passengers, a vehicle class and notes. The contact form asks for your name, an email or mobile number and your message, and you can add a booking reference. These forms open your email app with the details filled in, and nothing is sent until you send that email."]);
});
const LASTMOD = {"https://www.nycluxride.com/": "2026-11-24", "https://www.nycluxride.com/about": "2026-11-24", "https://www.nycluxride.com/black-car-service-brooklyn": "2026-11-24", "https://www.nycluxride.com/blog": "2026-11-25", "https://www.nycluxride.com/blog/best-black-car-service-brooklyn-queens-march-20": "2026-11-24", "https://www.nycluxride.com/blog/car-seats-nyc-car-service-parents-november-19": "2026-11-25", "https://www.nycluxride.com/blog/chauffeur-service-nyc-booking-guide-april-30": "2026-11-21", "https://www.nycluxride.com/blog/corporate-black-car-nyc-april-3": "2026-11-20", "https://www.nycluxride.com/blog/dog-nyc-to-boston-or-dc-november-19": "2026-11-24", "https://www.nycluxride.com/blog/flying-from-new-jersey-jfk-laguardia-november-19": "2026-11-22", "https://www.nycluxride.com/blog/jfk-lga-ewr-airport-transfer-guide-april-17": "2026-11-24", "https://www.nycluxride.com/blog/manhattan-hourly-chauffeur-service-april-10": "2026-11-20", "https://www.nycluxride.com/blog/nyc-cruise-terminal-black-car-service-guide-march-6": "2026-11-24", "https://www.nycluxride.com/blog/nyc-limo-service-comparison-guide-april-29": "2026-11-24", "https://www.nycluxride.com/blog/nyc-prom-limo-booking-guide-march-13": "2026-11-24", "https://www.nycluxride.com/blog/nyc-to-philadelphia-kids-car-or-amtrak-november-19": "2026-11-24", "https://www.nycluxride.com/blog/roadshow-day-manhattan-planning-november-19": "2026-11-24", "https://www.nycluxride.com/blog/stewart-westchester-macarthur-airports-by-car-november-19": "2026-11-24", "https://www.nycluxride.com/blog/teterboro-airport-fbos-manhattan-november-19": "2026-11-24", "https://www.nycluxride.com/blog/wedding-event-limo-nyc-march-27": "2026-11-24", "https://www.nycluxride.com/blog/whatsapp-airport-pickup-coordination-nyc-april-24": "2026-11-20", "https://www.nycluxride.com/book": "2026-11-24", "https://www.nycluxride.com/car-service-with-car-seat-nyc": "2026-11-25", "https://www.nycluxride.com/card-authorization": "2026-11-21", "https://www.nycluxride.com/chauffeur-service-nyc": "2026-11-25", "https://www.nycluxride.com/contact": "2026-11-20", "https://www.nycluxride.com/corporate-car-service-nyc": "2026-11-24", "https://www.nycluxride.com/cruise-terminal-car-service-nyc": "2026-11-24", "https://www.nycluxride.com/faq": "2026-11-24", "https://www.nycluxride.com/fleet": "2026-11-24", "https://www.nycluxride.com/limousine-service-nyc": "2026-11-25", "https://www.nycluxride.com/locations": "2026-11-24", "https://www.nycluxride.com/locations/alpine-tenafly": "2026-11-24", "https://www.nycluxride.com/locations/atlantic-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/bergen-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/bradley-airport": "2026-11-22", "https://www.nycluxride.com/locations/bronx": "2026-11-22", "https://www.nycluxride.com/locations/brooklyn": "2026-11-22", "https://www.nycluxride.com/locations/burlington-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/camden-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/cape-may-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/cumberland-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/edgewater": "2026-11-22", "https://www.nycluxride.com/locations/englewood": "2026-11-22", "https://www.nycluxride.com/locations/essex-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/financial-district": "2026-11-22", "https://www.nycluxride.com/locations/fort-lee": "2026-11-22", "https://www.nycluxride.com/locations/gloucester-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/greenwich-ct": "2026-11-22", "https://www.nycluxride.com/locations/hamptons": "2026-11-22", "https://www.nycluxride.com/locations/hoboken": "2026-11-25", "https://www.nycluxride.com/locations/hudson-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/hunterdon-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/jersey-city": "2026-11-22", "https://www.nycluxride.com/locations/jfk-airport": "2026-11-24", "https://www.nycluxride.com/locations/laguardia-airport": "2026-11-24", "https://www.nycluxride.com/locations/long-island": "2026-11-22", "https://www.nycluxride.com/locations/long-island-city": "2026-11-24", "https://www.nycluxride.com/locations/long-island-macarthur-airport": "2026-11-22", "https://www.nycluxride.com/locations/manhattan": "2026-11-24", "https://www.nycluxride.com/locations/mercer-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/middlesex-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/midtown-manhattan": "2026-11-22", "https://www.nycluxride.com/locations/monmouth-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/morris-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/morristown": "2026-11-22", "https://www.nycluxride.com/locations/morristown-airport": "2026-11-22", "https://www.nycluxride.com/locations/new-jersey": "2026-11-24", "https://www.nycluxride.com/locations/newark-airport": "2026-11-24", "https://www.nycluxride.com/locations/newark-nj": "2026-11-22", "https://www.nycluxride.com/locations/ocean-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/paramus": "2026-11-22", "https://www.nycluxride.com/locations/passaic-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/philadelphia-airport": "2026-11-22", "https://www.nycluxride.com/locations/princeton": "2026-11-24", "https://www.nycluxride.com/locations/queens": "2026-11-22", "https://www.nycluxride.com/locations/republic-airport": "2026-11-22", "https://www.nycluxride.com/locations/salem-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/secaucus": "2026-11-22", "https://www.nycluxride.com/locations/short-hills-livingston": "2026-11-24", "https://www.nycluxride.com/locations/soho": "2026-11-25", "https://www.nycluxride.com/locations/somerset-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/stamford-ct": "2026-11-24", "https://www.nycluxride.com/locations/staten-island": "2026-11-22", "https://www.nycluxride.com/locations/stewart-airport": "2026-11-22", "https://www.nycluxride.com/locations/summit": "2026-11-24", "https://www.nycluxride.com/locations/sussex-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/teterboro-airport": "2026-11-24", "https://www.nycluxride.com/locations/union-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/upper-east-side": "2026-11-22", "https://www.nycluxride.com/locations/upper-west-side": "2026-11-24", "https://www.nycluxride.com/locations/warren-county-nj": "2026-11-25", "https://www.nycluxride.com/locations/weehawken-north-bergen": "2026-11-22", "https://www.nycluxride.com/locations/westchester-airport": "2026-11-22", "https://www.nycluxride.com/locations/westchester-county": "2026-11-22", "https://www.nycluxride.com/long-distance-car-service": "2026-11-24", "https://www.nycluxride.com/long-distance-car-service/nyc-to-atlantic-city": "2026-11-24", "https://www.nycluxride.com/long-distance-car-service/nyc-to-boston": "2026-11-24", "https://www.nycluxride.com/long-distance-car-service/nyc-to-connecticut": "2026-11-24", "https://www.nycluxride.com/long-distance-car-service/nyc-to-philadelphia": "2026-11-24", "https://www.nycluxride.com/long-distance-car-service/nyc-to-washington-dc": "2026-11-24", "https://www.nycluxride.com/pet-friendly-car-service-nyc": "2026-11-24", "https://www.nycluxride.com/privacy-policy": "2026-11-22", "https://www.nycluxride.com/private-jet-car-service-nyc": "2026-11-24", "https://www.nycluxride.com/rates": "2026-11-25", "https://www.nycluxride.com/roadshow-transportation-nyc": "2026-11-24", "https://www.nycluxride.com/schedule": "2026-11-24", "https://www.nycluxride.com/services": "2026-11-24", "https://www.nycluxride.com/sprinter-van-service-nyc": "2026-11-24", "https://www.nycluxride.com/terms-of-service": "2026-11-21", "https://www.nycluxride.com/wedding-car-service-nyc": "2026-11-24"};
check("sitemap.xml: every URL carries the date its content, structured data or links last changed, 2026-11-20 for every page after release 1, 2026-11-21 for the pages that gained the waiting, cancellation and child seat policies, 2026-11-22 for the privacy policy and the pages that renamed the child seats and gained the medium suitcase, 2026-11-24 for the pages that gained the 3 hour Sprinter notice, the two SUVs line, six SUV seats, the child seat limits, the $350 Sprinter minimum or the E-Class photo, 2026-11-25 for the 21 New Jersey county pages that went live that day and the pages whose copy changed for search (the car seat, rates, chauffeur, limousine, SoHo and Hoboken pages, the car seat post and the blog list), and the URL list equals the baseline", () => {
  const xml = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
  const mods = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(mods.map(([loc]) => loc), BASELINE.sitemap);
  assert.deepEqual(Object.fromEntries(mods), LASTMOD);
  assert.equal(xml.split("<url>").length - 1, BASELINE.sitemap.length, "a URL without its lastmod");
});
check("the three posts that gained links keep their dateModified, so a new lastmod never rewrites a post date", () => {
  const dates = (f) => { const d = load(f); return [...d.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { const j = JSON.parse(s.textContent); return j["@graph"] || [j]; }).map((n) => n.dateModified).filter(Boolean); };
  assert.deepEqual(dates("blog/whatsapp-airport-pickup-coordination-nyc-april-24.html"), ["2026-10-12T12:00:00.000Z"]);
  assert.deepEqual(dates("blog/jfk-lga-ewr-airport-transfer-guide-april-17.html"), ["2026-10-12T12:00:00.000Z"]);
  assert.deepEqual(dates("blog/best-black-car-service-brooklyn-queens-march-20.html"), ["2026-10-14T12:00:00.000Z"]);
});

{
  const doc = load("404.html");
  const main = doc.querySelector("main");
  const banner = main.firstElementChild;
  check("404.html: main starts with section.banner.banner--message labelled by h1#page-h", () => {
    assert.equal(banner.tagName, "SECTION");
    assert.equal(banner.className, "banner banner--message");
    assert.equal(banner.getAttribute("aria-labelledby"), "page-h");
    assert.deepEqual(tags(banner), ["figure.banner__photo", "div.banner__body"]);
  });
  check("404.html: the banner photo is the twin and the eager page-404 picture at the banner sizes", () => {
    const fig = banner.querySelector(":scope > figure.banner__photo");
    assert.deepEqual(tags(fig), ["img.plate__twin", "picture"]);
    const set = (ext) => [300, 400, 600, 900, 1100, 1400, 1800].map((w) => `/fleet/page-404-${w}.${ext} ${w}w`).join(", ");
    const sources = [...fig.querySelectorAll("picture > source")].map((s) => [s.getAttribute("type"), s.getAttribute("srcset"), s.getAttribute("sizes")]);
    const img = fig.querySelector("picture > img");
    assert.deepEqual(sources, [["image/avif", set("avif"), BANNER_SIZES(img)], ["image/webp", set("webp"), BANNER_SIZES(img)]]);
    assert.deepEqual(
      ["src", "width", "height", "alt", "loading", "decoding", "fetchpriority"].map((k) => img.getAttribute(k)),
      ["/fleet/page-404-900.webp", "1800", "1200", "Chauffeurs opening the doors of a black Cadillac Escalade and a Mercedes-Benz S-Class by the city skyline at sunset", "eager", "sync", "high"],
    );
    assert.equal(doc.querySelectorAll('img[loading="eager"]').length, 1);
  });
  check("404.html: banner body is the eyebrow, the H1, the lede and the two buttons", () => {
    const body = banner.querySelector(":scope > div.banner__body");
    assert.deepEqual(tags(body), ["p.eyebrow.eyebrow--lead", "h1", "p.lede", "p.btn-row"]);
    assert.equal(norm(body.querySelector(".eyebrow").textContent), "Error 404");
    assert.equal(body.querySelector("h1").outerHTML, '<h1 id="page-h">Nothing at <span class="h-gold">this address</span></h1>');
    assert.equal(norm(body.querySelector(".lede").textContent), "The address may be mistyped, or the link may be out of date. Try one of the pages below.");
    assert.deepEqual([...body.querySelectorAll(".btn-row a")].map((a) => [a.className, a.getAttribute("href"), norm(a.textContent)]), [["btn", "/book", "Book a car"], ["btn btn--ghost", "tel:+16467750556", "Call +1 (646) 775-0556"]]);
  });
  check("404.html: Where to go next comes first with the empty guess line, the Reservations rail after the ledger (C-19)", () => {
    const next = banner.nextElementSibling;
    assert.equal(next.className, "section frame");
    const stack = next.querySelector(":scope > div.stack");
    assert.deepEqual(tags(stack), ["p.nf-guess", "h2", "ul.ledger.ledger--pair", "div.c9-12.rail"]);
    assert.equal(stack.firstElementChild.outerHTML, '<p class="nf-guess" id="nf-guess"></p>');
    assert.equal(norm(stack.querySelector("h2").textContent), "Where to go next");
    const areas = stack.querySelector('a.ledger__row[href="/locations"] .ledger__note');
    assert.equal(norm(areas.textContent), "Guides to the boroughs, the airports and the towns around New York.");
    assert.ok(!doc.querySelector("main").textContent.includes("book the most rides"));
    const rail = stack.lastElementChild;
    assert.equal(norm(rail.querySelector(".eyebrow").textContent), "Reservations");
    assert.deepEqual([...rail.querySelectorAll(".facts dt")].map((d) => norm(d.textContent)), ["Phone", "Email", "Dispatch", "Booking"]);
    assert.match(rail.querySelector("a.btn").getAttribute("href"), /^https:\/\/wa\.me\/16467750556/);
    assert.equal(main.children.length, 2);
  });
  check("404.html: Where to go next links the guides to all three airports the Service areas row names, Newark after LaGuardia", () => {
    const air = [...banner.nextElementSibling.querySelectorAll("a.ledger__row")].filter((a) => /-airport$/.test(a.getAttribute("href")));
    const note = "Terminals, where we meet you, and flat rates from any New York City address.";
    assert.deepEqual(air.map((a) => [a.getAttribute("href"), norm(a.querySelector(".ledger__name").textContent), norm(a.querySelector(".ledger__note").textContent)]), [["/locations/jfk-airport", "JFK Airport", note], ["/locations/laguardia-airport", "LaGuardia Airport", note], ["/locations/newark-airport", "Newark Airport", note]]);
  });
  check("404.html: noindex and no canonical", () => {
    assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex");
    assert.equal(doc.querySelector('link[rel="canonical"]'), null);
  });
}

{
  const doc = load("rates.html");
  const rows = (sel) => [...doc.querySelectorAll(sel)];
  check("rates.html: each airport row ends with Book in its LaGuardia cell, Request for the Luxury Sprinter, each hourly row with Book by the hour in its Three hours cell, never in the th (C-06, F42)", () => {
    assert.deepEqual(rows("#airport-rates tbody tr").map((tr) => tr.lastElementChild.querySelector("a").outerHTML), KEYS.map((k) => `<a class="lnk lnk--row" href="/book?class=${k}">${k === "sprinter" ? "Request" : "Book"}<span class="sr-only"> ${/^[AEIOU]/.test(CLASSES[k].name) ? "an" : "a"} ${CLASSES[k].name.replace("&", "&amp;")}${k === "electric" ? " car" : ""}</span></a>`));
    assert.deepEqual(rows("#hourly tbody tr").map((tr) => tr.lastElementChild.querySelector("a").outerHTML), BY_HOUR.map((k) => `<a class="lnk lnk--row" href="/book?trip-type=hour&amp;hours=3&amp;class=${k}">Book by the hour<span class="sr-only">, ${CLASSES[k].name.replace("&", "&amp;")}</span></a>`));
    assert.deepEqual(rows("#sprinter-airport tbody tr").map((tr) => tr.lastElementChild.querySelector("a").outerHTML), [...SPRINTER_KEY].map(([v, k]) => `<a class="lnk lnk--row" href="/book?class=sprinter&amp;sprinter=${k}">Request<span class="sr-only"> ${/^[AEIOU]/.test(v.name) ? "an" : "a"} ${v.name}</span></a>`));
    assert.equal(doc.querySelectorAll(".rate-table th a, .rate-table td:not(:last-child) a.lnk--row").length, 0);
  });
  check("rates.html: Who is traveling? chips right before the airport table, data-seats and the two fit spans in each row header after the class name (C-23)", () => {
    const f = doc.querySelector("fieldset.fits");
    assert.equal(f.outerHTML, FITS);
    assert.ok(f.nextElementSibling.matches(".table-scroll") && f.nextElementSibling.querySelector("#airport-rates"), "the chips do not sit right before the airport table");
    const fit = (seats) => ['<span class="fits-yes">Fits your group</span>', `<span class="fits-no">Seats ${seats}</span>`];
    for (const [sel, want] of [["#airport-rates tbody tr", KEYS.map((k) => [CLASSES[k].name, CLASSES[k].seats])], ["#sprinter-airport tbody tr", SPRINTERS.map((v) => [v.name, v.seats])], ["#hourly tbody tr", BY_HOUR.map((k) => [CLASSES[k].name, CLASSES[k].seats])], ["#route-rates tbody tr", KEYS.filter((k) => k !== "sprinter").map((k) => [CLASSES[k].name, CLASSES[k].seats])]]) {
      assert.deepEqual(rows(sel).map((tr) => tr.dataset.seats), want.map(([, seats]) => String(seats)));
      assert.deepEqual(rows(sel).map((tr) => { const th = tr.querySelector("th"); return [th.firstChild.textContent, [...th.children].map((c) => c.outerHTML).slice(0, 2)]; }), want.map(([name, seats]) => [name, fit(seats)]));
    }
  });
  check("rates.html: each fixed-price route row carries data-seats and the two fit spans after the class name, so Who is traveling? marks it as in the airport and hourly tables, and the distance table is gone", () => {
    const keys = Object.keys(CLASSES).filter((k) => k !== "sprinter");
    assert.deepEqual(Object.keys(DISTANCE_RATES), [...keys, CLASS_DEFAULT_VEHICLE.sprinter]);
    assert.equal(doc.getElementById("distance-rates"), null);
    assert.deepEqual(rows("#route-rates tbody tr").map((tr) => [tr.id, tr.dataset.seats]), keys.map((k) => [`route-${k}`, String(CLASSES[k].seats)]));
    assert.deepEqual(rows("#route-rates tbody tr").map((tr) => { const th = tr.querySelector("th"); return [th.firstChild.textContent, [...th.children].map((c) => c.outerHTML)]; }), keys.map((k) => [CLASSES[k].name, ['<span class="fits-yes">Fits your group</span>', `<span class="fits-no">Seats ${CLASSES[k].seats}</span>`]]));
  });
  check("rates.html: the closing card ends with Book a car, WhatsApp, then the reviews link (C-21, F13)", () => {
    const close = doc.querySelector("main .section--close");
    assert.deepEqual([...close.querySelectorAll("a:not([href^='tel:'])")].map((a) => norm(a.textContent)), ["Book a car", "Book on WhatsApp", "Read the reviews on Google Maps (opens in a new tab)"]);
    assert.equal(close.querySelector("p.btn-row").nextElementSibling.outerHTML, REVIEWS);
  });
}
{
  const doc = load("fleet.html");
  const cards = [...doc.querySelectorAll("article.fleet-card")];
  const SET = { "business-suv": "suv", "business-premium-suv": "premium", "first-class": "first", "executive-sedan": "sedan", "electric-class": "electric", "luxury-sprinter": "sprinter" };
  const vehicleOf = (c) => SPRINTERS.find((v) => v.name === norm(c.querySelector("h3.fleet-card__name").textContent));
  check("fleet.html: the 13 rate links point at the airport row of their class, or the Sprinter's own row on rates.html, the 13 Book a car links carry ?class=, the Sprinter ones their Sprinter too, text and aria-label kept (C-05, C-06)", () => {
    assert.equal(cards.length, 13);
    assert.deepEqual(cards.filter(vehicleOf).map((c) => SPRINTER_KEY.get(vehicleOf(c))), [...SPRINTER_KEY.values()]);
    for (const c of cards) {
      const k = SET[c.closest(".fleet-set").id];
      const [rates, book] = c.querySelectorAll(".fleet-card__cta a");
      const only = (vehicleOf(c) || {}).hourlyOnly;
      const own = vehicleOf(c) ? `/rates#${SPRINTER_KEY.get(vehicleOf(c)).replace("sprinter-", "sprinter-airport-")}` : `/rates#airport-${k}`;
      assert.equal(rates.getAttribute("href"), only ? "/rates#luxury-sprinter" : own);
      if (vehicleOf(c)) {
        const target = load("rates.html").getElementById(own.split("#")[1]);
        assert.ok(target && target.closest("#sprinter-airport"), own);
        assert.equal(norm(target.querySelector("th").firstChild.textContent), vehicleOf(c).name, own);
      }
      const pick = vehicleOf(c) ? `&sprinter=${SPRINTER_KEY.get(vehicleOf(c))}` : "";
      assert.equal(book.getAttribute("href"), only ? `/book?trip-type=hour&hours=${vehicleOf(c).minHours}&class=${k}${pick}` : `/book?class=${k}${pick}`);
      assert.equal(norm(rates.textContent), "Rates for this class");
      assert.equal(norm(book.textContent), "Book a car");
      assert.match(book.getAttribute("aria-label"), /^Book a car \(/);
    }
  });
  check("fleet.html: #i-user in every card, data-seats from CLASSES, the two fit spans right after each name, the chips above the tabs", () => {
    assert.equal(doc.querySelectorAll('main use[href="#i-seat"]').length, 0);
    for (const c of cards) {
      const k = SET[c.closest(".fleet-set").id];
      const seats = k === "sprinter" ? vehicleOf(c).seats : CLASSES[k].seats;
      assert.equal(c.dataset.seats, String(seats));
      assert.equal(c.querySelector(".fleet-card__specs use").getAttribute("href"), "#i-user");
      const name = c.querySelector(".fleet-card__link > h3.fleet-card__name");
      assert.equal(name.nextElementSibling.outerHTML, '<span class="fits-yes">Fits your group</span>');
      assert.equal(name.nextElementSibling.nextElementSibling.outerHTML, `<span class="fits-no">Seats ${seats}</span>`);
    }
    const f = doc.querySelector("#fleet-all > .grid12 > fieldset.fits");
    assert.equal(f.outerHTML, FITS);
    assert.ok(f.nextElementSibling.matches('nav[aria-label="Vehicle classes"]'));
  });
  check("fleet.html: card sizes start with (min-width: 1200px) 360px so a DPR 2 laptop fetches the 900w file", () => {
    for (const s of doc.querySelectorAll("article.fleet-card source")) assert.match(s.getAttribute("sizes"), /^\(min-width: 1200px\) 360px, /);
  });
}
{
  const doc = load("about.html");
  check("about.html: The service in figures says 6 vehicle classes, the number of CLASSES (C-01)", () => {
    const dt = [...doc.querySelectorAll("main dl.facts dt")].find((d) => norm(d.textContent) === "Vehicle classes");
    assert.equal(norm(dt.nextElementSibling.textContent), String(Object.keys(CLASSES).length));
  });
  check("about.html: the reviews link opens the first section after the banner and follows the closing card's buttons (C-21)", () => {
    const first = doc.querySelector("main > div.frame + section.section .grid12 > .prose");
    assert.equal(first.firstElementChild.outerHTML, REVIEWS);
    assert.equal(doc.querySelector("main .section--close p.btn-row").nextElementSibling.outerHTML, REVIEWS);
  });
  check("about.html: Booking and payment, after The service in figures, plain labels and values, exact (C31)", () => {
    const h = doc.getElementById("pay-h");
    assert.equal(norm(h.textContent), "Booking and payment");
    const sec = h.closest("section");
    assert.equal(sec.getAttribute("aria-labelledby"), "pay-h");
    assert.ok([...sec.previousElementSibling.querySelectorAll("h2")].some((x) => norm(x.textContent) === "At a glance"));
    assert.ok(sec.nextElementSibling.matches(".section--close"));
    assert.deepEqual([...sec.querySelectorAll("dl.facts dt")].map((dt) => [norm(dt.textContent), norm(dt.nextElementSibling.textContent)]), [
      ["Surge pricing", "None. Busy times don't change our rates."],
      ["Gratuity", "Optional, chosen when you book. None is the default."],
      ["Card details", "Only on a stripe.com payment page. We never ask for card numbers by phone, email, text or WhatsApp."],
      ["Account", "Not needed. You book as a guest."],
      ["Office", "No walk-in office. We send the car to your address."],
    ]);
  });
}
check("faq.html: the static filter field of 2.7 item 11 sits above the first question group (C-26)", () => {
  const doc = load("faq.html");
  const f = doc.querySelector("main .faq-find");
  assert.equal(f.outerHTML, '<div class="field faq-find js-only"><label for="faq-q">Search the questions</label><input id="faq-q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-describedby="faq-n"><p class="field__hint" id="faq-n" role="status"></p></div>');
  assert.ok(f.nextElementSibling.matches("section.section--tight#reservations"));
  assert.equal(doc.querySelector("main details"), f.nextElementSibling.querySelector("details"));
});
for (const file of ["about.html", "contact.html", "faq.html", "fleet.html", "schedule.html", "card-authorization.html", "privacy-policy.html", "terms-of-service.html", "corporate-car-service-nyc.html"]) {
  check(`${file}: the crumbs equal the page's BreadcrumbList, the last item the current page (G-20, decision 22)`, () => {
    const doc = load(file);
    const navs = doc.querySelectorAll("main nav.crumbs");
    assert.equal(navs.length, 1);
    const items = graph(doc).find((n) => n["@type"] === "BreadcrumbList").itemListElement;
    const lis = [...navs[0].querySelectorAll("li")];
    assert.deepEqual(lis.map((li) => norm(li.textContent)), items.map((i) => i.name));
    lis.forEach((li, i) => {
      const a = li.querySelector("a");
      if (i === lis.length - 1) assert.deepEqual([li.getAttribute("aria-current"), a], ["page", null]);
      else assert.equal(new URL(a.getAttribute("href"), "https://www.nycluxride.com/").href, items[i].item);
    });
  });
}

function block(css, start) {
  const at = css.indexOf(start);
  assert.ok(at >= 0, `no ${start}`);
  let depth = 0;
  for (let i = at + start.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`${start} is not closed`);
}
function selectors(body) {
  const out = [];
  let depth = 0;
  let head = "";
  let inner = "";
  for (const ch of body) {
    if (ch === "{") {
      if (depth === 0) inner = "";
      else inner += ch;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const h = head.trim();
        if (h.startsWith("@")) out.push(...selectors(inner));
        else out.push(...h.split(/,(?![^()]*\))/).map((s) => s.trim()));
        head = "";
      } else inner += ch;
    } else if (depth === 0) head += ch;
    else inner += ch;
  }
  return out;
}
const cssFile = readdirSync(join(ROOT, "assets")).find((f) => /^lux\.[A-Za-z0-9_-]+\.css$/.test(f));
const pagesBlock = block(readFileSync(join(ROOT, "assets", cssFile), "utf8"), "@layer pages{");
check(`assets/${cssFile}: the @layer pages block is at most 20500 bytes, with the waiting band, child seats, pets, amenities and the homepage booking card (${Buffer.byteLength(pagesBlock)})`, () => {
  assert.ok(Buffer.byteLength(pagesBlock) <= 20500);
});
check(`assets/${cssFile}: every selector of the @layer pages block starts with .home`, () => {
  const list = selectors(pagesBlock.slice("@layer pages{".length, -1));
  assert.ok(list.length > 0, "the block is empty");
  assert.deepEqual(list.filter((s) => !s.startsWith(".home")), []);
});

const CLASS_ORDER = ["Business SUV", "Business Premium SUV", "First Class", "Executive Sedan", "Electric Class", "Luxury Sprinter"];
for (const file of ["chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html"]) {
  check(`${file}: the fleet cards follow the class order`, () => {
    const classes = [...load(file).querySelectorAll("article.fleet-card figcaption.slate")].map((f) => norm(f.textContent.replace(f.querySelector("b").textContent, "")));
    const at = classes.map((c) => CLASS_ORDER.indexOf(c));
    assert.ok(classes.length >= 4 && at.every((i, k) => i >= 0 && (k === 0 || i >= at[k - 1])), classes.join(", "));
  });
}

if (failures) {
  console.error(`\n${failures} pages-core assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pages-core tests passed");
process.exit(0);
