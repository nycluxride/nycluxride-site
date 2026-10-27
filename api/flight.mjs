import { json, clean, jsonRequest } from "./_http.mjs";
import { FLIGHT_LOOKUP, normalizeFlight, flightOn, lookupFlight } from "./_flight.mjs";
import { validDate } from "./_trip.mjs";
import { googleOn, mapOn } from "./_google.mjs";

const LIMIT = 1024;
const AIRPORT = /^(?:[A-Z]{3})?$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(request) {
  try {
    const { data, response } = await jsonRequest(request, LIMIT);
    if (response) return response;
    if (data.probe === true) return json(200, { kind: flightOn() ? "on" : "off", ...(googleOn() && { map: mapOn() ? 1 : 0 }) });
    const number = normalizeFlight(clean(data.number, 40));
    const date = clean(data.date, 10);
    const airport = clean(data.airport, 10);
    if (!FLIGHT_LOOKUP.test(number) || !validDate(date) || !AIRPORT.test(airport)) return json(400, { kind: "error", code: "bad" });
    if (!flightOn()) return json(200, { kind: "off" });
    const time = clean(data.time, 5);
    const answer = await lookupFlight(number, date, airport, Date.now(), request, TIME.test(time) ? time : "");
    return json(answer.kind === "busy" ? 429 : 200, answer);
  } catch {
    console.error("handler");
    return json(200, { kind: "error" });
  }
}
