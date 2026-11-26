import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";

const MIN_SECRET = 32;
const SMTP_MS = 8000;
const SEND_ON = "2026-11-26";
const TO = "info@nycluxride.com";
const SUBJECT = "New prices are live, 3 quick questions";
const ID = "owner-update.20261126";
const LINES = [
  "Assalamu Alaikum,",
  "",
  "The new prices are live on www.nycluxride.com:",
  "- Short rides under 50 miles: base fare plus time and distance, plus tolls and a 12% service fee. The Business SUV base is $85 and the Escalade $95.",
  "- Brooklyn to Westfield in the Business SUV is now about $253 to $263 before dogs, seats and gratuity, depending on traffic.",
  "- Long rides stay as in the table you liked, for example Midtown to Philadelphia $512 in the Business SUV.",
  "- Airport prices stay the same, for example LaGuardia to Manhattan $165 in the Business SUV.",
  "- Every price shows one 12% service fee line instead of taxes.",
  "",
  "Three quick questions. A short reply is fine.",
  "",
  "1. Sprinter: right now $350 is the lowest price for any Sprinter ride, so Brooklyn to Westfield is about $436. Should $350 be added on top of time and distance instead? That ride would be about $738.",
  "2. Other cars: the base fares are Executive Sedan $75, Electric Class $76 and First Class $105. Short First Class rides used to start at $170 and now start lower. Keep $170 as the lowest First Class price, or keep $105?",
  "3. Airport gratuity: the percent gratuity is now taken from the fare before the 12% fee, so it is a little lower on airport rides (Newark Business SUV with 25% is $223.45 instead of $227.12). OK, or keep it as before?",
  "",
  "Please also check with your accountant that New York sales tax is handled for rides that start and end in New York.",
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
