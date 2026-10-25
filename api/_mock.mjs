import { norm } from "./_places.mjs";

const part = (types, longText, shortText = longText) => ({ longText, shortText, types });
const state = (code, name) => part(["administrative_area_level_1", "political"], name, code);
const county = (name) => part(["administrative_area_level_2", "political"], name);
const borough = (name) => part(["sublocality_level_1", "sublocality", "political"], name);
const zip = (code) => part(["postal_code"], code);
const FIXTURES = [
  {
    trigger: "edition",
    item: { id: "mock-edition", main: "The New York EDITION", secondary: "Madison Avenue, New York, NY, USA", types: ["lodging", "hotel"] },
    address: "Madison Ave, New York, NY 10010, USA",
    components: [state("NY", "New York"), county("New York County"), borough("Manhattan"), zip("10010")],
  },
  {
    trigger: "bedford",
    item: { id: "mock-bedford", main: "277 Bedford Avenue", secondary: "Brooklyn, NY, USA", types: ["street_address"] },
    address: "277 Bedford Ave, Brooklyn, NY 11211, USA",
    components: [state("NY", "New York"), county("Kings County"), borough("Brooklyn"), zip("11211")],
  },
  {
    trigger: "hoboken",
    item: { id: "mock-hoboken", main: "Hoboken", secondary: "NJ, USA", types: ["locality", "political"] },
    address: "Hoboken, NJ 07030, USA",
    components: [state("NJ", "New Jersey"), county("Hudson County"), zip("07030")],
  },
  {
    trigger: "westchester",
    item: { id: "mock-hpn", main: "Westchester County Airport", secondary: "White Plains, NY, USA", types: ["airport"] },
    address: "240 Airport Rd, White Plains, NY 10604, USA",
    components: [state("NY", "New York"), county("Westchester County"), zip("10604")],
  },
  {
    trigger: "terminal 4",
    item: { id: "mock-jfk-t4", main: "JFK Terminal 4", secondary: "Queens, NY, USA", types: ["airport"] },
    address: "JFK Terminal 4, Jamaica, NY 11430, USA",
    components: [state("NY", "New York"), county("Queens County"), borough("Queens"), zip("11430")],
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
  };
}

const MANHATTAN = "350 5th Ave, New York, NY 10118";
const ROUTES = [
  ["mock-edition", "mock-bedford", 27, 4.6],
  ["mock-bedford", "mock-edition", 31, 4.8],
  ["mock-edition", "mock-hoboken", 21, 3.9],
  [MANHATTAN, "277 Bedford Ave, Brooklyn, NY 11211", 27, 4.6],
  ["277 Bedford Ave, Brooklyn, NY 11211", MANHATTAN, 31, 4.8],
  [MANHATTAN, "200 Park Ave, New York, NY 10166", 8, 0.9],
  [MANHATTAN, "Greenwich, CT 06830", 52, 31.4],
  ["Greenwich, CT 06830", MANHATTAN, 58, 31.6],
  [MANHATTAN, "1 Ocean Rd, Montauk, NY 11954", 165, 118.3],
];
const key = (text) => (text.startsWith("mock-") ? text : norm(text));
const point = (waypoint) => (waypoint && typeof waypoint.placeId === "string" ? waypoint.placeId : norm(waypoint && waypoint.address));

function mockDrive(waypoints) {
  const ends = Array.isArray(waypoints) && waypoints.length === 2 ? waypoints.map(point) : [];
  const row = ends.length ? ROUTES.find(([from, to]) => key(from) === ends[0] && key(to) === ends[1]) : null;
  return row ? { minutes: row[2], miles: row[3] } : { minutes: 43, miles: 16.8 };
}

export function mockRoute(size, waypoints) {
  const drive = mockDrive(waypoints);
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
