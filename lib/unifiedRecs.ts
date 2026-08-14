// lib/unifiedRecs.ts
//
// Delad rekommendationsmotor bakom app/api/recs/unified/route.ts.
// Extraherad så att både den cookie-baserade routen och det schemalagda
// dagliga rekommendations-jobbet (app/api/cron/daily-recs) kan återanvända
// exakt samma scoring/MMR-pipeline utan att duplicera logik.

import { prisma, withDbRetry } from "@/lib/prisma";
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
import {
  behaviorBlend,
  behavioralGenreScore,
  loadGenreStats,
  loadGenreStatsForUsers,
  type GenreStats,
} from "@/lib/genreStats";

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
  /**
   * Satt när hårda genre-/nyckelordsfilter gjorde katalogen för smal och
   * servern släppte dem för att fylla leken (se POOL_THIN_TARGET nedan).
   * Klienten kan visa det som "vidgade sökningen" åt användaren.
   */
  broadened: { keywords: boolean; genres: boolean };
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

/**
 * Bayesianskt utjämnat kvalitetsmått. Rå vote_average premierade titlar med
 * små men hängivna röstarkårer (nischade serier på 8.5+ med några hundra
 * röster gick före brett hyllade titlar) — snittet dras därför mot en global
 * prior tills röstunderlaget bär. (Benchmark 2026-08-14, fynd 4.)
 */
const QUALITY_PRIOR_MEAN = 6.5;
const QUALITY_PRIOR_WEIGHT = 250;

function qualityScore(voteAvg?: number, voteCount?: number): number {
  if (!voteAvg || !voteCount) return 0;
  const smoothed =
    (voteAvg * voteCount + QUALITY_PRIOR_MEAN * QUALITY_PRIOR_WEIGHT) /
    (voteCount + QUALITY_PRIOR_WEIGHT);
  return smoothed * Math.log10(voteCount + 1);
}

/**
 * Kvalitetsgolv: titlar publiken sågat ska inte in i leken alls, oavsett
 * genrematchning — Velma (3.5) tog sig till leken via Animerat+Komedi+Mysterium.
 * Golvet kräver ett rimligt röstunderlag så små/nya titlar inte drabbas.
 */
const QUALITY_FLOOR_AVG = 5.8;
const QUALITY_FLOOR_MIN_VOTES = 50;

function belowQualityFloor(item: TMDBListItem): boolean {
  const votes = item.vote_count ?? 0;
  const avg = item.vote_average ?? 0;
  return votes >= QUALITY_FLOOR_MIN_VOTES && avg > 0 && avg < QUALITY_FLOOR_AVG;
}

/**
 * Barn-heuristik på kandidatnivå (benchmark 2026-08-14, fynd 5): discover-
 * filtret `without_genres` missar barnserier som inte är taggade med TMDB:s
 * Kids-genre (10762) — Scooby-Doo m.fl. är bara Animation+Family. När
 * showKidsContent är av stoppas därför även Animation∧Family-kombon och allt
 * Family-taggat på film (samma linje som discover-filtret för film).
 */
const TV_KIDS_GENRE_ID = 10762;
const FAMILY_GENRE_ID = 10751;

function isKidsLikely(genreIds: number[] | undefined, type: MediaType): boolean {
  if (!genreIds?.length) return false;
  if (type === "tv" && genreIds.includes(TV_KIDS_GENRE_ID)) return true;
  if (genreIds.includes(FAMILY_GENRE_ID)) {
    if (type === "movie") return true;
    if (genreIds.includes(ANIMATION_GENRE_ID)) return true;
  }
  return false;
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

/* ---------------- Recycle-straff ----------------
 *
 * Benchmark 2026-08-14, fynd 1 — HUVUDORSAKEN till "beiga" lekar: dislikes
 * utanför recycle-fönstret släpptes tillbaka HELT opåverkade och la sig
 * överst (55 av 100 kort var redan bortsvepta titlar). Återvinning är en
 * medveten funktion (recycleAfterDays är en användarinställning), men ett
 * gammalt nej är fortfarande en signal. Därför:
 *
 *   1. Scorestraff som klingar av långsamt: −RECYCLE_PENALTY_BASE vid
 *      fönstrets slut, halverat efter RECYCLE_PENALTY_HALF_LIFE_DAYS. En
 *      titel man nobbade för två år sedan är nästan "ny" igen; en som
 *      nobbades för en månad sedan är det inte.
 *   2. Andelstak i leken (RECYCLED_SHARE_MAX i MMR-urvalet): även om
 *      återvunna titlar scorar bra får de aldrig dominera — merparten av
 *      leken ska alltid vara genuint osett.
 */
const RECYCLE_PENALTY_BASE = 2.5;
const RECYCLE_PENALTY_HALF_LIFE_DAYS = 365;
const RECYCLED_SHARE_MAX = 0.2;

function recyclePenalty(ageDays: number): number {
  return RECYCLE_PENALTY_BASE * Math.pow(0.5, ageDays / RECYCLE_PENALTY_HALF_LIFE_DAYS);
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
    // Genre-listorna beror bara på locale — starta dem redan här, parallellt
    // med DB-läsningen, i stället för efter discover-skanningen. .catch-vakten
    // hindrar en obehandlad rejection om något tidigare steg kastar innan
    // promisen inväntas; felet kastas ändå vid await längre ner.
    const genreListsPromise = Promise.all([
      tmdbGet<TMDBGenreList>("/genre/movie/list", { language: locale }, "force-cache"),
      tmdbGet<TMDBGenreList>("/genre/tv/list", { language: locale }, "force-cache"),
    ]);
    genreListsPromise.catch(() => {});

    // 1. Hämta data från databasen direkt via Prisma.
    // withDbRetry: Neon skalar till noll — utan retry blir en kallstart (P1001)
    // "Internt fel vid rekommendation." i stället för en sekunds extra väntan.
    const [profile, ratings, watchlist, groupMembers, groupRow] = await withDbRetry(() =>
      Promise.all([
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
      ]),
    );

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

    // Seeds behöver bara DB-datan ovan — bygg dem direkt och starta
    // smakmodellens TMDB-uppslag NU, så de löper parallellt med
    // discover-skanningen nedan i stället för att lägga sig ovanpå den
    // (samma mönster som watchlistCandidatesPromise). Sparar ungefär en hel
    // TMDB-våg (~0,5–1,5 s kallt) per lek-hämtning.
    const seeds = buildSeeds(tasteInput).filter(
      (s) => effectiveFilter === "both" || s.type === effectiveFilter,
    );
    const tastePromise = buildTasteMaps(seeds, locale);
    tastePromise.catch(() => {}); // vakt mot obehandlad rejection före await

    // Beteendebaserade genrevikter (lib/genreStats.ts) — startas här så
    // läsningen löper parallellt med discover-skanningen. Grupp: summan av
    // alla medlemmars statistik.
    const genreStatsPromise: Promise<GenreStats> = isGroup
      ? loadGenreStatsForUsers(groupMemberIds)
      : loadGenreStats(uid);
    genreStatsPromise.catch(() => {});

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
    /**
     * Titlar som passerat recycle-fönstret och därmed är TILLÅTNA igen — men
     * med straff (se recyclePenalty ovan). Nyckel → svepets ålder i dagar.
     * Bara negativa/neutrala beslut (dislike/seen) hamnar här; likes utanför
     * fönstret är ofarliga att visa igen och ska inte straffas.
     */
    const recycledAgeDays = new Map<string, number>();
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
      } else if (r.decision === "dislike" || r.decision === "seen") {
        const ageDays = (Date.now() - r.decidedAt.getTime()) / (24 * 60 * 60 * 1000);
        // Flera medlemmar kan ha nobbat samma titel (grupp) — behåll det
        // FÄRSKASTE nejet, det ger störst straff.
        const prev = recycledAgeDays.get(key);
        if (prev === undefined || ageDays < prev) recycledAgeDays.set(key, ageDays);
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

    // Genres — startade parallellt med DB-läsningen ovan.
    const [movieGenres, tvGenres] = await genreListsPromise;
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
    // ovan, fast som TMDB keywords — och till skillnad från genrerna gäller
    // det HÄR även solo: sub-genre-valet i Profil (Profile.favoriteKeywordIds)
    // är precis lika explicit ett användarval som gruppens kugghjul, så det
    // ska begränsa TMDB-kandidatpoolen på riktigt i båda lägena. Tomt (inget
    // valt, varken solo eller grupp) = ingen keyword-filtrering alls.
    const explicitKeywordIds = isGroup
      ? groupRow?.favoriteKeywordIds ?? []
      : profile.favoriteKeywordIds ?? [];
    const withKeywords =
      explicitKeywordIds.length > 0 ? explicitKeywordIds.join("|") : undefined;

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

    // Sidorna hämtas i klumpar i stället för en i taget: djupet ovan behövs bara
    // för storswipare, men om de 40 sidorna kördes sekventiellt skulle just de
    // användarna få 40 round trips i följd. Med klumpar blir det som mest 10.
    // Concurrency-taket i lib/tmdbClient håller trycket nere.
    const PAGE_CHUNK = 4;

    type DiscoverFilters = {
      withGenresMovie?: string;
      withGenresTv?: string;
      withKeywords?: string;
    };

    async function fetchDiscoverPage(tmdbPage: number, filters: DiscoverFilters) {
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
              with_genres: filters.withGenresMovie,
              with_keywords: filters.withKeywords,
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
              // Barn-tv exkluderas om barnfiltret är av. 10762 (Kids) räcker
              // inte ensamt — många barnserier (Scooby-Doo, Dexters
              // laboratorium m.fl.) är bara taggade Animation+Family, så
              // Family (10751) filtreras också. Vuxenserier är i praktiken
              // aldrig Family-taggade hos TMDB, och isKidsLikely() nedan
              // fångar det som ändå slinker förbi via andra kandidatvägar.
              without_genres: showKidsContent ? undefined : "10762,10751",
              with_genres: filters.withGenresTv,
              with_keywords: filters.withKeywords,
              sort_by: "popularity.desc",
              page: tmdbPage,
            }, "force-cache").catch((err) => {
              console.error(`discover/tv sida ${tmdbPage} misslyckades:`, err);
              return emptyPage;
            })
          : Promise.resolve(emptyPage),
      ]);
    }

    /**
     * Skannar TMDB-sidor med givna filter tills `target` kandidater samlats i
     * `baseRaw`, eller `maxPages`/katalogens slut nås. Delad av strikt-passet
     * (gruppens/profilens egna genre-/nyckelordsval) och vidgnings-passen nedan
     * — de skiljer sig bara på filter och startsida, så samma paginering
     * återanvänds i stället för att dupliceras per pass. `localMaxPages` är
     * skopad till just detta anrop eftersom olika filter ger olika
     * TMDB-`total_pages` — ett vidgat pass (färre filter) har en helt annan
     * katalogstorlek än det strikta.
     */
    async function scanDiscoverPages(opts: {
      filters: DiscoverFilters;
      startPage: number;
      maxPages: number;
      target: number;
    }): Promise<number> {
      const { filters, startPage, maxPages, target } = opts;
      let scannedTo = startPage - 1;
      let localMaxPages = 1;
      outer: for (let offset = 0; offset < maxPages; offset += PAGE_CHUNK) {
        const pages: number[] = [];
        for (let i = 0; i < PAGE_CHUNK && offset + i < maxPages; i++) {
          const p = startPage + offset + i;
          if (p > 500) break; // TMDB tillåter max 500 sidor.
          if (p > localMaxPages && offset > 0) break; // Inga fler TMDB-sidor att hämta.
          pages.push(p);
        }
        if (pages.length === 0) break;

        const chunk = await Promise.all(pages.map((p) => fetchDiscoverPage(p, filters)));

        for (let i = 0; i < chunk.length; i++) {
          const [popMovie, popTv] = chunk[i];
          scannedTo = pages[i];
          localMaxPages = Math.max(localMaxPages, popMovie.total_pages ?? 1, popTv.total_pages ?? 1);

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

          if (baseRaw.length >= target) break outer;
        }

        if (scannedTo >= localMaxPages) break; // Inga fler TMDB-sidor att hämta.
      }
      return scannedTo;
    }

    const scannedTo = await scanDiscoverPages({
      filters: { withGenresMovie, withGenresTv, withKeywords },
      startPage: startTmdbPage,
      maxPages: MAX_PAGES_PER_REQUEST,
      target: CANDIDATE_TARGET,
    });

    /**
     * Vidgning: gruppens hårda genre-/nyckelordsfilter (kugghjulet respektive
     * sub-genre-valet) kan göra TMDB-katalogen så smal att strikt-passet ovan
     * tar slut på sidor långt under CANDIDATE_TARGET — värst i grupp, där båda
     * filtren kan gälla SAMTIDIGT och exkluderingsmängden (allas röster) redan
     * är större än solo. Utan det här tömdes leken och enda vägen tillbaka var
     * att lämna swipen och trycka "Starta gruppswipe" (full omstart från
     * TMDB-sida 1, se lib/swipeDeckStore.ts ensureGroupDeck). Släpp filtren
     * stegvis — nyckelord först, sedan genre — och skanna om från sida 1 (ett
     * annat filter = en annan TMDB-fråga, sidnumren från strikt-passet betyder
     * inget här). `broadened` skickas till klienten så den kan berätta för
     * användaren att sökningen vidgades.
     *
     * Solo-swipen har också ett hårt sub-genre-filter (withKeywords), men den
     * ska INTE vidgas automatiskt här — dess val i Profil är lika explicit som
     * gruppens och ska förbli hårt (samma princip som kommentaren ovan filtren
     * beskriver). Bara gruppleken tömdes utan återhämtning, så bara den får
     * automatisk vidgning; `isGroup`-vakten nedan håller solo oförändrad.
     */
    const POOL_THIN_TARGET = 20;
    const RELAX_MAX_PAGES = 20;
    const broadened = { keywords: false, genres: false };

    if (isGroup && withKeywords && baseRaw.length < POOL_THIN_TARGET) {
      await scanDiscoverPages({
        filters: { withGenresMovie, withGenresTv, withKeywords: undefined },
        startPage: 1,
        maxPages: RELAX_MAX_PAGES,
        target: CANDIDATE_TARGET,
      });
      broadened.keywords = true;
    }
    if (isGroup && (withGenresMovie || withGenresTv) && baseRaw.length < POOL_THIN_TARGET) {
      await scanDiscoverPages({
        filters: { withGenresMovie: undefined, withGenresTv: undefined, withKeywords: undefined },
        startPage: 1,
        maxPages: RELAX_MAX_PAGES,
        target: CANDIDATE_TARGET,
      });
      broadened.genres = true;
    }

    /* -------- Smakriktad retrieval (pass B/C) --------
     *
     * Popularitetsskanningen ovan räcker för nya användare, men en storswipare
     * som redan betat av populär-toppen på sina tjänster får en pool som
     * nästan bara består av återvunna dislikes — simuleringen i benchmarken
     * gav 17 osedda av 121 kandidater efter 40 sidor. Recycle-straffet och
     * andelstaket kan inte trolla fram osett innehåll som retrieval aldrig
     * hämtat. När poolen är svulten på osett kör vi därför riktade
     * discover-pass som gräver där användarens smak bor i stället för i
     * popularitetstoppen:
     *
     *   Pass B: användarens bästa BETEENDE-genrer (genre_stats, samma data
     *           som viktningen), sorterade på betyg i stället för popularitet.
     *   Pass C: användarens starkaste smak-keywords (taste-modellen),
     *           sorterade på röstantal.
     *
     * Båda passen behåller provider-/cert-/barnfiltren så kandidaterna är
     * lika giltiga som huvudskanningens. Allt går sedan genom exakt samma
     * scoring/straff/MMR — passen ändrar bara VAD som hittas, inte vad som
     * väljs.
     */
    const TASTE_RETRIEVAL_UNSEEN_MIN = 40;
    const TASTE_RETRIEVAL_PAGES = 2;
    const unseenAfterScan = baseRaw.reduce(
      (n, c) => n + (recycledAgeDays.has(`${c.tmdbType}_${c.id}`) ? 0 : 1),
      0,
    );
    if (unseenAfterScan < TASTE_RETRIEVAL_UNSEEN_MIN) {
      const [genreStatsEarly, tasteEarly] = await Promise.all([
        genreStatsPromise.catch(() => ({}) as GenreStats),
        tastePromise.catch(() => null),
      ]);

      // Pass B: topp-3 beteendegenrer. Rankas på utjämnad kvot × log(underlag)
      // så en genre med +14 netto på 280 svep (stark, bred signal) inte slås
      // av en med +5 netto på 25 svep — ren kvotsortering gynnade småprover.
      const topBehaviorGenres = Object.entries(genreStatsEarly)
        .map(([gid, s]) => {
          const total = s.p + s.n;
          return { gid: Number(gid), total, score: ((s.p - s.n) / (total + 4)) * Math.log10(total + 1) };
        })
        .filter((g) => g.total >= 20 && g.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((g) => g.gid);

      // Pass C: topp-8 positiva smak-keywords. Respektera ett explicit
      // sub-genre-val (withKeywords) — då styr det, inte de härledda.
      const topTasteKeywords = withKeywords
        ? []
        : Array.from(tasteEarly?.keywordW.entries() ?? [])
            .filter(([, w]) => w > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([id]) => id);

      const directedQueries: { path: string; params: Record<string, string | number | undefined> }[] = [];
      const commonMovie = {
        language: locale,
        region,
        watch_region: region,
        with_watch_providers: tmdbProviderString,
        without_genres: showKidsContent ? undefined : "10751",
        certification_country: "SE",
        "certification.lte": certMax,
        "vote_count.gte": 300,
        with_keywords: withKeywords,
      };
      const commonTv = {
        language: locale,
        region,
        watch_region: region,
        with_watch_providers: tmdbProviderString,
        without_genres: showKidsContent ? undefined : "10762,10751",
        "vote_count.gte": 150,
        with_keywords: withKeywords,
      };
      for (let p = 1; p <= TASTE_RETRIEVAL_PAGES; p++) {
        for (const gid of topBehaviorGenres) {
          if (wantMovie)
            directedQueries.push({ path: "/discover/movie", params: { ...commonMovie, with_genres: String(gid), sort_by: "vote_average.desc", page: p } });
          if (wantTv)
            directedQueries.push({ path: "/discover/tv", params: { ...commonTv, with_genres: String(gid), sort_by: "vote_average.desc", page: p } });
        }
        if (topTasteKeywords.length > 0) {
          const kw = topTasteKeywords.join("|");
          if (wantMovie)
            directedQueries.push({ path: "/discover/movie", params: { ...commonMovie, with_keywords: kw, sort_by: "vote_count.desc", page: p } });
          if (wantTv)
            directedQueries.push({ path: "/discover/tv", params: { ...commonTv, with_keywords: kw, sort_by: "vote_count.desc", page: p } });
        }
      }

      const directedResults = await Promise.all(
        directedQueries.map((q) =>
          tmdbGet<TMDBPaged<TMDBListItem>>(q.path, q.params, "force-cache").catch(() => ({
            page: 1,
            results: [] as TMDBListItem[],
          })),
        ),
      );
      for (let i = 0; i < directedResults.length; i++) {
        const type: MediaType = directedQueries[i].path === "/discover/movie" ? "movie" : "tv";
        for (const r of directedResults[i].results) {
          const key = `${type}_${r.id}`;
          if (watchKeys.has(key) || seenCandidate.has(key)) continue;
          seenCandidate.add(key);
          baseRaw.push({ id: r.id, tmdbType: type, item: r });
        }
      }
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

    // Dedupe + index
    const uniq = dedupe(baseRaw);

    // Beteendebaserade genrevikter — startade parallellt med discover ovan.
    // Blandningen: ju mer swipe-data, desto mer väger vad användaren GÖR och
    // desto mindre vad hen kryssade i under onboardingen. Benchmarken
    // 2026-08-14 (fynd 3) visade deklarerade genrer med 76–88 % negativ
    // swipe-andel — de får aldrig mer ensamma styra. Deklarationen behåller
    // dock alltid en andel (golv 55 %): den är ett aktivt val och skyddar
    // mot feedback-loopar där statistiken bara ser det den själv valt ut.
    const genreStats = await genreStatsPromise.catch(() => ({}) as GenreStats);
    const statsBlend = behaviorBlend(genreStats);
    const DECLARED_GENRE_WEIGHT = 1.6 * (1 - 0.45 * statsBlend);
    const BEHAVIOR_GENRE_WEIGHT = 2.0 * statsBlend;

    // V1-score
    type Scored = {
      key: string;
      id: number;
      type: MediaType;
      scoreV1: number;
      base: TMDBListItem;
      /** Titeln var bortsvept och har passerat recycle-fönstret (straffad + andelstak i MMR). */
      recycled: boolean;
    };
    const scoredV1: Scored[] = [];
    for (const u of uniq) {
      // Kvalitetsgolv: publikt sågade titlar (Velma-fallet) åker ut direkt.
      if (belowQualityFloor(u.item)) continue;
      // Barn-heuristik: fångar det discover-filtret missar (otaggade
      // barnserier, watchlist-injicerade kandidater i grupp).
      if (!showKidsContent && isKidsLikely(u.item.genre_ids, u.tmdbType)) continue;

      const key = `${u.tmdbType}_${u.id}`;
      const gScore = genreScore(u.item.genre_ids, movieIdToName, tvIdToName, u.tmdbType, likedGenres, dislikedGenres);
      const bScore = behavioralGenreScore(u.item.genre_ids, genreStats);
      const qScore = qualityScore(u.item.vote_average, u.item.vote_count);
      const rBonus = recencyBonus(yearFrom(u.item));
      const recycledAge = recycledAgeDays.get(key);
      const rPenalty = recycledAge !== undefined ? recyclePenalty(recycledAge) : 0;
      scoredV1.push({
        key,
        id: u.id,
        type: u.tmdbType,
        scoreV1:
          DECLARED_GENRE_WEIGHT * gScore +
          BEHAVIOR_GENRE_WEIGHT * bScore +
          qualityWeight * qScore +
          0.2 * rBonus -
          rPenalty,
        base: u.item,
        recycled: recycledAge !== undefined,
      });
    }
    scoredV1.sort((a, b) => b.scoreV1 - a.scoreV1);

    // V2 taste — uppslagen startades direkt efter DB-läsningen (tastePromise)
    // och har fått löpa parallellt med discover-skanningen ovan.
    const taste = await tastePromise;
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

    /* -------- Franchise-straff (benchmark 2026-08-14, fynd 1/åtgärd 5) --------
     *
     * Har användaren nobbat eller betygsatt ≤6 en del av en filmserie ska inte
     * fler delar ur samma serie rekommenderas — leken hade 5× Apornas planet
     * och 3× Fantastiska vidunder till en användare som svept bort franchiserna.
     * Collection-medlemskapet slås upp per kandidat-collection (force-cache, en
     * gång per franchise totalt) och jämförs mot användarens negativa filmer.
     * Gäller bara film — TMDB har inga collections för TV.
     */
    const FRANCHISE_PENALTY = 1.8;
    const negativeMovieIds = new Set<number>();
    for (const r of exclusionRatings) {
      if (r.mediaType !== "movie") continue;
      if (r.decision === "dislike" || (r.rating != null && r.rating <= 6)) {
        negativeMovieIds.add(r.tmdbId);
      }
    }

    type TMDBCollection = { parts?: { id: number }[] };
    const collectionIds = new Set<number>();
    for (const t of topItems) {
      if (t.type !== "movie") continue;
      const f = featureCache.get(`${t.type}:${t.id}:${locale}`);
      if (f?.collectionId) collectionIds.add(f.collectionId);
    }
    /** Collections där minst en del är nobbad/lågt betygsatt. */
    const taintedCollections = new Set<number>();
    if (negativeMovieIds.size > 0 && collectionIds.size > 0) {
      await Promise.all(
        Array.from(collectionIds).map(async (cid) => {
          const col = await tmdbGet<TMDBCollection>(`/collection/${cid}`, {}, "force-cache").catch(
            () => null,
          );
          if (col?.parts?.some((p) => negativeMovieIds.has(p.id))) {
            taintedCollections.add(cid);
          }
        }),
      );
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
      /** Se Scored.recycled — styr andelstaket i MMR-urvalet nedan. */
      recycled: boolean;
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
      const franchisePenalty =
        s.type === "movie" && f.collectionId && taintedCollections.has(f.collectionId)
          ? FRANCHISE_PENALTY
          : 0;

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
            ((s.base.genre_ids ?? []).reduce((sum, gid) => sum + (taste.genreW.get(gid) ?? 0), 0)) -
          franchisePenalty,
        scoreTasteOnly: tasteOnly,
        kwSet: new Set(f.keywords.map((kw) => kw.id)),
        genSet: new Set((s.base.genre_ids ?? []) as number[]),
        features: f,
        recycled: s.recycled,
      });
    }

    // Diversifiering (MMR) + andelstak för återvunna titlar: högst
    // RECYCLED_SHARE_MAX av leken får vara tidigare bortsvept, oavsett score.
    // När taket är nått hoppar urvalet över återvunna kandidater — finns inget
    // osett kvar i poolen tillåts de ändå (hellre en full lek än en tom).
    const lambda = 0.3;
    const K = Math.min(100, scoredFinal.length);
    const recycledMax = Math.ceil(K * RECYCLED_SHARE_MAX);
    let recycledSelected = 0;
    const selected: ScoredFinal[] = [];
    const pool = [...scoredFinal].sort((a, b) => b.scoreFinal - a.scoreFinal);

    while (selected.length < K && pool.length > 0) {
      const recycledCapped =
        recycledSelected >= recycledMax && pool.some((c) => !c.recycled);
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        if (recycledCapped && cand.recycled) continue;
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
      if (bestIdx === -1) break; // bara överkvoterade återvunna kvar
      if (pool[bestIdx].recycled) recycledSelected++;
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
      broadened,
    };
  } catch (err) {
    console.error("computeUnifiedRecs error:", err);
    return fail("Internt fel vid rekommendation.", 500);
  }
}
