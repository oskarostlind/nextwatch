// app/api/share/thread/route.ts — hela filmutbytet med EN vän, stigande datum.
// Hämtningen markerar samtidigt inkommande som lästa: att öppna tråden ÄR
// läskvittot, precis som i en chatt.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  const friendId = req.nextUrl.searchParams.get("friendId")?.trim() ?? "";
  if (!friendId || friendId === me) {
    return NextResponse.json({ ok: false, message: "Ogiltig vän." }, { status: 400 });
  }

  // Samma authz som share/send: tråden finns bara mellan vänner.
  const friendship = await prisma.friendship.findFirst({
    where: { OR: [{ userId: me, friendId }, { userId: friendId, friendId: me }] },
    select: { userId: true },
  });
  if (!friendship) {
    return NextResponse.json({ ok: false, message: "Ni är inte vänner." }, { status: 403 });
  }

  const [items] = await Promise.all([
    prisma.sharedTitle.findMany({
      where: {
        OR: [
          { fromUserId: me, toUserId: friendId },
          { fromUserId: friendId, toUserId: me },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        fromUserId: true,
        tmdbId: true,
        mediaType: true,
        title: true,
        year: true,
        poster: true,
        createdAt: true,
      },
    }),
    prisma.sharedTitle.updateMany({
      where: { fromUserId: friendId, toUserId: me, seenAt: null },
      data: { seenAt: new Date() },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    items: items.map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      mediaType: r.mediaType as "movie" | "tv",
      title: r.title,
      year: r.year,
      poster: r.poster,
      fromMe: r.fromUserId === me,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
