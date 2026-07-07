// app/api/watchlist/list/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Card = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  rating?: number | null;
  addedAt: string;
  voteAverage: number | null;
  popularity: number | null;
  genreIds: number[];
};

type TmdbTitle = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  vote_average?: number | null;
  popularity?: number | null;
  genres?: { id: number }[];
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
  const res = await fetch(url.toString(), { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return (await res.json()) as T;
}

function normalize(
  x: TmdbTitle,
  mediaType: "movie" | "tv",
  addedAt: Date
): Card {
  const title = mediaType === "movie" ? x.title ?? "" : x.name ?? "";
  const date = mediaType === "movie" ? x.release_date : x.first_air_date;
  const year = date && date.length >= 4 ? date.slice(0, 4) : null;
  return {
    id: `${mediaType}_${x.id}`,
    tmdbId: x.id,
    mediaType,
    title,
    year,
    poster: x.poster_path ? `https://image.tmdb.org/t/p/w500${x.poster_path}` : null,
    rating: typeof x.vote_average === "number" ? x.vote_average : null,
    addedAt: addedAt.toISOString(),
    voteAverage: typeof x.vote_average === "number" ? x.vote_average : null,
    popularity: typeof x.popularity === "number" ? x.popularity : null,
    genreIds: (x.genres ?? []).map((g) => g.id),
  };
}

export async function POST() {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, items: [], message: "Ingen session" }, { status: 401 });

    const rows = await prisma.watchlist.findMany({
      where: { userId: uid },
      select: { tmdbId: true, mediaType: true, addedAt: true },
      orderBy: { addedAt: "desc" },
    });

    if (rows.length === 0) return NextResponse.json({ ok: true, items: [] });

    const BATCH_SIZE = 10;
    const items: Card[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (r) => {
          const mediaType = r.mediaType as "movie" | "tv";
          const path = mediaType === "movie" ? `movie/${r.tmdbId}` : `tv/${r.tmdbId}`;
          const t = await tmdbGet<TmdbTitle>(path).catch(() => null);
          if (!t) return null;
          return normalize(t, mediaType, r.addedAt);
        })
      );
      for (const it of batchResults) if (it) items.push(it);
    }

    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: false, items: [], message: "Internt fel" }, { status: 500 });
  }
}
