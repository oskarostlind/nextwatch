import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { sessionCookieOpts } from "../../../../lib/cookies";
import { signUid, verifyUid } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    // Denna route är undantagen från middleware, så cookien är fortfarande i
    // signerad form här — verifiera själv i stället för att lita på råvärdet.
    let uid = await verifyUid(cookieStore.get("nw_uid")?.value);

    if (!uid) {
      uid = newId();
      await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid } });
      const res = NextResponse.json({ ok: true, userId: uid, hasProfile: false });
      res.cookies.set("nw_uid", await signUid(uid), sessionCookieOpts(60 * 60 * 24 * 365, true));
      return res;
    }

    await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid } });
    const profile = await prisma.profile.findUnique({ where: { userId: uid } });
    return NextResponse.json({ ok: true, userId: uid, hasProfile: !!profile });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
