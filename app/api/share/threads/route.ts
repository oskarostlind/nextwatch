// app/api/share/threads/route.ts — trådlista för filmchatten: en rad per vän
// man utbytt tips med (senaste tipset + antal olästa inkommande).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  // Alla tips där jag är part, nyast först. take-bounded: 200 räcker gott för
  // en trådlista och håller svaret litet även för flitiga tipsare.
  const rows = await prisma.sharedTitle.findMany({
    where: { OR: [{ fromUserId: me }, { toUserId: me }] },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      fromUserId: true,
      toUserId: true,
      title: true,
      seenAt: true,
      createdAt: true,
    },
  });

  // Gruppera per motpart i JS — antalet rader är redan bounded.
  type Thread = { friendId: string; lastTitle: string; lastAt: string; unseen: number; lastFromMe: boolean };
  const byFriend = new Map<string, Thread>();
  for (const r of rows) {
    const friendId = r.fromUserId === me ? r.toUserId : r.fromUserId;
    const existing = byFriend.get(friendId);
    if (!existing) {
      byFriend.set(friendId, {
        friendId,
        lastTitle: r.title,
        lastAt: r.createdAt.toISOString(),
        unseen: r.toUserId === me && r.seenAt === null ? 1 : 0,
        lastFromMe: r.fromUserId === me,
      });
    } else if (r.toUserId === me && r.seenAt === null) {
      existing.unseen += 1;
    }
  }

  if (byFriend.size === 0) return NextResponse.json({ ok: true, threads: [] });

  // Namn + avatar för motparterna i EN query.
  const friendIds = Array.from(byFriend.keys());
  const users = await prisma.user.findMany({
    where: { id: { in: friendIds } },
    select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    ok: true,
    threads: Array.from(byFriend.values()).map((t) => {
      const u = userById.get(t.friendId);
      return {
        ...t,
        username: u?.username ?? null,
        displayName: u?.profile?.displayName ?? null,
        avatarId: u?.profile?.avatarId ?? null,
      };
    }),
  });
}
