"use client";

// Diskret, alltid synlig uppgraderings-ingång för gratisanvändare: en liten
// kron-chip uppe till höger i appskalet. Premium-användare (och utloggade)
// ser ingenting. Webb -> /premium, iOS -> Apple IAP (via goPremium).

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { goPremium } from "@/lib/premiumPurchase";

export default function PremiumBadge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/billing/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; isPremium?: boolean } | null) => {
        if (!cancelled && j?.ok && !j.isPremium) setShow(true);
      })
      .catch(() => {
        /* vid fel: visa ingen badge */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => void goPremium()}
      className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300 backdrop-blur transition hover:bg-amber-400/20"
    >
      <Crown className="h-3.5 w-3.5" />
      Premium
    </button>
  );
}
