// app/api/admin/timeseries/route.ts — dag-för-dag-serier till admin-graferna.
//
// En rad per dygn (svensk tid) för de senaste `days` dagarna:
//   signups   — nya konton (users.created_at)
//   active    — unika användare som swipat/betygsatt den dagen (ratings).
//               lastActiveAt sparar bara SENASTE tillfället, så historisk DAU
//               måste härledas ur betygen — det är den bästa proxyn som finns.
//   swipes    — antal betyg/swipes
//   watchlist — tillägg i bevakningslistan
//   purchases — Stripe-köp + Apple-transaktioner
//   groups    — skapade grupper (gallras efter 24–48 h, så äldre dagar blir
//               underskattade — UI:t säger det)
//
// Allt räknas i Postgres med generate_series så dagar utan händelser blir 0 i
// stället för att saknas. Endast läsning, gate:ad som övriga /api/admin/*.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DAYS = new Set([7, 14, 30, 90, 180, 365]);

type Row = {
  day: string;
  signups: number;
  active: number;
  swipes: number;
  watchlist: number;
  purchases: number;
  groups: number;
};

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = ALLOWED_DAYS.has(requested) ? requested : 30;

  // Svensk kalenderdag: en registrering 00:30 svensk tid hör till den dagen,
  // inte gårdagen som i UTC.
  const rows = await prisma.$queryRaw<
    {
      day: Date;
      signups: bigint;
      active: bigint;
      swipes: bigint;
      watchlist: bigint;
      purchases: bigint;
      groups: bigint;
    }[]
  >`
    WITH d AS (
      SELECT generate_series(
        (now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1),
        (now() AT TIME ZONE 'Europe/Stockholm')::date,
        interval '1 day'
      )::date AS day
    ),
    since AS (
      -- Kolumnerna är naiva UTC-timestamps (Prisma DateTime), så gränsen
      -- räknas om till naiv UTC också — ingen beroende på sessionens tidszon.
      SELECT (((now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1))::timestamp
        AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'UTC' AS ts
    ),
    u AS (
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
      FROM users, since WHERE created_at >= since.ts GROUP BY 1
    ),
    r AS (
      SELECT (decided_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day,
             count(*) AS n, count(DISTINCT user_id) AS a
      FROM ratings, since WHERE decided_at >= since.ts GROUP BY 1
    ),
    w AS (
      SELECT (added_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
      FROM watchlist, since WHERE added_at >= since.ts GROUP BY 1
    ),
    p AS (
      SELECT day, sum(n) AS n FROM (
        SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
        FROM purchases, since WHERE created_at >= since.ts GROUP BY 1
        UNION ALL
        SELECT (purchased_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
        FROM apple_iap_transactions, since WHERE purchased_at >= since.ts GROUP BY 1
      ) x GROUP BY day
    ),
    g AS (
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
      FROM groups, since WHERE created_at >= since.ts GROUP BY 1
    )
    SELECT d.day,
           COALESCE(u.n, 0) AS signups,
           COALESCE(r.a, 0) AS active,
           COALESCE(r.n, 0) AS swipes,
           COALESCE(w.n, 0) AS watchlist,
           COALESCE(p.n, 0) AS purchases,
           COALESCE(g.n, 0) AS groups
    FROM d
    LEFT JOIN u ON u.day = d.day
    LEFT JOIN r ON r.day = d.day
    LEFT JOIN w ON w.day = d.day
    LEFT JOIN p ON p.day = d.day
    LEFT JOIN g ON g.day = d.day
    ORDER BY d.day ASC
  `;

  // Totalt antal konton FÖRE perioden — så UI:t kan rita en kumulativ kurva.
  const before = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users
    WHERE created_at < (((now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1))::timestamp
      AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'UTC'
  `;
  const usersBefore = Number(before[0]?.n ?? 0);

  const series: Row[] = rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    signups: Number(r.signups),
    active: Number(r.active),
    swipes: Number(r.swipes),
    watchlist: Number(r.watchlist),
    purchases: Number(r.purchases),
    groups: Number(r.groups),
  }));

  return NextResponse.json({ ok: true, days, usersBefore, series });
}
