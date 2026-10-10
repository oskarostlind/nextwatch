// app/api/admin/live/route.ts — "just nu" i /admin, pollas var 15:e sekund.
//
//   onlineNow  — last_active_at inom ONLINE_MIN minuter (ActivityBeacon pingar
//                var 2:a minut medan appen är öppen och synlig)
//   today      — aktiva idag (svensk dag), uppdelat på nya (skapade idag) och
//                återkommande (skapade tidigare), se lib/activitySql.ts
//   returning  — de senast aktiva återkommande användarna idag, så det går att
//                se VEM som kommer tillbaka och hur länge sedan de började
// Endast läsning, gate:ad som övriga /api/admin/*.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";
import { activityDaysSql, activityTableExists } from "@/lib/activitySql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONLINE_MIN = 5;

const userSelect = {
  id: true,
  email: true,
  username: true,
  plan: true,
  createdAt: true,
  lastActiveAt: true,
  acqSource: true,
  profile: { select: { displayName: true, avatarId: true } },
} as const;

type U = {
  id: string;
  email: string | null;
  username: string | null;
  plan: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  acqSource: string | null;
  profile: { displayName: string | null; avatarId: string | null } | null;
};

function shape(u: U) {
  return {
    id: u.id,
    name: u.profile?.displayName ?? u.username ?? u.email ?? null,
    avatarId: u.profile?.avatarId ?? null,
    plan: u.plan,
    createdAt: u.createdAt.toISOString(),
    lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
    source: u.acqSource,
  };
}

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const hasTable = await activityTableExists();
  const onlineSince = new Date(Date.now() - ONLINE_MIN * 60 * 1000);

  const [online, todayRows, newToday, returningIds] = await Promise.all([
    prisma.user.findMany({
      where: { lastActiveAt: { gte: onlineSince }, NOT: { id: uid ?? "" } },
      orderBy: { lastActiveAt: "desc" },
      take: 30,
      select: userSelect,
    }),
    prisma.$queryRaw<{ active: bigint; ret_users: bigint }[]>`
      WITH today AS (SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date AS d),
      act AS (${activityDaysSql(2, hasTable)}),
      t AS (SELECT DISTINCT a.user_id FROM act a, today WHERE a.d = today.d)
      SELECT count(*) AS active,
             count(*) FILTER (
               WHERE (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date < today.d
             ) AS ret_users
      FROM t JOIN users u ON u.id = t.user_id, today
    `,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM users
      WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date
            = (now() AT TIME ZONE 'Europe/Stockholm')::date
    `,
    prisma.$queryRaw<{ id: string }[]>`
      WITH today AS (SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date AS d),
      act AS (${activityDaysSql(2, hasTable)})
      SELECT u.id
      FROM users u, today
      WHERE (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date < today.d
        AND EXISTS (SELECT 1 FROM act a WHERE a.user_id = u.id AND a.d = today.d)
      ORDER BY u.last_active_at DESC NULLS LAST
      LIMIT 20
    `,
  ]);

  const ids = returningIds.map((r) => r.id);
  const returningUsers = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: userSelect })
    : [];
  const byId = new Map(returningUsers.map((u) => [u.id, u]));

  const active = Number(todayRows[0]?.active ?? 0);
  const returning = Number(todayRows[0]?.ret_users ?? 0);

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    onlineMinutes: ONLINE_MIN,
    trackingEnabled: hasTable,
    onlineNow: online.length,
    online: online.map(shape),
    today: {
      active,
      returning,
      newActive: active - returning,
      newUsers: Number(newToday[0]?.n ?? 0),
    },
    returning: ids.map((id) => byId.get(id)).filter((u): u is U => Boolean(u)).map(shape),
  });
}
