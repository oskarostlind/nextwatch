// Bilaga → 302 till Resends tidsbegränsade nedladdningslänk.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdmin } from "@/lib/adminAuth";
import { getAttachmentUrl, getMail, type MailBox } from "@/lib/adminMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });

  const { id, attachmentId } = await params;
  const box: MailBox = new URL(req.url).searchParams.get("box") === "sent" ? "sent" : "inbox";
  try {
    // Samma domänkontroll som läsvyn — bara nextwatch.se-post.
    if (!(await getMail(box, id))) return NextResponse.json({ ok: false }, { status: 404 });
    const url = await getAttachmentUrl(box, id, attachmentId);
    if (!url) return NextResponse.json({ ok: false, message: "Ingen nedladdningslänk" }, { status: 404 });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Fel" }, { status: 502 });
  }
}
