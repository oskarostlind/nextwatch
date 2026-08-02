// lib/billingStore.ts
//
// EN delad hämtning av /api/billing/status per session. Tidigare hämtade
// SwipeDeckPreloader, profilens inställningar och admobAds statusen oberoende
// av varandra — tre identiska round-trips (plus Apple-refresh server-side på
// varje). Modul-singleton med inflight-dedupe, samma mönster som
// swipeSettingsStore.

export type BillingStatus = {
  ok: boolean;
  plan: string;
  planSince: string | null;
  isPremium: boolean;
  source: "stripe" | "apple" | "lifetime" | null;
  status: string | null;
  renewsAt: string | null;
};

let cached: BillingStatus | null = null;
let inflight: Promise<BillingStatus | null> | null = null;

/**
 * Hämtar billing-status. Cachas för sessionen; `force` tvingar färskt svar
 * (används efter köp/återställning där statusen faktiskt kan ha ändrats).
 */
export async function getBillingStatus(force = false): Promise<BillingStatus | null> {
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/billing/status", { cache: "no-store" });
      if (!res.ok) return cached; // behåll ev. gammalt vid nätverksfel
      const j = (await res.json()) as BillingStatus;
      cached = j;
      return j;
    } catch {
      return cached;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
