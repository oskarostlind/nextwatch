"use client";

import { X, Undo2, Heart } from "lucide-react";
import { useTranslations } from "next-intl";

type VibratingNavigator = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

type Props = {
  onNope: () => void;
  onUndo: () => void;
  onLike: () => void;
  disabled?: boolean;
};

function vib(ms = 30) {
  if (typeof navigator !== "undefined") {
    (navigator as VibratingNavigator).vibrate?.(ms);
  }
}

function RoundBtn({
  title,
  intent,
  onClick,
  disabled,
  children,
}: {
  title: string;
  intent: "danger" | "undo" | "like";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // Massiv mörk fyllning i stället för genomskinlig tint: knapparna ligger
  // numera halvvägs över posterns underkant, och en 20 %-tint blev oläslig mot
  // ljusa postrar. Färgen bärs av ikonen + en tunn ring; skuggan lyfter knappen
  // från både postern och sidans bakgrund.
  const cls =
    intent === "danger"
      ? "h-[60px] w-[60px] text-rose-400 ring-rose-400/35 hover:ring-rose-400/60"
      : intent === "undo"
      ? "h-11 w-11 text-amber-300 ring-amber-300/30 hover:ring-amber-300/55"
      : "h-[60px] w-[60px] text-emerald-400 ring-emerald-400/35 hover:ring-emerald-400/60";

  // active:scale-90 ger tryckrespons på touch — hover finns inte på iPhone.
  // `transition` (inte transition-transform) behålls så ringens färgövergång lever kvar.
  // pointer-events-auto: docken själv släpper igenom pekaren (se nedan), bara
  // knapparna tar emot tryck.
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`pointer-events-auto flex shrink-0 items-center justify-center rounded-full bg-neutral-950 ring-1 shadow-[0_6px_18px_rgba(0,0,0,0.55)] transition duration-100 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:opacity-60 disabled:active:scale-100 ${cls}`}
    >
      {children}
    </button>
  );
}

/**
 * Tre knappar som grenslar kortets underkant: Nej · Ångra · Gilla.
 *
 * Info-knappen togs bort 2026-10-13 — ett tryck på kortet vänder det redan,
 * och fyra knappar i rad var ett tredje visuellt lager ovanpå kort + tabbrad.
 *
 * Komponenten positionerar sig INTE själv: föräldern lägger den absolut över
 * kortytans nederkant (se app/swipe/page_client.tsx). Hela raden är
 * pointer-events-none så att ett drag som börjar bredvid knapparna fortfarande
 * hamnar på kortet under — bara själva knapparna fångar tryck.
 */
export default function ActionDock({ onNope, onUndo, onLike, disabled }: Props) {
  const t = useTranslations("actions");
  return (
    <div className="pointer-events-none flex items-center justify-center gap-6 px-4">
      <RoundBtn
        title={t("dislike")}
        intent="danger"
        disabled={disabled}
        onClick={() => {
          vib(18);
          onNope();
        }}
      >
        <X className="h-7 w-7" strokeWidth={2.5} />
      </RoundBtn>

      <RoundBtn
        title={t("undo")}
        intent="undo"
        disabled={disabled}
        onClick={() => {
          vib(22);
          onUndo();
        }}
      >
        <Undo2 className="h-5 w-5" />
      </RoundBtn>

      <RoundBtn
        title={t("like")}
        intent="like"
        disabled={disabled}
        onClick={() => {
          vib(28);
          onLike();
        }}
      >
        <Heart className="h-7 w-7" strokeWidth={2.25} />
      </RoundBtn>
    </div>
  );
}
