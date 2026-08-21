"use client";

// Avgör om en given genomgång ska visas: hämtar serverns progress (per user,
// se app/api/onboarding/tours) och jämför mot TOUR_VERSIONS. En rad med lägre
// version än den aktuella räknas som osedd — så en tour kan visas igen för alla
// genom att bara bumpa versionsnumret i registry.ts.
//
// ?tour=<id> i URL:en tvingar fram genomgången oavsett sparad status — det är
// vägen "Visa genomgången igen" i Profil/Inställningar använder.
import { useCallback, useEffect, useState } from "react";
import { TOUR_VERSIONS, type TourId } from "./registry";
import { ackTour, fetchTourProgress } from "./progress";

export type TourGateState = "loading" | "show" | "hidden";

function readForceParam(tourId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("tour") === tourId;
  } catch {
    return false;
  }
}

export function useTourGate(tourId: TourId) {
  const version = TOUR_VERSIONS[tourId];
  const [state, setState] = useState<TourGateState>("loading");

  useEffect(() => {
    let ignore = false;
    if (readForceParam(tourId)) {
      setState("show");
      return;
    }
    void fetchTourProgress().then((map) => {
      if (ignore) return;
      const entry = map[tourId];
      const alreadySeen = Boolean(entry && entry.version >= version);
      setState(alreadySeen ? "hidden" : "show");
    });
    return () => {
      ignore = true;
    };
  }, [tourId, version]);

  const complete = useCallback(() => {
    setState("hidden");
    void ackTour(tourId, version, "completed");
  }, [tourId, version]);

  const skip = useCallback(() => {
    setState("hidden");
    void ackTour(tourId, version, "skipped");
  }, [tourId, version]);

  return { state, complete, skip };
}
