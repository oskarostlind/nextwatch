// app/api/swipe/limit/route.ts
//
// Läser användarens swipe-allowance (dagens gräns) så swipe-UI:t kan visa
// väggen direkt om gränsen redan är nådd. Själva enforcementen sker i
// /api/rate, /api/swipe/decide och /api/group/vote.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSwipeAllowance } from "@/lib/swipeLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) {
    return NextResponse.json({ ok: false, message: "Ingen session." }, { status: 401 });
  }

  const allowance = await getSwipeAllowance(uid);
  return NextResponse.json({ ok: true, ...allowance });
}
