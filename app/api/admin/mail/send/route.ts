// app/api/admin/mail/send/route.ts — skicka ett eget mejl från /admin.
//
// Avsändare = ADMIN_FROM (support@nextwatch.se) så svaren landar i samma
// inkorg. Brödtexten skrivs som vanlig text och blir enkel HTML — det ska se
// ut som ett personligt mejl, inte ett systemutskick, så ingen mall här.
// Vid svar skickas In-Reply-To/References så tråden hålls ihop hos mottagaren.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { isAdmin } from "@/lib/adminAuth";
import { ADMIN_FROM, escapeHtml, isEmailConfigured, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailList = z
  .string()
  .transform((s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().email()).min(1).max(10));

const schema = z.object({
  to: emailList,
  cc: z.string().optional().default("").transform((s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.string().email()).max(10)),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(50_000),
  inReplyTo: z.string().max(500).optional(),
  references: z.string().max(4000).optional(),
});

function bodyToHtml(body: string): string {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18181b">${paras}</div>`;
}

export async function POST(req: NextRequest) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!(await isAdmin(uid))) return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  if (!isEmailConfigured()) return NextResponse.json({ ok: false, message: "RESEND_API_KEY saknas." }, { status: 503 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const msg =
      field === "to" || field === "cc" ? "Kolla mottagaradressen." : field === "subject" ? "Ämne saknas." : field === "body" ? "Meddelandet är tomt." : "Ogiltig förfrågan.";
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
  const d = parsed.data;

  const headers: Record<string, string> = {};
  if (d.inReplyTo) headers["In-Reply-To"] = d.inReplyTo;
  if (d.references || d.inReplyTo) headers["References"] = [d.references, d.inReplyTo].filter(Boolean).join(" ");

  const res = await sendEmail({
    from: ADMIN_FROM,
    to: d.to,
    cc: d.cc,
    subject: d.subject,
    html: bodyToHtml(d.body),
    text: d.body,
    headers: Object.keys(headers).length ? headers : undefined,
    category: "admin",
  });
  if (!res.sent) return NextResponse.json({ ok: false, message: `Kunde inte skicka: ${res.reason}` }, { status: 502 });
  return NextResponse.json({ ok: true, id: res.id, message: "Skickat." });
}
