// Delad typ/validering för film/serie-filter i swipe (solo + grupp).

export type SwipeMediaFilter = "movie" | "tv" | "both";

export const SWIPE_MEDIA_FILTER_DEFAULT: SwipeMediaFilter = "both";

const SOLO_STORAGE_KEY = "nw_swipe_media";

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
export function swipeMediaFilterShortLabel(f: SwipeMediaFilter): string | null {
  if (f === "movie") return "Film";
  if (f === "tv") return "Serier";
  return null;
}

export function readSoloSwipeMediaFilter(): SwipeMediaFilter {
  if (typeof window === "undefined") return SWIPE_MEDIA_FILTER_DEFAULT;
  try {
    const v = localStorage.getItem(SOLO_STORAGE_KEY);
    return normalizeSwipeMediaFilter(v);
  } catch {
    return SWIPE_MEDIA_FILTER_DEFAULT;
  }
}

export function writeSoloSwipeMediaFilter(f: SwipeMediaFilter): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SOLO_STORAGE_KEY, f);
  } catch {
    /* ignore */
  }
}
