// lib/tmdbDetails.ts
//
// Delad TMDB-detaljhämtning, utbruten ur app/api/group/match/route.ts så att
// även pending-ratings-endpointen (betygsätt tidigare gruppmatchningar) kan
// återanvända exakt samma berikning utan att duplicera fetch-logiken.
//
// OBS: behåller match-routens tokenkonvention (TMDB_TOKEN/TMDB_BEARER +
// TMDB_API_KEY) — se CLAUDE.md om de inkonsekventa TMDB-konventionerna.

export type TmdbType = "movie" | "tv";

export type TmdbLite = {
  tmdbId: number;
  tmdbType: TmdbType;
  title: string;
  year?: number;
  poster?: string;
  rating?: number;
  overview?: string;
  providers?: { name: string; url: string }[];
};

function yearFromDate(date?: string | null): number | undefined {
  if (!date) return undefined;
  const y = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

export async function tmdbDetails(
  type: TmdbType,
  id: number,
  locale: string
): Promise<TmdbLite | null> {
  const token = process.env.TMDB_TOKEN ?? process.env.TMDB_BEARER ?? "";
  const apiKey = process.env.TMDB_API_KEY ?? "";

  const base = `https://api.themoviedb.org/3/${type}/${id}`;
  const url = apiKey
    ? `${base}?language=${encodeURIComponent(locale)}&append_to_response=watch/providers&api_key=${apiKey}`
    : `${base}?language=${encodeURIComponent(locale)}&append_to_response=watch/providers`;

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;

  const title =
    (type === "movie" ? (data.title as string | undefined) : (data.name as string | undefined)) ??
    "";
  const release =
    (type === "movie"
      ? (data.release_date as string | undefined)
      : (data.first_air_date as string | undefined)) ?? null;

  const poster = (data.poster_path as string | undefined) ?? undefined;
  const rating =
    typeof data.vote_average === "number" && Number.isFinite(data.vote_average)
      ? (data.vote_average as number)
      : undefined;
  const overview = (data.overview as string | undefined) ?? undefined;

  const provRoot = (data["watch/providers"] as Record<string, unknown> | undefined)?.results as
    | Record<string, { link?: string }>
    | undefined;

  const providers: { name: string; url: string }[] = [];
  if (provRoot) {
    const countries = ["SE", "GB", "US"];
    for (const cc of countries) {
      const node = provRoot[cc];
      if (node?.link) providers.push({ name: `Stream (${cc})`, url: node.link });
    }
  }

  return {
    tmdbId: id,
    tmdbType: type,
    title,
    year: yearFromDate(release),
    poster,
    rating,
    overview,
    providers,
  };
}
