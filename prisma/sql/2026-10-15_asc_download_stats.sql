-- App Store-källor i /admin: förstanedladdningar per dag och källa ur App Store
-- Connect Analytics Reports API (rapporten App Store Downloads, Standard +
-- Detailed). Fylls av /api/cron/asc-downloads (dagligen) och knappen
-- "Uppdatera nu" — se lib/asc/downloads.ts. Rå SQL, ingen Prisma-modell
-- (samma mönster som google_play_purchases). Additiv och idempotent. Körs
-- manuellt mot databasen INNAN koden deployas; utan tabellerna visar panelen
-- bara en hänvisning hit, inget kraschar.

-- Aggregerade rader. Apple levererar samma Date i flera rapportinstanser
-- (sena händelser/korrigeringar) och den med senast processing_date gäller —
-- därför ersätts alla rader för (report_kind, date) när en nyare instans läses.
CREATE TABLE IF NOT EXISTS asc_download_stats (
  report_kind     text        NOT NULL,              -- 'standard' | 'detailed'
  date            date        NOT NULL,              -- Date-kolumnen (händelsedag)
  download_type   text        NOT NULL DEFAULT '',   -- First-time Download, Redownload, …
  source_type     text        NOT NULL DEFAULT '',   -- App Store search/browse, App referrer, Web referrer, …
  source_info     text        NOT NULL DEFAULT '',   -- bara detailed: appen/sajten som hänvisade
  campaign        text        NOT NULL DEFAULT '',   -- bara detailed: kampanjkoden (ct=)
  page_type       text        NOT NULL DEFAULT '',
  territory       text        NOT NULL DEFAULT '',
  counts          integer     NOT NULL DEFAULT 0,
  processing_date date        NOT NULL,
  instance_id     text        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_kind, date, download_type, source_type, source_info, campaign, page_type, territory)
);
CREATE INDEX IF NOT EXISTS idx_asc_download_stats_date ON asc_download_stats(date);

-- Vilka rapportinstanser som redan lästs (så att cronen inte laddar ner samma
-- fil varje dygn).
CREATE TABLE IF NOT EXISTS asc_report_instances (
  instance_id     text        PRIMARY KEY,
  report_kind     text        NOT NULL,
  report_id       text        NOT NULL,
  processing_date date        NOT NULL,
  segments        integer     NOT NULL DEFAULT 0,
  rows            integer     NOT NULL DEFAULT 0,
  processed_at    timestamptz NOT NULL DEFAULT now()
);

-- Synkstatus (en rad): rapportförfrågans id, senaste körning och fel.
CREATE TABLE IF NOT EXISTS asc_sync_state (
  key           text        PRIMARY KEY,           -- 'downloads'
  request_id    text,
  request_created_at timestamptz,
  report_ids    jsonb,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  last_result   jsonb
);
