// app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  /** "monthly" (19 kr/mån, default) eller "lifetime" (engångsköp). */
  plan?: "monthly" | "lifetime";
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

/** Hämtar (eller skapar) Stripe-customer för uid och sparar id:t på användaren. */
async function ensureStripeCustomer(stripe: Stripe, uid: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { stripeCustomerId: true, email: true },
  });
  if (user?.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user?.email ?? undefined,
    metadata: { uid },
  });

  await prisma.user
    .update({ where: { id: uid }, data: { stripeCustomerId: customer.id } })
    .catch(() => {
      /* om användarraden saknas skapas den av webhooken senare */
    });

  return customer.id;
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

    const body = (await req.json().catch(() => ({}))) as CheckoutBody;
    const plan = body.plan ?? "monthly";
    const isSubscription = plan !== "lifetime";

    const priceId =
      body.priceId ??
      (isSubscription ? process.env.STRIPE_PRICE_PREMIUM_MONTHLY : process.env.STRIPE_PRICE_LIFETIME);

    if (!priceId) {
      return NextResponse.json(
        {
          ok: false,
          message: isSubscription
            ? "Missing price (set STRIPE_PRICE_PREMIUM_MONTHLY)."
            : "Missing price (set STRIPE_PRICE_LIFETIME).",
        },
        { status: 400 }
      );
    }

    const origin = resolveOrigin(req);
    const successUrl = body.successUrl ?? `${origin}/premium/success`;
    const cancelUrl = body.cancelUrl ?? `${origin}/premium`;

    const uid = req.cookies.get("nw_uid")?.value ?? undefined;

    // För prenumerationer kopplar vi en riktig Stripe-customer så att
    // förnyelser och Billing Portal fungerar.
    const customerId = isSubscription && uid ? await ensureStripeCustomer(stripe, uid) : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      ...(customerId ? { customer: customerId } : {}),
      metadata: uid ? { uid, product: plan } : { product: plan },
      ...(isSubscription
        ? { subscription_data: { metadata: uid ? { uid } : {} } }
        : {}),
    });

    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
