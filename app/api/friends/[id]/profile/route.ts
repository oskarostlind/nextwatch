// app/api/friends/[id]/profile/route.ts
//
// Publik "miniprofil" för en vän: visningsnamn, favoritgenrer, en härledd
// topp-3 (deras senaste likes) och senast aktiv. Svaras BARA om anroparen och
// målet faktiskt är vänner (authz) — inga profildata läcker till främlingar.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { tmdbDetails, type TmdbType } from "@/lib/tmdbDetails";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
  if (!id || id === me) return NextResponse.json({ ok: false, message: "Ogiltig profil." }, { status: 400 });

  // Måste vara vänner (båda riktningar).
  const friendship = await prisma.friendship.findFirst({
    where: { OR: [{ userId: me, friendId: id }, { userId: id, friendId: me }] },
    select: { userId: true },
  });
  if (!friendship) {
    return NextResponse.json({ ok: false, message: "Ni är inte vänner." }, { status: 403 });
  }

  const [user, profile, likes] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { username: true, lastActiveAt: true } }),
    prisma.profile.findUnique({
      where: { userId: id },
      select: { displayName: true, avatarId: true, favoriteGenres: true, locale: true },
    }),
    prisma.rating.findMany({
      where: { userId: id, decision: "like" },
      orderBy: { decidedAt: "desc" },
      take: 3,
      select: { tmdbId: true, mediaType: true },
    }),
  ]);

  if (!user || !profile) {
    return NextResponse.json({ ok: false, message: "Profilen saknas." }, { status: 404 });
  }

  // Vännens topplista visas för DEN SOM TITTAR — språket ska följa
  // betraktarens val, inte vad vännen råkar ha valt.
  const locale = await tmdbLanguageFromCookies();
  const top3 = (
    await Promise.all(
      likes.map((l) =>
        tmdbDetails(l.mediaType as TmdbType, l.tmdbId, locale).catch(() => null),
      ),
    )
  )
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({
      tmdbId: t.tmdbId,
      tmdbType: t.tmdbType,
      title: t.title,
      year: t.year ?? null,
      poster: t.poster ? `https://image.tmdb.org/t/p/w342${t.poster}` : null,
    }));

  return NextResponse.json({
    ok: true,
    profile: {
      id,
      displayName: profile.displayName ?? user.username ?? "Okänd",
      username: user.username,
      avatarId: profile.avatarId ?? null,
      genres: profile.favoriteGenres ?? [],
      top3,
      lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
    },
  });
}
