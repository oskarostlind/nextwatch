"use client";

// app/components/landing/AppStoreLink.tsx
//
// Butiksknappar (App Store + Google Play) som döljer sig själva inne i
// apparna. Utan det skulle startsidans fot uppmana den som redan installerat
// appen att installera den igen — startsidan visas nämligen även i WebViewen,
// för utloggade användare (capacitor.config.ts laddar www.nextwatch.se via
// server.url).
//
// Sedan 2026-11-07 finns appen på Google Play, så komponenten visar båda
// knapparna. Fram till dess var App Store-länken sajtens ENDA nedladdningsväg,
// vilket betydde att varje Android-besökare möttes av en iPhone-länk.
//
// Rendering: knapparna visas tills motsatsen är bevisad. Capacitor.isNativePlatform()
// finns inte under SSR, så den första serverrenderingen måste anta webb —
// annars hade webbesökare (och crawlern) fått en tom fot, vilket är hela
// poängen med komponenten omvänt. Båda länkarna ligger därför i serverrenderad
// HTML; vilken som hamnar först avgörs först efter mount (Android-besökare
// får Play-knappen först).
import * as React from "react";
import { isNativeStoreApp } from "@/lib/premiumPurchase";
import { appStoreUrl, playStoreUrl } from "@/lib/seo";

const PRIMARY =
  "inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200";
const SECONDARY =
  "inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10";

export default function AppStoreLink({ campaign }: { campaign: string }) {
  const [native, setNative] = React.useState(false);
  const [androidFirst, setAndroidFirst] = React.useState(false);
  React.useEffect(() => {
    // Dölj i båda apparna (iOS och Android) — butikslänkarna hör till webben.
    setNative(isNativeStoreApp());
    setAndroidFirst(/Android/i.test(navigator.userAgent));
  }, []);

  if (native) return null;

  const apple = (
    <a href={appStoreUrl(campaign)} className={androidFirst ? SECONDARY : PRIMARY}>
      Ladda ner gratis i App Store
    </a>
  );
  const play = (
    <a href={playStoreUrl(campaign)} className={androidFirst ? PRIMARY : SECONDARY}>
      Ladda ner gratis på Google Play
    </a>
  );

  return (
    <div className="flex flex-wrap gap-3">
      {androidFirst ? play : apple}
      {androidFirst ? apple : play}
    </div>
  );
}
