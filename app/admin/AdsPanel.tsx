"use client";
// app/admin/AdsPanel.tsx — AdMob-statistik på admin-översikten
// (/api/admin/ads → lib/admobReport.ts). Egen periodväljare: AdMob-siffrorna
// cachas 1 h på servern, så det är billigt att byta period.

import { useEffect, useState } from "react";
import { DailyChart } from "./charts";

type Totals = { earnings: number; impressions: number; clicks: number; adRequests: number; matchedRequests: number };
type Stats = {
  days: number;
  currency: string;
  fetchedAt: string;
  totals: Totals & { ecpm: number; fillRate: number; ctr: number };
  perDay: (Totals & { day: string })[];
  perFormat: (Totals & { format: string; ecpm: number })[];
};

const PERIODS = [7, 30, 90] as const;

const FORMAT_LABEL: Record<string, string> = {
  INTERSTITIAL: "Helsidesannons",
  REWARDED: "Belöningsvideo",
  REWARDED_INTERSTITIAL: "Belönad helsida",
  BANNER: "Banner",
  NATIVE: "Native",
  APP_OPEN: "App-öppning",
};

const n0 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });
const n2 = (n: number) => n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;

function Tile({ label, value, sub, money }: { label: string; value: string; sub?: string; money?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="truncate text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 truncate text-2xl font-bold tabular-nums ${money ? "text-emerald-300" : "text-white"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{sub}</div>}
    </div>
  );
}

export default function AdsPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/admin/ads?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; configured?: boolean; stats?: Stats | null }) => {
        if (!alive) return;
        if (j.configured === false) return setState("unconfigured");
        if (!j.ok || !j.stats) return setState("error");
        setStats(j.stats);
        setState("ok");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [days]);

  const cur = stats?.currency ?? "SEK";

  return (
    <>
      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Annonser</h2>
          <p className="text-xs text-white/40">
            AdMob, uppskattat.{" "}
            {stats && `Uppdaterad ${new Date(stats.fetchedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })} · `}
            <a href="https://apps.admob.com" target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200">
              Öppna AdMob
            </a>
          </p>
        </div>
        <div className="flex rounded-lg bg-white/[0.06] p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                days === p ? "bg-white text-neutral-950" : "text-white/60 hover:text-white"
              }`}
            >
              {p} d
            </button>
          ))}
        </div>
      </div>

      {state === "unconfigured" && (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">
          Inte uppkopplat — ADMOB_*-variablerna saknas i Vercel (se docs/admob-setup.md).
        </p>
      )}
      {state === "error" && (
        <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          Kunde inte hämta från AdMob just nu. Kolla Vercel-loggarna efter [admob].
        </p>
      )}
      {state === "loading" && !stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      )}

      {stats && state !== "unconfigured" && (
        <div className={state === "loading" ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Intäkt" value={`${n2(stats.totals.earnings)} ${cur}`} sub={`senaste ${stats.days} d`} money />
            <Tile label="Visningar" value={n0(stats.totals.impressions)} sub={`${n0(stats.totals.clicks)} klick · CTR ${pct(stats.totals.ctr)}`} />
            <Tile label="eCPM" value={`${n2(stats.totals.ecpm)} ${cur}`} sub="intäkt per 1 000 visningar" />
            <Tile
              label="Fill rate"
              value={pct(stats.totals.fillRate)}
              sub={`${n0(stats.totals.matchedRequests)} av ${n0(stats.totals.adRequests)} förfrågningar`}
            />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <DailyChart
              title={`Intäkt (${cur})`}
              hint="Uppskattad intäkt per dag, AdMobs dygn."
              data={stats.perDay.map((d) => ({ day: d.day, value: Math.round(d.earnings * 100) / 100 }))}
              color="#34d399"
            />
            <DailyChart
              title="Visningar"
              hint="Visade annonser per dag, alla format."
              data={stats.perDay.map((d) => ({ day: d.day, value: d.impressions }))}
              color="#fbbf24"
            />
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              <span>Format</span>
              <span className="text-right">Visn.</span>
              <span className="text-right">eCPM</span>
              <span className="text-right">Intäkt</span>
            </div>
            {stats.perFormat.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/40">Inga visningar under perioden.</p>
            ) : (
              stats.perFormat.map((f) => (
                <div key={f.format} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-white/5 px-4 py-2.5 text-sm tabular-nums last:border-0">
                  <span className="truncate text-white/80">{FORMAT_LABEL[f.format.toUpperCase()] ?? f.format}</span>
                  <span className="text-right text-white/70">{n0(f.impressions)}</span>
                  <span className="text-right text-white/70">{n2(f.ecpm)}</span>
                  <span className="text-right font-semibold text-emerald-300">{n2(f.earnings)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
