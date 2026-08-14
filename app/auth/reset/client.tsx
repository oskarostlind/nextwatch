// app/auth/reset/client.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export default function ResetPasswordClient() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("passwordsDontMatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? t("genericError"));
        return;
      }
      setDone(true);
      // Användaren är inloggad via cookies – skicka vidare till appen
      setTimeout(() => {
        window.location.href = "/swipe";
      }, 1500);
    } catch {
      setError(t("networkRetry"));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t("invalidLink")}</h1>
        <p className="text-sm text-neutral-400">
          {t("invalidLinkBody")}
        </p>
        <Link href="/auth/forgot" className="block text-center text-sm underline">
          {t("requestNewLink")}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t("passwordUpdated")}</h1>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Du loggas in och skickas vidare…
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{t("chooseNewPassword")}</h1>
      <p className="mb-4 text-sm text-neutral-400">Minst 8 tecken.</p>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-sm text-neutral-300">{t("newPassword")}</label>
          <input
            type="password"
            className="w-full rounded-lg border border-white/10 bg-neutral-800/80 p-2 outline-none focus:ring-2 focus:ring-cyan-500/50"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-neutral-300">{t("repeatPassword")}</label>
          <input
            type="password"
            className="w-full rounded-lg border border-white/10 bg-neutral-800/80 p-2 outline-none focus:ring-2 focus:ring-cyan-500/50"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-cyan-500 py-2 font-medium text-black hover:bg-cyan-400 disabled:opacity-60"
        >
          {loading ? t("saving") : t("saveNewPassword")}
        </button>
      </form>
    </>
  );
}
