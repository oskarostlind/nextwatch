// app/api/pick/status/route.ts
//
// GET /api/pick/status → PickQuota (lib/aiPick/types.ts). Klienten
// (lib/aiPick/client.ts) läser `enabled` för att avgöra om ✦-knappen ska
// synas alls, och resten för kvotraden/betalväggen i arket.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPickQuota } from "@/lib/aiPick/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const quota = await getPickQuota(uid);
    if (!quota) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    return NextResponse.json(quota, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[pick/status]", err);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
