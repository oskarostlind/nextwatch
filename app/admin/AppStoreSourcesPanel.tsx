"use client";
// app/admin/AppStoreSourcesPanel.tsx — "App Store-källor" på admin-översikten.
//
// Varifrån kom App Store-nedladdningarna? Läser /api/admin/asc-downloads, som
// cachar App Store Connects nedladdningsrapport (lib/asc/downloads.ts):
// källtyp (App referrer = andra appar, där Meta-annonser hamnar; Web referrer;
// App Store-sök/bläddring) och kampanjkoden ct= från våra App Store-länkar
// (ig-bio, ig-reels, fb-sida …). Webbens egen källspårning (Källor ovan) ser
// bara att appen öppnades — inte vilken länk som gav installationen.

import { useCallback, useEffect, useState } from "react";
import { DailyChart } from "./charts";

type SyncResult = { ok: boolean; status: string; message: string; processed: number; pending: number; warnings: string[] };
type Summary = {
  since: string;
  until: string | null;
  kinds: Partial<Record<"standard" | "detailed", { rows: number; minDate: string; maxDate: string; lastProcessing: string }>>;
  sourceTypeFrom: "standard" | "detailed" | null;
  bySourceType: { sourceType: string; firstTime: number; redownloads: number }[];
  byCampaign: { campaign: string; firstTime: number; redownloads: number }[];
  bySourceInfo: { sourceType: string; sourceInfo: string; firstTime: number }[];
  daily: { day: string; value: number }[];
  totals: { standardFirst: number | null; detailedFirst: number | null };
};
type PanelData = {
  ok: boolean;
  configured: boolean;
  missing: string[];
  tableReady: boolean;
  appId: string;
  state: {
    requestId: string | null;
    requestCreatedAt: string | null;
    lastRunAt: string | null;
    lastOkAt: string | null;
    lastError: string | null;
    lastResult: SyncResult | null;
  } | null;
  summary: Summary | null;
  sync?: SyncResult;
};

/** Kampanjkoderna i våra App Store-länkar — visas alltid, även med 0/dolt. */
const KNOWN_CAMPAIGNS = ["ig-bio", "ig-reels", "fb-sida", "fb-grupp", "press-teknikveckan", "press-cinemacelsius"];

const SOURCE_TYPE: Record<string, { label: string; hint: string }> = {
  "app referrer": { label: "App referrer", hint: "Från en annan app — Instagram/Facebook, även Meta-annonser" },
  "web referrer": { label: "Web referrer", hint: "Länk på en webbsida, öppnad i Safari" },
  "app store search": { label: "App Store-sök", hint: "Sökresultat i App Store (inkl. Search Ads)" },
  "app store browse": { label: "App Store-bläddring", hint: "Idag, topplistor, förslag" },
  "app clip": { label: "App Clip", hint: "" },
  unavailable: { label: "Okänd", hint: "Apple vet inte källan" },
  "institutional purchase": { label: "Företag/skola", hint: "Apple Business/School Manager" },
};

function campaignGroup(c: string): string {
  if (c.startsWith("ig-")) return "Instagram";
  if (c.startsWith("fb-")) return "Facebook";
  if (c.startsWith("press-")) return "Press";
  return "Övrigt";
}

const n0 = (n: number) => n.toLocaleString("sv-SE");
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "—";
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "aldrig";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="truncate text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 truncate text-2xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{sub}</div>}
    </div>
  );
}

function Table({
  title,
  cols,
  children,
  empty,
}: {
  title: string;
  cols: string[];
  children: React.ReactNode;
  empty?: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        <span>{title}</span>
        {cols.map((c) => (
          <span key={c} className="text-right">
            {c}
          </span>
        ))}
      </div>
      {empty ? <p className="px-4 py-5 text-center text-sm text-white/40">{empty}</p> : children}
    </div>
  );
}

function Row({ label, sub, a, b, strong }: { label: string; sub?: string; a: string; b: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-white/5 px-4 py-2.5 text-sm tabular-nums last:border-0">
      <span className="min-w-0">
        <span className={`block truncate ${strong ? "font-semibold text-sky-300" : "text-white/85"}`}>{label}</span>
        {sub && <span className="block truncate text-[11px] text-white/35">{sub}</span>}
      </span>
      <span className="text-right font-semibold text-white">{a}</span>
      <span className="text-right text-white/50">{b}</span>
    </div>
  );
}

export default function AppStoreSourcesPanel() {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/asc-downloads", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PanelData | null) => j?.ok && setData(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const refresh = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/admin/asc-downloads", { method: "POST", cache: "no-store" });
      const j = (await r.json()) as PanelData;
      if (j.ok) setData(j);
      setSyncMsg(j.sync?.message ?? (r.ok ? "Klart." : "Något gick fel."));
    } catch {
      setSyncMsg("Kunde inte nå servern.");
    } finally {
      setSyncing(false);
    }
  };

  const s = data?.summary ?? null;
  const hasData = Boolean(s && s.sourceTypeFrom);
  const campaignMap = new Map((s?.byCampaign ?? []).map((c) => [c.campaign, c]));
  const campaigns = [
    ...KNOWN_CAMPAIGNS.map((c) => ({ campaign: c, row: campaignMap.get(c) ?? null })),
    ...(s?.byCampaign ?? []).filter((c) => !KNOWN_CAMPAIGNS.includes(c.campaign)).map((c) => ({ campaign: c.campaign, row: c })),
  ];
  const campaignTotal = (s?.byCampaign ?? []).reduce((a, c) => a + c.firstTime, 0);
  const firstTotal = s?.totals.standardFirst ?? s?.totals.detailedFirst ?? 0;
  const appRef = s?.bySourceType.find((r) => r.sourceType === "app referrer")?.firstTime ?? 0;
  const coverage =
    s?.totals.standardFirst && s.totals.detailedFirst !== null
      ? Math.min(100, Math.round((s.totals.detailedFirst / s.totals.standardFirst) * 100))
      : null;

  return (
    <>
      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-white">App Store-källor</h2>
          <p className="text-xs text-white/40">
            Förstanedladdningar senaste 30 d enligt Apple. Apple-data släpar 1–2 dygn
            {s?.until ? ` — senaste dag med data: ${fmtDate(s.until)}` : ""}.
          </p>
        </div>
        {data?.configured && data.tableReady && (
          <button
            type="button"
            onClick={refresh}
            disabled={syncing}
            className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            {syncing ? "Hämtar från Apple…" : "Uppdatera nu"}
          </button>
        )}
      </div>

      {loading && !data ? (
        <div className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />
      ) : !data ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-white/40">
          Kunde inte läsa App Store-källorna.
        </p>
      ) : !data.configured ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-white/80">
          <p className="font-semibold text-amber-200">Inte uppkopplat mot App Store Connect.</p>
          <p className="mt-1.5">Lägg in de här variablerna i Vercel (Production) och deploya om:</p>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[13px]">
            {["ASC_ISSUER_ID", "ASC_KEY_ID", "ASC_PRIVATE_KEY"].map((k) => (
              <li key={k} className={data.missing.includes(k) ? "text-amber-200" : "text-white/40 line-through"}>
                {k}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-white/60">
            Skapa nyckeln i App Store Connect → <b>Användare och åtkomst</b> → <b>Integrationer</b> →{" "}
            <b>App Store Connect API</b> → Team Keys (+). Roll: <b>Admin</b> behövs en gång för att beställa rapporten hos
            Apple; därefter räcker <b>Sales and Reports</b> eller <b>Finance</b>. Issuer ID står överst på samma sida,
            Key ID i listan. Ladda ner .p8-filen (går bara en gång) och klistra in hela innehållet i ASC_PRIVATE_KEY.
          </p>
          <p className="mt-2 text-[12px] text-white/45">
            Inte samma nyckel som APPLE_IAP_* — den är en In-App Purchase-nyckel utan åtkomst till Analytics. Valfritt:
            ASC_APP_ID (standard {data.appId}).
          </p>
        </div>
      ) : !data.tableReady ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm text-white/80">
          <p className="font-semibold text-amber-200">Tabellerna saknas.</p>
          <p className="mt-1">
            Kör <code className="font-mono text-[13px]">prisma/sql/2026-10-15_asc_download_stats.sql</code> mot databasen.
          </p>
        </div>
      ) : (
        <>
          {(syncMsg || data.state?.lastError) && (
            <div
              className={`mb-3 rounded-xl px-3.5 py-2.5 text-[13px] ${
                data.state?.lastError ? "bg-rose-500/10 text-rose-200" : "bg-white/[0.05] text-white/70"
              }`}
            >
              {data.state?.lastError ? `Senaste hämtningen misslyckades: ${data.state.lastError}` : syncMsg}
              {data.state?.lastError && syncMsg && <div className="mt-1 text-white/60">{syncMsg}</div>}
            </div>
          )}

          {!hasData ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-white/50">
              {data.state?.lastResult?.message ?? "Ingen data än — tryck på Uppdatera nu."}
              {data.state?.requestCreatedAt && (
                <span className="mt-1 block text-[12px] text-white/35">
                  Rapporten beställdes hos Apple {fmtTime(data.state.requestCreatedAt)}. Första leveransen tar 1–2 dygn.
                </span>
              )}
            </p>
          ) : (
            s && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Tile label="Förstanedl." value={n0(firstTotal)} sub="30 d, alla källor" />
                  <Tile label="App referrer" value={n0(appRef)} sub="andra appar, inkl. Meta" />
                  <Tile label="Via ct=-länk" value={n0(campaignTotal)} sub="kampanjkoder" />
                </div>

                <div className="mt-3">
                  <DailyChart
                    title="Förstanedladdningar per dag"
                    hint="App Store Connect. De två senaste dagarna är inte kompletta än."
                    data={s.daily}
                    color="#38bdf8"
                  />
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Table
                    title="Källtyp"
                    cols={["Första", "Om"]}
                    empty={s.bySourceType.length ? null : "Inga nedladdningar i perioden."}
                  >
                    {s.bySourceType.map((r) => {
                      const meta = SOURCE_TYPE[r.sourceType];
                      return (
                        <Row
                          key={r.sourceType || "—"}
                          label={meta?.label ?? (r.sourceType || "—")}
                          sub={meta?.hint}
                          a={n0(r.firstTime)}
                          b={n0(r.redownloads)}
                          strong={r.sourceType === "app referrer"}
                        />
                      );
                    })}
                  </Table>

                  <Table
                    title="Kampanjkod (ct=)"
                    cols={["Första", "Om"]}
                    empty={s.kinds.detailed ? null : "Detaljrapporten (med kampanjkoder) har inte kommit än."}
                  >
                    {campaigns.map(({ campaign, row }) => (
                      <Row
                        key={campaign}
                        label={campaign}
                        sub={campaignGroup(campaign)}
                        a={row ? n0(row.firstTime) : "—"}
                        b={row ? n0(row.redownloads) : "—"}
                        strong={campaign === "ig-bio"}
                      />
                    ))}
                  </Table>
                </div>

                {s.bySourceInfo.length > 0 && (
                  <div className="mt-3">
                    <Table title="Hänvisande app/sajt" cols={["Första", "Typ"]}>
                      {s.bySourceInfo.map((r) => (
                        <Row
                          key={`${r.sourceType}|${r.sourceInfo}`}
                          label={r.sourceInfo}
                          a={n0(r.firstTime)}
                          b={r.sourceType === "app referrer" ? "app" : "webb"}
                          strong={/instagram|facebook/i.test(r.sourceInfo)}
                        />
                      ))}
                    </Table>
                  </div>
                )}

                <div className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-white/45">
                  <p>
                    <b className="text-white/60">Små tal kan saknas.</b> Kampanjer och hänvisande appar kommer ur Apples
                    detaljrapport, där rader med färre än 5 användare döljs och talen får lite brus (±2).{" "}
                    {coverage !== null &&
                      `Den täcker just nu ${coverage} % av förstanedladdningarna — resten ligger under tröskeln. `}
                    &quot;—&quot; betyder 0 eller dolt. Källtyperna kommer ur standardrapporten och är fullständiga.
                  </p>
                  <p>
                    Meta-annonser till App Store syns som <b className="text-white/60">App referrer</b> (Instagram/Facebook),
                    normalt utan kampanjkod. ct= räknas bara om länken också har ert pt= (provider-token), och bara för
                    förstanedladdningar inom 24 h efter klicket.
                  </p>
                  <p>
                    Senast hämtat {fmtTime(data.state?.lastOkAt)}. Hämtas automatiskt varje morgon.
                    {data.state?.lastResult?.pending ? ` ${data.state.lastResult.pending} rapportfiler återstår — tryck Uppdatera nu.` : ""}
                  </p>
                </div>
              </>
            )
          )}
        </>
      )}
    </>
  );
}
