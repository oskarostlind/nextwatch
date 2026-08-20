// lib/upcomingTitles.ts
//
// "Kommer snart"-kort i SOLO-swipen: ännu osläppta titlar (Nolans The Odyssey
// m.fl.) som vävs in i kortleken med premiärdatum. Gillar man ett sådant kort
// hamnar titeln i watchlisten OCH bevakas (ReleaseFollow) — cronen pushar när
// den faktiskt släppts.
//
// Varför en EGEN hämtning i stället för computeUnifiedRecs?
// Hela scoringen där förutsätter att publiken hunnit rösta: kvalitetsgolvet
// (≥50 röster och snitt < 5.8 → ut), den bayesianska kvalitetstermen och
// recency-bonusen. En titel med premiär om ett halvår har noll röster, så den
// hade antingen filtrerats bort eller lagt sig sist i leken. Kommande titlar är
// inte heller en rekommendation — de är en nyhet — och ska inte konkurrera med
// smakmodellen om platserna. Därför: separat pool, inflätad efteråt.
//
// ALDRIG i gruppleken. app/group/swipe/_legacy.tsx har ingen gren för kort som
// inte är riktiga titlar och skulle posta en gruppröst för kortet (samma buggklass
// som annonskorten, se CLAUDE.md). Vakten sitter i app/api/recs/unified/route.ts:
// upcoming hämtas bara när groupCode saknas.
//
// Token-konvention: tmdbGet i lib/tasteModel.ts (TMDB_V4_TOKEN med TMDB_API_KEY
// som fallback) — samma som resten av recs-pipelinen, se CLAUDE.md om att
// konventionerna skiljer sig mellan moduler.

import { prisma } from "@/lib/prisma";
import { tmdbGet, type MediaType } from "@/lib/tasteModel";
import { normalizeSwipeMediaFilter } from "@/lib/swipeMediaFilter";

export type UpcomingItem = {
  id: number;
  tmdbType: MediaType;
  title: string;
  year?: string;
  poster_path?: string | null;
  /** Alltid "upcoming" — klienten mappar det till SwipeCard.kind. */
  kind: "upcoming";
  /** Premiärdatum som ISO-sträng (YYYY-MM-DD). Aldrig tomt: se filtret nedan. */
  releaseDate: string;
};

type TMDBPaged<T> = { results: T[] };
type TMDBListItem = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
};

/**
 * Hur långt fram vi tittar. Längre horisont ger fler kort men allt tunnare
 * information — en film som har premiär om två år har ofta varken affisch,
 * beskrivning eller ett datum som håller.
 */
const HORIZON_MONTHS = 9;

/** Så många kandidater hämtas som mest per lek-hämtning (en TMDB-sida per typ). */
const POOL_MAX = 20;

/**
 * Vart N:te KORT i den färdiga leken blir ett "Kommer snart"-kort — ett kort
 * vävs in efter var N:e riktig titel, vilket i praktiken ger 1 av N+1.
 * 9 landar alltså på ungefär vart tionde kort.
 *
 * NW_UPCOMING_EVERY skruvar takten utan deploy; 0 stänger av funktionen helt
 * (kill switch). Osatt = 9.
 */
export const UPCOMING_EVERY: number = (() => {
  const raw = process.env.NW_UPCOMING_EVERY;
  if (raw == null || raw.trim() === "") return 9;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 9;
})();

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yearOf(iso: string): string | undefined {
  const y = iso.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : undefined;
}

/**
 * Rå TMDB-hämtning av kommande titlar. Provider-filtrering görs medvetet INTE:
 * osläppta titlar saknar nästan alltid watch-providers i regionen, så
 * with_watch_providers hade tömt hela poolen. Åldersgränsen (certification)
 * saknas av samma skäl — den sätts oftast först vid release.
 */
async function fetchUpcoming(opts: {
  region: string;
  locale: string;
  wantMovie: boolean;
  wantTv: boolean;
  showKidsContent: boolean;
}): Promise<UpcomingItem[]> {
  const { region, locale, wantMovie, wantTv, showKidsContent } = opts;

  const today = new Date();
  const horizon = new Date(today);
  horizon.setMonth(horizon.getMonth() + HORIZON_MONTHS);
  const gte = isoDay(today);
  const lte = isoDay(horizon);

  const empty = { results: [] as TMDBListItem[] };
  const [movies, tv] = await Promise.all([
    wantMovie
      ? tmdbGet<TMDBPaged<TMDBListItem>>(
          "/discover/movie",
          {
            language: locale,
            region,
            // primary_release_date = världspremiären. release_date.gte hade
            // krävt with_release_type och gett dubbletter per land.
            "primary_release_date.gte": gte,
            "primary_release_date.lte": lte,
            // Samma barn-/familjefilter som huvudflödet (lib/unifiedRecs.ts):
            // TMDB saknar ren Kids-genre för film, så Family (10751) är signalen.
            without_genres: showKidsContent ? undefined : "10751",
            sort_by: "popularity.desc",
            page: 1,
          },
          "force-cache",
        ).catch(() => empty)
      : Promise.resolve(empty),
    wantTv
      ? tmdbGet<TMDBPaged<TMDBListItem>>(
          "/discover/tv",
          {
            language: locale,
            region,
            "first_air_date.gte": gte,
            "first_air_date.lte": lte,
            without_genres: showKidsContent ? undefined : "10762,10751",
            sort_by: "popularity.desc",
            page: 1,
          },
          "force-cache",
        ).catch(() => empty)
      : Promise.resolve(empty),
  ]);

  const out: UpcomingItem[] = [];
  const push = (r: TMDBListItem, tmdbType: MediaType) => {
    const date = (tmdbType === "movie" ? r.release_date : r.first_air_date) ?? "";
    // Utan datum finns ingen premiär att visa och inget att bevaka — och utan
    // affisch renderar kortet som en grå ruta. Båda kraven är hårda.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= gte) return;
    if (!r.poster_path) return;
    const title = (r.title || r.name || "").trim();
    if (!title) return;
    out.push({
      id: r.id,
      tmdbType,
      title,
      year: yearOf(date),
      poster_path: r.poster_path,
      kind: "upcoming",
      releaseDate: date,
    });
  };
  for (const r of movies.results) push(r, "movie");
  for (const r of tv.results) push(r, "tv");

  // Närmast premiär först: "kommer om tre veckor" är en nyhet, "kommer nästa
  // sommar" är brus.
  out.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return out.slice(0, POOL_MAX);
}

/**
 * Kommande titlar för en användare, redan rensade från sådant hen redan swipat
 * eller sparat. Kastar aldrig — misslyckas hämtningen får leken helt enkelt
 * inga "Kommer snart"-kort den här gången, och det får aldrig fälla swipen.
 */
export async function loadUpcomingForUser(opts: {
  uid: string;
  region: string;
  locale: string;
  /** Solo-däcket hämtar alltid båda medietyperna (?all=1) och filtrerar lokalt. */
  forceAllMedia: boolean;
}): Promise<UpcomingItem[]> {
  const { uid, region, locale, forceAllMedia } = opts;
  if (UPCOMING_EVERY <= 0) return [];

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: uid },
      select: { showKidsContent: true, swipeMediaFilter: true },
    });
    const filter = forceAllMedia ? "both" : normalizeSwipeMediaFilter(profile?.swipeMediaFilter);
    const raw = await fetchUpcoming({
      region,
      locale,
      wantMovie: filter !== "tv",
      wantTv: filter !== "movie",
      showKidsContent: profile?.showKidsContent === true,
    });
    if (raw.length === 0) return [];

    // Redan swipad eller sparad? Då är den inte längre en nyhet för den här
    // användaren. Uppslaget är bundet till kandidaternas id:n (≤ POOL_MAX rader),
    // så det kostar inget att göra det per hämtning.
    const ids = raw.map((r) => r.id);
    const [rated, saved] = await Promise.all([
      prisma.rating.findMany({
        where: { userId: uid, tmdbId: { in: ids } },
        select: { tmdbId: true, mediaType: true },
      }),
      prisma.watchlist.findMany({
        where: { userId: uid, tmdbId: { in: ids } },
        select: { tmdbId: true, mediaType: true },
      }),
    ]);
    const excluded = new Set<string>();
    for (const r of [...rated, ...saved]) excluded.add(`${r.mediaType}_${r.tmdbId}`);

    return raw.filter((r) => !excluded.has(`${r.tmdbType}_${r.id}`));
  } catch (e) {
    console.warn("[upcoming] kunde inte hämta kommande titlar:", e instanceof Error ? e.message : e);
    return [];
  }
}

/* ---------------- Bevakningar (ReleaseFollow) ---------------- */

/** Hur många bevakningar som slås upp mot TMDB per cron-körning. */
const REFRESH_BATCH = 100;
/** En bevakning kollas om tidigast så här länge efter att den skapades. */
const REFRESH_MIN_AGE_DAYS = 7;

type TmdbDatesOnly = { release_date?: string | null; first_air_date?: string | null };

/**
 * Uppdaterar premiärdatum på aktiva bevakningar mot TMDB.
 *
 * Behövs för att svepet i app/api/cron/daily-recs över huvud taget ska kunna
 * fyra av: gillar man en titel som står som TBA sparas releaseDate = null, och
 * en null-rad blir aldrig "har passerat". Datum flyttas dessutom hela tiden för
 * osläppta titlar. Bundet med `take` (TMDB:s takgräns, inte Postgres, är
 * flaskhalsen) och roterat via checkedAt så samma 100 rader inte hämtas om
 * varje körning — samma rättvisemönster som User.lastDailyRecAt.
 *
 * Returnerar antalet rader som fick ett nytt datum.
 */
export async function refreshPendingReleaseDates(limit = REFRESH_BATCH): Promise<number> {
  const now = new Date();
  const minAge = new Date(now.getTime() - REFRESH_MIN_AGE_DAYS * 86_400_000);

  const rows = await prisma.releaseFollow.findMany({
    where: {
      notifiedAt: null,
      createdAt: { lte: minAge },
      OR: [{ releaseDate: null }, { releaseDate: { gt: now } }],
    },
    select: { id: true, tmdbId: true, mediaType: true, releaseDate: true },
    orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  if (rows.length === 0) return 0;

  let updated = 0;
  await Promise.all(
    rows.map(async (row) => {
      const path = row.mediaType === "movie" ? `/movie/${row.tmdbId}` : `/tv/${row.tmdbId}`;
      const d = await tmdbGet<TmdbDatesOnly>(path, {}, "no-store").catch(() => null);
      const iso = (row.mediaType === "movie" ? d?.release_date : d?.first_air_date) ?? "";
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso) : null;
      const fresh = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
      const changed = fresh?.getTime() !== row.releaseDate?.getTime();
      await prisma.releaseFollow
        .update({
          where: { id: row.id },
          // checkedAt stämplas ÄVEN när TMDB inte gav något datum — annars
          // fastnar en evig TBA-rad först i kön och blockerar alla andra.
          data: { checkedAt: new Date(), ...(changed && fresh ? { releaseDate: fresh } : {}) },
        })
        .catch(() => {
          /* best-effort */
        });
      if (changed && fresh) updated++;
    }),
  );
  return updated;
}

/**
 * Väver in "Kommer snart"-korten efter var UPCOMING_EVERY:e riktiga titel.
 * Aldrig sist i listan (samma regel som annonskorten i lib/ads.ts) — leken ska
 * inte sluta på ett kort man inte kan titta på.
 */
export function interleaveUpcoming<T>(items: T[], upcoming: UpcomingItem[]): (T | UpcomingItem)[] {
  if (UPCOMING_EVERY <= 0 || items.length === 0 || upcoming.length === 0) return items;
  const out: (T | UpcomingItem)[] = [];
  let next = 0;
  for (let i = 0; i < items.length; i++) {
    out.push(items[i]);
    if ((i + 1) % UPCOMING_EVERY === 0 && i + 1 < items.length && next < upcoming.length) {
      out.push(upcoming[next++]);
    }
  }
  return out;
}
