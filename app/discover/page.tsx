"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Star } from "lucide-react";
import { PageHeader, Button, Note } from "../components/ui/kit";
import MediaFilters, { type MediaTypeFilter } from "../components/discover/MediaFilters";
import RatingModal from "../components/client/RatingModal";

type Item = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  year: string | null;
  voteAverage: number | null;
};

type ApiOk = { ok: true; page: number; totalPages: number; items: Item[] };
type ApiErr = { ok: false; error: string };

function fmtRating(v: number | null) {
  if (v == null) return "–";
  return (Math.round(v * 10) / 10).toFixed(1);
}

export default function DiscoverPage() {
  const [type, setType] = useState<MediaTypeFilter>("movie");
  const [sort, setSort] = useState("popularity.desc");
  const [genres, setGenres] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const [rateTarget, setRateTarget] = useState<Item | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [userRatings, setUserRatings] = useState<Record<string, number>>({});

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

  function toggleGenre(id: string) {
    setPage(1);
    setGenres((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submitRating(rating: number) {
    const it = rateTarget;
    if (!it) return;
    setRateSaving(true);
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

  return (
    <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
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

      {err && (
        <div className="mb-3">
          <Note tone="error">{err}</Note>
        </div>
      )}
      {busy && <div className="mb-3 text-sm text-neutral-400">Laddar…</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((it) => {
          const key = `${it.mediaType}_${it.id}`;
          const userRating = userRatings[key];
          return (
            <div
              key={key}
              className="group relative overflow-hidden rounded-xl border border-white/10 transition hover:ring-2 hover:ring-cyan-500/60"
            >
              <a href={`/swipe?media=${it.mediaType}`} className="block" title={it.title}>
                {it.posterPath ? (
                  <Image
                    src={`https://image.tmdb.org/t/p/w342${it.posterPath}`}
                    alt={it.title}
                    width={342}
                    height={513}
                    className="h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="aspect-[2/3] bg-white/5" />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 text-[12px]">
                  <div className="truncate font-medium">{it.title}</div>
                  <div className="flex items-center justify-between opacity-90">
                    <span>{it.year ?? "—"}</span>
                    <span>★ {fmtRating(it.voteAverage)}</span>
                  </div>
                </div>
              </a>
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
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          ← Föregående
        </Button>
        <span className="text-sm text-neutral-400">Sida {page}</span>
        <Button variant="secondary" onClick={() => setPage((p) => p + 1)}>
          Nästa →
        </Button>
      </div>

      <RatingModal
        open={rateTarget !== null}
        item={
          rateTarget
            ? {
                tmdbId: rateTarget.id,
                mediaType: rateTarget.mediaType,
                title: rateTarget.title,
                year: rateTarget.year,
                poster: rateTarget.posterPath
                  ? `https://image.tmdb.org/t/p/w342${rateTarget.posterPath}`
                  : null,
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
