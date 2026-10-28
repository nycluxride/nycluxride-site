import { MAX_STOPS } from "./_rates.mjs";
import { json, clean, jsonRequest, clientBudget, instanceBudget } from "./_http.mjs";
import { localById, classifyText } from "./_places.mjs";
import { verifyTicket, routeKey, signRoute } from "./_ticket.mjs";
import { googleOn, computeRoute, mapSize, routeMap } from "./_google.mjs";
import { nycToUtc, validDate } from "./_trip.mjs";

const LIMIT = 1024;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROUTE_IP = 10;
const ROUTE_INSTANCE = 60;
const MAX_TEXT = 200;

const off = () => json(200, { kind: "off" });
const bad = () => json(400, { kind: "error", code: "bad" });
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isEnd = (end) => isObject(end) && ["id", "ticket", "text"].filter((key) => typeof end[key] === "string").length === 1 && (end.text === undefined || placeText(end.text) !== "");
const rowPoint = (row) => (row.gid ? { placeId: row.gid } : { address: row.addr });
const leg = (result, draw) => ({ minutes: result.minutes, miles: result.miles, ...(draw && result.polyline && { path: result.polyline }) });

function placeText(text) {
  const value = clean(text, MAX_TEXT + 1);
  return Array.from(value).length > MAX_TEXT ? "" : value;
}

function when(value) {
  const date = clean(value.date, 10);
  const time = clean(value.time, 5);
  return validDate(date) && TIME.test(time) ? nycToUtc(date, time) : null;
}

function waypoint(end, now) {
  if (typeof end.text === "string") {
    const text = placeText(end.text);
    const { zone, id } = classifyText(text);
    const row = localById(id);
    return row ? rowPoint(row) : zone === "unknown" ? null : { address: text };
  }
  if (typeof end.id === "string") {
    const row = localById(end.id);
    return row ? rowPoint(row) : null;
  }
  const ticket = verifyTicket(end.ticket, null, now);
  return ticket && !ticket.expired ? { placeId: ticket.id } : null;
}

export async function POST(request) {
  try {
    const { data, response } = await jsonRequest(request, LIMIT);
    if (response) return response;
    const stops = data.stops === undefined ? [] : data.stops;
    if (!isEnd(data.from) || !isEnd(data.to) || !Array.isArray(stops) || stops.length > MAX_STOPS || !stops.every(isEnd) || (data.back !== undefined && !isObject(data.back))) return bad();
    const now = Date.now();
    const waypoints = [data.from, ...stops, data.to].map((end) => waypoint(end, now));
    const departure = when(data);
    const back = data.back && when(data.back);
    if (waypoints.some((item) => !item) || !departure || (data.back && !back)) return off();
    if (departure.getTime() <= now || (back && back.getTime() <= departure.getTime()) || !googleOn()) return off();
    for (let i = back ? 2 : 1; i > 0; i--) if (!clientBudget(request, "route", ROUTE_IP) || !instanceBudget("route", ROUTE_INSTANCE)) return off();
    const size = mapSize(data.map);
    const [result, home] = await Promise.all([computeRoute(waypoints, departure, size), back && computeRoute([waypoints[waypoints.length - 1], waypoints[0]], back, size)]);
    if (!result.ok) {
      console.error("route", result.status);
      return off();
    }
    if (home && !home.ok) console.error("route", home.status);
    const legs = home && home.ok ? [result, home] : [result];
    const map = routeMap(legs, size);
    const draw = data.draw === 1;
    const [first, last] = [waypoints[0], waypoints[waypoints.length - 1]];
    const keys = [routeKey(first, last, departure.toISOString()), legs[1] && routeKey(last, first, back.toISOString())];
    const token = draw && !stops.length ? signRoute(legs.map((item, i) => [keys[i], Math.round(item.miles * 10), item.minutes]), now) : "";
    const points = draw && Array.isArray(result.points) && result.points.every(Array.isArray) ? result.points : null;
    return json(200, { kind: "ok", ...leg(result, draw), ...(points && { points }), ...(legs[1] && { back: leg(home, draw) }), ...(token && { route: token }), ...(map ? { map } : { attribution: "Google Maps" }) });
  } catch {
    console.error("handler");
    return off();
  }
}
