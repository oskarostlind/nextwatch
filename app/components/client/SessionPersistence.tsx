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
import { Capacitor } from "@capacitor/core";

const STORE_KEY = "nw_session_token";

export default function SessionPersistence() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;

    void (async () => {
      try {
        const { Preferences } = await import("@capacitor/preferences");

        const existsRes = await fetch("/api/profile/exists", { cache: "no-store" });
        const exists = (await existsRes.json().catch(() => ({}))) as { hasProfile?: boolean };
        if (cancelled) return;

        if (exists.hasProfile) {
          // Inloggad/gäst med profil: håll speglingen färsk.
          const tokenRes = await fetch("/api/session/token", { cache: "no-store" });
          if (!tokenRes.ok) return;
          const j = (await tokenRes.json()) as { ok?: boolean; token?: string };
          if (j.ok && j.token) await Preferences.set({ key: STORE_KEY, value: j.token });
          return;
        }

        // Ingen profil på cookien — antingen ny användare eller ITP-raderad
        // session. Finns en spegling: försök återställa.
        const stored = await Preferences.get({ key: STORE_KEY });
        if (cancelled || !stored.value) return;

        const restoreRes = await fetch("/api/session/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ token: stored.value }),
        });

        if (restoreRes.ok) {
          // Full reload så server-gates (/, /swipe) ser den återställda cookien.
          window.location.reload();
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
  }, []);

  return null;
}
