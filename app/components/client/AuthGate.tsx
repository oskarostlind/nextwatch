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
//
// KALLSTART I APPEN ("nya flödet", 2026-10-15, docs/nya-flodet.md): i iOS- och
// Android-appen visas startsidan aldrig. Utan profil skapas en gästprofil tyst
// (samma POST /api/profile/guest som "Hoppa in som gäst") och appen går rakt
// till leken, där "Har du konto? Logga in" finns som diskret länk. Två skydd:
//   - En gäst med profil vars cookie SSR missade går också rakt in (förr fick
//     den startsidan).
//   - Finns en speglad session i native-lagringen (SessionPersistence) har
//     cookien troligen klobbrats vid kallstarten — då skapas INGEN gäst (den
//     skulle annars ta över speglingen och tappa det riktiga kontot). Vi väntar
//     i stället en stund på att SessionPersistence återställer sessionen, och
//     visar startsidan som förut om det inte händer.
// Webben är oförändrad här: startsidan (SEO) står kvar och dess knapp
// "Börja swipa" går in i leken, se HeroDeck.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthGate } from "@/lib/authGateContext";
import { isNativeStoreApp } from "@/lib/premiumPurchase";
import { createGuestProfile } from "@/app/components/firstSession/deck/fsDeck";
import BrandedLoader from "./BrandedLoader";

type Exists = { authed?: boolean; hasProfile?: boolean };

async function readExists(): Promise<Exists> {
  const res = await fetch("/api/profile/exists", { cache: "no-store" });
  return (await res.json().catch(() => ({}))) as Exists;
}

/** Finns en speglad session i native-lagringen (se SessionPersistence.tsx)? */
async function hasMirroredSession(): Promise<boolean> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const v = await Preferences.get({ key: "nw_session_token" });
    return Boolean(v.value);
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { markReady } = useAuthGate();
  const [status, setStatus] = useState<"checking" | "guest" | "authed">("checking");
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const enterApp = () => {
      setStatus("authed");
      // Efter utloggning (?login=1) följer önskan om inloggning med in i leken.
      const wantsLogin = new URLSearchParams(window.location.search).get("login") === "1";
      router.replace(wantsLogin ? "/swipe?login=1" : "/swipe");
    };

    /** Appens kallstart. true = på väg in i leken; false = visa startsidan. */
    const nativeColdStart = async (first: Exists): Promise<boolean> => {
      if (first.hasProfile) return true;
      if (await hasMirroredSession()) {
        // Ge SessionPersistence ~5 s att återställa sessionen (den navigerar
        // själv, men vi följer också efter så laddningsvyn aldrig blir kvar).
        for (let i = 0; i < 10 && !cancelled; i++) {
          await sleep(500);
          const j = await readExists().catch(() => ({}) as Exists);
          if (j.hasProfile) return true;
        }
        return false;
      }
      return createGuestProfile("app");
    };

    (async () => {
      try {
        const j = await readExists();
        if (cancelled) return;
        if (j.authed) {
          enterApp();
        } else if (isNativeStoreApp()) {
          const ok = await nativeColdStart(j);
          if (cancelled) return;
          // Klientnavigering (inte location.href): WKWebView skickar inte alltid
          // cookien på en top-level-dokumentnavigering vid kallstart, men
          // RSC-hämtningen via routern bär den (se SessionPersistence.tsx).
          if (ok) enterApp();
          else setStatus("guest");
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
