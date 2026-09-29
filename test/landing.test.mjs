import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const load = (f) => new JSDOM(read(f)).window.document;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const nums = (s) => (norm(s).match(/\d+/g) || []).map(Number);

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

const WAITS = [
  ["45 min", "Domestic flights", "From touchdown"],
  ["60 min", "International flights", "From touchdown"],
  ["15 min", "Other pickups", "From the pickup time"],
];
const SEATS = [
  ["i-seat-infant", "Infant seat", "Free on request"],
  ["i-seat-toddler", "Toddler seat", "Free on request"],
  ["i-seat-booster", "Booster seat", "Free on request"],
];
const SEAT_NOTE = "Tell us which one you need in the booking notes, and we'll fit it before the car leaves.";
const AMENITIES = [
  ["i-bottle", "Bottled water", ""],
  ["i-wifi", "Free Wi-Fi", "Executive fleet"],
  ["i-charge", "Charging", "Executive fleet"],
  ["i-armchair", "Comfortable interior", ""],
  ["i-case", "Help with bags", ""],
  ["i-climate", "Climate control", ""],
  ["i-sparkle", "Clean and sanitized", ""],
  ["i-chauffeur", "Professional", "at the wheel"],
];
const ARROW = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow"></use></svg>';
const LINKS = `<p class="btn-row"><a class="lnk" href="/rates#add-ons">See all add-ons and terms ${ARROW}</a> <a class="lnk" href="/faq">Read the FAQ ${ARROW}</a></p>`;

const doc = load("index.html");
const rates = load("rates.html");
const faq = load("faq.html");
const use = (el) => el.querySelector("svg.icon > use")?.getAttribute("href").slice(1);
const art = (el) => use(el) ?? el.querySelector(":scope > picture > img")?.getAttribute("src").replace(/^\/fleet\/(seat-[a-z]+)-\d+\.webp$/, "i-$1");
const shown = (el) => {
  if (!el) return "";
  const c = el.cloneNode(true);
  c.querySelectorAll(".sr-only").forEach((x) => x.remove());
  return norm(c.textContent);
};
const fact = (label) => norm([...rates.querySelectorAll("#add-ons dl.facts dt")].find((dt) => norm(dt.textContent) === label)?.nextElementSibling?.textContent);
const answer = (question) => {
  const d = [...faq.querySelectorAll("main details")].find((x) => norm(x.querySelector("summary").textContent) === question);
  return d ? norm(d.textContent.replace(d.querySelector("summary").textContent, "")) : "";
};
const hero = doc.querySelector("main > section.hero");
const band = hero?.nextElementSibling;
const perks = band?.nextElementSibling;

check("index.html: the waiting band follows the hero, with its heading and the three times in order, each a big number with min, a short label and its start", () => {
  assert.ok(band?.matches('section.section.section--band.frame[aria-labelledby="wait-h"]'), "no waiting band right after the hero");
  assert.equal(norm(band.querySelector(":scope > h2.h-caps#wait-h").textContent), "Free waiting time");
  const items = [...band.querySelectorAll(":scope > ul.waits[role=list] > li")];
  assert.deepEqual(items.map((li) => [...li.children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`)), Array(3).fill(["p.waits__n", "p.waits__l", "p.waits__s"]));
  assert.deepEqual(items.map((li) => [...li.children].map((p) => norm(p.textContent))), WAITS);
  assert.deepEqual(items.map((li) => li.querySelector(".waits__n > span").textContent), ["45", "60", "15"]);
});

check("index.html: the band's minutes are the ones rates.html and the FAQ state", () => {
  const airports = fact("Free waiting at airports"), other = fact("Other pickups");
  assert.deepEqual([...nums(airports), ...nums(other)], [45, 60, 15], `${airports} | ${other}`);
  assert.match(airports, /touchdown/);
  assert.match(other, /pickup time/);
  assert.deepEqual(nums(answer("Do you offer free waiting time for pickups?")), [45, 60, 15]);
  assert.deepEqual(WAITS.map(([n]) => nums(n)[0]), [45, 60, 15]);
});

check("index.html: the child seats card sits in the hero right after the booking card, Child seats available with available in gold, the client's line, and the infant, toddler and booster seat, each free on request, with the booking notes line kept in the FAQ", () => {
  const seats = hero.querySelector(':scope > section.seats[aria-labelledby="seats-h"]');
  assert.ok(seats, "no child seats card in the hero");
  assert.equal(seats.previousElementSibling, hero.querySelector(":scope > div.hero__book"), "the card does not follow the booking card");
  assert.equal(seats.nextElementSibling, hero.querySelector(":scope > figure.hero__photo"), "the photo does not follow the card");
  const h = seats.querySelector(":scope > h2.seats__h#seats-h");
  assert.equal(norm(h.textContent), "Child seats available");
  assert.equal(h.innerHTML, "Child seats <span>available</span>");
  assert.equal(norm(seats.querySelector(":scope > p.seats__line").textContent), "Safe and comfortable travel for your family");
  const items = [...seats.querySelectorAll(":scope > ul.seats__list[role=list] > li")];
  assert.deepEqual(items.map((li) => [art(li.querySelector(":scope > .seats__art")), ...[...li.querySelectorAll(":scope > p")].map((p) => norm(p.textContent))]), SEATS);
  assert.equal(doc.querySelectorAll(".seats__note").length, 0, "the old seats note is still on the page");
  assert.equal(fact("Child seats"), "Infant, toddler and booster seats, free on request");
  assert.ok(answer("Are child safety seats available?").includes(SEAT_NOTE), "the FAQ no longer says how to ask for a seat");
});

check("index.html: the amenities are the owner's eight, each an icon and a caption of at most three words, with Comfortable interior fourth so its long first word shares a column with Professional on phones", () => {
  const amen = perks.querySelector(':scope > .perks > section.amen[aria-labelledby="amen-h"]');
  assert.ok(amen, "no amenities block");
  assert.equal(norm(amen.querySelector(":scope > h2.h-caps#amen-h").textContent), "On board");
  const items = [...amen.querySelectorAll(":scope > ul.amen__list[role=list] > li")];
  assert.deepEqual(items.map((li) => [use(li), norm(li.querySelector(":scope > span")?.textContent), shown(li.querySelector(":scope > small"))]), AMENITIES);
  const at = (t) => AMENITIES.findIndex(([, c]) => c.startsWith(t));
  assert.equal(at("Comfortable") % 4, at("Professional") % 4, "Comfortable and Professional are the widest words, on a phone they must sit in the same column");
  assert.deepEqual(items.map((li) => [...li.children].map((c) => c.tagName.toLowerCase()).join(" ")), AMENITIES.map(([, , s]) => (s ? "svg span small" : "svg span")));
  assert.deepEqual(AMENITIES.flatMap(([, t, s]) => [t, s]).filter((x) => x && x.split(" ").length > 3), []);
  assert.equal(norm(items.at(-1).textContent), "Professional at the wheel", "the chauffeur tile keeps the owner's words, a professional at the wheel");
  assert.doesNotMatch(norm(amen.textContent), /\blicen[cs]/i, "the strip must not claim a licence the site does not promise for every ride");
});

check("index.html: the perks block holds only the amenity strip, and the one child seats card sits inside the hero, before the waiting band", () => {
  assert.deepEqual([...perks.querySelector(":scope > .perks").children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`), ["section.amen"]);
  assert.deepEqual([...doc.querySelectorAll("section.seats")].map((c) => c.parentElement), [hero]);
  assert.ok(hero.querySelector(":scope > section.seats").compareDocumentPosition(band) & 4, "the card does not come before the band");
});

check("index.html: Wi-Fi and charging ports are promised for the executive fleet only, as the FAQ and the booking form say, and screen readers hear in the Executive fleet", () => {
  assert.deepEqual(AMENITIES.filter(([, , s]) => s === "Executive fleet").map(([id, , s]) => [id, s]), [["i-wifi", "Executive fleet"], ["i-charge", "Executive fleet"]]);
  const fleet = [...doc.querySelectorAll("#amen-h ~ ul.amen__list > li")].filter((li) => shown(li.querySelector(":scope > small")) === "Executive fleet");
  assert.deepEqual(fleet.map((li) => li.querySelector(":scope > small").innerHTML), Array(2).fill('<span class="sr-only">in the </span>Executive fleet'));
  assert.deepEqual(fleet.map((li) => norm(li.textContent)), ["Free Wi-Fi in the Executive fleet", "Charging in the Executive fleet"]);
  assert.doesNotMatch(norm(doc.getElementById("amen-h").textContent), /\bevery\b/i, "the heading over the two executive fleet tiles must not promise every ride");
  assert.equal(answer("Do your vehicles include Wi-Fi?"), "Yes. The executive fleet has free Wi-Fi and charging ports.");
  assert.ok([...doc.querySelectorAll("#bk-incl > li")].some((li) => norm(li.textContent) === "Free Wi-Fi and charging ports in the executive fleet"), "the booking form no longer says it");
});

check("index.html: the perks block ends with meet and greet as an extra and the add-ons and FAQ links", () => {
  assert.deepEqual([...perks.children].map((c) => c.tagName.toLowerCase() + "." + c.className), ["div.perks", "p.perks__note", "p.btn-row"]);
  assert.equal(norm(perks.querySelector(".perks__note").textContent), "Meet and greet inside the terminal with a name sign costs extra.");
  assert.equal(perks.lastElementChild.outerHTML, LINKS);
  assert.equal(perks.nextElementSibling, doc.querySelector('main > section[aria-labelledby="svc-h"]'));
});

check("index.html: the old What is included lines are not said again outside the booking form", () => {
  const main = doc.querySelector("main").cloneNode(true);
  main.querySelector("#book-form").remove();
  const text = norm(main.textContent);
  const count = (s) => text.split(s).length - 1;
  assert.deepEqual(
    ["What is included", "Free waiting after you land", "15 minutes of free waiting at other pickups", "Live flight tracking", "Infant, toddler and booster seats", "Free Wi-Fi and charging ports in the executive fleet"].map(count),
    [0, 0, 0, 0, 0, 0],
  );
  assert.equal(count("Meet and greet inside the terminal with a name sign"), 1);
  assert.equal(count("We track your flight and move the pickup if it lands early or late."), 1);
});

check("index.html: every icon of the band, the strip and the hero's child seats card is a symbol of assets/icons.svg.html", () => {
  const sprite = read("assets/icons.svg.html");
  const ids = [...band.querySelectorAll("use"), ...perks.querySelectorAll("use"), ...hero.querySelectorAll(":scope > section.seats use")].map((u) => u.getAttribute("href").slice(1));
  assert.deepEqual(ids.filter((id) => !sprite.includes(`<symbol id="${id}" viewBox="0 0 24 24">`)), []);
});

check("index.html: the H1 reads NYC airport transfers. Travel in First Class, with First Class the one gold span", () => {
  const h1 = doc.querySelector("main > section.hero > h1#hero-h");
  assert.equal(norm(h1.textContent), "NYC airport transfers. Travel in First Class");
  assert.deepEqual([...h1.querySelectorAll(".hero__gold")].map((s) => s.outerHTML), ['<span class="hero__gold">First Class</span>']);
});

check("index.html: under the H1 the two lines read Professional, Luxury, Reliable and Airport Transfers, Hourly Service, Corporate Travel, with no lede and no visible eyebrow", () => {
  const h1 = hero.querySelector(":scope > h1#hero-h");
  assert.deepEqual([...h1.children].map((x) => [x.className, x.textContent]), [["sr-only", "NYC airport transfers."], ["hero__gold", "First Class"]]);
  const lists = [...hero.querySelectorAll(":scope > ul.hero__tags")];
  assert.deepEqual(lists.map((l) => [l.className, l.getAttribute("role"), [...l.children].map((li) => [li.tagName, li.textContent])]), [
    ["hero__tags", "list", [["LI", "Professional"], ["LI", "Luxury"], ["LI", "Reliable"]]],
    ["hero__tags hero__tags--svc", "list", [["LI", "Airport Transfers"], ["LI", "Hourly Service"], ["LI", "Corporate Travel"]]],
  ]);
  assert.equal(h1.nextElementSibling, lists[0], "the first line does not follow the H1");
  assert.equal(lists[1].nextElementSibling, hero.querySelector(":scope > div.hero__book"), "the booking card does not follow the second line");
  assert.equal(hero.querySelectorAll(".hero__lede, .eyebrow").length, 0, "the hero still has a lede or an eyebrow");
});

const cssFile = readdirSync(join(ROOT, "assets")).find((f) => /^lux\.[A-Za-z0-9_-]+\.css$/.test(f));
const css = read(`assets/${cssFile}`);
const parse = (s) => [...s.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, sel, body]) => [norm(sel), body]);
const rules = parse(css);
const block = (src, head) => {
  const a = src.indexOf(head);
  let d = 0;
  for (let i = a; a >= 0 && i < src.length; i++) {
    if (src[i] === "{") d++;
    if (src[i] === "}" && !--d) return src.slice(a, i + 1);
  }
  return "";
};
const layer = (name) => block(css, `@layer ${name}{`);

check(`index.html + assets/${cssFile}: the hero form's trust row says free waiting second, and the homepage hides that line because the band says it right below`, () => {
  assert.equal(norm(doc.querySelectorAll("#bk-assure > li")[1]?.textContent), "Free waiting after you land");
  assert.ok(rules.some(([sel, body]) => sel === ".home .hero__book #bk-assure>li:nth-child(2)" && body === "display:none"));
});

check(`index.html + assets/${cssFile}: the staged light hero is retired, no element and no rule names hero--light, and test/fixtures/hero-light.css is gone`, () => {
  assert.equal(doc.querySelector("main > section.hero").className, "frame hero");
  assert.equal(doc.querySelectorAll(".hero--light").length, 0);
  assert.ok(!/hero--light/.test(css), "lux.css ships light hero rules");
  assert.ok(!existsSync(join(ROOT, "test/fixtures/hero-light.css")), "test/fixtures/hero-light.css still exists");
});

check(`assets/${cssFile}: with scripting on, the homepage booking card is solid ink with a gold-500 edge and no blur, with gold-300 pins, icons and One way pill outside forced colors, pins in CanvasText in forced colors, and no card rule reaches another page`, () => {
  const pages = layer("pages");
  const [on, pill, forced, wide] = ["(scripting:enabled)", "(scripting:enabled) and (forced-colors:none)", "(scripting:enabled) and (forced-colors:active)", "(min-width:1024px) and (scripting:enabled)"].map((m) => parse(block(pages, `@media ${m}{`)));
  const has = (list, sel, ...want) => {
    const got = (list.find(([s]) => s === sel)?.[1] || "").split(";");
    assert.deepEqual(want.filter((d) => !got.includes(d)), [], sel);
  };
  has(on, ".home .hero__book>.bk>.bk-search::before", "inset:0", "background:var(--ink)", "-webkit-backdrop-filter:none", "backdrop-filter:none", "box-shadow:inset 0 0 0 1px var(--gold-500),var(--shadow-3)");
  has(on, ".home .hero__book :is(#bk-from-f,#bk-to-f)>label::before", 'content:""', "inline-size:16px", "block-size:16px", "background:var(--gold-300)", "-webkit-mask:var(--i-pin) center/contain no-repeat", "mask:var(--i-pin) center/contain no-repeat");
  has(on, ".home .hero__book :is(.bk-pick,#bk-adds) .icon", "color:var(--gold-300)");
  has(pill, ".home .hero__book .bk-mode label:has(:checked)", "background:var(--gold-300)", "color:var(--ink)");
  has(pill, ".home .hero__book .bk-ix label:has(:checked)", "background:none");
  has(pill, ".home .hero__book .bk-ix>label:first-of-type::before", "background:var(--gold-300)", "box-shadow:none");
  has(forced, ".home .hero__book :is(#bk-from-f,#bk-to-f)>label::before", "forced-color-adjust:none", "background:CanvasText");
  has(wide, ".home .hero__book>.bk>.bk-search", "padding:12px 24px 24px");
  assert.deepEqual([on, pill, forced, wide].flat().flatMap(([sel]) => sel.split(/,(?![^()]*\))/).map((s) => s.trim())).filter((s) => !s.startsWith(".home .hero__book")), []);
});

check(`assets/${cssFile}: the --i-pin mask, right before --i-alert in the tokens layer, draws the i-pin path of assets/icons.svg.html`, () => {
  const path = read("assets/icons.svg.html").match(/<symbol id="i-pin" viewBox="0 0 24 24"><path d="([^"]+)"\/><\/symbol>/)?.[1];
  const pin = layer("tokens").match(/\n--i-pin:url\("data:image\/svg\+xml,([^"]+)"\);\n--i-alert:/)?.[1];
  assert.ok(path, "no i-pin symbol in the sprite");
  assert.ok(pin, "no --i-pin token right before --i-alert");
  assert.ok(decodeURIComponent(pin).includes(`<path d='${path}'/>`), decodeURIComponent(pin));
});

check(`assets/${cssFile}: the hero is ink on a cream floor with First Class in the warm gold #946620, a cream veil of .4 to .8 (.92 for more contrast or less transparency), the homepage header in ink and the booking card ink with a gold-500 edge`, () => {
  const alpha = (body) => [...body.matchAll(/--veil:rgb\(251 248 242\/(\.\d+)\)/g)].map(([, a]) => Number(a));
  const base = rules.find(([sel, body]) => sel === ".hero" && body.startsWith("--measure:"))?.[1] || "";
  assert.ok(base.split(";").includes("background:var(--cream)") && base.split(";").includes("color:var(--ink)"), base);
  assert.ok(rules.some(([sel, body]) => sel === ".hero__gold" && body.split(";").includes("color:#946620")), "no #946620 rule for .hero__gold");
  const veils = [...alpha(base), ...parse(block(css, "@media (min-width:600px){.hero{")).flatMap(([, body]) => alpha(body))];
  assert.ok(veils.length >= 1 && veils.length <= 2 && veils.every((a) => a >= 0.4 && a <= 0.8), `veil alphas ${veils.join(", ")}`);
  assert.deepEqual(parse(block(css, "@media (prefers-contrast:more),(prefers-reduced-transparency:reduce){")).map(([sel, body]) => [sel, alpha(body)]), [[".hero", [0.92]]]);
  const header = parse(block(css, "@media (scripting:enabled){\n.home .site-header{")).find(([sel]) => sel === ".home .site-header")?.[1] || "";
  assert.ok(header.split(";").includes("--hdr-fg:var(--ink)"), header);
  const card = parse(block(layer("pages"), "@media (scripting:enabled){")).find(([sel]) => sel === ".home .hero__book>.bk>.bk-search::before")?.[1] || "";
  assert.ok(card.split(";").includes("background:var(--ink)") && card.includes("inset 0 0 0 1px var(--gold-500)"), card);
});

check(`assets/${cssFile}: outside the hero block and the print block no rule sets the hero's photo, text or veil variables on a selector that matches .hero`, () => {
  const a = css.indexOf(".hero{--measure:");
  const land = "@media (max-width:1023px) and (orientation:landscape) and (max-height:500px){";
  const end = css.indexOf(land) + block(css, land).length;
  assert.ok(a >= 0 && end > a, "no hero block");
  const rest = css.slice(0, a) + css.slice(end).replace(block(css.slice(end), "@media print{"), "");
  const hero = (sel) => sel.split(/,(?![^()]*\))/).some((one) => /(^|[^\w-])\.hero(?![\w-])/.test(one.trim().split(/[\s>+~]+(?![^()]*\))/).pop()));
  const vars = /(^|;)--(pt|pb|py|lt|lb|ly|pw|lw|band|pave|veil|cut|ct|cb|ph|tt|h1):/;
  assert.deepEqual(parse(rest).filter(([sel, body]) => hero(sel) && vars.test(body)).map(([sel]) => sel), []);
});

const PRELOADS = [...doc.querySelectorAll('head link[rel="preload"][as="image"]')];
const SOURCES = [...doc.querySelectorAll("main > section.hero > figure.hero__photo picture > source")];
check("index.html: three hero preloads, for layout L, for 600 px and wider in layout P, and for screens under 600 px, each with the AVIF list of its source, and 1200w for 3x phones but nothing above 1400w under 600 px", () => {
  const L = "(min-width: 1024px) and (min-aspect-ratio: 4/3)";
  assert.deepEqual(PRELOADS.map((l) => [l.getAttribute("type"), l.getAttribute("media"), l.getAttribute("imagesizes"), l.getAttribute("fetchpriority")]), [
    ["image/avif", L, "100vw", "high"],
    ["image/avif", `(min-width: 600px) and (not (${L}))`, "100vw", "high"],
    ["image/avif", "(max-width: 599px)", "100vw", "high"],
  ]);
  const avif = SOURCES.filter((x) => x.getAttribute("type") === "image/avif");
  assert.deepEqual(avif.map((x) => x.getAttribute("media")), [L, "(min-width: 600px)", null]);
  assert.deepEqual(PRELOADS.map((l) => l.getAttribute("imagesrcset")), avif.map((x) => x.getAttribute("srcset")));
  assert.deepEqual(SOURCES.map((x) => x.getAttribute("sizes")), Array(6).fill("100vw"));
  const small = [PRELOADS[2].getAttribute("imagesrcset"), ...SOURCES.filter((x) => !x.hasAttribute("media")).map((x) => x.getAttribute("srcset"))];
  assert.deepEqual(small.flatMap((list) => nums(list.replace(/\/fleet\/[a-z0-9-]+?-(?=\d+\.(?:avif|webp))/g, "")).filter((w, i) => i % 2 === 0 && w > 1400)), []);
  assert.deepEqual(small.filter((list) => !/-1200\.(?:avif|webp) 1200w,/.test(list)), [], "no 1200w candidate for 3x phones");
});

check(`index.html + assets/${cssFile}: the wide stylesheet's media is the fit rule's side margin condition, computed from --header-h, --lb, --ly and the photo ratio, so it never turns on after a margin opens`, () => {
  const tokens = layer("tokens");
  const hh = Number(tokens.replace(block(tokens, "@media (max-width:1023px){"), "").match(/--header-h:(\d+)px/)?.[1]);
  const hero = rules.find(([sel, body]) => sel === ".hero" && body.startsWith("--measure:"))?.[1] || "";
  const [lb, ly] = ["lb", "ly"].map((v) => Number(hero.match(new RegExp(`--${v}:([\\d.]+)`))?.[1]));
  const fit = rules.find(([sel, body]) => sel === ".hero" && body.startsWith("--lw:min("))?.[1] || "";
  const [, ph, pw, gap] = (fit.match(/^--lw:min\(100cqi \* (\d+) \/ (\d+),\(100svh - var\(--header-h\) - (\d+)px\) \/ \(var\(--lb\) - var\(--ly\)\)\)/) || []).map(Number);
  assert.ok(hh > 0 && lb > ly && ly >= 0 && ph > 0 && pw > 0 && gap >= 0, `header ${hh}px, lb ${lb}, ly ${ly}, fit rule ${fit.slice(0, 96)}`);
  const k = pw / ph / (lb - ly);
  const links = [...doc.querySelectorAll('head link[rel="stylesheet"][href^="/assets/wide."]')];
  assert.equal(links.length, 1, "index.html links no wide stylesheet, or more than one");
  assert.equal(links[0].getAttribute("media"), `(min-width: 1024px) and (scripting: enabled) and (min-width: calc(${Math.floor(1000 * k) / 10}vh - ${Math.ceil((hh + gap) * k)}px))`);
});

if (failures) {
  console.error(`\n${failures} landing assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll landing tests passed");
process.exit(0);
