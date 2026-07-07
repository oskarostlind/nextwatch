// app/api/group/match/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { rateLimitAllow, getRateLimitKey, MATCH_LIMIT } from "@/lib/rateLimit";
import { groupMatchNeed } from "@/lib/groupSettings";
import { tmdbDetails, type TmdbType } from "@/lib/tmdbDetails";

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const url = new URL(req.url);

    const code =
      url.searchParams.get("code") ??
      jar.get("nw_group")?.value ??
      url.searchParams.get("group") ??
      undefined;

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing group code.", size: 0, need: 0, count: 0, match: null, matches: [] },
        { status: 200 }
      );
    }

    const userId = jar.get("nw_uid")?.value ?? undefined;
    const key = getRateLimitKey(req, userId ?? null);
    if (!rateLimitAllow(key, "group-match", { limit: MATCH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: "För många förfrågningar.", size: 0, need: 0, count: 0, match: null, matches: [] },
        { status: 429 }
      );
    }
    const locale = jar.get("nw_locale")?.value ?? "sv-SE";

    const [size, groupRow] = await Promise.all([
      prisma.groupMember.count({ where: { groupCode: code } }),
      prisma.group.findUnique({ where: { code }, select: { matchThreshold: true } }),
    ]);
    const need = groupMatchNeed(size, groupRow?.matchThreshold);

    // Ranka kandidater på antal LIKE
    const [top, seenRows] = await Promise.all([
      prisma.groupVote.groupBy({
        by: ["tmdbId", "tmdbType"],
        where: { groupCode: code, vote: "LIKE" },
        _count: { _all: true },
        orderBy: { _count: { tmdbId: "desc" } },
        take: 20,
      }),
      userId
        ? prisma.groupMatchSeen.findMany({
            where: { groupCode: code, userId },
            select: { tmdbId: true, tmdbType: true },
          })
        : Promise.resolve([]),
    ]);

    const seenKeys = new Set(
      seenRows.map((s) => `${s.tmdbId}_${s.tmdbType}`)
    );

    // Kandidaten vi vill visa för denna användare (ej kvitterad)
    let chosen: { tmdbId: number; tmdbType: TmdbType; count: number } | null = null;
    let firstSeenAboveThreshold: { tmdbId: number; tmdbType: TmdbType; count: number } | null =
      null;

    for (const row of top) {
      const likeCount = row._count?._all ?? 0;
      if (likeCount < need) continue;

      const key = `${row.tmdbId}_${row.tmdbType}`;
      if (userId && seenKeys.has(key)) {
        if (!firstSeenAboveThreshold) {
          firstSeenAboveThreshold = {
            tmdbId: row.tmdbId,
            tmdbType: row.tmdbType as TmdbType,
            count: likeCount,
          };
        }
        continue;
      }

      chosen = {
        tmdbId: row.tmdbId,
        tmdbType: row.tmdbType as TmdbType,
        count: likeCount,
      };
      break;
    }

    if (!chosen) {
      // Ingen okvitterad kandidat – om första över tröskeln var "already seen" för användaren,
      // returnera count = dess verkliga likeCount (hjälper felsökning), men match:null.
      const count = firstSeenAboveThreshold?.count ?? 0;
      return NextResponse.json({ ok: true, size, need, count, match: null, matches: [] }, { status: 200 });
    }

    const details = await tmdbDetails(chosen.tmdbType, chosen.tmdbId, locale);

    return NextResponse.json(
      {
        ok: true,
        size,
        need,
        count: chosen.count,
        match: details ?? {
          tmdbId: chosen.tmdbId,
          tmdbType: chosen.tmdbType,
          title: "",
        },
        matches: [],
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("match GET error:", e);
    return NextResponse.json(
      { ok: false, message: "Internal error.", size: 0, need: 0, count: 0, match: null, matches: [] },
      { status: 200 }
    );
  }
}
