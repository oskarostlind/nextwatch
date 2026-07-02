export type SwipeMediaType = "movie" | "tv";

export type SwipeCard = {
  id: string;
  tmdbId: number;
  mediaType: SwipeMediaType;
  title: string;
  year: string | null;
  poster: string | null;
  overview?: string | null;
  rating?: number | null;
};

const HIDE_KEY = "nw_disliked_until";
const SEEN_KEY = "nw_seen_ids";

export function readGroupCodeFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)nw_group=([^;]*)/);
  if (!m?.[1]) return null;
  try {
    const v = decodeURIComponent(m[1]).trim();
    return v ? v.toUpperCase() : null;
  } catch {
    const v = m[1].trim();
    return v ? v.toUpperCase() : null;
  }
}

function readHideMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === "object" ? (obj as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function isHidden(tmdbId: number): boolean {
  const map = readHideMap();
  const until = map[String(tmdbId)];
  return typeof until === "number" && Date.now() < until;
}

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function filterSwipeCards(cards: SwipeCard[]): SwipeCard[] {
  const seen = readSeen();
  return cards.filter((c) => !isHidden(c.tmdbId) && !seen.has(c.id));
}

type UnifiedItem = {
  id: number;
  tmdbType: SwipeMediaType;
  title: string;
  year?: string;
  poster_path?: string | null;
  vote_average?: number;
};

export function mapUnifiedItems(items: UnifiedItem[]): SwipeCard[] {
  return filterSwipeCards(
    items
      .map((it): SwipeCard | null => {
        const poster = it.poster_path
          ? it.poster_path.startsWith("http")
            ? it.poster_path
            : `https://image.tmdb.org/t/p/w780${it.poster_path}`
          : null;
        return {
          id: `${it.tmdbType}_${it.id}`,
          tmdbId: it.id,
          mediaType: it.tmdbType,
          title: it.title,
          year: it.year ?? null,
          poster,
          overview: null,
          rating: typeof it.vote_average === "number" ? it.vote_average : null,
        };
      })
      .filter((v): v is SwipeCard => Boolean(v))
  );
}

type GroupRecItem = {
  type: "rec";
  tmdbId: number;
  mediaType: SwipeMediaType;
  title: string;
};

export function mapGroupFeed(
  feed: Array<GroupRecItem | { type: string }>
): SwipeCard[] {
  return feed
    .filter((x): x is GroupRecItem => x.type === "rec")
    .map((it) => ({
      id: `${it.mediaType}_${it.tmdbId}`,
      tmdbId: it.tmdbId,
      mediaType: it.mediaType,
      title: it.title,
      year: null,
      poster: null,
      overview: null,
      rating: null,
    }));
}
