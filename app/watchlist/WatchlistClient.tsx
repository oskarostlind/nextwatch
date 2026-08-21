'use client';

import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Search, Send, Star } from 'lucide-react';
import Modal from '@/app/components/ui/Modal';
import PosterImage from '@/app/components/ui/PosterImage';
import WatchNowButton from '@/app/components/watch/WatchNowButton';
import type { ShareItem } from '@/app/components/client/ShareTitleModal';
import MediaFilters, { type MediaTypeFilter } from '@/app/components/discover/MediaFilters';
import { Button, fieldClass } from '@/app/components/ui/kit';
import {
  bestWatchUrl,
  isPaidOnly,
  providerGroupsFor,
  providerWatchUrl,
  type WatchProviders as Providers,
} from '@/lib/watchLinks';
import { useSwipeSettings } from '@/app/components/client/SwipeSettingsProvider';
import { PosterGridSkeleton } from '@/app/components/ui/Skeletons';
import { markTitleRated } from '@/lib/swipeDeckStore';
import {
  loadRated,
  loadWatchlist,
  readCachedRated,
  readCachedWatchlist,
  PLACEHOLDER_POSTER,
  type RatedItem,
  type WatchItem,
} from '@/lib/watchlistData';
import { WATCHLIST_TOUR_STEPS } from '@/lib/tours/coachSteps';
import { toggleKeywordGroup } from '@/lib/subgenres';
import { useTranslations } from "next-intl";

// Allt nedan renderas bakom ett booleskt state (eller bara när det finns data),
// så det behöver inte ligga i förstaladdningens bundle. ssr:false — de är
// klientkomponenter utan serveryta.
const RatingModal = dynamic(() => import('@/app/components/client/RatingModal'), { ssr: false });
const ImdbImportModal = dynamic(() => import('@/app/components/client/ImdbImportModal'), { ssr: false });
const ShareTitleModal = dynamic(() => import('@/app/components/client/ShareTitleModal'), { ssr: false });
const SharedTipsInbox = dynamic(() => import('@/app/components/client/SharedTipsInbox'), { ssr: false });
const CoachMarkTour = dynamic(() => import('@/app/components/client/tours/CoachMarkTour'), { ssr: false });

// WatchItem/RatedItem, hämtningen och klientcachen bor i lib/watchlistData.ts
// så att WatchlistPreloader (AppShell) kan fylla samma cache vid appstart utan
// en andra kopia av logiken. Se filhuvudet där.

type Tab = 'watchlist' | 'ratings';

type ProvidersResp = { ok: boolean; region?: string; providers: Providers | null };

type Detail = { overview?: string };

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
  const t = useTranslations("watchlist");
  const tw = useTranslations("watch");
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
  // Sub-genre-val (GenrePicker-unfold). Titlarna bär numera TMDB keyword-id:n
  // (append_to_response=keywords i lib/watchlistCards.ts/ratings/list, cachat
  // client-side i lib/titleCache), så ett valt sub-genre-chip smalnar listan
  // ner till titlar som faktiskt har det keywordet — se `filtered` och
  // `filteredRated` nedan. En titel vars keywords ännu inte hunnit cachas
  // (keywordIds === undefined) filtreras INTE bort — den visas tills
  // enrichmenten hinner ikapp, i stället för att försvinna förvirrande.
  const [wlKeywordIds, setWlKeywordIds] = useState<number[]>([]);
  const [ratedType, setRatedType] = useState<MediaTypeFilter>('movie');
  const [ratedSort, setRatedSort] = useState('userRating');
  const [ratedGenres, setRatedGenres] = useState<string[]>([]);
  const [ratedKeywordIds, setRatedKeywordIds] = useState<number[]>([]);

  const [imdbOpen, setImdbOpen] = useState(false);
  const [shareItem, setShareItem] = useState<ShareItem | null>(null);
  const [rateFromWl, setRateFromWl] = useState<WatchItem | null>(null);
  const [rateWlSaving, setRateWlSaving] = useState(false);

  const refetchWatchlist = useCallback(() => {
    void (async () => {
      // Hämtning + cacheskrivning i lib/watchlistData.ts — samma funktion som
      // WatchlistPreloader kör vid appstart. `null` = misslyckades, då står den
      // ev. cachade listan kvar.
      const mapped = await loadWatchlist();
      if (mapped) setItems(mapped);
      setWlLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (initial !== undefined) return;
    // Cachen läses efter mount, inte under render: servern har inget
    // localStorage, så en läsning i render hade gett hydration-mismatch.
    // Kostar en bildruta skelett — men tar bort de sekunder som annars gick åt
    // till nätverket plus serverns hopsättning av listan.
    const cached = readCachedWatchlist();
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
      // Se refetchWatchlist — samma delade hämtning. Misslyckas den faller vi
      // tillbaka på tom lista bara om vi inte redan visar något.
      const mapped = await loadRated();
      if (mapped) setRated(mapped);
      else setRated((prev) => prev ?? []);
      setRatedLoading(false);
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
        const cached = readCachedRated();
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
    if (wlKeywordIds.length > 0) {
      list = list.filter(
        (it) => it.keywordIds === undefined || it.keywordIds.some((kid) => wlKeywordIds.includes(kid))
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
  }, [q, items, wlType, wlSort, wlGenres, wlKeywordIds]);

  const filteredRated = useMemo(() => {
    let list = (rated ?? []).filter((it) => it.mediaType === ratedType);
    if (ratedGenres.length > 0) {
      list = list.filter((it) =>
        (it.genreIds ?? []).some((gid) => ratedGenres.includes(String(gid)))
      );
    }
    if (ratedKeywordIds.length > 0) {
      list = list.filter(
        (it) => it.keywordIds === undefined || it.keywordIds.some((kid) => ratedKeywordIds.includes(kid))
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
  }, [q, rated, ratedType, ratedSort, ratedGenres, ratedKeywordIds]);

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
              keywordIds: it.keywordIds,
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
            { key: 'watchlist' as Tab, labelKey: 'tabWatchlist' as const },
            { key: 'ratings' as Tab, labelKey: 'tabRatings' as const },
          ]
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => openTab(item.key)}
            aria-pressed={tab === item.key}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              tab === item.key ? 'bg-white text-neutral-900' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {(tab === 'watchlist' || tab === 'ratings') && (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" onClick={() => setImdbOpen(true)}>
            {t("importImdb")}
          </Button>
        </div>
      )}

      {tab === 'watchlist' ? (
        <MediaFilters
          type={wlType}
          onTypeChange={(t) => {
            setWlType(t);
            setWlGenres([]);
            setWlKeywordIds([]);
          }}
          sort={wlSort}
          onSortChange={setWlSort}
          genres={wlGenres}
          onToggleGenre={(id) =>
            setWlGenres((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          keywordIds={wlKeywordIds}
          onToggleKeywordIds={(ids) => setWlKeywordIds((prev) => toggleKeywordGroup(prev, ids))}
          mode="watchlist"
          layoutId="watchlist-type"
        />
      ) : (
        <MediaFilters
          type={ratedType}
          onTypeChange={(t) => {
            setRatedType(t);
            setRatedGenres([]);
            setRatedKeywordIds([]);
          }}
          sort={ratedSort}
          onSortChange={setRatedSort}
          genres={ratedGenres}
          onToggleGenre={(id) =>
            setRatedGenres((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          keywordIds={ratedKeywordIds}
          onToggleKeywordIds={(ids) => setRatedKeywordIds((prev) => toggleKeywordGroup(prev, ids))}
          mode="rated"
          layoutId="ratings-type"
        />
      )}

      <div className="mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className={`${fieldClass} text-sm`}
        />
      </div>

      {tab === 'ratings' ? (
        ratedLoading ? (
          <p className="text-neutral-400">{t("loadingRatings")}</p>
        ) : filteredRated.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
            {rated && rated.length > 0 ? (
              <Search className="mx-auto mb-2 h-10 w-10 text-white/20" />
            ) : (
              <Star className="mx-auto mb-2 h-10 w-10 text-white/20" />
            )}
            <p className="text-neutral-400">
              {rated && rated.length > 0 ? t("noMatches") : t("noRatingsYet")}
            </p>
          </div>
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
                  <PosterImage
                    src={it.poster}
                    alt={it.title}
                    width={342}
                    height={513}
                    className="aspect-[2/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                    {it.title}
                  </div>
                )}
                <div className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/70 px-2 py-1 text-[11px] font-bold tabular-nums text-emerald-300 backdrop-blur">
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
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
          {items.length === 0 ? (
            <Film className="mx-auto mb-2 h-10 w-10 text-white/20" />
          ) : (
            <Search className="mx-auto mb-2 h-10 w-10 text-white/20" />
          )}
          <p className="text-neutral-400">
            {items.length === 0
              ? t("emptyWatchlist")
              : items.some((it) => it.tmdbType === wlType)
              ? t("noMatches")
              : wlType === 'movie'
              ? t("emptyMoviesHasTv")
              : t("emptyTvHasMovies")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-tour="watchlist-grid">
          {filtered.map((it) => (
            <div
              key={`${it.tmdbType}-${it.id}`}
              className="group relative overflow-hidden rounded-xl border border-white/10 transition hover:ring-2 hover:ring-cyan-500/60"
            >
              <button
                type="button"
                aria-label={t("tipFriend")}
                onClick={() =>
                  setShareItem({
                    tmdbId: it.id,
                    mediaType: it.tmdbType,
                    title: it.title,
                    year: it.year ?? null,
                    poster: it.posterUrl.startsWith('data:') ? null : it.posterUrl,
                  })
                }
                className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/60 p-2.5 text-neutral-300 backdrop-blur transition after:absolute after:-inset-1 hover:bg-cyan-500 hover:text-black"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("removeFromWatchlist")}
                onClick={() => remove(it)}
                className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 p-2.5 text-neutral-300 backdrop-blur transition after:absolute after:-inset-1 hover:bg-rose-600 hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 6h18M9 6v-.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V6m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M10 10v6M14 10v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>

              <button type="button" onClick={() => open(it)} className="relative block w-full text-left">
                <PosterImage
                  src={it.posterUrl}
                  alt={it.title}
                  width={342}
                  height={513}
                  className="aspect-[2/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
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
                  typeof active.rating === 'number'
                    ? t('tmdbRating', { value: active.rating.toFixed(1) })
                    : null,
                  typeof userRatingFor(active.id, active.tmdbType) === 'number'
                    ? t('yourRating', { value: String(userRatingFor(active.id, active.tmdbType)) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || t('noRating')}
              </p>

              <p className="mt-3 text-sm leading-relaxed text-neutral-200">
                {loading ? t("loadingInfo") : (detail.overview || t("noDescription"))}
              </p>

              <div className="mt-4 space-y-3">
                {providerGroups.length === 0 && !loading && (
                  <p className="text-sm text-neutral-400">
                    {paidOnly ? tw("paidOnly") : t("noStreamingData")}
                  </p>
                )}
                {providerGroups.map(({ labelKey, list }) => (
                  <div key={labelKey}>
                    <p className="mb-2 text-xs uppercase tracking-widest text-cyan-400/80">{tw(`group.${labelKey}`)}</p>
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
                            title={t('openProvider', { provider: p.provider_name })}
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
                  {t("tipFriend")}
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
                  {t('rate')}
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
        heading={t("editRatingHeading")}
        skipLabel={t("cancel")}
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
        heading={t("ratePromptHeading")}
        skipLabel={t("cancel")}
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

      {/* Just-in-time: hinten tänds först när listan är hämtad OCH det finns
          något i den. Att förklara "så här betygsätter du" ovanpå en tom
          watchlist är precis den sortens front-loading vi tog bort. */}
      <CoachMarkTour
        tourId="watchlist-tour"
        steps={WATCHLIST_TOUR_STEPS}
        enabled={!wlLoading && items.length > 0}
      />
    </>
  );
}
