// lib/aiPick/seen.ts
//
// "Har sett den" i "Välj åt mig": markera titeln som sedd på samma sätt som
// swipens "Sett" (lib/swipeDecision.ts, samma skrivning som /api/rate).
//
//   - Idempotent: redan sedd, betygsatt eller markerad 'rated' → ingenting.
//   - Skapar aldrig en like och rör inte watchlisten. En sparad like som
//     markeras sedd faller ut ur "sparade men osedda" (isSavedExcluded) —
//     precis som när man sveper upp den i leken.
//   - Räknas inte mot den dagliga swipegränsen: det är inget svep, och valet
//     har redan debiterats som ett val.

import { prisma } from "@/lib/prisma";
import { saveSwipeDecision } from "@/lib/swipeDecision";

export type MarkSeenResult = "marked" | "already";

/** true om raden redan säger att titeln är sedd (betyg, 'seen' eller 'rated'). */
export function alreadySeen(row: { rating: number | null; decision: string } | null | undefined): boolean {
  if (!row) return false;
  if (row.rating != null) return true;
  const d = row.decision.toLowerCase();
  return d === "seen" || d === "rated";
}

export async function markPickSeen(
  uid: string,
  item: { tmdbId: number; mediaType: "movie" | "tv" },
): Promise<MarkSeenResult> {
  const existing = await prisma.rating.findUnique({
    where: { userId_tmdbId_mediaType: { userId: uid, tmdbId: item.tmdbId, mediaType: item.mediaType } },
    select: { rating: true, decision: true },
  });
  if (alreadySeen(existing)) return "already";
  await saveSwipeDecision({ userId: uid, tmdbId: item.tmdbId, mediaType: item.mediaType, decision: "seen" });
  return "marked";
}
