// app/api/pick/route.ts
//
// POST /api/pick — "Välj åt mig". Kroppen är PickRequestBody
// (lib/aiPick/types.ts); svaret PickResponse. All logik bor i
// lib/aiPick/pick.ts — routen sköter bara cookie, rate limit och validering.
//
// HTTP: 200 ok (även ok:false no_candidates), 400 bad_request, 401 utan
// session, 402 no_quota, 403 disabled (utrullningsflaggan), 429 rate limit,
// 503 unavailable. Ingenting debiteras vid fel.
//
// { auto: true } (nya flödet): gratis auto-förslag, högst ett per användare och
// kalenderdygn (Stockholm) — samma dygn igen ger samma förslag; 429 när dagens
// försök är slut.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRateLimitKey, rateLimitAllow } from "@/lib/rateLimit";
import { uiLocaleFromCookies } from "@/lib/serverLocale";
import { pickRequestSchema } from "@/lib/aiPick/schema";
import { normalizePickBody, runPick } from "@/lib/aiPick/pick";
import type { PickResponse } from "@/lib/aiPick/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Kandidatberikning (TMDB) + recommender + LLM (12 s timeout) får plats här.
export const maxDuration = 30;

/** Per uid och minut. Ett val tar några sekunder — 10/min räcker gott. */
const PICK_RATE_LIMIT = 10;

function json(body: PickResponse, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const jar = await cookies();
  const uid = jar.get("nw_uid")?.value ?? null;
  if (!uid) return json({ ok: false, error: "disabled" }, 401);

  if (!rateLimitAllow(getRateLimitKey(req, uid), "pick", { limit: PICK_RATE_LIMIT })) {
    return json({ ok: false, error: "unavailable" }, 429);
  }

  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const parsed = pickRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "bad_request" }, 400);

  try {
    const result = await runPick({
      uid,
      body: normalizePickBody(parsed.data),
      region: jar.get("nw_region")?.value ?? null,
      uiLocale: await uiLocaleFromCookies(),
      // { auto: true } = dagens gratis auto-förslag (lib/aiPick/pick.ts) — debiteras aldrig.
      mode: parsed.data.auto ? "auto" : "user",
    });
    return json(result.body, result.status);
  } catch (e) {
    // DB-/transaktionsfel → JSON-503 i stället för Nexts HTML-500. Inget har
    // debiterats: en reserverad rad som aldrig skrevs om slutar räknas efter
    // PENDING_STALE_MS.
    console.error("[pick] runPick failed", e);
    return json({ ok: false, error: "unavailable" }, 503);
  }
}
