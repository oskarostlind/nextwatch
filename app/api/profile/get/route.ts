// app/api/profile/get/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value || null;
  if (!uid) return NextResponse.json({ ok: false, error: await apiMsg("noSession") }, { status: 401 });

  const prof = await prisma.profile.findUnique({
    where: { userId: uid },
    select: {
      userId: true,
      displayName: true,
      dob: true,
      region: true,
      locale: true,
      uiLanguage: true,
      favoriteGenres: true,
      dislikedGenres: true,
      providers: true,
      favoriteMovie: true,
      favoriteShow: true,
      updatedAt: true,
    },
  });

  if (!prof) return NextResponse.json({ ok: true, profile: null });

  return NextResponse.json({
    ok: true,
    profile: { ...prof, dob: prof.dob ? new Date(prof.dob).toISOString() : null },
  });
}
