"use client";

// app/components/landing/AppStoreLink.tsx
//
// App Store-knapp som döljer sig själv inne i iOS-appen. Utan den skulle
// startsidans fot uppmana den som redan installerat appen att installera den
// igen — startsidan visas nämligen även i WebViewen, för utloggade användare
// (capacitor.config.ts laddar www.nextwatch.se via server.url).
//
// Rendering: knappen visas tills motsatsen är bevisad. Capacitor.isNativePlatform()
// finns inte under SSR, så den första serverrenderingen måste anta webb —
// annars hade webbesökare (och crawlern) fått en tom fot, vilket är hela
// poängen med komponenten omvänt.
import * as React from "react";
import { isNativeIos } from "@/lib/premiumPurchase";
import { appStoreUrl } from "@/lib/seo";

export default function AppStoreLink({ campaign }: { campaign: string }) {
  const [native, setNative] = React.useState(false);
  React.useEffect(() => {
    setNative(isNativeIos());
  }, []);

  if (native) return null;

  return (
    <a
      href={appStoreUrl(campaign)}
      className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
    >
      Ladda ner gratis i App Store
    </a>
  );
}
