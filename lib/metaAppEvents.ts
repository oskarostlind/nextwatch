"use client";

import { isNativeIos } from "./premiumPurchase";

/**
 * Meta App Events i iOS-appen — krävs för att Metas appkampanjer ska kunna
 * optimera på och räkna installationer (SKAdNetwork/AEM på iOS 14+).
 *
 * - Körs bara i Capacitor-skalet på iOS; på webben är allt en no-op.
 * - `FacebookAutoLogAppEventsEnabled` är false i Info.plist, så SDK:n startar
 *   först här (initAppEvents = initializeSDK + activateApp).
 * - Vi frågar ALDRIG själva om ATT. Har användaren redan tillåtit spårning i
 *   AdMob-flödet (lib/admobAds.ts) slås annonsör-spårning på, annars inte —
 *   installationen räknas ändå via SKAdNetwork.
 * - Allt är best effort: ett fel här får aldrig påverka appen.
 */
let started = false;

type FbPlugin = typeof import("@capgo/capacitor-facebook-analytics")["FacebookAnalytics"];

async function plugin(): Promise<FbPlugin | null> {
  try {
    const mod = await import("@capgo/capacitor-facebook-analytics");
    return mod.FacebookAnalytics;
  } catch {
    return null;
  }
}

export async function startMetaAppEvents(): Promise<void> {
  if (started || !isNativeIos()) return;
  started = true;
  const fb = await plugin();
  if (!fb) return;
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    const att = await AdMob.trackingAuthorizationStatus();
    if (att.status === "authorized") await fb.enableAdvertiserTracking();
  } catch {
    /* ingen ATT-info → spårning förblir av */
  }
  try {
    await fb.initAppEvents();
  } catch {
    /* pluginet saknas i äldre builds (före SDK-builden) — tyst no-op */
  }
}
