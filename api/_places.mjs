import { PLACES } from "./_rates.mjs";

const JFK = "John F. Kennedy International Airport, Queens, NY 11430";
const LGA = "LaGuardia Airport, East Elmhurst, NY 11371";
const EWR = "Newark Liberty International Airport, Newark, NJ 07114";
const HPN = "240 Airport Road, White Plains, NY 10604";
const HPN_ADDR = "Westchester County Airport, 240 Airport Road, White Plains, NY 10604";
const ROWS = [
  ["jfk", "John F. Kennedy (JFK)", JFK, "jfk", "JFK", "airport", "", "jfk|jfk airport|kennedy airport|jfk international airport|john f. kennedy international airport|john f kennedy international airport|john f. kennedy airport|jfk international|jfk intl|jfk intl airport|kennedy international airport", "jfk|kennedy|john f kennedy|john f. kennedy|jfk airport|kennedy airport", JFK],
  ["jfk-t1", "John F. Kennedy (JFK), Terminal 1", JFK, "jfk", "JFK", "terminal", "jfk", "jfk terminal 1|terminal 1 jfk|jfk t1|jfk airport terminal 1|kennedy airport terminal 1", "terminal 1|t1", "John F. Kennedy International Airport Terminal 1, Queens, NY 11430"],
  ["jfk-t4", "John F. Kennedy (JFK), Terminal 4", JFK, "jfk", "JFK", "terminal", "jfk", "jfk terminal 4|terminal 4 jfk|jfk t4|jfk airport terminal 4|kennedy airport terminal 4", "terminal 4|t4", "John F. Kennedy International Airport Terminal 4, Queens, NY 11430"],
  ["jfk-t5", "John F. Kennedy (JFK), Terminal 5", JFK, "jfk", "JFK", "terminal", "jfk", "jfk terminal 5|terminal 5 jfk|jfk t5|jfk airport terminal 5|kennedy airport terminal 5", "terminal 5|t5", "John F. Kennedy International Airport Terminal 5, Queens, NY 11430"],
  ["jfk-t7", "John F. Kennedy (JFK), Terminal 7", JFK, "jfk", "JFK", "terminal", "jfk", "jfk terminal 7|terminal 7 jfk|jfk t7|jfk airport terminal 7|kennedy airport terminal 7", "terminal 7|t7", "John F. Kennedy International Airport Terminal 7, Queens, NY 11430"],
  ["jfk-t8", "John F. Kennedy (JFK), Terminal 8", JFK, "jfk", "JFK", "terminal", "jfk", "jfk terminal 8|terminal 8 jfk|jfk t8|jfk airport terminal 8|kennedy airport terminal 8", "terminal 8|t8", "John F. Kennedy International Airport Terminal 8, Queens, NY 11430"],
  ["lga", "LaGuardia (LGA)", LGA, "lga", "LGA", "airport", "", "lga|laguardia|la guardia|laguardia airport|la guardia airport|lga airport", "lga|laguardia|la guardia|laguardia airport", LGA],
  ["lga-ta", "LaGuardia (LGA), Terminal A", LGA, "lga", "LGA", "terminal", "lga", "lga terminal a|laguardia terminal a|terminal a lga|laguardia airport terminal a|lga airport terminal a", "terminal a", "LaGuardia Airport Terminal A, East Elmhurst, NY 11371"],
  ["lga-tb", "LaGuardia (LGA), Terminal B", LGA, "lga", "LGA", "terminal", "lga", "lga terminal b|laguardia terminal b|terminal b lga|laguardia airport terminal b|lga airport terminal b", "terminal b", "LaGuardia Airport Terminal B, East Elmhurst, NY 11371"],
  ["lga-tc", "LaGuardia (LGA), Terminal C", LGA, "lga", "LGA", "terminal", "lga", "lga terminal c|laguardia terminal c|terminal c lga|laguardia airport terminal c|lga airport terminal c", "terminal c", "LaGuardia Airport Terminal C, East Elmhurst, NY 11371"],
  ["ewr", "Newark Liberty (EWR)", EWR, "ewr", "EWR", "airport", "", "ewr|newark airport|newark liberty|newark liberty airport|newark international airport|newark liberty international airport|ewr airport|newark liberty international|newark international", "ewr|newark|newark liberty|newark airport|newark liberty international", EWR],
  ["ewr-ta", "Newark Liberty (EWR), Terminal A", EWR, "ewr", "EWR", "terminal", "ewr", "ewr terminal a|newark terminal a|newark airport terminal a|terminal a ewr|ewr airport terminal a|newark liberty terminal a|newark liberty airport terminal a", "terminal a", "Newark Liberty International Airport Terminal A, Newark, NJ 07114"],
  ["ewr-tb", "Newark Liberty (EWR), Terminal B", EWR, "ewr", "EWR", "terminal", "ewr", "ewr terminal b|newark terminal b|newark airport terminal b|terminal b ewr|ewr airport terminal b|newark liberty terminal b|newark liberty airport terminal b", "terminal b", "Newark Liberty International Airport Terminal B, Newark, NJ 07114"],
  ["ewr-tc", "Newark Liberty (EWR), Terminal C", EWR, "ewr", "EWR", "terminal", "ewr", "ewr terminal c|newark terminal c|newark airport terminal c|terminal c ewr|ewr airport terminal c|newark liberty terminal c|newark liberty airport terminal c", "terminal c", "Newark Liberty International Airport Terminal C, Newark, NJ 07114"],
  ["teb", "Teterboro (TEB)", "Teterboro Airport, Teterboro, NJ 07608", "teb", "TEB", "airport", "", "teb|teterboro|teterboro airport|teb airport", "teb|teterboro|teterboro airport", "Teterboro Airport, Teterboro, NJ 07608"],
  ["teb-atlantic", "Teterboro (TEB), Atlantic Aviation", "233 Industrial Ave, Teterboro, NJ 07608", "teb", "TEB", "fbo", "teb", "atlantic aviation teterboro", "atlantic aviation", "233 Industrial Ave, Teterboro, NJ 07608"],
  ["teb-jet", "Teterboro (TEB), Jet Aviation", "112 Charles A. Lindbergh Dr, Teterboro, NJ 07608", "teb", "TEB", "fbo", "teb", "jet aviation teterboro", "jet aviation", "112 Charles A. Lindbergh Dr, Teterboro, NJ 07608"],
  ["teb-sig-east", "Teterboro (TEB), Signature Aviation East", "200 Fred Wehran Dr, Teterboro, NJ 07608", "teb", "TEB", "fbo", "teb", "", "signature|signature aviation|signature east", "200 Fred Wehran Dr, Teterboro, NJ 07608"],
  ["teb-sig-south", "Teterboro (TEB), Signature Aviation South", "101 Charles A Lindbergh Drive, Teterboro, NJ 07608", "teb", "TEB", "fbo", "teb", "", "signature|signature aviation|signature south", "101 Charles A Lindbergh Drive, Teterboro, NJ 07608"],
  ["teb-sig-west", "Teterboro (TEB), Signature Aviation West", "485 Industrial Ave, Teterboro, NJ 07608", "teb", "TEB", "fbo", "teb", "", "signature|signature aviation|signature west", "485 Industrial Ave, Teterboro, NJ 07608"],
  ["hpn", "Westchester County (HPN)", HPN, "airport-other", "HPN", "airport", "", "hpn|westchester airport|westchester county airport|white plains airport", "hpn|westchester|westchester airport|westchester county airport|white plains", HPN_ADDR],
  ["hpn-million", "Westchester County (HPN), Million Air", HPN, "airport-other", "HPN", "fbo", "hpn", "", "million air", HPN_ADDR],
  ["hpn-atlantic", "Westchester County (HPN), Atlantic Aviation", HPN, "airport-other", "HPN", "fbo", "hpn", "", "atlantic aviation", HPN_ADDR],
  ["hpn-signature", "Westchester County (HPN), Signature Flight Support", HPN, "airport-other", "HPN", "fbo", "hpn", "", "signature|signature flight support", HPN_ADDR],
  ["isp", "Long Island MacArthur (ISP)", "100 Arrival Ave, Ronkonkoma, NY 11779", "airport-other", "ISP", "airport", "", "isp|islip airport|macarthur airport|mac arthur airport|long island macarthur airport", "isp|macarthur|mac arthur|long island macarthur|islip|ronkonkoma", "Long Island MacArthur Airport, 100 Arrival Ave, Ronkonkoma, NY 11779"],
  ["swf", "New York Stewart (SWF)", "1180 1st St, New Windsor, NY 12553", "airport-other", "SWF", "airport", "", "swf|stewart airport|stewart international airport|new york stewart international airport", "swf|stewart|new york stewart|stewart airport|new windsor|newburgh", "New York Stewart International Airport, 1180 1st St, New Windsor, NY 12553"],
  ["swf-atlantic", "New York Stewart (SWF), Atlantic Aviation", "1032 First Street (Building 112), New Windsor, NY 12553", "airport-other", "SWF", "fbo", "swf", "", "atlantic aviation", "1032 First Street, New Windsor, NY 12553"],
  ["swf-signature", "New York Stewart (SWF), Signature Flight Support", "1188 First Street, New Windsor, NY 12553", "airport-other", "SWF", "fbo", "swf", "", "signature|signature flight support", "1188 First Street, New Windsor, NY 12553"],
  ["frg", "Republic (FRG)", "7150 Republic Airport, East Farmingdale, NY 11735", "airport-other", "FRG", "airport", "", "frg|republic airport", "frg|republic|republic airport|farmingdale|east farmingdale", "Republic Airport, 7150 Republic Airport, East Farmingdale, NY 11735"],
  ["frg-main", "Republic (FRG), Main Terminal", "7150 Republic Airport, Farmingdale, NY 11735", "airport-other", "FRG", "terminal", "frg", "", "main terminal", "Republic Airport, 7150 Republic Airport, Farmingdale, NY 11735"],
  ["frg-atlantic", "Republic (FRG), Atlantic Aviation Long Island", "9100 Republic Airport, East Farmingdale, NY 11735", "airport-other", "FRG", "fbo", "frg", "", "atlantic aviation", "9100 Republic Airport, East Farmingdale, NY 11735"],
  ["frg-modern", "Republic (FRG), Modern Aviation Farmingdale", "1100 New Highway, East Farmingdale, NY 11735", "airport-other", "FRG", "fbo", "frg", "", "modern aviation", "1100 New Highway, East Farmingdale, NY 11735"],
];
const split = (text) => Object.freeze(text ? text.split("|") : []);
export const PLACE_LIST = Object.freeze(
  ROWS.map(([id, label, sub, zone, iata, kind, parent, aliases, keys, addr]) =>
    Object.freeze({ id, label, sub, zone, iata, kind, parent, aliases: split(aliases), keys: split(keys), addr, gid: "" }),
  ),
);
export const ZONES = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "jfk", "lga", "ewr", "teb", "airport-other", "outside", "unknown"];
export const AIRPORT_ZONES = ["jfk", "lga", "ewr", "teb", "airport-other"];
export const AREA_LABELS = { ...PLACES, "airport-other": "Price on request", unknown: "ZIP code needed" };

const STATE_CODES = "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc pr vi gu as mp";
const STATE_NAMES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|puerto rico|virgin islands|us virgin islands|guam|american samoa|northern mariana islands";
const WORD_CODES = ["in", "or", "me", "hi", "ok", "oh", "as"];
const ZIP_TAIL = "\\s+\\d{5}(?:-\\d{4})?";
const AFTER_COMMA = new RegExp(`,\\s*(?:${STATE_CODES.split(" ").join("|")}|${STATE_NAMES})(?=$|,|${ZIP_TAIL}(?:$|,))`);
const BEFORE_ZIP = new RegExp(`(?:^|[\\s,])(?:${STATE_CODES.split(" ").filter((code) => !WORD_CODES.includes(code)).join("|")})${ZIP_TAIL}(?![\\d-])`);
const LAST_ZIP = /(?:^|\D)(\d{5})(?:-\d{4})?$/;
const NYC_TAIL = /(?:^|\D)(\d{5})(?:-\d{4})?(?:[\s,]+(?:ny|new york|nyc|new york city))+$/;
const STREET_WORDS = "ave|avenue|av|blvd|boulevard|st|street|rd|road|pl|place|plaza|pkwy|parkway|expy|expressway|dr|drive|ln|lane|ct|court|ter|terrace|bridge|beach|college|mall|crossing|center|centre";
const BOROUGH_WORDS = new RegExp(`(?:^|[^a-z0-9'])(the bronx|bronx|manhattan|brooklyn|queens|staten island)(?![a-z0-9'])(?!\\s+(?:${STREET_WORDS})(?![a-z0-9']))`, "g");
const BOROUGH_ZONES = { manhattan: "manhattan", brooklyn: "brooklyn", queens: "queens", bronx: "bronx", "the bronx": "bronx", "staten island": "staten-island" };
const CITY_STATE = /(?:^|,)\s*new york,?\s+(?:ny|new york)(?![a-z0-9'])/;
const NYC_CONFIRM = /,\s*ny(?:\s+\d{5}(?:-\d{4})?)?$|,\s*new york(?![a-z0-9'])|(?:^|[^a-z0-9'])nyc(?![a-z0-9'])|new york city/;
const COUNTY_ZONES = { "New York": "manhattan", Kings: "brooklyn", Queens: "queens", Bronx: "bronx", Richmond: "staten-island" };
const SUB_ZONES = { Manhattan: "manhattan", Brooklyn: "brooklyn", Queens: "queens", Bronx: "bronx", "The Bronx": "bronx", "Staten Island": "staten-island" };
const TEB_NAMES = ["teterboro airport", "(teb)", "atlantic aviation", "jet aviation", "signature aviation", "flexjet"];
const EWR_GROUNDS = /Newark Liberty|\bEWR\b|\bBrewster R(?:oa)?d\b/i;
const TEB_GROUNDS = /\bFred Wehran\b|\bLindbergh Dr(?:ive)?\b|^(?:233|485) Industrial Ave/i;
const AREA_TAIL = new RegExp(`(?:(?:^| )(?:usa|us|united states|ny|new york city|new york|nyc|${STATE_CODES.split(" ").join("|")}|${STATE_NAMES}|\\d{5}(?: \\d{4})?))+$`);
const AREA_NAME = /^(?:(?:borough of )?(?:manhattan|brooklyn|queens|(?:the )?bronx|staten island)(?: borough)?|(?:[a-z']+ ){1,2}county)?$/;
const CITY_ZONES = ["manhattan", "brooklyn", "queens", "bronx", "staten-island"];

export const norm = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/ +/g, " ")
    .trim();

export const lite = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:,\s*|\s+)(?:usa|us|united states(?: of america)?)$/, "")
    .trim();

export const areaText = (text) => AREA_NAME.test(norm(text).replace(AREA_TAIL, ""));
const cityText = (plain) => CITY_STATE.test(plain) || (plain.match(/[\s,]\d{5}(?!\d)/g) || []).some((zip) => CITY_ZONES.includes(zipBorough(zip.slice(1))));
const hasBorough = (text) => [...lite(text).matchAll(BOROUGH_WORDS)].length > 0;
export const routeText = (text, zone) => (!CITY_ZONES.includes(zone) || /\b\d{5}\b|\bny\b|new york|\bnyc\b/i.test(text) ? text : hasBorough(text) ? `${text}, NY` : `${text}, ${AREA_LABELS[zone]}, NY`);

const BY_ID = new Map(PLACE_LIST.map((row) => [row.id, row]));
const BY_NAME = new Map();
for (const row of PLACE_LIST) for (const name of [row.label, ...row.aliases]) if (!BY_NAME.has(norm(name))) BY_NAME.set(norm(name), row);

export function localById(id) {
  return (typeof id === "string" && BY_ID.get(id)) || null;
}

export function zipBorough(zip) {
  const code = String(zip ?? "");
  if (!/^\d{5}$/.test(code) || code === "11430" || code === "11371") return "";
  if (/^10[0-2]\d\d$/.test(code)) return "manhattan";
  if (/^103\d\d$/.test(code)) return "staten-island";
  if (/^104\d\d$/.test(code)) return "bronx";
  if (/^112\d\d$/.test(code)) return "brooklyn";
  if (/^11[1346]\d\d$/.test(code) || code === "11004" || code === "11005") return "queens";
  return "outside";
}

function airportPart(part) {
  const coded = / (jfk|lga|ewr|teb)$/.exec(part);
  const hit = BY_NAME.get(coded ? part.slice(0, coded.index) : part);
  if (!hit || !AIRPORT_ZONES.includes(hit.zone) || (coded && hit.zone !== coded[1])) return null;
  return coded || /\b(?:airport|international)\b/.test(part) ? hit : null;
}

export function classifyText(text) {
  const key = norm(text);
  const exact = BY_NAME.get(key);
  if (exact) return { zone: exact.zone, id: exact.id };
  const head = BY_NAME.get(norm(String(text ?? "").split(",")[0]));
  if (head) return { zone: head.zone, id: head.id };
  for (const part of String(text ?? "").split(",")) {
    const hit = airportPart(norm(part));
    if (hit) return { zone: hit.zone, id: hit.id };
  }
  const words = ` ${key} `;
  if (words.includes(" 11430 ") && /\s(?:jfk|kennedy)\s/.test(words)) return { zone: "jfk", id: "jfk" };
  if (words.includes(" 11371 ") && /\s(?:lga|laguardia|la guardia)\s/.test(words)) return { zone: "lga", id: "lga" };
  if (words.includes(" 07114 ") && /\s(?:ewr|newark liberty|newark airport|newark international)\s/.test(words)) return { zone: "ewr", id: "ewr" };
  if (words.includes(" 07608 ") && /\s(?:teb|teterboro airport|aviation)\s/.test(words)) return { zone: "teb", id: "teb" };
  const plain = lite(text);
  if (AFTER_COMMA.test(plain) || BEFORE_ZIP.test(plain)) return { zone: cityText(plain) ? "unknown" : "outside", id: "" };
  const zip = LAST_ZIP.exec(plain) || NYC_TAIL.exec(plain);
  if (zip) {
    const zone = zipBorough(zip[1]) || "unknown";
    return { zone: zone === "outside" && cityText(plain) ? "unknown" : zone, id: "" };
  }
  const boroughs = [...plain.matchAll(BOROUGH_WORDS)];
  if (boroughs.length) return { zone: BOROUGH_ZONES[boroughs[boroughs.length - 1][1]], id: "" };
  if (CITY_STATE.test(plain)) return { zone: "manhattan", id: "" };
  if (NYC_CONFIRM.test(plain)) {
    for (const part of plain.split(",")) {
      const zone = Object.prototype.hasOwnProperty.call(NEIGHBORHOODS, norm(part)) ? NEIGHBORHOODS[norm(part)] : "";
      if (zone) return { zone, id: "" };
    }
  }
  const first = norm(plain.split(",")[0]);
  const rest = plain.split(",").slice(1).map(norm).filter(Boolean);
  const nycPart = /^(?:ny|new york|nyc|new york city|manhattan|brooklyn|queens|bronx|the bronx|staten island|usa|us|united states)$/;
  if (first.includes(" ") && Object.prototype.hasOwnProperty.call(NEIGHBORHOODS, first) && rest.every((part) => nycPart.test(part))) return { zone: NEIGHBORHOODS[first], id: "" };
  return { zone: "unknown", id: "" };
}

export function classifyPlace(details, label) {
  const parts = details && Array.isArray(details.addressComponents) ? details.addressComponents : [];
  const part = (type) => parts.find((item) => item && Array.isArray(item.types) && item.types.includes(type)) || {};
  const types = details && Array.isArray(details.types) ? details.types : [];
  const state = String(part("administrative_area_level_1").shortText || "");
  const county = String(part("administrative_area_level_2").longText || "").replace(/ County$/, "");
  const sub = String(part("sublocality_level_1").longText || part("sublocality").longText || "");
  const zip = String(part("postal_code").shortText || part("postal_code").longText || "");
  const name = String(label ?? "");
  const address = String((details && details.formattedAddress) || "");
  const airport = types.includes("airport") || types.includes("international_airport");
  if (state === "NY" && zip === "11430") return "jfk";
  if (state === "NY" && zip === "11371") return "lga";
  if (state === "NJ" && zip === "07114" && EWR_GROUNDS.test(`${name} ${address}`)) return "ewr";
  if (state === "NJ" && !zip && /Newark Liberty|\(EWR\)/.test(`${name} ${address}`)) return "ewr";
  if (zip === "07608" && (types.includes("airport") || TEB_NAMES.some((fbo) => name.toLowerCase().includes(fbo)) || TEB_GROUNDS.test(name) || TEB_GROUNDS.test(address))) return "teb";
  if (airport || types.includes("airstrip")) return "airport-other";
  if (state === "NY") {
    if (Object.prototype.hasOwnProperty.call(COUNTY_ZONES, county)) return COUNTY_ZONES[county];
    if (Object.prototype.hasOwnProperty.call(SUB_ZONES, sub)) return SUB_ZONES[sub];
    const borough = zipBorough(zip);
    if (borough && borough !== "outside") return borough;
    if (!county && !sub && !zip && /^New York(?: City)?, NY(?:, USA)?$/.test(name)) return "manhattan";
  }
  return "outside";
}

export const NEIGHBORHOODS = Object.freeze({
  allerton: "bronx", annadale: "staten-island", "arden heights": "staten-island", arrochar: "staten-island", arverne: "queens", astoria: "queens", auburndale: "queens", "baisley park": "queens",
  "bath beach": "brooklyn", "battery park city": "manhattan", "bay ridge": "brooklyn", "bay terrace": "queens", baychester: "bronx", bayside: "queens", bayswater: "queens", "bedford park": "bronx",
  "bedford stuyvesant": "brooklyn", beechhurst: "queens", "belle harbor": "queens", bensonhurst: "brooklyn", "bergen beach": "brooklyn", "boerum hill": "brooklyn", "borough park": "brooklyn", "breezy point": "queens",
  briarwood: "queens", "brighton beach": "brooklyn", "broad channel": "queens", "broadway flushing": "queens", "bronx river": "bronx", "brooklyn heights": "brooklyn", brownsville: "brooklyn", "bulls head": "staten-island",
  bushwick: "brooklyn", "cambria heights": "queens", canarsie: "brooklyn", "carnegie hill": "manhattan", "carroll gardens": "brooklyn", "castle hill": "bronx", "castleton corners": "staten-island", chinatown: "manhattan",
  "city island": "bronx", "city line": "brooklyn", "civic center": "manhattan", claremont: "bronx", "claremont village": "bronx", "clason point": "bronx", clearview: "queens", "clinton hill": "brooklyn",
  "co op city": "bronx", "cobble hill": "brooklyn", "college point": "queens", "concourse village": "bronx", "coney island": "brooklyn", corona: "queens", "country club": "bronx", "crotona park east": "bronx",
  "crown heights": "brooklyn", "cypress hills": "brooklyn", "ditmas park": "brooklyn", "dongan hills": "staten-island", douglaston: "queens", "downtown brooklyn": "brooklyn", dumbo: "brooklyn", "dutch kills": "queens",
  "dyker heights": "brooklyn", "east elmhurst": "queens", "east flatbush": "brooklyn", "east flushing": "queens", "east harlem": "manhattan", "east midtown": "manhattan", "east new york": "brooklyn", "east village": "manhattan",
  "east williamsburg": "brooklyn", edenwald: "bronx", edgemere: "queens", electchester: "queens", elmhurst: "queens", eltingville: "staten-island", "emerson hill": "staten-island", "far rockaway": "queens",
  "financial district": "manhattan", flatbush: "brooklyn", flatiron: "manhattan", flatlands: "brooklyn", flushing: "queens", fordham: "bronx", "fordham heights": "bronx", "forest hills": "queens",
  "fort greene": "brooklyn", "fox hills": "staten-island", "fresh meadows": "queens", "gerritsen beach": "brooklyn", "glen oaks": "queens", glendale: "queens", gowanus: "brooklyn", gramercy: "manhattan",
  graniteville: "staten-island", grasmere: "staten-island", gravesend: "brooklyn", "great kills": "staten-island", greenpoint: "brooklyn", "greenwich village": "manhattan", "grymes hill": "staten-island", "hallets point": "queens",
  "hamilton heights": "manhattan", harlem: "manhattan", "hell's kitchen": "manhattan", highbridge: "bronx", hollis: "queens", "hollis hills": "queens", holliswood: "queens", homecrest: "brooklyn",
  "howard beach": "queens", "hudson square": "manhattan", "hudson yards": "manhattan", "hunters point": "queens", "hunts point": "bronx", "jackson heights": "queens", jamaica: "queens", "jamaica estates": "queens",
  "jamaica hills": "queens", "kew gardens": "queens", "kew gardens hills": "queens", kingsbridge: "bronx", "kingsbridge heights": "bronx", "kips bay": "manhattan", laurelton: "queens", "lenox hill": "manhattan",
  "lighthouse hill": "staten-island", "lincoln square": "manhattan", lindenwood: "queens", "little italy": "manhattan", "little neck": "queens", "long island city": "queens", longwood: "bronx", "lower east side": "manhattan",
  "manhattan beach": "brooklyn", "manhattan valley": "manhattan", manhattanville: "manhattan", "manor heights": "staten-island", mapleton: "brooklyn", "marble hill": "bronx", "marine park": "brooklyn", "mariner's harbor": "staten-island",
  maspeth: "queens", "middle village": "queens", "midland beach": "staten-island", midtown: "manhattan", "midtown south": "manhattan", midwood: "brooklyn", "mill basin": "brooklyn", "morningside heights": "manhattan",
  "morris heights": "bronx", "morris park": "bronx", morrisania: "bronx", "mott haven": "bronx", "mount eden": "bronx", "new brighton": "staten-island", "new dorp": "staten-island", "new lots": "brooklyn",
  "new springville": "staten-island", "north corona": "queens", "oakland gardens": "queens", "ocean hill": "brooklyn", "old astoria": "queens", olinville: "bronx", "ozone park": "queens", "park slope": "brooklyn",
  parkchester: "bronx", parkville: "brooklyn", "pelham bay": "bronx", "pelham gardens": "bronx", "pelham parkway": "bronx", "peter cooper village": "manhattan", pomonok: "queens", "port morris": "bronx",
  "port richmond": "staten-island", "prince's bay": "staten-island", "prospect heights": "brooklyn", "prospect lefferts gardens": "brooklyn", "queens village": "queens", "queensboro hill": "queens", queensbridge: "queens", ravenswood: "queens",
  "rego park": "queens", "remsen village": "brooklyn", "richmond hill": "queens", richmondtown: "staten-island", ridgewood: "queens", riverdale: "bronx", "rochdale village": "queens", "rockaway beach": "queens",
  "rockaway park": "queens", "roosevelt island": "manhattan", rosebank: "staten-island", rosedale: "queens", rossville: "staten-island", "sea gate": "brooklyn", "sheepshead bay": "brooklyn", soho: "manhattan",
  soundview: "bronx", "south beach": "staten-island", "south jamaica": "queens", "south ozone park": "queens", "south richmond hill": "queens", "south slope": "brooklyn", "south williamsburg": "brooklyn", "spring creek": "brooklyn",
  "springfield gardens": "queens", "spuyten duyvil": "bronx", "st albans": "queens", "st george": "staten-island", stapleton: "staten-island", "starrett city": "brooklyn", "stuyvesant town": "manhattan", "sugar hill": "manhattan",
  sunnyside: "queens", "sunset park": "brooklyn", "throgs neck": "bronx", "times square": "manhattan", "todt hill": "staten-island", tompkinsville: "staten-island", tottenville: "staten-island", tremont: "bronx",
  tribeca: "manhattan", "turtle bay": "manhattan", "two bridges": "manhattan", "union square": "manhattan", unionport: "bronx", "university heights": "bronx", "upper east side": "manhattan", "upper west side": "manhattan",
  "van cortlandt village": "bronx", "van nest": "bronx", wakefield: "bronx", "west farms": "bronx", "west harlem": "manhattan", "west new brighton": "staten-island", "west village": "manhattan", "westchester square": "bronx",
  westerleigh: "staten-island", whitestone: "queens", "willets point": "queens", williamsbridge: "bronx", williamsburg: "brooklyn", willowbrook: "staten-island", "windsor terrace": "brooklyn", woodhaven: "queens",
  woodrow: "staten-island", woodside: "queens",
});
