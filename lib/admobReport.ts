// lib/admobReport.ts — AdMob-statistik till admin-dashboarden via AdMob
// Reporting API. Endast läsning, endast admin-flödet anropar den.
//
// Auth: AdMob API stödjer INTE service accounts — bara OAuth med användar-
// credentials. Därför krävs en engångs-genererad refresh token (scope
// https://www.googleapis.com/auth/admob.readonly) som byts mot access tokens
// här. Se docs/admob-setup.md. OBS: OAuth-appen i Google Cloud måste stå på
// "In production" — i "Testing" går refresh token ut efter 7 dagar.
//
// Env (alla fyra krävs, annars returneras null och dashboarden visar setup-hint):
//   ADMOB_CLIENT_ID / ADMOB_CLIENT_SECRET  — OAuth-klienten (Google Cloud, projekt nextwatch-20fb2)
//   ADMOB_REFRESH_TOKEN                    — engångsgenererad, se docs
//   ADMOB_PUBLISHER_ID                     — "pub-XXXXXXXXXXXXXXXX"
//
// EN rapport hämtas: 365 dagar × DATE × FORMAT med alla mätvärden. Allt annat
// (idag/7d/30d, per format, per dag) räknas ur den. Cachen är per instans
// (samma medvetna avvägning som lib/rateLimit.ts) med 1 h TTL — AdMob-siffror
// är ändå dagsuppskattningar. Vid fel serveras senaste lyckade svaret (stale)
// i upp till ett dygn hellre än att sektionen blinkar bort.

export type AdmobTotals = {
  earnings: number;
  impressions: number;
  clicks: number;
  adRequests: number;
  matchedRequests: number;
};

export type AdmobDay = AdmobTotals & { day: string /* YYYY-MM-DD */ };
export type AdmobFormatRow = AdmobTotals & { format: string };

export type AdmobStats = {
  days: number;
  currency: string;
  fetchedAt: string;
  totals: AdmobTotals & {
    /** Intäkt per 1000 visningar. */
    ecpm: number;
    /** Andel annonsförfrågningar som fick en annons. */
    fillRate: number;
    ctr: number;
  };
  perDay: AdmobDay[];
  perFormat: (AdmobFormatRow & { ecpm: number })[];
};

export type AdmobEarnings = {
  today: number;
  last7d: number;
  last30d: number;
  currency: string;
  fetchedAt: string;
};

type RawRow = AdmobTotals & { day: string; format: string };
type RawReport = { rows: RawRow[]; currency: string; fetchedAt: string; today: string };

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h färskt
const STALE_MAX_MS = 24 * 60 * 60 * 1000; // servera stale max 1 dygn
const MAX_DAYS = 365;

let cache: { data: RawReport; at: number } | null = null;
let inflight: Promise<RawReport | null> | null = null;

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function admobConfigured(): boolean {
  return Boolean(
    env("ADMOB_CLIENT_ID") && env("ADMOB_CLIENT_SECRET") && env("ADMOB_REFRESH_TOKEN") && env("ADMOB_PUBLISHER_ID"),
  );
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("ADMOB_CLIENT_ID")!,
      client_secret: env("ADMOB_CLIENT_SECRET")!,
      refresh_token: env("ADMOB_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`AdMob OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("AdMob OAuth: no access_token");
  return j.access_token;
}

type ApiDate = { year: number; month: number; day: number };

/** Datum i AdMob-kontots tidszon (rapporterna är per kontots dygn, default Los Angeles). */
function partsInTz(d: Date, tz: string): ApiDate {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}
const iso = (a: ApiDate) => `${a.year}-${String(a.month).padStart(2, "0")}-${String(a.day).padStart(2, "0")}`;

const METRICS = ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "AD_REQUESTS", "MATCHED_REQUESTS"] as const;

type MetricValue = { microsValue?: string; integerValue?: string; doubleValue?: number };
type Chunk = {
  header?: { localizationSettings?: { currencyCode?: string }; dateRange?: { endDate?: ApiDate } };
  row?: {
    dimensionValues?: { DATE?: { value?: string }; FORMAT?: { value?: string } };
    metricValues?: Partial<Record<(typeof METRICS)[number], MetricValue>>;
  };
};

const num = (v?: MetricValue) => (v?.microsValue ? Number(v.microsValue) / 1e6 : v?.integerValue ? Number(v.integerValue) : v?.doubleValue ?? 0);

async function fetchFromApi(): Promise<RawReport> {
  const token = await getAccessToken();
  const pub = env("ADMOB_PUBLISHER_ID")!;
  const auth = { Authorization: `Bearer ${token}` };

  // Kontots rapporttidszon, så "idag" blir AdMobs idag och slutdatumet inte
  // hamnar i framtiden (då svarar API:t 400).
  let tz = "America/Los_Angeles";
  try {
    const acc = await fetch(`https://admob.googleapis.com/v1/accounts/${pub}`, { headers: auth, cache: "no-store" });
    if (acc.ok) tz = ((await acc.json()) as { reportingTimeZone?: string }).reportingTimeZone || tz;
  } catch {
    /* default-tidszonen räcker */
  }

  const now = new Date();
  const end = partsInTz(now, tz);
  const start = partsInTz(new Date(now.getTime() - (MAX_DAYS - 1) * 86_400_000), tz);

  const res = await fetch(`https://admob.googleapis.com/v1/accounts/${pub}/networkReport:generate`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      reportSpec: {
        dateRange: { startDate: start, endDate: end },
        dimensions: ["DATE", "FORMAT"],
        metrics: METRICS,
        localizationSettings: { currencyCode: "SEK" },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`AdMob report ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const chunks = (await res.json()) as Chunk[];
  let currency = "SEK";
  const rows: RawRow[] = [];
  for (const c of chunks) {
    const cur = c.header?.localizationSettings?.currencyCode;
    if (cur) currency = cur;
    const r = c.row;
    const d = r?.dimensionValues?.DATE?.value; // "YYYYMMDD"
    if (!r || !d) continue;
    const m = r.metricValues ?? {};
    rows.push({
      day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      format: r.dimensionValues?.FORMAT?.value ?? "OTHER",
      earnings: num(m.ESTIMATED_EARNINGS),
      impressions: num(m.IMPRESSIONS),
      clicks: num(m.CLICKS),
      adRequests: num(m.AD_REQUESTS),
      matchedRequests: num(m.MATCHED_REQUESTS),
    });
  }
  return { rows, currency, fetchedAt: now.toISOString(), today: iso(end) };
}

async function getReport(): Promise<RawReport | null> {
  if (!admobConfigured()) return null;
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && age < CACHE_TTL_MS) return cache.data;

  // Delad inflight så parallella dashboard-öppningar inte trippelanropar Google.
  if (!inflight) {
    inflight = fetchFromApi()
      .then((data) => {
        cache = { data, at: Date.now() };
        return data;
      })
      .catch((e) => {
        console.warn("[admob] report fetch failed:", e instanceof Error ? e.message : e);
        return cache && Date.now() - cache.at < STALE_MAX_MS ? cache.data : null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

const zero = (): AdmobTotals => ({ earnings: 0, impressions: 0, clicks: 0, adRequests: 0, matchedRequests: 0 });
function add(a: AdmobTotals, b: AdmobTotals) {
  a.earnings += b.earnings;
  a.impressions += b.impressions;
  a.clicks += b.clicks;
  a.adRequests += b.adRequests;
  a.matchedRequests += b.matchedRequests;
}
const ecpm = (t: AdmobTotals) => (t.impressions ? (t.earnings / t.impressions) * 1000 : 0);

/** Dag-för-dag, per format och totaler för de senaste `days` dagarna (inkl. idag). */
export async function getAdmobStats(days: number): Promise<AdmobStats | null> {
  const r = await getReport();
  if (!r) return null;
  const n = Math.max(1, Math.min(MAX_DAYS, Math.round(days)));

  // Alla dagar i fönstret, även de utan rader (0), så grafen inte hoppar.
  const endMs = Date.parse(`${r.today}T12:00:00Z`);
  const dayList = Array.from({ length: n }, (_, i) => new Date(endMs - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const from = dayList[0];

  const byDay = new Map<string, AdmobTotals>(dayList.map((d) => [d, zero()]));
  const byFormat = new Map<string, AdmobTotals>();
  const totals = zero();
  for (const row of r.rows) {
    if (row.day < from || row.day > r.today) continue;
    add(byDay.get(row.day) ?? zero(), row);
    if (!byFormat.has(row.format)) byFormat.set(row.format, zero());
    add(byFormat.get(row.format)!, row);
    add(totals, row);
  }

  return {
    days: n,
    currency: r.currency,
    fetchedAt: r.fetchedAt,
    totals: {
      ...totals,
      ecpm: ecpm(totals),
      fillRate: totals.adRequests ? totals.matchedRequests / totals.adRequests : 0,
      ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
    },
    perDay: dayList.map((day) => ({ day, ...byDay.get(day)! })),
    perFormat: [...byFormat.entries()]
      .map(([format, t]) => ({ format, ...t, ecpm: ecpm(t) }))
      .sort((a, b) => b.earnings - a.earnings),
  };
}

/**
 * Uppskattade AdMob-intäkter (idag/7d/30d) för KPI-rutan på översikten.
 * null = ej konfigurerat eller fel utan användbar cache. Kastar aldrig.
 */
export async function getAdmobEarnings(): Promise<AdmobEarnings | null> {
  const s30 = await getAdmobStats(30);
  if (!s30) return null;
  const d = s30.perDay;
  const sum = (arr: AdmobDay[]) => arr.reduce((a, x) => a + x.earnings, 0);
  return {
    today: d[d.length - 1]?.earnings ?? 0,
    last7d: sum(d.slice(-7)),
    last30d: sum(d),
    currency: s30.currency,
    fetchedAt: s30.fetchedAt,
  };
}
