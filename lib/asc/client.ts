// lib/asc/client.ts — App Store Connect API (api.appstoreconnect.apple.com).
//
// Används av App Store-källorna i /admin (lib/asc/downloads.ts). Egen nyckel,
// SEPARAT från APPLE_IAP_* — IAP-nyckeln är en In-App Purchase-nyckel för App
// Store Server API och har ingen åtkomst till Analytics Reports.
//
// Env:
//   ASC_ISSUER_ID    Issuer ID (App Store Connect → Användare och åtkomst →
//                    Integrationer → App Store Connect API, överst på sidan)
//   ASC_KEY_ID       Nyckel-ID för en "Team key"
//   ASC_PRIVATE_KEY  Innehållet i AuthKey_<KEY_ID>.p8 (PEM; \n i Vercel går bra)
//   ASC_APP_ID       valfri — appens Apple ID, standard 6778179190 (NextWatch)
//
// Roll (https://developer.apple.com/documentation/appstoreconnectapi/downloading-analytics-reports):
// Admin krävs för att SKAPA rapportförfrågan (POST /v1/analyticsReportRequests).
// Sales and Reports eller Finance räcker för att lista och ladda ner rapporter
// när förfrågan väl finns.
//
// JWT: ES256, header kid + typ JWT, payload iss/iat/exp/aud "appstoreconnect-v1",
// högst 20 min livstid (vi kör 15).

import * as jose from "jose";

export const ASC_BASE = "https://api.appstoreconnect.apple.com";
export const ASC_ENV_VARS = ["ASC_ISSUER_ID", "ASC_KEY_ID", "ASC_PRIVATE_KEY"] as const;
export const ASC_DEFAULT_APP_ID = "6778179190";

export type AscConfig = { issuerId: string; keyId: string; privateKey: string; appId: string };

/** Vilka av de tre obligatoriska variablerna som saknas. */
export function ascMissingEnv(): string[] {
  return ASC_ENV_VARS.filter((k) => !process.env[k]?.trim());
}

export function ascConfig(): AscConfig | null {
  if (ascMissingEnv().length) return null;
  let pem = (process.env.ASC_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  // Tål en nyckel inklistrad utan PEM-rader (bara base64-kroppen).
  if (!pem.includes("BEGIN")) pem = `-----BEGIN PRIVATE KEY-----\n${pem.replace(/\s+/g, "")}\n-----END PRIVATE KEY-----`;
  return {
    issuerId: process.env.ASC_ISSUER_ID!.trim(),
    keyId: process.env.ASC_KEY_ID!.trim(),
    privateKey: pem,
    appId: (process.env.ASC_APP_ID ?? "").trim() || ASC_DEFAULT_APP_ID,
  };
}

let cachedToken: { token: string; exp: number; keyId: string } | null = null;

async function ascToken(cfg: AscConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.keyId === cfg.keyId && cachedToken.exp - 60 > now) return cachedToken.token;
  const key = await jose.importPKCS8(cfg.privateKey, "ES256");
  const exp = now + 15 * 60;
  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId, typ: "JWT" })
    .setIssuer(cfg.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience("appstoreconnect-v1")
    .sign(key);
  cachedToken = { token, exp, keyId: cfg.keyId };
  return token;
}

export class AscError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null = null
  ) {
    super(message);
  }
}

type AscErrorBody = { errors?: { status?: string; code?: string; title?: string; detail?: string }[] };

/** Anrop mot App Store Connect API. path = "/v1/…" eller en full URL (links.next). */
export async function ascFetch<T>(cfg: AscConfig, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = path.startsWith("http") ? path : `${ASC_BASE}${path}`;
  if (!url.startsWith(ASC_BASE)) throw new AscError(`Oväntad URL: ${url}`, 0);
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await ascToken(cfg)}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    let detail = "";
    let code: string | null = null;
    try {
      const j = (await res.json()) as AscErrorBody;
      const e = j.errors?.[0];
      code = e?.code ?? null;
      detail = [e?.title, e?.detail].filter(Boolean).join(" — ");
    } catch {
      /* tom kropp */
    }
    throw new AscError(`App Store Connect ${res.status}${detail ? `: ${detail}` : ""}`, res.status, code);
  }
  return (await res.json()) as T;
}

type Page<T> = { data: T[]; links?: { next?: string } };

/** Hämtar alla sidor (följer links.next), med ett tak för säkerhets skull. */
export async function ascFetchAll<T>(cfg: AscConfig, path: string, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  for (let i = 0; next && i < maxPages; i++) {
    const page: Page<T> = await ascFetch<Page<T>>(cfg, next);
    out.push(...(page.data ?? []));
    next = page.links?.next;
  }
  return out;
}
