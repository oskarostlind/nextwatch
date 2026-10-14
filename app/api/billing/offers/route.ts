// app/api/billing/offers/route.ts
//
// Serverns del av betalväggarnas erbjudanden (lib/premiumPurchase.ts
// getPremiumOffers()):
//   - trialEligible: har kontot aldrig haft Premium? Bara då lovar vi
//     "7 dagar gratis" (butikerna gör dessutom sin egen kontroll).
//   - stripe: vilka webbplaner som finns (env) och deras pris i Stripe.
// Butikspriserna för iOS/Android läses i appen direkt ur StoreKit/Play.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PREMIUM_TRIAL_DAYS, hasEverHadPremium } from "@/lib/entitlements";
import { getStripePlanPrices } from "../../stripe/_plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  const [hadPremium, stripe] = await Promise.all([
    uid ? hasEverHadPremium(uid) : Promise.resolve(false),
    getStripePlanPrices().catch(() => ({
      monthly: { available: false, amount: null, currency: null },
      yearly: { available: false, amount: null, currency: null },
    })),
  ]);
  return NextResponse.json({
    ok: true,
    trialEligible: !hadPremium,
    trialDays: PREMIUM_TRIAL_DAYS,
    stripe,
  });
}
