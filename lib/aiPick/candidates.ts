// lib/aiPick/candidates.ts
//
// Kandidatmängden till "Välj åt mig". Två pooler, i Oskars prioritetsordning:
//
//   1. SPARADE LIKES (primär): titlar användaren svept JA på och som ligger i
//      watchlisten men inte är sedda/betygsatta. Hela poängen med funktionen är
//      att få folk att faktiskt titta på det de gillat — även gamla, bortglömda
//      likes ska komma upp, inte bara de senaste.
//   2. FÄRSKA (sekundär): computeUnifiedRecs (lib/unifiedRecs.ts) — samma
//      recommender som swipe-leken, ingen fork. Används när ingen sparad like
//      passar, för "överraska mig", eller när användaren har få sparade.
//
// Chips/nyckelord i fritexten blir ett deterministiskt förfilter (genre +
// speltid) innan LLM:en får se något — modellen väljer bara bland titlar som
// redan klarar de hårda kraven. Blir poolen för tunn körs ett extra
// TMDB-discover-pass för de efterfrågade genrerna på användarens tjänster.
//
// Rena funktioner (parseIntent, matchesIntent, selectSavedForEnrichment,
// fallbackSelection …) är exporterade och testbara utan DB/TMDB.

import { prisma } from "@/lib/prisma";
import { tmdbFetch } from "@/lib/tmdbClient";
import { computeUnifiedRecs } from "@/lib/unifiedRecs";
import { loadGenreStats, type GenreStats } from "@/lib/genreStats";
import { parseProvidersJson } from "@/lib/groupSettings";
import { ageFromDob, seMaxCert } from "@/lib/tasteModel";
import { tmdbPoster } from "@/lib/tmdb";
import { providerLogoUrl } from "@/lib/providerLogos";
import type { PickChipId, PickItem, PickProvider } from "@/lib/aiPick/types";

export type MediaType = "movie" | "tv";
export type MediaFilter = "both" | "movie" | "tv";
export type SavedPriority = "strong" | "balanced";

export function savedPriority(raw: string | undefined = process.env.PICK_SAVED_PRIORITY): SavedPriority {
  return (raw ?? "").trim().toLowerCase() === "balanced" ? "balanced" : "strong";
}

/* ======================================================================
 * Typer
 * ==================================================================== */

export type CandidateProvider = { id: number; name: string; logoPath: string | null };

export type PickCandidate = {
  /** Nyckeln modellen ser: "m123" (film) / "t456" (serie). */
  key: string;
  tmdbId: number;
  mediaType: MediaType;
  fromSaved: boolean;
  /** När titeln hamnade i watchlisten (sparad like). null för färska. */
  likedAt: Date | null;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  /** Film: speltid. Serie: typisk avsnittslängd. */
  runtimeMin: number | null;
  seasons: number | null;
  genreIds: number[];
  genreNames: string[];
  voteAverage: number | null;
  voteCount: number | null;
  overview: string | null;
  originalLanguage: string | null;
  /** Streambara tjänster i regionen (flatrate/free/ads). null = okänt. */
  providers: CandidateProvider[] | null;
  /** Finns på någon av användarens tjänster? null = okänt (data saknas). */
  onUserServices: boolean | null;
  /** Position i recommenderns lek (färska), för fallback-ordningen. */
  recRank: number | null;
  /** Kom ur det extra discover-passet. */
  fromDiscover?: boolean;
};

export function candidateKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType === "movie" ? "m" : "t"}${tmdbId}`;
}

/* ======================================================================
 * Intent: chips + nyckelord → hårda filter
 * ==================================================================== */

export type PickIntent = {
  /** TMDB-genre-id:n (OR-semantik). Tomt = ingen genrebegränsning. */
  movieGenres: number[];
  tvGenres: number[];
  /** Genrer som ska bort (t.ex. skräck när man bett om något lättsamt). */
  avoidMovieGenres: number[];
  avoidTvGenres: number[];
  maxRuntimeMovie: number | null;
  maxRuntimeTv: number | null;
  light: boolean;
  thrilling: boolean;
  surprise: boolean;
  /** Fritexten nämner uttryckligen film eller serie (bara när filtret är 'both'). */
  mediaHint: MediaType | null;
  /** Begärde användaren barn-/familjeinnehåll uttryckligen? */
  wantsFamily: boolean;
  /** Matchade termer, för debug/logg. */
  terms: string[];
};

type GenreRule = { label: string; re: RegExp; movie: number[]; tv: number[] };

// Prefix-gräns (ingen svans-gräns) med flit: svenska sammansättningar som
// "skräckfilm", "komediserie", "deckarserie" ska träffa.
const B = "(?:^|[^\\p{L}\\p{N}])";
const rx = (alts: string) => new RegExp(`${B}(?:${alts})`, "iu");

const GENRE_RULES: GenreRule[] = [
  { label: "horror", re: rx("skräck|horror|läskig|ruskig|creepy|scary"), movie: [27], tv: [9648, 10765] },
  { label: "comedy", re: rx("komedi|comedy|comedies|rolig|kul\\b|funny|skratta|humor|romcom"), movie: [35], tv: [35] },
  { label: "thriller", re: rx("thriller|rysare"), movie: [53], tv: [80, 9648] },
  { label: "documentary", re: rx("dokumentär|dokumentar|documentar|docu|dokusåpa"), movie: [99], tv: [99] },
  { label: "animation", re: rx("animera|anime|animation|animated|tecknad|tecknat"), movie: [16], tv: [16] },
  { label: "romance", re: rx("romantik|romantisk|romance|romantic|romcom|kärlek|love stor"), movie: [10749], tv: [18] },
  { label: "action", re: rx("action"), movie: [28], tv: [10759] },
  { label: "adventure", re: rx("äventyr|adventure"), movie: [12], tv: [10759] },
  { label: "scifi", re: rx("sci-?fi|science fiction|rymd|space|futurist"), movie: [878], tv: [10765] },
  { label: "fantasy", re: rx("fantasy"), movie: [14], tv: [10765] },
  { label: "crime", re: rx("krim|deckare|deckar|crime|mord|murder|detektiv|detective|true crime|polis"), movie: [80], tv: [80] },
  { label: "drama", re: rx("drama"), movie: [18], tv: [18] },
  { label: "mystery", re: rx("mysteri|mystery|gåta|whodunit"), movie: [9648], tv: [9648] },
  { label: "war", re: rx("krigs?film|krig\\b|war\\b|war movie"), movie: [10752], tv: [10768] },
  { label: "western", re: rx("western"), movie: [37], tv: [37] },
  { label: "family", re: rx("familj|family|barn|kids|children"), movie: [10751], tv: [10751, 10762] },
  { label: "history", re: rx("historisk|historia|history|historical"), movie: [36], tv: [] },
  { label: "music", re: rx("musikal|musical|musik|music"), movie: [10402], tv: [] },
];

const LIGHT_RE = rx("mysig|myspys|feelgood|feel-good|feel good|lättsam|lätt\\b|cozy|cosy|light|chill|avslappnad|uplifting");
const THRILL_RE = rx("spännande|spänning|mörk|thrilling|dark|intense|nervig|suspense");
const SHORT_RE = rx("kort|short|snabb|quick");
const SURPRISE_RE = rx("överrask|surprise|något nytt|something new|random|slump");
// Utan prefix-gräns: "skräckfilm" och "deckarserie" ska ge ledtråden.
const MOVIE_RE = /film|movie/iu;
const TV_RE = /serie|series|tv[- ]?show|avsnitt|episod|säsong|season|binge/iu;

const LIGHT_GENRES = { movie: [35, 10749, 10751], tv: [35, 10751] };
const THRILL_GENRES = { movie: [53, 27, 80, 9648], tv: [80, 9648, 10759, 10765] };
const LIGHT_AVOID = { movie: [27, 53], tv: [] as number[] };

const SHORT_MOVIE_MAX = 90; // chippet heter "Max 90 min" — håll siffrorna lika
const SHORT_TV_MAX = 35;

function uniq(nums: number[]): number[] {
  return Array.from(new Set(nums));
}

/** Plockar ut "max 90", "under 90 min", "90 min" → 90 (rimligt intervall). */
function explicitMinutes(text: string): number | null {
  const m =
    text.match(/(?:max|högst|under|mindre än|less than|at most|up to|max\.)\s*(\d{2,3})/iu) ??
    text.match(/(\d{2,3})\s*(?:min|minuter|minutes|mins)\b/iu);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 20 || n > 240) return null;
  return n;
}

export function parseIntent(prompt: string | null | undefined, chips: readonly PickChipId[] = []): PickIntent {
  const text = (prompt ?? "").toLowerCase();
  const chipSet = new Set(chips);
  const terms: string[] = [];

  const movieGenres: number[] = [];
  const tvGenres: number[] = [];
  let anyTvMapped = false;
  let wantsFamily = false;
  for (const rule of GENRE_RULES) {
    if (!text || !rule.re.test(text)) continue;
    terms.push(rule.label);
    movieGenres.push(...rule.movie);
    tvGenres.push(...rule.tv);
    if (rule.tv.length > 0) anyTvMapped = true;
    if (rule.label === "family" || rule.label === "animation") wantsFamily = true;
  }

  const light = chipSet.has("light") || (text !== "" && LIGHT_RE.test(text));
  const thrilling = chipSet.has("thrilling") || (text !== "" && THRILL_RE.test(text));
  const surprise = chipSet.has("surprise") || (text !== "" && SURPRISE_RE.test(text));
  const shortWord = chipSet.has("short") || (text !== "" && SHORT_RE.test(text));
  const minutes = text ? explicitMinutes(text) : null;

  // Stämning blir genre bara om fritexten inte redan namngav en genre —
  // "mysig skräck" ska fortfarande vara skräck.
  const explicitGenre = terms.length > 0;
  if (light) terms.push("light");
  if (thrilling) terms.push("thrilling");
  if (!explicitGenre) {
    if (light && !thrilling) {
      movieGenres.push(...LIGHT_GENRES.movie);
      tvGenres.push(...LIGHT_GENRES.tv);
      anyTvMapped = true;
    } else if (thrilling && !light) {
      movieGenres.push(...THRILL_GENRES.movie);
      tvGenres.push(...THRILL_GENRES.tv);
      anyTvMapped = true;
    }
  }
  const avoidMovieGenres = light && !thrilling && !explicitGenre ? [...LIGHT_AVOID.movie] : [];
  const avoidTvGenres = light && !thrilling && !explicitGenre ? [...LIGHT_AVOID.tv] : [];

  let maxRuntimeMovie: number | null = null;
  let maxRuntimeTv: number | null = null;
  if (minutes != null) {
    maxRuntimeMovie = minutes;
    maxRuntimeTv = shortWord ? Math.min(minutes, SHORT_TV_MAX) : minutes;
    terms.push(`max${minutes}`);
  } else if (shortWord) {
    maxRuntimeMovie = SHORT_MOVIE_MAX;
    maxRuntimeTv = SHORT_TV_MAX;
    terms.push("short");
  }
  if (surprise) terms.push("surprise");

  let mediaHint: MediaType | null = null;
  if (text) {
    const m = MOVIE_RE.test(text);
    const t = TV_RE.test(text);
    if (m && !t) mediaHint = "movie";
    else if (t && !m) mediaHint = "tv";
  }

  return {
    movieGenres: uniq(movieGenres),
    // Saknar ALLA nämnda genrer en TV-motsvarighet (t.ex. bara "historisk")
    // begränsas serier inte alls — hellre det än att alla serier försvinner.
    tvGenres: anyTvMapped ? uniq(tvGenres) : [],
    avoidMovieGenres,
    avoidTvGenres,
    maxRuntimeMovie,
    maxRuntimeTv,
    light,
    thrilling,
    surprise,
    mediaHint,
    wantsFamily,
    terms,
  };
}

export function intentHasGenreFilter(intent: PickIntent, mediaType?: MediaType): boolean {
  if (mediaType === "movie") return intent.movieGenres.length > 0;
  if (mediaType === "tv") return intent.tvGenres.length > 0;
  return intent.movieGenres.length > 0 || intent.tvGenres.length > 0;
}

/** Effektivt film/serie-filter: explicit filter vinner, annars fritextens ledtråd. */
export function effectiveMediaFilter(filter: MediaFilter, intent: PickIntent): MediaFilter {
  if (filter !== "both") return filter;
  return intent.mediaHint ?? "both";
}

type IntentCheckable = Pick<PickCandidate, "mediaType" | "genreIds" | "runtimeMin">;

/**
 * Klarar kandidaten de hårda kraven? Okänd speltid/genre fälls INTE — hellre
 * låta modellen bedöma än att tappa en sparad like för att TMDB saknar data.
 */
export function matchesIntent(c: IntentCheckable, intent: PickIntent): boolean {
  const wanted = c.mediaType === "movie" ? intent.movieGenres : intent.tvGenres;
  const avoid = c.mediaType === "movie" ? intent.avoidMovieGenres : intent.avoidTvGenres;
  const maxRt = c.mediaType === "movie" ? intent.maxRuntimeMovie : intent.maxRuntimeTv;
  if (c.genreIds.length > 0) {
    if (wanted.length > 0 && !c.genreIds.some((g) => wanted.includes(g))) return false;
    if (avoid.length > 0 && c.genreIds.some((g) => avoid.includes(g))) return false;
  }
  if (maxRt != null && c.runtimeMin != null && c.runtimeMin > maxRt) return false;
  return true;
}

/* ======================================================================
 * Urval av sparade likes att berika
 * ==================================================================== */

export type SavedRow = { tmdbId: number; mediaType: MediaType; addedAt: Date };

/**
 * Nyaste först, men med en rejäl andel ÄLDRE likes — de bortglömda är exakt
 * de vi vill lyfta. De äldre plockas jämnt utspridda över resten av listan,
 * med en dygnsroterande offset så olika gamla titlar dyker upp olika dagar.
 * `rows` ska vara sorterade nyast först.
 */
export function selectSavedForEnrichment(
  rows: SavedRow[],
  total: number,
  recentShare = 0.6,
  dayIndex = Math.floor(Date.now() / 86_400_000),
): SavedRow[] {
  if (rows.length <= total) return rows.slice();
  const recentN = Math.max(1, Math.round(total * recentShare));
  const olderN = total - recentN;
  const recent = rows.slice(0, recentN);
  const rest = rows.slice(recentN);
  const older: SavedRow[] = [];
  if (olderN > 0 && rest.length > 0) {
    const step = rest.length / olderN;
    const offset = step > 1 ? dayIndex % Math.floor(step) : 0;
    const seen = new Set<number>();
    for (let i = 0; i < olderN; i++) {
      const idx = Math.min(rest.length - 1, Math.floor(i * step) + offset);
      if (seen.has(idx)) continue;
      seen.add(idx);
      older.push(rest[idx]);
    }
  }
  return [...recent, ...older];
}

/**
 * Sparade titlar som INTE ska föreslås: betygsatta (betyg = sedd), markerade
 * som sedda, eller nej-svepta efter att de sparades.
 */
export function isSavedExcluded(
  row: SavedRow,
  rating: { rating: number | null; decision: string; decidedAt: Date } | undefined,
): boolean {
  if (!rating) return false;
  if (rating.rating != null) return true;
  const d = rating.decision.toLowerCase();
  if (d === "seen" || d === "rated") return true;
  if (d === "dislike" && rating.decidedAt.getTime() > row.addedAt.getTime()) return true;
  return false;
}

/* ======================================================================
 * Deterministisk fallback (samma prioritet som prompten)
 * ==================================================================== */

/** Bayes-utjämnad kvalitet (samma prior som recommendern: 6.5 / 250 röster). */
export function bayesQuality(avg: number | null, votes: number | null): number {
  const C = 6.5;
  const m = 250;
  if (avg == null || !Number.isFinite(avg)) return C - 0.3;
  const v = votes != null && Number.isFinite(votes) ? Math.max(0, votes) : 50;
  return (v * avg + m * C) / (v + m);
}

export type FallbackOptions = {
  priority: SavedPriority;
  surprise: boolean;
  /** Beteendebaserad genreaffinitet i [−1, 1] (lib/genreStats). */
  affinity?: (genreIds: number[]) => number;
};

export function fallbackScore(c: PickCandidate, opts: FallbackOptions): number {
  const aff = opts.affinity ? opts.affinity(c.genreIds) : 0;
  // Överraskning: utanför vanan är en fördel, inte en nackdel.
  let s = bayesQuality(c.voteAverage, c.voteCount) + (opts.surprise ? -0.8 : 0.8) * aff;
  if (c.onUserServices === true) s += 0.3;
  if (c.recRank != null) s += Math.max(0, 0.5 - c.recRank * 0.02);
  if (opts.surprise) {
    if (!c.fromSaved) s += 50;
  } else if (opts.priority === "strong" && c.fromSaved) {
    s += 100;
  }
  return s;
}

/**
 * Deterministiskt val när LLM:en fallerar: bästa kandidaten enligt samma
 * SAVED-först-prioritet som prompten, alternativ helst en sparad + en färsk.
 */
export function fallbackSelection(
  cands: PickCandidate[],
  opts: FallbackOptions,
): { pick: PickCandidate; alternatives: PickCandidate[] } | null {
  if (cands.length === 0) return null;
  const scored = cands
    .map((c, i) => ({ c, s: fallbackScore(c, opts), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
  const pick = scored[0];
  const rest = scored.slice(1);
  const alts: PickCandidate[] = [];
  if (opts.priority === "strong" || opts.surprise) {
    const saved = rest.find((c) => c.fromSaved);
    const fresh = rest.find((c) => !c.fromSaved);
    if (saved) alts.push(saved);
    if (fresh) alts.push(fresh);
  }
  for (const c of rest) {
    if (alts.length >= 2) break;
    if (!alts.includes(c)) alts.push(c);
  }
  return { pick, alternatives: alts.slice(0, 2) };
}

/* ======================================================================
 * Leverantörer
 * ==================================================================== */

/**
 * Tjänstenamn (Profile.providers) → TMDB provider-id:n. Samma tabell som
 * PROVIDER_MAP i lib/unifiedRecs.ts (privat där) plus kända alias-id:n för
 * reklamfinansierade nivåer, så "finns på dina tjänster" inte blir falskt nej.
 */
const PROVIDER_IDS: Record<string, number[]> = {
  netflix: [8, 1796],
  "prime video": [119, 9, 2100],
  "amazon prime video": [119, 9, 2100],
  "disney+": [337],
  "apple tv+": [350, 2],
  "apple tv plus": [350, 2],
  viaplay: [76, 73],
  "svt play": [383],
  hbo: [1899, 384],
  max: [1899, 384],
  "hbo max": [1899, 384],
  "tv4 play": [113],
  "c more": [75],
  "discovery+": [415, 510],
  skyshowtime: [1773],
  "tele2 play": [323],
};

/** Discover-filtret: exakt samma id:n som recommendern använder. */
const DISCOVER_PROVIDER_ID: Record<string, number> = {
  netflix: 8,
  "prime video": 119,
  "amazon prime video": 119,
  "disney+": 337,
  "apple tv+": 350,
  "apple tv plus": 350,
  viaplay: 73,
  "svt play": 383,
  hbo: 1899,
  max: 1899,
  "hbo max": 1899,
  "tv4 play": 113,
  "c more": 75,
  "discovery+": 415,
  skyshowtime: 1773,
  "tele2 play": 323,
};

export type UserServices = { ids: Set<number>; names: string[]; discoverIds: number[] };

export function resolveUserServices(providerStrings: string[]): UserServices {
  const ids = new Set<number>();
  const discover = new Set<number>();
  const names: string[] = [];
  for (const raw of providerStrings) {
    const k = raw.toLowerCase().trim();
    if (!k) continue;
    names.push(k);
    for (const id of PROVIDER_IDS[k] ?? []) ids.add(id);
    const d = DISCOVER_PROVIDER_ID[k];
    if (d) discover.add(d);
  }
  return { ids, names, discoverIds: Array.from(discover) };
}

function nameMatchesService(providerName: string, services: UserServices): boolean {
  const n = providerName.toLowerCase();
  return services.names.some((s) => {
    const core = s.replace(/\+$/, "").replace(/ play$/, "").trim();
    return core.length >= 3 && n.includes(core);
  });
}

export function onUserServices(
  providers: CandidateProvider[] | null,
  services: UserServices,
): boolean | null {
  if (services.names.length === 0) return null; // användaren har inte angett tjänster
  if (providers == null) return null; // okänt
  return providers.some((p) => services.ids.has(p.id) || nameMatchesService(p.name, services));
}

/* ======================================================================
 * TMDB (samma tokenkonvention som recs-pipelinen: V4-token, annars API-nyckel)
 * ==================================================================== */

const DETAILS_REVALIDATE_S = 6 * 60 * 60;

async function tmdbJson<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  revalidate: number,
): Promise<T | null> {
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN ?? process.env.TMDB_READ_TOKEN;
  const v3 = process.env.TMDB_API_KEY;
  if (!v4 && !v3) return null;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  if (!v4 && v3) usp.set("api_key", v3);
  const url = `https://api.themoviedb.org/3${path}${usp.toString() ? `?${usp}` : ""}`;
  try {
    // tmdbFetch = concurrency-tak + retry (lib/tmdbClient.ts). revalidate i
    // stället för no-store: titeldata/providers är stabila på timskala.
    const res = await tmdbFetch(url, {
      headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type TmdbProviderEntry = { provider_id: number; provider_name: string; logo_path: string | null; display_priority?: number };
type TmdbRegionProviders = { flatrate?: TmdbProviderEntry[]; free?: TmdbProviderEntry[]; ads?: TmdbProviderEntry[] };

type TmdbDetailsRaw = {
  id: number;
  title?: string;
  name?: string;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  runtime?: number | null;
  episode_run_time?: number[] | null;
  last_episode_to_air?: { runtime?: number | null } | null;
  next_episode_to_air?: { runtime?: number | null } | null;
  number_of_seasons?: number | null;
  genres?: { id: number; name: string }[];
  vote_average?: number | null;
  vote_count?: number | null;
  original_language?: string | null;
  "watch/providers"?: { results?: Record<string, TmdbRegionProviders> };
};

type DetailsInput = {
  tmdbId: number;
  mediaType: MediaType;
  fromSaved: boolean;
  likedAt: Date | null;
  recRank: number | null;
  fromDiscover?: boolean;
};

function yearOf(date: string | null | undefined): number | null {
  if (!date || date.length < 4) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function tvRuntime(d: TmdbDetailsRaw): number | null {
  const ep = (d.episode_run_time ?? []).filter((n) => Number.isFinite(n) && n > 0);
  if (ep.length > 0) return Math.round(ep.reduce((a, b) => a + b, 0) / ep.length);
  const last = d.last_episode_to_air?.runtime ?? d.next_episode_to_air?.runtime ?? null;
  return last && last > 0 ? last : null;
}

function regionProviders(d: TmdbDetailsRaw, region: string): CandidateProvider[] | null {
  const root = d["watch/providers"]?.results;
  if (!root) return null;
  const r = root[region];
  if (!r) return []; // TMDB har data men inget för regionen → inte streambar här
  const seen = new Set<number>();
  const out: (CandidateProvider & { prio: number })[] = [];
  for (const list of [r.flatrate, r.free, r.ads]) {
    for (const p of list ?? []) {
      if (seen.has(p.provider_id)) continue;
      seen.add(p.provider_id);
      out.push({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path ?? null, prio: p.display_priority ?? 99 });
    }
  }
  return out.sort((a, b) => a.prio - b.prio).map(({ id, name, logoPath }) => ({ id, name, logoPath }));
}

async function fetchCandidate(
  input: DetailsInput,
  tmdbLocale: string,
  region: string,
  services: UserServices,
): Promise<PickCandidate | null> {
  const d = await tmdbJson<TmdbDetailsRaw>(
    `/${input.mediaType}/${input.tmdbId}`,
    { language: tmdbLocale, append_to_response: "watch/providers" },
    DETAILS_REVALIDATE_S,
  );
  if (!d || !d.id) return null;
  const title = (input.mediaType === "movie" ? d.title : d.name) ?? "";
  if (!title) return null;
  const providers = regionProviders(d, region);
  const overview = (d.overview ?? "").trim();
  return {
    key: candidateKey(input.mediaType, input.tmdbId),
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    fromSaved: input.fromSaved,
    likedAt: input.likedAt,
    title,
    year: yearOf(input.mediaType === "movie" ? d.release_date : d.first_air_date),
    posterPath: d.poster_path ?? null,
    backdropPath: d.backdrop_path ?? null,
    runtimeMin: input.mediaType === "movie" ? (d.runtime && d.runtime > 0 ? d.runtime : null) : tvRuntime(d),
    seasons: input.mediaType === "tv" ? d.number_of_seasons ?? null : null,
    genreIds: (d.genres ?? []).map((g) => g.id),
    genreNames: (d.genres ?? []).map((g) => g.name).filter(Boolean),
    voteAverage: typeof d.vote_average === "number" && d.vote_count ? d.vote_average : null,
    voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
    overview: overview || null,
    originalLanguage: d.original_language ?? null,
    providers,
    onUserServices: onUserServices(providers, services),
    recRank: input.recRank,
    fromDiscover: input.fromDiscover,
  };
}

async function enrichAll(
  inputs: DetailsInput[],
  tmdbLocale: string,
  region: string,
  services: UserServices,
): Promise<PickCandidate[]> {
  // Parallellt; trycket begränsas av concurrency-taket i lib/tmdbClient.
  const res = await Promise.all(inputs.map((i) => fetchCandidate(i, tmdbLocale, region, services)));
  return res.filter((c): c is PickCandidate => c !== null);
}

type GenreList = { genres?: { id: number; name: string }[] };

async function genreNameMap(tmdbLocale: string): Promise<Map<number, string>> {
  const [m, t] = await Promise.all([
    tmdbJson<GenreList>("/genre/movie/list", { language: tmdbLocale }, 7 * 24 * 3600),
    tmdbJson<GenreList>("/genre/tv/list", { language: tmdbLocale }, 7 * 24 * 3600),
  ]);
  const map = new Map<number, string>();
  for (const g of [...(m?.genres ?? []), ...(t?.genres ?? [])]) if (!map.has(g.id)) map.set(g.id, g.name);
  return map;
}

/* ======================================================================
 * Smaksammanfattning
 * ==================================================================== */

export type TasteSummary = {
  topGenres: string[];
  avoidGenres: string[];
  favoriteMovie: string | null;
  favoriteShow: string | null;
  recentLoved: string[];
  savedTotal: number;
};

/**
 * Rangordnar genrer på beteende. Absolut andel positiva duger inte — även en
 * favoritgenre kan ligga under 50 % hos storsvepare (benchmarken 2026-08-14:
 * Kriminal 48 % negativ var BÄSTA genren) — så det relativa läget avgör.
 */
export function rankGenresByBehaviour(stats: GenreStats, minSample = 8): { top: number[]; avoid: number[] } {
  const rows = Object.entries(stats)
    .map(([id, s]) => ({ id: Number(id), total: s.p + s.n, ratio: (s.p + 1) / (s.p + s.n + 2) }))
    .filter((r) => Number.isFinite(r.id) && r.total >= minSample);
  if (rows.length === 0) return { top: [], avoid: [] };
  const sorted = rows.slice().sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  const mean = rows.reduce((s, r) => s + r.ratio, 0) / rows.length;
  const top = sorted.filter((r) => r.ratio >= mean).slice(0, 4).map((r) => r.id);
  const avoid = sorted
    .slice()
    .reverse()
    .filter((r) => r.ratio < mean - 0.12 && r.total >= minSample * 2)
    .slice(0, 3)
    .map((r) => r.id);
  return { top, avoid };
}

function behaviouralAffinity(stats: GenreStats): (ids: number[]) => number {
  return (ids) => {
    let sum = 0;
    let n = 0;
    for (const id of ids) {
      const s = stats[String(id)];
      if (!s || s.p + s.n < 5) continue;
      sum += (s.p - s.n) / (s.p + s.n + 4);
      n++;
    }
    return n ? Math.max(-1, Math.min(1, sum / n)) : 0;
  };
}

function favTitle(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const t = typeof o.title === "string" ? o.title : typeof o.name === "string" ? o.name : null;
  if (!t) return null;
  const y = typeof o.year === "string" || typeof o.year === "number" ? String(o.year).slice(0, 4) : "";
  return y ? `${t} (${y})` : t;
}

/* ======================================================================
 * Huvudfunktion
 * ==================================================================== */

export type BuildCandidatesInput = {
  uid: string;
  region?: string | null;
  tmdbLocale: "sv-SE" | "en-US";
  mediaFilter: MediaFilter;
  chips: PickChipId[];
  prompt: string | null;
  exclude: number[];
  priority: SavedPriority;
};

export type CandidateSet = {
  candidates: PickCandidate[];
  savedCount: number;
  freshCount: number;
  intent: PickIntent;
  effectiveFilter: MediaFilter;
  taste: TasteSummary;
  affinity: (ids: number[]) => number;
  services: UserServices;
  region: string;
  debug: {
    savedTotal: number;
    savedEligible: number;
    savedEnriched: number;
    freshRecs: number;
    discoverRan: boolean;
    recsTimedOut: boolean;
    msCandidates: number;
  };
};

const MAX_CANDIDATES = 30;
const RECS_TIMEOUT_MS = 9000;
const MIN_POOL = 12;

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<{ v: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ v: onTimeout, timedOut: true }), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve({ v, timedOut: false });
      },
      () => {
        clearTimeout(t);
        resolve({ v: onTimeout, timedOut: false });
      },
    );
  });
}

export async function buildCandidates(input: BuildCandidatesInput): Promise<CandidateSet | null> {
  const t0 = Date.now();
  const intent = parseIntent(input.prompt, input.chips);
  const filter = effectiveMediaFilter(input.mediaFilter, intent);
  const wantType = (t: string) => filter === "both" || t === filter;
  const excludeIds = new Set(input.exclude);

  const [profile, watch, ratings, stats] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId: input.uid },
      select: {
        region: true,
        dob: true,
        providers: true,
        favoriteMovie: true,
        favoriteShow: true,
        favoriteGenres: true,
        showKidsContent: true,
      },
    }),
    prisma.watchlist.findMany({
      where: { userId: input.uid },
      select: { tmdbId: true, mediaType: true, addedAt: true },
      orderBy: { addedAt: "desc" },
      take: 1000,
    }),
    prisma.rating.findMany({
      where: { userId: input.uid },
      select: { tmdbId: true, mediaType: true, rating: true, decision: true, decidedAt: true },
      take: 10000,
    }),
    loadGenreStats(input.uid),
  ]);
  if (!profile) return null;

  const region = (input.region || profile.region || "SE").toUpperCase();
  const services = resolveUserServices(parseProvidersJson(profile.providers));
  const affinity = behaviouralAffinity(stats);

  const ratingByKey = new Map<string, { rating: number | null; decision: string; decidedAt: Date }>();
  for (const r of ratings) ratingByKey.set(`${r.mediaType}_${r.tmdbId}`, r);
  const knownKeys = new Set<string>([...ratingByKey.keys(), ...watch.map((w) => `${w.mediaType}_${w.tmdbId}`)]);

  /* ---- 1. Sparade likes ---- */
  const savedEligible: SavedRow[] = watch
    .map((w) => ({ tmdbId: w.tmdbId, mediaType: w.mediaType as MediaType, addedAt: w.addedAt }))
    .filter((w) => w.mediaType === "movie" || w.mediaType === "tv")
    .filter((w) => !isSavedExcluded(w, ratingByKey.get(`${w.mediaType}_${w.tmdbId}`)))
    .filter((w) => wantType(w.mediaType) && !excludeIds.has(w.tmdbId));

  // Smaksammanfattningen behöver bara datan ovan — starta den redan nu så
  // dess TMDB-uppslag löper parallellt med kandidatberikningen.
  const tastePromise = buildTasteSummary({
    stats,
    ratings,
    favoriteMovie: profile.favoriteMovie,
    favoriteShow: profile.favoriteShow,
    declaredGenres: profile.favoriteGenres ?? [],
    savedTotal: savedEligible.length,
    tmdbLocale: input.tmdbLocale,
    region,
    services,
  });

  const hasFilters =
    intentHasGenreFilter(intent) || intent.maxRuntimeMovie != null || intent.maxRuntimeTv != null;
  const enrichN = hasFilters ? 48 : 32;
  const savedPick = selectSavedForEnrichment(savedEligible, enrichN);
  const recentCut = Math.round(Math.min(enrichN, savedEligible.length) * 0.6);

  const savedPromise = enrichAll(
    savedPick.map((s) => ({ tmdbId: s.tmdbId, mediaType: s.mediaType, fromSaved: true, likedAt: s.addedAt, recRank: null })),
    input.tmdbLocale,
    region,
    services,
  );

  /* ---- 2. Färska (recommendern) — parallellt med berikningen ovan ---- */
  const recsPromise = withTimeout(
    computeUnifiedRecs({
      uid: input.uid,
      region,
      locale: input.tmdbLocale,
      groupCode: null,
      forceAllMedia: true,
    }).then((r) => (r.ok ? r.items : [])),
    RECS_TIMEOUT_MS,
    [],
  );

  const [savedEnriched, recs] = await Promise.all([savedPromise, recsPromise]);

  // Sparade: hårda krav + finns på användarens tjänster (när det är känt).
  const savedOk = savedEnriched.filter(
    (c) => matchesIntent(c, intent) && c.onUserServices !== false,
  );
  const savedMax = input.priority === "strong" ? 18 : 12;
  const recentIdx = new Set(savedPick.slice(0, recentCut).map((s) => candidateKey(s.mediaType, s.tmdbId)));
  const savedRecent = savedOk.filter((c) => recentIdx.has(c.key));
  const savedOlder = savedOk.filter((c) => !recentIdx.has(c.key));
  const saved: PickCandidate[] = [...savedRecent.slice(0, 12), ...savedOlder.slice(0, 6)];
  for (const c of savedOk) {
    if (saved.length >= savedMax) break;
    if (!saved.includes(c)) saved.push(c);
  }
  saved.splice(savedMax);

  const freshMax = Math.min(20, Math.max(12, MAX_CANDIDATES - saved.length));
  const recItems = recs.v
    .filter((it) => wantType(it.tmdbType) && !excludeIds.has(it.id))
    .filter((it) => !knownKeys.has(`${it.tmdbType}_${it.id}`))
    .slice(0, freshMax + 8);
  const freshEnriched = await enrichAll(
    recItems.map((it, i) => ({ tmdbId: it.id, mediaType: it.tmdbType, fromSaved: false, likedAt: null, recRank: i })),
    input.tmdbLocale,
    region,
    services,
  );
  let fresh = freshEnriched.filter((c) => matchesIntent(c, intent)).slice(0, freshMax);

  /* ---- 3. Extra discover-pass vid tunn pool / överraskning ---- */
  let discoverRan = false;
  const poolThin = saved.length + fresh.length < MIN_POOL;
  if (poolThin || intent.surprise) {
    discoverRan = true;
    const { top } = rankGenresByBehaviour(stats);
    const extra = await discoverPass({
      intent,
      filter,
      region,
      tmdbLocale: input.tmdbLocale,
      services,
      certMax: seMaxCert(ageFromDob(new Date(profile.dob))),
      showKids: profile.showKidsContent === true || intent.wantsFamily,
      avoidTop: intent.surprise ? top.slice(0, 2) : [],
      skip: (t, id) => knownKeys.has(`${t}_${id}`) || excludeIds.has(id),
      limit: intent.surprise ? 10 : 16,
    });
    const have = new Set([...saved, ...fresh].map((c) => c.key));
    const extraOk = extra.filter((c) => !have.has(c.key) && matchesIntent(c, intent));
    fresh = [...fresh, ...extraOk].slice(0, Math.max(freshMax, MAX_CANDIDATES - saved.length));
  }

  const candidates = [...saved, ...fresh].slice(0, MAX_CANDIDATES);

  const taste = await tastePromise;

  return {
    candidates,
    savedCount: candidates.filter((c) => c.fromSaved).length,
    freshCount: candidates.filter((c) => !c.fromSaved).length,
    intent,
    effectiveFilter: filter,
    taste,
    affinity,
    services,
    region,
    debug: {
      savedTotal: watch.length,
      savedEligible: savedEligible.length,
      savedEnriched: savedEnriched.length,
      freshRecs: recs.v.length,
      discoverRan,
      recsTimedOut: recs.timedOut,
      msCandidates: Date.now() - t0,
    },
  };
}

type DiscoverItem = { id: number; vote_count?: number };

async function discoverPass(opts: {
  intent: PickIntent;
  filter: MediaFilter;
  region: string;
  tmdbLocale: string;
  services: UserServices;
  certMax: string;
  showKids: boolean;
  avoidTop: number[];
  skip: (t: MediaType, id: number) => boolean;
  limit: number;
}): Promise<PickCandidate[]> {
  const { intent, filter, region, tmdbLocale, services } = opts;
  const providers = services.discoverIds.length > 0 ? services.discoverIds.join("|") : undefined;
  const types: MediaType[] = filter === "both" ? ["movie", "tv"] : [filter];

  const lists = await Promise.all(
    types.map(async (t) => {
      const genres = t === "movie" ? intent.movieGenres : intent.tvGenres;
      const avoid = new Set<number>([
        ...(t === "movie" ? intent.avoidMovieGenres : intent.avoidTvGenres),
        ...opts.avoidTop.filter((g) => !genres.includes(g)),
        ...(opts.showKids ? [] : t === "movie" ? [10751] : [10762, 10751]),
      ]);
      const maxRt = t === "movie" ? intent.maxRuntimeMovie : null; // TV: avsnittslängd filtreras efteråt
      const data = await tmdbJson<{ results?: DiscoverItem[] }>(
        `/discover/${t}`,
        {
          language: tmdbLocale,
          region: t === "movie" ? region : undefined,
          watch_region: region,
          with_watch_providers: providers,
          with_genres: genres.length ? genres.join("|") : undefined,
          without_genres: avoid.size ? Array.from(avoid).join(",") : undefined,
          "with_runtime.lte": maxRt ?? undefined,
          certification_country: t === "movie" ? "SE" : undefined,
          "certification.lte": t === "movie" ? opts.certMax : undefined,
          sort_by: intent.surprise ? "vote_average.desc" : "popularity.desc",
          "vote_count.gte": intent.surprise ? 800 : 150,
          include_adult: "false",
          page: 1,
        },
        DETAILS_REVALIDATE_S,
      );
      return (data?.results ?? [])
        .filter((r) => Number.isFinite(r.id) && !opts.skip(t, r.id))
        .map((r) => ({ tmdbId: r.id, mediaType: t }));
    }),
  );

  // Varva film/serie så "both" inte bara blir filmer.
  const merged: { tmdbId: number; mediaType: MediaType }[] = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen && merged.length < opts.limit; i++) {
    for (const l of lists) if (l[i] && merged.length < opts.limit) merged.push(l[i]);
  }
  return enrichAll(
    merged.map((m, i) => ({ ...m, fromSaved: false, likedAt: null, recRank: 30 + i, fromDiscover: true })),
    tmdbLocale,
    region,
    services,
  );
}

async function buildTasteSummary(opts: {
  stats: GenreStats;
  ratings: { tmdbId: number; mediaType: string; rating: number | null; decidedAt: Date }[];
  favoriteMovie: unknown;
  favoriteShow: unknown;
  declaredGenres: string[];
  savedTotal: number;
  tmdbLocale: "sv-SE" | "en-US";
  region: string;
  services: UserServices;
}): Promise<TasteSummary> {
  const { top, avoid } = rankGenresByBehaviour(opts.stats);
  const loved = opts.ratings
    .filter((r) => r.rating != null && r.rating >= 8 && (r.mediaType === "movie" || r.mediaType === "tv"))
    .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())
    .slice(0, 7);

  const [names, lovedTitles] = await Promise.all([
    top.length || avoid.length ? genreNameMap(opts.tmdbLocale) : Promise.resolve(new Map<number, string>()),
    Promise.all(
      loved.map(async (r) => {
        const c = await fetchCandidate(
          { tmdbId: r.tmdbId, mediaType: r.mediaType as MediaType, fromSaved: false, likedAt: null, recRank: null },
          opts.tmdbLocale,
          opts.region,
          opts.services,
        );
        return c ? `${c.title}${c.year ? ` (${c.year})` : ""} ${r.rating}/10` : null;
      }),
    ),
  ]);

  const topGenres = top.map((id) => names.get(id)).filter((n): n is string => !!n);
  return {
    // Utan beteendedata: fall tillbaka på de deklarerade (svenska) genrerna.
    topGenres: topGenres.length > 0 ? topGenres : opts.declaredGenres.slice(0, 4),
    avoidGenres: avoid.map((id) => names.get(id)).filter((n): n is string => !!n),
    favoriteMovie: favTitle(opts.favoriteMovie),
    favoriteShow: favTitle(opts.favoriteShow),
    recentLoved: lovedTitles.filter((t): t is string => !!t),
    savedTotal: opts.savedTotal,
  };
}

/* ======================================================================
 * PickItem
 * ==================================================================== */

const TMDB_LOGO = "https://image.tmdb.org/t/p/w92";

export function toPickProviders(c: PickCandidate, services: UserServices): PickProvider[] {
  if (!c.providers) return [];
  const own = (p: CandidateProvider) => services.ids.has(p.id) || nameMatchesService(p.name, services);
  const sorted = c.providers.slice().sort((a, b) => Number(own(b)) - Number(own(a)));
  const seen = new Set<string>();
  const out: PickProvider[] = [];
  for (const p of sorted) {
    const k = p.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: p.name, logo: p.logoPath ? `${TMDB_LOGO}${p.logoPath}` : providerLogoUrl(p.name) });
    if (out.length >= 4) break;
  }
  return out;
}

export function toPickItem(c: PickCandidate, services: UserServices): PickItem {
  return {
    tmdbId: c.tmdbId,
    mediaType: c.mediaType,
    title: c.title,
    year: c.year,
    poster: tmdbPoster(c.posterPath, "w500"),
    backdrop: tmdbPoster(c.backdropPath, "w780"),
    runtimeMin: c.runtimeMin,
    genres: c.genreNames.slice(0, 3),
    rating: c.voteAverage != null ? Math.round(c.voteAverage * 10) / 10 : null,
    overview: c.overview,
    providers: toPickProviders(c, services),
    inWatchlist: c.fromSaved,
    likedAt: c.likedAt ? c.likedAt.toISOString() : null,
    fromSaved: c.fromSaved,
  };
}
