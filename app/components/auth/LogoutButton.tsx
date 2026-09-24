// app/components/auth/LogoutButton.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";
import { clearClientCache } from "@/lib/clientCache";
import { invalidateAccountStatus, isGuest } from "@/lib/accountStatus";
import Modal from "@/app/components/ui/Modal";
import { Button } from "@/app/components/ui/kit";

type Props = { className?: string };

export default function LogoutButton({ className }: Props) {
  const r = useRouter();
  const t = useTranslations("guestConvert");
  const [busy, setBusy] = useState(false);
  // Gäster har inget sätt att logga in igen — utloggning = all data borta.
  // De får därför en varning med "skapa konto först" innan något händer.
  const [confirmGuest, setConfirmGuest] = useState(false);

  async function onClick() {
    if (busy) return;
    if (await isGuest()) {
      setConfirmGuest(true);
      return;
    }
    await logout();
  }

  async function logout() {
    if (busy) return;
    setConfirmGuest(false);
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Native: släng den speglade sessionstoken, annars återställer
      // SessionPersistence sessionen vid nästa mount och utloggningen "studsar
      // tillbaka".
      if (Capacitor.isNativePlatform()) {
        try {
          const { Preferences } = await import("@capacitor/preferences");
          await Preferences.remove({ key: "nw_session_token" });
        } catch {
          /* best-effort */
        }
      }
    } finally {
      // Kortlek och listor är cachade lokalt — nästa person på samma enhet ska
      // inte se föregående användares watchlist.
      clearClientCache();
      invalidateAccountStatus();
      r.push("/");
      r.refresh();
      setBusy(false);
    }
  }

  return (
    <>
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        "rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 transition",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        className ?? "",
      ].join(" ").trim()}
    >
      {busy ? t("logout.busy") : t("logout.button")}
    </button>
    {confirmGuest && (
      <Modal open onClose={() => setConfirmGuest(false)} labelledBy="guest-logout-title">
        <div className="mx-auto max-w-sm px-1 pb-1 pt-6 text-center" data-testid="guest-logout-warning">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-2xl">
            ⚠️
          </div>
          <h2 id="guest-logout-title" className="text-lg font-bold text-white">
            {t("logout.title")}
          </h2>
          <p className="mt-2 text-sm text-neutral-300">{t("logout.body")}</p>
          <div className="mt-6 grid gap-2">
            <Button
              onClick={() => {
                setConfirmGuest(false);
                r.push("/auth/register?from=logout");
              }}
            >
              {t("logout.createFirst")}
            </Button>
            <Button variant="danger" onClick={() => void logout()}>
              {t("logout.anyway")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmGuest(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}
