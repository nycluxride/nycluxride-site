import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  CLASSES,
  VEHICLES,
  RETIRED_VEHICLES,
  CLASS_DEFAULT_VEHICLE,
  PLACES,
  AIRPORT_PLACES,
  AIRPORT_FARES,
  AIRPORT_TOTALS,
  DISTANCE_RATES,
  LONG_RATES,
  SHORT_MILES,
  LONG_MILES,
  DISTANCE_LIMITS,
  DISTANCE_SKIP_ZIPS,
  AIRPORT_STATES,
  TAX_AREAS,
  FEE_PERCENT,
  TIP_PERCENTS,
  TIP_CUSTOM,
  percentCents,
  MEET_AND_GREET,
  CHILD_SEAT_CENTS,
  CHILD_SEATS,
  CHILD_SEAT_LIMITS,
  SMALL_DOG_CENTS,
  LARGE_DOG_CENTS,
  DOG_SIZES,
  MAX_DOGS,
  BAG_SIZES,
  MAX_BAGS,
  STOP_FEE_CENTS,
  HOURS,
  PASSENGERS,
  MIN_NOTICE_MINUTES,
  SPRINTER_NOTICE_HOURS,
  SPRINTER_BUSY_HOURS,
  AUTO_LEAD_MINUTES,
  MAX_ADVANCE_DAYS,
  CONTACT,
} from "./_rates.mjs";
import { LABELS, NOTES, POLICY, MESSAGE, MAIL, SPRINTER_BUSY } from "./_copy.mjs";
import { AIRPORT_ZONES, AREA_LABELS, norm, classifyText, classifyPlace, placeRegion, placeFits, endRegion, zoneRegion, inNewYork, localById, areaText, routeText, typedZip } from "./_places.mjs";
import { TICKET, TICKET_TTL, ROUTE, verifyTicket, routeKey, signRoute, routeRide, readRoute } from "./_ticket.mjs";
import { clean, clientBudget, instanceBudget, production } from "./_http.mjs";
import { googleOn, placeDetails, computeRoute } from "./_google.mjs";
import { readPhone } from "./_phone.mjs";
import { headerText } from "./_smtp.mjs";

const ENDS = ["from", "stop1", "stop2", "to"];
const FIELDS = ["trip_type", "date", "time", "flight", "return", "return_date", "return_time", "return_flight", "passengers", ...CHILD_SEATS.map((k) => `${k}_seats`), ...DOG_SIZES.map((k) => `${k}_dogs`), ...BAG_SIZES.map((k) => `${k}_bags`), "hours", "class", "vehicle", "sprinter", "meet", "tip", "tip_amount", "action", "nonce", "nlr_hp"];
const ACTIONS = ["options", "quote", "pay"];
const BOROUGHS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island"];
const ROUTED = ["no-airport", "outside-city"];
const ROUTE_REASONS = ["street-address", "stop-address", "airport-zip", "long-trip"];
const NONCE = /^[A-Za-z0-9-]{16,64}$/;
const FLIGHT = /^[A-Za-z0-9 -]{1,20}$/;
const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTEGER = /^\d+$/;
const MILES = /^\d+\.\d$/;
const LOCAL_ID = /^[a-z0-9-]{2,24}$/;
const MAX_TEXT = 200;
const MAX_TICKET = 559;
const DOG_CENTS = { small: SMALL_DOG_CENTS, large: LARGE_DOG_CENTS };
const DOG_PART = /^([1-9]\d*) (small|large) (\d+)$/;
const BAG_PART = new RegExp(`^([1-9]\\d*) (${BAG_SIZES.join("|")}) bags?$`);
const SEAT_PART = new RegExp(`^([1-9]\\d*) (${CHILD_SEATS.join("|")})$`);
const ZONE_PART = /^(from|stop1|stop2|to) ([a-z0-9-]+)$/;
const PLACE_PART = /^(from|to) (\S+)$/;
const PICK_IP = 15;
const PICK_INSTANCE = 100;
const PLACE_ZONES = 1000;
const placeZones = new Map();
const routeRides = new Map();
const OPEN = { paymentsEnabled: true, blackout: [], blackoutBad: false };
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
export const airportZip = (text) => (text.match(/\b\d{5}\b/g) || []).some((zip) => DISTANCE_SKIP_ZIPS.includes(zip));
const unplaced = (text) => (airportZip(text) ? "airport-zip" : "unplaced");
const exact = (end) => !end || !(end.area || end.town);
const regionOf = (region) => (region ? { region } : {});
const marks = (ticket) => ({ ...(ticket.area && { area: true }), ...(ticket.town && { town: true }) });
const askFor = (trip, ends) => (!exact(ends.from) ? "pickup-address" : trip.trip_type === "one" && trip.return && !exact(ends.to) ? "return-address" : "");
const line = (label, cents) => ({ label, cents });
const tipLabel = (rate) => fill(LABELS.gratuity, { rate });
const flatNotes = (part) => (part === "return" ? [NOTES.returnFlat, POLICY.later.returnFlat] : part === "out" ? [NOTES.outFlat, POLICY.later.outFlat] : null);
const tollsOf = (ride) => (ride && Number.isInteger(ride.tolls) ? { tolls: ride.tolls } : {});

export function laterNotes(service, flat, airport, tolled) {
  if (service === "hourly") return [POLICY.later.hourly];
  if (service !== "distance") return [NOTES.included, POLICY.later.airport];
  if (flat) return tolled ? [NOTES.flatTolled, POLICY.later.waiting] : flatNotes(flat);
  return [airport ? (tolled ? POLICY.later.waiting : POLICY.later.outside) : tolled ? POLICY.later.distance : POLICY.later.hourly];
}

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
  const route = value("route", MAX_TICKET + 1);
  let cls = has(CLASSES, raw.class) ? raw.class : "";
  if (!cls && action === "options") cls = "suv";
  const pick = (key, kind) => (has(VEHICLES, key) && VEHICLES[key].cls === kind ? key : "");
  const suvVehicle = pick(raw.vehicle, "suv") || CLASS_DEFAULT_VEHICLE.suv;
  const sprinterVehicle = pick(raw.sprinter, "sprinter") || pick(raw.vehicle, "sprinter") || CLASS_DEFAULT_VEHICLE.sprinter;
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
    seats: Object.fromEntries(CHILD_SEATS.map((k) => [k, canonical(raw[`${k}_seats`])])),
    dogs: Object.fromEntries(DOG_SIZES.map((k) => [k, canonical(raw[`${k}_dogs`])])),
    bags: Object.fromEntries(BAG_SIZES.map((k) => [k, canonical(raw[`${k}_bags`])])),
    hours: hour ? canonical(raw.hours) : "",
    class: cls,
    vehicle: cls === "sprinter" ? sprinterVehicle : hour && cls ? (cls === "suv" ? suvVehicle : CLASS_DEFAULT_VEHICLE[cls]) : "",
    suvVehicle: hour ? suvVehicle : "",
    sprinterVehicle,
    meet: raw.meet === "1",
    tip: raw.tip === "" ? 0 : raw.tip === "custom" ? "custom" : tips.includes(raw.tip) ? Number(raw.tip) : null,
    tip_amount: raw.tip === "custom" ? canonical(raw.tip_amount) : "",
    action,
    nonce: NONCE.test(raw.nonce) ? raw.nonce : "",
    nlr_hp: raw.nlr_hp,
    route: route.length <= MAX_TICKET && ROUTE.test(route) ? route : "",
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
  for (let at = Math.ceil((Number(now) + MIN_NOTICE_MINUTES * MINUTE_MS + AUTO_LEAD_MINUTES * MINUTE_MS) / SLOT_MS) * SLOT_MS; ; at += SLOT_MS) {
    const [date, time] = wallTime(at).split(" ");
    if (!clockChange(date, time)) return { date, time };
  }
}

export function sprinterFrom(now) {
  for (let at = Math.ceil((Number(now) + SPRINTER_NOTICE_HOURS * HOUR_MS) / MINUTE_MS) * MINUTE_MS; ; at += MINUTE_MS) {
    const [date, time] = wallTime(at).split(" ");
    if (!clockChange(date, time)) return { date, time };
  }
}

export const sprinterBusy = (cls, pickup, now) => cls === "sprinter" && Number.isFinite(pickup) && pickup < Number(now) + SPRINTER_BUSY_HOURS * HOUR_MS;

export function sessionBusy(session, cls, pickupAt) {
  const said = session.custom_text && session.custom_text.submit && session.custom_text.submit.message;
  if (typeof said === "string") return cls === "sprinter" && said.includes(SPRINTER_BUSY);
  return sprinterBusy(cls, Date.parse(pickupAt), Number(session.created) * 1000);
}

export const noticeReason = (trip, cls, now) => (cls === "sprinter" && validDate(trip.date) && TIME.test(trip.time) && nycToUtc(trip.date, trip.time).getTime() < Number(now) + SPRINTER_NOTICE_HOURS * HOUR_MS ? "sprinter-notice" : "");

function endsOf(trip) {
  if (trip.ends) return trip.ends;
  const end = (zone) => (zone ? { text: "", zone, place: "", id: "", ...regionOf(zoneRegion(zone)) } : null);
  return { from: end(trip.from), stop1: null, stop2: null, to: trip.trip_type === "one" ? end(trip.to) : null };
}

const hourlyPlace = (start) => Boolean(start) && !["unknown", "abroad"].includes(start.zone) && (start.zone !== "outside" || Boolean(start.place));

export const hourlyStart = (trip) => hourlyPlace(endsOf(trip).from);

export function legTax(points) {
  const regions = points.map((end) => (end && end.region) || "");
  if (regions.some((region) => region && !inNewYork(region))) return { area: "", percent: "0" };
  if (regions.some((region) => !region) || !has(TAX_AREAS, regions[0])) return null;
  return { area: regions[0], percent: TAX_AREAS[regions[0]].percent };
}

function leg(from, to, back, salesTax) {
  const fromAirport = AIRPORT_ZONES.includes(from);
  const toAirport = AIRPORT_ZONES.includes(to);
  let reason = "";
  if (from === "unknown" || to === "unknown") reason = "unplaced";
  else if (from === "abroad" || to === "abroad") reason = "outside-us";
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
    salesTax,
  };
}

export const flatPair = (from, to) => !leg(from, to, false, null).reason;

export function legsOf(trip) {
  if (trip.trip_type !== "one") return [];
  const ends = endsOf(trip);
  const points = ENDS.map((name) => ends[name]).filter(Boolean);
  const legs = [];
  const out = legTax(points);
  for (let i = 1; i < points.length; i++) legs.push(leg(points[i - 1].zone, points[i].zone, false, out));
  if (trip.return && ends.from && ends.to) legs.push(leg(ends.to.zone, ends.from.zone, true, legTax([ends.to, ends.from])));
  return legs;
}

export async function resolveEnd(end, trip, context = {}) {
  const text = trip[`${end}_text`] || "";
  if (!text) return null;
  const now = context.now === undefined ? Date.now() : Number(context.now);
  const ticket = trip[`${end}_ticket`] ? verifyTicket(trip[`${end}_ticket`], text, now) : null;
  if (ticket && !ticket.expired) return { text, zone: ticket.zone, place: ticket.id, id: "", ...regionOf(endRegion(ticket.zone, ticket.region, text)), ...marks(ticket) };
  const lost = () => ({ text, zone: "unknown", place: "", id: "", ...marks(ticket) });
  if (ticket && googleOn()) {
    const known = placeZones.get(ticket.id);
    if (known && known.until > now) return known.zone === "unknown" ? lost() : { text, zone: known.zone, place: ticket.id, id: "", ...regionOf(endRegion(known.zone, known.region, text)), ...marks(ticket) };
    const allowed = (!context.request || clientBudget(context.request, "places-pick", PICK_IP)) && instanceBudget("places-pick", PICK_INSTANCE);
    const result = allowed ? await placeDetails(ticket.id, "") : { ok: false, status: 429 };
    if (result.ok) {
      const found = classifyPlace(result.details, text);
      const region = placeRegion(result.details);
      const zone = placeFits(found, result.details.location, region) ? found : "unknown";
      if (zone !== found) console.error("places-pick", "spot");
      placeZones.delete(ticket.id);
      placeZones.set(ticket.id, { zone, region, until: now + TICKET_TTL * 1000 });
      if (placeZones.size > PLACE_ZONES) placeZones.delete(placeZones.keys().next().value);
      return zone === "unknown" ? lost() : { text, zone, place: ticket.id, id: "", ...regionOf(endRegion(zone, region, text)), ...marks(ticket) };
    }
    console.error("places-pick", result.status);
  }
  if (ticket) return lost();
  const row = localById(trip[`${end}_id`]);
  if (row && norm(row.label) === norm(text)) return { text, zone: row.zone, place: row.id, id: row.id, ...regionOf(endRegion(row.zone, "", row.addr)) };
  const { zone, id } = classifyText(text);
  return { text, zone, place: id, id, ...regionOf(endRegion(zone, "", id ? localById(id).addr : text)), ...(areaText(text) && { area: true }) };
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
  const meetOffered = AIRPORT_PLACES.includes(from);
  const resolved = {
    ...trip,
    ends,
    from,
    to,
    flight: AIRPORT_ZONES.includes(from) ? trip.flight : "",
    return_flight: trip.return && AIRPORT_ZONES.includes(to) ? trip.return_flight : "",
    meet: Boolean(trip.meet) && meetOffered,
    meetOffered,
    route: "",
  };
  resolved.legs = legsOf(resolved);
  return driveTrip(resolved, trip.route, context);
}

function waypointOf(end) {
  const row = end.id ? localById(end.id) : null;
  if (row) return row.gid ? { placeId: row.gid } : { address: row.addr };
  return end.place ? { placeId: end.place } : { address: routeText(end.text, end.zone) };
}

async function rideOf(points, departure, known, context, now, alone = false, flat = false) {
  const key = routeKey(points[0], points[points.length - 1], departure.toISOString(), alone ? ["alone"] : points.slice(1, -1));
  const saved = known.get(key) || routeRides.get(key);
  const fresh = Boolean(saved) && saved.at + TICKET_TTL * 1000 > now;
  if (fresh && !context.map) return { key, ...saved };
  const allowed = (!context.request || clientBudget(context.request, "book-route", PICK_IP)) && instanceBudget("book-route", PICK_INSTANCE);
  const result = allowed ? await computeRoute(points, departure, context.map || null, !alone && !flat) : { ok: false, status: 429 };
  if (!result.ok) {
    console.error("book-route", result.status);
    return fresh ? { key, ...saved } : null;
  }
  const ride = { tenths: Math.round(result.miles * 10), minutes: result.minutes, at: now, ...tollsOf(result) };
  routeRides.delete(key);
  routeRides.set(key, ride);
  if (routeRides.size > PLACE_ZONES) routeRides.delete(routeRides.keys().next().value);
  return { key, ...ride, path: result };
}

async function driveTrip(trip, token, context) {
  const now = context.now === undefined ? Date.now() : Number(context.now);
  const check = checkTrip(trip, now, OPEN);
  const stops = [trip.ends.stop1, trip.ends.stop2].filter(Boolean);
  const routed = stops.length ? check.reason === "stop-leg" && trip.legs.every((item) => !item.reason || ROUTED.includes(item.reason) || (!item.back && item.reason === "airport-to-airport" && [item.from, item.to].every((zone) => AIRPORT_PLACES.includes(zone)))) : ROUTED.includes(check.reason);
  if (check.kind !== "quote" || !routed) return trip;
  const points = [trip.ends.from, ...stops, trip.ends.to];
  if (points.some((end) => !AIRPORT_PLACES.includes(end.zone) && airportZip(end.text))) return check.reason === "no-airport" || stops.length ? { ...trip, legs: trip.legs.map((item) => ({ ...item, reason: "airport-zip" })) } : trip;
  if (!googleOn()) return trip;
  const ask = [trip.ends.from, trip.ends.to].some((end) => end.area) || askFor(trip, trip.ends) ? "street-address" : stops.every(exact) ? "" : "stop-address";
  if (ask) return { ...trip, legs: trip.legs.map((item) => ({ ...item, reason: ask })) };
  const known = readRoute(token, now);
  const ends = points.map(waypointOf);
  const zones = points.map((end) => end.zone);
  const back = trip.legs.filter((item) => item.back).map((item) => (item.reason ? item : { ...item, flat: true }));
  const whole = { ...leg(zones[0], zones[zones.length - 1], false, legTax(points)), airport: zones.find((zone) => AIRPORT_PLACES.includes(zone)) || "", stops: stops.length, via: zones.slice(1, -1) };
  const legs = stops.length ? [whole, ...back] : trip.legs;
  const plain = legs[0] === whole ? leg(zones[0], zones[zones.length - 1], false, whole.salesTax) : null;
  const direct = Boolean(plain) && ROUTED.includes(plain.reason);
  const routes = legs.filter((item) => item.back || !item.flat);
  const found = await Promise.all([
    ...routes.map((item) => (item.back ? rideOf([ends[ends.length - 1], ends[0]], nycToUtc(trip.return_date, trip.return_time), known, context, now, false, item.flat) : rideOf(ends, nycToUtc(trip.date, trip.time), known, context, now))),
    ...(direct ? [rideOf([ends[0], ends[ends.length - 1]], nycToUtc(trip.date, trip.time), known, { ...context, map: null }, now, true)] : []),
  ]);
  if (found.some((ride) => !ride)) return trip;
  const rides = found.slice(0, routes.length);
  const alone = direct ? found[routes.length] : null;
  const long = found.some((ride) => !withinLimits(ride));
  const rideFor = (item) => rides[routes.indexOf(item)];
  const tolled = routes.every((item) => item.flat || Number.isInteger(rideFor(item).tolls));
  const driven = (item) => ({ tenths: rideFor(item).tenths, minutes: rideFor(item).minutes, ...(tolled && !item.flat && tollsOf(rideFor(item))) });
  const nostop = !plain || (plain.reason && !alone) ? null : alone ? { ...plain, reason: "", ride: { tenths: alone.tenths, minutes: alone.minutes, ...(tolled && tollsOf(rideFor(whole))) } } : plain;
  return {
    ...trip,
    route: signRoute(found.map(({ key, tenths, minutes, tolls }) => routeRide(key, tenths, minutes, tolls)), Math.min(...found.map((ride) => ride.at))),
    legs: legs.map((item) => (rideFor(item) ? { ...item, reason: long ? "long-trip" : "", ride: driven(item), ...(item === whole && nostop && { plain: nostop }) } : item)),
    paths: rides.map((ride) => ride.path),
  };
}

export const withinLimits = ({ tenths, minutes }) => tenths <= DISTANCE_LIMITS.miles * 10 && minutes <= DISTANCE_LIMITS.minutes;
const distanceTrip = (trip) => trip.trip_type === "one" && Array.isArray(trip.legs) && trip.legs.length > 0 && trip.legs.every((item) => (item.ride || item.flat) && !item.reason);
export const serviceOf = (trip) => (trip.trip_type === "hour" ? "hourly" : distanceTrip(trip) ? "distance" : "airport");
export const airportDistance = (trip) => distanceTrip(trip) && trip.legs.some((item) => item.airport);
export const tollsIn = (trip) => distanceTrip(trip) && trip.legs.every((item) => item.flat || Number.isInteger((item.ride || {}).tolls));
export const flatPart = (trip) => (distanceTrip(trip) && trip.legs.some((item) => item.flat) ? (trip.legs.some((item) => item.flat && item.back) ? "return" : "out") : "");

function vehicleFor(trip, cls) {
  if (cls === trip.class && has(VEHICLES, trip.vehicle)) return trip.vehicle;
  const picked = cls === "suv" ? trip.suvVehicle : cls === "sprinter" ? trip.sprinterVehicle : "";
  return has(VEHICLES, picked) ? picked : CLASS_DEFAULT_VEHICLE[cls];
}

export const rateKey = (cls, vehicle) => (has(AIRPORT_TOTALS, cls) ? cls : has(VEHICLES, vehicle) && VEHICLES[vehicle].cls === cls ? vehicle : CLASS_DEFAULT_VEHICLE[cls]);
const legRated = (key, item) => Boolean(item.reason) || ((item.ride && !item.flat ? has(DISTANCE_RATES, key) : has(AIRPORT_TOTALS[key], item.airport)) && (!item.plain || legRated(key, item.plain)));
export const tripRated = (trip, key) => trip.trip_type !== "one" || (trip.legs || legsOf(trip)).every((item) => legRated(key, item));

export function childReason(trip, cls) {
  const limit = has(CHILD_SEAT_LIMITS, cls) && CHILD_SEAT_LIMITS[cls];
  if (!limit) return "";
  const seats = seatTotal(trip);
  const adults = Number(trip.passengers) - seats;
  if (seats > limit.seats) return "child-seats";
  if (limit.adults && adults < limit.adults) return "adult";
  if (limit.oneAdult !== undefined && adults === 1 && seats > limit.oneAdult) return "one-adult";
  return "";
}

export function classReason(trip, cls) {
  if (!has(CLASSES, cls)) return "";
  const key = vehicleFor(trip, cls);
  const vehicle = VEHICLES[key];
  if (trip.trip_type === "hour" && Number(trip.hours) < (vehicle.minHours || HOURS.min)) return "min-hours";
  if (Number(trip.passengers) > (vehicle.seats || CLASSES[cls].seats)) return "seats";
  const kids = childReason(trip, cls);
  if (kids) return kids;
  if (!tripRated(trip, rateKey(cls, key))) return "sprinter-price";
  return "";
}

function spatialReason(trip) {
  if (trip.trip_type === "hour") {
    if (trip.from === "unknown") return { reason: unplaced(trip.from_text), field: "from_text" };
    const start = endsOf(trip).from;
    if (!hourlyPlace(start)) return { reason: "outside-hourly", field: "" };
    const hours = Number(trip.hours);
    if (hours < HOURS.min || hours > HOURS.max) return { reason: "hours-range", field: "" };
    return exact(start) ? null : { reason: "pickup-address", field: "" };
  }
  const ends = endsOf(trip);
  for (const name of ENDS) if (ends[name] && ends[name].zone === "unknown") return { reason: unplaced(ends[name].text), field: `${name}_text` };
  const legs = trip.legs || legsOf(trip);
  if (!legs.length) return { reason: "unplaced", field: "from_text" };
  const stopped = Boolean(ends.stop1 || ends.stop2);
  const online = (item) => !item.reason || ROUTED.includes(item.reason) || (stopped && !item.back && item.reason === "airport-to-airport" && [item.from, item.to].every((zone) => AIRPORT_PLACES.includes(zone)));
  const blind = ENDS.every((name) => exact(ends[name])) && legs.every(online) ? ENDS.find((name) => ends[name] && !ends[name].region) : "";
  if (blind) {
    const end = ends[blind];
    const reason = unplaced(end.text);
    return { reason: reason === "unplaced" && !end.place && typedZip(end.text) ? "county" : reason, field: `${blind}_text` };
  }
  const unpriced = legs.find((item) => item.reason);
  const ask = !unpriced || unpriced.reason === "street-address" ? askFor(trip, ends) : "";
  if (ask) return { reason: ask, field: "" };
  if (!unpriced) return (ends.stop1 || ends.stop2) && !legs.some((item) => item.stops) ? { reason: "stop-leg", field: "" } : null;
  return { reason: (ends.stop1 || ends.stop2) && !ROUTE_REASONS.includes(unpriced.reason) ? "stop-leg" : unpriced.reason, field: "" };
}

function holdFor(trip, current, settings) {
  const times = [[trip.date, trip.time]];
  if (trip.trip_type === "one" && trip.return) times.push([trip.return_date, trip.return_time]);
  const blackout = settings.blackout || [];
  if (!settings.paymentsEnabled || settings.blackoutBad || times.some(([date]) => blackout.includes(date))) return "paused";
  if (times.some(([date, time]) => clockChange(date, time))) return "clock-change";
  const pickups = times.map(([date, time]) => nycToUtc(date, time).getTime());
  if (Math.min(...pickups) < current + MIN_NOTICE_MINUTES * MINUTE_MS) return "short-notice";
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
  if ((wallTime(pickup + HOUR_MS) === `${trip.date} ${trip.time}` ? pickup + HOUR_MS : pickup) <= current) return invalid("date-past");
  if (one && trip.return) {
    if (!validDate(trip.return_date) || !TIME.test(trip.return_time)) return invalid("return-date");
    if (nycToUtc(trip.return_date, trip.return_time).getTime() <= pickup) return invalid("return-date");
  }
  const passengers = Number(trip.passengers);
  if (!INTEGER.test(trip.passengers) || passengers < PASSENGERS.min || passengers > PASSENGERS.max) return invalid("passengers");
  if (!seatsOk(trip)) return invalid("child_seats");
  if (!dogsOk(trip)) return invalid("dogs");
  if (!bagsOk(trip)) return invalid("bags");
  if (hour && !INTEGER.test(trip.hours)) return invalid("hours");
  if (!has(CLASSES, trip.class)) return invalid("class");
  if (hour && !has(VEHICLES, trip.vehicle)) return invalid("vehicle");
  if (hour && VEHICLES[trip.vehicle].minHours > Number(trip.hours)) return invalid("sprinter-hours");
  if (trip.flight && !FLIGHT.test(trip.flight)) return invalid("flight");
  if (one && trip.return && trip.return_flight && !FLIGHT.test(trip.return_flight)) return invalid("return_flight");
  if (trip.tip === "custom" && !tipAmountOk(trip.tip_amount)) return invalid("tip_amount");
  if (trip.tip !== "custom" && !TIP_PERCENTS.includes(trip.tip)) return invalid("tip");
  const spatial = spatialReason(trip);
  if (spatial) return { kind: "quote", reason: spatial.reason, field: spatial.field };
  return { kind: "price", reason: noticeReason(trip, trip.class, current) || classReason(trip, trip.class), hold: holdFor(trip, current, settings) };
}

const counts = (kinds, chosen) => Object.fromEntries(kinds.map((k) => [k, INTEGER.test((chosen || {})[k] || "") ? Number(chosen[k]) : 0]));
const countText = (found, types) => {
  const parts = Object.entries(found).filter(([, n]) => n).map(([k, n]) => `${n} ${Array.isArray(types[k]) ? types[k][n === 1 ? 0 : 1] : types[k].toLowerCase().replace(/s$/, n === 1 ? "" : "s")}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join("");
};
export const seatCounts = (trip) => counts(CHILD_SEATS, trip.seats);
export const seatTotal = (trip) => Object.values(seatCounts(trip)).reduce((sum, n) => sum + n, 0);
export const seatText = (trip) => countText(seatCounts(trip), LABELS.seatTypes);
export const dogCounts = (trip) => counts(DOG_SIZES, trip.dogs);
export const dogText = (trip) => countText(dogCounts(trip), LABELS.dogTypes);
export const dogMeta = (price) => DOG_SIZES.filter((k) => price.dogCents[k]).map((k) => `${price.dogCounts[k]} ${k} ${price.dogCents[k]}`).join(", ");
const metaParts = (text, pattern) => (typeof text === "string" ? text.split(", ").map((part) => pattern.exec(part)).filter(Boolean) : []);
export const dogParts = (text) => metaParts(text, DOG_PART).map(([, count, size, cents]) => ({ size, count: Number(count), cents: Number(cents) }));
export const bagCounts = (trip) => counts(BAG_SIZES, trip.bags);
export const bagText = (trip) => countText(bagCounts(trip), LABELS.bagCounts);
export const paxMeta = (trip) => [trip.passengers, ...Object.entries(bagCounts(trip)).filter(([, n]) => n).map(([k, n]) => `${n} ${k} ${n === 1 ? "bag" : "bags"}`)].join(", ");
export const seatMeta = (trip) => Object.entries(seatCounts(trip)).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");
const wholeParts = (parts, max) => parts.reduce((text, part) => {
  const next = text ? `${text}, ${part}` : part;
  return next.length <= max ? next : text;
}, "");
export const endMeta = (ends, names, key, max = Infinity) => wholeParts(names.filter((name) => ends && ends[name] && ends[name][key]).map((name) => `${name} ${ends[name][key]}`), max);

export function bookingData(metadata) {
  const data = metadata && typeof metadata === "object" ? metadata : {};
  const unpacked = {};
  for (const [, name, zone] of metaParts(data.zones, ZONE_PART)) unpacked[`${name}_zone`] = zone;
  for (const [, name, place] of metaParts(data.places, PLACE_PART)) unpacked[`${name}_place`] = place;
  const seats = metaParts(data.seats, SEAT_PART);
  for (const [, count, kind] of seats) unpacked[`${kind}_seats`] = count;
  if (seats.length) unpacked.child_seats = String(seats.reduce((sum, [, count]) => sum + Number(count), 0));
  const bags = metaParts(data.passengers, BAG_PART);
  for (const [, count, size] of bags) unpacked[`${size}_bags`] = count;
  return { ...unpacked, ...data, ...(bags.length && { passengers: data.passengers.split(", ")[0] }) };
}

const seatsOk = (trip) => CHILD_SEATS.every((k) => /^\d*$/.test((trip.seats || {})[k] || "")) && seatTotal(trip) <= Number(trip.passengers);
const dogsOk = (trip) => DOG_SIZES.every((k) => /^\d*$/.test((trip.dogs || {})[k] || "") && Number((trip.dogs || {})[k] || 0) <= MAX_DOGS);
const bagsOk = (trip) => BAG_SIZES.every((k) => /^\d*$/.test((trip.bags || {})[k] || "") && Number((trip.bags || {})[k] || 0) <= MAX_BAGS);
const seatLabel = (count, cents) => (count > 0 && cents % count === 0 ? fill(LABELS.seats, { count, price: money(cents / count) }) : LABELS.seatsAll);
const dogLabel = (size, count, cents) => (count > 0 && cents % count === 0 ? fill(LABELS.dogs[size], { count, price: money(cents / count) }) : LABELS.dogsAll[size]);
const stopLabel = (count, cents) => (count === 1 ? LABELS.stop : count > 1 && cents % count === 0 ? fill(LABELS.stops, { count, price: money(cents / count) }) : LABELS.stopsAll);

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

export const feeOf = (fare) => percentCents(fare, FEE_PERCENT);

export function priceLeg(key, airport) {
  const fare = AIRPORT_FARES[key][airport];
  const total = AIRPORT_TOTALS[key][airport];
  const fee = feeOf(fare);
  return { fare, fee, tolls: total - fare - fee, total };
}

const feeLines = (fee) => [line(LABELS.fee, fee)];
const legacyLines = (tax, bcf) => [...(tax ? [line(LABELS.tax, tax)] : []), line(LABELS.bcf, bcf)];

export function legLines(key, airport) {
  const { fare, fee, tolls, total } = priceLeg(key, airport);
  return { lines: [line(LABELS.fare, fare), ...feeLines(fee), line(LABELS.tolls, tolls)], total };
}

export function hourlyLines(vehicle, hours) {
  const fare = VEHICLES[vehicle].hourly * Number(hours);
  const fee = feeOf(fare);
  return { lines: [line(fill(LABELS.fareHours, { hours }), fare), ...feeLines(fee)], total: fare + fee };
}

export const RATE_KEYS = Object.keys(CLASSES).flatMap((cls) => (has(AIRPORT_TOTALS, cls) ? [cls] : Object.keys(VEHICLES).filter((key) => VEHICLES[key].cls === cls)));
for (const key of RATE_KEYS) {
  const full = has(CLASSES, key) || key === CLASS_DEFAULT_VEHICLE[VEHICLES[key].cls];
  for (const airport of AIRPORT_PLACES) {
    if (!full && !has(AIRPORT_TOTALS[key] || {}, airport) && !has(AIRPORT_FARES[key] || {}, airport)) continue;
    const ok = Number.isInteger(AIRPORT_FARES[key] && AIRPORT_FARES[key][airport]) && Number.isInteger(AIRPORT_TOTALS[key] && AIRPORT_TOTALS[key][airport]);
    if (!ok || !has(AIRPORT_STATES, airport) || priceLeg(key, airport).tolls < 0) throw new Error(`airport-config ${key} ${airport}`);
  }
}
if ([AIRPORT_FARES, AIRPORT_TOTALS].some((table) => Object.keys(table).some((key) => !RATE_KEYS.includes(key) || Object.keys(table[key]).some((airport) => !AIRPORT_PLACES.includes(airport))))) throw new Error("airport-config");

const cardFare = (rate, tenths, minutes) => rate.base + Math.round((tenths * rate.mile) / 10) + minutes * rate.minute;

export function distanceFare(key, tenths, minutes) {
  const short = (at) => cardFare(DISTANCE_RATES[key], at, minutes);
  const long = (at) => cardFare(LONG_RATES[key], at, minutes);
  const [from, to] = [SHORT_MILES * 10, LONG_MILES * 10];
  const blend = (at) => Math.round(short(at) + ((long(at) - short(at)) * (at - from)) / (to - from));
  let fare = short(Math.min(tenths, from));
  for (let at = from + 1; at <= Math.min(tenths, to - 1); at++) fare = Math.max(fare, blend(at));
  if (tenths >= to) fare = Math.max(fare, long(tenths));
  return Math.max(DISTANCE_RATES[key].minimum, fare);
}

export function priceDistance(key, ride, ...airports) {
  return priceRide(key, ride, airports);
}

export function priceRide(key, ride, airports = []) {
  const { tenths, minutes } = ride;
  const fare = Math.max(distanceFare(key, tenths, minutes), ...airports.filter((airport) => has(AIRPORT_FARES[key], airport)).map((airport) => AIRPORT_FARES[key][airport]));
  const fee = feeOf(fare);
  const tolls = Number.isInteger(ride.tolls) ? ride.tolls : 0;
  return { fare, fee, tolls, total: fare + fee + tolls };
}

const cardOk = (rate, parts) => Boolean(rate) && parts.every((part) => Number.isInteger(rate[part]) && rate[part] >= 0);
for (const key of RATE_KEYS) {
  const rate = has(DISTANCE_RATES, key) ? DISTANCE_RATES[key] : null;
  const ok = cardOk(rate, ["base", "mile", "minute", "minimum"]) && rate.minimum > 0 && cardOk(has(LONG_RATES, key) && LONG_RATES[key], ["base", "mile", "minute"]);
  if (!ok && (has(CLASSES, key) || key === CLASS_DEFAULT_VEHICLE[VEHICLES[key].cls] || rate)) throw new Error(`distance-config ${key}`);
}
if (Object.keys(LONG_RATES).some((key) => !has(DISTANCE_RATES, key)) || !(Number.isInteger(SHORT_MILES) && Number.isInteger(LONG_MILES) && SHORT_MILES > 0 && LONG_MILES > SHORT_MILES)) throw new Error("distance-config");
if (!/^\d+(\.\d+)?$/.test(FEE_PERCENT)) throw new Error("fee-config");
if (!Number.isInteger(STOP_FEE_CENTS) || STOP_FEE_CENTS <= 0) throw new Error("stop-config");
if (Object.keys(DISTANCE_RATES).some((key) => !RATE_KEYS.includes(key)) || !(DISTANCE_LIMITS.miles > 0 && DISTANCE_LIMITS.minutes > 0) || !DISTANCE_SKIP_ZIPS.every((zip) => /^\d{5}$/.test(zip))) throw new Error("distance-config");

export function classTotal(trip, cls) {
  if (classReason(trip, cls)) return null;
  return priceTrip({ ...trip, class: cls, vehicle: trip.trip_type === "hour" || cls === "sprinter" ? vehicleFor(trip, cls) : "" }).total;
}

const legPrice = (key, item) => (item.ride && !item.flat ? priceRide(key, item.ride, [item.from, ...(item.via || []), item.to]) : priceLeg(key, item.airport));

export function chargedLegs(trip, cls = trip.class) {
  const legs = trip.legs || legsOf(trip);
  if (!has(CLASSES, cls)) return legs;
  const key = rateKey(cls, vehicleFor(trip, cls));
  if (!tripRated({ ...trip, trip_type: "one", legs }, key)) return legs;
  const feeRide = (item) => {
    const { total, tolls } = legPrice(key, item.plain);
    return total - tolls + (Number.isInteger(item.ride.tolls) ? item.ride.tolls : 0) + item.stops * STOP_FEE_CENTS;
  };
  return legs.map((item) => (item.plain && item.ride && !item.reason && feeRide(item) > legPrice(key, item).total ? { ...item.plain, feeStops: item.stops, driven: item.ride } : item));
}

export const chargedTrip = (trip) => (trip.trip_type === "one" ? { ...trip, legs: chargedLegs(trip) } : trip);

export function priceTrip(input, settings) {
  const trip = chargedTrip(input);
  const hourly = trip.trip_type === "hour";
  const custom = trip.tip === "custom";
  const tipPercent = Number(trip.tip) || 0;
  const service = serviceOf(trip);
  const plain = service === "airport";
  const key = rateKey(trip.class, trip.vehicle);
  const legs = hourly ? [] : trip.legs.map((item) => legPrice(key, item));
  const sum = (key) => legs.reduce((total, item) => total + item[key], 0);
  const fare = hourly ? VEHICLES[trip.vehicle].hourly * Number(trip.hours) : sum("fare");
  const fee = hourly ? feeOf(fare) : sum("fee");
  const tolls = hourly ? 0 : sum("tolls");
  const estimate = tollsIn(trip) ? trip.legs.reduce((total, item, i) => total + (item.flat ? 0 : legs[i].tolls), 0) : null;
  const meet = trip.meet ? MEET_AND_GREET : 0;
  const seatCount = seatTotal(trip);
  const seats = seatCount * CHILD_SEAT_CENTS;
  const dogCount = dogCounts(trip);
  const dogCents = Object.fromEntries(DOG_SIZES.map((k) => [k, dogCount[k] * DOG_CENTS[k]]));
  const dogs = DOG_SIZES.reduce((sum, k) => sum + dogCents[k], 0);
  const stopCount = hourly ? 0 : trip.legs.reduce((sum, item) => sum + (item.feeStops || 0), 0);
  const stops = stopCount * STOP_FEE_CENTS;
  const tip = custom ? Number(trip.tip_amount) * 100 || 0 : tipPercent ? percentCents(fare, String(tipPercent)) : 0;
  const lines = [line(hourly ? fill(LABELS.fareHours, { hours: trip.hours }) : LABELS.fare, fare), ...feeLines(fee)];
  if (plain || tolls) lines.push(line(LABELS.tolls, tolls));
  if (meet) lines.push(line(LABELS.meet, meet));
  if (stops) lines.push(line(stopLabel(stopCount, stops), stops));
  if (seats) lines.push(line(seatLabel(seatCount, seats), seats));
  for (const k of DOG_SIZES) if (dogCents[k]) lines.push(line(dogLabel(k, dogCount[k], dogCents[k]), dogCents[k]));
  if (tip) lines.push(line(custom ? LABELS.gratuityAmount : tipLabel(tipPercent), tip));
  return {
    legs,
    fare,
    fee,
    tolls,
    estimate,
    meet,
    seats,
    seatCount,
    seatLabel: seats ? seatLabel(seatCount, seats) : "",
    dogs,
    dogCounts: dogCount,
    dogCents,
    dogLabels: DOG_SIZES.filter((k) => dogCents[k]).map((k) => dogLabel(k, dogCount[k], dogCents[k])),
    stops,
    stopCount,
    stopLabel: stops ? stopLabel(stopCount, stops) : "",
    tip,
    tipPercent,
    total: fare + fee + tolls + stops + meet + seats + dogs + tip,
    value: fare + stops + meet + seats + dogs,
    lines,
    notes: laterNotes(service, flatPart(trip), airportDistance(trip), estimate !== null),
    service,
  };
}

export function shownLines(lines) {
  const fees = [LABELS.tax, LABELS.bcf];
  const shown = [];
  for (const item of lines) {
    const merged = shown.find((entry) => entry.label === LABELS.taxes);
    if (!fees.includes(item.label)) shown.push(item.label === LABELS.tolls ? line(LABELS.tollsShort, item.cents) : item);
    else if (merged) merged.cents += item.cents;
    else shown.push(line(LABELS.taxes, item.cents));
  }
  return shown;
}

export const knownVehicle = (key) => has(VEHICLES, key) || has(RETIRED_VEHICLES, key);

export function vehicleLabel(key, event) {
  const { cls, model, name } = has(VEHICLES, key) ? VEHICLES[key] : RETIRED_VEHICLES[key];
  const label = name || (model ? `${model} (${CLASSES[cls].name})` : CLASSES[cls].name);
  return event && cls === "sprinter" ? fill(LABELS.forEvent, { vehicle: label }) : label;
}

export function vehicleName(cls, vehicle, event) {
  if (knownVehicle(vehicle) && (VEHICLES[vehicle] || RETIRED_VEHICLES[vehicle]).cls === cls && (VEHICLES[vehicle] || RETIRED_VEHICLES[vehicle]).name) return vehicleLabel(vehicle, event);
  return has(CLASSES, cls) ? CLASSES[cls].name : "";
}

export function describe({ hourly, cls, vehicle, event, hours, count, direction, airport, tenths, minutes, flat }) {
  if (hourly) return knownVehicle(vehicle) ? fill(LABELS.hourlyLine, { vehicle: vehicleLabel(vehicle, event), hours }) : "";
  if (!has(CLASSES, cls)) return "";
  const name = vehicleName(cls, vehicle);
  if (Number.isInteger(tenths) && Number.isInteger(minutes)) return fill(flat === "return" ? LABELS.returnFlat : flat === "out" ? LABELS.outFlat : count > 1 ? LABELS.distanceLegs : LABELS.distance, { class: name, legs: count, transfers: count - 1, miles: (tenths / 10).toFixed(1), minutes });
  if (count > 1) return fill(LABELS.legs, { class: name, legs: count });
  if (!AIRPORT_PLACES.includes(airport) || (direction !== "to-airport" && direction !== "from-airport")) return "";
  return fill(direction === "to-airport" ? LABELS.to : LABELS.from, { airport: PLACES[airport], class: name });
}

export function rideTotals(trip) {
  if (!distanceTrip(trip)) return null;
  return trip.legs.filter((item) => !item.flat).map((item) => item.driven || item.ride).reduce((sum, ride) => ({ tenths: sum.tenths + ride.tenths, minutes: sum.minutes + ride.minutes }), { tenths: 0, minutes: 0 });
}

export function serviceLabel(input) {
  const trip = chargedTrip(input);
  const legs = trip.legs || legsOf(trip);
  const first = legs[0] || {};
  return describe({ hourly: trip.trip_type === "hour", cls: trip.class, vehicle: trip.vehicle, hours: trip.hours, count: legs.length, direction: first.direction, airport: first.airport, flat: flatPart(trip), ...rideTotals(trip) });
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

const metaText = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
export const placeText = (value) => metaText(value).replace(/, USA$/, "");

export function pickupWhen(date, time) {
  if (!validDate(date) || !TIME.test(time)) return "";
  const [weekday, day] = formatDate(date).split(", ");
  return `${weekday} ${day}, ${formatTime(time)}`;
}

export function shortPlace(words, zone) {
  if (/^(jfk|lga|ewr|teb)$/.test(zone)) return PLACES[zone];
  return Array.from(headerText(placeText(words)).split(",")[0].trim()).slice(0, 60).join("");
}

export function routeSummary(metadata, from, to) {
  const f = (name) => metaText(metadata[name]);
  if (f("service") === "hourly") return from && /^\d+$/.test(f("hours")) ? fill(MAIL.routeHourly, { hours: f("hours"), from }) : from;
  const back = validDate(f("return_date")) && TIME.test(f("return_time"));
  return from && to ? fill(back ? MAIL.routeReturn : MAIL.route, { from, to, when: pickupWhen(f("return_date"), f("return_time")) }) : "";
}

export function subjectParts(metadata) {
  const data = bookingData(metadata);
  const f = (name) => metaText(data[name]);
  return { car: vehicleName(f("class"), f("vehicle"), f("service") === "hourly" && f("event") === "1"), from: shortPlace(f("from_text"), f("from_zone")), to: shortPlace(f("to_text"), f("to_zone")) };
}

export function ownerSubject(metadata, ref) {
  const f = (name) => metaText(metadata[name]);
  const { car, from, to } = subjectParts(metadata);
  const route = routeSummary(metadata, from, to);
  const details = [pickupWhen(f("date"), f("time")), car, route].filter(Boolean).join(", ");
  return `${fill(MAIL.ownerSubject, { ref })}${details ? `: ${details}` : ""}`;
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
  for (const [k, n] of Object.entries(bagCounts(trip))) if (n) lines.push(`${LABELS.bagTypes[k]}: ${n}`);
  if (one && has(CLASSES, trip.class)) lines.push(`Vehicle: ${vehicleName(trip.class, trip.vehicle)}`);
  if (hour && has(VEHICLES, trip.vehicle)) lines.push(`Vehicle: ${vehicleLabel(trip.vehicle)}`);
  if (trip.meet) lines.push("Meet and greet: Yes");
  for (const [k, n] of Object.entries(seatCounts(trip))) if (n) lines.push(`${LABELS.seatTypes[k]}: ${n}`);
  for (const [k, n] of Object.entries(dogCounts(trip))) if (n) lines.push(`${LABELS.dogTypes[k]}: ${n}`);
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
  const data = bookingData(metadata);
  const cents = (key) => (INTEGER.test(data[key] || "") ? Number(data[key]) : 0);
  const hourly = data.service === "hourly";
  const distance = data.service === "distance";
  const ride = distance && MILES.test(data.miles || "") && INTEGER.test(data.minutes || "") ? { tenths: Math.round(Number(data.miles) * 10), minutes: Number(data.minutes) } : null;
  const count = INTEGER.test(data.legs || "") ? Number(data.legs) : 1;
  const tolled = distance && INTEGER.test(data.tolls_est_cents || "");
  const flat = distance && cents("tolls_cents") > cents("tolls_est_cents") ? (count === 2 ? "return" : "out") : "";
  const dogs = dogParts(data.dogs);
  const seated = cents("child_seats") || (dogs.length ? CHILD_SEATS.reduce((sum, k) => sum + cents(`${k}_seats`), 0) : 0);
  const dogCents = dogs.reduce((sum, part) => sum + part.cents, 0);
  const service = describe({
    hourly,
    cls: data.class,
    vehicle: data.vehicle,
    event: hourly && data.event === "1",
    hours: data.hours,
    count,
    direction: data.direction,
    airport: data.airport,
    flat,
    ...ride,
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
    lines.push(line(hourly && INTEGER.test(data.hours || "") ? fill(LABELS.fareHours, { hours: data.hours }) : LABELS.fare, cents("fare_cents")), ...(has(data, "bcf_cents") ? legacyLines(cents("tax_cents"), cents("bcf_cents")) : feeLines(cents("tax_cents"))));
    if (cents("tolls_cents")) lines.push(line(LABELS.tolls, cents("tolls_cents")));
    if (cents("meet_cents")) lines.push(line(LABELS.meet, cents("meet_cents")));
    if (cents("stops_cents")) lines.push(line(stopLabel(["stop1_text", "stop2_text"].filter((key) => data[key]).length, cents("stops_cents")), cents("stops_cents")));
    if (cents("seats_cents")) lines.push(line(seatLabel(seated, cents("seats_cents")), cents("seats_cents")));
    for (const part of dogs) lines.push(line(dogLabel(part.size, part.count, part.cents), part.cents));
    if (cents("tip_cents")) lines.push(line(cents("tip_percent") > 0 ? tipLabel(cents("tip_percent")) : LABELS.gratuityAmount, cents("tip_cents")));
  }
  return {
    summary: !known ? "" : validDate(data.return_date || "") && TIME.test(data.return_time || "") ? fill(LABELS.summaryReturn, { date: formatDate(data.date), time: formatTime(data.time), rdate: formatDate(data.return_date), rtime: formatTime(data.return_time), service }) : fill(LABELS.summary, { date: formatDate(data.date), time: formatTime(data.time), service }),
    lines,
    value: cents("fare_cents") + cents("stops_cents") + cents("meet_cents") + cents("seats_cents") + dogCents,
    notes: laterNotes(hourly ? "hourly" : distance ? "distance" : "airport", flat, AIRPORT_PLACES.includes(data.airport), tolled),
  };
}
