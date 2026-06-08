"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Registrerar enheten för push-notiser när appen körs som native (Capacitor/iOS)
 * och skickar APNs/FCM-token till backend. På webben är det en no-op.
 *
 * Pluginet importeras dynamiskt och bara på native, så webb-bygget aldrig
 * laddar native-koden.
 */
export default function PushRegistration() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeListeners: (() => void) | undefined;

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== "granted") return;

        const regHandle = await PushNotifications.addListener("registration", (token) => {
          void fetch("/api/push/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() }),
          }).catch(() => {
            /* best-effort */
          });
        });

        const errHandle = await PushNotifications.addListener("registrationError", () => {
          /* tyst – vi försöker igen vid nästa appstart */
        });

        removeListeners = () => {
          void regHandle.remove();
          void errHandle.remove();
        };

        await PushNotifications.register();
      } catch {
        /* pluginet saknas eller webb – ignorera */
      }
    })();

    return () => {
      removeListeners?.();
    };
  }, []);

  return null;
}
