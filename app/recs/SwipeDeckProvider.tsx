"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  mapGroupFeed,
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

type SoloDeckPatch = Partial<SoloDeckState> | ((prev: SoloDeckState) => Partial<SoloDeckState>);

type Ctx = {
  solo: SoloDeckState;
  patchSolo: (patch: SoloDeckPatch) => void;
  popSoloCard: () => void;
  updateSoloCards: (fn: (cards: SwipeCard[]) => SwipeCard[]) => void;
  ensureSoloDeck: (opts?: { force?: boolean }) => Promise<void>;
  retrySoloDeck: () => Promise<void>;
  getGroupDeck: (code: string) => GroupDeckState;
  popGroupCard: (code: string) => void;
  updateGroupCards: (code: string, fn: (cards: SwipeCard[]) => SwipeCard[]) => void;
  ensureGroupDeck: (code: string, opts?: { force?: boolean }) => Promise<void>;
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

const SwipeDeckContext = createContext<Ctx | null>(null);

export function SwipeDeckProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [solo, setSolo] = useState<SoloDeckState>(emptySolo);
  const [groupDecks, setGroupDecks] = useState<Record<string, GroupDeckState>>({});
  const soloRef = useRef(solo);
  soloRef.current = solo;
  const groupDecksRef = useRef(groupDecks);
  groupDecksRef.current = groupDecks;
  const soloLoadRef = useRef(false);
  const groupLoadRef = useRef<Set<string>>(new Set());

  const patchSolo = useCallback((patch: SoloDeckPatch) => {
    setSolo((prev) => ({
      ...prev,
      ...(typeof patch === "function" ? patch(prev) : patch),
    }));
  }, []);

  const getGroupDeck = useCallback(
    (code: string) => groupDecks[code.toUpperCase()] ?? emptyGroup(),
    [groupDecks]
  );

  const setGroupDeck = useCallback((code: string, patch: Partial<GroupDeckState>) => {
    const key = code.toUpperCase();
    setGroupDecks((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyGroup()), ...patch },
    }));
  }, []);

  const loadSoloPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (soloLoadRef.current) return;
      soloLoadRef.current = true;
      if (replace) {
        patchSolo((prev) => ({
          loading: prev.cards.length === 0,
          error: null,
        }));
      }
      try {
        const res = await fetch(`/api/recs/unified?page=${targetPage}`, { cache: "no-store" });
        if (!res.ok) {
          if (replace) patchSolo({ error: "Kunde inte hämta förslag. Försök igen.", hasMore: false });
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
            });
          }
          return;
        }

        const mapped = mapUnifiedItems(data.items);
        setSolo((prev) => {
          const cards = replace ? mapped : [...prev.cards, ...mapped];
          return {
            ...prev,
            cards,
            page: targetPage,
            hasMore: data.items.length > 0,
            loading: false,
            error: null,
            mode: data.mode,
            group: data.group,
            ready: true,
          };
        });
      } catch {
        if (replace) {
          patchSolo({ error: "Nätverksfel. Kontrollera anslutningen.", hasMore: false, loading: false });
        }
      } finally {
        soloLoadRef.current = false;
      }
    },
    [patchSolo]
  );

  const ensureSoloDeck = useCallback(
    async (opts?: { force?: boolean }) => {
      const s = soloRef.current;
      const force = opts?.force ?? false;
      if (!force && s.ready && s.cards.length > 0) {
        if (s.cards.length < PREFETCH_MIN_CARDS && s.hasMore && !soloLoadRef.current) {
          await loadSoloPage(s.page + 1, false);
        }
        return;
      }
      if (!force && s.ready && s.loading) return;
      await loadSoloPage(1, true);
    },
    [loadSoloPage]
  );

  const retrySoloDeck = useCallback(async () => {
    setSolo(emptySolo());
    await loadSoloPage(1, true);
  }, [loadSoloPage]);

  const ensureGroupDeck = useCallback(
    async (code: string, opts?: { force?: boolean }) => {
      const key = code.toUpperCase();
      if (!key) return;
      const existing = groupDecksRef.current[key];
      if (!opts?.force && existing?.ready && existing.cards.length > 0) return;
      if (groupLoadRef.current.has(key)) return;

      groupLoadRef.current.add(key);
      setGroupDeck(key, { loading: !(existing?.cards.length), error: null });

      try {
        const res = await fetch(`/api/recs/group?code=${encodeURIComponent(key)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as
          | { ok: true; feed: Parameters<typeof mapGroupFeed>[0] }
          | { ok: false; error?: string };

        if (!data.ok) {
          setGroupDeck(key, {
            loading: false,
            error: data.error ?? "Kunde inte hämta gruppförslag.",
            ready: true,
          });
          return;
        }

        setGroupDeck(key, {
          cards: mapGroupFeed(data.feed),
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
        groupLoadRef.current.delete(key);
      }
    },
    [setGroupDeck]
  );

  // Förladda solo + grupp så fort användaren är inloggad (AppShell).
  useEffect(() => {
    void ensureSoloDeck();
    const code = readGroupCodeFromCookie();
    if (code) void ensureGroupDeck(code);
  }, [ensureSoloDeck, ensureGroupDeck]);

  // Om användaren går med i grupp på /group — förladda gruppkort i bakgrunden.
  useEffect(() => {
    const code = readGroupCodeFromCookie();
    if (code) void ensureGroupDeck(code);
  }, [pathname, ensureGroupDeck]);

  // Håll solo-kön fylld i bakgrunden.
  useEffect(() => {
    const s = soloRef.current;
    if (!s.ready || s.loading || soloLoadRef.current) return;
    if (s.cards.length < PREFETCH_MIN_CARDS && s.hasMore) {
      void loadSoloPage(s.page + 1, false);
    }
  }, [solo.cards.length, solo.hasMore, solo.page, solo.ready, solo.loading, loadSoloPage]);

  const popSoloCard = useCallback(() => {
    setSolo((prev) => ({ ...prev, cards: prev.cards.slice(1) }));
  }, []);

  const updateSoloCards = useCallback((fn: (cards: SwipeCard[]) => SwipeCard[]) => {
    setSolo((prev) => ({ ...prev, cards: fn(prev.cards) }));
  }, []);

  const popGroupCard = useCallback((code: string) => {
    const key = code.toUpperCase();
    setGroupDecks((prev) => {
      const cur = prev[key] ?? emptyGroup();
      return { ...prev, [key]: { ...cur, cards: cur.cards.slice(1) } };
    });
  }, []);

  const updateGroupCards = useCallback(
    (code: string, fn: (cards: SwipeCard[]) => SwipeCard[]) => {
      const key = code.toUpperCase();
      setGroupDecks((prev) => {
        const cur = prev[key] ?? emptyGroup();
        return { ...prev, [key]: { ...cur, cards: fn(cur.cards) } };
      });
    },
    []
  );

  const value = useMemo<Ctx>(
    () => ({
      solo,
      patchSolo,
      popSoloCard,
      updateSoloCards,
      ensureSoloDeck,
      retrySoloDeck,
      getGroupDeck,
      popGroupCard,
      updateGroupCards,
      ensureGroupDeck,
    }),
    [
      solo,
      patchSolo,
      popSoloCard,
      updateSoloCards,
      ensureSoloDeck,
      retrySoloDeck,
      getGroupDeck,
      popGroupCard,
      updateGroupCards,
      ensureGroupDeck,
    ]
  );

  return <SwipeDeckContext.Provider value={value}>{children}</SwipeDeckContext.Provider>;
}

export function useSwipeDeck() {
  const ctx = useContext(SwipeDeckContext);
  if (!ctx) throw new Error("useSwipeDeck must be used within SwipeDeckProvider");
  return ctx;
}

export function useSoloSwipeDeck() {
  const ctx = useSwipeDeck();
  useEffect(() => {
    void ctx.ensureSoloDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- körs vid mount, store hanterar cache
  }, []);
  return ctx;
}

export function useGroupSwipeDeck(code: string) {
  const ctx = useSwipeDeck();
  const normalized = code.trim().toUpperCase();
  useEffect(() => {
    if (normalized) void ctx.ensureGroupDeck(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- vid kodbyte, store hanterar cache
  }, [normalized]);
  return {
    deck: ctx.getGroupDeck(normalized),
    popCard: () => ctx.popGroupCard(normalized),
    updateCards: (fn: (cards: SwipeCard[]) => SwipeCard[]) => ctx.updateGroupCards(normalized, fn),
    retry: () => ctx.ensureGroupDeck(normalized, { force: true }),
  };
}
