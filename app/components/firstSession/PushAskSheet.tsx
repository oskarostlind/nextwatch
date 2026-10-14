"use client";

// Nya flödet (docs/nya-flodet.md), steg 7: notisfrågan med ett löfte.
//
// Kommer efter kvällens AI-val (och spara/betalväggen) i stället för 1 s efter
// första gilla. Idag: 68 % trycker "Senare" och 14 % av nya tillåter push —
// men användare med push är aktiva vecka 1 till 23 % mot 5 %. Frågan säger
// därför vad man får och när: "Vill du få kvällens AI-val när du brukar
// titta?", med tidsval (18–21) och en förhandsvisning av själva notisen.
//
// OS-läget avgör vad "Ja" gör:
//  - prompt  → OS-dialogen (via requestPushPermissionAndRegister i PushRegistration)
//  - granted → ingen dialog, bara registrera + spara timmen
//  - denied  → iOS: knapp till appens sida i Inställningar; Android: instruktion
// Vald timme sparas i profiles.push_hour (/api/push/preferences) och styr när
// cronen skickar (lib/pushRecs/timing.ts). Steget avslutas ALLTID med
// advanceFs("push"), oavsett svar. Webben har ingen push → steget hoppas över.

import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";
import { advanceFs, type FsState } from "@/lib/firstSession";
import { funnel } from "@/lib/funnel";
import {
  getPushPermission,
  requestPushPermissionAndRegister,
  snoozePushSoftAsk,
} from "@/app/components/client/PushRegistration";

const HOURS = [18, 19, 20, 21] as const;
type Mode = "ask" | "granted" | "denied";

/**
 * Förvald tid. Första sessionen pågår just nu, så klockan nu är den billigaste
 * signalen om när användaren brukar titta: ligger den inom 18–21 (±1 h) väljs
 * den, annars 20. Serverns typvärde av swipetimmar kräver ≥ 8 betyg utspridda
 * över tid och säger inget mer för en enhet som är minuter gammal.
 */
function guessHour(): number {
  const h = new Date().getHours();
  if (h >= 18 && h <= 21) return h;
  if (h === 17) return 18;
  if (h === 22) return 21;
  return 20;
}

const label = (h: number) => `${h}:00`;

/** Sparar vald timme. Best effort — en miss ger bara standardtiden. */
function savePushHour(hour: number): void {
  try {
    void fetch("/api/push/preferences", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hour }),
    }).catch(() => {
      /* tyst */
    });
  } catch {
    /* tyst */
  }
}

export default function PushAskSheet({ fs }: { fs: FsState }) {
  const t = useTranslations("pushAsk");
  const [mode, setMode] = useState<Mode | null>(null);
  const [hour, setHour] = useState<number>(guessHour);
  const [busy, setBusy] = useState(false);
  const isIos = Capacitor.getPlatform() === "ios";

  // Förhandsvisningen: senast gillade titeln från leken.
  // TODO(nya-flodet:2): visa kvällens AI-val här om AiReveal exponerar det
  // (t.ex. på FsState) — tills dess senaste gillade, annars en neutral text.
  const preview = useMemo(() => {
    const last = fs.likes.length ? fs.likes[fs.likes.length - 1] : null;
    const poster = last?.poster && /^https:\/\//.test(last.poster) ? last.poster : null;
    return { title: last?.title?.trim() || null, poster };
  }, [fs.likes]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const perm = await getPushPermission();
      if (!alive) return;
      if (perm === "unsupported") {
        // Webben (eller pluginet saknas): ingen push att fråga om.
        advanceFs("push");
        return;
      }
      const m: Mode = perm === "prompt" ? "ask" : perm;
      setMode(m);
      funnel("push_ask_shown", { mode: m, hour: guessHour() });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!mode) return null;

  const time = label(hour);

  const onYes = async () => {
    if (busy) return;
    setBusy(true);
    funnel("push_time_chosen", { hour, mode });
    savePushHour(hour);

    if (mode === "denied") {
      advanceFs("push");
      if (isIos) {
        funnel("push_ask_open_settings");
        // Capacitor iOS lämnar icke-app-URL:er till systemet (UIApplication.open).
        // Väl tillbaka registrerar PushRegistration token om notiser slagits på.
        window.location.href = "app-settings:";
      }
      return;
    }

    if (mode === "ask") {
      // TODO(nya-flodet:1): anropa suppressExitTracking(ms) från lib/funnel.ts här
      // när del 1 exporterar den — OS-dialogen blurrar appen och ser annars ut
      // som att användaren lämnade.
    }
    const perm = await requestPushPermissionAndRegister();
    if (mode === "ask" && perm !== "unsupported") {
      funnel(perm === "granted" ? "push_granted" : "push_denied", { src: "fs" });
    }
    advanceFs("push");
  };

  const onLater = () => {
    funnel("push_ask_later", { mode });
    // Den allmänna frågan efter gilla ska inte dyka upp direkt efter flödet.
    snoozePushSoftAsk();
    advanceFs("push");
  };

  const cta = mode === "denied" ? (isIos ? t("openSettings") : t("okAt", { time })) : t("yes", { time });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nw-push-ask-title"
      data-blocking-sheet
      className="fixed inset-0 z-[70] flex items-end bg-black/50"
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-t-[28px] border-t border-white/10 bg-[#141416] px-[22px] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3 text-white shadow-2xl">
        <div className="flex justify-center">
          <span className="h-1 w-[38px] rounded-full bg-white/20" aria-hidden />
        </div>

        <h2 id="nw-push-ask-title" className="text-[25px] font-extrabold leading-[1.12] tracking-[-0.02em]">
          {t("title")}
        </h2>

        <div className="flex gap-2" role="group" aria-label={t("timeGroup")}>
          {HOURS.map((h) => {
            const on = h === hour;
            return (
              <button
                key={h}
                type="button"
                aria-pressed={on}
                onClick={() => setHour(h)}
                className={`h-[46px] flex-1 rounded-xl border text-base font-bold transition ${
                  on
                    ? "border-cyan-400 bg-cyan-400/15 text-cyan-100"
                    : "border-white/10 bg-[#1b1b1e] text-neutral-300 hover:bg-white/5"
                }`}
              >
                {label(h)}
              </button>
            );
          })}
        </div>

        {/* Förhandsvisning av notisen — uppdateras med vald tid. */}
        <div
          aria-hidden
          className="flex items-start gap-3 rounded-[18px] border border-white/10 bg-[rgba(40,40,44,0.92)] px-3.5 py-3"
        >
          <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[9px] border border-cyan-400/50 bg-[#0a0a0a] text-[13px] font-extrabold text-cyan-400">
            NW
          </span>
          <span className="flex min-w-0 flex-auto flex-col gap-[3px]">
            <span className="flex justify-between text-xs text-neutral-400">
              <span>NEXTWATCH</span>
              <span>{time}</span>
            </span>
            <span className="truncate text-[15px] font-bold">
              {preview.title ? t("previewTitle", { title: preview.title }) : t("previewTitleGeneric")}
            </span>
            <span className="text-sm leading-snug text-neutral-300">{t("previewBody")}</span>
          </span>
          {preview.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.poster} alt="" className="h-[51px] w-[34px] flex-none rounded-md object-cover" />
          ) : null}
        </div>

        {mode === "denied" ? (
          <p className="text-sm leading-relaxed text-white/60">
            {isIos ? t("deniedIos", { time }) : t("deniedAndroid", { time })}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void onYes()}
          className="h-[54px] rounded-[14px] bg-cyan-400 text-[17px] font-extrabold text-[#0a0a0a] transition hover:bg-cyan-300 disabled:opacity-60"
        >
          {cta}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onLater}
          className="h-11 text-[15px] text-neutral-400 transition hover:text-neutral-200"
        >
          {t("notNow")}
        </button>
      </div>
    </div>
  );
}
