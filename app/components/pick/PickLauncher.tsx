"use client";

// "Välj åt mig" — den lilla ✦-knappen i swipens topprad. Självständig: hämtar
// kvoten/utrullningsflaggan själv (cachas i lib/aiPick/client.ts), renderar
// ingenting när funktionen inte är på för användaren, och äger arket.
//
// Arket laddas lat (dynamic) först när knappen tryckts: swipe-fliken är
// prestandakänslig i WKWebView (se kommentaren överst i app/swipe/page_client.tsx)
// och de flesta sessioner öppnar aldrig arket.
//
// Coachmarken ("Nytt: låt AI välja åt dig") visas EN gång per enhet, strax
// efter att sidan satt sig och bara när inget annat ark ligger öppet.

import { useCallback, useEffect, useRef, useState } from "react";
import { getFs } from "@/lib/firstSession";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PickQuota } from "@/lib/aiPick/types";
import { cachedPickStatus, getPickStatus, trackPickEvent } from "@/lib/aiPick/client";
import { blockingSheetOpen } from "@/lib/engagement";

const PickSheet = dynamic(() => import("@/app/components/pick/PickSheet"), { ssr: false });

const COACH_KEY = "nw_pick_coach_v1";
const COACH_DELAY_MS = 1200;
const COACH_VISIBLE_MS = 6000;

function coachSeen(): boolean {
  try {
    return window.localStorage.getItem(COACH_KEY) === "1";
  } catch {
    // Utan localStorage (privat läge o.dyl.) hellre ingen coachmark än en som
    // dyker upp vid varje besök.
    return true;
  }
}

function inFirstSession(): boolean {
  const fs = getFs();
  return fs.eligible && fs.step !== "done";
}

function markCoachSeen(): void {
  try {
    window.localStorage.setItem(COACH_KEY, "1");
  } catch {
    /* best effort */
  }
}

export default function PickLauncher() {
  const t = useTranslations("pick");
  const [quota, setQuota] = useState<PickQuota | null>(() => cachedPickStatus());
  const [open, setOpen] = useState(false);
  // Arket monteras först vid första öppningen och ligger sedan kvar (för
  // exit-animationen och så att det inte laddas om vid nästa tryck).
  const [sheetMounted, setSheetMounted] = useState(false);
  const [coach, setCoach] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void getPickStatus().then((q) => {
      if (alive && q) setQuota(q);
    });
    return () => {
      alive = false;
    };
  }, []);

  const enabled = Boolean(quota?.enabled);

  // Värm arkets chunk när sidan satt sig, så första trycket inte väntar på nätet.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => void import("@/app/components/pick/PickSheet"), 2500);
    return () => window.clearTimeout(id);
  }, [enabled]);

  // Coachmark: en gång, efter en kort fördröjning, aldrig ovanpå ett annat ark.
  useEffect(() => {
    if (!enabled || coachSeen()) return;
    const show = window.setTimeout(() => {
      if (blockingSheetOpen()) return; // försök igen nästa besök
      // Första sessionen (nya flödet): AI-steget vid 10 swipes ÄR introt, och
      // bubblan låg över "Har du konto? Logga in". Visas nästa besök i stället.
      if (inFirstSession()) return;
      markCoachSeen();
      setCoach(true);
    }, COACH_DELAY_MS);
    return () => window.clearTimeout(show);
  }, [enabled]);

  useEffect(() => {
    if (!coach) return;
    const hide = window.setTimeout(() => setCoach(false), COACH_VISIBLE_MS);
    return () => window.clearTimeout(hide);
  }, [coach]);

  const onOpen = useCallback(() => {
    setCoach(false);
    setSheetMounted(true);
    setOpen(true);
    trackPickEvent("open");
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    // Fokus tillbaka till knappen som öppnade arket.
    window.setTimeout(() => buttonRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  if (!enabled) return null;

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        aria-label={t("launcherAria")}
        aria-haspopup="dialog"
        aria-expanded={open}
        // after:-inset-1 ger 48pt träffyta utan att knappen ser större ut.
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-white/55 transition after:absolute after:-inset-1 hover:bg-white/5 hover:text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 active:scale-95"
      >
        <Sparkles className="h-5 w-5" aria-hidden />
      </button>

      <AnimatePresence>
        {coach ? (
          <motion.button
            key="pick-coach"
            type="button"
            onClick={() => setCoach(false)}
            aria-label={t("coachmarkDismiss")}
            className="absolute left-0 top-full z-30 mt-2 flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-neutral-800 px-3 py-2 text-xs font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 380, damping: 39 }}
          >
            {/* Pil upp mot knappen. */}
            <span
              aria-hidden
              className="absolute -top-1 left-4 h-2 w-2 rotate-45 bg-neutral-800 ring-1 ring-white/10 [clip-path:polygon(0_0,100%_0,0_100%)]"
            />
            <Sparkles className="h-3.5 w-3.5 text-cyan-300" aria-hidden />
            <span>{t("coachmark")}</span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      {sheetMounted ? <PickSheet open={open} onClose={onClose} initialQuota={quota} /> : null}
    </div>
  );
}
