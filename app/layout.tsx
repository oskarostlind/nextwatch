import "./globals.css";
import type { Metadata, Viewport } from "next";
import React from "react";
import Script from "next/script";
import AppShell from "./components/layouts/AppShell";
import OverlayMount from "./components/client/OverlayMount";
import AppDeepLinkHandler from "./components/client/AppDeepLinkHandler";
import { adsFeatureEnabled, adsenseClientId } from "@/lib/ads";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const adsClient = adsenseClientId() ?? ADSENSE_CLIENT_FALLBACK;

  return (
    <html lang="sv" className="min-h-[100dvh] overscroll-none bg-neutral-950">
      <body className="min-h-[100dvh] overscroll-none bg-neutral-950 text-neutral-100 antialiased">
        {adsFeatureEnabled() && (
          <Script
            async
            strategy="afterInteractive"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`}
            crossOrigin="anonymous"
          />
        )}

        <AppShell>{children}</AppShell>

        <AppDeepLinkHandler />

        {/* Global overlay – körs endast på klienten via OverlayMount */}
        <OverlayMount />
      </body>
    </html>
  );
}
