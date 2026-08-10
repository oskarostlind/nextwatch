// app/api/friends/block/route.ts
//
// Blockering utan schemaändring: en rad i friend_requests med status
// "blocked" från blockeraren till den blockerade. Unik-indexet på
// (from_user_id, to_user_id) gör raden idempotent, och /api/friends/request
// vägrar skapa nya förfrågningar när en sådan rad finns i någon riktning.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const me = jar.get("nw_uid")?.value ?? "";
    if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

    let userId = "";
    let block = true;
    try {
      const body = (await req.json()) as { userId?: string; block?: boolean };
      userId = (body.userId ?? "").trim();
      if (typeof body.block === "boolean") block = body.block;
    } catch {
      /* ignore */
    }
    if (!userId) return NextResponse.json({ ok: false, message: "userId krävs." }, { status: 400 });
    if (userId === me) return NextResponse.json({ ok: false, message: "Ogiltig mottagare." }, { status: 400 });

    if (!block) {
      await prisma.friendRequest.deleteMany({
        where: { fromUserId: me, toUserId: userId, status: "blocked" },
      });
      return NextResponse.json({ ok: true, blocked: false });
    }

    await prisma.$transaction(async (tx) => {
      // Blockering innebär också att vänskapen upphör.
      await tx.friendship.deleteMany({
        where: {
          OR: [
            { userId: me, friendId: userId },
            { userId, friendId: me },
          ],
        },
      });
      await tx.friendRequest.deleteMany({
        where: {
          status: "pending",
          OR: [
            { fromUserId: me, toUserId: userId },
            { fromUserId: userId, toUserId: me },
          ],
        },
      });
      await tx.friendRequest.upsert({
        where: { fromUserId_toUserId: { fromUserId: me, toUserId: userId } },
        create: { fromUserId: me, toUserId: userId, status: "blocked", decidedAt: new Date() },
        update: { status: "blocked", decidedAt: new Date() },
      });
    });

    return NextResponse.json({ ok: true, blocked: true });
  } catch {
    return NextResponse.json({ ok: false, message: "Internt fel." }, { status: 500 });
  }
}
