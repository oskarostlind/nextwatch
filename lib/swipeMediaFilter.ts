// Delad typ/validering för film/serie-filter i swipe (solo + grupp).
//
// Solo-filtret bodde tidigare i localStorage men ligger nu på
// Profile.swipeMediaFilter (sätts under /profile, läses server-side i
// computeUnifiedRecs). localStorage-nyckeln finns kvar enbart för att kunna
// migrera befintliga användares val en sista gång — se lib/swipeSettingsStore.ts.

export type SwipeMediaFilter = "movie" | "tv" | "both";

export const SWIPE_MEDIA_FILTER_DEFAULT: SwipeMediaFilter = "both";

const LEGACY_SOLO_STORAGE_KEY = "nw_swipe_media";

export function isValidSwipeMediaFilter(v: unknown): v is SwipeMediaFilter {
  return v === "movie" || v === "tv" || v === "both";
}

export function normalizeSwipeMediaFilter(v: unknown): SwipeMediaFilter {
  return isValidSwipeMediaFilter(v) ? v : SWIPE_MEDIA_FILTER_DEFAULT;
}

export function swipeMediaFilterLabel(f: SwipeMediaFilter): string {
  switch (f) {
    case "movie":
      return "Film";
    case "tv":
      return "Serier";
    case "both":
      return "Film & serier";
  }
}

/** Kort etikett för gruppfältet / GroupBar. */
/**
 * Nyckel i stället för färdig text — modulen har ingen locale. Ytorna slår upp
 * swipe.filterMovie / swipe.filterTv. null = inget chip ska visas ("båda").
 */
export function swipeMediaFilterShortLabelKey(
  f: SwipeMediaFilter
): "filterMovie" | "filterTv" | null {
  if (f === "movie") return "filterMovie";
  if (f === "tv") return "filterTv";
  return null;
}

/**
 * Läser ett ev. kvarvarande localStorage-filter från tiden före DB-flytten.
 * Null när inget finns — till skillnad från förr går default inte att skilja
 * från "aldrig satt", och migreringen ska bara röra faktiska val.
 */
export function readLegacySoloSwipeMediaFilter(): SwipeMediaFilter | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(LEGACY_SOLO_STORAGE_KEY);
    return isValidSwipeMediaFilter(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearLegacySoloSwipeMediaFilter(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_SOLO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
