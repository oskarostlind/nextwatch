// app/api/admin/push-stats/route.ts — vad fungerar i pushnotiserna? (/admin → Push)
//
// GET ?days=1..90 (default 30) → per typ / textvinkel / vinkel+variant: skickade,
// öppnade, öppningsgrad och låsskärmsknappar, dag-för-dag (svenska kalenderdagar)
// samt de 40 senaste pushraderna. Källa: push_log (prisma.pushLog).
//
// Definitioner:
//   öppnad     — openedAt satt (knapptryck på låsskärmen stämplar också openedAt)
//   vinkel     — angle före första "." ("person.v2" → "person"); bara recs-pushar har en
//   knapptryck — action satt (save | nope | seen | remove)
//
// Inga e-postadresser i svaret. Allt är groupBy / begränsade frågor (CLAUDE.md →
// Data access); dagsserien är en enda rå SQL-aggregering över perioden.
// Saknas tabellen (SQL-filen ej körd) svarar vi { ok:false, message } i stället för 500.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["save", "nope", "seen", "remove"] as const;
type ActionKey = (typeof ACTIONS)[number];
type ActionCounts = Record<ActionKey, number>;

/** Postgres 42P01 / Prisma P2021 (tabellen saknas) — oavsett hur Prisma packar in det. */
function isMissingTable(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string } | null;
  if (err?.code === "P2021" || err?.code === "42P01" || err?.meta?.code === "42P01") return true;
  return /P2021|42P01|push_log.*does not exist|relation .* does not exist/i.test(err?.message ?? "");
}

const emptyActions = (): ActionCounts => ({ save: 0, nope: 0, seen: 0, remove: 0 });
const rate = (opened: number, sent: number) => (sent > 0 ? opened / sent : null);
const angleBase = (a: string | null) => (a ? a.split(".")[0] : null);

/** Svensk kalenderdag (YYYY-MM-DD) för ett datum (en-CA ger ISO-ordning). */
function stockholmDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(d);
}

type Agg = { sent: number; opened: number; saves: number };

export async function GET(req: NextRequest) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const raw = Math.floor(Number(req.nextUrl.searchParams.get("days")));
  const days = Number.isFinite(raw) && raw >= 1 ? Math.min(90, raw) : 30;

  try {
    // Periodens start = midnatt svensk tid för (days − 1) dagar sedan (idag inräknat).
    const [{ since }] = await prisma.$queryRaw<{ since: Date }[]>`
      SELECT (((now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1))::timestamp
              AT TIME ZONE 'Europe/Stockholm') AS since
    `;
    const where = { sentAt: { gte: since } };

    const [sentByTypeAngle, openedByTypeAngle, actionRows, dayRows, latest] = await Promise.all([
      prisma.pushLog.groupBy({ by: ["type", "angle"], where, _count: { _all: true } }),
      prisma.pushLog.groupBy({
        by: ["type", "angle"],
        where: { ...where, openedAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.pushLog.groupBy({
        by: ["type", "angle", "action"],
        where: { ...where, action: { not: null } },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ day: string; sent: bigint; opened: bigint }[]>`
        SELECT to_char((sent_at AT TIME ZONE 'Europe/Stockholm')::date, 'YYYY-MM-DD') AS day,
               count(*) AS sent,
               count(opened_at) AS opened
        FROM push_log
        WHERE sent_at >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.pushLog.findMany({
        where,
        orderBy: { sentAt: "desc" },
        take: 40,
        select: {
          type: true,
          angle: true,
          tmdbId: true,
          mediaType: true,
          sentAt: true,
          openedAt: true,
          action: true,
        },
      }),
    ]);

    // ── Per typ ──
    const byType = new Map<string, { sent: number; opened: number; actions: ActionCounts }>();
    const typeRow = (t: string) => {
      let r = byType.get(t);
      if (!r) byType.set(t, (r = { sent: 0, opened: 0, actions: emptyActions() }));
      return r;
    };
    // ── Per vinkel (bas) och vinkel+variant — bara rader som har en vinkel ──
    const byAngle = new Map<string, Agg>();
    const byVariant = new Map<string, Agg & { angle: string }>();
    const bump = <T extends Agg>(m: Map<string, T>, key: string, init: () => T) => {
      let r = m.get(key);
      if (!r) m.set(key, (r = init()));
      return r;
    };

    for (const r of sentByTypeAngle) {
      const n = r._count._all;
      typeRow(r.type).sent += n;
      const base = angleBase(r.angle);
      if (base && r.angle) {
        bump(byAngle, base, () => ({ sent: 0, opened: 0, saves: 0 })).sent += n;
        bump(byVariant, r.angle, () => ({ sent: 0, opened: 0, saves: 0, angle: base })).sent += n;
      }
    }
    for (const r of openedByTypeAngle) {
      const n = r._count._all;
      typeRow(r.type).opened += n;
      const base = angleBase(r.angle);
      if (base && r.angle) {
        bump(byAngle, base, () => ({ sent: 0, opened: 0, saves: 0 })).opened += n;
        bump(byVariant, r.angle, () => ({ sent: 0, opened: 0, saves: 0, angle: base })).opened += n;
      }
    }
    for (const r of actionRows) {
      const n = r._count._all;
      const a = r.action as ActionKey | null;
      if (!a || !ACTIONS.includes(a)) continue;
      typeRow(r.type).actions[a] += n;
      const base = angleBase(r.angle);
      if (a === "save" && base && r.angle) {
        bump(byAngle, base, () => ({ sent: 0, opened: 0, saves: 0 })).saves += n;
        bump(byVariant, r.angle, () => ({ sent: 0, opened: 0, saves: 0, angle: base })).saves += n;
      }
    }

    const types = [...byType.entries()]
      .map(([type, v]) => ({ type, ...v, openRate: rate(v.opened, v.sent) }))
      .sort((a, b) => b.sent - a.sent);
    const angles = [...byAngle.entries()]
      .map(([angle, v]) => ({ angle, ...v, openRate: rate(v.opened, v.sent) }))
      .sort((a, b) => b.sent - a.sent);
    const variants = [...byVariant.entries()]
      .map(([variant, v]) => ({ variant, ...v, openRate: rate(v.opened, v.sent) }))
      .sort((a, b) => b.sent - a.sent);

    // ── Dagsserie, nollfylld över hela perioden ──
    const perDay = new Map(dayRows.map((d) => [d.day, d]));
    const series: { day: string; sent: number; opened: number }[] = [];
    // Ankare 12:00 UTC på svensk dagens datum: dygnssteg från middagstid kan aldrig
    // hoppa över/dubblera en kalenderdag vid sommartidsskifte.
    const anchor = new Date(`${stockholmDay(new Date())}T12:00:00Z`).getTime();
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(anchor - i * 86_400_000).toISOString().slice(0, 10);
      const d = perDay.get(day);
      series.push({ day, sent: Number(d?.sent ?? 0), opened: Number(d?.opened ?? 0) });
    }

    const totals = types.reduce(
      (t, r) => {
        t.sent += r.sent;
        t.opened += r.opened;
        for (const a of ACTIONS) t.actions[a] += r.actions[a];
        return t;
      },
      { sent: 0, opened: 0, actions: emptyActions() },
    );
    const buttonTaps = ACTIONS.reduce((s, a) => s + totals.actions[a], 0);

    return NextResponse.json({
      ok: true,
      days,
      totals: { sent: totals.sent, opened: totals.opened, openRate: rate(totals.opened, totals.sent), buttonTaps, actions: totals.actions },
      types,
      angles,
      variants,
      series,
      latest: latest.map((r) => ({
        type: r.type,
        angle: r.angle,
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        sentAt: r.sentAt.toISOString(),
        openedAt: r.openedAt ? r.openedAt.toISOString() : null,
        action: r.action,
      })),
    });
  } catch (e) {
    if (isMissingTable(e)) {
      return NextResponse.json({
        ok: false,
        message: "Tabellen push_log saknas — kör prisma/sql/2026-10-14_push_log.sql mot databasen.",
      });
    }
    console.error("[admin/push-stats]", e);
    return NextResponse.json({ ok: false, message: "Kunde inte hämta pushstatistiken." }, { status: 500 });
  }
}
