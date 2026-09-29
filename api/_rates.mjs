export const CLASSES = {
  suv: { name: "Business SUV", seats: 5 },
  first: { name: "First Class", seats: 3 },
  sedan: { name: "Sedan & Electric", seats: 3 },
  sprinter: { name: "Luxury Sprinter", seats: 12 },
};
export const VEHICLES = {
  "suv-suburban": { cls: "suv", model: "Chevrolet Suburban or similar", hourly: 9500 },
  "suv-denali": { cls: "suv", model: "GMC Denali", hourly: 10000 },
  "suv-navigator": { cls: "suv", model: "Lincoln Navigator", hourly: 10000 },
  "suv-escalade": { cls: "suv", model: "Cadillac Escalade ESV", hourly: 10500 },
  sedan: { cls: "sedan", model: "", hourly: 8500 },
  first: { cls: "first", model: "", hourly: 12500 },
  sprinter: { cls: "sprinter", model: "", hourly: null },
};
export const CLASS_DEFAULT_VEHICLE = { suv: "suv-suburban", first: "first", sedan: "sedan", sprinter: "sprinter" };
export const DEFAULT_CLASS = "suv";
export const DEFAULT_VEHICLE = "suv-suburban";
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
  suv: { jfk: 16500, ewr: 16500, teb: 16500, lga: 13000 },
  first: { jfk: 16500, ewr: 16500, teb: 16500 },
};
export const MEET_AND_GREET = 2500;
export const GRATUITY_RATE = 0.2;
export const HOURS = { min: 3, max: 12 };
export const PASSENGERS = { min: 1, max: 12 };
export const MIN_NOTICE_HOURS = 24;
export const MAX_ADVANCE_DAYS = 365;
export const TAXABLE_AIRPORTS = ["jfk", "lga"];
export const DESCRIPTOR_PREFIX = "NYCLUXRIDE";
export const DESCRIPTOR_CODES = { jfk: "JFK", lga: "LGA", ewr: "EWR", teb: "TEB", hourly: "HOUR" };
export const TLC_BASE_LICENSE = "";
export const CONTACT = { phone: "+1 (646) 775-0556", tel: "tel:+16467750556", whatsapp: "https://wa.me/16467750556", email: "info@nycluxride.com" };
export const SITE_ORIGIN = "https://www.nycluxride.com";
export const STRIPE_VERSION = "2026-09-30.endive";
export const CHECKOUT_ORIGINS = ["https://checkout.stripe.com"];
export const CONSENT_TERMS_LIVE = false;
