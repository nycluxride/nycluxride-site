import { norm } from "./_places.mjs";
import { arcsOf, project } from "./_tolls.mjs";

const part = (types, longText, shortText = longText) => ({ longText, shortText, types });
const state = (code, name) => part(["administrative_area_level_1", "political"], name, code);
const county = (name) => part(["administrative_area_level_2", "political"], name);
const borough = (name) => part(["sublocality_level_1", "sublocality", "political"], name);
const zip = (code) => part(["postal_code"], code);
const country = (code, name) => part(["country", "political"], name, code);
const US = country("US", "United States");
const FIXTURES = [
  {
    trigger: "edition",
    item: { id: "mock-edition", main: "The New York EDITION", secondary: "Madison Avenue, New York, NY, USA", types: ["lodging", "hotel"] },
    address: "Madison Ave, New York, NY 10010, USA",
    at: [40.741389, -73.987193],
    kinds: ["establishment", "lodging", "point_of_interest"],
    components: [state("NY", "New York"), county("New York County"), borough("Manhattan"), zip("10010"), US],
  },
  {
    trigger: "bedford",
    item: { id: "mock-bedford", main: "277 Bedford Avenue", secondary: "Brooklyn, NY, USA", types: ["street_address"] },
    address: "277 Bedford Ave, Brooklyn, NY 11211, USA",
    at: [40.714224, -73.961452],
    kinds: ["street_address"],
    components: [state("NY", "New York"), county("Kings County"), borough("Brooklyn"), zip("11211"), US],
  },
  {
    trigger: "hoboken",
    item: { id: "mock-hoboken", main: "Hoboken", secondary: "NJ, USA", types: ["locality", "political"] },
    address: "Hoboken, NJ 07030, USA",
    at: [40.743991, -74.032363],
    kinds: ["locality", "political"],
    components: [state("NJ", "New Jersey"), county("Hudson County"), zip("07030"), US],
  },
  {
    trigger: "garden street",
    item: { id: "mock-garden", main: "300 Garden Street", secondary: "Hoboken, NJ, USA", types: ["street_address"] },
    address: "300 Garden St, Hoboken, NJ 07030, USA",
    at: [40.744712, -74.031862],
    kinds: ["street_address"],
    components: [state("NJ", "New Jersey"), county("Hudson County"), zip("07030"), US],
  },
  {
    trigger: "williamsburg",
    item: { id: "mock-williamsburg", main: "Williamsburg", secondary: "Brooklyn, NY, USA", types: ["neighborhood", "political"] },
    address: "Williamsburg, Brooklyn, NY, USA",
    at: [40.71355, -73.96274],
    kinds: ["neighborhood", "political"],
    components: [state("NY", "New York"), county("Kings County"), borough("Brooklyn"), US],
  },
  {
    trigger: "bronx",
    item: { id: "mock-bronx", main: "The Bronx", secondary: "Bronx, NY, USA", types: ["sublocality_level_1", "sublocality", "political"] },
    address: "The Bronx, Bronx, NY, USA",
    at: [40.854, -73.8885],
    kinds: ["sublocality_level_1", "sublocality", "political"],
    components: [state("NY", "New York"), county("Bronx County"), borough("Bronx"), US],
  },
  {
    trigger: "arthur avenue",
    item: { id: "mock-arthur", main: "2344 Arthur Avenue", secondary: "Bronx, NY, USA", types: ["street_address"] },
    address: "2344 Arthur Ave, Bronx, NY 10458, USA",
    at: [40.854924, -73.888711],
    kinds: ["street_address"],
    components: [state("NY", "New York"), county("Bronx County"), borough("Bronx"), zip("10458"), US],
  },
  {
    trigger: "faneuil",
    item: { id: "mock-faneuil", main: "Faneuil Hall", secondary: "Boston, MA, USA", types: ["tourist_attraction", "point_of_interest"] },
    address: "4 S Market St, Boston, MA 02109, USA",
    at: [42.360083, -71.05888],
    kinds: ["establishment", "point_of_interest", "tourist_attraction"],
    components: [state("MA", "Massachusetts"), county("Suffolk County"), zip("02109"), US],
  },
  {
    trigger: "westchester",
    item: { id: "mock-hpn", main: "Westchester County Airport", secondary: "White Plains, NY, USA", types: ["airport"] },
    address: "240 Airport Rd, White Plains, NY 10604, USA",
    at: [41.066959, -73.707575],
    kinds: ["airport", "establishment", "point_of_interest"],
    components: [state("NY", "New York"), county("Westchester County"), zip("10604"), US],
  },
  {
    trigger: "terminal 4",
    item: { id: "mock-jfk-t4", main: "JFK Terminal 4", secondary: "Queens, NY, USA", types: ["airport"] },
    address: "JFK Terminal 4, Jamaica, NY 11430, USA",
    at: [40.644166, -73.782425],
    kinds: ["airport", "establishment", "point_of_interest"],
    components: [state("NY", "New York"), county("Queens County"), borough("Queens"), zip("11430"), US],
  },
  {
    trigger: "far pin",
    item: { id: "mock-far-pin", main: "350 5th Ave", secondary: "New York, NY", types: ["subpremise", "geocode"] },
    address: "350 5th Ave, New York, NY 10118, USA",
    at: [41.01182, -73.69933],
    kinds: ["subpremise"],
    components: [state("NY", "New York"), county("New York County"), borough("Manhattan"), zip("10118"), US],
  },
  {
    trigger: "cn tower",
    item: { id: "mock-cn-tower", main: "CN Tower", secondary: "Bremner Boulevard, Toronto, ON, Canada", types: ["tourist_attraction", "point_of_interest"] },
    address: "290 Bremner Blvd, Toronto, ON M5V 3L9, Canada",
    at: [43.642566, -79.387057],
    kinds: ["establishment", "point_of_interest", "tourist_attraction"],
    components: [state("ON", "Ontario"), zip("M5V 3L9"), country("CA", "Canada")],
  },
];
const mapSvg = (w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#e6e6e6"/><path d="M${Math.round(w / 10)} ${Math.round(h * 0.8)}L${Math.round(w * 0.9)} ${Math.round(h * 0.2)}" stroke="#111111" stroke-width="6" fill="none"/></svg>`;

export function mockSuggest(input) {
  const key = norm(input);
  const typed = String(input ?? "").trim().toLowerCase();
  const items = [];
  for (const { trigger, item } of FIXTURES) {
    if (!key || !(trigger.startsWith(key) || key.includes(trigger))) continue;
    const at = typed ? item.main.toLowerCase().indexOf(typed) : -1;
    items.push({ ...item, types: [...item.types], mainMatches: at >= 0 ? [[at, at + typed.length]] : [] });
    if (items.length === 5) break;
  }
  return items;
}

export function mockDetails(id) {
  const fixture = FIXTURES.find(({ item }) => item.id === id);
  if (!fixture) return null;
  return {
    id: fixture.item.id,
    formattedAddress: fixture.address,
    shortFormattedAddress: fixture.address.split(",")[0],
    addressComponents: fixture.components.map((component) => ({ ...component, types: [...component.types] })),
    types: [...fixture.item.types],
    location: { latitude: fixture.at[0], longitude: fixture.at[1] },
  };
}

const PLACE_AT = new Map([
  ["350 5th Ave, New York, NY 10118", [40.748441, -73.985664]],
  ["277 Bedford Ave, Brooklyn, NY 11211", [40.714224, -73.961452]],
  ["200 Park Ave, New York, NY 10166", [40.753606, -73.976457]],
  ["Greenwich, CT 06830", [41.026489, -73.628456]],
  ["1 Ocean Rd, Montauk, NY 11954", [41.035144, -71.944656]],
  ["Secaucus, NJ 07094", [40.789543, -74.056534]],
  ["806 6th Street, Secaucus, NJ", [40.78825, -74.06184]],
  ["Niagara Falls, NY 14303", [43.09447, -79.05671]],
  ["1500 Market St, Philadelphia, PA 19102", [39.952584, -75.165953]],
  ["1 Beacon St, Boston, MA 02108", [42.3585, -71.0618]],
  ["Raleigh, NC", [35.77959, -78.638179]],
  ["Bar Harbor, ME 04609", [44.3876, -68.2043]],
  ["John F. Kennedy International Airport, Queens, NY 11430", [40.641311, -73.778139]],
  ["John F. Kennedy International Airport Terminal 1, Queens, NY 11430", [40.643365, -73.789667]],
  ["John F. Kennedy International Airport Terminal 4, Queens, NY 11430", [40.644166, -73.782425]],
  ["John F. Kennedy International Airport Terminal 5, Queens, NY 11430", [40.645545, -73.776574]],
  ["John F. Kennedy International Airport Terminal 7, Queens, NY 11430", [40.648706, -73.783089]],
  ["John F. Kennedy International Airport Terminal 8, Queens, NY 11430", [40.646648, -73.789688]],
  ["LaGuardia Airport, East Elmhurst, NY 11371", [40.776927, -73.873966]],
  ["Newark Liberty International Airport, Newark, NJ 07114", [40.689532, -74.174462]],
  ["Teterboro Airport, Teterboro, NJ 07608", [40.850103, -74.060837]],
].map(([text, at]) => [norm(text), at]));
const AREA = [40.758, -73.9855];

function placeAt(text) {
  const fixture = FIXTURES.find(({ item }) => item.id === text);
  if (fixture) return fixture.at;
  const known = PLACE_AT.get(norm(text));
  if (known) return known;
  let hash = 0;
  for (const char of norm(text)) hash = (hash * 31 + char.codePointAt(0)) % 100003;
  return [AREA[0] - 0.08 + (hash % 160) / 1000, AREA[1] - 0.08 + ((hash / 160) % 160) / 1000].map((n) => Math.round(n * 1e6) / 1e6);
}

const meters = ([a, b], [c, d]) => {
  const rad = Math.PI / 180;
  const x = (d - b) * rad * Math.cos(((a + c) / 2) * rad);
  return Math.hypot(x, (c - a) * rad) * 6371000;
};

export function mockReverse(lat, lng) {
  const near = FIXTURES.map((fixture) => [meters([lat, lng], fixture.at), fixture]).filter(([distance]) => distance <= 300).sort((a, b) => a[0] - b[0]);
  return near.flatMap(([, { item, address, components, at, kinds }]) => {
    const parts = components.map((component) => ({ ...component, types: [...component.types] }));
    const result = (placeId, formattedAddress, types) => ({ placeId, location: { latitude: at[0], longitude: at[1] }, granularity: "ROOFTOP", formattedAddress, addressComponents: parts, types });
    return [result(item.id, address, [...kinds]), result(`${item.id}-area`, address.split(", ").slice(1).join(", "), ["postal_code"])];
  });
}

export function mockLocate(text) {
  const at = placeAt(String(text ?? ""));
  return { ok: true, location: { lat: at[0], lng: at[1] } };
}

function encode(points) {
  let out = "";
  let last = [0, 0];
  for (const item of points) {
    const next = item.map((n) => Math.round(n * 1e5));
    for (let i = 0; i < 2; i++) {
      let value = next[i] - last[i];
      value = value < 0 ? ~(value << 1) : value << 1;
      while (value >= 0x20) {
        out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
        value >>= 5;
      }
      out += String.fromCharCode(value + 63);
    }
    last = next;
  }
  return out;
}

function mockPath(waypoints) {
  const ends = waypoints.map((waypoint) => placeAt(waypoint && typeof waypoint.placeId === "string" ? waypoint.placeId : String((waypoint && waypoint.address) || "")));
  const line = [ends[0]];
  for (let i = 1; i < ends.length; i++) {
    const [a, b] = [ends[i - 1], ends[i]];
    line.push([a[0] + (b[0] - a[0]) * 0.35, a[1] + (b[1] - a[1]) * 0.8], b);
  }
  return { polyline: encode(line), points: ends, start: { lat: ends[0][0], lng: ends[0][1] }, end: { lat: ends[ends.length - 1][0], lng: ends[ends.length - 1][1] } };
}

const MANHATTAN = "350 5th Ave, New York, NY 10118";
const SECAUCUS = "Secaucus, NJ 07094";
const JFK = "John F. Kennedy International Airport, Queens, NY 11430";
const SECAUCUS_STREET = "806 6th Street, Secaucus, NJ";
const NIAGARA = "Niagara Falls, NY 14303";
const PHILADELPHIA = "1500 Market St, Philadelphia, PA 19102";
const EWR = "Newark Liberty International Airport, Newark, NJ 07114";
const RIVERSIDE = "19 Coventry Ln, Riverside, CT 06878";
const STEAMBOAT = "1 Steamboat Rd, Greenwich, CT 06830";
const STATEN = "10 Richmond Terrace, Staten Island, NY 10301";
const ROUTES = [
  [MANHATTAN, STATEN, 38, 13.4, 1424],
  [EWR, RIVERSIDE, 64, 52.5, 2250],
  [RIVERSIDE, EWR, 70, 52.9, 571],
  [STEAMBOAT, RIVERSIDE, 9, 3.2, 0],
  [RIVERSIDE, STEAMBOAT, 9, 3.3],
  ["mock-edition", "mock-bedford", 27, 4.6],
  ["mock-bedford", "mock-edition", 31, 4.8],
  ["mock-edition", "mock-hoboken", 21, 3.9],
  [MANHATTAN, "277 Bedford Ave, Brooklyn, NY 11211", 27, 4.6],
  ["277 Bedford Ave, Brooklyn, NY 11211", MANHATTAN, 31, 4.8],
  [MANHATTAN, "200 Park Ave, New York, NY 10166", 8, 0.9],
  [MANHATTAN, "Greenwich, CT 06830", 52, 31.4],
  ["Greenwich, CT 06830", MANHATTAN, 58, 31.6],
  [MANHATTAN, "1 Ocean Rd, Montauk, NY 11954", 165, 118.3],
  [SECAUCUS, JFK, 45, 25],
  [JFK, SECAUCUS, 52, 25.4],
  ["John F. Kennedy International Airport Terminal 4, Queens, NY 11430", SECAUCUS, 50, 25.2],
  [SECAUCUS, "Newark Liberty International Airport, Newark, NJ 07114", 18, 9],
  [JFK, "1 Ocean Rd, Montauk, NY 11954", 125, 104.6],
  [SECAUCUS_STREET, NIAGARA, 420, 400],
  [NIAGARA, SECAUCUS_STREET, 425, 400.4],
  [PHILADELPHIA, "1 Beacon St, Boston, MA 02108", 322, 308.6],
  [PHILADELPHIA, JFK, 118, 97.5],
  [MANHATTAN, "Raleigh, NC", 480, 501],
  [JFK, "Raleigh, NC", 505, 524.6],
  [MANHATTAN, "Bar Harbor, ME 04609", 721, 480],
];
const STOP_ROUTES = [
  [[EWR, STEAMBOAT, RIVERSIDE], 72, 55.1, 2250],
  [[EWR, STEAMBOAT, MANHATTAN], 98, 63.4, 2250],
];
const key = (text) => (text.startsWith("mock-") ? text : norm(text));
const point = (waypoint) => (waypoint && typeof waypoint.placeId === "string" ? waypoint.placeId : norm(waypoint && waypoint.address));
const same = (names, ends) => names.length === ends.length && names.every((name, i) => key(name) === ends[i]);
const tollInfo = (cents) => (cents === 0 ? {} : { travelAdvisory: { tollInfo: Number.isInteger(cents) ? { estimatedPrice: [{ currencyCode: "USD", units: String(Math.floor(cents / 100)), nanos: (cents % 100) * 10000000 }] } : {} } });

function mockDrive(waypoints) {
  const ends = Array.isArray(waypoints) ? waypoints.map(point) : [];
  const row = ends.length === 2 ? ROUTES.find(([from, to]) => same([from, to], ends)) : null;
  const stops = ends.length > 2 ? STOP_ROUTES.find(([names]) => same(names, ends)) : null;
  const [minutes, miles, cents] = row ? row.slice(2) : stops ? stops.slice(1) : [43, 16.8];
  return { minutes, miles, ...tollInfo(cents) };
}

const OUT_PATH = [[40.68881, -74.19111], [40.69714, -74.18469], [40.70376, -74.18322], [40.70636, -74.17821], [40.71058, -74.17702], [40.71047, -74.16409], [40.70776, -74.15546], [40.70545, -74.15165], [40.71009, -74.14777], [40.71618, -74.13566], [40.72522, -74.13206], [40.7327, -74.12425], [40.74441, -74.12162], [40.75047, -74.11636], [40.75627, -74.10352], [40.75804, -74.08486], [40.7676, -74.06538], [40.78168, -74.05512], [40.80424, -74.03361], [40.8115, -74.02936], [40.82611, -74.02645], [40.83594, -74.01958], [40.86359, -74.01097], [40.87205, -73.99859], [40.87539, -73.99037], [40.87458, -73.98424], [40.86578, -73.97528], [40.85804, -73.97572], [40.85356, -73.96411], [40.84999, -73.94453], [40.84475, -73.92525], [40.84322, -73.89184], [40.83708, -73.87969], [40.83565, -73.8689], [40.82794, -73.84407], [40.8302, -73.833], [40.83629, -73.82458], [40.85723, -73.82646], [40.8712, -73.8337], [40.87894, -73.83309], [40.8847, -73.82329], [40.88733, -73.80271], [40.90018, -73.79574], [40.917, -73.78117], [40.94145, -73.75117], [40.96054, -73.73966], [40.96528, -73.72889], [40.97448, -73.72183], [40.9749, -73.70348], [40.9868, -73.6822], [40.98844, -73.66616], [41.01784, -73.63497], [41.02716, -73.604], [41.03557, -73.59436], [41.0399, -73.58281], [41.03995, -73.5764], [41.04171, -73.5787], [41.04108, -73.58634], [41.03305, -73.58798], [41.03234, -73.58183]];
const BACK_PATH = [[41.03234, -73.58183], [41.03388, -73.57951], [41.0376, -73.57931], [41.03672, -73.58334], [41.04102, -73.58313], [41.04158, -73.57881], [41.03504, -73.59581], [41.02747, -73.60374], [41.01812, -73.63486], [40.98836, -73.66664], [40.98692, -73.68224], [40.97512, -73.70314], [40.97473, -73.72162], [40.96501, -73.72947], [40.96075, -73.73972], [40.94164, -73.75122], [40.91714, -73.78124], [40.90021, -73.79589], [40.88771, -73.80265], [40.88469, -73.82383], [40.87843, -73.83377], [40.87175, -73.83423], [40.85733, -73.82669], [40.83593, -73.82513], [40.83049, -73.83266], [40.82894, -73.84607], [40.8357, -73.86857], [40.83713, -73.87938], [40.84335, -73.89195], [40.84484, -73.9249], [40.85012, -73.94433], [40.85394, -73.96278], [40.85723, -73.97294], [40.86573, -73.97466], [40.87411, -73.98264], [40.87592, -73.98837], [40.87423, -73.99549], [40.8641, -74.01168], [40.83294, -74.0224], [40.81977, -74.0389], [40.81249, -74.0585], [40.79108, -74.08685], [40.76147, -74.11431], [40.74474, -74.12213], [40.73327, -74.1249], [40.72493, -74.13319], [40.71628, -74.13787], [40.70834, -74.15179], [40.70901, -74.15761], [40.71165, -74.1647], [40.70874, -74.16917], [40.70811, -74.18013], [40.69939, -74.18675], [40.69351, -74.18717]];
const STOP_AT = 52;
const STOP_PATH = [...OUT_PATH.slice(0, STOP_AT), [41.0215, -73.6245], ...OUT_PATH.slice(STOP_AT)];
const TURNPIKE_OUT = { from: [40.70776, -74.15546], to: [40.8115, -74.02936] };
const GWB_OUT = { from: [40.85356, -73.96411], to: [40.84999, -73.94453] };
const SPLIT_ROUTES = [
  { names: [EWR, RIVERSIDE], minutes: 79, miles: 52.5, path: OUT_PATH, stops: [], tolls: [TURNPIKE_OUT, GWB_OUT] },
  { names: [RIVERSIDE, EWR], minutes: 81, miles: 50.9, path: BACK_PATH, stops: [], tolls: [{ from: [40.81249, -74.0585], to: [40.70834, -74.15179] }] },
  { names: [EWR, STEAMBOAT, RIVERSIDE], minutes: 87, miles: 55.1, path: STOP_PATH, stops: [STOP_AT], tolls: [TURNPIKE_OUT, GWB_OUT] },
];
const TOLL_WEEK = ["2026-11-09", "2026-11-15"];
const NEW_YORK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const inWeek = (when) => {
  const day = when instanceof Date && Number.isFinite(when.getTime()) ? NEW_YORK_DAY.format(when) : "";
  return day >= TOLL_WEEK[0] && day <= TOLL_WEEK[1];
};
const splitRoute = (waypoints, when) => (Array.isArray(waypoints) && inWeek(when) ? SPLIT_ROUTES.find(({ names }) => same(names, waypoints.map(point))) : null) || null;

function nearest(path, arcs, at, from) {
  let best = null;
  for (let i = Math.max(1, from); i < path.length; i++) {
    const hit = project(path, arcs, at, i);
    if (!best || hit.gap < best.gap) best = { ...hit, i };
  }
  return best;
}

export function mockSplit(body) {
  const stops = (body.intermediates || []).filter((item) => !item.location);
  const fixture = splitRoute([body.origin, ...stops, body.destination], new Date(body.departureTime));
  if (!fixture) return { routes: [] };
  const { path, minutes, miles } = fixture;
  const arcs = arcsOf(path);
  const total = arcs[arcs.length - 1];
  const edges = [0];
  let from = 1;
  let stop = 0;
  for (const item of body.intermediates) {
    if (item.location) {
      const hit = nearest(path, arcs, [item.location.latLng.latitude, item.location.latLng.longitude], from);
      edges.push(hit.at);
      from = hit.i;
    } else {
      edges.push(arcs[fixture.stops[stop++]]);
    }
  }
  edges.push(total);
  const spans = fixture.tolls.map((span) => ({ ...span, at: (nearest(path, arcs, span.from, 1).at + nearest(path, arcs, span.to, 1).at) / 2 }));
  const legs = edges.slice(1).map((end, n) => {
    const inside = spans.filter(({ at }) => at >= edges[n] && at < end);
    const cents = inside.some((span) => !Number.isInteger(span.cents)) ? null : inside.reduce((sum, span) => sum + span.cents, 0);
    return { distanceMeters: Math.round(((end - edges[n]) / total) * miles * 1609.344), duration: `${Math.round(((end - edges[n]) / total) * minutes * 60)}s`, ...(inside.length && tollInfo(cents === null ? undefined : cents)) };
  });
  return { routes: [{ distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), legs }] };
}

export function mockRoute(size, waypoints, when) {
  const split = splitRoute(waypoints, when);
  const fixed = split && { minutes: split.minutes, miles: split.miles, travelAdvisory: { tollInfo: {} }, polyline: encode(split.path), points: [0, ...split.stops, split.path.length - 1].map((i) => split.path[i]), start: { lat: split.path[0][0], lng: split.path[0][1] }, end: { lat: split.path.at(-1)[0], lng: split.path.at(-1)[1] } };
  const drive = fixed || { ...mockDrive(waypoints), ...(Array.isArray(waypoints) && waypoints.length > 1 && mockPath(waypoints)) };
  if (!size) return drive;
  const src = `data:image/svg+xml,${encodeURIComponent(mapSvg(size.width, size.height))}`;
  return { ...drive, map: { src, src2x: src, ...size } };
}

const NEW_YORK_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" });

function newYorkTime(date, time) {
  const offset = NEW_YORK_OFFSET.formatToParts(new Date(`${date}T12:00:00Z`)).find((item) => item.type === "timeZoneName").value.slice(3);
  const utc = new Date(`${date}T${time}:00${offset}`).toISOString();
  return { utc: `${utc.slice(0, 10)} ${utc.slice(11, 16)}Z`, local: `${date} ${time}${offset}` };
}

export function mockFlight(number, date) {
  if (number === "ZZ5000") return null;
  if (number !== "EK201") return [];
  return [
    {
      number: "EK 201",
      status: "Expected",
      lastUpdatedUtc: `${date} 09:00Z`,
      airline: { name: "Emirates", iata: "EK" },
      departure: { airport: { iata: "DXB", municipalityName: "Dubai" }, quality: ["Basic", "Live"] },
      arrival: {
        airport: { iata: "JFK", municipalityName: "New York" },
        scheduledTime: newYorkTime(date, "14:55"),
        revisedTime: newYorkTime(date, "15:10"),
        terminal: "4",
        quality: ["Basic", "Live"],
      },
    },
  ];
}
