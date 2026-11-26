export { PUB_718, ZIP_SOURCE, TAX_AREAS, NYC_TAX_AREA, COUNTY_AREAS, CITY_AREAS, CITY_ZIPS, ZIP_AREAS } from "./_salestax.mjs";
export const CLASSES = {
  suv: { name: "Business SUV", seats: 6, bags: "3 large plus 3 small bags" },
  premium: { name: "Business Premium SUV", seats: 6, bags: "3 large plus 3 small bags" },
  first: { name: "First Class", seats: 3, bags: "2 large plus 1 small bag" },
  sedan: { name: "Executive Sedan", seats: 3, bags: "" },
  electric: { name: "Electric Class", seats: 3, bags: "" },
  sprinter: { name: "Luxury Sprinter", seats: 14, bags: "10 large plus 2 small bags" },
};
export const VEHICLES = {
  "suv-suburban": { cls: "suv", model: "Chevrolet Suburban or similar", hourly: 9500 },
  "suv-denali": { cls: "suv", model: "GMC Denali", hourly: 10000 },
  "suv-navigator": { cls: "suv", model: "Lincoln Navigator", hourly: 10000 },
  premium: { cls: "premium", model: "Cadillac Escalade ESV", hourly: 10500 },
  sedan: { cls: "sedan", model: "Mercedes-Benz E-Class or similar", hourly: 8500 },
  electric: { cls: "electric", model: "Cadillac Lyriq or similar", hourly: 9000 },
  first: { cls: "first", model: "", hourly: 17500 },
  "sprinter-executive": { cls: "sprinter", name: "Executive Sprinter", hourly: 17500, seats: 14, minHours: 4 },
  "sprinter-luxury-jet": { cls: "sprinter", name: "Luxury Jet Sprinter", hourly: 21500, seats: 8, minHours: 4 },
  "sprinter-presidential": { cls: "sprinter", name: "Presidential Sprinter", hourly: 24500, seats: 12, minHours: 4 },
  "sprinter-limo": { cls: "sprinter", name: "Limo Sprinter", hourly: 26500, seats: 14, minHours: 4 },
  "sprinter-white-limo": { cls: "sprinter", name: "White Luxury Limo Sprinter", hourly: 27500, seats: 10, minHours: 4 },
};
export const RETIRED_VEHICLES = { "sprinter-shuttle": { cls: "sprinter", name: "Shuttle Sprinter" }, "sprinter-jet": { cls: "sprinter", name: "Jet Sprinter" } };
export const CLASS_DEFAULT_VEHICLE = { suv: "suv-suburban", premium: "premium", first: "first", sedan: "sedan", electric: "electric", sprinter: "sprinter-executive" };
export const PLACES = {
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  queens: "Queens",
  bronx: "The Bronx",
  "staten-island": "Staten Island",
  outside: "Outside New York City",
  jfk: "JFK",
  lga: "LaGuardia (LGA)",
  ewr: "Newark Liberty (EWR)",
  teb: "Teterboro (TEB)",
};
export const ADDRESS_PLACES = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "outside"];
export const AIRPORT_PLACES = ["jfk", "lga", "ewr", "teb"];
export const AIRPORT_STATES = { jfk: "NY", lga: "NY", ewr: "NJ", teb: "NJ" };
export const AIRPORT_FARES = {
  suv: { jfk: 15379, lga: 13593, ewr: 15379, teb: 15379 },
  premium: { jfk: 18504, lga: 15825, ewr: 18504, teb: 18504 },
  first: { jfk: 26539, lga: 21182, ewr: 26539, teb: 26539 },
  sedan: { jfk: 14039, lga: 11807, ewr: 14039, teb: 14039 },
  electric: { jfk: 14932, lga: 12700, ewr: 14932, teb: 14932 },
  "sprinter-executive": { jfk: 39039, lga: 39039, ewr: 41271, teb: 41271 },
  "sprinter-luxury-jet": { jfk: 50200, lga: 47968, ewr: 51986, teb: 51986 },
  "sprinter-presidential": { jfk: 56896, lga: 54664, ewr: 59129, teb: 59129 },
  "sprinter-limo": { jfk: 61361, lga: 59129, ewr: 63593, teb: 63593 },
  "sprinter-white-limo": { jfk: 65825, ewr: 68057, teb: 68057 },
};
export const AIRPORT_TOTALS = {
  suv: { jfk: 18500, lga: 16500, ewr: 18500, teb: 18500 },
  premium: { jfk: 22000, lga: 19000, ewr: 22000, teb: 22000 },
  first: { jfk: 31000, lga: 25000, ewr: 31000, teb: 31000 },
  sedan: { jfk: 17000, lga: 14500, ewr: 17000, teb: 17000 },
  electric: { jfk: 18000, lga: 15500, ewr: 18000, teb: 18000 },
  "sprinter-executive": { jfk: 45000, lga: 45000, ewr: 47500, teb: 47500 },
  "sprinter-luxury-jet": { jfk: 57500, lga: 55000, ewr: 59500, teb: 59500 },
  "sprinter-presidential": { jfk: 65000, lga: 62500, ewr: 67500, teb: 67500 },
  "sprinter-limo": { jfk: 70000, lga: 67500, ewr: 72500, teb: 72500 },
  "sprinter-white-limo": { jfk: 75000, ewr: 77500, teb: 77500 },
};
export const FEE_PERCENT = "12";
export const SHORT_MILES = 50;
export const LONG_MILES = 75;
export const DISTANCE_RATES = {
  suv: { base: 8500, mile: 400, minute: 65, minimum: 8500 },
  premium: { base: 9500, mile: 475, minute: 80, minimum: 9500 },
  first: { base: 10500, mile: 525, minute: 90, minimum: 10500 },
  sedan: { base: 7500, mile: 300, minute: 50, minimum: 7500 },
  electric: { base: 7647, mile: 318, minute: 53, minimum: 7647 },
  "sprinter-executive": { base: 8000, mile: 900, minute: 145, minimum: 35000 },
};
export const LONG_RATES = {
  suv: { base: 0, mile: 410, minute: 25 },
  premium: { base: 0, mile: 470, minute: 30 },
  first: { base: 0, mile: 585, minute: 35 },
  sedan: { base: 0, mile: 370, minute: 20 },
  electric: { base: 0, mile: 370, minute: 20 },
  "sprinter-executive": { base: 7300, mile: 820, minute: 132 },
};
export const DISTANCE_LIMITS = { miles: 500, minutes: 720 };
export const DISTANCE_SKIP_ZIPS = ["11430", "11371", "07114", "07608"];
export const TIP_PERCENTS = [0, 10, 15, 20, 25];
export const TIP_DEFAULT = 25;
export const STRIPE_MAX_CENTS = 99999999;
export const TIP_CUSTOM = { min: 100, max: STRIPE_MAX_CENTS };
export const MAX_STOPS = 2;
export const percentCents = (cents, percent) => Math.round((cents * Math.round(Number(percent) * 10000)) / 1000000);
export const MEET_AND_GREET = 2500;
export const CHILD_SEAT_CENTS = 2000;
export const SMALL_DOG_CENTS = 2000;
export const LARGE_DOG_CENTS = 4500;
export const STOP_FEE_CENTS = 2000;
export const CHILD_SEATS = ["toddler", "infant", "booster"];
export const CHILD_SEAT_LIMITS = { suv: { seats: 3, adults: 1, oneAdult: 2 }, premium: { seats: 3, adults: 1, oneAdult: 2 }, sedan: { seats: 1 }, electric: { seats: 1 } };
export const DOG_SIZES = ["small", "large"];
export const MAX_DOGS = 3;
export const BAG_SIZES = ["large", "medium", "small"];
export const MAX_BAGS = 14;
export const HOURS = { min: 3, max: 12 };
export const PASSENGERS = { min: 1, max: 14 };
export const FREE_WAIT_MINUTES = { local: 15, domestic: 45, international: 60 };
export const WAIT_CENTS_PER_MINUTE = { sedan: 120, electric: 120, suv: 150, premium: 180, first: 280, sprinter: 400 };
export const CANCEL_TIERS = [{ hours: 24, percent: 0 }, { hours: 12, percent: 25 }, { hours: 2, percent: 50 }, { hours: 0, percent: 100 }];
export const MIN_NOTICE_MINUTES = 90;
export const PAID_NOTICE_MINUTES = 60;
export const SPRINTER_NOTICE_HOURS = 3;
export const SPRINTER_BUSY_HOURS = 24;
export const AUTO_LEAD_MINUTES = 5;
export const AUTO_GUARD_MINUTES = 2;
export const MAX_ADVANCE_DAYS = 365;
export const DESCRIPTOR_CODES = { jfk: "JFK", lga: "LGA", ewr: "EWR", teb: "TEB", hourly: "HOUR", distance: "RIDE" };
export const TOLL_CLASS = { suv: "1", premium: "1", first: "1", sedan: "1", electric: "1", sprinter: "1" };
export const PA_TOLLS = { 1: { offPeak: 1479, peak: 1679 }, 2: { offPeak: 4334, peak: 4534 }, "8A": { offPeak: 1680, peak: 2100 } };
export const PA_PEAK = { weekday: [[360, 600], [960, 1200]], weekend: [[660, 1260]] };
export const NJTP_TOLLS = {
  1: {
    13: { "13A": 141, 14: 229, "18E": 750, "18W": 750 },
    "13A": { 13: 141, 14: 141, "18E": 750, "18W": 750 },
    14: { 13: 229, "13A": 141, "18E": 571, "18W": 571 },
    "18E": { 13: 750, "13A": 750, 14: 571 },
    "18W": { 13: 750, "13A": 750, 14: 571 },
  },
};
export const TOLL_TABLE_UNTIL = "2028-01-01T00:00:00-05:00";
export const TLC_BASE_LICENSE = "";
export const CONTACT = { phone: "+1 (646) 775-0556", tel: "tel:+16467750556", whatsapp: "https://wa.me/16467750556", email: "info@nycluxride.com" };
export const SITE_ORIGIN = "https://www.nycluxride.com";
export const STRIPE_VERSION = "2026-09-30.endive";
export const CHECKOUT_ORIGINS = ["https://checkout.stripe.com"];
export const CONSENT_TERMS_LIVE = true;
