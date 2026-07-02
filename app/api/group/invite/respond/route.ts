// app/api/group/invite/respond/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

type Action = "accept" | "decline";
type Body = { id: string; action: Action };

type OkJoined = { ok: true; joined: string };
type OkPlain = { ok: true };
type Err = { ok: false; message: string };

function bad(message: string, status = 200) {
  return NextResponse.json({ ok: false, message } as Err, { status });
}

export async function POST(req: NextRequest) {
  const jar = await cookies(); // projektregel: alltid await cookies() i App Router (server)
  try {
    let body: Body | null = null;
    try {
      body = (await req.json()) as Body;
    } catch {
      return bad("Invalid JSON.", 400);
    }

    const userId = jar.get("nw_uid")?.value ?? null;
    if (!userId) return bad("No session.", 401);

    if (!body?.id || (body.action !== "accept" && body.action !== "decline")) {
      return bad("Missing or invalid 'id'/'action'.", 400);
    }

    // Hämta invite → den måste vara riktad till nuvarande användare och pending.
    const invite = await prisma.groupInvite.findFirst({
      where: { id: body.id, toUserId: userId, status: "pending" },
      select: {
        id: true,
        groupCode: true,
        status: true,
        fromUserId: true,
      },
    });

    if (!invite) {
      return bad("Invite not found or already handled.");
    }

    // Validera att gruppen finns (edge case: grupp raderad)
    const group = await prisma.group.findUnique({
      where: { code: invite.groupCode },
      select: { code: true },
    });
    if (!group) {
      // Markera som obsolet/declined och svara
      await prisma.groupInvite.update({
        where: { id: invite.id },
        data: { status: "declined", respondedAt: new Date() },
      });
      return bad("Group no longer exists.");
    }

    if (body.action === "decline") {
      await prisma.groupInvite.update({
        where: { id: invite.id },
        data: { status: "declined", respondedAt: new Date() },
      });
      return NextResponse.json({ ok: true } as OkPlain, { status: 200 });
    }

    // ACCEPT
    // 1) Gör användaren till medlem (idempotent via upsert på (group_code, user_id))
    await prisma.groupMember.upsert({
      where: { groupCode_userId: { groupCode: group.code, userId } },
      update: {},
      create: { groupCode: group.code, userId },
    });

    // 2) Uppdatera invite-status
    await prisma.groupInvite.update({
      where: { id: invite.id },
      data: { status: "accepted", respondedAt: new Date() },
    });

    // Notifiera den som bjöd in så att hen vet att gruppswipen kan börja.
    if (invite.fromUserId) {
      const accepter = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, profile: { select: { displayName: true } } },
      });
      const name = accepter?.profile?.displayName ?? accepter?.username ?? "Någon";
      await sendPushToUser(invite.fromUserId, {
        title: "Inbjudan accepterad",
        body: `${name} gick med i din grupp ${group.code} – dags att swipa!`,
        data: { type: "group_invite_accepted", groupCode: group.code },
      });
    }

    // 3) Sätt aktiv grupp-cookie på svaret så mottagaren ser gruppen i /group
    const res = NextResponse.json({ ok: true, joined: group.code } as OkJoined, { status: 200 });
    res.cookies.set("nw_group", group.code, {
      path: "/",
      maxAge: 60 * 60 * 24 * 14, // 14 dagar
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
    });
    return res;
  } catch (e: unknown) {
    console.error("invite/respond POST error:", e);
    return bad("Internal error.");
  }
}
