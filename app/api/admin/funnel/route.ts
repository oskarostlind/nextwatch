// app/api/admin/funnel/route.ts — första-besöks-tratten (lib/funnel.ts).
//
// Kohort = enheter vars first_open skedde de senaste `days` dygnen (bara nya
// enheter spåras, se app/api/track/funnel). För varje steg: hur många av dem
// nådde steget, och median-tiden dit (sekunder sedan first_open). Dessutom
// "var lämnade de": last_exit för enheter som INTE kommit tillbaka en senare
// dag — senaste steg före stängning, och vilken skärm de var på.
//
// ?days=1|7|30  ?platform=all|ios|web   Endast läsning, gate:ad som /api/admin/*.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DAYS = new Set([1, 7, 30, 90]);

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const reqDays = Number(req.nextUrl.searchParams.get("days"));
  const days = ALLOWED_DAYS.has(reqDays) ? reqDays : 7;
  const platformParam = req.nextUrl.searchParams.get("platform");
  const platform = platformParam === "ios" || platformParam === "web" ? platformParam : "all";

  const exists = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT to_regclass('public.funnel_events') IS NOT NULL AS ok
  `.catch(() => [{ ok: false }]);
  if (!exists[0]?.ok) {
    return NextResponse.json({ ok: true, enabled: false, days, platform, cohort: 0, steps: [], exits: null });
  }

  const platformFilter = platform === "all" ? Prisma.empty : Prisma.sql`AND platform = ${platform}`;
  const cohort = Prisma.sql`
    WITH c AS (
      SELECT device_id, created_at AS t0, platform
      FROM funnel_events
      WHERE name = 'first_open'
        AND created_at >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${days}::int)
        ${platformFilter}
    )
  `;

  const [totals, steps, exitSteps, exitScreens, exitStats] = await Promise.all([
    prisma.$queryRaw<{ n: bigint; ios: bigint; web: bigint }[]>`
      ${cohort}
      SELECT count(*) AS n,
             count(*) FILTER (WHERE platform = 'ios') AS ios,
             count(*) FILTER (WHERE platform = 'web') AS web
      FROM c
    `,
    prisma.$queryRaw<{ name: string; n: bigint; med_sec: number | null; med_ms: number | null }[]>`
      ${cohort}
      SELECT e.name, count(*) AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'sec')::float) AS med_sec,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.props->>'ms')::float) AS med_ms
      FROM funnel_events e JOIN c USING (device_id)
      WHERE e.name NOT IN ('first_exit', 'last_exit')
      GROUP BY e.name
    `,
    // Var lämnade de som INTE kommit tillbaka? Senaste steg före stängning.
    prisma.$queryRaw<{ step: string | null; n: bigint }[]>`
      ${cohort}
      SELECT x.props->>'step' AS step, count(*) AS n
      FROM funnel_events x JOIN c USING (device_id)
      WHERE x.name = 'last_exit'
        AND NOT EXISTS (SELECT 1 FROM funnel_events r WHERE r.device_id = x.device_id AND r.name = 'return_visit')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 15
    `,
    prisma.$queryRaw<{ at: string | null; n: bigint }[]>`
      ${cohort}
      SELECT x.props->>'at' AS at, count(*) AS n
      FROM funnel_events x JOIN c USING (device_id)
      WHERE x.name = 'last_exit'
        AND NOT EXISTS (SELECT 1 FROM funnel_events r WHERE r.device_id = x.device_id AND r.name = 'return_visit')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    `,
    // Första sessionen: hur länge och hur många swipes innan första stängningen.
    prisma.$queryRaw<{ n: bigint; med_secs: number | null; med_swipes: number | null; zero_swipes: bigint }[]>`
      ${cohort}
      SELECT count(*) AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (x.props->>'secs')::float) AS med_secs,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (x.props->>'swipes')::float) AS med_swipes,
             count(*) FILTER (WHERE COALESCE((x.props->>'swipes')::int, 0) = 0) AS zero_swipes
      FROM funnel_events x JOIN c USING (device_id)
      WHERE x.name = 'first_exit'
    `,
  ]);

  const t = totals[0];
  const s = exitStats[0];
  return NextResponse.json({
    ok: true,
    enabled: true,
    days,
    platform,
    cohort: Number(t?.n ?? 0),
    ios: Number(t?.ios ?? 0),
    web: Number(t?.web ?? 0),
    steps: steps.map((r) => ({
      name: r.name,
      n: Number(r.n),
      medSec: r.med_sec === null ? null : Math.round(r.med_sec),
      medMs: r.med_ms === null ? null : Math.round(r.med_ms),
    })),
    exits: {
      byStep: exitSteps.map((r) => ({ step: r.step, n: Number(r.n) })),
      byScreen: exitScreens.map((r) => ({ at: r.at, n: Number(r.n) })),
      firstSession: {
        n: Number(s?.n ?? 0),
        medSecs: s?.med_secs === null || s?.med_secs === undefined ? null : Math.round(s.med_secs),
        medSwipes: s?.med_swipes ?? null,
        zeroSwipes: Number(s?.zero_swipes ?? 0),
      },
    },
  });
}
