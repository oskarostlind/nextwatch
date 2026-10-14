"use client";

// Startsidans huvudknapp på webben ("nya flödet", 2026-10-15): rakt in i den
// riktiga leken som gäst — ingen spärr, inget gäst-eller-konto-val. Gästprofilen
// skapas som i GuestEntryButton (POST /api/profile/guest), och för en NY enhet
// startar första sessionen (lib/firstSession.ts) — se createGuestProfile.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createGuestProfile } from "@/app/components/firstSession/deck/fsDeck";

export default function StartSwipingButton({ accent }: { accent: string }) {
  const t = useTranslations("fsDeck");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    const ok = await createGuestProfile("web");
    if (ok) {
      // Full sidnavigering så att server-grinden i /swipe ser den nya profilen
      // (samma skäl som i GuestEntryButton).
      window.location.href = "/swipe";
      return;
    }
    setFailed(true);
    setLoading(false);
  }

  return (
    <div className="flex w-full flex-col items-center">
      <button
        type="button"
        onClick={() => void start()}
        disabled={loading}
        className="w-full rounded-xl py-3 text-center text-[15px] font-semibold text-black transition-transform active:scale-[0.98] disabled:opacity-70"
        style={{
          background: `linear-gradient(180deg, ${accent} 0%, ${accent}D9 100%)`,
          boxShadow: `0 8px 24px -8px ${accent}`,
        }}
      >
        {loading ? t("starting") : t("startSwiping")}
      </button>
      {failed ? <p className="mt-2 text-center text-sm text-red-400">{t("startFailed")}</p> : null}
    </div>
  );
}
