"use client";

// Tratt-fliken i /admin: var lämnar nya användare under första besöket?
// Data: /api/admin/funnel (mätpunkter från lib/funnel.ts, steg i lib/funnelSteps.ts).

import { FUNNEL_GROUPS, funnelLabel, screenLabel } from "@/lib/funnelSteps";

export type FunnelData = {
  enabled: boolean;
  days: number;
  platform: "all" | "ios" | "web";
  cohort: number;
  ios?: number;
  web?: number;
  steps: { name: string; n: number; medSec: number | null; medMs: number | null }[];
  exits: {
    byStep: { step: string | null; n: number }[];
    byScreen: { at: string | null; n: number }[];
    firstSession: { n: number; medSecs: number | null; medSwipes: number | null; zeroSwipes: number };
  } | null;
};

const DAY_OPTS = [1, 7, 30] as const;

function fmtSec(s: number | null): string {
  if (s === null) return "";
  if (s < 90) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

function Bar({ label, n, of, sub, indent, warn }: { label: string; n: number; of: number; sub?: string; indent?: boolean; warn?: boolean }) {
  const p = of > 0 ? Math.round((n / of) * 100) : 0;
  return (
    <div className={`relative overflow-hidden px-3 py-2 ${indent ? "pl-7" : ""}`}>
      <div
        className={`absolute inset-y-1 left-1 rounded-md ${warn ? "bg-rose-500/20" : "bg-cyan-400/15"}`}
        style={{ width: `calc(${p}% - 8px)` }}
      />
      <div className="relative flex items-baseline justify-between gap-3">
        <span className={`min-w-0 text-[13px] leading-snug ${indent ? "text-white/60" : "text-white/90"}`}>{label}</span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="text-sm font-semibold text-white">{p} %</span>
          <span className="ml-1.5 text-[11px] text-white/40">{n}</span>
        </span>
      </div>
      {sub && <div className="relative text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

export default function FunnelPanel({
  data,
  days,
  onDays,
  platform,
  onPlatform,
}: {
  data: FunnelData | null;
  days: number;
  onDays: (d: number) => void;
  platform: "all" | "ios" | "web";
  onPlatform: (p: "all" | "ios" | "web") => void;
}) {
  const byName = new Map((data?.steps ?? []).map((s) => [s.name, s]));
  const cohort = data?.cohort ?? 0;
  const fs = data?.exits?.firstSession;
  const exitTotal = (data?.exits?.byStep ?? []).reduce((a, b) => a + b.n, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg bg-white/[0.06] p-0.5">
          {(
            [
              ["all", "Alla"],
              ["ios", "iOS-appen"],
              ["web", "Webben"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => onPlatform(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                platform === k ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg bg-white/[0.06] p-0.5">
          {DAY_OPTS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                days === d ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              {d === 1 ? "24 h" : `${d} d`}
            </button>
          ))}
        </div>
      </div>

      {data && !data.enabled && (
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
          Tratt-tabellen finns inte i databasen än (funnel_events).
        </div>
      )}

      {!data ? (
        <div className="mt-4 h-64 animate-pulse rounded-2xl bg-white/[0.04]" />
      ) : data.enabled && cohort === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/50">
          Inga nya enheter i perioden än. Mätningen startade 10 okt 2026 — nya användare dyker upp här i takt med
          att de öppnar appen.
        </div>
      ) : (
        <>
          {/* ══ Sammanfattning ══ */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
              <div className="text-[11px] uppercase tracking-wide text-white/40">Nya enheter</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-white">{cohort}</div>
              <div className="text-[11px] text-white/40">
                {data.ios ?? 0} iOS · {data.web ?? 0} webb
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
              <div className="text-[11px] uppercase tracking-wide text-white/40">Första kortet efter</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                {byName.get("deck_ready")?.medSec != null ? fmtSec(byName.get("deck_ready")!.medSec) : "—"}
              </div>
              <div className="text-[11px] text-white/40">
                median från första öppning
                {byName.get("deck_ready")?.medMs != null ? ` · laddning ${(byName.get("deck_ready")!.medMs! / 1000).toFixed(1)} s` : ""}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
              <div className="text-[11px] uppercase tracking-wide text-white/40">Första sessionen</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-white">{fs?.medSecs != null ? fmtSec(fs.medSecs) : "—"}</div>
              <div className="text-[11px] text-white/40">median innan appen stängdes</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
              <div className="text-[11px] uppercase tracking-wide text-white/40">Stängde utan swipe</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-rose-300">
                {fs && fs.n > 0 ? `${Math.round((fs.zeroSwipes / fs.n) * 100)} %` : "—"}
              </div>
              <div className="text-[11px] text-white/40">{fs ? `${fs.zeroSwipes} av ${fs.n} i första sessionen` : ""}</div>
            </div>
          </div>

          {/* ══ Var lämnade de? ══ */}
          {data.exits && exitTotal > 0 && (
            <>
              <div className="mb-3 mt-8">
                <h2 className="text-base font-bold text-white">Var lämnade de som inte kom tillbaka?</h2>
                <p className="text-xs text-white/40">
                  Senaste steget innan appen stängdes sista gången, för enheter som inte öppnat appen igen en annan dag.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                  <h3 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Sista steget</h3>
                  {data.exits.byStep.map((r) => (
                    <Bar key={r.step ?? "none"} label={funnelLabel(r.step)} n={r.n} of={exitTotal} warn />
                  ))}
                </div>
                <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                  <h3 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Skärmen de var på</h3>
                  {data.exits.byScreen.map((r) => (
                    <Bar key={r.at ?? "none"} label={screenLabel(r.at)} n={r.n} of={exitTotal} warn />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ══ Steg för steg ══ */}
          <div className="mb-3 mt-8">
            <h2 className="text-base font-bold text-white">Steg för steg</h2>
            <p className="text-xs text-white/40">
              Andel av de nya enheterna som nådde varje steg minst en gång, och mediantid dit från första öppningen.
            </p>
          </div>
          <div className="space-y-3">
            {FUNNEL_GROUPS.map((g) => {
              const rows = g.steps.filter((s) => s.name === "first_open" || byName.has(s.name));
              if (rows.length === 0) return null;
              return (
                <div key={g.title} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                  <div className="border-b border-white/10 px-3 py-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{g.title}</h3>
                    {g.hint && <p className="text-[11px] text-white/35">{g.hint}</p>}
                  </div>
                  <div className="divide-y divide-white/5">
                    {rows.map((s) => {
                      const r = s.name === "first_open" ? { n: cohort, medSec: 0 } : byName.get(s.name)!;
                      const warn = ["deck_error", "deck_empty", "att_denied", "tour_skipped", "provider_dismissed", "limit_wall"].includes(s.name);
                      return (
                        <Bar
                          key={s.name}
                          label={s.label}
                          n={r.n}
                          of={cohort}
                          indent={s.indent}
                          warn={warn}
                          sub={r.medSec ? `efter ${fmtSec(r.medSec)}` : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-[11px] leading-relaxed text-white/35">
            Bara nya enheter räknas (befintliga användare som uppdaterar appen eller loggar in på en ny enhet filtreras
            bort). Varje steg räknas en gång per enhet. Swipes = riktiga kort, inte gestguidens demokort. Mätningen
            startade 10 okt 2026.
          </p>
        </>
      )}
    </>
  );
}
