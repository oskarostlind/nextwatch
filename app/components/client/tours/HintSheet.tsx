"use client";

// Presentationslagret för alla coach-hintar: ett BOTTENARK, aldrig en modal
// mitt på skärmen.
//
// Varför: de gamla hintarna renderades som en ruta centrerad i viewporten (och
// ibland utan mål alls, ovanpå ett nästan svart lager). På mobil hamnade de
// mitt över innehållet man just skulle titta på, långt från tummen, och de såg
// ut som fellagda dialoger snarare än som en del av appen.
//
// Det här arket:
//   - ligger i tumzonen, precis ovanför tabbraden ([data-app-tabs]) och alltid
//     innanför safe-area,
//   - lämnar det utpekade elementet SYNLIGT (mjuk mörkläggning med hål + ring
//     med puls i stället för svart skärm),
//   - går att svepa ner eller trycka bredvid för att stänga,
//   - animeras med samma dämpade fjäder som resten av appen (och följer
//     "Minska rörelse" via MotionConfig i AppShell).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Check, Compass, Home, User, Users } from "lucide-react";
import type { CoachListIcon } from "@/lib/tours/types";

type Rect = { top: number; left: number; width: number; height: number };

const LIST_ICONS: Record<CoachListIcon, typeof Home> = {
  swipe: Home,
  group: Users,
  discover: Compass,
  watchlist: Bookmark,
  profile: User,
  check: Check,
};

/** Höjd på tabbraden + safe-area, så arket aldrig hamnar under den. */
function bottomInset(): number {
  if (typeof window === "undefined") return 84;
  const tabs = document.querySelector("[data-app-tabs]");
  if (tabs) {
    const r = tabs.getBoundingClientRect();
    if (r.height > 0) return Math.max(64, window.innerHeight - r.top);
  }
  return 84;
}

function measure(el: Element | null, pad = 10): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

/**
 * Mörkläggning med ett rektangulärt hål. En enda polygon som går runt hela
 * viewporten och sedan "in" i hålet — samma trick som en evenodd-mask, fast
 * med clip-path så det funkar i WKWebView utan extra lager.
 */
function scrimClipPath(spot: Rect): string {
  const r = spot.left + spot.width;
  const b = spot.top + spot.height;
  return [
    "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0",
    `${spot.left}px ${spot.top}px`,
    `${spot.left}px ${b}px`,
    `${r}px ${b}px`,
    `${r}px ${spot.top}px`,
    `${spot.left}px ${spot.top}px)`,
  ].join(", ");
}

export type HintSheetProps = {
  /** data-tour-värde. Utelämnat = ark utan utpekat element (fortfarande ark, inte modal). */
  targetSelector?: string;
  title: string;
  body: string;
  list?: Array<{ icon: CoachListIcon; label: string }>;
  index: number;
  total: number;
  nextLabel: string;
  skipLabel: string;
  onNext: () => void;
  /** Utelämnad = ingen "Hoppa över"-knapp (arket har ändå svep-ner + tryck bredvid). */
  onSkip?: () => void;
};

export default function HintSheet({
  targetSelector,
  title,
  body,
  list,
  index,
  total,
  nextLabel,
  skipLabel,
  onNext,
  onSkip,
}: HintSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [inset, setInset] = useState(84);
  const scrolled = useRef<string | null>(null);

  const reposition = useCallback(() => {
    setInset(bottomInset());
    if (!targetSelector) {
      setSpot(null);
      return;
    }
    setSpot(measure(document.querySelector(`[data-tour="${targetSelector}"]`)));
  }, [targetSelector]);

  useEffect(() => setMounted(true), []);

  // Rulla fram målet en gång per steg — en hint som pekar på något utanför
  // skärmen är värdelös. Fasta element (tabbraden) rör sig inte, och då är
  // scrollIntoView en no-op, vilket är precis rätt.
  useEffect(() => {
    if (!targetSelector || scrolled.current === targetSelector) return;
    scrolled.current = targetSelector;
    const el = document.querySelector(`[data-tour="${targetSelector}"]`);
    if (el) {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        /* äldre WebView utan options-varianten */
      }
    }
    const t = window.setTimeout(reposition, 380);
    return () => window.clearTimeout(t);
  }, [targetSelector, reposition]);

  useEffect(() => {
    reposition();
    const onChange = () => reposition();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    // Layouten sätter sig ofta en tick efter mount (bilder, fonter, flikpiller).
    const raf = window.requestAnimationFrame(onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      window.cancelAnimationFrame(raf);
    };
  }, [reposition]);

  const dismiss = onSkip ?? onNext;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      <div key="hint-sheet" className="fixed inset-0 z-[70]" role="dialog" aria-modal aria-label={title}>
        {/* Mörkläggning. Betydligt lättare än den gamla 78 %-svarta skärmen:
            man ska kunna se appen bakom och förstå VAD hinten pekar på. */}
        <motion.button
          type="button"
          aria-label={skipLabel}
          onClick={dismiss}
          className="absolute inset-0 h-full w-full cursor-default bg-black/45"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={spot ? { clipPath: scrimClipPath(spot) } : undefined}
        />

        {spot ? (
          <>
            <motion.div
              className="pointer-events-none absolute rounded-2xl ring-2 ring-cyan-400"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 30 }}
              style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
            />
            {/* Puls — drar blicken utan att blinka. Bara transform/opacity. */}
            <motion.div
              className="pointer-events-none absolute rounded-2xl ring-2 ring-cyan-400/70"
              animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.05, 1] }}
              transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
              style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
            />
          </>
        ) : null}

        <motion.div
          className="absolute left-1/2 w-full max-w-md px-3"
          style={{ bottom: inset + 16 }}
          initial={{ y: 40, opacity: 0, x: "-50%" }}
          animate={{ y: 0, opacity: 1, x: "-50%" }}
          exit={{ y: 30, opacity: 0, x: "-50%" }}
          transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.9 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 70 || info.velocity.y > 550) dismiss();
          }}
        >
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/95 shadow-[0_18px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl">
            {/* Draghandtag: signalerar "det här går att svepa bort". */}
            <div className="flex cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing">
              <span className="h-1 w-9 rounded-full bg-white/20" />
            </div>

            <div className="px-5 pb-5 pt-1">
              {total > 1 ? (
                <div className="mb-3 flex items-center gap-1.5">
                  {Array.from({ length: total }).map((_, i) => (
                    <span
                      key={i}
                      className={
                        i === index
                          ? "h-1.5 w-5 rounded-full bg-cyan-400 transition-all"
                          : "h-1.5 w-1.5 rounded-full bg-white/20 transition-all"
                      }
                    />
                  ))}
                </div>
              ) : null}

              <h3 className="text-[17px] font-semibold leading-snug text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-300">{body}</p>

              {list?.length ? (
                <ul className="mt-3 space-y-2">
                  {list.map((row, i) => {
                    const Icon = LIST_ICONS[row.icon];
                    return (
                      <motion.li
                        key={row.label}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.06 * i + 0.08, duration: 0.24 }}
                        className="flex items-center gap-2.5 text-sm text-neutral-300"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-cyan-300">
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="min-w-0">{row.label}</span>
                      </motion.li>
                    );
                  })}
                </ul>
              ) : null}

              <div className="mt-5 flex items-center gap-3">
                {onSkip ? (
                  <button
                    type="button"
                    onClick={onSkip}
                    className="shrink-0 px-1 py-2 text-sm text-neutral-400 transition hover:text-white"
                  >
                    {skipLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onNext}
                  className="ml-auto rounded-2xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400 active:scale-[0.97]"
                >
                  {nextLabel}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
