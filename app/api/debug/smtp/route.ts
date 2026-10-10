// app/api/debug/smtp/route.ts — SMTP (Strato) används inte längre sedan
// 2026-10-10; all e-post går via Resend. Testa med /api/debug/email?to=…
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: false, message: "SMTP används inte längre — e-post går via Resend. Testa /api/debug/email?to=…" },
    { status: 410 },
  );
}
