"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import BottomTabs from "../navigation/BottomTabs";
import InviteToasts from "../InviteToasts";

const PUBLIC_ROUTES = [
  /^\/$/,
  /^\/onboarding(?:\/.*)?$/,
  /^\/auth(?:\/.*)?$/,
];

/** Utrymme ovanför fast BottomTabs (höjd + säker marginal). Matchar ungefär pb-24 på main. */
const MAIN_BOTTOM_PADDING = "pb-24";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const hideChrome = PUBLIC_ROUTES.some((rx) => rx.test(pathname));

  if (hideChrome) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-neutral-100">
        <main className="min-h-dvh pt-[env(safe-area-inset-top)]">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-neutral-900 via-neutral-900 to-black text-neutral-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col border-x border-white/10 bg-neutral-950 shadow-[0_0_80px_rgba(0,0,0,0.5)] pt-[env(safe-area-inset-top)]">
        <main className={`relative flex min-h-0 w-full flex-1 flex-col overflow-hidden ${MAIN_BOTTOM_PADDING}`}>
          {children}
        </main>

        <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/60">
          <BottomTabs />
        </div>

        <InviteToasts />
      </div>
    </div>
  );
}
