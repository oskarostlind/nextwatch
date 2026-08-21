"use client";

// Premium-CTA:n som visas EFTER en annons — ett bottenark, inte en ruta mitt på
// skärmen. Triggas av maybeTriggerAdUpsell() (lib/adUpsellEvent.ts): på webben
// när annonskortet lämnat däcket, i iOS-appen när AdMob-interstitialen stängts.
//
// Punkterna är INTE nyskrivna för den här ytan — de läses ur samma
// i18n-nycklar som /premium (namnrymden "premium": bulletAdFree, bulletSwipes,
// bulletGroups, bulletTaste). Varje punkt motsvarar en gate som faktiskt finns
// i koden (lib/ads.ts, lib/swipeLimit.ts, lib/groupLimits.ts,
// lib/tasteFeature.ts) — se tabellen i CLAUDE.md. Ändras en gate ändras texten
// på båda ställena samtidigt, och de kan aldrig glida isär.
//
// Köpknappen går genom goPremium() (lib/premiumPurchase.ts) = Apple IAP i
// iOS-appen, /premium på webben. Stripe får ALDRIG öppnas i appen (regel 3.1.1).

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Crown, PlayCircle, X } from "lucide-react";
import { goPremium } from "@/lib/premiumPurchase";
import { canOfferAdFreeReward, watchRewardedForAdFree } from "@/lib/admobAds";
import { notify } from "@/app/components/lib/notify";
// maybeTriggerAdUpsell bor i lib/adUpsellEvent.ts — se kommentaren där om
// varför den inte får ligga i den här (lat-laddade) filen.
import { UPSELL_EVENT, maybeTriggerAdUpsell, markUpsellSatisfied } from "@/lib/adUpsellEvent";
import { useTranslations } from "next-intl";

/** Samma fyra förmåner som /premium, i samma ordning. */
const BENEFIT_KEYS = ["bulletAdFree", "bulletSwipes", "bulletGroups", "bulletTaste"] as const;

export default function PremiumUpsellModal() {
  const t = useTranslations("upsell");
  const tp = useTranslations("premium");
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [watching, setWatching] = useState(false);
  // Rewarded-erbjudandet finns bara i native-appen (AdMob), aldrig på webben.
  const [rewardAvailable, setRewardAvailable] = useState(false);

  useEffect(() => {
    const onUpsell = () => {
      setRewardAvailable(canOfferAdFreeReward());
      setOpen(true);
    };
    // I native-appen triggas CTA:n av AdMob-interstitials (AdSense-korten som
    // driver maybeTriggerAdUpsell är avstängda där) — samma frekvensspärr.
    const onNativeAd = () => maybeTriggerAdUpsell();
    window.addEventListener(UPSELL_EVENT, onUpsell);
    window.addEventListener("nw:admob-ad-shown", onNativeAd);
    return () => {
      window.removeEventListener(UPSELL_EVENT, onUpsell);
      window.removeEventListener("nw:admob-ad-shown", onNativeAd);
    };
  }, []);

  // Samma rörelsespråk som HintSheet: arket fjädrar upp underifrån, backdropen
  // tonar. Bara transform + opacity (GPU-komposit).
  return (
    <AnimatePresence>
      {open ? (
        <div key="premium-upsell" className="fixed inset-0 z-[65] flex items-end justify-center">
          <motion.button
            type="button"
            aria-label={t("close")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            className="relative w-full max-w-md px-3 pb-[calc(env(safe-area-inset-bottom)+12px)]"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 32, mass: 0.9 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 600) setOpen(false);
            }}
          >
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/95 shadow-[0_18px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl">
              <div className="flex cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing">
                <span className="h-1 w-9 rounded-full bg-white/20" />
              </div>

              <button
                type="button"
                aria-label={t("close")}
                onClick={() => setOpen(false)}
                className="absolute right-6 top-6 rounded-full p-1 text-neutral-500 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="px-5 pb-5 pt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30">
                  <Crown className="h-3 w-3" /> Premium
                </span>

                <h2 className="mt-2.5 text-xl font-bold leading-snug text-white">{t("heading")}</h2>
                <p className="mt-1 text-sm text-neutral-400">{t("body")}</p>

                <ul className="mt-4 space-y-2">
                  {BENEFIT_KEYS.map((key, i) => (
                    <motion.li
                      key={key}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i + 0.1, duration: 0.24 }}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral-200"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      <span className="min-w-0">{tp(key)}</span>
                    </motion.li>
                  ))}
                </ul>

                <button
                  type="button"
                  disabled={buying}
                  onClick={() => {
                    setBuying(true);
                    markUpsellSatisfied();
                    void goPremium().finally(() => {
                      setBuying(false);
                      setOpen(false);
                    });
                  }}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 py-3.5 text-[15px] font-semibold text-neutral-950 transition hover:bg-amber-300 active:scale-[0.98] disabled:opacity-50"
                >
                  <Crown className="h-4 w-4" />
                  {buying ? t("opening") : t("cta")}
                </button>

                {rewardAvailable && (
                  <button
                    type="button"
                    disabled={watching}
                    onClick={() => {
                      setWatching(true);
                      void watchRewardedForAdFree()
                        .then((ok) => {
                          if (ok) {
                            markUpsellSatisfied();
                            notify("Klart! Annonsfritt i 24 timmar. 🎉");
                            setOpen(false);
                          }
                        })
                        .finally(() => setWatching(false));
                    }}
                    className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-50"
                  >
                    <PlayCircle className="h-4 w-4" />
                    {watching ? t("loadingVideo") : t("watchAd")}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-3 w-full py-1 text-center text-xs text-neutral-500 transition hover:text-neutral-300"
                >
                  {t("dismiss")}
                </button>

                {/* Pris, period och automatisk förnyelse i klartext vid
                    köptillfället — App Store-riktlinje 3.1.2(c). */}
                <p className="mt-2 text-center text-[11px] leading-relaxed text-neutral-600">{t("legal")}</p>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
