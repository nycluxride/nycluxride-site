import { timingSafeEqual } from "node:crypto";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

export const TO = "info@nycluxride.com";
export const SEND_ON = "2026-11-22";
export const SUBJECT = "Website update: Sprinters, policies and a few questions";
export const LINES = [
  "Assalamu Alaikum,",
  "",
  "These updates are now live on www.nycluxride.com:",
  "- Your five Sprinters with your new prices, each shown on its own on the booking page.",
  "- The waiting charges, cancellation, no-show and change policies on the Rates page and next to the pay button.",
  "- The child seats from your sheet: Nuna RAVA, Safety 1st Grow and Go and a backless booster. Parents are asked for each child's age, weight and height.",
  "- Riders can enter how many bags they bring.",
  "- Tolls on trips like Newark to Greenwich are added at booking.",
  "- Riders get a reminder email the evening before their ride, with where to meet the chauffeur.",
  "",
  "Please text me your answers to these when you have a minute. Short answers are fine. A few repeat from my last email in case it did not arrive.",
  "",
  "Sprinters",
  "1. What is the White Luxury Limo price to and from LaGuardia?",
  "2. What should the Luxury Jet, Presidential, Limo and White Luxury Limo charge for trips that are not to or from JFK, LaGuardia, Newark or Teterboro? For now those riders are asked to request a price.",
  "3. You wrote 6 to 8 seats for the Jet and 8 to 10 for the White Limo. The site books up to 8 and up to 10. Is that right?",
  "4. How much luggage fits in each Sprinter? All show 10 large and 2 small bags for now.",
  "5. Please send a photo of the Presidential Sprinter, and larger photos of the others if you have them. Is the night photo of the Jet with captain chairs a real photo of your van?",
  "6. Do your Sprinters have dual rear wheels? If yes, the bridges charge them about $43 to $45 instead of $14.79 to $16.79.",
  "",
  "Cars",
  "7. Electric Class (Cadillac Lyriq) is $180 to JFK. What does it cost to LaGuardia, Newark and Teterboro, by the hour, and for other trips?",
  "8. Should the Cadillac CT5 or CT6, Lincoln Continental and Cadillac XT6 come off the site, leaving Mercedes E-Class or similar for the Executive Sedan?",
  "9. Business SUV: only the Suburban, or keep the GMC Denali and Lincoln Navigator too?",
  "10. How much luggage fits in the Lyriq?",
  "",
  "Policies",
  "11. Are the 25% and 50% cancellation charges a share of the full amount paid or of the fare only? Is the gratuity refunded?",
  "12. On a round trip, does each ride have its own cancellation deadline?",
  "13. When an hourly booking runs over, do you charge the per-minute waiting rate or the hourly rate?",
  "",
  "Other",
  "14. Which backless booster model is it, from its label?",
  "15. Newark to Staten Island: the flat price includes $12.75 in tolls, but the real tolls are $16.20 to $18.20. Keep the price or raise it?",
  "16. Before a pickup, does the chauffeur always call or message the rider?",
  "",
  "JazakAllah Khair,",
  "Ali",
];
const SMTP_MS = 15000;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NEW_YORK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function authorized(header, secret) {
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string") return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const sendDay = (now) => NEW_YORK_DAY.format(now) === SEND_ON;

export function letter(from) {
  const text = LINES.join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${LINES.map((l) => (l ? `<p style="margin:0 0 10px">${esc(l)}</p>` : "")).join("")}</body></html>`;
  return { from: from.address, to: [TO], data: buildMessage({ from, to: [{ name: "", address: TO }], subject: SUBJECT, text, html, id: `owner-update.20261122@${from.address.split("@")[1]}` }) };
}

export default async function handler(req, res, now = new Date()) {
  if (req.method !== "GET") return res.status(405).end();
  if (!authorized(req.headers && req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).end();
  if (!sendDay(now)) return res.status(204).end();
  const settings = mailSettings();
  if (settings.off || settings.bad) {
    console.error("owner-update-mail-off");
    return res.status(503).end();
  }
  const [result] = await smtpSend(settings, [letter(settings.from)], SMTP_MS);
  if (!result || !result.ok) {
    console.error("owner-update-fail", result && result.stage, result && result.code);
    return res.status(500).end();
  }
  console.log("owner-update-sent");
  return res.status(200).end();
}
