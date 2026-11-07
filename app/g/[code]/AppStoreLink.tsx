"use client";

// Butikslänk som bara visas för webbbesökare — aldrig inne i våra appar.
// iPhone/iPad/desktop får App Store, Android får Google Play (live sedan
// 2026-11-07; dessförinnan fick Android ingen länk alls). Avgörs efter mount:
// userAgent och Capacitor-bryggan finns inte under SSR.

import { useEffect, useState } from "react";
import { isNativeStoreApp } from "@/lib/premiumPurchase";
import { appStoreUrl, playStoreUrl } from "@/lib/seo";
import { funnel } from "@/lib/funnel";

export function canShowAppStore(): boolean {
  try {
    if (isNativeStoreApp()) return false;
    // WKWebView-bryggan (iOS-appen) — dubbelkoll utöver Capacitor.
    const w = window as unknown as { webkit?: { messageHandlers?: Record<string, unknown> } };
    if (w.webkit?.messageHandlers?.bridge) return false;
    return true;
  } catch {
    return false;
  }
}

/** Rätt butik för besökarens enhet. Bara på klienten (läser userAgent). */
export function storeHref(campaign: string): string {
  try {
    if (/Android/i.test(navigator.userAgent)) return playStoreUrl(campaign);
  } catch {
    /* SSR */
  }
  return appStoreUrl(campaign);
}

export default function AppStoreLink({ campaign, label }: { campaign: string; label: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => setHref(canShowAppStore() ? storeHref(campaign) : null), [campaign]);
  if (!href) return null;
  return (
    <a
      href={href}
      rel="noopener"
      onClick={() => funnel("web_to_install", { from: "notice" })}
      className="text-sm text-cyan-300 underline underline-offset-2"
    >
      {label}
    </a>
  );
}
