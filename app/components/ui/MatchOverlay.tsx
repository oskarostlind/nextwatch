// app/components/ui/MatchOverlay.tsx
"use client";

// Delad matchruta för både gruppmatch och solo-toppmatch.
//
// Grupp: flera medlemmar har gillat samma titel — matchen kvitteras mot
// /api/group/match/ack så den inte visas igen.
// Solo: titeln passerade smaktröskeln (se lib/tasteFeature.ts) och firas direkt
// när användaren gillar den. Ingen ack — det finns inget delat tillstånd att
// kvittera, matchen är härledd ur kortet som just swipades.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Clapperboard, Info, Play, Sparkles, Undo2, Users } from "lucide-react";
import TrailerModal from "@/app/components/watch/TrailerModal";
import type { Trailer } from "@/lib/tmdbVideos";
import type { MatchEvidence } from "@/lib/tasteModel";
import { useTranslations } from "next-intl";

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
function evidencePhrase(
  e: MatchEvidence,
  mediaType: "movie" | "tv",
  t: (key: string, values?: Record<string, string>) => string
): string {
  switch (e.kind) {
    case "cast":
      return t("evidenceCast", { label: e.label });
    case "director":
      return mediaType === "tv"
        ? t("evidenceCreator", { label: e.label })
        : t("evidenceDirector", { label: e.label });
    case "keyword":
      return t("evidenceKeyword", { label: e.label });
    case "genre":
      return e.label;
  }
}

/** "A", "A och B", "A, B och C" */
/** "a, b och c" / "a, b and c" — bindeordet kommer från översättningen. */
function joinList(parts: string[], and: string): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
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

/*
 * Formspråk (del 8, 2026-10-15) — samma som nya flödets ✦-ytor:
 * - Riktig scrim: nästan ogenomskinlig + blur, så INGEN text bakom (progress-
 *   raden, "Har du konto? Logga in", toppraden) syns igenom och krockar med
 *   rubriken. z-[60] = över tabbraden (z-50) men under nya flödets ark
 *   (SaveSheet 68, PushAsk 70, SoftPaywall 72), Välj åt mig (65/70) och
 *   trailerspelaren (90), som alla kan öppnas ovanpå.
 * - Helskärmskolumn i tre lager: rubrik + motivering överst, affischen som
 *   hjälte i mitten (flex-1, krymper på små skärmar i stället för att trycka
 *   rubriken utanför), knapparna längst ner ovanför hemindikatorn.
 * - Sekundärknapparna: fyllning white/12 + kant white/36 på scrimmen →
 *   text 15:1 (sämsta fall, ljus affisch bakom scrimmen: 11:1), kant mot
 *   bakgrund ≥ 3,2:1 (WCAG 1.4.11), ikon + text, minst 56 px höga.
 */
const SCRIM = "rgba(7,8,12,0.9)";
const ACCENT = "linear-gradient(100deg,#22d3ee 0%,#a78bfa 100%)";

const SECONDARY_BTN =
  "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border border-white/[0.36] bg-white/[0.12] px-2 py-2 text-center text-[13px] font-semibold leading-tight text-white transition-colors hover:bg-white/[0.18] active:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";

export default function MatchOverlay({
  open,
  item,
  onClose,
  code,
  variant = "group",
  evidence,
  savedBy,
}: Props) {
  const t = useTranslations("match");
  const [flipped, setFlipped] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  // "Minska rörelse": ingen konfetti, ingen 3D-vändning, inga fjädrar — bara
  // toningar. Vändning och skalning är vestibulära rörelser.
  const reduce = useReducedMotion();

  const posterSrc = useMemo(() => normalizePoster(item?.poster), [item?.poster]);
  const titleLine = useMemo(() => {
    if (!item) return "";
    const y = item.year ? ` (${item.year})` : "";
    return `${item.title}${y}`;
  }, [item]);
  const rating = item?.rating !== undefined ? item.rating.toFixed(1) : undefined;
  const providers: ProviderLink[] = item?.providers ?? [];
  const hasTrailer = Boolean(item?.trailer);

  // Första providern är bästa valet: providerGroupsFor rankar streaming före
  // hyr/köp, och listan innehåller bara tjänster vi kan direktlänka till.
  const watch = providers[0] ?? null;

  const onFlip = useCallback(() => setFlipped((f) => !f), []);

  const close = useCallback(() => {
    // Stäng först: "Fortsätt swipa" ska aldrig vänta på nätverket. Ack:en är
    // best-effort ändå — värsta fall visas matchen en gång till.
    setFlipped(false);
    setTrailerOpen(false);
    onClose();

    // Bara gruppmatchen har något att kvittera.
    if (variant === "group" && item) {
      void fetch("/api/group/match/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, tmdbId: item.tmdbId, tmdbType: item.tmdbType }),
      }).catch(() => {});
    }
  }, [code, item, onClose, variant]);

  // Esc stänger på desktop. Trailerspelaren har en egen Esc-hantering — när den
  // är öppen stänger Esc bara den.
  useEffect(() => {
    if (!open || !item || trailerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, item, trailerOpen, close]);

  const heading = variant === "solo" ? t("headingSolo") : t("headingGroup");

  const reasonLine = useMemo(() => {
    if (variant !== "solo" || !evidence?.length || !item) return null;
    const phrases = evidence.slice(0, 2).map((e) => evidencePhrase(e, item.tmdbType, t));
    return t("youLike", { list: joinList(phrases, t("and")) });
  }, [variant, evidence, item, t]);

  /** "Oskar hade den redan i sin watchlist." — förklarar den snabba matchen. */
  const savedByLine = useMemo(() => {
    if (variant !== "group" || !savedBy?.length) return null;
    const names = joinList(savedBy.slice(0, 3), t("and"));
    return savedBy.length === 1
      ? t("savedByOne", { names })
      : t("savedByMany", { names });
  }, [variant, savedBy, t]);

  const subLine = reasonLine ?? savedByLine;

  if (typeof document === "undefined") return null;

  // Rörelse: fjädrar med lite studs vid entrén (Apple-känsla), ren toning vid
  // reduced motion. Stängning är alltid en snabb toning — ingen väntan.
  const enter = (delay: number, from: { y?: number; scale?: number } = {}) =>
    reduce
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.2, delay: delay * 0.5 },
        }
      : {
          initial: { opacity: 0, y: from.y ?? 0, scale: from.scale ?? 1 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { type: "spring" as const, stiffness: 320, damping: 26, mass: 0.9, delay },
        };

  // Framsida/baksida: 3D-vändning normalt, korstoning vid reduced motion.
  const faceBase =
    "absolute inset-0 overflow-hidden rounded-[22px] bg-[#101217] shadow-[0_0_0_1px_rgba(255,255,255,0.14)] [backface-visibility:hidden]";
  const faceAnim = reduce
    ? "transition-opacity duration-200"
    : "transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]";
  const frontState = reduce
    ? flipped
      ? "opacity-0 pointer-events-none"
      : "opacity-100"
    : flipped
      ? "rotate-y-180"
      : "rotate-y-0";
  const backState = reduce
    ? flipped
      ? "opacity-100"
      : "opacity-0 pointer-events-none"
    : flipped
      ? "rotate-y-0"
      : "rotate-y-180";

  const HeadIcon = variant === "solo" ? Sparkles : Users;
  const secondaryCols = hasTrailer ? "grid-cols-3" : "grid-cols-2";

  return createPortal(
    <>
      <AnimatePresence>
        {open && item ? (
          <motion.div
            key="match"
            aria-modal
            role="dialog"
            aria-labelledby="nw-match-heading"
            data-blocking-sheet
            className="fixed inset-0 z-[60] overflow-hidden backdrop-blur-xl backdrop-saturate-150"
            style={{ backgroundColor: SCRIM }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.15 : 0.22 }}
          >
            {/* Accentljus uppifrån — ger djup utan att sänka kontrasten där
                texten och knapparna ligger. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(90% 45% at 50% 0%, rgba(34,211,238,0.16) 0%, rgba(167,139,250,0.08) 45%, transparent 75%)",
              }}
            />

            {/* Klick på bakgrunden stänger */}
            <button
              type="button"
              aria-label={t("closeOverlay")}
              onClick={close}
              className="absolute inset-0 cursor-default"
            />

            <div
              className="pointer-events-none relative mx-auto flex h-full w-full max-w-sm flex-col px-5"
              style={{
                paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              }}
            >
              {/* 1. Rubrik + motivering */}
              <div className="relative flex shrink-0 flex-col items-center text-center">
                {!reduce ? <Confetti /> : null}
                <motion.div
                  {...enter(0.05, { y: -8, scale: 0.8 })}
                  className="mb-2.5 grid h-9 w-9 place-items-center rounded-full p-px"
                  style={{ background: ACCENT }}
                  aria-hidden
                >
                  <span className="grid h-full w-full place-items-center rounded-full bg-[#0b0d12]">
                    <HeadIcon className="h-[18px] w-[18px] text-cyan-200" />
                  </span>
                </motion.div>
                <motion.h2
                  id="nw-match-heading"
                  {...enter(0.1, { y: -10 })}
                  className="text-[26px] font-extrabold leading-[1.1] tracking-tight text-white"
                >
                  {heading}
                </motion.h2>
                {subLine ? (
                  <motion.p
                    {...enter(0.18, { y: -4 })}
                    className="mt-1.5 line-clamp-2 max-w-[22rem] text-[14.5px] leading-snug text-white/80"
                  >
                    {subLine}
                  </motion.p>
                ) : null}
              </div>

              {/* 2. Affischen som hjälte. Absolut inre yta = definierad höjd, så
                  aspect-ratio räknar bredden ur höjden och kortet krymper på
                  små skärmar i stället för att trycka ut rubrik/knappar. */}
              <div className="relative my-4 max-h-[576px] min-h-[200px] flex-1">
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    {...enter(0.08, { y: 18, scale: 0.92 })}
                    className="pointer-events-auto relative aspect-[2/3] h-full max-w-full cursor-pointer [perspective:1200px]"
                    onClick={onFlip}
                  >
                    {/* Mjuk glöd i accentfärgerna bakom kortet */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -inset-4 rounded-[36px] opacity-60 blur-2xl"
                      style={{ background: ACCENT }}
                    />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-[22px] shadow-[0_28px_60px_-18px_rgba(0,0,0,0.85)]"
                    />

                    {/* Framsida (bild) */}
                    <div
                      className={`${faceBase} ${faceAnim} ${frontState}`}
                      style={{ transformStyle: "preserve-3d" as const }}
                    >
                      {posterSrc ? (
                        <Image
                          src={posterSrc}
                          alt={item.title}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 90vw, 384px"
                          priority
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-neutral-800 text-neutral-300">
                          {t("noImage")}
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pb-4 pt-14">
                        <div className="text-[17px] font-bold leading-tight text-white">{titleLine}</div>
                        {rating ? (
                          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-xs font-semibold text-white ring-1 ring-white/15">
                            <span className="text-amber-300" aria-hidden>
                              ★
                            </span>
                            {rating}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Baksida (beskrivning + providers) */}
                    <div
                      className={`${faceBase} ${faceAnim} ${backState} p-4 text-white`}
                      style={{ transformStyle: "preserve-3d" as const }}
                    >
                      <div className="flex h-full flex-col">
                        <div className="mb-2 text-[15px] font-bold leading-tight">{titleLine}</div>
                        <div className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-700 grow overflow-auto overscroll-contain text-sm leading-relaxed text-white/85">
                          {item.overview ? (
                            <p className="whitespace-pre-line">{item.overview}</p>
                          ) : (
                            <p>{t("noDescription")}</p>
                          )}
                        </div>

                        {providers.length > 0 && (
                          <div className="mt-3">
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">
                              {t("availableOn")}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {providers.map((p) => (
                                <a
                                  key={p.name}
                                  href={p.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex min-h-[36px] items-center rounded-full border border-white/30 bg-white/[0.08] px-3 text-xs font-medium text-white hover:border-white/50 hover:bg-white/[0.14]"
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
                  </motion.div>
                </div>
              </div>

              {/* 3. Knappar: hjälte-CTA:n är själva poängen med matchen — se den.
                  Konkret tjänstenamn i knappen ("Kolla nu på Netflix" slår
                  "Kolla nu"). Utan tjänst tar "Fortsätt swipa" hjälteplatsen. */}
              <motion.div {...enter(0.22, { y: 10 })} className="pointer-events-auto flex shrink-0 flex-col gap-2.5">
                {watch ? (
                  <a
                    href={watch.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-bold text-neutral-950 shadow-[0_10px_30px_-10px_rgba(34,211,238,0.75)] transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{ background: ACCENT }}
                  >
                    <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
                    {t("watchNowOn", { provider: watch.name })}
                  </a>
                ) : null}

                <div className={`grid gap-2 ${watch ? secondaryCols : hasTrailer ? "grid-cols-2" : "grid-cols-1"}`}>
                  {hasTrailer ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTrailerOpen(true);
                      }}
                      className={SECONDARY_BTN}
                    >
                      <Clapperboard className="h-[18px] w-[18px] text-cyan-200" aria-hidden />
                      {t("trailer")}
                    </button>
                  ) : null}
                  <button type="button" onClick={onFlip} className={SECONDARY_BTN} aria-pressed={flipped}>
                    {flipped ? (
                      <Undo2 className="h-[18px] w-[18px] text-cyan-200" aria-hidden />
                    ) : (
                      <Info className="h-[18px] w-[18px] text-cyan-200" aria-hidden />
                    )}
                    {flipped ? t("front") : t("moreInfo")}
                  </button>
                  {watch ? (
                    <button type="button" onClick={close} className={SECONDARY_BTN}>
                      <Check className="h-[18px] w-[18px] text-cyan-200" aria-hidden />
                      {t("keepSwiping")}
                    </button>
                  ) : null}
                </div>

                {!watch ? (
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-bold text-neutral-950 shadow-[0_10px_30px_-10px_rgba(34,211,238,0.75)] transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{ background: ACCENT }}
                  >
                    <Check className="h-[18px] w-[18px]" aria-hidden />
                    {t("keepSwiping")}
                  </button>
                ) : null}
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {item ? (
        <TrailerModal
          open={open && trailerOpen}
          trailer={item.trailer}
          title={item.title}
          onClose={() => setTrailerOpen(false)}
        />
      ) : null}
    </>,
    document.body
  );
}
