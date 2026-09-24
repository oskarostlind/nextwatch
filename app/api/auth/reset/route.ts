// app/api/auth/reset/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { hashPassword } from "../../../../lib/hash";
import { setAuthCookies } from "../../../../lib/auth";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";
import { apiMsg } from "@/lib/apiMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESET_MARKER = "pwreset";

export async function POST(req: NextRequest) {
  try {
    const key = getRateLimitKey(req, null);
    if (!rateLimitAllow(key, "auth-reset", { limit: AUTH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: await apiMsg("tooManyRequests") },
        { status: 429 },
      );
    }

    const body = (await req.json()) as { token?: string; password?: string };
    const token = (body.token ?? "").trim();
    const password = (body.password ?? "").trim();

    if (!token) {
      return NextResponse.json({ ok: false, message: await apiMsg("invalidLink") }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { ok: false, message: await apiMsg("passwordTooShort") },
        { status: 400 },
      );
    }

    const ver = await prisma.verification.findUnique({ where: { token } });
    if (!ver || ver.name !== RESET_MARKER || ver.expiresAt < new Date()) {
      return NextResponse.json(
        { ok: false, message: await apiMsg("linkExpired") },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: ver.userId },
        // Användaren har bevisat att den äger e-postadressen via länken,
        // så vi kan samtidigt markera e-posten som verifierad.
        data: { passwordHash, emailVerified: new Date(), lastLoginAt: new Date() },
      }),
      prisma.verification.deleteMany({ where: { userId: ver.userId, name: RESET_MARKER } }),
    ]);

    // Logga in användaren direkt
    const res = NextResponse.json({ ok: true, message: await apiMsg("passwordUpdated") });
    await setAuthCookies(res, ver.userId, { remember: true });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : await apiMsg("internalError");
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
