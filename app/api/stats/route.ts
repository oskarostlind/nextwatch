// app/api/stats/route.ts — Mission Control-statistik (kontrakt v1, lib/stats/contract.ts).
//
// Hämtas av marknadsföringsportalens timcron med `Authorization: Bearer <STATS_TOKEN>`.
// Bara aggregerade tal — inga personuppgifter. Undantagen i middleware.ts (inga cookies).
// Saknad/ogiltig token → 401 utan mer info. Saknad STATS_TOKEN-env → 401 (fail closed).
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { collectStats } from "@/lib/stats/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store" };

let warnedNoToken = false;

function authorized(header: string | null): boolean {
  const expected = process.env.STATS_TOKEN?.trim();
  if (!expected) {
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.warn("[stats] STATS_TOKEN saknas — /api/stats svarar 401 på allt.");
    }
    return false;
  }
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  // Jämför SHA-256 av båda så att buffertarna alltid är lika långa (timingSafeEqual
  // kastar annars) och längden på tokenen inte läcker.
  const a = crypto.createHash("sha256").update(m[1].trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const stats = await collectStats();
    return NextResponse.json(stats, { headers: NO_STORE });
  } catch (e) {
    console.error("[stats] insamlingen misslyckades:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}
