// app/api/stripe/checkout/route.ts
//
// Webbköp av Premium (Stripe Checkout). Aldrig i apparna — iOS köper via
// StoreKit och Android via Google Play (lib/premiumPurchase.ts).
//
// plan: "yearly" (599 kr/år) | "monthly" (79 kr/mån, default) | "lifetime"
// (legacy engångsköp, orört). Priset väljs ALLTID på servern ur env — klienten
// kan inte skicka in ett eget Price-id (då hade vem som helst kunnat köpa på
// det gamla 19 kr-priset). 7 dagars provperiod bara för den som aldrig haft
// Premium (isStripeTrialEligible).
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { apiMsg } from "@/lib/apiMessages";
import { PREMIUM_TRIAL_DAYS, getStripe, isStripeTrialEligible, stripePriceId } from "../_plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  /** "yearly" (599 kr/år), "monthly" (79 kr/mån, default) eller "lifetime" (legacy engångsköp). */
  plan?: string;
  /** Relativ sökväg på samma sajt ("/premium/success"); allt annat ignoreras. */
  successUrl?: string;
  cancelUrl?: string;
};

type Plan = "monthly" | "yearly" | "lifetime";

function parsePlan(raw: unknown): Plan {
  return raw === "yearly" || raw === "lifetime" ? raw : "monthly";
}

/** Bara relativa sökvägar på samma origin — ingen öppen redirect. */
function sameOriginUrl(origin: string, raw: unknown, fallbackPath: string): string {
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) return `${origin}${raw}`;
  return `${origin}${fallbackPath}`;
}

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
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { ok: false, message: await apiMsg("purchasesUnavailable") },
        { status: 503 }
      );
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as CheckoutBody;
    const plan = parsePlan(body.plan);
    const isSubscription = plan !== "lifetime";

    const priceId = isSubscription ? stripePriceId(plan) : process.env.STRIPE_PRICE_LIFETIME || null;

    if (!priceId) {
      // Planen är inte konfigurerad (env saknas) — klienten gömmer den normalt,
      // så hit kommer bara gamla klienter. Ingen krasch, bara "inte tillgängligt".
      console.warn(`[stripe/checkout] pris saknas för plan ${plan}`);
      return NextResponse.json(
        { ok: false, message: await apiMsg("purchasesUnavailable") },
        { status: 503 }
      );
    }

    const origin = resolveOrigin(req);
    const successUrl = sameOriginUrl(origin, body.successUrl, "/premium/success");
    const cancelUrl = sameOriginUrl(origin, body.cancelUrl, "/premium");

    const uid = req.cookies.get("nw_uid")?.value ?? undefined;

    // För prenumerationer kopplar vi en riktig Stripe-customer så att
    // förnyelser och Billing Portal fungerar.
    const customerId = isSubscription && uid ? await ensureStripeCustomer(stripe, uid) : undefined;
    const trial = isSubscription ? await isStripeTrialEligible(stripe, uid, customerId) : false;

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      ...(customerId ? { customer: customerId } : {}),
      metadata: uid ? { uid, product: plan } : { product: plan },
      ...(isSubscription
        ? {
            subscription_data: {
              metadata: uid ? { uid, plan } : { plan },
              ...(trial ? { trial_period_days: PREMIUM_TRIAL_DAYS } : {}),
            },
          }
        : {}),
    });

    return NextResponse.json({ ok: true, url: session.url, trial }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : await apiMsg("internalError");
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
