// app/api/profile/exists/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";

export async function GET() {
  const uid = (await cookies()).get("nw_uid")?.value || null;
  // Tillfällig diagnostik (869e8huma) — se SessionPersistence.tsx. TA BORT sen.
  if (!uid) {
    console.log("[session-diag] profile/exists: ingen cookie → hasProfile=false");
    return NextResponse.json({ ok: true, hasProfile: false });
  }
  const profile = await prisma.profile.findUnique({ where: { userId: uid } });
  console.log(`[session-diag] profile/exists: uid=...${uid.slice(-6)} hasProfile=${!!profile}`);
  return NextResponse.json({ ok: true, hasProfile: !!profile });
}
