// app/api/auth/request-verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { randomBytes } from "crypto";
import { sendVerificationEmail } from "@/lib/email";
import { uiLocaleFromCookies } from "@/lib/serverLocale";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function computeOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/auth/verify/sent", req.url));
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const uid = jar.get("nw_uid")?.value ?? null;
    if (!uid) return NextResponse.json({ ok: false, message: await apiMsg("noSession") }, { status: 401 });

    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true } });
    if (!u?.email) return NextResponse.json({ ok: false, message: await apiMsg("noEmailRegistered") }, { status: 400 });

    await prisma.verification.deleteMany({ where: { userId: uid } });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.verification.create({ data: { token, userId: uid, email: u.email, name: null, expiresAt } });

    const origin = computeOrigin(req);
    const link = `${origin}/auth/verify?token=${token}`;
    const mailRes = await sendVerificationEmail(u.email, link, await uiLocaleFromCookies());

    return NextResponse.json({
      ok: true,
      message: mailRes.sent ? await apiMsg("verifyLinkSent") : await apiMsg("verifyLinkMailFailed"),
      verifyUrl: link,
      emailSent: mailRes.sent,
      emailProvider: mailRes.sent ? mailRes.id : mailRes.reason,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : await apiMsg("internalError");
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
