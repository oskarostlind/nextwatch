"use client";

// Admin-dashboard. Servern har redan gate:at (app/admin/page.tsx), och varje
// API-anrop gate:ar igen — klienten antar bara att den får svar.
//
// Omgjord 2026-09-26, mobile-first (Oskar kollar ofta från telefonen):
//   - Två flikar: Översikt (nyckeltal + dag-för-dag-grafer + intäkter) och
//     Användare (sök/sortera, tryck på en rad för hela profilen).
//   - Graferna läser /api/admin/timeseries — en serie per graf, periodväljare
//     7/30/90/365 dagar.
//   - Användarprofilen (UserSheet) öppnas som helskärmsark på mobil och
//     sidopanel på desktop, med "Lägg till som vän" och adminåtgärderna.

import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "@/app/components/ui/Avatar";
import { DailyChart, type Point } from "./charts";
import UserSheet from "./UserSheet";

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
  mrrEstimateSEK: number;
  premiumPriceSEK: number;
};

type AdmobEarnings = { today: number; last7d: number; last30d: number; currency: string; fetchedAt: string };

type PurchaseRow = { amountSEK: number; currency: string; product: string; createdAt: string; email: string | null };

type SeriesRow = {
  day: string;
  signups: number;
  active: number;
  swipes: number;
  watchlist: number;
  purchases: number;
  groups: number;
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

type Tab = "overview" | "users";
type Sort = "newest" | "active" | "ratings";

const RANGES = [7, 30, 90, 365] as const;

function fmtKr(n: number): string {
  return `${n.toLocaleString("sv-SE", { maximumFractionDigits: n < 100 ? 2 : 0 })} kr`;
}

function ago(iso: string | null): string {
  if (!iso) return "aldrig";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "nyss";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d < 60 ? `${d} d` : new Date(iso).toLocaleDateString("sv-SE");
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "money" | "up";
}) {
  const color = tone === "money" ? "text-emerald-300" : "text-white";
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="truncate text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 truncate text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-base font-bold text-white">{children}</h2>
      {sub && <p className="text-xs text-white/40">{sub}</p>}
    </div>
  );
}

export default function AdminClient() {
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);

  const [stats, setStats] = useState<Stats | null>(null);
  const [admob, setAdmob] = useState<AdmobEarnings | null>(null);
  const [admobConfigured, setAdmobConfigured] = useState(true);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);

  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [usersBefore, setUsersBefore] = useState(0);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [usersLoading, setUsersLoading] = useState(true);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    void fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setStats(j.stats as Stats);
          setPurchases(j.latestPurchases as PurchaseRow[]);
          setAdmob((j.admob as AdmobEarnings | null) ?? null);
          setAdmobConfigured(Boolean(j.admobConfigured));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(loadOverview, [loadOverview]);

  useEffect(() => {
    setSeries(null);
    void fetch(`/api/admin/timeseries?days=${range}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setSeries(j.series as SeriesRow[]);
          setUsersBefore(j.usersBefore as number);
        }
      })
      .catch(() => {});
  }, [range]);

  const loadUsers = useCallback((query: string, pageNum: number, s: Sort) => {
    const usp = new URLSearchParams();
    if (query) usp.set("q", query);
    usp.set("page", String(pageNum));
    usp.set("sort", s);
    setUsersLoading(true);
    void fetch(`/api/admin/users?${usp.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setUsers(j.users as AdminUser[]);
          setTotal(j.total as number);
          setPage(j.page as number);
        }
      })
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadUsers(q, 1, sort), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, sort, loadUsers]);

  const pick = useCallback(
    (key: keyof Omit<SeriesRow, "day">): Point[] => (series ?? []).map((r) => ({ day: r.day, value: r[key] })),
    [series],
  );

  const cumulative = useMemo<Point[]>(() => {
    let acc = usersBefore;
    return (series ?? []).map((r) => {
      acc += r.signups;
      return { day: r.day, value: acc };
    });
  }, [series, usersBefore]);

  const today = series?.[series.length - 1];
  const yesterday = series?.[series.length - 2];
  const pages = Math.max(1, Math.ceil(total / 25));
  const closeSheet = useCallback(() => setOpenUser(null), []);
  const refreshAfterAction = useCallback(() => {
    loadUsers(q, page, sort);
    loadOverview();
  }, [loadUsers, loadOverview, q, page, sort]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto">
      {/* ══ Sticky topp: titel + flikar ══ */}
      <div
        className="sticky top-0 z-20 border-b border-white/10 bg-neutral-950/90 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-cyan-400/80">Endast du ser detta</p>
            <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1">
          {(
            [
              ["overview", "Översikt"],
              ["users", `Användare${stats ? ` · ${stats.totalUsers}` : ""}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                tab === k ? "bg-white text-neutral-950" : "text-white/60 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-[max(env(safe-area-inset-bottom),96px)] pt-5">
        {tab === "overview" && (
          <>
            {/* ══ Idag ══ */}
            <SectionTitle sub="Svensk kalenderdag. Aktiva = unika användare som swipat.">Idag</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi
                label="Nya användare"
                value={today?.signups ?? "…"}
                sub={yesterday ? `igår ${yesterday.signups}` : undefined}
              />
              <Kpi label="Aktiva" value={today?.active ?? "…"} sub={yesterday ? `igår ${yesterday.active}` : undefined} />
              <Kpi label="Swipes" value={today?.swipes ?? "…"} sub={yesterday ? `igår ${yesterday.swipes}` : undefined} />
              <Kpi
                label="MRR (uppskattad)"
                value={stats ? fmtKr(stats.mrrEstimateSEK) : "…"}
                sub={stats ? `${stats.premium} premium × ${stats.premiumPriceSEK} kr` : undefined}
                tone="money"
              />
            </div>

            {/* ══ Trender ══ */}
            <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white">Dag för dag</h2>
                <p className="text-xs text-white/40">Tryck/hovra på en stapel för dagens siffra.</p>
              </div>
              <div className="flex rounded-lg bg-white/[0.06] p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                      range === r ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
                    }`}
                  >
                    {r === 365 ? "1 år" : `${r} d`}
                  </button>
                ))}
              </div>
            </div>

            {!series ? (
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[228px] animate-pulse rounded-2xl bg-white/[0.04]" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <DailyChart title="Nya användare" hint="Registrerade konton per dag." data={pick("signups")} color="#22d3ee" />
                <DailyChart
                  title="Användare totalt"
                  hint="Kumulativt antal konton (raderade konton räknas inte)."
                  data={cumulative}
                  kind="line"
                  summary="last"
                  color="#22d3ee"
                />
                <DailyChart
                  title="Aktiva användare"
                  hint="Unika användare som swipat minst en gång den dagen."
                  data={pick("active")}
                  summary="avg"
                  color="#a78bfa"
                />
                <DailyChart title="Swipes" hint="Alla gilla/nej/sett/betyg." data={pick("swipes")} color="#a78bfa" />
                <DailyChart title="Till bevakningslistan" data={pick("watchlist")} color="#f472b6" />
                <DailyChart
                  title="Köp"
                  hint="Stripe-köp + Apple-transaktioner (inkl. förnyelser)."
                  data={pick("purchases")}
                  color="#34d399"
                />
                <DailyChart
                  title="Skapade grupper"
                  hint="Grupper gallras efter 24–48 h, så äldre dagar underskattas."
                  data={pick("groups")}
                  color="#fbbf24"
                />
              </div>
            )}

            {/* ══ Intäkter ══ */}
            <SectionTitle sub="Apples exakta utbetalningar finns i App Store Connect.">Intäkter</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi
                label="Betalande"
                value={stats ? stats.premium + stats.lifetime : "…"}
                sub={stats ? `${stats.premium} premium · ${stats.lifetime} lifetime` : undefined}
              />
              <Kpi
                label="Stripe totalt"
                value={stats ? fmtKr(stats.stripeRevenueSEK) : "…"}
                sub={stats ? `${stats.stripePurchases} köp via webben` : undefined}
                tone="money"
              />
              <Kpi label="Apple-köp" value={stats?.applePurchases ?? "…"} sub="IAP-transaktioner" />
              <Kpi
                label="AdMob idag"
                value={
                  admob
                    ? `${admob.today.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} ${admob.currency}`
                    : admobConfigured
                      ? "…"
                      : "—"
                }
                sub={
                  admob
                    ? `7 d ${admob.last7d.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} · 30 d ${admob.last30d.toLocaleString("sv-SE", { maximumFractionDigits: 0 })}`
                    : admobConfigured
                      ? "Hämtar…"
                      : "Inte uppkopplat (docs/admob-setup.md)"
                }
                tone={admob ? "money" : undefined}
              />
            </div>

            {purchases.length > 0 && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Senaste köp (Stripe)</h3>
                <div className="divide-y divide-white/5">
                  {purchases.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-white/70">{p.email ?? "okänd"}</span>
                      <span className="shrink-0 tabular-nums text-emerald-300">
                        {p.amountSEK.toLocaleString("sv-SE")} {p.currency.toUpperCase()}
                        <span className="ml-2 text-white/35">{new Date(p.createdAt).toLocaleDateString("sv-SE")}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ Totalt ══ */}
            <SectionTitle sub="Sedan start.">Totalt</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi
                label="Användare"
                value={stats?.totalUsers ?? "…"}
                sub={stats ? `+${stats.new7d} 7 d · +${stats.new30d} 30 d` : undefined}
              />
              <Kpi
                label="Aktiva 7 d"
                value={stats?.active7d ?? "…"}
                sub={
                  stats && stats.totalUsers > 0
                    ? `${Math.round((stats.active7d / stats.totalUsers) * 100)} % av alla`
                    : undefined
                }
              />
              <Kpi
                label="Verifierade"
                value={stats?.verified ?? "…"}
                sub={
                  stats && stats.totalUsers > 0
                    ? `${Math.round((stats.verified / stats.totalUsers) * 100)} % av alla`
                    : undefined
                }
              />
              <Kpi label="Swipes" value={stats?.ratingsTotal.toLocaleString("sv-SE") ?? "…"} sub={`${stats?.groupsActive ?? "…"} aktiva grupper`} />
            </div>
          </>
        )}

        {tab === "users" && (
          <>
            {/* Sök + sortering — sticky under flikarna så de går att nå medan man scrollar. */}
            <div className="space-y-2">
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Sök e-post, användarnamn, namn…"
                  inputMode="search"
                  className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-9 pr-3 text-base text-white outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-cyan-500/40 sm:text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-white/40">{total} träffar</span>
                <div className="flex rounded-lg bg-white/[0.06] p-0.5">
                  {(
                    [
                      ["newest", "Nyast"],
                      ["active", "Senast aktiv"],
                      ["ratings", "Flest swipes"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSort(k)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        sort === k ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              className={`mt-3 divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] transition-opacity ${
                usersLoading ? "opacity-60" : ""
              }`}
            >
              {users.length === 0 && !usersLoading && (
                <p className="px-4 py-8 text-center text-sm text-white/40">Inga användare matchar.</p>
              )}
              {users.map((u) => {
                const name = u.displayName ?? u.username ?? u.email ?? "Namnlös";
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setOpenUser(u.id)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/[0.04] active:bg-white/[0.06]"
                  >
                    <Avatar avatarId={u.avatarId} name={name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-white/90">{name}</span>
                        {u.plan !== "free" && (
                          <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-px text-[9px] font-bold uppercase text-emerald-300">
                            {u.plan === "premium" ? "PRO" : "LIFE"}
                          </span>
                        )}
                        {!u.verified && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Overifierad" />
                        )}
                      </div>
                      <div className="truncate text-xs text-white/40">
                        {u.username ? `@${u.username} · ` : ""}
                        {u.email ?? "ingen e-post"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] leading-tight tabular-nums text-white/45">
                      <div>{u.ratings} swipes</div>
                      <div className="text-white/30">aktiv {ago(u.lastActiveAt)}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-white/25">
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                );
              })}
            </div>

            {pages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-sm text-white/60">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => loadUsers(q, page - 1, sort)}
                  className="rounded-xl border border-white/15 px-4 py-2.5 disabled:opacity-30"
                >
                  ← Föregående
                </button>
                <span className="tabular-nums">
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => loadUsers(q, page + 1, sort)}
                  className="rounded-xl border border-white/15 px-4 py-2.5 disabled:opacity-30"
                >
                  Nästa →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {openUser && <UserSheet userId={openUser} onClose={closeSheet} onChanged={refreshAfterAction} />}
    </main>
  );
}
