// app/global-error.tsx
//
// Sista skyddsnätet: fångar fel i själva root-layouten (där app/error.tsx inte
// når). Ersätter hela dokumentet, så den måste rendera egna <html>/<body> och
// kan inte lita på providers/i18n/Tailwind-klasser från layouten — därför
// inline-stilar och en egen liten ordlista som läser nw_lang-cookien direkt.
// Samma upplägg som error.tsx: serverfel (digest) får "Vi har lite strul" och
// laddar om sig själv med växande paus; trappan sparas i sessionStorage
// eftersom varje försök är en hel omladdning.
"use client";

import { useEffect, useState } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";
import { hideNativeSplash } from "@/lib/hideNativeSplash";
import { LANG_COOKIE } from "@/lib/i18nConfig";

const COPY = {
  sv: {
    title: "Något gick fel",
    body: "Appen behöver laddas om. Försök igen.",
    serverTitle: "Vi har lite strul just nu",
    serverBody: "NextWatch får inte kontakt med servern. Det är inte ditt fel – dina swipes och din lista ligger kvar.",
    retry: "Försök igen",
    retryIn: (s: number) => `Försöker igen om ${s} s`,
  },
  en: {
    title: "Something went wrong",
    body: "The app needs to reload. Please try again.",
    serverTitle: "We are having some trouble",
    serverBody: "NextWatch can’t reach the server right now. It’s not your fault – your swipes and your list are safe.",
    retry: "Try again",
    retryIn: (s: number) => `Trying again in ${s} s`,
  },
};

const RETRY_STEPS_S = [10, 20, 30, 60];
const RETRY_KEY = "nw_global_retry";
const RETRY_RESET_MS = 5 * 60 * 1000;

function pickLang(): "sv" | "en" {
  if (typeof document === "undefined") return "sv";
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return m && decodeURIComponent(m[1]).startsWith("en") ? "en" : "sv";
}

function readRetry(): { n: number; at: number } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(RETRY_KEY) ?? "null");
    if (raw && Date.now() - raw.at < RETRY_RESET_MS) return raw;
  } catch {
    /* blockerad storage */
  }
  return { n: 0, at: 0 };
}

function reloadWithBackoff() {
  try {
    const r = readRetry();
    sessionStorage.setItem(RETRY_KEY, JSON.stringify({ n: r.n + 1, at: Date.now() }));
  } catch {
    /* blockerad storage — ladda om ändå */
  }
  window.location.reload();
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang, setLang] = useState<"sv" | "en">("sv");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const c = COPY[lang];
  const isServerError = Boolean(error.digest);

  useEffect(() => {
    setLang(pickLang());
    void hideNativeSplash();
  }, []);

  useEffect(() => {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return;
    console.error("[global-error]", error);
  }, [error]);

  useEffect(() => {
    if (!isServerError) return;
    const r = readRetry();
    let left = RETRY_STEPS_S[Math.min(r.n, RETRY_STEPS_S.length - 1)];
    setSecondsLeft(left);
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      left -= 1;
      setSecondsLeft(left);
      if (left <= 0) {
        window.clearInterval(id);
        reloadWithBackoff();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isServerError]);

  const card = {
    position: "absolute" as const,
    inset: 0,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
  };

  return (
    <html lang={lang}>
      <head>
        <title>NextWatch</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "24px 24px calc(24px + env(safe-area-inset-bottom))",
          boxSizing: "border-box",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
          textAlign: "center",
        }}
      >
        <div aria-hidden style={{ position: "relative", width: 112, height: 160, marginBottom: 8 }}>
          <div style={{ ...card, background: "#171717", transform: "translateX(-24px) rotate(-12deg)" }} />
          <div style={{ ...card, background: "rgba(38,38,38,0.7)", transform: "translateX(24px) rotate(12deg)" }} />
          <div
            style={{
              ...card,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "linear-gradient(#404040, #171717)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 600,
            }}
          >
            !
          </div>
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {isServerError ? c.serverTitle : c.title}
        </h1>
        <p style={{ margin: 0, maxWidth: 320, fontSize: 14, lineHeight: 1.6, color: "#a3a3a3" }}>
          {isServerError ? c.serverBody : c.body}
        </p>
        <button
          type="button"
          onClick={reloadWithBackoff}
          style={{
            marginTop: 8,
            width: "100%",
            maxWidth: 320,
            borderRadius: 999,
            border: 0,
            padding: "12px 20px",
            fontSize: 14,
            fontWeight: 600,
            background: "#fafafa",
            color: "#000",
          }}
        >
          {c.retry}
        </button>
        {isServerError && secondsLeft !== null && secondsLeft > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "#737373", fontVariantNumeric: "tabular-nums" }} aria-live="polite">
            {c.retryIn(secondsLeft)}
          </p>
        )}
      </body>
    </html>
  );
}
