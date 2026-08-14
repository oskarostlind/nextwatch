import "./globals.css";
import type { Metadata, Viewport } from "next";
import React from "react";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import AppShell from "./components/layouts/AppShell";
import OverlayMount from "./components/client/OverlayMount";
import AppDeepLinkHandler from "./components/client/AppDeepLinkHandler";
import { adsFeatureEnabled, adsenseClientId } from "@/lib/ads";
import { bcp47 } from "@/lib/i18nConfig";

const ADSENSE_CLIENT_FALLBACK = "ca-pub-2616665688666431";

export const metadata: Metadata = {
  title: "NextWatch",
  description: "Swipe your next watch",
  other: {
    // AdSense site-verification (works independent of the ads feature flag,
    // so Google can verify/review the site before ads are switched on).
    "google-adsense-account": ADSENSE_CLIENT_FALLBACK,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lås zoom: utan maximumScale zoomar iOS-WebView:n in vid input-fokus
  // (text < 16px) och zoomen ligger kvar — appen upplevs "in-zoomad" i TestFlight.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Språket kommer från nw_lang-cookien (se i18n/request.ts). NextIntlClient-
  // Provider utan props ärver locale + meddelanden från serverkontexten, så
  // varje klientkomponent kan använda useTranslations utan egen laddning.
  const locale = await getLocale();
  // Scriptet laddas bara när ett AdSense-klient-id faktiskt är konfigurerat via
  // env. Annonsflaggan är default-på sedan gating-genomgången 2026-08-13, och
  // utan den här extra grinden hade scriptet börjat laddas på varje sidvisning
  // — även i iOS-WebViewen, där AdSense inte får förekomma (där sköter AdMob
  // annonserna), och för premiumanvändare som inte ska se annonser alls.
  // AdSense har dessutom nekat sajten, så scriptet gör i dagsläget ingen nytta.
  // Site-verification ligger i metadata ovan och påverkas inte av det här.
  const adsClient = adsenseClientId();

  return (
    <html lang={bcp47(locale)} className="min-h-[100dvh] overscroll-none bg-neutral-950">
      <body className="min-h-[100dvh] overscroll-none bg-neutral-950 text-neutral-100 antialiased">
        {adsFeatureEnabled() && adsClient && (
          <Script
            async
            strategy="afterInteractive"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`}
            crossOrigin="anonymous"
          />
        )}

        <NextIntlClientProvider>
          <AppShell>{children}</AppShell>

          <AppDeepLinkHandler />

          {/* Global overlay – körs endast på klienten via OverlayMount */}
          <OverlayMount />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
