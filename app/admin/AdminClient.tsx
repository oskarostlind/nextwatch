"use client";

// Admin-dashboard: nyckeltal + intäkter + sökbar användarlista med åtgärder.
// Servern har redan gate:at (app/admin/page.tsx), och varje API-anrop gate:ar
// igen — klienten antar bara att den får svar.

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Button } from "@/app/components/ui/kit";
import Avatar from "@/app/components/ui/Avatar";

type Stats = {
  totalUsers: number;
  new7d: number;
  new30d: number;
  active7d: number;
  verified: number;
  premium: number;
  lifetime: number;
  stripeRevenueSEK: number;
  stripePurchases: number;
  applePurchases: number;
  ratingsTotal: number;
  groupsActive: number;
};

type PurchaseRow = {
  amountSEK: number;
  currency: string;
  product: string;
  createdAt: string;
  email: string | null;
};

type AdminUser = {
  id: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  avatarId: string | null;
  plan: string;
  verified: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  ratings: number;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("sv-SE");
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {hint && <div className="text-xs text-white/40">{hint}</div>}
    </div>
  );
}

export default function AdminClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setStats(j.stats as Stats);
          setPurchases(j.latestPurchases as PurchaseRow[]);
        }
      })
      .catch(() => {});
  }, []);

  const loadUsers = useCallback((query: string, pageNum: number) => {
    const usp = new URLSearchParams();
    if (query) usp.set("q", query);
    usp.set("page", String(pageNum));
    void fetch(`/api/admin/users?${usp.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setUsers(j.users as AdminUser[]);
          setTotal(j.total as number);
          setPage(j.page as number);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadUsers(q, 1), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, loadUsers]);

  async function action(userId: string, body: Record<string, string>) {
    setBusyId(userId);
    setNote(null);
    try {
      const res = await fetch("/api/admin/users/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ userId, ...body }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string };
      setNote(j.message ?? (j.ok ? "Klart." : "Misslyckades."));
      loadUsers(q, page);
    } catch {
      setNote("Nätverksfel.");
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-6">
      <PageHeader eyebrow="Endast du ser detta" title="Admin" subtitle="Nyckeltal, intäkter och användare." />

      {/* Nyckeltal */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Användare" value={stats?.totalUsers ?? "…"} hint={stats ? `+${stats.new7d} senaste 7d, +${stats.new30d} 30d` : undefined} />
        <StatCard label="Aktiva (7d)" value={stats?.active7d ?? "…"} hint={stats ? `${stats.verified} verifierade` : undefined} />
        <StatCard label="Premium" value={stats?.premium ?? "…"} hint={stats ? `${stats.lifetime} lifetime` : undefined} />
        <StatCard
          label="Intäkter (Stripe)"
          value={stats ? `${stats.stripeRevenueSEK.toLocaleString("sv-SE")} kr` : "…"}
          hint={stats ? `${stats.stripePurchases} köp · ${stats.applePurchases} Apple-köp (belopp i App Store Connect)` : undefined}
        />
        <StatCard label="Betyg totalt" value={stats?.ratingsTotal ?? "…"} />
        <StatCard label="Aktiva grupper" value={stats?.groupsActive ?? "…"} hint="gallras efter 24–48h inaktivitet" />
      </section>

      {/* Senaste köp */}
      {purchases.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-white/70">Senaste köp</h3>
          <div className="grid gap-1.5">
            {purchases.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm">
                <span className="truncate text-white/70">{p.email ?? "okänd"} · {p.product}</span>
                <span className="shrink-0 font-medium text-emerald-300">
                  {p.amountSEK.toLocaleString("sv-SE")} {p.currency.toUpperCase()} · {fmtDate(p.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Användare */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white/70">Användare ({total})</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök e-post, användarnamn, namn…"
            className="w-64 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40"
          />
        </div>

        {note && <p className="mb-3 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-200">{note}</p>}

        <div className="grid gap-2">
          {users.map((u) => (
            <div key={u.id} className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar avatarId={u.avatarId} name={u.displayName ?? u.username ?? u.email} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white/90">
                      {u.displayName ?? u.username ?? "—"}
                      {u.username && <span className="ml-1 text-white/40">@{u.username}</span>}
                    </div>
                    <div className="truncate text-xs text-white/45">
                      {u.email ?? "ingen e-post"} · {u.verified ? "verifierad" : "overifierad"} · {u.ratings} betyg
                      · reg {fmtDate(u.createdAt)} · aktiv {fmtDate(u.lastActiveAt)}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <select
                    value={u.plan}
                    disabled={busyId === u.id}
                    onChange={(e) => void action(u.id, { action: "setPlan", plan: e.target.value })}
                    className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white/80"
                  >
                    <option value="free">free</option>
                    <option value="premium">premium</option>
                    <option value="lifetime">lifetime</option>
                  </select>
                  {!u.verified && u.email && (
                    <Button
                      variant="secondary"
                      disabled={busyId === u.id}
                      onClick={() => void action(u.id, { action: "resendVerify" })}
                    >
                      Skicka verifiering
                    </Button>
                  )}
                  {confirmDelete === u.id ? (
                    <>
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => void action(u.id, { action: "delete" })}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                      >
                        Bekräfta radering
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70"
                      >
                        Avbryt
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => setConfirmDelete(u.id)}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"
                    >
                      Radera
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm text-white/60">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => loadUsers(q, page - 1)}
              className="rounded-lg border border-white/15 px-3 py-1.5 disabled:opacity-40"
            >
              Föregående
            </button>
            <span>
              Sida {page} av {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => loadUsers(q, page + 1)}
              className="rounded-lg border border-white/15 px-3 py-1.5 disabled:opacity-40"
            >
              Nästa
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
