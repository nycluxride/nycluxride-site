import { createHash, randomBytes } from "node:crypto";
import { CLASSES, VEHICLES, PLACES, CONTACT, SITE_ORIGIN, CHILD_SEATS } from "./_rates.mjs";
import { MAIL } from "./_copy.mjs";
import { receipt, readSettings, formatDate, formatTime, money, vehicleLabel, fill, validDate, nycToUtc, seatText } from "./_trip.mjs";
import { instanceBudget } from "./_http.mjs";
import { retrieveIntent, retrieveSession, updateMetadata } from "./_stripe.mjs";
import { buildMessage, smtpSend, addressOk, headerText } from "./_smtp.mjs";

const DEFAULTS = { host: "smtp.gmail.com", port: "465", from: "NYC LUX RIDE <info@nycluxride.com>", owners: "info@nycluxride.com,nycluxride@gmail.com" };
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTENT = /^pi_[A-Za-z0-9]{6,200}$/;
const AIRPORT_ZONE = /^(jfk|lga|ewr|teb|airport-other)$/;
const AIRPORT_PLACE = /^(jfk|lga|ewr|teb)(-|$)/;
const KINDS = ["customer", "owner"];
const DATA_STAGES = ["data", "message"];
const SMTP_MS = 8000;
const STRIPE_MS = 5000;
const STALE_MS = 120000;
const SETTLE_MS = 2000;
const MAX_TRIES = 5;
const RUNS_PER_WINDOW = 300;
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const STYLE = {
  body: "margin:0;padding:0;background-color:#ffffff;color:#14181f",
  wrap: "max-width:600px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#14181f;background-color:#ffffff",
  notice: "margin:0 0 16px;padding:12px 16px;border:2px solid #14181f",
  h1: "margin:0 0 16px;font-size:24px;line-height:1.25",
  h2: "margin:28px 0 8px;font-size:18px;line-height:1.3",
  table: "width:100%;border-collapse:collapse",
  th: "width:40%;padding:6px 16px 6px 0;text-align:left;vertical-align:top;font-weight:bold",
  td: "padding:6px 0;text-align:left;vertical-align:top",
  amount: "padding:6px 0;text-align:right;vertical-align:top;white-space:nowrap",
  rule: "border-top:1px solid #14181f",
  p: "margin:12px 0",
  list: "margin:12px 0;padding:0 0 0 24px",
  item: "margin:0 0 10px",
  link: "color:#0b4fa8;text-decoration:underline",
};

const text = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const has = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const place = (value) => text(value).replace(/, USA$/, "");
const atAirport = (spot, zone) => AIRPORT_PLACE.test(spot) || AIRPORT_ZONE.test(zone);
const terminal57 = (spot, zone, words) => /^jfk-t[57]$/.test(spot) || (zone === "jfk" && /\bterminal ?[57]\b/i.test(words));
const metadataOf = (object) => (object && object.metadata && typeof object.metadata === "object" ? object.metadata : {});
const intentOf = (session) => {
  const id = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent && session.payment_intent.id;
  return INTENT.test(id || "") ? id : "";
};
const refOf = (session) => (session ? text(metadataOf(session).ref) || text(session.client_reference_id) : "");

function parseFrom(value) {
  const match = /^(.*)<([^<>]*)>$/.exec(value);
  const address = (match ? match[2] : value).trim();
  return addressOk(address) ? { name: match ? match[1].trim().replace(/^"(.*)"$/, "$1").trim() : "", address } : null;
}

export function mailSettings() {
  const user = text(process.env.SMTP_USER);
  const pass = text(process.env.SMTP_PASS);
  if (!user || !pass) return { off: true };
  const host = text(process.env.SMTP_HOST) || DEFAULTS.host;
  const port = Number(text(process.env.SMTP_PORT) || DEFAULTS.port);
  const from = parseFrom(text(process.env.MAIL_FROM) || DEFAULTS.from);
  const seen = new Set();
  const owners = (text(process.env.OWNER_EMAILS) || DEFAULTS.owners).split(/[\s,;]+/).filter((address) => addressOk(address) && !seen.has(address.toLowerCase()) && seen.add(address.toLowerCase()));
  if (!from || !HOST.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return { bad: true };
  return { host, port, user, pass, from, owners, helo: from.address.split("@")[1] };
}

function when(date, time) {
  if (!validDate(date) || !TIME.test(time)) return "";
  const [weekday, day] = formatDate(date).split(", ");
  return `${weekday} ${day}, ${formatTime(time)}`;
}

function shortPlace(words, zone) {
  if (/^(jfk|lga|ewr|teb)$/.test(zone)) return PLACES[zone];
  return Array.from(headerText(place(words)).split(",")[0].trim()).slice(0, 60).join("");
}

function bookingOf(session) {
  const data = metadataOf(session);
  const who = session.customer_details || {};
  const field = (name) => text(data[name]);
  const tax = session.total_details && Number.isInteger(session.total_details.amount_tax) ? session.total_details.amount_tax : undefined;
  const hourly = field("service") === "hourly";
  return {
    field,
    hourly,
    back: !hourly && validDate(field("return_date")) && TIME.test(field("return_time")),
    other: field("rider") === "other",
    ref: refOf(session),
    test: /^cs_test_/.test(text(session.id)) || session.livemode === false,
    email: [text(who.email), field("email")].find(addressOk) || "",
    name: field("name") || text(who.name),
    phone: field("phone") || text(who.phone),
    total: Number.isInteger(session.amount_total) ? session.amount_total : null,
    intent: intentOf(session),
    receipt: receipt(data, readSettings(process.env), tax),
  };
}

function tripRows(b) {
  const L = MAIL.labels;
  const f = b.field;
  const dated = validDate(f("date")) && TIME.test(f("time"));
  const meet = f("meet") === "1";
  const vehicle = b.hourly && has(VEHICLES, f("vehicle")) ? vehicleLabel(f("vehicle")) : has(CLASSES, f("class")) ? CLASSES[f("class")].name : "";
  const rows = [
    [L.ref, b.ref],
    [L.trip, b.hourly ? (/^\d+$/.test(f("hours")) ? fill(L.hourly, { hours: f("hours") }) : "") : b.back ? L.roundTrip : L.oneWay],
    [L.from, place(f("from_text"))],
    ...(b.hourly ? [] : [[L.stop1, place(f("stop1_text"))], [L.stop2, place(f("stop2_text"))], [L.to, place(f("to_text"))]]),
    [L.date, dated ? formatDate(f("date")) : ""],
    [L.time, dated ? fill(L.clock, { time: formatTime(f("time")) }) : ""],
    [L.back, b.back ? fill(L.clock, { time: `${formatDate(f("return_date"))}, ${formatTime(f("return_time"))}` }) : ""],
    [L.backFlight, b.back ? f("return_flight") : ""],
    [L.passengers, f("passengers")],
    [L.vehicle, vehicle],
    [L.flight, f("flight")],
    [L.meet, meet ? L.yes : ""],
    [L.sign, meet ? f("sign_name") : ""],
    [L.seats, seatText({ seats: Object.fromEntries(CHILD_SEATS.map((k) => [k, f(`${k}_seats`)])) }) || f("child_seats")],
    [L.notes, f("notes")],
  ];
  return rows.filter(([, value]) => value);
}

function dayText(b) {
  const D = MAIL.day;
  const f = b.field;
  const fromAirport = atAirport(f("from_place"), f("from_zone"));
  const backAirport = b.back && atAirport(f("to_place"), f("to_zone"));
  const parts = [];
  if (f("meet") === "1") parts.push(D.meet);
  else if (fromAirport) parts.push(...(f("flight") ? [D.tracked] : []), b.other ? D.bagsOther : D.bags);
  else if (!b.hourly) parts.push(D.pickup);
  if (b.hourly) parts.push(fill(D.hourly, { who: b.other ? D.them : D.you }), D.long);
  if (backAirport) parts.push(b.other ? D.backOther : D.back);
  if (terminal57(f("from_place"), f("from_zone"), f("from_text")) || (b.back && terminal57(f("to_place"), f("to_zone"), f("to_text")))) parts.push(D.terminals);
  if ((fromAirport && !f("flight")) || (backAirport && !f("return_flight"))) parts.push(fill(D.askFlight, { ref: b.ref }));
  return parts.join(" ");
}

function told(b) {
  const day = dayText(b);
  return [
    { steps: [...MAIL.steps, ...(day ? [[MAIL.day.label, day]] : [])] },
    ...(b.other ? [{ p: fill(MAIL.other, { name: b.field("passenger_name") || MAIL.thePassenger }) }] : []),
    { change: fill(MAIL.change, { ref: b.ref }) },
    { links: [[MAIL.terms, `${SITE_ORIGIN}/terms-of-service`], [MAIL.rates, `${SITE_ORIGIN}/rates#cancellation`]] },
  ];
}

function payment(b) {
  return [{ prices: b.receipt.lines.map((line) => [line.label, money(line.cents)]), total: b.total === null ? null : [MAIL.paid, money(b.total)] }, ...b.receipt.notes.map((note) => ({ p: note })), ...(b.receipt.summary ? [{ p: b.receipt.summary }] : [])];
}

function textOf(blocks) {
  const out = [];
  const row = ([label, value]) => `${label}: ${String(value).replace(/\n/g, "\n  ")}`;
  for (const block of blocks) {
    if (block.notice) out.push(block.notice.join(" "), "");
    else if (block.h1) out.push(block.h1, "");
    else if (block.h2) out.push(block.h2);
    else if (block.rows) out.push(...block.rows.map(row), "");
    else if (block.prices) out.push(...[...block.prices, ...(block.total ? [block.total] : [])].map(row), "");
    else if (block.steps) out.push(...block.steps.map(row), "");
    else if (block.p) out.push(block.p, "");
    else if (block.change) out.push(block.change, `WhatsApp: ${CONTACT.whatsapp}`);
    else if (block.links) out.push(...block.links.map(row), "");
    else if (block.footer) out.push(MAIL.brand, CONTACT.phone, SITE_ORIGIN);
  }
  return `${out.join("\n").trim()}\n`;
}

function htmlOf(title, blocks) {
  const link = (href, label) => `<a href="${esc(href)}" style="${STYLE.link}">${esc(label)}</a>`;
  const whatsapp = (html) => html.replace("WhatsApp", link(CONTACT.whatsapp, "WhatsApp"));
  const cells = (label, value, style = STYLE.td) => `<tr><th scope="row" style="${STYLE.th}">${esc(label)}</th><td style="${style}">${esc(value).replace(/\n/g, "<br>")}</td></tr>`;
  const parts = [];
  for (const block of blocks) {
    if (block.notice) parts.push(`<p style="${STYLE.notice}"><strong>${esc(block.notice[0])}</strong> ${esc(block.notice[1])}</p>`);
    else if (block.h1) parts.push(`<h1 style="${STYLE.h1}">${esc(block.h1)}</h1>`);
    else if (block.h2) parts.push(`<h2 style="${STYLE.h2}">${esc(block.h2)}</h2>`);
    else if (block.rows) parts.push(`<table style="${STYLE.table}">${block.rows.map(([label, value]) => cells(label, value)).join("")}</table>`);
    else if (block.prices) {
      const total = block.total ? `<tr><th scope="row" style="${STYLE.th};${STYLE.rule}">${esc(block.total[0])}</th><td style="${STYLE.amount};${STYLE.rule};font-weight:bold">${esc(block.total[1])}</td></tr>` : "";
      parts.push(`<table style="${STYLE.table}">${block.prices.map(([label, value]) => cells(label, value, STYLE.amount)).join("")}${total}</table>`);
    } else if (block.steps) parts.push(`<ol style="${STYLE.list}">${block.steps.map(([label, value]) => `<li style="${STYLE.item}"><strong>${esc(label)}</strong><br>${whatsapp(esc(value))}</li>`).join("")}</ol>`);
    else if (block.p) parts.push(`<p style="${STYLE.p}">${esc(block.p)}</p>`);
    else if (block.change) parts.push(`<p style="${STYLE.p}">${whatsapp(esc(block.change).replace(CONTACT.email, link(`mailto:${CONTACT.email}`, CONTACT.email)))}</p>`);
    else if (block.links) parts.push(`<ul style="${STYLE.list}">${block.links.map(([label, href]) => `<li style="${STYLE.item}">${link(href, label)}</li>`).join("")}</ul>`);
    else if (block.footer) parts.push(`<p style="${STYLE.p}">${esc(MAIL.brand)}<br>${link(CONTACT.tel, CONTACT.phone)}<br>${link(SITE_ORIGIN, SITE_ORIGIN.replace("https://", ""))}</p>`);
  }
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n</head>\n<body style="${STYLE.body}">\n<div style="${STYLE.wrap}">\n${parts.join("\n")}\n</div>\n</body>\n</html>\n`;
}

export function bookingLetters(session, settings, now = Date.now()) {
  const b = bookingOf(session);
  const f = b.field;
  const L = MAIL.labels;
  const [lastDate, lastTime] = b.back ? [f("return_date"), f("return_time")] : [f("date"), f("time")];
  const ahead = !validDate(lastDate) || !TIME.test(lastTime) || nycToUtc(lastDate, lastTime).getTime() > now;
  const notice = b.test ? [{ notice: MAIL.testNote }] : [];
  const prefix = b.test ? MAIL.test : "";
  const pickup = when(f("date"), f("time"));
  const from = shortPlace(f("from_text"), f("from_zone"));
  const to = shortPlace(f("to_text"), f("to_zone"));
  const route = b.hourly ? (from && /^\d+$/.test(f("hours")) ? fill(MAIL.routeHourly, { hours: f("hours"), from }) : from) : from && to ? fill(b.back ? MAIL.routeReturn : MAIL.route, { from, to, when: when(f("return_date"), f("return_time")) }) : "";
  const car = has(CLASSES, f("class")) ? CLASSES[f("class")].name : "";
  const trip = tripRows(b);
  const id = (kind) => `${kind}.${createHash("sha256").update(`${session.id} ${kind}`).digest("hex").slice(0, 32)}`;
  const letters = [];
  if (b.email) {
    const subject = `${prefix}${[fill(MAIL.subject, { ref: b.ref }), pickup].filter(Boolean).join(", ")}`;
    const blocks = [...notice, { h1: MAIL.heading }, { h2: MAIL.trip }, { rows: trip }, { h2: MAIL.payment }, ...payment(b), ...(ahead ? [{ h2: MAIL.next }, ...told(b)] : []), { footer: true }];
    letters.push({ kind: "customer", to: [{ name: b.name, address: b.email }], replyTo: { name: MAIL.brand, address: CONTACT.email }, subject, text: textOf(blocks), html: htmlOf(subject, blocks), id: id("customer") });
  }
  if (settings.owners.length) {
    const details = [pickup, car, route].filter(Boolean).join(", ");
    const subject = `${prefix}${fill(MAIL.ownerSubject, { ref: b.ref })}${details ? `: ${details}` : ""}`;
    const customer = [[L.name, b.name], [L.email, b.email], [L.phone, b.phone], [L.reach, has(L.reaches, f("reach")) ? L.reaches[f("reach")] : ""]].filter(([, value]) => value);
    const passenger = b.other ? [[L.name, f("passenger_name")], [L.phone, f("passenger_phone")]].filter(([, value]) => value) : [];
    const stripe = b.intent ? [{ links: [[MAIL.stripe, `https://dashboard.stripe.com/${b.test ? "test/" : ""}payments/${b.intent}`]] }] : [];
    const blocks = [
      ...notice,
      { h1: fill(MAIL.ownerHeading, { ref: b.ref }) },
      ...(b.email ? [] : [{ p: MAIL.noCustomer }]),
      { h2: MAIL.customer },
      { rows: customer },
      ...(passenger.length ? [{ h2: MAIL.passenger }, { rows: passenger }] : []),
      { h2: MAIL.ownerTrip },
      { rows: trip },
      { h2: MAIL.ownerPayment },
      ...payment(b),
      ...stripe,
      ...(b.email && ahead ? [{ h2: MAIL.ownerNext }, ...told(b)] : []),
    ];
    letters.push({ kind: "owner", to: settings.owners.map((address) => ({ name: "", address })), replyTo: b.email ? { name: b.name, address: b.email } : null, subject, text: textOf(blocks), html: htmlOf(subject, blocks), id: id("owner") });
  }
  return letters;
}

function attemptOf(metadata) {
  try {
    const attempt = JSON.parse(text(metadata.email_attempt) || "null");
    const at = Date.parse(attempt && attempt.at);
    if (!attempt || !Number.isInteger(attempt.n) || attempt.n < 1 || !Number.isFinite(at)) return null;
    return { n: attempt.n, at, sent: Array.isArray(attempt.sent) ? attempt.sent.filter((kind) => KINDS.includes(kind)) : [], failed: attempt.failed === true, tries: Number.isInteger(attempt.tries) && attempt.tries > 0 ? attempt.tries : 0 };
  } catch {
    return null;
  }
}

async function storesOf(session, key, ref) {
  const list = [];
  const intent = intentOf(session);
  if (intent) {
    const result = await retrieveIntent(intent, key, STRIPE_MS);
    if (result.ok && result.body) list.push({ object: "payment_intents", id: intent, metadata: metadataOf(result.body) });
    else if (result.status === 403) console.error("mail-marker", ref, "payment_intents", 403);
    else return { error: result.status };
  }
  list.push({ object: "checkout/sessions", id: session.id, metadata: metadataOf(session) });
  return { list };
}

async function taken(store, n, key) {
  for (let round = 0; ; round++) {
    const result = store.object === "payment_intents" ? await retrieveIntent(store.id, key, STRIPE_MS) : await retrieveSession(store.id, key, STRIPE_MS);
    if (!result.ok || !result.body) return { transient: result.status };
    const metadata = metadataOf(result.body);
    const attempt = attemptOf(metadata);
    if (text(metadata.emailed_at) || (attempt && attempt.n >= n)) return { lost: true };
    if (round) return { refused: 400 };
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }
}

async function claim(store, attempt, key) {
  const value = JSON.stringify(attempt);
  for (let round = 0; ; round++) {
    const result = await updateMetadata(store.object, store.id, { email_attempt: value }, key, `nlr-mail-${store.id}-${attempt.n}`, STRIPE_MS);
    if (result.ok) return metadataOf(result.body).email_attempt === value ? { won: true } : { lost: true };
    const type = result.body && result.body.error && result.body.error.type;
    if (result.status === 409) return { lost: true };
    if (result.status === 400 && type === "idempotency_error") return taken(store, attempt.n, key);
    if ([400, 403, 404].includes(result.status)) return { refused: result.status };
    if (round) return { transient: result.status };
  }
}

async function mark(store, values, key, idempotency, ref) {
  let result;
  for (let round = 0; round < 2; round++) {
    result = await updateMetadata(store.object, store.id, values, key, idempotency, STRIPE_MS);
    if (result.ok) return;
    if (result.status >= 400 && result.status < 500 && result.status !== 409 && result.status !== 429) break;
  }
  console.error("mail-mark", ref, result.status);
}

async function deliver(settings, letters, ref) {
  const mails = letters.map((letter) => ({ from: settings.from.address, to: letter.to.map((box) => box.address), data: buildMessage({ ...letter, from: settings.from }) }));
  const results = await smtpSend(settings, mails, SMTP_MS);
  letters.forEach((letter, i) => {
    if (!results[i].ok) console.error("mail-fail", ref, letter.kind, results[i].stage, results[i].code);
    else if (results[i].rejected) console.error("mail-rcpt", ref, letter.kind, results[i].rejected);
  });
  const sent = letters.filter((letter, i) => results[i].ok).map((letter) => letter.kind);
  if (sent.length) console.log("mail-sent", ref, sent.join(" "));
  return { sent, reached: results.some((result) => !result.ok && DATA_STAGES.includes(result.stage)) };
}

export async function mailBooking(session, key, { unmarked = false } = {}) {
  const ref = refOf(session);
  try {
    if (!session || session.payment_status !== "paid") return "unpaid";
    const data = metadataOf(session);
    if (!ref || !validDate(text(data.date)) || !TIME.test(text(data.time))) return "skip";
    if (text(data.emailed_at)) return "done";
    const settings = mailSettings();
    if (settings.off) {
      console.log("mail-off", ref);
      return "off";
    }
    if (settings.bad) {
      console.error("mail-config", ref);
      return "failed";
    }
    const letters = bookingLetters(session, settings, Date.now());
    if (!letters.length) {
      console.error("mail-none", ref);
      return "off";
    }
    if (!instanceBudget("stripe-mail", RUNS_PER_WINDOW)) {
      console.error("stripe-budget");
      return "failed";
    }
    const found = await storesOf(session, key, ref);
    if (found.error !== undefined) {
      console.error("mail-stripe", ref, found.error);
      return "failed";
    }
    const now = Date.now();
    if (found.list.some((store) => text(store.metadata.emailed_at))) return "done";
    const attempts = found.list.map((store) => attemptOf(store.metadata)).filter(Boolean);
    if (attempts.some((attempt) => !attempt.failed && Math.abs(now - attempt.at) < STALE_MS)) return "busy";
    const sent = [...new Set(attempts.flatMap((attempt) => attempt.sent))];
    const todo = letters.filter((letter) => !sent.includes(letter.kind));
    for (const store of found.list) {
      const previous = attemptOf(store.metadata);
      const n = (previous ? previous.n : 0) + 1;
      const tries = previous ? previous.tries + (previous.failed ? 0 : 1) : 0;
      if (tries >= MAX_TRIES) {
        console.error("mail-gave-up", ref);
        return "gave-up";
      }
      const attempt = { n, at: new Date(now).toISOString(), id: randomBytes(6).toString("hex"), sent, tries };
      const result = await claim(store, attempt, key);
      if (result.lost) return "busy";
      if (result.transient !== undefined) {
        console.error("mail-stripe", ref, result.transient);
        return "failed";
      }
      if (result.refused !== undefined) {
        console.error("mail-marker", ref, store.object, result.refused);
        continue;
      }
      const { sent: done, reached } = await deliver(settings, todo, ref);
      if (done.length === todo.length) {
        await mark(store, { emailed_at: new Date().toISOString(), email_attempt: "" }, key, `nlr-mail-${store.id}-${n}-done`, ref);
        return "sent";
      }
      await mark(store, { email_attempt: JSON.stringify({ ...attempt, sent: [...sent, ...done], failed: true, tries: tries + (reached ? 1 : 0) }) }, key, `nlr-mail-${store.id}-${n}-failed`, ref);
      return "failed";
    }
    if (!unmarked) {
      console.error("mail-unmarked", ref);
      return "unmarked";
    }
    const { sent: done } = await deliver(settings, todo, ref);
    return done.length === todo.length ? "sent" : done.length ? "partial" : "failed";
  } catch {
    console.error("mail-fail", ref, "handler");
    return "failed";
  }
}

function keepAlive(work) {
  try {
    const context = globalThis[REQUEST_CONTEXT] && typeof globalThis[REQUEST_CONTEXT].get === "function" ? globalThis[REQUEST_CONTEXT].get() : null;
    if (context && typeof context.waitUntil === "function") context.waitUntil(work);
  } catch {
    console.error("mail-context");
  }
}

export function mailSoon(promise, ms) {
  const safe = Promise.resolve(promise).catch(() => "failed");
  keepAlive(safe);
  let timer;
  const pause = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, "waiting");
  });
  return Promise.race([safe, pause]).finally(() => clearTimeout(timer));
}
