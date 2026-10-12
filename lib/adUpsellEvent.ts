// lib/adUpsellEvent.ts
//
// Räknaren/signalen som öppnar <PremiumUpsellModal /> — premium-CTA:n som visas
// EFTER en annons. Ligger i en EGEN modul och inte i PremiumUpsellModal.tsx med
// flit: swipe-vyn lat-laddar modalen med next/dynamic, och en namngiven import
// från samma fil hade dragit in hela komponenten (framer-motion, lucide,
// admobAds) i förstaladdningens bundle igen — då blir dynamic() en ren no-op.
//
// Frekvens: CTA:n visas efter var TREDJE annons (Oskars beslut 2026-10-12 —
// förut efter varje annons, vilket gav en helskärmsannons + ett premiumark i
// rad var 15:e swipe). Justerbart utan kodändring via
// NEXT_PUBLIC_UPSELL_EVERY_N_ADS i Vercel (osatt = 3, 1 = varje annons osv.;
// kräver redeploy, ingen ny iOS-build). Räknaren ligger i localStorage så att
// den räknar över sessioner — med sessionStorage hade den som ser 1–2 annonser
// per session aldrig fått erbjudandet.
// Undantag: aldrig direkt efter att användaren tittat klart på en belönad
// video — den triggar ingen interstitial och därmed ingen CTA.

export const UPSELL_EVENT = "nw:premium-upsell";

const AD_COUNT_KEY = "nw_ad_impressions";

/** Var N:e annons som triggar CTA:n (1 = varje annons). */
export const UPSELL_EVERY_N_ADS = (() => {
  const raw = process.env.NEXT_PUBLIC_UPSELL_EVERY_N_ADS;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
})();

/**
 * Registrera att en annons visats klart. Öppnar CTA:n var UPSELL_EVERY_N_ADS:e
 * annons. Anropas när annonskortet lämnar däcket (webb) och när
 * AdMob-interstitialen stängts (iOS).
 */
export function maybeTriggerAdUpsell(): void {
  let count = 1;
  try {
    count = Number(localStorage.getItem(AD_COUNT_KEY) ?? "0") + 1;
    localStorage.setItem(AD_COUNT_KEY, String(count));
  } catch {
    /* localStorage otillgänglig (privat läge) — räkna varje annons */
  }
  if (count % UPSELL_EVERY_N_ADS !== 0) return;
  try {
    window.dispatchEvent(new Event(UPSELL_EVENT));
  } catch {
    /* SSR — irrelevant */
  }
}

/**
 * Kvittera att användaren gjort något som gör CTA:n irrelevant just nu (löst in
 * en belönad video, eller startat ett köp). Nollar räknaren.
 */
export function markUpsellSatisfied(): void {
  try {
    localStorage.setItem(AD_COUNT_KEY, "0");
  } catch {
    /* no-op */
  }
}
