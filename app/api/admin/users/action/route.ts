// app/api/admin/users/action/route.ts — admin-åtgärder på en användare.
//
// setPlan   — flippa free/premium/lifetime (t.ex. support-ärenden, testkonton).
// delete    — radera konto + all data (cascade, samma som användarens egen radering).
// resendVerify — nytt verifieringsmail (samma mekanik som auth/request-verify,
//                men mot valfri användare i stället för sessionens).
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/adminAuth";
import { sendVerificationEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANS = new Set(["free", "premium", "lifetime"]);

function computeOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}


export async function POST(req: NextRequest) {
  const jar = await cookies();
  const me = jar.get("nw_uid")?.value ?? null;
  if (!(await isAdmin(me))) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    action?: string;
    plan?: string;
  };
  const userId = typeof body.userId === "string" ? body.userId : null;
  if (!userId) return NextResponse.json({ ok: false, message: "userId saknas." }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, plan: true },
  });
  if (!target) return NextResponse.json({ ok: false, message: "Användaren finns inte." }, { status: 404 });

  switch (body.action) {
    case "setPlan": {
      if (!body.plan || !PLANS.has(body.plan)) {
        return NextResponse.json({ ok: false, message: "Ogiltig plan." }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { plan: body.plan, planSince: body.plan === "free" ? null : new Date() },
      });
      return NextResponse.json({ ok: true, message: `Plan ändrad till ${body.plan}.` });
    }

    case "delete": {
      // Admin ska inte kunna radera sig själv av misstag från listan.
      if (userId === me) {
        return NextResponse.json({ ok: false, message: "Radera inte ditt eget konto härifrån." }, { status: 400 });
      }
      await prisma.user.delete({ where: { id: userId } });
      return NextResponse.json({ ok: true, message: "Kontot raderat (cascade)." });
    }

    case "resendVerify": {
      if (!target.email) {
        return NextResponse.json({ ok: false, message: "Användaren saknar e-post." }, { status: 400 });
      }
      await prisma.verification.deleteMany({ where: { userId } });
      const token = randomBytes(32).toString("hex");
      await prisma.verification.create({
        data: { token, userId, email: target.email, name: null, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      const link = `${computeOrigin(req)}/auth/verify?token=${token}`;
      // Mottagarens språk, inte adminens — samma regel som i forgot.
      const prof = await prisma.profile.findUnique({ where: { userId }, select: { uiLanguage: true } });
      const sent = (await sendVerificationEmail(target.email, link, prof?.uiLanguage)).sent;
      return NextResponse.json({
        ok: true,
        message: sent ? "Verifieringsmail skickat." : "Länk skapad men mailet kunde inte skickas.",
      });
    }

    default:
      return NextResponse.json({ ok: false, message: "Okänd åtgärd." }, { status: 400 });
  }
}
