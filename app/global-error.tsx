// app/global-error.tsx
//
// Sista skyddsnätet: fångar fel i själva root-layouten (där app/error.tsx inte
// når). Ersätter hela dokumentet, så den måste rendera egna <html>/<body> och
// kan inte lita på providers/i18n/Tailwind-klasser från layouten — därför
// inline-stilar och svensk hårdkodad text.
"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return;
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="sv">
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
        <h2 style={{ margin: 0, fontSize: 18 }}>Något gick fel</h2>
        <p style={{ margin: 0, fontSize: 14, color: "#a3a3a3" }}>
          Appen behöver laddas om — oftast efter en uppdatering.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{ borderRadius: 999, border: 0, padding: "8px 20px", background: "#fafafa", color: "#000" }}
          >
            Försök igen
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ borderRadius: 999, border: "1px solid #525252", padding: "8px 20px", background: "transparent", color: "#fafafa" }}
          >
            Ladda om
          </button>
        </div>
      </body>
    </html>
  );
}
