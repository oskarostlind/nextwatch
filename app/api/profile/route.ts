// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import prisma from "../../../lib/prisma";
import { Prisma } from "@prisma/client";
import { isValidAvatarId } from "@/lib/avatars";
import { sanitizeKeywordIds } from "@/lib/groupSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstAcceptLanguage(h: string | null): string | null {
  if (!h) return null;
  const first = h.split(",")[0]?.trim();
  return first || null;
}

async function inferRegionAndLocale(): Promise<{ region: string; locale: string }> {
  const jar = await cookies();
  const hdr = await headers();
  const ipCountry = hdr.get("x-vercel-ip-country");
  const acceptLang = firstAcceptLanguage(hdr.get("accept-language"));

  const region =
    jar.get("nw_region")?.value ||
    (ipCountry && /^[A-Z]{2}$/.test(ipCountry) ? ipCountry : null) ||
    "SE";

  const locale =
    jar.get("nw_locale")?.value ||
    (acceptLang && /^[a-z]{2}(-[A-Z]{2})?$/.test(acceptLang) ? acceptLang : null) ||
    "sv-SE";

  return { region, locale };
}

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value || null;
  if (!uid) return NextResponse.json({ ok: false, error: "No session" }, { status: 401 });

  const prof = await prisma.profile.findUnique({
    where: { userId: uid },
    select: {
      userId: true,
      displayName: true,
      avatarId: true,
      dob: true,
      region: true,
      locale: true,
      uiLanguage: true,
      favoriteGenres: true,
      dislikedGenres: true,
      favoriteKeywordIds: true,
      providers: true,
      favoriteMovie: true,
      favoriteShow: true,
      updatedAt: true,
      user: { select: { username: true } },
    },
  });

  if (!prof) return NextResponse.json({ ok: true, profile: null });

  const dob = prof.dob ? new Date(prof.dob).toISOString() : null;
  const { user, ...rest } = prof;

  return NextResponse.json({
    ok: true,
    profile: { ...rest, dob, username: user?.username ?? null },
  });
}

export async function PUT(req: Request) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value || null;
  if (!uid) return NextResponse.json({ ok: false, error: "No session" }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;

  const s = (x: unknown): string | null => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
  const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

  const displayName = s(body.displayName);
  const dobStr = s(body.dob);
  // Frivilligt val ur förvalda biblioteket: giltigt id sätter, explicit null
  // rensar, utelämnat fält lämnar orört. Okända id:n ignoreras tyst.
  const avatarId: string | null | undefined =
    body.avatarId === null ? null : isValidAvatarId(body.avatarId) ? body.avatarId : undefined;
  const favoriteGenres = arr(body.favoriteGenres);
  const dislikedGenres = arr(body.dislikedGenres);
  const favoriteKeywordIds = sanitizeKeywordIds(body.favoriteKeywordIds) ?? [];
  const providers = arr(body.providers);
  const favMovie = (body.favoriteMovie ?? null) as Prisma.InputJsonValue | null;
  const favShow = (body.favoriteShow ?? null) as Prisma.InputJsonValue | null;

  const { region, locale } = await inferRegionAndLocale();
  const uiLanguage = s(body.uiLanguage) ?? (locale.split("-")[0] || "sv");

  const existing = await prisma.profile.findUnique({ where: { userId: uid } });

  if (existing) {
    const updated = await prisma.profile.update({
      where: { userId: uid },
      data: {
        displayName: displayName ?? undefined,
        avatarId,
        dob: dobStr ? new Date(dobStr) : undefined,
        uiLanguage,
        region,
        locale,
        favoriteGenres,
        dislikedGenres,
        favoriteKeywordIds,
        providers,
        favoriteMovie: (favMovie ?? undefined) as Prisma.InputJsonValue | undefined,
        favoriteShow: (favShow ?? undefined) as Prisma.InputJsonValue | undefined,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({
      ok: true,
      profile: { ...updated, dob: updated.dob ? updated.dob.toISOString() : null },
    });
  }

  if (!displayName || !dobStr) {
    return NextResponse.json({ ok: false, error: "displayName and dob required" }, { status: 400 });
  }

  const created = await prisma.profile.create({
    data: {
      userId: uid,
      displayName,
      avatarId: avatarId ?? null,
      dob: new Date(dobStr),
      uiLanguage,
      region,
      locale,
      favoriteGenres,
      dislikedGenres,
      favoriteKeywordIds,
      providers,
      favoriteMovie: favMovie as Prisma.InputJsonValue,
      favoriteShow: favShow as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    profile: { ...created, dob: created.dob ? created.dob.toISOString() : null },
  });
}
