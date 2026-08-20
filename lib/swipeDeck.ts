// Type-only import: raderas vid kompilering, så den serverside-tunga tasteModel
// (TMDB-anrop, tokens) följer inte med in i klientbundeln.
import type { MatchEvidence } from "@/lib/tasteModel";
import type { Trailer } from "@/lib/tmdbVideos";

export type { MatchEvidence, Trailer };

export type SwipeMediaType = "movie" | "tv";

export type SwipeProvider = {
  provider_name: string;
  logo_path: string | null;
};

export type SwipeProviders = {
  /** TMDB:s egen watch-sida — fallback när vi saknar direktlänk till tjänsten. */
  link?: string;
  flatrate?: SwipeProvider[];
  rent?: SwipeProvider[];
  buy?: SwipeProvider[];
};

export type SwipeCard = {
  id: string;
  /**
   * "title" (default) = riktig film/serie, "ad" = annonskort (gratisanvändare),
   * "upcoming" = ännu osläppt titel med "Kommer snart"-märke (se
   * lib/upcomingTitles.ts). "upcoming" har en riktig tmdbId och beter sig som en
   * titel överallt utom i UI:t — bara "ad" saknar innehåll.
   */
  kind?: "title" | "ad" | "upcoming";
  tmdbId: number;
  mediaType: SwipeMediaType;
  title: string;
  year: string | null;
  poster: string | null;
  backdrop?: string | null;
  genres?: string[];
  overview?: string | null;
  rating?: number | null;
  /**
   * Streamingproviders för regionen.
   * undefined = inte hämtad än, null = hämtad men ingen data.
   *
   * "Kolla nu"-länken räknas ut vid rendering (lib/watchLinks.ts) i stället för
   * att cachas här — den beror på Profile.showPaidOptions, som användaren kan
   * ändra medan kortleken redan ligger i minnet.
   */
  providers?: SwipeProviders | null;
  /**
   * Premiärdatum som ISO-sträng (YYYY-MM-DD). Satt enbart på kind === "upcoming"
   * och skickas med till /api/watchlist/like, som gör liken till en bevakning.
   */
  releaseDate?: string | null;
  /** Varför titeln matchar din smak (visas ibland på kortet). */
  reasons?: string[];
  /** Satt när titeln är en toppmatch — solo-swipen firar liken med matchrutan. */
  topMatch?: { evidence: MatchEvidence[] };
  /**
   * Trailer, hämtad tillsammans med details.
   * undefined = inte hämtad än, null = titeln saknar trailer (vanligt).
   */
  trailer?: Trailer | null;
};

const HIDE_KEY = "nw_disliked_until";
/**
 * Gamla nyckeln: en ren `string[]` som växte för alltid. Den läses inte längre
 * (se SEEN_KEY nedan) och städas bort vid första skrivningen.
 */
const LEGACY_SEEN_KEY = "nw_seen_ids";
const SEEN_KEY = "nw_seen_until";

/**
 * Hur länge en swipead titel hålls borta LOKALT.
 *
 * Rot-orsaken till "Slut på förslag nu" (2026-07-22): den gamla listan hade
 * varken TTL eller tak. Servern återvinner titlar efter Profile.recycleAfterDays
 * (14 som standard) och levererade 50 kandidater — men klienten filtrerade bort
 * exakt dem, eftersom de låg kvar i localStorage sedan förra gången. Mätt mot
 * produktionsdata för de två mest aktiva kontona: 34 av 50 respektive 50 av 50
 * korten försvann i klientfiltret, samtliga swipade för 14–19 dagar sedan. Alltså
 * precis de titlar servern medvetet återvunnit. Klientlistan annullerade hela
 * återvinningen, och ju mer man swipade desto värre blev det.
 *
 * Listan är nu bara ett kapplöpningsskydd: den hindrar ett kort från att komma
 * tillbaka innan swipens POST hunnit landa och servern hunnit se den. Vilka
 * titlar som ska undvikas på riktigt äger servern (watchKeys i lib/unifiedRecs),
 * som har både betygen och watchlisten. Ett dygn räcker för kapplöpningen och
 * kan aldrig överleva serverns återvinningsfönster.
 */
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

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
  const m = readSeenMap();
  m[id] = Date.now() + SEEN_TTL_MS;
  writeSeenMap(m);
}

export function unmarkSeen(id: string) {
  const m = readSeenMap();
  delete m[id];
  writeSeenMap(m);
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

function writeSeenMap(map: Record<string, number>) {
  const now = Date.now();
  const pruned: Record<string, number> = {};
  for (const [id, until] of Object.entries(map)) {
    if (typeof until === "number" && until > now) pruned[id] = until;
  }
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(pruned));
    // Den gamla listan kan ha vuxit till tiotusentals rader; bli av med den.
    localStorage.removeItem(LEGACY_SEEN_KEY);
  } catch {
    /* full quota e.d. — filtret är bara ett kapplöpningsskydd, inte kritiskt */
  }
}

function readSeenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    return obj as Record<string, number>;
  } catch {
    return {};
  }
}

function isHidden(tmdbId: number): boolean {
  const map = readHideMap();
  const until = map[String(tmdbId)];
  return typeof until === "number" && Date.now() < until;
}

/** Icke-utgångna id:n. Den gamla `nw_seen_ids`-listan läses medvetet inte. */
function readSeen(): Set<string> {
  const now = Date.now();
  const out = new Set<string>();
  for (const [id, until] of Object.entries(readSeenMap())) {
    if (typeof until === "number" && until > now) out.add(id);
  }
  return out;
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
  reasons?: string[];
  topMatch?: { evidence: MatchEvidence[] };
  /** Satt av "Kommer snart"-inflätningen i /api/recs/unified (bara solo). */
  kind?: "title" | "upcoming";
  releaseDate?: string | null;
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
          ...(it.kind === "upcoming"
            ? { kind: "upcoming" as const, releaseDate: it.releaseDate ?? null }
            : {}),
          ...(it.reasons && it.reasons.length > 0 ? { reasons: it.reasons } : {}),
          ...(it.topMatch ? { topMatch: it.topMatch } : {}),
        };
      })
      .filter((v): v is SwipeCard => Boolean(v))
  );
}