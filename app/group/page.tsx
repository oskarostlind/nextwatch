// app/group/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import GroupClient from "./GroupClient";

export type PublicMember = {
  userId: string;
  username: string | null;
  displayName: string | null;
  joinedAt?: string;
};

export type FriendsListUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
};

export type FriendsInitial = {
  friends: FriendsListUser[];
  pendingIn: { requestId: string; from: FriendsListUser }[];
  pendingOut: { requestId: string; to: FriendsListUser }[];
};

export type GroupInitial = {
  code: string | null;
  members: PublicMember[];
  region?: string;
  meUserId: string | null;
  friends: FriendsInitial;
};

const EMPTY_FRIENDS: FriendsInitial = { friends: [], pendingIn: [], pendingOut: [] };

async function loadFriendsInitial(me: string | null): Promise<FriendsInitial> {
  if (!me) return EMPTY_FRIENDS;

  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ userId: me }, { friendId: me }] },
    include: {
      user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
      friend: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const friends = friendships.map((f) => {
    const other = f.userId === me ? f.friend : f.user;
    return {
      id: other.id,
      username: other.username,
      displayName: other.profile?.displayName ?? null,
      avatarId: other.profile?.avatarId ?? null,
    };
  });

  const pendingIn = await prisma.friendRequest.findMany({
    where: { toUserId: me, status: "pending" },
    include: {
      fromUser: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const pendingOut = await prisma.friendRequest.findMany({
    where: { fromUserId: me, status: "pending" },
    include: {
      toUser: { select: { id: true, username: true, profile: { select: { displayName: true, avatarId: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
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
  };
}

export default async function GroupPage() {
  const cookieStore = await cookies();
  const me = cookieStore.get("nw_uid")?.value ?? null;
  const code = cookieStore.get("nw_group")?.value ?? null;
  const friends = await loadFriendsInitial(me);

  if (!code) {
    const initial: GroupInitial = { code: null, members: [], meUserId: me, friends };
    return <GroupClient initial={initial} />;
  }

  const rows = await prisma.$queryRaw<
    Array<{ user_id: string; joined_at: Date; username: string | null; display_name: string | null }>
  >`
    SELECT gm.user_id, gm.joined_at, p.username, pr.display_name
    FROM group_members gm
    LEFT JOIN users p   ON p.id = gm.user_id
    LEFT JOIN profiles pr ON pr.user_id = gm.user_id
    WHERE gm.group_code = ${code}
    ORDER BY gm.joined_at ASC
  `;

  const initial: GroupInitial = {
    code,
    meUserId: me,
    members: rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      joinedAt: r.joined_at.toISOString(),
    })),
    friends,
  };

  return <GroupClient initial={initial} />;
}
