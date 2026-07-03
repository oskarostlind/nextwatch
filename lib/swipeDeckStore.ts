import {
  mapUnifiedItems,
  readGroupCodeFromCookie,
  type SwipeCard,
} from "@/lib/swipeDeck";

export const PREFETCH_MIN_CARDS = 10;

type GroupInfo = { code: string; strictProviders: boolean };

export type SoloDeckState = {
  cards: SwipeCard[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  mode: "group" | "individual";
  group: GroupInfo | null;
  ready: boolean;
};

export type GroupDeckState = {
  cards: SwipeCard[];
  loading: boolean;
  error: string | null;
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
  ready: false,
});

const emptyGroup = (): GroupDeckState => ({
  cards: [],
  loading: false,
  error: null,
  ready: false,
});

const EMPTY_GROUP: GroupDeckState = {
  cards: [],
  loading: false,
  error: null,
  ready: false,
};

let soloState = emptySolo();
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
  if (replace) {
    patchSolo({
      loading: soloState.cards.length === 0,
      error: null,
    });
  }
  try {
    const res = await fetch(`/api/recs/unified?page=${targetPage}`, { cache: "no-store" });
    if (!res.ok) {
      if (replace) patchSolo({ error: "Kunde inte hämta förslag. Försök igen.", hasMore: false, loading: false });
      return;
    }
    const data = (await res.json()) as
      | {
          ok: true;
          mode: "group" | "individual";
          group: GroupInfo | null;
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

    const mapped = mapUnifiedItems(data.items);
    soloState = {
      ...soloState,
      cards: replace ? mapped : [...soloState.cards, ...mapped],
      page: targetPage,
      hasMore: data.items.length > 0,
      loading: false,
      error: null,
      mode: data.mode,
      group: data.group,
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
  const force = opts?.force ?? false;
  const s = soloState;
  if (!force && s.ready && s.cards.length > 0) {
    if (backgroundPrefetchEnabled && s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
      await maybePrefetchSoloPages();
    }
    return;
  }
  if (!force && s.ready && s.loading) return;
  await loadSoloPage(1, true);
}

export async function retrySoloDeck() {
  soloState = emptySolo();
  emit();
  await loadSoloPage(1, true);
}

export function popSoloCard() {
  soloState = { ...soloState, cards: soloState.cards.slice(1) };
  emit();
  if (backgroundPrefetchEnabled) void maybePrefetchSoloPages();
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
      | { ok: true; items: Parameters<typeof mapUnifiedItems>[0] }
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