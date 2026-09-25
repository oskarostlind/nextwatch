import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tillfällig diagnostik: iOS-appen rapporterar hur långt Meta SDK-starten kommer.
// Läses i Vercels runtime-loggar (sök "[meta-sdk]"). Tas bort när eventen syns i Meta.
export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* tom body */
  }
  console.log("[meta-sdk]", JSON.stringify(body));
  return NextResponse.json({ ok: true });
}
