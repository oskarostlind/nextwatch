"use client";

// Hook + global preloader för socialdata (vänner/inbjudningar/medlemmar).
// Samma mönster som app/recs/SwipeDeckProvider.tsx: SocialPreloader monteras
// en gång i AppShell (returnerar null så deck-uppdateringar inte re-renderar
// skalet), och useSocial() prenumererar på lib/socialStore.ts.

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  getSocialSnapshot,
  preloadSocialIdle,
  setSocialPollProfile,
  startSocialPolling,
  subscribeSocial,
} from "@/lib/socialStore";

export function useSocial() {
  return useSyncExternalStore(subscribeSocial, getSocialSnapshot, getSocialSnapshot);
}

export function SocialPreloader() {
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    preloadSocialIdle();
    return startSocialPolling();
  }, []);

  // 5s-takt bara där socialdatan faktiskt syns (gruppytorna) — 15s annars.
  useEffect(() => {
    const active = pathname === "/group" || pathname.startsWith("/group/");
    setSocialPollProfile(active ? "active" : "idle");
  }, [pathname]);

  return null;
}
