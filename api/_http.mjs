const SITE_ORIGINS = ["https://www.nycluxride.com", "https://nycluxride.com"];
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;
const WINDOW_MS = 60000;
const MAX_KEYS = 5000;
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const FORMAT = /(?![\u200c\u200d\u202a-\u202e\u2066-\u2069])\p{Cf}/gu;
const clientCalls = new Map();
const instanceCalls = new Map();

export const production = () => process.env.VERCEL_ENV === "production";
export const googleMock = () => process.env.GOOGLE_MOCK === "true" && !production();
export const flightMock = () => process.env.FLIGHT_MOCK === "true" && !production();
export const wantsJson = (request) => (request.headers.get("accept") || "").includes("application/json");

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export function clean(value, max) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(FORMAT, "").replace(UNSAFE, " ").trim()).slice(0, max).join("").trim();
}

export function originAllowed(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null || SITE_ORIGINS.includes(origin)) return true;
  if (production()) return false;
  return origin === new URL(request.url).origin || PREVIEW_ORIGIN.test(origin);
}

export async function readBody(request, limit) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function jsonRequest(request, limit) {
  const fail = (status, code) => ({ response: json(status, { kind: "error", code }) });
  if (!originAllowed(request)) return fail(403, "origin");
  if (Number(request.headers.get("content-length") || 0) > limit) return fail(413, "too-large");
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return fail(415, "type");
  const text = await readBody(request, limit);
  if (text === null) return fail(413, "too-large");
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return { data };
  } catch {}
  return fail(400, "bad");
}

function spend(calls, key, limit) {
  const now = Date.now();
  const recent = (calls.get(key) || []).filter((time) => time > now - WINDOW_MS);
  calls.delete(key);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  calls.set(key, recent);
  if (calls.size > MAX_KEYS) calls.delete(calls.keys().next().value);
  return ok;
}

export function clientKey(request) {
  const ip = (request.headers.get("x-real-ip") || "").trim();
  const v4 = /(\d{1,3}(\.\d{1,3}){3})$/.exec(ip);
  if (v4 || !ip.includes(":")) return v4 ? v4[1] : ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  return `${[...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b].slice(0, 4).map((group) => parseInt(group || "0", 16).toString(16)).join(":")}::/64`;
}

export function clientBudget(request, kind, limit) {
  const ip = clientKey(request);
  if (!ip) return true;
  const ok = spend(clientCalls, `${kind} ${ip}`, limit);
  if (!ok) console.error("client-budget");
  return ok;
}

export function instanceBudget(kind, limit) {
  return spend(instanceCalls, kind, limit);
}
