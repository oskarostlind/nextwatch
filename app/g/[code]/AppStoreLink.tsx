"use client";

// App Store-länk som bara visas för webbbesökare som kan installera iOS-appen
// (iPhone/iPad/desktop) — aldrig inne i våra appar och aldrig på Android
// (Google Play är inte live än). Avgörs efter mount: userAgent och
// Capacitor-bryggan finns inte under SSR.

import { useEffect, useState } from "react";
import { isNativeStoreApp } from "@/lib/premiumPurchase";
import { funnel } from "@/lib/funnel";

export function canShowAppStore(): boolean {
  try {
    if (isNativeStoreApp()) return false;
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return false;
    // WKWebView-bryggan (iOS-appen) — dubbelkoll utöver Capacitor.
    const w = window as unknown as { webkit?: { messageHandlers?: Record<string, unknown> } };
    if (w.webkit?.messageHandlers?.bridge) return false;
    return true;
  } catch {
    return false;
  }
}

export default function AppStoreLink({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(canShowAppStore()), []);
  if (!show) return null;
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
