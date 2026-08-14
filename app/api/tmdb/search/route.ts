// app/api/tmdb/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TMDBMovie = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
};

type TMDBTv = {
  id: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  poster_path?: string | null;
};

function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const type = (url.searchParams.get("type") || "movie").toLowerCase();
    const locale = url.searchParams.get("locale") || (await tmdbLanguageFromCookies());

    if (!q || !["movie", "tv"].includes(type)) {
      return fail(400, "Ogiltig query.");
    }

    const key =
      process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!key) return fail(500, "TMDB_API_KEY saknas i miljövariabler.");

    const endpoint =
      type === "movie"
        ? "https://api.themoviedb.org/3/search/movie"
        : "https://api.themoviedb.org/3/search/tv";

    const apiUrl = `${endpoint}?api_key=${key}&query=${encodeURIComponent(
      q
    )}&language=${encodeURIComponent(locale)}&include_adult=false&page=1`;

    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text();
      return fail(502, `TMDb-fel (${res.status}): ${txt}`);
    }

    const data = (await res.json()) as { results?: unknown[] };
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || "8")));
    const results = (Array.isArray(data.results) ? data.results : [])
      .slice(0, limit)
      .map((r) => {
        if (type === "movie") {
          const m = r as TMDBMovie;
          return {
            id: m.id,
            title: m.title ?? m.original_title ?? "Okänd titel",
            year: (m.release_date ?? "").toString().slice(0, 4),
            poster: m.poster_path
              ? `https://image.tmdb.org/t/p/w154${m.poster_path}`
              : null,
          };
        } else {
          const tv = r as TMDBTv;
          return {
            id: tv.id,
            title: tv.name ?? tv.original_name ?? "Okänd titel",
            year: (tv.first_air_date ?? "").toString().slice(0, 4),
            poster: tv.poster_path
              ? `https://image.tmdb.org/t/p/w154${tv.poster_path}`
              : null,
          };
        }
      });

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internt fel.";
    return fail(500, msg);
  }
}
