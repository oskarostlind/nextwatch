// lib/tasteModel.ts — delad seed-/smaklogik för recs och smakprofil.

import { prisma } from "@/lib/prisma";
import { parseProvidersJson } from "@/lib/groupSettings";

export type MediaType = "movie" | "tv";

export type FavoriteItem = {
  id: number;
  title: string;
  year?: string | number | null;
  poster?: string | null;
};

type TMDBKeywords = { id: number; keywords?: { id: number; name: string }[] };
type TMDBKeywordsTV = { id: number; results?: { id: number; name: string }[] };
type TMDBCredits = {
  id: number;
  cast?: { id: number; name: string; order?: number }[];
  crew?: { id: number; name: string; job?: string; department?: string }[];
};
type TMDBDetailsWithAppends = {
  keywords?: TMDBKeywords | TMDBKeywordsTV;
  credits?: TMDBCredits;
  genres?: { id: number; name: string }[];
};

export type Seed = { id: number; type: MediaType; weight: number; title?: string };

export type WeightedLabel = { id: number; name: string; weight: number };

export type TasteMaps = {
  keywordW: Map<number, number>;
  peopleW: Map<number, number>;
  /**
   * Anime kontra västerländsk animation, härlett ur seeds: −1 (bara västerländskt
   * gillat / anime ogillat) … +1 (bara anime gillat). 0 = ingen signal (inga
   * animerade seeds). Se hasAnimeMarker.
   */
  animeAffinity: number;
};

export type TasteLabels = {
  keywords: WeightedLabel[];
  directors: WeightedLabel[];
  cast: WeightedLabel[];
  /** Härledda ur titlarna användaren faktiskt gillat — inte ur profilens kryssrutor. */
  genres: WeightedLabel[];
};

export type RatingSeedRow = {
  tmdbId: number;
  mediaType: string;
  rating: number | null;
  decision: string;
};

export type TasteInput = {
  isGroup: boolean;
  groupCode: string | null;
  locale: string;
  profile: {
    userId: string;
    favoriteGenres: string[];
    dislikedGenres: string[];
    providers: unknown;
    favoriteMovie: unknown;
    favoriteShow: unknown;
    dob: Date;
    recycleAfterDays: number | null;
  };
  memberProfiles: Array<{
    userId: string;
    favoriteGenres: string[];
    dislikedGenres: string[];
    providers: unknown;
    favoriteMovie: unknown;
    favoriteShow: unknown;
    dob: Date;
    recycleAfterDays: number | null;
  }>;
  groupRow: {
    favoriteGenres: string[];
    dislikedGenres: string[];
    providers: unknown;
    maxCert: string | null;
  } | null;
  ratings: RatingSeedRow[];
  watchlist: Array<{ tmdbId: number; mediaType: string }>;
  groupRatings: RatingSeedRow[];
  groupWatchlist: Array<{ tmdbId: number; mediaType: string }>;
};

type FeatureBundle = {
  keywords: { id: number; name: string }[];
  directors: { id: number; name: string }[];
  cast: { id: number; name: string }[];
  /**
   * Genrer enligt TMDB. Följer med gratis i samma detaljsvar som keywords/credits
   * och används för att härleda favoritgenrer ur faktiskt beteende — till skillnad
   * från Profile.favoriteGenres, som användaren kryssat i själv.
   */
  genres: { id: number; name: string }[];
};

/* ---------------- TMDB ---------------- */

export async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  cacheMode: RequestCache = "no-store",
): Promise<T> {
  const v4 =
    process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN ?? process.env.TMDB_READ_TOKEN;
  const v3 = process.env.TMDB_API_KEY;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  if (!v4 && v3) usp.set("api_key", v3);

  const url = `https://api.themoviedb.org/3${path}${usp.toString() ? `?${usp.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
    cache: cacheMode,
  });
  if (!res.ok) throw new Error(`TMDB ${path} ${res.status}`);
  return (await res.json()) as T;
}

function extractKeywords(d: TMDBDetailsWithAppends): { id: number; name: string }[] {
  const kw = d.keywords;
  if (!kw) return [];
  const arr =
    "keywords" in kw && Array.isArray(kw.keywords)
      ? kw.keywords
      : "results" in kw && Array.isArray(kw.results)
        ? kw.results
        : [];
  return arr
    .filter((x) => Number.isFinite(x.id) && typeof x.name === "string")
    .map((x) => ({ id: x.id, name: x.name }));
}

function extractPeople(d: TMDBDetailsWithAppends, type: MediaType): {
  directors: { id: number; name: string }[];
  cast: { id: number; name: string }[];
} {
  const c = d.credits;
  if (!c) return { directors: [], cast: [] };

  const cast = (c.cast ?? [])
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 5)
    .filter((m) => typeof m.id === "number" && typeof m.name === "string")
    .map((m) => ({ id: m.id, name: m.name }));

  const directors: { id: number; name: string }[] = [];
  const crew = c.crew ?? [];
  if (type === "movie") {
    for (const m of crew) {
      if (m.job === "Director" && typeof m.id === "number" && typeof m.name === "string") {
        directors.push({ id: m.id, name: m.name });
      }
    }
  } else {
    for (const m of crew) {
      if (
        (m.job === "Creator" || m.department === "Writing") &&
        typeof m.id === "number" &&
        typeof m.name === "string"
      ) {
        directors.push({ id: m.id, name: m.name });
      }
    }
  }

  return { directors, cast };
}

export async function fetchFeatures(type: MediaType, id: number, locale: string): Promise<FeatureBundle> {
  const path = type === "movie" ? `/movie/${id}` : `/tv/${id}`;
  const primary = await tmdbGet<TMDBDetailsWithAppends>(
    path,
    { language: locale, append_to_response: "keywords,credits" },
    "force-cache",
  ).catch(() => null);

  if (primary) {
    const keywords = extractKeywords(primary);
    const { directors, cast } = extractPeople(primary, type);
    if (keywords.length || directors.length || cast.length) {
      return { keywords, directors, cast, genres: primary.genres ?? [] };
    }
  }

  const fallback = await tmdbGet<TMDBDetailsWithAppends>(
    path,
    { language: "en-US", append_to_response: "keywords,credits" },
    "force-cache",
  );
  return {
    keywords: extractKeywords(fallback),
    ...extractPeople(fallback, type),
    genres: fallback.genres ?? [],
  };
}

/* ---------------- Animationsstil (anime vs västerländskt) ---------------- */

// TMDB:s genre "Animation" (16) buntar ihop Ghibli med Disney — enorm skillnad
// i praktiken. Nyckelorden skiljer dem åt: TMDB-keywords är alltid engelska
// (lokaliseras inte), så namnmatchning är stabil oavsett locale.
export const ANIMATION_GENRE_ID = 16;
const ANIME_KEYWORD_IDS = new Set([210024 /* anime */, 13141 /* based on manga */]);
const ANIME_KEYWORD_NAMES = new Set(["anime", "based on manga", "manga", "based on anime"]);

export function hasAnimeMarker(keywords: { id: number; name: string }[]): boolean {
  return keywords.some(
    (kw) => ANIME_KEYWORD_IDS.has(kw.id) || ANIME_KEYWORD_NAMES.has(kw.name.toLowerCase()),
  );
}

function increment(map: Map<number, number>, key: number, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementNamed(
  map: Map<number, { weight: number; name: string }>,
  id: number,
  name: string,
  amount: number,
) {
  const prev = map.get(id);
  map.set(id, { name, weight: (prev?.weight ?? 0) + amount });
}

function normalizeTopK(map: Map<number, number>, k: number) {
  const entries = Array.from(map.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, k);
  const max = Math.abs(entries[0]?.[1] ?? 1) || 1;
  const out = new Map<number, number>();
  for (const [id, w] of entries) out.set(id, w / max);
  return out;
}

function labelsFromNamedMap(
  map: Map<number, { weight: number; name: string }>,
  k: number,
  positiveOnly = true,
): WeightedLabel[] {
  const entries = Array.from(map.entries())
    .filter(([, v]) => !positiveOnly || v.weight > 0)
    .sort((a, b) => Math.abs(b[1].weight) - Math.abs(a[1].weight))
    .slice(0, k);
  const max = Math.abs(entries[0]?.[1].weight ?? 1) || 1;
  return entries.map(([id, v]) => ({
    id,
    name: v.name,
    weight: v.weight / max,
  }));
}

export async function buildTasteMaps(seeds: Seed[], locale: string): Promise<TasteMaps> {
  const keywordW = new Map<number, number>();
  const peopleW = new Map<number, number>();
  const feats: FeatureBundle[] = await Promise.all(
    seeds.map((s) => fetchFeatures(s.type, s.id, locale).catch(() => ({
      keywords: [],
      directors: [],
      cast: [],
      genres: [],
    }))),
  );

  // Anime-affinitet: av de ANIMERADE titlar användaren reagerat på, hur
  // anime-lutande är reaktionerna? Negativa seed-vikter (dislikes) drar åt
  // andra hållet, så "gillar Ghibli, ogillar Disney" → +1 och tvärtom.
  let animeRaw = 0;
  let westernRaw = 0;

  for (let i = 0; i < seeds.length; i++) {
    const w = seeds[i].weight;
    const f = feats[i];
    for (const kw of f.keywords) increment(keywordW, kw.id, w);
    for (const p of [...f.directors, ...f.cast]) increment(peopleW, p.id, w);

    if ((f.genres ?? []).some((g) => g.id === ANIMATION_GENRE_ID)) {
      if (hasAnimeMarker(f.keywords)) animeRaw += w;
      else westernRaw += w;
    }
  }

  const styleDenom = Math.abs(animeRaw) + Math.abs(westernRaw);

  return {
    keywordW: normalizeTopK(keywordW, 60),
    peopleW: normalizeTopK(peopleW, 60),
    animeAffinity: styleDenom > 0 ? (animeRaw - westernRaw) / styleDenom : 0,
  };
}

export async function buildTasteLabels(seeds: Seed[], locale: string): Promise<TasteLabels> {
  const keywordMap = new Map<number, { weight: number; name: string }>();
  const directorMap = new Map<number, { weight: number; name: string }>();
  const castMap = new Map<number, { weight: number; name: string }>();
  const genreMap = new Map<number, { weight: number; name: string }>();

  const feats = await Promise.all(
    seeds.map((s) => fetchFeatures(s.type, s.id, locale).catch(() => ({
      keywords: [],
      directors: [],
      cast: [],
      genres: [],
    }))),
  );

  for (let i = 0; i < seeds.length; i++) {
    const w = seeds[i].weight;
    const f = feats[i];
    for (const kw of f.keywords) incrementNamed(keywordMap, kw.id, kw.name, w);
    for (const p of f.directors) incrementNamed(directorMap, p.id, p.name, w);
    for (const p of f.cast) incrementNamed(castMap, p.id, p.name, w);
    for (const g of f.genres) incrementNamed(genreMap, g.id, g.name, w);
  }

  return {
    keywords: labelsFromNamedMap(keywordMap, 8),
    directors: labelsFromNamedMap(directorMap, 5),
    cast: labelsFromNamedMap(castMap, 5),
    genres: labelsFromNamedMap(genreMap, 5),
  };
}

/* ---------------- Seeds ---------------- */

export function numericSeedWeight(rating: number): number | null {
  if (rating >= 7) return (rating - 6) / 4;
  if (rating <= 4) return -(5 - rating) / 4;
  if (rating === 5) return -0.12;
  if (rating === 6) return -0.06;
  return null;
}

export function decisionSeedWeight(decision: string): number | null {
  if (decision === "dislike") return -0.5;
  if (decision === "like") return 0.85;
  if (decision === "seen") return -0.15;
  return null;
}

export function seedFromRatingRow(r: RatingSeedRow): number | null {
  if (typeof r.rating === "number") {
    const w = numericSeedWeight(r.rating);
    if (w !== null) return w;
  }
  return decisionSeedWeight(r.decision);
}

export function mergeSeedWeight(prev: number | undefined, next: number): number {
  if (prev === undefined) return next;
  if (next < 0 && prev > 0) return next;
  if (next > 0 && prev < 0) return prev;
  return Math.abs(next) > Math.abs(prev) ? next : prev;
}

function asFavoriteItem(x: unknown): FavoriteItem | null {
  if (!x || typeof x !== "object") return null;
  const obj = x as Record<string, unknown>;
  if (typeof obj.id !== "number" || typeof obj.title !== "string") return null;
  return {
    id: obj.id,
    title: obj.title,
    year: typeof obj.year === "string" || typeof obj.year === "number" ? obj.year : null,
    poster: typeof obj.poster === "string" ? obj.poster : null,
  };
}

export function buildSeeds(input: TasteInput): Seed[] {
  const seedWeights = new Map<string, Seed>();

  function addSeed(id: number, type: MediaType, weight: number, title?: string) {
    const k = `${type}_${id}`;
    const prev = seedWeights.get(k);
    const merged = mergeSeedWeight(prev?.weight, weight);
    seedWeights.set(k, { id, type, weight: merged, title: title ?? prev?.title });
  }

  if (input.isGroup) {
    for (const p of input.memberProfiles) {
      const fm = asFavoriteItem(p.favoriteMovie);
      const fs = asFavoriteItem(p.favoriteShow);
      if (fm?.id) addSeed(fm.id, "movie", 1.0, fm.title);
      if (fs?.id) addSeed(fs.id, "tv", 1.0, fs.title);
    }
    for (const w of input.groupWatchlist) {
      addSeed(w.tmdbId, w.mediaType as MediaType, 1.0);
    }
  } else {
    const favMovie = asFavoriteItem(input.profile.favoriteMovie);
    const favShow = asFavoriteItem(input.profile.favoriteShow);
    if (favMovie?.id) addSeed(favMovie.id, "movie", 1.0, favMovie.title);
    if (favShow?.id) addSeed(favShow.id, "tv", 1.0, favShow.title);
    for (const w of input.watchlist) {
      addSeed(w.tmdbId, w.mediaType as MediaType, 1.0);
    }
  }

  const seedRatings = input.isGroup ? input.groupRatings : input.ratings;
  for (const r of seedRatings) {
    const w = seedFromRatingRow(r);
    if (w !== null) addSeed(r.tmdbId, r.mediaType as MediaType, w);
  }

  const seedCap = input.isGroup ? 20 : 14;
  return Array.from(seedWeights.values())
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, seedCap);
}

export function resolveGenreSets(input: TasteInput): { liked: Set<string>; disliked: Set<string> } {
  const groupLikedOverride = input.isGroup ? input.groupRow?.favoriteGenres ?? [] : [];
  const groupDislikedOverride = input.isGroup ? input.groupRow?.dislikedGenres ?? [] : [];

  if (input.isGroup && (groupLikedOverride.length > 0 || groupDislikedOverride.length > 0)) {
    const liked = new Set(groupLikedOverride);
    const disliked = new Set(groupDislikedOverride);
    for (const g of liked) disliked.delete(g);
    return { liked, disliked };
  }

  if (input.isGroup) {
    const liked = new Set<string>();
    const disliked = new Set<string>();
    for (const p of input.memberProfiles) {
      for (const g of p.favoriteGenres ?? []) liked.add(g);
      for (const g of p.dislikedGenres ?? []) disliked.add(g);
    }
    for (const g of liked) disliked.delete(g);
    return { liked, disliked };
  }

  return {
    liked: new Set(input.profile.favoriteGenres ?? []),
    disliked: new Set(input.profile.dislikedGenres ?? []),
  };
}

export function resolveProviderStrings(input: TasteInput): string[] {
  const providerStrings = new Set<string>();
  const groupProviderOverride = input.isGroup ? parseProvidersJson(input.groupRow?.providers) : [];

  if (input.isGroup && groupProviderOverride.length > 0) {
    groupProviderOverride.forEach((s) => providerStrings.add(s));
  } else if (input.isGroup) {
    for (const p of input.memberProfiles) {
      const pProviders = p.providers as string[] | undefined;
      if (Array.isArray(pProviders)) pProviders.forEach((s) => providerStrings.add(s));
    }
  } else {
    const pProviders = input.profile.providers as string[] | undefined;
    if (Array.isArray(pProviders)) pProviders.forEach((s) => providerStrings.add(s));
  }

  return Array.from(providerStrings);
}

export function ageFromDob(d: Date): number {
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

export function seMaxCert(age: number): string {
  if (age >= 15) return "15";
  if (age >= 11) return "11";
  if (age >= 7) return "7";
  return "0";
}

export function resolveMaxCert(input: TasteInput): string {
  const groupCertOverride =
    input.isGroup && input.groupRow?.maxCert ? input.groupRow.maxCert : null;
  if (groupCertOverride) return groupCertOverride;
  if (input.isGroup && input.memberProfiles.length > 0) {
    const ages = input.memberProfiles.map((p) => ageFromDob(new Date(p.dob)));
    return seMaxCert(Math.min(...ages));
  }
  return seMaxCert(ageFromDob(new Date(input.profile.dob)));
}

export async function loadTasteInput(uid: string, groupCode: string | null): Promise<TasteInput | null> {
  const [profile, ratings, watchlist, groupMembers, groupRow] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: uid } }),
    prisma.rating.findMany({
      where: { userId: uid },
      select: { tmdbId: true, mediaType: true, rating: true, decision: true },
    }),
    prisma.watchlist.findMany({
      where: { userId: uid },
      select: { tmdbId: true, mediaType: true },
    }),
    groupCode
      ? prisma.groupMember.findMany({
          where: { groupCode },
          include: { user: { include: { profile: true } } },
        })
      : Promise.resolve([]),
    groupCode
      ? prisma.group.findUnique({
          where: { code: groupCode },
          select: {
            favoriteGenres: true,
            dislikedGenres: true,
            providers: true,
            maxCert: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!profile) return null;

  const isGroup = !!groupCode && groupMembers.length > 0;
  const memberProfiles = isGroup
    ? groupMembers
        .map((m) => m.user.profile)
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [];

  const groupMemberIds = isGroup ? groupMembers.map((m) => m.userId) : [];
  const [groupWatchlist, groupRatings] = isGroup
    ? await Promise.all([
        prisma.watchlist.findMany({
          where: { userId: { in: groupMemberIds } },
          select: { tmdbId: true, mediaType: true },
        }),
        prisma.rating.findMany({
          where: { userId: { in: groupMemberIds } },
          select: { tmdbId: true, mediaType: true, rating: true, decision: true },
        }),
      ])
    : [[], []];

  return {
    isGroup,
    groupCode: isGroup ? groupCode : null,
    locale: profile.locale ?? "sv-SE",
    profile,
    memberProfiles,
    groupRow,
    ratings,
    watchlist,
    groupRatings,
    groupWatchlist,
  };
}

/* ---------------- Match reasons ---------------- */

type GenreMaps = {
  movieIdToName: Map<number, string>;
  tvIdToName: Map<number, string>;
};

export function genreScoreNames(
  itemGenreIds: number[] | undefined,
  type: MediaType,
  maps: GenreMaps,
  liked: Set<string>,
  disliked: Set<string>,
): { liked: string[]; disliked: string[] } {
  const likedHits: string[] = [];
  const dislikedHits: string[] = [];
  if (!itemGenreIds?.length) return { liked: likedHits, disliked: dislikedHits };

  for (const id of itemGenreIds) {
    const name = type === "movie" ? maps.movieIdToName.get(id) : maps.tvIdToName.get(id);
    if (!name) continue;
    if (liked.has(name)) likedHits.push(name);
    if (disliked.has(name)) dislikedHits.push(name);
  }
  return { liked: likedHits, disliked: dislikedHits };
}

/** Vad en träff bottnar i — låter UI:t skriva "skådespelaren X" i stället för bara "X". */
export type MatchEvidenceKind = "genre" | "keyword" | "director" | "cast";

export type MatchEvidence = { label: string; kind: MatchEvidenceKind };

/**
 * Rankade träffar mot användarens smak, med kategori kvar. Genrer väger tyngst
 * som etikett men säger minst om smaken — de är explicit valda i profilen, medan
 * personer och teman är härledda ur faktiskt beteende.
 */
export function buildMatchEvidence(opts: {
  taste: TasteMaps;
  features: FeatureBundle;
  genreHits: { liked: string[]; disliked: string[] };
  max?: number;
}): MatchEvidence[] {
  const max = opts.max ?? 4;
  const scored: { label: string; kind: MatchEvidenceKind; score: number }[] = [];

  for (const g of opts.genreHits.liked) {
    scored.push({ label: g, kind: "genre", score: 2.0 });
  }

  for (const kw of opts.features.keywords) {
    const w = opts.taste.keywordW.get(kw.id);
    if (w && w > 0) scored.push({ label: kw.name, kind: "keyword", score: 1.2 * w });
  }

  for (const p of opts.features.directors) {
    const w = opts.taste.peopleW.get(p.id);
    if (w && w > 0) scored.push({ label: p.name, kind: "director", score: 1.4 * w });
  }

  for (const p of opts.features.cast) {
    const w = opts.taste.peopleW.get(p.id);
    if (w && w > 0) scored.push({ label: p.name, kind: "cast", score: 1.4 * w });
  }

  scored.sort((a, b) => b.score - a.score);
  const out: MatchEvidence[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    const key = s.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: s.label, kind: s.kind });
    if (out.length >= max) break;
  }
  return out;
}

export function buildMatchReasons(opts: {
  taste: TasteMaps;
  features: FeatureBundle;
  genreHits: { liked: string[]; disliked: string[] };
  max?: number;
}): string[] {
  return buildMatchEvidence(opts).map((e) => e.label);
}

export function shouldShowSwipeReasons(tmdbId: number, mediaType: MediaType, rate: number): boolean {
  if (rate <= 0) return false;
  // Stabil pseudo-slumpning per titel.
  const h = (tmdbId * 31 + (mediaType === "movie" ? 7 : 13)) % 100;
  return h < rate * 100;
}
