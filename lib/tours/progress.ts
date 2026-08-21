import type { TourId } from "./registry";
import type { TourProgressMap, TourStatus } from "./types";

// EN hämtning per sidladdning delas av alla monterade gates. Tidigare hämtade
// varje <CoachMarkTour> sin egen kopia — på /group ligger två av dem samtidigt,
// och varje flikbyte gav ett nytt round-trip innan hinten ens kunde visas.
let cached: TourProgressMap | null = null;
let inflight: Promise<TourProgressMap> | null = null;

export async function fetchTourProgress(): Promise<TourProgressMap> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/onboarding/tours", { cache: "no-store" });
      if (!res.ok) return {};
      const j = (await res.json()) as { ok?: boolean; tours?: TourProgressMap };
      const tours = j.ok && j.tours ? j.tours : {};
      cached = tours;
      return tours;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Signal till andra monterade gates att progressen ändrats. Utan den skulle en
 * genomgång som väntar på en annan (requires) inte upptäcka att förutsättningen
 * blev klar förrän vid nästa full sidladdning — nav-hinten hade t.ex. dykt upp
 * först nästa gång appen startades i stället för direkt efter swipe-tutorialen.
 */
export const TOUR_PROGRESS_EVENT = "nw:tour-progress";

export async function ackTour(tourId: TourId, version: number, status: TourStatus): Promise<void> {
  // IDEMPOTENT. Utan den här spärren blev kvitteringen en oändlig loop:
  // ackTour -> TOUR_PROGRESS_EVENT -> gaten som lyssnar renderar om -> dess
  // effekt kör igen -> ackTour ... Tusentals renderingar och POST:ar i sekunden
  // på varje sida (se lib/tours/useTourGate.ts). Är raden redan skriven med
  // samma version och status finns det inget att signalera och inget att spara.
  if (cached?.[tourId]?.version === version && cached[tourId].status === status) return;

  // Uppdatera den delade cachen direkt: en annan gate som monteras i samma
  // session ska aldrig visa en genomgång som just markerats klar.
  if (cached) cached[tourId] = { version, status };
  try {
    // tourId i detaljen så en lyssnare kan ignorera sin EGEN kvittens.
    window.dispatchEvent(new CustomEvent(TOUR_PROGRESS_EVENT, { detail: { tourId } }));
  } catch {
    /* SSR — irrelevant */
  }
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
