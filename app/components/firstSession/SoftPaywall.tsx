"use client";

// Nya flödet, steg "paywall" (del 4, docs/nya-flodet.md): den mjuka
// betalväggen direkt efter spara. Bara A/B-varianten "paywall" kommer hit —
// stegmaskinen (lib/firstSession.ts) hoppar över steget för kontrollgruppen,
// för premium och för "Senare" på spara-arket.
//
// ⚠️ App Review-yta (guideline 3.1.2(c)), samma krav som app/premium/page.tsx:
// prenumerationens namn, pris, period, provperiod, automatisk förnyelse, hur
// och när man avslutar (minst 24 h före periodens slut), länkar till Apples
// EULA + integritetspolicyn, och "Återställ tidigare köp". Allt gäller den
// VALDA planen och syns innan köpknappen trycks. Korta inte texten.
//
// Köp: startPremiumPurchase(plan) — samma väg som goPremium(plan) använder
// (StoreKit på iOS, Google Play på Android, Stripe Checkout på webben), men
// utan goPremiums navigering till /premium/success resp. /premium, så att
// användaren står kvar i leken efter ett köp i appen.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { notify } from "@/app/components/lib/notify";
import { advanceFs, type FsState } from "@/lib/firstSession";
import { funnel } from "@/lib/funnel";
import { invalidateAccountStatus } from "@/lib/accountStatus";
import {
  getPremiumOffers,
  isNativeAndroid,
  isNativeIos,
  restorePremiumPurchases,
  startPremiumPurchase,
  type PremiumOffer,
  type PremiumOffers,
  type PremiumPlan,
} from "@/lib/premiumPurchase";

const APPLE_EULA = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PLANS: PremiumPlan[] = ["yearly", "monthly"];
const PERKS = ["adFree", "swipes", "pick", "taste", "groups"] as const;

export default function SoftPaywall({ fs }: { fs: FsState }) {
  void fs;
  const t = useTranslations("fsSave");
  const [ios] = useState(() => isNativeIos());
  const [android] = useState(() => isNativeAndroid());
  const [offers, setOffers] = useState<PremiumOffers | null>(null);
  const [plan, setPlan] = useState<PremiumPlan>("yearly");
  const [buying, setBuying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    void getPremiumOffers()
      .then((o) => {
        if (!alive) return;
        const avail = PLANS.filter((p) => o[p].available);
        if (avail.length === 0) {
          // Inget att köpa (t.ex. produkten saknas i butiken) — ingen tom vägg.
          advanceFs("paywall");
          return;
        }
        setOffers(o);
        setPlan(avail.includes("yearly") ? "yearly" : avail[0]);
        funnel("paywall_view", { yearly: o.yearly.available, monthly: o.monthly.available });
      })
      .catch(() => {
        if (alive) advanceFs("paywall");
      });
    return () => {
      alive = false;
    };
  }, []);

  const visiblePlans = offers ? PLANS.filter((p) => offers[p].available) : [];
  const offer: PremiumOffer | null = offers ? offers[plan] : null;
  const trialDays = offer?.trialDays ?? 0;
  const busy = buying || restoring;

  function choose(p: PremiumPlan) {
    if (busy) return;
    setPlan(p);
    setErr(null);
    funnel(p === "yearly" ? "paywall_plan_yearly" : "paywall_plan_monthly");
  }

  function close() {
    if (busy) return;
    funnel("paywall_close", { plan });
    setOpen(false);
    advanceFs("paywall");
  }

  async function buy() {
    if (busy || !offer) return;
    setBuying(true);
    setErr(null);
    try {
      const native = ios || android;
      const result = await startPremiumPurchase(plan);
      if (!result.ok) {
        if (!result.cancelled) setErr(result.message || t("paywall.error"));
        return;
      }
      if (!native) {
        // Webben: Stripe Checkout tar över fönstret just nu. Flödet går vidare
        // så att användaren inte möts av samma vägg när hen kommer tillbaka.
        funnel("paywall_checkout", { plan, trial: trialDays > 0 });
        advanceFs("paywall");
        return;
      }
      funnel("trial_start", { plan, trial: trialDays > 0 });
      invalidateAccountStatus();
      notify(trialDays > 0 ? t("paywall.startedTrial") : t("paywall.started"));
      setOpen(false);
      advanceFs("paywall", { isPremium: true });
    } catch {
      setErr(t("paywall.error"));
    } finally {
      setBuying(false);
    }
  }

  async function restore() {
    if (busy) return;
    setRestoring(true);
    setErr(null);
    try {
      const result = await restorePremiumPurchases();
      if (result.ok) {
        notify(t("paywall.restored"));
        setOpen(false);
        advanceFs("paywall", { isPremium: true });
        return;
      }
      if (!result.cancelled) setErr(result.message || t("paywall.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  }

  const priceLine = (p: PremiumPlan, o: PremiumOffer) =>
    p === "yearly" ? t("paywall.perYear", { price: o.price }) : t("paywall.perMonth", { price: o.price });

  return (
    <AnimatePresence>
      {open && offers && offer ? (
        <motion.div
          key="fs-paywall"
          data-blocking-sheet
          role="dialog"
          aria-modal="true"
          aria-labelledby="fs-paywall-title"
          className="fixed inset-0 z-[72] overflow-y-auto overscroll-contain bg-[radial-gradient(110%_60%_at_50%_0%,#2a2208_0%,#0d0c09_50%,#0a0a0a_100%)] text-white"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
        >
          <div className="mx-auto flex min-h-full max-w-md flex-col gap-3.5 px-[22px] pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1.5 text-xs font-bold text-amber-300">
                {t("paywall.savedChip")}
              </span>
              <button
                type="button"
                aria-label={t("paywall.notNow")}
                onClick={close}
                disabled={busy}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.04] transition hover:bg-white/10"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <span className="mt-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-amber-400">
              {t("paywall.eyebrow")}
            </span>
            <h2 id="fs-paywall-title" className="text-[32px] font-extrabold leading-[1.06] tracking-[-0.02em]">
              {trialDays > 0 ? t("paywall.titleTrial", { days: trialDays }) : t("paywall.title")}
            </h2>

            <ul className="my-1 flex flex-col gap-2.5">
              {PERKS.map((k) => (
                <li key={k} className="flex items-start gap-2.5 text-[15px] leading-snug text-neutral-200">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0">
                    <path d="M5 12l4 4 10-10" />
                  </svg>
                  {t(`paywall.perks.${k}`)}
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={t("paywall.planLabel")}>
              {visiblePlans.map((p) => {
                const o = offers[p];
                const on = p === plan;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => choose(p)}
                    className={[
                      "flex h-[62px] items-center justify-between rounded-2xl border-[1.5px] px-4 text-left transition-colors",
                      on ? "border-amber-400 bg-amber-400/10" : "border-white/10 bg-[#151515]",
                    ].join(" ")}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-base font-bold">{p === "yearly" ? t("paywall.yearly") : t("paywall.monthly")}</span>
                      <span className="text-[13px] text-neutral-400">
                        {o.trialDays > 0
                          ? t("paywall.planSubTrial", { days: o.trialDays, price: priceLine(p, o) })
                          : t("paywall.planSub", { price: priceLine(p, o) })}
                      </span>
                    </span>
                    <span className="text-[15px] font-bold">{priceLine(p, o)}</span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-2 flex-1" />

            {err ? <p className="text-center text-sm text-red-400">{err}</p> : null}
            <button
              type="button"
              onClick={() => void buy()}
              disabled={busy}
              className="h-14 w-full rounded-2xl bg-amber-400 text-[17px] font-extrabold text-[#1a1300] transition hover:bg-amber-300 active:scale-[0.98] disabled:opacity-60"
            >
              {buying
                ? ios
                  ? t("paywall.openingAppStore")
                  : android
                    ? t("paywall.openingGooglePlay")
                    : t("paywall.openingCheckout")
                : trialDays > 0
                  ? t("paywall.ctaTrial", { days: trialDays })
                  : t("paywall.cta")}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="h-10 w-full text-center text-[15px] text-neutral-400 transition hover:text-neutral-200"
            >
              {t("paywall.notNow")}
            </button>

            {/* 3.1.2(c): komplett text för VALD plan, före köpet. */}
            <div className="space-y-1.5 text-center text-[11px] leading-relaxed text-neutral-500">
              <p>
                {t.rich(plan === "yearly" ? "paywall.legalYearly" : "paywall.legalMonthly", {
                  price: offer.price,
                  name: (chunks) => <span className="font-medium text-neutral-300">{chunks}</span>,
                })}{" "}
                {trialDays > 0 ? t("paywall.legalTrial", { days: trialDays }) : null}
              </p>
              <p>{ios ? t("paywall.legalApple") : android ? t("paywall.legalGoogle") : t("paywall.legalWeb")}</p>
              <p className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                {ios ? (
                  <a href={APPLE_EULA} target="_blank" rel="noreferrer" className="text-neutral-300 underline underline-offset-2">
                    {t("paywall.eula")}
                  </a>
                ) : (
                  <a href="/legal/terms" className="text-neutral-300 underline underline-offset-2">
                    {t("paywall.terms")}
                  </a>
                )}
                <a href="/legal/privacy" className="text-neutral-300 underline underline-offset-2">
                  {t("paywall.privacy")}
                </a>
                {ios || android ? (
                  <button
                    type="button"
                    onClick={() => void restore()}
                    disabled={busy}
                    className="text-neutral-300 underline underline-offset-2 disabled:opacity-50"
                  >
                    {restoring ? t("paywall.restoring") : t("paywall.restore")}
                  </button>
                ) : null}
              </p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
