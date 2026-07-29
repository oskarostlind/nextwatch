"use client";

// Generiskt coach-mark-steg (läge 2 i tour-motorn): spotlight runt ett
// data-tour="..."-element + en tooltip med Nästa/Klart. Byggd nu, används av
// fas 2:s genomgångar (vänner, grupper, watchlist) — ingen fas-1-content
// använder den ännu, men den ligger klar utan koppling till en specifik tour.
//
// Medvetet fristående från app/components/client/GuideOverlay.tsx (samma idé,
// men den är hårt kopplad till lib/userGuide.ts's localStorage-flaggor för de
// tre äldre passiva guiderna). Den här drivs helt av props så tour-motorn kan
// styra state (server-persisterad progress) utan att röra den äldre koden.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CoachTourStep } from "@/lib/tours/types";

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(selector: string | undefined): Element | null {
  if (!selector || typeof document === "undefined") return null;
  return document.querySelector(`[data-tour="${selector}"]`);
}

function measure(el: Element | null, pad = 8): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

export default function CoachMarkStep({
  step,
  index,
  total,
  onNext,
  onSkip,
}: {
  step: CoachTourStep;
  index: number;
  total: number;
  onNext: () => void;
  /** Utelämnad = ingen "Hoppa över"-knapp (t.ex. första steget). */
  onSkip?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [spot, setSpot] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipH, setTooltipH] = useState(160);

  const reposition = useCallback(() => {
    if (!step.target || step.placement === "center") {
      setSpot(null);
      return;
    }
    setSpot(measure(findTarget(step.target)));
  }, [step.target, step.placement]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    reposition();
    const onResize = () => reposition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [reposition]);

  useEffect(() => {
    if (!tooltipRef.current) return;
    const h = tooltipRef.current.getBoundingClientRect().height;
    if (h > 0 && Math.abs(h - tooltipH) > 4) setTooltipH(h);
  }, [spot, tooltipH]);

  if (!mounted) return null;

  const margin = 16;
  const maxW = Math.min(320, window.innerWidth - margin * 2);
  let tooltipStyle: CSSProperties;
  if (!spot) {
    tooltipStyle = {
      position: "fixed",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: maxW,
      width: `calc(100% - ${margin * 2}px)`,
    };
  } else {
    const centeredLeft = spot.left + spot.width / 2 - maxW / 2;
    const left = Math.max(margin, Math.min(centeredLeft, window.innerWidth - maxW - margin));
    const gap = 12;
    let top = spot.top + spot.height + gap;
    if (top + tooltipH > window.innerHeight - margin) top = Math.max(margin, spot.top - gap - tooltipH);
    tooltipStyle = { position: "fixed", left, top, maxWidth: maxW };
  }

  return createPortal(
    <div className="fixed inset-0 z-[70]" aria-modal role="dialog">
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-cyan-400/80"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.78)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/78" />
      )}
      <div
        ref={tooltipRef}
        className="pointer-events-auto z-[71] max-h-[min(52dvh,360px)] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-4 shadow-xl"
        style={tooltipStyle}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400/80">
          {index + 1} / {total}
        </p>
        <h3 className="mt-1 text-lg font-bold text-white">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-300">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          {onSkip ? (
            <button type="button" onClick={onSkip} className="text-sm text-neutral-400 transition hover:text-white">
              Hoppa över
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400"
          >
            {index >= total - 1 ? "Klart" : "Nästa"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
