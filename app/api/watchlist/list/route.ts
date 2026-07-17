// app/api/watchlist/list/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildWatchlistCards } from "@/lib/watchlistCards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, items: [], message: "Ingen session" }, { status: 401 });

    const items = await buildWatchlistCards(uid);
    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: false, items: [], message: "Internt fel" }, { status: 500 });
  }
}
