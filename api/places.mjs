import { json, clean, jsonRequest, clientBudget, instanceBudget } from "./_http.mjs";
import { AREA_LABELS, AIRPORT_ZONES, classifyText, classifyPlace } from "./_places.mjs";
import { googleOn, mapOn, autocomplete, placeDetails } from "./_google.mjs";
import { signTicket, placeProof, proofOk } from "./_ticket.mjs";

const LIMIT = 1024;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{4,300}$/;
const MAX_TEXT = 200;
const SUGGEST_IP = 120;
const SUGGEST_INSTANCE = 1200;
const PICK_IP = 15;
const PICK_INSTANCE = 100;

const bad = () => json(400, { kind: "error", code: "bad" });
const busy = () => json(429, { kind: "busy" });
const length = (text) => Array.from(text).length;
const raw = (value) => (typeof value === "string" ? value : "");
const labelOf = (item) => (item.main + (item.secondary ? `, ${item.secondary}` : "")).replace(/, USA$/, "");
const PRICED = ["jfk", "lga", "ewr", "teb"];
const OUTSIDE_OK = ["outside", "ewr", "teb", "airport-other"];
const conflicts = (text, zone) => (PRICED.includes(text) || text === "airport-other" ? text !== zone : text === "outside" && !OUTSIDE_OK.includes(zone));

async function suggest(request, data) {
  const input = clean(data.input, LIMIT);
  if (length(input) < 3 || length(input) > MAX_TEXT || !SESSION.test(raw(data.session))) return bad();
  const { zone } = classifyText(input);
  const typed = { zone, area: AREA_LABELS[zone] };
  if (!googleOn()) return json(200, { kind: "ok", google: false, items: [], typed });
  if (!clientBudget(request, "places-suggest", SUGGEST_IP) || !instanceBudget("places-suggest", SUGGEST_INSTANCE)) return busy();
  const result = await autocomplete(input, data.session);
  if (!result.ok) {
    console.error("places-suggest", result.status);
    return json(200, { kind: "error", google: true, items: [], typed });
  }
  return json(200, { kind: "ok", google: true, items: result.items.map((item) => ({ ...item, proof: placeProof(item.id, labelOf(item)) })), typed });
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
  const ticket = signTicket(id, zone, label, Date.now());
  if (!ticket) {
    console.error("places-pick", "ticket");
    return json(200, { kind: "error" });
  }
  return json(200, { kind: "ok", zone, area: AREA_LABELS[zone], airport: AIRPORT_ZONES.includes(zone), ticket, map: mapOn() });
}

export async function POST(request) {
  try {
    const { data, response } = await jsonRequest(request, LIMIT);
    if (response) return response;
    if (data.action === "suggest") return await suggest(request, data);
    if (data.action === "pick") return await pick(request, data);
    return bad();
  } catch {
    console.error("handler");
    return json(200, { kind: "error" });
  }
}
