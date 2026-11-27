import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

const MIN_SECRET = 32;
const SMTP_MS = 8000;
const SEND_ON = "2026-11-27";
const TO = "info@nycluxride.com";
const SUBJECT = "New prices are live, a few quick questions";
const ID = "owner-update.20261127";
const LINES = [
  "Assalamu Alaikum,",
  "",
  "These are now live on www.nycluxride.com:",
  "- The website no longer shows per-mile, per-minute or base fare numbers. The rates page shows airport flat prices, fixed-price routes and hourly rates.",
  "- Trips of 75 miles or more and all Sprinter bookings are now Request a quote. Sprinters at the airports show their flat price, and riders request them so you can check a Sprinter is free.",
  "- JFK, LaGuardia, Queens or Brooklyn to Jersey City, Hoboken, North Bergen or Union City: the Business SUV is never more than $211.43.",
  "- Newark to NYC in the Business SUV is $195. Other cars are $10 more at Newark.",
  "- Electric Class is $250 at JFK, Newark and Teterboro, $215 at LaGuardia and $125 an hour.",
  "- First Class keeps $170 as its lowest price and the Sprinter keeps $350.",
  "- Rush-hour traffic can no longer push a price up much, and NYC to Boston in the Executive Sedan stays under $780.",
  "- If a rider's flight lands at a different airport than the pickup, the site now shows a clear warning with a button to switch the pickup. The rider can still book.",
  "- Canada trips are listed as 24/7 in every vehicle, by quote.",
  "",
  "A few quick questions. A short reply is fine.",
  "",
  "1. Your Newark tolls ($16.79 and $5.71) add to $22.50, but you wrote $22.80. Which is right?",
  "2. Should Weehawken, West New York, Guttenberg or Secaucus join the Jersey City, Hoboken, North Bergen and Union City price cap?",
  "3. Sprinters by the hour are now by quote. Should the hourly Sprinter prices show on the rates page again?",
  "4. First Class lowest price: should $170 be before the 12% fee ($190.40 total, as now) or the total?",
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
