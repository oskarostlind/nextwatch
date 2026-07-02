"use client";

import { X, Info, Bookmark, Heart } from "lucide-react";

type VibratingNavigator = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

type Props = {
  onNope: () => void;
  onInfo: () => void;
  onWatchlist: () => void;
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
  intent: "danger" | "info" | "save" | "like";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    intent === "danger"
      ? "border-red-500/40 bg-red-600/20 hover:bg-red-600/30"
      : intent === "info"
      ? "border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30"
      : intent === "save"
      ? "border-cyan-500/40 bg-cyan-600/20 hover:bg-cyan-600/30"
      : "border-green-500/40 bg-green-600/20 hover:bg-green-600/30";

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-white shadow-md backdrop-blur transition disabled:opacity-60 ${cls}`}
    >
      {children}
    </button>
  );
}

/** Inline under kortleken — AppShell ger redan utrymme ovanför BottomTabs. */
export default function ActionDock({
  onNope,
  onInfo,
  onWatchlist,
  onLike,
  disabled,
}: Props) {
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
        title="Spara"
        intent="save"
        disabled={disabled}
        onClick={() => {
          vib(22);
          onWatchlist();
        }}
      >
        <Bookmark className="h-6 w-6" />
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
