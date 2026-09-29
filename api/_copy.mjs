export const HEADINGS = {
  price: "Get a price for this trip",
  phone: "Book this trip by phone or WhatsApp",
};
export const QUOTE_BODY = "Send the trip. Dispatch replies with the fare and a payment link. Nothing is reserved until you pay.";
export const REASONS = {
  "class-airport": { group: "price", text: "Airport trips in Sedan & Electric and Luxury Sprinter are priced by dispatch. A Business SUV can be paid now." },
  "first-lga": { group: "price", text: "First Class trips to or from LaGuardia are priced by dispatch. A Business SUV can be paid now." },
  "sprinter-hourly": { group: "price", text: "Luxury Sprinter trips are priced by dispatch." },
  "airport-to-airport": { group: "price", text: "Trips between two airports are priced by dispatch." },
  "no-airport": { group: "price", text: "One way trips that do not start or end at an airport are priced by dispatch. You can also book by the hour and pay now." },
  "outside-city": { group: "price", text: "The flat airport fare is for New York City addresses. Trips to or from other places are priced by dispatch." },
  "outside-hourly": { group: "price", text: "Hourly bookings that start outside New York City are priced by dispatch." },
  "hours-range": { group: "price", text: "Online hourly bookings are 3 to 12 hours. For a longer day, dispatch sends a price." },
  seats: { group: "phone", text: "This car does not seat that many passengers. Choose a larger car, or send the trip for a price." },
  "short-notice": { group: "phone", text: "Pickups less than 24 hours from now are booked by phone or WhatsApp." },
  "far-ahead": { group: "phone", text: "Pickups more than 1 year from now are booked by phone or WhatsApp." },
  paused: { group: "phone", text: "Online payment is not available for this trip. Book by phone or WhatsApp." },
};
export const ERROR_BLOCK = { group: "phone", text: "Online payment is not available right now. Send the trip and dispatch replies with a payment link." };
export const ERRORS = {
  form: { field: "form", text: "That request could not be read. Call +1 (646) 775-0556." },
  trip_type: { field: "trip_type", text: "Choose One way or By the hour." },
  from: { field: "from", text: "Choose where the pickup is." },
  to: { field: "to", text: "Choose where the drop-off is." },
  from_address: { field: "from_address", text: "Add the pickup address or hotel." },
  to_address: { field: "to_address", text: "Add the drop-off address or hotel." },
  date: { field: "date", text: "Add a date and a time." },
  "date-past": { field: "date", text: "Choose a date and time in the future." },
  passengers: { field: "passengers", text: "Choose the number of passengers." },
  hours: { field: "hours", text: "Choose the number of hours." },
  class: { field: "class", text: "Choose a vehicle class." },
  vehicle: { field: "vehicle", text: "Choose a vehicle." },
  flight: { field: "flight", text: "Type the flight number with letters and numbers only." },
};
export const NOTES = {
  after: "After the ride, tolls, airport parking, taxes and government trip charges are charged to your card, each on an itemized receipt.",
  afterTaxed: "After the ride, tolls, airport parking, government trip charges and the tax on them are charged to your card, each on an itemized receipt.",
};
export const LABELS = {
  to: "To {airport}, {class}",
  from: "From {airport}, {class}",
  hourly: "By the hour, {vehicle}",
  hourlyLine: "By the hour, {vehicle}, {hours} hours",
  meet: "Meet and greet",
  meetDescription: "Inside the terminal with a name sign. Airport parking is charged after the ride.",
  gratuity: "Gratuity for your chauffeur ({rate}%)",
  gratuityDescription: "Paid in full to your chauffeur.",
  tax: "Sales tax ({percent}%)",
  summary: "{date}, {time}. {service}.",
};
export const CHECKOUT = {
  terms: "I agree to the [terms of service](https://www.nycluxride.com/terms-of-service#payments) and the [rates and cancellation terms](https://www.nycluxride.com/rates#cancellation). I allow the charges to this card after the ride that the terms describe.",
  submit: "Today you pay the fare, meet and greet if chosen, and the {rate}% gratuity for your chauffeur. After the ride, tolls, airport parking, taxes and government trip charges are charged to this card, with an itemized receipt. You can ask for a fare estimate that includes all fees at +1 (646) 775-0556.",
  submitTaxed: "Today you pay the fare, meet and greet if chosen, sales tax, and the {rate}% gratuity for your chauffeur. After the ride, tolls, airport parking, government trip charges and the tax on them are charged to this card, with an itemized receipt. You can ask for a fare estimate that includes all fees at +1 (646) 775-0556.",
  license: "Licensed by the NYC Taxi and Limousine Commission, base license {license}.",
  afterSubmit: "Dispatch confirms your vehicle and chauffeur in writing before the day. To change or cancel, call +1 (646) 775-0556 or message on WhatsApp with your reference {ref}.",
  passenger: "Passenger name and mobile, if not you",
  signName: "Name for the sign",
  notes: "Notes for your chauffeur",
};
export const MESSAGE = {
  intro: "Hi NYC LUX RIDE, I would like to book this trip.",
  subject: "Booking request {ref}",
};
