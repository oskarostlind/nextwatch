// app/components/ui/MatchOverlay.tsx
"use client";

// Delad matchruta för både gruppmatch och solo-toppmatch.
//
// Grupp: flera medlemmar har gillat samma titel — matchen kvitteras mot
// /api/group/match/ack så den inte visas igen.
// Solo: titeln passerade smaktröskeln (se lib/tasteFeature.ts) och firas direkt
// när användaren gillar den. Ingen ack — det finns inget delat tillstånd att
// kvittera, matchen är härledd ur kortet som just swipades.

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, Play, Undo2 } from "lucide-react";
import TrailerButton from "@/app/components/watch/TrailerButton";
import type { Trailer } from "@/lib/tmdbVideos";
import type { MatchEvidence } from "@/lib/tasteModel";
import { BUTTON_VARIANTS } from "@/app/components/ui/kit";

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
  trailer?: Trailer | null;
};

type Props = {
  open: boolean;
  item?: GroupMatchItem | null;
  onClose: () => void;
  /** Gruppkod för ack (hämtas även server-side, men bra att skicka med). */
  code?: string;
  variant?: "group" | "solo";
  /** Solo: konkreta träffar bakom toppmatchen. Alltid icke-tom när satt. */
  evidence?: MatchEvidence[];
  /**
   * Grupp: medlemmar som redan hade titeln i sin watchlist. Visas först här,
   * aldrig under swipen — där skulle det styra röstningen och avslöja andras
   * listor i onödan.
   */
  savedBy?: string[];
};

function normalizePoster(src?: string): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("http")) return src;
  return `https://image.tmdb.org/t/p/w780${src}`;
}

/**
 * "skådespelaren Ryan Gosling" — kategorin måste med, annars går det inte att
 * skilja en skådespelare från ett tema i uppräkningen.
 */
function evidencePhrase(e: MatchEvidence, mediaType: "movie" | "tv"): string {
  switch (e.kind) {
    case "cast":
      return `skådespelaren ${e.label}`;
    case "director":
      return mediaType === "tv" ? `skaparen ${e.label}` : `regissören ${e.label}`;
    case "keyword":
      return `teman som ${e.label}`;
    case "genre":
      return e.label;
  }
}

/** "A", "A och B", "A, B och C" */
function joinSv(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} och ${parts[parts.length - 1]}`;
}

/* Konfetti: statiska vinklar/färger så partiklarna inte hoppar vid re-render. */
const CONFETTI = [
  { angle: -70, color: "#22d3ee", delay: 0 },
  { angle: -35, color: "#a78bfa", delay: 0.04 },
  { angle: -5, color: "#34d399", delay: 0.08 },
  { angle: 25, color: "#fbbf24", delay: 0.02 },
  { angle: 60, color: "#f472b6", delay: 0.06 },
  { angle: 95, color: "#22d3ee", delay: 0.1 },
  { angle: -110, color: "#fbbf24", delay: 0.05 },
  { angle: 130, color: "#a78bfa", delay: 0.09 },
];

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden>
      {CONFETTI.map((c, i) => {
        const rad = (c.angle * Math.PI) / 180;
        return (
          <motion.span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-sm"
            style={{ backgroundColor: c.color }}
            initial={{ opacity: 1, x: 0, y: 0, scale: 0 }}
            animate={{
              opacity: [1, 1, 0],
              x: Math.cos(rad) * 130,
              y: Math.sin(rad) * 90 + 60,
              scale: [0, 1, 0.8],
              rotate: c.angle * 2,
            }}
            transition={{ duration: 1.1, delay: 0.12 + c.delay, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

export default function MatchOverlay({
  open,
  item,
  onClose,
  code,
  variant = "group",
  evidence,
  savedBy,
}: Props) {
  const [flipped, setFlipped] = useState(false);

  const posterSrc = useMemo(() => normalizePoster(item?.poster), [item?.poster]);
  const titleLine = useMemo(() => {
    if (!item) return "";
    const y = item.year ? ` (${item.year})` : "";
    return `${item.title}${y}`;
  }, [item]);
  const rating = item?.rating !== undefined ? item.rating.toFixed(1) : undefined;
  const providers: ProviderLink[] = item?.providers ?? [];

  // Första providern är bästa valet: providerGroupsFor rankar streaming före
  // hyr/köp, och listan innehåller bara tjänster vi kan direktlänka till.
  const watch = providers[0] ?? null;

  const onFlip = useCallback(() => setFlipped((f) => !f), []);

  const close = useCallback(async () => {
    try {
      // Bara gruppmatchen har något att kvittera.
      if (variant === "group" && item) {
        await fetch("/api/group/match/ack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, tmdbId: item.tmdbId, tmdbType: item.tmdbType }),
        });
      }
    } catch {
      // tyst
    } finally {
      setFlipped(false);
      onClose();
    }
  }, [code, item, onClose, variant]);

  const heading = variant === "solo" ? "Toppmatch för dig!" : "Gruppmatch!";

  const reasonLine = useMemo(() => {
    if (variant !== "solo" || !evidence?.length || !item) return null;
    const phrases = evidence.slice(0, 2).map((e) => evidencePhrase(e, item.tmdbType));
    return `Du gillar ${joinSv(phrases)}.`;
  }, [variant, evidence, item]);

  /** "Oskar hade den redan i sin watchlist." — förklarar den snabba matchen. */
  const savedByLine = useMemo(() => {
    if (variant !== "group" || !savedBy?.length) return null;
    const namn = joinSv(savedBy.slice(0, 3));
    return savedBy.length === 1
      ? `${namn} hade den redan i sin watchlist.`
      : `${namn} hade den redan i sina watchlists.`;
  }, [variant, savedBy]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && item ? (
        <motion.div
          key="match"
          aria-modal
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Klick utanför kortet stänger */}
          <button aria-label="Close overlay" onClick={close} className="absolute inset-0" />

          <motion.div
            className="relative mx-4 w-full max-w-sm"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
            initial={{ scale: 0.85, y: 32, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22, mass: 0.9 }}
          >
            <div className="relative">
              <Confetti />
              <motion.div
                className="mb-2 text-center text-base font-bold tracking-tight text-white"
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.12, type: "spring", stiffness: 300, damping: 18 }}
              >
                {heading}
              </motion.div>
            </div>

            {reasonLine ? (
              <motion.div
                className="mb-2 text-center text-xs text-white/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.22 }}
              >
                {reasonLine}
              </motion.div>
            ) : null}

            {savedByLine ? (
              <motion.div
                className="mb-2 text-center text-xs text-white/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.22 }}
              >
                {savedByLine}
              </motion.div>
            ) : null}

            <div
              className="group relative h-[62vh] w-full cursor-pointer [perspective:1200px]"
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

            <motion.div
              className="pointer-events-auto mt-3 grid gap-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
            >
              {/* Hjälte-CTA:n är själva poängen med matchen: se den. Konkret
                  tjänstenamn i knappen — "Kolla nu på Netflix" slår "Kolla nu". */}
              {watch ? (
                <a
                  href={watch.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-[15px] font-semibold text-black shadow-[0_8px_24px_-8px_rgba(34,211,238,0.7)] transition hover:bg-cyan-400 active:scale-[0.98]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Kolla nu på {watch.name}
                </a>
              ) : null}

              {/* Sekundära knappar delar en och samma stil (kit.tsx:s
                  BUTTON_VARIANTS.secondary) så Trailer/Mer info/Fortsätt swipa
                  läses som en enhetlig rad under hjälte-CTA:n, i stället för
                  tre olika grå/vita/emerald-nyanser som tidigare. */}
              <div className="flex flex-wrap justify-center gap-2">
                <TrailerButton trailer={item.trailer} title={item.title} variant="solid" />
                <button
                  type="button"
                  onClick={onFlip}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${BUTTON_VARIANTS.secondary}`}
                >
                  {flipped ? <Undo2 className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                  {flipped ? "Framsida" : "Mer info"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${BUTTON_VARIANTS.secondary}`}
                >
                  <Check className="h-4 w-4" />
                  Fortsätt swipa
                </button>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
