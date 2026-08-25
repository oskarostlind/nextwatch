// lib/admobReport.ts — hämtar uppskattade annonsintäkter från AdMob Reporting
// API till admin-dashboarden. Endast läsning, endast admin-flödet anropar den.
//
// Auth: AdMob API stödjer INTE service accounts — bara OAuth med användar-
// credentials. Därför krävs en engångs-genererad refresh token (scope
// https://www.googleapis.com/auth/admob.readonly) som byts mot access tokens
// här. Se docs/admob-setup.md för hur nycklarna skapas.
//
// Env (alla fyra krävs, annars returneras null och dashboarden döljer sektionen):
//   ADMOB_CLIENT_ID / ADMOB_CLIENT_SECRET  — OAuth-klienten (Google Cloud)
//   ADMOB_REFRESH_TOKEN                    — engångsgenererad, se docs
//   ADMOB_PUBLISHER_ID                     — "pub-XXXXXXXXXXXXXXXX"
//
// Cachen är per instans (samma medvetna avvägning som lib/rateLimit.ts) med
// 1 h TTL — AdMob-siffror är ändå bara dagsuppskattningar, och vi vill inte
// slå mot Google vid varje dashboard-öppning. Vid fel serveras senaste lyckade
// svaret (stale) i upp till ett dygn hellre än att sektionen blinkar bort.

type AdmobEarnings = {
  /** Uppskattad intäkt idag, i kontots valuta. */
  today: number;
  last7d: number;
  last30d: number;
  /** Kontovaluta från rapporthuvudet, t.ex. "SEK". */
  currency: string;
  /** När siffrorna hämtades (ISO) — visas som "uppdaterad HH:MM" i UI:t. */
  fetchedAt: string;
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h färskt
const STALE_MAX_MS = 24 * 60 * 60 * 1000; // servera stale max 1 dygn

let cache: { data: AdmobEarnings; at: number } | null = null;
let inflight: Promise<AdmobEarnings | null> | null = null;

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function admobConfigured(): boolean {
  return Boolean(
    env("ADMOB_CLIENT_ID") &&
      env("ADMOB_CLIENT_SECRET") &&
      env("ADMOB_REFRESH_TOKEN") &&
      env("ADMOB_PUBLISHER_ID")
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
  if (!res.ok) throw new Error(`AdMob OAuth ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("AdMob OAuth: no access_token");
  return j.access_token;
}

type ApiDate = { year: number; month: number; day: number };

function toApiDate(d: Date): ApiDate {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dateKey(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}${m}${day}`; // AdMob:s DATE-dimension: "YYYYMMDD"
}

async function fetchFromApi(): Promise<AdmobEarnings> {
  const token = await getAccessToken();
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // networkReport:generate svarar med en JSON-array av "chunks":
  // [{header}, {row}, {row}, …, {footer}]. Valutan står i headern.
  const res = await fetch(
    `https://admob.googleapis.com/v1/accounts/${env("ADMOB_PUBLISHER_ID")}/networkReport:generate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        reportSpec: {
          dateRange: { startDate: toApiDate(start), endDate: toApiDate(now) },
          dimensions: ["DATE"],
          metrics: ["ESTIMATED_EARNINGS"],
        },
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`AdMob report ${res.status}`);

  type Chunk = {
    header?: { localizationSettings?: { currencyCode?: string } };
    row?: {
      dimensionValues?: { DATE?: { value?: string } };
      metricValues?: { ESTIMATED_EARNINGS?: { microsValue?: string } };
    };
  };
  const chunks = (await res.json()) as Chunk[];

  let currency = "SEK";
  const perDay = new Map<string, number>(); // YYYYMMDD → belopp (kontovaluta)
  for (const c of chunks) {
    const cur = c.header?.localizationSettings?.currencyCode;
    if (cur) currency = cur;
    const day = c.row?.dimensionValues?.DATE?.value;
    const micros = c.row?.metricValues?.ESTIMATED_EARNINGS?.microsValue;
    if (day && micros) perDay.set(day, (perDay.get(day) ?? 0) + Number(micros) / 1_000_000);
  }

  const todayKey = dateKey(now);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let today = 0;
  let last7d = 0;
  let last30d = 0;
  for (const [day, amount] of perDay) {
    last30d += amount;
    if (day >= dateKey(d7)) last7d += amount;
    if (day === todayKey) today += amount;
  }

  return { today, last7d, last30d, currency, fetchedAt: now.toISOString() };
}

/**
 * Uppskattade AdMob-intäkter (idag/7d/30d). null = ej konfigurerat eller fel
 * utan användbar cache — anroparen (admin/overview) skickar då null vidare och
 * UI:t visar setup-hänvisningen i stället. Kastar aldrig.
 */
export async function getAdmobEarnings(): Promise<AdmobEarnings | null> {
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
