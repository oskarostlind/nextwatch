// lib/stats/contract.ts — Mission Control stats-kontrakt v1 (kopia av ARCHITECTURE.md §1).
//
// Inga personuppgifter: bara aggregerade tal. Kontraktet är litet och versionerat —
// en ändring = bump av STATS_VERSION och uppdatering i alla kopior (portalen har sin
// i src/lib/mission/stats-contract.ts). Filen är medvetet import-fri så den kan
// testas fristående (scripts/stats-selftest.ts).

export const STATS_VERSION = 1 as const;

/** "YYYY-MM-DD" i Europe/Stockholm. */
export type Day = string;

export type SeriesPoint = { day: Day; value: number };

export type Unit = "count" | "minor" | "pct";

export type Series = {
  /** Stabil nyckel, snake_case, t.ex. "users_new", "quotes", "revenue_gross". */
  key: string;
  label: string; // svensk visningstext
  unit?: Unit; // default "count". "minor" = minsta valutaenhet (öre) för intäkter.
  /** Exakt 31 punkter: de senaste 30 hela Stockholm-dagarna + dagens (partiella) dag, stigande, noll-fyllda. */
  points: SeriesPoint[];
};

export type Kpi = {
  key: string; // t.ex. "premium_users", "cards_claimed", "quotes_new_status", "mrr"
  label: string; // "Premium-användare"
  value: number; // alltid ett tal; valuta i minor units (öre)
  unit?: Unit;
  hint?: string; // kort förklaring, visas som title/underrad
};

export type UsersBlock = {
  /** Vad "användare" betyder i det här projektet: "Användare", "Prenumeranter", "API-konton", "Konton". */
  noun: string;
  total: number;
  new1d: number; // registrerade idag (Stockholm-dag, partiell)
  new7d: number; // rullande: createdAt >= now − 7×24 h (samma som adminpanelerna)
  new30d: number; // rullande: createdAt >= now − 30×24 h
  active7d: number | null; // null = mäts inte
  active30d: number | null;
};

export type RevenueSource = "stripe" | "admob" | "appstore";

export type RevenueBlock = {
  currency: "SEK"; // allt konverteras till SEK
  gross31d: number; // minor units (öre), summa av series.points (gross)
  net31d: number | null; // efter avgifter/återbetalningar (Stripe: ja; AdMob: = gross)
  mrr: number | null; // minor units, från aktiva prenumerationer (Stripe); null om okänt
  activeSubscriptions: number | null;
  bySource: { source: RevenueSource; gross31d: number; net31d: number | null; lagDays: number; hint?: string }[];
  /** Per-dag-serier: "revenue_gross", "revenue_net", och per källa "revenue_stripe" | "revenue_admob". unit "minor". */
  series: Series[];
};

export type StatsResponse = {
  version: typeof STATS_VERSION;
  /** Vercel-projektnamnet. */
  project: string;
  generatedAt: string; // ISO-8601
  tz: "Europe/Stockholm";
  users: UsersBlock | null;
  kpis: Kpi[];
  series: Series[];
  revenue: RevenueBlock | null;
  sites?: Record<string, { users: null; kpis: Kpi[]; series: Series[] }>;
  /** Ickefatala fel per källa (t.ex. "admob: timeout"). Bara fasta texter/felkoder. */
  warnings?: string[];
};

export const STATS_TZ = "Europe/Stockholm" as const;
export const SERIES_DAYS = 31;
const DAY_MS = 86_400_000;

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Kalenderdag i Stockholm, "YYYY-MM-DD". */
export const stockholmDay = (d: Date): Day => dayFmt.format(d);

/** Dagen `n` kalenderdagar efter `day` (negativt = bakåt). Ren datumaritmetik, ingen tidszon. */
export function addDays(day: Day, n: number): Day {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** De 31 dagarna idag − 30 … idag (Stockholm), stigande. */
export function seriesDays(now = new Date()): Day[] {
  const today = stockholmDay(now);
  return Array.from({ length: SERIES_DAYS }, (_, i) => addDays(today, i - (SERIES_DAYS - 1)));
}

/** 31 dagar: idag − 30 … idag (Stockholm), noll-fyllda. */
export function emptySeries(now = new Date()): SeriesPoint[] {
  return seriesDays(now).map((day) => ({ day, value: 0 }));
}

const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: STATS_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Stockholms UTC-offset (ms) vid tidpunkten `ms`. +1 h vintertid, +2 h sommartid. */
function stockholmOffsetMs(ms: number): number {
  const p = offsetFmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Start av Stockholm-dag som UTC-Date (för WHERE created_at >= …). */
export function startOfStockholmDay(day: Day): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  // Två varv: offseten vid gissningen, sedan offseten vid den faktiska midnatten.
  // Sommartidsbytet sker 01:00 UTC, så lokal midnatt är aldrig tvetydig.
  const first = guess - stockholmOffsetMs(guess);
  return new Date(guess - stockholmOffsetMs(first));
}

/**
 * Bygg en serie med exakt 31 punkter över `days` ur en dag→värde-karta.
 * Dagar som saknas blir 0; värden utanför fönstret ignoreras.
 */
export function buildSeries(
  key: string,
  label: string,
  days: Day[],
  values: ReadonlyMap<Day, number> | Iterable<{ day: Day; value: number }>,
  unit?: Unit,
): Series {
  const map = values instanceof Map ? values : new Map([...(values as Iterable<SeriesPoint>)].map((p) => [p.day, p.value]));
  const s: Series = { key, label, points: days.map((day) => ({ day, value: Number(map.get(day) ?? 0) })) };
  if (unit) s.unit = unit;
  return s;
}

export const sumPoints = (s: Series) => s.points.reduce((a, p) => a + p.value, 0);

/** Summera flera serier punkt för punkt (samma dagar). */
export function addSeries(key: string, label: string, days: Day[], parts: Series[], unit?: Unit): Series {
  const map = new Map<Day, number>();
  for (const s of parts) for (const p of s.points) map.set(p.day, (map.get(p.day) ?? 0) + p.value);
  return buildSeries(key, label, days, map, unit);
}
