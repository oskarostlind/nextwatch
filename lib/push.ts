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
import { groupMatchNeed } from "@/lib/groupSettings";
import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE, normalizeLocale } from "@/lib/i18nConfig";
import { tmdbLanguageFor } from "@/lib/tmdbLanguage";
import { fetchTitleBrief, type TitleBrief } from "@/lib/tmdbTitleBrief";
import { signPushAction } from "@/lib/pushActionToken";

export type PushPayload = {
  title: string;
  body: string;
  /** data.type KRÄVS (loggning + notisinställningar). Alla värden är strängar. */
  data?: Record<string, string>;
  /** https-bild → aps.mutable-content=1 + toppnivånyckeln "image"; iOS Notification
   *  Service Extension laddar ner och bifogar den. TMDB-backdrop w780 (annars poster w500). */
  image?: string | null;
  /** Knappar på låsskärmen. NW_TITLE = [spara, nej] (titel användaren inte tagit ställning till),
   *  NW_SAVED = [sett, ta bort] (titel som redan ligger i watchlisten). */
  category?: "NW_TITLE" | "NW_SAVED";
  /** aps.thread-id: grupperar notiser i Notiscentralen. */
  threadId?: string;
  interruptionLevel?: "passive" | "active" | "time-sensitive";
  /** 0..1, aps.relevance-score (ordning i notissammanfattningen). */
  relevanceScore?: number;
  /** Bara analys → push_log.angle (t.ex. "person.v2"); når enheten som data.angle. */
  angle?: string;
  /** Titeln pushen handlar om → push_log + åtgärdstoken. */
  tmdbId?: number;
  mediaType?: "movie" | "tv";
};

export type PushResult = { sent: boolean; pid?: string };

// Kopplar notis-"type" (som anropare sätter i payload.data.type) till
// motsvarande kolumn på Profile. Saknas mappning skickas notisen alltid.
const TYPE_TO_PREF_COLUMN: Record<string, keyof PrefRow> = {
  daily_rec: "notifyDailyRecs",
  // Veckovalen och watchlist-knuffen är också rekommendationspushar — samma
  // reglage ("Dagliga tips") styr alla tre, vi lägger inte till fler toggles.
  weekly_picks: "notifyDailyRecs",
  watchlist_nudge: "notifyDailyRecs",
  group_match: "notifyGroupMatches",
  friend_request: "notifyFriendRequests",
  friend_accepted: "notifyFriendRequests",
  group_invite: "notifyGroupInvites",
  group_invite_accepted: "notifyGroupInvites",
  share_received: "notifyShares",
  marketing: "notifyMarketing",
  // "re_engagement" ("vi saknar dig"-pushen från cron/daily-recs) är MED FLIT
  // omappad (produktbeslut 2026-08-20): den är standardbeteende för alla och
  // gate:as bara av att användaren tillåter push överhuvudtaget (OS-nivå →
  // finns det inga tokens skickas inget). Mappa den INTE mot notifyMarketing —
  // den flaggan är default false och hade tystat notisen för nästan alla.
};

type PrefRow = {
  notifyDailyRecs: boolean;
  notifyGroupMatches: boolean;
  notifyFriendRequests: boolean;
  notifyGroupInvites: boolean;
  notifyShares: boolean;
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
        notifyShares: true,
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
  payload: PushPayload,
  data: Record<string, string>
): Promise<SendResult> {
  return new Promise((resolve) => {
    // Frånvarande nycklar utelämnas helt — APNs tolkar null/undefined olika.
    const aps: Record<string, unknown> = {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
    };
    // mutable-content väcker Notification Service Extension som bifogar bilden.
    if (payload.image) aps["mutable-content"] = 1;
    if (payload.category) aps.category = payload.category;
    if (payload.threadId) aps["thread-id"] = payload.threadId;
    if (payload.interruptionLevel) aps["interruption-level"] = payload.interruptionLevel;
    if (typeof payload.relevanceScore === "number" && Number.isFinite(payload.relevanceScore)) {
      aps["relevance-score"] = Math.min(1, Math.max(0, payload.relevanceScore));
    }
    const body = JSON.stringify({
      aps,
      ...(payload.image ? { image: payload.image } : {}),
      ...data,
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
 *
 * sent=false betyder att inget gick iväg (inga APNs-nycklar, notistypen
 * avstängd, inga tokens eller alla leveranser föll). pid är push_log-id:t som
 * även följer med enheten som data.pid.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  let logId: string | null = null;
  try {
    const creds = getCredentials();
    if (!creds) {
      console.warn("[push] APNS_* env saknas – push skickas inte.");
      return { sent: false };
    }

    // Respektera användarens notisinställningar (baserat på payload.data.type).
    if (!(await userAllowsNotification(userId, payload.data?.type))) {
      return { sent: false };
    }

    const tokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return { sent: false };

    // Loggraden skrivs först när vi vet att pushen faktiskt kan gå iväg, och id:t
    // måste finnas innan sändning eftersom det åker med i data.pid. Misslyckas
    // loggen skickas pushen ändå (utan pid).
    const data: Record<string, string> = { ...(payload.data ?? {}) };
    const type = data.type;
    if (type) {
      try {
        const id = crypto.randomUUID();
        await prisma.pushLog.create({
          data: {
            id,
            userId,
            type,
            angle: payload.angle ?? null,
            tmdbId: payload.tmdbId ?? null,
            mediaType: payload.mediaType ?? null,
          },
        });
        logId = id;
        data.pid = id;
      } catch (e) {
        console.warn("[push] push_log misslyckades:", e instanceof Error ? e.message : e);
      }
    }
    if (payload.angle) data.angle = payload.angle;

    // Åtgärdstoken för låsskärmsknapparna — utan hemlighet blir det en vanlig
    // notis (appen faller då tillbaka på att öppnas).
    if (payload.category && payload.tmdbId && payload.mediaType) {
      const act = signPushAction({
        uid: userId,
        tmdbId: payload.tmdbId,
        mediaType: payload.mediaType,
        ...(logId ? { pid: logId } : {}),
      });
      if (act) data.act = act;
    }

    const jwt = getApnsJwt(creds);

    const session = http2.connect(`https://${creds.host}`);
    session.on("error", () => {
      /* hanteras per request */
    });

    const stale: string[] = [];
    let delivered = 0;
    try {
      await Promise.all(
        tokens.map(async ({ token }) => {
          const result = await sendToToken(session, creds, jwt, token, payload, data);
          if (result === "ok") delivered += 1;
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

    if (delivered === 0) {
      // Ingen levererades — ta bort loggraden så statistiken bara räknar riktiga pushar.
      if (logId) await prisma.pushLog.delete({ where: { id: logId } }).catch(() => {});
      return { sent: false };
    }
    return { sent: true, ...(logId ? { pid: logId } : {}) };
  } catch (e) {
    // best-effort: push får aldrig påverka anropande flöde
    console.warn("[push] sendPushToUser misslyckades:", e instanceof Error ? e.message : e);
    return { sent: false };
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
    const [size, groupRow] = await Promise.all([
      prisma.groupMember.count({ where: { groupCode } }),
      prisma.group.findUnique({ where: { code: groupCode }, select: { matchThreshold: true } }),
    ]);
    if (size === 0) return;

    const need = groupMatchNeed(size, groupRow?.matchThreshold);
    const likeCount = await prisma.groupVote.count({
      where: { groupCode, tmdbId, tmdbType, vote: "LIKE" },
    });
    if (likeCount !== need) return;

    // Historik för Matchningar-fliken (app/group). Upsert eftersom denna
    // funktion i teorin kan racea vid samtidiga röster runt tröskeln —
    // matchedAt ska då stå kvar på det första tillfället, inte skrivas om.
    await prisma.groupMatch.upsert({
      where: { groupCode_tmdbId_tmdbType: { groupCode, tmdbId, tmdbType } },
      update: {},
      create: { groupCode, tmdbId, tmdbType },
    });

    const members = await prisma.groupMember.findMany({
      where: { groupCode },
      select: { userId: true },
    });

    // Mottagarens språk, inte avsändarens — se sendLocalizedPushToUser. Titeln
    // hämtas högst en gång per språk i den här omgången (gruppen är oftast
    // enspråkig) så en match inte ger ett TMDB-anrop per medlem.
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: members.map((m) => m.userId) } },
      select: { userId: true, uiLanguage: true },
    });
    const langByUser = new Map(profiles.map((p) => [p.userId, tmdbLanguageFor(p.uiLanguage)]));
    const briefByLang = new Map<string, Promise<TitleBrief | null>>();
    const briefFor = (lang: string) => {
      let p = briefByLang.get(lang);
      if (!p) {
        p = fetchTitleBrief(tmdbId, tmdbType, lang);
        briefByLang.set(lang, p);
      }
      return p;
    };

    await Promise.all(
      members.map(async ({ userId }) => {
        const brief = await briefFor(langByUser.get(userId) ?? tmdbLanguageFor(undefined));
        const base = tmdbType === "movie" ? "groupMatchMovie" : "groupMatchSeries";
        await sendLocalizedPushToUser(userId, {
          // Utan titel (TMDB nere) faller vi tillbaka på den generiska texten.
          key: brief ? `${base}Titled` : base,
          values: brief ? { title: brief.title } : undefined,
          data: {
            type: "group_match",
            groupCode,
            tmdbId: String(tmdbId),
            tmdbType,
          },
          image: brief?.imageUrl ?? null,
          // Ingen category: gruppen har redan bestämt sig, inget att spara/avvisa.
          interruptionLevel: "time-sensitive",
          threadId: `group-${groupCode}`,
          tmdbId,
          mediaType: tmdbType,
        });
      })
    );
  } catch (e) {
    console.warn("[push] notifyGroupMatchIfNeeded misslyckades:", e instanceof Error ? e.message : e);
  }
}

/**
 * Som sendPushToUser, men texterna slås upp på MOTTAGARENS språk.
 *
 * Notiser skickas från någon annans request (en vän som bjuder in, en cron),
 * så nw_lang-cookien hör till fel person. Språket måste därför komma från
 * mottagarens Profile.uiLanguage.
 */
export async function sendLocalizedPushToUser(
  userId: string,
  opts: {
    /** Nyckel under namnrymden "push", t.ex. "friendRequest". */
    key: string;
    values?: Record<string, string | number>;
    data?: Record<string, string>;
  } & Omit<PushPayload, "title" | "body" | "data">
): Promise<PushResult> {
  let locale = DEFAULT_LOCALE;
  try {
    const prof = await prisma.profile.findUnique({
      where: { userId },
      select: { uiLanguage: true },
    });
    locale = normalizeLocale(prof?.uiLanguage);
  } catch {
    /* faller tillbaka på svenska */
  }

  try {
    const { key, values, data, ...rest } = opts;
    const t = await getTranslations({ locale, namespace: `push.${key}` });
    return await sendPushToUser(userId, {
      ...rest,
      title: t("title", values),
      body: t("body", values),
      data,
    });
  } catch (e) {
    console.warn("[push] kunde inte lokalisera notis", opts.key, e instanceof Error ? e.message : e);
    return { sent: false };
  }
}
