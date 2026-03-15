// app/api/group/match/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { rateLimitAllow, getRateLimitKey, MATCH_LIMIT } from "@/lib/rateLimit";

type TmdbType = "movie" | "tv";

type TmdbLite = {
  tmdbId: number;
  tmdbType: TmdbType;
  title: string;
  year?: number;
  poster?: string;
  rating?: number;
  overview?: string;
  providers?: { name: string; url: string }[];
};

function yearFromDate(date?: string | null): number | undefined {
  if (!date) return undefined;
  const y = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

async function tmdbDetails(
  type: TmdbType,
  id: number,
  locale: string
): Promise<TmdbLite | null> {
  const token = process.env.TMDB_TOKEN ?? process.env.TMDB_BEARER ?? "";
  const apiKey = process.env.TMDB_API_KEY ?? "";

  const base = `https://api.themoviedb.org/3/${type}/${id}`;
  const url = apiKey
    ? `${base}?language=${encodeURIComponent(locale)}&append_to_response=watch/providers&api_key=${apiKey}`
    : `${base}?language=${encodeURIComponent(locale)}&append_to_response=watch/providers`;

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, unknown>;

  const title =
    (type === "movie" ? (data.title as string | undefined) : (data.name as string | undefined)) ??
    "";
  const release =
    (type === "movie"
      ? (data.release_date as string | undefined)
      : (data.first_air_date as string | undefined)) ?? null;

  const poster = (data.poster_path as string | undefined) ?? undefined;
  const rating =
    typeof data.vote_average === "number" && Number.isFinite(data.vote_average)
      ? (data.vote_average as number)
      : undefined;
  const overview = (data.overview as string | undefined) ?? undefined;

  const provRoot = (data["watch/providers"] as Record<string, unknown> | undefined)?.results as
    | Record<string, { link?: string }>
    | undefined;

  const providers: { name: string; url: string }[] = [];
  if (provRoot) {
    const countries = ["SE", "GB", "US"];
    for (const cc of countries) {
      const node = provRoot[cc];
      if (node?.link) providers.push({ name: `Stream (${cc})`, url: node.link });
    }
  }

  return {
    tmdbId: id,
    tmdbType: type,
    title,
    year: yearFromDate(release),
    poster,
    rating,
    overview,
    providers,
  };
}

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const url = new URL(req.url);

    const code =
      url.searchParams.get("code") ??
      jar.get("nw_group")?.value ??
      url.searchParams.get("group") ??
      undefined;

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing group code.", size: 0, need: 0, count: 0, match: null, matches: [] },
        { status: 200 }
      );
    }

    const userId = jar.get("nw_uid")?.value ?? undefined;
    const key = getRateLimitKey(req, userId ?? null);
    if (!rateLimitAllow(key, "group-match", { limit: MATCH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: "För många förfrågningar.", size: 0, need: 0, count: 0, match: null, matches: [] },
        { status: 429 }
      );
    }
    const locale = jar.get("nw_locale")?.value ?? "sv-SE";

    const size = await prisma.groupMember.count({ where: { groupCode: code } });
    const need = Math.max(2, Math.ceil(size * 0.6));

    // Ranka kandidater på antal LIKE
    const [top, seenRows] = await Promise.all([
      prisma.groupVote.groupBy({
        by: ["tmdbId", "tmdbType"],
        where: { groupCode: code, vote: "LIKE" },
        _count: { _all: true },
        orderBy: { _count: { tmdbId: "desc" } },
        take: 20,
      }),
      userId
        ? prisma.groupMatchSeen.findMany({
            where: { groupCode: code, userId },
            select: { tmdbId: true, tmdbType: true },
          })
        : Promise.resolve([]),
    ]);

    const seenKeys = new Set(
      seenRows.map((s) => `${s.tmdbId}_${s.tmdbType}`)
    );

    // Kandidaten vi vill visa för denna användare (ej kvitterad)
    let chosen: { tmdbId: number; tmdbType: TmdbType; count: number } | null = null;
    let firstSeenAboveThreshold: { tmdbId: number; tmdbType: TmdbType; count: number } | null =
      null;

    for (const row of top) {
      const likeCount = row._count?._all ?? 0;
      if (likeCount < need) continue;

      const key = `${row.tmdbId}_${row.tmdbType}`;
      if (userId && seenKeys.has(key)) {
        if (!firstSeenAboveThreshold) {
          firstSeenAboveThreshold = {
            tmdbId: row.tmdbId,
            tmdbType: row.tmdbType as TmdbType,
            count: likeCount,
          };
        }
        continue;
      }

      chosen = {
        tmdbId: row.tmdbId,
        tmdbType: row.tmdbType as TmdbType,
        count: likeCount,
      };
      break;
    }

    if (!chosen) {
      // Ingen okvitterad kandidat – om första över tröskeln var "already seen" för användaren,
      // returnera count = dess verkliga likeCount (hjälper felsökning), men match:null.
      const count = firstSeenAboveThreshold?.count ?? 0;
      return NextResponse.json({ ok: true, size, need, count, match: null, matches: [] }, { status: 200 });
    }

    const details = await tmdbDetails(chosen.tmdbType, chosen.tmdbId, locale);

    return NextResponse.json(
      {
        ok: true,
        size,
        need,
        count: chosen.count,
        match: details ?? {
          tmdbId: chosen.tmdbId,
          tmdbType: chosen.tmdbType,
          title: "",
        },
        matches: [],
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("match GET error:", e);
    return NextResponse.json(
      { ok: false, message: "Internal error.", size: 0, need: 0, count: 0, match: null, matches: [] },
      { status: 200 }
    );
  }
}
