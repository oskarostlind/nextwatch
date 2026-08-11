// app/api/friends/list/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma, withDbRetry } from "@/lib/prisma";
import { touchLastActive } from "@/lib/lastActive";

type FriendsListUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
};

export async function GET() {
  try {
    const cookieStore = await cookies();
    const me = cookieStore.get("nw_uid")?.value ?? "";
    if (!me) return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });

    // Throttlad aktivitetsstämpel (~1/min) — driver "senast aktiv" på vänprofiler.
    touchLastActive(me);

    // Endpointen pollas var 5–15:e sekund (lib/socialStore.ts) — kör de tre
    // oberoende queriesarna i EN parallell våg i stället för seriellt, så
    // routen kostar en Neon-rundresa i stället för tre. withDbRetry fångar
    // Neon-kallstart (P1001) så pollen inte visar fel i onödan.
    const [friendships, pendingIn, pendingOut] = await withDbRetry(() =>
      Promise.all([
        // Vänner (båda ordningar)
        prisma.friendship.findMany({
          where: { OR: [{ userId: me }, { friendId: me }] },
          include: {
            user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
            friend: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
          },
          orderBy: { createdAt: "desc" },
        }),
        // Pending inkommande
        prisma.friendRequest.findMany({
          where: { toUserId: me, status: "pending" },
          include: {
            fromUser: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
          },
          orderBy: { createdAt: "desc" },
        }),
        // Pending utgående
        prisma.friendRequest.findMany({
          where: { fromUserId: me, status: "pending" },
          include: {
            toUser: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ]),
    );

    const friends = friendships.map((f) => {
      const other = f.userId === me ? f.friend : f.user;
      const otherUser: FriendsListUser = {
        id: other.id,
        username: other.username,
        displayName: other.profile?.displayName ?? null,
        avatarId: other.profile?.avatarId ?? null,
      };
      return {
        id: `${f.userId}_${f.friendId}`,
        userId: f.userId,
        friendId: f.friendId,
        other: otherUser,
        createdAt: f.createdAt,
      };
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
          avatarId: r.fromUser.profile?.avatarId ?? null,
        },
      })),
      pendingOut: pendingOut.map((r) => ({
        requestId: r.id,
        to: {
          id: r.toUser.id,
          username: r.toUser.username,
          displayName: r.toUser.profile?.displayName ?? null,
          avatarId: r.toUser.profile?.avatarId ?? null,
        },
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
