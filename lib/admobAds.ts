// lib/admobAds.ts
//
// AdMob för iOS-appen (webben har inga native-annonser; AdSense nekade sajten
// och webbens annonskort visar bara premium-CTA). Två format:
//   - interstitial var 15:e swipe, aldrig tätare än var 3:e minut
//   - rewarded: titta klart på en video → 24h annonsfritt (nw_adfree_until)
// Bannern togs BORT (Oskars beslut 2026-07-18): den låg i vägen för knapparna
// och förstörde upplevelsen oavsett placering — intäkten motiverade den inte.
//
// Gate: bara native iOS (isNativeIos), aldrig för premium, aldrig under ett
// aktivt 24h-fönster. Samtycke före första annonsen: UMP-formuläret (GDPR)
// när det krävs, sedan ATT — nekad spårning ger icke-personaliserade annonser
// (npa), aldrig en blockerad app.
//
// Annonsenhets-id:n via env med Googles officiella TEST-id:n som fallback, så
// en build utan env aldrig visar skarpa annonser av misstag.

import { isNativeIos } from "@/lib/premiumPurchase";

const TEST_IDS = {
  interstitial: "ca-app-pub-3940256099942544/4411468910",
  rewarded: "ca-app-pub-3940256099942544/1712485313",
};

function adId(kind: keyof typeof TEST_IDS): string {
  const env = {
    interstitial: process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_ID,
    rewarded: process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID,
  }[kind];
  return env && env.startsWith("ca-app-pub-") ? env : TEST_IDS[kind];
}

/* ---------- 24h annonsfritt ---------- */

const ADFREE_KEY = "nw_adfree_until";

export function adFreeUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(ADFREE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function adFreeActive(): boolean {
  return adFreeUntil() > Date.now();
}

function grantAdFree24h(): void {
  try {
    window.localStorage.setItem(ADFREE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
  } catch {
    /* privat läge — annonserna tystas ändå denna session via minnesflaggan */
  }
}

/* ---------- Tillstånd ---------- */

const INTERSTITIAL_EVERY = 15;
const INTERSTITIAL_MIN_GAP_MS = 3 * 60 * 1000;

let initialized = false;
let initInFlight: Promise<boolean> | null = null;
let eligible = false; // native + ej premium — 24h-fönstret kollas per visning
let npa = false;
let interstitialReady = false;
let swipesSinceAd = 0;
let lastInterstitialAt = 0;

async function plugin() {
  // Dynamisk import: modulen får aldrig hamna i webbens bundle-kritiska väg.
  return await import("@capacitor-community/admob");
}

async function fetchIsPremium(): Promise<boolean> {
  try {
    const { getBillingStatus } = await import("@/lib/billingStore");
    return Boolean((await getBillingStatus())?.isPremium);
  } catch {
    return false;
  }
}

/**
 * Initierar AdMob + samtycke. Idempotent och billig att anropa flera gånger.
 * Returnerar om annonser alls är aktuella (native + ej premium).
 */
export async function initAdMobIfEligible(): Promise<boolean> {
  if (!isNativeIos()) return false;
  if (initialized) return eligible;
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    try {
      if (await fetchIsPremium()) {
        eligible = false;
        initialized = true;
        return false;
      }

      const { AdMob } = await plugin();
      await AdMob.initialize();

      // UMP (GDPR): visa formuläret när det krävs. Fel här får aldrig stoppa
      // appen — vi faller tillbaka på npa.
      try {
        const consent = await AdMob.requestConsentInfo();
        if (consent.isConsentFormAvailable && consent.status === "REQUIRED") {
          await AdMob.showConsentForm();
        }
      } catch {
        npa = true;
      }

      // ATT: fråga en gång; allt annat än "authorized" → icke-personaliserat.
      try {
        let att = await AdMob.trackingAuthorizationStatus();
        if (att.status === "notDetermined") {
          await AdMob.requestTrackingAuthorization();
          att = await AdMob.trackingAuthorizationStatus();
        }
        npa = att.status !== "authorized";
      } catch {
        npa = true;
      }

      eligible = true;
      initialized = true;
      void prepareInterstitial();
      return true;
    } catch {
      eligible = false;
      initialized = true;
      return false;
    } finally {
      initInFlight = null;
    }
  })();

  return initInFlight;
}

/* ---------- Interstitial (var 15:e swipe) ---------- */

async function prepareInterstitial(): Promise<void> {
  if (!eligible || interstitialReady) return;
  try {
    const { AdMob } = await plugin();
    await AdMob.prepareInterstitial({ adId: adId("interstitial"), npa });
    interstitialReady = true;
  } catch {
    /* försöker igen vid nästa registerSwipe-tröskel */
  }
}

/**
 * Anropas per genomförd swipe (solo). Visar interstitial var 15:e swipe med
 * 3-minuters golv. Fire-and-forget — får aldrig blockera swipeflödet.
 */
export function registerSwipeForAds(): void {
  if (!initialized || !eligible || adFreeActive()) return;
  swipesSinceAd += 1;
  if (swipesSinceAd < INTERSTITIAL_EVERY) return;
  if (Date.now() - lastInterstitialAt < INTERSTITIAL_MIN_GAP_MS) return;

  swipesSinceAd = 0;
  void (async () => {
    try {
      if (!interstitialReady) {
        await prepareInterstitial();
        if (!interstitialReady) return;
      }
      const { AdMob } = await plugin();
      await AdMob.showInterstitial();
      lastInterstitialAt = Date.now();
      interstitialReady = false;
      void prepareInterstitial();
      // Upsell-popupen lyssnar ("titta på video → 24h annonsfritt" / premium).
      // Event i stället för direkt import — PremiumUpsellModal importerar oss.
      try {
        window.dispatchEvent(new Event("nw:admob-ad-shown"));
      } catch {
        /* SSR/edge — irrelevant här */
      }
    } catch {
      interstitialReady = false;
    }
  })();
}

/* ---------- Rewarded: 24h annonsfritt ---------- */

/** Kan erbjudandet visas alls? (native, ej premium, inte redan aktivt) */
export function canOfferAdFreeReward(): boolean {
  return initialized && eligible && !adFreeActive();
}

/**
 * Visar belöningsvideon. Resolvar true om användaren tittade klart och fick
 * sina 24h — bannern tas ner direkt.
 */
export async function watchRewardedForAdFree(): Promise<boolean> {
  if (!(await initAdMobIfEligible())) return false;
  try {
    const { AdMob, RewardAdPluginEvents } = await plugin();

    const rewarded = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      void AdMob.addListener(RewardAdPluginEvents.Rewarded, () => done(true));
      void AdMob.addListener(RewardAdPluginEvents.Dismissed, () => done(false));
      void AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => done(false));
    });

    await AdMob.prepareRewardVideoAd({ adId: adId("rewarded"), npa });
    await AdMob.showRewardVideoAd();

    const ok = await rewarded;
    if (ok) grantAdFree24h();
    return ok;
  } catch {
    return false;
  }
}
