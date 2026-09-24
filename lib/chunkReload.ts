// lib/chunkReload.ts
//
// Versionsglapp efter deploy: en klient som laddades från den gamla builden
// navigerar vidare och ber om JS-chunks som bara finns i den nya (eller
// tvärtom) → "ChunkLoadError: Loading chunk … failed". Utan error boundary
// visar Next då sin vita "Application error"-sida. iOS-appen laddar
// www.nextwatch.se via server.url och hålls öppen i dagar, så den är extra
// utsatt.
//
// Rätt åtgärd för ett chunk-fel är en hård omladdning: då hämtas HTML och
// chunks från samma (nya) build. Vi laddar om högst en gång per 30 s så att
// ett fel som INTE går över av en omladdning inte blir en oändlig loop.

const KEY = "nw_chunk_reload_at";
const WINDOW_MS = 30_000;

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  const name = e.name ?? "";
  const msg = e.message ?? String(err);
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

/** Laddar om sidan om vi inte redan gjort det nyligen. Returnerar true om omladdning startades. */
export function reloadOnceForChunkError(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage blockerat (privat läge m.m.) — ladda om ändå, men bara
    // om vi inte precis kom från en omladdning (performance-API som vakt).
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === "reload") return false;
  }
  window.location.reload();
  return true;
}
