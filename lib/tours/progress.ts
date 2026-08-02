import type { TourId } from "./registry";
import type { TourProgressMap, TourStatus } from "./types";

export async function fetchTourProgress(): Promise<TourProgressMap> {
  try {
    const res = await fetch("/api/onboarding/tours", { cache: "no-store" });
    if (!res.ok) return {};
    const j = (await res.json()) as { ok?: boolean; tours?: TourProgressMap };
    return j.ok && j.tours ? j.tours : {};
  } catch {
    return {};
  }
}

export async function ackTour(tourId: TourId, version: number, status: TourStatus): Promise<void> {
  try {
    await fetch("/api/onboarding/tours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tourId, version, status }),
    });
  } catch {
    /* best-effort — visas igen nästa öppning om detta misslyckas */
  }
}
