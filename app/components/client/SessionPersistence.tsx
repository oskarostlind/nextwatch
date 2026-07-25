"use client";

// Native session-räddning för iOS-appen (869e69y3q: "måste logga in ofta").
//
// WKWebView/ITP raderar cookies för remote-laddade Capacitor-appar efter ~7
// dagars inaktivitet. Sessionen bodde ENBART i cookie-jaren, så när cookien
// försvann myntade middleware tyst en ny anonym identitet och användaren
// dumpades på inloggningen.
//
// Lösningen: spegla det signerade sessionsvärdet i @capacitor/preferences
// (native storage, överlever ITP). Vid appstart:
//   - har cookien en profil → hämta token och spara/uppdatera speglingen
//   - saknar cookien profil men speglingen finns → återställ cookien via
//     /api/session/restore och ladda om så server-komponenterna ser den
//
// Mount-only räcker: alla inloggningsflöden (login/apple/gäst) gör full
// navigering till /swipe, så komponenten remountas efter varje lyckad login.
// Webben: no-op.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

const STORE_KEY = "nw_session_token";
// Per WebView-process (sessionStorage nollställs vid ny kallstart): högst en
// omladdning per appstart så en envis race aldrig blir en reload-loop.
const RELOAD_GUARD = "nw_sp_reloaded";

// Tillfällig diagnostik (869e8huma: "tvingas logga in varje öppning"). Flödet
// ser korrekt ut i kod och Vercel-loggarna visar att /api/session/restore ALDRIG
// anropas — så felet sitter i vilken gren som faktiskt tas på enheten. Loggar
// varje beslutspunkt så vi kan läsa det via Safari Web Inspector mot enheten.
// TA BORT när rot-orsaken är hittad.
const DIAG = true;
function diag(...args: unknown[]) {
  if (DIAG) console.log("[session-persist]", ...args);
}

export default function SessionPersistence() {
  const router = useRouter();
  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    diag("mount, isNativePlatform =", native);
    if (!native) return;
    let cancelled = false;

    void (async () => {
      try {
        const { Preferences } = await import("@capacitor/preferences");

        // Är vi på en utloggad vy (landning/auth)? WKWebView:ns kallstart hinner
        // ladda sidan innan cookie-storen synkats från disk, så SSR-requesten kan
        // sakna nw_uid och rendera landningen fast användaren egentligen är
        // inloggad. Reload-guarden (sessionStorage, nollställs vid ny WebView-
        // process) håller det till ETT omladdningsförsök per kallstart.
        const path = window.location.pathname;
        const onLoggedOutView = path === "/" || path.startsWith("/auth");
        const alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD) === "1";
        const goToApp = (why: string) => {
          if (alreadyReloaded) {
            diag("navigering redan gjord denna kallstart — hoppar", why);
            return;
          }
          sessionStorage.setItem(RELOAD_GUARD, "1");
          diag("navigerar till /swipe (klientnav):", why);
          // KLIENTNAV, inte window.location.reload(): WKWebView skickar INTE
          // cookien på top-level-dokumentnavigering ens när den finns i storen
          // — bevisat av loggarna (authed=true men reload landade ändå på
          // login). En RSC-fetch via routern bär däremot cookien (samma som
          // /api/profile/exists), så servern renderar /swipe inloggat.
          router.replace("/swipe");
        };

        const existsRes = await fetch("/api/profile/exists", { cache: "no-store" });
        const exists = (await existsRes.json().catch(() => ({}))) as {
          hasProfile?: boolean;
          authed?: boolean;
        };
        if (cancelled) return;
        diag("profile/exists →", existsRes.status, "hasProfile =", exists.hasProfile, "authed =", exists.authed);

        if (exists.hasProfile) {
          // Cookien är giltig NU. Håll speglingen färsk.
          const tokenRes = await fetch("/api/session/token", { cache: "no-store" });
          if (tokenRes.ok) {
            const j = (await tokenRes.json()) as { ok?: boolean; token?: string };
            if (j.ok && j.token) {
              await Preferences.set({ key: STORE_KEY, value: j.token });
              diag("token speglad i Preferences (len", j.token.length, ")");
            } else {
              diag("token-svar utan token:", j.ok);
            }
          } else {
            diag("session/token misslyckades:", tokenRes.status);
          }

          // Fullt inloggad men SSR visade ändå landningen → cookie-racet ovan.
          // Ladda om: nu är cookien synkad, så SSR redirectar in i appen (/swipe).
          if (exists.authed && onLoggedOutView && !cancelled) {
            goToApp("inloggad men fast på landningen (SSR-race)");
          }
          return;
        }

        // Ingen profil på cookien — antingen ny användare eller så klobbrade
        // middleware sessionen med en anonym uid när cookien saknades vid
        // kallstart. Finns en spegling: återställ den riktiga sessionen.
        const stored = await Preferences.get({ key: STORE_KEY });
        diag("ingen profil på cookien; Preferences-token finns =", Boolean(stored.value));
        if (cancelled || !stored.value) return;

        const restoreRes = await fetch("/api/session/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ token: stored.value }),
        });
        diag("session/restore →", restoreRes.status);

        if (restoreRes.ok) {
          goToApp("session återställd från spegling");
        } else if (restoreRes.status === 410) {
          // Kontot raderat — släng speglingen så vi inte försöker igen.
          await Preferences.remove({ key: STORE_KEY });
          diag("410 — kontot borta, slänger speglingen");
        }
      } catch (e) {
        // Best-effort: sessionräddningen får aldrig störa appstarten.
        diag("undantag:", e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
