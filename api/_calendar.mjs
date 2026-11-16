import { instanceBudget } from "./_http.mjs";

const STS = "https://sts.googleapis.com/v1/token";
const IAM = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
const API = "https://www.googleapis.com/calendar/v3/calendars";
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const LIFETIME = "300s";
const CALL_MS = 4000;
const CALLS_PER_WINDOW = 300;
const MAX_TOKEN = 8192;
const CALENDAR_ID = /^[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,200}$/;
const ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const AUDIENCE = /^\/\/iam\.googleapis\.com\/projects\/\d{1,20}\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PERMANENT = [400, 401, 403, 404];

const text = (value) => (typeof value === "string" ? value.trim() : "");
const tokenOk = (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN && !/\s/.test(value);

export function calendarSettings() {
  const calendar = text(process.env.GCAL_CALENDAR_ID);
  const account = text(process.env.GCAL_SERVICE_ACCOUNT);
  const audience = text(process.env.GCAL_WIF_AUDIENCE);
  if (!calendar && !account && !audience) return { off: true };
  if (!CALENDAR_ID.test(calendar) || !ACCOUNT.test(account) || !AUDIENCE.test(audience)) return { bad: true };
  return { calendar, account, audience };
}

export function oidcToken(header) {
  return [text(header), text(process.env.VERCEL_OIDC_TOKEN)].find((token) => token.length <= MAX_TOKEN && JWT.test(token)) || "";
}

async function call(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(CALL_MS) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function accessToken(settings, oidc) {
  const exchanged = await call(STS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: settings.audience,
      scope: CLOUD_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidc,
    }).toString(),
  });
  const federated = exchanged.body && exchanged.body.access_token;
  if (!exchanged.ok || !tokenOk(federated)) return { stage: "sts", status: exchanged.status };
  const issued = await call(`${IAM}/${settings.account}:generateAccessToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${federated}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ scope: [EVENTS_SCOPE], lifetime: LIFETIME }),
  });
  const token = issued.body && issued.body.accessToken;
  if (!issued.ok || !tokenOk(token)) return { stage: "iam", status: issued.status };
  return { token };
}

async function insert(settings, token, event) {
  const result = await call(`${API}/${encodeURIComponent(settings.calendar)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(event),
  });
  return result.ok || result.status === 409 ? "" : String(result.status);
}

export async function addEvents(settings, events, oidc, ref, untrusted = false) {
  try {
    const refused = untrusted ? "rejected" : "permanent";
    const subject = oidcToken(oidc);
    if (!subject) {
      console.error("calendar-token", ref);
      return refused;
    }
    if (!instanceBudget("google-calendar", CALLS_PER_WINDOW)) {
      console.error("calendar-budget", ref);
      return "failed";
    }
    const access = await accessToken(settings, subject);
    if (!access.token) {
      console.error("calendar-fail", ref, access.stage, access.status);
      return PERMANENT.includes(access.status) ? refused : "failed";
    }
    const failed = (await Promise.all(events.map((event) => insert(settings, access.token, event)))).filter(Boolean);
    if (failed.length) {
      console.error("calendar-fail", ref, "events", ...failed);
      return failed.every((status) => PERMANENT.includes(Number(status))) ? "permanent" : "failed";
    }
    console.log("calendar-added", ref, events.length);
    return "done";
  } catch {
    console.error("calendar-fail", ref, "handler");
    return "failed";
  }
}
