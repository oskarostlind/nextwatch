// app/api/admin/mail/route.ts — GET ?box=inbox|sent&after=<id>
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";
import { isEmailConfigured, ResendError } from "@/lib/email";
import { listMail, type MailBox } from "@/lib/adminMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: false, configured: false, message: "RESEND_API_KEY saknas i Vercel." }, { status: 503 });
  }

  const url = new URL(req.url);
  const box: MailBox = url.searchParams.get("box") === "sent" ? "sent" : "inbox";
  try {
    const r = await listMail(box, url.searchParams.get("after"));
    return NextResponse.json({ ok: true, box, ...r });
  } catch (e) {
    const status = e instanceof ResendError ? e.status : 500;
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Fel" }, { status: status >= 400 ? status : 500 });
  }
}
