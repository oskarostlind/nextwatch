"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";

const POLL_MS = 4000;

/** iPhone/iPad (app eller Safari): Apple Mail är standard — message:// öppnar den. */
function isAppleMobile(): boolean {
  try {
    if (Capacitor.getPlatform() === "ios") return true;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

export default function VerifySentClient() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [apple, setApple] = useState(false);
  const [resend, setResend] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => setApple(isAppleMobile()), []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { emailVerified?: boolean };
      if (data.emailVerified) {
        setVerified(true);
        router.replace("/swipe");
      }
    } catch {
      // tyst – försök igen vid nästa poll
    }
  }, [router]);

  useEffect(() => {
    void checkStatus();

    const interval = window.setInterval(() => void checkStatus(), POLL_MS);
    const onForeground = () => void checkStatus();
    window.addEventListener("nw-app-foreground", onForeground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("nw-app-foreground", onForeground);
    };
  }, [checkStatus]);

  async function resendEmail() {
    setResend("sending");
    try {
      const res = await fetch("/api/auth/request-verify", { method: "POST", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      setResend(res.ok && j?.ok !== false ? "sent" : "failed");
    } catch {
      setResend("failed");
    }
  }

  if (verified) {
    return <p className="text-emerald-400">{t("emailVerified")}</p>;
  }

  return (
    <>
      <p className="text-white/70">{t("verifySentBody")}</p>
      <p className="mt-3 text-sm text-white/50">{t("verifyLater")}</p>
      {isNative ? <p className="mt-2 text-sm text-white/50">{t("nativeHint")}</p> : null}

      <div className="mt-6 grid gap-3">
        <Link
          href="/swipe"
          className="rounded-xl bg-cyan-500 px-4 py-3 text-center font-semibold text-black transition hover:bg-cyan-400"
        >
          {t("continueSwipingWhileWaiting")}
        </Link>
        <div className="grid grid-cols-2 gap-3">
          {apple ? (
            <a href="message://" className="rounded-xl bg-white/15 px-4 py-2.5 text-center text-sm hover:bg-white/25">
              {t("openMail")}
            </a>
          ) : null}
          <a
            href="https://mail.google.com"
            className={`rounded-xl bg-white/10 px-4 py-2.5 text-center text-sm hover:bg-white/20 ${apple ? "" : "col-span-2"}`}
          >
            {t("openGmail")}
          </a>
        </div>
        <button
          type="button"
          onClick={() => void resendEmail()}
          disabled={resend === "sending" || resend === "sent"}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-center text-sm hover:bg-white/10 disabled:opacity-60"
        >
          {resend === "sent" ? t("resendSent") : t("resendEmail")}
        </button>
        {resend === "failed" ? <p className="text-sm text-rose-300">{t("resendFailed")}</p> : null}
      </div>
      <p className="mt-4 text-sm text-white/50">{t("noMailHint")}</p>
    </>
  );
}
