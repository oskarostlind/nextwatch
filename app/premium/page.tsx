"use client";

import { useEffect, useState } from "react";
import { Button, Card, Note, PageHeader } from "@/app/components/ui/kit";
import { useTranslations } from "next-intl";
import {
  isNativeIos,
  restorePremiumPurchases,
  startPremiumPurchase,
} from "@/lib/premiumPurchase";

export default function PremiumPage() {
  const t = useTranslations("premium");
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
      if (!result.cancelled) setErr(result.message || t("restoreFailed"));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        title="Premium"
        subtitle={t("subtitle")}
      />
      <Card className="space-y-4">
        <p className="text-sm text-neutral-300">
          {t("intro")}
        </p>
        {/* Varje punkt måste motsvara en gate som FAKTISKT finns i koden — annars
            säljer vi något användaren redan har. Siffrorna speglar defaultvärdena
            i lib/swipeLimit.ts (100/dygn) och lib/groupLimits.ts (3 resp. 20);
            ändras de env-variablerna måste texten här ändras med. */}
        <ul className="space-y-2 text-sm text-neutral-200">
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span> {t("bulletAdFree")}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span> {t("bulletSwipes")}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span> {t("bulletGroups")}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span> {t("bulletTaste")}
          </li>
        </ul>
        <Button onClick={buy} disabled={loading} className="w-full">
          {loading
            ? onIos
              ? t("openingAppStore")
              : t("startingStripe")
            : t("buyCta")}
        </Button>
        {onIos && (
          <>
            <button
              type="button"
              onClick={restore}
              disabled={loading || restoring}
              className="w-full text-center text-xs text-neutral-400 underline underline-offset-2 transition hover:text-neutral-200 disabled:opacity-50"
            >
              {restoring ? t("restoring") : t("restore")}
            </button>
          </>
        )}

        {/* App Store-riktlinje 3.1.2 kräver att själva appen — inte bara
            App Store-beskrivningen — visar prenumerationens namn, längd och pris
            samt nåbara länkar till användarvillkor (EULA) och integritetspolicy
            vid köptillfället. */}
        <div className="space-y-2 border-t border-white/10 pt-4 text-xs leading-relaxed text-neutral-500">
          <p>
            {t.rich("legalName", {
              name: (chunks) => <span className="font-medium text-neutral-300">{chunks}</span>,
            })}
          </p>
          {onIos ? (
            <p>{t("legalApple")}</p>
          ) : (
            <p>{t("legalStripe")}</p>
          )}
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <a
              href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 transition hover:text-neutral-300"
            >
              {t("eula")}
            </a>
            <a href="/legal/terms" className="underline underline-offset-2 transition hover:text-neutral-300">
              {t("ourTerms")}
            </a>
            <a href="/legal/privacy" className="underline underline-offset-2 transition hover:text-neutral-300">
              {t("privacy")}
            </a>
          </p>
        </div>
        {err && <Note tone="error">{err}</Note>}
      </Card>
    </div>
  );
}
