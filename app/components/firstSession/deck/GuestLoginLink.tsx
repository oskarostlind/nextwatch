"use client";

// "Logga in" — diskret knapp i toppraden (bredvid avataren) för ALLA gäster
// (inte bara nya enheter: efter utloggning i appen skapas en gäst tyst, och
// utan länken fanns ingen synlig väg tillbaka till kontot).
// Sedan kallstarten (docs/nya-flodet.md) visar appen aldrig startsidan, så den
// här länken är vägen in för den som redan har ett konto (t.ex. efter en
// ominstallation eller utloggning). Inloggning byter nw_uid, och då avslutar
// leken första sessionen (syncFsOwner i ./fsDeck.ts).
//
// 2026-11-09: flyttad från en egen rad ovanför kortet ("Har du konto? Logga in",
// ~30 px) in i toppraden — raden krympte kortet så att baksidans text inte
// syntes. Renderar bara knappen; föräldern placerar den.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { getAccountStatus } from "@/lib/accountStatus";

const LoginSheet = dynamic(() => import("@/app/components/auth/LoginSheet"), { ssr: false });

export default function GuestLoginLink() {
  const t = useTranslations("fsDeck");
  const [guest, setGuest] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAccountStatus().then((s) => {
      if (cancelled) return;
      const isGuestNow = Boolean(s && s.hasProfile && !s.hasAccount);
      setGuest(isGuestNow);
      // Efter "Logga ut" (LogoutButton → /?login=1 → AuthGate → /swipe?login=1)
      // öppnas inloggningen direkt: den som loggar ut vill nästan alltid logga in
      // igen, ofta på ett annat konto.
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("login") === "1") {
          url.searchParams.delete("login");
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
          if (isGuestNow) setOpen(true);
        }
      } catch {
        /* ignorera */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!guest) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t("haveAccount")} ${t("signIn")}`}
        className="-mr-1 flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-1.5 text-[12px] font-semibold text-neutral-200 transition hover:text-white active:scale-95"
      >
        {t("signIn")}
      </button>
      {open ? <LoginSheet open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
