"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Send, Star } from "lucide-react";
import { PageHeader, Button, Note } from "../components/ui/kit";
import MediaFilters, { type MediaTypeFilter } from "../components/discover/MediaFilters";
import RatingModal from "../components/client/RatingModal";
import ShareTitleModal, { type ShareItem } from "../components/client/ShareTitleModal";
import Modal from "../components/ui/Modal";
import WatchNowButton from "../components/watch/WatchNowButton";
import {
  bestWatchUrl,
  isPaidOnly,
  providerGroupsFor,
  providerWatchUrl,
  PAID_ONLY_LABEL,
  type WatchProviders as Providers,
} from "@/lib/watchLinks";
import { useSwipeSettings } from "../components/client/SwipeSettingsProvider";
import { markTitleRated } from "@/lib/swipeDeckStore";

type Item = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  year: string | null;
  voteAverage: number | null;
};

type SearchHit = {
  id: number;
  title: string;
  year: string;
  poster: string | null;
};

type ApiOk = { ok: true; page: number; totalPages: number; items: Item[] };
type ApiErr = { ok: false; error: string };

type ProvidersResp = { ok: boolean; region?: string; providers: Providers | null };

type Detail = { overview?: string };

function fmtRating(v: number | null) {
  if (v == null) return "–";
  return (Math.round(v * 10) / 10).toFixed(1);
}

function posterSrc(posterPath: string | null, size: "w342" | "w500" = "w342") {
  if (!posterPath) return null;
  if (posterPath.startsWith("http")) return posterPath;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

function itemToShareItem(it: Item): ShareItem {
  return {
    tmdbId: it.id,
    mediaType: it.mediaType,
    title: it.title,
    year: it.year,
    poster: posterSrc(it.posterPath, "w500"),
  };
}

function searchHitToItem(hit: SearchHit, mediaType: MediaTypeFilter): Item {
  return {
    id: hit.id,
    mediaType,
    title: hit.title,
    posterPath: hit.poster,
    year: hit.year || null,
    voteAverage: null,
  };
}

async function fetchProviders(id: number, mediaType: "movie" | "tv"): Promise<ProvidersResp> {
  const res = await fetch(`/api/tmdb/watch-providers?id=${id}&type=${mediaType}`, { cache: "no-store" });
  return (await res.json()) as ProvidersResp;
}

async function fetchDetail(id: number, mediaType: "movie" | "tv"): Promise<Detail> {
  const res = await fetch(`/api/watchlist/detail?id=${id}&type=${mediaType}`, { cache: "no-store" });
  if (!res.ok) return {};
  return (await res.json()) as Detail;
}

export default function DiscoverPage() {
  const { showPaidOptions } = useSwipeSettings();
  const [type, setType] = useState<MediaTypeFilter>("movie");
  const [sort, setSort] = useState("popularity.desc");
  const [genres, setGenres] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  // Sentinel högst upp i listan. scrollIntoView scrollar den container som
  // faktiskt scrollar (discover-mainen har egen overflow-y-auto) — så ett
  // sidbyte tar dig till toppen i stället för att lämna dig kvar på botten.
  const topRef = useRef<HTMLDivElement>(null);
  const scrollToTop = () => topRef.current?.scrollIntoView({ block: "start" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);

  const [active, setActive] = useState<Item | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [detail, setDetail] = useState<Detail>({});
  const [modalLoading, setModalLoading] = useState(false);

  const [rateTarget, setRateTarget] = useState<Item | null>(null);
  const [shareItem, setShareItem] = useState<ShareItem | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [userRatings, setUserRatings] = useState<Record<string, number>>({});

  const isSearching = debouncedQ.trim().length >= 2;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({
          type,
          page: String(page),
          sort_by: sort,
        });
        if (genres.length) qs.set("with_genres", genres.join(","));
        const r = await fetch(`/api/tmdb/discover?${qs.toString()}`, { cache: "no-store" });
        const j = (await r.json()) as ApiOk | ApiErr;
        if (ignore) return;
        if (!j.ok) throw new Error(j.error);
        setItems(j.items);
      } catch (e) {
        if (!ignore) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ignore) setBusy(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [type, sort, genres, page]);

  useEffect(() => {
    const needle = debouncedQ.trim();
    if (needle.length < 2) {
      setSearchResults([]);
      setSearchBusy(false);
      return;
    }

    let ignore = false;
    (async () => {
      setSearchBusy(true);
      try {
        const r = await fetch(
          `/api/tmdb/search?q=${encodeURIComponent(needle)}&type=${type}&limit=20`,
          { cache: "no-store" }
        );
        const j = (await r.json()) as { ok: boolean; results?: SearchHit[]; message?: string };
        if (ignore) return;
        if (!j.ok) throw new Error(j.message ?? "Sökningen misslyckades");
        setSearchResults(j.results ?? []);
      } catch (e) {
        if (!ignore) {
          setSearchResults([]);
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!ignore) setSearchBusy(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [debouncedQ, type]);

  const openItem = useCallback(async (it: Item) => {
    setActive(it);
    setModalLoading(true);
    try {
      const [p, d] = await Promise.all([fetchProviders(it.id, it.mediaType), fetchDetail(it.id, it.mediaType)]);
      setProviders(p.ok ? p.providers : null);
      setDetail(d);
    } finally {
      setModalLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setActive(null);
    setProviders(null);
    setDetail({});
  }, []);

  const providerGroups = useMemo(
    () => providerGroupsFor(providers, showPaidOptions),
    [providers, showPaidOptions]
  );

  const paidOnly = useMemo(() => isPaidOnly(providers, showPaidOptions), [providers, showPaidOptions]);

  const watchUrl = useMemo(() => {
    if (!active) return undefined;
    return bestWatchUrl(providers, active.title, showPaidOptions);
  }, [providers, active, showPaidOptions]);

  function toggleGenre(id: string) {
    setPage(1);
    setGenres((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submitRating(rating: number) {
    const it = rateTarget;
    if (!it) return;
    setRateSaving(true);
    // Betygsatt titel ska aldrig tillbaka i swipen — rensa ur ev. cachad lek.
    markTitleRated(it.id, it.mediaType);
    void fetch("/api/ratings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: it.id, mediaType: it.mediaType, rating }),
    })
      .then((res) => {
        if (res.ok) {
          setUserRatings((prev) => ({ ...prev, [`${it.mediaType}_${it.id}`]: rating }));
        }
      })
      .finally(() => {
        setRateSaving(false);
        setRateTarget(null);
      });
  }

  const displayItems = isSearching ? searchResults.map((hit) => searchHitToItem(hit, type)) : items;

  function renderCard(it: Item) {
    const key = `${it.mediaType}_${it.id}`;
    const userRating = userRatings[key];
    const src = posterSrc(it.posterPath);

    return (
      <div
        key={key}
        className="group relative overflow-hidden rounded-xl border border-white/10 transition hover:ring-2 hover:ring-cyan-500/60"
      >
        <button type="button" onClick={() => openItem(it)} className="relative block w-full text-left" title={it.title}>
          {src ? (
            <Image
              src={src}
              alt={it.title}
              width={342}
              height={513}
              className="h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center bg-white/5 p-2 text-center text-xs text-neutral-400">
              {it.title}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 text-[12px]">
            <div className="truncate font-medium">{it.title}</div>
            <div className="flex items-center justify-between opacity-90">
              <span>{it.year ?? "—"}</span>
              <span>★ {fmtRating(it.voteAverage)}</span>
            </div>
          </div>
        </button>
        {typeof userRating === "number" ? (
          <div className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-emerald-300 backdrop-blur">
            Ditt: {userRating}
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Betygsätt"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRateTarget(it);
          }}
          className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 p-2 text-amber-300 backdrop-blur transition hover:bg-amber-500/30 hover:text-amber-200"
        >
          <Star className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Tipsa en vän"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShareItem(itemToShareItem(it));
          }}
          className="absolute right-1.5 top-11 z-10 rounded-full bg-black/60 p-2 text-neutral-300 backdrop-blur transition hover:bg-cyan-500 hover:text-black"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
      <div ref={topRef} />
      <PageHeader eyebrow="Utforska" title="Discover" subtitle="Bläddra bland filmer och serier." />

      <MediaFilters
        type={type}
        onTypeChange={(t) => {
          setType(t);
          setPage(1);
          setGenres([]);
        }}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        genres={genres}
        onToggleGenre={toggleGenre}
        mode="discover"
        layoutId="discover-type"
      />

      <div className="mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök titel…"
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
        />
      </div>

      {err && (
        <div className="mb-3">
          <Note tone="error">{err}</Note>
        </div>
      )}
      {(busy || searchBusy) && <div className="mb-3 text-sm text-neutral-400">Laddar…</div>}

      {isSearching && !searchBusy && displayItems.length === 0 ? (
        <p className="text-neutral-400">Inga träffar för &quot;{debouncedQ.trim()}&quot;.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {displayItems.map((it) => renderCard(it))}
        </div>
      )}

      {!isSearching && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              scrollToTop();
            }}
            disabled={page === 1}
          >
            ← Föregående
          </Button>
          <span className="text-sm text-neutral-400">Sida {page}</span>
          <Button
            variant="secondary"
            onClick={() => {
              setPage((p) => p + 1);
              scrollToTop();
            }}
          >
            Nästa →
          </Button>
        </div>
      )}

      <Modal open={Boolean(active)} onClose={closeModal} labelledBy="discover-modal-title">
        {active && (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative mx-auto h-[320px] w-[220px] shrink-0 overflow-hidden rounded-2xl md:mx-0">
              {posterSrc(active.posterPath, "w500") ? (
                <Image
                  src={posterSrc(active.posterPath, "w500")!}
                  alt={active.title}
                  fill
                  sizes="220px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-neutral-800 p-4 text-center text-sm text-neutral-400">
                  {active.title}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h2 id="discover-modal-title" className="text-xl font-bold text-white">
                {active.title}
                {active.year ? ` (${active.year})` : ""}
              </h2>
              <p className="mt-1 text-sm text-neutral-300">
                {active.voteAverage != null ? `Betyg: ${fmtRating(active.voteAverage)}` : "Betyg saknas"}
              </p>

              <p className="mt-3 text-sm leading-relaxed text-neutral-200">
                {modalLoading ? "Laddar info…" : detail.overview || "Ingen beskrivning tillgänglig."}
              </p>

              <div className="mt-4 space-y-3">
                {providerGroups.length === 0 && !modalLoading && (
                  <p className="text-sm text-neutral-400">
                    {paidOnly ? PAID_ONLY_LABEL : "Ingen tillgänglig streamingdata för din region just nu."}
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
                          "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-neutral-200";
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
                    closeModal();
                    setRateTarget(active);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20"
                >
                  <Star className="h-4 w-4" />
                  Betygsätt
                  {typeof userRatings[`${active.mediaType}_${active.id}`] === "number"
                    ? ` (${userRatings[`${active.mediaType}_${active.id}`]}/10)`
                    : ""}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const it = active;
                    closeModal();
                    setShareItem(itemToShareItem(it));
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                >
                  <Send className="h-4 w-4" />
                  Tipsa en vän
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ShareTitleModal open={shareItem !== null} item={shareItem} onClose={() => setShareItem(null)} />

      <RatingModal
        open={rateTarget !== null}
        item={
          rateTarget
            ? {
                tmdbId: rateTarget.id,
                mediaType: rateTarget.mediaType,
                title: rateTarget.title,
                year: rateTarget.year,
                poster: posterSrc(rateTarget.posterPath),
              }
            : null
        }
        heading="Vad tyckte du?"
        skipLabel="Avbryt"
        saving={rateSaving}
        initialRating={rateTarget ? userRatings[`${rateTarget.mediaType}_${rateTarget.id}`] : undefined}
        onRate={submitRating}
        onSkip={() => setRateTarget(null)}
      />
    </main>
  );
}
