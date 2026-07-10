import {
  mapUnifiedItems,
  readGroupCodeFromCookie,
  type SwipeCard,
} from "@/lib/swipeDeck";
import { injectAdCards } from "@/lib/ads";
import {
  readSoloSwipeMediaFilter,
  writeSoloSwipeMediaFilter,
  type SwipeMediaFilter,
} from "@/lib/swipeMediaFilter";

export const PREFETCH_MIN_CARDS = 10;

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

let soloState = emptySolo();
let soloMediaFilter: SwipeMediaFilter = "both";
let soloMediaFilterReady = false;
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

export function getGroupDeckSnapshot(code: string): GroupDeckState {
  return groupDecks[code.toUpperCase()] ?? EMPTY_GROUP;
}

export function getSoloSwipeMediaFilter(): SwipeMediaFilter {
  ensureSoloMediaFilterLoaded();
  return soloMediaFilter;
}

function ensureSoloMediaFilterLoaded() {
  if (soloMediaFilterReady) return;
  soloMediaFilter = readSoloSwipeMediaFilter();
  soloMediaFilterReady = true;
}

export function setSoloSwipeMediaFilter(filter: SwipeMediaFilter) {
  ensureSoloMediaFilterLoaded();
  if (filter === soloMediaFilter) return;
  soloMediaFilter = filter;
  writeSoloSwipeMediaFilter(filter);
  soloState = { ...emptySolo(), mediaFilter: filter };
  emit();
  void loadSoloPage(1, true);
}

function soloRecsUrl(page: number): string {
  const params = new URLSearchParams({ page: String(page) });
  if (soloMediaFilter !== "both") params.set("media", soloMediaFilter);
  return `/api/recs/unified?${params.toString()}`;
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
  ensureSoloMediaFilterLoaded();
  soloLoadInFlight = true;
  if (replace) {
    patchSolo({
      loading: soloState.cards.length === 0,
      error: null,
    });
  }
  try {
    const res = await fetch(soloRecsUrl(targetPage), { cache: "no-store" });
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
      cards: replace ? mapped : [...soloState.cards, ...mapped],
      page: targetPage,
      hasMore: data.items.length > 0,
      loading: false,
      error: null,
      mode: data.mode,
      group: data.group,
      mediaFilter: data.mediaFilter ?? soloMediaFilter,
      ready: true,
    };
    emit();
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

export async function ensureSoloDeck(opts?: { force?: boolean }) {
  ensureSoloMediaFilterLoaded();
  const force = opts?.force ?? false;
  const s = soloState;
  if (!force && s.ready && s.cards.length > 0 && s.mediaFilter === soloMediaFilter) {
    if (backgroundPrefetchEnabled && s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
      await maybePrefetchSoloPages();
    }
    return;
  }
  if (!force && s.ready && s.loading) return;
  await loadSoloPage(1, true);
}

export async function retrySoloDeck() {
  ensureSoloMediaFilterLoaded();
  soloState = { ...emptySolo(), mediaFilter: soloMediaFilter };
  emit();
  await loadSoloPage(1, true);
}

export function popSoloCard() {
  soloState = { ...soloState, cards: soloState.cards.slice(1) };
  emit();
  if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
}

export function unshiftSoloCard(card: SwipeCard) {
  soloState = { ...soloState, cards: [card, ...soloState.cards] };
  emit();
}

export function updateSoloCards(fn: (cards: SwipeCard[]) => SwipeCard[]) {
  soloState = { ...soloState, cards: fn(soloState.cards) };
  emit();
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
  ensureSoloMediaFilterLoaded();
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