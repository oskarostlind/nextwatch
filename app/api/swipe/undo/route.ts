// app/api/swipe/undo/route.ts
//
// Ångrar senaste swipe: tar bort Rating-rad (återbetalar swipe-gräns),
// watchlist vid like, och gruppröst om groupCode skickas med.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";

type Body = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  action: "like" | "dislike" | "seen";
  groupCode?: string;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value;
    if (!uid) return bad(await apiMsg("noSession"), 401);

    const body = (await req.json()) as Body;
    const tmdbId = Number(body.tmdbId);
    const mediaType = body.mediaType;
    const action = body.action;
    const groupCode = body.groupCode?.trim().toUpperCase() || undefined;

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return bad(await apiMsg("invalidRequest"));
    if (mediaType !== "movie" && mediaType !== "tv") return bad(await apiMsg("invalidRequest"));
    if (action !== "like" && action !== "dislike" && action !== "seen") return bad(await apiMsg("invalidRequest"));

    await prisma.rating.deleteMany({
      where: { userId: uid, tmdbId, mediaType },
    });

    if (action === "like") {
      await prisma.watchlist.deleteMany({
        where: { userId: uid, tmdbId, mediaType },
      });
      // Bevakningen av en osläppt titel ("Kommer snart"-kort) följer liken: ångrar
      // man liken ska man inte få ett pling om ett halvår. deleteMany är no-op när
      // titeln inte var bevakad, så ingen extra gren behövs — och swipar man om
      // återskapas raden av upserten i /api/watchlist/like.
      await prisma.releaseFollow.deleteMany({
        where: { userId: uid, tmdbId, mediaType },
      });
    }

    if (groupCode) {
      await prisma.groupVote.deleteMany({
        where: { groupCode, userId: uid, tmdbId, tmdbType: mediaType },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("swipe/undo error:", err);
    return NextResponse.json({ ok: false, message: await apiMsg("undoFailed") }, { status: 500 });
  }
}
