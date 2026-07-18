// app/api/ratings/save/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

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
    if (!uid) return bad("Ingen session (nw_uid saknas).", 401);

    const body = (await req.json()) as Body;

    const tmdbId = Number(body.tmdbId);
    const rating = Number(body.rating);
    const mediaType = body.mediaType;

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return bad("Ogiltigt tmdbId.");
    if (mediaType !== "movie" && mediaType !== "tv") return bad("Ogiltig mediaType.");
    if (!Number.isFinite(rating) || rating < 1 || rating > 10) return bad("rating måste vara 1–10.");

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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ratings/save error:", err);
    return NextResponse.json(
      { ok: false, message: "Kunde inte spara betyg." },
      { status: 500 }
    );
  }
}
