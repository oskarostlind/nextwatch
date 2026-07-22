import {
  filterSwipeCards,
  mapUnifiedItems,
  readGroupCodeFromCookie,
  type SwipeCard,
} from "@/lib/swipeDeck";
import { injectAdCards } from "@/lib/ads";
import { type SwipeMediaFilter } from "@/lib/swipeMediaFilter";
import { getCached, removeCached, setCached } from "@/lib/clientCache";

export const PREFETCH_MIN_CARDS = 10;

/**
 * Kortleken sparas mellan appstarter. Utan den kördes hela recs-pipelinen om
 * från noll vid varje kallstart — mätt till ~4 s mot ett riktigt konto
 * (discover-sidor, smakmodell, MMR) — för att i praktiken visa samma lek som
 * förra gången. I native-appen är varje öppning en kallstart, så det var den
 * enskilt dyraste väntan i appen.
 */
const DECK_CACHE_KEY = "solo_deck";
const DECK_TTL_MS = 24 * 60 * 60 * 1000;
/** Skrivningen debouncas så snabb swipning inte hamrar localStorage. */
const DECK_WRITE_DEBOUNCE_MS = 500;

type PersistedDeck = {
  cards: SwipeCard[];
  nextTmdbPage: number;
  mediaFilter: SwipeMediaFilter;
};

let deckWriteTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoloDeckSoon() {
  if (typeof window === "undefined") return;
  if (deckWriteTimer) clearTimeout(deckWriteTimer);
  deckWriteTimer = setTimeout(() => {
    deckWriteTimer = null;
    const s = soloState;
    // Annonskort hör till en session och ska inte återuppstå ur cachen.
    const cards = s.cards.filter((c) => c.kind !== "ad");
    if (cards.length === 0) {
      removeCached(DECK_CACHE_KEY);
      return;
    }
    const payload: PersistedDeck = {
      cards,
      nextTmdbPage: s.nextTmdbPage,
      mediaFilter: s.mediaFilter,
    };
    setCached(DECK_CACHE_KEY, payload, DECK_TTL_MS);
  }, DECK_WRITE_DEBOUNCE_MS);
}

function clearPersistedSoloDeck() {
  if (deckWriteTimer) {
    clearTimeout(deckWriteTimer);
    deckWriteTimer = null;
  }
  removeCached(DECK_CACHE_KEY);
}

/**
 * Läser sparad lek vid modulinit — inte i en effekt. En effekt hade gett en
 * bildruta skelett innan korten dök upp, vilket är precis den blinkning det
 * här ska ta bort.
 */
function hydrateSoloDeck(): SoloDeckState {
  const base = emptySolo();
  if (typeof window === "undefined") return base;
  const saved = getCached<PersistedDeck>(DECK_CACHE_KEY);
  if (!saved || !Array.isArray(saved.cards) || saved.cards.length === 0) return base;

  // Allt som swipats sedan leken sparades faller bort här (seen-listan har
  // 24 h TTL sedan regressionsfixen), så ett kort man just gjort sig av med
  // kan inte komma tillbaka.
  const cards = filterSwipeCards(saved.cards);
  if (cards.length === 0) return base;

  return {
    ...base,
    cards,
    nextTmdbPage: saved.nextTmdbPage > 0 ? saved.nextTmdbPage : 1,
    mediaFilter: saved.mediaFilter ?? base.mediaFilter,
    ready: true,
  };
}

/** Slår ihop utan dubbletter — hydrerad lek och färskt svar kan överlappa. */
function appendUnique(existing: SwipeCard[], incoming: SwipeCard[]): SwipeCard[] {
  const seen = new Set(existing.map((c) => c.id));
  const extra = incoming.filter((c) => !seen.has(c.id));
  return extra.length === 0 ? existing : [...existing, ...extra];
}

// Sätts av klienten (SwipeDeckPreloader) efter att premium-status hämtats.
// Endast gratisanvändare med aktiverad annons-flagga får true.
let adsEnabled = false;
export function setSwipeAdsEnabled(enabled: boolean) {
  adsEnabled = enabled;
}
function withAdsMaybe(titles: SwipeCard[], pageKey: string | number): SwipeCard[] {
  return adsEnabled ? injectAdCards(titles, pageKey) : titles;
}

type GroupInfo = { code: string; strictProviders: boolean };

export type SoloDeckState = {
  cards: SwipeCard[];
  page: number;
  /**
   * TMDB-sida nästa hämtning börjar på, från serverns `nextTmdbPage`. Behövs
   * eftersom skanningsdjupet är rörligt: servern kan ha grävt 3 eller 40 sidor
   * för att fylla den här leken, och `page + 1` skulle då antingen hoppa över
   * titlar eller ge dubbletter.
   */
  nextTmdbPage: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  mode: "group" | "individual";
  group: GroupInfo | null;
  mediaFilter: SwipeMediaFilter;
  ready: boolean;
};

export type GroupDeckState = {
  cards: SwipeCard[];
  loading: boolean;
  error: string | null;
  mediaFilter: SwipeMediaFilter;
  ready: boolean;
};

const emptySolo = (): SoloDeckState => ({
  cards: [],
  page: 1,
  nextTmdbPage: 1,
  hasMore: true,
  loading: false,
  error: null,
  mode: "individual",
  group: null,
  mediaFilter: "both",
  ready: false,
});

const emptyGroup = (): GroupDeckState => ({
  cards: [],
  loading: false,
  error: null,
  mediaFilter: "both",
  ready: false,
});

const EMPTY_GROUP: GroupDeckState = {
  cards: [],
  loading: false,
  error: null,
  mediaFilter: "both",
  ready: false,
};

let soloState = hydrateSoloDeck();
let groupDecks: Record<string, GroupDeckState> = {};
let soloLoadInFlight = false;
const groupLoadInFlight = new Set<string>();
let backgroundPrefetchEnabled = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeSwipeDeck(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSoloDeckSnapshot(): SoloDeckState {
  return soloState;
}

/**
 * Server-snapshot för useSyncExternalStore. Måste vara en STABIL referens och
 * matcha det servern renderade — annars ser React hydreringen som en mismatch,
 * eftersom klientens snapshot redan innehåller den cachade leken. React gör om
 * renderingen med klientens snapshot direkt efter hydreringen, så korten dyker
 * upp ändå: vinsten är att nätverket hoppas över, inte en bildruta.
 */
const SERVER_SOLO_SNAPSHOT: SoloDeckState = emptySolo();
export function getSoloDeckServerSnapshot(): SoloDeckState {
  return SERVER_SOLO_SNAPSHOT;
}

export function getGroupDeckSnapshot(code: string): GroupDeckState {
  return groupDecks[code.toUpperCase()] ?? EMPTY_GROUP;
}

/**
 * Kastar kortleken och hämtar om den. Anropas när film/serie-filtret ändrats i
 * profilen — filtret ägs server-side (Profile.swipeMediaFilter), så däcket kan
 * inte längre lita på sina redan hämtade kort.
 */
export function applySoloMediaFilterChange(filter: SwipeMediaFilter) {
  if (filter === soloState.mediaFilter && soloState.ready) return;
  clearPersistedSoloDeck(); // sparad lek har fel medietyp nu
  soloState = { ...emptySolo(), mediaFilter: filter };
  emit();
  void loadSoloPage(1, true);
}

function soloRecsUrl(page: number, fromTmdbPage?: number): string {
  const from = fromTmdbPage && fromTmdbPage > 1 ? `&from=${fromTmdbPage}` : "";
  return `/api/recs/unified?page=${page}${from}`;
}

export function setSwipeBackgroundPrefetch(enabled: boolean) {
  backgroundPrefetchEnabled = enabled;
  if (enabled) void maybePrefetchSoloPages();
}

function patchSolo(patch: Partial<SoloDeckState>) {
  soloState = { ...soloState, ...patch };
  emit();
}

function setGroupDeck(code: string, patch: Partial<GroupDeckState>) {
  const key = code.toUpperCase();
  groupDecks = {
    ...groupDecks,
    [key]: { ...(groupDecks[key] ?? emptyGroup()), ...patch },
  };
  emit();
}

async function loadSoloPage(targetPage: number, replace: boolean) {
  if (soloLoadInFlight) return;
  soloLoadInFlight = true;
  // replace = börja om från TMDB-sida 1; annars fortsätt där servern slutade.
  const fromTmdbPage = replace ? undefined : soloState.nextTmdbPage;
  if (replace) {
    patchSolo({
      loading: soloState.cards.length === 0,
      error: null,
    });
  }
  try {
    const res = await fetch(soloRecsUrl(targetPage, fromTmdbPage), { cache: "no-store" });
    if (!res.ok) {
      if (replace) patchSolo({ error: "Kunde inte hämta förslag. Försök igen.", hasMore: false, loading: false });
      return;
    }
    const data = (await res.json()) as
      | {
          ok: true;
          mode: "group" | "individual";
          group: GroupInfo | null;
          mediaFilter?: SwipeMediaFilter;
          nextTmdbPage?: number;
          items: Parameters<typeof mapUnifiedItems>[0];
        }
      | { ok: false; message?: string };

    if (!("ok" in data) || !data.ok) {
      if (replace) {
        patchSolo({
          error: ("message" in data && data.message) || "Kunde inte hämta förslag.",
          hasMore: false,
          loading: false,
        });
      }
      return;
    }

    const mapped = withAdsMaybe(mapUnifiedItems(data.items), targetPage);
    soloState = {
      ...soloState,
      cards: replace ? mapped : appendUnique(soloState.cards, mapped),
      page: targetPage,
      nextTmdbPage: data.nextTmdbPage ?? soloState.nextTmdbPage + 1,
      // Servern gräver nu upp till 40 TMDB-sidor innan den ger upp, så en tom
      // sida betyder att katalogen faktiskt är slut — inte att fönstret tog slut.
      hasMore: data.items.length > 0 && (data.nextTmdbPage ?? 1) <= 500,
      loading: false,
      error: null,
      mode: data.mode,
      group: data.group,
      // Servern rapporterar vilket filter den faktiskt använde (från profilen).
      mediaFilter: data.mediaFilter ?? soloState.mediaFilter,
      ready: true,
    };
    emit();
    persistSoloDeckSoon();
    if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
  } catch {
    if (replace) {
      patchSolo({ error: "Nätverksfel. Kontrollera anslutningen.", hasMore: false, loading: false });
    }
  } finally {
    soloLoadInFlight = false;
  }
}

async function maybePrefetchSoloPages() {
  if (!backgroundPrefetchEnabled) return;
  const s = soloState;
  if (!s.ready || s.loading || soloLoadInFlight) return;
  if (s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
    await loadSoloPage(s.page + 1, false);
  }
}

/** Sant tills den hydrerade leken fyllts på en gång. */
let hydratedNeedsRevalidate = soloState.ready && soloState.cards.length > 0;

export async function ensureSoloDeck(opts?: { force?: boolean }) {
  const force = opts?.force ?? false;
  const s = soloState;
  if (!force && s.ready && s.cards.length > 0) {
    // Leken kom ur cachen: visa den direkt, men fyll på i bakgrunden så urvalet
    // inte fastnar på gårdagens kort. `replace = false` gör att påfyllningen
    // läggs underifrån — toppkortet byts aldrig under fingret.
    if (hydratedNeedsRevalidate) {
      hydratedNeedsRevalidate = false;
      void loadSoloPage(s.page + 1, false);
      return;
    }
    if (backgroundPrefetchEnabled && s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
      await maybePrefetchSoloPages();
    }
    return;
  }
  if (!force && s.ready && s.loading) return;
  await loadSoloPage(1, true);
}

export async function retrySoloDeck() {
  clearPersistedSoloDeck();
  hydratedNeedsRevalidate = false;
  soloState = { ...emptySolo(), mediaFilter: soloState.mediaFilter };
  emit();
  await loadSoloPage(1, true);
}

export function popSoloCard() {
  soloState = { ...soloState, cards: soloState.cards.slice(1) };
  emit();
  persistSoloDeckSoon();
  if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
}

export function unshiftSoloCard(card: SwipeCard) {
  soloState = { ...soloState, cards: [card, ...soloState.cards] };
  emit();
  persistSoloDeckSoon();
}

export function updateSoloCards(fn: (cards: SwipeCard[]) => SwipeCard[]) {
  soloState = { ...soloState, cards: fn(soloState.cards) };
  emit();
  persistSoloDeckSoon();
}

export async function ensureGroupDeck(code: string, opts?: { force?: boolean }) {
  const key = code.toUpperCase();
  if (!key) return;
  const existing = groupDecks[key];
  if (!opts?.force && existing?.ready && existing.cards.length > 0) return;
  if (groupLoadInFlight.has(key)) return;

  groupLoadInFlight.add(key);
  setGroupDeck(key, { loading: !(existing?.cards.length), error: null });

  try {
    // Gruppdäcket kör samma recommender som solo, men i gruppläge (?group=CODE):
    // providers unioneras och smakmodellen aggregeras över alla medlemmar.
    const res = await fetch(`/api/recs/unified?group=${encodeURIComponent(key)}&page=1`, {
      cache: "no-store",
    });
    const data = (await res.json()) as
      | { ok: true; mediaFilter?: SwipeMediaFilter; items: Parameters<typeof mapUnifiedItems>[0] }
      | { ok: false; message?: string };

    if (!("ok" in data) || !data.ok) {
      setGroupDeck(key, {
        loading: false,
        error: ("message" in data && data.message) || "Kunde inte hämta gruppförslag.",
        ready: true,
      });
      return;
    }

    setGroupDeck(key, {
      cards: mapUnifiedItems(data.items),
      loading: false,
      error: null,
      mediaFilter: data.mediaFilter ?? "both",
      ready: true,
    });
  } catch {
    setGroupDeck(key, {
      loading: false,
      error: "Nätverksfel.",
      ready: true,
    });
  } finally {
    groupLoadInFlight.delete(key);
  }
}

export function popGroupCard(code: string) {
  const key = code.toUpperCase();
  const cur = groupDecks[key] ?? emptyGroup();
  setGroupDeck(key, { cards: cur.cards.slice(1) });
}

export function unshiftGroupCard(code: string, card: SwipeCard) {
  const key = code.toUpperCase();
  const cur = groupDecks[key] ?? emptyGroup();
  setGroupDeck(key, { cards: [card, ...cur.cards] });
}

export function updateGroupCards(code: string, fn: (cards: SwipeCard[]) => SwipeCard[]) {
  const key = code.toUpperCase();
  const cur = groupDecks[key] ?? emptyGroup();
  setGroupDeck(key, { cards: fn(cur.cards) });
}

/** Förladda första sidan när appen startar — körs in idle time, inte på kritisk väg. */
export function preloadSwipeDecksIdle() {
  const run = () => {
    void ensureSoloDeck();
    const code = readGroupCodeFromCookie();
    if (code) void ensureGroupDeck(code);
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 500);
  }
}

export function preloadGroupDeckIfJoined() {
  const code = readGroupCodeFromCookie();
  if (code) void ensureGroupDeck(code);
}