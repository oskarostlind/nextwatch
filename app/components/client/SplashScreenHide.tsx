"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Döljer den native launch-skärmen (svart + NextWatch-logga) när appen körs
 * som native (Capacitor/iOS). capacitor.config.ts sätter launchAutoHide:false
 * så launch-skärmen annars ligger kvar tills detta anrop görs – utan det
 * hinner iOS visa WKWebView:ns vita default-bakgrund innan den fjärrladdade
 * sidan (server.url) renderat något.
 */
export default function SplashScreenHide() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    (async () => {
      try {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch {
        /* pluginet saknas eller webb – ignorera */
      }
    })();
  }, []);

  return null;
}
