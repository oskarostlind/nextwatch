// lib/admobAds.ts
//
// AdMob för iOS-appen (webben har inga native-annonser; AdSense nekade sajten
// och webbens annonskort visar bara premium-CTA). Två format:
//   - interstitial var NEXT_PUBLIC_AD_EVERY:e swipe (default 15), aldrig
//     tätare än NEXT_PUBLIC_AD_MIN_GAP_SEC (default 180 s, 0 = av)
//   - rewarded: titta klart på en video → +swipes på dagsgränsen
//     (/api/swipe/bonus). Tidigare gav den 24h annonsfritt — borttaget
//     2026-09-25 (Oskars beslut): att köpa sig fri från annonser med EN annons
//     slog undan både annonsintäkten och premiumargumentet.
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
import { adEveryFromEnv } from "@/lib/ads";
import { funnel } from "@/lib/funnel";

const TEST_IDS = {
  interstitial: "ca-app-pub-3940256099942544/4411468910",
  rewarded: "ca-app-pub-3940256099942544/1712485313",
};

/**
 * Ett ANNONSENHETS-id ser ut som ca-app-pub-<publisher>/<enhet> (snedstreck).
 * AdMob-appens APP-id ser nästan likadant ut men har tilde: ...~8922574955, och
 * ligger i ios/App/App/Info.plist som GADApplicationIdentifier — inte här.
 *
 * Prefixkollen ensam släppte igenom app-id:t, och då misslyckas varje
 * annonsbegäran tyst för alltid. Kräv snedstrecket och skrik i konsolen i
 * stället, annars är felet praktiskt taget osynligt.
 */
function isAdUnitId(value: string): boolean {
  return value.startsWith("ca-app-pub-") && value.includes("/");
}

function adId(kind: keyof typeof TEST_IDS): string {
  const env = {
    interstitial: process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_ID,
    rewarded: process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID,
  }[kind];
  if (!env) return TEST_IDS[kind];
  if (!isAdUnitId(env)) {
    console.warn(
      `[admob] "${env}" ser inte ut som ett annonsenhets-id (saknar "/"). ` +
        `Ser det ut som ca-app-pub-...~... är det appens app-id — hämta ad unit-id:t ` +
        `under Apps → NextWatch → Ad units i AdMob. Faller tillbaka på test-id.`
    );
    return TEST_IDS[kind];
  }
  return env;
}

/* ---------- 24h annonsfritt (legacy) ----------
 * Beviljas inte längre. Läsningen finns kvar så att fönster som redan delats
 * ut respekteras tills de löper ut (senast 24h efter deployen) — kan tas bort
 * därefter. */

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

/* ---------- Tillstånd ---------- */

const INTERSTITIAL_EVERY = adEveryFromEnv(15);
const INTERSTITIAL_MIN_GAP_MS = (() => {
  const raw = process.env.NEXT_PUBLIC_AD_MIN_GAP_SEC;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 180) * 1000;
})();
/**
 * Efter ett misslyckat försök väntar vi bara så här många swipes innan nästa,
 * i stället för hela INTERSTITIAL_EVERY. "No fill" är ofta övergående (nytt
 * AdMob-konto, opublicerad app), och då vill vi känna av att det lossnat utan
 * att användaren ska behöva swipa 15 gånger till.
 */
const RETRY_AFTER_FAILED_SWIPES = 5;
/**
 * Förladda annonsen så här många swipes INNAN den ska visas — inte vid
 * appstart. Förr laddades en annons direkt vid init; slutade användaren innan
 * 15 swipes (vanligt) brann den inne. 2026-10-10: 363 matchade förfrågningar
 * men bara 118 visningar på 30 d. En laddad interstitial gäller dessutom bara
 * ~1 h, så den förnyas om den blivit för gammal.
 */
const PRELOAD_AHEAD_SWIPES = 5;
const PRELOADED_TTL_MS = 55 * 60 * 1000;

/**
 * Räknaren och senaste visningen sparas i localStorage så att de överlever en
 * omstart av appen. Tidigare nollades räknaren vid varje start: en användare
 * som swipar 10 + 10 + 10 i tre sessioner nådde aldrig 15 och såg aldrig en
 * annons. Per enhet, best effort — localStorage kan saknas eller kasta.
 */
const COUNTER_KEY = "nw_ad_swipes";
const LAST_AD_KEY = "nw_ad_last";

function loadNumber(key: string): number {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function saveNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* privat läge o.dyl. — räknaren lever då bara i minnet */
  }
}

let initialized = false;
let initInFlight: Promise<boolean> | null = null;
let eligible = false; // native + ej premium — 24h-fönstret kollas per visning
let npa = false;
let interstitialReady = false;
let interstitialPreparedAt = 0;
let prepareInFlight: Promise<void> | null = null;
let swipesSinceAd = 0;
let lastInterstitialAt = 0;

function setSwipesSinceAd(n: number): void {
  swipesSinceAd = n;
  saveNumber(COUNTER_KEY, n);
}
/** Hindrar att flera snabba swipes startar parallella visningsförsök. */
let attemptInFlight = false;

/** Backa räknaren så nästa försök sker om RETRY_AFTER_FAILED_SWIPES swipes. */
function retryLater(): void {
  // En under förladdningströskeln, så att nästa swipe förladdar igen och
  // visningen kommer RETRY_AFTER_FAILED_SWIPES swipes senare.
  const preloadAt = INTERSTITIAL_EVERY - Math.min(PRELOAD_AHEAD_SWIPES, RETRY_AFTER_FAILED_SWIPES);
  setSwipesSinceAd(Math.max(0, preloadAt - 1));
}

/** Är det dags att förladda? Nära nästa visning, och tidsgolvet nästan passerat. */
function shouldPreload(): boolean {
  if (swipesSinceAd < INTERSTITIAL_EVERY - PRELOAD_AHEAD_SWIPES) return false;
  const untilGapOk = INTERSTITIAL_MIN_GAP_MS - (Date.now() - lastInterstitialAt);
  return untilGapOk < 60_000;
}

function preparedIsFresh(): boolean {
  return interstitialReady && Date.now() - interstitialPreparedAt < PRELOADED_TTL_MS;
}

/**
 * Felsökning på enheten. iOS-appen är en WebView och console.warn går bara att
 * läsa via Safari Web Inspector — vilket kräver en Mac. Med
 * NEXT_PUBLIC_ADMOB_DEBUG=1 i Vercel visas felen som toast i appen i stället,
 * så annonsproblem går att diagnosticera från en Windows-maskin.
 * Lämna avstängd i skarp drift: texterna är utvecklartext, inte användartext.
 */
function adDebug(message: string): void {
  if (process.env.NEXT_PUBLIC_ADMOB_DEBUG !== "1") return;
  void import("@/app/components/lib/notify")
    .then((m) => m.notify(message))
    .catch(() => {
      /* notify saknas i den här kontexten — strunt samma */
    });
}

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
        // Vanligaste förklaringen till "jag ser inga annonser" när allt annat
        // är rätt: testkontot har blivit premium av ett tidigare köp.
        adDebug("AdMob av: kontot är premium");
        return false;
      }

      const { AdMob } = await plugin();
      await AdMob.initialize();

      // UMP (GDPR): visa formuläret när det krävs. Fel här får aldrig stoppa
      // appen — vi faller tillbaka på npa.
      try {
        const consent = await AdMob.requestConsentInfo();
        if (consent.isConsentFormAvailable && consent.status === "REQUIRED") {
          funnel("consent_form");
          await AdMob.showConsentForm();
          funnel("consent_done");
        }
      } catch {
        npa = true;
      }

      // ATT: fråga en gång; allt annat än "authorized" → icke-personaliserat.
      try {
        let att = await AdMob.trackingAuthorizationStatus();
        if (att.status === "notDetermined") {
          funnel("att_prompt");
          await AdMob.requestTrackingAuthorization();
          att = await AdMob.trackingAuthorizationStatus();
          funnel(att.status === "authorized" ? "att_allowed" : "att_denied");
        }
        npa = att.status !== "authorized";
      } catch {
        npa = true;
      }

      swipesSinceAd = loadNumber(COUNTER_KEY);
      lastInterstitialAt = loadNumber(LAST_AD_KEY);
      eligible = true;
      initialized = true;
      // Ingen förladdning här längre — bara om räknaren (sparad från förra
      // sessionen) redan står nära nästa visning.
      if (shouldPreload()) void prepareInterstitial();
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

/* ---------- Interstitial (var INTERSTITIAL_EVERY:e swipe) ---------- */

let dismissListenerBound = false;

/**
 * Premium-CTA:n ska komma när annonsen är SLUT, inte när den öppnas.
 * showInterstitial() resolvar så fort annonsen visats — så vi hänger på
 * Dismissed-eventet i stället och signalerar därifrån. PremiumUpsellModal
 * lyssnar på "nw:admob-ad-shown" (event i stället för direkt import: modalen
 * importerar den här modulen, så en import åt andra hållet blir cirkulär).
 */
async function ensureDismissListener(): Promise<void> {
  if (dismissListenerBound) return;
  dismissListenerBound = true;
  try {
    const { AdMob, InterstitialAdPluginEvents } = await plugin();
    await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
      try {
        window.dispatchEvent(new Event("nw:admob-ad-shown"));
      } catch {
        /* SSR/edge — irrelevant här */
      }
    });
  } catch {
    dismissListenerBound = false;
  }
}

function prepareInterstitial(): Promise<void> {
  if (!eligible || preparedIsFresh()) return Promise.resolve();
  // Delad inflight: förladdningen (swipe ~10) och visningsförsöket (swipe 15)
  // får aldrig skicka två parallella förfrågningar till AdMob.
  if (!prepareInFlight) {
    prepareInFlight = doPrepareInterstitial().finally(() => {
      prepareInFlight = null;
    });
  }
  return prepareInFlight;
}

async function doPrepareInterstitial(): Promise<void> {
  interstitialReady = false;
  try {
    const { AdMob } = await plugin();
    await AdMob.prepareInterstitial({ adId: adId("interstitial"), npa });
    interstitialReady = true;
    interstitialPreparedAt = Date.now();
  } catch (err) {
    // Tyst för användaren, men ALDRIG tyst i konsolen: det här är enda stället
    // man ser skillnad på "no fill" (nytt konto/opublicerad app — går över av
    // sig själv) och ett ogiltigt annonsenhets-id (t.ex. att AdMob-appens
    // app-id med ~ råkat användas i stället för ad unit-id:t med /).
    console.warn("[admob] prepareInterstitial misslyckades för", adId("interstitial"), err);
    adDebug(
      `AdMob prepare misslyckades\nid: ${adId("interstitial")}\n${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Anropas per genomförd swipe (solo och grupp). Visar interstitial var
 * INTERSTITIAL_EVERY:e swipe med tidsgolv. Fire-and-forget — får aldrig blockera swipeflödet.
 */
export function registerSwipeForAds(): void {
  if (!initialized || !eligible || adFreeActive()) return;
  setSwipesSinceAd(swipesSinceAd + 1);
  if (swipesSinceAd < INTERSTITIAL_EVERY) {
    if (shouldPreload()) void prepareInterstitial();
    return;
  }
  if (Date.now() - lastInterstitialAt < INTERSTITIAL_MIN_GAP_MS) {
    if (shouldPreload()) void prepareInterstitial();
    return;
  }

  if (attemptInFlight) return;

  // Räknaren nollställs först när annonsen FAKTISKT visats. Tidigare nollades
  // den här uppe, före det asynkrona försöket — ett misslyckat anrop (no fill,
  // fel ad unit-id) åt alltså upp hela kvoten och användaren fick swipa 15
  // gånger till innan nästa försök, utan ett spår av varför.
  attemptInFlight = true;
  void (async () => {
    try {
      if (!preparedIsFresh()) {
        await prepareInterstitial();
        if (!preparedIsFresh()) {
          retryLater();
          return;
        }
      }
      const { AdMob } = await plugin();
      await ensureDismissListener();
      await AdMob.showInterstitial();
      funnel("ad_interstitial");
      setSwipesSinceAd(0);
      lastInterstitialAt = Date.now();
      saveNumber(LAST_AD_KEY, lastInterstitialAt);
      interstitialReady = false;
      // Ingen direkt omladdning — nästa förladdas vid swipe ~10 (shouldPreload).
    } catch (err) {
      interstitialReady = false;
      console.warn("[admob] showInterstitial misslyckades", err);
      adDebug(`AdMob show misslyckades\n${err instanceof Error ? err.message : String(err)}`);
      retryLater();
    } finally {
      attemptInFlight = false;
    }
  })();
}

/* ---------- Rewarded ---------- */

/**
 * Visar en belöningsvideo och resolvar true om användaren tittade klart
 * (Rewarded-eventet fyrade). Enda belöningen är +swipes (/api/swipe/bonus),
 * erbjuds i dagsgränsväggen och i premium-CTA:n efter en annons.
 */
async function showRewardedVideo(): Promise<boolean> {
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

    return await rewarded;
  } catch {
    return false;
  }
}

/* ---------- Rewarded: +swipes ---------- */

/**
 * Kan "+swipes"-erbjudandet visas? Native + ej premium. Servern (via
 * /api/swipe/limit rewardedRemaining) avgör om det finns grants kvar idag.
 */
export function canOfferSwipeReward(): boolean {
  return initialized && eligible;
}

/**
 * Visar belöningsvideon och löser in +swipes server-side. Resolvar true när
 * både videon tittats klart OCH /api/swipe/bonus beviljat bonusen — först då
 * släpper 429-spärren i /api/rate m.fl. och väggen kan tas ner.
 */
export async function watchRewardedForSwipes(): Promise<boolean> {
  const ok = await showRewardedVideo();
  if (!ok) return false;
  try {
    const res = await fetch("/api/swipe/bonus", { method: "POST", cache: "no-store" });
    if (!res.ok) {
      adDebug(`Swipe-bonus nekades av servern (${res.status})`);
      return false;
    }
    const j = (await res.json()) as { ok?: boolean };
    return Boolean(j?.ok);
  } catch {
    return false;
  }
}
