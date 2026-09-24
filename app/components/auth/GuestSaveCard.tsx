"use client";

// Kort överst i profilen för gäster: "Spara din profil". Infriar löftet i
// onboardingen ("Du kan skapa konto senare under Profil") och är den permanenta
// vägen till konto — de triggade prompterna (SignupNudge) visas bara en gång.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { isGuest } from "@/lib/accountStatus";

export default function GuestSaveCard() {
  const t = useTranslations("guestConvert");
  const [guest, setGuest] = useState(false);

  useEffect(() => {
    let alive = true;
    void isGuest().then((g) => {
      if (alive) setGuest(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!guest) return null;

  return (
    <div
      data-testid="guest-save-card"
      className="mb-6 rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/15 to-cyan-500/5 p-5"
    >
      <p className="text-xs font-medium uppercase tracking-widest text-cyan-300/90">{t("card.eyebrow")}</p>
      <h2 className="mt-1 text-lg font-bold text-white">{t("card.title")}</h2>
      <p className="mt-1 text-sm text-neutral-300">{t("card.body")}</p>
      <Link
        href="/auth/register?from=profile"
        className="mt-4 flex w-full items-center justify-center rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400 active:scale-[0.98]"
      >
        {t("createAccount")}
      </Link>
      <p className="mt-2 text-center text-xs text-neutral-400">{t("card.retention")}</p>
    </div>
  );
}
