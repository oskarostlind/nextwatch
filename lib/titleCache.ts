// lib/titleCache.ts
//
// Lokal cache av TMDB-metadata per titel: namn, år, poster, betyg, popularitet
// och genrer. Den datan ändras i praktiken aldrig för ett givet tmdbId, så den
// behöver inte hämtas om varje gång en lista ritas.
//
// Varför det är värt något: /api/watchlist/list och /api/ratings/list finns
// just för att berika DB-rader med den här metadatan. För en watchlist på 240
// titlar är det 240 TMDB-uppslag server-side (cachade sedan #41, men fortfarande
// hopsättning) och en stor payload. Med cachen varm räcker DB-raderna.
//
// SÄKERHETSEGENSKAPEN som gör det här ofarligt, till skillnad från `nw_seen_ids`:
// cachen bestämmer aldrig VILKA titlar som finns i en lista — det gör alltid
// DB-raderna från servern. Cachen dekorerar bara rader som redan kommit från
// servern. En inaktuell cache kan därför göra en titel fullösning, aldrig få den
// att försvinna eller dyka upp. `nw_seen_ids` hade motsatt roll: den avgjorde
// medlemskap, och när den drev isär försvann innehåll.

import { getCached, setCached } from "@/lib/clientCache";

export type CachedTitle = {
  title: string;
  year: string | null;
  poster: string | null;
  voteAverage: number | null;
  popularity: number | null;
  genreIds: number[];
  /**
   * TMDB keyword-id:n (sub-genre-filtret, lib/subgenres.ts). Optional — inte
   * `number[]` — så att en cache-post skriven FÖRE detta fält fanns kan
   * skiljas från en post som verkligen har noll keywords: `undefined` betyder
   * "okänt, hämta om", tom array betyder "hämtat, titeln har inga". Se
   * refetchWatchlist/refetchRated i app/watchlist/WatchlistClient.tsx.
   */
  keywordIds?: number[];
};

/** `movie_123` / `tv_456` — samma nyckelformat som resten av appen. */
export type TitleKey = string;

const CACHE_KEY = "title_meta";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Tak så blobben inte växer obegränsat. Vid överskridande kastas de äldst
 * inlagda (Object-nycklar bevarar insättningsordning för strängnycklar).
 */
const MAX_ENTRIES = 3000;

type Blob = Record<TitleKey, CachedTitle>;

export function titleKey(mediaType: "movie" | "tv", tmdbId: number): TitleKey {
  return `${mediaType}_${tmdbId}`;
}

export function readTitleCache(): Blob {
  return getCached<Blob>(CACHE_KEY) ?? {};
}

/**
 * Lägger till/uppdaterar poster. Skrivs som en blob i stället för en nyckel per
 * titel: en JSON-parse i stället för hundratals localStorage-anrop.
 */
export function putTitles(entries: Record<TitleKey, CachedTitle>): void {
  const keys = Object.keys(entries);
  if (keys.length === 0) return;
  const merged: Blob = { ...readTitleCache(), ...entries };

  const allKeys = Object.keys(merged);
  if (allKeys.length > MAX_ENTRIES) {
    const trimmed: Blob = {};
    for (const k of allKeys.slice(allKeys.length - MAX_ENTRIES)) trimmed[k] = merged[k];
    setCached(CACHE_KEY, trimmed, TTL_MS);
    return;
  }
  setCached(CACHE_KEY, merged, TTL_MS);
}
