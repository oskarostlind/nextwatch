// lib/pushActionToken.ts
//
// Signerad token som följer med en push (data.act). Låsskärmsknapparna
// (Spara / Nej / Sett / Ta bort) anropar /api/push/action från native kod i
// bakgrunden — där finns ingen nw_uid-cookie. Token bevisar i stället vilken
// användare och vilken titel notisen gällde, och löper ut efter några dagar.
//
// Format: base64url(JSON-claims) + "." + base64url(HMAC-SHA256).

import crypto from "node:crypto";

export type PushActionClaims = {
  uid: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  pid?: string;
  /** unix-sekunder */
  exp: number;
};

function secret(): string | null {
  return (
    process.env.PUSH_ACTION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.CRON_SECRET ||
    null
  );
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hmac(payload: string, key: string): Buffer {
  return crypto.createHmac("sha256", key).update(payload).digest();
}

/** null när ingen hemlighet är konfigurerad (då skickas pushen utan knappar). */
export function signPushAction(
  c: Omit<PushActionClaims, "exp">,
  ttlDays = 14
): string | null {
  const key = secret();
  if (!key) return null;
  const claims: PushActionClaims = {
    ...c,
    exp: Math.floor(Date.now() / 1000) + Math.round(ttlDays * 86_400),
  };
  const body = b64url(JSON.stringify(claims));
  return `${body}.${b64url(hmac(body, key))}`;
}

export function verifyPushAction(token: string): PushActionClaims | null {
  try {
    const key = secret();
    if (!key || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;

    const expected = hmac(body, key);
    const given = Buffer.from(sig, "base64url");
    // timingSafeEqual kastar vid olika längd — kolla först.
    if (given.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(given, expected)) return null;

    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<PushActionClaims>;
    if (
      typeof c.uid !== "string" ||
      !c.uid ||
      typeof c.tmdbId !== "number" ||
      !Number.isFinite(c.tmdbId) ||
      (c.mediaType !== "movie" && c.mediaType !== "tv") ||
      typeof c.exp !== "number" ||
      c.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      uid: c.uid,
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      ...(typeof c.pid === "string" ? { pid: c.pid } : {}),
      exp: c.exp,
    };
  } catch {
    return null;
  }
}
