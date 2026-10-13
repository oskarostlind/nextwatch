"use client";

// app/components/client/VersionWatcher.tsx
//
// Laddar om en klient som kör en gammal deploy. iOS-appen laddar
// www.nextwatch.se via server.url och hålls öppen i dagar — utan det här
// körde den kvar på gammal JS efter en deploy (2026-10-13: "Välj åt mig"-
// följdfrågorna syntes inte i appen fast de var live, och förfrågningarna
// saknade sessionId som bara den nya koden skickar).
//
// När appen/fliken väcks (Capacitor appStateChange, annars visibilitychange)
// hämtas /api/version, högst var 2:e minut. Skiljer sig sha:n laddas sidan om
// — men aldrig mitt i något: är ett ark öppet eller ett fält fokuserat väntar
// vi till nästa väckning. Högst en omladdning per 5 min, så ett fel som inte
// går över av en omladdning inte blir en loop.

import { useEffect } from "react";

const BUILT = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
const CHECK_EVERY_MS = 2 * 60 * 1000;
const RELOAD_KEY = "nw_version_reload_at";
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

function busy(): boolean {
  if (document.querySelector("[data-blocking-sheet]")) return true;
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || (a as HTMLElement).isContentEditable);
}

function reloadAllowed(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage blockerat — tillåt, perioden nedan begränsar ändå.
  }
  return true;
}

export default function VersionWatcher() {
  useEffect(() => {
    // Lokal utveckling / byggen utan commit-sha: inget att jämföra med.
    if (!BUILT) return;
    let lastCheck = Date.now(); // sidan är ju nyss laddad
    let checking = false;

    const check = async () => {
      if (checking || Date.now() - lastCheck < CHECK_EVERY_MS) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { sha } = (await res.json()) as { sha?: string };
        if (!sha || sha === BUILT) return;
        if (busy()) {
          lastCheck = 0; // försök igen vid nästa väckning
          return;
        }
        if (reloadAllowed()) window.location.reload();
      } catch {
        // offline e.d. — nästa väckning försöker igen
      } finally {
        checking = false;
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);

    let removeApp: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");
        const h = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void check();
        });
        if (cancelled) void h.remove();
        else removeApp = () => void h.remove();
      } catch {
        /* inte i appen — visibilitychange räcker */
      }
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      removeApp?.();
    };
  }, []);

  return null;
}
