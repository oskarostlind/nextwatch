// lib/tmdbTitleBrief.ts
//
// Ett enda TMDB-anrop (detaljer + watch/providers) som ger allt en push behöver
// veta om en titel: namn, bild, speltid, betyg, genrer och var den streamas.
// Delas av lib/push.ts och push-komposern (lib/pushRecs). Kastar aldrig — null
// betyder "kunde inte hämta", och anroparen faller tillbaka på neutral text.

export type TitleBrief = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string | null;
  posterUrl: string | null; // https://image.tmdb.org/t/p/w500…
  backdropUrl: string | null; // https://image.tmdb.org/t/p/w780…
  /** backdropUrl ?? posterUrl — det pushar bifogar */
  imageUrl: string | null;
  runtimeMin: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  genres: string[];
  /** flatrate-tjänster per region, t.ex. {SE:["Netflix","Max"]} */
  providers: Record<string, string[]>;
};

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const MAX_CACHE = 2000;

type Cached = { at: number; brief: TitleBrief | null };
const cache = new Map<string, Cached>();

type RawDetails = {
  id?: number;
  title?: string;
  name?: string;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  runtime?: number | null;
  episode_run_time?: number[] | null;
  last_episode_to_air?: { runtime?: number | null } | null;
  vote_average?: number;
  vote_count?: number;
  genres?: { id: number; name: string }[];
  "watch/providers"?: {
    results?: Record<string, { flatrate?: { provider_name?: string }[] } | undefined>;
  };
};

function positiveOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchTitleBrief(
  tmdbId: number,
  mediaType: "movie" | "tv",
  language: string
): Promise<TitleBrief | null> {
  try {
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
    const token = process.env.TMDB_V4_TOKEN;
    if (!token) return null;

    const key = `${mediaType}:${tmdbId}:${language}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.brief;

    const url =
      `${TMDB}/${mediaType}/${tmdbId}` +
      `?append_to_response=watch/providers&language=${encodeURIComponent(language)}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let raw: RawDetails | null = null;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) return null; // fel cachas inte — nästa försök får chansen
      raw = (await res.json()) as RawDetails;
    } finally {
      clearTimeout(timer);
    }
    if (!raw) return null;

    const title = (mediaType === "movie" ? raw.title : raw.name)?.trim();
    if (!title) return null;

    const date = mediaType === "movie" ? raw.release_date : raw.first_air_date;
    const year = date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;

    const posterUrl = raw.poster_path ? `${IMG}/w500${raw.poster_path}` : null;
    const backdropUrl = raw.backdrop_path ? `${IMG}/w780${raw.backdrop_path}` : null;

    // TV saknar ett enda "runtime": ta typisk avsnittslängd.
    const runtimeMin =
      mediaType === "movie"
        ? positiveOrNull(raw.runtime)
        : positiveOrNull(raw.episode_run_time?.[0]) ??
          positiveOrNull(raw.last_episode_to_air?.runtime);

    const providers: Record<string, string[]> = {};
    for (const [region, entry] of Object.entries(raw["watch/providers"]?.results ?? {})) {
      const names = (entry?.flatrate ?? [])
        .map((p) => p.provider_name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
      if (names.length > 0) providers[region] = names;
    }

    const brief: TitleBrief = {
      tmdbId,
      mediaType,
      title,
      year,
      posterUrl,
      backdropUrl,
      imageUrl: backdropUrl ?? posterUrl,
      runtimeMin,
      voteAverage: typeof raw.vote_average === "number" ? raw.vote_average : null,
      voteCount: typeof raw.vote_count === "number" ? raw.vote_count : null,
      genres: (raw.genres ?? []).map((g) => g.name).filter(Boolean),
      providers,
    };

    // Enkel storleksgräns så en lång-livad instans inte växer obegränsat.
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), brief });
    return brief;
  } catch {
    return null;
  }
}
