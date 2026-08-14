"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";

const POLL_MS = 4000;

export default function VerifySentClient() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const isNative = Capacitor.isNativePlatform();

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

  if (verified) {
    return <p className="text-emerald-400">{t("emailVerified")}</p>;
  }

  return (
    <>
      <p className="text-white/70">
        {t("verifySentBody")}
      </p>
      {isNative ? (
        <p className="mt-3 text-sm text-white/50">
          {t("nativeHint")}
        </p>
      ) : null}
    </>
  );
}
