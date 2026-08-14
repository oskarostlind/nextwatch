// app/auth/forgot/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? t("genericError"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("networkRetry"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/60 p-6 shadow-xl backdrop-blur">
        <h1 className="mb-1 text-xl font-semibold">{t("forgotTitle")}</h1>
        <p className="mb-4 text-sm text-neutral-400">
          {t("forgotBody")}
        </p>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {t.rich("resetSent", {
                email: () => <span className="font-medium">{email}</span>,
              })}
            </div>
            <Link href="/" className="block text-center text-sm text-neutral-400 underline">
              {t("backToSignIn")}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">{t("email")}</label>
              <input
                type="email"
                className="w-full rounded-lg border border-white/10 bg-neutral-800/80 p-2 outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-cyan-500 py-2 font-medium text-black hover:bg-cyan-400 disabled:opacity-60"
            >
              {loading ? t("sending") : t("sendResetLink")}
            </button>

            <Link href="/" className="block text-center text-sm text-neutral-400 underline">
              {t("backToSignIn")}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
