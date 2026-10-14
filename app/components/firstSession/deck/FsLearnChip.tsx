"use client";

// "N gillade – vi lär oss din smak": chip på kortet efter FS_LEARN_AT gilla
// under första sessionen. Ingen modal, inget avbrott — bara en signal om att
// swipesen gör något.

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

export default function FsLearnChip({ likes }: { likes: number }) {
  const t = useTranslations("fsDeck");
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="pointer-events-none absolute right-3 top-3 z-[25] flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-[rgba(10,10,10,0.72)] px-[11px] py-[7px] text-[12px] font-semibold text-[#a5f3fc]"
      aria-live="polite"
    >
      {t("learning", { count: likes })}
    </motion.div>
  );
}
