// Delade typer för onboarding-motorn (lib/tours). Två lägen:
// - "gesture": användaren måste faktiskt utföra ett svep/tryck för att gå vidare.
// - "coach": highlighta ett UI-element + förklara, med Nästa/Klart-knapp.
// Fas 1 använder bara gesture-läget (swipe-tutorialen); coach-läget finns klart
// för nästa genomgång (vänner, grupper, watchlist) utan att motorn behöver byggas om.

export type GestureType = "swipe-right" | "swipe-left" | "swipe-up" | "tap";

export type GestureTourStep = {
  mode: "gesture";
  id: string;
  gesture: GestureType;
  label: string;
  hint: string;
};

export type CoachTourStep = {
  mode: "coach";
  id: string;
  /** data-tour-attribut utan hakparenteser, t.ex. "group-create-join" */
  target?: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "center";
};

export type TourStep = GestureTourStep | CoachTourStep;

export type TourStatus = "completed" | "skipped";

export type TourProgressMap = Record<string, { version: number; status: TourStatus }>;
