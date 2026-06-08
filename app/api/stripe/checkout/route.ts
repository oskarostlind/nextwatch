// app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  priceId?: string;
  successUrl?: string;
  cancelUrl?: string;
};

/** Bästa gissning på publik origin (proxy-säker), med env som sista fallback. */
function resolveOrigin(req: NextRequest): string {
  const fromHeader = req.headers.get("origin");
  if (fromHeader) return fromHeader.replace(/\/$/, "");
  const envBase = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return NextResponse.json(
        { ok: false, message: "Stripe is not configured in this environment." },
        { status: 503 }
      );
    }

    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

    // Body är valfri – allt kan härledas på servern.
    const body = (await req.json().catch(() => ({}))) as CheckoutBody;

    const priceId = body.priceId ?? process.env.STRIPE_PRICE_LIFETIME;
    if (!priceId) {
      return NextResponse.json(
        { ok: false, message: "Missing price (set STRIPE_PRICE_LIFETIME)." },
        { status: 400 }
      );
    }

    const origin = resolveOrigin(req);
    const successUrl = body.successUrl ?? `${origin}/premium/success`;
    const cancelUrl = body.cancelUrl ?? `${origin}/premium`;

    // Koppla köpet till nuvarande session-användare så webhooken kan sätta premium.
    const uid = req.cookies.get("nw_uid")?.value ?? undefined;

    const session = await stripe.checkout.sessions.create({
      // Lifetime = engångsköp → "payment" (inte "subscription").
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      metadata: uid ? { uid, product: "lifetime" } : { product: "lifetime" },
    });

    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
