"use client";

// "Har du konto? Logga in" — diskret länk högst upp i leken för gäster.
// Sedan kallstarten (docs/nya-flodet.md) visar appen aldrig startsidan, så den
// här länken är vägen in för den som redan har ett konto (t.ex. efter en
// ominstallation eller utloggning). Inloggning byter nw_uid, och då avslutar
// leken första sessionen (syncFsOwner i ./fsDeck.ts).

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
      if (!cancelled) setGuest(Boolean(s && s.hasProfile && !s.hasAccount));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!guest) return null;

  return (
    <>
      <div className="flex shrink-0 justify-center px-4 pt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full px-3 py-1 text-[12.5px] text-neutral-400 transition hover:text-neutral-200"
        >
          {t("haveAccount")} <span className="font-semibold text-neutral-100">{t("signIn")}</span>
        </button>
      </div>
      {open ? <LoginSheet open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
