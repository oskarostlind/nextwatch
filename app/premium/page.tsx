"use client";

import { useState } from "react";
import { Button, Card, Note, PageHeader } from "@/app/components/ui/kit";

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
    <div className="mx-auto max-w-lg px-4 py-8">
      <PageHeader
        eyebrow="Uppgradera"
        title="Premium (lifetime)"
        subtitle="Ett engångsköp – inga prenumerationer."
      />
      <Card className="space-y-4">
        <p className="text-sm text-neutral-300">
          Lås upp större grupper och ta bort annonser. Betala en gång, gäller för alltid.
        </p>
        <ul className="space-y-2 text-sm text-neutral-200">
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Större grupper</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Inga annonser</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Stötta utvecklingen</li>
        </ul>
        <Button onClick={buy} disabled={loading} className="w-full">
          {loading ? "Startar Stripe…" : "Köp lifetime"}
        </Button>
        {err && <Note tone="error">{err}</Note>}
      </Card>
    </div>
  );
}
