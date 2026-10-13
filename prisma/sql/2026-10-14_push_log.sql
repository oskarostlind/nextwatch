-- Pushlogg: en rad per skickad push (inte per enhet). Grunden för /admin → Push
-- (öppningsgrad per typ/vinkel, knapptryck på låsskärmen). Additiv och
-- idempotent. Körs manuellt mot databasen INNAN koden deployas (lib/push.ts
-- skriver hit; skrivningen är best-effort, så en saknad tabell stoppar inga
-- notiser men ger ingen mätning).
CREATE TABLE IF NOT EXISTS push_log (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  angle      text,
  tmdb_id    integer,
  media_type text,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  opened_at  timestamptz,
  action     text,
  action_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_push_log_sent ON push_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_push_log_user_sent ON push_log(user_id, sent_at);
