"use client";

// Betygs-popup (1–10) som återanvänds på flera ställen:
// 1) /swipe: när användaren swipear upp ("Sett") på ett kort.
// 2) OverlayMount: "betygsätt er tidigare gruppmatch" vid app-öppning.
// 3) /watchlist (Betyg-fliken): ändra/ta bort ett befintligt betyg.
// 4) Välj åt mig-detaljarket, gruppleken, Upptäck och swipe-genomgången.
// Komponenten är medvetet dum — den vet inget om API:er; föräldern
// hanterar spara/hoppa över/ta bort via onRate/onSkip/onRemove.
//
// 2026-10-15: nya flödets formspråk — mörkt glasark (28 px), tunn kant
// white/10, accent cyan → violett. Slidern ersattes av tio stora knappar
// (≥ 44 px, radiogrupp med piltangenter): en slider kräver precision och
// krockade med swipe-gesten som just öppnat arket. På mobil reser arket sig
// nerifrån — samma riktning som swipen uppåt ("Sett") som öppnade det.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function normalizePoster(src?: string | null): string | null {
  if (!src) return null;
  return src.startsWith("http") ? src : `https://image.tmdb.org/t/p/w342${src}`;
}

export default function RatingModal({
  open,
  item,
  heading,
  skipLabel,
  saving = false,
  initialRating,
  onRate,
  onSkip,
  onRemove,
  removeLabel,
}: Props) {
  const t = useTranslations("modals");
  const reduce = useReducedMotion();
  const titleId = useId();
  // null = användaren har inte valt något än (och inget förifyllt betyg finns).
  const [selected, setSelected] = useState<number | null>(initialRating ?? null);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Nollställ/förifyll när en ny titel visas.
  useEffect(() => {
    setSelected(initialRating ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.tmdbId, item?.mediaType]);

  const poster = normalizePoster(item?.poster);

  // Radiogruppens tangentbordsstyrning (WAI-ARIA): piltangenter flyttar valet,
  // Home/End hoppar till 1/10. Bara det valda (eller första) värdet är i tabbordningen.
  function onGroupKey(e: KeyboardEvent<HTMLDivElement>) {
    if (saving) return;
    const cur = selected ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(10, cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(1, cur - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 10;
    if (next === null) return;
    e.preventDefault();
    setSelected(next);
    buttonsRef.current[next - 1]?.focus();
  }

  // Rörelse: tonad bakgrund + kritiskt dämpad fjäder (ingen studs — arket
  // öppnas av en färdig gest, inte av ett kast). Arket kommer nerifrån och
  // går tillbaka samma väg. Minskad rörelse → bara toning.
  const sheetMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 48, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 48, scale: 0.98 },
      };

  return (
    <AnimatePresence>
      {open && item ? (
        <div
          key="rating-modal"
          className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center sm:p-6"
        >
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative w-full max-w-sm overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/90 px-5 pt-5 text-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5"
            {...sheetMotion}
            transition={reduce ? { duration: 0.18 } : { type: "spring", bounce: 0, duration: 0.4 }}
          >
            {/* Accent: tunn cyan→violett ljuskant överst + mjukt sken bakom rubriken. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(34,211,238,0.16),rgba(167,139,250,0.10),transparent)]"
            />

            {/* Affisch + titel överst */}
            <div className="relative flex items-center gap-4">
              {poster ? (
                <div className="relative h-[108px] w-[72px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)]">
                  <Image src={poster} alt="" fill sizes="72px" className="object-cover" />
                </div>
              ) : null}
              <div className="min-w-0 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                  {heading ?? t("ratingHeading")}
                </p>
                <h2 id={titleId} className="mt-1 line-clamp-2 text-lg font-semibold leading-snug tracking-[-0.01em]">
                  {item.title}
                </h2>
                {item.year ? <p className="mt-0.5 text-sm text-white/65">{item.year}</p> : null}
              </div>
            </div>

            {/* Valt betyg, stort */}
            <div className="relative mt-5 flex h-14 items-end justify-center gap-1" aria-live="polite">
              {selected !== null ? (
                <>
                  <span className="bg-gradient-to-br from-cyan-300 to-violet-300 bg-clip-text text-5xl font-black leading-none tabular-nums text-transparent">
                    {selected}
                  </span>
                  <span className="pb-1 text-sm font-semibold text-white/55">/ 10</span>
                </>
              ) : (
                <span className="pb-1 text-sm font-medium text-white/70">{t("pickToRate")}</span>
              )}
            </div>

            {/* Betygsval 1–10: stora knappar, tydligt valt läge, värden under
                valet fylls svagt så skalan läses som en stapel. */}
            <div
              role="radiogroup"
              aria-label={t("ratingSliderAria")}
              onKeyDown={onGroupKey}
              className="relative mt-3 grid grid-cols-5 gap-2"
            >
              {VALUES.map((n) => {
                const isSel = selected === n;
                const below = selected !== null && n < selected;
                return (
                  <button
                    key={n}
                    ref={(el) => {
                      buttonsRef.current[n - 1] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    tabIndex={isSel || (selected === null && n === 1) ? 0 : -1}
                    disabled={saving}
                    onClick={() => setSelected(n)}
                    className={`flex h-12 items-center justify-center rounded-2xl border text-lg font-bold tabular-nums transition-[transform,background-color,border-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50 ${
                      isSel
                        ? "border-transparent bg-gradient-to-br from-cyan-400 to-violet-400 text-neutral-950 shadow-[0_8px_20px_-8px_rgba(34,211,238,0.7)]"
                        : below
                        ? "border-cyan-300/30 bg-cyan-300/10 text-white"
                        : "border-white/10 bg-white/[0.06] text-white/90 hover:bg-white/10"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between px-1 text-[11px] font-medium text-white/65">
              <span>{t("ratingLow")}</span>
              <span>{t("ratingHigh")}</span>
            </div>

            <div className="relative mt-5 space-y-2">
              <button
                type="button"
                disabled={saving || selected === null}
                onClick={() => {
                  if (selected !== null) onRate(selected);
                }}
                className="min-h-[52px] w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-400 px-4 font-semibold text-neutral-950 shadow-[0_10px_28px_-10px_rgba(167,139,250,0.7)] transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-40 disabled:shadow-none"
              >
                {saving
                  ? t("saving")
                  : selected !== null
                  ? t("saveRating", { value: selected })
                  : t("pickToRate")}
              </button>

              {onRemove ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={onRemove}
                  className="min-h-11 w-full rounded-2xl border border-rose-400/40 px-4 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 active:scale-[0.98] disabled:opacity-50"
                >
                  {removeLabel ?? t("removeRating")}
                </button>
              ) : null}

              <button
                type="button"
                disabled={saving}
                onClick={onSkip}
                className="min-h-11 w-full rounded-2xl px-4 text-sm font-semibold text-white/80 transition hover:bg-white/5 hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50"
              >
                {skipLabel ?? t("skip")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
