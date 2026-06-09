// app/api/profile/status/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value;
  if (!uid) {
    return NextResponse.json({ ok: true, hasSession: false, hasUser: false });
  }

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, emailVerified: true, passwordHash: true, appleSub: true },
  });
  if (!user) {
    return NextResponse.json({ ok: true, hasSession: false, hasUser: false });
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: uid },
    select: { userId: true, displayName: true },
  });

  const hasProfile = !!profile;
  const onboardingDone = hasProfile && !!profile?.displayName;
  const hasAccount = Boolean(user.passwordHash || user.appleSub);

  return NextResponse.json({
    ok: true,
    hasSession: true,
    hasUser: true,
    emailVerified: !!user.emailVerified,
    hasProfile,
    onboardingDone,
    hasAccount,
  });
}
