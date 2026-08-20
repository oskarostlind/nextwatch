import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimitAllow, getRateLimitKey, RECS_LIMIT } from "../../../../lib/rateLimit";
import { computeUnifiedRecs } from "../../../../lib/unifiedRecs";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";
import { interleaveUpcoming, loadUpcomingForUser } from "@/lib/upcomingTitles";

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

  // "Kommer snart"-kort (lib/upcomingTitles.ts). Startas parallellt med
  // recs-pipelinen — den tar sekunder, det här ett TMDB-anrop — så inflätningen
  // i praktiken är gratis.
  //
  // ENDAST SOLO. Gruppleken (app/group/swipe/_legacy.tsx) har ingen gren för
  // kort som inte är riktiga titlar och skulle posta en gruppröst för kortet;
  // samma buggklass som annonskorten (se CLAUDE.md). Vakten är groupCode.
  const upcomingPromise = groupCode
    ? Promise.resolve([])
    : loadUpcomingForUser({ uid, region, locale, forceAllMedia });
  upcomingPromise.catch(() => {}); // vakt mot obehandlad rejection före await

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

  // items får bara växa när det redan finns riktiga titlar: klienten sätter
  // `hasMore = items.length > 0` (lib/swipeDeckStore.ts), och ett ensamt
  // "Kommer snart"-kort skulle då dölja att katalogen faktiskt är slut.
  const upcoming = await upcomingPromise.catch(() => []);
  const items = result.items.length > 0 ? interleaveUpcoming(result.items, upcoming) : result.items;

  return NextResponse.json({ ...result, items });
}
