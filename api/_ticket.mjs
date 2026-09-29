import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { norm, ZONES } from "./_places.mjs";
import { googleMock } from "./_http.mjs";

export const TICKET = /^v1\.[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/;
export const TICKET_TTL = 21600;
const INFO = "nlr place ticket v1";
const SKEW_S = 300;

export function ticketKey() {
  const secret = String(process.env.PLACE_TICKET_SECRET || "").trim();
  if (secret.length >= 32) return Buffer.from(secret, "utf8");
  const server = String(process.env.GOOGLE_MAPS_SERVER_KEY || "").trim();
  if (server) return createHmac("sha256", server).update(INFO).digest();
  if (googleMock()) return createHmac("sha256", "nlr-mock-ticket").update(INFO).digest();
  return null;
}

export function labelHash(label) {
  return createHash("sha256").update(norm(label)).digest("base64url").slice(0, 16);
}

const mac = (key, payload) => createHmac("sha256", key).update(`v1.${payload}`).digest("base64url");
const proofMac = (key, id, label) => createHmac("sha256", key).update(`p1.${id}.${labelHash(label)}`).digest("base64url");
const PROOF = /^[A-Za-z0-9_-]{43}$/;

export function placeProof(id, label) {
  const key = ticketKey();
  return key ? proofMac(key, id, label) : "";
}

export function proofOk(id, label, proof) {
  const key = ticketKey();
  if (!key || typeof proof !== "string" || !PROOF.test(proof)) return false;
  return timingSafeEqual(Buffer.from(proof), Buffer.from(proofMac(key, id, label)));
}

export function signTicket(id, zone, label, now) {
  const key = ticketKey();
  if (!key) return "";
  const payload = Buffer.from(JSON.stringify({ v: 1, id, z: zone, h: labelHash(label), t: Math.floor(Number(now) / 1000) })).toString("base64url");
  const ticket = `v1.${payload}.${mac(key, payload)}`;
  return TICKET.test(ticket) ? ticket : "";
}

export function verifyTicket(ticket, label, now) {
  const key = ticketKey();
  if (!key || typeof ticket !== "string" || !TICKET.test(ticket)) return null;
  const [, payload, given] = ticket.split(".");
  const expected = Buffer.from(mac(key, payload));
  if (!timingSafeEqual(Buffer.from(given), expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || typeof data.id !== "string" || !data.id || typeof data.h !== "string" || !Number.isInteger(data.t)) return null;
  if (!ZONES.includes(data.z) || data.z === "unknown") return null;
  if (label !== null && data.h !== labelHash(label)) return null;
  const age = Math.floor(Number(now) / 1000) - data.t;
  return { id: data.id, zone: data.z, expired: age > TICKET_TTL || age < -SKEW_S };
}
