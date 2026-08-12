import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import prisma from "../../../../lib/prisma";
import { verifyAppleIdentityToken, exchangeAppleAuthCode } from "../../../../lib/appleAuth";
import { setAuthCookies } from "../../../../lib/auth";
import { sessionCookieOpts } from "../../../../lib/cookies";
import { rateLimitAllow, getRateLimitKey, AUTH_LIMIT } from "../../../../lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Apple skickar förnamn/efternamn EN gång — vid första auktoriseringen. Vi
 * plockar upp det här och sparar det som visningsnamn, för guideline 4 säger
 * att en användare aldrig ska behöva fylla i namn/e-post som
 * AuthenticationServices redan lämnat. Onboardingen läser nw_apple_name när
 * profilen ännu inte finns.
 */
function fullNameFrom(given: unknown, family: unknown): string | null {
  const clean = (v: unknown) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const name = [clean(given), clean(family)].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
}

const APPLE_NAME_COOKIE_MAX_AGE = 60 * 30;

export async function POST(req: Request) {
  try {
    const key = getRateLimitKey(req, null);
    if (!rateLimitAllow(key, "auth-apple", { limit: AUTH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: "För många inloggningsförsök." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as {
      identityToken?: string;
      givenName?: string | null;
      familyName?: string | null;
      email?: string | null;
      authorizationCode?: string | null;
    };
    const identityToken = body.identityToken;
    const appleFullName = fullNameFrom(body.givenName, body.familyName);
    if (!identityToken) {
      return NextResponse.json(
        { ok: false, message: "Saknar Apple-token" },
        { status: 400 }
      );
    }

    const claims = await verifyAppleIdentityToken(identityToken);

    let user = await prisma.user.findUnique({
      where: { appleSub: claims.sub },
      select: { id: true, profile: { select: { userId: true, displayName: true } } },
    });

    if (!user && claims.email) {
      const byEmail = await prisma.user.findUnique({
        where: { email: claims.email },
        select: {
          id: true,
          appleSub: true,
          profile: { select: { userId: true, displayName: true } },
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
      // Ta över det anonyma gästkontot som redan bär onboarding-profilen, om det
      // finns och saknar egen inloggning. Utan detta skapades ett NYTT id här och
      // profilen man precis fyllde i (sparad på det anonyma id:t) blev föräldralös
      // → man kastades tillbaka till onboardingen. Bara ett riktigt anonymt konto
      // (ingen appleSub, inget lösenord) får adopteras.
      const anonUid = (await cookies()).get("nw_uid")?.value ?? null;
      if (anonUid) {
        const guest = await prisma.user.findUnique({
          where: { id: anonUid },
          select: {
            id: true,
            appleSub: true,
            passwordHash: true,
            email: true,
            profile: { select: { userId: true, displayName: true } },
          },
        });
        if (guest && !guest.appleSub && !guest.passwordHash) {
          await prisma.user.update({
            where: { id: guest.id },
            data: {
              appleSub: claims.sub,
              // claims.email kan inte krocka här: en befintlig ägare hade fångats
              // av e-postuppslaget ovan. Sätt bara om gästen saknar e-post.
              ...(claims.email && !guest.email ? { email: claims.email } : {}),
              ...(claims.emailVerified ? { emailVerified: new Date() } : {}),
            },
          });
          user = { id: guest.id, profile: guest.profile };
        }
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
        select: { id: true, profile: { select: { userId: true, displayName: true } } },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Refresh token sparas enbart för att kunna återkalla kopplingen när
    // kontot raderas (TN3194). Best-effort: saknas SIWA-nyckeln i miljön
    // returnerar utbytet null och inloggningen fortsätter som vanligt.
    if (body.authorizationCode) {
      const refreshToken = await exchangeAppleAuthCode(body.authorizationCode);
      if (refreshToken) {
        await prisma.user.update({
          where: { id: user.id },
          data: { appleRefreshToken: refreshToken },
        });
      }
    }

    // Namnet från Apple skrivs in åt användaren i stället för att efterfrågas:
    // finns profilen redan fyller vi bara i ett tomt visningsnamn (skriver
    // aldrig över ett namn användaren själv valt).
    if (appleFullName && user.profile && !user.profile.displayName) {
      await prisma.profile.update({
        where: { userId: user.id },
        data: { displayName: appleFullName },
      });
    }

    const redirect = user.profile ? "/swipe" : "/onboarding";
    const res = NextResponse.json({ ok: true, redirect });
    await setAuthCookies(res, user.id, { remember: true });

    // Ingen profil ännu → onboardingen förifyller visningsnamnet från den här
    // kortlivade cookien (httpOnly, läses av server-komponenten).
    if (appleFullName && !user.profile) {
      res.cookies.set(
        "nw_apple_name",
        appleFullName,
        sessionCookieOpts(APPLE_NAME_COOKIE_MAX_AGE, true)
      );
    }
    return res;
  } catch (err) {
    console.error("[auth/apple]", err);
    return NextResponse.json(
      { ok: false, message: "Apple-inloggning misslyckades" },
      { status: 401 }
    );
  }
}
