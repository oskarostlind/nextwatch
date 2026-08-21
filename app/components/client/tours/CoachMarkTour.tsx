"use client";

// Körare för coach-genomgångar (nav, vänner, grupper, watchlist). Bygger på
// lib/tours/useTourGate + CoachMarkStep/HintSheet.
//
// Just-in-time i stället för front-loading: när genomgången startar plockas
// stegen vars mål FAKTISKT finns på skärmen ut, resten hoppas över. Finns
// inget steg alls (t.ex. gruppfliken innan man gått med i en grupp) läggs
// genomgången undan UTAN att markeras sedd — den dyker upp när ytan den
// beskriver existerar.
//
// Tidigare väntade den 3,5 sekunder per saknat mål innan den gick vidare, vilket
// gav flera sekunders svart skärm med en tom ruta i mitten på gruppfliken.
import { useCallback, useEffect, useState } from "react";
import CoachMarkStep from "./CoachMarkStep";
import { useTourGate } from "@/lib/tours/useTourGate";
import type { TourId } from "@/lib/tours/registry";
import type { CoachTourStep } from "@/lib/tours/types";

/** Hur länge vi väntar in målen innan vi ger upp och lägger undan touren. */
const READY_WAIT_MS = 1200;
const READY_POLL_MS = 150;

function targetOnScreen(selector: string | undefined): boolean {
  if (!selector) return true;
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(`[data-tour="${selector}"]`));
}

function visibleSteps(steps: CoachTourStep[]): CoachTourStep[] {
  return steps.filter((s) => !s.requiresTarget || targetOnScreen(s.target));
}

export default function CoachMarkTour({
  tourId,
  steps,
  /** Genomgången startar först när ytan är redo (data laddad, flik vald, …). */
  enabled = true,
  /** Genomgångar som måste vara avklarade först. */
  requires,
  /** Extra ?tour=-värden som också tvingar fram den här genomgången. */
  forceAliases,
  /** Paus innan hinten tänds — låter sidan lägga sig till ro först. */
  delayMs,
}: {
  tourId: TourId;
  steps: CoachTourStep[];
  enabled?: boolean;
  requires?: TourId[];
  forceAliases?: string[];
  delayMs?: number;
}) {
  const { state, complete, skip, defer } = useTourGate(tourId, { enabled, requires, forceAliases, delayMs });
  const [runSteps, setRunSteps] = useState<CoachTourStep[] | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const shouldRun = state === "show";

  // Vänta in målen en kort stund, plocka sedan ut de steg som går att visa.
  useEffect(() => {
    if (!shouldRun) {
      setRunSteps(null);
      setStepIndex(0);
      return;
    }
    let cancelled = false;
    const started = Date.now();

    const settle = () => {
      if (cancelled) return true;
      const found = visibleSteps(steps);
      if (found.length > 0) {
        setRunSteps(found);
        setStepIndex(0);
        return true;
      }
      if (Date.now() - started >= READY_WAIT_MS) {
        // Inget att visa här och nu — kom tillbaka senare, markera inte sedd.
        defer();
        return true;
      }
      return false;
    };

    if (settle()) return;
    const timer = window.setInterval(() => {
      if (settle()) window.clearInterval(timer);
    }, READY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shouldRun, steps, defer]);

  const goNext = useCallback(() => {
    setStepIndex((i) => i + 1);
  }, []);

  // Målet kan ha försvunnit mellan stegen (flikbyte, listan tömd) — hoppa
  // vidare direkt i stället för att visa en ring runt ingenting.
  useEffect(() => {
    if (!runSteps) return;
    if (stepIndex >= runSteps.length) {
      complete();
      return;
    }
    const step = runSteps[stepIndex];
    if (step.requiresTarget && !targetOnScreen(step.target)) setStepIndex((i) => i + 1);
  }, [runSteps, stepIndex, complete]);

  if (!shouldRun || !runSteps) return null;
  const step = runSteps[stepIndex];
  if (!step) return null;

  return (
    <CoachMarkStep
      key={step.id}
      step={step}
      index={stepIndex}
      total={runSteps.length}
      onNext={stepIndex >= runSteps.length - 1 ? complete : goNext}
      onSkip={runSteps.length > 1 && stepIndex < runSteps.length - 1 ? skip : undefined}
    />
  );
}
