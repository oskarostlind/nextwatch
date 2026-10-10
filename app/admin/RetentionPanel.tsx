"use client";

// Retention-fliken i /admin: kommer nya användare tillbaka?
// Data: /api/admin/retention (kohort = nya användare senaste 90 dagarna).
// Varje procent räknas bara på de användare som hunnit bli gamla nog för
// måttet — annars drar dagens nya ner "kvar efter 7 dagar".

import { useMemo, useState } from "react";
import { acquisitionLabel } from "@/lib/acquisition";

export type RetAgg = {
  n: number;
  act0: number;
  d1: number;
  d1Base: number;
  back: number;
  backBase: number;
  d7: number;
  d7Base: number;
  d14: number;
  d14Base: number;
  d30: number;
  d30Base: number;
};

export type RetentionData = {
  source: string;
  loginOnly: boolean;
  windowDays: number;
  trackingEnabled: boolean;
  total: RetAgg & { avgReturnDays: number | null };
  weeks: (RetAgg & { week: string })[];
  sources: (RetAgg & { source: string | null })[];
  curve: { day: number; base: number; active: number }[];
};

export function pct(a: number, b: number): number | null {
  return b > 0 ? Math.round((a / b) * 100) : null;
}

function fmtPct(p: number | null): string {
  return p === null ? "—" : `${p} %`;
}

/** Heatmap-cell: starkare cyan ju högre andel. */
function heat(p: number | null): React.CSSProperties {
  if (p === null) return {};
  return { backgroundColor: `rgba(34, 211, 238, ${0.06 + (Math.min(p, 100) / 100) * 0.55})` };
}

function weekLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  // ISO-veckonummer
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `v.${wk}|${d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}`;
}

function Stat({
  label,
  a,
  b,
  hint,
  strong,
}: {
  label: string;
  a: number;
  b: number;
  hint: string;
  strong?: boolean;
}) {
  const p = pct(a, b);
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="truncate text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${strong ? "text-cyan-300" : "text-white"}`}>
        {fmtPct(p)}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-white/40">
        {b > 0 ? `${a} av ${b}` : "för tidigt"} · {hint}
      </div>
    </div>
  );
}

/** Andel aktiva dag N efter start (N = 0..30), en stapel per dag. */
function Curve({ data }: { data: RetentionData["curve"] }) {
  const [idx, setIdx] = useState<number | null>(null);
  const pts = data.map((d) => ({ ...d, p: d.base > 0 ? (d.active / d.base) * 100 : 0 }));
  // Dag 0 är nästan alltid högst — skala på dag 1+ så resten syns, och klipp dag 0.
  const max = Math.max(5, ...pts.slice(1).map((d) => d.p)) * 1.15;
  const H = 120;
  const n = pts.length;
  const sel = idx !== null ? pts[idx] : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Aktiva dag för dag efter start</h3>
          <p className="text-[11px] text-white/40">
            Andel av de nya som var inne exakt dag N. Dag 0 = registreringsdagen.
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          {sel ? (
            <>
              <div className="text-lg font-bold text-white">{fmtPct(pct(sel.active, sel.base))}</div>
              <div className="text-[11px] text-white/40">
                dag {sel.day} · {sel.active}/{sel.base}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-white/35">tryck på en stapel</div>
          )}
        </div>
      </div>
      <div
        className="relative mt-3 touch-none select-none"
        style={{ height: H }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setIdx(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setIdx(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
        }}
        onPointerLeave={() => setIdx(null)}
      >
        <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="h-full w-full">
          {pts.map((d, i) => {
            const slot = 1000 / n;
            const h = Math.min(H, (d.p / max) * H);
            const clipped = d.p > max;
            return (
              <rect
                key={d.day}
                x={i * slot + 2}
                y={H - h}
                width={Math.max(1, slot - 4)}
                height={h}
                rx={3}
                fill={i === 0 ? "#a78bfa" : "#22d3ee"}
                opacity={idx === null || idx === i ? (clipped ? 0.55 : 1) : 0.35}
              />
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/35">
        <span>dag 0</span>
        <span>7</span>
        <span>14</span>
        <span>21</span>
        <span>30</span>
      </div>
    </div>
  );
}

export default function RetentionPanel({
  data,
  sourceOptions,
  source,
  onSource,
  loginOnly,
  onLoginOnly,
}: {
  data: RetentionData | null;
  sourceOptions: (string | null)[];
  source: string;
  onSource: (s: string) => void;
  loginOnly: boolean;
  onLoginOnly: (v: boolean) => void;
}) {
  const t = data?.total;
  const neverBack = t ? pct(t.backBase - t.back, t.backBase) : null;
  const weeks = useMemo(() => data?.weeks ?? [], [data]);

  return (
    <>
      {/* ══ Filter ══ */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <div className="flex w-max gap-1.5">
          {[{ key: "all", label: "Alla källor" }, ...sourceOptions.map((s) => ({ key: s ?? "unknown", label: acquisitionLabel(s) }))].map(
            (o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => onSource(o.key)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  source === o.key
                    ? "border-white bg-white text-neutral-950"
                    : "border-white/15 text-white/60 hover:text-white"
                }`}
              >
                {o.label}
              </button>
            ),
          )}
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-white/55">
        <input
          type="checkbox"
          checked={loginOnly}
          onChange={(e) => onLoginOnly(e.target.checked)}
          className="h-4 w-4 accent-cyan-400"
        />
        Bara konton med inloggning (e-post/Apple) — utan gäster
      </label>

      {data && !data.trackingEnabled && (
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 sm:px-3.5 text-xs leading-relaxed text-amber-200">
          Besöksspårningen är inte aktiv än — kör <code className="rounded bg-black/30 px-1">npx prisma db push</code>.
          Tills dess räknas bara den som swipat, listat eller röstat, så den som öppnar appen och bara tittar runt
          syns inte.
        </div>
      )}

      {!data ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : (
        <>
          {/* ══ Svaret i klartext ══ */}
          <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4">
            <p className="text-[11px] uppercase tracking-wide text-cyan-300/80">
              Senaste {data.windowDays} dagarna · {t!.n} nya
            </p>
            <p className="mt-1 text-lg font-bold leading-snug text-white">
              {neverBack === null
                ? "För lite data än."
                : `${neverBack} % av de nya har aldrig kommit tillbaka efter första dagen.`}
            </p>
            {t!.avgReturnDays !== null && (
              <p className="mt-1 text-xs text-white/50">
                De som kommer tillbaka har i snitt varit inne {t!.avgReturnDays.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} dagar till.
              </p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Gjorde något dag 0" a={t!.act0} b={t!.n} hint="swipade, listade, öppnade" />
            <Stat label="Tillbaka dag 1" a={t!.d1} b={t!.d1Base} hint="dagen efter" />
            <Stat label="Kom tillbaka" a={t!.back} b={t!.backBase} hint="någon gång efter dag 0" strong />
            <Stat label="Kvar efter 7 d" a={t!.d7} b={t!.d7Base} hint="aktiv dag 7 eller senare" />
            <Stat label="Kvar efter 14 d" a={t!.d14} b={t!.d14Base} hint="aktiv dag 14 eller senare" />
            <Stat label="Kvar efter 30 d" a={t!.d30} b={t!.d30Base} hint="aktiv dag 30 eller senare" />
          </div>

          <div className="mt-3">
            <Curve data={data.curve} />
          </div>

          {/* ══ Veckokohorter ══ */}
          <div className="mb-3 mt-8">
            <h2 className="text-base font-bold text-white">Per startvecka</h2>
            <p className="text-xs text-white/40">
              Nya användare grupperade på veckan de började. Mörkare = fler kvar. — = veckan är för ny.
            </p>
          </div>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[330px] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-white/10 text-xs tabular-nums sm:text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-white/40">
                  <th className="border-b border-white/10 px-2.5 py-2 sm:px-3 text-left font-semibold">Vecka</th>
                  <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Nya</th>
                  <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Dag 0</th>
                  <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Dag 1</th>
                  <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">7 d+</th>
                  <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">14 d+</th>
                  <th className="border-b border-white/10 px-2.5 py-2 sm:px-3 text-right font-semibold">30 d+</th>
                </tr>
              </thead>
              <tbody>
                {weeks.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-white/40">
                      Inga nya användare i perioden.
                    </td>
                  </tr>
                )}
                {weeks.map((w) => {
                  const cells = [
                    pct(w.act0, w.n),
                    pct(w.d1, w.d1Base),
                    pct(w.d7, w.d7Base),
                    pct(w.d14, w.d14Base),
                    pct(w.d30, w.d30Base),
                  ];
                  return (
                    <tr key={w.week}>
                      <td className="whitespace-nowrap border-b border-white/5 px-2.5 py-1.5 text-white/80 sm:px-3">
                        <span className="font-medium">{weekLabel(w.week).split("|")[0]}</span>
                        <span className="block text-[10px] text-white/35">{weekLabel(w.week).split("|")[1]}</span>
                      </td>
                      <td className="border-b border-white/5 px-1.5 py-2 sm:px-2 text-right font-semibold text-white">{w.n}</td>
                      {cells.map((p, i) => (
                        <td
                          key={i}
                          style={heat(p)}
                          className={`border-b border-white/5 px-1.5 py-2 sm:px-2 text-right ${p === null ? "text-white/25" : "text-white"} ${i === 4 ? "pr-2.5 sm:pr-3" : ""}`}
                        >
                          {fmtPct(p)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ══ Per källa ══ */}
          {data.source === "all" && (
            <>
              <div className="mb-3 mt-8">
                <h2 className="text-base font-bold text-white">Per källa</h2>
                <p className="text-xs text-white/40">
                  Installationer från App Store (även via Meta-annonser) hamnar under «iOS-appen» — App Store skickar
                  inte med vilken annons det var. «Okänd» = konton från före 3 okt.
                </p>
              </div>
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[330px] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-white/10 text-xs tabular-nums sm:text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-white/40">
                      <th className="border-b border-white/10 px-2.5 py-2 sm:px-3 text-left font-semibold">Källa</th>
                      <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Nya</th>
                      <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Dag 0</th>
                      <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Dag 1</th>
                      <th className="border-b border-white/10 px-1.5 py-2 sm:px-2 text-right font-semibold">Tillbaka</th>
                      <th className="border-b border-white/10 px-2.5 py-2 sm:px-3 text-right font-semibold">7 d+</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((s) => {
                      const cells = [pct(s.act0, s.n), pct(s.d1, s.d1Base), pct(s.back, s.backBase), pct(s.d7, s.d7Base)];
                      return (
                        <tr
                          key={s.source ?? "unknown"}
                          className="cursor-pointer hover:bg-white/[0.03]"
                          onClick={() => onSource(s.source ?? "unknown")}
                        >
                          <td
                            className={`whitespace-nowrap border-b border-white/5 px-2.5 py-2 sm:px-3 ${
                              s.source === "meta" || s.source === "ios_app" ? "font-semibold text-sky-300" : "text-white/80"
                            }`}
                          >
                            {acquisitionLabel(s.source)}
                          </td>
                          <td className="border-b border-white/5 px-1.5 py-2 sm:px-2 text-right font-semibold text-white">{s.n}</td>
                          {cells.map((p, i) => (
                            <td
                              key={i}
                              style={heat(p)}
                              className={`border-b border-white/5 px-1.5 py-2 sm:px-2 text-right ${p === null ? "text-white/25" : "text-white"} ${i === 3 ? "pr-2.5 sm:pr-3" : ""}`}
                            >
                              {fmtPct(p)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="mt-6 text-[11px] leading-relaxed text-white/35">
            Aktiv = öppnade appen, swipade, lade till i listan eller röstade i en grupp den dagen (svensk tid).
            Appöppningar spåras från 10 okt 2026; tidigare dagar bygger bara på swipes, listor och röster och är därför
            en undre gräns. Varje procent räknas på de användare som hunnit bli tillräckligt gamla för måttet.
          </p>
        </>
      )}
    </>
  );
}
