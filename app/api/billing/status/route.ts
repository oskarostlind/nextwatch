import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";
import { computeEntitlement } from "../../../../lib/entitlements";
import { refreshAppleSubscription } from "../../../../lib/appleIap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_SELECT = {
  plan: true,
  planSince: true,
  subProvider: true,
  subStatus: true,
  subCurrentPeriodEnd: true,
} as const;

export async function GET() {
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

  const ent = computeEntitlement(user);

  return NextResponse.json({
    ok: true,
    plan: user?.plan ?? "free",
    planSince: user?.planSince ?? null,
    isPremium: ent.isPremium,
    source: ent.source,
    status: ent.status,
    renewsAt: ent.renewsAt,
  });
}
