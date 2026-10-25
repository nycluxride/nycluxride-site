export const CLASSES = {
  suv: { name: "Business SUV", seats: 5, bags: "3 large plus 3 small bags" },
  premium: { name: "Business Premium SUV", seats: 5, bags: "3 large plus 3 small bags" },
  first: { name: "First Class", seats: 3, bags: "2 large plus 1 small bag" },
  sedan: { name: "Sedan & Electric", seats: 3, bags: "" },
  sprinter: { name: "Luxury Sprinter", seats: 12, bags: "10 large plus 2 small bags" },
};
export const VEHICLES = {
  "suv-suburban": { cls: "suv", model: "Chevrolet Suburban or similar", hourly: 9500 },
  "suv-denali": { cls: "suv", model: "GMC Denali", hourly: 10000 },
  "suv-navigator": { cls: "suv", model: "Lincoln Navigator", hourly: 10000 },
  premium: { cls: "premium", model: "Cadillac Escalade ESV", hourly: 10500 },
  sedan: { cls: "sedan", model: "", hourly: 8500 },
  first: { cls: "first", model: "", hourly: 17500 },
  sprinter: { cls: "sprinter", model: "", hourly: null },
};
export const CLASS_DEFAULT_VEHICLE = { suv: "suv-suburban", premium: "premium", first: "first", sedan: "sedan", sprinter: "sprinter" };
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
export const HOURLY_START = ["manhattan", "brooklyn", "queens", "bronx", "staten-island", "jfk", "lga"];
export const AIRPORT_FARES = {
  suv: { jfk: 15500, lga: 13701, ewr: 15500, teb: 15500 },
  premium: { jfk: 18650, lga: 15950, ewr: 18650, teb: 18650 },
  first: { jfk: 26749, lga: 21350, ewr: 26749, teb: 26749 },
  sedan: { jfk: 14151, lga: 11901, ewr: 14151, teb: 14151 },
  sprinter: { jfk: 34848, lga: 30349, ewr: 34848, teb: 34848 },
};
export const AIRPORT_TOTALS = {
  suv: { jfk: 18500, lga: 16500, ewr: 18500, teb: 18500 },
  premium: { jfk: 22000, lga: 19000, ewr: 22000, teb: 22000 },
  first: { jfk: 31000, lga: 25000, ewr: 31000, teb: 31000 },
  sedan: { jfk: 17000, lga: 14500, ewr: 17000, teb: 17000 },
  sprinter: { jfk: 40000, lga: 35000, ewr: 40000, teb: 40000 },
};
export const DISTANCE_RATES = {
  suv: { base: 3500, mile: 400, minute: 65, minimum: 11000 },
  premium: { base: 4500, mile: 475, minute: 80, minimum: 12500 },
  first: { base: 5500, mile: 525, minute: 90, minimum: 17000 },
  sedan: { base: 2500, mile: 300, minute: 50, minimum: 8700 },
};
export const DISTANCE_AREAS = ["manhattan", "brooklyn", "queens", "bronx", "staten-island"];
export const DISTANCE_LIMITS = { miles: 60, minutes: 180 };
export const DISTANCE_SKIP_ZIPS = ["11430", "11371", "07114", "07608"];
export const NYC_TAX_PERCENT = "8.875";
export const BCF_PERCENT = "2.25";
export const TIP_PERCENTS = [0, 10, 15, 20];
export const TIP_CUSTOM = { min: 100, max: 50000 };
export const MAX_STOPS = 2;
export const percentCents = (cents, percent) => Math.round((cents * Math.round(Number(percent) * 10000)) / 1000000);
export const MEET_AND_GREET = 2500;
export const HOURS = { min: 3, max: 12 };
export const PASSENGERS = { min: 1, max: 12 };
export const MIN_NOTICE_HOURS = 1;
export const AUTO_LEAD_MINUTES = 5;
export const AUTO_GUARD_MINUTES = 2;
export const MAX_ADVANCE_DAYS = 365;
export const DESCRIPTOR_CODES = { jfk: "JFK", lga: "LGA", ewr: "EWR", teb: "TEB", hourly: "HOUR", distance: "RIDE" };
export const TLC_BASE_LICENSE = "";
export const CONTACT = { phone: "+1 (646) 775-0556", tel: "tel:+16467750556", whatsapp: "https://wa.me/16467750556", email: "info@nycluxride.com" };
export const SITE_ORIGIN = "https://www.nycluxride.com";
export const STRIPE_VERSION = "2026-09-30.endive";
export const CHECKOUT_ORIGINS = ["https://checkout.stripe.com"];
export const CONSENT_TERMS_LIVE = true;
