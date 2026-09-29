import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  CLASSES,
  VEHICLES,
  CLASS_DEFAULT_VEHICLE,
  PLACES,
  AIRPORT_PLACES,
  HOURLY_START,
  AIRPORT_FARES,
  AIRPORT_TOTALS,
  NYC_TAX_PERCENT,
  BCF_PERCENT,
  TIP_PERCENTS,
  TIP_CUSTOM,
  percentCents,
  MEET_AND_GREET,
  HOURS,
  PASSENGERS,
  MIN_NOTICE_HOURS,
  AUTO_LEAD_MINUTES,
  MAX_ADVANCE_DAYS,
  CONTACT,
} from "./_rates.mjs";
import { LABELS, NOTES, POLICY, MESSAGE } from "./_copy.mjs";
import { AIRPORT_ZONES, AREA_LABELS, norm, classifyText, classifyPlace, localById } from "./_places.mjs";
import { TICKET, TICKET_TTL, verifyTicket } from "./_ticket.mjs";
import { clean, clientBudget, instanceBudget, production } from "./_http.mjs";
import { googleOn, placeDetails } from "./_google.mjs";
import { readPhone } from "./_phone.mjs";

const ENDS = ["from", "stop1", "stop2", "to"];
const FIELDS = ["trip_type", "date", "time", "flight", "return", "return_date", "return_time", "return_flight", "passengers", "hours", "class", "vehicle", "meet", "tip", "tip_amount", "action", "nonce", "nlr_hp"];
const ACTIONS = ["options", "quote", "pay"];
const BOROUGHS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island"];
const NONCE = /^[A-Za-z0-9-]{16,64}$/;
const FLIGHT = /^[A-Za-z0-9 -]{1,20}$/;
const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTEGER = /^\d+$/;
const LOCAL_ID = /^[a-z0-9-]{2,24}$/;
const MAX_TEXT = 200;
const MAX_TICKET = 520;
const PICK_IP = 15;
const PICK_INSTANCE = 100;
const PLACE_ZONES = 1000;
const placeZones = new Map();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE_MS = 60000;
const SLOT_MS = 10 * MINUTE_MS;
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
const canonical = (text) => (INTEGER.test(text) ? String(Number(text)) : text);
const tipAmountOk = (amount) => INTEGER.test(amount) && Number(amount) * 100 >= TIP_CUSTOM.min && Number(amount) * 100 <= TIP_CUSTOM.max;
const line = (label, cents) => ({ label, cents });
const taxLabel = () => fill(LABELS.tax, { percent: NYC_TAX_PERCENT });
const bcfLabel = () => fill(LABELS.bcf, { percent: BCF_PERCENT });
const tipLabel = (rate) => fill(LABELS.gratuity, { rate });

export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (has(values, name) ? String(values[name]) : match));
}

export const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export function validDate(text) {
  if (typeof text !== "string" || !DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}

export function readSettings(env) {
  const entries = String(env.PAY_BLACKOUT_DATES || "").split(/[\s,;]+/).filter(Boolean);
  return {
    paymentsEnabled: env.PAYMENTS_ENABLED === "true",
    blackout: entries.filter(validDate),
    blackoutBad: entries.some((date) => !validDate(date)),
  };
}

export function readInput(fields) {
  const value = (name, max) => clean(fields && has(fields, name) ? fields[name] : "", max);
  const raw = {};
  for (const name of FIELDS) raw[name] = value(name, MAX_TEXT);
  const one = raw.trip_type === "one";
  const hour = raw.trip_type === "hour";
  const action = ACTIONS.includes(raw.action) ? raw.action : "pay";
  const trip = { trip_type: raw.trip_type };
  for (const end of ENDS) {
    const keep = end === "from" || one;
    const id = keep ? value(`${end}_id`, 64) : "";
    const ticket = keep ? value(`${end}_ticket`, MAX_TICKET + 1) : "";
    trip[`${end}_text`] = keep ? value(`${end}_text`, MAX_TEXT) : "";
    trip[`${end}_id`] = LOCAL_ID.test(id) ? id : "";
    trip[`${end}_ticket`] = ticket.length <= MAX_TICKET && TICKET.test(ticket) ? ticket : "";
  }
  const back = one && raw.return === "1";
  let cls = has(CLASSES, raw.class) ? raw.class : "";
  if (!cls && action === "options") cls = "suv";
  const suvVehicle = has(VEHICLES, raw.vehicle) && VEHICLES[raw.vehicle].cls === "suv" ? raw.vehicle : CLASS_DEFAULT_VEHICLE.suv;
  const tips = TIP_PERCENTS.map(String);
  const rider = value("rider", 8) || "me";
  const other = rider === "other";
  const country = (name) => (value(name, 8) || "US").toUpperCase();
  const phoneCountry = country("phone_cc");
  const passengerCountry = other ? country("pphone_cc") : "";
  trip.details = {
    rider,
    name: value("name", 80),
    email: value("email", 254),
    phone: readPhone(value("phone", 64), phoneCountry).text,
    phone_cc: phoneCountry,
    reach: value("reach", 16) || "phone",
    pname: other ? value("pname", 80) : "",
    pphone: other ? readPhone(value("pphone", 64), passengerCountry).text : "",
    pphone_cc: passengerCountry,
    sign: value("sign", 45),
    notes: has(fields || {}, "notes") && typeof fields.notes === "string" ? Array.from(fields.notes.replace(/\r\n?/g, "\n").split("\n").map((part) => clean(part, 500)).filter(Boolean).join("\n")).slice(0, 500).join("") : "",
  };
  return Object.assign(trip, {
    date: raw.date,
    time: raw.time,
    flight: raw.flight,
    return: back,
    return_date: back ? raw.return_date : "",
    return_time: back ? raw.return_time : "",
    return_flight: back ? raw.return_flight : "",
    passengers: canonical(raw.passengers),
    hours: hour ? canonical(raw.hours) : "",
    class: cls,
    vehicle: hour && cls ? (cls === "suv" ? suvVehicle : CLASS_DEFAULT_VEHICLE[cls]) : "",
    suvVehicle: hour ? suvVehicle : "",
    meet: raw.meet === "1",
    tip: raw.tip === "" ? 0 : raw.tip === "custom" ? "custom" : tips.includes(raw.tip) ? Number(raw.tip) : null,
    tip_amount: raw.tip === "custom" ? canonical(raw.tip_amount) : "",
    action,
    nonce: NONCE.test(raw.nonce) ? raw.nonce : "",
    nlr_hp: raw.nlr_hp,
    from: "",
    to: "",
    ends: null,
    legs: null,
    meetOffered: false,
  });
}

function offsetAt(ms) {
  const parts = {};
  for (const { type, value } of NEW_YORK.formatToParts(new Date(ms))) parts[type] = value;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return wall - Math.floor(ms / 1000) * 1000;
}

function wallTime(ms) {
  const parts = {};
  for (const { type, value } of NEW_YORK.formatToParts(new Date(ms))) parts[type] = value;
  const two = (value) => String(Number(value)).padStart(2, "0");
  return `${parts.year}-${two(parts.month)}-${two(parts.day)} ${two(Number(parts.hour) % 24)}:${two(parts.minute)}`;
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

function clockChange(date, time) {
  const at = nycToUtc(date, time).getTime();
  const asked = `${date} ${time}`;
  return wallTime(at) !== asked || wallTime(at + HOUR_MS) === asked;
}

export function firstSlot(now) {
  for (let at = Math.ceil((Number(now) + MIN_NOTICE_HOURS * HOUR_MS + AUTO_LEAD_MINUTES * MINUTE_MS) / SLOT_MS) * SLOT_MS; ; at += SLOT_MS) {
    const [date, time] = wallTime(at).split(" ");
    if (!clockChange(date, time)) return { date, time };
  }
}

function endsOf(trip) {
  if (trip.ends) return trip.ends;
  const end = (zone) => (zone ? { text: "", zone, place: "", id: "" } : null);
  return { from: end(trip.from), stop1: null, stop2: null, to: trip.trip_type === "one" ? end(trip.to) : null };
}

function leg(from, to, back) {
  const fromAirport = AIRPORT_ZONES.includes(from);
  const toAirport = AIRPORT_ZONES.includes(to);
  let reason = "";
  if (from === "unknown" || to === "unknown") reason = "unplaced";
  else if (fromAirport && toAirport) reason = "airport-to-airport";
  else if (!fromAirport && !toAirport) reason = "no-airport";
  else if (from === "airport-other" || to === "airport-other") reason = "other-airport";
  else if (!BOROUGHS.includes(fromAirport ? to : from)) reason = "outside-city";
  return {
    from,
    to,
    airport: fromAirport ? from : toAirport ? to : "",
    direction: fromAirport && !toAirport ? "from-airport" : toAirport && !fromAirport ? "to-airport" : "",
    back,
    reason,
  };
}

export function legsOf(trip) {
  if (trip.trip_type !== "one") return [];
  const ends = endsOf(trip);
  const points = ENDS.map((name) => ends[name]).filter(Boolean);
  const legs = [];
  for (let i = 1; i < points.length; i++) legs.push(leg(points[i - 1].zone, points[i].zone, false));
  if (trip.return && ends.from && ends.to) legs.push(leg(ends.to.zone, ends.from.zone, true));
  return legs;
}

export async function resolveEnd(end, trip, context = {}) {
  const text = trip[`${end}_text`] || "";
  if (!text) return null;
  const now = context.now === undefined ? Date.now() : Number(context.now);
  const ticket = trip[`${end}_ticket`] ? verifyTicket(trip[`${end}_ticket`], text, now) : null;
  if (ticket && !ticket.expired) return { text, zone: ticket.zone, place: ticket.id, id: "" };
  if (ticket && googleOn()) {
    const known = placeZones.get(ticket.id);
    if (known && known.until > now) return { text, zone: known.zone, place: ticket.id, id: "" };
    const allowed = (!context.request || clientBudget(context.request, "places-pick", PICK_IP)) && instanceBudget("places-pick", PICK_INSTANCE);
    const result = allowed ? await placeDetails(ticket.id, "") : { ok: false, status: 429 };
    if (result.ok) {
      const zone = classifyPlace(result.details, text);
      placeZones.delete(ticket.id);
      placeZones.set(ticket.id, { zone, until: now + TICKET_TTL * 1000 });
      if (placeZones.size > PLACE_ZONES) placeZones.delete(placeZones.keys().next().value);
      return { text, zone, place: ticket.id, id: "" };
    }
    console.error("places-pick", result.status);
  }
  const row = localById(trip[`${end}_id`]);
  if (row && norm(row.label) === norm(text)) return { text, zone: row.zone, place: row.id, id: row.id };
  const { zone, id } = classifyText(text);
  return { text, zone, place: id, id };
}

export async function resolveTrip(trip, context = {}) {
  const names = trip.trip_type === "one" ? ENDS : ["from"];
  const found = await Promise.all(names.map((name) => resolveEnd(name, trip, context)));
  const ends = { from: null, stop1: null, stop2: null, to: null };
  names.forEach((name, i) => {
    ends[name] = found[i];
  });
  const from = ends.from ? ends.from.zone : "";
  const to = ends.to ? ends.to.zone : "";
  const meetOffered = AIRPORT_PLACES.includes(from) && (trip.trip_type === "one" || HOURLY_START.includes(from));
  const resolved = {
    ...trip,
    ends,
    from,
    to,
    flight: AIRPORT_ZONES.includes(from) ? trip.flight : "",
    return_flight: trip.return && AIRPORT_ZONES.includes(to) ? trip.return_flight : "",
    meet: Boolean(trip.meet) && meetOffered,
    meetOffered,
  };
  resolved.legs = legsOf(resolved);
  return resolved;
}

function vehicleFor(trip, cls) {
  if (cls === trip.class && has(VEHICLES, trip.vehicle)) return trip.vehicle;
  if (cls === "suv" && has(VEHICLES, trip.suvVehicle)) return trip.suvVehicle;
  return CLASS_DEFAULT_VEHICLE[cls];
}

export function classReason(trip, cls) {
  if (!has(CLASSES, cls)) return "";
  if (trip.trip_type === "hour" && VEHICLES[vehicleFor(trip, cls)].hourly === null) return "sprinter-hourly";
  if (Number(trip.passengers) > CLASSES[cls].seats) return "seats";
  return "";
}

function spatialReason(trip) {
  if (trip.trip_type === "hour") {
    if (trip.from === "unknown") return { reason: "unplaced", field: "from_text" };
    if (!HOURLY_START.includes(trip.from)) return { reason: "outside-hourly", field: "" };
    const hours = Number(trip.hours);
    if (hours < HOURS.min || hours > HOURS.max) return { reason: "hours-range", field: "" };
    return null;
  }
  const ends = endsOf(trip);
  for (const name of ENDS) if (ends[name] && ends[name].zone === "unknown") return { reason: "unplaced", field: `${name}_text` };
  const legs = trip.legs || legsOf(trip);
  if (!legs.length) return { reason: "unplaced", field: "from_text" };
  const unpriced = legs.find((item) => item.reason);
  if (!unpriced) return null;
  return { reason: ends.stop1 || ends.stop2 ? "stop-leg" : unpriced.reason, field: "" };
}

function holdFor(trip, current, settings) {
  const times = [[trip.date, trip.time]];
  if (trip.trip_type === "one" && trip.return) times.push([trip.return_date, trip.return_time]);
  const blackout = settings.blackout || [];
  if (!settings.paymentsEnabled || settings.blackoutBad || times.some(([date]) => blackout.includes(date))) return "paused";
  if (times.some(([date, time]) => clockChange(date, time))) return "clock-change";
  const pickups = times.map(([date, time]) => nycToUtc(date, time).getTime());
  if (Math.min(...pickups) < current + MIN_NOTICE_HOURS * HOUR_MS) return "short-notice";
  if (Math.max(...pickups) > current + MAX_ADVANCE_DAYS * DAY_MS) return "far-ahead";
  return "";
}

export function checkTrip(trip, now, settings) {
  const one = trip.trip_type === "one";
  const hour = trip.trip_type === "hour";
  const invalid = (code) => ({ kind: "invalid", code });
  if (trip.nlr_hp) return invalid("form");
  if (!one && !hour) return invalid("trip_type");
  if (!trip.from_text) return invalid("from");
  if (one && !trip.to_text) return invalid("to");
  if (!validDate(trip.date) || !TIME.test(trip.time)) return invalid("date");
  const current = Number(now);
  const pickup = nycToUtc(trip.date, trip.time).getTime();
  if (pickup <= current) return invalid("date-past");
  if (one && trip.return) {
    if (!validDate(trip.return_date) || !TIME.test(trip.return_time)) return invalid("return-date");
    if (nycToUtc(trip.return_date, trip.return_time).getTime() <= pickup) return invalid("return-date");
  }
  const passengers = Number(trip.passengers);
  if (!INTEGER.test(trip.passengers) || passengers < PASSENGERS.min || passengers > PASSENGERS.max) return invalid("passengers");
  if (hour && !INTEGER.test(trip.hours)) return invalid("hours");
  if (!has(CLASSES, trip.class)) return invalid("class");
  if (hour && !has(VEHICLES, trip.vehicle)) return invalid("vehicle");
  if (trip.flight && !FLIGHT.test(trip.flight)) return invalid("flight");
  if (one && trip.return && trip.return_flight && !FLIGHT.test(trip.return_flight)) return invalid("return_flight");
  if (trip.tip === "custom" && !tipAmountOk(trip.tip_amount)) return invalid("tip_amount");
  if (trip.tip !== "custom" && !TIP_PERCENTS.includes(trip.tip)) return invalid("tip");
  const spatial = spatialReason(trip);
  if (spatial) return { kind: "quote", reason: spatial.reason, field: spatial.field };
  return { kind: "price", reason: classReason(trip, trip.class), hold: holdFor(trip, current, settings) };
}

export const emailOk = (text) => text.length <= 254 && EMAIL.test(text);

export function checkDetails(trip, required) {
  const d = trip.details;
  const invalid = (code) => ({ kind: "invalid", code });
  const other = d.rider === "other";
  if (d.rider !== "me" && !other) return invalid("rider");
  if (d.reach !== "phone" && d.reach !== "whatsapp") return invalid("reach");
  if ((required || d.name) && Array.from(d.name).length < 2) return invalid("name");
  if ((required || d.email) && !emailOk(d.email)) return invalid("email");
  if ((required || d.phone) && !readPhone(d.phone, d.phone_cc).ok) return invalid("phone");
  if (other && Array.from(d.pname).length < 2) return invalid("pname");
  if (other && !readPhone(d.pphone, d.pphone_cc).ok) return invalid("pphone");
  if (trip.meet && !d.sign && !other && Array.from(d.name).length < 2) return invalid("name");
  return null;
}

export function priceLeg(cls, airport) {
  const fare = AIRPORT_FARES[cls][airport];
  const total = AIRPORT_TOTALS[cls][airport];
  const tax = percentCents(fare, NYC_TAX_PERCENT);
  const bcf = percentCents(fare, BCF_PERCENT);
  return { fare, tax, bcf, tolls: total - fare - tax - bcf, total };
}

export function legLines(cls, airport) {
  const { fare, tax, bcf, tolls, total } = priceLeg(cls, airport);
  return { lines: [line(LABELS.fare, fare), line(taxLabel(), tax), line(bcfLabel(), bcf), line(LABELS.tolls, tolls)], total };
}

export function hourlyLines(vehicle, hours) {
  const fare = VEHICLES[vehicle].hourly * Number(hours);
  const tax = percentCents(fare, NYC_TAX_PERCENT);
  const bcf = percentCents(fare, BCF_PERCENT);
  return { lines: [line(fill(LABELS.fareHours, { hours }), fare), line(taxLabel(), tax), line(bcfLabel(), bcf)], total: fare + tax + bcf };
}

for (const cls of Object.keys(CLASSES)) {
  for (const airport of AIRPORT_PLACES) {
    const ok = Number.isInteger(AIRPORT_FARES[cls] && AIRPORT_FARES[cls][airport]) && Number.isInteger(AIRPORT_TOTALS[cls] && AIRPORT_TOTALS[cls][airport]);
    if (!ok || priceLeg(cls, airport).tolls < 0) throw new Error(`airport-config ${cls} ${airport}`);
  }
}

export function classTotal(trip, cls) {
  if (classReason(trip, cls)) return null;
  return priceTrip({ ...trip, class: cls, vehicle: trip.trip_type === "hour" ? vehicleFor(trip, cls) : trip.vehicle }).total;
}

export function priceTrip(trip, settings) {
  const hourly = trip.trip_type === "hour";
  const custom = trip.tip === "custom";
  const tipPercent = Number(trip.tip) || 0;
  const legs = hourly ? [] : (trip.legs || legsOf(trip)).map((item) => priceLeg(trip.class, item.airport));
  const sum = (key) => legs.reduce((total, item) => total + item[key], 0);
  const fare = hourly ? VEHICLES[trip.vehicle].hourly * Number(trip.hours) : sum("fare");
  const tax = hourly ? percentCents(fare, NYC_TAX_PERCENT) : sum("tax");
  const bcf = hourly ? percentCents(fare, BCF_PERCENT) : sum("bcf");
  const tolls = hourly ? 0 : sum("tolls");
  const meet = trip.meet ? MEET_AND_GREET : 0;
  const tip = custom ? Number(trip.tip_amount) * 100 || 0 : tipPercent ? percentCents(fare, String(tipPercent)) : 0;
  const lines = [line(hourly ? fill(LABELS.fareHours, { hours: trip.hours }) : LABELS.fare, fare), line(taxLabel(), tax), line(bcfLabel(), bcf)];
  if (!hourly) lines.push(line(LABELS.tolls, tolls));
  if (meet) lines.push(line(LABELS.meet, meet));
  if (tip) lines.push(line(custom ? LABELS.gratuityAmount : tipLabel(tipPercent), tip));
  return {
    legs,
    fare,
    tax,
    bcf,
    tolls,
    meet,
    tip,
    tipPercent,
    total: fare + tax + bcf + tolls + meet + tip,
    value: fare + meet,
    lines,
    notes: hourly ? [POLICY.later.hourly] : [NOTES.included, POLICY.later.airport],
    service: hourly ? "hourly" : "airport",
  };
}

export function vehicleLabel(key) {
  const { cls, model } = VEHICLES[key];
  return model ? `${model} (${CLASSES[cls].name})` : CLASSES[cls].name;
}

export function describe({ hourly, cls, vehicle, hours, count, direction, airport }) {
  if (hourly) return has(VEHICLES, vehicle) ? fill(LABELS.hourlyLine, { vehicle: vehicleLabel(vehicle), hours }) : "";
  if (!has(CLASSES, cls)) return "";
  if (count > 1) return fill(LABELS.legs, { class: CLASSES[cls].name, legs: count });
  if (!AIRPORT_PLACES.includes(airport) || (direction !== "to-airport" && direction !== "from-airport")) return "";
  return fill(direction === "to-airport" ? LABELS.to : LABELS.from, { airport: PLACES[airport], class: CLASSES[cls].name });
}

export function serviceLabel(trip) {
  const legs = trip.legs || legsOf(trip);
  const first = legs[0] || {};
  return describe({ hourly: trip.trip_type === "hour", cls: trip.class, vehicle: trip.vehicle, hours: trip.hours, count: legs.length, direction: first.direction, airport: first.airport });
}

export const REF = /^[1-9]\d{7}$/;
let processRefKey = null;
const refKey = () => {
  const secret = String(process.env.BOOKING_REF_SECRET || "").trim();
  if (secret) return createHmac("sha256", secret).update("nlr ref v1").digest();
  const stripe = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (stripe) return createHmac("sha256", stripe).update("nlr ref key v1").digest();
  if (!production()) return createHmac("sha256", "nlr-dev-ref").update("nlr ref v1").digest();
  if (!processRefKey) {
    processRefKey = randomBytes(32);
    console.error("ref-key");
  }
  return processRefKey;
};

export function requestRef(input) {
  if (input.action === "pay" || !input.nonce) return bookingRef(randomUUID());
  return bookingRef([input.nonce, input.trip_type, input.date, input.time, input.hours, input.return ? `${input.return_date} ${input.return_time}` : "", input.from_text, input.stop1_text, input.stop2_text, input.to_text].join("\n"));
}

export function bookingRef(nonce) {
  const n = createHmac("sha256", refKey()).update(String(nonce)).digest().readUIntBE(0, 6);
  return String(10000000 + (n % 90000000));
}

export function formatDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function placeLine(trip, name) {
  const text = trip[`${name}_text`];
  if (!text) return "";
  const end = trip.ends && trip.ends[name];
  return end && !end.place && end.zone !== "unknown" ? `${text} (${AREA_LABELS[end.zone]})` : text;
}

export function composeMessage(trip, ref, totalCents) {
  const one = trip.trip_type === "one";
  const hour = trip.trip_type === "hour";
  const lines = [MESSAGE.intro];
  if (ref) lines.push(`Reference: ${ref}`);
  if (one) lines.push("Trip: One way");
  if (hour && trip.hours) lines.push(`Trip: By the hour, ${trip.hours} ${trip.hours === "1" ? "hour" : "hours"}`);
  const labels = { from: "Pickup", stop1: "Stop 1", stop2: "Stop 2", to: "Drop-off" };
  for (const name of one ? ENDS : ["from"]) {
    const text = placeLine(trip, name);
    if (text) lines.push(`${labels[name]}: ${text}`);
  }
  if (validDate(trip.date)) lines.push(`Date: ${formatDate(trip.date)}`);
  if (TIME.test(trip.time || "")) lines.push(`Time: ${formatTime(trip.time)}`);
  if (trip.flight) lines.push(`Flight: ${trip.flight}`);
  if (one && trip.return && validDate(trip.return_date) && TIME.test(trip.return_time || "")) lines.push(`Return: ${formatDate(trip.return_date)}, ${formatTime(trip.return_time)}`);
  if (one && trip.return && trip.return_flight) lines.push(`Return flight: ${trip.return_flight}`);
  if (trip.passengers) lines.push(`Passengers: ${trip.passengers}`);
  if (one && has(CLASSES, trip.class)) lines.push(`Vehicle: ${CLASSES[trip.class].name}`);
  if (hour && has(VEHICLES, trip.vehicle)) lines.push(`Vehicle: ${vehicleLabel(trip.vehicle)}`);
  if (trip.meet) lines.push("Meet and greet: Yes");
  if (trip.tip === "custom" && Number(trip.tip_amount) > 0) lines.push(`Gratuity: ${money(Number(trip.tip_amount) * 100)}`);
  if (Number(trip.tip) > 0) lines.push(`Gratuity: ${trip.tip}%`);
  if (Number.isInteger(totalCents)) lines.push(`Total shown: ${money(totalCents)}`);
  return lines.join("\n");
}

export function contactLinks(trip, ref, totalCents) {
  const mail = `mailto:${CONTACT.email}`;
  if (!trip) return {};
  const text = encodeURIComponent(composeMessage(trip, ref, totalCents));
  return {
    whatsapp: `${CONTACT.whatsapp}?text=${text}`,
    mailto: `${mail}?subject=${encodeURIComponent(fill(MESSAGE.subject, { ref }))}&body=${text}`,
    tel: CONTACT.tel,
  };
}

export function receipt(metadata, settings, taxCents) {
  const data = metadata || {};
  const cents = (key) => (INTEGER.test(data[key] || "") ? Number(data[key]) : 0);
  const hourly = data.service === "hourly";
  const service = describe({
    hourly,
    cls: data.class,
    vehicle: data.vehicle,
    hours: data.hours,
    count: INTEGER.test(data.legs || "") ? Number(data.legs) : 1,
    direction: data.direction,
    airport: data.airport,
  });
  const known = validDate(data.date || "") && TIME.test(data.time || "") && Boolean(service);
  const lines = [];
  if (known && has(data, "gratuity_cents")) {
    const tax = Number.isInteger(taxCents) ? taxCents : cents("tax_cents");
    lines.push(line(LABELS.fare, cents("fare_cents")));
    if (cents("meet_cents")) lines.push(line(LABELS.meet, cents("meet_cents")));
    lines.push(line(tipLabel(20), cents("gratuity_cents")));
    if (tax) lines.push(line(LABELS.legacyTax, tax));
  } else if (known) {
    lines.push(line(hourly && INTEGER.test(data.hours || "") ? fill(LABELS.fareHours, { hours: data.hours }) : LABELS.fare, cents("fare_cents")), line(taxLabel(), cents("tax_cents")), line(bcfLabel(), cents("bcf_cents")));
    if (cents("tolls_cents")) lines.push(line(LABELS.tolls, cents("tolls_cents")));
    if (cents("meet_cents")) lines.push(line(LABELS.meet, cents("meet_cents")));
    if (cents("tip_cents")) lines.push(line(cents("tip_percent") > 0 ? tipLabel(cents("tip_percent")) : LABELS.gratuityAmount, cents("tip_cents")));
  }
  return {
    summary: !known ? "" : validDate(data.return_date || "") && TIME.test(data.return_time || "") ? fill(LABELS.summaryReturn, { date: formatDate(data.date), time: formatTime(data.time), rdate: formatDate(data.return_date), rtime: formatTime(data.return_time), service }) : fill(LABELS.summary, { date: formatDate(data.date), time: formatTime(data.time), service }),
    lines,
    value: cents("fare_cents") + cents("meet_cents"),
    notes: hourly ? [POLICY.later.hourly] : [NOTES.included, POLICY.later.airport],
  };
}
