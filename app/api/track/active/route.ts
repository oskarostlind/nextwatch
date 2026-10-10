// app/api/track/active/route.ts — "appen är öppen" (ActivityBeacon).
//
// Två saker, båda best effort:
//   1. users.last_active_at (throttlad ~1/min) — driver "online nu" i /admin
//      och "senast aktiv" på vänprofiler.
//   2. user_activity_days — en rad per dygn, underlaget för retention.
// Svarar alltid 200 så att klienten aldrig får fel att hantera.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { touchLastActive } from "@/lib/lastActive";
import { recordActivityDay } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const uid = (await cookies()).get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: true });
    touchLastActive(uid);
    await recordActivityDay(uid);
  } catch (e) {
    // Tabellen saknas tills `npx prisma db push` körts — inget att göra då.
    console.warn("[track/active]", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
