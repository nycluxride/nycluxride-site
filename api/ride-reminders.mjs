import { json } from "./_http.mjs";
import { cronAllowed } from "./_seo.mjs";
import { mailSettings } from "./_mail.mjs";
import { keyProblem, secretKey } from "./_stripe.mjs";
import { calendarSettings } from "./_calendar.mjs";
import { SEND_HOURS, newYork, sendReminders } from "./_remind.mjs";

const MIN_SECRET = 32;

const quiet = (...why) => {
  console.log("reminders-off", ...why);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};
const failed = (...why) => {
  console.error("reminders-fail", ...why);
  return json(500, { kind: "error" });
};

export async function GET(request) {
  if (!cronAllowed(request, MIN_SECRET)) return json(401, { kind: "unauthorized" });
  try {
    const now = new Date();
    const { hour, tomorrow } = newYork(now);
    if (!SEND_HOURS.includes(hour)) return quiet("hour", hour);
    const mail = mailSettings();
    const problem = keyProblem();
    if (mail.off) return quiet("mail");
    if (problem === "key-missing") return quiet("stripe");
    if (mail.bad) return failed("mail-settings");
    if (problem) return failed(problem);
    const result = await sendReminders({ now, key: secretKey(), mail, calendar: calendarSettings(), oidc: request.headers.get("x-vercel-oidc-token") || "" });
    const counts = Object.entries(result.counts).map(([name, n]) => `${name} ${n}`);
    if (result.failed !== undefined) return failed("list", result.failed, ...counts);
    console.log("reminders", tomorrow, ...(counts.length ? counts : ["none"]));
    return json(200, { kind: "done" });
  } catch {
    return failed("handler");
  }
}
