// app/api/cron/asc-downloads/route.ts
//
// Daglig hämtning av App Store Connect-nedladdningsrapporten (källtyp +
// kampanjkod) till asc_download_stats — se lib/asc/downloads.ts. Körs via
// vercel.json en gång per dygn. Att hämta regelbundet håller också Apples
// rapportförfrågan vid liv (annars stoppedDueToInactivity).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { syncAscDownloads } from "@/lib/asc/downloads";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  // Vercel Cron skickar "Authorization: Bearer <CRON_SECRET>"; x-cron-secret
  // för manuella körningar. Samma mönster som cleanup/daily-recs.
  const header = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  return header === secret || authHeader === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const result = await syncAscDownloads({ budgetMs: 45_000 });
  // Saknad env/tabell är inget cron-fel — 200 så att Vercel inte larmar i onödan.
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
