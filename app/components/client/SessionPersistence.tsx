"use client";

// Native session-räddning för iOS-appen (869e8huma: "måste logga in ofta").
//
// Appen laddar www.nextwatch.se i WKWebView via server.url. Två saker slog mot
// sessionen:
//   1) WKWebView/ITP kan radera cookies för remote-laddade appar → sessionen,
//      som bodde enbart i cookie-jaren, försvann och middleware myntade en
//      anonym identitet. Motmedel: spegla det signerade sessionsvärdet i
//      @capacitor/preferences (native storage, överlever ITP) och återställ via
//      /api/session/restore vid start.
//   2) Vid KALLSTART hinner webbvyn ladda sidan innan cookie-storen synkats →
//      SSR-requesten saknar nw_uid och renderar landningen fast användaren är
//      inloggad. WKWebView skickar dessutom inte cookien på top-level-
//      dokumentnavigering (en reload räcker alltså inte). Motmedel: en KLIENT-
//      navigering (router.replace) till /swipe — RSC-fetchen bär cookien, precis
//      som fetch mot /api/profile/exists, så servern renderar inloggat.
//
// Webben: no-op.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

const STORE_KEY = "nw_session_token";
// Per WebView-process (sessionStorage nollställs vid ny kallstart): högst en
// navigering per appstart så en envis race aldrig blir en loop.
const RELOAD_GUARD = "nw_sp_reloaded";

export default function SessionPersistence() {
  const router = useRouter();
  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    if (!native) return;
    let cancelled = false;

    void (async () => {
      try {
        const { Preferences } = await import("@capacitor/preferences");

        const path = window.location.pathname;
        const onLoggedOutView = path === "/" || path.startsWith("/auth");
        const alreadyNavigated = sessionStorage.getItem(RELOAD_GUARD) === "1";
        const goToApp = () => {
          if (alreadyNavigated) return;
          sessionStorage.setItem(RELOAD_GUARD, "1");
          // Klientnav (inte window.location.reload()): WKWebView skickar inte
          // cookien på top-level-dokumentnavigering ens när den finns i storen,
          // men RSC-fetchen via routern bär den → servern renderar /swipe
          // inloggat.
          router.replace("/swipe");
        };

        const existsRes = await fetch("/api/profile/exists", { cache: "no-store" });
        const exists = (await existsRes.json().catch(() => ({}))) as {
          hasProfile?: boolean;
          authed?: boolean;
        };
        if (cancelled) return;

        if (exists.hasProfile) {
          // Cookien är giltig nu. Håll speglingen färsk.
          const tokenRes = await fetch("/api/session/token", { cache: "no-store" });
          if (tokenRes.ok) {
            const j = (await tokenRes.json()) as { ok?: boolean; token?: string };
            if (j.ok && j.token) {
              await Preferences.set({ key: STORE_KEY, value: j.token });
            }
          }

          // Fullt inloggad men SSR visade ändå landningen → kallstarts-race.
          // Navigera in i appen (RSC-fetchen bär cookien).
          if (exists.authed && onLoggedOutView && !cancelled) {
            goToApp();
          }
          return;
        }

        // Ingen profil på cookien — ny användare eller så klobbrade middleware
        // sessionen med en anonym uid när cookien saknades vid kallstart. Finns
        // en spegling: återställ den riktiga sessionen och navigera in.
        const stored = await Preferences.get({ key: STORE_KEY });
        if (cancelled || !stored.value) return;

        const restoreRes = await fetch("/api/session/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ token: stored.value }),
        });

        if (restoreRes.ok) {
          goToApp();
        } else if (restoreRes.status === 410) {
          // Kontot raderat — släng speglingen så vi inte försöker igen.
          await Preferences.remove({ key: STORE_KEY });
        }
      } catch {
        // Best-effort: sessionräddningen får aldrig störa appstarten.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
