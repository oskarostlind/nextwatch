-- "Välj åt mig" (AI-val): förfrågningar, intjänade picks (rewarded video) och
-- UI-händelser för /admin. Additiv och idempotent. Körs manuellt mot databasen
-- INNAN koden deployas (lib/aiPick/*, app/api/pick/**).
--
-- Kvoten räknas ur raderna (lib/aiPick/quota.ts): bara status 'ok' förbrukar.
-- Koden skriver dessutom en kortlivad status 'pending' medan en förfrågan pågår
-- (reservation mot dubbeltryck, tagen under ett advisory-lås per användare) —
-- den uppdateras alltid till ok/error/no_candidates, och en 'pending' äldre än
-- 45 s räknas inte alls (förfrågan dog halvvägs → ingen debitering).
CREATE TABLE IF NOT EXISTS ai_pick_requests (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL,          -- 'premium' | 'credit' | 'selftest'
  status        text NOT NULL,          -- 'ok' | 'error' | 'no_candidates'
  prompt        text,                   -- user free text, max 300 chars
  chips         jsonb,                  -- string[] chip ids
  media_filter  text,                   -- 'both' | 'movie' | 'tv'
  pick_tmdb_id  integer,
  pick_media_type text,
  pick_from_saved boolean,              -- pick came from the user's own likes/watchlist
  saved_candidates integer,             -- how many saved likes were in the candidate set
  alternatives  jsonb,                  -- [{tmdbId, mediaType, fromSaved}]
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      double precision,
  latency_ms    integer,
  error         text
);
CREATE INDEX IF NOT EXISTS idx_ai_pick_requests_user_created ON ai_pick_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_pick_requests_created ON ai_pick_requests(created_at);

-- Ett tidigare utkast av den här filen saknade de två kolumnerna nedan. Om det
-- utkastet redan hunnit köras hoppar CREATE TABLE IF NOT EXISTS över tabellen,
-- så de läggs till här. No-op när tabellen skapades av blocket ovan.
ALTER TABLE ai_pick_requests ADD COLUMN IF NOT EXISTS pick_from_saved boolean;
ALTER TABLE ai_pick_requests ADD COLUMN IF NOT EXISTS saved_candidates integer;

CREATE TABLE IF NOT EXISTS ai_pick_grants (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  picks       integer NOT NULL,
  source      text NOT NULL,            -- 'rewarded'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_pick_grants_user_created ON ai_pick_grants(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_pick_events (
  id          text PRIMARY KEY,
  user_id     text REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_pick_events_type_created ON ai_pick_events(type, created_at);
