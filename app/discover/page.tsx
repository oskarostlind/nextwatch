"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { PageHeader, Chip, Button, Note, SegmentedTabs } from "../components/ui/kit";

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

const MOVIE_GENRES = [
  ["28", "Action"], ["12", "Äventyr"], ["16", "Animerat"], ["35", "Komedi"],
  ["80", "Kriminal"], ["18", "Drama"], ["14", "Fantasy"], ["27", "Skräck"],
  ["10749", "Romantik"], ["878", "Sci-Fi"], ["53", "Thriller"],
] as const;

const TV_GENRES = [
  ["10759", "Action & Äventyr"], ["16", "Animerat"], ["35", "Komedi"],
  ["80", "Kriminal"], ["18", "Drama"], ["10765", "Sci-Fi & Fantasy"],
  ["9648", "Mystik"], ["10768", "Krig & Politik"],
] as const;

function fmtRating(v: number | null) {
  if (v == null) return "–";
  return (Math.round(v * 10) / 10).toFixed(1);
}

export default function DiscoverPage() {
  const [type, setType] = useState<"movie" | "tv">("movie");
  const [sort, setSort] = useState("popularity.desc");
  const [genres, setGenres] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const genreList = useMemo(() => (type === "movie" ? MOVIE_GENRES : TV_GENRES), [type]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setBusy(true); setErr(null);
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
    return () => { ignore = true; };
  }, [type, sort, genres, page]);

  function toggleGenre(id: string) {
    setPage(1);
    setGenres(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
      <main className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-6">
        <PageHeader eyebrow="Utforska" title="Discover" subtitle="Bläddra bland filmer och serier." />

        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SegmentedTabs
                layoutId="discover-type"
                tabs={[
                  { id: "movie", label: "Film" },
                  { id: "tv", label: "Serier" },
                ]}
                value={type}
                onChange={(t) => { setType(t); setPage(1); setGenres([]); }}
              />
            </div>
            <select
              aria-label="Sortera"
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="shrink-0 rounded-full border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="popularity.desc">Populärast</option>
              <option value="vote_average.desc">Högst betyg</option>
              <option value={type === "movie" ? "primary_release_date.desc" : "first_air_date.desc"}>
                Nyast
              </option>
            </select>
          </div>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {genreList.map(([id, name]) => (
              <Chip
                key={id}
                selected={genres.includes(id)}
                onClick={() => toggleGenre(id)}
                className="shrink-0 whitespace-nowrap"
              >
                {name}
              </Chip>
            ))}
          </div>
        </div>

        {err && <div className="mb-3"><Note tone="error">{err}</Note></div>}
        {busy && <div className="mb-3 text-sm text-neutral-400">Laddar…</div>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((it) => (
            <a
              key={`${it.mediaType}:${it.id}`}
              href={`/swipe?media=${it.mediaType}`}
              className="group relative overflow-hidden rounded-xl border border-white/10 transition hover:ring-2 hover:ring-cyan-500/60"
              title={it.title}
            >
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
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 text-[12px]">
                <div className="truncate font-medium">{it.title}</div>
                <div className="flex items-center justify-between opacity-90">
                  <span>{it.year ?? "—"}</span>
                  <span>★ {fmtRating(it.voteAverage)}</span>
                </div>
              </div>
            </a>
          ))}
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
      </main>

  );
}
