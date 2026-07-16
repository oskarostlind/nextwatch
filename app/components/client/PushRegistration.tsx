"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Registrerar enheten för push-notiser när appen körs som native (Capacitor/iOS)
 * och skickar APNs-token till backend. På webben är det en no-op.
 *
 * Viktigt: registreringen görs INTE bara vid mount. Om användaren först NEKAR
 * notiser och sedan slår på dem manuellt i Inställningar fick vi tidigare aldrig
 * någon token (mount-effekten hade redan gett upp) → inga notiser. Nu:
 *   - lyssnarna kopplas alltid på, oberoende av behörighetsläge, och
 *   - vi försöker registrera igen varje gång appen kommer i förgrunden
 *     (appStateChange / visibilitychange) tills en token faktiskt sparats.
 */
export default function PushRegistration() {
  const pendingToken = useRef<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const cleanupFns: Array<() => void> = [];
    let cancelled = false;
    let registered = false; // sant först när en token bekräftats av backend

    const postToken = async (token: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
        });
        if (res.ok) {
          pendingToken.current = null;
          registered = true;
          return true;
        }
        pendingToken.current = token;
        return false;
      } catch {
        pendingToken.current = token;
        return false;
      }
    };

    const retryPending = async () => {
      const token = pendingToken.current;
      if (token) await postToken(token);
    };

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        // Lyssnarna kopplas på FÖRST och alltid — annars fångas inte en token
        // som kommer efter att notiser slagits på i efterhand.
        const regHandle = await PushNotifications.addListener("registration", (token) => {
          void postToken(token.value);
        });
        const errHandle = await PushNotifications.addListener("registrationError", () => {
          /* försöker igen vid nästa förgrund/retry-intervall */
        });
        const actionHandle = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const data = action.notification.data as Record<string, string> | undefined;
            const type = data?.type;
            if (type === "friend_request" || type === "friend_accepted" || type === "group_invite") {
              window.location.href = "/group";
            } else if (type === "group_match" || type === "group_invite_accepted") {
              const code = data?.groupCode;
              window.location.href = code
                ? `/group/swipe?code=${encodeURIComponent(code)}`
                : "/group/swipe";
            }
          }
        );
        cleanupFns.push(
          () => void regHandle.remove(),
          () => void errHandle.remove(),
          () => void actionHandle.remove()
        );

        /** Be om behörighet vid behov och registrera. Idempotent: register()
         *  ger tillbaka samma token, så det är ofarligt att köra flera gånger. */
        const ensureRegistered = async () => {
          if (registered) return;
          try {
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
              perm = await PushNotifications.requestPermissions();
            }
            if (perm.receive !== "granted") return;
            await PushNotifications.register();
          } catch {
            /* pluginet saknas eller webb – ignorera */
          }
        };

        await ensureRegistered();

        // Kör om när appen kommer i förgrunden — täcker fallet "nekade först,
        // slog på i Inställningar sen". Capacitor App-plugin finns redan i appen.
        try {
          const { App } = await import("@capacitor/app");
          const appStateHandle = await App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) {
              void ensureRegistered();
              void retryPending();
            }
          });
          cleanupFns.push(() => void appStateHandle.remove());
        } catch {
          /* @capacitor/app saknas – visibilitychange nedan täcker webben ändå */
        }

        const retryTimer = setInterval(() => {
          void retryPending();
        }, 30_000);
        cleanupFns.push(() => clearInterval(retryTimer));

        const onVisible = () => {
          if (document.visibilityState === "visible") {
            void ensureRegistered();
            void retryPending();
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        cleanupFns.push(() => document.removeEventListener("visibilitychange", onVisible));

        // Om komponenten hann avmonteras medan vi väntade på imports: städa direkt.
        if (cancelled) cleanupFns.forEach((fn) => fn());
      } catch {
        /* pluginet saknas eller webb – ignorera */
      }
    })();

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  return null;
}
