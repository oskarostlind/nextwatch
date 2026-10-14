// app/api/google/play/config/route.ts
//
// Publik konfiguration för Android-köpflödet (Google Play Billing). Motsvarar
// /api/apple/iap/config. Prenumerations- och baserplans-id:n är publika.

import { NextResponse } from "next/server";
import { getPlayProducts, isGooglePlayConfigured } from "@/lib/googlePlay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const p = getPlayProducts();
  return NextResponse.json({
    ok: true,
    enabled: isGooglePlayConfigured(),
    products: { monthly: p.monthly },
    basePlans: { monthly: p.monthlyBasePlan },
  });
}
