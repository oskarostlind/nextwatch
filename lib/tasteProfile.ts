// lib/tasteProfile.ts — beräknar användarens synliga smakprofil.

import {
  buildSeeds,
  buildTasteLabels,
  loadTasteInput,
  resolveGenreSets,
  resolveMaxCert,
  resolveProviderStrings,
  type FavoriteItem,
  type Seed,
  type WeightedLabel,
} from "@/lib/tasteModel";

export type TasteProfileSeed = {
  id: number;
  type: "movie" | "tv";
  title: string | null;
  weight: number;
};

export type TasteProfileOk = {
  ok: true;
  mode: "group" | "individual";
  group: { code: string } | null;
  explicit: {
    likedGenres: string[];
    dislikedGenres: string[];
    favoriteMovie: FavoriteItem | null;
    favoriteShow: FavoriteItem | null;
    providers: string[];
    maxCert: string;
  };
  inferred: {
    directors: WeightedLabel[];
    cast: WeightedLabel[];
    keywords: WeightedLabel[];
    /** Genrer härledda ur faktiska likes, inte ur profilens kryssrutor. */
    genres: WeightedLabel[];
    topSeeds: TasteProfileSeed[];
  };
  stats: {
    ratingCount: number;
    watchlistCount: number;
    seedCount: number;
    hasEnoughData: boolean;
    /** Beteende: vad användaren faktiskt gjort, till skillnad från vad hen valt. */
    behavior: BehaviorStats;
  };
};

export type BehaviorStats = {
  /** Antal avgjorda kort (gilla + ogilla + sett). Exkluderar rena betygsrader. */
  totalSwipes: number;
  likes: number;
  dislikes: number;
  seen: number;
  /** Andel likes av avgjorda kort, 0–1. null när inget swipats än. */
  likeRatio: number | null;
  /** Antal titlar med satt 1–10-betyg. */
  ratedCount: number;
  /** Snittbetyg 1–10, null när inget betygsatts. */
  avgRating: number | null;
};

export type TasteProfileErr = { ok: false; message: string; status: number };
export type TasteProfileResult = TasteProfileOk | TasteProfileErr;

export type TasteProfileParams = {
  uid: string;
  groupCode?: string | null;
};

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

/**
 * Beteendestatistik ur Rating-raderna. decision är "like" | "dislike" | "seen"
 * för swipade kort; "RATED"/"RATE_DISMISSED" kommer från betygsflödet och räknas
 * inte som swipes.
 */
function computeBehaviorStats(rows: { rating: number | null; decision: string }[]): BehaviorStats {
  let likes = 0;
  let dislikes = 0;
  let seen = 0;
  let ratingSum = 0;
  let ratedCount = 0;

  for (const r of rows) {
    if (r.decision === "like") likes++;
    else if (r.decision === "dislike") dislikes++;
    else if (r.decision === "seen") seen++;

    if (typeof r.rating === "number") {
      ratingSum += r.rating;
      ratedCount++;
    }
  }

  const totalSwipes = likes + dislikes + seen;

  return {
    totalSwipes,
    likes,
    dislikes,
    seen,
    likeRatio: totalSwipes > 0 ? likes / totalSwipes : null,
    ratedCount,
    avgRating: ratedCount > 0 ? ratingSum / ratedCount : null,
  };
}

async function resolveSeedTitles(seeds: Seed[], locale: string): Promise<TasteProfileSeed[]> {
  const { tmdbGet } = await import("@/lib/tasteModel");
  const out: TasteProfileSeed[] = [];

  await Promise.all(
    seeds.map(async (s) => {
      if (s.title) {
        out.push({ id: s.id, type: s.type, title: s.title, weight: s.weight });
        return;
      }
      try {
        const path = s.type === "movie" ? `/movie/${s.id}` : `/tv/${s.id}`;
        const data = await tmdbGet<{ title?: string; name?: string }>(
          path,
          { language: locale },
          "force-cache",
        );
        out.push({
          id: s.id,
          type: s.type,
          title: (data.title || data.name || null)?.trim() ?? null,
          weight: s.weight,
        });
      } catch {
        out.push({ id: s.id, type: s.type, title: null, weight: s.weight });
      }
    }),
  );

  return out.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

export async function computeTasteProfile(params: TasteProfileParams): Promise<TasteProfileResult> {
  const { uid, groupCode = null } = params;

  try {
    const input = await loadTasteInput(uid, groupCode);
    if (!input) return { ok: false, message: "Ingen profil hittades.", status: 200 };

    const seeds = buildSeeds(input);
    const { liked, disliked } = resolveGenreSets(input);
    const providers = resolveProviderStrings(input);
    const maxCert = resolveMaxCert(input);
    const locale = input.locale;

    const favMovie = input.isGroup
      ? null
      : asFavoriteItem(input.profile.favoriteMovie);
    const favShow = input.isGroup
      ? null
      : asFavoriteItem(input.profile.favoriteShow);

    const ratingCount = input.isGroup ? input.groupRatings.length : input.ratings.length;
    const watchlistCount = input.isGroup ? input.groupWatchlist.length : input.watchlist.length;
    const hasEnoughData =
      seeds.length > 0 ||
      liked.size > 0 ||
      disliked.size > 0 ||
      !!favMovie ||
      !!favShow;

    const [labels, topSeeds] = await Promise.all([
      seeds.length > 0 ? buildTasteLabels(seeds, locale) : Promise.resolve({
        keywords: [],
        directors: [],
        cast: [],
        genres: [],
      }),
      resolveSeedTitles(seeds.slice(0, 8), locale),
    ]);

    // Beteendet är alltid användarens eget — även i gruppläge, där resten av
    // panelen visar gruppens samlade smak.
    const behavior = computeBehaviorStats(input.ratings);

    return {
      ok: true,
      mode: input.isGroup ? "group" : "individual",
      group: input.isGroup && input.groupCode ? { code: input.groupCode } : null,
      explicit: {
        likedGenres: Array.from(liked),
        dislikedGenres: Array.from(disliked),
        favoriteMovie: favMovie,
        favoriteShow: favShow,
        providers,
        maxCert,
      },
      inferred: {
        directors: labels.directors,
        cast: labels.cast,
        keywords: labels.keywords,
        genres: labels.genres,
        topSeeds,
      },
      stats: {
        ratingCount,
        watchlistCount,
        seedCount: seeds.length,
        hasEnoughData,
        behavior,
      },
    };
  } catch (err) {
    console.error("computeTasteProfile error:", err);
    return { ok: false, message: "Internt fel vid smakprofil.", status: 500 };
  }
}
