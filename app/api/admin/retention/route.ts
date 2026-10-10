// app/api/admin/retention/route.ts — kommer nya användare tillbaka?
//
// Kohort = användarrader skapade de senaste 90 dagarna (svensk kalenderdag =
// dag 0). Aktivitet per dag kommer ur lib/activitySql.ts. Mått, alla i % av
// de användare som är GAMLA NOG för måttet (annars drar dagens nya ner D7):
//   act0  — gjorde något dag 0 (swipe/lista/röst/öppnade appen efter beacon)
//   d1    — aktiv igen dagen efter (dag 1)
//   back  — aktiv igen någon gång efter dag 0
//   d7    — aktiv någon gång dag 7 eller senare
//   d30   — aktiv någon gång dag 30 eller senare
//
// ?source=all|<acq_source>|unknown  filtrerar på källa (lib/acquisition.ts)
// ?login=1                          bara konton med e-post/Apple (inte gäster)
// Endast läsning, gate:ad som övriga /api/admin/*.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";
import { activityDaysSql, activityTableExists } from "@/lib/activitySql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;

type Agg = {
  n: number;
  act0: number;
  d1: number;
  d1Base: number;
  back: number;
  backBase: number;
  d7: number;
  d7Base: number;
  d14: number;
  d14Base: number;
  d30: number;
  d30Base: number;
};

// Samma aggregat för totalen, per vecka och per källa.
const AGG = Prisma.sql`
  count(*)                                         AS n,
  count(*) FILTER (WHERE act0)                     AS act0,
  count(*) FILTER (WHERE age >= 1 AND r1)          AS d1,
  count(*) FILTER (WHERE age >= 1)                 AS d1_base,
  count(*) FILTER (WHERE age >= 1 AND rany)        AS back,
  count(*) FILTER (WHERE age >= 1)                 AS back_base,
  count(*) FILTER (WHERE age >= 7 AND r7)          AS d7,
  count(*) FILTER (WHERE age >= 7)                 AS d7_base,
  count(*) FILTER (WHERE age >= 14 AND r14)        AS d14,
  count(*) FILTER (WHERE age >= 14)                AS d14_base,
  count(*) FILTER (WHERE age >= 30 AND r30)        AS d30,
  count(*) FILTER (WHERE age >= 30)                AS d30_base
`;

type RawAgg = {
  n: bigint;
  act0: bigint;
  d1: bigint;
  d1_base: bigint;
  back: bigint;
  back_base: bigint;
  d7: bigint;
  d7_base: bigint;
  d14: bigint;
  d14_base: bigint;
  d30: bigint;
  d30_base: bigint;
};

function toAgg(r: RawAgg | undefined): Agg {
  const n = (v: bigint | undefined) => Number(v ?? 0);
  return {
    n: n(r?.n),
    act0: n(r?.act0),
    d1: n(r?.d1),
    d1Base: n(r?.d1_base),
    back: n(r?.back),
    backBase: n(r?.back_base),
    d7: n(r?.d7),
    d7Base: n(r?.d7_base),
    d14: n(r?.d14),
    d14Base: n(r?.d14_base),
    d30: n(r?.d30),
    d30Base: n(r?.d30_base),
  };
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const source = (req.nextUrl.searchParams.get("source") ?? "all").slice(0, 40);
  const loginOnly = req.nextUrl.searchParams.get("login") === "1";
  const hasTable = await activityTableExists();

  // Källfilter: "all" = alla, "unknown" = acq_source saknas, annars exakt källa.
  const sourceFilter =
    source === "all"
      ? Prisma.empty
      : source === "unknown"
        ? Prisma.sql`AND (u.acq_source IS NULL OR u.acq_source = '')`
        : Prisma.sql`AND u.acq_source = ${source}`;
  const loginFilter = loginOnly ? Prisma.sql`AND (u.email IS NOT NULL OR u.apple_sub IS NOT NULL)` : Prisma.empty;

  // En rad per användare i kohorten med flaggor för varje mått. CTE:n byggs en
  // gång och återanvänds av de tre grupperingarna nedan.
  const base = Prisma.sql`
    WITH today AS (SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date AS d),
    cohort AS (
      SELECT u.id,
             (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS d0,
             NULLIF(u.acq_source, '') AS src
      FROM users u
      WHERE u.created_at >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${WINDOW_DAYS}::int)
      ${sourceFilter}
      ${loginFilter}
    ),
    act AS (${activityDaysSql(WINDOW_DAYS + 1, hasTable)}),
    pu AS (
      SELECT c.id, c.d0, c.src,
             (SELECT d FROM today) - c.d0                 AS age,
             COALESCE(bool_or(a.d = c.d0), false)         AS act0,
             COALESCE(bool_or(a.d = c.d0 + 1), false)     AS r1,
             COALESCE(bool_or(a.d > c.d0), false)         AS rany,
             COALESCE(bool_or(a.d >= c.d0 + 7), false)    AS r7,
             COALESCE(bool_or(a.d >= c.d0 + 14), false)   AS r14,
             COALESCE(bool_or(a.d >= c.d0 + 30), false)   AS r30,
             count(DISTINCT a.d) FILTER (WHERE a.d > c.d0) AS ret_days
      FROM cohort c
      LEFT JOIN act a ON a.user_id = c.id AND a.d >= c.d0
      GROUP BY c.id, c.d0, c.src
    )
  `;

  const [totalRows, weekRows, sourceRows, curveRows] = await Promise.all([
    prisma.$queryRaw<(RawAgg & { avg_ret_days: number | null })[]>`
      ${base}
      SELECT ${AGG},
             avg(ret_days) FILTER (WHERE rany)::float AS avg_ret_days
      FROM pu
    `,
    // Veckokohorter (måndag–söndag), nyaste först.
    prisma.$queryRaw<(RawAgg & { week: Date })[]>`
      ${base}
      SELECT date_trunc('week', d0)::date AS week, ${AGG}
      FROM pu GROUP BY 1 ORDER BY 1 DESC LIMIT 13
    `,
    // Per källa. Okänd = konton från före källspårningen (3 okt 2026) m.fl.
    prisma.$queryRaw<(RawAgg & { src: string | null })[]>`
      ${base}
      SELECT src, ${AGG}
      FROM pu GROUP BY src ORDER BY count(*) DESC
    `,
    // Kurva: andel av kohorten som var aktiv exakt dag N efter start, N = 0..30.
    // Nämnaren är de som hunnit bli N dagar gamla.
    prisma.$queryRaw<{ n: number; base: bigint; active: bigint }[]>`
      ${base},
      days AS (SELECT generate_series(0, 30) AS n),
      off AS (
        SELECT a.d - c.d0 AS n, count(DISTINCT c.id) AS active
        FROM cohort c
        JOIN act a ON a.user_id = c.id AND a.d BETWEEN c.d0 AND c.d0 + 30
        GROUP BY 1
      ),
      bases AS (
        SELECT days.n, count(pu.id) AS base
        FROM days LEFT JOIN pu ON pu.age >= days.n
        GROUP BY days.n
      )
      SELECT bases.n, bases.base, COALESCE(off.active, 0) AS active
      FROM bases LEFT JOIN off ON off.n = bases.n
      ORDER BY bases.n
    `,
  ]);

  const total = toAgg(totalRows[0]);

  return NextResponse.json({
    ok: true,
    source,
    loginOnly,
    windowDays: WINDOW_DAYS,
    // false ⇒ `npx prisma db push` har inte körts; bara swipes m.m. räknas.
    trackingEnabled: hasTable,
    total: { ...total, avgReturnDays: totalRows[0]?.avg_ret_days ?? null },
    weeks: weekRows.map((r) => ({ week: new Date(r.week).toISOString().slice(0, 10), ...toAgg(r) })),
    sources: sourceRows.map((r) => ({ source: r.src, ...toAgg(r) })),
    curve: curveRows.map((r) => ({ day: Number(r.n), base: Number(r.base), active: Number(r.active) })),
  });
}
