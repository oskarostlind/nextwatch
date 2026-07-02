'use client';

import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import Modal from '@/app/components/ui/Modal';
import WatchNowButton from '@/app/components/watch/WatchNowButton';
import { bestWatchUrl, providerWatchUrl } from '@/lib/watchLinks';

type WatchItem = {
  id: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  year?: string;
  rating?: number;
  posterUrl: string;
};

type Providers = {
  link?: string;
  flatrate?: { provider_name: string; logo_path: string | null }[];
  rent?: { provider_name: string; logo_path: string | null }[];
  buy?: { provider_name: string; logo_path: string | null }[];
};
type ProvidersResp = { ok: boolean; region?: string; providers: Providers | null };

type Detail = { overview?: string };

async function fetchProviders(id: number, tmdbType: 'movie' | 'tv'): Promise<ProvidersResp> {
  const res = await fetch(`/api/tmdb/watch-providers?id=${id}&type=${tmdbType}`, { cache: 'no-store' });
  return (await res.json()) as ProvidersResp;
}

async function fetchDetail(id: number, tmdbType: 'movie' | 'tv'): Promise<Detail> {
  const res = await fetch(`/api/watchlist/detail?id=${id}&type=${tmdbType}`, { cache: 'no-store' });
  if (!res.ok) return {};
  return (await res.json()) as Detail;
}

export default function WatchlistClient({ items: initial }: { items: WatchItem[] }) {
  const [items, setItems] = useState<WatchItem[]>(initial);
  const [active, setActive] = useState<WatchItem | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [detail, setDetail] = useState<Detail>({});
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [cols, setCols] = useState<1 | 2 | 3 | 4>(2);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.title.toLowerCase().includes(needle));
  }, [q, items]);

  const gridClass = useMemo(() => {
    switch (cols) {
      case 1: return 'grid-cols-1';
      case 2: return 'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
      case 3: return 'grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';
      case 4: return 'grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8';
    }
  }, [cols]);

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

  const providerGroups = useMemo(() => {
    if (!providers) return [];
    const out: { label: string; list: NonNullable<Providers['flatrate']> }[] = [];
    if (providers.flatrate?.length) out.push({ label: 'Streama', list: providers.flatrate });
    if (providers.rent?.length) out.push({ label: 'Hyr', list: providers.rent });
    if (providers.buy?.length) out.push({ label: 'Köp', list: providers.buy });
    return out;
  }, [providers]);

  // "Kolla nu" ska öppna streamingtjänsten direkt (universal link → appen på mobil),
  // inte TMDB:s watch-sida. TMDB-länken är bara sista fallback.
  const watchUrl = useMemo(() => {
    if (!active) return undefined;
    const names = [
      ...(providers?.flatrate ?? []),
      ...(providers?.rent ?? []),
      ...(providers?.buy ?? []),
    ].map((p) => p.provider_name);
    return bestWatchUrl(names, active.title, providers?.link);
  }, [providers, active]);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök titel…"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
        />
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setCols(n as 1 | 2 | 3 | 4)}
              aria-label={`${n} per rad`}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                cols === n ? 'bg-cyan-500 text-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-neutral-400">Inga träffar.</p>
      ) : (
        <div className={`grid ${gridClass} gap-3`}>
          {filtered.map((it) => (
            <div
              key={`${it.tmdbType}-${it.id}`}
              className="group relative overflow-hidden rounded-xl border border-white/10 bg-neutral-900/60 transition hover:ring-2 hover:ring-cyan-500/60"
            >
              <button
                aria-label="Ta bort från watchlist"
                onClick={() => remove(it)}
                className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 p-2 text-neutral-300 backdrop-blur transition hover:bg-rose-600 hover:text-white"
              >
                {/* trash icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 6h18M9 6v-.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V6m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M10 10v6M14 10v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>

              <button onClick={() => open(it)} className="block w-full text-left">
                <div className="relative aspect-[2/3] w-full">
                  <Image
                    src={it.posterUrl}
                    alt={it.title}
                    fill
                    sizes="(max-width:768px) 50vw, (max-width:1200px) 25vw, 20vw"
                    className="object-cover"
                    priority={false}
                  />
                </div>
                {cols <= 2 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 pt-8">
                    <p className="truncate text-sm font-semibold text-white">{it.title}</p>
                    <p className="flex items-center justify-between text-xs text-neutral-300">
                      <span>{it.year ?? '—'}</span>
                      {typeof it.rating === 'number' && <span>★ {it.rating.toFixed(1)}</span>}
                    </p>
                  </div>
                )}
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
                {typeof active.rating === 'number' ? `Betyg: ${active.rating.toFixed(1)}` : 'Betyg saknas'}
              </p>

              <p className="mt-3 text-sm leading-relaxed text-neutral-200">
                {loading ? 'Laddar info…' : (detail.overview || 'Ingen beskrivning tillgänglig.')}
              </p>

              <div className="mt-4 space-y-3">
                {providerGroups.length === 0 && !loading && (
                  <p className="text-sm text-neutral-400">Ingen tillgänglig streamingdata för din region just nu.</p>
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

              <div className="mt-5">
                <WatchNowButton url={watchUrl} />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
