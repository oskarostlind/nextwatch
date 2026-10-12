"use client";

// Gesttips direkt på FÖRSTA riktiga kortet — ersätter swipe-genomgången som
// startade automatiskt (intro + fyra övningskort + betyg + sammanfattning) och
// navigeringsarket som lades ovanpå första kortet. Tratten 2026-10-12: en ny
// gäst mötte nio steg innan första riktiga swipen och 16 % av dem som fick fram
// kortet swipade aldrig.
//
// Ren presentation, pointer-events-none: kortet under går att dra och trycka
// på som vanligt, och tipset försvinner för gott efter första swipen.
// Genomgången finns kvar under Profil → Genomgång (?tour=swipe-gestures).
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Hand } from "lucide-react";
import { useTranslations } from "next-intl";

const DONE_KEY = "nw_first_card_hint_done";

/** Ska tipset visas? Bara tills enheten gjort sin första riktiga swipe. */
export function shouldShowFirstCardHint(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY) === "1") return false;
    // Swipat förut (räknaren i lib/funnel.ts) → kan redan gesterna.
    if (Number(localStorage.getItem("nw_fx_swipes") ?? 0) > 0) return false;
    return true;
  } catch {
    return false;
  }
}

export function markFirstCardHintDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* privat läge — tipset kommer tillbaka nästa sidladdning, ofarligt */
  }
}

export default function FirstCardHint({ visible }: { visible: boolean }) {
  const t = useTranslations("swipe.firstHint");
  if (!visible) return null;
  return (
    <motion.div
      aria-hidden
      data-first-card-hint
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-0.5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.3 }}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.45)_55%,rgba(0,0,0,0)_85%)] px-6 text-center">
        <div className="flex w-full max-w-[300px] items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-rose-400/70 bg-black/55 px-3 py-1.5 text-sm font-semibold text-rose-300">
            <ArrowLeft className="h-4 w-4" strokeWidth={3} />
            {t("nope")}
          </span>
          <motion.span
            className="text-white"
            animate={{ x: [-26, 26, -26], rotate: [-14, 6, -14] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Hand className="h-9 w-9" strokeWidth={1.8} />
          </motion.span>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/70 bg-black/55 px-3 py-1.5 text-sm font-semibold text-emerald-300">
            {t("like")}
            <ArrowRight className="h-4 w-4" strokeWidth={3} />
          </span>
        </div>
        <p className="max-w-[260px] text-[15px] font-semibold leading-snug text-white">{t("title")}</p>
        <p className="max-w-[260px] text-xs leading-relaxed text-white/75">{t("more")}</p>
      </div>
    </motion.div>
  );
}
