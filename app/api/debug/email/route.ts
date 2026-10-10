// app/api/debug/email/route.ts — skickar ett testmejl via Resend (lib/email).
// Gatad av middleware som övriga /api/debug/*.
import { NextRequest, NextResponse } from "next/server";
import { isEmailConfigured, renderEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const to = new URL(req.url).searchParams.get("to");
  if (!to) return NextResponse.json({ ok: false, message: "Ange ?to=you@example.com" }, { status: 400 });
  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: false, message: "RESEND_API_KEY saknas" }, { status: 503 });
  }
  const mail = renderEmail({
    lang: "sv",
    subject: "Test: NextWatch via Resend",
    heading: "Det funkar",
    paragraphs: ["Det här är ett testmejl från /api/debug/email."],
    footer: "NextWatch debug",
  });
  const res = await sendEmail({ to, ...mail, category: "debug" });
  return NextResponse.json({ ok: res.sent, ...res }, { status: res.sent ? 200 : 502 });
}
