// lib/groupLimits.ts
//
// Medlemstak för grupper. Premiumsidan lovar "Större grupper" — innan det här
// fanns ingen gräns alls någonstans, så löftet saknade täckning.
//
// Taket bestäms av GRUPPENS SKAPARE, inte av den som försöker gå med. Annars
// blir upplevelsen obegriplig: fyra kompisar startar en grupp och den femte
// nekas för att hen råkar sakna premium, trots att gruppen "är" premium. Samma
// modell som värd-baserade tjänster (Zoom m.fl.) — en betalande värd lyfter
// hela sällskapet.
//
// Gäller alla vägar in i en grupp: /api/group/join (kod) och
// /api/group/invite/respond (accepterad inbjudan). Befintliga medlemmar kastas
// aldrig ut om skaparens prenumeration löper ut — taket gäller bara nya
// anslutningar.

import { prisma } from "@/lib/prisma";
import { isPremiumUser } from "@/lib/entitlements";

function readCap(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Gratisgrupp: skaparen + 2 till. Env-styrt så nivån kan kalibreras utan deploy. */
export const FREE_GROUP_MAX_MEMBERS = readCap(process.env.NW_FREE_GROUP_MAX_MEMBERS, 3);

/**
 * Premiumgrupp. Inte "obegränsat" — recs-pipelinen läser varje medlems profil
 * och watchlist (lib/unifiedRecs), så en grupp på 200 skulle bli en tung query
 * och en oanvändbar OR-union av streamingtjänster. 20 är rikligt för ett
 * sällskap och håller pipelinen frisk.
 */
export const PREMIUM_GROUP_MAX_MEMBERS = readCap(process.env.NW_PREMIUM_GROUP_MAX_MEMBERS, 20);

export type GroupCapacity = {
  /** Max antal medlemmar gruppen får ha. */
  max: number;
  /** Nuvarande antal medlemmar. */
  count: number;
  /** True om ingen till får plats. */
  isFull: boolean;
  /** Om taket beror på att skaparen saknar premium (styr om vi visar upsell). */
  limitedByFreePlan: boolean;
};

/**
 * Läser gruppens kapacitet. Kastar aldrig på saknad grupp — anroparen har
 * redan slagit upp den och äger 404:an.
 */
export async function getGroupCapacity(groupCode: string): Promise<GroupCapacity> {
  const [group, count] = await Promise.all([
    prisma.group.findUnique({ where: { code: groupCode }, select: { createdBy: true } }),
    prisma.groupMember.count({ where: { groupCode } }),
  ]);

  const ownerIsPremium = group?.createdBy ? await isPremiumUser(group.createdBy) : false;
  const max = ownerIsPremium ? PREMIUM_GROUP_MAX_MEMBERS : FREE_GROUP_MAX_MEMBERS;

  return {
    max,
    count,
    isFull: count >= max,
    limitedByFreePlan: !ownerIsPremium,
  };
}

/**
 * Får `userId` gå med i gruppen? Redan medlem = alltid ja (upsert:arna i
 * join/invite är idempotenta och ska inte börja neka den som klickar två
 * gånger, eller den som redan sitter i en full grupp).
 */
export async function canJoinGroup(
  groupCode: string,
  userId: string
): Promise<{ allowed: true } | { allowed: false; capacity: GroupCapacity; message: string }> {
  const existing = await prisma.groupMember.findUnique({
    where: { groupCode_userId: { groupCode, userId } },
    select: { userId: true },
  });
  if (existing) return { allowed: true };

  const capacity = await getGroupCapacity(groupCode);
  if (!capacity.isFull) return { allowed: true };

  return { allowed: false, capacity, message: groupFullMessage(capacity) };
}

/** Enhetlig text så kod- och inbjudningsflödet säger exakt samma sak. */
export function groupFullMessage(capacity: GroupCapacity): string {
  return capacity.limitedByFreePlan
    ? `Gruppen är full (${capacity.max} personer). Med Premium kan den som skapade gruppen bjuda in upp till ${PREMIUM_GROUP_MAX_MEMBERS}.`
    : `Gruppen är full (${capacity.max} personer).`;
}
