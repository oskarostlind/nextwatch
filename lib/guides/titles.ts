// lib/guides/titles.ts
//
// Hämtar titlar till landningssidorna från TMDB:s /discover.
//
// Varför discover och inte vår egen rekommendationsmotor: computeUnifiedRecs
// (lib/unifiedRecs.ts) är personlig — den bygger på en inloggad användares
// betyg, watchlist och genre_stats. Landningssidorna har ingen användare. Det
// enda rimliga är ett opersonligt, reproducerbart urval: betyg och röstantal.
//
// Provider-filtrering sker server-side hos TMDB (with_watch_providers +
// watch_region=SE), samma princip som recs/unified — annars blir det N+1.
//
// Env-konventionen är medvetet densamma som app/page.tsx och
// app/api/tmdb/landing-posters (TMDB_V4_TOKEN / TMDB_API_KEY). Kodbasen är
// inkonsekvent här; lib/tmdb.ts läser andra namn. Se CLAUDE.md.
import type { TitleQuery } from "./content";

export type GuideTitle = {
  id: number;
  title: string;
  year: number | null;
  rating: number;
  votes: number;
  runtime: number | null;
  genres: string[];
  posterPath: string | null;
  overview: string;
};

// Samma id:n som PROVIDER_MAP i lib/unifiedRecs.ts. Duplicerat med flit: den
// modulen drar in Prisma och hela rekommendationskedjan, och de här sidorna
// ska kunna renderas utan databas.
const PROVIDER_IDS: Record<string, number> = {
  netflix: 8,
  "prime video": 119,
  "disney+": 337,
  "apple tv+": 350,
  viaplay: 73,
  "svt play": 383,
  max: 1899,
  "hbo max": 1899,
  "tv4 play": 113,
  skyshowtime: 1773,
};

const GENRE_NAMES: Record<number, string> = {
  28: "Action", 12: "Äventyr", 16: "Animerat", 35: "Komedi", 80: "Kriminal",
  99: "Dokumentär", 18: "Drama", 10751: "Familj", 14: "Fantasy", 36: "Historia",
  27: "Skräck", 10402: "Musik", 9648: "Mysterium", 10749: "Romantik",
  878: "Sci-Fi", 53: "Thriller", 10752: "Krig", 37: "Western",
};

type TmdbResult = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  poster_path?: string | null;
  overview?: string;
};

/**
 * Hämtar titlar för en guide. Cachas ett dygn: sidorna ska vara färska (det är
 * vår enda strukturella fördel mot konkurrenterna, vars listor ruttnar), men
 * katalogerna ändras inte oftare än så och varje sidvisning ska inte kosta ett
 * TMDB-anrop.
 *
 * Returnerar tom lista vid fel i stället för att kasta — en sida utan tabell är
 * fortfarande en sida med text, medan ett kastat fel ger 500 åt crawlern.
 */
// TMDB:s discover returnerar 20 träffar per sida. Vi hämtar en sida — 20 rader
// med riktig data slår konkurrenternas 48 utan betyg (se SEO-PLAN.md).
export async function fetchGuideTitles(q: TitleQuery, limit = 20): Promise<GuideTitle[]> {
  const apiKey = process.env.TMDB_API_KEY;
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN;
  if (!apiKey && !v4) return [];

  const kind = q.kind ?? "movie";
  const usp = new URLSearchParams({
    language: "sv-SE",
    watch_region: "SE",
    region: "SE",
    include_adult: "false",
    // Sorteringen granskades 2026-09-24 mot den renderade sidan:
    // vote_average.desc gav en lista över TIDERNAS bäst betygsatta filmer som
    // råkar ligga på tjänsten (Sagan om ringen, Eldflugornas grav, en indisk
    // klassiker från 1995). Korrekt enligt frågan, men fel svar på "vad ska vi
    // se ikväll". popularity.desc med ett betygsgolv ger det som faktiskt är
    // aktuellt OCH bra. Golvet sätts per sida via minRating.
    sort_by: "popularity.desc",
    page: "1",
  });
  if (apiKey) usp.set("api_key", apiKey);

  usp.set("vote_count.gte", String(q.minVotes ?? 500));
  if (q.minRating) usp.set("vote_average.gte", String(q.minRating));
  if (q.genres?.length) usp.set("with_genres", q.genres.join("|"));
  if (q.withoutGenres?.length) usp.set("without_genres", q.withoutGenres.join(","));
  if (q.maxRuntime) usp.set("with_runtime.lte", String(q.maxRuntime));
  if (q.fromYear) {
    const key = kind === "tv" ? "first_air_date.gte" : "primary_release_date.gte";
    usp.set(key, `${q.fromYear}-01-01`);
  }
  if (q.providers?.length) {
    const ids = q.providers
      .map((p) => PROVIDER_IDS[p.trim().toLowerCase()])
      .filter((n): n is number => typeof n === "number");
    if (ids.length) {
      // "|" = ELLER. Sidan frågar "vad kan vi se med NÅGON av våra tjänster",
      // inte "vad finns på alla samtidigt" — det senare vore nästan tomt.
      usp.set("with_watch_providers", ids.join("|"));
      usp.set("with_watch_monetization_types", "flatrate");
    }
  }

  try {
    const res = await fetch(`https://api.themoviedb.org/3/discover/${kind}?${usp.toString()}`, {
      headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: TmdbResult[] };
    const rows = json.results ?? [];

    return rows.slice(0, limit).map((r): GuideTitle => {
      const date = r.release_date || r.first_air_date || "";
      return {
        id: r.id,
        title: r.title || r.name || "Okänd titel",
        year: date ? Number(date.slice(0, 4)) || null : null,
        rating: Math.round((r.vote_average ?? 0) * 10) / 10,
        votes: r.vote_count ?? 0,
        // discover returnerar ingen speltid. Sidor som filtrerar på speltid
        // (with_runtime.lte) har ändå ett korrekt urval — vi kan bara inte
        // visa minutsiffran per rad utan ett extra anrop per titel, vilket
        // inte är värt 24 requests per sidvisning.
        runtime: null,
        genres: (r.genre_ids ?? []).map((g) => GENRE_NAMES[g]).filter(Boolean).slice(0, 3),
        posterPath: r.poster_path ?? null,
        overview: r.overview ?? "",
      };
    });
  } catch {
    return [];
  }
}
