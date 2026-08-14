"use client";

// Betygs-popup (1–10, slider) som återanvänds på tre ställen:
// 1) /swipe: när användaren swipear upp ("Sett") på ett kort.
// 2) OverlayMount: "betygsätt er tidigare gruppmatch" vid app-öppning.
// 3) /watchlist (Betyg-fliken): ändra/ta bort ett befintligt betyg.
// Komponenten är medvetet dum — den vet inget om API:er; föräldern
// hanterar spara/hoppa över/ta bort via onRate/onSkip/onRemove.

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

export type RatingModalItem = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year?: string | null;
  poster?: string | null;
};

type Props = {
  open: boolean;
  item: RatingModalItem | null;
  /** Rubrik ovanför titeln, t.ex. "Vad tyckte du?" eller "Ni matchade på denna — såg ni den?" */
  heading?: string;
  skipLabel?: string;
  saving?: boolean;
  /** Förifyllt betyg (vid redigering av ett befintligt betyg). */
  initialRating?: number;
  onRate: (rating: number) => void;
  onSkip: () => void;
  /** Om satt visas en "Ta bort betyg"-knapp (används i Betyg-fliken). */
  onRemove?: () => void;
  removeLabel?: string;
};

function normalizePoster(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith("http") ? src : `https://image.tmdb.org/t/p/w342${src}`;
}

// Färg som följer betyget: rött lågt, gult i mitten, grönt högt.
function ratingColor(n: number): string {
  if (n <= 3) return "text-rose-400";
  if (n <= 6) return "text-amber-300";
  return "text-emerald-400";
}
function ratingAccent(n: number): string {
  if (n <= 3) return "#fb7185"; // rose-400
  if (n <= 6) return "#fcd34d"; // amber-300
  return "#34d399"; // emerald-400
}

export default function RatingModal({
  open,
  item,
  heading = "Vad tyckte du?",
  skipLabel,
  saving = false,
  initialRating,
  onRate,
  onSkip,
  onRemove,
  removeLabel = "Ta bort betyg",
}: Props) {
  const t = useTranslations("modals");
  // null = användaren har inte rört slidern än (och inget förifyllt betyg finns).
  const [selected, setSelected] = useState<number | null>(initialRating ?? null);

  // Nollställ/förifyll när en ny titel visas.
  useEffect(() => {
    setSelected(initialRating ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.tmdbId, item?.mediaType]);

  const poster = normalizePoster(item?.poster);
  // Sliderns visuella läge — mittenvärde tills användaren väljer.
  const sliderValue = selected ?? 5;
  const accent = ratingAccent(sliderValue);
  // Fyll spåret fram till tummen (WebKit saknar inbyggd progress-styling).
  const pct = ((sliderValue - 1) / 9) * 100;

  // Samma rörelsespråk som Modal/TrailerModal: toning på backdrop, kritiskt
  // dämpad spring på panelen. Bara transform + opacity (GPU-komposit).
  return (
    <AnimatePresence>
      {open && item ? (
        <div key="rating-modal" className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            className="relative w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-neutral-900 p-6 text-center shadow-2xl"
            initial={{ scale: 0.94, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{heading}</p>

            <div className="flex items-center justify-center gap-3">
              {poster ? (
                <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10">
                  <Image src={poster} alt={item.title} fill sizes="56px" className="object-cover" />
                </div>
              ) : null}
              <div className="min-w-0 text-left">
                <div className="truncate text-base font-semibold text-white">{item.title}</div>
                {item.year ? <div className="text-sm text-neutral-400">{item.year}</div> : null}
              </div>
            </div>

            {/* Stor siffervisning + slider */}
            <div className="space-y-1">
              <div className="flex items-end justify-center gap-1">
                {selected !== null ? (
                  <>
                    <span className={`text-5xl font-black tabular-nums ${ratingColor(selected)}`}>
                      {selected}
                    </span>
                    <span className="pb-1 text-sm font-semibold text-neutral-500">/ 10</span>
                  </>
                ) : (
                  <span className="text-5xl font-black text-neutral-700">–</span>
                )}
              </div>

              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={sliderValue}
                disabled={saving}
                aria-label="Betyg 1 till 10"
                onChange={(e) => setSelected(Number(e.target.value))}
                className="nw-rating-slider w-full disabled:opacity-50"
                style={
                  {
                    background: `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`,
                    "--nw-slider-accent": accent,
                  } as React.CSSProperties
                }
              />
              <div className="flex justify-between px-0.5 text-[10px] font-medium text-neutral-500">
                <span>1</span>
                <span>10</span>
              </div>
            </div>

            <button
              type="button"
              disabled={saving || selected === null}
              onClick={() => {
                if (selected !== null) onRate(selected);
              }}
              className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving
                ? t("saving")
                : selected !== null
                ? t("saveRating", { value: selected })
                : t("dragToRate")}
            </button>

            {onRemove ? (
              <button
                type="button"
                disabled={saving}
                onClick={onRemove}
                className="w-full rounded-xl border border-rose-500/40 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
              >
                {removeLabel}
              </button>
            ) : null}

            <button
              type="button"
              disabled={saving}
              onClick={onSkip}
              className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300 disabled:opacity-50"
            >
              {skipLabel ?? t("skip")}
            </button>
          </motion.div>

          {/* Slider-tummen kan inte stylas med Tailwind-klasser — global CSS scoped på .nw-rating-slider. */}
          <style jsx global>{`
            .nw-rating-slider {
              -webkit-appearance: none;
              appearance: none;
              height: 8px;
              border-radius: 9999px;
              outline: none;
              cursor: pointer;
            }
            .nw-rating-slider::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 28px;
              height: 28px;
              border-radius: 9999px;
              background: var(--nw-slider-accent, #34d399);
              border: 3px solid #171717;
              box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
              transition: transform 0.1s ease;
            }
            .nw-rating-slider:active::-webkit-slider-thumb {
              transform: scale(1.15);
            }
            .nw-rating-slider::-moz-range-thumb {
              width: 28px;
              height: 28px;
              border-radius: 9999px;
              background: var(--nw-slider-accent, #34d399);
              border: 3px solid #171717;
              box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
            }
          `}</style>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
