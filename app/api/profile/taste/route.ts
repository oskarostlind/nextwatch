import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isPremiumUser } from "@/lib/entitlements";
import { rateLimitAllow, getRateLimitKey, TASTE_LIMIT } from "@/lib/rateLimit";
import { TASTE_PROFILE_REQUIRES_PREMIUM } from "@/lib/tasteFeature";
import { computeTasteProfile } from "@/lib/tasteProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status = 200) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function GET(req: Request) {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  if (!uid) return fail("Ingen användare inloggad.", 401);

  if (TASTE_PROFILE_REQUIRES_PREMIUM) {
    const premium = await isPremiumUser(uid);
    if (!premium) {
      return fail("Smakprofil kräver Premium.", 403);
    }
  }

  const key = getRateLimitKey(req, uid);
  if (!rateLimitAllow(key, "taste", { limit: TASTE_LIMIT })) {
    return fail("För många förfrågningar. Försök igen senare.", 429);
  }

  const reqUrl = new URL(req.url);
  const groupCode = reqUrl.searchParams.get("group") || c.get("nw_group")?.value || null;

  const result = await computeTasteProfile({ uid, groupCode });
  if (!result.ok) return fail(result.message, result.status);
  return NextResponse.json(result);
}
