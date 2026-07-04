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
  setSwipeAdsEnabled,
  subscribeSwipeDeck,
  updateGroupCards,
  updateSoloCards,
  type GroupDeckState,
  type SoloDeckState,
} from "@/lib/swipeDeckStore";
import type { SwipeCard } from "@/lib/swipeDeck";
import { adsFeatureEnabled } from "@/lib/ads";

export type { SoloDeckState, GroupDeckState };

/**
 * Startar förladdning utan att wrappa barn — undviker att hela AppShell
 * re-renderas när kortleken uppdateras i bakgrunden.
 */
export function SwipeDeckPreloader() {
  const pathname = usePathname() ?? "/";

  // Avgör om annonser ska visas (gratisanvändare + feature-flagga på).
  // Körs före däcket hinner ladda flera sidor, så annonser injiceras stabilt.
  useEffect(() => {
    if (!adsFeatureEnabled()) {
      setSwipeAdsEnabled(false);
      return;
    }
    let cancelled = false;
    void fetch("/api/billing/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { isPremium?: boolean } | null) => {
        if (cancelled) return;
        // Annonser bara för icke-premium.
        setSwipeAdsEnabled(!(j?.isPremium ?? false));
      })
      .catch(() => {
        /* vid fel: visa hellre inga annonser */
        if (!cancelled) setSwipeAdsEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
