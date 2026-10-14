"use client";

import { useEffect, useState } from "react";
import { Button, Card, Note, PageHeader } from "@/app/components/ui/kit";
import { useTranslations } from "next-intl";
import {
  formatPremiumPrice,
  isNativeStoreApp,
  openSubscriptionManagement,
  startPremiumPurchase,
  type PremiumPlan,
} from "@/lib/premiumPurchase";
import {
  PlanLegal,
  PlanPicker,
  defaultPlan,
  usePlanCta,
  usePremiumOffers,
  useStorePlatform,
} from "@/app/components/client/PremiumUpsellPlans";

/** Förmånerna — samma nycklar och ordning som PremiumUpsellModal. */
const BENEFIT_KEYS = ["bulletAdFree", "bulletSwipes", "bulletGroups", "bulletTaste", "bulletPick"] as const;

type CurrentSub = {
  isPremium: boolean;
  plan: string;
  source: "stripe" | "apple" | "google" | "lifetime" | null;
  subscription?: { plan: PremiumPlan | null; amount: number | null; currency: string | null } | null;
};

export default function PremiumPage() {
  const t = useTranslations("premium");
  const ts = useTranslations("store");
  const platform = useStorePlatform();
  const offers = usePremiumOffers();
  const ctaLabel = usePlanCta();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [plan, setPlan] = useState<PremiumPlan | null>(null);
  const [current, setCurrent] = useState<CurrentSub | null>(null);
  const [statusDone, setStatusDone] = useState(false);

  // Förvald plan: ?plan= från en annan yta (t.ex. webbens upsell-ark), annars årsplanen.
  useEffect(() => {
    if (!offers || plan) return;
    let preferred: PremiumPlan | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get("plan");
      preferred = q === "monthly" || q === "yearly" ? q : null;
    } catch {
      preferred = null;
    }
    setPlan(defaultPlan(offers, preferred));
  }, [offers, plan]);

  // Befintlig prenumerant: visa hens plan och FAKTISKA pris (19 kr-kunderna
  // behåller sitt pris) i stället för en köpknapp.
  useEffect(() => {
    let alive = true;
    void fetch("/api/billing/status?detail=1", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CurrentSub>) : null))
      .then((j) => {
        if (alive && j?.isPremium) setCurrent(j);
      })
      .catch(() => {
        /* best effort — utan svar visas köpvyn */
      })
      .finally(() => {
        if (alive) setStatusDone(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function buy() {
    if (!plan) return;
    setErr("");
    setLoading(true);
    try {
      // Plattformsmedveten: iOS -> Apple IAP, Android -> Google Play, webb -> Stripe Checkout.
      const result = await startPremiumPurchase(plan);
      if (result.ok) {
        if (isNativeStoreApp()) window.location.href = "/premium/success";
        // Webb: Stripe-redirecten har redan skett.
        return;
      }
      if (!result.cancelled) setErr(result.message || t("checkoutFailed"));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  const selected = offers && plan ? offers[plan] : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader eyebrow={t("eyebrow")} title="Premium" subtitle={t("subtitle")} />
      <Card className="space-y-4">
        <p className="text-sm text-neutral-300">{t("intro")}</p>
        {/* Varje punkt måste motsvara en gate som FAKTISKT finns i koden — annars
            säljer vi något användaren redan har (tabellen "What Premium actually
            gates" i CLAUDE.md). Siffrorna speglar defaultvärdena i
            lib/swipeLimit.ts (100/dygn) och lib/groupLimits.ts (3 resp. 20);
            ändras de env-variablerna måste texten här ändras med. */}
        <ul className="space-y-2 text-sm text-neutral-200">
          {BENEFIT_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <span className="text-emerald-400">✓</span> {t(key)}
            </li>
          ))}
        </ul>

        {current ? (
          <CurrentPlan current={current} platform={platform} />
        ) : !offers || !statusDone ? (
          <p className="text-center text-xs text-neutral-500">{ts("loading")}</p>
        ) : !plan || !selected ? (
          <Note tone="info">{ts("unavailable")}</Note>
        ) : (
          <>
            <PlanPicker offers={offers} value={plan} onChange={setPlan} disabled={loading} />
            <Button onClick={buy} disabled={loading} className="w-full">
              {loading
                ? platform === "ios"
                  ? t("openingAppStore")
                  : platform === "android"
                    ? t("openingGooglePlay")
                    : t("startingStripe")
                : ctaLabel(plan, selected)}
            </Button>

            {/* App Store-riktlinje 3.1.2(c): namn, pris, period, förnyelse,
                uppsägning, EULA + integritetspolicy och Återställ köp — för den
                plan som är vald just nu. */}
            <div className="border-t border-white/10 pt-4">
              <PlanLegal offers={offers} plan={plan} platform={platform} busy={loading} onError={setErr} />
            </div>
          </>
        )}
        {err && <Note tone="error">{err}</Note>}
      </Card>
    </div>
  );
}

function CurrentPlan({ current, platform }: { current: CurrentSub; platform: "ios" | "android" | "web" }) {
  const ts = useTranslations("store");
  const sub = current.subscription;
  const line =
    current.plan === "lifetime"
      ? ts("current.lifetime")
      : sub?.plan && typeof sub.amount === "number"
        ? ts("current.planPrice", {
            plan: ts(`plans.${sub.plan}`),
            price: formatPremiumPrice(sub.amount, sub.currency ?? "SEK"),
            period: ts(`period.${sub.plan === "yearly" ? "year" : "month"}`),
          })
        : sub?.plan
          ? ts(`plans.${sub.plan}`)
          : null;

  return (
    <div className="space-y-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] p-4">
      <p className="text-sm font-semibold text-emerald-200">{ts("current.title")}</p>
      {line ? <p className="text-sm text-neutral-200">{line}</p> : null}
      {current.plan !== "lifetime" ? (
        <>
          <p className="text-xs leading-relaxed text-neutral-400">{ts("current.keepPrice")}</p>
          {platform === "web" || current.source !== (platform === "ios" ? "apple" : "google") ? (
            <a href="/profile" className="inline-block text-xs text-neutral-300 underline underline-offset-2">
              {ts("current.manageWeb")}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void openSubscriptionManagement()}
              className="text-xs text-neutral-300 underline underline-offset-2"
            >
              {ts("current.manage")}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
