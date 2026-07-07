"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { GuideStep } from "@/lib/guideSteps";
import type { GuideId } from "@/lib/userGuide";
import { markGuideSeen } from "@/lib/userGuide";

type Rect = { top: number; left: number; width: number; height: number };

type Props = {
  guideId: GuideId;
  steps: GuideStep[];
  open: boolean;
  onClose: () => void;
  onStepChange?: (index: number, step: GuideStep) => void;
};

function findTarget(selector: string | undefined): Element | null {
  if (!selector || typeof document === "undefined") return null;
  return document.querySelector(`[data-guide="${selector}"]`);
}

function measure(el: Element | null, pad = 8): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

/** Reserverat utrymme för BottomTabs + safe-area (+ marginal). */
function bottomChromeInset(): number {
  if (typeof window === "undefined") return 88;
  const tabs = document.querySelector(".sticky.bottom-0");
  if (tabs) {
    const r = tabs.getBoundingClientRect();
    return Math.max(72, window.innerHeight - r.top + 12);
  }
  return 88;
}

function computeTooltipStyle(
  spot: Rect | null,
  step: GuideStep,
  tooltipH: number
): CSSProperties {
  const margin = 16;
  const gap = 12;
  const maxW = Math.min(320, window.innerWidth - margin * 2);
  const bottomInset = bottomChromeInset();

  if (!spot || step.placement === "center") {
    return {
      position: "fixed",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: maxW,
      width: `calc(100% - ${margin * 2}px)`,
    };
  }

  const centeredLeft = spot.left + spot.width / 2 - maxW / 2;
  const left = Math.max(margin, Math.min(centeredLeft, window.innerWidth - maxW - margin));

  if (step.placement === "top") {
    const bottomFromViewport = window.innerHeight - spot.top + gap;
    const maxBottom = window.innerHeight - margin;
    return {
      position: "fixed",
      left,
      bottom: Math.min(bottomFromViewport, maxBottom),
      maxWidth: maxW,
    };
  }

  // placement bottom (default): prefer below target, flip above if needed
  let top = spot.top + spot.height + gap;
  const availableBelow = window.innerHeight - bottomInset - margin - top;
  if (availableBelow < tooltipH) {
    top = Math.max(margin, spot.top - gap - tooltipH);
  }
  top = Math.min(top, window.innerHeight - bottomInset - tooltipH - margin);
  top = Math.max(margin, top);

  return {
    position: "fixed",
    left,
    top,
    maxWidth: maxW,
  };
}

export default function GuideOverlay({ guideId, steps, open, onClose, onStepChange }: Props) {
  const [mounted, setMounted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [tooltipH, setTooltipH] = useState(180);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;

  const finish = useCallback(() => {
    markGuideSeen(guideId);
    onClose();
  }, [guideId, onClose]);

  const reposition = useCallback(() => {
    if (!step) return;
    if (!step.target || step.placement === "center") {
      setSpot(null);
      return;
    }
    const el = findTarget(step.target);
    if (!el) {
      setSpot(null);
      return;
    }
    setSpot(measure(el));
  }, [step]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      setSpot(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !step) return;
    reposition();
    const onResize = () => reposition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, step, stepIndex, reposition]);

  useEffect(() => {
    if (!open || !step) return;
    onStepChange?.(stepIndex, step);
  }, [open, step, stepIndex, onStepChange]);

  // Hoppa över steg vars target saknas (t.ex. group-start-swipe när ingen grupp).
  useEffect(() => {
    if (!open || !step?.target) return;
    const el = findTarget(step.target);
    if (!el && stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    }
  }, [open, step, stepIndex, steps.length]);

  // Mät tooltip-höjd efter render för smart placering
  useEffect(() => {
    if (!open || !tooltipRef.current) return;
    const h = tooltipRef.current.getBoundingClientRect().height;
    if (h > 0 && Math.abs(h - tooltipH) > 4) setTooltipH(h);
  }, [open, step, stepIndex, spot, tooltipH]);

  // #region agent log
  useEffect(() => {
    if (!open || !step || typeof window === "undefined") return;
    const el = tooltipRef.current;
    const tr = el?.getBoundingClientRect();
    const naiveTop = spot ? spot.top + spot.height + 12 : null;
    fetch("http://127.0.0.1:7635/ingest/a9407576-b1bc-470a-b950-dd4fe9204616", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6d1022" },
      body: JSON.stringify({
        sessionId: "6d1022",
        hypothesisId: "A-B",
        location: "GuideOverlay.tsx:layout",
        message: "guide tooltip layout",
        data: {
          guideId,
          stepIndex,
          stepTitle: step.title,
          placement: step.placement ?? "bottom",
          spot,
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
          naiveTop,
          naiveOverflow: naiveTop != null ? naiveTop + (tr?.height ?? tooltipH) - window.innerHeight : null,
          actualTop: tr?.top ?? null,
          actualBottom: tr?.bottom ?? null,
          tooltipH: tr?.height ?? tooltipH,
          bottomInset: bottomChromeInset(),
          buttonsVisible: tr ? tr.bottom <= window.innerHeight - 8 : null,
        },
        timestamp: Date.now(),
        runId: "post-fix",
      }),
    }).catch(() => {});
  }, [open, step, stepIndex, spot, guideId, tooltipH]);
  // #endregion

  if (!mounted || !open || !step) return null;

  const tooltipStyle = computeTooltipStyle(spot, step, tooltipH);

  return createPortal(
    <div className="fixed inset-0 z-[60]" aria-modal role="dialog">
      {/* Spotlight */}
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

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="pointer-events-auto z-[61] max-h-[min(52dvh,360px)] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-4 shadow-xl"
        style={tooltipStyle}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400/80">
          {stepIndex + 1} / {steps.length}
        </p>
        <h3 className="mt-1 text-lg font-bold text-white">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-300">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-sm text-neutral-400 transition hover:text-white"
          >
            Hoppa över
          </button>
          <button
            type="button"
            onClick={() => {
              if (isLast) finish();
              else setStepIndex((i) => i + 1);
            }}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400"
          >
            {isLast ? "Klart" : "Nästa"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
