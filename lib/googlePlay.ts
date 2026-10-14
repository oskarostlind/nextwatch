// lib/googlePlay.ts
//
// Google Play Billing (Android-appen) — server-side verifiering av
// prenumerationer via Google Play Developer API (purchases.subscriptionsv2).
// Motsvarigheten till lib/appleIap.ts; iOS-flödet berörs inte.
//
// Klienten (lib/premiumPurchase.ts) köper via @capgo/native-purchases och
// skickar purchaseToken hit. Vi litar aldrig på klientens påstående — status
// och utgångstid hämtas från Google och speglas i User (subProvider "google").
//
// Env:
//   GOOGLE_SERVICE_ACCOUNT_JSON   servicekonto som bjudits in i Play Console
//                                 (Användare och behörigheter → "Visa ekonomisk
//                                 data" + "Hantera beställningar och prenumerationer")
//   GOOGLE_PLAY_PACKAGE_NAME      default "com.nextwatch.app"
//   GOOGLE_PLAY_SUB_MONTHLY       prenumerations-id i Play Console (t.ex. "premium_monthly")
//   GOOGLE_PLAY_BASE_PLAN_MONTHLY baserplanens id (t.ex. "monthly")

import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken, getServiceAccount } from "@/lib/googleServiceAccount";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export function getPlayPackageName(): string {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME ?? "com.nextwatch.app";
}

export function getPlayProducts(): { monthly: string | null; monthlyBasePlan: string | null } {
  return {
    monthly: process.env.GOOGLE_PLAY_SUB_MONTHLY ?? null,
    monthlyBasePlan: process.env.GOOGLE_PLAY_BASE_PLAN_MONTHLY ?? null,
  };
}

export function isGooglePlayConfigured(): boolean {
  const p = getPlayProducts();
  return Boolean(p.monthly && p.monthlyBasePlan && getServiceAccount());
}

type SubscriptionV2 = {
  subscriptionState?: string;
  latestOrderId?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  testPurchase?: Record<string, unknown>;
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
};

export type PlaySubscription = {
  productId: string | null;
  state: string;
  expiresAt: Date | null;
  orderId: string | null;
  acknowledged: boolean;
  linkedPurchaseToken: string | null;
  test: boolean;
};

/** Hämtar prenumerationen från Google. Kastar vid nätverks-/API-fel. */
export async function fetchPlaySubscription(purchaseToken: string): Promise<PlaySubscription> {
  const access = await getGoogleAccessToken([SCOPE]);
  if (!access) throw new Error("google_auth_failed");
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(getPlayPackageName())}/purchases/subscriptionsv2/tokens/` +
    encodeURIComponent(purchaseToken);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` }, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`play_api_${res.status}: ${text.slice(0, 300)}`);
  }
  const js = (await res.json()) as SubscriptionV2;
  const known = getPlayProducts().monthly;
  const item = js.lineItems?.find((l) => l.productId === known) ?? js.lineItems?.[0];
  return {
    productId: item?.productId ?? null,
    state: js.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED",
    expiresAt: item?.expiryTime ? new Date(item.expiryTime) : null,
    orderId: js.latestOrderId ?? null,
    acknowledged: js.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    linkedPurchaseToken: js.linkedPurchaseToken ?? null,
    test: Boolean(js.testPurchase),
  };
}

/** Kvitterar köpet (Google återbetalar okvitterade köp efter 3 dagar). Best effort. */
export async function acknowledgePlaySubscription(productId: string, purchaseToken: string): Promise<void> {
  try {
    const access = await getGoogleAccessToken([SCOPE]);
    if (!access) return;
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(getPlayPackageName())}/purchases/subscriptions/` +
      `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
  } catch {
    /* klienten kvitterar också (autoAcknowledgePurchases) */
  }
}

/** Google-state → vår subStatus (samma vokabulär som Stripe/Apple i lib/entitlements.ts). */
export function mapPlayState(state: string): string {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return "active";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "trialing"; // behåll premium under grace period, som Apple
    case "SUBSCRIPTION_STATE_CANCELED":
      return "canceled"; // premium till expiryTime (withinPeriod i entitlements)
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
      return "past_due";
    case "SUBSCRIPTION_STATE_PENDING":
      return "pending";
    case "SUBSCRIPTION_STATE_EXPIRED":
    default:
      return "expired";
  }
}

function grantsAccess(sub: PlaySubscription): boolean {
  const active = sub.state === "SUBSCRIPTION_STATE_ACTIVE" || sub.state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
  const withinPeriod =
    sub.state === "SUBSCRIPTION_STATE_CANCELED" && !!sub.expiresAt && sub.expiresAt.getTime() > Date.now();
  return active || withinPeriod;
}

export type PlayGrantResult = { granted: true } | { granted: false; reason: "other_account" | "inactive" };

export async function grantPremiumFromPlay(uid: string, purchaseToken: string, sub: PlaySubscription): Promise<PlayGrantResult> {
  const owner = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM google_play_purchases WHERE purchase_token = ${purchaseToken} LIMIT 1`;
  if (owner[0] && owner[0].user_id !== uid) return { granted: false, reason: "other_account" };

  const state = mapPlayState(sub.state);
  await prisma.$executeRaw`
    INSERT INTO google_play_purchases (purchase_token, user_id, product_id, order_id, state, expires_at)
    VALUES (${purchaseToken}, ${uid}, ${sub.productId ?? ""}, ${sub.orderId}, ${state}, ${sub.expiresAt})
    ON CONFLICT (purchase_token) DO UPDATE
      SET order_id = EXCLUDED.order_id, state = EXCLUDED.state,
          expires_at = EXCLUDED.expires_at, updated_at = now()`;

  if (!grantsAccess(sub)) return { granted: false, reason: "inactive" };

  await prisma.user.update({
    where: { id: uid },
    data: {
      plan: "premium",
      planSince: new Date(),
      subProvider: "google",
      subStatus: state,
      subCurrentPeriodEnd: sub.expiresAt,
    },
  });
  return { granted: true };
}

/**
 * Lazy förnyelsesynk (som refreshAppleSubscription): anropas från
 * /api/billing/status när en google-prenumeration närmar sig periodslut.
 * Kastar aldrig.
 */
export async function refreshGoogleSubscription(uid: string): Promise<void> {
  try {
    if (!isGooglePlayConfigured()) return;
    const rows = await prisma.$queryRaw<Array<{ purchase_token: string }>>`
      SELECT purchase_token FROM google_play_purchases
      WHERE user_id = ${uid} ORDER BY updated_at DESC LIMIT 1`;
    const token = rows[0]?.purchase_token;
    if (!token) return;
    const sub = await fetchPlaySubscription(token);
    const state = mapPlayState(sub.state);
    await prisma.$executeRaw`
      UPDATE google_play_purchases SET state = ${state}, expires_at = ${sub.expiresAt}, updated_at = now()
      WHERE purchase_token = ${token}`;
    await prisma.user.update({
      where: { id: uid },
      data: { subStatus: state, subCurrentPeriodEnd: sub.expiresAt },
    });
  } catch (e) {
    console.warn("[googlePlay] refresh misslyckades:", e instanceof Error ? e.message : e);
  }
}
