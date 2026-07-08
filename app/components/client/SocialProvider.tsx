"use client";

// Hook + global preloader för socialdata (vänner/inbjudningar/medlemmar).
// Samma mönster som app/recs/SwipeDeckProvider.tsx: SocialPreloader monteras
// en gång i AppShell (returnerar null så deck-uppdateringar inte re-renderar
// skalet), och useSocial() prenumererar på lib/socialStore.ts.

import { useEffect, useSyncExternalStore } from "react";
import {
  getSocialSnapshot,
  preloadSocialIdle,
  startSocialPolling,
  subscribeSocial,
} from "@/lib/socialStore";

export function useSocial() {
  return useSyncExternalStore(subscribeSocial, getSocialSnapshot, getSocialSnapshot);
}

export function SocialPreloader() {
  useEffect(() => {
    preloadSocialIdle();
    return startSocialPolling();
  }, []);

  return null;
}
