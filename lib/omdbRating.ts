// lib/omdbRating.ts
//
// Osynlig IMDb-betygs-fallback via OMDb (omdbapi.com). Vissa titlar visar
// inget/svagt betyg för att TMDB har för få röster — det här fyller BARA i
// siffervärdet där ett kort redan skulle visat ett betyg. Ingen ny UI-yta:
// anropande kod muterar bara `rating`-fältet den redan hade.
//
// Saknas OMDB_API_KEY blir allt en tyst no-op, samma mönster som
// APNS-nycklarna i lib/push.ts — så anropande kod aldrig påverkas av att
// nyckeln saknas lokalt/i förhandsgranskning.
//
// OMDb:s gratisnivå är 1000 anrop/dygn. DB-cachen (ExternalRating,
// prisma/schema.prisma) med EXTERNAL_RATING_TTL_MS nedan håller oss under
// det — även cachade nollträffar (ingen IMDb-koppling, eller IMDb saknar
// betyg) sparas, annars skulle samma ratinglösa titel slå mot OMDb varje
// gång den dyker upp i ett kort. NETWORK_BUDGET_PER_CALL begränsar dessutom
// hur många NYA uppslag ett enda anrop får göra — resten fylls i nästa gång
// samma titlar dyker upp, då cachen är varm.

import { prisma } from "@/lib/prisma";

export type MediaType = "movie" | "tv";

/** Kort/rad som kan sakna eller ha ett opålitligt betyg. Muteras in-place. */
export type RatableCard = {
  tmdbId: number;
  mediaType: MediaType;
  /** TMDB:s vote_average, om känt. Fylls i av fillMissingRatings vid träff. */
  rating?: number | null;
  /** TMDB:s vote_count, om känt — avgör om betyget räknas som opålitligt. */
  voteCount?: number | null;
};

const OMDB_API_KEY = process.env.OMDB_API_KEY;

// Samma token-konvention som lib/tasteModel.ts/lib/unifiedRecs.ts (TMDB_V4_TOKEN
// med TMDB_API_KEY som fallback) — se CLAUDE.md om de inkonsekventa TMDB-
// konventionerna i repot.
const TMDB_V4_TOKEN =
  process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN ?? process.env.TMDB_READ_TOKEN;
const TMDB_V3_KEY = process.env.TMDB_API_KEY;

/** Hur gammal en cache-rad (även en nollträff) får vara innan den slås upp igen. */
export const EXTERNAL_RATING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** TMDB-betyget räknas som opålitligt under detta röstantal. */
const MIN_RELIABLE_VOTES = 20;

/** Hur många kort som slås upp SAMTIDIGT per fillMissingRatings-anrop. */
const CONCURRENCY = 4;

/**
 * Tak på nya nätverksuppslag (TMDB external_ids + OMDb) per anrop. Cache-
 * träffar räknas INTE mot taket — bara DB:n är billig, bara nätet är dyrt.
 */
const NETWORK_BUDGET_PER_CALL = 10;

function isUnreliable(rating?: number | null, voteCount?: number | null): boolean {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return true;
  if (voteCount != null && voteCount < MIN_RELIABLE_VOTES) return true;
  return false;
}

async function tmdbGetJson<T>(path: string): Promise<T | null> {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  const headers: Record<string, string> = {};
  if (TMDB_V4_TOKEN) {
    headers.Authorization = `Bearer ${TMDB_V4_TOKEN}`;
  } else if (TMDB_V3_KEY) {
    url.searchParams.set("api_key", TMDB_V3_KEY);
  } else {
    return null;
  }
  try {
    // external_ids ändras aldrig efter release — dygnscache räcker gott.
    const res = await fetch(url.toString(), { headers, next: { revalidate: 60 * 60 * 24 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type TmdbExternalIds = { imdb_id?: string | null };

async function lookupImdbId(tmdbId: number, mediaType: MediaType): Promise<string | null> {
  const path =
    mediaType === "movie" ? `/movie/${tmdbId}/external_ids` : `/tv/${tmdbId}/external_ids`;
  const data = await tmdbGetJson<TmdbExternalIds>(path);
  return data?.imdb_id ?? null;
}

type OmdbResponse = { imdbRating?: string; imdbVotes?: string; Response?: string };

async function fetchOmdb(imdbId: string): Promise<{ rating: number | null; votes: number | null }> {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", OMDB_API_KEY!);
  url.searchParams.set("i", imdbId);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return { rating: null, votes: null };
    const data = (await res.json()) as OmdbResponse;
    const ratingRaw = data.imdbRating && data.imdbRating !== "N/A" ? Number(data.imdbRating) : NaN;
    const votesRaw =
      data.imdbVotes && data.imdbVotes !== "N/A" ? Number(data.imdbVotes.replace(/,/g, "")) : NaN;
    return {
      rating: Number.isFinite(ratingRaw) ? ratingRaw : null,
      votes: Number.isFinite(votesRaw) ? votesRaw : null,
    };
  } catch {
    return { rating: null, votes: null };
  }
}

/**
 * Slår upp OCH cachar IMDb-betyget för en enskild titel mot TMDB
 * (external_ids → imdb_id) och sedan OMDb. Skriver alltid en cache-rad,
 * även vid nollträff (imdbRating null) — se filhuvudet om varför.
 */
async function resolveAndCache(tmdbId: number, mediaType: MediaType): Promise<number | null> {
  const imdbId = await lookupImdbId(tmdbId, mediaType);
  let imdbRating: number | null = null;
  let imdbVotes: number | null = null;
  if (imdbId) {
    const omdb = await fetchOmdb(imdbId);
    imdbRating = omdb.rating;
    imdbVotes = omdb.votes;
  }

  await prisma.externalRating
    .upsert({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      create: { tmdbId, mediaType, imdbId, imdbRating, imdbVotes },
      update: { imdbId, imdbRating, imdbVotes, fetchedAt: new Date() },
    })
    .catch(() => {
      // Best-effort — en misslyckad cache-skrivning ska inte fälla svaret,
      // bara kosta ett extra OMDb-anrop nästa gång samma titel dyker upp.
    });

  return imdbRating;
}

/**
 * Fyller i saknade/opålitliga betyg på en lista kort, IN-PLACE (muterar
 * `rating` på de kort som behövde det). Kastar aldrig — best-effort, så ett
 * OMDb-strul aldrig försenar eller fäller anroparens svar.
 *
 * Cache-koll för HELA batchen görs som EN samling indexerade findMany-frågor
 * (bundna av CONCURRENCY), inte en fråga per kort i sekvens. Bara kort utan
 * färsk cache (max NETWORK_BUDGET_PER_CALL st) går vidare till TMDB/OMDb —
 * resten lämnas orörda och fylls i nästa gång titeln dyker upp i ett kort.
 */
export async function fillMissingRatings<T extends RatableCard>(cards: T[]): Promise<void> {
  if (!OMDB_API_KEY) return; // no-op utan nyckel, se filhuvudet

  const candidates = cards.filter((c) => isUnreliable(c.rating, c.voteCount));
  if (candidates.length === 0) return;

  let networkBudget = NETWORK_BUDGET_PER_CALL;
  let idx = 0;

  async function worker() {
    while (idx < candidates.length) {
      const card = candidates[idx++];
      try {
        const cached = await prisma.externalRating.findUnique({
          where: { tmdbId_mediaType: { tmdbId: card.tmdbId, mediaType: card.mediaType } },
        });
        if (cached && Date.now() - cached.fetchedAt.getTime() < EXTERNAL_RATING_TTL_MS) {
          if (cached.imdbRating != null) card.rating = cached.imdbRating;
          continue;
        }
        if (networkBudget <= 0) continue; // spar till nästa anrop — cachen är kall ändå
        networkBudget -= 1;
        const rating = await resolveAndCache(card.tmdbId, card.mediaType);
        if (rating != null) card.rating = rating;
      } catch {
        // Ett trasigt kort får inte fälla resten av batchen.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()),
  );
}
