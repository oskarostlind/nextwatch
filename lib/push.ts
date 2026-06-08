// lib/push.ts
//
// Skickar push-notiser via Firebase Cloud Messaging HTTP v1 API.
// Dependency-fritt: signerar service-account-JWT med Node crypto och växlar
// in den mot en OAuth2-access-token. Är push inte konfigurerat (env saknas)
// blir allt en tyst no-op så att anropande kod aldrig påverkas.
//
// Krävda env-variabler (från Firebase service account JSON):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (med \n som radbrytningar)

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type Credentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

let cachedToken: { token: string; exp: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getCredentials(): Credentials | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKeyRaw) return null;
  // Env lagrar ofta nyckeln med literala \n – konvertera till riktiga radbrytningar.
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

async function getAccessToken(creds: Credentials): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(creds.privateKey));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

async function sendToToken(
  projectId: string,
  accessToken: string,
  token: string,
  payload: PushPayload
): Promise<"ok" | "stale" | "error"> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data ?? {},
          apns: { payload: { aps: { sound: "default" } } },
        },
      }),
    }
  );

  if (res.ok) return "ok";
  // 404 NOT_FOUND/UNREGISTERED => token är avregistrerad och bör rensas.
  if (res.status === 404) return "stale";
  return "error";
}

/**
 * Skickar en push till alla registrerade enheter för en användare.
 * Best-effort: kastar aldrig, och rensar tysta/döda tokens.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const creds = getCredentials();
    if (!creds) return; // push ej konfigurerat – no-op

    const tokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const accessToken = await getAccessToken(creds);
    if (!accessToken) return;

    const stale: string[] = [];
    await Promise.all(
      tokens.map(async ({ token }) => {
        try {
          const result = await sendToToken(creds.projectId, accessToken, token, payload);
          if (result === "stale") stale.push(token);
        } catch {
          /* best-effort */
        }
      })
    );

    if (stale.length > 0) {
      await prisma.pushToken
        .deleteMany({ where: { token: { in: stale } } })
        .catch(() => {});
    }
  } catch {
    /* best-effort: push får aldrig påverka anropande flöde */
  }
}
