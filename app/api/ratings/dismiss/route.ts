// app/api/ratings/dismiss/route.ts
//
// "Visa inte igen"-markering för betygsprompten (tidigare gruppmatchningar).
// Upsertar en Rating-rad med decision "RATE_DISMISSED" (utan betyg) så att
// pending-ratings aldrig frågar om samma titel igen. Skriver inte över ett
// redan satt betyg.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import crypto from "crypto";

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

    const existing = await prisma.rating.findUnique({
      where: { userId_tmdbId_mediaType: { userId: uid, tmdbId, mediaType } },
      select: { id: true, rating: true },
    });

    if (existing) {
      // Redan betygsatt? Lämna orört — betyget väger tyngre än en dismiss.
      if (existing.rating === null) {
        await prisma.rating.update({
          where: { id: existing.id },
          data: { decision: "RATE_DISMISSED", decidedAt: new Date() },
        });
      }
    } else {
      await prisma.rating.create({
        data: {
          id: crypto.randomUUID(),
          userId: uid,
          tmdbId,
          mediaType,
          decision: "RATE_DISMISSED",
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ratings/dismiss error:", err);
    return NextResponse.json({ ok: false, message: "Kunde inte spara." }, { status: 500 });
  }
}
