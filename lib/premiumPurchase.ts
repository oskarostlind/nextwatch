// lib/premiumPurchase.ts (klient)
//
// EN ingång för alla premium-köp, plattformsmedveten:
//   - Native iOS (Capacitor)  -> Apple In-App Purchase via @capgo/native-purchases
//     (StoreKit 2), verifierat server-side i /api/apple/iap/verify. Stripe får
//     ALDRIG öppnas i iOS-appen (App Store-regel 3.1.1).
//   - Webb                    -> befintlig Stripe Checkout (/api/stripe/checkout).
//
// Samma mönster som AvyraCards ios-iap-premium-button.tsx: hämta produkt-id
// från /api/apple/iap/config, köp med purchaseProduct(), posta transactionId
// till verify-endpointen.

import { Capacitor } from "@capacitor/core";

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

/** True om felet är användarens egna avbryt (ska inte visas som fel). */
function isUserCancelled(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("cancel") || m.includes("avbr");
}

async function startAppleIapPurchase(): Promise<PurchaseResult> {
  try {
    const configRes = await fetch("/api/apple/iap/config", { cache: "no-store" });
    const config = (await configRes.json()) as {
      enabled?: boolean;
      products?: { monthly?: string | null };
    };
    const productId = config.products?.monthly ?? null;

    if (!config.enabled || !productId) {
      return {
        ok: false,
        message: "Premium-köp är inte tillgängligt i appen ännu. Försök igen senare.",
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
          "Köpet gick igenom men kunde inte verifieras. Starta om appen — kontakta oss om premium inte aktiveras.",
      };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isUserCancelled(message)) {
      return { ok: false, message: "", cancelled: true };
    }
    console.error("[premiumPurchase] IAP misslyckades:", message);
    return { ok: false, message: "Köpet kunde inte slutföras. Försök igen." };
  }
}

async function startStripeCheckout(): Promise<PurchaseResult> {
  try {
    const r = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ plan: "monthly" }),
    });
    const js = (await r.json()) as { ok: boolean; url?: string; message?: string };
    if (js.ok && js.url) {
      window.location.href = js.url;
      return { ok: true };
    }
    return { ok: false, message: js.message ?? "Kunde inte starta betalning." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Kunde inte starta betalning." };
  }
}

/**
 * Startar ett premium-köp på rätt sätt för plattformen. Vid lyckat köp:
 *   - iOS: premium är aktivt direkt (verifierat server-side) — anroparen kan
 *     t.ex. ladda om sidan eller navigera till /premium/success.
 *   - Webb: användaren redirectas till Stripe Checkout (funktionen returnerar
 *     ok:true precis innan navigeringen sker).
 */
export async function startPremiumPurchase(): Promise<PurchaseResult> {
  if (isNativeIos()) return startAppleIapPurchase();
  return startStripeCheckout();
}

/**
 * CTA-hjälpare för "uppgradera"-ytor (annonskort, badge, popup):
 * webben navigerar till /premium (marknadsföringssidan), native iOS startar
 * köpflödet direkt och går till /premium/success när det lyckas.
 */
export async function goPremium(): Promise<void> {
  if (!isNativeIos()) {
    window.location.href = "/premium";
    return;
  }
  const result = await startPremiumPurchase();
  if (result.ok) {
    window.location.href = "/premium/success";
  } else if (!result.cancelled && result.message) {
    window.location.href = "/premium";
  }
}
