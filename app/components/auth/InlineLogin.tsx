// app/components/auth/InlineLogin.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function InlineLogin() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      // TODO: din faktiska login endpoint här
      // const res = await fetch("/api/auth/login", { ... })
      // if (!res.ok) throw new Error("Fel e-post eller lösenord.");
      // router.replace("/swipe");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ett fel uppstod.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-black/40 p-6 shadow-xl">
      <h2 className="mb-4 text-center text-2xl font-semibold">{t("signIn")}</h2>
      {err && (
        <div className="mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {err}
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="text-sm text-white/70">{t("email")}</label>
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/50 p-3 outline-none focus:ring-2 focus:ring-white/20"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="du@exempel.se"
            required
          />
        </div>
        <div>
          <label className="text-sm text-white/70">{t("password")}</label>
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/50 p-3 outline-none focus:ring-2 focus:ring-white/20"
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-cyan-500 py-3 font-medium text-black hover:bg-cyan-400 disabled:opacity-50"
        >
          {loading ? t("signingIn") : t("signIn")}
        </button>
      </form>

      {/* Endast EN länk nedan */}
      <div className="mt-6 text-center text-sm text-white/70">
        {t.rich("newUser", {
          link: (chunks) => (
            <Link href="/onboarding" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </div>
    </div>
  );
}
