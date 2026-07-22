// app/api/ratings/list/route.ts
//
// Listar användarens egna betygsatta titlar (Rating.rating satt, 1–10) för
// Betyg-fliken på /watchlist. Speglar mönstret i watchlist/list: hämta rader
// via Prisma och berika batchvis med TMDB (titel/poster/år). "seen"- och
// RATE_DISMISSED-rader utan betyg tas inte med.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tmdbFetch } from "@/lib/tmdbClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RatedCard = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  /** Användarens eget betyg 1–10. */
  userRating: number;
};

type TmdbTitle = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
};

const V4_TOKEN =
  process.env.TMDB_V4_TOKEN ??
  process.env.TMDB_v4_TOKEN ??
  process.env.TMDB_READ_TOKEN ??
  process.env.TMDB_TOKEN ??
  null;

const V3_KEY = process.env.TMDB_API_KEY ?? null;

async function tmdbGet<T>(path: string): Promise<T> {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (V4_TOKEN) {
    headers.Authorization = `Bearer ${V4_TOKEN}`;
  } else if (V3_KEY) {
    url.searchParams.set("api_key", V3_KEY);
  } else {
    throw new Error("TMDB credentials missing");
  }
  // Titelmetadata är stabil — dygnscache (samma resonemang som lib/watchlistCards).
  const res = await tmdbFetch(url.toString(), { headers, next: { revalidate: 60 * 60 * 24 } });
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return (await res.json()) as T;
}

export async function POST() {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, items: [], message: "Ingen session" }, { status: 401 });

    const rows = await prisma.rating.findMany({
      where: { userId: uid, rating: { not: null } },
      select: { tmdbId: true, mediaType: true, rating: true },
      orderBy: { decidedAt: "desc" },
      take: 200,
    });

    if (rows.length === 0) return NextResponse.json({ ok: true, items: [] });

    // Parallellt i stället för sekventiella 10-batchar (upp till 20 vänte-
    // omgångar för 200 betyg). Concurrency-taket i lib/tmdbClient håller
    // trycket nere — 200 samtidiga anrop gav 429:or som `.catch(() => null)`
    // nedan svalde, vilket tyst tömde delar av betygslistan.
    const results = await Promise.all(
      rows.map(async (r): Promise<RatedCard | null> => {
        const mediaType = r.mediaType as "movie" | "tv";
        const path = mediaType === "movie" ? `movie/${r.tmdbId}` : `tv/${r.tmdbId}`;
        const t = await tmdbGet<TmdbTitle>(path).catch(() => null);
        if (!t) return null; // titel borttagen från TMDB — hoppa över
        const title = mediaType === "movie" ? t.title ?? "" : t.name ?? "";
        const date = mediaType === "movie" ? t.release_date : t.first_air_date;
        return {
          id: `${mediaType}_${r.tmdbId}`,
          tmdbId: r.tmdbId,
          mediaType,
          title,
          year: date && date.length >= 4 ? date.slice(0, 4) : null,
          poster: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : null,
          userRating: r.rating as number,
        };
      })
    );
    const items = results.filter((it): it is RatedCard => it !== null);

    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: false, items: [], message: "Internt fel" }, { status: 500 });
  }
}
