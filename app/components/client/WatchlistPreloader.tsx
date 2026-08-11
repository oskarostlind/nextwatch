"use client";

// Samma mönster som SwipeDeckPreloader/SocialPreloader/SwipeSettingsPreloader:
// monteras en gång i AppShell och returnerar null.
//
// Varför: watchlisten och betygslistan cachas redan i localStorage (24 h), men
// cachen fylldes först NÄR man öppnade fliken. Första besöket efter en install,
// efter en dags uppehåll eller efter utloggning mötte därför ett skelett medan
// raderna hämtades och TMDB-metadatan berikades. Här hämtas de i stället i
// bakgrunden direkt efter appstart, så fliken har data innan man trycker.
//
// Tre saker med flit:
//   1. Körs bara när cachen är KALL. Är den varm renderar fliken redan direkt,
//      och WatchlistClient revalideras ändå vid öppning — en hämtning till här
//      hade bara kostat mobildata utan att synas.
//   2. Väntar på idle (requestIdleCallback, timeout-fallback för WebKit som
//      saknar den). Förladdningen får inte konkurrera med swipe-deckens
//      hämtning om nätet under de första sekunderna — swipe är startvyn.
//   3. Kräver auth-cookie. Utan den svarar routerna 401 och vi skulle bränna
//      två requests per appstart på utloggade besökare.

import { useEffect } from "react";
import { hasAuthCookie } from "@/lib/userGuide";
import { loadRated, loadWatchlist, readCachedRated, readCachedWatchlist } from "@/lib/watchlistData";

/** Efter swipe-deckens första hämtning, men innan användaren hinner byta flik. */
const IDLE_TIMEOUT_MS = 2500;

export default function WatchlistPreloader() {
  useEffect(() => {
    if (!hasAuthCookie()) return;

    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      // Listorna hämtas var för sig: har man öppnat watchlisten men aldrig
      // Betyg-fliken är bara den ena cachen varm.
      if (!readCachedWatchlist()) void loadWatchlist();
      if (!readCachedRated()) void loadRated();
    };

    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;

    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(handle);
      };
    }

    // WKWebView saknade requestIdleCallback länge — timern gör samma jobb.
    const t = window.setTimeout(run, IDLE_TIMEOUT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  return null;
}
