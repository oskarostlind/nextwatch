"use client";
// app/admin/PickPanel.tsx — fliken "Välj åt mig" i /admin (AI-pick).
// Data: /api/admin/pick-stats?days=7|30|90. Självförsörjande som AdsPanel:
// egen periodväljare, egen hämtning.
//
// Överst det Oskar bryr sig mest om: hur stor del av valen som kommer ur
// användarens EGNA sparade likes (hela poängen med funktionen är att få folk att
// faktiskt titta på det de gillat). Sedan användning, upplåsning/premium,
// dag-för-dag och de 20 senaste förfrågningarna för felsökning.

import { useEffect, useState } from "react";
import { DailyChart } from "./charts";

type Cnt = { n: number; users: number };

type PickStats = {
  ok: true;
  migrated: true;
  days: number;
  savedTracking: boolean;
  picks: {
    ok: number;
    users: number;
    premium: number;
    credit: number;
    auto?: number;
    finished: number;
    errors: number;
    noCandidates: number;
    fallbacks: number;
    selftests: number;
  };
  saved: {
    fromSaved: number | null;
    known: number | null;
    hadSaved: number | null;
    fromSavedWhenHad: number | null;
    avgSavedCandidates: number | null;
  };
  cost: { totalUsd: number; usersUsd: number; perPickUsd: number | null };
  latency: { avgMs: number | null; p95Ms: number | null };
  unlocks: { grants: number; picks: number; users: number };
  funnel: { paywallView: Cnt; adStart: Cnt; adComplete: Cnt; adFail: Cnt };
  upsell: { view: Cnt; click: Cnt };
  openService: Cnt;
  another: Cnt;
  conversion: {
    clickers: number;
    converted: number;
    users: { id: string; email: string | null; firstClick: string; planSince: string }[];
  };
  series: { day: string; premium: number; credit: number; unlocks: number }[];
  latest: {
    id: string;
    createdAt: string;
    userId: string;
    email: string | null;
    prompt: string | null;
    chips: string[];
    tmdbId: number | null;
    mediaType: string | null;
    fromSaved: boolean | null;
    source: string;
    status: string;
    latencyMs: number | null;
    costUsd: number | null;
    error: string | null;
    model: string | null;
  }[];
};

type NotMigrated = { ok: true; migrated: false; missing: string[]; days: number };

const PERIODS = [7, 30, 90] as const;

const CHIP_LABEL: Record<string, string> = {
  light: "Lättsamt",
  short: "Kort",
  thrilling: "Spännande",
  surprise: "Överraska",
};

const SOURCE_LABEL: Record<string, string> = {
  premium: "Premium",
  credit: "Kredit",
  selftest: "Selftest",
};

const n0 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });
const n1 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

function pct(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || b <= 0) return "—";
  return `${Math.round((a / b) * 100)} %`;
}

function usd(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return `${n.toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} USD`;
}

function ms(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 1000 ? `${n1(n / 1000)} s` : `${n0(n)} ms`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "money" | "accent" | "warn";
}) {
  const color =
    tone === "money"
      ? "text-emerald-300"
      : tone === "accent"
        ? "text-cyan-300"
        : tone === "warn"
          ? "text-amber-300"
          : "text-white";
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="truncate text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 truncate text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{sub}</div>}
    </div>
  );
}

function Section({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3 mt-8">
      <h2 className="text-base font-bold text-white">{title}</h2>
      {sub && <p className="text-xs text-white/40">{sub}</p>}
    </div>
  );
}

/** Annonstratten: paywall visad → annons startad → annons klar (unika användare + antal). */
function Funnel({ f }: { f: PickStats["funnel"] }) {
  const steps = [
    { label: "Paywall visad", c: f.paywallView },
    { label: "Annons startad", c: f.adStart },
    { label: "Annons klar", c: f.adComplete },
  ];
  const top = Math.max(1, f.paywallView.n);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/90">Annonstratt</h3>
        <span className="text-[11px] text-white/40">
          {f.adFail.n > 0 ? `${n0(f.adFail.n)} misslyckade annonser` : "inga misslyckade annonser"}
        </span>
      </div>
      <div className="mt-3 space-y-2.5">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].c.n : null;
          return (
            <div key={s.label}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-white/70">{s.label}</span>
                <span className="tabular-nums text-white/50">
                  <span className="font-semibold text-white">{n0(s.c.n)}</span> · {n0(s.c.users)} anv.
                  {prev !== null && <span className="ml-1.5 text-cyan-300/90">{pct(s.c.n, prev)}</span>}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-amber-400/80"
                  style={{ width: `${Math.min(100, (s.c.n / top) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: string; error: string | null }) {
  const fallback = status === "ok" && !!error;
  const [label, cls] =
    status === "ok"
      ? fallback
        ? ["fallback", "bg-amber-400/15 text-amber-300"]
        : ["ok", "bg-emerald-500/15 text-emerald-300"]
      : status === "error"
        ? ["fel", "bg-rose-500/15 text-rose-300"]
        : status === "no_candidates"
          ? ["inga kand.", "bg-amber-400/15 text-amber-300"]
          : [status, "bg-white/10 text-white/50"];
  return (
    <span title={error ?? undefined} className={`whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold uppercase ${cls}`}>
      {label}
    </span>
  );
}

export default function PickPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<PickStats | null>(null);
  const [notMigrated, setNotMigrated] = useState<NotMigrated | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/admin/pick-stats?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: PickStats | NotMigrated | { ok: false }) => {
        if (!alive) return;
        if (!j.ok) return setState("error");
        if (!j.migrated) {
          setNotMigrated(j);
          setData(null);
        } else {
          setNotMigrated(null);
          setData(j);
        }
        setState("ok");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [days]);

  const p = data?.picks;
  const s = data?.saved;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Välj åt mig</h2>
          <p className="text-xs text-white/40">AI-valet: användning, upplåsningar, kostnad. Svenska kalenderdagar.</p>
        </div>
        <div className="flex rounded-lg bg-white/[0.06] p-0.5">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                days === d ? "bg-white text-neutral-950" : "text-white/60 hover:text-white"
              }`}
            >
              {d} d
            </button>
          ))}
        </div>
      </div>

      {state === "error" && (
        <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          Kunde inte hämta statistiken. Kolla Vercel-loggarna efter [admin/pick-stats].
        </p>
      )}

      {notMigrated && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm leading-relaxed text-amber-200">
          <p className="font-semibold">Inte migrerat än.</p>
          <p className="mt-1 text-xs">
            Kör <code className="rounded bg-black/30 px-1">prisma/sql/2026-10-13_ai_pick.sql</code> mot databasen.
            {notMigrated.missing.length > 0 && <> Saknas: {notMigrated.missing.join(", ")}.</>}
          </p>
        </div>
      )}

      {state === "loading" && !data && !notMigrated && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      )}

      {data && p && s && (
        <div className={state === "loading" ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* ══ Ägarprioriteten: valen ur egna sparade likes ══ */}
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4">
            <p className="text-[11px] uppercase tracking-wide text-cyan-300/80">Ur egna sparade likes</p>
            {!data.savedTracking ? (
              <p className="mt-1 text-sm text-white/70">
                Kolumnen <code className="rounded bg-black/30 px-1">pick_from_saved</code> saknas i ai_pick_requests —
                lägg till den enligt specen för att mäta det här.
              </p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold tabular-nums text-white">
                  {pct(s.fromSaved, s.known)}
                  <span className="ml-2 text-sm font-medium text-white/50">
                    {s.known ? `${n0(s.fromSaved ?? 0)} av ${n0(s.known)} picks` : "inga picks än"}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/50">
                  {s.hadSaved != null && s.hadSaved > 0
                    ? `När användaren hade sparade likes bland kandidaterna blev valet en sådan i ${pct(s.fromSavedWhenHad, s.hadSaved)} (${n0(s.fromSavedWhenHad ?? 0)} av ${n0(s.hadSaved)}). `
                    : ""}
                  {s.avgSavedCandidates != null
                    ? `Snitt ${n1(s.avgSavedCandidates)} sparade likes i kandidatlistan per pick.`
                    : ""}
                </p>
              </>
            )}
          </div>

          {/* ══ Användning ══ */}
          <Section title="Användning" sub={`Senaste ${data.days} d. Picks = lyckade val som drog kvot (selftest räknas inte).`} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Picks levererade"
              value={n0(p.ok)}
              sub={p.selftests > 0 ? `+${n0(p.selftests)} selftest (exkl.)` : undefined}
            />
            <Tile
              label="Unika användare"
              value={n0(p.users)}
              sub={p.users > 0 ? `${n1(p.ok / p.users)} picks/användare` : undefined}
            />
            <Tile
              label="Premium-andel"
              value={pct(p.premium, p.premium + p.credit)}
              sub={`${n0(p.premium)} premium · ${n0(p.credit)} kredit · ${n0(p.auto ?? 0)} auto-förslag`}
            />
            <Tile
              label="Öppnade i tjänst"
              value={pct(data.openService.n, p.ok)}
              sub={`${n0(data.openService.n)} klick · ${n0(data.openService.users)} anv.`}
              tone="accent"
            />
            <Tile
              label="«Visa något annat»"
              value={pct(data.another.n, p.ok)}
              sub={`${n0(data.another.n)} gånger · ${n0(data.another.users)} anv.`}
            />
            <Tile
              label="Felfrekvens"
              value={pct(p.errors, p.finished)}
              sub={`${n0(p.errors)} fel · ${n0(p.noCandidates)} inga kand. · ${n0(p.fallbacks)} fallback`}
              tone={p.finished > 0 && p.errors / p.finished > 0.05 ? "warn" : undefined}
            />
            <Tile
              label="LLM-kostnad"
              value={usd(data.cost.totalUsd)}
              sub={`${usd(data.cost.perPickUsd, 4)} per pick`}
              tone="money"
            />
            <Tile label="Svarstid" value={ms(data.latency.avgMs)} sub={`p95 ${ms(data.latency.p95Ms)}`} />
          </div>

          {/* ══ Upplåsning & premium ══ */}
          <Section
            title="Upplåsning & premium"
            sub="Belöningsvideo ger krediter (iOS). Premium-CTA visas för gratisanvändare."
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Annonsupplåsningar"
              value={n0(data.unlocks.grants)}
              sub={`+${n0(data.unlocks.picks)} picks · ${n0(data.unlocks.users)} anv.`}
              tone="money"
            />
            <Tile
              label="Upsell-klick"
              value={n0(data.upsell.click.n)}
              sub={`${pct(data.upsell.click.n, data.upsell.view.n)} av ${n0(data.upsell.view.n)} visningar · ${n0(data.upsell.click.users)} anv.`}
            />
            <Tile
              label="Premium efter klick"
              value={n0(data.conversion.converted)}
              sub={`${pct(data.conversion.converted, data.conversion.clickers)} av ${n0(data.conversion.clickers)} som klickade`}
              tone={data.conversion.converted > 0 ? "money" : undefined}
            />
            <Tile
              label="Kredit-picks"
              value={n0(p.credit)}
              sub={data.unlocks.picks > 0 ? `≈ ${pct(p.credit, data.unlocks.picks)} av periodens upplåsta` : undefined}
            />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Funnel f={data.funnel} />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <h3 className="text-sm font-semibold text-white/90">Blev premium efter pick-upsell</h3>
              <p className="mt-0.5 text-[11px] leading-snug text-white/40">
                Klickade på premium-CTA:n i arket och har plan_since efter första klicket. En signal, inte attribution.
              </p>
              {data.conversion.users.length === 0 ? (
                <p className="mt-3 text-sm text-white/40">Ingen än.</p>
              ) : (
                <div className="mt-2 divide-y divide-white/5">
                  {data.conversion.users.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-white/80">{u.email ?? u.id.slice(0, 8)}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-white/45">
                        klick {when(u.firstClick)} → premium {when(u.planSince)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ══ Dag för dag ══ */}
          <Section title="Dag för dag" sub="Tryck/hovra på en stapel för dagens siffra." />
          <div className="grid gap-3 md:grid-cols-3">
            <DailyChart
              title="Picks — premium"
              hint="Ingår i premium (20/mån)."
              data={data.series.map((r) => ({ day: r.day, value: r.premium }))}
              color="#a78bfa"
            />
            <DailyChart
              title="Picks — kredit"
              hint="Betalda med annonskrediter."
              data={data.series.map((r) => ({ day: r.day, value: r.credit }))}
              color="#22d3ee"
            />
            <DailyChart
              title="Annonsupplåsningar"
              hint="Belöningsvideor som gav +picks."
              data={data.series.map((r) => ({ day: r.day, value: r.unlocks }))}
              color="#fbbf24"
            />
          </div>

          {/* ══ Senaste förfrågningar ══ */}
          <Section title="Senaste 20 förfrågningarna" sub="Alla källor och statusar, oavsett period. Hovra på status för feltexten." />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[820px] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-white/10 text-xs tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-white/40">
                  <th className="border-b border-white/10 px-3 py-2 text-left font-semibold">Tid</th>
                  <th className="border-b border-white/10 px-2 py-2 text-left font-semibold">Användare</th>
                  <th className="border-b border-white/10 px-2 py-2 text-left font-semibold">Önskemål</th>
                  <th className="border-b border-white/10 px-2 py-2 text-left font-semibold">Val</th>
                  <th className="border-b border-white/10 px-2 py-2 text-left font-semibold">Källa</th>
                  <th className="border-b border-white/10 px-2 py-2 text-left font-semibold">Status</th>
                  <th className="border-b border-white/10 px-2 py-2 text-right font-semibold">Tid</th>
                  <th className="border-b border-white/10 px-3 py-2 text-right font-semibold">USD</th>
                </tr>
              </thead>
              <tbody>
                {data.latest.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-white/40">
                      Inga förfrågningar än.
                    </td>
                  </tr>
                )}
                {data.latest.map((r) => (
                  <tr key={r.id} className={r.source === "selftest" ? "opacity-60" : undefined}>
                    <td className="whitespace-nowrap border-b border-white/5 px-3 py-2 text-white/60">{when(r.createdAt)}</td>
                    <td className="max-w-[160px] truncate border-b border-white/5 px-2 py-2 text-white/80" title={r.userId}>
                      {r.email ?? r.userId.slice(0, 8)}
                    </td>
                    <td className="max-w-[260px] border-b border-white/5 px-2 py-2">
                      {r.chips.length > 0 && (
                        <span className="mr-1 inline-flex flex-wrap gap-1 align-middle">
                          {r.chips.map((c) => (
                            <span key={c} className="rounded-full border border-white/15 px-1.5 py-px text-[10px] text-white/60">
                              {CHIP_LABEL[c] ?? c}
                            </span>
                          ))}
                        </span>
                      )}
                      {r.prompt ? (
                        <span className="text-white/80">{r.prompt}</span>
                      ) : r.chips.length === 0 ? (
                        <span className="text-white/30">—</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap border-b border-white/5 px-2 py-2">
                      {r.tmdbId ? (
                        <>
                          <a
                            href={`https://www.themoviedb.org/${r.mediaType === "tv" ? "tv" : "movie"}/${r.tmdbId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-300 hover:text-cyan-200"
                          >
                            {r.mediaType === "tv" ? "tv" : "film"} {r.tmdbId}
                          </a>
                          {r.fromSaved != null && (
                            <span
                              className={`ml-1.5 rounded px-1 py-px text-[9px] font-bold uppercase ${
                                r.fromSaved ? "bg-cyan-400/15 text-cyan-300" : "bg-white/10 text-white/50"
                              }`}
                            >
                              {r.fromSaved ? "sparad" : "ny"}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-white/30">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap border-b border-white/5 px-2 py-2 text-white/70">
                      {SOURCE_LABEL[r.source] ?? r.source}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <StatusBadge status={r.status} error={r.error} />
                    </td>
                    <td className="whitespace-nowrap border-b border-white/5 px-2 py-2 text-right text-white/60">
                      {ms(r.latencyMs)}
                    </td>
                    <td className="whitespace-nowrap border-b border-white/5 px-3 py-2 text-right text-white/60" title={r.model ?? undefined}>
                      {r.costUsd != null ? r.costUsd.toLocaleString("sv-SE", { maximumFractionDigits: 4 }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-white/35">
            Picks = status ok utom selftest. Fallback = LLM:en misslyckades men användaren fick det deterministiska valet
            (räknas som pick). Fel = status error eller en reservation som hängt kvar &gt; 2 min. Öppnade i tjänst och «Visa
            något annat» är händelser delat med picks under perioden. Kostnaden inkluderar selftest och fel; per pick räknas
            på användarnas förfrågningar.
          </p>
        </div>
      )}
    </>
  );
}
