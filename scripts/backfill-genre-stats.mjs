// scripts/backfill-genre-stats.mjs
//
// Engångs-backfill av Profile.genre_stats (beteendebaserade genrevikter,
// lib/genreStats.ts) för användare som redan har swipe-historik. Nya swipes
// uppdaterar statistiken löpande via recordSwipeGenres — det här scriptet
// bygger ikapp historiken.
//
// Körs med:  node scripts/backfill-genre-stats.mjs
// Kräver DATABASE_URL + TMDB_V4_TOKEN i .env. Idempotent: räknar alltid om
// från hela ratings-historiken och skriver över genre_stats.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

// Minimal .env-läsning (ingen dotenv-dependency i repot).
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=("?)(.*)\2\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
  }
} catch {
  /* .env saknas — förlita på miljön */
}

const prisma = new PrismaClient();
const TOK = process.env.TMDB_V4_TOKEN;
if (!TOK) {
  console.error("TMDB_V4_TOKEN saknas.");
  process.exit(1);
}

// Samma klassning som lib/genreStats.ts verdictFromSwipe — håll dem i synk.
function verdict(decision, rating) {
  if (typeof rating === "number" && Number.isFinite(rating)) {
    if (rating >= 7) return "pos";
    if (rating <= 5) return "neg";
    return null;
  }
  if (decision === "like") return "pos";
  if (decision === "dislike") return "neg";
  return null;
}

const genreCache = new Map(); // "movie_123" -> number[]
async function genresOf(mediaType, tmdbId) {
  const key = `${mediaType}_${tmdbId}`;
  if (genreCache.has(key)) return genreCache.get(key);
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?language=en-US`,
      { headers: { Authorization: `Bearer ${TOK}` } },
    );
    const ids = r.ok ? ((await r.json()).genres ?? []).map((g) => g.id) : [];
    genreCache.set(key, ids);
    return ids;
  } catch {
    genreCache.set(key, []);
    return [];
  }
}

const users = await prisma.$queryRaw`
  SELECT DISTINCT r.user_id FROM ratings r JOIN profiles p ON p.user_id = r.user_id
`;
console.log(`Backfillar ${users.length} användare…`);

for (const { user_id } of users) {
  const ratings = await prisma.rating.findMany({
    where: { userId: user_id },
    select: { tmdbId: true, mediaType: true, decision: true, rating: true },
  });
  const stats = {};
  const CONC = 20;
  for (let i = 0; i < ratings.length; i += CONC) {
    await Promise.all(
      ratings.slice(i, i + CONC).map(async (r) => {
        const v = verdict(r.decision, r.rating);
        if (!v) return;
        for (const gid of await genresOf(r.mediaType, r.tmdbId)) {
          const prev = stats[String(gid)] ?? { p: 0, n: 0 };
          stats[String(gid)] = v === "pos" ? { ...prev, p: prev.p + 1 } : { ...prev, n: prev.n + 1 };
        }
      }),
    );
  }
  await prisma.$executeRaw`
    UPDATE profiles SET genre_stats = ${JSON.stringify(stats)}::jsonb WHERE user_id = ${user_id}
  `;
  console.log(`  ${user_id}: ${ratings.length} ratings → ${Object.keys(stats).length} genrer`);
}

await prisma.$disconnect();
console.log("Klart.");
