// app/api/watchlist/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { tmdbId: number; mediaType: "movie" | "tv" };

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });

    const { tmdbId, mediaType } = (await req.json()) as Body;
    if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) {
      return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 400 });
    }

    // Unique on (user_id, tmdb_id, media_type) i DB
    await prisma.watchlist.create({
      data: { id: crypto.randomUUID(), userId: uid, tmdbId, mediaType, addedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // ignore unique violation
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ ok: true });
    }
    console.error("[watchlist:add] error:", err);
    return NextResponse.json({ ok: false, message: await apiMsg("saveFailed") }, { status: 500 });
  }
}
