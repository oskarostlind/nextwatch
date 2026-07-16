// app/api/friends/list/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { touchLastActive } from "@/lib/lastActive";

type FriendsListUser = { id: string; username: string | null; displayName: string | null };

export async function GET() {
  try {
    const cookieStore = await cookies();
    const me = cookieStore.get("nw_uid")?.value ?? "";
    if (!me) return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });

    // Throttlad aktivitetsstämpel (~1/min) — driver "senast aktiv" på vänprofiler.
    touchLastActive(me);

    // Vänner (båda ordningar)
    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ userId: me }, { friendId: me }] },
      include: {
        user: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
        friend: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const friends = friendships.map((f) => {
      const other = f.userId === me ? f.friend : f.user;
      const otherUser: FriendsListUser = {
        id: other.id,
        username: other.username,
        displayName: other.profile?.displayName ?? null,
      };
      return {
        id: `${f.userId}_${f.friendId}`,
        userId: f.userId,
        friendId: f.friendId,
        other: otherUser,
        createdAt: f.createdAt,
      };
    });

    // Pending inkommande
    const pendingIn = await prisma.friendRequest.findMany({
      where: { toUserId: me, status: "pending" },
      include: {
        fromUser: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Pending utgående
    const pendingOut = await prisma.friendRequest.findMany({
      where: { fromUserId: me, status: "pending" },
      include: {
        toUser: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      ok: true,
      friends,
      pendingIn: pendingIn.map((r) => ({
        requestId: r.id,
        from: {
          id: r.fromUser.id,
          username: r.fromUser.username,
          displayName: r.fromUser.profile?.displayName ?? null,
        },
      })),
      pendingOut: pendingOut.map((r) => ({
        requestId: r.id,
        to: {
          id: r.toUser.id,
          username: r.toUser.username,
          displayName: r.toUser.profile?.displayName ?? null,
        },
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
