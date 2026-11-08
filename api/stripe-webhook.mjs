import { json, readBytes, instanceBudget } from "./_http.mjs";
import { retrieveSession, stripeKey, signatureOk } from "./_stripe.mjs";
import { mailBooking } from "./_mail.mjs";

const MAX_BODY = 262144;
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
const RETRY = ["failed", "busy"];
const ROUNDS = 3;
const PAUSE_MS = 2000;
const CALLS_PER_WINDOW = 300;

const reply = (status) => json(status, { received: status < 300 });

async function handle(request) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    console.error("webhook-off");
    return reply(503);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return reply(413);
  const payload = await readBytes(request, MAX_BODY);
  if (payload === null) return reply(413);
  if (!signatureOk(request.headers.get("stripe-signature"), payload, secret)) {
    console.error("webhook-signature");
    return reply(400);
  }
  let event;
  try {
    event = JSON.parse(payload.toString("utf8"));
  } catch {
    return reply(400);
  }
  const type = event && typeof event.type === "string" ? event.type.replace(/^v1\./, "") : "";
  const id = (event && event.data && event.data.object && event.data.object.id) || (event && event.related_object && event.related_object.id);
  if (!EVENTS.includes(type) || typeof id !== "string" || !SESSION_ID.test(id)) return reply(200);
  const key = stripeKey();
  if (!key || !instanceBudget("stripe-webhook", CALLS_PER_WINDOW)) return reply(503);
  for (let round = 1; ; round++) {
    const result = await retrieveSession(id, key);
    if (result.status === 404) return reply(200);
    if (!result.ok || !result.body) {
      console.error("stripe", result.status, result.requestId);
      return reply(503);
    }
    if (result.body.payment_status !== "paid") return reply(200);
    const status = await mailBooking(result.body, key, { unmarked: true });
    if (status !== "busy" || round === ROUNDS) return reply(RETRY.includes(status) ? 503 : 200);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
}

export async function POST(request) {
  try {
    return await handle(request);
  } catch {
    console.error("handler");
    return reply(503);
  }
}
