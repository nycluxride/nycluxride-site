import { flightMock, clientBudget, clientKey, instanceBudget } from "./_http.mjs";
import { mockFlight } from "./_mock.mjs";
import { PLACE_LIST } from "./_places.mjs";

export const FLIGHT_LOOKUP = /^(?:[A-Z0-9]{2}|[A-Z]{3})\d{1,4}[A-Z]?$/;
export const FLIGHT_HORIZON_DAYS = 180;
export const FLIGHT_LIVE_HOURS = 48;
export const FLIGHT_DAILY = 80;
export const FLIGHT_IP = 4;
export const FLIGHT_INSTANCE = 12;
export const FLIGHT_CLIENT_DAILY = 10;
const EARLY = /^0[0-3]:[0-5]\d$/;
const LATE_FROM = "18:00";
const LOCAL_IATA = new Set(PLACE_LIST.map((row) => row.iata).filter(Boolean));
const clientDaily = new Map();
const SPLIT = /^([A-Z0-9]{2}|[A-Z]{3})(\d{1,4}[A-Z]?)$/;
const BASE_URL = "https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/";
const TIMEOUT_MS = 4000;
const DAY_MS = 86400000;
const FAR_MS = 6 * 3600000;
const NEAR_MS = 10 * 60000;
const NONE_MS = 30 * 60000;
const LIVE_MS = FLIGHT_LIVE_HOURS * 3600000;
const STATUS_TEXT = new Map([["Expected", "Expected"], ["EnRoute", "En route"], ["Boarding", "Boarding"], ["GateClosed", "Gate closed"], ["Departed", "Departed"], ["Delayed", "Delayed"], ["Approaching", "Approaching"], ["Arrived", "Arrived"], ["Canceled", "Canceled"], ["Diverted", "Diverted"]]);
const CACHE_LIMIT = 500;
const cache = new Map();
const spent = { day: "", count: 0 };
const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

const apiKey = () => String(process.env.FLIGHT_API_KEY || "").trim();
export const flightOn = () => Boolean(apiKey()) || flightMock();
export const normalizeFlight = (text) => String(text ?? "").toUpperCase().replace(/[\s-]+/g, "");

const dayNumber = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const localTime = (time) => (time && typeof time.local === "string" ? time.local.slice(0, 16).replace("T", " ") : "");
const string = (value) => (typeof value === "string" ? value : "");
const instant = (time) => Date.parse(string(time && time.utc).replace(" ", "T"));

function legOf(entry, number) {
  const arrival = (entry && entry.arrival) || {};
  const departure = (entry && entry.departure) || {};
  const airline = (entry && entry.airline) || {};
  const quality = Array.isArray(arrival.quality) ? arrival.quality : [];
  const [, prefix, digits] = SPLIT.exec(number) || ["", "", number];
  return {
    iata: string(arrival.airport && arrival.airport.iata),
    at: instant(arrival.scheduledTime),
    live: quality.includes("Live") && !quality.includes("Approximate"),
    flight: {
      airline: string(airline.name),
      number: `${string(airline.iata) || prefix} ${digits}`,
      origin: { city: string(departure.airport && departure.airport.municipalityName), iata: string(departure.airport && departure.airport.iata) },
      destination: { city: string(arrival.airport && arrival.airport.municipalityName), iata: string(arrival.airport && arrival.airport.iata) },
      terminal: string(arrival.terminal),
      scheduled: localTime(arrival.scheduledTime),
      estimated: localTime(arrival.revisedTime),
      status: STATUS_TEXT.get(string(entry && entry.status)) || "",
      updated: string(entry && entry.lastUpdatedUtc),
    },
  };
}

function remember(key, legs, ttl, now) {
  cache.delete(key);
  cache.set(key, { legs, until: now + ttl });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function fetchLegs(number, date) {
  try {
    const url = `${BASE_URL}${encodeURIComponent(number)}/${date}?dateLocalRole=Both&withAircraftImage=false&withLocation=false`;
    const res = await fetch(url, { headers: { "x-api-market-key": apiKey() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 204) return { ok: true, legs: [] };
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: true, legs: (Array.isArray(body) ? body : []).map((entry) => legOf(entry, number)) };
  } catch {
    return { ok: false, status: 0 };
  }
}

const previousDay = (date) => new Date((dayNumber(date) - 1) * DAY_MS).toISOString().slice(0, 10);

function answerFor(legs, date, iata, now, before = "") {
  const on = (leg, day) => leg.flight.scheduled.slice(0, 10) === day;
  const late = before ? legs.filter((leg) => on(leg, before) && leg.flight.scheduled.slice(11) >= LATE_FROM) : [];
  const arriving = [...late, ...legs.filter((leg) => on(leg, date))];
  const leg = iata ? arriving.find((item) => item.iata === iata) : arriving[0];
  const copy = (item, live) => ({ ...item.flight, origin: { ...item.flight.origin }, destination: { ...item.flight.destination }, estimated: live ? item.flight.estimated : "" });
  if (!leg) return arriving.length ? { kind: "elsewhere", flight: copy(arriving.find((item) => LOCAL_IATA.has(item.iata)) || arriving[0], false) } : { kind: "none" };
  return { kind: "ok", flight: copy(leg, leg.live && Math.abs(leg.at - now) <= LIVE_MS) };
}

async function legsFor(number, date, current, ahead, request) {
  const key = `${number} ${date}`;
  const hit = cache.get(key);
  if (hit && hit.until > current) return { legs: hit.legs };
  if (request && (!clientBudget(request, "flight", FLIGHT_IP) || !instanceBudget("flight", FLIGHT_INSTANCE))) return { kind: "busy" };
  const today = NEW_YORK_DATE.format(new Date(current));
  if (spent.day !== today) {
    Object.assign(spent, { day: today, count: 0 });
    clientDaily.clear();
  }
  if (spent.count >= FLIGHT_DAILY) {
    console.error("flight", "daily");
    return { kind: "off" };
  }
  const client = request ? clientKey(request) : "";
  if (client && (clientDaily.get(client) || 0) >= FLIGHT_CLIENT_DAILY) {
    console.error("flight", "client-daily");
    return { kind: "busy" };
  }
  spent.count++;
  if (client) clientDaily.set(client, (clientDaily.get(client) || 0) + 1);
  const result = await fetchLegs(number, date);
  if (!result.ok) {
    console.error("flight", result.status);
    return { kind: "error" };
  }
  remember(key, result.legs, !result.legs.length ? NONE_MS : ahead > 2 ? FAR_MS : NEAR_MS, current);
  return { legs: result.legs };
}

export async function lookupFlight(number, date, iata, now, request = null, time = "") {
  if (!flightOn()) return { kind: "off" };
  const current = Number(now);
  const ahead = dayNumber(date) - dayNumber(NEW_YORK_DATE.format(new Date(current)));
  if (ahead < 0 || ahead > FLIGHT_HORIZON_DAYS) return { kind: "later" };
  const before = EARLY.test(time) ? previousDay(date) : "";
  const days = before ? [date, before] : [date];
  if (flightMock()) {
    const bodies = days.map((day) => mockFlight(number, day));
    return bodies[0] ? answerFor(bodies.flatMap((body) => (body || []).map((entry) => legOf(entry, number))), date, iata, current, before) : { kind: "error" };
  }
  const legs = [];
  for (const day of days) {
    const found = await legsFor(number, day, current, ahead, request);
    if (!found.legs) {
      if (day === date) return found;
      continue;
    }
    for (const leg of found.legs) if (!legs.some((item) => item.iata === leg.iata && item.flight.scheduled === leg.flight.scheduled)) legs.push(leg);
  }
  return answerFor(legs, date, iata, current, before);
}
