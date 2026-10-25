export const HEADINGS = {
  price: "Get a price for this trip",
  phone: "Reserve this trip by email or WhatsApp",
};
export const REASONS = {
  unplaced: { group: "price", text: "Add the ZIP code after the name to see the price, like this: The New York EDITION, 10010.", google: "Add the ZIP code, or pick the address from the list, to see the price." },
  "stop-leg": { group: "price", text: "Our dispatch team prices trips with stops, unless each part is between JFK, LaGuardia, Newark or Teterboro and a New York City address." },
  "airport-to-airport": { group: "price", text: "Our dispatch team prices trips between two airports." },
  "no-airport": { group: "price", text: "We can't price this trip online right now. Our dispatch team prices it. You can also book by the hour and pay now.", short: "We can't price this trip online right now. Our dispatch team prices it." },
  "outside-trip": { group: "price", text: "Our dispatch team prices trips that start and end outside New York City." },
  "long-trip": { group: "price", text: "Our dispatch team prices long trips like this one." },
  "other-airport": { group: "price", text: "Our dispatch team prices trips to or from this airport." },
  "outside-city": { group: "price", text: "The flat airport rate is for New York City addresses. For other places, our dispatch team prices the trip." },
  "outside-hourly": { group: "price", text: "Our dispatch team prices hourly bookings that start outside New York City." },
  "hours-range": { group: "price", text: "You can book 3 to 12 hours online. For a longer day, our dispatch team prices it." },
  "sprinter-hourly": { group: "price", text: "Our dispatch team prices Luxury Sprinter bookings by the hour." },
  "sprinter-distance": { group: "price", text: "Our dispatch team prices Luxury Sprinter trips that don't start or end at an airport." },
  seats: { group: "phone", text: "This car doesn't seat that many people. Choose a larger car, or send us the trip for a price." },
  paused: { group: "phone", text: "Online payment isn't available for this trip." },
  "clock-change": { group: "phone", text: "The clocks change at this hour. This pickup time can't be booked online. Choose another time, or email info@nycluxride.com or message us on WhatsApp." },
  "short-notice": { group: "phone", text: "For a pickup within the next hour, email info@nycluxride.com or message us on WhatsApp." },
  "far-ahead": { group: "phone", text: "For a pickup more than a year from now, email info@nycluxride.com or message us on WhatsApp." },
};
export const ERROR_BLOCK = { group: "phone", text: "Online payment isn't available right now. Send us the trip and we'll reply with a payment link." };
export const ERRORS = {
  form: { field: "form", text: "We couldn't read that request. Email the trip to info@nycluxride.com or send it on WhatsApp." },
  trip_type: { field: "trip_type", text: "Choose One way or By the hour." },
  from: { field: "from_text", text: "Add the pickup address, airport or hotel." },
  to: { field: "to_text", text: "Add the drop-off address, airport or hotel." },
  date: { field: "date", text: "Add a date." },
  "date-past": { field: "date", text: "Choose a date and time in the future." },
  "return-date": { field: "return_date", text: "Choose a return date and time after the pickup." },
  passengers: { field: "passengers", text: "Choose the number of passengers." },
  hours: { field: "hours", text: "Choose the number of hours." },
  class: { field: "class", text: "Choose a vehicle class." },
  vehicle: { field: "vehicle", text: "Choose a vehicle." },
  flight: { field: "flight", text: "Type the flight number with letters and numbers only." },
  return_flight: { field: "return_flight", text: "Type the return flight number with letters and numbers only." },
  tip: { field: "tip", text: "Choose a gratuity from the list." },
  tip_amount: { field: "tip_amount", text: "Type the gratuity in whole dollars, or choose None." },
  rider: { field: "rider", text: "Choose who is riding." },
  name: { field: "name", text: "Add your full name." },
  email: { field: "email", text: "Add your email address, for example name@example.com." },
  phone: { field: "phone", text: "Add your mobile number, and check its country code." },
  reach: { field: "reach", text: "Choose Phone or WhatsApp." },
  pname: { field: "pname", text: "Add the passenger's full name." },
  pphone: { field: "pphone", text: "Add the passenger's mobile number, and check its country code." },
};
export const POLICY = {
  cancel: "Cancellation terms are confirmed in writing with the reservation. To change or cancel, call +1 (646) 775-0556 or message on WhatsApp with your reference, and give as much notice as you can.",
  later: {
    airport: "After the ride, only waiting beyond the free window, extra stops and parking are charged to your card, each on an itemized receipt.",
    hourly: "After the ride, tolls and parking are charged to your card, each on an itemized receipt.",
  },
};
const INCLUDED = "Tolls, airport fees, NYC sales tax and the Black Car Fund are included.";
export const NOTES = {
  included: INCLUDED,
  airport: INCLUDED + " " + POLICY.later.airport,
  hourly: POLICY.later.hourly,
};
export const LABELS = {
  fare: "Fare",
  fareHours: "Fare, {hours} hours",
  tax: "NYC sales tax ({percent}%)",
  bcf: "Black Car Fund ({percent}%)",
  tolls: "Tolls and airport fees",
  meet: "Meet and greet",
  meetDescription: "Inside the terminal with a name sign. Airport parking is charged after the ride.",
  gratuity: "Gratuity for your chauffeur ({rate}%)",
  gratuityAmount: "Gratuity for your chauffeur",
  gratuityDescription: "Paid in full to your chauffeur.",
  legacyTax: "Sales tax",
  to: "To {airport}, {class}",
  from: "From {airport}, {class}",
  hourly: "By the hour, {vehicle}",
  hourlyLine: "By the hour, {vehicle}, {hours} hours",
  summary: "{date}, {time}. {service}.",
  summaryReturn: "{date}, {time}. Return {rdate}, {rtime}. {service}.",
  legs: "{class}, {legs} airport transfers",
  distance: "{class}, {miles} miles and {minutes} min",
  distanceLegs: "{class}, {legs} rides, {miles} miles and {minutes} min",
};
export const CHECKOUT = {
  terms: "I agree to the [terms of service](https://www.nycluxride.com/terms-of-service#payments) and the [rates and cancellation terms](https://www.nycluxride.com/rates#cancellation). I allow charges to this card after the ride for waiting beyond the free window, extra stops, parking and, on hourly bookings and trips priced by distance and time, tolls, as the terms describe.",
  submit: "Today you pay the total shown: the fare, NYC sales tax, the Black Car Fund, tolls and airport fees, meet and greet if chosen, and the gratuity if you chose one. After the ride, only waiting beyond the free window, extra stops and parking are charged to this card, with an itemized receipt.",
  submitHourly: "Today you pay the hourly fare, NYC sales tax, the Black Car Fund, meet and greet if chosen, and the gratuity if you chose one. After the ride, tolls and parking are charged to this card, with an itemized receipt.",
  submitDistance: "Today you pay the fare, NYC sales tax, the Black Car Fund and the gratuity if you chose one. After the ride, tolls and parking are charged to this card, with an itemized receipt.",
  license: "Licensed by the NYC Taxi and Limousine Commission, base license {license}.",
  afterSubmit: "We confirm your car and chauffeur in writing before your ride. To change or cancel, email info@nycluxride.com or message us on WhatsApp with your reference {ref}.",
};
export const MESSAGE = {
  intro: "Hi NYC LUX RIDE, I would like to book this trip.",
  subject: "Booking request {ref}",
};
