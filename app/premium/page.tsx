"use client";

import { useEffect, useState } from "react";
import { Button, Card, Note, PageHeader } from "@/app/components/ui/kit";
import {
  isNativeIos,
  restorePremiumPurchases,
  startPremiumPurchase,
} from "@/lib/premiumPurchase";

export default function PremiumPage() {
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
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

  async function restore() {
    setErr("");
    setRestoring(true);
    try {
      const result = await restorePremiumPurchases();
      if (result.ok) {
        window.location.href = "/premium/success";
        return;
      }
      if (!result.cancelled) setErr(result.message || "Kunde inte återställa köp.");
    } finally {
      setRestoring(false);
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
          <>
            <button
              type="button"
              onClick={restore}
              disabled={loading || restoring}
              className="w-full text-center text-xs text-neutral-400 underline underline-offset-2 transition hover:text-neutral-200 disabled:opacity-50"
            >
              {restoring ? "Återställer…" : "Återställ tidigare köp"}
            </button>
          </>
        )}

        {/* App Store-riktlinje 3.1.2 kräver att själva appen — inte bara
            App Store-beskrivningen — visar prenumerationens namn, längd och pris
            samt nåbara länkar till användarvillkor (EULA) och integritetspolicy
            vid köptillfället. */}
        <div className="space-y-2 border-t border-white/10 pt-4 text-xs leading-relaxed text-neutral-500">
          <p>
            <span className="font-medium text-neutral-300">NextWatch Premium</span> — 19 kr per
            månad. Prenumerationen förnyas automatiskt varje månad tills du säger upp den.
          </p>
          {onIos ? (
            <p>
              Betalningen dras från ditt Apple-konto när du bekräftar köpet. Förnyelsen sker
              inom 24 timmar före periodens slut om du inte säger upp innan dess. Du hanterar
              och avslutar prenumerationen i Inställningar på din enhet.
            </p>
          ) : (
            <p>Betalningen hanteras av Stripe. Du kan avsluta prenumerationen när som helst.</p>
          )}
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <a
              href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 transition hover:text-neutral-300"
            >
              Användarvillkor (EULA)
            </a>
            <a href="/legal/terms" className="underline underline-offset-2 transition hover:text-neutral-300">
              Våra villkor
            </a>
            <a href="/legal/privacy" className="underline underline-offset-2 transition hover:text-neutral-300">
              Integritetspolicy
            </a>
          </p>
        </div>
        {err && <Note tone="error">{err}</Note>}
      </Card>
    </div>
  );
}
