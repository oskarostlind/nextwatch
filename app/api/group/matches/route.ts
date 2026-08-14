// app/api/group/matches/route.ts
//
// Alla gruppens matchningar (Matchningar-fliken), nyast först. Skiljer sig
// från /api/group/match (som beräknar EN okvitterad kandidat ur GroupVote
// live) genom att läsa den skrivna historiken i GroupMatch — annars försvinner
// en match ur listan så fort den kvitteras eller om röster städas bort.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { rateLimitAllow, getRateLimitKey, MATCH_LIMIT } from "@/lib/rateLimit";
import { tmdbDetails, type TmdbType } from "@/lib/tmdbDetails";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";

const MAX_MATCHES = 50;

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const url = new URL(req.url);
    const userId = jar.get("nw_uid")?.value;
    if (!userId) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    const key = getRateLimitKey(req, userId);
    if (!rateLimitAllow(key, "group-matches", { limit: MATCH_LIMIT })) {
      return NextResponse.json({ ok: false, message: "För många förfrågningar." }, { status: 429 });
    }

    const code = url.searchParams.get("code") ?? jar.get("nw_group")?.value ?? undefined;
    if (!code) {
      return NextResponse.json({ ok: true, items: [] }, { status: 200 });
    }

    // Bara medlemmar får se gruppens matchhistorik.
    const membership = await prisma.groupMember.findUnique({
      where: { groupCode_userId: { groupCode: code, userId } },
      select: { userId: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, message: "Du är inte med i gruppen." }, { status: 403 });
    }

    const locale = await tmdbLanguageFromCookies();

    const rows = await prisma.groupMatch.findMany({
      where: { groupCode: code },
      orderBy: { matchedAt: "desc" },
      take: MAX_MATCHES,
    });

    const details = await Promise.all(
      rows.map((r) => tmdbDetails(r.tmdbType as TmdbType, r.tmdbId, locale).catch(() => null))
    );

    const items = rows.map((r, i) => ({
      tmdbId: r.tmdbId,
      tmdbType: r.tmdbType as TmdbType,
      matchedAt: r.matchedAt.toISOString(),
      title: details[i]?.title ?? "",
      year: details[i]?.year ?? null,
      poster: details[i]?.poster ?? null,
      rating: details[i]?.rating ?? null,
      overview: details[i]?.overview ?? null,
      providers: details[i]?.providers ?? null,
      trailer: details[i]?.trailer ?? null,
    }));

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e) {
    console.error("group/matches GET error:", e);
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
