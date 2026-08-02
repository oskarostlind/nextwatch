// lib/unifiedRecs.ts
//
// Delad rekommendationsmotor bakom app/api/recs/unified/route.ts.
// Extraherad så att både den cookie-baserade routen och det schemalagda
// dagliga rekommendations-jobbet (app/api/cron/daily-recs) kan återanvända
// exakt samma scoring/MMR-pipeline utan att duplicera logik.

import { prisma } from "@/lib/prisma";
import { parseProvidersJson } from "@/lib/groupSettings";
import {
  SWIPE_REASONS_SHOW_RATE,
  TOPMATCH_MIN_EVIDENCE,
  TOPMATCH_MIN_TASTE_SCORE,
} from "@/lib/tasteFeature";
import {
  ANIMATION_GENRE_ID,
  buildMatchEvidence,
  buildSeeds,
  buildTasteMaps,
  fetchFeatures,
  genreScoreNames,
  hasAnimeMarker,
  resolveGenreSets,
  resolveMaxCert,
  resolveProviderStrings,
  shouldShowSwipeReasons,
  tmdbGet,
  type MatchEvidence,
  type MediaType,
} from "@/lib/tasteModel";
import { normalizeSwipeMediaFilter, type SwipeMediaFilter } from "@/lib/swipeMediaFilter";

export type { MatchEvidence, MediaType, SwipeMediaFilter };

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
  /** Följer med gratis i discover-svaret; används för anime-klassningen. */
  original_language?: string;
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
  /**
   * Satt bara när titeln passerar smaktröskeln i solo — då firar swipen liken
   * med matchrutan. evidence är alltid icke-tom och härledd (person/tema), så
   * det finns något konkret att motivera med.
   */
  topMatch?: { evidence: MatchEvidence[] };
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
  /**
   * TMDB-sidan nästa hämtning ska börja på. Sedan skanningsdjupet blev rörligt
   * (storswipare kan behöva gräva 40 sidor innan något osett dyker upp) går det
   * inte längre att räkna ut startsidan av ett API-sidnummer — klienten skulle
   * antingen hoppa över sidor eller visa dubbletter. Klienten skickar tillbaka
   * värdet som `?from=`.
   */
  nextTmdbPage: number;
};

export type UnifiedRecsErr = { ok: false; message: string; status: number };

export type UnifiedRecsResult = UnifiedRecsOk | UnifiedRecsErr;

export type UnifiedRecsParams = {
  uid: string;
  region: string;
  locale: string;
  groupCode: string | null;
  page?: number;
  /**
   * TMDB-sida att börja skanna på, från förra svarets `nextTmdbPage`. Vinner
   * över `page` när den finns. `page` behålls för grupp-däcket och cron-jobbet,
   * som alltid börjar om från början.
   */
  fromTmdbPage?: number;
  /**
   * Solo-däcket: hämta ALLTID både film och serier oavsett profilens
   * swipeMediaFilter, så klienten kan filtrera lokalt utan att kasta leken och
   * köra om pipelinen vid varje film/serie-byte. Det rapporterade `mediaFilter`
   * är fortfarande profilens värde (klientens default-vy). Cron och grupp sätter
   * INTE detta — de ska respektera sitt filter.
   */
  forceAllMedia?: boolean;
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

/* -------- Watchlist-kandidater i gruppläge -------- */

/** Hur många sparade titlar vi som mest slår upp mot TMDB per anrop. */
const WATCHLIST_CANDIDATE_FETCH_MAX = 40;
/** Hur många som som mest får plats i den färdiga leken. */
const WATCHLIST_CANDIDATE_INJECT_MAX = 12;

/** SE-certifikat i stigande ordning; "Btl" = barntillåten. */
const SE_CERT_RANK: Record<string, number> = { Btl: 0, "0": 0, "7": 7, "11": 11, "15": 15 };

type TmdbDetailsLite = TMDBListItem & {
  genres?: { id: number }[];
  "watch/providers"?: {
    results?: Record<string, { flatrate?: { provider_id: number }[] }>;
  };
  release_dates?: {
    results?: { iso_3166_1: string; release_dates?: { certification?: string }[] }[];
  };
};

function seCertificationOf(d: TmdbDetailsLite): string | null {
  const se = d.release_dates?.results?.find((r) => r.iso_3166_1 === "SE");
  for (const rd of se?.release_dates ?? []) {
    const c = rd.certification?.trim();
    if (c) return c;
  }
  return null;
}

/**
 * Slår upp titlar som EN gruppmedlem sparat och filtrerar dem mot gruppens
 * kriterier, så de kan vävas in i gruppleken.
 *
 * Ett anrop per titel med append_to_response ger metadata, tillgänglighet och
 * åldersgräns på samma gång i stället för tre. Anropen går genom
 * concurrency-grinden i lib/tmdbClient och Next Data Cache (force-cache).
 *
 * Genrer hårdfiltreras INTE — ogillade genrer straffas redan av V1-scoringen,
 * precis som för discover-kandidater.
 */
async function fetchGroupWatchlistCandidates(opts: {
  saved: { tmdbId: number; mediaType: MediaType }[];
  locale: string;
  region: string;
  usedProviderIds: number[];
  certMax: string;
  wantMovie: boolean;
  wantTv: boolean;
}): Promise<{ id: number; tmdbType: MediaType; item: TMDBListItem }[]> {
  const { saved, locale, region, usedProviderIds, certMax, wantMovie, wantTv } = opts;

  const wanted = saved
    .filter((s) => (s.mediaType === "movie" ? wantMovie : wantTv))
    .slice(0, WATCHLIST_CANDIDATE_FETCH_MAX);
  if (wanted.length === 0) return [];

  const providerSet = new Set(usedProviderIds);
  const certCap = SE_CERT_RANK[certMax] ?? 15;

  const results = await Promise.all(
    wanted.map(async (s) => {
      const path = s.mediaType === "movie" ? `/movie/${s.tmdbId}` : `/tv/${s.tmdbId}`;
      const d = await tmdbGet<TmdbDetailsLite>(
        path,
        {
          language: locale,
          append_to_response: s.mediaType === "movie" ? "watch/providers,release_dates" : "watch/providers",
        },
        "force-cache",
      ).catch(() => null);
      if (!d) return null;

      // Tillgänglighet: måste finnas på någon av gruppens tjänster i regionen.
      // Samma krav som /discover ställer via with_watch_providers.
      if (providerSet.size > 0) {
        const flat = d["watch/providers"]?.results?.[region]?.flatrate ?? [];
        if (!flat.some((p) => providerSet.has(p.provider_id))) return null;
      }

      // Åldersgräns. /discover/tv saknar certification-filter, så serier kan
      // ändå bara filtreras på film — samma begränsning som i huvudflödet.
      //
      // Saknad SE-klassning: discover skulle ha uteslutit titeln (certification.lte
      // kräver en klassning). Att göra likadant här hade tömt funktionen, eftersom
      // de flesta titlar saknar SE-klassning. Kompromissen är att bara vara
      // tillåtande när taket ändå är vuxenläget — har gruppen en yngre medlem
      // krävs en känd klassning inom taket.
      if (s.mediaType === "movie") {
        const cert = seCertificationOf(d);
        if (cert === null) {
          if (certCap < 15) return null;
        } else {
          const rank = SE_CERT_RANK[cert];
          if (rank === undefined || rank > certCap) return null;
        }
      }

      // Detaljsvaret har `genres`, listsvaret `genre_ids` — normalisera så
      // scoringen nedströms kan behandla dem likadant.
      const item: TMDBListItem = {
        ...d,
        genre_ids: d.genre_ids ?? (d.genres ?? []).map((g) => g.id),
      };
      return { id: s.tmdbId, tmdbType: s.mediaType, item };
    }),
  );

  return results.filter((r): r is { id: number; tmdbType: MediaType; item: TMDBListItem } => r !== null);
}

/* ---------------- Core pipeline ---------------- */

export async function computeUnifiedRecs(params: UnifiedRecsParams): Promise<UnifiedRecsResult> {
  const { uid, region, locale, groupCode, page = 1, fromTmdbPage, forceAllMedia = false } = params;

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
              favoriteKeywordIds: true,
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
    // Solo läser filtret från profilen (satt under /profile), grupp från Group.mediaFilter.
    const mediaFilter: SwipeMediaFilter = isGroup
      ? normalizeSwipeMediaFilter(groupRow?.mediaFilter)
      : normalizeSwipeMediaFilter(profile.swipeMediaFilter);
    // forceAllMedia (solo-däcket): hämta båda oavsett filter så klienten kan
    // filtrera lokalt. `mediaFilter` ovan rapporteras ändå som profilens värde,
    // så klientens default-vy stämmer. Grupp/cron sätter inte flaggan.
    const effectiveFilter: SwipeMediaFilter = forceAllMedia && !isGroup ? "both" : mediaFilter;
    const wantMovie = effectiveFilter === "both" || effectiveFilter === "movie";
    const wantTv = effectiveFilter === "both" || effectiveFilter === "tv";
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

    // Barn-/familjeinnehåll (TV-Kids-genren) döljs som standard. Solo: användarens
    // egen profilinställning. Grupp: bara PÅ om ALLA medlemmar har det på — annars
    // ska ingen barnkanal slippa in i ett vuxet sällskap.
    const showKidsContent = isGroup
      ? memberProfiles.length > 0 && memberProfiles.every((p) => p.showKidsContent === true)
      : profile.showKidsContent === true;

    // Smak-konfidens: ju mer signaler (betyg, sparade, deklarerade favoriter),
    // desto mer väger smakmodellen och desto mindre väger ren popularitet. Nya
    // användare får populära titlar (ingen tom lek); veteraner får skarp
    // personalisering. Mättar mjukt mot ~1.0 (TAU=12 → ~0.87 vid 25 signaler).
    const declaredFavCount = isGroup
      ? memberProfiles.reduce(
          (n, p) =>
            n + (p.favoriteGenres?.length ?? 0) + (p.favoriteMovie ? 1 : 0) + (p.favoriteShow ? 1 : 0),
          0,
        )
      : (profile.favoriteGenres?.length ?? 0) +
        (profile.favoriteMovie ? 1 : 0) +
        (profile.favoriteShow ? 1 : 0);
    const tasteSignals = exclusionRatings.length + exclusionWatchlist.length + declaredFavCount;
    const TASTE_TAU = 12;
    const tasteConfidence = 1 - Math.exp(-tasteSignals / TASTE_TAU);
    // Popularitet tonas ned för veteraner (kvalitetsvikt 0.60 → 0.15), smaken
    // skruvas upp (1.0 → 2.5). Ett golv (0.75-kapet) gör att kvalitet aldrig helt
    // försvinner, så veteraner slipper obskyra lågkvaltitlar. Trimmas i mät-passet.
    const qualityWeight = 0.6 * (1 - 0.75 * tasteConfidence);
    const tasteWeight = 1 + 1.5 * tasteConfidence;

    const watchKeys = new Set<string>();
    for (const r of exclusionRatings) {
      const key = `${r.mediaType}_${r.tmdbId}`;
      // Explicit betyg (1–10) = titeln är sedd OCH bedömd → aldrig tillbaka i
      // swipen. Recycle-fönstret är till för rena förbi-svepningar (nope/like
      // utan betyg) som får en ny chans efter ett tag — inte för något man satt
      // en siffra på. Utan det här dök betygsatta filmer upp igen efter 14 dagar.
      if (r.rating != null) {
        watchKeys.add(key);
        continue;
      }
      const recycle = recycleByUser.get(r.userId) ?? 14;
      if (isExcludedByRecycle(r.decidedAt, recycle)) {
        watchKeys.add(key);
      }
    }
    // Watchlist-exkludering.
    //
    // Solo: alltid exkludera medan titeln ligger kvar (avsiktlig sparning).
    //
    // Grupp: den gamla regeln exkluderade UNIONEN av allas watchlists. Med två
    // medlemmar på ~300 sparade titlar var försvann upp till 600 titlar ur
    // gruppleken — och den titel EN medlem redan sagt "den vill jag se" om är
    // rimligen den bästa kandidaten som finns, inte den sämsta. Regeln skalade
    // dessutom åt fel håll: ju mer engagerade medlemmarna var, desto mer av det
    // bästa innehållet blev osynligt.
    //
    // Nu skiljs fallen åt:
    //   ≥2 sparare → fortsatt exkluderad. Ni är redan överens, och titeln ägs av
    //                "Gemensamt i era watchlists" (app/api/group/common-watchlist,
    //                som kräver gte: 2 — samma gräns, med flit).
    //   exakt 1    → med i leken, för ALLA medlemmar. Även spararen: räknas
    //                sparningen inte som en röst (den gör den inte) måste
    //                spararen kunna rösta, annars kan titeln aldrig nå
    //                groupMatchNeed och skulle bli en återvändsgränd.
    const watchlistSaverCount = new Map<string, number>();
    if (isGroup) {
      for (const w of exclusionWatchlist) {
        const key = `${w.mediaType}_${w.tmdbId}`;
        watchlistSaverCount.set(key, (watchlistSaverCount.get(key) ?? 0) + 1);
      }
    }
    /** Titlar exakt en medlem sparat — kandidater att väva in nedan. */
    const soloSaved: { tmdbId: number; mediaType: MediaType; addedAt: Date }[] = [];
    for (const w of exclusionWatchlist) {
      const key = `${w.mediaType}_${w.tmdbId}`;
      if (isGroup && watchlistSaverCount.get(key) === 1) {
        soloSaved.push({
          tmdbId: w.tmdbId,
          mediaType: w.mediaType as MediaType,
          addedAt: w.addedAt,
        });
        continue;
      }
      watchKeys.add(key);
    }
    // Nyast sparat först — färskast avsikt, och taket nedan ska träffa rätt.
    soloSaved.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());

    // Genres
    const [movieGenres, tvGenres] = await Promise.all([
      tmdbGet<TMDBGenreList>("/genre/movie/list", { language: locale }, "force-cache"),
      tmdbGet<TMDBGenreList>("/genre/tv/list", { language: locale }, "force-cache"),
    ]);
    const movieIdToName = new Map(movieGenres.genres.map((g) => [g.id, g.name] as const));
    const tvIdToName = new Map(tvGenres.genres.map((g) => [g.id, g.name] as const));
    const { liked: likedGenres, disliked: dislikedGenres } = resolveGenreSets(tasteInput);

    // Hård genrefiltrering för GRUPPER: bara när gruppen själv (via kugghjulet)
    // satt explicita gillade genrer på Group.favoriteGenres — inte den
    // medlemsaggregerade fallbacken i resolveGenreSets. Detta är gruppens
    // uttryckliga val och ska begränsa TMDB-kandidatpoolen på riktigt (samma
    // sätt som Discover-fliken redan gör), i stället för att bara knuffa
    // rankingen som V1-scoringen (genreScore) gör. Solo/personlig lek berörs
    // inte — där är genren fortfarande bara en mjuk signal.
    const groupExplicitLikedGenreNames = isGroup ? groupRow?.favoriteGenres ?? [] : [];
    const movieNameToId = new Map(movieGenres.genres.map((g) => [g.name, g.id] as const));
    const tvNameToId = new Map(tvGenres.genres.map((g) => [g.name, g.id] as const));
    // Flera valda genrer = ELLER-semantik (TMDB tolkar "|" som OR, "," som AND) —
    // en titel ska räcka att matcha EN av de valda genrerna, inte alla.
    const hardFilterMovieGenres = groupExplicitLikedGenreNames
      .map((n) => movieNameToId.get(n))
      .filter((id): id is number => id != null);
    const hardFilterTvGenres = groupExplicitLikedGenreNames
      .map((n) => tvNameToId.get(n))
      .filter((id): id is number => id != null);
    const withGenresMovie = hardFilterMovieGenres.length > 0 ? hardFilterMovieGenres.join("|") : undefined;
    const withGenresTv = hardFilterTvGenres.length > 0 ? hardFilterTvGenres.join("|") : undefined;

    // Sub-genrer (lib/subgenres.ts): samma HÅRDA-filter-princip som genrerna
    // ovan, fast som TMDB keywords. Bara satt när gruppen (kugghjulet) själv
    // valt sub-genrer på Group.favoriteKeywordIds — automatik-läget (ingen
    // grupp-inställning) har inga keyword-id:n att filtrera på.
    const groupExplicitKeywordIds = isGroup ? groupRow?.favoriteKeywordIds ?? [] : [];
    const withKeywords =
      groupExplicitKeywordIds.length > 0 ? groupExplicitKeywordIds.join("|") : undefined;

    // Startas här och inväntas efter discover-loopen, så uppslagen löper
    // parallellt med sidhämtningen i stället för att lägga sig ovanpå den.
    const watchlistCandidatesPromise =
      isGroup && soloSaved.length > 0
        ? fetchGroupWatchlistCandidates({
            saved: soloSaved,
            locale,
            region,
            usedProviderIds,
            certMax,
            wantMovie,
            wantTv,
          })
        : Promise.resolve([]);

    const pageNum = Math.max(1, page);

    // 3. TMDB Discover med inbyggd provider-filtrering! (Detta löser N+1)
    // "popularity.desc" ger alltid samma topptitlar på sida 1. En användare som
    // redan betygsatt/sparat de populäraste titlarna filtreras då bort helt
    // (baseRaw = 0 → "Slut på förslag"). Vi skannar därför flera TMDB-sidor per
    // API-sida tills vi har tillräckligt med OSEDDA kandidater.
    const CANDIDATE_TARGET = 60;
    /** Normalsteg: hur långt fram nästa API-sida börjar. */
    const PAGES_PER_REQUEST = 8;
    /**
     * Hur djupt vi FÅR gräva när allt filtreras bort. Taket på 8 sidor var en
     * hård gräns: har användaren betygsatt eller sparat de ~160 populäraste
     * titlar som matchar hens tjänster och åldersgräns blev baseRaw tom, och
     * eftersom klienten sätter `hasMore = items.length > 0` (lib/swipeDeckStore)
     * frågade den aldrig efter sida 2. Resultatet blev ett permanent
     * "Slut på förslag nu" trots tiotusentals kvarvarande titlar — värst för
     * den som testat appen mycket, alltså precis tvärtom mot vad man vill.
     *
     * Vi bryter fortfarande så fort CANDIDATE_TARGET är nått, så vanliga
     * anrop kostar lika mycket som förut (2–3 sidor). Djupet används bara när
     * filtreringen faktiskt tömmer sidorna.
     */
    const MAX_PAGES_PER_REQUEST = 40;
    const startTmdbPage =
      fromTmdbPage && fromTmdbPage > 0
        ? Math.min(fromTmdbPage, 500)
        : (pageNum - 1) * PAGES_PER_REQUEST + 1;

    const baseRaw: { id: number; tmdbType: MediaType; item: TMDBListItem }[] = [];
    const seenCandidate = new Set<string>();
    let maxTmdbPages = 1;

    // Sidorna hämtas i klumpar i stället för en i taget: djupet ovan behövs bara
    // för storswipare, men om de 40 sidorna kördes sekventiellt skulle just de
    // användarna få 40 round trips i följd. Med klumpar blir det som mest 10.
    // Concurrency-taket i lib/tmdbClient håller trycket nere.
    const PAGE_CHUNK = 4;

    async function fetchDiscoverPage(tmdbPage: number) {
      // En trasig sida får inte fälla hela leken. Tidigare bubblade ett kastat
      // discover-anrop (t.ex. TMDB 429) till yttre catch → 500 → "Slut på
      // förslag nu", trots att tidigare sidor redan gett fullt användbara
      // kandidater. Värst för mediaFilter "both", som gör dubbelt så många
      // anrop per varv. Ger ALLA sidor noll träffar landar vi i det befintliga
      // tomma läget nedan, vilket är rätt signal.
      const emptyPage = { page: tmdbPage, results: [] as TMDBListItem[], total_pages: 1 };
      return Promise.all([
        wantMovie
          ? tmdbGet<TMDBPaged<TMDBListItem>>("/discover/movie", {
              language: locale,
              region,
              watch_region: region,
              with_watch_providers: tmdbProviderString,
              // Familjefilmer (Vaiana, Kung Fu Panda m.fl.) exkluderas när
              // barn-/familjefiltret är av. TMDB saknar en ren "Kids"-genre för
              // FILM (10762 är TV-only), så Family (10751) är närmaste signal.
              // Träffar även Pixar/Ghibli-familjefilmer — de kommer tillbaka när
              // toggeln slås på.
              without_genres: showKidsContent ? undefined : "10751",
              with_genres: withGenresMovie,
              with_keywords: withKeywords,
              certification_country: "SE",
              "certification.lte": certMax,
              sort_by: "popularity.desc",
              page: tmdbPage,
            }, "force-cache").catch((err) => {
              console.error(`discover/movie sida ${tmdbPage} misslyckades:`, err);
              return emptyPage;
            })
          : Promise.resolve(emptyPage),
        // OBS: TMDB:s /discover/tv saknar certification-filter (endast movie),
        // så åldersgränsen (certMax) kan bara appliceras på filmer.
        wantTv
          ? tmdbGet<TMDBPaged<TMDBListItem>>("/discover/tv", {
              language: locale,
              region,
              watch_region: region,
              with_watch_providers: tmdbProviderString,
              // Barn-tv (My Little Pony m.fl.) exkluderas om barnfiltret är av.
              without_genres: showKidsContent ? undefined : "10762",
              with_genres: withGenresTv,
              with_keywords: withKeywords,
              sort_by: "popularity.desc",
              page: tmdbPage,
            }, "force-cache").catch((err) => {
              console.error(`discover/tv sida ${tmdbPage} misslyckades:`, err);
              return emptyPage;
            })
          : Promise.resolve(emptyPage),
      ]);
    }

    let scannedTo = startTmdbPage - 1;
    outer: for (let offset = 0; offset < MAX_PAGES_PER_REQUEST; offset += PAGE_CHUNK) {
      const pages: number[] = [];
      for (let i = 0; i < PAGE_CHUNK && offset + i < MAX_PAGES_PER_REQUEST; i++) {
        const p = startTmdbPage + offset + i;
        if (p > 500) break; // TMDB tillåter max 500 sidor.
        if (p > maxTmdbPages && offset > 0) break; // Inga fler TMDB-sidor att hämta.
        pages.push(p);
      }
      if (pages.length === 0) break;

      const chunk = await Promise.all(pages.map(fetchDiscoverPage));

      for (let i = 0; i < chunk.length; i++) {
        const [popMovie, popTv] = chunk[i];
        scannedTo = pages[i];
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

        if (baseRaw.length >= CANDIDATE_TARGET) break outer;
      }

      if (scannedTo >= maxTmdbPages) break; // Inga fler TMDB-sidor att hämta.
    }

    // Väv in de titlar exakt en medlem sparat. De läggs till baseRaw och går
    // därmed genom samma V1/V2-scoring och MMR som discover-kandidaterna —
    // ingen gräddfil, de ska förtjäna sin plats. Taket hindrar att en medlem
    // med 300 sparade titlar tar över hela leken; utan det försvinner
    // upptäckten, som är resten av produkten.
    const watchlistCandidates = await watchlistCandidatesPromise;
    let injected = 0;
    for (const c of watchlistCandidates) {
      if (injected >= WATCHLIST_CANDIDATE_INJECT_MAX) break;
      const key = `${c.tmdbType}_${c.id}`;
      if (seenCandidate.has(key)) continue; // discover hann före
      seenCandidate.add(key);
      baseRaw.push(c);
      injected += 1;
    }

    const seeds = buildSeeds(tasteInput).filter(
      (s) => effectiveFilter === "both" || s.type === effectiveFilter,
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
        scoreV1: 1.6 * gScore + qualityWeight * qScore + 0.2 * rBonus,
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
            genres: [],
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
      /** Enbart smakdelen — grinden för "Toppmatch", se lib/tasteFeature.ts. */
      scoreTasteOnly: number;
      kwSet: Set<number>;
      genSet: Set<number>;
      features: CachedFeatures;
    };

    // Animationsstil: genren "Animation" är EN bucket hos TMDB men två världar i
    // praktiken (Ghibli ≠ Disney). animeAffinity är härledd ur seeds; på animerade
    // kandidater skjuter den anime upp/ner efter smak och västerländskt åt andra
    // hållet (dämpat — att älska anime betyder inte att man hatar Pixar).
    // Vikten 1.5 är i klass med V1:s genreterm (1.6 × ±1), så stilen kan faktiskt
    // vända ordningen mellan två animerade titlar — men inte begrava kvalitet.
    const ANIME_STYLE_WEIGHT = 1.5;
    const WESTERN_COUNTERWEIGHT = -0.6;
    // Vikt för härledda genrer (från betyg). Något under V1:s deklarerade
    // genreterm (1.6) — ett aktivt profilval väger tyngre än en härledd signal —
    // men tydligt nog att "du sätter alltid 9 på thrillers" märks utan att du
    // kryssat i genren.
    const DERIVED_GENRE_WEIGHT = 1.2;
    function styleAdjustment(base: TMDBListItem, f: CachedFeatures): number {
      if (taste.animeAffinity === 0) return 0;
      const animated =
        (base.genre_ids ?? []).includes(ANIMATION_GENRE_ID) ||
        f.genres.some((g) => g.id === ANIMATION_GENRE_ID);
      if (!animated) return 0;
      const isAnime = hasAnimeMarker(f.keywords) || base.original_language === "ja";
      return ANIME_STYLE_WEIGHT * taste.animeAffinity * (isAnime ? 1 : WESTERN_COUNTERWEIGHT);
    }

    const scoredFinal: ScoredFinal[] = [];
    for (const s of topItems) {
      const f = featureCache.get(`${s.type}:${s.id}:${locale}`) ?? {
        keywords: [],
        directors: [],
        cast: [],
        genres: [],
      };
      const tasteOnly = scoreTaste(f);

      scoredFinal.push({
        id: s.id,
        type: s.type,
        base: s.base,
        scoreFinal:
          s.scoreV1 +
          tasteWeight * tasteOnly +
          styleAdjustment(s.base, f) +
          // Genrer HÄRLEDDA ur betyg (utöver profilens deklarerade). Rent additivt:
          // taste.genreW är tom utan seeds → 0, så nya användare påverkas inte.
          // Skalas med smak-konfidensen så det växer i takt med att data samlas.
          DERIVED_GENRE_WEIGHT *
            tasteConfidence *
            ((s.base.genre_ids ?? []).reduce((sum, gid) => sum + (taste.genreW.get(gid) ?? 0), 0)),
        scoreTasteOnly: tasteOnly,
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
      const evidence = buildMatchEvidence({ taste, features: s.features, genreHits });

      const reasons = shouldShowSwipeReasons(s.id, s.type, SWIPE_REASONS_SHOW_RATE)
        ? evidence.map((e) => e.label)
        : undefined;

      // Toppmatch bara i solo: i grupp betyder "match" att flera gillat samma titel,
      // och två sorters match i samma flöde vore förvirrande.
      // Genreträffar räknas inte som bevis — de är valda i profilen, inte härledda.
      const derivedEvidence = evidence.filter((e) => e.kind !== "genre");
      const isTopMatch =
        !isGroup &&
        s.scoreTasteOnly >= TOPMATCH_MIN_TASTE_SCORE &&
        derivedEvidence.length >= TOPMATCH_MIN_EVIDENCE;

      return {
        id: s.id,
        tmdbType: s.type,
        title: pickTitle(s.base),
        year: yearFrom(s.base),
        poster_path: s.base.poster_path ?? null,
        vote_average: s.base.vote_average,
        ...(reasons && reasons.length > 0 ? { reasons } : {}),
        ...(isTopMatch ? { topMatch: { evidence: derivedEvidence.slice(0, 3) } } : {}),
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
      nextTmdbPage: Math.min(scannedTo + 1, 501),
    };
  } catch (err) {
    console.error("computeUnifiedRecs error:", err);
    return fail("Internt fel vid rekommendation.", 500);
  }
}
