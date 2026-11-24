import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = process.env.SITE_ROOT || join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const load = (f) => import(pathToFileURL(join(ROOT, "api", f)).href);
const { CHECKOUT_ORIGINS, MAX_ADVANCE_DAYS, MIN_NOTICE_MINUTES, SPRINTER_NOTICE_HOURS, SPRINTER_BUSY_HOURS, AUTO_LEAD_MINUTES, AUTO_GUARD_MINUTES, AIRPORT_FARES, AIRPORT_TOTALS, MEET_AND_GREET, STOP_FEE_CENTS, VEHICLES, SITE_ORIGIN } = await load("_rates.mjs");
const { REASONS, ERRORS, NOTES, POLICY } = await load("_copy.mjs");

const CONFIRMED_IDS = ["cf", "cf-h", "cf-test", "cf-refrow", "cf-ref", "cf-copy", "cf-noref", "cf-fail", "cf-retry", "cf-missing", "cf-none", "cf-trip", "cf-route", "cf-rows", "cf-other", "cf-next", "cf-day", "cf-policy", "cf-acts", "cf-ics", "cf-return", "cf-quiet", "cf-gcal", "cf-share", "cf-wa", "cf-print", "cf-receipt", "cf-receipt-h", "cf-lines", "cf-total", "cf-notes", "cf-summary", "cf-help", "cf-home", "cf-status"];
const AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "financial-district", "soho", "upper-east-side", "upper-west-side", "long-island-city"];
const HOSTS = ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html", "locations/teterboro-airport.html", "services.html", "chauffeur-service-nyc.html", "limousine-service-nyc.html", "black-car-service-brooklyn.html", "car-service-with-car-seat-nyc.html", ...AREAS.map((a) => `locations/${a}.html`), "locations/westchester-airport.html", "locations/hoboken.html", "long-distance-car-service.html", "long-distance-car-service/nyc-to-philadelphia.html", ...["pet-friendly-car-service-nyc", "private-jet-car-service-nyc", "roadshow-transportation-nyc", "sprinter-van-service-nyc", "cruise-terminal-car-service-nyc", "wedding-car-service-nyc"].map((s) => `${s}.html`), ...["philadelphia-airport", "long-island-macarthur-airport", "stewart-airport", "morristown-airport", "republic-airport", "bradley-airport", "midtown-manhattan", "long-island", "hamptons", "westchester-county", "greenwich-ct", "stamford-ct", "new-jersey", "jersey-city", "weehawken-north-bergen", "secaucus", "newark-nj", "fort-lee", "edgewater", "englewood", "paramus", "alpine-tenafly", "short-hills-livingston", "morristown", "summit", "princeton"].map((a) => `locations/${a}.html`), ...["nyc-to-boston", "nyc-to-washington-dc", "nyc-to-atlantic-city", "nyc-to-connecticut"].map((r) => `long-distance-car-service/${r}.html`)];
const FULL_HOSTS = 6;

const norm = (s) => s.replace(/\s+/g, " ").trim();
const read = (f) => {
  const html = readFileSync(join(ROOT, f), "utf8");
  return { html, document: new JSDOM(html).window.document };
};
const book = read("book.html");
const confirmed = read("booking-confirmed.html");
const doc = book.document;
const $ = (id, d = doc) => d.getElementById(id);
const payName = readdirSync(join(ROOT, "assets")).find((n) => /^pay\..+\.js$/.test(n));
const pay2Name = readdirSync(join(ROOT, "assets")).find((n) => /^pay2\..+\.js$/.test(n));
const PAY = readFileSync(join(ROOT, "assets", payName), "utf8");
const SRC = [PAY, pay2Name ? readFileSync(join(ROOT, "assets", pay2Name), "utf8") : ""].join("\n");
const doneName = readdirSync(join(ROOT, "assets")).find((n) => /^done\..+\.js$/.test(n));
const DONE = doneName ? readFileSync(join(ROOT, "assets", doneName), "utf8") : "";
const LUX = readFileSync(join(ROOT, "assets", readdirSync(join(ROOT, "assets")).find((n) => /^lux\..+\.js$/.test(n))), "utf8");
const SHEETS = readdirSync(join(ROOT, "assets")).filter((n) => /^(lux|book)\..+\.css$/.test(n)).map((n) => readFileSync(join(ROOT, "assets", n), "utf8")).join("\n");

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

check("pets: pay.js reprices on a change of either dog count, keys the price on both counts, shows both prices from the answer in the legend, keeps a pending Small dog and Large dog line after the child seats, writes one line per dog size into the messages, gives each count the stepper of the seat counts with Less off at 0 and More off at the last option, shows the dogs message when More is pressed there, clears it with the next change and the next answer, moves the pets with the child seats, and holds no dog price, and done.js keeps the dog lines in the receipt skeleton", () => {
  assert.match(PAY, /DF=\$\("bk-pets"\),DS=\(\)=>\[\.\.\.DF\.elements\]\.filter\(x=>x\.name\)/);
  assert.match(PAY, /pq=\(\)=>\[E\.class\.value,E\.vehicle\.value,E\.sprinter\.value,E\.hours\.value,\$\("bk-meet"\)\.checked,te\(\),PA\.value,KS\(\)\.map\(x=>x\.value\),DS\(\)\.map\(x=>x\.value\),/);
  assert.match(PAY, /r\.small_dog_cents&&T\("pets-p",\(DC=\[M\(r\.small_dog_cents\),M\(r\.large_dog_cents\)\]\)\[0\]\+" small, "\+DC\[1\]\+" large"\)/);
  assert.match(PAY, /"Child seats",LV\[n\]\|\|"\.\.\."\]\);DS\(\)\.map\(\(x,i\)=>\+x\.value&&r\.push\(\[i=x\.labels\[0\]\.textContent\+\(DC\?" \("\+x\.value\+" x "\+DC\[i\]\+"\)":""\),LV\[i\]\|\|"\.\.\."\]\)\);t&&r\.push/, "the pending dog lines sit after the child seats and before the gratuity, as the answer puts them");
  assert.match(PAY, /GO\|\|DS\(\)\.map\(x=>\+x\.value&&l\.push\(x\.labels\[0\]\.textContent\+"s: "\+x\.value\)\)/);
  assert.match(PAY, /KX=KS\(\)\.map\(s=>mS\(s,s\.labels\[0\]\.firstChild\.data\.trim\(\)\.toLowerCase\(\)\+"s"\)\);DX=DS\(\)\.map\(s=>mS\(s,s\.name\.replace\("_"," "\)\)\);/);
  assert.match(PAY, /\[\.\.\.DX,\.\.\.BX\]\.map\(\(x,i\)=>\{let s=\[\.\.\.DS\(\),\.\.\.BS\(\)\]\[i\];i=s\.value;x\.children\[1\]\.textContent!=i&&\(x\.children\[1\]\.textContent=i\);x\.firstChild\.ariaDisabled=i<1;x\.lastChild\.ariaDisabled=i>=s\.length-1\}\);/, "a dog count is written only when it changes, and More stops at the last option of its select");
  assert.match(PAY, /WM2="";V\(\);BK&&sv\(\);uk\(\$\("e-dogs"\)\);uk\(\$\("e-child_seats"\)\);su\(\);/);
  assert.match(PAY, /iv\(r\);uk\(\$\("e-child_seats"\)\);uk\(\$\("e-dogs"\)\);/);
  assert.match(PAY, /KX=\[\],DX=\[\],/);
  assert.doesNotMatch(SRC, /45\.00|\$45|dog_cents[:=]\d|4500/);
  assert.equal(book.html.split('id="bk-pets"').length, 2);
});

check("bags: pay.js gives each bag count the stepper of the pet counts with Less off at 0 and More off at the last option, shows the bags message when More is pressed there and clears it with the next change, never reprices or asks the server again on a bag change, writes one line per bag size right after Passengers into both messages, replaces the stale bag lines of the server's message, shows the over-capacity note from the chosen card and speaks it only after load, adds a Bags row with its Change button to Check your trip, reads the three counts from a deep link, and done.js shows them on the confirmation", () => {
  assert.match(PAY, /BF=\$\("bk-bags"\),BS=\(\)=>\[\.\.\.BF\.elements\]\.filter\(x=>x\.name\),bn2=\(\)=>BS\(\)\.filter\(x=>\+x\.value\),bl=\(\)=>bn2\(\)\.map\(x=>x\.labels\[0\]\.textContent\+": "\+x\.value\),bg=\(\)=>bn2\(\)\.map\(x=>x\.value\+" "\+x\.name\.split\("_"\)\[0\]\)\.join\(", "\),/);
  assert.match(PAY, /DX=DS\(\)\.map\(s=>mS\(s,s\.name\.replace\("_"," "\)\)\);BX=BS\(\)\.map\(s=>mS\(s,s\.name\.replace\("_bags"," suitcases"\)\)\);/);
  assert.match(PAY, /KX=\[\],DX=\[\],BX=\[\],/);
  assert.match(PAY, /x\.lastChild\.ariaDisabled=i>=s\.length-1\}\);let c=kc\(\),g=c\?c\.parentNode\.dataset:\{\},a=\+E\.large_bags\.value,b=\+E\.medium_bags\.value\+ \+E\.small_bags\.value,h=N\("bagfit"\),u=BT\|\|\(BT=h\.textContent\),K=\[\.\.\.F\.querySelectorAll\("\.bk-card\[data-large\]"\)\]\.map\(x=>x\.dataset\),f=x=>a<=x\.large&&a\+b<=\+x\.large\+ \+x\.small,y=!!c&&!\(g\.large\?f\(g\):K\.every\(f\)\),t=K\.some\(f\)\?u:"Your bags may not fit in any of our cars\. Tell us in the notes\.",k=BC&&BC!=c;BC=c;y\?\(h\.hidden\|\|h\.textContent!=t\)&&\(k&&h\.hidden&&!cs\(h,"keep"\)&&c\.parentNode\.after\(h\),h\.textContent=t,h\.hidden=!1,IL\|\|SU\(t\)\):h\.hidden\|\|\(tg\(h,"keep",!!k\),h\.hidden=!0,IL\|\|N\("status"\)\.textContent!=h\.textContent\|\|SU\(""\)\)\}/, "the note shows when the large suitcases pass the card's large count or all bags, medium and small included, pass its total, checks a card without a stated count against the smallest stated one, says so when no car fits, sits after a newly chosen card and keeps its space when a car change hides it so the clicked card stays put, speaks only on a change after load and clears its words from the status line when it hides");
  assert.match(PAY, /\/_bags\$\/\.test\(n\)&&\(tg\(N\("bagfit"\),"keep",0\),su\(\),uk\(\$\("e-bags"\)\)\);ch\(\);/);
  assert.match(PAY, /KX=\[\],DX=\[\],BX=\[\],BC=0,BT="",/);
  assert.match(PAY, /if\(\/\^\(class\|vehicle\|sprinter\|meet\|tip\|passengers\|\\w\+_\(seats\|dogs\)\)\$\/\.test\(n\)\)/, "a bag change never reprices");
  assert.doesNotMatch(PAY, /_bags\.value,ap\(\)|BS\(\)\.map\(x=>x\.value\)/, "the price key leaves the bags out");
  assert.match(PAY, /GO\|\|l\.push\("Passengers: "\+PA\.value,\.\.\.bl\(\)\);/);
  assert.match(PAY, /a=SV\?SV\[0\]\.split\("\\n"\)\.filter\(l=>!\/\^\(Flight\|\(Large\|Medium\|Small\) suitcase\[\^:\]\*\): \/\.test\(l\)\):wl\(\)/);
  assert.match(PAY, /SV&&\(i=a\.findIndex\(l=>\/\^Passengers: \/\.test\(l\)\)\)>=0&&a\.splice\(i\+1,0,\.\.\.bl\(\)\);/);
  assert.match(PAY, /rw\("Passengers",PA\.value,"pax"\)\+\(bg\(\)&&rw\("Bags",bg\(\),"bags"\)\)\+rw\("Car"/);
  assert.match(PAY, /pax:"passengers",bags:"bags",car:"car"\}/);
  assert.match(PAY, /BV=="pax"\?SX\.firstChild:BV=="bags"\?BX\[0\]\.firstChild:/);
  assert.match(PAY, /\|return\(_date\|_time\|_flight\)\?\|passengers\|\(large\|medium\|small\)_bags\)\$\/\.test\(k\)/);
  assert.match(PAY, /R\("trip-type pickup dropoff hours date time passengers large-bags medium-bags small-bags flight class sprinter"\)/);
  assert.match(PAY, /BS\(\)\.map\(x=>\{let v=q\[x\.name\.replace\("_","-"\)\];v&&\(x\.value=v,x\.value\|\|\(x\.value="0"\)\)\}\);/);
  assert.match(DONE, /\+rw\("Car",cn\[0\]&&ES\(cn\[0\]\)\+sm\(ES\(cn\[1\]\|\|""\)\)\)\+rw\("Bags",\["large","medium","small"\]\.filter\(k=>\+f\[k\+"_bags"\]\)\.map\(k=>f\[k\+"_bags"\]\+" "\+k\)\.join\(", "\)\)/);
  assert.equal(book.html.split('id="bk-bags"').length, 2);
  assert.equal($("e-bags").textContent, ERRORS.bags.text);
  assert.equal($("bk-bagfit").textContent, "Your bags may not fit in this car. Choose a larger car or tell us in the notes.");
  assert.ok($("bk-bagfit").hidden && $("bk-bagfit").matches(".bk-mrow__x.bk-js-only"));
  assert.doesNotMatch(SRC, /bag_cents|bags_cents/);
});

check("book.html head: title, description, canonical, indexable", () => {
  assert.equal(doc.title, "Book a car | NYC LUX RIDE");
  assert.equal(doc.querySelector('meta[name="description"]').content, "Book an airport transfer or an hourly car in New York City. Choose the pickup, the drop-off, the date and the vehicle.");
  assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://www.nycluxride.com/book");
  assert.doesNotMatch(doc.querySelector('meta[name="robots"]')?.content || "", /noindex/);
});

check("book.html main is the band with the heading and the four notes, the step counts in the step headings, then section.bk-page with the form, the country list template after it and the trust section last", () => {
  const main = doc.querySelector("main");
  assert.deepEqual([...main.children].map((e) => `${e.tagName.toLowerCase()}.${e.className}`), ["section.band", "section.section bk-page"]);
  const band = main.children[0], frame = band.querySelector(":scope > .frame");
  assert.equal(band.getAttribute("aria-labelledby"), "book-h");
  assert.deepEqual([...frame.children].map((e) => e.id || e.className), ["eyebrow", "book-h", "lede", "resume", "restored", "booked", "retnote", "from-search"]);
  assert.ok($("booked").matches('div.notice.bk-note[role="status"]') && norm($("booked").querySelector("span").textContent) === "This trip is booked. Reference ." && $("booked-ref").matches("span") && $("booked").querySelector('a.lnk[href="/booking-confirmed"]').textContent === "See your booking");
  assert.deepEqual(["resume-k", "resume-p"].map((id) => [$(id).parentElement.parentElement.id, norm($(id).textContent)]), [["resume", "Your details are still here."], ["resume", "Book and pay online when you're ready."]]);
  assert.equal(norm(frame.querySelector(".eyebrow").textContent), "Reservations");
  assert.deepEqual([...doc.querySelectorAll("h1")].map((h) => [h.id, norm(h.textContent)]), [["book-h", "Book a car"]]);
  assert.equal(norm(frame.querySelector(".lede").textContent), "One form for an airport transfer or an hourly booking.");
  assert.equal($("bk-steps"), null);
  assert.deepEqual([...doc.querySelectorAll(".bk-stepno")].map((s) => [s.parentElement.id, s.tagName, s.textContent]), [["bk-opt-h", "SPAN", "Step 2 of 4"], ["bk-det-h", "SPAN", "Step 3 of 4"]]);
  const steps = $("book-h");
  const icon = (id) => $(id).firstElementChild.matches('svg.icon[aria-hidden="true"]') && $(id).firstElementChild.querySelector("use").getAttribute("href");
  assert.deepEqual(["resume", "restored", "retnote"].map((id) => [id, $(id).matches('div.notice.bk-note[role="status"]'), icon(id), norm($(id).querySelector("span").textContent)]), [
    ["resume", true, "#i-shield", "Payment not completed. Nothing was charged. Your details are still here. Book and pay online when you're ready."],
    ["restored", true, "#i-check", "We filled in your trip from earlier in this tab."],
    ["retnote", true, "#i-calendar", "Return trip: pickup and drop-off are swapped. Check the date and choose a time."]]);
  assert.equal($("resume").getAttribute("tabindex"), "-1");
  assert.ok($("resume-go").matches("button.btn.btn--sm.btn--ghost.js-only[type=button]") && norm($("resume-go").textContent) === "Book and pay online");
  assert.ok($("restored-clear").matches("button.lnk-btn[type=button]") && norm($("restored-clear").textContent) === "Clear" && $("restored").contains($("restored-clear")));
  assert.equal(norm($("resume").querySelector("b").textContent), "Payment not completed. Nothing was charged.");
  assert.ok($("from-search").matches("p.bk-note") && norm($("from-search").textContent) === "JavaScript is off in your browser, and your trip didn't carry over. Please enter it again below.");
  for (const id of ["resume", "restored", "retnote", "from-search"]) assert.ok(steps.compareDocumentPosition($(id)) & 4 && $(id).compareDocumentPosition($("book-form")) & 4 && !$("book-form").contains($(id)), id);
  const page = main.children[1].querySelector(":scope > .frame");
  assert.deepEqual([...page.children].map((e) => e.id || e.tagName.toLowerCase()), ["book-form", "bk-cc", "section"]);
  assert.equal(page.children[1].tagName, "TEMPLATE");
  assert.ok(page.lastElementChild.matches("section.trust"), "the trust section is not last");
  assert.equal(main.querySelector('a[href="/rates"]'), null);
  assert.doesNotMatch(norm(main.textContent), /See all rates/);
});

check("book.html holds every #e- message and every #q- block a 303 can land on", () => {
  const ids = [...Object.keys(ERRORS).map((c) => `e-${c}`), ...Object.keys(REASONS).map((r) => `q-${r}`), ...Object.keys(REASONS).filter((r) => REASONS[r].short).map((r) => `q-${r}-short`), "q-error"];
  assert.ok(ids.includes("q-no-airport-short"));
  assert.deepEqual(ids.filter((id) => !$(id)), []);
});

check("booking-confirmed.html carries every id of the contract", () => assert.deepEqual(CONFIRMED_IDS.filter((id) => !$(id, confirmed.document)), []));

const cf = confirmed.document;
check("booking-confirmed.html is noindex with no canonical", () => {
  assert.equal(cf.title, "Payment received | NYC LUX RIDE");
  assert.equal(cf.querySelector('meta[name="robots"]').content, "noindex");
  assert.equal(cf.querySelector('link[rel="canonical"]'), null);
});

check("booking-confirmed.html static copy works without javascript: seal, H1, the fallback reference line, next steps, P1, help line, home link, every scripted part hidden", () => {
  const h = $("cf-h", cf);
  assert.deepEqual([norm(h.textContent), h.dataset.missing, h.dataset.none], ["Payment received", "We couldn't find this payment", "We can't show a booking in this tab"]);
  const col = cf.querySelector("main > section.section.bk-conf#cf > .frame.bk-conf__col");
  assert.ok(col, "the one centered column");
  assert.deepEqual([...col.children].map((e) => e.id || e.className), ["bk-seal", "cf-h", "cf-test", "cf-refrow", "cf-noref", "cf-missing", "cf-none", "cf-trip", "cf-other", "cf-other-nojs", "cf-next", "cf-policy", "cf-acts", "cf-quiet", "cf-receipt", "cf-help", "", "cf-status"]);
  assert.deepEqual([...$("cf-receipt", cf).children].map((e) => e.id || e.tagName.toLowerCase()), ["cf-receipt-h", "cf-fail", "table", "cf-notes", "cf-summary"]);
  assert.deepEqual(["cf-gcal", "cf-share"].map((id) => $(id, cf).getAttribute("aria-disabled")), ["true", "true"]);
  assert.equal(col.querySelector(".bk-seal").outerHTML, '<p class="bk-seal" aria-hidden="true"><svg viewBox="0 0 56 56" width="56" height="56"><circle cx="28" cy="28" r="28"></circle><path d="M17 29l7.5 7.5L39 21" pathLength="1"></path></svg></p>');
  assert.ok($("cf-test", cf).matches('div.notice[role="status"][hidden]') && norm($("cf-test", cf).textContent) === "Test booking. No real payment was taken.");
  const chip = $("cf-refrow", cf);
  assert.ok(chip.matches("p.bk-ref[hidden]") && norm(chip.firstElementChild.textContent) === "Reference" && $("cf-ref", cf).matches("b") && $("cf-ref", cf).querySelector(".bk-sk"));
  assert.deepEqual(["type", "aria-label", "aria-disabled", "class"].map((a) => $("cf-copy", cf).getAttribute(a)).concat(norm($("cf-copy", cf).textContent)), ["button", "Copy the reference", "true", "lnk-btn", "Copy"]);
  assert.ok(!$("cf-noref", cf).hidden && norm($("cf-noref", cf).textContent) === "Your reference is on your Stripe receipt.");
  assert.ok($("cf-fail", cf).matches("div.notice[hidden]") && norm($("cf-fail", cf).querySelector("span").textContent) === "We couldn't load your booking details. Your reference is on your Stripe receipt." && $("cf-retry", cf).matches("button.btn.btn--sm.btn--ghost") && norm($("cf-retry", cf).textContent) === "Try again");
  assert.ok($("cf-missing", cf).hidden && norm($("cf-missing", cf).textContent) === "We'll check your booking when you call or message us.");
  assert.ok($("cf-none", cf).hidden && norm($("cf-none", cf).querySelector("p").textContent) === "This page shows your booking right after payment, in the tab you paid in. Your reference is on your Stripe receipt." && $("cf-none", cf).querySelector('a.btn[href="/book"]') && norm($("cf-none", cf).querySelector("a.btn").textContent) === "Book a car");
  assert.ok($("cf-other", cf).matches("div.bk-mrow__x[hidden]") && !$("cf-other", cf).textContent, "the someone-else line waits for the script");
  assert.ok($("cf-other-nojs", cf).matches("p.bk-mrow__x.bk-nojs:not([hidden])") && norm($("cf-other-nojs", cf).textContent) === norm($("bk-other-h").querySelector(".bk-nojs").textContent + $("bk-other-h").querySelector(".bk-cc-h").previousSibling.textContent), "without javascript the page repeats the step 3 sentence for someone else riding");
  assert.ok($("cf-trip", cf).matches("section.bk-trip[hidden]") && $("cf-route", cf).matches("ol.bk-trip__route.bk-route") && $("cf-rows", cf).matches("dl.bk-trip__rows") && !$("cf-route", cf).children.length && !$("cf-rows", cf).children.length);
  assert.ok($("cf-next", cf).matches('ol.next[role="list"]'));
  assert.deepEqual([...$("cf-next", cf).children].map((li) => [li.id, li.hidden, norm(li.querySelector("b").textContent), norm(li.querySelector("span").textContent)]), [["", false, "Paid", "Stripe emails your receipt with your reference."], ["", false, "Confirmed in writing", "We confirm your car and chauffeur in writing before your ride."], ["cf-day", true, "On the day", ""]]);
  assert.ok($("cf-policy", cf).matches("p.bk-policy") && norm($("cf-policy", cf).textContent) === `${POLICY.cancelShort} ${POLICY.howTo} See the ${POLICY.link.toLowerCase()}.`);
  assert.equal($("cf-policy", cf).querySelector("a").getAttribute("href"), "/rates#policies");
  assert.equal($("cf-policy", cf).dataset.cal, `${POLICY.cancelShort} ${POLICY.howTo} ${POLICY.link}: ${SITE_ORIGIN}/rates#policies`, "the calendar event carries the free cancellation line, how to cancel and the full address of the terms");
  assert.ok($("cf-acts", cf).matches("p.btn-row[hidden]") && $("cf-ics", cf).matches('button.btn[type=button][aria-disabled="true"]') && norm($("cf-ics", cf).textContent) === "Add to calendar");
  assert.ok($("cf-return", cf).matches('a.btn.btn--ghost[href="/book#trip"][hidden]') && norm($("cf-return", cf).textContent) === "Book the return trip");
  assert.ok($("cf-quiet", cf).matches("p.bk-quiet[hidden]"));
  assert.deepEqual([...$("cf-quiet", cf).children].map((e) => [e.id, e.tagName, norm(e.textContent)]), [["cf-gcal", "A", "Add to Google Calendar (opens in a new tab)"], ["cf-share", "BUTTON", "Share trip details"], ["cf-wa", "A", "Message on WhatsApp (opens in a new tab)"], ["cf-print", "BUTTON", "Print or save as PDF"]]);
  assert.ok($("cf-gcal", cf).getAttribute("href").startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE") && $("cf-gcal", cf).target === "_blank" && $("cf-wa", cf).getAttribute("href") === "https://wa.me/16467750556");
  const r = $("cf-receipt", cf);
  assert.ok(r.hidden && r.matches("section.bk-price") && r.getAttribute("aria-labelledby") === "cf-receipt-h");
  assert.equal(norm($("cf-receipt-h", cf).textContent), "Your payment");
  assert.equal(norm($("cf-total", cf).closest("tr").querySelector("th").textContent), "Paid");
  assert.equal($("cf-receipt", cf).lastElementChild, $("cf-summary", cf));
  assert.ok($("cf-notes", cf).matches("ul.bk-later"));
  assert.deepEqual([$("cf-notes", cf).dataset.airport, $("cf-notes", cf).dataset.hourly, $("cf-notes", cf).dataset.outside, $("cf-notes", cf).textContent], [NOTES.included + "|" + POLICY.later.airport, POLICY.later.hourly, POLICY.later.outside, ""]);
  assert.equal(norm($("cf-help", cf).textContent), "Call +1 (646) 775-0556 or message us on WhatsApp. We answer calls and messages 24 hours a day, every day.");
  assert.deepEqual([...$("cf-help", cf).querySelectorAll("a")].map((a) => a.getAttribute("href")), ["tel:+16467750556", "https://wa.me/16467750556"]);
  assert.deepEqual([...$("cf-help", cf).querySelectorAll("span.nowrap")].map((n) => n.textContent), ["24 hours"], "24 hours stays whole, as on every other page");
  assert.ok($("cf-home", cf).matches('a.lnk[href="/"]') && norm($("cf-home", cf).textContent) === "Back to the homepage" && $("cf-home", cf).querySelector('svg.icon > use[href="#i-arrow"]'));
  assert.ok($("cf-status", cf).matches('p.sr-only[role="status"]'));
  assert.doesNotMatch(norm(cf.querySelector("main").textContent), /See all rates|Dispatch confirms your vehicle/);
  assert.equal(cf.querySelector('main a[href="/rates"]'), null);
  assert.equal(cf.getElementById("book-form"), null);
  const done = [...cf.head.querySelectorAll("script[src]")].find((x) => x.getAttribute("src").startsWith("/assets/done."));
  assert.ok(done && done.defer && done.getAttribute("blocking") === "render");
});

check("booking-confirmed.html: the cancellation sentence says email or WhatsApp and names no phone number", () => {
  const t = $("cf-policy", cf).textContent.replace(/\s+/g, " ");
  assert.ok(t.includes("To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference."), t);
  assert.doesNotMatch(t, /\+1 \(646\)/);
});
check("booking-confirmed.html main uses only booking classes that lux.css or book.css styles, and no vehicle card class", () => {
  const used = [...new Set([...cf.querySelectorAll("main [class]")].flatMap((el) => [...el.classList]))].filter((c) => c.startsWith("bk-"));
  assert.deepEqual(used.filter((c) => !new RegExp(`\\.${c.replace(/[-_]/g, "\\$&")}(?![\\w-])`).test(SHEETS)), []);
  assert.equal(cf.querySelector("main .bk-card, main .bk-cols"), null);
  assert.ok(cf.querySelector("main .bk-conf #cf-receipt"));
});

for (const [name, { document }] of [["book.html", book], ["booking-confirmed.html", confirmed]]) {
  check(`${name}: no dollar figure, percent or USD in text or attributes${name === "book.html" ? ", apart from the cancellation charges of POLICY.cancel once beside the pay button" : ""}`, () => {
    const body = document.body.cloneNode(true);
    for (const n of body.querySelectorAll("script, style")) n.remove();
    const attrs = [...document.querySelectorAll("*")].map((el) => [...el.attributes].map((a) => a.value)).flat();
    const text = body.textContent.replace(/\s+/g, " ");
    assert.equal(text.split(POLICY.cancel).length, name === "book.html" ? 2 : 1);
    const all = [document.title, text.split(POLICY.cancel).join(" "), ...attrs].join(" ");
    assert.equal(all.match(/\$\s*\d|\d\s*%|\bUSD\b/), null);
  });

  const own = name === "book.html" ? "pay" : "done";
  check(`${name}: ${own} loads after lux and before gtag and tracking, all deferred`, () => {
    const scripts = [...document.head.querySelectorAll("script[src]")];
    assert.deepEqual(scripts.map((s) => s.getAttribute("src").replace(/\.[A-Za-z0-9_-]{6,}\.js$/, ".js")), ["/assets/lux.js", `/assets/${own}.js`, "/assets/gtag.js", "/assets/tracking.js"]);
    assert.ok(scripts.every((s) => s.defer), "a script is not deferred");
  });

  check(`${name}: every phone and WhatsApp link is exact`, () => {
    const bad = [...document.querySelectorAll('a[href^="tel:"], a[href*="wa.me"]')]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h !== "tel:+16467750556" && !h.startsWith("https://wa.me/16467750556"));
    assert.deepEqual(bad, []);
  });
}

check("the pay script loads in the head of the six FULL hosts, lux.js brings it to the 55 SEARCH hosts, the confirmation page loads the done script, and nowhere else checked here", () => {
  assert.equal(HOSTS.length, 61);
  for (const f of HOSTS.slice(0, FULL_HOSTS)) assert.ok(readFileSync(join(ROOT, f), "utf8").includes(`/assets/${payName}`), f);
  for (const f of [...HOSTS.slice(FULL_HOSTS), "booking-confirmed.html"]) assert.ok(!readFileSync(join(ROOT, f), "utf8").includes("/assets/pay."), f);
  assert.ok(doneName && readFileSync(join(ROOT, "booking-confirmed.html"), "utf8").includes(`/assets/${doneName}`));
  assert.ok(LUX.includes(`"/assets/${payName}"`), "lux.js does not load the current pay script");
  const others = ["rates.html", "404.html", "faq.html", "locations.html"].filter((f) => /\/assets\/(pay|done)\./.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(others, []);
});

check("pay.js loads the current second booking script, and no page links it", () => {
  assert.ok(pay2Name && PAY.includes(`"/assets/${pay2Name}"`), "pay.js does not load the current second booking script");
  assert.deepEqual([...HOSTS, "booking-confirmed.html"].filter((f) => readFileSync(join(ROOT, f), "utf8").includes("/assets/pay2.")), []);
});

check("lux.js, done.js, gtag.js and tracking.js keep their own function scope, so the top-level names of pay.js and pay2.js meet no other script", () => {
  const own = [["lux", LUX], ["done", DONE], ...["gtag.js", "tracking.js"].map((n) => [n, readFileSync(join(ROOT, "assets", n), "utf8")])];
  assert.deepEqual(own.filter(([, s]) => !/^\((\(\)=>\{|function \(\) \{)/.test(s.trim()) || !/\}\)\(\);$/.test(s.trim())).map(([n]) => n), []);
});

check("the pay script follows only a Checkout origin of the config or the mock confirmation", () => {
  const m = SRC.match(/\/(\^\(https:\\\/\\\/checkout[^)]*\))\/\.test/);
  assert.ok(m, "no payment URL rule found");
  const rule = new RegExp(m[1]);
  for (const o of CHECKOUT_ORIGINS) assert.ok(rule.test(`${o}/c/pay/cs_test_a1`), `${o} is refused`);
  assert.ok(rule.test("/booking-confirmed?session_id=cs_mock_7K3Q2P"));
  for (const bad of ["https://checkout.stripe.com.example.com/c/pay", "https://example.com/c/pay", "//checkout.stripe.com/c/pay", "/booking-confirmed?session_id=cs_live_a1", "javascript:alert(1)"]) {
    assert.equal(rule.test(bad), false, `${bad} is followed`);
  }
});

check("the done script labels a test or mock session and never a live one, and pay.js no longer holds the confirmation", () => {
  const m = DONE.match(/hd\("test",!\/([^/]+)\/\.test\(id\)\)/);
  assert.ok(m, "no test label rule found");
  const rule = new RegExp(m[1]);
  for (const id of ["cs_test_a1b2c3d4e5f6", "cs_mock_7K3Q2P"]) assert.ok(rule.test(id), `${id} is not labelled`);
  for (const id of ["cs_live_a1b2c3d4e5f6", "xcs_test_a1", ""]) assert.equal(rule.test(id), false, `${id} is labelled`);
  assert.doesNotMatch(SRC, /cf-h|cf-receipt|cf-test/);
});

check("the done script repeats the rider's notes on the trip card as Your notes, escaped, from the booking saved in this tab, and the session lookup never returns them", () => {
  assert.ok(DONE.includes('+rw("Your notes",ES([f.notes]));'), "the trip card does not repeat the notes");
  assert.doesNotMatch(DONE, /rider_notes|s\.notes_text/);
  assert.doesNotMatch(readFileSync(join(ROOT, "api/book.mjs"), "utf8"), /rider_notes|metadata\.notes/);
});

check("the pay and done scripts carry no comment, hold no price figure, and pay.js uses the config advance limit and notice window", () => {
  for (const s of [SRC, DONE.replace('"PRODID:-//NYC LUX RIDE//Booking//EN"', '""')]) assert.doesNotMatch(s, /\/\*|(^|[^:"'\\])\/\/(?![\\/]|wa\.me)/m);
  assert.equal(DONE.match(/\$\d|8\.875|2\.25/g), null);
  const figures = [...new Set([...Object.values(AIRPORT_FARES), ...Object.values(AIRPORT_TOTALS)].flatMap((o) => Object.values(o)).concat(MEET_AND_GREET, STOP_FEE_CENTS, ...Object.values(VEHICLES).map((v) => v.hourly).filter(Boolean)))];
  assert.deepEqual(figures.filter((c) => new RegExp(`(^|[^\\d.])${c}(?![\\d])`).test(SRC)), []);
  assert.equal(SRC.match(/\$\d|8\.875|2\.25/g), null);
  assert.match(SRC, new RegExp(`${MAX_ADVANCE_DAYS}\\*864e5`));
  const notice = SRC.match(/NW=\(\)=>ny\(Date\.now\(\)\+([\de.]+)\+59999\)/);
  assert.equal(notice && Number(notice[1]), MIN_NOTICE_MINUTES * 6e4, "the browser notice window is MIN_NOTICE_MINUTES");
  assert.doesNotMatch(SRC, /next 24 hours|24 hours (ahead|away)/);
  assert.doesNotMatch(SRC, /moovs/i);
});

check("the pickup that fills in by itself (owner request 2) is the first slot MIN_NOTICE_MINUTES plus AUTO_LEAD_MINUTES ahead, it moves once it is less than MIN_NOTICE_MINUTES plus AUTO_GUARD_MINUTES away, and the scripts hold no NLR- reference (owner request 5)", () => {
  const slot = SRC.match(/AQ=\(m=([\de.]+)\)=>\{for\(let t=Math\.ceil\(\(Date\.now\(\)\+AO\+m\+([\de.]+)\)\/6e5\)\*6e5/);
  assert.ok(slot, "no auto slot");
  assert.deepEqual([Number(slot[1]), Number(slot[2])], [MIN_NOTICE_MINUTES * 6e4, AUTO_LEAD_MINUTES * 6e4]);
  const guard = SRC.match(/ED\.value\+" "\+ET\.value<ny\(Date\.now\(\)\+AO\+([\de.]+)\+([\de.]+)\)/);
  assert.ok(guard, "no guard");
  assert.deepEqual([Number(guard[1]), Number(guard[2])], [MIN_NOTICE_MINUTES * 6e4, AUTO_GUARD_MINUTES * 6e4]);
  assert.match(SRC, /NW=\(\)=>ny\(Date\.now\(\)\+54e5\+59999\)/);
  assert.doesNotMatch(SRC, /NLR-/);
});

check("the price box and the confirmation receipt (owner change 2) hold the Taxes and fees and Tolls labels in their skeletons, the same in every class hint on Tolls, and no sales tax, Black Car Fund, airport fees or workers' compensation line, and the notice copy says 90 minutes", () => {
  assert.match(PAY, /\(PLN\|\|\["Fare","Taxes and fees"\]\.concat\(tl\(\)\?\["Tolls"\]:\[\]\)\)/);
  assert.match(PAY, /nl\(\$\("price-notes"\)\.dataset\[ap\(\)\|\|sq\(\)&&tl\(\)\?"airport":tl\(\)\?"returnFlat":AP\(\)\?"waiting":one\(\)\?"distance":"hourly"\]/, "a trip whose stops take the stop fee has the notes of the same trip without the stops, a trip with an airport on its route priced over the whole route has the notes of an airport trip priced by distance, and while a trip priced by distance loads its note never says tolls come after the ride");
  assert.match(PAY, /ap=\(\)=>AP\(\)&&!ns&&!EN\.some\(k=>zv\(C\[k\]\)=="outside"\),sq=\(\)=>one\(\)&&ns&&\(za\("from"\)!=za\("to"\)\|\|!AP\(\)\),tl=\(\)=>ap\(\)\|\|one\(\)&&ns&&za\("to"\)!=za\("from"\)&&zv\(C\.to\)!="outside"&&zv\(C\.from\)!="outside"/, "before the first answer only a trip with no stop is an airport transfer at the flat rate, a trip with stops expects the stop fee when the trip without the stops is an airport transfer or runs between two addresses, with the tolls line when it is an airport transfer, and a trip between two airports or between two addresses by an airport stop expects its whole route");
  assert.doesNotMatch(PAY, /ou=\(\)=>|aw=a=>/, "no trip with stops keeps its airport transfers on every part");
  assert.match(PAY, /"stop-address":aq\("stop "\)/);
  assert.match(PAY, /x\[0\]=="Tolls"&&one\(\)&&!TF\?h\(" bk-hint--same","The same in every class\."\):""/);
  assert.match(PAY, /PNT=r\.price\.notes;TF=r\.price\.tolls_differ;/);
  assert.match(DONE, /"Taxes and fees",\.\.\.!f\|\|y\?\["Tolls"\]:\[\]/);
  assert.match(DONE, /y=o&&\(b\.ln\|\|\["Tolls"\]\)\.some\(l=>\/\^Tolls\/\.test\(l\)\)/, "a saved Taxes and fees line never counts as a tolls line");
  for (const s of [SRC, DONE]) assert.doesNotMatch(s, /sales tax|Black Car Fund|airport fees|workers' compensation|next hour|an hour away/i);
  assert.ok(PAY.includes('"short-notice":["Less than 90 minutes away","Change the time"]'));
  assert.equal(SPRINTER_NOTICE_HOURS * 36e5, 108e5);
  assert.equal(SPRINTER_BUSY_HOURS * 36e5, 864e5);
  assert.ok(PAY.includes('S9=y=>y=="sprinter"&&ED.value+" "+ET.value<(SF||ny(Date.now()+AO+108e5+59999))'), "the cards use the server's first Sprinter minute, or SPRINTER_NOTICE_HOURS from the corrected clock before the first answer");
  assert.ok(PAY.includes(`'<span class="bk-fig">Book ${SPRINTER_NOTICE_HOURS} hours ahead</span>'`));
  assert.ok(PAY.includes(`"sprinter-notice":["Book a Sprinter ${SPRINTER_NOTICE_HOURS} hours ahead","Change the date"]`));
  assert.ok(PAY.includes('(e=>e&&(SF=e.date+" "+e.time))(r.sprinter_from)') && PAY.includes('if(r.code=="sprinter-notice")return SU(""),op("options")'));
  assert.ok(PAY.includes('"For a pickup within the next 90 minutes, email or WhatsApp us."'));
  assert.ok(SRC.includes('<p class="bk-cal__note">For a pickup within the next 90 minutes, email or WhatsApp us.</p>'));
});

check("the child seat limits: each class card carries the limits of CHILD_SEAT_LIMITS, pay.js turns a card off with a short reason for too many child seats, no adult or too many seats with one adult, the selected card shows the request block, the fix picks the first car that fits, and a seat change marks the cards at once", () => {
  assert.ok(PAY.includes('KR=l=>{let d=l.dataset,s=SN(),a=+PA.value-s;return d.kids==null?"":s>d.kids?"child-seats":a<d.adults?"adult":a==1&&s>d.kids1?"one-adult":""}'));
  assert.ok(PAY.includes('Kx=(k,l)=>k=="adult"?"Needs an adult":"Fits "+(k=="one-adult"?l.dataset.kids1+" with 1 adult":l.dataset.kids+" child seat"+(l.dataset.kids>1?"s":""))'));
  assert.ok(PAY.includes('fc=n=>[...F.querySelectorAll("[name=class]")].find(i=>+i.parentNode.dataset.seats>=n&&!S9(i.value)&&!KR(i.parentNode))'));
  assert.ok(PAY.includes('y?{total_cents:null,reason:y}:c.reason?{}:c}'));
  assert.ok(PAY.includes('qh=(c,l)=>/^(seats|child-seats|adult|one-adult)$/.test(c.reason)?null:'));
  assert.ok(PAY.includes('"child-seats":["Too many child seats for this car","Show cars that fit"],adult:["This car needs an adult","Show cars that fit"],"one-adult":["Too many child seats for 1 adult","Show cars that fit"]'));
  assert.ok(PAY.includes('else if(/^(seats|child-seats|adult|one-adult)$/.test(r)){let x=fc(+PA.value);x&&(x.checked=!0,dc(x))}'));
  assert.ok(PAY.includes('k?\'<span class="bk-fig">\'+Kx(k,l)+"</span>"'));
});

check("the two SUVs line: under SPRINTER_BUSY_HOURS the cards line shows while a Sprinter can be booked and the price box line shows for a chosen Sprinter, both on the server corrected clock", () => {
  assert.ok(PAY.includes('Sb=()=>ED.value&&ET.value&&!S9("sprinter")&&ny(Date.now()+AO+864e5+59999)>ED.value+" "+ET.value'));
  assert.ok(PAY.includes('pz=()=>{let n=+PA.value,w=N("busy")&&Sb();') && PAY.includes('N("busy")&&(N("busy").hidden=!w)'));
  assert.ok(PAY.includes('i.dataset.v&&tk(i,"bk-busy",w);'), "each Sprinter card points to the cards line only while it shows");
  assert.ok(PAY.includes('q.dataset.r=r;$("price-busy")&&($("price-busy").hidden=!(E.class.value=="sprinter"&&Sb()));'), "the price box line follows every answer and every change of car");
});

check("a Sprinter link with no pickup fills in the first slot 3 hours plus AUTO_LEAD_MINUTES ahead with no auto move, Change the date leaves only the times a Sprinter can be booked on the first Sprinter day, a group no car can seat gets the Sprinter notice, and the bar keeps Email to reserve like every other request", () => {
  const H = SPRINTER_NOTICE_HOURS * 36e5;
  assert.ok(PAY.includes(`a1=f=>(f||RS<3)&&!ED.value&&!ET.value&&((QC||E.class?.value)=="sprinter"?(AD=AT=0,am(AQ(${H / 1e5}e5))):(AD=AT=1,am(AQ())))`));
  assert.ok(PAY.includes('", the earliest time to book "+(AT?"online.":"a Sprinter.")'));
  assert.ok(PAY.includes('a==ED&&SF&&ab()=="search"&&E.class.value=="sprinter"&&v+" "+o.value<SF'));
  assert.ok(PAY.includes('let u=()=>{sw("search");T("wait","");ds()}'));
  assert.ok(PAY.includes('f=="sf"?SF.slice(11)<="23:50"?SF.slice(0,10):nd(SF.slice(0,10))'), "after 11:50 PM the calendar opens on the next day, the first day with a time a Sprinter can take");
  assert.ok(PAY.includes(`S9(E.class?.value)?"Book a Sprinter at least ${SPRINTER_NOTICE_HOURS} hours ahead.":`));
  assert.ok(PAY.includes('S8=()=>!fc(+PA.value)&&S9("sprinter")') && PAY.includes('reason:S8()?"sprinter-notice":"seats"') && PAY.includes('CL[c.class]=c.reason=="seats"&&S8()?{...c,reason:"sprinter-notice"}:c') && PAY.includes('r.reason=="seats"&&S8()&&(r.reason="sprinter-notice")'));
  assert.ok(!SRC.includes("bar-fix") && !SHEETS.includes("bar-fix"));
  assert.ok(!SHEETS.includes("#q-sprinter-notice.is-on) #bk-bar-mail"), "the bar under the Sprinter notice shows Email to reserve");
});

check("pay.js, done.js and lux.js store only the booking state in sessionStorage and never use localStorage or cookies", () => {
  for (const s of [SRC, DONE, LUX]) assert.doesNotMatch(s, /localStorage|document\.cookie/);
  assert.deepEqual([...new Set([SRC, DONE, LUX].join("\n").match(/"nlr-[a-z-]+"/g))].sort(), ['"nlr-book"', '"nlr-cf"', '"nlr-purchase-"']);
});

check("restored and autofilled fields keep the filled look (owner request 3): no wash box anywhere, the restore cue is a colour-only tint under 1 s with motion only, and the autofill rule only holds the browser's autofill colours back", () => {
  assert.doesNotMatch(SHEETS, /is-washed/);
  assert.doesNotMatch(SRC, /is-washed/);
  const af = SHEETS.match(/[^{}]*:autofill[^{}]*\{([^}]*)\}/g) || [];
  assert.deepEqual(af.map((r) => r.slice(r.indexOf("{"))), ["{transition:background-color 0s 99999s,color 0s 99999s}"]);
  assert.match(SHEETS, /@media \(prefers-reduced-motion:no-preference\)\{\.bk \.is-tint :is\(input,\.bk-pick\)\{animation:bk-tint \.9s [^}]*\}\}/);
  assert.match(SHEETS, /@keyframes bk-tint\{from\{color:var\(--bg\)\}\}/);
  assert.match(PAY, /ws=e=>\{e\.classList\.remove\("is-tint"\);e\.offsetWidth;e\.classList\.add\("is-tint"\);setTimeout\(\(\)=>e\.classList\.remove\("is-tint"\),1e3\)\}/);
});

check("the time picker (owner request 1) lives in the booking layer with the date picker's popover look and the panels' 0.15 s open and close that reduced motion drops, and the pay scripts keep the native select as the source of truth", () => {
  assert.match(SHEETS, /\.bk\.is-js:not\(\.bk-p2off\) :is\(\.bk-date>input,\.bk-time>select\),\.bk:is\(:not\(\.is-js\),\.bk-p2off\) \.bk-pick\{display:none\}/);
  assert.match(SHEETS, /\.bk-tm\{left:auto;width:max\(100%,17\.5rem\);gap:0;padding:8px;border-radius:16px\}/);
  assert.match(SHEETS, /@media \(prefers-reduced-motion:no-preference\)\{\.bk-pop,\.bk-cal\{transition:opacity var\(--dur-fast\) var\(--ease-quick\),translate var\(--dur-fast\) var\(--ease-quick\),display var\(--dur-exit\) allow-discrete\}/);
  assert.doesNotMatch(SHEETS, /\.bk-tm[^{]*\{transition-duration/);
  assert.match(SRC, /TI\.value=o\.dataset\.v,xt\(1\),TI\.dispatchEvent\(new Event\("change",\{bubbles:!0\}\)\)/, "a pick writes the select and fires its change event");
  assert.match(SRC, /AXF=\(f,a\)=>\{if\(AX\|\|IL\|\|PS\|\|RM\(\)\|\|F\.dataset\.step=="search"\)return f\(\.\.\.a\)/, "the card motion (owner request 2) never runs with reduced motion, on the first load, during a step switch or on step 1");
});

check("a short-notice payment tells the rider on the confirmation page that the car is confirmed shortly", () => {
  const s = $("cf-confirm", confirmed.document);
  assert.ok(s && s.matches("#cf-next > li > span"), "no #cf-confirm in the next steps");
  assert.equal(s.textContent, "We confirm your car and chauffeur in writing before your ride.");
  assert.equal(s.dataset.soon, "Your pickup is soon, so we'll confirm your car and chauffeur in writing shortly.");
  assert.match(DONE, /C=i=>\$\("cf-"\+i\),T=\(i,v\)=>C\(i\)\.textContent=v,/);
  assert.match(DONE, /s\.short_notice&&T\("confirm",C\("confirm"\)\.dataset\.soon\)/);
});

check("child seats: pay.js reprices on a change of any seat count, keys the price on the three counts, shows the price per seat from the answer, keeps a pending seat line in place, writes one line per seat type into the messages, keeps the passenger count from dropping below the seats, gives each seat count the stepper of the passenger count with More off at one seat per passenger and the seat message when it is pressed there, clears that message in the same task as the next change, shows the counts inside the request on step 2 and before Check your trip on step 3, and holds no seat price, and done.js keeps the seat line of the booking in the receipt skeleton", () => {
  assert.match(PAY, /if\(\/\^\(class\|vehicle\|sprinter\|meet\|tip\|passengers\|\\w\+_\(seats\|dogs\)\)\$\/\.test\(n\)\)\{/);
  assert.match(PAY, /KF=\$\("bk-kids"\),KS=\(\)=>\[\.\.\.KF\.elements\]\.filter\(x=>x\.name\),SN=\(\)=>KS\(\)\.reduce\(\(a,x\)=>a\+ \+x\.value,0\),pq=\(\)=>\[E\.class\.value,E\.vehicle\.value,E\.sprinter\.value,E\.hours\.value,\$\("bk-meet"\)\.checked,te\(\),PA\.value,KS\(\)\.map\(x=>x\.value\),/);
  assert.match(PAY, /let E=F\.elements,PA=E\.passengers,/);
  assert.doesNotMatch(PAY, /E\.passengers\.value/);
  assert.match(PAY, /su=\(\)=>\{let v=PA\.value,n=SN\(\);SX\.children\[1\]\.textContent=v\+\(v>1\?" passengers":" passenger"\);SX\.firstChild\.ariaDisabled=v<2\|\|v<=n;SX\.lastChild\.ariaDisabled=v>=PA\.length;KX\.map\(\(x,i\)=>\{i=KS\(\)\[i\]\.value;x\.children\[1\]\.textContent!=i&&\(x\.children\[1\]\.textContent=i\);x\.firstChild\.ariaDisabled=i<1;x\.lastChild\.ariaDisabled=n>=v\}\);\[\.\.\.DX,\.\.\.BX\]\.map/, "a seat count is written only when it changes, so its live region speaks only then");
  assert.match(PAY, /b&&\(b\.ariaDisabled!="true"\?\(s\.value=\+s\.value\+\(u\|\|-1\),dc\(s\)\):u&&s!=PA&&\(u=s\.closest\("fieldset"\)\.name,iv\(\{code:u,field:u\}\)\)\)/, "More pressed at the limit shows the message named by the fieldset of the count, child_seats or dogs");
  assert.match(PAY, /SX=mS\(PA,"passengers"\);KX=KS\(\)\.map\(s=>mS\(s,s\.labels\[0\]\.firstChild\.data\.trim\(\)\.toLowerCase\(\)\+"s"\)\);/);
  assert.match(PAY, /x\.setAttribute\("aria-labelledby",\(s\.labels\[0\]\.id=s\.id\+"-l"\)\+\(s==PA\?" bk-pax-h":""\)\);s==PA\|\|x\.setAttribute\(D,s\.getAttribute\(D\)\);s\.before\(x\);/, "a seat count's stepper keeps the hint of its select as its description");
  assert.match(PAY, /WM2="";V\(\);BK&&sv\(\);uk\(\$\("e-dogs"\)\);uk\(\$\("e-child_seats"\)\);su\(\);\(n=="passengers"\|\|\/_seats\$\/\.test\(n\)\)&&\(n=="passengers"&&fs\(\),ps\(\),pz\(\),V\(\),su\(\)\);/, "a change of the passengers or of any seat count marks the cards again at once");
  assert.match(PAY, /GO\|\|\(n=>n\.previousElementSibling==DF\|\|n\.before\(KF,DF\)\)\(\$\(c\.details\?"bk-check":"bk-qnotes-f"\)\);/, "the child seats and the pets move together, the pets right after the seats");
  assert.match(PAY, /r\.seat_cents&&T\("bk-kids-p",\(KC=M\(r\.seat_cents\)\)\+" each"\)/);
  assert.match(PAY, /filter\(x=>!\/\^\(Meet\|Gratuity\|Child\|Extra\|Small\|Large\)\/\.test\(x\)\)/);
  assert.match(PAY, /r\.stop_cents&&\(KZ=M\(r\.stop_cents\)\);/);
  assert.match(PAY, /e=one\(\)&&ns&&\(PLN\?PLN\.some\(x=>x\[0\]=="E"\):sq\(\)\)/);
  assert.match(PAY, /N\("meet"\)\.checked&&r\.push\(\["Meet and greet",LV\["Meet and greet"\]\|\|"\.\.\."\]\);e&&r\.push\(\[e=ns>1\?"Extra stops"\+\(KZ\?" \("\+ns\+" x "\+KZ\+"\)":""\):"Extra stop",LV\[e\]\|\|"\.\.\."\]\);n&&r\.push/, "the pending Extra stop line sits after meet and greet and before the child seats, as the answer puts it");
  assert.match(PAY, /n&&r\.push\(\[n=KC\?"Child seats \("\+n\+" x "\+KC\+"\)":"Child seats",LV\[n\]\|\|"\.\.\."\]\)/);
  assert.match(PAY, /GO\|\|KS\(\)\.map\(x=>\+x\.value&&l\.push\(x\.labels\[0\]\.firstChild\.data\.trim\(\)\+"s: "\+x\.value\)\)/);
  assert.match(PAY, /if\(k=="invalid"\)return LD=CW=0,bz\(0\),iv\(r\);uk\(\$\("e-child_seats"\)\);/);
  assert.doesNotMatch(SRC, /15\.00|\$15|seat_cents[:=]\d/);
  assert.doesNotMatch(SRC, /20\.00|\$20|stop_cents[:=]\d/);
  assert.match(DONE, /\.\.\.f&&f\.meet=="1"\?\["Meet and greet"\]:\[\],\.\.\.\(f&&b\.ln\|\|\[\]\)\.filter\(l=>\/\^\[CELS\]\/\.test\(l\)\),/, "the receipt skeleton keeps the Extra stop, child seat, Small dog and Large dog lines of the price box after meet and greet, in the order of the answer");
  assert.doesNotMatch(DONE, /20\.00|\$20|2000/);
  assert.doesNotMatch(DONE, /15\.00|\$15|1500/);
});

check("if pay2.js fails to load, or has not run 4 s in, the form shows the native date input and time select at once, drops the queued picker work, still fetches the script once more, keeps the native controls when the script turns up after the form was used, and pays by a plain form post until the script runs", () => {
  assert.match(SRC, /p2f=\(\)=>P2\|\|\(P2=-1,PQ\.length=0,F\.classList\.add\("bk-p2off"\)/);
  assert.match(SRC, /onerror:\(\)=>\(p2f\(\),x\|\|setTimeout\(l2,2e3,1\)\)/);
  assert.match(SRC, /setTimeout\(p2f,4e3\)/);
  assert.match(SRC, /P2<0&&\(FF\|\|F\.contains\(d\.activeElement\)\)\|\|\(P2=1,F\.classList\.remove\("bk-p2off"\),bt\(\)/);
  assert.match(SRC, /p2=f=>P2>0\?f\(\):P2\|\|PQ\.push\(f\)/);
  assert.match(SRC, /F\.onsubmit=e=>\{let s=F\.dataset\.step;if\(s=="details"&&P2<1\)return;pD\(e\)/);
  assert.match(SRC, /pD=e=>e\.preventDefault\(\),/);
  assert.match(SRC, /BG\.onclick=\(\)=>F\.dataset\.step=="details"\?P2<1\?F\.requestSubmit\(B\)/);
  assert.doesNotMatch(SRC, /p2\([A-Za-z0-9_$]+\)/, "a bare pay2 name is read before pay2.js is there");
  assert.match(SHEETS, /\.bk\.is-js:not\(\.bk-p2off\) \.bk-time::after\{content:none\}/);
});

check("without javascript the payment notice makes no promise about kept details, and on every page with the booking form the form error is one text block, so it reads as one line next to its icon", () => {
  assert.ok($("resume-k").classList.contains("js-only"));
  for (const f of ["book.html", "index.html", "locations/jfk-airport.html", "locations/laguardia-airport.html", "locations/newark-airport.html"]) {
    const e = read(f).document.getElementById("e-form");
    assert.deepEqual([...e.childNodes].map((n) => n.nodeName), ["SPAN"], f);
    assert.equal(norm(e.textContent), ERRORS.form.text, f);
  }
});

if (failures) {
  console.error(`\n${failures} book page assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll book page tests passed");
process.exit(0);
