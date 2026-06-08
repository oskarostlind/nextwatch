// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Aktiverar premium (plan = "lifetime") när ett checkout-köp
 * slutförts, och loggar köpet i Purchase. Idempotent via upsert så att Stripes
 * retry-leveranser inte skapar dubbletter.
 */
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

  // Rå body krävs för signaturverifiering.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Endast betalda sessioner ska ge premium.
    if (session.payment_status === "paid" || session.status === "complete") {
      const uid = session.client_reference_id ?? session.metadata?.uid ?? null;

      if (uid) {
        const now = new Date();
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
        const purchaseId = paymentIntentId ?? session.id;

        try {
          await prisma.user.upsert({
            where: { id: uid },
            update: { plan: "lifetime", planSince: now },
            create: { id: uid, plan: "lifetime", planSince: now },
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
        } catch (err) {
          const message = err instanceof Error ? err.message : "DB error";
          return NextResponse.json({ ok: false, message }, { status: 500 });
        }
      }
    }
  }

  // Bekräfta mottagande för alla event-typer.
  return NextResponse.json({ received: true }, { status: 200 });
}
