import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { computeEntitlement } from "../../../../lib/entitlements";
import { getAppleSubscriptionDetail, refreshAppleSubscription } from "../../../../lib/appleIap";
import { getGoogleSubscriptionDetail, refreshGoogleSubscription } from "../../../../lib/googlePlay";
import { getStripe } from "../../stripe/_plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_SELECT = {
  plan: true,
  planSince: true,
  subProvider: true,
  subStatus: true,
  subCurrentPeriodEnd: true,
} as const;

type SubscriptionDetail = {
  plan: "monthly" | "yearly" | null;
  /** Vad prenumeranten faktiskt betalar per period (befintliga: 19 kr). */
  amount: number | null;
  currency: string | null;
};

/** Stripe: planen och priset på kundens senaste prenumeration. Kastar aldrig. */
async function getStripeSubscriptionDetail(uid: string): Promise<SubscriptionDetail | null> {
  try {
    const stripe = getStripe();
    if (!stripe) return null;
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { stripeCustomerId: true } });
    if (!u?.stripeCustomerId) return null;
    const subs = await stripe.subscriptions.list({ customer: u.stripeCustomerId, status: "all", limit: 1 });
    const price = subs.data[0]?.items?.data?.[0]?.price;
    if (!price) return null;
    const interval = price.recurring?.interval;
    return {
      plan: interval === "year" ? "yearly" : interval === "month" ? "monthly" : null,
      amount: typeof price.unit_amount === "number" ? price.unit_amount / 100 : null,
      currency: price.currency ? price.currency.toUpperCase() : null,
    };
  } catch (e) {
    console.warn("[billing/status] stripe detail:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * GET /api/billing/status            — entitlement (billig, anropas ofta)
 * GET /api/billing/status?detail=1   — dessutom `subscription` = plan + det pris
 *   prenumeranten faktiskt betalar, hämtat från butiken. Bara /premium ber om
 *   det (kostar ett API-anrop mot Apple/Google/Stripe).
 */
export async function GET(req: NextRequest) {
  const wantDetail = req.nextUrl.searchParams.get("detail") === "1";
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) return NextResponse.json({ ok: false, error: "no cookie" }, { status: 400 });

  let user = await prisma.user.findUnique({
    where: { id: uid },
    select: USER_SELECT,
  });

  // Apple-prenumerationer saknar webhook — synka mot App Store när perioden
  // är nära slutet eller redan passerad (lazy förnyelse, se lib/appleIap.ts).
  if (
    user?.subProvider === "apple" &&
    user.plan === "premium" &&
    (!user.subCurrentPeriodEnd ||
      user.subCurrentPeriodEnd.getTime() < Date.now() + 12 * 60 * 60 * 1000)
  ) {
    await refreshAppleSubscription(uid);
    user = await prisma.user.findUnique({ where: { id: uid }, select: USER_SELECT });
  }

  // Samma lazy-synk för Google Play (Android-appen).
  if (
    user?.subProvider === "google" &&
    user.plan === "premium" &&
    (!user.subCurrentPeriodEnd ||
      user.subCurrentPeriodEnd.getTime() < Date.now() + 12 * 60 * 60 * 1000)
  ) {
    await refreshGoogleSubscription(uid);
    user = await prisma.user.findUnique({ where: { id: uid }, select: USER_SELECT });
  }

  const ent = computeEntitlement(user);

  let subscription: SubscriptionDetail | null = null;
  if (wantDetail && ent.isPremium && ent.source !== "lifetime") {
    subscription =
      ent.source === "apple"
        ? await getAppleSubscriptionDetail(uid)
        : ent.source === "google"
          ? await getGoogleSubscriptionDetail(uid)
          : await getStripeSubscriptionDetail(uid);
  }

  return NextResponse.json({
    ok: true,
    plan: user?.plan ?? "free",
    planSince: user?.planSince ?? null,
    isPremium: ent.isPremium,
    source: ent.source,
    status: ent.status,
    renewsAt: ent.renewsAt,
    ...(wantDetail ? { subscription } : {}),
  });
}
