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

// Standardgräns för gratiskonton. Var tidigare 0 (= obegränsat) som default,
// vilket i praktiken gjorde "Obegränsat med swipes" på premiumsidan till ett
// löfte utan täckning — gratis hade också obegränsat.
//
// FREE_DAILY_SWIPE_LIMIT styr värdet utan ny deploy:
//   osatt          -> DEFAULT_FREE_DAILY_SWIPE_LIMIT (100)
//   positivt tal   -> det värdet
//   0              -> obegränsat (explicit kill-switch, t.ex. om supportärenden
//                     visar att gränsen är fel satt)
const DEFAULT_FREE_DAILY_SWIPE_LIMIT = 100;

const rawLimit = process.env.FREE_DAILY_SWIPE_LIMIT;
const parsedLimit = rawLimit === undefined || rawLimit === "" ? NaN : Number(rawLimit);
export const FREE_DAILY_SWIPE_LIMIT = !Number.isFinite(parsedLimit)
  ? DEFAULT_FREE_DAILY_SWIPE_LIMIT
  : parsedLimit > 0
    ? Math.floor(parsedLimit)
    : 0;

// Rewarded video (AdMob, iOS): titta klart på en video → +REWARDED_SWIPE_BONUS
// swipes, max REWARDED_MAX_PER_DAY gånger per rullande dygn (Oskars beslut
// 2026-08-14: 3). Grants skrivs som SwipeBonus-rader av /api/swipe/bonus och
// räknas in i effektiva gränsen här — allt server-side, samma garanti som
// själva gränsen. Tuning utan deploy:
//   NW_REWARDED_MAX_PER_DAY   osatt -> 3, 0 -> funktionen av
//   NW_REWARDED_SWIPE_BONUS   osatt -> samma som dagsgränsen (100)
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
export const REWARDED_MAX_PER_DAY = envInt("NW_REWARDED_MAX_PER_DAY", 3);
export const REWARDED_SWIPE_BONUS = envInt(
  "NW_REWARDED_SWIPE_BONUS",
  FREE_DAILY_SWIPE_LIMIT > 0 ? FREE_DAILY_SWIPE_LIMIT : DEFAULT_FREE_DAILY_SWIPE_LIMIT
);

export type SwipeAllowance = {
  isPremium: boolean;
  /** Effektiv gräns inkl. rewarded-bonusar. null = obegränsat (premium). */
  limit: number | null;
  /** Grundgränsen utan bonusar — det UI-texten "{limit}/dag ingår" ska visa. */
  baseLimit: number | null;
  used: number;
  /** null = obegränsat (premium). */
  remaining: number | null;
  allowed: boolean;
  /** Hur många rewarded-videor användaren kan tjäna in till (rullande dygn). */
  rewardedRemaining: number;
  /** Hur många swipes en video ger. */
  rewardedBonus: number;
};

export async function getSwipeAllowance(uid: string): Promise<SwipeAllowance> {
  const ent = await getEntitlement(uid);
  if (ent.isPremium) {
    return unlimitedAllowance(true);
  }

  // Gräns 0/osatt = obegränsat även för gratisanvändare (samma form som premium).
  if (FREE_DAILY_SWIPE_LIMIT <= 0) {
    return unlimitedAllowance(false);
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [used, bonuses] = await Promise.all([
    prisma.rating.count({
      where: {
        userId: uid,
        decidedAt: { gte: cutoff },
        decision: { in: ["like", "dislike", "seen"] },
      },
    }),
    prisma.swipeBonus.findMany({
      where: { userId: uid, grantedAt: { gte: cutoff } },
      select: { amount: true },
      take: 50, // bounded — kan aldrig bli fler än maxPerDay ändå
    }),
  ]);

  const bonusSum = bonuses.reduce((s: number, b: { amount: number }) => s + b.amount, 0);
  const limit = FREE_DAILY_SWIPE_LIMIT + bonusSum;
  const remaining = Math.max(0, limit - used);

  return {
    isPremium: false,
    limit,
    baseLimit: FREE_DAILY_SWIPE_LIMIT,
    used,
    remaining,
    allowed: remaining > 0,
    rewardedRemaining: Math.max(0, REWARDED_MAX_PER_DAY - bonuses.length),
    rewardedBonus: REWARDED_SWIPE_BONUS,
  };
}

function unlimitedAllowance(isPremium: boolean): SwipeAllowance {
  return {
    isPremium,
    limit: null,
    baseLimit: null,
    used: 0,
    remaining: null,
    allowed: true,
    rewardedRemaining: 0,
    rewardedBonus: REWARDED_SWIPE_BONUS,
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
