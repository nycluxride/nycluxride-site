import { createHash } from "node:crypto";
import {
  CLASSES,
  VEHICLES,
  CLASS_DEFAULT_VEHICLE,
  PLACES,
  ADDRESS_PLACES,
  AIRPORT_PLACES,
  HOURLY_START,
  AIRPORT_FARES,
  MEET_AND_GREET,
  GRATUITY_RATE,
  HOURS,
  PASSENGERS,
  MIN_NOTICE_HOURS,
  MAX_ADVANCE_DAYS,
  TAXABLE_AIRPORTS,
  CONTACT,
} from "./_rates.mjs";
import { LABELS, NOTES, MESSAGE } from "./_copy.mjs";

const FIELDS = ["trip_type", "from", "from_address", "to", "to_address", "date", "time", "passengers", "hours", "class", "vehicle", "meet", "flight", "action", "nonce", "nlr_hp"];
const NONCE = /^[A-Za-z0-9-]{16,64}$/;
const FLIGHT = /^[A-Za-z0-9 -]{1,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTEGER = /^\d+$/;
const TAX_PERCENT = /^\d{1,2}(\.\d{1,4})?$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

const has = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);
const isAirport = (place) => AIRPORT_PLACES.includes(place);
const isAddress = (place) => ADDRESS_PLACES.includes(place);
const isPlace = (place) => isAirport(place) || isAddress(place);
const codePoints = (text) => Array.from(text).length;
const addressOk = (text) => codePoints(text) >= 2 && codePoints(text) <= 200;
const canonical = (text) => (INTEGER.test(text) ? String(Number(text)) : text);

export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (has(values, name) ? String(values[name]) : match));
}

export function readSettings(env) {
  const taxRateId = String(env.SALES_TAX_RATE_ID || "").trim();
  const percent = String(env.SALES_TAX_PERCENT || "").trim();
  const taxPercent = TAX_PERCENT.test(percent) ? percent : "";
  return {
    paymentsEnabled: env.PAYMENTS_ENABLED === "true",
    blackout: String(env.PAY_BLACKOUT_DATES || "")
      .split(",")
      .map((date) => date.trim())
      .filter(Boolean),
    taxRateId,
    taxPercent,
    taxOn: Boolean(taxRateId && taxPercent),
    taxHalfSet: Boolean(taxRateId) !== Boolean(taxPercent),
  };
}

export function readInput(fields) {
  const raw = {};
  for (const name of FIELDS) {
    const value = fields && has(fields, name) && typeof fields[name] === "string" ? fields[name] : "";
    raw[name] = Array.from(value.replace(UNSAFE, " ").trim()).slice(0, 200).join("").trim();
  }
  const one = raw.trip_type === "one";
  const hour = raw.trip_type === "hour";
  const fromAirport = isAirport(raw.from);
  let cls = "";
  let vehicle = "";
  if (one) {
    if (has(CLASSES, raw.class)) cls = raw.class;
    else if (has(VEHICLES, raw.vehicle)) cls = VEHICLES[raw.vehicle].cls;
  }
  if (hour) {
    const key = raw.vehicle || raw.class;
    if (has(VEHICLES, raw.vehicle)) vehicle = raw.vehicle;
    else if (has(CLASS_DEFAULT_VEHICLE, key)) vehicle = CLASS_DEFAULT_VEHICLE[key];
  }
  return {
    trip_type: raw.trip_type,
    from: raw.from,
    from_address: isAddress(raw.from) ? raw.from_address : "",
    to: one ? raw.to : "",
    to_address: one && isAddress(raw.to) ? raw.to_address : "",
    date: raw.date,
    time: raw.time,
    passengers: canonical(raw.passengers),
    hours: hour ? canonical(raw.hours) : "",
    class: cls,
    vehicle,
    meet: raw.meet === "1" && fromAirport,
    flight: fromAirport ? raw.flight : "",
    action: raw.action === "quote" ? "quote" : "pay",
    nonce: NONCE.test(raw.nonce) ? raw.nonce : "",
    nlr_hp: raw.nlr_hp,
  };
}

export function route(trip) {
  if (trip.trip_type !== "one") return { airport: "", direction: "", end: "" };
  const fromAirport = isAirport(trip.from);
  const toAirport = isAirport(trip.to);
  if (fromAirport && !toAirport) return { airport: trip.from, direction: "from-airport", end: trip.to };
  if (toAirport && !fromAirport) return { airport: trip.to, direction: "to-airport", end: trip.from };
  return { airport: "", direction: "", end: "" };
}

function validDate(text) {
  if (!DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}

function offsetAt(ms) {
  const parts = {};
  for (const { type, value } of NEW_YORK.formatToParts(new Date(ms))) parts[type] = value;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return wall - Math.floor(ms / 1000) * 1000;
}

export function nycToUtc(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetAt(wall);
  let instant = wall - first;
  const second = offsetAt(instant);
  if (second !== first && offsetAt(wall - second) === second) instant = wall - second;
  return new Date(instant);
}

export function checkTrip(trip, now, settings) {
  const one = trip.trip_type === "one";
  const hour = trip.trip_type === "hour";
  const invalid = (code) => ({ kind: "invalid", code });
  const quote = (reason) => ({ kind: "quote", reason });
  if (trip.nlr_hp) return invalid("form");
  if (!one && !hour) return invalid("trip_type");
  if (!isPlace(trip.from)) return invalid("from");
  if (one && !isPlace(trip.to)) return invalid("to");
  if (isAddress(trip.from) && !addressOk(trip.from_address)) return invalid("from_address");
  if (one && isAddress(trip.to) && !addressOk(trip.to_address)) return invalid("to_address");
  if (!validDate(trip.date) || !TIME.test(trip.time)) return invalid("date");
  const pickup = nycToUtc(trip.date, trip.time).getTime();
  const current = Number(now);
  if (pickup <= current) return invalid("date-past");
  const passengers = Number(trip.passengers);
  if (!INTEGER.test(trip.passengers) || passengers < PASSENGERS.min || passengers > PASSENGERS.max) return invalid("passengers");
  if (hour && !INTEGER.test(trip.hours)) return invalid("hours");
  if (one && !has(CLASSES, trip.class)) return invalid("class");
  if (hour && !has(VEHICLES, trip.vehicle)) return invalid("vehicle");
  if (trip.flight && !FLIGHT.test(trip.flight)) return invalid("flight");
  if (!settings.paymentsEnabled || (settings.blackout || []).includes(trip.date) || settings.taxHalfSet) return quote("paused");
  if (pickup < current + MIN_NOTICE_HOURS * HOUR_MS) return quote("short-notice");
  if (pickup > current + MAX_ADVANCE_DAYS * DAY_MS) return quote("far-ahead");
  const cls = one ? trip.class : VEHICLES[trip.vehicle].cls;
  if (passengers > CLASSES[cls].seats) return quote("seats");
  if (one) {
    if (isAirport(trip.from) && isAirport(trip.to)) return quote("airport-to-airport");
    const { airport, end } = route(trip);
    if (!airport) return quote("no-airport");
    if (end === "outside") return quote("outside-city");
    if (!has(AIRPORT_FARES, trip.class) || !has(AIRPORT_FARES[trip.class], airport)) {
      return quote(trip.class === "first" && airport === "lga" ? "first-lga" : "class-airport");
    }
    return { kind: "price" };
  }
  if (!HOURLY_START.includes(trip.from)) return quote("outside-hourly");
  const hours = Number(trip.hours);
  if (hours < HOURS.min || hours > HOURS.max) return quote("hours-range");
  if (VEHICLES[trip.vehicle].hourly === null) return quote("sprinter-hourly");
  return { kind: "price" };
}

export function vehicleLabel(key) {
  const { cls, model } = VEHICLES[key];
  return model ? `${model} (${CLASSES[cls].name})` : CLASSES[cls].name;
}

export function placeText(place, address) {
  return address ? `${address}, ${PLACES[place]}` : PLACES[place];
}

export function gratuityPercent() {
  return Number((GRATUITY_RATE * 100).toFixed(4));
}

export function fareLabel(trip, withHours) {
  if (trip.trip_type === "hour") {
    return fill(withHours ? LABELS.hourlyLine : LABELS.hourly, { vehicle: vehicleLabel(trip.vehicle), hours: trip.hours });
  }
  const { airport, direction } = route(trip);
  return fill(direction === "to-airport" ? LABELS.to : LABELS.from, { airport: PLACES[airport], class: CLASSES[trip.class].name });
}

function taxLabel(percent) {
  return percent ? fill(LABELS.tax, { percent }) : LABELS.tax.split(" (")[0];
}

export function priceTrip(trip, settings) {
  const hourly = trip.trip_type === "hour";
  const { airport } = route(trip);
  const fare = hourly ? VEHICLES[trip.vehicle].hourly * Number(trip.hours) : AIRPORT_FARES[trip.class][airport];
  const meet = trip.meet ? MEET_AND_GREET : 0;
  const gratuity = Math.round(fare * GRATUITY_RATE);
  const taxable = hourly || TAXABLE_AIRPORTS.includes(airport);
  const taxed = Boolean(settings.taxOn) && taxable;
  const micro = taxed ? Math.round(Number(settings.taxPercent) * 10000) : 0;
  const tax = taxed ? Math.round((fare * micro) / 1000000) + Math.round((meet * micro) / 1000000) : 0;
  const lines = [{ label: fareLabel(trip, true), cents: fare }];
  if (meet) lines.push({ label: LABELS.meet, cents: meet });
  lines.push({ label: fill(LABELS.gratuity, { rate: gratuityPercent() }), cents: gratuity });
  if (taxed) lines.push({ label: taxLabel(settings.taxPercent), cents: tax });
  return {
    fare,
    meet,
    gratuity,
    tax,
    total: fare + meet + gratuity + tax,
    value: fare + meet,
    taxable,
    lines,
    notes: [taxed ? NOTES.afterTaxed : NOTES.after],
  };
}

export function bookingRef(nonce) {
  const head = createHash("sha256").update(String(nonce)).digest().readUInt32BE(0);
  let code = "";
  for (let i = 0; i < 6; i++) code += CROCKFORD[(head >>> (27 - 5 * i)) & 31];
  return `NLR-${code}`;
}

export function formatDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function composeMessage(trip, ref) {
  const one = trip.trip_type === "one";
  const hour = trip.trip_type === "hour";
  const lines = [MESSAGE.intro, `Reference: ${ref}`];
  if (one) lines.push("Trip: One way");
  if (hour && trip.hours) lines.push(`Trip: By the hour, ${trip.hours} ${trip.hours === "1" ? "hour" : "hours"}`);
  if (isPlace(trip.from)) lines.push(`Pickup: ${placeText(trip.from, trip.from_address)}`);
  if (one && isPlace(trip.to)) lines.push(`Drop-off: ${placeText(trip.to, trip.to_address)}`);
  if (validDate(trip.date)) lines.push(`Date: ${formatDate(trip.date)}`);
  if (TIME.test(trip.time)) lines.push(`Time: ${formatTime(trip.time)}`);
  if (trip.passengers) lines.push(`Passengers: ${trip.passengers}`);
  if (one && has(CLASSES, trip.class)) lines.push(`Vehicle: ${CLASSES[trip.class].name}`);
  if (hour && has(VEHICLES, trip.vehicle)) lines.push(`Vehicle: ${vehicleLabel(trip.vehicle)}`);
  if (trip.meet) lines.push("Meet and greet: Yes");
  if (trip.flight) lines.push(`Flight: ${trip.flight}`);
  return lines.join("\n");
}

export function contactLinks(trip, ref) {
  const mail = `mailto:${CONTACT.email}`;
  if (!trip) return { whatsapp: CONTACT.whatsapp, mailto: mail, tel: CONTACT.tel };
  const text = encodeURIComponent(composeMessage(trip, ref));
  return {
    whatsapp: `${CONTACT.whatsapp}?text=${text}`,
    mailto: `${mail}?subject=${encodeURIComponent(fill(MESSAGE.subject, { ref }))}&body=${text}`,
    tel: CONTACT.tel,
  };
}

export function receipt(metadata, settings, taxCents) {
  const trip = {
    trip_type: metadata.service === "hourly" ? "hour" : "one",
    from: metadata.from || "",
    to: metadata.to || "",
    class: metadata.class || "",
    vehicle: metadata.vehicle || "",
    hours: metadata.hours || "",
    date: metadata.date || "",
    time: metadata.time || "",
  };
  const known =
    validDate(trip.date) &&
    TIME.test(trip.time) &&
    (trip.trip_type === "hour" ? has(VEHICLES, trip.vehicle) && INTEGER.test(trip.hours) : has(CLASSES, trip.class) && Boolean(route(trip).airport));
  const cents = (key) => (INTEGER.test(metadata[key] || "") ? Number(metadata[key]) : 0);
  const tax = Number.isInteger(taxCents) ? taxCents : cents("tax_cents");
  const lines = [];
  if (known) lines.push({ label: fareLabel(trip, true), cents: cents("fare_cents") });
  if (known && cents("meet_cents")) lines.push({ label: LABELS.meet, cents: cents("meet_cents") });
  if (known) lines.push({ label: fill(LABELS.gratuity, { rate: gratuityPercent() }), cents: cents("gratuity_cents") });
  if (known && tax) lines.push({ label: taxLabel(settings.taxPercent), cents: tax });
  return {
    summary: known ? fill(LABELS.summary, { date: formatDate(trip.date), time: formatTime(trip.time), service: fareLabel(trip, true) }) : "",
    lines,
    value: cents("fare_cents") + cents("meet_cents"),
    notes: [tax ? NOTES.afterTaxed : NOTES.after],
  };
}
