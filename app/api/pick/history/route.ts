// app/api/pick/history/route.ts
//
// GET    /api/pick/history?before=<ISO>&limit=<1..30, default 15>
//          → PickHistoryResponse { ok, sessions, nextBefore }
// DELETE /api/pick/history → PickHistoryClearResponse { ok: true }
//
// Historiken ("chattarna") för "Välj åt mig" — logiken bor i
// lib/aiPick/history.ts. DELETE rensar bara det som visas (result/prompt/
// reason nollas); raderna står kvar så kvoten aldrig påverkas.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRateLimitKey, rateLimitAllow } from "@/lib/rateLimit";
import { pickHistoryQuerySchema } from "@/lib/aiPick/schema";
import { HISTORY_DEFAULT_LIMIT, clearPickHistory, loadPickHistory } from "@/lib/aiPick/history";
import type { PickHistoryClearResponse, PickHistoryResponse } from "@/lib/aiPick/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json<T extends PickHistoryResponse | PickHistoryClearResponse | { ok: false; error: "bad_request" }>(
  body: T,
  status = 200,
) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(req: Request) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!uid) return json<PickHistoryResponse>({ ok: false, error: "unauthorized" }, 401);
  if (!rateLimitAllow(getRateLimitKey(req, uid), "pick-history", { limit: 60 })) {
    return json<PickHistoryResponse>({ ok: false, error: "unavailable" }, 429);
  }

  const sp = new URL(req.url).searchParams;
  const parsed = pickHistoryQuerySchema.safeParse({
    before: sp.get("before") || undefined,
    limit: sp.get("limit") || undefined,
  });
  if (!parsed.success) return json({ ok: false as const, error: "bad_request" as const }, 400);

  try {
    const res = await loadPickHistory(uid, {
      before: parsed.data.before ? new Date(parsed.data.before) : null,
      limit: parsed.data.limit ?? HISTORY_DEFAULT_LIMIT,
    });
    return json<PickHistoryResponse>({ ok: true, sessions: res.sessions, nextBefore: res.nextBefore });
  } catch (err) {
    console.error("[pick/history] GET", err);
    return json<PickHistoryResponse>({ ok: false, error: "unavailable" }, 503);
  }
}

export async function DELETE(req: Request) {
  const uid = (await cookies()).get("nw_uid")?.value ?? null;
  if (!uid) return json<PickHistoryClearResponse>({ ok: false, error: "unauthorized" }, 401);
  if (!rateLimitAllow(getRateLimitKey(req, uid), "pick-history-clear", { limit: 10 })) {
    return json<PickHistoryClearResponse>({ ok: false, error: "unavailable" }, 429);
  }
  try {
    await clearPickHistory(uid);
    return json<PickHistoryClearResponse>({ ok: true });
  } catch (err) {
    console.error("[pick/history] DELETE", err);
    return json<PickHistoryClearResponse>({ ok: false, error: "unavailable" }, 503);
  }
}
