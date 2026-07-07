export type SwipeMediaType = "movie" | "tv";

export type SwipeCard = {
  id: string;
  /** "title" (default) = riktig film/serie, "ad" = annonskort (gratisanvändare). */
  kind?: "title" | "ad";
  tmdbId: number;
  mediaType: SwipeMediaType;
  title: string;
  year: string | null;
  poster: string | null;
  overview?: string | null;
  rating?: number | null;
  /**
   * Direktlänk till streamingtjänst ("Kolla nu").
   * undefined = inte hämtad än, null = hämtad men ingen tjänst tillgänglig.
   */
  watchUrl?: string | null;
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

function writeHideMap(map: Record<string, number>) {
  localStorage.setItem(HIDE_KEY, JSON.stringify(map));
}

export function markSeen(id: string) {
  const s = readSeen();
  s.add(id);
  writeSeen(s);
}

export function unmarkSeen(id: string) {
  const s = readSeen();
  s.delete(id);
  writeSeen(s);
}

export function hideFor7Days(tmdbId: number) {
  const map = readHideMap();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  map[String(tmdbId)] = Date.now() + sevenDays;
  writeHideMap(map);
}

export function unhide(tmdbId: number) {
  const map = readHideMap();
  delete map[String(tmdbId)];
  writeHideMap(map);
}

function writeSeen(seen: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
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