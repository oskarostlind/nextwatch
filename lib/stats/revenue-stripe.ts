// lib/stats/revenue-stripe.ts — Stripe-intäkter för /api/stats (Mission Control).
//
// Läser BARA belopp/typ/tid/valuta ur balance transactions och priser ur aktiva
// prenumerationer — aldrig kunduppgifter. Belopp i öre (minor units) i kontots
// avräkningsvaluta (SEK). Cachen är per instans med 1 h TTL och serverar stale i
// upp till ett dygn vid fel — samma mönster som lib/admobReport.ts.
//
// Env: STRIPE_SECRET_KEY (saknas → null + warning hos anroparen).
// Valfritt: MC_FX_<VALUTA>_SEK (t.ex. MC_FX_EUR_SEK=11.5) om en transaktion mot
// förmodan inte är i SEK; utan kurs hoppas den över med en warning.

import Stripe from "stripe";
import { type Day, addDays, startOfStockholmDay, stockholmDay } from "./contract";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h färskt
const STALE_MAX_MS = 24 * 60 * 60 * 1000; // servera stale max 1 dygn
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** Minimal form av en balance transaction — det enda vi läser. */
export type BtLite = { type: string; amount: number; net: number; created: number; currency: string };

/** Minimal form av ett prenumerationspris. */
export type SubItemLite = {
  unitAmount: number | null;
  quantity: number;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
};
export type SubLite = { status: string; items: SubItemLite[] };

export type StripeRevenue = {
  /** Dag (Stockholm) → { gross, net } i öre. */
  perDay: Map<Day, { gross: number; net: number }>;
  mrr: number;
  activeSubscriptions: number;
  warnings: string[];
  fetchedAt: string;
};

const GROSS_TYPES = new Set(["charge", "payment"]);
const NEGATIVE_TYPES = new Set(["refund", "payment_refund", "payment_failure_refund", "adjustment", "dispute"]);

/** Kurs → SEK från env MC_FX_<CUR>_SEK. null = okänd. */
export function envFx(currency: string): number | null {
  const cur = currency.toUpperCase();
  if (cur === "SEK") return 1;
  const v = Number(process.env[`MC_FX_${cur}_SEK`]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Summera balance transactions per Stockholm-dag (ren funktion).
 * charge/payment → gross += amount, net += net. Återbetalningar/justeringar/tvister
 * → gross += amount (negativt), net += net. Övriga typer (payout, transfer, fristående
 * avgifter …) ignoreras.
 */
export function aggregateBalanceTransactions(
  bts: Iterable<BtLite>,
  fx: (currency: string) => number | null = envFx,
): { perDay: Map<Day, { gross: number; net: number }>; warnings: string[] } {
  const perDay = new Map<Day, { gross: number; net: number }>();
  const warn = new Set<string>();
  for (const bt of bts) {
    if (!GROSS_TYPES.has(bt.type) && !NEGATIVE_TYPES.has(bt.type)) continue;
    let rate = 1;
    const cur = (bt.currency || "sek").toLowerCase();
    if (cur !== "sek") {
      const r = fx(cur);
      if (r == null) {
        warn.add(`stripe: valuta ${cur} saknar kurs, hoppades över`);
        continue;
      }
      warn.add(`stripe: valuta ${cur} omräknad till SEK`);
      rate = r;
    }
    const day = stockholmDay(new Date(bt.created * 1000));
    const cell = perDay.get(day) ?? { gross: 0, net: 0 };
    cell.gross += Math.round(bt.amount * rate);
    cell.net += Math.round(bt.net * rate);
    perDay.set(day, cell);
  }
  return { perDay, warnings: [...warn] };
}

const PER_MONTH: Record<SubItemLite["interval"], number> = { day: 30, week: 4.33, month: 1, year: 1 / 12 };

/**
 * MRR i öre ur prenumerationer (ren funktion). `active` räknas med sitt pris,
 * `trialing` räknas som aktiv prenumeration men med 0 kr i MRR.
 */
export function computeMrr(
  subs: Iterable<SubLite>,
  fx: (currency: string) => number | null = envFx,
): { mrr: number; activeSubscriptions: number; warnings: string[] } {
  let mrr = 0;
  let active = 0;
  const warn = new Set<string>();
  for (const s of subs) {
    if (s.status !== "active" && s.status !== "trialing") continue;
    active += 1;
    if (s.status !== "active") continue;
    for (const it of s.items) {
      if (it.unitAmount == null) continue;
      const cur = (it.currency || "sek").toLowerCase();
      const rate = cur === "sek" ? 1 : fx(cur);
      if (rate == null) {
        warn.add(`stripe: prenumerationsvaluta ${cur} saknar kurs`);
        continue;
      }
      const perMonth = PER_MONTH[it.interval] / Math.max(1, it.intervalCount);
      mrr += it.unitAmount * Math.max(1, it.quantity) * perMonth * rate;
    }
  }
  return { mrr: Math.round(mrr), activeSubscriptions: active, warnings: [...warn] };
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  // Samma API-version som övriga Stripe-anrop i appen; 4 s per anrop, inga omförsök.
  return new Stripe(key, { apiVersion: "2025-08-27.basil", timeout: 4000, maxNetworkRetries: 0 });
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

async function fetchFromStripe(now: Date): Promise<StripeRevenue> {
  const stripe = stripeClient();
  if (!stripe) throw new Error("not_configured");
  const warnings: string[] = [];

  // Från början av Stockholm-dagen idag − 30.
  const since = Math.floor(startOfStockholmDay(addDays(stockholmDay(now), -30)).getTime() / 1000);

  const bts: BtLite[] = [];
  let pages = 0;
  let truncated = false;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.balanceTransactions.list({
      created: { gte: since },
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    pages += 1;
    for (const bt of page.data) {
      bts.push({ type: bt.type, amount: bt.amount, net: bt.net, created: bt.created, currency: bt.currency });
    }
    if (!page.has_more || page.data.length === 0) break;
    if (pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
    startingAfter = page.data[page.data.length - 1].id;
  }
  if (truncated) warnings.push(`stripe: fler än ${MAX_PAGES * PAGE_SIZE} transaktioner, äldsta dagarna saknas`);
  const agg = aggregateBalanceTransactions(bts);
  warnings.push(...agg.warnings);

  const subs: SubLite[] = [];
  for (const status of ["active", "trialing"] as const) {
    let after: string | undefined;
    for (let p = 0; p < MAX_PAGES; p++) {
      const page = await stripe.subscriptions.list({
        status,
        limit: PAGE_SIZE,
        ...(after ? { starting_after: after } : {}),
      });
      for (const s of page.data) {
        subs.push({
          status: s.status,
          items: s.items.data.map((it) => ({
            unitAmount: it.price?.unit_amount ?? null,
            quantity: it.quantity ?? 1,
            currency: it.price?.currency ?? "sek",
            interval: it.price?.recurring?.interval ?? "month",
            intervalCount: it.price?.recurring?.interval_count ?? 1,
          })),
        });
      }
      if (!page.has_more || page.data.length === 0) break;
      after = page.data[page.data.length - 1].id;
    }
  }
  const m = computeMrr(subs);
  warnings.push(...m.warnings);

  return {
    perDay: agg.perDay,
    mrr: m.mrr,
    activeSubscriptions: m.activeSubscriptions,
    warnings,
    fetchedAt: now.toISOString(),
  };
}

type CacheBox = { data: StripeRevenue; at: number } | null;
const g = globalThis as unknown as { __nwStatsStripe?: { cache: CacheBox; inflight: Promise<StripeRevenue | null> | null } };
const state = (g.__nwStatsStripe ??= { cache: null, inflight: null });

/**
 * Stripe-intäkter de senaste 31 Stockholm-dagarna + MRR. null = ej konfigurerat
 * eller fel utan användbar cache. Kastar aldrig. Delad inflight så att parallella
 * anrop inte dubbelhämtar.
 */
export async function getStripeRevenue(now = new Date()): Promise<StripeRevenue | null> {
  if (!stripeConfigured()) return null;
  const age = state.cache ? Date.now() - state.cache.at : Infinity;
  if (state.cache && age < CACHE_TTL_MS) return state.cache.data;
  if (!state.inflight) {
    state.inflight = fetchFromStripe(now)
      .then((data) => {
        state.cache = { data, at: Date.now() };
        return data;
      })
      .catch((e) => {
        console.warn("[stats/stripe] hämtning misslyckades:", e instanceof Error ? e.message : e);
        return state.cache && Date.now() - state.cache.at < STALE_MAX_MS ? state.cache.data : null;
      })
      .finally(() => {
        state.inflight = null;
      });
  }
  return state.inflight;
}
