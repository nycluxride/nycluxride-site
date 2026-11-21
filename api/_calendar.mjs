import { instanceBudget } from "./_http.mjs";
import { ACCOUNT, AUDIENCE, oidcToken, call as googleCall, accessToken as googleToken } from "./_gtoken.mjs";

export { oidcToken };

const API = "https://www.googleapis.com/calendar/v3/calendars";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALL_MS = 4000;
const CALLS_PER_WINDOW = 300;
const CALENDAR_ID = /^[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,200}$/;
const PERMANENT = [400, 401, 403, 404];
const GONE = [404, 410];
const REFUNDED = "nlrRefundedCents";

const text = (value) => (typeof value === "string" ? value.trim() : "");
const call = (url, init) => googleCall(url, init, CALL_MS);

export function calendarSettings() {
  const calendar = text(process.env.GCAL_CALENDAR_ID);
  const account = text(process.env.GCAL_SERVICE_ACCOUNT);
  const audience = text(process.env.GCAL_WIF_AUDIENCE);
  if (!calendar && !account && !audience) return { off: true };
  if (!CALENDAR_ID.test(calendar) || !ACCOUNT.test(account) || !AUDIENCE.test(audience)) return { bad: true };
  return { calendar, account, audience };
}

async function insert(settings, token, event) {
  const result = await call(`${API}/${encodeURIComponent(settings.calendar)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(event),
  });
  return result.ok || result.status === 409 ? "" : String(result.status);
}

async function authorized(settings, oidc, ref, refused) {
  const subject = oidcToken(oidc);
  if (!subject) {
    console.error("calendar-token", ref);
    return { state: refused };
  }
  if (!instanceBudget("google-calendar", CALLS_PER_WINDOW)) {
    console.error("calendar-budget", ref);
    return { state: "failed" };
  }
  const access = await googleToken(settings, subject, EVENTS_SCOPE, CALL_MS);
  if (!access.token) {
    console.error("calendar-fail", ref, access.stage, access.status);
    return { state: PERMANENT.includes(access.status) ? refused : "failed" };
  }
  return { token: access.token };
}

const outcome = (failed) => (failed.every((status) => PERMANENT.includes(Number(status))) ? "permanent" : "failed");

export async function addEvents(settings, events, oidc, ref, untrusted = false) {
  try {
    const access = await authorized(settings, oidc, ref, untrusted ? "rejected" : "permanent");
    if (!access.token) return access.state;
    const failed = (await Promise.all(events.map((event) => insert(settings, access.token, event)))).filter(Boolean);
    if (failed.length) {
      console.error("calendar-fail", ref, "events", ...failed);
      return outcome(failed);
    }
    console.log("calendar-added", ref, events.length);
    return "done";
  } catch {
    console.error("calendar-fail", ref, "handler");
    return "failed";
  }
}

async function patch(settings, token, change, missing = true) {
  const events = `${API}/${encodeURIComponent(settings.calendar)}/events`;
  const url = `${events}/${encodeURIComponent(change.id)}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const marked = { extendedProperties: { private: { [REFUNDED]: String(change.refunded) } } };
  const current = await call(url, { method: "GET", headers });
  if (current.status === 404 && missing) {
    const added = await call(events, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ...change.event, ...change.edit(change.event), ...marked }),
    });
    if (added.status === 409) return patch(settings, token, change, false);
    return added.ok ? {} : { failed: String(added.status) };
  }
  if (GONE.includes(current.status) || (current.ok && current.body && current.body.status === "cancelled")) return { skipped: true };
  if (!current.ok || !current.body) return { failed: String(current.status) };
  const stored = current.body.extendedProperties && current.body.extendedProperties.private && current.body.extendedProperties.private[REFUNDED];
  if (/^\d{1,12}$/.test(stored || "") && Number(stored) >= change.refunded) return { skipped: true };
  const etag = typeof current.body.etag === "string" && current.body.etag.length <= 200 ? { "If-Match": current.body.etag } : {};
  const result = await call(url, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", ...etag },
    body: JSON.stringify({ ...change.edit(current.body), ...marked }),
  });
  if (GONE.includes(result.status)) return { skipped: true };
  return result.ok || result.status === 409 ? {} : { failed: String(result.status) };
}

export async function updateEvents(settings, changes, oidc, ref) {
  try {
    const access = await authorized(settings, oidc, ref, "permanent");
    if (!access.token) return access.state;
    const results = await Promise.all(changes.map((change) => patch(settings, access.token, change)));
    const failed = results.map((result) => result.failed).filter(Boolean);
    if (failed.length) {
      console.error("calendar-fail", ref, "refund", ...failed);
      return outcome(failed);
    }
    console.log("calendar-refunded", ref, results.filter((result) => !result.skipped).length, results.filter((result) => result.skipped).length);
    return "done";
  } catch {
    console.error("calendar-fail", ref, "handler");
    return "failed";
  }
}

export async function readToken(settings, oidc) {
  const subject = oidcToken(oidc);
  if (!subject || !instanceBudget("google-calendar", CALLS_PER_WINDOW)) return "";
  const access = await googleToken(settings, subject, EVENTS_SCOPE, CALL_MS);
  return access.token || "";
}

export async function readEvent(settings, token, id) {
  if (!instanceBudget("google-calendar", CALLS_PER_WINDOW)) return { state: "unknown" };
  const result = await call(`${API}/${encodeURIComponent(settings.calendar)}/events/${encodeURIComponent(id)}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (result.status === 404) return { state: "missing" };
  if (result.status === 410 || (result.ok && result.body && result.body.status === "cancelled")) return { state: "deleted" };
  if (!result.ok || !result.body) return { state: "unknown" };
  const stored = result.body.extendedProperties && result.body.extendedProperties.private && result.body.extendedProperties.private[REFUNDED];
  return { state: "found", summary: typeof result.body.summary === "string" ? result.body.summary : "", refunded: /^\d{1,12}$/.test(stored || "") ? Number(stored) : 0 };
}
