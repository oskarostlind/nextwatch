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
  unshiftGroupCard,
  unshiftSoloCard,
} from "@/lib/swipeDeckStore";
import type { SwipeCard } from "@/lib/swipeDeck";
import { adsFeatureEnabled } from "@/lib/ads";
import { getBillingStatus } from "@/lib/billingStore";
import { Capacitor } from "@capacitor/core";

function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

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
    // I native-appen sköts annonser av AdMob (lib/admobAds) — AdSense-korten
    // hör hemma på webben och skulle dessutom bryta AdSense-policyn i WebView.
    if (isNativeApp()) {
      setSwipeAdsEnabled(false);
      return;
    }
    if (!adsFeatureEnabled()) {
      setSwipeAdsEnabled(false);
      return;
    }
    let cancelled = false;
    // Delad billing-store: en fetch per session i stället för att varje yta
    // hämtar sin egen status.
    void getBillingStatus()
      .then((j) => {
        if (cancelled) return;
        // Annonser bara för icke-premium; vid fel (null) hellre inga annonser.
        setSwipeAdsEnabled(j ? !j.isPremium : false);
      })
      .catch(() => {
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
    unshiftSoloCard,
    mediaFilter: solo.mediaFilter,
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
    unshiftCard: (card: SwipeCard) => unshiftGroupCard(normalized, card),
  };
}
