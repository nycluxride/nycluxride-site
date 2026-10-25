import { createHmac } from "node:crypto";
import { googleMock } from "./_http.mjs";
import { mockSuggest, mockDetails, mockRoute } from "./_mock.mjs";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap";
const SUGGEST_MASK = "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";
const DETAILS_MASK = "id,formattedAddress,shortFormattedAddress,addressComponents,types";
const ROUTE_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation";
const BIAS = { circle: { center: { latitude: 40.758, longitude: -73.9855 }, radius: 50000 } };
const PLACES_TIMEOUT_MS = 2500;
const ROUTES_TIMEOUT_MS = 3000;
const MAX_ITEMS = 5;

const serverKey = () => String(process.env.GOOGLE_MAPS_SERVER_KEY || "").trim();
export const googleOn = () => Boolean(serverKey()) || googleMock();
const browserKey = () => String(process.env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
const signingSecret = () => String(process.env.GOOGLE_MAPS_SIGNING_SECRET || "").trim();
export const mapOn = () => googleMock() || Boolean(browserKey() && signingSecret());
const DOWN_MS = 300000;
let downUntil = 0;
export const googleUp = () => googleOn() && Date.now() > downUntil;

async function call(url, init, timeout) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 403 || res.status === 429) downUntil = Date.now() + DOWN_MS;
      return { ok: false, status: res.status };
    }
    downUntil = 0;
    return { ok: true, body: await res.json() };
  } catch {
    downUntil = Date.now() + DOWN_MS;
    return { ok: false, status: 0 };
  }
}

const text = (value) => (value && typeof value.text === "string" ? value.text : "");

function suggestion(prediction) {
  const format = prediction.structuredFormat || {};
  const main = format.mainText ? text(format.mainText) : text(prediction.text);
  const matches = format.mainText && Array.isArray(format.mainText.matches) ? format.mainText.matches : [];
  return {
    id: prediction.placeId,
    main,
    mainMatches: matches.map((match) => [Number(match.startOffset) || 0, Number(match.endOffset) || 0]),
    secondary: text(format.secondaryText),
    types: Array.isArray(prediction.types) ? prediction.types.filter((type) => typeof type === "string") : [],
  };
}

export async function autocomplete(input, session) {
  if (googleMock()) return { ok: true, items: mockSuggest(input) };
  const key = serverKey();
  if (!key) return { ok: false, status: 0 };
  const body = { input, sessionToken: session, includedRegionCodes: ["us"], languageCode: "en", regionCode: "us", locationBias: BIAS };
  const result = await call(
    AUTOCOMPLETE_URL,
    { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": SUGGEST_MASK }, body: JSON.stringify(body) },
    PLACES_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  const list = result.body && Array.isArray(result.body.suggestions) ? result.body.suggestions : [];
  const items = list
    .map((entry) => entry && entry.placePrediction)
    .filter((prediction) => prediction && typeof prediction.placeId === "string")
    .slice(0, MAX_ITEMS)
    .map(suggestion);
  return { ok: true, items };
}

export async function placeDetails(id, session) {
  if (googleMock()) {
    const details = mockDetails(id);
    return details ? { ok: true, details } : { ok: false, status: 404 };
  }
  const key = serverKey();
  if (!key) return { ok: false, status: 0 };
  const query = new URLSearchParams(session ? { sessionToken: session, languageCode: "en", regionCode: "us" } : { languageCode: "en", regionCode: "us" });
  const result = await call(
    `${DETAILS_URL}${encodeURIComponent(id)}?${query}`,
    { method: "GET", headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_MASK } },
    PLACES_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return result.body && typeof result.body === "object" ? { ok: true, details: result.body } : { ok: false, status: 0 };
}

const point = (location) => {
  const lat = location && location.latLng && Number(location.latLng.latitude);
  const lng = location && location.latLng && Number(location.latLng.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export async function computeRoute(waypoints, departure, size) {
  if (googleMock()) return { ok: true, mock: true, ...mockRoute(size, waypoints) };
  const key = serverKey();
  if (!key || waypoints.length < 2) return { ok: false, status: 0 };
  const body = {
    origin: waypoints[0],
    destination: waypoints[waypoints.length - 1],
    intermediates: waypoints.slice(1, -1),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    departureTime: departure.toISOString(),
    languageCode: "en-US",
    units: "IMPERIAL",
  };
  const result = await call(
    ROUTES_URL,
    { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": ROUTE_MASK }, body: JSON.stringify(body) },
    ROUTES_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  const route = result.body && Array.isArray(result.body.routes) ? result.body.routes[0] : null;
  const seconds = route ? parseFloat(String(route.duration || "")) : NaN;
  const meters = route ? Number(route.distanceMeters) : NaN;
  if (!Number.isFinite(seconds) || !Number.isFinite(meters)) return { ok: false, status: 0 };
  const legs = Array.isArray(route.legs) ? route.legs : [];
  return {
    ok: true,
    minutes: Math.ceil(seconds / 60),
    miles: Math.round((meters / 1609.344) * 10) / 10,
    polyline: route.polyline && typeof route.polyline.encodedPolyline === "string" ? route.polyline.encodedPolyline : "",
    start: legs.length ? point(legs[0].startLocation) : null,
    end: legs.length ? point(legs[legs.length - 1].endLocation) : null,
  };
}

export function signUrl(url, secret) {
  const resource = url.slice(url.indexOf("/", url.indexOf("//") + 2));
  const key = Buffer.from(String(secret).replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const signature = createHmac("sha1", key).update(resource).digest("base64").replace(/\+/g, "-").replace(/\//g, "_");
  return `${url}&signature=${signature}`;
}

const coordinate = (value) => String(Math.round(value * 1e6) / 1e6);

export function staticMapUrl(polyline, start, end, size, scale = 1) {
  const key = browserKey();
  const secret = signingSecret();
  if (!key || !secret || !polyline || !start || !end || !size) return "";
  const marker = (label, { lat, lng }) => `&markers=size:mid%7Clabel:${label}%7C${coordinate(lat)},${coordinate(lng)}`;
  const url = `${STATIC_URL}?size=${size.width}x${size.height}&scale=${scale}&format=png&path=color:0x111111ff%7Cweight:5%7Cenc:${encodeURIComponent(polyline)}${marker("A", start)}${marker("B", end)}&key=${encodeURIComponent(key)}`;
  return signUrl(url, secret);
}
