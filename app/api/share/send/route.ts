// app/api/share/send/route.ts — skicka ett filmtips (titelkort) till en vän.
//
// Ingen fritext (avsiktligt scope): tipset ÄR kortet. Authz: man kan bara
// tipsa sina vänner — annars vore detta en spamkanal till godtyckliga id:n.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    toUserId?: string;
    tmdbId?: number;
    mediaType?: string;
    title?: string;
    year?: string | null;
    poster?: string | null;
  };

  const toUserId = typeof body.toUserId === "string" ? body.toUserId : null;
  const tmdbId = Number.isFinite(body.tmdbId) ? Number(body.tmdbId) : null;
  const mediaType = body.mediaType === "movie" || body.mediaType === "tv" ? body.mediaType : null;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
  if (!toUserId || !tmdbId || !mediaType || !title) {
    return NextResponse.json({ ok: false, message: "Ogiltigt tips." }, { status: 400 });
  }
  if (toUserId === me) {
    return NextResponse.json({ ok: false, message: "Du kan inte tipsa dig själv." }, { status: 400 });
  }

  const friendship = await prisma.friendship.findFirst({
    where: { OR: [{ userId: me, friendId: toUserId }, { userId: toUserId, friendId: me }] },
    select: { userId: true },
  });
  if (!friendship) {
    return NextResponse.json({ ok: false, message: "Ni är inte vänner." }, { status: 403 });
  }

  // Samma tips igen bumpar raden (nytt datum, oläst igen) i stället för dubblett.
  await prisma.sharedTitle.upsert({
    where: {
      fromUserId_toUserId_tmdbId_mediaType: { fromUserId: me, toUserId, tmdbId, mediaType },
    },
    create: {
      fromUserId: me,
      toUserId,
      tmdbId,
      mediaType,
      title,
      year: typeof body.year === "string" ? body.year : null,
      poster: typeof body.poster === "string" ? body.poster : null,
    },
    update: { createdAt: new Date(), seenAt: null },
  });

  // Push till mottagaren (lib/push respekterar notify_shares via data.type).
  // Fire-and-forget: en död token eller saknade APNS-env får aldrig fälla tipset.
  void (async () => {
    const sender = await prisma.profile.findUnique({
      where: { userId: me },
      select: { displayName: true, user: { select: { username: true } } },
    });
    const senderName = sender?.displayName ?? sender?.user?.username ?? "En vän";
    await sendPushToUser(toUserId, {
      title: "Nytt filmtips 🍿",
      body: `${senderName} tipsade dig om ${title}`,
      data: { type: "share_received", friendId: me },
    });
  })().catch(() => {});

  return NextResponse.json({ ok: true, message: "Tips skickat." });
}
