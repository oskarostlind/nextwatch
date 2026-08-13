"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGroupInvites } from "@/lib/useGroupInvites";
import { notify } from "@/app/components/lib/notify";

export default function IncomingInvites() {
  const router = useRouter();
  const { data, refresh } = useGroupInvites();
  const [busy, setBusy] = useState<string | null>(null);

  if (!data || !data.incoming?.length) return null;

  return (
    <div className="mb-5 space-y-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <h3 className="text-sm font-medium text-cyan-300">Gruppinbjudningar</h3>

      {data.incoming.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">
              {inv.from.displayName ?? inv.from.username ?? "Någon"}
            </div>
            <div className="text-xs text-white/50">
              Bjuder in till <span className="font-mono text-white/70">{inv.groupCode}</span>
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              disabled={busy === inv.id}
              onClick={async () => {
                setBusy(inv.id);
                const res = await fetch("/api/group/invite/respond", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id: inv.id, action: "accept" }),
                });
                setBusy(null);
                void refresh();
                if (res.ok) {
                  router.refresh();
                  return;
                }
                // Servern kan neka av en begriplig anledning (gruppen full —
                // se lib/groupLimits). Utan det här hände ingenting synligt
                // när man tryckte Acceptera.
                const body = (await res.json().catch(() => null)) as
                  | { message?: string }
                  | null;
                notify(body?.message ?? "Kunde inte gå med i gruppen.");
              }}
            >
              Acceptera
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 disabled:opacity-50"
              disabled={busy === inv.id}
              onClick={async () => {
                setBusy(inv.id);
                await fetch("/api/group/invite/respond", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id: inv.id, action: "decline" }),
                });
                setBusy(null);
                void refresh();
              }}
            >
              Avvisa
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
