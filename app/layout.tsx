import "./globals.css";
import type { Metadata, Viewport } from "next";
import React from "react";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import AppShell from "./components/layouts/AppShell";
import OverlayMount from "./components/client/OverlayMount";
import AppDeepLinkHandler from "./components/client/AppDeepLinkHandler";
import MetaAppEvents from "./components/client/MetaAppEvents";
import { adsFeatureEnabled, adsenseClientId } from "@/lib/ads";
import { bcp47 } from "@/lib/i18nConfig";
import { SITE_URL } from "@/lib/seo";

const ADSENSE_CLIENT_FALLBACK = "ca-pub-2616665688666431";

// Metadata var på engelska ("NextWatch" / "Swipe your next watch") för en app
// vars hela marknad är svensk, och saknade metadataBase, canonical och OG-taggar.
// Titeln är skriven mot samma sökintent som App Store-namnet, så webb och butik
// drar åt samma håll. Se marketing-videos/nextwatch/marketing/SEO-PLAN.md.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "NextWatch – hitta kvällens film när ni är flera",
    // Undersidor sätter bara sin egen titel; suffixet läggs på här.
    template: "%s | NextWatch",
  },
  description:
    "Swipa tillsammans och se bara det ni är överens om. NextWatch filtrerar på era streamingtjänster – Netflix, Viaplay, Disney+, Max och fler. Gratis svensk app.",
  applicationName: "NextWatch",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "sv_SE",
    url: SITE_URL,
    siteName: "NextWatch",
    title: "NextWatch – hitta kvällens film när ni är flera",
    description:
      "Alla i sällskapet swipar samtidigt. Appen visar bara filmerna och serierna ni är överens om, på tjänsterna ni faktiskt har.",
  },
  twitter: {
    card: "summary_large_image",
    title: "NextWatch – hitta kvällens film när ni är flera",
    description:
      "Alla swipar samtidigt. Appen visar bara det ni är överens om. Gratis i App Store.",
  },
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
          <MetaAppEvents />

          {/* Global overlay – körs endast på klienten via OverlayMount */}
          <OverlayMount />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
