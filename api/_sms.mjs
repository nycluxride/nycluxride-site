import { CONTACT } from "./_rates.mjs";

const API = "https://api.twilio.com/2010-04-01/Accounts";
const ACCOUNT = /^AC[0-9a-fA-F]{32}$/;
const API_KEY = /^SK[0-9a-fA-F]{32}$/;
const SERVICE = /^MG[0-9a-fA-F]{32}$/;
const PHONE = /^\+[1-9]\d{6,14}$/;
const SECRET = /^[\x21-\x7e]{16,128}$/;
const REQUEST_ID = /^RQ[0-9a-fA-F]{32}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,40}$/;
const SEPARATORS = /[\s().-]/g;
const OWNER = CONTACT.tel.replace(/^tel:/, "");
const SEND_MS = 8000;
const RETRY_MS = 500;
const MAX_CHARS = 320;
const PLACE_CHARS = 60;
const NAME_CHARS = 80;
const MIN_CHARS = 10;
const UNREACHED = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"];
const LETTERS = { ß: "ss", æ: "ae", Æ: "AE", ø: "o", Ø: "O", œ: "oe", Œ: "OE", ł: "l", Ł: "L", đ: "d", Đ: "D", ð: "d", Ð: "D", þ: "th", Þ: "Th", ı: "i" };
const FOLD = new RegExp(`[${Object.keys(LETTERS).join("")}]`, "g");

const text = (value) => (typeof value === "string" ? value.trim() : "");
const number = (value) => text(value).replace(SEPARATORS, "");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const detail = ({ status, code, requestId }) => [status, code, requestId].filter((part) => part !== "");

export function smsSettings() {
  const account = text(process.env.TWILIO_ACCOUNT_SID);
  const key = text(process.env.TWILIO_API_KEY);
  const secret = text(process.env.TWILIO_API_SECRET);
  const from = number(process.env.TWILIO_FROM);
  const to = number(process.env.OWNER_SMS) || OWNER;
  if (!account && !key && !secret && !from) return { off: true };
  if (!ACCOUNT.test(account) || !API_KEY.test(key) || !SECRET.test(secret) || !(PHONE.test(from) || SERVICE.test(from)) || !PHONE.test(to)) return { bad: true };
  return { account, key, secret, from, to };
}

export function gsmText(value) {
  return String(value ?? "")
    .replace(/[\u2018-\u201b\u2032\u00b4`]/g, "'")
    .replace(/[\u201c-\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212\u2022\u00b7]/g, "-")
    .replace(FOLD, (ch) => LETTERS[ch])
    .normalize("NFKD")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x5f\x61-\x7e]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

function clip(value, max) {
  const plain = gsmText(value);
  return plain.length > max ? `${plain.slice(0, max - 3).trimEnd()}...` : plain;
}

export function fitText(build) {
  const render = (places, names) => build((value) => clip(value, places), (value) => clip(value, names)).map(gsmText).filter(Boolean).join("\n");
  let body = render(PLACE_CHARS, NAME_CHARS);
  for (let cut = PLACE_CHARS - 1; body.length > MAX_CHARS && cut >= MIN_CHARS; cut--) body = render(cut, NAME_CHARS);
  for (let cut = NAME_CHARS - 1; body.length > MAX_CHARS && cut >= MIN_CHARS; cut--) body = render(MIN_CHARS, cut);
  if (body.length <= MAX_CHARS) return body;
  const last = body.slice(body.lastIndexOf("\n"));
  return `${body.slice(0, MAX_CHARS - last.length).trimEnd()}${last}`;
}

function causeOf(error) {
  const code = error && error.cause && error.cause.code;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "network";
}

async function post({ account, key, secret, from, to }, body, signal) {
  let res;
  try {
    res = await fetch(`${API}/${account}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ To: to, [SERVICE.test(from) ? "MessagingServiceSid" : "From"]: from, Body: body }).toString(),
      signal,
    });
  } catch (error) {
    const status = signal.aborted ? "timeout" : causeOf(error);
    return { state: UNREACHED.includes(status) ? "retry" : "unknown", status, code: "", requestId: "" };
  }
  const data = await res.json().catch(() => null);
  const id = res.headers.get("twilio-request-id") || "";
  const reply = { status: res.status, code: data && Number.isInteger(data.code) ? data.code : "", requestId: REQUEST_ID.test(id) ? id : "" };
  return { ...reply, state: res.ok ? "sent" : res.status === 429 || res.status >= 500 ? "retry" : "unsent" };
}

export async function sendText(settings, body, ref, timeout = SEND_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let result = await post(settings, body, controller.signal);
    if (result.state === "retry") {
      console.error("sms-retry", ref, ...detail(result));
      await pause(RETRY_MS);
      if (!controller.signal.aborted) result = await post(settings, body, controller.signal);
    }
    if (result.state === "sent") console.log("sms-sent", ref, ...detail(result));
    else console.error("sms-fail", ref, ...detail(result));
    return result.state === "retry" ? "unsent" : result.state;
  } finally {
    clearTimeout(timer);
  }
}
