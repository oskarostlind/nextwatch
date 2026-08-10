// app/api/friends/request/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

type ApiOk = { ok: true; requestId: string };
type ApiErr = { ok: false; message: string };

function json(body: ApiOk | ApiErr, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies(); // App Router: alltid await
    const me = cookieStore.get("nw_uid")?.value ?? "";
    if (!me) return json({ ok: false, message: "Not authenticated." }, { status: 401 });

    // Minimal, typad validering utan externa deps
    let toUserId = "";
    try {
      const body = (await req.json()) as unknown;
      if (typeof body === "object" && body && "toUserId" in (body as Record<string, unknown>)) {
        const v = (body as Record<string, unknown>)["toUserId"];
        if (typeof v === "string" && v.trim().length > 0) toUserId = v.trim();
      }
    } catch {
      /* ignore */
    }
    if (!toUserId) return json({ ok: false, message: "toUserId required" }, { status: 400 });
    if (toUserId === me) return json({ ok: false, message: "Cannot add yourself." }, { status: 400 });

    // Båda användarna måste finnas
    const [fromUser, toUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: me }, select: { id: true, username: true } }),
      prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } }),
    ]);
    if (!fromUser || !toUser) return json({ ok: false, message: "User not found." }, { status: 404 });

    // Redan vänner?
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: me, friendId: toUserId },
          { userId: toUserId, friendId: me },
        ],
      },
      select: { userId: true },
    });
    if (friendship) return json({ ok: true, requestId: "already_friends" });

    // Blockering i någon riktning stoppar nya förfrågningar (App Store 1.2).
    // Blockeringen lagras som en friend_requests-rad med status "blocked".
    const blocked = await prisma.friendRequest.findFirst({
      where: {
        status: "blocked",
        OR: [
          { fromUserId: me, toUserId },
          { fromUserId: toUserId, toUserId: me },
        ],
      },
      select: { id: true },
    });
    if (blocked) {
      return json({ ok: false, message: "Det går inte att skicka en förfrågan till den här användaren." }, { status: 403 });
    }

    // Pending i någon riktning?
    const existing = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { fromUserId: me, toUserId, status: "pending" },
          { fromUserId: toUserId, toUserId: me, status: "pending" },
        ],
      },
      select: { id: true, fromUserId: true, toUserId: true },
    });

    if (existing) {
      // Om motparten redan skickat → auto-accept & skapa friendship
      if (existing.fromUserId === toUserId && existing.toUserId === me) {
        await prisma.$transaction(async (tx) => {
          await tx.friendRequest.update({
            where: { id: existing.id },
            data: { status: "accepted", decidedAt: new Date() },
          });

          // Normalisera ordning i friendships (userId < friendId)
          const a = me < toUserId ? me : toUserId;
          const b = me < toUserId ? toUserId : me;

          await tx.friendship.upsert({
            where: { userId_friendId: { userId: a, friendId: b } },
            update: {},
            create: { userId: a, friendId: b },
          });
        });
      }
      return json({ ok: true, requestId: existing.id });
    }

    // Skapa ny pending (idempotent vid unique-conflict)
    try {
      const fr = await prisma.friendRequest.create({
        data: { fromUserId: me, toUserId, status: "pending" },
        select: { id: true },
      });
      await sendPushToUser(toUserId, {
        title: "Ny vänförfrågan",
        body: `${fromUser.username ?? "Någon"} vill bli vän med dig`,
        data: { type: "friend_request", fromUserId: me },
      });
      return json({ ok: true, requestId: fr.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate key") || msg.includes("23505")) {
        const fr = await prisma.friendRequest.findFirst({
          where: { fromUserId: me, toUserId },
          select: { id: true, status: true },
        });
        if (fr) {
          if (fr.status !== "pending") {
            await prisma.friendRequest.update({
              where: { id: fr.id },
              data: { status: "pending", decidedAt: null },
            });
            await sendPushToUser(toUserId, {
              title: "Ny vänförfrågan",
              body: `${fromUser.username ?? "Någon"} vill bli vän med dig`,
              data: { type: "friend_request", fromUserId: me },
            });
          }
          return json({ ok: true, requestId: fr.id });
        }
        return json({ ok: true, requestId: "pending" });
      }
      return json({ ok: false, message: "Internal error." }, { status: 500 });
    }
  } catch {
    return json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
