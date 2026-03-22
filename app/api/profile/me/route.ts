// app/api/profile/me/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    const profile = await prisma.profile.findUnique({
      where: { userId: uid },
      select: {
        userId: true,
        displayName: true,
        region: true,
        locale: true,
        uiLanguage: true,
        providers: true,
        favoriteMovie: true,
        favoriteShow: true,
        favoriteGenres: true,
        dislikedGenres: true,
        dob: true,
        user: { select: { username: true } },
      },
    });

    if (!profile) {
      return NextResponse.json({ ok: true, profile: null });
    }

    const { user, ...rest } = profile;
    return NextResponse.json({
      ok: true,
      profile: { ...rest, username: user?.username ?? null },
    });
  } catch (err) {
    console.error("[profile/me] error:", err);
    return NextResponse.json({ ok: false, message: "Kunde inte läsa profil." }, { status: 500 });
  }
}
