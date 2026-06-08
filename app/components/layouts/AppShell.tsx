"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import BottomTabs from "../navigation/BottomTabs";
import InviteToasts from "../InviteToasts";
import PushRegistration from "../client/PushRegistration";

const PUBLIC_ROUTES = [
  /^\/$/,
  /^\/onboarding(?:\/.*)?$/,
  /^\/auth(?:\/.*)?$/,
];

/**
 * Utrymme så scrollande innehåll inte hamnar under den fasta BottomTabs-raden.
 * Höjden ska matcha tab-raden (py-2 + h-12 + pb med safe-area i BottomTabs), inte dubbleras med swipe-knapparnas egna padding.
 */
const MAIN_BOTTOM_PADDING =
  "pb-[calc(env(safe-area-inset-bottom)+4rem)]";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const hideChrome = PUBLIC_ROUTES.some((rx) => rx.test(pathname));

  if (hideChrome) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100">
        <PushRegistration />
        <main className="min-h-[100dvh] pt-[env(safe-area-inset-top)]">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100">
      <PushRegistration />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col border-x border-white/10 bg-neutral-950 shadow-[0_0_80px_rgba(0,0,0,0.5)] pt-[env(safe-area-inset-top)]">
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
