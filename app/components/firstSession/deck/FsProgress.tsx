"use client";

// Progress-raden i leken under första sessionen: "N av 10 ━━━ ✦ Sedan väljer AI
// kvällens film". EN rad (~22 px) — 2026-11-09 slogs den ihop från tre rader
// (text, stapel, reserverad rad för lärchipen ≈ 66 px) eftersom kortet blev så
// litet att baksidans text inte fick plats. Varje pixel här tas från kortet.
//
// Lärsignalen ("N gillade – vi lär oss din smak") tar högertextens plats en
// stund efter varje nytt gilla från FS_LEARN_AT och går sedan tillbaka till
// AI-löftet — ingen egen rad, så kortet hoppar aldrig.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AI_REVEAL_AT } from "@/lib/firstSession";
import { FS_LEARN_AT } from "./fsDeck";

const LEARN_SHOW_MS = 3200;

export default function FsProgress({ swipes, likes = 0 }: { swipes: number; likes?: number }) {
  const t = useTranslations("fsDeck");
  const reduce = useReducedMotion();
  const n = Math.min(swipes, AI_REVEAL_AT);
  const pct = Math.round((n / AI_REVEAL_AT) * 100);

  const [learning, setLearning] = useState(false);
  const prevLikes = useRef(likes);
  useEffect(() => {
    const grew = likes > prevLikes.current;
    prevLikes.current = likes;
    if (!grew || likes < FS_LEARN_AT) return;
    setLearning(true);
    const id = window.setTimeout(() => setLearning(false), LEARN_SHOW_MS);
    return () => window.clearTimeout(id);
  }, [likes]);

  const fade = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: -3 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 3 } };

  return (
    <div
      className="flex h-[22px] shrink-0 items-center gap-2.5 px-4"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={AI_REVEAL_AT}
      aria-valuenow={n}
      aria-label={t("progressAria", { count: n, total: AI_REVEAL_AT })}
    >
      <span className="shrink-0 text-[11.5px] tabular-nums text-neutral-400">
        {t("progressCount", { count: n, total: AI_REVEAL_AT })}
      </span>
      <div className="h-1 min-w-[40px] flex-1 overflow-hidden rounded-sm bg-[#1f1f1f]">
        <div
          className="h-1 rounded-sm transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, #22d3ee, #a78bfa)" }}
        />
      </div>
      <span className="relative min-w-0 shrink text-[11.5px] leading-none" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {learning ? (
            <motion.span
              key="learn"
              {...fade}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center gap-1.5 truncate font-semibold text-[#a5f3fc]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#22d3ee]" aria-hidden />
              <span className="truncate">{t("learning", { count: likes })}</span>
            </motion.span>
          ) : (
            <motion.span
              key="then"
              {...fade}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="block truncate text-[#a5f3fc]"
            >
              <span aria-hidden>✦ </span>
              {t("progressThen")}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
