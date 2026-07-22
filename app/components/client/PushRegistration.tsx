"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Soft-ask före OS-dialogen: iOS ger EN chans att fråga — nekad OS-dialog kan
 * bara ångras djupt inne i Inställningar. Egen fråga först ger kontext och
 * fler ja. "Inte nu" backar av i 3 dagar.
 */
const SOFTASK_KEY = "nw_push_softask_at";
const SOFTASK_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function softAskSnoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SOFTASK_KEY)) || 0;
    return Date.now() - at < SOFTASK_SNOOZE_MS;
  } catch {
    return false;
  }
}

function snoozeSoftAsk(): void {
  try {
    window.localStorage.setItem(SOFTASK_KEY, String(Date.now()));
  } catch {
    /* privat läge — frågan återkommer, acceptabelt */
  }
}

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
  const [softAskOpen, setSoftAskOpen] = useState(false);
  // Sätts av effekten; anropas av soft-askens "Ja"-knapp.
  const requestAndRegister = useRef<(() => Promise<void>) | null>(null);

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
            } else if (type === "share_received") {
              // Filmtips: inboxen överst i watchlisten öppnar tråden.
              window.location.href = "/watchlist";
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

        /** Registrera om behörighet finns. Har vi ALDRIG frågat (prompt) visas
         *  soft-asken i stället för OS-dialogen — Apple ogillar kall fråga vid
         *  start, och en nekad OS-dialog kan bara ångras i Inställningar.
         *  Idempotent: register() ger samma token, ofarligt att köra igen. */
        const ensureRegistered = async () => {
          if (registered) return;
          try {
            const perm = await PushNotifications.checkPermissions();
            if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
              if (!softAskSnoozed()) setSoftAskOpen(true);
              return;
            }
            if (perm.receive !== "granted") return;
            await PushNotifications.register();
          } catch {
            /* pluginet saknas eller webb – ignorera */
          }
        };

        // Soft-askens "Ja": nu FÅR vi visa OS-dialogen.
        requestAndRegister.current = async () => {
          try {
            const perm = await PushNotifications.requestPermissions();
            if (perm.receive === "granted") await PushNotifications.register();
          } catch {
            /* ignorera */
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

  if (!softAskOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mx-auto max-w-sm rounded-2xl border border-white/15 bg-neutral-900 p-4 shadow-2xl">
        <p className="text-sm font-semibold text-white">Vill du få notiser? 🔔</p>
        <p className="mt-1 text-sm leading-relaxed text-white/60">
          Vi säger till när din grupp matchar, när vänner skickar filmtips och när dagens
          rekommendation landar. Du väljer själv vilka typer i inställningarna.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSoftAskOpen(false);
              snoozeSoftAsk();
              void requestAndRegister.current?.();
            }}
            className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400"
          >
            Ja, aktivera
          </button>
          <button
            type="button"
            onClick={() => {
              setSoftAskOpen(false);
              snoozeSoftAsk();
            }}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5"
          >
            Inte nu
          </button>
        </div>
      </div>
    </div>
  );
}
