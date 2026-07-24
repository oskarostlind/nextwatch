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
  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    diag("mount, isNativePlatform =", native);
    if (!native) return;
    let cancelled = false;

    void (async () => {
      try {
        const { Preferences } = await import("@capacitor/preferences");

        const existsRes = await fetch("/api/profile/exists", { cache: "no-store" });
        const exists = (await existsRes.json().catch(() => ({}))) as { hasProfile?: boolean };
        if (cancelled) return;
        diag("profile/exists →", existsRes.status, "hasProfile =", exists.hasProfile);

        if (exists.hasProfile) {
          // Inloggad/gäst med profil: håll speglingen färsk.
          const tokenRes = await fetch("/api/session/token", { cache: "no-store" });
          if (!tokenRes.ok) {
            diag("session/token misslyckades:", tokenRes.status);
            return;
          }
          const j = (await tokenRes.json()) as { ok?: boolean; token?: string };
          if (j.ok && j.token) {
            await Preferences.set({ key: STORE_KEY, value: j.token });
            diag("token speglad i Preferences (len", j.token.length, ")");
          } else {
            diag("token-svar utan token:", j.ok);
          }
          return;
        }

        // Ingen profil på cookien — antingen ny användare eller ITP-raderad
        // session. Finns en spegling: försök återställa.
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
          // Full reload så server-gates (/, /swipe) ser den återställda cookien.
          diag("återställd, laddar om");
          window.location.reload();
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
  }, []);

  return null;
}
