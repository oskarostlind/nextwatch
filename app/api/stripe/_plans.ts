// app/api/stripe/_plans.ts
//
// Delade hjälpare för Stripe-planerna (webbköp). Inte en route — filnamnet
// börjar med "_" och heter inte route.ts.
//
// Env:
//   STRIPE_SECRET_KEY              utan den: inga webbköp (503), planerna göms
//   STRIPE_PRICE_PREMIUM_MONTHLY   återkommande pris 79 SEK / månad
//   STRIPE_PRICE_PREMIUM_YEARLY    återkommande pris 599 SEK / år (osatt → årsplanen göms)
//
// Befintliga prenumeranter ligger kvar på det GAMLA 19 kr-priset: Stripe flyttar
// aldrig en prenumeration till ett nytt Price av sig själv. Byt därför env:en
// till ett NYTT Price-id i stället för att försöka ändra det gamla (Stripe-priser
// går inte att ändra) — då får bara nya köp 79 kr.

import Stripe from "stripe";
import { PREMIUM_TRIAL_DAYS, hasEverHadPremium } from "@/lib/entitlements";

export type StripePlan = "monthly" | "yearly";

export const STRIPE_API_VERSION = "2025-08-27.basil" as const;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

export function stripePriceId(plan: StripePlan): string | null {
  const v = plan === "yearly" ? process.env.STRIPE_PRICE_PREMIUM_YEARLY : process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  return v && v.trim() ? v.trim() : null;
}

export type StripePlanPrice = {
  available: boolean;
  /** Belopp i hela valutaenheter (79, 599) — null om Stripe inte gick att fråga. */
  amount: number | null;
  currency: string | null;
};

let cache: { at: number; value: Record<StripePlan, StripePlanPrice> } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/**
 * Pris per plan från Stripe (cache 10 min per instans). En plan utan env eller
 * utan nyckel är available:false. Svarar Stripe inte behålls available:true
 * (env finns) med amount null — klienten visar då listpriset.
 */
export async function getStripePlanPrices(): Promise<Record<StripePlan, StripePlanPrice>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const stripe = getStripe();
  const out: Record<StripePlan, StripePlanPrice> = {
    monthly: { available: false, amount: null, currency: null },
    yearly: { available: false, amount: null, currency: null },
  };
  if (!stripe) return out;
  let fetchedAll = true;
  for (const plan of ["monthly", "yearly"] as const) {
    const id = stripePriceId(plan);
    if (!id) continue;
    out[plan].available = true;
    try {
      const price = await stripe.prices.retrieve(id);
      if (!price.active) {
        out[plan].available = false;
        continue;
      }
      out[plan].amount = typeof price.unit_amount === "number" ? price.unit_amount / 100 : null;
      out[plan].currency = price.currency ? price.currency.toUpperCase() : null;
    } catch (e) {
      fetchedAll = false;
      console.warn(`[stripe/plans] kunde inte hämta ${plan}-priset:`, e instanceof Error ? e.message : e);
    }
  }
  if (fetchedAll) cache = { at: Date.now(), value: out };
  return out;
}

/**
 * Får användaren Stripe-provperioden? Bara den som aldrig haft Premium — varken
 * i vår databas (alla butiker) eller som Stripe-prenumeration på kunden.
 * Vid osäkerhet: nej.
 */
export async function isStripeTrialEligible(
  stripe: Stripe,
  uid: string | undefined,
  customerId: string | undefined,
): Promise<boolean> {
  if (!uid) return false;
  if (await hasEverHadPremium(uid)) return false;
  if (!customerId) return true;
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
    return subs.data.length === 0;
  } catch {
    return false;
  }
}

export { PREMIUM_TRIAL_DAYS };
