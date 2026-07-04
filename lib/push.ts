// lib/push.ts
//
// Skickar push-notiser direkt via Apple Push Notification service (APNs)
// över HTTP/2. Capacitor-appen registrerar APNs-device-tokens (hex) via
// /api/push/register — ingen Firebase SDK behövs i appen.
//
// Är push inte konfigurerat (env saknas) blir allt en tyst no-op så att
// anropande kod aldrig påverkas.
//
// Krävda env-variabler (från Apple Developer → Keys → APNs Auth Key):
//   APNS_TEAM_ID      (10 tecken, från Membership-sidan)
//   APNS_KEY_ID       (10 tecken, från nyckeln)
//   APNS_PRIVATE_KEY  (innehållet i .p8-filen, med \n som radbrytningar)
// Valfria:
//   APNS_BUNDLE_ID    (default "com.nextwatch.app")
//   APNS_USE_SANDBOX  ("true" för development-byggen; TestFlight/App Store
//                      använder production-miljön, vilket är default)

import crypto from "node:crypto";
import http2 from "node:http2";
import { prisma } from "@/lib/prisma";

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

// Kopplar notis-"type" (som anropare sätter i payload.data.type) till
// motsvarande kolumn på Profile. Saknas mappning skickas notisen alltid.
const TYPE_TO_PREF_COLUMN: Record<string, keyof PrefRow> = {
  daily_rec: "notifyDailyRecs",
  group_match: "notifyGroupMatches",
  friend_request: "notifyFriendRequests",
  friend_accepted: "notifyFriendRequests",
  group_invite: "notifyGroupInvites",
  group_invite_accepted: "notifyGroupInvites",
  marketing: "notifyMarketing",
};

type PrefRow = {
  notifyDailyRecs: boolean;
  notifyGroupMatches: boolean;
  notifyFriendRequests: boolean;
  notifyGroupInvites: boolean;
  notifyMarketing: boolean;
};

/**
 * True om användaren tillåter denna notistyp. Okänd typ => alltid true.
 * Saknad profil => true (hellre skicka än tappa viktiga notiser).
 */
async function userAllowsNotification(userId: string, type: string | undefined): Promise<boolean> {
  if (!type) return true;
  const column = TYPE_TO_PREF_COLUMN[type];
  if (!column) return true;
  try {
    const prof = await prisma.profile.findUnique({
      where: { userId },
      select: {
        notifyDailyRecs: true,
        notifyGroupMatches: true,
        notifyFriendRequests: true,
        notifyGroupInvites: true,
        notifyMarketing: true,
      },
    });
    if (!prof) return true;
    return prof[column] !== false;
  } catch {
    return true;
  }
}

type ApnsCredentials = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  host: string;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getCredentials(): ApnsCredentials | null {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const privateKeyRaw = process.env.APNS_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKeyRaw) return null;

  return {
    teamId,
    keyId,
    // Env lagrar ofta nyckeln med literala \n – konvertera till riktiga radbrytningar.
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    bundleId: process.env.APNS_BUNDLE_ID ?? "com.nextwatch.app",
    host:
      process.env.APNS_USE_SANDBOX === "true"
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com",
  };
}

// APNs-JWT är giltig 20–60 min; återanvänd i 45 min.
let cachedJwt: { token: string; iat: number } | null = null;

function getApnsJwt(creds: ApnsCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.iat < 45 * 60) return cachedJwt.token;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: creds.keyId }));
  const claims = base64url(JSON.stringify({ iss: creds.teamId, iat: now }));
  const signingInput = `${header}.${claims}`;

  const signer = crypto.createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  // APNs/JWT kräver JOSE-format (r||s), inte DER.
  const signature = signer.sign({ key: creds.privateKey, dsaEncoding: "ieee-p1363" });

  const token = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { token, iat: now };
  return token;
}

type SendResult = "ok" | "stale" | "error";

function sendToToken(
  session: http2.ClientHttp2Session,
  creds: ApnsCredentials,
  jwt: string,
  deviceToken: string,
  payload: PushPayload
): Promise<SendResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
      },
      ...(payload.data ?? {}),
    });

    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": creds.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let responseBody = "";

    req.setTimeout(10_000, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      resolve("error");
    });
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.on("data", (chunk: Buffer) => {
      responseBody += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (status === 200) {
        resolve("ok");
        return;
      }
      // 410 Unregistered eller 400 BadDeviceToken => rensa token ur DB.
      if (status === 410 || responseBody.includes("BadDeviceToken")) {
        resolve("stale");
        return;
      }
      console.warn(`[push] APNs ${status} för token …${deviceToken.slice(-8)}: ${responseBody}`);
      resolve("error");
    });
    req.on("error", () => resolve("error"));

    req.end(body);
  });
}

/**
 * Skickar en push till alla registrerade enheter för en användare.
 * Best-effort: kastar aldrig, och rensar döda tokens.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    const creds = getCredentials();
    if (!creds) {
      console.warn("[push] APNS_* env saknas – push skickas inte.");
      return;
    }

    // Respektera användarens notisinställningar (baserat på payload.data.type).
    if (!(await userAllowsNotification(userId, payload.data?.type))) {
      return;
    }

    const tokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const jwt = getApnsJwt(creds);

    const session = http2.connect(`https://${creds.host}`);
    session.on("error", () => {
      /* hanteras per request */
    });

    const stale: string[] = [];
    try {
      await Promise.all(
        tokens.map(async ({ token }) => {
          const result = await sendToToken(session, creds, jwt, token, payload);
          if (result === "stale") stale.push(token);
        })
      );
    } finally {
      session.close();
    }

    if (stale.length > 0) {
      await prisma.pushToken
        .deleteMany({ where: { token: { in: stale } } })
        .catch(() => {});
    }
  } catch (e) {
    // best-effort: push får aldrig påverka anropande flöde
    console.warn("[push] sendPushToUser misslyckades:", e instanceof Error ? e.message : e);
  }
}

/**
 * Skickar push till alla gruppmedlemmar när en titel precis nått match-tröskeln.
 * Anropas efter LIKE-röst; triggar bara när likeCount === need (inte vid varje extra like).
 */
export async function notifyGroupMatchIfNeeded(
  groupCode: string,
  tmdbId: number,
  tmdbType: "movie" | "tv"
): Promise<void> {
  try {
    const size = await prisma.groupMember.count({ where: { groupCode } });
    if (size === 0) return;

    const need = Math.max(2, Math.ceil(size * 0.6));
    const likeCount = await prisma.groupVote.count({
      where: { groupCode, tmdbId, tmdbType, vote: "LIKE" },
    });
    if (likeCount !== need) return;

    const members = await prisma.groupMember.findMany({
      where: { groupCode },
      select: { userId: true },
    });

    const mediaLabel = tmdbType === "movie" ? "film" : "serie";
    await Promise.all(
      members.map(({ userId }) =>
        sendPushToUser(userId, {
          title: "Gruppmatch! 🎬",
          body: `Ni har hittat en ${mediaLabel} att titta på tillsammans!`,
          data: {
            type: "group_match",
            groupCode,
            tmdbId: String(tmdbId),
            tmdbType,
          },
        })
      )
    );
  } catch (e) {
    console.warn("[push] notifyGroupMatchIfNeeded misslyckades:", e instanceof Error ? e.message : e);
  }
}
