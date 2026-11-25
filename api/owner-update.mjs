import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

const MIN_SECRET = 32;
const SMTP_MS = 8000;
const SEND_ON = "2026-11-25";
const TO = "info@nycluxride.com";
const SUBJECT = "Website updates and a short to-do list";
const ID = "owner-update.20261125b";
const LINES = [
  "Assalamu Alaikum,",
  "",
  "These are now live on www.nycluxride.com:",
  "- Child seats and dogs are chosen on the first step, next to passengers and bags.",
  "- Car seats are $20 each.",
  "- Every car photo in the booking form is a studio shot on a white background.",
  "- Booking is now two steps, with a shorter payment box. The cancellation terms fold under \"Cancellation and terms\" next to the pay button.",
  "- A page for each of the 21 New Jersey counties with every town you sent, and Signature Newark on the Newark Airport and private jet pages.",
  "",
  "One thing to check: on your phone, book a test ride at www.nycluxride.com/book up to the pay button, without paying. Reply OK, or tell me what to change.",
  "",
  "Your to-do list. Only you can do these because they need your accounts.",
  "",
  "1. Google reviews (most important). Send your Google review link to every rider 2 to 4 hours after the ride. Reply to each review within two days and name the trip, for example \"Thank you for riding with us from Morristown to Newark.\" Never offer anything for a review.",
  "",
  "2. Google service areas. In Google Maps tap Business, then Edit profile, Location, Service area. Remove all, then add these 20: Manhattan, Brooklyn, Queens, Bronx, Staten Island, Nassau County NY, Suffolk County NY, Westchester County NY, Fairfield County CT, and in New Jersey the Bergen, Hudson, Essex, Union, Middlesex, Morris, Passaic, Somerset, Monmouth, Ocean and Mercer counties.",
  "",
  "3. Google categories. Primary: Limousine service. Additional: Chauffeur service. Nothing else.",
  "",
  "4. Google services. Under Edit services add Private jet and FBO transportation, New Jersey car service, Long-distance car service and Roadshow transportation. Set your car seat service to $20 per seat.",
  "",
  "5. Free listings. Claim your business on Data Axle (local-listings.data-axle.com), Foursquare (business.foursquare.com), Bing Places (bingplaces.com) and Yelp (biz.yelp.com). Use exactly: NYC LUX RIDE, (646) 775-0556, https://www.nycluxride.com/, open 24 hours.",
  "",
  "6. Private jet terminals. Ask each front desk to add you to their car service list and to link nycluxride.com/private-jet-car-service-nyc: Signature Newark (973 624 1660), Signature Morristown (973 292 1300), Atlantic Morristown (973 401 1900), and the Teterboro terminals (Atlantic, Jet Aviation and Signature).",
  "",
  "7. Old website. Ask Muhammad Bassam Khuram for access to nyc-lux-ride.com so it can send its visitors to nycluxride.com.",
  "",
  "JazakAllah Khair,",
  "Ali",
];
const NEW_YORK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HTML = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${LINES.map((l) => (l ? `<p style="margin:0 0 10px">${esc(l)}</p>` : "")).join("")}</body></html>`;

const failed = (...why) => {
  console.error("owner-update-fail", ...why);
  return json(500, { kind: "error" });
};

export async function GET(request) {
  if (!cronAllowed(request, MIN_SECRET)) return json(401, { kind: "unauthorized" });
  try {
    if (NEW_YORK_DAY.format(new Date()) !== SEND_ON) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const mail = mailSettings();
    if (mail.off || mail.bad) return failed("mail-settings");
    const data = buildMessage({ from: mail.from, to: [{ name: "", address: TO }], subject: SUBJECT, text: LINES.join("\n"), html: HTML, id: ID });
    const [result] = await smtpSend(mail, [{ from: mail.from.address, to: [TO], data }], SMTP_MS);
    if (!result.ok) return failed("smtp", result.stage, result.code);
    console.log("owner-update-sent");
    return json(200, { kind: "sent" });
  } catch {
    return failed("handler");
  }
}
