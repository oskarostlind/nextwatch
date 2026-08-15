"use client";

// Vägg som täcker swipe-ytan när gratisanvändarens dagliga swipegräns är nådd.
// Servern är källan till sanning (429 med error:"swipe_limit" från
// /api/rate, /api/swipe/decide, /api/group/vote) — den här komponenten speglar
// bara det i UI:t. Delas av solo-swipen och gruppswipen.
//
// Två vägar vidare: Premium (webb + iOS), eller på native iOS en rewarded
// video → +100 swipes (max 3/dygn, servern äger reglerna via
// /api/swipe/bonus). Erbjudandet styrs av rewardedRemaining från
// /api/swipe/limit — 0 för premium, webben och när dygnstaket är nått, så
// knappen kan aldrig visas när den inte kan levereras.
//
// Användning: rendera <SwipeLimitWall /> i swipe-vyns relativa rot, och anropa
// reportSwipeLimitFrom(res) (lib/swipeLimitEvent.ts) på svaren från
// swipe-anropen.

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, PlayCircle } from "lucide-react";
import { goPremium, isNativeIos } from "@/lib/premiumPurchase";
import { watchRewardedForSwipes } from "@/lib/admobAds";
// reportSwipeLimitFrom bor i lib/swipeLimitEvent.ts — se kommentaren där om
// varför den inte får ligga i den här (lat-laddade) filen.
import { SWIPE_LIMIT_EVENT } from "@/lib/swipeLimitEvent";
import { useTranslations } from "next-intl";

type LimitDTO = {
  ok?: boolean;
  allowed?: boolean;
  limit?: number | null;
  baseLimit?: number | null;
  rewardedRemaining?: number;
  rewardedBonus?: number;
};

export default function SwipeLimitWall() {
  const t = useTranslations("swipeLimit");
  const [reached, setReached] = useState(false);
  const [buying, setBuying] = useState(false);
  // Servern äger gränsvärdet (lib/swipeLimit.ts) — 100 är bara defaulttext
  // tills /api/swipe/limit svarat.
  const [limit, setLimit] = useState(100);
  const [rewardedLeft, setRewardedLeft] = useState(0);
  const [rewardedBonus, setRewardedBonus] = useState(100);
  const [watching, setWatching] = useState(false);
  const [rewardFailed, setRewardFailed] = useState(false);

  const refresh = useCallback((markReachedIfBlocked: boolean) => {
    void fetch("/api/swipe/limit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: LimitDTO | null) => {
        if (!j?.ok) return;
        // baseLimit är grundgränsen utan bonusar — det är den texten lovar.
        const base = typeof j.baseLimit === "number" ? j.baseLimit : j.limit;
        if (typeof base === "number") setLimit(base);
        if (typeof j.rewardedRemaining === "number") setRewardedLeft(j.rewardedRemaining);
        if (typeof j.rewardedBonus === "number") setRewardedBonus(j.rewardedBonus);
        if (markReachedIfBlocked && j.allowed === false) setReached(true);
      })
      .catch(() => {
        /* best-effort */
      });
  }, []);

  // Visa väggen direkt vid sidladdning om gränsen redan är nådd.
  useEffect(() => {
    refresh(true);
  }, [refresh]);

  useEffect(() => {
    const onLimit = () => {
      setReached(true);
      // Hämta om allowancen så rewarded-erbjudandet speglar serverns läge.
      refresh(false);
    };
    window.addEventListener(SWIPE_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(SWIPE_LIMIT_EVENT, onLimit);
  }, [refresh]);

  const offerRewarded = isNativeIos() && rewardedLeft > 0;

  const onWatchRewarded = () => {
    if (watching) return;
    setWatching(true);
    setRewardFailed(false);
    void watchRewardedForSwipes()
      .then((ok) => {
        if (ok) {
          // Servern har beviljat bonusen — 429-spärren är släppt, ta ner väggen.
          setReached(false);
          setRewardedLeft((n) => Math.max(0, n - 1));
        } else {
          setRewardFailed(true);
        }
      })
      .finally(() => setWatching(false));
  };

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
            <h2 className="text-lg font-semibold text-white">{t("heading")}</h2>
            <p className="text-sm leading-relaxed text-neutral-300">
              {t("body", { limit })}
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
              {buying ? t("opening") : t("cta")}
            </button>
            {offerRewarded ? (
              <>
                <button
                  type="button"
                  disabled={watching}
                  onClick={onWatchRewarded}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  <PlayCircle className="h-4 w-4" />
                  {watching ? t("watchAdBusy") : t("watchAd", { bonus: rewardedBonus })}
                </button>
                <p className="text-xs text-neutral-500">
                  {rewardFailed ? t("watchAdFailed") : t("watchAdLeft", { count: rewardedLeft })}
                </p>
              </>
            ) : null}
            <p className="text-xs text-neutral-500">{t("resetHint")}</p>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
