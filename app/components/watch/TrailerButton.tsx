"use client";

// Trailerknapp + spelare i ett. Renderar ingenting alls när titeln saknar
// trailer, så anropande ytor slipper villkora själva.

import { useState } from "react";
import { Play } from "lucide-react";
import TrailerModal from "./TrailerModal";
import type { Trailer } from "@/lib/tmdbVideos";
import { BUTTON_VARIANTS } from "@/app/components/ui/kit";

type Props = {
  trailer: Trailer | null | undefined;
  title: string;
  /** "solid" på ljus yta/knappsrad, "ghost" på kortets baksida. */
  variant?: "solid" | "ghost";
};

export default function TrailerButton({ trailer, title, variant = "solid" }: Props) {
  const [open, setOpen] = useState(false);

  if (!trailer) return null;

  // "solid" (match-rutan) återanvänder kit.tsx:s sekundärfärg för att matcha
  // knapparna bredvid ("Mer info", "Fortsätt swipa") i stället för sin egen
  // ad-hoc-grå. "ghost" (kortets baksida) behåller sin egen, lite tonade look.
  const cls =
    variant === "solid"
      ? BUTTON_VARIANTS.secondary
      : "border border-white/10 bg-white/5 text-neutral-200 hover:border-white/25 hover:bg-white/10";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${cls}`}
      >
        <Play className="h-4 w-4 fill-current" />
        Trailer
      </button>

      <TrailerModal open={open} trailer={trailer} title={title} onClose={() => setOpen(false)} />
    </>
  );
}
