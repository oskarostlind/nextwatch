// lib/aiPick/history.ts
//
// Historiken för "Välj åt mig" ("chattarna", v2): användaren kan gå tillbaka
// och se tidigare val. Ingen egen tabell — varje lyckat val är redan en rad i
// ai_pick_requests; v2 lägger till session_id (klientens id per konversation i
// arket), reason och result ({ pick, alternatives } som PickItem).
//
// Visas: status 'ok', source 'premium'/'credit'/'auto' (aldrig selftest) och
// result IS NOT NULL. 'auto' = dagens gratis auto-förslag (nya flödet), märks
// med `auto: true` i inlägget. Rader utan session_id är en egen session ("r:" + id).
// Sessioner nyast först, inlägg inom en session äldst → nyast. Sidindelning på
// sessionens SENASTE inlägg (`before`).
//
// "Rensa historik" nollar result/prompt/reason men behåller raderna — kvoten
// räknas bara på status/source/created_at och får aldrig påverkas.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PICK_CHIP_IDS,
  type PickChipId,
  type PickHistoryEntry,
  type PickHistorySession,
  type PickItem,
} from "@/lib/aiPick/types";

/** Tak på antal rader per sida — begränsar frågan oavsett sessionernas storlek. */
export const HISTORY_ROW_CAP = 200;
export const HISTORY_DEFAULT_LIMIT = 15;
export const HISTORY_MAX_LIMIT = 30;

export type HistoryRow = {
  id: string;
  createdAt: Date;
  sessionId: string | null;
  prompt: string | null;
  chips: unknown;
  mediaFilter: string | null;
  reason: string | null;
  result: unknown;
  /** ai_pick_requests.source — 'auto' märks i historiken. */
  source?: string | null;
};

function isPickItem(v: unknown): v is PickItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.tmdbId === "number" &&
    (o.mediaType === "movie" || o.mediaType === "tv") &&
    typeof o.title === "string"
  );
}

/** Tolkar result-snapshoten defensivt. null = oanvändbar rad (hoppas över). */
export function parseHistoryResult(v: unknown): { pick: PickItem; alternatives: PickItem[] } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isPickItem(o.pick)) return null;
  const alts = Array.isArray(o.alternatives) ? o.alternatives.filter(isPickItem).slice(0, 2) : [];
  return { pick: o.pick, alternatives: alts };
}

function parseChips(v: unknown): PickChipId[] {
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is PickChipId => typeof c === "string" && (PICK_CHIP_IDS as readonly string[]).includes(c));
}

function parseMediaFilter(v: string | null): PickHistoryEntry["mediaFilter"] {
  return v === "movie" || v === "tv" ? v : "both";
}

export function historySessionKey(row: Pick<HistoryRow, "id" | "sessionId">): string {
  return row.sessionId ? row.sessionId : `r:${row.id}`;
}

/**
 * Grupperar rader (valfri ordning) till sessioner: nyast session först,
 * inlägg äldst → nyast. `skipSessions` = sessioner som redan visats på en
 * tidigare sida (de har inlägg ≥ before). Returnerar max `limit` sessioner och
 * `hasMore` om det finns fler i underlaget.
 */
export function groupPickHistory(
  rows: HistoryRow[],
  opts: { limit: number; skipSessions?: Set<string> },
): { sessions: PickHistorySession[]; hasMore: boolean } {
  const bySession = new Map<string, PickHistoryEntry[]>();
  for (const r of rows) {
    const key = historySessionKey(r);
    if (opts.skipSessions?.has(key)) continue;
    const res = parseHistoryResult(r.result);
    if (!res) continue;
    const entry: PickHistoryEntry = {
      requestId: r.id,
      createdAt: r.createdAt.toISOString(),
      prompt: r.prompt,
      chips: parseChips(r.chips),
      mediaFilter: parseMediaFilter(r.mediaFilter),
      pick: res.pick,
      alternatives: res.alternatives,
      reason: r.reason ?? "",
      auto: r.source === "auto",
    };
    const list = bySession.get(key);
    if (list) list.push(entry);
    else bySession.set(key, [entry]);
  }
  const sessions: PickHistorySession[] = [];
  for (const [sessionId, entries] of bySession) {
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
    sessions.push({
      sessionId,
      startedAt: entries[0].createdAt,
      lastAt: entries[entries.length - 1].createdAt,
      entries,
    });
  }
  sessions.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.sessionId.localeCompare(a.sessionId));
  return { sessions: sessions.slice(0, opts.limit), hasMore: sessions.length > opts.limit };
}

const visibleWhere = (uid: string): Prisma.AiPickRequestWhereInput => ({
  userId: uid,
  status: "ok",
  source: { in: ["premium", "credit", "auto"] },
  // Dokumenterad form för "inte NULL" på Json?-fält (DB-null och JSON-null).
  NOT: { result: { equals: Prisma.AnyNull } },
});

export async function loadPickHistory(
  uid: string,
  opts: { before: Date | null; limit: number },
): Promise<{ sessions: PickHistorySession[]; nextBefore: string | null }> {
  const where = visibleWhere(uid);
  const rows = await prisma.aiPickRequest.findMany({
    where: opts.before ? { AND: [where, { createdAt: { lt: opts.before } }] } : where,
    orderBy: { createdAt: "desc" },
    take: HISTORY_ROW_CAP,
    select: {
      id: true,
      createdAt: true,
      sessionId: true,
      prompt: true,
      chips: true,
      mediaFilter: true,
      reason: true,
      result: true,
      source: true,
    },
  });

  // En session som har inlägg ≥ before visades redan på en tidigare sida —
  // dess äldre inlägg ska inte dyka upp som en egen, stympad session här.
  let skip: Set<string> | undefined;
  if (opts.before) {
    const ids = Array.from(new Set(rows.map((r) => r.sessionId).filter((s): s is string => !!s)));
    if (ids.length > 0) {
      const newer = await prisma.aiPickRequest.findMany({
        where: { AND: [where, { sessionId: { in: ids }, createdAt: { gte: opts.before } }] },
        select: { sessionId: true },
        distinct: ["sessionId"],
        take: ids.length,
      });
      skip = new Set(newer.map((r) => r.sessionId).filter((s): s is string => !!s));
    }
  }

  const { sessions, hasMore } = groupPickHistory(rows, { limit: opts.limit, skipSessions: skip });
  const more = hasMore || rows.length >= HISTORY_ROW_CAP;
  const last = sessions[sessions.length - 1];
  return { sessions, nextBefore: more && last ? last.lastAt : null };
}

/** Rensar det som VISAS — raderna (och därmed kvoten) står kvar. */
export async function clearPickHistory(uid: string): Promise<number> {
  const r = await prisma.aiPickRequest.updateMany({
    where: { userId: uid },
    data: { result: Prisma.DbNull, prompt: null, reason: null },
  });
  return r.count;
}
