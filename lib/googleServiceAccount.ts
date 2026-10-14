// lib/googleServiceAccount.ts
//
// OAuth2-åtkomsttoken från ett Google-servicekonto (JWT bearer grant) — utan
// googleapis-SDK. Används av FCM (lib/fcm.ts, Android-push) och Google Play
// Developer API (lib/googlePlay.ts, verifiering av Android-prenumerationer).
//
// Env: GOOGLE_SERVICE_ACCOUNT_JSON = hela nyckelfilen (JSON), rå eller base64.
// Saknas den blir allt som bygger på det en tyst no-op (null).

import { SignJWT, importPKCS8 } from "jose";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

let parsed: ServiceAccount | null | undefined;

export function getServiceAccount(): ServiceAccount | null {
  if (parsed !== undefined) return parsed;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return (parsed = null);
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text) as ServiceAccount;
    if (!json.client_email || !json.private_key) return (parsed = null);
    json.private_key = json.private_key.replace(/\\n/g, "\n");
    return (parsed = json);
  } catch (e) {
    console.warn("[gsa] GOOGLE_SERVICE_ACCOUNT_JSON går inte att läsa:", e instanceof Error ? e.message : e);
    return (parsed = null);
  }
}

const cache = new Map<string, { token: string; exp: number }>();

/** Åtkomsttoken för givna scopes (cachas till 5 min före utgång). null vid fel. */
export async function getGoogleAccessToken(scopes: string[]): Promise<string | null> {
  const sa = getServiceAccount();
  if (!sa) return null;
  const key = scopes.slice().sort().join(" ");
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(key);
  if (hit && hit.exp - 300 > now) return hit.token;

  try {
    const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const pk = await importPKCS8(sa.private_key, "RS256");
    const assertion = await new SignJWT({ scope: key })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(pk);

    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      cache: "no-store",
    });
    const js = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !js?.access_token) {
      console.warn("[gsa] token-utbyte misslyckades:", res.status, JSON.stringify(js)?.slice(0, 300));
      return null;
    }
    cache.set(key, { token: js.access_token, exp: now + (js.expires_in ?? 3600) });
    return js.access_token;
  } catch (e) {
    console.warn("[gsa] token-fel:", e instanceof Error ? e.message : e);
    return null;
  }
}
