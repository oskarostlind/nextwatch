// lib/asc/downloads.ts — "App Store-källor" i /admin.
//
// Var kom App Store-nedladdningarna ifrån? Webbens källspårning
// (lib/acquisition.ts) ser bara att någon öppnade appen — inte vilken länk som
// gav installationen. Det vet bara Apple, aggregerat, via kampanjkoderna (ct=)
// i App Store-länkarna (ig-bio, ig-reels, fb-sida …) och källtypen.
//
// Källa: App Store Connect Analytics Reports API, rapporten "App Store
// Downloads" (kategori COMMERCE), daglig granularitet.
//   https://developer.apple.com/documentation/appstoreconnectapi/downloading-analytics-reports
//   https://developer.apple.com/documentation/analytics-reports/app-download
//   - Standard: Date, Download Type, Source Type, Page Type, Territory, Counts …
//     (fullständiga tal).
//   - Detailed: + Source Info (vilken app/sajt), Campaign (ct=), Page Title.
//     Rader med färre än 5 användare utelämnas och talen får brus (±2 i ~68 %
//     av fallen) — https://developer.apple.com/documentation/analytics-reports/privacy
//   Vi läser båda: källtyper ur Standard (fullständig), kampanjer och
//   hänvisande appar/sajter ur Detailed.
//
// Flöde (syncAscDownloads, körs av /api/cron/asc-downloads + "Uppdatera nu"):
//   1. Hitta en ONGOING analyticsReportRequest för appen
//      (GET /v1/apps/{id}/analyticsReportRequests?filter[accessType]=ONGOING),
//      annars skapa en (POST /v1/analyticsReportRequests — kräver Admin-roll).
//      Första rapporten tar 1–2 dygn; förfrågan stoppas av Apple
//      (stoppedDueToInactivity) om ingen hämtar data på länge — cronen förhindrar det.
//   2. GET /v1/analyticsReportRequests/{id}/reports?filter[category]=COMMERCE →
//      rapporterna vars namn innehåller "Download" (+ Standard/Detailed).
//      Matchas på namn-mönster i stället för exakt namn, eftersom Apple kallar
//      den både "App Downloads …" och "App Store Downloads …".
//   3. GET /v1/analyticsReports/{id}/instances?filter[granularity]=DAILY →
//      instanser (processingDate) som inte lästs än, äldst först.
//   4. GET /v1/analyticsReportInstances/{id}/segments → url/checksum/sizeInBytes;
//      ladda ner direkt (URL:en gäller 5 min), gzip → tabbseparerad text med
//      rubrikrad. Kolumner läses på NAMN (Apple flyttar dem ibland).
//   5. Aggregera och skriv till asc_download_stats. Instanser med senare
//      processingDate ERSÄTTER tidigare för samma Date (Apple: "Don't merge
//      records … across two report instances … Use the latest instance").

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { AscError, ascConfig, ascFetch, ascFetchAll, ascMissingEnv, type AscConfig } from "./client";

export type ReportKind = "standard" | "detailed";

const STATE_KEY = "downloads";
/** Instanser äldre än så här hoppas över (Apple sparar dem 35 dagar). */
const INSTANCE_WINDOW_DAYS = 40;

type Resource<A> = { id: string; type: string; attributes: A };
type RequestAttrs = { accessType?: string; stoppedDueToInactivity?: boolean };
type ReportAttrs = { name?: string; category?: string };
type InstanceAttrs = { granularity?: string; processingDate?: string };
type SegmentAttrs = { checksum?: string; sizeInBytes?: number; url?: string };

export type SyncStatus = "unconfigured" | "no_table" | "waiting" | "ok" | "partial" | "error";
export type SyncResult = {
  ok: boolean;
  status: SyncStatus;
  message: string;
  processed: number;
  pending: number;
  rows: number;
  warnings: string[];
};

type StateRow = {
  request_id: string | null;
  request_created_at: Date | null;
  report_ids: unknown;
  last_run_at: Date | null;
  last_ok_at: Date | null;
  last_error: string | null;
  last_result: unknown;
};

/** Saknas tabellerna (SQL-filen inte körd)? Postgres 42P01 = undefined_table. */
export function isMissingTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /42P01|does not exist|relation "asc_/i.test(msg);
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function readState(): Promise<StateRow | null> {
  const rows = await prisma.$queryRaw<StateRow[]>`
    SELECT request_id, request_created_at, report_ids, last_run_at, last_ok_at, last_error, last_result
    FROM asc_sync_state WHERE key = ${STATE_KEY}`;
  return rows[0] ?? null;
}

async function writeState(patch: {
  requestId?: string | null;
  requestCreatedAt?: Date | null;
  reportIds?: unknown;
  ok: boolean;
  error?: string | null;
  result?: unknown;
}): Promise<void> {
  const reportIds = patch.reportIds === undefined ? null : JSON.stringify(patch.reportIds);
  const result = patch.result === undefined ? null : JSON.stringify(patch.result);
  await prisma.$executeRaw`
    INSERT INTO asc_sync_state (key, request_id, request_created_at, report_ids, last_run_at, last_ok_at, last_error, last_result)
    VALUES (${STATE_KEY}, ${patch.requestId ?? null}, ${patch.requestCreatedAt ?? null}, ${reportIds}::jsonb, now(),
            ${patch.ok ? new Date() : null}, ${patch.error ?? null}, ${result}::jsonb)
    ON CONFLICT (key) DO UPDATE SET
      request_id = COALESCE(EXCLUDED.request_id, asc_sync_state.request_id),
      request_created_at = COALESCE(EXCLUDED.request_created_at, asc_sync_state.request_created_at),
      report_ids = COALESCE(EXCLUDED.report_ids, asc_sync_state.report_ids),
      last_run_at = now(),
      last_ok_at = COALESCE(EXCLUDED.last_ok_at, asc_sync_state.last_ok_at),
      last_error = EXCLUDED.last_error,
      last_result = COALESCE(EXCLUDED.last_result, asc_sync_state.last_result)`;
}

// ── 1. Rapportförfrågan ─────────────────────────────────────────────────────

async function ensureRequest(
  cfg: AscConfig,
  state: StateRow | null
): Promise<{ id: string; createdAt: Date | null; createdNow: boolean }> {
  const override = process.env.ASC_ANALYTICS_REQUEST_ID?.trim();
  if (override) return { id: override, createdAt: state?.request_created_at ?? null, createdNow: false };

  if (state?.request_id) {
    try {
      const r = await ascFetch<{ data: Resource<RequestAttrs> }>(cfg, `/v1/analyticsReportRequests/${state.request_id}`);
      if (!r.data.attributes.stoppedDueToInactivity) {
        return { id: state.request_id, createdAt: state.request_created_at, createdNow: false };
      }
    } catch (e) {
      // 403: nyckeln (Sales/Finance) får kanske inte läsa förfrågan — använd den sparade.
      if (e instanceof AscError && e.status === 403) {
        return { id: state.request_id, createdAt: state.request_created_at, createdNow: false };
      }
      if (!(e instanceof AscError && e.status === 404)) throw e;
    }
  }

  const list = await ascFetchAll<Resource<RequestAttrs>>(
    cfg,
    `/v1/apps/${encodeURIComponent(cfg.appId)}/analyticsReportRequests?filter[accessType]=ONGOING&limit=50`
  );
  const active = list.find((r) => r.attributes.accessType === "ONGOING" && !r.attributes.stoppedDueToInactivity);
  if (active) return { id: active.id, createdAt: state?.request_id === active.id ? state.request_created_at : null, createdNow: false };

  try {
    const created = await ascFetch<{ data: Resource<RequestAttrs> }>(cfg, "/v1/analyticsReportRequests", {
      method: "POST",
      body: {
        data: {
          type: "analyticsReportRequests",
          attributes: { accessType: "ONGOING" },
          relationships: { app: { data: { type: "apps", id: cfg.appId } } },
        },
      },
    });
    return { id: created.data.id, createdAt: new Date(), createdNow: true };
  } catch (e) {
    if (e instanceof AscError && e.status === 403) {
      throw new AscError(
        "Nyckeln får inte skapa rapportförfrågan. Det kräver rollen Admin (en gång) — Sales and Reports/Finance kan bara läsa rapporter som redan beställts.",
        403
      );
    }
    throw e;
  }
}

// ── 2–3. Rapporter och instanser ────────────────────────────────────────────

async function findDownloadReports(cfg: AscConfig, requestId: string): Promise<Partial<Record<ReportKind, string>>> {
  const reports = await ascFetchAll<Resource<ReportAttrs>>(
    cfg,
    `/v1/analyticsReportRequests/${requestId}/reports?filter[category]=COMMERCE&limit=200`
  );
  const out: Partial<Record<ReportKind, string>> = {};
  for (const r of reports) {
    const name = r.attributes.name ?? "";
    if (!/download/i.test(name) || /pre-?order/i.test(name)) continue;
    if (/detailed/i.test(name)) out.detailed ??= r.id;
    else if (/standard/i.test(name)) out.standard ??= r.id;
  }
  return out;
}

type InstanceRef = { kind: ReportKind; reportId: string; id: string; processingDate: string };

async function listInstances(cfg: AscConfig, kind: ReportKind, reportId: string, cutoff: string): Promise<InstanceRef[]> {
  const list = await ascFetchAll<Resource<InstanceAttrs>>(
    cfg,
    `/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`
  );
  return list
    .map((i) => ({ kind, reportId, id: i.id, processingDate: (i.attributes.processingDate ?? "").slice(0, 10) }))
    .filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.processingDate) && i.processingDate >= cutoff);
}

// ── 4. Nedladdning och tolkning ─────────────────────────────────────────────

/** Tolkar Apples rapportfil: rubrikrad + rader, tabb- (eller komma-) separerat. */
export function parseReport(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const split = (line: string): string[] => {
    if (delim === "\t" || !line.includes('"')) return line.split(delim);
    // Enkel CSV med citattecken.
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  // Kolumnnamn normaliseras: "Source Type" → "sourcetype".
  const header = split(lines[0]).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const r: Record<string, string> = {};
    header.forEach((h, j) => (r[h] = (cells[j] ?? "").trim()));
    rows.push(r);
  }
  return rows;
}

async function downloadSegment(seg: SegmentAttrs, warnings: string[]): Promise<string> {
  if (!seg.url) throw new Error("Segment utan url");
  // Försignerad S3-URL — ingen Authorization-header (då nekar S3).
  const res = await fetch(seg.url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Segmentnedladdning ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const gz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const body = gz ? gunzipSync(raw) : raw;
  if (seg.checksum) {
    const want = seg.checksum.toLowerCase();
    const ok = [raw, body].some((b) => createHash("md5").update(b).digest("hex") === want);
    if (!ok) {
      // Checksummans exakta definition är inte dokumenterad. En trunkerad fil
      // fäller gunzip ovan; stämmer dessutom storleken litar vi på filen.
      if (seg.sizeInBytes && seg.sizeInBytes !== raw.length) {
        throw new Error(`Segmentet stämmer inte (storlek ${raw.length} ≠ ${seg.sizeInBytes})`);
      }
      warnings.push("Checksumma stämde inte men storleken gjorde det — segmentet lästes ändå.");
    }
  }
  return body.toString("utf8");
}

type AggKey = string;
type Agg = {
  date: string;
  downloadType: string;
  sourceType: string;
  sourceInfo: string;
  campaign: string;
  pageType: string;
  territory: string;
  counts: number;
};

function normDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : ymd(new Date(t));
}

function aggregate(rows: Record<string, string>[], appId: string, into: Map<AggKey, Agg>): void {
  for (const r of rows) {
    if (r.appappleidentifier && r.appappleidentifier !== appId) continue;
    const date = normDate(r.date ?? "");
    if (!date) continue;
    const n = Number.parseInt(r.counts ?? "", 10);
    if (!Number.isFinite(n)) continue;
    const a: Omit<Agg, "counts"> = {
      date,
      downloadType: (r.downloadtype ?? "").slice(0, 60),
      sourceType: (r.sourcetype ?? "").slice(0, 60),
      sourceInfo: (r.sourceinfo ?? "").slice(0, 200),
      campaign: (r.campaign ?? "").slice(0, 120),
      pageType: (r.pagetype ?? "").slice(0, 60),
      territory: (r.territory ?? "").slice(0, 10),
    };
    const k = [a.date, a.downloadType, a.sourceType, a.sourceInfo, a.campaign, a.pageType, a.territory].join("\u0001");
    const cur = into.get(k);
    if (cur) cur.counts += n;
    else into.set(k, { ...a, counts: n });
  }
}

// ── 5. Skrivning ────────────────────────────────────────────────────────────

async function processInstance(cfg: AscConfig, inst: InstanceRef, warnings: string[]): Promise<{ rows: number; segments: number; done: boolean }> {
  const segments = await ascFetchAll<Resource<SegmentAttrs>>(cfg, `/v1/analyticsReportInstances/${inst.id}/segments?limit=200`);
  const agg = new Map<AggKey, Agg>();
  for (const s of segments) aggregate(parseReport(await downloadSegment(s.attributes, warnings)), cfg.appId, agg);
  const items = [...agg.values()];

  // Tom instans från de senaste dygnen: Apple kan fortfarande fylla på den —
  // markera inte som läst, försök igen nästa körning.
  const recent = inst.processingDate >= ymd(new Date(Date.now() - 3 * 86_400_000));
  if (!segments.length && recent) return { rows: 0, segments: 0, done: false };

  await prisma.$transaction(async (tx) => {
    const dates = [...new Set(items.map((i) => i.date))];
    if (dates.length) {
      // Ersätt bara datum där ingen NYARE instans redan skrivit (nyast vinner).
      const newer = await tx.$queryRaw<{ date: string }[]>`
        SELECT DISTINCT date::text AS date FROM asc_download_stats
        WHERE report_kind = ${inst.kind} AND date = ANY(${dates}::date[]) AND processing_date > ${inst.processingDate}::date`;
      const skip = new Set(newer.map((r) => r.date));
      const allowed = dates.filter((d) => !skip.has(d));
      const rows = items.filter((i) => !skip.has(i.date));
      if (allowed.length) {
        await tx.$executeRaw`
          DELETE FROM asc_download_stats WHERE report_kind = ${inst.kind} AND date = ANY(${allowed}::date[])`;
      }
      if (rows.length) {
        await tx.$executeRaw`
          INSERT INTO asc_download_stats
            (report_kind, date, download_type, source_type, source_info, campaign, page_type, territory, counts, processing_date, instance_id, updated_at)
          SELECT ${inst.kind}, d::date, dt, st, si, c, pt, terr, n::int, ${inst.processingDate}::date, ${inst.id}, now()
          FROM unnest(
            ${rows.map((r) => r.date)}::text[],
            ${rows.map((r) => r.downloadType)}::text[],
            ${rows.map((r) => r.sourceType)}::text[],
            ${rows.map((r) => r.sourceInfo)}::text[],
            ${rows.map((r) => r.campaign)}::text[],
            ${rows.map((r) => r.pageType)}::text[],
            ${rows.map((r) => r.territory)}::text[],
            ${rows.map((r) => String(r.counts))}::text[]
          ) AS t(d, dt, st, si, c, pt, terr, n)`;
      }
    }
    await tx.$executeRaw`
      INSERT INTO asc_report_instances (instance_id, report_kind, report_id, processing_date, segments, rows, processed_at)
      VALUES (${inst.id}, ${inst.kind}, ${inst.reportId}, ${inst.processingDate}::date, ${segments.length}, ${items.length}, now())
      ON CONFLICT (instance_id) DO UPDATE SET segments = EXCLUDED.segments, rows = EXCLUDED.rows, processed_at = now()`;
  });
  return { rows: items.length, segments: segments.length, done: true };
}

/**
 * Hämtar nya rapportinstanser från Apple och cachar dem. Kastar aldrig —
 * resultatet beskriver vad som hände (och sparas i asc_sync_state).
 * budgetMs håller körningen inom funktionens maxDuration; det som inte hanns
 * med tas nästa körning (pending > 0).
 */
export async function syncAscDownloads(opts: { budgetMs?: number } = {}): Promise<SyncResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const base = { processed: 0, pending: 0, rows: 0, warnings: [] as string[] };

  const cfg = ascConfig();
  if (!cfg) {
    return { ...base, ok: false, status: "unconfigured", message: `Saknar ${ascMissingEnv().join(", ")}` };
  }

  let state: StateRow | null;
  try {
    state = await readState();
  } catch (e) {
    if (isMissingTable(e)) {
      return { ...base, ok: false, status: "no_table", message: "Kör prisma/sql/2026-10-15_asc_download_stats.sql" };
    }
    return { ...base, ok: false, status: "error", message: errMsg(e) };
  }

  let requestId: string | null = state?.request_id ?? null;
  let requestCreatedAt: Date | null = state?.request_created_at ?? null;
  try {
    const req = await ensureRequest(cfg, state);
    requestId = req.id;
    requestCreatedAt = req.createdAt ?? requestCreatedAt;

    const reports = await findDownloadReports(cfg, req.id);
    if (!reports.standard && !reports.detailed) {
      const since = requestCreatedAt ? ` (beställd ${requestCreatedAt.toLocaleDateString("sv-SE")})` : "";
      const result: SyncResult = {
        ...base,
        ok: true,
        status: "waiting",
        message: req.createdNow
          ? "Rapportförfrågan skapad hos Apple. Första rapporten tar 1–2 dygn."
          : `Apple har inte genererat nedladdningsrapporten än${since}. Första rapporten tar 1–2 dygn.`,
      };
      await writeState({ requestId, requestCreatedAt, reportIds: reports, ok: true, result });
      return result;
    }

    const cutoff = ymd(new Date(Date.now() - INSTANCE_WINDOW_DAYS * 86_400_000));
    const all: InstanceRef[] = [];
    for (const kind of ["standard", "detailed"] as const) {
      const id = reports[kind];
      if (id) all.push(...(await listInstances(cfg, kind, id, cutoff)));
    }
    const done = new Set(
      all.length
        ? (
            await prisma.$queryRaw<{ instance_id: string }[]>`
              SELECT instance_id FROM asc_report_instances WHERE instance_id = ANY(${all.map((i) => i.id)}::text[])`
          ).map((r) => r.instance_id)
        : []
    );
    const todo = all
      .filter((i) => !done.has(i.id))
      .sort((a, b) => a.processingDate.localeCompare(b.processingDate) || a.kind.localeCompare(b.kind));

    let processed = 0;
    let rows = 0;
    let deferred = 0;
    for (const inst of todo) {
      if (Date.now() - started > budget) break;
      const r = await processInstance(cfg, inst, base.warnings);
      if (r.done) {
        processed++;
        rows += r.rows;
      } else deferred++;
    }
    const pending = todo.length - processed - deferred;
    const result: SyncResult = {
      ...base,
      ok: true,
      status: pending > 0 ? "partial" : "ok",
      processed,
      pending,
      rows,
      warnings: [...new Set(base.warnings)],
      message:
        pending > 0
          ? `${processed} rapportfiler lästa, ${pending} kvar — kör igen.`
          : processed > 0
            ? `${processed} nya rapportfiler lästa.`
            : "Inga nya rapporter från Apple sedan förra hämtningen.",
    };
    await writeState({ requestId, requestCreatedAt, reportIds: reports, ok: true, result });
    return result;
  } catch (e) {
    const message = errMsg(e);
    console.warn("[asc/downloads]", message);
    try {
      await writeState({ requestId, requestCreatedAt, ok: false, error: message });
    } catch {
      /* tabellen kan saknas — redan hanterat ovan */
    }
    return { ...base, ok: false, status: "error", message };
  }
}

// ── Läsning till admin-panelen ──────────────────────────────────────────────

export type AscSummary = {
  since: string;
  until: string | null;
  kinds: Partial<Record<ReportKind, { rows: number; minDate: string; maxDate: string; lastProcessing: string }>>;
  /** Vilken rapport källtyperna kommer från (Standard = fullständiga tal). */
  sourceTypeFrom: ReportKind | null;
  bySourceType: { sourceType: string; firstTime: number; redownloads: number }[];
  byCampaign: { campaign: string; firstTime: number; redownloads: number }[];
  bySourceInfo: { sourceType: string; sourceInfo: string; firstTime: number }[];
  daily: { day: string; value: number }[];
  totals: { standardFirst: number | null; detailedFirst: number | null };
};

const FIRST = "lower(download_type) LIKE 'first%'";
const REDL = "lower(download_type) LIKE 'redownload%'";

export async function readAscDownloadSummary(days = 30): Promise<AscSummary> {
  const since = ymd(new Date(Date.now() - days * 86_400_000));

  const kindRows = await prisma.$queryRaw<
    { report_kind: ReportKind; rows: number; min_date: string; max_date: string; last_processing: string }[]
  >`
    SELECT report_kind, count(*)::int AS rows, min(date)::text AS min_date, max(date)::text AS max_date,
           max(processing_date)::text AS last_processing
    FROM asc_download_stats WHERE date >= ${since}::date GROUP BY report_kind`;
  const kinds: AscSummary["kinds"] = {};
  for (const k of kindRows) {
    kinds[k.report_kind] = { rows: k.rows, minDate: k.min_date, maxDate: k.max_date, lastProcessing: k.last_processing };
  }
  const typeKind: ReportKind | null = kinds.standard ? "standard" : kinds.detailed ? "detailed" : null;
  const until = [kinds.standard?.maxDate, kinds.detailed?.maxDate].filter(Boolean).sort().pop() ?? null;

  const empty: AscSummary = {
    since,
    until,
    kinds,
    sourceTypeFrom: typeKind,
    bySourceType: [],
    byCampaign: [],
    bySourceInfo: [],
    daily: [],
    totals: { standardFirst: null, detailedFirst: null },
  };
  if (!typeKind) return empty;

  const firstSql = FIRST;
  const reSql = REDL;
  const [byType, byCampaign, byInfo, daily, totals] = await Promise.all([
    prisma.$queryRawUnsafe<{ source_type: string; first_time: number; redownloads: number }[]>(
      `SELECT lower(source_type) AS source_type,
              COALESCE(sum(counts) FILTER (WHERE ${firstSql}), 0)::int AS first_time,
              COALESCE(sum(counts) FILTER (WHERE ${reSql}), 0)::int AS redownloads
       FROM asc_download_stats WHERE report_kind = $1 AND date >= $2::date
       GROUP BY 1 HAVING sum(counts) FILTER (WHERE ${firstSql} OR ${reSql}) > 0
       ORDER BY 2 DESC, 3 DESC`,
      typeKind,
      since
    ),
    kinds.detailed
      ? prisma.$queryRawUnsafe<{ campaign: string; first_time: number; redownloads: number }[]>(
          `SELECT lower(campaign) AS campaign,
                  COALESCE(sum(counts) FILTER (WHERE ${firstSql}), 0)::int AS first_time,
                  COALESCE(sum(counts) FILTER (WHERE ${reSql}), 0)::int AS redownloads
           FROM asc_download_stats WHERE report_kind = 'detailed' AND date >= $1::date AND campaign <> ''
           GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 50`,
          since
        )
      : Promise.resolve([]),
    kinds.detailed
      ? prisma.$queryRawUnsafe<{ source_type: string; source_info: string; first_time: number }[]>(
          `SELECT lower(source_type) AS source_type, source_info,
                  COALESCE(sum(counts) FILTER (WHERE ${firstSql}), 0)::int AS first_time
           FROM asc_download_stats
           WHERE report_kind = 'detailed' AND date >= $1::date AND source_info <> ''
             AND lower(source_type) IN ('app referrer', 'web referrer')
           GROUP BY 1, 2 HAVING sum(counts) FILTER (WHERE ${firstSql}) > 0
           ORDER BY 3 DESC LIMIT 20`,
          since
        )
      : Promise.resolve([]),
    prisma.$queryRawUnsafe<{ day: string; value: number }[]>(
      `SELECT date::text AS day, COALESCE(sum(counts) FILTER (WHERE ${firstSql}), 0)::int AS value
       FROM asc_download_stats WHERE report_kind = $1 AND date >= $2::date GROUP BY 1 ORDER BY 1`,
      typeKind,
      since
    ),
    prisma.$queryRawUnsafe<{ report_kind: ReportKind; first_time: number }[]>(
      `SELECT report_kind, COALESCE(sum(counts) FILTER (WHERE ${firstSql}), 0)::int AS first_time
       FROM asc_download_stats WHERE date >= $1::date GROUP BY 1`,
      since
    ),
  ]);

  // En stapel per dag i fönstret (dagar utan rader = 0), fram till senaste data.
  const byDay = new Map(daily.map((d) => [d.day, d.value]));
  const series: { day: string; value: number }[] = [];
  const end = until ?? ymd(new Date());
  for (let t = Date.parse(`${since}T00:00:00Z`); ymd(new Date(t)) <= end; t += 86_400_000) {
    const day = ymd(new Date(t));
    series.push({ day, value: byDay.get(day) ?? 0 });
  }

  return {
    ...empty,
    bySourceType: byType.map((r) => ({ sourceType: r.source_type, firstTime: r.first_time, redownloads: r.redownloads })),
    byCampaign: byCampaign.map((r) => ({ campaign: r.campaign, firstTime: r.first_time, redownloads: r.redownloads })),
    bySourceInfo: byInfo.map((r) => ({ sourceType: r.source_type, sourceInfo: r.source_info, firstTime: r.first_time })),
    daily: series,
    totals: {
      standardFirst: totals.find((t) => t.report_kind === "standard")?.first_time ?? null,
      detailedFirst: totals.find((t) => t.report_kind === "detailed")?.first_time ?? null,
    },
  };
}

export type AscPanelData = {
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
  summary: AscSummary | null;
};

/** Allt panelen behöver. Kastar aldrig — saknad env/tabell blir flaggor. */
export async function readAscPanelData(): Promise<AscPanelData> {
  const missing = ascMissingEnv();
  const appId = ascConfig()?.appId ?? ((process.env.ASC_APP_ID ?? "").trim() || "6778179190");
  const out: AscPanelData = { configured: missing.length === 0, missing, tableReady: true, appId, state: null, summary: null };
  try {
    const s = await readState();
    out.state = s
      ? {
          requestId: s.request_id,
          requestCreatedAt: s.request_created_at?.toISOString() ?? null,
          lastRunAt: s.last_run_at?.toISOString() ?? null,
          lastOkAt: s.last_ok_at?.toISOString() ?? null,
          lastError: s.last_error,
          lastResult: (s.last_result as SyncResult | null) ?? null,
        }
      : null;
    out.summary = await readAscDownloadSummary(30);
  } catch (e) {
    if (isMissingTable(e)) out.tableReady = false;
    else console.warn("[asc/downloads] read", errMsg(e));
  }
  return out;
}
