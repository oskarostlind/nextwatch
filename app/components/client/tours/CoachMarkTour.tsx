"use client";

// Generisk körare för coach-mark-genomgångar (fas 2: vänner, grupper,
// watchlist) — bygger på lib/tours/useTourGate + CoachMarkStep utan att
// bygga en till tour-motor. Ett steg utan mål (target) visas alltid
// (center-placerat); ett steg VARS mål inte hunnit monteras (t.ex.
// inställningskugghjulet som bara finns för gruppskaparen, eller
// "Bjud in"-knappen innan man gått med i en grupp) väntas in en kort stund
// och hoppas sedan över tyst — motsvarande hur GuideOverlay redan hoppar
// över steg med saknat mål.
import { useEffect, useRef, useState } from "react";
import CoachMarkStep from "./CoachMarkStep";
import { useTourGate } from "@/lib/tours/useTourGate";
import type { TourId } from "@/lib/tours/registry";
import type { CoachTourStep } from "@/lib/tours/types";
import { markGuideSeen, releaseGuide, tryAcquireGuide, type GuideId } from "@/lib/userGuide";

const TARGET_WAIT_MS = 3500;
const TARGET_POLL_MS = 200;

function hasTarget(selector: string | undefined): boolean {
  if (!selector) return true;
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(`[data-tour="${selector}"]`));
}

export default function CoachMarkTour({
  tourId,
  steps,
  /** Äldre passiv guide (lib/userGuide.ts) som täcker samma yta — tas i
   *  besittning + markeras sedd så den inte dyker upp ovanpå den här. */
  suppressGuideId,
}: {
  tourId: TourId;
  steps: CoachTourStep[];
  suppressGuideId?: GuideId;
}) {
  const { state, complete, skip } = useTourGate(tourId);
  const [stepIndex, setStepIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const waitStart = useRef<number | null>(null);

  const shouldRun = state === "show";

  useEffect(() => {
    if (!shouldRun || !suppressGuideId) return;
    tryAcquireGuide(suppressGuideId);
    markGuideSeen(suppressGuideId);
    return () => releaseGuide(suppressGuideId);
  }, [shouldRun, suppressGuideId]);

  useEffect(() => {
    if (!shouldRun) {
      setStepIndex(0);
      setReady(false);
      return;
    }
    const step = steps[stepIndex];
    if (!step) {
      complete();
      return;
    }
    if (hasTarget(step.target)) {
      setReady(true);
      return;
    }
    setReady(false);
    waitStart.current = Date.now();
    const t = window.setInterval(() => {
      if (hasTarget(step.target)) {
        window.clearInterval(t);
        setReady(true);
        return;
      }
      const elapsed = Date.now() - (waitStart.current ?? Date.now());
      if (elapsed >= TARGET_WAIT_MS) {
        window.clearInterval(t);
        setStepIndex((i) => i + 1);
      }
    }, TARGET_POLL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRun, stepIndex, steps]);

  if (!shouldRun || !ready) return null;
  const step = steps[stepIndex];
  if (!step) return null;

  function goNext() {
    if (stepIndex >= steps.length - 1) complete();
    else setStepIndex((i) => i + 1);
  }

  return (
    <CoachMarkStep
      step={step}
      index={stepIndex}
      total={steps.length}
      onNext={goNext}
      onSkip={stepIndex > 0 ? skip : undefined}
    />
  );
}
