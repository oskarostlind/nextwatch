// Delade typer för onboarding-motorn (lib/tours). Två lägen:
// - "gesture": användaren måste faktiskt utföra ett svep/tryck för att gå vidare
//   (swipe-tutorialen, app/components/client/tours/SwipeGestureTour.tsx).
// - "coach": peka ut ett riktigt UI-element + förklara det i ett bottenark
//   (app/components/client/tours/HintSheet.tsx).

export type GestureType = "swipe-right" | "swipe-left" | "swipe-up" | "tap";

export type GestureTourStep = {
  mode: "gesture";
  id: string;
  gesture: GestureType;
  label: string;
  hint: string;
};

/** Ikoner HintSheet kan rendera i en punktlista (se CoachMarkStep). */
export type CoachListIcon =
  | "swipe"
  | "group"
  | "discover"
  | "watchlist"
  | "profile"
  | "check";

export type CoachTourStep = {
  mode: "coach";
  id: string;
  /** data-tour-attribut utan hakparenteser, t.ex. "group-join-create" */
  target?: string;
  /** Nyckel i messages/*.json under namnrymden "tours". */
  titleKey: string;
  bodyKey: string;
  /**
   * Valfri punktlista under brödtexten — används av nav-hinten som ersatte den
   * gamla femstegskedjan: alla fem flikar förklaras i EN ruta i stället för
   * fem modaler i rad.
   */
  list?: Array<{ icon: CoachListIcon; key: string }>;
  /**
   * Steget kräver sitt mål. Utan mål på skärmen hoppas det över tyst i stället
   * för att visas som en innehållslös ruta mitt på skärmen (det gamla
   * placement:"center"-beteendet, som var precis det som kändes i vägen).
   */
  requiresTarget?: boolean;
};

export type TourStep = GestureTourStep | CoachTourStep;

export type TourStatus = "completed" | "skipped";

export type TourProgressMap = Record<string, { version: number; status: TourStatus }>;
