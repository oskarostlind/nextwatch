import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { randomUUID } from "crypto"; // ← genererar id om modellen kräver det

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title?: string;
  year?: string | null;
  poster?: string | null;
  /**
   * Satt av "Kommer snart"-kortet i solo-swipen (app/swipe/page_client.tsx):
   * liken ska förutom watchlisten också lägga en bevakning (ReleaseFollow), så
   * cronen kan pusha när titeln faktiskt släppts.
   *
   * Bevakningen hängs på DEN HÄR routen och inte på /api/swipe/decide: decide
   * har i praktiken ingen anropare kvar i klienten — solo-liken går via
   * /api/rate (beslutet) + hit (sparningen). Se lib/upcomingTitles.ts.
   */
  followRelease?: boolean;
  /** ISO-datum (YYYY-MM-DD). null = TBA; cronen fyller på datumet i efterhand. */
  releaseDate?: string | null;
};

/**
 * Lägger/uppdaterar bevakningen. Best-effort: en titel som hamnat i watchlisten
 * men missat sin bevakning är ett uteblivet pling, inte ett trasigt flöde — och
 * ska aldrig ge användaren ett fel på en like som gick igenom.
 */
async function upsertReleaseFollow(opts: {
  userId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  releaseDate: Date | null;
}): Promise<void> {
  const { userId, tmdbId, mediaType, title, releaseDate } = opts;
  try {
    await prisma.releaseFollow.upsert({
      where: { userId_tmdbId_mediaType: { userId, tmdbId, mediaType } },
      // Datumet kan ha flyttats sedan förra liken (vanligt för osläppta titlar).
      // notifiedAt rörs INTE: har notisen redan gått ut ska en om-like inte
      // trigga den en gång till.
      update: { title, releaseDate },
      create: { userId, tmdbId, mediaType, title, releaseDate },
    });
  } catch (e) {
    console.warn("[watchlist/like] kunde inte spara bevakning:", e instanceof Error ? e.message : e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session" }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    if (!body?.tmdbId || !body.mediaType) {
      return NextResponse.json({ ok: false, message: "Ogiltig payload" }, { status: 400 });
    }

    // Bevakning av osläppt titel. Ligger före watchlist-kollen med flit: en
    // titel som redan låg i listan (t.ex. sparad från Discover) ska ändå kunna
    // få sin bevakning när den gillas som "Kommer snart"-kort.
    const wantsFollow = body.followRelease === true;
    if (wantsFollow) {
      const parsed = body.releaseDate ? new Date(body.releaseDate) : null;
      await upsertReleaseFollow({
        userId: uid,
        tmdbId: body.tmdbId,
        mediaType: body.mediaType,
        title: (body.title ?? "").trim() || String(body.tmdbId),
        releaseDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      });
    }

    // Finns redan i watchlist?
    const existing = await prisma.watchlist.findFirst({
      where: { userId: uid, tmdbId: body.tmdbId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ ok: true });
    }

    // Skapa – inkluderar id då modellen kräver det
    await prisma.watchlist.create({
      data: {
        id: randomUUID(),          // ★ fixar TS-2322 (id saknades)
        userId: uid,
        tmdbId: body.tmdbId,
        mediaType: body.mediaType, // om detta är en Prisma-enum i din modell, är värdet ändå "movie" | "tv"
        // Lägg gärna till dessa om kolumnerna finns i din modell (annars lämna bort dem):
        // title: body.title ?? undefined,
        // year: body.year ?? undefined,
        // poster: body.poster ?? undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Internt fel";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
