"use client";

// Ramen för första-besöks-tratten (lib/funnel.ts):
//   - startar spårningen (first_open) vid första appstarten
//   - view:<sektion> första gången varje del av appen visas
//   - first_exit första gången appen/fliken lämnas, last_exit (överskrivs) varje
//     gång: VAR man var och hur långt man kommit — för den som aldrig kommer
//     tillbaka är last_exit svaret på "var lämnade de?"
//   - return_visit när enheten öppnas en senare kalenderdag — även när iOS-appen
//     bara väcks ur bakgrunden (då laddas sidan inte om)
// /admin räknas inte.
//
// "Lämnade" = appen gick i bakgrunden eller fliken göms, INTE ett sidbyte.
// Före 2026-10-12 räknades pagehide/visibilitychange vid varje full
// sidnavigering (gäst → /swipe, Apple-inloggning, länkar) som en stängning,
// så tratten visade "100 % stängde utan swipe" och första session ~20 s.
// Nu: beforeunload markerar att sidan byts (fyrar vid navigering men aldrig när
// appen bara läggs i bakgrunden), och i iOS-appen är Capacitors appStateChange
// källan. swipes = totalt på enheten, inte bara den här sidladdningen.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { funnel, funnelBeacon, funnelInit, funnelStart, funnelTotalSwipes, lastStep } from "@/lib/funnel";

/** /group/swipe → group/swipe, /title/123 → title. Siffror och koder bort. */
function section(path: string): string {
  const parts = path.split("/").filter(Boolean).slice(0, 2);
  const clean = parts.filter((p) => /^[a-z-]+$/.test(p));
  return clean.length ? clean.join("/") : "start";
}

const dayOf = (t: number) => new Date(t).toLocaleDateString("sv-SE");

function isNative(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Öppnad en senare kalenderdag än första öppningen → return_visit (en gång). */
function checkReturn() {
  void funnelInit().then((s) => {
    if (s && s.track && dayOf(Date.now()) !== dayOf(s.t0)) funnel("return_visit");
  });
}

export default function FunnelTracker() {
  const pathname = usePathname() ?? "/";
  const isAdmin = pathname.startsWith("/admin");

  useEffect(() => {
    if (isAdmin) return;
    checkReturn();
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    funnel(`view:${section(pathname)}`);
  }, [pathname, isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    let navigating = false;
    let lastExitAt = 0;

    const exit = () => {
      if (navigating) return; // sidbyte, inte en stängning
      if (Date.now() - lastExitAt < 1500) return; // appStateChange + visibilitychange
      lastExitAt = Date.now();
      const t0 = funnelStart();
      const props = {
        at: section(location.pathname),
        swipes: funnelTotalSwipes(),
        secs: t0 ? Math.round((Date.now() - t0) / 1000) : null,
        step: lastStep(),
      };
      funnelBeacon("first_exit", props);
      funnelBeacon("last_exit", props, true);
    };
    const onBeforeUnload = () => {
      navigating = true;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") exit();
      else checkReturn();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVis);

    // iOS-appen: bakgrund/förgrund kommer från Capacitor, och en app som väcks
    // nästa dag laddar inte om sidan — utan det här syns den aldrig som återbesök.
    let removeApp: (() => void) | null = null;
    let cancelled = false;
    if (isNative()) {
      void (async () => {
        try {
          const { App } = await import("@capacitor/app");
          const h = await App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) checkReturn();
            else exit();
          });
          if (cancelled) void h.remove();
          else removeApp = () => void h.remove();
        } catch {
          /* @capacitor/app saknas — visibilitychange täcker ändå */
        }
      })();
    }
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVis);
      removeApp?.();
    };
  }, [isAdmin]);

  return null;
}
