"use client";

// Progress-raden i leken under första sessionen: "N av 10 – sedan väljer AI
// kvällens film" (prototypens steg 1–2). Cyan → violett, samma som ✦-knappen.
// Under stapeln: lärchipen ("N gillade – vi lär oss din smak") efter
// FS_LEARN_AT gilla. Raden för chipen är reserverad från start så kortet under
// inte krymper/hoppar i samma stund som chipen dyker upp.

import { useTranslations } from "next-intl";
import { AI_REVEAL_AT } from "@/lib/firstSession";
import FsLearnChip from "./FsLearnChip";
import { FS_LEARN_AT } from "./fsDeck";

export default function FsProgress({ swipes, likes = 0 }: { swipes: number; likes?: number }) {
  const t = useTranslations("fsDeck");
  const n = Math.min(swipes, AI_REVEAL_AT);
  const pct = Math.round((n / AI_REVEAL_AT) * 100);
  return (
    <div className="flex shrink-0 flex-col gap-[7px] px-5 pb-0.5 pt-2">
      <div
        className="flex flex-col gap-[7px]"
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
      <div className="flex h-[20px] items-center">
        {likes >= FS_LEARN_AT ? <FsLearnChip likes={likes} /> : null}
      </div>
    </div>
  );
}
