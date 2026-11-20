import { createHmac, timingSafeEqual } from "node:crypto";
import { DESCRIPTOR_CODES, TLC_BASE_LICENSE, STRIPE_VERSION, PAID_NOTICE_MINUTES } from "./_rates.mjs";
import { CHECKOUT, LABELS } from "./_copy.mjs";
import { fill, formatDate, formatTime, nycToUtc, legsOf, serviceLabel, serviceOf, airportDistance, flatPart, tollsIn, rideTotals, emailOk, seatText, seatMeta, dogText, dogMeta, endMeta, bookingData, shownLines, chargedTrip, ownerSubject, shortPlace, placeText } from "./_trip.mjs";
import { production, clean } from "./_http.mjs";

const API = "https://api.stripe.com/v1";
const SESSIONS = `${API}/checkout/sessions`;
const TIMEOUT_MS = 10000;
const KEY_SHAPE = /^(rk|sk)_(live|test)_\S{10,}$/;
const LIVE_KEY = /^(rk|sk)_live_/;
const RESTRICTED_KEY = /^rk_/;
const SIGNATURE_TOLERANCE_S = 300;
const EXPIRES_AFTER_S = 1860;
const MAX_DESCRIPTION = 1000;
const MAX_VALUE = 500;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const PLACE_LABELS = [["from", "Pickup"], ["stop1", "Stop 1"], ["stop2", "Stop 2"], ["to", "Drop-off"]];
const PLACE_LIMITS = [160, 80, 40];
const NOTE_LEAD = " Note: ";
const NOTE_ROOM = 40;

export const secretKey = () => String(process.env.STRIPE_SECRET_KEY || "").trim();
export const liveKey = () => LIVE_KEY.test(secretKey());

export function keyProblem() {
  const key = secretKey();
  if (!key) return "key-missing";
  if (!KEY_SHAPE.test(key) || (LIVE_KEY.test(key) && !RESTRICTED_KEY.test(key))) return "key-shape";
  if (LIVE_KEY.test(key) !== production()) return "key-environment";
  return "";
}

export function stripeKey() {
  const problem = keyProblem();
  if (problem) console.error(problem);
  return problem ? "" : secretKey();
}

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
const quoted = (text, max) => {
  let kept = "";
  for (const ch of String(text).replace(/"/g, "'")) {
    if (kept.length + ch.length > max) break;
    kept += ch;
  }
  return `"${kept}"`;
};
const legsFor = (trip) => trip.legs || legsOf(trip);
const plain = (text) => clean(String(text ?? ""), MAX_DESCRIPTION).replace(/\s+/g, " ");
const cut = (text, max) => text.slice(0, max).replace(/[\ud800-\udbff]$/, "");
const sentence = (part) => {
  const text = part.replace(/\.+$/, "");
  return /[!?]$/.test(text) ? text : `${text}.`;
};

function fareDescription(trip, ref) {
  const back = trip.trip_type === "one" && trip.return ? ` Return ${formatDate(trip.return_date)}, ${formatTime(trip.return_time)}.` : "";
  return `${serviceLabel(trip)}. Reference ${ref}. ${formatDate(trip.date)}, ${formatTime(trip.time)}.${back} ${passengerText(trip.passengers)}.`;
}

function intentDescription(trip, metadata, ref) {
  const f = (name) => plain(metadata[name]);
  const parts = [plain(ownerSubject(metadata, ref))];
  if (f("name")) parts.push(`Customer ${f("name")}`);
  if (f("phone")) parts.push(`Phone ${f("phone")}`);
  if (f("email")) parts.push(`Email ${f("email")}`);
  if (f("passenger_name")) parts.push(`Passenger ${f("passenger_name")}`);
  if (f("passenger_phone")) parts.push(`Passenger phone ${f("passenger_phone")}`);
  if (f("flight")) parts.push(`Flight ${f("flight")}`);
  if (f("return_flight")) parts.push(`Return flight ${f("return_flight")}`);
  parts.push(passengerText(trip.passengers));
  if (seatText(trip)) parts.push(seatText(trip));
  if (dogText(trip)) parts.push(dogText(trip));
  if (trip.meet) parts.push(LABELS.meet);
  const places = PLACE_LABELS.filter(([name]) => f(`${name}_text`) && (name.startsWith("stop") || shortPlace(metadata[`${name}_text`], metadata[`${name}_zone`]) !== placeText(metadata[`${name}_text`])));
  const headWith = (max) => [...parts, ...places.map(([name, label]) => `${label} ${quoted(f(`${name}_text`), max)}`)].map(sentence).join(" ");
  const notes = f("notes").replace(/\.+$/, "");
  const want = notes ? NOTE_LEAD.length + 1 + Math.min(notes.length, NOTE_ROOM) : 0;
  const head = PLACE_LIMITS.map(headWith).find((text) => text.length + want <= MAX_DESCRIPTION) || headWith(PLACE_LIMITS.at(-1));
  const room = MAX_DESCRIPTION - head.length - NOTE_LEAD.length - 1;
  const note = room > 0 ? cut(notes, room).trim().replace(/\.+$/, "") : "";
  return cut(note ? `${head}${NOTE_LEAD}${sentence(note)}` : head, MAX_DESCRIPTION);
}

function descriptorSuffix(trip) {
  const first = legsFor(trip)[0];
  const code = trip.trip_type === "hour" || !first ? DESCRIPTOR_CODES.hourly : first.ride ? DESCRIPTOR_CODES.distance : DESCRIPTOR_CODES[first.airport];
  const [, month, day] = trip.date.split("-");
  return `${code} ${MONTHS[Number(month) - 1]}${day}`;
}

export function metadataFor(input, price, ref) {
  const trip = chargedTrip(input);
  const hourly = trip.trip_type === "hour";
  const legs = legsFor(trip);
  const first = legs[0] || {};
  const d = trip.details || {};
  const other = d.rider === "other";
  const ride = rideTotals(trip);
  const values = {
    ref,
    service: serviceOf(trip),
    direction: hourly ? "" : first.direction,
    airport: hourly ? "" : first.airport,
    class: trip.class,
    vehicle: hourly ? trip.vehicle : "",
    hours: trip.hours,
    from_text: trip.from_text,
    to_text: trip.to_text,
    stop1_text: trip.stop1_text,
    stop2_text: trip.stop2_text,
    zones: endMeta(trip.ends, ["from", "stop1", "stop2", "to"], "zone"),
    places: endMeta(trip.ends, ["from", "to"], "place", MAX_VALUE),
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
    miles: ride ? (ride.tenths / 10).toFixed(1) : "",
    minutes: ride ? ride.minutes : "",
    fare_cents: price.fare,
    tax_cents: price.tax,
    bcf_cents: price.bcf,
    tolls_cents: price.tolls,
    tolls_est_cents: Number.isInteger(price.estimate) ? price.estimate : "",
    stops_cents: price.stops || "",
    meet_cents: price.meet,
    seats: price.seats ? seatMeta(trip) : "",
    seats_cents: price.seats || "",
    dogs: price.dogs ? dogMeta(price) : "",
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
  if (price.seats && entry.label === price.seatLabel) return `${seatText(trip)}.`;
  if (price.dogs && price.dogLabels.includes(entry.label)) return LABELS.dogDescription;
  if (price.tip && (entry.label === LABELS.gratuityAmount || entry.label === fill(LABELS.gratuity, { rate: price.tipPercent }))) return LABELS.gratuityDescription;
  return undefined;
}

function submitText(trip, hourly) {
  const flat = flatPart(trip);
  if (hourly) return CHECKOUT.submitHourly;
  if (tollsIn(trip)) return flat ? CHECKOUT.submitFlatTolled : airportDistance(trip) ? CHECKOUT.submitOutsideTolled : CHECKOUT.submitDistanceTolled;
  return flat === "return" ? CHECKOUT.submitReturnFlat : flat === "out" ? CHECKOUT.submitOutFlat : airportDistance(trip) ? CHECKOUT.submitOutside : serviceOf(trip) === "distance" ? CHECKOUT.submitDistance : CHECKOUT.submit;
}

export function sessionParams(input, price, ref, settings, now, origin) {
  const trip = chargedTrip(input);
  const hourly = trip.trip_type === "hour";
  const lineItems = shownLines(price.lines).map((entry, i) => ({
    quantity: 1,
    price_data: { currency: "usd", unit_amount: entry.cents, product_data: { name: entry.label, description: lineDescription(entry, i, trip, price, ref) } },
  }));
  const d = trip.details || {};
  const afterSubmit = [TLC_BASE_LICENSE ? fill(CHECKOUT.license, { license: TLC_BASE_LICENSE }) : "", fill(CHECKOUT.afterSubmit, { ref })].filter(Boolean).join(" ");
  const metadata = metadataFor(trip, price, ref);
  const expires = Math.floor(Number(now) / 1000) + EXPIRES_AFTER_S;
  const short = nycToUtc(trip.date, trip.time).getTime() < (expires + PAID_NOTICE_MINUTES * 60) * 1000;
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
      submit: { message: submitText(trip, hourly) },
      after_submit: { message: afterSubmit },
    },
    line_items: lineItems,
    payment_intent_data: {
      setup_future_usage: "off_session",
      description: intentDescription(trip, bookingData(metadata), ref),
      statement_descriptor_suffix: descriptorSuffix(trip),
      metadata,
    },
    metadata,
    client_reference_id: ref,
    success_url: `${origin}/booking-confirmed?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/book#resume`,
    expires_at: expires,
  });
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function call(url, init, key, timeout = TIMEOUT_MS) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION, ...init.headers },
      signal: AbortSignal.timeout(timeout),
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

export function retrieveSession(id, key, timeout) {
  return call(`${SESSIONS}/${encodeURIComponent(id)}`, { method: "GET", headers: {} }, key, timeout);
}

export function sessionsForIntent(intent, key, timeout) {
  return call(`${SESSIONS}?${new URLSearchParams({ payment_intent: intent })}`, { method: "GET", headers: {} }, key, timeout);
}

export function expireSession(id, key) {
  return call(`${SESSIONS}/${encodeURIComponent(id)}/expire`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" }, key);
}

export function updateMetadata(object, id, values, key, idempotency, timeout) {
  const body = new URLSearchParams(Object.entries(values).map(([name, value]) => [`metadata[${name}]`, value]));
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotency };
  return call(`${API}/${object}/${encodeURIComponent(id)}`, { method: "POST", headers, body: body.toString() }, key, timeout);
}

export function signatureOk(header, payload, secret, now = Date.now()) {
  if (typeof header !== "string" || header.length > 4096 || !secret) return false;
  let stamp = null;
  const signatures = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t" && stamp === null && /^\d{1,12}$/.test(value)) stamp = value;
    else if (name === "v1" && /^[0-9a-f]{64}$/.test(value)) signatures.push(Buffer.from(value, "hex"));
  }
  if (stamp === null || !signatures.length || Math.abs(now / 1000 - Number(stamp)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${stamp}.`).update(payload).digest();
  return signatures.reduce((ok, signature) => timingSafeEqual(signature, expected) || ok, false);
}
