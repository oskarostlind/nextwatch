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

/** Procentandel som styr den AUTOMATISKA (ej anpassade) matchtröskeln. */
export const DEFAULT_MATCH_PERCENT = 60;

/** En match kräver alltid minst 2 personer, oavsett gruppstorlek. */
export const MIN_MATCH_THRESHOLD = 2;
/** Skyddsgräns för lagrat värde — det faktiska taket är alltid gruppens storlek, se groupMatchNeed. */
export const MAX_MATCH_THRESHOLD = 500;

export type GroupSettings = {
  /** Tom = automatik (union av medlemmarnas gillade genrer). */
  favoriteGenres: string[];
  /** Tom = automatik (union av ogillade minus någons gillade). */
  dislikedGenres: string[];
  /** Tjänste-namn (labels, t.ex. "Netflix"). Tom = automatik (OR-union av medlemmarna). */
  providers: string[];
  /** null = automatik (yngsta medlemmens SE-certifiering). */
  maxCert: GroupCert | null;
  /**
   * Antal PERSONER (≥2) som måste gilla samma titel för en match.
   * null = automatik: 60 % av gruppens aktuella storlek (min 2).
   * Klamras alltid till aktuell gruppstorlek vid matchberäkning — se groupMatchNeed.
   */
  matchThreshold: number | null;
  /** Vilken typ av titlar gruppen swipar (standard: båda). */
  mediaFilter: SwipeMediaFilter;
};

export function isValidCert(v: unknown): v is GroupCert {
  return typeof v === "string" && (GROUP_CERTS as readonly string[]).includes(v);
}

export function isValidThreshold(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= MIN_MATCH_THRESHOLD &&
    v <= MAX_MATCH_THRESHOLD
  );
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
 *
 * `matchThresholdCount` är antalet PERSONER gruppens skapare valt (kugghjulet).
 * Det klamras alltid till gruppens aktuella storlek, så en grupp som krymper
 * (medlemmar lämnar) aldrig kan kräva fler likes än det finns medlemmar kvar.
 * null/ogiltigt värde = automatik: 60 % av aktuell storlek (min 2).
 *
 * OBS: fältet lagrade tidigare en PROCENTANDEL (1–100). Vid övergången till
 * personantal (2026-07-29) hade ingen grupp i produktionsdatabasen ett
 * anpassat värde satt, så ingen datamigrering av gamla värden krävdes.
 */
export function groupMatchNeed(size: number, matchThresholdCount?: number | null): number {
  if (isValidThreshold(matchThresholdCount)) {
    return Math.max(MIN_MATCH_THRESHOLD, Math.min(size, matchThresholdCount));
  }
  return Math.max(MIN_MATCH_THRESHOLD, Math.ceil((size * DEFAULT_MATCH_PERCENT) / 100));
}
