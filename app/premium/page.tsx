"use client";

import { useState } from "react";

export default function PremiumPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  async function buy() {
    setErr("");
    setLoading(true);
    try {
      const r = await fetch("/api/stripe/checkout", { method: "POST" });
      const js: { ok: boolean; url?: string; error?: string; message?: string } =
        await r.json();
      if (js.ok && js.url) {
        window.location.href = js.url;
      } else {
        setErr(js.error ?? js.message ?? "Kunde inte starta betalning");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Premium (lifetime)</h1>
      <p>Engångsköp som låser upp större grupper och tar bort annonser.</p>
      <button onClick={buy} disabled={loading} className="border rounded-md px-4 py-2">
        {loading ? "Startar Stripe…" : "Köp lifetime"}
      </button>
      {err && <div className="text-sm text-red-500">{err}</div>}
    </div>
  );
}
