// lib/i18nConfig.ts
//
// Medvetet import-fritt (samma resonemang som lib/cookies.ts): filen läses av
// middleware (edge), server components, route handlers OCH klientkomponenter.
// Så fort den drar in "next/server" eller liknande får Turbopack export-problem
// i minst en av de miljöerna. Håll den till ren TypeScript.

export const LOCALES = ["sv", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "sv";

/**
 * Språkcookien. httpOnly:false med flit — profilens språkväljare sätter den
 * direkt i klienten så att bytet slår igenom utan en serverrundresa, och
 * next-intl läser den på servern vid nästa render. Den innehåller inget
 * känsligt (bara "sv" eller "en").
 */
export const LANG_COOKIE = "nw_lang";

export const LANG_COOKIE_OPTS = {
  path: "/",
  httpOnly: false,
  sameSite: "lax" as const,
  secure: true,
  maxAge: 60 * 60 * 24 * 365,
};

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Tar emot vad som helst — "en", "EN", "en-US", "sv-SE", null — och ger ett
 * språk vi faktiskt har översättningar för. Allt okänt faller till svenska.
 */
export function normalizeLocale(value: unknown): AppLocale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

/**
 * Plockar ut bästa språk ur en Accept-Language-header. Används bara som
 * förstagångsgissning för besökare som ännu inte valt något — profilvalet
 * vinner alltid över den här.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header) return DEFAULT_LOCALE;
  const parts = header
    .split(",")
    .map((chunk) => {
      const [tag, ...params] = chunk.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? Number.parseFloat(q.split("=")[1]) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of parts) {
    const base = tag.toLowerCase().split("-")[0];
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * TMDB-språk. Region hålls avsiktligt separat: watch-providers och den svenska
 * åldersgränsen ska fortsätta filtreras på SE även när gränssnittet är på
 * engelska — annars byter rekommendationerna innehåll, inte bara språk.
 */
export function tmdbLanguage(locale: unknown): "sv-SE" | "en-US" {
  return normalizeLocale(locale) === "en" ? "en-US" : "sv-SE";
}

/** BCP47-tagg för <html lang>, Intl.DateTimeFormat, toLocaleString m.m. */
export function bcp47(locale: unknown): "sv-SE" | "en-US" {
  return normalizeLocale(locale) === "en" ? "en-US" : "sv-SE";
}
