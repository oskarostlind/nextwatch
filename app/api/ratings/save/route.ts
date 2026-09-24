// app/api/ratings/save/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { recordSwipeGenres } from "../../../../lib/genreStats";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

type Body = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  rating: number; // 1..10
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request) {
  try {
    const c = await cookies();
    const uid = c.get("nw_uid")?.value;
    if (!uid) return bad(await apiMsg("noSession"), 401);

    const body = (await req.json()) as Body;

    const tmdbId = Number(body.tmdbId);
    const rating = Number(body.rating);
    const mediaType = body.mediaType;

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return bad(await apiMsg("invalidRequest"));
    if (mediaType !== "movie" && mediaType !== "tv") return bad(await apiMsg("invalidRequest"));
    if (!Number.isFinite(rating) || rating < 1 || rating > 10) return bad(await apiMsg("invalidRequest"));

    // Robust mot avsaknad av komposit-unik i genererade typer:
    const existing = await prisma.rating.findFirst({
      where: { userId: uid, tmdbId, mediaType },
      select: { id: true },
    });

    if (existing) {
      await prisma.rating.update({
        where: { id: existing.id },
        data: {
          rating,
          decision: "RATED",
          decidedAt: new Date(),
        },
      });
    } else {
      await prisma.rating.create({
        data: {
          id: crypto.randomUUID(),
          userId: uid,
          tmdbId,
          mediaType,
          rating,
          decision: "RATED",
          decidedAt: new Date(),
        },
      });
    }

    // Betyg = du har sett den → bort ur att-se-listan (Oskars beslut: alltid).
    // Titeln syns i stället under Betyg-fliken.
    await prisma.watchlist.deleteMany({ where: { userId: uid, tmdbId, mediaType } });

    // Beteendebaserad genrestatistik (lib/genreStats.ts) — fire-and-forget.
    // OBS: ett betyg efter ett tidigare svep ger en andra observation för
    // titeln (svep + betyg). Acceptabelt: betyget är en starkare, färskare
    // signal och statistiken är en viktnings-approximation, inte bokföring.
    void recordSwipeGenres({ userId: uid, tmdbId, mediaType, decision: "RATED", rating });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ratings/save error:", err);
    return NextResponse.json(
      { ok: false, message: await apiMsg("saveFailed") },
      { status: 500 }
    );
  }
}
