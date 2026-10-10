// app/api/auth/request-verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { randomBytes } from "crypto";
import { sendVerificationEmail } from "@/lib/email";
import { uiLocaleFromCookies } from "@/lib/serverLocale";
import { apiMsg } from "@/lib/apiMessages";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "@/lib/rateLimit";

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

    // Varje anrop skickar ett mejl — utan gräns kan sessionen användas för att
    // spamma en adress och bränna Resend-kvoten.
    if (!rateLimitAllow(getRateLimitKey(req, uid), "auth-request-verify", { limit: AUTH_LIMIT })) {
      return NextResponse.json({ ok: false, message: await apiMsg("tooManyRequests") }, { status: 429 });
    }

    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true } });
    if (!u?.email) return NextResponse.json({ ok: false, message: await apiMsg("noEmailRegistered") }, { status: 400 });

    await prisma.verification.deleteMany({ where: { userId: uid } });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.verification.create({ data: { token, userId: uid, email: u.email, name: null, expiresAt } });

    const origin = computeOrigin(req);
    const link = `${origin}/auth/verify?token=${token}`;
    const mailRes = await sendVerificationEmail(u.email, link, await uiLocaleFromCookies());
    // Verifieringslänken skickas ALDRIG tillbaka i svaret — den är beviset på
    // att man äger adressen och får bara finnas i mejlet. (Innan 2026-10-10
    // låg den i JSON:en som verifyUrl, så vem som helst kunde "bekräfta" en
    // adress de inte äger genom att läsa svaret.) Mejlfel loggas server-side.
    if (!mailRes.sent) console.error("[auth/request-verify] verifieringsmejl misslyckades:", mailRes.reason);

    return NextResponse.json({
      ok: true,
      message: mailRes.sent ? await apiMsg("verifyLinkSent") : await apiMsg("verifyLinkMailFailed"),
      emailSent: mailRes.sent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : await apiMsg("internalError");
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
