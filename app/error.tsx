// app/error.tsx
//
// Route-nivåns error boundary. Tidigare fanns ingen alls, så ALLA klientfel
// (inkl. chunk-fel under/efter deploy) gav Nexts vita "Application error".
// AppShell/navigeringen från layout.tsx ligger kvar runt den här vyn.
//
// Tre fall:
//  1. Chunk-fel (gammal klient efter deploy) → tyst hård omladdning.
//  2. Serverfel (error.digest finns — t.ex. när databasen inte svarar, som vid
//     Neon-stoppet 2026-10-28) → "Vi har lite strul" + automatiskt nytt försök
//     med växande paus (10 → 20 → 30 → 60 s). Tidigare stod det att felet
//     "oftast beror på en uppdatering", vilket var fel och fick användare att
//     tro att appen var trasig för gott.
//  3. Övriga klientfel → "Något gick fel" + Försök igen / Ladda om.
"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";
import { hideNativeSplash } from "@/lib/hideNativeSplash";
import ErrorScene from "./components/ui/ErrorScene";

const RETRY_STEPS_S = [10, 20, 30, 60];
/** Efter så här lång tid utan fel börjar trappan om från första steget. */
const RETRY_RESET_MS = 5 * 60 * 1000;

// Modulnivå: boundaryn kan monteras om mellan försöken, men trappan ska
// fortsätta uppåt så att en kvarstående driftstörning inte hamras var 10:e s.
let retryCount = 0;
let lastRetryAt = 0;

function nextDelaySeconds(): number {
  if (Date.now() - lastRetryAt > RETRY_RESET_MS) retryCount = 0;
  return RETRY_STEPS_S[Math.min(retryCount, RETRY_STEPS_S.length - 1)];
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");
  const router = useRouter();
  const [reloading, setReloading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const isServerError = Boolean(error.digest);

  const retry = useCallback(() => {
    retryCount += 1;
    lastRetryAt = Date.now();
    setRetrying(true);
    // Serverfel kräver att RSC-datan hämtas om — reset() ensam renderar bara
    // om samma trasiga resultat.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }, [router, reset]);

  useEffect(() => {
    void hideNativeSplash();
    setRetrying(false);
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      setReloading(true);
      return;
    }
    console.error("[route-error]", error);
  }, [error]);

  // Automatiskt nytt försök vid serverfel. Räknar bara när vyn syns, så en
  // app i bakgrunden inte pingar servern i onödan.
  useEffect(() => {
    if (!isServerError || reloading) return;
    let left = nextDelaySeconds();
    setSecondsLeft(left);
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      left -= 1;
      setSecondsLeft(left);
      if (left <= 0) {
        window.clearInterval(id);
        retry();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [error, isServerError, reloading, retry]);

  if (reloading) {
    return <div className="p-6 text-center text-neutral-400">{t("updating")}</div>;
  }

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center"
    >
      <ErrorScene label="!" />
      <h1 className="text-xl font-semibold text-white">
        {isServerError ? t("serverTitle") : t("title")}
      </h1>
      <p className="max-w-xs text-sm leading-relaxed text-neutral-400">
        {isServerError ? t("serverBody") : t("body")}
      </p>

      <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-black active:scale-[0.98] disabled:opacity-60"
        >
          {retrying ? t("retrying") : isServerError ? t("retryNow") : t("retry")}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-neutral-200 active:scale-[0.98]"
        >
          {t("reload")}
        </button>
      </div>

      {isServerError && !retrying && secondsLeft !== null && secondsLeft > 0 && (
        <p className="text-xs tabular-nums text-neutral-500" aria-live="polite">
          {t("retryIn", { seconds: secondsLeft })}
        </p>
      )}
    </div>
  );
}
