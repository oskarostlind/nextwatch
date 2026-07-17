// app/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../lib/prisma";
import { jitterFor } from "@/lib/deckVisuals";
import { CURATED, type HeroCard } from "@/lib/curatedHero";
import HeroDeck from "./components/landing/HeroDeck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TmdbMovie = {
  id: number;
  title?: string;
  release_date?: string;
  poster_path: string | null;
};

// TMDB-konventionen matchar app/api/tmdb/landing-posters/route.ts (kodbasen är
// inkonsekvent — lib/tmdb.ts läser andra env-namn).
//
// tmdbId hårdkodas i den kurerade listan men poster_path hämtas här: filnamnen
// hos TMDB kan rotera, och en hårdkodad path som 404:ar ger ett trasigt hero.
// Cachas ett dygn — listan är statisk, så inget behöver vara färskare än så.
async function fetchTitle(tmdbId: number): Promise<TmdbMovie | null> {
  const apiKey = process.env.TMDB_API_KEY;
  const v4 = process.env.TMDB_V4_TOKEN ?? process.env.TMDB_v4_TOKEN;

  const usp = new URLSearchParams({ language: "sv-SE" });
  if (apiKey) usp.set("api_key", apiKey);

  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?${usp.toString()}`, {
      headers: v4 ? { Authorization: `Bearer ${v4}` } : undefined,
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return null;
    return (await res.json()) as TmdbMovie;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;

  // Redan inloggad med verifierat konto + profil → hoppa över heron (viktigt för iOS/Capacitor).
  if (uid) {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: {
        emailVerified: true,
        passwordHash: true,
        appleSub: true,
        profile: { select: { userId: true } },
      },
    });
    const hasAuth = Boolean(user?.passwordHash || user?.appleSub);
    if (user?.emailVerified && hasAuth && user?.profile) {
      redirect("/swipe");
    }
  }

  const fetched = await Promise.all(CURATED.map((c) => fetchTitle(c.tmdbId)));

  const cards: HeroCard[] = CURATED.map((c, i) => {
    const m = fetched[i];
    return {
      id: c.tmdbId,
      title: m?.title || c.expect,
      year: (m?.release_date ?? "").slice(0, 4),
      poster: m?.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      accent: c.accent,
      jitter: jitterFor(i),
    };
  });

  return <HeroDeck cards={cards} />;
}
