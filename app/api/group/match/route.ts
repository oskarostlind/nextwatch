// app/api/group/match/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { rateLimitAllow, getRateLimitKey, MATCH_LIMIT } from "@/lib/rateLimit";
import { groupMatchNeed } from "@/lib/groupSettings";
import { tmdbDetails, type TmdbType, type TmdbLite } from "@/lib/tmdbDetails";
import { providerGroupsFor, providerWatchUrl } from "@/lib/watchLinks";
import { tmdbLanguageFromCookies } from "@/lib/tmdbLanguage";

/**
 * TMDB-detaljerna innehåller rå watch-providers (flatrate/rent/buy) — matchrutan
 * ska bara visa tjänster vi kan direktlänka till (lib/watchLinks.ts), i samma
 * ordning och med samma hyr/köp-policy som resten av appen (Profile.showPaidOptions).
 */
function toProviderLinks(details: TmdbLite | null, showPaidOptions: boolean) {
  if (!details?.providers) return [] as { name: string; url: string }[];
  const groups = providerGroupsFor(details.providers, showPaidOptions);
  const out: { name: string; url: string }[] = [];
  for (const g of groups) {
    for (const p of g.list) {
      const url = providerWatchUrl(p.provider_name, details.title);
      if (url && !out.some((x) => x.name === p.provider_name)) {
        out.push({ name: p.provider_name, url });
      }
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const url = new URL(req.url);

    const code =
      url.searchParams.get("code") ??
      jar.get("nw_group")?.value ??
      url.searchParams.get("group") ??
      undefined;

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing group code.", size: 0, need: 0, count: 0, match: null, matches: [] },
        { status: 200 }
      );
    }

    const userId = jar.get("nw_uid")?.value ?? undefined;
    const key = getRateLimitKey(req, userId ?? null);
    if (!rateLimitAllow(key, "group-match", { limit: MATCH_LIMIT })) {
      return NextResponse.json(
        { ok: false, message: "För många förfrågningar.", size: 0, need: 0, count: 0, match: null, matches: [] },
        { status: 429 }
      );
    }
    const locale = await tmdbLanguageFromCookies();

    const [size, groupRow, profileRow] = await Promise.all([
      prisma.groupMember.count({ where: { groupCode: code } }),
      prisma.group.findUnique({ where: { code }, select: { matchThreshold: true } }),
      userId
        ? prisma.profile.findUnique({ where: { userId }, select: { showPaidOptions: true } })
        : Promise.resolve(null),
    ]);
    const need = groupMatchNeed(size, groupRow?.matchThreshold);
    const showPaidOptions = profileRow?.showPaidOptions ?? false;

    // En ensam kvarvarande medlem ska aldrig kunna "matcha" med sig själv.
    // Golvtröskeln är need = max(2, …), så två gamla LIKE-röster från medlemmar
    // som redan lämnat gruppen (leave städar dem numera, men äldre skräpdata kan
    // ligga kvar) räckte annars för en spökmatch direkt vid start. Den här
    // spärren är det robusta sista skyddet oavsett vilka röster som finns.
    if (size < 2) {
      return NextResponse.json(
        { ok: true, size, need, count: 0, match: null, matches: [] },
        { status: 200 }
      );
    }

    // Ranka kandidater på antal LIKE
    const [top, seenRows] = await Promise.all([
      prisma.groupVote.groupBy({
        by: ["tmdbId", "tmdbType"],
        where: { groupCode: code, vote: "LIKE" },
        _count: { _all: true },
        orderBy: { _count: { tmdbId: "desc" } },
        take: 20,
      }),
      userId
        ? prisma.groupMatchSeen.findMany({
            where: { groupCode: code, userId },
            select: { tmdbId: true, tmdbType: true },
          })
        : Promise.resolve([]),
    ]);

    const seenKeys = new Set(
      seenRows.map((s) => `${s.tmdbId}_${s.tmdbType}`)
    );

    // Kandidaten vi vill visa för denna användare (ej kvitterad)
    let chosen: { tmdbId: number; tmdbType: TmdbType; count: number } | null = null;
    let firstSeenAboveThreshold: { tmdbId: number; tmdbType: TmdbType; count: number } | null =
      null;

    for (const row of top) {
      const likeCount = row._count?._all ?? 0;
      if (likeCount < need) continue;

      const key = `${row.tmdbId}_${row.tmdbType}`;
      if (userId && seenKeys.has(key)) {
        if (!firstSeenAboveThreshold) {
          firstSeenAboveThreshold = {
            tmdbId: row.tmdbId,
            tmdbType: row.tmdbType as TmdbType,
            count: likeCount,
          };
        }
        continue;
      }

      chosen = {
        tmdbId: row.tmdbId,
        tmdbType: row.tmdbType as TmdbType,
        count: likeCount,
      };
      break;
    }

    if (!chosen) {
      // Ingen okvitterad kandidat – om första över tröskeln var "already seen" för användaren,
      // returnera count = dess verkliga likeCount (hjälper felsökning), men match:null.
      const count = firstSeenAboveThreshold?.count ?? 0;
      return NextResponse.json({ ok: true, size, need, count, match: null, matches: [] }, { status: 200 });
    }

    // Vilka medlemmar hade titeln sparad sedan innan? Sedan gruppleken tar med
    // titlar som EN medlem sparat (lib/unifiedRecs) är det ofta förklaringen
    // till varför matchen gick så fort. Under swipen märks ingenting ut — det
    // skulle styra röstningen och avslöja andras watchlists i onödan — men när
    // matchen väl är ett faktum är det en bättre berättelse än en anonym träff.
    const [details, savers] = await Promise.all([
      tmdbDetails(chosen.tmdbType, chosen.tmdbId, locale),
      prisma.watchlist.findMany({
        where: {
          tmdbId: chosen.tmdbId,
          mediaType: chosen.tmdbType,
          user: { groupMembers: { some: { groupCode: code } } },
        },
        select: { user: { select: { profile: { select: { displayName: true } } } } },
      }),
    ]);

    const savedBy = savers
      .map((s) => s.user.profile?.displayName?.trim())
      .filter((n): n is string => Boolean(n));

    const match = details
      ? { ...details, providers: toProviderLinks(details, showPaidOptions) }
      : { tmdbId: chosen.tmdbId, tmdbType: chosen.tmdbType, title: "" };

    return NextResponse.json(
      {
        ok: true,
        size,
        need,
        count: chosen.count,
        match,
        savedBy,
        matches: [],
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("match GET error:", e);
    return NextResponse.json(
      { ok: false, message: "Internal error.", size: 0, need: 0, count: 0, match: null, matches: [] },
      { status: 200 }
    );
  }
}
