import { randomBytes } from "node:crypto";
import { MAIL, CALENDAR } from "./_copy.mjs";
import { bookingData, nycToUtc } from "./_trip.mjs";
import { listSessions, retrieveSession, updateMetadata } from "./_stripe.mjs";
import { reminderLetter, bookingEvents } from "./_mail.mjs";
import { buildMessage, smtpSend } from "./_smtp.mjs";
import { readToken, readEvent } from "./_calendar.mjs";

export const SEND_HOURS = [16, 17];
export const MARK = "reminded";
const ZONE = "America/New_York";
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECENT_S = 43200;
const LOOKBACK_S = 366 * 86400;
const PAGE = 100;
const MAX_PAGES = 100;
const MAX_TRIES = 3;
const STRIPE_MS = 5000;
const SMTP_MS = 8000;
const SETTLE_MS = 2000;
const CONFLICT_MS = 3 * STRIPE_MS + SETTLE_MS + 3000;
const RUN_MS = 200000;
const DATA_STAGES = ["data", "message"];
const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
const literal = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CANCELLED = new RegExp(`^(?:${literal(MAIL.test)})?${literal(CALENDAR.cancelled)}`);

const text = (value) => (typeof value === "string" ? value.trim() : "");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tries = (mark) => (mark && Number.isInteger(mark.n) && mark.n > 0 ? mark.n : 0);
const markOf = (session) => (session && session.metadata ? session.metadata[MARK] : undefined);

export function newYork(now) {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(now).map(({ type, value }) => [type, value]));
  const next = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  return { hour: Number(parts.hour), today: `${parts.year}-${parts.month}-${parts.day}`, tomorrow: next.toISOString().slice(0, 10) };
}

export function dueLegs(session, tomorrow) {
  const data = bookingData(session && session.metadata);
  if (!text(data.ref) && !text(session && session.client_reference_id)) return [];
  const legs = [];
  if (text(data.date) === tomorrow && TIME.test(text(data.time))) legs.push("a");
  if (text(data.service) !== "hourly" && text(data.return_date) === tomorrow && TIME.test(text(data.return_time))) legs.push("b");
  return legs;
}

function marksOf(session) {
  const raw = text(markOf(session));
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function legState(mark) {
  if (!mark) return "open";
  if (typeof mark !== "object" || mark.sent || mark.reached) return "done";
  if (mark.failed === 1) return tries(mark) >= MAX_TRIES ? "done" : "open";
  return "claimed";
}

async function landed(id, value, key) {
  await pause(SETTLE_MS);
  const fresh = await retrieveSession(id, key, STRIPE_MS);
  return fresh.ok && markOf(fresh.body) === value ? "won" : "transient";
}

async function claim(id, values, key, idempotency) {
  let unanswered = false;
  for (let round = 0; round < 2; round++) {
    const result = await updateMetadata("checkout/sessions", id, values, key, idempotency, STRIPE_MS);
    if (result.ok) return markOf(result.body) === values[MARK] ? "won" : "lost";
    const type = result.body && result.body.error && result.body.error.type;
    if (result.status === 409) return unanswered ? landed(id, values[MARK], key) : "lost";
    if (result.status === 400 && type === "idempotency_error") return "conflict";
    if (result.status >= 400 && result.status < 500 && result.status !== 429) return "refused";
    unanswered = unanswered || !result.status;
  }
  return unanswered ? landed(id, values[MARK], key) : "transient";
}

async function mark(id, values, key, idempotency) {
  for (let round = 0; round < 2; round++) {
    const result = await updateMetadata("checkout/sessions", id, values, key, round ? idempotency.replace(/-(\w+)$/, "-2-$1") : idempotency, STRIPE_MS);
    if (result.ok) return true;
    if (result.status >= 400 && result.status < 500 && result.status !== 409 && result.status !== 429) break;
  }
  return false;
}

async function cancelledLegs(session, legs, ctx) {
  if (ctx.calendar.off) return [];
  if (ctx.calendar.bad) return null;
  const token = await ctx.token();
  if (!token) return null;
  const events = bookingEvents(session);
  const total = Number.isInteger(session.amount_total) ? session.amount_total : 0;
  const cancelled = [];
  for (const leg of legs) {
    const event = events[leg === "b" ? 1 : 0];
    if (!event) continue;
    const found = await readEvent(ctx.calendar, token, event.id);
    if (found.state === "unknown") return null;
    if (found.state === "deleted" || (found.state === "found" && (CANCELLED.test(found.summary) || (total > 0 && found.refunded >= total)))) cancelled.push(leg);
  }
  return cancelled;
}

async function remind(listed, legs, ctx) {
  const read = await retrieveSession(listed.id, ctx.key, STRIPE_MS);
  const session = read.ok && read.body && read.body.id === listed.id ? read.body : null;
  if (!session) return "failed";
  if (session.payment_status !== "paid") return "skipped";
  const marks = marksOf(session);
  if (!marks) return "done";
  const open = legs.filter((leg) => legState(marks[leg]) === "open");
  if (!open.length) return legs.some((leg) => legState(marks[leg]) === "claimed") ? "claimed" : "done";
  const cancelled = await cancelledLegs(session, open, ctx);
  if (!cancelled) return "unchecked";
  const due = open.filter((leg) => !cancelled.includes(leg));
  if (!due.length) return "cancelled";
  const letter = reminderLetter(session, due);
  if (!letter.to[0].address) return "skipped";
  const at = new Date().toISOString();
  const nonce = randomBytes(6).toString("hex");
  const data = session.metadata;
  const extra = text(data.emailed_at) && text(data.email_attempt) ? { email_attempt: "" } : {};
  const first = Math.max(...due.map((leg) => tries(marks[leg]))) + 1;
  let n, claimed, tag, won;
  for (n = first; n < first + MAX_TRIES; n++) {
    claimed = { ...marks, ...Object.fromEntries(due.map((leg) => [leg, { n, at, id: nonce }])) };
    tag = `nlr-remind-${session.id}-${due.join("")}-${n}`;
    won = await claim(session.id, { [MARK]: JSON.stringify(claimed), ...extra }, ctx.key, tag);
    if (won !== "conflict") break;
    await pause(CONFLICT_MS);
    const fresh = await retrieveSession(session.id, ctx.key, STRIPE_MS);
    if (!fresh.ok || !fresh.body) return "failed";
    if (markOf(fresh.body) !== markOf(session)) return "claimed";
  }
  if (won !== "won") return won === "lost" || won === "conflict" ? "claimed" : won === "refused" ? "unmarked" : "failed";
  const [result] = await smtpSend(ctx.mail, [{ from: ctx.mail.from.address, to: letter.to.map((box) => box.address), data: buildMessage({ ...letter, from: ctx.mail.from }) }], SMTP_MS);
  const outcome = result.ok ? "sent" : DATA_STAGES.includes(result.stage) ? "reached" : "failed";
  const final = result.ok ? { sent: new Date().toISOString() } : outcome === "reached" ? { reached: 1 } : { failed: 1 };
  await mark(session.id, { [MARK]: JSON.stringify({ ...claimed, ...Object.fromEntries(due.map((leg) => [leg, { n, at, ...final }])) }) }, ctx.key, `${tag}-${outcome}`);
  return outcome;
}

export async function sendReminders({ now, key, mail, calendar, oidc }) {
  const started = Date.now();
  const { today, tomorrow } = newYork(now);
  const seconds = Math.floor(now.getTime() / 1000);
  const recent = Math.floor(nycToUtc(today, `${SEND_HOURS[0]}:00`).getTime() / 1000) - RECENT_S;
  const counts = {};
  const count = (name) => (counts[name] = (counts[name] || 0) + 1);
  const query = { status: "complete", "created[gte]": String(seconds - LOOKBACK_S), "created[lte]": String(seconds), limit: String(PAGE) };
  const due = [];
  let after = "";
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) {
      count("capped");
      break;
    }
    const result = await listSessions(after ? { ...query, starting_after: after } : query, key, STRIPE_MS);
    const list = result.ok && result.body && Array.isArray(result.body.data) ? result.body.data : null;
    if (!list) return { failed: result.status, counts };
    for (const session of list) {
      const legs = session && SESSION_ID.test(text(session.id)) && session.payment_status === "paid" ? dueLegs(session, tomorrow) : [];
      if (!legs.length) continue;
      if (/^cs_test_/.test(session.id) || session.livemode === false) count("test");
      else if (!Number.isInteger(session.created) || session.created > recent) count("recent");
      else due.push([session, legs]);
    }
    after = list.length ? text(list.at(-1) && list.at(-1).id) : "";
    if (result.body.has_more !== true || !after) break;
  }
  let token = null;
  const ctx = { key, mail, calendar, token: () => (token = token || readToken(calendar, oidc).catch(() => "")) };
  for (const [session, legs] of due) {
    if (Date.now() - started > RUN_MS) count("deferred");
    else count(await remind(session, legs, ctx).catch(() => "failed"));
  }
  return { counts };
}
