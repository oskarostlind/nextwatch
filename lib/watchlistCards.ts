// lib/watchlistCards.ts
//
// Bygger watchlist-korten (DB-rader + TMDB-berikning) för en användare.
// Delas av app/api/watchlist/list (klientens refetch) och app/watchlist/page.tsx
// (SSR). Sidan anropade tidigare API-routen via intern HTTP-fetch med en
// återuppbyggd cookie-header — det gick sönder när nw_uid signerades:
// middleware normaliserar request-cookien till bare-uid, sidans vidarebefordrade
// cookie saknade därmed signatur, och den interna requesten fick en NY anonym
// identitet → tom watchlist trots att Betyg-fliken (klient-fetch med riktig
// cookie) såg allt. Direktanrop tar bort hela felklassen.

import prisma from "@/lib/prisma";

export type WatchlistCard = {
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

function normalize(x: TmdbTitle, mediaType: "movie" | "tv", addedAt: Date): WatchlistCard {
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

export async function buildWatchlistCards(uid: string): Promise<WatchlistCard[]> {
  const rows = await prisma.watchlist.findMany({
    where: { userId: uid },
    select: { tmdbId: true, mediaType: true, addedAt: true },
    orderBy: { addedAt: "desc" },
  });

  if (rows.length === 0) return [];

  const BATCH_SIZE = 10;
  const items: WatchlistCard[] = [];
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

  return items;
}
