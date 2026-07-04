// lib/entitlements.ts
//
// Central "är användaren premium?"-logik. EN sanning som alla ställen läser,
// oavsett om köpet kom via Stripe (webb) eller Apple/RevenueCat (iOS).
//
// plan-värden:
//   "free"     – gratis, ser annonser
//   "premium"  – aktiv prenumeration (Stripe eller Apple)
//   "lifetime" – grandfathad engångsköpare (alltid premium)
//
// En prenumeration räknas som premium så länge den är aktiv ELLER uppsagd men
// ännu inte utgången (subCurrentPeriodEnd i framtiden). Så en användare som
// säger upp behåller premium till periodens slut.

import { prisma } from "@/lib/prisma";

export type EntitlementSource = "stripe" | "apple" | "lifetime" | null;

export type Entitlement = {
  isPremium: boolean;
  plan: string; // "free" | "premium" | "lifetime"
  source: EntitlementSource;
  status: string | null; // Stripe/Apple-status, t.ex. "active", "canceled", "past_due"
  renewsAt: string | null; // ISO – nästa förnyelse / utgång, om känd
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

type UserEntitlementRow = {
  plan: string;
  subProvider: string | null;
  subStatus: string | null;
  subCurrentPeriodEnd: Date | null;
};

/** Ren funktion – testbar utan DB. */
export function computeEntitlement(u: UserEntitlementRow | null): Entitlement {
  if (!u) {
    return { isPremium: false, plan: "free", source: null, status: null, renewsAt: null };
  }

  // Grandfathad engångsköpare.
  if (u.plan === "lifetime") {
    return { isPremium: true, plan: "lifetime", source: "lifetime", status: null, renewsAt: null };
  }

  const now = Date.now();
  const periodEnd = u.subCurrentPeriodEnd ? u.subCurrentPeriodEnd.getTime() : null;
  const withinPeriod = periodEnd !== null && periodEnd > now;
  const statusActive = u.subStatus ? ACTIVE_STATUSES.has(u.subStatus) : false;

  const isPremium = u.plan === "premium" && (statusActive || withinPeriod);

  return {
    isPremium,
    plan: isPremium ? "premium" : "free",
    source: isPremium ? (u.subProvider === "apple" ? "apple" : "stripe") : null,
    status: u.subStatus ?? null,
    renewsAt: u.subCurrentPeriodEnd ? u.subCurrentPeriodEnd.toISOString() : null,
  };
}

/** Slår upp användaren och beräknar entitlement. Kastar aldrig – faller tillbaka på free. */
export async function getEntitlement(uid: string | null | undefined): Promise<Entitlement> {
  if (!uid) return { isPremium: false, plan: "free", source: null, status: null, renewsAt: null };
  try {
    const u = await prisma.user.findUnique({
      where: { id: uid },
      select: { plan: true, subProvider: true, subStatus: true, subCurrentPeriodEnd: true },
    });
    return computeEntitlement(u);
  } catch {
    return { isPremium: false, plan: "free", source: null, status: null, renewsAt: null };
  }
}

/** Snabb boolean när man bara behöver ja/nej. */
export async function isPremiumUser(uid: string | null | undefined): Promise<boolean> {
  return (await getEntitlement(uid)).isPremium;
}
