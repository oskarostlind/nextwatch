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
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "monthly" }),
      });
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
        title="Premium"
        subtitle="19 kr/mån – avsluta när du vill."
      />
      <Card className="space-y-4">
        <p className="text-sm text-neutral-300">
          Ta bort annonser och lås upp större grupper. 19 kr/mån, inga bindningstider.
        </p>
        <ul className="space-y-2 text-sm text-neutral-200">
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Helt annonsfritt</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Större grupper</li>
          <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Stötta utvecklingen</li>
        </ul>
        <Button onClick={buy} disabled={loading} className="w-full">
          {loading ? "Startar Stripe…" : "Bli Premium – 19 kr/mån"}
        </Button>
        {err && <Note tone="error">{err}</Note>}
      </Card>
    </div>
  );
}
