// app/api/admin/overview/route.ts — nyckeltal för admin-vyn. Endast läsning.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";
import { getAdmobEarnings, admobConfigured } from "@/lib/admobReport";

// Prenumerationspriset (kr/mån) för MRR-estimatet. Medvetet ett estimat:
// premium-antal × pris, i stället för att dra in App Store Connect Sales API —
// Apple-belopp redovisas ändå där, och 19 kr × subs räcker för dashboarden.
const PREMIUM_PRICE_SEK = Number(process.env.NW_PREMIUM_PRICE_SEK ?? 19);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    // 404 (inte 403) — /admin ska inte gå att upptäcka genom att proba API:t.
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const now = Date.now();
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    new7d,
    new30d,
    active7d,
    verified,
    premium,
    lifetime,
    stripeRevenue,
    applePurchases,
    ratingsTotal,
    groupsActive,
    latestPurchases,
    admob,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.user.count({ where: { createdAt: { gte: d30 } } }),
    prisma.user.count({ where: { lastActiveAt: { gte: d7 } } }),
    prisma.user.count({ where: { emailVerified: { not: null } } }),
    prisma.user.count({ where: { plan: "premium" } }),
    prisma.user.count({ where: { plan: "lifetime" } }),
    prisma.purchase.aggregate({ _sum: { amountTotal: true }, _count: true }),
    prisma.appleIapTransaction.count(),
    prisma.rating.count(),
    prisma.group.count(),
    prisma.purchase.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        amountTotal: true,
        currency: true,
        product: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    }),
    // Best effort med intern cache (1 h) — får aldrig fälla resten av vyn.
    getAdmobEarnings(),
  ]);

  return NextResponse.json({
    ok: true,
    stats: {
      totalUsers,
      new7d,
      new30d,
      active7d,
      verified,
      premium,
      lifetime,
      // Stripe-belopp lagras i öre (amount_total från checkout-sessionen).
      stripeRevenueSEK: (stripeRevenue._sum.amountTotal ?? 0) / 100,
      stripePurchases: stripeRevenue._count,
      // Apple redovisar beloppen i App Store Connect — här finns bara antalet.
      applePurchases,
      ratingsTotal,
      groupsActive,
      // Uppskattad MRR: antal premium × månadspris. Lifetime ingår inte (ingen
      // återkommande intäkt). Apple + Stripe skiljs inte åt — samma pris.
      mrrEstimateSEK: premium * PREMIUM_PRICE_SEK,
      premiumPriceSEK: PREMIUM_PRICE_SEK,
    },
    // null + configured=false ⇒ UI:t visar "inte uppkopplat" i stället för 0 kr.
    admob: admob ?? null,
    admobConfigured: admobConfigured(),
    latestPurchases: latestPurchases.map((p) => ({
      amountSEK: p.amountTotal / 100,
      currency: p.currency,
      product: p.product,
      createdAt: p.createdAt.toISOString(),
      email: p.user?.email ?? null,
    })),
  });
}
