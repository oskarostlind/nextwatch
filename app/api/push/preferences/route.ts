// app/api/push/preferences/route.ts
//
// Nya flödet (2026-10-15), del 5: notisfrågan i PushAskSheet sparar timmen
// användaren vill få kvällens tips (18–21, Stockholm). Cronen
// (app/api/cron/daily-recs i NW_PUSH_HOURLY-läge) låter den vinna över
// typvärdet av swipetimmarna — se lib/pushRecs/timing.ts.
//
// Fungerar även innan prisma/sql/2026-10-15_push_hour.sql körts: då svarar
// routen 503 { reason: "column_missing" } i stället för att krascha.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiMsg } from "@/lib/apiMessages";
import { isValidPushHour, savePushHour } from "@/lib/pushRecs/timing";

export async function POST(req: Request) {
  const uid = (await cookies()).get("nw_uid")?.value ?? "";
  if (!uid) {
    return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });
  }

  let hour: unknown = null;
  try {
    const body = (await req.json()) as { hour?: unknown };
    hour = body?.hour;
  } catch {
    /* valideras nedan */
  }
  if (!isValidPushHour(hour)) {
    return NextResponse.json({ ok: false, message: await apiMsg("invalidRequest") }, { status: 400 });
  }

  const res = await savePushHour(uid, hour);
  if (res === "saved") return NextResponse.json({ ok: true, hour });
  if (res === "no_profile") {
    // Gästprofilen skapas av kallstarten (del 1); utan profilrad finns inget att spara på.
    return NextResponse.json({ ok: false, reason: "no_profile" }, { status: 409 });
  }
  return NextResponse.json({ ok: false, reason: res }, { status: 503 });
}
