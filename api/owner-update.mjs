import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

const MIN_SECRET = 32;
const SMTP_MS = 8000;
const SEND_ON = "2026-11-28";
const TO = "info@nycluxride.com";
const SUBJECT = "Everything books online now, 3 quick questions";
const ID = "owner-update.20261128";
const LINES = [
  "Assalamu Alaikum,",
  "",
  "These are now live on www.nycluxride.com:",
  "- Every trip shows a price and books online, long distance included.",
  "- Sprinters book online again with 3 hours notice. Within 24 hours the price box says that if no Sprinter is free, you send two SUVs.",
  "- First Class within 2 hours says that if no S-Class or BMW 7 Series is free, you send a Cadillac Escalade.",
  "- Long Island MacArthur, Westchester and other airports now show a price, for example MacArthur to Midtown in the Business SUV.",
  "- Each car has a bag limit, and a medium suitcase counts as a large one. A booking like 2 large, 3 medium and 3 small bags can only choose a Sprinter.",
  "- Canada trips say 24/7 in the Executive Sedan, Business SUV and Business Premium SUV, call or WhatsApp to book.",
  "",
  "Three quick questions. A short reply is fine.",
  "",
  "1. Bags: the Executive Sedan and Electric Class take 2 large and 1 small. Is that right?",
  "2. The Luxury Jet, Presidential, Limo and White Luxury Limo Sprinters have prices only for airports and by the hour. Should they get a price for other trips too?",
  "3. Your Newark tolls ($16.79 and $5.71) add to $22.50, but you wrote $22.80. Which is right?",
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
