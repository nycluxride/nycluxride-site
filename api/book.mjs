import { randomUUID } from "node:crypto";
import { AIRPORT_FARES, CLASSES, SITE_ORIGIN, CHECKOUT_ORIGINS, CONSENT_TERMS_LIVE } from "./_rates.mjs";
import { HEADINGS, REASONS, ERROR_BLOCK, ERRORS } from "./_copy.mjs";
import { readInput, readSettings, checkTrip, priceTrip, bookingRef, contactLinks, route, receipt } from "./_trip.mjs";
import { sessionParams, createSession, retrieveSession, expireSession } from "./_stripe.mjs";

const MAX_BODY = 4096;
const MOCK_LIMIT = 100;
const STRIPE_WINDOW_MS = 60000;
const STRIPE_CALLS_PER_WINDOW = 120;
const READ_CALLS_PER_WINDOW = 60;
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const MOCK_ID = /^cs_mock_[0-9A-Z]{6}$/;
const KEY_SHAPE = /^(rk|sk)_(live|test)_\S{10,}$/;
const LIVE_KEY = /^(rk|sk)_live_/;
const RESTRICTED_KEY = /^rk_/;
const SITE_ORIGINS = ["https://www.nycluxride.com", "https://nycluxride.com"];
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;
const TYPES = ["application/json", "application/x-www-form-urlencoded"];
const SWITCH_CLASS = "suv";
const mockSessions = new Map();
const createCalls = [];
const readCalls = [];

const production = () => process.env.VERCEL_ENV === "production";
const secretKey = () => String(process.env.STRIPE_SECRET_KEY || "").trim();
const previewDemo = () => process.env.VERCEL_ENV === "preview" && !secretKey();
const mockMode = () => (process.env.BOOK_MOCK === "true" || previewDemo()) && !production() && !LIVE_KEY.test(secretKey());
const wantsJson = (request) => (request.headers.get("accept") || "").includes("application/json");

function stripeKey() {
  const key = secretKey();
  if (!key) return "";
  if (!KEY_SHAPE.test(key) || (LIVE_KEY.test(key) && !RESTRICTED_KEY.test(key))) {
    console.error("key-shape");
    return "";
  }
  if (LIVE_KEY.test(key) !== production()) {
    console.error("key-environment");
    return "";
  }
  return key;
}

function stripeBudget(calls, limit) {
  const now = Date.now();
  while (calls.length && calls[0] <= now - STRIPE_WINDOW_MS) calls.shift();
  if (calls.length >= limit) {
    console.error("stripe-budget");
    return false;
  }
  calls.push(now);
  return true;
}

const checkoutUrl = (url) => typeof url === "string" && CHECKOUT_ORIGINS.some((origin) => url.startsWith(`${origin}/`));

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

function errorBody(code, links) {
  return { kind: "error", code, group: ERROR_BLOCK.group, heading: HEADINGS[ERROR_BLOCK.group], text: ERROR_BLOCK.text, ...links };
}

function quoteBody(trip, ref, reason) {
  const { group, text } = REASONS[reason];
  return { kind: "quote", ref, reason, group, heading: HEADINGS[group], text, switch: switchFor(trip, reason), ...contactLinks(trip, ref) };
}

function switchFor(trip, reason) {
  if (reason !== "class-airport" && reason !== "first-lga") return null;
  const cents = AIRPORT_FARES[SWITCH_CLASS][route(trip).airport];
  if (!cents || Number(trip.passengers) > CLASSES[SWITCH_CLASS].seats) return null;
  return { class: SWITCH_CLASS, cents };
}

function originAllowed(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null || SITE_ORIGINS.includes(origin)) return true;
  if (production()) return false;
  return origin === new URL(request.url).origin || PREVIEW_ORIGIN.test(origin);
}

async function readBody(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFields(type, text) {
  if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(text));
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const fields = {};
    for (const [name, value] of Object.entries(data)) if (typeof value === "string" || typeof value === "number") fields[name] = String(value);
    return fields;
  } catch {
    return null;
  }
}

function rememberMock(params) {
  const metadata = {};
  for (const [key, value] of params) {
    const match = /^metadata\[(.+)\]$/.exec(key);
    if (match) metadata[match[1]] = value;
  }
  const id = `cs_mock_${metadata.ref.slice(4)}`;
  mockSessions.delete(id);
  mockSessions.set(id, {
    id,
    status: "complete",
    payment_status: "paid",
    amount_total: Number(metadata.total_cents),
    currency: params.get("line_items[0][price_data][currency]"),
    client_reference_id: params.get("client_reference_id"),
    metadata,
  });
  while (mockSessions.size > MOCK_LIMIT) mockSessions.delete(mockSessions.keys().next().value);
  return id;
}

function sessionBody(session) {
  const { status, payment_status } = session;
  if (payment_status !== "paid") return { kind: "session", status, payment_status };
  const metadata = session.metadata || {};
  const stripeTax = session.total_details && Number.isInteger(session.total_details.amount_tax) ? session.total_details.amount_tax : undefined;
  const { summary, lines, value, notes } = receipt(metadata, readSettings(process.env), stripeTax);
  if (lines.length && lines.reduce((sum, line) => sum + line.cents, 0) !== session.amount_total) console.error("receipt-mismatch", metadata.ref || "");
  return {
    kind: "session",
    status,
    payment_status,
    ref: metadata.ref || session.client_reference_id || "",
    summary,
    lines,
    total_cents: session.amount_total,
    value_cents: value,
    currency: session.currency || "usd",
    notes,
  };
}

async function handlePost(request) {
  const reply = (status, body, location) => (wantsJson(request) ? json(status, body) : redirect(location));
  const fail = (status, code, links) => reply(status, errorBody(code, links), "/book#q-error");
  if (!originAllowed(request)) return fail(403, "origin", contactLinks());
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return fail(413, "too-large", contactLinks());
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return fail(415, "type", contactLinks());
  const text = await readBody(request);
  if (text === null) return fail(413, "too-large", contactLinks());
  const invalid = (code) => reply(422, { kind: "invalid", code, field: ERRORS[code].field, text: ERRORS[code].text }, `/book#e-${code}`);
  const fields = parseFields(type, text);
  if (!fields) return invalid("form");
  const trip = readInput(fields);
  const ref = bookingRef(trip.nonce || randomUUID());
  const settings = readSettings(process.env);
  if (previewDemo()) settings.paymentsEnabled = true;
  if (production() && !CONSENT_TERMS_LIVE) settings.paymentsEnabled = false;
  if (settings.taxHalfSet) console.error("tax-config");
  const now = new Date();
  const check = checkTrip(trip, now, settings);
  if (check.kind === "invalid") return invalid(check.code);
  if (check.kind === "quote") return reply(200, quoteBody(trip, ref, check.reason), `/book#q-${check.reason}`);
  const price = priceTrip(trip, settings);
  if (trip.action === "quote" && wantsJson(request)) {
    return json(200, { kind: "price", ref, lines: price.lines, total_cents: price.total, currency: "usd", notes: price.notes });
  }
  const origin = production() ? SITE_ORIGIN : new URL(request.url).origin;
  const params = sessionParams(trip, price, ref, settings, now, origin);
  if (mockMode()) {
    const url = `/booking-confirmed?session_id=${rememberMock(params)}`;
    return reply(200, { kind: "pay", ref, url }, url);
  }
  const key = stripeKey();
  if (!key || !stripeBudget(createCalls, STRIPE_CALLS_PER_WINDOW)) return fail(503, "unavailable", contactLinks(trip, ref));
  const result = await createSession(params, key);
  if (!result.ok || !result.body || !checkoutUrl(result.body.url)) {
    console.error("stripe", result.status, result.requestId, ref);
    return fail(502, "stripe", contactLinks(trip, ref));
  }
  if (result.body.amount_total !== price.total) {
    console.error("amount-mismatch", result.body.amount_total, price.total, ref);
    if (typeof result.body.id === "string") await expireSession(result.body.id, key);
    return fail(502, "stripe", contactLinks(trip, ref));
  }
  return reply(200, { kind: "pay", ref, url: result.body.url }, result.body.url);
}

async function handleGet(request) {
  const id = new URL(request.url).searchParams.get("session_id") || "";
  if (mockMode() && MOCK_ID.test(id)) {
    const session = mockSessions.get(id);
    return session ? json(200, sessionBody(session)) : json(404, { kind: "unknown" });
  }
  const site = request.headers.get("sec-fetch-site");
  if (!SESSION_ID.test(id) || site === "cross-site" || site === "same-site") return json(404, { kind: "unknown" });
  const key = stripeKey();
  if (!key || !stripeBudget(readCalls, READ_CALLS_PER_WINDOW)) return json(503, errorBody("unavailable", contactLinks()));
  const result = await retrieveSession(id, key);
  if (result.status === 404) return json(404, { kind: "unknown" });
  if (!result.ok || !result.body) {
    console.error("stripe", result.status, result.requestId);
    return json(502, errorBody("stripe", contactLinks()));
  }
  return json(200, sessionBody(result.body));
}

export async function POST(request) {
  try {
    return await handlePost(request);
  } catch {
    console.error("handler");
    return wantsJson(request) ? json(503, errorBody("unavailable", contactLinks())) : redirect("/book#q-error");
  }
}

export async function GET(request) {
  try {
    return await handleGet(request);
  } catch {
    console.error("handler");
    return json(503, errorBody("unavailable", contactLinks()));
  }
}
