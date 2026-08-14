"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";

type Props = {
  title: string;
  year: string | null;
  rating: number | null;
  overview?: string;
  providers: string[];
  unknown: boolean;
  className?: string;
  onNope: () => void;
  onLike: () => void;
  onwatchlist: () => void;
};

function fmtRating(v: number | null): string {
  if (v == null) return "–";
  return (Math.round(v * 10) / 10).toFixed(1);
}

export default function InfoPanel({
  title,
  year,
  rating,
  overview,
  providers,
  unknown,
  onNope,
  onLike,
  onwatchlist,
  className,
}: Props) {
  const t = useTranslations("common");
  const chips = providers.length ? providers : unknown ? [t("unknown")] : [];

  return (
    <aside
      className={clsx(
        "hidden md:block",
        "sticky top-4 h-fit rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur shadow",
        className
      )}
    >
      <div className="mb-1 text-lg font-semibold line-clamp-2">{title}</div>
      <div className="mb-3 text-sm opacity-80">
        {year ?? "—"} · ★ {fmtRating(rating)}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {chips.map((p) => (
          <span
            key={p}
            className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs"
          >
            {p}
          </span>
        ))}
      </div>

      <p className="text-sm opacity-90 whitespace-pre-line">
        {overview || "Ingen beskrivning."}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          onClick={onNope}
          className="rounded-xl border border-red-500/40 bg-red-600/20 py-2 text-sm hover:bg-red-600/30"
        >
          Nej
        </button>
        <button
          onClick={onwatchlist}
          className="rounded-xl border border-cyan-500/40 bg-cyan-600/20 py-2 text-sm hover:bg-cyan-600/30"
        >
          watchlist
        </button>
        <button
          onClick={onLike}
          className="rounded-xl border border-green-500/40 bg-green-600/20 py-2 text-sm hover:bg-green-600/30"
        >
          Ja
        </button>
      </div>
    </aside>
  );
}
