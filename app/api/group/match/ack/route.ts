// app/api/group/match/ack/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";

type TmdbType = "movie" | "tv";

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const body = (await req.json()) as Partial<{
      code: string;
      tmdbId: number;
      tmdbType: TmdbType;
    }>;

    const code = body.code ?? jar.get("nw_group")?.value;
    const tmdbId = typeof body.tmdbId === "number" ? body.tmdbId : undefined;
    const tmdbType = body.tmdbType === "movie" || body.tmdbType === "tv" ? body.tmdbType : undefined;
    const userId = jar.get("nw_uid")?.value;

    if (!code || !tmdbId || !tmdbType || !userId) {
      return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 200 });
    }

    await prisma.groupMatchSeen.upsert({
      where: {
        groupCode_userId_tmdbId_tmdbType: { groupCode: code, userId, tmdbId, tmdbType },
      },
      update: { seenAt: new Date() },
      create: { groupCode: code, userId, tmdbId, tmdbType, seenAt: new Date() },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    console.error("match/ack POST error:", e);
    return NextResponse.json({ ok: false, message: await apiMsg("internalError") }, { status: 200 });
  }
}
