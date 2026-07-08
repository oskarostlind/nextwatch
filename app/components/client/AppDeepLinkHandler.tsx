"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { APP_DEEP_LINK_SCHEME } from "@/lib/nativeApp";

/**
 * Lyssnar på deep links (nextwatch://) och appStateChange i Capacitor-skalet.
 * Mountas globalt så verifieringsflödet kan återvända till appen från Safari.
 */
export default function AppDeepLinkHandler() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      const { App } = await import("@capacitor/app");
      if (cancelled) return;

      const urlHandle = await App.addListener("appUrlOpen", ({ url }) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== `${APP_DEEP_LINK_SCHEME}:`) return;

          // Efter verifiering i Safari: landa i appen på swipe.
          if (parsed.host === "auth" && parsed.pathname === "/verified") {
            window.location.replace("/swipe");
          }
        } catch {
          // Ogiltig URL – ignorera.
        }
      });
      cleanups.push(() => void urlHandle.remove());

      const stateHandle = await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          window.dispatchEvent(new CustomEvent("nw-app-foreground"));
        }
      });
      cleanups.push(() => void stateHandle.remove());
    })();

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}
