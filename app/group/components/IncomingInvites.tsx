'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGroupInvites } from '@/lib/useGroupInvites';

export default function IncomingInvites() {
  const router = useRouter();
  const { data } = useGroupInvites(5000);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data || !data.incoming?.length) return null;

  return (
    <div className="mb-4 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
      <h3 className="text-sm font-medium text-white/70">Inkommande gruppinbjudan</h3>

      {data.incoming.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-xl bg-zinc-800 px-3 py-2"
        >
          <div>
            <div className="text-zinc-100">
              {inv.from.displayName ?? inv.from.username ?? inv.from.id}
            </div>
            <div className="text-xs text-zinc-400">
              invited you to <span className="font-mono">{inv.groupCode}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-full bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={busy === inv.id}
              onClick={async () => {
                setBusy(inv.id);
                const res = await fetch('/api/group/invite/respond', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: inv.id, action: 'accept' }),
                });
                setBusy(null);
                if (res.ok) router.refresh();
              }}
            >
              Accept
            </button>

            <button
              className="rounded-full bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={busy === inv.id}
              onClick={async () => {
                setBusy(inv.id);
                await fetch('/api/group/invite/respond', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: inv.id, action: 'decline' }),
                });
                setBusy(null);
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
