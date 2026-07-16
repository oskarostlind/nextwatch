"use client";

import { useState } from "react";

/**
 * Ett klick in i gästläge: skapar en minimal profil (utan onboarding) och
 * skickar användaren rakt till swipen. Full sidnavigering (inte router.push) så
 * att server-grinden i /swipe ser den nya profilen.
 */
export default function GuestEntryButton({
  className,
  label = "Hoppa in som gäst",
}: {
  className?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/guest", { method: "POST", cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && j.ok) {
        window.location.href = "/swipe";
        return;
      }
      setError(j.message ?? "Kunde inte starta gästläge.");
    } catch {
      setError("Nätverksfel.");
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
        {loading ? "Startar…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
