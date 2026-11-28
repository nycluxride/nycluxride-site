import { norm } from "./_places.mjs";
import { arcsOf, project, decodePath } from "./_tolls.mjs";

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
    trigger: "1332 clinton",
    item: { id: "mock-clinton", main: "1332 Clinton Street", secondary: "Hoboken, NJ, USA", types: ["street_address"] },
    address: "1332 Clinton St, Hoboken, NJ 07030, USA",
    at: [40.753, -74.0343],
    kinds: ["street_address"],
    components: [state("NJ", "New Jersey"), county("Hudson County"), part(["locality", "political"], "Hoboken"), zip("07030"), US],
  },
  {
    trigger: "30 hudson street",
    item: { id: "mock-jersey-city", main: "30 Hudson Street", secondary: "Jersey City, NJ, USA", types: ["street_address"] },
    address: "30 Hudson St, Jersey City, NJ 07302, USA",
    at: [40.7163, -74.0336],
    kinds: ["street_address"],
    components: [state("NJ", "New Jersey"), county("Hudson County"), part(["locality", "political"], "Jersey City"), zip("07302"), US],
  },
  {
    trigger: "500 communipaw",
    item: { id: "mock-communipaw", main: "500 Communipaw Avenue", secondary: "Jersey City, NJ, USA", types: ["street_address"] },
    address: "500 Communipaw Ave, Jersey City, NJ 07304, USA",
    at: [40.715799, -74.068787],
    kinds: ["street_address"],
    components: [state("NJ", "New Jersey"), county("Hudson County"), part(["locality", "political"], "Jersey City"), zip("07304"), US],
  },
  {
    trigger: "1 gateway center",
    item: { id: "mock-newark", main: "1 Gateway Center", secondary: "Newark, NJ, USA", types: ["street_address"] },
    address: "1 Gateway Center, Newark, NJ 07102, USA",
    at: [40.7352, -74.1652],
    kinds: ["street_address"],
    components: [state("NJ", "New Jersey"), county("Essex County"), part(["locality", "political"], "Newark"), zip("07102"), US],
  },
  {
    trigger: "40 south broadway",
    item: { id: "mock-yonkers", main: "40 South Broadway", secondary: "Yonkers, NY, USA", types: ["street_address"] },
    address: "40 S Broadway, Yonkers, NY 10701, USA",
    at: [40.9338, -73.8987],
    kinds: ["street_address"],
    components: [state("NY", "New York"), county("Westchester County"), part(["locality", "political"], "Yonkers"), zip("10701"), US],
  },
  {
    trigger: "2 popham",
    item: { id: "mock-scarsdale", main: "2 Popham Road", secondary: "Scarsdale, NY, USA", types: ["street_address"] },
    address: "2 Popham Rd, Scarsdale, NY 10583, USA",
    at: [40.9887, -73.8087],
    kinds: ["street_address"],
    components: [state("NY", "New York"), county("Westchester County"), part(["locality", "political"], "Scarsdale"), zip("10583"), US],
  },
  {
    trigger: "30 station place",
    item: { id: "mock-stamford", main: "30 Station Place", secondary: "Stamford, CT, USA", types: ["street_address"] },
    address: "30 Station Pl, Stamford, CT 06902, USA",
    at: [41.0466, -73.5418],
    kinds: ["street_address"],
    components: [state("CT", "Connecticut"), county("Fairfield County"), part(["locality", "political"], "Stamford"), zip("06902"), US],
  },
  {
    trigger: "nassau hall",
    item: { id: "mock-princeton", main: "Nassau Hall", secondary: "Princeton, NJ, USA", types: ["point_of_interest", "establishment"] },
    address: "Nassau Hall, Princeton, NJ 08544, USA",
    at: [40.3487, -74.6593],
    kinds: ["establishment", "point_of_interest"],
    components: [state("NJ", "New Jersey"), county("Mercer County"), part(["locality", "political"], "Princeton"), zip("08544"), US],
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
  ["1600 Pennsylvania Ave NW, Washington, DC 20500", [38.897676, -77.036529]],
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
const WASHINGTON = "1600 Pennsylvania Ave NW, Washington, DC 20500";
const EWR = "Newark Liberty International Airport, Newark, NJ 07114";
const RIVERSIDE = "19 Coventry Ln, Riverside, CT 06878";
const STEAMBOAT = "1 Steamboat Rd, Greenwich, CT 06830";
const STATEN = "10 Richmond Terrace, Staten Island, NY 10301";
const RICHMOND_AVE = "2700 Richmond Ave, Staten Island, NY 10314";
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
  [MANHATTAN, "1 Beacon St, Boston, MA 02108", 290, 215.4, 1790],
  ["1 Beacon St, Boston, MA 02108", MANHATTAN, 295, 215.8, 1790],
  [PHILADELPHIA, JFK, 118, 97.5],
  [MANHATTAN, PHILADELPHIA, 125, 95.6, 2117],
  [PHILADELPHIA, MANHATTAN, 130, 95.9, 1717],
  [MANHATTAN, WASHINGTON, 250, 226.2, 3150],
  [WASHINGTON, MANHATTAN, 255, 226.6, 3150],
  [MANHATTAN, "Raleigh, NC", 480, 501],
  [JFK, "Raleigh, NC", 505, 524.6],
  [MANHATTAN, "Bar Harbor, ME 04609", 721, 480],
];
const STOP_ROUTES = [
  [[EWR, STEAMBOAT, RIVERSIDE], 72, 55.1, 2250],
  [[EWR, STEAMBOAT, MANHATTAN], 98, 63.4, 2250],
];
const LINCOLN_EXIT = [40.76179, -74.02659];
const LINCOLN_DYER = { from: [40.75393, -73.99757], to: LINCOLN_EXIT };
const LINCOLN_37TH = { from: [40.75533, -73.995], to: LINCOLN_EXIT };
const T4 = "John F. Kennedy International Airport Terminal 4, Queens, NY 11430";
const COMMUNIPAW = "mock-communipaw";
const LINES = [
  { names: [T4, COMMUNIPAW], at: "14:00", minutes: 80, miles: 37.7, cents: 887, points: [[40.643925,-73.783068],[40.715799,-74.068787]], polyline: "ogawFdwiaMsEiNU_@[Um@K]D_@NoBpA[^_@x@WpAKjA?pAHx@bDpJtCxJ`@jCHvA?zBC|JLpKj@dUAxCOvC_@vCc@dCq@fCcAjCaAlBkAdBqD`E{ExEkDxCqFbE}DjCaGdD{ClA}Bn@yCf@kCPaCBkCIuC]eCk@mC{@oCqA}A_AqBkB_AiAq@wAy@oCq@wBi@gAs@aA}@w@_Ak@}Aa@kHi@uEUiC_@KSaB]Wq@Ec@Fc@Pa@\\SZAVLLPL`@Bp@@b@FLUdQPp@NvAHlE@rALlA]d\\BnEHvBVvCl@lDnA~F`BjHp@zDV|BLfCB~DEtGg@`Xq@zUg@nJ]zDa@lCuCxNa@xCSxBIlC@tBFvAVbCn@tDz@zDfCrIxE~NrCdIdFpM~C~GrCfFdCzD~BdD|KbO`FnHxGvK|CxFxFfLfI|QvJzTjBpDhChE~B`DbDtDvBtBtCdCxDjCrDrBfGvCdLvEbJrDvGdCbD`BnFfDnDrCbExDpDjEbBbC|GrLpIzNlBfDlE|H`LzR~ArBzB`CzAtArA`A~BrArBz@rBh@nC`@fCLpCC~Kk@fJU|ICzEDfEZ|Dl@xOxDdDh@hMpA~Bf@pBp@bCjAvBvA`BvA~AdBzAvBpA|BdA|BxE`Mz@dBjAbBnAxA`BvAlBlAzBbAnBj@hAVvBTlBHdDEvBYdC[jBEvBBlBRfB^pBr@lCtAhAx@~AzApA`Br@lAlIvRx@fCh@zBt@lE^fDb@lFT~ELxF?zFEhEMxD]dG_@bEi@zD{ApJ_BxHoAbGe@bDShCKpFFnEXrEd@`F~A~O|@`L`@dHj@xMZhMD~DG`EUxEq@pHSvDIbE@tFFtCPfEdAxMz@fKf@tJPtGNbHTzGLvBp@`IpB~QXxCXrEJhDAzEKhEo@hJoAxM}@xHq@fFk@vDq@`DgAvDcApCeAvBeA`BsA`ByAxAw@n@iCzAsCnAsGhCuCvAoCfBwD`DoClCaDtDaCbDyBfDg@|@sAtC}@lC}@pDk@lD_AnGa@hB}@tCu@jBwCtFqLpTmBfEgApCsAlEy@dDy@dEoDxSmBjJgDrO_@fCUxCIfC@zDVdHHhEClCMhCWnBe@`Ci@dBi@pAkBtD]TmA~AyCzCqAfAc@Vw@Ry@Dm@GwA]uAu@yUqPg@c@Ue@Kk@?m@Fm@Re@X[d@Sh@?ZJb@ZbAnAbGbJn@bBd@bB?RvAnFvGrYbDrNrP|u@bH`[lDjPzCfNX~BHvBCvBa@dHY|Ck@fEgAzFkCjLcDpL}D`N_AbEw@~Ec@vDa@|FOfFUzVS|E_@rEe@rDu@~D}@lDoOpf@o@jCg@|C_@nDOvCCjCFdJ~@vy@@lEC|BQhDYhCmBfM[hDKpC?hDLlDVlCf@~ClEjT`B`KnAtJv@vI`@nFf@lKRpG\\lQ|Avw@?xAKbEWhDc@xDk@|C_ApDgA~CiAfCiArBSDcApAo@d@}CvAgQpHgAP}@?}BYIBiEy@cBi@aBw@}AkAwSiSqDyCkAw@cDeByCmAiCw@yJ}BmCSqAA_Kj@mEBcEKkCSeM_BcCi@ea@{Lue@_OuDcBqC_BmFmDwQaMsAqAcA{Ak@sAc@cBYiBKyAAwBR_LZgN?cEK{CYyD_@aD_AgFsAqFqAkEmAcDqAoC{EgIyBsDiB}DoA_DqAmEk@gCeAcGq@gFk@uD_@cBg@uAWk@y@sAaAeAeAw@_Ac@oA]cAMyAAsAN_Ch@{DlAkCp@qANw@@iAIqBe@{TsHuG_C_CgAkCcBue@w_@u@aAcAuB]iB_@}DD]KkBDoALo@Rg@Z]`@Ql@C`@Hb@XVb@Pj@HtAQjASt@m@tAq@bAgAjAuA~@}@^_@Du@?cAO}@a@aEaDc@_@y@e@cDmC}CiCUc@Mo@CiA?gEKaDa@cEw@{Dy@oCMSeBkF}AuDuBeEuBeD{ByCcNkNiTuTcC{CqB}CkBqDaB}DsA_E_AqDcEcSy@yCoAsDyAgDaB}CQYE[}@_CQcA[{EScA[k@]W]Ga@Dk@\\c@l@i@nAYjAOnACr@D~@Hl@Tt@JVN~@bBvD`@nAFJ?f@_C`QGnA@lAPfBj@zEBtAAXKf@M`@{C{B_C{AqFyDyAuAsBqBi@[qAi@{I_DmHmFiAqB{@_Bs@eAaEaDoQcKmCbGg@pA" },
  { names: [T4, COMMUNIPAW], at: "", minutes: 86, miles: 25.6, cents: 1041, points: [[40.643925,-73.783068],[40.715799,-74.068787]], polyline: "ogawFdwiaMsEiNU_@[Um@K]D_@NoBpA[^_@x@WpAKjA?pAHx@bDpJtCxJ`@jCHvA?zBC|JLpKj@dUAxCOvC_@vCc@dCq@fCcAjCaAlBkAdBqD`E{ExEkDxCqFbE}DjCaGdD{ClA}Bn@yCf@kCPaCBkCIuC]eCk@mC{@oCqA}A_AqBkB_AiAq@wAy@oCq@wBi@gAs@aA}@w@_Ak@}Aa@kHi@uEU}F{@uCa@kCM{FOcGBkGPsCZuCn@oC~@uHtCsJ`DqPpGiKzDcG`C}DxA{FdCoU|K}FpCoFnCcPnH}C|AmDpB_HdDiEdBiLbE{CbAgC~@gC|@uB~@UP_J~DoQ|Iu@b@_BlAqBfBiBxByDfFyA|AkBzAaO|IcDpAyBb@gBPcC@eHMaBJeBX_Bh@mJdFsBzAwAtAsA|AwC|EaDnF_AjAoAfA{A~@gi@bU_Cn@aC`@aFRmHV}CXgJdByE~@SKw@Bq@Gs@Yu@m@s@o@o@Oi@D_@P[ZWn@Kr@Bx@Jh@~JhWP^PFvRfh@d@zAzBbJz@fEx@zF|@vIp@`Fj@vCbPjx@|DvPvDtQ~Gl\\r@xCrDfMf@dC\\pCNbCr@vSRbCj@nDp@nCp@nBpBlErCzFhAdDf@lB`@fCXrCJfCBnCEvBw@pRcBda@C^Ub@i@`Di@xBeA`Dw@jBeC|EoBlEcCrFqAtDm@zBe@lCeB|KmExUk@zBk@|Ag@`Aw@z@_CfBkCfB}@fAa@bAUfAMrA@fANzAR~@l@`Bz@tAjApAhAx@~CbBVD|H|EjB~@hCnBxAxAlJ~KlB~B`AzAt@zAl@~Aj@lBlB~J|CnQj@|Bj@dB|DxIxA`CpCnE~CnG|DbI~I`QpIhO`BfC~DpFvHfJT?dCfBxEpCz@x@p@z@l@rA`@xARxAt@dPApAIx@cAlEkExSUl@{CzNs@vC_AxEsFvWkAvFmChN}@bE?VqLhl@iAxEgCpLcAnEQ|@C\\wEpUDTsFlUfBtAoChIiH|Q?TQhAy@nIQhDKl@Q`AYn@[`@g@Ty@AKB_AEs@Re@X]`@Wj@Qn@Ix@s@dOm@nI_A|SOdCkB`SoAzLgC|XUzDmAnZIvBUjBmDzOa@pAm@rAm@fAoAjBo@|AQj@S`A{B`j@ArALhDBh@Gz@BxBSjKFlBPpAZfAf@|@z@~@zAbAvBdAbDlA~r@jQfLnCdCZ|BJdB@jC[`Ba@tAg@~IaElAc@rAS~AGfBJ~AVhBf@pAl@dAp@x@v@x@dA`A`B|ApDzHrRbBpEnEfKr@vAxCfEzBhCH\\n@bAb@bAXnAj@pEZrAb@jAn@hAxA`D`@nAFJ?f@_C`QGnA@lAPfBj@zEBtAAXKf@M`@{C{B_C{AqFyDyAuAsBqBi@[qAi@{I_DmHmFiAqB{@_Bs@eAaEaDoQcKmCbGg@pA" },
  { names: [COMMUNIPAW, T4], at: "", minutes: 69, miles: 36.2, cents: 2225, points: [[40.715799,-74.068787],[40.643925,-73.783068]], polyline: "whowF|pacMvAkD|AiDnQbKhEjD~@vAhBlDfBtAlE~C|JpD~@^~@x@xArAbB~AjGhEnCjBzAhA\\f@`CzBf@~@fB|DnAlClIlNvO`U~@mA|BkDxE}G|CmElXbYZ`@Dy@D_CCMJmEZ]NDPVT`@Jd@zArFhBjH|AnFvAbEbBdE~DpIvCfG~B|EX`@BTvBhBJN~DxCp@p@p@`An@xAZpAz@dHd@~A\\x@v@nAd@f@vc@`^~C`CxE|BxL|DdEvA|J`DZHnADpAErAUzK}CvAQrA?r@Fr@NjA`@bAl@b@\\~@fAp@fAn@~Ab@`BpBtNv@hEfAnE~@zCfArCzA~CbDrFxDnGfBzD|AfEtAtEz@jDr@`El@|ETrDHtDCfEs@p]B~ANvA\\zAd@rAd@z@t@~@dA|@zGdEnQtLzCdBbDxAbQnFp_@lLlVnHpB`@`OfB`CVrBP~AB`FKrGc@vACn@@zBXfLjCbDjAlCrAvBrAnCrBjTzSdBvArBhA|Al@tGvAjAd@zDpCdGvE|@\\`AL|@A`ASt@_@v@s@f@s@d@kATaALqARoHLkARaAVq@`@w@AYjAoBxAcDjAeD|@kDf@aCf@sDXeDT_F@cEaAoh@w@{][_Ke@mJi@oHw@aIu@eGqAmIcAmFgDePa@kCOsBQeE?sCJiDVqCNwAjBkLTaCJ}B@{BKgKk@cc@[{YDsCPiD\\gDh@eDz@kDjNyc@jAyEv@aEh@}D\\eERmG\\sYPeE^}Ef@{Dt@iE`A_EnEaOlCcKpCuLbAkFd@wDVwDNuEBiDEwBIeAU}AsFaWyCqNaXslAcMwj@aAmEy@}COIs@oB_AcB{@kAyAwA}AgAe@WI@]Gm@Di@\\UZSh@EZA`AJn@Th@h@h@nGrEnKdIr@t@~A`Cn@j@l@Vv@Jl@Al@Kp@Yj@g@zBoChCwDn@eAD_@xAwCdAqCp@aCd@aCXoCJiC@_DKgDWeHAwCH}CPgC\\{B`BkIvC_N|AoInCwOx@uDlAcElAmDnAyCtDeHvL{ThAoCt@cCp@aDxA_Kn@uCp@{Bz@wBbAmBzBqDfDqEfCwCxB{B|DgDlCkBdCuAvB_A|FwBzBgAlBmAx@m@jBmBrAgBrA_C~@wBnAyDj@wBz@qEzAuLdAuJ~@iKf@mHJsE@uEKwD_@qFq@yGqAeLc@eFa@sHUgHWeK_@wIm@}I}AeRQeEI_DAcGJeENiCv@sJRkEDyEOaJ_@qLk@oLw@wKaAwKy@wHw@oJK}CAoDDgCRuCVyBjA_G|BiKxAiH|@iFXoB^eEX_GH_FBeEEcGS}Fc@kGe@_Eg@uCc@kBcA}C{KcWeAkBmAaB{A{AgA{@mAu@aBs@kA_@cCc@qBOwBAgBJ}G|@kCR}BCwAQsBc@cBo@iB_AgBqAeAcAsAeBkAoBs@yAoE{LkAcCwAaCcB{BgBiBwAiAeBiAmB_A{By@kCm@qEe@oGk@sCc@uNmDeEq@eCWiDOyJAgJNqEJqCA{DSgCYkDm@yCw@wCeA{CuAkDsBwBcBgBgBcBwB}@uA}S}^oOeXgCiDgDuDaD{CcDiCmCiBoC}AsDeBc]_NeGqCeCqA}DeCqCsBmD_DwB}BeDiEuB_DaCkE_CeFiOo]kDsHqEwI_HsLaEsGmEkGkLuOgCwDcDyFcC}EqCwGeGoP{DmLqDqLq@oCeAmFWyBOgD?cCNmC`@eDj@aDxBwKf@kDP}BRYl@{Fb@uHJsAXmArCgHXoALiB?wAGkDDsC@]GU~@cMx@}M|AcY@mBC{AMsBWuBg@wBiEqMe@kBa@wB_@uCc@{Eg@kJLYFs@XcA\\m@d@a@l@Sl@Ep@JdAf@t@f@JAdHpGvApAdBdBlA|@pC|ApChArBn@zBb@jCXhCJlAA`FY`Ca@hCs@jBq@vEeCfFcDtEgDvE{DjFeFtDeEbAsAfAoBfAiCx@mCj@mC\\oCTaDDiDEiDk@_THQFaCb@qM?gBQqCC_ALq@vAkEXoARo@`AoANc@D{@Ck@eA{CM_@" },
  { names: [T4, MANHATTAN, COMMUNIPAW], at: "", minutes: 92, miles: 26.5, cents: 1637, points: [[40.643925,-73.783068],[40.749028,-73.985937],[40.715799,-74.068787]], polyline: "ogawFdwiaMsEiNU_@[Um@K]D_@NoBpA[^_@x@WpAKjA?pAHx@bDpJtCxJ`@jCHvA?zBC|JLpKj@dUAxCOvC_@vCc@dCq@fCcAjCaAlBkAdBqD`E{ExEkDxCqFbE}DjCaGdD{ClA}Bn@yCf@kCPaCBkCIuC]eCk@mC{@oCqA}A_AqBkB_AiAq@wAy@oCq@wBi@gAs@aA}@w@_Ak@}Aa@kHi@uEU}F{@uCa@kCM{FOcGBkGPsCZuCn@oC~@uHtCsJ`DqPpGiKzDcG`C}DxA{FdCoU|K}FpCoFnCcPnH}C|AmDpB_HdDiEdBiLbE{CbAgC~@gC|@uB~@UP_J~DoQ|Iu@b@_BlAqBfBiBxByDfFyA|AkBzAaO|IcDpAyBb@gBPcC@eHMaBJeBX_Bh@mJdFsBzAwAtAsA|AwC|EaDnF_AjAoAfA{A~@gi@bU_Cn@aC`@aFRmHV}CXgJdByE~@SKw@Bq@Gs@Yu@m@s@o@o@Oi@D_@P[ZWn@Kr@Bx@Jh@~JhWP^PFvRfh@d@zAzBbJz@fEx@zF|@vIp@`Fj@vCbPjx@|DvPvDtQ~Gl\\r@xCrDfMf@dC\\pCNbCr@vSRbCj@nDp@nCp@nBpBlErCzFhAdDf@lB`@fCXrCJfCBnCEvBw@pRcBda@QrBi@fDs@vCs@tBeAbCiJpQaA~Bs@tBw@pDiBbMqE`Vu@jCu@lBcAnBsDlFwFhIwArC{@vBs@`Cm@fCe@jCgEh_@sA~OgAlJ]bG[lDc@nCs@fDm@tBgJdZc@nBi@~DiCzTGfBBhBl@nHClBKvDAlBBDAfEM~B_AzIiAvJSdAq@nCu@tBiAzB_Zne@i@tA]|AMtACnAFbAPdA^jAh@x@x@v@xCpBn@t@^v@VbAHbAAdAIn@e@dBWv@AVoBnGAd@Hd@R`@f@d@tBtAnAdA\\VmI|WsHrUsAdErBsGhKbHvS`NdGxDrAdAdC~AjAr@t@h@lBlAzP|KqBnGkKl\\|OfKjXnMpOnHjAd@fQ|ANLtKbAXd@Hb@?n@Md@UXq@AKB_AEs@Re@X]`@Wj@Qn@Ix@s@dOm@nI_A|SOdCkB`SoAzLgC|XUzDmAnZIvBUjBmDzOa@pAm@rAm@fAoAjBo@|AQj@S`A{B`j@ArALhDBh@Gz@BxBSjKFlBPpAZfAf@|@z@~@zAbAvBdAbDlA~r@jQfLnCdCZ|BJdB@jC[`Ba@tAg@~IaElAc@rAS~AGfBJ~AVhBf@pAl@dAp@x@v@x@dA`A`B|ApDzHrRbBpEnEfKr@vAxCfEzBhCH\\n@bAb@bAXnAj@pEZrAb@jAn@hAxA`D`@nAFJ?f@_C`QGnA@lAPfBj@zEBtAAXKf@M`@{C{B_C{AqFyDyAuAsBqBi@[qAi@{I_DmHmFiAqB{@_Bs@eAaEaDoQcKmCbGg@pA" },
  { names: [MANHATTAN, "mock-clinton"], on: "2026-12-02", at: "", minutes: 20, miles: 3.8, cents: undefined, tolls: [LINCOLN_DYER], points: [[40.748879,-73.985582],[40.75394,-74.030663]], polyline: "owuwFzhqbMsLf_@aBrFmG~RwAfEuBxGoCoB{AwBeCkEi@o@_@Wk@Ia@Bm@Xi@f@o@dA}DhIwAjEa@fBk@rD_@rAqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAlAf@JXt@p@jBtCl@j@bAh@dCbAP?lBhApC|BVPL?n@h@vAv@r@XjE`Axg@nKc@`E{EaA" },
  { names: [MANHATTAN, "mock-clinton"], at: "", minutes: 19, miles: 3.8, cents: undefined, tolls: [LINCOLN_DYER], points: [[40.749028,-73.985937],[40.75394,-74.030663]], polyline: "mxuwFbkqbMuK~\\aBrFmG~RwAfEuBxGoCoB{AwBeCkEi@o@_@Wk@Ia@Bm@Xi@f@o@dA}DhIwAjEa@fBk@rD_@rAqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAlAf@JXt@p@jBtCl@j@bAh@dCbAP?lBhApC|BVPL?n@h@vAv@r@XjE`Axg@nKc@`E{EaA" },
  { names: ["500 8th Ave, New York, NY 10018", "mock-weehawken"], at: "", minutes: 12, miles: 2.8, cents: undefined, tolls: [LINCOLN_37TH], points: [[40.753043,-73.992811],[40.758767,-74.029716]], polyline: "oqvwF`vrbMoEsCyFhQdAv@HR?\\c@vAMN_@@wAeCi@o@_@Wk@Ia@Bm@Xi@f@o@dA}DhIwAjEa@fBk@rD_@rAqo@lrBw@jCa@tBOzAAbBHrATnA`@pAh@bAv@`AbCrBbBjAf@VNAlAf@JXt@p@jBtCl@j@bAh@dCbAP?lBhApC|BVPL?n@h@vAv@r@X`@JSrBpGtG" },
  { names: ["mock-clinton", MANHATTAN], at: "", minutes: 24, miles: 3.9, cents: 2079, points: [[40.75394,-74.030663],[40.749028,-73.985937]], polyline: "cwvwFrbzbMzE`AcArJmNuC_FeAbBuPuViFs@WmAi@iAy@qBoBe@_@CYgCqBeAw@]]a@k@e@kA_@i@mCyCy@e@uDcBiAm@UEmAkAe@w@c@qAWuAI_BD}ALgA`@_Bhk@seBfE}Mn@yBdEsMZyAFg@He@L{@x@uCh@QX?b@TRZhDjClBcGfFhDVRbAaDzAsEnGkSfFkPpEmN" },
  { names: ["mock-newark", MANHATTAN], at: "", minutes: 38, miles: 13.3, cents: 2296, points: [[40.734931,-74.16524],[40.749028,-73.985937]], polyline: "i`swFvktcMLGV[_C{DMWKpAuAlG_Dq@gHw@uDWqBFuEj@oA\\_Ab@kI|FIRo@XeATmA@{C]YsCi@}IqBcWzLoPfAoBfAmCp@yBC]h@eCVmBT_DD}CIoLUmK_@iKY}E_@aEg@}DwMo|@m@}C}@_D{@cCwA{CeAgBsAaBwAoAcC_BoKuEkLaFgAo@m@m@}@yAc@iAYsAKkAEiBGcD[gEo@qDQ{@D]Gq@?y@Ju@Zw@l@cA`SkS^u@Tw@F{@Ew@Qy@a@y@oCeDq@iAeEsJUM}DwKgD}JeDoKiAmEgA{Fk@wD_@cDe@aGSqEKcFW_s@O{EYsEe@sEq@cEu@wD}@iDgAcDeMy\\kWiu@aC{FoB_EaDqFkCwDcBuBuC}CyCoCmEkDqD}B}OuIKi@uDeCcEaDqE}CkCuA{F_Cs@i@u@gAm@sA]mAYkBI_B?gBNiCPkAhDqMfEgMp@{AvB_ETo@VkARqB^yFZwBdC_KpFaTvEuQxAwEbH{QfD{I~AeFrCsJpJ{X`@q@f@i@x@g@t@SfACnBTzCh@~DdAzDtA|@f@`@d@\\z@Jv@Ar@Mx@[p@YZa@Tc@Fa@E_@U{A{AcAs@iDcBkDiDe@w@c@qAWuAI_BD}ALgA`@_Bhk@seBfE}Mn@yBdEsMZyAFg@He@L{@x@uCh@QX?b@TRZhDjClBcGfFhDVRbAaDzAsEnGkSfFkPpEmN" },
  { names: ["mock-jersey-city", "mock-clinton"], at: "", minutes: 20, miles: 3.3, cents: 0, points: [[40.715573,-74.033472],[40.75394,-74.030663]], polyline: "igowFdtzbMw@zMwD[eKgAgGs@i@@w@Vm@`@_EzCi@TwJ{@oA]kA]yDu@{Ak@uEgCo@S_AGaADiCd@i@Hq@CoTkCc@By@Xa@\\_@h@Up@OfAk@~NOjA}ApEoKy@q@K}@W?jBJ|AId@GDi@K\\{CDc@SeCMoAEMy@aKkb@wIi~@kRuCk@" },
];
const key = (text) => (text.startsWith("mock-") ? text : norm(text));
const point = (waypoint) => (waypoint && typeof waypoint.placeId === "string" ? waypoint.placeId : norm(waypoint && waypoint.address));
const same = (names, ends) => names.length === ends.length && names.every((name, i) => key(name) === ends[i]);
const tollInfo = (cents) => (cents === 0 ? {} : { travelAdvisory: { tollInfo: Number.isInteger(cents) ? { estimatedPrice: [{ currencyCode: "USD", units: String(Math.floor(cents / 100)), nanos: (cents % 100) * 10000000 }] } : {} } });

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clockOf = (when) => (when instanceof Date && Number.isFinite(when.getTime()) ? NEW_YORK_CLOCK.format(when) : "");
const dayOf = (when) => (when instanceof Date && Number.isFinite(when.getTime()) ? NEW_YORK_DAY.format(when) : "");
const lineRoute = (waypoints, when) => (Array.isArray(waypoints) && LINES.find(({ names, at, on }) => same(names, waypoints.map(point)) && (!at || at === clockOf(when)) && (!on || on === dayOf(when)))) || null;

function mockDrive(waypoints) {
  const ends = Array.isArray(waypoints) ? waypoints.map(point) : [];
  const row = ends.length === 2 ? ROUTES.find(([from, to]) => same([from, to], ends)) : null;
  const stops = ends.length > 2 ? STOP_ROUTES.find(([names]) => same(names, ends)) : null;
  const [minutes, miles, cents] = row ? row.slice(2) : stops ? stops.slice(1) : [43, 16.8];
  return { minutes, miles, ...tollInfo(cents) };
}

const OUT_PATH = decodePath("a`jwFlmycMw@IaFOcAYW?g@WuAgAuA_B{C_ESAaDuEq@w@cAeAeBsAK_@qDwCqE_DyBmAuB{@iBa@mDq@cGo@aEUuF@qAMkA[cAg@kAaA}@iAu@yAc@mAoDmOa@}@e@w@k@q@kA_A}@a@kAWqAMsLGk@Se@]]k@Ws@Ky@I}P?wMJeSG[^_M^sHd@_Gh@kEn@wDp@{C~@iD`@oAPSXI`@mA`@wAxC_NZYRw@bA{Cn@oA|@eA~DmD`@o@Pq@@u@Io@Ui@o@m@aAg@kFgB}A{@_CeBcCaCeBsBcBgCeBcDmAuCqAwDsIsZ}AqEyBkFqBeEoBgD}BgDo@{@{@e@aBoA}A}@sBy@sBe@iG}@yFs@aJ{B]LwCcA_C}@oCyAcCgBaCyBmCiD}KcP}DcF_DcDkAaAwBsAcCkAeBo@kBg@wCi@wCQcS_@oDQgC]eUkFaD}@cDoA}CyAcDoB}C{BeD{CiCqCwAeB}A{BqAuByAsC_CeFyEqLeFcNuD}KeDoKiAmEgA{Fk@wD_@cDe@aGSqEKcFW_s@O{EYsEe@sEq@cEu@wD}@iDgAcDeMy\\kWiu@aC{FoB_EaDqFkCwDcBuBuC}CyCoCmEkDqD}BgTkLoHsDqOmI{FsDeGsEwE}DoXmW{]w\\yfAadAaEgDaFsDsFiDqFuC}E{BmFqBwGoBmHeB_Di@}Eo@{Hs@_L}@cLeA}UsBmDa@qDw@{Bs@{BaAoC{AwB}AkX}SmDiCiDsBaCgAgDiAyX}HeDo@{C[uCK_LOaGg@oEs@aHaBmHsBiIsC__@yN{GyCcCu@mE}@_CSsCC{FFiAEeBQmA]_Ai@{@s@w@iAq@}A]yA}AmIa@yA{AyDuA_C}B}CkUaY{CkE_C}DgCcFmBqEoBwFkBkGeBgH{@sEg@uDY}CKwBCqDHgDRqBb@wCt@sCrA{DpAiCjGyKbA{AnFyGvD}D|EoEpEqDzHkEhDyAfCy@xBe@vASbBGpAH~A\\dPbEvCf@p@D`AMf@M`Ai@~@}@p@aA^cAn@cDh@yAnBgD~BcExBcDf@cAr@eCp@_DTqAr@aGXaEb@kIRsB^_DF{A@uEJ_B`DcXpNunAP_BLa@bBiNt@eFhB_Pb@uB~F_RrAeDpCuIN_ADwCN{AGKvBeN~@wGRmCHoB?qCy@ga@SyMEyNBkKNuKh@aW`@sKbAiRvDip@^oDh@qCr@iCx@wBbXal@`@s@pAuCpAoDhAmEp@sDb@aD^iFx@_\\X_Fd@cFl@iEf@qCt\\sbBxEqUp@}B~DyK`@aBd@cDRoBIgACsAK}ByCeb@g@gEGUQYk@aDi@{Bw@kC_AcCeA{BoMkVkBuEwCuH_A{A_AeAw@k@eAe@sA]uAM_BBoANmGpBsAR}AJyKPSN}C?mPNqBRsBb@eBl@oErBmBl@mBZkBLwBAkBOsDw@mIiB_DWsB?oIXcE^iDf@oFnA{C~@iAb@iBfAoHlFsEjCyKpFyI|DwJzDeFbBiDx@aF|@aD\\sDNgGCiDKkCW{Bc@_Bg@iB{@oAu@kCuBkCiCuBiCaCsDmA}B{AaDqCcHoB{FoAcE_AsDs@qDaJgi@[{CU}DE}DFmDT_El@{F`BcMNsBFgCCaCOgC[_C[{Ak@sB}@{By@wAiA{A{AwAkBoAsNoHaF{BoUyIiH_DeEyAiH}BaCkAeCiBiGqFaFqDqEqCcEuByAw@eBmAuAsAqAiBk@eA_A}B{BeH{@oBi@aAkAaBsAsA_BiAmB}@gEoAaDaA}BeAoCeB{OwKcBwA{AaBeB}BkBqC}BsCgBkBcF}E_CoCaB}B}P_Xi@w@eBkBgJoHqAsAcAuAqAyBYq@eAqCmBqGqAiDqAmC}AiCaDmE}C}Dg]qa@}VaYkAaAwBuAsB{@iBe@sHkAwAc@gAc@i\\gPwBqAg]_XwBmAuAg@mL}CgBs@}AaA_BuAs@w@qAkB}@gB}@aCe@_BoE{U{@cEw@sCkAgD}AmDuAgC{BaDyBiC}BwBeCiBaBcA_DyAaDeAyKqCgBs@cB_AoA_AeAcAoA{AeAcB_AiB{@_Cs@iCc@eCUkB_@oFQaFI{EBiGL_FfCcf@D{CAeEK_DQiCi@qEq@uDy@iDcA}C}IeTyBiEoCiEaDaFca@ss@iBaEy@eCiDiLw@mDw@uEe@iEUiDMmDC{DFyE`@aJ`@sIJwC@}ACgCKeCUkC]{Bg@}Be@cBqAgDiAsBaAwAwBiCmOqPmUiWiTgV{EgFkFkFkDuC}UgPaCiBoDuDmy@}aAaB{By@wAkAmCcA{Co@kC[mBWuBSaDo@qSWwDc@sDo@iDsOgr@gAcEgAoDkIgVsA_FgAwEgFeYo@kCkAcDq@_BiAqBiA_BuAaB{BkB{SaOqBgBgBqB}AyBw@qAoAmCqAmDuQqn@_DeL{@wDo@uDgEo[Mw@J[KsA@iAL_AZ}@V[`@U\\EJ@`@RX^Ld@@n@Kv@Qh@W`@mFlE[L[?STA`@XpFJlAHDbB~PHt@`@rCFnAC|@O~@s@vD~@NrFZlHrAfE|@vCj@bD`@bDl@vFLbA?CuAc@{Im@{LGoAXaF?c@^ObAu@PEd@F\\VV`@");
const BACK_PATH = decodePath("ccmyFlmb`Mc@m@[O[CWFcAv@YJCkAOyAUkAc@kBIe@IuAw@J}DnAiATu@CaAWsCsAmAWmAQGbABr@v@pFLhBNlBb@dBLh@j@rAyAd@iAPq@?gAGWImBMyKaA]?{AmOBIWgIv@g@bDhP\\bAfA|Hx@hE|@bDpUrx@`ArClAlClAxB`BbCbBlBtArAnDhCbQbM`BzAbAlAzAxBlAbCz@zBv@fCTdAxEzW`AtEz@hDhArD~HjUxAdFfCzKzLni@b@fC`@hDRlCZ~JXdJZjDf@hDr@vCn@rBfAjCnAbCjAdBrz@fcArBxBrC~BvJ~GjKhHbDjCnDlD~e@rh@pQdS`LxL|ApBxA~BbA|Br@vBl@dCZ`BZfCNrBNjFC|AoAzYEnCBvDRbG\\xEZpCf@|CdAvEbD~KxAfE`BjDxa@vt@nEtGhB~CtArCnJlUfAzDt@rDf@lDT|BTjEF|CCzDG~BeCle@MpG@fHHbEZlGTxC^hCr@~Cn@rB`A|BbAjBpAfBnArAlAbAjAt@`Bx@bA^fNjDdDpAhCvAfCdB~BrBtAzAhCfDfAbB~A|CzAzDhArD~@xDdFbXp@hCp@jB~@jBz@nAdAnArAfApAx@xAn@dHlB`EdAhAb@jBbAf^xXn@d@v_@dRnBh@dIpAfBh@dBt@tAz@~ArAfXjZd_@|c@|ExGhB|CbAvB|@bChFfQt@lB|@xAfAtAvAlA|A|@rE|BbAt@pArAtArBlO|U`BtBzBbCxGtGlB~BbE~FvBdClBbBnShNjB`A|Al@vHzBjBx@hBrAtAvAz@jAt@pAz@rBnChIdAzBnAjBvA|A~AjAxEdCzEnCvF|DnCzBzDhDfChBlAn@~Ap@dJrCzD~AbFxB`TbIbGjCxLlGjBrAbAdAlAbBfArBl@`Bf@jBb@|BTtBLbC?`CG~BS`Cu@|F]fESzDMrFBjEJrD\\nFX|BpFh\\~BzMbAlEjAbEfCnHtBnFrBrEtBxDnBxCpBdClBrBdCxBtCtBlBdAdC`AjBf@`C\\rAHnCFlCK|CYlDk@vCq@fF{AfJgD~KuErLiFdDeA~DuAbB{@|AgAbA{@pCeD|AoAdAg@~C_AfDu@tDo@bGk@lHYlB@nBP~HbB~A^l@JjBZzALnB@|BMlB]`Be@xCsAjCgA|Bk@pBU`FIhb@_@`CQbDy@hCY`AAtAPbAZdAl@dA`Ap@bA`AxBvDnJ|DrHnH`NHd@d@|ATnAN`BBlAEfJHpCR~CnAhMzArNN^RnCD|CAvCH`@YtCc@nCeAjE{AhGkEnTsJff@uMfp@kBlJy@tF_@zD]lFOnEk@vUWfEg@|Di@bD_A~D_A~Cu@~Ag[vq@gA|Cs@xCa@`CYfCqDpn@iAjS]hI_@nPYlPK~KAxIFbLPxJz@b`@@bBEnBSxCIfAkEjYOPs@pCsClJ{CbKwCvJ[zAiBxNiCrVYfDsRjcB]dDi@dCYnAe@`ByC|PObBc@rG[pCsCrNm@dBcAnBcBrC}@hAyAlAiAt@cCdAwBr@aDl@aBLaCE{BYkEq@oBMiBBgBRsBf@_C|@uFnCkF~CmE|CcEjD}DzDiDzDcDhEaBbCiDzFuBdEoAzCg@|Aq@pCa@tCWjCK`CCbCFvCV|Df@xEp@rEj@dDfAbFbB`G~AtEhBpEdCdF~BbEtCfEnG`I|GrIhD|EzAhCrArCt@vBfAjEtBlJr@hBz@tAvAzA~@j@lAd@lARhBHbFMlFO`BDbBNnBXlCt@nG|Bju@fY|Cv@pCf@lE^hTZdCVvCj@~C|@xGhCfAd@`AZh@H`PzFdCjAtClBlBbBfBnBhF~GzJvMlKbNzg@vq@`BhCnBtDpA`D|A`FdAdElZ|pA~BvHdBtEdBxD~M`Yj@~AbKzOhGrIrn@pz@~J`Nf]rd@bFjGtInJdd@hf@jFdFjHjGlwBfhBvElDfEjCzEdCvEnBjC~@zW~HpDfAbj@bPzLxCxMzC`Db@pCRjRt@pCVvBb@hBf@jA`@dDhB~B~AhB`BvAzAnW|ZbClC~@z@fEhDrBvAzBrArAl@fCz@d@JRVXLnKhC`ErA~CpAvDnBxClB|ApAvBxBjBbC|AlCvAvClA~CzA`FtGfUxA~D`BrD`BtChBrCfBxB`CpCj@bA`@dAX|@Ff@f@nDRlCBbAE|ASvAsDjPy@zCa@fByA|EeAvCiDnIg@dBq@rDKbBC`AHPRxA`@xAf@dAv@~@`Ar@HBDLxChCx@bAp@nAp@pBZzA?LJnA@pBIb[@zFHPGpHFnBFpAFN`@fC^|AZbAv@fB`A|AfArAx@r@bGlEhDbCxDlCvD~B|C|AfOtGLHXIXDd@Ah@Q~A{@p@Mr@@n@Rd@\\tC~Dv@fAz@p@JTlA`@~@LfAC|@Sz@c@h@a@j@{@z@cB");
const SI_PATH = decodePath("m}jwFxtxcMFKFe@bBsHAWvAoGRi@Xa@j@c@h@Op@?XBXEj@ErBu@EyCSsAY{@e@}@aAiA_As@aBw@}AYoAGs@Dq@Va@`@Ud@M~@@x@L|@Zz@l@bA~A`CRl@NfABxAK|A[~AQv@IFm@zAi@x@i@d@s@\\q@H_@EkAg@o@k@iAoAcA_@k@Go@Fe@Pe@`@a@z@Kt@BbAHh@Vh@\\`@b@Rb@F|@CxAQ~@Bv@Rt@b@pAdAvAzATHnIvLhBzBxAlAbB~@vFvBlCr@hBZbAJnCFlPHnBFTLrDr@hEz@^FDHjABrAOrAa@xQoIrBqAjAaAbBkBnBkCdB{C~E_KpAqBjAqAdAw@fAk@jA_@~Es@pCo@zF_CvC}AN?xCgAXILOnEkAp@Iz@Dt@Px@`@vCtBbGfDPGx\\hStB`BdC`ChBzBnBvCjBnD|Yfp@vAjC|AdCpBjClBtBdDrCpA`AHZrB|A`B|@|CpAv@f@lBpBv@h@JPxB|@`JzDr@f@^h@Pb@Jr@B`AEfAHd@wApPSjA?^]z@c@b@e@Pe@Be@O_@[Sc@S}@M{AEcEFeBRcB^}A`AeCbBsDpBiDnBuC`JuKxB}CxBqDdCqFz^c{@xC_I~EyNdD}JdBwEnBmE`JaRXk@|A_C`CsCvJwKhAaBnAeC|@_Cn@eCh@uCRyBz@iN`@eDt@mDxA}EhC}HXKlAcCvBwDJK\\i@`@]d@Sv@E|@JbBX^PzBr@fa@pF`Bh@xHrAdET|AVVBb@Tl@?bECx@H|@ZlFxBbItBJBjA{V|ASrDm@~]cEh@EbAB|@H`D|@~@f@bAv@`BnBtJ|NpAzAtGfG|@d@vA^lI~AjS|A");
const STOP_AT = 603;
const STOP_PATH = [...OUT_PATH.slice(0, STOP_AT), [41.0215, -73.6245], ...OUT_PATH.slice(STOP_AT)];
const TURNPIKE_OUT = { from: [40.71024, -74.17739], to: [40.8115, -74.02936] };
const GWB_OUT = { from: [40.8537, -73.9642], to: [40.85, -73.9446] };
const THRUWAY_OUT = { from: [40.92917, -73.76626], to: [40.92917, -73.76626], cents: 174 };
const SPLIT_ROUTES = [
  { names: [EWR, RIVERSIDE], minutes: 79, miles: 52.5, path: OUT_PATH, stops: [], tolls: [TURNPIKE_OUT, GWB_OUT, THRUWAY_OUT] },
  { names: [RIVERSIDE, EWR], minutes: 81, miles: 50.9, path: BACK_PATH, stops: [], tolls: [{ from: [40.8115, -74.0601], to: [40.70811, -74.18013] }] },
  { names: [EWR, STEAMBOAT, RIVERSIDE], minutes: 87, miles: 55.1, path: STOP_PATH, stops: [STOP_AT], tolls: [TURNPIKE_OUT, GWB_OUT, THRUWAY_OUT] },
  { names: [EWR, RICHMOND_AVE], minutes: 23, miles: 12.1, path: SI_PATH, stops: [], tolls: [{ from: [40.677, -74.19171], to: [40.64098, -74.2073] }, { from: [40.6369, -74.2003], to: [40.62875, -74.1841] }] },
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

function lineSplit(waypoints, when) {
  const line = lineRoute(waypoints, when);
  return line && line.tolls && line.names.length === 2 ? { path: decodePath(line.polyline), stops: [], minutes: line.minutes, miles: line.miles, tolls: line.tolls } : null;
}

export function mockSplit(body) {
  const stops = (body.intermediates || []).filter((item) => !item.location);
  const ends = [body.origin, ...stops, body.destination];
  const fixture = splitRoute(ends, new Date(body.departureTime)) || lineSplit(ends, new Date(body.departureTime));
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
  const spans = fixture.tolls.map((span) => ({ ...span, enter: nearest(path, arcs, span.from, 1).at, leave: nearest(path, arcs, span.to, 1).at }));
  const legs = edges.slice(1).map((end, n) => {
    const inside = spans.filter(({ enter, leave }) => enter < end && leave >= edges[n]);
    const cents = inside.some((span) => !Number.isInteger(span.cents)) ? null : inside.reduce((sum, span) => sum + span.cents, 0);
    return { distanceMeters: Math.round(((end - edges[n]) / total) * miles * 1609.344), duration: `${Math.round(((end - edges[n]) / total) * minutes * 60)}s`, ...(inside.length && tollInfo(cents === null ? undefined : cents)) };
  });
  return { routes: [{ distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), legs }] };
}

export function mockRoute(size, waypoints, when) {
  const split = splitRoute(waypoints, when);
  const fixed = split && { minutes: split.minutes, miles: split.miles, travelAdvisory: { tollInfo: {} }, polyline: encode(split.path), points: [0, ...split.stops, split.path.length - 1].map((i) => split.path[i]), start: { lat: split.path[0][0], lng: split.path[0][1] }, end: { lat: split.path.at(-1)[0], lng: split.path.at(-1)[1] } };
  const line = !split && lineRoute(waypoints, when);
  const drawn = line && { minutes: line.minutes, miles: line.miles, ...tollInfo(line.cents), polyline: line.polyline, points: line.points, start: { lat: line.points[0][0], lng: line.points[0][1] }, end: { lat: line.points.at(-1)[0], lng: line.points.at(-1)[1] } };
  const drive = fixed || drawn || { ...mockDrive(waypoints), ...(Array.isArray(waypoints) && waypoints.length > 1 && mockPath(waypoints)) };
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
