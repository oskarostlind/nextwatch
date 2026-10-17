"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";
import { funnel } from "@/lib/funnel";
import {
  LIKED_EVENT,
  PUSH_ASK_AFTER_LIKES,
  RELEASE_ASK_EVENT,
  type ReleaseAskKind,
  blockingSheetOpen,
  likeCount,
} from "@/lib/engagement";
import { getFs } from "@/lib/firstSession";

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
 * Nya flödet (docs/nya-flodet.md, steg 7): en enhet som går igenom första
 * sessionen får notisfrågan i PushAskSheet efter kvällens AI-val i stället.
 * Den allmänna frågan efter första gilla står tillbaka tills flödet är klart.
 * Befintliga enheter har inget flödestillstånd (eligible=false) → som förut.
 */
function firstSessionActive(): boolean {
  try {
    const fs = getFs();
    return fs.eligible && fs.step !== "done";
  } catch {
    return false;
  }
}

/**
 * Återanvändbara push-hjälpare (används av PushAskSheet i nya flödet).
 *
 * register() triggar "registration"-händelsen, som PushRegistration (monterad i
 * AppShell) alltid lyssnar på och skickar till /api/push/register — därför
 * räcker det att anropa register() här.
 */
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

/** OS-läget för notiser. "prompt" = OS-dialogen kan visas (inkl. Androids andra chans). */
export async function getPushPermission(): Promise<PushPermission> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const r = (await PushNotifications.checkPermissions()).receive;
    if (r === "granted" || r === "denied") return r;
    return "prompt";
  } catch {
    return "unsupported";
  }
}

/**
 * Visar OS-dialogen (om den kan visas) och registrerar enheten vid ja.
 * Redan beviljat → bara register() (idempotent, samma token). Kastar aldrig.
 */
export async function requestPushPermissionAndRegister(): Promise<PushPermission> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const r = (await PushNotifications.requestPermissions()).receive;
    if (r === "granted") {
      try {
        await PushNotifications.register();
      } catch {
        /* behörigheten finns; token försöks igen vid nästa förgrund */
      }
      return "granted";
    }
    return r === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

/** Skjut upp den allmänna frågan (samma 3 dygn som "Inte nu" i den). */
export function snoozePushSoftAsk(): void {
  snoozeSoftAsk();
}

/**
 * Djuplänk för titelpush. Validerar strikt — datan kommer från en push-payload
 * och hamnar i en URL, så bara ett positivt heltal + movie|tv släpps igenom.
 */
function swipePickUrl(tmdbId: string | undefined, tmdbType: string | undefined): string {
  if (tmdbId && /^\d{1,9}$/.test(tmdbId) && (tmdbType === "movie" || tmdbType === "tv")) {
    return `/swipe?pick=${tmdbId}&type=${tmdbType}`;
  }
  return "/swipe";
}

/** Rapporterar att en push öppnats. Kastar aldrig och väntas aldrig in. */
function reportPushOpened(pid: string | undefined, actionId: string | undefined): void {
  if (!pid) return;
  try {
    void fetch("/api/push/opened", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid, action: actionId }),
    }).catch(() => {
      /* statistik — tyst vid fel */
    });
  } catch {
    /* fetch saknas/kastade synkront — ignorera */
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
/**
 * Frågan efter en like på ett "Kommer snart"-kort (RELEASE_ASK_EVENT).
 *  - ask:      OS-dialogen kan visas → egen fråga först, "Ja" visar OS-dialogen
 *  - settings: OS har nekat för gott → bara Inställningar kan slå på notiser
 *  - done:     behörighet finns redan → kort bekräftelse, ingen fråga
 */
type ReleaseAsk = { title: string; mode: "ask" | "settings" | "done"; kind?: ReleaseAskKind };

export default function PushRegistration() {
  const t = useTranslations("push");
  const pendingToken = useRef<string | null>(null);
  const [softAskOpen, setSoftAskOpen] = useState(false);
  // Sätts av effekten; anropas av soft-askens "Ja"-knapp.
  const requestAndRegister = useRef<(() => Promise<void>) | null>(null);
  const [releaseAsk, setReleaseAskState] = useState<ReleaseAsk | null>(null);
  // Speglas i en ref så att effektens closures (den allmänna frågan) ser om
  // release-frågan redan är öppen — två ark på varandra vore värsta tänkbara.
  const releaseAskOpen = useRef(false);
  const setReleaseAsk = (v: ReleaseAsk | null) => {
    releaseAskOpen.current = v !== null;
    setReleaseAskState(v);
  };
  // Sätts av effekten (behöver PushNotifications-pluginet).
  const releaseYes = useRef<(() => Promise<boolean>) | null>(null);
  const isIos = Capacitor.getPlatform() === "ios";

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
            // Öppnings-/klickstatistik (push_log). Best effort: får aldrig vänta in
            // eller fördröja navigeringen — keepalive låter anropet överleva att
            // sidan byts ut direkt efter.
            reportPushOpened(data?.pid, action.actionId);
            if (type === "daily_rec" || type === "weekly_picks" || type === "watchlist_nudge" || type === "release") {
              // Titelpush: öppna swipen med titeln överst (se pick-hanteringen i
              // app/swipe/page_client.tsx). Saknas id/typ går vi bara till /swipe.
              window.location.href = swipePickUrl(data?.tmdbId, data?.tmdbType);
            } else if (type === "re_engagement") {
              window.location.href = "/swipe";
            } else if (type === "friend_request" || type === "friend_accepted" || type === "group_invite") {
              window.location.href = "/group";
            } else if (type === "share_received") {
              // Filmtips: inboxen överst i watchlisten öppnar tråden.
              window.location.href = "/watchlist";
            } else if (type === "admin_mail") {
              // Inkommande mejl till nextwatch.se (app/api/email/inbound) — bara admin får den.
              window.location.href = "/admin?tab=mail";
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
              // Först efter några "gilla" — då vet användaren vad appen är och
              // varför notiser kan vara värda något. Aldrig ovanpå ett annat ark.
              if (
                !softAskSnoozed() &&
                likeCount() >= PUSH_ASK_AFTER_LIKES &&
                !firstSessionActive() &&
                !blockingSheetOpen() &&
                !releaseAskOpen.current
              ) {
                setSoftAskOpen(true);
                funnel("push_softask");
              }
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
          const perm = await requestPushPermissionAndRegister();
          if (perm !== "unsupported") funnel(perm === "granted" ? "push_granted" : "push_denied");
        };

        // "Kommer snart"-like: fråga om push för just den titeln — även om
        // användaren sagt nej förut (snoozen gäller inte här). Vad som går att
        // visa beror på OS-läget:
        //  - granted → inget att fråga; registrera token om den saknas, bekräfta.
        //  - prompt / prompt-with-rationale → vår fråga, "Ja" öppnar OS-dialogen.
        //    (Android 13+ ger en andra chans efter första nej: prompt-with-rationale.)
        //  - denied → OS-dialogen kan aldrig visas igen. iOS: knapp till appens
        //    sida i Inställningar. Android: instruktion (att öppna inställningarna
        //    kräver native-kod som inte finns i appen än).
        const askForRelease = async (title: string, kind: ReleaseAskKind) => {
          let state = "prompt";
          try {
            state = (await PushNotifications.checkPermissions()).receive;
          } catch {
            /* pluginet saknas — behandla som att vi kan fråga */
          }
          if (state === "granted") {
            if (!registered) {
              try {
                await PushNotifications.register();
              } catch {
                /* försöker igen vid nästa förgrund */
              }
            }
            // "Bevaka" har redan bekräftat med en toast.
            if (kind !== "stream") setReleaseAsk({ title, mode: "done" });
            return;
          }
          if (state === "denied") {
            setReleaseAsk({ title, mode: "settings", kind });
            funnel("push_release_denied_shown");
            return;
          }
          setReleaseAsk({ title, mode: "ask", kind });
          funnel("push_release_ask", { kind });
        };
        releaseYes.current = async () => {
          const perm = await requestPushPermissionAndRegister();
          if (perm === "unsupported") return false;
          funnel(perm === "granted" ? "push_release_granted" : "push_release_denied");
          return perm === "granted";
        };
        // Liten paus så arket inte dyker upp medan kortet fortfarande flyger ut.
        // Kortare än LIKED-pausen (1200 ms) så att den allmänna frågan ser att
        // release-frågan redan är öppen och står tillbaka.
        // Ligger ett annat ark öppet (t.ex. AI-arket "Välj åt mig", som nya
        // flödet öppnar av sig självt) väntar frågan tills det stängts — två
        // ark ovanpå varandra blir oläsbart. Ger upp efter RELEASE_WAIT_MAX_MS.
        const RELEASE_WAIT_STEP_MS = 700;
        const RELEASE_WAIT_MAX_MS = 3 * 60 * 1000;
        let releaseTimer: number | null = null;
        const onReleaseAsk = (e: Event) => {
          const detail = (e as CustomEvent<{ title?: string; kind?: ReleaseAskKind }>).detail;
          const title = detail?.title?.trim() || "";
          const kind: ReleaseAskKind = detail?.kind === "stream" ? "stream" : "release";
          if (!title) return;
          const deadline = Date.now() + RELEASE_WAIT_MAX_MS;
          const tryAsk = () => {
            releaseTimer = null;
            if (blockingSheetOpen()) {
              if (Date.now() < deadline) releaseTimer = window.setTimeout(tryAsk, RELEASE_WAIT_STEP_MS);
              return;
            }
            void askForRelease(title, kind);
          };
          if (releaseTimer !== null) window.clearTimeout(releaseTimer);
          releaseTimer = window.setTimeout(tryAsk, 450);
        };
        window.addEventListener(RELEASE_ASK_EVENT, onReleaseAsk);
        cleanupFns.push(() => {
          window.removeEventListener(RELEASE_ASK_EVENT, onReleaseAsk);
          if (releaseTimer !== null) window.clearTimeout(releaseTimer);
        });

        await ensureRegistered();

        // Varje "gilla" kan vara det som gör att frågan blir aktuell. Liten
        // paus så den inte krockar med kortet som flyger ut.
        const onLiked = () => {
          window.setTimeout(() => void ensureRegistered(), 1200);
        };
        window.addEventListener(LIKED_EVENT, onLiked);
        cleanupFns.push(() => window.removeEventListener(LIKED_EVENT, onLiked));

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

  // Bekräftelsen ("Klart! Vi säger till …") stänger sig själv.
  useEffect(() => {
    if (releaseAsk?.mode !== "done") return;
    const id = window.setTimeout(() => setReleaseAsk(null), 3500);
    return () => window.clearTimeout(id);
  }, [releaseAsk]);

  if (releaseAsk) {
    const values = { title: releaseAsk.title };
    const stream = releaseAsk.kind === "stream";
    return (
      <div
        data-blocking-sheet
        className="fixed inset-x-0 bottom-0 z-[70] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        <div className="mx-auto max-w-sm rounded-2xl border border-white/15 bg-neutral-900 p-4 shadow-2xl">
          {releaseAsk.mode === "done" ? (
            <p className="text-sm font-semibold text-white">
              {stream ? t("streamAsk.done", values) : t("releaseAsk.done", values)}
            </p>
          ) : releaseAsk.mode === "ask" ? (
            <>
              <p className="text-sm font-semibold text-white">
                {stream ? t("streamAsk.title", values) : t("releaseAsk.title", values)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/60">
                {stream ? t("streamAsk.body") : t("releaseAsk.body")}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const { title, kind } = releaseAsk;
                    setReleaseAsk(null);
                    funnel("push_release_yes");
                    void releaseYes.current?.().then((ok) => {
                      if (ok) setReleaseAsk({ title, mode: "done", kind });
                    });
                  }}
                  className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400"
                >
                  {t("releaseAsk.yes")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReleaseAsk(null);
                    // Nej här = nej tack just nu. Den allmänna frågan ska inte
                    // komma direkt efteråt heller.
                    snoozeSoftAsk();
                    funnel("push_release_no");
                  }}
                  className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5"
                >
                  {t("releaseAsk.no")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-white">{t("releaseAsk.settingsTitle")}</p>
              <p className="mt-1 text-sm leading-relaxed text-white/60">
                {stream
                  ? isIos
                    ? t("streamAsk.settingsBodyIos", values)
                    : t("streamAsk.settingsBodyAndroid", values)
                  : isIos
                    ? t("releaseAsk.settingsBodyIos", values)
                    : t("releaseAsk.settingsBodyAndroid", values)}
              </p>
              <div className="mt-3 flex gap-2">
                {isIos ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReleaseAsk(null);
                      funnel("push_release_open_settings");
                      // Capacitor iOS lämnar icke-app-URL:er till systemet
                      // (UIApplication.open) — app-settings: öppnar NextWatchs
                      // sida i Inställningar. Väl tillbaka registrerar
                      // appStateChange-lyssnaren token om notiser slagits på.
                      window.location.href = "app-settings:";
                    }}
                    className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400"
                  >
                    {t("releaseAsk.openSettings")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setReleaseAsk(null)}
                  className={`rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5 ${isIos ? "" : "flex-1"}`}
                >
                  {isIos ? t("releaseAsk.later") : t("releaseAsk.ok")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!softAskOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mx-auto max-w-sm rounded-2xl border border-white/15 bg-neutral-900 p-4 shadow-2xl">
        <p className="text-sm font-semibold text-white">{t("softAskTitle")}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/60">
          {t("softAskBody")}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSoftAskOpen(false);
              snoozeSoftAsk();
              funnel("push_softask_yes");
              void requestAndRegister.current?.();
            }}
            className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400"
          >
            {t("softAskYes")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSoftAskOpen(false);
              snoozeSoftAsk();
              funnel("push_softask_later");
            }}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5"
          >
            {t("softAskLater")}
          </button>
        </div>
      </div>
    </div>
  );
}
