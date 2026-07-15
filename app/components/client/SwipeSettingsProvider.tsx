"use client";

// Hook + global preloader för swipe-inställningar (hyr/köp-visning + film/serie-filter).
// Samma mönster som app/components/client/SocialProvider.tsx: SwipeSettingsPreloader
// monteras en gång i AppShell (returnerar null), och useSwipeSettings() prenumererar
// på lib/swipeSettingsStore.ts.

import { useEffect, useSyncExternalStore } from "react";
import {
  getSwipeSettingsSnapshot,
  loadSwipeSettings,
  subscribeSwipeSettings,
} from "@/lib/swipeSettingsStore";

export function useSwipeSettings() {
  return useSyncExternalStore(
    subscribeSwipeSettings,
    getSwipeSettingsSnapshot,
    getSwipeSettingsSnapshot
  );
}

export function SwipeSettingsPreloader() {
  useEffect(() => {
    void loadSwipeSettings();
  }, []);

  return null;
}
