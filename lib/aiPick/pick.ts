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
// deterministiskt med samma SAVED-först-prioritet som prompten, med en
// generisk lokaliserad motivering. Användaren fick ett val → status 'ok', men
// felet loggas i `error`.
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
import { buildSystemPrompt, buildUserMessage, callPickLlm, costUsd, parsePickJson, pickModel, sanitizeUserText } from "@/lib/aiPick/llm";
import {
  createSelftestRequest,
  finishPickRequest,
  getPickQuota,
  reservePick,
  type FinishData,
} from "@/lib/aiPick/quota";
import { stockholmClock } from "@/lib/aiPick/time";
import type { PickChipId, PickItem, PickQuota, PickResponse } from "@/lib/aiPick/types";

export type NormalizedPickBody = {
  prompt: string | null;
  chips: PickChipId[];
  mediaFilter: MediaFilter;
  exclude: number[];
  sessionId: string | null;
};

export type RunPickOptions = {
  uid: string;
  body: NormalizedPickBody;
  /** nw_region-cookien; null → profilens region → "SE". */
  region: string | null;
  uiLocale: AppLocale;
  mode: "user" | "selftest";
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
  constrained: boolean;
};

export type RunPickResult = { status: number; body: PickResponse; debug: PickDebug };

/** Generiska motiveringar när modellen inte levererade (fallback). */
const FALLBACK_REASON: Record<AppLocale, { saved: string; fresh: string }> = {
  sv: {
    saved: "Du har redan sparat den här och den passar fint för ikväll – dags att faktiskt se den.",
    fresh: "Ett starkt val utifrån din smak som passar det du är sugen på just nu.",
  },
  en: {
    saved: "You already saved this one and it fits tonight nicely – time to actually watch it.",
    fresh: "A strong pick based on your taste that fits what you're in the mood for right now.",
  },
};

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
    constrained: false,
  };
}

function altLog(c: PickCandidate) {
  return { tmdbId: c.tmdbId, mediaType: c.mediaType, fromSaved: c.fromSaved };
}

export async function runPick(opts: RunPickOptions): Promise<RunPickResult> {
  const t0 = Date.now();
  const debug = emptyDebug();
  const { uid, body, uiLocale, mode } = opts;

  const quota0 = await getPickQuota(uid);
  if (!quota0) {
    // Ingen användarrad bakom cookien (anonym besökare).
    return { status: 401, body: { ok: false, error: "disabled" }, debug };
  }
  if (mode === "user" && !quota0.enabled) {
    return { status: 403, body: { ok: false, error: "disabled", quota: quota0 }, debug };
  }
  // Utan nyckel kan vi inte leverera ett AI-val — svara innan något debiteras.
  if (!process.env.ANTHROPIC_API_KEY) {
    debug.error = "ANTHROPIC_API_KEY saknas";
    return { status: 503, body: { ok: false, error: "unavailable", quota: quota0 }, debug };
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
  } else {
    requestId = await createSelftestRequest(uid, reserveInput);
  }

  const finish = async (data: FinishData) => {
    debug.latencyMs = Date.now() - t0;
    await finishPickRequest(requestId, { ...data, latencyMs: debug.latencyMs });
  };
  const freshQuota = async (): Promise<PickQuota> => (await getPickQuota(uid)) ?? quota0;

  try {
    const priority = savedPriority();
    const set = await buildCandidates({
      uid,
      region: opts.region,
      tmdbLocale: tmdbLanguage(uiLocale),
      mediaFilter: body.mediaFilter,
      chips: body.chips,
      prompt: body.prompt,
      exclude: body.exclude,
      priority,
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

    const byKey = new Map(set.candidates.map((c) => [c.key, c] as const));
    const system = buildSystemPrompt({ uiLocale, priority });
    const user = buildUserMessage({
      clock: stockholmClock(),
      mediaFilter: set.effectiveFilter,
      chips: body.chips,
      prompt: body.prompt ?? "",
      taste: set.taste,
      candidates: set.candidates,
      constrained: set.constrained,
      reference: set.reference,
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
      const parsed = parsePickJson(llm.text, new Set(byKey.keys()));
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
      reason = pick.fromSaved ? FALLBACK_REASON[uiLocale].saved : FALLBACK_REASON[uiLocale].fresh;
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
}): NormalizedPickBody {
  const prompt = sanitizeUserText(b.prompt ?? "", 300);
  return {
    prompt: prompt || null,
    chips: Array.from(new Set(b.chips ?? [])),
    mediaFilter: b.mediaFilter ?? "both",
    exclude: Array.from(new Set((b.exclude ?? []).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 100),
    sessionId: b.sessionId && /^[A-Za-z0-9_-]{1,64}$/.test(b.sessionId) ? b.sessionId : null,
  };
}
