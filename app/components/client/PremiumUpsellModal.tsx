"use client";

// Diskret upsell-popup som visas efter var 3:e annons en gratisanvändare ser
// i swipe-däcket — max en gång per session (sessionStorage-cap så vi inte
// spammar). Triggas från swipe-vyn via maybeTriggerAdUpsell().

import { useEffect, useState } from "react";
import { Crown, PlayCircle, X } from "lucide-react";
import { goPremium } from "@/lib/premiumPurchase";
import { canOfferAdFreeReward, watchRewardedForAdFree } from "@/lib/admobAds";
import { notify } from "@/app/components/lib/notify";

const UPSELL_EVENT = "nw:premium-upsell";
const AD_COUNT_KEY = "nw_ad_impressions";
const SHOWN_KEY = "nw_upsell_shown";

/** Var N:e annons som triggar popupen. */
export const UPSELL_EVERY_N_ADS = 3;

/**
 * Registrera att ett annonskort visats. Var UPSELL_EVERY_N_ADS:e annons öppnas
 * popupen — men bara en gång per session.
 */
export function maybeTriggerAdUpsell(): void {
  try {
    const count = Number(sessionStorage.getItem(AD_COUNT_KEY) ?? "0") + 1;
    sessionStorage.setItem(AD_COUNT_KEY, String(count));
    if (count % UPSELL_EVERY_N_ADS !== 0) return;
    if (sessionStorage.getItem(SHOWN_KEY)) return;
    sessionStorage.setItem(SHOWN_KEY, "1");
    window.dispatchEvent(new Event(UPSELL_EVENT));
  } catch {
    /* sessionStorage otillgänglig (privat läge etc.) — hoppa över upsell */
  }
}

export default function PremiumUpsellModal() {
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
    // I native-appen triggas upsellen av AdMob-interstitials (AdSense-korten
    // som drev maybeTriggerAdUpsell är avstängda där) — samma sessions-cap.
    const onNativeAd = () => maybeTriggerAdUpsell();
    window.addEventListener(UPSELL_EVENT, onUpsell);
    window.addEventListener("nw:admob-ad-shown", onNativeAd);
    return () => {
      window.removeEventListener(UPSELL_EVENT, onUpsell);
      window.removeEventListener("nw:admob-ad-shown", onNativeAd);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="relative w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-neutral-900 p-6 text-center shadow-2xl">
        <button
          type="button"
          aria-label="Stäng"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-3xl">✨</div>
        <h2 className="text-lg font-semibold text-white">Trött på annonser?</h2>
        <p className="text-sm leading-relaxed text-neutral-300">
          Bli Premium för 19 kr/mån — helt annonsfritt och obegränsat med swipes.
        </p>
        <button
          type="button"
          disabled={buying}
          onClick={() => {
            setBuying(true);
            void goPremium().finally(() => {
              setBuying(false);
              setOpen(false);
            });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 font-semibold text-neutral-950 transition hover:bg-amber-300 disabled:opacity-50"
        >
          <Crown className="h-4 w-4" />
          {buying ? "Öppnar…" : "Bli Premium – 19 kr/mån"}
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
                    notify("Klart! Annonsfritt i 24 timmar. 🎉");
                    setOpen(false);
                  }
                })
                .finally(() => setWatching(false));
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            <PlayCircle className="h-4 w-4" />
            {watching ? "Laddar video…" : "Titta på en video – slipp annonser i 24h"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
        >
          Nej tack, fortsätt swipa
        </button>
      </div>
    </div>
  );
}
