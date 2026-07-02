// app/components/ui/MatchOverlay.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

export type ProviderLink = { name: string; url: string };
export type GroupMatchItem = {
  tmdbId: number;
  tmdbType: "movie" | "tv";
  title: string;
  year?: number;
  poster?: string;
  rating?: number;
  overview?: string;
  providers?: ProviderLink[];
};

type Props = {
  open: boolean;
  item?: GroupMatchItem | null;
  onClose: () => void;
  code?: string; // gruppkod för ack (hämtas även server-side, men bra att skicka med)
};

function normalizePoster(src?: string): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("http")) return src;
  return `https://image.tmdb.org/t/p/w780${src}`;
}

export default function MatchOverlay({ open, item, onClose, code }: Props) {
  const [flipped, setFlipped] = useState(false);

  const posterSrc = useMemo(() => normalizePoster(item?.poster), [item?.poster]);
  const titleLine = useMemo(() => {
    if (!item) return "";
    const y = item.year ? ` (${item.year})` : "";
    return `${item.title}${y}`;
  }, [item]);
  const rating = item?.rating !== undefined ? item.rating.toFixed(1) : undefined;
  const providers: ProviderLink[] = item?.providers ?? [];

  const onFlip = useCallback(() => setFlipped((f) => !f), []);

  const ackAndClose = useCallback(async () => {
    try {
      if (item) {
        await fetch("/api/group/match/ack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            tmdbId: item.tmdbId,
            tmdbType: item.tmdbType,
          }),
        });
      }
    } catch {
      // tyst
    } finally {
      setFlipped(false);
      onClose();
    }
  }, [code, item, onClose]);

  if (!open || !item) return null;

  // Rendera via portal till <body> för att undvika stacking/overflow-problem
  return createPortal(
    <div
      aria-modal
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
    >
      {/* Klick utanför kortet stänger */}
      <button aria-label="Close overlay" onClick={ackAndClose} className="absolute inset-0" />

      <div
        className="relative mx-4 w-full max-w-sm"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        <div className="mb-2 text-center text-sm font-semibold text-white">
          <span role="img" aria-label="confetti" className="mr-1">
            🎉
          </span>
          Gruppmatch!
        </div>

        <div
          className="group relative h-[68vh] w-full cursor-pointer [perspective:1200px]"
          onClick={onFlip}
        >
          {/* Front (bild) */}
          <div
            className={`absolute inset-0 rounded-2xl bg-neutral-900 shadow-xl transition-transform duration-500 [backface-visibility:hidden] ${
              flipped ? "rotate-y-180" : "rotate-y-0"
            }`}
            style={{ transformStyle: "preserve-3d" as const }}
          >
            {posterSrc ? (
              <Image
                src={posterSrc}
                alt={item.title}
                fill
                className="rounded-2xl object-cover"
                sizes="(max-width: 640px) 100vw, 384px"
                priority
              />
            ) : (
                <div className="flex h-full items-center justify-center rounded-2xl bg-neutral-800 text-neutral-300">
                Ingen bild
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-gradient-to-t from-black/80 to-transparent p-4">
              <div className="text-white">
                <div className="text-base font-semibold">{titleLine}</div>
                {rating && <div className="mt-0.5 text-xs text-emerald-300">★ {rating}</div>}
              </div>
            </div>
          </div>

          {/* Back (beskrivning + providers) */}
          <div
            className={`absolute inset-0 rounded-2xl bg-neutral-900 p-4 text-neutral-100 shadow-xl transition-transform duration-500 [backface-visibility:hidden] ${
              flipped ? "rotate-y-0" : "rotate-y-180"
            }`}
            style={{ transformStyle: "preserve-3d" as const }}
          >
            <div className="flex h-full flex-col">
              <div className="mb-2 text-sm font-semibold">{titleLine}</div>
              <div className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-700 grow overflow-auto text-sm leading-5">
                {item.overview ? (
                  <p className="whitespace-pre-line">{item.overview}</p>
                ) : (
                  <p>Ingen beskrivning tillgänglig.</p>
                )}
              </div>

              {providers.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">
                    Tillgänglig på
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {providers.map((p) => (
                      <a
                        key={p.name}
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-neutral-600 px-3 py-1 text-xs hover:border-neutral-400 hover:text-white"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pointer-events-auto mt-3 flex justify-center gap-3">
          <button
            type="button"
            onClick={onFlip}
            className="rounded-xl border border-neutral-600 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-400 hover:text-white"
          >
            {flipped ? "Framsida" : "Mer info"}
          </button>
          <button
            type="button"
            onClick={ackAndClose}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Fortsätt swipa
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
