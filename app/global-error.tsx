// app/global-error.tsx
//
// Sista skyddsnätet: fångar fel i själva root-layouten (där app/error.tsx inte
// når). Ersätter hela dokumentet, så den måste rendera egna <html>/<body> och
// kan inte lita på providers/i18n/Tailwind-klasser från layouten — därför
// inline-stilar och en egen liten ordlista som läser nw_lang-cookien direkt.
"use client";

import { useEffect, useState } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";
import { LANG_COOKIE } from "@/lib/i18nConfig";

const COPY = {
  sv: { title: "Något gick fel", body: "Appen behöver laddas om — oftast efter en uppdatering.", retry: "Försök igen", reload: "Ladda om" },
  en: { title: "Something went wrong", body: "The app needs to reload — usually after an update.", retry: "Try again", reload: "Reload" },
};

function pickLang(): "sv" | "en" {
  if (typeof document === "undefined") return "sv";
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return m && decodeURIComponent(m[1]).startsWith("en") ? "en" : "sv";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang, setLang] = useState<"sv" | "en">("sv");
  useEffect(() => setLang(pickLang()), []);
  const c = COPY[lang];

  useEffect(() => {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return;
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang={lang}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>{c.title}</h2>
        <p style={{ margin: 0, fontSize: 14, color: "#a3a3a3" }}>
          {c.body}
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{ borderRadius: 999, border: 0, padding: "8px 20px", background: "#fafafa", color: "#000" }}
          >
            {c.retry}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ borderRadius: 999, border: "1px solid #525252", padding: "8px 20px", background: "transparent", color: "#fafafa" }}
          >
            {c.reload}
          </button>
        </div>
      </body>
    </html>
  );
}
