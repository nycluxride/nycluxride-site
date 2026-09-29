import { MAX_STOPS } from "./_rates.mjs";
import { json, clean, jsonRequest, clientBudget, instanceBudget } from "./_http.mjs";
import { localById } from "./_places.mjs";
import { verifyTicket } from "./_ticket.mjs";
import { googleOn, computeRoute, staticMapUrl } from "./_google.mjs";
import { nycToUtc, validDate } from "./_trip.mjs";

const LIMIT = 1024;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROUTE_IP = 10;
const ROUTE_INSTANCE = 60;
const MAP_W = [120, 640];
const MAP_H = [80, 640];

const off = () => json(200, { kind: "off" });
const bad = () => json(400, { kind: "error", code: "bad" });
const within = (n, [min, max]) => Number.isInteger(n) && n >= min && n <= max;
const mapSize = (map) => (map && typeof map === "object" && within(map.width, MAP_W) && within(map.height, MAP_H) ? { width: map.width, height: map.height } : null);
const isEnd = (end) => Boolean(end) && typeof end === "object" && !Array.isArray(end) && (typeof end.id === "string") !== (typeof end.ticket === "string");

function waypoint(end, now) {
  if (typeof end.id === "string") {
    const row = localById(end.id);
    if (!row) return null;
    return row.gid ? { placeId: row.gid } : { address: row.addr };
  }
  const ticket = verifyTicket(end.ticket, null, now);
  return ticket && !ticket.expired ? { placeId: ticket.id } : null;
}

export async function POST(request) {
  try {
    const { data, response } = await jsonRequest(request, LIMIT);
    if (response) return response;
    const stops = data.stops === undefined ? [] : data.stops;
    if (!isEnd(data.from) || !isEnd(data.to) || !Array.isArray(stops) || stops.length > MAX_STOPS || !stops.every(isEnd)) return bad();
    const now = Date.now();
    const date = clean(data.date, 10);
    const time = clean(data.time, 5);
    const waypoints = [data.from, ...stops, data.to].map((end) => waypoint(end, now));
    if (waypoints.some((item) => !item) || !validDate(date) || !TIME.test(time)) return off();
    const departure = nycToUtc(date, time);
    if (departure.getTime() <= now || !googleOn()) return off();
    if (!clientBudget(request, "route", ROUTE_IP) || !instanceBudget("route", ROUTE_INSTANCE)) return off();
    const size = mapSize(data.map);
    const result = await computeRoute(waypoints, departure, size);
    if (!result.ok) {
      console.error("route", result.status);
      return off();
    }
    const answer = { kind: "ok", minutes: result.minutes, miles: result.miles };
    if (result.map) return json(200, { ...answer, map: result.map });
    const src = size && staticMapUrl(result.polyline, result.start, result.end, size, 1);
    return json(200, src ? { ...answer, map: { src, src2x: staticMapUrl(result.polyline, result.start, result.end, size, 2), ...size } } : { ...answer, attribution: "Google Maps" });
  } catch {
    console.error("handler");
    return off();
  }
}
