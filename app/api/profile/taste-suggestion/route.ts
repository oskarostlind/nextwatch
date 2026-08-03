import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimitAllow, getRateLimitKey, TASTE_LIMIT } from "@/lib/rateLimit";
import { computeTasteSuggestion } from "@/lib/tasteSuggestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function GET(req: Request) {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) return fail("Ingen användare inloggad.", 401);

  const key = getRateLimitKey(req, uid);
  if (!rateLimitAllow(key, "taste-suggestion", { limit: TASTE_LIMIT })) {
    return fail("För många förfrågningar. Försök igen senare.", 429);
  }

  const result = await computeTasteSuggestion(uid);
  if (!result.ok) return fail(result.message, result.status);
  return NextResponse.json(result);
}
