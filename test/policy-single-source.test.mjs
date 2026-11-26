import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const { POLICY, NOTES, CHECKOUT, MAIL, SEATS } = await import(pathToFileURL(join(ROOT, "api", "_copy.mjs")).href);
const { FREE_WAIT_MINUTES, WAIT_CENTS_PER_MINUTE, CANCEL_TIERS, CLASSES } = await import(pathToFileURL(join(ROOT, "api", "_rates.mjs")).href);
const FULL = ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html"];
const nt = (s) => s.replace(/\s+/g, " ").trim();
const doc = (f) => new JSDOM(readFileSync(join(ROOT, f), "utf8")).window.document;
const jsonld = (d) => [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
const faqOf = (d) => jsonld(d).flatMap((o) => (Array.isArray(o["@graph"]) ? o["@graph"] : [o])).find((o) => o["@type"] === "FAQPage");
const visible = (d, id) => nt(d.querySelector(`#${id} .acc__body`).textContent);
const ldAnswer = (d, id) => {
  const name = nt(d.querySelector(`#${id} summary`).textContent);
  const q = faqOf(d).mainEntity.find((x) => x.name === name);
  assert.ok(q, `no FAQPage question ${name}`);
  return nt(q.acceptedAnswer.text);
};
const RETIRED = /written confirmation (?:includes|has) the cancellation terms|cancellation terms come|confirmed in writing with the reservation|Terms confirmed in writing|depends on the vehicle|several tries|as early as you can\. Your written/i;

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "scripts", "test", "assets", "fleet", "api"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
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

check("the policy figures live in api/_rates.mjs: free waiting 15, 45 and 60 minutes, extra waiting per minute by class, and the four cancellation tiers of the owner", () => {
  assert.deepEqual(FREE_WAIT_MINUTES, { local: 15, domestic: 45, international: 60 });
  assert.deepEqual(Object.keys(WAIT_CENTS_PER_MINUTE).sort(), Object.keys(CLASSES).sort());
  assert.deepEqual(WAIT_CENTS_PER_MINUTE, { sedan: 120, electric: 120, suv: 150, premium: 180, first: 280, sprinter: 400 });
  assert.deepEqual(CANCEL_TIERS, [{ hours: 24, percent: 0 }, { hours: 12, percent: 25 }, { hours: 2, percent: 50 }, { hours: 0, percent: 100 }]);
});

check("every POLICY sentence is the owner's policy, filled from api/_rates.mjs, with no dash or semicolon", () => {
  const [free, late, later] = CANCEL_TIERS;
  assert.equal(POLICY.freeWait, `You get ${FREE_WAIT_MINUTES.domestic} minutes of free waiting after a domestic landing, ${FREE_WAIT_MINUTES.international} minutes after an international landing, and ${FREE_WAIT_MINUTES.local} minutes at any other pickup.`);
  assert.equal(POLICY.extraWait, "After the free waiting, we charge by the minute at the rate for your vehicle.");
  assert.equal(POLICY.waiting, `${POLICY.freeWait} ${POLICY.extraWait}`);
  assert.deepEqual(POLICY.waitPrices, Object.fromEntries(Object.entries(WAIT_CENTS_PER_MINUTE).map(([k, c]) => [k, `$${(c / 100).toFixed(2)}`])));
  assert.deepEqual(POLICY.waitPrices, { sedan: "$1.20", electric: "$1.20", suv: "$1.50", premium: "$1.80", first: "$2.80", sprinter: "$4.00" });
  assert.equal(POLICY.waitRate, "Extra waiting is {price} a minute.");
  assert.equal(POLICY.cancelShort, `Free cancellation up to ${free.hours} hours before pickup.`);
  assert.equal(POLICY.cancel, "Free cancellation up to 24 hours before pickup. Under 24 hours, the charge is 25% of the price. Under 12 hours, it's 50%. Under 2 hours, it's the full price.");
  assert.ok(POLICY.cancel.startsWith(POLICY.cancelShort + " "));
  assert.ok(POLICY.cancel.includes(`Under ${free.hours} hours, the charge is ${late.percent}%`) && POLICY.cancel.includes(`Under ${late.hours} hours, it's ${later.percent}%`) && POLICY.cancel.includes(`Under ${later.hours} hours, it's the full price`));
  assert.equal(POLICY.howTo, "To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference.");
  assert.equal(POLICY.noShow, "If you're not at the pickup when your free waiting ends and haven't asked us to change or cancel, your chauffeur tries to reach you. If we still can't reach you, it's a no-show. The full price applies, with no waiting charge on top.");
  assert.equal(POLICY.changes, "Changes depend on availability and can change the price. Events, holidays, groups and custom trips can have a different cancellation deadline. If yours does, we tell you by email or WhatsApp before you pay.");
  assert.equal(POLICY.link, "Cancellation, no-show and waiting terms");
  for (const s of [POLICY.waiting, POLICY.cancel, POLICY.howTo, POLICY.noShow, POLICY.changes, POLICY.link, POLICY.later.airport, POLICY.later.hourly, POLICY.later.outside, NOTES.included]) assert.doesNotMatch(s, /[–—;]/);
  assert.doesNotMatch(POLICY.howTo, /\+1 \(646\)|call/);
});

check("the email free waiting lines say the same minutes as FREE_WAIT_MINUTES", () => {
  assert.ok(MAIL.day.pickup.includes(`${FREE_WAIT_MINUTES.local} minutes of free waiting from the pickup time`), MAIL.day.pickup);
  assert.ok(MAIL.where.landing.includes(`${FREE_WAIT_MINUTES.domestic} minutes of free waiting after a domestic landing and ${FREE_WAIT_MINUTES.international} minutes after an international landing`), MAIL.where.landing);
});

check("rates.html #policies carries POLICY.waiting, the waiting table, POLICY.cancel sentence by sentence with POLICY.howTo, POLICY.noShow and POLICY.changes", () => {
  const d = doc("rates.html");
  assert.ok(d.getElementById("policies"), "no #policies");
  assert.equal(nt(d.querySelector("#waiting > p").textContent), POLICY.waiting);
  assert.deepEqual([...d.querySelectorAll("#waiting-rates tbody td")].map((td) => td.textContent), Object.keys(CLASSES).map((k) => POLICY.waitPrices[k]));
  assert.equal([...d.querySelectorAll("#cancellation li")].map((li) => nt(li.textContent)).join(" "), POLICY.cancel);
  assert.equal(nt(d.querySelector("#cancellation > p").textContent), POLICY.howTo);
  assert.equal(nt(d.querySelector("#no-show > p").textContent), POLICY.noShow);
  assert.equal(nt(d.querySelector("#changes > p").textContent), POLICY.changes);
});

check("faq.html: cancellation, changes, extra waiting and no-show answers are the POLICY texts, the same in the page and in its FAQPage JSON-LD", () => {
  const d = doc("faq.html");
  const want = {
    "q-cancellation": `${POLICY.cancel} ${POLICY.howTo}`,
    "q-changes": `${POLICY.changes} ${POLICY.howTo}`,
    "q-waiting-charges": `Yes. ${POLICY.extraWait} The rate for each vehicle is on our rates page.`,
    "q-no-show": POLICY.noShow,
  };
  for (const [id, text] of Object.entries(want)) assert.deepEqual([visible(d, id), ldAnswer(d, id)], [text, text], id);
  assert.equal(d.querySelector("#q-waiting-charges a").getAttribute("href"), "/rates#waiting");
  assert.equal(d.getElementById("q-changes").previousElementSibling.id, "q-cancellation");
  assert.equal(d.getElementById("q-no-show").previousElementSibling.id, "q-waiting-charges");
  assert.equal(faqOf(d).mainEntity.length, d.querySelectorAll("main details.acc").length);
  const seats = [visible(d, "q-child-seats"), ldAnswer(d, "q-child-seats")];
  assert.ok(seats.every((t) => t.includes(` ${SEATS.line} `)), seats.join(" | "));
  assert.equal(seats[0], seats[1]);
});

check("terms-of-service.html: section 7 holds the waiting, cancellation, how to cancel, no-show and changes texts, the lede points to it, and the old written terms line is gone", () => {
  const d = doc("terms-of-service.html");
  const h = d.getElementById("cancellation-terms");
  assert.equal(nt(h.textContent), "7. Waiting, cancellation and no-shows");
  const ps = [];
  for (let n = h.nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) ps.push(nt(n.textContent));
  assert.deepEqual(ps, [`${POLICY.waiting} The rate for each vehicle is on our rates page.`, POLICY.cancel, POLICY.howTo, POLICY.noShow, POLICY.changes]);
  assert.ok(nt(d.querySelector(".lede").textContent).endsWith("Your fare is shown when you book, and section 7 covers waiting, cancellation and no-shows."));
  assert.deepEqual([...d.querySelectorAll(".lede a")].map((a) => [a.getAttribute("href"), a.textContent]), [["#cancellation-terms", "section 7"]]);
  assert.equal(d.querySelector('nav.toc a[href="#cancellation-terms"]').textContent, "7. Waiting, cancellation and no-shows");
  assert.deepEqual([...d.querySelectorAll("main h2")].map((x) => nt(x.textContent).split(". ")[0]), Array.from({ length: 16 }, (_, i) => String(i + 1)));
});

check("card-authorization.html: the cancellation policy section shows POLICY.cancel and POLICY.howTo, and the Cancellation fact links the free cancellation line to /rates#cancellation", () => {
  const d = doc("card-authorization.html");
  const ps = [];
  for (let n = d.getElementById("cancellation-policy").nextElementSibling; n && n.tagName === "P"; n = n.nextElementSibling) ps.push(nt(n.textContent));
  assert.equal(ps[0], POLICY.cancel);
  assert.ok(ps[1].startsWith(POLICY.howTo + " "), ps[1]);
  assert.equal(ps[1], `${POLICY.howTo} See the ${POLICY.link.toLowerCase()}.`);
  assert.equal(d.getElementById("cancellation-policy").nextElementSibling.nextElementSibling.querySelector('a[href="/rates#policies"]').textContent, POLICY.link.toLowerCase());
  const dd = [...d.querySelectorAll("dl.facts dt")].find((x) => nt(x.textContent) === "Cancellation").nextElementSibling;
  assert.equal(nt(dd.textContent), POLICY.cancelShort.replace(/\.$/, ""));
  assert.equal(dd.querySelector("a").getAttribute("href"), "/rates#cancellation");
});

check("schedule.html carries POLICY.cancel and POLICY.howTo as the value of its Cancellation fact", () => {
  const d = doc("schedule.html");
  const dt = [...d.querySelectorAll("main dl.facts dt")].find((x) => nt(x.textContent) === "Cancellation");
  assert.ok(dt, "no Cancellation fact");
  assert.equal(nt(dt.nextElementSibling.textContent), `${POLICY.cancel} ${POLICY.howTo}`);
});

for (const f of FULL) {
  check(`${f}: before payment the form links the cancellation, no-show and waiting terms at /rates#policies in the consent line by the pay button and under the price, #bk-terms by the pay button opens with the full cancellation policy and how to cancel, and the form names no phone number`, () => {
    const d = doc(f);
    const terms = d.getElementById("bk-terms"), first = terms.querySelector(":scope > p");
    assert.deepEqual([terms.tagName, terms.parentElement.id, terms.previousElementSibling.id, nt(terms.querySelector(":scope > summary").textContent)], ["DETAILS", "bk-go", "bk-consent", "Cancellation and terms"]);
    assert.deepEqual([first.children.length, nt(first.textContent)], [0, `${POLICY.cancel} ${POLICY.howTo}`]);
    const policy = d.getElementById("bk-policy");
    assert.ok(nt(policy.textContent).startsWith(POLICY.cancelShort + " "), nt(policy.textContent));
    assert.deepEqual([policy.querySelector("a").getAttribute("href"), nt(policy.querySelector("a").textContent)], ["/rates#policies", `${POLICY.link} (opens in a new tab)`]);
    const consent = d.getElementById("bk-consent");
    const links = [...consent.querySelectorAll("a")].map((a) => [a.getAttribute("href"), nt(a.textContent)]);
    assert.deepEqual(links, [["/terms-of-service#payments", "terms of service (opens in a new tab)"], ["/rates#policies", `${POLICY.link.toLowerCase()} (opens in a new tab)`]]);
    assert.equal(d.getElementById("bk-submit").getAttribute("aria-describedby"), "bk-consent");
    assert.equal(consent.getAttribute("data-show"), "details");
    assert.doesNotMatch(nt(d.getElementById("book-form").textContent), /775-0556|\bcall\b/i);
  });
}

for (const f of FULL) {
  check(`${f}: #bk-terms beside the pay button names every cancellation charge of CANCEL_TIERS and opens by itself within ${CANCEL_TIERS[0].hours} hours of pickup, so a booking within 24 hours sees its charge before paying`, () => {
    const text = nt(doc(f).getElementById("bk-terms").textContent);
    const js = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((n) => /^pay\..+\.js$/.test(n))), "utf8");
    assert.ok(CANCEL_TIERS[0].hours * 36e5 === 864e5 && js.includes('XY=()=>ny(Date.now()+AO+864e5+59999)>ED.value+" "+ET.value&&($("bk-terms").open=!0)') && js.includes('"car"));wk();XY();'), "the terms open on step 2 when the pickup is under the first tier");
    for (const { percent } of CANCEL_TIERS.filter((t) => t.percent > 0 && t.percent < 100)) assert.ok(text.includes(`${percent}%`), `${percent}% missing`);
    for (const { hours } of CANCEL_TIERS.filter((t) => t.hours > 0)) assert.ok(text.includes(`${hours} hours`), `${hours} hours missing`);
    assert.ok(text.includes("the full price"), text);
  });
}

check("the price notes link their extra waiting words to /rates#waiting in a new tab, in the script that writes them", () => {
  const name = readdirSync(join(ROOT, "assets")).find((n) => /^pay\..+\.js$/.test(n));
  const js = readFileSync(join(ROOT, "assets", name), "utf8");
  assert.ok(js.includes('ES(t).replace(/extra waiting/i,m=>\'<a class="nowrap" href="/rates#waiting" target="_blank" rel="noopener">\'+m+ic("i-external")+\'<span class="sr-only"> (opens in a new tab)</span></a>\')'), "no waiting link in the price notes");
  const css = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((n) => /^book\..+\.css$/.test(n))), "utf8");
  assert.ok(css.includes(":is(.bk-consent,.bk-policy,.bk-later a) .icon{width:14px;height:14px;margin-inline-start:4px;vertical-align:-2px}") && css.includes(":is(.bk-later,#cf-notes)>li>.icon{"), "the new tab icon in the price notes is sized like the other new tab icons on the form");
  for (const note of [POLICY.later.airport, POLICY.later.outside, POLICY.later.returnFlat, POLICY.later.outFlat, POLICY.later.waiting]) assert.match(note, /extra waiting/i, note);
});

check("booking-confirmed.html: #cf-policy is the free cancellation line, how to cancel and a link to the cancellation, no-show and waiting terms", () => {
  const p = doc("booking-confirmed.html").getElementById("cf-policy");
  assert.equal(nt(p.textContent), `${POLICY.cancelShort} ${POLICY.howTo} See the ${POLICY.link.toLowerCase()}.`);
  assert.equal(p.querySelector("a").getAttribute("href"), "/rates#policies");
});

check("Stripe and the emails link the policies: the consent text links /rates#policies, the email link label is POLICY.link and the after-submit text says how to change or cancel", () => {
  assert.ok(CHECKOUT.terms.includes(`[${POLICY.link.toLowerCase()}](https://www.nycluxride.com/rates#policies)`), CHECKOUT.terms);
  assert.equal(MAIL.rates, POLICY.link);
  assert.ok(CHECKOUT.afterSubmit.includes("To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference {ref}."));
  assert.equal(MAIL.change, POLICY.howTo.replace(/\.$/, " {ref}."));
  assert.doesNotMatch(CHECKOUT.afterSubmit, /775-0556|\bcall\b/i);
});

check("the price notes are built from POLICY and NOTES.included", () => {
  assert.equal(NOTES.airport, NOTES.included + " " + POLICY.later.airport);
  assert.equal(NOTES.hourly, POLICY.later.hourly);
  assert.equal(NOTES.included, "Tolls, airport fees and the service fee are included.");
});

check("chauffeur-service-nyc.html: the hourly waiting answer gives the free waiting and no per-minute charge, in the visible text and the FAQPage JSON-LD", () => {
  const d = doc("chauffeur-service-nyc.html");
  const answer = `No. Waiting between stops is part of the hours you booked. ${POLICY.freeWait} We count from touchdown for flights and from the booked pickup time for other pickups.`;
  assert.deepEqual([visible(d, "q-standing-time"), ldAnswer(d, "q-standing-time")], [answer, answer]);
});

const FILES = htmlFiles(ROOT);
const TRAIN_DELAY = ["locations/manhattan.html", "locations/midtown-manhattan.html"];
check("no page or server copy asks to change a booking as early as you can, apart from the train delay sentences still with the owner", () => {
  const hits = FILES.filter((f) => !TRAIN_DELAY.includes(f) && /as early as you can/i.test(readFileSync(join(ROOT, f), "utf8")));
  const api = readdirSync(join(ROOT, "api")).filter((n) => n.endsWith(".mjs") && /as early as you can/i.test(readFileSync(join(ROOT, "api", n), "utf8")));
  assert.deepEqual([...hits, ...api], []);
});

check("private-jet-car-service-nyc.html: the change paragraph uses POLICY.howTo word for word", () => {
  const p = [...doc("private-jet-car-service-nyc.html").querySelectorAll("main p")].find((x) => x.textContent.startsWith("Private flights move."));
  assert.ok(nt(p.textContent).includes(` ${POLICY.howTo} Tell us the new time, building or airport, and we update the booking. `), nt(p.textContent));
});
check("no page, script or server copy keeps the retired written terms, vehicle dependent rate or several tries wording", () => {
  const hits = FILES.filter((f) => RETIRED.test(readFileSync(join(ROOT, f), "utf8")));
  const api = readdirSync(join(ROOT, "api")).filter((n) => n.endsWith(".mjs") && RETIRED.test(readFileSync(join(ROOT, "api", n), "utf8")));
  assert.deepEqual([...hits, ...api], []);
});

check("every page that names a cancellation deadline uses the one free cancellation wording of POLICY.cancelShort", () => {
  const bad = [];
  for (const f of FILES) {
    const text = nt(new JSDOM(readFileSync(join(ROOT, f), "utf8")).window.document.body.textContent);
    const all = [...text.matchAll(/\d+ hours before pickup/g)].length;
    const ours = [...text.matchAll(/Free cancellation up to (\d+) hours before pickup/g)].filter((m) => Number(m[1]) === CANCEL_TIERS[0].hours).length;
    if (all !== ours) bad.push(`${f}: ${all - ours} other deadline wording`);
  }
  assert.deepEqual(bad, []);
});

check("every page with a /rates#policies, #waiting, #cancellation, #no-show or #changes link points at an anchor the rates page has", () => {
  const ids = new Set([...doc("rates.html").querySelectorAll("[id]")].map((el) => el.id));
  for (const id of ["policies", "waiting", "cancellation", "no-show", "changes"]) assert.ok(ids.has(id), id);
  const linked = FILES.flatMap((f) => [...readFileSync(join(ROOT, f), "utf8").matchAll(/href="\/rates#([a-z-]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(linked.filter((id) => !ids.has(id)))], []);
  assert.ok(linked.includes("policies") && linked.includes("waiting"));
});

if (failures) {
  console.error(`\n${failures} policy single-source assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll policy single-source tests passed");
process.exit(0);
