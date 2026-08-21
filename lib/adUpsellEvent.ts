// lib/adUpsellEvent.ts
//
// Räknaren/signalen som öppnar <PremiumUpsellModal /> — premium-CTA:n som visas
// EFTER en annons. Ligger i en EGEN modul och inte i PremiumUpsellModal.tsx med
// flit: swipe-vyn lat-laddar modalen med next/dynamic, och en namngiven import
// från samma fil hade dragit in hela komponenten (framer-motion, lucide,
// admobAds) i förstaladdningens bundle igen — då blir dynamic() en ren no-op.
//
// Frekvensspärr (tre lager, alla måste släppa igenom):
//   1. var UPSELL_EVERY_N_ADS:e annons
//   2. högst en gång per session (sessionStorage)
//   3. högst en gång per UPSELL_COOLDOWN_H timmar, över sessionsgränser
//      (localStorage) — annars räckte det att döda och starta om appen för att
//      få erbjudandet igen, vilket är precis så det känns spammigt.
// Dessutom: aldrig direkt efter att användaren tittat klart på en belönad video
// (då HAR de nyss betalat med sin tid — se markUpsellSatisfied).

export const UPSELL_EVENT = "nw:premium-upsell";

const AD_COUNT_KEY = "nw_ad_impressions";
const SHOWN_SESSION_KEY = "nw_upsell_shown";
const SHOWN_AT_KEY = "nw_upsell_last_at";

/** Var N:e annons som triggar CTA:n. */
export const UPSELL_EVERY_N_ADS = 3;

/** Minsta tid mellan två CTA:er, i timmar. */
export const UPSELL_COOLDOWN_H = 20;

function withinCooldown(): boolean {
  try {
    const last = Number(window.localStorage.getItem(SHOWN_AT_KEY) ?? "0");
    if (!last) return false;
    return Date.now() - last < UPSELL_COOLDOWN_H * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Registrera att en annons visats klart. Öppnar CTA:n om alla tre spärrarna
 * släpper igenom. Anropas när annonskortet lämnar däcket (webb) och när
 * AdMob-interstitialen stängts (iOS).
 */
export function maybeTriggerAdUpsell(): void {
  try {
    const count = Number(sessionStorage.getItem(AD_COUNT_KEY) ?? "0") + 1;
    sessionStorage.setItem(AD_COUNT_KEY, String(count));
    if (count % UPSELL_EVERY_N_ADS !== 0) return;
    if (sessionStorage.getItem(SHOWN_SESSION_KEY)) return;
    if (withinCooldown()) return;
    sessionStorage.setItem(SHOWN_SESSION_KEY, "1");
    try {
      window.localStorage.setItem(SHOWN_AT_KEY, String(Date.now()));
    } catch {
      /* privat läge — sessionsspärren räcker då */
    }
    window.dispatchEvent(new Event(UPSELL_EVENT));
  } catch {
    /* sessionStorage otillgänglig (privat läge etc.) — hoppa över upsell */
  }
}

/**
 * Kvittera att användaren gjort något som gör CTA:n irrelevant just nu (löst in
 * en belönad video, eller startat ett köp). Nollar räknaren och startar om
 * karensen så nästa erbjudande ligger långt fram.
 */
export function markUpsellSatisfied(): void {
  try {
    sessionStorage.setItem(AD_COUNT_KEY, "0");
    sessionStorage.setItem(SHOWN_SESSION_KEY, "1");
    window.localStorage.setItem(SHOWN_AT_KEY, String(Date.now()));
  } catch {
    /* no-op */
  }
}
