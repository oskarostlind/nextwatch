'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Star } from 'lucide-react';
import Modal from '@/app/components/ui/Modal';
import WatchNowButton from '@/app/components/watch/WatchNowButton';
import RatingModal from '@/app/components/client/RatingModal';
import ImdbImportModal from '@/app/components/client/ImdbImportModal';
import ShareTitleModal, { type ShareItem } from '@/app/components/client/ShareTitleModal';
import SharedTipsInbox from '@/app/components/client/SharedTipsInbox';
import MediaFilters, { type MediaTypeFilter } from '@/app/components/discover/MediaFilters';
import { Button } from '@/app/components/ui/kit';
import {
  bestWatchUrl,
  isPaidOnly,
  providerGroupsFor,
  providerWatchUrl,
  PAID_ONLY_LABEL,
  type WatchProviders as Providers,
} from '@/lib/watchLinks';
import { useSwipeSettings } from '@/app/components/client/SwipeSettingsProvider';
import { PosterGridSkeleton } from '@/app/components/ui/Skeletons';
import { getCached, setCached } from '@/lib/clientCache';
import { markTitleRated } from '@/lib/swipeDeckStore';
import { putTitles, readTitleCache, titleKey, type CachedTitle } from '@/lib/titleCache';
import CoachMarkTour from '@/app/components/client/tours/CoachMarkTour';
import { WATCHLIST_TOUR_STEPS } from '@/lib/tours/coachSteps';

type WatchItem = {
  id: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  year?: string;
  rating?: number;
  posterUrl: string;
  addedAt?: string;
  voteAverage?: number | null;
  popularity?: number | null;
  genreIds?: number[];
};

// Titlar med eget betyg (Betyg-fliken) — från POST /api/ratings/list.
type RatedItem = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string | null;
  poster: string | null;
  genreIds: number[];
  userRating: number;
};

type RatedListResp = { ok: boolean; items: RatedItem[] };

type Tab = 'watchlist' | 'ratings';

type ProvidersResp = { ok: boolean; region?: string; providers: Providers | null };

type Detail = { overview?: string };

type WatchlistApiItem = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string | null;
  poster: string | null;
  rating?: number | null;
  addedAt?: string;
  voteAverage?: number | null;
  popularity?: number | null;
  genreIds?: number[];
};

const PLACEHOLDER_POSTER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

// Listorna är användarens egen data och ändras sällan mellan appstarter, så de
// ritas ur cache direkt och ersätts tyst när det färska svaret kommer. Utan det
// mötte varje besök ett skelett medan servern satte ihop listan på nytt.
// Cachen skrivs vid varje lyckad hämtning, så den självläker efter mutationer
// (gilla i swipe, betygsätt, ta bort) utan separat invalidering.
const WL_CACHE_KEY = 'watchlist_items';
const RATED_CACHE_KEY = 'rated_items';
const LIST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Routerna tar max 200 id per anrop. Vid kall cache och en lång lista måste
 * saknade titlar därför delas upp — annars kapas resten och visas som
 * platshållare. (Verifierat i produktion: 222 titlar gav 22 utan metadata när
 * berikningen kapades i stället för att delas upp.)
 */
const ENRICH_CHUNK = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Betyg-flikens kort öppnar samma detaljmodal som watchlisten — inte bara betyget. */
function ratedToWatchItem(it: RatedItem): WatchItem {
  return {
    id: it.tmdbId,
    tmdbType: it.mediaType,
    title: it.title,
    year: it.year ?? undefined,
    posterUrl: it.poster ?? PLACEHOLDER_POSTER,
  };
}

/** DB-rad utan TMDB-berikning, från `?meta=0`. */
type WatchlistRowApi = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  addedAt: string;
};

/** Motsvarande för betyg. */
type RatedRowApi = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  userRating: number;
};

function toCachedTitle(raw: WatchlistApiItem): CachedTitle {
  return {
    title: raw.title,
    year: raw.year,
    poster: raw.poster,
    voteAverage: raw.voteAverage ?? null,
    popularity: raw.popularity ?? null,
    genreIds: raw.genreIds ?? [],
  };
}

/**
 * Slår ihop en DB-rad med cachad metadata. Saknas metadatan visas titeln ändå,
 * med platshållare — raden är sanningen om vad som ligger i listan, cachen är
 * bara utsmyckning.
 */
function rowToWatchItem(row: WatchlistRowApi, meta: CachedTitle | undefined): WatchItem {
  return {
    id: row.tmdbId,
    tmdbType: row.mediaType,
    title: meta?.title ?? '…',
    year: meta?.year ?? undefined,
    rating: meta?.voteAverage ?? undefined,
    posterUrl: meta?.poster ?? PLACEHOLDER_POSTER,
    addedAt: row.addedAt,
    voteAverage: meta?.voteAverage ?? null,
    popularity: meta?.popularity ?? null,
    genreIds: meta?.genreIds ?? [],
  };
}

async function fetchProviders(id: number, tmdbType: 'movie' | 'tv'): Promise<ProvidersResp> {
  const res = await fetch(`/api/tmdb/watch-providers?id=${id}&type=${tmdbType}`, { cache: 'no-store' });
  return (await res.json()) as ProvidersResp;
}

async function fetchDetail(id: number, tmdbType: 'movie' | 'tv'): Promise<Detail> {
  const res = await fetch(`/api/watchlist/detail?id=${id}&type=${tmdbType}`, { cache: 'no-store' });
  if (!res.ok) return {};
  return (await res.json()) as Detail;
}

export default function WatchlistClient({ items: initial }: { items?: WatchItem[] }) {
  const { showPaidOptions } = useSwipeSettings();
  const [items, setItems] = useState<WatchItem[]>(initial ?? []);
  // Klient-hämtad lista (sidan server-renderar inte längre datan): sant tills
  // första svaret, så tomt-läget inte ljuger under laddning.
  const [wlLoading, setWlLoading] = useState(initial === undefined);
  const [active, setActive] = useState<WatchItem | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [detail, setDetail] = useState<Detail>({});
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  // Betyg-fliken: lazy-hämtas första gången fliken öppnas.
  const [tab, setTab] = useState<Tab>('watchlist');
  const [rated, setRated] = useState<RatedItem[] | null>(null); // null = inte hämtad än
  const [ratedLoading, setRatedLoading] = useState(false);
  const [editing, setEditing] = useState<RatedItem | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [wlType, setWlType] = useState<MediaTypeFilter>('movie');
  const [wlSort, setWlSort] = useState('addedAt');
  const [wlGenres, setWlGenres] = useState<string[]>([]);
  const [ratedType, setRatedType] = useState<MediaTypeFilter>('movie');
  const [ratedSort, setRatedSort] = useState('userRating');
  const [ratedGenres, setRatedGenres] = useState<string[]>([]);

  const [imdbOpen, setImdbOpen] = useState(false);
  const [shareItem, setShareItem] = useState<ShareItem | null>(null);
  const [rateFromWl, setRateFromWl] = useState<WatchItem | null>(null);
  const [rateWlSaving, setRateWlSaving] = useState(false);

  const refetchWatchlist = useCallback(() => {
    void (async () => {
      try {
        // Steg 1: bara raderna. En Prisma-fråga server-side i stället för ett
        // TMDB-uppslag per titel.
        const rowsRes = await fetch('/api/watchlist/list?meta=0', { method: 'POST', cache: 'no-store' });
        if (!rowsRes.ok) return;
        const rowsData = (await rowsRes.json()) as { ok?: boolean; rows?: WatchlistRowApi[] };
        if (!rowsData.ok || !Array.isArray(rowsData.rows)) return;
        const rows = rowsData.rows;

        // Steg 2: fyll i metadata från cachen, hämta bara det som saknas.
        const cache = readTitleCache();
        const missing = rows
          .map((r) => titleKey(r.mediaType, r.tmdbId))
          .filter((k) => !cache[k]);

        if (missing.length > 0) {
          const add: Record<string, CachedTitle> = {};
          // Klumpvis: en lista längre än ENRICH_CHUNK skulle annars kapas och
          // resten fastna som platshållare.
          await Promise.all(
            chunk(missing, ENRICH_CHUNK).map(async (del) => {
              const enrichRes = await fetch(
                `/api/watchlist/list?ids=${encodeURIComponent(del.join(','))}`,
                { method: 'POST', cache: 'no-store' },
              );
              if (!enrichRes.ok) return;
              const enriched = (await enrichRes.json()) as { ok?: boolean; items?: WatchlistApiItem[] };
              if (!enriched.ok || !Array.isArray(enriched.items)) return;
              for (const it of enriched.items) {
                const meta = toCachedTitle(it);
                add[titleKey(it.mediaType, it.tmdbId)] = meta;
                cache[titleKey(it.mediaType, it.tmdbId)] = meta;
              }
            }),
          );
          putTitles(add);
        }

        // Raderna bestämmer vilka titlar som finns; cachen dekorerar bara. En
        // titel utan metadata visas hellre med platshållare än utelämnas.
        const mapped = rows.map((r) => rowToWatchItem(r, cache[titleKey(r.mediaType, r.tmdbId)]));
        setItems(mapped);
        setCached(WL_CACHE_KEY, mapped, LIST_TTL_MS);
      } catch {
        /* best-effort — ev. cachad lista står kvar */
      } finally {
        setWlLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (initial !== undefined) return;
    // Cachen läses efter mount, inte under render: servern har inget
    // localStorage, så en läsning i render hade gett hydration-mismatch.
    // Kostar en bildruta skelett — men tar bort de sekunder som annars gick åt
    // till nätverket plus serverns hopsättning av listan.
    const cached = getCached<WatchItem[]>(WL_CACHE_KEY);
    if (cached && cached.length > 0) {
      setItems(cached);
      setWlLoading(false);
    }
    // Hämtar alltid färskt ändå: cachen är till för att slippa väntan, inte
    // för att slippa hämta.
    refetchWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetchRated = useCallback(() => {
    setRatedLoading(true);
    void (async () => {
      try {
        // Samma tvåstegsupplägg som watchlisten: rader först, metadata ur cachen.
        const rowsRes = await fetch('/api/ratings/list?meta=0', { method: 'POST', cache: 'no-store' });
        if (!rowsRes.ok) { setRated((prev) => prev ?? []); return; }
        const rowsData = (await rowsRes.json()) as { ok?: boolean; rows?: RatedRowApi[] };
        if (!rowsData.ok || !Array.isArray(rowsData.rows)) { setRated((prev) => prev ?? []); return; }
        const rows = rowsData.rows;

        const cache = readTitleCache();
        const missing = rows
          .map((r) => titleKey(r.mediaType, r.tmdbId))
          .filter((k) => !cache[k]);

        if (missing.length > 0) {
          const add: Record<string, CachedTitle> = {};
          await Promise.all(
            chunk(missing, ENRICH_CHUNK).map(async (del) => {
              const enrichRes = await fetch(
                `/api/ratings/list?ids=${encodeURIComponent(del.join(','))}`,
                { method: 'POST', cache: 'no-store' },
              );
              if (!enrichRes.ok) return;
              const enriched = (await enrichRes.json()) as RatedListResp;
              if (!enriched.ok || !Array.isArray(enriched.items)) return;
              for (const it of enriched.items) {
                const meta: CachedTitle = {
                  title: it.title,
                  year: it.year,
                  poster: it.poster,
                  // Betygsrouten returnerar inte betyg/popularitet; watchlisten
                  // fyller på dem för samma titel när den passerar. Genrer ger
                  // den däremot nu, för genrefiltret på Betyg-fliken.
                  voteAverage: null,
                  popularity: null,
                  genreIds: it.genreIds ?? [],
                };
                add[titleKey(it.mediaType, it.tmdbId)] = meta;
                cache[titleKey(it.mediaType, it.tmdbId)] = meta;
              }
            }),
          );
          putTitles(add);
        }

        const mapped: RatedItem[] = rows.map((r) => {
          const meta = cache[titleKey(r.mediaType, r.tmdbId)];
          return {
            tmdbId: r.tmdbId,
            mediaType: r.mediaType,
            title: meta?.title ?? '…',
            year: meta?.year ?? null,
            poster: meta?.poster ?? null,
            genreIds: meta?.genreIds ?? [],
            userRating: r.userRating,
          };
        });
        setRated(mapped);
        setCached(RATED_CACHE_KEY, mapped, LIST_TTL_MS);
      } catch {
        setRated((prev) => prev ?? []);
      } finally {
        setRatedLoading(false);
      }
    })();
  }, []);

  // Betyg hämtas första gången fliken öppnas — och även vid cache-träff, så
  // listan revalideras. Tidigare låg en identisk kopia av hämtningen här.
  const ratedFetchedRef = useRef(false);
  // Sentinel högst upp — scrollIntoView scrollar den container som faktiskt
  // scrollar (sidans main), så ett flikbyte tar dig till toppen av den nya
  // listan i stället för att lämna dig kvar där du stod i den förra.
  const topRef = useRef<HTMLDivElement>(null);
  const openTab = useCallback(
    (next: Tab) => {
      setTab(next);
      topRef.current?.scrollIntoView({ block: "start" });
      if (next === 'ratings' && !ratedFetchedRef.current && !ratedLoading) {
        ratedFetchedRef.current = true;
        // Visa cachat direkt så fliken inte står tom medan hämtningen pågår.
        const cached = getCached<RatedItem[]>(RATED_CACHE_KEY);
        if (cached && cached.length > 0) setRated(cached);
        refetchRated();
      }
    },
    [ratedLoading, refetchRated]
  );

  const saveEditedRating = useCallback(
    (rating: number) => {
      const it = editing;
      if (!it) return;
      setEditSaving(true);
      // Betygsatt titel ska aldrig tillbaka i swipen — ta bort ur den ev. cachade
      // leken direkt (servern exkluderar den vid nästa hämtning).
      markTitleRated(it.tmdbId, it.mediaType);
      void fetch('/api/ratings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ tmdbId: it.tmdbId, mediaType: it.mediaType, rating }),
      })
        .then((res) => {
          if (res.ok) {
            setRated((cur) =>
              (cur ?? []).map((x) =>
                x.tmdbId === it.tmdbId && x.mediaType === it.mediaType ? { ...x, userRating: rating } : x
              )
            );
          }
        })
        .catch(() => {
          /* best-effort */
        })
        .finally(() => {
          setEditSaving(false);
          setEditing(null);
        });
    },
    [editing]
  );

  const removeRating = useCallback(() => {
    const it = editing;
    if (!it) return;
    // Optimistisk borttagning
    setRated((cur) => (cur ?? []).filter((x) => !(x.tmdbId === it.tmdbId && x.mediaType === it.mediaType)));
    setEditing(null);
    void fetch('/api/ratings/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ tmdbId: it.tmdbId, mediaType: it.mediaType }),
    }).catch(() => {
      // Rollback om API faller
      setRated((cur) => [it, ...(cur ?? [])]);
    });
  }, [editing]);

  const filtered = useMemo(() => {
    let list = items.filter((it) => it.tmdbType === wlType);
    if (wlGenres.length > 0) {
      list = list.filter((it) =>
        (it.genreIds ?? []).some((gid) => wlGenres.includes(String(gid)))
      );
    }
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((it) => it.title.toLowerCase().includes(needle));

    const sorted = [...list];
    if (wlSort === 'popularity') {
      sorted.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    } else if (wlSort === 'voteAverage') {
      sorted.sort((a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0));
    } else if (wlSort === 'year') {
      sorted.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
    } else {
      sorted.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
    }
    return sorted;
  }, [q, items, wlType, wlSort, wlGenres]);

  const filteredRated = useMemo(() => {
    let list = (rated ?? []).filter((it) => it.mediaType === ratedType);
    if (ratedGenres.length > 0) {
      list = list.filter((it) =>
        (it.genreIds ?? []).some((gid) => ratedGenres.includes(String(gid)))
      );
    }
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((it) => it.title.toLowerCase().includes(needle));

    const sorted = [...list];
    if (ratedSort === 'year') {
      sorted.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
    } else if (ratedSort === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'sv'));
    } else {
      // Standard: högst eget betyg först. Servern levererar redan i
      // senast-betygsatt-ordning, så det är den naturliga fallbacken.
      sorted.sort((a, b) => b.userRating - a.userRating);
    }
    return sorted;
  }, [q, rated, ratedType, ratedSort, ratedGenres]);

  const userRatingFor = useCallback(
    (tmdbId: number, mediaType: 'movie' | 'tv') =>
      rated?.find((r) => r.tmdbId === tmdbId && r.mediaType === mediaType)?.userRating,
    [rated]
  );

  function saveWatchlistRating(rating: number) {
    const it = rateFromWl;
    if (!it) return;
    setRateWlSaving(true);
    markTitleRated(it.id, it.tmdbType);
    void fetch('/api/ratings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ tmdbId: it.id, mediaType: it.tmdbType, rating }),
    })
      .then((res) => {
        if (res.ok) {
          setRated((cur) => {
            const prev = cur ?? [];
            const idx = prev.findIndex((x) => x.tmdbId === it.id && x.mediaType === it.tmdbType);
            const next: RatedItem = {
              tmdbId: it.id,
              mediaType: it.tmdbType,
              title: it.title,
              year: it.year ?? null,
              poster: it.posterUrl.startsWith('data:') ? null : it.posterUrl,
              genreIds: it.genreIds ?? [],
              userRating: rating,
            };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], userRating: rating };
              return copy;
            }
            return [next, ...prev];
          });
          // Betyg = sedd → servern tar bort watchlist-raden; spegla direkt i UI:t.
          setItems((cur) => cur.filter((x) => !(x.id === it.id && x.tmdbType === it.tmdbType)));
        }
      })
      .finally(() => {
        setRateWlSaving(false);
        setRateFromWl(null);
      });
  }

  const open = useCallback(async (item: WatchItem) => {
    setActive(item);
    setLoading(true);
    try {
      const [p, d] = await Promise.all([fetchProviders(item.id, item.tmdbType), fetchDetail(item.id, item.tmdbType)]);
      setProviders(p.ok ? p.providers : null);
      setDetail(d);
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (item: WatchItem) => {
    // Optimistisk uppdatering
    setItems((cur) => cur.filter((x) => !(x.id === item.id && x.tmdbType === item.tmdbType)));
    const res = await fetch('/api/watchlist/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdbId: item.id, mediaType: item.tmdbType }),
    });
    if (!res.ok) {
      // Rollback om API faller
      setItems((cur) => [...cur, item].sort((a, b) => a.title.localeCompare(b.title)));
    }
  }, []);

  const close = useCallback(() => {
    setActive(null);
    setProviders(null);
    setDetail({});
  }, []);

  const providerGroups = useMemo(
    () => providerGroupsFor(providers, showPaidOptions),
    [providers, showPaidOptions]
  );

  const paidOnly = useMemo(() => isPaidOnly(providers, showPaidOptions), [providers, showPaidOptions]);

  // "Kolla nu" ska öppna streamingtjänsten direkt (universal link → appen på mobil),
  // inte TMDB:s watch-sida. TMDB-länken är bara sista fallback.
  const watchUrl = useMemo(() => {
    if (!active) return undefined;
    return bestWatchUrl(providers, active.title, showPaidOptions);
  }, [providers, active, showPaidOptions]);

  return (
    <>
      <div ref={topRef} />
      {/* Filmtips från vänner — visas bara när det finns några. */}
      <SharedTipsInbox onAdded={refetchWatchlist} />

      <div className="mb-4 flex rounded-xl border border-white/10 bg-black/40 p-1" data-tour="watchlist-tabs">
        {(
          [
            { key: 'watchlist' as Tab, label: 'Watchlist' },
            { key: 'ratings' as Tab, label: 'Betyg' },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => openTab(t.key)}
            aria-pressed={tab === t.key}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              tab === t.key ? 'bg-white text-neutral-900' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(tab === 'watchlist' || tab === 'ratings') && (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" onClick={() => setImdbOpen(true)}>
            Importera från IMDb
          </Button>
        </div>
      )}

      {tab === 'watchlist' ? (
        <MediaFilters
          type={wlType}
          onTypeChange={(t) => {
            setWlType(t);
            setWlGenres([]);
          }}
          sort={wlSort}
          onSortChange={setWlSort}
          genres={wlGenres}
          onToggleGenre={(id) =>
            setWlGenres((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          mode="watchlist"
          layoutId="watchlist-type"
        />
      ) : (
        <MediaFilters
          type={ratedType}
          onTypeChange={(t) => {
            setRatedType(t);
            setRatedGenres([]);
          }}
          sort={ratedSort}
          onSortChange={setRatedSort}
          genres={ratedGenres}
          onToggleGenre={(id) =>
            setRatedGenres((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          mode="rated"
          layoutId="ratings-type"
        />
      )}

      <div className="mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök titel…"
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
        />
      </div>

      {tab === 'ratings' ? (
        ratedLoading ? (
          <p className="text-neutral-400">Laddar dina betyg…</p>
        ) : filteredRated.length === 0 ? (
          <p className="text-neutral-400">
            {rated && rated.length > 0 ? 'Inga träffar.' : 'Inga betyg än. Swipa upp på titlar du sett för att betygsätta dem.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {filteredRated.map((it) => (
              <button
                key={`${it.mediaType}-${it.tmdbId}`}
                type="button"
                onClick={() => void open(ratedToWatchItem(it))}
                className="group relative block overflow-hidden rounded-xl border border-white/10 text-left transition hover:ring-2 hover:ring-cyan-500/60"
              >
                {it.poster ? (
                  <Image
                    src={it.poster}
                    alt={it.title}
                    width={342}
                    height={513}
                    className="h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                    {it.title}
                  </div>
                )}
                <div className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/70 px-2 py-1 text-[11px] font-bold text-emerald-300 backdrop-blur">
                  {it.userRating}/10
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 text-[12px]">
                  <div className="truncate font-medium text-white">{it.title}</div>
                  <div className="flex items-center justify-between opacity-90">
                    <span>{it.year ?? '—'}</span>
                    <span>Ditt betyg: {it.userRating}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )
      ) : wlLoading ? (
        <PosterGridSkeleton />
      ) : filtered.length === 0 ? (
        <p className="text-neutral-400">
          {items.length === 0
            ? 'Din watchlist är tom. Swipa höger på titlar du vill se, så hamnar de här.'
            : items.some((it) => it.tmdbType === wlType)
            ? 'Inga träffar.'
            : wlType === 'movie'
            ? 'Inga filmer i listan — men du har serier. Byt till Serier ovanför.'
            : 'Inga serier i listan — men du har filmer. Byt till Film ovanför.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-tour="watchlist-grid">
          {filtered.map((it) => (
            <div
              key={`${it.tmdbType}-${it.id}`}
              className="group relative overflow-hidden rounded-xl border border-white/10 transition hover:ring-2 hover:ring-cyan-500/60"
            >
              <button
                type="button"
                aria-label="Tipsa en vän"
                onClick={() =>
                  setShareItem({
                    tmdbId: it.id,
                    mediaType: it.tmdbType,
                    title: it.title,
                    year: it.year ?? null,
                    poster: it.posterUrl.startsWith('data:') ? null : it.posterUrl,
                  })
                }
                className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/60 p-2 text-neutral-300 backdrop-blur transition hover:bg-cyan-500 hover:text-black"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Ta bort från watchlist"
                onClick={() => remove(it)}
                className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 p-2 text-neutral-300 backdrop-blur transition hover:bg-rose-600 hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 6h18M9 6v-.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V6m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M10 10v6M14 10v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>

              <button type="button" onClick={() => open(it)} className="relative block w-full text-left">
                <Image
                  src={it.posterUrl}
                  alt={it.title}
                  width={342}
                  height={513}
                  className="h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 text-[12px]">
                  <div className="truncate font-medium text-white">{it.title}</div>
                  <div className="flex items-center justify-between opacity-90">
                    <span>{it.year ?? '—'}</span>
                    {typeof it.rating === 'number' && <span>★ {it.rating.toFixed(1)}</span>}
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={Boolean(active)} onClose={close} labelledBy="watchlist-modal-title">
        {active && (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative mx-auto h-[320px] w-[220px] shrink-0 overflow-hidden rounded-2xl md:mx-0">
              <Image src={active.posterUrl} alt={active.title} fill sizes="220px" className="object-cover" />
            </div>

            <div className="min-w-0 flex-1">
              <h2 id="watchlist-modal-title" className="text-xl font-bold text-white">
                {active.title}{active.year ? ` (${active.year})` : ''}
              </h2>
              <p className="mt-1 text-sm text-neutral-300">
                {[
                  typeof active.rating === 'number' ? `Betyg: ${active.rating.toFixed(1)}` : null,
                  typeof userRatingFor(active.id, active.tmdbType) === 'number'
                    ? `Ditt betyg: ${userRatingFor(active.id, active.tmdbType)}/10`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Betyg saknas'}
              </p>

              <p className="mt-3 text-sm leading-relaxed text-neutral-200">
                {loading ? 'Laddar info…' : (detail.overview || 'Ingen beskrivning tillgänglig.')}
              </p>

              <div className="mt-4 space-y-3">
                {providerGroups.length === 0 && !loading && (
                  <p className="text-sm text-neutral-400">
                    {paidOnly ? PAID_ONLY_LABEL : 'Ingen tillgänglig streamingdata för din region just nu.'}
                  </p>
                )}
                {providerGroups.map(({ label, list }) => (
                  <div key={label}>
                    <p className="mb-2 text-xs uppercase tracking-widest text-cyan-400/80">{label}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {list.map((p) => {
                        const href = providerWatchUrl(p.provider_name, active.title);
                        const inner = (
                          <>
                            {p.logo_path && (
                              <span className="relative inline-block h-5 w-5 overflow-hidden rounded">
                                <Image
                                  src={`https://image.tmdb.org/t/p/w92${p.logo_path}`}
                                  alt={p.provider_name}
                                  fill
                                  sizes="20px"
                                  className="object-contain"
                                />
                              </span>
                            )}
                            {p.provider_name}
                          </>
                        );
                        const cls =
                          'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-neutral-200';
                        return href ? (
                          <a
                            key={p.provider_name}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${cls} transition hover:border-cyan-400/40 hover:bg-cyan-400/10`}
                            title={`Öppna ${p.provider_name}`}
                          >
                            {inner}
                          </a>
                        ) : (
                          <span key={p.provider_name} className={cls} title={p.provider_name}>
                            {inner}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <WatchNowButton url={watchUrl} />
                <button
                  type="button"
                  onClick={() => {
                    const it = active;
                    close();
                    setShareItem({
                      tmdbId: it.id,
                      mediaType: it.tmdbType,
                      title: it.title,
                      year: it.year ?? null,
                      poster: it.posterUrl.startsWith('data:') ? null : it.posterUrl,
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                >
                  Tipsa en vän
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Har titeln redan ett betyg öppnas ändra-flödet (med "Ta bort
                    // betyg"), annars nybetygsättning.
                    const current = userRatingFor(active.id, active.tmdbType);
                    close();
                    if (typeof current === 'number') {
                      setEditing({
                        tmdbId: active.id,
                        mediaType: active.tmdbType,
                        title: active.title,
                        year: active.year ?? null,
                        poster: active.posterUrl.startsWith('data:') ? null : active.posterUrl,
                        genreIds: active.genreIds ?? [],
                        userRating: current,
                      });
                    } else {
                      setRateFromWl(active);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20"
                >
                  <Star className="h-4 w-4" />
                  Betygsätt
                  {typeof userRatingFor(active.id, active.tmdbType) === 'number'
                    ? ` (${userRatingFor(active.id, active.tmdbType)}/10)`
                    : ''}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <RatingModal
        open={editing !== null}
        item={
          editing
            ? {
                tmdbId: editing.tmdbId,
                mediaType: editing.mediaType,
                title: editing.title,
                year: editing.year,
                poster: editing.poster,
              }
            : null
        }
        heading="Ändra ditt betyg"
        skipLabel="Avbryt"
        saving={editSaving}
        initialRating={editing?.userRating}
        onRate={saveEditedRating}
        onSkip={() => setEditing(null)}
        onRemove={removeRating}
      />

      <RatingModal
        open={rateFromWl !== null}
        item={
          rateFromWl
            ? {
                tmdbId: rateFromWl.id,
                mediaType: rateFromWl.tmdbType,
                title: rateFromWl.title,
                year: rateFromWl.year,
                poster: rateFromWl.posterUrl.startsWith('data:') ? null : rateFromWl.posterUrl,
              }
            : null
        }
        heading="Vad tyckte du?"
        skipLabel="Avbryt"
        saving={rateWlSaving}
        initialRating={
          rateFromWl ? userRatingFor(rateFromWl.id, rateFromWl.tmdbType) : undefined
        }
        onRate={saveWatchlistRating}
        onSkip={() => setRateFromWl(null)}
      />

      <ShareTitleModal open={shareItem !== null} item={shareItem} onClose={() => setShareItem(null)} />

      <ImdbImportModal
        open={imdbOpen}
        onClose={() => setImdbOpen(false)}
        onDone={() => {
          refetchWatchlist();
          setRated(null);
          if (tab === 'ratings') refetchRated();
        }}
      />

      <CoachMarkTour tourId="watchlist-tour" steps={WATCHLIST_TOUR_STEPS} suppressGuideId="watchlist" />
    </>
  );
}
