// lib/swipeDecision.ts
//
// Sparar ett svepbeslut (like/dislike/skip/seen) på en titel — exakt det
// /api/rate gör för swipe-lekens knappar, inklusive "Sett" (svep upp). Delas
// med "Välj åt mig" ("Har sett den", lib/aiPick/seen.ts) så att båda vägarna
// skriver samma sak.
//
// OBS: rating rörs INTE. Tidigare nollades den vid varje svep, vilket raderade
// nysatta betyg i sett-flödet (svepet och betygsmodalens /api/ratings/save
// gick parallellt och den som landade sist vann). Betyget ägs av
// betygsflödena — ett svep ändrar bara beslutet. Watchlisten rörs inte heller
// (det gör bara like-vägen i /api/swipe/decide).

import { prisma } from "@/lib/prisma";
import { recordSwipeGenres } from "@/lib/genreStats";

export type SwipeDecision = "like" | "dislike" | "skip" | "seen";

export async function saveSwipeDecision(opts: {
  userId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  decision: SwipeDecision;
}): Promise<void> {
  const { userId, tmdbId, mediaType, decision } = opts;
  await prisma.rating.upsert({
    where: { userId_tmdbId_mediaType: { userId, tmdbId, mediaType } },
    update: { decision, decidedAt: new Date() },
    create: { id: crypto.randomUUID(), userId, tmdbId, mediaType, decision },
  });
  // Beteendebaserad genrestatistik (lib/genreStats.ts) — fire-and-forget.
  // seen/skip är neutrala och skriver ingenting.
  void recordSwipeGenres({ userId, tmdbId, mediaType, decision });
}
