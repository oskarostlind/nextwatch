// lib/premiumPurchase.ts (klient)
//
// EN ingång för alla premium-köp, plattformsmedveten:
//   - Native iOS (Capacitor)  -> Apple In-App Purchase via @capgo/native-purchases
//     (StoreKit 2), verifierat server-side i /api/apple/iap/verify. Stripe får
//     ALDRIG öppnas i iOS-appen (App Store-regel 3.1.1).
//   - Native Android          -> Google Play Billing (samma plugin), verifierat i
//     /api/google/play/verify. Stripe aldrig i appen (Play-policy).
//   - Webb                    -> Stripe Checkout (/api/stripe/checkout).
//
// Två planer sedan 2026-10-15: "monthly" (79 kr/mån) och "yearly" (599 kr/år),
// båda med 7 dagars provperiod för den som aldrig haft Premium. Befintliga
// prenumeranter behåller sitt gamla pris (19 kr) — det sköter butikerna; koden
// här visar ALDRIG 19 kr som pris för ett nytt köp. getPremiumOffers() ger
// priserna att visa: butikens lokaliserade pris när det finns, annars listpriset.
// En plan vars env saknas har available:false och ska gömmas — aldrig krascha.
//
// Samma mönster som AvyraCards ios-iap-premium-button.tsx: hämta produkt-id
// från /api/apple/iap/config, köp med purchaseProduct(), posta transactionId
// till verify-endpointen.

import { clientMsg } from "@/lib/clientMessages";
import { Capacitor } from "@capacitor/core";
import { ensureAccountBeforePremium } from "./signupNudge";
import { readUiLanguage } from "@/lib/uiLanguage";
import { funnel } from "@/lib/funnel";

export type PurchaseResult =
  | { ok: true }
  | { ok: false; message: string; cancelled?: boolean };

export function isNativeIos(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

/** Native Android-appen (Capacitor). Köp går via Google Play Billing. */
export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

/**
 * Native app med butikens egen betalning (iOS → App Store, Android → Google
 * Play). Används där beteendet ska vara detsamma i båda apparna (köp direkt i
 * appen, belöningsvideo, inga Stripe-länkar). På iOS är den identisk med
 * isNativeIos().
 */
export function isNativeStoreApp(): boolean {
  return isNativeIos() || isNativeAndroid();
}

/* ---------- Planer och erbjudanden (nya flödet 2026-10-15, se docs/nya-flodet.md) ---------- */

export type PremiumPlan = "monthly" | "yearly";
export type PremiumOffer = {
  /** Pris att visa, t.ex. "79 kr" / "599,00 kr" (butikens lokaliserade sträng när den finns). */
  price: string;
  period: "month" | "year";
  /** Provperiodens längd i dagar; 0 = ingen provperiod att lova den här användaren. */
  trialDays: number;
  /** false = planen är inte konfigurerad/inte till salu här → göm den. */
  available: boolean;
  /** Belopp i hela valutaenheter (79, 599) när det är känt — för "spara X %" och "≈ N kr/mån". */
  amount?: number | null;
  currency?: string | null;
};
export type PremiumOffers = { monthly: PremiumOffer; yearly: PremiumOffer };

/** Listpriser (SEK) när butiken inte kan svara. Ändras de: ändra här + i butikerna. */
const LIST_PRICE: Record<PremiumPlan, number> = { monthly: 79, yearly: 599 };
const LIST_CURRENCY = "SEK";
const DEFAULT_TRIAL_DAYS = 7;

function fmtLocale(): string {
  return readUiLanguage() === "en" ? "en-GB" : "sv-SE";
}

/** "79 kr" (sv) / "SEK 79" (en); decimaler bara när beloppet har det. */
export function formatPremiumPrice(amount: number, currency: string = LIST_CURRENCY): string {
  try {
    const whole = Math.abs(amount - Math.round(amount)) < 0.005;
    return new Intl.NumberFormat(fmtLocale(), {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(whole ? Math.round(amount) : amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Årspriset per månad ("≈ 50 kr/mån"-raden), avrundat till hela kronor (599/12 = 49,92 → 50). */
export function yearlyPerMonth(offers: PremiumOffers): string | null {
  const y = offers.yearly;
  if (!y.available || typeof y.amount !== "number" || y.amount <= 0) return null;
  return formatPremiumPrice(Math.round(y.amount / 12), y.currency ?? LIST_CURRENCY);
}

/**
 * Hur mycket billigare årsplanen är än 12 × månadsplanen, i hela procent —
 * eller null om det inte går att räkna ut ärligt (okända belopp, olika valuta,
 * eller ingen verklig besparing). 79 × 12 = 948 → 599 är 37 % billigare.
 */
export function yearlySavingsPercent(offers: PremiumOffers): number | null {
  const m = offers.monthly;
  const y = offers.yearly;
  if (!m.available || !y.available) return null;
  if (typeof m.amount !== "number" || typeof y.amount !== "number" || m.amount <= 0 || y.amount <= 0) return null;
  if ((m.currency ?? LIST_CURRENCY) !== (y.currency ?? LIST_CURRENCY)) return null;
  const pct = Math.round((1 - y.amount / (m.amount * 12)) * 100);
  return pct >= 5 ? pct : null;
}

function listOffer(plan: PremiumPlan, available: boolean, trialDays: number): PremiumOffer {
  return {
    price: formatPremiumPrice(LIST_PRICE[plan], LIST_CURRENCY),
    period: plan === "yearly" ? "year" : "month",
    trialDays: available ? trialDays : 0,
    available,
    amount: LIST_PRICE[plan],
    currency: LIST_CURRENCY,
  };
}

type ServerOffers = {
  trialEligible: boolean;
  trialDays: number;
  stripe: Record<PremiumPlan, { available: boolean; amount: number | null; currency: string | null }>;
};

async function fetchServerOffers(): Promise<ServerOffers | null> {
  try {
    const res = await fetch("/api/billing/offers", { cache: "no-store" });
    if (!res.ok) return null;
    const js = (await res.json()) as Partial<ServerOffers> & { ok?: boolean };
    if (!js.ok || !js.stripe) return null;
    return {
      trialEligible: Boolean(js.trialEligible),
      trialDays: typeof js.trialDays === "number" ? js.trialDays : DEFAULT_TRIAL_DAYS,
      stripe: js.stripe,
    };
  } catch {
    return null;
  }
}

/** Native-anrop kan hänga (StoreKit utan nät) — ge upp efter ms och använd fallback. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

type AppleConfig = { enabled: boolean; products: { monthly: string | null; yearly: string | null } };

async function fetchAppleConfig(): Promise<AppleConfig> {
  const res = await fetch("/api/apple/iap/config", { cache: "no-store" });
  const config = (await res.json()) as {
    enabled?: boolean;
    products?: { monthly?: string | null; yearly?: string | null };
  };
  return {
    enabled: Boolean(config.enabled),
    products: { monthly: config.products?.monthly ?? null, yearly: config.products?.yearly ?? null },
  };
}

/** SubscriptionPeriod.unit (0 dag, 1 vecka, 2 månad, 3 år) → dagar. */
function periodDays(p: { numberOfUnits?: number; unit?: number; unitString?: string } | null | undefined): number {
  if (!p) return 0;
  const n = p.numberOfUnits ?? 0;
  const unit = p.unitString ?? ["day", "week", "month", "year"][p.unit ?? -1];
  const per = unit === "day" ? 1 : unit === "week" ? 7 : unit === "month" ? 30 : unit === "year" ? 365 : 0;
  return n * per;
}

async function getAppleOffers(server: ServerOffers | null): Promise<PremiumOffers> {
  let cfg: AppleConfig;
  try {
    cfg = await fetchAppleConfig();
  } catch {
    return { monthly: listOffer("monthly", false, 0), yearly: listOffer("yearly", false, 0) };
  }
  const ids = cfg.enabled ? cfg.products : { monthly: null, yearly: null };
  const wanted = [ids.monthly, ids.yearly].filter((x): x is string => Boolean(x));
  // Utan svar från StoreKit: listpris, men inget löfte om provperiod.
  const fallback: PremiumOffers = {
    monthly: listOffer("monthly", Boolean(ids.monthly), 0),
    yearly: listOffer("yearly", Boolean(ids.yearly), 0),
  };
  if (!wanted.length) return fallback;

  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
    const { products } = await withTimeout(
      NativePurchases.getProducts({ productIdentifiers: wanted, productType: PURCHASE_TYPE.SUBS }),
      8000,
    );

    // Apple ger provperioden en gång per Apple-id och prenumerationsgrupp.
    // Har enheten någon transaktion för våra produkter → ingen provperiod.
    let deviceHadSub = false;
    try {
      const { purchases } = await withTimeout(NativePurchases.getPurchases({}), 4000);
      deviceHadSub = purchases.some((p) => wanted.includes(p.productIdentifier));
    } catch {
      deviceHadSub = false;
    }
    const eligible = Boolean(server?.trialEligible) && !deviceHadSub;

    const build = (plan: PremiumPlan): PremiumOffer => {
      const id = ids[plan];
      const p = id ? products.find((x) => x.identifier === id) : undefined;
      // Produkten måste finnas i StoreKit (godkänd + till salu) — annars göm den.
      if (!p) return listOffer(plan, false, 0);
      const intro = p.introductoryPrice;
      const introTrialDays =
        intro && intro.paymentMode === 0 ? periodDays(intro.subscriptionPeriod) * Math.max(1, intro.numberOfPeriods || 1) : 0;
      return {
        price: p.priceString || formatPremiumPrice(p.price, p.currencyCode || LIST_CURRENCY),
        period: plan === "yearly" ? "year" : "month",
        trialDays: eligible ? introTrialDays : 0,
        available: true,
        amount: typeof p.price === "number" ? p.price : null,
        currency: p.currencyCode || null,
      };
    };
    return { monthly: build("monthly"), yearly: build("yearly") };
  } catch (e) {
    console.warn("[premiumPurchase] StoreKit-produkter kunde inte hämtas:", e instanceof Error ? e.message : e);
    return fallback;
  }
}

type PlayConfig = {
  enabled?: boolean;
  products?: { monthly?: string | null };
  basePlans?: { monthly?: string | null; yearly?: string | null };
};

type PlayPlanConfig = { productId: string; basePlans: { monthly: string; yearly: string | null } };

async function fetchPlayConfig(): Promise<PlayPlanConfig | null> {
  const res = await fetch("/api/google/play/config", { cache: "no-store" });
  const config = (await res.json()) as PlayConfig;
  const productId = config.products?.monthly ?? null;
  const monthly = config.basePlans?.monthly ?? null;
  if (!config.enabled || !productId || !monthly) return null;
  return { productId, basePlans: { monthly, yearly: config.basePlans?.yearly ?? null } };
}

async function getPlayOffers(server: ServerOffers | null): Promise<PremiumOffers> {
  let cfg: PlayPlanConfig | null = null;
  try {
    cfg = await fetchPlayConfig();
  } catch {
    cfg = null;
  }
  const fallback: PremiumOffers = {
    monthly: listOffer("monthly", Boolean(cfg), 0),
    yearly: listOffer("yearly", Boolean(cfg?.basePlans.yearly), 0),
  };
  if (!cfg) return fallback;
  const conf = cfg;
  try {
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
    const { products } = await withTimeout(
      NativePurchases.getProducts({ productIdentifiers: [conf.productId], productType: PURCHASE_TYPE.SUBS }),
      8000,
    );
    // Play: en rad per erbjudande. identifier = baserplanen; offerId null =
    // själva baserplanen, offerId satt = ett erbjudande (vår provperiod). Play
    // returnerar bara erbjudanden användaren har rätt till ("Ny kund"), så ett
    // erbjudande på baserplanen = provperioden gäller. Längden exponeras inte av
    // pluginet — den är 7 dagar enligt konfigurationen i Play Console.
    const build = (plan: PremiumPlan): PremiumOffer => {
      const basePlan = conf.basePlans[plan];
      if (!basePlan) return listOffer(plan, false, 0);
      const base = products.find((p) => p.identifier === basePlan && !p.offerId);
      if (!base) return listOffer(plan, false, 0);
      const hasTrialOffer = products.some((p) => p.identifier === basePlan && Boolean(p.offerId));
      const trialDays = hasTrialOffer && server?.trialEligible ? server.trialDays : 0;
      return {
        price: base.priceString || formatPremiumPrice(base.price, base.currencyCode || LIST_CURRENCY),
        period: plan === "yearly" ? "year" : "month",
        trialDays,
        available: true,
        amount: typeof base.price === "number" ? base.price : null,
        currency: base.currencyCode || null,
      };
    };
    return { monthly: build("monthly"), yearly: build("yearly") };
  } catch (e) {
    console.warn("[premiumPurchase] Play-produkter kunde inte hämtas:", e instanceof Error ? e.message : e);
    return fallback;
  }
}

function getStripeOffers(server: ServerOffers | null): PremiumOffers {
  const trial = server?.trialEligible ? server.trialDays : 0;
  const build = (plan: PremiumPlan): PremiumOffer => {
    const s = server?.stripe?.[plan];
    if (!s?.available) return listOffer(plan, false, 0);
    if (typeof s.amount === "number") {
      const currency = s.currency ?? LIST_CURRENCY;
      return {
        price: formatPremiumPrice(s.amount, currency),
        period: plan === "yearly" ? "year" : "month",
        trialDays: trial,
        available: true,
        amount: s.amount,
        currency,
      };
    }
    return listOffer(plan, true, trial);
  };
  return { monthly: build("monthly"), yearly: build("yearly") };
}

let offersCache: { at: number; value: Promise<PremiumOffers> } | null = null;
const OFFERS_TTL_MS = 2 * 60 * 1000;

/** Glöm cachade erbjudanden (efter köp/återställning, eller inloggning). */
export function invalidatePremiumOffers(): void {
  offersCache = null;
}

/**
 * Priser att visa i betalväggar. Butikens lokaliserade pris när det finns
 * (StoreKit / Play / Stripe), annars listpriset (79 kr / 599 kr). trialDays > 0
 * bara när provperioden faktiskt gäller den här användaren. Kastar aldrig.
 * Cachas 2 min så flera ytor på samma skärm inte frågar butiken var för sig.
 */
export function getPremiumOffers(): Promise<PremiumOffers> {
  if (offersCache && Date.now() - offersCache.at < OFFERS_TTL_MS) return offersCache.value;
  const value = (async (): Promise<PremiumOffers> => {
    const server = await fetchServerOffers();
    if (isNativeIos()) return getAppleOffers(server);
    if (isNativeAndroid()) return getPlayOffers(server);
    return getStripeOffers(server);
  })().catch(
    (): PremiumOffers => ({ monthly: listOffer("monthly", false, 0), yearly: listOffer("yearly", false, 0) }),
  );
  offersCache = { at: Date.now(), value };
  return value;
}

/** Mät provperiodsstarten i tratten (bara nya enheter spåras; best effort). */
async function trackTrialStart(plan: PremiumPlan): Promise<void> {
  try {
    const offers = await (offersCache?.value ?? Promise.resolve(null));
    if (offers && offers[plan].trialDays > 0) funnel("trial_start", { plan });
  } catch {
    /* no-op */
  }
}

/* ---------- Köp ---------- */

/** True om felet är användarens egna avbryt (ska inte visas som fel). */
function isUserCancelled(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("cancel") || m.includes("avbr");
}

async function startAppleIapPurchase(plan: PremiumPlan): Promise<PurchaseResult> {
  try {
    const config = await fetchAppleConfig();
    const productId = config.products[plan];

    if (!config.enabled || !productId) {
      return {
        ok: false,
        message: clientMsg("purchaseUnavailableRetry"),
      };
    }

    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

    const transaction = await NativePurchases.purchaseProduct({
      productIdentifier: productId,
      productType: PURCHASE_TYPE.SUBS,
    });

    const verifyRes = await fetch("/api/apple/iap/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        transactionId: transaction.transactionId,
        environment: transaction.environment,
      }),
    });

    if (!verifyRes.ok) {
      return {
        ok: false,
        message:
          clientMsg("purchaseUnverified"),
      };
    }

    void trackTrialStart(plan);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isUserCancelled(message)) {
      return { ok: false, message: "", cancelled: true };
    }
    console.error("[premiumPurchase] IAP misslyckades:", message);
    return { ok: false, message: clientMsg("purchaseFailed") };
  }
}

async function verifyPlayToken(purchaseToken: string): Promise<{ ok: boolean; active?: boolean; message?: string }> {
  const res = await fetch("/api/google/play/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ purchaseToken }),
  });
  const js = (await res.json().catch(() => null)) as { ok?: boolean; active?: boolean; message?: string } | null;
  return { ok: res.ok && Boolean(js?.ok), active: js?.active, message: js?.message };
}

/** Android: Google Play Billing via @capgo/native-purchases, verifierat server-side. */
async function startGooglePlayPurchase(plan: PremiumPlan): Promise<PurchaseResult> {
  try {
    const cfg = await fetchPlayConfig();
    const basePlan = cfg?.basePlans[plan] ?? null;
    if (!cfg || !basePlan) return { ok: false, message: clientMsg("purchaseUnavailableRetry") };

    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
    const transaction = await NativePurchases.purchaseProduct({
      productIdentifier: cfg.productId,
      planIdentifier: basePlan,
      productType: PURCHASE_TYPE.SUBS,
    });
    const token = transaction.purchaseToken;
    if (!token) return { ok: false, message: clientMsg("purchaseUnverified") };

    const v = await verifyPlayToken(token);
    if (!v.ok) return { ok: false, message: clientMsg("purchaseUnverified") };
    void trackTrialStart(plan);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isUserCancelled(message)) return { ok: false, message: "", cancelled: true };
    console.error("[premiumPurchase] Play Billing misslyckades:", message);
    return { ok: false, message: clientMsg("purchaseFailed") };
  }
}

/** Android: hittar aktiv prenumeration i Google Play och verifierar den server-side. */
async function restoreGooglePlayPurchases(): Promise<PurchaseResult> {
  try {
    const cfg = await fetchPlayConfig();
    if (!cfg) return { ok: false, message: clientMsg("purchaseUnavailable") };
    const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
    await NativePurchases.restorePurchases().catch(() => {});
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });
    // Månad och år är baserplaner i SAMMA prenumeration → samma produkt-id.
    const latest = purchases
      .filter((p) => p.productIdentifier === cfg.productId && p.purchaseToken)
      .sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""))[0];
    if (!latest?.purchaseToken) return { ok: false, message: clientMsg("noActiveSubscription") };
    const v = await verifyPlayToken(latest.purchaseToken);
    if (!v.ok) return { ok: false, message: v.message ?? clientMsg("purchaseVerifyFailed") };
    if (v.active === false) return { ok: false, message: clientMsg("subscriptionExpired") };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isUserCancelled(message)) return { ok: false, message: "", cancelled: true };
    console.error("[premiumPurchase] Play-återställning misslyckades:", message);
    return { ok: false, message: clientMsg("restoreFailed") };
  }
}

async function startStripeCheckout(plan: PremiumPlan): Promise<PurchaseResult> {
  try {
    const r = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ plan }),
    });
    const js = (await r.json()) as { ok: boolean; url?: string; message?: string };
    if (js.ok && js.url) {
      window.location.href = js.url;
      return { ok: true };
    }
    return { ok: false, message: js.message ?? clientMsg("checkoutFailed") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : clientMsg("checkoutFailed") };
  }
}

/**
 * Återställer tidigare köp (App Store-krav för prenumerationer, guideline 3.8):
 * synkar StoreKit, letar upp den aktiva prenumerationstransaktionen för någon
 * av våra produkter (månad eller år) och verifierar den server-side — samma
 * verify-endpoint som vid köp. iOS + Android.
 */
export async function restorePremiumPurchases(): Promise<PurchaseResult> {
  invalidatePremiumOffers();
  if (isNativeAndroid()) return restoreGooglePlayPurchases();
  if (!isNativeIos()) {
    return { ok: false, message: clientMsg("restoreOnIos") };
  }
  try {
    const config = await fetchAppleConfig();
    const ids = [config.products.monthly, config.products.yearly].filter((x): x is string => Boolean(x));
    if (!config.enabled || !ids.length) {
      return { ok: false, message: clientMsg("purchaseUnavailable") };
    }

    const { NativePurchases } = await import("@capgo/native-purchases");

    await NativePurchases.restorePurchases();
    // Endast aktiva entitlements för inloggat Apple-id (inte hela enhetshistoriken).
    const { purchases } = await NativePurchases.getPurchases({
      onlyCurrentEntitlements: true,
    });

    const latest = purchases
      .filter((p) => ids.includes(p.productIdentifier))
      .sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""))[0];

    if (!latest) {
      return {
        ok: false,
        message: clientMsg("noActiveSubscription"),
      };
    }

    const verifyRes = await fetch("/api/apple/iap/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        transactionId: latest.transactionId,
        environment: latest.environment,
      }),
    });
    const js = (await verifyRes.json().catch(() => null)) as {
      ok?: boolean;
      active?: boolean;
      message?: string;
    } | null;

    if (!verifyRes.ok || !js?.ok) {
      return { ok: false, message: js?.message ?? clientMsg("purchaseVerifyFailed") };
    }
    if (js.active === false) {
      return { ok: false, message: clientMsg("subscriptionExpired") };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isUserCancelled(message)) {
      return { ok: false, message: "", cancelled: true };
    }
    console.error("[premiumPurchase] restore misslyckades:", message);
    return { ok: false, message: clientMsg("restoreFailed") };
  }
}

/**
 * Öppnar App Stores prenumerationshantering (native iOS). Returnerar false om
 * arket inte kunde öppnas — visa då instruktionstext istället.
 */
export async function openSubscriptionManagement(): Promise<boolean> {
  // iOS: App Stores ark. Android: Google Plays prenumerationscenter (intent).
  if (!isNativeStoreApp()) return false;
  try {
    const { NativePurchases } = await import("@capgo/native-purchases");
    await NativePurchases.manageSubscriptions();
    return true;
  } catch {
    return false;
  }
}

/**
 * Startar ett premium-köp av vald plan på rätt sätt för plattformen. Vid lyckat köp:
 *   - iOS/Android: premium är aktivt direkt (verifierat server-side) — anroparen
 *     kan t.ex. navigera till /premium/success.
 *   - Webb: användaren redirectas till Stripe Checkout (funktionen returnerar
 *     ok:true precis innan navigeringen sker).
 * En plan som inte är konfigurerad ger ok:false med ett "inte tillgängligt"-
 * meddelande (ingen krasch) — betalväggarna gömmer den via getPremiumOffers().
 */
export async function startPremiumPurchase(plan: PremiumPlan = "monthly"): Promise<PurchaseResult> {
  // Gäst? Rekommendera konto först — annars är köpet knutet till en session
  // som försvinner vid utloggning eller gäststädningen. "Köp ändå" går vidare.
  if (!(await ensureAccountBeforePremium())) return { ok: false, message: "", cancelled: true };
  let result: PurchaseResult;
  if (isNativeIos()) result = await startAppleIapPurchase(plan);
  // Android-appen: Google Play Billing (Play-policyn förbjuder Stripe i appen).
  else if (isNativeAndroid()) result = await startGooglePlayPurchase(plan);
  else return startStripeCheckout(plan);
  if (result.ok) invalidatePremiumOffers();
  return result;
}

/**
 * CTA-hjälpare för "uppgradera"-ytor (annonskort, badge, popup):
 * webben navigerar till /premium (marknadsföringssidan; med ?plan= när en plan
 * anges så den blir förvald), native iOS/Android startar köpflödet direkt för
 * planen (default "monthly", så gamla anrop fungerar) och går till
 * /premium/success när det lyckas.
 */
export async function goPremium(plan?: PremiumPlan): Promise<void> {
  if (!isNativeStoreApp()) {
    window.location.href = plan ? `/premium?plan=${plan}` : "/premium";
    return;
  }
  const result = await startPremiumPurchase(plan ?? "monthly");
  if (result.ok) {
    window.location.href = "/premium/success";
  } else if (!result.cancelled && result.message) {
    window.location.href = "/premium";
  }
}
