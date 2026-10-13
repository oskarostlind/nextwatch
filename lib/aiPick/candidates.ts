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
// Kvalitetsrundan (2026-10-13, efter "Den nakna pistolen 2½" för "mörkt och
// spännande"): varje kandidat får `fit` 0–1 (hur väl den matchar det
// användaren ber om NU + favoriterna + speltid) och rangordningen följer
//   1. önskemål nu (typ, genre, stämning, favoriternas stil) — aldrig emot dem
//   2. kvalitet (film ≥ 6.8 / 300 röster, serie ≥ 7.2 / 150)
//   3. smak (beteendegenrer, egna tjänster)
//   4. SAVED — bara en avgränsad bonus vid stark passform (fit ≥ 0.6)
//   5. speltid (mjuk; uppluckras i 15-minuterssteg hellre än att poolen krymper)
// Favoriter ("Mina favoriter är X, Y och Z") tolkas i lib/aiPick/references.ts
// och deras TMDB-rekommendationer får egna platser i den färska poolen.
//
// Rena funktioner (parseIntent, computeFit, fallbackScore, selectFinalCandidates,
// fillAlternatives, relaxRuntimeForPool, planDiscoverCalls …) är exporterade och
// testbara utan DB/TMDB.

import { prisma } from "@/lib/prisma";
import { tmdbFetch } from "@/lib/tmdbClient";
import { computeUnifiedRecs } from "@/lib/unifiedRecs";
import { loadGenreStats, type GenreStats } from "@/lib/genreStats";
import { parseProvidersJson } from "@/lib/groupSettings";
import { ageFromDob, seMaxCert } from "@/lib/tasteModel";
import { tmdbPoster } from "@/lib/tmdb";
import { providerLogoUrl } from "@/lib/providerLogos";
import type { PickChipId, PickItem, PickProvider } from "@/lib/aiPick/types";
import {
  extractReferences,
  resolveReferences,
  similarForReferences,
  type RefQuery,
  type ResolvedRef,
} from "@/lib/aiPick/references";

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
  /**
   * Titlarna på de refererade favoriterna (eller "mer som den"-titeln) som
   * TMDB rekommenderar den här för. Tom lista = ingen sådan koppling.
   */
  similarTo: string[];
  /**
   * 0–1: hur väl den matchar det användaren ber om NU (genre/stämning),
   * favoriternas stil och speltiden (1 = perfekt). Sätts av scoreCandidates;
   * 0 innan dess.
   */
  fit: number;
  /** Ur "kort och topprankat"-passet (stämningens genrer inom speltiden, högst betyg). */
  shortGreat?: boolean;
  /** Klarar alla önskemål (genre/speltid/undvik) — sätts av scoreCandidates. */
  strictMatch?: boolean;
  /** Delarna bakom `fit` (sätts av scoreCandidates). */
  fitParts?: FitParts;
  /** Stark passform (fit ≥ 0.6, motsäger inget, ok kvalitet) — bara då får SAVED sin bonus. */
  highFit?: boolean;
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
  /** "Mind-bending", "tankeväckande", "twistig" … → mysterium/thriller/sci-fi. */
  mindbend: boolean;
  /**
   * "Undvik"-listan är hård: en undviken genre är en motsägelse även om en
   * önskad genre träffas (lätt/rolig → Zombieland, komedi+skräck, är fel).
   */
  strictAvoid: boolean;
  /** Bad om klassiker/äldre/ett årtionde — då straffas gamla titlar inte. */
  wantsClassic: boolean;
  surprise: boolean;
  /** Fritexten nämner uttryckligen film eller serie (bara när filtret är 'both'). */
  mediaHint: MediaType | null;
  /** Begärde användaren barn-/familjeinnehåll uttryckligen? */
  wantsFamily: boolean;
  /**
   * Speltiden kom från ett ÄLDRE meddelande och ett nyare bytte stämning/genre
   * ("kortare" → "mörkt och spännande") — då är den bara en svag ledtråd.
   */
  runtimeSoft: boolean;
  /**
   * Uppluckrat tak (relaxRuntimeForPool) när för få bra kandidater klarade
   * önskemålet. null = inte uppluckrat. maxRuntime* är fortfarande önskemålet.
   */
  relaxedRuntimeMovie: number | null;
  relaxedRuntimeTv: number | null;
  /**
   * Taket får aldrig luckras upp förbi detta: efter "kortare" ska förslaget
   * fortfarande vara kortare än titeln som visades (109 min → ≤ 105).
   */
  runtimeCeilMovie?: number | null;
  runtimeCeilTv?: number | null;
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

const LIGHT_RE = rx(
  "mysig|myspys|feelgood|feel-good|feel good|lättsam|lätt\\b|cozy|cosy|light|chill|avslappnad|uplifting|rolig|funny|laugh|skratt|humor",
);
const CLASSIC_RE = rx("klassiker|klassisk|gammal|gamla|äldre|svartvit|classic|old\\b|older|retro|black and white|\\d0-?talet|\\d0s\\b|19\\d\\d");
const THRILL_RE = rx(
  "spännande|spänning|mörk|obehag|intensiv|psykologisk|nervkittlande|nervig|thrilling|dark|intense|suspense|psychological|disturbing|gritty|tense",
);
// "Inception-stämningen": hjärnvridande snarare än bara mörkt — egen stämning.
const MINDBEND_RE = rx(
  "mind[- ]?bend|mind[- ]?blow|mind[- ]?twist|mind[- ]?fuck|brain[- ]?bend|twisty|twist|tankeväckande|hjärnvridande|förvirrande|mindfuck",
);
const SHORT_RE = rx("kort|short|snabb|quick");
const SURPRISE_RE = rx("överrask|surprise|något nytt|something new|random|slump");
// Utan prefix-gräns: "skräckfilm" och "deckarserie" ska ge ledtråden.
const MOVIE_RE = /film|movie/iu;
const TV_RE = /serie|series|tv[- ]?show|avsnitt|episod|säsong|season|binge/iu;

export const LIGHT_GENRES = { movie: [35, 10749, 10751], tv: [35, 10751] };
/** Mörkt/spännande = thriller, mysterium, krim (psykologiskt) — inte skräck per automatik. */
export const THRILL_GENRES = { movie: [53, 9648, 80], tv: [80, 9648, 10759] };
/** Lätt/rolig: aldrig skräck, thriller eller krig (hård lista, se strictAvoid). */
export const LIGHT_AVOID = { movie: [27, 53, 10752], tv: [10768] };
/** "Mörkt och spännande" ska aldrig ge en komedi, familjefilm eller romcom. */
export const THRILL_AVOID = { movie: [35, 10751, 10749], tv: [35, 10751, 10762] };
/** Mind-bending = mysterium + thriller + sci-fi (serier: mysterium, sci-fi & fantasy, krim). */
export const MINDBEND_GENRES = { movie: [9648, 53, 878], tv: [9648, 10765, 80] };
export const MINDBEND_AVOID = { movie: [35, 10751, 10749, 16], tv: [35, 10751, 10762, 16] };

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

  const mindbendRaw = text !== "" && MINDBEND_RE.test(text);
  const light = chipSet.has("light") || (text !== "" && LIGHT_RE.test(text));
  const thrillingRaw = chipSet.has("thrilling") || (text !== "" && THRILL_RE.test(text));
  const surprise = chipSet.has("surprise") || (text !== "" && SURPRISE_RE.test(text));
  const shortWord = chipSet.has("short") || (text !== "" && SHORT_RE.test(text));
  const minutes = text ? explicitMinutes(text) : null;

  // En stämning åt gången. Mind-bending vinner över "mörkt" (den innehåller
  // redan thriller); lätt + spännande samtidigt = ingen stämningsgenre.
  const mood = moodOf(light, thrillingRaw, mindbendRaw);
  const thrilling = mood === "thrilling";
  const mindbend = mood === "mindbend";

  // Stämning blir genre bara om fritexten inte redan namngav en genre —
  // "mysig skräck" ska fortfarande vara skräck.
  const explicitGenre = terms.length > 0;
  if (light) terms.push("light");
  if (thrilling) terms.push("thrilling");
  if (mindbend) terms.push("mindbend");
  const moodGenres = mood ? MOOD_GENRES[mood] : null;
  if (!explicitGenre && moodGenres) {
    movieGenres.push(...moodGenres.genres.movie);
    tvGenres.push(...moodGenres.genres.tv);
    anyTvMapped = true;
  }
  // Stämningens "undvik" gäller så länge den inte krockar med en uttryckligt
  // nämnd genre: "feel-good and funny" (komedi) undviker skräck, men "mysig
  // skräck" och "mörk komedi" gör det inte.
  const avoidApplies = !!moodGenres && moodAvoidCompatible(moodGenres.avoid, [...g.movie, ...g.tv]);
  const avoidMovieGenres = avoidApplies && moodGenres ? [...moodGenres.avoid.movie] : [];
  const avoidTvGenres = avoidApplies && moodGenres ? [...moodGenres.avoid.tv] : [];
  const wantsClassic = text !== "" && CLASSIC_RE.test(text);
  if (wantsClassic) terms.push("classic");

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
    light: mood === "light",
    thrilling,
    mindbend,
    strictAvoid: avoidApplies && mood === "light",
    wantsClassic,
    surprise,
    mediaHint: mediaHintOf(text),
    wantsFamily,
    runtimeSoft: false,
    relaxedRuntimeMovie: null,
    relaxedRuntimeTv: null,
    // Explicita minuter ("under 100") luckras upp högst ett steg — "under 100"
    // får aldrig bli 145 som i prod 2026-10-13.
    runtimeCeilMovie: minutes != null && maxRuntimeMovie != null ? maxRuntimeMovie + RELAX_STEP_MIN : null,
    runtimeCeilTv: minutes != null && maxRuntimeTv != null ? maxRuntimeTv + RELAX_STEP_MIN : null,
    terms,
  };
}

export type Mood = "light" | "thrilling" | "mindbend";

/** Stämningens genrer och vad den aldrig får ge. */
export const MOOD_GENRES: Record<Mood, { genres: { movie: number[]; tv: number[] }; avoid: { movie: number[]; tv: number[] } }> = {
  light: { genres: LIGHT_GENRES, avoid: LIGHT_AVOID },
  thrilling: { genres: THRILL_GENRES, avoid: THRILL_AVOID },
  mindbend: { genres: MINDBEND_GENRES, avoid: MINDBEND_AVOID },
};

/** Får stämningens "undvik" gälla ihop med de uttryckligt nämnda genrerna? */
export function moodAvoidCompatible(avoid: { movie: number[]; tv: number[] }, explicit: number[]): boolean {
  return !explicit.some((x) => avoid.movie.includes(x) || avoid.tv.includes(x));
}

/** En stämning ur flaggorna: mind-bending > (lätt XOR spännande). */
export function moodOf(light: boolean, thrilling: boolean, mindbend: boolean): Mood | null {
  if (mindbend && !light) return "mindbend";
  if (light && !thrilling && !mindbend) return "light";
  if (thrilling && !light) return "thrilling";
  return null;
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
 * Referenskontext för poängsättningen: genrerna för varje refererad favorit —
 * en mängd per titel, så likheten mäts mot den NÄRMASTE favoriten och inte mot
 * unionen (Inception + Prisoners ≠ "action eller krim").
 */
export type RefContext = { genreSets: number[][] };

export function refContextOf(refs: { genreIds: number[] }[]): RefContext | null {
  const sets = refs.map((r) => r.genreIds).filter((s) => s.length > 0);
  return sets.length > 0 ? { genreSets: sets } : null;
}

export type FitParts = {
  /** Genre/stämning NU, 0–1. null = inga sådana önskemål. Motsägelse = 0. */
  genre: number | null;
  /** Likhet med favoriterna / "mer som den", 0–1. null = inga referenser. */
  ref: number | null;
  /** Speltid mot önskemålet, 0–1. null = inget önskemål eller okänd speltid. */
  runtime: number | null;
  /** Träffar en undviken genre utan att träffa någon önskad (komedi för "mörkt och spännande"). */
  contradicts: boolean;
  /**
   * Relativt överskott mot ett AKTUELLT speltidsönskemål ((speltid − önskemål)
   * / önskemål; 0 inom önskemålet, okänt eller när speltiden är mjuk).
   */
  runtimeOver: number;
  strict: boolean;
};

/**
 * Vikterna i fit — normeras över de delar som faktiskt finns. Speltiden är ett
 * önskemål NU när den kom i samma/nyaste meddelande (0.35), men bara en svag
 * ledtråd när ett nyare meddelande bytte stämning/genre (0.06).
 */
export const FIT_WEIGHTS = { genre: 0.5, ref: 0.35, runtime: 0.35, runtimeSoft: 0.06 } as const;
/** fit när användaren inte bett om något alls (allt passar lika bra). */
export const NEUTRAL_FIT = 0.8;
/** Stark passform: SAVED-bonusen och "bra" i speltidsuppluckringen kräver minst detta. */
export const HIGH_FIT = 0.6;
/** Sparade under detta (eller som motsäger önskemålen) får ingen garanterad plats i listan. */
export const WEAK_FIT = 0.6;

type FitCheckable = IntentCheckable & { similarTo?: string[] | null };

/**
 * Genre/stämning: träff 0.8 (+0.1 per extra träff, max 1), miss 0.2, okänd
 * 0.55. En undviken genre UTAN träff = motsägelse (0) — "mörkt och spännande"
 * får aldrig ge en komedi. Undviken MED träff (mörk komedi-thriller) ×0.6.
 */
export function genreFit(
  genreIds: number[],
  wanted: number[],
  avoid: number[],
  strictAvoid = false,
): { score: number | null; contradicts: boolean } {
  if (wanted.length === 0 && avoid.length === 0) return { score: null, contradicts: false };
  if (genreIds.length === 0) return { score: 0.55, contradicts: false };
  const hits = wanted.length > 0 ? genreIds.filter((g) => wanted.includes(g)).length : 0;
  const avoidHit = avoid.length > 0 && genreIds.some((g) => avoid.includes(g));
  if (avoidHit && (hits === 0 || strictAvoid)) return { score: 0, contradicts: true };
  let s = wanted.length === 0 ? 0.85 : hits > 0 ? 0.8 + 0.1 * Math.min(2, hits - 1) : 0.2;
  if (avoidHit) s *= 0.6;
  return { score: s, contradicts: false };
}

/**
 * Breda genrer säger nästan inget om likhet: The Transporter och Inception
 * delar "Action" men inget annat (prod 2026-10-13). De väger 0.25 i
 * genrelikheten, de specifika 1.
 */
const BROAD_GENRES = new Set([28, 18, 12, 35, 10759, 10751]);
const genreWeight = (g: number) => (BROAD_GENRES.has(g) ? 0.25 : 1);

/** Viktad Jaccard (breda genrer väger lite), 0–1. */
export function weightedGenreOverlap(a: number[], b: number[]): number {
  const union = new Set([...a, ...b]);
  let wu = 0;
  let wi = 0;
  for (const g of union) {
    const w = genreWeight(g);
    wu += w;
    if (a.includes(g) && b.includes(g)) wi += w;
  }
  return wu > 0 ? wi / wu : 0;
}

/** Bara genrelikhet med favoriterna räcker aldrig långt (≤ 0.35). */
export const REF_GENRE_MAX = 0.35;
/** Med favoriter kräver SAVED-bonusen verklig likhet (TMDB rekommenderar den för en favorit). */
export const REF_HIGH_FIT = 0.5;

/**
 * Likhet med favoriterna: TMDB rekommenderar den för 1 favorit → 0.85, 2 →
 * 0.95, 3+ → 1. Annars bara viktad genrelikhet mot närmaste favorit → ≤ 0.35.
 */
export function refFit(genreIds: number[], similarTo: string[] | null | undefined, refs: RefContext | null): number | null {
  const sim = similarTo?.length ?? 0;
  if (sim > 0) return Math.min(1, 0.85 + 0.1 * (sim - 1));
  if (!refs || refs.genreSets.length === 0) return null;
  if (genreIds.length === 0) return 0.15;
  let best = 0;
  for (const set of refs.genreSets) best = Math.max(best, weightedGenreOverlap(genreIds, set));
  return 0.05 + (REF_GENRE_MAX - 0.05) * best;
}

/**
 * Speltid: inom önskemålet 1, inom ett uppluckrat tak 1 → 0.5, därefter
 * relativt överskott (10 % över → 0.25, 16 % över → golvet 0.1). Efter
 * "kortare" (`ceil` satt) är allt som är minst lika långt som titeln som
 * visades en motsägelse (0.05) — "kortare" än 109 min är aldrig 113 min.
 * `pref` = önskemålet, `relaxed` = ev. uppluckrat tak.
 */
export function runtimeFit(
  runtimeMin: number | null,
  pref: number | null,
  relaxed: number | null,
  ceil: number | null = null,
): number | null {
  if (pref == null || runtimeMin == null) return null;
  if (ceil != null && runtimeMin >= ceil + 5) return 0.05;
  const max = Math.max(pref, relaxed ?? pref);
  if (runtimeMin <= pref) return 1;
  if (runtimeMin <= max) return 1 - (0.5 * (runtimeMin - pref)) / Math.max(1, max - pref);
  return Math.max(0.1, 0.5 - (2.5 * (runtimeMin - max)) / max);
}

/** Delarna bakom fit för en kandidat. */
export function computeFit(c: FitCheckable, intent: PickIntent, refs: RefContext | null = null): FitParts {
  const wanted = c.mediaType === "movie" ? intent.movieGenres : intent.tvGenres;
  const avoid = c.mediaType === "movie" ? intent.avoidMovieGenres : intent.avoidTvGenres;
  const pref = c.mediaType === "movie" ? intent.maxRuntimeMovie : intent.maxRuntimeTv;
  const relaxed = c.mediaType === "movie" ? intent.relaxedRuntimeMovie : intent.relaxedRuntimeTv;
  const ceil = (c.mediaType === "movie" ? intent.runtimeCeilMovie : intent.runtimeCeilTv) ?? null;
  const g = genreFit(c.genreIds, wanted, avoid, intent.strictAvoid);
  return {
    genre: g.score,
    ref: refFit(c.genreIds, c.similarTo, refs),
    runtime: runtimeFit(c.runtimeMin, pref, relaxed, ceil),
    contradicts: g.contradicts,
    runtimeOver: !intent.runtimeSoft && pref != null && c.runtimeMin != null && c.runtimeMin > pref ? (c.runtimeMin - pref) / pref : 0,
    strict: matchesIntent(c, intent),
  };
}

/**
 * fit 0–1 = viktat GEOMETRISKT medel av de delar som finns (genre/stämning
 * 0.5, favoriter 0.35, speltid 0.35 — 0.06 när speltiden är en äldre, mjuk
 * ledtråd). Geometriskt med flit: en titel som missar en dimension grovt kan
 * inte räddas av en annan — en 85-minuters slapstick är inte "i stil med
 * Prisoners" bara för att den är kort. Inga önskemål alls → NEUTRAL_FIT.
 * Motsägelse → högst 0.1.
 */
export function fitOf(p: FitParts, intent: Pick<PickIntent, "runtimeSoft">): number {
  const parts: [number, number][] = [];
  if (p.genre != null) parts.push([FIT_WEIGHTS.genre, p.genre]);
  if (p.ref != null) parts.push([FIT_WEIGHTS.ref, p.ref]);
  if (p.runtime != null) parts.push([intent.runtimeSoft ? FIT_WEIGHTS.runtimeSoft : FIT_WEIGHTS.runtime, p.runtime]);
  let fit = NEUTRAL_FIT;
  if (parts.length > 0) {
    const w = parts.reduce((a, [wi]) => a + wi, 0);
    fit = Math.exp(parts.reduce((a, [wi, v]) => a + wi * Math.log(Math.max(0.01, v)), 0) / w);
  }
  if (p.contradicts) fit = Math.min(fit, 0.1);
  return Math.round(Math.max(0, Math.min(1, fit)) * 100) / 100;
}

/**
 * Mjuk passform mot önskemålen (utan referenser): {strict, fit 0–1}. Behålls
 * som enkel ingång för tester och listdata.
 */
export function intentFit(c: IntentCheckable, intent: PickIntent): { strict: boolean; fit: number } {
  const p = computeFit(c, intent, null);
  return { strict: p.strict, fit: fitOf(p, intent) };
}

/** "Bra nog att rekommendera" kvalitetsmässigt (Bayes-utjämnat ≥ 6.4). */
export function qualityOk(c: Pick<PickCandidate, "voteAverage" | "voteCount">): boolean {
  return bayesQuality(c.voteAverage, c.voteCount) >= 6.4;
}

/**
 * Stark passform: fit ≥ HIGH_FIT, motsäger inget, kvaliteten duger — och när
 * användaren nämnt favoriter även verklig likhet med dem (ref ≥ 0.5). En
 * actionfilm som bara delar genre med Inception får ingen SAVED-bonus.
 */
export function isHighFit(c: Pick<PickCandidate, "voteAverage" | "voteCount">, fit: number, p: FitParts): boolean {
  if (p.ref != null && p.ref < REF_HIGH_FIT) return false;
  return !p.contradicts && fit >= HIGH_FIT && qualityOk(c);
}

/** Sätter fitParts/fit/strictMatch/highFit (muterar, returnerar samma lista). */
export function scoreCandidates<T extends PickCandidate>(cands: T[], intent: PickIntent, refs: RefContext | null = null): T[] {
  for (const c of cands) {
    const p = computeFit(c, intent, refs);
    c.fitParts = p;
    c.strictMatch = p.strict;
    c.fit = fitOf(p, intent);
    c.highFit = isHighFit(c, c.fit, p);
  }
  return cands;
}

/* ======================================================================
 * Speltid: mjukt önskemål som aldrig får krympa poolen till skräp
 * ==================================================================== */

/** Så många BRA kandidater ska klara speltiden innan vi slutar lucka upp. */
export const RELAX_MIN_GOOD = 12;
export const RELAX_STEP_MIN = 15;
const RELAX_MAX_STEPS = 6;

/**
 * Bra = passar allt UTOM speltiden (fit utan speltidsdelen ≥ HIGH_FIT),
 * motsäger inget och duger kvalitetsmässigt.
 */
function isGoodForRuntime(c: PickCandidate, intent: PickIntent): boolean {
  const p = c.fitParts;
  if (!p) return qualityOk(c);
  if (p.contradicts) return false;
  return fitOf({ ...p, runtime: null }, intent) >= HIGH_FIT && qualityOk(c);
}

/**
 * Finns färre än 12 bra kandidater inom speltidsönskemålet höjs taket i steg
 * om 15 min (max 6 steg, aldrig förbi runtimeCeil*) tills de finns — hellre en lite längre bra titel än
 * en kort dålig ("Den nakna pistolen 2½" för "kortare"). Kräver poängsatta
 * kandidater (fitParts). Returnerar en NY intent med relaxedRuntime* satta
 * (eller samma om inget behövs); poängsätt sedan om med den.
 */
export function relaxRuntimeForPool(cands: PickCandidate[], intent: PickIntent): PickIntent {
  let out = intent;
  for (const type of ["movie", "tv"] as const) {
    const pref = type === "movie" ? intent.maxRuntimeMovie : intent.maxRuntimeTv;
    if (pref == null) continue;
    const ceilRaw = type === "movie" ? intent.runtimeCeilMovie : intent.runtimeCeilTv;
    const ceil = ceilRaw != null && ceilRaw > pref ? ceilRaw : ceilRaw != null ? pref : Infinity;
    const good = cands.filter((c) => c.mediaType === type && isGoodForRuntime(c, intent));
    if (good.length === 0) continue;
    const target = Math.min(RELAX_MIN_GOOD, good.length);
    const within = (cap: number) => good.filter((c) => c.runtimeMin == null || c.runtimeMin <= cap).length;
    let cap = pref;
    for (let step = 0; step < RELAX_MAX_STEPS && cap < ceil && within(cap) < target; step++) {
      cap = Math.min(ceil, cap + RELAX_STEP_MIN);
    }
    if (cap > pref) {
      out = {
        ...out,
        ...(type === "movie" ? { relaxedRuntimeMovie: cap } : { relaxedRuntimeTv: cap }),
        terms: [...out.terms, `relax${type === "movie" ? "M" : "T"}${cap}`],
      };
    }
  }
  return out;
}

/** Det uppluckrade taket som gäller för filtret (film före serie vid 'both'). */
export function runtimeRelaxedFor(intent: PickIntent, filter: MediaFilter): number | null {
  if (filter === "movie") return intent.relaxedRuntimeMovie;
  if (filter === "tv") return intent.relaxedRuntimeTv;
  return intent.relaxedRuntimeMovie ?? intent.relaxedRuntimeTv;
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
  /** Bad användaren om något konkret (genre/speltid)? (debug/prompt — vikterna ligger i fitParts.) */
  constrained?: boolean;
  /** Straffa gamla titlar (ingen bad om klassiker och inga gamla favoriter) — se agePenaltyFor. */
  agePenalty?: boolean;
  /** Vag fråga utan stämning/genre och skräck inte bland toppgenrerna → skräck −1. */
  horrorPenalty?: boolean;
};

/**
 * Gamla titlar för allmänna frågor: serie med premiär före 1985 −2.5 (Doctor
 * Who 1963 för "korta avsnitt, drama, gillar House"), film före 1970 −1,
 * före 1985 −0.4 (en klassiker som Chinatown kan fortfarande vinna på kvalitet).
 */
export function agePenaltyFor(c: { mediaType: MediaType; year: number | null }): number {
  if (c.year == null) return 0;
  if (c.mediaType === "tv") return c.year < 1985 ? 2.5 : 0;
  return c.year < 1970 ? 1 : c.year < 1985 ? 0.4 : 0;
}

export const HORROR_GENRE = 27;
export const HORROR_PENALTY = 1;

/** Skräckavdraget (vaga frågor), gemensamt för listdata och berikade kandidater. */
function horrorPenaltyFor(genreIds: number[], opts: Pick<FallbackOptions, "horrorPenalty">): number {
  return opts.horrorPenalty && genreIds.includes(HORROR_GENRE) ? HORROR_PENALTY : 0;
}

/**
 * Avdragen som beror på samtalet: ålder (om ingen bad om klassiker och ingen
 * favorit är gammal) och skräck (vag fråga, skräck inte en toppgenre).
 */
export function contextPenalties(
  intent: PickIntent,
  lovedYears: (number | null)[],
  topGenres: number[],
): { agePenalty: boolean; horrorPenalty: boolean } {
  const oldLoved = lovedYears.some((y) => y != null && y < 1985);
  const vague = !intentHasGenreFilter(intent) && !intent.light && !intent.thrilling && !intent.mindbend;
  return {
    agePenalty: !intent.wantsClassic && !oldLoved,
    horrorPenalty: vague && !topGenres.includes(HORROR_GENRE),
  };
}

/**
 * Samma titel i flera versioner (Doctor Who 1963 och 2005): behåll den nyaste
 * när användaren inte bett om klassiker. Ordningen i övrigt behålls.
 */
export function preferModernVersions<T extends { title: string; year: number | null }>(cands: T[]): T[] {
  const newest = new Map<string, number>();
  for (const c of cands) {
    const k = normTitle(c.title);
    if (!k || c.year == null) continue;
    newest.set(k, Math.max(newest.get(k) ?? -Infinity, c.year));
  }
  return cands.filter((c) => {
    const n = newest.get(normTitle(c.title));
    return c.year == null || n == null || c.year >= n;
  });
}

/**
 * Kvalitetsdelen: Bayes-utjämnat betyg, brantare över 7.0 (6.6 → +0.2,
 * 7.4 → +2.0, 8.2 → +4.2, tak +4.5, golv −2.5) + 0.6 för "stabilt bra"
 * (film ≥ 6.8 med ≥ 300 röster, serie ≥ 7.2 med ≥ 150) − 0.8 för svagt
 * (< 6.2 med ≥ 100 röster).
 */
export function qualityTerm(c: Pick<PickCandidate, "voteAverage" | "voteCount" | "mediaType">): number {
  const b = bayesQuality(c.voteAverage, c.voteCount);
  let t = Math.max(-2.5, Math.min(4.5, (b - 6.5) * 1.6 + Math.max(0, b - 7) * 1.2));
  const votes = c.voteCount ?? 0;
  if (c.voteAverage != null) {
    const good = c.mediaType === "movie" ? c.voteAverage >= 6.8 && votes >= 300 : c.voteAverage >= 7.2 && votes >= 150;
    if (good) t += 0.6;
    if (c.voteAverage < 6.2 && votes >= 100) t -= 0.8;
  }
  return t;
}

/**
 * Obskyrt: film med < 300 röster (serie < 100) eller TV-film — t.ex.
 * "Cleveland Abduction" (TV-film 2015) för "kortare". Undantag: TMDB
 * rekommenderar den för minst två av favoriterna.
 */
export function obscurityPenalty(c: Pick<PickCandidate, "voteCount" | "mediaType" | "genreIds"> & { similarTo?: string[] }): number {
  if ((c.similarTo?.length ?? 0) >= 2) return 0;
  let p = 0;
  const votes = c.voteCount ?? 0;
  if (votes < (c.mediaType === "movie" ? 300 : 100)) p += votes < 100 ? 1.5 : 1;
  if (c.genreIds.includes(10770)) p += 1;
  return p;
}

/** Vikten på fit (0–1) i rangordningen — störst, eftersom önskemålet NU går först. */
export const FIT_WEIGHT = 6;
/** Extra straff för att gå emot önskad stämning/genre (utöver att fit ≤ 0.1). */
export const CONTRADICTION_PENALTY = 4;
/**
 * Längre än ett AKTUELLT speltidsönskemål ("under 100", "kortare"): −15 per
 * 100 % överskott, max −3 (113 min mot "under 100" ≈ −2). Utan detta vann
 * Memento (8.2, 113 min) över Source Code (7.3, 93 min) på kvalitet.
 */
export const RUNTIME_OVER_PENALTY = 15;
/** SAVED-bonusen i "strong": bara vid stark passform — annars en ren tiebreaker. */
export const SAVED_BOOST_HIGH_FIT = 2.5;
export const SAVED_BOOST_WEAK = 0.3;

/**
 * Rangordningspoäng — samma ordning i urvalet till modellen, i fallbacken och
 * när alternativ fylls på:
 *   1. önskemål nu    6·fit (0 … 6), motsägelse ytterligare −4
 *   2. kvalitet       qualityTerm (≈ −3.3 … +5.1) − obscurityPenalty (≤ 2.5)
 *   3. smak           ±0.8·beteendeaffinitet, egna tjänster +0.3 / −1, recommender-rank ≤ +0.5
 *   4. SAVED          +2.5 om highFit (fit ≥ 0.6, ingen motsägelse, ok kvalitet), annars +0.3
 *   5. speltid        ingår i fit (vikt 0.35, 0.06 när mjuk); ett AKTUELLT
 *                     önskemål ger dessutom −15·överskott (max −3)
 * En SAVED med stark passform slår alltså en lika stark NEW (Oskars prioritet),
 * men en SAVED med svag passform kan aldrig ta sig förbi en NEW med stark
 * passform och samma kvalitet på bonusen. Okodade kandidater (utan fitParts)
 * räknas som NEUTRAL_FIT.
 */
export function fallbackScore(c: PickCandidate, opts: FallbackOptions): number {
  const scored = c.fitParts != null;
  const fit = scored ? c.fit : NEUTRAL_FIT;
  const aff = opts.affinity ? opts.affinity(c.genreIds) : 0;
  let s = FIT_WEIGHT * fit;
  if (c.fitParts?.contradicts) s -= CONTRADICTION_PENALTY;
  s -= Math.min(3, RUNTIME_OVER_PENALTY * (c.fitParts?.runtimeOver ?? 0));
  s += qualityTerm(c) - obscurityPenalty(c);
  if (opts.agePenalty) s -= agePenaltyFor(c);
  s -= horrorPenaltyFor(c.genreIds, opts);
  // Överraskning: utanför vanan är en fördel, inte en nackdel.
  s += (opts.surprise ? -0.8 : 0.8) * aff;
  if (c.onUserServices === true) s += 0.3;
  else if (c.onUserServices === false) s -= 1;
  if (c.recRank != null) s += Math.max(0, 0.5 - c.recRank * 0.02);
  if (opts.surprise) {
    if (!c.fromSaved) s += 50;
  } else if (opts.priority === "strong" && c.fromSaved) {
    const high = scored ? c.highFit === true : qualityOk(c);
    s += high ? SAVED_BOOST_HIGH_FIT : SAVED_BOOST_WEAK;
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

/** Sparad titel som inte passar starkt nog för en garanterad plats (motsäger, eller fit < 0.6). */
function weakSaved(c: PickCandidate): boolean {
  const p = c.fitParts;
  return !!p && (p.contradicts || c.fit < WEAK_FIT);
}

/** Klarar speltiden (inom önskemålet eller det uppluckrade bandet) och motsäger inget. */
function slotWorthy(c: PickCandidate): boolean {
  const p = c.fitParts;
  if (p?.contradicts) return false;
  return p?.runtime == null || p.runtime >= 0.5;
}
const slotWorthySimilar = (c: PickCandidate) => c.similarTo.length > 0 && slotWorthy(c);
const slotWorthyShort = (c: PickCandidate) => c.shortGreat === true && slotWorthy(c);

/** Platser för "liknar <favorit>" som klarar speltiden, när favoriter finns. */
export const SIMILAR_RESERVE = 12;
/** Max sparade i listan när favoriter finns (de ska inte tränga ut favoriternas stil). */
export const SAVED_MAX_WITH_REFS = 10;

/**
 * Listan till modellen:
 *   1. upp till `savedMax` sparade som PASSAR STARKT (fit ≥ 0.6, bäst först) —
 *      de enda sparade med garanterad plats;
 *   2. med `similarReserve` (favoriter/"mer som den" finns): så många titlar
 *      som TMDB rekommenderar för dem och som klarar speltiden; med
 *      `shortReserve` dessutom så många "korta och topprankade";
 *   3. resten efter rangordning bland övriga färska OCH svagare sparade — en
 *      sparad som passar svagt konkurrerar på poäng, den tränger aldrig undan.
 *      `savedMax` gäller alla sparade i listan.
 * Färska har alltid minst 12 platser. Inga hårda bortfall.
 */
export function selectFinalCandidates(
  saved: PickCandidate[],
  fresh: PickCandidate[],
  opts: FallbackOptions & { savedMax: number; max?: number; similarReserve?: number; shortReserve?: number },
): PickCandidate[] {
  const max = opts.max ?? MAX_CANDIDATES;
  const rankedSaved = rankCandidates(saved, opts);
  const strong = rankedSaved.filter((c) => !weakSaved(c)).slice(0, Math.min(opts.savedMax, max));
  const weak = rankedSaved.filter((c) => weakSaved(c));
  const rankedFresh = rankCandidates(fresh, opts);
  const reserved = opts.similarReserve
    ? rankedFresh.filter(slotWorthySimilar).slice(0, Math.min(opts.similarReserve, max))
    : [];
  if (opts.shortReserve) {
    const extra = rankedFresh.filter((c) => slotWorthyShort(c) && !reserved.includes(c)).slice(0, opts.shortReserve);
    reserved.push(...extra.slice(0, Math.max(0, max - reserved.length)));
  }
  const keepSaved = Math.max(0, Math.min(strong.length, max - Math.max(MIN_FRESH_SLOTS, reserved.length)));
  const out = [...strong.slice(0, keepSaved), ...reserved];
  let savedIn = keepSaved;
  const rest = rankCandidates([...rankedFresh.filter((c) => !reserved.includes(c)), ...weak], opts);
  const skipped: PickCandidate[] = [];
  for (const c of rest) {
    if (out.length >= max) break;
    // savedMax gäller ALLA sparade i listan, även de som konkurrerar på poäng.
    if (c.fromSaved && savedIn >= opts.savedMax) {
      skipped.push(c);
      continue;
    }
    if (c.fromSaved) savedIn++;
    out.push(c);
  }
  // Hellre en sparad över taket än en lista under MIN_POOL-gränsen.
  for (const c of skipped) {
    if (out.length >= Math.min(max, MIN_FRESH_SLOTS)) break;
    out.push(c);
  }
  return out;
}

/**
 * Alltid två alternativ när poolen räcker: modellens giltiga alternativ först,
 * sedan deterministiskt ur rangordningen. I "strong"/överraskningsläge blir
 * det helst en SAVED (som passar) + en NEW så användaren både påminns och upptäcker.
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
    if (!out.some((c) => c.fromSaved)) add(ranked.find((c) => c.fromSaved && c.highFit !== false && !used.has(c.key)));
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
 * Referenser (favoriter, "i stil med X") — tolkas i lib/aiPick/references.ts
 * ==================================================================== */

/**
 * Texten utan referenstitlarna — så "jag gillar Dark" inte blir stämningen
 * "mörkt" och "favoriter: Scary Movie" inte blir skräck.
 */
export function withoutReferences(text: string | null | undefined, refs: readonly { query: string }[]): string {
  let t = text ?? "";
  for (const r of refs) {
    if (!r.query) continue;
    const esc = r.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(esc, "giu"), " ");
  }
  return t;
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

/** Max antal referenstitlar (favoriter) som slås upp per samtal. */
export const MAX_REFERENCES = 3;

/** Slår ihop referenser över samtalet: unika (normaliserad titel), de senast nämnda vinner platserna. */
export function mergeRefQueries(lists: readonly RefQuery[][], max = MAX_REFERENCES): RefQuery[] {
  const out: RefQuery[] = [];
  for (const list of lists) {
    for (const r of list) {
      const k = normTitle(r.query);
      if (!k) continue;
      const i = out.findIndex((o) => normTitle(o.query) === k);
      if (i >= 0) out.splice(i, 1);
      out.push(r);
    }
  }
  return out.slice(-max);
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

/** Ett "kort och topprankat"-anrop: stämningens/genrens titlar inom speltiden, högst betyg först. */
export type ShortGreatCall = {
  type: MediaType;
  /** OR-semantik (TMDB: pipe-separerat). */
  genres: number[];
  avoid: number[];
  runtimeLte: number;
  runtimeGte: number;
  voteMin: number;
  sortBy: "vote_average.desc";
};

/**
 * Bara när det finns BÅDE ett speltidsönskemål och en genre/stämning: ett
 * discover-anrop efter de högst rankade titlarna som klarar båda ("mind-bending
 * under 100 min" → Predestination, Coherence, Moon, Primer …). Den vanliga
 * planen (populärt/topplistat) har inget speltidstak och missar dem, och
 * favoriternas rekommendationer är mest långa (prod: Sunshine, 108 min).
 */
export function planShortGreatCall(filter: MediaFilter, intent: PickIntent): ShortGreatCall | null {
  const types: MediaType[] = filter === "both" ? ["movie", "tv"] : [filter];
  for (const t of types) {
    const cap = t === "movie" ? intent.maxRuntimeMovie : intent.maxRuntimeTv;
    const genres = t === "movie" ? intent.movieGenres : intent.tvGenres;
    if (cap == null || genres.length === 0) continue;
    return {
      type: t,
      genres: [...genres],
      avoid: [...(t === "movie" ? intent.avoidMovieGenres : intent.avoidTvGenres)],
      runtimeLte: cap,
      runtimeGte: t === "movie" ? 60 : 15,
      voteMin: t === "movie" ? 800 : 300,
      sortBy: "vote_average.desc",
    };
  }
  return null;
}

/** Under så här många osedda träffar med tjänstefiltret görs ett anrop till utan det. */
export const SHORT_GREAT_MIN_UNSEEN = 8;
/** Platser för "kort och topprankat" bland de berikade och i listan till modellen. */
export const SHORT_GREAT_SLOTS = 10;
export const SHORT_RESERVE = 8;

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
  similarTo?: string[];
  shortGreat?: boolean;
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
    similarTo: input.similarTo ?? [],
    shortGreat: input.shortGreat || undefined,
    fit: 0,
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
    /** Alla favoriter/titelreferenser i samtalet (gäller hela samtalet) — slås upp mot TMDB. */
    refs: RefQuery[];
    /** Känd referens ("mer som den" = förra förslaget) — ingen sökning. */
    knownRef: CandidateReference | null;
  };
};

/** Titeln användaren sa att den gillar, upplöst mot TMDB. */
export type CandidateReference = { tmdbId: number; mediaType: MediaType; title: string; year: number | null };

/** En upplöst favorit (prompten: "The user loves: …"). */
export type LovedTitle = { title: string; year: number | null; mediaType: MediaType; genres: string[] };

export type CandidateSet = {
  candidates: PickCandidate[];
  savedCount: number;
  freshCount: number;
  /** Önskemålen som faktiskt användes (inkl. ev. uppluckrad speltid). */
  intent: PickIntent;
  effectiveFilter: MediaFilter;
  /** Bad användaren om något konkret (genre/speltid/undvik)? */
  constrained: boolean;
  /** "Mer som den"-titeln, annars första upplösta favoriten. */
  reference: CandidateReference | null;
  /** Upplösta favoriter som användaren nämnt i samtalet (följer med alla turer). */
  lovedTitles: LovedTitle[];
  /** Speltidstaket uppluckrades hit (för få bra titlar inom önskemålet), annars null. */
  runtimeRelaxedTo: number | null;
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
    refQueries: number;
    refsResolved: number;
    similarItems: number;
    shortGreatItems: number;
    agePenalty: boolean;
    horrorPenalty: boolean;
    freshEnriched: number;
    strictSaved: number;
    strictFresh: number;
    highFitSaved: number;
    highFitFresh: number;
    /** Uppluckrat tak (0 = inget). */
    runtimeRelaxedTo: number;
    msCandidates: number;
  };
};

const RECS_TIMEOUT_MS = 9000;
/** Sparade likes att berika (nyast + utspridda äldre, se selectSavedForEnrichment). */
const SAVED_ENRICH = 48;
/** Recommenderns lek: så många osedda att berika. */
const RECS_ENRICH = 24;
/** Discover/liknande: de bäst rankade (på listdata) att berika. Fler när favoriter finns. */
const LITE_ENRICH = 24;
const LITE_ENRICH_WITH_REFS = 30;
/** Garanterade platser för "liknar <favorit>" bland de berikade (≥ 10 enligt specen). */
const SIMILAR_MIN_SLOTS = 10;
const SIMILAR_MIN_SLOTS_MULTI = 16;
/** Med ett speltidsönskemål behövs fler liknande att välja bland (de flesta är långa). */
const SIMILAR_MIN_SLOTS_RUNTIME = 24;
const LITE_ENRICH_RUNTIME = 36;
/** Så många liknande titlar att be references.ts om. */
const SIMILAR_LIMIT = 60;
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
  release_date?: string | null;
  first_air_date?: string | null;
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
  /** Favoriterna/referenstiteln som TMDB rekommenderar den för (tom = ingen). */
  similarTo: string[];
  /** Ur ett "kort och topprankat"-pass (planShortGreatCall). */
  shortGreat?: boolean;
  /** År ur listdatan (null = okänt). */
  year?: number | null;
  /** Position i källistan (tiebreak). */
  order: number;
};

function toLite(r: TmdbListResult, mediaType: MediaType, order: number): LiteItem {
  return {
    tmdbId: r.id,
    mediaType,
    genreIds: Array.isArray(r.genre_ids) ? r.genre_ids : [],
    voteAverage: typeof r.vote_average === "number" && r.vote_count ? r.vote_average : null,
    voteCount: typeof r.vote_count === "number" ? r.vote_count : null,
    similarTo: [],
    year: yearOf(mediaType === "movie" ? r.release_date : r.first_air_date),
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
  opts: {
    affinity?: (ids: number[]) => number;
    constrained: boolean;
    surprise: boolean;
    refs?: RefContext | null;
    agePenalty?: boolean;
    horrorPenalty?: boolean;
  },
): LiteItem[] {
  const score = (i: LiteItem) => {
    const p = computeFit({ mediaType: i.mediaType, genreIds: i.genreIds, runtimeMin: null, similarTo: i.similarTo }, intent, opts.refs ?? null);
    const aff = opts.affinity ? opts.affinity(i.genreIds) : 0;
    return (
      FIT_WEIGHT * fitOf(p, intent) -
      (p.contradicts ? CONTRADICTION_PENALTY : 0) +
      qualityTerm({ voteAverage: i.voteAverage, voteCount: i.voteCount, mediaType: i.mediaType }) -
      obscurityPenalty(i) -
      (opts.agePenalty ? agePenaltyFor({ mediaType: i.mediaType, year: i.year ?? null }) : 0) -
      horrorPenaltyFor(i.genreIds, opts) +
      (opts.constrained && p.strict ? 0.5 : 0) +
      (opts.surprise ? -0.8 : 0.8) * aff -
      i.order * 0.005
    );
  };
  return items
    .map((it, idx) => ({ it, s: score(it), idx }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => x.it);
}

/**
 * De n bästa, men med minst `similarMin` platser för "liknar <favorit>" och
 * `shortMin` för "kort och topprankat" om de finns.
 */
export function pickLiteForEnrichment(ranked: LiteItem[], n: number, similarMin: number, shortMin = 0): LiteItem[] {
  const similar = ranked.filter((i) => i.similarTo.length > 0).slice(0, similarMin);
  const short = ranked.filter((i) => i.shortGreat && !similar.includes(i)).slice(0, shortMin);
  const out = [...similar, ...short];
  for (const i of ranked) {
    if (out.length >= n) break;
    if (!out.includes(i)) out.push(i);
  }
  return out.slice(0, Math.max(n, similar.length + short.length));
}

/** "Kort och topprankat"-anropet (se planShortGreatCall). */
async function discoverShortGreat(call: ShortGreatCall, ctx: DiscoverCtx, withProviders: boolean): Promise<LiteItem[]> {
  const t = call.type;
  const avoid = new Set<number>([...call.avoid, ...(ctx.showKids ? [] : t === "movie" ? [10751] : [10762, 10751])]);
  const data = await tmdbJson<{ results?: TmdbListResult[] }>(
    `/discover/${t}`,
    {
      language: ctx.tmdbLocale,
      region: t === "movie" ? ctx.region : undefined,
      watch_region: ctx.region,
      with_watch_providers: withProviders && ctx.services.discoverIds.length > 0 ? ctx.services.discoverIds.join("|") : undefined,
      with_genres: call.genres.join("|"),
      without_genres: avoid.size ? Array.from(avoid).join(",") : undefined,
      "with_runtime.lte": call.runtimeLte,
      "with_runtime.gte": call.runtimeGte,
      certification_country: t === "movie" ? "SE" : undefined,
      "certification.lte": t === "movie" ? ctx.certMax : undefined,
      sort_by: call.sortBy,
      "vote_count.gte": call.voteMin,
      include_adult: "false",
      page: 1,
    },
    DETAILS_REVALIDATE_S,
  );
  return (data?.results ?? [])
    .filter((r) => Number.isFinite(r.id) && !r.adult)
    .map((r, i) => ({ ...toLite(r, t, 200 + i), shortGreat: true }));
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
      // Bara genre-passet snävar in på speltid — och då med ett steg marginal
      // (taket kan behöva luckras upp, se relaxRuntimeForPool). En äldre, mjuk
      // speltid filtrerar inte alls. Populärt/topplistat är bredden.
      "with_runtime.lte": isGenre && maxRt && !intent.runtimeSoft ? maxRt + RELAX_STEP_MIN : undefined,
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
    .map((r, i) => toLite(r, t, (call.page - 1) * 20 + i));
}

/** Etikett för en referens i "similar to …" (titel + år). */
export function refLabel(r: { title: string; year: number | null }): string {
  return `${r.title}${r.year ? ` (${r.year})` : ""}`;
}

/**
 * Sida 2 av /recommendations för varje referens (≤ 3 cachade anrop) — när
 * speltiden är snäv räcker inte sida 1 + /similar till ≥ 12 korta titlar i
 * favoriternas stil ("kortare än Minority Report" → Source Code, Primer …).
 */
async function moreRecommendations(
  sources: { tmdbId: number; mediaType: MediaType; title: string }[],
  tmdbLocale: string,
  type: MediaType | null,
): Promise<LiteItem[]> {
  const list = sources.filter((r) => !type || r.mediaType === type).slice(0, MAX_REFERENCES);
  const pages = await Promise.all(
    list.map((r) =>
      tmdbJson<{ results?: TmdbListResult[] }>(`/${r.mediaType}/${r.tmdbId}/recommendations`, { language: tmdbLocale, page: 2 }, DETAILS_REVALIDATE_S).then(
        (d) => ({ r, results: (d?.results ?? []).filter((x) => Number.isFinite(x.id) && !x.adult) }),
      ),
    ),
  );
  const out: LiteItem[] = [];
  for (const { r, results } of pages) {
    for (const x of results) out.push({ ...toLite(x, r.mediaType, 100 + out.length), similarTo: [r.title] });
  }
  return out;
}

/** Slår ihop liknande-listor: samma titel → unionen av favoriterna den liknar. */
export function mergeSimilarLite(lists: LiteItem[][]): LiteItem[] {
  const byKey = new Map<string, LiteItem>();
  for (const l of lists) {
    for (const i of l) {
      const k = candidateKey(i.mediaType, i.tmdbId);
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, { ...i, similarTo: [...i.similarTo] });
      else for (const t of i.similarTo) if (!prev.similarTo.includes(t)) prev.similarTo.push(t);
    }
  }
  return [...byKey.values()];
}

/* ---------------- Huvudfunktion ---------------- */

export async function buildCandidates(input: BuildCandidatesInput): Promise<CandidateSet | null> {
  const t0 = Date.now();
  const fu = input.followUp ?? null;
  const refQueries = fu ? fu.refs : extractReferences(input.prompt);
  // Titlarna tas bort innan stämning/genre tolkas ("jag gillar Dark" ≠ mörkt).
  const baseIntent = fu ? fu.intent : parseIntent(withoutReferences(input.prompt, refQueries), input.chips);
  const filter = fu ? fu.filter : effectiveMediaFilter(input.mediaFilter, baseIntent);
  const wantType = (t: string) => filter === "both" || t === filter;
  const excludeIds = new Set(input.exclude);
  const constrained = intentHasConstraints(baseIntent);
  const knownRef = fu?.knownRef ?? null;
  const typeOrNull = filter === "both" ? null : filter;
  const hasRuntimeWish =
    (filter !== "tv" && baseIntent.maxRuntimeMovie != null) || (filter !== "movie" && baseIntent.maxRuntimeTv != null);

  /* ---- 0. Favoriter → TMDB (startas först; inget beror på DB:n) ---- */
  const resolvedPromise: Promise<ResolvedRef[]> =
    refQueries.length > 0
      ? resolveReferences(refQueries, { tmdbLocale: input.tmdbLocale, preferType: typeOrNull }).catch(() => [])
      : Promise.resolve([]);
  const similarPromise = resolvedPromise.then(async (resolved) => {
    const sources: ResolvedRef[] = [
      ...(knownRef
        ? [{ tmdbId: knownRef.tmdbId, mediaType: knownRef.mediaType, title: knownRef.title, year: knownRef.year, genreIds: [], voteAverage: null, voteCount: 0 }]
        : []),
      ...resolved.filter((r) => !knownRef || r.tmdbId !== knownRef.tmdbId || r.mediaType !== knownRef.mediaType),
    ];
    if (sources.length === 0) return { resolved, items: [] as LiteItem[] };
    const [sim, more] = await Promise.all([
      similarForReferences(sources, { tmdbLocale: input.tmdbLocale, mediaType: typeOrNull, limit: SIMILAR_LIMIT }).catch(() => []),
      hasRuntimeWish ? moreRecommendations(sources, input.tmdbLocale, typeOrNull).catch(() => []) : Promise.resolve([]),
    ]);
    const first: LiteItem[] = sim.map((s, i) => ({
      tmdbId: s.tmdbId,
      mediaType: s.mediaType,
      genreIds: s.genreIds,
      voteAverage: s.voteAverage,
      voteCount: s.voteCount,
      similarTo: s.similarTo,
      order: i,
    }));
    const refKeySet = new Set(sources.map((r) => candidateKey(r.mediaType, r.tmdbId)));
    const items = mergeSimilarLite([first, more]).filter((i) => !refKeySet.has(candidateKey(i.mediaType, i.tmdbId)));
    return { resolved, items };
  });

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
  const rank: FallbackOptions = { priority: input.priority, surprise: baseIntent.surprise, affinity, constrained };
  const showKids = profile.showKidsContent === true || baseIntent.wantsFamily;

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

  /* ---- 3. Discover (≤ 4 anrop) + "liknar <favorit>" — parallellt med recs ---- */
  const ctx: DiscoverCtx = {
    intent: baseIntent,
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
    const plan = planDiscoverCalls(filter, baseIntent);
    let lists = await Promise.all(plan.wave1.map((c) => discoverLite(c, ctx)));
    let calls = plan.wave1.length;
    if (plan.wave2.length > 0 && countUnseen(lists) < FRESH_POOL_TARGET) {
      lists = [...lists, ...(await Promise.all(plan.wave2.map((c) => discoverLite(c, ctx))))];
      calls += plan.wave2.length;
    }
    return { lists, calls };
  })();

  // "Kort och topprankat": speltid + stämning/genre → ett anrop (två om
  // tjänstefiltret ger för få osedda). Parallellt med resten.
  const shortPlan = planShortGreatCall(filter, baseIntent);
  const shortPromise = (async () => {
    if (!shortPlan) return { items: [] as LiteItem[], calls: 0 };
    const withProviders = services.discoverIds.length > 0;
    let items = await discoverShortGreat(shortPlan, ctx, withProviders);
    let calls = 1;
    if (withProviders && items.filter(liteOk).length < SHORT_GREAT_MIN_UNSEEN) {
      items = [...items, ...(await discoverShortGreat(shortPlan, ctx, false))];
      calls++;
    }
    return { items, calls };
  })().catch(() => ({ items: [] as LiteItem[], calls: 0 }));
  const topGenres = rankGenresByBehaviour(stats).top;
  const penaltiesFor = (resolved: ResolvedRef[]) =>
    contextPenalties(
      baseIntent,
      resolved.map((r) => r.year),
      topGenres,
    );

  const liteEnrichedPromise = Promise.all([discoverPromise, similarPromise, shortPromise]).then(async ([disc, sim, short]) => {
    const refKeys = new Set<string>(sim.resolved.map((r) => candidateKey(r.mediaType, r.tmdbId)));
    if (knownRef) refKeys.add(candidateKey(knownRef.mediaType, knownRef.tmdbId));
    const refCtx = refContextOf(sim.resolved);
    const byKey = new Map<string, LiteItem>();
    const lite: LiteItem[] = [];
    // Liknande först så deras flagga vinner vid dubbletter; "kort och topp"
    // markeras även på en titel som redan kom in som liknande.
    for (const i of [...sim.items, ...short.items, ...disc.lists.flat()]) {
      const k = candidateKey(i.mediaType, i.tmdbId);
      const prev = byKey.get(k);
      if (prev) {
        if (i.shortGreat) prev.shortGreat = true;
        if (prev.year == null && i.year != null) prev.year = i.year;
        continue;
      }
      if (refKeys.has(k) || !liteOk(i)) continue;
      const copy = { ...i };
      byKey.set(k, copy);
      lite.push(copy);
    }
    const multi = sim.resolved.length + (knownRef ? 1 : 0) > 1;
    const ranked = rankLiteItems(lite, baseIntent, {
      affinity,
      constrained,
      surprise: baseIntent.surprise,
      refs: refCtx,
      ...penaltiesFor(sim.resolved),
    });
    const shortMin = short.items.length > 0 ? SHORT_GREAT_SLOTS : 0;
    const chosen = pickLiteForEnrichment(
      ranked,
      (sim.items.length === 0 ? LITE_ENRICH : hasRuntimeWish ? LITE_ENRICH_RUNTIME : LITE_ENRICH_WITH_REFS) + shortMin,
      hasRuntimeWish ? SIMILAR_MIN_SLOTS_RUNTIME : multi ? SIMILAR_MIN_SLOTS_MULTI : SIMILAR_MIN_SLOTS,
      shortMin,
    );
    const enriched = await enrichAll(
      chosen.map((i) => ({
        tmdbId: i.tmdbId,
        mediaType: i.mediaType,
        fromSaved: false,
        likedAt: null,
        recRank: null,
        fromDiscover: i.similarTo.length === 0,
        similarTo: i.similarTo,
        shortGreat: i.shortGreat,
      })),
      input.tmdbLocale,
      region,
      services,
    );
    return {
      enriched,
      unseen: lite.length,
      calls: disc.calls + short.calls,
      similarItems: lite.filter((i) => i.similarTo.length > 0).length,
      shortGreatItems: lite.filter((i) => i.shortGreat).length,
      resolved: sim.resolved,
      refKeys,
      refCtx,
    };
  });

  const [savedEnriched, recsRes, liteRes] = await Promise.all([savedPromise, recsEnrichedPromise, liteEnrichedPromise]);

  /* ---- 4. Slå ihop, poängsätt, lucka ev. upp speltiden, välj ~30 ---- */
  const { refKeys, refCtx, resolved } = liteRes;
  const freshByKey = new Map<string, PickCandidate>();
  for (const c of [...liteRes.enriched, ...recsRes.enriched]) {
    const prev = freshByKey.get(c.key);
    if (!prev) freshByKey.set(c.key, c);
    else {
      prev.recRank = prev.recRank ?? c.recRank;
      if (prev.similarTo.length === 0) prev.similarTo = c.similarTo;
    }
  }
  // Avdrag som beror på samtalet (ålder, skräck i vaga frågor) — gäller även
  // fallback och alternativ i pick.ts, därför på `rank`.
  Object.assign(rank, penaltiesFor(resolved));
  // Referenstitlarna själva föreslås inte — "favoriter är X" betyder att de sett X.
  let fresh = [...freshByKey.values()].filter((c) => !refKeys.has(c.key) && wantType(c.mediaType));
  let saved = savedEnriched.filter((c) => !refKeys.has(c.key));
  if (rank.agePenalty) {
    // Doctor Who 2005 före Doctor Who 1963 när båda finns.
    const keep = new Set(preferModernVersions([...saved, ...fresh]).map((c) => c.key));
    saved = saved.filter((c) => keep.has(c.key));
    fresh = fresh.filter((c) => keep.has(c.key));
  }
  let intent = baseIntent;
  scoreCandidates(fresh, intent, refCtx);
  scoreCandidates(saved, intent, refCtx);
  const relaxed = relaxRuntimeForPool([...saved, ...fresh], intent);
  if (relaxed !== intent) {
    intent = relaxed;
    scoreCandidates(fresh, intent, refCtx);
    scoreCandidates(saved, intent, refCtx);
  }
  const runtimeRelaxedTo = runtimeRelaxedFor(intent, filter);
  // Med favoriter/"mer som den": max 10 sparade och ≥ 12 platser för titlar i
  // favoriternas stil som klarar speltiden (prod: 18 sparade, The Transporter).
  const hasRefs = resolved.length > 0 || knownRef != null;
  const savedMax = hasRefs ? SAVED_MAX_WITH_REFS : input.priority === "strong" ? 18 : 12;
  const candidates = selectFinalCandidates(saved, fresh, {
    ...rank,
    savedMax,
    similarReserve: hasRefs ? SIMILAR_RESERVE : 0,
    // "Kort och topprankat" bara när speltiden är ett aktuellt önskemål.
    shortReserve: shortPlan && !intent.runtimeSoft ? SHORT_RESERVE : 0,
  });

  const [taste, names] = await Promise.all([
    tastePromise,
    resolved.length > 0 ? genreNameMap(input.tmdbLocale) : Promise.resolve(new Map<number, string>()),
  ]);
  const lovedTitles: LovedTitle[] = resolved.map((r) => ({
    title: r.title,
    year: r.year,
    mediaType: r.mediaType,
    genres: r.genreIds.map((id) => names.get(id)).filter((n): n is string => !!n),
  }));
  const first = resolved[0];
  const reference: CandidateReference | null =
    knownRef ?? (first ? { tmdbId: first.tmdbId, mediaType: first.mediaType, title: first.title, year: first.year } : null);

  return {
    candidates,
    savedCount: candidates.filter((c) => c.fromSaved).length,
    freshCount: candidates.filter((c) => !c.fromSaved).length,
    intent,
    effectiveFilter: filter,
    constrained,
    reference,
    lovedTitles,
    runtimeRelaxedTo,
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
      refQueries: refQueries.length,
      refsResolved: resolved.length,
      similarItems: liteRes.similarItems,
      shortGreatItems: liteRes.shortGreatItems,
      agePenalty: rank.agePenalty === true,
      horrorPenalty: rank.horrorPenalty === true,
      freshEnriched: fresh.length,
      strictSaved: saved.filter((c) => c.strictMatch).length,
      strictFresh: fresh.filter((c) => c.strictMatch).length,
      highFitSaved: saved.filter((c) => c.highFit).length,
      highFitFresh: fresh.filter((c) => c.highFit).length,
      runtimeRelaxedTo: runtimeRelaxedTo ?? 0,
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
