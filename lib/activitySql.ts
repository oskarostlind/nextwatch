// lib/activitySql.ts — "vilka dagar var användaren aktiv?" som en SQL-mängd.
//
// Underlag för retention och dagliga aktiva i /admin. En användare räknas som
// aktiv en svensk kalenderdag om hen den dagen:
//   - öppnade appen (user_activity_days, skrivs av /api/track/active sedan
//     2026-10-10 — den enda källan som fångar besök UTAN swipe),
//   - swipade/betygsatte (ratings), lade till i bevakningslistan (watchlist)
//     eller röstade i en grupp (group_votes),
//   - eller har sin senaste aktivitet/inloggning den dagen (users.last_*_at).
// De äldre källorna gör att statistiken fungerar bakåt i tiden, men de missar
// den som bara tittade runt — siffror före 2026-10-10 är därför en undre gräns.
//
// Alla tidsstämplar är naiva UTC (Prisma DateTime) och räknas om till svensk
// kalenderdag, samma konvention som app/api/admin/timeseries.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const local = (col: string) => Prisma.raw(`(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Stockholm')::date`);

/** SELECT user_id, d — en rad per (användare, aktiv dag) de senaste `days` dagarna. */
export function activityDaysSql(days: number, withActivityTable: boolean): Prisma.Sql {
  const since = Prisma.sql`((now() AT TIME ZONE 'UTC') - make_interval(days => ${days}::int))`;
  return Prisma.sql`
    SELECT user_id, ${local("decided_at")} AS d FROM ratings WHERE decided_at >= ${since}
    UNION SELECT user_id, ${local("added_at")} FROM watchlist WHERE added_at >= ${since}
    UNION SELECT user_id, ${local("decided_at")} FROM group_votes WHERE decided_at >= ${since}
    UNION SELECT id, ${local("last_active_at")} FROM users WHERE last_active_at >= ${since}
    UNION SELECT id, ${local("last_login_at")} FROM users WHERE last_login_at >= ${since}
    ${
      withActivityTable
        ? Prisma.sql`UNION SELECT user_id, day FROM user_activity_days
            WHERE day >= (now() AT TIME ZONE 'Europe/Stockholm')::date - ${days}::int`
        : Prisma.empty
    }
  `;
}

let tableKnown = false;

/**
 * Finns user_activity_days? Falskt tills `npx prisma db push` körts — då ska
 * admin-vyn fortfarande fungera (på de äldre källorna) i stället för att 500:a.
 * Ett ja cachas per instans; ett nej frågas om nästa gång.
 */
export async function activityTableExists(): Promise<boolean> {
  if (tableKnown) return true;
  try {
    const r = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT to_regclass('public.user_activity_days') IS NOT NULL AS ok
    `;
    tableKnown = Boolean(r[0]?.ok);
  } catch {
    tableKnown = false;
  }
  return tableKnown;
}
