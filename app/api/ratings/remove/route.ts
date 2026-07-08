// app/api/ratings/remove/route.ts
//
// Tar bort användarens eget betyg på en titel (Betyg-fliken på /watchlist).
// Raden raderas inte — rating nollställs och decision blir "seen" så titeln
// fortsätter filtreras bort från rekommendationerna (watchKeys) men försvinner
// ur betygslistan och slutar väga i smakmodellen.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  tmdbId: number;
  mediaType: "movie" | "tv";
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value;
    if (!uid) return bad("Ingen session (nw_uid saknas).", 401);

    const body = (await req.json()) as Body;
    const tmdbId = Number(body.tmdbId);
    const mediaType = body.mediaType;

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return bad("Ogiltigt tmdbId.");
    if (mediaType !== "movie" && mediaType !== "tv") return bad("Ogiltig mediaType.");

    await prisma.rating.updateMany({
      where: { userId: uid, tmdbId, mediaType },
      data: { rating: null, decision: "seen", decidedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ratings/remove error:", err);
    return NextResponse.json({ ok: false, message: "Kunde inte ta bort betyget." }, { status: 500 });
  }
}
