import "./globals.css";
import type { Metadata, Viewport } from "next";
import React from "react";
import AppShell from "./components/layouts/AppShell";
import OverlayMount from "./components/client/OverlayMount";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "NextWatch",
  description: "Swipe your next watch",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // App Router-regeln: anropa cookies() på serversidan
  await cookies();

  return (
    <html lang="sv">
      <body className="min-h-dvh bg-neutral-900 text-neutral-100 antialiased">
        <AppShell>{children}</AppShell>

        {/* Global overlay – körs endast på klienten via OverlayMount */}
        <OverlayMount />
      </body>
    </html>
  );
}
