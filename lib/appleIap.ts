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
//   APPLE_IAP_PREMIUM_MONTHLY  produkt-id för månadsplanen ("com.nextwatch.premium.monthly")
// Valfria:
//   APPLE_IAP_PRODUCT_YEARLY   produkt-id för årsplanen ("com.nextwatch.premium.yearly").
//                              Osatt → årsplanen göms i appen (månad fungerar som förut).
//                              APPLE_IAP_PREMIUM_YEARLY accepteras som alias.
//   APPLE_IAP_BUNDLE_ID        default "com.nextwatch.app"
//
// Båda produkterna MÅSTE ligga i samma prenumerationsgrupp ("NextWatch
// Premium") — då kan man byta plan utan dubbeldebitering, provperioden gäller
// en gång per grupp, och subscriptions-endpointen nedan ser båda.

import * as jose from "jose";
import { prisma } from "@/lib/prisma";

export function getIapProductIds(): { monthly: string | null; yearly: string | null } {
  const yearly = process.env.APPLE_IAP_PRODUCT_YEARLY || process.env.APPLE_IAP_PREMIUM_YEARLY || null;
  return { monthly: process.env.APPLE_IAP_PREMIUM_MONTHLY || null, yearly };
}

/** Vilken plan ett produkt-id motsvarar, eller null om det inte är vårt. */
export function iapPlanForProduct(productId: string | null | undefined): "monthly" | "yearly" | null {
  if (!productId) return null;
  const ids = getIapProductIds();
  if (ids.monthly && productId === ids.monthly) return "monthly";
  if (ids.yearly && productId === ids.yearly) return "yearly";
  return null;
}

export function isKnownIapProduct(productId: string): boolean {
  return iapPlanForProduct(productId) !== null;
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
  /** 1 = introduktionserbjudande (t.ex. gratis provperiod), 2 = kampanj, 3 = erbjudandekod, 4 = win-back. */
  offerType?: number;
  /** "FREE_TRIAL" | "PAY_AS_YOU_GO" | "PAY_UP_FRONT" (när offerType är satt). */
  offerDiscountType?: string;
  /** Pris i milli-enheter (79 kr = 79000), om Apple skickar det. */
  price?: number;
  currency?: string;
};

/** True om transaktionen är starten på en gratis provperiod. */
export function isFreeTrialTransaction(tx: { offerType?: number; offerDiscountType?: string }): boolean {
  return tx.offerType === 1 && tx.offerDiscountType === "FREE_TRIAL";
}

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

export type GrantResult =
  | { granted: true }
  | { granted: false; reason: "expired" | "other_account" };

/**
 * Ger användaren premium utifrån en verifierad Apple-transaktion. Anropas både
 * vid köp och vid "Återställ köp" (samma transactionId kan alltså komma igen
 * efter ominstallation — då uppdateras användarraden på nytt, men en
 * transaktion som redan hör till ett ANNAT konto ger aldrig premium här).
 * Utgångna transaktioner registreras för statusuppslag men rör inte
 * entitlementet — annars skulle en restore av en gammal prenumeration kunna
 * skriva över t.ex. en aktiv Stripe-prenumeration.
 * Entitlement gatas därefter av subCurrentPeriodEnd (= Apples expiresDate)
 * i lib/entitlements.ts.
 */
export async function grantPremiumFromIap(params: {
  uid: string;
  transactionId: string;
  productId: string;
  environment?: string;
  purchasedAt: Date;
  expiresAt: Date | null;
}): Promise<GrantResult> {
  const existing = await prisma.appleIapTransaction.findUnique({
    where: { transactionId: params.transactionId },
    select: { userId: true },
  });
  if (existing && existing.userId !== params.uid) {
    return { granted: false, reason: "other_account" };
  }

  const txUpsert = prisma.appleIapTransaction.upsert({
    where: { transactionId: params.transactionId },
    update: { expiresAt: params.expiresAt },
    create: {
      transactionId: params.transactionId,
      userId: params.uid,
      productId: params.productId,
      environment: params.environment ?? null,
      purchasedAt: params.purchasedAt,
      expiresAt: params.expiresAt,
    },
  });

  const isActive = !params.expiresAt || params.expiresAt.getTime() > Date.now();
  if (!isActive) {
    await txUpsert;
    return { granted: false, reason: "expired" };
  }

  await prisma.$transaction([
    txUpsert,
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
  return { granted: true };
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
      signedRenewalInfo?: string;
    }>;
  }>;
};

type DecodedRenewalInfo = {
  autoRenewProductId?: string;
  autoRenewStatus?: number; // 1 = förnyas, 0 = avstängd
  renewalPrice?: number; // milli-enheter
  currency?: string;
};

type LatestAppleStatus = {
  status: number;
  tx: DecodedTransactionInfo;
  renewal: DecodedRenewalInfo | null;
};

/**
 * Senaste prenumerationsstatusen hos Apple för användarens senast kända
 * transaktion. Går igenom ALLA grupper och transaktioner i svaret och väljer
 * den med senast utgång — månad och år ligger i samma grupp, men skulle de
 * hamna i olika grupper ska ändå den aktuella vinna. Null vid fel/okonfigurerat.
 */
async function fetchLatestAppleStatus(uid: string): Promise<LatestAppleStatus | null> {
  if (!isAppleIapConfigured()) return null;

  // Senaste kända transaktionen — vilken transaktion som helst i prenumerationen
  // duger som nyckel mot subscriptions-endpointen.
  const lastTx = await prisma.appleIapTransaction.findFirst({
    where: { userId: uid },
    orderBy: { purchasedAt: "desc" },
    select: { transactionId: true, environment: true },
  });
  if (!lastTx) return null;

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
  if (!response.ok) return null;

  const payload = (await response.json()) as SubscriptionStatusResponse;
  let best: LatestAppleStatus | null = null;
  for (const group of payload.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (!item.signedTransactionInfo) continue;
      let tx: DecodedTransactionInfo;
      try {
        tx = assertTransactionFields(decodeSignedPayload<DecodedTransactionInfo>(item.signedTransactionInfo));
      } catch {
        continue;
      }
      if (best && (best.tx.expiresDate ?? 0) >= (tx.expiresDate ?? 0)) continue;
      let renewal: DecodedRenewalInfo | null = null;
      if (item.signedRenewalInfo) {
        try {
          renewal = decodeSignedPayload<DecodedRenewalInfo>(item.signedRenewalInfo);
        } catch {
          renewal = null;
        }
      }
      best = { status: item.status, tx, renewal };
    }
  }
  return best;
}

/**
 * Frågar Apple om aktuell prenumerationsstatus och speglar den i User.
 * Anropas lazy från /api/billing/status när en apple-prenumeration är nära
 * (eller förbi) sitt periodslut — ersätter webhooks tills App Store Server
 * Notifications är på plats. Kastar aldrig; vid fel behålls nuvarande state.
 */
export async function refreshAppleSubscription(uid: string): Promise<void> {
  try {
    const latest = await fetchLatestAppleStatus(uid);
    if (!latest) return;
    const { tx } = latest;
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

export type StoreSubscriptionDetail = {
  plan: "monthly" | "yearly" | null;
  /** Det användaren faktiskt betalar per period (befintliga 19 kr-kunder ser 19 kr). */
  amount: number | null;
  currency: string | null;
};

/**
 * Plan + pris för en befintlig Apple-prenumerant (för /premium och profilen).
 * Priset tas från förnyelseinfon (= nästa debitering, där Apple behåller
 * gamla priset för befintliga prenumeranter), annars från transaktionen.
 * Kastar aldrig.
 */
export async function getAppleSubscriptionDetail(uid: string): Promise<StoreSubscriptionDetail | null> {
  try {
    const latest = await fetchLatestAppleStatus(uid);
    if (!latest) return null;
    const productId = latest.renewal?.autoRenewProductId ?? latest.tx.productId;
    const milli = latest.renewal?.renewalPrice ?? latest.tx.price ?? null;
    const currency = latest.renewal?.currency ?? latest.tx.currency ?? null;
    return {
      plan: iapPlanForProduct(productId) ?? iapPlanForProduct(latest.tx.productId),
      amount: typeof milli === "number" ? milli / 1000 : null,
      currency,
    };
  } catch (e) {
    console.warn("[appleIap] getAppleSubscriptionDetail misslyckades:", e instanceof Error ? e.message : e);
    return null;
  }
}
