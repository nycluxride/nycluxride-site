import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CLASSES } from "../api/_rates.mjs";

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
  ["/services#airport-transfers", "Airport transfers", "Airport transfers to or from JFK, LaGuardia, Newark and Teterboro are one total price by vehicle class from any New York City address, with tolls, airport fees, NYC sales tax and the Black Car Fund included.", "gmc-denali", 1448, 1086, "Black GMC Denali in a stone lobby"],
  ["/chauffeur-service-nyc", "Hourly chauffeur", "The same car and chauffeur for meetings, events, shopping or a day of stops, with a 3-hour minimum.", "mercedes-s-class", 1620, 971, "Black Mercedes-Benz S-Class in a courtyard at night"],
  ["/limousine-service-nyc", "Weddings, prom and groups", "Luxury Sprinters for up to 12 passengers, with 10 large and 2 small bags.", "sprinter-jet", 1236, 650, "Inside the Jet Sprinter: two leather captain's chairs facing a screen"],
  ["/services#corporate", "Corporate accounts", "Monthly billing and priority scheduling for your company.", "lincoln-navigator", 1536, 1024, "Black Lincoln Navigator in a showroom"],
];
const BANNER_SIZES = () => "(max-width: 599px) 84vw, 100vw";
const SLIDE_SIZES = (i) => `(min-width: 1280px) 202px, (min-width: 600px) ${i < 2 ? "calc(50vw - 48px)" : "calc((100vw - 128px) / 3)"}, 120px`;
const CARD_SIZES = (w, h) => {
  const f = Math.max(1, w / h / 1.5);
  return f === 1 ? "(min-width: 1280px) 262px, (min-width: 600px) calc(50vw - 52px), 112px" : `(min-width: 1280px) ${Math.ceil(262 * f)}px, (min-width: 600px) calc(${(50 * f).toFixed(1)}vw - ${Math.round(52 * f)}px), ${Math.round(112 * f)}px`;
};
const ARROW = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow"></use></svg>';
const EXT = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-external"></use></svg><span class="sr-only"> (opens in a new tab)</span>';
const REVIEWS = `<p><a class="lnk" href="https://maps.app.goo.gl/6dGNLcMvGazKFzkc7?g_st=iw" target="_blank" rel="noopener">Read the reviews on Google Maps${EXT}</a></p>`;
const TRUST = '<ul class="assure-row assure-row--page" role="list"><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg>Airport prices include tolls, airport fees and taxes</li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg>Free waiting after you land</li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone"></use></svg>We answer 24 hours a day, every day</li></ul>';
const FITS = '<fieldset class="fits"><legend>Who is traveling?</legend><label><input type="radio" name="fits" value="0" checked="">All</label><label><input type="radio" name="fits" value="3">1 to 3</label><label><input type="radio" name="fits" value="5">4 or 5</label><label><input type="radio" name="fits" value="12">6 to 12</label></fieldset>';
const P1 = "Cancellation terms are confirmed in writing with the reservation. To change or cancel, call +1 (646) 775-0556 or message on WhatsApp with your reference, and give as much notice as you can.";
const NOTE = "This form opens your email app with a message to info@nycluxride.com. Nothing is sent until you press send there. For a faster answer, call or use WhatsApp.";
const KEYS = Object.keys(CLASSES);
const INCL = '<ul class="incl" role="list"><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg><span>Free waiting after you land</span></li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg><span>15 minutes of free waiting at other pickups</span></li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-plane-arrive"></use></svg><span>Live flight tracking</span></li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-child"></use></svg><span>Infant, toddler and booster seats, free on request</span></li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-wifi"></use></svg><span>Free Wi-Fi and charging ports in the executive fleet</span></li><li><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-sign"></use></svg><span>Meet and greet inside the terminal with a name sign, for an extra charge</span></li></ul>';

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
  check("index.html: the first section after the hero starts with the static trust row of 2.7 item 1, exact", () => {
    assert.equal(doc.querySelector("main > section.hero").nextElementSibling, svc);
    assert.equal(svc.firstElementChild.outerHTML, TRUST);
    assert.equal(doc.querySelectorAll(".assure-row--page").length, 1);
  });
  check("index.html: every section ends with its links, centered in one p.btn-row, and no section head holds a link (H-10)", () => {
    const end = (id) => doc.querySelector(`main section[aria-labelledby="${id}"]`).lastElementChild;
    const links = (n) => [...n.querySelectorAll("a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]);
    assert.equal(end("svc-h").outerHTML, `<p class="btn-row"><a class="lnk" href="/services">All services ${ARROW}</a></p>`);
    assert.equal(end("areas-h").outerHTML, `<p class="btn-row"><a class="lnk" href="/locations">All service areas ${ARROW}</a></p>`);
    assert.deepEqual(links(end("fleet-h")), [["/fleet", "See the fleet"], ["/rates#hourly", "See hourly rates"]]);
    assert.equal(end("fleet-h").className, "btn-row");
    assert.deepEqual(links(doc.querySelector('main section[aria-labelledby="terms-h"] .grid12 > .btn-row')), [["/rates#add-ons", "See all add-ons and terms"], ["/faq", "Read the FAQ"]]);
    assert.equal(doc.querySelectorAll("main .sec-head a").length, 0);
  });
  check("index.html: the coverage section says where we pick up (H-13), the 12 area pills stay", () => {
    const sec = doc.querySelector('main section[aria-labelledby="areas-h"]');
    assert.equal(norm(sec.querySelector("h2#areas-h").textContent), "Where we pick up");
    assert.equal(norm(sec.querySelector(".sec-head .prose > p:not(.eyebrow)").textContent), "We pick up anywhere in the five boroughs and at JFK, LaGuardia, Newark and Teterboro. These guides cover the five boroughs, five neighborhoods and both city airports.");
    assert.equal(sec.querySelectorAll(":scope > ul.jumps > li > a[href^='/locations/']").length, 12);
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
  const terms = doc.querySelector('main section[aria-labelledby="terms-h"]');
  check("index.html: What is included holds the exact ul.incl and no dl.facts, eyebrow, H2 and links kept", () => {
    assert.ok(terms, "no terms section");
    const ul = terms.querySelector("ul.incl");
    assert.ok(ul, "no ul.incl");
    assert.equal(ul.outerHTML, INCL);
    assert.equal(terms.querySelectorAll("dl, .facts").length, 0);
    assert.equal(norm(terms.querySelector(".eyebrow").textContent), "Before you book");
    assert.equal(norm(terms.querySelector("h2#terms-h").textContent), "What is included");
    const links = [...terms.querySelectorAll(".btn-row a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]);
    assert.deepEqual(links, [["/rates#add-ons", "See all add-ons and terms"], ["/faq", "Read the FAQ"]]);
  });
  for (const id of ["how-h", "terms-h"]) {
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
  check("index.html: the fleet slides are the five classes in class order, sized to the shelf grid, with #i-user seats and their own /fleet link", () => {
    const slides = [...doc.querySelectorAll("#fleet-track > article.slide")];
    assert.deepEqual(slides.map((a) => norm(a.querySelector(".eyebrow").textContent)), ["Business SUV", "Business Premium SUV", "First Class", "Sedan & Electric", "Luxury Sprinter"]);
    assert.deepEqual(slides.map((a) => a.id), ["class-business-suv", "class-business-premium-suv", "class-first-class", "class-sedan-electric", "class-luxury-sprinter"]);
    assert.deepEqual(slides.map((a) => [...a.querySelectorAll(".lnk")].map((l) => l.getAttribute("href"))), ["business-suv", "business-premium-suv", "first-class", "sedan-electric", "luxury-sprinter"].map((id) => [`/fleet#${id}`]));
    slides.forEach((a, i) => assert.deepEqual([...a.querySelectorAll("source")].map((src) => src.getAttribute("sizes")), [SLIDE_SIZES(i), SLIDE_SIZES(i)], a.id));
    assert.deepEqual(slides.map((a) => a.querySelector(".chips li use").getAttribute("href")), Array(5).fill("#i-user"));
    assert.equal(doc.querySelectorAll('main use[href="#i-seat"]').length, 0);
    for (const a of doc.querySelectorAll("#fleet-track .lnk")) {
      assert.equal(a.lastElementChild, a.lastChild, "the arrow is the last node of the link");
      assert.match(a.firstChild.textContent, /\S$/, "no space before the arrow");
    }
  });
}

const HERO_C = {
  "rates.html": { img: "/fleet/gmc-denali-900.webp", eyebrow: "Rates", btns: ["Book a car", "Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Rates</li></ol></nav>', preload: false },
  "fleet.html": { img: "/fleet/cadillac-escalade-esv-900.webp", eyebrow: "Fleet", btns: null, after: "You book a class. We confirm your car in writing before your ride.", crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Fleet</li></ol></nav>', preload: true },
  "about.html": { img: "/fleet/lincoln-continental-900.webp", eyebrow: "Chauffeur and black car service in New York City", btns: null, crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">About</li></ol></nav>', preload: true },
  "contact.html": { img: "/fleet/cadillac-ct5-ct6-900.webp", eyebrow: "Reservations and inquiries", btns: ["Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Contact</li></ol></nav>', preload: true },
  "faq.html": { img: "/fleet/cadillac-xt6-showroom-900.webp", eyebrow: "Support", btns: null, crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">FAQ</li></ol></nav>', preload: true },
  "schedule.html": { img: "/fleet/cadillac-escalade-900.webp", eyebrow: "Reservations", btns: ["Book a car", "Call +1 (646) 775-0556", "Book on WhatsApp"], crumbs: '<nav class="crumbs" aria-label="Breadcrumb"><ol role="list"><li><a href="/">Home</a></li><li aria-current="page">Schedule a chauffeur</li></ol></nav>', preload: true },
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
  check(`${file}: figure.banner__photo holds the former eager image with the banner sizes, then its caption`, () => {
    const fig = banner.querySelector(":scope > figure.banner__photo");
    assert.deepEqual(tags(fig), ["picture", "figcaption.slate"]);
    const img = fig.querySelector("picture > img");
    assert.deepEqual(["src", "loading", "decoding", "fetchpriority"].map((k) => img.getAttribute(k)), [want.img, "eager", "sync", "high"]);
    assert.ok(img.getAttribute("alt") && img.getAttribute("width") && img.getAttribute("height"), "img lost alt, width or height");
    const sources = [...fig.querySelectorAll("picture > source")];
    assert.deepEqual(sources.map((s) => [s.getAttribute("type"), s.getAttribute("sizes")]), [["image/avif", BANNER_SIZES(img)], ["image/webp", BANNER_SIZES(img)]]);
    assert.equal(doc.querySelectorAll('img[loading="eager"]').length, 1);
  });
  check(`${file}: banner body is eyebrow, H1, lede and buttons in today's order`, () => {
    const body = banner.querySelector(":scope > div.banner__body");
    const expect = [...(want.eyebrow ? ["p.eyebrow.eyebrow--lead"] : []), "h1", "p.lede", ...(want.after ? ["p"] : []), ...(want.btns ? ["p.btn-row"] : [])];
    assert.deepEqual(tags(body), expect);
    if (want.after) assert.equal(norm(body.querySelector(".lede + p").textContent), want.after);
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
  assert.equal(nav.outerHTML, '<nav class="frame" aria-label="On this page"><ul class="jumps" role="list"><li><a href="#airport">Airport transfers</a></li><li><a href="#hourly">Hourly</a></li><li><a href="#add-ons">Add-ons and terms</a></li><li><a href="#cancellation">Cancellation</a></li></ul></nav>');
  for (const id of ["airport", "hourly", "add-ons", "cancellation"]) assert.ok(doc.getElementById(id), `no #${id}`);
});

check("fleet.html: the class jump list of #fleet-all is tabs, one per class in class order, each with its set", () => {
  const doc = load("fleet.html");
  const ul = doc.querySelector('#fleet-all nav[aria-label="Vehicle classes"] > ul');
  assert.equal(ul.className, "jumps jumps--tabs");
  assert.deepEqual([...ul.querySelectorAll("a")].map((a) => [a.getAttribute("href"), norm(a.textContent)]), [["#fleet-all", "All vehicles"], ["#business-suv", "Business SUV"], ["#business-premium-suv", "Business Premium SUV"], ["#first-class", "First Class"], ["#sedan-electric", "Sedan & Electric"], ["#luxury-sprinter", "Luxury Sprinter"]]);
  assert.deepEqual([...doc.querySelectorAll(".fleet-set")].map((set) => [set.id, set.querySelectorAll(".fleet-card").length]), [["business-suv", 3], ["business-premium-suv", 1], ["first-class", 2], ["sedan-electric", 4], ["luxury-sprinter", 2]]);
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
      ["Booking ahead", "Online at least 24 hours ahead. Sooner by phone or WhatsApp when a car is free."],
      ["Free waiting", "45 minutes after a domestic landing, 60 after an international landing, 15 at any other pickup."],
      ["By the hour", "Any class, with a 3-hour minimum."],
      ["First booking", "We may ask for a card authorization."],
      ["Cancellation", P1],
    ]);
    const cancel = [...dl[0].querySelectorAll("dd")].at(-1);
    assert.deepEqual([...cancel.querySelectorAll("a")].map((a) => a.getAttribute("href")), ["tel:+16467750556", "https://wa.me/16467750556"]);
    assert.equal(dl[0].nextElementSibling.outerHTML, `<p><a class="lnk" href="/rates#add-ons">See all add-ons and terms${ARROW}</a></p>`);
  });
  check("schedule.html: the inquiry form sits inside a closed details.acc, Send the details by email", () => {
    const d = main.querySelector('form[aria-labelledby="enquiry-heading"]').parentElement;
    assert.ok(d.matches("details.acc") && !d.open, "the form is not in a closed details.acc");
    assert.equal(norm(d.querySelector(":scope > summary").textContent), "Send the details by email");
    assert.deepEqual([...main.querySelectorAll("a.btn:not(.btn--ghost)")].map((a) => [a.closest("section").className, a.getAttribute("href")]), [["banner", "/book"], ["section section--close frame", "/book"]]);
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
    assert.equal(rail.querySelectorAll("nav.toc a").length, file === "privacy-policy.html" ? 14 : 15);
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
  ["privacy-policy.html", "In the booking form, on the booking page, the homepage and the JFK and LaGuardia pages, you enter the trip type, the pickup and drop-off locations and any stops, the date and time, an optional return trip, the number of passengers, the hours for a trip by the hour, the vehicle class or vehicle, meet and greet, an optional gratuity and an optional flight number. On Stripe's payment page you enter your name, email, phone and card, which is saved for the charges after the ride, and optionally the passenger's name and mobile, a name for the sign and notes for your chauffeur.", "In the booking form, on the booking page, the homepage, the service and area pages and the JFK and LaGuardia pages, you enter the trip type, the pickup and drop-off locations and any stops, the date and time, an optional return trip, the number of passengers, the hours for a trip by the hour, the vehicle class or vehicle, meet and greet, an optional gratuity and an optional flight number. Before payment the booking page asks for your name, email and mobile number, whether dispatch should contact you by phone or WhatsApp, and optionally the passenger's name and mobile, a name for the sign and notes for your chauffeur. On Stripe's payment page you enter your card, which is saved for the charges after the ride, and also your name, email and mobile number if the booking page did not send them."],
  ["privacy-policy.html", "The booking form keeps the trip you enter, and the confirmation page keeps your payment reference, in your browser's session storage until the tab closes.", "The booking form keeps the trip and the details you enter, and the confirmation page keeps your payment reference, in your browser's session storage until the tab closes."],
  ["privacy-policy.html", "Trip details entered in the booking form are sent to NYC LUX RIDE to prepare the booking.", "Trip details and contact details entered in the booking form are sent to NYC LUX RIDE to prepare the booking."],
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
check("privacy-policy.html: Last Updated October 13, 2026 and WebPage dateModified 2026-10-13", () => {
  const doc = load("privacy-policy.html");
  const page = graph(doc).find((n) => n["@type"] === "WebPage");
  assert.equal(page.dateModified, "2026-10-13");
  const lines = [...doc.querySelectorAll("main p")].map((p) => norm(p.textContent)).filter((t) => t.startsWith("Last Updated:"));
  assert.deepEqual(lines, ["Last Updated: October 13, 2026"]);
});
check("sitemap.xml: lastmod 2026-10-13 for /privacy-policy and /card-authorization, the URL list unchanged", () => {
  const xml = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
  const mods = Object.fromEntries([...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1], m[2]]));
  assert.equal(mods["https://www.nycluxride.com/privacy-policy"], "2026-10-13");
  assert.equal(mods["https://www.nycluxride.com/card-authorization"], "2026-10-13");
  assert.equal(mods["https://www.nycluxride.com/terms-of-service"], "2026-10-12");
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), BASELINE.sitemap);
});
check("sitemap.xml: lastmod 2026-10-14 exactly for the pages the five class prices changed", () => {
  const xml = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
  const changed = [...xml.matchAll(/<loc>https:\/\/www\.nycluxride\.com\/([^<]*)<\/loc>\s*<lastmod>2026-10-14<\/lastmod>/g)].map((m) => m[1]).sort();
  const want = ["", "about", "black-car-service-brooklyn", "blog", "blog/best-black-car-service-brooklyn-queens-march-20", "blog/corporate-black-car-nyc-april-3", "blog/nyc-cruise-terminal-black-car-service-guide-march-6", "blog/nyc-limo-service-comparison-guide-april-29", "book", "chauffeur-service-nyc", "contact", "faq", "fleet", "limousine-service-nyc", "locations", "locations/jfk-airport", "locations/laguardia-airport", "locations/manhattan", "locations/queens", "locations/staten-island", "locations/upper-east-side", "rates", "schedule", "services"];
  assert.deepEqual(changed, want);
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
  check("404.html: the banner photo is the eager cadillac-xt6-showroom picture at the banner sizes", () => {
    const fig = banner.querySelector(":scope > figure.banner__photo");
    assert.deepEqual(tags(fig), ["picture"]);
    const set = (ext) => [600, 900, 1100, 1400, 1741].map((w) => `/fleet/cadillac-xt6-showroom-${w}.${ext} ${w}w`).join(", ");
    const sources = [...fig.querySelectorAll("picture > source")].map((s) => [s.getAttribute("type"), s.getAttribute("srcset"), s.getAttribute("sizes")]);
    const img = fig.querySelector("picture > img");
    assert.deepEqual(sources, [["image/avif", set("avif"), BANNER_SIZES(img)], ["image/webp", set("webp"), BANNER_SIZES(img)]]);
    assert.deepEqual(
      ["src", "width", "height", "alt", "loading", "decoding", "fetchpriority"].map((k) => img.getAttribute(k)),
      ["/fleet/cadillac-xt6-showroom-900.webp", "1741", "903", "Black Cadillac XT6 in a showroom", "eager", "sync", "high"],
    );
    assert.equal(doc.querySelectorAll('img[loading="eager"]').length, 1);
  });
  check("404.html: banner body is the eyebrow, the H1, the lede and the two buttons", () => {
    const body = banner.querySelector(":scope > div.banner__body");
    assert.deepEqual(tags(body), ["p.eyebrow.eyebrow--lead", "h1", "p.lede", "p.btn-row"]);
    assert.equal(norm(body.querySelector(".eyebrow").textContent), "Error 404");
    assert.equal(body.querySelector("h1").outerHTML, '<h1 id="page-h">Nothing at this address</h1>');
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
    assert.equal(norm(areas.textContent), "Guides to the five boroughs, five neighborhoods and both city airports.");
    assert.ok(!doc.querySelector("main").textContent.includes("book the most rides"));
    const rail = stack.lastElementChild;
    assert.equal(norm(rail.querySelector(".eyebrow").textContent), "Reservations");
    assert.deepEqual([...rail.querySelectorAll(".facts dt")].map((d) => norm(d.textContent)), ["Phone", "Email", "Dispatch", "Booking"]);
    assert.match(rail.querySelector("a.btn").getAttribute("href"), /^https:\/\/wa\.me\/16467750556/);
    assert.equal(main.children.length, 2);
  });
  check("404.html: noindex and no canonical", () => {
    assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex");
    assert.equal(doc.querySelector('link[rel="canonical"]'), null);
  });
}

{
  const doc = load("rates.html");
  const rows = (sel) => [...doc.querySelectorAll(sel)];
  check("rates.html: each airport row ends with Book in its LaGuardia cell, each hourly row with Book by the hour in its Three hours cell, never in the th (C-06, F42)", () => {
    assert.deepEqual(rows("#airport-rates tbody tr").map((tr) => tr.lastElementChild.querySelector("a").outerHTML), KEYS.map((k) => `<a class="lnk lnk--row" href="/book?class=${k}">Book<span class="sr-only"> a ${CLASSES[k].name.replace("&", "&amp;")}</span></a>`));
    assert.deepEqual(rows("#hourly tbody tr").map((tr) => tr.lastElementChild.querySelector("a").outerHTML), KEYS.map((k) => `<a class="lnk lnk--row" href="/book?trip-type=hour&amp;hours=3&amp;class=${k}">Book by the hour<span class="sr-only">, ${CLASSES[k].name.replace("&", "&amp;")}</span></a>`));
    assert.equal(doc.querySelectorAll(".rate-table th a, .rate-table td:not(:last-child) a.lnk--row").length, 0);
  });
  check("rates.html: Who is traveling? chips right before the airport table, data-seats and the two fit spans in each row header after the class name (C-23)", () => {
    const f = doc.querySelector("fieldset.fits");
    assert.equal(f.outerHTML, FITS);
    assert.ok(f.nextElementSibling.matches(".table-scroll") && f.nextElementSibling.querySelector("#airport-rates"), "the chips do not sit right before the airport table");
    for (const sel of ["#airport-rates tbody tr", "#hourly tbody tr"]) {
      assert.deepEqual(rows(sel).map((tr) => tr.dataset.seats), KEYS.map((k) => String(CLASSES[k].seats)));
      assert.deepEqual(rows(sel).map((tr) => { const th = tr.querySelector("th"); return [th.firstChild.textContent, [...th.children].map((c) => c.outerHTML).slice(0, 2)]; }), KEYS.map((k) => [CLASSES[k].name, ['<span class="fits-yes">Fits your group</span>', `<span class="fits-no">Seats ${CLASSES[k].seats}</span>`]]));
    }
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
  const SET = { "business-suv": "suv", "business-premium-suv": "premium", "first-class": "first", "sedan-electric": "sedan", "luxury-sprinter": "sprinter" };
  check("fleet.html: the 12 rate links point at the airport row of their class, the 12 Book a car links carry ?class=, text and aria-label kept (C-05, C-06)", () => {
    assert.equal(cards.length, 12);
    for (const c of cards) {
      const k = SET[c.closest(".fleet-set").id];
      const [rates, book] = c.querySelectorAll(".fleet-card__cta a");
      assert.equal(rates.getAttribute("href"), `/rates#airport-${k}`);
      assert.equal(book.getAttribute("href"), `/book?class=${k}`);
      assert.equal(norm(rates.textContent), "Rates for this class");
      assert.equal(norm(book.textContent), "Book a car");
      assert.match(book.getAttribute("aria-label"), /^Book a car \(/);
    }
  });
  check("fleet.html: #i-user in every card, data-seats from CLASSES, the two fit spans right after each name, the chips above the tabs", () => {
    assert.equal(doc.querySelectorAll('main use[href="#i-seat"]').length, 0);
    for (const c of cards) {
      const k = SET[c.closest(".fleet-set").id];
      assert.equal(c.dataset.seats, String(CLASSES[k].seats));
      assert.equal(c.querySelector(".fleet-card__specs use").getAttribute("href"), "#i-user");
      const name = c.querySelector(".fleet-card__link > h3.fleet-card__name");
      assert.equal(name.nextElementSibling.outerHTML, '<span class="fits-yes">Fits your group</span>');
      assert.equal(name.nextElementSibling.nextElementSibling.outerHTML, `<span class="fits-no">Seats ${CLASSES[k].seats}</span>`);
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
  check("about.html: The service in figures says 5 vehicle classes, the number of CLASSES (C-01)", () => {
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
      ["Surge pricing", "None. Busy times don't change the price."],
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
for (const file of ["about.html", "contact.html", "faq.html", "fleet.html", "schedule.html", "card-authorization.html", "privacy-policy.html", "terms-of-service.html"]) {
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
check(`assets/${cssFile}: the @layer pages block is at most 6000 bytes (${Buffer.byteLength(pagesBlock)})`, () => {
  assert.ok(Buffer.byteLength(pagesBlock) <= 6000);
});
check(`assets/${cssFile}: every selector of the @layer pages block starts with .home`, () => {
  const list = selectors(pagesBlock.slice("@layer pages{".length, -1));
  assert.ok(list.length > 0, "the block is empty");
  assert.deepEqual(list.filter((s) => !s.startsWith(".home")), []);
});

const CLASS_ORDER = ["Business SUV", "Business Premium SUV", "First Class", "Sedan & Electric", "Luxury Sprinter"];
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
