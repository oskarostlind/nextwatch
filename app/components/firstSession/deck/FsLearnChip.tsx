"use client";

// "N gillade – vi lär oss din smak": signal efter FS_LEARN_AT gilla under
// första sessionen. Ingen modal, inget avbrott — bara en bekräftelse på att
// swipesen gör något.
//
// Bor i progress-raden (FsProgress), INTE på kortet: på kortet krockade den
// med "MATCHAR …"-brickan uppe till höger (del 8, 2026-10-15).

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

export default function FsLearnChip({ likes }: { likes: number }) {
  const t = useTranslations("fsDeck");
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-400/35 bg-cyan-400/[0.08] px-2.5 py-[3px] text-[11.5px] font-semibold leading-none text-[#a5f3fc]"
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#22d3ee]" aria-hidden />
      <span className="truncate">{t("learning", { count: likes })}</span>
    </motion.span>
  );
}
