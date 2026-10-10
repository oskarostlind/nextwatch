// app/api/admin/mail/[id]/route.ts — GET ?box=inbox|sent → hela mejlet
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";
import { ResendError } from "@/lib/email";
import { getMail, type MailBox } from "@/lib/adminMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });

  const { id } = await params;
  const box: MailBox = new URL(req.url).searchParams.get("box") === "sent" ? "sent" : "inbox";
  try {
    const mail = await getMail(box, id);
    if (!mail) return NextResponse.json({ ok: false, message: "Hittades inte" }, { status: 404 });
    return NextResponse.json({ ok: true, mail });
  } catch (e) {
    const status = e instanceof ResendError ? e.status : 500;
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Fel" }, { status: status >= 400 ? status : 500 });
  }
}
