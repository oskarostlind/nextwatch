"use client";

// "Appen är öppen" — underlaget för retention och "online nu" i /admin.
// Pingar /api/track/active när appen öppnas eller kommer tillbaka i förgrunden
// (iOS-WebViewn pausas i bakgrunden), och sedan var 2:a minut medan den syns.
// Servern skriver som mest en dagsrad per användare, så pingen är billig.
// /admin räknas inte — annars blir Oskar själv "online" varje gång han kollar.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const HEARTBEAT_MS = 2 * 60 * 1000;
const MIN_GAP_MS = 45 * 1000;

let lastPing = 0;

function ping() {
  const now = Date.now();
  if (now - lastPing < MIN_GAP_MS) return;
  lastPing = now;
  void fetch("/api/track/active", { method: "POST", keepalive: true }).catch(() => {});
}

export default function ActivityBeacon() {
  const pathname = usePathname();
  const skip = pathname?.startsWith("/admin") ?? false;

  useEffect(() => {
    if (skip) return;
    if (document.visibilityState === "visible") ping();
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, HEARTBEAT_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, [skip]);

  return null;
}
