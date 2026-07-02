"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Registrerar enheten för push-notiser när appen körs som native (Capacitor/iOS)
 * och skickar APNs-token till backend. På webben är det en no-op.
 *
 * Om token kommer innan inloggning sparas den lokalt och skickas igen vid retry.
 */
export default function PushRegistration() {
  const pendingToken = useRef<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeListeners: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setInterval> | undefined;

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

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== "granted") return;

        const regHandle = await PushNotifications.addListener("registration", (token) => {
          void postToken(token.value);
        });

        const errHandle = await PushNotifications.addListener("registrationError", () => {
          /* försöker igen vid nästa appstart eller retry-intervall */
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

        removeListeners = () => {
          void regHandle.remove();
          void errHandle.remove();
          void actionHandle.remove();
        };

        await PushNotifications.register();

        // Retry om token kom innan session fanns (401) eller nätverksfel.
        retryTimer = setInterval(() => {
          void retryPending();
        }, 30_000);

        const onVisible = () => {
          if (document.visibilityState === "visible") void retryPending();
        };
        document.addEventListener("visibilitychange", onVisible);

        const prevCleanup = removeListeners;
        removeListeners = () => {
          prevCleanup?.();
          document.removeEventListener("visibilitychange", onVisible);
        };
      } catch {
        /* pluginet saknas eller webb – ignorera */
      }
    })();

    return () => {
      if (retryTimer) clearInterval(retryTimer);
      removeListeners?.();
    };
  }, []);

  return null;
}
