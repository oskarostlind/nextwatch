// app/api/admin/me/route.ts — lättviktsprobe för klienten: "är jag admin?".
// 200 för admin, 404 (inte 403) för alla andra — samma icke-upptäckbarhet som
// övriga /api/admin/*. Används av profilens inställningsflik för att visa
// Admin-knappen enbart för dig.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
