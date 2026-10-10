"use client";

// Ramen för första-besöks-tratten (lib/funnel.ts):
//   - startar spårningen (first_open) vid första appstarten
//   - view:<sektion> första gången varje del av appen visas
//   - first_exit första gången appen/fliken göms, last_exit (överskrivs) varje
//     gång: VAR man var och hur långt man kommit — för den som aldrig kommer
//     tillbaka är last_exit svaret på "var lämnade de?"
//   - return_visit när enheten öppnas en senare kalenderdag
// /admin räknas inte.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { funnel, funnelBeacon, funnelInit, funnelSessionSwipes, funnelStart, lastStep } from "@/lib/funnel";

/** /group/swipe → group/swipe, /title/123 → title. Siffror och koder bort. */
function section(path: string): string {
  const parts = path.split("/").filter(Boolean).slice(0, 2);
  const clean = parts.filter((p) => /^[a-z-]+$/.test(p));
  return clean.length ? clean.join("/") : "start";
}

const dayOf = (t: number) => new Date(t).toLocaleDateString("sv-SE");

export default function FunnelTracker() {
  const pathname = usePathname() ?? "/";
  const isAdmin = pathname.startsWith("/admin");

  useEffect(() => {
    if (isAdmin) return;
    void funnelInit().then((s) => {
      if (s && s.track && dayOf(Date.now()) !== dayOf(s.t0)) funnel("return_visit");
    });
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    funnel(`view:${section(pathname)}`);
  }, [pathname, isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    const exit = () => {
      const t0 = funnelStart();
      const props = {
        at: section(location.pathname),
        swipes: funnelSessionSwipes(),
        secs: t0 ? Math.round((Date.now() - t0) / 1000) : null,
        step: lastStep(),
      };
      funnelBeacon("first_exit", props);
      funnelBeacon("last_exit", props, true);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") exit();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", exit);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", exit);
    };
  }, [isAdmin]);

  return null;
}
