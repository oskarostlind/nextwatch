// app/api/group/common-watchlist/route.ts
//
// "Gemensamt i era watchlists": titlar som minst TVÅ gruppmedlemmar redan har
// sparat — ni vill ju redan se dem, ingen swipe behövs. Svar på frågan "vad
// händer när gruppen swipat klart?": det ni redan är överens om ligger här.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { tmdbGet } from "@/lib/tasteModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITEMS = 12;

type TmdbTitle = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
};

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!me) return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });

  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!code) return NextResponse.json({ ok: false, message: "Kod saknas." }, { status: 400 });

  // Authz: bara medlemmar får se gruppens gemensamma titlar.
  const members = await prisma.groupMember.findMany({
    where: { groupCode: code },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);
  if (!memberIds.includes(me)) {
    return NextResponse.json({ ok: false, message: "Inte medlem i gruppen." }, { status: 403 });
  }
  if (memberIds.length < 2) return NextResponse.json({ ok: true, memberCount: memberIds.length, items: [] });

  // Överlapp i DB:n: gruppera på titel, kräve ≥2 sparare. groupBy håller det
  // till EN query oavsett gruppstorlek.
  const overlaps = await prisma.watchlist.groupBy({
    by: ["tmdbId", "mediaType"],
    where: { userId: { in: memberIds } },
    _count: { userId: true },
    having: { userId: { _count: { gte: 2 } } },
    orderBy: { _count: { userId: "desc" } },
    take: MAX_ITEMS,
  });

  if (overlaps.length === 0) {
    return NextResponse.json({ ok: true, memberCount: memberIds.length, items: [] });
  }

  // Berika med TMDB (titel/år/poster) — cachade detaljanrop, max 12 st.
  const items = (
    await Promise.all(
      overlaps.map(async (o) => {
        const mediaType = o.mediaType as "movie" | "tv";
        const t = await tmdbGet<TmdbTitle>(
          mediaType === "movie" ? `/movie/${o.tmdbId}` : `/tv/${o.tmdbId}`,
          { language: "sv-SE" },
          "force-cache",
        ).catch(() => null);
        if (!t) return null;
        const date = mediaType === "movie" ? t.release_date : t.first_air_date;
        return {
          tmdbId: o.tmdbId,
          mediaType,
          title: (mediaType === "movie" ? t.title : t.name) ?? "Okänd titel",
          year: date && date.length >= 4 ? date.slice(0, 4) : null,
          poster: t.poster_path ? `https://image.tmdb.org/t/p/w342${t.poster_path}` : null,
          count: o._count.userId,
        };
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ ok: true, memberCount: memberIds.length, items });
}
