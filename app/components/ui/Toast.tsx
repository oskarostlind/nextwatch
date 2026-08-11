"use client";

import { useEffect, useRef, useState } from "react";

type VibratingNavigator = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

/** Hur länge texten står kvar innan uttoningen startar. */
const VISIBLE_MS = 2200;
/** Måste matcha duration-200 nedan — elementet avmonteras först efteråt. */
const FADE_MS = 200;

export default function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  // visible styr in-/uttoningen; msg styr montering.
  const [visible, setVisible] = useState(false);
  // Timers i refs: en ny toast måste nolla den förras timers, annars kapades
  // det andra meddelandet av det förstas nedräkning.
  const hideTimer = useRef<number | null>(null);
  const unmountTimer = useRef<number | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (unmountTimer.current !== null) window.clearTimeout(unmountTimer.current);

      setMsg(m);
      setVisible(true);
      if (typeof navigator !== "undefined") {
        (navigator as VibratingNavigator).vibrate?.(30);
      }

      hideTimer.current = window.setTimeout(() => {
        setVisible(false);
        unmountTimer.current = window.setTimeout(() => setMsg(null), FADE_MS);
      }, VISIBLE_MS);
    };
    window.addEventListener("app:toast", on as EventListener);
    return () => {
      window.removeEventListener("app:toast", on as EventListener);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (unmountTimer.current !== null) window.clearTimeout(unmountTimer.current);
    };
  }, []);

  if (!msg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      // Ovanför BottomTabs + home indicator, annars hamnar toasten under raden.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 flex justify-center"
    >
      <div
        className={`pointer-events-auto rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow transition-[opacity,transform] duration-200 ease-out ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        }`}
      >
        {msg}
      </div>
    </div>
  );
}
