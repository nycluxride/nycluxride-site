import { timingSafeEqual } from "node:crypto";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

export const TO = "info@nycluxride.com";
export const SEND_ON = "2026-11-21";
export const SUBJECT = "Tolls, ride reminders and a few questions";
export const LINES = [
  "Assalamu Alaikum,",
  "",
  "The tolls are fixed. Your Newark to Greenwich trip now adds the Turnpike, George Washington Bridge and I-95 tolls to the price at booking, $22.24 on a weekday afternoon.",
  "",
  "Riders also get a reminder email the evening before their ride, with where to meet the chauffeur. The booking confirmation email now says where to meet too.",
  "",
  "The four Sprinters are on the site with your prices, and Sprinter hourly trips can be booked and paid online.",
  "",
  "One tip: if you cancel a ride without a refund, add \"CANCELLED: \" to the start of its title in the bookings calendar, so no reminder goes out. Refunds in Stripe do this on their own.",
  "",
  "A few questions. Please text me your answers when you have a minute. Short answers are fine.",
  "",
  "1. Before a pickup, does the chauffeur always call or message the rider? The reminder says so for airport pickups.",
  "2. At JFK, LaGuardia and Newark, is there a fixed meeting spot, or is \"the curb or the car service pickup area\" right?",
  "3. The WhatsApp customer who asked where to go: did he book on the website or through a payment link? Only website bookings get reminders.",
  "4. Would you like a daily email listing tomorrow's rides?",
  "5. Newark to Staten Island: the flat price includes $12.75 in tolls, but the real tolls are $16.20 off-peak and $18.20 peak. Keep the price or raise it?",
  "6. Do your Sprinters have dual rear wheels? If yes, the bridge charges them about $43 to $45 instead of $14.79 to $16.79.",
  "7. Are your E-ZPass tags from New York or New Jersey?",
  "8. Which of your Sprinter photos show the Jet Sprinter? Larger original photos would also look sharper on the site.",
  "9. How much luggage fits in the Limo Sprinter?",
  "10. Car seats: is the brand \"Nova\" or \"Nuna\"?",
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
  return { from: from.address, to: [TO], data: buildMessage({ from, to: [{ name: "", address: TO }], subject: SUBJECT, text, html, id: `owner-update.20261121@${from.address.split("@")[1]}` }) };
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
