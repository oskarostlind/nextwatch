// lib/swipeLimit.ts
//
// Daglig swipegräns för gratisanvändare (rullande 24 timmar). Premium =
// obegränsat. Räknas server-side på Rating-rader: varje swipe (solo och grupp)
// skriver/uppdaterar en rating via /api/rate resp. /api/swipe/decide, och
// gruppröster gatas dessutom i /api/group/vote — gränsen kan alltså inte
// kringgås från klienten.
//
// Obs: count-then-write utan lås — parallella requests kan ge någon enstaka
// swipe över gränsen, vilket är helt ok för det här ändamålet.

import { prisma } from "@/lib/prisma";
import { getEntitlement } from "@/lib/entitlements";

// Konfigureras via env (lokalt + Vercel). 0 eller osatt = obegränsat.
// Sätt t.ex. FREE_DAILY_SWIPE_LIMIT=100 för att återaktivera gränsen.
const rawLimit = Number(process.env.FREE_DAILY_SWIPE_LIMIT ?? "0");
export const FREE_DAILY_SWIPE_LIMIT =
  Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 0;

export type SwipeAllowance = {
  isPremium: boolean;
  /** null = obegränsat (premium). */
  limit: number | null;
  used: number;
  /** null = obegränsat (premium). */
  remaining: number | null;
  allowed: boolean;
};

export async function getSwipeAllowance(uid: string): Promise<SwipeAllowance> {
  const ent = await getEntitlement(uid);
  if (ent.isPremium) {
    return { isPremium: true, limit: null, used: 0, remaining: null, allowed: true };
  }

  // Gräns 0/osatt = obegränsat även för gratisanvändare (samma form som premium).
  if (FREE_DAILY_SWIPE_LIMIT <= 0) {
    return { isPremium: false, limit: null, used: 0, remaining: null, allowed: true };
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.rating.count({
    where: {
      userId: uid,
      decidedAt: { gte: cutoff },
      decision: { in: ["like", "dislike", "seen"] },
    },
  });
  const remaining = Math.max(0, FREE_DAILY_SWIPE_LIMIT - used);

  return {
    isPremium: false,
    limit: FREE_DAILY_SWIPE_LIMIT,
    used,
    remaining,
    allowed: remaining > 0,
  };
}

/** Enhetlig 429-payload så alla swipe-endpoints svarar likadant. */
export function swipeLimitPayload(a: SwipeAllowance) {
  return {
    ok: false as const,
    error: "swipe_limit" as const,
    message: "Du har nått dagens swipegräns.",
    limit: a.limit,
    used: a.used,
  };
}
