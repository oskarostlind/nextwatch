// lib/aiPick/quota.ts
//
// Kvoten för "Välj åt mig". Servern är enda sanningen — klienten visar bara
// det som kommer härifrån.
//
// Regler (Oskars beslut 2026-10-13, premium ändrat 2026-10-15):
//   - Premium: OBEGRÄNSAT. Ett dolt rimlighetstak mot missbruk,
//     NW_PICK_PREMIUM_DAILY_CAP (100) val per KALENDERDYGN i Europe/Stockholm,
//     visas aldrig i UI:t. Når någon taket kan de fylla på med rewarded video
//     som gratis (samma krediter), annars väntar de till midnatt.
//   - Gratis: 0 val som standard. Varje tittad rewarded video ger
//     NW_PICK_REWARD_PICKS (3) krediter, max NW_PICK_REWARD_MAX_PER_DAY (10)
//     videor per kalenderdygn (anti-fusk: belöningen litar på klientens event,
//     samma som swipe-bonusen — taket begränsar vad ett fusk kan ge).
//   - credits = summa grants.picks − antal 'ok'-förfrågningar med source
//     'credit' (all tid). premiumUsed = antal 'ok' med source 'premium' i
//     innevarande kalenderdygn.
//   - Auto-förslaget (source 'auto', nya flödet) räknas ALDRIG — varken mot
//     premium eller krediter. Högst ett lyckat per användare och kalenderdygn
//     (reserveAutoPick nedan); ett andra anrop samma dygn får samma förslag.
//   - Debiteringsordning: premium med kvar → 'premium'; annars krediter → 'credit';
//     annars 402. Bara status 'ok' förbrukar — fel och no_candidates aldrig.
//
// Dubbeltryck: reservePick() tar ett transaktionslokalt advisory-lås per
// användare, räknar om och skriver en rad med status 'pending' innan LLM-
// anropet. Två samtidiga tryck serialiseras alltså på låset, och det andra ser
// det förstas reservation. 'pending' räknas som förbrukad i högst
// PENDING_STALE_MS — en förfrågan som dog halvvägs (timeout, deploy) slutar
// därefter att räknas, så användaren aldrig debiteras för något hen inte fick.
// Raden skrivs alltid om till ok/error/no_candidates av lib/aiPick/pick.ts.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeEntitlement } from "@/lib/entitlements";
import { isPickEnabledFor } from "@/lib/aiPick/rollout";
import { stockholmDayStart } from "@/lib/aiPick/time";
import type { PickQuota } from "@/lib/aiPick/types";

/* ---------------- Konfiguration (env, läses vid anrop) ---------------- */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export type PickConfig = {
  /** Dolt dygnstak för premium (obegränsat i UI:t). */
  premiumDailyCap: number;
  rewardPicks: number;
  rewardMaxPerDay: number;
  /** Gratis val för nya konton (innan reklamlåset) — för att locka in dem. */
  welcomePicks: number;
  /** Konton skapade från och med detta datum får välkomstvalen. */
  welcomeSince: Date;
};

// Välkomstvalen gäller konton skapade från lanseringsdagen. Sätt
// NW_PICK_WELCOME_SINCE till ett tidigare datum (ISO) för att ge även
// befintliga konton dem — ingen deploy behövs för att ändra antalet.
const WELCOME_SINCE_DEFAULT = "2026-10-13T00:00:00+02:00";

function envDate(name: string, fallback: string): Date {
  const d = new Date(process.env[name] || fallback);
  return Number.isNaN(d.getTime()) ? new Date(fallback) : d;
}

export function pickConfig(): PickConfig {
  return {
    premiumDailyCap: envInt("NW_PICK_PREMIUM_DAILY_CAP", 100),
    rewardPicks: envInt("NW_PICK_REWARD_PICKS", 3),
    rewardMaxPerDay: envInt("NW_PICK_REWARD_MAX_PER_DAY", 10),
    welcomePicks: envInt("NW_PICK_WELCOME_PICKS", 5),
    welcomeSince: envDate("NW_PICK_WELCOME_SINCE", WELCOME_SINCE_DEFAULT),
  };
}

/** En 'pending' äldre än så här räknas inte (förfrågan dog halvvägs). */
// Strax över routens maxDuration (30 s): en förfrågan som Vercel dödade ska
// inte blockera ett nytt försök längre än nödvändigt.
export const PENDING_STALE_MS = 45 * 1000;

export type ChargeSource = "premium" | "credit";

/* ---------------- Ren aritmetik (testbar utan DB) ---------------- */

export type PickUsage = {
  /** 'ok' (+ färska 'pending') med source 'premium' i innevarande kalenderdygn. */
  premiumUsed: number;
  /** 'ok' (+ färska 'pending') med source 'credit', all tid. */
  creditUsed: number;
  /** Summa grants.picks, all tid. */
  grantedPicks: number;
  /** Antal grants i innevarande kalenderdygn. */
  grantsToday: number;
  /** Välkomstval kontot har rätt till (0 för konton från före lanseringen). */
  welcomePicks: number;
};

export function computeQuota(input: {
  enabled: boolean;
  premium: boolean;
  usage: PickUsage;
  cfg: PickConfig;
}): PickQuota {
  const { enabled, premium, usage, cfg } = input;
  const premiumLeft = premium ? Math.max(0, cfg.premiumDailyCap - usage.premiumUsed) : null;
  // Välkomstvalen ligger i samma kreditpott som reklamvalen och förbrukas först.
  const credits = Math.max(0, usage.welcomePicks + usage.grantedPicks - usage.creditUsed);
  const welcomeLeft = Math.max(0, usage.welcomePicks - usage.creditUsed);
  const rewardsLeftToday =
    cfg.rewardPicks > 0 ? Math.max(0, cfg.rewardMaxPerDay - usage.grantsToday) : 0;
  return {
    enabled,
    premium,
    unlimited: premium,
    premiumLeft,
    credits,
    rewardPicks: cfg.rewardPicks,
    rewardsLeftToday,
    totalLeft: (premiumLeft ?? 0) + credits,
    welcomeLeft,
  };
}

/** Vilken pott ett nytt val debiteras från, eller null (= 402). */
export function chargeSourceFor(q: PickQuota): ChargeSource | null {
  if (q.premium && (q.premiumLeft ?? 0) > 0) return "premium";
  if (q.credits > 0) return "credit";
  return null;
}

/* ---------------- DB ---------------- */

type Db = Prisma.TransactionClient | typeof prisma;

/** Rader som förbrukar: 'ok', plus 'pending' som fortfarande pågår. */
function consumingWhere(now: Date): Prisma.AiPickRequestWhereInput {
  return {
    OR: [
      { status: "ok" },
      { status: "pending", createdAt: { gte: new Date(now.getTime() - PENDING_STALE_MS) } },
    ],
  };
}

async function loadUsage(db: Db, uid: string, now: Date): Promise<PickUsage> {
  const dayStart = stockholmDayStart(now);
  const consuming = consumingWhere(now);
  const cfg = pickConfig();
  const [premiumUsed, creditUsed, grantAgg, grantsToday, user] = await Promise.all([
    db.aiPickRequest.count({
      where: { AND: [{ userId: uid, source: "premium", createdAt: { gte: dayStart } }, consuming] },
    }),
    db.aiPickRequest.count({
      where: { AND: [{ userId: uid, source: "credit" }, consuming] },
    }),
    db.aiPickGrant.aggregate({ where: { userId: uid }, _sum: { picks: true } }),
    db.aiPickGrant.count({ where: { userId: uid, createdAt: { gte: dayStart } } }),
    db.user.findUnique({ where: { id: uid }, select: { createdAt: true } }),
  ]);
  return {
    premiumUsed,
    creditUsed,
    grantedPicks: grantAgg._sum.picks ?? 0,
    grantsToday,
    welcomePicks: user && user.createdAt >= cfg.welcomeSince ? cfg.welcomePicks : 0,
  };
}

/** Premium-status, eller null om användaren inte finns (anonym cookie). */
async function loadPremium(uid: string): Promise<boolean | null> {
  const u = await prisma.user.findUnique({
    where: { id: uid },
    select: { plan: true, subProvider: true, subStatus: true, subCurrentPeriodEnd: true },
  });
  if (!u) return null;
  return computeEntitlement(u).isPremium;
}

/**
 * Transaktionslokalt advisory-lås per användare — släpps automatiskt vid
 * commit/rollback, så det fungerar även bakom Neons pooler (transaction mode).
 * `SELECT 1 FROM …` i stället för att selecta void-värdet direkt: Prisma kan
 * inte deserialisera kolumntypen void.
 */
async function lockUser(tx: Prisma.TransactionClient, uid: string): Promise<void> {
  const key = `ai_pick:${uid}`;
  await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * Kvoten för en användare. null = användaren finns inte (bara en anonym
 * nw_uid-cookie från middleware) → routen svarar 401.
 */
export async function getPickQuota(uid: string, now: Date = new Date()): Promise<PickQuota | null> {
  const [premium, enabled] = await Promise.all([loadPremium(uid), isPickEnabledFor(uid)]);
  if (premium === null) return null;
  // Statusen hämtas på varje swipe-skärm: för användare utan funktionen
  // (utrullningen) räcker två billiga frågor — hoppa över räkningarna.
  const usage: PickUsage = enabled
    ? await loadUsage(prisma, uid, now)
    : { premiumUsed: 0, creditUsed: 0, grantedPicks: 0, grantsToday: 0, welcomePicks: 0 };
  return computeQuota({ enabled, premium, usage, cfg: pickConfig() });
}

export type ReserveInput = {
  prompt: string | null;
  chips: string[];
  mediaFilter: string;
  /** Klientens konversations-id (historiken), null = egen session. */
  sessionId: string | null;
};

export type ReserveResult =
  | { ok: true; requestId: string; source: ChargeSource }
  | { ok: false; quota: PickQuota };

/**
 * Reserverar ett val: lås → räkna om → skriv 'pending'-rad med rätt source.
 * Anroparen MÅSTE sedan skriva om raden via finishPickRequest().
 */
export async function reservePick(
  uid: string,
  premium: boolean,
  enabled: boolean,
  input: ReserveInput,
): Promise<ReserveResult> {
  const cfg = pickConfig();
  return prisma.$transaction(
    async (tx) => {
      await lockUser(tx, uid);
      const now = new Date();
      const usage = await loadUsage(tx, uid, now);
      const quota = computeQuota({ enabled, premium, usage, cfg });
      const source = chargeSourceFor(quota);
      if (!source) return { ok: false as const, quota };
      const row = await tx.aiPickRequest.create({
        data: {
          userId: uid,
          source,
          status: "pending",
          prompt: input.prompt,
          chips: input.chips,
          mediaFilter: input.mediaFilter,
          sessionId: input.sessionId,
        },
        select: { id: true },
      });
      return { ok: true as const, requestId: row.id, source };
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

/* ---------------- Auto-förslaget (gratis, 1/dygn) ---------------- */

/** Max antal FÖRSÖK (alla statusar) per dygn — ett lyckat räcker, fel får försökas om. */
export const AUTO_MAX_ATTEMPTS_PER_DAY = 3;

/** Env-kill switch utan deploy: NW_PICK_AUTO=0 stänger av auto-förslaget. */
export function autoPickEnabled(): boolean {
  const v = (process.env.NW_PICK_AUTO ?? "").trim().toLowerCase();
  return !(v === "0" || v === "off" || v === "false");
}

export type AutoRow = {
  id: string;
  status: string;
  createdAt: Date;
  sessionId: string | null;
  reason: string | null;
  result: Prisma.JsonValue | null;
};

const AUTO_ROW_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  sessionId: true,
  reason: true,
  result: true,
} as const;

export type AutoReserveResult =
  /** Dagens auto-förslag finns redan → visa det igen (inget nytt LLM-anrop). */
  | { kind: "done"; row: AutoRow }
  /** Ett annat anrop (förhämtningen, en annan flik) håller på just nu. */
  | { kind: "busy"; requestId: string }
  /** För många misslyckade försök idag. */
  | { kind: "limit" }
  | { kind: "reserved"; requestId: string };

/**
 * Reserverar dagens auto-förslag under samma lås som reservePick: finns ett
 * 'ok' i dag → "done"; pågår ett → "busy"; annars en ny 'pending'-rad med
 * source 'auto'. Raden räknas aldrig av loadUsage (som bara räknar
 * premium/credit), så auto-förslaget kan aldrig debiteras.
 */
export async function reserveAutoPick(uid: string, input: ReserveInput): Promise<AutoReserveResult> {
  return prisma.$transaction(
    async (tx) => {
      await lockUser(tx, uid);
      const now = new Date();
      const rows = await tx.aiPickRequest.findMany({
        where: { userId: uid, source: "auto", createdAt: { gte: stockholmDayStart(now) } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: AUTO_ROW_SELECT,
      });
      const ok = rows.find((r) => r.status === "ok");
      if (ok) return { kind: "done" as const, row: ok };
      const fresh = rows.find(
        (r) => r.status === "pending" && now.getTime() - r.createdAt.getTime() < PENDING_STALE_MS,
      );
      if (fresh) return { kind: "busy" as const, requestId: fresh.id };
      if (rows.length >= AUTO_MAX_ATTEMPTS_PER_DAY) return { kind: "limit" as const };
      const row = await tx.aiPickRequest.create({
        data: {
          userId: uid,
          source: "auto",
          status: "pending",
          prompt: input.prompt,
          chips: input.chips,
          mediaFilter: input.mediaFilter,
          sessionId: input.sessionId,
        },
        select: { id: true },
      });
      return { kind: "reserved" as const, requestId: row.id };
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

/** En auto-rad (för att vänta in ett pågående anrop). null om den saknas. */
export async function loadAutoRow(uid: string, requestId: string): Promise<AutoRow | null> {
  return prisma.aiPickRequest.findFirst({
    where: { id: requestId, userId: uid, source: "auto" },
    select: AUTO_ROW_SELECT,
  });
}

/** Loggrad för selftest — debiterar aldrig (source 'selftest'). */
export async function createSelftestRequest(uid: string, input: ReserveInput): Promise<string> {
  const row = await prisma.aiPickRequest.create({
    data: {
      userId: uid,
      source: "selftest",
      status: "pending",
      prompt: input.prompt,
      chips: input.chips,
      mediaFilter: input.mediaFilter,
      sessionId: input.sessionId,
    },
    select: { id: true },
  });
  return row.id;
}

export type FinishData = {
  status: "ok" | "error" | "no_candidates";
  pickTmdbId?: number | null;
  pickMediaType?: string | null;
  pickFromSaved?: boolean | null;
  savedCandidates?: number | null;
  alternatives?: { tmdbId: number; mediaType: string; fromSaved: boolean }[] | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  /** Motiveringen som visades (bara 'ok'). */
  reason?: string | null;
  /** { pick, alternatives } som PickItem — historikens ögonblicksbild (bara 'ok'). */
  result?: Prisma.InputJsonValue | null;
};

/** Skriver om reservationen till slutstatus. Kastar aldrig (loggar). */
export async function finishPickRequest(requestId: string, data: FinishData): Promise<void> {
  try {
    await prisma.aiPickRequest.update({
      where: { id: requestId },
      data: {
        status: data.status,
        pickTmdbId: data.pickTmdbId ?? null,
        pickMediaType: data.pickMediaType ?? null,
        pickFromSaved: data.pickFromSaved ?? null,
        savedCandidates: data.savedCandidates ?? null,
        alternatives: data.alternatives ? (data.alternatives as Prisma.InputJsonValue) : Prisma.DbNull,
        model: data.model ?? null,
        inputTokens: data.inputTokens ?? null,
        outputTokens: data.outputTokens ?? null,
        costUsd: data.costUsd ?? null,
        latencyMs: data.latencyMs ?? null,
        error: data.error ? data.error.slice(0, 1000) : null,
        reason: data.reason ?? null,
        result: data.result ?? Prisma.DbNull,
      },
      select: { id: true },
    });
  } catch (err) {
    // Misslyckas uppdateringen blir raden kvar som 'pending' och slutar räknas
    // efter PENDING_STALE_MS — användaren förlorar alltså aldrig ett val på det.
    console.error("[aiPick] kunde inte avsluta förfrågan", requestId, err);
  }
}

export type RewardResult = { ok: true; quota: PickQuota } | { ok: false; quota: PickQuota };

/**
 * Beviljar +rewardPicks efter en tittad rewarded video, om dagens tak inte
 * nåtts. Samma lås som reservePick så två snabba anrop inte båda kommer förbi
 * taket.
 */
export async function grantReward(
  uid: string,
  premium: boolean,
  enabled: boolean,
): Promise<RewardResult> {
  const cfg = pickConfig();
  const granted = await prisma.$transaction(
    async (tx) => {
      await lockUser(tx, uid);
      const now = new Date();
      const usage = await loadUsage(tx, uid, now);
      const before = computeQuota({ enabled, premium, usage, cfg });
      if (before.rewardsLeftToday <= 0 || cfg.rewardPicks <= 0) return false;
      await tx.aiPickGrant.create({
        data: { userId: uid, picks: cfg.rewardPicks, source: "rewarded" },
      });
      return true;
    },
    { maxWait: 5000, timeout: 10000 },
  );
  const usage = await loadUsage(prisma, uid, new Date());
  const quota = computeQuota({ enabled, premium, usage, cfg });
  return granted ? { ok: true, quota } : { ok: false, quota };
}

/** Bara premium-flaggan (för routes som redan har uid och vill reservera). */
export async function loadPickPremium(uid: string): Promise<boolean | null> {
  return loadPremium(uid);
}
