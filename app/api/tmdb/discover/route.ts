import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";
import { fillMissingRatings } from "@/lib/omdbRating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = {
  id: number;
  title: string;
  posterPath: string | null;
  year: string | null;
  voteAverage: number | null;
  mediaType: "movie" | "tv";
};

type TMDBResult = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  vote_average?: number | null;
  vote_count?: number | null;
};

type TMDBResp = {
  page?: number;
  total_pages?: number;
  results?: TMDBResult[];
};

const TMDB = "https://api.themoviedb.org/3";
const H = { Authorization: `Bearer ${process.env.TMDB_V4_TOKEN!}` };

// IMDb-style Bayesian weighted rating so a single 10.0 vote can't outrank a
// classic with thousands of votes. m/C are TMDB-scale (not IMDb's own
// m=25000, which assumes IMDb's much larger vote counts).
const RANK_MIN_VOTES = Number(process.env.NW_RANK_MIN_VOTES) || 300;
const RANK_MEAN = Number(process.env.NW_RANK_MEAN) || 6.9;

function weightedRating(voteCount: number, voteAverage: number): number {
  const v = voteCount;
  const m = RANK_MIN_VOTES;
  return (v / (v + m)) * voteAverage + (m / (v + m)) * RANK_MEAN;
}

function yearFrom(d: string | null | undefined): string | null {
  if (!d) return null;
  const y = d.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const type = (url.searchParams.get("type") || "movie").toLowerCase() as "movie" | "tv";
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const sortBy = url.searchParams.get("sort_by") || "popularity.desc";
    const withGenres = url.searchParams.get("with_genres") || "";
    // Sub-genre-filtrering (lib/subgenres.ts): TMDB keyword-id:n, kommatecknade
    // från klienten men OR-semantik (pipe) i TMDB:s eget API, precis som genrer.
    const withKeywords = (url.searchParams.get("with_keywords") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("|");
    const useMyProviders = url.searchParams.get("myProviders") === "1";

    // Default region/language; override från cookies (i första hand) eller profil
    let region = "SE";
    let withProviders = "";

    const c = await cookies();
    const uid = c.get("nw_uid")?.value;
    // Cookie-först: middleware.ts stämplar nw_locale/nw_region på VARJE
    // request, så Prisma-uppslaget behövs bara när cookies saknas (t.ex. en
    // gammal klient). Sparar en Neon-rundresa per discover-sida.
    const cookieRegion = c.get("nw_region")?.value || "";
    // Språket följer gränssnittsvalet; regionen förblir geografisk.
    const language = await tmdbLanguageFromCookies();
    if (cookieRegion) region = cookieRegion;
    if (uid && !cookieRegion) {
      const p = await prisma.profile.findUnique({
        where: { userId: uid },
        select: { region: true, providers: true },
      });
      if (!cookieRegion && p?.region) region = p.region;
      if (useMyProviders && Array.isArray(p?.providers) && p.providers.length > 0) {
        // NOTE: TMDb expects provider IDs; we have names. We use name filtering client-side,
        // but here we still forward monetization + region hints for better results.
        // (If you later store provider IDs, map them here and set with_watch_providers=ids)
        withProviders = ""; // left blank intentionally until IDs are stored
      }
    }

    const qs = new URLSearchParams({
      include_adult: "false",
      language,
      region,
      sort_by: sortBy,
      page: String(page),
      with_genres: withGenres,
      with_watch_monetization_types: "flatrate",
      watch_region: region,
    });
    if (withKeywords) qs.set("with_keywords", withKeywords);
    const isHighestRated = sortBy === "vote_average.desc";
    if (isHighestRated) {
      // Hard eligibility floor: excludes near-zero-vote titles from TMDB's
      // result set entirely, so they never even occupy a page slot.
      qs.set("vote_count.gte", String(RANK_MIN_VOTES));
    }
    if (withProviders) qs.set("with_watch_providers", withProviders);

    const r = await fetch(`${TMDB}/discover/${type}?${qs.toString()}`, { headers: H, next: { revalidate: 60 } });
    if (!r.ok) {
      const txt = await r.text();
      return NextResponse.json({ ok: false, error: `TMDb error ${r.status}: ${txt}` }, { status: 500 });
    }

    const d = (await r.json()) as TMDBResp;
    let results = d.results || [];
    if (isHighestRated) {
      // Re-rank this page by the weighted score; the raw vote_average is
      // still what gets displayed on the card (see fmtRating in the client).
      results = [...results].sort(
        (a, b) =>
          weightedRating(b.vote_count ?? 0, b.vote_average ?? 0) -
          weightedRating(a.vote_count ?? 0, a.vote_average ?? 0)
      );
    }
    const items: Item[] = results.map((it): Item => ({
      id: it.id,
      mediaType: type,
      title: it.title ?? it.name ?? "",
      posterPath: it.poster_path ?? null,
      year: type === "movie" ? yearFrom(it.release_date) : yearFrom(it.first_air_date),
      voteAverage: it.vote_average ?? null,
    }));

    // Osynlig IMDb-fallback (lib/omdbRating.ts): fyller i voteAverage för kort
    // där TMDB:s eget saknas/är opålitligt (för få röster). No-op utan
    // OMDB_API_KEY, kastar aldrig. "items" och "results" har samma ordning
    // (samma .map ovan), så vote_count kan paras ihop index-för-index.
    const ratingFillCards = items.map((it, i) => ({
      tmdbId: it.id,
      mediaType: type,
      rating: it.voteAverage,
      voteCount: results[i]?.vote_count ?? null,
    }));
    await fillMissingRatings(ratingFillCards);
    for (let i = 0; i < items.length; i++) {
      const filled = ratingFillCards[i].rating;
      if (filled != null) items[i].voteAverage = filled;
    }

    return NextResponse.json({
      ok: true,
      page: d.page ?? 1,
      totalPages: d.total_pages ?? 1,
      items,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
