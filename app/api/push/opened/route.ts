// app/api/push/opened/route.ts
//
// Klienten (och native) anropar den här när en notis tryckts på, så push_log kan
// räkna öppningsfrekvens per typ/vinkel. pid är ett slumpat uuid som bara
// enheten som fick pushen känner till, därför krävs ingen cookie — men finns
// nw_uid måste den matcha radens användare.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PID_RE = /^[0-9a-fA-F-]{16,64}$/;

export async function POST(req: Request) {
  let pid = "";
  try {
    const body = (await req.json()) as { pid?: unknown };
    if (typeof body.pid === "string") pid = body.pid.trim();
  } catch {
    /* valideras nedan */
  }
  if (!PID_RE.test(pid)) return new NextResponse(null, { status: 400 });

  try {
    const uid = (await cookies()).get("nw_uid")?.value;
    // Bara första öppningen räknas (openedAt: null) — upprepade tryck ändrar inget.
    await prisma.pushLog.updateMany({
      where: { id: pid, openedAt: null, ...(uid ? { userId: uid } : {}) },
      data: { openedAt: new Date() },
    });
  } catch {
    /* best-effort */
  }
  return new NextResponse(null, { status: 204 });
}
