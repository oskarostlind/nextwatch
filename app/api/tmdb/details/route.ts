import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, TMDB_DETAILS_LIMIT } from "../../../../lib/rateLimit";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";
import {
  pickTrailer,
  VIDEO_APPEND_PARAMS,
  VIDEO_LANGUAGE_PARAM,
  type TmdbVideo,
  type Trailer,
} from "../../../../lib/tmdbVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const H = { Authorization: `Bearer ${process.env.TMDB_V4_TOKEN!}` };

type Genre = { id: number; name: string };

type Videos = { results?: TmdbVideo[] };

type MovieDetails = {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  genres?: Genre[];
  videos?: Videos;
};
type TvDetails = {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  first_air_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  genres?: Genre[];
  videos?: Videos;
};
type NormalizedDetails = {
  ok: true;
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  overview: string;
  posterUrl: string | null;
  posterPath: string | null;
  backdropUrl: string | null;
  backdropPath: string | null;
  year: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  genres: string[];
  blurDataURL: string | null;
  /** null när titeln saknar trailer — knappen visas då inte. */
  trailer: Trailer | null;
};

function posterUrl(path: string | null | undefined): string | null {
  return path ? `${IMG}/w500${path}` : null;
}
function backdropUrl(path: string | null | undefined): string | null {
  return path ? `${IMG}/w780${path}` : null;
}
function genreNames(genres?: Genre[]): string[] {
  if (!Array.isArray(genres)) return [];
  return genres.map((g) => g.name).filter(Boolean);
}
function yearFromDate(d?: string | null): string | null {
  if (!d) return null;
  const y = d.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}
async function buildBlurDataURL(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const r = await fetch(`${IMG}/w92${path}`, { next: { revalidate: 86400 } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "image/jpeg";
    const buf = await r.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return `data:${ct};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const type = (url.searchParams.get("type") || "").toLowerCase() as "movie" | "tv";
    const id = Number(url.searchParams.get("id") || "");
    if (!type || !id || !Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "missing or invalid type/id" }, { status: 400 });
    }

    const c = await cookies();
    const uid = c.get("nw_uid")?.value || null;
    const key = getRateLimitKey(req, uid);
    if (!rateLimitAllow(key, "tmdb-details", { limit: TMDB_DETAILS_LIMIT })) {
      return NextResponse.json({ ok: false, error: "För många förfrågningar." }, { status: 429 });
    }

    const langOverride = url.searchParams.get("language") || url.searchParams.get("locale");
    // Språket följer gränssnittsvalet (nw_lang) — regionen är fortfarande
    // geografisk och kommer från nw_region/profilen, så providers och
    // åldersgränser inte ändras när man byter språk.
    const cookieRegion = c.get("nw_region")?.value || null;
    const language = langOverride || (await tmdbLanguageFromCookies());
    let region = cookieRegion || "SE";
    if (uid && !cookieRegion) {
      const profile = await prisma.profile.findUnique({
        where: { userId: uid },
        select: { region: true },
      });
      if (profile?.region) region = profile.region;
    }

    const qs = new URLSearchParams({
      language,
      region,
      append_to_response: VIDEO_APPEND_PARAMS,
      // Utan detta filtreras videos på `language` och svenska trailers är sällsynta.
      include_video_language: VIDEO_LANGUAGE_PARAM,
    });
    const r = await fetch(`${TMDB}/${type}/${id}?${qs.toString()}`, {
      headers: H,
      next: { revalidate: 3600 },
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `tmdb ${r.status}` }, { status: 502 });

    // Routen är force-dynamic → Next skickar annars no-store, vilket slår ut
    // WKWebView:s HTTP-cache trots att klienten ber om force-cache. Query-
    // strängen (type/id/language) nycklar redan svaret, och detaljerna är
    // stabila på timskala — låt klienten cacha privat i en timme.
    const CACHE_HEADERS = { "Cache-Control": "private, max-age=3600" } as const;

    if (type === "movie") {
      const d = (await r.json()) as MovieDetails;
      // Starta blur-hämtningen (extra TMDB-bildanrop) direkt och invänta den
      // sist, så den överlappar övrigt arbete i stället för att blockera svaret.
      const blurPromise = buildBlurDataURL(d.poster_path);
      const res: NormalizedDetails = {
        ok: true,
        id: d.id,
        mediaType: "movie",
        title: d.title,
        overview: d.overview || "",
        posterUrl: posterUrl(d.poster_path),
        posterPath: d.poster_path ?? null,
        backdropUrl: backdropUrl(d.backdrop_path),
        backdropPath: d.backdrop_path ?? null,
        year: yearFromDate(d.release_date ?? null),
        voteAverage: typeof d.vote_average === "number" ? d.vote_average : null,
        voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
        genres: genreNames(d.genres),
        blurDataURL: await blurPromise,
        trailer: pickTrailer(d.videos?.results),
      };
      return NextResponse.json(res, { headers: CACHE_HEADERS });
    } else {
      const d = (await r.json()) as TvDetails;
      // Se kommentaren i movie-grenen — blur får inte blockera svaret.
      const blurPromise = buildBlurDataURL(d.poster_path);
      const res: NormalizedDetails = {
        ok: true,
        id: d.id,
        mediaType: "tv",
        title: d.name,
        overview: d.overview || "",
        posterUrl: posterUrl(d.poster_path),
        posterPath: d.poster_path ?? null,
        backdropUrl: backdropUrl(d.backdrop_path),
        backdropPath: d.backdrop_path ?? null,
        year: yearFromDate(d.first_air_date ?? null),
        voteAverage: typeof d.vote_average === "number" ? d.vote_average : null,
        voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
        genres: genreNames(d.genres),
        blurDataURL: await blurPromise,
        trailer: pickTrailer(d.videos?.results),
      };
      return NextResponse.json(res, { headers: CACHE_HEADERS });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
