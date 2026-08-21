"use client";

// Ett coach-steg = översättning av CoachTourStep till HintSheet-props.
// All layout/rörelse/placering bor i HintSheet; det här filtret finns bara så
// stegdefinitionerna (lib/tours/coachSteps.ts) kan hålla sig till i18n-nycklar.
import type { CoachTourStep } from "@/lib/tours/types";
import { useTranslations } from "next-intl";
import HintSheet from "./HintSheet";

export default function CoachMarkStep({
  step,
  index,
  total,
  onNext,
  onSkip,
}: {
  step: CoachTourStep;
  index: number;
  total: number;
  onNext: () => void;
  /** Utelämnad = ingen "Hoppa över"-knapp (t.ex. sista steget). */
  onSkip?: () => void;
}) {
  const tt = useTranslations("tours");
  const tg = useTranslations("guide");

  return (
    <HintSheet
      targetSelector={step.target}
      title={tt(step.titleKey)}
      body={tt(step.bodyKey)}
      list={step.list?.map((row) => ({ icon: row.icon, label: tt(row.key) }))}
      index={index}
      total={total}
      nextLabel={index >= total - 1 ? tg("done") : tg("next")}
      skipLabel={tg("skip")}
      onNext={onNext}
      onSkip={onSkip}
    />
  );
}
