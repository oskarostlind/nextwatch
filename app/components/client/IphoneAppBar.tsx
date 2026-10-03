"use client";

// app/components/client/IphoneAppBar.tsx
//
// Sticky nedladdningsrad för iPhone-besökare som INTE får Apples smart app
// banner (meta apple-itunes-app i app/layout.tsx). Smart bannern ritas bara av
// Safari — Chrome/Firefox på iOS och, viktigast, webbläsaren inuti Instagram-
// och Facebook-appen (dit Meta-annonserna skickar folk) får ingenting. Den här
// raden täcker det hålet.
//
// Medvetet INTE en popup/modal: Google straffar "intrusive interstitials" på
// mobil och guidesidorna är SEO-spåret. Raden är en låg, fast list längst ner,
// går att stänga, och en lika hög spacer läggs sist i sidan så att inget
// innehåll hamnar dolt bakom den.
//
// Rendering: allt avgörs i useEffect — userAgent, localStorage och
// display-mode finns inte under SSR. Första renderingen (server + hydrering)
// är alltid null, så raden kommer aldrig in i serverrenderad HTML och kan inte
// ge hydration mismatch. Raden är position: fixed och spacern hamnar sist i
// dokumentet, så att de dyker upp i efterhand flyttar inget synligt innehåll
// (ingen CLS).

import * as React from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Inter } from "next/font/google";
import { isNativeIos } from "@/lib/premiumPurchase";
import { appStoreUrl } from "@/lib/seo";

// preload: false — raden visas bara för en bråkdel av besökarna, så
// typsnittet ska inte förladdas på varje sidvisning (desktop inräknat).
const inter = Inter({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", preload: false });

const DISMISS_KEY = "nw_iphone_appbar_dismissed_until";
const DISMISS_DAYS = 30;
const CAMPAIGN = "web-smartbar";

/**
 * Sidor där raden får visas. Bara ytor UTAN BottomTabs (se PUBLIC_ROUTES i
 * AppShell.tsx) — på appytorna skulle den lägga sig ovanpå flikraden.
 * /auth, /onboarding och /admin är uteslutna: formulärflöden resp. desktop.
 */
const ALLOWED_ROUTES = [
  /^\/$/,
  /^\/vilken-film-ska-vi-se$/,
  /^\/vad-ska-vi-se(?:\/.*)?$/,
  /^\/film-for(?:\/.*)?$/,
  /^\/vad-kan-vi-se(?:\/.*)?$/,
  /^\/legal(?:\/.*)?$/,
  /^\/support$/,
];

/**
 * Webbläsare på iOS som INTE är Safari. Utöver kravlistans CriOS/FxiOS/
 * Instagram/FBAN/FBAV tas fler in-app-webbläsare och iOS-browsers med —
 * ingen av dem visar smart bannern heller.
 */
const NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Instagram|FBAN|FBAV|FB_IAB|Snapchat|musical_ly|BytedanceWebview|LinkedInApp|Pinterest/;

function shouldShow(): boolean {
  const ua = navigator.userAgent;
  // Bara iPhone/iPod — inte iPad (iPadOS 13+ utger sig dessutom för Mac), inte
  // Android, inte desktop.
  if (!/iPhone|iPod/.test(ua)) return false;

  // Inne i vår egen iOS-app (Capacitor laddar www.nextwatch.se). Två
  // oberoende kontroller: Capacitor-bryggan, och WKWebView-handlern som
  // Capacitor registrerar ("bridge"). Den här raden får aldrig synas i appen.
  if (isNativeIos()) return false;
  const w = window as unknown as {
    webkit?: { messageHandlers?: Record<string, unknown> };
    navigator: Navigator & { standalone?: boolean };
  };
  if (w.webkit?.messageHandlers?.bridge) return false;

  // Installerad som webbapp på hemskärmen.
  if (window.matchMedia?.("(display-mode: standalone)").matches || w.navigator.standalone === true) {
    return false;
  }

  // Safari på iOS sköter smart bannern själv. En in-app-WebView som inte
  // listas ovan saknar normalt "Safari/"-token — den räknas som icke-Safari.
  const isSafari = /Safari\//.test(ua) && !NON_SAFARI.test(ua);
  if (isSafari) return false;

  // Stängd inom de senaste 30 dagarna. Privata fönster kan kasta på
  // localStorage — då visas raden (värsta fall: den kommer tillbaka).
  try {
    const until = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
    if (until && Date.now() < until) return false;
  } catch {
    /* ignorera */
  }
  return true;
}

export default function IphoneAppBar() {
  const t = useTranslations("appBar");
  const pathname = usePathname() ?? "/";
  const routeAllowed = ALLOWED_ROUTES.some((rx) => rx.test(pathname));
  const [eligible, setEligible] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    setEligible(shouldShow());
  }, []);

  if (!eligible || dismissed || !routeAllowed) return null;

  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000));
    } catch {
      /* privat fönster — stängs bara för den här sidvisningen */
    }
  };

  return (
    <>
      {/* Spacer: lika hög som raden, sist i dokumentet, så att sidfoten går
          att scrolla fram ovanför raden i stället för att döljas bakom den. */}
      <div aria-hidden className="h-[calc(3.5rem+env(safe-area-inset-bottom))]" />

      <div
        role="complementary"
        aria-label={t("ariaLabel")}
        className={`${inter.className} fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0B0B0C] pb-[env(safe-area-inset-bottom)] text-white`}
      >
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 pl-1 pr-3">
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="flex h-10 w-8 shrink-0 items-center justify-center text-white/50 transition active:text-white"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>

          <Image
            src="/app-icon-120.png"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-[10px] border border-white/10"
          />

          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-semibold">NextWatch</div>
            <div className="truncate text-[12px] font-medium text-white/60">{t("tagline")}</div>
          </div>

          <a
            href={appStoreUrl(CAMPAIGN)}
            className="shrink-0 rounded-full bg-[#38DBE0] px-4 py-1.5 text-[14px] font-bold text-[#0B0B0C] transition active:opacity-80"
          >
            {t("get")}
          </a>
        </div>
      </div>
    </>
  );
}
