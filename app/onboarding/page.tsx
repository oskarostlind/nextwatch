// app/onboarding/page.tsx
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import Client from "./page_client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Regler: alltid await cookies() i App Router (server)
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;

  // Sign in with Apple lämnar namnet EN gång. /api/auth/apple stoppar det i
  // nw_apple_name; här förifylls det så att en Apple-användare aldrig behöver
  // skriva in namn/e-post som AuthenticationServices redan gett oss
  // (App Store guideline 4).
  const cookieName = jar.get("nw_apple_name")?.value?.trim() || null;

  let dbName: string | null = null;
  let hasAccount = false;

  if (uid) {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: {
        appleSub: true,
        passwordHash: true,
        profile: { select: { displayName: true } },
      },
    });
    hasAccount = Boolean(user?.appleSub || user?.passwordHash);
    dbName = user?.profile?.displayName?.trim() || null;
  }

  // Ingen extra rubrik här – klienten står för UI:t.
  return <Client initialName={dbName ?? cookieName ?? ""} hasAccount={hasAccount} />;
}
