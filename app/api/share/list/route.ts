// app/api/share/list/route.ts — mottagna filmtips, nyast först.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  const rows = await prisma.sharedTitle.findMany({
    where: { toUserId: me },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      from: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    unseen: rows.filter((r) => r.seenAt === null).length,
    items: rows.map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      mediaType: r.mediaType as "movie" | "tv",
      title: r.title,
      year: r.year,
      poster: r.poster,
      seen: r.seenAt !== null,
      createdAt: r.createdAt.toISOString(),
      from: {
        id: r.from.id,
        username: r.from.username,
        displayName: r.from.profile?.displayName ?? null,
        avatarId: r.from.profile?.avatarId ?? null,
      },
    })),
  });
}
