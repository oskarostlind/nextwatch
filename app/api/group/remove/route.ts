// app/api/group/remove/route.ts
// Skaparen tar bort en annan medlem ur gruppen. Speglar leave-städningen:
// medlemsraden, medlemmens röster, kvitterade matchningar och egna pending
// inbjudningar rensas, så inga spökröster ligger kvar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

type Ok = { ok: true; removed: true };
type Err = { ok: false; message: string };

export async function POST(req: NextRequest): Promise<NextResponse<Ok | Err>> {
  try {
    const jar = await cookies();
    const me = jar.get("nw_uid")?.value ?? "";
    const code = jar.get("nw_group")?.value ?? "";
    if (!me) return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
    if (!code) return NextResponse.json({ ok: false, message: "No active group." }, { status: 400 });

    const body = (await req.json().catch(() => null)) as { userId?: string } | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!userId) return NextResponse.json({ ok: false, message: "Missing userId." }, { status: 400 });

    // Endast skaparen får kicka. Att ta bort sig själv går via /leave.
    const group = await prisma.group.findUnique({ where: { code }, select: { createdBy: true } });
    if (!group) return NextResponse.json({ ok: false, message: "Group does not exist." }, { status: 404 });
    if (group.createdBy !== me) {
      return NextResponse.json({ ok: false, message: "Only the group owner can remove members." }, { status: 403 });
    }
    if (userId === me) {
      return NextResponse.json({ ok: false, message: "Use leave to remove yourself." }, { status: 400 });
    }

    const member = await prisma.groupMember.findUnique({
      where: { groupCode_userId: { groupCode: code, userId } },
      select: { userId: true },
    });
    if (!member) return NextResponse.json({ ok: false, message: "Not a member." }, { status: 404 });

    await prisma.$transaction([
      prisma.groupMember.deleteMany({ where: { groupCode: code, userId } }),
      prisma.groupVote.deleteMany({ where: { groupCode: code, userId } }),
      prisma.groupMatchSeen.deleteMany({ where: { groupCode: code, userId } }),
      prisma.groupInvite.deleteMany({ where: { groupCode: code, fromUserId: userId, status: "pending" } }),
    ]);

    return NextResponse.json({ ok: true, removed: true });
  } catch (e) {
    console.error("group/remove failed", e);
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
