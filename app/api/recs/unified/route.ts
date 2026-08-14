import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimitAllow, getRateLimitKey, RECS_LIMIT } from "../../../../lib/rateLimit";
import { computeUnifiedRecs } from "../../../../lib/unifiedRecs";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status = 200) {
  return NextResponse.json<{ ok: false; message: string }>({ ok: false, message }, { status });
}

export async function GET(req: Request) {
  const c = await cookies();
  const uid = c.get("nw_uid")?.value;
  const region = c.get("nw_region")?.value || "SE";
  // TMDB-språket följer användarens gränssnittsval (nw_lang), inte regionen.
  const locale = await tmdbLanguageFromCookies();
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
  // Markör från förra svarets nextTmdbPage. Vinner över `page`; se
  // UnifiedRecsParams.fromTmdbPage för varför sidnumret inte räcker längre.
  const fromRaw = Number(reqUrl.searchParams.get("from") || "0");
  const fromTmdbPage = Number.isFinite(fromRaw) && fromRaw > 0 ? Math.floor(fromRaw) : undefined;

  // Solo-däcket skickar ?all=1: hämta båda medietyperna oavsett profilens
  // filter, så film/serie-bytet blir en lokal filtrering utan omhämtning.
  // Grupp ignorerar flaggan (den har sitt eget filter).
  const forceAllMedia = reqUrl.searchParams.get("all") === "1";

  // Film/serie-filtret läses annars server-side: solo från
  // Profile.swipeMediaFilter, grupp från Group.mediaFilter.
  const result = await computeUnifiedRecs({
    uid,
    region,
    locale,
    groupCode,
    page: pageNum,
    fromTmdbPage,
    forceAllMedia,
  });
  if (!result.ok) return fail(result.message, result.status);
  return NextResponse.json(result);
}
