"use client";

// Progress-raden i leken under första sessionen: "N av 10 – sedan väljer AI
// kvällens film" (prototypens steg 1–2). Cyan → violett, samma som ✦-knappen.

import { useTranslations } from "next-intl";
import { AI_REVEAL_AT } from "@/lib/firstSession";

export default function FsProgress({ swipes }: { swipes: number }) {
  const t = useTranslations("fsDeck");
  const n = Math.min(swipes, AI_REVEAL_AT);
  const pct = Math.round((n / AI_REVEAL_AT) * 100);
  return (
    <div
      className="flex shrink-0 flex-col gap-[7px] px-5 pb-1 pt-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={AI_REVEAL_AT}
      aria-valuenow={n}
      aria-label={t("progressAria", { count: n, total: AI_REVEAL_AT })}
    >
      <div className="flex items-center justify-between gap-3 text-[12px] text-neutral-400">
        <span className="tabular-nums">{t("progressCount", { count: n, total: AI_REVEAL_AT })}</span>
        <span className="truncate text-[#a5f3fc]">
          <span aria-hidden>✦ </span>
          {t("progressThen")}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-[#1f1f1f]">
        <div
          className="h-1 rounded-sm transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, #22d3ee, #a78bfa)" }}
        />
      </div>
    </div>
  );
}
