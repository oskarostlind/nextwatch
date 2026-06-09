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
