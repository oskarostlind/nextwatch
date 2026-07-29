"use client";

// Mjuk, upprepande hand/pil-hint som visar VILKEN riktning man ska dra (eller att
// man ska trycka). Ren presentation — vet inget om tour-motorn, återanvänds av
// varje gesture-practice-steg oavsett vilken genomgång de tillhör.
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUp, Hand, MousePointerClick } from "lucide-react";
import type { GestureType } from "@/lib/tours/types";

const OFFSETS: Record<GestureType, { x?: number[]; y?: number[] }> = {
  "swipe-right": { x: [0, 30, 0] },
  "swipe-left": { x: [0, -30, 0] },
  "swipe-up": { y: [0, -30, 0] },
  tap: {},
};

function GestureIcon({ gesture }: { gesture: GestureType }) {
  if (gesture === "swipe-right") return <ArrowRight className="h-5 w-5" strokeWidth={3} />;
  if (gesture === "swipe-left") return <ArrowLeft className="h-5 w-5" strokeWidth={3} />;
  if (gesture === "swipe-up") return <ArrowUp className="h-5 w-5" strokeWidth={3} />;
  return <MousePointerClick className="h-5 w-5" strokeWidth={2.5} />;
}

export default function GestureHint({ gesture }: { gesture: GestureType }) {
  const offsets = OFFSETS[gesture];
  return (
    <motion.div
      className="pointer-events-none flex flex-col items-center gap-1 text-cyan-300"
      animate={{
        x: offsets.x ?? 0,
        y: offsets.y ?? 0,
        opacity: gesture === "tap" ? [1, 0.35, 1] : [0.45, 1, 0.45],
      }}
      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
    >
      <Hand className="h-7 w-7 -rotate-12" strokeWidth={2} />
      <GestureIcon gesture={gesture} />
    </motion.div>
  );
}
