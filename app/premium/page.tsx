"use client";

import { useEffect, useState } from "react";
import { Button, Card, Note, PageHeader } from "@/app/components/ui/kit";
import { isNativeIos, startPremiumPurchase } from "@/lib/premiumPurchase";

export default function PremiumPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  // Avgörs i effect (inte vid render) så SSR-html:en är stabil.
  const [onIos, setOnIos] = useState(false);

  useEffect(() => {
    setOnIos(isNativeIos());
  }, []);

  async function buy() {
    setErr("");
    setLoading(true);
    try {
      // Plattformsmedveten: native iOS -> Apple IAP, webb -> Stripe Checkout.
      const result = await startPremiumPurchase();
      if (result.ok) {
        if (isNativeIos()) window.location.href = "/premium/success";
        // Webb: Stripe-redirecten har redan skett.
        return;
      }
      if (!result.cancelled) setErr(result.message || "Kunde inte starta betalning");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader
        eyebrow="Uppgradera"
        title="Premium"
        subtitle="19 kr/mån – avsluta när du vill."
      />
      <Card className="space-y-4">
        <p className="text-sm text-neutral-300">
          Ta bort annonser och swipa obegränsat. 19 kr/mån, inga bindningstider.
        </p>
        <ul className="space-y-2 text-sm text-neutral-200">
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Helt annonsfritt</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Obegränsat med swipes</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Större grupper</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Stötta utvecklingen</li>
        </ul>
        <Button onClick={buy} disabled={loading} className="w-full">
          {loading
            ? onIos
              ? "Öppnar App Store…"
              : "Startar Stripe…"
            : "Bli Premium – 19 kr/mån"}
        </Button>
        {onIos && (
          <p className="text-center text-xs text-neutral-500">
            Betalningen hanteras av App Store och kan avslutas i dina Apple-inställningar.
          </p>
        )}
        {err && <Note tone="error">{err}</Note>}
      </Card>
    </div>
  );
}
