// app/api/swipe/bonus/route.ts
//
// Beviljar extra swipes efter en tittad rewarded video (AdMob, iOS).
// Klienten (lib/admobAds.ts watchRewardedForSwipes) anropar när
// RewardAdPluginEvents.Rewarded har fyrats. Servern äger reglerna:
//   - bara gratisanvändare med aktiv gräns (premium/obegränsat = no-op)
//   - max REWARDED_MAX_PER_DAY grants per rullande dygn (default 3)
//   - +REWARDED_SWIPE_BONUS swipes per grant (default = dagsgränsen, 100)
//
// Känd begränsning: vi litar på klientens ord att videon faktiskt tittades
// klart (ingen AdMob SSV-callback). Taket på 3/dygn begränsar vad ett fusk
// kan ge — som mest samma antal swipes som 3 videor, inget mer.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  getSwipeAllowance,
  REWARDED_MAX_PER_DAY,
  REWARDED_SWIPE_BONUS,
} from "@/lib/swipeLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) {
    return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
  }

  if (REWARDED_MAX_PER_DAY <= 0) {
    return NextResponse.json({ ok: false, error: "rewarded_disabled" }, { status: 403 });
  }

  const allowance = await getSwipeAllowance(uid);

  // Premium/obegränsat har inget att tjäna — och taket är taket.
  if (allowance.limit === null) {
    return NextResponse.json({ ok: false, error: "unlimited_already" }, { status: 403 });
  }
  if (allowance.rewardedRemaining <= 0) {
    return NextResponse.json({ ok: false, error: "rewarded_cap" }, { status: 429 });
  }

  await prisma.swipeBonus.create({
    data: { userId: uid, amount: REWARDED_SWIPE_BONUS },
  });

  const updated = await getSwipeAllowance(uid);
  return NextResponse.json({ ok: true, granted: REWARDED_SWIPE_BONUS, ...updated });
}
