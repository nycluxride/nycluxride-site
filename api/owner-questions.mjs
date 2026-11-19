import { timingSafeEqual } from "node:crypto";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

export const TO = "info@nycluxride.com";
export const SUBJECT = "A few quick questions for the new website pages";
export const LINES = [
  "Assalamu Alaikum,",
  "",
  "I'm building the new pages for Google now. A few answers from you will make them accurate. Please text me your answers whenever you have a minute. Short answers are fine.",
  "",
  "1. New Jersey: do you have New Jersey permission for rides that start and end in New Jersey, like Hoboken to Newark Airport?",
  "2. Private jets at Teterboro: do you meet the passenger in the lobby or at the plane? Do you need the tail number? When does free waiting start?",
  "3. Areas: are there any of these you do NOT drive to regularly: the New Jersey towns, Long Island, the Hamptons, Westchester, Greenwich, Stamford?",
  "4. Office: do you have an address customers can visit, or do you only serve an area?",
  "5. TLC: what is your TLC base license number, and which base dispatches your trips?",
  "6. Car seats: which seat models do you carry? How many fit in each car? Can parents bring their own? Please send a photo of a fitted seat.",
  "7. Dogs: which cars fit a dog crate? Can a dog sit on the seat with a cover?",
  "8. Hourly: once an hourly booking starts in NYC, can the car leave the city, for example for a meeting in Stamford?",
  "9. Bradley Airport (Hartford): are you fine driving about 120 miles back empty?",
  "10. Old website: who controls nyc-lux-ride.com? I'd like to point it to your real site.",
  "11. Home page headline: keep \"NYC airport transfers. Travel in First Class\" or change it to \"Black car and chauffeur service in NYC\"?",
  "12. Smaller ones: how many Sprinters can run at the same time? Which cars have Wi-Fi? Can wedding couples decorate the car? Is alcohol allowed in the Sprinter?",
  "",
  "JazakAllah Khair,",
  "Ali",
];
const SMTP_MS = 15000;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function authorized(header, secret) {
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string") return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function letter(from) {
  const text = LINES.join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${LINES.map((l) => (l ? `<p style="margin:0 0 10px">${esc(l)}</p>` : "")).join("")}</body></html>`;
  return { from: from.address, to: [TO], data: buildMessage({ from, to: [{ name: "", address: TO }], subject: SUBJECT, text, html, id: `owner-questions.20261119@${from.address.split("@")[1]}` }) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (!authorized(req.headers && req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).end();
  const settings = mailSettings();
  if (settings.off || settings.bad) {
    console.error("owner-questions-mail-off");
    return res.status(503).end();
  }
  const [result] = await smtpSend(settings, [letter(settings.from)], SMTP_MS);
  if (!result || !result.ok) {
    console.error("owner-questions-fail", result && result.stage, result && result.code);
    return res.status(500).end();
  }
  console.log("owner-questions-sent");
  return res.status(200).end();
}
