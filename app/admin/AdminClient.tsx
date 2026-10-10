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
//
// 2026-10-10: retention + realtid.
//   - "Just nu" överst (LivePanel, /api/admin/live, pollas var 15:e s):
//     online nu, aktiva/återkommande idag, vem som kom tillbaka.
//   - Ny flik Retention (RetentionPanel, /api/admin/retention): kommer nya
//     användare tillbaka? Dag 1/7/30, veckokohorter, per källa.
//   - Allt annat uppdateras tyst var 60:e s medan fliken syns.
//   - Flik Tratt (FunnelPanel, /api/admin/funnel): första besöket steg för
//     steg och var de som aldrig kom tillbaka lämnade (lib/funnel.ts).
//   - "← Appen" i toppen — /admin har ingen app-chrome (AppShell) att gå
//     tillbaka med.

import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "@/app/components/ui/Avatar";
import { DailyChart, type Point } from "./charts";
import UserSheet from "./UserSheet";
import LivePanel, { type LiveData } from "./LivePanel";
import RetentionPanel, { pct, type RetentionData } from "./RetentionPanel";
import FunnelPanel, { type FunnelData } from "./FunnelPanel";
import MailPanel, { MailComposer, type ComposeDraft } from "./MailPanel";
import { acquisitionLabel } from "@/lib/acquisition";

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
  returning: number;
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
  source: string | null;
  campaign: string | null;
  hasLogin: boolean;
};

type SourceRow = { source: string | null; visits: number; users: number; accounts: number };

type Tab = "overview" | "funnel" | "retention" | "users" | "mail";
type Sort = "newest" | "active" | "ratings";

const RANGES = [7, 30, 90, 365] as const;

const LIVE_MS = 15_000;
const REFRESH_MS = 60_000;

/** Kör fn med jämna mellanrum medan sidan syns, och direkt när den syns igen. */
function usePoll(fn: () => void, ms: number) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") fn();
    };
    const t = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fn, ms]);
}

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
  const [mailDraft, setMailDraft] = useState<ComposeDraft | null>(null);

  // Djuplänk från push ("Mejl från …") → /admin?tab=mail
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "mail" || t === "users" || t === "funnel" || t === "retention") setTab(t);
  }, []);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);

  const [stats, setStats] = useState<Stats | null>(null);
  const [admob, setAdmob] = useState<AdmobEarnings | null>(null);
  const [admobConfigured, setAdmobConfigured] = useState(true);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [sources, setSources] = useState<SourceRow[] | null>(null);

  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [usersBefore, setUsersBefore] = useState(0);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [usersLoading, setUsersLoading] = useState(true);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const [live, setLive] = useState<LiveData | null>(null);
  const [retention, setRetention] = useState<RetentionData | null>(null);
  const [retSource, setRetSource] = useState("all");
  const [retLogin, setRetLogin] = useState(false);
  const [sourceOptions, setSourceOptions] = useState<(string | null)[]>([]);
  // Ofiltrerad total till sammanfattningen i Översikt (oberoende av filtret i Retention-fliken).
  const [retAll, setRetAll] = useState<RetentionData["total"] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [funnelData, setFunnelData] = useState<FunnelData | null>(null);
  const [funnelDays, setFunnelDays] = useState(7);
  const [funnelPlatform, setFunnelPlatform] = useState<"all" | "ios" | "web">("all");

  const loadOverview = useCallback(() => {
    void fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setStats(j.stats as Stats);
          setPurchases(j.latestPurchases as PurchaseRow[]);
          setAdmob((j.admob as AdmobEarnings | null) ?? null);
          setAdmobConfigured(Boolean(j.admobConfigured));
          setSources((j.sources as SourceRow[] | undefined) ?? []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(loadOverview, [loadOverview]);

  const loadSeries = useCallback(() => {
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

  useEffect(() => {
    setSeries(null);
    loadSeries();
  }, [loadSeries]);

  const loadLive = useCallback(() => {
    void fetch("/api/admin/live", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setLive(j as LiveData);
          setUpdatedAt(new Date());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(loadLive, [loadLive]);

  const loadRetention = useCallback(() => {
    const usp = new URLSearchParams({ source: retSource });
    if (retLogin) usp.set("login", "1");
    void fetch(`/api/admin/retention?${usp.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          const d = j as RetentionData;
          setRetention(d);
          // Källchippen hämtas från den ofiltrerade vyn — filtrerad innehåller bara en källa.
          if (d.source === "all") setSourceOptions(d.sources.map((x) => x.source));
          if (d.source === "all" && !d.loginOnly) setRetAll(d.total);
        }
      })
      .catch(() => {});
  }, [retSource, retLogin]);

  useEffect(() => {
    setRetention(null);
    loadRetention();
  }, [loadRetention]);

  const loadFunnel = useCallback(() => {
    void fetch(`/api/admin/funnel?days=${funnelDays}&platform=${funnelPlatform}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) setFunnelData(j as FunnelData);
      })
      .catch(() => {});
  }, [funnelDays, funnelPlatform]);

  useEffect(() => {
    setFunnelData(null);
    loadFunnel();
  }, [loadFunnel]);

  // Realtid: "just nu" ofta, resten tyst en gång i minuten.
  usePoll(loadLive, LIVE_MS);
  const refreshAll = useCallback(() => {
    loadOverview();
    loadSeries();
    loadRetention();
    loadFunnel();
  }, [loadOverview, loadSeries, loadRetention, loadFunnel]);
  usePoll(refreshAll, REFRESH_MS);

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-widest text-cyan-400/80">Endast du ser detta</p>
            <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40">
              <span className={`h-1.5 w-1.5 rounded-full ${updatedAt ? "bg-emerald-400" : "bg-white/25"}`} />
              {updatedAt
                ? `Live · ${updatedAt.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : "Ansluter…"}
            </p>
          </div>
          {/* Vanlig <a> (inte router-Link): appen har egen chrome som /admin saknar,
              så en full navigering bygger upp den rätt. */}
          <a
            href="/swipe"
            className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.12] active:scale-[0.98]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Appen
          </a>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1 rounded-xl bg-white/[0.06] p-1">
          {(
            [
              ["overview", "Översikt"],
              ["funnel", "Tratt"],
              ["retention", "Retention"],
              ["users", "Användare"],
              ["mail", "Mejl"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`truncate rounded-lg px-0.5 py-2 text-[13px] font-semibold transition sm:text-sm ${
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
            {/* ══ Just nu ══ */}
            <SectionTitle sub="Uppdateras var 15:e sekund. Tryck på en person för profilen.">Just nu</SectionTitle>
            <LivePanel data={live} onOpenUser={setOpenUser} />

            {/* ══ Kommer de tillbaka? (sammanfattning — detaljer i Retention-fliken) ══ */}
            <div className="mb-3 mt-8 flex items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white">Kommer de tillbaka?</h2>
                <p className="text-xs text-white/40">Nya användare senaste 90 dagarna.</p>
              </div>
              <button
                type="button"
                onClick={() => setTab("retention")}
                className="shrink-0 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
              >
                Mer →
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["Dag 1", retAll ? pct(retAll.d1, retAll.d1Base) : undefined],
                  ["Tillbaka", retAll ? pct(retAll.back, retAll.backBase) : undefined],
                  ["Kvar 7 d+", retAll ? pct(retAll.d7, retAll.d7Base) : undefined],
                ] as const
              ).map(([label, p]) => (
                <Kpi key={label} label={label} value={p === undefined ? "…" : p === null ? "—" : `${p} %`} />
              ))}
            </div>

            {/* ══ Idag ══ */}
            <SectionTitle sub="Svensk kalenderdag. Aktiva = öppnade appen eller swipade.">Idag</SectionTitle>
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
                  hint="Unika användare som öppnat appen eller swipat den dagen."
                  data={pick("active")}
                  summary="avg"
                  color="#a78bfa"
                />
                <DailyChart
                  title="Återkommande användare"
                  hint="Aktiva som började en tidigare dag — de som kom tillbaka."
                  data={pick("returning")}
                  summary="avg"
                  color="#34d399"
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

            {/* ══ Källor ══ */}
            <SectionTitle sub="Senaste 30 d, första beröring. Besök = första besöket per webbläsare/app. Konton = e-post eller Apple. Spåras sedan 3 okt 2026.">
              Källor
            </SectionTitle>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                <span>Källa</span>
                <span className="text-right">Besök</span>
                <span className="text-right">Nya</span>
                <span className="text-right">Konton</span>
              </div>
              {!sources ? (
                <div className="h-24 animate-pulse bg-white/[0.03]" />
              ) : sources.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-white/40">Ingen data än.</p>
              ) : (
                sources.map((r) => (
                  <div
                    key={r.source ?? "__unknown"}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-white/5 px-4 py-2.5 text-sm tabular-nums last:border-0"
                  >
                    <span className={r.source === "meta" ? "font-semibold text-sky-300" : "text-white/85"}>
                      {acquisitionLabel(r.source)}
                    </span>
                    <span className="text-right text-white/70">{r.visits}</span>
                    <span className="text-right text-white/70">{r.users}</span>
                    <span className="text-right font-semibold text-white">{r.accounts}</span>
                  </div>
                ))
              )}
            </div>

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

        {tab === "funnel" && (
          <FunnelPanel
            data={funnelData}
            days={funnelDays}
            onDays={setFunnelDays}
            platform={funnelPlatform}
            onPlatform={setFunnelPlatform}
          />
        )}

        {tab === "retention" && (
          <RetentionPanel
            data={retention}
            sourceOptions={sourceOptions}
            source={retSource}
            onSource={setRetSource}
            loginOnly={retLogin}
            onLoginOnly={setRetLogin}
          />
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
                      <div className={u.source === "meta" ? "text-sky-300/80" : "text-white/30"}>
                        {acquisitionLabel(u.source)}
                      </div>
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
        {tab === "mail" && <MailPanel />}
      </div>

      {openUser && (
        <UserSheet
          userId={openUser}
          onClose={closeSheet}
          onChanged={refreshAfterAction}
          onEmail={(email) => setMailDraft({ to: email, subject: "", body: "" })}
        />
      )}
      {mailDraft && <MailComposer initial={mailDraft} onClose={() => setMailDraft(null)} />}
    </main>
  );
}
