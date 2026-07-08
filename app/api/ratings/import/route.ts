// app/api/ratings/import/route.ts
//
// Importerar IMDb CSV (betyg eller watchlist) via TMDB /find/{imdb_id}.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { randomUUID } from "crypto";
import { parseImdbCsv, type ImdbImportMode } from "@/lib/imdbImport";

const MAX_ROWS = 500;
const BATCH = 8;

const V4_TOKEN =
  process.env.TMDB_V4_TOKEN ??
  process.env.TMDB_v4_TOKEN ??
  process.env.TMDB_READ_TOKEN ??
  process.env.TMDB_TOKEN ??
  null;

const V3_KEY = process.env.TMDB_API_KEY ?? null;

type TmdbFind = {
  movie_results?: { id: number }[];
  tv_results?: { id: number }[];
};

async function tmdbFind(imdbId: string): Promise<{ tmdbId: number; mediaType: "movie" | "tv" } | null> {
  const url = new URL(`https://api.themoviedb.org/3/find/${imdbId}`);
  url.searchParams.set("external_source", "imdb_id");
  const headers: Record<string, string> = {};
  if (V4_TOKEN) headers.Authorization = `Bearer ${V4_TOKEN}`;
  else if (V3_KEY) url.searchParams.set("api_key", V3_KEY);
  else return null;

  const res = await fetch(url.toString(), { headers, cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as TmdbFind;
  const movieId = data.movie_results?.[0]?.id;
  if (movieId) return { tmdbId: movieId, mediaType: "movie" };
  const tvId = data.tv_results?.[0]?.id;
  if (tvId) return { tmdbId: tvId, mediaType: "tv" };
  return null;
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const modeRaw = form.get("mode");
    const mode: ImdbImportMode = modeRaw === "watchlist" ? "watchlist" : "ratings";

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Ingen fil uppladdad." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const parsed = parseImdbCsv(buffer, mode);
    const toProcess = parsed.rows.slice(0, MAX_ROWS);

    let imported = 0;
    let failed = 0;
    const sampleErrors: string[] = [];

    for (let i = 0; i < toProcess.length; i += BATCH) {
      const batch = toProcess.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const found = await tmdbFind(row.imdbId);
            if (!found) {
              failed++;
              if (sampleErrors.length < 5) sampleErrors.push(`${row.title}: hittades inte på TMDB`);
              return;
            }
            const mediaType = row.mediaType === found.mediaType ? found.mediaType : found.mediaType;

            if (mode === "ratings" && row.rating) {
              const existing = await prisma.rating.findUnique({
                where: {
                  userId_tmdbId_mediaType: { userId: uid, tmdbId: found.tmdbId, mediaType },
                },
                select: { id: true },
              });
              if (existing) {
                await prisma.rating.update({
                  where: { id: existing.id },
                  data: { rating: row.rating, decision: "RATED", decidedAt: new Date() },
                });
              } else {
                await prisma.rating.create({
                  data: {
                    id: randomUUID(),
                    userId: uid,
                    tmdbId: found.tmdbId,
                    mediaType,
                    rating: row.rating,
                    decision: "RATED",
                  },
                });
              }
            } else if (mode === "watchlist") {
              const existing = await prisma.watchlist.findFirst({
                where: { userId: uid, tmdbId: found.tmdbId, mediaType },
                select: { id: true },
              });
              if (!existing) {
                await prisma.watchlist.create({
                  data: {
                    id: randomUUID(),
                    userId: uid,
                    tmdbId: found.tmdbId,
                    mediaType,
                  },
                });
              }
            }
            imported++;
          } catch (e) {
            failed++;
            if (sampleErrors.length < 5) {
              sampleErrors.push(
                `${row.title}: ${e instanceof Error ? e.message : "fel"}`
              );
            }
          }
        })
      );
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped: parsed.skipped + Math.max(0, parsed.rows.length - MAX_ROWS),
      failed,
      sampleErrors,
    });
  } catch (err) {
    console.error("ratings/import error:", err);
    return NextResponse.json({ ok: false, message: "Import misslyckades." }, { status: 500 });
  }
}
