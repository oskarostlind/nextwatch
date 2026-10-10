// app/api/email/inbound/route.ts — Resend-webhook för inkommande mejl.
//
// Resend sparar själva mejlet (det läses i /admin → Mejl). Webhooken finns
// bara för att du ska få en push när något kommer in, i stället för att
// behöva gå in och titta. Signeras av Resend via Svix: HMAC-SHA256 över
// "<svix-id>.<svix-timestamp>.<body>" med RESEND_WEBHOOK_SECRET (whsec_…).
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { MAIL_DOMAIN } from "@/lib/adminMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SEC = 5 * 60;

function verifySvix(secret: string, id: string, ts: string, sigHeader: string, body: string): boolean {
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > TOLERANCE_SEC) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  // Headern kan innehålla flera signaturer: "v1,abc v1,def"
  return sigHeader.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

type InboundEvent = {
  type?: string;
  data?: { from?: string; to?: string[]; subject?: string };
};

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, message: "not configured" }, { status: 503 });

  const body = await req.text();
  const ok = verifySvix(
    secret,
    req.headers.get("svix-id") ?? "",
    req.headers.get("svix-timestamp") ?? "",
    req.headers.get("svix-signature") ?? "",
    body,
  );
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  let ev: InboundEvent;
  try {
    ev = JSON.parse(body) as InboundEvent;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (ev.type !== "email.received") return NextResponse.json({ ok: true, ignored: ev.type ?? null });

  const to = ev.data?.to ?? [];
  if (!to.some((a) => a.toLowerCase().includes(`@${MAIL_DOMAIN}`))) return NextResponse.json({ ok: true, ignored: "domain" });

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    const admin = await prisma.user.findFirst({
      where: { email: { equals: adminEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (admin) {
      // "Namn <adress>" → "Namn"
      const from = (ev.data?.from ?? "Okänd").replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || "Okänd";
      await sendPushToUser(admin.id, {
        title: `Mejl från ${from}`.slice(0, 80),
        body: (ev.data?.subject || "(inget ämne)").slice(0, 140),
        data: { type: "admin_mail" },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
