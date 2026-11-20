import { randomBytes } from "node:crypto";
import { json } from "./_http.mjs";
import { mailSettings } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";
import { oidcToken } from "./_gtoken.mjs";
import { cronAllowed, seoSettings, searchData, seoLetter } from "./_seo.mjs";

const SMTP_MS = 8000;

const failed = (...why) => {
  console.error("seo-fail", ...why);
  return json(500, { kind: "error" });
};

export async function GET(request) {
  if (!cronAllowed(request)) return json(401, { kind: "unauthorized" });
  try {
    const settings = seoSettings();
    if (settings.off) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    if (settings.bad) return failed("settings");
    const mail = mailSettings();
    if (mail.off || mail.bad || !mail.owners.length) return failed("mail-settings");
    const oidc = oidcToken(request.headers.get("x-vercel-oidc-token"));
    if (!oidc) return failed("token");
    const data = await searchData(settings, oidc, new Date());
    if (!data.now) return failed(data.stage, data.status);
    const letter = seoLetter(data, mail, settings.site);
    const id = `seo.${data.week[1]}.${randomBytes(8).toString("hex")}`;
    const [result] = await smtpSend(mail, [{ from: mail.from.address, to: letter.to.map((box) => box.address), data: buildMessage({ ...letter, from: mail.from, id }) }], SMTP_MS);
    if (!result.ok) return failed("smtp", result.stage, result.code);
    if (result.rejected) console.error("seo-rcpt", result.rejected);
    console.log("seo-sent", data.week[1], data.now.clicks);
    return json(200, { kind: "sent" });
  } catch {
    return failed("handler");
  }
}
