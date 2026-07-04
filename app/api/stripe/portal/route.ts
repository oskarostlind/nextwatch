// app/api/stripe/portal/route.ts
//
// Öppnar Stripe Billing Portal så att användaren kan säga upp, byta kort eller
// se fakturor för sin prenumeration. Kräver att användaren har en Stripe-customer
// (skapas vid subscription-checkout).
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveOrigin(req: NextRequest): string {
  const fromHeader = req.headers.get("origin");
  if (fromHeader) return fromHeader.replace(/\/$/, "");
  const envBase = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, message: "Stripe is not configured." }, { status: 503 });
  }

  const uid = req.cookies.get("nw_uid")?.value;
  if (!uid) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    return NextResponse.json(
      { ok: false, message: "Ingen Stripe-prenumeration hittades för det här kontot." },
      { status: 404 }
    );
  }

  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
  const origin = resolveOrigin(req);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/profile`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
