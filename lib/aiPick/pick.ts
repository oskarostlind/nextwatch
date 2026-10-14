// lib/aiPick/pick.ts
//
// Hela pipelinen för ett "Välj åt mig"-val:
//   rollout → kvot/reservation → kandidater → LLM → validering/fallback →
//   loggrad → svar.
//
// Debitering: reservePick() skriver en 'pending'-rad under ett lås per
// användare innan något dyrt händer (se lib/aiPick/quota.ts). Raden skrivs
// sedan ALLTID om — 'ok' när användaren fick ett val (även via fallback),
// 'no_candidates'/'error' annars. Bara 'ok' förbrukar.
//
// Fallback: misslyckas LLM-anropet eller är svaret ogiltigt väljs
// deterministiskt med samma rangordning som urvalet (önskemål nu > kvalitet >
// smak > SAVED-bonus vid stark passform > speltid), med en
// generisk lokaliserad motivering. Användaren fick ett val → status 'ok', men
// felet loggas i `error`.
//
// Auto-förslaget (mode "auto", nya flödet 2026-10-15): samma pipeline men
// gratis — reserveAutoPick() skriver raden med source 'auto', som kvoten aldrig
// räknar. Högst ett lyckat per användare och kalenderdygn: finns dagens redan
// returneras det igen (ur `result`) utan nytt LLM-anrop. Prompten får
// "AUTOMATIC PICK"-reglerna (sparade likes först) och SAVED-prioriteten är
// alltid "strong". Inga följdfrågor — chipsen under förslaget är vanliga
// (debiterade) följdfrågor i samma session.
//
// v2: alltid två alternativ när poolen räcker (modellens giltiga först, sedan
// fillAlternatives), och 'ok'-raden sparar motivering + ögonblicksbild
// (`reason`, `result`) och klientens `session_id` för historiken.

import type { AppLocale } from "@/lib/i18nConfig";
import { tmdbLanguage } from "@/lib/i18nConfig";
import type { Prisma } from "@prisma/client";
import {
  MIN_POOL,
  buildCandidates,
  fallbackSelection,
  fillAlternatives,
  savedPriority,
  toPickItem,
  type MediaFilter,
  type PickCandidate,
} from "@/lib/aiPick/candidates";
import {
  buildSystemPrompt,
  buildUserMessage,
  callPickLlm,
  costUsd,
  parsePickJson,
  pickModel,
  REASON_MAX,
  REASON_MAX_FOLLOWUP,
  sanitizeUserText,
} from "@/lib/aiPick/llm";
import {
  describeWishes,
  loadConversation,
  mergeConversationIntent,
  resolveFocus,
  type ConvItem,
  type ConvTurn,
  type MergedConversation,
} from "@/lib/aiPick/followup";
import { markPickSeen } from "@/lib/aiPick/seen";
import {
  autoPickEnabled,
  createSelftestRequest,
  finishPickRequest,
  getPickQuota,
  loadAutoRow,
  reserveAutoPick,
  reservePick,
  type AutoRow,
  type FinishData,
} from "@/lib/aiPick/quota";
import { parseHistoryResult } from "@/lib/aiPick/history";
import { stockholmClock } from "@/lib/aiPick/time";
import type { PickChipId, PickItem, PickQuota, PickResponse } from "@/lib/aiPick/types";

export type NormalizedPickBody = {
  prompt: string | null;
  chips: PickChipId[];
  mediaFilter: MediaFilter;
  exclude: number[];
  sessionId: string | null;
  followUpOf: string | null;
  focus: { tmdbId: number; mediaType: "movie" | "tv" } | null;
  markSeen: boolean;
  /** Auto-förslaget (nya flödet). Routen kör då mode "auto"; selftest använder bara prompten. */
  auto: boolean;
};

export type RunPickOptions = {
  uid: string;
  body: NormalizedPickBody;
  /** nw_region-cookien; null → profilens region → "SE". */
  region: string | null;
  uiLocale: AppLocale;
  /** "auto" = dagens gratis auto-förslag (debiteras aldrig, 1/dygn). */
  mode: "user" | "selftest" | "auto";
};

export type PickDebug = {
  candidates: number;
  savedCandidates: number;
  freshCandidates: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  llmLatencyMs: number;
  usedFallback: boolean;
  error: string | null;
  intent: string[];
  effectiveFilter: MediaFilter | null;
  pipeline: Record<string, number | boolean> | null;
  reference: string | null;
  /** Upplösta favoriter ("Inception (2010)") som gäller samtalet. */
  loved: string[];
  /** Speltidstaket luckrades upp hit (för få bra träffar), annars null. */
  runtimeRelaxedTo: number | null;
  constrained: boolean;
  followUp: {
    turns: number;
    excluded: number;
    focus: string | null;
    terms: string[];
    filter: MediaFilter;
    reference: string | null;
    /** "Har sett den": vad som markerades (selftest: vad som SKULLE markeras). */
    markSeen: { item: string; result: "marked" | "already" | "would_mark" | "failed" } | null;
  } | null;
};

export type RunPickResult = { status: number; body: PickResponse; debug: PickDebug };

/** Generiska motiveringar när modellen inte levererade (fallback). */
const FALLBACK_REASON: Record<AppLocale, { saved: string; fresh: string; followSaved: string; followFresh: string }> = {
  sv: {
    saved: "Du har redan sparat den här och den passar fint för ikväll – dags att faktiskt se den.",
    fresh: "Ett starkt val utifrån din smak som passar det du är sugen på just nu.",
    followSaved: "Okej, då testar vi den här i stället – den ligger redan bland dina sparade och passar det du sa.",
    followFresh: "Okej, då blir det något annat – den här passar det du sa och din smak.",
  },
  en: {
    saved: "You already saved this one and it fits tonight nicely – time to actually watch it.",
    fresh: "A strong pick based on your taste that fits what you're in the mood for right now.",
    followSaved: "Okay, let's try this one instead – it's already on your list and fits what you said.",
    followFresh: "Okay, something different then – this one fits what you said and your taste.",
  },
};

function itemLabel(i: ConvItem | null): string | null {
  if (!i) return null;
  return `${i.mediaType}:${i.tmdbId}${i.title ? ` ${i.title}` : ""}`;
}

function emptyDebug(): PickDebug {
  return {
    candidates: 0,
    savedCandidates: 0,
    freshCandidates: 0,
    model: pickModel(),
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    llmLatencyMs: 0,
    usedFallback: false,
    error: null,
    intent: [],
    effectiveFilter: null,
    pipeline: null,
    reference: null,
    loved: [],
    runtimeRelaxedTo: null,
    constrained: false,
    followUp: null,
  };
}

/** Hur länge ett auto-anrop väntar in ett annat som redan pågår (förhämtningen). */
const AUTO_WAIT_MS = 20_000;
const AUTO_POLL_MS = 800;

async function waitForAutoRow(uid: string, requestId: string): Promise<AutoRow | null> {
  const deadline = Date.now() + AUTO_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, AUTO_POLL_MS));
    const row = await loadAutoRow(uid, requestId).catch(() => null);
    if (!row) return null;
    if (row.status !== "pending") return row;
  }
  return null;
}

/** Dagens redan gjorda auto-förslag som svar — null om ögonblicksbilden rensats. */
function autoReplay(row: AutoRow, quota: PickQuota): PickResponse | null {
  const snap = parseHistoryResult(row.result);
  if (!snap) return null;
  return {
    ok: true,
    pick: snap.pick,
    alternatives: snap.alternatives,
    reason: row.reason ?? "",
    quota,
    requestId: row.id,
    sessionId: row.sessionId,
    auto: true,
  };
}

function altLog(c: PickCandidate) {
  return { tmdbId: c.tmdbId, mediaType: c.mediaType, fromSaved: c.fromSaved };
}

export async function runPick(opts: RunPickOptions): Promise<RunPickResult> {
  const t0 = Date.now();
  const debug = emptyDebug();
  const { uid, body, uiLocale, mode } = opts;
  const isAuto = mode === "auto";
  // Auto-promptens regler även i selftest (&auto=1), så den går att utvärdera.
  const autoStyle = isAuto || (mode === "selftest" && body.auto);

  const [quota0, conversation] = await Promise.all([
    getPickQuota(uid),
    body.sessionId && !autoStyle
      ? loadConversation(uid, body.sessionId).catch((err) => {
          // Utan historiken blir det en vanlig fråga — hellre det än ett fel.
          console.error("[aiPick] kunde inte läsa samtalet", err);
          return { turns: [] as ConvTurn[], shownIds: [] as number[] };
        })
      : Promise.resolve({ turns: [] as ConvTurn[], shownIds: [] as number[] }),
  ]);
  if (!quota0) {
    // Ingen användarrad bakom cookien (anonym besökare).
    return { status: 401, body: { ok: false, error: "disabled" }, debug };
  }
  if (mode !== "selftest" && !quota0.enabled) {
    return { status: 403, body: { ok: false, error: "disabled", quota: quota0 }, debug };
  }
  if (isAuto && !autoPickEnabled()) {
    return { status: 403, body: { ok: false, error: "disabled", quota: quota0 }, debug };
  }
  // Utan nyckel kan vi inte leverera ett AI-val — svara innan något debiteras.
  if (!process.env.ANTHROPIC_API_KEY) {
    debug.error = "ANTHROPIC_API_KEY saknas";
    return { status: 503, body: { ok: false, error: "unavailable", quota: quota0 }, debug };
  }

  // Följdfråga: tolka meddelandet i samtalets sammanhang (lib/aiPick/followup.ts).
  const turns = conversation.turns;
  const focus = autoStyle ? null : resolveFocus(turns, body.followUpOf, body.focus);
  const merged: MergedConversation | null =
    turns.length > 0
      ? mergeConversationIntent({ turns, prompt: body.prompt, chips: body.chips, clientFilter: body.mediaFilter, focus })
      : null;
  const exclude = Array.from(new Set([...body.exclude, ...conversation.shownIds]));
  if (merged) {
    const ref = merged.reference;
    debug.followUp = {
      turns: turns.length,
      excluded: exclude.length,
      focus: itemLabel(focus),
      terms: merged.intent.terms,
      filter: merged.filter,
      reference: [
        merged.knownRef ? `known ${itemLabel(merged.knownRef)}` : null,
        merged.refQueries.length ? `refs ${merged.refQueries.map((r) => `"${r.query}"`).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; ") || (ref ? `text "${ref.kind === "text" ? ref.ref.query : ""}"` : null),
      markSeen: null,
    };
  }

  // "Har sett den" (+ markSeen från klienten): spara som swipens "Sett".
  // Före debiteringen och oberoende av den — det är ett faktum om användaren,
  // inte en del av valet. selftest sparar ALDRIG, rapporterar bara.
  if (body.markSeen && focus && !autoStyle) {
    const label = itemLabel(focus) ?? "";
    if (mode === "selftest") {
      if (debug.followUp) debug.followUp.markSeen = { item: label, result: "would_mark" };
    } else {
      try {
        const r = await markPickSeen(uid, focus);
        if (debug.followUp) debug.followUp.markSeen = { item: label, result: r };
      } catch (err) {
        console.error("[aiPick] markSeen misslyckades", err);
        if (debug.followUp) debug.followUp.markSeen = { item: label, result: "failed" };
      }
    }
  }

  const reserveInput = {
    prompt: body.prompt,
    chips: body.chips,
    mediaFilter: body.mediaFilter,
    sessionId: body.sessionId,
  };
  let requestId: string;
  if (mode === "user") {
    const r = await reservePick(uid, quota0.premium, quota0.enabled, reserveInput);
    if (!r.ok) return { status: 402, body: { ok: false, error: "no_quota", quota: r.quota }, debug };
    requestId = r.requestId;
  } else if (isAuto) {
    const r = await reserveAutoPick(uid, reserveInput);
    if (r.kind === "done" || r.kind === "busy") {
      // Samma dygn igen (eller förhämtningen pågår): samma förslag, inget nytt anrop.
      const row = r.kind === "done" ? r.row : await waitForAutoRow(uid, r.requestId);
      const replay = row && row.status === "ok" ? autoReplay(row, quota0) : null;
      if (replay) return { status: 200, body: replay, debug };
      return { status: r.kind === "done" ? 429 : 503, body: { ok: false, error: "unavailable", quota: quota0 }, debug };
    }
    if (r.kind === "limit") {
      return { status: 429, body: { ok: false, error: "unavailable", quota: quota0 }, debug };
    }
    requestId = r.requestId;
  } else {
    requestId = await createSelftestRequest(uid, reserveInput);
  }

  const finish = async (data: FinishData) => {
    debug.latencyMs = Date.now() - t0;
    await finishPickRequest(requestId, { ...data, latencyMs: debug.latencyMs });
  };
  const freshQuota = async (): Promise<PickQuota> => (await getPickQuota(uid)) ?? quota0;

  try {
    // Auto: sparade likes först, oavsett PICK_SAVED_PRIORITY.
    const priority = autoStyle ? "strong" : savedPriority();
    const set = await buildCandidates({
      uid,
      region: opts.region,
      tmdbLocale: tmdbLanguage(uiLocale),
      mediaFilter: body.mediaFilter,
      chips: body.chips,
      prompt: body.prompt,
      exclude,
      priority,
      followUp: merged
        ? {
            intent: merged.intent,
            filter: merged.filter,
            // Favoriterna från HELA samtalet ("Mina favoriter är X, Y och Z" i tur 1
            // gäller fortfarande i tur 3).
            refs: merged.refQueries,
            knownRef: merged.knownRef
              ? {
                  tmdbId: merged.knownRef.tmdbId,
                  mediaType: merged.knownRef.mediaType,
                  // Titeln saknas bara om historiken rensats — etiketten måste
                  // ändå vara icke-tom, annars tappar kandidaterna "similar to".
                  title: merged.knownRef.title ?? "the previous suggestion",
                  year: merged.knownRef.year,
                }
              : null,
          }
        : undefined,
    });

    // v2: poolen är mjuk och bred — under MIN_POOL (3) ska i praktiken aldrig hända.
    if (!set || set.candidates.length < MIN_POOL) {
      debug.error = set ? "no_candidates" : "profile_missing";
      debug.pipeline = set ? { ...set.debug } : null;
      debug.intent = set?.intent.terms ?? [];
      await finish({ status: "no_candidates", savedCandidates: 0, model: debug.model, error: debug.error });
      return { status: 200, body: { ok: false, error: "no_candidates", quota: await freshQuota() }, debug };
    }

    debug.candidates = set.candidates.length;
    debug.savedCandidates = set.savedCount;
    debug.freshCandidates = set.freshCount;
    debug.intent = set.intent.terms;
    debug.effectiveFilter = set.effectiveFilter;
    debug.pipeline = { ...set.debug };
    debug.constrained = set.constrained;
    debug.reference = set.reference ? `${set.reference.mediaType}:${set.reference.tmdbId} ${set.reference.title}` : null;
    debug.loved = set.lovedTitles.map((l) => `${l.title}${l.year ? ` (${l.year})` : ""}`);
    debug.runtimeRelaxedTo = set.runtimeRelaxedTo;

    const byKey = new Map(set.candidates.map((c) => [c.key, c] as const));
    const system = buildSystemPrompt({ uiLocale, priority, followUp: merged !== null, auto: autoStyle });
    const user = buildUserMessage({
      clock: stockholmClock(),
      mediaFilter: set.effectiveFilter,
      chips: body.chips,
      prompt: body.prompt ?? "",
      taste: set.taste,
      candidates: set.candidates,
      constrained: set.constrained,
      reference: set.reference,
      // Favoriterna (hela samtalet) + ev. uppluckrad speltid — se llm.ts.
      lovedTitles: set.lovedTitles,
      runtimeRelaxedTo: set.runtimeRelaxedTo,
      conversation: merged
        ? {
            turns,
            focus,
            seen: merged.seenItem,
            // set.intent = de sammanslagna önskemålen inkl. ev. uppluckrad speltid.
            wishes: describeWishes(set.intent, set.effectiveFilter),
          }
        : null,
    });

    const llm = await callPickLlm(system, user);
    debug.model = llm.model;
    debug.inputTokens = llm.inputTokens;
    debug.outputTokens = llm.outputTokens;
    debug.costUsd = costUsd(llm.inputTokens, llm.outputTokens);
    debug.llmLatencyMs = llm.latencyMs;

    let pick: PickCandidate | undefined;
    let alternatives: PickCandidate[] = [];
    let reason = "";
    let error: string | null = null;

    if (llm.ok) {
      const parsed = parsePickJson(llm.text, new Set(byKey.keys()), merged ? REASON_MAX_FOLLOWUP : REASON_MAX);
      if ("error" in parsed) {
        error = `invalid_output:${parsed.error} :: ${llm.text.slice(0, 300)}`;
      } else {
        pick = byKey.get(parsed.pick);
        alternatives = parsed.alternatives.map((k) => byKey.get(k)).filter((c): c is PickCandidate => !!c);
        reason = parsed.reason;
      }
    } else {
      error = llm.error;
    }

    if (!pick) {
      const fb = fallbackSelection(set.candidates, set.rank);
      if (!fb) {
        // Kan inte hända med icke-tom kandidatlista, men var defensiv.
        await finish({ status: "error", model: debug.model, error: error ?? "fallback_empty" });
        return { status: 503, body: { ok: false, error: "unavailable", quota: await freshQuota() }, debug };
      }
      debug.usedFallback = true;
      pick = fb.pick;
      alternatives = fb.alternatives;
      const fr = FALLBACK_REASON[uiLocale];
      reason = merged
        ? pick.fromSaved
          ? fr.followSaved
          : fr.followFresh
        : pick.fromSaved
          ? fr.saved
          : fr.fresh;
    }
    // Alltid två alternativ när poolen räcker — modellens giltiga först.
    alternatives = fillAlternatives(pick, alternatives, set.candidates, set.rank);
    debug.error = error;

    const pickItem = toPickItem(pick, set.services);
    const altItems = alternatives.map((c) => toPickItem(c, set.services));
    const snapshot: { pick: PickItem; alternatives: PickItem[] } = { pick: pickItem, alternatives: altItems };

    await finish({
      status: "ok",
      pickTmdbId: pick.tmdbId,
      pickMediaType: pick.mediaType,
      pickFromSaved: pick.fromSaved,
      savedCandidates: set.savedCount,
      alternatives: alternatives.map(altLog),
      model: debug.model,
      inputTokens: llm.inputTokens || null,
      outputTokens: llm.outputTokens || null,
      costUsd: llm.inputTokens || llm.outputTokens ? debug.costUsd : null,
      error,
      reason,
      result: snapshot as unknown as Prisma.InputJsonValue,
    });

    return {
      status: 200,
      body: {
        ok: true,
        pick: pickItem,
        alternatives: altItems,
        reason,
        quota: await freshQuota(),
        requestId,
        sessionId: body.sessionId,
        ...(isAuto ? { auto: true } : {}),
      },
      debug,
    };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[aiPick] pipeline-fel", err);
    debug.error = msg;
    await finish({ status: "error", model: debug.model, error: msg });
    return { status: 503, body: { ok: false, error: "unavailable", quota: await freshQuota().catch(() => quota0) }, debug };
  }
}

/** Normaliserar ett redan zod-validerat body till pipelinens form. */
export function normalizePickBody(b: {
  prompt?: string;
  chips?: PickChipId[];
  mediaFilter?: MediaFilter;
  exclude?: number[];
  sessionId?: string;
  followUpOf?: string;
  focus?: { tmdbId: number; mediaType: "movie" | "tv" };
  markSeen?: boolean;
  auto?: boolean;
}): NormalizedPickBody {
  const prompt = sanitizeUserText(b.prompt ?? "", 300);
  return {
    prompt: prompt || null,
    chips: Array.from(new Set(b.chips ?? [])),
    mediaFilter: b.mediaFilter ?? "both",
    exclude: Array.from(new Set((b.exclude ?? []).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 100),
    sessionId: b.sessionId && /^[A-Za-z0-9_-]{1,64}$/.test(b.sessionId) ? b.sessionId : null,
    followUpOf: b.followUpOf && /^[A-Za-z0-9_-]{1,64}$/.test(b.followUpOf) ? b.followUpOf : null,
    focus:
      b.focus && Number.isInteger(b.focus.tmdbId) && b.focus.tmdbId > 0 && (b.focus.mediaType === "movie" || b.focus.mediaType === "tv")
        ? { tmdbId: b.focus.tmdbId, mediaType: b.focus.mediaType }
        : null,
    markSeen: b.markSeen === true,
    auto: b.auto === true,
  };
}
