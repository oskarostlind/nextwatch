"use client";

// "Just nu" överst i /admin — vem är inne nu, och hur många av dagens aktiva
// är återkommande. Pollas var 15:e sekund av AdminClient (/api/admin/live).

import Avatar from "@/app/components/ui/Avatar";
import { acquisitionLabel } from "@/lib/acquisition";

export type LiveUser = {
  id: string;
  name: string | null;
  avatarId: string | null;
  plan: string;
  createdAt: string;
  lastActiveAt: string | null;
  source: string | null;
};

export type LiveData = {
  at: string;
  onlineMinutes: number;
  trackingEnabled: boolean;
  onlineNow: number;
  online: LiveUser[];
  today: { active: number; returning: number; newActive: number; newUsers: number };
  returning: LiveUser[];
};

function daysSince(iso: string): number {
  const start = new Date(iso);
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const now = new Date();
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}

function since(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "nyss";
  if (s < 3600) return `${Math.round(s / 60)} min sedan`;
  return `${Math.round(s / 3600)} h sedan`;
}

function Tile({ label, value, sub, live }: { label: string; value: number | string; sub?: string; live?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="flex items-center gap-1.5 truncate text-[11px] uppercase tracking-wide text-white/40">
        {live && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
        )}
        {label}
      </div>
      <div className="mt-0.5 truncate text-2xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{sub}</div>}
    </div>
  );
}

function Row({ u, right, onOpen }: { u: LiveUser; right: string; onOpen: (id: string) => void }) {
  const d = daysSince(u.createdAt);
  return (
    <button
      type="button"
      onClick={() => onOpen(u.id)}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06]"
    >
      <Avatar avatarId={u.avatarId} name={u.name ?? "Gäst"} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-white/90">{u.name ?? "Gäst"}</div>
        <div className="truncate text-[11px] text-white/40">
          {d === 0 ? "ny idag" : `dag ${d} sedan start`} · {acquisitionLabel(u.source)}
        </div>
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-white/40">{right}</span>
    </button>
  );
}

export default function LivePanel({ data, onOpenUser }: { data: LiveData | null; onOpenUser: (id: string) => void }) {
  const t = data?.today;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          live
          label="Online nu"
          value={data?.onlineNow ?? "…"}
          sub={data ? `appen öppen senaste ${data.onlineMinutes} min` : undefined}
        />
        <Tile label="Aktiva idag" value={t?.active ?? "…"} sub={t ? `${t.newActive} nya · ${t.returning} återkommande` : undefined} />
        <Tile
          label="Återkommande idag"
          value={t?.returning ?? "…"}
          sub={t && t.active > 0 ? `${Math.round((t.returning / t.active) * 100)} % av dagens aktiva` : "startade en tidigare dag"}
        />
        <Tile label="Nya idag" value={t?.newUsers ?? "…"} sub={t ? `${t.newActive} av dem har gjort något` : undefined} />
      </div>

      {data && (data.online.length > 0 || data.returning.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {data.online.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              <h3 className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Inne just nu
              </h3>
              <div className="max-h-72 divide-y divide-white/5 overflow-y-auto">
                {data.online.map((u) => (
                  <Row key={u.id} u={u} right={since(u.lastActiveAt)} onOpen={onOpenUser} />
                ))}
              </div>
            </div>
          )}
          {data.returning.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              <h3 className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Kom tillbaka idag
              </h3>
              <div className="max-h-72 divide-y divide-white/5 overflow-y-auto">
                {data.returning.map((u) => (
                  <Row key={u.id} u={u} right={since(u.lastActiveAt)} onOpen={onOpenUser} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
