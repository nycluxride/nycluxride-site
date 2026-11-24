import { CLASSES, TOLL_CLASS, PA_TOLLS, PA_PEAK, NJTP_TOLLS, TOLL_TABLE_UNTIL } from "./_rates.mjs";

const EARTH_M = 6371000;
const RAD = Math.PI / 180;
const UNITS = /^\d{1,6}$/;
const GAP_M = 50;
const STOP_M = 1000;
const DETOUR = 0.02;
const JOIN_M = 5000;
const AXIS_DEG = 35;
const TABLE_UNTIL = Date.parse(TOLL_TABLE_UNTIL);
const CROSSINGS = [
  { id: "gwb", a: [40.8537, -73.9642], b: [40.85, -73.9446], radius: 200, lead: 500, trail: 300, span: 3000, after: ["18E", "18W"] },
  { id: "goethals", a: [40.6369, -74.2003], b: [40.62875, -74.1841], radius: 150, lead: 300, trail: 300, span: 3000 },
  { id: "bayonne", a: [40.6471, -74.1401], b: [40.6329, -74.1456], radius: 150, lead: 300, trail: 300, span: 3000 },
  { id: "outerbridge", a: [40.5243, -74.2552], b: [40.52545, -74.2338], radius: 150, lead: 300, trail: 300, span: 3000 },
];
const TUNNELS = [
  { id: "holland", a: [40.72799, -74.024], b: [40.72666, -74.016], radius: 100, lead: 1000, trail: 1500, span: 3000 },
  { id: "lincoln", a: [40.7642, -74.0125], b: [40.7617, -74.0065], radius: 120, lead: 800, trail: 800, span: 3000 },
];
const GATES = [
  { id: "13", at: [40.64095, -74.20992], radius: 100, margin: 2000 },
  { id: "13A", at: [40.66891, -74.18406], radius: 100, margin: 2000 },
  { id: "14", at: [40.70858, -74.15627], radius: 100, margin: 2000 },
  { id: "18E", at: [40.8115, -74.0294], radius: 150, margin: 2000, axis: 17 },
  { id: "18W", at: [40.8115, -74.0601], radius: 150, margin: 2000, axis: 53 },
];

export function tollClassOf(map) {
  const found = [...new Set(Object.keys(CLASSES).map((cls) => map[cls]))];
  if (found.length !== 1 || !Object.prototype.hasOwnProperty.call(PA_TOLLS, found[0]) || !Object.prototype.hasOwnProperty.call(NJTP_TOLLS, found[0])) throw new Error("toll-config");
  return found[0];
}
export const TOLL_GROUP = tollClassOf(TOLL_CLASS);

export function tollCents(route) {
  const info = route && route.travelAdvisory && route.travelAdvisory.tollInfo;
  if (!info) return 0;
  const prices = Array.isArray(info.estimatedPrice) ? info.estimatedPrice : [];
  if (!prices.length) return null;
  let nanos = 0;
  for (const price of prices) {
    if (!price || typeof price !== "object" || price.currencyCode !== "USD") return null;
    const units = price.units === undefined ? "0" : String(price.units);
    const part = price.nanos === undefined ? 0 : price.nanos;
    if (!UNITS.test(units) || !Number.isInteger(part) || part < 0 || part > 999999999) return null;
    nanos += Number(units) * 1e9 + part;
  }
  return Math.round(nanos / 1e7);
}

export function decodePath(text) {
  const path = [];
  if (typeof text !== "string") return path;
  let at = 0;
  const value = [0, 0];
  while (at < text.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0;
      let result = 0;
      let byte;
      do {
        if (at >= text.length) return [];
        byte = text.charCodeAt(at++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      value[k] += result & 1 ? ~(result >> 1) : result >> 1;
    }
    path.push([value[0] / 1e5, value[1] / 1e5]);
  }
  return path;
}

const local = (p, o) => [(p[1] - o[1]) * RAD * Math.cos(o[0] * RAD) * EARTH_M, (p[0] - o[0]) * RAD * EARTH_M];
const span = (a, b) => Math.hypot(...local(b, a));
const bearing = (a, b) => {
  const [x, y] = local(b, a);
  return (Math.round(Math.atan2(x, y) / RAD) + 360) % 360;
};

export function arcsOf(path) {
  const arcs = [0];
  for (let i = 1; i < path.length; i++) arcs.push(arcs[i - 1] + span(path[i - 1], path[i]));
  return arcs;
}

export function project(path, arcs, point, i) {
  const a = local(path[i - 1], point);
  const b = local(path[i], point);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length)) : 0;
  return { gap: Math.hypot(a[0] + t * dx, a[1] + t * dy), at: arcs[i - 1] + t * (arcs[i] - arcs[i - 1]), heading: bearing(path[i - 1], path[i]) };
}

function visits(path, arcs, point, radius, axis) {
  const found = [];
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const hit = project(path, arcs, point, i);
    const turn = axis === undefined ? 0 : Math.abs(((hit.heading - axis + 540) % 360) - 180);
    const aligned = axis === undefined || Math.min(turn, 180 - turn) <= AXIS_DEG;
    if (hit.gap <= radius && aligned) {
      if (!best || hit.gap < best.gap) best = hit;
    } else if (best) {
      found.push(best.at);
      best = null;
    }
  }
  if (best) found.push(best.at);
  return found;
}

function pointAt(path, arcs, at) {
  let i = 1;
  while (i < path.length - 1 && arcs[i] < at) i++;
  const [a, b] = [path[i - 1], path[i]];
  const t = arcs[i] > arcs[i - 1] ? Math.max(0, Math.min(1, (at - arcs[i - 1]) / (arcs[i] - arcs[i - 1]))) : 0;
  const round = (n) => Math.round(n * 1e6) / 1e6;
  return { latitude: round(a[0] + (b[0] - a[0]) * t), longitude: round(a[1] + (b[1] - a[1]) * t), heading: bearing(a, b) };
}

function stopArcs(path, arcs, stops) {
  const found = [];
  let from = 1;
  for (const stop of stops) {
    let best = null;
    for (let i = from; i < path.length; i++) {
      const hit = project(path, arcs, stop, i);
      if (!best || hit.gap < best.gap) best = { ...hit, i };
    }
    if (!best || best.gap > STOP_M) return null;
    found.push(best.at);
    from = best.i;
  }
  return found;
}

function crossingsOn(path, arcs) {
  const hits = [];
  for (const [kind, item] of [...CROSSINGS.map((item) => ["pa", item]), ...TUNNELS.map((item) => ["free", item])]) {
    const [from, to] = kind === "pa" ? [item.a, item.b] : [item.b, item.a];
    const ends = visits(path, arcs, to, item.radius);
    for (const start of visits(path, arcs, from, item.radius)) {
      const end = ends.find((at) => at > start && at - start <= item.span);
      if (end !== undefined) hits.push({ kind, id: item.id, after: item.after || [], from: start, to: end, start: start - item.lead, end: end + item.trail });
    }
  }
  return hits;
}

function turnpikeOn(path, arcs, bounds) {
  const events = GATES.flatMap((gate) => visits(path, arcs, gate.at, gate.radius, gate.axis).map((at) => ({ gate, at }))).sort((a, b) => a.at - b.at);
  const hits = [];
  for (let n = 1; n < bounds.length; n++) {
    const group = events.filter(({ at }) => at > bounds[n - 1] && at < bounds[n]);
    if (group.length % 2) return null;
    for (let i = 0; i < group.length; i += 2) {
      const [entry, exit] = [group[i].gate, group[i + 1].gate];
      const table = NJTP_TOLLS[TOLL_GROUP][entry.id] || {};
      if (!Number.isInteger(table[exit.id])) return null;
      hits.push({ kind: "njtp", id: `${entry.id}-${exit.id}`, exit: exit.id, cents: table[exit.id], from: group[i].at, to: group[i + 1].at, start: group[i].at - entry.margin, end: group[i + 1].at + exit.margin });
    }
  }
  return hits;
}

export function tollPlan(path, stops = []) {
  if (!Array.isArray(path) || path.length < 2) return { reason: "none" };
  const arcs = arcsOf(path);
  const total = arcs[arcs.length - 1];
  const middle = stopArcs(path, arcs, stops);
  if (!middle) return { reason: "stop" };
  const bounds = [0, ...middle, total];
  const turnpike = turnpikeOn(path, arcs, bounds);
  if (!turnpike) return { reason: "turnpike" };
  const hits = [...crossingsOn(path, arcs), ...turnpike].sort((a, b) => a.from - b.from);
  if (!hits.length) return { reason: "none" };
  const blocks = [];
  for (const hit of hits) {
    const leg = bounds.findIndex((at, n) => n > 0 && hit.from < at);
    if (leg < 1 || hit.to > bounds[leg]) return { reason: "stop" };
    const prior = blocks[blocks.length - 1];
    if (prior && prior.leg === leg && hit.from < prior.to + GAP_M) return { reason: "overlap" };
    const last = prior && prior.hits[prior.hits.length - 1];
    if (prior && prior.leg === leg && (hit.start - prior.end < JOIN_M || (hit.kind === "pa" && last.kind === "njtp" && hit.after.includes(last.exit)))) Object.assign(prior, { to: hit.to, end: Math.max(prior.end, hit.end), hits: [...prior.hits, hit] });
    else blocks.push({ leg, to: hit.to, start: hit.start, end: hit.end, hits: [hit] });
  }
  const marks = middle.map((at, i) => ({ at, stop: i }));
  const reach = (hit) => (hit.kind === "njtp" ? JOIN_M : GAP_M);
  for (const block of blocks) {
    const [low, high] = [bounds[block.leg - 1], bounds[block.leg]];
    if (block.start - low < reach(block.hits[0])) block.start = low;
    if (high - block.end < reach(block.hits[block.hits.length - 1])) block.end = high;
    if (block.start > low) marks.push({ at: block.start, cut: pointAt(path, arcs, block.start) });
    if (block.end < high) marks.push({ at: block.end, cut: pointAt(path, arcs, block.end) });
  }
  marks.sort((a, b) => a.at - b.at);
  const edges = [0, ...marks.map((mark) => mark.at), total];
  const legs = edges.slice(1).map((end, n) => {
    const block = blocks.find((item) => item.start <= edges[n] + 1 && item.end >= end - 1);
    const share = (at) => Math.round(((at - edges[n]) / (end - edges[n])) * 1000) / 1000;
    return block ? { tolls: block.hits.map((hit) => ({ kind: hit.kind, id: hit.id, share: share(hit.from), ...(hit.kind === "njtp" && { cents: hit.cents }) })) } : null;
  });
  return { marks: marks.map(({ stop, cut }) => (cut ? { cut } : { stop })), legs };
}

function passes(path, arcs, from, to, item) {
  const ends = visits(path, arcs, to, item.radius);
  return visits(path, arcs, from, item.radius).map((start) => ends.find((at) => at > start && at - start <= item.span)).filter((end) => end !== undefined);
}

export function intoJersey(path) {
  if (!Array.isArray(path) || path.length < 2) return false;
  const arcs = arcsOf(path);
  const crossed = [...CROSSINGS, ...TUNNELS].flatMap((item) => [...passes(path, arcs, item.b, item.a, item).map((at) => ({ at, west: true })), ...passes(path, arcs, item.a, item.b, item).map((at) => ({ at, west: false }))]);
  crossed.sort((x, y) => x.at - y.at);
  return crossed.length > 0 && crossed[crossed.length - 1].west;
}

const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });

export function crossingCents(when, group = TOLL_GROUP) {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(when).map(({ type, value }) => [type, value]));
  const minute = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const windows = ["Sat", "Sun"].includes(parts.weekday) ? PA_PEAK.weekend : PA_PEAK.weekday;
  const rate = PA_TOLLS[group];
  return windows.some(([from, to]) => minute >= from && minute < to) ? rate.peak : rate.offPeak;
}

const planText = (plan) => plan.legs.map((mark) => (mark ? mark.tolls.map((item) => item.kind).join("+") : "g")).join(",");

export function priceSplit(plan, route, departure, meters) {
  const legs = route && Array.isArray(route.legs) ? route.legs : [];
  if (legs.length !== plan.legs.length) return { reason: "legs" };
  const total = Number(route.distanceMeters);
  if (!Number.isFinite(total) || !(meters > 0) || Math.abs(total - meters) > meters * DETOUR) return { reason: "detour" };
  let at = departure.getTime();
  let cents = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] || {};
    const mark = plan.legs[i];
    const seconds = parseFloat(String(leg.duration || ""));
    if (!Number.isFinite(seconds) || seconds < 0) return { reason: "legs" };
    if (mark) {
      const free = mark.tolls.every((item) => item.kind === "free");
      if (!free && !(leg.travelAdvisory && leg.travelAdvisory.tollInfo)) return { reason: "facility" };
      for (const item of mark.tolls) {
        const reach = at + seconds * 1000 * item.share;
        if (!(reach < TABLE_UNTIL)) return { reason: "stale" };
        cents += item.kind === "pa" ? crossingCents(new Date(reach)) : item.kind === "free" ? 0 : item.cents;
      }
      if (free) cents += tollCents(leg) || 0;
    } else {
      const part = tollCents(leg);
      if (part === null) return { reason: "unpriced", detail: `leg ${i + 1}/${legs.length} ${Math.round(Number(leg.distanceMeters) || 0)}m plan ${planText(plan)}` };
      cents += part;
    }
    at += seconds * 1000;
  }
  return { cents };
}

export function returnCents(path, arrival) {
  if (!intoJersey(path)) return 0;
  return arrival.getTime() < TABLE_UNTIL ? crossingCents(arrival) : null;
}
