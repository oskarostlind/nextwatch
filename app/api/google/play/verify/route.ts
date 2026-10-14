// app/api/google/play/verify/route.ts
//
// Verifierar ett Google Play-köp server-side (Android). Klienten skickar
// purchaseToken; status/utgång hämtas från Google Play Developer API och
// premium ges bara om Google säger att prenumerationen är aktiv.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  acknowledgePlaySubscription,
  fetchPlaySubscription,
  getPlayProducts,
  grantPremiumFromPlay,
  isGooglePlayConfigured,
} from "@/lib/googlePlay";
import { apiMsg } from "@/lib/apiMessages";
import { getEntitlement } from "@/lib/entitlements";
import { sendPremiumWelcomeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ purchaseToken: z.string().min(10).max(4096) });

export async function POST(req: NextRequest) {
  try {
    const uid = (await cookies()).get("nw_uid")?.value ?? null;
    if (!uid) {
      return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });
    }
    if (!isGooglePlayConfigured()) {
      return NextResponse.json({ ok: false, message: await apiMsg("purchasesUnavailable") }, { status: 503 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 400 });
    }
    const token = parsed.data.purchaseToken;
    const sub = await fetchPlaySubscription(token);
    const known = getPlayProducts().monthly;
    if (!sub.productId || sub.productId !== known) {
      return NextResponse.json({ ok: false, message: await apiMsg("iapUnknownProduct") }, { status: 400 });
    }

    const wasPremium = (await getEntitlement(uid).catch(() => null))?.isPremium ?? false;
    const result = await grantPremiumFromPlay(uid, token, sub);
    if (!sub.acknowledged) await acknowledgePlaySubscription(sub.productId, token);

    if (!result.granted && result.reason === "other_account") {
      return NextResponse.json({ ok: false, message: await apiMsg("iapOtherAccount") }, { status: 409 });
    }

    if (result.granted && !wasPremium) {
      const u = await prisma.user.findUnique({
        where: { id: uid },
        select: { email: true, profile: { select: { uiLanguage: true } } },
      });
      if (u?.email) {
        await sendPremiumWelcomeEmail(u.email, u.profile?.uiLanguage, {
          provider: "google",
          idempotencyKey: `premium-welcome/google/${sub.orderId ?? token.slice(0, 40)}`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      active: result.granted,
      productId: sub.productId,
      expiresAt: sub.expiresAt,
    });
  } catch (error) {
    console.error("[google/play/verify]", error);
    return NextResponse.json({ ok: false, message: await apiMsg("iapVerifyFailed") }, { status: 500 });
  }
}
