"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import LoginCard from "./LoginCard";

/**
 * Inloggning för befintliga konton, som ett ark underifrån.
 *
 * Varför sheet och inte ett formulär på sidan: startsidan är spelbar, och heron
 * behöver hela ytan för att gesten ska vara det första man gör. Men startsidan är
 * också iOS-appens launch-skärm för utloggade — utan en väg in låser vi ute alla
 * befintliga konton, inklusive Sign in with Apple. Arket är kompromissen:
 * heron äger ytan, återkommande användare betalar ett tap.
 *
 * LoginCard återanvänds orörd och bär e-post/lösenord, Apple och glömt-lösenord.
 */
export default function LoginSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Esc stänger, och bakgrunden ska inte gå att scrolla bakom arket.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Logga in"
            className="fixed inset-x-0 bottom-0 z-[61] max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-neutral-950 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" aria-hidden />
            <div className="mx-auto w-full max-w-md">
              <LoginCard />
              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full rounded-xl py-2.5 text-sm text-white/50 transition hover:text-white/80"
              >
                Tillbaka
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
