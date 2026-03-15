import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, TMDB_DETAILS_LIMIT } from "../../../../lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const H = { Authorization: `Bearer ${process.env.TMDB_V4_TOKEN!}` };

type MovieDetails = {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date?: string | null;
  vote_average?: number;
  vote_count?: number;
};
type TvDetails = {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  first_air_date?: string | null;
  vote_average?: number;
  vote_count?: number;
};
type NormalizedDetails = {
  ok: true;
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  overview: string;
  posterUrl: string | null;
  posterPath: string | null;
  year: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  blurDataURL: string | null;
};

function posterUrl(path: string | null | undefined): string | null {
  return path ? `${IMG}/w500${path}` : null;
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

    let language = "sv-SE";
    let region = "SE";
    if (uid) {
      const profile = await prisma.profile.findUnique({ where: { userId: uid } });
      if (profile?.locale) language = profile.locale;
      if (profile?.region) region = profile.region;
    }

    const qs = new URLSearchParams({ language, region });
    const r = await fetch(`${TMDB}/${type}/${id}?${qs.toString()}`, {
      headers: H,
      next: { revalidate: 3600 },
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `tmdb ${r.status}` }, { status: 502 });

    if (type === "movie") {
      const d = (await r.json()) as MovieDetails;
      const blurDataURL = await buildBlurDataURL(d.poster_path);
      const res: NormalizedDetails = {
        ok: true,
        id: d.id,
        mediaType: "movie",
        title: d.title,
        overview: d.overview || "",
        posterUrl: posterUrl(d.poster_path),
        posterPath: d.poster_path ?? null,
        year: yearFromDate(d.release_date ?? null),
        voteAverage: typeof d.vote_average === "number" ? d.vote_average : null,
        voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
        blurDataURL,
      };
      return NextResponse.json(res);
    } else {
      const d = (await r.json()) as TvDetails;
      const blurDataURL = await buildBlurDataURL(d.poster_path);
      const res: NormalizedDetails = {
        ok: true,
        id: d.id,
        mediaType: "tv",
        title: d.name,
        overview: d.overview || "",
        posterUrl: posterUrl(d.poster_path),
        posterPath: d.poster_path ?? null,
        year: yearFromDate(d.first_air_date ?? null),
        voteAverage: typeof d.vote_average === "number" ? d.vote_average : null,
        voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
        blurDataURL,
      };
      return NextResponse.json(res);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
