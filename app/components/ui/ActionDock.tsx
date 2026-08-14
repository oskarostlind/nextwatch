"use client";

import { X, Info, Undo2, Heart } from "lucide-react";
import { useTranslations } from "next-intl";

type VibratingNavigator = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

type Props = {
  onNope: () => void;
  onInfo: () => void;
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
  intent: "danger" | "info" | "undo" | "like";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    intent === "danger"
      ? "border-red-500/40 bg-red-600/20 hover:bg-red-600/30"
      : intent === "info"
      ? "border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30"
      : intent === "undo"
      ? "border-amber-500/40 bg-amber-600/20 hover:bg-amber-600/30"
      : "border-green-500/40 bg-green-600/20 hover:bg-green-600/30";

  // active:scale-90 ger tryckrespons på touch — hover finns inte på iPhone.
  // `transition` (inte transition-transform) behålls så färgövergångarna lever kvar.
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-white shadow-md backdrop-blur transition duration-100 active:scale-90 disabled:opacity-60 ${cls}`}
    >
      {children}
    </button>
  );
}

/** Inline under kortleken — AppShell ger redan utrymme ovanför BottomTabs. */
export default function ActionDock({
  onNope,
  onInfo,
  onUndo,
  onLike,
  disabled,
}: Props) {
  const t = useTranslations("actions");
  return (
    <div className="flex shrink-0 items-center justify-center gap-4 px-4 pb-1 pt-2">
      <RoundBtn
        title="Nej"
        intent="danger"
        disabled={disabled}
        onClick={() => {
          vib(18);
          onNope();
        }}
      >
        <X className="h-6 w-6" />
      </RoundBtn>

      <RoundBtn title="Info" intent="info" disabled={disabled} onClick={onInfo}>
        <Info className="h-6 w-6" />
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
        <Undo2 className="h-6 w-6" />
      </RoundBtn>

      <RoundBtn
        title="Gilla"
        intent="like"
        disabled={disabled}
        onClick={() => {
          vib(28);
          onLike();
        }}
      >
        <Heart className="h-6 w-6" />
      </RoundBtn>
    </div>
  );
}
