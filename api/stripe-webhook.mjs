import { json, readBytes, instanceBudget } from "./_http.mjs";
import { retrieveSession, sessionsForIntent, stripeKey, signatureOk } from "./_stripe.mjs";
import { mailBooking, refundBooking } from "./_mail.mjs";
import { calendarSettings } from "./_calendar.mjs";

const MAX_BODY = 262144;
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const INTENT = /^pi_[A-Za-z0-9]{6,200}$/;
const REFUNDED = "charge.refunded";
const EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
const RETRY = ["failed", "busy", "calendar"];
const ROUNDS = 3;
const PAUSE_MS = 2000;
const CALLS_PER_WINDOW = 300;

const reply = (status) => json(status, { received: status < 300 });
const GAVE_UP = [400, 404];
const cents = (value, most) => Number.isInteger(value) && value > 0 && value <= most;

async function refund(event, request) {
  if (calendarSettings().off) return reply(200);
  const charge = event.data && event.data.object;
  const created = event.created;
  if (!charge) {
    console.error("refund-unreadable");
    return reply(200);
  }
  if (charge.object !== "charge" || !INTENT.test(String(charge.payment_intent || "")) || !cents(charge.amount, Number.MAX_SAFE_INTEGER) || !cents(charge.amount_refunded, charge.amount) || !cents(created, 1e11)) return reply(200);
  const key = stripeKey();
  if (!key || !instanceBudget("stripe-webhook", CALLS_PER_WINDOW)) return reply(503);
  const found = await sessionsForIntent(charge.payment_intent, key);
  const list = found.ok && found.body && Array.isArray(found.body.data) ? found.body.data : null;
  if (!list) {
    console.error("stripe", found.status, found.requestId);
    if (found.ok || !GAVE_UP.includes(found.status)) return reply(503);
    console.error("refund-gave-up", "stripe", found.status);
    return reply(200);
  }
  const session = list.find((item) => item && typeof item.id === "string" && SESSION_ID.test(item.id) && item.payment_intent === charge.payment_intent);
  if (!session) return reply(200);
  const status = await refundBooking(session, charge, created, request.headers.get("x-vercel-oidc-token") || "");
  return reply(status === "failed" ? 503 : 200);
}

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
  if (type === REFUNDED) return refund(event, request);
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
    const status = await mailBooking(result.body, key, { unmarked: true, oidc: request.headers.get("x-vercel-oidc-token") || "" });
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
