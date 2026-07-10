// lib/unifiedRecs.ts
//
// Delad rekommendationsmotor bakom app/api/recs/unified/route.ts.
// Extraherad så att både den cookie-baserade routen och det schemalagda
// dagliga rekommendations-jobbet (app/api/cron/daily-recs) kan återanvända
// exakt samma scoring/MMR-pipeline utan att duplicera logik.

import { prisma } from "@/lib/prisma";
import { parseProvidersJson } from "@/lib/groupSettings";
import { SWIPE_REASONS_SHOW_RATE } from "@/lib/tasteFeature";
import {
  buildMatchReasons,
  buildSeeds,
  buildTasteMaps,
  fetchFeatures,
  genreScoreNames,
  resolveGenreSets,
  resolveMaxCert,
  resolveProviderStrings,
  shouldShowSwipeReasons,
  tmdbGet,
  type MediaType,
} from "@/lib/tasteModel";
import { normalizeSwipeMediaFilter, type SwipeMediaFilter } from "@/lib/swipeMediaFilter";

export type { MediaType, SwipeMediaFilter };

/* ---------- TMDB shared types ---------- */
type TMDBPaged<T> = { page: number; results: T[]; total_pages?: number };
type TMDBListItem = {
  id: number;
  name?: string;
  title?: string;
  genre_ids?: number[];
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  first_air_date?: string | null;
  release_date?: string | null;
};
type TMDBGenreList = { genres: { id: number; name: string }[] };

/* -------------------------------------- */

export type UnifiedItem = {
  id: number;
  tmdbType: MediaType;
  title: string;
  year?: string;
  poster_path?: string | null;
  vote_average?: number;
  /** Kort förklaring varför titeln matchar (visas ibland i swipe). */
  reasons?: string[];
};

export type UnifiedRecsOk = {
  ok: true;
  mode: "group" | "individual";
  group: { code: string; strictProviders: boolean } | null;
  language: string;
  region: string;
  usedProviderIds: number[];
  mediaFilter: SwipeMediaFilter;
  items: UnifiedItem[];
};

export type UnifiedRecsErr = { ok: false; message: string; status: number };

export type UnifiedRecsResult = UnifiedRecsOk | UnifiedRecsErr;

export type UnifiedRecsParams = {
  uid: string;
  region: string;
  locale: string;
  groupCode: string | null;
  page?: number;
  /** Solo: från klient. Grupp: ignoreras — läses från Group.mediaFilter. */
  mediaFilter?: SwipeMediaFilter;
};

/* ---------- Provider Mapping ---------- */
const PROVIDER_MAP: Record<string, number> = {
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

function getProviderIds(providerStrings: string[]): number[] {
  const ids = new Set<number>();
  for (const p of providerStrings) {
    const normalized = p.toLowerCase().trim();
    const id = PROVIDER_MAP[normalized];
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

function fail(message: string, status = 200): UnifiedRecsErr {
  return { ok: false, message, status };
}

function pickTitle(x: TMDBListItem): string {
  return (x.title || x.name || "Untitled").trim();
}

function yearFrom(item: TMDBListItem): string | undefined {
  const d = item.release_date || item.first_air_date;
  if (!d) return undefined;
  const y = d.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : undefined;
}

function qualityScore(voteAvg?: number, voteCount?: number): number {
  if (!voteAvg || !voteCount) return 0;
  const s = Math.log10(voteCount + 1);
  return voteAvg * s;
}

function recencyBonus(year?: string): number {
  if (!year) return 0;
  const y = Number(year);
  if (!Number.isFinite(y)) return 0;
  const now = new Date().getFullYear();
  const diff = now - y;
  if (diff <= 1) return 1.0;
  if (diff <= 3) return 0.7;
  if (diff <= 5) return 0.4;
  return 0.1;
}

function dedupe(items: { id: number; tmdbType: MediaType; item: TMDBListItem }[]) {
  const seen = new Set<string>();
  const out: { id: number; tmdbType: MediaType; item: TMDBListItem }[] = [];
  for (const it of items) {
    const k = `${it.tmdbType}_${it.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/* ---------------- Genre scoring (V1) ---------------- */

function genreScore(
  itemGenreIds: number[] | undefined,
  movieIdToName: Map<number, string>,
  tvIdToName: Map<number, string>,
  type: MediaType,
  liked: Set<string>,
  disliked: Set<string>,
): number {
  if (!itemGenreIds?.length) return 0;
  let score = 0;
  for (const id of itemGenreIds) {
    const name = type === "movie" ? movieIdToName.get(id) : tvIdToName.get(id);
    if (!name) continue;
    if (liked.has(name)) score += 1.0;
    if (disliked.has(name)) score -= 1.3;
  }
  return score;
}

/* ---------------- Similarity (MMR) ---------------- */

function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isExcludedByRecycle(at: Date, recycleDays: number): boolean {
  if (!Number.isFinite(recycleDays) || recycleDays <= 0) return true;
  const ms = recycleDays * 24 * 60 * 60 * 1000;
  return Date.now() - at.getTime() < ms;
}

/* ---------------- Core pipeline ---------------- */

export async function computeUnifiedRecs(params: UnifiedRecsParams): Promise<UnifiedRecsResult> {
  const { uid, region, locale, groupCode, page = 1, mediaFilter: soloMediaFilter } = params;

  try {
    // 1. Hämta data från databasen direkt via Prisma
    const [profile, ratings, watchlist, groupMembers, groupRow] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: uid } }),
      prisma.rating.findMany({
        where: { userId: uid },
        select: { tmdbId: true, mediaType: true, rating: true, decision: true, decidedAt: true, userId: true },
      }),
      prisma.watchlist.findMany({
        where: { userId: uid },
        select: { tmdbId: true, mediaType: true, addedAt: true },
      }),
      groupCode
        ? prisma.groupMember.findMany({ where: { groupCode }, include: { user: { include: { profile: true } } } })
        : Promise.resolve([]),
      groupCode
        ? prisma.group.findUnique({
            where: { code: groupCode },
            select: {
              favoriteGenres: true,
              dislikedGenres: true,
              providers: true,
              maxCert: true,
              mediaFilter: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!profile) return fail("Ingen profil hittades.");

    // Gruppläge kräver minst en laddad medlem (utöver kod).
    const isGroup = !!groupCode && groupMembers.length > 0;
    const mediaFilter: SwipeMediaFilter = isGroup
      ? normalizeSwipeMediaFilter(groupRow?.mediaFilter)
      : normalizeSwipeMediaFilter(soloMediaFilter);
    const wantMovie = mediaFilter === "both" || mediaFilter === "movie";
    const wantTv = mediaFilter === "both" || mediaFilter === "tv";
    // Alla medlemsprofiler (för providers, genrer, ålder och seeds).
    const memberProfiles = isGroup
      ? groupMembers
          .map((m) => m.user.profile)
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
      : [];

    // Grupp: hämta ALLA medlemmars watchlists + ratings (exkludering + smak).
    const groupMemberIds = isGroup ? groupMembers.map((m) => m.userId) : [];
    const [groupWatchlist, groupRatings] = isGroup
      ? await Promise.all([
          prisma.watchlist.findMany({
            where: { userId: { in: groupMemberIds } },
            select: { tmdbId: true, mediaType: true, addedAt: true, userId: true },
          }),
          prisma.rating.findMany({
            where: { userId: { in: groupMemberIds } },
            select: {
              tmdbId: true,
              mediaType: true,
              rating: true,
              decision: true,
              decidedAt: true,
              userId: true,
            },
          }),
        ])
      : [[], []];

    // Gruppinställningar (kugghjulet): satta värden åsidosätter automatiken,
    // tomma/null faller tillbaka på medlemsaggregeringen nedan.
    const strictProviders = isGroup && (groupRow?.providers != null) &&
      parseProvidersJson(groupRow?.providers).length > 0;

    const tasteInput = {
      isGroup,
      groupCode: isGroup ? groupCode : null,
      locale,
      profile,
      memberProfiles,
      groupRow,
      ratings,
      watchlist,
      groupRatings,
      groupWatchlist,
    };

    const providerStringList = resolveProviderStrings(tasteInput);
    const usedProviderIds = getProviderIds(providerStringList);
    const tmdbProviderString = usedProviderIds.length > 0 ? usedProviderIds.join("|") : undefined;
    const certMax = resolveMaxCert(tasteInput);

    const recycleByUser = new Map<string, number>();
    recycleByUser.set(uid, profile.recycleAfterDays ?? 14);
    for (const p of memberProfiles) {
      recycleByUser.set(p.userId, p.recycleAfterDays ?? 14);
    }

    const exclusionRatings = isGroup ? groupRatings : ratings;
    const exclusionWatchlist = isGroup ? groupWatchlist : watchlist;

    const watchKeys = new Set<string>();
    for (const r of exclusionRatings) {
      const recycle = recycleByUser.get(r.userId) ?? 14;
      if (isExcludedByRecycle(r.decidedAt, recycle)) {
        watchKeys.add(`${r.mediaType}_${r.tmdbId}`);
      }
    }
    // Watchlist: alltid exkludera medan titeln ligger kvar (avsiktlig sparning).
    for (const w of exclusionWatchlist) {
      watchKeys.add(`${w.mediaType}_${w.tmdbId}`);
    }

    // Genres
    const [movieGenres, tvGenres] = await Promise.all([
      tmdbGet<TMDBGenreList>("/genre/movie/list", { language: locale }, "force-cache"),
      tmdbGet<TMDBGenreList>("/genre/tv/list", { language: locale }, "force-cache"),
    ]);
    const movieIdToName = new Map(movieGenres.genres.map((g) => [g.id, g.name] as const));
    const tvIdToName = new Map(tvGenres.genres.map((g) => [g.id, g.name] as const));
    const { liked: likedGenres, disliked: dislikedGenres } = resolveGenreSets(tasteInput);

    const pageNum = Math.max(1, page);

    // 3. TMDB Discover med inbyggd provider-filtrering! (Detta löser N+1)
    // "popularity.desc" ger alltid samma topptitlar på sida 1. En användare som
    // redan betygsatt/sparat de populäraste titlarna filtreras då bort helt
    // (baseRaw = 0 → "Slut på förslag"). Vi skannar därför flera TMDB-sidor per
    // API-sida tills vi har tillräckligt med OSEDDA kandidater.
    const CANDIDATE_TARGET = 60;
    const PAGES_PER_REQUEST = 8;
    const startTmdbPage = (pageNum - 1) * PAGES_PER_REQUEST + 1;

    const baseRaw: { id: number; tmdbType: MediaType; item: TMDBListItem }[] = [];
    const seenCandidate = new Set<string>();
    let maxTmdbPages = 1;

    for (let offset = 0; offset < PAGES_PER_REQUEST; offset++) {
      const tmdbPage = startTmdbPage + offset;
      if (tmdbPage > 500) break; // TMDB tillåter max 500 sidor.

      const [popMovie, popTv] = await Promise.all([
        wantMovie
          ? tmdbGet<TMDBPaged<TMDBListItem>>("/discover/movie", {
              language: locale,
              region,
              watch_region: region,
              with_watch_providers: tmdbProviderString,
              certification_country: "SE",
              "certification.lte": certMax,
              sort_by: "popularity.desc",
              page: tmdbPage,
            }, "force-cache")
          : Promise.resolve({ page: tmdbPage, results: [] as TMDBListItem[], total_pages: 1 }),
        // OBS: TMDB:s /discover/tv saknar certification-filter (endast movie),
        // så åldersgränsen (certMax) kan bara appliceras på filmer.
        wantTv
          ? tmdbGet<TMDBPaged<TMDBListItem>>("/discover/tv", {
              language: locale,
              region,
              watch_region: region,
              with_watch_providers: tmdbProviderString,
              sort_by: "popularity.desc",
              page: tmdbPage,
            }, "force-cache")
          : Promise.resolve({ page: tmdbPage, results: [] as TMDBListItem[], total_pages: 1 }),
      ]);

      maxTmdbPages = Math.max(maxTmdbPages, popMovie.total_pages ?? 1, popTv.total_pages ?? 1);

      for (const r of popMovie.results) {
        const key = `movie_${r.id}`;
        if (!watchKeys.has(key) && !seenCandidate.has(key)) {
          seenCandidate.add(key);
          baseRaw.push({ id: r.id, tmdbType: "movie", item: r });
        }
      }
      for (const r of popTv.results) {
        const key = `tv_${r.id}`;
        if (!watchKeys.has(key) && !seenCandidate.has(key)) {
          seenCandidate.add(key);
          baseRaw.push({ id: r.id, tmdbType: "tv", item: r });
        }
      }

      if (baseRaw.length >= CANDIDATE_TARGET) break;
      if (tmdbPage >= maxTmdbPages) break; // Inga fler TMDB-sidor att hämta.
    }

    const seeds = buildSeeds(tasteInput).filter(
      (s) => mediaFilter === "both" || s.type === mediaFilter,
    );

    // Dedupe + index
    const uniq = dedupe(baseRaw);

    // V1-score
    type Scored = { key: string; id: number; type: MediaType; scoreV1: number; base: TMDBListItem };
    const scoredV1: Scored[] = [];
    for (const u of uniq) {
      const gScore = genreScore(u.item.genre_ids, movieIdToName, tvIdToName, u.tmdbType, likedGenres, dislikedGenres);
      const qScore = qualityScore(u.item.vote_average, u.item.vote_count);
      const rBonus = recencyBonus(yearFrom(u.item));
      scoredV1.push({
        key: `${u.tmdbType}_${u.id}`,
        id: u.id,
        type: u.tmdbType,
        scoreV1: 1.6 * gScore + 0.6 * qScore + 0.2 * rBonus,
        base: u.item
      });
    }
    scoredV1.sort((a, b) => b.scoreV1 - a.scoreV1);

    // V2 taste
    const taste = await buildTasteMaps(seeds, locale);
    const N = Math.min(50, scoredV1.length);
    const topItems = scoredV1.slice(0, N);

    type CachedFeatures = Awaited<ReturnType<typeof fetchFeatures>>;
    const featureCache = new Map<string, CachedFeatures>();
    await Promise.all(
      topItems.map(async (t) => {
        const k = `${t.type}:${t.id}:${locale}`;
        if (!featureCache.has(k)) {
          const f = await fetchFeatures(t.type, t.id, locale).catch(() => ({
            keywords: [],
            directors: [],
            cast: [],
          }));
          featureCache.set(k, f);
        }
      }),
    );

    function scoreTaste(f: CachedFeatures): number {
      let s = 0;
      for (const kw of f.keywords) {
        const w = taste.keywordW.get(kw.id);
        if (w) s += 1.2 * w;
      }
      for (const p of [...f.directors, ...f.cast]) {
        const w = taste.peopleW.get(p.id);
        if (w) s += 1.4 * w;
      }
      return s;
    }

    // Slutscore V3 (Förenklad! Providers är redan garanterade via TMDB)
    type ScoredFinal = {
      id: number;
      type: MediaType;
      base: TMDBListItem;
      scoreFinal: number;
      kwSet: Set<number>;
      genSet: Set<number>;
      features: CachedFeatures;
    };

    const scoredFinal: ScoredFinal[] = [];
    for (const s of topItems) {
      const f = featureCache.get(`${s.type}:${s.id}:${locale}`) ?? {
        keywords: [],
        directors: [],
        cast: [],
      };
      const v = s.scoreV1 + scoreTaste(f);

      scoredFinal.push({
        id: s.id,
        type: s.type,
        base: s.base,
        scoreFinal: v,
        kwSet: new Set(f.keywords.map((kw) => kw.id)),
        genSet: new Set((s.base.genre_ids ?? []) as number[]),
        features: f,
      });
    }

    // Diversifiering (MMR)
    const lambda = 0.3;
    const K = Math.min(100, scoredFinal.length);
    const selected: ScoredFinal[] = [];
    const pool = [...scoredFinal].sort((a, b) => b.scoreFinal - a.scoreFinal);

    while (selected.length < K && pool.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        let sim = 0;
        for (const s of selected) {
          const a = cand.kwSet.size ? cand.kwSet : cand.genSet;
          const b = s.kwSet.size ? s.kwSet : s.genSet;
          sim = Math.max(sim, jaccard(a, b));
        }
        const mmr = cand.scoreFinal - lambda * sim;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIdx = i;
        }
      }
      selected.push(pool[bestIdx]);
      pool.splice(bestIdx, 1);
    }

    const genreMaps = { movieIdToName, tvIdToName };
    const items: UnifiedItem[] = selected.map((s) => {
      const genreHits = genreScoreNames(
        s.base.genre_ids,
        s.type,
        genreMaps,
        likedGenres,
        dislikedGenres,
      );
      const reasons = shouldShowSwipeReasons(s.id, s.type, SWIPE_REASONS_SHOW_RATE)
        ? buildMatchReasons({
            taste,
            features: s.features,
            genreHits,
            peopleNames: new Map(),
            keywordNames: new Map(),
          })
        : undefined;

      return {
        id: s.id,
        tmdbType: s.type,
        title: pickTitle(s.base),
        year: yearFrom(s.base),
        poster_path: s.base.poster_path ?? null,
        vote_average: s.base.vote_average,
        ...(reasons && reasons.length > 0 ? { reasons } : {}),
      };
    });

    return {
      ok: true,
      mode: isGroup ? "group" : "individual",
      group: isGroup ? { code: groupCode as string, strictProviders } : null,
      language: locale,
      region,
      usedProviderIds,
      mediaFilter,
      items,
    };
  } catch (err) {
    console.error("computeUnifiedRecs error:", err);
    return fail("Internt fel vid rekommendation.", 500);
  }
}
