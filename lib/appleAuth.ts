import * as jose from "jose";

const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getAppleJWKS() {
  if (!jwks) jwks = jose.createRemoteJWKSet(APPLE_JWKS_URL);
  return jwks;
}

export type AppleTokenClaims = {
  sub: string;
  email?: string;
  emailVerified: boolean;
};

function appleAudiences(): string[] {
  return [
    process.env.APPLE_CLIENT_ID,
    process.env.APPLE_BUNDLE_ID,
    "com.nextwatch.app",
  ].filter((v): v is string => Boolean(v));
}

export async function verifyAppleIdentityToken(
  identityToken: string
): Promise<AppleTokenClaims> {
  const audiences = appleAudiences();
  if (audiences.length === 0) {
    throw new Error("APPLE_CLIENT_ID is not configured");
  }

  const { payload } = await jose.jwtVerify(identityToken, getAppleJWKS(), {
    issuer: "https://appleid.apple.com",
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) throw new Error("Invalid Apple token: missing sub");

  const email = typeof payload.email === "string" ? payload.email : undefined;
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  return { sub, email, emailVerified };
}

/* ------------------------------------------------------------------ *
 * Token-utbyte och återkallelse (Apple TN3194 / Guideline 5.1.1(v))
 *
 * När en användare raderar sitt konto måste appen också återkalla
 * Sign in with Apple-kopplingen — annars ligger appen kvar under
 * Inställningar → Apple-ID → Logga in med Apple, och Apple betraktar
 * raderingen som ofullständig. Återkallelsen kräver ett token från
 * /auth/token, som i sin tur kräver authorizationCode:n vi får vid
 * inloggningen. Därför: byt kod → refresh token vid login, spara den,
 * använd den vid radering.
 *
 * Kräver en Sign in with Apple-nyckel (.p8) i miljön:
 *   APPLE_SIWA_KEY_ID, APPLE_SIWA_PRIVATE_KEY, APPLE_TEAM_ID
 * Saknas de degraderar allt tyst — inloggning och radering fungerar
 * ändå, vi loggar bara en varning.
 * ------------------------------------------------------------------ */

function appleClientId(): string {
  return (
    process.env.APPLE_CLIENT_ID ||
    process.env.APPLE_BUNDLE_ID ||
    "com.nextwatch.app"
  );
}

/** Signerar client_secret-JWT:n som Apples token-endpoints kräver (ES256). */
async function appleClientSecret(): Promise<string | null> {
  const teamId = process.env.APPLE_TEAM_ID || process.env.APNS_TEAM_ID || "";
  const keyId = process.env.APPLE_SIWA_KEY_ID || "";
  // Vercel-env sparar radbrytningar som \n — normalisera till riktig PEM.
  const pem = (process.env.APPLE_SIWA_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !pem) return null;

  try {
    const key = await jose.importPKCS8(pem, "ES256");
    const now = Math.floor(Date.now() / 1000);
    return await new jose.SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60 * 10)
      .setAudience("https://appleid.apple.com")
      .setSubject(appleClientId())
      .sign(key);
  } catch (e) {
    console.warn("[appleAuth] kunde inte signera client_secret:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Byter authorizationCode mot ett refresh token. Returnerar null om nycklarna
 * saknas eller Apple svarar med fel — anropas alltid best-effort.
 */
export async function exchangeAppleAuthCode(code: string): Promise<string | null> {
  const secret = await appleClientSecret();
  if (!secret) return null;

  try {
    const res = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appleClientId(),
        client_secret: secret,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) {
      console.warn("[appleAuth] token-utbyte misslyckades:", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { refresh_token?: string };
    return json.refresh_token ?? null;
  } catch (e) {
    console.warn("[appleAuth] token-utbyte kastade:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Återkallar Sign in with Apple-kopplingen (TN3194). Returnerar true bara när
 * Apple bekräftar — misslyckanden får aldrig blockera kontoraderingen.
 */
export async function revokeAppleToken(refreshToken: string): Promise<boolean> {
  const secret = await appleClientSecret();
  if (!secret) {
    console.warn("[appleAuth] hoppar över revoke – SIWA-nyckel saknas i miljön.");
    return false;
  }

  try {
    const res = await fetch("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appleClientId(),
        client_secret: secret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    });
    if (!res.ok) {
      console.warn("[appleAuth] revoke misslyckades:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[appleAuth] revoke kastade:", e instanceof Error ? e.message : e);
    return false;
  }
}
