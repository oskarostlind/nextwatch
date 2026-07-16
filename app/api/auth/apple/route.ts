import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import prisma from "../../../../lib/prisma";
import { verifyAppleIdentityToken } from "../../../../lib/appleAuth";
import { setAuthCookies } from "../../../../lib/auth";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const key = getRateLimitKey(req, null);
    if (!rateLimitAllow(key, "auth-apple", { limit: AUTH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: "För många inloggningsförsök." },
        { status: 429 }
      );
    }

    const { identityToken } = (await req.json()) as { identityToken?: string };
    if (!identityToken) {
      return NextResponse.json(
        { ok: false, message: "Saknar Apple-token" },
        { status: 400 }
      );
    }

    const claims = await verifyAppleIdentityToken(identityToken);

    let user = await prisma.user.findUnique({
      where: { appleSub: claims.sub },
      select: { id: true, profile: { select: { userId: true } } },
    });

    if (!user && claims.email) {
      const byEmail = await prisma.user.findUnique({
        where: { email: claims.email },
        select: {
          id: true,
          appleSub: true,
          profile: { select: { userId: true } },
        },
      });

      if (byEmail) {
        if (byEmail.appleSub && byEmail.appleSub !== claims.sub) {
          return NextResponse.json(
            { ok: false, message: "E-postadressen är kopplad till ett annat Apple-konto." },
            { status: 409 }
          );
        }
        await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            appleSub: claims.sub,
            ...(claims.emailVerified ? { emailVerified: new Date() } : {}),
          },
        });
        user = { id: byEmail.id, profile: byEmail.profile };
      }
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: claims.email ?? null,
          emailVerified: claims.emailVerified ? new Date() : null,
          appleSub: claims.sub,
        },
        select: { id: true, profile: { select: { userId: true } } },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const redirect = user.profile ? "/swipe" : "/onboarding";
    const res = NextResponse.json({ ok: true, redirect });
    await setAuthCookies(res, user.id, { remember: true });
    return res;
  } catch (err) {
    console.error("[auth/apple]", err);
    return NextResponse.json(
      { ok: false, message: "Apple-inloggning misslyckades" },
      { status: 401 }
    );
  }
}
