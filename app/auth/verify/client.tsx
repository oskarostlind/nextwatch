"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { APP_VERIFY_RETURN_URL, isLikelyMobileBrowser } from "@/lib/nativeApp";

export default function Client() {
  const t = useTranslations("auth");
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token");
  const fromApp = sp.get("from") === "app";

  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [msg, setMsg] = useState<string>(() => t("verifying"));

  useEffect(() => {
    async function run() {
      if (!token) {
        setState("err");
        setMsg(t("missingToken"));
        return;
      }
      try {
        const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`);
        const data: { ok?: boolean; message?: string } = await res.json();
        if (!res.ok || !data?.ok) {
          setState("err");
          setMsg(data?.message || t("genericErrorShort"));
          return;
        }
        setState("ok");
        setMsg(t("emailVerifiedWelcome"));

        // Webbanvändare utan app-kontext: behåll automatisk redirect.
        if (!fromApp && !isLikelyMobileBrowser()) {
          setTimeout(() => router.replace("/swipe"), 1000);
        }
      } catch (e) {
        setState("err");
        setMsg(e instanceof Error ? e.message : t("genericErrorShort"));
      }
    }
    void run();
  }, [token, router, fromApp]);

  if (state === "loading") return <p className="text-white/70">{msg}</p>;

  if (state === "ok") {
    const showAppReturn = fromApp || isLikelyMobileBrowser();

    return (
      <div className="space-y-4">
        <p className="text-emerald-400">{msg}</p>
        {showAppReturn ? (
          <>
            <a
              href={APP_VERIFY_RETURN_URL}
              className="block w-full rounded-xl bg-cyan-500 py-3 text-center font-medium text-black hover:bg-cyan-400"
            >
              Ta mig tillbaka till appen
            </a>
            <Link href="/swipe" className="block text-center text-sm text-white/60 underline hover:text-white/80">
              Fortsätt i webbläsaren
            </Link>
          </>
        ) : (
          <p className="text-sm text-white/60">{t("redirecting")}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-rose-400">{msg}</p>
      <Link href="/" className="underline">
        Till startsidan
      </Link>
    </div>
  );
}
