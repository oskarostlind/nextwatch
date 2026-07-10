// Delade konstanter/hjälpare för gruppinställningar (kugghjulet).
// Används av API-routen (validering), lib/unifiedRecs.ts (overrides),
// group/match + lib/push.ts (matchtröskel) och inställnings-UI:t.
// Hålls fri från Prisma/next-imports så den kan importeras från klienten.

import { type SwipeMediaFilter } from "@/lib/swipeMediaFilter";

export type { SwipeMediaFilter };

/** Kanonisk genrelista (svenska namn, samma som profil/onboarding). */
export const GROUP_GENRES = [
  "Action", "Äventyr", "Animerat", "Komedi", "Kriminal", "Dokumentär",
  "Drama", "Fantasy", "Skräck", "Romantik", "Sci-Fi", "Thriller",
  "Mysterium", "Familj", "Historia", "Musik", "Krig", "Western",
] as const;

/** SE-åldersgränser (barntillåten → 15). null = automatik (yngsta medlemmen). */
export const GROUP_CERTS = ["0", "7", "11", "15"] as const;
export type GroupCert = (typeof GROUP_CERTS)[number];

export const DEFAULT_MATCH_THRESHOLD = 60;

export type GroupSettings = {
  /** Tom = automatik (union av medlemmarnas gillade genrer). */
  favoriteGenres: string[];
  /** Tom = automatik (union av ogillade minus någons gillade). */
  dislikedGenres: string[];
  /** Tjänste-namn (labels, t.ex. "Netflix"). Tom = automatik (OR-union av medlemmarna). */
  providers: string[];
  /** null = automatik (yngsta medlemmens SE-certifiering). */
  maxCert: GroupCert | null;
  /** Procent 1–100. null = default 60. */
  matchThreshold: number | null;
  /** Vilken typ av titlar gruppen swipar (standard: båda). */
  mediaFilter: SwipeMediaFilter;
};

export function isValidCert(v: unknown): v is GroupCert {
  return typeof v === "string" && (GROUP_CERTS as readonly string[]).includes(v);
}

export function isValidThreshold(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100;
}

export function sanitizeGenres(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const allowed = new Set<string>(GROUP_GENRES);
  const out = v.filter((g): g is string => typeof g === "string" && allowed.has(g));
  return Array.from(new Set(out));
}

/** Prisma Json-kolumn → string[] (defensivt; kolumnen ägs av oss). */
export function parseProvidersJson(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string");
}

/**
 * Antal LIKE-röster som krävs för match i en grupp.
 * Delas av app/api/group/match och lib/push.ts så tröskeln alltid är samma.
 */
export function groupMatchNeed(size: number, thresholdPercent?: number | null): number {
  const pct = isValidThreshold(thresholdPercent ?? undefined)
    ? (thresholdPercent as number)
    : DEFAULT_MATCH_THRESHOLD;
  return Math.max(2, Math.ceil((size * pct) / 100));
}
