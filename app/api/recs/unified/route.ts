import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimitAllow, getRateLimitKey, RECS_LIMIT } from "../../../../lib/rateLimit";
import { computeUnifiedRecs } from "../../../../lib/unifiedRecs";
import { isValidSwipeMediaFilter } from "../../../../lib/swipeMediaFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status = 200) {
  return NextResponse.json<{ ok: false; message: string }>({ ok: false, message }, { status });
}

export async function GET(req: Request) {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  const region = c.get("nw_region")?.value || "SE";
  const locale = c.get("nw_locale")?.value || "sv-SE";
  const reqUrl = new URL(req.url);
  // Gruppkod kan komma explicit via query (t.ex. gruppdäcket) eller från cookie.
  const groupCode = reqUrl.searchParams.get("group") || c.get("nw_group")?.value || null;

  if (!uid) return fail("Ingen användare inloggad.", 401);

  const key = getRateLimitKey(req, uid);
  if (!rateLimitAllow(key, "recs", { limit: RECS_LIMIT })) {
    return fail("För många förfrågningar. Försök igen senare.", 429);
  }

  const page = reqUrl.searchParams.get("page");
  const pageNum = Math.max(1, Number(page || "1"));
  const mediaParam = reqUrl.searchParams.get("media");
  const mediaFilter =
    !groupCode && isValidSwipeMediaFilter(mediaParam) ? mediaParam : undefined;

  const result = await computeUnifiedRecs({
    uid,
    region,
    locale,
    groupCode,
    page: pageNum,
    mediaFilter,
  });
  if (!result.ok) return fail(result.message, result.status);
  return NextResponse.json(result);
}
