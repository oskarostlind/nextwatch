// lib/fcm.ts
//
// Android-push via Firebase Cloud Messaging HTTP v1. Anropas ENBART från
// lib/push.ts för tokens med platform "android" — iOS-tokens går som förut
// direkt till APNs och berörs inte av den här filen.
//
// Env: GOOGLE_SERVICE_ACCOUNT_JSON (servicekonto i Firebase-projektet; se
// lib/googleServiceAccount.ts). Projekt-id tas från nyckelfilen, eller
// FCM_PROJECT_ID om den ska överstyras.

import { getGoogleAccessToken, getServiceAccount } from "@/lib/googleServiceAccount";
import type { PushPayload } from "@/lib/push";

export type FcmResult = "ok" | "stale" | "error";

export function fcmConfigured(): boolean {
  const sa = getServiceAccount();
  return Boolean(sa && (process.env.FCM_PROJECT_ID || sa.project_id));
}

/** Notiskanaler — skapas av MainActivity.java (samma id:n måste finnas där). */
function channelFor(payload: PushPayload): string {
  return payload.interruptionLevel === "time-sensitive" ? "nw_match" : "nw_default";
}

export async function sendFcmToTokens(
  tokens: string[],
  payload: PushPayload,
  data: Record<string, string>
): Promise<{ delivered: number; stale: string[] }> {
  const out = { delivered: 0, stale: [] as string[] };
  if (tokens.length === 0) return out;
  const sa = getServiceAccount();
  const projectId = process.env.FCM_PROJECT_ID || sa?.project_id;
  if (!projectId) return out;
  const access = await getGoogleAccessToken(["https://www.googleapis.com/auth/firebase.messaging"]);
  if (!access) return out;

  // FCM kräver strängvärden i data.
  const strData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (typeof v === "string") strData[k] = v;
  if (payload.image) strData.image = payload.image;

  const results = await Promise.all(
    tokens.map(async (token): Promise<FcmResult> => {
      const message = {
        token,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.image ? { image: payload.image } : {}),
        },
        data: strData,
        android: {
          priority: "high",
          notification: {
            channel_id: channelFor(payload),
            ...(payload.threadId ? { tag: payload.threadId } : {}),
            ...(payload.image ? { image: payload.image } : {}),
          },
        },
      };
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
            signal: ctrl.signal,
            cache: "no-store",
          }
        ).finally(() => clearTimeout(timer));
        if (res.ok) return "ok";
        const text = await res.text().catch(() => "");
        // UNREGISTERED (404) / ogiltig token (400 INVALID_ARGUMENT på token) => rensa.
        if (res.status === 404 || text.includes("UNREGISTERED") || (res.status === 400 && text.includes("registration token"))) {
          return "stale";
        }
        console.warn(`[fcm] ${res.status} för token …${token.slice(-8)}: ${text.slice(0, 300)}`);
        return "error";
      } catch (e) {
        console.warn("[fcm] sändning misslyckades:", e instanceof Error ? e.message : e);
        return "error";
      }
    })
  );
  results.forEach((r, i) => {
    if (r === "ok") out.delivered += 1;
    else if (r === "stale") out.stale.push(tokens[i]);
  });
  return out;
}
