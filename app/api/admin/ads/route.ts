// app/api/admin/ads/route.ts — GET ?days=7|30|90|365 → AdMob-statistik (lib/admobReport).
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";
import { admobConfigured, getAdmobStats } from "@/lib/admobReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  if (!admobConfigured()) return NextResponse.json({ ok: true, configured: false, stats: null });

  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  const stats = await getAdmobStats(days);
  return NextResponse.json({ ok: true, configured: true, stats });
}
