// app/auth/signup/page.tsx
"use client";

import { useState } from "react";

export default function SignupVerifyPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Något gick fel.");
      }
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold text-neutral-100 mb-2">Aktivera ditt konto</h1>
      <p className="text-neutral-400 mb-6">
        Ange din e-post så skickar vi en verifieringslänk. Öppna länken på samma enhet för
        att aktivera kontot.
      </p>

      <form onSubmit={sendLink} className="space-y-4">
        <label className="block">
          <span className="block text-sm text-neutral-300 mb-1">E-postadress</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="namn@exempel.se"
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-neutral-100 outline-none focus:ring-2 focus:ring-neutral-500"
          />
        </label>

        {err && (
          <div className="rounded-lg border border-red-700 bg-red-950/40 text-red-300 px-3 py-2">
            {err}
          </div>
        )}

        {sent ? (
          <div className="rounded-lg border border-emerald-700 bg-emerald-900/30 text-emerald-300 px-3 py-2">
            Klart! Kolla din inbox. Klicka på länken i mejlet för att aktivera.
          </div>
        ) : (
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-neutral-100 text-neutral-900 font-medium py-2.5 disabled:opacity-60"
          >
            {loading ? "Skickar…" : "Skicka verifieringslänk"}
          </button>
        )}
      </form>

      <div className="mt-8 flex gap-3">
        <a
          href="/swipe"
          className="rounded-lg border border-neutral-700 px-3 py-2 text-neutral-300 hover:bg-neutral-800"
        >
          Till rekommendationer
        </a>
        <a
          href="/onboarding"
          className="rounded-lg border border-neutral-700 px-3 py-2 text-neutral-300 hover:bg-neutral-800"
        >
          Tillbaka till onboarding
        </a>
      </div>
    </main>
  );
}
