// app/auth/register/page_client.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import AppleSignInButton from "@/app/components/auth/AppleSignInButton";
import { useTranslations } from "next-intl";

export default function RegisterClient() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Guideline 1.2: villkoren måste godkännas innan konto skapas — gäller både
  // Apple-knappen och e-postformuläret.
  const [terms, setTerms] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/session/init", { cache: "no-store" }).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: pwd,
        termsAccepted: terms,
        from: Capacitor.isNativePlatform() ? "app" : undefined,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data?.ok) {
      setErr(data?.message || "Ett fel uppstod.");
      return;
    }
    setOkMsg(data.message || t("verifyLinkSent"));
    router.replace("/auth/verify/sent");
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-400">
        {t("registerBody")}
      </p>

      {err && <div className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">{err}</div>}
      {okMsg && <div className="rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{okMsg}</div>}

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400"
        />
        <span>
          {t.rich("termsAccept", {
            terms: (chunks) => (
              <Link href="/legal/terms" className="text-cyan-300 underline underline-offset-2">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href="/legal/privacy" className="text-cyan-300 underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>

      <AppleSignInButton disabled={!terms} />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-neutral-900/80 px-2 text-neutral-500">{t("orWithEmail")}</span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-white/70">{t("email")}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-white/70">{t("password")}</label>
          <input
            type="password"
            required
            minLength={8}
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
            placeholder="Minst 8 tecken"
            autoComplete="new-password"
          />
        </div>
        <button
          type="submit"
          disabled={!terms}
          className="w-full rounded-xl bg-cyan-500 py-2.5 font-medium text-black transition hover:bg-cyan-400 disabled:opacity-50"
        >
          Skapa konto med e-post
        </button>
      </form>

      <div className="flex flex-col gap-2 border-t border-white/10 pt-4 text-center text-sm">
        <Link
          href="/swipe"
          className="rounded-xl border border-white/10 px-4 py-2.5 text-neutral-300 transition hover:bg-white/5"
        >
          {t("continueWithoutAccount")}
        </Link>
        <Link href="/" className="text-neutral-500 underline hover:text-neutral-300">
          {t("backToStart")}
        </Link>
      </div>
    </div>
  );
}
