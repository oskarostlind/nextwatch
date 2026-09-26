"use client";

// Små, beroendefria SVG-grafer för admin-vyn. Medvetet inget chart-bibliotek:
// två grafformer räcker (staplar per dag + en kumulativ linje), och ett
// bibliotek hade vägt mer än hela admin-sidan.
//
// Varje graf visar EN serie (small multiples i stället för flera serier med
// dubbla axlar), har en hover-/touch-tooltip och en rubrik som sammanfattar
// perioden så att siffran går att läsa utan att hovra.

import { useMemo, useRef, useState } from "react";

export type Point = { day: string; value: number };

const WEEKDAYS = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];

function fmtDay(day: string, withWeekday = true): string {
  const d = new Date(`${day}T12:00:00`);
  const base = d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  return withWeekday ? `${WEEKDAYS[d.getDay()]} ${base}` : base;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function fmtNum(n: number): string {
  return n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

/** Hover/touch: index under pekaren ur x-positionen i plottytan. */
function usePointerIndex(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || count === 0) return;
    const r = el.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setIdx(Math.max(0, Math.min(count - 1, Math.floor(f * count))));
  };
  return {
    ref,
    idx,
    handlers: {
      onPointerMove: onMove,
      onPointerDown: onMove,
      onPointerLeave: () => setIdx(null),
    },
  };
}

type ChartProps = {
  title: string;
  /** Kort förklaring under rubriken. */
  hint?: string;
  data: Point[];
  /** Tailwind-färg för staplarna/linjen, t.ex. "#22d3ee". */
  color?: string;
  /** Vad rubriktalet visar: summa över perioden, snitt/dag eller senaste värdet. */
  summary?: "sum" | "avg" | "last";
  unit?: string;
  height?: number;
  kind?: "bar" | "line";
};

export function DailyChart({
  title,
  hint,
  data,
  color = "#22d3ee",
  summary = "sum",
  unit = "",
  height = 140,
  kind = "bar",
}: ChartProps) {
  const { ref, idx, handlers } = usePointerIndex(data.length);

  const { max, total, headline, today, yesterday } = useMemo(() => {
    const vals = data.map((d) => d.value);
    const total = vals.reduce((a, b) => a + b, 0);
    const rawMax = Math.max(0, ...vals);
    const headline =
      summary === "sum" ? total : summary === "avg" ? (vals.length ? total / vals.length : 0) : vals[vals.length - 1] ?? 0;
    return {
      max: kind === "line" ? rawMax : niceMax(rawMax),
      total,
      headline,
      today: vals[vals.length - 1] ?? 0,
      yesterday: vals[vals.length - 2] ?? 0,
    };
  }, [data, summary, kind]);

  const n = data.length;
  const W = 1000; // viewBox-bredd; höjden är riktiga px så stapelrundningen blir rätt
  const H = height;
  const slot = n > 0 ? W / n : W;
  const gap = n > 60 ? 1 : n > 20 ? 3 : 6;
  const barW = Math.max(1, slot - gap);

  // Linjen: skala mellan min och max så kumulativa kurvor inte blir platta.
  const lineMin = kind === "line" ? Math.min(...data.map((d) => d.value)) : 0;
  const span = Math.max(1, max - lineMin);
  const y = (v: number) => (kind === "line" ? H - 6 - ((v - lineMin) / span) * (H - 14) : H - (max > 0 ? (v / max) * H : 0));

  const linePath =
    kind === "line" && n > 0
      ? data.map((d, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * slot},${y(d.value)}`).join(" ")
      : "";
  const areaPath = linePath ? `${linePath} L${(n - 0.5) * slot},${H} L${0.5 * slot},${H} Z` : "";

  const active = idx != null ? data[idx] : null;
  const summaryLabel =
    summary === "sum" ? `totalt ${n} d` : summary === "avg" ? "snitt/dag" : "nu";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-white/40">{hint}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold tabular-nums text-white">
            {fmtNum(headline)}
            {unit && <span className="ml-0.5 text-sm font-medium text-white/50">{unit}</span>}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-white/35">{summaryLabel}</div>
        </div>
      </div>

      <div
        ref={ref}
        {...handlers}
        className="relative touch-pan-y select-none"
        style={{ height: H }}
        role="img"
        aria-label={`${title}: ${fmtNum(total)} under perioden`}
      >
        {/* Recessivt rutnät: bara baslinje + mittlinje. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-white/10" />
        {kind === "bar" && max > 0 && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-white/[0.06]" />
            <div className="pointer-events-none absolute left-0 top-0 -translate-y-full pb-0.5 text-[10px] tabular-nums text-white/30">
              {fmtNum(max)}
            </div>
          </>
        )}

        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {kind === "bar" &&
            data.map((d, i) => {
              const h = max > 0 ? (d.value / max) * H : 0;
              const dim = idx != null && idx !== i;
              return (
                <rect
                  key={d.day}
                  x={i * slot + gap / 2}
                  y={H - Math.max(h, d.value > 0 ? 2 : 0)}
                  width={barW}
                  height={Math.max(h, d.value > 0 ? 2 : 0)}
                  rx={Math.min(4, barW / 2)}
                  fill={color}
                  opacity={dim ? 0.35 : 0.9}
                />
              );
            })}
          {kind === "line" && (
            <>
              <path d={areaPath} fill={color} opacity={0.12} />
              <path d={linePath} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </>
          )}
          {active && (
            <line
              x1={(idx! + 0.5) * slot}
              x2={(idx! + 0.5) * slot}
              y1={0}
              y2={H}
              stroke="white"
              strokeOpacity={0.25}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {kind === "line" && active && (
          <div
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950"
            style={{ left: `${((idx! + 0.5) / n) * 100}%`, top: y(active.value), background: color }}
          />
        )}

        {active && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-neutral-900/95 px-2.5 py-1.5 text-xs shadow-xl"
            style={{
              left: `${((idx! + 0.5) / n) * 100}%`,
              transform: `translate(${idx! < n / 3 ? "-10%" : idx! > (2 * n) / 3 ? "-90%" : "-50%"}, -100%)`,
            }}
          >
            <div className="text-white/50">{fmtDay(active.day)}</div>
            <div className="font-semibold tabular-nums text-white">
              {fmtNum(active.value)}
              {unit && ` ${unit}`}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-white/35">
        <span>{data[0] ? fmtDay(data[0].day, false) : ""}</span>
        {kind === "bar" && n > 1 && (
          <span className="text-white/45">
            idag {fmtNum(today)} · igår {fmtNum(yesterday)}
          </span>
        )}
        <span>{data[n - 1] ? fmtDay(data[n - 1].day, false) : ""}</span>
      </div>
    </div>
  );
}
