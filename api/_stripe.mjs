import { VEHICLES, PLACES, DESCRIPTOR_CODES, TLC_BASE_LICENSE, STRIPE_VERSION } from "./_rates.mjs";
import { CHECKOUT, LABELS } from "./_copy.mjs";
import { fill, formatDate, formatTime, nycToUtc, route, fareLabel, gratuityPercent } from "./_trip.mjs";

const SESSIONS = "https://api.stripe.com/v1/checkout/sessions";
const TIMEOUT_MS = 10000;
const EXPIRES_AFTER_S = 1860;
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

const quotedPlace = (place, address) => (address ? `"${address.replace(/"/g, "'")}", ${PLACES[place]}` : PLACES[place]);
const passengerText = (count) => `${count} ${count === "1" ? "passenger" : "passengers"}`;

function productDescription(trip, ref) {
  const where =
    trip.trip_type === "hour"
      ? `Pickup ${PLACES[trip.from]}`
      : `${PLACES[trip.from]} to ${PLACES[trip.to]}`;
  return `${ref}. ${formatDate(trip.date)}, ${formatTime(trip.time)}. ${where}. ${passengerText(trip.passengers)}.`;
}

function intentDescription(trip, ref) {
  const { direction } = route(trip);
  const parts = [`${trip.date} ${trip.time} ${ref}`, fareLabel(trip, true)];
  if (direction === "from-airport") parts.push(`Drop-off ${quotedPlace(trip.to, trip.to_address)}`);
  else parts.push(`Pickup ${quotedPlace(trip.from, trip.from_address)}`);
  parts.push(passengerText(trip.passengers));
  if (trip.flight) parts.push(`Flight ${trip.flight}`);
  if (trip.meet) parts.push(LABELS.meet);
  return `${parts.join(". ")}.`.slice(0, 1000);
}

function descriptorSuffix(trip) {
  const code = trip.trip_type === "hour" ? DESCRIPTOR_CODES.hourly : DESCRIPTOR_CODES[route(trip).airport];
  const [, month, day] = trip.date.split("-");
  return `${code} ${MONTHS[Number(month) - 1]}${day}`;
}

export function metadataFor(trip, price, ref) {
  const hourly = trip.trip_type === "hour";
  const { airport, direction } = route(trip);
  const values = {
    ref,
    service: hourly ? "hourly" : "transfer",
    direction,
    airport,
    class: hourly ? VEHICLES[trip.vehicle].cls : trip.class,
    vehicle: trip.vehicle,
    hours: trip.hours,
    from: trip.from,
    from_address: trip.from_address,
    to: trip.to,
    to_address: trip.to_address,
    date: trip.date,
    time: trip.time,
    pickup_at: nycToUtc(trip.date, trip.time).toISOString(),
    passengers: trip.passengers,
    flight: trip.flight,
    meet: trip.meet ? "1" : "0",
    fare_cents: price.fare,
    meet_cents: price.meet,
    gratuity_cents: price.gratuity,
    tax_cents: price.tax,
    total_cents: price.total,
  };
  const metadata = {};
  for (const [key, value] of Object.entries(values)) {
    const text = String(value ?? "").trim().slice(0, 500);
    if (text) metadata[key] = text;
  }
  return metadata;
}

export function sessionParams(trip, price, ref, settings, now, origin) {
  const hourly = trip.trip_type === "hour";
  const taxed = Boolean(settings.taxOn) && price.taxable;
  const taxRates = taxed ? [settings.taxRateId] : undefined;
  const rate = gratuityPercent();
  const lineItems = [
    {
      quantity: hourly ? Number(trip.hours) : 1,
      price_data: {
        currency: "usd",
        unit_amount: hourly ? VEHICLES[trip.vehicle].hourly : price.fare,
        product_data: { name: fareLabel(trip, false), description: productDescription(trip, ref), unit_label: hourly ? "hour" : undefined },
      },
      tax_rates: taxRates,
    },
  ];
  if (price.meet) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: price.meet, product_data: { name: LABELS.meet, description: LABELS.meetDescription } },
      tax_rates: taxRates,
    });
  }
  lineItems.push({
    quantity: 1,
    price_data: { currency: "usd", unit_amount: price.gratuity, product_data: { name: fill(LABELS.gratuity, { rate }), description: LABELS.gratuityDescription } },
  });
  const field = (key, label) => ({ key, label: { type: "custom", custom: label }, type: "text", optional: true });
  const customFields = [field("passenger", CHECKOUT.passenger)];
  if (price.meet) customFields.push(field("signname", CHECKOUT.signName));
  customFields.push(field("notes", CHECKOUT.notes));
  const afterSubmit = [TLC_BASE_LICENSE ? fill(CHECKOUT.license, { license: TLC_BASE_LICENSE }) : "", fill(CHECKOUT.afterSubmit, { ref })].filter(Boolean).join(" ");
  const metadata = metadataFor(trip, price, ref);
  return encodeForm({
    mode: "payment",
    ui_mode: "hosted_page",
    submit_type: "book",
    customer_creation: "always",
    allowed_payment_method_types: ["card", "link"],
    adaptive_pricing: { enabled: false },
    phone_number_collection: { enabled: true },
    name_collection: { individual: { enabled: true } },
    consent_collection: { terms_of_service: "required", payment_method_reuse_agreement: { position: "auto" } },
    custom_text: {
      terms_of_service_acceptance: { message: CHECKOUT.terms },
      submit: { message: fill(taxed ? CHECKOUT.submitTaxed : CHECKOUT.submit, { rate }) },
      after_submit: { message: afterSubmit },
    },
    custom_fields: customFields,
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
