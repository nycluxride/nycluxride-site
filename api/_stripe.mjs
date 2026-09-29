import { DESCRIPTOR_CODES, TLC_BASE_LICENSE, STRIPE_VERSION, MIN_NOTICE_HOURS } from "./_rates.mjs";
import { CHECKOUT, LABELS } from "./_copy.mjs";
import { fill, formatDate, formatTime, nycToUtc, legsOf, serviceLabel, emailOk } from "./_trip.mjs";

const SESSIONS = "https://api.stripe.com/v1/checkout/sessions";
const TIMEOUT_MS = 10000;
const EXPIRES_AFTER_S = 1860;
const MAX_DESCRIPTION = 1000;
const MAX_VALUE = 500;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function encodeForm(object) {
  const params = new URLSearchParams();
  const walk = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${key}[${i}]`));
    else if (typeof value === "object") for (const [name, item] of Object.entries(value)) walk(item, key ? `${key}[${name}]` : name);
    else params.append(key, String(value));
  };
  walk(object, "");
  return params;
}

const passengerText = (count) => `${count} ${count === "1" ? "passenger" : "passengers"}`;
const quoted = (text) => {
  let kept = "";
  for (const ch of String(text).replace(/"/g, "'")) {
    if (kept.length + ch.length > 160) break;
    kept += ch;
  }
  return `"${kept}"`;
};
const legsFor = (trip) => trip.legs || legsOf(trip);

function fareDescription(trip, ref) {
  const back = trip.trip_type === "one" && trip.return ? ` Return ${formatDate(trip.return_date)}, ${formatTime(trip.return_time)}.` : "";
  return `${serviceLabel(trip)}. Reference ${ref}. ${formatDate(trip.date)}, ${formatTime(trip.time)}.${back} ${passengerText(trip.passengers)}.`;
}

function intentDescription(trip, ref) {
  const parts = [`${trip.date} ${trip.time} Reference ${ref}`, serviceLabel(trip), `Pickup ${quoted(trip.from_text)}`];
  if (trip.trip_type === "one") {
    if (trip.stop1_text) parts.push(`Stop 1 ${quoted(trip.stop1_text)}`);
    if (trip.stop2_text) parts.push(`Stop 2 ${quoted(trip.stop2_text)}`);
    parts.push(`Drop-off ${quoted(trip.to_text)}`);
    if (trip.return) parts.push(`Return ${trip.return_date} ${trip.return_time}`);
  }
  parts.push(passengerText(trip.passengers));
  if (trip.flight) parts.push(`Flight ${trip.flight}`);
  if (trip.return && trip.return_flight) parts.push(`Return flight ${trip.return_flight}`);
  if (trip.meet) parts.push(LABELS.meet);
  return `${parts.join(". ")}.`.slice(0, MAX_DESCRIPTION).replace(/[\ud800-\udbff]$/, "");
}

function descriptorSuffix(trip) {
  const first = legsFor(trip)[0];
  const code = trip.trip_type === "hour" || !first ? DESCRIPTOR_CODES.hourly : DESCRIPTOR_CODES[first.airport];
  const [, month, day] = trip.date.split("-");
  return `${code} ${MONTHS[Number(month) - 1]}${day}`;
}

export function metadataFor(trip, price, ref) {
  const hourly = trip.trip_type === "hour";
  const legs = legsFor(trip);
  const first = legs[0] || {};
  const end = (name, key) => (trip.ends && trip.ends[name] ? trip.ends[name][key] : "");
  const d = trip.details || {};
  const other = d.rider === "other";
  const values = {
    ref,
    service: hourly ? "hourly" : "airport",
    direction: hourly ? "" : first.direction,
    airport: hourly ? "" : first.airport,
    class: trip.class,
    vehicle: hourly ? trip.vehicle : "",
    hours: trip.hours,
    from_text: trip.from_text,
    from_zone: end("from", "zone"),
    from_place: end("from", "place"),
    to_text: trip.to_text,
    to_zone: end("to", "zone"),
    to_place: end("to", "place"),
    stop1_text: trip.stop1_text,
    stop1_zone: end("stop1", "zone"),
    stop2_text: trip.stop2_text,
    stop2_zone: end("stop2", "zone"),
    date: trip.date,
    time: trip.time,
    pickup_at: nycToUtc(trip.date, trip.time).toISOString(),
    return_date: trip.return ? trip.return_date : "",
    return_time: trip.return ? trip.return_time : "",
    return_at: trip.return ? nycToUtc(trip.return_date, trip.return_time).toISOString() : "",
    passengers: trip.passengers,
    flight: trip.flight,
    return_flight: trip.return ? trip.return_flight : "",
    meet: trip.meet ? "1" : "0",
    tip_percent: price.tipPercent,
    legs: hourly ? 0 : legs.length,
    fare_cents: price.fare,
    tax_cents: price.tax,
    bcf_cents: price.bcf,
    tolls_cents: price.tolls,
    meet_cents: price.meet,
    tip_cents: price.tip,
    total_cents: price.total,
    rider: d.rider,
    name: d.name,
    email: d.email,
    phone: d.phone,
    reach: d.reach,
    passenger_name: other ? d.pname : "",
    passenger_phone: other ? d.pphone : "",
    sign_name: price.meet ? d.sign || (other && d.pname) || d.name : "",
    notes: d.notes,
  };
  const metadata = {};
  for (const [key, value] of Object.entries(values)) {
    const text = Array.from(String(value ?? "").trim()).slice(0, MAX_VALUE).join("");
    if (text) metadata[key] = text;
  }
  return metadata;
}

function lineDescription(entry, i, trip, price, ref) {
  if (i === 0) return fareDescription(trip, ref);
  if (entry.label === LABELS.meet) return LABELS.meetDescription;
  if (price.tip && (entry.label === LABELS.gratuityAmount || entry.label === fill(LABELS.gratuity, { rate: price.tipPercent }))) return LABELS.gratuityDescription;
  return undefined;
}

export function sessionParams(trip, price, ref, settings, now, origin) {
  const hourly = trip.trip_type === "hour";
  const lineItems = price.lines.map((entry, i) => ({
    quantity: 1,
    price_data: { currency: "usd", unit_amount: entry.cents, product_data: { name: entry.label, description: lineDescription(entry, i, trip, price, ref) } },
  }));
  const d = trip.details || {};
  const afterSubmit = [TLC_BASE_LICENSE ? fill(CHECKOUT.license, { license: TLC_BASE_LICENSE }) : "", fill(CHECKOUT.afterSubmit, { ref })].filter(Boolean).join(" ");
  const metadata = metadataFor(trip, price, ref);
  const short = nycToUtc(trip.date, trip.time).getTime() < Number(now) + (MIN_NOTICE_HOURS * 3600 + EXPIRES_AFTER_S) * 1000;
  if (short) metadata.short_notice = "1";
  return encodeForm({
    mode: "payment",
    ui_mode: "hosted_page",
    submit_type: "book",
    customer_creation: "always",
    allowed_payment_method_types: ["card", "link"],
    adaptive_pricing: { enabled: false },
    customer_email: d.email && emailOk(d.email) ? d.email : undefined,
    phone_number_collection: d.phone ? undefined : { enabled: true },
    name_collection: d.name ? undefined : { individual: { enabled: true } },
    consent_collection: { terms_of_service: "required", payment_method_reuse_agreement: { position: "auto" } },
    custom_text: {
      terms_of_service_acceptance: { message: CHECKOUT.terms },
      submit: { message: hourly ? CHECKOUT.submitHourly : CHECKOUT.submit },
      after_submit: { message: afterSubmit },
    },
    line_items: lineItems,
    payment_intent_data: {
      setup_future_usage: "off_session",
      description: intentDescription(trip, ref),
      statement_descriptor_suffix: descriptorSuffix(trip),
      metadata,
    },
    metadata,
    client_reference_id: ref,
    success_url: `${origin}/booking-confirmed?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/book#resume`,
    expires_at: Math.floor(Number(now) / 1000) + EXPIRES_AFTER_S,
  });
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function call(url, init, key) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = parse(await res.text());
    return { ok: res.ok, status: res.status, body, requestId: res.headers.get("request-id") || "" };
  } catch {
    return { ok: false, status: 0, body: null, requestId: "" };
  }
}

export function createSession(params, key) {
  return call(SESSIONS, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }, key);
}

export function retrieveSession(id, key) {
  return call(`${SESSIONS}/${encodeURIComponent(id)}`, { method: "GET", headers: {} }, key);
}

export function expireSession(id, key) {
  return call(`${SESSIONS}/${encodeURIComponent(id)}/expire`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" }, key);
}
