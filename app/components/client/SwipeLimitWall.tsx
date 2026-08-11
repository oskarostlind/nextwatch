"use client";

// Vägg som täcker swipe-ytan när gratisanvändarens dagliga swipegräns är nådd.
// Servern är källan till sanning (429 med error:"swipe_limit" från
// /api/rate, /api/swipe/decide, /api/group/vote) — den här komponenten speglar
// bara det i UI:t. Delas av solo-swipen och gruppswipen.
//
// Användning: rendera <SwipeLimitWall /> i swipe-vyns relativa rot, och anropa
// reportSwipeLimitFrom(res) (lib/swipeLimitEvent.ts) på svaren från
// swipe-anropen.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crown } from "lucide-react";
import { goPremium } from "@/lib/premiumPurchase";
// reportSwipeLimitFrom bor i lib/swipeLimitEvent.ts — se kommentaren där om
// varför den inte får ligga i den här (lat-laddade) filen.
import { SWIPE_LIMIT_EVENT } from "@/lib/swipeLimitEvent";

export default function SwipeLimitWall() {
  const [reached, setReached] = useState(false);
  const [buying, setBuying] = useState(false);
  // Servern äger gränsvärdet (lib/swipeLimit.ts) — 100 är bara defaulttext
  // tills /api/swipe/limit svarat.
  const [limit, setLimit] = useState(100);

  // Visa väggen direkt vid sidladdning om gränsen redan är nådd.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/swipe/limit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; allowed?: boolean; limit?: number | null } | null) => {
        if (cancelled || !j?.ok) return;
        if (typeof j.limit === "number") setLimit(j.limit);
        if (j.allowed === false) setReached(true);
      })
      .catch(() => {
        /* best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onLimit = () => setReached(true);
    window.addEventListener(SWIPE_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(SWIPE_LIMIT_EVENT, onLimit);
  }, []);

  // Samma rörelsespråk som Modal/TrailerModal: toning på backdrop, kritiskt
  // dämpad spring på panelen. Bara transform + opacity (GPU-komposit).
  return (
    <AnimatePresence>
      {reached ? (
        <div key="swipe-limit" className="absolute inset-0 z-40 flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0 bg-neutral-950/95 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            className="relative w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-neutral-900 p-6 text-center shadow-xl"
            initial={{ scale: 0.94, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <div className="text-3xl">🎬</div>
            <h2 className="text-lg font-semibold text-white">Du har nått dagens gräns</h2>
            <p className="text-sm leading-relaxed text-neutral-300">
              {limit} swipes per dag ingår gratis. Kom igen imorgon
              – eller bli Premium för obegränsat swipande.
            </p>
            <button
              type="button"
              disabled={buying}
              onClick={() => {
                setBuying(true);
                void goPremium().finally(() => setBuying(false));
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 font-semibold text-neutral-950 transition hover:bg-amber-300 disabled:opacity-50"
            >
              <Crown className="h-4 w-4" />
              {buying ? "Öppnar…" : "Bli Premium – 19 kr/mån"}
            </button>
            <p className="text-xs text-neutral-500">Gränsen nollställs löpande under dygnet.</p>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
