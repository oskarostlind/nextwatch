"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useAuthGate } from "@/lib/authGateContext";

// Hårt tak: hänger sessionskollen (nätverksfel, backend nere) ska launch-
// skärmen ändå släppa – en stående svart skärm är värre än en kort glimt av
// fel vy.
const SAFETY_TIMEOUT_MS = 5000;

/**
 * Döljer den native launch-skärmen (svart + NextWatch-logga) när appen körs
 * som native (Capacitor/iOS). capacitor.config.ts sätter launchAutoHide:false
 * så launch-skärmen annars ligger kvar tills detta anrop görs – utan det
 * hinner iOS visa WKWebView:ns vita default-bakgrund innan den fjärrladdade
 * sidan (server.url) renderat något.
 *
 * `ready` (se lib/authGateContext.tsx) är true direkt på alla sidor utom
 * landningen ("/"), där AuthGate.tsx håller den false tills sessionskollen
 * svarat – annars hinner launch-skärmen släppa innan vi vet om nästa vy blir
 * inloggningen eller /swipe, och användaren ser en glimt av fel vy.
 */
export default function SplashScreenHide() {
  const { ready } = useAuthGate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      (async () => {
        try {
          const { SplashScreen } = await import("@capacitor/splash-screen");
          await SplashScreen.hide();
        } catch {
          /* pluginet saknas eller webb – ignorera */
        }
      })();
    };

    if (ready) {
      hide();
      return;
    }
    const t = window.setTimeout(hide, SAFETY_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [ready]);

  return null;
}
