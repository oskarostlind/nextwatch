// app/api/profile/exists/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";

export async function GET() {
  const uid = (await cookies()).get("nw_uid")?.value || null;
  // Tillfällig diagnostik (869e8huma) — se SessionPersistence.tsx. TA BORT sen.
  if (!uid) {
    console.log("[session-diag] profile/exists: ingen cookie → hasProfile=false");
    return NextResponse.json({ ok: true, hasProfile: false, authed: false });
  }
  // authed speglar EXAKT landningens redirect-villkor (app/page.tsx): verifierat
  // konto med lösen/Apple OCH profil. SessionPersistence använder det för att
  // veta om en fullt inloggad användare felaktigt fastnat på landningen (SSR
  // hann inte se cookien vid kallstart) och ska laddas om in i appen.
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: {
      emailVerified: true,
      passwordHash: true,
      appleSub: true,
      profile: { select: { userId: true } },
    },
  });
  const hasProfile = Boolean(user?.profile);
  const authed = Boolean(user?.emailVerified && (user?.passwordHash || user?.appleSub) && user?.profile);
  console.log(`[session-diag] profile/exists: uid=...${uid.slice(-6)} hasProfile=${hasProfile} authed=${authed}`);
  return NextResponse.json({ ok: true, hasProfile, authed });
}
