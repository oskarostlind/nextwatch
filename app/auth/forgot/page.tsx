// app/auth/forgot/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
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
        setError(data.message ?? "Något gick fel. Försök igen.");
        return;
      }
      setSent(true);
    } catch {
      setError("Nätverksfel. Försök igen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/60 p-6 shadow-xl backdrop-blur">
        <h1 className="mb-1 text-xl font-semibold">Glömt lösenord?</h1>
        <p className="mb-4 text-sm text-neutral-400">
          Fyll i din e-postadress så skickar vi en länk för att välja ett nytt lösenord.
        </p>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              Om kontot finns har vi skickat en återställningslänk till{" "}
              <span className="font-medium">{email}</span>. Kolla även skräpposten.
            </div>
            <Link href="/" className="block text-center text-sm text-neutral-400 underline">
              Tillbaka till inloggningen
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm text-neutral-300">E-post</label>
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
              {loading ? "Skickar…" : "Skicka återställningslänk"}
            </button>

            <Link href="/" className="block text-center text-sm text-neutral-400 underline">
              Tillbaka till inloggningen
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
