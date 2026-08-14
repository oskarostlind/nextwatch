"use client";

import { useState } from "react";
import { replayAnonLikes } from "@/lib/anonLikes";
import { useTranslations } from "next-intl";

/**
 * Ett klick in i gästläge: skapar en minimal profil (utan onboarding) och
 * skickar användaren rakt till swipen. Full sidnavigering (inte router.push) så
 * att server-grinden i /swipe ser den nya profilen.
 */
export default function GuestEntryButton({
  className,
  label,
}: {
  className?: string;
  /** Utelämnad = standardtexten "Hoppa in som gäst" på valt språk. */
  label?: string;
}) {
  const t = useTranslations("auth");
  const buttonLabel = label ?? t("guestEntry");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/guest", { method: "POST", cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && j.ok) {
        // Startsidans hero lovar att swipesen "följer med". Gästen får en riktig
        // profil här, så löftet infrias direkt — best-effort, precis som i
        // onboardingen.
        await replayAnonLikes().catch(() => 0);
        window.location.href = "/swipe";
        return;
      }
      setError(j.message ?? t("guestFailed"));
    } catch {
      setError(t("networkErrorDot"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void start()}
        disabled={loading}
        className={
          className ??
          "w-full rounded-xl border border-white/15 bg-white/5 py-2 font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
        }
      >
        {loading ? t("starting") : buttonLabel}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
