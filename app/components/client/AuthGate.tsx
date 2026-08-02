"use client";

// Gate runt landningens innehåll (HeroDeck / inloggningsvyn).
//
// SSR (app/page.tsx) avgör om landningen ska visas utifrån nw_uid-cookien vid
// request-tillfället. På native/WKWebView kan den cookien saknas vid KALLSTART
// även för en redan inloggad användare (cookie-storen hinner inte synka innan
// första requesten, se SessionPersistence.tsx) — SSR renderar då landningen
// trots att användaren egentligen är inloggad.
//
// Den här komponenten gör ETT extra klientanrop (samma /api/profile/exists som
// SessionPersistence redan litar på) och visar en neutral, varumärkt
// laddningsvy tills svaret är säkert:
//   - inloggad  → navigerar till /swipe, fortsätter visa laddningsvyn (aldrig
//     landningen) tills route-bytet är klart.
//   - utloggad  → visar landningen (children) — först då vet vi att den
//     faktiskt stämmer.
// markReady() (se lib/authGateContext.tsx) släpper i sin tur den native
// launch-skärmen, se SplashScreenHide.tsx.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthGate } from "@/lib/authGateContext";
import BrandedLoader from "./BrandedLoader";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { markReady } = useAuthGate();
  const [status, setStatus] = useState<"checking" | "guest" | "authed">("checking");
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/profile/exists", { cache: "no-store" });
        const j = (await res.json().catch(() => ({}))) as { authed?: boolean };
        if (cancelled) return;
        if (j.authed) {
          setStatus("authed");
          router.replace("/swipe");
        } else {
          setStatus("guest");
        }
      } catch {
        // Nätverksfel: hellre visa landningen (fail-open) än fastna i laddning.
        if (!cancelled) setStatus("guest");
      } finally {
        if (!cancelled && !settled.current) {
          settled.current = true;
          markReady();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, markReady]);

  if (status === "guest") return <>{children}</>;
  // "checking" och "authed" (väntar på route-bytet till /swipe) visar samma
  // varumärkta laddningsvy — aldrig inloggningsvyn.
  return <BrandedLoader />;
}
