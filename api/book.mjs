import { CLASSES, VEHICLES, TIP_PERCENTS, TIP_CUSTOM, SITE_ORIGIN, CHECKOUT_ORIGINS, CONSENT_TERMS_LIVE, MEET_AND_GREET, HOURLY_START } from "./_rates.mjs";
import { HEADINGS, REASONS, ERROR_BLOCK, ERRORS } from "./_copy.mjs";
import { json, redirect, readBody, originAllowed, clientBudget, instanceBudget, wantsJson, production } from "./_http.mjs";
import { readInput, readSettings, resolveTrip, checkTrip, checkDetails, priceTrip, requestRef, contactLinks, receipt, classReason, classTotal, firstSlot, serviceOf } from "./_trip.mjs";
import { sessionParams, createSession, retrieveSession, expireSession } from "./_stripe.mjs";
import { googleUp } from "./_google.mjs";

const MAX_BODY = 12288;
const MOCK_LIMIT = 100;
const STRIPE_CALLS_PER_WINDOW = 1200;
const READ_CALLS_PER_WINDOW = 1200;
const UNKNOWN_LIMIT = 500;
const CLIENT_CALLS_PER_WINDOW = 10;
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const MOCK_ID = /^cs_mock_[1-9]\d{7}$/;
const KEY_SHAPE = /^(rk|sk)_(live|test)_\S{10,}$/;
const LIVE_KEY = /^(rk|sk)_live_/;
const RESTRICTED_KEY = /^rk_/;
const TYPES = ["application/json", "application/x-www-form-urlencoded"];
const TIP_RANGE = { min_cents: TIP_CUSTOM.min, max_cents: TIP_CUSTOM.max };
const mockSessions = new Map();
const unknownIds = new Set();

const secretKey = () => String(process.env.STRIPE_SECRET_KEY || "").trim();
const previewDemo = () => process.env.VERCEL_ENV === "preview" && !secretKey();
const mockMode = () => (process.env.BOOK_MOCK === "true" || previewDemo()) && !production() && !LIVE_KEY.test(secretKey());

function keyProblem() {
  const key = secretKey();
  if (!key) return "key-missing";
  if (!KEY_SHAPE.test(key) || (LIVE_KEY.test(key) && !RESTRICTED_KEY.test(key))) return "key-shape";
  if (LIVE_KEY.test(key) !== production()) return "key-environment";
  return "";
}

function stripeKey() {
  const problem = keyProblem();
  if (problem) console.error(problem);
  return problem ? "" : secretKey();
}

function stripeBudget(kind, limit) {
  if (instanceBudget(kind, limit)) return true;
  console.error("stripe-budget");
  return false;
}

const checkoutUrl = (url) => typeof url === "string" && CHECKOUT_ORIGINS.some((origin) => url.startsWith(`${origin}/`));

function errorBody(code, links) {
  return { kind: "error", code, group: ERROR_BLOCK.group, heading: HEADINGS[ERROR_BLOCK.group], text: ERROR_BLOCK.text, ...links };
}

function classList(trip, tripReason) {
  return Object.keys(CLASSES).map((cls) => {
    const reason = tripReason || classReason(trip, cls);
    return { class: cls, name: CLASSES[cls].name, seats: CLASSES[cls].seats, total_cents: reason ? null : classTotal(trip, cls), reason };
  });
}

function vehicleList(trip) {
  if (trip.trip_type !== "hour") return [];
  const seated = Number(trip.passengers) <= CLASSES.suv.seats;
  return Object.keys(VEHICLES)
    .filter((key) => VEHICLES[key].cls === "suv")
    .map((key) => ({ vehicle: key, label: VEHICLES[key].model, total_cents: seated ? priceTrip({ ...trip, class: "suv", vehicle: key }).total : null }));
}

function quoteBody(trip, ref, reason, now, { field = "", scope = "trip", total } = {}) {
  const { group, text, google, short } = REASONS[reason];
  const hourly = HOURLY_START.includes(trip.from);
  return {
    kind: "quote",
    ref,
    reason,
    group,
    heading: HEADINGS[group],
    text: google && googleUp() ? google : short && !hourly ? short : text,
    hourly,
    field: reason === "unplaced" ? field : "",
    classes: classList(trip, scope === "trip" ? reason : ""),
    tips: TIP_PERCENTS,
    tip_custom: TIP_RANGE,
    earliest: firstSlot(now),
    ...(trip.route && { route: trip.route }),
    ...contactLinks(trip, ref, total),
  };
}

function optionsBody(trip, ref, check, now) {
  const hourly = trip.trip_type === "hour";
  const price = check.reason ? null : priceTrip(trip);
  return {
    kind: "options",
    ref,
    service: serviceOf(trip),
    legs: hourly ? 0 : trip.legs.length,
    classes: classList(trip, ""),
    vehicles: vehicleList(trip),
    tips: TIP_PERCENTS,
    tip_custom: TIP_RANGE,
    meet: trip.meetOffered,
    meet_cents: trip.meetOffered ? MEET_AND_GREET : null,
    selected: { class: trip.class, vehicle: hourly ? trip.vehicle : "", tip: trip.tip, tip_amount: trip.tip === "custom" ? Number(trip.tip_amount) : 0, meet: trip.meet },
    price: price ? { lines: price.lines, total_cents: price.total, currency: "usd", notes: price.notes } : null,
    reason: check.reason,
    pay: Boolean(price) && !check.hold,
    hold: check.hold,
    earliest: firstSlot(now),
    ...(trip.route && { route: trip.route }),
    ...contactLinks(trip, ref, price ? price.total : undefined),
  };
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
  const id = `cs_mock_${metadata.ref}`;
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
  if (lines.length && lines.reduce((sum, item) => sum + item.cents, 0) !== session.amount_total) console.error("receipt-mismatch", metadata.ref || "");
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
    ...(metadata.short_notice === "1" && { short_notice: true }),
  };
}

async function handlePost(request) {
  const asJson = wantsJson(request);
  const reply = (status, body, location) => (asJson ? json(status, body) : redirect(location));
  const fail = (status, code, links) => reply(status, errorBody(code, links), "/book#q-error");
  if (!originAllowed(request)) return fail(403, "origin", contactLinks());
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return fail(413, "too-large", contactLinks());
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return fail(415, "type", contactLinks());
  const text = await readBody(request, MAX_BODY);
  if (text === null) return fail(413, "too-large", contactLinks());
  const invalid = (code) => reply(422, { kind: "invalid", code, field: ERRORS[code].field, text: ERRORS[code].text }, `/book#e-${code}`);
  const fields = parseFields(type, text);
  if (!fields) return invalid("form");
  const input = readInput(asJson ? fields : { ...fields, action: "pay" });
  const ref = requestRef({ ...input, action: "options" });
  const settings = readSettings(process.env);
  if (previewDemo()) settings.paymentsEnabled = true;
  if (production() && !CONSENT_TERMS_LIVE) settings.paymentsEnabled = false;
  const keyIssue = mockMode() ? "" : keyProblem();
  if (keyIssue) {
    if (settings.paymentsEnabled && input.action === "pay") console.error(keyIssue);
    settings.paymentsEnabled = false;
  }
  if (settings.blackoutBad) console.error("blackout-config");
  const now = new Date();
  const trip = await resolveTrip(input, { env: process.env, request, now });
  const check = checkTrip(trip, now, settings);
  if (check.kind === "invalid") return invalid(check.code);
  if (check.kind === "quote") return reply(200, quoteBody(trip, ref, check.reason, now, { field: check.field }), `/book#q-${check.reason}`);
  if (trip.action !== "pay") return json(200, optionsBody(trip, ref, check, now));
  if (check.reason) return reply(200, quoteBody(trip, ref, check.reason, now, { scope: "class" }), `/book#q-${check.reason}`);
  const price = priceTrip(trip, settings);
  if (check.hold) return reply(200, quoteBody(trip, ref, check.hold, now, { scope: "hold", total: price.total }), `/book#q-${check.hold}`);
  const detail = checkDetails(trip, asJson);
  if (detail) return invalid(detail.code);
  const origin = production() ? SITE_ORIGIN : new URL(request.url).origin;
  const paid = requestRef(input);
  const params = sessionParams(trip, price, paid, settings, now, origin);
  if (mockMode()) {
    const url = `/booking-confirmed?session_id=${rememberMock(params)}`;
    return reply(200, { kind: "pay", ref: paid, url }, url);
  }
  const key = stripeKey();
  if (!key || !clientBudget(request, "create", CLIENT_CALLS_PER_WINDOW) || !stripeBudget("stripe-create", STRIPE_CALLS_PER_WINDOW)) {
    return fail(503, "unavailable", contactLinks(trip, ref, price.total));
  }
  const result = await createSession(params, key);
  if (!result.ok || !result.body || !checkoutUrl(result.body.url)) {
    console.error("stripe", result.status, result.requestId, ref);
    return fail(502, "stripe", contactLinks(trip, ref, price.total));
  }
  if (result.body.amount_total !== price.total) {
    console.error("amount-mismatch", result.body.amount_total, price.total, paid);
    if (typeof result.body.id === "string") await expireSession(result.body.id, key);
    return fail(502, "stripe", contactLinks(trip, ref, price.total));
  }
  return reply(200, { kind: "pay", ref: paid, url: result.body.url }, result.body.url);
}

async function handleGet(request) {
  const id = new URL(request.url).searchParams.get("session_id") || "";
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return json(404, { kind: "unknown" });
  if (mockMode() && MOCK_ID.test(id)) {
    const session = mockSessions.get(id);
    return json(200, session ? sessionBody(session) : { kind: "unknown" });
  }
  if (!SESSION_ID.test(id) || unknownIds.has(id)) return json(200, { kind: "unknown" });
  const key = stripeKey();
  if (!key || !clientBudget(request, "read", CLIENT_CALLS_PER_WINDOW) || !stripeBudget("stripe-read", READ_CALLS_PER_WINDOW)) return json(503, errorBody("unavailable", contactLinks()));
  const result = await retrieveSession(id, key);
  if (result.status === 404) {
    unknownIds.add(id);
    if (unknownIds.size > UNKNOWN_LIMIT) unknownIds.delete(unknownIds.values().next().value);
    return json(200, { kind: "unknown" });
  }
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
