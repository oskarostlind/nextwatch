// app/api/admin/asc-downloads/route.ts — App Store-källor i /admin.
//   GET  → cachade siffror (asc_download_stats) + synkstatus + vilka env som saknas
//   POST → "Uppdatera nu": hämtar nya rapportinstanser från Apple, svarar med
//          resultatet och de uppdaterade siffrorna.
// Se lib/asc/downloads.ts.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";
import { readAscPanelData, syncAscDownloads } from "@/lib/asc/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function gate(): Promise<boolean> {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  return isAdmin(uid);
}

export async function GET() {
  // 404 (inte 403) — /admin ska inte gå att upptäcka genom att proba API:t.
  if (!(await gate())) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...(await readAscPanelData()) });
}

export async function POST() {
  if (!(await gate())) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  const sync = await syncAscDownloads({ budgetMs: 45_000 });
  return NextResponse.json({ ok: true, sync, ...(await readAscPanelData()) });
}
