import { json, clean, jsonRequest, clientBudget, instanceBudget } from "./_http.mjs";
import { AREA_LABELS, AIRPORT_ZONES, ADDRESS_TYPES, classifyText, classifyPlace, localById, areaText, placeLevel, clearMatch } from "./_places.mjs";
import { googleOn, mapOn, mapJsOn, autocomplete, placeDetails, reverseGeocode, geocodeAddress, geocodePlace, spot } from "./_google.mjs";
import { signTicket, verifyTicket, placeProof, proofOk } from "./_ticket.mjs";
import { airportZip } from "./_trip.mjs";
import { LABELS, REASONS } from "./_copy.mjs";

const LIMIT = 1024;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{4,300}$/;
const MAX_TEXT = 200;
const SUGGEST_IP = 120;
const SUGGEST_INSTANCE = 1200;
const PICK_IP = 15;
const PICK_INSTANCE = 100;
const HERE_IP = 20;
const HERE_INSTANCE = 300;
const LOCATE_IP = 30;
const LOCATE_INSTANCE = 300;
const LOCATE_KEEP = 64;
const US_BOXES = [
  [24.3, 49.5, -125, -66.8],
  [51, 71.6, -180, -129.9],
  [51, 53.1, 172, 180],
  [18.8, 22.4, -160.4, -154.7],
  [17.6, 18.6, -67.4, -64.5],
  [13.2, 20.6, 144.6, 146.1],
  [-14.6, -11, -171.2, -168.1],
];
const AREA_TYPES = ["plus_code", "route", "postal_code", "political", "neighborhood", "locality"];
const located = new Map();

const bad = () => json(400, { kind: "error", code: "bad" });
const busy = () => json(429, { kind: "busy" });
const length = (text) => Array.from(text).length;
const raw = (value) => (typeof value === "string" ? value : "");
const labelOf = (item) => (item.main + (item.secondary ? `, ${item.secondary}` : "")).replace(/, USA$/, "");
const PRICED = ["jfk", "lga", "ewr", "teb"];
const OUTSIDE_OK = ["outside", "ewr", "teb", "airport-other", "abroad"];
const conflicts = (text, zone) => (PRICED.includes(text) || text === "airport-other" || text === "abroad" ? text !== zone : text === "outside" && !OUTSIDE_OK.includes(zone));
const onEarth = (lat, lng) => [lat, lng].every((n) => typeof n === "number" && Number.isFinite(n)) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const inArea = (lat, lng) => US_BOXES.some(([south, north, west, east]) => lat >= south && lat <= north && lng >= west && lng <= east);
const kinds = (item) => (Array.isArray(item.types) ? item.types : []);

async function suggest(request, data) {
  const input = clean(data.input, LIMIT);
  if (length(input) < 3 || length(input) > MAX_TEXT || !SESSION.test(raw(data.session))) return bad();
  const { zone } = classifyText(input);
  const typed = zone === "unknown" && airportZip(input) ? { zone, area: LABELS.airportZip, hint: REASONS["airport-zip"].text } : { zone, area: AREA_LABELS[zone] };
  if (!googleOn()) return json(200, { kind: "ok", google: false, items: [], typed });
  if (!clientBudget(request, "places-suggest", SUGGEST_IP) || !instanceBudget("places-suggest", SUGGEST_INSTANCE)) return busy();
  const ask = zone === "unknown" || areaText(input);
  const asked = { ...typed, ...(ask && { ask: true }) };
  const result = await autocomplete(input, data.session);
  if (!result.ok) {
    console.error("places-suggest", result.status);
    return json(200, { kind: "error", google: true, items: [], typed: asked });
  }
  return json(200, { kind: "ok", google: true, items: result.items.map((item, i) => ({ ...item, proof: placeProof(item.id, labelOf(item)), ...(placeLevel(item.types, "outside") && { exact: false }), ...(ask && !i && clearMatch(input, item) && { match: true }) })), typed: asked });
}

async function pick(request, data) {
  const id = raw(data.id);
  const label = clean(data.label, LIMIT);
  if (!PLACE_ID.test(id) || !SESSION.test(raw(data.session)) || !label || length(label) > MAX_TEXT) return bad();
  if (!googleOn()) return json(200, { kind: "off" });
  if (!proofOk(id, label, data.proof) && !proofOk(id, label.replace(/, USA$/, ""), data.proof)) {
    console.error("places-pick", "proof");
    return json(200, { kind: "error" });
  }
  if (!clientBudget(request, "places-pick", PICK_IP) || !instanceBudget("places-pick", PICK_INSTANCE)) return busy();
  const result = await placeDetails(id, data.session);
  if (!result.ok) {
    console.error("places-pick", result.status);
    return json(200, { kind: "error" });
  }
  const zone = classifyPlace(result.details, label);
  if (conflicts(classifyText(label).zone, zone)) {
    console.error("places-pick", "label");
    return json(200, { kind: "error" });
  }
  const level = placeLevel(kinds(result.details), zone);
  const ticket = signTicket(id, zone, label, Date.now(), level);
  if (!ticket) {
    console.error("places-pick", "ticket");
    return json(200, { kind: "error" });
  }
  const location = spot(result.details.location);
  return json(200, { kind: "ok", zone, area: AREA_LABELS[zone], airport: AIRPORT_ZONES.includes(zone), ticket, map: mapOn(), ...(level && { exact: false }), ...(location && { location }) });
}

async function here(request, data) {
  if (!onEarth(data.lat, data.lng)) return bad();
  if (!inArea(data.lat, data.lng)) return json(200, { kind: "far" });
  if (!googleOn() || !mapJsOn()) return json(200, { kind: "off" });
  if (!clientBudget(request, "places-here", HERE_IP) || !instanceBudget("places-here", HERE_INSTANCE)) return busy();
  const result = await reverseGeocode(data.lat, data.lng);
  if (!result.ok) {
    console.error("places-here", result.status);
    return json(200, { kind: "error" });
  }
  const list = result.results.filter((item) => item && typeof item.placeId === "string" && typeof item.formattedAddress === "string" && !kinds(item).some((type) => AREA_TYPES.includes(type)));
  const found = list.find((item) => kinds(item).some((type) => ADDRESS_TYPES.includes(type))) || list.find((item) => kinds(item).includes("intersection"));
  if (!found) return json(200, { kind: "none" });
  const label = clean(found.formattedAddress.replace(/, USA$/, ""), MAX_TEXT);
  const zone = classifyPlace(found, label);
  if (!label || !PLACE_ID.test(found.placeId) || conflicts(classifyText(label).zone, zone)) {
    console.error("places-here", "label");
    return json(200, { kind: "error" });
  }
  if (zone === "abroad") return json(200, { kind: "far" });
  const ticket = signTicket(found.placeId, zone, label, Date.now());
  if (!ticket) {
    console.error("places-here", "ticket");
    return json(200, { kind: "error" });
  }
  return json(200, { kind: "ok", label, zone, area: AREA_LABELS[zone], airport: AIRPORT_ZONES.includes(zone), ticket, location: spot(found.location) || { lat: data.lat, lng: data.lng }, map: mapOn() });
}

async function locate(request, data) {
  const row = localById(raw(data.id));
  const ticket = row ? null : verifyTicket(raw(data.ticket), null, Date.now());
  if (!row && !ticket) return bad();
  if (ticket && ticket.expired) return json(200, { kind: "error" });
  if (!googleOn() || !mapJsOn()) return json(200, { kind: "off" });
  const key = row ? `row ${row.id}` : `place ${ticket.id}`;
  const known = located.get(key);
  if (known) return json(200, { kind: "ok", location: known });
  if (!clientBudget(request, "places-locate", LOCATE_IP) || !instanceBudget("places-locate", LOCATE_INSTANCE)) return busy();
  const result = row && !row.gid ? await geocodeAddress(row.addr) : await geocodePlace(row ? row.gid : ticket.id);
  if (!result.ok) {
    console.error("places-locate", result.status);
    return json(200, { kind: "error" });
  }
  located.set(key, result.location);
  if (located.size > LOCATE_KEEP) located.delete(located.keys().next().value);
  return json(200, { kind: "ok", location: result.location });
}

export async function POST(request) {
  try {
    const { data, response } = await jsonRequest(request, LIMIT);
    if (response) return response;
    if (data.action === "suggest") return await suggest(request, data);
    if (data.action === "pick") return await pick(request, data);
    if (data.action === "here") return await here(request, data);
    if (data.action === "locate") return await locate(request, data);
    return bad();
  } catch {
    console.error("handler");
    return json(200, { kind: "error" });
  }
}
