// app/api/auth/forgot/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";
import { randomBytes } from "crypto";
import { sendPasswordResetEmail } from "@/lib/email";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Markör i verifications.name som skiljer lösenordsåterställning från e-postverifiering. */
const RESET_MARKER = "pwreset";

function computeOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export async function POST(req: NextRequest) {
  try {
    const key = getRateLimitKey(req, null);
    if (!rateLimitAllow(key, "auth-forgot", { limit: AUTH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: await apiMsg("tooManyRequests") },
        { status: 429 },
      );
    }

    const body = (await req.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ ok: false, message: await apiMsg("emailRequired") }, { status: 400 });
    }

    // Generiskt svar oavsett om kontot finns – läcker inte vilka adresser som är registrerade.
    const genericOk = NextResponse.json({
      ok: true,
      message: await apiMsg("resetSent"),
    });

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, profile: { select: { uiLanguage: true } } },
    });
    if (!user?.email) return genericOk;

    // Rensa gamla reset-tokens för användaren (rör inte ev. e-postverifieringstoken)
    await prisma.verification.deleteMany({ where: { userId: user.id, name: RESET_MARKER } });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 timme
    await prisma.verification.create({
      data: { token, userId: user.id, email: user.email, name: RESET_MARKER, expiresAt },
    });

    const origin = computeOrigin(req);
    const link = `${origin}/auth/reset?token=${token}`;
    // Mejlet skrivs på kontots språk (Profile.uiLanguage), inte på avsändarens.
    await sendPasswordResetEmail(user.email, link, user.profile?.uiLanguage);

    return genericOk;
  } catch (e) {
    const msg = e instanceof Error ? e.message : await apiMsg("internalError");
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
