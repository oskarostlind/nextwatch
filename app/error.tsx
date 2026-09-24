// app/error.tsx
//
// Route-nivåns error boundary. Tidigare fanns ingen alls, så ALLA klientfel
// (inkl. chunk-fel under/efter deploy) gav Nexts vita "Application error".
// Nu: chunk-fel → tyst hård omladdning, övriga fel → en riktig felvy med
// "Försök igen" i stället för en död sida. AppShell/navigeringen från
// layout.tsx ligger kvar runt den här vyn.
"use client";

import { useEffect, useState } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      setReloading(true);
      return;
    }
    console.error("[route-error]", error);
  }, [error]);

  if (reloading) {
    return <div className="p-6 text-center text-neutral-400">Uppdaterar appen…</div>;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold">Något gick fel</h2>
      <p className="text-sm text-neutral-400">
        Sidan kunde inte visas. Det beror oftast på en uppdatering av appen — försök igen.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
        >
          Försök igen
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-neutral-600 px-5 py-2 text-sm"
        >
          Ladda om
        </button>
      </div>
    </main>
  );
}
