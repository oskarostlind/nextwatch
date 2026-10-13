// lib/aiPick/candidates.ts
//
// Kandidatmängden till "Välj åt mig". Två pooler, i Oskars prioritetsordning:
//
//   1. SPARADE LIKES (primär): titlar användaren svept JA på och som ligger i
//      watchlisten men inte är sedda/betygsatta. Hela poängen med funktionen är
//      att få folk att faktiskt titta på det de gillat — även gamla, bortglömda
//      likes ska komma upp, inte bara de senaste.
//   2. FÄRSKA (sekundär): computeUnifiedRecs (lib/unifiedRecs.ts) — samma
//      recommender som swipe-leken, ingen fork — plus upp till 4 TMDB-discover-
//      anrop på användarens tjänster (önskade genrer + populärt + topplistat)
//      och, när fritexten nämner en titel ("tycker om serien House"), TMDB:s
//      recommendations/similar för den titeln.
//
// v2 (2026-10-13, efter prod-felet): chips/fritext är MJUKA signaler. Bara
// film/serie-filtret, "redan sett/betygsatt/nej-svept" och `exclude` är hårda.
// Genre/speltid/stämning ger poäng (intentFit) och en "fits request"-not i
// prompten — aldrig ett bortfall. Finns det många träffar hamnar de först och
// fyller hela listan; finns det få fylls resten med de närmaste. v1 filtrerade
// hårt och "serie, 20-40 min avsnitt, drama, gillar House" gav EN kandidat —
// och "Visa något annat" sa sedan att inget passade.
//
// Rena funktioner (parseIntent, intentFit, fallbackScore, selectFinalCandidates,
// fillAlternatives, extractTitleReference, matchReferenceResult,
// planDiscoverCalls …) är exporterade och testbara utan DB/TMDB.

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
  /** Kom ur ett discover-pass. */
  fromDiscover?: boolean;
  /** TMDB-rekommendation för titeln användaren nämnde ("tycker om House"). */
  similarTo?: string | null;
  /** Klarar alla önskemål (genre/speltid/undvik) — sätts av scoreCandidates. */
  strictMatch?: boolean;
  /** Mjuk passform mot önskemålen (intentFit), ~[−3, 2]. */
  fit?: number;
};

export function candidateKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType === "movie" ? "m" : "t"}${tmdbId}`;
}

/* ======================================================================
 * Intent: chips + nyckelord → mjuka önskemål (poäng, inte filter)
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

export const LIGHT_GENRES = { movie: [35, 10749, 10751], tv: [35, 10751] };
export const THRILL_GENRES = { movie: [53, 27, 80, 9648], tv: [80, 9648, 10759, 10765] };
export const LIGHT_AVOID = { movie: [27, 53], tv: [] as number[] };

export const SHORT_MOVIE_MAX = 90; // chippet heter "Max 90 min" — håll siffrorna lika
export const SHORT_TV_MAX = 35;

/** Fritextens film/serie-ledtråd (null = ingen eller båda). */
export function mediaHintOf(text: string | null | undefined): MediaType | null {
  const t = (text ?? "").toLowerCase();
  if (!t) return null;
  const m = MOVIE_RE.test(t);
  const s = TV_RE.test(t);
  if (m && !s) return "movie";
  if (s && !m) return "tv";
  return null;
}

export type GenreIntent = { movie: number[]; tv: number[]; labels: string[]; anyTv: boolean; wantsFamily: boolean };

/** Bara de uttryckligen nämnda genrerna (ingen stämning, ingen speltid). */
export function explicitGenres(text: string | null | undefined): GenreIntent {
  const t = (text ?? "").toLowerCase();
  const out: GenreIntent = { movie: [], tv: [], labels: [], anyTv: false, wantsFamily: false };
  if (!t) return out;
  for (const rule of GENRE_RULES) {
    if (!rule.re.test(t)) continue;
    out.labels.push(rule.label);
    out.movie.push(...rule.movie);
    out.tv.push(...rule.tv);
    if (rule.tv.length > 0) out.anyTv = true;
    if (rule.label === "family" || rule.label === "animation") out.wantsFamily = true;
  }
  out.movie = uniq(out.movie);
  out.tv = out.anyTv ? uniq(out.tv) : [];
  return out;
}

function uniq(nums: number[]): number[] {
  return Array.from(new Set(nums));
}

function validMinutes(n: number): number | null {
  return Number.isFinite(n) && n >= 20 && n <= 240 ? n : null;
}

/**
 * Plockar ut speltidsönskemålet: "20-40 min" → 40 (övre gränsen), "max 90" /
 * "under 90" → 90, "ca 45 min" → 55 (ungefär = lite marginal), "90 min" → 90.
 * Intervall kräver enhet så "80-90-talet" inte tolkas som minuter.
 */
export function explicitMinutes(text: string): number | null {
  const range = text.match(/(?<!\d)(\d{2,3})\s*(?:-|–|—|till|to)\s*(\d{2,3})\s*(?:min|minuter|minutes|mins)/iu);
  if (range) return validMinutes(Math.max(Number(range[1]), Number(range[2])));
  const cap = text.match(/(?:max|högst|under|mindre än|less than|at most|up to|max\.)\s*(\d{2,3})/iu);
  if (cap) return validMinutes(Number(cap[1]));
  const approx = text.match(/(?:ca\.?|cirka|runt|ungefär|omkring|about|around|~)\s*(\d{2,3})\s*(?:min|minuter|minutes|mins)/iu);
  if (approx) return validMinutes(Number(approx[1]) + 10);
  const plain = text.match(/(\d{2,3})\s*(?:min|minuter|minutes|mins)\b/iu);
  if (plain) return validMinutes(Number(plain[1]));
  return null;
}

// "40 min avsnitt" gäller avsnittslängd — inte filmer.
const EPISODE_RE = /avsnitt|episod|episode/iu;

export function parseIntent(prompt: string | null | undefined, chips: readonly PickChipId[] = []): PickIntent {
  const text = (prompt ?? "").toLowerCase();
  const chipSet = new Set(chips);

  const g = explicitGenres(text);
  const terms: string[] = [...g.labels];
  const movieGenres: number[] = [...g.movie];
  const tvGenres: number[] = [...g.tv];
  let anyTvMapped = g.anyTv;
  const wantsFamily = g.wantsFamily;

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
    const episodeOnly = EPISODE_RE.test(text);
    maxRuntimeMovie = episodeOnly ? (shortWord ? SHORT_MOVIE_MAX : null) : minutes;
    maxRuntimeTv = shortWord ? Math.min(minutes, SHORT_TV_MAX) : minutes;
    terms.push(`max${minutes}`);
  } else if (shortWord) {
    maxRuntimeMovie = SHORT_MOVIE_MAX;
    maxRuntimeTv = SHORT_TV_MAX;
    terms.push("short");
  }
  if (surprise) terms.push("surprise");

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
    mediaHint: mediaHintOf(text),
    wantsFamily,
    terms,
  };
}

export function intentHasGenreFilter(intent: PickIntent, mediaType?: MediaType): boolean {
  if (mediaType === "movie") return intent.movieGenres.length > 0;
  if (mediaType === "tv") return intent.tvGenres.length > 0;
  return intent.movieGenres.length > 0 || intent.tvGenres.length > 0;
}

/**
 * Effektivt film/serie-filter. Det användaren SKRIVER vinner över swipe-vyns
 * filter: "Kan du rekommendera en film?" med Serier valt i swipen gav en serie
 * (prod 2026-10-13). mediaHintOf ger bara en typ när texten nämner exakt en av
 * dem, så "favoritfilmer … ge mig en serie" faller tillbaka på filtret.
 */
export function effectiveMediaFilter(filter: MediaFilter, intent: PickIntent): MediaFilter {
  return intent.mediaHint ?? filter;
}

type IntentCheckable = Pick<PickCandidate, "mediaType" | "genreIds" | "runtimeMin">;

/** Har önskemålen något som faktiskt skiljer kandidater åt (genre/speltid/undvik)? */
export function intentHasConstraints(intent: PickIntent): boolean {
  return (
    intentHasGenreFilter(intent) ||
    intent.maxRuntimeMovie != null ||
    intent.maxRuntimeTv != null ||
    intent.avoidMovieGenres.length > 0 ||
    intent.avoidTvGenres.length > 0
  );
}

/**
 * Klarar kandidaten ALLA önskemål? (v2: används för rangordning och prompt-
 * noten "fits request" — inte längre som filter.) Okänd speltid/genre räknas
 * som träff — hellre låta modellen bedöma än att straffa saknad TMDB-data.
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

/**
 * Mjuk passform mot önskemålen. Genreträff +1 (+0.2 per extra träff), miss
 * −0.8; undvikna genrer −1.2; speltid inom gränsen +0.6, över gränsen ett
 * avdrag som växer med överskottet (max −1.5) — 44 min när man bad om 40 är
 * nästan lika bra, 90 min är det inte. Okänt = 0.
 */
export function intentFit(c: IntentCheckable, intent: PickIntent): { strict: boolean; fit: number } {
  const wanted = c.mediaType === "movie" ? intent.movieGenres : intent.tvGenres;
  const avoid = c.mediaType === "movie" ? intent.avoidMovieGenres : intent.avoidTvGenres;
  const maxRt = c.mediaType === "movie" ? intent.maxRuntimeMovie : intent.maxRuntimeTv;
  let fit = 0;
  if (c.genreIds.length > 0) {
    if (wanted.length > 0) {
      const hits = c.genreIds.filter((g) => wanted.includes(g)).length;
      fit += hits > 0 ? 1 + 0.2 * Math.min(2, hits - 1) : -0.8;
    }
    if (avoid.length > 0 && c.genreIds.some((g) => avoid.includes(g))) fit -= 1.2;
  }
  if (maxRt != null && c.runtimeMin != null) {
    fit += c.runtimeMin <= maxRt ? 0.6 : -Math.min(1.5, (c.runtimeMin - maxRt) / 15);
  }
  return { strict: matchesIntent(c, intent), fit };
}

/** Sätter strictMatch/fit på kandidaterna (muterar, returnerar samma lista). */
export function scoreCandidates<T extends PickCandidate>(cands: T[], intent: PickIntent): T[] {
  for (const c of cands) {
    const r = intentFit(c, intent);
    c.strictMatch = r.strict;
    c.fit = r.fit;
  }
  return cands;
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
  /** Bad användaren om något konkret (genre/speltid)? Då väger strictMatch. */
  constrained?: boolean;
};

/**
 * Rangordningspoäng — samma ordning i urvalet till modellen, i fallbacken och
 * när alternativ fylls på. SAVED väger tungt (Oskar: "vikta de jag redan
 * gillat extra mycket") men bara fullt ut när titeln passar önskemålen: en
 * sparad titel som inte alls passar ska inte slå en färsk som passar perfekt.
 */
export function fallbackScore(c: PickCandidate, opts: FallbackOptions): number {
  const aff = opts.affinity ? opts.affinity(c.genreIds) : 0;
  // Överraskning: utanför vanan är en fördel, inte en nackdel.
  let s = bayesQuality(c.voteAverage, c.voteCount) + (opts.surprise ? -0.8 : 0.8) * aff;
  if (c.onUserServices === true) s += 0.3;
  else if (c.onUserServices === false) s -= 1.5;
  if (c.recRank != null) s += Math.max(0, 0.5 - c.recRank * 0.02);
  s += (c.fit ?? 0) * 1.5;
  if (opts.constrained && c.strictMatch) s += 2;
  if (c.similarTo) s += 1.5;
  if (opts.surprise) {
    if (!c.fromSaved) s += 50;
  } else if (opts.priority === "strong" && c.fromSaved) {
    s += opts.constrained && c.strictMatch === false ? 3 : 100;
  }
  return s;
}

/** Bäst först enligt fallbackScore (stabil vid lika poäng). */
export function rankCandidates(cands: PickCandidate[], opts: FallbackOptions): PickCandidate[] {
  return cands
    .map((c, i) => ({ c, s: fallbackScore(c, opts), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

export const MAX_CANDIDATES = 30;
/** Minst så många färska platser, även när de sparade fyller sin kvot. */
const MIN_FRESH_SLOTS = 12;

/**
 * Listan till modellen: upp till `savedMax` sparade (passande först) + färska
 * (passande/liknande först) upp till MAX_CANDIDATES. Inga hårda bortfall här —
 * passar för få fylls resten med de närmaste.
 */
export function selectFinalCandidates(
  saved: PickCandidate[],
  fresh: PickCandidate[],
  opts: FallbackOptions & { savedMax: number; max?: number },
): PickCandidate[] {
  const max = opts.max ?? MAX_CANDIDATES;
  const s = rankCandidates(saved, opts).slice(0, Math.min(opts.savedMax, max));
  const freshSlots = Math.max(MIN_FRESH_SLOTS, max - s.length);
  const f = rankCandidates(fresh, opts).slice(0, freshSlots);
  // Färska får alltid sina minsta platser; sparade trimmas i så fall bakifrån.
  const keepSaved = Math.max(0, Math.min(s.length, max - f.length));
  return [...s.slice(0, keepSaved), ...f];
}

/**
 * Alltid två alternativ när poolen räcker: modellens giltiga alternativ först,
 * sedan deterministiskt ur rangordningen. I "strong"/överraskningsläge blir
 * det helst en SAVED + en NEW så användaren både påminns och upptäcker.
 */
export function fillAlternatives(
  pick: PickCandidate,
  chosen: PickCandidate[],
  cands: PickCandidate[],
  opts: FallbackOptions,
): PickCandidate[] {
  const out: PickCandidate[] = [];
  const used = new Set<string>([pick.key]);
  const add = (c: PickCandidate | undefined) => {
    if (!c || out.length >= 2 || used.has(c.key)) return;
    used.add(c.key);
    out.push(c);
  };
  for (const c of chosen) add(c);
  if (out.length >= 2) return out;
  const ranked = rankCandidates(cands, opts);
  if (opts.priority === "strong" || opts.surprise) {
    if (!out.some((c) => c.fromSaved)) add(ranked.find((c) => c.fromSaved && !used.has(c.key)));
    if (!out.some((c) => !c.fromSaved)) add(ranked.find((c) => !c.fromSaved && !used.has(c.key)));
  }
  for (const c of ranked) add(c);
  return out;
}

/**
 * Deterministiskt val när LLM:en fallerar: bästa kandidaten enligt samma
 * prioritet som prompten, plus två alternativ (fillAlternatives).
 */
export function fallbackSelection(
  cands: PickCandidate[],
  opts: FallbackOptions,
): { pick: PickCandidate; alternatives: PickCandidate[] } | null {
  if (cands.length === 0) return null;
  const pick = rankCandidates(cands, opts)[0];
  return { pick, alternatives: fillAlternatives(pick, [], cands, opts) };
}

/* ======================================================================
 * "Tycker om serien House" → referenstitel
 * ==================================================================== */

export type TitleReference = {
  query: string;
  mediaHint: MediaType | null;
  /** Kom ur citattecken eller "serien/filmen X" — då är det säkert en titel. */
  explicit: boolean;
};

const REF_STOP = new Set([
  "är", "var", "att", "det", "den", "detta", "dom", "dem", "något", "nåt", "någonting", "nånting", "mycket", "lite",
  "när", "hur", "sånt", "sådant", "sådana", "såna", "som", "man", "jag", "du", "vi", "en", "ett", "med", "och",
  "inte", "alla", "allt", "mest", "bara", "också", "verkligen", "typ", "gärna", "helst", "kolla", "titta", "se",
  "it", "that", "this", "those", "these", "them", "something", "anything", "when", "how", "to", "a", "an", "some",
  "watching", "being", "lots", "really", "very", "most", "all", "stuff", "things", "not", "kind", "sort",
]);

const TYPE_WORD = String.raw`(?:(?:tv-?)?serien|filmen|dokumentären|the (?:tv )?(?:show|series)|the (?:movie|film)|(?:tv )?show|series)`;
const REF_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`(?<!\p{L})(?:tycker om|tyckte om|gillar|gillade|gillat|älskar|älskade|i stil med|liknande|påminner om|ungefär som|typ som|(?:något|nåt|någonting|nånting|serie|serier|film|filmer)\s+som)\s+(?:heter\s+)?(${TYPE_WORD}\s+)?(.+?)(?=\s*[.,!?;:\n(]|\s+(?:och|men|eller|fast|så|för|typ|gärna|helst|med|från)\s|$)`,
    "giu",
  ),
  new RegExp(
    String.raw`(?<!\p{L})(?:i (?:really |also )?(?:like|liked|love|loved|enjoy|enjoyed|adore)|similar to|something like|anything like|stuff like|(?:shows?|series|movies?|films?) like|in the style of|reminds? me of|fans? of)\s+(${TYPE_WORD}\s+)?(.+?)(?=\s*[.,!?;:\n(]|\s+(?:and|but|or|so|because|with|from)\s|$)`,
    "giu",
  ),
];
const QUOTED_RE = /["“”„«»]([^"“”„«»]{2,60})["“”„«»]/u;

function typeWordHint(w: string | undefined): MediaType | null {
  if (!w) return null;
  const t = w.toLowerCase();
  if (/film|movie/.test(t)) return "movie";
  if (/serie|show|series|dokument/.test(t)) return "tv";
  return null;
}

function validRefPhrase(raw: string, explicit: boolean): string | null {
  const q = raw
    .replace(/\s+/g, " ")
    .replace(/\s+(?:tack|please|thanks|pls|plz|kanske|maybe)$/iu, "")
    .replace(/^[\s"'“”„«»-]+|[\s"'“”„«»-]+$/g, "")
    .trim();
  if (q.length < 2 || q.length > 60) return null;
  const words = q.split(" ");
  if (words.length > 6) return null;
  if (explicit) return q;
  if (REF_STOP.has(words[0].toLowerCase())) return null;
  // "gillar drama", "like scary movies" — genre/stämning, inte en titel.
  if (words.length <= 3 && parseIntent(q, []).terms.length > 0) return null;
  if (/^(?:serier|filmer|series|movies|films|shows)$/iu.test(words[words.length - 1]) && words.length <= 3) return null;
  return q;
}

/** Hittar en titel användaren säger att den gillar. null om inget säkert. */
export function extractTitleReference(prompt: string | null | undefined): TitleReference | null {
  const text = (prompt ?? "").trim();
  if (!text) return null;
  const quoted = text.match(QUOTED_RE);
  if (quoted) {
    const q = validRefPhrase(quoted[1], true);
    if (q) return { query: q, mediaHint: null, explicit: true };
  }
  for (const re of REF_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const typeWord = m[1]?.trim();
      const q = validRefPhrase(m[2] ?? "", !!typeWord);
      if (q) return { query: q, mediaHint: typeWordHint(typeWord), explicit: !!typeWord };
    }
  }
  return null;
}

/** Jämförbar titel: gemener, utan skiljetecken/diakritik, utan inledande "the"/"dr". */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:the|dr|doctor) /, "")
    .trim();
}

export type TmdbSearchResult = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  vote_count?: number;
  popularity?: number;
  release_date?: string | null;
  first_air_date?: string | null;
};

/**
 * Exakt titelträff (titel eller originaltitel, normaliserad) med minst 30
 * röster — hellre ingen referens än fel referens. Föredragen typ först, sedan
 * flest röster.
 */
export function matchReferenceResult(
  results: TmdbSearchResult[],
  query: string,
  prefer: MediaType | null,
): (TmdbSearchResult & { media_type: MediaType }) | null {
  const q = normTitle(query);
  if (!q) return null;
  const hits = results
    .filter((r): r is TmdbSearchResult & { media_type: MediaType } => r.media_type === "movie" || r.media_type === "tv")
    .filter((r) => Number.isFinite(r.id) && (r.vote_count ?? 0) >= 30)
    .filter((r) => [r.title, r.name, r.original_title, r.original_name].some((t) => !!t && normTitle(t) === q));
  hits.sort(
    (a, b) =>
      Number(b.media_type === prefer) - Number(a.media_type === prefer) || (b.vote_count ?? 0) - (a.vote_count ?? 0),
  );
  return hits[0] ?? null;
}

/* ======================================================================
 * Discover-plan (max 4 extra anrop)
 * ==================================================================== */

export type DiscoverCall = { type: MediaType; kind: "genre" | "popular" | "top"; page: number };

/** Max antal discover-anrop per val. */
export const DISCOVER_BUDGET = 4;
/** Sluta hämta när så många osedda färska titlar finns. */
export const FRESH_POOL_TARGET = 40;

/**
 * Ordnad plan: önskade genrer → populärt → topplistat → sida 2. Första vågen
 * körs direkt (parallellt), resten bara om poolen fortfarande är < 40.
 */
export function planDiscoverCalls(filter: MediaFilter, intent: PickIntent): { wave1: DiscoverCall[]; wave2: DiscoverCall[] } {
  const types: MediaType[] = filter === "both" ? ["movie", "tv"] : [filter];
  const hasGenres = (t: MediaType) => (t === "movie" ? intent.movieGenres : intent.tvGenres).length > 0;
  const plan: DiscoverCall[] = [];
  const order: DiscoverCall["kind"][] = intent.surprise ? ["top", "popular"] : ["popular", "top"];
  for (const t of types) if (hasGenres(t)) plan.push({ type: t, kind: "genre", page: 1 });
  for (const k of order) for (const t of types) plan.push({ type: t, kind: k, page: 1 });
  for (const t of types) if (hasGenres(t)) plan.push({ type: t, kind: "genre", page: 2 });
  for (const k of order) for (const t of types) plan.push({ type: t, kind: k, page: 2 });
  const budget = plan.slice(0, DISCOVER_BUDGET);
  const firstN = types.length === 2 ? DISCOVER_BUDGET : 3;
  return { wave1: budget.slice(0, firstN), wave2: budget.slice(firstN) };
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
  similarTo?: string | null;
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

// Bokstäver utanför latin (CJK, hangul, kyrilliska …) — se fetchCandidate.
const NON_LATIN = /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u;

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
  let title = (input.mediaType === "movie" ? d.title : d.name) ?? "";
  if (!title) return null;
  // TMDB faller tillbaka på originaltiteln när svensk översättning saknas —
  // för anime/k-drama blir det 鬼滅の刃 i stället för Demon Slayer. Prova den
  // engelska titeln (cachad) när titeln inte är i latinskt alfabet.
  if (NON_LATIN.test(title) && tmdbLocale !== "en-US") {
    const en = await tmdbJson<TmdbDetailsRaw>(
      `/${input.mediaType}/${input.tmdbId}`,
      { language: "en-US" },
      DETAILS_REVALIDATE_S,
    );
    const enTitle = (input.mediaType === "movie" ? en?.title : en?.name) ?? "";
    if (enTitle && !NON_LATIN.test(enTitle)) title = enTitle;
  }
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
    similarTo: input.similarTo ?? null,
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
  /**
   * Följdfråga i en konversation (lib/aiPick/followup.ts): önskemålen är redan
   * sammanslagna över hela samtalet. Saknas → allt tolkas ur prompt/chips.
   */
  followUp?: {
    intent: PickIntent;
    filter: MediaFilter;
    /** Fritextreferens ("tycker om House") — söks upp som vanligt. */
    titleRef: TitleReference | null;
    /** Känd referens ("mer som den" = förra förslaget) — ingen sökning. */
    knownRef: CandidateReference | null;
  };
};

/** Titeln användaren sa att den gillar, upplöst mot TMDB. */
export type CandidateReference = { tmdbId: number; mediaType: MediaType; title: string; year: number | null };

export type CandidateSet = {
  candidates: PickCandidate[];
  savedCount: number;
  freshCount: number;
  intent: PickIntent;
  effectiveFilter: MediaFilter;
  /** Bad användaren om något konkret (genre/speltid/undvik)? */
  constrained: boolean;
  reference: CandidateReference | null;
  /** Rangordningen som fallback och alternativ-påfyllning ska använda. */
  rank: FallbackOptions;
  taste: TasteSummary;
  affinity: (ids: number[]) => number;
  services: UserServices;
  region: string;
  debug: {
    savedTotal: number;
    savedEligible: number;
    savedEnriched: number;
    freshRecs: number;
    recsTimedOut: boolean;
    discoverCalls: number;
    liteUnseen: number;
    similarItems: number;
    freshEnriched: number;
    strictSaved: number;
    strictFresh: number;
    msCandidates: number;
  };
};

const RECS_TIMEOUT_MS = 9000;
/** Sparade likes att berika (nyast + utspridda äldre, se selectSavedForEnrichment). */
const SAVED_ENRICH = 48;
/** Recommenderns lek: så många osedda att berika. */
const RECS_ENRICH = 24;
/** Discover/liknande: de bäst rankade (på listdata) att berika. */
const LITE_ENRICH = 24;
/** Garanterade platser för "liknar <titel>" bland de berikade. */
const SIMILAR_MIN_SLOTS = 10;
/** Under så här många kandidater ger vi upp (no_candidates). */
export const MIN_POOL = 3;

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

/* ---------------- Listdata ("lite") från discover/recommendations ---------------- */

type TmdbListResult = {
  id: number;
  genre_ids?: number[];
  vote_average?: number;
  vote_count?: number;
  adult?: boolean;
};

export type LiteItem = {
  tmdbId: number;
  mediaType: MediaType;
  genreIds: number[];
  voteAverage: number | null;
  voteCount: number | null;
  /** Etikett för referenstiteln ("House (2004)") när källan är dess rekommendationer. */
  similarTo: string | null;
  /** Position i källistan (tiebreak). */
  order: number;
};

function toLite(r: TmdbListResult, mediaType: MediaType, order: number, similarTo: string | null): LiteItem {
  return {
    tmdbId: r.id,
    mediaType,
    genreIds: Array.isArray(r.genre_ids) ? r.genre_ids : [],
    voteAverage: typeof r.vote_average === "number" && r.vote_count ? r.vote_average : null,
    voteCount: typeof r.vote_count === "number" ? r.vote_count : null,
    similarTo,
    order,
  };
}

/** Barnheuristiken från recommendern: Kids-genre, eller Animation ∧ Family. */
export function isKidsLike(genreIds: number[]): boolean {
  return genreIds.includes(10762) || (genreIds.includes(16) && genreIds.includes(10751));
}

/**
 * Rangordning på listdata (ingen speltid ännu) — avgör vilka discover-/
 * liknande-titlar som är värda ett detaljanrop. Samma vikter som fallbackScore.
 */
export function rankLiteItems(
  items: LiteItem[],
  intent: PickIntent,
  opts: { affinity?: (ids: number[]) => number; constrained: boolean; surprise: boolean },
): LiteItem[] {
  const score = (i: LiteItem) => {
    const r = intentFit({ mediaType: i.mediaType, genreIds: i.genreIds, runtimeMin: null }, intent);
    const aff = opts.affinity ? opts.affinity(i.genreIds) : 0;
    return (
      bayesQuality(i.voteAverage, i.voteCount) +
      r.fit * 1.5 +
      (opts.constrained && r.strict ? 2 : 0) +
      (i.similarTo ? 1.5 : 0) +
      (opts.surprise ? -0.8 : 0.8) * aff -
      i.order * 0.005
    );
  };
  return items
    .map((it, idx) => ({ it, s: score(it), idx }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => x.it);
}

/** De n bästa, men med minst `similarMin` platser för "liknar <titel>" om de finns. */
export function pickLiteForEnrichment(ranked: LiteItem[], n: number, similarMin: number): LiteItem[] {
  const similar = ranked.filter((i) => i.similarTo).slice(0, similarMin);
  const out = [...similar];
  for (const i of ranked) {
    if (out.length >= n) break;
    if (!out.includes(i)) out.push(i);
  }
  return out.slice(0, Math.max(n, similar.length));
}

type DiscoverCtx = {
  intent: PickIntent;
  region: string;
  tmdbLocale: string;
  services: UserServices;
  certMax: string;
  showKids: boolean;
  avoidTop: number[];
};

async function discoverLite(call: DiscoverCall, ctx: DiscoverCtx): Promise<LiteItem[]> {
  const { intent, region, tmdbLocale, services } = ctx;
  const t = call.type;
  const genres = t === "movie" ? intent.movieGenres : intent.tvGenres;
  const avoid = new Set<number>([
    ...(t === "movie" ? intent.avoidMovieGenres : intent.avoidTvGenres),
    ...(intent.surprise ? ctx.avoidTop.filter((g) => !genres.includes(g)) : []),
    ...(ctx.showKids ? [] : t === "movie" ? [10751] : [10762, 10751]),
  ]);
  const maxRt = t === "movie" ? intent.maxRuntimeMovie : intent.maxRuntimeTv;
  const isGenre = call.kind === "genre";
  const isTop = call.kind === "top";
  const data = await tmdbJson<{ results?: TmdbListResult[] }>(
    `/discover/${t}`,
    {
      language: tmdbLocale,
      region: t === "movie" ? region : undefined,
      watch_region: region,
      with_watch_providers: services.discoverIds.length > 0 ? services.discoverIds.join("|") : undefined,
      with_genres: isGenre && genres.length ? genres.join("|") : undefined,
      without_genres: avoid.size ? Array.from(avoid).join(",") : undefined,
      // Bara genre-passet snävar in på speltid — det är "träffarna". Populärt/
      // topplistat är bredden som fyller på när träffarna är få.
      "with_runtime.lte": isGenre && maxRt ? maxRt : undefined,
      certification_country: t === "movie" ? "SE" : undefined,
      "certification.lte": t === "movie" ? ctx.certMax : undefined,
      sort_by: isTop ? "vote_average.desc" : "popularity.desc",
      "vote_count.gte": isTop ? (t === "movie" ? 800 : 300) : 150,
      include_adult: "false",
      page: call.page,
    },
    DETAILS_REVALIDATE_S,
  );
  return (data?.results ?? [])
    .filter((r) => Number.isFinite(r.id) && !r.adult)
    .map((r, i) => toLite(r, t, (call.page - 1) * 20 + i, null));
}

/**
 * "Tycker om serien House": sök titeln (UI-språket, sedan engelska) och hämta
 * TMDB:s recommendations + similar för den. 2–4 anrop, alla cachade.
 */
async function resolveReference(
  ref: TitleReference,
  prefer: MediaType | null,
  tmdbLocale: string,
): Promise<{ ref: CandidateReference; items: LiteItem[] } | null> {
  type SearchRes = { results?: TmdbSearchResult[] };
  const search = (language: string) =>
    tmdbJson<SearchRes>("/search/multi", { query: ref.query, language, include_adult: "false", page: 1 }, DETAILS_REVALIDATE_S);
  let hit = matchReferenceResult((await search(tmdbLocale))?.results ?? [], ref.query, prefer);
  if (!hit && tmdbLocale !== "en-US") hit = matchReferenceResult((await search("en-US"))?.results ?? [], ref.query, prefer);
  if (!hit) return null;

  const type = hit.media_type;
  const title = (type === "movie" ? hit.title : hit.name) || hit.original_title || hit.original_name || ref.query;
  const year = yearOf(type === "movie" ? hit.release_date : hit.first_air_date);
  return referenceItems({ tmdbId: hit.id, mediaType: type, title, year }, tmdbLocale);
}

/**
 * recommendations + similar för en redan känd titel (2 cachade anrop). Används
 * direkt av följdfrågan "mer som den" — titeln är förra förslaget, ingen sökning.
 */
async function referenceItems(
  ref: CandidateReference,
  tmdbLocale: string,
): Promise<{ ref: CandidateReference; items: LiteItem[] }> {
  const type = ref.mediaType;
  const label = `${ref.title}${ref.year ? ` (${ref.year})` : ""}`;
  const [recs, similar] = await Promise.all([
    tmdbJson<{ results?: TmdbListResult[] }>(`/${type}/${ref.tmdbId}/recommendations`, { language: tmdbLocale, page: 1 }, DETAILS_REVALIDATE_S),
    tmdbJson<{ results?: TmdbListResult[] }>(`/${type}/${ref.tmdbId}/similar`, { language: tmdbLocale, page: 1 }, DETAILS_REVALIDATE_S),
  ]);
  // Varva: recommendations (beteendebaserat, oftast bäst) först i varje par.
  const a = (recs?.results ?? []).filter((r) => Number.isFinite(r.id) && !r.adult);
  const b = (similar?.results ?? []).filter((r) => Number.isFinite(r.id) && !r.adult);
  const items: LiteItem[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) items.push(toLite(a[i], type, items.length, label));
    if (b[i]) items.push(toLite(b[i], type, items.length, label));
  }
  return { ref, items };
}

/* ---------------- Huvudfunktion ---------------- */

export async function buildCandidates(input: BuildCandidatesInput): Promise<CandidateSet | null> {
  const t0 = Date.now();
  const fu = input.followUp ?? null;
  const intent = fu ? fu.intent : parseIntent(input.prompt, input.chips);
  const filter = fu ? fu.filter : effectiveMediaFilter(input.mediaFilter, intent);
  const wantType = (t: string) => filter === "both" || t === filter;
  const excludeIds = new Set(input.exclude);
  const constrained = intentHasConstraints(intent);
  const titleRef = fu ? fu.titleRef : extractTitleReference(input.prompt);
  const knownRef = fu?.knownRef ?? null;

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
  const rank: FallbackOptions = { priority: input.priority, surprise: intent.surprise, affinity, constrained };
  const showKids = profile.showKidsContent === true || intent.wantsFamily;

  const ratingByKey = new Map<string, { rating: number | null; decision: string; decidedAt: Date }>();
  for (const r of ratings) ratingByKey.set(`${r.mediaType}_${r.tmdbId}`, r);
  const knownKeys = new Set<string>([...ratingByKey.keys(), ...watch.map((w) => `${w.mediaType}_${w.tmdbId}`)]);
  /** Färska: rätt typ, aldrig svept/sparad, inte redan visad i sessionen. */
  const freshOk = (t: MediaType, id: number) => wantType(t) && !knownKeys.has(`${t}_${id}`) && !excludeIds.has(id);

  /* ---- 1. Sparade likes (alla behöriga — passande rankas först senare) ---- */
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

  const savedPick = selectSavedForEnrichment(savedEligible, SAVED_ENRICH);
  const savedPromise = enrichAll(
    savedPick.map((s) => ({ tmdbId: s.tmdbId, mediaType: s.mediaType, fromSaved: true, likedAt: s.addedAt, recRank: null })),
    input.tmdbLocale,
    region,
    services,
  );

  /* ---- 2. Recommenderns lek → berika de första osedda ---- */
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
  const recsEnrichedPromise = recsPromise.then(async (recs) => {
    const items = recs.v.filter((it) => freshOk(it.tmdbType, it.id)).slice(0, RECS_ENRICH);
    const enriched = await enrichAll(
      items.map((it, i) => ({ tmdbId: it.id, mediaType: it.tmdbType, fromSaved: false, likedAt: null, recRank: i })),
      input.tmdbLocale,
      region,
      services,
    );
    return { total: recs.v.length, timedOut: recs.timedOut, enriched };
  });

  /* ---- 3. Discover (≤ 4 anrop) + "liknar <titel>" — parallellt med recs ---- */
  const ctx: DiscoverCtx = {
    intent,
    region,
    tmdbLocale: input.tmdbLocale,
    services,
    certMax: seMaxCert(ageFromDob(new Date(profile.dob))),
    showKids,
    avoidTop: rankGenresByBehaviour(stats).top.slice(0, 2),
  };
  const liteOk = (i: LiteItem) => freshOk(i.mediaType, i.tmdbId) && (showKids || !isKidsLike(i.genreIds));
  const countUnseen = (lists: LiteItem[][]) => {
    const keys = new Set<string>();
    for (const l of lists) for (const i of l) if (liteOk(i)) keys.add(candidateKey(i.mediaType, i.tmdbId));
    return keys.size;
  };

  const discoverPromise = (async () => {
    const plan = planDiscoverCalls(filter, intent);
    let lists = await Promise.all(plan.wave1.map((c) => discoverLite(c, ctx)));
    let calls = plan.wave1.length;
    if (plan.wave2.length > 0 && countUnseen(lists) < FRESH_POOL_TARGET) {
      lists = [...lists, ...(await Promise.all(plan.wave2.map((c) => discoverLite(c, ctx))))];
      calls += plan.wave2.length;
    }
    return { lists, calls };
  })();

  const similarPromise = knownRef
    ? referenceItems(knownRef, input.tmdbLocale).catch(() => null)
    : titleRef
      ? resolveReference(titleRef, titleRef.mediaHint ?? (filter !== "both" ? filter : null), input.tmdbLocale).catch(() => null)
      : Promise.resolve(null);

  const liteEnrichedPromise = Promise.all([discoverPromise, similarPromise]).then(async ([disc, sim]) => {
    const refKey = sim ? candidateKey(sim.ref.mediaType, sim.ref.tmdbId) : null;
    const seen = new Set<string>();
    const lite: LiteItem[] = [];
    // Liknande först så deras flagga vinner vid dubbletter.
    for (const i of [...(sim?.items ?? []), ...disc.lists.flat()]) {
      const k = candidateKey(i.mediaType, i.tmdbId);
      if (seen.has(k) || k === refKey || !liteOk(i)) continue;
      seen.add(k);
      lite.push(i);
    }
    const ranked = rankLiteItems(lite, intent, { affinity, constrained, surprise: intent.surprise });
    const chosen = pickLiteForEnrichment(ranked, LITE_ENRICH, SIMILAR_MIN_SLOTS);
    const enriched = await enrichAll(
      chosen.map((i) => ({
        tmdbId: i.tmdbId,
        mediaType: i.mediaType,
        fromSaved: false,
        likedAt: null,
        recRank: null,
        fromDiscover: !i.similarTo,
        similarTo: i.similarTo,
      })),
      input.tmdbLocale,
      region,
      services,
    );
    return {
      enriched,
      unseen: lite.length,
      calls: disc.calls,
      similarItems: lite.filter((i) => i.similarTo).length,
      ref: sim?.ref ?? null,
    };
  });

  const [savedEnriched, recsRes, liteRes] = await Promise.all([savedPromise, recsEnrichedPromise, liteEnrichedPromise]);

  /* ---- 4. Slå ihop, poängsätt, välj ~30 ---- */
  const refKey = liteRes.ref ? candidateKey(liteRes.ref.mediaType, liteRes.ref.tmdbId) : null;
  const freshByKey = new Map<string, PickCandidate>();
  for (const c of [...liteRes.enriched, ...recsRes.enriched]) {
    const prev = freshByKey.get(c.key);
    if (!prev) freshByKey.set(c.key, c);
    else {
      prev.recRank = prev.recRank ?? c.recRank;
      prev.similarTo = prev.similarTo ?? c.similarTo ?? null;
    }
  }
  // Referenstiteln själv föreslås inte — "tycker om House" betyder att de sett den.
  const fresh = scoreCandidates(
    [...freshByKey.values()].filter((c) => c.key !== refKey && wantType(c.mediaType)),
    intent,
  );
  const saved = scoreCandidates(savedEnriched.filter((c) => c.key !== refKey), intent);
  const savedMax = input.priority === "strong" ? 18 : 12;
  const candidates = selectFinalCandidates(saved, fresh, { ...rank, savedMax });

  const taste = await tastePromise;

  return {
    candidates,
    savedCount: candidates.filter((c) => c.fromSaved).length,
    freshCount: candidates.filter((c) => !c.fromSaved).length,
    intent,
    effectiveFilter: filter,
    constrained,
    reference: liteRes.ref,
    rank,
    taste,
    affinity,
    services,
    region,
    debug: {
      savedTotal: watch.length,
      savedEligible: savedEligible.length,
      savedEnriched: savedEnriched.length,
      freshRecs: recsRes.total,
      recsTimedOut: recsRes.timedOut,
      discoverCalls: liteRes.calls,
      liteUnseen: liteRes.unseen,
      similarItems: liteRes.similarItems,
      freshEnriched: fresh.length,
      strictSaved: saved.filter((c) => c.strictMatch).length,
      strictFresh: fresh.filter((c) => c.strictMatch).length,
      msCandidates: Date.now() - t0,
    },
  };
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
