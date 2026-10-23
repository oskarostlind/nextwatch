// lib/stats/collect.ts — samlar Mission Control-statistiken (kontrakt v1, se contract.ts).
//
// Återanvänder adminpanelens uttryck så att talen matchar /admin:
//   users.total/new7d/new30d/active7d + kpis  ← app/api/admin/overview/route.ts
//   series users_new/users_active              ← app/api/admin/timeseries/route.ts (+ lib/activitySql.ts)
// Intäkter: Stripe (revenue-stripe.ts) + AdMob (lib/admobReport.ts), båda cachade 1 h
// per instans. En intäktskälla får aldrig fälla svaret — vid fel/timeout utelämnas
// källan och en warning läggs till. App Store-belopp räknas i portalen (ASC).
//
// Inga personuppgifter: bara count(*) och summor. Läser aldrig Request (auth sker i route.ts).

import { prisma, withDbRetry } from "@/lib/prisma";
import { activityDaysSql, activityTableExists } from "@/lib/activitySql";
import { admobConfigured, getAdmobStats, type AdmobStats } from "@/lib/admobReport";
import {
  type Day,
  type Kpi,
  type RevenueBlock,
  type Series,
  type StatsResponse,
  STATS_TZ,
  STATS_VERSION,
  addSeries,
  buildSeries,
  seriesDays,
  startOfStockholmDay,
  sumPoints,
} from "./contract";
import { type StripeRevenue, getStripeRevenue, stripeConfigured } from "./revenue-stripe";

export const STATS_PROJECT = "nextwatch";

/** Externa källor får max så här lång tid innan svaret går utan dem (hämtningen fortsätter och värmer cachen). */
const SOURCE_DEADLINE_MS = 4000;

const TIMEOUT = Symbol("timeout");
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<typeof TIMEOUT>((resolve) => {
    t = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

/** AdMob-dagens intäkt (SEK, decimal) → öre per dag. */
export function admobToMinor(perDay: { day: Day; earnings: number }[]): Map<Day, number> {
  const m = new Map<Day, number>();
  for (const d of perDay) m.set(d.day, (m.get(d.day) ?? 0) + Math.round(d.earnings * 100));
  return m;
}

/**
 * Bygg revenue-blocket (ren funktion). `stripe`/`admob` = null betyder att källan
 * saknas (ej konfigurerad, fel eller timeout) — den utelämnas ur bySource.
 */
export function buildRevenueBlock(
  days: Day[],
  stripe: Pick<StripeRevenue, "perDay" | "mrr" | "activeSubscriptions"> | null,
  admob: Map<Day, number> | null,
): RevenueBlock {
  const sources: RevenueBlock["bySource"] = [];
  const grossParts: Series[] = [];
  const netParts: Series[] = [];
  const perSource: Series[] = [];

  if (stripe) {
    const gross = buildSeries("revenue_stripe", "Stripe", days, new Map([...stripe.perDay].map(([d, v]) => [d, v.gross])), "minor");
    const net = buildSeries("revenue_stripe_net", "Stripe netto", days, new Map([...stripe.perDay].map(([d, v]) => [d, v.net])), "minor");
    sources.push({
      source: "stripe",
      gross31d: sumPoints(gross),
      net31d: sumPoints(net),
      lagDays: 0,
      hint: "webbköp, brutto inkl. moms; App Store-belopp via ASC i portalen",
    });
    grossParts.push(gross);
    netParts.push(net);
    perSource.push(gross);
  }
  if (admob) {
    const s = buildSeries("revenue_admob", "AdMob", days, admob, "minor");
    const total = sumPoints(s);
    sources.push({ source: "admob", gross31d: total, net31d: total, lagDays: 0, hint: "uppskattning tills AdMob stängt dagen" });
    grossParts.push(s);
    netParts.push(s); // AdMob redovisar redan utbetalningsbelopp: net = gross
    perSource.push(s);
  }

  const gross = addSeries("revenue_gross", "Intäkter (brutto)", days, grossParts, "minor");
  const net = addSeries("revenue_net", "Intäkter (netto)", days, netParts, "minor");
  return {
    currency: "SEK",
    gross31d: sumPoints(gross),
    net31d: sources.length ? sumPoints(net) : null,
    mrr: stripe ? stripe.mrr : null,
    activeSubscriptions: stripe ? stripe.activeSubscriptions : null,
    bySource: sources,
    series: [gross, net, ...perSource],
  };
}

async function collectRevenue(days: Day[], warnings: string[]): Promise<RevenueBlock> {
  const stripeP: Promise<StripeRevenue | null | typeof TIMEOUT> = stripeConfigured()
    ? withDeadline(getStripeRevenue(), SOURCE_DEADLINE_MS)
    : Promise.resolve(null);
  const admobP: Promise<AdmobStats | null | typeof TIMEOUT> = admobConfigured()
    ? withDeadline(getAdmobStats(days.length), SOURCE_DEADLINE_MS)
    : Promise.resolve(null);
  const [st, ad] = await Promise.all([stripeP.catch(() => null), admobP.catch(() => null)]);

  let stripe: StripeRevenue | null = null;
  if (!stripeConfigured()) warnings.push("stripe: STRIPE_SECRET_KEY saknas");
  else if (st === TIMEOUT) warnings.push("stripe: timeout");
  else if (!st) warnings.push("stripe: hämtning misslyckades");
  else {
    stripe = st;
    warnings.push(...st.warnings);
  }

  let admob: Map<Day, number> | null = null;
  if (!admobConfigured()) warnings.push("admob: ej konfigurerat");
  else if (ad === TIMEOUT) warnings.push("admob: timeout");
  else if (!ad) warnings.push("admob: hämtning misslyckades");
  else if (ad.currency !== "SEK") warnings.push(`admob: valuta ${ad.currency}, inte SEK`);
  else {
    admob = admobToMinor(ad.perDay);
    if (ad.timeZone !== STATS_TZ) warnings.push(`admob: rapportens tidszon är ${ad.timeZone}, inte ${STATS_TZ}`);
  }

  return buildRevenueBlock(days, stripe, admob);
}

type DayRow = { day: string; signups: number; active: number };

async function userSeries(hasActivityTable: boolean): Promise<DayRow[]> {
  // Samma CTE:er som app/api/admin/timeseries (days = 31): naiva UTC-timestamps
  // räknas om till svensk kalenderdag; aktiva = unika användare per dag ur
  // lib/activitySql.ts, joinat mot users precis som admin-grafen.
  const days = 31;
  return prisma.$queryRaw<DayRow[]>`
    WITH d AS (
      SELECT generate_series(
        (now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1),
        (now() AT TIME ZONE 'Europe/Stockholm')::date,
        interval '1 day'
      )::date AS day
    ),
    since AS (
      SELECT (((now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1))::timestamp
        AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'UTC' AS ts
    ),
    u AS (
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
      FROM users, since WHERE created_at >= since.ts GROUP BY 1
    ),
    act AS (${activityDaysSql(days + 1, hasActivityTable)}),
    ac AS (
      SELECT act.d AS day, count(DISTINCT act.user_id) AS a
      FROM act JOIN users us ON us.id = act.user_id
      GROUP BY act.d
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(u.n, 0)::int AS signups,
           COALESCE(ac.a, 0)::int AS active
    FROM d
    LEFT JOIN u ON u.day = d.day
    LEFT JOIN ac ON ac.day = d.day
    ORDER BY d.day ASC
  `;
}

export async function collectStats(now = new Date()): Promise<StatsResponse> {
  const days = seriesDays(now);
  const today = days[days.length - 1];
  const warnings: string[] = [];

  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const todayStart = startOfStockholmDay(today);

  const revenueP = collectRevenue(days, warnings);

  const hasActivityTable = await withDbRetry(() => activityTableExists());
  const [
    total,
    new1d,
    new7d,
    new30d,
    active7d,
    active30d,
    verified,
    premium,
    lifetime,
    appleActive,
    ratingsTotal,
    groupsActive,
    rows,
  ] = await withDbRetry(() =>
    Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      prisma.user.count({ where: { lastActiveAt: { gte: d7 } } }),
      prisma.user.count({ where: { lastActiveAt: { gte: d30 } } }),
      prisma.user.count({ where: { emailVerified: { not: null } } }),
      prisma.user.count({ where: { plan: "premium" } }),
      prisma.user.count({ where: { plan: "lifetime" } }),
      prisma.appleIapTransaction.count({ where: { expiresAt: { gt: now } } }),
      prisma.rating.count(),
      prisma.group.count(),
      userSeries(hasActivityTable),
    ]),
  );

  const series: Series[] = [
    buildSeries("users_new", "Nya användare", days, rows.map((r) => ({ day: r.day, value: Number(r.signups) }))),
    buildSeries("users_active", "Aktiva användare", days, rows.map((r) => ({ day: r.day, value: Number(r.active) }))),
  ];
  if (!hasActivityTable) warnings.push("users_active: user_activity_days saknas, undre gräns");

  const kpis: Kpi[] = [
    { key: "premium_users", label: "Premium-användare", value: premium, unit: "count" },
    { key: "lifetime_users", label: "Lifetime-användare", value: lifetime, unit: "count" },
    { key: "verified_users", label: "Verifierade e-postadresser", value: verified, unit: "count" },
    {
      key: "apple_iap_active",
      label: "Aktiva App Store-prenumerationer",
      value: appleActive,
      unit: "count",
      hint: "aktiva App Store-prenumerationer",
    },
    { key: "ratings_total", label: "Swipes/betyg totalt", value: ratingsTotal, unit: "count" },
    { key: "groups_active", label: "Aktiva grupper", value: groupsActive, unit: "count", hint: "grupper gallras efter 24–48 h" },
  ];

  const revenue = await revenueP;

  const out: StatsResponse = {
    version: STATS_VERSION,
    project: STATS_PROJECT,
    generatedAt: now.toISOString(),
    tz: STATS_TZ,
    users: { noun: "Användare", total, new1d, new7d, new30d, active7d, active30d },
    kpis,
    series,
    revenue,
  };
  if (warnings.length) out.warnings = warnings;
  return out;
}
