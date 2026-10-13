"use client";
// app/admin/PushPanel.tsx — fliken "Push" i /admin.
// Data: /api/admin/push-stats?days=N (vad fungerar?) och /api/admin/push-test
// (förhandsvisa + skicka testpush till Oskars egen telefon). Självförsörjande som
// PickPanel: egen periodväljare, egen hämtning. Svensk text hårdkodad, som övriga paneler.
//
// Statistiken är med flit ärlig om urvalsstorlek: en vinkel med <20 skickade visas
// som "för lite data" och hamnar sist — annars blir tre öppningar av fyra "75 %".

import { useCallback, useEffect, useState } from "react";
import { DailyChart } from "./charts";

type Actions = { save: number; nope: number; seen: number; remove: number };
type TypeRow = { type: string; sent: number; opened: number; openRate: number | null; actions: Actions };
type AngleRow = { angle: string; sent: number; opened: number; openRate: number | null; saves: number };
type VariantRow = AngleRow & { variant: string };
type LatestRow = {
  type: string;
  angle: string | null;
  tmdbId: number | null;
  mediaType: string | null;
  sentAt: string;
  openedAt: string | null;
  action: string | null;
};
type Stats = {
  ok: true;
  days: number;
  totals: { sent: number; opened: number; openRate: number | null; buttonTaps: number; actions: Actions };
  types: TypeRow[];
  angles: AngleRow[];
  variants: VariantRow[];
  series: { day: string; sent: number; opened: number }[];
  latest: LatestRow[];
};
type Fail = { ok: false; message: string };

type Composed = {
  type: string;
  angle: string;
  payload: {
    title: string;
    body: string;
    image?: string | null;
    category?: "NW_TITLE" | "NW_SAVED";
    threadId?: string;
    interruptionLevel?: string;
    relevanceScore?: number;
    angle?: string;
    tmdbId?: number;
    mediaType?: string;
    data?: Record<string, string>;
  };
  debug?: Record<string, unknown>;
};
type TestResult =
  | { kind: "preview"; composed: Composed }
  | { kind: "sent"; sent: boolean; pid: string | null; composed: Composed }
  | { kind: "error"; message: string };

const PERIODS = [7, 30, 90] as const;
/** Under det här antalet skickade är en öppningsgrad mest brus. */
const MIN_SAMPLE = 20;

const TYPE_LABEL: Record<string, string> = {
  daily_rec: "Dagens tips",
  weekly_picks: "Veckans val",
  watchlist_nudge: "Watchlist-puff",
  release: "Premiär",
  re_engagement: "Återkomst",
  group_match: "Gruppmatch",
  group_invite: "Gruppinbjudan",
  group_invite_accepted: "Inbjudan accepterad",
  friend_request: "Vänförfrågan",
  friend_accepted: "Vän accepterad",
  share_received: "Tips från vän",
  admin_mail: "Admin-mejl",
  time_sensitive_demo: "Tidskänslig (demo)",
};

const ANGLE_LABEL: Record<string, string> = {
  friend: "Vän",
  topMatch: "Bästa match",
  person: "Skådespelare/regissör",
  provider: "Streamingtjänst",
  rating: "Betyg",
  theme: "Tema",
  runtime: "Speltid",
  weekday: "Veckodag",
  challenge: "Utmaning",
  generic: "Generell",
  weekly: "Veckans val",
  nudge: "Watchlist-puff",
};

const ACTION_LABEL: Record<string, string> = { save: "Spara", nope: "Nej", seen: "Sett", remove: "Ta bort" };
const CATEGORY_BUTTONS: Record<string, string[]> = {
  NW_TITLE: ["Spara", "Nej"],
  NW_SAVED: ["Sett", "Ta bort"],
};

const FALLBACK_TEST_TYPES = ["daily_rec", "weekly_picks", "watchlist_nudge", "time_sensitive_demo"];

const n0 = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;
const angleLabel = (a: string) => ANGLE_LABEL[a] ?? a;

function pct(r: number | null | undefined): string {
  return r == null ? "—" : `${Math.round(r * 100)} %`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "accent" | "money" | "warn" }) {
  const color = tone === "money" ? "text-emerald-300" : tone === "accent" ? "text-cyan-300" : tone === "warn" ? "text-amber-300" : "text-white";
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

/** Liten stapel som visar öppningsgraden relativt 100 %. */
function RateBar({ rate, dim }: { rate: number | null; dim?: boolean }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full ${dim ? "bg-white/25" : "bg-cyan-400/80"}`}
        style={{ width: `${Math.min(100, (rate ?? 0) * 100)}%` }}
      />
    </div>
  );
}

function ActionChips({ a }: { a: Actions }) {
  const parts = (Object.keys(ACTION_LABEL) as (keyof Actions)[]).filter((k) => a[k] > 0);
  if (parts.length === 0) return <span className="text-white/30">—</span>;
  return (
    <span className="text-white/60">
      {parts.map((k, i) => (
        <span key={k}>
          {i > 0 && " · "}
          {ACTION_LABEL[k]} <span className="font-semibold text-white/85">{n0(a[k])}</span>
        </span>
      ))}
    </span>
  );
}

function LowData() {
  return (
    <span className="ml-1.5 whitespace-nowrap rounded bg-amber-400/15 px-1.5 py-px text-[10px] font-bold uppercase text-amber-300">
      för lite data
    </span>
  );
}

/** Rader sorterade på öppningsgrad; tillförlitliga (n ≥ MIN_SAMPLE) före de med för lite data. */
function byRate<T extends { sent: number; openRate: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.sent >= MIN_SAMPLE ? 1 : 0;
    const rb = b.sent >= MIN_SAMPLE ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return (b.openRate ?? -1) - (a.openRate ?? -1) || b.sent - a.sent;
  });
}

/** iOS-liknande notismock: titel, text, bild och låsskärmsknapparna under. */
function NotificationMock({ c }: { c: Composed }) {
  const p = c.payload;
  const buttons = p.category ? CATEGORY_BUTTONS[p.category] : null;
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-[22px] bg-neutral-200/90 p-3 text-neutral-900 shadow-lg backdrop-blur">
        <div className="flex items-start gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-neutral-900 text-sm font-black text-white">N</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
              <span>NextWatch</span>
              <span className="normal-case">nu</span>
            </div>
            <div className="mt-0.5 break-words text-[14px] font-semibold leading-snug">{p.title}</div>
            <div className="mt-0.5 break-words text-[14px] leading-snug text-neutral-800">{p.body}</div>
          </div>
        </div>
        {p.image && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB-bild i admin, ingen next/image-konfig behövs
          <img src={p.image} alt="" className="mt-2.5 aspect-video w-full rounded-xl bg-neutral-300 object-cover" />
        )}
        {buttons && (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {buttons.map((b) => (
              <div key={b} className="rounded-xl bg-neutral-300/80 py-2 text-center text-[13px] font-semibold text-neutral-700">
                {b}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
        <Pill>{typeLabel(c.type)}</Pill>
        <Pill>vinkel {p.angle ?? c.angle}</Pill>
        {p.category && <Pill>{p.category}</Pill>}
        {p.interruptionLevel && <Pill tone={p.interruptionLevel === "time-sensitive" ? "warn" : undefined}>{p.interruptionLevel}</Pill>}
        {p.relevanceScore != null && <Pill>relevans {p.relevanceScore}</Pill>}
        {p.threadId && <Pill>tråd {p.threadId}</Pill>}
        {p.tmdbId != null && (
          <Pill>
            {p.mediaType ?? "?"} {p.tmdbId}
          </Pill>
        )}
      </div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${tone === "warn" ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-white/55"}`}>
      {children}
    </span>
  );
}

function TestSection() {
  const [types, setTypes] = useState<string[]>(FALLBACK_TEST_TYPES);
  const [angles, setAngles] = useState<string[]>([]);
  const [type, setType] = useState("daily_rec");
  const [angle, setAngle] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/push-test?meta=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; types?: string[]; angles?: string[] }) => {
        if (!alive || !j.ok) return;
        if (j.types?.length) setTypes(j.types);
        if (j.angles) setAngles(j.angles);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = async (mode: "preview" | "send") => {
    setBusy(mode);
    setResult(null);
    try {
      const res =
        mode === "preview"
          ? await fetch(
              `/api/admin/push-test?type=${encodeURIComponent(type)}${angle ? `&angle=${encodeURIComponent(angle)}` : ""}`,
              { cache: "no-store" },
            )
          : await fetch("/api/admin/push-test", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ type, ...(angle ? { angle } : {}) }),
            });
      const j = (await res.json()) as
        | { ok: true; composed: Composed; sent?: boolean; pid?: string | null }
        | { ok: false; message?: string };
      if (!j.ok) setResult({ kind: "error", message: j.message ?? "Något gick fel." });
      else if (mode === "preview") setResult({ kind: "preview", composed: j.composed });
      else setResult({ kind: "sent", sent: !!j.sent, pid: j.pid ?? null, composed: j.composed });
    } catch {
      setResult({ kind: "error", message: "Nätverksfel — försök igen." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-white/40">Typ</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2.5 text-sm text-white"
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-white/40">Textvinkel</span>
          <select
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2.5 text-sm text-white"
          >
            <option value="">Auto (som cronen väljer)</option>
            {angles.map((a) => (
              <option key={a} value={a}>
                {angleLabel(a)}
                {ANGLE_LABEL[a] ? ` (${a})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("preview")}
          className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
        >
          {busy === "preview" ? "Komponerar…" : "Förhandsvisa"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("send")}
          className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-white/90 disabled:opacity-50"
        >
          {busy === "send" ? "Skickar…" : "Skicka till min telefon"}
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-white/40">
        Skickas bara till dina egna enheter och ignorerar frekvenstaket. Är «dagliga tips» avstängt i din profil, eller
        saknas push-token, blir resultatet «inte skickad».
      </p>

      {result?.kind === "error" && (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-200">{result.message}</p>
      )}
      {result && result.kind !== "error" && (
        <div className="mt-4">
          {result.kind === "sent" && (
            <p
              className={`mb-3 rounded-xl border px-3 py-2.5 text-sm ${
                result.sent
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-200"
              }`}
            >
              {result.sent
                ? `Skickad${result.pid ? ` (pid ${result.pid.slice(0, 8)})` : ""}. Kolla telefonen.`
                : "Inte skickad — ingen enhet registrerad, push-token saknas eller notistypen är avstängd i din profil."}
            </p>
          )}
          <NotificationMock c={result.composed} />
        </div>
      )}
    </div>
  );
}

export default function PushPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<Stats | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVariants, setShowVariants] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/admin/push-stats?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Stats | Fail) => {
        if (!alive) return;
        if (j.ok) {
          setData(j);
          setFail(null);
        } else {
          setData(null);
          setFail(j.message);
        }
      })
      .catch(() => alive && setFail("Kunde inte hämta statistiken. Kolla Vercel-loggarna efter [admin/push-stats]."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  useEffect(() => load(), [load]);

  const t = data?.totals;
  const angleRows = data ? (showVariants ? data.variants.map((v) => ({ ...v, key: v.variant })) : data.angles.map((a) => ({ ...a, key: a.angle }))) : [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Push</h2>
          <p className="text-xs text-white/40">Vad fungerar? Öppningsgrad per typ och textvinkel. Svenska kalenderdagar.</p>
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

      {fail && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">{fail}</p>
      )}

      {loading && !data && !fail && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      )}

      {data && t && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Skickade" value={n0(t.sent)} sub={`senaste ${data.days} d`} />
            <Tile label="Öppnade" value={n0(t.opened)} />
            <Tile
              label="Öppningsgrad"
              value={pct(t.openRate)}
              tone="accent"
              sub={t.sent < MIN_SAMPLE ? "för lite data än" : undefined}
            />
            <Tile
              label="Knapptryck"
              value={n0(t.buttonTaps)}
              tone="money"
              sub={t.opened > 0 ? `${pct(t.buttonTaps / t.opened)} av öppnade` : "låsskärmsknappar"}
            />
          </div>

          <Section title="Per typ" sub="Knapptryck räknas också som öppnad." />
          <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03]">
            {data.types.length === 0 && <p className="px-3.5 py-3 text-sm text-white/40">Inga pushar loggade i perioden.</p>}
            {data.types.map((r) => (
              <div key={r.type} className="px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-semibold text-white/90">
                    {typeLabel(r.type)}
                    {r.sent < MIN_SAMPLE && <LowData />}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="font-bold text-cyan-300">{pct(r.openRate)}</span>
                    <span className="ml-1.5 text-xs text-white/45">
                      {n0(r.opened)} / {n0(r.sent)}
                    </span>
                  </span>
                </div>
                <RateBar rate={r.openRate} dim={r.sent < MIN_SAMPLE} />
                <div className="mt-1.5 text-[11px] leading-snug">
                  <ActionChips a={r.actions} />
                </div>
              </div>
            ))}
          </div>

          <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white">Per textvinkel</h2>
              <p className="text-xs text-white/40">
                Rekommendationspushar. Sorterat på öppningsgrad; färre än {MIN_SAMPLE} skickade = för lite data (hamnar sist).
              </p>
            </div>
            <div className="flex rounded-lg bg-white/[0.06] p-0.5">
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setShowVariants(v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    showVariants === v ? "bg-white text-neutral-950" : "text-white/60 hover:text-white"
                  }`}
                >
                  {v ? "Vinkel + variant" : "Vinkel"}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03]">
            {angleRows.length === 0 && <p className="px-3.5 py-3 text-sm text-white/40">Inga pushar med vinkel i perioden än.</p>}
            {byRate(angleRows).map((r) => {
              const base = r.key.split(".")[0];
              return (
                <div key={r.key} className="px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-semibold text-white/90">
                      {angleLabel(base)}
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-white/40">{r.key}</span>
                      {r.sent < MIN_SAMPLE && <LowData />}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <span className="font-bold text-cyan-300">{pct(r.openRate)}</span>
                      <span className="ml-1.5 text-xs text-white/45">
                        {n0(r.opened)} / {n0(r.sent)}
                      </span>
                    </span>
                  </div>
                  <RateBar rate={r.openRate} dim={r.sent < MIN_SAMPLE} />
                  <div className="mt-1 text-[11px] text-white/45">
                    n = {n0(r.sent)} · Spara via knapp <span className="font-semibold text-white/75">{n0(r.saves)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Section title="Dag för dag" sub="Tryck/hovra på en stapel för dagens siffra." />
          <div className="grid gap-3 md:grid-cols-2">
            <DailyChart
              title="Skickade"
              data={data.series.map((d) => ({ day: d.day, value: d.sent }))}
              color="#a78bfa"
              unit="pushar"
            />
            <DailyChart
              title="Öppnade"
              data={data.series.map((d) => ({ day: d.day, value: d.opened }))}
              color="#22d3ee"
              unit="öppnade"
            />
          </div>

          <Section title="Senaste pushar" sub="De 40 senaste, utan användaruppgifter." />
          <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.03]">
            {data.latest.length === 0 && <p className="px-3.5 py-3 text-sm text-white/40">Inget loggat än.</p>}
            {data.latest.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-white/85">
                    {typeLabel(r.type)}
                    {r.angle && <span className="ml-1.5 font-mono text-[11px] text-white/40">{r.angle}</span>}
                  </div>
                  <div className="text-[11px] tabular-nums text-white/40">
                    {when(r.sentAt)}
                    {r.tmdbId != null && ` · ${r.mediaType ?? "?"} ${r.tmdbId}`}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11px]">
                  {r.action ? (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-px font-bold uppercase text-emerald-300">
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                  ) : r.openedAt ? (
                    <span className="rounded bg-cyan-400/15 px-1.5 py-px font-bold uppercase text-cyan-300">öppnad</span>
                  ) : (
                    <span className="text-white/30">ej öppnad</span>
                  )}
                  {r.openedAt && <div className="mt-0.5 tabular-nums text-white/35">{when(r.openedAt)}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Section title="Testa" sub="Förhandsvisa hur en push ser ut, eller skicka den till din egen telefon." />
      <TestSection />
    </>
  );
}
