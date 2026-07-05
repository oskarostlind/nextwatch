// app/api/apple/iap/verify/route.ts
//
// Verifierar ett Apple IAP-köp server-side (samma mönster som AvyraCards):
// klienten skickar transactionId från StoreKit; vi hämtar transaktionen
// signerad direkt från App Store Server API, validerar produkt-id och ger
// användaren premium. Klientdata litas aldrig på för själva entitlementet.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  fetchAppStoreTransaction,
  grantPremiumFromIap,
  isAppleIapConfigured,
  isKnownIapProduct,
} from "@/lib/appleIap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verifySchema = z.object({
  transactionId: z.string().min(1),
  environment: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
    }

    if (!isAppleIapConfigured()) {
      return NextResponse.json(
        { ok: false, message: "IAP är inte konfigurerat ännu." },
        { status: 503 }
      );
    }

    const parsed = verifySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "Ogiltig förfrågan." }, { status: 400 });
    }

    const transaction = await fetchAppStoreTransaction(
      parsed.data.transactionId,
      parsed.data.environment
    );

    if (!isKnownIapProduct(transaction.productId)) {
      return NextResponse.json({ ok: false, message: "Okänd produkt." }, { status: 400 });
    }

    const purchasedAt = transaction.purchaseDate ? new Date(transaction.purchaseDate) : new Date();
    const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate) : null;

    await grantPremiumFromIap({
      uid,
      transactionId: transaction.transactionId,
      productId: transaction.productId,
      environment: transaction.environment,
      purchasedAt,
      expiresAt,
    });

    return NextResponse.json({ ok: true, productId: transaction.productId, expiresAt });
  } catch (error) {
    console.error("[apple/iap/verify]", error);
    return NextResponse.json(
      { ok: false, message: "Kunde inte verifiera köpet." },
      { status: 500 }
    );
  }
}
