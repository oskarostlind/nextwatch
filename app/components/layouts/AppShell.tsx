"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import BottomTabs from "../navigation/BottomTabs";
import InviteToasts from "../InviteToasts";
import Toast from "../ui/Toast";
import PushRegistration from "../client/PushRegistration";
import SessionPersistence from "../client/SessionPersistence";
import SplashScreenHide from "../client/SplashScreenHide";
import GuideOverlay from "../client/GuideOverlay";
import { NAV_GUIDE_STEPS } from "@/lib/guideSteps";
import { hasAuthCookie, hasSeenGuide, releaseGuide, tryAcquireGuide } from "@/lib/userGuide";
import { AuthGateProvider } from "@/lib/authGateContext";
import { SwipeDeckPreloader } from "@/app/recs/SwipeDeckProvider";
import { SocialPreloader } from "../client/SocialProvider";
import { SwipeSettingsPreloader } from "../client/SwipeSettingsProvider";

const PUBLIC_ROUTES = [
  /^\/$/,
  /^\/onboarding(?:\/.*)?$/,
  /^\/auth(?:\/.*)?$/,
  // Admin är ett desktopverktyg — mobilramen (max-w-md) kapade tabellerna.
  // Ingen chrome behövs: sidan är gate:ad server-side och har egen layout.
  /^\/admin(?:\/.*)?$/,
  // Legal + support måste vara nåbara utan konto (App Store-review, AdMob,
  // och länkarna i App Store Connect pekar hit).
  /^\/legal(?:\/.*)?$/,
  /^\/support$/,
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
  // Enda sidan där SSR:s inloggningsstatus kan vara fel (kallstarts-race, se
  // AuthGate.tsx) — alla andra ska bete sig exakt som innan: redo direkt.
  const isLandingRoute = pathname === "/";
  const [navGuideOpen, setNavGuideOpen] = useState(false);

  useEffect(() => {
    if (hideChrome) return;
    if (!hasAuthCookie()) return;
    if (!hasSeenGuide("swipe")) return;
    if (hasSeenGuide("nav")) return;
    // Öppna bara om ingen annan guide är aktiv (t.ex. grupp-guiden på /group).
    const t = window.setTimeout(() => {
      if (tryAcquireGuide("nav")) setNavGuideOpen(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [hideChrome, pathname]);

  if (hideChrome) {
    return (
      <AuthGateProvider initiallyReady={!isLandingRoute}>
        <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100">
          <SplashScreenHide />
          <PushRegistration />
          {/* Måste köras även här: en ITP-raderad session dumpar användaren på
              publika heron — det är precis DÄR räddningen behövs. */}
          <SessionPersistence />
          <main className="min-h-[100dvh] pt-[env(safe-area-inset-top)]">{children}</main>
        </div>
      </AuthGateProvider>
    );
  }

  return (
    <AuthGateProvider initiallyReady={!isLandingRoute}>
      <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100">
        <SplashScreenHide />
        <PushRegistration />
        <SessionPersistence />
        <SwipeDeckPreloader />
        <SocialPreloader />
        <SwipeSettingsPreloader />
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col border-x border-white/10 bg-neutral-950 shadow-[0_0_80px_rgba(0,0,0,0.5)] pt-[env(safe-area-inset-top)]">
          <main className={`relative flex min-h-0 w-full flex-1 flex-col overflow-hidden ${MAIN_BOTTOM_PADDING}`}>
            {children}
          </main>

          <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/60">
            <BottomTabs />
          </div>

          <InviteToasts />
          <Toast />
        </div>

        <GuideOverlay
          guideId="nav"
          steps={NAV_GUIDE_STEPS}
          open={navGuideOpen}
          onClose={() => {
            setNavGuideOpen(false);
            releaseGuide("nav");
          }}
        />
      </div>
    </AuthGateProvider>
  );
}
