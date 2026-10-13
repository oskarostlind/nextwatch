// app/api/pick/reward/route.ts
//
// POST /api/pick/reward — klienten anropar när AdMob:s Rewarded-event fyrats
// (iOS). Beviljar +NW_PICK_REWARD_PICKS (3) val, max
// NW_PICK_REWARD_MAX_PER_DAY (10) gånger per kalenderdygn i Stockholm.
//
// Känd begränsning (samma som /api/swipe/bonus): vi litar på klientens ord
// att videon tittades klart — ingen AdMob SSV-callback. Dagstaket begränsar
// vad ett fusk kan ge. Premiumanvändare får också fylla på (när månadens 20
// är slut); krediterna ligger kvar tills de används.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPickQuota, grantReward } from "@/lib/aiPick/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const quota = await getPickQuota(uid);
    if (!quota) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!quota.enabled) return NextResponse.json({ ok: false, error: "disabled", quota }, { status: 403 });
    if (quota.rewardsLeftToday <= 0) {
      return NextResponse.json({ ok: false, error: "reward_limit", quota }, { status: 429 });
    }

    const res = await grantReward(uid, quota.premium, quota.enabled);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "reward_limit", quota: res.quota }, { status: 429 });
    }
    return NextResponse.json({ ok: true, quota: res.quota }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[pick/reward]", err);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
