"use client";

// Fas 1-innehållet i tour-motorn: fyra gated gesture-practice-kort som lär ut
// gilla/ogilla/info/sett+betygsätt. Sista kortet (swipe upp) kör det RIKTIGA
// sett+betygsätt-flödet mot en känd exempeltitel (Inception) — samma
// /api/rate + /api/ratings/save + RatingModal som den riktiga swipen använder
// — så användaren faktiskt gör hela flödet en gång, betyg inkluderat.
//
// Återanvänder StaticCard/SwipeStampOverlays/fetchDetailsWithFallback/
// fetchWatchProviders från app/swipe/page_client.tsx i stället för att bygga
// ett andra kort — praktikkorten ser därför ut exakt som riktiga swipekort.
//
// Visas via app/swipe/page.tsx (server-komponenten), som ett syskon till
// <Client /> — INTE importerad av page_client.tsx själv. Det håller den
// riktiga swipe/rating-koden helt orörd och undviker en cirkulär import
// (den här filen importerar ju namngivna exports FRÅN page_client.tsx).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useAnimation, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import {
  StaticCard,
  SwipeStampOverlays,
  fetchDetailsWithFallback,
  fetchWatchProviders,
  type Card,
} from "@/app/swipe/page_client";
import RatingModal from "@/app/components/client/RatingModal";
import { notify } from "@/app/components/lib/notify";
import { markGuideSeen, releaseGuide, tryAcquireGuide } from "@/lib/userGuide";
import { useTourGate } from "@/lib/tours/useTourGate";
import type { GestureType } from "@/lib/tours/types";
import GestureHint from "./GestureHint";

const TOUR_ID = "swipe-gestures" as const;

// Ett stort, allmänt känt exempel — så steg 4 (sett + betygsätt) känns som en
// riktig titel man faktiskt kan ha en åsikt om, inte en påhittad platshållare.
const DEMO_MOVIE = { tmdbId: 27205, mediaType: "movie" as const, title: "Inception", year: "2010" };

type Step = { id: string; gesture: GestureType; label: string; hint: string };

const STEPS: Step[] = [
  { id: "like", gesture: "swipe-right", label: "Gilla", hint: "Dra kortet åt höger för att gilla." },
  { id: "dislike", gesture: "swipe-left", label: "Ogilla", hint: "Dra kortet åt vänster om det inte är din grej." },
  { id: "info", gesture: "tap", label: "Mer info", hint: "Tryck på kortet för att vända på det." },
  {
    id: "seen",
    gesture: "swipe-up",
    label: "Sett + betygsätt",
    hint: "Dra kortet uppåt om du redan sett den — sen får du betygsätta den.",
  },
];

const DIST_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 700;

export default function SwipeGestureTour() {
  const { state, complete, skip } = useTourGate(TOUR_ID);
  const [mounted, setMounted] = useState(false);
  const [demoCard, setDemoCard] = useState<Card | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"active" | "rating">("active");
  const [ratingSaving, setRatingSaving] = useState(false);
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

  // Så fort vi bestämmer oss för att visa: ta guide-låset OCH markera den äldre
  // passiva swipe-guiden (lib/userGuide.ts) som sedd direkt — annars kan dess
  // egen 700ms-timer (i page_client.tsx) hinna tända innan vi själva renderar,
  // och användaren ser två överlappande genomgångar av samma sak.
  useEffect(() => {
    if (state === "show") {
      tryAcquireGuide("swipe");
      markGuideSeen("swipe");
    }
    return () => releaseGuide("swipe");
  }, [state]);

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

  if (!mounted || state !== "show" || !demoCard) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;

  function resetCardPosition() {
    x.set(0);
    y.set(0);
    controls.set({ x: 0, y: 0, opacity: 1 });
  }

  function finishTour(status: "completed" | "skipped") {
    // Motsvarande passiva coachmark ska inte dyka upp igen ovanpå den här —
    // den täcker samma sak, bara utan tvingad interaktion.
    markGuideSeen("swipe");
    releaseGuide("swipe");
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
    setPhase("rating");
  }

  function onGestureConfirmed() {
    if (advancingRef.current) return;
    advancingRef.current = true;

    if (step.gesture === "swipe-up") {
      void controls.start({ y: -760, opacity: 0, transition: { duration: 0.22 } }).then(() => {
        void beginSeenFlow();
      });
      return;
    }

    if (step.gesture === "tap") {
      // Kortet är redan vänt (handleCardTap satte flipped=true) — låt
      // användaren faktiskt SE baksidan (den riktiga detaljvyn) en stund
      // innan "Snyggt!"-bekräftelsen, annars hinner de aldrig se vad en
      // tryckning gör. Vänd tillbaka och gå vidare efteråt.
      window.setTimeout(() => {
        setConfirming(true);
        window.setTimeout(() => {
          setConfirming(false);
          setFlipped(false);
          window.setTimeout(() => setStepIndex((i) => i + 1), 300);
        }, 600);
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
      }, 350);
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
      })
      .catch(() => notify("Kunde inte spara betyget"))
      .finally(() => {
        setRatingSaving(false);
        finishTour("completed");
      });
  }

  function skipRating() {
    // Ett sätt ut ur betygspopupen utan att låsa in användaren — men det räknas
    // som "skipped", inte "completed", eftersom uppgiften uttryckligen bara ska
    // markera genomgången klar när betyget faktiskt sparats.
    finishTour("skipped");
  }

  if (phase === "rating") {
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

  return createPortal(
    <div className="fixed inset-0 z-[75] flex flex-col bg-black/92 backdrop-blur-sm" role="dialog" aria-modal>
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400/80">
          Så funkar swipen — {stepIndex + 1}/{STEPS.length}
        </p>
        {!isFirst ? (
          <button
            type="button"
            onClick={() => finishTour("skipped")}
            className="text-xs text-white/40 underline underline-offset-2 hover:text-white/70"
          >
            Hoppa över
          </button>
        ) : (
          <span />
        )}
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
            <div className="pointer-events-none absolute -bottom-16 left-1/2 -translate-x-1/2">
              <GestureHint gesture={step.gesture} />
            </div>
          ) : null}

          {confirming ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="rounded-2xl border-2 border-emerald-400 bg-black/70 px-6 py-3 text-2xl font-black uppercase tracking-widest text-emerald-400">
                Snyggt!
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>

      <div className="px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2 text-center">
        <p className="text-sm font-medium text-white/85">{step.label}</p>
        <p className="mt-1 text-xs text-white/50">{step.hint}</p>
      </div>
    </div>,
    document.body
  );
}
