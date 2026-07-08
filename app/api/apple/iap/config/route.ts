// app/api/apple/iap/config/route.ts
//
// Publik konfiguration för iOS-köpflödet (produkt-id:n är publika per design —
// de syns ändå i App Store). Klienten (lib/premiumPurchase.ts) hämtar detta
// innan den startar ett StoreKit-köp.

import { NextResponse } from "next/server";
import { getIapProductIds, isAppleIapConfigured } from "@/lib/appleIap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: isAppleIapConfigured(),
    products: getIapProductIds(),
    bundleId: process.env.APPLE_IAP_BUNDLE_ID ?? "com.nextwatch.app",
  });
}
