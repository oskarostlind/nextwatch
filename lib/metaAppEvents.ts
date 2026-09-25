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

// Tillfällig diagnostik (se app/api/diag/meta-sdk) — tas bort när eventen syns i Meta.
function report(d: Record<string, unknown>): void {
  try {
    void fetch("/api/diag/meta-sdk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...d, t: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best effort */
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(p: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

export async function startMetaAppEvents(): Promise<void> {
  const d: Record<string, unknown> = { step: "start", started };
  try {
    const { Capacitor } = await import("@capacitor/core");
    d.native = Capacitor.isNativePlatform();
    d.platform = Capacitor.getPlatform();
    d.available = Capacitor.isPluginAvailable("FacebookAnalytics");
  } catch (e) {
    d.capErr = errMsg(e);
  }
  d.isNativeIos = isNativeIos();
  report({ ...d });
  if (started || !d.isNativeIos) return;
  started = true;
  const fb = await withTimeout(plugin()).catch(() => null);
  d.jsLoaded = !!fb;
  if (!fb) return report({ ...d, step: "nojs" });
  try {
    d.version = (await withTimeout(fb.getPluginVersion())).version;
  } catch (e) {
    d.versionErr = errMsg(e);
  }
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    const att = await withTimeout(AdMob.trackingAuthorizationStatus());
    d.att = att.status;
    if (att.status === "authorized") await withTimeout(fb.enableAdvertiserTracking());
  } catch (e) {
    d.attErr = errMsg(e);
  }
  try {
    await withTimeout(fb.initAppEvents());
    d.init = "ok";
  } catch (e) {
    d.initErr = errMsg(e);
  }
  report({ ...d, step: "done" });
}
