// app/api/admin/pick-stats/route.ts — statistik för "Välj åt mig" (AI-pick) i /admin.
//
// GET ?days=7|30|90 → nyckeltal, dag-för-dag, konverteringssignal och de 20
// senaste förfrågningarna. Läser tabellerna ai_pick_requests / ai_pick_grants /
// ai_pick_events (prisma/sql/2026-10-13_ai_pick.sql) med rå SQL på tabellnamnen
// — medvetet utan Prisma-modellerna, så admin inte hänger på schemat.
//
// Definitioner (perioden = svenska kalenderdagar, idag inräknat):
//   picks       — status 'ok' och source ≠ 'selftest' (det som förbrukar kvot)
//   fallback    — status 'ok' MED feltext: LLM:en föll bort, användaren fick
//                 ändå det deterministiska toppvalet
//   fel         — status 'error' + 'pending' äldre än 2 min (räknas som
//                 misslyckad, se SQL-filen). 'no_candidates' redovisas separat.
//   kostnad     — alla rader inkl. selftest och fel (det är riktiga pengar);
//                 kostnad per pick räknas på användarnas rader / picks
//   konvertering — användare med upsell_click i perioden vars users.plan_since
//                 ligger EFTER första klicket och som nu är premium/lifetime
//
// Saknas tabellerna (SQL-filen ej körd) svarar vi { ok: true, migrated: false }
// i stället för 500. Kolumnerna pick_from_saved / saved_candidates kom till
// sent i specen — saknas de blir de måtten null i stället för att allt kraschar.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DAYS = new Set([7, 30, 90]);
const TABLES = ["ai_pick_requests", "ai_pick_grants", "ai_pick_events"] as const;

/** Postgres 42P01 (undefined_table) / 42703 (undefined_column) — oavsett hur Prisma packar in det. */
function isMissingRelation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string } | null;
  const codes = [err?.code, err?.meta?.code];
  if (codes.includes("42P01") || codes.includes("42703")) return true;
  return /42P01|42703|relation .* does not exist/i.test(err?.message ?? "");
}

const num = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const numOrNull = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));

export async function GET(req: NextRequest) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = ALLOWED_DAYS.has(requested) ? requested : 30;

  try {
    // ── Finns tabellerna/kolumnerna? ──
    const [reg] = await prisma.$queryRaw<{ req: boolean; grants: boolean; events: boolean }[]>`
      SELECT to_regclass('ai_pick_requests') IS NOT NULL AS req,
             to_regclass('ai_pick_grants')   IS NOT NULL AS grants,
             to_regclass('ai_pick_events')   IS NOT NULL AS events
    `;
    const missing = TABLES.filter((_, i) => ![reg?.req, reg?.grants, reg?.events][i]);
    if (missing.length > 0) {
      return NextResponse.json({ ok: true, migrated: false, missing, days });
    }

    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'ai_pick_requests'
        AND column_name IN ('pick_from_saved', 'saved_candidates')
    `;
    const hasFromSaved = cols.some((c) => c.column_name === "pick_from_saved");
    const hasSavedCands = cols.some((c) => c.column_name === "saved_candidates");

    // Periodens start = midnatt svensk tid för (days − 1) dagar sedan. Tabellerna
    // är timestamptz (till skillnad från Prismas naiva UTC-kolumner), så ingen
    // AT TIME ZONE 'UTC'-dans behövs här.
    const SINCE = Prisma.sql`(((now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1))::timestamp AT TIME ZONE 'Europe/Stockholm')`;
    const USER_OK = Prisma.sql`status = 'ok' AND source <> 'selftest'`;
    const STALE_PENDING = Prisma.sql`(status = 'pending' AND created_at < now() - interval '45 seconds')`;

    const savedAgg = Prisma.sql`
      ${hasFromSaved ? Prisma.sql`count(*) FILTER (WHERE ${USER_OK} AND pick_from_saved)` : Prisma.sql`NULL::bigint`} AS from_saved,
      ${hasFromSaved ? Prisma.sql`count(*) FILTER (WHERE ${USER_OK} AND pick_from_saved IS NOT NULL)` : Prisma.sql`NULL::bigint`} AS saved_known,
      ${hasSavedCands ? Prisma.sql`count(*) FILTER (WHERE ${USER_OK} AND saved_candidates > 0)` : Prisma.sql`NULL::bigint`} AS had_saved,
      ${
        hasFromSaved && hasSavedCands
          ? Prisma.sql`count(*) FILTER (WHERE ${USER_OK} AND saved_candidates > 0 AND pick_from_saved)`
          : Prisma.sql`NULL::bigint`
      } AS saved_when_had,
      ${hasSavedCands ? Prisma.sql`avg(saved_candidates) FILTER (WHERE ${USER_OK})::float` : Prisma.sql`NULL::float`} AS avg_saved_cands
    `;
    const fromSavedCol = hasFromSaved ? Prisma.sql`r.pick_from_saved` : Prisma.sql`NULL::boolean`;

    const [kpiRows, grantRows, eventRows, dayRows, convRows, convUsers, latestRows] = await Promise.all([
      prisma.$queryRaw<
        {
          ok: bigint;
          users: bigint;
          ok_premium: bigint;
          ok_credit: bigint;
          finished: bigint;
          errors: bigint;
          no_candidates: bigint;
          fallbacks: bigint;
          selftests: bigint;
          cost_all: number;
          cost_users: number;
          lat_avg: number | null;
          lat_p95: number | null;
          from_saved: bigint | null;
          saved_known: bigint | null;
          had_saved: bigint | null;
          saved_when_had: bigint | null;
          avg_saved_cands: number | null;
        }[]
      >`
        SELECT
          count(*) FILTER (WHERE ${USER_OK})                                            AS ok,
          count(DISTINCT user_id) FILTER (WHERE ${USER_OK})                             AS users,
          count(*) FILTER (WHERE status = 'ok' AND source = 'premium')                  AS ok_premium,
          count(*) FILTER (WHERE status = 'ok' AND source = 'credit')                   AS ok_credit,
          count(*) FILTER (WHERE source <> 'selftest'
                             AND (status IN ('ok', 'error', 'no_candidates') OR ${STALE_PENDING})) AS finished,
          count(*) FILTER (WHERE source <> 'selftest' AND (status = 'error' OR ${STALE_PENDING})) AS errors,
          count(*) FILTER (WHERE source <> 'selftest' AND status = 'no_candidates')     AS no_candidates,
          count(*) FILTER (WHERE ${USER_OK} AND COALESCE(error, '') <> '')              AS fallbacks,
          count(*) FILTER (WHERE source = 'selftest')                                   AS selftests,
          COALESCE(sum(cost_usd), 0)::float                                             AS cost_all,
          COALESCE(sum(cost_usd) FILTER (WHERE source <> 'selftest'), 0)::float         AS cost_users,
          avg(latency_ms) FILTER (WHERE ${USER_OK})::float                              AS lat_avg,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
            FILTER (WHERE ${USER_OK} AND latency_ms IS NOT NULL)                        AS lat_p95,
          ${savedAgg}
        FROM ai_pick_requests
        WHERE created_at >= ${SINCE}
      `,
      prisma.$queryRaw<{ grants: bigint; picks: bigint; users: bigint }[]>`
        SELECT count(*) AS grants, COALESCE(sum(picks), 0)::bigint AS picks, count(DISTINCT user_id) AS users
        FROM ai_pick_grants
        WHERE created_at >= ${SINCE}
      `,
      prisma.$queryRaw<{ type: string; n: bigint; users: bigint }[]>`
        SELECT type, count(*) AS n, count(DISTINCT user_id) AS users
        FROM ai_pick_events
        WHERE created_at >= ${SINCE}
        GROUP BY type
      `,
      // En rad per dag, även dagar utan händelser (generate_series).
      prisma.$queryRaw<{ day: Date; premium: bigint; credit: bigint; unlocks: bigint }[]>`
        WITH d AS (
          SELECT generate_series(
            (now() AT TIME ZONE 'Europe/Stockholm')::date - (${days}::int - 1),
            (now() AT TIME ZONE 'Europe/Stockholm')::date,
            interval '1 day'
          )::date AS day
        ),
        r AS (
          SELECT (created_at AT TIME ZONE 'Europe/Stockholm')::date AS day,
                 count(*) FILTER (WHERE source = 'premium') AS premium,
                 count(*) FILTER (WHERE source = 'credit')  AS credit
          FROM ai_pick_requests
          WHERE status = 'ok' AND created_at >= ${SINCE}
          GROUP BY 1
        ),
        g AS (
          SELECT (created_at AT TIME ZONE 'Europe/Stockholm')::date AS day, count(*) AS n
          FROM ai_pick_grants
          WHERE created_at >= ${SINCE}
          GROUP BY 1
        )
        SELECT d.day, COALESCE(r.premium, 0) AS premium, COALESCE(r.credit, 0) AS credit, COALESCE(g.n, 0) AS unlocks
        FROM d
        LEFT JOIN r ON r.day = d.day
        LEFT JOIN g ON g.day = d.day
        ORDER BY d.day ASC
      `,
      // Konverteringssignal. plan_since är en naiv UTC-kolumn (Prisma DateTime)
      // → AT TIME ZONE 'UTC' gör den jämförbar med timestamptz.
      prisma.$queryRaw<{ clickers: bigint; converted: bigint }[]>`
        WITH c AS (
          SELECT user_id, min(created_at) AS first_click
          FROM ai_pick_events
          WHERE type = 'upsell_click' AND user_id IS NOT NULL AND created_at >= ${SINCE}
          GROUP BY user_id
        )
        SELECT count(*) AS clickers,
               count(*) FILTER (
                 WHERE u.plan IN ('premium', 'lifetime')
                   AND u.plan_since IS NOT NULL
                   AND (u.plan_since AT TIME ZONE 'UTC') >= c.first_click
               ) AS converted
        FROM c JOIN users u ON u.id = c.user_id
      `,
      prisma.$queryRaw<{ id: string; email: string | null; first_click: Date; plan_since: Date }[]>`
        WITH c AS (
          SELECT user_id, min(created_at) AS first_click
          FROM ai_pick_events
          WHERE type = 'upsell_click' AND user_id IS NOT NULL AND created_at >= ${SINCE}
          GROUP BY user_id
        )
        SELECT u.id, u.email, c.first_click, (u.plan_since AT TIME ZONE 'UTC') AS plan_since
        FROM c JOIN users u ON u.id = c.user_id
        WHERE u.plan IN ('premium', 'lifetime')
          AND u.plan_since IS NOT NULL
          AND (u.plan_since AT TIME ZONE 'UTC') >= c.first_click
        ORDER BY u.plan_since DESC
        LIMIT 10
      `,
      // De 20 senaste oavsett period (inkl. selftest/fel — det är felsökningsvyn).
      prisma.$queryRaw<
        {
          id: string;
          created_at: Date;
          user_id: string;
          email: string | null;
          prompt: string | null;
          chips: unknown;
          pick_tmdb_id: number | null;
          pick_media_type: string | null;
          from_saved: boolean | null;
          source: string;
          status: string;
          latency_ms: number | null;
          cost_usd: number | null;
          error: string | null;
          model: string | null;
        }[]
      >`
        SELECT r.id, r.created_at, r.user_id, u.email, r.prompt, r.chips,
               r.pick_tmdb_id, r.pick_media_type, ${fromSavedCol} AS from_saved,
               r.source, r.status, r.latency_ms, r.cost_usd, r.error, r.model
        FROM ai_pick_requests r
        LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC
        LIMIT 20
      `,
    ]);

    const k = kpiRows[0];
    const g = grantRows[0];
    const ev: Record<string, { n: number; users: number }> = {};
    for (const r of eventRows) ev[r.type] = { n: num(r.n), users: num(r.users) };
    const evt = (t: string) => ev[t] ?? { n: 0, users: 0 };

    const okPicks = num(k?.ok);

    return NextResponse.json({
      ok: true,
      migrated: true,
      days,
      savedTracking: hasFromSaved,
      picks: {
        ok: okPicks,
        users: num(k?.users),
        premium: num(k?.ok_premium),
        credit: num(k?.ok_credit),
        finished: num(k?.finished),
        errors: num(k?.errors),
        noCandidates: num(k?.no_candidates),
        fallbacks: num(k?.fallbacks),
        selftests: num(k?.selftests),
      },
      saved: {
        fromSaved: numOrNull(k?.from_saved),
        known: numOrNull(k?.saved_known),
        hadSaved: numOrNull(k?.had_saved),
        fromSavedWhenHad: numOrNull(k?.saved_when_had),
        avgSavedCandidates: k?.avg_saved_cands ?? null,
      },
      cost: {
        totalUsd: k?.cost_all ?? 0,
        usersUsd: k?.cost_users ?? 0,
        perPickUsd: okPicks > 0 ? (k?.cost_users ?? 0) / okPicks : null,
      },
      latency: {
        avgMs: k?.lat_avg ?? null,
        p95Ms: k?.lat_p95 ?? null,
      },
      unlocks: { grants: num(g?.grants), picks: num(g?.picks), users: num(g?.users) },
      events: ev,
      funnel: {
        paywallView: evt("paywall_view"),
        adStart: evt("ad_start"),
        adComplete: evt("ad_complete"),
        adFail: evt("ad_fail"),
      },
      upsell: { view: evt("upsell_view"), click: evt("upsell_click") },
      openService: evt("open_service"),
      another: evt("another"),
      conversion: {
        clickers: num(convRows[0]?.clickers),
        converted: num(convRows[0]?.converted),
        users: convUsers.map((r) => ({
          id: r.id,
          email: r.email,
          firstClick: new Date(r.first_click).toISOString(),
          planSince: new Date(r.plan_since).toISOString(),
        })),
      },
      series: dayRows.map((r) => ({
        day: new Date(r.day).toISOString().slice(0, 10),
        premium: num(r.premium),
        credit: num(r.credit),
        unlocks: num(r.unlocks),
      })),
      latest: latestRows.map((r) => ({
        id: r.id,
        createdAt: new Date(r.created_at).toISOString(),
        userId: r.user_id,
        email: r.email,
        prompt: r.prompt ? (r.prompt.length > 60 ? `${r.prompt.slice(0, 60)}…` : r.prompt) : null,
        chips: Array.isArray(r.chips) ? (r.chips as unknown[]).map(String).slice(0, 8) : [],
        tmdbId: r.pick_tmdb_id,
        mediaType: r.pick_media_type,
        fromSaved: r.from_saved,
        source: r.source,
        status: r.status,
        latencyMs: r.latency_ms,
        costUsd: r.cost_usd,
        error: r.error ? r.error.slice(0, 160) : null,
        model: r.model,
      })),
    });
  } catch (e) {
    if (isMissingRelation(e)) {
      return NextResponse.json({ ok: true, migrated: false, missing: [], days });
    }
    console.error("[admin/pick-stats]", e);
    return NextResponse.json({ ok: false, message: "Kunde inte läsa pick-statistiken" }, { status: 500 });
  }
}
