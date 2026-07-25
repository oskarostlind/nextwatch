// app/api/group/leave/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const store = await cookies();
    const me = store.get("nw_uid")?.value ?? "";
    const code = store.get("nw_group")?.value ?? "";
    if (!me) return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });

    if (code) {
      // Ta bort medlemskapet OCH allt den här användaren lämnat efter sig i
      // gruppen: LIKE/DISLIKE-röster, kvitterade matchningar och egna pending
      // inbjudningar. Tidigare raderades bara medlemsraden — rösterna låg kvar
      // och gav spökmatchningar när gruppen tömdes eller återanvändes.
      await prisma.$transaction([
        prisma.groupMember.deleteMany({ where: { groupCode: code, userId: me } }),
        prisma.groupVote.deleteMany({ where: { groupCode: code, userId: me } }),
        prisma.groupMatchSeen.deleteMany({ where: { groupCode: code, userId: me } }),
        prisma.groupInvite.deleteMany({
          where: { groupCode: code, fromUserId: me, status: "pending" },
        }),
      ]);

      // Blev gruppen tom? Riv hela gruppen — annars ligger den kvar som en
      // spökgrupp med gamla röster (cron/cleanup gallrar den först efter ett
      // dygns inaktivitet). onDelete: Cascade tar med resterande barn-rader.
      const remaining = await prisma.groupMember.count({ where: { groupCode: code } });
      if (remaining === 0) {
        await prisma.group.deleteMany({ where: { code } });
      }
    }

    const res = NextResponse.json({ ok: true, left: true });
    // ta bort cookie
    res.cookies.set({
      name: "nw_group",
      value: "",
      path: "/",
      expires: new Date(0),
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, message: "Internal error." }, { status: 500 });
  }
}
