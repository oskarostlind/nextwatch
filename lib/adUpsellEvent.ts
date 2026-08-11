// lib/adUpsellEvent.ts
//
// Räknaren/signalen som öppnar <PremiumUpsellModal />. Ligger i en EGEN modul
// och inte i PremiumUpsellModal.tsx med flit: swipe-vyn lat-laddar modalen med
// next/dynamic, och en namngiven import från samma fil hade dragit in hela
// komponenten (framer-motion, lucide, admobAds) i förstaladdningens bundle
// igen — då blir dynamic() en ren no-op.

export const UPSELL_EVENT = "nw:premium-upsell";

const AD_COUNT_KEY = "nw_ad_impressions";
const SHOWN_KEY = "nw_upsell_shown";

/** Var N:e annons som triggar popupen. */
export const UPSELL_EVERY_N_ADS = 3;

/**
 * Registrera att ett annonskort visats. Var UPSELL_EVERY_N_ADS:e annons öppnas
 * popupen — men bara en gång per session.
 */
export function maybeTriggerAdUpsell(): void {
  try {
    const count = Number(sessionStorage.getItem(AD_COUNT_KEY) ?? "0") + 1;
    sessionStorage.setItem(AD_COUNT_KEY, String(count));
    if (count % UPSELL_EVERY_N_ADS !== 0) return;
    if (sessionStorage.getItem(SHOWN_KEY)) return;
    sessionStorage.setItem(SHOWN_KEY, "1");
    window.dispatchEvent(new Event(UPSELL_EVENT));
  } catch {
    /* sessionStorage otillgänglig (privat läge etc.) — hoppa över upsell */
  }
}
