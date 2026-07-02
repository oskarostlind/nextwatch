// app/api/friends/accept/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

type Ok = { ok: true; friendship?: { userId: string; friendId: string } };
type Err = { ok: false; message: string };

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

type Body = {
  requestId?: string;
  fromUserId?: string;
  fromUsername?: string;
};

type FriendRequestRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
};

type IdRow = { id: string };

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return json(401, { ok: false, message: "Ingen session." });

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, { ok: false, message: "Ogiltig JSON." });
    }

    const { requestId, fromUserId, fromUsername } = body;
    if (!requestId && !fromUserId && !fromUsername) {
      return json(400, {
        ok: false,
        message: "Ange 'requestId' eller 'fromUserId' eller 'fromUsername'.",
      });
    }

    // 1) Hitta pending friend request riktad till uid
    let pending: FriendRequestRow | null = null;

    if (requestId) {
      const rows = await prisma.$queryRaw<FriendRequestRow[]>`
      SELECT id, from_user_id, to_user_id, status
      FROM friend_requests
      WHERE id = (${requestId})::uuid AND to_user_id = ${uid} AND status = 'pending'
      LIMIT 1
    `;
      pending = rows[0] ?? null;
    } else if (fromUserId) {
    const rows = await prisma.$queryRaw<FriendRequestRow[]>`
      SELECT id, from_user_id, to_user_id, status
      FROM friend_requests
      WHERE from_user_id = ${fromUserId} AND to_user_id = ${uid} AND status = 'pending'
      LIMIT 1
    `;
    pending = rows[0] ?? null;
  } else {
    // fromUsername
    const users = await prisma.$queryRaw<IdRow[]>`
      SELECT id FROM users WHERE LOWER(username) = LOWER(${fromUsername ?? ""}) LIMIT 1
    `;
    const src = users[0]?.id ?? null;
    if (src) {
      const rows = await prisma.$queryRaw<FriendRequestRow[]>`
        SELECT id, from_user_id, to_user_id, status
        FROM friend_requests
        WHERE from_user_id = ${src} AND to_user_id = ${uid} AND status = 'pending'
        LIMIT 1
      `;
      pending = rows[0] ?? null;
    }
  }

  if (!pending) {
    // Idempotens: om förfrågan redan accepterats (t.ex. race med request auto-accept), kolla om vänskap finns
    let otherUserId: string | null = null;
    if (requestId) {
      const existingReq = await prisma.$queryRaw<{ from_user_id: string }[]>`
        SELECT from_user_id FROM friend_requests WHERE id = (${requestId})::uuid AND to_user_id = ${uid} LIMIT 1
      `;
      otherUserId = existingReq[0]?.from_user_id ?? null;
    } else if (fromUserId) {
      otherUserId = fromUserId;
    } else if (fromUsername != null && fromUsername !== "") {
      const users = await prisma.$queryRaw<IdRow[]>`
        SELECT id FROM users WHERE LOWER(username) = LOWER(${fromUsername}) LIMIT 1
      `;
      otherUserId = users[0]?.id ?? null;
    }
    if (otherUserId) {
      const a = uid < otherUserId ? uid : otherUserId;
      const b = uid < otherUserId ? otherUserId : uid;
      const existing = await prisma.friendship.findUnique({
        where: { userId_friendId: { userId: a, friendId: b } },
        select: { userId: true },
      });
      if (existing) return json(200, { ok: true, friendship: { userId: a, friendId: b } });
    }
    return json(404, { ok: false, message: "Ingen väntande förfrågan hittades." });
  }

  // 2) Markera som accepterad (id är UUID i DB)
  await prisma.$executeRaw`
    UPDATE friend_requests
    SET status = 'accepted', decided_at = NOW()
    WHERE id = (${pending.id})::uuid
  `;

  // 3) Skapa vänskap kanoniskt (a=min, b=max)
  const a = pending.from_user_id < pending.to_user_id ? pending.from_user_id : pending.to_user_id;
  const b = pending.from_user_id < pending.to_user_id ? pending.to_user_id : pending.from_user_id;

  await prisma.$executeRaw`
    INSERT INTO friendships (user_id, friend_id, created_at)
    VALUES (${a}, ${b}, NOW())
    ON CONFLICT (user_id, friend_id) DO NOTHING
  `;

  const accepter = await prisma.user.findUnique({
    where: { id: uid },
    select: { username: true, profile: { select: { displayName: true } } },
  });
  const accepterName =
    accepter?.profile?.displayName ?? accepter?.username ?? "Någon";
  await sendPushToUser(pending.from_user_id, {
    title: "Vänförfrågan accepterad",
    body: `${accepterName} accepterade din vänförfrågan`,
    data: { type: "friend_accepted", userId: uid },
  });

  return json(200, { ok: true, friendship: { userId: a, friendId: b } });
  } catch {
    return NextResponse.json({ ok: false, message: "Ett fel uppstod." }, { status: 500 });
  }
}
