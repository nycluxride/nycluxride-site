import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

const MIN_SECRET = 32;
const SMTP_MS = 8000;
const SEND_ON = "2026-11-25";
const TO = "info@nycluxride.com";
const SUBJECT = "Two quick questions about prices";
const ID = "owner-update.20261125";
const LINES = [
  "Assalamu Alaikum,",
  "",
  "Two quick questions. A short reply is fine.",
  "",
  "1. Your JFK to Jersey City booking 39333380 (Business SUV, one child seat) comes to $239.85 with both tolls. You asked for $228 with 12% tax. New York tax does not apply to trips into New Jersey, so to bring that ride to about $228 we would lower prices for trips priced by distance by about 6%, for every car. Flat airport prices and hourly rates stay the same. With the new $20 child seat, that ride would be about $233. Should we lower them?",
  "",
  "2. Which toll class are your Sprinters billed at on E-ZPass? A car pays $14.79 to $16.79 at the Hudson River bridges and tunnels. A mini bus pays $16.80 to $21.00 and a vehicle with dual rear wheels pays about $43 to $45. We will charge Sprinter tolls at that rate.",
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
