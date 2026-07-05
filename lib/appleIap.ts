// lib/appleIap.ts
//
// Apple In-App Purchase (iOS-premium) via App Store Server API.
// Samma mönster som AvyraCards: klienten köper med @capgo/native-purchases
// (StoreKit 2) och postar transactionId till /api/apple/iap/verify; servern
// hämtar transaktionen signerad direkt från Apple, validerar produkt-id och
// sätter premium på användaren (subProvider "apple" — se lib/entitlements.ts).
//
// Till skillnad från Stripe finns ingen webhook (App Store Server Notifications
// är ett senare steg), så förnyelser synkas "lazy": refreshAppleSubscription()
// frågar Apple om aktuell prenumerationsstatus när perioden närmar sig slutet,
// anropad från /api/billing/status.
//
// Env (App Store Connect → Users and Access → Integrations → In-App Purchase):
//   APPLE_IAP_ISSUER_ID        Issuer ID
//   APPLE_IAP_KEY_ID           Key ID för API-nyckeln
//   APPLE_IAP_PRIVATE_KEY      .p8-innehållet, med \n som radbrytningar
//   APPLE_IAP_PREMIUM_MONTHLY  produkt-id, t.ex. "com.nextwatch.premium.monthly"
// Valfri:
//   APPLE_IAP_BUNDLE_ID        default "com.nextwatch.app"

import * as jose from "jose";
import { prisma } from "@/lib/prisma";

export function getIapProductIds(): { monthly: string | null } {
  return { monthly: process.env.APPLE_IAP_PREMIUM_MONTHLY ?? null };
}

export function isKnownIapProduct(productId: string): boolean {
  const ids = getIapProductIds();
  return productId === ids.monthly && productId.length > 0;
}

export function isAppleIapConfigured(): boolean {
  return Boolean(
    process.env.APPLE_IAP_PREMIUM_MONTHLY &&
      process.env.APPLE_IAP_KEY_ID &&
      process.env.APPLE_IAP_ISSUER_ID &&
      process.env.APPLE_IAP_PRIVATE_KEY
  );
}

function getBundleId(): string {
  return process.env.APPLE_IAP_BUNDLE_ID ?? "com.nextwatch.app";
}

type DecodedTransactionInfo = {
  transactionId: string;
  productId: string;
  expiresDate?: number; // unix-millisekunder
  purchaseDate?: number; // unix-millisekunder
  environment?: string;
};

/** Kortlivad JWT för App Store Server API (ES256, samma nyckelformat som APNs). */
async function createAppStoreApiToken(): Promise<string> {
  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const privateKeyRaw = process.env.APPLE_IAP_PRIVATE_KEY;
  if (!keyId || !issuerId || !privateKeyRaw) {
    throw new Error("APPLE_IAP_KEY_ID/ISSUER_ID/PRIVATE_KEY saknas");
  }

  const privateKey = await jose.importPKCS8(privateKeyRaw.replace(/\\n/g, "\n"), "ES256");

  return new jose.SignJWT({ bid: getBundleId() })
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuerId)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function getAppStoreBaseUrl(environment?: string): string {
  if (environment === "Sandbox" || environment === "Xcode") {
    return "https://api.storekit-sandbox.itunes.apple.com";
  }
  return "https://api.storekit.itunes.apple.com";
}

/** Avkodar payload-delen ur en JWS från Apple (signaturen litar vi på – hämtad över TLS direkt från Apple). */
function decodeSignedPayload<T>(signed: string): T {
  const parts = signed.split(".");
  if (parts.length < 2) throw new Error("Ogiltig signerad payload från Apple");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as T;
}

function assertTransactionFields(payload: DecodedTransactionInfo): DecodedTransactionInfo {
  if (!payload.transactionId || !payload.productId) {
    throw new Error("Transaktionsdata saknar obligatoriska fält");
  }
  return payload;
}

/**
 * Hämtar en enskild transaktion från App Store Server API.
 * Provar production först och faller tillbaka på sandbox (TestFlight-köp
 * hamnar i sandbox-miljön), precis som AvyraCards.
 */
export async function fetchAppStoreTransaction(
  transactionId: string,
  environmentHint?: string
): Promise<DecodedTransactionInfo> {
  const token = await createAppStoreApiToken();
  const baseUrl = getAppStoreBaseUrl(environmentHint);

  const response = await fetch(`${baseUrl}/inApps/v1/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    if (environmentHint !== "Sandbox") {
      return fetchAppStoreTransaction(transactionId, "Sandbox");
    }
    throw new Error(`App Store API svarade ${response.status}`);
  }

  const data = (await response.json()) as { signedTransactionInfo?: string };
  if (!data.signedTransactionInfo) {
    throw new Error("App Store API returnerade ingen transaktion");
  }

  return assertTransactionFields(decodeSignedPayload<DecodedTransactionInfo>(data.signedTransactionInfo));
}

/**
 * Ger användaren premium utifrån en verifierad Apple-transaktion.
 * Idempotent per transactionId. Entitlement gatas därefter av
 * subCurrentPeriodEnd (= Apples expiresDate) i lib/entitlements.ts, så
 * premium upphör automatiskt om prenumerationen inte förnyas/omsynkas.
 */
export async function grantPremiumFromIap(params: {
  uid: string;
  transactionId: string;
  productId: string;
  environment?: string;
  purchasedAt: Date;
  expiresAt: Date | null;
}): Promise<void> {
  const existing = await prisma.appleIapTransaction.findUnique({
    where: { transactionId: params.transactionId },
    select: { transactionId: true },
  });
  if (existing) return;

  await prisma.$transaction([
    prisma.appleIapTransaction.create({
      data: {
        transactionId: params.transactionId,
        userId: params.uid,
        productId: params.productId,
        environment: params.environment ?? null,
        purchasedAt: params.purchasedAt,
        expiresAt: params.expiresAt,
      },
    }),
    prisma.user.update({
      where: { id: params.uid },
      data: {
        plan: "premium",
        planSince: new Date(),
        subProvider: "apple",
        subStatus: "active",
        subCurrentPeriodEnd: params.expiresAt,
      },
    }),
  ]);
}

// --- Lazy förnyelsesynk -----------------------------------------------------

/** App Store-status → vår subStatus. 1=active, 2=expired, 3=billing retry, 4=grace period, 5=revoked. */
function mapSubscriptionStatus(status: number): string {
  switch (status) {
    case 1:
      return "active";
    case 3:
      return "past_due";
    case 4:
      return "trialing"; // grace period: behåll premium (räknas som aktiv i entitlements)
    case 5:
      return "revoked";
    case 2:
    default:
      return "expired";
  }
}

type SubscriptionStatusResponse = {
  data?: Array<{
    lastTransactions?: Array<{
      status: number;
      signedTransactionInfo?: string;
    }>;
  }>;
};

/**
 * Frågar Apple om aktuell prenumerationsstatus och speglar den i User.
 * Anropas lazy från /api/billing/status när en apple-prenumeration är nära
 * (eller förbi) sitt periodslut — ersätter webhooks tills App Store Server
 * Notifications är på plats. Kastar aldrig; vid fel behålls nuvarande state.
 */
export async function refreshAppleSubscription(uid: string): Promise<void> {
  try {
    if (!isAppleIapConfigured()) return;

    // Senaste kända transaktionen — vilken transaktion som helst i prenumerationen
    // duger som nyckel mot subscriptions-endpointen.
    const lastTx = await prisma.appleIapTransaction.findFirst({
      where: { userId: uid },
      orderBy: { purchasedAt: "desc" },
      select: { transactionId: true, environment: true },
    });
    if (!lastTx) return;

    const token = await createAppStoreApiToken();
    let response = await fetch(
      `${getAppStoreBaseUrl(lastTx.environment ?? undefined)}/inApps/v1/subscriptions/${lastTx.transactionId}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!response.ok && lastTx.environment !== "Sandbox") {
      response = await fetch(
        `${getAppStoreBaseUrl("Sandbox")}/inApps/v1/subscriptions/${lastTx.transactionId}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
    }
    if (!response.ok) return;

    const payload = (await response.json()) as SubscriptionStatusResponse;
    const latest = payload.data?.[0]?.lastTransactions?.[0];
    if (!latest?.signedTransactionInfo) return;

    const tx = assertTransactionFields(
      decodeSignedPayload<DecodedTransactionInfo>(latest.signedTransactionInfo)
    );
    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate) : null;

    await prisma.user.update({
      where: { id: uid },
      data: {
        subStatus: mapSubscriptionStatus(latest.status),
        subCurrentPeriodEnd: expiresAt,
      },
    });

    // Spara förnyelsetransaktionen för framtida statusuppslag (idempotent).
    await prisma.appleIapTransaction
      .upsert({
        where: { transactionId: tx.transactionId },
        update: { expiresAt },
        create: {
          transactionId: tx.transactionId,
          userId: uid,
          productId: tx.productId,
          environment: tx.environment ?? null,
          purchasedAt: tx.purchaseDate ? new Date(tx.purchaseDate) : new Date(),
          expiresAt,
        },
      })
      .catch(() => {});
  } catch (e) {
    console.warn("[appleIap] refreshAppleSubscription misslyckades:", e instanceof Error ? e.message : e);
  }
}
