"use client";

// Swipe-genomgången: fyra gated gesture-practice-kort som lär ut
// gilla/ogilla/info/sett+betygsätt — inramade av en intro som förklarar VARFÖR
// svepen spelar roll och en sammanfattning som repeterar alla gester.
//
// Sista praktikkortet (svep upp) kör det RIKTIGA sett+betygsätt-flödet mot en
// känd exempeltitel (Inception) — samma /api/rate + /api/ratings/save +
// RatingModal som den riktiga swipen använder — så användaren faktiskt gör
// hela flödet en gång, betyg inkluderat.
//
// Återanvänder StaticCard/SwipeStampOverlays/fetchDetailsWithFallback/
// fetchWatchProviders från app/swipe/page_client.tsx i stället för att bygga
// ett andra kort — praktikkorten ser därför ut exakt som riktiga swipekort.
//
// Visas via app/swipe/page.tsx (server-komponenten), som ett syskon till
// <Client /> — INTE importerad av page_client.tsx själv. Det håller den
// riktiga swipe/rating-koden helt orörd och undviker en cirkulär import
// (den här filen importerar ju namngivna exports FRÅN page_client.tsx).
//
// ---------------------------------------------------------------------------
// Varje steg visar TRE saker, i den ordningen:
//   1. gesten  — vad man ska göra (GestureHint + stämplarna på kortet)
//   2. följden — vad appen gör med den (t.ex. "sparas i din watchlist")
//   3. algoritmen — hur svepet påverkar KOMMANDE rekommendationer
// Punkt 3 är hela poängen: mätaren högst upp fylls på för varje utförd gest,
// och en liten effekt-bricka flyger upp i den när gesten bekräftas, så
// kopplingen svep → smakprofil → flöde blir något man ser hända.
// Texterna måste matcha den faktiska koden (page_client.tsx handleLike/
// handleDislike/handleSeen + lib/unifiedRecs.ts) — ändras beteendet ska
// messages/{sv,en}.json ändras i samma commit.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useAnimation, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUp, Check, Pointer, Sparkles } from "lucide-react";
import {
  StaticCard,
  SwipeStampOverlays,
  fetchDetailsWithFallback,
  fetchWatchProviders,
  type Card,
} from "@/app/swipe/page_client";
import RatingModal from "@/app/components/client/RatingModal";
import { notify } from "@/app/components/lib/notify";
import { useTourGate } from "@/lib/tours/useTourGate";
import type { GestureType } from "@/lib/tours/types";
import GestureHint from "./GestureHint";
import { useTranslations } from "next-intl";

const TOUR_ID = "swipe-gestures" as const;

// Ett stort, allmänt känt exempel — så steg 4 (sett + betygsätt) känns som en
// riktig titel man faktiskt kan ha en åsikt om, inte en påhittad platshållare.
const DEMO_MOVIE = { tmdbId: 27205, mediaType: "movie" as const, title: "Inception", year: "2010" };

/** label/hint/algo slås upp i messages/*.json som gestureTour.<id>.*. */
type Step = { id: string; gesture: GestureType; tone: "like" | "nope" | "seen" | "info" };

const STEPS: Step[] = [
  { id: "like", gesture: "swipe-right", tone: "like" },
  { id: "dislike", gesture: "swipe-left", tone: "nope" },
  { id: "info", gesture: "tap", tone: "info" },
  { id: "seen", gesture: "swipe-up", tone: "seen" },
];

const TONE_TEXT: Record<Step["tone"], string> = {
  like: "text-emerald-400",
  nope: "text-rose-400",
  seen: "text-cyan-300",
  info: "text-amber-300",
};

const TONE_RING: Record<Step["tone"], string> = {
  like: "border-emerald-400/60 bg-emerald-400/10",
  nope: "border-rose-400/60 bg-rose-400/10",
  seen: "border-cyan-400/60 bg-cyan-400/10",
  info: "border-amber-400/60 bg-amber-400/10",
};

function StepIcon({ gesture, className }: { gesture: GestureType; className?: string }) {
  if (gesture === "swipe-right") return <ArrowRight className={className} strokeWidth={2.5} />;
  if (gesture === "swipe-left") return <ArrowLeft className={className} strokeWidth={2.5} />;
  if (gesture === "swipe-up") return <ArrowUp className={className} strokeWidth={2.5} />;
  return <Pointer className={className} strokeWidth={2.5} />;
}

const DIST_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 700;

export default function SwipeGestureTour() {
  const t = useTranslations("gestureTour");
  const { state, complete, skip } = useTourGate(TOUR_ID, { delayMs: 200 });
  const [mounted, setMounted] = useState(false);
  const [demoCard, setDemoCard] = useState<Card | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"intro" | "active" | "rating" | "summary">("intro");
  const [ratingSaving, setRatingSaving] = useState(false);
  const ratedRef = useRef(false);
  // Låser gestkontrollen från det ögonblick den bekräftas till nästa steg —
  // annars kan ett andra tryck under tap-stegets fördröjda "titta på baksidan"-
  // paus (innan `confirming` sätts) trigga onGestureConfirmed två gånger.
  const advancingRef = useRef(false);

  const controls = useAnimation();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const likeOpacity = useTransform(x, [48, 150], [0, 1]);
  const nopeOpacity = useTransform(x, [-150, -48], [1, 0]);
  const seenOpacity = useTransform(y, [-120, -36], [1, 0]);
  const seenScale = useTransform(y, [-120, -36], [0.88, 1.06]);
  const seenRotate = useTransform(y, [-120, -36], [-6, 0]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (state !== "show") return;
    let ignore = false;
    void fetchDetailsWithFallback("movie", DEMO_MOVIE.tmdbId).then((det) => {
      if (ignore) return;
      setDemoCard({
        id: `movie_${DEMO_MOVIE.tmdbId}`,
        tmdbId: DEMO_MOVIE.tmdbId,
        mediaType: "movie",
        title: det?.title || DEMO_MOVIE.title,
        year: det?.year ?? DEMO_MOVIE.year,
        poster: det?.poster ?? null,
        backdrop: det?.backdrop ?? null,
        overview: det?.overview ?? null,
        rating: det?.rating ?? null,
        genres: det?.genres ?? [],
      });
    });
    void fetchWatchProviders("movie", DEMO_MOVIE.tmdbId).then((providers) => {
      if (ignore) return;
      setDemoCard((prev) => (prev ? { ...prev, providers } : prev));
    });
    return () => {
      ignore = true;
    };
  }, [state]);

  useEffect(() => {
    advancingRef.current = false;
  }, [stepIndex]);

  if (!mounted || state !== "show") return null;

  const step = STEPS[stepIndex];
  const doneCount = Math.min(stepIndex, STEPS.length);
  const meterPct = Math.round((doneCount / STEPS.length) * 100);

  function resetCardPosition() {
    x.set(0);
    y.set(0);
    controls.set({ x: 0, y: 0, opacity: 1 });
  }

  function finishTour(status: "completed" | "skipped") {
    if (status === "completed") complete();
    else skip();
  }

  async function beginSeenFlow() {
    if (!demoCard) return;
    void fetch("/api/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: demoCard.tmdbId, mediaType: demoCard.mediaType, decision: "seen" }),
    }).catch(() => {
      /* best-effort, samma som riktiga swipen */
    });
    setStepIndex(STEPS.length);
    setPhase("rating");
  }

  function onGestureConfirmed() {
    if (advancingRef.current) return;
    advancingRef.current = true;

    if (step.gesture === "swipe-up") {
      setConfirming(true);
      void controls.start({ y: -760, opacity: 0, transition: { duration: 0.22 } }).then(() => {
        void beginSeenFlow();
      });
      return;
    }

    if (step.gesture === "tap") {
      // Kortet är redan vänt (handleCardTap satte flipped=true) — låt
      // användaren faktiskt SE baksidan (den riktiga detaljvyn) en stund
      // innan bekräftelsen, annars hinner de aldrig se vad en tryckning gör.
      window.setTimeout(() => {
        setConfirming(true);
        window.setTimeout(() => {
          setConfirming(false);
          setFlipped(false);
          window.setTimeout(() => setStepIndex((i) => i + 1), 300);
        }, 900);
      }, 1100);
      return;
    }

    setConfirming(true);
    const target = step.gesture === "swipe-right" ? { x: 560, opacity: 0 } : { x: -560, opacity: 0 };
    void controls.start({ ...target, transition: { duration: 0.22 } }).then(() => {
      resetCardPosition();
      setFlipped(false);
      window.setTimeout(() => {
        setConfirming(false);
        setStepIndex((i) => i + 1);
      }, 550);
    });
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (confirming || step.gesture === "tap") return;
    const { offset, velocity } = info;
    const up =
      (offset.y < -DIST_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD) && Math.abs(offset.y) > Math.abs(offset.x);
    const right = offset.x > DIST_THRESHOLD || velocity.x > VELOCITY_THRESHOLD;
    const left = offset.x < -DIST_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD;
    const detected: GestureType | null = up ? "swipe-up" : right ? "swipe-right" : left ? "swipe-left" : null;
    if (detected && detected === step.gesture) {
      onGestureConfirmed();
    } else {
      void controls.start({ x: 0, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } });
    }
  }

  function handleCardTap() {
    if (confirming || step.gesture !== "tap") {
      setFlipped((f) => !f);
      return;
    }
    setFlipped(true);
    onGestureConfirmed();
  }

  function submitRating(rating: number) {
    if (!demoCard) return;
    setRatingSaving(true);
    void fetch("/api/ratings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tmdbId: demoCard.tmdbId, mediaType: demoCard.mediaType, rating }),
    })
      .then((res) => {
        if (!res.ok) notify("Kunde inte spara betyget");
        else ratedRef.current = true;
      })
      .catch(() => notify("Kunde inte spara betyget"))
      .finally(() => {
        setRatingSaving(false);
        setPhase("summary");
      });
  }

  function skipRating() {
    // Ett sätt ut ur betygspopupen utan att låsa in användaren. Genomgången
    // räknas som "skipped" i statusen, men sammanfattningen visas ändå — den
    // är den enda platsen alla fyra gester repeteras samlat.
    setPhase("summary");
  }

  /* ---------------- intro ---------------- */

  if (phase === "intro") {
    return createPortal(
      <div className="fixed inset-0 z-[75] flex flex-col bg-neutral-950" role="dialog" aria-modal>
        <div className="flex justify-end px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <button
            type="button"
            onClick={() => finishTour("skipped")}
            className="text-xs text-white/40 underline underline-offset-2 transition hover:text-white/70"
          >
            {t("skip")}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-7 text-center">
          <IntroAnimation />
          <div>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35 }}
              className="text-[26px] font-bold leading-tight text-white"
            >
              {t("intro.title")}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.35 }}
              className="mx-auto mt-3 max-w-[19rem] text-sm leading-relaxed text-white/60"
            >
              {t("intro.body")}
            </motion.p>
          </div>
        </div>

        <div className="px-6 pb-[calc(env(safe-area-inset-bottom)+22px)]">
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.35 }}
            onClick={() => setPhase("active")}
            className="w-full rounded-2xl bg-cyan-500 py-3.5 text-[15px] font-semibold text-black transition hover:bg-cyan-400 active:scale-[0.98]"
          >
            {t("intro.cta")}
          </motion.button>
        </div>
      </div>,
      document.body
    );
  }

  /* ---------------- betyg ---------------- */

  if (phase === "rating" && demoCard) {
    return createPortal(
      <RatingModal
        open
        item={{
          tmdbId: demoCard.tmdbId,
          mediaType: demoCard.mediaType,
          title: demoCard.title,
          year: demoCard.year,
          poster: demoCard.poster,
        }}
        heading="Snyggt! Vad tyckte du?"
        saving={ratingSaving}
        onRate={submitRating}
        onSkip={skipRating}
      />,
      document.body
    );
  }

  /* ---------------- sammanfattning ---------------- */

  if (phase === "summary") {
    return createPortal(
      <div className="fixed inset-0 z-[75] flex flex-col bg-neutral-950" role="dialog" aria-modal>
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-6 pt-[calc(env(safe-area-inset-top)+24px)]">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400"
          >
            <Check className="h-7 w-7" strokeWidth={3} />
          </motion.div>
          <h2 className="mt-4 text-center text-2xl font-bold text-white">{t("summary.title")}</h2>
          <p className="mx-auto mt-2 max-w-[20rem] text-center text-sm leading-relaxed text-white/60">
            {t("summary.body")}
          </p>

          <ul className="mt-6 space-y-2.5">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08 * i + 0.15, duration: 0.28 }}
                className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3"
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${TONE_RING[s.tone]}`}
                >
                  <StepIcon gesture={s.gesture} className={`h-4 w-4 ${TONE_TEXT[s.tone]}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{t(`${s.id}.label`)}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-white/55">{t(`${s.id}.algo`)}</span>
                </span>
              </motion.li>
            ))}
          </ul>

          <p className="mt-4 text-center text-xs leading-relaxed text-white/40">{t("summary.buttons")}</p>
        </div>

        <div className="px-6 pb-[calc(env(safe-area-inset-bottom)+22px)] pt-4">
          <button
            type="button"
            onClick={() => finishTour(ratedRef.current ? "completed" : "skipped")}
            className="w-full rounded-2xl bg-cyan-500 py-3.5 text-[15px] font-semibold text-black transition hover:bg-cyan-400 active:scale-[0.98]"
          >
            {t("summary.cta")}
          </button>
        </div>
      </div>,
      document.body
    );
  }

  /* ---------------- praktik ---------------- */

  if (!demoCard || !step) return null;

  return createPortal(
    <div className="fixed inset-0 z-[75] flex flex-col bg-black/92 backdrop-blur-sm" role="dialog" aria-modal>
      <div className="px-5 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-cyan-400/80">
            {t("progress", { step: stepIndex + 1, total: STEPS.length })}
          </p>
          <button
            type="button"
            onClick={() => finishTour("skipped")}
            className="text-xs text-white/40 underline underline-offset-2 transition hover:text-white/70"
          >
            {t("skip")}
          </button>
        </div>

        {/* Smakprofil-mätaren: den synliga kopplingen mellan gest och algoritm. */}
        <div className="mt-2.5 flex items-center gap-2.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-300" strokeWidth={2.5} />
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
              animate={{ width: `${meterPct}%` }}
              transition={{ type: "spring", stiffness: 180, damping: 26 }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/45">
            {t("meter.label")}
          </span>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="relative aspect-[2/3] w-full max-w-[300px]">
          <motion.div
            className="absolute inset-0 touch-none"
            style={{ x, y, rotate }}
            animate={controls}
            drag={!confirming}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.8}
            onDragEnd={handleDragEnd}
          >
            <StaticCard card={demoCard} flipped={flipped} interactive onFlip={handleCardTap} />
            <SwipeStampOverlays
              likeOpacity={likeOpacity}
              nopeOpacity={nopeOpacity}
              seenOpacity={seenOpacity}
              seenScale={seenScale}
              seenRotate={seenRotate}
            />
          </motion.div>

          {!confirming && !flipped ? (
            <div className="pointer-events-none absolute -bottom-14 left-1/2 -translate-x-1/2">
              <GestureHint gesture={step.gesture} />
            </div>
          ) : null}

          {/* Effekt-brickan flyger upp mot mätaren när gesten är utförd —
              "det du just gjorde landade i din profil". */}
          <AnimatePresence>
            {confirming ? (
              <motion.div
                key={`fx-${step.id}`}
                initial={{ opacity: 0, y: 0, scale: 0.85 }}
                animate={{ opacity: [0, 1, 1, 0], y: -170, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.05, ease: "easeOut", times: [0, 0.18, 0.7, 1] }}
                className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2"
              >
                <span
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-neutral-950/90 px-3.5 py-1.5 text-xs font-semibold ${TONE_RING[step.tone]} ${TONE_TEXT[step.tone]}`}
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {t(`${step.id}.effect`)}
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Gest-legend: hela kartan syns hela tiden, inte bara det aktuella steget. */}
      <div className="flex items-center justify-center gap-2 px-4">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <span
              key={s.id}
              className={[
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors",
                current
                  ? `${TONE_RING[s.tone]} ${TONE_TEXT[s.tone]}`
                  : done
                  ? "border-white/10 bg-white/5 text-white/45"
                  : "border-white/8 bg-transparent text-white/25",
              ].join(" ")}
            >
              {done ? (
                <Check className="h-3 w-3" strokeWidth={3} />
              ) : (
                <StepIcon gesture={s.gesture} className="h-3 w-3" />
              )}
              {t(`${s.id}.label`)}
            </span>
          );
        })}
      </div>

      <div className="px-6 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-3 text-center">
        <p className="text-[15px] font-semibold text-white">{t(`${step.id}.hint`)}</p>
        <p className="mx-auto mt-1.5 flex max-w-[20rem] items-start justify-center gap-1.5 text-xs leading-relaxed text-cyan-200/70">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.5} />
          <span>{t(`${step.id}.algo`)}</span>
        </p>
      </div>
    </div>,
    document.body
  );
}

/**
 * Intro-illustrationen: ett kort som sveps åt höger och vänster av sig självt
 * medan signaler rinner ner i en profil-ring som fylls. Ren dekoration — men
 * den säger på två sekunder vad tre meningar text hade behövt säga.
 */
function IntroAnimation() {
  return (
    <div className="relative h-40 w-full max-w-[240px]">
      <motion.div
        className="absolute left-1/2 top-0 h-28 w-20 -translate-x-1/2 rounded-xl border border-white/15 bg-gradient-to-br from-neutral-800 to-neutral-900 shadow-xl"
        animate={{ x: ["-50%", "10%", "-50%", "-110%", "-50%"], rotate: [0, 10, 0, -10, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", times: [0, 0.22, 0.5, 0.72, 1] }}
      />
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute left-1/2 top-24 h-1.5 w-1.5 rounded-full bg-cyan-400"
          animate={{ y: [0, 34], opacity: [0, 1, 0], x: [(i - 1) * 18, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.28 + 0.4, ease: "easeIn" }}
        />
      ))}
      <motion.div
        className="absolute bottom-0 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border-2 border-cyan-400/70 bg-cyan-400/10"
        animate={{ scale: [1, 1.09, 1], borderColor: ["rgba(34,211,238,0.7)", "rgba(52,211,153,0.9)", "rgba(34,211,238,0.7)"] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <Sparkles className="h-5 w-5 text-cyan-300" strokeWidth={2.2} />
      </motion.div>
    </div>
  );
}
