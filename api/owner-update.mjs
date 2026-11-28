import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

const MIN_SECRET = 32;
const SMTP_MS = 8000;
const SEND_ON = "2026-11-27";
const TO = "info@nycluxride.com";
const SUBJECT = "One quick question about Request a quote";
const ID = "owner-update.20261127b";
const LINES = [
  "Assalamu Alaikum,",
  "",
  "One quick question about Request a quote.",
  "",
  "Right now long-distance trips (75 miles or more, like Philadelphia, Boston and Washington DC) and every Sprinter booking show Request a quote. Riders cannot see a price or pay online for these trips. They have to email or WhatsApp you and wait for a price, and some may book elsewhere instead.",
  "",
  "Which do you want? A short reply is fine.",
  "",
  "1. Long-distance trips: show the price and let riders book and pay online, or keep Request a quote?",
  "2. Sprinters: show the price and let riders book and pay online, show the price but have riders request it so you can check a Sprinter is free first, or keep Request a quote?",
  "",
  "Our suggestion: show the price and book online for long-distance trips, and show the price with a request for Sprinters.",
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
