// lib/genreStats.ts — beteendebaserade genrevikter för rekommendationerna.
//
// BAKGRUND (benchmark 2026-08-14, docs/recs-benchmark-2026-08-14.md):
// Profilens deklarerade favorite_genres kan motsäga det faktiska beteendet
// grovt — en användare hade kryssat i Äventyr/Animerat/Familj men svepte bort
// 76–88 % av titlarna i just de genrerna. Den här modulen räknar därför
// löpande statistik per TMDB-genre ur verkliga swipes/betyg och låter
// lib/unifiedRecs.ts vikta om genretermen efter vad användaren GÖR, inte vad
// hen SA under onboardingen.
//
// Lagring: Profile.genre_stats (jsonb, nullable) som
//   { "<tmdb-genre-id>": { "p": antal positiva, "n": antal negativa } }
//
// ⚠️ RÅ SQL MED FLIT: kolumnen lades till efter senaste `prisma generate`, och
// klienten i node_modules får inte omgenereras från den här miljön (Linux-
// sandbox skulle byta ut Windows-query-engine och knäcka lokal dev). All
// åtkomst går därför via $queryRaw/$executeRaw tills klienten är omgenererad —
// då KAN läsningen flyttas till typad Prisma, men rå SQL fortsätter fungera
// och behöver inte migreras.
//
// Uppdateringen är read-modify-write utan lås. Två parallella swipes kan i
// värsta fall tappa en enstaka räkning — statistiken är en approximation för
// viktning, inte bokföring, så det är ett medvetet val i stället för
// transaktioner/jsonb-increments på varje svep.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { tmdbGet } from "@/lib/tasteModel";

export type GenreStat = { p: number; n: number };
export type GenreStats = Record<string, GenreStat>;

/** Under så här många observationer per genre ger genren ingen signal alls. */
const MIN_SAMPLE_PER_GENRE = 5;
/** Laplace-utjämning: drar små stickprov mot 0 så enstaka swipes inte styr. */
const SMOOTHING = 4;
/**
 * Vid så här många totala observationer litar pipelinen fullt på beteendet
 * (blend = 1). Under det fasas beteendevikten in linjärt och de deklarerade
 * genrerna behåller motsvarande andel — nya användare påverkas alltså inte.
 */
export const GENRE_STATS_FULL_TRUST_SAMPLE = 150;

export function normalizeGenreStats(json: unknown): GenreStats {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: GenreStats = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
    const p = Number((v as Record<string, unknown>).p);
    const n = Number((v as Record<string, unknown>).n);
    if (Number.isFinite(p) && Number.isFinite(n) && p >= 0 && n >= 0) {
      out[k] = { p: Math.floor(p), n: Math.floor(n) };
    }
  }
  return out;
}

/** Summerar flera användares statistik (gruppläge). */
export function mergeGenreStats(list: GenreStats[]): GenreStats {
  const out: GenreStats = {};
  for (const stats of list) {
    for (const [k, v] of Object.entries(stats)) {
      const prev = out[k] ?? { p: 0, n: 0 };
      out[k] = { p: prev.p + v.p, n: prev.n + v.n };
    }
  }
  return out;
}

export function genreStatsSampleSize(stats: GenreStats): number {
  let total = 0;
  for (const v of Object.values(stats)) total += v.p + v.n;
  return total;
}

/**
 * Poäng i [−1, 1] för en kandidats genrer utifrån beteendet. Per genre:
 * (p − n) / (p + n + SMOOTHING); genrer med för litet underlag hoppar över.
 * Snittet över kandidatens genrer med signal returneras — 0 om ingen genre
 * har underlag, så termen är rent additiv och ofarlig för nya användare.
 */
export function behavioralGenreScore(
  genreIds: number[] | undefined,
  stats: GenreStats,
): number {
  if (!genreIds?.length) return 0;
  let sum = 0;
  let counted = 0;
  for (const id of genreIds) {
    const s = stats[String(id)];
    if (!s) continue;
    const total = s.p + s.n;
    if (total < MIN_SAMPLE_PER_GENRE) continue;
    sum += (s.p - s.n) / (total + SMOOTHING);
    counted++;
  }
  if (counted === 0) return 0;
  return Math.max(-1, Math.min(1, sum / counted));
}

/**
 * Hur mycket beteendet ska väga relativt deklarerade genrer, i [0, 1].
 * 0 vid ingen data, 1 vid GENRE_STATS_FULL_TRUST_SAMPLE observationer.
 */
export function behaviorBlend(stats: GenreStats): number {
  return Math.min(1, genreStatsSampleSize(stats) / GENRE_STATS_FULL_TRUST_SAMPLE);
}

/* ---------------- Läsning (rå SQL, se filhuvudet) ---------------- */

export async function loadGenreStats(userId: string): Promise<GenreStats> {
  try {
    const rows = await prisma.$queryRaw<{ genre_stats: unknown }[]>`
      SELECT genre_stats FROM profiles WHERE user_id = ${userId}
    `;
    return normalizeGenreStats(rows[0]?.genre_stats);
  } catch (err) {
    console.warn("[genreStats] läsning misslyckades:", err);
    return {};
  }
}

export async function loadGenreStatsForUsers(userIds: string[]): Promise<GenreStats> {
  if (userIds.length === 0) return {};
  try {
    const rows = await prisma.$queryRaw<{ genre_stats: unknown }[]>`
      SELECT genre_stats FROM profiles WHERE user_id IN (${Prisma.join(userIds)})
    `;
    return mergeGenreStats(rows.map((r) => normalizeGenreStats(r.genre_stats)));
  } catch (err) {
    console.warn("[genreStats] gruppläsning misslyckades:", err);
    return {};
  }
}

/* ---------------- Skrivning vid swipe/betyg ---------------- */

/**
 * Klassar ett svep/betyg som positiv eller negativ observation.
 * RATED 7–10 → positiv, RATED 1–5 → negativ, RATED 6 → neutral (ingen).
 * like → positiv, dislike → negativ. seen/skip → neutral: de säger att titeln
 * är känd, inte om den föll i smaken.
 */
export function verdictFromSwipe(
  decision: string,
  rating: number | null | undefined,
): "pos" | "neg" | null {
  if (typeof rating === "number" && Number.isFinite(rating)) {
    if (rating >= 7) return "pos";
    if (rating <= 5) return "neg";
    return null;
  }
  if (decision === "like") return "pos";
  if (decision === "dislike") return "neg";
  return null;
}

type TMDBGenresOnly = { genres?: { id: number }[] };

/**
 * Registrerar ett sveps genrer i användarens statistik. BEST EFFORT och tänkt
 * att anropas fire-and-forget (`void recordSwipeGenres(...)`) — ett misslyckat
 * TMDB-uppslag eller en tappad räkning får ALDRIG blockera eller fälla själva
 * svepet. Genreuppslaget går mot Next Data Cache (force-cache), så i praktiken
 * kostar det ett nätverksanrop bara första gången någon sveper titeln.
 */
export async function recordSwipeGenres(opts: {
  userId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  decision: string;
  rating?: number | null;
}): Promise<void> {
  const verdict = verdictFromSwipe(opts.decision, opts.rating);
  if (!verdict) return;
  try {
    const d = await tmdbGet<TMDBGenresOnly>(
      opts.mediaType === "movie" ? `/movie/${opts.tmdbId}` : `/tv/${opts.tmdbId}`,
      { language: "en-US" },
      "force-cache",
    );
    const genreIds = (d.genres ?? [])
      .map((g) => g.id)
      .filter((id) => Number.isFinite(id));
    if (genreIds.length === 0) return;

    const stats = await loadGenreStats(opts.userId);
    for (const id of genreIds) {
      const prev = stats[String(id)] ?? { p: 0, n: 0 };
      stats[String(id)] =
        verdict === "pos" ? { ...prev, p: prev.p + 1 } : { ...prev, n: prev.n + 1 };
    }

    await prisma.$executeRaw`
      UPDATE profiles
      SET genre_stats = ${JSON.stringify(stats)}::jsonb
      WHERE user_id = ${opts.userId}
    `;
  } catch (err) {
    console.warn("[genreStats] uppdatering misslyckades:", err);
  }
}
