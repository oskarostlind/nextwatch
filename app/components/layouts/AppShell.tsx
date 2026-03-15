'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

// OBS: vi använder RELATIVA imports för att undvika alias-strul
import Sidebar from '../navigation/Sidebar';
import BottomTabs from '../navigation/BottomTabs';
import InviteToasts from '../InviteToasts';

// Rutter där vi INTE vill visa AppShell-krom (sidebar/bottom tabs)
const PUBLIC_ROUTES = [
  /^\/$/,                   // landningssidan
  /^\/onboarding(?:\/.*)?$/, // onboarding-trädet
  /^\/auth(?:\/.*)?$/,       // ev. auth-sidor
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const hideChrome = PUBLIC_ROUTES.some((rx) => rx.test(pathname));

  // Safe-area för mobil + sticky bottom tabs när de visas
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {hideChrome ? (
        // Publika sidor: rendra bara children (ingen sidebar/bottomtabs)
        <main className="min-h-dvh">{children}</main>
      ) : (
        // App-vy: vänster rail (md+), content i mitten, bottom tabs på mobil
        <div className="mx-auto w-full max-w-7xl grid grid-cols-1 md:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_360px]">
          <aside className="hidden md:block border-r border-white/10">
            <Sidebar />
          </aside>

          <main className="relative min-h-dvh pb-24 md:pb-0">
            {children}
          </main>

          {/* (valfri) desktop info-panel till höger – lämna tom så länge */}
          <aside className="hidden xl:block border-l border-white/10" />

          {/* Mobil: sticky bottom tabs med blur, respektera safe area */}
          <div className="md:hidden fixed inset-x-0 bottom-0 z-50 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/60">
            <BottomTabs />
            <div className="h-3" /> {/* liten spacer över iPhone home-indicator */}
          </div>

          {/* Pop-up för vän- och gruppinbjudan (~5 s) när användaren är inne i appen */}
          <InviteToasts />
        </div>
      )}
    </div>
  );
}
