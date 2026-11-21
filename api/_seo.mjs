import { createHash, timingSafeEqual } from "node:crypto";
import { SEO } from "./_copy.mjs";
import { fill } from "./_trip.mjs";
import { textOf, htmlOf } from "./_mail.mjs";
import { ACCOUNT, AUDIENCE, call, accessToken } from "./_gtoken.mjs";

const API = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const CONSOLE = "https://search.google.com/search-console/performance/search-analytics";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SITE = /^(?:https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/|sc-domain:[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;
const BRAND = "lux ?ride";
const BRAND_TEST = new RegExp(BRAND, "i");
const MIN_SECRET = 16;
const CALL_MS = 8000;
const DAY_MS = 86400000;
const DELAY_DAYS = 3;
const LOOKBACK_DAYS = 480;
const TOP = 10;
const ROWS = 1000;
const ALL_ROWS = 25000;
const CLOSE = [4, 20];
const MIN_SHOWN = 10;
const GOOGLE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const SHORT_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const COUNT = new Intl.NumberFormat("en-US");
const SPELLING = { nyc: "NYC", jfk: "JFK", lga: "LGA", ewr: "EWR", teb: "TEB", suv: "SUV", faq: "FAQ", laguardia: "LaGuardia", soho: "SoHo" };

const text = (value) => (typeof value === "string" ? value.trim() : "");
const digest = (value) => createHash("sha256").update(value).digest();
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const number = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
const one = (value) => (Math.round(value * 10) / 10).toFixed(1);
const brand = (query) => BRAND_TEST.test(query);
const byClicks = (a, b) => b.clicks - a.clicks || b.impressions - a.impressions;

export function cronAllowed(request, least = MIN_SECRET) {
  const secret = String(process.env.CRON_SECRET || "");
  if (secret.length < Math.max(least, MIN_SECRET) || /\s/.test(secret)) return false;
  return timingSafeEqual(digest(request.headers.get("authorization") || ""), digest(`Bearer ${secret}`));
}

export function seoSettings() {
  const account = text(process.env.SEO_GSC_SERVICE_ACCOUNT);
  const site = text(process.env.SEO_GSC_SITE);
  const audience = text(process.env.GCAL_WIF_AUDIENCE);
  if (!account || !site || !audience) return { off: true };
  if (!ACCOUNT.test(account) || !SITE.test(site) || !AUDIENCE.test(audience)) return { bad: true };
  return { account, site, audience };
}

export function windows(now) {
  const end = shift(GOOGLE_DAY.format(now), -DELAY_DAYS);
  const start = shift(end, -6);
  const before = shift(start, -1);
  const recent = shift(end, -27);
  const older = shift(recent, -1);
  return { week: [start, end], prior: [shift(before, -6), before], recent: [recent, end], older: [shift(older, -LOOKBACK_DAYS), older] };
}

function rowsOf(result) {
  const rows = result.body && Array.isArray(result.body.rows) ? result.body.rows : [];
  return rows.map((row) => ({
    key: Array.isArray(row.keys) && typeof row.keys[0] === "string" ? row.keys[0] : "",
    clicks: number(row.clicks),
    impressions: number(row.impressions),
    position: number(row.position),
  }));
}

const totalOf = (rows) => rows[0] || { clicks: 0, impressions: 0, position: 0 };

function withoutBrand(all, named) {
  const impressions = Math.max(0, all.impressions - named.impressions);
  const weighted = all.position * all.impressions - named.position * named.impressions;
  return { clicks: Math.max(0, all.clicks - named.clicks), impressions, position: impressions && weighted > 0 ? weighted / impressions : 0 };
}

export async function searchData(settings, oidc, now) {
  const access = await accessToken(settings, oidc, SCOPE, CALL_MS);
  if (!access.token) return { stage: access.stage, status: access.status };
  const url = `${API}/${encodeURIComponent(settings.site)}/searchAnalytics/query`;
  const headers = { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const named = [{ filters: [{ dimension: "query", operator: "includingRegex", expression: `(?i)${BRAND}` }] }];
  const range = ([startDate, endDate]) => ({ startDate, endDate, type: "web" });
  const when = windows(now);
  const asks = [
    { ...range(when.week) },
    { ...range(when.prior) },
    { ...range(when.week), dimensionFilterGroups: named },
    { ...range(when.prior), dimensionFilterGroups: named },
    { ...range(when.week), dimensions: ["query"], rowLimit: ROWS },
    { ...range(when.week), dimensions: ["page"], rowLimit: ROWS },
    { ...range(when.recent), dimensions: ["page"], rowLimit: ROWS },
    { ...range(when.older), dimensions: ["page"], rowLimit: ALL_ROWS },
  ];
  const results = await Promise.all(asks.map((ask) => call(url, { method: "POST", headers, body: JSON.stringify(ask) }, CALL_MS)));
  const failed = results.find((result) => !result.ok);
  if (failed) return { stage: "search", status: failed.status };
  const [week, prior, weekBrand, priorBrand, queries, pages, recent, older] = results.map(rowsOf);
  const seen = new Set(older.map((row) => row.key));
  const plain = queries.filter((row) => row.key && !brand(row.key));
  return {
    week: when.week,
    now: withoutBrand(totalOf(week), totalOf(weekBrand)),
    before: withoutBrand(totalOf(prior), totalOf(priorBrand)),
    brand: totalOf(weekBrand).clicks,
    any: totalOf(week).impressions > 0,
    queries: [...plain].sort(byClicks).slice(0, TOP),
    pages: pages.filter((row) => row.key).sort(byClicks).slice(0, TOP),
    close: plain.filter((row) => row.position >= CLOSE[0] && row.position <= CLOSE[1] && row.impressions >= MIN_SHOWN).sort((a, b) => b.impressions - a.impressions || a.position - b.position).slice(0, TOP),
    fresh: recent.filter((row) => row.key && !seen.has(row.key)).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).slice(0, TOP),
  };
}

const count = (n) => COUNT.format(Math.round(n));
const clicksText = (n) => fill(n === 1 ? SEO.clickOne : SEO.clickMany, { n: count(n) });
const shownText = (n) => fill(n === 1 ? SEO.shownOne : SEO.shownMany, { n: count(n) });
const rate = (row) => (row.impressions ? (100 * row.clicks) / row.impressions : 0);

export function change(now, before) {
  if (!before) return now ? SEO.fromZero : SEO.same;
  const pct = Math.round((100 * Math.abs(now - before)) / before);
  if (!pct) return SEO.same;
  return fill(now > before ? SEO.up : SEO.down, { n: count(pct) });
}

function spotChange(now, before) {
  if (!now) return SEO.none;
  if (!before || one(now) === one(before)) return one(now);
  return fill(Number(one(now)) < Number(one(before)) ? SEO.better : SEO.worse, { now: one(now), before: one(before) });
}

const words = (slug) =>
  decodeURIComponent(slug)
    .replace(/\.html$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => SPELLING[word.toLowerCase()] || word[0].toUpperCase() + word.slice(1))
    .join(" ");

export function pageName(address, site) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  const host = site.startsWith("sc-domain:") ? site.slice(10) : new URL(site).hostname;
  if (url.hostname !== host && !url.hostname.endsWith(`.${host}`) && `www.${url.hostname}` !== host) return address;
  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    const name = !last ? SEO.home : parts[0] === "blog" && parts.length > 1 ? fill(SEO.blog, { name: words(last) }) : words(last);
    const part = url.hash.slice(1);
    return part ? fill(SEO.section, { name, part: words(part) }) : name;
  } catch {
    return address;
  }
}

export function seoLetter(data, settings, site) {
  const { now, before } = data;
  const moved = change(now.clicks, before.clicks);
  const subject = before.clicks || now.clicks ? fill(SEO.subject, { clicks: clicksText(now.clicks), change: moved }) : fill(SEO.subjectFlat, { clicks: clicksText(now.clicks) });
  const list = (rows, detail) => (rows.length ? [{ list: rows.map((row) => [row.label, detail(row)]) }] : [{ p: SEO.none }]);
  const searchDetail = (row) => [clicksText(row.clicks), shownText(row.impressions), fill(SEO.at, { n: one(row.position) })].join(", ");
  const pageDetail = (row) => [clicksText(row.clicks), shownText(row.impressions)].join(", ");
  const quoted = (rows) => rows.map((row) => ({ ...row, label: `"${row.key}"` }));
  const named = (rows) => rows.map((row) => ({ ...row, label: pageName(row.key, site) }));
  const blocks = [
    { h1: SEO.heading },
    { p: fill(SEO.window, { start: SHORT_DAY.format(new Date(`${data.week[0]}T00:00:00Z`)), end: SHORT_DAY.format(new Date(`${data.week[1]}T00:00:00Z`)) }) },
    ...(data.any ? [] : [{ p: SEO.empty }]),
    { h2: SEO.numbers },
    {
      rows: [
        [SEO.clicks, `${count(now.clicks)}, ${moved}`],
        [SEO.shown, `${count(now.impressions)}, ${change(now.impressions, before.impressions)}`],
        [SEO.rate, fill(SEO.was, { now: `${one(rate(now))}%`, before: `${one(rate(before))}%` })],
        [SEO.spot, spotChange(now.position, before.position)],
        [SEO.brand, fill(SEO.brandValue, { clicks: clicksText(data.brand) })],
      ],
    },
    { h2: SEO.searches },
    ...list(quoted(data.queries), searchDetail),
    { h2: SEO.pages },
    ...list(named(data.pages), pageDetail),
    { h2: SEO.close },
    { p: SEO.closeIntro },
    ...list(quoted(data.close), searchDetail),
    { h2: SEO.fresh },
    { p: SEO.freshIntro },
    ...list(named(data.fresh), pageDetail),
    { h2: SEO.dropHeading },
    { p: SEO.drop },
    { links: [[SEO.open, `${CONSOLE}?resource_id=${encodeURIComponent(site)}`]] },
  ];
  return { kind: "seo", to: settings.owners.map((address) => ({ name: "", address })), replyTo: null, subject, text: textOf(blocks), html: htmlOf(subject, blocks) };
}
