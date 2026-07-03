import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, RECS_LIMIT } from "../../../../lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaType = "movie" | "tv";

/* ---------- TMDB shared types ---------- */
type TMDBPaged<T> = { page: number; results: T[] };
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

type TMDBKeywords = { id: number; keywords?: { id: number; name: string }[] };
type TMDBKeywordsTV = { id: number; results?: { id: number; name: string }[] };
type TMDBCredits = {
  id: number;
  cast?: { id: number; name: string; order?: number }[];
  crew?: { id: number; name: string; job?: string; department?: string }[];
};
type TMDBDetailsWithAppends = TMDBListItem & {
  keywords?: TMDBKeywords | TMDBKeywordsTV;
  credits?: TMDBCredits;
};
/* -------------------------------------- */

type FavoriteItem = { id: number; title: string; year?: string | number | null; poster?: string | null };

type UnifiedItem = {
  id: number;
  tmdbType: MediaType;
  title: string;
  year?: string;
  poster_path?: string | null;
  vote_average?: number;
};

type UnifiedOk = {
  ok: true;
  mode: "group" | "individual";
  group: { code: string; strictProviders: boolean } | null;
  language: string;
  region: string;
  usedProviderIds: number[];
  items: UnifiedItem[];
};
type UnifiedErr = { ok: false; message: string };

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

function fail(message: string, status = 200) {
  return NextResponse.json<UnifiedErr>({ ok: false, message }, { status });
}

/* ---------------- TMDB helpers ---------------- */

async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  cacheMode: RequestCache = "no-store",
): Promise<T> {
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN;
  const v3 = process.env.TMDB_API_KEY;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  if (!v4 && v3) usp.set("api_key", v3);

  const url = `https://api.themoviedb.org/3${path}${usp.toString() ? `?${usp.toString()}` : ""}`;
  const res = await fetch(url, { headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined, cache: cacheMode });
  if (!res.ok) throw new Error(`TMDB ${path} ${res.status}`);
  return (await res.json()) as T;
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

/* ---------- Åldersgräns (grupp) ---------- */
function ageFromDob(d: Date): number {
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

// SE-certifieringstak utifrån ålder. I grupp använder vi yngsta medlemmen
// så att inget kort bryter mot åldersgränsen för någon i sällskapet.
function seMaxCert(age: number): string {
  if (age >= 15) return "15";
  if (age >= 11) return "11";
  if (age >= 7) return "7";
  return "0";
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

/* ---------------- V2 taste model ---------------- */

type Taste = { keywordW: Map<number, number>; peopleW: Map<number, number> };

function increment(map: Map<number, number>, key: number, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function normalizeTopK(map: Map<number, number>, k: number) {
  const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, k);
  const max = entries[0]?.[1] ?? 1;
  const out = new Map<number, number>();
  for (const [id, w] of entries) out.set(id, w / max);
  return out;
}

function extractKeywordIds(d: TMDBDetailsWithAppends): number[] {
  const kw = d.keywords;
  if (!kw) return [];
  const arr =
    "keywords" in kw && Array.isArray(kw.keywords)
      ? kw.keywords
      : "results" in kw && Array.isArray(kw.results)
      ? kw.results
      : [];
  return arr.map((x) => x.id).filter((id) => Number.isFinite(id));
}

function extractPeopleIds(d: TMDBDetailsWithAppends, type: MediaType): number[] {
  const c = d.credits;
  if (!c) return [];
  const ids: number[] = [];
  const cast = (c.cast ?? []).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).slice(0, 5);
  for (const m of cast) if (typeof m.id === "number") ids.push(m.id);
  const crew = c.crew ?? [];
  if (type === "movie") {
    for (const m of crew) if (m.job === "Director" && typeof m.id === "number") ids.push(m.id);
  } else {
    for (const m of crew) if ((m.job === "Creator" || m.department === "Writing") && typeof m.id === "number") ids.push(m.id);
  }
  return ids;
}

async function fetchFeatures(type: MediaType, id: number, locale: string) {
  const path = type === "movie" ? `/movie/${id}` : `/tv/${id}`;
  const primary = await tmdbGet<TMDBDetailsWithAppends>(path, { language: locale, append_to_response: "keywords,credits" }, "force-cache").catch(() => null);
  if (primary) {
    const kw = extractKeywordIds(primary), ppl = extractPeopleIds(primary, type);
    if (kw.length || ppl.length) return { keywords: kw, people: ppl };
  }
  const fallback = await tmdbGet<TMDBDetailsWithAppends>(path, { language: "en-US", append_to_response: "keywords,credits" }, "force-cache");
  return { keywords: extractKeywordIds(fallback), people: extractPeopleIds(fallback, type) };
}

async function buildTaste(seeds: { id: number; type: MediaType }[], locale: string): Promise<Taste> {
  const keywordW = new Map<number, number>(), peopleW = new Map<number, number>();
  const feats = await Promise.all(seeds.map((s) => fetchFeatures(s.type, s.id, locale).catch(() => ({ keywords: [], people: [] }))));
  for (const f of feats) {
    for (const kw of f.keywords) increment(keywordW, kw, 1);
    for (const p of f.people) increment(peopleW, p, 1);
  }
  return { keywordW: normalizeTopK(keywordW, 60), peopleW: normalizeTopK(peopleW, 60) };
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

/* ---------------- Route ---------------- */

export async function GET(req: Request) {
  try {
    const c = await cookies();
    const uid = c.get("nw_uid")?.value;
    const region = c.get("nw_region")?.value || "SE";
    const locale = c.get("nw_locale")?.value || "sv-SE";
    const reqUrl = new URL(req.url);
    // Gruppkod kan komma explicit via query (t.ex. gruppdäcket) eller från cookie.
    const groupCode = reqUrl.searchParams.get("group") || c.get("nw_group")?.value || null;

    if (!uid) return fail("Ingen användare inloggad.", 401);

    const key = getRateLimitKey(req, uid);
    if (!rateLimitAllow(key, "recs", { limit: RECS_LIMIT })) {
      return fail("För många förfrågningar. Försök igen senare.", 429);
    }

    // 1. Hämta data från databasen direkt via Prisma
    const [profile, ratings, watchlist, groupMembers] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: uid } }),
      prisma.rating.findMany({ where: { userId: uid }, select: { tmdbId: true, mediaType: true } }),
      prisma.watchlist.findMany({ where: { userId: uid }, select: { tmdbId: true, mediaType: true } }),
      groupCode 
        ? prisma.groupMember.findMany({ where: { groupCode }, include: { user: { include: { profile: true } } } })
        : Promise.resolve([])
    ]);

    if (!profile) return fail("Ingen profil hittades.");

    // Gruppläge kräver minst en laddad medlem (utöver kod).
    const isGroup = !!groupCode && groupMembers.length > 0;
    // Alla medlemsprofiler (för providers, genrer, ålder och seeds).
    const memberProfiles = isGroup
      ? groupMembers
          .map((m) => m.user.profile)
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
      : [];

    // Grupp: hämta ALLA medlemmars watchlists så smakmodellen får seeds från hela sällskapet.
    const groupWatchlist = isGroup
      ? await prisma.watchlist.findMany({
          where: { userId: { in: groupMembers.map((m) => m.userId) } },
          select: { tmdbId: true, mediaType: true },
        })
      : [];

    // 2. Extrahera och slå ihop providers (för solo eller grupp)
    const providerStrings = new Set<string>();
    if (isGroup) {
      // Om grupp: Samla ALLA tjänster som någon i gruppen har (OR-logik via TMDB)
      for (const p of memberProfiles) {
        const pProviders = p.providers as string[] | undefined;
        if (Array.isArray(pProviders)) pProviders.forEach((s) => providerStrings.add(s));
      }
    } else {
      const pProviders = profile.providers as string[] | undefined;
      if (Array.isArray(pProviders)) pProviders.forEach((s) => providerStrings.add(s));
    }

    const usedProviderIds = getProviderIds(Array.from(providerStrings));
    const tmdbProviderString = usedProviderIds.length > 0 ? usedProviderIds.join('|') : undefined;

    // Åldersgräns i grupp: utgå från yngsta medlemmen (SE-certifiering).
    let certMax: string | undefined;
    if (isGroup && memberProfiles.length > 0) {
      const ages = memberProfiles.map((p) => ageFromDob(new Date(p.dob)));
      certMax = seMaxCert(Math.min(...ages));
    }

    // Bygg WatchKeys (för att filtrera bort sedda)
    const watchKeys = new Set<string>();
    for (const r of ratings) watchKeys.add(`${r.mediaType}_${r.tmdbId}`);
    for (const w of watchlist) watchKeys.add(`${w.mediaType}_${w.tmdbId}`);

    // Genres
    const [movieGenres, tvGenres] = await Promise.all([
      tmdbGet<TMDBGenreList>("/genre/movie/list", { language: locale }, "force-cache"),
      tmdbGet<TMDBGenreList>("/genre/tv/list", { language: locale }, "force-cache"),
    ]);
    const movieIdToName = new Map(movieGenres.genres.map((g) => [g.id, g.name] as const));
    const tvIdToName = new Map(tvGenres.genres.map((g) => [g.id, g.name] as const));
    // Genrer: i grupp unionerar vi allas gillade genrer. Ogillade genrer räknas bara
    // om INGEN i gruppen gillar dem (annars skulle en persons favorit straffas bort).
    let likedGenres: Set<string>;
    let dislikedGenres: Set<string>;
    if (isGroup) {
      likedGenres = new Set<string>();
      dislikedGenres = new Set<string>();
      for (const p of memberProfiles) {
        for (const g of p.favoriteGenres ?? []) likedGenres.add(g);
        for (const g of p.dislikedGenres ?? []) dislikedGenres.add(g);
      }
      for (const g of likedGenres) dislikedGenres.delete(g);
    } else {
      likedGenres = new Set(profile.favoriteGenres ?? []);
      dislikedGenres = new Set(profile.dislikedGenres ?? []);
    }

    const page = new URL(req.url).searchParams.get("page");
    const pageNum = Math.max(1, Number(page || "1"));

    // 3. TMDB Discover med inbyggd provider-filtrering! (Detta löser N+1)
    const [popMovie, popTv] = await Promise.all([
      tmdbGet<TMDBPaged<TMDBListItem>>("/discover/movie", {
        language: locale,
        region,
        watch_region: region,
        with_watch_providers: tmdbProviderString,
        certification_country: certMax ? "SE" : undefined,
        "certification.lte": certMax,
        sort_by: "popularity.desc",
        page: pageNum
      }, "force-cache"),
      tmdbGet<TMDBPaged<TMDBListItem>>("/discover/tv", {
        language: locale,
        region,
        watch_region: region,
        with_watch_providers: tmdbProviderString,
        sort_by: "popularity.desc",
        page: pageNum
      }, "force-cache"),
    ]);

    const baseRaw: { id: number; tmdbType: MediaType; item: TMDBListItem }[] = [];
    for (const r of popMovie.results) {
      if (!watchKeys.has(`movie_${r.id}`)) baseRaw.push({ id: r.id, tmdbType: "movie", item: r });
    }
    for (const r of popTv.results) {
      if (!watchKeys.has(`tv_${r.id}`)) baseRaw.push({ id: r.id, tmdbType: "tv", item: r });
    }

    // Seeds (favoriter + watchlist – för taste). I grupp tar vi favoriter från ALLA
    // medlemmar först (starkast signal), sedan hela gruppens watchlists.
    const seedsSet: { id: number; type: MediaType }[] = [];
    if (isGroup) {
      for (const p of memberProfiles) {
        const fm = p.favoriteMovie as FavoriteItem | null;
        const fs = p.favoriteShow as FavoriteItem | null;
        if (fm?.id) seedsSet.push({ id: fm.id, type: "movie" });
        if (fs?.id) seedsSet.push({ id: fs.id, type: "tv" });
      }
      for (const w of groupWatchlist) {
        seedsSet.push({ id: w.tmdbId, type: w.mediaType as MediaType });
      }
    } else {
      const favMovie = profile.favoriteMovie as FavoriteItem | null;
      const favShow = profile.favoriteShow as FavoriteItem | null;
      if (favMovie?.id) seedsSet.push({ id: favMovie.id, type: "movie" });
      if (favShow?.id) seedsSet.push({ id: favShow.id, type: "tv" });
      for (const w of watchlist) {
        seedsSet.push({ id: w.tmdbId, type: w.mediaType as MediaType });
      }
    }

    // Fler seeds i grupp så hela sällskapet representeras i smakmodellen.
    const seedCap = isGroup ? 12 : 6;
    const seenSeed = new Set<string>();
    const seeds: { id: number; type: MediaType }[] = [];
    for (const s of seedsSet) {
      const k = `${s.type}_${s.id}`;
      if (seenSeed.has(k)) continue;
      seenSeed.add(k);
      seeds.push(s);
      if (seeds.length >= seedCap) break;
    }

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
    const taste = await buildTaste(seeds, locale);
    const N = Math.min(30, scoredV1.length);
    const topItems = scoredV1.slice(0, N);

    const featureCache = new Map<string, { keywords: number[]; people: number[] }>();
    await Promise.all(
      topItems.map(async (t) => {
        const k = `${t.type}:${t.id}:${locale}`;
        if (!featureCache.has(k)) {
          const f = await fetchFeatures(t.type, t.id, locale).catch(() => ({ keywords: [], people: [] }));
          featureCache.set(k, f);
        }
      })
    );
    
    function scoreTaste(f: { keywords: number[]; people: number[] }): number {
      let s = 0;
      for (const kw of f.keywords) {
        const w = taste.keywordW.get(kw);
        if (w) s += 1.2 * w;
      }
      for (const p of f.people) {
        const w = taste.peopleW.get(p);
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
    };
    
    const scoredFinal: ScoredFinal[] = [];
    for (const s of topItems) {
      const f = featureCache.get(`${s.type}:${s.id}:${locale}`) ?? { keywords: [], people: [] };
      const v = s.scoreV1 + scoreTaste(f); // Ingen provider-penalitet behövs

      scoredFinal.push({
        id: s.id,
        type: s.type,
        base: s.base,
        scoreFinal: v,
        kwSet: new Set((f.keywords ?? []) as number[]),
        genSet: new Set((s.base.genre_ids ?? []) as number[]),
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

    const items: UnifiedItem[] = selected.map((s) => ({
      id: s.id,
      tmdbType: s.type,
      title: pickTitle(s.base),
      year: yearFrom(s.base),
      poster_path: s.base.poster_path ?? null,
      vote_average: s.base.vote_average,
    }));

    const payload: UnifiedOk = {
      ok: true,
      mode: isGroup ? "group" : "individual",
      group: isGroup ? { code: groupCode as string, strictProviders: false } : null,
      language: locale,
      region,
      usedProviderIds,
      items,
    };
    
    return NextResponse.json(payload);
  } catch (err) {
    console.error("unified recs error:", err);
    return fail("Internt fel vid rekommendation.", 500);
  }
}