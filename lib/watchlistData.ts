// lib/watchlistData.ts
//
// Hämtningen av watchlisten och betygslistan, bruten ut ur
// app/watchlist/WatchlistClient.tsx så att den har EN implementation.
//
// Bakgrunden är förladdningen: WatchlistPreloader (monterad i AppShell) fyller
// cachen redan vid appstart så att flikbytet aldrig möter ett skelett. Att låta
// den ha en egen kopia av hämtningen vore att bygga in exakt de fällor som
// kommentarerna nedan beskriver — ENRICH_CHUNK-uppdelningen och
// `keywordIds === undefined`-självläkningen — i två filer som sedan glider isär.
// Därför bor logiken här och både fliken och förladdaren anropar samma funktion.
//
// Funktionerna är best-effort: de returnerar `null` när något gick fel (401 för
// utloggad, nätverk nere, trasigt svar) och låter anroparen behålla det den
// redan visar. De skriver alltid klientcachen vid lyckad hämtning, så cachen
// självläker efter mutationer utan separat invalidering.

import { getCached, setCached } from "@/lib/clientCache";
import { putTitles, readTitleCache, titleKey, type CachedTitle } from "@/lib/titleCache";

export const WL_CACHE_KEY = "watchlist_items";
export const RATED_CACHE_KEY = "rated_items";
export const LIST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Routerna tar max 200 id per anrop. Vid kall cache och en lång lista måste
 * saknade titlar därför delas upp — annars kapas resten och visas som
 * platshållare. (Verifierat i produktion: 222 titlar gav 22 utan metadata när
 * berikningen kapades i stället för att delas upp.)
 */
const ENRICH_CHUNK = 200;

export const PLACEHOLDER_POSTER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export type WatchItem = {
  id: number;
  tmdbType: "movie" | "tv";
  title: string;
  year?: string;
  rating?: number;
  posterUrl: string;
  addedAt?: string;
  voteAverage?: number | null;
  popularity?: number | null;
  genreIds?: number[];
  /** TMDB keyword-id:n. `undefined` = inte cachat än (se loadWatchlist), inte "inga". */
  keywordIds?: number[];
};

/** Titlar med eget betyg (Betyg-fliken) — från POST /api/ratings/list. */
export type RatedItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  genreIds: number[];
  /** TMDB keyword-id:n. `undefined` = inte cachat än (se loadRated), inte "inga". */
  keywordIds?: number[];
  userRating: number;
};

export type WatchlistApiItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  poster: string | null;
  rating?: number | null;
  addedAt?: string;
  voteAverage?: number | null;
  popularity?: number | null;
  genreIds?: number[];
  keywordIds?: number[];
};

/** Steg 1-svaret: bara raderna ur DB, ingen TMDB-metadata. */
type WatchlistRowApi = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  addedAt: string;
};

/** Motsvarande för betyg. */
type RatedRowApi = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  userRating: number;
};

type RatedListResp = { ok: boolean; items: RatedItem[] };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function toCachedTitle(raw: WatchlistApiItem): CachedTitle {
  return {
    title: raw.title,
    year: raw.year,
    poster: raw.poster,
    voteAverage: raw.voteAverage ?? null,
    popularity: raw.popularity ?? null,
    genreIds: raw.genreIds ?? [],
    keywordIds: raw.keywordIds ?? [],
  };
}

/**
 * Slår ihop en DB-rad med cachad metadata. Saknas metadatan visas titeln ändå,
 * med platshållare — raden är sanningen om vad som ligger i listan, cachen är
 * bara utsmyckning.
 */
export function rowToWatchItem(row: WatchlistRowApi, meta: CachedTitle | undefined): WatchItem {
  return {
    id: row.tmdbId,
    tmdbType: row.mediaType,
    title: meta?.title ?? "…",
    year: meta?.year ?? undefined,
    rating: meta?.voteAverage ?? undefined,
    posterUrl: meta?.poster ?? PLACEHOLDER_POSTER,
    addedAt: row.addedAt,
    voteAverage: meta?.voteAverage ?? null,
    popularity: meta?.popularity ?? null,
    genreIds: meta?.genreIds ?? [],
    // Ingen `?? []` här med flit: `undefined` (metadata inte hämtad/cachad än)
    // ska tolkas annorlunda än en TOM lista (hämtat, titeln har inga keywords)
    // av sub-genre-filtret i WatchlistClient.
    keywordIds: meta?.keywordIds,
  };
}

/** Cachad lista utan nätverk — för första målningen innan hämtningen hunnit. */
export function readCachedWatchlist(): WatchItem[] | null {
  return getCached<WatchItem[]>(WL_CACHE_KEY);
}

export function readCachedRated(): RatedItem[] | null {
  return getCached<RatedItem[]>(RATED_CACHE_KEY);
}

/**
 * Hämtar watchlisten och skriver klientcachen. `null` = misslyckades, behåll
 * det som redan visas.
 */
export async function loadWatchlist(): Promise<WatchItem[] | null> {
  try {
    // Steg 1: bara raderna. En Prisma-fråga server-side i stället för ett
    // TMDB-uppslag per titel.
    const rowsRes = await fetch("/api/watchlist/list?meta=0", { method: "POST", cache: "no-store" });
    if (!rowsRes.ok) return null;
    const rowsData = (await rowsRes.json()) as { ok?: boolean; rows?: WatchlistRowApi[] };
    if (!rowsData.ok || !Array.isArray(rowsData.rows)) return null;
    const rows = rowsData.rows;

    // Steg 2: fyll i metadata från cachen, hämta bara det som saknas.
    // "Saknas" inkluderar poster skrivna FÖRE keywordIds-fältet fanns —
    // annars fick de aldrig sub-genre-data och sub-genre-filtret skulle
    // permanent falla tillbaka till "okänt" för hela den befintliga
    // watchlisten. Självläker en gång per titel, sedan är cachen komplett.
    const cache = readTitleCache();
    const missing = rows
      .map((r) => titleKey(r.mediaType, r.tmdbId))
      .filter((k) => !cache[k] || cache[k].keywordIds === undefined);

    if (missing.length > 0) {
      const add: Record<string, CachedTitle> = {};
      // Klumpvis: en lista längre än ENRICH_CHUNK skulle annars kapas och
      // resten fastna som platshållare.
      await Promise.all(
        chunk(missing, ENRICH_CHUNK).map(async (del) => {
          const enrichRes = await fetch(
            `/api/watchlist/list?ids=${encodeURIComponent(del.join(","))}`,
            { method: "POST", cache: "no-store" },
          );
          if (!enrichRes.ok) return;
          const enriched = (await enrichRes.json()) as { ok?: boolean; items?: WatchlistApiItem[] };
          if (!enriched.ok || !Array.isArray(enriched.items)) return;
          for (const it of enriched.items) {
            const meta = toCachedTitle(it);
            add[titleKey(it.mediaType, it.tmdbId)] = meta;
            cache[titleKey(it.mediaType, it.tmdbId)] = meta;
          }
        }),
      );
      putTitles(add);
    }

    // Raderna bestämmer vilka titlar som finns; cachen dekorerar bara. En
    // titel utan metadata visas hellre med platshållare än utelämnas.
    const mapped = rows.map((r) => rowToWatchItem(r, cache[titleKey(r.mediaType, r.tmdbId)]));
    setCached(WL_CACHE_KEY, mapped, LIST_TTL_MS);
    return mapped;
  } catch {
    return null;
  }
}

/**
 * Hämtar betygslistan och skriver klientcachen. `null` = misslyckades.
 */
export async function loadRated(): Promise<RatedItem[] | null> {
  try {
    // Samma tvåstegsupplägg som watchlisten: rader först, metadata ur cachen.
    const rowsRes = await fetch("/api/ratings/list?meta=0", { method: "POST", cache: "no-store" });
    if (!rowsRes.ok) return null;
    const rowsData = (await rowsRes.json()) as { ok?: boolean; rows?: RatedRowApi[] };
    if (!rowsData.ok || !Array.isArray(rowsData.rows)) return null;
    const rows = rowsData.rows;

    const cache = readTitleCache();
    // Se loadWatchlist: poster utan keywordIds (skrivna före fältet fanns)
    // räknas som saknade så de självläker en gång.
    const missing = rows
      .map((r) => titleKey(r.mediaType, r.tmdbId))
      .filter((k) => !cache[k] || cache[k].keywordIds === undefined);

    if (missing.length > 0) {
      const add: Record<string, CachedTitle> = {};
      await Promise.all(
        chunk(missing, ENRICH_CHUNK).map(async (del) => {
          const enrichRes = await fetch(
            `/api/ratings/list?ids=${encodeURIComponent(del.join(","))}`,
            { method: "POST", cache: "no-store" },
          );
          if (!enrichRes.ok) return;
          const enriched = (await enrichRes.json()) as RatedListResp;
          if (!enriched.ok || !Array.isArray(enriched.items)) return;
          for (const it of enriched.items) {
            const meta: CachedTitle = {
              title: it.title,
              year: it.year,
              poster: it.poster,
              // Betygsrouten returnerar inte betyg/popularitet; watchlisten
              // fyller på dem för samma titel när den passerar. Genrer och
              // keywords ger den däremot nu, för (sub-)genrefiltret på
              // Betyg-fliken.
              voteAverage: null,
              popularity: null,
              genreIds: it.genreIds ?? [],
              keywordIds: it.keywordIds ?? [],
            };
            add[titleKey(it.mediaType, it.tmdbId)] = meta;
            cache[titleKey(it.mediaType, it.tmdbId)] = meta;
          }
        }),
      );
      putTitles(add);
    }

    const mapped: RatedItem[] = rows.map((r) => {
      const meta = cache[titleKey(r.mediaType, r.tmdbId)];
      return {
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        title: meta?.title ?? "…",
        year: meta?.year ?? null,
        poster: meta?.poster ?? null,
        genreIds: meta?.genreIds ?? [],
        // undefined = inte cachat än, skiljs från tom lista — se rowToWatchItem.
        keywordIds: meta?.keywordIds,
        userRating: r.userRating,
      };
    });
    setCached(RATED_CACHE_KEY, mapped, LIST_TTL_MS);
    return mapped;
  } catch {
    return null;
  }
}
