// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Hanterar både:
 *  - Prenumeration (19 kr/mån): checkout.session.completed (mode=subscription)
 *    samt customer.subscription.created/updated/deleted → speglar status i DB.
 *  - Lifetime (engångsköp): checkout.session.completed (mode=payment).
 *
 * Idempotent via upsert. Entitlement (premium ja/nej) beräknas i lib/entitlements
 * utifrån plan + subStatus + subCurrentPeriodEnd.
 */

type SubLike = Stripe.Subscription;

function periodEndDate(sub: SubLike): Date | null {
  // current_period_end är unix-sekunder.
  const raw = (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}

/** Slår upp uid: i första hand subscription/customer-metadata, annars via stripeCustomerId. */
async function resolveUidForSubscription(sub: SubLike): Promise<string | null> {
  const metaUid = sub.metadata?.uid;
  if (metaUid) return metaUid;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  if (!customerId) return null;

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** Skriver prenumerationsstatus till User. plan hålls "premium"; entitlement gatar på period/status. */
async function applySubscription(uid: string, sub: SubLike): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const status = sub.status; // active | trialing | past_due | canceled | unpaid | incomplete ...
  const isActiveish = status === "active" || status === "trialing" || status === "past_due";

  await prisma.user.upsert({
    where: { id: uid },
    update: {
      plan: "premium",
      planSince: new Date(),
      subProvider: "stripe",
      subStatus: status,
      subCurrentPeriodEnd: periodEndDate(sub),
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
    create: {
      id: uid,
      plan: "premium",
      planSince: new Date(),
      subProvider: "stripe",
      subStatus: status,
      subCurrentPeriodEnd: periodEndDate(sub),
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
  });

  // Notera: om !isActiveish behåller vi plan="premium" men subStatus speglar
  // verkligheten – entitlement räknar bort premium när perioden gått ut.
  void isActiveish;
}

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !webhookSecret) {
    return NextResponse.json(
      { ok: false, message: "Stripe webhook is not configured." },
      { status: 503 }
    );
  }

  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, message: "Missing signature." }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.client_reference_id ?? session.metadata?.uid ?? null;
        if (!uid) break;

        if (session.mode === "subscription") {
          // Hämta prenumerationen för status + periodslut.
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id ?? null;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await applySubscription(uid, sub);
          } else {
            // Fallback: markera premium; subscription.created fyller i resten.
            await prisma.user.upsert({
              where: { id: uid },
              update: { plan: "premium", planSince: new Date(), subProvider: "stripe" },
              create: { id: uid, plan: "premium", planSince: new Date(), subProvider: "stripe" },
            });
          }
        } else if (session.payment_status === "paid" || session.status === "complete") {
          // Lifetime (engångsköp) – oförändrat beteende.
          const now = new Date();
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;
          const purchaseId = paymentIntentId ?? session.id;

          await prisma.user.upsert({
            where: { id: uid },
            update: { plan: "lifetime", planSince: now, subProvider: "lifetime" },
            create: { id: uid, plan: "lifetime", planSince: now, subProvider: "lifetime" },
          });

          await prisma.purchase.upsert({
            where: { id: purchaseId },
            update: {},
            create: {
              id: purchaseId,
              userId: uid,
              stripePaymentIntentId: paymentIntentId,
              amountTotal: session.amount_total ?? 0,
              currency: (session.currency ?? "sek").toUpperCase(),
              product: "lifetime",
            },
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const uid = await resolveUidForSubscription(sub);
        if (uid) await applySubscription(uid, sub);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "DB error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
