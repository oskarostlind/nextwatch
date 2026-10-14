// lib/referral.ts — "Bjud in" (nya flödet del 6, 2026-10-15).
//
// Värden delar https://www.nextwatch.se/g/<KOD>. Vännen öppnar länken (oftast i
// webbläsaren), får en tyst gästprofil, går med i gruppen och swipar direkt.
// Värdens gillade titlar ligger först i vännens lek (pendingGroupLikes) så att
// en match kan komma på första gilla. När vännen har röstat REFERRAL_VOTES
// gånger i gruppen får BÅDA REFERRAL_PICKS AI-val (ai_pick_grants, source
// 'referral').
//
// Tabeller: prisma/sql/2026-10-15_referrals.sql (rå SQL, ingen Prisma-modell).
// Allt här tål att SQL:en inte körts än — saknad tabell fångas, loggas en gång
// och betyder bara "ingen belöning". Länken och gruppleken fungerar ändå.
//
// Missbruksskydd (belöningen är det enda som är värt att fuska till sig):
//   - samma person som värden (samma uid) skrivs aldrig in som inbjuden;
//   - samma enhet: nw_dev är en långlivad httpOnly-cookie per webbläsare. Har
//     den inbjudna samma nw_dev-hash som den som delade länken (t.ex. värden
//     loggar ut och öppnar sin egen länk som ny gäst) → status
//     'blocked_device', ingen belöning. Olika webbläsare på samma telefon går
//     inte att skilja från två personer utan fingeravtryck — det taket bärs av
//     punkterna nedan;
//   - unik per inbjuden (uq_referrals_invitee) — ingen kan värvas två gånger;
//   - bara den som faktiskt GICK MED via länken (inte redan var medlem);
//   - max REFERRAL_MONTHLY_CAP belöningar per värd och kalendermånad
//     (Europe/Stockholm) → därefter status 'capped';
//   - belöningen kräver 10 riktiga gruppröster, som i sin tur gatas av
//     dagliga swipegränsen.
// Värst tänkbara fusk: 10 × 5 = 50 AI-val/månad till en värd (≈ 2,50 kr).

import crypto from "node:crypto";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { stockholmMonthStart } from "@/lib/aiPick/time";
import { fetchTitleBrief } from "@/lib/tmdbTitleBrief";
import { normalizeLocale } from "@/lib/i18nConfig";

/** Antal gruppröster den inbjudna måste lägga innan belöningen delas ut. */
export const REFERRAL_VOTES = 10;
/** AI-val till var och en (värd + vän). */
export const REFERRAL_PICKS = 5;
/** Max belöningar per värd och kalendermånad. */
export const REFERRAL_MONTHLY_CAP = 10;
/** Hur många av värdens gillade som läggs i gruppen när länken delas. */
export const HOST_LIKES_SEED = 20;

export const DEVICE_COOKIE = "nw_dev";
export const SITE_ORIGIN = "https://www.nextwatch.se";

export function inviteUrl(code: string): string {
  return `${SITE_ORIGIN}/g/${encodeURIComponent(code)}`;
}

/** Gruppkoder är A–Z + 2–9 (se app/api/group/create), 4–12 tecken. */
export function normalizeGroupCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

/** Samma alfabet som app/api/group/create (utan lättförväxlade tecken). */
export function newGroupCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i += 1) s += alphabet[bytes[i] % alphabet.length] ?? "A";
  return s;
}

/* ------------------------------------------------------------------ */
/* Enhets-cookie                                                       */
/* ------------------------------------------------------------------ */

/** Nytt råvärde för nw_dev-cookien. */
export function newDeviceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Vi lagrar aldrig råvärdet — bara en hash (cookien är ett bärartoken). */
export function deviceKey(raw: string | null | undefined): string | null {
  if (!raw || !/^[a-f0-9]{16,64}$/.test(raw)) return null;
  return crypto.createHash("sha256").update(`nw_dev:${raw}`).digest("hex").slice(0, 32);
}

export const DEVICE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: 60 * 60 * 24 * 365 * 2,
};

/* ------------------------------------------------------------------ */
/* Felhantering — SQL:en kanske inte körts än                          */
/* ------------------------------------------------------------------ */

let warnedMissing = false;
// Saknas tabellerna hoppar vi över uppslagningen en stund i stället för att
// låta varje gruppröst slå i databasen med en fråga som garanterat fallerar.
let missingUntil = 0;
const MISSING_BACKOFF_MS = 10 * 60 * 1000;

function tablesKnownMissing(): boolean {
  return missingUntil > Date.now();
}

function isMissingTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // Postgres 42P01 undefined_table, via Prisma ($queryRaw → P2010 med meddelandet).
  return /42P01|relation "referral(_links|s)" does not exist/i.test(msg);
}

function logReferralError(where: string, e: unknown): void {
  if (isMissingTable(e)) {
    missingUntil = Date.now() + MISSING_BACKOFF_MS;
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(
        "[referral] tabellerna saknas — kör prisma/sql/2026-10-15_referrals.sql. Belöningar hoppas över tills dess."
      );
    }
    return;
  }
  console.warn(`[referral] ${where}:`, e instanceof Error ? e.message : e);
}

/* ------------------------------------------------------------------ */
/* Delning: lägg värdens gillade i gruppen + kom ihåg vem som delade    */
/* ------------------------------------------------------------------ */

/**
 * "Dina N gillade följer med": värdens senaste gillade (watchlist = gillat men
 * inte sett) skrivs som LIKE-röster i gruppen. Då räknar /api/group/match dem
 * direkt, och när vännen gillar samma titel blir det match (2 av 2).
 * ON CONFLICT DO NOTHING — en röst värden redan lagt i gruppen skrivs aldrig
 * över. Ingen match-push här: gruppen har bara värden än.
 */
export async function seedHostLikes(groupCode: string, uid: string): Promise<number> {
  try {
    return await prisma.$executeRaw`
      INSERT INTO group_votes (group_code, user_id, tmdb_id, tmdb_type, vote, decided_at)
      SELECT ${groupCode}, w.user_id, w.tmdb_id, w.media_type, 'LIKE', NOW()
      FROM (
        SELECT user_id, tmdb_id, media_type FROM watchlist
        WHERE user_id = ${uid} AND media_type IN ('movie', 'tv')
        ORDER BY added_at DESC
        LIMIT ${HOST_LIKES_SEED}
      ) w
      ON CONFLICT (group_code, user_id, tmdb_id, tmdb_type) DO NOTHING
    `;
  } catch (e) {
    console.warn("[referral] seedHostLikes:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Senaste delaren av en grupps länk vinner (länken bär ingen avsändare). */
export async function recordReferralLink(groupCode: string, inviterId: string, device: string | null): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO referral_links (group_code, inviter_id, inviter_device, created_at)
      VALUES (${groupCode}, ${inviterId}, ${device}, NOW())
      ON CONFLICT (group_code) DO UPDATE
        SET inviter_id = EXCLUDED.inviter_id,
            inviter_device = COALESCE(EXCLUDED.inviter_device, referral_links.inviter_device),
            created_at = NOW()
    `;
  } catch (e) {
    logReferralError("recordReferralLink", e);
  }
}

/** Vem bjöd in till gruppen? Länkens delare, annars gruppens skapare. */
export async function resolveInviter(
  groupCode: string
): Promise<{ inviterId: string; inviterDevice: string | null } | null> {
  try {
    const rows = await prisma.$queryRaw<{ inviter_id: string; inviter_device: string | null }[]>`
      SELECT inviter_id, inviter_device FROM referral_links WHERE group_code = ${groupCode} LIMIT 1
    `;
    if (rows[0]) return { inviterId: rows[0].inviter_id, inviterDevice: rows[0].inviter_device };
  } catch (e) {
    logReferralError("resolveInviter", e);
  }
  const g = await prisma.group
    .findUnique({ where: { code: groupCode }, select: { createdBy: true } })
    .catch(() => null);
  return g?.createdBy ? { inviterId: g.createdBy, inviterDevice: null } : null;
}

/**
 * Den inbjudna gick just med via länken (var inte medlem innan). Skriver en
 * referral-rad — aldrig för värden själv, och 'blocked_device' om enheten är
 * värdens. Unik per inbjuden: en andra länk ger ingen ny rad.
 */
export async function recordReferralJoin(opts: {
  groupCode: string;
  inviteeId: string;
  inviteeDevice: string | null;
}): Promise<void> {
  try {
    const inviter = await resolveInviter(opts.groupCode);
    if (!inviter || inviter.inviterId === opts.inviteeId) return;
    const sameDevice = !!opts.inviteeDevice && !!inviter.inviterDevice && opts.inviteeDevice === inviter.inviterDevice;
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO referrals (id, inviter_id, invitee_id, group_code, invitee_device, status, created_at)
      VALUES (${id}, ${inviter.inviterId}, ${opts.inviteeId}, ${opts.groupCode}, ${opts.inviteeDevice},
              ${sameDevice ? "blocked_device" : "pending"}, NOW())
      ON CONFLICT (invitee_id) DO NOTHING
    `;
  } catch (e) {
    logReferralError("recordReferralJoin", e);
  }
}

/* ------------------------------------------------------------------ */
/* Belöning                                                            */
/* ------------------------------------------------------------------ */

export type ReferralRewardResult = { rewarded: false } | { rewarded: true; picks: number };

type PendingRow = { id: string; inviter_id: string; group_code: string; status: string };

/**
 * Anropas efter varje gruppröst (app/api/group/votes). Billig i normalfallet:
 * en indexerad uppslagning på invitee_id. Kastar aldrig.
 *
 * Idempotent: status-bytet pending → rewarded och de två grant-raderna (med
 * deterministiska id:n, ON CONFLICT DO NOTHING) sker i samma transaktion under
 * ett advisory-lås per värd, så två samtidiga röster kan aldrig ge dubbelt och
 * månadstaket kan inte passeras av parallella vänner.
 */
export async function maybeRewardReferral(inviteeId: string, groupCode: string): Promise<ReferralRewardResult> {
  if (tablesKnownMissing()) return { rewarded: false };
  let pending: PendingRow | undefined;
  try {
    const rows = await prisma.$queryRaw<PendingRow[]>`
      SELECT id, inviter_id, group_code, status FROM referrals
      WHERE invitee_id = ${inviteeId} AND status = 'pending'
      LIMIT 1
    `;
    pending = rows[0];
  } catch (e) {
    logReferralError("maybeRewardReferral(select)", e);
    return { rewarded: false };
  }
  if (!pending || pending.group_code !== groupCode) return { rewarded: false };

  try {
    const votes = await prisma.groupVote.count({ where: { groupCode, userId: inviteeId } });
    if (votes < REFERRAL_VOTES) return { rewarded: false };

    const row = pending;
    const monthStart = stockholmMonthStart(new Date());
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`referral:${row.inviter_id}`}))`;
      const fresh = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM referrals WHERE id = ${row.id} FOR UPDATE
      `;
      if (fresh[0]?.status !== "pending") return "noop" as const;

      const cnt = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM referrals
        WHERE inviter_id = ${row.inviter_id} AND status = 'rewarded' AND rewarded_at >= ${monthStart}
      `;
      if (Number(cnt[0]?.n ?? 0) >= REFERRAL_MONTHLY_CAP) {
        await tx.$executeRaw`UPDATE referrals SET status = 'capped' WHERE id = ${row.id}`;
        return "capped" as const;
      }

      await tx.$executeRaw`UPDATE referrals SET status = 'rewarded', rewarded_at = NOW() WHERE id = ${row.id}`;
      await tx.$executeRaw`
        INSERT INTO ai_pick_grants (id, user_id, picks, source, created_at)
        VALUES (${`ref_${row.id}_inviter`}, ${row.inviter_id}, ${REFERRAL_PICKS}, 'referral', NOW()),
               (${`ref_${row.id}_invitee`}, ${inviteeId}, ${REFERRAL_PICKS}, 'referral', NOW())
        ON CONFLICT (id) DO NOTHING
      `;
      return "rewarded" as const;
    });

    if (outcome !== "rewarded") {
      if (outcome === "capped") console.info("[referral] månadstak nått för värd", row.inviter_id);
      return { rewarded: false };
    }

    console.info("[referral] referral_reward", { referralId: row.id, groupCode });
    void notifyInviter(row.inviter_id);
    return { rewarded: true, picks: REFERRAL_PICKS };
  } catch (e) {
    logReferralError("maybeRewardReferral", e);
    return { rewarded: false };
  }
}

/** "Din vän swipade – ni fick 5 AI-val var", på värdens språk. Best effort. */
async function notifyInviter(inviterId: string): Promise<void> {
  try {
    const prof = await prisma.profile.findUnique({ where: { userId: inviterId }, select: { uiLanguage: true } });
    const locale = normalizeLocale(prof?.uiLanguage);
    const t = await getTranslations({ locale, namespace: "invite.push" });
    await sendPushToUser(inviterId, {
      title: t("rewardTitle"),
      body: t("rewardBody", { picks: REFERRAL_PICKS }),
      data: { type: "referral_reward", url: "/swipe" },
    });
  } catch (e) {
    console.warn("[referral] push till värden misslyckades:", e instanceof Error ? e.message : e);
  }
}

/* ------------------------------------------------------------------ */
/* Värdens gillade först i vännens lek                                 */
/* ------------------------------------------------------------------ */

export type PendingLikeItem = {
  id: number;
  tmdbType: "movie" | "tv";
  title: string;
  year?: string;
  poster_path?: string | null;
  vote_average?: number;
};

/**
 * Titlar som ANDRA medlemmar redan gillat i gruppen men som `uid` varken röstat
 * på i gruppen eller betygsatt. Läggs först i gruppleken (app/api/recs/unified,
 * sida 1) — det är så "värdens gillade först" fungerar, och en match kan komma
 * på vännens första gilla. Kräver medlemskap (annars läcker andras smak).
 * Kastar aldrig; tom lista vid fel.
 */
export async function pendingGroupLikes(opts: {
  groupCode: string;
  uid: string;
  language: string;
  mediaFilter?: "movie" | "tv" | "both";
  limit?: number;
}): Promise<PendingLikeItem[]> {
  try {
    const limit = Math.max(1, Math.min(opts.limit ?? 15, 30));
    const member = await prisma.groupMember.findUnique({
      where: { groupCode_userId: { groupCode: opts.groupCode, userId: opts.uid } },
      select: { userId: true },
    });
    if (!member) return [];

    const rows = await prisma.$queryRaw<{ tmdb_id: number; tmdb_type: string }[]>`
      SELECT v.tmdb_id, v.tmdb_type
      FROM group_votes v
      WHERE v.group_code = ${opts.groupCode}
        AND v.user_id <> ${opts.uid}
        AND v.vote = 'LIKE'
        AND NOT EXISTS (
          SELECT 1 FROM group_votes mine
          WHERE mine.group_code = v.group_code AND mine.user_id = ${opts.uid}
            AND mine.tmdb_id = v.tmdb_id AND mine.tmdb_type = v.tmdb_type
        )
        AND NOT EXISTS (
          SELECT 1 FROM ratings r
          WHERE r.user_id = ${opts.uid} AND r.tmdb_id = v.tmdb_id AND r.media_type = v.tmdb_type
        )
      GROUP BY v.tmdb_id, v.tmdb_type
      ORDER BY COUNT(*) DESC, MAX(v.decided_at) DESC
      LIMIT ${limit}
    `;
    const wanted = rows.filter(
      (r) =>
        (r.tmdb_type === "movie" || r.tmdb_type === "tv") &&
        (!opts.mediaFilter || opts.mediaFilter === "both" || opts.mediaFilter === r.tmdb_type)
    );
    if (wanted.length === 0) return [];

    const briefs = await Promise.all(
      wanted.map((r) => fetchTitleBrief(r.tmdb_id, r.tmdb_type as "movie" | "tv", opts.language))
    );
    const out: PendingLikeItem[] = [];
    for (const b of briefs) {
      if (!b || !b.title) continue;
      out.push({
        id: b.tmdbId,
        tmdbType: b.mediaType,
        title: b.title,
        year: b.year ?? undefined,
        poster_path: b.posterUrl,
        vote_average: b.voteAverage ?? undefined,
      });
    }
    return out;
  } catch (e) {
    console.warn("[referral] pendingGroupLikes:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Visningsnamn för värden på länksidan ("Oskar har gillat 7 titlar"). Gäster har inget namn. */
export async function inviterSummary(groupCode: string): Promise<{ name: string | null; likes: number }> {
  try {
    const inviter = await resolveInviter(groupCode);
    if (!inviter) return { name: null, likes: 0 };
    const [prof, likes] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: inviter.inviterId }, select: { displayName: true } }),
      prisma.groupVote.count({ where: { groupCode, userId: inviter.inviterId, vote: "LIKE" } }),
    ]);
    const raw = (prof?.displayName ?? "").trim();
    const name = raw && raw !== "Gäst" && raw !== "Guest" ? raw.split(/\s+/)[0].slice(0, 24) : null;
    return { name, likes };
  } catch {
    return { name: null, likes: 0 };
  }
}
