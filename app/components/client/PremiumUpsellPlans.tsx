"use client";

// Delade byggstenar för betalväggarna (/premium och PremiumUpsellModal — och
// gärna den mjuka betalväggen i nya flödet):
//   - usePremiumOffers(): priser/provperiod per plan från getPremiumOffers()
//   - PlanPicker: årsplan förvald, månad som alternativ; en plan med
//     available:false göms helt (env saknas / produkten inte till salu)
//   - PlanLegal: App Store-riktlinje 3.1.2(c) för VALD plan — namn, pris,
//     period, provperiod, automatisk förnyelse, "säg upp minst 24 h före",
//     Apples EULA + integritetspolicy och Återställ köp (i apparna).
// Build 27 avvisades för att just det här blocket saknades — korta inte ner det.

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  getPremiumOffers,
  isNativeAndroid,
  isNativeIos,
  restorePremiumPurchases,
  yearlyPerMonth,
  yearlySavingsPercent,
  type PremiumOffer,
  type PremiumOffers,
  type PremiumPlan,
} from "@/lib/premiumPurchase";

export type StorePlatform = "ios" | "android" | "web";

/** Plattformen avgörs i effect (inte vid render) så SSR-html:en är stabil. */
export function useStorePlatform(): StorePlatform {
  const [platform, setPlatform] = useState<StorePlatform>("web");
  useEffect(() => {
    setPlatform(isNativeIos() ? "ios" : isNativeAndroid() ? "android" : "web");
  }, []);
  return platform;
}

/** enabled=false skjuter upp hämtningen (t.ex. tills ett ark faktiskt öppnas). */
export function usePremiumOffers(enabled = true): PremiumOffers | null {
  const [offers, setOffers] = useState<PremiumOffers | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void getPremiumOffers().then((o) => {
      if (alive) setOffers(o);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return offers;
}

/** Årsplanen om den finns, annars månad, annars null (inget till salu). */
export function defaultPlan(offers: PremiumOffers, preferred?: PremiumPlan | null): PremiumPlan | null {
  if (preferred && offers[preferred].available) return preferred;
  if (offers.yearly.available) return "yearly";
  if (offers.monthly.available) return "monthly";
  return null;
}

/** Knapptext för vald plan: "Prova 7 dagar gratis" eller "Bli Premium – 599 kr/år". */
export function usePlanCta(): (plan: PremiumPlan, offer: PremiumOffer) => string {
  const t = useTranslations("store");
  return (plan, offer) =>
    offer.trialDays > 0
      ? t("ctaTrial", { days: offer.trialDays })
      : plan === "yearly"
        ? t("ctaYearly", { price: offer.price })
        : t("ctaMonthly", { price: offer.price });
}

export function PlanPicker({
  offers,
  value,
  onChange,
  disabled,
}: {
  offers: PremiumOffers;
  value: PremiumPlan;
  onChange: (plan: PremiumPlan) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("store");
  const savings = yearlySavingsPercent(offers);
  const perMonth = yearlyPerMonth(offers);
  const plans = (["yearly", "monthly"] as const).filter((p) => offers[p].available);

  return (
    <div role="radiogroup" aria-label={t("planPickerLabel")} className="space-y-2">
      {plans.map((plan) => {
        const offer = offers[plan];
        const selected = value === plan;
        return (
          <button
            key={plan}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(plan)}
            className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] disabled:opacity-60 ${
              selected
                ? "border-amber-400/70 bg-amber-400/10 ring-1 ring-amber-400/40"
                : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
            }`}
          >
            <span
              aria-hidden
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                selected ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-white/30"
              }`}
            >
              {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-white">{t(`plans.${plan}`)}</span>
                {plan === "yearly" && savings ? (
                  <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    {t("save", { pct: savings })}
                  </span>
                ) : null}
              </span>
              {offer.trialDays > 0 ? (
                <span className="mt-0.5 block text-xs text-amber-200/90">{t("trialBadge", { days: offer.trialDays })}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold text-white">
                {plan === "yearly" ? t("perYear", { price: offer.price }) : t("perMonth", { price: offer.price })}
              </span>
              {plan === "yearly" && perMonth ? (
                <span className="block text-[11px] text-neutral-400">{t("yearlyPerMonth", { price: perMonth })}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PlanLegal({
  offers,
  plan,
  platform,
  busy,
  onError,
}: {
  offers: PremiumOffers;
  plan: PremiumPlan;
  platform: StorePlatform;
  /** Köp pågår — Återställ köp är spärrad så länge. */
  busy?: boolean;
  onError?: (message: string) => void;
}) {
  const t = useTranslations("store");
  const tp = useTranslations("premium");
  const offer = offers[plan];
  const period = t(`period.${offer.period}`);
  const name = (chunks: ReactNode) => <span className="font-medium text-neutral-300">{chunks}</span>;

  return (
    <div className="space-y-2 text-xs leading-relaxed text-neutral-500">
      <p>
        {offer.trialDays > 0
          ? t.rich("legal.summaryTrial", {
              name,
              plan: t(`plans.${plan}`),
              days: offer.trialDays,
              price: offer.price,
              period,
            })
          : t.rich("legal.summary", { name, plan: t(`plans.${plan}`), price: offer.price, period })}
      </p>
      <p>
        {t("legal.renew", { period })}
        {offer.trialDays > 0 ? ` ${t("legal.trialCancel")}` : ""}
      </p>
      <p>{platform === "ios" ? t("legal.apple") : platform === "android" ? t("legal.google") : t("legal.stripe")}</p>
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        {platform !== "android" ? (
          <a
            href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 transition hover:text-neutral-300"
          >
            {tp("eula")}
          </a>
        ) : null}
        <a href="/legal/terms" className="underline underline-offset-2 transition hover:text-neutral-300">
          {tp("ourTerms")}
        </a>
        <a href="/legal/privacy" className="underline underline-offset-2 transition hover:text-neutral-300">
          {tp("privacy")}
        </a>
        {platform !== "web" ? <RestorePurchasesButton busy={busy} onError={onError} /> : null}
      </p>
    </div>
  );
}

/**
 * "Återställ tidigare köp" (App Store 3.1.1 / Play) — bara i apparna. Egen
 * komponent så den kan visas även när butiken inte har någon plan att sälja
 * (t.ex. /premium när produkterna inte laddats): den som redan betalat ska
 * alltid kunna få tillbaka Premium.
 */
export function RestorePurchasesButton({
  busy,
  onError,
  className = "underline underline-offset-2 transition hover:text-neutral-300 disabled:opacity-50",
}: {
  busy?: boolean;
  onError?: (message: string) => void;
  className?: string;
}) {
  const tp = useTranslations("premium");
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    setRestoring(true);
    try {
      const result = await restorePremiumPurchases();
      if (result.ok) {
        window.location.href = "/premium/success";
        return;
      }
      if (!result.cancelled) onError?.(result.message || tp("restoreFailed"));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <button type="button" onClick={() => void restore()} disabled={busy || restoring} className={className}>
      {restoring ? tp("restoring") : tp("restore")}
    </button>
  );
}
