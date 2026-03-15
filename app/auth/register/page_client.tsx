// app/auth/register/page_client.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RegisterClient() {
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const router = useRouter();

  // Säkerställ att användarrad finns i DB innan registrering (middleware sätter bara cookie)
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
      body: JSON.stringify({ email, password: pwd }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data?.ok) {
      setErr(data?.message || "Ett fel uppstod.");
      return;
    }
    setOkMsg(data.message || "Verifieringslänk skickad.");
    router.replace("/auth/verify/sent");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {err && <div className="rounded bg-red-500/15 px-3 py-2 text-red-300">{err}</div>}
      {okMsg && <div className="rounded bg-emerald-500/15 px-3 py-2 text-emerald-300">{okMsg}</div>}
      <div>
        <label className="mb-1 block text-sm text-white/70">E-post</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-white/70">Lösenord</label>
        <input
          type="password"
          required
          minLength={8}
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-black/40 p-3 outline-none focus:ring-2 focus:ring-white/20"
          placeholder="Minst 8 tecken"
        />
      </div>
      <button
        type="submit"
        className="rounded-xl bg-white/15 px-4 py-2 font-medium hover:bg-white/25"
      >
        Skapa konto
      </button>
    </form>
  );
}
