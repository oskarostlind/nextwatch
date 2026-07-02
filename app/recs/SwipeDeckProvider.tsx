"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  ensureGroupDeck,
  ensureSoloDeck,
  getGroupDeckSnapshot,
  getSoloDeckSnapshot,
  popGroupCard,
  popSoloCard,
  preloadGroupDeckIfJoined,
  preloadSwipeDecksIdle,
  retrySoloDeck,
  setSwipeBackgroundPrefetch,
  subscribeSwipeDeck,
  updateGroupCards,
  updateSoloCards,
  type GroupDeckState,
  type SoloDeckState,
} from "@/lib/swipeDeckStore";
import type { SwipeCard } from "@/lib/swipeDeck";

export type { SoloDeckState, GroupDeckState };

/**
 * Startar förladdning utan att wrappa barn — undviker att hela AppShell
 * re-renderas när kortleken uppdateras i bakgrunden.
 */
export function SwipeDeckPreloader() {
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    preloadSwipeDecksIdle();
  }, []);

  useEffect(() => {
    const onSwipe =
      pathname === "/swipe" || pathname.startsWith("/group/swipe");
    setSwipeBackgroundPrefetch(onSwipe);
  }, [pathname]);

  useEffect(() => {
    if (pathname === "/group" || pathname.startsWith("/group/")) {
      preloadGroupDeckIfJoined();
    }
  }, [pathname]);

  return null;
}

export function useSoloSwipeDeck() {
  const solo = useSyncExternalStore(
    subscribeSwipeDeck,
    getSoloDeckSnapshot,
    getSoloDeckSnapshot
  );

  useEffect(() => {
    void ensureSoloDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    solo,
    popSoloCard,
    updateSoloCards,
    retrySoloDeck,
    ensureSoloDeck,
  };
}

export function useGroupSwipeDeck(code: string) {
  const normalized = code.trim().toUpperCase();

  const deck = useSyncExternalStore(
    subscribeSwipeDeck,
    () => getGroupDeckSnapshot(normalized),
    () => getGroupDeckSnapshot(normalized)
  );

  useEffect(() => {
    if (normalized) void ensureGroupDeck(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized]);

  return {
    deck,
    popCard: () => popGroupCard(normalized),
    updateCards: (fn: (cards: SwipeCard[]) => SwipeCard[]) =>
      updateGroupCards(normalized, fn),
    retry: () => ensureGroupDeck(normalized, { force: true }),
  };
}
