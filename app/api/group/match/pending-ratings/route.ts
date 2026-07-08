// app/api/group/match/pending-ratings/route.ts
//
// Tidigare gruppmatchningar som användaren ännu inte betygsatt eller avfärdat.
// Kvitterade matchningar loggas i GroupMatchSeen (via match/ack); vi exkluderar
// alla titlar som redan har en Rating-rad för användaren — det täcker satta
// betyg (RATED), "visa inte igen" (RATE_DISMISSED) och vanliga solo-swipes.
// Används av OverlayMount för "betygsätt er tidigare match"-prompten.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tmdbDetails, type TmdbType } from "@/lib/tmdbDetails";

const MAX_PROMPTS = 5;

export async function GET() {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }
    const locale = jar.get("nw_locale")?.value ?? "sv-SE";

    const [seen, rated] = await Promise.all([
      prisma.groupMatchSeen.findMany({
        where: { userId: uid },
        select: { tmdbId: true, tmdbType: true, seenAt: true },
        orderBy: { seenAt: "desc" },
        take: 50,
      }),
      prisma.rating.findMany({
        where: { userId: uid },
        select: { tmdbId: true, mediaType: true },
      }),
    ]);

    const handled = new Set(rated.map((r) => `${r.mediaType}_${r.tmdbId}`));

    // Dedupe (samma titel kan vara match i flera grupper) + filtrera hanterade.
    const pendingKeys = new Set<string>();
    const pending: { tmdbId: number; tmdbType: TmdbType }[] = [];
    for (const s of seen) {
      const key = `${s.tmdbType}_${s.tmdbId}`;
      if (handled.has(key) || pendingKeys.has(key)) continue;
      pendingKeys.add(key);
      pending.push({ tmdbId: s.tmdbId, tmdbType: s.tmdbType as TmdbType });
      if (pending.length >= MAX_PROMPTS) break;
    }

    const details = await Promise.all(
      pending.map((p) => tmdbDetails(p.tmdbType, p.tmdbId, locale).catch(() => null))
    );

    const items = pending.map((p, i) => ({
      tmdbId: p.tmdbId,
      tmdbType: p.tmdbType,
      title: details[i]?.title ?? "",
      poster: details[i]?.poster ?? null,
      year: details[i]?.year ?? null,
    }));

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e) {
    console.error("pending-ratings GET error:", e);
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
