"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";

import BottomTabs from "../navigation/BottomTabs";
import InviteToasts from "../InviteToasts";
import Toast from "../ui/Toast";
import PushRegistration from "../client/PushRegistration";
import SessionPersistence from "../client/SessionPersistence";
import SplashScreenHide from "../client/SplashScreenHide";
import CoachMarkTour from "../client/tours/CoachMarkTour";
import { NAV_TOUR_STEPS } from "@/lib/tours/coachSteps";
import { hasAuthCookie } from "@/lib/userGuide";
import { AuthGateProvider } from "@/lib/authGateContext";
import { SwipeDeckPreloader } from "@/app/recs/SwipeDeckProvider";
import { SocialPreloader } from "../client/SocialProvider";
import { SwipeSettingsPreloader } from "../client/SwipeSettingsProvider";
import WatchlistPreloader from "../client/WatchlistPreloader";

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
  // Nav-hinten är inloggat-läge-bara och får aldrig visas på landnings-/auth-
  // sidor. hasAuthCookie() läses i en effect eftersom document.cookie inte
  // finns under SSR — annars blir första renderingen fel för inloggade.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(hasAuthCookie());
  }, [pathname]);

  if (hideChrome) {
    return (
      // reducedMotion="user" följer iOS "Minska rörelse": framer-motion byter
      // transform-animationer mot korta toningar (dragningar fungerar ändå).
      <MotionConfig reducedMotion="user">
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
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <AuthGateProvider initiallyReady={!isLandingRoute}>
      <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100">
        <SplashScreenHide />
        <PushRegistration />
        <SessionPersistence />
        <SwipeDeckPreloader />
        <SocialPreloader />
        <SwipeSettingsPreloader />
        <WatchlistPreloader />
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col border-x border-white/10 bg-neutral-950 shadow-[0_0_80px_rgba(0,0,0,0.5)] pt-[env(safe-area-inset-top)]">
          <main className={`relative flex min-h-0 w-full flex-1 flex-col overflow-hidden ${MAIN_BOTTOM_PADDING}`}>
            {children}
          </main>

          {/* data-app-tabs: HintSheet mäter raden för att lägga bottenarken
              precis ovanför den (och innanför safe-area). */}
          <div
            data-app-tabs
            className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/60"
          >
            <BottomTabs />
          </div>

          <InviteToasts />
          <Toast />
        </div>

        {/* Nav-hinten: EN ruta som listar alla fem flikar, och först efter att
            swipe-genomgången är avklarad — inte fem modaler direkt vid start. */}
        {signedIn ? (
          <CoachMarkTour tourId="nav-tour" steps={NAV_TOUR_STEPS} requires={["swipe-gestures"]} delayMs={1400} />
        ) : null}
      </div>
    </AuthGateProvider>
    </MotionConfig>
  );
}
