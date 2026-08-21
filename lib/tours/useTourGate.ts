"use client";

// Avgör om en given genomgång ska visas: hämtar serverns progress (per user,
// se app/api/onboarding/tours) och jämför mot TOUR_VERSIONS. En rad med lägre
// version än den aktuella räknas som osedd — så en tour kan visas igen för alla
// genom att bara bumpa versionsnumret i registry.ts.
//
// ?tour=<id> i URL:en tvingar fram genomgången oavsett sparad status — det är
// vägen "Visa genomgången igen" i Profil/Inställningar använder.
//
// Tre saker utöver det:
//   1. `enabled` — genomgången startar först när ytan den beskriver är redo
//      (t.ex. watchlisten färdigladdad). Det är skillnaden mellan en hint som
//      dyker upp mitt i en laddning och en som kommer när den är relevant.
//   2. `requires` — kör inte förrän en tidigare genomgång är avklarad, så
//      nya användare inte får två saker förklarade samtidigt.
//   3. Ett lås (lib/tours/lock.ts) så bara EN genomgång kan visas åt gången.
import { useCallback, useEffect, useRef, useState } from "react";
import { LEGACY_GUIDE_KEYS, TOUR_VERSIONS, type TourId } from "./registry";
import { TOUR_PROGRESS_EVENT, ackTour, fetchTourProgress } from "./progress";
import { releaseTour, tryAcquireTour } from "./lock";

export type TourGateState = "loading" | "show" | "hidden";

export type TourGateOptions = {
  /** Genomgången får starta först när det här är sant. Default: true. */
  enabled?: boolean;
  /** Genomgångar som måste vara avklarade först. */
  requires?: TourId[];
  /** Paus innan den visas — låter sidan lägga sig till ro först. */
  delayMs?: number;
  /**
   * Extra ?tour=-värden som också ska tvinga fram den här genomgången.
   * Används av gruppfliken: "Visa igen" i Profil länkar till ?tour=groups-tour,
   * men vilken av de två grupp-genomgångarna som är relevant beror på om man
   * redan är med i en grupp.
   */
  forceAliases?: string[];
};

function readForceParam(tourId: string, aliases: string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const value = new URLSearchParams(window.location.search).get("tour");
    if (!value) return false;
    return value === tourId || aliases.includes(value);
  } catch {
    return false;
  }
}

/** Gammal localStorage-flagga från de borttagna GuideOverlay-guiderna. */
function legacySeen(tourId: TourId): boolean {
  const key = LEGACY_GUIDE_KEYS[tourId];
  if (!key || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function useTourGate(tourId: TourId, options: TourGateOptions = {}) {
  const { enabled = true, requires, delayMs = 400, forceAliases } = options;
  const aliasKey = forceAliases ? forceAliases.join(",") : "";
  const version = TOUR_VERSIONS[tourId];
  const [state, setState] = useState<TourGateState>("loading");
  const requiresKey = requires ? requires.join(",") : "";
  // Bumpas när någon annan genomgång kvitteras, så en gate som väntar på
  // `requires` kan starta i samma session i stället för vid nästa sidladdning.
  const [revision, setRevision] = useState(0);
  // Kvitterad i den här monteringen: utan den skulle en tvingad genomgång
  // (?tour=<id>) startas om direkt av sin egen kvittens-signal — force-flaggan
  // är ju fortfarande sann i URL:en.
  const finishedRef = useRef(false);

  useEffect(() => {
    const onProgress = () => setRevision((r) => r + 1);
    window.addEventListener(TOUR_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(TOUR_PROGRESS_EVENT, onProgress);
  }, []);

  useEffect(() => {
    if (finishedRef.current) return;
    let ignore = false;
    let timer = 0;

    if (readForceParam(tourId, aliasKey ? aliasKey.split(",") : [])) {
      if (tryAcquireTour(tourId)) setState("show");
      return () => releaseTour(tourId);
    }

    if (!enabled) {
      setState("loading");
      return;
    }

    if (legacySeen(tourId)) {
      // Redan onboardad på den gamla guiden — visa aldrig den nya, och skriv
      // en rad så migreringen inte behöver göras om på nästa enhet/session.
      setState("hidden");
      void ackTour(tourId, version, "completed");
      return;
    }

    void fetchTourProgress().then((map) => {
      if (ignore) return;
      const entry = map[tourId];
      if (entry && entry.version >= version) {
        setState("hidden");
        return;
      }
      const needed = requiresKey ? (requiresKey.split(",") as TourId[]) : [];
      const blocked = needed.some((dep) => {
        const d = map[dep];
        return !d || d.version < TOUR_VERSIONS[dep];
      });
      if (blocked) {
        // Inte "hidden" för alltid — den dyker upp nästa gång ytan besöks,
        // när förutsättningen är avklarad. Ingen ack skrivs.
        setState("hidden");
        return;
      }
      timer = window.setTimeout(() => {
        if (ignore) return;
        setState(tryAcquireTour(tourId) ? "show" : "hidden");
      }, delayMs);
    });

    return () => {
      ignore = true;
      if (timer) window.clearTimeout(timer);
      releaseTour(tourId);
    };
  }, [tourId, version, enabled, requiresKey, delayMs, aliasKey, revision]);

  const complete = useCallback(() => {
    finishedRef.current = true;
    setState("hidden");
    releaseTour(tourId);
    void ackTour(tourId, version, "completed");
  }, [tourId, version]);

  const skip = useCallback(() => {
    finishedRef.current = true;
    setState("hidden");
    releaseTour(tourId);
    void ackTour(tourId, version, "skipped");
  }, [tourId, version]);

  /**
   * Stäng utan att markera som sedd — genomgången kommer tillbaka när
   * förutsättningarna ändras (därför sätts INTE finishedRef här).
   */
  const defer = useCallback(() => {
    setState("hidden");
    releaseTour(tourId);
  }, [tourId]);

  return { state, complete, skip, defer };
}
